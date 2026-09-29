(function () {
  "use strict";

  const calc = window.ShockCalculations;
  const G_MM = calc.STANDARD_GRAVITY * 1000;
  const MAX_TABLE_ROWS = 10000;
  const LIMITS = { peakMin: 0.5, peakMax: 1000, durMinMs: 0.1, durMaxMs: 1000 };
  const $ = (s) => document.querySelector(s);

  const el = {
    peak: $('#peak'), duration: $('#duration'), dt: $('#dt'),
    plot: $('#plot'), canvas: $('#wave'), readout: $('#readout'), msg: $('#plot-msg'),
    peakHandle: $('#peak-handle'), durHandle: $('#dur-handle'),
    peakTag: $('#peak-tag'), durTag: $('#dur-tag'), areaLabel: $('#area-label'),
    drawer: $('#drawer'), toggle: $('#drawer-toggle')
  };

  let result = null;
  let scale = null;
  let frozen = false;
  let geom = null;
  let hover = -1;
  let tableDirty = true;

  /* ---------- formatting (carried over from V1 app.js) ---------- */
  function fixed(value, digits) { return Number(value).toFixed(digits); }
  function trimmed(value, digits) { return Number(Number(value).toFixed(digits)).toString(); }
  function accelerationLabel(value) {
    return Math.abs(value) >= 1000 ? Math.round(value).toString() : trimmed(value, 2);
  }
  function decimalPlaces(step) {
    for (let places = 0; places <= 8; places += 1) {
      const scaled = step * (10 ** places);
      if (Math.abs(scaled - Math.round(scaled)) < 1e-8) return places;
    }
    return 8;
  }
  function profileTimeFormatter(r) {
    const digits = Math.max(0, decimalPlaces(r.dt_s), decimalPlaces(r.duration_s));
    return (value) => fixed(value, digits);
  }
  // Display-only thousands grouping with a thin space (exports stay ungrouped).
  const group = (s) => (/^-?\d+$/.test(s) ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : s);

  const shape = () => document.querySelector('input[name="shape"]:checked').value;
  const SHAPE_NAME = { 'half-sine': 'Half-sine', rectangular: 'Rectangular' };

  function payload() {
    return {
      dt_s: Number(el.dt.value),
      peak_g: Number(el.peak.value),
      duration_seconds: Number(el.duration.value) / 1000,
      pulse_shape: shape()
    };
  }

  /* ---------- validation feedback ---------- */
  const FIELD_FOR = { Peak: 'peak', Duration: 'duration', dt: 'dt' };

  function clearErrors() {
    document.body.classList.remove('is-invalid');
    el.msg.textContent = '';
    ['peak', 'duration', 'dt'].forEach((k) => {
      $(`#err-${k}`).textContent = '';
      $(`#field-${k}`).classList.remove('invalid');
      el[k].removeAttribute('aria-invalid');
    });
  }

  function showError(message) {
    document.body.classList.add('is-invalid');
    const key = Object.keys(FIELD_FOR).find((p) => message.startsWith(p));
    if (key) {
      const k = FIELD_FOR[key];
      $(`#err-${k}`).textContent = message;
      $(`#field-${k}`).classList.add('invalid');
      el[k].setAttribute('aria-invalid', 'true');
      el.msg.textContent = 'Showing the last valid pulse — correct the highlighted value.';
    } else {
      el.msg.textContent = message;
    }
  }

  /* ---------- live calculation ---------- */
  function compute() {
    clearErrors();
    let r;
    try {
      r = calc.calculate(payload());
    } catch (error) {
      showError(error.message || 'Unable to calculate the shock profile.');
      return null;
    }
    result = r;
    if (!frozen) scale = makeScale(r);
    hover = -1;
    el.readout.classList.remove('show');
    renderResults(r);
    tableDirty = true;
    if (activeTab() === 'profile') renderTable();
    draw();
    return r;
  }

  function renderResults(r) {
    $('#r-peak').textContent = group(accelerationLabel(r.peak_acceleration_mm_s2));
    $('#r-peak-sub').textContent = `${trimmed(r.peak_g, 4)} G × ${calc.STANDARD_GRAVITY} m/s²`;
    $('#r-dv').textContent = fixed(r.delta_v_m_s, 3);
    $('#r-dv-formula').innerHTML = r.pulse_shape === 'half-sine'
      ? '(half-sine: 2 a<sub>peak</sub> T / π)'
      : '(rectangular: a<sub>peak</sub> T)';
    $('#r-v0').textContent = fixed(r.initial_velocity_mm_s, 1);

    $('#peak-tag-v').textContent = trimmed(r.peak_g, 4);
    $('#dur-tag-v').textContent = fixed(r.duration_ms, 2);
    $('#area-v').textContent = `${fixed(r.delta_v_m_s, 3)} m/s`;

    el.peakHandle.setAttribute('aria-valuenow', String(r.peak_g));
    el.peakHandle.setAttribute('aria-valuetext', `${trimmed(r.peak_g, 4)} G`);
    el.durHandle.setAttribute('aria-valuenow', trimmed(r.duration_ms, 4));
    el.durHandle.setAttribute('aria-valuetext', `${fixed(r.duration_ms, 2)} ms`);
    el.canvas.setAttribute('aria-label',
      `${SHAPE_NAME[r.pulse_shape]} pulse, peak ${accelerationLabel(r.peak_acceleration_mm_s2)} mm/s², duration ${fixed(r.duration_ms, 2)} ms, ${r.profile_points} points. Use the left and right arrow keys to read individual points.`);

    $('#meta-points').textContent = r.profile_points.toLocaleString();
    $('#meta-dt').textContent = `${trimmed(r.dt_s, 8)} s`;
    $('#meta-pulse').textContent = `${SHAPE_NAME[r.pulse_shape]} · ${trimmed(r.peak_g, 4)} G · ${fixed(r.duration_ms, 2)} ms`;
  }

  /* ---------- waveform ---------- */
  function niceStep(raw) {
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }

  function makeScale(r) {
    const top = r.peak_acceleration_mm_s2 * 1.12;
    const yStep = niceStep(top / 5);
    const xMax = r.duration_ms * 1.22;
    return {
      xMin: -r.duration_ms * 0.06,
      xMax,
      xStep: niceStep(xMax / 5),
      yStep,
      yMax: yStep * Math.ceil(top / yStep)
    };
  }

  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function draw() {
    if (!result || !scale) return;
    const r = result;
    const rect = el.plot.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.canvas.width = Math.round(rect.width * dpr);
    el.canvas.height = Math.round(rect.height * dpr);
    const ctx = el.canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const W = rect.width, H = rect.height;
    const narrow = W < 640;
    const m = { top: 58, right: narrow ? 20 : 36, bottom: 86, left: narrow ? 72 : 92 };
    const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    const x = (v) => m.left + ((v - scale.xMin) / (scale.xMax - scale.xMin)) * pw;
    const y = (v) => m.top + ph - (v / scale.yMax) * ph;
    geom = {
      m, pw, ph, x, y,
      xi: (px) => scale.xMin + ((px - m.left) / pw) * (scale.xMax - scale.xMin),
      yi: (py) => ((m.top + ph - py) / ph) * scale.yMax
    };

    const font = cssVar('--font'), ink = cssVar('--ink'), ink2 = cssVar('--ink-2'), muted = cssVar('--muted');
    const grid = cssVar('--grid'), orange = cssVar('--orange'), orangeFill = cssVar('--orange-fill'), card = cssVar('--card');

    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;

    // grid + tick labels
    ctx.font = `400 12px ${font}`;
    ctx.fillStyle = muted;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let v = 0; v <= scale.yMax + 1e-9; v += scale.yStep) {
      const py = Math.round(y(v)) + 0.5;
      if (v > 0) {
        ctx.strokeStyle = grid;
        ctx.beginPath(); ctx.moveTo(m.left, py); ctx.lineTo(m.left + pw, py); ctx.stroke();
      }
      ctx.fillText(group(String(Math.round(v))), m.left - 14, py);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let v = 0; v <= scale.xMax + 1e-9; v += scale.xStep) {
      const px = Math.round(x(v)) + 0.5;
      if (v > 0) {
        ctx.strokeStyle = grid;
        ctx.beginPath(); ctx.moveTo(px, m.top - 6); ctx.lineTo(px, y(0)); ctx.stroke();
      }
      ctx.fillText(trimmed(v, 3), px, y(0) + 12);
    }

    // axis titles
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = `500 13.5px ${font}`; ctx.fillStyle = ink;
    ctx.fillText('Acceleration', 24, 30);
    const aw = ctx.measureText('Acceleration  ').width;
    ctx.fillStyle = muted; ctx.fillText('mm/s²', 24 + aw, 30);
    ctx.textAlign = 'right';
    ctx.fillStyle = muted; ctx.fillText('ms', m.left + pw, y(0) + 44);
    const msw = ctx.measureText('  ms').width;
    ctx.fillStyle = ink; ctx.fillText('Time', m.left + pw - msw, y(0) + 44);

    // axes
    ctx.strokeStyle = ink2;
    ctx.beginPath(); ctx.moveTo(Math.round(x(0)) + 0.5, m.top - 6); ctx.lineTo(Math.round(x(0)) + 0.5, y(0)); ctx.stroke();

    // pulse path
    const peakY = y(r.peak_acceleration_mm_s2);
    const trace = new Path2D();
    trace.moveTo(x(scale.xMin), y(0));
    if (r.pulse_shape === 'rectangular') {
      trace.lineTo(x(0), y(0)); trace.lineTo(x(0), peakY);
      trace.lineTo(x(r.duration_ms), peakY); trace.lineTo(x(r.duration_ms), y(0));
    } else {
      const stride = Math.max(1, Math.ceil(r.profile.length / 2000));
      r.profile.forEach((p, i) => {
        if (i % stride && i !== r.profile.length - 1) return;
        trace.lineTo(x(p.time_ms), y(p.acceleration_mm_s2));
      });
    }
    const area = new Path2D(trace);
    area.lineTo(x(r.duration_ms), y(0)); area.lineTo(x(0), y(0)); area.closePath();
    ctx.fillStyle = orangeFill;
    ctx.fill(area);

    // zero line over the fill
    ctx.strokeStyle = ink2; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(m.left - 4, Math.round(y(0)) + 0.5); ctx.lineTo(m.left + pw, Math.round(y(0)) + 0.5); ctx.stroke();

    trace.lineTo(x(scale.xMax), y(0));
    ctx.strokeStyle = orange; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.stroke(trace);

    // peak guide + value
    const tPeak = r.duration_ms / 2;
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.3; ctx.strokeStyle = orange;
    ctx.beginPath(); ctx.moveTo(m.left, Math.round(peakY) + 0.5); ctx.lineTo(x(tPeak) - 14, Math.round(peakY) + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 13px ${font}`; ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${group(accelerationLabel(r.peak_acceleration_mm_s2))} mm/s²`, x(0) + 14, peakY - 7);

    // duration bracket
    const x0 = x(0), x1 = x(r.duration_ms);
    const by = y(0) + 56;
    ctx.strokeStyle = ink2; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x0) + 0.5, y(0) + 30); ctx.lineTo(Math.round(x0) + 0.5, by + 9);
    ctx.moveTo(Math.round(x1) + 0.5, y(0) + 14); ctx.lineTo(Math.round(x1) + 0.5, by + 9);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x0, by + 0.5); ctx.lineTo(x1, by + 0.5); ctx.stroke();
    ctx.fillStyle = ink2;
    [[x0, 1], [x1, -1]].forEach(([ax, d]) => {
      ctx.beginPath(); ctx.moveTo(ax, by + 0.5); ctx.lineTo(ax + 9 * d, by - 4); ctx.lineTo(ax + 9 * d, by + 5); ctx.closePath(); ctx.fill();
    });
    const tText = `T = ${fixed(r.duration_ms, 2)} ms`;
    ctx.font = `600 17px ${font}`;
    const tw = ctx.measureText(tText).width + 24;
    ctx.fillStyle = card; ctx.fillRect((x0 + x1) / 2 - tw / 2, by - 12, tw, 24);
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tText, (x0 + x1) / 2, by + 1);

    // hover inspection
    if (hover >= 0 && r.profile[hover]) {
      const p = r.profile[hover];
      const hx = Math.round(x(p.time_ms)) + 0.5;
      ctx.strokeStyle = ink2; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, m.top - 6); ctx.lineTo(hx, y(0)); ctx.stroke();
      ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = orange; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hx, y(p.acceleration_mm_s2), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // overlays
    place(el.peakHandle, x(tPeak), peakY);
    place(el.peakTag, x(tPeak), peakY);
    place(el.durHandle, x1, y(0));
    place(el.durTag, x1, y(0));
    el.durTag.classList.toggle('flip', x1 + el.durTag.offsetWidth * 0.9 > W - 8);
    place(el.areaLabel, x(tPeak), y(r.peak_acceleration_mm_s2 * 0.4));
    el.areaLabel.style.visibility = (x1 - x0) > 120 && (y(0) - peakY) > 90 ? 'visible' : 'hidden';
  }

  function place(node, px, py) {
    node.style.left = `${px}px`;
    node.style.top = `${py}px`;
  }

  /* ---------- waveform editing: drag, keyboard, inputs stay in sync ---------- */
  const snap = (v, step) => Math.round(v / step) * step;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  function durationBoundsMs() {
    const dtMs = (Number(el.dt.value) || 0) * 1000;
    const lo = Math.max(LIMITS.durMinMs, dtMs);
    const hi = dtMs > 0 ? Math.min(LIMITS.durMaxMs, dtMs * calc.MAX_PROFILE_INTERVALS) : LIMITS.durMaxMs;
    return [lo, Math.max(lo, hi)];
  }

  function setPeakG(g) {
    let hi = LIMITS.peakMax;
    if (frozen) hi = Math.min(hi, Math.floor((scale.yMax * 0.98) / G_MM / 0.5) * 0.5);
    el.peak.value = trimmed(clamp(snap(g, 0.5), LIMITS.peakMin, hi), 4);
    compute();
  }

  function setDurationMs(ms) {
    let [lo, hi] = durationBoundsMs();
    if (frozen) hi = Math.min(hi, Math.floor((scale.xMax * 0.98) / 0.1) * 0.1);
    el.duration.value = fixed(clamp(snap(ms, 0.1), lo, Math.max(lo, hi)), 2);
    compute();
  }

  function bindDrag(handle, onMove) {
    handle.addEventListener('pointerdown', (e) => {
      if (!result || !geom) return;
      e.preventDefault();
      try { handle.setPointerCapture(e.pointerId); } catch (_) { /* capture is optional */ }
      handle.classList.add('dragging');
      frozen = true;
      const move = (ev) => {
        const rect = el.plot.getBoundingClientRect();
        onMove(ev.clientX - rect.left, ev.clientY - rect.top);
      };
      const end = () => {
        handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        frozen = false;
        compute();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  }
  bindDrag(el.peakHandle, (px, py) => setPeakG(geom.yi(py) / G_MM));
  bindDrag(el.durHandle, (px) => setDurationMs(geom.xi(px)));

  el.peakHandle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 5 : 0.5;
    const cur = Number(el.peak.value) || 0;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); setPeakG(cur + step); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); setPeakG(cur - step); }
  });
  el.durHandle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1 : 0.1;
    const cur = Number(el.duration.value) || 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setDurationMs(cur + step); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setDurationMs(cur - step); }
  });

  /* ---------- point inspection ---------- */
  function nearest(ms) {
    const pts = result.profile;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].time_ms < ms) lo = mid; else hi = mid; }
    return Math.abs(pts[lo].time_ms - ms) <= Math.abs(pts[hi].time_ms - ms) ? lo : hi;
  }

  function setHover(i) {
    hover = i;
    const prev = document.querySelector('tbody tr.hover');
    if (prev) prev.classList.remove('hover');
    draw();
    if (i < 0 || !result) { el.readout.classList.remove('show'); return; }
    const p = result.profile[i];
    const fmt = profileTimeFormatter(result);
    el.readout.textContent = `t = ${fmt(p.time_s)} s   a = ${trimmed(p.acceleration_mm_s2, 2)} mm/s²`;
    el.readout.classList.add('show');
    const px = geom.x(p.time_ms), py = geom.y(p.acceleration_mm_s2);
    const flip = px > el.plot.clientWidth - 250;
    el.readout.style.left = `${flip ? px - 14 : px + 14}px`;
    el.readout.style.top = `${Math.max(8, py - 40)}px`;
    el.readout.style.transform = flip ? 'translateX(-100%)' : 'none';
    const row = document.querySelector(`tbody tr[data-i="${i}"]`);
    if (row) row.classList.add('hover');
  }

  el.canvas.addEventListener('mousemove', (e) => {
    if (!result || !geom || frozen) return;
    const ms = geom.xi(e.offsetX);
    if (ms < 0 || ms > result.duration_ms) { if (hover !== -1) setHover(-1); return; }
    const i = nearest(ms);
    if (i !== hover) setHover(i);
  });
  el.canvas.addEventListener('mouseleave', () => { if (hover !== -1) setHover(-1); });
  el.canvas.addEventListener('keydown', (e) => {
    if (!result) return;
    const last = result.profile.length - 1;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight') { e.preventDefault(); setHover(Math.min(last, (hover < 0 ? -1 : hover) + step)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setHover(Math.max(0, (hover < 0 ? last + 1 : hover) - step)); }
    if (e.key === 'Escape') setHover(-1);
  });
  el.canvas.addEventListener('blur', () => { if (hover !== -1) setHover(-1); });

  /* ---------- drawer ---------- */
  const tabs = [...document.querySelectorAll('.drawer-bar [role="tab"]')];
  let lastTab = 'profile';

  function activeTab() {
    return el.drawer.classList.contains('open') ? lastTab : null;
  }

  function openDrawer(name) {
    const open = Boolean(name);
    if (open) lastTab = name;
    el.drawer.classList.toggle('open', open);
    el.toggle.setAttribute('aria-expanded', String(open));
    el.toggle.setAttribute('aria-label', open ? 'Close panel' : 'Open panel');
    tabs.forEach((t) => {
      const on = t.dataset.tab === lastTab;
      t.setAttribute('aria-selected', String(open && on));
      t.tabIndex = on ? 0 : -1;
      $(`#panel-${t.dataset.tab}`).hidden = !(open && on);
    });
    if (open && name === 'profile' && tableDirty) renderTable();
  }

  tabs.forEach((t, idx) => {
    t.addEventListener('click', () => openDrawer(activeTab() === t.dataset.tab ? null : t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      openDrawer(next.dataset.tab);
    });
  });
  el.toggle.addEventListener('click', () => openDrawer(activeTab() ? null : lastTab));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && activeTab()) openDrawer(null); });

  function renderTable() {
    if (!result) return;
    const r = result;
    const formatTime = profileTimeFormatter(r);
    const truncated = r.profile.length > MAX_TABLE_ROWS;
    const points = truncated
      ? [...r.profile.slice(0, MAX_TABLE_ROWS - 1), r.profile[r.profile.length - 1]]
      : r.profile;
    let peakIndex = 0;
    r.profile.forEach((p, i) => { if (p.acceleration_mm_s2 > r.profile[peakIndex].acceleration_mm_s2) peakIndex = i; });
    const fragment = document.createDocumentFragment();
    points.forEach((point, k) => {
      const i = truncated && k === points.length - 1 ? r.profile.length - 1 : k;
      const row = document.createElement('tr');
      row.dataset.i = i;
      if (i === peakIndex) row.className = 'peak';
      const time = document.createElement('td');
      const acceleration = document.createElement('td');
      time.textContent = formatTime(point.time_s);
      acceleration.textContent = trimmed(point.acceleration_mm_s2, 2);
      row.append(time, acceleration);
      fragment.append(row);
    });
    $('#profile-body').replaceChildren(fragment);
    $('#table-foot').textContent = truncated
      ? `Previewing ${MAX_TABLE_ROWS.toLocaleString()} rows · exports include all ${r.profile_points.toLocaleString()}`
      : 'Includes pulse endpoint';
    tableDirty = false;
  }

  /* ---------- export (behaviour carried over from V1) ---------- */
  function announce(message) {
    const s = $('#export-status');
    s.textContent = message;
    window.clearTimeout(announce.timer);
    announce.timer = window.setTimeout(() => { s.textContent = ''; }, 4500);
  }

  function twoColumnRows(r, separator) {
    const formatTime = profileTimeFormatter(r);
    const lines = [`Time(s)${separator}Acceleration(mm/s²)`];
    r.profile.forEach((point) => {
      lines.push(`${formatTime(point.time_s)}${separator}${trimmed(point.acceleration_mm_s2, 2)}`);
    });
    return lines.join('\r\n');
  }

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function flash(button) {
    button.classList.add('done');
    window.setTimeout(() => button.classList.remove('done'), 900);
  }

  $('#copy-table').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const r = compute();
    if (!r) { announce('Correct the highlighted value before copying.'); return; }
    const text = twoColumnRows(r, '\t');
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.append(area); area.select();
      copied = document.execCommand('copy'); area.remove();
    }
    announce(copied ? `Profile table copied (${r.profile_points} rows). Paste directly into Excel.` : 'Clipboard access was blocked.');
    if (copied) flash(button);
  });

  document.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', () => {
    const r = compute();
    if (!r) { announce('Correct the highlighted value before exporting.'); return; }
    if (button.dataset.export === 'csv') {
      download('shock_profile.csv', calc.profileToCsv(r), 'text/csv;charset=utf-8');
      announce('CSV profile downloaded: shock_profile.csv');
    } else {
      download('shock_profile_lsdyna.k', calc.profileToLsdyna(r), 'text/plain;charset=utf-8');
      announce('LS-DYNA curve downloaded: shock_profile_lsdyna.k (seconds, mm/s²)');
    }
    flash(button);
  }));

  /* ---------- wiring ---------- */
  [el.peak, el.duration, el.dt].forEach((f) => f.addEventListener('input', compute));
  document.querySelectorAll('input[name="shape"]').forEach((f) => f.addEventListener('change', compute));
  new ResizeObserver(() => draw()).observe(el.plot);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);

  window.ShockWorkbench = Object.freeze({ calculate: compute, getResult: () => result });
  compute();
})();
