// Demonstration data for a hydraulic pump endurance test stand.
// Entirely invented: no customer, no real rig, no real procedure. Round generic numbers only.
(function (M) {
  // ---- Channels -----------------------------------------------------------
  // An axial-piston pump on a stand that drives it, loads it through a proportional
  // valve, conditions its oil and measures it.
  const CH = [
    ['tankT', 'Oil tank', 'Temperatures', '°C', 1],
    ['sucT', 'Pump suction', 'Temperatures', '°C', 1],
    ['dispT', 'Pump discharge', 'Temperatures', '°C', 1],
    ['hxInT', 'Cooler inlet', 'Temperatures', '°C', 1],
    ['hxOutT', 'Cooler outlet', 'Temperatures', '°C', 1],
    ['postHxT', 'After cooler', 'Temperatures', '°C', 1],
    ['sumpT', 'Return sump', 'Temperatures', '°C', 1],
    ['ambT', 'Ambient air', 'Temperatures', '°C', 1],
    ['drvBrgT', 'Drive bearing', 'Temperatures', '°C', 1],
    ['pmpBrgT', 'Pump bearing', 'Temperatures', '°C', 1],
    ['filtT', 'Filter housing', 'Temperatures', '°C', 1],
    ['motWindT', 'Motor winding', 'Temperatures', '°C', 1],

    ['sysP', 'System pressure', 'Pressures', 'bar', 1],
    ['accP', 'Accumulator', 'Pressures', 'bar', 1],
    ['caseP', 'Case drain P', 'Pressures', 'bar', 2],
    ['sucP', 'Suction P', 'Pressures', 'bar', 2],
    ['bypP', 'Bypass P', 'Pressures', 'bar', 1],
    ['hxInP', 'Cooler in P', 'Pressures', 'bar', 2],
    ['hxOutP', 'Cooler out P', 'Pressures', 'bar', 2],

    ['dispF', 'Discharge flow', 'Flows', 'L/min', 1],
    ['caseF', 'Case drain flow', 'Flows', 'L/min', 2],
    ['hxF', 'Cooler flow', 'Flows', 'L/min', 1],

    ['speed', 'Shaft speed', 'Drive', 'rpm', 0],
    ['torque', 'Shaft torque', 'Drive', 'N·m', 1],
    ['speedDev', 'Speed deviation', 'Drive', 'rpm', 0],

    ['tankLvl', 'Oil tank level', 'Condition', '%', 1],
  ].map(([id, name, group, unit, dp]) => ({ id, name, group, unit, dp }));

  M.CH = CH;
  M.chById = Object.fromEntries(CH.map((c) => [c.id, c]));

  // Channels carrying per-step limits in the procedure editor.
  M.TH = [
    { ch: 'tankT', dir: 'high', short: 'Tank T' },
    { ch: 'dispT', dir: 'high', short: 'Disch T' },
    { ch: 'drvBrgT', dir: 'high', short: 'Drv brg' },
    { ch: 'pmpBrgT', dir: 'high', short: 'Pmp brg' },
    { ch: 'sysP', dir: 'high', short: 'System P' },
    { ch: 'caseF', dir: 'high', short: 'Case flow',
      hint: 'Case drain flow is the wear indicator on a piston pump: it climbs as internal clearances open up. A rising trend over a long run matters more than any single reading.' },
    { ch: 'speedDev', dir: 'high', short: 'Speed Δ',
      hint: 'Speed deviation = |actual shaft speed − the speed the running step is commanding|. It catches a drive that is not following its command. During a RAMP the command moves with the ramp, so only a genuine tracking error alarms.' },
  ];

  const BASE_TH = { tankT: [75, 85], dispT: [90, 105], drvBrgT: [85, 95], pmpBrgT: [90, 100], sysP: [280, 320], caseF: [6, 9], speedDev: [50, 150] };
  M.DEFAULT_TH = BASE_TH;

  // Some red alarms are never maskable by a procedure. Lab policy, edited in Stand Config.
  M.NOMASK_RED = ['dispT', 'tankT'];

  M.USERS = [
    { u: 'viewer', name: 'Lab viewer', role: 'Viewer' },
    { u: 'tech.demo', name: 'Day-shift technician', role: 'Operator' },
    { u: 'eng.demo', name: 'Test engineer', role: 'Engineer' },
    { u: 'maint.demo', name: 'Maintenance', role: 'Maintenance' },
  ];

  const H = 3600 * 1000;
  // Eight stands in four bays. status: running | idle | offline.
  M.RACKS = [
    { id: 1, cell: 1, status: 'running', setup: 'end2000', elapsedH: 940 },
    { id: 2, cell: 1, status: 'running', setup: 'coldstart', elapsedH: 61 },
    { id: 3, cell: 2, status: 'running', setup: 'end2000', elapsedH: 142, hero: true },
    { id: 4, cell: 2, status: 'idle' },
    { id: 5, cell: 3, status: 'running', setup: 'highspeed', elapsedH: 0.6 },
    { id: 6, cell: 3, status: 'offline', legacy: true, reason: 'Not yet migrated — legacy panel controller' },
    { id: 7, cell: 4, status: 'running', setup: 'end400', elapsedH: 48, stopAgoH: 3 },
    { id: 8, cell: 4, status: 'idle' },
  ];
  M.H = H;

  // ---- Procedures ---------------------------------------------------------
  const sp = (motor, boostPump, coolFan, loadValve, tankT, coolerT) => ({ motor, boostPump, coolFan, loadValve, tankT, coolerT });
  const st = (id, type, name, dur, s, extra) => Object.assign({ id, type, name, dur, sp: s, logHz: null }, extra || {});
  const blk = (id, name, repeat, steps) => ({ id, type: 'BLOCK', name, repeat, steps });

  const MASK_START = { sysP: [0, 0], caseP: [0, 0] };
  const MASK_SHUT = { sysP: [0, 0], caseP: [0, 0], speedDev: [0, 0] };

  const startup = () => [
    st('S1', 'DWELL', 'Fill and bleed', 300, sp(0, 40, 0, 100, 35, null), { mask: MASK_START }),
    st('S2', 'DWELL_UNTIL', 'Circulation check', 600, sp(0, 40, 50, 100, 35, 25),
      { until: { ch: 'hxF', op: '≥', v: 8 }, onTimeout: 'ABORT', mask: MASK_START }),
    st('S3', 'RAMP', 'Warm-up', 1200, sp(600, 60, 60, 80, 45, 35), { mask: { sysP: [0, 0] } }),
  ];
  const shutdown = () => [
    st('E1', 'DWELL', 'Cool-down', 900, sp(0, 60, 100, 100, null, 25), { mask: MASK_SHUT }),
    st('E2', 'DWELL', 'Pump-off', 120, sp(0, 0, 0, 100, null, null), { mask: MASK_SHUT }),
  ];

  const endurance = (id, name, rev, outer, used) => ({
    id, name, rev, used, logHz: 1, base: JSON.parse(JSON.stringify(BASE_TH)),
    common: [
      { label: 'Shaft speed', key: 'motor', unit: 'rpm' },
      { label: 'Oil tank target', key: 'tankT', unit: '°C' },
      { label: 'Cooler out target', key: 'coolerT', unit: '°C' },
      { label: 'Endurance loops', block: 'B1', unit: '× ~100 h' },
    ],
    phases: {
      startup: startup(),
      main: [
        st('1', 'RAMP', 'Ramp to speed', 600, sp(1800, 100, 100, 20, 55, 45), { mask: { sysP: [0, 0] } }),
        blk('B1', 'Endurance loop', outer, [
          blk('B2', 'Pressure cycles', 6984, [
            st('2', 'DWELL', 'Loaded', 30, sp(1800, 100, 100, 10, 55, 45)),
            st('3', 'DWELL', 'Unloaded', 20, sp(1800, 100, 100, 100, 55, 45)),
          ]),
          st('4', 'DWELL', 'Hot soak', 7200, sp(2100, 100, 100, 20, 72, 60), { logHz: 5, th: { tankT: [80, 90], dispT: [98, 112] } }),
        ]),
      ],
      shutdown: shutdown(),
    },
  });

  M.SETUPS = [
    endurance('end2000', 'Endurance_2000h', 'C', 20, true),
    endurance('end400', 'Endurance_400h', 'A', 4, true),
    {
      id: 'coldstart', name: 'ColdStart', rev: '3', used: true, logHz: 1,
      base: Object.assign(JSON.parse(JSON.stringify(BASE_TH)), { caseF: [9, 13] }),
      common: [{ label: 'Cold soak target', key: 'tankT', unit: '°C', match: 5 }, { label: 'Warm soak target', key: 'tankT', unit: '°C', match: 60 }, { label: 'Start cycles', block: 'B1', unit: '×' }],
      phases: {
        startup: [startup()[0], st('S2', 'RAMP', 'Warm-up', 900, sp(900, 60, 80, 20, 40, 30), { mask: { sysP: [0, 0] } })],
        main: [
          blk('B1', 'Start cycles', 150, [
            st('1', 'DWELL_UNTIL', 'Chill down', 2700, sp(0, 40, 100, 100, 5, 5), { until: { ch: 'tankT', op: '≤', v: 8 }, onTimeout: 'ABORT' }),
            st('2', 'DWELL', 'Cold soak', 1800, sp(0, 40, 100, 100, 5, 5)),
            st('3', 'RAMP', 'Cold start', 60, sp(1800, 100, 60, 30, 5, 20), { logHz: 10 }),
            st('4', 'DWELL_UNTIL', 'Warm through', 2400, sp(1800, 100, 60, 20, 60, 50), { until: { ch: 'tankT', op: '≥', v: 55 }, onTimeout: 'HOLD' }),
          ]),
        ],
        shutdown: shutdown(),
      },
    },
    {
      id: 'highspeed', name: 'HighSpeed', rev: 'B', used: true, logHz: 1, base: JSON.parse(JSON.stringify(BASE_TH)),
      common: [{ label: 'Overspeed', key: 'motor', unit: 'rpm', match: 2850 }],
      phases: {
        startup: startup(),
        main: [
          st('1', 'RAMP', 'Ramp to rated', 600, sp(1800, 100, 100, 20, 55, 45), { mask: { sysP: [0, 0] } }),
          st('2', 'RAMP', 'Ramp to overspeed', 300, sp(2850, 100, 100, 20, 55, 45), { logHz: 100 }),
          st('3', 'DWELL', 'Overspeed hold', 900, sp(2850, 100, 100, 20, 55, 45), { logHz: 100, th: { dispT: [112, 125], pmpBrgT: [102, 112] } }),
          st('4', 'RAMP', 'Return to rated', 300, sp(1800, 100, 100, 20, 55, 45), { th: { dispT: [90, 105] } }),
          st('5', 'DWELL', 'Verify', 1800, sp(1800, 100, 100, 20, 55, 45)),
        ],
        shutdown: shutdown(),
      },
    },
    {
      id: 'overp', name: 'Overpressure', rev: 'A', used: false, logHz: 1, base: JSON.parse(JSON.stringify(BASE_TH)),
      common: [{ label: 'Shaft speed', key: 'motor', unit: 'rpm', match: 1500 }],
      phases: {
        startup: startup(),
        main: [
          st('1', 'RAMP', 'Ramp to speed', 600, sp(1500, 100, 100, 20, 55, 45), { mask: { sysP: [0, 0] } }),
          st('2', 'DWELL', 'Build pressure', 900, sp(1500, 100, 100, 0, 55, 45), { th: { sysP: [330, 360] } }),
          st('3', 'DWELL', 'Hold overpressure', 1800, sp(1500, 100, 100, 0, 55, 45), { logHz: 10, th: { sysP: [330, 360] } }),
          st('4', 'DWELL', 'Vent', 300, sp(1500, 100, 100, 100, 55, 45), { mask: { sysP: [0, 0] } }),
        ],
        shutdown: shutdown(),
      },
    },
  ];
  M.setupById = (id) => M.SETUPS.find((s) => s.id === id);
})(globalThis.M = globalThis.M || {});
