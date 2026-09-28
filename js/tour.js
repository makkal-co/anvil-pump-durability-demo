// Guided walkthrough: spotlights one element at a time and explains the design reasoning.
(function (M) {
  const ui = M.ui;
  const STEPS = [
    { screen: 'overview', rack: null, sel: '[data-tour="tiles"]', title: 'The whole lab at a glance',
      text: 'Every rack, live: running, idle, stopped and offline. Racks not yet migrated appear too, so the phased roll-out is visible rather than hidden.',
      why: 'does the lab want a lab-wide view? It needs a lab-level service, so it is an architecture decision, not just a screen.' },
    { screen: 'overview', rack: null, sel: '#rail', title: 'Rack rail',
      text: 'One click to any rack. The LED blinks red when a stand has an unacknowledged red alarm.',
      why: 'Matches the reality of one PC per cell driving two stands — Option B in the architecture paper.' },
    { screen: 'overview', rack: null, sel: '#ribbon', title: 'Flat ribbon',
      text: 'Any screen is one click from any other. No nested menus. The Alarms button blinks — red wins over yellow — until acknowledged.',
      why: 'the panel-HMI mental model the technicians already know. Shutdown is never buried.' },
    { screen: 'graph', rack: 3, sel: '[data-tour="chlist"]', title: 'Every channel, live',
      text: 'All 32 channels with live values. The LED compares each alarmed channel against the thresholds of the step currently running. Click a row to add it to the graph.',
      why: 'Spec: value table on the left, configurable graph on the right.' },
    { screen: 'graph', rack: 3, sel: '[data-tour="plot"]', title: 'The step is on the time axis',
      text: 'The coloured strip under the graph shows which test step was running at every moment. Hover the graph for the full step path, including loop counters.',
      why: 'a trend without step context leaves you guessing which part of the procedure you are looking at.' },
    { screen: 'graph', rack: 3, sel: '[data-tour="logmode"]', title: 'Logging mode is visible',
      text: 'Continuous logging at the step\'s rate, min/max/RMS kept per interval so transients survive, and a 1 kHz burst armed for red alarms.',
      why: 'makes the tiered-logging recommendation something the customer can see working.' },
    { screen: 'manual', rack: 3, sel: '[data-tour="shutdown"]', title: 'Two shutdowns, always one click away',
      text: 'Software shutdown runs the spec\'s seven-step orderly stop. Hard shutdown does the same, then pulses the control relay so the hardware safety relay drops out. After a hard shutdown this screen shows RACK POWER IS OFF and the ribbon button blinks.',
      why: 'safety stays in hardware. There is deliberately no software path to re-arm the stand: a person must press the reset button in the bay.' },
    { screen: 'manual', rack: 3, sel: '[data-tour="ao"]', title: 'Command next to actual',
      text: 'In manual mode each output has a slider and a numeric entry, with the measured result right beside it. Manual outputs are locked while a test sequence is running.',
      why: 'and the note under the panel is the argument for keeping Ethernet on the drives: analog gives a setpoint, not a readback.' },
    { screen: 'alarms', rack: 7, sel: '[data-tour="altable"]', title: 'Every alarm knows its test step',
      text: 'Active and historical alarms, with the step that was running, the value and limit, and what the system did about it. Filter, acknowledge one or all, switch to a lab-wide view, or click an alarm and jump to it on the graph.',
      why: 'the spec asks for the step; the action-taken column makes the log explain the shutdown.' },
    { screen: 'config', rack: 3, cfg: 'rates', sel: '[data-tour="estimate"]', title: 'Sample rates are a stand setting — with the cost shown',
      text: 'Acquisition, continuous log rate, min/max/RMS decimation and burst triggers are set per rack. The estimate shows what the loaded test will produce against the controller\'s 4 GB — and what 1 kHz continuous would cost.',
      why: 'change a rate and the consequence is immediate. Keeping min/max/RMS on analog channels roughly quadruples their log size: tiered logging still fits, but only just, which is why logs are mirrored off the controller.' },
    { screen: 'config', rack: 3, cfg: 'hardware', sel: '.chassis', title: 'One spare slot',
      text: 'The proposed module set fills seven of eight slots. Plenty of spare channels — but only one slot for a new module type.',
      why: 'A finding from reading the BOM. To verify against the cRIO-9047 datasheet before quoting.' },
    { remote: true, sel: '[data-tour="cmdlog"]', title: 'Remote: view and stop, enforced by the controller',
      text: 'This is the view from home. Both shutdowns work. Start, manual control and acknowledge are sent anyway and refused — the command log shows every command with its origin, user and result.',
      why: 'permission lives in the controller\'s command handler, not in hidden buttons. A remote Engineer still cannot start a stand.' },
    { screen: 'setups', sel: '[data-tour="common"]', title: 'Change two numbers, not twenty',
      text: 'The day-to-day task is "open the overspeed test, change the speed, save as". Common parameters sit above the grid for exactly that. Try changing Endurance loops and watch the duration and storage update.',
      why: 'make the common case trivial and the rare case possible.' },
    { screen: 'setups', sel: '[data-tour="grid"]', title: 'A step grid, not a sequencer',
      text: 'Rows are steps, grouped into Start-up, Main and Shutdown. Each step has a type — DWELL, RAMP, DWELL UNTIL, HOLD — and loops repeat a group of steps, up to two levels deep.',
      why: 'these steps are operating conditions held over time, not pass/fail actions. A table fits that; TestStand does not.' },
    { screen: 'setups', sel: '[data-tour="tabs"]', title: 'Thresholds and alarm masks per step',
      text: 'Thresholds inherit down the grid, so you only type the exceptions. Alarm masks switch individual alarms off for a step — the air reservoir alarm is off during start-up because the reservoir starts empty.',
      why: '7 channels × 2 limits × every step would be thousands of cells without inheritance.' },
    { screen: 'setups', sel: '[data-tour="preview"]', title: 'See the test before you run it',
      text: 'The preview draws what the setup will command: motor speed and temperature targets through every phase, with loops shown once and a ×N count. Select a row to highlight it.',
      why: 'the grid is for entering a profile; the preview is for checking it. A 18000 rpm typo is obvious here.' },
    { screen: 'setups', sel: '[data-tour="storage"]', title: 'The storage argument, live',
      text: 'Estimated log size for this setup at its step rates, against the same test at 1 kHz continuous — and the 4 GB the controller holds.',
      why: 'our headline technical finding, turned into a number the customer watches change.' },
    { screen: 'overview', rack: null, sel: '#hdrDemo', title: 'Try a fault',
      text: 'Demo ▾ → "Stand 3: inject discharge over-temperature". Watch the yellow alarm, then the red alarm, then the software shutdown sequence run step by step on the Stand 3 tile.',
      why: 'The two moments a static mock cannot show: an alarm escalating, and the rig stopping itself safely.' },
  ];
  let i = -1, hole, card;

  function show(n) {
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    const s = STEPS[i];
    if (s.remote) {
      M.remote.open(true);
      if (!M.sim.cmdLog.some((c) => c.origin === 'REMOTE')) ['START', 'MANUAL_ENTER'].forEach((c) => M.sim.cmd(M.sim.rack(3), c, 'REMOTE', ui.state.user.u, c === 'START' ? M.setupById('end2000') : undefined));
      M.remote.refresh();
      setTimeout(place, 120);
      return setTimeout(place, 600); // overlay layout settles after its first paint
    }
    M.remote.close();
    if (s.cfg) ui.configTab(s.cfg);
    const needNav = ui.state.screen !== s.screen || !!s.cfg || (s.rack !== undefined && ui.state.rackId !== s.rack && s.screen !== 'setups');
    if (needNav) ui.go(s.screen, s.rack === undefined ? ui.state.rackId : s.rack);
    setTimeout(place, needNav ? 120 : 0);
    if (needNav) setTimeout(place, 600);
  }

  function place() {
    if (i < 0) return;
    const s = STEPS[i];
    const el = document.querySelector(s.sel);
    if (!el) return;
    if (!s.remote) el.scrollIntoView({ block: 'nearest' });
    else window.scrollTo(0, 0);
    const rc = el.getBoundingClientRect();
    const pad = 4;
    const top = Math.max(2, rc.top - pad), left = Math.max(2, rc.left - pad);
    const h = Math.min(window.innerHeight - top - 2, rc.height + pad * 2), w = Math.min(window.innerWidth - left - 2, rc.width + pad * 2);
    Object.assign(hole.style, { top: top + 'px', left: left + 'px', width: w + 'px', height: h + 'px' });

    card.innerHTML = `<div class="h">${s.title}</div>
      <div class="b">${s.text}<div class="why">${s.why}</div></div>
      <div class="f"><span class="count">${i + 1} / ${STEPS.length}</span><span class="sp"></span>
        <button class="btn sm" data-t="stop">Close</button>
        <button class="btn sm" data-t="prev" ${i === 0 ? 'disabled' : ''}>Back</button>
        <button class="btn sm primary" data-t="next">${i === STEPS.length - 1 ? 'Finish' : 'Next'}</button></div>`;
    const cw = 360, chh = card.offsetHeight || 220;
    let cy = rc.bottom + 12;
    if (cy + chh > window.innerHeight - 8) cy = rc.top - chh - 12;
    if (cy < 8) cy = Math.min(window.innerHeight - chh - 8, Math.max(8, rc.top + 20));
    let cx = rc.left;
    if (rc.width > window.innerWidth * 0.5) cx = rc.left + rc.width / 2 - cw / 2;
    cx = Math.max(8, Math.min(window.innerWidth - cw - 8, cx));
    Object.assign(card.style, { top: cy + 'px', left: cx + 'px' });
  }

  function start(at) {
    stop();
    hole = document.createElement('div'); hole.className = 'tour-hole';
    card = document.createElement('div'); card.className = 'tour-card';
    card.onclick = (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      if (b.dataset.t === 'stop') stop();
      if (b.dataset.t === 'prev') show(i - 1);
      if (b.dataset.t === 'next') (i === STEPS.length - 1 ? stop() : show(i + 1));
    };
    document.body.append(hole, card);
    window.addEventListener('resize', place);
    document.addEventListener('keydown', keys);
    show(at || 0);
  }
  function stop() {
    if (hole) hole.remove();
    if (card) card.remove();
    hole = card = null; i = -1;
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', keys);
  }
  function keys(e) {
    if (e.key === 'Escape') stop();
    if (e.key === 'ArrowRight') show(i + 1);
    if (e.key === 'ArrowLeft') show(i - 1);
  }

  M.tour = { start, stop };
})(globalThis.M = globalThis.M || {});
