# Connect an AI agent to a real browser (PC on your LAN) — MCP guide

Some devices can't run Chromium (no GPU, PRoot/sandboxed environments, blocked downloads).
Keep the AI model on API/cloud (no local models needed) and move only the **browser** to a
machine where it works — a PC or a CI runner. The agent talks to it via MCP.
LAN-only ports, never public DevTools endpoints, no credentials in URLs.

## Route A — Playwright MCP on the PC (recommended, vision support)

On the PC (Windows/macOS/Linux with Chrome installed):

```sh
npx @playwright/mcp@latest --port 8931 --host 0.0.0.0 --vision
```
(`--vision` = screenshot-based tools: the agent LOOKS at the rendering. Check your version
with `npx @playwright/mcp@latest --help`.)

In the MCP client of your choice (generic remote-server config — see `clienti-esempio.json`):

```json
"mcpServers": {
  "playwright-pc": {
    "type": "remote",
    "url": "http://PC-LAN-IP:8931/mcp"
  }
}
```
Restart the client: the agent will have `browser_*` tools (navigate, click, screenshot…).

Security: firewall → port 8931 only from the LAN; never expose it on the internet.
Outside your LAN use an SSH tunnel instead of opening ports.

## Route B — Chrome DevTools MCP + SSH tunnel (debug/profiling)

On the PC:
```sh
chrome.exe --remote-debugging-port=9222   # localhost only (safe default)
```
On the agent device:
```sh
ssh -L 9222:localhost:9222 user@PC-LAN-IP -N
```
Agent MCP config (local stdio):
```json
"chrome-devtools-via-tunnel": {
  "type": "local",
  "command": ["npx", "chrome-devtools-mcp@latest", "--browser-url", "http://127.0.0.1:9222"],
  "enabled": true
}
```
Playwright MCP can also attach to that Chrome: `--cdp-endpoint http://127.0.0.1:9222`.

## Spector.js — frame/shader/texture/draw-call analysis

- Automated tester: `--spettro` flag of `scripts/testa-ci.js` (injects Spector.js, captures
  one frame, saves draw calls and commands into report.json).
- Interactive MCP session: evaluate `mcp/spector-snippet.js` in the page, then call
  `spectorCapture()` → frame JSON.
- On the PC you can also use the Spector.js Chrome extension for manual inspection.

## Typical local blockers (documented, not retried)

- Chromium crashing at GPU-process startup on PRoot/sandboxed devices (e.g. SIGTRAP).
- Official browser downloads blocked by the network (HTTP 403).
- WebGL contexts reporting `GL_VENDOR/GL_RENDERER = Disabled` in restricted cloud browsers.
→ That's exactly why the browser runs on the PC/runner: real, verifiable rendering there.
