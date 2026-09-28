// Remote web view: what an engineer sees from home. View + stop only, enforced by the
// controller's command handler — the command log shows accepted and rejected commands.
(function (M) {
  const ui = M.ui, esc = ui.esc;
  const KEY = ['speed', 'tankT', 'hxInT', 'dispT', 'drvBrgT', 'sysP', 'caseP', 'torque'];
  const PLOT = ['tankT', 'hxInT', 'dispT'];
  let el = null, rackId = 3, n = 0, sig = '';

  function open(keepTour) {
    if (el) return;
    el = document.createElement('div');
    el.className = 'remote';
    el.id = 'remote';
    document.body.appendChild(el);
    if (!keepTour && M.tour) M.tour.stop();
    render();
  }
  function close() { if (el) el.remove(); el = null; }

  const user = () => (ui.state.user ? ui.state.user.u : 'eng.demo');
  const signature = (r) => [rackId, r.status, r.power, r.sd ? r.sd.i : '', M.sim.cmdLog.length ? M.sim.cmdLog[0].t + M.sim.cmdLog[0].cmd : ''].join('|');

  function render() {
    const r = M.sim.rack(rackId);
    sig = signature(r);
    const st = ui.rackState(r);
    const online = M.sim.stands.filter((x) => x.status !== 'offline' || !x.legacy);
    const loc = r.status === 'running' ? r.loc : r.stoppedLoc;
    const total = r.setup ? M.prof.total(r.setup) : 0;
    const canStop = ['running', 'manual'].includes(r.status);
    el.innerHTML = `
      <header class="hdr rhdr">
        <span class="mk-brand"><svg class="mk-logo" viewBox="0 0 194.25 78.75" role="img" aria-label="Makkal"><use href="#mkLogo"></use></svg><span class="brand anvil-lockup"><svg class="anvil-mark" viewBox="0 0 64 50" aria-hidden="true"><use href="#mkAnvil"></use></svg><svg class="anvil-word" viewBox="0 0 2823 779" role="img" aria-label="Anvil"><use href="#mkAnvilWord"></use></svg></span></span><span class="ctx">· REMOTE</span>
        <span class="badge warn">🔒 Remote session · view + stop only</span>
        <span class="sp"></span>
        <span class="clock">${ui.clock(M.sim.now)}</span>
        <span class="user"><b>${esc(user())}</b> via VPN</span>
        <button class="hbtn" data-x="close">✕ Back to local HMI (demo)</button>
      </header>
      <div class="banner">You are connected from outside the lab. Tests cannot be started, configured or driven from here — the stand controller rejects those commands whatever your role. Restarting after a hard shutdown needs a person in the cell.</div>
      <div class="rbody">
        <aside class="rlist">${online.map((x) => { const s = ui.rackState(x); return `<div class="item ${x.id === rackId ? 'on' : ''}" data-rk="${x.id}"><i class="led ${s.led}"></i>${x.name}<span class="sub">${s.text}</span></div>`; }).join('')}</aside>
        <main class="rmain">
          <div class="panel">
            <div class="panel-h"><i class="led ${st.led}"></i>${r.name} <span class="badge ${st.badge}">${st.text}</span><span class="sp"></span>
              ${r.setup ? `<span class="muted" style="font-weight:400">${esc(r.setup.name)}_Rev${esc(r.setup.rev)}</span>` : ''}</div>
            ${r.status === 'offline' ? `<div class="pad muted">${esc(r.reason)}</div>` : `
            <div class="rinfo">
              <div class="estrow"><span>Step</span><b>${esc(r.status === 'manual' ? 'Manual control — ' + r.manual.user : M.prof.pathText(loc))}</b></div>
              ${r.setup ? `<div class="estrow"><span>Elapsed / remaining</span><b class="num">${ui.hours(M.sim.elapsed(r))} · ${ui.hours(Math.max(0, total - M.sim.elapsed(r)))}</b></div>` : ''}
              ${r.stopReason && r.status !== 'running' ? `<div class="estrow"><span>Last stop</span><b style="color:var(--bad)">${esc(r.stopReason)}</b></div>` : ''}
              ${r.status === 'shutdown' ? `<div class="estrow"><span>Shutdown</span><b>step ${r.sd.i + 1}/${r.sd.steps.length} — ${esc(r.sd.steps[Math.min(r.sd.i, r.sd.steps.length - 1)][0])}</b></div>` : ''}
            </div>
            <div class="rvals">${KEY.map((k) => `<div><span>${esc(M.chById[k].name)}</span><b class="num" data-rv="${k}">${ui.fmtU(k, r.v[k])}</b></div>`).join('')}</div>
            <div class="rplot"><canvas></canvas></div>`}
          </div>
        </main>
        <aside class="ract">
          <div class="panel">
            <div class="panel-h">Stop</div>
            <div class="sdbtns">
              <button class="bigbtn soft" data-r="SOFT_STOP" ${canStop ? '' : 'disabled'}><span class="i">⏻</span><span><b>SOFTWARE SHUTDOWN</b><small>Orderly stop</small></span></button>
              <button class="bigbtn hard" data-r="HARD_STOP" ${r.power && r.status !== 'offline' ? '' : 'disabled'}><span class="i">⛔</span><span><b>HARD SHUTDOWN</b><small>Drops the safety relay</small></span></button>
            </div>
          </div>
          <div class="panel">
            <div class="panel-h">Not available remotely</div>
            <div class="est">
              <button class="btn" data-r="START">Start a test</button>
              <button class="btn" data-r="MANUAL_ENTER">Manual control</button>
              <button class="btn" data-r="ACK">Acknowledge alarms</button>
              <div class="muted">These are shown only so the demo can prove the controller refuses them. The real remote view would not offer them at all.</div>
            </div>
          </div>
        </aside>
      </div>
      <div class="panel rlog" data-tour="cmdlog">
        <div class="panel-h">Controller command log <span class="muted" style="font-weight:400">— every command carries its origin and user; the controller decides</span></div>
        <div class="gridwrap" style="border:0"><table class="grid"><thead><tr><th>Time</th><th>Rack</th><th>Command</th><th>Detail</th><th>Origin</th><th>User</th><th>Result</th></tr></thead>
        <tbody>${M.sim.cmdLog.slice(0, 40).map((c) => `<tr class="row"><td class="num">${ui.clock(c.t).slice(11)}</td><td>Rack ${c.rack}</td><td class="num"><b>${c.cmd}</b></td><td class="muted">${esc(c.detail || '')}</td>
          <td><span class="badge ${c.origin === 'REMOTE' ? 'warn' : c.origin === 'LOCAL' ? 'idle' : 'off'}">${c.origin}</span></td><td class="num">${esc(c.user)}</td>
          <td>${c.ok ? '<span style="color:var(--ok)">✓ accepted</span>' : `<span style="color:var(--bad)">✗ ${esc(c.note)}</span>`}</td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="padding:12px">No commands yet. Try a button above.</td></tr>'}</tbody></table></div>
      </div>`;
    wire(r);
    plot(r);
  }

  function plot(r) {
    const c = el.querySelector('.rplot canvas');
    if (!c) return;
    const t1 = M.sim.now, t0 = t1 - 8 * 3.6e6;
    const hist = r.hist.filter((s) => s.t >= t0 - 60000);
    const bands = [];
    hist.forEach((s, i) => { const last = bands[bands.length - 1]; const te = i + 1 < hist.length ? hist[i + 1].t : t1; if (last && last.label === s.band) last.t1 = te; else bands.push({ t0: s.t, t1: te, label: s.band }); });
    M.chart.draw(c, {
      t0, t1, bands,
      series: PLOT.map((k, i) => ({ name: M.chById[k].name, unit: '°C', axis: 0, color: M.chart.COLORS[i], pts: hist.map((s) => [s.t, s.v[k]]).concat([[t1, r.v[k]]]) })),
    });
  }

  function wire(r) {
    el.onclick = (e) => {
      const t = e.target.closest('[data-x],[data-rk],[data-r]');
      if (!t || t.disabled) return;
      if (t.dataset.x === 'close') return close();
      if (t.dataset.rk) { rackId = +t.dataset.rk; return render(); }
      const cmd = t.dataset.r;
      const go = () => {
        const res = M.sim.cmd(r, cmd, 'REMOTE', user(), cmd === 'START' ? M.setupById('end2000') : undefined);
        ui.toast(res.ok ? `${cmd.replace('_', ' ')} accepted by ${r.name}` : res.note);
        render();
      };
      if (cmd === 'SOFT_STOP' || cmd === 'HARD_STOP') {
        ui.modal({
          title: `${cmd === 'HARD_STOP' ? 'Hard' : 'Software'} shutdown — ${r.name} (remote)`,
          body: cmd === 'HARD_STOP' ? 'The safety relay will drop out. <b>Nobody can restart this rack until someone presses the reset button in the bay.</b>' : 'The rack will run its orderly stop sequence.',
          buttons: [{ label: 'Cancel' }, { label: 'Confirm', cls: 'danger', onClick: go }],
        });
      } else go();
    };
  }

  M.remote = {
    open, close,
    refresh() { if (el) render(); },
    tick() {
      if (!el) return;
      const r = M.sim.rack(rackId);
      if (signature(r) !== sig && !document.querySelector('.modal')) return render();
      KEY.forEach((k) => { const v = el.querySelector(`[data-rv="${k}"]`); if (v) v.textContent = ui.fmtU(k, r.v[k]); });
      const ck = el.querySelector('.clock'); if (ck) ck.textContent = ui.clock(M.sim.now);
      if (++n % 4 === 0) plot(r);
    },
  };
})(globalThis.M = globalThis.M || {});
