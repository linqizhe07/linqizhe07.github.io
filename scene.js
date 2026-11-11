/* scene.js — the world behind the windows.

   A small archipelago of paper islands in a void: one island per thing I have built or lived in.
   Islands, because FORGE searches with island-based evolution; they are tied together by chains of
   blocks. Raw WebGL, no dependencies: one static vertex buffer, one small dynamic one for whatever
   moves, and every face toned once from a fixed light (flat paper, no gradients).

   Public surface: window.Scene = { init, setTheme, setAnchors, setEffort, setMotion, marks, dbg }. */
(function () {
  'use strict';

  /* ---------- small maths ---------- */
  const TAU = Math.PI * 2;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const smooth = t => t * t * (3 - 2 * t);
  function rng(s) {
    return function () {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* 4x4 matrices, column-major like WebGL wants them. While a frame is being drawn they come out of a pool that is
     handed back whole at the next frame, so the animation leaves nothing for the garbage collector to stop for. */
  const POOL = []; let pool = null, poolN = 0;
  function mnew() {
    if (!pool) return new Float32Array(16);
    if (poolN === pool.length) pool.push(new Float32Array(16));
    return pool[poolN++];
  }
  function ident() { const m = mnew(); m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; }
  function mmul(a, b) {
    const o = mnew();
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }
  function MM() { let m = arguments[0]; for (let i = 1; i < arguments.length; i++) m = mmul(m, arguments[i]); return m; }
  function mT(x, y, z) { const m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function mS(s) { const m = ident(); m[0] = m[5] = m[10] = s; return m; }
  function mRX(a) { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
  function mRY(a) { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
  function mRZ(a) { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
  function mapply(m, p) {
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  }
  function mdir(m, d) {
    return [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
  }
  function mpersp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), m = mnew(); m.fill(0);
    m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f);
    return m;
  }
  function mlook(e, t, up) {
    const z = norm(sub(e, t)), x = norm(cross(up, z)), y = cross(z, x), m = ident();
    m[0] = x[0]; m[4] = x[1]; m[8] = x[2]; m[12] = -dot(x, e);
    m[1] = y[0]; m[5] = y[1]; m[9] = y[2]; m[13] = -dot(y, e);
    m[2] = z[0]; m[6] = z[1]; m[10] = z[2]; m[14] = -dot(z, e);
    return m;
  }

  /* ---------- colour ----------
     Every vertex carries an index into this table, so a theme is 24 uniforms and nothing is rebuilt.
     0-3 paper · 4-7 blue · 8-11 stone · 12 ink · 13-15 ember · 16 glow · 17 white · 18-19 line · 20 water · 21 turf · 22-23 brick */
  const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const THEMES = {
    dark: {
      pal: ['#f7fbff', '#c3e1fa', '#6aa8ee', '#2e66d4', '#86c2f8', '#3a7fe8', '#1b4dbf', '#0f2f8a',
        '#dbe8f5', '#a5c6e8', '#5b8fd8', '#2852b0', '#0a1f5e', '#ff9468', '#f55a30', '#bb341e',
        '#ffe6b8', '#ffffff', '#b5dcff', '#5a95e8', '#1d55c8', '#2f6fdc', '#ee8163', '#cf5238'],
      sky: '#000000', star: '#dbeeff', starA: 0.95, mote: '#cfe8ff', moteA: 0.8, grain: 0.035, fog: 1 / 430
    },
    light: {
      pal: ['#e3effc', '#b4d6f7', '#6aa8ee', '#2e66d4', '#86c2f8', '#3a7fe8', '#1b4dbf', '#0f2f8a',
        '#cfe0f3', '#a0c2e6', '#5b8fd8', '#2852b0', '#0a1f5e', '#ff8a5c', '#f0522c', '#bb341e',
        '#ffd9a0', '#ffffff', '#5a95e8', '#2e66d4', '#1d55c8', '#2f6fdc', '#e8775a', '#c8492f'],
      sky: '#f5f2e9', star: '#3a7fe8', starA: 0.4, mote: '#5a95e8', moteA: 0.55, grain: 0.022, fog: 1 / 460
    }
  };
  for (const k in THEMES) {
    const T = THEMES[k];
    T.palF = new Float32Array(72); T.pal.forEach((h, i) => T.palF.set(hex(h), i * 3));
    T.skyF = hex(T.sky); T.starF = hex(T.star); T.moteF = hex(T.mote);
  }
  const mat = (a, f) => { a.f = f | 0; return a; };
  const MAT = {
    paper: mat([0, 1, 2, 3]), blue: mat([4, 5, 6, 7]), roof: mat([5, 6, 7, 7]), iron: mat([6, 7, 12, 12]),
    stone: mat([8, 9, 10, 11]), ink: mat([12, 12, 12, 12]), ember: mat([13, 14, 15, 15]),
    glow: mat([16, 16, 16, 16], 1), white: mat([17, 17, 17, 17], 1), line: mat([18, 18, 19, 19]),
    water: mat([20, 20, 20, 20]), turf: mat([21, 21, 21, 21]), brick: mat([22, 23, 15, 15]),
    /* the same paper and thread, but out past the fog, for the orrery: it is this sky's sun */
    paperF: mat([0, 1, 2, 3], 1), blueF: mat([4, 5, 6, 7], 1), lineF: mat([19, 19, 19, 19], 1), emberF: mat([13, 14, 15, 15], 1),
    sunF: mat([16, 13, 14, 15], 1)
  };

  /* ---------- the builder: triangles with a tone ---------- */
  const LIGHT = norm([0.40, 0.62, 0.67]);
  function toneOf(l, bias) { let t = l > 0.55 ? 0 : l > 0.16 ? 1 : l > -0.38 ? 2 : 3; t += bias; return t < 0 ? 0 : t > 3 ? 3 : t; }

  function StaticOut() { this.a = []; }
  StaticOut.prototype.tri = function (A, B, C, n, m, bias) {
    const p = m[toneOf(dot(n, LIGHT), bias)], f = m.f, b = G.bob;
    this.a.push(A[0], A[1], A[2], p, f, b, B[0], B[1], B[2], p, f, b, C[0], C[1], C[2], p, f, b);
  };
  /* A part keeps its faces in its own frame, to be placed and re-toned every frame. */
  function PartOut() { this.p = []; this.n = []; this.m = []; this.b = []; }
  PartOut.prototype.tri = function (A, B, C, n, m, bias) {
    this.p.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]); this.n.push(n[0], n[1], n[2]); this.m.push(m); this.b.push(bias);
  };

  const G = { out: null, m: [ident()], bob: 0 };
  const topM = () => G.m[G.m.length - 1];
  function withM(m, fn) { G.m.push(mmul(topM(), m)); fn(); G.m.pop(); }
  const P = p => mapply(topM(), p);
  function capture(fn) {
    const o = G.out, m = G.m, b = G.bob, part = new PartOut();
    G.out = part; G.m = [ident()]; G.bob = 0; fn(); G.out = o; G.m = m; G.bob = b;
    part.p = new Float32Array(part.p); part.n = new Float32Array(part.n); part.count = part.n.length / 3;
    return part;
  }

  /* A face's normal is turned to face away from a point (o.c) or along a direction (o.n), so shading never depends on winding. */
  function orient(n, cen, o) {
    if (!o) return n;
    let d = 1;
    if (o.c) d = dot(n, sub(cen, P(o.c)));
    else if (o.n) d = dot(n, mdir(topM(), o.n));
    return d < 0 ? [-n[0], -n[1], -n[2]] : n;
  }
  function tri(a, b, c, m, o) {
    const A = P(a), B = P(b), C = P(c);
    let n = cross(sub(B, A), sub(C, A)); const l = len(n);
    if (l < 1e-9) return;
    n = orient([n[0] / l, n[1] / l, n[2] / l], [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3], o);
    G.out.tri(A, B, C, n, m, (o && o.bias) | 0);
  }
  function quad(a, b, c, d, m, o) {
    const A = P(a), B = P(b), C = P(c), D = P(d);
    let n = cross(sub(B, A), sub(D, A)), l = len(n);
    if (l < 1e-9) { n = cross(sub(C, B), sub(D, B)); l = len(n); }
    if (l < 1e-9) { n = cross(sub(B, A), sub(C, A)); l = len(n); }
    if (l < 1e-9) return;
    n = orient([n[0] / l, n[1] / l, n[2] / l], [(A[0] + B[0] + C[0] + D[0]) / 4, (A[1] + B[1] + C[1] + D[1]) / 4, (A[2] + B[2] + C[2] + D[2]) / 4], o);
    const bias = (o && o.bias) | 0;
    G.out.tri(A, B, C, n, m, bias); G.out.tri(A, C, D, n, m, bias);
  }
  function fan(ring, c, m, o) { for (let i = 0; i < ring.length; i++) tri(c, ring[i], ring[(i + 1) % ring.length], m, o); }

  /* A box standing on y0, centred in x and z. o: top, px/nx/pz/nz face materials, bottom, bias. */
  function bx(cx, y0, cz, sx, sy, sz, m, o) {
    o = o || {};
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y1 = y0 + sy, z0 = cz - sz / 2, z1 = cz + sz / 2, c = [cx, y0 + sy / 2, cz], q = { c: c, bias: o.bias | 0 };
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], o.pz || m, q);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], o.nz || m, q);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], o.px || m, q);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], o.nx || m, q);
    quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], o.top || m, q);
    if (o.bottom) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], m, q);
  }
  /* A faceted body lofted through horizontal rings [y, rx, rz?]. stripe: every other facet a tone darker (fluting);
     up/down: the faces are roofs or soffits, not walls. cap: 'top' (default), 'both', 'none'. */
  function loft(rings, n, m, o) {
    o = o || {};
    const cx = o.cx || 0, cz = o.cz || 0, rot = o.rot || 0, pts = [];
    for (const rg of rings) {
      const row = [], rz = rg[2] === undefined ? rg[1] : rg[2];
      for (let i = 0; i < n; i++) { const a = rot + i / n * TAU; row.push([cx + Math.cos(a) * rg[1], rg[0], cz + Math.sin(a) * rz]); }
      pts.push(row);
    }
    for (let j = 0; j < rings.length - 1; j++) {
      const yc = (rings[j][0] + rings[j + 1][0]) / 2;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) % n, bias = (o.bias | 0) + ((o.stripe && (i & 1)) ? o.stripe : 0);
        quad(pts[j][i], pts[j][k], pts[j + 1][k], pts[j + 1][i], (o.alt && (i & 1)) ? o.alt : m,
          o.up ? { n: [0, 1, 0], bias: bias } : o.down ? { n: [0, -1, 0], bias: bias } : { c: [cx, yc, cz], bias: bias });
      }
    }
    const cap = o.cap || 'top', L = rings.length - 1;
    if (cap === 'top' || cap === 'both') fan(pts[L], [cx, rings[L][0], cz], o.top || m, { n: [0, 1, 0] });
    if (cap === 'both') fan(pts[0], [cx, rings[0][0], cz], o.bot || m, { n: [0, -1, 0] });
  }
  /* A flat polygon lying on the ground (or a pond, or a plaza). */
  function flat(cx, y, cz, rx, rz, n, m, rot) {
    const pts = []; for (let i = 0; i < n; i++) { const a = (rot || 0) + i / n * TAU; pts.push([cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz]); }
    fan(pts, [cx, y, cz], m, { n: [0, 1, 0] });
  }
  function basis(n) { n = norm(n); const u = norm(cross(Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], n)); return [u, cross(n, u), n]; }
  /* A flat cut-out standing on a wall: 2D points in the wall's own (across, up) frame. */
  function decal(c, nrm, pts2, m, bias) {
    const b = basis(nrm), u = b[0], w = b[1]; let sx = 0, sy = 0;
    const pts = pts2.map(q => { sx += q[0]; sy += q[1]; return [c[0] + u[0] * q[0] + w[0] * q[1], c[1] + u[1] * q[0] + w[1] * q[1], c[2] + u[2] * q[0] + w[2] * q[1]]; });
    sx /= pts2.length; sy /= pts2.length;
    fan(pts, [c[0] + u[0] * sx + w[0] * sy, c[1] + u[1] * sx + w[1] * sy, c[2] + u[2] * sx + w[2] * sy], m, { n: nrm, bias: bias | 0 });
  }
  function ngon(r, n, rot) { const p = []; for (let i = 0; i < n; i++) { const a = (rot || 0) + i / n * TAU; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; }
  function archPts(w, h, seg) { const r = w / 2, p = [[-r, 0], [r, 0]]; for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI; p.push([Math.cos(a) * r, h + Math.sin(a) * r]); } return p; }
  /* A rectangle a hair proud of an axis-aligned wall: face '+z' at z=d spans x in [a0,a1]; '+x' at x=d spans z. */
  function wall(face, d, a0, a1, y0, y1, m, bias) {
    const e = 0.07, o = { bias: bias | 0 };
    if (face === '+z') { o.n = [0, 0, 1]; quad([a0, y0, d + e], [a1, y0, d + e], [a1, y1, d + e], [a0, y1, d + e], m, o); }
    else if (face === '-z') { o.n = [0, 0, -1]; quad([a0, y0, d - e], [a1, y0, d - e], [a1, y1, d - e], [a0, y1, d - e], m, o); }
    else if (face === '+x') { o.n = [1, 0, 0]; quad([d + e, y0, a0], [d + e, y0, a1], [d + e, y1, a1], [d + e, y1, a0], m, o); }
    else if (face === '-x') { o.n = [-1, 0, 0]; quad([d - e, y0, a0], [d - e, y0, a1], [d - e, y1, a1], [d - e, y1, a0], m, o); }
    else { o.n = [0, 1, 0]; quad([a0, d + e, y0], [a1, d + e, y0], [a1, d + e, y1], [a0, d + e, y1], m, o); }   /* '+y': a0..a1 in x, y0..y1 in z */
  }
  function grid(face, d, a0, a1, y0, y1, cols, rows, fw, fh, m) {
    const cw = (a1 - a0) / cols, ch = (y1 - y0) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const ca = a0 + cw * (i + 0.5), cy = y0 + ch * (j + 0.5);
      wall(face, d, ca - cw * fw / 2, ca + cw * fw / 2, cy - ch * fh / 2, cy + ch * fh / 2, m);
    }
  }
  /* A slit on facet i of an n-gon body whose radius runs from r0 (at y0) to r1 (at y1). */
  function facet(n, rot, i, r0, y0, r1, y1, wf, m) {
    const a0 = rot + i / n * TAU, a1 = rot + (i + 1) / n * TAU, e = 1.014;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1), lo = 0.5 - wf / 2, hi = 0.5 + wf / 2;
    const at = (r, t, y) => [(c0 + (c1 - c0) * t) * r * e, y, (s0 + (s1 - s0) * t) * r * e];
    quad(at(r0, lo, y0), at(r0, hi, y0), at(r1, hi, y1), at(r1, lo, y1), m, { n: [c0 + c1, 0, s0 + s1] });
  }
  function tube(a, b, r, m, sides, bias) {
    sides = sides || 4;
    const d = norm(sub(b, a)), x = norm(cross(Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0], d)), y = cross(d, x), ra = [], rb = [];
    for (let i = 0; i < sides; i++) {
      const an = i / sides * TAU + 0.6, cx = Math.cos(an) * r, sy = Math.sin(an) * r, off = [x[0] * cx + y[0] * sy, x[1] * cx + y[1] * sy, x[2] * cx + y[2] * sy];
      ra.push(add(a, off)); rb.push(add(b, off));
    }
    const mid = mix(a, b, 0.5);
    for (let i = 0; i < sides; i++) { const k = (i + 1) % sides; quad(ra[i], ra[k], rb[k], rb[i], m, { c: mid, bias: bias | 0 }); }
  }
  function hoop(R, r, seg, m, sides) {
    for (let i = 0; i < seg; i++) { const a = i / seg * TAU, b = (i + 1) / seg * TAU; tube([Math.cos(a) * R, 0, Math.sin(a) * R], [Math.cos(b) * R, 0, Math.sin(b) * R], r, m, sides || 3); }
  }
  /* thin strips drawn on the plane z = const (facing +z): a plotted line on a board */
  function strip(z, pts, w, m) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2;
      quad([a[0] - nx, a[1] - ny, z], [b[0] - nx, b[1] - ny, z], [b[0] + nx, b[1] + ny, z], [a[0] + nx, a[1] + ny, z], m, { n: [0, 0, 1] });
    }
  }
  const ICO = (function () {
    const t = (1 + Math.sqrt(5)) / 2;
    const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
    const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const lv = [F.map(f => f.map(i => V[i]))];
    for (let s = 0; s < 2; s++) {
      const nt = [];
      for (const f of lv[s]) {
        const a = f[0], b = f[1], c = f[2], ab = norm(add(a, b)), bc = norm(add(b, c)), ca = norm(add(c, a));
        nt.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      lv.push(nt);
    }
    return lv;
  })();
  function ico(c, r, m, sub_, o) {
    o = o || {}; const sy = o.sy || 1; let i = 0;
    for (const f of ICO[sub_ || 0]) {
      const mm = o.pick ? o.pick(i++) : m;
      tri([c[0] + f[0][0] * r, c[1] + f[0][1] * r * sy, c[2] + f[0][2] * r], [c[0] + f[1][0] * r, c[1] + f[1][1] * r * sy, c[2] + f[1][2] * r],
        [c[0] + f[2][0] * r, c[1] + f[2][1] * r * sy, c[2] + f[2][2] * r], mm, { c: c, bias: o.bias | 0 });
    }
  }
  /* A pitched house: w along x, d along z, ridge along `axis`. */
  function house(cx, y0, cz, w, h, d, rh, axis, wm, rm) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h, yr = y1 + rh, c = [cx, y0 + h / 2, cz], q = { c: c }, ov = 0.4, up = { n: [0, 1, 0] };
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], wm, q); quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], wm, q);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], wm, q); quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], wm, q);
    if (axis === 'x') {
      const dy = ov * rh / (d / 2);
      tri([x1, y1, z1], [x1, y1, z0], [x1, yr, cz], wm, q); tri([x0, y1, z0], [x0, y1, z1], [x0, yr, cz], wm, q);
      quad([x0 - ov, y1 - dy, z1 + ov], [x1 + ov, y1 - dy, z1 + ov], [x1 + ov, yr, cz], [x0 - ov, yr, cz], rm, up);
      quad([x0 - ov, y1 - dy, z0 - ov], [x1 + ov, y1 - dy, z0 - ov], [x1 + ov, yr, cz], [x0 - ov, yr, cz], rm, up);
    } else {
      const dy = ov * rh / (w / 2);
      tri([x0, y1, z1], [x1, y1, z1], [cx, yr, z1], wm, q); tri([x1, y1, z0], [x0, y1, z0], [cx, yr, z0], wm, q);
      quad([x1 + ov, y1 - dy, z0 - ov], [x1 + ov, y1 - dy, z1 + ov], [cx, yr, z1 + ov], [cx, yr, z0 - ov], rm, up);
      quad([x0 - ov, y1 - dy, z0 - ov], [x0 - ov, y1 - dy, z1 + ov], [cx, yr, z1 + ov], [cx, yr, z0 - ov], rm, up);
    }
  }
  /* A roof that leans in on all four sides. */
  function hip(cx, cz, y0, y1, w0, d0, w1, d1, m) {
    const a = [[cx - w0 / 2, y0, cz - d0 / 2], [cx + w0 / 2, y0, cz - d0 / 2], [cx + w0 / 2, y0, cz + d0 / 2], [cx - w0 / 2, y0, cz + d0 / 2]];
    const b = [[cx - w1 / 2, y1, cz - d1 / 2], [cx + w1 / 2, y1, cz - d1 / 2], [cx + w1 / 2, y1, cz + d1 / 2], [cx - w1 / 2, y1, cz + d1 / 2]];
    for (let i = 0; i < 4; i++) { const k = (i + 1) % 4; quad(a[i], a[k], b[k], b[i], m, { c: [cx, (y0 + y1) / 2, cz] }); }
    quad(b[0], b[1], b[2], b[3], m, { n: [0, 1, 0] });
  }

  /* ---------- the world ---------- */
  const ISL = {
    forge: { p: [0, 0, 0], R: 27, d: 30, seed: 7, bob: 1, ry: 0 },
    robot: { p: [50, -6, -12], R: 19, d: 21, seed: 19, bob: 2, ry: -0.69 },
    bounty: { p: [74, 2, -46], R: 12, d: 15, seed: 31, bob: 3, ry: -0.65 },
    hz: { p: [-44, 7, -58], R: 22, d: 24, seed: 43, bob: 4, ry: 0.2 },
    phl: { p: [-53, -5, 0], R: 21, d: 20, seed: 59, bob: 5, ry: 0.63 },
    pitch: { p: [40, -12, 34], R: 14, d: 14, seed: 71, bob: 6, ry: -0.57 },
    gravit: { p: [40, 48, -26], R: 6.5, d: 12, seed: 83, bob: 7, ry: 0.3 }
  };
  const ISLM = {};
  for (const k in ISL) ISLM[k] = MM(mT(ISL[k].p[0], ISL[k].p[1], ISL[k].p[2]), mRY(ISL[k].ry));
  const TH = 0.4;                     /* which way the furnace is tapped */
  const FM = mmul(ISLM.forge, mRY(TH)), GM = ISLM.gravit;   /* the ironworks' own frame, and the orrery's */
  const anim = [];                    /* things that move: fn(t, emit) */

  /* A floating rock: a bright rim, then facets closing to a point underneath. */
  function rock(R, depth, seed) {
    const n = 13, rnd = rng(seed), top = [], sh = [], belly = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + (rnd() - 0.5) * 0.2, r = R * (0.9 + rnd() * 0.16), a2 = a + (rnd() - 0.5) * 0.35, r2 = R * (0.36 + rnd() * 0.24);
      top.push([Math.cos(a) * r, 0, Math.sin(a) * r]);
      sh.push([Math.cos(a) * r * 0.93, -depth * (0.1 + rnd() * 0.07), Math.sin(a) * r * 0.93]);
      belly.push([Math.cos(a2) * r2, -depth * (0.46 + rnd() * 0.24), Math.sin(a2) * r2]);
    }
    const tip = [(rnd() - 0.5) * R * 0.3, -depth, (rnd() - 0.5) * R * 0.3], c = [0, -depth * 0.3, 0];
    fan(top, [0, 0, 0], MAT.stone, { n: [0, 1, 0] });
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      quad(top[i], top[k], sh[k], sh[i], MAT.paper, { c: c });
      quad(sh[i], sh[k], belly[k], belly[i], MAT.stone, { c: c, bias: 1 });
      tri(belly[i], belly[k], tip, MAT.stone, { c: c, bias: 1 });
    }
  }
  function at(x, y, z, fn, ry) { withM(ry ? MM(mT(x, y, z), mRY(ry)) : mT(x, y, z), fn); }
  const sq = h => [[-h, -h], [h, -h], [h, h], [-h, h]];
  const rect2 = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  function lantern(x, z) {
    tube([x, 0, z], [x, 3.8, z], 0.12, MAT.paper, 4);
    bx(x, 3.8, z, 0.7, 0.7, 0.7, MAT.glow); hip(x, z, 4.5, 5.0, 1.2, 1.2, 0.2, 0.2, MAT.blue);
  }
  /* trees: a dawn redwood, a weeping willow, a peach in blossom, a broad crown in autumn, bamboo */
  function redwood(x, z, h) { tube([x, 0, z], [x, h * 0.2, z], 0.18, MAT.paper, 4); loft([[h * 0.16, h * 0.17], [h * 0.5, h * 0.13], [h, 0.02]], 6, MAT.blue, { cx: x, cz: z, cap: 'none', stripe: 1 }); }
  function willow(x, z, h, turn) {
    tube([x, 0, z], [x, h * 0.66, z], 0.2, MAT.paper, 4);
    loft([[h * 0.62, h * 0.3], [h * 0.84, h * 0.26], [h, h * 0.08]], 9, MAT.blue, { cx: x, cz: z, rot: turn });
    for (let i = 0; i < 9; i++) {
      const a = turn + (i + 0.5) / 9 * TAU, c = Math.cos(a), s = Math.sin(a), r = h * 0.29, w = h * 0.075, L = h * (0.36 + ((i * 5) % 3) * 0.08), y = h * 0.64;
      quad([x + c * r - s * w, y, z + s * r + c * w], [x + c * r + s * w, y, z + s * r - c * w],
        [x + c * r * 1.14 + s * w * 0.3, y - L, z + s * r * 1.14 - c * w * 0.3], [x + c * r * 1.14 - s * w * 0.3, y - L, z + s * r * 1.14 + c * w * 0.3], (i & 1) ? MAT.roof : MAT.blue, { c: [x, y, z] });
    }
  }
  function peach(x, z, h) {
    tube([x, 0, z], [x, h * 0.5, z], 0.13, MAT.paper, 4);
    ico([x - h * 0.1, h * 0.68, z], h * 0.27, MAT.brick, 0, { sy: 0.85 }); ico([x + h * 0.14, h * 0.8, z + h * 0.05], h * 0.21, MAT.brick, 0, { sy: 0.85 });
  }
  function maple(x, z, h, m) {
    tube([x, 0, z], [x, h * 0.55, z], 0.2, MAT.paper, 4);
    ico([x, h * 0.74, z], h * 0.3, m, 0, { sy: 0.86 }); ico([x - h * 0.2, h * 0.6, z + h * 0.07], h * 0.21, m, 0); ico([x + h * 0.2, h * 0.63, z - h * 0.06], h * 0.23, m, 0);
  }
  function bamboo(x, z, n, seed) {
    const rnd = rng(seed);
    for (let i = 0; i < n; i++) {
      const x0 = x + (rnd() - 0.5) * 2.6, z0 = z + (rnd() - 0.5) * 2.6, h = 5 + rnd() * 3, lx = (rnd() - 0.5) * 1.3, lz = (rnd() - 0.5) * 1.3;
      tube([x0, 0, z0], [x0 + lx, h, z0 + lz], 0.09, MAT.paper, 3);
      for (let k = 0; k < 3; k++) {
        const t = 0.55 + k * 0.17, px = x0 + lx * t, py = h * t, pz = z0 + lz * t, a = rnd() * TAU, L = 1.2 + rnd() * 0.7;
        tri([px, py, pz], [px + Math.cos(a) * L, py + 0.55, pz + Math.sin(a) * L], [px + Math.cos(a + 0.55) * L * 0.8, py - 0.2, pz + Math.sin(a + 0.55) * L * 0.8], MAT.blue, { n: [0, 1, 0] });
      }
    }
  }

  /* FORGE: an ironworks of the kind Pennsylvania was built on (Hopewell, Valley Forge). A stone furnace stands against
     its bank and is charged from above, across a bridge; it is tapped below into a bed of moulds, and a tilt hammer
     works what comes out. Rewards go in at the top; every cast is a generation. */
  function crag(cx, cz, R, H, seed) {
    const n = 9, rnd = rng(seed), lv = [[0, 1], [0.34, 0.9], [0.7, 0.7], [1, 0.52]], rows = [];
    for (let j = 0; j < lv.length; j++) {
      const row = [];
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + (rnd() - 0.5) * 0.25, r = R * lv[j][1] * (0.88 + rnd() * 0.24);
        row.push([cx + Math.cos(a) * r, H * lv[j][0] + (j === 1 || j === 2 ? (rnd() - 0.5) * H * 0.08 : 0), cz + Math.sin(a) * r]);
      }
      rows.push(row);
    }
    const c = [cx, H * 0.4, cz];
    for (let j = 0; j < lv.length - 1; j++) for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      tri(rows[j][i], rows[j][k], rows[j + 1][k], MAT.stone, { c: c, bias: j === 0 ? 1 : 0 });
      tri(rows[j][i], rows[j + 1][k], rows[j + 1][i], MAT.stone, { c: c, bias: (i & 1) ? 1 : 0 });
    }
    fan(rows[lv.length - 1], [cx, H, cz], MAT.paper, { n: [0, 1, 0] });
  }
  function forgeIsle() {
    flat(0, 0.05, 2, 20.5, 19.5, 24, MAT.paper);
    withM(mRY(TH), function () {
      crag(0, -17.5, 10, 23.4, 11);
      /* the stack: battered stone, a brick mouth */
      bx(0, 0, 0, 21, 1, 21, MAT.stone, { top: MAT.paper });
      hip(0, 0, 1, 21, 17, 17, 10.6, 10.6, MAT.stone);
      bx(0, 21, 0, 11.8, 0.7, 11.8, MAT.paper);
      bx(0, 21.7, 0, 8.6, 2.6, 8.6, MAT.brick);
      wall('+y', 24.3, -3.3, 3.3, -3.3, 3.3, MAT.ink); wall('+y', 24.36, -2.3, 2.3, -2.3, 2.3, MAT.glow);
      const faceN = [[0, 0.158, 0.987], [0.987, 0.158, 0], [0, 0.158, -0.987], [-0.987, 0.158, 0]];
      const onStack = function (s, a, y, pts, m, bias, lift) {
        const r = 8.5 - (y - 1) * 0.16 + (lift || 0.07);
        decal(s === 0 ? [a, y, r] : s === 1 ? [r, y, -a] : s === 2 ? [-a, y, -r] : [-r, y, a], faceN[s], pts, m, bias);
      };
      const rb = rng(29);                 /* a stone here and there, a tone down: it is laid, not poured */
      for (let s = 0; s < 4; s++) for (let i = 0; i < 10; i++) {
        const y = 2.6 + rb() * 17, half = 8.5 - (y - 1) * 0.16 - 1.5;
        onStack(s, (rb() * 2 - 1) * half, y, rect2(1.3 + rb() * 1.4, 0.55 + rb() * 0.35), MAT.stone, 1, 0.04);
      }
      for (let s = 0; s < 4; s++) [-2.5, 0, 2.5].forEach(a => onStack(s, a, 17.6, sq(0.42), MAT.ink));
      bx(0, 14.6, 0, 13.1, 0.45, 13.1, MAT.paper);
      /* its name, cast in iron and set in the stack */
      const FONT = { F: '11111100001000011110100001000010000', O: '01110100011000110001100011000101110', R: '11110100011000111110101001001010001', G: '01111100001000010111100011000101111', E: '11111100001000011110100001000011111' };
      onStack(0, 0, 12.3, rect2(5.9, 1.9), MAT.ink);
      'FORGE'.split('').forEach(function (ch, g) {
        const bits = FONT[ch], s = 0.17;
        for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (bits.charAt(r * 5 + c) === '1')
          onStack(0, -2.465 + g * 1.02 + (c + 0.5) * s, 12.3 + 0.595 - (r + 0.5) * s, sq(s / 2), MAT.glow, 0, 0.11);
      });
      /* the charging floor round the mouth, and its rail */
      bx(0, 21.7, 0, 13.6, 0.3, 13.6, MAT.paper);
      for (let i = 0; i < 4; i++) withM(mRY(i * TAU / 4), function () {
        tube([-6.6, 23.0, 6.6], [6.6, 23.0, 6.6], 0.07, MAT.blue, 3);
        [-6.6, -3.3, 0, 3.3].forEach(x => bx(x, 22.0, 6.6, 0.16, 1.0, 0.16, MAT.blue));
      });
      /* the casting arch, and the two the blast comes in by */
      bx(0, 1, 8.9, 8.6, 8.4, 1.8, MAT.stone, { top: MAT.paper });
      decal([0, 1.25, 9.87], [0, 0, 1], archPts(5.8, 3.3, 12), MAT.ink);
      decal([0, 1.25, 9.92], [0, 0, 1], archPts(4.4, 2.6, 12), MAT.ember, 1);
      decal([0, 1.25, 9.97], [0, 0, 1], archPts(3.0, 2.0, 10), MAT.ember);
      decal([0, 1.25, 10.02], [0, 0, 1], archPts(1.7, 1.3, 8), MAT.glow);
      [-1, 1].forEach(function (d) {
        bx(d * 8.9, 1, 0, 1.8, 6.6, 6.6, MAT.stone, { top: MAT.paper });
        decal([d * 9.87, 1.25, 0], [d, 0, 0], archPts(3.6, 2.2, 10), MAT.ink);
        decal([d * 9.92, 1.25, 0], [d, 0, 0], archPts(2.0, 1.4, 8), MAT.ember, 1);
      });
      /* the blowing tubs */
      bx(14.2, 0, -3.2, 3.4, 2.2, 3.0, MAT.blue, { top: MAT.paper });
      loft([[2.2, 0.9], [4.0, 0.9]], 8, MAT.paper, { cx: 13.4, cz: -3.2 }); loft([[2.2, 0.9], [3.3, 0.9]], 8, MAT.paper, { cx: 15.1, cz: -3.2 });
      tube([12.4, 1.5, -3.0], [10.0, 2.3, -0.8], 0.3, MAT.iron, 5);
      /* the cast house: a roof over the tap, open to the bed of moulds; one runner and a comb of pigs */
      bx(0, 0, 16.2, 11.6, 1, 12.8, MAT.stone, { top: MAT.paper });
      [[-5.6, 10.9], [5.6, 10.9], [-5.6, 16.0], [5.6, 16.0]].forEach(q => bx(q[0], 1, q[1], 0.5, 5.4, 0.5, MAT.blue));
      [-1, 1].forEach(function (d) {
        quad([d * 6.9, 6.2, 9.9], [d * 6.9, 6.2, 16.9], [0, 9.5, 16.9], [0, 9.5, 9.9], MAT.roof, { n: [0, 1, 0] });
        quad([d * 6.7, 6.1, 9.95], [d * 6.7, 6.1, 16.85], [0, 9.32, 16.85], [0, 9.32, 9.95], MAT.roof, { n: [0, -1, 0], bias: 2 });
      });
      bx(0, 6.0, 16.6, 12.6, 0.4, 0.4, MAT.paper); bx(0, 6.4, 16.6, 0.4, 2.7, 0.4, MAT.paper);
      wall('+y', 1, -0.3, 0.3, 10.0, 21.7, MAT.ember);
      for (let k = 0; k < 7; k++) { const z = 14.9 + k * 1.05; wall('+y', 1, 0.3, 3.9, z - 0.24, z + 0.24, MAT.iron); wall('+y', 1, -3.9, -0.3, z - 0.24, z + 0.24, MAT.iron); }
      /* the bank: a charcoal barn, the charge stacked by it, and the bridge the charge crosses */
      at(0, 23.4, -18.4, function () {
        house(0, 0, 0, 5.6, 2.6, 4.2, 1.9, 'x', MAT.paper, MAT.roof);
        wall('+z', 2.1, -0.8, 0.8, 0, 1.9, MAT.ink);
      });
      bx(3.0, 23.4, -14.7, 1.0, 1.0, 1.0, MAT.paper); bx(3.2, 24.4, -14.9, 0.8, 0.8, 0.8, MAT.blue); bx(-2.9, 23.4, -14.5, 1.1, 1.1, 1.1, MAT.blue);
      quad([-1.3, 23.5, -12.8], [1.3, 23.5, -12.8], [1.3, 24.45, -4.5], [-1.3, 24.45, -4.5], MAT.paper, { n: [0, 1, 0] });
      quad([-1.3, 23.3, -12.8], [1.3, 23.3, -12.8], [1.3, 24.25, -4.5], [-1.3, 24.25, -4.5], MAT.stone, { n: [0, -1, 0], bias: 1 });
      [-1.3, 1.3].forEach(function (x) {
        tube([x, 24.4, -12.8], [x, 25.35, -4.5], 0.07, MAT.blue, 3);
        for (let i = 0; i <= 4; i++) { const t = i / 4; tube([x, 23.5 + t * 0.95, -12.8 + t * 8.3], [x, 24.4 + t * 0.95, -12.8 + t * 8.3], 0.07, MAT.blue, 3); }
        tube([x * 0.85, 23.9, -8.4], [x * 1.9, 19.0, -11.6], 0.15, MAT.blue, 4);
      });
      /* the tilt hammer's bed: the anvil, the piece in work, the posts the helve and the cam turn on */
      at(11.8, 0, 13.4, function () {
        bx(-3.6, 0, 0, 2.8, 1.4, 2.8, MAT.stone, { top: MAT.paper });
        bx(-3.6, 1.4, 0, 2.0, 0.9, 1.5, MAT.iron); bx(-3.6, 2.3, 0, 1.6, 0.22, 0.42, MAT.glow);
        [-1.05, 1.05].forEach(z => bx(1.2, 0, z, 0.5, 4.9, 0.5, MAT.blue));
        [-1.5, 1.5].forEach(z => bx(5.7, 0, z, 0.5, 6.4, 0.5, MAT.blue));
        tube([5.7, 5.9, -1.9], [5.7, 5.9, 2.9], 0.14, MAT.iron, 5);
      });
      /* quench trough, bar iron, ore */
      at(11.6, 0, 19.6, function () { bx(0, 0, 0, 4.4, 1.2, 1.9, MAT.blue); wall('+y', 1.2, -1.9, 1.9, -0.65, 0.65, MAT.water); }, 0.3);
      at(-9.6, 0, 17.2, function () {
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) bx(-1.1 + j * 1.1 + i * 0.55, i * 0.5, 0, 0.9, 0.5, 3.6, (i + j) % 2 ? MAT.blue : MAT.paper);
      }, -0.25);
      const rnd = rng(5);
      for (let i = 0; i < 7; i++) ico([-13.4 + rnd() * 2.6, 0.4 + (i > 4 ? 0.7 : 0), 9.2 + rnd() * 2.2], 0.55 + rnd() * 0.3, MAT.iron, 0);
      /* the office, the store */
      at(-16.4, 0, 2.2, function () {
        house(0, 0, 0, 6.2, 3.8, 5.0, 2.4, 'x', MAT.paper, MAT.roof);
        wall('+z', 2.5, -0.8, 0.8, 0, 2.5, MAT.ink); wall('+z', 2.5, 1.6, 2.6, 1.4, 2.5, MAT.glow); wall('+z', 2.5, -2.6, -1.6, 1.4, 2.5, MAT.ink);
        bx(1.8, 4.4, -0.9, 0.9, 2.5, 0.9, MAT.brick);
      }, 0.3);
      at(17, 0, -9.6, function () {
        house(0, 0, 0, 5.2, 3.3, 6.6, 2.1, 'z', MAT.paper, MAT.roof);
        wall('+z', 3.3, -0.7, 0.7, 0, 2.2, MAT.ink); grid('+x', 2.6, -2.4, 2.4, 1.2, 2.5, 3, 1, 0.42, 1, MAT.ink);
      }, -0.5);
      redwood(-11, -11.5, 8); redwood(11.8, -14.2, 9.5); redwood(-14, -6.2, 6.5); redwood(7.6, -21.4, 7);
      lantern(-7.6, 20.6); lantern(7.6, 21.4); lantern(-20.5, -3); lantern(21.5, 4.5);
    });
  }

  /* ROBOTS: a lab floor. A humanoid walks a treadmill (locomotion policies), an arm sorts cubes (GRASP), a curve climbs on the board. */
  function robotIsle() {
    bx(0, 0, 0, 27, 0.5, 18, MAT.stone, { top: MAT.paper });
    [[0, 8.3, 25.6, 0.35], [0, -8.3, 25.6, 0.35], [12.6, 0, 0.35, 16.9], [-12.6, 0, 0.35, 16.9]].forEach(s => wall('+y', 0.5, s[0] - s[2] / 2, s[0] + s[2] / 2, s[1] - s[3] / 2, s[1] + s[3] / 2, MAT.blue));
    /* treadmill */
    bx(-4, 0.5, 1.5, 4.8, 0.9, 10.6, MAT.blue); wall('+y', 1.4, -5.8, -2.2, -3.3, 6.3, MAT.ink);
    bx(-7.6, 0.5, 6.2, 0.3, 3.3, 0.3, MAT.paper); bx(-7.6, 3.6, 6.2, 1.7, 1.1, 0.3, MAT.blue); wall('+z', 6.35, -8.2, -7.0, 3.82, 4.48, MAT.glow);
    /* the arm's stand and its table of cubes */
    loft([[0.5, 1.7], [1.1, 1.5]], 8, MAT.blue, { cx: 6.5, cz: 2 }); loft([[1.1, 1.05], [1.9, 1.0]], 8, MAT.paper, { cx: 6.5, cz: 2 });
    bx(6.5, 0.5, 7, 5.2, 1.3, 2.6, MAT.blue, { top: MAT.paper });
    bx(5.1, 1.8, 7, 0.9, 0.9, 0.9, MAT.paper); bx(6.4, 1.8, 7.2, 0.9, 0.9, 0.9, MAT.blue); bx(7.8, 1.8, 6.9, 0.9, 0.9, 0.9, MAT.paper); bx(6.5, 2.7, 7.1, 0.9, 0.9, 0.9, MAT.paper);
    /* racks */
    [[-10.4, -4.6, 0.25], [-7.4, -5.6, 0.1]].forEach(function (r) {
      withM(MM(mT(r[0], 0.5, r[1]), mRY(r[2])), function () {
        bx(0, 0, 0, 2.3, 5.8, 1.9, MAT.blue);
        grid('+z', 0.95, -0.85, 0.5, 0.5, 5.4, 1, 7, 1, 0.42, MAT.ink);
        for (let j = 0; j < 7; j++) wall('+z', 0.95, 0.68, 0.9, 0.72 + j * 0.7, 0.9 + j * 0.7, j % 3 === 1 ? MAT.glow : MAT.paper);
      });
    });
    /* the board: a reward curve, and the baseline under it */
    withM(mT(3.6, 0.5, -6.7), function () {
      bx(-4.5, 0, 0, 0.4, 7.4, 0.4, MAT.blue); bx(4.5, 0, 0, 0.4, 7.4, 0.4, MAT.blue);
      bx(0, 1.7, 0, 9.8, 6.0, 0.36, MAT.paper, { nz: MAT.blue });
      const z = 0.26, X = t => -4.1 + t * 8.2, Y = t => 2.3 + t * 4.6;
      strip(z, [[X(0), Y(1.02)], [X(0), Y(0)], [X(1.02), Y(0)]], 0.12, MAT.ink);
      strip(z, [[0, 0.12], [0.14, 0.2], [0.28, 0.24], [0.42, 0.3], [0.58, 0.33], [0.74, 0.36], [0.9, 0.37], [1, 0.38]].map(q => [X(q[0]), Y(q[1])]), 0.13, MAT.blue);
      strip(z + 0.02, [[0, 0.1], [0.1, 0.16], [0.2, 0.2], [0.3, 0.44], [0.42, 0.5], [0.52, 0.56], [0.62, 0.78], [0.76, 0.84], [0.88, 0.94], [1, 0.97]].map(q => [X(q[0]), Y(q[1])]), 0.2, MAT.ember);
    });
    bx(10.6, 0.5, -3, 2.1, 2.1, 2.1, MAT.paper); bx(10.9, 2.6, -3.2, 1.4, 1.4, 1.4, MAT.blue); bx(8.2, 0.5, -3.8, 1.5, 1.5, 1.5, MAT.blue);
  }

  /* BOUNTY: a notice board of posted work, the agents reading it, a coin turning over it. */
  function bot(x, z, ry, m) {
    withM(MM(mT(x, 0, z), mRY(ry)), function () {
      bx(-0.33, 0, 0, 0.36, 0.75, 0.42, MAT.blue); bx(0.33, 0, 0, 0.36, 0.75, 0.42, MAT.blue);
      bx(0, 0.75, 0, 1.25, 1.35, 0.9, m); bx(0, 2.2, 0, 1.0, 0.9, 0.85, m);
      wall('+z', 0.425, -0.36, 0.36, 2.42, 2.84, MAT.ink);
      tube([0, 3.1, 0], [0, 3.7, 0], 0.05, MAT.blue, 3); ico([0, 3.8, 0], 0.16, MAT.ember, 0);
    });
  }
  function bountyIsle() {
    flat(0, 0.05, 1, 8.6, 7.4, 16, MAT.paper);
    withM(mT(0, 0, -3), function () {
      bx(-5.9, 0, 0, 0.55, 9.0, 0.55, MAT.blue); bx(5.9, 0, 0, 0.55, 9.0, 0.55, MAT.blue);
      bx(0, 2.3, 0, 11.4, 6.2, 0.5, MAT.blue, { pz: MAT.roof });
      house(0, 8.6, 0, 12.6, 0.3, 1.6, 1.3, 'x', MAT.paper, MAT.paper);
      const rnd = rng(77);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
        if (i === 2 && j === 1) continue;
        withM(MM(mT(-3.9 + i * 2.6 + (rnd() - 0.5) * 0.4, 3.95 + j * 2.9 + (rnd() - 0.5) * 0.3, 0.33), mRZ((rnd() - 0.5) * 0.28)), function () {
          quad([-0.95, -1.2, 0], [0.95, -1.2, 0], [0.95, 1.2, 0], [-0.95, 1.2, 0], MAT.paper, { n: [0, 0, 1] });
          for (let k = 0; k < 3; k++) quad([-0.65, 0.62 - k * 0.42, 0.04], [0.65 - (k === 2 ? 0.5 : 0), 0.62 - k * 0.42, 0.04], [0.65 - (k === 2 ? 0.5 : 0), 0.76 - k * 0.42, 0.04], [-0.65, 0.76 - k * 0.42, 0.04], MAT.blue, { n: [0, 0, 1] });
          if ((i + j) % 2 === 0) quad([0.2, -0.95, 0.04], [0.7, -0.95, 0.04], [0.7, -0.45, 0.04], [0.2, -0.45, 0.04], MAT.ember, { n: [0, 0, 1] });
        });
      }
    });
    bot(-3.2, 2.2, Math.PI + 0.3, MAT.paper); bot(0.6, 3.6, Math.PI - 0.1, MAT.blue); bot(3.6, 1.8, Math.PI - 0.4, MAT.paper); bot(-0.9, 6.4, Math.PI + 0.1, MAT.paper);
  }

  /* HANGZHOU: West Lake. A pagoda on its hill above rows of tea; the causeway and its moon bridge; the three stone
     lanterns in the water; and the gate of the academy Zhejiang University grew from. Where I studied first. */
  function pagoda() {
    const R = TAU / 16;
    loft([[0, 8.8], [1.1, 8.4]], 8, MAT.stone, { rot: R, top: MAT.paper });
    loft([[1.1, 6.9], [1.9, 6.7]], 8, MAT.stone, { rot: R, top: MAT.paper });
    let y = 1.9;
    for (let i = 0; i < 6; i++) {
      const r = 5.0 - i * 0.52, h = 3.5 - i * 0.12, r2 = 5.0 - (i + 1) * 0.52;
      loft([[y, r], [y + h, r]], 8, MAT.paper, { rot: R, cap: 'none', stripe: 1 });
      for (let k = 0; k < 8; k += 2) facet(8, R, k + (i & 1), r, y + h * 0.2, r, y + h * 0.72, 0.3, MAT.ink);
      y += h;
      loft([[y - 0.3, r], [y - 0.25, r + 2.5]], 8, MAT.roof, { rot: R, cap: 'none', down: 1, bias: 1 });
      loft([[y - 0.25, r + 2.5], [y + 0.15, r + 2.0], [y + 1.25, r2 + 0.3]], 8, MAT.roof, { rot: R, cap: 'none', up: 1 });
      loft([[y - 0.25, r + 2.5], [y + 0.3, r + 3.05]], 8, MAT.blue, { rot: R, cap: 'none', up: 1 });
      y += 1.25;
    }
    loft([[y, 1.1], [y + 0.6, 0.5], [y + 3.2, 0.28], [y + 6.2, 0.04]], 8, MAT.blue, { cap: 'none' });
    for (let k = 0; k < 3; k++) loft([[y + 1.2 + k * 1.1, 0.95 - k * 0.2], [y + 1.45 + k * 1.1, 0.95 - k * 0.2]], 8, MAT.paper, { cap: 'both' });
    ico([0, y + 6.6, 0], 0.5, MAT.ember, 0);
    return y + 7;
  }
  function moonBridge(cx, cz, half, rise, w) {
    const R = (half * half + rise * rise) / (2 * rise), cy = rise - R, phi = Math.asin(half / R), seg = 9, t = 0.7, hw = w / 2;
    for (let i = 0; i < seg; i++) {
      const a = -phi + i / seg * 2 * phi, b = -phi + (i + 1) / seg * 2 * phi;
      const o0 = [cx + Math.sin(a) * R, cy + Math.cos(a) * R], o1 = [cx + Math.sin(b) * R, cy + Math.cos(b) * R];
      const i0 = [cx + Math.sin(a) * (R - t), cy + Math.cos(a) * (R - t)], i1 = [cx + Math.sin(b) * (R - t), cy + Math.cos(b) * (R - t)];
      quad([o0[0], o0[1], cz - hw], [o1[0], o1[1], cz - hw], [o1[0], o1[1], cz + hw], [o0[0], o0[1], cz + hw], MAT.paper, { n: [0, 1, 0] });
      quad([i0[0], i0[1], cz - hw], [i1[0], i1[1], cz - hw], [i1[0], i1[1], cz + hw], [i0[0], i0[1], cz + hw], MAT.stone, { n: [0, -1, 0], bias: 1 });
      quad([o0[0], o0[1], cz + hw], [o1[0], o1[1], cz + hw], [i1[0], i1[1], cz + hw], [i0[0], i0[1], cz + hw], MAT.stone, { n: [0, 0, 1] });
      quad([o0[0], o0[1], cz - hw], [o1[0], o1[1], cz - hw], [i1[0], i1[1], cz - hw], [i0[0], i0[1], cz - hw], MAT.stone, { n: [0, 0, -1] });
      if (i > 0) { bx(o0[0], o0[1], cz + hw - 0.12, 0.2, 0.75, 0.2, MAT.blue); bx(o0[0], o0[1], cz - hw + 0.12, 0.2, 0.75, 0.2, MAT.blue); }
    }
  }
  /* 求是, "seek the truth": the motto on the gate, as the page's own pixel face draws it (12 x 12 each) */
  const QIUSHI = [
    '000001001000000001000100111111111110000001000000010001000100001001101000000001010000000011001000001101000100110001000010000111000000000000000000',
    '011111111100010000000100011111111100010000000100011111111100000000000000111111111110001001000000001001111100010111000000100000111110000000000000'
  ];
  /* one of the three stone lanterns that stand in the lake (三潭印月): lit, each puts a moon on the water */
  function stoneLantern(x, z) {
    at(x, 0, z, function () {
      loft([[0.06, 0.46], [0.55, 0.32]], 6, MAT.paper);
      loft([[0.55, 0.3], [0.92, 0.84], [1.6, 0.84], [1.95, 0.36]], 8, MAT.paper, { cap: 'none', rot: TAU / 16 });
      for (let i = 0; i < 8; i += 2) facet(8, TAU / 16, i, 0.84, 1.0, 0.84, 1.52, 0.5, MAT.glow);
      loft([[1.95, 1.0], [2.2, 0.16]], 6, MAT.roof, { cap: 'none', up: 1 });
      loft([[2.2, 0.2], [2.55, 0.26], [3.0, 0.03]], 6, MAT.paper, { cap: 'none' });
    });
  }
  function swan(x, z, ry) {
    at(x, 0.1, z, function () {
      ico([0, 0.26, 0], 0.5, MAT.ink, 0, { sy: 0.55 });
      tube([0.3, 0.36, 0], [0.56, 1.0, 0], 0.08, MAT.ink, 4); tube([0.56, 1.0, 0], [0.82, 0.88, 0], 0.08, MAT.ink, 4);
      tri([0.8, 0.95, -0.07], [0.8, 0.95, 0.07], [1.08, 0.82, 0], MAT.ember, { n: [0, 1, 0] });
    }, ry);
  }
  function hzIsle() {
    /* West Lake */
    flat(3, 0.06, 7.2, 12.6, 8.3, 20, MAT.water, 0.2); flat(-7.5, 0.06, 9.6, 6.2, 5.2, 14, MAT.water, 0.5);
    /* the hill, its rows of tea, the pagoda */
    loft([[0, 10.6], [2.4, 9.1], [4.4, 7.7], [5.0, 7.4]], 9, MAT.stone, { cx: -7, cz: -7, rot: 0.3, top: MAT.paper });
    for (let j = 0; j < 4; j++) {
      const y = 0.75 + j * 1.0, r = (y < 2.4 ? 10.6 - 0.625 * y : 9.1 - 0.7 * (y - 2.4)) * 0.975, seg = 11;
      for (let i = 0; i < seg; i++) {
        const a = -0.45 + i / seg * 2.75, b = -0.45 + (i + 1) / seg * 2.75;
        tube([-7 + Math.cos(a) * r, y, -7 + Math.sin(a) * r], [-7 + Math.cos(b) * r, y, -7 + Math.sin(b) * r], 0.27, MAT.roof, 4);
      }
    }
    withM(MM(mT(-7, 5.0, -7), mS(0.8)), pagoda);
    /* the causeway, willow and peach by turns, and the moon bridge in the middle of it */
    bx(-5.95, 0, 6.2, 14.1, 0.45, 2.4, MAT.stone, { top: MAT.paper }); bx(13.3, 0, 6.2, 4.8, 0.45, 2.4, MAT.stone, { top: MAT.paper });
    at(0, 0.45, 0, function () { moonBridge(6, 6.2, 4.9, 2.7, 2.4); });
    [[-11.6, 5.5, 4.6], [-7.2, 6.9, 5.0], [-2.6, 5.5, 4.4], [12.6, 6.9, 4.4]].forEach(q => at(q[0], 0.45, q[1], function () { willow(0, 0, q[2], q[0]); }));
    [[-9.4, 6.9, 3.0], [-4.9, 5.5, 3.3], [-0.3, 6.9, 2.9], [14.7, 5.5, 3.0]].forEach(q => at(q[0], 0.45, q[1], function () { peach(0, 0, q[2]); }));
    willow(-14.6, 12.4, 5.4, 1); willow(16.6, 2.2, 4.8, 2);
    /* in the water: the three lanterns, lotus, the black swans of the campus lake */
    stoneLantern(-1.8, 13.0); stoneLantern(2.4, 14.4); stoneLantern(6.0, 13.0);
    [[-8.6, 11.4, 0.8], [-7.2, 12.5, 0.6], [-9.7, 12.6, 0.55], [-6.5, 10.9, 0.5], [-8.3, 13.6, 0.7], [-10.6, 11.2, 0.5]].forEach(q => flat(q[0], 0.12, q[1], q[2], q[2], 7, MAT.blue, q[0]));
    [[-7.8, 11.9], [-9.2, 13.2], [-6.9, 13.3]].forEach(function (q) { tube([q[0], 0.1, q[1]], [q[0], 0.8, q[1]], 0.04, MAT.blue, 3); ico([q[0], 0.95, q[1]], 0.22, MAT.brick, 0, { sy: 1.3 }); });
    swan(-10.3, 8.4, 0.5); swan(-9.0, 9.1, -0.4);
    /* a pavilion on the shore: vermilion posts, a tiled roof turned up at the eaves */
    at(14.3, 0, 11.3, function () {
      loft([[0, 2.7], [0.6, 2.5]], 6, MAT.stone, { top: MAT.paper, rot: TAU / 12 });
      for (let i = 0; i < 6; i++) { const a = TAU / 12 + i / 6 * TAU; bx(Math.cos(a) * 1.8, 0.6, Math.sin(a) * 1.8, 0.24, 2.5, 0.24, MAT.brick); }
      loft([[2.96, 3.25], [3.0, 1.9]], 6, MAT.stone, { rot: TAU / 12, cap: 'none', down: 1, bias: 1 });
      loft([[3.0, 3.3], [3.3, 2.6], [4.6, 0.5], [5.4, 0.05]], 6, MAT.iron, { rot: TAU / 12, cap: 'none', up: 1 });
      loft([[3.0, 3.3], [3.5, 3.9]], 6, MAT.iron, { rot: TAU / 12, cap: 'none', up: 1 });
      ico([0, 5.55, 0], 0.26, MAT.ember, 0);
    });
    /* 求是书院, the academy the university grew from: white walls, dark tiles, horse-head gables */
    at(10.5, 0, -8.6, function () {
      const w = 9.6, d = 4.6, h = 3.9, rh = 1.9, y0 = 0.4, sw = (d + 1.0) / 5;
      bx(0, 0, 0, w + 1.6, y0, d + 2.4, MAT.stone, { top: MAT.paper });
      bx(0, y0, 0, w, h, d, MAT.paper);
      quad([-w / 2, y0 + h, d / 2 + 0.6], [w / 2, y0 + h, d / 2 + 0.6], [w / 2, y0 + h + rh, 0], [-w / 2, y0 + h + rh, 0], MAT.iron, { n: [0, 1, 0] });
      quad([-w / 2, y0 + h, -d / 2 - 0.6], [w / 2, y0 + h, -d / 2 - 0.6], [w / 2, y0 + h + rh, 0], [-w / 2, y0 + h + rh, 0], MAT.iron, { n: [0, 1, 0] });
      bx(0, y0 + h + rh - 0.12, 0, w, 0.34, 0.4, MAT.paper);
      [-1, 1].forEach(function (sx) {
        for (let j = -2; j <= 2; j++) {
          const top = y0 + h + rh * (1 - Math.abs(j) * 0.42) + 0.75;
          bx(sx * (w / 2 + 0.1), y0, j * sw, 0.5, top - y0, sw, MAT.paper);
          bx(sx * (w / 2 + 0.1), top, j * sw, 0.86, 0.2, sw + 0.3, MAT.iron);
        }
      });
      wall('+z', d / 2, -0.9, 0.9, y0, 3.0, MAT.ink);
      [-3.3, -1.9, 1.9, 3.3].forEach(function (x) {
        wall('+z', d / 2, x - 0.5, x + 0.5, 1.5, 3.1, MAT.roof);
        wall('+z', d / 2 + 0.03, x - 0.04, x + 0.04, 1.5, 3.1, MAT.paper); wall('+z', d / 2 + 0.03, x - 0.5, x + 0.5, 2.26, 2.34, MAT.paper);
      });
    });
    /* the stone gate, and the two characters on its board */
    at(10.5, 0, -2.6, function () {
      [[-3.5, 4.0], [-1.55, 5.3], [1.55, 5.3], [3.5, 4.0]].forEach(function (q) { bx(q[0], 0, 0, 0.62, 0.5, 0.9, MAT.stone); bx(q[0], 0.5, 0, 0.4, q[1] - 0.5, 0.4, MAT.paper); });
      bx(0, 4.35, 0, 3.5, 0.42, 0.42, MAT.paper); bx(0, 3.0, 0, 3.1, 0.3, 0.3, MAT.paper);
      [-2.52, 2.52].forEach(function (x) { bx(x, 3.25, 0, 1.95, 0.36, 0.36, MAT.paper); hip(x, 0, 3.9, 4.4, 2.9, 1.3, 1.9, 0.2, MAT.iron); });
      hip(0, 0, 5.2, 5.85, 4.6, 1.5, 3.4, 0.2, MAT.iron);
      wall('+z', 0.16, -1.3, 1.3, 3.32, 4.33, MAT.ink);
      QIUSHI.forEach(function (bits, g) {
        const s = 0.082, x0 = -1.08 + g * 1.14, y1 = 4.3, z = 0.27;
        for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) if (bits.charAt(r * 12 + c) === '1')
          quad([x0 + c * s, y1 - (r + 1) * s, z], [x0 + (c + 1) * s, y1 - (r + 1) * s, z], [x0 + (c + 1) * s, y1 - r * s, z], [x0 + c * s, y1 - r * s, z], MAT.glow, { n: [0, 0, 1] });
      });
    });
    /* a garden wall and its moon gate; bamboo; dawn redwoods */
    bx(5.3, 0, -4.4, 4.6, 2.9, 0.45, MAT.paper); bx(5.3, 2.9, -4.4, 5.0, 0.22, 0.85, MAT.iron);
    decal([5.3, 1.5, -4.1], [0, 0, 1], ngon(1.1, 14), MAT.ink);
    bamboo(17, -4.8, 7, 5); bamboo(4.4, -11.4, 6, 9);
    redwood(15.6, -12, 8.5); redwood(5.6, -14.8, 7); redwood(-17.6, 1.5, 6.5);
  }

  /* PHILADELPHIA: City Hall's tower with Penn on top; College Hall, and Franklin in his chair on the green; a brick
     row; the bell and its crack; Boathouse Row lit along the Schuylkill; a GRASP Lab quadrotor overhead. */
  function rowhouse(x, z, w, h, m, lit) {
    const dx = x - w * 0.22, wx = x + w * 0.22, f = z + 2.2;
    bx(x, 0, z, w, h, 4.4, m); bx(x, h, z, w + 0.14, 0.34, 4.6, MAT.paper);
    bx(dx, 0, f + 0.45, 0.9, 0.3, 0.9, MAT.paper); bx(dx, 0.3, f + 0.3, 0.9, 0.3, 0.6, MAT.paper);
    wall('+z', f, dx - 0.32, dx + 0.32, 0.6, 2.3, MAT.ink);
    wall('+z', f, wx - 0.3, wx + 0.3, 1.2, 2.2, lit === 0 ? MAT.glow : MAT.ink);
    for (let fl = 1; fl * 1.75 + 2.3 < h; fl++) [dx, wx].forEach(function (q, i) { wall('+z', f, q - 0.3, q + 0.3, 1.2 + fl * 1.75, 2.25 + fl * 1.75, lit === fl && i === 0 ? MAT.glow : MAT.ink); });
    bx(x + w * 0.3, h + 0.34, z - 1.2, 0.5, 0.9, 0.5, m);
  }
  function phlIsle() {
    at(-7, 0, -7.5, function () {
      bx(0, 0, 0, 12.4, 1, 10.8, MAT.stone, { top: MAT.paper });
      bx(0, 1, 0, 10.6, 7.2, 9.2, MAT.paper);
      grid('+z', 4.6, -4.7, 4.7, 1.8, 7.6, 4, 2, 0.46, 0.62, MAT.ink); grid('-x', -5.3, -4.1, 4.1, 1.8, 7.6, 3, 2, 0.46, 0.62, MAT.ink);
      grid('+x', 5.3, -4.1, 4.1, 1.8, 7.6, 3, 2, 0.46, 0.62, MAT.ink);
      hip(0, 0, 8.2, 10.3, 11.2, 9.8, 7.2, 5.8, MAT.roof);
      bx(0, 8.2, 0, 5.2, 13.4, 5.2, MAT.paper);
      grid('+z', 2.6, -1.8, 1.8, 11.4, 20.6, 2, 3, 0.4, 0.66, MAT.ink); grid('-x', -2.6, -1.8, 1.8, 11.4, 20.6, 2, 3, 0.4, 0.66, MAT.ink);
      grid('+x', 2.6, -1.8, 1.8, 11.4, 20.6, 2, 3, 0.4, 0.66, MAT.ink);
      bx(0, 21.6, 0, 6.0, 4.8, 6.0, MAT.blue);
      /* the clock's four faces are lit at night */
      [[[0, 24, 3.07], [0, 0, 1]], [[3.07, 24, 0], [1, 0, 0]], [[-3.07, 24, 0], [-1, 0, 0]], [[0, 24, -3.07], [0, 0, -1]]].forEach(function (f) {
        decal(f[0], f[1], ngon(1.85, 14), MAT.glow);
        const c = add(f[0], [f[1][0] * 0.05, 0, f[1][2] * 0.05]);
        decal(c, f[1], [[-0.1, 0], [0.1, 0], [0.1, 1.45], [-0.1, 1.45]], MAT.ink); decal(c, f[1], [[0, -0.1], [1.0, -0.1], [1.0, 0.1], [0, 0.1]], MAT.ink);
      });
      loft([[26.4, 3.1], [27.0, 2.7], [31.2, 2.7]], 8, MAT.paper, { stripe: 1, rot: TAU / 16 });
      loft([[31.2, 3.1], [32.2, 2.8], [33.6, 1.8], [34.4, 0.75]], 8, MAT.roof, { rot: TAU / 16, up: 1 });
      bx(0, 34.4, 0, 1.0, 0.8, 1.0, MAT.paper);
      bx(0, 35.2, 0, 0.62, 1.6, 0.5, MAT.blue); ico([0, 37.1, 0], 0.34, MAT.paper, 0); loft([[37.35, 0.62], [37.45, 0.62]], 8, MAT.blue, { cap: 'both' });
    });
    /* College Hall: grey stone, pointed windows, a gable in the middle and a pavilion at each end */
    at(7.2, 0, -7.6, function () {
      const gw = function (x, y, z) { decal([x, y, z], [0, 0, 1], [[-0.34, 0], [0.34, 0], [0.34, 1.25], [0, 1.8], [-0.34, 1.25]], MAT.ink); };
      bx(0, 0, 0, 15.6, 0.5, 7.4, MAT.stone, { top: MAT.paper });
      bx(0, 0.5, 0, 14, 5.6, 5.6, MAT.stone);
      hip(0, 0, 6.1, 8.3, 14.4, 6.0, 11.6, 1.8, MAT.roof);
      house(0, 0.5, 1.9, 4.8, 7.6, 3.6, 2.8, 'z', MAT.stone, MAT.roof);
      [-5.6, 5.6].forEach(function (x) { bx(x, 0.5, 0.5, 3.4, 7.0, 6.2, MAT.stone); hip(x, 0.5, 7.5, 9.9, 3.8, 6.6, 1.3, 2.4, MAT.roof); });
      [-3.5, 3.5].forEach(function (x) { gw(x, 1.3, 2.87); gw(x, 3.8, 2.87); });
      [-6.25, -4.95, 4.95, 6.25].forEach(function (x) { gw(x, 1.3, 3.67); gw(x, 4.2, 3.67); });
      [-1.1, 1.1].forEach(function (x) { gw(x, 4.7, 3.77); });
      decal([0, 0.5, 3.77], [0, 0, 1], archPts(1.7, 1.9, 8), MAT.ink);
      decal([0, 8.3, 3.77], [0, 0, 1], ngon(0.55, 8), MAT.glow);
      bx(-2.9, 8.3, -0.6, 0.6, 1.5, 0.6, MAT.stone); bx(2.9, 8.3, -0.6, 0.6, 1.5, 0.6, MAT.stone);
      /* red and blue from the gable */
      tube([0, 10.9, 1.9], [0, 13.8, 1.9], 0.06, MAT.paper, 3);
      quad([0.06, 13.7, 1.9], [1.6, 13.5, 1.9], [1.6, 13.1, 1.9], [0.06, 13.2, 1.9], MAT.ember, { n: [0, 0, 1] });
      quad([0.06, 13.2, 1.9], [1.6, 13.1, 1.9], [1.6, 12.7, 1.9], [0.06, 12.7, 1.9], MAT.blue, { n: [0, 0, 1], bias: 1 });
    });
    /* the green, its paths, and Franklin */
    flat(7.2, 0.05, 1.2, 7.6, 3.4, 14, MAT.turf, 0.2);
    wall('+y', 0.02, 6.8, 7.6, -2.6, 4.3, MAT.paper); wall('+y', 0.02, 0.6, 13.8, 0.9, 1.6, MAT.paper);
    at(7.2, 0, -1.7, function () {
      bx(0, 0, 0, 2.3, 0.4, 2.3, MAT.stone, { top: MAT.paper }); bx(0, 0.4, 0, 1.6, 2.2, 1.6, MAT.paper);
      bx(0, 2.6, -0.1, 1.2, 0.8, 1.1, MAT.iron); bx(0, 3.4, -0.55, 1.2, 1.2, 0.24, MAT.iron);
      bx(0, 3.4, -0.1, 0.8, 1.0, 0.56, MAT.iron); ico([0, 4.72, -0.05], 0.3, MAT.iron, 0);
      bx(-0.24, 2.7, 0.62, 0.26, 0.75, 0.3, MAT.iron); bx(0.24, 2.7, 0.62, 0.26, 0.75, 0.3, MAT.iron);
    });
    /* a brick row: stoops, cornices, one lit window each */
    [[5.6, MAT.brick], [6.4, MAT.brick], [5.2, MAT.paper], [6.1, MAT.brick], [5.5, MAT.blue]].forEach(function (r, i) { rowhouse(-15.4 + i * 2.36, 1.2, 2.3, r[0], r[1], (i * 2 + 1) % 3); });
    maple(-16.6, 6.2, 5.2, MAT.brick); maple(-11.2, 6.4, 4.6, MAT.ember); maple(-6.2, 6.0, 5.0, MAT.brick); maple(13.8, 5.6, 5.4, MAT.ember);
    /* the bell, and its crack */
    at(-1.6, 0, 6.4, function () {
      bx(0, 0, 0, 4.4, 0.5, 2.4, MAT.stone, { top: MAT.paper });
      bx(-1.7, 0.5, 0, 0.36, 3.9, 0.36, MAT.blue); bx(1.7, 0.5, 0, 0.36, 3.9, 0.36, MAT.blue); bx(0, 4.2, 0, 4.2, 0.44, 0.5, MAT.blue);
      loft([[1.3, 1.3], [1.6, 1.05], [2.7, 0.9], [3.5, 0.6], [3.9, 0.22]], 8, MAT.ember, { cap: 'none' }); ico([0, 1.25, 0], 0.28, MAT.iron, 0);
      tube([0.2, 1.36, 1.3], [0.05, 2.1, 1.02], 0.05, MAT.ink, 3); tube([0.05, 2.1, 1.02], [0.24, 2.8, 0.9], 0.05, MAT.ink, 3);
    }, -0.3);
    /* Boathouse Row, outlined in lights, and the river */
    flat(0, 0.06, 15.3, 14, 3.5, 18, MAT.water);
    const dot = function (x, y, z) { quad([x - 0.09, y - 0.09, z], [x + 0.09, y - 0.09, z], [x + 0.09, y + 0.09, z], [x - 0.09, y + 0.09, z], MAT.glow, { n: [0, 0, 1] }); };
    [[-9.4, 3.4, 2.2, 1.5, MAT.paper], [-5.3, 3.8, 2.6, 1.8, MAT.brick], [-1.0, 3.3, 2.0, 2.0, MAT.blue], [3.2, 4.0, 2.4, 1.4, MAT.paper], [7.4, 3.4, 2.5, 1.8, MAT.brick]].forEach(function (b) {
      const x = b[0], w = b[1], h = b[2], rh = b[3], z = 9.4, f = z + 1.7, dy = 0.4 * rh / (w / 2);
      house(x, 0, z, w, h, 3.4, rh, 'z', b[4], MAT.roof);
      wall('+z', f, x - w * 0.3, x + w * 0.3, 0, 1.5, MAT.ink);
      wall('+z', f, x - 0.3, x + 0.3, h - 0.3, h + 0.5, MAT.ink);
      bx(x, 0, f + 1.0, w * 0.62, 0.22, 2.0, MAT.paper);
      for (let k = 0; k <= 6; k++) {
        const t = k / 6, ex = (w / 2 + 0.4) * (1 - t), ey = h - dy + t * (rh + dy) + 0.02;
        dot(x - ex, ey, f + 0.46); if (k < 6) dot(x + ex, ey, f + 0.46);
      }
      for (let y = 0.5; y < h - 0.3; y += 0.62) { dot(x - w / 2, y, f + 0.08); dot(x + w / 2, y, f + 0.08); }
    });
  }

  /* LIFE: a football pitch, because the lab is not everything. */
  function pitchIsle() {
    bx(0, 0, 0, 21, 0.5, 13.6, MAT.stone, { top: MAT.turf });
    const L = (x0, x1, z0, z1) => wall('+y', 0.5, x0, x1, z0, z1, MAT.paper), w = 0.2;
    L(-9.6, 9.6, -6, -6 + w); L(-9.6, 9.6, 6 - w, 6); L(-9.6, -9.6 + w, -6, 6); L(9.6 - w, 9.6, -6, 6); L(-w / 2, w / 2, -6, 6);
    L(6.4, 9.6, -3.4, -3.4 + w); L(6.4, 9.6, 3.4 - w, 3.4); L(6.4, 6.4 + w, -3.4, 3.4);
    L(-9.6, -6.4, -3.4, -3.4 + w); L(-9.6, -6.4, 3.4 - w, 3.4); L(-6.4 - w, -6.4, -3.4, 3.4);
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * TAU, b = (i + 1) / 20 * TAU, r0 = 2.1, r1 = 2.3;
      quad([Math.cos(a) * r0, 0.57, Math.sin(a) * r0], [Math.cos(b) * r0, 0.57, Math.sin(b) * r0], [Math.cos(b) * r1, 0.57, Math.sin(b) * r1], [Math.cos(a) * r1, 0.57, Math.sin(a) * r1], MAT.paper, { n: [0, 1, 0] });
    }
    /* goal and net */
    const gx = 9.5, gz = 2.6, gh = 2.7, gd = 1.7, r = 0.11;
    tube([gx, 0.5, -gz], [gx, 0.5 + gh, -gz], r, MAT.paper, 4); tube([gx, 0.5, gz], [gx, 0.5 + gh, gz], r, MAT.paper, 4); tube([gx, 0.5 + gh, -gz], [gx, 0.5 + gh, gz], r, MAT.paper, 4);
    tube([gx, 0.5 + gh, -gz], [gx + gd, 0.5, -gz], 0.05, MAT.paper, 3); tube([gx, 0.5 + gh, gz], [gx + gd, 0.5, gz], 0.05, MAT.paper, 3); tube([gx + gd, 0.5, -gz], [gx + gd, 0.5, gz], 0.05, MAT.paper, 3);
    for (let i = 1; i < 8; i++) { const z = -gz + i / 8 * 2 * gz; tube([gx, 0.5 + gh, z], [gx + gd, 0.5, z], 0.03, MAT.line, 3); }
    for (let i = 1; i < 5; i++) { const t = i / 5; tube([gx + gd * t, 0.5 + gh * (1 - t), -gz], [gx + gd * t, 0.5 + gh * (1 - t), gz], 0.03, MAT.line, 3); }
    [[-9.6, -6], [9.6, -6], [-9.6, 6], [9.6, 6]].forEach(function (q) {
      tube([q[0], 0.5, q[1]], [q[0], 2.3, q[1]], 0.05, MAT.paper, 3);
      tri([q[0], 2.3, q[1]], [q[0], 1.8, q[1]], [q[0] - 0.75 * Math.sign(q[0]), 2.05, q[1]], MAT.ember, { n: [0, 0, 1] });
    });
    bx(-2, 0.5, -7.6, 4.2, 0.5, 0.9, MAT.paper); bx(-3.7, 0.5, -7.6, 0.25, 0.5, 0.9, MAT.blue);
  }

  /* Chains of blocks from island to island. */
  function chain(a, b, n, sag, seed) {
    const rnd = rng(seed), pts = [];
    for (let i = 0; i <= n + 1; i++) { const t = i / (n + 1), p = mix(a, b, t); p[1] -= Math.sin(t * Math.PI) * sag; pts.push(p); }
    for (let i = 1; i <= n; i++) {
      const s = 1.3 + rnd() * 0.9, p = pts[i], m = (i === Math.ceil(n / 2) && seed % 2) ? MAT.ember : (i % 3 === 0 ? MAT.blue : MAT.paper);
      withM(MM(mT(p[0], p[1], p[2]), mRY(rnd() * TAU), mRX((rnd() - 0.5) * 0.5), mRZ((rnd() - 0.5) * 0.5)), function () { bx(0, -s / 2, 0, s, s, s, m, { bottom: 1 }); });
    }
    for (let i = 0; i <= n; i++) tube(pts[i], pts[i + 1], 0.06, MAT.line, 3);
  }
  function link(A, B, n, sag, seed) {
    const a = ISL[A], b = ISL[B], d = norm([b.p[0] - a.p[0], 0, b.p[2] - a.p[2]]);
    chain([a.p[0] + d[0] * a.R * 0.9, a.p[1] - 0.6, a.p[2] + d[2] * a.R * 0.9], [b.p[0] - d[0] * b.R * 0.9, b.p[1] - 0.6, b.p[2] - d[2] * b.R * 0.9], n, sag, seed);
  }

  /* GRAVIT: an orrery on a rock of its own, riding above the rest on a chain of blocks. A key winds it; the meter in
     the Now window says how hard. What moves is built in buildMovers: the sun, the four arms, the gears, the key. */
  function gravitIsle() {
    loft([[0, 3.7], [1.1, 3.3]], 8, MAT.stone, { top: MAT.paper, rot: 0.2 });
    bx(0, 1.1, 0, 4.6, 2.7, 4.6, MAT.blue, { top: MAT.paper });
    wall('+z', 2.3, -1.9, 1.9, 1.5, 3.4, MAT.roof);
    loft([[3.8, 1.0], [4.3, 0.8]], 8, MAT.paper);
    tube([0, 4.3, 0], [0, 7.7, 0], 0.28, MAT.paper, 6);
    [4.45, 5.2, 5.95, 6.7].forEach(function (y) { loft([[y - 0.3, 0.7], [y + 0.26, 0.7]], 8, MAT.blue, { cap: 'both' }); });
  }

  /* --- the parts that move --- */
  let effort = 3, effortK = 1;        /* the Now window's control: how hard the orrery turns */
  function buildMovers() {
    const cubeP = capture(function () { bx(0, -0.5, 0, 1, 1, 1, MAT.paper, { bottom: 1 }); });
    const cubeB = capture(function () { bx(0, -0.5, 0, 1, 1, 1, MAT.blue, { bottom: 1 }); });
    const cubeE = capture(function () { bx(0, -0.5, 0, 1, 1, 1, MAT.ember, { bottom: 1 }); });
    const cubeG = capture(function () { bx(0, -0.5, 0, 1, 1, 1, MAT.glow, { bottom: 1 }); });
    /* the charge: one by one across the bridge and into the mouth */
    anim.push(function (t, emit) {
      for (let k = 0; k < 3; k++) {
        const u = (t / 11 + k / 3) % 1; let y, z, s = 1, tip = 0;
        if (u < 0.12) { z = -15.6; y = 23.4; s = smooth(u / 0.12); }
        else if (u < 0.26) { const q = (u - 0.12) / 0.14; z = -15.6 + q * 2.8; y = 23.4 + q * 0.1; }
        else if (u < 0.8) { const q = (u - 0.26) / 0.54; z = -12.8 + q * 8.3; y = 23.5 + q * 0.95; }
        else { const q = (u - 0.8) / 0.2; z = -4.5 + q * 2.6; y = 24.45 - q * q * 2.4; s = 1 - smooth(q); tip = q * 2.2; }
        emit(k === 1 ? cubeE : k === 2 ? cubeB : cubeP, MM(FM, mT(0, y + 0.56 * s, z), mRX(tip), mS(1.1 * s + 0.001)), 1);
      }
    });
    /* what the fire sends up: lit, then red, then ash */
    anim.push(function (t, emit) {
      for (let k = 0; k < 6; k++) {
        const life = (t / 14 + k / 6) % 1, grow = Math.min(1, life * 8) * (1 - smooth(clamp((life - 0.7) / 0.3, 0, 1)));
        emit(life < 0.14 ? cubeG : life < 0.4 ? cubeE : cubeP, MM(FM, mT(Math.sin(k * 2.4 + life * 5) * (0.5 + life * 4.5), 25.2 + life * 30, -life * life * 8 + Math.cos(k * 1.7 + life * 4) * (0.5 + life * 2.5)),
          mRY(k * 2 + t * 0.35), mRX(k + t * 0.25), mS((0.7 + life * 1.5) * grow + 0.001)), 1);
      }
    });
    /* a cast: iron runs down the sow and fills the pigs two by two; then they cool */
    const pigG = capture(function () { quad([-1.8, 0, -0.24], [1.8, 0, -0.24], [1.8, 0, 0.24], [-1.8, 0, 0.24], MAT.glow, { n: [0, 1, 0] }); });
    const pigE = capture(function () { quad([-1.8, 0, -0.24], [1.8, 0, -0.24], [1.8, 0, 0.24], [-1.8, 0, 0.24], MAT.ember, { n: [0, 1, 0] }); });
    const runG = capture(function () { quad([-0.3, 0, -0.9], [0.3, 0, -0.9], [0.3, 0, 0.9], [-0.3, 0, 0.9], MAT.glow, { n: [0, 1, 0] }); });
    anim.push(function (t, emit) {
      const c = (t % 18) / 18, head = 10.9 + clamp(c / 0.3, 0, 1) * 9.9;
      if (c < 0.3) emit(runG, MM(FM, mT(0, 1.12, head)), 1);
      for (let k = 0; k < 7; k++) {
        const z = 14.9 + k * 1.05, since = c - 0.3 * (z - 10.9) / 9.9;
        if (since < 0 || since > 0.52) continue;
        const part = since < 0.1 ? pigG : pigE;
        emit(part, MM(FM, mT(2.1, 1.11, z)), 1); emit(part, MM(FM, mT(-2.1, 1.11, z)), 1);
      }
    });
    /* the tilt hammer: the cam bears the helve's tail down, lets go, and the head falls */
    const HM = mmul(FM, mT(11.8, 0, 13.4));
    const helve = capture(function () {
      bx(-0.9, -0.35, 0, 9, 0.7, 0.7, MAT.paper, { bottom: 1 });
      bx(-4.8, -1.85, 0, 1.6, 1.5, 1.4, MAT.iron, { bottom: 1 });
      bx(-4.8, -0.42, 0, 1.7, 0.84, 0.84, MAT.iron, { bottom: 1 }); bx(3.2, -0.42, 0, 0.5, 0.84, 0.84, MAT.iron, { bottom: 1 });
    });
    const drum = capture(function () {
      loft([[-1.2, 0.85], [1.2, 0.85]], 8, MAT.blue, { cap: 'both' });
      for (let k = 0; k < 4; k++) withM(mRY(k * TAU / 4), function () { bx(1.1, -0.45, 0, 0.8, 0.9, 0.5, MAT.iron, { bottom: 1 }); });
      loft([[2.3, 1.7], [2.7, 1.7]], 12, MAT.blue, { cap: 'both' });
      for (let k = 0; k < 3; k++) withM(mRY(k * TAU / 3), function () { wall('+y', 2.7, 0.5, 1.35, -0.26, 0.26, MAT.paper); });
    });
    anim.push(function (t, emit) {
      const T = 2.4, ph = (t / T) % 1; let th;
      if (ph < 0.76) { const q = ph / 0.76; th = 0.3 * q * q * (3 - 2 * q); }
      else if (ph < 0.84) { const q = (ph - 0.76) / 0.08; th = 0.3 * (1 - q * q); }
      else { const q = (ph - 0.84) / 0.16; th = 0.03 * Math.sin(q * Math.PI) * (1 - q); }
      emit(helve, MM(HM, mT(1.2, 4.4, 0), mRZ(-th)), 1);
      emit(drum, MM(HM, mT(5.7, 5.9, 0), mRX(Math.PI / 2), mRY(-(t / T) * TAU / 4)), 1);
      const since = ((ph - 0.84 + 1) % 1) * T;            /* sparks off the anvil at each blow */
      if (since < 0.55) for (let k = 0; k < 7; k++) {
        const a = k * 0.9 + Math.floor(t / T) * 1.7, v = 3.2 + (k % 3) * 1.3, e = 0.5 + (k % 4) * 0.22;
        emit(k % 2 ? cubeG : cubeE, MM(HM, mT(-3.6 + Math.cos(a) * v * since, 2.6 + v * e * 1.6 * since - 9 * since * since, Math.sin(a) * v * since),
          mRY(a + since * 9), mRX(since * 7), mS(0.34 * (1 - since / 0.55) + 0.001)), 1);
      }
    });
    /* the humanoid */
    const H = {
      pelvis: capture(function () { bx(0, -0.1, 0, 2.1, 0.9, 1.2, MAT.blue, { bottom: 1 }); }),
      torso: capture(function () {
        bx(0, 0, 0, 2.6, 2.5, 1.5, MAT.paper); wall('+z', 0.75, -0.8, 0.8, 1.0, 2.05, MAT.blue); wall('+z', 0.8, -0.28, 0.28, 1.3, 1.78, MAT.glow);
        bx(-1.68, 1.7, 0, 0.8, 0.9, 1.0, MAT.blue); bx(1.68, 1.7, 0, 0.8, 0.9, 1.0, MAT.blue);
      }),
      head: capture(function () {
        bx(0, 0.12, 0, 1.5, 1.4, 1.4, MAT.paper, { bottom: 1 }); wall('+z', 0.7, -0.58, 0.58, 0.56, 1.14, MAT.ink);
        wall('+z', 0.75, -0.4, -0.16, 0.74, 0.96, MAT.glow); wall('+z', 0.75, 0.16, 0.4, 0.74, 0.96, MAT.glow);
        tube([0.45, 1.52, 0], [0.45, 2.2, 0], 0.05, MAT.blue, 3); ico([0.45, 2.3, 0], 0.13, MAT.ember, 0);
      }),
      thigh: capture(function () { bx(0, -2.1, 0, 0.92, 2.1, 0.98, MAT.paper, { bottom: 1 }); bx(0, -2.35, 0, 1.02, 0.5, 1.06, MAT.blue, { bottom: 1 }); }),
      shin: capture(function () { bx(0, -2.0, 0, 0.78, 2.0, 0.82, MAT.paper, { bottom: 1 }); }),
      foot: capture(function () { bx(0, -0.45, 0.36, 0.92, 0.45, 1.75, MAT.blue, { bottom: 1 }); }),
      upper: capture(function () { bx(0, -1.9, 0, 0.64, 1.9, 0.72, MAT.paper, { bottom: 1 }); }),
      fore: capture(function () { bx(0, -1.7, 0, 0.56, 1.7, 0.62, MAT.paper, { bottom: 1 }); bx(0, -2.25, 0, 0.62, 0.55, 0.68, MAT.blue, { bottom: 1 }); })
    };
    anim.push(function (t, emit) {
      const ph = t * 4.3, s = Math.sin(ph);
      const root = MM(ISLM.robot, mT(-4, 1.4 + 4.55 + 0.1 * Math.abs(Math.cos(ph)), 1.5));
      emit(H.pelvis, MM(root, mRY(0.07 * s)), 2);
      const torso = MM(root, mT(0, 0.8, 0), mRY(-0.12 * s), mRX(0.07));
      emit(H.torso, torso, 2); emit(H.head, MM(torso, mT(0, 2.5, 0), mRY(0.1 * s)), 2);
      for (let k = 0; k < 2; k++) {
        const sd = k ? 1 : -1, p = ph + (k ? Math.PI : 0), hipA = 0.5 * Math.sin(p), knee = 0.14 + 0.78 * Math.max(0, Math.cos(p));
        const th = MM(root, mT(sd * 0.62, 0, 0), mRX(-hipA));
        emit(H.thigh, th, 2);
        const sh = MM(th, mT(0, -2.1, 0), mRX(knee));
        emit(H.shin, sh, 2); emit(H.foot, MM(sh, mT(0, -2.0, 0), mRX(hipA - knee)), 2);
        const up = MM(torso, mT(sd * 1.68, 2.2, 0), mRX(0.5 * Math.sin(p)), mRZ(sd * 0.06));
        emit(H.upper, up, 2); emit(H.fore, MM(up, mT(0, -1.9, 0), mRX(-0.55 - 0.15 * Math.sin(p))), 2);
      }
    });
    /* the arm */
    const A = {
      turret: capture(function () { loft([[0, 0.85], [1.2, 0.8]], 8, MAT.blue); bx(0, 1.0, 0, 1.5, 1.1, 1.1, MAT.blue); }),
      upper: capture(function () { bx(0, 0, 0, 0.8, 4.3, 0.8, MAT.paper); bx(0, 3.75, 0, 1.2, 1.0, 1.0, MAT.blue); }),
      fore: capture(function () {
        bx(0, 0, 0, 0.64, 3.5, 0.64, MAT.paper); bx(0, 3.5, 0, 1.1, 0.3, 0.7, MAT.blue);
        bx(-0.5, 3.8, 0, 0.16, 0.9, 0.5, MAT.iron); bx(0.5, 3.8, 0, 0.16, 0.9, 0.5, MAT.iron); bx(0, 3.95, 0, 0.82, 0.82, 0.82, MAT.ember);
      })
    };
    anim.push(function (t, emit) {
      const tur = MM(ISLM.robot, mT(6.5, 1.9, 2), mRY(0.55 + 0.6 * Math.sin(t * 0.55)));
      emit(A.turret, tur, 2);
      const up = MM(tur, mT(0, 1.55, 0), mRX(0.5 + 0.3 * Math.sin(t * 0.8)));
      emit(A.upper, up, 2); emit(A.fore, MM(up, mT(0, 4.25, 0), mRX(1.25 + 0.4 * Math.sin(t * 1.1 + 1))), 2);
    });
    /* the bounty: a coin */
    const coin = capture(function () { loft([[-0.18, 1.5], [0.18, 1.5]], 10, MAT.ember, { cap: 'both' }); loft([[-0.24, 0.8], [0.24, 0.8]], 4, MAT.glow, { cap: 'both', rot: TAU / 8 }); });
    anim.push(function (t, emit) { emit(coin, MM(ISLM.bounty, mT(0, 12.6 + 0.45 * Math.sin(t * 1.3), -3), mRY(t * 1.5), mRX(Math.PI / 2)), 3); });
    /* the quadrotor */
    const Q = {
      frame: capture(function () {
        bx(0, -0.25, 0, 1.6, 0.6, 1.6, MAT.paper, { bottom: 1 }); wall('+z', 0.8, -0.4, 0.4, -0.1, 0.2, MAT.ink);
        withM(mRY(Math.PI / 4), function () { bx(0, -0.1, 0, 5.6, 0.2, 0.34, MAT.blue, { bottom: 1 }); bx(0, -0.1, 0, 0.34, 0.2, 5.6, MAT.blue, { bottom: 1 }); });
        [[1.98, 1.98], [-1.98, 1.98], [1.98, -1.98], [-1.98, -1.98]].forEach(q => loft([[-0.1, 0.3], [0.5, 0.26]], 6, MAT.paper, { cx: q[0], cz: q[1] }));
        tube([-0.6, -0.25, 0.6], [-0.9, -0.95, 0.9], 0.05, MAT.blue, 3); tube([0.6, -0.25, 0.6], [0.9, -0.95, 0.9], 0.05, MAT.blue, 3);
        tube([-0.6, -0.25, -0.6], [-0.9, -0.95, -0.9], 0.05, MAT.blue, 3); tube([0.6, -0.25, -0.6], [0.9, -0.95, -0.9], 0.05, MAT.blue, 3);
      }),
      rotor: capture(function () { bx(0, 0, 0, 2.7, 0.06, 0.3, MAT.line, { bottom: 1 }); bx(0, 0, 0, 0.3, 0.06, 2.7, MAT.line, { bottom: 1 }); })
    };
    const ROTORS = [[1.98, 1.98], [-1.98, 1.98], [1.98, -1.98], [-1.98, -1.98]];
    anim.push(function (t, emit) {
      const m = MM(ISLM.phl, mT(3 + 4.6 * Math.sin(t * 0.5), 29 + 1.4 * Math.sin(t * 0.9), 0.5 + 3.4 * Math.sin(t * 0.8)), mRY(0.4 * Math.sin(t * 0.3)), mRZ(-0.22 * Math.cos(t * 0.5)), mRX(0.2 * Math.cos(t * 0.8)));
      emit(Q.frame, m, 5);
      for (let i = 0; i < 4; i++) emit(Q.rotor, MM(m, mT(ROTORS[i][0], 0.56, ROTORS[i][1]), mRY(t * (i % 2 ? 11 : -11))), 5);
    });
    /* the ball */
    const ball = capture(function () { ico([0, 0, 0], 0.72, MAT.paper, 1, { pick: i => ((i * 7) % 11 < 3 ? MAT.ink : MAT.paper) }); });
    anim.push(function (t, emit) { emit(ball, MM(ISLM.pitch, mT(4.6, 0.5 + 0.72 + 3.3 * Math.abs(Math.sin(t * 2.15)), 0.4), mRX(t * 2), mRZ(t * 1.3)), 6); });
    /* a paper plane, circling the furnace */
    const plane = capture(function () {
      const nose = [0, 0, 1.7], tl = [-1.05, 0.3, -1.2], tr = [1.05, 0.3, -1.2], ct = [0, 0.18, -1.2], kb = [0, -0.5, -1.2];
      tri(nose, tl, ct, MAT.paper, { n: [0, 1, 0] }); tri(nose, ct, tr, MAT.paper, { n: [0, 1, 0] });
      tri(nose, kb, ct, MAT.ember, { n: [1, 0, 0] });
    });
    anim.push(function (t, emit) {
      const a = t * 0.23, x = Math.cos(a) * 34, z = Math.sin(a) * 27, y = 41 + 4 * Math.sin(a * 2 + 1), vx = -Math.sin(a) * 34, vz = Math.cos(a) * 27, vy = 8 * Math.cos(a * 2 + 1);
      emit(plane, MM(mT(x, y, z), mRY(Math.atan2(vx, vz)), mRX(-Math.atan2(vy, Math.hypot(vx, vz)) * 0.6), mRZ(-0.5), mS(1.5)), 0);
    });
    /* a covered boat on West Lake */
    const boat = capture(function () {
      loft([[0, 1.5, 0.4], [0.5, 2.0, 0.62]], 8, MAT.paper, { cap: 'none' });
      flat(0, 0.3, 0, 1.7, 0.5, 8, MAT.stone);
      [[-0.56, 0.5, -0.3, 1.2], [-0.3, 1.2, 0.3, 1.2], [0.3, 1.2, 0.56, 0.5]].forEach(function (s) {
        quad([-0.9, s[1], s[0]], [0.9, s[1], s[0]], [0.9, s[3], s[2]], [-0.9, s[3], s[2]], MAT.iron, { c: [0, 0.4, 0] });
      });
      bx(1.45, 0.4, 0, 0.26, 0.85, 0.26, MAT.blue); tube([1.6, 0.3, 0.3], [2.3, 2.3, 0.5], 0.04, MAT.paper, 3);
    });
    anim.push(function (t, emit) {
      const a = t * 0.11, x = 3.6 + Math.cos(a) * 6.4, z = 10.4 + Math.sin(a) * 1.5, vx = -Math.sin(a) * 6.4, vz = Math.cos(a) * 1.5;
      emit(boat, MM(ISLM.hz, mT(x, 0.1 + 0.04 * Math.sin(t * 1.7), z), mRY(Math.atan2(-vz, vx)), mRZ(0.03 * Math.sin(t * 1.3))), 4);
    });
    /* a four on the Schuylkill */
    const shell = capture(function () {
      loft([[0, 3.4, 0.14], [0.26, 4.2, 0.3]], 8, MAT.paper, { cap: 'none' }); flat(0, 0.2, 0, 3.9, 0.24, 8, MAT.blue);
      for (let i = 0; i < 4; i++) { const x = -1.8 + i * 1.2; bx(x, 0.2, 0, 0.32, 0.6, 0.34, i % 2 ? MAT.brick : MAT.blue); bx(x, 0.8, 0, 0.26, 0.26, 0.26, MAT.paper); }
    });
    const oar = capture(function () {
      tube([0, 0, 0], [0, -0.25, 2.3], 0.035, MAT.paper, 3);
      quad([-0.1, -0.2, 2.2], [0.1, -0.2, 2.2], [0.14, -0.34, 2.9], [-0.14, -0.34, 2.9], MAT.brick, { n: [0, 1, 0] });
    });
    anim.push(function (t, emit) {
      const st = t * 1.9, ph = Math.sin(st), a = t * 0.085 + 0.02 * Math.sin(st), x = Math.cos(a) * 8.6, z = 15.5 + Math.sin(a) * 1.5, vx = -Math.sin(a) * 8.6, vz = Math.cos(a) * 1.5;
      const m = MM(ISLM.phl, mT(x, 0.1, z), mRY(Math.atan2(-vz, vx)));
      emit(shell, m, 5);
      for (let i = 0; i < 4; i++) { const sd = i % 2 ? 1 : -1; emit(oar, MM(m, mT(-1.8 + i * 1.2, 0.62, sd * 0.2), mRY(sd > 0 ? 0.55 * ph : Math.PI - 0.55 * ph)), 5); }
    });
    /* the orrery: a sun, four arms and what they carry, the gears on the case, the key that winds it */
    const SUN_Y = 11.8, ARMS = [
      { R: 9, y: 6.7, w: 0.3, r: 1.0, m: MAT.paperF, a: 0.5 },
      { R: 14.5, y: 5.95, w: 0.19, r: 1.5, m: MAT.blueF, a: 2.2, moons: [[2.7, 0.45, 2.1]] },
      { R: 20.5, y: 5.2, w: 0.12, r: 1.2, m: MAT.emberF, a: 4.1 },
      { R: 27, y: 4.45, w: 0.075, r: 2.1, m: MAT.paperF, a: 5.3, moons: [[3.4, 0.5, 1.3], [4.4, 0.36, -0.8]] }
    ];
    ARMS.forEach(function (o) {
      o.part = capture(function () {
        bx(o.R / 2 - 1.2, -0.18, 0, o.R + 2.4, 0.36, 0.5, MAT.paperF, { bottom: 1 });
        bx(-2.6, -0.5, 0, 1.2, 1.0, 1.0, MAT.blueF, { bottom: 1 });
        tube([o.R, 0, 0], [o.R, SUN_Y - o.y, 0], 0.11, MAT.lineF, 4);
        ico([o.R, SUN_Y - o.y, 0], o.r, o.m, 1);
      });
      o.moonParts = (o.moons || []).map(function (mn) { return capture(function () { tube([0, 0, 0], [mn[0], 0, 0], 0.05, MAT.lineF, 3); ico([mn[0], 0, 0], mn[1], MAT.paperF, 0); }); });
    });
    const sun = capture(function () { ico([0, 0, 0], 4.2, MAT.sunF, 1); });
    const key = capture(function () {
      tube([0, 0, 0], [2.3, 0, 0], 0.16, MAT.paperF, 5);
      [-1, 1].forEach(function (s) { withM(MM(mT(3.0, s * 0.92, 0), mRZ(Math.PI / 4)), function () { bx(0, -0.62, 0, 1.24, 1.24, 0.26, MAT.paperF, { bottom: 1 }); }); });
      bx(2.9, -0.2, 0, 0.5, 0.4, 0.3, MAT.blueF, { bottom: 1 });
    });
    const gear = function (r, teeth, m) {
      return capture(function () {
        loft([[-0.14, r], [0.14, r]], teeth * 2, m, { cap: 'both' });
        for (let k = 0; k < teeth; k++) withM(mRY(k * TAU / teeth), function () { bx(r + 0.12, -0.14, 0, 0.36, 0.28, r * 0.42, m, { bottom: 1 }); });
        wall('+y', 0.14, -0.16, 0.16, -r * 0.7, r * 0.7, MAT.ink);
      });
    };
    const gearA = gear(1.25, 10, MAT.paper), gearB = gear(0.65, 5, MAT.ember);
    let last = 0, wind = 0;
    anim.push(function (t, emit) {
      const dt = clamp(t - last, 0, 0.1); last = t;
      effortK += (([0.25, 0.7, 1.6, 3.4][effort]) - effortK) * Math.min(1, dt * 2.5);
      wind += effortK * dt;
      emit(sun, MM(GM, mT(0, SUN_Y, 0), mRY(wind * 0.05)), 7);
      ARMS.forEach(function (o) {
        o.a += o.w * effortK * dt;
        const m = MM(GM, mT(0, o.y, 0), mRY(o.a));
        emit(o.part, m, 7);
        (o.moons || []).forEach(function (mn, i) { emit(o.moonParts[i], MM(m, mT(o.R, SUN_Y - o.y, 0), mRY(wind * mn[2])), 7); });
      });
      emit(key, MM(GM, mT(2.3, 2.45, 0), mRX(wind * 1.4)), 7);
      emit(gearA, MM(GM, mT(-0.75, 2.45, 2.52), mRX(Math.PI / 2), mRY(wind * 0.8)), 7);
      emit(gearB, MM(GM, mT(1.3, 2.45, 2.52), mRX(Math.PI / 2), mRY(-wind * 1.6 + 0.3)), 7);
    });
  }

  function buildWorld() {
    const S = new StaticOut();
    G.out = S;
    const build = { forge: forgeIsle, robot: robotIsle, bounty: bountyIsle, hz: hzIsle, phl: phlIsle, pitch: pitchIsle, gravit: gravitIsle };
    for (const k in ISL) { const I = ISL[k]; G.bob = I.bob; withM(ISLM[k], function () { rock(I.R, I.d, I.seed); build[k](); }); }
    G.bob = 0;
    link('forge', 'robot', 3, 1.2, 3); link('robot', 'bounty', 4, 1.6, 4); link('forge', 'phl', 2, 0.8, 6); link('phl', 'hz', 5, 2.6, 9); link('forge', 'pitch', 4, 1.6, 12);
    /* Gravit rides above the rest, made fast to the bank behind the furnace */
    chain(mapply(FM, [0, 26.5, -20]), [ISL.gravit.p[0] - 3.5, ISL.gravit.p[1] - 9, ISL.gravit.p[2] + 3], 9, -3.5, 5);
    buildMovers();
    return new Float32Array(S.a);
  }

  /* Where the labels hang (world space; b is the island that carries them). */
  const marks = [
    { id: 'forge', p: mapply(FM, [0, 30, 0]), b: 1 },
    { id: 'gravit', p: mapply(GM, [0, 19, 0]), b: 7 },
    { id: 'robots', p: mapply(ISLM.robot, [-4, 13, 1.5]), b: 2 },
    { id: 'bounty', p: mapply(ISLM.bounty, [0, 16, -3]), b: 3 },
    { id: 'hangzhou', p: mapply(ISLM.hz, [-7, 36, -7]), b: 4 },
    { id: 'philadelphia', p: mapply(ISLM.phl, [-7, 41, -7.5]), b: 5 },
    { id: 'pitch', p: mapply(ISLM.pitch, [-3, 4.6, -1]), b: 6 }
  ];

  /* ---------- camera: a stop per window, a curve through them ---------- */
  const STOPS = [
    { p: [-18, 30, 92], t: [-12, 16, -6], f: 50 },    /* 0 arrival: the furnace, the others around it */
    { p: [-6, 10, 50], t: [0, 12, 0], f: 50 },        /* 1 about: toward the furnace */
    { p: [4, 80, 30], t: [36, 53, -22], f: 44 },      /* 2 now: over the orrery */
    { p: [31, 10, 52], t: [4, 8, 4], f: 46 },         /* 3 research: the cast house, the hammer */
    { p: [22, 4, 22], t: [50, -1, -12], f: 46 },      /* 4 experience: the lab floor, the board behind it */
    { p: [-22, 36, 60], t: [-56, 10, -4], f: 48 },    /* 5 education: Philadelphia, Hangzhou beyond it */
    { p: [-22, 26, 4], t: [-38, 14, -62], f: 50 },    /* 6 skills: and Hangzhou, where the first of them were learned */
    { p: [-10, 46, 36], t: [2, 6, 6], f: 50 },        /* 7 on the way across: the ironworks from above (no window stops here) */
    { p: [22, -3, 62], t: [40, -9, 34], f: 42 },      /* 8 life: the pitch */
    { p: [0, 68, 122], t: [10, 9, -8], f: 50 }        /* 9 the end: all of it, from above */
  ];
  function cr(a, b, c, d, t) {
    const t2 = t * t, t3 = t2 * t, o = [0, 0, 0];
    for (let k = 0; k < 3; k++) o[k] = 0.5 * (2 * b[k] + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3);
    return o;
  }
  function camAt(u) {
    const n = STOPS.length, i = clamp(Math.floor(u), 0, n - 2), f = clamp(u - i, 0, 1);
    const a = STOPS[Math.max(0, i - 1)], b = STOPS[i], c = STOPS[i + 1], d = STOPS[Math.min(n - 1, i + 2)];
    return { p: cr(a.p, b.p, c.p, d.p, f), t: cr(a.t, b.t, c.t, d.t, f), f: b.f + (c.f - b.f) * smooth(f) };
  }

  /* ---------- WebGL ---------- */
  const VS = 'attribute vec3 aPos;attribute vec3 aInfo;uniform mat4 uVP;uniform vec3 uCam;uniform vec3 uPal[24];uniform float uBob[8];' +
    'varying vec3 vCol;varying float vD;void main(){vec3 p=aPos;p.y+=uBob[int(aInfo.z+.5)];vCol=uPal[int(aInfo.x+.5)];' +
    'vD=aInfo.y>.5?0.:distance(p,uCam);gl_Position=uVP*vec4(p,1.);}';
  const FS = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'varying vec3 vCol;varying float vD;uniform vec3 uFog;uniform float uFogD,uSeed,uPx,uGrain;' +
    'void main(){float f=1.-exp(-pow(vD*uFogD,1.5));vec3 c=mix(vCol,uFog,f);vec2 q=floor(gl_FragCoord.xy/uPx);' +
    'float n=fract(sin(dot(q+uSeed,vec2(12.9898,78.233)))*43758.5453);c+=(n-.5)*uGrain;gl_FragColor=vec4(c,1.);}';
  const VS_STAR = 'attribute vec4 aS;uniform mat4 uVP;uniform float uTime,uSize;varying float vA;' +
    'void main(){vec4 p=uVP*vec4(aS.xyz*400.,1.);gl_Position=p.xyww;float s=fract(aS.w*7.31);gl_PointSize=uSize*(1.+2.2*s*s*s);' +
    'vA=(.35+.65*s)*(.7+.3*sin(uTime*(.5+2.*fract(aS.w*3.7))+aS.w*50.));}';
  const FS_PT = 'precision mediump float;varying float vA;uniform vec3 uCol;uniform float uAlpha,uRound;' +
    'void main(){vec2 d=gl_PointCoord-.5;if(uRound>.5&&dot(d,d)>.25)discard;gl_FragColor=vec4(uCol,vA*uAlpha);}';
  const VS_MOTE = 'attribute vec4 aS;uniform mat4 uVP;uniform float uTime,uSize,uRise,uSway;uniform vec3 uBox0,uBoxS;varying float vA;' +
    'void main(){float s=aS.w;vec3 p=aS.xyz;float sp=(.5+fract(s*9.1)*1.1)*uRise;float h=mod(p.y-uBox0.y+uTime*sp,uBoxS.y);p.y=uBox0.y+h;' +
    'float k=uSway*(1.+h*.06*step(4.,uRise));p.x+=sin(uTime*.31+s*40.+h*.2)*k;p.z+=cos(uTime*.27+s*17.+h*.17)*k;' +
    'vec4 q=uVP*vec4(p,1.);gl_Position=q;gl_PointSize=clamp(uSize*(60.+70.*fract(s*5.3))/max(q.w,1.),1.,10.);float hh=h/uBoxS.y;' +
    'vA=smoothstep(0.,.1,hh)*(1.-smoothstep(.7,1.,hh))*(.4+.6*(.5+.5*sin(uTime*(1.+fract(s*2.3))+s*90.)));}';

  let canvas, gl, progScene, progStar, progMote, bufStatic, bufDyn, bufStar, bufMote, bufSpark, nStatic = 0, dynArr, dynCount = 0;
  let staticData, starData, moteData, sparkData;
  let W = 1, Hh = 1, cssW = 1, cssH = 1, dpr = 1, quality = 1, sizeDirty = true;
  const U = {};
  function shader(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  }
  function program(vs, fs, attribs) {
    const p = gl.createProgram(); gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, nm); }
    p.u = u; return p;
  }
  function setupGL() {
    progScene = program(VS, FS, ['aPos', 'aInfo']);
    progStar = program(VS_STAR, FS_PT, ['aS']);
    progMote = program(VS_MOTE, FS_PT, ['aS']);
    bufStatic = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufStatic); gl.bufferData(gl.ARRAY_BUFFER, staticData, gl.STATIC_DRAW);
    bufDyn = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufDyn); gl.bufferData(gl.ARRAY_BUFFER, dynArr.byteLength, gl.DYNAMIC_DRAW);
    bufStar = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufStar); gl.bufferData(gl.ARRAY_BUFFER, starData, gl.STATIC_DRAW);
    bufMote = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufMote); gl.bufferData(gl.ARRAY_BUFFER, moteData, gl.STATIC_DRAW);
    bufSpark = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufSpark); gl.bufferData(gl.ARRAY_BUFFER, sparkData, gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    sizeDirty = true;
  }
  function resize() {
    sizeDirty = false;
    cssW = canvas.clientWidth || innerWidth; cssH = canvas.clientHeight || innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2) * quality;
    const w = Math.max(2, Math.round(cssW * dpr)), h = Math.max(2, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    W = w; Hh = h; gl.viewport(0, 0, w, h);
  }

  /* ---------- state ---------- */
  let anchors = [{ y: 0, u: 0 }, { y: 1, u: 0 }], uNow = 0, themeT = 0, themeGoal = 0, reduced = false, running = false, raf = 0;
  let t0 = 0, lastT = 0, simT = 0, ready = false, readyAt = 0, frames = 0, slow = 0, dirty = true, lastScroll = -1;
  let mx = 0, my = 0, pmx = 0, pmy = 0, override = null, uForce = null, tFreeze = null, onReady = null, onFrame = null;
  const pal = new Float32Array(72), sky = [0, 0, 0], bob = new Float32Array(8), cur = { fog: 1 / 300, grain: 0.03 };
  const proj = marks.map(() => ({ x: 0, y: 0, on: false }));
  let VP = ident(), camPos = [0, 0, 0];

  function uTarget() {
    const y = window.scrollY || window.pageYOffset || 0, a = anchors;
    if (y <= a[0].y) return a[0].u;
    for (let i = 0; i < a.length - 1; i++) if (y <= a[i + 1].y) { const s = (y - a[i].y) / Math.max(1, a[i + 1].y - a[i].y); return a[i].u + (a[i + 1].u - a[i].u) * s; }
    return a[a.length - 1].u;
  }
  function emit(part, m, b) {
    const need = dynCount + part.count * 18;
    if (need > dynArr.length) { const n = new Float32Array(Math.max(need, dynArr.length * 2)); n.set(dynArr); dynArr = n; }
    const Pp = part.p, N = part.n, D = dynArr, sc = 1 / (Math.hypot(m[0], m[1], m[2]) || 1); let o = dynCount;
    for (let i = 0; i < part.count; i++) {
      const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      const l = ((m[0] * nx + m[4] * ny + m[8] * nz) * LIGHT[0] + (m[1] * nx + m[5] * ny + m[9] * nz) * LIGHT[1] + (m[2] * nx + m[6] * ny + m[10] * nz) * LIGHT[2]) * sc;
      const mt = part.m[i], pi = mt[toneOf(l, part.b[i])], f = mt.f;
      for (let k = 0; k < 3; k++) {
        const j = i * 9 + k * 3, x = Pp[j], y = Pp[j + 1], z = Pp[j + 2];
        D[o++] = m[0] * x + m[4] * y + m[8] * z + m[12]; D[o++] = m[1] * x + m[5] * y + m[9] * z + m[13]; D[o++] = m[2] * x + m[6] * y + m[10] * z + m[14];
        D[o++] = pi; D[o++] = f; D[o++] = b;
      }
    }
    dynCount = o;
  }

  function frame(now) {
    if (!gl || gl.isContextLost()) return;
    if (!t0) { t0 = now; lastT = now; }
    const raw = (now - lastT) / 1000, dt = clamp(raw, 0, 0.1); lastT = now;
    const sy = window.scrollY || 0;
    if (reduced && !dirty && sy === lastScroll && themeT === themeGoal && ready) return;
    lastScroll = sy; dirty = false;
    if (sizeDirty) resize();
    pool = POOL; poolN = 0;
    if (!reduced) simT += dt;
    const t = tFreeze !== null ? tFreeze : (reduced ? 9.5 : simT);

    /* theme */
    if (themeT !== themeGoal) { const d = themeGoal - themeT, s = dt * 2.2; themeT = Math.abs(d) <= s ? themeGoal : themeT + Math.sign(d) * s; }
    const A = THEMES.dark, B = THEMES.light, k = smooth(themeT);
    for (let i = 0; i < 72; i++) pal[i] = A.palF[i] + (B.palF[i] - A.palF[i]) * k;
    for (let i = 0; i < 3; i++) sky[i] = A.skyF[i] + (B.skyF[i] - A.skyF[i]) * k;
    cur.fog = A.fog + (B.fog - A.fog) * k; cur.grain = A.grain + (B.grain - A.grain) * k;

    /* camera */
    const ut = uForce !== null ? uForce : uTarget();
    /* asked for less motion, the camera does not fly: it stands at the stop nearest the scroll and cuts to the next one */
    if (uForce !== null) uNow = ut;
    else if (reduced) uNow = Math.round(ut);
    else { uNow += (ut - uNow) * (1 - Math.exp(-dt * 4.2)); if (Math.abs(ut - uNow) < 1e-4) uNow = ut; }
    let c = override || camAt(uNow), p = c.p.slice(), tg = c.t.slice(), fov = c.f;
    const asp = W / Hh;
    if (!override) {
      if (asp < 1.25) {                   /* a tall window stands further back and sees wider */
        const kk = clamp((1.25 - asp) / 0.8, 0, 1), back = 1 + 0.42 * kk;
        p = add(tg, [(p[0] - tg[0]) * back, (p[1] - tg[1]) * back, (p[2] - tg[2]) * back]);
        fov = fov + (74 - fov) * kk * 0.75;
      }
      if (!reduced) {
        pmx += (mx - pmx) * Math.min(1, dt * 3); pmy += (my - pmy) * Math.min(1, dt * 3);
        const fw = norm(sub(tg, p)), rt = norm(cross(fw, [0, 1, 0])), d = len(sub(tg, p));
        p = add(p, [rt[0] * pmx * d * 0.03 + Math.sin(t * 0.13) * 0.5, -pmy * d * 0.018 + Math.sin(t * 0.19) * 0.35, rt[2] * pmx * d * 0.03]);
        if (ready) {                      /* arrival: let down onto the first view */
          const e = clamp((now - readyAt) / 2600, 0, 1), r = (1 - e) * (1 - e) * (1 - e);
          p[1] += 20 * r; p[2] += 30 * r; tg[1] += 9 * r;
        }
      }
    }
    camPos = p;
    const Pm = mpersp(fov * Math.PI / 180, asp, 0.8, 1400), Vm = mlook(p, tg, [0, 1, 0]);
    VP = mmul(Pm, Vm);
    const Vr = mnew(); Vr.set(Vm); Vr[12] = Vr[13] = Vr[14] = 0;
    const VPs = mmul(Pm, Vr);

    /* islands ride slow swells */
    for (let i = 1; i < 8; i++) bob[i] = Math.sin(t * (0.42 + i * 0.045) + i * 1.9) * (0.38 + (i % 3) * 0.12);
    dynCount = 0;
    for (let i = 0; i < anim.length; i++) anim[i](t, emit);

    gl.clearColor(sky[0], sky[1], sky[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.useProgram(progScene); let u = progScene.u;
    gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniform3fv(u.uCam, p); gl.uniform3fv(u.uPal, pal); gl.uniform1fv(u.uBob, bob);
    gl.uniform3fv(u.uFog, sky); gl.uniform1f(u.uFogD, cur.fog); gl.uniform1f(u.uSeed, reduced ? 3 : Math.floor(t * 12) * 7.13 % 289);
    gl.uniform1f(u.uPx, Math.max(1, dpr)); gl.uniform1f(u.uGrain, cur.grain);
    gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufStatic); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, nStatic);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufDyn); gl.bufferData(gl.ARRAY_BUFFER, dynArr.subarray(0, dynCount), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, dynCount / 6);

    /* stars, motes, sparks */
    gl.disableVertexAttribArray(1); gl.enable(gl.BLEND); gl.depthMask(false);
    const sc = A.starF, sl = B.starF, mc = A.moteF, ml = B.moteF;
    gl.useProgram(progStar); u = progStar.u;
    gl.uniformMatrix4fv(u.uVP, false, VPs); gl.uniform1f(u.uTime, t); gl.uniform1f(u.uSize, dpr);
    gl.uniform3f(u.uCol, sc[0] + (sl[0] - sc[0]) * k, sc[1] + (sl[1] - sc[1]) * k, sc[2] + (sl[2] - sc[2]) * k);
    gl.uniform1f(u.uAlpha, A.starA + (B.starA - A.starA) * k); gl.uniform1f(u.uRound, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufStar); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.drawArrays(gl.POINTS, 0, starData.length / 4);
    gl.useProgram(progMote); u = progMote.u;
    gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniform1f(u.uTime, t); gl.uniform1f(u.uSize, dpr); gl.uniform1f(u.uRound, 1);
    gl.uniform3f(u.uCol, mc[0] + (ml[0] - mc[0]) * k, mc[1] + (ml[1] - mc[1]) * k, mc[2] + (ml[2] - mc[2]) * k);
    gl.uniform1f(u.uAlpha, A.moteA + (B.moteA - A.moteA) * k); gl.uniform1f(u.uRise, 1); gl.uniform1f(u.uSway, 1.6);
    gl.uniform3f(u.uBox0, -120, -34, -110); gl.uniform3f(u.uBoxS, 240, 140, 250);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufMote); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.drawArrays(gl.POINTS, 0, moteData.length / 4);
    gl.uniform3f(u.uCol, pal[13 * 3], pal[13 * 3 + 1], pal[13 * 3 + 2]); gl.uniform1f(u.uAlpha, 0.95); gl.uniform1f(u.uRise, 5); gl.uniform1f(u.uSway, 0.5);
    gl.uniform3f(u.uBox0, 0, 24.6 + bob[1], 0); gl.uniform3f(u.uBoxS, 1, 24, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufSpark); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.drawArrays(gl.POINTS, 0, sparkData.length / 4);
    gl.depthMask(true);

    /* labels follow their islands */
    if (onFrame) {
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i], x = m.p[0], y = m.p[1] + bob[m.b], z = m.p[2], w = VP[3] * x + VP[7] * y + VP[11] * z + VP[15], o = proj[i];
        if (w < 1) { o.on = false; continue; }
        o.x = ((VP[0] * x + VP[4] * y + VP[8] * z + VP[12]) / w * 0.5 + 0.5) * cssW; o.y = (0.5 - (VP[1] * x + VP[5] * y + VP[9] * z + VP[13]) / w * 0.5) * cssH;
        o.on = o.x > 24 && o.x < cssW - 24 && o.y > 56 && o.y < cssH - 24; o.d = w;
      }
      onFrame(proj, uNow);
    }

    pool = null;

    /* steady frames first, then show; step the resolution down rather than drop frames */
    frames++;
    if (!ready && (frames > 4 || reduced)) { ready = true; readyAt = now; if (onReady) onReady(); }
    if (ready && !reduced && now - readyAt > 3000 && raw < 0.25) {
      if (raw > 0.034) { if (++slow > 24 && quality > 0.55) { quality = Math.max(0.55, quality - 0.15); slow = 0; sizeDirty = true; } }
      else if (slow > 0) slow--;
    }
  }
  function loop(now) { raf = running ? requestAnimationFrame(loop) : 0; frame(now); }
  function start() { if (!running) { running = true; lastT = performance.now(); raf = requestAnimationFrame(loop); } }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  function init(cv, opt) {
    opt = opt || {};
    canvas = cv;
    try { gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: true, stencil: false }) || canvas.getContext('experimental-webgl'); } catch (e) { gl = null; }
    if (!gl) return false;
    onReady = opt.onReady || null; onFrame = opt.onFrame || null; reduced = !!opt.reduced;
    themeT = themeGoal = opt.theme === 'light' ? 1 : 0;
    try {
      staticData = buildWorld(); nStatic = staticData.length / 6;
      dynArr = new Float32Array(60000);
      const r = rng(2026), st = [], mo = [], sp = [];
      for (let i = 0; i < 900; i++) {
        let d; if (i % 9 === 0 && i > 0) { d = norm([st[i * 4 - 4] + (r() - 0.5) * 0.06, st[i * 4 - 3] + (r() - 0.5) * 0.06, st[i * 4 - 2] + (r() - 0.5) * 0.06]); }
        else { const z = r() * 2 - 1, a = r() * TAU, q = Math.sqrt(1 - z * z); d = [q * Math.cos(a), z, q * Math.sin(a)]; }
        st.push(d[0], d[1], d[2], r());
      }
      for (let i = 0; i < 170; i++) mo.push(-120 + r() * 240, -34 + r() * 140, -110 + r() * 250, r());
      for (let i = 0; i < 46; i++) sp.push((r() - 0.5) * 3.4, 42 + r() * 30, (r() - 0.5) * 3.4, r());
      starData = new Float32Array(st); moteData = new Float32Array(mo); sparkData = new Float32Array(sp);
      setupGL();
    } catch (e) { if (window.console) console.error('scene:', e); return false; }
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stop(); });
    canvas.addEventListener('webglcontextrestored', function () { try { setupGL(); dirty = true; start(); } catch (e) { /* stays on the plain ground */ } });
    addEventListener('resize', function () { sizeDirty = true; dirty = true; });
    if (window.ResizeObserver) new ResizeObserver(function () { sizeDirty = true; dirty = true; }).observe(canvas);
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
    if (window.matchMedia && matchMedia('(pointer:fine)').matches) addEventListener('pointermove', function (e) { mx = e.clientX / innerWidth * 2 - 1; my = e.clientY / innerHeight * 2 - 1; }, { passive: true });
    uNow = uTarget();
    start();
    return true;
  }

  window.Scene = {
    init: init,
    marks: marks,
    stops: STOPS.length,
    setTheme: function (name, instant) { themeGoal = name === 'light' ? 1 : 0; if (instant) themeT = themeGoal; dirty = true; },
    setAnchors: function (a) { if (a && a.length > 1) { anchors = a; dirty = true; } },
    setEffort: function (k) { effort = clamp(k | 0, 0, 3); dirty = true; },
    setMotion: function (on) { reduced = !on; dirty = true; },
    /* for looking around while building: Scene.dbg.cam([x,y,z],[x,y,z],fov) · .stop(i) · .free() · .time(s) */
    dbg: {
      cam: function (p, t, f) { override = { p: p, t: t, f: f || 50 }; dirty = true; },
      stop: function (i) { uForce = i; override = null; dirty = true; },
      free: function () { override = null; uForce = null; tFreeze = null; dirty = true; },
      time: function (s) { tFreeze = s; dirty = true; },
      /* one still frame, now, wherever the scroll is: for a page that is not being animated (a hidden tab, a snapshot) */
      draw: function () { const r = reduced; reduced = true; dirty = true; sizeDirty = true; frame(performance.now()); reduced = r; },
      info: function () { return { u: uNow, tris: nStatic / 3, dyn: dynCount / 18, quality: quality, w: W, h: Hh, ready: ready, cam: camPos }; },
      stops: STOPS
    }
  };
})();
