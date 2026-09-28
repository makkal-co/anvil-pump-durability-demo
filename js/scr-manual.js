// Manual Control: drive each output outside a test, software/hard shutdown,
// stand-power-off state, command vs actual readback.
(function (M) {
  const ui = M.ui, esc = ui.esc;
  const AO = [
    { key: 'motor', label: 'Motor speed', unit: 'rpm', max: 3000, step: 10, act: (r) => ui.fmtU('speed', r.v.speed), dev: (r) => Math.abs(r.cmd.motor - r.x.speed), devLim: 50 },
    { key: 'boostPump', label: 'Boost pump speed', unit: '%', max: 100, step: 1, act: (r) => 'Case drain ' + ui.fmtU('caseF', r.v.caseF) + ' · ' + ui.fmtU('caseP', r.v.caseP) },
    { key: 'coolFan', label: 'Cooler fan speed', unit: '%', max: 100, step: 1, act: (r) => 'Cooler flow ' + ui.fmtU('hxF', r.v.hxF) },
    { key: 'loadValve', label: 'Load valve opening', unit: '%', max: 100, step: 1, act: (r) => 'System ' + ui.fmtU('sysP', r.v.sysP) },
  ];
  const DO = [
    { key: 'tankHeater', label: 'Tank heater', ctl: 'tankHeater', read: (r) => 'Tank ' + ui.fmtU('tankT', r.v.tankT) },
    { key: 'hxHeater', label: 'Cooler heater', ctl: 'hxHeater', read: (r) => 'Cooler ' + ui.fmtU('hxInT', r.v.hxInT) },
    { key: 'bypassValve', label: 'Cooler bypass valve', ctl: 'bypassValve', read: (r) => 'Cooler ' + ui.fmtU('hxInT', r.v.hxInT) },
  ];
  let root, r, sig = '';

  const signature = (x) => [x.id, x.status, x.power, x.sd ? x.sd.i : '', ui.state.user.u].join('|');

  function banner() {
    const canM = ui.can('manual');
    if (!M.inScope(r)) {
      return `<div class="mc-banner info">◐ <b>${esc(r.name)} is in bay ${r.cell}</b> — this station stands in bay ${M.scope.cell == null ? '—' : M.scope.cell}.
        You can watch it and run the <b>software shutdown</b>; driving outputs, starting a test and the hard shutdown are refused by the stand, not hidden here.
        <span class="muted">Drive it from the bay ${r.cell} station.</span></div>` + (r.status === 'manual' ? '' : '');
    }
    switch (r.status) {
      case 'running':
        return `<div class="mc-banner info">▶ Test running — <b>${esc(r.setup.name)}_Rev${esc(r.setup.rev)}</b>. Manual outputs are locked while a sequence runs. Both shutdowns remain available. <span class="muted">(should live trim be allowed?)</span></div>`;
      case 'manual':
        return `<div class="mc-banner warn">⚠ <b>MANUAL MODE</b> — driven by ${esc(r.manual.user)}. Temperature interlocks stay armed; a red alarm still triggers the software shutdown.
          <span class="sp"></span><button class="btn" data-a="exit">Exit manual</button></div>`;
      case 'shutdown': {
        const steps = r.sd.steps.map(([l], i) => `<span class="${i < r.sd.i ? 'done' : i === r.sd.i ? 'cur' : 'todo'}">${i < r.sd.i ? '✓' : i === r.sd.i ? '▸' : '·'} ${esc(l)}</span>`).join('');
        return `<div class="mc-banner bad"><div><b>${r.sd.kind === 'hard' ? 'HARD' : 'SOFTWARE'} SHUTDOWN IN PROGRESS</b> — ${esc(r.stopReason)}</div><div class="mc-seq">${steps}</div></div>`;
      }
      case 'poweroff':
        return `<div class="mc-power">
          <div class="big">⛔ STAND POWER IS OFF</div>
          <div>The safety relay is open. Hard shutdown is unavailable.</div>
          <div>Press the <b>physical reset button in the bay</b> to restore power. There is deliberately no software path.</div>
          <div class="muted">${esc(r.stopReason || '')}</div>
          <div><button class="btn sm" data-a="reset" title="Demo only">Simulate pressing the bay reset button</button></div>
        </div>`;
      default:
        return `<div class="mc-banner">${r.status === 'stopped' ? `<span style="color:var(--bad)">${esc(r.stopReason || 'Stopped')}</span> · ` : ''}No test running. Outputs are at rest.
          <span class="sp"></span><button class="btn primary" data-a="enter" ${canM ? '' : 'disabled'} title="${canM ? '' : 'Engineer or Maintenance role required'}">Enter manual control</button></div>`;
    }
  }

  // Recording does not wait for a test. A customer asked whether values are
  // visible with no test running — they are, and a manual session is logged like any other run, so
  // "I changed the pump and this happened" is findable afterwards in Run History.
  const TREND_MIN = 60;
  function trendHtml() {
    if (!['manual', 'idle', 'complete', 'stopped'].includes(r.status)) return '';
    return `<div class="mtrend">
      <div class="mt-h">Live trend <span class="muted">last ${TREND_MIN} min · the same channels you ticked in Live Trend</span>
        <span class="legend">${M.watch.sel.map((ch, i) => `<span><i style="background:${M.chart.COLORS[i % M.chart.COLORS.length]}"></i>${esc(M.chById[ch].name)}</span>`).join('')}</span>
        <span class="sp" style="flex:1"></span>
        <button class="btn sm" data-a="pick">Channels…</button>
        <span class="muted">${r.status === 'manual' ? 'this manual session is logged as a retrievable run' : 'idle — still logging'}</span>
      </div>
      <div class="mt-p"><canvas></canvas></div>
    </div>`;
  }
  function paintTrend() {
    if (!root || !r || r.status === 'offline') return;
    const c = root.querySelector('.mt-p canvas');
    if (!c) return;
    const t1 = M.sim.now, t0 = t1 - TREND_MIN * 60000;
    const units = [...new Set(M.watch.sel.map((ch) => M.chById[ch].unit))];
    const series = M.watch.sel.map((ch, i) => {
      const pts = r.hist.filter((h) => h.t >= t0).map((h) => [h.t, h.v[ch]]);
      pts.push([t1, r.v[ch]]);
      return { name: M.chById[ch].name, unit: M.chById[ch].unit, axis: units.indexOf(M.chById[ch].unit) === 0 ? 0 : 1, color: M.chart.COLORS[i], pts };
    });
    M.chart.draw(c, { series, t0, t1, bands: [], thresholds: [] });
  }

  function pickChannels() {
    let grp = '';
    const body = '<div class="pickwrap">' + M.CH.map((c) => {
      const head = c.group !== grp ? ((grp = c.group), `<div class="pickgrp">${c.group}</div>`) : '';
      return `${head}<label class="pick"><input type="checkbox" data-pick="${c.id}" ${M.watch.sel.includes(c.id) ? 'checked' : ''}> ${esc(c.name)} <span class="muted">${c.unit}</span></label>`;
    }).join('') + '</div><div class="muted">The same selection drives Live Trend — one list of what you are watching, not two.</div>';
    const w = ui.modal({ title: `Trend channels (max ${M.watch.MAX})`, body });
    w.querySelectorAll('[data-pick]').forEach((cb) => (cb.onchange = () => {
      if (!M.watchToggle(cb.dataset.pick)) cb.checked = false;
      render(root);
    }));
  }

  function render(el) {
    root = el; r = ui.rack();
    if (r.status === 'offline') {
      root.innerHTML = `<div class="placeholder"><h2>${r.name} — ${esc(ui.rackState(r).text)}</h2><p>${esc(r.reason)}</p><p>Manual control needs a reachable stand controller.</p></div>`;
      return;
    }
    sig = signature(r);
    const live = r.status === 'manual' && ui.can('manual') && M.inScope(r);
    const dis = live ? '' : 'disabled';
    const cmdVal = (k) => (r.status === 'manual' ? r.manual[k] : Math.round(r.cmd[k] || 0));
    const doVal = (d) => (r.status === 'manual' ? r.manual[d.key] : r.ctl[d.ctl]);

    root.innerHTML = `<div class="mc">
      ${banner()}
      <div class="mc-grid">
        <div class="panel" data-tour="ao">
          <div class="panel-h">Analog outputs <span class="muted" style="font-weight:400">0–10 V</span></div>
          ${AO.map((a) => `<div class="ao">
            <div class="ao-l"><b>${a.label}</b><span class="muted">${a.unit}</span></div>
            <input type="range" min="0" max="${a.max}" step="${a.step}" value="${cmdVal(a.key)}" data-k="${a.key}" ${dis}>
            <input class="num ao-n" value="${cmdVal(a.key)}" data-n="${a.key}" ${dis}>
            <div class="ao-r"><span class="muted">Actual</span> <b class="num" data-act="${a.key}">${a.act(r)}</b> <span data-dev="${a.key}"></span></div>
          </div>`).join('')}
          <div class="mc-note">Only drive speed has a true readback here. The boost pump and the load valve are inferred from flow and pressure — a network link to the drives would add actual speed, current and fault codes, which is worth arguing for.</div>
        </div>

        <div class="mc-col">
          <div class="panel">
            <div class="panel-h">Digital outputs <span class="muted" style="font-weight:400">24 VDC</span></div>
            ${DO.map((d) => `<div class="do">
              <b>${d.label}</b>
              <span class="tog ${doVal(d) ? 'on' : ''} ${live ? '' : 'dis'}" data-do="${d.key}"><span>OFF</span><span>ON</span></span>
              <span class="num muted" data-read="${d.key}">${d.read(r)}</span>
            </div>`).join('')}
            <div class="do"><b>Safety control relay</b><span class="badge ${r.relayOpen ? 'bad' : 'off'}" data-relay>${r.relayOpen ? 'OPEN' : 'CLOSED'}</span><span class="muted">Driven only by Hard Shutdown</span></div>
          </div>
          <div class="panel">
            <div class="panel-h">Digital inputs <span class="muted" style="font-weight:400">read only</span></div>
            <div class="do"><b>Stand power on</b><i class="led ${r.power ? 'ok' : 'bad'}" data-di="power"></i><span class="num" data-dit="power">${r.power ? '24 VDC · ON' : '0 VDC · OFF'}</span></div>
            <div class="do"><b>Braking resistor trip</b><i class="led ${brake() ? 'bad' : 'ok'}" data-di="brake"></i><span class="num" data-dit="brake">${brake() ? '24 VDC · TRIP' : '0 VDC · OK'}</span></div>
          </div>
          <div class="panel" data-tour="shutdown">
            <div class="panel-h">Shutdown</div>
            <div class="sdbtns">
              <button class="bigbtn soft" data-a="soft" ${['running', 'manual'].includes(r.status) && ui.can('stop') ? '' : 'disabled'}>
                <span class="i">⏻</span><span><b>SOFTWARE SHUTDOWN</b><small>Orderly stop · 7 steps · stand stays powered</small></span></button>
              <button class="bigbtn hard" data-a="hard" ${r.power && r.status !== 'shutdown' && ui.can('stop') && M.inScope(r) ? '' : 'disabled'} title="${!M.inScope(r) ? 'Hard shutdown is local to the cell — someone may be standing at that stand' : r.power ? '' : 'Unavailable while stand power is off'}">
                <span class="i">⛔</span><span><b>HARD SHUTDOWN</b><small>Stops, then drops the safety relay · reset only at the cell</small></span></button>
            </div>
          </div>
        </div>
      </div>
      ${trendHtml()}
    </div>`;
    wire();
    tick();
  }

  function brake() { return r.alarms.some((a) => a.ch === 'brake' && !a.cleared && r.status !== 'idle' && r.status !== 'poweroff'); }

  function send(key, val) {
    if (!ui.cmd(r, 'SET_OUTPUT', { key, val })) return;
    const range = root.querySelector(`[data-k="${key}"]`), num = root.querySelector(`[data-n="${key}"]`);
    if (range) range.value = val;
    if (num) num.value = val;
  }

  function confirm(kind) {
    const hard = kind === 'hard';
    const steps = (hard ? M.sim.HARD_STEPS : M.sim.SOFT_STEPS).map(([l], i) => `<div>${i + 1}. ${esc(l)}</div>`).join('');
    ui.modal({
      title: hard ? `Hard shutdown — ${r.name}` : `Software shutdown — ${r.name}`,
      body: `<div>${hard ? 'The stand will stop and the <b>safety relay will drop out</b>. It cannot be restarted from any screen — someone must press the reset button in the bay.' : 'The stand will run the orderly stop sequence and remain powered.'}</div>
        <div class="mc-steps">${steps}</div>`,
      buttons: [{ label: 'Cancel' }, { label: hard ? 'Hard shutdown' : 'Software shutdown', cls: 'danger', onClick: () => { ui.cmd(r, hard ? 'HARD_STOP' : 'SOFT_STOP'); render(root); } }],
    });
  }

  function wire() {
    root.onclick = (e) => {
      const b = e.target.closest('[data-a]');
      if (b && !b.disabled) {
        const a = b.dataset.a;
        if (a === 'enter' && ui.cmd(r, 'MANUAL_ENTER')) render(root);
        if (a === 'exit' && ui.cmd(r, 'MANUAL_EXIT')) render(root);
        if (a === 'soft' || a === 'hard') confirm(a);
        if (a === 'reset') { M.sim.pressCellReset(r); ui.toast('Safety relay re-armed at the cell'); render(root); }
        if (a === 'pick') pickChannels();
        return;
      }
      const t = e.target.closest('[data-do]');
      if (t && !t.classList.contains('dis')) { send(t.dataset.do, r.manual[t.dataset.do] ? 0 : 1); tick(); }
    };
    root.querySelectorAll('input[type=range]').forEach((inp) => {
      inp.oninput = () => (root.querySelector(`[data-n="${inp.dataset.k}"]`).value = inp.value);
      inp.onchange = () => send(inp.dataset.k, +inp.value);
    });
    root.querySelectorAll('[data-n]').forEach((inp) => (inp.onchange = () => {
      const a = AO.find((x) => x.key === inp.dataset.n);
      const v = +inp.value;
      if (isNaN(v) || v < 0 || v > a.max) { ui.toast(`${a.label} must be 0–${a.max} ${a.unit}`); inp.value = r.manual[a.key]; return; }
      send(a.key, v);
    }));
  }

  function tick() {
    if (!root || !r || r.status === 'offline') return;
    if (signature(r) !== sig) return render(root);
    AO.forEach((a) => {
      const el = root.querySelector(`[data-act="${a.key}"]`); if (el) el.textContent = a.act(r);
      const d = root.querySelector(`[data-dev="${a.key}"]`);
      if (d && a.dev) { const v = a.dev(r); d.innerHTML = v > a.devLim ? `<span class="badge warn">Δ ${v.toFixed(0)} rpm</span>` : '<span style="color:var(--ok)">✓</span>'; }
      if (r.status === 'running') {
        const rg = root.querySelector(`[data-k="${a.key}"]`), n = root.querySelector(`[data-n="${a.key}"]`);
        if (rg) rg.value = Math.round(r.cmd[a.key]); if (n) n.value = Math.round(r.cmd[a.key]);
      }
    });
    DO.forEach((d) => {
      const el = root.querySelector(`[data-read="${d.key}"]`); if (el) el.textContent = d.read(r);
      const t = root.querySelector(`[data-do="${d.key}"]`);
      if (t) t.classList.toggle('on', !!(r.status === 'manual' ? r.manual[d.key] : r.ctl[d.ctl]));
    });
    const rel = root.querySelector('[data-relay]');
    if (rel) { rel.textContent = r.relayOpen ? 'OPEN' : 'CLOSED'; rel.className = 'badge ' + (r.relayOpen ? 'bad' : 'off'); }
  }

  ui.screens.manual = { render, tick: () => { tick(); paintTrend(); } };
})(globalThis.M = globalThis.M || {});
