/* Enquiry overlay.

   Rules, deliberately: never a gate, never on load. It opens on an explicit button, and at most
   once unprompted after real engagement — three distinct screens. Dismissing it means dismissed
   for the session. There is always a plain email address, because senior people just email.

   The demo runs offline from file:// by design, so a failed post is expected rather than
   exceptional: it degrades to showing the address instead of an error.

   One endpoint serves every Anvil demo; DEMO says which one this is, so we learn which domain
   actually pulls. */
(function () {
  var ENDPOINT = 'https://formspree.io/f/xbglqjkn';
  var DEMO = 'anvil-pump-durability-demo';
  var EMAIL = 'support@makkal.co';
  var AUTO_AFTER = 3;                 // distinct screens before it offers itself once

  var seen = {}, shownAuto = false, dismissed = false, el = null;

  function open() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'lead-wrap';
    el.innerHTML =
      '<div class="lead-card" role="dialog" aria-label="Talk to us">' +
        '<button class="lead-x" aria-label="Close">×</button>' +
        '<h3>Does your lab have this problem?</h3>' +
        '<p class="lead-sub">This is a demonstration, but the system behind it is real work. If you run ' +
        'test rigs whose software nobody can maintain any more, we would like to hear about it.</p>' +
        '<form class="lead-form">' +
          '<label>Name<input name="name" required autocomplete="name"></label>' +
          '<label>Work email<input name="email" type="email" required autocomplete="email"></label>' +
          '<label>Company<input name="company" autocomplete="organization"></label>' +
          '<label>What are you testing?<input name="testing" placeholder="pumps, valves, actuators, something else…"></label>' +
          '<label>What runs it today?<select name="runs_today">' +
            '<option value=""></option><option>PLC and panel HMI</option><option>LabVIEW</option>' +
            '<option>Bespoke software</option><option>Nothing yet</option><option>Not sure</option>' +
          '</select></label>' +
          '<p class="lead-priv">We use this only to reply to you, and we do not pass it on. ' +
          'Ask us to delete it at any time: <a href="mailto:' + EMAIL + '">' + EMAIL + '</a>.</p>' +
          '<div class="lead-foot">' +
            '<span class="lead-alt">Or just email <a href="mailto:' + EMAIL + '">' + EMAIL + '</a></span>' +
            '<button type="submit" class="btn primary">Send</button>' +
          '</div>' +
          '<p class="lead-msg" hidden></p>' +
        '</form>' +
      '</div>';

    el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
    el.querySelector('.lead-x').onclick = close;
    el.querySelector('.lead-form').onsubmit = submit;
    document.body.appendChild(el);
    el.querySelector('input[name=name]').focus();
  }

  function close() {
    dismissed = true;
    if (el) { el.remove(); el = null; }
  }

  function submit(e) {
    e.preventDefault();
    var form = e.target;
    var msg = form.querySelector('.lead-msg');
    var btn = form.querySelector('button[type=submit]');
    var data = new FormData(form);
    data.append('demo', DEMO);
    data.append('_subject', 'Anvil demo enquiry — ' + DEMO);

    btn.disabled = true;
    btn.textContent = 'Sending…';
    msg.hidden = true;

    fetch(ENDPOINT, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('rejected'); return r.json(); })
      .then(function () {
        form.innerHTML = '<p class="lead-ok"><b>Thank you — that reached us.</b><br>' +
          'We answer the same working day. If you would rather talk sooner, ' +
          '<a href="mailto:' + EMAIL + '">' + EMAIL + '</a>.</p>';
      })
      .catch(function () {
        // Offline, blocked, or the endpoint is down. Say so plainly and give the address.
        btn.disabled = false;
        btn.textContent = 'Send';
        msg.hidden = false;
        msg.innerHTML = 'That did not send — this demonstration may be running without a network. ' +
          'Please email <a href="mailto:' + EMAIL + '">' + EMAIL + '</a> and we will pick it up.';
      });
  }

  function track(screen) {
    if (dismissed || shownAuto || !screen) return;
    seen[screen] = 1;
    if (Object.keys(seen).length >= AUTO_AFTER) { shownAuto = true; open(); }
  }

  function mount() {
    var M = globalThis.M;
    if (!M || !M.ui) return;

    var btn = document.getElementById('hdrTalk');
    if (btn) btn.onclick = function () { dismissed = false; open(); };

    // #lead=1 opens it directly. For rehearsing a demo and for our own screenshots — it is an
    // explicit request in the URL, not the overlay putting itself in anyone's way.
    if (new URLSearchParams(location.hash.slice(1)).get('lead') === '1') open();

    // Offer it once after the visitor has actually looked around. Screens are changed through a
    // function private to app.js, so watch the shared state rather than trying to hook navigation.
    var dwell = 0;
    setInterval(function () {
      var app = document.getElementById('app');
      if (!app || app.hidden || dismissed || shownAuto || el) return;
      dwell += 1;
      try { track(M.ui.state && M.ui.state.screen); } catch (err) { /* never break the demo */ }
      // Someone who settles on one screen and reads it is interested too, so time counts as well
      // as navigation — but slowly, at four minutes, so it never feels like a pop-up.
      if (!shownAuto && dwell >= 240) { shownAuto = true; open(); }
    }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
