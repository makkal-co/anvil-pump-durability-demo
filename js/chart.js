// Minimal canvas time-series chart: two Y axes, threshold lines, step bands strip, hover.
// Deliberately limited to what a LabVIEW waveform/XY graph can also do.
(function (M) {
  const COLORS = ['#1f5fbf', '#d9480f', '#2b8a3e', '#7048e8', '#c2255c', '#0b7285', '#e67700', '#495057'];
  const BAND_COLORS = ['#dbe4f0', '#e8e2f3', '#dcece2', '#f3e6d6', '#e6ecef'];

  function nice(lo, hi, n) {
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
  }
  const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  // opts: {series:[{name,unit,axis,color,pts:[[t,v]]}], t0, t1, bands:[{t0,t1,label}], thresholds:[{v,axis,sev}], hoverT}
  function draw(canvas, opts) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, Hh = canvas.clientHeight;
    if (canvas.width !== W * dpr || canvas.height !== Hh * dpr) { canvas.width = W * dpr; canvas.height = Hh * dpr; }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, Hh);
    g.font = '11px Segoe UI, Arial, sans-serif';

    const hasR = opts.series.some((s) => s.axis === 1);
    const L = 58, R = hasR ? 58 : 16, T = 10, BAND = 24, B = 22 + BAND;
    const pw = W - L - R, ph = Hh - T - B;
    const X = (t) => L + ((t - opts.t0) / (opts.t1 - opts.t0)) * pw;

    // Axis ranges from visible data (+ thresholds so limits stay on screen)
    const axes = [0, 1].map((a) => {
      let lo = Infinity, hi = -Infinity;
      opts.series.filter((s) => s.axis === a).forEach((s) => s.pts.forEach(([t, v]) => { if (t >= opts.t0 && t <= opts.t1) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
      (opts.thresholds || []).filter((th) => th.axis === a).forEach((th) => { lo = Math.min(lo, th.v); hi = Math.max(hi, th.v); });
      const pad = (hi - lo) * 0.08 || 1;
      return nice(lo - pad, hi + pad, 5);
    });
    const Y = (a, v) => T + ph - ((v - axes[a].lo) / (axes[a].hi - axes[a].lo)) * ph;

    // Plot background + grid
    g.fillStyle = '#ffffff'; g.fillRect(L, T, pw, ph);
    g.strokeStyle = '#e3e7ec'; g.lineWidth = 1;
    g.fillStyle = '#5b6775'; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let v = axes[0].lo; v <= axes[0].hi + 1e-9; v += axes[0].step) {
      const y = Math.round(Y(0, v)) + 0.5;
      g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke();
      if (opts.series.some((s) => s.axis === 0)) g.fillText(+v.toFixed(2), L - 6, y);
    }
    if (hasR) {
      g.textAlign = 'left';
      for (let v = axes[1].lo; v <= axes[1].hi + 1e-9; v += axes[1].step) g.fillText(+v.toFixed(2), L + pw + 6, Y(1, v));
    }
    const unit = (a) => [...new Set(opts.series.filter((s) => s.axis === a).map((s) => s.unit))].join(', ');
    g.save(); g.fillStyle = '#1d2733'; g.font = '600 11px Segoe UI, Arial';
    g.translate(12, T + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(unit(0), 0, 0); g.restore();
    if (hasR) { g.save(); g.fillStyle = '#1d2733'; g.font = '600 11px Segoe UI, Arial'; g.translate(W - 10, T + ph / 2); g.rotate(Math.PI / 2); g.textAlign = 'center'; g.fillText(unit(1), 0, 0); g.restore(); }

    // Time ticks. The step list runs out to weeks so a 3000-hour run does not draw 750 labels.
    const spanMin = (opts.t1 - opts.t0) / 60000;
    const STEPS = [5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880, 10080, 20160, 43200];
    const stepMin = STEPS.find((m) => spanMin / m <= 8) || STEPS[STEPS.length - 1];
    const label = stepMin >= 1440 ? ((t) => new Date(t).toISOString().slice(5, 10))        // MM-DD
      : spanMin > 36 * 60 ? ((t) => new Date(t).toISOString().slice(5, 10) + ' ' + hhmm(t))
        : hhmm;
    g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = '#5b6775';
    for (let t = Math.ceil(opts.t0 / (stepMin * 60000)) * stepMin * 60000; t <= opts.t1; t += stepMin * 60000) {
      const x = Math.round(X(t)) + 0.5;
      g.strokeStyle = '#eef1f4'; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke();
      g.fillText(label(t), x, T + ph + BAND + 5);
    }

    // Step bands strip
    const by = T + ph + 2;
    const labelColor = {};
    let ci = 0;
    (opts.bands || []).forEach((b) => {
      const x0 = Math.max(L, X(b.t0)), x1 = Math.min(L + pw, X(b.t1));
      if (x1 <= x0) return;
      if (!(b.label in labelColor)) labelColor[b.label] = BAND_COLORS[ci++ % BAND_COLORS.length];
      g.fillStyle = /Stop|Shutting/.test(b.label) ? '#f4d4d2' : labelColor[b.label];
      g.fillRect(x0, by, x1 - x0, BAND - 4);
      g.strokeStyle = '#ffffff'; g.beginPath(); g.moveTo(x0 + 0.5, by); g.lineTo(x0 + 0.5, by + BAND - 4); g.stroke();
      g.fillStyle = '#2d3a48'; g.textAlign = 'left'; g.textBaseline = 'middle';
      const w = g.measureText(b.label).width;
      if (x1 - x0 > w + 8) g.fillText(b.label, x0 + 4, by + (BAND - 4) / 2);
    });

    // Thresholds
    (opts.thresholds || []).forEach((th) => {
      const y = Math.round(Y(th.axis, th.v)) + 0.5;
      g.strokeStyle = th.sev === 'R' ? '#d0312d' : '#e0a100';
      g.setLineDash([6, 4]); g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = g.strokeStyle; g.textAlign = 'right'; g.textBaseline = 'bottom';
      g.fillText((th.sev === 'R' ? 'red ' : 'yellow ') + th.v, L + pw - 4, y - 2);
    });

    // Series
    g.save(); g.beginPath(); g.rect(L, T, pw, ph); g.clip();
    opts.series.forEach((s) => {
      g.strokeStyle = s.color; g.lineWidth = 1.6; g.beginPath();
      let first = true;
      s.pts.forEach(([t, v]) => {
        if (t < opts.t0 - 120000 || t > opts.t1 + 120000) return;
        const x = X(t), y = Y(s.axis, v);
        first ? g.moveTo(x, y) : g.lineTo(x, y); first = false;
      });
      g.stroke();
    });
    g.restore();

    // Frame
    g.strokeStyle = '#b9c0c9'; g.lineWidth = 1; g.strokeRect(L + 0.5, T + 0.5, pw, ph);

    // Hover crosshair
    if (opts.hoverT != null && opts.hoverT >= opts.t0 && opts.hoverT <= opts.t1) {
      const x = Math.round(X(opts.hoverT)) + 0.5;
      g.strokeStyle = '#1d2733'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph + BAND); g.stroke(); g.setLineDash([]);
    }
    return { L, pw, T, ph, tAt: (px) => opts.t0 + ((px - L) / pw) * (opts.t1 - opts.t0) };
  }

  M.chart = { draw, COLORS, hhmm };
})(globalThis.M = globalThis.M || {});
