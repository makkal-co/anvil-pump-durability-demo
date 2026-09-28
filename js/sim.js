// Simplified hydraulic-pump-stand physics so the demonstration behaves plausibly.
// Invented, not a model of any real stand — just enough cause and effect to feel live.
(function (M) {
  const H = 3600 * 1000;
  const IDLE = { motor: 0, boostPump: 0, coolFan: 0, loadValve: 100, tankT: null, coolerT: null };
  const SOFT_STEPS = [
    ['Drive → 0 rpm', { motor: 0 }],
    ['Tank heater OFF', { tankT: null }],
    ['Cooler heater OFF', { coolerT: null }],
    ['Boost pump → 0', { boostPump: 0 }],
    ['Cooler fan → 0', { coolFan: 0 }],
    ['Load valve OPEN — bleed system pressure', { loadValve: 100 }],
    ['Cooler bypass CLOSED', {}],
  ];
  // Hard shutdown: the same stops, then pulse the control relay so the hardware safety relay drops out.
  const HARD_STEPS = SOFT_STEPS.slice(0, 6).concat([
    ['Control relay OPEN — safety relay drops out', {}, 'relayOpen'],
    ['Control relay re-closed by software · stand power OFF', {}, 'relayClose'],
  ]);

  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

  const S = (M.sim = {
    now: new Date('2026-09-17T15:40:00').getTime(),
    speed: 60, // simulated seconds per real second
    stands: [],
    SOFT_STEPS,
    HARD_STEPS,
    alarmSeq: 0,
  });

  function makeRack(def) {
    const r = Object.assign({}, def, {
      name: 'Stand ' + def.id,
      setup: def.setup ? M.setupById(def.setup) : null,
      amb: 21.5 + rnd() * 2,
      x: { speed: 0, tankT: 22, hxInT: 22, sysP: 0, dispT: 22 },
      ctl: { tankHeater: 0, hxHeater: 0, bypassValve: 0, loaded: 1 },
      cmd: Object.assign({}, IDLE),
      v: {}, hist: [], alarms: [], lvl: {}, forced: null, loc: null, leafKey: null, rampFrom: null, power: true, manual: null, relayOpen: false,
    });
    if (r.status === 'offline') {
      if (def.lastSeenAgoH) r.lastSeen = S.now - def.lastSeenAgoH * H;
      return r;
    }
    if (r.setup) r.startedAt = S.now - def.elapsedH * H;
    if (def.stopAgoH) r.stopAt = S.now - def.stopAgoH * H;
    return r;
  }

  function targets(r, t) {
    if (r.status === 'shutdown') return Object.assign({}, r.hold, r.forced);
    if (r.status === 'manual') return { motor: r.manual.motor, boostPump: r.manual.boostPump, coolFan: r.manual.coolFan, loadValve: r.manual.loadValve, tankT: null, coolerT: null };
    if (r.status !== 'running' || !r.setup) { r.loc = r.status === 'running' ? null : r.loc; return Object.assign({}, IDLE); }
    const loc = M.prof.locate(r.setup, (t - r.startedAt) / 1000);
    if (!loc) { r.loc = null; return Object.assign({}, IDLE); }
    if (loc.done) { r.status = 'complete'; r.loc = loc; return Object.assign({}, IDLE); }
    r.loc = loc;
    if (loc.key !== r.leafKey) {
      r.leafKey = loc.key;
      r.rampFrom = { motor: r.cmd.motor, boostPump: r.cmd.boostPump, coolFan: r.cmd.coolFan, loadValve: r.cmd.loadValve };
    }
    const tg = Object.assign({}, loc.leaf.sp);
    if (loc.leaf.type === 'RAMP' && r.rampFrom) {
      const f = Math.min(1, loc.offset / loc.leaf.dur);
      ['motor', 'boostPump', 'coolFan', 'loadValve'].forEach((k) => (tg[k] = r.rampFrom[k] + (tg[k] - r.rampFrom[k]) * f));
    }
    return tg;
  }

  function substep(r, dt, t) {
    const c = (r.cmd = targets(r, t));
    const x = r.x, k = r.ctl, amb = r.amb;
    // Closed-loop temperature control. Switch ON outside the ±5 °C band, switch OFF on reaching target.
    // Note: the spec as written switches off only at the far side of the band, which makes the
    // heater and cooler chase each other across the full 10 °C band indefinitely, which is worth raising.
    if (r.status === 'manual') {
      k.tankHeater = r.manual.tankHeater; k.hxHeater = r.manual.hxHeater; k.bypassValve = r.manual.bypassValve;
    } else {
    if (c.tankT == null) k.tankHeater = 0;
    else if (x.tankT < c.tankT - 5) k.tankHeater = 1;
    else if (x.tankT >= c.tankT) k.tankHeater = 0;
    if (c.coolerT == null) { k.hxHeater = 0; k.bypassValve = 0; }
    else {
      if (x.hxInT < c.coolerT - 5) k.hxHeater = 1; else if (x.hxInT >= c.coolerT) k.hxHeater = 0;
      if (x.hxInT > c.coolerT + 5) k.bypassValve = 1; else if (x.hxInT <= c.coolerT) k.bypassValve = 0;
    }
    }
    // Plant. Speeds in rpm, pressures in bar, temperatures in °C.
    x.speed += (c.motor - x.speed) * Math.min(1, dt / 5);
    const sf = Math.max(0, x.speed) / 1800;                 // 1800 rpm is rated
    x.tankT += dt * (0.05 * Math.min(sf, 1.25) + 0.03 * k.tankHeater - 0.0012 * (x.tankT - amb));
    x.hxInT += dt * (0.045 * sf + 0.05 * k.hxHeater - 0.0009 * (x.hxInT - amb) - 0.0016 * k.bypassValve * (x.hxInT - 15));
    // Closing the load valve makes the pump work against the system; opening it bleeds down.
    // The relief setting unloads the circuit, which is what gives the duty cycle its shape.
    const closedValve = c.loadValve < 5;
    if (x.sysP >= (closedValve ? 340 : 260)) k.loaded = 0;
    else if (x.sysP <= (closedValve ? 300 : 215)) k.loaded = 1;
    x.sysP = Math.max(0, x.sysP + dt * ((k.loaded ? 1.4 * sf : 0) - 0.022 * c.loadValve * x.sysP / 260));
    x.dispT += (amb + 4 + (k.loaded ? 72 : 26) * Math.min(sf, 1.15) - x.dispT) * Math.min(1, dt / 200);
    if (r.fault) r.fault.add += dt * r.fault.rate;
  }

  function readout(r, xs, lf) {
    const x = xs || r.x, c = r.cmd, amb = r.amb, v = r.v, n = gauss;
    if (lf == null) lf = r.ctl.loaded;
    const sf = Math.max(0, x.speed) / 1800;
    const pos = (a) => Math.max(0, a);
    const fAdd = r.fault && r.fault.ch === 'dispT' ? r.fault.add : 0;
    v.tankT = x.tankT + n() * 0.15;
    v.hxInT = x.hxInT + n() * 0.15;
    v.hxOutT = x.hxInT - 9 * (c.coolFan / 100) + n() * 0.15;
    v.ambT = amb + n() * 0.08;
    v.sucT = x.tankT - 1.5 + n() * 0.1;
    v.dispT = x.dispT + fAdd + n() * 0.4;
    v.postHxT = amb + (x.dispT - amb) * 0.3 + n() * 0.2;
    v.sumpT = amb + (x.dispT - amb) * 0.15 + n() * 0.1;
    v.drvBrgT = x.tankT - 12 + 10 * sf + n() * 0.2;
    v.pmpBrgT = x.tankT - 9 + 13 * sf + n() * 0.2;
    v.filtT = x.tankT - 4 + n() * 0.15;
    v.motWindT = amb + 34 * sf + (lf ? 18 : 6) + n() * 0.4;
    v.caseP = pos(0.6 + 1.4 * (c.boostPump / 100) + 0.6 * (x.sysP / 260) + n() * 0.02);
    v.hxInP = pos(0.3 + 1.8 * (c.coolFan / 100) + n() * 0.02);
    v.hxOutP = pos(v.hxInP - 0.25 * (c.coolFan / 100));
    v.sysP = pos(x.sysP + n() * 0.4);
    v.accP = pos(x.sysP * 0.96 + n() * 0.4);
    v.sucP = pos(0.8 + 0.5 * (c.boostPump / 100) + n() * 0.01);
    v.bypP = pos(lf * 2 + (1 - lf) * x.sysP * 0.92 + n() * 0.3);
    // Case drain flow is the wear indicator: it follows speed and pressure.
    v.caseF = pos(1.1 + 3.4 * sf * (0.3 + 0.7 * x.sysP / 260) + n() * 0.04);
    v.hxF = pos(34 * (c.coolFan / 100) + n() * 0.15);
    v.dispF = x.speed > 20 ? pos((lf ? 86 : 14) * Math.min(sf, 1.2) + n() * 0.6) : 0;
    v.speed = pos(x.speed + (x.speed > 5 ? n() * 2 : 0));
    v.torque = x.speed > 20 ? (lf * 240 + (1 - lf) * 48) * (0.6 + 0.4 * sf) + n() * 2 : 0;
    v.speedDev = Math.abs(c.motor - x.speed);
    v.tankLvl = pos(78 - 2.5 * sf + n() * 0.15);
  }

  function sample(r, t) {
    const s = { t, band: bandOf(r), path: r.status === 'running' ? M.prof.pathText(r.loc) : statusLabel(r), v: {} };
    M.CH.forEach((ch) => (s.v[ch.id] = r.v[ch.id]));
    r.hist.push(s);
    if (r.hist.length > 1500) r.hist.splice(0, r.hist.length - 1500);
  }
  function bandOf(r) {
    if (r.status === 'running') return M.prof.bandLabel(r.loc);
    return statusLabel(r);
  }
  function statusLabel(r) {
    return { idle: 'Idle', stopped: 'Stopped', shutdown: 'Shutting down', complete: 'Complete', offline: 'Offline', manual: 'Manual control', poweroff: 'Power off' }[r.status] || r.status;
  }

  // Advance one rack by `sec` simulated seconds from its own clock.
  function advance(r, sec, live) {
    let left = sec;
    const acc = r.acc || (r.acc = { w: 0, speed: 0, tankT: 0, hxInT: 0, sysP: 0, dispT: 0, lf: 0 });
    while (left > 1e-6) {
      const dt = Math.min(5, left);
      const t0 = r.t;
      r.t += dt * 1000;
      if (r.stopAt && r.status === 'running' && r.t >= r.stopAt) historicStop(r);
      substep(r, dt, r.t);
      left -= dt;
      acc.w += dt; acc.lf += dt * r.ctl.loaded;
      ['speed', 'tankT', 'hxInT', 'sysP', 'dispT'].forEach((f) => (acc[f] += dt * r.x[f]));
      if (Math.floor(r.t / 60000) > Math.floor(t0 / 60000)) {
        // Log the mean over the interval — the same decimation we recommend for the real system
        const m = {};
        ['speed', 'tankT', 'hxInT', 'sysP', 'dispT'].forEach((f) => (m[f] = acc[f] / acc.w));
        readout(r, m, acc.lf / acc.w);
        sample(r, Math.floor(r.t / 60000) * 60000);
        Object.keys(acc).forEach((f) => (acc[f] = 0));
      }
    }
    readout(r);
    if (live) evalAlarms(r);
  }

  function historicStop(r) {
    const loc = r.loc;
    r.stopAt = null;
    r.status = 'stopped';
    r.stoppedLoc = loc;
    r.alarms.push({
      id: ++S.alarmSeq, t: r.t, sev: 'R', ch: 'caseP', val: 0.94, limit: 1.0, dir: 'low',
      path: M.prof.pathText(loc), state: 'ACTIVE', cleared: true, action: 'Software shutdown',
    });
    r.stopReason = 'Red alarm — pump discharge over temperature';
  }

  // ---- Alarms -----------------------------------------------------------
  // Manual mode keeps temperature interlocks armed; pressure-low and speed-deviation are masked
  // because a rig driven by hand legitimately sits at zero pressure and changes speed abruptly.
  const MANUAL_MASK = { sysP: [0, 0], caseP: [0, 0], speedDev: [0, 0] };

  function evalAlarms(r) {
    if (!r.power) return;
    let th, mask;
    if (r.status === 'running' && r.loc && !r.loc.done && r.setup) { th = M.prof.thFor(r.setup, r.loc.leaf); mask = r.loc.leaf.mask || {}; }
    else if (r.status === 'manual') { th = M.DEFAULT_TH; mask = MANUAL_MASK; }
    else return;
    M.TH.forEach(({ ch, dir }) => {
      const [y, rd] = th[ch];
      const [ya, ra] = mask[ch] || [1, 1];
      const val = r.v[ch];
      const over = (lim) => (dir === 'high' ? val > lim : val < lim);
      let lvl = 0;
      if (ra && over(rd)) lvl = 2;
      else if (ya && over(y)) lvl = 1;
      const prev = r.lvl[ch] || 0;
      if (lvl > prev) raise(r, lvl === 2 ? 'R' : 'Y', ch, val, lvl === 2 ? rd : y, dir);
      if (lvl < prev) r.alarms.forEach((a) => { if (a.ch === ch && !a.cleared && (a.sev === 'R' ? 2 : 1) > lvl) a.cleared = true; });
      r.lvl[ch] = lvl;
    });
  }
  const where = (r) => (r.status === 'manual' ? 'Manual control' : M.prof.pathText(r.loc));
  function raise(r, sev, ch, val, limit, dir) {
    const a = { id: ++S.alarmSeq, t: S.now, sev, ch, val, limit, dir, path: where(r), state: 'ACTIVE', cleared: false, action: sev === 'R' ? 'Software shutdown' : '—' };
    r.alarms.push(a);
    if (sev === 'R') {
      const what = ch === 'brake' ? 'Braking resistor trip (24 VDC)' : `${M.chById[ch].name} ${fmtV(ch, val)} (limit ${fmtV(ch, limit)})`;
      startShutdown(r, 'Red alarm — ' + what, 'soft');
    }
    return a;
  }
  const fmtV = (ch, v) => v.toFixed(M.chById[ch].dp) + ' ' + M.chById[ch].unit;

  function startShutdown(r, reason, kind) {
    const soft = kind !== 'hard';
    if (r.status === 'offline') return false;
    if (soft && !['running', 'manual'].includes(r.status)) return false;
    if (!soft && !r.power) return false;
    if (r.status === 'shutdown' && r.sd.kind === 'hard') return false;
    if (r.status === 'running') r.stoppedLoc = r.loc;
    const hold = r.status === 'shutdown' ? Object.assign({}, r.hold, r.forced) : Object.assign({}, r.cmd);
    r.status = 'shutdown';
    r.stopReason = reason;
    r.hold = hold;
    r.forced = {};
    r.sd = { i: 0, kind: soft ? 'soft' : 'hard', steps: soft ? SOFT_STEPS : HARD_STEPS, next: performanceNow() + 700 };
    return true;
  }
  const performanceNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function stepShutdowns() {
    const now = performanceNow();
    S.stands.forEach((r) => {
      if (r.status !== 'shutdown' || now < r.sd.next) return;
      const step = r.sd.steps[r.sd.i];
      Object.assign(r.forced, step[1]);
      if (step[2] === 'relayOpen') r.relayOpen = true;
      if (step[2] === 'relayClose') { r.relayOpen = false; r.power = false; }
      r.sd.i++;
      r.sd.next = now + 700;
      if (r.sd.i >= r.sd.steps.length) {
        const hard = r.sd.kind === 'hard';
        Object.assign(r, { status: hard ? 'poweroff' : 'stopped', forced: null, fault: null, sd: null, manual: null });
      }
    });
  }

  // ---- Commands ----------------------------------------------------
  // Every UI action goes through one command interface carrying ORIGIN and USER.
  // The controller, not the UI, decides what each origin may do.
  // Remote may stop a test, never drop the safety relay — that needs a reset in the cell,
  // and someone may be working there.
  const REMOTE_ALLOWED = { SOFT_STOP: 1 };
  S.cmdLog = [];
  S.cmd = function (r, cmd, origin, user, arg) {
    let ok = true, note = '';
    if (origin === 'REMOTE' && !REMOTE_ALLOWED[cmd]) { ok = false; note = 'Rejected by controller — origin REMOTE may only stop'; }
    else {
      const res = exec(r, cmd, user, arg);
      if (res !== true) { ok = false; note = res || 'Not permitted in current state'; }
    }
    const detail = cmd === 'SET_OUTPUT' ? `${arg.key} = ${arg.val}` : cmd === 'START' && arg ? `${arg.name}_Rev${arg.rev}` : '';
    S.cmdLog.unshift({ t: S.now, rack: r.id, cmd, origin, user, ok, note, detail });
    if (S.cmdLog.length > 300) S.cmdLog.length = 300;
    return { ok, note };
  };
  function exec(r, cmd, user, arg) {
    switch (cmd) {
      case 'START':
        if (!r.power) return 'Stand power is off';
        if (!['idle', 'complete'].includes(r.status)) return 'Rack is not idle';
        Object.assign(r, { status: 'running', setup: arg, startedAt: S.now, lvl: {}, leafKey: null, forced: null, fault: null, stopReason: null });
        return true;
      case 'CLEAR':
        if (!['stopped', 'complete'].includes(r.status)) return 'Nothing to clear';
        Object.assign(r, { status: 'idle', setup: null, loc: null, stoppedLoc: null, stopReason: null, lvl: {}, leafKey: null });
        return true;
      case 'MANUAL_ENTER':
        if (!r.power) return 'Stand power is off';
        if (!['idle', 'stopped', 'complete'].includes(r.status)) return 'Manual control is only available when no test is running';
        Object.assign(r, { status: 'manual', lvl: {}, setup: null, loc: null, stoppedLoc: null, stopReason: null });
        r.manual = { motor: 0, boostPump: 0, coolFan: 0, loadValve: 100, tankHeater: 0, hxHeater: 0, bypassValve: 0, user };
        return true;
      case 'MANUAL_EXIT':
        if (r.status !== 'manual') return 'Not in manual';
        if (r.manual.motor > 0 || r.manual.tankHeater || r.manual.hxHeater) return 'Bring motor to 0 rpm and switch heaters off first';
        r.status = 'idle'; r.manual = null;
        return true;
      case 'SET_OUTPUT':
        if (r.status !== 'manual') return 'Outputs can only be driven in manual mode';
        r.manual[arg.key] = arg.val;
        return true;
      case 'SOFT_STOP':
        return startShutdown(r, 'Software shutdown — ' + user, 'soft') || 'Nothing running to stop';
      case 'HARD_STOP':
        return startShutdown(r, 'Hard shutdown — ' + user, 'hard') || 'Unavailable — stand power is already off';
      case 'ACK':
        r.alarms.forEach((a) => { if (a.state === 'ACTIVE' && (arg == null || a.id === arg)) a.state = 'ACK'; });
        return true;
    }
    return 'Unknown command';
  }

  // ---- Public ------------------------------------------------------------
  S.init = function () {
    S.stands = M.RACKS.map(makeRack);
    S.stands.forEach((r) => {
      if (r.status === 'offline') return;
      r.t = S.now - 26 * H;
      advance(r, 26 * 3600, false);
      r.hist = r.hist.slice(-1440);
    });
  };

  S.tick = function (realMs) {
    const sec = (S.speed * realMs) / 1000;
    S.now += sec * 1000;
    S.stands.forEach((r) => { if (r.status !== 'offline') advance(r, sec, true); });
    stepShutdowns();
  };

  S.rack = (id) => S.stands.find((r) => r.id === id);
  S.injectFault = function (r, kind) {
    if (!['running', 'manual'].includes(r.status)) return false;
    if (kind === 'brake') { raise(r, 'R', 'brake', 24, 24, 'high'); return true; }
    r.fault = { ch: 'dispT', add: 0, rate: 1.5 / 60 };
    return true;
  };
  // The physical reset button in the bay. Deliberately NOT a software command.
  S.pressCellReset = function (r) {
    if (r.power || r.status === 'offline') return false;
    Object.assign(r, { power: true, status: 'idle', setup: null, loc: null, stoppedLoc: null, stopReason: null, lvl: {}, relayOpen: false });
    S.cmdLog.unshift({ t: S.now, rack: r.id, cmd: 'SAFETY RESET', origin: 'CELL BUTTON', user: 'person in cell', ok: true, note: 'Safety relay re-armed by hand', detail: '' });
    return true;
  };
  S.blink = function (r) {
    const un = r.alarms.filter((a) => a.state === 'ACTIVE');
    if (un.some((a) => a.sev === 'R')) return 'R';
    return un.length ? 'Y' : null;
  };
  S.elapsed = (r) => (r.startedAt ? (S.now - r.startedAt) / 1000 : 0);
  S.statusLabel = statusLabel;
})(globalThis.M = globalThis.M || {});
