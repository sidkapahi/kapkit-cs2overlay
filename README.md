<div align="center">

<img src="assets/header.png?v=2" alt="CS2 Stats Overlay" width="100%" />

# CS2 Stats Overlay

A free OBS / StreamElements overlay that shows your CS2 Premier rating, rank badge, <br/> stats, and recent match history live on stream — powered by the Leetify API.

[![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![built with TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/sidkapahi/cs2-stats-overlay/pulls)

<br/>

<a href="https://cs2widget.kapkit.ca/?utm_source=github&utm_medium=README+Button"><img src="assets/create-overlay-button.svg" alt="Use Overlay" height="54"></a>

<br/>

**[How-To Guide](#how-to-guide)** · **[Report a Bug](https://github.com/sidkapahi/cs2-stats-overlay/issues)**

</div>

---

## Overview

A clean stats card that stays up to date on its own. Point it at your Steam
profile, pick what to show, and drop the URL into OBS, Streamlabs, or
StreamElements. Stats come live from [Leetify](https://leetify.com) and refresh
automatically — no software to run, no account to make here.

> [!TIP]
> **✨ New features**
> - **FACEIT support** — show FACEIT ELO and skill level
> - **Live tracking on Kick & YouTube** — not just Twitch
> - **HS% and ADR** added to the stats you can show

**What viewers see:**

- **Premier rating** with a **rank badge**, or a plain rank-coloured number
- **Rank-point change** from your last match (e.g. `+250`)
- **Win / loss pills** and stats: win rate, aim rating, K/D
- **Recent match history** (W / L / T)
- **Live session W/L** (optional, Twitch / YouTube / Kick)
- **Transparent background**

Everything's toggleable.

## How-To Guide

Nothing to install — the hosted customizer builds your URL.

### Before you start

Pick a source — **Premier** (via Leetify) or **FACEIT**. Use either, or both.

**Everyone:** your **Steam profile link** or Steam64 ID. FACEIT stats are looked
up from the same profile.

**For Premier:** a [Leetify](https://leetify.com) account linked to Steam, plus a
matchmaking share code so it syncs matches:

1. Get your Authentication Code from
   [Steam](https://help.steampowered.com/en/wizard/HelpWithGameIssue?appid=730&issueid=128)
2. Enter it on Leetify's [Data Sources](https://leetify.com/app/data-sources)
   page under the **Matchmaking** tab

**For FACEIT:** a [FACEIT](https://www.faceit.com) account linked to the same
Steam account — no Leetify needed. Flip the **FACEIT** toggle in the customizer.

### Create your overlay

1. Open the **[customizer](https://cs2widget.kapkit.ca/)**
2. Paste your **Steam profile link** or Steam64 ID (can be found on [SteamID I/O](https://steamid.io/))
3. Pick your source with the **PREMIER / FACEIT** toggle — same Steam profile either way:
   - **Premier** — CS Rating, rank badge, K/D, AIM, win %
   - **FACEIT** — FACEIT ELO, skill level, K/D, ADR, HS%, win rate, and (for Challenger players) your leaderboard position
4. Toggle what to show — avatar/flag, name, rank badge/dial, rank/ELO change, stats, match history
5. Set how many recent matches to show and how often it refreshes
6. *(Optional)* For a per-stream win/loss, switch the Win/Loss source to **Live Session** and add a profile link (Twitch, YouTube, or Kick)
7. Copy the generated **widget URL** (or download the StreamElements bundle — see below)

### Add it to OBS/Streamlabs OBS

1. Add a new **Browser Source**
2. Paste your widget URL
3. Set the size to about **660 × 180** (adjust to taste)

That's it — the overlay refreshes on its own.

### Add it to StreamElements

Use the **Download Zip for StreamElements** button under the widget URL. It
builds a **Custom Widget** bundle (`widget.html`, `widget.css`, `widget.js`,
`fields.json`, `data.json`, plus `widget-url.txt` and `README.txt`). Paste each
file into its matching tab in the Custom Widget editor (HTML / CSS / JS / FIELDS
/ DATA). Fields come pre-filled and stay editable **inside StreamElements** —
Steam ID, toggles, stats, font, background — so you can tweak it there without
returning to the customizer.

### Live session win/loss (optional)

By default the W/L pills tally every match in Leetify's recent window. Paste a
**Twitch, YouTube, or Kick link** and they become a **per-stream record**:

- Resets to `W0 L0` when your channel **goes live**
- Counts only matches finished **during that stream**
- **Freezes** the last stream's record when you go **offline**

The platform is detected from the link. Your session is saved in the browser, so
refreshing the OBS source mid-stream doesn't lose it. It only reads the
**public** "is this channel live?" status — you never log in.

> Relies on a small per-platform proxy the project owner hosts. If yours isn't
> available, the pills fall back to the rolling-window behaviour.

## Query Parameters

To hand-craft the URL, the widget accepts:

| Parameter    | Default | Description                        |
| ------------ | ------- | ---------------------------------- |
| `steamId`    | —       | Steam64 ID (required)              |
| `live`       | —       | `<platform>:<channel>` → session-scoped W/L (e.g. `twitch:kapowhi`, `youtube:@handle`, `kick:slug`) |
| `twitch`     | —       | Legacy Twitch login (still accepted; equivalent to `live=twitch:<login>`) |
| `avatar`     | `1`     | Show avatar (`0` to hide)          |
| `name`       | `1`     | Show player name                   |
| `badge`      | `0`     | Show in-game styled rank badge (`1`) instead of the plain number |
| `change`     | `1`     | Show rank-point change (+/-)       |
| `stats`      | `1`     | Show WIN%, AIM, K/D                 |
| `history`    | `1`     | Show W/L/T match history            |
| `matchCount` | `10`    | Number of recent matches           |
| `refresh`    | `60`    | Refresh interval in seconds        |

## For Developers

Local dev, self-hosting, the optional Cloudflare Workers, analytics, and env
vars are in **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**; the analytics event
reference is in **[docs/ANALYTICS.md](docs/ANALYTICS.md)**.

> [!NOTE]
> **Built with [Claude Code](https://claude.com/claude-code) from a [Figma](https://www.figma.com) design, with security in mind.**
> No login, no accounts, nothing personal to hand over — a static site that only
> reads your **public** CS2 stats. [PRs are very welcome](https://github.com/sidkapahi/cs2-stats-overlay/pulls)!

## License

[MIT](LICENSE) © Sid
