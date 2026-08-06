(function () {
  function emit(event, payload) {
    try {
      if (window.__TAURI__ && window.__TAURI__.event) {
        window.__TAURI__.event.emit(event, payload);
      }
    } catch (e) {}
  }
  window.__pw = { emit: emit };
})();