#!/usr/bin/env node
/* WebGL Agent Eyes — server MCP stdio (zero dipendenze, Node 18+).
 * Espone il tester WebGL a QUALUNQUE client MCP (Claude, Codex, Cursor, …).
 * Il browser gira sulla macchina dove parte questo processo: su dispositivi
 * senza GPU/Chromium funzionante usare invece la via GitHub Actions (vedi skill/).
 *
 * Config client (esempio):
 *   { "mcpServers": { "webgl-eyes": { "command": "node", "args": ["/path/mcp-server/server.js"] } } }
 */
"use strict";
const readline = require("readline");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const rl = readline.createInterface({ input: process.stdin });
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });

const TOOLS = [
  {
    name: "webgl_test",
    description: "Testa DAVVERO un gioco WebGL/Three.js in Chromium: sonda WebGL1/2 (renderer dichiarato), due screenshot con diff pixel (prova movimento), scenario di input (tap/clic/tasti), errori console con URL, elementi fuori schermo. Restituisce il report e i percorsi degli screenshot REALI da guardare con vision. Il browser deve funzionare sulla macchina ospite; altrimenti usa la via GitHub Actions.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Cartella/file html del gioco (servito in locale) oppure URL http(s)" },
        viewport: { type: "string", enum: ["360x640", "540x960", "1280x720"], description: "default 540x960" },
        scenario: { type: "string", description: "Percorso di uno scenario JSON (azioni: attendi/screenshot/clicca/tocca/tasto/assert-visibile). Opzionale" },
        spettro: { type: "boolean", description: "true = cattura un frame con Spector.js (draw call, comandi, statistiche)" }
      },
      required: ["target"]
    }
  },
  {
    name: "webgl_diff",
    description: "Differenza percentuale di pixel tra due screenshot PNG (prova che la scena si muove).",
    inputSchema: {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      required: ["a", "b"]
    }
  }
];

function esegui(cmd, args, { timeoutMs = 10 * 60 * 1000, cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd });
    let out = "", err = "";
    const to = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("timeout")); }, timeoutMs);
    p.stdout.on("data", d => out += d);
    p.stderr.on("data", d => err += d);
    p.on("error", e => { clearTimeout(to); reject(e); });
    p.on("close", code => { clearTimeout(to); resolve({ code, out, err }); });
  });
}

async function runTool(name, a) {
  if (name === "webgl_diff") {
    const r = await esegui("python3", [path.join(ROOT, "scripts/differenza.py"), a.a, a.b]);
    return r.out || r.err;
  }
  if (name === "webgl_test") {
    const out = "shots-mcp";
    const args = [path.join(ROOT, "scripts/testa-ci.js"), a.target, "--vp", a.viewport || "540x960", "--out", out];
    if (a.scenario) args.push("--scenario", a.scenario);
    if (a.spettro) args.push("--spettro");
    const r = await esegui(process.execPath, args);
    const reportPath = path.join(ROOT, out, "report.json");
    let testo = "";
    if (fs.existsSync(reportPath)) {
      const rep = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      const shots = fs.readdirSync(path.join(ROOT, out)).filter(f => f.endsWith(".png")).sort();
      testo = JSON.stringify({ sintesi: rep.sintesi, automatici: rep.automatici, non_eseguiti: rep.non_eseguiti, erroriConsole: (rep.erroriConsole || []).slice(0, 8) }, null, 1)
        + `\n\nSCREENSHOT REALI (guardarli con vision, non basta il JSON):\n` + shots.map(f => path.join(ROOT, out, f)).join("\n")
        + `\nReport HTML: ${path.join(ROOT, out, "report.html")}`;
    } else {
      testo = `Test fallito (exit ${r.code}).\n${r.out}\n${r.err}`.slice(0, 3000);
    }
    return testo;
  }
  throw new Error("tool sconosciuto: " + name);
}

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let m;
  try { m = JSON.parse(line); } catch { return; }
  try {
    if (m.method === "initialize")
      return reply(m.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "webgl-agent-eyes", version: "1.0.0" } });
    if (m.method === "notifications/initialized") return;
    if (m.method === "ping") return reply(m.id, {});
    if (m.method === "tools/list") return reply(m.id, { tools: TOOLS });
    if (m.method === "tools/call") {
      const { name, arguments: a } = m.params || {};
      try {
        const text = await runTool(name, a || {});
        return reply(m.id, { content: [{ type: "text", text }] });
      } catch (e) {
        return reply(m.id, { content: [{ type: "text", text: "ERRORE: " + e.message }], isError: true });
      }
    }
    if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "metodo non supportato: " + m.method } });
  } catch (e) {
    if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: e.message } });
  }
});
