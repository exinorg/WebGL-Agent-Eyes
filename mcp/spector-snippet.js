/* Spector.js da sessione MCP: incolla nella pagina con il tool evaluate.
 * Poi chiama spectorCapture() → JSON con draw call, shader, texture del frame. */
(function () {
  if (window.spectorCapture) return "Spector già pronto: chiama spectorCapture()";
  const s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/spectorjs/dist/spector.bundle.js";
  s.onload = () => {
    window.spectorCapture = () => new Promise(res => {
      const sp = new SPECTOR.Spector();
      sp.captureNextFrame(document.querySelector("canvas"), true);
      sp.onCapture = cap => res({
        drawCalls: (cap.commands || []).length,
        comandi: (cap.commands || []).slice(0, 80).map(c => c.name),
        statistiche: cap.statistics || null,
      });
      setTimeout(() => res({ errore: "timeout: nessun frame catturato in 8s" }), 8000);
    });
  };
  document.head.appendChild(s);
  return "Spector in caricamento: tra 1s chiama spectorCapture()";
})();
