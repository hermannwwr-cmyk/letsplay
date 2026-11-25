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

  // ---------- pictures (flat paper-style icons on canvas; used by stop signs and the HUD) ----------
  // BB.pic(name, size) -> canvas. Names: bowl (hawker centre), slide (playground), train (MRT), tree (park),
  // shop (shophouses), depot (bus garage), coin, pump.
  // TODO(world/ui polish): richer pictures in the paper-cut style (darker crescent lower right, deeper rims).
  const picCache = {};
  BB.pic = function (name, size = 128) {
    const key = name + size;
    if (picCache[key]) return picCache[key];
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'); x.scale(size / 100, size / 100);
    x.lineJoin = 'round'; x.lineCap = 'round';
    const P = BB.P;
    const rr = (X, Y, W, H, R, fill) => { x.beginPath(); x.roundRect ? x.roundRect(X, Y, W, H, R) : x.rect(X, Y, W, H); x.fillStyle = fill; x.fill(); };
    const circ = (X, Y, R, fill) => { x.beginPath(); x.arc(X, Y, R, 0, Math.PI * 2); x.fillStyle = fill; x.fill(); };
    switch (name) {
      case 'bowl':
        x.strokeStyle = '#fff'; x.lineWidth = 4;
        for (const sx of [38, 50, 62]) { x.beginPath(); x.moveTo(sx, 34); x.bezierCurveTo(sx - 6, 26, sx + 6, 20, sx, 12); x.stroke(); }
        x.strokeStyle = P.woodDark; x.lineWidth = 4; x.beginPath(); x.moveTo(60, 50); x.lineTo(86, 22); x.moveTo(66, 52); x.lineTo(92, 28); x.stroke();
        circ(50, 50, 30, P.honeyLight); x.fillStyle = P.honeyLight;
        x.beginPath(); x.moveTo(16, 50); x.lineTo(84, 50); x.arc(50, 50, 34, 0, Math.PI); x.fillStyle = P.coral; x.fill();
        x.beginPath(); x.arc(50, 50, 34, 0.15, Math.PI - 0.15); x.lineTo(30, 70); x.fillStyle = '#d94c40'; x.globalAlpha = 0.35; x.fill(); x.globalAlpha = 1;
        rr(14, 46, 72, 7, 3.5, '#ffd9a0');
        break;
      case 'slide':
        rr(18, 30, 8, 58, 3, P.berry); rr(40, 30, 8, 58, 3, P.berry);
        for (let i = 0; i < 4; i++) rr(20, 42 + i * 12, 26, 4, 2, P.honeyLight);
        rr(14, 24, 40, 10, 4, P.coral);
        x.beginPath(); x.moveTo(48, 30); x.quadraticCurveTo(70, 38, 90, 84); x.lineTo(80, 88); x.quadraticCurveTo(64, 50, 46, 42); x.closePath(); x.fillStyle = P.honey; x.fill();
        break;
      case 'train':
        rr(10, 26, 80, 46, 14, '#f4f1ea'); rr(10, 56, 80, 8, 2, P.coral);
        rr(18, 34, 18, 16, 4, P.glassDark); rr(41, 34, 18, 16, 4, P.glassDark); rr(64, 34, 18, 16, 4, P.glassDark);
        circ(28, 78, 6, '#555'); circ(72, 78, 6, '#555');
        rr(4, 84, 92, 6, 3, '#8a8290');
        break;
      case 'tree':
        rr(44, 54, 12, 36, 4, P.woodDark);
        circ(50, 40, 26, P.leaf); circ(30, 52, 16, P.leaf); circ(70, 52, 16, P.leaf); circ(58, 48, 18, P.grassDark);
        circ(42, 34, 10, '#93d97a');
        break;
      case 'shop':
        rr(14, 30, 72, 60, 4, P.mint); x.beginPath(); x.moveTo(8, 32); x.lineTo(50, 10); x.lineTo(92, 32); x.closePath(); x.fillStyle = P.coral; x.fill();
        for (let i = 0; i < 6; i++) { x.fillStyle = i % 2 ? '#fff' : P.coral; x.fillRect(14 + i * 12, 46, 12, 12); }
        rr(22, 64, 18, 26, 3, P.woodDark); rr(52, 64, 26, 16, 3, P.glass);
        break;
      case 'depot':
        x.beginPath(); x.moveTo(6, 40); x.lineTo(50, 12); x.lineTo(94, 40); x.closePath(); x.fillStyle = P.teal; x.fill();
        rr(12, 38, 76, 52, 3, P.cream); rr(22, 50, 56, 40, 3, '#5a4a5c');
        rr(26, 62, 48, 22, 5, P.busGreen); rr(30, 66, 30, 8, 2, P.glass); circ(36, 86, 5, '#333'); circ(64, 86, 5, '#333');
        break;
      case 'coin':
        circ(50, 50, 44, P.honeyDark); circ(48, 48, 40, P.honey); circ(48, 48, 28, P.honeyLight);
        x.fillStyle = P.honeyDark; x.font = 'bold 40px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 48, 50);
        break;
      case 'pump':
        rr(18, 14, 46, 78, 8, P.coral); rr(26, 24, 30, 22, 4, P.cream); rr(10, 86, 62, 8, 4, '#8a8290');
        x.strokeStyle = '#555'; x.lineWidth = 6; x.beginPath(); x.moveTo(64, 30); x.quadraticCurveTo(86, 34, 82, 60); x.lineTo(82, 70); x.stroke();
        rr(76, 64, 12, 18, 3, '#555');
        break;
      default:
        circ(50, 50, 40, P.plum);
    }
    picCache[key] = c;
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
