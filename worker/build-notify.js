// Cloudflare Worker: Discord build notifications
//
// Workers Builds publishes an event to a Queue whenever a build of the site
// Worker (kapkit-cs2overlay) starts, succeeds, fails or is cancelled. This
// Worker consumes that Queue and posts a Discord message for the ones worth
// knowing about:
//   • preview build succeeded (any branch but main) → green, links + @mention
//   • production build succeeded (main)             → blue, links, no mention
//   • build failed (any branch)                     → red, logs link + @mention
// Started / cancelled builds are ignored.
//
// It has no fetch handler — nothing calls it over HTTP; the Queue invokes it.
//
// Setup (see worker/README.md for details):
//   1. Create the Queue and subscribe it to the site Worker's build events.
//   2. Deploy this Worker:
//        wrangler deploy --config wrangler.notify.toml
//   3. Add the secrets:
//        wrangler secret put DISCORD_WEBHOOK_URL --config wrangler.notify.toml
//        wrangler secret put DISCORD_USER_ID --config wrangler.notify.toml

// The site Worker whose builds we report on; events for any other Worker on the
// account are acked and dropped.
const SITE_WORKER = 'kapkit-cs2overlay';
const PRODUCTION_BRANCH = 'main';
const PRODUCTION_URL = 'https://cs2widget.kapkit.ca';
// Branch previews live at <branch-slug>-<worker>.<subdomain>.workers.dev.
const WORKERS_DEV_SUBDOMAIN = 'sid-kapahi.workers.dev';

const COLORS = {
  preview: 0x2ecc71, // green
  production: 0x3b82f6, // blue
  failed: 0xe74c3c, // red
};

// Cloudflare turns the branch name into the preview name by lowercasing it and
// replacing anything outside [a-z0-9] with '-' (e.g. claude/youthful-gauss-9f3jia
// → claude-youthful-gauss-9f3jia). A DNS label is at most 63 characters, so the
// slug is capped to leave room for "-<worker>".
function previewSlug(branch) {
  const max = 63 - SITE_WORKER.length - 1;
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

function previewUrl(branch) {
  return `https://${previewSlug(branch)}-${SITE_WORKER}.${WORKERS_DEV_SUBDOMAIN}`;
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

function buildLogsUrl(accountId, buildUuid) {
  return `https://dash.cloudflare.com/${accountId}/workers/services/view/${SITE_WORKER}/production/builds/${buildUuid}`;
}

// Turns one Workers Builds event into a Discord webhook body, or null when the
// event isn't one we notify on.
export function buildMessage(event, userId) {
  const kind = event?.type?.split('.').pop(); // started | succeeded | failed | canceled
  if (event?.source?.workerName !== SITE_WORKER) return null;
  if (kind !== 'succeeded' && kind !== 'failed') return null;

  const payload = event.payload || {};
  const meta = payload.buildTriggerMetadata || {};
  const branch = meta.branch || 'unknown';
  const isProduction = branch === PRODUCTION_BRANCH;
  const failed = kind === 'failed';

  const siteUrl = isProduction ? PRODUCTION_URL : previewUrl(branch);
  const logsUrl = buildLogsUrl(event.metadata?.accountId, payload.buildUuid);
  const took = duration(payload.runningAt || payload.createdAt, payload.stoppedAt);
  const shortHash = (meta.commitHash || '').slice(0, 7);
  const commitLink = commitUrl(meta);

  let title, color, links;
  if (failed) {
    title = `🔴  Build failed · ${branch}`;
    color = COLORS.failed;
    links = `❌ Failed${took ? ` after ${took}` : ''}. [View logs →](${logsUrl})`;
  } else if (isProduction) {
    title = `🔵  Live on production · ${branch}`;
    color = COLORS.production;
    links = `🔗 [cs2widget.kapkit.ca](${siteUrl}/)   🎮 [OBS overlay](${siteUrl}/widget/)`;
  } else {
    title = `🟢  Preview ready · ${branch}`;
    color = COLORS.preview;
    links = `🔗 **Customizer** — [Open preview →](${siteUrl}/)\n🎮 **OBS overlay** — [Open widget →](${siteUrl}/widget/)`;
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
    title,
    url: failed ? logsUrl : `${siteUrl}/`,
    description: message ? `${message}\n\n${links}` : links,
    color,
    fields,
    footer: { text: `${SITE_WORKER} · Workers Builds` },
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
