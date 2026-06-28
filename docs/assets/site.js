// Shared site chrome behaviour. The only job today is the responsive top-nav:
// on narrow screens the links collapse behind a hamburger button. The button is
// injected here (rather than baked into every page's markup) so the nav HTML
// stays identical across pages and only needs this one script include.
(function () {
  'use strict';

  function init() {
    var inner = document.querySelector('.ppnav .ppnav-inner');
    var links = inner && inner.querySelector('.ppnav-links');
    if (!inner || !links) return;
    if (inner.querySelector('.ppnav-toggle')) return; // already wired

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ppnav-toggle';
    btn.setAttribute('aria-label', 'Toggle navigation menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="bar"></span>';
    // Place the toggle after the links so its margin-left:auto pins it right.
    inner.appendChild(btn);

    function setOpen(open) {
      links.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!links.classList.contains('open'));
    });
    // Close after picking a destination.
    links.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });
    // Close when tapping outside the header.
    document.addEventListener('click', function (e) {
      if (links.classList.contains('open') && !inner.contains(e.target)) setOpen(false);
    });
    // Close on Escape, and whenever we grow back to the desktop layout.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) setOpen(false);
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 880) setOpen(false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
