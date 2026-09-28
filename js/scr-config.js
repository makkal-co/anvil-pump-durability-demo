// Stand Configuration: channels & calibration, sample rates with live storage estimate,
// hardware map, logging destination, users & permissions. Editing needs the Maintenance role.
(function (M) {
  const ui = M.ui, esc = ui.esc, P = M.prof;
  const st = { tab: 'channels', outage: false, pending: 0 };
  let root, r, n = 0;
  const DAY = 86400000;

  // ---- Per-stand configuration (lazily generated, illustrative) -------------
  const TC = ['tankT', 'sucT', 'dispT', 'hxInT', 'hxOutT', 'postHxT', 'sumpT', 'ambT', 'drvBrgT', 'pmpBrgT', 'filtT', 'motWindT'];
  const AV = [['speed', 0, 3000], ['torque', 0, 600], ['sysP', 0, 400], ['accP', 0, 400], ['bypP', 0, 400], ['caseP', 0, 10], ['sucP', 0, 5], ['hxInP', 0, 6], ['hxOutP', 0, 6], ['tankLvl', 0, 100]];
  const AI = [['dispF', 0, 150], ['caseF', 0, 15], ['hxF', 0, 60]];
  const OLD = { hxF: '2025-08-20', accP: '2025-08-11', torque: '2025-10-01' };

  function cfg(rack) {
    if (rack.cfg) return rack.cfg;
    const cal = {};
    const date = (ch, d) => new Date((OLD[ch] || d) + 'T09:00:00').getTime();
    TC.forEach((ch, i) => (cal[ch] = { kind: 'TC', module: i < 16 ? 'Slot 3 · NI-9213' : 'Slot 4 · NI-9213', term: 'ai' + (i < 16 ? i : i - 16), raw: 'Type K', eng: [-200, 1250], scale: null, offset: +((i % 5) * 0.1 - 0.2).toFixed(1), last: date(ch, '2026-06-14'), cert: 'AC-4' + (4100 + i), by: 'External cal. house' }));
    AV.forEach(([ch, lo, hi], i) => (cal[ch] = { kind: 'V', module: 'Slot 2 · NI-9205', term: 'ai' + i, raw: [0, 10], eng: [lo, hi], scale: (hi - lo) / 10, offset: lo, last: date(ch, '2026-07-02'), cert: 'AC-42' + (10 + i), by: 'External cal. house' }));
    AI.forEach(([ch, lo, hi], i) => (cal[ch] = { kind: 'I', module: 'Slot 1 · NI-9203', term: 'ai' + i, raw: [4, 20], eng: [lo, hi], scale: (hi - lo) / 16, offset: lo - ((hi - lo) / 16) * 4, last: date(ch, '2026-05-30'), cert: 'AC-43' + (30 + i), by: 'External cal. house' }));
    cal.speedDev = { kind: 'CALC', module: 'Calculated', term: '|cmd − actual|', raw: '—', eng: [0, 3000], scale: null, offset: null, last: null };
    rack.cfg = {
      cal,
      rates: { tc: { acq: 1, log: 1 }, av: { acq: 1000, log: 1 }, ai: { acq: 1000, log: 1 }, di: { acq: 100 } },
      stats: { mean: true, min: true, max: true, rms: true },
      trig: { red: true, yellow: true, manual: true, step: false },
      burstSec: 30,
      mirror: '\\\\lab-fs01\\rotf\\rack-' + String(rack.id).padStart(2, '0'),
      retention: 'Not yet defined',
    };
    return rack.cfg;
  }
  const dueOf = (c) => (c.last ? c.last + 365 * DAY : null);
  const calState = (c) => {
    if (!c.last) return ['', '—'];
    const d = dueOf(c) - M.sim.now;
    if (d < 0) return ['bad', 'OVERDUE'];
    if (d < 30 * DAY) return ['warn', 'due in ' + Math.ceil(d / DAY) + ' d'];
    return ['ok', 'OK'];
  };
  const ymd = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '—');
  const ro = () => !ui.can('cal');

  // ---- Tabs ------------------------------------------------------------------
  function tabChannels() {
    const c = cfg(r);
    const overdue = M.CH.filter((ch) => calState(c.cal[ch.id])[0] === 'bad').length;
    const soon = M.CH.filter((ch) => calState(c.cal[ch.id])[0] === 'warn').length;
    let grp = '';
    const rows = M.CH.map((ch, i) => {
      const k = c.cal[ch.id];
      const [cls, txt] = calState(k);
      const head = ch.group !== grp ? ((grp = ch.group), `<tr class="phase"><td colspan="12">${ch.group}</td></tr>`) : '';
      const raw = k.kind === 'TC' ? k.raw : k.kind === 'CALC' ? k.raw : `${k.raw[0]}–${k.raw[1]} ${k.kind === 'V' ? 'V' : 'mA'}`;
      return `${head}<tr class="row">
        <td class="id">${i + 1}</td><td><b>${esc(ch.name)}</b> <span class="chid" title="What a test setup's advance condition refers to">${esc(ch.id)}</span></td><td>${k.module}</td><td class="num">${k.term}</td>
        <td class="num">${raw}</td><td class="num">${k.kind === 'TC' ? '' : `${k.eng[0]}–${k.eng[1]}`} ${ch.unit}</td>
        <td class="num">${k.scale == null ? '—' : k.scale.toFixed(4)}</td><td class="num">${k.offset == null ? '—' : k.offset.toFixed(k.kind === 'TC' ? 1 : 3)}</td>
        <td class="num" data-live="${ch.id}">${ui.fmtU(ch.id, r.v[ch.id])}</td>
        <td class="num">${ymd(k.last)}</td><td>${k.last ? (cls === 'ok' ? '<span class="muted">OK</span>' : `<span class="badge ${cls}">${txt}</span>`) : ''}</td>
        <td>${k.kind === 'CALC' ? '' : `<button class="btn sm" data-map="${ch.id}">Map…</button> <button class="btn sm" data-cal="${ch.id}">${ro() ? 'View' : 'Calibrate…'}</button>`}</td></tr>`;
    }).join('');
    return `<div class="cfg-top">
        ${overdue ? `<span class="badge bad">${overdue} channel${overdue > 1 ? 's' : ''} overdue for calibration</span>` : ''}
        ${soon ? `<span class="badge warn">${soon} due within 30 days</span>` : ''}
        <span class="sp" style="flex:1"></span>
        <button class="btn sm" data-a="importcal" ${ro() ? 'disabled' : ''}>Import calibration sheet…</button>
        <button class="btn sm" data-a="exportcal">Export calibration sheet…</button>
      </div>
      <div class="gridwrap"><table class="grid"><thead><tr><th class="num">#</th><th>Channel</th><th>Module</th><th class="num">Terminal</th><th class="num">Raw</th><th class="num">Engineering range</th><th class="num">Scale</th><th class="num">Offset</th><th class="num">Live</th><th class="num">Last cal</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="mc-note">Channel <b>names</b> are lab-wide, so a setup built on one rack means the same thing on another; the <b>module and terminal</b> binding is per rack. Adding stand 11 should be this table plus a calibration sheet — never a code change.</div>
      <div class="mc-note">Open question — is a linear two-point fit always enough, or do some sensors need a polynomial or a lookup table? And does a screen like this hold the certificates and due dates, or does that belong in the quality system you already run?</div>`;
  }

  function calDialog(chId) {
    const ch = M.chById[chId], k = cfg(r).cal[chId], tc = k.kind === 'TC', lock = ro();
    const dis = lock ? 'disabled' : '';
    const rawNow = () => (tc ? r.v[chId] - k.offset : (r.v[chId] - k.offset) / k.scale);
    const p1 = tc ? null : [k.raw[0], k.eng[0]], p2 = tc ? null : [k.raw[1], k.eng[1]];
    const unitRaw = k.kind === 'V' ? 'V' : 'mA';
    const w = ui.modal({
      title: `${lock ? 'Calibration' : 'Calibrate'} — ${ch.name} (${k.module.split(' · ')[1]} · ${k.term})`,
      body: `${lock ? '<div class="banner">Read only — Maintenance role required to calibrate.</div>' : ''}
        ${tc ? `<div>Thermocouple (type K). Single-point <b>offset</b> correction against a reference.</div>
          <label>Reference reading <input id="c1" value="${(r.v[chId]).toFixed(1)}" ${dis}> °C</label>
          <div class="muted">Raw (uncorrected) reading now: <b class="num" id="cRaw">${rawNow().toFixed(2)} °C</b></div>`
        : `<div>Method: <b>two-point linear</b></div>
          <div class="cal2"><span>Point 1</span><input id="r1" value="${p1[0]}" ${dis}><span>${unitRaw} =</span><input id="e1" value="${p1[1]}" ${dis}><span>${ch.unit}</span>
          <span>Point 2</span><input id="r2" value="${p2[0]}" ${dis}><span>${unitRaw} =</span><input id="e2" value="${p2[1]}" ${dis}><span>${ch.unit}</span></div>`}
        <div class="calres" id="cRes"></div>
        <div class="cal2 meta"><span>Calibrated by</span><input id="cBy" value="${esc(k.by)}" ${dis} style="grid-column:span 4"><span></span>
          <span>Certificate #</span><input id="cCert" value="${esc(k.cert)}" ${dis} style="grid-column:span 4"><span></span></div>
        <div class="muted">Last calibrated ${ymd(k.last)} · due ${ymd(dueOf(k))}. In the mock, applying records the calibration but does not rescale the simulated reading.</div>`,
      buttons: lock ? [{ label: 'Close' }] : [{ label: 'Cancel' }, {
        label: 'Apply', cls: 'primary', onClick: (m) => {
          const g = (id) => +m.querySelector('#' + id).value;
          if (tc) k.offset = +(r.v[chId] - g('c1') + k.offset).toFixed(2);
          else {
            const s = (g('e2') - g('e1')) / (g('r2') - g('r1'));
            if (!isFinite(s)) { ui.toast('The two raw points must differ'); return false; }
            k.scale = s; k.offset = g('e1') - s * g('r1'); k.raw = [g('r1'), g('r2')]; k.eng = [g('e1'), g('e2')];
          }
          k.last = M.sim.now; k.by = m.querySelector('#cBy').value; k.cert = m.querySelector('#cCert').value;
          M.sim.cmdLog.unshift({ t: M.sim.now, rack: r.id, cmd: 'CALIBRATE', origin: 'LOCAL', user: ui.state.user.u, ok: true, note: '', detail: ch.name });
          ui.toast(`${ch.name} calibrated — recorded against certificate ${k.cert}`);
          render(root);
        },
      }],
    });
    const upd = () => {
      const res = w.querySelector('#cRes');
      if (tc) {
        const ref = +w.querySelector('#c1').value;
        res.innerHTML = `New offset <b class="num">${(r.v[chId] - ref + k.offset).toFixed(2)} °C</b>`;
      } else {
        const g = (id) => +w.querySelector('#' + id).value;
        const s = (g('e2') - g('e1')) / (g('r2') - g('r1')), o = g('e1') - s * g('r1');
        const raw = rawNow();
        res.innerHTML = isFinite(s)
          ? `Result: <b class="num">eng = ${s.toFixed(4)} × raw ${o >= 0 ? '+' : '−'} ${Math.abs(o).toFixed(4)}</b><br>Live raw <b class="num">${raw.toFixed(3)} ${unitRaw}</b> → <b class="num">${(s * raw + o).toFixed(ch.dp + 1)} ${ch.unit}</b>`
          : '<span style="color:var(--bad)">The two raw points must differ</span>';
      }
    };
    w.querySelectorAll('input').forEach((i) => (i.oninput = upd));
    upd();
  }

  // Channel mapping and naming. Manual Control is unusable without it — a
  // slider cannot be labelled "Boost pump" until something says which module channel that is.
  // Editing the binding is an Engineer action; calibrating the scale stays with Maintenance.
  const MODULES = ['Slot 1 · NI-9203', 'Slot 2 · NI-9205', 'Slot 3 · NI-9213', 'Slot 4 · NI-9213', 'Slot 5 · NI-9264', 'Slot 6 · NI-9435', 'Slot 7 · NI-9472'];
  function mapDialog(chId) {
    const ch = M.chById[chId], k = cfg(r).cal[chId];
    const lock = !ui.can('edit');
    const dis = lock ? 'disabled' : '';
    if (k.used === undefined) k.used = true;
    const w = ui.modal({
      title: `Channel mapping — ${ch.name}`,
      body: `${lock ? '<div class="banner">Read only — Engineer role required to change a mapping.</div>' : ''}
        <div class="cal2 meta">
          <span>Channel name</span><input id="mName" value="${esc(ch.name)}" ${dis} style="grid-column:span 4"><span></span>
          <span>Unit</span><input id="mUnit" value="${esc(ch.unit)}" ${dis} style="grid-column:span 4"><span></span>
          <span>Module</span><select id="mMod" ${dis} style="grid-column:span 4">${MODULES.map((m) => `<option ${m === k.module ? 'selected' : ''}>${m}</option>`).join('')}</select><span></span>
          <span>Terminal</span><input id="mTerm" value="${esc(k.term)}" ${dis} style="grid-column:span 4"><span></span>
        </div>
        <label style="display:block;margin-top:8px"><input type="checkbox" id="mUsed" ${k.used ? 'checked' : ''} ${dis}> Channel in use on this rack</label>
        <div class="muted">The name is lab-wide — renaming it here renames it on every screen and in exported files, so a setup stays portable between stands. The module and terminal are this rack's wiring.</div>
        <div class="mc-note">A rack that is running keeps running: a mapping change applies at the next test load, never mid-test.</div>`,
      buttons: lock ? [{ label: 'Close' }] : [{ label: 'Cancel' }, {
        label: 'Apply', cls: 'primary', onClick: (m) => {
          const name = m.querySelector('#mName').value.trim();
          if (!name) { ui.toast('A channel needs a name'); return false; }
          ch.name = name;
          ch.unit = m.querySelector('#mUnit').value.trim() || ch.unit;
          k.module = m.querySelector('#mMod').value;
          k.term = m.querySelector('#mTerm').value.trim();
          k.used = m.querySelector('#mUsed').checked;
          M.sim.cmdLog.unshift({ t: M.sim.now, rack: r.id, cmd: 'MAP_CHANNEL', origin: 'LOCAL', user: ui.state.user.u, ok: true, note: '', detail: `${name} → ${k.module} · ${k.term}` });
          ui.toast(`${name} mapped to ${k.module} · ${k.term}`);
          render(root);
        },
      }],
    });
    return w;
  }

  const RATE_OPTS = { tc: [1, 2, 4], av: [100, 1000, 5000, 10000], ai: [100, 1000, 5000, 10000], di: [10, 100, 1000] };
  const LOG_OPTS = [1, 5, 10, 100, 1000];
  const MODMAX = { tc: ['NI-9213', 75, 16], av: ['NI-9205', 250000, 16], ai: ['NI-9203', 200000, 8] };
  const GROUPS = [['tc', 'Thermocouples', 19], ['av', 'Analog 0–10 V', 9], ['ai', 'Analog 4–20 mA', 3], ['di', 'Digital inputs', 2]];

  function estimate(c) {
    const setup = r.setup || M.setupById('end2000');
    const T = P.total(setup);
    const stats = Math.max(1, ['mean', 'min', 'max', 'rms'].filter((s) => c.stats[s]).length);
    // Extra statistics only exist where the log rate is below the acquisition rate (something to decimate)
    const k = (g) => (c.rates[g].acq > c.rates[g].log ? stats : 1);
    const cont = (9 * c.rates.av.log * 4 * k('av') + 3 * c.rates.ai.log * 4 * k('ai') + 19 * c.rates.tc.log * 4 * k('tc')) * T;
    const bursts = (c.trig.red ? 5 : 0) + (c.trig.yellow ? 20 : 0) + (c.trig.manual ? 10 : 0) + (c.trig.step ? P.cycles(setup) : 0);
    const burst = bursts * 12 * c.rates.av.acq * 2 * c.burstSec * 4;
    const full = (12 * 1000 * 4 + 19 * 4) * T;
    return { setup, T, stats, cont, bursts, burst, total: cont + burst, full };
  }

  function tabRates() {
    const c = cfg(r), e = estimate(c), dis = ro() ? 'disabled' : '';
    const pct = (b) => Math.min(100, (b / 4e9) * 100);
    const rows = GROUPS.map(([g, label, count]) => {
      const rt = c.rates[g];
      const mm = MODMAX[g];
      const perCh = mm ? mm[1] / mm[2] : null;
      const warn = mm && rt.acq > perCh ? `<span class="badge bad">exceeds ${mm[0]} ≈ ${perCh.toFixed(perCh < 10 ? 1 : 0)} S/s per channel</span>` : '';
      return `<tr class="row"><td><b>${label}</b> <span class="muted">(${count})</span></td>
        <td><select data-rate="${g}.acq" ${dis}>${RATE_OPTS[g].map((o) => `<option ${rt.acq === o ? 'selected' : ''} value="${o}">${o.toLocaleString()} Hz</option>`).join('')}</select> ${warn}</td>
        <td>${g === 'di' ? '<span class="muted">on change</span>' : `<select data-rate="${g}.log" ${dis}>${LOG_OPTS.filter((o) => o <= rt.acq).map((o) => `<option ${rt.log === o ? 'selected' : ''} value="${o}">${o.toLocaleString()} Hz</option>`).join('')}</select>`}</td>
        <td>${g === 'av' || g === 'ai' ? `<span class="num">${rt.acq.toLocaleString()} Hz · ±${c.burstSec} s</span>` : '<span class="muted">n/a</span>'}</td></tr>`;
    }).join('');
    return `<div class="rates">
      <div class="panel">
        <div class="panel-h">Acquisition and logging tiers <span class="muted" style="font-weight:400">— rack level, not per test setup (spec)</span></div>
        <div class="gridwrap" style="border:0"><table class="grid"><thead><tr><th>Group</th><th>Acquire at</th><th>Log continuously at</th><th>Burst capture</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="rates-opts">
          <div><b>Keep per logged interval</b> ${['mean', 'min', 'max', 'rms'].map((s) => `<label><input type="checkbox" data-stat="${s}" ${c.stats[s] ? 'checked' : ''} ${dis}> ${s === 'rms' ? 'RMS' : s}</label>`).join('')}
            <div class="muted">Computed on the controller from the oversampled stream, so a transient between log points is never lost. DAQmx, not FPGA — at 1 Hz a gate array earns nothing.</div></div>
          <div><b>Trigger a burst on</b> ${[['red', 'red alarm'], ['yellow', 'yellow alarm'], ['manual', 'operator request'], ['step', 'every step change']].map(([k, l]) => `<label><input type="checkbox" data-trig="${k}" ${c.trig[k] ? 'checked' : ''} ${dis}> ${l}</label>`).join('')}
            <label style="margin-left:10px">window ± <select data-burst ${dis}>${[10, 30, 60, 120].map((s) => `<option ${c.burstSec === s ? 'selected' : ''}>${s}</option>`).join('')}</select> s</label></div>
          <div class="muted">A step's own log rate in the test setup overrides the continuous rate for that step.</div>
        </div>
      </div>
      <div class="panel" data-tour="estimate">
        <div class="panel-h">Storage estimate <span class="muted" style="font-weight:400">— for ${r.setup ? 'the loaded test' : 'a reference test'}: ${esc(e.setup.name)}_Rev${esc(e.setup.rev)} · ${Math.round(e.T / 3600).toLocaleString()} h</span></div>
        <div class="est">
          <div class="estrow"><span>Continuous log (analog keeps ${e.stats} value${e.stats > 1 ? 's' : ''} per interval)</span><b class="num">${P.fmtBytes(e.cont)}</b></div>
          <div class="estrow"><span>Burst captures (≈ ${e.bursts.toLocaleString()} events)</span><b class="num">${P.fmtBytes(e.burst)}</b></div>
          <div class="estrow tot"><span>Total for this test</span><b class="num ${e.total > 4e9 ? 'store-bad' : ''}">${P.fmtBytes(e.total)}</b></div>
          <div class="gauge"><i style="width:${pct(e.total)}%;${e.total > 4e9 ? 'background:var(--bad)' : ''}"></i><span>${((e.total / 4e9) * 100).toFixed(0)}% of 4 GB controller storage</span></div>
          <div class="estrow cmp"><span>Same test at 1 kHz continuous, all channels</span><b class="num store-bad">${P.fmtBytes(e.full)}</b></div>
          <div class="gauge"><i style="width:100%;background:var(--bad)"></i><span>${Math.round(e.full / 4e9).toLocaleString()}× the controller's storage</span></div>
          <div class="muted">4 GB is from the RFQ BOM — to verify. Logs are also mirrored off the controller (Logging tab).</div>
        </div>
      </div>
    </div>`;
  }

  const SLOTS = [
    { mod: 'NI-9203', what: 'Analog in · 4–20 mA', used: 3, of: 8 },
    { mod: 'NI-9205', what: 'Analog in · ±10 V', used: 9, of: 16 },
    { mod: 'NI-9213', what: 'Thermocouple', used: 16, of: 16 },
    { mod: 'NI-9213', what: 'Thermocouple', used: 3, of: 16 },
    { mod: 'NI-9264', what: 'Analog out · ±10 V', used: 4, of: 16 },
    { mod: 'NI-9435', what: 'Digital in · 24 VDC', used: 2, of: 4 },
    { mod: 'NI-9472', what: 'Digital out · 24 VDC', used: 4, of: 8 },
    null,
  ];
  function tabHardware() {
    const load = 22 + Math.round(6 * Math.sin(M.sim.now / 9e5));
    const slots = SLOTS.map((s, i) => s
      ? `<div class="slot"><div class="sn">Slot ${i + 1}</div><div class="sm">${s.mod}</div><div class="sw">${s.what}</div>
          <div class="sbar"><i style="width:${(s.used / s.of) * 100}%"></i></div><div class="su"><i class="led ok"></i> ${s.used}/${s.of} ch</div></div>`
      : `<div class="slot spare"><div class="sn">Slot ${i + 1}</div><div class="sm">SPARE</div><div class="sw">The only free slot</div></div>`).join('');
    const out = [
      ['NI-9264 · ao0', 'Drive speed command', '0–10 V → main drive'], ['NI-9264 · ao1', 'Boost pump speed', '0–10 V → drive'], ['NI-9264 · ao2', 'Cooler fan speed', '0–10 V → drive'], ['NI-9264 · ao3', 'Load valve opening', '0–10 V → proportional relief valve'],
      ['NI-9472 · do0', 'Tank heater contactor', '24 VDC'], ['NI-9472 · do1', 'Cooler heater contactor', '24 VDC'], ['NI-9472 · do2', 'Cooler bypass valve', '24 VDC'], ['NI-9472 · do3', 'Safety control relay', '24 VDC — hard shutdown only'],
      ['NI-9435 · di0', 'Stand power on', '24 VDC from control relay'], ['NI-9435 · di1', 'Braking resistor trip', '24 VDC from main VFD'],
    ];
    return `<div class="hw">
      <div class="panel">
        <div class="panel-h">cRIO-9047 chassis <span class="muted" style="font-weight:400">— ${r.name}</span><span class="sp"></span><span class="badge warn" title="From the RFQ BOM; confirm against the datasheet">verify: 8 slots</span></div>
        <div class="chassis"><div class="ctrl"><b>cRIO-9047</b><div>NI Linux RT 64-bit</div><div class="num">10.20.3.${10 + r.id}</div><div><i class="led ok"></i> Scan Engine</div></div>${slots}</div>
        <div class="mc-note">Seven modules fill seven of eight slots. The spare <b>channels</b> are generous (13 thermocouple, 7 voltage, 5 current), but only one <b>slot</b> is left for a new module type.</div>
      </div>
      <div class="hw-2">
        <div class="panel">
          <div class="panel-h">Controller health</div>
          <div class="est">
            <div class="estrow"><span>CPU load</span><b class="num">${load}%</b></div><div class="gauge"><i style="width:${load}%"></i></div>
            <div class="estrow"><span>Memory</span><b class="num">1.3 / 4 GB</b></div><div class="gauge"><i style="width:32%"></i></div>
            <div class="estrow"><span>Storage</span><b class="num">0.9 / 4 GB</b></div><div class="gauge"><i style="width:22%"></i></div>
            <div class="estrow"><span>Time sync</span><b><i class="led ok"></i> NTP · offset 3 ms</b></div>
            <div class="muted">Open question — is NTP enough, or do stands need IEEE 1588 for tight cross-stand correlation?</div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-h">Outputs and safety inputs</div>
          <div class="gridwrap" style="border:0"><table class="grid"><thead><tr><th>Terminal</th><th>Function</th><th>Signal</th></tr></thead>
          <tbody>${out.map(([t, f, s]) => `<tr class="row"><td class="num">${t}</td><td>${f}</td><td class="muted">${s}</td></tr>`).join('')}</tbody></table></div>
        </div>
      </div>
    </div>`;
  }

  function tabLogging() {
    const c = cfg(r), dis = ro() ? 'disabled' : '';
    const name = r.setup ? `${r.name.replace(' ', '')}_${r.setup.name}_Rev${r.setup.rev}_${ymd(r.startedAt).replace(/-/g, '')}` : `${r.name.replace(' ', '')}_<setup>_Rev<rev>_<date>`;
    return `<div class="rates">
      <div class="panel">
        <div class="panel-h">Where data goes</div>
        <div class="est">
          <div class="flow">
            <div class="fbox"><b>cRIO DAQmx + RT</b><div class="muted">oversampled stream · min/max/RMS · burst buffer</div></div><span>→</span>
            <div class="fbox"><b>cRIO local buffer</b><div class="muted">TDMS · 4 GB</div></div><span>→</span>
            <div class="fbox ${st.outage ? 'down' : ''}"><b>Network share</b><div class="muted num">${esc(c.mirror)}</div></div>
          </div>
          <div class="estrow"><span>File</span><b class="num">${esc(name)}_part###.tdms</b></div>
          <div class="estrow"><span>New file segment every</span><select ${dis}><option>24 h</option><option>12 h</option><option>1 000 000 samples</option></select></div>
          <div class="estrow"><span>Mirror status</span><b>${st.outage ? `<span class="badge bad">share unreachable</span> <span class="num">${st.pending} file segments buffered locally</span>` : '<span class="badge run">in sync</span> <span class="muted">last copy 42 s ago</span>'}</b></div>
          <div class="estrow"><span>Retention on share</span><b class="muted">${esc(c.retention)}</b></div>
          <div><button class="btn sm" data-a="outage">${st.outage ? 'Restore network share' : 'Simulate network share outage'}</button> <span class="muted">demo only</span></div>
          <div class="mc-note">Store and forward: if the share goes away the controller keeps logging locally and back-fills when it returns. Nothing about a running test depends on the network (failure-mode table, Concepts §3.7).</div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-h">Export formats</div>
        <div class="est">
          <label><input type="checkbox" checked disabled> TDMS — native; opens in Excel, DIAdem, MATLAB</label>
          <label><input type="checkbox" ${dis}> CSV on export</label>
          <label><input type="checkbox" ${dis}> MATLAB .mat on export</label>
          <div class="muted">Open question — which formats does the lab actually need? Often a spreadsheet, then a script, then graphs.</div>
        </div>
      </div>
    </div>`;
  }

  function tabUsers() {
    const nomask = panelNoMask();
    const acts = [['View all screens', 0], ['Acknowledge alarms', 1], ['Software & hard shutdown', 1], ['Load and start a test', 1], ['Edit test setups', 2], ['Manual control of outputs', 2], ['Calibrate channels, rates, logging', 3], ['Manage users', 3]];
    const roles = ['Viewer', 'Operator', 'Engineer', 'Maintenance'];
    const rank = { Viewer: 0, Operator: 1, Engineer: 2, Maintenance: 3 };
    const remote = { 0: true, 2: true };
    return `<div class="rates">
      <div class="panel">
        <div class="panel-h">Users</div>
        <div class="gridwrap" style="border:0"><table class="grid"><thead><tr><th>User</th><th>Name</th><th>Role</th><th>Remote access</th></tr></thead>
        <tbody>${M.USERS.map((u) => `<tr class="row"><td class="num">${u.u}</td><td>${esc(u.name)}</td><td><select ${ro() ? 'disabled' : ''}>${roles.map((x) => `<option ${x === u.role ? 'selected' : ''}>${x}</option>`).join('')}</select></td><td>${u.role === 'Viewer' ? '<span class="muted">view</span>' : 'view + stop'}</td></tr>`).join('')}</tbody></table></div>
        <div class="mc-note">Open question — are these the right roles, and who holds each? Often tied to an existing directory service in a later phase.</div>
      </div>
      <div class="panel">
        <div class="panel-h">Permissions</div>
        <div class="gridwrap" style="border:0"><table class="grid perm"><thead><tr><th>Action</th>${roles.map((x) => `<th>${x}</th>`).join('')}<th>Remote (any role)</th></tr></thead>
        <tbody>${acts.map(([a, need], i) => `<tr class="row"><td>${a}</td>${roles.map((x) => `<td>${rank[x] >= need ? '✓' : ''}</td>`).join('')}<td>${remote[i] ? '✓' : '<span class="muted">✗</span>'}</td></tr>`).join('')}</tbody></table></div>
        <div class="mc-note">The remote column is enforced by the stand controller's command handler, not by hiding buttons. A remote Engineer still cannot start a test.</div>
      </div>
      ${nomask}
    </div>`;
  }

  // The locked reds are a lab policy, not a hard-coded opinion. Maintenance can change the
  // list here; the brake trip is a hardware safety input and is never on it.
  function panelNoMask() {
    const lock = ro();
    const rows = M.TH.filter((t) => t.ch !== 'speedDev').map((t) => {
      const on = M.NOMASK_RED.includes(t.ch);
      return `<tr class="row"><td><b>${esc(M.chById[t.ch].name)}</b></td>
        <td style="text-align:center"><input type="checkbox" data-nomask="${t.ch}" ${on ? 'checked' : ''} ${lock ? 'disabled' : ''}></td>
        <td class="muted">${on ? 'red is protected on every step of every setup' : 'red may be masked per step'}</td></tr>`;
    }).join('');
    return `<div class="panel span-all">
      <div class="panel-h">Alarm policy <span class="muted" style="font-weight:400">— which red alarms no test setup may mask</span></div>
      <div class="gridwrap" style="border:0"><table class="grid"><thead><tr><th>Channel</th><th style="width:90px;text-align:center">Never mask</th><th>Effect</th></tr></thead><tbody>${rows}
        <tr class="row"><td><b>Braking resistor trip</b></td><td style="text-align:center"><input type="checkbox" checked disabled></td><td class="muted">hardware safety input — not a policy choice</td></tr>
      </tbody></table></div>
      <div class="mc-note">This list is what the padlocks in a test setup's <b>Alarm masks</b> tab are reading: a red tick there cannot be cleared while the channel is protected here. Maintenance owns it here — whether that is the right role depends on whether the lab has an on-site administrator, which many do not.</div>
      <div class="mc-note">Yellow alarms stay maskable on every channel: the lab masks low pressures through start-up, and that is normal. It is the <b>red</b> action — which runs the software shutdown — that this list protects. Changing it is recorded in the command log.</div>
    </div>`;
  }

  // ---- Frame -----------------------------------------------------------------
  const TABS = [['channels', 'Channels & calibration'], ['rates', 'Sample rates & storage'], ['hardware', 'Hardware map'], ['logging', 'Logging'], ['users', 'Users & permissions']];
  function render(el) {
    root = el; r = ui.rack();
    if (r.status === 'offline') {
      root.innerHTML = `<div class="placeholder"><h2>${r.name} — ${esc(ui.rackState(r).text)}</h2><p>${esc(r.reason)}</p><p>Configuration is stored on the stand controller and is unavailable while it is unreachable.</p></div>`;
      return;
    }
    const scroll = root.querySelector('.cfg-body') ? root.querySelector('.cfg-body').scrollTop : 0;
    root.innerHTML = `<div class="cfg">
      ${ro() ? `<div class="banner">Signed in as <b>${ui.state.user.role}</b> — configuration is read-only. Maintenance can edit.</div>` : ''}
      <div class="tabs cfg-tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="cfg-body">${{ channels: tabChannels, rates: tabRates, hardware: tabHardware, logging: tabLogging, users: tabUsers }[st.tab]()}</div>
    </div>`;
    root.querySelector('.cfg-body').scrollTop = scroll;
    wire();
  }

  function wire() {
    const c = cfg(r);
    root.onclick = (e) => {
      const t = e.target;
      if (t.dataset.tab) { st.tab = t.dataset.tab; root.querySelector('.cfg-body') && (root.querySelector('.cfg-body').scrollTop = 0); return render(root); }
      if (t.dataset.map) return mapDialog(t.dataset.map);
      if (t.dataset.cal) return calDialog(t.dataset.cal);
      const a = t.closest('[data-a]');
      if (!a || a.disabled) return;
      if (a.dataset.a === 'outage') { st.outage = !st.outage; if (!st.outage) { ui.toast(`Share back — back-filling ${st.pending} buffered segments`); st.pending = 0; } render(root); }
      if (a.dataset.a === 'exportcal') ui.toast('Would export the calibration table as CSV for the calibration house');
      if (a.dataset.a === 'importcal') ui.toast('Would import a calibration sheet and show a diff before applying');
    };
    root.querySelectorAll('[data-rate]').forEach((s) => (s.onchange = () => {
      const [g, f] = s.dataset.rate.split('.');
      c.rates[g][f] = +s.value;
      if (f === 'acq' && c.rates[g].log > c.rates[g].acq) c.rates[g].log = c.rates[g].acq;
      render(root);
    }));
    root.querySelectorAll('[data-nomask]').forEach((cb) => (cb.onchange = () => {
      const ch = cb.dataset.nomask, i = M.NOMASK_RED.indexOf(ch);
      if (cb.checked && i < 0) M.NOMASK_RED.push(ch);
      if (!cb.checked && i >= 0) M.NOMASK_RED.splice(i, 1);
      M.sim.cmdLog.unshift({ t: M.sim.now, rack: r.id, cmd: 'ALARM_POLICY', origin: 'LOCAL', user: ui.state.user.u, ok: true, note: '', detail: `${M.chById[ch].name} red ${cb.checked ? 'protected' : 'maskable'}` });
      ui.toast(`${M.chById[ch].name}: red alarm ${cb.checked ? 'can no longer be masked' : 'may now be masked per step'}`);
      render(root);
    }));
    root.querySelectorAll('[data-stat]').forEach((s) => (s.onchange = () => { c.stats[s.dataset.stat] = s.checked; render(root); }));
    root.querySelectorAll('[data-trig]').forEach((s) => (s.onchange = () => { c.trig[s.dataset.trig] = s.checked; render(root); }));
    const b = root.querySelector('[data-burst]'); if (b) b.onchange = () => { c.burstSec = +b.value; render(root); };
  }

  ui.configTab = (t) => (st.tab = t);

  // Live values are patched cell by cell. A full re-render would destroy whatever the
  // reader had selected, and the browser's find-in-page highlight with it.
  function refreshLive() {
    root.querySelectorAll('[data-live]').forEach((td) => {
      const v = ui.fmtU(td.dataset.live, r.v[td.dataset.live]);
      if (td.textContent !== v) td.textContent = v;
    });
  }

  ui.screens.config = {
    render,
    tick() {
      if (!root || !r || r.status === 'offline' || ++n % 4) return;
      if (st.outage) st.pending += 1;
      if (document.querySelector('.modal') || root.querySelector('select:focus, button:hover, input:focus')) return;
      if (st.tab === 'channels') return refreshLive();
      if (st.tab !== 'users') render(root);
    },
  };
})(globalThis.M = globalThis.M || {});
