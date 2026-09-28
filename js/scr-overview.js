// Lab overview: one tile per stand, online and offline, with live key values.
(function (M) {
  const ui = M.ui, esc = ui.esc;
  const KEY = ['speed', 'tankT', 'hxInT', 'dispT', 'sysP', 'caseP'];
  let root, n = 0;

  function level(r, ch) {
    const l = r.lvl[ch] || 0;
    return l === 2 ? 'bad' : l === 1 ? 'warn' : '';
  }

  function tile(r) {
    const st = ui.rackState(r);
    const head = `<div class="th"><i class="led ${st.led}"></i><b>${r.name}</b><span class="muted">Bay ${r.cell}</span><span class="sp"></span><span class="badge ${st.badge}">${st.text}</span></div>`;

    if (r.status === 'offline') {
      return `<div class="tile offline">${head}
        <div class="body-off" style="grid-row: span 2">
          <div><b>${esc(r.reason)}</b></div>
          ${r.lastSeen ? `<div>Last seen ${ui.clock(r.lastSeen).slice(5, 16)} · ${((M.sim.now - r.lastSeen) / 3.6e6).toFixed(1)} h ago</div>` : ''}
          ${r.legacy ? '<div>Scheduled for a later roll-out phase. Not visible to this system until migrated.</div>' : '<div>Rack controller unreachable. A running test continues on the controller if it is powered; data back-fills on reconnect.</div>'}
        </div>
        <div class="tf"><span class="msg muted">${r.legacy ? 'Legacy rig' : 'Check network / controller power'}</span></div></div>`;
    }

    const vals = KEY.map((ch) => `<div><span>${M.chById[ch].name.replace('temperature', 'T').replace('System pressure', 'System P')}</span><span class="num ${level(r, ch) ? 'badge ' + level(r, ch) : ''}">${ui.fmtU(ch, r.v[ch])}</span></div>`).join('');

    let sub = '', prog = '', foot = '', body = `<div class="vals">${vals}</div>`;
    if (r.setup && ['running', 'shutdown', 'stopped', 'complete'].includes(r.status)) {
      const total = M.prof.total(r.setup), el = Math.min(total, M.sim.elapsed(r));
      const loc = r.status === 'running' ? r.loc : r.stoppedLoc;
      const inner = loc && loc.path ? loc.path.filter((p) => p.cycle).pop() : null;
      sub = `<div class="tsub" title="${esc(M.prof.pathText(loc))}"><b>${esc(r.setup.name)}_Rev${esc(r.setup.rev)}</b> · ${esc(loc && !loc.done ? loc.leaf.name : '')}${inner ? ` · cycle ${inner.cycle.toLocaleString()}/${inner.of.toLocaleString()}` : ''}</div>`;
      prog = `<div class="prog" title="${((el / total) * 100).toFixed(1)}%"><i style="width:${(el / total) * 100}%;${r.status !== 'running' ? 'background:var(--off)' : ''}"></i></div>`;
    } else {
      sub = '<div class="tsub">No test loaded</div><div class="prog"></div>';
    }

    if (r.status === 'running') {
      const total = M.prof.total(r.setup), el = M.sim.elapsed(r);
      const bl = M.sim.blink(r);
      const un = r.alarms.filter((a) => a.state === 'ACTIVE' && !a.cleared);
      foot = `<span class="msg">${un.length ? `<span class="badge ${bl === 'R' ? 'bad' : 'warn'}">${un.length} active alarm${un.length > 1 ? 's' : ''}</span>` : `<span class="muted">${ui.hours(el)} of ${Math.round(total / 3600).toLocaleString()} h</span>`}</span>
        <button class="btn sm" data-act="open" data-id="${r.id}">Open</button>`;
    } else if (r.status === 'shutdown') {
      const steps = r.sd.steps.map(([label], i) => `<div class="${i < r.sd.i ? 'done' : i === r.sd.i ? 'cur' : 'todo'}">${i < r.sd.i ? '✓' : i === r.sd.i ? '▸' : '·'} ${i + 1}. ${esc(label)}</div>`).join('');
      body = `<div class="sd"><div class="badge bad" style="justify-self:start">${esc(r.stopReason)}</div>${steps}</div>`;
      foot = `<span class="msg muted">${r.sd.kind === 'hard' ? 'Hard' : 'Software'} shutdown in progress</span>`;
    } else if (r.status === 'stopped') {
      foot = `<span class="msg" title="${esc(r.stopReason)}" style="color:var(--bad)">${esc(r.stopReason || 'Stopped')}</span>
        <button class="btn sm" data-act="open" data-id="${r.id}">Open</button>
        <button class="btn sm" data-act="clear" data-id="${r.id}" ${ui.can('clear') ? '' : 'disabled'}>Clear</button>`;
    } else if (r.status === 'poweroff') {
      body = `<div class="sd"><div class="badge bad" style="justify-self:start">Safety relay open — stand power OFF</div><div>${esc(r.stopReason || '')}</div><div class="muted">Can only be restored by pressing the reset button in the bay. No software path exists.</div></div>`;
      foot = `<span class="msg" style="color:var(--bad)">Needs a person in the cell</span><button class="btn sm" data-act="reset" data-id="${r.id}" title="Demo only — stands in for the physical button">Simulate cell reset</button>`;
    } else if (r.status === 'manual') {
      foot = `<span class="msg"><span class="badge warn">Manual control · ${esc(r.manual.user)}</span></span><button class="btn sm" data-act="manual" data-id="${r.id}">Open</button>`;
    } else if (r.status === 'complete') {
      foot = `<span class="msg" style="color:var(--ok)">Test complete</span><button class="btn sm" data-act="clear" data-id="${r.id}" ${ui.can('clear') ? '' : 'disabled'}>Clear</button>`;
    } else {
      foot = `<span class="msg muted">Ready · stand power on</span>
        <button class="btn sm" data-act="open" data-id="${r.id}">Open</button>
        <button class="btn sm primary" data-act="load" data-id="${r.id}" ${ui.can('run') ? '' : 'disabled'}>Load test…</button>`;
    }
    return `<div class="tile ${ui.state.rackId === r.id ? 'sel' : ''}">${head}${sub}${prog}${body}<div class="tf">${foot}</div></div>`;
  }

  function paint() {
    const c = (f) => M.visRacks().filter(f).length;
    const unacked = M.visRacks().reduce((a, r) => a + r.alarms.filter((x) => x.state === 'ACTIVE').length, 0);
    root.querySelector('.ov-top').innerHTML = `
      <div class="kpi"><i class="led ok"></i><b>${c((r) => r.status === 'running')}</b> running</div>
      <div class="kpi"><i class="led idle"></i><b>${c((r) => ['idle', 'complete'].includes(r.status))}</b> idle</div>
      <div class="kpi"><i class="led bad"></i><b>${c((r) => ['stopped', 'shutdown', 'poweroff'].includes(r.status))}</b> stopped</div>
      <div class="kpi"><i class="led warn"></i><b>${c((r) => r.status === 'manual')}</b> manual</div>
      <div class="kpi"><i class="led off"></i><b>${c((r) => r.status === 'offline')}</b> offline / not migrated</div>
      <div class="kpi"><b>${unacked}</b> unacknowledged alarms</div>
      <span class="muted" style="margin-left:auto">Open question — is a lab-wide view like this wanted? It needs a lab-level service, so it is an architecture decision rather than a screen.</span>`;
    root.querySelector('.ov-grid').innerHTML = M.visRacks().map(tile).join('');
  }

  function loadDialog(r) {
    const opts = M.SETUPS.map((s) => `<option value="${s.id}">${esc(s.name)}_Rev${esc(s.rev)} — ${Math.round(M.prof.total(s) / 3600).toLocaleString()} h</option>`).join('');
    ui.modal({
      title: `Load test on ${r.name}`,
      body: `<label>Test setup<select id="ldSetup">${opts}</select></label>
        <div class="muted">The setup is validated against ${r.name}'s channel map and calibration before arming.</div>
        <div class="banner">Start is only available at the local HMI. Remote sessions can view and stop, never start.</div>`,
      buttons: [
        { label: 'Cancel' },
        { label: 'Arm & start', cls: 'primary', onClick: (w) => { if (ui.cmd(r, 'START', M.setupById(w.querySelector('#ldSetup').value))) ui.toast(`${r.name} started`); paint(); } },
      ],
    });
  }

  ui.screens.overview = {
    render(el) {
      root = el;
      root.innerHTML = '<div class="pad"><div class="ov-top"></div><div class="ov-grid" data-tour="tiles"></div></div>';
      root.onclick = (e) => {
        const b = e.target.closest('[data-act]');
        if (!b || b.disabled) return;
        const r = M.sim.rack(+b.dataset.id);
        if (b.dataset.act === 'open') ui.go('graph', r.id);
        if (b.dataset.act === 'clear') { ui.cmd(r, 'CLEAR'); paint(); }
        if (b.dataset.act === 'reset') { M.sim.pressCellReset(r); ui.toast(`${r.name}: safety relay re-armed at the cell`); paint(); }
        if (b.dataset.act === 'manual') ui.go('manual', r.id);
        if (b.dataset.act === 'load') loadDialog(r);
      };
      paint();
    },
    // Skip repaint while the pointer is on a button so clicks aren't swallowed by the re-render.
    tick() { if (++n % 2 === 0 && !root.querySelector('button:hover')) paint(); },
  };
})(globalThis.M = globalThis.M || {});
