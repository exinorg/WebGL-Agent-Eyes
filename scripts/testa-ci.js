#!/usr/bin/env node
/* Tester WebGL per runner remoto (GitHub Actions / PC con browser vero).
 * Qui Chromium FUNZIONA: niente PRoot, niente SIGTRAP.
 *
 * Cosa fa (per davvero, non solo "il contesto esiste"):
 *  1. sonda WebGL e WebGL2 SEPARATAMENTE: versione + renderer effettivo
 *     (se il renderer è software — SwiftShader — lo DICHIARA nel report)
 *  2. apre il gioco nel viewport scelto (360x640, 540x960, 1280x720)
 *  3. scatta 2 screenshot a tempi diversi e calcola la differenza pixel:
 *     prova AUTOMATICA che gli oggetti si muovono
 *  4. esegue lo scenario JSON: tap/clic/tasti/screenshot dei momenti chiave
 *  5. raccoglie errori console + elementi fuori schermo
 *  6. scrive shots-ci/report.json + report.html con le immagini
 *
 * Uso:
 *   node scripts/testa-ci.js <cartella-gioco|url> [--vp 540x960] [--scenario scenari/x.json] [--out shots-ci] [--spettro]
 */
const { chromium } = require("playwright");
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const VP = { "360x640": [360, 640], "540x960": [540, 960], "1280x720": [1280, 720] };
const args = process.argv.slice(2);
const obiettivo = args[0];
const opt = { vp: "540x960", scenario: null, out: "shots-ci", spettro: false };
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--vp") opt.vp = args[i + 1];
  if (args[i] === "--scenario") opt.scenario = args[i + 1];
  if (args[i] === "--out") opt.out = args[i + 1];
  if (args[i] === "--spettro") opt.spettro = true;
}
const [LARG, ALTO] = VP[opt.vp] || VP["540x960"];
if (!obiettivo) { console.error("uso: node scripts/testa-ci.js <cartella|url> [--vp 540x960] [--scenario x.json]"); process.exit(1); }

const BASE = path.resolve(__dirname, "..");
fs.mkdirSync(path.join(BASE, opt.out), { recursive: true });

/* ---------------- scenario ---------------- */
const scenario = opt.scenario ? JSON.parse(fs.readFileSync(opt.scenario, "utf8")) : { nome: "base", passi: [] };
const esito = {
  nome: scenario.nome || "base",
  quando: new Date().toISOString(),
  viewport: opt.vp, larghezza: LARG, altezza: ALTO,
  rendering: null, gl: {}, automatici: [], visivi: [], non_eseguiti: [],
  erroriConsole: [], fuoriSchermo: [], spettro: null,
};
const reg = (tipo, cosa, ok, dettaglio) => (esito[tipo] || esito.automatici).push({ cosa, ok: !!ok, dettaglio: dettaglio || "" });

/* ---------------- server statico ---------------- */
let server = null, url = obiettivo;
if (fs.existsSync(obiettivo)) {
  const assoluto = path.resolve(obiettivo);
  const dir = fs.statSync(assoluto).isDirectory() ? assoluto : path.dirname(assoluto);
  const file = fs.statSync(assoluto).isDirectory() ? "" : "/" + path.basename(assoluto);
  server = spawn("python3", ["-m", "http.server", "8899", "--directory", dir, "--bind", "127.0.0.1"], { stdio: "ignore" });
  url = `http://127.0.0.1:8899${file}`;
}

/* screenshot con timeout lungo (SwiftShader lento) e mai fatale: se fallisce va in non_eseguiti */
async function shotSicura(pagina, file, cosa) {
  try { await pagina.screenshot({ path: file, timeout: 90000 }); return true; }
  catch (e) { reg("non_eseguiti", cosa || path.basename(file), false, "screenshot fallito: " + e.message.slice(0, 100)); return false; }
}

(async () => {
  const browser = await chromium.launch({
    channel: "chromium", // Chromium completo (non headless-shell): screenshot WebGL più affidabili
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu-watchdog"],
  });
  const pagina = await browser.newPage({ viewport: { width: LARG, height: ALTO }, hasTouch: true });
  pagina.on("pageerror", e => esito.erroriConsole.push("pageerror: " + e.message));
  pagina.on("console", m => {
    if (m.type() === "error") {
      const url = m.location() && m.location().url ? " · " + m.location().url.slice(0, 140) : "";
      esito.erroriConsole.push(("console: " + m.text().slice(0, 160) + url).slice(0, 300));
    }
  });

  await pagina.goto(url, { waitUntil: "load", timeout: 60000 });
  await pagina.waitForTimeout(2000);

  /* ---- 1. sonda GL separata ---- */
  esito.gl = await pagina.evaluate(() => {
    const sonda = (tipo) => {
      try {
        const c = document.createElement("canvas");
        const gl = c.getContext(tipo);
        if (!gl) return { ok: false };
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        return {
          ok: true,
          versione: gl.getParameter(gl.VERSION),
          vendor: gl.getParameter(gl.VENDOR),
          renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        };
      } catch (e) { return { ok: false, errore: e.message }; }
    };
    const g1 = sonda("webgl"), g2 = sonda("webgl2");
    const sw = /swiftshader|llvmpipe|software|ANGLE \(/i;
    return {
      webgl1: g1, webgl2: g2,
      renderingSoftware: sw.test((g1.renderer || "") + (g2.renderer || "")),
      nota: "SwiftShader = rendering SOFTWARE su CPU: valido per vedere e verificare la scena, NON per misurare le prestazioni reali su GPU del giocatore.",
    };
  });
  esito.rendering = esito.gl.renderingSoftware ? "SOFTWARE (SwiftShader su CPU)" : "GPU";
  reg("automatici", "WebGL1 disponibile", esito.gl.webgl1.ok, esito.gl.webgl1.versione || "");
  reg("automatici", "WebGL2 disponibile", esito.gl.webgl2.ok, esito.gl.webgl2.versione || "");
  reg("automatici", "Renderer effettivo", true, `${esito.gl.webgl1.renderer || "?"} · rendering ${esito.rendering}`);

  const canvasPresente = await pagina.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height) };
  });
  reg("automatici", "Canvas presente", !!canvasPresente, canvasPresente ? `${canvasPresente.w}x${canvasPresente.h} (css ${canvasPresente.cssW}x${canvasPresente.cssH})` : "nessun canvas nel DOM");

  /* ---- 2. prova MOVIMENTO: due screenshot a tempi diversi + differenza pixel ---- */
  const shotA = path.join(BASE, opt.out, "00-movimento-a.png");
  const shotB = path.join(BASE, opt.out, "00-movimento-b.png");
  const okA = await shotSicura(pagina, shotA, "screenshot movimento A");
  await pagina.waitForTimeout(2500);
  const okB = await shotSicura(pagina, shotB, "screenshot movimento B");
  let diff = null;
  if (okA && okB) {
    try {
      diff = JSON.parse(execSync(`python3 scripts/differenza.py "${shotA}" "${shotB}"`, { cwd: BASE, encoding: "utf8" }));
      reg("automatici", "Oggetti si muovono (2 screenshot a 2,5s di distanza)", diff.pixelDiversiPct > 0.5,
        `pixel diversi: ${diff.pixelDiversiPct}% ${diff.pixelDiversiPct > 0.5 ? "→ la scena è animata" : "→ FRAME STATICO: niente animazione visibile"}`);
    } catch (e) { reg("automatici", "Confronto movimento", false, String(e).slice(0, 120)); }
    reg("visivi", "00-movimento-a.png / 00-movimento-b.png", true, "VERIFICA VISIVA AGENTE/UMANO: guardare le immagini e confermare gli oggetti 3D.");
  }

  /* ---- 3. Spector.js (opzionale): cattura draw call/shader/texture di un frame ---- */
  if (opt.spettro) {
    try {
      await pagina.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/spectorjs/dist/spector.bundle.js" });
      esito.spettro = await pagina.evaluate(() => new Promise(res => {
        const s = new SPECTOR.Spector();
        s.captureNextFrame(document.querySelector("canvas"), true);
        s.onCapture = (cap) => {
          const lista = (cap.commands || []).slice(0, 60).map(c => c.name);
          res({ drawCalls: (cap.commands || []).length, comandi: lista, statistiche: cap.statistics || null });
        };
        setTimeout(() => res({ errore: "timeout cattura" }), 8000);
      }));
      reg("automatici", "Spector.js cattura frame", !esito.spettro.errore, `${esito.spettro.drawCalls || 0} draw call`);
    } catch (e) { esito.spettro = { errore: e.message.slice(0, 200) }; reg("non_eseguiti", "Spector.js", false, e.message.slice(0, 120)); }
  }

  /* ---- 4. scenario: passi ---- */
  for (const [i, p] of (scenario.passi || []).entries()) {
    const n = String(i + 1).padStart(2, "0");
    try {
      if (p.da_tarare) { reg("non_eseguiti", `${n} ${p.azione} ${p.selettore || p.tasto || (p.x + "," + p.y) || ""}`, false, "coordinate/selettore da tarare sul gioco reale"); continue; }
      switch (p.azione) {
        case "attendi": await pagina.waitForTimeout(+p.ms || 1000); break;
        case "screenshot": {
          const f = path.join(BASE, opt.out, `${n}-${p.nome || "passo"}.png`);
          if (await shotSicura(pagina, f, `${n}-${p.nome || "passo"}.png`))
            reg("visivi", path.basename(f), true, p.nota || "VERIFICA VISIVA: guardare l'immagine.");
          break;
        }
        case "clicca": await pagina.click(p.selettore, { timeout: p.forza ? 15000 : 5000, force: !!p.forza }); break;
        case "tocca": await pagina.touchscreen.tap(+p.x, +p.y); break;
        case "tasto": await pagina.keyboard.press(p.tasto); break;
        case "assert-visibile": {
          const vis = await pagina.isVisible(p.selettore);
          reg("automatici", `${n} visibile: ${p.selettore}`, vis, p.nota || "");
          break;
        }
        default: reg("non_eseguiti", `${n} azione sconosciuta: ${p.azione}`, false, "");
      }
    } catch (e) {
      reg("non_eseguiti", `${n} ${p.azione} ${p.selettore || ""}`, false, e.message.slice(0, 140));
    }
  }

  /* ---- 5. elementi fuori schermo ---- */
  esito.fuoriSchermo = await pagina.evaluate(() => {
    const w = innerWidth, h = innerHeight, fuori = [];
    for (const el of document.querySelectorAll("[id],[class]")) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.right < -2 || r.bottom < -2 || r.left > w + 2 || r.top > h + 2) {
        fuori.push(`${el.tagName.toLowerCase()}#${el.id || ""}.${(el.className + "").split(" ")[0]} rect=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        if (fuori.length >= 12) break;
      }
    }
    return fuori;
  });

  await browser.close();
  if (server) server.kill();

  /* ---- 6. report ---- */
  esito.sintesi = {
    webgl1: esito.gl.webgl1.ok, webgl2: esito.gl.webgl2.ok, rendering: esito.rendering,
    movimento: (esito.automatici.find(a => a.cosa.startsWith("Oggetti si muove")) || {}).ok,
    erroriConsole: esito.erroriConsole.length,
    passiOk: esito.automatici.filter(a => a.ok).length,
    passiNonEseguiti: esito.non_eseguiti.length,
  };
  fs.writeFileSync(path.join(BASE, opt.out, "report.json"), JSON.stringify(esito, null, 2));
  reportHtml();
  console.log(JSON.stringify(esito.sintesi, null, 2));
  process.exit(0);
})().catch(e => {
  console.error("ERRORE:", e.message);
  try {
    reg("non_eseguiti", "test interrotto", false, e.message.slice(0, 160));
    esito.sintesi = { interrotto: true, errore: e.message.slice(0, 200) };
    fs.writeFileSync(path.join(BASE, opt.out, "report.json"), JSON.stringify(esito, null, 2));
    reportHtml();
  } catch (e2) {}
  process.exit(1);
});

function reportHtml() {
  const shots = fs.readdirSync(path.join(BASE, opt.out)).filter(f => f.endsWith(".png")).sort();
  const img = shots.map(f => `<div class="card"><h3>${f}</h3><img src="${f}"></div>`).join("");
  const sec = (t, arr) => `<h2>${t}</h2><ul>${(arr || []).map(x => `<li class="${x.ok ? "ok" : "ko"}">${x.cosa}${x.dettaglio ? " — " + x.dettaglio : ""}</li>`).join("")}</ul>`;
  fs.writeFileSync(path.join(BASE, opt.out, "report.html"), `<!DOCTYPE html><meta charset="utf-8">
<title>Report WebGL — ${esito.nome}</title>
<style>body{background:#101826;color:#dfe9f5;font-family:system-ui;max-width:900px;margin:0 auto;padding:16px}
h1{font-size:20px} .card{display:inline-block;vertical-align:top;margin:8px;padding:8px;background:#1a2436;border-radius:12px}
.card img{max-width:270px;border-radius:8px} li.ok{color:#7fe0a7} li.ko{color:#ff9b9b} .sw{color:#ffd166}</style>
<h1>Report test WebGL — ${esito.nome} <small>(${esito.viewport} · ${new Date(esito.quando).toLocaleString("it-IT")})</small></h1>
<p class="sw">⚠️ Rendering: <b>${esito.rendering}</b> — ${esito.rendering.startsWith("SOFTWARE") ? "velocità NON rappresentative della GPU del giocatore" : "GPU reale"}</p>
${sec("Automatici", esito.automatici)}${sec("Verifica visiva (agente/umano guarda le immagini)", esito.visivi)}${sec("Non eseguiti / da tarare", esito.non_eseguiti)}
<h2>Errori console (${esito.erroriConsole.length})</h2><ul>${esito.erroriConsole.map(e => `<li class="ko">${e}</li>`).join("") || "<li>nessuno</li>"}</ul>
<h2>Elementi fuori schermo (${esito.fuoriSchermo.length})</h2><ul>${esito.fuoriSchermo.map(e => `<li>${e}</li>`).join("") || "<li>nessuno</li>"}</ul>
<h2>Screenshot</h2>${img}`, "utf-8");
}
