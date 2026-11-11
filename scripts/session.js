(function () {
  // Login-state probe for diagnosing "it keeps asking for the QR code".
  // Reports only whether WhatsApp's login keys exist in localStorage (key
  // names, never values) and emits an event when that changes, so the app log
  // shows when the session was lost and what the app was doing around it.
  var LOGIN_KEYS = ['last-wid-md', 'last-wid'];
  var POLL = 15000;
  var HEARTBEAT = 30 * 60 * 1000;
  var lastState = null;
  var lastTick = Date.now();

  function keyNames() {
    try {
      var names = [];
      for (var i = 0; i < localStorage.length; i++) names.push(localStorage.key(i));
      return names;
    } catch (e) { return null; }
  }

  function loggedIn(names) {
    if (!names) return null;
    for (var i = 0; i < LOGIN_KEYS.length; i++) {
      if (names.indexOf(LOGIN_KEYS[i]) !== -1) return true;
    }
    return false;
  }

  function report(reason, names) {
    var now = Date.now();
    var out = {
      reason: reason,
      loggedIn: loggedIn(names),
      keys: names ? names.length : -1,
      // a large gap means the page was suspended (sleep / App Nap)
      gapSec: Math.round((now - lastTick) / 1000),
      visible: !document.hidden,
      online: navigator.onLine
    };
    lastTick = now;
    function send() { window.__pw && window.__pw.emit('session', JSON.stringify(out)); }
    try {
      if (navigator.storage && navigator.storage.persisted) {
        navigator.storage.persisted().then(function (p) { out.persisted = p; send(); }, send);
        return;
      }
    } catch (e) {}
    send();
  }

  function poll(reason) {
    var names = keyNames();
    var state = loggedIn(names);
    if (state !== lastState) {
      report(lastState === null ? 'start' : (state ? 'login' : 'LOGOUT'), names);
      lastState = state;
    } else if (reason) {
      report(reason, names);
    }
  }

  poll();
  setInterval(function () { poll(); }, POLL);
  setInterval(function () { poll('periodic'); }, HEARTBEAT);
  document.addEventListener('visibilitychange', function () { poll(document.hidden ? 'hidden' : 'visible'); });
  window.addEventListener('online', function () { poll('online'); });
  window.addEventListener('offline', function () { poll('offline'); });
  window.addEventListener('pagehide', function () { report('pagehide', keyNames()); });
})();
