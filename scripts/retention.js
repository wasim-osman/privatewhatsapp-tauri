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
    var pruned = 0;
    var db = null;
    var done = 0;
    var resumeKey = null; // continue after the last scanned key, so each batch makes progress

    function finish() {
      if (db) { try { db.close(); } catch (e) {} db = null; }
      running = false;
    }

    function nextDB() {
      if (index >= DBS.length) { finish(); return; }
      var name = DBS[index++];
      done = 0;
      resumeKey = null;
      var open;
      try { open = indexedDB.open(name); } catch (e) { nextDB(); return; }
      open.onupgradeneeded = function () {
        // database did not exist: never create it, just abort
        open.transaction.abort();
      };
      open.onsuccess = function () {
        db = open.result;
        db.onversionchange = function () { db.close(); };
        if (!db.objectStoreNames.contains('message')) { db.close(); db = null; nextDB(); return; }
        pruneOne();
      };
      open.onerror = function () { nextDB(); };
      open.onblocked = function () { nextDB(); };
    }

    function endDB() {
      if (db) { try { db.close(); } catch (e) {} db = null; }
      nextDB();
    }

    function pruneOne() {
      if (!db || done >= BATCHES) { endDB(); return; }
      if (document.hidden || isTyping()) { finish(); return; }
      var tx;
      try { tx = db.transaction('message', 'readwrite'); } catch (e) { endDB(); return; }
      var store = tx.objectStore('message');
      var range = resumeKey === null ? null : IDBKeyRange.lowerBound(resumeKey, true);
      var cursor = store.openCursor(range);
      var count = 0;
      var batchPruned = 0;
      var exhausted = false;
      var lastKey = null;
      cursor.onsuccess = function () {
        var c = cursor.result;
        if (!c) { exhausted = true; return; }
        if (count >= BATCH) return;
        count++;
        lastKey = c.key;
        var ts = valueTime(c.value);
        if (ts !== null) {
          var ms = ts > 1e12 ? ts : ts * 1000;
          if (ms < cut) { c.delete(); batchPruned++; }
        }
        c.continue();
      };
      cursor.onerror = function () {};
      tx.onabort = tx.onerror = function () { endDB(); };
      tx.oncomplete = function () {
        done++;
        pruned += batchPruned;
        if (batchPruned > 0 && window.console) {
          console.log('PrivateWhatsapp retention: pruned ' + pruned + ' old messages');
        }
        if (exhausted || lastKey === null) { endDB(); return; }
        resumeKey = lastKey;
        setTimeout(pruneOne, GAP);
      };
    }

    setTimeout(nextDB, 0);
  }

  setTimeout(prune, 300000);
  setInterval(prune, 30 * 60 * 1000);
})();
