/* Little Bus Captain: the landmark art kit (BB.landmarks).
   Low-poly, flat-shaded, paper-cut models "inspired by" Singapore, all generic (no names, logos, trademarks or
   copies of protected designs): an observation wheel, a grove of super-trees, downtown towers, an airport (terminal,
   control tower, airliners, runway, fence), a shophouse row with lanterns, a beach park, an elevated-road kit, the
   depot kit and a tropical Christmas kit (no snow, no faces).
   Load after core.js (uses THREE, BB.mk, BB.P, BB.dark/light/mixHex; BB.fleet.dims when present, read lazily).

   Every builder returns a THREE.Group named 'lm:<name>' holding ONE merged vertex-coloured mesh (plus one more per
   moving part), all sharing BB.landmarks.mat. Units match the bus (1 unit ~ 1 m; a bus is 2.5 wide). Origin on the
   ground at the model's centre; "front" faces +z unless noted. group.userData:
     footprint {w, d}   local x/z size around the origin        height   top in units
     circles [{x,z,r}]  boxes [{x,z,hw,hd,ry,top}]  colliders in local coords (same shape as BB.world.addCircle/addBox)
     update(dt)         only on animated models (BB.landmarks.update calls it for groups that are in a scene)
     tris, draws        cost
   Night lights: parts carry a per-vertex aGlow (0 none, 1 steady, 2 twinkle, 3 blinking beacon, 4 warm window);
   one shared uniform drives them all: BB.landmarks.update(dt[, night]) each frame (night 0..1; read from
   BB.world.night() when omitted) or BB.landmarks.setNight(k).
   Merging: BB.landmarks.mergeInto({body, glow}, name, x, z, ry, ...args) puts a model's static parts straight into
   BB.mk builders (glow parts into `glow`, e.g. world.js's window builder; without glow they go to body);
   BB.landmarks.batch() collects many models into one aGlow mesh (coloured lights kept). Both return
   {movers (Group or null, add to the scene), circles, boxes (world coords), footprint, height, update}.
   BB.landmarks.colliders(groupOrInfo) / addColliders(groupOrInfo) turn local colliders into world ones. */
(function () {
  'use strict';
  const BB = window.BB = window.BB || {};
  const P = BB.P || {};
  const dark = (c, t) => BB.dark(c, t), light = (c, t) => BB.light(c, t), mix = (a, b, t) => BB.mixHex(a, b, t);
  const TAU = Math.PI * 2;
  const ON = 1, TWINKLE = 2, BLINK = 3, WINDOW = 4;

  // ---------- the shared material: Lambert + per-vertex night glow ----------
  const U = { uNight: { value: 0 }, uTime: { value: 0 } };
  const MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
  MAT.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.uNight; sh.uniforms.uTime = U.uTime;
    sh.vertexShader = 'attribute float aGlow;\nuniform float uNight;\nuniform float uTime;\nvarying vec3 vGlowCol;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlowCol = vec3(0.0);
        if (aGlow > 0.5) {
          float gm = floor(aGlow + 0.001), ph = fract(aGlow) * 6.2831;
          vec3 gc = color.rgb;
          float k = uNight;
          if (gm > 1.5 && gm < 2.5) k = uNight * (0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 2.4 + ph)));
          else if (gm > 2.5 && gm < 3.5) k = max(uNight, 0.55) * step(0.78, fract(uTime * 0.7 + fract(aGlow)));
          else if (gm > 3.5) { gc = vec3(1.0, 0.75, 0.32); k = uNight * 0.95; }
          vGlowCol = gc * k;
        }`);
    sh.fragmentShader = 'varying vec3 vGlowCol;\n' +
      sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vGlowCol;');
  };
  MAT.customProgramCacheKey = () => 'bb-landmarks-glow';

  // ---------- shared unit shapes ----------
  const GC = {};
  const cached = (key, make) => GC[key] || (GC[key] = make(), GC[key].userData.shared = true, GC[key]);
  const UBOX = new THREE.BoxGeometry(1, 1, 1), QUAD = new THREE.PlaneGeometry(1, 1);
  const ucyl = (seg, rt, rb, open) => {           // radius-1 cylinder (by the bigger end), height 1, centred
    const m = Math.max(rt, rb) || 1, a = Math.round(rt / m * 100) / 100, b = Math.round(rb / m * 100) / 100;
    return cached('c' + seg + '_' + a + '_' + b + (open ? 'o' : ''), () => new THREE.CylinderGeometry(a, b, 1, seg, 1, !!open));
  };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);

  function mulberry(seed) {
    return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  // ---------- Kit: a BB.mk builder whose parts remember their glow mode ----------
  class Kit {
    constructor(seed) {
      this.b = BB.mk.builder(); this.g = 0; this.movers = [];
      this.rnd = mulberry(seed || 7);
      this.info = { footprint: { w: 0, d: 0 }, height: 0, circles: [], boxes: [], update: null };
    }
    _tag() {
      const p = this.b.parts[this.b.parts.length - 1];
      p.glow = this.g === TWINKLE || this.g === BLINK ? this.g + this.rnd() * 0.98 : this.g;
      return this;
    }
    glow(mode, fn) { const o = this.g; this.g = mode; fn(this); this.g = o; return this; }
    at(x, y, z, ry, fn) { this.b.at(x, y, z, ry, () => fn(this)); return this; }
    rr(a, b) { return a + this.rnd() * (b - a); }
    pick(arr) { return arr[Math.floor(this.rnd() * arr.length)]; }
    // (BB.mk's builder transforms non-indexed geometry in place, so shared non-indexed shapes are copied per use)
    add(geo, col, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) { if (!geo.index && geo.userData.shared) geo = geo.clone(); this.b.add(geo, col, x, y, z, ry, rx, rz, sx, sy, sz); return this._tag(); }
    addM(geo, col, m) { if (!geo.index && geo.userData.shared) geo = geo.clone(); this.b.addM(geo, col, m); return this._tag(); }
    box(w, h, d, col, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) { return this.add(UBOX, col, x, y + h / 2, z, ry, rx, rz, w, h, d); }
    boxC(w, h, d, col, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) { return this.add(UBOX, col, x, y, z, ry, rx, rz, w, h, d); }
    quad(w, h, col, x, y, z, ry = 0, rx = 0) { return this.add(QUAD, col, x, y, z, ry, rx, 0, w, h, 1); }
    cyl(rt, rb, h, seg, col, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, open) { const m = Math.max(rt, rb); return this.add(ucyl(seg, rt, rb, open), col, x, y + h / 2, z, ry, rx, rz, m, h, m); }
    cylC(rt, rb, h, seg, col, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, open) { const m = Math.max(rt, rb); return this.add(ucyl(seg, rt, rb, open), col, x, y, z, ry, rx, rz, m, h, m); }
    cone(r, h, seg, col, x = 0, y = 0, z = 0, ry = 0) { return this.add(ucyl(seg, 0, 1), col, x, y + h / 2, z, ry, 0, 0, r, h, r); }
    ball(r, col, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, detail = 0) { return this.add(cached('ico' + detail, () => new THREE.IcosahedronGeometry(1, detail)), col, x, y, z, 0, 0, 0, r * sx, r * sy, r * sz); }
    disc(r, seg, col, x = 0, y = 0, z = 0, sx = 1, sz = 1) { return this.add(cached('disc' + seg, () => new THREE.CircleGeometry(1, seg).rotateX(-Math.PI / 2)), col, x, y, z, 0, 0, 0, r * sx, 1, r * sz); }
    prism(len, w, h, col, x = 0, y = 0, z = 0, ry = 0) { this.b.prism(len, w, h, col, x, y, z, ry); return this._tag(); }
    torus(R, tube, rs, ts, col, x = 0, y = 0, z = 0, ry = 0, rx = 0) { return this.add(cached('tor' + R + '_' + tube + '_' + rs + '_' + ts, () => new THREE.TorusGeometry(R, tube, rs, ts)), col, x, y, z, ry, rx); }
    // A square (seg 0) or round (seg >= 3) bar between two points [x,y,z].
    beam(a, b, t, col, seg = 0) {
      _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const L = _v.length() || 1e-4; _v.divideScalar(L);
      _q.setFromUnitVectors(_Y, _v);
      const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(t, L, t));
      return this.addM(seg ? ucyl(seg, 1, 1) : UBOX, col, m);
    }
    // A flat shape [[x,y],...] extruded by depth (centred on z), then turned/placed (fresh geometry: not shared).
    shape(pts, depth, col, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
      const s = new THREE.Shape(); pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
      const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, steps: 1 }); g.translate(0, 0, -depth / 2);
      return this.add(g, col, x, y, z, ry, rx, rz);
    }
    // Convex polygons [[x,y,z],...]; each is turned to face `out` (a direction), so winding never matters.
    polys(col, list) {
      const pos = [];
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (const { pts, out } of list) {
        A.fromArray(pts[0]); B.fromArray(pts[1]).sub(A); C.fromArray(pts[2]).sub(A);
        const flip = B.cross(C).dot(_v.set(out[0], out[1], out[2])) < 0;
        for (let i = 1; i < pts.length - 1; i++) {
          const p1 = flip ? pts[i + 1] : pts[i], p2 = flip ? pts[i] : pts[i + 1];
          pos.push(...pts[0], ...p1, ...p2);
        }
      }
      if (!pos.length) return this;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      return this.addM(g, col, new THREE.Matrix4());
    }
    mover(name, x, y, z, fn) {
      const k = new Kit(); k.rnd = this.rnd; fn(k);
      const pivot = new THREE.Group(); pivot.name = name; pivot.position.set(x, y, z);
      this.movers.push({ pivot, kit: k });
      return pivot;
    }
    circle(x, z, r) { this.info.circles.push({ x, z, r }); return this; }
    rect(x, z, hw, hd, ry = 0, top = 10) { this.info.boxes.push({ x, z, hw, hd, ry, top }); return this; }
    geometry() {
      const parts = this.b.parts; if (!parts.length) return null;
      const counts = parts.map((p) => (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count));
      const gl = new Float32Array(counts.reduce((a, c) => a + c, 0)); let o = 0;
      parts.forEach((p, i) => { gl.fill(p.glow || 0, o, o + counts[i]); o += counts[i]; });
      const geo = this.b.geometry(); geo.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
      return geo;
    }
  }

  const L = BB.landmarks = { mat: MAT, uniforms: U, GLOW: { ON, TWINKLE, BLINK, WINDOW }, names: [] };
  const DEFS = {};
  const LIVE = new Set();
  function make(name, args) { const k = new Kit(1000 + L.names.indexOf(name) * 97 + (typeof args[0] === 'number' ? args[0] * 13 : 0)); DEFS[name](k, ...args); return k; }
  function finish(k, name) {
    const g = new THREE.Group(); g.name = 'lm:' + name;
    let tris = 0, draws = 0;
    const geo = k.geometry();
    if (geo) { const m = new THREE.Mesh(geo, MAT); m.name = name + ':body'; g.add(m); tris += geo.attributes.position.count / 3; draws++; }
    for (const mv of k.movers) {
      const gg = mv.kit.geometry();
      if (gg) { const m = new THREE.Mesh(gg, MAT); m.name = name + ':' + mv.pivot.name; mv.pivot.add(m); tris += gg.attributes.position.count / 3; draws++; }
      g.add(mv.pivot);
    }
    Object.assign(g.userData, k.info, { tris: Math.round(tris), draws });
    if (!k.info.update) delete g.userData.update; else LIVE.add(g);
    g.userData.dispose = () => { LIVE.delete(g); g.traverse((o) => o.geometry && o.geometry.dispose()); };
    return g;
  }
  function def(name, fn) {
    DEFS[name] = fn; L.names.push(name);
    L[name] = (...args) => finish(make(name, args), name);
  }

  // Local colliders -> world, for a group (its position / rotation.y) or a merge result (already world).
  L.colliders = function (src, x, z, ry) {
    const u = src.isObject3D ? src.userData : src;
    if (!src.isObject3D && x == null) return { circles: u.circles.slice(), boxes: u.boxes.slice() };
    x = x != null ? x : src.position.x; z = z != null ? z : src.position.z; ry = ry != null ? ry : src.rotation.y;
    const c = Math.cos(ry), s = Math.sin(ry), sc = src.isObject3D ? src.scale.x : 1;
    const tx = (lx, lz) => [x + (lx * c + lz * s) * sc, z + (-lx * s + lz * c) * sc];
    return {
      circles: (u.circles || []).map((o) => { const [X, Z] = tx(o.x, o.z); return { x: X, z: Z, r: o.r * sc }; }),
      boxes: (u.boxes || []).map((o) => { const [X, Z] = tx(o.x, o.z); return { x: X, z: Z, hw: o.hw * sc, hd: o.hd * sc, ry: ry + (o.ry || 0), top: o.top }; }),
    };
  };
  L.addColliders = function (src) {
    const W = BB.world; if (!W || !W.addCircle) return;
    const c = L.colliders(src);
    for (const o of c.circles) W.addCircle(o.x, o.z, o.r);
    for (const o of c.boxes) W.addBox(o.x, o.z, o.hw, o.hd, o.ry, o.top);
  };
  L.mergeInto = function (targets, name, x = 0, z = 0, ry = 0, ...args) {
    const k = make(name, args);
    const M = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z);
    for (const p of k.b.parts) {
      const t = p.glow > 0 && targets.glow ? targets.glow : targets.body;
      t.addM(p.geo, p.color, M.clone().multiply(p.m));
      t.parts[t.parts.length - 1].glow = p.glow;
    }
    let movers = null;
    if (k.movers.length) {
      movers = new THREE.Group(); movers.name = 'lm:' + name + ':movers'; movers.position.set(x, 0, z); movers.rotation.y = ry;
      for (const mv of k.movers) { const gg = mv.kit.geometry(); if (gg) mv.pivot.add(new THREE.Mesh(gg, MAT)); movers.add(mv.pivot); }
      Object.assign(movers.userData, k.info);
      if (k.info.update) LIVE.add(movers); else delete movers.userData.update;
    }
    const w = L.colliders({ circles: k.info.circles, boxes: k.info.boxes, isObject3D: true, userData: k.info, position: { x, z }, rotation: { y: ry }, scale: { x: 1 } });
    return Object.assign({}, k.info, { movers, circles: w.circles, boxes: w.boxes });
  };
  L.batch = function () {
    const k = new Kit();
    return {
      kit: k,
      add: (name, x, z, ry, ...args) => L.mergeInto({ body: k.b }, name, x, z, ry, ...args),
      mesh: () => { const g = k.geometry(); const m = new THREE.Mesh(g || new THREE.BufferGeometry(), MAT); m.name = 'landmarks'; return m; },
    };
  };
  L.setNight = (n) => { U.uNight.value = Math.max(0, Math.min(1, +n || 0)); };
  L.update = function (dt, night) {
    U.uTime.value = (U.uTime.value + (dt || 0)) % 2000;
    if (night != null) L.setNight(night);
    else if (BB.world && typeof BB.world.night === 'function' && BB.world.built) L.setNight(BB.world.night());
    for (const g of LIVE) if (g.parent) { try { g.userData.update(dt || 0); } catch (e) { console.error(e); } }
  };

  // ---------- small shared pieces ----------
  const LEAF = ['#5fb84f', '#6fc45a', '#4fa847', '#7ccf5f'];
  function palm(k, x, z, h = 7, lean = 0.8, ang = 0, y0 = 0) {
    const n = 5, dx = Math.sin(ang), dz = Math.cos(ang);
    let prev = [x, y0, z];
    for (let i = 1; i <= n; i++) {
      const t = i / n, off = lean * t * t * h * 0.28;
      const p = [x + dx * off, y0 + t * h, z + dz * off];
      k.beam(prev, p, 0.42 - t * 0.14, i % 2 ? (P.wood || '#c58a55') : (P.woodLight || '#e2b07c'), 6);
      prev = p;
    }
    const [tx, ty, tz] = prev;
    for (let f = 0; f < 7; f++) {
      const a = f / 7 * TAU + k.rr(-0.2, 0.2), col = f % 2 ? '#4fa847' : '#3f9a52';
      const L1 = 2.0, p1 = 0.15, L2 = 1.9, p2 = 0.75;
      const m1 = [tx + Math.sin(a) * Math.cos(p1) * L1 / 2, ty - Math.sin(p1) * L1 / 2 + 0.1, tz + Math.cos(a) * Math.cos(p1) * L1 / 2];
      k.boxC(0.9, 0.08, L1, col, m1[0], m1[1], m1[2], a, p1);
      const e = [tx + Math.sin(a) * Math.cos(p1) * L1, ty - Math.sin(p1) * L1 + 0.1, tz + Math.cos(a) * Math.cos(p1) * L1];
      k.boxC(0.7, 0.08, L2, dark(col, 0.1), e[0] + Math.sin(a) * Math.cos(p2) * L2 / 2, e[1] - Math.sin(p2) * L2 / 2, e[2] + Math.cos(a) * Math.cos(p2) * L2 / 2, a, p2);
    }
    for (let c = 0; c < 3; c++) { const a = c / 3 * TAU; k.ball(0.22, '#8a5a2e', tx + Math.sin(a) * 0.3, ty - 0.25, tz + Math.cos(a) * 0.3); }
  }
  function roundTree(k, x, z, s = 1, y0 = 0) {
    const col = k.pick(LEAF);
    k.cyl(0.25 * s, 0.35 * s, 2.2 * s, 5, P.woodDark || '#9b6238', x, y0, z);
    k.ball(1.9 * s, col, x, y0 + 3.5 * s, z, 1, 1.05, 1);
    k.ball(1.0 * s, light(col, 0.2), x - 0.6 * s, y0 + 4.2 * s, z - 0.5 * s);
  }
  L.parts = { palm, roundTree };

  // =====================================================================================================
  // Observation wheel. opts {radius=22, capsules=20, speed=0.035 rad/s}. The wheel turns in the x-y plane (axle
  // along z); capsules are drums along the axle, so they look right at any angle (one mesh turns: 2 draw calls).
  // Footprint about 50 x 30; top about 2*radius + 9. userData.wheel = the turning pivot, userData.speed.
  def('observationWheel', (k, o = {}) => {
    const R = o.radius || 22, N = o.capsules || 20, HY = R + 6.2;
    const white = '#f6f1e7', steel = '#d9d2c6', deep = '#b9b0a3';
    // A-frame legs on both sides, with cross ties
    for (const zs of [-1, 1]) {
      for (const xs of [-1, 1]) k.beam([xs * R * 0.46, 0, zs * 6.5], [0, HY, zs * 2.4], 1.3, white);
      k.beam([-R * 0.3, HY * 0.35, zs * 5.2], [R * 0.3, HY * 0.35, zs * 5.2], 0.7, steel);
      k.box(1.8, 0.6, 1.8, deep, -R * 0.46, 0, zs * 6.5); k.box(1.8, 0.6, 1.8, deep, R * 0.46, 0, zs * 6.5);
      k.circle(-R * 0.46, zs * 6.5, 1.3).circle(R * 0.46, zs * 6.5, 1.3);
    }
    k.cylC(1.1, 1.1, 5.6, 8, '#a99e94', 0, HY, 0, 0, Math.PI / 2);
    // boarding deck under the wheel's low point, with steps
    k.box(9, 2.5, 8, P.cream || '#fff6e0', 0, 0, 0); k.box(9.4, 0.3, 8.4, P.teal || '#19a79b', 0, 2.5, 0);
    for (let i = 0; i < 4; i++) k.box(3, 0.62 * (i + 1), 0.9, '#e7dccb', 6, 0, -2.4 + i * 0.9);
    k.rect(0, 0, 5.2, 4.2, 0, 3);
    // the terminal in front: a long low glass building with a coloured roof
    k.at(0, 0, 13, 0, () => {
      k.box(30, 4.6, 8, '#f2e6d2', 0, 0, 0);
      k.glow(WINDOW, () => { for (let i = 0; i < 7; i++) k.quad(3.2, 2.6, '#a9d6ec', -12 + i * 4, 2.1, 4.02); });
      k.box(31.5, 0.6, 9.5, P.coral || '#ff6b5c', 0, 4.6, 0);
      k.box(31.5, 0.25, 9.5, dark(P.coral || '#ff6b5c', 0.2), 0, 4.35, 0);
      k.box(4, 3, 0.1, '#86afc8', 0, 0, 4.02);
      roundTree(k, -17.5, 2, 0.9); roundTree(k, 17.5, 2, 0.9);
      k.rect(0, 0, 15.5, 4.5, 0, 6);
    });
    // the turning wheel
    const ring = (r, t, col, z, seg) => k.torus(r, t, 4, seg || 44, col, 0, 0, z);
    const wheel = k.mover('wheel', 0, HY, 0, (w) => {
      w.torus(R, 0.38, 4, 44, white, 0, 0, -1.5); w.torus(R, 0.38, 4, 44, white, 0, 0, 1.5);
      w.torus(R - 1.7, 0.26, 4, 40, steel, 0, 0, 0);
      w.glow(ON, () => { w.torus(R + 0.45, 0.24, 3, 48, '#ff9cc0', 0, 0, -1.5); w.torus(R + 0.45, 0.24, 3, 48, '#ff9cc0', 0, 0, 1.5); });
      w.cylC(1.9, 1.9, 4.2, 10, steel, 0, 0, 0, 0, Math.PI / 2);
      w.cylC(1.0, 1.0, 4.6, 8, P.coral || '#ff6b5c', 0, 0, 0, 0, Math.PI / 2);
      for (let i = 0; i < N * 2; i++) {          // truss zig-zag between the inner and outer rings
        const a = i / (N * 2) * TAU, b = (i + 0.5) / (N * 2) * TAU, ri = R - 1.7;
        for (const zs of [-1.5, 1.5]) w.beam([Math.cos(a) * ri, Math.sin(a) * ri, 0], [Math.cos(b) * R, Math.sin(b) * R, zs], 0.16, steel);
      }
      for (let i = 0; i < N; i++) {
        const a = i / N * TAU, c = Math.cos(a), s = Math.sin(a);
        for (const zs of [-1.5, 1.5]) w.beam([c * 1.6, s * 1.6, zs * 0.9], [c * (R - 1.7), s * (R - 1.7), zs * 0.3], 0.12, deep, 4);
        const rc = R + 2.1, cx = c * rc, cy = s * rc;
        w.beam([c * (R + 0.3), s * (R + 0.3), 0], [c * (rc - 1.0), s * (rc - 1.0), 0], 0.3, steel);
        w.glow(ON, () => w.cylC(1.15, 1.15, 3.4, 8, '#bfe6f2', cx, cy, 0, 0, Math.PI / 2));
        const cap = i % 3 === 0 ? (P.coral || '#ff6b5c') : i % 3 === 1 ? (P.teal || '#19a79b') : (P.honey || '#ffb81f');
        w.cylC(1.25, 1.25, 0.3, 8, cap, cx, cy, -1.8, 0, Math.PI / 2); w.cylC(1.25, 1.25, 0.3, 8, cap, cx, cy, 1.8, 0, Math.PI / 2);
      }
    });
    const speed = o.speed != null ? o.speed : 0.035;
    Object.assign(k.info, {
      footprint: { w: 32, d: 36 }, height: HY + R + 3.4, wheel, speed,
      update(dt) { wheel.rotation.z += dt * this.speed; },
    });
  });

  // =====================================================================================================
  // Super-tree grove: tall funnel trees of steel ribs with planted trunks and lit canopies, one skywalk.
  // opts {count=6, radius=15}. Footprint about 2*radius+8 square; tallest about 24.
  def('superTrees', (k, o = {}) => {
    const n = o.count || 6, RAD = o.radius || 15;
    const spots = [[0, 0, 24]];
    for (let i = 1; i < n; i++) { const a = i / (n - 1) * TAU + 0.4, r = RAD * (i % 2 ? 0.95 : 0.6); spots.push([Math.cos(a) * r, Math.sin(a) * r, k.rr(13, 19)]); }
    spots[1][2] = 21;
    const LIGHTS = ['#ff8fd0', '#9d7bff', '#5fe0d0', '#ffd45c'];
    spots.forEach(([x, z, H], idx) => {
      const trunk = idx % 2 ? '#7a5d9a' : '#6c6aa8', canopyR = H * 0.36, lc = LIGHTS[idx % LIGHTS.length];
      k.cyl(2.4, 2.8, 0.6, 10, '#d9cbb4', x, 0, z);
      k.cyl(1.0, 1.5, H * 0.62, 8, trunk, x, 0.6, z);
      k.cyl(canopyR * 0.28, 1.0, H * 0.22, 8, trunk, x, 0.6 + H * 0.62, z);
      const cy = 0.6 + H * 0.84;
      k.cyl(canopyR, canopyR * 0.28, H * 0.13, 10, light(trunk, 0.12), x, cy, z);
      k.disc(canopyR * 0.92, 10, dark(trunk, 0.15), x, cy + H * 0.13 + 0.02, z);
      // ribs up the outside, lit at night
      k.glow(ON, () => {
        for (let r = 0; r < 8; r++) {
          const a = r / 8 * TAU + idx, c = Math.cos(a), s = Math.sin(a);
          const p0 = [x + c * 1.6, 0.6, z + s * 1.6], p1 = [x + c * 1.15, 0.6 + H * 0.62, z + s * 1.15], p2 = [x + c * canopyR * 1.02, cy + H * 0.13, z + s * canopyR * 1.02];
          k.beam(p0, p1, 0.16, lc); k.beam(p1, p2, 0.16, lc);
        }
      });
      k.glow(TWINKLE, () => { for (let r = 0; r < 10; r++) { const a = r / 10 * TAU; k.ball(0.28, lc, x + Math.cos(a) * canopyR, cy + H * 0.13 + 0.1, z + Math.sin(a) * canopyR); } });
      // planted patches climbing the trunk
      for (let p = 0; p < 9; p++) {
        const a = k.rr(0, TAU), t = k.rr(0.1, 0.8), r = 1.45 - t * 0.5;
        k.ball(k.rr(0.35, 0.6), k.pick(LEAF.concat(['#ff8fab', '#ffb81f'])), x + Math.cos(a) * r, 0.6 + t * H * 0.62, z + Math.sin(a) * r, 1, 1.3, 1);
      }
      k.circle(x, z, 2.6);
    });
    // a skywalk between the two tallest, lit underneath
    const [a, b] = [spots[0], spots[1]], wy = 13;
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), ry = Math.atan2(dx, dz);
    k.at((a[0] + b[0]) / 2, wy, (a[1] + b[1]) / 2, ry, () => {
      k.box(1.8, 0.35, len, '#efe6d6', 0, 0, 0);
      for (const sx of [-0.9, 0.9]) k.box(0.1, 1.0, len, '#cfe7ea', sx, 0.35, 0);
      k.glow(TWINKLE, () => { for (let i = 0; i < Math.floor(len / 1.6); i++) k.ball(0.14, '#fff1b0', 0, -0.12, -len / 2 + 0.8 + i * 1.6); });
    });
    // garden ground
    k.disc(RAD + 4, 16, '#8fd06a', 0, 0.03, 0);
    for (let i = 0; i < 10; i++) { const a = k.rr(0, TAU), r = k.rr(4, RAD + 2); k.ball(k.rr(0.6, 1.0), k.pick(['#ff8fab', '#ffd45c', '#ff7a4a', '#c9a7e8']), Math.cos(a) * r, 0.3, Math.sin(a) * r, 1, 0.6, 1); }
    Object.assign(k.info, { footprint: { w: RAD * 2 + 8, d: RAD * 2 + 8 }, height: 25 });
  });

  // =====================================================================================================
  // Downtown glass towers. variant 0 stepped, 1 slanted top, 2 round with a dome, 3 twin with a sky bridge,
  // 4 lit crown, 5 tapering. opts {height}. Footprints 12-22 wide; heights 48-78 by default.
  const GLASSES = ['#7fb8d6', '#8fd0c8', '#a7c4e8', '#9cc7dc', '#b5d8e8', '#86c1c9'];
  function windowBands(k, w, d, y0, y1, glass, seed) {
    for (let y = y0 + 1.2, f = 0; y < y1 - 1.2; y += 3.2, f++) {
      for (let s = 0; s < 4; s++) {
        const a = s * Math.PI / 2, half = s % 2 ? w / 2 : d / 2, span = (s % 2 ? d : w) - 1.4;
        const lit = ((f * 7 + s * 3 + seed) * 2654435761 >>> 0) % 100 < 58;
        if (lit) k.glow(WINDOW, () => k.quad(span, 1.5, light(glass, 0.3), Math.sin(a) * (half + 0.03), y, Math.cos(a) * (half + 0.03), a));
        else k.quad(span, 1.5, dark(glass, 0.18), Math.sin(a) * (half + 0.03), y, Math.cos(a) * (half + 0.03), a);
      }
    }
  }
  function slab(k, w, d, y0, h, glass, frame, seed) {
    k.box(w, h, d, glass, 0, y0, 0);
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.7, h, 0.7, frame, cx * (w / 2 - 0.2), y0, cz * (d / 2 - 0.2));
    for (let y = y0 + 12.8; y < y0 + h - 2; y += 12.8) k.box(w + 0.3, 0.5, d + 0.3, frame, 0, y, 0);
    windowBands(k, w, d, y0, y0 + h, glass, seed);
  }
  def('skylineTower', (k, variant = 0, o = {}) => {
    const v = ((variant | 0) % 6 + 6) % 6, glass = GLASSES[v], frame = v % 2 ? '#f4efe6' : '#e2d8c8';
    const H = o.height || [70, 58, 62, 66, 52, 78][v];
    let fw = 14, top = H;
    k.box(fw + 6, 0.5, fw + 6, '#e4d6bd', 0, 0, 0);                // plaza
    if (v === 0) {
      slab(k, 14, 14, 0.5, H * 0.55, glass, frame, 1);
      slab(k, 10.5, 10.5, 0.5 + H * 0.55, H * 0.28, glass, frame, 2);
      slab(k, 7, 7, 0.5 + H * 0.83, H * 0.12, glass, frame, 3);
      k.cone(1.2, 9, 4, frame, 0, 0.5 + H * 0.95, 0); top = H + 9.5;
      k.glow(BLINK, () => k.ball(0.45, '#ff4a3a', 0, top, 0));
    } else if (v === 1) {
      slab(k, 13, 13, 0.5, H, glass, frame, 4);
      k.shape([[-6.5, 0], [6.5, 0], [6.5, 9]], 13, light(glass, 0.15), 0, 0.5 + H, 0, Math.PI / 2);
      k.glow(ON, () => k.beam([-6.6, H + 0.5 + 9, -6.5], [6.6, H + 0.5 + 9, -6.5], 0.3, '#ffe9a8'));
      top = H + 9.5; fw = 13;
    } else if (v === 2) {
      const r = 7.5;
      k.cyl(r, r, H, 12, glass, 0, 0.5, 0);
      for (let y = 2.5, f = 0; y < H - 1; y += 3.2, f++) {
        const lit = (f * 5) % 7 < 4;
        if (lit) k.glow(WINDOW, () => k.cyl(r + 0.06, r + 0.06, 1.4, 12, light(glass, 0.3), 0, y, 0, 0, 0, 0, true));
        else k.cyl(r + 0.06, r + 0.06, 1.4, 12, dark(glass, 0.15), 0, y, 0, 0, 0, 0, true);
        if (f % 4 === 3) k.cyl(r + 0.25, r + 0.25, 0.45, 12, frame, 0, y + 1.6, 0);
      }
      k.add(cached('dome', () => new THREE.SphereGeometry(1, 12, 4, 0, TAU, 0, Math.PI / 2)), light(glass, 0.2), 0, 0.5 + H, 0, 0, 0, 0, r, r * 0.6, r);
      k.cyl(0.25, 0.4, 7, 5, frame, 0, H + r * 0.6, 0); top = H + r * 0.6 + 7;
      k.glow(BLINK, () => k.ball(0.4, '#ff4a3a', 0, top, 0));
      fw = 15;
    } else if (v === 3) {
      for (const sx of [-6, 6]) k.at(sx, 0, 0, 0, () => {
        slab(k, 8, 8, 0.5, H, glass, frame, sx > 0 ? 5 : 6);
        k.box(5.6, 3, 5.6, frame, 0, 0.5 + H, 0); k.box(3.4, 3, 3.4, glass, 0, 3.5 + H, 0);
        k.cone(0.8, 8, 4, frame, 0, 6.5 + H, 0);
        k.glow(BLINK, () => k.ball(0.35, '#ff4a3a', 0, 14.6 + H, 0));
      });
      k.box(4, 3, 3.2, frame, 0, H * 0.58, 0);
      k.glow(WINDOW, () => { k.quad(3.4, 1.6, light(glass, 0.3), 0, H * 0.58 + 1.5, 1.62); k.quad(3.4, 1.6, light(glass, 0.3), 0, H * 0.58 + 1.5, -1.62, Math.PI); });
      top = H + 14.8; fw = 20;
    } else if (v === 4) {
      slab(k, 13, 13, 0.5, H, glass, frame, 7);
      const y = 0.5 + H;
      k.glow(ON, () => {
        for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.9, 7, 0.9, '#ffd45c', cx * 6, y, cz * 6);
        for (const yy of [y + 3, y + 6.4]) for (let s = 0; s < 4; s++) { const a = s * Math.PI / 2; k.box(12.9, 0.5, 0.6, '#ffd45c', Math.sin(a) * 6, yy, Math.cos(a) * 6, a); }
      });
      k.box(7, 2.2, 7, frame, 0, y, 0);
      top = y + 7; fw = 13;
    } else {
      const r0 = 9.5, r1 = 4.5;
      k.add(ucyl(4, r1, r0), glass, 0, 0.5 + H / 2, 0, Math.PI / 4, 0, 0, r0, H, r0);
      for (let y = 2.5, f = 0; y < H - 1; y += 3.2, f++) {
        const t = y / H, r = r0 + (r1 - r0) * t + 0.08, lit = (f * 3) % 5 < 3;
        const add = () => k.add(ucyl(4, 1, 1, true), lit ? light(glass, 0.3) : dark(glass, 0.15), 0, 0.5 + y, 0, Math.PI / 4, 0, 0, r, 1.4, r);
        if (lit) k.glow(WINDOW, add); else add();
      }
      k.cone(1.0, 10, 4, frame, 0, 0.5 + H, 0, Math.PI / 4); top = H + 10.5; fw = 14;
      k.glow(BLINK, () => k.ball(0.4, '#ff4a3a', 0, top, 0));
    }
    k.rect(0, 0, fw / 2 + 0.6, (v === 3 ? 8 : fw) / 2 + 0.6, 0, top);
    Object.assign(k.info, { footprint: { w: fw + 6, d: (v === 3 ? 8 : fw) + 6 }, height: top });
  });

  // =====================================================================================================
  // Airport. Terminal: 72 long, front (+z) is the apron with three air-bridges, back (-z) the drop-off kerb.
  def('airportTerminal', (k, o = {}) => {
    const LEN = o.length || 72, D = 22, H = 9;
    k.box(LEN + 8, 0.25, D + 10, '#e4d6bd', 0, 0, -2);
    k.box(LEN, H, D, '#eef4f4', 0, 0.25, 0);
    // glass curtain walls front and back (lit at night) with mullions
    for (const zs of [1, -1]) {
      for (let row = 0; row < 2; row++) k.glow(WINDOW, () => k.quad(LEN - 2, 3.4, '#a9d6ec', 0, 2.3 + row * 4, zs * (D / 2 + 0.03), zs > 0 ? 0 : Math.PI));
      for (let x = -LEN / 2 + 4; x < LEN / 2; x += 4) k.box(0.25, H - 0.6, 0.2, '#d8e2e4', x, 0.4, zs * (D / 2 + 0.1));
      k.box(LEN, 0.5, 0.3, '#d8e2e4', 0, 4.2, zs * (D / 2 + 0.1));
    }
    // a gently waving roof: one ribbon with a soft wave along x, overhanging all round
    const roofY = (x) => H + 1.0 + 1.1 * Math.sin(x / LEN * TAU * 1.5);
    const top = [], sides = [], under = [], RD = D / 2 + 4, n = 24;
    for (let i = 0; i < n; i++) {
      const x0 = -LEN / 2 - 3 + i * (LEN + 6) / n, x1 = x0 + (LEN + 6) / n, y0 = roofY(x0), y1 = roofY(x1), t = 0.7;
      top.push({ pts: [[x0, y0, -RD], [x1, y1, -RD], [x1, y1, RD], [x0, y0, RD]], out: [0, 1, 0] });
      under.push({ pts: [[x0, y0 - t, -RD], [x1, y1 - t, -RD], [x1, y1 - t, RD], [x0, y0 - t, RD]], out: [0, -1, 0] });
      for (const zs of [-1, 1]) sides.push({ pts: [[x0, y0, zs * RD], [x1, y1, zs * RD], [x1, y1 - t, zs * RD], [x0, y0 - t, zs * RD]], out: [0, 0, zs] });
      if (i === 0 || i === n - 1) { const xe = i ? x1 : x0, ye = i ? y1 : y0; sides.push({ pts: [[xe, ye, -RD], [xe, ye, RD], [xe, ye - t, RD], [xe, ye - t, -RD]], out: [i ? 1 : -1, 0, 0] }); }
    }
    k.polys('#fbf6ee', top); k.polys(P.honey || '#ffb81f', sides); k.polys('#e9d7b8', under);
    for (let x = -LEN / 2 + 6; x < LEN / 2; x += 12) for (const zs of [-1, 1]) {
      k.cyl(0.35, 0.5, roofY(x) - 0.9, 6, '#f4efe6', x, 0.25, zs * (D / 2 + 3));
    }
    // a roof-top skylight strip
    k.glow(WINDOW, () => { for (let x = -LEN / 2 + 8; x < LEN / 2 - 4; x += 8) k.box(5, 0.4, 2.4, '#bfe3f2', x, roofY(x), 0); });
    // air-bridges to the apron (+z), each on a leg with a rotunda
    for (const bx of [-LEN * 0.32, 0, LEN * 0.32]) {
      k.box(2.6, 2.8, 14, '#e8edf0', bx, 3.6, D / 2 + 7);
      k.glow(WINDOW, () => { k.quad(13, 0.8, '#a9d6ec', bx + 1.32, 5.4, D / 2 + 7, Math.PI / 2); k.quad(13, 0.8, '#a9d6ec', bx - 1.32, 5.4, D / 2 + 7, -Math.PI / 2); });
      k.box(3.4, 3.2, 3.2, '#d8dee2', bx, 3.4, D / 2 + 15);
      k.box(0.6, 3.6, 0.6, '#a99e94', bx, 0, D / 2 + 12); k.box(2.4, 0.5, 1.2, '#7b7480', bx, 0, D / 2 + 12);
      k.cylC(0.4, 0.4, 2.4, 6, '#3a343f', bx, 0.4, D / 2 + 12, 0, 0, Math.PI / 2);
      k.circle(bx, D / 2 + 12, 1.0);
    }
    // landside: a drop-off canopy and planters with palms
    k.box(LEN * 0.6, 0.4, 5, P.teal || '#19a79b', 0, 4.6, -D / 2 - 3);
    for (let x = -LEN * 0.27; x <= LEN * 0.27 + 0.1; x += LEN * 0.18) k.cyl(0.25, 0.25, 4.6, 6, '#f4efe6', x, 0, -D / 2 - 5);
    for (const x of [-LEN / 2 + 2, LEN / 2 - 2]) { k.cyl(1.4, 1.2, 0.8, 8, '#d9cbb4', x, 0.25, -D / 2 - 5); palm(k, x, -D / 2 - 5, 6, 0.6, x > 0 ? 1 : -1, 1.0); k.circle(x, -D / 2 - 5, 1.5); }
    k.rect(0, 0, LEN / 2 + 0.5, D / 2 + 0.5, 0, H + 2);
    Object.assign(k.info, { footprint: { w: LEN + 8, d: D + 36 }, height: H + 2.4 });
  });

  // Control tower: a slim shaft with a flared glass cab, an antenna and a blinking beacon. About 34 high.
  def('controlTower', (k) => {
    k.box(10, 4, 8, '#eef0ee', 0, 0, 0); k.box(10.6, 0.5, 8.6, P.teal || '#19a79b', 0, 4, 0);
    k.glow(WINDOW, () => k.quad(8, 1.6, '#a9d6ec', 0, 2.3, 4.03));
    k.cyl(1.7, 2.2, 24, 8, '#f6f1e7', 0, 4.5, 0);
    for (const y of [10, 17]) k.cyl(2.0, 2.0, 0.5, 8, P.coral || '#ff6b5c', 0, y, 0);
    k.cyl(3.4, 1.8, 2.0, 8, '#f6f1e7', 0, 26.5, 0);
    k.glow(WINDOW, () => k.cyl(4.3, 3.4, 3.0, 8, '#9fd0e4', 0, 28.5, 0));
    k.cyl(4.6, 4.6, 0.6, 8, '#e2d8c8', 0, 31.5, 0);
    k.cyl(2.2, 3.4, 1.0, 8, P.coral || '#ff6b5c', 0, 32.1, 0);
    k.cyl(0.12, 0.18, 4, 4, '#a99e94', 0, 33.1, 0); k.box(1.8, 0.12, 0.12, '#a99e94', 0, 35, 0);
    k.glow(BLINK, () => k.ball(0.35, '#ff4a3a', 0, 37.3, 0));
    k.circle(0, 0, 2.4).rect(0, 0, 5.2, 4.2, 0, 4.5);
    Object.assign(k.info, { footprint: { w: 10.6, d: 8.6 }, height: 37.6 });
  });

  // Airliner (generic, no livery): variant 0 twin-jet (30 long, 28 span), 1 big twin (44 long, 40 span),
  // 2 propeller commuter (21 long, 24 span, high wing). Nose +z. Wheels touch y = 0 with the gear down.
  // userData: gear (the landing-gear pivot), setGear(down), gearH (belly height), length, span, tail colour.
  def('plane', (k, variant = 0, o = {}) => {
    const v = ((variant | 0) % 3 + 3) % 3;
    const S = v === 1 ? { L: 44, R: 2.7, span: 40, tail: '#3d8fe0' } : v === 2 ? { L: 21, R: 1.3, span: 24, tail: P.coral || '#ff6b5c' } : { L: 30, R: 1.9, span: 28, tail: P.teal || '#19a79b' };
    const tail = o.color || S.tail, body = '#fbf6ee', belly = '#e2ddd6', R = S.R, gearH = v === 2 ? 1.1 : v === 1 ? 2.2 : 1.7, yc = gearH + R;
    const zf = S.L / 2 - R * 1.4, zb = -S.L / 2 + R * 3.2;
    k.cylC(R, R, zf - zb, 12, body, 0, yc, (zf + zb) / 2, 0, Math.PI / 2);
    k.boxC(R * 1.5, R * 0.5, zf - zb, belly, 0, yc - R * 0.72, (zf + zb) / 2);
    k.ball(R, body, 0, yc, zf, 1, 1, 1.5, 1);
    k.boxC(R * 1.1, R * 0.32, R * 0.6, '#3d5468', 0, yc + R * 0.5, zf + R * 0.55, 0, -0.5);
    const tl = R * 3.2;
    k.cylC(R * 0.28, R, tl, 12, body, 0, yc + R * 0.35, zb - tl / 2 + 0.05, 0, -Math.PI / 2 + 0.12);
    // cabin windows (warm at night)
    const nw = Math.floor((zf - zb - 3) / 1.3);
    k.glow(WINDOW, () => {
      for (const xs of [-1, 1]) for (let i = 0; i < nw; i++) k.quad(0.42, 0.55, '#5d7fa0', xs * R * 0.99, yc + R * 0.25, zb + 1.5 + i * 1.3, xs * Math.PI / 2);
    });
    for (const xs of [-1, 1]) k.quad(0.9, 1.7, '#e6e0d8', xs * R * 1.0, yc - 0.1, zf - 1.8, xs * Math.PI / 2);
    // wings
    const hs = S.span / 2;
    let wingY, wingZ;
    if (v === 2) {
      wingY = yc + R * 0.95; wingZ = zf - S.L * 0.33;
      k.shape([[-hs, 1.2], [hs, 1.2], [hs, -0.9], [-hs, -0.9]], 0.35, body, 0, wingY + 0.35, wingZ, 0, Math.PI / 2);
      for (const xs of [-1, 1]) {
        const ex = xs * hs * 0.36;
        k.cylC(0.55, 0.45, 3.4, 8, body, ex, wingY - 0.1, wingZ + 0.4, 0, Math.PI / 2);
        k.ball(0.32, tail, ex, wingY - 0.1, wingZ + 2.2);
        for (let b = 0; b < 3; b++) k.boxC(0.22, 1.5, 0.06, '#5a5260', ex + Math.cos(b * TAU / 3 + 0.3) * 0.7, wingY - 0.1 + Math.sin(b * TAU / 3 + 0.3) * 0.7, wingZ + 2.3, 0, 0, b * TAU / 3 + 0.3 + Math.PI / 2);
      }
      k.beam([R * 0.8, yc - R * 0.6, wingZ], [hs * 0.5, wingY, wingZ - 0.2], 0.16, '#d9d2c6'); k.beam([-R * 0.8, yc - R * 0.6, wingZ], [-hs * 0.5, wingY, wingZ - 0.2], 0.16, '#d9d2c6');
      // T-tail
      k.shape([[0, 0], [-3.2, 0], [-4.3, 4.2], [-2.6, 4.2]], 0.3, tail, 0, yc + R * 0.5, zb + 0.8, -Math.PI / 2);
      k.shape([[-3.2, 0.9], [3.2, 0.9], [3.2, -0.5], [-3.2, -0.5]], 0.25, body, 0, yc + R * 0.5 + 4.2, zb - 3.2, 0, Math.PI / 2);
    } else {
      wingY = yc - R * 0.45; wingZ = (zf + zb) / 2 + S.L * 0.04;
      const rc = S.L * 0.2, tip = rc * 0.3, sw = hs * 0.55;
      k.shape([[0, rc * 0.45], [hs, rc * 0.45 - sw], [hs, rc * 0.45 - sw - tip], [0, -rc * 0.55], [-hs, rc * 0.45 - sw - tip], [-hs, rc * 0.45 - sw]], 0.4, body, 0, wingY + 0.4, wingZ, 0, Math.PI / 2);
      for (const xs of [-1, 1]) {
        k.shape([[0, 0], [0.9, 0], [0.9, 1.6], [0.2, 1.6]], 0.15, tail, xs * hs, wingY + 0.3, wingZ + rc * 0.45 - sw - tip * 0.6, -Math.PI / 2 * 1);
        const ex = xs * hs * 0.36, er = R * 0.5, ez = wingZ + rc * 0.45 - sw * 0.36 + 1.0;
        k.cylC(er, er * 0.9, er * 4, 10, body, ex, wingY - er * 0.9, ez, 0, Math.PI / 2);
        k.cylC(er * 0.8, er * 0.8, 0.12, 10, '#5a5260', ex, wingY - er * 0.9, ez + er * 2 + 0.02, 0, Math.PI / 2);
        k.cylC(er * 1.02, er * 1.02, 0.4, 10, tail, ex, wingY - er * 0.9, ez + er * 1.8, 0, Math.PI / 2);
        k.boxC(0.3, er, er * 2, '#e2ddd6', ex, wingY - er * 0.3, ez - er * 0.3);
      }
      const fh = R * 2.6;
      k.shape([[0, 0], [-tl * 0.8, 0], [-tl * 1.05, fh], [-tl * 0.72, fh]], 0.35, tail, 0, yc + R * 0.55, zb + 0.2, -Math.PI / 2);
      const hh = hs * 0.36;
      k.shape([[0, 0.8], [hh, -1.6], [hh, -2.6], [0, -2.4], [-hh, -2.6], [-hh, -1.6]], 0.25, body, 0, yc + R * 0.5, zb - tl * 0.45, 0, Math.PI / 2);
    }
    // nav lights: red on the left (+x), green on the right, a red beacon on top, white strobe at the tail
    k.glow(ON, () => { k.ball(0.22, '#ff4a3a', hs - 0.1, wingY + 0.5, wingZ - 1); k.ball(0.22, '#3ad06a', -hs + 0.1, wingY + 0.5, wingZ - 1); });
    k.glow(BLINK, () => { k.ball(0.22, '#ff4a3a', 0, yc + R + 0.1, (zf + zb) / 2); k.ball(0.2, '#ffffff', 0, yc + R * 0.4, -S.L / 2 + 0.3); });
    // landing gear (its own mesh, so it can tuck away in flight)
    const wr = v === 1 ? 0.7 : 0.5;
    const gear = k.mover('gear', 0, 0, 0, (g) => {
      const wheel = (x, z) => g.cylC(wr, wr, 0.45, 8, '#3a343f', x, wr, z, 0, 0, Math.PI / 2);
      const nz = zf - R * 0.6;
      g.beam([0, wr, nz], [0, yc - R * 0.8, nz], 0.18, '#c9d2db'); wheel(0.3, nz); wheel(-0.3, nz);
      const mz = wingZ - 0.6;
      for (const xs of [-1, 1]) {
        const mx = xs * (R * 0.9 + 0.4);
        g.beam([mx, wr, mz], [mx * 0.8, yc - R * 0.6, mz], 0.24, '#c9d2db');
        wheel(mx + 0.3, mz + 0.65); wheel(mx - 0.3, mz + 0.65); wheel(mx + 0.3, mz - 0.65); wheel(mx - 0.3, mz - 0.65);
      }
    });
    k.rect(0, 0, R + 0.2, S.L / 2, 0, yc + R).rect(0, wingZ, hs, 2.2, 0, wingY + 0.5);
    Object.assign(k.info, {
      footprint: { w: S.span, d: S.L }, height: v === 2 ? yc + R * 0.5 + 4.6 : yc + R * 3.2, length: S.L, span: S.span, gearH, gear, tail,
      setGear(down) { gear.visible = !!down; },
    });
  });

  // Runway piece along z: len long, opts {width=24, end: false (true: threshold stripes and green lights at -z)}.
  // Flat (0.1 high): no colliders.
  def('runwayPiece', (k, len = 60, o = {}) => {
    const W = o.width || 24;
    k.box(W + 6, 0.06, len, '#9fcf7a', 0, 0, 0);
    k.box(W, 0.1, len, '#6e6873', 0, 0, 0);
    for (const xs of [-1, 1]) k.box(0.5, 0.02, len, '#fff3d6', xs * (W / 2 - 0.8), 0.1, 0);
    for (let z = -len / 2 + 3; z < len / 2 - 2; z += 10) k.box(0.6, 0.02, 5, '#fff3d6', 0, 0.1, z + 2.5);
    k.glow(ON, () => { for (let z = -len / 2 + 2; z < len / 2; z += 8) for (const xs of [-1, 1]) k.box(0.35, 0.3, 0.35, '#fff1b0', xs * (W / 2 + 0.6), 0.06, z); });
    if (o.end) {
      for (let i = 0; i < 8; i++) for (const xs of [-1, 1]) k.box(0.9, 0.02, 7, '#fff3d6', xs * (1.8 + i * 1.3), 0.1, -len / 2 + 5);
      k.glow(ON, () => { for (let x = -W / 2; x <= W / 2 + 0.01; x += 2) k.box(0.4, 0.3, 0.4, '#5cf08a', x, 0.06, -len / 2 + 0.6); });
    }
    Object.assign(k.info, { footprint: { w: W + 6, d: len }, height: 0.3 });
  });

  // Airport fence along x: len long, 3 high, posts every 4 with tidy rails. One thin box collider.
  def('airportFence', (k, len = 40) => {
    const n = Math.max(1, Math.round(len / 4));
    for (let i = 0; i <= n; i++) k.box(0.18, 3.1, 0.18, '#a9b0b8', -len / 2 + i * len / n, 0, 0);
    for (const y of [0.3, 1.1, 1.9, 2.7]) k.box(len, 0.07, 0.05, '#c9d2db', 0, y, 0);
    for (let i = 0; i < n; i++) k.box(len / n - 0.3, 2.4, 0.02, '#d6e2e6', -len / 2 + (i + 0.5) * len / n, 0.3, 0);
    k.box(len, 0.12, 0.12, '#a9b0b8', 0, 3.0, 0);
    k.rect(0, 0, len / 2, 0.25, 0, 3);
    Object.assign(k.info, { footprint: { w: len, d: 0.4 }, height: 3.1 });
  });

  // =====================================================================================================
  // Shophouse row: n two-storey shophouses along x (5.2 wide each, 12 deep), arcade ("five-foot way") at the
  // front (+z), shuttered windows, tiled roofs, red lanterns (lit at night) and lit shop fronts.
  const SHOP_COLS = ['#8fe0c4', '#ff9fb8', '#ffd45c', '#9fd4f0', '#ffb38a', '#c9a7e8', '#b9e48a'];
  def('chinatownRow', (k, n = 5) => {
    const SW = 5.2, D = 12, total = n * SW;
    for (let i = 0; i < n; i++) {
      const x = -total / 2 + (i + 0.5) * SW, col = SHOP_COLS[i % SHOP_COLS.length], trim = '#fff6e0', shut = i % 2 ? '#3fae79' : '#c58a55';
      k.at(x, 0, 0, 0, () => {
        k.box(SW, 0.3, D, '#e4d6bd', 0, 0, 0);
        k.box(SW - 0.1, 4.2, D - 2.2, light(col, 0.15), 0, 0.3, -1.1);        // ground floor, set back
        k.box(SW, 4.2, D, col, 0, 4.5, 0);                                    // upper floor over the arcade
        k.box(SW, 0.5, D + 0.2, trim, 0, 4.0, 0.1);
        for (const px of [-SW / 2 + 0.2, SW / 2 - 0.2]) k.box(0.45, 3.7, 0.45, trim, px, 0.3, D / 2 - 0.25);
        // shop front: lit window, doors, a blank signboard
        k.glow(WINDOW, () => k.quad(2.2, 1.9, '#bfe3f2', -0.9, 1.9, D / 2 - 2.18));
        k.quad(1.4, 2.6, '#9b6238', 1.4, 1.6, D / 2 - 2.18);
        k.box(SW - 1, 0.8, 0.12, i % 2 ? '#c9472c' : '#2a8f6c', 0, 3.1, D / 2 - 2.1);
        // upper windows with shutters and pilasters
        for (let w = -1; w <= 1; w++) {
          k.glow(WINDOW, () => k.quad(0.8, 1.9, '#a9d6ec', w * 1.5, 6.4, D / 2 + 0.03));
          k.quad(0.4, 1.9, shut, w * 1.5 - 0.62, 6.4, D / 2 + 0.05); k.quad(0.4, 1.9, shut, w * 1.5 + 0.62, 6.4, D / 2 + 0.05);
          k.box(1.3, 0.2, 0.3, trim, w * 1.5, 5.25, D / 2);
        }
        k.box(SW, 0.6, 0.5, trim, 0, 8.4, D / 2 - 0.1);                       // cornice
        k.box(0.3, 1.4, D, dark(col, 0.12), SW / 2 - 0.15, 8.6, 0);           // party wall up through the roof
        k.prism(SW - 0.2, D + 0.8, 2.6, '#d9673f', 0, 8.7, 0, 0);
        k.box(SW - 0.2, 0.2, 0.6, '#b85230', 0, 8.6, D / 2 + 0.3);
        // two hanging lanterns in the arcade
        for (const lx of [-1.2, 1.2]) {
          k.box(0.04, 0.5, 0.04, '#3a2a3c', lx, 3.5, D / 2 - 1.0);
          k.glow(ON, () => k.ball(0.38, '#ff3b2f', lx, 3.2, D / 2 - 1.0, 1, 1.15, 1, 1));
          k.cyl(0.18, 0.18, 0.1, 6, '#ffb81f', lx, 3.55, D / 2 - 1.0); k.cyl(0.18, 0.18, 0.1, 6, '#ffb81f', lx, 2.72, D / 2 - 1.0);
        }
      });
    }
    k.box(0.3, 9.9, D, dark(SHOP_COLS[0], 0.12), -total / 2 + 0.15, 0, 0);
    // a string of small lanterns along the cornice
    k.glow(TWINKLE, () => { for (let x = -total / 2 + 0.6, i = 0; x < total / 2; x += 1.3, i++) k.ball(0.2, i % 2 ? '#ffb81f' : '#ff3b2f', x, 8.25 - 0.25 * Math.abs(Math.sin(x / 1.3 * Math.PI)), D / 2 + 0.35, 1, 1.2, 1); });
    k.rect(0, -1.1, total / 2, D / 2 - 1.1, 0, 11.3);
    Object.assign(k.info, { footprint: { w: total, d: D }, height: 11.3 });
  });

  // =====================================================================================================
  // Beach park: sand (46 x 26) with palms, striped umbrellas, towels, a lifeguard tower and promenade lamps, the
  // sea along +z (to z = +24). userData.sea = {x, z, hw, hd} (local) if the world wants to keep buses off it.
  def('beachPark', (k) => {
    const SW = 46, SD = 26, sand = '#f6dca0';
    k.box(SW, 0.25, SD, sand, 0, 0, 0);
    k.box(SW, 0.12, 12, '#3fa9dd', 0, 0, SD / 2 + 6);
    k.box(SW, 0.14, 1.2, '#7fd0ef', 0, 0, SD / 2 + 0.6);
    for (let i = 0; i < 14; i++) { const x = -SW / 2 + 2 + (i * 7.3) % (SW - 4), z = SD / 2 + 2.5 + (i * 3.1) % 9; k.box(k.rr(2, 4), 0.02, 0.25, '#bfe8f7', x, 0.12, z); }
    k.box(SW, 0.27, 0.6, '#ffffff', 0, 0, SD / 2 - 0.2);
    k.box(SW, 0.3, 3, '#e4d6bd', 0, 0, -SD / 2 + 1.5);                       // promenade
    for (const x of [-15, 0, 15]) {
      k.cyl(0.12, 0.16, 4.5, 5, '#8f96a0', x, 0.3, -SD / 2 + 0.6);
      k.glow(ON, () => k.ball(0.4, '#fff1b0', x, 5.0, -SD / 2 + 0.6, 1, 0.8, 1));
      k.circle(x, -SD / 2 + 0.6, 0.3);
    }
    [[-18, -6, 7.5, 0.8], [-14, -9, 6.5, -0.5], [12, -7, 8, 1.2], [17, -2, 6.8, 2.4], [-4, -10, 7, 0.2]].forEach(([x, z, h, a]) => {
      palm(k, x, z, h, 0.9, a, 0.25); k.circle(x, z, 0.5);
    });
    const UMB = [P.coral || '#ff6b5c', P.teal || '#19a79b', '#ffb81f', '#5d73e8'];
    [[-10, 2], [-2, 5], [6, 1], [13, 6]].forEach(([x, z], i) => {
      k.cyl(0.07, 0.07, 2.6, 4, '#f4efe6', x, 0.25, z);
      for (let w = 0; w < 8; w++) k.add(new THREE.ConeGeometry(1.8, 0.7, 1, 1, true, w / 8 * TAU, TAU / 8), w % 2 ? '#fff6e0' : UMB[i], x, 2.85 + 0.35 - 0.35, z, 0);
      k.add(cached('disc8', () => new THREE.CircleGeometry(1, 8).rotateX(-Math.PI / 2)), dark(UMB[i], 0.2), x, 2.5, z, 0, Math.PI, 0, 1.75, 1, 1.75);
      k.box(1.0, 0.03, 1.9, i % 2 ? '#ff8fab' : '#8fe0c4', x + 1.4, 0.25, z + 0.6, 0.3);
      k.box(1.0, 0.035, 0.3, '#fff6e0', x + 1.4, 0.25, z + 0.6, 0.3);
    });
    k.ball(0.35, '#ff6b5c', 2, 0.6, 9); k.ball(0.36, '#ffd45c', 2.05, 0.62, 9.05, 0.6, 0.98, 0.98);
    // lifeguard tower
    k.at(-2, 0.25, -1, 0, () => {
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.22, 3, 0.22, '#fff6e0', lx * 1.1, 0, lz * 1.1);
      k.box(3, 0.25, 3, '#c58a55', 0, 3, 0);
      k.box(2.4, 1.8, 2.2, '#ff6b5c', 0, 3.25, -0.2);
      k.quad(1.8, 0.8, '#bfe3f2', 0, 4.4, 0.92);
      k.prism(2.9, 3.0, 0.9, '#fff6e0', 0, 5.05, -0.2, 0);
      for (let r = 0; r < 6; r++) k.box(0.8, 0.08, 0.1, '#e2b07c', 0, 0.4 + r * 0.5, 1.9);
      k.beam([-0.4, 0, 2.2], [-0.4, 3.1, 1.3], 0.1, '#e2b07c'); k.beam([0.4, 0, 2.2], [0.4, 3.1, 1.3], 0.1, '#e2b07c');
      k.cyl(0.05, 0.05, 3, 4, '#f4efe6', 1.3, 3.25, 1.3);
      k.box(0.04, 0.5, 0.9, '#ffd45c', 1.32, 5.7, 1.75); k.box(0.045, 0.25, 0.9, '#ff3b2f', 1.32, 5.7, 1.75);
    });
    k.rect(-2, -1, 1.6, 1.6, 0, 6.3);
    Object.assign(k.info, { footprint: { w: SW, d: SD + 12 }, height: 8.5, sea: { x: 0, z: SD / 2 + 6, hw: SW / 2, hd: 6 } });
  });

  // =====================================================================================================
  // Elevated road kit. elevatedRoad(points, opts) follows a polyline [{x,z}] (in the coordinates the group sits in,
  // usually world coordinates with the group at the origin) and returns one merged mesh:
  //   opts { height = 7.5 (deck top), lanes = 4 (total), laneW = 3.7, rampIn = 0, rampOut = 0 (lengths over which the
  //   deck comes down to the ground at the first/last point: a solid embankment where it's low), pillarEvery = 24,
  //   barrier: 'low' | 'noise' (tall panels), lamps = true, step = 3 (resample spacing) }
  // userData.path = [{x, y, z, s}] samples of the deck top (for driving on it), width, circles (pillars) and boxes
  // (where the deck is under 5.6 high, so a bus can't get underneath). The pieces below wrap it.
  function resample(pts, step) {
    const out = [{ x: pts[0].x, z: pts[0].z, s: 0 }]; let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len / step));
      for (let j = 1; j <= n; j++) out.push({ x: a.x + (b.x - a.x) * j / n, z: a.z + (b.z - a.z) * j / n, s: s + len * j / n });
      s += len;
    }
    return out;
  }
  const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  def('elevatedRoad', (k, pts, o = {}) => {
    if (!pts || pts.length < 2) pts = [{ x: 0, z: -30 }, { x: 0, z: 30 }];
    const lanes = o.lanes || 4, laneW = o.laneW || 3.7, Y = o.height != null ? o.height : 7.5, T = 1.3, PH = 1.05;
    const half = lanes * laneW / 2 + 0.9, S = resample(pts, o.step || 3), total = S[S.length - 1].s;
    const rin = o.rampIn || 0, rout = o.rampOut || 0, CLEAR = 5.6;
    const hAt = (s) => Math.max(0.3, Y * Math.min(rin ? smooth(s / rin) : 1, rout ? smooth((total - s) / rout) : 1));
    const Ls = S.map((p, i) => {
      const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      p.y = hAt(p.s); p.dx = dx; p.dz = dz;
      return [dz, -dx];
    });
    const at = (i, off, y) => [S[i].x + Ls[i][0] * off, y, S[i].z + Ls[i][1] * off];
    const road = [], marks = [], side = [], under = [], parTop = [], parIn = [], glass = [];
    for (let i = 0; i < S.length - 1; i++) {
      const h0 = S[i].y, h1 = S[i + 1].y, j = i + 1;
      road.push({ pts: [at(i, -half, h0), at(j, -half, h1), at(j, half, h1), at(i, half, h0)], out: [0, 1, 0] });
      const dash = Math.floor(S[i].s / 4) % 2 === 0;
      for (let l = 1; l < lanes; l++) {
        const off = -lanes * laneW / 2 + l * laneW, centre = l === lanes / 2, w = centre ? 0.18 : 0.12;
        if (!centre && !dash) continue;
        for (const cc of centre ? [-0.22, 0.22] : [0]) marks.push({ pts: [at(i, off + cc - w, h0 + 0.03), at(j, off + cc - w, h1 + 0.03), at(j, off + cc + w, h1 + 0.03), at(i, off + cc + w, h0 + 0.03)], out: [0, 1, 0] });
      }
      const lowA = h0 < CLEAR || h1 < CLEAR;
      for (const sd of [-1, 1]) {
        const e = sd * half, inn = sd * (half - 0.4), outv = [Ls[i][0] * sd, 0, Ls[i][1] * sd];
        const b0 = lowA ? 0 : h0 - T, b1 = lowA ? 0 : h1 - T;
        side.push({ pts: [at(i, e, h0 + PH), at(j, e, h1 + PH), at(j, e, b1), at(i, e, b0)], out: outv });
        parTop.push({ pts: [at(i, e, h0 + PH), at(j, e, h1 + PH), at(j, inn, h1 + PH), at(i, inn, h0 + PH)], out: [0, 1, 0] });
        parIn.push({ pts: [at(i, inn, h0 + PH), at(j, inn, h1 + PH), at(j, inn, h1), at(i, inn, h0)], out: [-outv[0], 0, -outv[2]] });
        if (o.barrier === 'noise') {
          const g0 = h0 + PH, g1 = h1 + PH, gh = 2.6, gx = sd * (half - 0.2);
          glass.push({ pts: [at(i, gx, g0), at(j, gx, g1), at(j, gx, g1 + gh), at(i, gx, g0 + gh)], out: outv });
          glass.push({ pts: [at(i, gx, g0), at(j, gx, g1), at(j, gx, g1 + gh), at(i, gx, g0 + gh)], out: [-outv[0], 0, -outv[2]] });
          if (i % 2 === 0) { const p = at(i, gx, g0); k.box(0.25, gh + 0.1, 0.25, '#7a8a94', p[0], p[1], p[2], Math.atan2(S[i].dx, S[i].dz)); }
        }
      }
      if (!lowA) under.push({ pts: [at(i, -half, h0 - T), at(j, -half, h1 - T), at(j, half, h1 - T), at(i, half, h0 - T)], out: [0, -1, 0] });
      else {
        const mx = (S[i].x + S[j].x) / 2, mz = (S[i].z + S[j].z) / 2, len = Math.hypot(S[j].x - S[i].x, S[j].z - S[i].z);
        k.rect(mx, mz, half, len / 2 + 0.15, Math.atan2(S[i].dx, S[i].dz), Math.max(h0, h1) + PH);
      }
    }
    // abutments: where the solid embankment meets the deck on piers, close it with an end wall
    const lowSeg = (i) => S[i].y < CLEAR || S[i + 1].y < CLEAR;
    for (let j = 1; j < S.length - 1; j++) {
      const la = lowSeg(j - 1), lb = lowSeg(j); if (la === lb) continue;
      const h = S[j].y, sg = la ? 1 : -1;
      side.push({ pts: [at(j, -half, h - T), at(j, half, h - T), at(j, half, 0), at(j, -half, 0)], out: [S[j].dx * sg, 0, S[j].dz * sg] });
    }
    for (const [i, sgn] of [[0, -1], [S.length - 1, 1]]) {
      const h = S[i].y, out = [S[i].dx * sgn, 0, S[i].dz * sgn], b = h < CLEAR ? 0 : h - T;
      side.push({ pts: [at(i, -half, h), at(i, half, h), at(i, half, b), at(i, -half, b)], out });
    }
    k.polys('#7b7480', road); k.polys('#fff3d6', marks); k.polys('#e8dcc6', side); k.polys('#b9ab95', under);
    k.polys('#fbf3e2', parTop); k.polys('#d9cbb4', parIn);
    if (glass.length) k.polys('#a8d8d0', glass);
    // piers: a column and a crosshead under the deck
    const every = o.pillarEvery || 24;
    for (let s = every / 2; s < total; s += every) {
      let i = 0; while (i < S.length - 2 && S[i + 1].s < s) i++;
      const p = S[i], h = p.y; if (h < CLEAR + 0.4) continue;
      const ry = Math.atan2(p.dx, p.dz);
      k.box(1.8, h - T - 0.9, 2.4, '#e2d8c8', p.x, 0, p.z, ry);
      k.box(half * 2 - 2.5, 1.0, 2.2, '#d6cab6', p.x, h - T - 1.0, p.z, ry);
      k.box(2.4, 0.5, 3.0, '#cdbb9b', p.x, 0, p.z, ry);
      k.circle(p.x, p.z, 1.5);
    }
    if (o.lamps !== false) {
      for (let s = 10, n = 0; s < total - 4; s += 30, n++) {
        let i = 0; while (i < S.length - 2 && S[i + 1].s < s) i++;
        const sd = n % 2 ? 1 : -1, p = at(i, sd * (half - 0.25), S[i].y + PH), q = at(i, sd * (half - 2.2), S[i].y + PH + 5.4);
        k.beam(p, [p[0], p[1] + 5.4, p[2]], 0.16, '#8f96a0');
        k.beam([p[0], p[1] + 5.4, p[2]], q, 0.12, '#8f96a0');
        k.glow(ON, () => k.boxC(0.6, 0.22, 0.9, '#fff1b0', q[0], q[1] - 0.1, q[2], Math.atan2(S[i].dx, S[i].dz)));
      }
    }
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of S) { minX = Math.min(minX, p.x - half); maxX = Math.max(maxX, p.x + half); minZ = Math.min(minZ, p.z - half); maxZ = Math.max(maxZ, p.z + half); }
    Object.assign(k.info, {
      footprint: { w: maxX - minX, d: maxZ - minZ }, height: Y + PH + (o.barrier === 'noise' ? 2.6 : 0), width: half * 2,
      path: S.map((p) => ({ x: p.x, y: p.y, z: p.z, s: p.s })),
    });
  });
  // Straight pieces along z, centred on the origin (all elevatedRoad underneath, same opts):
  L.highwaySegment = (len = 48, lanes = 4, o = {}) => L.elevatedRoad([{ x: 0, z: -len / 2 }, { x: 0, z: len / 2 }], Object.assign({ lanes }, o));
  L.rampPiece = (len = 48, o = {}) => L.elevatedRoad([{ x: 0, z: -len / 2 }, { x: 0, z: len / 2 }], Object.assign({ rampIn: len, pillarEvery: 16 }, o));
  def('pillar', (k, h = 7.5, w = 16) => {
    k.box(1.8, h - 1.3 - 0.9, 2.4, '#e2d8c8', 0, 0, 0); k.box(w - 2.5, 1.0, 2.2, '#d6cab6', 0, h - 2.3, 0); k.box(2.4, 0.5, 3, '#cdbb9b', 0, 0, 0);
    k.circle(0, 0, 1.5);
    Object.assign(k.info, { footprint: { w: w - 2.5, d: 3 }, height: h - 1.3 });
  });
  def('noiseBarrier', (k, len = 12) => {
    const n = Math.max(1, Math.round(len / 4));
    k.box(len, 0.9, 0.5, '#e8dcc6', 0, 0, 0);
    for (let i = 0; i <= n; i++) k.box(0.28, 3.6, 0.28, '#7a8a94', -len / 2 + i * len / n, 0, 0);
    for (let i = 0; i < n; i++) k.box(len / n - 0.3, 2.6, 0.08, i % 2 ? '#a8d8d0' : '#b6e0d8', -len / 2 + (i + 0.5) * len / n, 0.9, 0);
    k.box(len, 0.15, 0.3, '#7a8a94', 0, 3.5, 0);
    k.rect(0, 0, len / 2, 0.3, 0, 3.6);
    Object.assign(k.info, { footprint: { w: len, d: 0.5 }, height: 3.6 });
  });

  // =====================================================================================================
  // Depot kit.
  // parkedBus(type 'single' | 'double' | 'bendy', colour): a cheap merged bus (no wheels turning, lights off), nose +z,
  // kerb doors on +x. Length from BB.fleet.dims when loaded (single ~12, bendy ~18.5, double ~12), width 2.5.
  def('parkedBus', (k, type = 'single', colour) => {
    const paint = colour || P.busGreen || '#3fae49';
    const d = BB.fleet && BB.fleet.dims ? BB.fleet.dims(type) : null;
    const LF = d ? d.LF : (type === 'bendy' ? 10.6 : 12), LR = d ? d.LR : (type === 'bendy' ? 7.2 : 0), GAP = d ? d.GAP : (type === 'bendy' ? 0.9 : 0);
    const deck = d ? d.deck : (type === 'double' ? 2 : 1), roof = d ? d.roof : (deck === 2 ? 4.86 : 3.56), tyre = 0.52;
    const total = LF + GAP + LR, z0 = total / 2;
    const car = (len, zc, front, back) => {
      k.box(2.5, 0.96, len, paint, 0, 0.36, zc);
      k.box(2.52, 0.12, len, dark(paint, 0.25), 0, 0.36, zc);
      const wy = 1.32, wh = deck === 2 ? 1.0 : 1.25;
      k.box(2.46, wh, len - 0.4, '#5b7489', 0, wy, zc);
      k.box(2.5, (deck === 2 ? 0.98 : roof - wy - wh) + 0.02, len, paint, 0, wy + wh, zc);
      if (deck === 2) { k.box(2.46, 1.0, len - 0.4, '#5b7489', 0, 3.3, zc); k.box(2.5, roof - 4.3, len, paint, 0, 4.3, zc); }
      for (const xs of [-1, 1]) for (let z = zc - len / 2 + 1.2; z < zc + len / 2 - 0.8; z += 1.7) k.box(0.04, deck === 2 ? 3.0 : 1.25, 0.12, '#e8e2d6', xs * 1.24, 1.32, z);
      k.box(2.3, 0.12, len - 0.6, light(paint, 0.25), 0, roof, zc);
      if (front) {
        k.box(2.3, 1.5, 0.06, '#3d5468', 0, 1.3, zc + len / 2 + 0.01);
        k.box(1.4, 0.32, 0.08, '#3a343f', 0, roof - 0.5, zc + len / 2 + 0.02);
        k.box(0.8, 0.22, 0.09, '#ffae3a', -0.2, roof - 0.45, zc + len / 2 + 0.03);
        for (const xs of [-0.85, 0.85]) k.box(0.42, 0.2, 0.06, '#fff6c8', xs, 0.62, zc + len / 2 + 0.02);
        k.box(2.5, 0.3, 0.2, '#5a5260', 0, 0.3, zc + len / 2);
        k.box(0.06, 2.2, 1.1, '#3d5468', 1.26, 0.4, zc + len / 2 - 1.3);
      }
      if (back) { for (const xs of [-0.9, 0.9]) k.box(0.36, 0.3, 0.06, '#ff4a3a', xs, 0.75, zc - len / 2 - 0.02); k.box(2.5, 0.3, 0.2, '#5a5260', 0, 0.3, zc - len / 2); }
    };
    const wheel = (z) => { for (const xs of [-1, 1]) { k.cylC(tyre, tyre, 0.36, 8, '#2f2a35', xs * 1.08, tyre, z, 0, 0, Math.PI / 2); k.cylC(0.24, 0.24, 0.38, 6, '#c9d2db', xs * 1.08, tyre, z, 0, 0, Math.PI / 2); } };
    car(LF, z0 - LF / 2, true, !LR);
    if (d) { for (const a of d.axlesF) wheel(z0 - LF / 2 + a); } else { wheel(z0 - 2.4); wheel(z0 - LF + 2.8); }
    if (LR) {
      k.box(2.3, roof - 0.6, GAP + 0.2, '#4a4450', 0, 0.45, z0 - LF - GAP / 2);
      car(LR, z0 - LF - GAP - LR / 2, false, true);
      if (d) { for (const a of d.axlesR) wheel(z0 - LF - GAP - LR / 2 + a); } else wheel(z0 - total + 2);
    }
    k.disc(1, 8, '#6a8a56', 0, 0.02, 0, 1.6, total / 2 + 0.4);
    k.rect(0, 0, 1.35, total / 2 + 0.1, 0, roof);
    Object.assign(k.info, { footprint: { w: 2.6, d: total + 0.2 }, height: roof, length: total });
  });

  // Fuel island: a raised island with two pumps under a canopy 5.6 high (clears a double-decker). Bays either side
  // along z. 8 x 12.
  def('fuelIsland', (k) => {
    k.box(2.0, 0.25, 9, '#e4d6bd', 0, 0, 0); k.box(2.2, 0.1, 9.2, '#ffb81f', 0, 0.25, 0);
    for (const z of [-2.3, 2.3]) {
      k.box(1.0, 1.9, 0.8, '#19a79b', 0, 0.35, z); k.box(1.04, 0.35, 0.84, '#fff6e0', 0, 2.25, z);
      for (const xs of [-1, 1]) {
        k.glow(ON, () => k.quad(0.6, 0.4, '#9ff0e0', xs * 0.505, 1.6, z, xs * Math.PI / 2));
        k.beam([xs * 0.52, 1.3, z + 0.3], [xs * 0.75, 0.6, z + 0.5], 0.08, '#3a343f');
      }
    }
    for (const z of [-4.2, 4.2]) k.cyl(0.18, 0.18, 1.0, 6, '#ffd45c', 0, 0.35, z);
    for (const z of [-3.5, 3.5]) k.box(0.45, 5.4, 0.45, '#f4efe6', 0, 0.35, z);
    k.box(8, 0.5, 12, '#fbf6ee', 0, 5.75, 0);
    k.box(8.2, 0.7, 12.2, '#19a79b', 0, 6.25, 0); k.box(8.24, 0.18, 12.24, '#ffb81f', 0, 6.45, 0);
    k.glow(ON, () => { for (const x of [-2.2, 2.2]) for (const z of [-3.5, 0, 3.5]) k.boxC(1.4, 0.06, 0.8, '#fff6d0', x, 5.72, z); });
    k.rect(0, 0, 1.1, 4.6, 0, 1.2).circle(0, -3.5, 0.4).circle(0, 3.5, 0.4);
    Object.assign(k.info, { footprint: { w: 8.2, d: 12.2 }, height: 6.95 });
  });

  // Bus wash: a portal 6 long (along z) with an opening 4.4 wide and 5.6 high, two spinning brushes.
  // userData.spin (default true), brushes [pivot, pivot]. 3 draw calls.
  def('busWash', (k) => {
    const IW = 4.4, H = 5.8;
    k.box(IW + 3, 0.08, 10, '#9a95a0', 0, 0, 0);
    for (let z = -4; z <= 4; z += 1) k.box(1.2, 0.02, 0.15, '#6e6873', 0, 0.08, z);
    for (const xs of [-1, 1]) {
      k.box(1.1, H, 6, '#fff6e0', xs * (IW / 2 + 0.55), 0, 0);
      k.box(1.2, 0.4, 6.1, '#5d73e8', xs * (IW / 2 + 0.55), H - 1.2, 0);
      k.circle(xs * (IW / 2 + 0.55), -2, 0.8).circle(xs * (IW / 2 + 0.55), 0, 0.8).circle(xs * (IW / 2 + 0.55), 2, 0.8);
      k.rect(xs * (IW / 2 + 0.55), 0, 0.6, 3.05, 0, H);
    }
    k.box(IW + 2.4, 0.9, 6, '#fff6e0', 0, H, 0); k.box(IW + 2.5, 0.3, 6.1, '#5d73e8', 0, H + 0.9, 0);
    for (let i = 0; i < 6; i++) k.ball(0.32, i % 2 ? '#8fd8ff' : '#ffffff', -2 + i * 0.8, H + 1.3, 0, 1, 1, 1);
    k.glow(BLINK, () => k.ball(0.25, '#5cf08a', IW / 2 + 1.12, H - 0.6, 3.05));
    k.glow(ON, () => k.boxC(IW - 0.4, 0.06, 1.2, '#fff6d0', 0, H - 0.03, 0));
    const brushes = [-1, 1].map((xs) => k.mover('brush', xs * 1.75, 0, 0, (b) => {
      b.cyl(0.08, 0.08, 4.8, 4, '#c9d2db', 0, 0.2, 0);
      for (let f = 0; f < 6; f++) b.box(0.08, 4.2, 0.6, f % 2 ? (xs < 0 ? '#ff8fab' : '#8fd8ff') : '#fff6e0', Math.sin(f / 6 * TAU) * 0.35, 0.5, Math.cos(f / 6 * TAU) * 0.35, f / 6 * TAU);
    }));
    Object.assign(k.info, {
      footprint: { w: IW + 3, d: 10 }, height: H + 1.7, spin: true, brushes, inner: IW,
      update(dt) { if (!this.spin) return; brushes[0].rotation.y += dt * 3; brushes[1].rotation.y -= dt * 3; },
    });
  });

  // Gatehouse: a little guard hut (3.2 x 3.2) with windows all round (lit at night) and a flat roof.
  def('gatehouse', (k) => {
    k.box(3.6, 0.25, 3.6, '#e4d6bd', 0, 0, 0);
    k.box(3.2, 1.0, 3.2, '#fff6e0', 0, 0.25, 0);
    k.glow(WINDOW, () => { for (let s = 0; s < 4; s++) { const a = s * Math.PI / 2; k.quad(2.6, 1.2, '#a9d6ec', Math.sin(a) * 1.62, 1.95, Math.cos(a) * 1.62, a); } });
    k.box(3.2, 1.3, 3.2, '#bfe3f2', 0, 1.25, 0);
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.25, 1.3, 0.25, '#fff6e0', cx * 1.5, 1.25, cz * 1.5);
    k.box(3.2, 0.5, 3.2, '#fff6e0', 0, 2.55, 0);
    k.box(4.2, 0.35, 4.2, P.teal || '#19a79b', 0, 3.05, 0);
    k.quad(0.9, 1.9, '#9b6238', -1.62, 1.2, 0.6, -Math.PI / 2);
    k.box(0.8, 0.5, 0.4, '#e2ddd6', 0.6, 3.4, -1.0);
    k.rect(0, 0, 1.7, 1.7, 0, 3.4);
    Object.assign(k.info, { footprint: { w: 4.2, d: 4.2 }, height: 3.9 });
  });

  // Boom gate: a striped post with a counterweight; the arm (len, along +x) lifts. userData.arm (pivot),
  // userData.open (target 0..1), setOpen(t), update eases toward it. 2 draw calls.
  def('boomGate', (k, len = 6.5) => {
    k.box(0.7, 1.1, 0.7, '#fff6e0', 0, 0, 0); k.box(0.72, 0.25, 0.72, '#ff3b2f', 0, 0.4, 0);
    k.box(0.8, 0.12, 0.8, '#3a343f', 0, 0, 0);
    k.glow(BLINK, () => k.ball(0.14, '#ffae3a', 0, 1.25, 0));
    k.circle(0, 0, 0.5);
    const arm = k.mover('arm', 0, 1.0, 0.45, (a) => {
      a.box(0.9, 0.5, 0.3, '#7a7284', -0.6, -0.25, 0);
      const n = Math.round(len / 0.8);
      for (let i = 0; i < n; i++) a.box(len / n, 0.16, 0.12, i % 2 ? '#ff3b2f' : '#ffffff', (i + 0.5) * len / n, -0.08, 0);
      a.glow(BLINK, () => { a.ball(0.09, '#ff3b2f', len * 0.5, 0.12, 0); a.ball(0.09, '#ff3b2f', len - 0.2, 0.12, 0); });
    });
    Object.assign(k.info, {
      footprint: { w: 0.8, d: 0.8 }, height: 1.4, arm, open: 0, len,
      setOpen(t) { this.open = Math.max(0, Math.min(1, t)); },
      update(dt) { const want = this.open * 1.45; arm.rotation.z += (want - arm.rotation.z) * Math.min(1, dt * 3); },
    });
  });

  // Big workshop: an open-front garage (front +z) with `bays` bays (7.5 wide each, 24 deep, 9 high), barrel roofs,
  // rolled-up doors, lifts, a tool wall, tyres, and lights inside (lit at night). Colliders only on the back and side
  // walls and the bay posts, so buses drive in. userData.bays [{x, z}] bay centres (local) for parking.
  def('bigWorkshop', (k, bays = 3) => {
    const BW = 7.5, D = 24, H = 9, Wd = bays * BW;
    k.box(Wd + 2, 0.15, D + 6, '#cfc6bb', 0, 0, 3);
    for (let i = 1; i < bays; i++) k.box(0.2, 0.02, D - 2, '#ffd45c', -Wd / 2 + i * BW, 0.15, 0);
    k.box(Wd + 1, H, 0.6, '#f2e6d2', 0, 0, -D / 2 - 0.3);                       // back wall
    for (const xs of [-1, 1]) {
      k.box(0.6, H, D, '#f2e6d2', xs * (Wd / 2 + 0.3), 0, 0);                    // side walls
      k.box(0.7, 1.0, D + 0.1, '#19a79b', xs * (Wd / 2 + 0.3), 0, 0);
      k.glow(WINDOW, () => { for (let z = -D / 2 + 3; z < D / 2 - 1; z += 4) k.quad(2.6, 1.2, '#a9d6ec', xs * (Wd / 2 + 0.62), H - 2, z, xs * Math.PI / 2); });
      k.rect(xs * (Wd / 2 + 0.3), 0, 0.4, D / 2, 0, H);
    }
    k.rect(0, -D / 2 - 0.3, Wd / 2 + 0.6, 0.4, 0, H);
    k.box(Wd + 1.4, 1.6, 1.0, '#fff6e0', 0, H - 1.6, D / 2);                     // front fascia
    k.box(Wd + 1.5, 0.35, 1.1, '#19a79b', 0, H - 1.95, D / 2);
    for (let i = 0; i < bays; i++) {
      const cx = -Wd / 2 + (i + 0.5) * BW;
      // barrel roof
      k.add(cached('barrel', () => new THREE.CylinderGeometry(1, 1, 1, 10, 1, false, -Math.PI / 2, Math.PI)), i % 2 ? '#ff8f6b' : '#ffb84f', cx, H, 0, 0, -Math.PI / 2, 0, BW / 2, D + 1.4, 1.6);
      k.cylC(0.45, 0.45, BW - 0.6, 8, '#a99e94', cx, H - 2.3, D / 2 + 0.2, 0, 0, Math.PI / 2);   // rolled-up door
      if (i > 0) { k.box(0.5, H - 1.6, 0.5, '#e2d8c8', -Wd / 2 + i * BW, 0, D / 2 - 0.3); k.circle(-Wd / 2 + i * BW, D / 2 - 0.3, 0.45); }
      for (const xs of [-1, 1]) k.box(0.6, 0.25, 9, '#ffd45c', cx + xs * 1.08, 0.15, -2);   // lift rails
      for (const xs of [-1, 1]) k.box(0.3, 1.6, 0.3, '#5d73e8', cx + xs * 2.2, 0.15, -6.8);
      k.glow(ON, () => { for (const z of [-7, 0, 7]) k.boxC(0.8, 0.12, 2.2, '#fff6d0', cx, H - 0.4, z); });
    }
    // tool wall, bench and tyres along the back
    k.box(Wd * 0.6, 2.6, 0.12, '#e8dcc6', -Wd * 0.15, 1.0, -D / 2 + 0.06);
    for (let t = 0; t < 10; t++) k.box(0.3, k.rr(0.5, 1.1), 0.12, k.pick(['#ff6b5c', '#3d8fe0', '#ffb81f', '#19a79b']), -Wd * 0.4 + t * Wd * 0.055, 1.6, -D / 2 + 0.16);
    k.box(4, 0.9, 1.0, '#c58a55', Wd * 0.25, 0.15, -D / 2 + 0.8);
    for (let t = 0; t < 4; t++) k.cyl(0.55, 0.55, 0.35, 8, '#2f2a35', Wd / 2 - 1.2, 0.15 + t * 0.36, -D / 2 + 1.2);
    k.box(1.2, 1.1, 0.8, '#ff3b2f', -Wd / 2 + 1.0, 0.15, -D / 2 + 0.8);
    const list = []; for (let i = 0; i < bays; i++) list.push({ x: -Wd / 2 + (i + 0.5) * BW, z: 0 });
    Object.assign(k.info, { footprint: { w: Wd + 2, d: D + 6 }, height: H + 1.6, bays: list });
  });

  // =====================================================================================================
  // Christmas kit (tropical-festive: lights, trees, gifts; no snow, no faces).
  // christmasTree(size=1): 6.2*size high, baubles twinkle and the star glows at night.
  def('christmasTree', (k, size = 1) => {
    const s = size;
    k.cyl(0.9 * s, 0.75 * s, 0.7 * s, 8, '#c9472c', 0, 0, 0); k.cyl(0.95 * s, 0.95 * s, 0.12 * s, 8, '#ffb81f', 0, 0.6 * s, 0);
    k.cyl(0.22 * s, 0.25 * s, 0.8 * s, 5, '#9b6238', 0, 0.7 * s, 0);
    const tiers = [[2.2, 2.4, 1.2], [1.75, 2.1, 2.5], [1.25, 1.8, 3.6]];
    tiers.forEach(([r, h, y], i) => k.cone(r * s, h * s, 9, i % 2 ? '#2e9a5a' : '#258c52', 0, y * s, 0, i * 0.3));
    // tinsel: a gold spiral of short bars
    let prev = null;
    for (let t = 0; t <= 1.0001; t += 1 / 28) {
      const y = (1.5 + t * 3.4) * s, r = (2.0 - t * 1.55) * s * 0.92, a = t * TAU * 2.6;
      const p = [Math.cos(a) * r, y, Math.sin(a) * r];
      if (prev) k.beam(prev, p, 0.09 * s, '#ffd45c');
      prev = p;
    }
    const BAUB = ['#ff3b2f', '#ffd45c', '#5d9bff', '#ff8fd0', '#ffffff'];
    k.glow(TWINKLE, () => {
      for (let i = 0; i < 16; i++) {
        const t = (i + 0.5) / 16, y = (1.4 + t * 3.6) * s, r = (2.05 - t * 1.6) * s, a = i * 2.4;
        k.ball(0.2 * s, BAUB[i % BAUB.length], Math.cos(a) * r, y, Math.sin(a) * r);
      }
    });
    k.glow(ON, () => k.shape(starPts(0.65 * s, 0.28 * s), 0.18 * s, '#ffd45c', 0, 6.25 * s, 0));
    k.circle(0, 0, 2.2 * s);
    Object.assign(k.info, { footprint: { w: 4.4 * s, d: 4.4 * s }, height: 7 * s });
  });
  function starPts(R, r) { const out = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r : R; out.push([Math.cos(a) * rad, Math.sin(a) * rad]); } return out; }

  // lightString(points [[x,y,z] or {x,y,z}], opts {sag=0.5, spacing=0.7, colours}): wire with twinkling bulbs
  // drooping between each pair of points (1 draw call). Points are in the group's coordinates.
  def('lightString', (k, pts = [[-5, 4, 0], [0, 4, 0], [5, 4, 0]], o = {}) => {
    const P3 = pts.map((p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]));
    const sag = o.sag != null ? o.sag : 0.5, sp = o.spacing || 0.7, COLS = o.colours || ['#ff3b2f', '#ffd45c', '#3ad06a', '#5d9bff', '#ff8fd0'];
    let n = 0, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, top = 0;
    for (let i = 0; i < P3.length - 1; i++) {
      const a = P3[i], b = P3[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), m = Math.max(2, Math.round(len / sp));
      let prev = a;
      for (let j = 1; j <= m; j++) {
        const t = j / m, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * len / 6 * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
        k.beam(prev, p, 0.04, '#3f4a3c');
        if (j < m || i === P3.length - 2) k.glow(TWINKLE, () => k.add(cached('oct', () => new THREE.OctahedronGeometry(1, 0)), COLS[n++ % COLS.length], p[0], p[1] - 0.12, p[2], 0, 0, 0, 0.11, 0.16, 0.11));
        prev = p;
      }
    }
    for (const p of P3) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]); top = Math.max(top, p[1]); }
    Object.assign(k.info, { footprint: { w: maxX - minX, d: maxZ - minZ }, height: top, bulbs: n });
  });

  // wreath(r=0.7): a leafy ring with berries, a red bow and tiny lights, hanging upright facing +z (y = its centre).
  def('wreath', (k, r = 0.7) => {
    k.torus(r, r * 0.28, 5, 12, '#2e9a5a', 0, 0, 0);
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; k.ball(r * 0.2, i % 2 ? '#3fae5c' : '#258c52', Math.cos(a) * r, Math.sin(a) * r, r * 0.12, 1.3, 0.8, 0.7); }
    for (let i = 0; i < 5; i++) { const a = 0.4 + i * 1.1; k.ball(r * 0.08, '#ff3b2f', Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05, r * 0.26); }
    k.glow(TWINKLE, () => { for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + 0.2; k.ball(r * 0.06, i % 2 ? '#ffd45c' : '#ffffff', Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, r * 0.28); } });
    k.boxC(r * 0.5, r * 0.3, r * 0.15, '#e8352a', -r * 0.25, -r, r * 0.3, 0, 0, 0.4);
    k.boxC(r * 0.5, r * 0.3, r * 0.15, '#e8352a', r * 0.25, -r, r * 0.3, 0, 0, -0.4);
    k.boxC(r * 0.14, r * 0.5, r * 0.12, '#c9282a', -r * 0.1, -r * 1.3, r * 0.28, 0, 0, -0.2);
    k.boxC(r * 0.14, r * 0.5, r * 0.12, '#c9282a', r * 0.1, -r * 1.3, r * 0.28, 0, 0, 0.2);
    Object.assign(k.info, { footprint: { w: r * 2.6, d: r * 0.6 }, height: r * 1.3 });
  });

  // giftPile(n=5): wrapped boxes with ribbons and bows, about 2.4 across.
  def('giftPile', (k, n = 5) => {
    const WRAP = [['#ff3b2f', '#ffd45c'], ['#3d8fe0', '#ffffff'], ['#3fae5c', '#ff3b2f'], ['#ffd45c', '#8e62c8'], ['#ff8fd0', '#19a79b'], ['#8e62c8', '#ffd45c']];
    for (let i = 0; i < n; i++) {
      const [c, rb] = WRAP[i % WRAP.length], s = k.rr(0.5, 0.9), a = (i / n) * TAU, r = i ? 0.75 : 0;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = i >= 4 ? 0.8 : 0, ry = k.rr(-0.5, 0.5);
      k.at(x, y, z, ry, () => {
        k.box(s, s * 0.85, s, c, 0, 0, 0);
        k.box(s + 0.02, s * 0.85 + 0.02, s * 0.16, rb, 0, -0.01, 0); k.box(s * 0.16, s * 0.85 + 0.02, s + 0.02, rb, 0, -0.01, 0);
        k.ball(s * 0.16, rb, -s * 0.12, s * 0.9, 0, 1.2, 0.7, 0.7); k.ball(s * 0.16, rb, s * 0.12, s * 0.9, 0, 1.2, 0.7, 0.7);
      });
    }
    k.circle(0, 0, 1.2);
    Object.assign(k.info, { footprint: { w: 2.4, d: 2.4 }, height: 1.6 });
  });

  // candyCane(h=2.4): a red-and-white striped cane with a hook (opening toward +x).
  def('candyCane', (k, h = 2.4) => {
    const r = h * 0.06, n = 10, straight = h - h * 0.22;
    for (let i = 0; i < n; i++) k.cyl(r, r, straight / n, 8, i % 2 ? '#ffffff' : '#ff3b2f', 0, i * straight / n, 0);
    const R = h * 0.17; let prev = [0, straight, 0];
    for (let i = 1; i <= 7; i++) {
      const a = Math.PI - i / 7 * Math.PI * 0.95, p = [R + Math.cos(a) * R, straight + Math.sin(a) * R, 0];
      k.beam(prev, p, r * 2, i % 2 ? '#ffffff' : '#ff3b2f', 8); prev = p;
    }
    k.circle(0, 0, r + 0.1);
    Object.assign(k.info, { footprint: { w: R * 2 + r * 2, d: r * 2 }, height: straight + R + r });
  });

  // santaHat(s=1): a floppy red hat with a white brim and pompom, about 0.9*s high, to sit on things (y = brim bottom).
  def('santaHat', (k, s = 1) => {
    k.torus(0.42 * s, 0.11 * s, 5, 12, '#ffffff', 0, 0.1 * s, 0, 0, Math.PI / 2);
    k.cylC(0.12 * s, 0.4 * s, 0.6 * s, 8, '#e8352a', 0.06 * s, 0.45 * s, 0, 0, 0, -0.25);
    k.cylC(0.04 * s, 0.12 * s, 0.32 * s, 6, '#e8352a', 0.25 * s, 0.78 * s, 0, 0, 0, -1.1);
    k.ball(0.11 * s, '#ffffff', 0.4 * s, 0.7 * s, 0, 1, 1, 1, 1);
    Object.assign(k.info, { footprint: { w: 1.1 * s, d: 1.1 * s }, height: 0.9 * s });
  });
})();
