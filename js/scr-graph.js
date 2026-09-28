// Live Trend: live channel table (left), configurable multi-channel graph (right),
// 1–24 h window, test-step bands under the time axis, thresholds, hover readout.
(function (M) {
  const ui = M.ui, esc = ui.esc, $ = ui.$;
  const WINDOWS = [1, 4, 8, 12, 24];
  const st = { win: 24, live: true, end: null, hover: null };
  Object.defineProperty(st, 'sel', { get: () => M.watch.sel, set: (v) => (M.watch.sel = v) });
  let root, r, canvas, geom;

  function colorOf(ch) { return M.chart.COLORS[st.sel.indexOf(ch) % M.chart.COLORS.length]; }

  function levelLed(ch) {
    if (!M.TH.some((t) => t.ch === ch)) return 'ok';
    const l = r.lvl[ch] || 0;
    return l === 2 ? 'bad' : l === 1 ? 'warn' : 'ok';
  }

  function listHtml() {
    // Declared widths: with table-layout fixed the group header row (a single colspan
    // cell) would otherwise decide the columns.
    let html = '<table><colgroup><col><col class="cv"><col class="cu"><col class="cl"></colgroup>', grp = '';
    M.CH.forEach((c) => {
      if (c.group !== grp) { grp = c.group; html += `<tr><th class="grp" colspan="4">${grp}</th></tr>`; }
      const on = st.sel.includes(c.id);
      html += `<tr class="ch ${on ? 'sel' : ''}" data-ch="${c.id}">
        <td><span class="sw" style="background:${on ? colorOf(c.id) : 'transparent'};border:1px solid ${on ? colorOf(c.id) : '#b9c1ca'}"></span>${esc(c.name)}</td>
        <td class="v" data-v="${c.id}">${ui.fmt(c.id, r.v[c.id])}</td><td class="u">${c.unit}</td>
        <td><i class="led ${levelLed(c.id)}" data-l="${c.id}"></i></td></tr>`;
    });
    return html + '</table>';
  }

  function render(el) {
    root = el; r = ui.rack();
    if (r.status === 'offline') {
      root.innerHTML = `<div class="placeholder"><h2>${r.name} — ${esc(ui.rackState(r).text)}</h2><p>${esc(r.reason)}</p><p>No live or historical data is available from this rack in the new system.</p></div>`;
      return;
    }
    root.innerHTML = `
      <div class="gv">
        <div class="gv-list pane" data-tour="chlist"><div class="pchdr">${ui.paneBtn('gv', 'left')}<span>Channels</span></div>${listHtml()}</div>
        <div class="gv-main">
          <div class="gv-bar">
            <span class="muted">Window</span>
            <span class="seg" id="gvWin">${WINDOWS.map((h) => `<button data-h="${h}" class="${st.win === h ? 'on' : ''}">${h} h</button>`).join('')}</span>
            <button class="btn sm" id="gvLive">${st.live ? '⏸ Pause' : '▶ Live'}</button>
            <button class="btn sm" id="gvBack" title="Scroll back">◀</button>
            <button class="btn sm" id="gvFwd" title="Scroll forward">▶</button>
            <span class="sp" style="flex:1"></span>
            <span class="muted">Click channels on the left to add or remove them (max 8)</span>
            <button class="btn sm" id="gvExport" title="Mock only">Export visible range…</button>
          </div>
          <div class="gv-plot" data-tour="plot"><canvas></canvas></div>
          <div class="gv-foot">
            <span class="legend" id="gvLegend"></span>
            <span style="margin-left:auto" data-tour="logmode" id="gvLog"></span>
          </div>
        </div>
      </div>`;
    canvas = root.querySelector('canvas');

    root.querySelector('.gv-list').onclick = (e) => {
      if (ui.panePick(e)) return;
      const tr = e.target.closest('tr.ch'); if (!tr) return;
      M.watchToggle(tr.dataset.ch);
      root.querySelector('.gv-list').innerHTML = listHtml();
      paint();
    };
    root.querySelector('#gvWin').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.win = +b.dataset.h; ui.$$('#gvWin button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
    root.querySelector('#gvLive').onclick = () => { st.live = !st.live; st.end = st.live ? null : M.sim.now; root.querySelector('#gvLive').textContent = st.live ? '⏸ Pause' : '▶ Live'; paint(); };
    const shift = (dir) => { st.live = false; st.end = Math.min(M.sim.now, (st.end || M.sim.now) + dir * st.win * 0.5 * 3.6e6); root.querySelector('#gvLive').textContent = '▶ Live'; paint(); };
    root.querySelector('#gvBack').onclick = () => shift(-1);
    root.querySelector('#gvFwd').onclick = () => shift(1);
    root.querySelector('#gvExport').onclick = () => ui.modal({ title: 'Export visible range', body: `<div>Would write the selected channels for the visible window to <b>TDMS</b> (readable in Excel, DIAdem, MATLAB) or CSV.</div><div class="muted">Demonstration only — which export formats does the lab need?</div>` });
    canvas.onmousemove = (e) => { if (!geom) return; const rc = canvas.getBoundingClientRect(); st.hover = geom.tAt(e.clientX - rc.left); paint(); tip(e); };
    canvas.onmouseleave = () => { st.hover = null; $('#tip').hidden = true; paint(); };
    window.onresize = () => S_screen() && paint();
    paint();
  }
  const S_screen = () => ui.state.screen === 'graph';

  function window_() {
    const end = st.live ? M.sim.now : st.end;
    return [end - st.win * 3.6e6, end];
  }

  function paint() {
    if (!canvas) return;
    const [t0, t1] = window_();
    const hist = r.hist.filter((s) => s.t >= t0 - 60000 && s.t <= t1 + 60000);
    const units = [...new Set(st.sel.map((c) => M.chById[c].unit))];
    const series = st.sel.map((ch) => {
      const pts = hist.map((s) => [s.t, s.v[ch]]);
      if (st.live) pts.push([M.sim.now, r.v[ch]]);
      return { name: M.chById[ch].name, unit: M.chById[ch].unit, axis: units.indexOf(M.chById[ch].unit) === 0 ? 0 : 1, color: colorOf(ch), pts };
    });
    const bands = [];
    hist.forEach((s, i) => {
      const last = bands[bands.length - 1];
      const tEnd = i + 1 < hist.length ? hist[i + 1].t : t1;
      if (last && last.label === s.band) last.t1 = tEnd; else bands.push({ t0: s.t, t1: tEnd, label: s.band });
    });
    const thresholds = [];
    const thCh = st.sel.filter((c) => M.TH.some((t) => t.ch === c));
    if (thCh.length === 1 && st.sel.length <= 2 && r.setup && r.loc && !r.loc.done) {
      const th = M.prof.thFor(r.setup, r.loc.leaf)[thCh[0]];
      const axis = units.indexOf(M.chById[thCh[0]].unit) === 0 ? 0 : 1;
      thresholds.push({ v: th[0], axis, sev: 'Y' }, { v: th[1], axis, sev: 'R' });
    }
    geom = M.chart.draw(canvas, { series, t0, t1, bands, thresholds, hoverT: st.hover });

    root.querySelector('#gvLegend').innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('') +
      (units.length > 2 ? '<span class="muted">· mixed units share the right axis</span>' : '') +
      (thCh.length === 1 && st.sel.length <= 2 ? '' : '<span class="muted">· select one alarmed channel alone to see its limits</span>');
    const loc = r.loc;
    const hz = r.status === 'running' && loc && !loc.done ? loc.leaf.logHz || r.setup.logHz : null;
    root.querySelector('#gvLog').innerHTML = hz
      ? `<i class="led ok"></i> Logging <b>${hz} Hz</b> continuous · min/max/RMS kept per interval · <b>1 kHz burst</b> armed on red alarm`
      : `<i class="led off"></i> Not logging — ${esc(M.sim.statusLabel(r))}`;
  }

  function tip(e) {
    const t = $('#tip');
    if (st.hover == null) return (t.hidden = true);
    let best = null, bd = Infinity;
    r.hist.forEach((s) => { const d = Math.abs(s.t - st.hover); if (d < bd) { bd = d; best = s; } });
    if (!best || bd > 5 * 60000) return (t.hidden = true);
    t.innerHTML = `<div class="tt">${ui.clock(best.t).slice(5, 16)} · ${esc(best.path)}</div>` +
      st.sel.map((ch) => `<div><span style="color:${colorOf(ch)}">■</span><span style="flex:1">${esc(M.chById[ch].name)}</span><b>${ui.fmtU(ch, best.v[ch])}</b></div>`).join('');
    t.hidden = false;
    t.style.left = Math.min(window.innerWidth - 380, e.clientX + 14) + 'px';
    t.style.top = e.clientY + 14 + 'px';
  }

  // Jump from an alarm: that channel alone, 4 h window centred on the alarm time
  ui.graphFocus = (ch, t) => Object.assign(st, { sel: [ch], win: 4, live: false, end: Math.min(M.sim.now, t + 2 * 3.6e6) });

  ui.screens.graph = {
    render,
    tick() {
      if (!root || !r || r.status === 'offline' || !canvas) return;
      M.CH.forEach((c) => {
        const v = root.querySelector(`[data-v="${c.id}"]`); if (v) v.textContent = ui.fmt(c.id, r.v[c.id]);
        const l = root.querySelector(`[data-l="${c.id}"]`); if (l) l.className = 'led ' + levelLed(c.id);
      });
      if (st.live) paint();
    },
  };
})(globalThis.M = globalThis.M || {});
