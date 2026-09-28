// App frame: login, ribbon, stand rail, status bar, routing, simulation loop, demo menu.
(function (M) {
  const ui = M.ui, $ = ui.$, esc = ui.esc, S = ui.state;

  const RIBBON = [
    ['overview', 'Lab Overview'],
    ['setups', 'Test Setups'],
    ['manual', 'Manual Control'],
    ['graph', 'Live Trend'],
    ['alarms', 'Alarms'],
    ['data', 'Run History'],
    ['config', 'Stand Config'],
  ];
  const NEEDS_RACK = { graph: 1, manual: 1, alarms: 1, config: 1 };

  // M1: a cell computer shows only its own stands; the remote view shows the lot.
  // The question a lab asks: "why are we showing every stand if this station only drives two?"
  // scope.cell = the cell this station stands in; null = lab-wide (remote or an office machine).
  const scope = M.scope = { cell: 2, only: false };
  M.inScope = (r) => scope.cell == null || r.cell === scope.cell;
  M.scopeRacks = () => M.sim.stands.filter(M.inScope);
  // scope.only is the architecture question in GUI-Mockup-v0.1.md section 4 made visible:
  // Option A, one instance per cell that knows nothing of the rest of the lab, against
  // Option B, our recommendation, where a station watches every stand and drives its own.
  // It changes what the UI shows, never what it may command - that stays with the
  // controller's command handler.
  M.visRacks = () => (scope.only ? M.scopeRacks() : M.sim.stands);

  // ---- Login -------------------------------------------------------------
  function renderLogin() {
    $('#loginUser').innerHTML = M.USERS.map((u) => `<option value="${u.u}" ${u.role === 'Engineer' ? 'selected' : ''}>${u.u} — ${u.role}</option>`).join('');
    const c = { running: 0, idle: 0, offline: 0, stopped: 0 };
    M.sim.stands.forEach((r) => { const k = ['shutdown', 'stopped'].includes(r.status) ? 'stopped' : r.status === 'complete' ? 'idle' : r.status; c[k]++; });
    $('#loginSum').innerHTML = `
      <div class="row">
        <span><i class="led ok"></i>${c.running} running</span>
        <span><i class="led idle"></i>${c.idle} idle</span>
        <span><i class="led bad"></i>${c.stopped} stopped</span>
        <span><i class="led off"></i>${c.offline} offline</span>
      </div>
      <div class="muted">Tests keep running on each stand controller while nobody is logged in.</div>`;
  }
  $('#loginForm').onsubmit = (e) => {
    e.preventDefault();
    S.user = M.USERS.find((u) => u.u === $('#loginUser').value);
    $('#login').hidden = true;
    $('#app').hidden = false;
    document.body.classList.remove('pre-login');
    go('overview', null);
  };
  $('#hdrLogout').onclick = () => {
    S.user = null;
    M.tour && M.tour.stop();
    $('#app').hidden = true;
    document.body.classList.add('pre-login');
    renderLogin();
    $('#login').hidden = false;
  };

  // ---- Navigation --------------------------------------------------------
  function go(screen, rackId) {
    if (rackId !== undefined) S.rackId = rackId;
    if (NEEDS_RACK[screen] && !S.rackId) S.rackId = 3;
    if (screen === 'overview') S.rackId = rackId === undefined ? S.rackId : rackId;
    S.screen = screen;
    $('#tip').hidden = true;
    renderFrame();
    const root = $('#screen');
    root.innerHTML = '';
    root.scrollTop = 0;
    ui.screens[screen].render(root);
    ui.syncPanes();
  }
  ui.go = go;

  function renderFrame() {
    const r = ui.rack();
    const vis = M.visRacks(), cells = new Set(vis.map((x) => x.cell)).size;
    $('#hdrCtx').textContent = S.screen === 'overview' ? `· ${M.scope.only ? 'Bay ' + M.scope.cell : 'Lab overview'} — ${cells} bay${cells === 1 ? '' : 's'}, ${vis.length} stands` : S.screen === 'setups' ? '· Test setup library' : r ? `· ${r.name}${r.setup ? ' · ' + r.setup.name + '_Rev' + r.setup.rev : ''}` : '';
    $('#hdrUser').innerHTML = `<b>${esc(S.user.u)}</b> (${S.user.role})`;
    const sc = $('#hdrScope');
    if (sc) sc.innerHTML = M.scope.cell == null
      ? '<b>Lab-wide station</b> · watch every stand · stop only'
      : `<b>Bay ${M.scope.cell} station</b> · drives ${M.scopeRacks().map((x) => x.name.replace('Stand ', '')).join(', ')} · ${M.scope.only ? '<b>sees its own bay only</b> (Option A)' : 'watches all (Option B)'}`;
    $('#ribbon').innerHTML = RIBBON.map(([id, label, soon]) => `<button data-s="${id}" class="${S.screen === id ? 'on' : ''}">${label}${soon ? '<span class="soon">batch 2</span>' : ''}</button>`).join('');
    ui.$$('#ribbon button').forEach((b) => (b.onclick = () => go(b.dataset.s)));
    renderRail();
    renderLive();
  }

  function renderRail() {
    let html = `<div class="item ${S.screen === 'overview' && !S.rackId ? 'on' : ''}" data-r="0" title="Lab overview"><i class="led ok"></i><span class="rn">Lab overview</span></div>`;
    let cell = 0;
    M.visRacks().forEach((r) => {
      if (r.cell !== cell) { cell = r.cell; html += `<div class="cell" title="Bay ${cell}"><span class="cw">Bay ${cell}</span><span class="cn">C${cell}</span></div>`; }
      const st = ui.rackState(r);
      const viewOnly = !M.inScope(r);
      html += `<div class="item ${S.rackId === r.id && S.screen !== 'setups' ? 'on' : ''} ${viewOnly ? 'vo' : ''}" data-r="${r.id}" data-num="${r.id}" ${viewOnly ? 'title="Another bay — this station can watch it and stop it, but not drive it"' : ''}><i class="led ${st.led}" data-led="${r.id}"></i><span class="rn">${r.name}</span>${viewOnly ? '<span class="vomark" title="view + stop only from this station">◐</span>' : ''}<span class="sub" data-sub="${r.id}">${st.text}</span></div>`;
    });
    // The rail's collapse control sits at the bottom and stays there in both states.
    $('#rail').innerHTML = `<div class="items">${html}</div>
      <div class="pchdr" data-pane="rail">${ui.paneBtn('rail', 'left')}<span class="pcname">Stands</span></div>`;
    $('#rail').onclick = (e) => ui.panePick(e);
    ui.$$('#rail .item').forEach((el) => (el.onclick = () => {
      const id = +el.dataset.r;
      if (!id) return go('overview', null);
      go(['overview', 'setups'].includes(S.screen) ? 'graph' : S.screen, id);
    }));
  }

  // Cheap per-tick refresh of frame elements (no re-render, keeps focus)
  function renderLive() {
    $('#hdrClock').textContent = ui.clock(M.sim.now);
    M.sim.stands.forEach((r) => {
      const st = ui.rackState(r);
      const led = $(`[data-led="${r.id}"]`); if (led) led.className = 'led ' + st.led;
      const sub = $(`[data-sub="${r.id}"]`); if (sub) sub.textContent = st.text;
    });
    // Alarm ribbon button blinks for the selected stand (red wins over yellow)
    const r = ui.rack();
    const ab = $('#ribbon [data-s="alarms"]');
    if (ab) {
      const bl = r ? M.sim.blink(r) : M.sim.stands.map(M.sim.blink).reduce((a, b) => (a === 'R' || b === 'R' ? 'R' : a || b), null);
      ab.classList.toggle('blinkR', bl === 'R');
      ab.classList.toggle('blinkY', bl === 'Y');
    }
    const mb = $('#ribbon [data-s="manual"]');
    if (mb) mb.classList.toggle('blinkR', !!(r && r.status === 'poweroff'));
    renderStatus();
  }

  function renderStatus() {
    const r = ui.rack();
    const el = $('#status');
    if (!r || S.screen === 'overview' || S.screen === 'setups') {
      const n = (f) => M.visRacks().filter(f).length;
      el.innerHTML = `<span><i class="led ok"></i>${n((x) => x.status === 'running')} running</span>
        <span><i class="led idle"></i>${n((x) => ['idle', 'complete'].includes(x.status))} idle</span>
        <span><i class="led bad"></i>${n((x) => ['stopped', 'shutdown', 'poweroff'].includes(x.status))} stopped</span>
        <span><i class="led off"></i>${n((x) => x.status === 'offline')} offline</span>
        <span class="muted" style="margin-left:auto">Simulated data · demonstration only</span>`;
      return;
    }
    const st = ui.rackState(r);
    if (r.status === 'offline') {
      el.innerHTML = `<span><i class="led off"></i><b>${st.text}</b></span><span>${esc(r.reason)}</span>`;
      return;
    }
    if (r.status === 'manual' || r.status === 'poweroff') {
      el.innerHTML = `<span><i class="led ${st.led}"></i><b>${st.text}</b></span>
        <span>${r.status === 'manual' ? 'Driven by ' + esc(r.manual.user) + ' · interlocks active' : 'Safety relay open · reset at the cell'}</span>
        <span>Stand power <b>${r.power ? 'ON' : 'OFF'}</b></span>
        <span style="margin-left:auto"><i class="led ok"></i>cRIO link OK</span>`;
      return;
    }
    const el2 = M.sim.elapsed(r);
    const loc = r.status === 'running' ? r.loc : r.stoppedLoc;
    const total = r.setup ? M.prof.total(r.setup) : 0;
    const unacked = r.alarms.filter((a) => a.state === 'ACTIVE').length;
    el.innerHTML = `<span><i class="led ${st.led}"></i><b>${st.text}</b></span>
      ${r.setup ? `<span title="${esc(M.prof.pathText(loc))}">${esc(M.prof.pathText(loc)).slice(0, 90)}</span>
      <span>Elapsed <b class="num">${ui.hours(el2)}</b></span>
      <span>Remaining <b class="num">${ui.hours(Math.max(0, total - el2))}</b></span>` : '<span class="muted">No test loaded</span>'}
      <span>Log ${r.status === 'running' && loc && !loc.done ? (loc.leaf.logHz || r.setup.logHz) + ' Hz' : '—'}</span>
      ${unacked ? `<span class="badge ${M.sim.blink(r) === 'R' ? 'bad' : 'warn'}">${unacked} unacknowledged</span>` : ''}
      <span style="margin-left:auto"><i class="led ok"></i>cRIO link OK</span>`;
  }

  // ---- Header controls ---------------------------------------------------
  $('#hdrSpeed').onchange = (e) => (M.sim.speed = +e.target.value);
  $('#hdrDemo').onclick = (e) => {
    const r3 = M.sim.rack(3);
    ui.menu(e.currentTarget, [
      { hint: 'Demo controls — not part of the product' },
      { label: 'Stand 3: inject discharge over-temperature', onClick: () => { M.sim.injectFault(r3, 'dispT') ? ui.toast('Discharge air temperature rising on Stand 3 — watch yellow, then red') : ui.toast('Stand 3 is not running'); go('graph', 3); } },
      { label: 'Stand 3: braking resistor trip', onClick: () => { M.sim.injectFault(r3, 'brake') ? ui.toast('Red alarm — software shutdown sequence running') : ui.toast('Stand 3 is not running'); go('overview', null); } },
      { label: 'Selected rack: press safety reset button in cell', onClick: () => { const r = ui.rack(); if (r && M.sim.pressCellReset(r)) ui.toast(`${r.name}: safety relay re-armed by hand`); else ui.toast('Select a stand whose power is off'); go(S.screen); } },
      '-',
      { label: 'Open remote web view (as seen from home) ▸', onClick: () => M.remote.open() },
      { label: M.scope.only ? 'Architecture: Option B — multi-stand shell, watches the whole lab' : 'Architecture: Option A — one instance per cell, sees its two stands only',
        onClick: () => {
          if (M.scope.cell == null) M.scope.cell = 2;
          M.scope.only = !M.scope.only;
          if (!M.inScope(ui.rack() || { cell: -1 })) S.rackId = (M.scopeRacks()[0] || {}).id || null;
          ui.toast(M.scope.only
            ? `Option A — a bay ${M.scope.cell} station that knows only stands ${M.scopeRacks().map((x) => x.name.replace('Stand ', '')).join(' and ')}`
            : 'Option B — one shell, watches every stand, drives its own bay (our recommendation)');
          go(M.scope.only && S.screen === 'overview' ? 'overview' : S.screen);
        } },
      { label: M.scope.cell == null ? 'Stand at: the bay 2 station' : 'Stand at: an office PC (no bay — stop only)', onClick: () => { M.scope.cell = M.scope.cell == null ? 2 : null; if (!M.inScope(ui.rack() || { cell: -1 })) S.rackId = (M.scopeRacks()[0] || {}).id || null; ui.toast(M.scope.cell == null ? 'Lab-wide view — every stand' : `Bay ${M.scope.cell} station — its stands only`); go(S.screen); } },
      '-',
      { label: 'Speed: real time', onClick: () => setSpeed(1) },
      { label: 'Speed: ×60 (1 s = 1 min)', onClick: () => setSpeed(60) },
      { label: 'Speed: ×600 (1 s = 10 min)', onClick: () => setSpeed(600) },
    ]);
  };
  function setSpeed(v) { M.sim.speed = v; $('#hdrSpeed').value = String(v); }
  $('#hdrTour').onclick = () => M.tour.start(0);

  // ---- Main loop ---------------------------------------------------------
  M.sim.init();
  renderLogin();

  // Deep link for rehearsing a demo, e.g. index.html#user=eng.demo&screen=setups&tab=th&tour=8
  const q = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  if (q.user) {
    S.user = M.USERS.find((u) => u.u === q.user) || M.USERS[2];
    $('#login').hidden = true;
    $('#app').hidden = false;
    if (q.speed) setSpeed(+q.speed);
    if (q.fault) M.sim.injectFault(M.sim.rack(3), q.fault);
    if (q.tab && ui.setupsTab) ui.setupsTab(q.tab);
    if (q.cfg) ui.configTab(q.cfg);
    if (q.scope) M.scope.cell = q.scope === 'lab' ? null : +q.scope;
    if (q.only === '1') M.scope.only = true;          // #only=1 opens in the Option A shape
    if (q.run) ui.dataOpen(q.run);
    if (q.manual) {
      const mr = M.sim.rack(+q.manual);
      M.sim.cmd(mr, 'MANUAL_ENTER', 'LOCAL', S.user.u);
      [['motor', 900], ['boostPump', 60], ['coolFan', 50], ['loadValve', 30], ['tankHeater', 1]].forEach(([key, val]) => M.sim.cmd(mr, 'SET_OUTPUT', 'LOCAL', S.user.u, { key, val }));
    }
    if (q.hard) M.sim.cmd(M.sim.rack(+q.hard), 'HARD_STOP', 'LOCAL', S.user.u);
    go(q.screen || 'overview', q.rack ? +q.rack : q.screen === 'overview' ? null : undefined);
    if (q.tour) M.tour.start(+q.tour - 1);
    if (q.try) q.try.split(',').forEach((c) => M.sim.cmd(M.sim.rack(3), c, 'REMOTE', S.user.u, c === 'START' ? M.setupById('end2000') : undefined));
    if (q.remote) M.remote.open();
  }
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    M.sim.tick(Math.min(1000, now - last));
    last = now;
    if (!S.user) return;
    M.remote.tick();
    renderLive();
    const scr = ui.screens[S.screen];
    if (scr && scr.tick) scr.tick();
  }, 250);
})(globalThis.M = globalThis.M || {});
