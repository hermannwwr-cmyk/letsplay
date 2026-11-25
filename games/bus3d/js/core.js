/* Bendy Bus 3D: core.
   The BB namespace, config and palette, a tiny event bus, storage (bus3d.*), a low-poly mesh builder,
   flat "paper" pictures drawn on canvas, WebAudio sound effects and an original looping tune, speech,
   and hub mode (the Let's Play! app protocol, see /CLAUDE.md "Hub <-> game protocol").
   Loaded first; every other file only adds to window.BB. */
(function () {
  'use strict';
  const BB = window.BB = window.BB || {};

  BB.HUB = /[?&]hub=1\b/.test(location.search) && window.parent !== window;
  BB.held = false;                       // true while the hub covers us ("turn me sideways") or the page is hidden

  // ---------- config ----------
  BB.cfg = {
    block: 46,              // distance between road junctions
    roadHalf: 5,            // half the road width
    lane: 2.6,              // lane centre from the road centre (we drive on the LEFT, like Singapore)
    corner: 7,              // how far before/after a junction a turn curve starts
    maxSpeed: 13,           // units per second with the GO pedal held
    accel: 5.5, coast: 7, turnSpeed: 7.5,
    fuelPerUnit: 1 / 2600,  // a full tank lasts roughly five jobs
    fuelLow: 0.25,
    pixelRatioCap: 2,
  };

  // Warm palette close to the hub's P (index.html), plus a few city colours.
  BB.P = {
    ink: '#3a2a3c', cream: '#fff6e0', paper: '#fdebc8', tan: '#e2c08d',
    honey: '#ffb81f', honeyLight: '#ffd45c', honeyDark: '#d98700',
    coral: '#ff6b5c', rose: '#ff8fab', teal: '#19a79b', mint: '#8fe0c4',
    leaf: '#6fc45a', grass: '#74c05a', grassDark: '#5aa848', pine: '#2a8f6c', pineDark: '#1d7460',
    sky: '#63c2f0', berry: '#5d73e8', plum: '#8e62c8',
    wood: '#c58a55', woodDark: '#9b6238', woodLight: '#e2b07c',
    road: '#7b7480', roadLine: '#fff3d6', pave: '#e4d6bd', kerb: '#cdbb9b',
    hdb: '#fbf1dc', glass: '#9cc7dc', glassDark: '#4d6f8a',
    busGreen: '#3fae49',
  };
  BB.PAINTS = [                        // the six paint pots at the depot
    { id: 'green', color: '#3fae49' }, { id: 'red', color: '#ef5a4b' }, { id: 'blue', color: '#3d8fe0' },
    { id: 'yellow', color: '#f5b83d' }, { id: 'purple', color: '#8e62c8' }, { id: 'pink', color: '#ff8fab' },
  ];

  // ---------- events ----------
  const handlers = Object.create(null);
  BB.on = (name, fn) => { (handlers[name] || (handlers[name] = [])).push(fn); return () => BB.off(name, fn); };
  BB.off = (name, fn) => { const l = handlers[name]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } };
  BB.emit = (name, data) => {
    const l = handlers[name]; if (!l) return;
    for (const fn of l.slice()) { try { fn(data); } catch (e) { console.error('[BB] ' + name, e); } }
  };

  // ---------- storage (every access in try/catch; works without storage) ----------
  BB.store = {
    get(key, def) {
      try { const v = localStorage.getItem('bus3d.' + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set(key, val) { try { localStorage.setItem('bus3d.' + key, JSON.stringify(val)); } catch (e) { /* no storage */ } },
  };
  const DEFAULT_SAVE = () => ({
    paint: 'green', upgrades: {}, stickers: [], fuel: 1, jobsDone: 0, questions: 0, seen: {},
    paints: ['green'], stickersOwned: [], parts: {}, partsOwned: [],
    busType: null, routeNo: '88', assist: false, leftHand: false, control: 'joystick',
  });
  // Hats were sold in an earlier build; they're gone from the shop, and depot.js gives their coins back.
  const HAT_PRICES = { party: 5, flowers: 6, bunny: 8, crown: 10 };
  BB.saveMigrate = { hatRefund: 0 };
  BB.save = (function () {
    const s = DEFAULT_SAVE(), got = BB.store.get('save', null);
    if (got && typeof got === 'object') {
      for (const k in s) if (k in got && got[k] != null) s[k] = got[k];
      if (typeof s.upgrades !== 'object') s.upgrades = {};
      if (typeof s.seen !== 'object') s.seen = {};
      for (const k of ['stickers', 'paints', 'stickersOwned', 'partsOwned']) if (!Array.isArray(s[k])) s[k] = k === 'paints' ? ['green'] : [];
      if (!s.parts || typeof s.parts !== 'object' || Array.isArray(s.parts)) s.parts = {};
      s.routeNo = /^[1-9][0-9]{0,2}$/.test(String(s.routeNo)) ? String(s.routeNo) : '88';
      if (s.busType != null && typeof s.busType !== 'string') s.busType = null;
      s.assist = !!s.assist; s.leftHand = !!s.leftHand; s.control = s.control === 'wheel' ? 'wheel' : 'joystick';
      if (Array.isArray(got.hatsOwned)) BB.saveMigrate.hatRefund = got.hatsOwned.reduce((n, id) => n + (HAT_PRICES[id] || 0), 0);
      s.fuel = Math.max(0, Math.min(1, +s.fuel || 0));
    }
    return s;
  })();
  BB.saveNow = () => BB.store.set('save', BB.save);

  // ---------- small DOM helpers ----------
  BB.css = (text) => { const s = document.createElement('style'); s.textContent = text; document.head.appendChild(s); return s; };
  BB.el = (tag, cls, parent, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  };
  // A button that fires on pointerup (iOS only allows sound/speech to start when the finger lifts).
  BB.tap = (el, fn) => {
    let down = false;
    el.addEventListener('pointerdown', (e) => { down = true; el.classList.add('pressed'); e.preventDefault(); });
    el.addEventListener('pointerup', (e) => { if (!down) return; down = false; el.classList.remove('pressed'); BB.audio.unlock(); fn(e); });
    el.addEventListener('pointerleave', () => { down = false; el.classList.remove('pressed'); });
    el.addEventListener('pointercancel', () => { down = false; el.classList.remove('pressed'); });
    return el;
  };
  BB.rand = (a, b) => a + Math.random() * (b - a);
  BB.randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  BB.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  BB.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  BB.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  BB.smooth = (t) => { t = BB.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  // Timers that stand still while the game is held (hub "turn me sideways" card, hidden page) and then carry on
  // with the time they had left. Use BB.later for every game-flow timer; BB.cancelLater(handle) stops one.
  const timers = new Set();
  BB.later = (ms, fn) => {
    const t = { ms: Math.max(0, +ms || 0), start: performance.now(), id: 0 };
    t.fire = () => { if (!timers.delete(t)) return; try { fn(); } catch (e) { console.error(e); } };
    timers.add(t);
    if (!BB.held) t.id = setTimeout(t.fire, t.ms);
    return t;
  };
  BB.cancelLater = (t) => { if (t && t.fire) { clearTimeout(t.id); timers.delete(t); } };
  BB.wait = (ms) => new Promise((r) => BB.later(ms, r));
  function freezeTimers(on) {
    const now = performance.now();
    for (const t of timers) {
      if (on) { clearTimeout(t.id); t.ms = Math.max(0, t.ms - (now - t.start)); }
      else { t.start = now; t.id = setTimeout(t.fire, t.ms); }
    }
  }

  // ---------- low-poly mesh builder ----------
  // Collects many small parts (each with a flat colour and a transform) and merges them into ONE flat-shaded,
  // vertex-coloured BufferGeometry, so a whole street of houses is a single draw call.
  // Usage: const b = BB.mk.builder(); b.box(w,h,d, color, x,y,z, ry); ...; scene.add(b.mesh());
  // y in box/cyl/prism is the BOTTOM of the part.
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
  const _c = new THREE.Color();
  class Builder {
    constructor() { this.parts = []; this.stack = [new THREE.Matrix4()]; }
    get base() { return this.stack[this.stack.length - 1]; }
    // Run fn with everything placed relative to (x,y,z) turned by ry.
    at(x, y, z, ry, fn) {
      const m = new THREE.Matrix4().makeRotationY(ry || 0).setPosition(x, y, z);
      this.stack.push(this.base.clone().multiply(m)); fn(this); this.stack.pop(); return this;
    }
    addM(geo, color, matrix) {
      this.parts.push({ geo, color: new THREE.Color(color), m: this.base.clone().multiply(matrix) });
      return this;
    }
    add(geo, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
      _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
      return this.addM(geo, color, new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)));
    }
    box(w, h, d, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
      return this.add(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, ry, rx, rz);
    }
    cyl(rTop, rBot, h, seg, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
      return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, x, y + h / 2, z, ry, rx, rz);
    }
    // Triangular prism (a pitched roof): length along local x, width w along z, height h.
    prism(len, w, h, color, x = 0, y = 0, z = 0, ry = 0) {
      const g = new THREE.CylinderGeometry(1, 1, len, 3);      // triangle with a point up after the turn
      g.rotateZ(Math.PI / 2); g.rotateX(Math.PI / 2 + Math.PI);
      g.scale(1, h / 1.5, w / Math.sqrt(3));
      g.translate(0, 0.5 * h / 1.5, 0);
      return this.add(g, color, x, y, z, ry);
    }
    ball(r, color, x = 0, y = 0, z = 0, detail = 0, sx = 1, sy = 1, sz = 1) {
      return this.add(new THREE.IcosahedronGeometry(r, detail), color, x, y, z, 0, 0, 0, sx, sy, sz);
    }
    disc(r, seg, color, x = 0, y = 0, z = 0, sx = 1, sz = 1) {
      const g = new THREE.CircleGeometry(r, seg); g.rotateX(-Math.PI / 2);
      return this.add(g, color, x, y, z, 0, 0, 0, sx, 1, sz);
    }
    // A flat strip along a polyline [{x,z}] from offset o1 to o2 (left of travel is +), at height y.
    strip(pts, o1, o2, y, color) {
      const pos = [];
      const n = pts.length;
      const L = [];
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        L.push({ lx: dz, lz: -dx });
      }
      for (let i = 0; i < n - 1; i++) {
        const p = pts[i], q = pts[i + 1], lp = L[i], lq = L[i + 1];
        const A = [p.x + lp.lx * o1, y, p.z + lp.lz * o1], B = [p.x + lp.lx * o2, y, p.z + lp.lz * o2];
        const C = [q.x + lq.lx * o1, y, q.z + lq.lz * o1], D = [q.x + lq.lx * o2, y, q.z + lq.lz * o2];
        // two triangles facing up whichever side o1/o2 is on
        if (o2 > o1) pos.push(...A, ...C, ...B, ...B, ...C, ...D); else pos.push(...A, ...B, ...C, ...B, ...D, ...C);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      return this.addM(g, color, new THREE.Matrix4());
    }
    geometry() {
      let total = 0;
      const gs = this.parts.map((p) => {
        let g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
        g.applyMatrix4(p.m);
        total += g.attributes.position.count;
        return { g, c: p.color };
      });
      const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
      let o = 0;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (const { g, c: color } of gs) {
        const src = g.attributes.position.array, cnt = g.attributes.position.count;
        pos.set(src.subarray(0, cnt * 3), o * 3);
        for (let i = 0; i < cnt; i += 3) {          // flat normals: one per triangle
          a.fromArray(src, i * 3); b.fromArray(src, i * 3 + 3); c.fromArray(src, i * 3 + 6);
          b.sub(a); c.sub(a); b.cross(c).normalize();
          for (let k = 0; k < 3; k++) { nor[(o + i + k) * 3] = b.x; nor[(o + i + k) * 3 + 1] = b.y; nor[(o + i + k) * 3 + 2] = b.z; }
        }
        for (let i = 0; i < cnt; i++) { col[(o + i) * 3] = color.r; col[(o + i) * 3 + 1] = color.g; col[(o + i) * 3 + 2] = color.b; }
        o += cnt;
        g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      out.setAttribute('color', new THREE.BufferAttribute(col, 3));
      out.computeBoundingSphere();
      return out;
    }
    mesh(material) { return new THREE.Mesh(this.geometry(), material || BB.mk.mat); }
  }
  BB.mk = {
    builder: () => new Builder(),
    mat: new THREE.MeshLambertMaterial({ vertexColors: true }),
    // Soft round blob shadow texture (no shadow maps).
    blobTex: (function () {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 4, 32, 32, 31);
      g.addColorStop(0, 'rgba(40,24,48,0.42)'); g.addColorStop(0.6, 'rgba(40,24,48,0.22)'); g.addColorStop(1, 'rgba(40,24,48,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })(),
  };
  BB.mk.blob = (w, d) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: BB.mk.blobTex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 1;
    return m;
  };

  // ---------- the paper-cut art kit (shared by the HUD, the garage, the family room and the stop signs) ----------
  // One look everywhere: flat shapes, a darker crescent on the lower right, a rim in a deeper tone of the same colour,
  // no black outlines, rounded lettering (Fredoka, built into index.html).
  BB.FONT = "'Fredoka', 'Baloo 2', ui-rounded, system-ui, sans-serif";
  const hexN = (c) => { c = String(c || '#000000').replace('#', ''); if (c.length === 3) c = c.replace(/./g, '$&$&'); return parseInt(c.slice(0, 6), 16) || 0; };
  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(BB.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  BB.mixHex = (a, b, t) => { const A = hexN(a), Z = hexN(b), m = (s) => ((A >> s) & 255) * (1 - t) + ((Z >> s) & 255) * t; return toHex(m(16), m(8), m(0)); };
  BB.dark = (c, t = 0.22) => { if (!/^#/.test(c)) return c; const n = hexN(c); return toHex(((n >> 16) & 255) * (1 - t), ((n >> 8) & 255) * (1 - t), (n & 255) * (1 - t)); };
  BB.light = (c, t = 0.35) => (/^#/.test(c) ? BB.mixHex(c, '#ffffff', t) : c);
  // Fill a shape the paper-cut way on a 100x100 board: the shape in a deeper tone, then again nudged up-left (so a
  // darker crescent shows on the lower right), then its rim. build: a Path2D or fn(path). o: {depth, rim, rimW, rimColor}
  BB.paper = function (x, build, fill, o = {}) {
    let p = build;
    if (!(build instanceof Path2D)) { p = new Path2D(); build(p); }
    const d = o.depth == null ? 1 : o.depth;
    x.fillStyle = BB.dark(fill, 0.18); x.fill(p);
    x.save(); x.clip(p); x.translate(-3.6 * d, -4.4 * d); x.fillStyle = fill; x.fill(p); x.restore();
    if (o.rim !== false) {
      x.save(); x.lineJoin = 'round'; x.lineWidth = o.rimW || 2.4; x.strokeStyle = o.rimColor || BB.dark(fill, 0.3); x.stroke(p); x.restore();
    }
    return p;
  };
  // A coloured stroke the paper way (a deeper tone underneath, a little lower right).
  BB.paperStroke = function (x, build, color, w) {
    const p = new Path2D(); build(p);
    x.save(); x.lineCap = x.lineJoin = 'round'; x.lineWidth = w;
    x.translate(1.4, 1.8); x.strokeStyle = BB.dark(color, 0.3); x.stroke(p);
    x.translate(-1.4, -1.8); x.strokeStyle = color; x.stroke(p); x.restore();
    return p;
  };
  const rrP = (p, X, Y, W, H, R) => { if (p.roundRect) p.roundRect(X, Y, W, H, R); else p.rect(X, Y, W, H); };
  const arcP = (p, X, Y, R) => { p.moveTo(X + R, Y); p.arc(X, Y, R, 0, Math.PI * 2); };
  const starP = (p, cx, cy, R, r, n = 5) => {
    for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, rad = i % 2 ? r : R; if (i) p.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); else p.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
    p.closePath();
  };
  const heartP = (p, cx, cy, s) => { p.moveTo(cx, cy + 30 * s); p.bezierCurveTo(cx - 44 * s, cy + 2 * s, cx - 30 * s, cy - 36 * s, cx, cy - 16 * s); p.bezierCurveTo(cx + 30 * s, cy - 36 * s, cx + 44 * s, cy + 2 * s, cx, cy + 30 * s); p.closePath(); };
  BB.paths = { rr: rrP, arc: arcP, star: starP, heart: heartP };
  function board(size, draw) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'); x.scale(size / 100, size / 100); x.lineJoin = 'round'; x.lineCap = 'round';
    draw(x);
    return c;
  }
  const dot = (x, X, Y, R, fill) => { x.beginPath(); x.arc(X, Y, R, 0, Math.PI * 2); x.fillStyle = fill; x.fill(); };
  const shine = (x, X, Y, RX, RY, rot = -0.6, a = 0.5) => { x.beginPath(); x.ellipse(X, Y, RX, RY, rot, 0, Math.PI * 2); x.fillStyle = `rgba(255,255,255,${a})`; x.fill(); };
  // a little bus seen from the side, facing right, about 84*s wide, top-left at (ox, oy)
  function sideBus(x, ox, oy, s, col, type) {
    x.save(); x.translate(ox, oy); x.scale(s, s);
    const dbl = type === 'double', bendy = type === 'bendy', top = dbl ? -6 : 14;
    const body = (bx, bw) => BB.paper(x, (p) => rrP(p, bx, top, bw, 60 - top, 9), col, { rimW: 2.4 / s });
    if (bendy) { body(0, 46); body(50, 38); x.fillStyle = '#5a5260'; x.fillRect(45, top + 6, 6, 60 - top - 12); } else body(0, 86);
    x.fillStyle = '#d4eef8';
    for (const ry of dbl ? [top + 7, top + 31] : [top + 8]) for (let wx = 6; wx < 72; wx += 15) if (!(bendy && wx > 38 && wx < 52)) { x.beginPath(); rrP(x, wx, ry, 11, 13, 3); x.fill(); }
    x.beginPath(); rrP(x, 74, top + 6, 9, 22, 3); x.fill();
    for (const wx of bendy ? [16, 36, 74] : [18, 68]) { BB.paper(x, (p) => arcP(p, wx, 62, 9), '#3a343f', { depth: 0.5, rim: false }); dot(x, wx, 62, 4, '#c9d2db'); }
    x.restore();
  }
  BB.sideBus = sideBus;

  // ---------- pictures: BB.pic(name, size) -> canvas (stop signs, the job card, coins) ----------
  // bowl (hawker centre), slide (playground), train (MRT), tree (park), shop (shophouses), depot (bus garage), coin, pump.
  const picCache = {};
  BB.pic = function (name, size = 128) {
    const key = name + size;
    if (picCache[key]) return picCache[key];
    const P = BB.P, paper = BB.paper;
    const c = board(size, (x) => {
      switch (name) {
        case 'bowl':
          for (const sx of [38, 50, 62]) BB.paperStroke(x, (p) => { p.moveTo(sx, 34); p.bezierCurveTo(sx - 7, 26, sx + 7, 20, sx, 10); }, '#eaf4fb', 4.5);
          BB.paperStroke(x, (p) => { p.moveTo(58, 48); p.lineTo(86, 20); p.moveTo(65, 50); p.lineTo(93, 26); }, P.woodDark, 4);
          paper(x, (p) => p.ellipse(50, 50, 32, 9, 0, 0, Math.PI * 2), P.honeyLight, { depth: 0.4 });
          paper(x, (p) => { p.moveTo(14, 50); p.lineTo(86, 50); p.arc(50, 50, 36, 0, Math.PI); p.closePath(); }, P.coral);
          paper(x, (p) => rrP(p, 30, 84, 40, 7, 3.5), '#d94c40', { depth: 0.3 });
          x.fillStyle = '#fff6e0'; for (const wx of [32, 50, 68]) dot(x, wx, 64, 3.2, '#fff6e0');
          break;
        case 'slide':
          paper(x, (p) => rrP(p, 16, 28, 9, 62, 3), P.berry, { depth: 0.4 }); paper(x, (p) => rrP(p, 40, 28, 9, 62, 3), P.berry, { depth: 0.4 });
          for (let i = 0; i < 4; i++) paper(x, (p) => rrP(p, 22, 40 + i * 12, 22, 5, 2.5), P.honeyLight, { depth: 0.2, rimW: 1.6 });
          paper(x, (p) => rrP(p, 12, 20, 42, 11, 5), P.coral, { depth: 0.5 });
          paper(x, (p) => { p.moveTo(48, 28); p.quadraticCurveTo(72, 36, 92, 84); p.lineTo(80, 89); p.quadraticCurveTo(64, 50, 46, 42); p.closePath(); }, P.honey, { depth: 0.6 });
          break;
        case 'train':
          paper(x, (p) => rrP(p, 4, 84, 92, 7, 3.5), '#8a8290', { depth: 0.3 });
          paper(x, (p) => rrP(p, 10, 24, 80, 50, 15), '#f4f1ea');
          paper(x, (p) => rrP(p, 10, 58, 80, 8, 2), P.coral, { depth: 0.3, rimW: 1.6 });
          for (const wx of [18, 41, 64]) paper(x, (p) => rrP(p, wx, 32, 18, 17, 4), P.glassDark, { depth: 0.3, rimW: 1.4 });
          for (const wx of [28, 72]) { paper(x, (p) => arcP(p, wx, 78, 7), '#555059', { depth: 0.4, rim: false }); dot(x, wx, 78, 2.6, '#c9d2db'); }
          break;
        case 'tree':
          paper(x, (p) => rrP(p, 43, 54, 14, 38, 4), P.woodDark, { depth: 0.5 });
          paper(x, (p) => { arcP(p, 50, 38, 26); arcP(p, 29, 52, 16); arcP(p, 71, 52, 16); }, P.leaf);
          shine(x, 40, 28, 9, 6, -0.5, 0.35);
          break;
        case 'shop':
          paper(x, (p) => rrP(p, 14, 32, 72, 58, 4), P.mint);
          paper(x, (p) => { p.moveTo(8, 34); p.lineTo(50, 10); p.lineTo(92, 34); p.closePath(); }, P.coral);
          for (let i = 0; i < 6; i++) { x.fillStyle = i % 2 ? '#fff6e0' : P.coral; x.beginPath(); x.moveTo(14 + i * 12, 44); x.lineTo(26 + i * 12, 44); x.lineTo(26 + i * 12, 54); x.arc(20 + i * 12, 54, 6, 0, Math.PI); x.closePath(); x.fill(); }
          paper(x, (p) => rrP(p, 22, 64, 18, 26, 3), P.woodDark, { depth: 0.4 }); paper(x, (p) => rrP(p, 50, 64, 28, 16, 3), P.glass, { depth: 0.3 });
          break;
        case 'depot':
          paper(x, (p) => rrP(p, 12, 38, 76, 52, 4), P.cream);
          paper(x, (p) => { p.moveTo(4, 42); p.lineTo(50, 12); p.lineTo(96, 42); p.closePath(); }, P.teal);
          paper(x, (p) => rrP(p, 22, 50, 56, 40, 4), '#5a4a5c', { depth: 0.4 });
          paper(x, (p) => rrP(p, 27, 62, 46, 22, 6), P.busGreen, { depth: 0.5 });
          x.fillStyle = '#d4eef8'; x.beginPath(); rrP(x, 31, 66, 30, 7, 2); x.fill();
          for (const wx of [37, 63]) dot(x, wx, 86, 5, '#3a343f');
          break;
        case 'coin':
          paper(x, (p) => arcP(p, 50, 50, 44), P.honey, { depth: 1.2, rimColor: P.honeyDark, rimW: 3.5 });
          paper(x, (p) => arcP(p, 48, 48, 28), P.honeyLight, { depth: -0.5, rim: false });
          paper(x, (p) => starP(p, 48, 49, 19, 8.5), P.honey, { depth: 0.4, rimColor: P.honeyDark, rimW: 2 });
          shine(x, 30, 28, 9, 5, -0.7, 0.55);
          break;
        case 'pump':
          paper(x, (p) => rrP(p, 10, 86, 60, 8, 4), '#8a8290', { depth: 0.3 });
          paper(x, (p) => rrP(p, 18, 14, 44, 76, 9), P.coral);
          paper(x, (p) => rrP(p, 25, 23, 30, 21, 4), P.cream, { depth: 0.3 });
          BB.paperStroke(x, (p) => { p.moveTo(62, 32); p.quadraticCurveTo(86, 34, 82, 60); p.lineTo(82, 68); }, '#5a5260', 6);
          paper(x, (p) => rrP(p, 75, 62, 13, 20, 4), '#5a5260', { depth: 0.4 });
          dot(x, 40, 60, 6, BB.dark(P.coral, 0.25));
          break;
        default:
          paper(x, (p) => arcP(p, 50, 50, 40), P.plum);
      }
    });
    picCache[key] = c;
    return c;
  };

  // ---------- UI icons: BB.icon(name, size) -> canvas (the HUD, the garage, the cards) ----------
  // home, garage, music, musicOff, sound, soundOff, horn, helper, helperOn, uturn, joystick, wheel, handR, handL,
  // mybus (in the current paint), shop, settings, together, lights, bumpers, wheels, stickers, extras, colour,
  // check, cross, speak, back (delete), fuel, coin, number, clock.
  const iconCache = {};
  BB.icon = function (name, size = 96) {
    const paint = (BB.PAINTS.find((p) => p.id === BB.save.paint) || BB.PAINTS[0]).color;
    const key = name + ':' + size + (name === 'mybus' || name === 'together' ? paint : '');
    if (iconCache[key]) return iconCache[key];
    const P = BB.P, paper = BB.paper;
    const c = board(size, (x) => {
      const house = (roof, door = P.wood) => {
        paper(x, (p) => rrP(p, 64, 18, 11, 22, 2), BB.dark(roof, 0.1), { depth: 0.4 });
        paper(x, (p) => rrP(p, 20, 44, 60, 46, 6), P.cream);
        paper(x, (p) => { p.moveTo(10, 50); p.lineTo(50, 13); p.lineTo(90, 50); p.closePath(); }, roof);
        paper(x, (p) => rrP(p, 42, 62, 16, 28, 5), door, { depth: 0.4 });
        for (const wx of [27, 62]) paper(x, (p) => rrP(p, wx, 56, 11, 11, 2.5), P.glass, { depth: 0.25, rimW: 1.6 });
      };
      const noteP = (p) => {
        p.ellipse(31, 74, 13, 10, -0.4, 0, Math.PI * 2); p.moveTo(84, 65); p.ellipse(71, 66, 13, 10, -0.4, 0, Math.PI * 2);
        p.moveTo(37, 74); p.lineTo(37, 26); p.lineTo(84, 14); p.lineTo(84, 66); p.lineTo(77, 66); p.lineTo(77, 30); p.lineTo(44, 38); p.lineTo(44, 74); p.closePath();
      };
      const speaker = (col) => {
        paper(x, (p) => { rrP(p, 10, 37, 20, 26, 5); p.moveTo(26, 38); p.lineTo(52, 18); p.quadraticCurveTo(56, 16, 56, 22); p.lineTo(56, 78); p.quadraticCurveTo(56, 84, 52, 82); p.lineTo(26, 62); p.closePath(); }, col);
      };
      const slash = () => {     // "off": a coral paper strip across
        x.save(); x.translate(50, 50); x.rotate(Math.PI / 4);
        paper(x, (p) => rrP(p, -52, -7, 104, 14, 7), P.coral, { depth: 0.4 }); x.restore();
      };
      const helperBus = (on) => {
        BB.paperStroke(x, (p) => { p.moveTo(16, 8); p.lineTo(16, 92); }, '#a9b3be', 6); BB.paperStroke(x, (p) => { p.moveTo(84, 8); p.lineTo(84, 92); }, '#a9b3be', 6);
        x.save(); x.globalCompositeOperation = 'destination-out'; x.fillStyle = '#000';
        for (let y = 20; y < 92; y += 22) { x.fillRect(10, y, 12, 9); x.fillRect(78, y, 12, 9); } x.restore();
        paper(x, (p) => rrP(p, 33, 16, 34, 68, 11), P.busGreen);
        paper(x, (p) => rrP(p, 38, 22, 24, 13, 4), '#d4eef8', { depth: 0.2, rimW: 1.5 });
        if (on) paper(x, (p) => starP(p, 80, 20, 17, 7, 4), P.honey, { depth: 0.5 });
      };
      const wheelArt = () => {
        BB.paperStroke(x, (p) => p.arc(50, 50, 37, 0, Math.PI * 2), '#5a5260', 12);
        BB.paperStroke(x, (p) => { p.moveTo(15, 47); p.lineTo(36, 47); p.moveTo(64, 47); p.lineTo(85, 47); p.moveTo(50, 62); p.lineTo(50, 86); }, '#6c6470', 9);
        paper(x, (p) => arcP(p, 50, 50, 16), '#f26b5b');
        paper(x, (p) => rrP(p, 46, 6, 8, 12, 3), P.honey, { depth: 0.3 });
      };
      const joyArt = (cx = 50, cy = 52, s = 1) => {
        paper(x, (p) => arcP(p, cx, cy, 40 * s), '#f1dfb8', { rimColor: '#d9b57f' });
        x.fillStyle = '#3fae49'; x.beginPath(); x.moveTo(cx, cy - 35 * s); x.lineTo(cx + 7 * s, cy - 26 * s); x.lineTo(cx - 7 * s, cy - 26 * s); x.fill();
        x.fillStyle = '#f5a23d'; x.beginPath(); x.moveTo(cx, cy + 35 * s); x.lineTo(cx + 7 * s, cy + 26 * s); x.lineTo(cx - 7 * s, cy + 26 * s); x.fill();
        x.fillStyle = '#19a79b'; x.beginPath(); x.moveTo(cx - 35 * s, cy); x.lineTo(cx - 26 * s, cy - 7 * s); x.lineTo(cx - 26 * s, cy + 7 * s); x.fill();
        x.beginPath(); x.moveTo(cx + 35 * s, cy); x.lineTo(cx + 26 * s, cy - 7 * s); x.lineTo(cx + 26 * s, cy + 7 * s); x.fill();
        paper(x, (p) => arcP(p, cx, cy, 18 * s), '#3fae49');
        shine(x, cx - 6 * s, cy - 7 * s, 6 * s, 3.5 * s, -0.6, 0.5);
      };
      const tabletWithJoy = (left) => {
        paper(x, (p) => rrP(p, 6, 22, 88, 58, 12), '#5a5260');
        paper(x, (p) => rrP(p, 13, 29, 74, 44, 6), '#bfe0f0', { depth: 0.2, rim: false });
        x.fillStyle = '#9cc7dc'; x.fillRect(13, 58, 74, 15);
        const jx = left ? 28 : 72;
        paper(x, (p) => arcP(p, jx, 56, 13), '#fff6e0', { depth: 0.3, rimColor: '#d9b57f', rimW: 2 });
        paper(x, (p) => arcP(p, jx, 56, 6.5), '#3fae49', { depth: 0.3, rimW: 1.4 });
        paper(x, (p) => rrP(p, left ? 62 : 26, 40, 13, 9, 3), P.busGreen, { depth: 0.2, rimW: 1.4 });
      };
      switch (name) {
        case 'home': house(P.coral); break;
        case 'garage': x.drawImage(BB.pic('depot', 200), 0, 0, 100, 100); break;
        case 'music': paper(x, noteP, P.plum); break;
        case 'musicOff': x.globalAlpha = 0.55; paper(x, noteP, '#a99bb8'); x.globalAlpha = 1; slash(); break;
        case 'sound':
          speaker(P.teal);
          for (const r of [16, 30]) BB.paperStroke(x, (p) => p.arc(58, 50, r, -0.75, 0.75), P.teal, 7);
          break;
        case 'soundOff':
          x.globalAlpha = 0.6; speaker('#8fb8b4'); x.globalAlpha = 1;
          paper(x, (p) => arcP(p, 74, 50, 19), P.coral);
          BB.paperStroke(x, (p) => { p.moveTo(67, 43); p.lineTo(81, 57); p.moveTo(81, 43); p.lineTo(67, 57); }, '#ffffff', 6);
          break;
        case 'horn':
          paper(x, (p) => arcP(p, 15, 50, 13), P.coral);
          paper(x, (p) => rrP(p, 25, 45, 14, 10, 3), P.honeyDark, { depth: 0.3 });
          paper(x, (p) => { p.moveTo(37, 45); p.lineTo(64, 24); p.quadraticCurveTo(70, 50, 64, 76); p.lineTo(37, 55); p.closePath(); }, P.honey);
          paper(x, (p) => p.ellipse(65, 50, 6, 26, 0, 0, Math.PI * 2), P.honeyDark, { depth: 0.3 });
          for (const r of [17, 26]) BB.paperStroke(x, (p) => p.arc(66, 50, r, -0.55, 0.55), P.coral, 4.5);
          break;
        case 'helper': helperBus(false); break;
        case 'helperOn': helperBus(true); break;
        case 'uturn':
          BB.paperStroke(x, (p) => { p.moveTo(28, 88); p.lineTo(28, 44); p.arc(50, 44, 22, Math.PI, 0); p.lineTo(72, 50); }, P.teal, 14);
          paper(x, (p) => { p.moveTo(54, 48); p.lineTo(90, 48); p.lineTo(72, 74); p.closePath(); }, P.teal, { depth: 0.5 });
          break;
        case 'joystick': joyArt(); break;
        case 'wheel': wheelArt(); break;
        case 'handR': tabletWithJoy(false); break;
        case 'handL': tabletWithJoy(true); break;
        case 'mybus': sideBus(x, 6, 18, 1.04, paint, 'single'); break;
        case 'shop':
          BB.paperStroke(x, (p) => { p.moveTo(34, 38); p.lineTo(34, 30); p.arc(50, 30, 16, Math.PI, 0); p.lineTo(66, 38); }, BB.dark(P.coral, 0.15), 6);
          paper(x, (p) => { p.moveTo(18, 36); p.lineTo(82, 36); p.lineTo(88, 90); p.lineTo(12, 90); p.closePath(); }, P.coral);
          paper(x, (p) => starP(p, 50, 63, 19, 8.5), P.honeyLight, { depth: 0.4 });
          break;
        case 'settings': {
          const g = (p) => {
            const n = 8;
            for (let i = 0; i < n * 2; i++) {
              const a0 = (i / (n * 2)) * Math.PI * 2, a1 = ((i + 1) / (n * 2)) * Math.PI * 2, r = i % 2 ? 30 : 41;
              if (!i) p.moveTo(50 + Math.cos(a0) * r, 50 + Math.sin(a0) * r); else p.lineTo(50 + Math.cos(a0) * r, 50 + Math.sin(a0) * r);
              p.lineTo(50 + Math.cos(a1) * r, 50 + Math.sin(a1) * r);
            }
            p.closePath();
          };
          paper(x, g, P.teal);
          paper(x, (p) => arcP(p, 50, 50, 15), P.cream, { depth: -0.6 });
          break;
        }
        case 'together':
          sideBus(x, 2, 44, 0.6, paint === '#3d8fe0' ? '#3fae49' : '#3d8fe0', 'single');
          sideBus(x, 42, 54, 0.6, paint, 'single');
          paper(x, (p) => heartP(p, 50, 26, 0.55), '#ef5a4b');
          break;
        case 'lights':
          x.fillStyle = 'rgba(255,200,60,.7)';
          for (let i = 0; i < 7; i++) { x.save(); x.translate(50, 42); x.rotate(-Math.PI / 2 + (i - 3) * 0.48); x.beginPath(); rrP(x, -3, -46, 6, 12, 3); x.fill(); x.restore(); }
          paper(x, (p) => { p.arc(50, 42, 24, Math.PI * 0.8, Math.PI * 2.2); p.lineTo(60, 66); p.lineTo(40, 66); p.closePath(); }, P.honeyLight);
          paper(x, (p) => rrP(p, 38, 64, 24, 20, 5), '#9aa4b0', { depth: 0.4 });
          x.fillStyle = '#7a838e'; x.fillRect(38, 70, 24, 3); x.fillRect(38, 76, 24, 3);
          shine(x, 41, 33, 6, 9, 0.5, 0.75);
          break;
        case 'bumpers':
          paper(x, (p) => rrP(p, 18, 10, 64, 64, 13), P.busGreen);
          paper(x, (p) => rrP(p, 25, 17, 50, 26, 6), '#d4eef8', { depth: 0.25, rimW: 1.6 });
          for (const wx of [31, 69]) paper(x, (p) => arcP(p, wx, 57, 6), '#fff1a8', { depth: 0.3, rimW: 1.4 });
          paper(x, (p) => rrP(p, 8, 70, 84, 16, 8), '#b8c2cc');
          shine(x, 30, 75, 14, 2.5, 0, 0.85);
          break;
        case 'wheels':
          paper(x, (p) => arcP(p, 50, 50, 42), '#3a343f', { rim: false });
          paper(x, (p) => arcP(p, 50, 50, 25), '#f5b83d');
          for (let i = 0; i < 5; i++) { const a = i * Math.PI * 0.4 - Math.PI / 2; dot(x, 50 + Math.cos(a) * 14, 50 + Math.sin(a) * 14, 4.2, BB.dark('#f5b83d', 0.28)); }
          dot(x, 50, 50, 5.5, BB.dark('#f5b83d', 0.38));
          shine(x, 40, 40, 6, 3.5, -0.6, 0.5);
          break;
        case 'stickers': {
          const s = new Path2D(); starP(s, 50, 53, 42, 19);
          x.save(); x.lineJoin = 'round'; x.lineWidth = 12; x.strokeStyle = '#ffffff'; x.shadowColor = 'rgba(80,50,30,.25)'; x.shadowOffsetX = 1.5; x.shadowOffsetY = 2.5; x.shadowBlur = 2; x.stroke(s); x.restore();
          x.fillStyle = '#ffffff'; x.fill(s);
          paper(x, s, P.honey);
          break;
        }
        case 'extras':
          paper(x, (p) => rrP(p, 16, 42, 68, 48, 6), P.coral);
          paper(x, (p) => rrP(p, 10, 32, 80, 16, 5), BB.light(P.coral, 0.12));
          paper(x, (p) => rrP(p, 43, 32, 14, 58, 2), P.honey, { depth: 0.3 });
          paper(x, (p) => { p.ellipse(38, 24, 13, 9, -0.5, 0, Math.PI * 2); p.moveTo(75, 24); p.ellipse(62, 24, 13, 9, 0.5, 0, Math.PI * 2); }, P.honey, { depth: 0.4 });
          break;
        case 'colour':
          paper(x, (p) => { p.moveTo(22, 40); p.lineTo(78, 40); p.lineTo(72, 90); p.quadraticCurveTo(50, 96, 28, 90); p.closePath(); }, '#cfd6de');
          paper(x, (p) => p.ellipse(50, 40, 29, 9, 0, 0, Math.PI * 2), P.coral, { depth: 0.3 });
          paper(x, (p) => { p.moveTo(30, 42); p.lineTo(40, 42); p.lineTo(40, 62); p.arc(35, 62, 5, 0, Math.PI); p.closePath(); }, P.coral, { depth: 0.3 });
          paper(x, (p) => { p.moveTo(64, 6); p.lineTo(82, 14); p.lineTo(70, 40); p.lineTo(58, 34); p.closePath(); }, P.woodLight, { depth: 0.4 });
          paper(x, (p) => { p.moveTo(58, 34); p.lineTo(70, 40); p.lineTo(66, 50); p.lineTo(54, 44); p.closePath(); }, P.teal, { depth: 0.3 });
          break;
        case 'number':
          paper(x, (p) => rrP(p, 4, 26, 92, 48, 10), '#2b2430');
          x.fillStyle = '#ffb81f'; x.font = '800 34px "Courier New", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.shadowColor = 'rgba(255,184,31,.8)'; x.shadowBlur = 6; x.fillText(String(BB.save.routeNo || '88'), 50, 51);
          break;
        case 'check':
          paper(x, (p) => arcP(p, 50, 50, 44), '#5cb85c');
          BB.paperStroke(x, (p) => { p.moveTo(28, 52); p.lineTo(44, 67); p.lineTo(73, 35); }, '#ffffff', 11);
          break;
        case 'cross':
          paper(x, (p) => arcP(p, 50, 50, 44), '#f26b5b');
          BB.paperStroke(x, (p) => { p.moveTo(34, 34); p.lineTo(66, 66); p.moveTo(66, 34); p.lineTo(34, 66); }, '#ffffff', 10);
          break;
        case 'speak':
          speaker('#4fa3e0');
          for (const r of [16, 30]) BB.paperStroke(x, (p) => p.arc(58, 50, r, -0.75, 0.75), '#4fa3e0', 7);
          break;
        case 'back':
          paper(x, (p) => { p.moveTo(36, 22); p.lineTo(90, 22); p.lineTo(90, 78); p.lineTo(36, 78); p.lineTo(10, 50); p.closePath(); }, '#f5a23d');
          BB.paperStroke(x, (p) => { p.moveTo(50, 37); p.lineTo(74, 63); p.moveTo(74, 37); p.lineTo(50, 63); }, '#ffffff', 8);
          break;
        case 'fuel': x.drawImage(BB.pic('pump', 200), 0, 0, 100, 100); break;
        case 'coin': x.drawImage(BB.pic('coin', 200), 0, 0, 100, 100); break;
        case 'clock':
          paper(x, (p) => rrP(p, 40, 4, 20, 10, 4), P.coral, { depth: 0.3 });
          paper(x, (p) => arcP(p, 50, 54, 40), P.coral);
          paper(x, (p) => arcP(p, 50, 54, 30), '#fffdf6', { depth: -0.5, rim: false });
          BB.paperStroke(x, (p) => { p.moveTo(50, 54); p.lineTo(50, 34); p.moveTo(50, 54); p.lineTo(63, 62); }, '#3a2a3c', 6);
          break;
        default:
          paper(x, (p) => arcP(p, 50, 50, 40), P.plum);
      }
    });
    iconCache[key] = c;
    return c;
  };
  // forget cached icons that show the bus's colour or number (after the child changes them)
  BB.iconRefresh = () => { for (const k in iconCache) if (/^(mybus|together|number):/.test(k)) delete iconCache[k]; };
  // A fresh canvas copy of an icon, sized by CSS (several elements can't share one canvas).
  BB.iconEl = function (name, size = 96, pic) {
    const src = pic ? BB.pic(name, size) : BB.icon(name, size);
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0); c.setAttribute('aria-hidden', 'true');
    return c;
  };

  // ---------- audio ----------
  // One AudioContext with a master gain -> {sfx, music}. Sound setting: mute (all sound) and music.
  // Standalone it is saved as bus3d.sound; in hub mode the hub owns it (time messages), see CLAUDE.md.
  const A = BB.audio = {
    ctx: null, master: null, sfxBus: null, musicBus: null, unlocked: false,
    mute: false, music: true,
  };
  if (!BB.HUB) { const s = BB.store.get('sound', null); if (s) { A.mute = !!s.mute; A.music = s.music !== false; } }
  const MUSIC_VOL = 1;                   // music bus level; note peaks are set per note (lead ~0.045, bass ~0.06)
  A.ensure = function () {
    if (A.ctx) return A.ctx;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { A.ctx = new C(); } catch (e) { return null; }
    A.master = A.ctx.createGain(); A.master.connect(A.ctx.destination);
    A.sfxBus = A.ctx.createGain(); A.sfxBus.connect(A.master);
    A.musicBus = A.ctx.createGain(); A.musicBus.connect(A.master);
    A.apply();
    return A.ctx;
  };
  A.apply = function () {
    if (!A.ctx) return;
    const t = A.ctx.currentTime;
    A.master.gain.setTargetAtTime(A.mute ? 0 : 1, t, 0.03);
    A.musicBus.gain.setTargetAtTime(A.music ? MUSIC_VOL * (A.ducked ? 0.35 : 1) : 0, t, 0.1);
  };
  // Change the sound setting. fromChild: the child tapped our own button (hub mode then tells the hub).
  A.setSound = function (mute, music, fromChild) {
    A.mute = !!mute; A.music = !!music;
    A.apply();
    if (A.mute) { try { speechSynthesis.cancel(); } catch (e) { /* none */ } }
    if (BB.HUB) { if (fromChild) { BB.emit('sound:tapped', { mute: A.mute, music: A.music }); BB.hub.post({ hub: 'sound', mute: A.mute, music: A.music }); } }
    else BB.store.set('sound', { mute: A.mute, music: A.music });
    BB.emit('sound:changed', { mute: A.mute, music: A.music });
  };
  A.unlock = function () {
    const ctx = A.ensure();
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older iOS */ }
    if (ctx && ctx.state !== 'running' && !BB.held) { try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
    if (!A.unlocked && ctx) {
      A.unlocked = true;
      try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { /* ignore */ }
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* no speech */ }
      BB.emit('audio:unlocked');
    }
  };
  for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) addEventListener(ev, () => A.unlock(), { passive: true });
  A.suspend = () => { if (A.ctx && A.ctx.state === 'running') { try { A.ctx.suspend(); } catch (e) { /* ignore */ } } };
  A.resume = () => { if (A.ctx && A.unlocked && A.ctx.state !== 'running') { try { const p = A.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } } };

  // tone(freq, dur, opts): one synth note into the sfx bus (or opts.bus). Peaks: effects <= 0.14.
  function tone(freq, dur, o = {}) {
    const ctx = A.ctx; if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + (o.at || 0);
    if (freq > 0) while (freq < 130) freq *= 2;          // phone speakers don't play much below ~130 Hz
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, o.slide), t + dur);
    const v = Math.min(0.14, o.vol == null ? 0.1 : o.vol);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.bus || A.sfxBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  BB.tone = tone;
  const N = (semi) => 440 * Math.pow(2, (semi - 9) / 12);   // semitones from C4 (0 = C4)
  BB.sfx = {
    click() { tone(N(19), 0.06, { type: 'square', vol: 0.05 }); },
    pop() { tone(N(12), 0.09, { vol: 0.09, slide: N(24) }); },
    coin() { tone(N(23), 0.08, { type: 'square', vol: 0.06 }); tone(N(28), 0.22, { type: 'square', vol: 0.06, at: 0.07 }); },
    right() { [0, 4, 7, 12].forEach((s, i) => tone(N(12 + s), 0.2, { vol: 0.1, at: i * 0.08 })); },
    wrong() { tone(N(7), 0.18, { vol: 0.08 }); tone(N(4), 0.26, { vol: 0.08, at: 0.16 }); },  // soft "hmm"
    door() { tone(N(0), 0.25, { type: 'sine', vol: 0.08, slide: N(-5) }); tone(N(12), 0.12, { type: 'sine', vol: 0.05, at: 0.05 }); },
    ding() { tone(N(16), 0.35, { type: 'sine', vol: 0.11 }); tone(N(12), 0.5, { type: 'sine', vol: 0.11, at: 0.25 }); },
    beep() { tone(N(24), 0.08, { type: 'sine', vol: 0.07 }); },
    cheer() { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(N(12 + s), 0.18, { type: 'square', vol: 0.05, at: i * 0.07 })); },
    // The horn: a cheerful two-tone honk; the "horn tune" upgrade plays a little tune instead.
    // k scales the volume (a friend's bus far away honks more quietly).
    horn(tune, k = 1) {
      if (tune) { [0, 4, 7, 4, 12].forEach((s, i) => tone(N(7 + s), 0.16, { type: 'sawtooth', vol: 0.06 * k, at: i * 0.13 })); return; }
      tone(N(7), 0.22, { type: 'sawtooth', vol: 0.06 * k }); tone(N(11), 0.22, { type: 'sawtooth', vol: 0.05 * k });
      tone(N(7), 0.3, { type: 'sawtooth', vol: 0.06 * k, at: 0.26 }); tone(N(11), 0.3, { type: 'sawtooth', vol: 0.05 * k, at: 0.26 });
    },
    tick() { tone(N(31), 0.04, { type: 'sine', vol: 0.05 }); },
    // buying something: a bright little cash-register jingle
    jingle() {
      [19, 23, 26, 31].forEach((s, i) => tone(N(s), 0.12, { type: 'square', vol: 0.045, at: i * 0.07 }));
      tone(N(36), 0.4, { type: 'sine', vol: 0.09, at: 0.3 }); tone(N(43), 0.3, { type: 'sine', vol: 0.05, at: 0.34 });
    },
    // the fuel pump: glug-glug bubbles rising over `sec` seconds
    gurgle(sec = 1.6) {
      const n = Math.round(sec / 0.13);
      for (let i = 0; i < n; i++) { const f = N(-2 + i * 0.9 + Math.random() * 3); tone(f, 0.11, { type: 'sine', vol: 0.09, at: i * 0.13, slide: f * 1.7 }); }
      tone(N(24), 0.25, { type: 'sine', vol: 0.08, at: sec }); tone(N(31), 0.35, { type: 'sine', vol: 0.07, at: sec + 0.12 });
    },
    whoosh() { tone(N(5), 0.35, { type: 'triangle', vol: 0.05, slide: N(29) }); },
    sparkle() { [31, 35, 38, 43].forEach((s, i) => tone(N(s), 0.14, { type: 'sine', vol: 0.05, at: i * 0.06 })); },
    // goodnight: a slow, soft falling lullaby phrase
    lullaby() {
      [[16, 0], [12, 0.5], [14, 1.0], [7, 1.5], [12, 2.2], [9, 2.7], [7, 3.2], [0, 3.9]]
        .forEach(([s, at]) => tone(N(s), 0.7, { type: 'sine', vol: 0.07, at, attack: 0.08 }));
    },
    snore() { tone(N(0), 0.9, { type: 'sine', vol: 0.04, slide: N(5), attack: 0.3 }); },
  };
  // Engine hum, level 0..1 (called every frame by bus.js). Kept above 130 Hz for phone speakers.
  let eng = null;
  BB.sfx.engine = function (level) {
    const ctx = A.ctx; if (!ctx || ctx.state !== 'running') return;
    if (!eng) {
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 600; g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(A.sfxBus); o.start();
      eng = { o, f, g };
    }
    const t = ctx.currentTime;
    eng.o.frequency.setTargetAtTime(135 + level * 70, t, 0.15);
    eng.g.gain.setTargetAtTime(0.012 + level * 0.03, t, 0.2);
  };

  // ---------- music: an original, bouncy 4-bar loop (C major pentatonic) ----------
  // TODO(polish): more tunes (depot tune, bedtime lullaby).
  const SONG = {
    bpm: 116,
    // 8th-note steps, semitones from C4, null = rest
    lead: [12, null, 16, 19, 21, 19, 16, null, 14, null, 16, 14, 12, null, 9, null,
           12, null, 16, 19, 21, 24, 21, null, 19, null, 16, 14, 12, null, null, null],
    bass: [0, null, 7, null, 5, null, 7, null, 9, null, 7, null, 5, null, 7, null,
           0, null, 7, null, 5, null, 9, null, 7, null, 2, null, 0, null, 7, null],
  };
  const M = BB.music = { on: false, step: 0, next: 0, timer: null };
  M.start = function () {
    if (M.on || BB.hub.paused) return; M.on = true;
    const ctx = A.ensure(); if (!ctx) return;
    M.next = ctx.currentTime + 0.1;
    M.timer = setInterval(M.tick, 90);
  };
  M.stop = function () { M.on = false; clearInterval(M.timer); M.timer = null; };
  M.tick = function () {
    const ctx = A.ctx; if (!ctx || ctx.state !== 'running' || BB.held) return;
    const dur = 60 / SONG.bpm / 2;
    if (M.next < ctx.currentTime - 0.2) M.next = ctx.currentTime + 0.05;   // skip notes missed while paused
    while (M.next < ctx.currentTime + 0.25) {
      const i = M.step % SONG.lead.length, at = M.next - ctx.currentTime;
      const l = SONG.lead[i], b = SONG.bass[i];
      if (l != null) tone(N(l), dur * 0.9, { type: 'triangle', vol: 0.045, at, bus: A.musicBus });
      if (b != null) tone(N(b), dur * 1.6, { type: 'sine', vol: 0.06, at, bus: A.musicBus });
      M.step++; M.next += dur;
    }
  };

  // ---------- speech ----------
  // BB.say(text, {queue}) -> Promise resolved when done (or after a safety timeout). Cuts current speech unless queue.
  // Hold-aware: while held nothing is spoken (requests wait for the release); a line cut off by a hold is said
  // again afterwards and its promise only resolves then, so flows that await speech carry on exactly where they were.
  let lastSay = null;
  const heard = new Set();                // lines that really started speaking (iOS blocks speech before a tap)
  BB.heard = (text) => heard.has(String(text));
  // still waiting to be spoken (queued, or cut off by a hold): don't say it again
  BB.pending = (text) => { text = String(text); for (const it of active) if (it.text === text) return true; return heldItems.some((it) => it.text === text) || waiting.some((it) => it.text === text); };
  const active = new Set();              // items being spoken (or queued in speechSynthesis)
  let heldItems = [], waiting = [];      // cut off by a hold / asked for during a hold
  const sayLen = (t) => String(t).length;
  function speak(item) {
    if (A.mute || !window.speechSynthesis) { BB.later(300 + sayLen(item.text) * 40, item.resolve); return; }
    item.held = false; item.finished = false;
    const token = item.token = {};
    const done = () => {
      if (item.finished || item.token !== token) return;
      item.finished = true; BB.cancelLater(item.safety);
      active.delete(item);
      if (!active.size) { A.ducked = false; A.apply(); }
      if (!item.held) item.resolve();
    };
    try {
      if (!item.queue) speechSynthesis.cancel();
      speechSynthesis.resume();
      const u = new SpeechSynthesisUtterance(item.text);
      u.rate = 0.95; u.pitch = 1.15; u.lang = 'en-GB';
      // heard: it really started, or it ran a normal length and ended without an error (some engines skip onstart)
      const t0 = performance.now();
      u.onend = () => { if (performance.now() - t0 > 700 && !item.held) heard.add(item.text); done(); };
      u.onerror = done;
      u.onstart = () => { heard.add(item.text); };
      lastSay = item.text;
      active.add(item);
      item.safety = BB.later(1500 + sayLen(item.text) * 90, done);
      A.ducked = true; A.apply();
      speechSynthesis.speak(u);
    } catch (e) { done(); }
  }
  BB.say = function (text, opts = {}) {
    return new Promise((resolve) => {
      const item = { text: String(text), queue: !!opts.queue, resolve };
      if (BB.held) { waiting.push(item); return; }
      speak(item);
    });
  };
  BB.hush = () => { try { speechSynthesis.cancel(); } catch (e) { /* none */ } };
  BB.lastSay = () => lastSay;
  BB.speaking = () => active.size > 0;
  function holdSpeech(on, short) {
    if (on) {
      heldItems = [...active].filter((it) => !it.finished);
      for (const it of heldItems) { it.held = true; BB.cancelLater(it.safety); }
      active.clear(); A.ducked = false;
      BB.hush();
      return;
    }
    let again = heldItems; heldItems = [];
    let next = waiting; waiting = [];
    // A newer line that would have cut in replaces everything before it.
    const cut = next.map((it) => !it.queue).lastIndexOf(true);
    if (cut >= 0) { for (const it of again.concat(next.slice(0, cut))) it.resolve(); again = []; next = next.slice(cut); }
    // A short hold (a quick wobble of the tablet) doesn't repeat anything: the cut line counts as said.
    if (short) { for (const it of again) it.resolve(); again = []; }
    again.concat(next).forEach((it, i) => { it.queue = i > 0; speak(it); });
  }

  // ---------- hub mode ----------
  // The protocol plumbing (time, hold, pause, sound) lives here; the flow on top of it (clock chip, last-minute
  // warning, goodnight, stars) is in main.js and ui.js.
  BB.hub = {
    on: BB.HUB, limit: 0, left: null, used: 0, share: 0, slept: false, paused: false, gotTime: false,
    post(msg) { if (!BB.HUB) return; try { window.parent.postMessage(msg, '*'); } catch (e) { /* ignore */ } },
    timeUp() { return BB.HUB && this.limit > 0 && this.left != null && this.left <= 0; },
    sleep() { if (!BB.HUB || this.slept) return; this.slept = true; this.post({ hub: 'sleep' }); },
  };
  // For a moment after the child taps our own sound button, an older value still on its way from the hub
  // doesn't undo the tap.
  let soundSent = null;
  BB.on('sound:tapped', (d) => { soundSent = { mute: d.mute, music: d.music, until: performance.now() + 2000 }; });
  if (BB.HUB) {
    document.documentElement.classList.add('hub', 'hub-sound-wait');
    addEventListener('message', (e) => {
      if (e.source !== window.parent) return;
      const d = e.data;
      if (!d || typeof d !== 'object' || typeof d.hub !== 'string') return;
      const H = BB.hub;
      if (d.hub === 'time') {
        H.limit = Math.max(0, +d.limit || 0);
        H.left = H.limit > 0 && d.left != null && isFinite(+d.left) ? Math.max(0, Math.floor(+d.left)) : null;
        H.used = +d.used || 0;
        H.share = H.limit > 0 ? BB.clamp(+d.share || 0, 0, 1) : 0;
        H.gotTime = true;
        if (typeof d.mute === 'boolean' && typeof d.music === 'boolean') {
          let ok = true;
          if (soundSent) {
            if (soundSent.mute === d.mute && soundSent.music === d.music) soundSent = null;
            else if (performance.now() < soundSent.until) ok = false;
            else soundSent = null;
          }
          if (ok && (d.mute !== A.mute || d.music !== A.music)) A.setSound(d.mute, d.music, false);
        }
        document.documentElement.classList.remove('hub-sound-wait');
        BB.emit('hub:time', H);
      } else if (d.hub === 'hold') {
        BB.setHeld('hub', !!d.on);
        BB.emit('hub:hold', { on: !!d.on });
      } else if (d.hub === 'pause') {
        H.paused = true;
        BB.setHeld('pause', true);         // never released: the frame is about to be removed
        BB.music.stop(); BB.hush();
        BB.emit('hub:pause');
      }
    });
  }
  // Several reasons can hold the game (hub card, hidden page, pause); it runs only when none do.
  // Held: no updates (main.js), no BB.later timers, no speech, audio suspended. Released: everything carries on.
  const holds = new Set();
  let heldAt = 0;
  BB.setHeld = function (why, on) {
    if (on) holds.add(why); else holds.delete(why);
    const was = BB.held; BB.held = holds.size > 0;
    if (BB.held === was) return;
    if (BB.held) {
      heldAt = performance.now();
      freezeTimers(true);
      holdSpeech(true);
      A.suspend();
    } else {
      freezeTimers(false);
      A.resume();
      holdSpeech(false, performance.now() - heldAt < 500);
    }
    BB.emit('held', { on: BB.held });
  };
})();
