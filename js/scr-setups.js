// Test Setups: library, common parameters, step grid (setpoints / thresholds / alarm masks),
// profile preview, validation, versioned save, export/import as readable JSON.
(function (M) {
  const ui = M.ui, esc = ui.esc, P = M.prof;
  const st = { id: 'end2000', draft: null, dirty: false, tab: 'sp', sel: null, errors: {} };
  let root;

  const LIMITS = { motor: [0, 3000], boostPump: [0, 100], coolFan: [0, 100], loadValve: [0, 100], tankT: [0, 120], coolerT: [0, 120] };
  const SP_COLS = [['motor', 'Drive', 'rpm'], ['boostPump', 'Boost pump', '%'], ['coolFan', 'Cooler fan', '%'], ['loadValve', 'Load valve', '%'], ['tankT', 'Tank T', '°C target'], ['coolerT', 'Cooler T', '°C target']];
  const LOG_OPTS = [null, 1, 5, 10, 100, 1000];
  const OPS = ['≥', '>', '≤', '<'];
  // A conditional step that never meets its condition must do something explicit.
  const TIMEOUT_ACTS = [['ABORT', 'run the shutdown phase', 'The rig did not reach the condition, so the test stops safely. The default.'],
                        ['HOLD', 'hold for the operator', 'Freezes at this step and raises an alarm; someone decides.'],
                        ['CONTINUE', 'carry on to the next step', 'Only safe where the condition is a convenience, not a precondition.']];
  // One column model per tab: the widths the grid opens at, and whether the column holds
  // numbers (so the header sits over the figures rather than away from them). Widths are
  // draggable and kept per tab, the way a spreadsheet behaves.
  const COLS = {
    sp: () => [
      { k: 'n', label: '#', w: 40 },
      { k: 'type', label: 'Type', w: 116 },
      { k: 'name', label: 'Step name', w: 190 },
      { k: 'dur', label: 'Duration', sub: 'or repeat', w: 96, num: true },
      { k: 'adv', label: 'Advance when', w: 266 },
      ...SP_COLS.map(([f, l, u]) => ({ k: f, label: l, sub: u, w: 80, num: true })),
      { k: 'log', label: 'Log rate', sub: 'Hz', w: 104 },
    ],
    th: () => [
      { k: 'n', label: '#', w: 40 },
      { k: 'name', label: 'Step name', w: 210 },
      ...M.TH.map((t) => ({ k: t.ch, label: t.short + (t.hint ? ' ⓘ' : ''), sub: `${M.chById[t.ch].unit} · ${t.dir === 'high' ? 'alarm above' : 'alarm below'}`, w: 124, hint: t.hint })),
    ],
    mask: () => [
      { k: 'n', label: '#', w: 40 },
      { k: 'name', label: 'Step name', w: 210 },
      ...M.TH.map((t) => ({ k: t.ch, label: t.short + (t.hint ? ' ⓘ' : ''), w: 96, hint: t.hint })),
      { k: 'brake', label: 'Brake trip', w: 96 },
    ],
  };
  const colw = {};                       // tab -> { colKey: px }, whatever the reader dragged
  function cols(tab) {
    return COLS[tab]().map((c) => Object.assign({}, c, { w: (colw[tab] || {})[c.k] || c.w }));
  }
  function head(tab) {
    const cs = cols(tab);
    return `<colgroup>${cs.map((c) => `<col style="width:${c.w}px">`).join('')}</colgroup>
      <thead><tr>${cs.map((c, i) => `<th class="${c.num ? 'num' : ''}"${c.hint ? ` title="${esc(c.hint)}"` : ''}>${c.label}${c.sub ? `<small>${c.sub}</small>` : ''}${i < cs.length - 1 ? `<span class="rz" data-rz="${i}" title="Drag to resize"></span>` : ''}</th>`).join('')}</tr></thead>`;
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const editable = () => ui.can('edit');

  // Conditions used to be free text ("hxF > 5"): a channel id nobody outside the team
  // recognises, no unit, and a string for the controller to parse. They are now
  // {ch, op, v} so the editor can offer real channel names and show the unit.
  function normUntil(u) {
    if (u && typeof u === 'object') return u;
    const m = String(u || '').match(/^\s*(\w+)\s*(≥|>|≤|<)\s*(-?[\d.]+)/);
    return m ? { ch: m[1], op: m[2], v: +m[3] } : { ch: 'tankT', op: '≥', v: 80 };
  }
  function migrate(s) {
    P.walk(s, ({ item }) => {
      if (item.type !== 'DWELL_UNTIL') return;
      item.until = normUntil(item.until);
      if (!item.onTimeout) item.onTimeout = 'ABORT';
    });
    return s;
  }
  M.untilText = (u) => {
    const c = normUntil(u), ch = M.chById[c.ch];
    return ch ? `${ch.name} ${c.op} ${c.v} ${ch.unit}` : `${c.ch} ${c.op} ${c.v}`;
  };

  function load(id) {
    st.id = id;
    st.draft = migrate(clone(M.setupById(id)));
    st.dirty = false; st.sel = null; st.errors = {}; st.resetScroll = true;
  }

  // ---- Structure helpers --------------------------------------------------
  function locateItem(item) {
    let found = null;
    const rec = (arr, depth, phase) => arr.forEach((it, idx) => {
      if (found) return;
      if (it === item) found = { arr, idx, depth, phase };
      else if (it.type === 'BLOCK') rec(it.steps, depth + 1, phase);
    });
    P.PHASES.forEach((ph) => rec(st.draft.phases[ph], 0, ph));
    return found;
  }
  function renumber() {
    let b = 0;
    const n = { startup: 0, main: 0, shutdown: 0 }, pre = { startup: 'S', main: '', shutdown: 'E' };
    P.walk(st.draft, ({ item, phase }) => { item.id = item.type === 'BLOCK' ? 'B' + ++b : pre[phase] + ++n[phase]; });
  }
  const newStep = (type) => ({ id: '', type, name: type === 'HOLD' ? 'Operator check' : 'New step', dur: type === 'HOLD' ? 0 : 600, sp: { motor: 0, boostPump: 0, coolFan: 0, loadValve: 100, tankT: null, coolerT: null }, logHz: null, until: type === 'DWELL_UNTIL' ? { ch: 'tankT', op: '≥', v: 80 } : undefined, onTimeout: type === 'DWELL_UNTIL' ? 'ABORT' : undefined });

  // ---- Parsing & validation ----------------------------------------------
  function parseDur(s) {
    s = String(s).trim();
    let m;
    if ((m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/))) return +m[1] * 3600 + +m[2] * 60 + +m[3];
    if ((m = s.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
    if ((m = s.match(/^([\d.]+)\s*h$/i))) return Math.round(+m[1] * 3600);
    if ((m = s.match(/^([\d.]+)\s*m(in)?$/i))) return Math.round(+m[1] * 60);
    if ((m = s.match(/^\d+$/))) return +s;
    return NaN;
  }
  function validate() {
    const e = {};
    P.walk(st.draft, ({ item }) => {
      const k = P.rowKey(null, item);
      if (item.type === 'BLOCK') {
        if (!(Number.isInteger(item.repeat) && item.repeat >= 1 && item.repeat <= 1e6)) e[k + ':repeat'] = `${item.id}: repeat must be a whole number 1–1,000,000`;
        return;
      }
      if (item.type !== 'HOLD' && !(item.dur > 0)) e[k + ':dur'] = `${item.id} ${item.name}: ${item.type === 'DWELL_UNTIL' ? 'timeout' : 'duration'} must be greater than zero`;
      if (item.type === 'DWELL_UNTIL') {
        const u = normUntil(item.until);
        if (!M.chById[u.ch]) e[k + ':until'] = `${item.id} ${item.name}: pick a channel for the advance condition`;
        else if (u.v == null || isNaN(u.v)) e[k + ':until'] = `${item.id} ${item.name}: the advance condition needs a number`;
      }
      SP_COLS.forEach(([f, label]) => {
        const v = item.sp[f];
        if (v == null && (f === 'tankT' || f === 'coolerT')) return;
        const [lo, hi] = LIMITS[f];
        if (v == null || isNaN(v) || v < lo || v > hi) e[k + ':' + f] = `${item.id} ${item.name}: ${label} must be ${lo}–${hi}`;
      });
      if (item.th) Object.entries(item.th).forEach(([ch, [y, r]]) => checkPair(e, k, ch, y, r, `${item.id} ${item.name}`));
    });
    Object.entries(st.draft.base).forEach(([ch, [y, r]]) => checkPair(e, 'base', ch, y, r, 'Setup defaults'));
    st.errors = e;
  }
  function checkPair(e, k, ch, y, r, who) {
    const t = M.TH.find((x) => x.ch === ch);
    if (isNaN(y) || isNaN(r)) e[k + ':th:' + ch] = `${who}: ${t.short} limits must be numbers`;
    else if (t.dir === 'high' ? y >= r : y <= r) e[k + ':th:' + ch] = `${who}: ${t.short} — red must be ${t.dir === 'high' ? 'above' : 'below'} yellow`;
  }

  // ---- Rendering ------------------------------------------------------------
  function render(el) {
    root = el;
    if (!st.draft) load(st.id);
    const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
    // A long setup is taller than the screen: rebuilding the DOM must not throw the reader
    // back to the top of the page or to the left of the grid.
    const keepMain = st.resetScroll ? 0 : (root.querySelector('.ts-main') || {}).scrollTop || 0;
    const keepGrid = st.resetScroll ? 0 : (root.querySelector('.gridwrap') || {}).scrollLeft || 0;
    st.resetScroll = false;
    renumber(); validate();
    const s = st.draft, ro = !editable();
    const errs = Object.values(st.errors);
    const stor = P.storage(s), stor1k = P.storage(s, 1000);
    const orig = M.setupById(st.id);

    root.innerHTML = `
    <div class="ts">
      <div class="ts-lib pane">
        <div class="panel-h pchdr">${ui.paneBtn('lib', 'left')}<span>Saved setups</span></div>
        <div class="list">${M.SETUPS.map((x) => `<div class="li ${x.id === st.id ? 'on' : ''}" data-lib="${x.id}">
          <div><b>${esc(x.name)}</b>_Rev${esc(x.rev)}</div>
          <div class="meta">${Math.round(P.total(x) / 3600).toLocaleString()} h · ${P.cycles(x).toLocaleString()} cycles ${x.used ? '· 🔒 has been run' : ''}</div></div>`).join('')}</div>
        <div class="acts">
          <button class="btn sm" data-a="new" ${ro ? 'disabled' : ''} title="Start a new setup, copied from an existing one or blank. Unrelated to the setup open on the right.">New setup…</button>
          <button class="btn sm" data-a="import" ${ro ? 'disabled' : ''}>Import file…</button>
          <button class="btn sm" data-a="export">Export to file…</button>
          <input type="file" id="tsFile" accept=".json" hidden>
        </div>
      </div>
      <div class="ts-main">
        ${ro ? `<div class="banner">Signed in as <b>${ui.state.user.role}</b> — setups are read-only. Engineers and Maintenance can edit.</div>` : ''}
        <div class="ts-title">
          <h2>${esc(s.name)}<span class="muted">_Rev${esc(s.rev)}</span></h2>
          ${st.dirty ? '<span class="badge warn">unsaved changes</span>' : ''}
          ${orig && orig.used ? '<span class="lock" title="A revision that has been run is kept unchanged for traceability">🔒 This revision has been run — saving creates a new revision</span>' : ''}
          <span class="sp"></span>
          <button class="btn" data-a="revert" ${st.dirty ? '' : 'disabled'}>Revert</button>
          <button class="btn" data-a="saveas" ${ro || errs.length ? 'disabled' : ''} title="Keep this setup, store the edits as its next revision">Save as revision…</button>
          <button class="btn primary" data-a="save" ${ro || !st.dirty || errs.length ? 'disabled' : ''}>Save</button>
        </div>

        <div class="panel" data-tour="common">
          <div class="panel-h">Common parameters<span class="muted" style="font-weight:400">— shortcuts into the grid below. Each one writes the same value into every step it covers; the stand runs the grid, never this panel.</span>
            <span class="sp"></span>
            <button class="btn sm" data-a="editcommon" ${ro ? 'disabled' : ''} title="Choose which values this setup exposes here">Choose…</button>
          </div>
          <div class="common">${s.common.length ? s.common.map((c, i) => `<label><span class="cl">${esc(c.label)}</span><span class="cin"><input data-common="${i}" data-k="common:${i}" value="${commonValue(c) ?? ''}" ${ro ? 'disabled' : ''}> <span class="muted">${esc(c.unit)}</span></span><span class="cbind">${esc(bindText(c))}</span></label>`).join('') : '<span class="muted">None chosen for this setup — use <b>Choose…</b> to pick the values operators change between runs.</span>'}</div>
        </div>

        <div>
          <div class="tabs" data-tour="tabs">
            ${[['sp', 'Setpoints & timing'], ['th', 'Thresholds'], ['mask', 'Alarm masks']].map(([k, l]) => `<button data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}
            <span style="flex:1"></span>
            <button class="btn sm" data-a="wide" title="Collapse every side pane so the grid has the window">${ui.panesCollapsed() ? '⇲ Show panes' : '⇱ Wide view'}</button>
            <span class="muted" style="align-self:center;font-size:12px">${st.tab === 'th' ? 'Grey italic = inherited from the row above · bold = set on this step' : st.tab === 'mask' ? 'Y = yellow armed, R = red armed · untick to mask for that step' : 'Durations as hh:mm:ss, 45m or 3h · a loop runs from its ▼ row to its ▲ end row'}</span>
          </div>
          <div class="gridwrap" data-tour="grid">${st.tab === 'sp' ? gridSp(ro) : st.tab === 'th' ? gridTh(ro) : gridMask(ro)}</div>
          <div class="ts-tools">
            <button class="btn sm" data-a="addstep" ${ro ? 'disabled' : ''}>+ Step ▾</button>
            <button class="btn sm" data-a="addblock" ${ro ? 'disabled' : ''}>+ Loop block</button>
            <button class="btn sm" data-a="group" ${ro || !st.sel || st.sel.type === 'BLOCK' ? 'disabled' : ''} title="Wrap the selected step in a new loop — that sets the loop's start and end">Make loop</button>
            <button class="btn sm" data-a="in" ${ro || !st.sel ? 'disabled' : ''} title="Move the selected step into the loop directly above it">⇥ Into loop</button>
            <button class="btn sm" data-a="out" ${ro || !st.sel ? 'disabled' : ''} title="Move the selected step out of its loop, to just after the loop end">⇤ Out of loop</button>
            <button class="btn sm" data-a="ungroup" ${ro || !st.sel || st.sel.type !== 'BLOCK' ? 'disabled' : ''} title="Dissolve the selected loop, keeping its steps in place">Ungroup</button>
            <button class="btn sm" data-a="dup" ${ro || !st.sel ? 'disabled' : ''}>Duplicate</button>
            <button class="btn sm" data-a="del" ${ro || !st.sel ? 'disabled' : ''}>Delete</button>
            <button class="btn sm" data-a="up" ${ro || !st.sel ? 'disabled' : ''}>▲</button>
            <button class="btn sm" data-a="down" ${ro || !st.sel ? 'disabled' : ''}>▼</button>
            <span class="sp"></span>
            ${errs.length ? `<span class="valmsg">⚠ ${errs.length} problem${errs.length > 1 ? 's' : ''} — save disabled: ${esc(errs[0])}${errs.length > 1 ? ' …' : ''}</span>` : '<span class="muted">✓ Valid</span>'}
          </div>
        </div>

        <div class="panel preview" data-tour="preview">
          <div class="panel-h">Profile preview<span class="muted" style="font-weight:400">— what this setup will command. Not to scale: each step equal width, loops drawn once with ×N.</span>
            <span class="sp"></span><span class="legend"><span><i style="background:#1f5fbf"></i>Drive</span><span><i style="background:#d9480f"></i>Tank T target</span><span><i style="background:#2b8a3e"></i>Cooler T target</span></span></div>
          <canvas id="tsPrev"></canvas>
          <div class="ts-foot" data-tour="storage">
            <span>Total nominal duration <b>${Math.round(P.total(s) / 3600).toLocaleString()} h</b></span>
            <span>Cycles <b>${P.cycles(s).toLocaleString()}</b></span>
            <span>Est. storage at step log rates <b>${P.fmtBytes(stor.total)}</b></span>
            <span class="store-bad">At 1 kHz continuous: ${P.fmtBytes(stor1k.total)} — controller holds 4 GB</span>
            <span class="sp" style="flex:1"></span>
            <button class="btn primary" data-a="arm" ${ui.can('run') && !st.dirty && !errs.length ? '' : 'disabled'} title="${st.dirty ? 'Save first' : ''}">Load & start on rack…</button>
          </div>
        </div>
      </div>
    </div>`;

    wire(ro);
    const main = root.querySelector('.ts-main'), gw = root.querySelector('.gridwrap');
    if (main) main.scrollTop = keepMain;
    if (gw) gw.scrollLeft = keepGrid;
    requestAnimationFrame(() => {
      const c = root.querySelector('#tsPrev');
      if (c) M.preview.draw(c, s, st.sel);
      if (focusKey) { const f = root.querySelector(`[data-k="${CSS.escape(focusKey)}"]`); if (f) f.focus(); }
    });
  }

  // What a common parameter actually drives, spelled out under the field.
  function bindText(c) {
    if (c.block) { let n = 0; P.walk(st.draft, ({ item }) => { if (item.type === 'BLOCK' && item.id === c.block) n = item.repeat; }); return `repeat count of loop ${c.block}` + (n ? ` (×${n.toLocaleString()})` : ''); }
    const col = SP_COLS.find(([f]) => f === c.key);
    let n = 0;
    const v = commonValue(c);
    const rec = (items) => items.forEach((it) => { if (it.type === 'BLOCK') return rec(it.steps); if (it.sp[c.key] === v) n++; });
    rec(st.draft.phases.main);
    return `${col ? col[1] : c.key} column — ${n} main-phase step${n === 1 ? '' : 's'}`;
  }

  function commonValue(c) {
    if (c.block) { let v = null; P.walk(st.draft, ({ item }) => { if (item.type === 'BLOCK' && item.id === c.block && v == null) v = item.repeat; }); return v; }
    let v = null;
    const rec = (items) => items.forEach((it) => { if (v != null) return; if (it.type === 'BLOCK') return rec(it.steps); const x = it.sp[c.key]; if (x != null && (c.match == null || x === c.match)) v = x; });
    rec(st.draft.phases.main);
    return v;
  }
  function setCommon(c, nv) {
    if (c.block) { P.walk(st.draft, ({ item }) => { if (item.type === 'BLOCK' && item.id === c.block) item.repeat = Math.round(nv); }); return; }
    const old = commonValue(c);
    const rec = (items) => items.forEach((it) => { if (it.type === 'BLOCK') return rec(it.steps); if (it.sp[c.key] === old) it.sp[c.key] = nv; });
    rec(st.draft.phases.main);
    if (c.match != null) c.match = nv;
  }

  const bad = (k) => (st.errors[k] ? 'bad' : '');
  const pad = (d) => `<span class="indent" style="width:${d * 18}px"></span>`;

  // Display order, with an explicit end-of-loop row after each block's steps so the
  // start and end of every loop are visible rather than implied by indentation.
  function gridRows() {
    const out = [];
    P.PHASES.forEach((phase) => {
      const rec = (items, depth) => items.forEach((item) => {
        out.push({ item, phase, depth, end: false });
        if (item.type === 'BLOCK') { rec(item.steps, depth + 1); out.push({ item, phase, depth, end: true }); }
      });
      rec(st.draft.phases[phase], 0);
    });
    return out;
  }

  function rows(fn) {
    // The phase and end-of-loop rows span the whole grid. Their colspan must be the real
    // column count: with a fixed layout, a colspan larger than the table invents the missing
    // columns, and those phantoms then absorb every pixel the declared columns did not use.
    const span = cols(st.tab).length;
    let html = '', phase = null;
    gridRows().forEach((row) => {
      if (row.phase !== phase) { phase = row.phase; html += `<tr class="phase"><td colspan="${span}">${P.PHASE_LABEL[phase]} phase</td></tr>`; }
      const k = P.rowKey(null, row.item);
      if (row.end) {
        html += `<tr class="endrow ${row.item === st.sel ? 'sel' : ''}"><td class="id">${row.item.id}</td><td colspan="${span - 1}">${pad(row.depth)}▲ end of ${esc(row.item.name)} — back to its first step until ×${row.item.repeat.toLocaleString()} is reached</td></tr>`;
        return;
      }
      const cls = (row.item.type === 'BLOCK' ? 'row blockrow' : 'row') + (row.item === st.sel ? ' sel' : '');
      html += `<tr class="${cls}" data-row="${k}">${fn(row, k)}</tr>`;
    });
    return html;
  }

  function gridSp(ro) {
    const dis = ro ? 'disabled' : '';
    const body = rows(({ item, depth }, k) => {
      if (item.type === 'BLOCK') {
        return `<td class="id">${item.id}</td><td class="ttype"><b>▼ LOOP start</b></td>
          <td class="tname">${pad(depth)}<input data-k="${k}:name" data-f="name" value="${esc(item.name)}" ${dis} style="width:calc(100% - ${depth * 18}px);font-weight:600"></td>
          <td><span class="rep">×<input class="n ${bad(k + ':repeat')}" data-k="${k}:repeat" data-f="repeat" value="${item.repeat}" ${dis}></span></td>
          <td class="muted">count reached</td>
          <td colspan="7" class="muted">one pass ${P.fmtDur(P.inner(item))} · total ${P.fmtDur(P.dur(item))}</td>`;
      }
      const typeSel = `<select data-k="${k}:type" data-f="type" ${dis}>${['DWELL', 'RAMP', 'DWELL_UNTIL', 'HOLD'].map((t) => `<option value="${t}" ${item.type === t ? 'selected' : ''}>${P.TYPE_LABEL[t]}</option>`).join('')}</select>`;
      const adv = item.type === 'DWELL_UNTIL' ? condCell(item, k, dis)
        : `<span class="muted">${item.type === 'RAMP' ? 'ramp complete' : item.type === 'HOLD' ? 'operator ack' : 'time elapsed'}</span>`;
      const durCell = item.type === 'HOLD' ? '<span class="muted">—</span>' : `${item.type === 'DWELL_UNTIL' ? '<div class="tmo">timeout</div>' : ''}<input class="n ${bad(k + ':dur')}" data-k="${k}:dur" data-f="dur" value="${P.fmtDur(item.dur)}" ${dis} style="width:78px" title="${item.type === 'DWELL_UNTIL' ? 'Timeout' : 'Duration'}">`;
      const spCells = SP_COLS.map(([f]) => item.type === 'HOLD' ? '<td></td>' : `<td><input class="n ${bad(k + ':' + f)}" data-k="${k}:${f}" data-f="sp.${f}" value="${item.sp[f] == null || isNaN(item.sp[f]) ? '' : Math.round(item.sp[f] * 10) / 10}" placeholder="off" ${dis}></td>`).join('');
      const log = `<select data-k="${k}:log" data-f="logHz" ${dis} style="width:86px">${LOG_OPTS.map((o) => `<option value="${o ?? ''}" ${item.logHz === o ? 'selected' : ''}>${o == null ? `default (${st.draft.logHz})` : o.toLocaleString()}</option>`).join('')}</select>`;
      return `<td class="id">${item.id}</td><td class="ttype">${typeSel}</td>
        <td class="tname">${pad(depth)}<input data-k="${k}:name" data-f="name" value="${esc(item.name)}" ${dis} style="width:calc(100% - ${depth * 18}px)"></td>
        <td>${durCell}</td><td>${adv}</td>${spCells}<td>${item.type === 'HOLD' ? '' : log}</td>`;
    });
    return `<table class="grid">${head('sp')}<tbody>${body}</tbody></table>`;
  }

  // Channel, operator, value and unit — never a typed expression. The list only offers
  // channels this rack actually has, so a setup cannot name one that does not exist.
  function condCell(item, k, dis) {
    const u = normUntil(item.until), ch = M.chById[u.ch];
    let grp = '', opts = '';
    M.CH.forEach((c) => {
      if (c.group !== grp) { if (grp) opts += '</optgroup>'; grp = c.group; opts += `<optgroup label="${esc(grp)}">`; }
      opts += `<option value="${c.id}" ${c.id === u.ch ? 'selected' : ''}>${esc(c.name)}</option>`;
    });
    if (grp) opts += '</optgroup>';
    const e = bad(k + ':until');
    return `<div class="cond">
      <select data-k="${k}:until" data-f="until.ch" ${dis} class="${e}">${opts}</select>
      <select data-f="until.op" ${dis}>${OPS.map((o) => `<option ${o === u.op ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <input class="n ${e}" data-f="until.v" value="${u.v == null || isNaN(u.v) ? '' : u.v}" ${dis} style="width:56px">
      <span class="muted">${esc(ch ? ch.unit : '')}</span>
      </div><div class="cond2">on timeout
      <select data-f="onTimeout" ${dis} title="${esc(TIMEOUT_ACTS.map((t) => t[1] + ' — ' + t[2]).join('\n'))}">${TIMEOUT_ACTS.map(([v, l]) => `<option value="${v}" ${(item.onTimeout || 'ABORT') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  }

  function gridTh(ro) {
    const dis = ro ? 'disabled' : '';
    const pair = (k, ch, y, r, own, inh) => {
      const e = bad(k + ':th:' + ch);
      return `<span class="pair"><input class="n y ${own ? 'own' : 'inh'} ${e}" data-k="${k}:th:${ch}:0" data-th="${ch}" data-i="0" value="${y}" ${dis} title="Yellow${inh ? ' (inherited)' : ''}"><input class="n r ${own ? 'own' : 'inh'} ${e}" data-k="${k}:th:${ch}:1" data-th="${ch}" data-i="1" value="${r}" ${dis} title="Red${inh ? ' (inherited)' : ''}"></span>`;
    };
    const base = `<tr class="row" data-row="base"><td class="id">—</td><td><b>Setup defaults</b></td>${M.TH.map((t) => `<td>${pair('base', t.ch, st.draft.base[t.ch][0], st.draft.base[t.ch][1], true, false)}</td>`).join('')}</tr>`;
    const body = rows(({ item, depth }, k) => {
      if (item.type === 'BLOCK') return `<td class="id">${item.id}</td><td>${pad(depth)}<b>▼ ${esc(item.name)}</b> <span class="muted">× ${item.repeat.toLocaleString()}</span></td><td colspan="${M.TH.length}"></td>`;
      const eff = P.thFor(st.draft, item);
      return `<td class="id">${item.id}</td><td>${pad(depth)}${esc(item.name)}</td>` +
        M.TH.map((t) => `<td><span class="thcell">${pair(k, t.ch, eff[t.ch][0], eff[t.ch][1], !!eff._own[t.ch], !eff._own[t.ch])}${eff._own[t.ch] && !ro ? `<button class="btn sm rst" data-reset="${t.ch}" title="Remove override — inherit again">↺</button>` : ''}</span></td>`).join('');
    });
    return `<table class="grid">${head('th')}<tbody>${base}${body}</tbody></table>`;
  }

  function gridMask(ro) {
    const dis = ro ? 'disabled' : '';
    const body = rows(({ item, depth }, k) => {
      if (item.type === 'BLOCK') return `<td class="id">${item.id}</td><td>${pad(depth)}<b>▼ ${esc(item.name)}</b></td><td colspan="${M.TH.length + 1}"></td>`;
      const m = item.mask || {};
      return `<td class="id">${item.id}</td><td>${pad(depth)}${esc(item.name)}</td>` +
        M.TH.map((t) => {
          const [y, r] = m[t.ch] || [1, 1];
          const locked = M.NOMASK_RED.includes(t.ch);   // red cannot be masked on these
          return `<td><span class="mk"${locked ? ' title="Red alarm on this channel can never be masked — set in Stand Config → Users &amp; permissions → Alarm policy"' : ''}><label class="y"><input type="checkbox" data-mask="${t.ch}" data-i="0" ${y ? 'checked' : ''} ${dis}>Y</label>` +
            (locked ? '<label class="r lockmask"><input type="checkbox" checked disabled>R 🔒</label>'
                    : `<label class="r"><input type="checkbox" data-mask="${t.ch}" data-i="1" ${r ? 'checked' : ''} ${dis}>R</label>`) +
            `</span></td>`;
        }).join('') +
        `<td><span class="mk" title="Hardware safety input — cannot be masked"><label class="r"><input type="checkbox" checked disabled>R 🔒</label></span></td>`;
    });
    return `<table class="grid">${head('mask')}<tbody>${body}</tbody></table>`;
  }

  // ---- Events -------------------------------------------------------------
  const itemByKey = (k) => { let f = null; P.walk(st.draft, ({ item }) => { if (P.rowKey(null, item) === k) f = item; }); return f; };
  const changed = () => { st.dirty = true; render(root); };

  function wire(ro) {
    root.querySelector('.ts-lib').onclick = (e) => ui.panePick(e);
    root.querySelector('.ts-lib .list').onclick = (e) => {
      const li = e.target.closest('[data-lib]'); if (!li) return;
      const doLoad = () => { load(li.dataset.lib); render(root); };
      if (st.dirty && li.dataset.lib !== st.id) ui.modal({ title: 'Discard changes?', body: 'The current setup has unsaved changes.', buttons: [{ label: 'Keep editing' }, { label: 'Discard', cls: 'danger', onClick: doLoad }] });
      else doLoad();
    };
    root.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { st.tab = b.dataset.tab; render(root); }));

    const grid = root.querySelector('.gridwrap');
    // Excel-style column resize: drag the divider in the header. The <col> width is set
    // directly during the drag so the grid does not re-render under the pointer.
    grid.onmousedown = (e) => {
      const h = e.target.closest('[data-rz]');
      if (!h) return;
      e.preventDefault();
      const i = +h.dataset.rz;
      const col = grid.querySelectorAll('table.grid colgroup col')[i];
      const key = cols(st.tab)[i].k, x0 = e.clientX, w0 = col.offsetWidth;
      document.body.classList.add('rzing');
      const move = (ev) => {
        const w = Math.max(40, w0 + ev.clientX - x0);
        col.style.width = w + 'px';
        (colw[st.tab] = colw[st.tab] || {})[key] = w;
      };
      const up = () => {
        document.body.classList.remove('rzing');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
    grid.onclick = (e) => {
      const rs = e.target.closest('[data-reset]');
      const tr = e.target.closest('tr[data-row]');
      if (rs && tr) { const it = itemByKey(tr.dataset.row); delete it.th[rs.dataset.reset]; return changed(); }
      if (tr && tr.dataset.row !== 'base' && !['INPUT', 'SELECT'].includes(e.target.tagName)) { const it = itemByKey(tr.dataset.row); st.sel = st.sel === it ? null : it; render(root); }
    };
    grid.onfocusin = (e) => {
      const tr = e.target.closest('tr[data-row]');
      if (tr && tr.dataset.row !== 'base') { const it = itemByKey(tr.dataset.row); if (st.sel !== it) { st.sel = it; root.querySelectorAll('tr.sel').forEach((x) => x.classList.remove('sel')); tr.classList.add('sel'); M.preview.draw(root.querySelector('#tsPrev'), st.draft, st.sel); } }
    };
    grid.onchange = (e) => {
      const t = e.target, tr = t.closest('tr[data-row]'); if (!tr) return;
      const key = tr.dataset.row;
      if (t.dataset.th) {
        const target = key === 'base' ? st.draft.base : ((it) => (it.th = it.th || {}))(itemByKey(key));
        const cur = key === 'base' ? st.draft.base[t.dataset.th] : P.thFor(st.draft, itemByKey(key))[t.dataset.th];
        const pairV = [...cur];
        pairV[+t.dataset.i] = t.value.trim() === '' ? NaN : +t.value;
        target[t.dataset.th] = pairV;
        return changed();
      }
      const it = itemByKey(key);
      if (t.dataset.mask) {
        if (M.NOMASK_RED.includes(t.dataset.mask) && t.dataset.i === '1') {
          t.checked = true;
          return ui.toast(`${M.chById[t.dataset.mask].name}: the red alarm can never be masked`);
        }
        it.mask = Object.assign({}, it.mask);
        const m = [...(it.mask[t.dataset.mask] || [1, 1])];
        m[+t.dataset.i] = t.checked ? 1 : 0;
        it.mask[t.dataset.mask] = m;
        return changed();
      }
      const f = t.dataset.f;
      if (f === 'name') it.name = t.value;
      else if (f === 'repeat') it.repeat = +t.value;
      else if (f === 'dur') it.dur = parseDur(t.value);
      else if (f === 'until.ch') { it.until = normUntil(it.until); it.until.ch = t.value; }
      else if (f === 'until.op') { it.until = normUntil(it.until); it.until.op = t.value; }
      else if (f === 'until.v') { it.until = normUntil(it.until); it.until.v = t.value.trim() === '' ? NaN : +t.value; }
      else if (f === 'onTimeout') it.onTimeout = t.value;
      else if (f === 'type') {
        it.type = t.value;
        if (it.type === 'DWELL_UNTIL') { it.until = normUntil(it.until); it.onTimeout = it.onTimeout || 'ABORT'; }
        if (it.type !== 'HOLD' && !it.dur) it.dur = 600;
      }
      else if (f === 'logHz') it.logHz = t.value === '' ? null : +t.value;
      else if (f.startsWith('sp.')) {
        // The temperature targets can be switched off; the cell shows "off" as its placeholder,
        // so typing that word must mean the same as clearing the cell rather than NaN.
        const k = f.slice(3), raw = t.value.trim().toLowerCase();
        const offable = k === 'tankT' || k === 'coolerT';
        it.sp[k] = (raw === '' || (offable && ['off', 'none', '-'].includes(raw))) ? (offable ? null : NaN) : +t.value;
      }
      changed();
    };

    root.querySelectorAll('[data-common]').forEach((inp) => (inp.onchange = () => {
      const v = +inp.value;
      if (isNaN(v)) return ui.toast('Enter a number');
      setCommon(st.draft.common[+inp.dataset.common], v);
      changed();
    }));

    root.querySelector('.ts-main').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b && !b.disabled) action(b.dataset.a, b);
    });
    root.querySelector('.ts-lib .acts').onclick = (e) => { const b = e.target.closest('[data-a]'); if (b && !b.disabled) action(b.dataset.a, b); };
    root.querySelector('#tsFile').onchange = importFile;
  }

  function action(a, btn) {
    const s = st.draft;
    const loc = st.sel ? locateItem(st.sel) : null;
    if (a === 'addstep') {
      return ui.menu(btn, [
        { hint: st.sel ? `Insert after ${st.sel.id} ${st.sel.name}` : 'Append to main phase' },
        ...[['DWELL', 'DWELL — hold setpoints for a time'], ['RAMP', 'RAMP — move to setpoints over a time'], ['DWELL_UNTIL', 'DWELL UNTIL — hold until a condition, with timeout'], ['HOLD', 'HOLD — wait for operator acknowledgement']]
          .map(([t, l]) => ({ label: l, onClick: () => insert(newStep(t)) })),
      ]);
    }
    if (a === 'addblock') return insert({ id: '', type: 'BLOCK', name: 'New loop', repeat: 10, steps: [newStep('DWELL')] });
    if (a === 'group' && loc && st.sel.type !== 'BLOCK') {
      if (countEnclosing(loc.arr) >= 2) return ui.toast('Maximum two loop levels');
      const b = { id: '', type: 'BLOCK', name: 'New loop', repeat: 10, steps: [st.sel] };
      loc.arr.splice(loc.idx, 1, b); st.sel = b; return changed();
    }
    if (a === 'ungroup' && loc && st.sel.type === 'BLOCK') {
      loc.arr.splice(loc.idx, 1, ...st.sel.steps); st.sel = null; return changed();
    }
    if (a === 'in' && loc) {
      const prev = loc.arr[loc.idx - 1];
      if (!prev || prev.type !== 'BLOCK') return ui.toast('Put the step directly below a loop start row first, then move it in');
      if (st.sel.type === 'BLOCK' && countEnclosing(prev.steps) >= 2) return ui.toast('Maximum two loop levels');
      loc.arr.splice(loc.idx, 1); prev.steps.push(st.sel); return changed();
    }
    if (a === 'out' && loc) {
      let owner = null;
      P.walk(st.draft, ({ item }) => { if (item.type === 'BLOCK' && item.steps === loc.arr) owner = item; });
      if (!owner) return ui.toast('This step is not inside a loop');
      if (loc.arr.length === 1) return ui.toast('A loop needs at least one step — use Ungroup to remove the loop itself');
      const oloc = locateItem(owner);
      loc.arr.splice(loc.idx, 1); oloc.arr.splice(oloc.idx + 1, 0, st.sel); return changed();
    }
    if (a === 'dup' && loc) { loc.arr.splice(loc.idx + 1, 0, clone(st.sel)); st.sel = loc.arr[loc.idx + 1]; return changed(); }
    if (a === 'del' && loc) { loc.arr.splice(loc.idx, 1); st.sel = null; return changed(); }
    if ((a === 'up' || a === 'down') && loc) {
      const j = loc.idx + (a === 'up' ? -1 : 1);
      if (j < 0 || j >= loc.arr.length) return ui.toast('Already at the edge of its phase or loop');
      [loc.arr[loc.idx], loc.arr[j]] = [loc.arr[j], loc.arr[loc.idx]];
      return changed();
    }
    if (a === 'revert') { load(st.id); return render(root); }
    if (a === 'save') {
      const orig = M.setupById(st.id);
      if (orig.used) return saveAs('This revision has already been run, so it is kept unchanged for traceability. Save the edits as a new revision.');
      Object.assign(orig, clone(s)); st.dirty = false; ui.toast(`Saved ${s.name}_Rev${s.rev}`); return render(root);
    }
    if (a === 'saveas') return saveAs();
    if (a === 'new') {
      return ui.menu(btn, [
        { hint: 'A new setup starts its own history at Rev A — unlike Save as revision, which keeps this setup and adds to its history' },
        { label: 'Blank — start-up and shutdown only', onClick: () => newSetup(null) },
        ...M.SETUPS.map((x) => ({ label: `Copy of ${x.name}_Rev${x.rev}`, onClick: () => newSetup(x.id) })),
      ]);
    }
    if (a === 'editcommon') return chooseCommon();
    if (a === 'wide') return ui.paneAll(!ui.panesCollapsed());
    if (a === 'export') return exportFile();
    if (a === 'import') return root.querySelector('#tsFile').click();
    if (a === 'arm') return armDialog();
  }

  function insert(obj) {
    const loc = st.sel ? locateItem(st.sel) : null;
    // A new loop may sit inside at most one other loop
    if (obj.type === 'BLOCK' && loc && countEnclosing(loc.arr) >= 2) {
      return ui.toast('Maximum two loop levels — a third level would turn the table into a program');
    }
    if (loc) loc.arr.splice(loc.idx + 1, 0, obj);
    else st.draft.phases.main.push(obj);
    st.sel = obj;
    changed();
  }
  function countEnclosing(arr) {
    let n = 0;
    const rec = (items, depth) => items.forEach((it) => { if (it.type === 'BLOCK') { if (it.steps === arr) n = depth + 1; rec(it.steps, depth + 1); } });
    P.PHASES.forEach((ph) => rec(st.draft.phases[ph], 0));
    return n;
  }

  // A setup carries its own list of common parameters (saved in its JSON, under "common").
  // This is where that list is edited — there is no global list to maintain.
  function chooseCommon() {
    const s = st.draft;
    const blocks = [];
    P.walk(s, ({ item }) => { if (item.type === 'BLOCK') blocks.push(item); });
    const cand = [
      ...SP_COLS.map(([f, label, unit]) => ({ kind: 'sp', key: f, label, unit })),
      ...blocks.map((b) => ({ kind: 'block', block: b.id, label: b.name + ' repeats', unit: '×' })),
    ];
    const cur = (c) => s.common.findIndex((x) => (c.kind === 'block' ? x.block === c.block : x.key === c.key));
    ui.modal({
      title: 'Choose common parameters',
      body: `<div class="muted" style="margin-bottom:8px">Tick the values operators change between runs. Each one edits the grid below it — a setpoint column writes every main-phase step that currently shares its value; a loop writes its repeat count.</div>
        <table class="grid"><thead><tr><th></th><th>Value in the grid</th><th>Label shown to the operator</th></tr></thead><tbody>
        ${cand.map((c, i) => { const j = cur(c); return `<tr><td><input type="checkbox" data-cc="${i}" ${j >= 0 ? 'checked' : ''}></td>
          <td>${c.kind === 'block' ? `loop ${esc(c.block)} repeat count` : `${esc(c.label)} column`}</td>
          <td><input data-cl="${i}" value="${esc(j >= 0 ? s.common[j].label : c.label)}" style="width:190px"></td></tr>`; }).join('')}
        </tbody></table>`,
      buttons: [{ label: 'Cancel' }, {
        label: 'Apply', cls: 'primary', onClick: (w) => {
          const next = [];
          cand.forEach((c, i) => {
            if (!w.querySelector(`[data-cc="${i}"]`).checked) return;
            const label = w.querySelector(`[data-cl="${i}"]`).value.trim() || c.label;
            const j = cur(c);
            next.push(j >= 0 ? Object.assign({}, s.common[j], { label }) : (c.kind === 'block'
              ? { label, block: c.block, unit: c.unit }
              : { label, key: c.key, unit: c.unit }));
          });
          s.common = next; changed();
        },
      }],
    });
  }

  function newSetup(srcId) {
    const src = srcId ? M.setupById(srcId) : M.SETUPS[0];
    const t = clone(src);
    t.id = 'new' + Date.now(); t.rev = 'A'; t.used = false;
    t.name = srcId ? src.name + '_copy' : 'New_setup';
    if (!srcId) { t.phases.main = [newStep('DWELL')]; t.common = []; }
    ui.modal({
      title: 'New setup',
      body: `<label>Name<input id="nsName" value="${esc(t.name)}"></label>
        <div class="muted">Starts a new setup at Rev A with its own history. To keep editing the setup already open, use <b>Save as revision</b> instead.</div>`,
      buttons: [{ label: 'Cancel' }, {
        label: 'Create', cls: 'primary', onClick: (w) => {
          t.name = w.querySelector('#nsName').value.trim() || t.name;
          M.SETUPS.push(t); load(t.id); ui.toast(`Created ${t.name}_RevA`); render(root);
        },
      }],
    });
  }

  function nextRev(rev) { return /^\d+$/.test(rev) ? String(+rev + 1) : String.fromCharCode(rev.charCodeAt(0) + 1); }

  function saveAs(note) {
    const s = st.draft;
    ui.modal({
      title: 'Save as new revision',
      body: `${note ? `<div class="banner">${esc(note)}</div>` : ''}
        <label>Name<input id="saName" value="${esc(s.name)}"></label>
        <label>Revision<input id="saRev" value="${esc(nextRev(s.rev))}"></label>
        <div class="muted">Saved as a readable text file (JSON) so it can be copied to any rack PC, compared, and kept under version control.</div>`,
      buttons: [{ label: 'Cancel' }, {
        label: 'Save', cls: 'primary', onClick: (w) => {
          const n = clone(s);
          n.name = w.querySelector('#saName').value.trim() || s.name;
          n.rev = w.querySelector('#saRev').value.trim() || nextRev(s.rev);
          n.id = 'u' + Date.now(); n.used = false;
          M.SETUPS.push(n); load(n.id); ui.toast(`Saved ${n.name}_Rev${n.rev}`); render(root);
        },
      }],
    });
  }

  function exportFile() {
    const s = clone(st.draft); delete s.used;
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${s.name}_Rev${s.rev}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    ui.toast('Exported as readable JSON — open it in any text editor');
  }
  function importFile(e) {
    const f = e.target.files[0]; if (!f) return;
    f.text().then((txt) => {
      try {
        const s = JSON.parse(txt);
        if (!s.phases || !s.base) throw new Error('not a test setup file');
        s.id = 'i' + Date.now(); s.used = false;
        M.SETUPS.push(s); load(s.id); render(root);
        ui.toast(`Imported ${s.name}_Rev${s.rev} — validated against this rack's channel map`);
      } catch (err) { ui.toast('Import failed: ' + err.message); }
    });
  }

  function armDialog() {
    const idle = M.sim.stands.filter((r) => ['idle', 'complete'].includes(r.status));
    if (!idle.length) return ui.toast('No idle stands available');
    const s = M.setupById(st.id);
    ui.modal({
      title: `Load ${s.name}_Rev${s.rev}`,
      body: `<label>Rack<select id="armRack">${idle.map((r) => `<option value="${r.id}">${r.name} — Bay ${r.cell}</option>`).join('')}</select></label>
        <div class="muted">Validated against the stand's channel map and calibration. Start is local-only.</div>`,
      buttons: [{ label: 'Cancel' }, { label: 'Arm & start', cls: 'primary', onClick: (w) => { const r = M.sim.rack(+w.querySelector('#armRack').value); if (!ui.cmd(r, 'START', s)) return; s.used = true; ui.go('graph', r.id); ui.toast(`${r.name} started — ${s.name}_Rev${s.rev}`); } }],
    });
  }

  ui.screens.setups = { render, tick() {} };
  ui.setupsTab = (t) => (st.tab = t);
})(globalThis.M = globalThis.M || {});
