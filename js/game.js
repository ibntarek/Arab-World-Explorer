/* =====================================================================
   game.js — Game logic: navigation, scenes 1-4 (Part 1), notebook, score.
   Depends on: data.js, audio.js, map-data.js, map-view.js
   Scenes 1-6 are all built.
   ===================================================================== */
'use strict';

(() => {
  /* ---------------------------------------------------------------
     0. Helpers
     --------------------------------------------------------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const IMG = n => `assets/images/${n}.png`;
  const FLAG = id => `assets/flags/${id}.svg`;
  const POSE = { idle: 'boy_cross', happy: 'boy_jump', board: 'boy_board', ok: 'boy_thumbs', oops: 'boy_confused', look: 'boy_binoc' };
  const IDS = Object.keys(COUNTRIES);
  const SMALL = new Set(IDS.filter(i => COUNTRIES[i].size === 'S'));
  const nm = id => COUNTRIES[id].n;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.add(t); return t; };
  const timers = new Set();
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };

  /** Neighbouring Arab countries (used to say "very close!" when a drop lands next door) */
  const NEIGH = {
    eg: ['ly', 'sd', 'ps'], ly: ['tn', 'dz', 'eg', 'sd'], tn: ['dz', 'ly'], dz: ['ma', 'tn', 'ly', 'mr'], ma: ['dz', 'mr'], mr: ['ma', 'dz'],
    sd: ['eg', 'ly'], so: ['dj'], dj: ['so'], km: [], sa: ['jo', 'iq', 'kw', 'qa', 'ae', 'om', 'ye', 'bh'], ye: ['sa', 'om'], om: ['ye', 'sa', 'ae'],
    ae: ['sa', 'om', 'qa'], qa: ['sa', 'bh', 'ae'], bh: ['qa', 'sa'], kw: ['iq', 'sa'], iq: ['kw', 'sa', 'jo', 'sy'], sy: ['lb', 'jo', 'iq', 'ps'],
    jo: ['sy', 'iq', 'sa', 'ps'], lb: ['sy', 'ps'], ps: ['jo', 'eg', 'lb']
  };
  /** Which zoom region to open automatically when a tiny country is dragged */
  const REGION_OF = { kw: 'gulf', qa: 'gulf', bh: 'gulf', ae: 'gulf', lb: 'levant', ps: 'levant', jo: 'levant', dj: 'horn', km: 'comoros' };

  /* ---------------------------------------------------------------
     1. Saved progress (localStorage – optional, never required)
     --------------------------------------------------------------- */
  const Store = {
    d: { maxScene: 1, score: 0, seen: {}, stats: {}, wings: { af: false, as: false }, stars: {}, badges: {} },
    load() { try { const s = JSON.parse(localStorage.getItem('awe.progress') || 'null'); if (s) Object.assign(this.d, s); } catch (e) { /* ignore */ } },
    save() { try { localStorage.setItem('awe.progress', JSON.stringify(this.d)); } catch (e) { /* ignore */ } },
    reset() { this.d = { maxScene: 1, score: 0, seen: {}, stats: {}, wings: { af: false, as: false }, stars: {}, badges: {} }; this.save(); },
    st(id) { return this.d.stats[id] || (this.d.stats[id] = { ok: 0, bad: 0, first: 0 }); }
  };
  Store.load();

  /* ---------------------------------------------------------------
     2. Shared pieces: map, guide bubble, confetti, score
     --------------------------------------------------------------- */
  $('#mapdefs').innerHTML = ARAB_MAP.defs;
  const map = new MapView();
  let cur = 0;

  function renderScore() { $('#score').textContent = ar(Store.d.score); }
  function addScore(n) { Store.d.score += n; Store.save(); renderScore(); const p = $('.pill'); p.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 350 }); }

  /** explorer + speech bubble. `pre` = id prefix of the guide in the current panel */
  function say(pre, pose, text, kind = '') {
    const img = $('#' + pre + 'img'), tx = $('#' + pre + 'txt'); if (!img || !tx) return;
    img.src = IMG(POSE[pose]); img.classList.remove('bounce'); void img.offsetWidth; img.classList.add('bounce');
    tx.className = 'bubble ' + kind; tx.textContent = text;
  }
  const guideHTML = (pre, pose, text) => `<div class="guide"><img id="${pre}img" src="${IMG(POSE[pose])}" alt=""><div class="bubble" id="${pre}txt">${text}</div></div>`;

  function confetti(n = 46) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = document.createElement('div'); box.className = 'confetti';
    const cols = ['#FF8A1F', '#FFC83D', '#2FB36B', '#4FB0F0', '#EC7FA8', '#fff'];
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%'; p.style.background = pick(cols);
      p.style.animationDuration = 1.6 + Math.random() * 1.6 + 's'; p.style.animationDelay = Math.random() * .5 + 's';
      p.style.transform = `rotate(${Math.random() * 360}deg)`; box.appendChild(p);
    }
    document.body.appendChild(box); setTimeout(() => box.remove(), 4200);
  }

  const navRow = (n, nextLabel, nextCls = 'green') => `
    <div class="row nav-row">
      <button class="btn light" data-nav="${n - 1}" type="button">▶ السابق</button>
      <button class="btn ${nextCls} grow" id="next${n}" data-nav="${n + 1}" type="button">${nextLabel} ◀</button>
    </div>`;
  function bindNav(root) {
    $$('[data-nav]', root).forEach(b => b.addEventListener('click', () => { Sound.play('click'); go(+b.dataset.nav); }));
  }
  const unlock = n => { if (Store.d.maxScene < n) { Store.d.maxScene = n; Store.save(); renderStepper(); } };

  function mountMap(n) {
    map.reset(); map.regionLearn = (n === 2 || n === 3); map.mount($('#slot' + n)); map.goto(null, false);
  }

  /* ---------------------------------------------------------------
     3. Navigation
     --------------------------------------------------------------- */
  const TITLES = ['الترحيب', 'اكتشف الوطن العربي', 'استكشف الدول', 'السحب والإفلات', 'المسطحات المائية', 'التحدي الأخير'];
  const Scenes = {};

  function renderStepper() {
    $('#stepper').innerHTML = TITLES.map((t, i) => {
      const n = i + 1, cls = ['step', n === cur ? 'active' : '', n < Store.d.maxScene ? 'done' : ''].join(' ');
      return `<button class="${cls}" data-n="${n}" type="button" ${n > Store.d.maxScene ? 'disabled' : ''} aria-label="المشهد ${n}: ${t}"><b>${n < Store.d.maxScene && n !== cur ? '✓' : ar(n)}</b><span>${t}</span></button>`;
    }).join('');
  }
  $('#stepper').addEventListener('click', e => { const b = e.target.closest('.step'); if (b && !b.disabled) { Sound.play('click'); go(+b.dataset.n); } });

  function go(n, silent) {
    n = Math.max(1, Math.min(6, n));
    if (n > Store.d.maxScene) return;
    if (n === cur) return;
    if (cur && Scenes[cur] && Scenes[cur].leave) Scenes[cur].leave();
    clearTimers(); document.querySelectorAll('.chip.ghost').forEach(g => g.remove());
    $$('.scene').forEach(s => s.classList.toggle('active', s.id === 'scene' + n));
    cur = n; renderStepper();
    $('#btnRestart').style.visibility = n === 1 ? 'hidden' : 'visible';
    if (!silent) Sound.play('whoosh');
    Scenes[n].enter();
  }

  /* ---------------------------------------------------------------
     SCENE 1 — Welcome
     --------------------------------------------------------------- */
  Scenes[1] = {
    built: false,
    enter() {
      if (!this.built) {
        this.built = true;
        const flags = ['eg', 'sa', 'ma', 'ae', 'iq', 'sd', 'dz', 'om', 'ly', 'jo', 'qa', 'ye', 'tn', 'kw'];
        const n = flags.length;
        $('#bunting').innerHTML = `<svg class="string" viewBox="0 0 100 20" preserveAspectRatio="none"><path d="M0 2 Q50 22 100 2" fill="none" stroke="#b5894a" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>` +
          flags.map((f, i) => { const t = (i + .5) / n, y = 2 + 40 * t * (1 - t); return `<img src="${FLAG(f)}" alt="" style="left:calc(${t * 100}% - 1.25rem);top:calc(${y / 20 * 5.2}rem - .2rem);animation-delay:${(i % 5) * -.5}s">`; }).join('');
        $('#btnStart').addEventListener('click', () => { Sound.play('welcome'); unlock(2); go(2, true); });
        $('#btnContinue').addEventListener('click', () => { Sound.play('click'); go(Math.min(Store.d.maxScene, 4)); });
      }
      $('#btnContinue').hidden = Store.d.maxScene < 2;
      map.reset();
    }
  };

  /* ---------------------------------------------------------------
     SCENE 2 — Discover the Arab World (two wings + location tour)
     --------------------------------------------------------------- */
  const S2 = { tour: -1, wing: null };
  Scenes[2] = {
    enter() {
      mountMap(2); S2.tour = -1; S2.wing = null; map.tintWings(true);
      $('#panel2').innerHTML = `
        ${guideHTML('g2', 'look', 'اضغط على أي دولة ملوّنة في الخريطة لتكتشف الجناح الذي تنتمي إليه.')}
        <div class="card">
          <h3>🧭 جناحا الوطن العربي</h3>
          <button class="wing-btn af" data-w="af" type="button"><i></i>الجناح الإفريقي<small></small></button>
          <div style="height:.4rem"></div>
          <button class="wing-btn as" data-w="as" type="button"><i></i>الجناح الآسيوي<small></small></button>
        </div>
        <div class="card" id="s2info" hidden></div>
        <div class="card">
          <h3>🗺️ جولة الموقع</h3>
          <p id="tourTxt">اتبع الجولة لتعرف أين يقع الوطن العربي على الخريطة.</p>
          <div class="dots" id="tourDots">${TOUR.map(() => '<i></i>').join('')}</div>
          <div class="row" style="margin-top:.5rem"><button class="btn light" id="tourPrev" type="button" disabled>▶</button><button class="btn blue grow" id="tourNext" type="button">ابدأ الجولة ◀</button></div>
        </div>
        ${navRow(2, 'التالي: استكشف الدول')}`;
      bindNav($('#panel2'));
      $$('.wing-btn', $('#panel2')).forEach(b => b.addEventListener('click', () => this.wing(b.dataset.w)));
      $('#tourNext').addEventListener('click', () => this.tourStep(1));
      $('#tourPrev').addEventListener('click', () => this.tourStep(-1));
      map.onTap = hit => {
        if (hit.kind === 'country') this.wing(COUNTRIES[hit.id].w);
        else if (hit.kind === 'sea') map.toast('هذا مسطح مائي. اضغط على دولة ملوّنة لتعرف جناحها.', 'info');
      };
      this.refresh();
    },
    refresh() {
      ['af', 'as'].forEach(w => { $(`.wing-btn.${w} small`, $('#panel2')).textContent = Store.d.wings[w] ? '✓ تم اكتشافه' : ''; });
      const ready = Store.d.maxScene >= 3;
      $('#next2').disabled = !ready; $('#next2').classList.toggle('glow', ready);
    },
    wing(w) {
      const W = WINGS[w], ids = IDS.filter(i => COUNTRIES[i].w === w), first = !Store.d.wings[w];
      S2.wing = w; map.dimExcept(ids); map.pulseWing(w, 2200); Sound.play('select');
      $$('.wing-btn', $('#panel2')).forEach(b => b.classList.toggle('on', b.dataset.w === w));
      const extra = w === 'af' ? ' ملحوظة: تُحسب مصر في الجناح الإفريقي رغم أن شبه جزيرة سيناء تقع في آسيا.' : ' تفصل بينه وبين الجناح الإفريقي مياه البحر الأحمر.';
      const info = $('#s2info'); info.hidden = false;
      info.innerHTML = `<h3><span class="badge ${w}">${W.name}</span> يضم ${ar(ids.length)} دول</h3><p>${W.text}${extra}</p>
        <div class="flag-list">${ids.map(i => `<button class="flag-chip" data-id="${i}" type="button"><img src="${FLAG(i)}" alt="">${nm(i)}</button>`).join('')}</div>`;
      $$('.flag-chip', info).forEach(b => b.addEventListener('click', () => { Sound.play('select'); map.pulse('country', b.dataset.id, 1800); }));
      say('g2', 'ok', `أحسنت! هذا هو ${W.name}، ويقع في قارة ${W.continent}.`, 'ok');
      if (first) {
        Store.d.wings[w] = true; Store.save();
        if (Store.d.wings.af && Store.d.wings.as) {
          later(() => { Sound.play('complete'); confetti(); say('g2', 'happy', 'رائع! اكتشفت الجناحين. هيا نتعرف على دول الوطن العربي في المشهد التالي.', 'ok'); unlock(3); Scenes[2].refresh(); }, 700);
        }
      }
      this.refresh();
    },
    tourStep(d) {
      S2.tour = Math.max(-1, Math.min(TOUR.length, S2.tour + d));
      map.dimExcept(null); $$('.wing-btn', $('#panel2')).forEach(b => b.classList.remove('on'));
      if (S2.tour >= TOUR.length || S2.tour < 0) {
        S2.tour = -1; map.goto(null, true); $('#tourTxt').textContent = 'انتهت الجولة! الوطن العربي يقع في قارتي إفريقيا وآسيا.'; say('g2', 'happy', 'أحسنت! عرفت أين يقع الوطن العربي.', 'ok');
        $('#tourNext').textContent = 'أعد الجولة ◀'; $('#tourPrev').disabled = true; Sound.play('complete');
      } else {
        const t = TOUR[S2.tour]; map.goto(t.box, true); $('#tourTxt').textContent = t.text; Sound.play('select');
        $('#tourNext').textContent = S2.tour === TOUR.length - 1 ? 'إنهاء الجولة ◀' : 'التالي ◀'; $('#tourPrev').disabled = false;
      }
      $$('#tourDots i').forEach((d2, i) => d2.className = i < S2.tour ? 'ok' : i === S2.tour ? 'cur' : '');
    },
    restart() { Store.d.wings = { af: false, as: false }; Store.save(); this.enter(); Sound.play('click'); },
    leave() { map.dimExcept(null); }
  };

  /* ---------------------------------------------------------------
     SCENE 3 — Explore the Arab countries (free exploration)
     --------------------------------------------------------------- */
  const S3 = { sel: null };
  function seenCount() { return IDS.filter(i => Store.d.seen[i]).length; }
  Scenes[3] = {
    enter() {
      mountMap(3); S3.sel = null; map.tintWings(false);
      $('#panel3').innerHTML = `
        ${guideHTML('g3', 'idle', 'اضغط على أي دولة في الخريطة لتعرف اسمها وعلمها. اكتشف ٥ دول على الأقل لتفتح التحدي التالي!')}
        <div class="card" id="s3info"><h3>🔎 لم تختر دولة بعد</h3><p>اختر دولة من الخريطة وستظهر هنا معلوماتها.</p></div>
        <div class="card">
          <h3>🏅 ألبوم الأعلام: <span id="s3count"></span></h3>
          <div class="meter"><i id="s3meter"></i></div>
          <div class="flag-list" id="s3album"></div>
        </div>
        ${navRow(3, 'التالي: السحب والإفلات')}`;
      bindNav($('#panel3')); this.gate();
      map.onTap = (hit, e) => {
        const id = this.resolve(hit, e);
        if (id) this.select(id); else if (hit.kind === 'sea') map.toast('هذا مسطح مائي. اضغط على دولة لتتعرف عليها.', 'info');
      };
      this.album();
    },
    /** tiny countries are hard to touch: accept a tap that lands very close to them */
    resolve(hit, e) {
      if (hit.kind === 'country') return hit.id;
      let best = null, bd = 1e9;
      SMALL.forEach(id => {
        if (!map.nearCountry(e.clientX, e.clientY, id, 12)) return;
        const g = id === 'km' ? map.el.querySelector('.inset-frame') : map.groups[id], r = g.getBoundingClientRect();
        const d = Math.hypot(e.clientX - (r.left + r.right) / 2, e.clientY - (r.top + r.bottom) / 2); if (d < bd) { bd = d; best = id; }
      });
      return best;
    },
    select(id, focus) {
      const c = COUNTRIES[id], W = WINGS[c.w], firstTime = !Store.d.seen[id];
      if (S3.sel) map.removeLabel('country', S3.sel);
      S3.sel = id; map.select('country', id); map.addLabel('country', id);
      if (focus || (SMALL.has(id) && map.zoomLevel() < 1.3)) map.focusOn('country', id, id === 'km' ? 62 : 30);
      Sound.play('select');
      $('#s3info').innerHTML = `
        <div class="info-top"><img class="flag" src="${FLAG(id)}" alt="علم ${c.n}"><div><div class="nm">${c.n}</div><span class="badge ${c.w}">${W.name}</span></div></div>
        <div class="fact"><b>📍</b><p>${c.dir}.</p></div>
        <div class="fact"><b>💡</b><p>${c.fact}</p></div>`;
      say('g3', 'ok', `هذه ${c.n}! ${firstTime ? 'أضفت علمها إلى الألبوم.' : 'استمر في الاستكشاف.'}`, 'ok');
      if (firstTime) { Store.d.seen[id] = true; Store.save(); this.album(); this.badges(); }
    },
    album() {
      const n = seenCount();
      $('#s3count').textContent = `${ar(n)} من ${ar(IDS.length)}`; $('#s3meter').style.width = (n / IDS.length * 100) + '%';
      $('#s3album').innerHTML = IDS.map(i => Store.d.seen[i]
        ? `<button class="flag-chip seen" data-id="${i}" type="button"><img src="${FLAG(i)}" alt="">${nm(i)}</button>`
        : `<span class="flag-chip" title="لم تكتشفها بعد">؟</span>`).join('');
      $$('#s3album .flag-chip.seen').forEach(b => b.addEventListener('click', () => this.select(b.dataset.id, true)));
    },
    gate() { const ok = Store.d.maxScene >= 4; $('#next3').disabled = !ok; $('#next3').classList.toggle('glow', ok); },
    badges() {
      const n = seenCount();
      if (n >= 5 && !Store.d.badges.explorer) { Store.d.badges.explorer = true; Store.save(); Sound.play('complete'); map.toast('🧭 حصلت على شارة «المستكشف النشيط» — تعرّفت على ٥ دول!', 'ok', 3600); }
      if (n === IDS.length && !Store.d.badges.expert) { Store.d.badges.expert = true; Store.save(); confetti(); Sound.play('win'); map.toast('🏅 رائع! اكتشفت كل الدول العربية الاثنتين والعشرين!', 'ok', 4200); }
      if (n >= 5) { unlock(4); this.gate(); }
    },
    restart() { S3.sel = null; map.reset(); map.goto(null, true); map.onTap = null; this.enter(); Sound.play('click'); },
    leave() { map.clearLabels(); }
  };

  /* ---------------------------------------------------------------
     SCENE 4 — Drag & drop the names onto the map
     --------------------------------------------------------------- */
  const S4 = { mode: 'round', ri: 0, ids: [], left: [], solved: new Set(), recs: {}, roundScore: 0, armed: null, drag: null, zoomed: false, done: false };

  Scenes[4] = {
    enter() { this.start(S4.done ? 0 : Math.min(S4.ri, 2), null); },

    /** start one round (or a "review mistakes" round when `review` is a list of ids) */
    start(ri, review) {
      mountMap(4);
      S4.mode = review ? 'review' : 'round'; S4.ri = ri; S4.done = false;
      const R = ROUNDS[ri];
      S4.ids = review ? review.slice() : R.ids.slice();
      S4.left = shuffle(S4.ids.slice()); S4.solved = new Set(); S4.recs = {}; S4.roundScore = 0; S4.armed = null; S4.zoomed = false;
      if (!review) for (let j = 0; j < ri; j++) ROUNDS[j].ids.forEach(id => this.markSolved(id));     // earlier rounds stay as clues
      map.tintWings(!review && R.tint);
      map.onTap = null;
      const title = review ? 'مراجعة أخطائك' : R.name, tip = review ? 'سنتدرب معاً على الدول التي احتجت فيها إلى مساعدة.' : R.tip;
      $('#panel4').innerHTML = `
        ${guideHTML('g4', 'board', 'اسحب اسم كل دولة وضعه فوق مكانها الصحيح على الخريطة.')}
        <div class="card"><h3>🎯 ${title}</h3><p>${tip}</p>
          <div class="row"><div class="meter grow"><i id="s4meter"></i></div><b id="s4count"></b></div></div>
        <div class="card" id="s4zone">
          <div class="hintbar hintbar-top">
            <button class="btn blue" id="s4hint" type="button">💡 تلميح</button>
            <button class="btn light" id="s4again" type="button">🔄 أعد الجولة</button>
          </div>
          <div class="tray" id="s4tray"></div>
        </div>
        ${navRow(4, 'التالي: المسطحات المائية')}`;
      bindNav($('#panel4'));
      $('#next4').disabled = !(Store.d.maxScene >= 5);
      $('#s4tray').innerHTML = S4.left.map(id => `<button class="chip" data-id="${id}" type="button">${nm(id)}</button>`).join('');
      $$('.chip', $('#s4tray')).forEach(c => this.bindChip(c));
      $('#s4hint').addEventListener('click', () => this.hint(true));
      $('#s4again').addEventListener('click', () => { Sound.play('click'); this.restart(); });
      this.progress();
    },

    markSolved(id) { map.setClass(id, 'solved', true); map.addLabel('country', id, { cls: SMALL.has(id) ? 'small' : '' }); S4.solved.add(id); },
    progress() {
      const n = S4.ids.filter(i => S4.solved.has(i)).length;
      $('#s4meter').style.width = (n / S4.ids.length * 100) + '%'; $('#s4count').textContent = `${ar(n)} / ${ar(S4.ids.length)}`;
    },
    rec(id) { return S4.recs[id] || (S4.recs[id] = { wrong: 0, hints: 0, lvl: 0 }); },

    /* ---------- dragging (pointer events: mouse + touch + pen) ---------- */
    bindChip(chip) {
      chip.addEventListener('contextmenu', e => e.preventDefault());
      chip.addEventListener('pointerdown', e => {
        if (S4.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault(); chip.setPointerCapture(e.pointerId);
        S4.drag = { chip, id: chip.dataset.id, pid: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ghost: null };
        Sound.play('pick');
      });
      chip.addEventListener('pointermove', e => {
        const d = S4.drag; if (!d || e.pointerId !== d.pid) return;
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) { d.moved = true; this.beginDrag(d); }
        if (d.moved) { d.ghost.style.left = e.clientX + 'px'; d.ghost.style.top = e.clientY + 'px'; map.hover(map.pointInside(e.clientX, e.clientY) ? map.hitTest(e.clientX, e.clientY) : null); }
      });
      const finish = (e, cancelled) => {
        const d = S4.drag; if (!d || e.pointerId !== d.pid) return;
        S4.drag = null; map.hover(null);
        if (d.ghost) d.ghost.remove(); chip.classList.remove('dragging');
        if (!d.moved) { if (!cancelled) this.arm(chip); return; }           // a simple tap = "select this name"
        if (cancelled) return this.backToTray(chip, true);
        this.drop(chip, d.id, e.clientX, e.clientY);
      };
      chip.addEventListener('pointerup', e => finish(e, false));
      chip.addEventListener('pointercancel', e => finish(e, true));
    },
    beginDrag(d) {
      const g = d.chip.cloneNode(true); g.classList.add('ghost'); g.style.left = d.x0 + 'px'; g.style.top = d.y0 + 'px'; document.body.appendChild(g);
      d.ghost = g; d.chip.classList.add('dragging'); this.arm(d.chip, true);
      // tiny countries: open the matching magnifier automatically so the drop can be precise
      if (SMALL.has(d.id) && REGION_OF[d.id] && !S4.zoomed) { S4.zoomed = true; map.goto(REGIONS[REGION_OF[d.id]].box, true); }
    },
    arm(chip, silent) {
      $$('.chip', $('#s4tray')).forEach(c => c.classList.toggle('armed', c === chip));
      S4.armed = chip.dataset.id;
      if (!silent) { Sound.play('select'); say('g4', 'board', `اسحب «${nm(S4.armed)}» إلى مكانها الصحيح على الخريطة.`); }
    },
    backToTray(chip, silent) { chip.classList.remove('dragging'); chip.classList.add('back'); later(() => chip.classList.remove('back'), 500); this.unzoom(); },
    unzoom() { if (S4.zoomed) { S4.zoomed = false; later(() => { if (!S4.drag) map.goto(null, true); }, 1100); } },

    /* ---------- evaluating a drop ---------- */
    drop(chip, id, x, y) {
      if (!map.pointInside(x, y)) {                      // dropped outside the map: no attempt counted
        this.backToTray(chip); say('g4', 'board', 'اسحب الاسم وضعه فوق الخريطة نفسها.'); Sound.play('drop'); return;
      }
      const hit = map.hitTest(x, y), hitId = hit.kind === 'country' ? hit.id : null;
      let ok = hitId === id;
      // small countries: forgive a drop that lands right beside them (but not on another small country)
      if (!ok && SMALL.has(id) && map.nearCountry(x, y, id, 14) && !(hitId && SMALL.has(hitId))) ok = true;
      ok ? this.correct(chip, id) : this.wrong(chip, id, hit, hitId);
    },
    correct(chip, id) {
      const r = this.rec(id), st = Store.st(id);
      const pts = Math.max(2, 10 - 3 * r.wrong - 2 * r.hints);
      st.ok++; if (!r.wrong && !r.hints) st.first++;
      S4.roundScore += pts; addScore(pts); Store.save();
      S4.left = S4.left.filter(i => i !== id); S4.armed = null;
      chip.remove(); map.flash('country', id, true); this.markSolved(id);
      Sound.play('correct'); this.progress(); this.unzoom();
      say('g4', 'ok', `${pick(MSG_OK)} ${nm(id)}: ${COUNTRIES[id].fact}`, 'ok');
      map.toast(`+${ar(pts)} ⭐ ${nm(id)}`, 'ok', 1500);
      if (!S4.left.length) later(() => this.finish(), 900);
    },
    wrong(chip, id, hit, hitId) {
      const r = this.rec(id); r.wrong++; Store.st(id).bad++; Store.save();
      let msg = MSG_RETRY;
      if (hitId) {
        map.flash('country', hitId, false, 900);
        msg = NEIGH[id].includes(hitId) ? `قريب جداً! هذه ${nm(hitId)}، وهي جارة ${nm(id)}. ${MSG_RETRY}` : `هذه ${nm(hitId)} وليست ${nm(id)}. ${MSG_RETRY}`;
      } else if (hit.kind === 'sea') msg = `هذا مسطح مائي وليس دولة. ${MSG_RETRY}`;
      Sound.play('wrong'); this.backToTray(chip);
      say('g4', 'oops', msg, 'bad'); map.toast('حاول مرة أخرى 💪', 'bad', 1400);
      if (r.wrong >= 2) later(() => { r.lvl = Math.max(r.lvl, Math.min(3, r.wrong - 1) - 1); this.hint(false, id); }, 1500);   // supportive hint after repeated mistakes
    },

    /* ---------- hints: wing → clue → circle (never the answer itself) ---------- */
    hint(manual, forId) {
      const id = forId || S4.armed || S4.left[0]; if (!id || !S4.left.includes(id)) return;
      const r = this.rec(id), c = COUNTRIES[id];
      if (manual) r.hints++;
      r.lvl = Math.min(3, r.lvl + 1); Sound.play('hint');
      const chip = $(`.chip[data-id="${id}"]`, $('#s4tray')); if (chip) this.arm(chip, true);
      if (r.lvl === 1) { map.pulseWing(c.w, 2600); say('g4', 'look', `تلميح عن «${c.n}»: هي في ${WINGS[c.w].name}. انظر إلى الدول الملوّنة النابضة.`, 'hint'); }
      else if (r.lvl === 2) { say('g4', 'look', `تلميح عن «${c.n}»: ${c.dir}.`, 'hint'); }
      else { map.ring('country', id, SMALL.has(id) ? 1 : 1.4, 5200); say('g4', 'look', `ابحث عن «${c.n}» داخل الدائرة المتقطعة على الخريطة.`, 'hint'); }
    },

    /* ---------- round finished ---------- */
    finish() {
      const wrongs = Object.values(S4.recs).reduce((a, r) => a + r.wrong, 0), stars = wrongs <= 1 ? 3 : wrongs <= 4 ? 2 : 1;
      const weak = S4.ids.filter(id => (S4.recs[id] || {}).wrong > 0);
      const last = S4.mode === 'round' && S4.ri === ROUNDS.length - 1;
      if (S4.mode === 'round') { Store.d.stars[S4.ri] = Math.max(Store.d.stars[S4.ri] || 0, stars); }
      if (last) { S4.done = true; unlock(5); }
      Store.save(); Sound.play(last ? 'win' : 'complete'); confetti(last ? 90 : 55);
      say('g4', 'happy', last ? 'مذهل! وضعت أسماء كل الدول العربية في أماكنها الصحيحة!' : 'أحسنت! أكملت الجولة.', 'ok');
      const starsHTML = [1, 2, 3].map(i => `<span class="${i <= stars ? 'on' : 'off'}">★</span>`).join('');
      const hasNext = S4.mode === 'round' && S4.ri < ROUNDS.length - 1;
      $('#s4zone').innerHTML = `
        <div style="text-align:center"><div class="stars">${starsHTML}</div>
          <p class="res-msg">${stars === 3 ? 'ممتاز جداً!' : stars === 2 ? 'عمل جميل!' : 'أحسنت! التدريب يصنع الماهر.'}</p>
          <p>نقاط هذه الجولة: <b>${ar(S4.roundScore)}</b> ⭐ — أخطاء: <b>${ar(wrongs)}</b></p>
          ${weak.length ? `<p>الدول التي تحتاج مراجعة:</p><div class="flag-list" style="justify-content:center">${weak.map(i => `<span class="flag-chip"><img src="${FLAG(i)}" alt="">${nm(i)}</span>`).join('')}</div>` : '<p>🎉 لم تخطئ في أي دولة!</p>'}
          <div class="row" style="justify-content:center;margin-top:.6rem">
            ${hasNext ? '<button class="btn green" id="s4nextRound" type="button">الجولة التالية ◀</button>' : ''}
            ${weak.length ? '<button class="btn blue" id="s4review" type="button">🎯 تدرّب على أخطائك</button>' : ''}
            <button class="btn light" id="s4replay" type="button">🔄 أعد الجولة</button>
          </div></div>`;
      if (hasNext) $('#s4nextRound').addEventListener('click', () => { Sound.play('click'); this.start(S4.ri + 1, null); });
      if (weak.length) $('#s4review').addEventListener('click', () => { Sound.play('click'); this.start(S4.ri, weak); });
      $('#s4replay').addEventListener('click', () => { Sound.play('click'); this.restart(); });
      if (last || Store.d.maxScene >= 5) $('#next4').disabled = false;
      if (last) { $('#next4').classList.add('glow'); map.toast('🗺️ أكملت خريطة الوطن العربي!', 'ok', 4000); map.goto(null, true); }
    },

    restart() {
      addScore(-S4.roundScore);                                                // take back this round's points, then replay it
      const review = S4.mode === 'review' ? S4.ids.slice() : null;
      this.start(S4.ri, review);
    },
    leave() { S4.drag = null; map.hover(null); }
  };

  /* ---------------------------------------------------------------
     SCENE 5 — Water bodies (drag the name onto the sea, then tap the sea)
     Round 1-2: drag-and-drop on the map.  Round 3: the name is shown and the student taps its place.
     Evaluation uses the real sea regions of the map (map.hitTest → kind 'sea').
     --------------------------------------------------------------- */
  const ROUNDS5 = [
    { name: 'الجولة الأولى: البحار والمحيطات الكبرى', mode: 'drag', ids: ['med', 'red', 'atl', 'indian'],
      tip: 'اسحب اسم كل مسطح مائي وضعه فوق مكانه على الخريطة.' },
    { name: 'الجولة الثانية: الخلجان وبحر العرب', mode: 'drag', ids: ['gulf', 'aden', 'sea', 'oman'],
      tip: 'ما وضعته سابقاً يبقى ظاهراً ليساعدك على معرفة الجيران.' },
    { name: 'الجولة الثالثة: اضغط على المكان', mode: 'tap', ids: [],
      tip: 'سنكتب لك اسماً، واضغط على مكانه فوق الخريطة.' }
  ];
  const S5 = { ri: 0, mode: 'drag', ids: [], left: [], solved: new Set(), recs: {}, roundScore: 0, armed: null, drag: null, done: false, target: null };
  const sn = id => SEAS[id].n;

  Scenes[5] = {
    enter() { this.start(S5.done ? 0 : Math.min(S5.ri, ROUNDS5.length - 1), null); },

    start(ri, review) {
      mountMap(5); map.tintWings(false);
      const R = ROUNDS5[ri], tap = R.mode === 'tap';
      S5.ri = ri; S5.mode = R.mode; S5.done = false;
      S5.ids = review ? review.slice() : (tap ? shuffle(Object.keys(SEAS)).slice(0, 4) : R.ids.slice());
      S5.left = shuffle(S5.ids.slice()); S5.solved = new Set(); S5.recs = {}; S5.roundScore = 0; S5.armed = null; S5.target = null;
      S5.review = !!review;
      if (R.mode === 'drag' && !review) for (let j = 0; j < ri; j++) ROUNDS5[j].ids.forEach(id => map.addLabel('sea', id));   // earlier seas stay as clues
      map.onTap = null;
      const title = review ? 'مراجعة أخطائك' : R.name, tip = review ? 'سنتدرب معاً على ما احتجت فيه إلى مساعدة.' : R.tip;
      const body = tap ? `<div class="tray" id="s5tray"><span class="chip sea armed" id="s5want" style="cursor:default"></span></div>`
                       : `<div class="tray" id="s5tray"></div>`;
      $('#panel5').innerHTML = `
        ${guideHTML('g5', tap ? 'look' : 'board', tap ? 'اقرأ اسم المسطح المائي ثم اضغط على مكانه فوق الخريطة.' : 'اسحب اسم كل مسطح مائي وضعه فوق مكانه الصحيح على الخريطة.')}
        <div class="card"><h3>🌊 ${title}</h3><p>${tip}</p>
          <div class="row"><div class="meter grow"><i id="s5meter"></i></div><b id="s5count"></b></div></div>
        <div class="card" id="s5zone">
          <div class="hintbar hintbar-top">
            <button class="btn blue" id="s5hint" type="button">💡 تلميح</button>
            <button class="btn light" id="s5again" type="button">🔄 أعد الجولة</button>
          </div>${body}
        </div>
        ${navRow(5, 'التالي: التحدي الأخير')}`;
      bindNav($('#panel5'));
      $('#next5').disabled = !(Store.d.maxScene >= 6);
      $('#s5hint').addEventListener('click', () => this.hint(true));
      $('#s5again').addEventListener('click', () => { Sound.play('click'); this.restart(); });
      this.progress();
      if (tap) { map.onTap = hit => this.tap(hit); this.nextTarget(); }
      else { const tray = $('#s5tray'); tray.innerHTML = S5.left.map(id => `<button class="chip sea" data-id="${id}" type="button">${sn(id)}</button>`).join(''); $$('.chip', tray).forEach(c => this.bindChip(c)); }
    },

    progress() {
      const n = S5.ids.filter(i => S5.solved.has(i)).length;
      $('#s5meter').style.width = (n / S5.ids.length * 100) + '%'; $('#s5count').textContent = `${ar(n)} / ${ar(S5.ids.length)}`;
    },
    rec(id) { return S5.recs[id] || (S5.recs[id] = { wrong: 0, hints: 0, lvl: 0 }); },

    /* ---------- dragging (pointer events: mouse + touch + pen) ---------- */
    bindChip(chip) {
      chip.addEventListener('contextmenu', e => e.preventDefault());
      chip.addEventListener('pointerdown', e => {
        if (S5.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault(); chip.setPointerCapture(e.pointerId);
        S5.drag = { chip, id: chip.dataset.id, pid: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ghost: null };
        Sound.play('pick');
      });
      chip.addEventListener('pointermove', e => {
        const d = S5.drag; if (!d || e.pointerId !== d.pid) return;
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) { d.moved = true; this.beginDrag(d); }
        if (d.moved) { d.ghost.style.left = e.clientX + 'px'; d.ghost.style.top = e.clientY + 'px'; map.hover(map.pointInside(e.clientX, e.clientY) ? map.hitTest(e.clientX, e.clientY) : null); }
      });
      const finish = (e, cancelled) => {
        const d = S5.drag; if (!d || e.pointerId !== d.pid) return;
        S5.drag = null; map.hover(null);
        if (d.ghost) d.ghost.remove(); chip.classList.remove('dragging');
        if (!d.moved) { if (!cancelled) this.arm(chip); return; }           // a simple tap = "select this name"
        if (cancelled) return this.backToTray(chip);
        this.drop(chip, d.id, e.clientX, e.clientY);
      };
      chip.addEventListener('pointerup', e => finish(e, false));
      chip.addEventListener('pointercancel', e => finish(e, true));
    },
    beginDrag(d) {
      const g = d.chip.cloneNode(true); g.classList.add('ghost'); g.style.left = d.x0 + 'px'; g.style.top = d.y0 + 'px'; document.body.appendChild(g);
      d.ghost = g; d.chip.classList.add('dragging'); this.arm(d.chip, true);
    },
    arm(chip, silent) {
      $$('.chip', $('#s5tray')).forEach(c => c.classList.toggle('armed', c === chip));
      S5.armed = chip.dataset.id;
      if (!silent) { Sound.play('select'); say('g5', 'board', `اسحب «${sn(S5.armed)}» إلى مكانه الصحيح على الخريطة.`); }
    },
    backToTray(chip) { chip.classList.remove('dragging'); chip.classList.add('back'); later(() => chip.classList.remove('back'), 500); },

    /* ---------- evaluating an answer ---------- */
    drop(chip, id, x, y) {
      if (!map.pointInside(x, y)) { this.backToTray(chip); say('g5', 'board', 'اسحب الاسم وضعه فوق الخريطة نفسها.'); Sound.play('drop'); return; }
      const hit = map.hitTest(x, y);
      hit.kind === 'sea' && hit.id === id ? this.correct(id, chip) : this.wrong(id, hit, chip);
    },
    tap(hit) {
      const id = S5.target; if (!id || S5.busy) return;
      hit.kind === 'sea' && hit.id === id ? this.correct(id, null) : this.wrong(id, hit, null);
    },
    correct(id, chip) {
      const r = this.rec(id), st = Store.st('s_' + id);
      const pts = Math.max(2, 10 - 3 * r.wrong - 2 * r.hints);
      st.ok++; if (!r.wrong && !r.hints) st.first++;
      S5.roundScore += pts; addScore(pts); Store.save();
      S5.left = S5.left.filter(i => i !== id); S5.armed = null; S5.solved.add(id);
      if (chip) chip.remove();
      map.flash('sea', id, true, 1500); map.addLabel('sea', id);
      Sound.play('correct'); this.progress();
      say('g5', 'ok', `${pick(MSG_OK)} ${sn(id)}: ${SEAS[id].fact}`, 'ok');
      map.toast(`+${ar(pts)} ⭐ ${sn(id)}`, 'ok', 1500);
      if (S5.mode === 'tap') { S5.busy = true; S5.target = null; later(() => { S5.busy = false; map.removeLabel('sea', id); S5.left.length ? this.nextTarget() : this.finish(); }, 1700); }
      else if (!S5.left.length) later(() => this.finish(), 900);
    },
    wrong(id, hit, chip) {
      const r = this.rec(id); r.wrong++; Store.st('s_' + id).bad++; Store.save();
      let msg = MSG_RETRY_SEA;
      if (hit.kind === 'sea') { map.flash('sea', hit.id, false, 900); msg = `هذا ${sn(hit.id)} وليس ${sn(id)}. ${MSG_RETRY_SEA}`; }
      else if (hit.kind === 'country') { map.flash('country', hit.id, false, 900); msg = `هذه ${nm(hit.id)}، وهي دولة وليست مسطحاً مائياً. ${MSG_RETRY_SEA}`; }
      Sound.play('wrong'); if (chip) this.backToTray(chip);
      say('g5', 'oops', msg, 'bad'); map.toast('حاول مرة أخرى 💪', 'bad', 1400);
      if (r.wrong >= 2) later(() => { r.lvl = Math.max(r.lvl, Math.min(3, r.wrong - 1) - 1); this.hint(false, id); }, 1500);   // supportive hint after repeated mistakes
    },
    nextTarget() {
      S5.target = S5.left[0]; S5.armed = S5.target;
      $('#s5want').textContent = sn(S5.target);
      say('g5', 'look', `أين يقع «${sn(S5.target)}»؟ اضغط على مكانه فوق الخريطة.`);
    },

    /* ---------- hints: description → circle → pulse (never the answer itself) ---------- */
    hint(manual, forId) {
      const id = forId || S5.armed || S5.left[0]; if (!id || !S5.left.includes(id)) return;
      const r = this.rec(id); if (manual) r.hints++;
      r.lvl = Math.min(3, r.lvl + 1); Sound.play('hint');
      const chip = $(`.chip[data-id="${id}"]`, $('#s5tray')); if (chip) this.arm(chip, true);
      if (r.lvl === 1) say('g5', 'look', `تلميح عن «${sn(id)}»: ${SEAS[id].hint}.`, 'hint');
      else if (r.lvl === 2) { map.ring('sea', id, 1.6, 5200); say('g5', 'look', `ابحث عن «${sn(id)}» داخل الدائرة المتقطعة على الخريطة.`, 'hint'); }
      else { map.ring('sea', id, 1.2, 5200); map.pulse('sea', id, 3200); say('g5', 'look', `«${sn(id)}» هو المنطقة المضيئة النابضة على الخريطة.`, 'hint'); }
    },

    /* ---------- round finished ---------- */
    finish() {
      const wrongs = Object.values(S5.recs).reduce((a, r) => a + r.wrong, 0), stars = wrongs <= 1 ? 3 : wrongs <= 3 ? 2 : 1;
      const weak = S5.ids.filter(id => (S5.recs[id] || {}).wrong > 0);
      const last = !S5.review && S5.ri === ROUNDS5.length - 1;
      if (!S5.review) Store.d.stars['w' + S5.ri] = Math.max(Store.d.stars['w' + S5.ri] || 0, stars);
      if (last) S5.done = true;
      unlock(6); Store.save(); Sound.play(last ? 'win' : 'complete'); confetti(last ? 90 : 55);
      say('g5', 'happy', last ? 'مذهل! تعرفت على كل المسطحات المائية المحيطة بالوطن العربي!' : 'أحسنت! أكملت الجولة.', 'ok');
      const starsHTML = [1, 2, 3].map(i => `<span class="${i <= stars ? 'on' : 'off'}">★</span>`).join('');
      const hasNext = !S5.review && S5.ri < ROUNDS5.length - 1;
      $('#s5zone').innerHTML = `
        <div style="text-align:center"><div class="stars">${starsHTML}</div>
          <p class="res-msg">${stars === 3 ? 'ممتاز جداً!' : stars === 2 ? 'عمل جميل!' : 'أحسنت! التدريب يصنع الماهر.'}</p>
          <p>نقاط هذه الجولة: <b>${ar(S5.roundScore)}</b> ⭐ — أخطاء: <b>${ar(wrongs)}</b></p>
          ${weak.length ? `<p>تحتاج مراجعة:</p><div class="flag-list" style="justify-content:center">${weak.map(i => `<span class="flag-chip">🌊 ${sn(i)}</span>`).join('')}</div>` : '<p>🎉 لم تخطئ في أي مسطح مائي!</p>'}
          <div class="row" style="justify-content:center;margin-top:.6rem">
            ${hasNext ? '<button class="btn green" id="s5nextRound" type="button">الجولة التالية ◀</button>' : ''}
            ${weak.length ? '<button class="btn blue" id="s5review" type="button">🎯 تدرّب على أخطائك</button>' : ''}
            <button class="btn light" id="s5replay" type="button">🔄 أعد الجولة</button>
          </div></div>`;
      if (hasNext) $('#s5nextRound').addEventListener('click', () => { Sound.play('click'); this.start(S5.ri + 1, null); });
      if (weak.length) $('#s5review').addEventListener('click', () => { Sound.play('click'); this.start(S5.ri, weak); });
      $('#s5replay').addEventListener('click', () => { Sound.play('click'); this.restart(); });
      $('#next5').disabled = false; if (last) { $('#next5').classList.add('glow'); map.toast('🌊 أتقنت المسطحات المائية!', 'ok', 4000); }
    },
    restart() {
      addScore(-S5.roundScore);                                                // take back this round's points, then replay it
      this.start(S5.ri, S5.review ? S5.ids.slice() : null);
    },
    leave() { S5.drag = null; map.hover(null); map.onTap = null; }
  };

  /* ---------------------------------------------------------------
     SCENE 6 — Final challenge: four map missions, then the results card.
       1) tap the African / Asian wing      2) tap a named country
       3) drag 5 country names onto the map  4) drag 3 water-body names onto the map
     No multiple choice: every answer is a touch / drop on the real map regions.
     Items are chosen at random each run, so "Play again" is a different challenge.
     --------------------------------------------------------------- */
  const S6 = { m: 0, missions: [], recs: {}, attempts: 0, drag: null, busy: false, armed: null, cur: null, done: false };
  const ITEM_MAX = 10, REVEAL_AFTER = 4;                       // after 4 wrong tries the answer is shown (no one gets stuck)
  const itemKey = it => it.kind + ':' + (it.id || it.w);
  const itemName = it => it.kind === 'wing' ? WINGS[it.w].name : it.kind === 'sea' ? SEAS[it.id].n : COUNTRIES[it.id].n;

  function buildMissions() {
    const pool = w => shuffle(IDS.filter(i => COUNTRIES[i].w === w && !SMALL.has(i)));
    const af = pool('af'), as = pool('as');
    const m2 = [af.pop(), as.pop()]; const rest = shuffle(af.concat(as)); m2.push(rest.pop());
    const left = id => !m2.includes(id);
    const afL = af.filter(left), asL = as.filter(left);
    const m3 = shuffle([afL.pop(), afL.pop(), afL.pop(), asL.pop(), asL.pop()]);
    const seas = shuffle(Object.keys(SEAS)).slice(0, 3);
    return [
      { k: 'wing', icon: '🧭', title: 'المهمة ١: الجناحان', mode: 'tap', say: 'اضغط على أي دولة تنتمي إلى الجناح المطلوب.', items: shuffle([{ kind: 'wing', w: 'af' }, { kind: 'wing', w: 'as' }]) },
      { k: 'find', icon: '📍', title: 'المهمة ٢: أين تقع الدولة؟', mode: 'tap', say: 'اضغط على مكان الدولة على الخريطة.', items: m2.map(id => ({ kind: 'country', id })) },
      { k: 'drag', icon: '🧩', title: 'المهمة ٣: ضع أسماء الدول', mode: 'drag', say: 'اسحب كل اسم وضعه فوق دولته على الخريطة.', items: m3.map(id => ({ kind: 'country', id })) },
      { k: 'seas', icon: '🌊', title: 'المهمة ٤: المسطحات المائية', mode: 'drag', say: 'اسحب اسم كل مسطح مائي إلى مكانه.', items: seas.map(id => ({ kind: 'sea', id })) }
    ];
  }

  Scenes[6] = {
    enter() { this.start(); },
    start() {
      clearTimers(); this.closeResults();
      S6.missions = buildMissions(); S6.m = 0; S6.recs = {}; S6.attempts = 0; S6.drag = null; S6.busy = false; S6.armed = null; S6.cur = null; S6.done = false;
      mountMap(6); map.tintWings(false);
      $('#panel6').innerHTML = `
        <div id="s6body"></div>
        <div class="row nav-row"><button class="btn light" data-nav="5" type="button">▶ السابق</button></div>`;
      bindNav($('#panel6'));
      Sound.play('whoosh'); this.beginMission();
    },
    total() { return S6.missions.reduce((a, m) => a + m.items.length, 0); },
    doneCount() { return Object.values(S6.recs).filter(r => r.done).length; },
    rec(it) { const k = itemKey(it); return S6.recs[k] || (S6.recs[k] = { it, mission: S6.m, wrong: 0, hints: 0, lvl: 0, done: false, missed: false, pts: 0 }); },

    /* ---------- one mission ---------- */
    beginMission() {
      const M = S6.missions[S6.m], tap = M.mode === 'tap';
      map.reset(); map.goto(null, false); map.tintWings(false); S6.busy = false; S6.armed = null;
      $('#s6body').innerHTML = `
        ${guideHTML('g6', tap ? 'look' : 'board', M.say)}
        <div class="card"><h3>${M.icon} ${M.title}</h3><p>التحدي الأخير — المهمة ${ar(S6.m + 1)} من ${ar(S6.missions.length)}</p>
          <div class="row"><div class="meter grow"><i id="s6meter"></i></div><b id="s6count"></b></div></div>
        <div class="card" id="s6zone">
          <div class="hintbar hintbar-top"><button class="btn blue" id="s6hint" type="button">💡 تلميح</button></div>
          <div class="tray" id="s6tray"></div>
        </div>`;
      $('#s6hint').addEventListener('click', () => this.hint(true));
      this.progress();
      if (tap) { map.onTap = hit => this.tap(hit); this.nextTarget(); }
      else {
        map.onTap = null; const tray = $('#s6tray');
        tray.innerHTML = shuffle(M.items.slice()).map(it => `<button class="chip ${it.kind === 'sea' ? 'sea' : ''}" data-k="${itemKey(it)}" type="button">${itemName(it)}</button>`).join('');
        $$('.chip', tray).forEach(c => this.bindChip(c));
      }
    },
    pending() { return S6.missions[S6.m].items.filter(it => !(S6.recs[itemKey(it)] || {}).done); },
    progress() {
      const n = this.doneCount(), t = this.total();
      $('#s6meter').style.width = (n / t * 100) + '%'; $('#s6count').textContent = `${ar(n)} / ${ar(t)}`;
    },
    nextTarget() {
      const it = this.pending()[0]; S6.cur = it; S6.armed = it;
      const tray = $('#s6tray');
      tray.innerHTML = `<span class="chip ${it.kind === 'sea' ? 'sea' : ''} armed" style="cursor:default">${it.kind === 'wing' ? 'اضغط على ' : 'أين '}${itemName(it)}${it.kind === 'wing' ? '' : '؟'}</span>`;
      say('g6', 'look', it.kind === 'wing' ? `اضغط على أي دولة من «${itemName(it)}» على الخريطة.` : `أين تقع «${itemName(it)}»؟ اضغط على مكانها على الخريطة.`);
    },

    /* ---------- dragging (pointer events: mouse + touch + pen) ---------- */
    itemOf(chip) { return S6.missions[S6.m].items.find(i => itemKey(i) === chip.dataset.k); },
    bindChip(chip) {
      chip.addEventListener('contextmenu', e => e.preventDefault());
      chip.addEventListener('pointerdown', e => {
        if (S6.drag || S6.busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault(); chip.setPointerCapture(e.pointerId);
        S6.drag = { chip, it: this.itemOf(chip), pid: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ghost: null };
        Sound.play('pick');
      });
      chip.addEventListener('pointermove', e => {
        const d = S6.drag; if (!d || e.pointerId !== d.pid) return;
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) {
          d.moved = true; const g = chip.cloneNode(true); g.classList.add('ghost'); g.style.left = d.x0 + 'px'; g.style.top = d.y0 + 'px'; document.body.appendChild(g);
          d.ghost = g; chip.classList.add('dragging'); this.arm(chip, true);
        }
        if (d.moved) { d.ghost.style.left = e.clientX + 'px'; d.ghost.style.top = e.clientY + 'px'; map.hover(map.pointInside(e.clientX, e.clientY) ? map.hitTest(e.clientX, e.clientY) : null); }
      });
      const end = (e, cancelled) => {
        const d = S6.drag; if (!d || e.pointerId !== d.pid) return;
        S6.drag = null; map.hover(null); if (d.ghost) d.ghost.remove(); chip.classList.remove('dragging');
        if (!d.moved) { if (!cancelled) this.arm(chip); return; }
        if (cancelled) return this.backToTray(chip);
        if (!map.pointInside(e.clientX, e.clientY)) { this.backToTray(chip); say('g6', 'board', 'اسحب الاسم وضعه فوق الخريطة نفسها.'); Sound.play('drop'); return; }
        this.answer(d.it, map.hitTest(e.clientX, e.clientY), chip);
      };
      chip.addEventListener('pointerup', e => end(e, false));
      chip.addEventListener('pointercancel', e => end(e, true));
    },
    arm(chip, silent) {
      $$('.chip', $('#s6tray')).forEach(c => c.classList.toggle('armed', c === chip));
      S6.armed = this.itemOf(chip);
      if (!silent) { Sound.play('select'); say('g6', 'board', `اسحب «${itemName(S6.armed)}» إلى مكانه على الخريطة.`); }
    },
    backToTray(chip) { chip.classList.remove('dragging'); chip.classList.add('back'); later(() => chip.classList.remove('back'), 500); },
    tap(hit) { if (!S6.busy && S6.cur) this.answer(S6.cur, hit, null); },

    /* ---------- evaluating an answer ---------- */
    isRight(it, hit) {
      if (it.kind === 'wing') return hit.kind === 'country' && COUNTRIES[hit.id].w === it.w;
      return hit.kind === it.kind && hit.id === it.id;
    },
    answer(it, hit, chip) {
      if (S6.busy) return; const r = this.rec(it); if (r.done) return;
      S6.attempts++;
      if (this.isRight(it, hit)) return this.correct(it, r, chip, hit);
      r.wrong++;
      let msg = it.kind === 'sea' ? MSG_RETRY_SEA : MSG_RETRY;
      if (hit.kind === 'country') {
        map.flash('country', hit.id, false, 900);
        msg = it.kind === 'wing' ? `«${nm(hit.id)}» ليست في ${WINGS[it.w].name}. انظر إلى موقعها بالنسبة للبحر الأحمر.`
          : it.kind === 'country' ? `هذه ${nm(hit.id)} وليست ${nm(it.id)}. ${MSG_RETRY}` : `هذه ${nm(hit.id)}، وهي دولة وليست مسطحاً مائياً. ${MSG_RETRY_SEA}`;
      } else if (hit.kind === 'sea') {
        map.flash('sea', hit.id, false, 900);
        msg = it.kind === 'sea' ? `هذا ${SEAS[hit.id].n} وليس ${SEAS[it.id].n}. ${MSG_RETRY_SEA}` : `هذا مسطح مائي وليس دولة. ${MSG_RETRY}`;
      }
      Sound.play('wrong'); if (chip) this.backToTray(chip);
      say('g6', 'oops', msg, 'bad'); map.toast('حاول مرة أخرى 💪', 'bad', 1400);
      if (r.wrong >= REVEAL_AFTER) { later(() => this.reveal(it, r, chip), 1300); return; }
      if (r.wrong >= 2) later(() => { r.lvl = Math.max(r.lvl, Math.min(3, r.wrong - 1) - 1); this.hint(false, it); }, 1500);
    },
    correct(it, r, chip, hit) {
      r.done = true; r.pts = Math.max(2, ITEM_MAX - 3 * r.wrong - 2 * r.hints);
      addScore(r.pts); Sound.play('correct');
      if (chip) chip.remove();
      this.mark(it, hit, true);
      say('g6', 'ok', `${pick(MSG_OK)} ${this.factOf(it)}`, 'ok'); map.toast(`+${ar(r.pts)} ⭐ ${itemName(it)}`, 'ok', 1500);
      this.afterItem();
    },
    reveal(it, r, chip) {
      if (r.done) return; r.done = true; r.missed = true; r.pts = 0;
      if (chip && chip.isConnected) chip.remove();
      this.mark(it, null, false);
      say('g6', 'look', `هذا هو مكان «${itemName(it)}» على الخريطة. سنتعلمه معاً وتحاول مرة أخرى لاحقاً!`, 'hint');
      Sound.play('hint'); this.afterItem();
    },
    factOf(it) { return it.kind === 'sea' ? `${itemName(it)}: ${SEAS[it.id].fact}` : it.kind === 'wing' ? `${WINGS[it.w].name} يقع في قارة ${WINGS[it.w].continent}.` : `${itemName(it)}: ${COUNTRIES[it.id].fact}`; },
    mark(it, hit, good) {
      if (it.kind === 'wing') { map.tintWings(true); map.dimExcept(IDS.filter(i => COUNTRIES[i].w === it.w)); map.pulseWing(it.w, 1500); return; }
      map.flash(it.kind, it.id, good, 1500);
      if (it.kind === 'country') { const g = map.groups[it.id]; g && g.classList.add('solved'); }
      map.addLabel(it.kind, it.id);
    },
    afterItem() {
      S6.armed = null; S6.cur = null; S6.busy = true; this.progress();
      const M = S6.missions[S6.m];
      later(() => {
        if (M.mode === 'tap') { map.tintWings(false); map.dimExcept(null); map.clearLabels(); }
        if (this.pending().length) { S6.busy = false; if (M.mode === 'tap') this.nextTarget(); else S6.busy = false; return; }
        S6.m + 1 < S6.missions.length ? this.nextMission() : this.results();
      }, M.mode === 'tap' ? 1700 : 1300);
    },
    nextMission() {
      Sound.play('complete'); confetti(30); map.toast(`✅ أنهيت ${S6.missions[S6.m].title.split(':')[0]}`, 'ok', 1400);
      later(() => { S6.m++; Sound.play('whoosh'); this.beginMission(); }, 1500);
    },

    /* ---------- hints (never the answer itself) ---------- */
    hint(manual, forIt) {
      const it = forIt || S6.armed || this.pending()[0]; if (!it || S6.busy) return;
      const r = this.rec(it); if (r.done) return; if (manual) r.hints++;
      r.lvl = Math.min(3, r.lvl + 1); Sound.play('hint');
      const chip = $(`.chip[data-k="${itemKey(it)}"]`, $('#s6tray')); if (chip) this.arm(chip, true);
      if (it.kind === 'wing') {
        if (r.lvl === 1) say('g6', 'look', `${WINGS[it.w].name} يقع في قارة ${WINGS[it.w].continent}.`, 'hint');
        else if (r.lvl === 2) say('g6', 'look', it.w === 'af' ? 'الجناح الإفريقي يقع غرب البحر الأحمر.' : 'الجناح الآسيوي يقع شرق البحر الأحمر.', 'hint');
        else { map.tintWings(true); map.pulseWing(it.w, 2600); say('g6', 'look', `الدول النابضة هي ${WINGS[it.w].name}.`, 'hint'); later(() => map.tintWings(false), 2800); }
      } else if (it.kind === 'country') {
        const c = COUNTRIES[it.id];
        if (r.lvl === 1) say('g6', 'look', `تلميح عن «${c.n}»: ${c.dir}.`, 'hint');
        else if (r.lvl === 2) { map.pulseWing(c.w, 2600); say('g6', 'look', `«${c.n}» في ${WINGS[c.w].name}. انظر إلى الدول النابضة.`, 'hint'); }
        else { map.ring('country', it.id, 1.4, 5200); say('g6', 'look', `ابحث عن «${c.n}» داخل الدائرة المتقطعة.`, 'hint'); }
      } else {
        if (r.lvl === 1) say('g6', 'look', `تلميح عن «${itemName(it)}»: ${SEAS[it.id].hint}.`, 'hint');
        else if (r.lvl === 2) { map.ring('sea', it.id, 1.6, 5200); say('g6', 'look', `ابحث عن «${itemName(it)}» داخل الدائرة المتقطعة.`, 'hint'); }
        else { map.ring('sea', it.id, 1.2, 5200); map.pulse('sea', it.id, 3200); say('g6', 'look', `«${itemName(it)}» هو المنطقة المضيئة النابضة.`, 'hint'); }
      }
    },

    /* ---------- results ---------- */
    stat(missionKey) {
      const rs = Object.values(S6.recs).filter(r => S6.missions[r.mission].k === missionKey);
      const pts = rs.reduce((a, r) => a + r.pts, 0), ok = rs.filter(r => !r.missed).length;
      return { n: rs.length, ok, pts, max: rs.length * ITEM_MAX, wrong: rs.reduce((a, r) => a + r.wrong, 0) };
    },
    results() {
      S6.done = true; S6.busy = true; map.onTap = null;
      const all = Object.values(S6.recs), total = all.length;
      const score = all.reduce((a, r) => a + r.pts, 0), correct = all.filter(r => !r.missed).length;
      const pct = Math.round(score / (total * ITEM_MAX) * 100), stars = pct >= 85 ? 3 : pct >= 60 ? 2 : 1;
      const W = this.stat('wing'), F = this.stat('find'), D = this.stat('drag'), Sx = this.stat('seas');
      const skills = [
        { ok: W.pts / W.max >= .6, t: 'أحدد موقع الوطن العربي وأميّز بين الجناحين الإفريقي والآسيوي', short: 'تمييز الجناحين', go: 2 },
        { ok: F.ok + D.ok >= 5, t: 'أسمّي خمس دول عربية على الأقل من الخريطة', short: 'أسماء الدول ومواقعها', go: 3 },
        { ok: D.ok >= 3, t: 'أضع أسماء الدول في أماكنها بالسحب والإفلات', short: 'السحب والإفلات', go: 4 },
        { ok: Sx.ok >= 3, t: 'أتعرّف على ثلاثة مسطحات مائية تحيط بالوطن العربي', short: 'المسطحات المائية', go: 5 },
        { ok: true, t: 'أتبع قواعد اللعبة وأُكمل كل التحديات', go: 0 }
      ];
      const medals = [
        { k: 'explorer', e: '🧭', t: 'مستكشف شجاع', ok: true },
        { k: 'wings', e: '🗺️', t: 'خبير الجناحين', ok: W.ok === W.n && W.wrong <= 1 },
        { k: 'countries', e: '📍', t: 'صائد الدول', ok: F.ok + D.ok === F.n + D.n },
        { k: 'seas', e: '🌊', t: 'قبطان البحار', ok: Sx.ok === Sx.n },
        { k: 'star', e: '⭐', t: 'نجم الرحلة', ok: stars === 3 }
      ];
      medals.forEach(m => { if (m.ok) Store.d.badges['f_' + m.k] = true; });
      Store.d.final = { score, correct, total, attempts: S6.attempts, pct, stars }; Store.d.stars.final = Math.max(Store.d.stars.final || 0, stars); Store.save();
      const weak = skills.filter(s => !s.ok);
      const msg = stars === 3 ? 'مذهل! أنت مستكشف عظيم لخريطة الوطن العربي!' : stars === 2 ? 'عمل رائع! أنت قريب جداً من الإتقان.' : 'أحسنت المحاولة! قليل من التدريب وستصبح مستكشفاً ماهراً.';
      const pose = stars === 3 ? POSE.happy : stars === 2 ? POSE.ok : POSE.oops;
      const el = document.createElement('div'); el.className = 'results show'; el.id = 'results6';
      el.innerHTML = `<div class="res-card" role="dialog" aria-label="نتيجة التحدي الأخير">
        <div class="res-top"><img src="${IMG(pose)}" alt=""><div><div class="stars">${[1, 2, 3].map(i => `<span class="${i <= stars ? 'on' : 'off'}">★</span>`).join('')}</div><p class="res-msg">${msg}</p></div></div>
        <div class="stat-grid">
          <div class="stat"><b>${ar(score)}</b><span>الدرجة (من ${ar(total * ITEM_MAX)})</span></div>
          <div class="stat"><b>${ar(correct)} / ${ar(total)}</b><span>إجابات صحيحة</span></div>
          <div class="stat"><b>${ar(S6.attempts)}</b><span>عدد المحاولات</span></div>
          <div class="stat"><b>${ar(pct)}٪</b><span>نسبة التقدم</span></div></div>
        <h3>🏅 شاراتك</h3><div class="badges">${medals.map(m => `<div class="achv ${m.ok ? '' : 'locked'}"><div class="medal">${m.e}</div>${m.t}</div>`).join('')}</div>
        <h3>🎓 مهاراتك</h3><div class="skills">${skills.map(s => `<div class="skill ${s.ok ? 'ok' : 'no'}"><span>${s.ok ? '✅' : '🔁'}</span>${s.t}</div>`).join('')}</div>
        ${weak.length ? `<p class="res-msg" style="font-size:1.05rem">لا بأس! تحتاج إلى مزيد من التدريب على: ${weak.map(s => '«' + s.short + '»').join('، ')}</p>` : '<p class="res-msg" style="font-size:1.05rem">🎉 أتقنت كل المهارات!</p>'}
        <div class="res-actions">
          <button class="btn green" id="s6again" type="button">🔄 العب مجدداً</button>
          ${weak.length ? `<button class="btn blue" id="s6practice" type="button">🎯 تدرّب على نقاط الضعف</button>` : ''}
          <button class="btn light" id="s6home" type="button">🏠 الشاشة الرئيسية</button></div></div>`;
      $('#scene6').appendChild(el);
      $('#s6again').addEventListener('click', () => { Sound.play('click'); this.start(); });
      $('#s6home').addEventListener('click', () => { Sound.play('click'); go(1); });
      if (weak.length) $('#s6practice').addEventListener('click', () => { Sound.play('click'); go(weak[0].go); });
      Sound.play(stars >= 2 ? 'win' : 'complete'); confetti(stars === 3 ? 100 : 60);
    },
    closeResults() { const r = $('#results6'); if (r) r.remove(); },
    restart() { addScore(-Object.values(S6.recs).reduce((a, r) => a + r.pts, 0)); this.start(); },
    leave() { S6.drag = null; map.hover(null); map.onTap = null; this.closeResults(); }
  };

  /* ---------------------------------------------------------------
     Explorer's notebook (progress + weak countries)
     --------------------------------------------------------------- */
  function notebook() {
    const ids = IDS.map(i => ({ i, s: Store.d.stats[i] || { ok: 0, bad: 0, first: 0 } }));
    const mastered = ids.filter(x => x.s.first > 0), weak = ids.filter(x => x.s.bad > 0 && x.s.first === 0), rest = ids.filter(x => !mastered.includes(x) && !weak.includes(x));
    const item = (x, cls) => `<div class="nb-item ${cls}"><img src="${FLAG(x.i)}" alt="">${nm(x.i)}</div>`;
    $('#modalCard').innerHTML = `<button class="x-close" id="nbClose" type="button" aria-label="إغلاق">✕</button>
      <h2 id="modalTitle">📒 دفتر المستكشف</h2>
      <p>النقاط: <b>${ar(Store.d.score)}</b> ⭐ — دول اكتشفتها: <b>${ar(seenCount())}</b> من ${ar(IDS.length)}</p>
      <h3>✅ أتقنتها (${ar(mastered.length)})</h3><div class="nb-grid">${mastered.map(x => item(x, 'mastered')).join('') || '<span>لم تتقن دولة بعد، استمر!</span>'}</div>
      <h3>🎯 تحتاج مراجعة (${ar(weak.length)})</h3><div class="nb-grid">${weak.map(x => item(x, 'weak')).join('') || '<span>لا توجد دول تحتاج مراجعة 🎉</span>'}</div>
      <h3>🗺️ لم تتدرب عليها بعد (${ar(rest.length)})</h3><div class="nb-grid">${rest.map(x => item(x, '')).join('')}</div>
      <div class="row" style="justify-content:center">
        ${weak.length ? '<button class="btn blue" id="nbReview" type="button">🎯 تدرّب على الدول التي تحتاج مراجعة</button>' : ''}
        <button class="btn light" id="nbReset" type="button">🧹 ابدأ رحلة جديدة</button></div>`;
    $('#modal').classList.add('show'); Sound.play('click');
    $('#nbClose').addEventListener('click', closeNotebook);
    if (weak.length) $('#nbReview').addEventListener('click', () => {
      closeNotebook(); Store.d.maxScene = Math.max(Store.d.maxScene, 4);
      if (cur !== 4) { cur = 0; go(4, true); } Scenes[4].start(S4.ri, weak.map(x => x.i));
    });
    $('#nbReset').addEventListener('click', () => { if (confirm('هل تريد مسح تقدمك والبدء من جديد؟')) { Store.reset(); renderScore(); closeNotebook(); cur = 0; S4.ri = 0; S4.done = false; go(1, true); } });
  }
  function closeNotebook() { $('#modal').classList.remove('show'); }
  $('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') closeNotebook(); });

  /* ---------------------------------------------------------------
     Top bar + sound controls + start-up
     --------------------------------------------------------------- */
  function renderSound() { $('#btnSound').textContent = Sound.state.on && Sound.state.vol > 0 ? '🔊' : '🔇'; $('#vol').value = Math.round(Sound.state.vol * 100); }
  $('#btnSound').addEventListener('click', () => { Sound.toggle(); renderSound(); Sound.play('click'); });
  $('#vol').addEventListener('input', e => { Sound.setVol(e.target.value / 100); if (!Sound.state.on && e.target.value > 0) Sound.setOn(true); renderSound(); });
  $('#vol').addEventListener('change', () => Sound.play('select'));
  $('#btnRestart').addEventListener('click', () => { if (Scenes[cur] && Scenes[cur].restart) Scenes[cur].restart(); else if (cur === 4) Scenes[4].restart(); });
  $('#btnNotebook').addEventListener('click', notebook);
  $('#brand').addEventListener('click', () => { Sound.play('click'); go(1); });
  document.addEventListener('pointerdown', () => Sound.unlock(), { capture: true });       // sounds only start after the first touch / click
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNotebook(); });
  window.addEventListener('contextmenu', e => { if (e.target.closest('#stage')) e.preventDefault(); });

  renderScore(); renderSound(); renderStepper();
  go(1, true);
  window.AWE = { go, Scenes, S4, S5, S6, Store, map };      // small handle used for automated tests
})();
