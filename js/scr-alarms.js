// Alarms: active and historical alarms with the test step, action taken,
// acknowledge per alarm or in bulk, rack or lab scope, detail pane, jump to graph, CSV export.
(function (M) {
  const ui = M.ui, esc = ui.esc;
  const st = { scope: 'rack', show: { un: true, ack: true, clr: true }, sev: 'all', sel: new Set(), detail: null };
  let root, n = 0;

  const chName = (a) => (a.ch === 'brake' ? 'Braking resistor trip' : M.chById[a.ch].name);
  const val = (a) => (a.ch === 'brake' ? '24 VDC' : ui.fmtU(a.ch, a.val));
  const lim = (a) => (a.ch === 'brake' ? 'trip input' : `${a.dir === 'low' ? '<' : '>'} ${ui.fmtU(a.ch, a.limit)}`);
  const bucket = (a) => (a.state === 'ACTIVE' ? 'un' : a.cleared ? 'clr' : 'ack');
  const stateText = (a) => (a.state === 'ACTIVE' ? (a.cleared ? 'UNACK · value back in band' : 'ACTIVE · UNACK') : a.cleared ? 'CLEARED' : 'ACKNOWLEDGED');

  function rows() {
    const stands = st.scope === 'lab' ? M.sim.stands : [ui.rack()];
    const list = [];
    stands.forEach((r) => r.alarms.forEach((a) => list.push({ r, a })));
    return list
      .filter(({ a }) => st.show[bucket(a)] && (st.sev === 'all' || a.sev === st.sev))
      .sort((x, y) => y.a.t - x.a.t || y.a.id - x.a.id);
  }

  function counts() {
    const stands = st.scope === 'lab' ? M.sim.stands : [ui.rack()];
    const all = stands.flatMap((r) => r.alarms);
    return {
      red: all.filter((a) => a.sev === 'R' && !a.cleared).length,
      yellow: all.filter((a) => a.sev === 'Y' && !a.cleared).length,
      un: all.filter((a) => a.state === 'ACTIVE').length,
      total: all.length,
    };
  }

  function table() {
    const list = rows();
    if (!list.length) return '<div class="muted" style="padding:18px">No alarms match the current filter.</div>';
    const lab = st.scope === 'lab';
    return `<table class="grid al"><thead><tr>
      <th style="width:26px"><input type="checkbox" data-all></th>${lab ? '<th>Rack</th>' : ''}<th>Sev</th><th>Time</th><th>Test step at the moment of the alarm</th><th>Channel</th><th>Value</th><th>Limit</th><th>State</th><th>Action taken</th><th></th>
    </tr></thead><tbody>${list.map(({ r, a }) => `
      <tr class="row ${a.state === 'ACTIVE' ? (a.sev === 'R' ? 'unR' : 'unY') : ''} ${st.detail === a.id ? 'sel' : ''}" data-id="${a.id}" data-r="${r.id}">
        <td><input type="checkbox" data-pick="${a.id}" ${st.sel.has(a.id) ? 'checked' : ''}></td>
        ${lab ? `<td>${r.name}</td>` : ''}
        <td><span class="badge ${a.sev === 'R' ? 'bad' : 'warn'}">${a.sev === 'R' ? 'RED' : 'YELLOW'}</span></td>
        <td class="num">${ui.clock(a.t).slice(5, 19)}</td>
        <td class="stepcell" title="${esc(a.path)}">${esc(a.path)}</td>
        <td>${esc(chName(a))}</td>
        <td class="num">${val(a)}</td>
        <td class="num">${lim(a)}</td>
        <td><span class="st ${bucket(a)}">${stateText(a)}</span></td>
        <td>${esc(a.action)}</td>
        <td>${a.state === 'ACTIVE' ? `<button class="btn sm" data-ack="${a.id}" ${ui.can('ack') ? '' : 'disabled'}>Ack</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  function detail() {
    if (st.detail == null) return '<div class="muted" style="padding:12px">Select an alarm to see its context.</div>';
    let hit = null;
    M.sim.stands.forEach((r) => r.alarms.forEach((a) => { if (a.id === st.detail) hit = { r, a }; }));
    if (!hit) return '';
    const { r, a } = hit;
    const src = a.ch === 'brake'
      ? 'Hardware safety input. Always armed; cannot be masked in any test step.'
      : a.path === 'Manual control'
        ? 'Manual mode uses the setup-default limits. Pressure-low and speed-deviation alarms are masked in manual.'
        : `Limit taken from the thresholds of the step that was running. Thresholds inherit down the step grid unless overridden.`;
    return `<div class="al-detail">
      <div class="al-dh"><span class="badge ${a.sev === 'R' ? 'bad' : 'warn'}">${a.sev === 'R' ? 'RED' : 'YELLOW'}</span> <b>${esc(chName(a))}</b> on ${r.name}</div>
      <div class="kv"><span>Raised</span><b class="num">${ui.clock(a.t)}</b></div>
      <div class="kv"><span>Test step</span><b>${esc(a.path)}</b></div>
      <div class="kv"><span>Value / limit</span><b class="num">${val(a)} · ${lim(a)}</b></div>
      <div class="kv"><span>Response</span><b>${a.sev === 'R' ? 'Software shutdown sequence started' : 'None — advisory only. No effect on the stand.'}</b></div>
      <div class="kv"><span>State</span><b>${stateText(a)}</b></div>
      <div class="muted" style="margin-top:6px">${src}</div>
      ${a.ch !== 'brake' ? `<div style="margin-top:8px"><button class="btn sm" data-graph="${a.id}">Show on graph ▸</button></div>` : ''}
    </div>`;
  }

  function render(el) {
    root = el;
    const r = ui.rack();
    const c = counts();
    root.innerHTML = `<div class="al-wrap">
      <div class="al-bar">
        <span class="seg" data-scope>${[['rack', r.name], ['lab', 'Whole lab']].map(([k, l]) => `<button data-sc="${k}" class="${st.scope === k ? 'on' : ''}">${l}</button>`).join('')}</span>
        <span class="kpi sm"><span class="badge bad">RED</span><b>${c.red}</b> not cleared</span>
        <span class="kpi sm"><span class="badge warn">YELLOW</span><b>${c.yellow}</b> not cleared</span>
        <span class="kpi sm"><b>${c.un}</b> unacknowledged</span>
        <span class="sp" style="flex:1"></span>
        <label><input type="checkbox" data-show="un" ${st.show.un ? 'checked' : ''}> Unacknowledged</label>
        <label><input type="checkbox" data-show="ack" ${st.show.ack ? 'checked' : ''}> Acknowledged</label>
        <label><input type="checkbox" data-show="clr" ${st.show.clr ? 'checked' : ''}> Cleared</label>
        <select data-sev><option value="all">All severities</option><option value="R" ${st.sev === 'R' ? 'selected' : ''}>Red only</option><option value="Y" ${st.sev === 'Y' ? 'selected' : ''}>Yellow only</option></select>
      </div>
      <div class="al-body">
        <div class="panel al-list"><div class="gridwrap" style="border:0" data-tour="altable">${table()}</div></div>
        <div class="panel al-side pane"><div class="pchdr">${ui.paneBtn('al', 'right')}<span>Detail</span></div>${detail()}</div>
      </div>
      <div class="al-foot">
        <button class="btn" data-a="acksel" ${ui.can('ack') ? '' : 'disabled'}>Acknowledge selected</button>
        <button class="btn" data-a="ackall" ${ui.can('ack') ? '' : 'disabled'}>Acknowledge all ${st.scope === 'lab' ? 'in lab' : 'on ' + r.name}</button>
        <button class="btn" data-a="csv">Export alarm log (CSV)…</button>
        <span class="muted">Acknowledging stops the ribbon blinking. It does not dismiss the alarm or restart the stand.</span>
      </div>
    </div>`;
    wire();
  }

  function ack(r, id) { ui.cmd(r, 'ACK', id); }

  function wire() {
    root.onclick = (e) => {
      if (ui.panePick(e)) return;
      if (ui.panePick(e)) return;
      const t = e.target;
      if (t.dataset.sc) { st.scope = t.dataset.sc; st.sel.clear(); return render(root); }
      if (t.dataset.ack) { const tr = t.closest('tr'); ack(M.sim.rack(+tr.dataset.r), +t.dataset.ack); return render(root); }
      if (t.dataset.graph) {
        let hit; M.sim.stands.forEach((r) => r.alarms.forEach((a) => { if (a.id === +t.dataset.graph) hit = { r, a }; }));
        ui.graphFocus(hit.a.ch, hit.a.t); ui.go('graph', hit.r.id); return;
      }
      if (t.dataset.pick) { const id = +t.dataset.pick; t.checked ? st.sel.add(id) : st.sel.delete(id); return; }
      if (t.hasAttribute('data-all')) { rows().forEach(({ a }) => (t.checked ? st.sel.add(a.id) : st.sel.delete(a.id))); return render(root); }
      const b = t.closest('[data-a]');
      if (b && !b.disabled) {
        if (b.dataset.a === 'acksel') { M.sim.stands.forEach((r) => r.alarms.forEach((a) => { if (st.sel.has(a.id) && a.state === 'ACTIVE') ack(r, a.id); })); st.sel.clear(); }
        if (b.dataset.a === 'ackall') (st.scope === 'lab' ? M.sim.stands.filter((r) => r.status !== 'offline') : [ui.rack()]).forEach((r) => ack(r));
        if (b.dataset.a === 'csv') return exportCsv();
        return render(root);
      }
      const tr = t.closest('tr[data-id]');
      if (tr && t.tagName !== 'INPUT') { st.detail = +tr.dataset.id; render(root); }
    };
    root.querySelectorAll('[data-show]').forEach((c) => (c.onchange = () => { st.show[c.dataset.show] = c.checked; render(root); }));
    root.querySelector('[data-sev]').onchange = (e) => { st.sev = e.target.value; render(root); };
  }

  function exportCsv() {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [['Rack', 'Severity', 'Time', 'Test step', 'Channel', 'Value', 'Limit', 'State', 'Action'].join(',')];
    rows().forEach(({ r, a }) => lines.push([r.name, a.sev === 'R' ? 'RED' : 'YELLOW', ui.clock(a.t), a.path, chName(a), val(a), lim(a), stateText(a), a.action].map(q).join(',')));
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `alarms_${st.scope === 'lab' ? 'lab' : ui.rack().name.replace(' ', '')}.csv`;
    link.click();
    ui.toast('Alarm log exported — includes the test step for every alarm');
  }

  ui.screens.alarms = {
    render,
    tick() {
      if (!root || ++n % 2) return;
      if (root.querySelector('button:hover, input:hover, select:focus, label:hover')) return;
      const list = root.querySelector('[data-tour="altable"]');
      const scroll = list && list.parentElement.scrollTop;
      render(root);
      const again = root.querySelector('[data-tour="altable"]');
      if (again) again.parentElement.scrollTop = scroll;
    },
  };
})(globalThis.M = globalThis.M || {});
