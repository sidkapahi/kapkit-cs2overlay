// Cloudflare Worker: Discord build notifications
//
// Workers Builds publishes an event to a Queue whenever a build of a subscribed
// Worker starts, succeeds, fails or is cancelled. This Worker consumes that
// Queue and posts a Discord message for the ones worth knowing about:
//   • preview build succeeded (non-production branch) → green, links + @mention
//   • production build succeeded                      → blue, links, no mention
//   • build failed (any branch)                       → red, logs link + @mention
// Started / cancelled builds are ignored.
//
// It works for any Worker on the account: to add a project, subscribe the Queue
// to that Worker's builds in the dashboard. Optionally give it an entry in
// PROJECTS below for a nicer name, its custom domain and extra links.
//
// It has no fetch handler — nothing calls it over HTTP; the Queue invokes it.
// Setup steps are in worker/README.md.

// Every Worker on the account is served from <worker>.<subdomain>, and branch
// previews from <branch-slug>-<worker>.<subdomain>.
const WORKERS_DEV_SUBDOMAIN = 'sid-kapahi.workers.dev';

// Per-project extras, keyed by Worker name. Everything is optional; a Worker
// with no entry still gets messages, with its workers.dev URLs and branch main.
//   name             — shown in the footer (default: the Worker name)
//   productionUrl    — custom domain (default: https://<worker>.<subdomain>)
//   productionBranch — default 'main'
//   links            — extra pages linked alongside the root: [label, path]
const PROJECTS = {
  'kapkit-cs2overlay': {
    name: 'CS2 overlay',
    productionUrl: 'https://cs2widget.kapkit.ca',
    links: [['🎮 OBS overlay', '/widget/']],
  },
};

function projectFor(workerName) {
  const p = PROJECTS[workerName] || {};
  return {
    worker: workerName,
    name: p.name || workerName,
    productionUrl: p.productionUrl || `https://${workerName}.${WORKERS_DEV_SUBDOMAIN}`,
    productionBranch: p.productionBranch || 'main',
    links: p.links || [],
  };
}

const COLORS = {
  preview: 0x2ecc71, // green
  production: 0x3b82f6, // blue
  failed: 0xe74c3c, // red
};

// Cloudflare turns the branch name into the preview name by lowercasing it and
// replacing anything outside [a-z0-9] with '-' (e.g. claude/youthful-gauss-9f3jia
// → claude-youthful-gauss-9f3jia). A DNS label is at most 63 characters, so the
// slug is capped to leave room for "-<worker>".
function previewSlug(branch, worker) {
  const max = 63 - worker.length - 1;
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

function previewUrl(branch, worker) {
  return `https://${previewSlug(branch, worker)}-${worker}.${WORKERS_DEV_SUBDOMAIN}`;
}

// "1m 12s" / "34s" between two ISO timestamps, or null if either is missing.
function duration(from, to) {
  if (!from || !to) return null;
  const secs = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  if (!Number.isFinite(secs) || secs < 0) return null;
  const m = Math.floor(secs / 60);
  return m ? `${m}m ${secs % 60}s` : `${secs}s`;
}

// Builds report the commit author as an email; show something shorter.
// 12345+sidkapahi@users.noreply.github.com → sidkapahi, me@example.com → me.
function authorName(author) {
  if (!author) return null;
  const local = author.split('@')[0];
  return local.includes('+') ? local.split('+').pop() : local;
}

function firstLine(text, max = 200) {
  const line = (text || '').split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function commitUrl(meta) {
  if (meta.providerType !== 'github' || !meta.providerAccountName || !meta.repoName) return null;
  return `https://github.com/${meta.providerAccountName}/${meta.repoName}/commit/${meta.commitHash}`;
}

function buildLogsUrl(accountId, worker, buildUuid) {
  return `https://dash.cloudflare.com/${accountId}/workers/services/view/${worker}/production/builds/${buildUuid}`;
}

// Turns one Workers Builds event into a Discord webhook body, or null when the
// event isn't one we notify on.
export function buildMessage(event, userId) {
  const kind = event?.type?.split('.').pop(); // started | succeeded | failed | canceled
  const workerName = event?.source?.workerName;
  if (!workerName) return null;
  if (kind !== 'succeeded' && kind !== 'failed') return null;

  const project = projectFor(workerName);
  const payload = event.payload || {};
  const meta = payload.buildTriggerMetadata || {};
  const branch = meta.branch || 'unknown';
  const isProduction = branch === project.productionBranch;
  const failed = kind === 'failed';

  const siteUrl = isProduction ? project.productionUrl : previewUrl(branch, workerName);
  const logsUrl = buildLogsUrl(event.metadata?.accountId, workerName, payload.buildUuid);
  const took = duration(payload.runningAt || payload.createdAt, payload.stoppedAt);
  const shortHash = (meta.commitHash || '').slice(0, 7);
  const commitLink = commitUrl(meta);
  const extraLinks = project.links.map(([label, path]) => `${label} — [Open →](${siteUrl}${path})`);

  let title, color, links;
  if (failed) {
    title = `🔴  Build failed · ${branch}`;
    color = COLORS.failed;
    links = `❌ Failed${took ? ` after ${took}` : ''}. [View logs →](${logsUrl})`;
  } else if (isProduction) {
    title = `🔵  Live on production · ${branch}`;
    color = COLORS.production;
    links = [`🔗 [${new URL(siteUrl).host}](${siteUrl}/)`, ...extraLinks].join('\n');
  } else {
    title = `🟢  Preview ready · ${branch}`;
    color = COLORS.preview;
    links = [`🔗 **Site** — [Open preview →](${siteUrl}/)`, ...extraLinks].join('\n');
  }

  const fields = [];
  if (shortHash) {
    fields.push({ name: 'Commit', value: commitLink ? `[\`${shortHash}\`](${commitLink})` : `\`${shortHash}\``, inline: true });
  }
  const author = authorName(meta.author);
  if (author) fields.push({ name: 'Author', value: author, inline: true });
  if (!failed) {
    if (took) fields.push({ name: 'Built in', value: took, inline: true });
    fields.push({ name: 'Logs', value: `[View build](${logsUrl})`, inline: true });
  }

  const message = firstLine(meta.commitMessage);
  const embed = {
    author: { name: project.name },
    title,
    url: failed ? logsUrl : `${siteUrl}/`,
    description: message ? `${message}\n\n${links}` : links,
    color,
    fields,
    footer: { text: 'Workers Builds' },
    timestamp: payload.stoppedAt || event.metadata?.eventTimestamp || undefined,
  };

  // Ping on previews and failures; a production deploy follows a merge you just
  // did, so it's posted quietly.
  const ping = userId && (failed || !isProduction);
  return {
    content: ping ? `<@${userId}>` : undefined,
    allowed_mentions: { users: ping ? [userId] : [] },
    embeds: [embed],
  };
}

export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const body = buildMessage(msg.body, env.DISCORD_USER_ID);
      if (!body) {
        msg.ack();
        continue;
      }
      if (!env.DISCORD_WEBHOOK_URL) {
        console.error('DISCORD_WEBHOOK_URL is not set; dropping build notification');
        msg.ack();
        continue;
      }
      try {
        const res = await fetch(env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          msg.ack();
        } else {
          console.error(`Discord webhook returned ${res.status}: ${await res.text()}`);
          // Rate limited or Discord hiccup: let the Queue redeliver later.
          msg.retry({ delaySeconds: res.status === 429 ? 10 : 30 });
        }
      } catch (err) {
        console.error('Discord webhook request failed', err);
        msg.retry({ delaySeconds: 30 });
      }
    }
  },
};
