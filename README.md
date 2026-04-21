# AI Usage Widget

Two small tools that show your **Claude Code** and **OpenAI Codex** usage in real time — Claude's session %, weekly limits (all models + Sonnet only) and Extra Usage spend, plus Codex's 5-hour and weekly limits — with live countdowns to each reset.

- A **terminal dashboard** (`get_usage.js`) that renders directly in your shell.
- A **floating desktop widget** (Electron) that stays on top of your windows. Includes a **system tray icon** with two live bars (Claude session % on top, weekly % on bottom) and a tooltip/menu showing the exact numbers for both providers.

No API keys, no tokens, no config files. It reuses the `claude` and `codex` CLI sessions you already have logged in. Codex is optional — if `codex` is not installed, that panel is simply skipped.

---

## Screenshots

**Terminal dashboard (`node get_usage.js`)**

![Terminal dashboard](script.png)

**Floating desktop widget (`npm start`)**

![Desktop widget](widget.png)

**System tray icon with live bars and tooltip**

![Tray icon](tray.png)

The tray icon sits next to the clock and draws two horizontal bars — Claude's session % on top and weekly % on bottom — so you can see your usage at a glance without opening the widget. Hovering (or right-clicking) shows the full breakdown for both Claude and Codex: session, weekly (all models), weekly (Sonnet), Codex 5-hour limit and Codex weekly.

---

## How it works (the simple version)

1. You already log in to Claude Code once with `claude`, and/or to Codex once with `codex`, in a terminal.
2. These tools spawn each CLI in a pseudo-terminal (via `node-pty`), type `/usage` (Claude) or `/status` (Codex), capture the rendered screen, and parse out the numbers.
3. Data is refreshed every N minutes (default 15, configurable — see below). Countdowns tick every second locally and force an immediate refresh the moment any of them reaches zero.

That's it — no scraping of APIs, no tokens handled by the app. If you can run `claude` and/or `codex` in your terminal, these tools work.

### Configuration

Edit `config.json` in the project root:

```json
{
  "refreshMinutes": 15
}
```

Both the terminal script and the widget (main + renderer) read this file at startup. Restart the tool after changing it.

---

## Setup

### 1. Install and log in to Claude Code (one time)

Install Claude Code following the official docs: https://docs.claude.com/claude-code

Then open a terminal and run:

```bash
claude
```

Complete the login flow. From this point on, the widget and the script work on their own — **you never need to log in again or paste any token into this project**.

### 2. Clone and install

```bash
git clone https://github.com/<your-user>/CC_usage_widget.git
cd CC_usage_widget
npm install
```

> Requires Node.js 18+. See [REQUIREMENTS.md](REQUIREMENTS.md) for details (including native-build toolchain notes for `node-pty`, if needed).

### 3a. Run the terminal dashboard

```bash
node get_usage.js
```

You'll see the ANSI dashboard above. `Ctrl+C` to exit.

### 3b. Run the floating desktop widget

```bash
npm start
```

An always-on-top frameless window appears in the top-right corner of your primary display, plus a tray icon next to the clock. The tray icon draws two horizontal bars (session % and weekly %), and the tooltip/right-click menu shows the exact numbers. Closing the widget window hides it to tray — use the tray's **Quit** entry to fully exit.

---

## Project layout

| File                | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `get_usage.js`      | Standalone terminal dashboard.                              |
| `fetcher.js`        | One-shot fetcher — runs `claude /usage` and prints JSON.    |
| `codexFetcher.js`   | One-shot fetcher — runs `codex /status` and prints JSON.    |
| `main.js`           | Electron main process; spawns both fetchers on a timer.     |
| `preload.js`        | Electron preload bridging IPC to the renderer.              |
| `renderer.js`       | Widget UI logic.                                            |
| `index.html`        | Widget markup.                                              |
| `styles.css`        | Widget styles.                                              |

---

## Notes / caveats

- Each refresh spawns `claude` for ~20–25 seconds in the background to capture the `/usage` screen. This is intentional and cheap, but you'll see a short-lived child process appear.
- The parser matches the current English `/usage` layout. If Anthropic changes the screen, the regexes in `fetcher.js` / `get_usage.js` may need a small update.
- Countdowns are computed against `America/Buenos_Aires` (UTC−3), matching where `/usage` reports resets. Tweak `parseResetDate()` if you need a different zone.

## License

MIT
