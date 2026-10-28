---
name: webgl-agent-eyes
description: Really SEE and test WebGL/Three.js games with real browser screenshots — on a GitHub Actions runner or a local/PC browser. Movement proof via pixel diff, input scenarios (taps, clicks, keys), console errors, off-screen elements, Spector.js frame capture. Use when asked to visually verify, screenshot, or test a WebGL game, or when local Chromium cannot run (no GPU, PRoot/sandbox, blocked downloads).
---

# WebGL Agent Eyes

Test WebGL games for real: a working browser renders the game, screenshots prove it,
and YOU look at the images. Never claim success from "context exists" or "no errors".
A Canvas 2D fallback is not a WebGL success.

## Choose the route

1. **Local browser broken** (no GPU, PRoot, HTTP 403 on browser download, GL Disabled):
   use the **GitHub Actions runner** (route CI below). Do not retry the local browser.
2. **Working browser available** (PC, normal Linux/macOS): run `scripts/testa-ci.js` locally.
3. **Interactive session with a real browser on a PC**: Playwright MCP `--vision`
   (see `mcp/README-MCP.md`), or this repo's MCP server (`mcp-server/`).

## Route CI (GitHub Actions)

```sh
gh workflow run test-webgl.yml -f game_repo=OWNER/GAME -f game_dir=. -f viewport=540x960
# private game repos need the GH_GAME_TOKEN secret (read-only PAT) in this repo
# private scenarios: -f scenario_inline="$(cat scenario.json)"  (nothing committed)
gh run watch
gh run download          # artifacts: screenshots + report.json + report.html
```
Then **open the PNG screenshots with your vision capability** and describe what you
actually see. Report results split into: automatic checks / visual verification /
not executed. Viewports: 360x640, 540x960 (9:16), 1280x720.

## Route local

```sh
npm i playwright && npx playwright install --with-deps chromium
pip install pillow
node scripts/testa-ci.js /path/to/game --vp 540x960 --scenario scenari/esempio.json
# add --spettro for Spector.js frame capture (draw calls, commands, stats)
```

## Rules of honesty (always)

- Rendering software (SwiftShader) is fine for seeing/verifying but **declare it**:
  it does not equal the player's GPU performance. Never quote its FPS as real-world.
- Two screenshots 2.5 s apart + pixel diff prove movement; still LOOK at the images.
- Steps you could not run (unknown coordinates/selectors, timeouts) go in "not executed".
- Never modify the game's design or code: scenarios only drive input and read the DOM.

## Scenario format

See `scenari/esempio.json`. Actions: `attendi` (ms), `screenshot` (nome), `clicca`
(selettore, optional `forza: true` for slow renderers), `tocca` (x, y — real tap, best
on slow software rendering), `tasto` (tasto), `assert-visibile` (selettore).
Mark uncalibrated steps with `da_tarare: true`.
