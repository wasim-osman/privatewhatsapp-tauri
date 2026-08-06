(function () {
  function dump(label) {
    try {
      var pane = document.querySelector('#pane-side');
      var main = document.querySelector('#main');
      var callBtns = [];
      var headerEls = document.querySelectorAll('#main [aria-label]');
      for (var hx = 0; hx < headerEls.length; hx++) {
        var lbl = headerEls[hx].getAttribute('aria-label') || '';
        if (/call/i.test(lbl)) {
          callBtns.push(lbl + ':' + (getComputedStyle(headerEls[hx]).display !== 'none' ? 'shown' : 'hidden'));
        }
      }
      var out = {
        label: label,
        readyState: document.readyState,
        href: location.href,
        bodyLen: document.body ? document.body.innerHTML.length : -1,
        app: !!document.querySelector('#app'),
        chatList: !!pane,
        chatListVisible: pane ? getComputedStyle(pane).display !== 'none' : false,
        mainVisible: main ? getComputedStyle(main).display !== 'none' : false,
        callBtns: callBtns
      };
      window.__pw && window.__pw.emit('debug', JSON.stringify(out));
    } catch (e) {}
  }
  dump('start');
  window.addEventListener('load', function () { setTimeout(function () { dump('load+3s'); }, 3000); });
  setInterval(function () { dump('tick'); }, 60000);
})();