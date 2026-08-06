(function () {
  var banner = null;

  function ensureBanner() {
    if (banner) return banner;
    var div = document.createElement('div');
    div.id = 'pw-incoming-call';
    div.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:99999;background:#00a884;color:#fff;' +
      'font:600 14px -apple-system,Segoe UI,sans-serif;text-align:center;padding:9px 12px;' +
      'pointer-events:none;display:none;';
    div.textContent = 'Incoming call — answer on another device';
    (document.body || document.documentElement).appendChild(div);
    banner = div;
    return div;
  }

  function check() {
    var accept = document.querySelector('[aria-label^="Accept"]');
    var decline = document.querySelector('[aria-label^="Decline"]');
    var incoming = !!(accept && decline);
    if (incoming) {
      var b = ensureBanner();
      b.style.display = 'block';
    } else if (banner) {
      banner.style.display = 'none';
    }
  }
  check();
  setInterval(check, 5000);
})();