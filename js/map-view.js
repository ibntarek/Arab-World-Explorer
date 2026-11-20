/* =====================================================================
   map-view.js — Interactive SVG map (zoom / pan / hit-testing / labels)
   The geometry comes from js/map-data.js (generated from Arab_world.svg,
   i.e. the real borders – nothing is drawn by hand except the Comoros
   magnifier inset and the soft sea zones).
   ===================================================================== */
'use strict';

class MapView {
  constructor() {
    const M = (this.M = window.ARAB_MAP);
    this.home = { x: M.viewBox[0], y: M.viewBox[1], w: M.viewBox[2], h: M.viewBox[3] };
    this.vb = { ...this.home };
    this.atHome = true;
    this.onTap = null;               // (hit, event) => void
    this.labels = [];
    this.pts = new Map();            // active pointers (pan / pinch)
    this.hoverEl = null;

    const codes = Object.keys(M.shapes);
    const seaIds = Object.keys(M.seas);
    // extend the open oceans past the drawn canvas so wide screens never show a hard edge
    const EXTRA = { atl: ['M-400 -400H-15.6V400H-400Z'], sea: ['M219.4 48H400V89H219.4Z'], indian: ['M219.4 88H400V400H219.4Z', 'M146 149.4H400V400H146Z'] };
    const seaLayer = k => seaIds.map(id => [M.seas[id][k], ...(k === 'core' || k === 'h1' || k === 'h2' ? (EXTRA[id] || []) : [])]
      .map(d => d ? `<path class="sea ${k}" data-s="${id}" d="${d}"/>` : '').join('')).join('');
    const uses = c => M.shapes[c].map(id => `<use href="#${id}" xlink:href="#${id}"/>`).join('');
    const ins = M.inset;

    this.el = document.createElement('div');
    this.el.className = 'map-card';
    this.el.innerHTML = `
      <svg class="map-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
           preserveAspectRatio="xMidYMid meet" role="img" aria-label="خريطة الوطن العربي">
        <rect class="bg" x="-1000" y="-1000" width="2400" height="2400"/>
        <g class="seas">${seaLayer('h2')}${seaLayer('h1')}${seaLayer('core')}</g>
        <rect class="inset-frame" data-c="km" x="${ins.x}" y="${ins.y}" width="${ins.w}" height="${ins.h}" rx="2.5"/>
        <text class="inset-icon" x="${ins.x + ins.w - 3}" y="${ins.y + 4.6}" text-anchor="end">🔍</text>
        <g class="outlines">${codes.map(c => M.shapes[c].map(id => `<use class="ol" href="#${id}" xlink:href="#${id}"/>`).join('')).join('')}</g>
        <g class="fills">${codes.map(c => `<g class="c" data-c="${c}">${uses(c)}</g>`).join('')}</g>
        <g class="hl"></g>
      </svg>
      <img class="rose" src="assets/images/compass_big.png" alt="">
      <svg class="map-lead"></svg>
      <div class="map-labels"></div>
      <div class="map-ctrl" dir="rtl">
        <button type="button" class="zbtn" data-z="in" aria-label="تكبير">+</button>
        <button type="button" class="zbtn" data-z="out" aria-label="تصغير">−</button>
        <button type="button" class="zbtn" data-z="home" aria-label="الخريطة كاملة">⌂</button>
      </div>
      <div class="map-regions" dir="rtl"></div>
      <div class="map-toast" aria-live="polite"></div>`;

    this.svg = this.el.querySelector('.map-svg');
    this.hl = this.el.querySelector('.hl');
    this.lead = this.el.querySelector('.map-lead');
    this.labelBox = this.el.querySelector('.map-labels');
    this.toastEl = this.el.querySelector('.map-toast');
    this.groups = {};
    this.el.querySelectorAll('.fills .c').forEach(g => (this.groups[g.dataset.c] = g));

    // region quick-zoom chips (a zoom aid – they teach the regions too)
    const rb = this.el.querySelector('.map-regions');
    Object.entries(REGIONS).forEach(([k, r]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'rchip'; b.dataset.r = k; b.textContent = k === 'all' ? '🗺️ ' + r.n : '🔍 ' + r.n;
      rb.appendChild(b);
    });
    this.el.addEventListener('click', e => {
      const z = e.target.closest('.zbtn'); const r = e.target.closest('.rchip');
      if (z) { Sound.play('click'); this._zoomBtn(z.dataset.z); }
      if (r) { Sound.play('click'); this.goto(REGIONS[r.dataset.r].box, true); this._regionHL(r.dataset.r); }
    });

    this._bindPointer();
    new ResizeObserver(() => this._onResize()).observe(this.el);
    this._apply();
  }

  /* ---------- mounting & sizing ---------- */
  mount(container) { container.appendChild(this.el); this._onResize(); }
  _size() { const r = this.el.getBoundingClientRect(); return { w: Math.max(1, r.width), h: Math.max(1, r.height) }; }
  _fitHomeW(aspect) { const p = 1.03; return Math.max(this.home.w * p, this.home.h * p * aspect); }
  _onResize() {
    const s = this._size(), aspect = s.w / s.h;
    if (this.atHome) { this._setHome(); }
    else { const cx = this.vb.x + this.vb.w / 2, cy = this.vb.y + this.vb.h / 2; this.vb.h = this.vb.w / aspect; this.vb.x = cx - this.vb.w / 2; this.vb.y = cy - this.vb.h / 2; }
    this._apply();
  }
  _setHome() {
    const s = this._size(), aspect = s.w / s.h, w = this._fitHomeW(aspect);
    this.vb = { w, h: w / aspect, x: this.home.x + this.home.w / 2 - w / 2, y: this.home.y + this.home.h / 2 - (w / aspect) / 2 };
    this.atHome = true;
  }
  _apply() {
    this.svg.setAttribute('viewBox', `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`);
    this._layoutLabels();
    this.el.classList.toggle('zoomed', this.zoomLevel() > 1.4);
  }
  zoomLevel() { const s = this._size(); return this._fitHomeW(s.w / s.h) / this.vb.w; }

  /* ---------- camera ---------- */
  _clamp(v) {
    const s = this._size(), aspect = s.w / s.h, maxW = this._fitHomeW(aspect), minW = maxW / 10;
    v.w = Math.min(maxW, Math.max(minW, v.w)); v.h = v.w / aspect;
    const pad = 12, cx = Math.min(this.home.x + this.home.w + pad, Math.max(this.home.x - pad, v.x + v.w / 2));
    const cy = Math.min(this.home.y + this.home.h + pad, Math.max(this.home.y - pad, v.y + v.h / 2));
    v.x = cx - v.w / 2; v.y = cy - v.h / 2; return v;
  }
  _boxView(box, pad = 0.12) {
    const s = this._size(), aspect = s.w / s.h;
    const [bx, by, bw, bh] = box;
    const w = Math.max(bw * (1 + pad), bh * (1 + pad) * aspect), h = w / aspect;
    return { x: bx + bw / 2 - w / 2, y: by + bh / 2 - h / 2, w, h };
  }
  /** Zoom to a box [x,y,w,h] in map units (null = whole map) */
  goto(box, animate = true) {
    if (!box) {                         // whole map
      const s = this._size(), aspect = s.w / s.h, w = this._fitHomeW(aspect), h = w / aspect;
      this._animTo({ w, h, x: this.home.x + this.home.w / 2 - w / 2, y: this.home.y + this.home.h / 2 - h / 2 }, animate, true);
      return;
    }
    this._animTo(this._clamp(this._boxView(box)), animate, false);
  }
  _animTo(target, animate, toHome) {
    cancelAnimationFrame(this._raf);
    const from = { ...this.vb };
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { this.vb = { ...target }; this.atHome = toHome; this._apply(); return; }
    const t0 = performance.now(), D = 450;
    const step = now => {
      const k = Math.min(1, (now - t0) / D), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.vb = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
      this._apply();
      if (k < 1) this._raf = requestAnimationFrame(step); else { this.atHome = toHome; }
    };
    this._raf = requestAnimationFrame(step);
  }
  _zoomAt(factor, px, py) {
    const r = this.el.getBoundingClientRect(), s = this._size();
    const u = this._pxToUnit(px - r.left, py - r.top);
    const nv = { w: this.vb.w / factor };
    nv.h = nv.w / (s.w / s.h);
    // keep the unit under the pointer fixed
    nv.x = u.x - (u.x - this.vb.x) * (nv.w / this.vb.w);
    nv.y = u.y - (u.y - this.vb.y) * (nv.h / this.vb.h);
    this.vb = this._clamp(nv); this.atHome = this.zoomLevel() < 1.02; this._apply();
  }
  _zoomBtn(kind) {
    if (kind === 'home') { this.goto(null, true); return; }
    const r = this.el.getBoundingClientRect();
    const f = kind === 'in' ? 1.6 : 1 / 1.6; const tv = { w: this.vb.w / f }; const s = this._size();
    tv.h = tv.w / (s.w / s.h); tv.x = this.vb.x + this.vb.w / 2 - tv.w / 2; tv.y = this.vb.y + this.vb.h / 2 - tv.h / 2;
    const c = this._clamp(tv); this._animTo(c, true, this._fitHomeW(s.w / s.h) <= c.w + 0.01);
  }
  _pxToUnit(px, py) {         // px relative to this.el
    const s = this._size(), k = Math.min(s.w / this.vb.w, s.h / this.vb.h);
    const ox = (s.w - this.vb.w * k) / 2, oy = (s.h - this.vb.h * k) / 2;
    return { x: this.vb.x + (px - ox) / k, y: this.vb.y + (py - oy) / k };
  }
  _unitToPx(ux, uy) {
    const s = this._size(), k = Math.min(s.w / this.vb.w, s.h / this.vb.h);
    const ox = (s.w - this.vb.w * k) / 2, oy = (s.h - this.vb.h * k) / 2;
    return { x: ox + (ux - this.vb.x) * k, y: oy + (uy - this.vb.y) * k, k };
  }

  /* ---------- pointer: tap / pan / pinch / wheel ---------- */
  _bindPointer() {
    const svg = this.svg;
    svg.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      svg.setPointerCapture(e.pointerId);
      this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pts.size === 1) { this._down = { x: e.clientX, y: e.clientY }; this._moved = false; }
      else { this._moved = true; this._pinch = this._pinchState(); }
    });
    svg.addEventListener('pointermove', e => {
      const p = this.pts.get(e.pointerId);
      if (!p) { if (e.pointerType === 'mouse') this.hover(this.hitTest(e.clientX, e.clientY, true)); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (this.pts.size === 1) {
        if (!this._moved && Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) > 7) { this._moved = true; this.el.classList.add('panning'); }
        if (this._moved) { this._pan(dx, dy); }
      } else if (this.pts.size === 2) {
        const st = this._pinchState();
        if (this._pinch && st.d > 0) this._zoomAt(st.d / this._pinch.d, st.cx, st.cy);
        if (this._pinch) this._pan(st.cx - this._pinch.cx, st.cy - this._pinch.cy);
        this._pinch = st;
      }
    });
    const end = e => {
      if (!this.pts.has(e.pointerId)) return;
      const wasTap = this.pts.size === 1 && !this._moved && e.type === 'pointerup';
      this.pts.delete(e.pointerId);
      if (this.pts.size === 0) this.el.classList.remove('panning');
      if (this.pts.size < 2) this._pinch = null;
      if (wasTap && this.onTap) this.onTap(this.hitTest(e.clientX, e.clientY), e);
    };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', () => this.hover(null));
    svg.addEventListener('wheel', e => { e.preventDefault(); this._zoomAt(Math.pow(1.0018, -e.deltaY), e.clientX, e.clientY); }, { passive: false });
  }
  _pinchState() {
    const a = [...this.pts.values()]; if (a.length < 2) return null;
    return { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2 };
  }
  _pan(dx, dy) {
    const s = this._size(), k = Math.min(s.w / this.vb.w, s.h / this.vb.h);
    const v = { ...this.vb, x: this.vb.x - dx / k, y: this.vb.y - dy / k };
    this.vb = this._clamp(v); this._apply();
  }

  /* ---------- hit testing ---------- */
  hitTest(x, y, quiet) {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      if (!this.el.contains(el)) continue;
      const c = el.closest && el.closest('[data-c]'); if (c) return { kind: 'country', id: c.dataset.c };
      const s = el.closest && el.closest('[data-s]'); if (s) return { kind: 'sea', id: s.dataset.s };
    }
    const r = this.el.getBoundingClientRect();
    return { kind: 'none', inside: x >= r.left && x <= r.right && y >= r.top && y <= r.bottom };
  }
  pointInside(x, y) { const r = this.el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
  /** forgiving test for tiny countries: pointer within `px` of the country's box */
  nearCountry(x, y, id, px = 16) {
    const g = id === 'km' ? this.el.querySelector('.inset-frame') : this.groups[id];
    if (!g) return false; const r = g.getBoundingClientRect();
    return x >= r.left - px && x <= r.right + px && y >= r.top - px && y <= r.bottom + px;
  }
  hover(hit) {
    if (this.hoverEl) { this.hoverEl.classList.remove('hover'); this.hoverEl = null; }
    if (hit && hit.kind === 'country' && this.groups[hit.id]) { this.hoverEl = this.groups[hit.id]; this.hoverEl.classList.add('hover'); }
  }

  /* ---------- country / sea states ---------- */
  setClass(id, cls, on = true) { const g = this.groups[id]; if (g) g.classList.toggle(cls, on); }
  clearClass(cls) { Object.values(this.groups).forEach(g => g.classList.remove(cls)); }
  /** tint land by wing (african = orange, asian = pink) */
  tintWings(on) {
    Object.entries(this.groups).forEach(([id, g]) => {
      g.classList.remove('wing-af', 'wing-as');
      if (on) g.classList.add('wing-' + COUNTRIES[id].w);
    });
  }
  /** learning scenes only: colour the chosen region so the student learns it */
  _regionHL(k) {
    this.clearClass('region');
    this.el.querySelector('.inset-frame').classList.remove('region');
    this.el.querySelectorAll('.rchip').forEach(b => b.classList.toggle('on', b.dataset.r === k && k !== 'all'));
    if (!this.regionLearn || k === 'all') return;
    const R = REGIONS[k];
    R.ids.forEach(id => { if (id === 'km') this.el.querySelector('.inset-frame').classList.add('region'); this.setClass(id, 'region', true); });
    this.toast('المنطقة الملوّنة: ' + R.n, 'info', 3000);
  }
  dimExcept(ids) { Object.entries(this.groups).forEach(([id, g]) => g.classList.toggle('dim', !!ids && !ids.includes(id))); }
  reset() {
    this.clearSelect(); this.clearLabels(); this.clearRings(); this.hover(null);
    this.tintWings(false); this.dimExcept(null); this._regionHL('all');
    ['solved', 'pulse', 'wrongflash', 'hover'].forEach(c => this.clearClass(c));
    this.toastEl.className = 'map-toast';
    this.onTap = null;
  }

  _useFor(id, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    return this.M.shapes[id].map(sid => { const u = document.createElementNS(ns, 'use'); u.setAttribute('href', '#' + sid); u.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + sid); u.setAttribute('class', cls); return u; });
  }
  _pathFor(seaId, cls) {
    const ns = 'http://www.w3.org/2000/svg'; const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', this.M.seas[seaId].core); p.setAttribute('class', cls); return p;
  }
  /** highlight one country or sea (bright yellow, pulsing) */
  select(kind, id, cls = 'hl-sel') {
    this.clearSelect();
    if (kind === 'country') this._useFor(id, cls).forEach(u => this.hl.appendChild(u));
    else if (kind === 'sea') this.hl.appendChild(this._pathFor(id, cls + ' hl-sea'));
  }
  clearSelect() { this.hl.querySelectorAll('.hl-sel,.hl-ok').forEach(n => n.remove()); }
  /** brief flash: green = correct, red-ish = wrong */
  flash(kind, id, good = true, ms = 1100) {
    const cls = good ? 'hl-ok' : 'hl-bad', nodes = [];
    if (kind === 'country') nodes.push(...this._useFor(id, cls)); else nodes.push(this._pathFor(id, cls + ' hl-sea'));
    nodes.forEach(n => this.hl.appendChild(n)); setTimeout(() => nodes.forEach(n => n.remove()), ms);
  }
  pulse(kind, id, ms = 2600) {
    const nodes = [];
    if (kind === 'country') nodes.push(...this._useFor(id, 'hl-hint')); else nodes.push(this._pathFor(id, 'hl-hint hl-sea'));
    nodes.forEach(n => this.hl.appendChild(n)); setTimeout(() => nodes.forEach(n => n.remove()), ms);
  }
  pulseWing(wing, ms = 2600) { Object.entries(COUNTRIES).forEach(([id, c]) => { if (c.w === wing) this.pulse('country', id, ms); }); }
  /** soft circle that narrows down the answer ("look inside the circle") */
  ring(kind, id, scale = 3, ms = 4200) {
    const ns = 'http://www.w3.org/2000/svg'; const M = this.M;
    const a = kind === 'country' ? M.info[id].anchor : M.seas[id].anchor;
    const r = Math.max(kind === 'country' ? M.info[id].r : M.seas[id].r, 3) * scale + 3;
    const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', a[0]); c.setAttribute('cy', a[1]); c.setAttribute('r', r); c.setAttribute('class', 'hl-ring');
    this.hl.appendChild(c); setTimeout(() => c.remove(), ms);
  }
  clearRings() { this.hl.querySelectorAll('.hl-ring,.hl-hint,.hl-bad').forEach(n => n.remove()); }
  /** zoom so the target is comfortably visible (used for tiny countries) */
  focusOn(kind, id, widen = 26) {
    const M = this.M; const a = kind === 'country' ? M.info[id].anchor : M.seas[id].anchor;
    this.goto([a[0] - widen / 2, a[1] - widen / 2, widen, widen], true);
  }

  /* ---------- labels ---------- */
  /** kind: 'country' | 'sea'. Adds a pill with flag + name that stays at the right place */
  addLabel(kind, id, opts = {}) {
    this.removeLabel(kind, id);
    const M = this.M; let ux, uy, dx = 0, dy = 0, text, flag;
    if (kind === 'country') { const c = COUNTRIES[id]; [ux, uy] = M.info[id].anchor; if (c.lab) { dx = c.lab[0]; dy = c.lab[1]; } text = c.n; flag = id; if (id === 'km') { ux = 154; uy = 148.2; dx = 0; dy = 0; } }
    else { const s = SEAS[id]; [ux, uy] = s.lab; text = s.n; }
    const el = document.createElement('div'); el.className = 'map-label ' + kind + (opts.cls ? ' ' + opts.cls : '');
    el.innerHTML = (flag ? `<img src="assets/flags/${flag}.svg" alt="">` : '<i class="wave">≈</i>') + `<span>${text}</span>`;
    this.labelBox.appendChild(el);
    let line = null;
    if (dx || dy) { line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); line.setAttribute('class', 'lead-line'); this.lead.appendChild(line); }
    this.labels.push({ kind, id, el, line, ux, uy, dx, dy }); this._layoutLabels();
    return el;
  }
  removeLabel(kind, id) {
    this.labels = this.labels.filter(l => { if (l.kind === kind && l.id === id) { l.el.remove(); l.line && l.line.remove(); return false; } return true; });
  }
  clearLabels() { this.labels.forEach(l => { l.el.remove(); l.line && l.line.remove(); }); this.labels = []; }
  hasLabel(kind, id) { return this.labels.some(l => l.kind === kind && l.id === id); }
  _layoutLabels() {
    if (!this.labels || !this.labels.length) return;
    const s = this._size();
    for (const l of this.labels) {
      const a = this._unitToPx(l.ux, l.uy), p = this._unitToPx(l.ux + l.dx, l.uy + l.dy);
      const out = p.x < -40 || p.y < -20 || p.x > s.w + 40 || p.y > s.h + 20;
      l.el.style.display = out ? 'none' : '';
      l.el.style.left = p.x + 'px'; l.el.style.top = p.y + 'px';
      if (l.line) { l.line.setAttribute('x1', a.x); l.line.setAttribute('y1', a.y); l.line.setAttribute('x2', p.x); l.line.setAttribute('y2', p.y); l.line.style.display = out ? 'none' : ''; }
    }
  }

  /* ---------- toast ---------- */
  toast(msg, type = 'info', ms = 2400) {
    const t = this.toastEl; t.textContent = msg; t.className = 'map-toast show ' + type;
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), ms);
  }
}
