(function () {
  var DAY = 24 * 60 * 60 * 1000;
  var CUTOFF = 15 * DAY;
  var DBS = ['wa-db', 'user-data'];
  var BATCH = 200;
  var BATCHES = 5;
  var GAP = 1500;
  var running = false;

  function valueTime(v) {
    if (!v) return null;
    var t = v.t;
    if (typeof t === 'number') return t;
    if (t && typeof t === 'object' && typeof t.low === 'number') return t.low;
    var mt = v.messageTimestamp;
    if (typeof mt === 'number') return mt;
    if (mt && typeof mt === 'object' && typeof mt.low === 'number') return mt.low;
    return null;
  }

  function isTyping() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'textarea' || el.isContentEditable;
  }

  function prune() {
    if (running || document.hidden || isTyping()) return;
    running = true;
    var cut = Date.now() - CUTOFF;
    var index = 0;
    var done = 0;
    var pruned = 0;
    var db = null;

    function nextDB() {
      if (index >= DBS.length) { running = false; return; }
      var name = DBS[index++];
      var open = indexedDB.open(name);
      open.onupgradeneeded = function () { open.transaction.abort(); };
      open.onsuccess = function () {
        db = open.result;
        db.onversionchange = function () { db.close(); };
        if (!db.objectStoreNames.contains('message')) { db.close(); nextDB(); return; }
        pruneOne();
      };
      open.onerror = function () { running = false; };
    }

    function pruneOne() {
      if (!db) { nextDB(); return; }
      if (done >= BATCHES) { db.close(); db = null; nextDB(); return; }
      var tx;
      try { tx = db.transaction('message', 'readwrite'); } catch (e) { db.close(); nextDB(); return; }
      var store = tx.objectStore('message');
      var cursor = store.openCursor();
      var count = 0;
      var batchPruned = 0;
      cursor.onsuccess = function () {
        var c = cursor.result;
        if (!c || count >= BATCH) return;
        count++;
        var ts = valueTime(c.value);
        if (ts !== null) {
          var ms = ts > 1e12 ? ts : ts * 1000;
          if (ms < cut) { c.delete(); batchPruned++; }
        }
        c.continue();
      };
      cursor.onerror = function () {};
      tx.oncomplete = function () {
        done++;
        pruned += batchPruned;
        if (pruned > 0 && window.console) {
          console.log('PrivateWhatsapp retention: pruned ' + pruned + ' old messages');
        }
        setTimeout(pruneOne, GAP);
      };
    }

    setTimeout(nextDB, 0);
  }

  setTimeout(prune, 300000);
  setInterval(prune, 30 * 60 * 1000);
})();