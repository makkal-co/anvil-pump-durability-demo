// Shared UI helpers: state, permissions, formatting, modal, dropdown menu.
(function (M) {
  const ui = (M.ui = {
    state: { user: null, rackId: null, screen: 'overview' },
    screens: {},
  });

  ui.$ = (sel, root) => (root || document).querySelector(sel);
  ui.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  ui.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ROLE_RANK = { Viewer: 0, Operator: 1, Engineer: 2, Maintenance: 3 };
  const NEED = { run: 1, ack: 1, stop: 1, clear: 1, edit: 2, manual: 2, cal: 3, fault: 0 };
  ui.can = (action) => ui.state.user && ROLE_RANK[ui.state.user.role] >= NEED[action];

  ui.rack = () => (ui.state.rackId ? M.sim.rack(ui.state.rackId) : null);

  // One list of "channels I am watching", shared by Live Trend and the Manual Control trend,
  // so a technician does not curate two different selections.
  M.watch = { sel: ['tankT', 'hxInT', 'dispT', 'drvBrgT'], MAX: 8 };
  M.watchToggle = (ch) => {
    const i = M.watch.sel.indexOf(ch);
    if (i >= 0) M.watch.sel.splice(i, 1);
    else if (M.watch.sel.length < M.watch.MAX) M.watch.sel.push(ch);
    else { ui.toast(`Maximum ${M.watch.MAX} channels on one graph`); return false; }
    return true;
  };

  // A station is LOCAL to the stands in its own cell and REMOTE to every other rack: it can watch
  // the whole lab but only drive what stands next to it. One rule, enforced by the stand.
  M.originFor = (r) => (M.inScope(r) ? 'LOCAL' : 'REMOTE');
  // Every local UI action goes through the controller command interface
  ui.cmd = (r, cmd, arg) => {
    const res = M.sim.cmd(r, cmd, M.originFor(r), ui.state.user.u, arg);
    if (!res.ok) ui.toast(res.note);
    return res.ok;
  };

  ui.fmt = (chId, v) => (v == null || isNaN(v) ? '—' : v.toFixed(M.chById[chId].dp));
  ui.fmtU = (chId, v) => ui.fmt(chId, v) + ' ' + M.chById[chId].unit;
  ui.clock = (t) => {
    const d = new Date(t);
    return d.toISOString().slice(0, 10) + ' ' + d.toTimeString().slice(0, 8);
  };
  ui.hours = (sec) => {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return `${h.toLocaleString()} h ${String(m).padStart(2, '0')} m`;
  };

  // Rack status → {led class, badge class, text}
  ui.rackState = (r) => {
    const blink = M.sim.blink(r);
    const map = {
      running: ['ok', 'run', 'RUNNING'],
      idle: ['idle', 'idle', 'IDLE'],
      offline: ['off', 'off', r.legacy ? 'NOT MIGRATED' : 'OFFLINE'],
      shutdown: ['bad', 'bad', 'SHUTTING DOWN'],
      stopped: ['bad', 'bad', 'STOPPED'],
      complete: ['idle', 'idle', 'COMPLETE'],
      manual: ['warn', 'warn', 'MANUAL'],
      poweroff: ['bad', 'bad', 'POWER OFF'],
    };
    const [led, badge, text] = map[r.status];
    return { led: blink === 'R' ? 'bad blinkR' : blink === 'Y' && r.status === 'running' ? 'warn' : led, badge, text, blink };
  };

  // ---- Modal -------------------------------------------------------------
  ui.modal = ({ title, body, buttons }) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="box"><div class="mh">${ui.esc(title)}</div><div class="mb">${body}</div><div class="mf"></div></div>`;
    const close = () => wrap.remove();
    (buttons || [{ label: 'Close' }]).forEach((b) => {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || '');
      el.textContent = b.label;
      el.onclick = () => { if (!b.onClick || b.onClick(wrap) !== false) close(); };
      wrap.querySelector('.mf').appendChild(el);
    });
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    return wrap;
  };

  // ---- Dropdown menu -----------------------------------------------------
  ui.menu = (anchor, items) => {
    ui.$$('.menu').forEach((m) => m.remove());
    const m = document.createElement('div');
    m.className = 'menu';
    items.forEach((it) => {
      const d = document.createElement('div');
      if (it === '-') d.className = 'sep';
      else if (it.hint) { d.className = 'hint'; d.textContent = it.hint; }
      else { d.textContent = it.label; d.onclick = () => { m.remove(); it.onClick(); }; }
      m.appendChild(d);
    });
    const rc = anchor.getBoundingClientRect();
    m.style.top = rc.bottom + 4 + 'px';
    m.style.left = Math.max(8, Math.min(window.innerWidth - 280, rc.left)) + 'px';
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener('mousedown', function off(e) {
      if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); }
    }), 0);
  };

  // ---- Collapsible side panes --------------------------------------------
  // Every screen puts its lists down the side. On a laptop that leaves the part the
  // operator came to read - the step grid, the trend - squeezed into what is left.
  // Each pane collapses to a strip it can be re-opened from; the rail keeps its LEDs
  // so a collapsed rail still shows the lab at a glance.
  const PANES = {
    rail: 'Stands', lib: 'Saved setups', gv: 'Channels',
    al: 'Alarm detail', runs: 'Runs', ch: 'Channels',
  };
  ui.paneOpen = (name) => !document.body.classList.contains('pc-' + name);
  // Expanded: a chevron in the pane header. Collapsed: the whole strip is the control,
  // with the pane's name running down it, so nobody has to find a small arrow again.
  ui.paneBtn = (name, side) => {
    const open = ui.paneOpen(name);
    const g = (side === 'right') === open ? '»' : '«';
    return `<button class="pchev" data-pane="${name}" title="${open ? 'Collapse' : 'Expand'} ${PANES[name]}">${g}</button>${
      open ? '' : `<span class="pcname" data-pane="${name}">${PANES[name]}</span>`}`;
  };
  ui.panePick = (e) => {
    const b = e.target.closest('[data-pane]');
    if (!b) return false;
    document.body.classList.toggle('pc-' + b.dataset.pane);
    ui.go(ui.state.screen);
    return true;
  };
  ui.paneAll = (collapse) => {
    Object.keys(PANES).forEach((k) => document.body.classList.toggle('pc-' + k, collapse));
    ui.go(ui.state.screen);
  };
  // A pane carries the class that collapses it; which one it is comes from its own chevron,
  // so a new pane needs no wiring beyond including ui.paneBtn().
  ui.syncPanes = () => ui.$$('.pane').forEach((el) => {
    const b = el.querySelector('.pchev[data-pane]');
    if (!b) return;
    const closed = !ui.paneOpen(b.dataset.pane);
    el.classList.toggle('pc', closed);
    // A collapsed pane is meant to be clickable anywhere, so the strip itself carries the
    // name. Without this only the button and the label responded and a click on the bare
    // part of the strip did nothing at all.
    const hdr = el.querySelector('.pchdr');
    if (hdr) { if (closed) hdr.dataset.pane = b.dataset.pane; else delete hdr.dataset.pane; }
  });
  ui.panesCollapsed = () => Object.keys(PANES).every((k) => !ui.paneOpen(k));

  ui.toast = (text) => {
    const t = document.createElement('div');
    t.className = 'tip';
    t.style.cssText = 'left:50%;bottom:44px;transform:translateX(-50%);';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  };
})(globalThis.M = globalThis.M || {});
