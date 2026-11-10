/* main.js — the desk over the scene: language, light, which window is in front, dragging, and the labels on the islands. */
(function () {
  'use strict';

  const root = document.documentElement;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.prototype.slice.call((el || document).querySelectorAll(s));
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const mq = q => (window.matchMedia ? matchMedia(q) : { matches: false, addEventListener: function () {} });
  const store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  const mqDark = mq('(prefers-color-scheme: dark)'), mqStill = mq('(prefers-reduced-motion: reduce)');
  /* ?static draws one still frame and runs nothing: for snapshots and print */
  const still = () => mqStill.matches || /[?&]static\b/.test(location.search);
  const scene = window.Scene || null;
  const wins = $$('#desk .win');

  /* ---------- words that are not in the markup ---------- */
  const T = {
    en: {
      title: 'Zhe Linqi — /linqi', lang: '切换到中文', mode: 'Dark mode', cue: 'Scroll down', up: 'Back to top', marks: 'Landmarks',
      alt: 'Zhe Linqi in a graduation gown, sitting cross-legged in a bright arched glass corridor',
      roles: ['RL researcher', 'robotics builder', 'web3 builder', 'cofounder of Gravit', 'GRASP Lab @ Penn']
    },
    zh: {
      title: 'Zhe Linqi — /linqi', lang: 'Switch to English', mode: '深色模式', cue: '向下滚动', up: '回到顶部', marks: '地标',
      alt: 'Zhe Linqi 穿着学士服，盘腿坐在明亮的拱形玻璃长廊里',
      roles: ['强化学习研究者', '机器人开发者', 'web3 建设者', 'Gravit 联合创始人', '宾大 GRASP 实验室']
    }
  };
  /* The islands, and the window each one belongs to. */
  const MARKS = {
    forge: { en: 'FORGE · the kiln', zh: 'FORGE · 窑炉', to: 'research' },
    gravit: { en: 'Gravit · what pulls', zh: 'Gravit · 引力所在', to: 'now' },
    robots: { en: 'Phibotics · robots', zh: 'Phibotics · 机器人', to: 'experience' },
    bounty: { en: 'Bounty.ai · the board', zh: 'Bounty.ai · 悬赏板', to: 'experience' },
    hangzhou: { en: 'Hangzhou · ZJU', zh: '杭州 · 浙大', to: 'education' },
    philadelphia: { en: 'Philadelphia · Penn', zh: '费城 · 宾大', to: 'education' },
    pitch: { en: 'Beyond the lab', zh: '实验室之外', to: 'life' }
  };
  const lang = () => (/^zh/i.test(root.lang) ? 'zh' : 'en');
  const theme = () => root.getAttribute('data-theme') || (mqDark.matches ? 'dark' : 'light');

  /* ---------- grain: a small tile of specks and scanlines, drawn per theme ---------- */
  function paintGrain(t) {
    const el = $('#grade'); if (!el) return;
    const n = 160, c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d'); if (!g) return;
    const d = g.createImageData(n, n), a = d.data, dark = t === 'dark'; let s = 20260910;
    const rnd = function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const ink = dark ? [0, 0, 0] : [20, 52, 128], white = [255, 255, 255];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4; let c = white, al;
      if (rnd() < 0.5) al = rnd() * (dark ? 0.055 : 0.12);                           /* pale specks */
      else { c = ink; al = rnd() * (dark ? 0.13 : 0.05); }                            /* dark ones: they only show on the paper */
      if (y % 3 === 2) { c = ink; al = Math.max(al, dark ? 0.08 : 0.03); }           /* a scanline every third row */
      if (rnd() < 0.0009) { c = white; al = dark ? 0.5 : 0.7; }                      /* dust */
      a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = Math.round(al * 255);
    }
    g.putImageData(d, 0, 0);
    el.style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')';
  }

  /* ---------- light and dark ---------- */
  const modeKey = $('#mode');
  function applyTheme(instant) {
    const t = theme();
    if (modeKey) modeKey.setAttribute('aria-pressed', String(t === 'dark'));
    /* the browser's own chrome follows the page's choice, not only the system's */
    $$('meta[name=theme-color]').forEach(function (m) { m.media = ''; m.content = t === 'dark' ? '#000000' : '#f5f2e9'; });
    if (scene) scene.setTheme(t, instant);
    paintGrain(t);
  }
  if (modeKey) modeKey.addEventListener('click', function () {
    const next = theme() === 'dark' ? 'light' : 'dark', sys = mqDark.matches ? 'dark' : 'light';
    /* choosing what the system already says forgets the choice, so the page follows the system again */
    if (next === sys) { root.removeAttribute('data-theme'); store.set('theme', null); }
    else { root.setAttribute('data-theme', next); store.set('theme', next); }
    applyTheme(false);
  });
  if (mqDark.addEventListener) mqDark.addEventListener('change', function () { applyTheme(false); });

  /* ---------- the rotating line under the name ---------- */
  const roleEl = $('#role'); let roleTimer = 0, roleIx = 0;
  function roles() {
    clearTimeout(roleTimer); roleIx = 0;
    if (!roleEl) return;
    roleEl.textContent = T[lang()].roles[0];
    if (still()) return;
    const next = function () {
      const list = T[lang()].roles, from = roleEl.textContent, to = list[roleIx = (roleIx + 1) % list.length]; let n = from.length;
      const type = function (k) { roleEl.textContent = to.slice(0, k); roleTimer = setTimeout(k < to.length ? function () { type(k + 1); } : next, k < to.length ? 46 : 2400); };
      (function erase() { if (n > 0) { roleEl.textContent = from.slice(0, --n); roleTimer = setTimeout(erase, 24); } else type(1); })();
    };
    roleTimer = setTimeout(next, 2400);
  }

  /* ---------- language ---------- */
  const langKey = $('#lang'), markEls = [];
  function applyLang() {
    const l = lang(), t = T[l];
    document.title = t.title;
    if (langKey) langKey.setAttribute('aria-label', t.lang);
    if (modeKey) modeKey.setAttribute('aria-label', t.mode);
    const cue = $('#cue'), up = $('#up'), img = $('.print img'), nav = $('#marks');
    if (cue) cue.setAttribute('aria-label', t.cue);
    if (up) up.setAttribute('aria-label', t.up);
    if (img) img.alt = t.alt;
    if (nav) nav.setAttribute('aria-label', t.marks);
    markEls.forEach(function (el) { el.lastChild.textContent = MARKS[el.dataset.mark][l]; el.lang = l === 'zh' ? 'zh-Hans' : 'en'; });
    roles();
    layout();
  }
  if (langKey) langKey.addEventListener('click', function () {
    const next = lang() === 'zh' ? 'en' : 'zh';
    root.lang = next === 'zh' ? 'zh-Hans' : 'en'; store.set('lang', next);
    applyLang();
  });

  /* ---------- the camera's stops: one per window ----------
     Wide, the windows keep to the sides and the camera reaches a window's island as that window crosses the middle of the screen.
     Narrow, a window covers the scene, so the island is reached in the open stretch above its window: first the place, then the words. */
  let layoutQueued = false;
  function layout() {
    if (!scene) return;
    const vh = window.innerHeight, max = Math.max(1, root.scrollHeight - vh), narrow = window.innerWidth < 1100, a = [{ y: 0, u: 0 }];
    wins.forEach(function (w, i) {
      let y = w.offsetTop + w.offsetHeight / 2 - vh / 2;
      if (narrow && i > 0) { const p = wins[i - 1], gap = w.offsetTop - (p.offsetTop + p.offsetHeight); y = w.offsetTop - gap / 2 - vh / 2; }
      const prev = a[a.length - 1];
      a.push({ y: Math.max(clamp(y, 0, max), prev.y + Math.min(vh * 0.25, 160)), u: +w.dataset.stop });
    });
    const last = a[a.length - 1];
    a.push({ y: Math.max(max, last.y + 1), u: last.u });
    scene.setAnchors(a);
  }
  function queueLayout() { if (!layoutQueued) { layoutQueued = true; requestAnimationFrame(function () { layoutQueued = false; layout(); onScroll(); }); } }

  /* ---------- the window in front ---------- */
  let front = null, ticking = false;
  function onScroll() {
    ticking = false;
    const y = window.scrollY || 0, vh = window.innerHeight, mid = y + vh / 2;
    root.classList.toggle('top', y < 12);
    let best = null, bd = 1e9;
    wins.forEach(function (w) { const d = Math.abs(w.offsetTop + w.offsetHeight / 2 - mid); if (d < bd) { bd = d; best = w; } });
    if (best && bd > Math.max(vh * 0.62, best.offsetHeight / 2 + 80)) best = null;
    if (best !== front) {
      if (front) front.classList.remove('on');
      if (best) best.classList.add('on');
      front = best;
      markEls.forEach(function (el) { el.classList.toggle('here', !!best && MARKS[el.dataset.mark].to === best.id); });
    }
  }
  addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });

  /* ---------- windows are picked up by their bars (a mouse, a wide screen) ---------- */
  let zTop = 5, lastW = window.innerWidth;
  wins.forEach(function (win) {
    const bar = $('.bar', win); let id = null, sx = 0, sy = 0, ox = 0, oy = 0;
    win._dx = 0; win._dy = 0;
    if (!bar) return;
    bar.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.pointerType !== 'mouse' || window.innerWidth < 900) return;
      id = e.pointerId; sx = e.clientX; sy = e.clientY; ox = win._dx; oy = win._dy;
      try { bar.setPointerCapture(id); } catch (err) { /* older engines */ }
      win.classList.add('drag'); win.style.zIndex = String(++zTop); root.classList.add('dragging');
      e.preventDefault();
    });
    bar.addEventListener('pointermove', function (e) {
      if (e.pointerId !== id) return;
      win._dx = ox + e.clientX - sx; win._dy = oy + e.clientY - sy;
      win.style.transform = 'translate3d(' + win._dx + 'px,' + win._dy + 'px,0)';
    });
    const drop = function (e) { if (e.pointerId !== id) return; id = null; win.classList.remove('drag'); root.classList.remove('dragging'); };
    bar.addEventListener('pointerup', drop); bar.addEventListener('pointercancel', drop);
  });
  addEventListener('resize', function () {
    if (window.innerWidth !== lastW) { lastW = window.innerWidth; wins.forEach(function (w) { w._dx = w._dy = 0; w.style.transform = ''; }); }
    queueLayout();
  });
  if (window.ResizeObserver) { const ro = new ResizeObserver(queueLayout); ro.observe($('#page') || document.body); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueLayout);
  addEventListener('load', queueLayout);

  /* ---------- labels on the islands ---------- */
  const marksNav = $('#marks');
  if (scene && marksNav) scene.marks.forEach(function (m) {
    const a = document.createElement('a'), i = document.createElement('i'), s = document.createElement('span'), d = MARKS[m.id];
    a.href = '#' + d.to; a.dataset.mark = m.id; a.className = 'off'; a._off = true; i.setAttribute('aria-hidden', 'true');
    a.appendChild(i); a.appendChild(s); marksNav.appendChild(a); markEls.push(a);
  });
  function placeMarks(p) {
    for (let i = 0; i < markEls.length; i++) {
      const el = markEls[i], q = p[i];
      if (!q.on) { if (!el._off) { el._off = true; el.classList.add('off'); } continue; }
      if (el._off) { el._off = false; el.classList.remove('off'); }
      el.style.transform = 'translate3d(' + q.x.toFixed(1) + 'px,' + q.y.toFixed(1) + 'px,0)';
    }
  }

  /* ---------- the Now window's meter turns the orrery ---------- */
  $$('input[name=effort]').forEach(function (r) {
    r.addEventListener('change', function () { if (r.checked && scene) scene.setEffort(+r.value); });
    if (r.checked && scene) scene.setEffort(+r.value);
  });

  /* ---------- go ---------- */
  const yr = $('#year'); if (yr) yr.textContent = String(new Date().getFullYear());
  let ok = false;
  if (scene) ok = scene.init($('#gl'), { theme: theme(), reduced: still(), onReady: function () { root.classList.add('glon'); }, onFrame: placeMarks });
  if (!ok) root.classList.add('nogl');
  if (mqStill.addEventListener) mqStill.addEventListener('change', function () { if (scene) scene.setMotion(!still()); roles(); });
  applyTheme(true);
  applyLang();
  onScroll();
})();
