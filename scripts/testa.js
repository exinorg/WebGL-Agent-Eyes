#!/usr/bin/env node
/* Tester WebGL/Three.js riutilizzabile — viewport verticali 9:16 e desktop.
 *
 * Uso:
 *   node scripts/testa.js <url|cartella|file.html> [--w 540] [--h 960] [--s 5] [--nome demo]
 *
 * Cosa fa (per davvero):
 *  1. apre Chromium headless (SwiftShader: rendering WebGL su CPU)
 *  2. misura: WebGL/WebGL2, renderer, FPS (contando i frame per N secondi), errori console
 *  3. salva lo screenshot REALE in shots/<nome>.png
 *  4. verifica i pixel dello screenshot con PIL (niente frame nero/vuoto)
 *  5. scrive shots/<nome>.json + aggiorna report.html
 */
const { chromium } = require("playwright");
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const obiettivo = args[0];
const VP = { "360x640": [360, 640], "540x960": [540, 960], "1280x720": [1280, 720] };
const opt = { w: 540, h: 960, s: 5, nome: "test" };
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--w") opt.w = +args[i + 1];
  if (args[i] === "--h") opt.h = +args[i + 1];
  if (args[i] === "--s") opt.s = +args[i + 1];
  if (args[i] === "--nome") opt.nome = args[i + 1];
  if (args[i] === "--vp") { const v = VP[args[i + 1]]; if (v) { opt.w = v[0]; opt.h = v[1]; } }
}
if (!obiettivo) { console.error("uso: node scripts/testa.js <url|cartella|file> [--w 540 --h 960 --s 5 --nome x]"); process.exit(1); }

const BASE = path.resolve(__dirname, "..");
let url = obiettivo, serverProc = null;
// se è una cartella o file locale, servo con http statico su una porta effimera
if (fs.existsSync(obiettivo)) {
  const assoluto = path.resolve(obiettivo);
  const dir = fs.statSync(assoluto).isDirectory() ? assoluto : path.dirname(assoluto);
  const file = fs.statSync(assoluto).isDirectory() ? "" : "/" + path.basename(assoluto);
  serverProc = spawn("python3", ["-m", "http.server", "0", "--directory", dir, "--bind", "127.0.0.1"], { stdio: ["ignore", "pipe", "ignore"] });
  url = null; // la porta la leggo dopo dallo stdout di http.server? (non la stampa) -> uso porta fissa libera
  serverProc.kill();
  // porta fissa: 8899 (tester dedicata)
  serverProc = spawn("python3", ["-m", "http.server", "8899", "--directory", dir, "--bind", "127.0.0.1"], { stdio: ["ignore", "ignore", "ignore"] });
  url = `http://127.0.0.1:8899${file || "/"}`;
}

(async () => {
  const browser = await chromium.launch({
    args: [
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--no-sandbox", "--disable-dev-shm-usage",
    ],
  });
  const pagina = await browser.newPage({ viewport: { width: opt.w, height: opt.h } });
  const errori = [];
  pagina.on("pageerror", e => errori.push("pageerror: " + e.message));
  pagina.on("console", m => { if (m.type() === "error") errori.push("console: " + m.text()); });

  await pagina.goto(url, { waitUntil: "load", timeout: 45000 });
  await pagina.waitForTimeout(1500);

  // FPS: conto i frame per --s secondi con un contatore rAF
  const fps = await pagina.evaluate((secondi) => new Promise(res => {
    let n = 0; const t0 = performance.now();
    (function p() { n++; if (performance.now() - t0 < secondi * 1000) requestAnimationFrame(p); else res(Math.round(n / ((performance.now() - t0) / 1000))); })();
  }), opt.s);

  const probe = await pagina.evaluate(() => window.__PROBE || null);
  const shot = path.join(BASE, "shots", opt.nome + ".png");
  await pagina.screenshot({ path: shot, fullPage: false });
  await browser.close();
  if (serverProc) serverProc.kill();

  // verifica pixel REALE dello screenshot con PIL (funziona per qualunque gioco)
  let pixel = null;
  try {
    pixel = JSON.parse(execSync(`python3 scripts/analizza.py "${shot}"`, { cwd: BASE, encoding: "utf8" }));
  } catch (e) { pixel = { errore: String(e).slice(0, 120) }; }

  const report = {
    obiettivo: url || obiettivo, formato: opt.w + "x" + opt.h, quando: new Date().toISOString(),
    fps, probe, errori: errori.slice(0, 10), screenshot: "shots/" + path.basename(shot), pixel,
    esito: (pixel && pixel.nonNeriPct > 2) || (probe && probe.pixelNonNeri > 0) ? "OGGETTI VISIBILI ✓" : "FRAME VUOTO/NERO ✗",
  };
  fs.writeFileSync(path.join(BASE, "shots", opt.nome + ".json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  generaReportHtml();
  process.exit(0);
})().catch(e => { console.error("ERRORE TESTER:", e.message); process.exit(1); });

function generaReportHtml() {
  try {
    const file = fs.readdirSync(path.join(BASE, "shots")).filter(f => f.endsWith(".json"));
    const righe = file.map(f => {
      const r = JSON.parse(fs.readFileSync(path.join(BASE, "shots", f), "utf8"));
      return `<div class="card"><h2>${f.replace(".json", "")} — ${r.esito}</h2>
        <img src="${r.screenshot}" style="max-width:270px;border-radius:12px">
        <pre>${JSON.stringify({ fps: r.fps, webgl: r.probe && r.probe.webgl2 ? "2" : (r.probe && r.probe.webgl ? "1" : "no"), renderer: r.probe && r.probe.renderer, pixel: r.pixel, errori: r.errori }, null, 1)}</pre></div>`;
    }).join("\n");
    fs.writeFileSync(path.join(BASE, "report.html"),
      `<!DOCTYPE html><html lang="it"><meta charset="utf-8"><title>Report test WebGL</title>
       <style>body{background:#101826;color:#dfe9f5;font-family:system-ui;max-width:1100px;margin:0 auto;padding:16px}
       .card{background:#1a2436;border-radius:14px;padding:12px;margin:10px 0;display:inline-block;vertical-align:top}
       h1{font-size:22px} h2{font-size:15px} pre{font-size:11px;color:#9fb4cc;max-width:300px;white-space:pre-wrap}</style>
       <h1>Report test WebGL/Three.js — Villaggio Tester</h1>
       <p>Render su CPU (SwiftShader): niente GPU sul tablet, ma il rendering è reale e visibile.</p>${righe}`, "utf-8");
  } catch (e) { /* report opzionale */ }
}
