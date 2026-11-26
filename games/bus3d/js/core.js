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
    fuelPerUnit: 1 / 6500,  // a full tank lasts a good many jobs (world.js sets the same for its bigger town)
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
    busType: null, routeNo: '88', assist: true, assistChosen: false, leftHand: false, control: 'wheel', xmas: 'auto', dirt: 0, spotted: {}, friendsMet: [],
    washPaid: 0,                 // coins paid for a bus wash that hasn't finished yet (a reload mid-wash gives them back)
    vehiclesOwned: ['bendy', 'double', 'single'],   // the rides the child may drive (the buses are free; the others are bought in the garage)
    vehiclePaint: {},            // a colour per other ride ({fire: 'blue'}); none = its classic colours
    skill: null,                 // how the sums are going (jobs.js: 0-4.6, the level is its whole part); null = work it out from questions
    wish: null,                  // the ride the child is saving up for (depot.js: the locked ride they tapped last; none = the cheapest)
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
      for (const k of ['stickers', 'paints', 'stickersOwned', 'partsOwned', 'friendsMet']) if (!Array.isArray(s[k])) s[k] = k === 'paints' ? ['green'] : [];
      if (!s.spotted || typeof s.spotted !== 'object' || Array.isArray(s.spotted)) s.spotted = {};   // (events.js: {id: times seen})
      if (!s.parts || typeof s.parts !== 'object' || Array.isArray(s.parts)) s.parts = {};
      s.routeNo = /^[1-9][0-9]{0,2}$/.test(String(s.routeNo)) ? String(s.routeNo) : '88';
      if (s.busType != null && typeof s.busType !== 'string') s.busType = null;
      s.assist = !!s.assist; s.assistChosen = !!s.assistChosen; s.leftHand = !!s.leftHand; s.control = 'wheel';                 // (the steering wheel is the only control now: old 'joystick' saves move to it)
      s.xmas = s.xmas === 'on' || s.xmas === 'off' ? s.xmas : 'auto';
      s.dirt = Math.max(0, Math.min(1, +s.dirt || 0));     // (how dusty the bus is: only looks, bus.js)
      if (Array.isArray(got.hatsOwned)) BB.saveMigrate.hatRefund = got.hatsOwned.reduce((n, id) => n + (HAT_PRICES[id] || 0), 0);
      s.fuel = Math.max(0, Math.min(1, +s.fuel || 0));
      s.washPaid = Math.max(0, Math.min(10, +s.washPaid | 0));
      s.vehiclesOwned = (Array.isArray(s.vehiclesOwned) ? s.vehiclesOwned : []).filter((v) => typeof v === 'string');
      for (const v of ['single', 'double', 'bendy']) if (!s.vehiclesOwned.includes(v)) s.vehiclesOwned.unshift(v);
      if (!s.vehiclePaint || typeof s.vehiclePaint !== 'object' || Array.isArray(s.vehiclePaint)) s.vehiclePaint = {};
      if (typeof s.skill !== 'number' || !isFinite(s.skill)) s.skill = null;
      if (typeof s.wish !== 'string') s.wish = null;
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
    // Soft shadow texture for under the vehicles (no shadow maps): a rounded rectangle with a blurred edge, so a
    // long bus stands on a shadow of its own shape (the middle 56% is the body, the rest the soft edge).
    blobTex: (function () {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      x.shadowColor = 'rgba(40,24,48,0.5)'; x.shadowBlur = 9; x.shadowOffsetX = 200; x.fillStyle = '#000';
      const r = 9, x0 = 13 - 200, y0 = 9, x1 = 51 - 200, y1 = 55;
      x.beginPath(); x.moveTo(x0 + r, y0); x.arcTo(x1, y0, x1, y1, r); x.arcTo(x1, y1, x0, y1, r); x.arcTo(x0, y1, x0, y0, r); x.arcTo(x0, y0, x1, y0, r); x.closePath(); x.fill();
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
        // ----- the newer stops: chunky shapes that still read at 34-40 px on the Next stop tile -----
        case 'plane':                 // an airliner seen from above, climbing up-right, on a round patch of sky
          paper(x, (p) => arcP(p, 50, 50, 45), '#cdeaf8', { depth: 0.3, rimColor: '#9cc7dc' });
          paper(x, (p) => { arcP(p, 24, 74, 8); arcP(p, 34, 70, 10); arcP(p, 44, 76, 7); }, '#ffffff', { depth: 0.2, rimColor: '#c9dceb', rimW: 1.6 });
          x.save(); x.translate(52, 48); x.rotate(Math.PI / 4);
          paper(x, (p) => { p.moveTo(-6, -4); p.lineTo(-40, 12); p.lineTo(-40, 20); p.lineTo(-6, 12); p.closePath(); p.moveTo(6, -4); p.lineTo(40, 12); p.lineTo(40, 20); p.lineTo(6, 12); p.closePath(); }, '#9aa4b0', { depth: 0.3 });
          paper(x, (p) => { p.moveTo(-5, 28); p.lineTo(-17, 37); p.lineTo(-17, 42); p.lineTo(-5, 38); p.closePath(); p.moveTo(5, 28); p.lineTo(17, 37); p.lineTo(17, 42); p.lineTo(5, 38); p.closePath(); }, P.coral, { depth: 0.3, rimW: 1.6 });
          paper(x, (p) => { p.moveTo(0, -42); p.quadraticCurveTo(9, -38, 9, -24); p.lineTo(8, 34); p.quadraticCurveTo(0, 44, -8, 34); p.lineTo(-9, -24); p.quadraticCurveTo(-9, -38, 0, -42); p.closePath(); }, '#fbf8f2', { rimColor: '#b9c2cc' });
          paper(x, (p) => p.ellipse(0, -31, 5, 4, 0, 0, Math.PI * 2), P.glassDark, { depth: 0.2, rim: false });
          x.restore();
          break;
        case 'city':                  // four towers
          for (const [X, Y, Wd, c] of [[8, 40, 20, '#9cc7dc'], [29, 16, 21, '#8fe0c4'], [52, 30, 19, '#ffd45c'], [72, 8, 20, '#7fb6e6']]) {
            paper(x, (p) => rrP(p, X, Y, Wd, 90 - Y, 3), c, { depth: 0.5 });
            x.fillStyle = 'rgba(255,255,255,.65)'; for (let yy = Y + 7; yy < 84; yy += 9) x.fillRect(X + 4, yy, Wd - 9, 3.5);
          }
          paper(x, (p) => rrP(p, 4, 86, 92, 8, 3), '#8a8290', { depth: 0.3 });
          break;
        case 'lantern':               // a red paper lantern
          BB.paperStroke(x, (p) => { p.moveTo(50, 3); p.lineTo(50, 18); }, '#7a5a3a', 3.5);
          paper(x, (p) => rrP(p, 36, 14, 28, 9, 3), P.honey, { depth: 0.3 });
          paper(x, (p) => p.ellipse(50, 50, 34, 30, 0, 0, Math.PI * 2), '#ef4b3c');
          for (const dx of [-17, 0, 17]) BB.paperStroke(x, (p) => { p.moveTo(50 + dx, 23); p.quadraticCurveTo(50 + dx * 1.45, 50, 50 + dx, 77); }, '#c8352a', 2.4);
          shine(x, 34, 38, 6, 10, 0.4, 0.35);
          paper(x, (p) => rrP(p, 36, 76, 28, 9, 3), P.honey, { depth: 0.3 });
          BB.paperStroke(x, (p) => { p.moveTo(44, 86); p.lineTo(42, 97); p.moveTo(50, 86); p.lineTo(50, 98); p.moveTo(56, 86); p.lineTo(58, 97); }, P.honey, 3);
          break;
        case 'beach':                 // sea, sand and a striped umbrella
          paper(x, (p) => { p.moveTo(2, 58); p.lineTo(98, 58); p.lineTo(98, 82); p.lineTo(2, 82); p.closePath(); }, '#4fb6e8', { depth: 0.2, rim: false });
          BB.paperStroke(x, (p) => { p.moveTo(10, 66); p.quadraticCurveTo(18, 62, 26, 66); p.moveTo(60, 64); p.quadraticCurveTo(68, 60, 76, 64); }, '#e8f6ff', 2.6);
          paper(x, (p) => { p.moveTo(0, 78); p.quadraticCurveTo(50, 64, 100, 76); p.lineTo(100, 98); p.quadraticCurveTo(50, 100, 0, 98); p.closePath(); }, '#f6d98e', { depth: 0.4, rimColor: '#e2b968' });
          BB.paperStroke(x, (p) => { p.moveTo(53, 30); p.lineTo(46, 88); }, '#8a6a48', 5);
          paper(x, (p) => { p.moveTo(8, 38); p.quadraticCurveTo(52, -10, 96, 38); p.quadraticCurveTo(52, 30, 8, 38); p.closePath(); }, P.coral);
          paper(x, (p) => { p.moveTo(36, 34.5); p.quadraticCurveTo(52, -2, 68, 34.5); p.quadraticCurveTo(52, 32, 36, 34.5); p.closePath(); }, '#fff6e0', { depth: 0.3, rimColor: '#e8d5b0' });
          break;
        case 'supertree': {           // the gardens: a grove of super-trees, each a tall trunk that branches into a leafy crown
          paper(x, (p) => p.ellipse(50, 93, 46, 8, 0, 0, Math.PI * 2), P.grass, { depth: 0.3, rimColor: P.grassDark });
          const tree = (cx, base, top, half, s) => {
            // trunk: tapering, purple, with green vines climbing it
            paper(x, (p) => { p.moveTo(cx - 6 * s, base); p.lineTo(cx - 3 * s, top + 6 * s); p.lineTo(cx + 3 * s, top + 6 * s); p.lineTo(cx + 6 * s, base); p.closePath(); }, '#8e62c8', { depth: 0.4 });
            for (let k = 0; k < 3; k++) { const y0 = base - 6 - k * (base - top) * 0.28; BB.paperStroke(x, (p) => { p.moveTo(cx - 5 * s, y0); p.quadraticCurveTo(cx, y0 - 5 * s, cx + 4.5 * s, y0 - 9 * s); }, P.leaf, 2.2 * s); }
            // branches fanning out of the trunk top
            BB.paperStroke(x, (p) => {
              for (const f of [-1, -0.5, 0, 0.5, 1]) { p.moveTo(cx, top + 8 * s); p.quadraticCurveTo(cx + f * half * 0.45, top - 2 * s, cx + f * half, top - (f === 0 ? 10 : 4 + (1 - Math.abs(f)) * 4) * s); }
            }, '#7a4fb4', 3 * s);
            // the leafy crown: green clumps, with pink-purple blossoms between them
            const leaves = [[-1, 3], [-0.62, -3], [-0.22, -7], [0.22, -7], [0.62, -3], [1, 3]];
            paper(x, (p) => { for (const [f, dy] of leaves) arcP(p, cx + f * half, top + dy * s - 2 * s, 7.5 * s); }, P.leaf, { depth: 0.4, rimColor: P.grassDark });
            for (const [f, dy] of [[-0.82, -1], [-0.42, -5.5], [0, -9], [0.42, -5.5], [0.82, -1]]) dot(x, cx + f * half, top + dy * s - 7 * s, 3.2 * s, '#e58ad6');
          };
          tree(20, 90, 50, 14, 0.75);
          tree(80, 90, 44, 15, 0.8);
          tree(50, 94, 26, 26, 1);
          break;
        }
        case 'ferris': {              // the big wheel: a thick rim, a few spokes, chunky coloured cabins, two legs
          BB.paperStroke(x, (p) => { p.moveTo(50, 46); p.lineTo(26, 94); p.moveTo(50, 46); p.lineTo(74, 94); }, '#8a8290', 7);
          for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + 0.26; BB.paperStroke(x, (p) => { p.moveTo(50, 46); p.lineTo(50 + Math.cos(a) * 34, 46 + Math.sin(a) * 34); }, '#d8cfc2', 2.6); }
          BB.paperStroke(x, (p) => p.arc(50, 46, 34, 0, Math.PI * 2), '#f4ede2', 6);
          const cols = [P.coral, P.honey, P.teal, '#5d73e8', P.rose, P.leaf];
          for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + 0.26, cx = 50 + Math.cos(a) * 34, cy = 46 + Math.sin(a) * 34; paper(x, (p) => rrP(p, cx - 8, cy - 5, 16, 14, [3, 3, 6, 6]), cols[k], { depth: 0.3, rimW: 1.8 }); }
          paper(x, (p) => arcP(p, 50, 46, 7), P.honey, { depth: 0.3 });
          paper(x, (p) => rrP(p, 18, 90, 64, 7, 3), '#8a8290', { depth: 0.3 });
          break;
        }
        // ----- job targets for the other rides (jobs.js may use them as a job's or a target's pic) -----
        case 'fire':                  // a little house with flames at its window
          paper(x, (p) => rrP(p, 18, 46, 54, 44, 4), P.cream);
          paper(x, (p) => { p.moveTo(10, 50); p.lineTo(45, 20); p.lineTo(80, 50); p.closePath(); }, P.woodDark);
          paper(x, (p) => rrP(p, 28, 60, 18, 16, 3), '#5a4a5c', { depth: 0.3 });
          paper(x, (p) => { p.moveTo(64, 92); p.quadraticCurveTo(50, 70, 62, 52); p.quadraticCurveTo(64, 64, 70, 62); p.quadraticCurveTo(68, 44, 80, 30); p.quadraticCurveTo(80, 50, 90, 56); p.quadraticCurveTo(100, 76, 86, 92); p.closePath(); }, '#ff7a2e');
          paper(x, (p) => { p.moveTo(70, 92); p.quadraticCurveTo(64, 78, 72, 66); p.quadraticCurveTo(76, 74, 80, 70); p.quadraticCurveTo(90, 80, 82, 92); p.closePath(); }, P.honey, { depth: 0.3 });
          paper(x, (p) => { p.moveTo(30, 74); p.quadraticCurveTo(28, 64, 36, 58); p.quadraticCurveTo(38, 66, 44, 66); p.quadraticCurveTo(46, 72, 42, 76); p.closePath(); }, '#ff7a2e', { depth: 0.3, rimW: 1.6 });
          break;
        case 'medic':                 // a check-up: a white doctor's case with a heart (no red cross)
          paper(x, (p) => rrP(p, 36, 16, 28, 14, 6), '#c9d2db', { depth: 0.3 });
          paper(x, (p) => rrP(p, 10, 26, 80, 62, 12), '#fdfbf6', { rimColor: '#c9b9a0' });
          paper(x, (p) => heartP(p, 50, 58, 0.62), '#ff6b8a', { depth: 0.3 });
          break;
        case 'icecream':              // a cone with two scoops
          paper(x, (p) => { p.moveTo(32, 52); p.lineTo(68, 52); p.lineTo(50, 96); p.closePath(); }, P.woodLight);
          x.strokeStyle = BB.dark(P.woodLight, 0.25); x.lineWidth = 2; x.beginPath(); x.moveTo(38, 60); x.lineTo(58, 80); x.moveTo(62, 60); x.lineTo(44, 82); x.stroke();
          paper(x, (p) => arcP(p, 40, 46, 15), P.rose);
          paper(x, (p) => arcP(p, 60, 46, 15), '#fff6e0', { rimColor: '#e2d3b5' });
          paper(x, (p) => arcP(p, 50, 28, 15), '#8a5a38');
          dot(x, 50, 12, 5, P.coral);
          break;
        case 'tow':                   // a broken-down car with a puff of steam
          paper(x, (p) => { arcP(p, 62, 22, 8); arcP(p, 72, 16, 10); arcP(p, 82, 24, 7); }, '#eef3f8', { depth: 0.2, rimColor: '#b9c6d2' });
          paper(x, (p) => rrP(p, 8, 54, 84, 24, 8), '#4fa3e0');
          paper(x, (p) => rrP(p, 24, 36, 46, 22, [10, 10, 2, 2]), '#4fa3e0');
          paper(x, (p) => rrP(p, 30, 41, 15, 12, 3), '#d4eef8', { depth: 0.2, rimW: 1.4 }); paper(x, (p) => rrP(p, 49, 41, 15, 12, 3), '#d4eef8', { depth: 0.2, rimW: 1.4 });
          for (const wx of [26, 74]) { paper(x, (p) => arcP(p, wx, 80, 10), '#3a343f', { depth: 0.5, rim: false }); dot(x, wx, 80, 4, '#c9d2db'); }
          break;
        case 'taxi':                  // a yellow taxi with its roof lamp (the taxi's own stops)
          paper(x, (p) => rrP(p, 40, 24, 20, 9, 3), '#fff6e0', { depth: 0.3, rimW: 1.4, rimColor: '#d9b57f' });
          paper(x, (p) => rrP(p, 8, 54, 84, 24, 8), '#f5b83d');
          paper(x, (p) => rrP(p, 22, 34, 56, 24, [11, 11, 2, 2]), '#f5b83d');
          paper(x, (p) => rrP(p, 28, 39, 19, 13, 3), '#d4eef8', { depth: 0.2, rimW: 1.4 }); paper(x, (p) => rrP(p, 52, 39, 19, 13, 3), '#d4eef8', { depth: 0.2, rimW: 1.4 });
          paper(x, (p) => rrP(p, 8, 62, 84, 5, 2), '#3a343f', { depth: 0, rim: false });
          for (const wx of [26, 74]) { paper(x, (p) => arcP(p, wx, 80, 10), '#3a343f', { depth: 0.5, rim: false }); dot(x, wx, 80, 4, '#c9d2db'); }
          break;
        // the fire station (a red firefighter's helmet) and the clinic (a heart: no red cross); first drawn in world.js
        case 'firestation':
          paper(x, (p) => { p.moveTo(10, 74); p.quadraticCurveTo(50, 62, 90, 74); p.quadraticCurveTo(92, 84, 80, 84); p.lineTo(20, 84); p.quadraticCurveTo(8, 84, 10, 74); p.closePath(); }, '#d9382c', { depth: 0.4 });
          paper(x, (p) => { p.moveTo(20, 72); p.quadraticCurveTo(22, 22, 50, 20); p.quadraticCurveTo(78, 22, 80, 72); p.closePath(); }, '#ef4b3c');
          BB.paperStroke(x, (p) => { p.moveTo(50, 22); p.lineTo(50, 66); }, '#c8352a', 4);
          paper(x, (p) => p.ellipse(50, 50, 11, 13, 0, 0, Math.PI * 2), P.honeyLight, { depth: 0.3, rimW: 1.6 });
          break;
        case 'clinic':
          paper(x, (p) => rrP(p, 10, 10, 80, 80, 14), '#fff6e0', { depth: 0.3, rimColor: '#7fd1c3' });
          paper(x, (p) => heartP(p, 50, 52, 0.95), '#ff6b8a');
          shine(x, 36, 38, 6, 4, -0.6, 0.6);
          break;
        case 'wash':                  // the bus wash sign: the same soapy bucket as the Wash tile
          x.drawImage(BB.icon('wash', size * 2 > 256 ? 256 : size * 2), 0, 0, 100, 100);
          break;
        default:
          paper(x, (p) => arcP(p, 50, 50, 40), P.plum);
      }
    });
    picCache[key] = c;
    return c;
  };
  // (world.js keeps older copies of the newer stops' pictures; they are drawn here now, so it leaves BB.pic alone)
  // NOTE for other files: core.js draws every stop and place picture, and this flag tells world.js to leave BB.pic
  // alone (its older copies are no longer used). Add new pictures here, as a case above.
  BB.pic.extra = { plane: 1, city: 1, lantern: 1, beach: 1, supertree: 1, ferris: 1, wash: 1, fire: 1, medic: 1, icecream: 1, tow: 1, firestation: 1, clinic: 1 };

  // ---------- UI icons: BB.icon(name, size) -> canvas (the HUD, the garage, the cards) ----------
  // home, garage, music, musicOff, sound, soundOff, horn, helper, helperOn, uturn, wheel, handR, handL, siren, sirenOn,
  // mybus (in the current paint), world (friends), shop, settings, lights, bumpers, wheels, stickers, extras, colour,
  // check, cross, speak, back (delete), fuel, coin, number, clock, wash, book, play, xmasOn/Off/Auto.
  const iconCache = {};
  BB.icon = function (name, size = 96) {
    const paint = (BB.PAINTS.find((p) => p.id === BB.save.paint) || BB.PAINTS[0]).color;
    const key = name + ':' + size + (/^(mybus|world)/.test(name) ? paint : '');
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
      const tabletWithJoy = (left) => {        // (the which-side picture: a tablet with the wheel and the pedals)
        paper(x, (p) => rrP(p, 6, 22, 88, 58, 12), '#5a5260');
        paper(x, (p) => rrP(p, 13, 29, 74, 44, 6), '#bfe0f0', { depth: 0.2, rim: false });
        x.fillStyle = '#9cc7dc'; x.fillRect(13, 58, 74, 15);
        // the pedals on the chosen side (a green Go pedal), the little wheel on the other
        const px = left ? 18 : 64;
        paper(x, (p) => rrP(p, px, 40, 18, 26, 5), '#3fae49', { depth: 0.3, rimW: 1.4 });
        x.fillStyle = '#fff'; x.beginPath(); x.moveTo(px + 9, 44); x.lineTo(px + 15, 52); x.lineTo(px + 3, 52); x.closePath(); x.fill();
        const wx = left ? 68 : 32;
        x.save(); x.lineWidth = 4.5; x.strokeStyle = '#5a5260'; x.beginPath(); x.arc(wx, 54, 11, 0, Math.PI * 2); x.stroke();
        x.lineWidth = 3.5; x.beginPath(); x.moveTo(wx - 11, 53); x.lineTo(wx + 11, 53); x.moveTo(wx, 54); x.lineTo(wx, 65); x.stroke(); x.restore();
        dot(x, wx, 54, 4.5, '#f26b5b');
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
        // Friends (everyone, public rooms): little buses driving round a globe
        case 'world':
          paper(x, (p) => arcP(p, 50, 46, 30), '#4fb6e8', { rimColor: '#2f8fc4' });
          paper(x, (p) => { p.moveTo(34, 30); p.quadraticCurveTo(44, 22, 52, 30); p.quadraticCurveTo(48, 40, 38, 42); p.quadraticCurveTo(30, 38, 34, 30); p.closePath(); p.moveTo(56, 50); p.quadraticCurveTo(68, 44, 72, 54); p.quadraticCurveTo(66, 66, 56, 64); p.quadraticCurveTo(50, 58, 56, 50); p.closePath(); }, P.leaf, { depth: 0.3, rimW: 1.4 });
          shine(x, 38, 30, 7, 4, -0.6, 0.45);
          sideBus(x, -2, 62, 0.5, paint === '#3d8fe0' ? '#3fae49' : '#3d8fe0', 'single');
          sideBus(x, 50, 66, 0.5, paint, 'single');
          paper(x, (p) => heartP(p, 82, 16, 0.32), '#ef5a4b', { depth: 0.3 });
          break;
        // Christmas: a little tree with a star and baubles (On), the same greyed with a slash (Off), with a calendar
        // page (Auto: by the date)
        case 'xmasOn': case 'xmasOff': case 'xmasAuto': {
          const off = name === 'xmasOff', auto = name === 'xmasAuto';
          if (off) x.globalAlpha = 0.55;
          const sx = auto ? -8 : 0;
          paper(x, (p) => rrP(p, 44 + sx, 76, 12, 16, 3), P.woodDark, { depth: 0.4 });
          paper(x, (p) => { p.moveTo(50 + sx, 10); p.lineTo(80 + sx, 50); p.lineTo(68 + sx, 50); p.lineTo(86 + sx, 80); p.lineTo(14 + sx, 80); p.lineTo(32 + sx, 50); p.lineTo(20 + sx, 50); p.closePath(); }, off ? '#9aa89a' : P.pine);
          if (!off) for (const [bx, by, c] of [[40, 44, P.coral], [58, 58, P.honey], [36, 68, '#4fa3e0'], [64, 72, P.coral], [50, 34, P.rose]]) paper(x, (p) => arcP(p, bx + sx, by, 4.6), c, { depth: 0.3, rimW: 1.2 });
          paper(x, (p) => starP(p, 50 + sx, 12, 11, 4.6), off ? '#c9c2a8' : P.honey, { depth: 0.4 });
          x.globalAlpha = 1;
          if (off) { x.save(); x.translate(50, 50); x.rotate(Math.PI / 4); paper(x, (p) => rrP(p, -52, -7, 104, 14, 7), P.coral, { depth: 0.4 }); x.restore(); }
          if (auto) {
            paper(x, (p) => rrP(p, 62, 50, 34, 40, 6), '#ffffff', { rimColor: '#d9c3a0' });
            paper(x, (p) => rrP(p, 62, 50, 34, 11, [6, 6, 0, 0]), P.coral, { depth: 0.3, rim: false });
            x.fillStyle = '#3a2a3c'; x.font = `700 20px ${BB.FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('12', 79, 75);
          }
          break;
        }
        // the bus wash: a bucket with soap bubbles
        case 'wash':
          paper(x, (p) => { p.moveTo(20, 46); p.lineTo(80, 46); p.lineTo(72, 92); p.lineTo(28, 92); p.closePath(); }, '#4fa3e0');
          BB.paperStroke(x, (p) => p.arc(50, 48, 26, Math.PI * 1.05, Math.PI * 1.95), '#5a5260', 4.5);
          paper(x, (p) => rrP(p, 16, 42, 68, 9, 4.5), '#3d8fe0', { depth: 0.3 });
          for (const [bx, by, r] of [[34, 34, 11], [54, 26, 14], [72, 36, 9], [44, 14, 7], [76, 16, 6]]) {
            paper(x, (p) => arcP(p, bx, by, r), '#e8f6ff', { depth: 0.25, rimColor: '#9cc7dc', rimW: 2 });
            shine(x, bx - r * 0.35, by - r * 0.35, r * 0.28, r * 0.18, -0.6, 0.9);
          }
          break;
        // the siren (fire engine, ambulance): a blue and a red light on a little bar, with rays
        case 'siren': case 'sirenOn': {
          const on = name === 'sirenOn';
          if (on) for (const [cx, col] of [[30, 'rgba(79,163,224,.8)'], [70, 'rgba(239,75,60,.8)']]) for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i - 1) * 0.6 + (cx < 50 ? -0.35 : 0.35); BB.paperStroke(x, (p) => { p.moveTo(cx + Math.cos(a) * 26, 50 + Math.sin(a) * 26); p.lineTo(cx + Math.cos(a) * 38, 50 + Math.sin(a) * 38); }, col, 5); }
          paper(x, (p) => rrP(p, 10, 70, 80, 16, 6), '#5a5260');
          paper(x, (p) => { p.moveTo(14, 72); p.lineTo(14, 56); p.arc(30, 56, 16, Math.PI, 0); p.lineTo(46, 72); p.closePath(); }, on ? '#4fa3e0' : '#9cc7dc');
          paper(x, (p) => { p.moveTo(54, 72); p.lineTo(54, 56); p.arc(70, 56, 16, Math.PI, 0); p.lineTo(86, 72); p.closePath(); }, on ? '#ef4b3c' : '#f2a49c');
          shine(x, 24, 52, 4, 7, 0.4, 0.6); shine(x, 64, 52, 4, 7, 0.4, 0.6);
          break;
        }
        // the spotter book: an open book with a bookmark
        case 'book':
          paper(x, (p) => { p.moveTo(50, 26); p.quadraticCurveTo(30, 16, 8, 22); p.lineTo(8, 80); p.quadraticCurveTo(30, 74, 50, 84); p.closePath(); }, '#4fa3e0');
          paper(x, (p) => { p.moveTo(50, 26); p.quadraticCurveTo(70, 16, 92, 22); p.lineTo(92, 80); p.quadraticCurveTo(70, 74, 50, 84); p.closePath(); }, '#3d8fe0');
          paper(x, (p) => { p.moveTo(50, 30); p.quadraticCurveTo(32, 22, 14, 27); p.lineTo(14, 74); p.quadraticCurveTo(32, 69, 50, 78); p.closePath(); }, '#fffaf0', { depth: 0.3 });
          paper(x, (p) => { p.moveTo(50, 30); p.quadraticCurveTo(68, 22, 86, 27); p.lineTo(86, 74); p.quadraticCurveTo(68, 69, 50, 78); p.closePath(); }, '#fffaf0', { depth: 0.3 });
          paper(x, (p) => starP(p, 31, 50, 11, 5), P.honey, { depth: 0.3 });
          paper(x, (p) => arcP(p, 69, 50, 9), P.coral, { depth: 0.3 });
          paper(x, (p) => { p.moveTo(62, 26); p.lineTo(70, 26); p.lineTo(70, 44); p.lineTo(66, 40); p.lineTo(62, 44); p.closePath(); }, P.coral, { depth: 0.2, rimW: 1.4 });
          break;
        case 'play':
          paper(x, (p) => arcP(p, 50, 50, 44), '#fff6e0', { rimColor: '#d9b57f' });
          paper(x, (p) => { p.moveTo(38, 27); p.lineTo(75, 50); p.lineTo(38, 73); p.closePath(); }, '#3fae49', { depth: 0.6 });
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
  // ---------- the spotter book's stickers: special vehicles and sights, and the passenger friends ----------
  // BB.spotPic(id, size): fireTruck, ambulance, police, towTruck, iceCream, milkVan, rubbishTruck, otters, parade,
  // fireworks, plane (anything else: a star). BB.friendPic(friend, size): a round portrait (no faces on vehicles, only
  // on people) with the friend's colours and their thing. Cached.
  const spotCache = {};
  function vehicle(x, o) {
    // a little side-view vehicle facing right: cab + box (or one body), two wheels
    const body = o.body, top = o.top || 34, paper = BB.paper;
    if (o.box) paper(x, (p) => rrP(p, 6, top, 56, 74 - top, 6), o.box);
    paper(x, (p) => rrP(p, o.box ? 60 : 8, o.cabTop || 44, o.box ? 34 : 86, 74 - (o.cabTop || 44), [12, 14, 4, 4]), body);
    x.fillStyle = '#d4eef8'; x.beginPath(); rrP(x, o.box ? 74 : 70, (o.cabTop || 44) + 6, 16, 12, 3); x.fill();
    if (!o.box) { x.beginPath(); rrP(x, 16, (o.cabTop || 44) + 6, 44, 12, 3); x.fill(); }
    for (const wx of [24, 76]) { paper(x, (p) => arcP(p, wx, 76, 9), '#3a343f', { depth: 0.5, rim: false }); dot(x, wx, 76, 4, '#c9d2db'); }
  }
  BB.spotPic = function (id, size = 128) {
    const key = id + size; if (spotCache[key]) return spotCache[key];
    const P = BB.P, paper = BB.paper;
    const c = board(size, (x) => {
      switch (id) {
        case 'fireTruck':
          vehicle(x, { body: '#e8473c', box: '#e8473c', top: 40, cabTop: 38 });
          BB.paperStroke(x, (p) => { p.moveTo(10, 32); p.lineTo(64, 24); }, '#c9d2db', 5);
          for (let i = 0; i < 5; i++) BB.paperStroke(x, (p) => { p.moveTo(16 + i * 10, 31 - i * 1.4); p.lineTo(16 + i * 10, 26 - i * 1.4); }, '#c9d2db', 2.5);
          paper(x, (p) => rrP(p, 70, 30, 12, 8, 3), '#4fa3e0', { depth: 0.2 });
          break;
        case 'ambulance':
          vehicle(x, { body: '#fdfbf6', box: '#fdfbf6', top: 30, cabTop: 40 });
          x.fillStyle = '#5cb85c'; x.fillRect(6, 58, 88, 5);
          paper(x, (p) => heartP(p, 34, 43, 0.27), '#ff6b8a', { depth: 0.3 });   // (a heart, like the ambulance itself: never a red cross)
          paper(x, (p) => rrP(p, 70, 33, 12, 7, 3), '#4fa3e0', { depth: 0.2 });
          break;
        case 'police':
          vehicle(x, { body: '#3d6fc4', cabTop: 46 });
          x.fillStyle = '#fdfbf6'; x.fillRect(8, 62, 86, 5);
          paper(x, (p) => rrP(p, 40, 37, 10, 8, 3), '#e8473c', { depth: 0.2 }); paper(x, (p) => rrP(p, 50, 37, 10, 8, 3), '#4fa3e0', { depth: 0.2 });
          break;
        case 'towTruck':
          vehicle(x, { body: '#f5b83d', box: '#7a7385', top: 56, cabTop: 40 });
          BB.paperStroke(x, (p) => { p.moveTo(40, 56); p.lineTo(14, 30); p.lineTo(6, 44); }, '#5a5260', 5);
          BB.paperStroke(x, (p) => { p.moveTo(6, 44); p.quadraticCurveTo(2, 54, 10, 52); }, '#5a5260', 3);
          paper(x, (p) => rrP(p, 70, 33, 12, 7, 3), P.honey, { depth: 0.2 });
          break;
        case 'iceCream':
          vehicle(x, { body: '#ff9ec0', cabTop: 40 });
          x.fillStyle = '#fff6e0'; for (let i = 0; i < 6; i++) x.fillRect(10 + i * 14, 62, 7, 6);
          paper(x, (p) => { p.moveTo(36, 40); p.lineTo(48, 40); p.lineTo(42, 22); p.closePath(); }, P.woodLight, { depth: 0.3 });
          paper(x, (p) => arcP(p, 42, 18, 8), '#fff6e0', { depth: 0.3 }); dot(x, 42, 11, 3, P.coral);
          break;
        case 'milkVan':
          vehicle(x, { body: '#fdfbf6', cabTop: 42 });
          x.fillStyle = '#4fa3e0'; x.fillRect(8, 60, 86, 6);
          paper(x, (p) => { rrP(p, 34, 22, 14, 22, 4); }, '#ffffff', { rimColor: '#9cc7dc' }); paper(x, (p) => rrP(p, 36, 16, 10, 7, 2), '#4fa3e0', { depth: 0.2 });
          break;
        case 'rubbishTruck':
          vehicle(x, { body: '#3fae49', box: '#2f8f3a', top: 30, cabTop: 40 });
          for (let i = 0; i < 3; i++) { x.fillStyle = 'rgba(255,255,255,.3)'; x.fillRect(12 + i * 16, 38, 8, 26); }
          break;
        case 'otters':
          for (const [ox, s2] of [[34, 1], [68, 0.85]]) {
            x.save(); x.translate(ox, 58); x.scale(s2, s2);
            dot(x, -16, -18, 7, '#8a5a38'); dot(x, 16, -18, 7, '#8a5a38');
            paper(x, (p) => p.ellipse(0, 0, 24, 22, 0, 0, Math.PI * 2), '#a8724a');
            x.beginPath(); x.ellipse(0, 8, 14, 9, 0, 0, Math.PI * 2); x.fillStyle = '#f3dcc0'; x.fill();
            dot(x, -8, -4, 3, '#3a2a3c'); dot(x, 8, -4, 3, '#3a2a3c'); x.beginPath(); x.ellipse(0, 4, 4, 3, 0, 0, Math.PI * 2); x.fillStyle = '#3a2a3c'; x.fill();
            x.restore();
          }
          BB.paperStroke(x, (p) => { p.moveTo(4, 88); p.quadraticCurveTo(26, 80, 50, 88); p.quadraticCurveTo(74, 96, 96, 88); }, '#4fa3e0', 5);
          break;
        case 'parade':
          BB.paperStroke(x, (p) => { p.moveTo(4, 30); p.quadraticCurveTo(50, 50, 96, 30); }, '#9b6238', 2.5);
          [P.coral, P.honey, '#4fa3e0', P.leaf, P.plum].forEach((cc, i) => { const fx2 = 12 + i * 19, fy = 33 + Math.sin((i + 0.5) / 5 * Math.PI) * 9; paper(x, (p) => { p.moveTo(fx2 - 7, fy); p.lineTo(fx2 + 7, fy); p.lineTo(fx2, fy + 14); p.closePath(); }, cc, { depth: 0.3, rimW: 1.4 }); });
          paper(x, (p) => p.ellipse(50, 74, 18, 14, 0, 0, Math.PI * 2), P.coral);
          x.strokeStyle = '#fff6e0'; x.lineWidth = 3; x.beginPath(); x.moveTo(34, 68); x.lineTo(50, 82); x.lineTo(66, 68); x.stroke();
          BB.paperStroke(x, (p) => { p.moveTo(30, 54); p.lineTo(42, 64); p.moveTo(70, 54); p.lineTo(58, 64); }, P.woodLight, 3.5);
          break;
        case 'fireworks':
          x.fillStyle = '#2c3566'; x.beginPath(); rrP(x, 4, 4, 92, 92, 18); x.fill();
          for (const [fx2, fy, cc, r] of [[36, 38, P.honey, 22], [70, 56, P.rose, 18], [40, 74, '#7fd1ff', 12]]) {
            for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; BB.paperStroke(x, (p) => { p.moveTo(fx2 + Math.cos(a) * r * 0.35, fy + Math.sin(a) * r * 0.35); p.lineTo(fx2 + Math.cos(a) * r, fy + Math.sin(a) * r); }, cc, 3); }
            dot(x, fx2, fy, 3, '#fff6e0');
          }
          break;
        case 'turbo':                 // the secret turbo: a lightning bolt on a golden star
          paper(x, (p) => starP(p, 50, 52, 46, 24), P.honey, { rimColor: P.honeyDark });
          paper(x, (p) => { p.moveTo(56, 14); p.lineTo(30, 56); p.lineTo(48, 56); p.lineTo(40, 88); p.lineTo(70, 44); p.lineTo(52, 44); p.closePath(); }, '#4fa3e0', { depth: 0.4 });
          shine(x, 38, 34, 6, 4, -0.6, 0.6);
          break;
        case 'plane':
          x.fillStyle = '#bfe6f7'; x.beginPath(); rrP(x, 4, 4, 92, 92, 18); x.fill();
          paper(x, (p) => { arcP(p, 24, 74, 10); arcP(p, 38, 70, 12); arcP(p, 52, 76, 9); }, '#ffffff', { rimColor: '#c9dceb' });
          paper(x, (p) => { p.moveTo(46, 34); p.lineTo(30, 18); p.lineTo(38, 16); p.lineTo(60, 32); p.closePath(); p.moveTo(46, 50); p.lineTo(30, 66); p.lineTo(38, 68); p.lineTo(60, 52); p.closePath(); }, '#9aa4b0', { depth: 0.3 });
          paper(x, (p) => { p.moveTo(14, 42); p.quadraticCurveTo(50, 34, 86, 40); p.quadraticCurveTo(94, 42, 86, 46); p.quadraticCurveTo(50, 50, 14, 46); p.closePath(); }, '#f4f1ea');
          paper(x, (p) => { p.moveTo(14, 42); p.lineTo(10, 28); p.lineTo(20, 28); p.lineTo(26, 41); p.closePath(); }, P.coral, { depth: 0.3 });
          break;
        default:
          paper(x, (p) => starP(p, 50, 52, 40, 18), P.honey);
      }
    });
    return (spotCache[key] = c);
  };
  BB.friendPic = function (f, size = 128) {
    const key = 'fr-' + f.id + size; if (spotCache[key]) return spotCache[key];
    const L2 = f.look || {}, P = BB.P, paper = BB.paper;
    const c = board(size, (x) => {
      x.save(); const clip = new Path2D(); arcP(clip, 50, 50, 46); x.clip(clip);
      x.fillStyle = '#fff1d6'; x.fillRect(0, 0, 100, 100);
      paper(x, (p) => p.ellipse(50, 104, 38, 34, 0, 0, Math.PI * 2), L2.shirt || P.teal);
      x.restore();
      paper(x, (p) => arcP(p, 50, 46, 22), L2.skin || '#f1c7a0', { rimColor: BB.dark(L2.skin || '#f1c7a0', 0.25) });
      x.beginPath(); x.arc(50, 42, 23, Math.PI * 1.02, Math.PI * 1.98); x.fillStyle = L2.hair || '#3a2a3c'; x.fill();
      if (L2.bun) dot(x, 50, 18, 9, L2.hair || '#3a2a3c');
      dot(x, 42, 48, 2.6, '#3a2a3c'); dot(x, 58, 48, 2.6, '#3a2a3c');
      x.beginPath(); x.ellipse(37, 55, 4, 2.5, 0, 0, Math.PI * 2); x.ellipse(63, 55, 4, 2.5, 0, 0, Math.PI * 2); x.fillStyle = 'rgba(255,120,130,.45)'; x.fill();
      x.strokeStyle = '#3a2a3c'; x.lineWidth = 2.2; x.beginPath(); x.arc(50, 54, 6, 0.2 * Math.PI, 0.8 * Math.PI); x.stroke();
      x.lineWidth = 4; x.strokeStyle = '#ffffff'; x.beginPath(); x.arc(50, 50, 46, 0, Math.PI * 2); x.stroke();
      x.lineWidth = 2.5; x.strokeStyle = BB.dark(L2.shirt || P.teal, 0.2); x.beginPath(); x.arc(50, 50, 47.5, 0, Math.PI * 2); x.stroke();
      // their thing, in the corner
      const prop = f.prop;
      x.save(); x.translate(76, 76); x.scale(0.3, 0.3); x.translate(-50, -50);
      paper(x, (p) => arcP(p, 50, 50, 46), '#ffffff', { rimColor: '#e2c99a', rimW: 5 });
      if (prop === 'cat') { paper(x, (p) => { p.moveTo(24, 46); p.lineTo(28, 14); p.lineTo(46, 32); p.closePath(); p.moveTo(76, 46); p.lineTo(72, 14); p.lineTo(54, 32); p.closePath(); arcP(p, 50, 56, 30); }, '#f5a23d'); }
      else if (prop === 'kite') paper(x, (p) => { p.moveTo(50, 8); p.lineTo(84, 44); p.lineTo(50, 90); p.lineTo(16, 44); p.closePath(); }, P.plum);
      else if (prop === 'durian') { paper(x, (p) => p.ellipse(50, 56, 32, 34, 0, 0, Math.PI * 2), '#9bbf3a'); for (let i = 0; i < 8; i++) dot(x, 34 + (i % 3) * 16, 36 + Math.floor(i / 3) * 18, 4, '#6e8f22'); }
      else if (prop === 'paper') paper(x, (p) => rrP(p, 20, 18, 60, 66, 6), '#f4f1ea');
      else paper(x, (p) => starP(p, 50, 52, 40, 18), P.honey);
      x.restore();
    });
    return (spotCache[key] = c);
  };
  // forget cached icons that show the bus's colour or number (after the child changes them)
  BB.iconRefresh = () => { for (const k in iconCache) if (/^(mybus|world|number):/.test(k)) delete iconCache[k]; };
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
    // the turbo isn't ready: a short sputter going down (quiet)
    fizz() { tone(N(17), 0.12, { type: 'square', vol: 0.04, slide: N(10) }); tone(N(12), 0.18, { type: 'triangle', vol: 0.06, slide: N(2), at: 0.1 }); },
    // the secret turbo: a whoosh and a tone rising fast (quiet: peak 0.08)
    turbo() { tone(N(5), 0.35, { type: 'triangle', vol: 0.05, slide: N(29) }); tone(N(12), 0.6, { type: 'square', vol: 0.04, slide: N(36), at: 0.08 }); tone(N(19), 0.5, { type: 'triangle', vol: 0.08, slide: N(43), at: 0.2 }); },
    sparkle() { [31, 35, 38, 43].forEach((s, i) => tone(N(s), 0.14, { type: 'sine', vol: 0.05, at: i * 0.06 })); },
    // goodnight: a slow, soft falling lullaby phrase
    lullaby() {
      [[16, 0], [12, 0.5], [14, 1.0], [7, 1.5], [12, 2.2], [9, 2.7], [7, 3.2], [0, 3.9]]
        .forEach(([s, at]) => tone(N(s), 0.7, { type: 'sine', vol: 0.07, at, attack: 0.08 }));
    },
    // turning a page in the sticker book
    page() { tone(N(26), 0.09, { type: 'triangle', vol: 0.05, slide: N(33) }); tone(N(33), 0.12, { type: 'sine', vol: 0.045, at: 0.08, slide: N(38) }); },
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

  // ---------- Christmas ----------
  // Automatic from 1 December to 6 January, or the grown-up/child's choice in the garage's Settings (save.xmas:
  // 'auto' | 'on' | 'off'). BB.xmas is the answer; 'xmas:changed' tells the rest (main.js passes it on to
  // BB.world.setXmas when world.js has it).
  BB.xmasByDate = (d = new Date()) => (d.getMonth() === 11) || (d.getMonth() === 0 && d.getDate() <= 6);
  const xmasNow = () => (BB.save.xmas === 'on' ? true : BB.save.xmas === 'off' ? false : BB.xmasByDate());
  BB.xmas = xmasNow();
  BB.setXmas = function (pref) {
    if (pref) { BB.save.xmas = pref === 'on' || pref === 'off' ? pref : 'auto'; BB.saveNow(); }
    const was = BB.xmas; BB.xmas = xmasNow();
    document.documentElement.classList.toggle('xmas', BB.xmas);
    if (was !== BB.xmas) BB.emit('xmas:changed', { on: BB.xmas });
  };
  document.documentElement.classList.toggle('xmas', BB.xmas);
  // (a game left open over midnight on 30 November / 6 January follows the date)
  setInterval(() => { if (BB.save.xmas === 'auto') BB.setXmas(); }, 60000);

  // ---------- music ----------
  // The everyday tune: an original, bouncy 4-bar loop (C major pentatonic). In Christmas mode: public-domain carols
  // (melodies only, our own little arrangement with a bell sound), each played twice, in turn.
  const SONG = {
    bpm: 116,
    // 8th-note steps, semitones from C4, null = rest
    lead: [12, null, 16, 19, 21, 19, 16, null, 14, null, 16, 14, 12, null, 9, null,
           12, null, 16, 19, 21, 24, 21, null, 19, null, 16, 14, 12, null, null, null],
    bass: [0, null, 7, null, 5, null, 7, null, 9, null, 7, null, 5, null, 7, null,
           0, null, 7, null, 5, null, 9, null, 7, null, 2, null, 0, null, 7, null],
  };
  // bars of [semitone | null, length in 8ths]; roots: one chord root per bar (semitones from C4); bar: 8ths per bar
  function carol(bpm, bar, bars, roots, opts = {}) {
    const lead = [], hold = [], bass = [];
    bars.forEach((notes, bi) => {
      let n = 0;
      for (const [semi, len] of notes) { lead.push(semi); hold.push(len); for (let k = 1; k < len; k++) { lead.push(null); hold.push(0); } n += len; }
      while (n < bar) { lead.push(null); hold.push(0); n++; }
      const r = roots[bi] - 12;
      for (let k = 0; k < bar; k++) bass.push(k === 0 ? r : k === (bar === 6 ? 4 : 4) ? r + 7 : null);
    });
    return Object.assign({ bpm, lead, hold, bass, bell: true }, opts);
  }
  const JB1 = [[[16, 2], [16, 2], [16, 4]], [[16, 2], [16, 2], [16, 4]], [[16, 2], [19, 2], [12, 3], [14, 1]], [[16, 8]],
    [[17, 2], [17, 2], [17, 3], [17, 1]], [[17, 2], [16, 2], [16, 2], [16, 1], [16, 1]]];
  const DECK = [[[19, 3], [17, 1], [16, 2], [14, 2]], [[12, 2], [14, 2], [16, 2], [12, 2]], [[14, 1], [16, 1], [17, 1], [14, 1], [16, 3], [14, 1]], [[12, 2], [11, 2], [12, 4]]];
  const TREE = [[[19, 3], [19, 1], [19, 2]], [[21, 2], [23, 3], [23, 1]], [[23, 2], [21, 2], [23, 2]], [[24, 2], [18, 2], [21, 2]]];
  const CAROLS = [
    // Jingle Bells (the chorus), with sleigh bells
    carol(124, 8, [...JB1, [[16, 2], [14, 2], [14, 2], [16, 2]], [[14, 4], [19, 4]], ...JB1, [[19, 2], [19, 2], [17, 2], [14, 2]], [[12, 8]]],
      [0, 0, 0, 0, 5, 0, 7, 7, 0, 0, 0, 0, 5, 0, 7, 0], { sleigh: true }),
    // Deck the Halls
    carol(112, 8, [...DECK, ...DECK, [[14, 3], [16, 1], [17, 2], [14, 2]], [[16, 3], [17, 1], [19, 2], [14, 2]], [[16, 1], [18, 1], [19, 2], [21, 1], [23, 1], [24, 2]], [[23, 2], [21, 2], [19, 4]], ...DECK],
      [0, 0, 7, 0, 0, 0, 7, 0, 7, 0, 7, 7, 0, 0, 7, 0]),
    // We Wish You a Merry Christmas (3/4)
    carol(116, 6, [[[null, 4], [7, 2]], [[12, 2], [12, 1], [14, 1], [12, 1], [11, 1]], [[9, 2], [9, 2], [9, 2]], [[14, 2], [14, 1], [16, 1], [14, 1], [12, 1]], [[11, 2], [7, 2], [7, 2]],
      [[16, 2], [16, 1], [17, 1], [16, 1], [14, 1]], [[12, 2], [9, 2], [7, 1], [7, 1]], [[9, 2], [14, 2], [11, 2]], [[12, 6]]],
      [7, 0, 5, 2, 7, 4, 9, 5, 0]),
    // O Christmas Tree (3/4)
    carol(96, 6, [[[null, 4], [14, 2]], ...TREE, [[19, 4], [14, 2]], ...TREE, [[19, 6]]], [2, 7, 2, 7, 2, 7, 7, 2, 7, 2, 7]),
  ];
  const M = BB.music = { on: false, step: 0, next: 0, timer: null, carol: 0, plays: 0 };
  M.song = () => (BB.xmas ? CAROLS[M.carol % CAROLS.length] : SONG);
  BB.on('xmas:changed', () => { M.step = 0; M.plays = 0; });
  M.start = function () {
    if (M.on || BB.hub.paused) return; M.on = true;
    const ctx = A.ensure(); if (!ctx) return;
    M.next = ctx.currentTime + 0.1;
    M.timer = setInterval(M.tick, 90);
  };
  M.stop = function () { M.on = false; clearInterval(M.timer); M.timer = null; };
  M.tick = function () {
    const ctx = A.ctx; if (!ctx || ctx.state !== 'running' || BB.held) return;
    if (M.next < ctx.currentTime - 0.2) M.next = ctx.currentTime + 0.05;   // skip notes missed while paused
    while (M.next < ctx.currentTime + 0.25) {
      const song = M.song(), dur = 60 / song.bpm / 2, len = song.lead.length;
      if (M.step >= len) {                    // the end of the tune: carols take turns, each played twice
        M.step = 0;
        if (BB.xmas && ++M.plays >= 2) { M.plays = 0; M.carol++; continue; }
      }
      const i = M.step, at = M.next - ctx.currentTime;
      const l = song.lead[i], b = song.bass[i];
      if (song.bell) {
        // a bell: a sine with a short ring an octave up (peaks: lead 0.04 + ring 0.015 + bass 0.06 + sleigh 0.012)
        if (l != null) {
          const hold = Math.max(1, song.hold[i]);
          tone(N(l), dur * hold * 0.95, { type: 'sine', vol: 0.04, at, bus: A.musicBus, attack: 0.006 });
          tone(N(l + 12), Math.min(0.35, dur * hold * 0.6), { type: 'sine', vol: 0.015, at, bus: A.musicBus, attack: 0.004 });
        }
        if (song.sleigh && i % 2 === 0) tone(N(43 + (i % 4 ? 2 : 0)), 0.05, { type: 'square', vol: 0.008, at, bus: A.musicBus, attack: 0.002 });
      } else if (l != null) tone(N(l), dur * 0.9, { type: 'triangle', vol: 0.045, at, bus: A.musicBus });
      if (b != null) tone(N(b), dur * (song.bell ? 2.4 : 1.6), { type: 'sine', vol: 0.06, at, bus: A.musicBus });
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
      // the same line asked for again while it is still being said (a second tap on the same tile or tab): let it
      // finish instead of starting it over; the promise resolves when it ends
      if (!item.queue) for (const it of active) if (it.text === item.text && !it.finished && !it.held) { const r0 = it.resolve; it.resolve = () => { r0(); resolve(); }; return; }
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
