// Run History: browse finished runs on the network share and graph them
// with the same channel selection as the live view — WHILE a test keeps running.
//
// This is the thing their other plant cannot do. On the Measurement Computing rigs they have to
// stop a stand to get at its data for a report. Nothing here touches the controller: the files have
// already been migrated to the share, so reading them costs a running test nothing.
(function (M) {
  const ui = M.ui, esc = ui.esc, $ = ui.$;
  const st = { runId: null, sel: ['tankT', 'dispT', 'sysP', 'speed'], rack: 'all', kind: 'all', hover: null };
  let root, canvas, geom;

  const H = 3600000;
  const SHARE = '\\\\lab-fs01\\testdata';

  // ---- Deterministic pseudo-random, so the catalogue is stable between renders ----
  function rnd(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  // ---- Run catalogue ---------------------------------------------------------
  let RUNS = null;
  function runs() {
    if (RUNS) return RUNS;
    RUNS = [];
    const now = M.sim.now;
    M.sim.stands.forEach((rk) => {
      if (rk.legacy) return;                       // not migrated — nothing on the share
      const g = rnd(rk.id * 7919 + 13);
      const n = 3 + Math.floor(g() * 3);
      let back = 2 * H + g() * 20 * H;
      for (let i = 0; i < n; i++) {
        const manual = g() < 0.35;
        const setup = M.SETUPS[Math.floor(g() * M.SETUPS.length)];
        const durH = manual ? 0.3 + g() * 1.2 : [2, 12, 102, 511][Math.floor(g() * 4)];
        back += durH * H + (6 + g() * 60) * H;
        const started = now - back;
        const bad = !manual && g() < 0.25;
        RUNS.push({
          id: `r${rk.id}-${i}`,
          rackId: rk.id,
          rackName: rk.name,
          kind: manual ? 'MANUAL' : 'TEST',
          name: manual ? 'Manual session' : `${setup.name}_Rev${setup.rev}`,
          setup: manual ? null : setup,
          user: manual ? ['tech.demo', 'eng.demo', 'maint.demo'][Math.floor(g() * 3)] : 'tech.demo',
          startedAt: started,
          durSec: durH * 3600,
          status: manual ? 'COMPLETE' : bad ? 'STOPPED' : 'COMPLETE',
          reason: bad ? 'Red alarm — discharge air over temperature' : null,
          bytes: Math.round((manual ? 0.4 : 12) * durH * 1e6 + g() * 4e6),
          seed: rk.id * 131 + i * 17,
        });
      }
    });
    RUNS.sort((a, b) => b.startedAt - a.startedAt);
    return RUNS;
  }
  const runById = (id) => runs().find((x) => x.id === id);

  // ---- Synthesised sample data ----------------------------------------------
  // Plausible shapes only. The real screen reads TDMS; this one has to look like it does.
  const BASE = {
    tankT: 82, hxInT: 72, hxOutT: 78, ambT: 23, sucT: 25, dispT: 93, postHxT: 41, sumpT: 32,
    drvBrgT: 70, pmpBrgT: 67, filtT: 26, caseP: 2.7, hxInP: 2.2, hxOutP: 1.9, sysP: 9.0,
    accP: 8.8, sucP: 0, bypP: 9.0, caseF: 5.9, hxF: 23.8, dispF: 41.7, speed: 1480, torque: 44,
    speedDev: 6,
  };
  const baseOf = (ch) => (BASE[ch] != null ? BASE[ch] : M.chById[ch].unit === '°C' ? 98 : 1);

  function pointsFor(run, ch, n) {
    const b = baseOf(ch), g = rnd(run.seed * 31 + ch.length * 977 + ch.charCodeAt(0) * 13);
    const amp = Math.max(Math.abs(b) * 0.04, 0.05);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;                                   // 0..1 through the run
      // warm-up over the first 6 %, cool-down over the last 4 %, wander in between
      const warm = Math.min(1, f / 0.06);
      const cool = f > 0.96 ? Math.max(0, (1 - f) / 0.04) : 1;
      const ramp = /T$|^tankT|torque/.test(ch) ? warm * cool : 1;
      const wander = Math.sin(f * 9 + run.seed) * 0.6 + Math.sin(f * 31 + 1.7) * 0.25;
      const idle = ch === 'speed' || ch === 'torque' ? warm * cool : 1;
      let v = b * idle * (ch === 'speed' ? 1 : ramp) + amp * (wander + (g() - 0.5) * 0.8);
      if (ch === 'speed') v = b * warm * cool + amp * (g() - 0.5);
      if (run.status === 'STOPPED' && f > 0.93 && /dispT|tankT/.test(ch)) v += (f - 0.93) * 900;  // the excursion that stopped it
      pts.push([run.startedAt + f * run.durSec * 1000, v]);
    }
    return pts;
  }

  // ---- Rendering --------------------------------------------------------------
  const ymdhm = (t) => ui.clock(t).slice(0, 16);
  const mb = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' kB');
  function fileName(run) {
    const d = new Date(run.startedAt).toISOString().slice(0, 10).replace(/-/g, '');
    return `${run.rackName.replace(' ', '')}_${run.kind === 'MANUAL' ? 'Manual' : run.name}_${d}.tdms`;
  }

  function listHtml() {
    // Files live on the lab share, so every station can read every stand's history. Driving a stand
    // is what a station's cell decides, not what it may look at.
    const rows = runs().filter((x) => (st.rack === 'all' || x.rackId === +st.rack) && (st.kind === 'all' || x.kind === st.kind));
    if (!rows.length) return '<div class="muted" style="padding:14px">No runs match this filter.</div>';
    return rows.map((x) => `<div class="run ${st.runId === x.id ? 'on' : ''}" data-run="${x.id}">
        <div class="r1"><b>${esc(x.name)}</b><span class="badge ${x.kind === 'MANUAL' ? 'idle' : x.status === 'STOPPED' ? 'bad' : 'run'}">${x.kind === 'MANUAL' ? 'MANUAL' : x.status}</span></div>
        <div class="r2">${esc(x.rackName)} · ${ymdhm(x.startedAt)}</div>
        <div class="r2 muted">${ui.hours(x.durSec)} · ${mb(x.bytes)} · ${esc(x.user)}</div>
      </div>`).join('');
  }

  function chHtml() {
    let html = '<table>', grp = '';
    M.CH.forEach((c) => {
      if (c.group !== grp) { grp = c.group; html += `<tr><th class="grp" colspan="3">${grp}</th></tr>`; }
      const on = st.sel.includes(c.id);
      const col = M.chart.COLORS[st.sel.indexOf(c.id) % M.chart.COLORS.length];
      html += `<tr class="ch ${on ? 'sel' : ''}" data-ch="${c.id}">
        <td><span class="sw" style="background:${on ? col : 'transparent'};border:1px solid ${on ? col : '#b9c1ca'}"></span>${esc(c.name)}</td>
        <td class="u">${c.unit}</td></tr>`;
    });
    return html + '</table>';
  }

  function render(el) {
    root = el;
    const running = M.sim.stands.filter((x) => x.status === 'running').length;
    root.innerHTML = `<div class="dh">
      <div class="dh-bar">
        <b>Run History</b>
        <span class="muted" title="Nothing on this screen touches a stand controller — these files were copied off when each run ended">finished runs, read from the network share</span>
        <span class="sp" style="flex:1"></span>
        <span class="badge run"><i class="led ok"></i>${running} test${running === 1 ? '' : 's'} still running</span>
      </div>
      <div class="dh-body">
        <div class="dh-runs pane"><div class="pchdr">${ui.paneBtn('runs', 'left')}<span>Runs</span></div>
          <div class="dh-filters">
            <select id="dhRack"><option value="all">All stands</option>${M.sim.stands.filter((x) => !x.legacy).map((x) => `<option value="${x.id}" ${st.rack == x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
            <select id="dhKind">${[['all', 'Tests and manual'], ['TEST', 'Test runs'], ['MANUAL', 'Manual sessions']].map(([k, l]) => `<option value="${k}" ${st.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </div>
          <div class="dh-list">${listHtml()}</div>
        </div>
        <div class="dh-ch pane"><div class="pchdr">${ui.paneBtn('ch', 'left')}<span>Channels</span></div>${chHtml()}</div>
        <div class="dh-main">${st.runId ? mainHtml() : `<div class="placeholder"><h2>Pick a run on the left</h2><p>Finished test runs and manual sessions, migrated from the stand controllers to the network share.</p><p>Opening one does not interrupt anything: a stand that is testing keeps testing, and the file you are reading was copied off the controller when the run ended.</p></div>`}</div>
      </div>
    </div>`;
    wire();
    if (st.runId) paint();
  }

  function mainHtml() {
    const x = runById(st.runId);
    return `<div class="dh-head">
        <div><b>${esc(x.name)}</b> <span class="muted">· ${esc(x.rackName)} · ${ymdhm(x.startedAt)} → ${ymdhm(x.startedAt + x.durSec * 1000)}</span></div>
        <div class="muted num">${esc(SHARE)}\\${esc(x.rackName.toLowerCase().replace(' ', '-'))}\\${esc(fileName(x))} · ${mb(x.bytes)}</div>
        ${x.reason ? `<div class="banner bad-banner">Run ended early — ${esc(x.reason)}</div>` : ''}
      </div>
      <div class="gv-bar">
        <span class="muted">Whole run · ${ui.hours(x.durSec)}</span>
        <span class="sp" style="flex:1"></span>
        <span class="muted">Click channels to add or remove them (max 8)</span>
        <button class="btn sm" id="dhExport">Export…</button>
      </div>
      <div class="gv-plot"><canvas></canvas></div>
      <div class="gv-foot"><span class="legend" id="dhLegend"></span>
        <span style="margin-left:auto" class="muted">${x.kind === 'MANUAL' ? 'Manual session — recorded so an engineer can find what they did afterwards (a question worth asking)' : 'Logged at 1 Hz · min/max/RMS kept per interval'}</span>
      </div>`;
  }

  function paint() {
    canvas = root.querySelector('canvas');
    if (!canvas) return;
    const x = runById(st.runId);
    const units = [...new Set(st.sel.map((c) => M.chById[c].unit))];
    const series = st.sel.map((ch, i) => ({
      name: M.chById[ch].name, unit: M.chById[ch].unit,
      axis: units.indexOf(M.chById[ch].unit) === 0 ? 0 : 1,
      color: M.chart.COLORS[i % M.chart.COLORS.length],
      pts: pointsFor(x, ch, 420),
    }));
    geom = M.chart.draw(canvas, { series, t0: x.startedAt, t1: x.startedAt + x.durSec * 1000, bands: [], thresholds: [], hoverT: st.hover });
    const lg = root.querySelector('#dhLegend');
    if (lg) lg.innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  }

  function wire() {
    const rs = root.querySelector('#dhRack'); if (rs) rs.onchange = () => { st.rack = rs.value; render(root); };
    const ks = root.querySelector('#dhKind'); if (ks) ks.onchange = () => { st.kind = ks.value; render(root); };
    root.querySelector('.dh-runs').onclick = (e) => ui.panePick(e);
    root.querySelector('.dh-list').onclick = (e) => {
      const d = e.target.closest('[data-run]'); if (!d) return;
      st.runId = d.dataset.run; render(root);
    };
    root.querySelector('.dh-ch').onclick = (e) => {
      if (ui.panePick(e)) return;
      const tr = e.target.closest('tr.ch'); if (!tr) return;
      const ch = tr.dataset.ch, i = st.sel.indexOf(ch);
      if (i >= 0) st.sel.splice(i, 1); else if (st.sel.length < 8) st.sel.push(ch); else return ui.toast('Maximum 8 channels on one graph');
      root.querySelector('.dh-ch').innerHTML = chHtml();
      if (st.runId) paint();
    };
    const ex = root.querySelector('#dhExport');
    if (ex) ex.onclick = () => ui.modal({
      title: 'Export run',
      body: `<div>Would write the selected channels for <b>${esc(runById(st.runId).name)}</b> to TDMS or CSV, or copy the original file.</div>
             <div class="muted">The original stays on the share — an export never moves or deletes the system of record.</div>`,
    });
  }

  // Deep link: index.html#screen=data&run=r3-1
  ui.dataOpen = (id) => { if (runById(id)) st.runId = id; };

  ui.screens.data = { render, tick() {} };
})(globalThis.M = globalThis.M || {});
