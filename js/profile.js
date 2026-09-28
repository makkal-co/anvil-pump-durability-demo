// Test profile model: phases → steps / blocks (max 2 nesting levels).
// Durations in seconds. DWELL_UNTIL uses its timeout as nominal duration.
(function (M) {
  const PHASES = ['startup', 'main', 'shutdown'];
  const PHASE_LABEL = { startup: 'Start-up', main: 'Main', shutdown: 'Shutdown' };
  const TYPES = ['DWELL', 'RAMP', 'DWELL_UNTIL', 'HOLD', 'BLOCK'];
  const TYPE_LABEL = { DWELL: 'DWELL', RAMP: 'RAMP', DWELL_UNTIL: 'DWELL UNTIL', HOLD: 'HOLD', BLOCK: 'BLOCK' };

  function dur(item) {
    if (item.type === 'BLOCK') return (item.repeat || 0) * inner(item);
    if (item.type === 'HOLD') return 0;
    return item.dur || 0;
  }
  function inner(block) {
    return block.steps.reduce((a, s) => a + dur(s), 0);
  }
  function total(setup) {
    return PHASES.reduce((a, p) => a + setup.phases[p].reduce((b, i) => b + dur(i), 0), 0);
  }

  // Visit every grid row in display order.
  function walk(setup, fn) {
    PHASES.forEach((phase) => {
      const rec = (items, depth, parent) =>
        items.forEach((item) => {
          fn({ item, phase, depth, parent });
          if (item.type === 'BLOCK') rec(item.steps, depth + 1, item);
        });
      rec(setup.phases[phase], 0, null);
    });
  }

  // Innermost-block cycles (e.g. load/unload duty cycles).
  function cycles(setup) {
    let n = 0;
    const rec = (items, mult) =>
      items.forEach((it) => {
        if (it.type !== 'BLOCK') return;
        const hasBlocks = it.steps.some((s) => s.type === 'BLOCK');
        if (hasBlocks) rec(it.steps, mult * it.repeat);
        else n += mult * it.repeat;
      });
    PHASES.forEach((p) => rec(setup.phases[p], 1));
    return n;
  }

  // Seconds-weighted log rate → estimated bytes. 12 analog ch at step rate, 19 TC at ≤1 Hz, 4 B/sample.
  function storage(setup, overrideHz) {
    let analog = 0, tc = 0;
    const rec = (items, mult) =>
      items.forEach((it) => {
        if (it.type === 'BLOCK') return rec(it.steps, mult * it.repeat);
        const hz = overrideHz || it.logHz || setup.logHz || 1;
        const d = dur(it) * mult;
        analog += 12 * 4 * hz * d;
        tc += 19 * 4 * Math.min(hz, 1) * d;
      });
    PHASES.forEach((p) => rec(setup.phases[p], 1));
    return { analog, tc, total: analog + tc };
  }

  // Where is a run at `el` seconds? Returns path from outermost to leaf.
  function locate(setup, el) {
    if (el < 0) return null;
    for (const phase of PHASES) {
      for (const item of setup.phases[phase]) {
        const d = dur(item);
        if (el < d) {
          const path = [];
          descend(item, el, path);
          const leafE = path[path.length - 1];
          return {
            phase, path, leaf: leafE.item, offset: leafE.offset,
            key: phase + ':' + path.map((p) => p.item.id + (p.cycle ? '#' + p.cycle : '')).join('/'),
          };
        }
        el -= d;
      }
    }
    return { done: true };
  }
  function descend(item, off, path) {
    if (item.type !== 'BLOCK') return path.push({ item, offset: off });
    const inn = inner(item);
    const c = Math.floor(off / inn);
    path.push({ item, cycle: c + 1, of: item.repeat });
    let o = off - c * inn;
    for (const s of item.steps) {
      const d = dur(s);
      if (o < d) return descend(s, o, path);
      o -= d;
    }
  }

  function bandLabel(loc) {
    if (!loc) return 'Idle';
    if (loc.done) return 'Complete';
    for (let i = loc.path.length - 1; i >= 0; i--) {
      const p = loc.path[i];
      const d = p.item.type === 'BLOCK' ? inner(p.item) * p.item.repeat : dur(p.item);
      if (d >= 600) return p.item.name;
    }
    return loc.path[0].item.name;
  }

  function pathText(loc) {
    if (!loc) return '—';
    if (loc.done) return 'Complete';
    return PHASE_LABEL[loc.phase] + ' › ' + loc.path
      .map((p) => (p.cycle ? `${p.item.name} ${p.cycle.toLocaleString()}/${p.of.toLocaleString()}` : p.item.name))
      .join(' › ');
  }

  // Thresholds inherit down the grid. Returns {rowId: {ch:[y,r], _own:{ch:true}}}.
  function thMap(setup) {
    const map = {};
    let acc = JSON.parse(JSON.stringify(setup.base));
    walk(setup, ({ item }) => {
      if (item.type === 'BLOCK') return;
      if (item.th) acc = Object.assign({}, acc, JSON.parse(JSON.stringify(item.th)));
      map[rowKey(setup, item)] =Object.assign({}, acc, { _own: Object.fromEntries(Object.keys(item.th || {}).map((k) => [k, true])) });
    });
    return map;
  }
  // Step ids repeat across phases (S1 vs 1), so key by object identity via a WeakMap.
  const ids = new WeakMap();
  let seq = 0;
  function rowKey(setup, item) {
    if (!ids.has(item)) ids.set(item, 'r' + ++seq);
    return ids.get(item);
  }
  function thFor(setup, item) {
    return thMap(setup)[rowKey(setup, item)];
  }

  function fmtDur(sec) {
    if (sec >= 36000) return Math.round(sec / 3600).toLocaleString() + ' h';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
  }
  function fmtBytes(b) {
    if (b >= 1e9) return (b / 1e9).toFixed(b >= 1e11 ? 0 : 1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
    return (b / 1e3).toFixed(0) + ' kB';
  }

  M.prof = { PHASES, PHASE_LABEL, TYPES, TYPE_LABEL, dur, inner, total, walk, cycles, storage, locate, bandLabel, pathText, thFor, rowKey, fmtDur, fmtBytes };
})(globalThis.M = globalThis.M || {});
