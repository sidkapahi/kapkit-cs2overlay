// Cloudflare Worker: Discord build notifications
//
// Workers Builds publishes an event to a Queue whenever a build of a subscribed
// Worker starts, succeeds, fails or is cancelled. This Worker consumes that
// Queue and posts a Discord message for the ones worth knowing about:
//   • preview build succeeded (non-production branch) → "Preview Ready" + @mention
//   • production build succeeded                      → "Live", no mention
//   • build failed (any branch)                       → "Build Failed" + @mention
// Started / cancelled builds are ignored.
//
// Each message is an embed (project name + icon, commit title and body, Status
// / Branch / Release / Logs fields, a preview image) plus link buttons under it.
//
// It works for any Worker on the account: to add a project, subscribe the Queue
// to that Worker's builds in the dashboard, and give it an entry in PROJECTS
// below for its own Discord channel, name, icon, image and links.
//
// It has no fetch handler — nothing calls it over HTTP; the Queue invokes it.
// Setup steps are in worker/README.md.

const NOTIFIER_VERSION = '1.2';

// Every Worker on the account is served from <worker>.<subdomain>, and branch
// previews from <branch-slug>-<worker>.<subdomain>.
const WORKERS_DEV_SUBDOMAIN = 'sid-kapahi.workers.dev';

// Shared by every project unless its PROJECTS entry overrides it.
const DEFAULTS = {
  footer: `build-notify v${NOTIFIER_VERSION}  |  kapKit`,
  footerIcon: 'https://upload.wikimedia.org/wikipedia/commons/9/94/Cloudflare_Logo.png',
  colors: {
    preview: 0x4eb754, // green
    production: 0x3b82f6, // blue
    failed: 0xe74c3c, // red
  },
};

// Per-project settings, keyed by Worker name. Everything is optional; a Worker
// with no entry still gets messages in the default channel, titled with its
// Worker name and linking to its workers.dev URLs.
//   name             — embed author line (default: the Worker name)
//   icon             — image URL shown next to the name
//   image            — large image URL at the bottom of the embed
//   productionUrl    — custom domain (default: https://<worker>.<subdomain>)
//   productionBranch — default 'main'
//   webhook          — name of the Worker secret holding this project's Discord
//                      webhook URL, so each project can post to its own channel
//                      (default: DISCORD_WEBHOOK_URL)
//   username         — override the webhook's display name for this project
//   avatar           — override the webhook's avatar for this project
//   color            — { preview, production, failed } embed colours
//   footer           — footer text; footerIcon — footer icon URL
//   buttons          — extra link buttons after the main one: [label, path],
//                      path relative to the site being linked
const PROJECTS = {
  'kapkit-cs2overlay': {
    name: 'CS2 Overlay Widget',
    icon: 'https://cs2widget.kapkit.ca/favicon.png',
    image: 'https://i.postimg.cc/bwXFwx4t/CS2-Stats-Overlay-Preview.png',
    productionUrl: 'https://cs2widget.kapkit.ca',
    webhook: 'DISCORD_WEBHOOK_CS2',
    buttons: [['🎮 OBS overlay', '/widget/']],
  },
};

function projectFor(workerName) {
  const p = PROJECTS[workerName] || {};
  return {
    worker: workerName,
    name: p.name || workerName,
    icon: p.icon,
    image: p.image,
    productionUrl: p.productionUrl || `https://${workerName}.${WORKERS_DEV_SUBDOMAIN}`,
    productionBranch: p.productionBranch || 'main',
    webhook: p.webhook,
    username: p.username,
    avatar: p.avatar,
    colors: { ...DEFAULTS.colors, ...p.color },
    footer: p.footer || DEFAULTS.footer,
    footerIcon: p.footerIcon || DEFAULTS.footerIcon,
    buttons: p.buttons || [],
  };
}

// The project's own webhook secret, falling back to the shared one.
export function webhookFor(workerName, env) {
  const { webhook } = projectFor(workerName);
  return (webhook && env[webhook]) || env.DISCORD_WEBHOOK_URL;
}

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

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Splits a commit message into a title (first line) and body (the rest, minus
// git trailers like "Co-Authored-By:" and "Signed-off-by:").
export function splitCommitMessage(message) {
  const lines = (message || '').replace(/\r/g, '').split('\n');
  const title = lines.shift().trim();
  while (lines.length && /^\s*$|^[A-Za-z][\w-]*: /.test(lines[lines.length - 1])) lines.pop();
  return { title, body: lines.join('\n').trim() };
}

function githubRepo(meta) {
  if (meta.providerType !== 'github' || !meta.providerAccountName || !meta.repoName) return null;
  return `https://github.com/${meta.providerAccountName}/${meta.repoName}`;
}

function buildLogsUrl(accountId, worker, buildUuid) {
  return `https://dash.cloudflare.com/${accountId}/workers/services/view/${worker}/production/builds/${buildUuid}`;
}

// Reads "version" from package.json at the built commit, for the Release field.
// Only works for public GitHub repos; anything else just leaves the field out.
export async function fetchRelease(event) {
  const meta = event?.payload?.buildTriggerMetadata || {};
  if (meta.providerType !== 'github' || !meta.providerAccountName || !meta.repoName || !meta.commitHash) return null;
  const root = (meta.rootDirectory || '').replace(/^\/+|\/+$/g, '');
  const path = root ? `${root}/package.json` : 'package.json';
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${meta.providerAccountName}/${meta.repoName}/${meta.commitHash}/${path}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const { version } = await res.json();
    return version && version !== '0.0.0' ? `v${version}` : null;
  } catch {
    return null;
  }
}

// Turns one Workers Builds event into a Discord webhook body, or null when the
// event isn't one we notify on. `release` is the version string (or null).
export function buildMessage(event, userId, release = null) {
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
  const repo = githubRepo(meta);

  const status = failed ? 'Build Failed' : isProduction ? 'Live' : 'Preview Ready';
  const color = failed ? project.colors.failed : isProduction ? project.colors.production : project.colors.preview;

  const fields = [
    { name: 'Status', value: status, inline: true },
    { name: 'Branch', value: repo ? `[${branch}](${repo}/tree/${encodeURI(branch)})` : branch, inline: true },
  ];
  if (release) fields.push({ name: 'Release', value: release, inline: true });
  fields.push({ name: 'Logs', value: `[View Build](${logsUrl})`, inline: true });

  const { title, body } = splitCommitMessage(meta.commitMessage);
  const embed = {
    author: {
      name: project.name,
      url: `${project.productionUrl}/`,
      ...(project.icon && { icon_url: project.icon }),
    },
    title: clip(title || `${status} · ${branch}`, 256),
    url: failed ? logsUrl : `${siteUrl}/`,
    ...(body && { description: clip(body, 1000) }),
    color,
    fields,
    ...(project.image && !failed && { image: { url: project.image } }),
    footer: { text: project.footer, ...(project.footerIcon && { icon_url: project.footerIcon }) },
    timestamp: payload.stoppedAt || event.metadata?.eventTimestamp || undefined,
  };

  // Link buttons under the embed: the site first, then the project's extras.
  const button = (label, url) => ({ type: 2, style: 5, label, url });
  const buttons = failed
    ? [button('📄 View logs', logsUrl)]
    : [
        button(isProduction ? '▶️ Live site' : '▶️ Preview', `${siteUrl}/`),
        ...project.buttons.map(([label, path]) => button(label, `${siteUrl}${path}`)),
      ];

  // Ping on previews and failures; a production deploy follows a merge you just
  // did, so it's posted quietly.
  const ping = userId && (failed || !isProduction);
  return {
    content: ping ? `<@${userId}>` : undefined,
    allowed_mentions: { users: ping ? [userId] : [] },
    ...(project.username && { username: project.username }),
    ...(project.avatar && { avatar_url: project.avatar }),
    embeds: [embed],
    components: [{ type: 1, components: buttons.slice(0, 5) }],
  };
}

// Plain (non-bot) webhooks only accept link buttons when asked to.
function withComponents(webhookUrl) {
  const url = new URL(webhookUrl);
  url.searchParams.set('with_components', 'true');
  return url.toString();
}

export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const event = msg.body;
      const workerName = event?.source?.workerName;
      if (!buildMessage(event)) {
        msg.ack();
        continue;
      }
      const webhookUrl = webhookFor(workerName, env);
      if (!webhookUrl) {
        console.error(`No Discord webhook set for ${workerName}; dropping build notification`);
        msg.ack();
        continue;
      }
      const body = buildMessage(event, env.DISCORD_USER_ID, await fetchRelease(event));
      const post = (url, payload) =>
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      try {
        let res = await post(withComponents(webhookUrl), body);
        if (res.status === 400) {
          // If Discord rejects the buttons, still get the embed through.
          console.error(`Discord rejected the message with buttons: ${await res.text()}`);
          res = await post(webhookUrl, { ...body, components: undefined });
        }
        if (res.ok) {
          msg.ack();
        } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          // A malformed message won't get better by retrying.
          console.error(`Discord webhook returned ${res.status}: ${await res.text()}`);
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
