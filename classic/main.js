/* ============================================================
   Zhe Linqi — personal site
   All motion is rAF-driven with delta-time compensation, so it
   runs at native refresh (60/120/144Hz) without speed drift.

   Each feature initializes inside safe() so one failure can
   never take down the rest of the page — and the .js class that
   arms scroll-reveal hiding is only added once the reveal
   observer is actually wired.
   ============================================================ */
(() => {
  "use strict";

  // ?static renders everything revealed with no animation
  // (useful for print pipelines and full-page snapshots).
  const staticMode = /[?&]static\b/.test(location.search);
  if (staticMode) document.documentElement.classList.add("static");

  const rmQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = rmQuery.matches || staticMode;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const hasIO = "IntersectionObserver" in window;

  // Live reduced-motion toggle: features register a callback and
  // re-check the flag when the OS setting changes mid-session.
  const rmCallbacks = [];
  if (typeof rmQuery.addEventListener === "function") {
    rmQuery.addEventListener("change", () => {
      reducedMotion = rmQuery.matches || staticMode;
      rmCallbacks.forEach((fn) => { try { fn(); } catch (_) { /* isolated */ } });
    });
  }

  const safe = (fn) => { try { fn(); } catch (err) { console.error("init failed:", err); } };

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  /* ----------------------------------------------------------
     1. Flow-field particle canvas (hero)
     ---------------------------------------------------------- */
  safe(() => {
    const canvas = document.getElementById("field");
    const hero = document.getElementById("hero");
    if (!canvas || !hero) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return; // context unavailable — hero keeps its CSS glow only

    const BG = "#faf9f4";

    let dpr = 1;
    let W = 0, H = 0;
    let particles = [];
    let running = false;
    let rafId = 0;
    let lastT = 0;
    let time = Math.random() * 100;
    let heroInView = true; // hero starts at the top of the page

    const mouse = { x: -1e4, y: -1e4, active: false };

    // Cheap smooth pseudo-noise built from layered trig — no
    // lookup tables, fast enough for a few hundred particles at
    // 120Hz. A tangential term curls particles around a drifting
    // center so the flow reads as embers, not laminar streaks.
    function fieldAngle(x, y, t) {
      const s = 0.0028;
      const cx = x - W * (0.5 + Math.sin(t * 0.11) * 0.18);
      const cy = y - H * (0.45 + Math.cos(t * 0.09) * 0.16);
      const swirl = Math.atan2(cy, cx) + Math.PI / 2;
      const n =
        Math.sin(x * s + t * 0.34) +
        Math.cos(y * s * 1.4 - t * 0.26) +
        Math.sin((x - y) * s * 0.8 + t * 0.16);
      return swirl + n * 0.85;
    }

    function makeParticle(fresh) {
      const r = Math.random();
      // Warm ink trio on ivory: terracotta, bronze, umber.
      const color = r < 0.62 ? "179,84,48" : r < 0.85 ? "158,112,34" : "121,85,56";
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        speed: 22 + Math.random() * 34,
        life: fresh ? Math.random() * 7 : 4 + Math.random() * 7,
        age: fresh ? 0 : Math.random() * 3,
        width: 0.7 + Math.random() * 0.9,
        color,
        alpha: 0.14 + Math.random() * 0.24
      };
    }

    // Rebuilds the backing store only when geometry actually
    // changed — iOS URL-bar collapse fires window resize without
    // changing the hero's box, and a hard reset there would wipe
    // the trails mid-scroll.
    function resize() {
      const rect = hero.getBoundingClientRect();
      const newW = Math.max(1, Math.round(rect.width));
      const newH = Math.max(1, Math.round(rect.height));
      const newDpr = Math.min(window.devicePixelRatio || 1, 2);
      if (newW === W && newH === H && newDpr === dpr && particles.length) return;
      W = newW; H = newH; dpr = newDpr;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
      ctx.lineCap = "round";

      const target = Math.max(120, Math.min(420, Math.round((W * H) / 8500)));
      particles = Array.from({ length: target }, () => makeParticle(false));
    }

    function drawStatic() {
      // Reduced motion: a quiet constellation, no animation loop.
      resize();
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.width, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color},${p.alpha * 0.8})`;
        ctx.fill();
      }
    }

    function step(now) {
      if (!running) return;
      rafId = requestAnimationFrame(step);

      // Delta time in seconds, clamped so a background-tab pause
      // doesn't teleport particles when the tab wakes up.
      let dt = (now - lastT) / 1000;
      lastT = now;
      if (dt <= 0) return;
      if (dt > 0.1) dt = 0.1;
      time += dt;

      // Translucent wash gives the flowing-trail look.
      ctx.fillStyle = "rgba(250,249,244,0.085)";
      ctx.fillRect(0, 0, W, H);

      for (const p of particles) {
        const angle = fieldAngle(p.x, p.y, time);
        let vx = Math.cos(angle) * p.speed;
        let vy = Math.sin(angle) * p.speed;

        // Gentle swirl around the pointer.
        if (mouse.active) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          const R = 190;
          if (d2 < R * R && d2 > 1) {
            const d = Math.sqrt(d2);
            const f = (1 - d / R) * 90;
            vx += (-dy / d) * f + (dx / d) * f * 0.35;
            vy += (dx / d) * f + (dy / d) * f * 0.35;
          }
        }

        const nx = p.x + vx * dt;
        const ny = p.y + vy * dt;

        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        ctx.strokeStyle = `rgba(${p.color},${p.alpha})`;
        ctx.lineWidth = p.width;
        ctx.stroke();

        p.x = nx;
        p.y = ny;
        p.age += dt;

        if (p.age > p.life || nx < -20 || nx > W + 20 || ny < -20 || ny > H + 20) {
          Object.assign(p, makeParticle(true));
        }
      }
    }

    // The loop runs only while ALL of these hold: hero on screen,
    // tab visible, motion allowed.
    function start() {
      if (running || reducedMotion || !heroInView || document.hidden) return;
      running = true;
      lastT = performance.now();
      rafId = requestAnimationFrame(step);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
    }

    resize();
    if (reducedMotion) drawStatic();
    else start();

    window.addEventListener("resize", debounce(() => {
      resize();
      if (reducedMotion) drawStatic();
    }, 150));

    if (hasIO) {
      new IntersectionObserver((entries) => {
        // Act on the latest entry — batched deliveries arrive oldest-first.
        heroInView = entries[entries.length - 1].isIntersecting;
        heroInView ? start() : stop();
      }, { threshold: 0 }).observe(hero);
    }
    document.addEventListener("visibilitychange", () => {
      document.hidden ? stop() : start();
    });
    rmCallbacks.push(() => {
      if (reducedMotion) { stop(); drawStatic(); }
      else start();
    });

    if (finePointer) {
      hero.addEventListener("pointermove", (e) => {
        const rect = hero.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
        mouse.active = true;
      });
      hero.addEventListener("pointerleave", () => { mouse.active = false; });
    }
  });

  /* ----------------------------------------------------------
     2. Scroll-reveal with per-section stagger
     The .js class (which arms the hidden state in CSS) is added
     HERE, right before the observer is wired — never earlier —
     so no failure mode can leave content invisible.
     ---------------------------------------------------------- */
  safe(() => {
    if (staticMode || reducedMotion || !hasIO) return; // content simply stays visible

    const revealEls = document.querySelectorAll(".reveal");
    if (!revealEls.length) return;
    document.documentElement.classList.add("js");

    // Once a reveal has played, strip the machinery (classes,
    // stagger delay, will-change) so the element's own transitions
    // — e.g. the feature card's tilt — take over cleanly.
    const finish = (el) => {
      el.classList.remove("reveal", "in");
      el.style.removeProperty("--reveal-delay");
    };

    const io = new IntersectionObserver((entries) => {
      let batch = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        el.style.setProperty("--reveal-delay", `${Math.min(batch * 0.09, 0.45)}s`);
        el.classList.add("in");
        io.unobserve(el);
        setTimeout(() => finish(el), 1600); // 0.9s transition + max 0.45s delay
        batch++;
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    revealEls.forEach((el) => io.observe(el));
  });

  /* ----------------------------------------------------------
     3. Nav: scrolled state, progress bar, active section
     ---------------------------------------------------------- */
  safe(() => {
    const nav = document.getElementById("nav");
    const progress = document.getElementById("progress");
    if (!nav || !progress) return;
    const navLinks = new Map(
      [...document.querySelectorAll(".nav-links a[data-section]")].map((a) => [a.dataset.section, a])
    );
    const setActive = (id) => {
      navLinks.forEach((a, key) => a.classList.toggle("active", key === id));
    };
    let ticking = false;

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY;
        nav.classList.toggle("scrolled", y > 40);
        const max = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
        // tall-viewport dead zone: at the very bottom the last section
        // may never enter the observer band, so force it active here
        if (max > 0 && y >= max - 2) setActive("contact");
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", debounce(onScroll, 150));
    onScroll();

    // mobile disclosure menu
    const toggle = document.getElementById("navToggle");
    if (toggle) {
      const close = () => {
        nav.classList.remove("nav-open");
        toggle.setAttribute("aria-expanded", "false");
      };
      toggle.addEventListener("click", () => {
        const open = !nav.classList.contains("nav-open");
        nav.classList.toggle("nav-open", open);
        toggle.setAttribute("aria-expanded", String(open));
      });
      navLinks.forEach((a) => a.addEventListener("click", close));
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && nav.classList.contains("nav-open")) {
          close();
          toggle.focus();
        }
      });
    }

    if (!hasIO) return;
    const sectionIO = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        setActive(entry.target.id);
      }
    }, { rootMargin: "-40% 0px -55% 0px", threshold: 0 });
    document.querySelectorAll("main section[id]").forEach((s) => {
      if (navLinks.has(s.id)) sectionIO.observe(s);
    });
  });

  /* ----------------------------------------------------------
     4. Rotating role word — driven by animationend (no timer /
     animation race), paused while the tab is hidden so background
     throttling can't strand it in the held-invisible state.
     ---------------------------------------------------------- */
  safe(() => {
    const roleWord = document.getElementById("roleWord");
    if (!roleWord) return;
    // NOTE: keep in sync with the .visually-hidden list in index.html
    const roles = [
      "RL researcher",
      "robotics builder",
      "web3 builder",
      "cofounder — Gravit",
      "GRASP Lab @ Penn"
    ];
    let idx = 0;
    let timer = null;
    let fallback = null;

    const settle = () => roleWord.classList.remove("swap-out", "swap-in");

    const advance = () => {
      clearTimeout(fallback);
      fallback = null;
      idx = (idx + 1) % roles.length;
      roleWord.textContent = roles[idx];
      roleWord.classList.remove("swap-out");
      void roleWord.offsetWidth; // restart the entrance animation
      roleWord.classList.add("swap-in");
    };

    roleWord.addEventListener("animationend", (e) => {
      if (e.animationName === "word-out") {
        advance();
      } else if (e.animationName === "word-in") {
        roleWord.classList.remove("swap-in");
      }
    });

    const startRot = () => {
      if (timer || reducedMotion || document.hidden) return;
      timer = setInterval(() => {
        settle();
        void roleWord.offsetWidth;
        roleWord.classList.add("swap-out");
        // Safety net: if animationend never arrives (animations
        // suppressed), swap anyway instead of holding the word
        // in the animation's hidden end state.
        clearTimeout(fallback);
        fallback = setTimeout(() => {
          if (roleWord.classList.contains("swap-out")) advance();
        }, 700);
      }, 3000);
    };
    const stopRot = () => {
      clearInterval(timer);
      clearTimeout(fallback);
      timer = null;
      fallback = null;
      settle(); // never leave the word stuck off-screen
    };

    document.addEventListener("visibilitychange", () => {
      document.hidden ? stopRot() : startRot();
    });
    rmCallbacks.push(() => { reducedMotion ? stopRot() : startRot(); });
    startRot();
  });

  /* ----------------------------------------------------------
     5. Tilt on the featured card (fine pointers only)
     The rect is cached on pointerenter — reading it per-frame
     would measure the already-transformed box and oscillate.
     ---------------------------------------------------------- */
  safe(() => {
    const tiltCard = document.getElementById("tiltCard");
    if (!tiltCard || !finePointer) return;
    let rect = null;
    let raf = 0;

    tiltCard.addEventListener("pointerenter", () => {
      rect = tiltCard.getBoundingClientRect();
    });
    tiltCard.addEventListener("pointermove", (e) => {
      if (reducedMotion || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = rect || tiltCard.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        tiltCard.style.transform =
          `perspective(1000px) rotateX(${(-py * 3).toFixed(2)}deg) rotateY(${(px * 4).toFixed(2)}deg) translateY(-2px)`;
      });
    });
    tiltCard.addEventListener("pointerleave", () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      rect = null;
      tiltCard.style.transform = "";
    });
  });

  /* ----------------------------------------------------------
     6. Magnetic buttons (fine pointers only) — same rect caching.
     ---------------------------------------------------------- */
  safe(() => {
    if (!finePointer) return;
    document.querySelectorAll(".btn").forEach((btn) => {
      let rect = null;
      let raf = 0;
      btn.addEventListener("pointerenter", () => {
        rect = btn.getBoundingClientRect();
      });
      btn.addEventListener("pointermove", (e) => {
        if (reducedMotion || raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const r = rect || btn.getBoundingClientRect();
          const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
          const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
          btn.style.transform = `translate(${(dx * 4).toFixed(1)}px, ${(dy * 3).toFixed(1)}px)`;
        });
      });
      btn.addEventListener("pointerleave", () => {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        rect = null;
        btn.style.transform = "";
      });
    });
  });

  /* ----------------------------------------------------------
     7. Effort strip — a faithful reimplementation of Claude
     Code's energy-field slider, studied from its shader and
     DOM: a full-width field revealed only through the fill
     window left of the handle; bursts race outward from the
     handle in Manhattan cell distance (ragged fronts via
     per-cell jitter, a recruitment lottery re-rolled per
     burst), cells flash on arrival and cool through a discrete
     5-step ink ramp, only the hottest step breathes, a faint
     right-to-left current drifts through the field, a charged
     violet bed builds up behind the front, and the first part
     of the fill sits beyond the energy's reach. Snaps to four
     stops, like the original.
     ---------------------------------------------------------- */
  safe(() => {
    const strip = document.getElementById("effortStrip");
    const valueEl = document.getElementById("effortValue");
    if (!strip) return;
    const ctx = strip.getContext("2d");
    if (!ctx) return;

    const THUMB_W = 18;
    const ROWS = 7;

    // ─── stops ───
    const STOPS = [0, 1 / 3, 2 / 3, 1];
    const LEVEL_NAMES = ["prompt-only", "SFT", "RLHF-style", "ultra"];
    const snap = (v) => Math.round(Math.min(1, Math.max(0, v)) * 3) / 3;

    // ─── burst engine (all rates in cells or seconds) ───
    const MAX_BURSTS = 14;                // enough for a 0.3–0.75s cadence × 5s life
    const SPEED_LO = 20, SPEED_HI = 36;   // wavefront, cells/s
    const RANGE_LO = 10, RANGE_HI = 55;   // reach, cells
    const DENSITY_LO = 0.3, DENSITY_HI = 0.85; // recruitment lottery
    const JITTER = 0.1;                   // per-cell arrival scatter, s
    const HEAD_GAIN = 1.25, HEAD_DECAY = 5.0;
    const BODY_GAIN = 0.65, BODY_LO = 3.3, BODY_HI = 0.77;
    const AMP_LO = 0.55, MAX_AGE = 5.0;
    const RAMP_POW = 1.4;
    const BREATH_DIP = 0.28, BREATH_BASE = 2.4, BREATH_VARY = 1.4;
    const INK_FLOOR = 0.28, INK_CEIL = 1.0, ENERGY_GAIN = 1.18;
    const MASK_END = 0.45;                // calm zone: the first 45% of the fill
    const CADENCE_LO = 0.3, CADENCE_VARY = 0.45; // seconds between bursts while lit
    const SUSTAIN_S = 1.6, FADE_IN_S = 0.7;
    const ORIGIN_JX = 0.04, ORIGIN_Y0 = 0.35, ORIGIN_Y1 = 0.65;
    const THUMB_SCALE_DRAG = 1.12;

    // reference light-mode inks: cool lavender → near-white hot,
    // over a periwinkle → violet charged bed, with blue/pink leans
    const COOL = [198, 192, 243], HOT = [251, 237, 241];
    const CHARGE0 = [136, 142, 221], CHARGE1 = [137, 100, 196];
    const TINT_BLUE = [191, 214, 243], TINT_PINK = [240, 188, 204];
    const TINT_STRENGTH = 0.28;
    const CHARGE_MAX = 0.92, CHARGE_RAMP = 0.5;
    const FILL_SURFACE = "rgba(64,52,36,0.07)";   // the lit fill under the field
    const DOT_R = 1.5, DOT_RGBA = "rgba(64,52,36,0.25)";

    let dpr = 1, W = 0, H = 42, cols = 0, pitch = 6;
    let p = 1;
    let time = 0, seed = 41.7;
    let running = false, rafId = 0, lastT = 0, inView = true;
    let litAt = 0;        // master envelope clock — never reset by presses
    let sustainAt = 0;    // burst-gain ramp clock — restarts on each press
    let ambientAt = CADENCE_LO + CADENCE_VARY * Math.random();
    let dragging = false, thumbS = 1;
    let burstCount = 0;

    const handleX = (v) => THUMB_W / 2 + v * (W - THUMB_W);

    const bursts = Array.from({ length: MAX_BURSTS }, () => ({ t: -1e3, cx: 0, cy: 0, k: 0 }));
    let burstIdx = 0;
    function fireBurst(xPx, yPx, k) {
      const b = bursts[burstIdx++ % MAX_BURSTS];
      b.t = time;
      b.cx = xPx / pitch;
      b.cy = yPx / pitch;
      b.k = Math.min(1, Math.max(0, k));
      burstCount++;
    }
    // strength slides with the chosen stop and how long the field has
    // been sustained — first stop faint and local, top stop full blast
    function burstGain() {
      const t = Math.min((time - sustainAt) / SUSTAIN_S, 1);
      return Math.min((0.15 + 0.7 * p) * (0.45 + 0.55 * t), 1) * (0.85 + 0.3 * Math.random());
    }
    function fireFromHandle() {
      fireBurst(
        handleX(p) + (Math.random() - 0.5) * 2 * ORIGIN_JX * W,
        H * (ORIGIN_Y0 + (ORIGIN_Y1 - ORIGIN_Y0) * Math.random()),
        burstGain()
      );
    }

    const hash = (x, y) => {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const smooth = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const px = handleX(p);
      const rowPitch = H / ROWS;
      const cellHalf = pitch * 0.375;             // cell ≈ 0.75 * pitch
      const rad = cellHalf * 0.62;
      const fade = smooth(0, FADE_IN_S, time - litAt);

      // 1. stop dots across the whole track, under everything
      ctx.fillStyle = DOT_RGBA;
      for (let i = 0; i < STOPS.length; i++) {
        ctx.beginPath();
        ctx.arc(handleX(STOPS[i]), H / 2, DOT_R, 0, 6.2832);
        ctx.fill();
      }

      // 2. the lit fill surface, left edge → handle
      ctx.fillStyle = FILL_SURFACE;
      ctx.fillRect(0, 0, px, H);

      // 3. the field — exists only inside the fill window
      for (let cx = 0; cx < cols; cx++) {
        const x = (cx + 0.5) * pitch;
        if (x > px + pitch * 0.5) break;
        // soft one-cell edge under the thumb so nothing pops
        const winA = 1 - smooth(px - pitch * 0.5, px + pitch * 0.5, x);
        // calm zone measured over the fill: energy never reaches its first 45%
        const leftMask = smooth(0, MASK_END, x / Math.max(px, 1)) * fade;
        if (leftMask <= 0.001) continue;
        const g = Math.min(1, x / Math.max(px, 1));

        for (let cy = 0; cy < ROWS; cy++) {
          const y = (cy + 0.5) * rowPitch;
          const jitter = (hash(cx + 41.7 + seed, cy) - 0.5) * 2 * JITTER;
          const vary = 0.35 + 0.65 * hash(cx + 13.7 + seed, cy);

          let energy = 0, charged = 0;
          for (let i = 0; i < MAX_BURSTS; i++) {
            const b = bursts[i];
            const age = time - b.t;
            if (age < 0 || age > MAX_AGE) continue;
            const manh = Math.abs(cx - b.cx) + Math.abs(cy * (pitch / rowPitch) - b.cy);
            const range = RANGE_LO + (RANGE_HI - RANGE_LO) * b.k;
            const falloff = Math.exp(-manh / (range * 0.85));
            const reach = Math.exp(-Math.max(manh - range, 0) * 0.12);
            const speed = SPEED_LO + (SPEED_HI - SPEED_LO) * b.k;
            const t = age - manh / speed - jitter;
            // ease the charged bed out over the burst's last half second
            const life = 1 - smooth(MAX_AGE - 0.6, MAX_AGE, age);
            charged = Math.max(charged, smooth(0, 0.15, t) * reach * life);
            if (t < 0) continue;
            // recruitment lottery — re-rolled per burst via its timestamp
            const rank = hash(cx + 7.3 + seed + b.t, cy);
            if (rank > DENSITY_LO + (DENSITY_HI - DENSITY_LO) * b.k) continue;
            const head = HEAD_GAIN * Math.exp(-t * HEAD_DECAY);
            const body = BODY_GAIN * Math.exp(-t * (BODY_LO + (BODY_HI - BODY_LO) * b.k));
            energy += (head + body) * (AMP_LO + (1 - AMP_LO) * b.k) * falloff * reach * vary;
          }

          // per-cell brightness identity drifts between two personas,
          // plus the faint right→left current
          const lumA = hash(cx + 8.8 + seed, cy);
          const lumB = hash(cx + 88.8 + seed, cy);
          const drift = 0.5 + 0.5 * Math.sin(time * 0.35 + lumA * 6.2832);
          const lum = Math.pow(lumA + (lumB - lumA) * drift, 1.9);
          const stream = 0.9 + 0.16 * Math.sin(time * 1.3 + cx * 0.45 + lumB * 2);
          const e = Math.min(1, energy) * (0.16 + 0.84 * lum) * stream * ENERGY_GAIN * leftMask;

          // discrete 5-step ramp — energy IS visibility
          const lv = (e >= 0.04 ? 1 : 0) + (e >= 0.2 ? 1 : 0) + (e >= 0.4 ? 1 : 0) +
                     (e >= 0.6 ? 1 : 0) + (e >= 0.8 ? 1 : 0);
          let alpha = lv <= 0 ? 0 : INK_FLOOR + (INK_CEIL - INK_FLOOR) * ((lv - 1) / 4);

          // only the hottest cells breathe — slow, never in unison
          if (lv >= 5) {
            const period = BREATH_BASE + BREATH_VARY * hash(cx + 3.1 + seed, cy);
            const phase = hash(cx + 5.5 + seed, cy) * 6.2832;
            alpha *= 1 - BREATH_DIP * 0.5 * (1 + Math.sin(time * 6.2832 / period + phase));
          }

          // charged bed: left-edge→handle gradient, revealed by the front,
          // painted over the whole cell so the hot inks have a ground
          const bedA = CHARGE_MAX * Math.pow(g, CHARGE_RAMP) * charged * leftMask * winA;
          if (bedA > 0.015) {
            const cr0 = Math.round(CHARGE0[0] + (CHARGE1[0] - CHARGE0[0]) * g);
            const cg0 = Math.round(CHARGE0[1] + (CHARGE1[1] - CHARGE0[1]) * g);
            const cb0 = Math.round(CHARGE0[2] + (CHARGE1[2] - CHARGE0[2]) * g);
            ctx.fillStyle = `rgba(${cr0},${cg0},${cb0},${Math.min(0.98, bedA)})`;
            ctx.fillRect(x - pitch / 2, y - rowPitch / 2, pitch, rowPitch);
          }

          const eA = alpha * winA;
          if (eA > 0.015) {
            // ink ramp cool→hot, with per-cell blue/pink hue lottery
            const rampT = Math.pow(lv / 5, RAMP_POW);
            let ir = COOL[0] + (HOT[0] - COOL[0]) * rampT;
            let ig = COOL[1] + (HOT[1] - COOL[1]) * rampT;
            let ib = COOL[2] + (HOT[2] - COOL[2]) * rampT;
            const hueSel = hash(cx + 27.9 + seed, cy);
            const bl = TINT_STRENGTH * smooth(0.62, 0.95, hueSel);
            const pk = TINT_STRENGTH * (1 - smooth(0.05, 0.38, hueSel));
            ir += (TINT_BLUE[0] - ir) * bl + (TINT_PINK[0] - ir) * pk;
            ig += (TINT_BLUE[1] - ig) * bl + (TINT_PINK[1] - ig) * pk;
            ib += (TINT_BLUE[2] - ib) * bl + (TINT_PINK[2] - ib) * pk;
            const half = cellHalf * (lv >= 5 ? 1.08 : 1);
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x - half, y - half, half * 2, half * 2, rad);
            else ctx.rect(x - half, y - half, half * 2, half * 2);
            ctx.fillStyle = `rgba(${Math.round(ir)},${Math.round(ig)},${Math.round(ib)},${Math.min(0.98, eA)})`;
            ctx.fill();
          }
        }
      }

      // 4. handle: white pill, swelling slightly while dragged
      ctx.save();
      ctx.translate(px, H / 2);
      ctx.scale(thumbS, thumbS);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-THUMB_W / 2, -(H - 6) / 2, THUMB_W, H - 6, 6);
      else ctx.rect(-THUMB_W / 2, -(H - 6) / 2, THUMB_W, H - 6);
      ctx.fillStyle = "#fffefb";
      ctx.shadowColor = "rgba(60,45,25,0.28)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 1;
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = "rgba(80,75,130,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    function resize() {
      const rect = strip.getBoundingClientRect();
      const w = Math.max(80, Math.round(rect.width));
      const newDpr = Math.min(window.devicePixelRatio || 1, 2);
      if (w === W && newDpr === dpr && cols) return;
      W = w; dpr = newDpr;
      strip.width = Math.round(W * dpr);
      strip.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pitch = H / ROWS;
      cols = Math.ceil(W / pitch);
      draw();
    }

    function setP(v) {
      p = snap(v);
      const idx = Math.round(p * 3);
      strip.setAttribute("aria-valuenow", String(idx));
      strip.setAttribute("aria-valuetext", LEVEL_NAMES[idx]);
      if (valueEl) valueEl.textContent = LEVEL_NAMES[idx];
      // the running rAF loop repaints within a frame anyway — an
      // immediate draw is only needed when the loop is paused
      if (!running) draw();
    }

    function step(now) {
      if (!running) return;
      rafId = requestAnimationFrame(step);
      let dt = (now - lastT) / 1000;
      lastT = now;
      if (dt <= 0) return;
      if (dt > 0.1) dt = 0.1;
      time += dt;
      // a lit field keeps pulsing from the handle at the reference cadence
      if (time >= ambientAt) {
        fireFromHandle();
        ambientAt = time + CADENCE_LO + CADENCE_VARY * Math.random();
      }
      thumbS += ((dragging ? THUMB_SCALE_DRAG : 1) - thumbS) * Math.min(1, dt * 16);
      draw();
    }
    function start() {
      if (running || reducedMotion || !inView || document.hidden) return;
      running = true;
      lastT = performance.now();
      rafId = requestAnimationFrame(step);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
    }

    resize();
    setP(1);
    fireBurst(handleX(p), H / 2, 1); // opening blast from the handle
    if (reducedMotion) {
      // static frame: let the opening blast spread before the one draw
      time = 1.5;
      draw();
    }
    start();

    // Test-only hook: ?probe lets tooling drive the animation clock
    // directly and sample exact frames without relying on rAF.
    if (/[?&]probe\b/.test(location.search)) {
      window.__strip = {
        setTime: (t) => { time = t; draw(); },
        setP: (v) => setP(v),
        setDragging: (b) => { dragging = !!b; thumbS = dragging ? THUMB_SCALE_DRAG : 1; if (!running) draw(); },
        fire: (k) => fireBurst(handleX(p), H / 2, k == null ? 1 : k),
        fireAmbient: fireFromHandle,
        stops: STOPS,
        canvas: strip,
        state: () => ({
          running, time: +time.toFixed(3), p, px: handleX(p), inView, cols, W, dpr,
          hidden: document.hidden, reducedMotion,
          held: +(time - litAt).toFixed(3),
          sustain: +Math.min((time - sustainAt) / SUSTAIN_S, 1).toFixed(3),
          dragging, thumbS: +thumbS.toFixed(3), burstCount
        })
      };
    }

    window.addEventListener("resize", debounce(resize, 150));
    if (hasIO) {
      new IntersectionObserver((entries) => {
        inView = entries[entries.length - 1].isIntersecting;
        inView ? start() : stop();
      }, { threshold: 0 }).observe(strip);
    }
    document.addEventListener("visibilitychange", () => {
      document.hidden ? stop() : start();
    });
    rmCallbacks.push(() => { reducedMotion ? stop() : start(); draw(); });

    // drag / tap — keyed to one pointer so a second touch can't
    // steal or end an in-progress drag; a press restarts the sustain
    // ramp, phase-locks the cadence, and fires a burst at the press point
    let dragPointer = null;
    const setFromEvent = (e, burst) => {
      const rect = strip.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setP((x - THUMB_W / 2) / (rect.width - THUMB_W));
      if (burst) fireBurst(x, e.clientY - rect.top, burstGain());
    };
    strip.addEventListener("pointerdown", (e) => {
      if (dragPointer !== null) return;
      dragPointer = e.pointerId;
      strip.setPointerCapture(e.pointerId);
      strip.focus({ preventScroll: true }); // keep keyboard fine-tuning reachable
      dragging = true;
      sustainAt = time;
      ambientAt = time + CADENCE_LO;
      setFromEvent(e, true);
      if (!running) draw();
      e.preventDefault();
    });
    strip.addEventListener("pointermove", (e) => {
      if (e.pointerId === dragPointer) setFromEvent(e, false);
    });
    const endDrag = (e) => {
      if (e.pointerId !== dragPointer) return;
      dragPointer = null;
      dragging = false;
      fireBurst(handleX(p), H / 2, burstGain()); // release pulse
      if (!running) draw();
    };
    strip.addEventListener("pointerup", endDrag);
    strip.addEventListener("pointercancel", endDrag);

    // keyboard — one stop per press
    strip.addEventListener("keydown", (e) => {
      const stepSize = 1 / 3;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") setP(p + stepSize);
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") setP(p - stepSize);
      else if (e.key === "Home") setP(0);
      else if (e.key === "End") setP(1);
      else return;
      fireBurst(handleX(p), H / 2, burstGain());
      e.preventDefault();
    });
  });

  /* ----------------------------------------------------------
     8. Footer year
     ---------------------------------------------------------- */
  safe(() => {
    const year = document.getElementById("year");
    if (year) year.textContent = String(new Date().getFullYear());
  });
})();
