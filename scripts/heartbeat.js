(function () {
  function beat() {
    window.__pw && window.__pw.emit('heartbeat', { at: Date.now() });
  }
  beat();
  setInterval(beat, 15000);
})();