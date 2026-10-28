# WebGL Agent Eyes — plugin per agenti (Skill + server MCP)

Due modi per usare il tester dal tuo agente preferito. Il modello resta via API/cloud:
cambia solo dove gira il browser (macchina ospite del processo, runner CI o PC in LAN).

## 1. Skill (SKILL.md)

Copia la cartella `skill/` del repo nelle skills del client, con nome `webgl-agent-eyes`:

```sh
# Claude Code
mkdir -p ~/.claude/skills/webgl-agent-eyes && cp skill/SKILL.md ~/.claude/skills/webgl-agent-eyes/
# Cursor
mkdir -p ~/.cursor/skills/webgl-agent-eyes && cp skill/SKILL.md ~/.cursor/skills/webgl-agent-eyes/
# Altri client con skills: stessa copia nella loro cartella skills
# Codex CLI: niente skills → usa il server MCP (sotto) o copia i comandi in AGENTS.md
```
La skill insegna all'agente: scegliere la via (CI/locale/PC), lanciare i test, scaricare
gli artifact, GUARDARE gli screenshot e riportare automatici/visivi/non eseguiti.

## 2. Server MCP (tools `webgl_test` e `webgl_diff`)

Nessuna dipendenza: solo Node 18+. Il browser gira dove parte il server.

**Claude Code**
```sh
claude mcp add webgl-eyes -- node /percorso/WebGL-Agent-Eyes/mcp-server/server.js
```
**Cursor** — `.cursor/mcp.json`:
```json
{ "mcpServers": { "webgl-eyes": { "command": "node", "args": ["/percorso/WebGL-Agent-Eyes/mcp-server/server.js"] } } }
```
**Codex CLI** — `~/.codex/config.toml`:
```toml
[mcp_servers.webgl-eyes]
command = "node"
args = ["/percorso/WebGL-Agent-Eyes/mcp-server/server.js"]
```
**Qualsiasi altro client MCP**: stessa coppia command/args (vedi `mcp/clienti-esempio.json`).

Prerequisiti sulla macchina del server: `npm i playwright && npx playwright install
--with-deps chromium` e `pip install pillow`. Se lì il browser non può funzionare
(niente GPU, PRoot, download bloccati), usa la via GitHub Actions descritta nella skill.
