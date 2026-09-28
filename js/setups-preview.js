// Profile preview: read-only picture of what a setup will command.
// Not to scale — each step gets equal width, loops are drawn once (or 3× for
// inner duty cycles) with a ×N bracket, so a 3000 h test fits on one screen.
(function (M) {
  const P = M.prof;

  function layout(setup) {
    const segs = [], brackets = [], phases = [];
    let u = 0;
    const lay = (items, phase, depth) => {
      items.forEach((it) => {
        if (it.type === 'BLOCK') {
          const start = u;
          const nested = it.steps.some((s) => s.type === 'BLOCK');
          const reps = nested ? 1 : Math.min(3, it.repeat);
          for (let i = 0; i < reps; i++) lay(it.steps, phase, depth + 1);
          if (it.repeat > reps) { segs.push({ u0: u, u1: u + 0.6, type: 'ELLIPSIS', item: it, phase }); u += 0.6; }
          brackets.push({ u0: start, u1: u, label: `${it.name} ×${it.repeat.toLocaleString()}`, depth, item: it });
        } else {
          segs.push({ u0: u, u1: u + 1, type: it.type, sp: it.sp, item: it, phase });
          u += 1;
        }
      });
    };
    P.PHASES.forEach((ph) => {
      const s = u;
      lay(setup.phases[ph], ph, 0);
      phases.push({ u0: s, u1: u, label: P.PHASE_LABEL[ph] });
    });
    return { segs, brackets, phases, units: u };
  }

  function draw(canvas, setup, selItem) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = '11px Segoe UI, Arial';

    const lay = layout(setup);
    const maxBr = lay.brackets.reduce((a, b) => Math.max(a, b.depth), -1);
    const L = 52, R = 44, T = 22 + (maxBr + 1) * 16, B = 34;
    const pw = W - L - R, ph = H - T - B;
    if (pw < 50 || ph < 30 || !lay.units) return;
    const X = (u) => L + (u / lay.units) * pw;
    let maxRpm = 0;
    lay.segs.forEach((s) => { if (s.sp) maxRpm = Math.max(maxRpm, s.sp.motor || 0); });
    maxRpm = Math.ceil((maxRpm || 1000) / 500) * 500;
    const Yr = (v) => T + ph - (v / maxRpm) * ph;
    const Yt = (v) => T + ph - (v / 120) * ph;

    g.fillStyle = '#fff'; g.fillRect(L, T, pw, ph);

    // Selection highlight
    lay.segs.forEach((s) => { if (selItem && s.item === selItem) { g.fillStyle = '#dbe8f8'; g.fillRect(X(s.u0), T, X(s.u1) - X(s.u0), ph); } });
    lay.brackets.forEach((b) => { if (selItem && b.item === selItem) { g.fillStyle = 'rgba(224,161,0,.12)'; g.fillRect(X(b.u0), T, X(b.u1) - X(b.u0), ph); } });

    // Phase separators
    g.strokeStyle = '#b9c1ca'; g.fillStyle = '#5b6775'; g.textAlign = 'left'; g.textBaseline = 'top';
    lay.phases.forEach((p, i) => {
      if (i) { g.beginPath(); g.moveTo(X(p.u0) + 0.5, 4); g.lineTo(X(p.u0) + 0.5, T + ph); g.stroke(); }
      g.font = '600 11px Segoe UI, Arial'; g.fillText(p.label.toUpperCase(), X(p.u0) + 4, 4); g.font = '11px Segoe UI, Arial';
    });

    // Loop brackets
    lay.brackets.forEach((b) => {
      const y = 20 + b.depth * 16, x0 = X(b.u0) + 2, x1 = X(b.u1) - 2;
      g.strokeStyle = '#b07d00'; g.beginPath(); g.moveTo(x0, y + 8); g.lineTo(x0, y + 3); g.lineTo(x1, y + 3); g.lineTo(x1, y + 8); g.stroke();
      g.fillStyle = '#7a5800'; g.textAlign = 'center';
      const w = g.measureText(b.label).width;
      if (w < x1 - x0 - 4) { g.fillStyle = '#fff'; g.fillRect((x0 + x1) / 2 - w / 2 - 3, y - 4, w + 6, 12); g.fillStyle = '#7a5800'; g.fillText(b.label, (x0 + x1) / 2, y - 4); }
    });

    // Axes labels
    g.fillStyle = '#5b6775'; g.textAlign = 'right'; g.textBaseline = 'middle';
    [0, maxRpm / 2, maxRpm].forEach((v) => g.fillText(v + '', L - 6, Yr(v)));
    g.textAlign = 'left';
    [0, 60, 120].forEach((v) => g.fillText(v + ' °C', L + pw + 4, Yt(v)));
    g.save(); g.translate(10, T + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = '#1f5fbf'; g.fillText('Motor rpm', 0, 0); g.restore();

    // Series: drive speed (solid), tank and cooler targets (dashed)
    const series = [
      { key: 'motor', Y: Yr, color: '#1f5fbf', dash: [] },
      { key: 'tankT', Y: Yt, color: '#d9480f', dash: [5, 3] },
      { key: 'coolerT', Y: Yt, color: '#2b8a3e', dash: [2, 3] },
    ];
    series.forEach((sr) => {
      g.strokeStyle = sr.color; g.lineWidth = sr.key === 'motor' ? 2 : 1.4; g.setLineDash(sr.dash);
      let prev = null;
      g.beginPath();
      lay.segs.forEach((s) => {
        if (s.type === 'ELLIPSIS') {
          if (prev == null) return;
          g.stroke(); g.setLineDash([1, 4]); g.beginPath(); g.moveTo(X(s.u0), sr.Y(prev)); g.lineTo(X(s.u1), sr.Y(prev)); g.stroke();
          g.setLineDash(sr.dash); g.beginPath(); g.moveTo(X(s.u1), sr.Y(prev));
          return;
        }
        if (s.type === 'HOLD') return;
        const v = s.sp[sr.key];
        if (v == null) { if (prev != null) { g.stroke(); g.beginPath(); } prev = null; return; }
        if (prev == null) g.moveTo(X(s.u0), sr.Y(s.type === 'RAMP' && sr.key === 'motor' ? 0 : v));
        if (s.type === 'RAMP' && sr.key === 'motor') g.lineTo(X(s.u1), sr.Y(v));
        else { g.lineTo(X(s.u0), sr.Y(v)); g.lineTo(X(s.u1), sr.Y(v)); }
        prev = v;
      });
      g.stroke(); g.setLineDash([]);
    });

    // Step labels + durations under the plot
    g.textAlign = 'center'; g.textBaseline = 'top';
    lay.segs.forEach((s) => {
      const x0 = X(s.u0), x1 = X(s.u1), w = x1 - x0;
      g.strokeStyle = '#eef1f4'; g.beginPath(); g.moveTo(x0 + 0.5, T); g.lineTo(x0 + 0.5, T + ph); g.stroke();
      if (s.type === 'HOLD') { g.fillStyle = '#7048e8'; g.fillText('✋', (x0 + x1) / 2, T + ph / 2 - 6); }
      if (s.type === 'ELLIPSIS') { g.fillStyle = '#7a5800'; g.fillText('…', (x0 + x1) / 2, T + ph + 4); return; }
      g.fillStyle = s.item === selItem ? '#1f5fbf' : '#34414e';
      const name = s.item.name;
      if (g.measureText(name).width < w - 4) g.fillText(name, (x0 + x1) / 2, T + ph + 4);
      const d = s.type === 'HOLD' ? 'operator' : P.fmtDur(P.dur(s.item));
      g.fillStyle = '#8a939e';
      if (g.measureText(d).width < w - 4) g.fillText(d, (x0 + x1) / 2, T + ph + 18);
    });
    g.strokeStyle = '#b9c1ca'; g.strokeRect(L + 0.5, T + 0.5, pw, ph);
  }

  M.preview = { draw, layout };
})(globalThis.M = globalThis.M || {});
