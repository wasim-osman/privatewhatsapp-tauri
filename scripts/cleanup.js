(function () {
  var css = [
    '[data-testid="meta-ai-button"]',
    '[data-testid="desktopDownloadBanner"]',
    '[data-testid="call-audio"]',
    '[data-testid="call-video"]',
    '[data-testid="video-call"]',
    '#main [aria-label*="call" i]',
    '[aria-label="Meta AI"]'
  ].join(',') + '{display:none !important;visibility:hidden !important;pointer-events:none !important;}';
  var style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  var RES = [/get whatsapp for (mac|windows)/i];
  var TAGS = 'div,h1,h2,h3,h4,a,button,span,header,section,p';

  function matches(s) {
    for (var j = 0; j < RES.length; j++) if (RES[j].test(s)) return true;
    return false;
  }

  function hideTextPromo() {
    var els = document.querySelectorAll(TAGS);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.style && el.style.display === 'none') continue;
      if (el.children.length > 12) continue;
      var t = el.textContent || '';
      if (!matches(t)) continue;
      var parent = el.parentElement;
      while (parent && parent !== document.body && matches(parent.textContent || '') && (parent.textContent || '').length < 200) {
        el = parent;
        parent = el.parentElement;
      }
      el.style.display = 'none';
    }
  }
  hideTextPromo();
  setTimeout(hideTextPromo, 5000);

  var MENU_ITEMS = ['Send call link', 'New group call'];

  function hideCallMenuItems() {
    var menus = document.querySelectorAll('[role="menu"]');
    for (var m = 0; m < menus.length; m++) {
      var items = menus[m].querySelectorAll('[role="menuitem"], li');
      for (var i = 0; i < items.length; i++) {
        var li = items[i];
        if (li.style && li.style.display === 'none') continue;
        var t = (li.textContent || '').replace(/\s+/g, ' ').trim();
        var a = (li.getAttribute && li.getAttribute('aria-label') || '').trim();
        for (var j = 0; j < MENU_ITEMS.length; j++) {
          if (t === MENU_ITEMS[j] || t.indexOf(MENU_ITEMS[j]) !== -1 || a === MENU_ITEMS[j]) {
            li.style.display = 'none';
            break;
          }
        }
      }
    }
  }

  function watchCallMenu() {
    hideCallMenuItems();
    var target = document.body;
    if (!target) return;
    var mo = new MutationObserver(function () { hideCallMenuItems(); });
    mo.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] });
  }
  if (document.body) watchCallMenu();
  else document.addEventListener('DOMContentLoaded', watchCallMenu);
})();