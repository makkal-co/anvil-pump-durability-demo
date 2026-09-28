/* First-run orientation.

   A visitor arriving from a link has no idea what this is. They land on a login card, wonder
   whether they need a password, guess their way in, and then face eight screens of an industrial
   HMI with no reason to click any particular one.

   So: once, on the first entry, offer the walkthrough. Once — declining is remembered for the
   session, and there is a Walkthrough button in the header for anyone who changes their mind. */
(function () {
  var offered = false;

  function card() {
    var el = document.createElement('div');
    el.className = 'ob-wrap';
    el.innerHTML =
      '<div class="ob-card">' +
        '<h3>First time here?</h3>' +
        '<p>This is a hydraulic pump endurance lab — eight test stands, four of them running. ' +
        'Everything you see is simulated and moving.</p>' +
        '<p class="ob-sub">The walkthrough takes about two minutes and points at the parts worth ' +
        'looking at. You can stop it at any time.</p>' +
        '<div class="ob-foot">' +
          '<button class="btn ob-no">I’ll look around myself</button>' +
          '<button class="btn primary ob-yes">Start the walkthrough</button>' +
        '</div>' +
      '</div>';
    var close = function () { el.remove(); };
    el.querySelector('.ob-no').onclick = close;
    el.querySelector('.ob-yes').onclick = function () {
      close();
      var M = globalThis.M;
      if (M && M.tour && M.tour.start) M.tour.start(0);
    };
    el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
    document.body.appendChild(el);
  }

  function mount() {
    // A rehearsal link that names a screen is somebody who already knows their way around, so it
    // stays out of their way. Anything else is a first-time visitor.
    var q = new URLSearchParams(location.hash.slice(1));
    if (q.get('screen') || q.get('tour') || q.get('noob') === '1') return;

    // Watch for the app becoming visible rather than wrapping navigation: the screens are changed
    // through a function private to app.js, so there is nothing to hook.
    var t = setInterval(function () {
      var app = document.getElementById('app');
      if (!app || app.hidden) return;
      clearInterval(t);
      if (offered) return;
      offered = true;
      // A moment after the app has painted, so the card lands on something rather than nothing.
      setTimeout(card, 500);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
