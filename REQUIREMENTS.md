# Requirements

## System
- **OS:** Windows, macOS or Linux
- **Node.js:** 18 or newer (20+ recommended)
- **Claude Code CLI** installed and logged in — see https://docs.claude.com/claude-code
  - After installing, run `claude` once in a terminal and complete the login flow.
  - The widget/script reuse that login — no API key is ever stored in this project.

## Node dependencies
Installed automatically by `npm install`:

- `node-pty` ^1.0.0 — spawns `claude` in a pseudo-terminal so it renders the `/usage` screen.
- `electron` ^33 (dev) — runtime for the floating desktop widget.

## Build toolchain (only if `npm install` fails on `node-pty`)
`node-pty` is a native module. If prebuilt binaries are not available for your platform, you will need:

- **Windows:** Visual Studio Build Tools (Desktop development with C++) and Python 3.
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Linux:** `build-essential` and `python3`.
