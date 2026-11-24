/* Bendy Bus 3D: the world.
   A compact Singapore-style neighbourhood: a 3x3 block grid inside a loop road with rounded (curved) corners,
   HDB blocks with coloured stripes and void decks, a hawker centre, an MRT viaduct over the middle road with a train
   gliding along, shophouses, a park and playground, the bus depot, street trees and five bus stops whose signs show a
   picture (no words). Everything static is merged into a few vertex-coloured meshes (see BB.mk in core.js).
   Exposes BB.world = { scene, roads:{nodes,edges}, stops, depot, update(dt), ...helpers }. */
(function () {
  'use strict';
  const BB = window.BB, P = BB.P, C = BB.cfg;
  const S = C.block, RH = C.roadHalf;
  const g = (i) => (i - 1.5) * S;                // grid line -> world coordinate (-69, -23, 23, 69)

  // Deterministic random so the town looks the same every visit.
  let seed = 12345;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rr = (a, b) => a + rnd() * (b - a);
  const rpick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const W = BB.world = { scene: null, roads: { nodes: [], edges: [] }, stops: [], depot: null };

  // ---------- road graph ----------
  const nodeById = {}, edgeById = {};
  function addNode(i, j) {
    const n = { id: 'n' + i + j, x: g(i), z: g(j), edges: [] };
    nodeById[n.id] = n; W.roads.nodes.push(n); return n;
  }
  function addEdge(a, b, points) {
    const e = { id: 'e' + W.roads.edges.length, a: a.id, b: b.id, points, length: 0, cum: [0] };
    for (let i = 1; i < points.length; i++) { e.length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z); e.cum.push(e.length); }
    a.edges.push(e.id); b.edges.push(e.id);
    edgeById[e.id] = e; W.roads.edges.push(e); return e;
  }
  const straight = (a, b) => addEdge(a, b, [{ x: a.x, z: a.z }, { x: b.x, z: b.z }]);
  // Quarter arc around (cx, cz) from node a to node b.
  function arc(a, b, cx, cz) {
    const r = Math.hypot(a.x - cx, a.z - cz);
    let a0 = Math.atan2(a.z - cz, a.x - cx), a1 = Math.atan2(b.z - cz, b.x - cx);
    let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const pts = [], n = 14;
    for (let k = 0; k <= n; k++) { const t = a0 + d * k / n; pts.push({ x: cx + r * Math.cos(t), z: cz + r * Math.sin(t) }); }
    pts[0] = { x: a.x, z: a.z }; pts[n] = { x: b.x, z: b.z };
    return addEdge(a, b, pts);
  }
  (function buildGraph() {
    const N = {};
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if ((i === 0 || i === 3) && (j === 0 || j === 3)) continue;     // the loop's corners are curves
      N[i + '' + j] = addNode(i, j);
    }
    const n = (i, j) => N[i + '' + j];
    // the loop road (rounded corners)
    straight(n(1, 0), n(2, 0)); arc(n(2, 0), n(3, 1), g(2), g(1));
    straight(n(3, 1), n(3, 2)); arc(n(3, 2), n(2, 3), g(2), g(2));
    straight(n(2, 3), n(1, 3)); arc(n(1, 3), n(0, 2), g(1), g(2));
    straight(n(0, 2), n(0, 1)); arc(n(0, 1), n(1, 0), g(1), g(1));
    // the inner grid (the road between (1,2) and (2,2) is left out: that block is the park)
    for (const [i, j, k, l] of [[1, 0, 1, 1], [1, 1, 1, 2], [1, 2, 1, 3], [2, 0, 2, 1], [2, 1, 2, 2], [2, 2, 2, 3],
      [0, 1, 1, 1], [1, 1, 2, 1], [2, 1, 3, 1], [0, 2, 1, 2], [2, 2, 3, 2]]) straight(n(i, j), n(k, l));
  })();
  W.node = (id) => nodeById[id];
  W.edge = (id) => edgeById[id];
  W.edgeBetween = (a, b) => W.roads.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

  // Point on an edge's centre line at distance s from its a end: {x, z, dx, dz} (dx,dz = unit direction a->b).
  W.pointAt = function (e, s) {
    const p = e.points, cum = e.cum;
    s = BB.clamp(s, 0, e.length);
    let i = 1; while (i < p.length - 1 && cum[i] < s) i++;
    const l = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / l;
    const dx = (p[i].x - p[i - 1].x) / l, dz = (p[i].z - p[i - 1].z) / l;
    return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * t, z: p[i - 1].z + (p[i].z - p[i - 1].z) * t, dx, dz };
  };
  // The driving lane of an edge in a travel direction (dir +1 = a->b): the centre line moved C.lane to the LEFT.
  const laneCache = {};
  W.lane = function (e, dir) {
    const key = e.id + (dir > 0 ? '+' : '-');
    if (laneCache[key]) return laneCache[key];
    const src = dir > 0 ? e.points : e.points.slice().reverse();
    const pts = offsetLine(src, C.lane);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    return (laneCache[key] = { pts, cum, len: cum[cum.length - 1], edge: e, dir });
  };
  function offsetLine(src, off) {
    const out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[Math.max(0, i - 1)], b = src[Math.min(src.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      out.push({ x: src[i].x + dz * off, z: src[i].z - dx * off });   // left of travel = (dz, -dx)
    }
    return out;
  }
  W.offsetLine = offsetLine;
  // heading convention used everywhere: forward = (sin h, cos h); an object with rotation.y = h faces forward.
  W.headingOf = (dx, dz) => Math.atan2(dx, dz);

  // ---------- stops and depot ----------
  // Each stop sits on an edge at parameter t, on the kerb to the LEFT of the travel direction `dir` that faces its block.
  const STOP_DEFS = [
    { id: 'hawker', name: 'Hawker Centre', say: 'the hawker centre', pic: 'bowl', from: 'n10', to: 'n20', t: 0.5, toward: [0, -46] },
    { id: 'shops', name: 'Shophouses', say: 'the shops', pic: 'shop', from: 'n01', to: 'n02', t: 0.5, toward: [-46, 0] },
    { id: 'park', name: 'Park', say: 'the park', pic: 'tree', from: 'n11', to: 'n12', t: 0.45, toward: [0, 0] },
    { id: 'playground', name: 'Playground', say: 'the playground', pic: 'slide', from: 'n13', to: 'n23', t: 0.5, toward: [0, 46] },
    { id: 'mrt', name: 'MRT Station', say: 'the MRT station', pic: 'train', from: 'n21', to: 'n22', t: 0.55, toward: [46, 0] },
  ];
  function placeOnKerb(def) {
    const e = W.edgeBetween(def.from, def.to);
    const s = e.length * (e.a === def.from ? def.t : 1 - def.t);
    const p = W.pointAt(e, s);
    const lx = p.dz, lz = -p.dx;                                       // left of a->b
    const dir = (lx * (def.toward[0] - p.x) + lz * (def.toward[1] - p.z)) > 0 ? 1 : -1;
    const fx = p.dx * dir, fz = p.dz * dir;
    const kx = fz, kz = -fx;                                           // kerb side (left of travel)
    return {
      id: def.id, name: def.name, say: def.say, pic: def.pic, edge: e.id, t: s / e.length, dir, kerbSide: 'left',
      s,                                                               // distance from the edge's a end
      pos: { x: p.x + kx * (RH + 2.5), z: p.z + kz * (RH + 2.5) },     // the shelter, on the pavement (clear of the bus roof)
      heading: W.headingOf(fx, fz), fwd: { x: fx, z: fz }, side: { x: kx, z: kz },
    };
  }
  W.stops = STOP_DEFS.map(placeOnKerb);
  W.depot = placeOnKerb({ id: 'depot', name: 'Bus Depot', say: 'the depot', pic: 'depot', from: 'n22', to: 'n23', t: 0.4, toward: [46, 46] });
  const DEPOT_X = 41;            // the depot shed's centre (its door faces the road at x = DEPOT_X - 7)
  W.stopById = (id) => id === 'depot' ? W.depot : W.stops.find((s) => s.id === id);


  // ---------- building the scene ----------
  // Draw calls: sky, ground, roads, town, green, lit windows, lamp heads, lamp pools, signs, train (+ its windows),
  // clouds, cars, birds: about 14 for the whole world.
  let train = null, trainWin = null, clouds = null, sky = null, cars = null, birds = null, pools = null;
  let trainX = -170, trainDir = 1, trainWait = 0;
  let amb, hemi, sun, winMat, lampMat, poolMat, cloudMat;
  let WIN = null;                          // the lit-at-night windows builder (filled alongside the town)
  let TREES = null;                        // trees and lamp posts (their own mesh, so they can fade out of the way)
  // Props between the camera and the bus are "screen-door" faded (dithered discard, cheap: no sorting, no blending).
  const fadeU = { uCam: { value: new THREE.Vector3(0, -999, 0) }, uBus: { value: new THREE.Vector3(0, -999, 0) } };
  function fadeMat(m) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCam = fadeU.uCam; sh.uniforms.uBus = fadeU.uBus;
      sh.vertexShader = 'varying vec3 vFadeW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFadeW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform vec3 uCam; uniform vec3 uBus; varying vec3 vFadeW;\n' + sh.fragmentShader.replace('void main() {', `void main() {
        vec3 ab = uBus - uCam; float t = clamp(dot(vFadeW - uCam, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0);
        float d = length(vFadeW - (uCam + ab * t));
        if (t > 0.02 && t < 0.97 && vFadeW.y > 0.6 && d < 4.8) {
          vec2 q = floor(gl_FragCoord.xy); float chk = mod(q.x + q.y, 2.0), chk2 = mod(q.x, 2.0) * mod(q.y, 2.0);
          if (d < 3.4 ? chk2 < 0.5 : chk < 0.5) discard;
        }`);
    };
    return m;
  }
  const DECK_Y = 12;                       // underside of the MRT viaduct deck
  const VIADUCT_Z = g(1);
  const RING = 84, RING_R = 30, RING_HALF = 3.6;   // the decorative outer road (cars only; the bus never goes there)

  // Shared unit shapes (indexed, so the builder copies them and they can be reused).
  const UBOX = new THREE.BoxGeometry(1, 1, 1), QUAD = new THREE.PlaneGeometry(1, 1);
  const bx = (q, w, h, d, col, x, y, z, ry = 0) => q.add(UBOX, col, x, y + h / 2, z, ry, 0, 0, w, h, d);
  // Run fn with q's and the window builder's frames moved together.
  const A = (q, x, y, z, ry, fn) => q.at(x, y, z, ry, () => WIN.at(x, y, z, ry, () => fn(q)));
  // A window pane facing local +z turned by ry; lit ones glow at night.
  const GLASS = ['#a9d6ec', '#9cc9e2', '#b7def0'];
  function pane(q, x, y, z, ry, w, h, lit = rnd() < 0.62, col) {
    (lit ? WIN : q).add(QUAD, col || (lit ? rpick(GLASS) : '#86afc8'), x, y, z, ry, 0, 0, w, h, 1);
  }

  // ---------- colliders (for free driving): circles {x,z,r} and turned boxes {x,z,hw,hd,ry}, in a coarse grid ----------
  const COLS = W.colliders = [], CELL = 16, grid = new Map();
  const ckey = (i, j) => i * 1000 + j;
  function addCol(c) {
    const R = c.r != null ? c.r : Math.hypot(c.hw, c.hd);
    c.R = R; if (c.ry != null) { c.cos = Math.cos(c.ry); c.sin = Math.sin(c.ry); }
    COLS.push(c);
    for (let i = Math.floor((c.x - R) / CELL); i <= Math.floor((c.x + R) / CELL); i++)
      for (let j = Math.floor((c.z - R) / CELL); j <= Math.floor((c.z + R) / CELL); j++) {
        const k = ckey(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c);
      }
  }
  // A box in a builder frame: local centre (lx,lz) of a frame at (x,z) turned by ry (local +x -> (cos ry, -sin ry)).
  function addBoxAt(x, z, ry, lx, lz, hw, hd, top = 12) {
    const c = Math.cos(ry), s = Math.sin(ry);
    addCol({ x: x + lx * c + lz * s, z: z - lx * s + lz * c, hw, hd, ry, top });
  }
  W.addCircle = (x, z, r) => addCol({ x, z, r });
  W.addBox = (x, z, hw, hd, ry = 0, top = 10) => addCol({ x, z, hw, hd, ry, top });
  W.MAP_R = 150;                           // the bus stays inside this circle
  // Push a circle (x,z,r) out of everything it overlaps. Returns {x, z, hit} (hit = how far it was pushed).
  const _push = { x: 0, z: 0, hit: 0 };
  W.pushOut = function (x, z, r) {
    let hit = 0;
    const seen = [];
    for (let pass = 0; pass < 2; pass++) {
      const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const list = grid.get(ckey(i + di, j + dj)); if (!list) continue;
        for (const c of list) {
          if (pass === 0 && seen.indexOf(c) >= 0) continue; seen.push(c);
          const dx = x - c.x, dz = z - c.z;
          if (dx * dx + dz * dz > (c.R + r) * (c.R + r)) continue;
          if (c.r != null) {
            const d = Math.hypot(dx, dz), m = c.r + r - d;
            if (m > 0) { const ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0; x += ux * m; z += uz * m; hit += m; }
          } else {
            const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;      // into the box's frame
            const qx = BB.clamp(lx, -c.hw, c.hw), qz = BB.clamp(lz, -c.hd, c.hd);
            let ox = lx - qx, oz = lz - qz, d = Math.hypot(ox, oz), px, pz, m;
            if (d > 1e-4) { m = r - d; if (m <= 0) continue; px = ox / d * m; pz = oz / d * m; }
            else {                                                                 // centre inside: out by the nearest side
              const ex = c.hw - Math.abs(lx), ez = c.hd - Math.abs(lz);
              if (ex < ez) { px = (lx < 0 ? -1 : 1) * (ex + r); pz = 0; m = ex + r; } else { px = 0; pz = (lz < 0 ? -1 : 1) * (ez + r); m = ez + r; }
            }
            x += px * c.cos + pz * c.sin; z += -px * c.sin + pz * c.cos; hit += m;
          }
        }
      }
    }
    const d = Math.hypot(x, z), lim = W.MAP_R - r;
    if (d > lim) { hit += d - lim; x *= lim / d; z *= lim / d; }
    _push.x = x; _push.z = z; _push.hit = hit;
    return _push;
  };
  // Ground height (the blocks are raised kerbs with lawns): 0.25 on a block, 0 on roads and outside.
  W.groundY = function (x, z) {
    for (const poly of BLOCK_POLYS) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
      }
      if (inside) return 0.25;
    }
    return 0;
  };
  const BLOCK_POLYS = [];
  // Does a building (box collider) stand between two points? Samples the line against the boxes' footprints and
  // heights (trees and posts are left out: they fade instead). Used by the cameras.
  W.blocksSight = function (x0, y0, z0, x1, y1, z1) {
    const n = Math.max(4, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2));
    for (let k = 1; k < n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t;
      const list = grid.get(ckey(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!list) continue;
      for (const c of list) {
        if (c.r != null || y > c.top) continue;
        const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.hw && Math.abs(lz) < c.hd) return true;
      }
    }
    return false;
  };
  W.viaduct = { z: VIADUCT_Z, deckY: DECK_Y, halfW: 4, x0: -170, x1: 170 };
  // Where the bus parks at a stop (or the depot): its nose 3 past the shelter, 1 toward the kerb from its lane.
  W.bayOf = function (st) {
    if (st._bay) return st._bay;
    const e = W.edge(st.edge), p = W.pointAt(e, st.s), off = C.lane + 0.7;
    const nx = p.x + st.side.x * off + st.fwd.x * 3, nz = p.z + st.side.z * off + st.fwd.z * 3;
    return (st._bay = { nose: { x: nx, z: nz }, x: nx - st.fwd.x * 7.2, z: nz - st.fwd.z * 7.2, heading: st.heading, fwd: st.fwd, side: st.side, len: 15.4, width: 3.4 });
  };

  W.build = function (scene) {
    W.scene = scene;
    scene.fog = new THREE.Fog(0xfbeed6, 95, 260);
    buildSky(scene);
    // soft, mostly flat light (paper-cut look): ambient + a little sky/ground + one gentle warm sun from the upper left
    amb = new THREE.AmbientLight(0xfff8ec, 0.5);
    hemi = new THREE.HemisphereLight(0xfff3dc, 0xb8a58a, 0.22);
    sun = new THREE.DirectionalLight(0xfff0d0, 0.4); sun.position.set(-60, 120, 45);
    scene.add(amb, hemi, sun);

    const ground = BB.mk.builder();
    ground.disc(420, 40, P.grass, 0, 0, 0);
    scene.add(tag(ground.mesh(), 'ground'));

    const roads = BB.mk.builder(), town = BB.mk.builder(), green = BB.mk.builder(), lamps = BB.mk.builder();
    TREES = BB.mk.builder();
    WIN = BB.mk.builder();
    buildRoads(roads);
    buildRingRoad(roads);
    buildBlocks(roads, green);
    buildStreetTrees(green);
    buildHDBs(town);
    buildLandmarks(town, green);
    buildViaduct(town, green);
    buildStops(town);
    const poolPts = buildLamps(town, lamps);
    scene.add(tag(roads.mesh(), 'roads'), tag(town.mesh(), 'town'), tag(green.mesh(), 'green'));
    scene.add(tag(TREES.mesh(fadeMat(new THREE.MeshLambertMaterial({ vertexColors: true }))), 'trees'));
    TREES = null;
    winMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x000000 });
    scene.add(tag(WIN.mesh(winMat), 'windows'));
    lampMat = fadeMat(new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xe9e4da }));
    scene.add(tag(lamps.mesh(lampMat), 'lamps'));
    pools = buildPools(poolPts); scene.add(pools);
    WIN = null;
    scene.add(buildSigns());
    train = buildTrain(); scene.add(train);
    clouds = buildClouds(); scene.add(clouds);
    cars = buildCars(); scene.add(cars);
    birds = buildBirds(); scene.add(birds);
    W.built = true;
    W.setSky(W.sky.target, true);
  };
  const tag = (m, name) => { m.name = name; m.matrixAutoUpdate = false; m.updateMatrix(); return m; };
  const light = (c, t = 0.35) => '#' + new THREE.Color(c).lerp(new THREE.Color('#ffffff'), t).getHexString();
  const dark = (c, t = 0.2) => '#' + new THREE.Color(c).lerp(new THREE.Color('#3a2a3c'), t).getHexString();
  W.light = light; W.dark = dark;

  // ---------- sky: a gradient dome with a paper sun, a crescent moon and stars, following the play time ----------
  // share 0..1 = morning -> afternoon -> evening -> night (the hub's sky clock). Keyframes:
  // [share, top, middle, horizon(=fog), ambient colour, ambient, sun colour, sun, hemi, glow colour, glow]
  const SKY = [
    [0.00, '#5fb8ef', '#a6dcf6', '#ffe9d8', '#fff6ec', 0.52, '#fff0d8', 0.42, 0.22, '#ffc8c0', 0.30],
    [0.40, '#4fb1ea', '#9fd7f4', '#fbeed6', '#fff8ec', 0.52, '#fff0d0', 0.42, 0.22, '#ffe0b0', 0.00],
    [0.62, '#69b0e6', '#b9def2', '#ffe2a8', '#fff0dc', 0.50, '#ffe0b0', 0.42, 0.20, '#ffd27a', 0.25],
    [0.72, '#f0967a', '#ffbf8e', '#ffd27a', '#ffdcbc', 0.48, '#ffb27a', 0.44, 0.18, '#ffb070', 0.55],
    [0.80, '#c86a9e', '#ef8f9c', '#ffa07a', '#ecbccc', 0.43, '#ff9a8a', 0.30, 0.14, '#ff8c9c', 0.45],
    [0.90, '#4a3f8f', '#86599e', '#c9789c', '#a99ed4', 0.38, '#c0a0e0', 0.18, 0.10, '#d070a0', 0.25],
    [1.00, '#1c2154', '#2b3470', '#3f4b92', '#8d99da', 0.36, '#b0c0ff', 0.16, 0.08, '#3f4b92', 0.00],
  ];
  const skyU = {
    top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hor: { value: new THREE.Color() },
    glow: { value: new THREE.Color() }, glowAmt: { value: 0 }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunCol: { value: new THREE.Color('#ffd45c') }, sunAmt: { value: 1 }, moonDir: { value: new THREE.Vector3(0.4, 0.6, 0.7).normalize() },
    moonAmt: { value: 0 }, starAmt: { value: 0 }, time: { value: 0 },
  };
  W.sky = { share: 0, target: 0, night: 0, evening: 0, lights: 0 };
  function buildSky(scene) {
    const geo = new THREE.SphereGeometry(420, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `precision highp float;
        uniform vec3 top, mid, hor, glow, sunDir, sunCol, moonDir; uniform float glowAmt, sunAmt, moonAmt, starAmt, time;
        varying vec3 vDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          vec3 d = normalize(vDir); float y = d.y;
          vec3 c = y > 0.18 ? mix(mid, top, smoothstep(0.18, 0.85, y)) : mix(hor, mid, smoothstep(-0.02, 0.18, y));
          vec2 hz = normalize(d.xz + 1e-4), sz = normalize(sunDir.xz + 1e-4);
          float toward = max(0.0, dot(hz, sz));
          c = mix(c, glow, glowAmt * (1.0 - smoothstep(-0.05, 0.42, y)) * (0.4 + 0.6 * toward));
          float s = dot(d, sunDir);
          c = mix(c, vec3(1.0), sunAmt * 0.16 * step(0.9930, s));
          c = mix(c, vec3(1.0), sunAmt * 0.24 * step(0.9966, s));
          c = mix(c, sunCol, sunAmt * step(0.9985, s));
          c = mix(c, vec3(1.0), sunAmt * 0.35 * step(0.99975, dot(d, normalize(sunDir + vec3(-0.012, 0.014, 0.0)))));
          float m = dot(d, moonDir);
          float cut = step(0.9991, dot(d, normalize(moonDir + vec3(0.022, 0.016, 0.0))));
          c = mix(c, vec3(1.0, 0.97, 0.82), moonAmt * 0.10 * step(0.9955, m));
          c = mix(c, vec3(1.0, 0.95, 0.77), moonAmt * step(0.9989, m) * (1.0 - cut));
          if (starAmt > 0.0 && y > 0.05) {
            vec3 p = d * 64.0; float h = hash(floor(p));
            if (h > 0.972) {
              float r = length(fract(p) - 0.5), tw = 0.55 + 0.45 * sin(time * 2.2 + h * 80.0);
              c = mix(c, vec3(1.0, 0.97, 0.8), starAmt * tw * (1.0 - smoothstep(0.1, 0.2, r)) * smoothstep(0.05, 0.25, y));
            }
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -10; sky.name = 'sky'; sky.frustumCulled = false;
    scene.add(sky);
  }
  const _c1 = new THREE.Color(), _c2 = new THREE.Color();
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function lerpCol(out, a, b, t) { return out.set(a).lerp(_c2.set(b), t); }
  function applySky(ph) {
    let i = 0;
    while (i < SKY.length - 2 && ph > SKY[i + 1][0]) i++;
    const a = SKY[i], b = SKY[i + 1], t = clamp01((ph - a[0]) / (b[0] - a[0]));
    const num = (k) => a[k] + (b[k] - a[k]) * t;
    lerpCol(skyU.top.value, a[1], b[1], t); lerpCol(skyU.mid.value, a[2], b[2], t); lerpCol(skyU.hor.value, a[3], b[3], t);
    lerpCol(skyU.glow.value, a[9], b[9], t); skyU.glowAmt.value = num(10);
    if (amb) {
      lerpCol(amb.color, a[4], b[4], t); amb.intensity = num(5);
      lerpCol(sun.color, a[6], b[6], t); sun.intensity = num(7);
      hemi.intensity = num(8);
    }
    const night = clamp01((ph - 0.8) / 0.2), evening = clamp01((ph - 0.55) / 0.25) * (1 - night);
    const lights = clamp01((ph - 0.7) / 0.18);
    W.sky.night = night; W.sky.evening = evening; W.sky.lights = lights;
    if (W.scene && W.scene.fog) { W.scene.fog.color.copy(skyU.hor.value); W.scene.fog.near = 95 - 20 * night; W.scene.fog.far = 260 - 30 * night; }
    // the sun sets low in the west-south-west, the moon rises opposite
    const el = 0.62 - 0.72 * clamp01(ph / 0.86), az = -2.25;
    skyU.sunDir.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    skyU.sunAmt.value = clamp01((el + 0.05) / 0.08);
    lerpCol(skyU.sunCol.value, '#ffd45c', '#ff8a3d', clamp01((ph - 0.5) / 0.3));
    skyU.moonAmt.value = clamp01((ph - 0.78) / 0.14); skyU.starAmt.value = clamp01((ph - 0.82) / 0.12);
    if (cloudMat) lerpCol(cloudMat.color, '#ffffff', ph < 0.85 ? '#ffc6b0' : '#5c6299', ph < 0.85 ? evening : night).lerp(_c1.set('#ffffff'), ph < 0.85 ? 0.25 : 0);
    if (winMat) winMat.emissive.set('#ffbf52').multiplyScalar(0.95 * lights);
    if (lampMat) lerpCol(lampMat.color, '#e9e4da', '#fff1b0', lights);
    if (poolMat) { poolMat.opacity = 0.55 * lights; pools.visible = lights > 0.02; }
    if (trainWin) trainWin.material = winMat;
  }
  // Public: set the sky for share 0..1 (main.js calls it from the hub's time messages; 1 at the goodnight moment).
  // It eases there over a couple of seconds unless instant.
  W.setSky = function (share, instant) {
    W.sky.target = clamp01(+share || 0);
    if (instant || !W.built) { W.sky.share = W.sky.target; applySky(W.sky.share); }
  };
  W.night = () => W.sky.lights;

  // ---------- roads ----------
  // A ribbon per edge, squares at junctions, dashed centre lines, solid edge lines, a planted median under the viaduct,
  // zebra crossings near the busy places, a yellow bus bay box at every stop and the pavement round the outside.
  const ROAD_Y = 0.04;
  function subPts(e, s0, s1) {               // the part of an edge's centre line between distances s0..s1
    const out = [W.pointAt(e, s0)];
    for (let i = 1; i < e.points.length - 1; i++) if (e.cum[i] > s0 && e.cum[i] < s1) out.push(e.points[i]);
    out.push(W.pointAt(e, s1));
    return out.map((p) => ({ x: p.x, z: p.z }));
  }
  function zebra(b, from, to, s) {
    const e = W.edgeBetween(from, to), d = e.a === from ? s : e.length - s, p = W.pointAt(e, d);
    b.at(p.x, ROAD_Y + 0.012, p.z, W.headingOf(p.dx, p.dz), (q) => {
      for (let k = -4; k <= 4; k++) q.box(0.62, 0.02, 3.2, '#fffaf0', k * 1.08, 0, 0);
    });
  }
  function buildRoads(b) {
    for (const e of W.roads.edges) b.strip(e.points, -RH, RH, ROAD_Y, P.road);
    for (const n of W.roads.nodes) b.box(RH * 2, 0.01, RH * 2, P.road, n.x, ROAD_Y - 0.005, n.z);
    for (const e of W.roads.edges) {
      const inner = subPts(e, RH + 0.4, e.length - RH - 0.4);
      b.strip(inner, RH - 0.75, RH - 0.5, ROAD_Y + 0.008, '#efe6d2');
      b.strip(inner, -RH + 0.5, -RH + 0.75, ROAD_Y + 0.008, '#efe6d2');
      const underViaduct = Math.abs(e.points[0].z - VIADUCT_Z) < 1 && Math.abs(e.points[e.points.length - 1].z - VIADUCT_Z) < 1;
      if (underViaduct) {                                    // planted median strip instead of dashes
        const a = W.pointAt(e, 9), z = W.pointAt(e, e.length - 9);
        const len = Math.abs(z.x - a.x), cx = (a.x + z.x) / 2;
        b.box(len, 0.3, 1.4, P.kerb, cx, 0, a.z);
        b.box(len - 0.4, 0.12, 1.0, P.grassDark, cx, 0.3, a.z);
        for (let x = cx - len / 2 + 2; x < cx + len / 2 - 1; x += 3) b.ball(0.5, rnd() < 0.5 ? '#ff7fb0' : '#5aa848', x, 0.55, a.z, 0, 1, 0.7, 1);
        continue;
      }
      for (let s = 9; s < e.length - 9; s += 6) {
        const p = W.pointAt(e, s + 1.3);
        b.box(0.28, 0.02, 2.6, P.roadLine, p.x, ROAD_Y, p.z, W.headingOf(p.dx, p.dz));
      }
    }
    // zebra crossings near the hawker centre, the playground, the shops, the park and the MRT station
    zebra(b, 'n10', 'n20', 10); zebra(b, 'n13', 'n23', 10); zebra(b, 'n01', 'n02', 36); zebra(b, 'n21', 'n22', 36); zebra(b, 'n11', 'n12', 36);
    for (const st of W.stops.concat([W.depot])) {
      const bay = W.bayOf(st), col = st.id === 'depot' ? P.teal : P.honey, L = bay.len / 2;
      b.at(bay.x, ROAD_Y + 0.01, bay.z, bay.heading, (q) => {   // a yellow box outline on the road: the bus bay
        q.box(0.3, 0.02, bay.len, col, 1.6, 0, 0); q.box(0.3, 0.02, bay.len, col, -1.6, 0, 0);
        q.box(3.5, 0.02, 0.3, col, 0, 0, -L); q.box(3.5, 0.02, 0.3, col, 0, 0, L);
        for (let z = -L + 2; z <= L - 1.5; z += 2.4) q.box(2.8, 0.02, 0.25, light(col, 0.3), 0, 0, z, 0.6);   // hatching
      });
    }
    // outer pavement along the loop road
    const ring = ['n10', 'n20', 'n31', 'n32', 'n23', 'n13', 'n02', 'n01', 'n10'];
    let pts = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const e = W.edgeBetween(ring[i], ring[i + 1]);
      const p = e.a === ring[i] ? e.points : e.points.slice().reverse();
      pts = pts.concat(i ? p.slice(1) : p);
    }
    const probe = offsetLine(pts.slice(0, 3), 6)[1];
    const outer = Math.hypot(probe.x, probe.z) > Math.hypot(pts[1].x, pts[1].z) ? 1 : -1;
    b.strip(pts, outer * RH, outer * (RH + 3), 0.2, P.pave);
    b.strip(pts, outer * RH, outer * (RH + 0.5), 0.24, P.kerb);
    W.ringPts = pts;
  }

  // The decorative outer road: a rounded square well outside the loop. Only the little cars use it.
  const ringPath = (function () {
    const pts = [], k = RING - RING_R;
    for (const [cx, cz, a0] of [[k, k, 0], [-k, k, Math.PI / 2], [-k, -k, Math.PI], [k, -k, -Math.PI / 2]]) {
      for (let i = 0; i <= 10; i++) { const a = a0 + (Math.PI / 2) * i / 10; pts.push({ x: cx + RING_R * Math.cos(a), z: cz + RING_R * Math.sin(a) }); }
    }
    pts.push({ x: pts[0].x, z: pts[0].z });
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    return { pts, cum, len: cum[cum.length - 1] };
  })();
  function ringAt(s, off, out) {
    const L = ringPath.len; s = ((s % L) + L) % L;
    let i = 1; while (ringPath.cum[i] < s) i++;
    const a = ringPath.pts[i - 1], b = ringPath.pts[i], l = ringPath.cum[i] - ringPath.cum[i - 1], t = (s - ringPath.cum[i - 1]) / l;
    const dx = (b.x - a.x) / l, dz = (b.z - a.z) / l;
    out.x = a.x + (b.x - a.x) * t + dz * off; out.z = a.z + (b.z - a.z) * t - dx * off; out.dx = dx; out.dz = dz;
    return out;
  }
  const nearRing = (x, z, m) => {
    const k = RING - RING_R, ax = Math.abs(x), az = Math.abs(z);
    let d;
    if (ax > k && az > k) d = Math.abs(Math.hypot(ax - k, az - k) - RING_R);
    else if (ax > k) d = Math.abs(ax - RING); else if (az > k) d = Math.abs(az - RING);
    else d = Math.min(RING - ax, RING - az);
    return d < RING_HALF + m;
  };
  W.nearRing = nearRing;
  function buildRingRoad(b) {
    const pts = ringPath.pts;
    b.strip(pts, -RING_HALF, RING_HALF, 0.03, P.road);
    b.strip(pts, RING_HALF, RING_HALF + 0.5, 0.16, P.kerb); b.strip(pts, -RING_HALF - 0.5, -RING_HALF, 0.16, P.kerb);
    const q = {};
    for (let s = 0; s < ringPath.len; s += 6) {
      ringAt(s, 0, q);
      b.box(0.24, 0.02, 2.4, P.roadLine, q.x, 0.035, q.z, W.headingOf(q.dx, q.dz));
    }
  }

  // Blocks: raised pavement (extruded, so it has a kerb), with a lawn on top.
  const BLOCKS = [];         // {shape points [{x,z}], kind}
  function rectPts(x0, z0, x1, z1, r) {
    const out = [], corners = [[x1 - r, z1 - r, 0], [x0 + r, z1 - r, Math.PI / 2], [x0 + r, z0 + r, Math.PI], [x1 - r, z0 + r, -Math.PI / 2]];
    for (const [cx, cz, a0] of corners) for (let k = 0; k <= 4; k++) { const a = a0 + (Math.PI / 2) * k / 4; out.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) }); }
    return out;
  }
  function cornerPts(ci, cj, sx, sz, m) {  // corner block inside a loop curve centred on grid point (ci,cj), inset m
    const cx = g(ci), cz = g(cj), r = S - RH - m, M = RH + m, out = [];
    const lim = (v, c, s) => s < 0 ? Math.min(v, c - M) : Math.max(v, c + M);
    out.push({ x: cx + sx * M, z: cz + sz * M });
    for (let k = 0; k <= 12; k++) {
      const a = (Math.PI / 2) * k / 12;
      const x = cx + sx * r * Math.cos(a), z = cz + sz * r * Math.sin(a);
      out.push({ x: lim(x, cx, sx), z: lim(z, cz, sz) });
    }
    return out;
  }
  function shapeOf(p) {
    const sh = new THREE.Shape();
    p.forEach((q, i) => i ? sh.lineTo(q.x, -q.z) : sh.moveTo(q.x, -q.z));
    sh.closePath();
    return sh;
  }
  function buildBlocks(b, green) {
    const in0 = (i) => g(i) + RH, in1 = (i) => g(i + 1) - RH;
    // the middle-of-side blocks are rectangles, the park takes two cells, the four corner cells are curved
    for (const [bi, bj] of [[1, 0], [0, 1], [2, 1]]) BLOCKS.push((m) => rectPts(in0(bi) + m, in0(bj) + m, in1(bi) - m, in1(bj) - m, 3));
    BLOCKS.push((m) => rectPts(in0(1) + m, in0(1) + m, in1(1) - m, in1(2) - m, 3));
    BLOCKS.push((m) => cornerPts(1, 1, -1, -1, m), (m) => cornerPts(2, 1, 1, -1, m), (m) => cornerPts(2, 2, 1, 1, m), (m) => cornerPts(1, 2, -1, 1, m));
    for (const pts of BLOCKS) {
      BLOCK_POLYS.push(pts(0));
      const ex = new THREE.ExtrudeGeometry(shapeOf(pts(0)), { depth: 0.25, bevelEnabled: false, curveSegments: 4 });
      ex.rotateX(-Math.PI / 2);
      b.addM(ex, P.pave, new THREE.Matrix4());
      const lawn = new THREE.ShapeGeometry(shapeOf(pts(2.6)));
      lawn.rotateX(-Math.PI / 2);
      green.addM(lawn, P.grass, new THREE.Matrix4().makeTranslation(0, 0.27, 0));
    }
  }

  // ---------- trees ----------
  const TREE_GREENS = ['#5fb84f', '#6fc45a', '#4fa847', '#7ccf5f', '#58b064'];
  function tree(b, x, z, y0 = 0.27, kind, s = 1) {
    kind = kind || (rnd() < 0.55 ? 'rain' : rnd() < 0.8 ? 'round' : 'flame');
    const col = rpick(TREE_GREENS);
    if (Math.hypot(x, z) < 160) W.addCircle(x, z, 0.9 * s);
    b.disc(2.6 * s, 7, P.grassDark, x + 0.6, y0 + 0.02, z + 0.5, 1, 0.8);       // soft shadow patch
    if (TREES) b = TREES;                     // trees go in their own mesh, which fades between the camera and the bus
    if (kind === 'rain') {                    // Singapore rain tree: a wide umbrella crown
      b.cyl(0.32 * s, 0.5 * s, 3.4 * s, 5, P.woodDark, x, y0, z);
      b.ball(3.2 * s, col, x, y0 + 4.6 * s, z, 0, 1.35, 0.5, 1.35);
      b.ball(2.0 * s, light(col, 0.18), x - 1.0 * s, y0 + 5.4 * s, z - 0.8 * s, 0, 1.2, 0.55, 1.2);
    } else if (kind === 'palm') {
      b.cyl(0.25 * s, 0.4 * s, 5.5 * s, 5, P.wood, x, y0, z, 0, 0.08, 0);
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; b.box(0.5 * s, 0.15, 3 * s, P.pine, x + Math.sin(a) * 1.3 * s, y0 + 5.4 * s, z + Math.cos(a) * 1.3 * s, a, 0.35); }
    } else if (kind === 'flame') {            // a flowering tree (bright orange-red or pink crown)
      const f = rnd() < 0.5 ? '#ff7a4a' : '#ff8fc0';
      b.cyl(0.3 * s, 0.45 * s, 3 * s, 5, P.woodDark, x, y0, z);
      b.ball(2.7 * s, col, x, y0 + 4.2 * s, z, 0, 1.3, 0.55, 1.3);
      b.ball(2.2 * s, f, x + 0.3 * s, y0 + 4.9 * s, z - 0.2 * s, 0, 1.2, 0.5, 1.2);
    } else {
      b.cyl(0.28 * s, 0.4 * s, 2.4 * s, 5, P.woodDark, x, y0, z);
      b.ball(2.1 * s, col, x, y0 + 3.9 * s, z, 0, 1, 1.1, 1);
      b.ball(1.1 * s, light(col, 0.2), x - 0.7 * s, y0 + 4.6 * s, z - 0.6 * s, 0);
    }
  }
  W.tree = tree;
  // Is (x,z) clear of roads (and stops)? Used when scattering things.
  function clearOfRoads(x, z, margin) {
    for (const e of W.roads.edges) {
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1], c = e.points[i];
        const dx = c.x - a.x, dz = c.z - a.z, l2 = dx * dx + dz * dz;
        const t = BB.clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
        if (Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < margin) return false;
      }
    }
    for (const st of W.stops.concat([W.depot])) if (Math.hypot(st.pos.x - x, st.pos.z - z) < 7) return false;
    return true;
  }
  W.clearOfRoads = clearOfRoads;
  function buildStreetTrees(b) {
    for (const e of W.roads.edges) {
      for (let s = 12; s < e.length - 10; s += 11) {
        const p = W.pointAt(e, s);
        for (const side of [1, -1]) {
          const x = p.x + p.dz * side * (RH + 1.3), z = p.z - p.dx * side * (RH + 1.3);
          if (Math.abs(z - VIADUCT_Z) < 9 && Math.abs(x) < 170) continue;
          if (inDepotYard(x, z)) continue;
          if (!clearOfRoads(x, z, RH + 1)) continue;
          if (W.stops.concat([W.depot]).some((st) => Math.hypot(st.pos.x - x, st.pos.z - z) < 9)) continue;
          if (x < -50 && x > -60 && Math.abs(z) < 20) continue;               // keep the shophouse fronts clear
          tree(b, x, z, Math.hypot(x, z) > 74 ? 0.2 : 0.27, 'round', 0.8);
        }
      }
    }
  }
  const inDepotYard = (x, z) => x > 27 && x < 50 && z > 27 && z < 55;

  // ---------- little people (static, merged): on void decks, at the hawker centre, in the park ----------
  const SKINS = ['#f1c7a0', '#d9a679', '#a8714a', '#f5d3b5', '#7a4b2e'], HAIRS = ['#3a2a2c', '#6b4a2e', '#1f1b22', '#b5793e', '#d8d0c8'];
  const SHIRTS = [P.coral, P.teal, P.honey, P.berry, P.plum, P.leaf, P.rose, '#f28b4b', '#ffffff'];
  function figure(q, x, y, z, ry, sit, s = 1) {
    const shirt = rpick(SHIRTS), skin = rpick(SKINS), hair = rpick(HAIRS);
    q.at(x, y, z, ry, (f) => {
      if (sit) { f.box(0.5 * s, 0.22 * s, 0.6 * s, '#4a5a78', 0, 0.42 * s, 0.25 * s); f.box(0.45 * s, 0.45 * s, 0.2 * s, '#4a5a78', 0, 0, 0.5 * s); }
      else { f.box(0.2 * s, 0.75 * s, 0.22 * s, '#4a5a78', -0.12 * s, 0, 0); f.box(0.2 * s, 0.75 * s, 0.22 * s, '#4a5a78', 0.12 * s, 0, 0); }
      const by = sit ? 0.55 * s : 0.72 * s;
      f.cyl(0.24 * s, 0.3 * s, 0.8 * s, 6, shirt, 0, by, 0);
      f.ball(0.26 * s, skin, 0, by + 1.08 * s, 0);
      f.ball(0.27 * s, hair, 0, by + 1.17 * s, -0.05 * s, 0, 1, 0.72, 1);
    });
  }

  // ---------- HDB blocks ----------
  // Pastel bodies with a contrasting accent: coloured vertical stripes, gable ends and roof parapet, white corridor
  // ledges, little windows (lit ones glow at night), a void deck with round pillars and people, a stair/lift core
  // with a motor room, water tanks on the roof, laundry poles out of the back windows.
  const SCHEMES = [
    { body: '#ffe1cf', accent: '#ff6b5c', trim: '#fff7ee' },   // peach + coral
    { body: '#d3efe2', accent: '#19a79b', trim: '#f4fff9' },   // mint + teal
    { body: '#e6dcfa', accent: '#8e62c8', trim: '#fbf7ff' },   // lilac + plum
    { body: '#fff0bd', accent: '#f28b4b', trim: '#fffaf0' },   // butter + orange
    { body: '#d3e9fb', accent: '#4f7fe0', trim: '#f5fbff' },   // sky + blue
    { body: '#ffdbe6', accent: '#e0527a', trim: '#fff6f9' },   // pink + raspberry
    { body: '#f4ead2', accent: '#4fa847', trim: '#fffaf0' },   // cream + green
  ];
  const scheme = (s) => typeof s === 'number' ? SCHEMES[s % SCHEMES.length] : s || rpick(SCHEMES);
  const FH = 2.6, VD = 3.2;
  function voidDeck(q, len, dep, sc, people, far) {
    bx(q, len + 0.4, 0.25, dep + 0.4, '#efe4d0', 0, 0, 0);
    bx(q, len * 0.34, VD, dep - 2.6, dark(sc.body, 0.12), -len * 0.16, 0.25, 0);          // lift lobby
    bx(q, 1.6, 1.2, 0.2, sc.accent, -len * 0.16, 0.8, (dep - 2.6) / 2 + 0.1);              // letterboxes
    const n = far ? 2 : Math.max(3, Math.round(len / 6));
    for (let i = 0; i <= n; i++) {
      const px = -len / 2 + 0.5 + (len - 1) * i / n;
      for (const pz of [-dep / 2 + 0.55, dep / 2 - 0.55]) bx(q, 0.66, VD - 0.25, 0.66, sc.trim, px, 0.25, pz);
    }
    if (people) {
      bx(q, 2.2, 0.45, 0.6, P.wood, len * 0.22, 0.25, 0.4);                                  // a bench, a stone table
      q.cyl(0.6, 0.5, 0.75, 7, '#d8cfc2', len * 0.3, 0.25, -1.4);
      for (let k = 0; k < people; k++) figure(q, len * (0.18 + 0.1 * k), 0.25, 0.4 - (k % 2) * 0.1, Math.PI + rr(-0.3, 0.3), k !== 2);
    }
  }
  function hdb(b, x, z, ry, len, dep, floors, sc, opt = {}) {
    sc = scheme(sc);
    const H = VD + floors * FH, far = opt.far, roof = opt.roof || (rnd() < 0.3 ? 'pitch' : 'flat');
    if (!far) addBoxAt(x, z, ry, 1.6, 0, len / 2 + 1.8, dep / 2 + 0.6, H + 2);
    A(b, x, 0, z, ry, (q) => {
      voidDeck(q, len, dep, sc, far ? 0 : opt.people != null ? opt.people : (rnd() < 0.6 ? 2 + (rnd() < 0.4 ? 1 : 0) : 0), far);
      bx(q, len, floors * FH, dep, sc.body, 0, VD, 0);
      // gable end in the accent colour, a stair/lift core at the other end
      bx(q, 0.3, floors * FH + 0.4, dep + 0.3, sc.accent, -len / 2 - 0.15, VD - 0.2, 0);
      bx(q, 3.2, H + 1.4, 3.8, sc.accent, len / 2 + 1.6, 0, 0);
      bx(q, 3.4, 0.5, 4.0, sc.trim, len / 2 + 1.6, H + 1.4, 0);
      bx(q, 2.4, 1.4, 2.8, sc.trim, len / 2 + 1.6, H + 1.9, 0);                              // lift motor room
      if (!far) for (let f = 0; f < floors; f += 1) pane(q, len / 2 + 3.22, VD + f * FH + 1.1, 0, Math.PI / 2, 0.5, 1.6, f % 2 === 0, '#bfe3f2');
      // vertical accent stripes on both long faces
      const stripes = [-len * 0.2, len * 0.2];
      for (const sx of stripes) for (const sz of [1, -1]) bx(q, 1.3, floors * FH, 0.24, sc.accent, sx, VD, sz * (dep / 2 + 0.1));
      // corridor face (+z): white parapet ledge every floor; doors and windows behind it
      const n = Math.max(4, Math.floor(len / 2.5));
      for (let f = 0; f < floors; f++) {
        const y = VD + f * FH;
        if (!far || f % 3 === 0) bx(q, len + 0.15, 0.95, 0.42, f % 4 === 3 ? light(sc.accent, 0.25) : sc.trim, 0, y, dep / 2 + 0.2);
        if (f % 3 === 0 && !far) bx(q, len + 0.3, 0.2, dep + 0.3, sc.trim, 0, y - 0.1, 0);
        if (far) { pane(q, 0, y + 1.5, dep / 2 + 0.02, 0, len * 0.9, 0.9, rnd() < 0.5); pane(q, 0, y + 1.3, -dep / 2 - 0.02, Math.PI, len * 0.9, 0.9, rnd() < 0.5); continue; }
        for (let i = 0; i < n; i++) {
          const wx = -len / 2 + (i + 0.5) * len / n;
          if (stripes.some((s) => Math.abs(s - wx) < 1.1)) continue;
          if (i % 3 === 1) q.add(QUAD, dark(sc.accent, 0.25), wx, y + 1.62, dep / 2 + 0.01, 0, 0, 0, 0.8, 1.35, 1);   // a front door
          else pane(q, wx, y + 1.62, dep / 2 + 0.01, 0, 0.9, 0.7);
          pane(q, wx, y + 1.35, -dep / 2 - 0.01, Math.PI, 1.0, 1.15);                       // back windows
          if (f > 0 && (i * 7 + f * 3) % 11 === 0) {                                          // a laundry pole with clothes
            bx(q, 0.08, 0.08, 1.8, '#c9b48e', wx, y + 0.75, -dep / 2 - 0.9);
            for (let c = 0; c < 2; c++) bx(q, 0.5, 0.55, 0.06, rpick(SHIRTS), wx + (c ? 0.25 : -0.25), y + 0.2, -dep / 2 - 0.6 - c * 0.6);
          }
        }
      }
      // roof: an accent parapet, water tanks on stilts, sometimes a pitched "hat"
      bx(q, len + 0.5, 0.9, dep + 0.5, sc.accent, 0, H, 0);
      bx(q, len - 0.2, 0.2, dep - 0.2, sc.trim, 0, H + 0.6, 0);
      if (roof === 'pitch') q.prism(len * 0.86, dep + 0.8, 2.6, sc.accent, 0, H + 0.9, 0);
      else for (const tx of [-len * 0.3, -len * 0.05]) {
        for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) bx(q, 0.18, 1.0, 0.18, '#a99e94', tx + lx, H + 0.8, lz);
        q.cyl(1.25, 1.25, 1.5, 8, '#e9e2d6', tx, H + 1.8, 0); q.cyl(1.3, 1.3, 0.2, 8, sc.accent, tx, H + 3.3, 0);
      }
    });
  }
  // A point block: a square tower with accent corners, windows on all four faces and a crown on top.
  function tower(b, x, z, ry, size, floors, sc, opt = {}) {
    sc = scheme(sc);
    const H = VD + floors * FH;
    if (!opt.far) addBoxAt(x, z, ry, 0, 0, size / 2 + 0.3, size / 2 + 0.3, H + 5);
    A(b, x, 0, z, ry, (q) => {
      voidDeck(q, size - 0.6, size - 0.6, sc, opt.far ? 0 : rnd() < 0.5 ? 2 : 0, opt.far);
      bx(q, size, floors * FH, size, sc.body, 0, VD, 0);
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(q, 1.3, floors * FH + 0.6, 1.3, sc.accent, cx * (size / 2 - 0.45), VD, cz * (size / 2 - 0.45));
      const n = Math.max(2, Math.floor((size - 2.6) / 2.2));
      for (let f = 0; f < floors; f++) {
        const y = VD + f * FH;
        if (!opt.far || f % 3 === 0) bx(q, size + 0.3, 0.22, size + 0.3, f % 4 === 3 ? sc.accent : sc.trim, 0, y - 0.1, 0);
        for (let r = 0; r < 4; r++) {
          const a = r * Math.PI / 2;
          if (opt.far && f % 2) continue;
          A(q, 0, 0, 0, a, (w) => {
            if (opt.far) { pane(w, 0, y + 2.7, size / 2 + 0.02, 0, size - 3, 2.2, rnd() < 0.5); return; }
            for (let i = 0; i < n; i++) pane(w, -(size - 2.6) / 2 + (i + 0.5) * (size - 2.6) / n, y + 1.4, size / 2 + 0.01, 0, 1.0, 1.1);
          });
        }
      }
      bx(q, size + 0.6, 0.9, size + 0.6, sc.accent, 0, H, 0);
      bx(q, size * 0.55, 1.6, size * 0.55, sc.trim, 0, H + 0.9, 0);
      q.add(new THREE.ConeGeometry(size * 0.48, 2.4, 4), sc.accent, 0, H + 2.5 + 1.2, 0, Math.PI / 4);
    });
  }
  // A newer block: a slab with bright bay windows/balconies in alternating colours and a stepped roof feature.
  function bayBlock(b, x, z, ry, len, dep, floors, sc) {
    sc = scheme(sc);
    const H = VD + floors * FH, cols = [sc.accent, sc.trim, light(sc.accent, 0.45)];
    addBoxAt(x, z, ry, 0, 0, len / 2 + 0.4, dep / 2 + 1.0, H + 4);
    A(b, x, 0, z, ry, (q) => {
      voidDeck(q, len, dep, sc, rnd() < 0.7 ? 2 : 0);
      bx(q, len, floors * FH, dep, sc.body, 0, VD, 0);
      const n = Math.max(3, Math.floor(len / 4));
      for (let f = 0; f < floors; f++) {
        const y = VD + f * FH;
        bx(q, len + 0.2, 0.18, dep + 0.2, sc.trim, 0, y - 0.09, 0);
        for (let i = 0; i < n; i++) {
          const wx = -len / 2 + (i + 0.5) * len / n;
          for (const sz of [1, -1]) {
            if (sz > 0) bx(q, 2.6, 0.5, 0.9, cols[(i + f) % 3], wx, y + 0.25, dep / 2 + 0.45);   // balcony (road side)
            pane(q, wx, y + 1.5, sz * (dep / 2 + 0.01), sz > 0 ? 0 : Math.PI, 1.6, 1.2);
          }
        }
      }
      bx(q, len + 0.5, 0.8, dep + 0.5, sc.accent, 0, H, 0);
      bx(q, len * 0.6, 1.6, dep * 0.7, sc.trim, 0, H + 0.8, 0);
      q.prism(len * 0.5, dep * 0.75, 2.2, sc.accent, 0, H + 2.4, 0);
    });
  }
  W.hdb = hdb; W.tower = tower; W.bayBlock = bayBlock;

  const ESTATES = [];        // footprints of the outer blocks (for keeping trees off them)
  function buildHDBs(b) {
    // corner blocks inside the loop's curves
    hdb(b, -45, -45, -Math.PI / 4, 18, 8, 9, 0, { people: 3, roof: 'flat' });
    tower(b, 43, -43, 0, 10, 12, 1);
    bayBlock(b, -45, 45, Math.PI / 4, 18, 8, 10, 2);
    // outside the loop: a ring of estates in a mix of block types and colour schemes
    const spots = [];
    for (const side of [-1, 1]) {
      for (const k of [-60, -10, 40]) spots.push([k + 8, side * 100, 0]);          // north and south rows
      for (const k of [-58, 52]) spots.push([side * 100, k, Math.PI / 2]);         // west and east (clear of the viaduct)
      spots.push([side * 128, 8, Math.PI / 2]);
    }
    let si = 3;
    for (const [x, z, ry] of spots) {
      const r = rnd(), sc = si++;
      if (r < 0.28) tower(b, x, z, ry, 11, Math.round(rr(11, 15)), sc);
      else if (r < 0.55) bayBlock(b, x, z, ry, rr(22, 26), 8, Math.round(rr(9, 13)), sc);
      else hdb(b, x, z, ry, rr(24, 30), 8, Math.round(rr(9, 14)), sc);
      ESTATES.push([x, z]);
    }
    for (const [x, z] of [[100, 100], [-100, 100], [100, -100], [-100, -100]]) { tower(b, x, z, Math.PI / 4, 11, Math.round(rr(12, 16)), si++); ESTATES.push([x, z]); }
    // further out: a few taller blocks fading into the haze (simpler windows)
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * Math.PI * 2 + 0.2, r = rr(165, 200);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(z - VIADUCT_Z) < 14) continue;
      if (rnd() < 0.3) tower(b, x, z, -a, 12, Math.round(rr(15, 20)), si++, { far: true });
      else hdb(b, x, z, -a + Math.PI / 2, rr(24, 32), 9, Math.round(rr(14, 20)), si++, { far: true, people: 0 });
    }
  }

  // ---------- landmarks ----------
  const SIGNS = [];          // extra picture boards on landmarks: {pic, x, y, z, nx, nz, size, ring}
  function buildLandmarks(b, green) {
    hawkerCentre(b, green);
    shophouses(b, green);
    park(b, green);
    playground(b, green);
    mrtEntrance(b, green);
    depotShed(b, green);
    // Scattered trees and a few palms outside the loop and in the corner blocks.
    for (let k = 0; k < 110; k++) {
      const a = rnd() * Math.PI * 2, r = rr(80, 190);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearOfRoads(x, z, RH + 4)) continue;
      if (nearRing(x, z, 3)) continue;
      if (Math.abs(z - VIADUCT_Z) < 6) continue;
      if (nearBuilding(x, z)) continue;
      tree(green, x, z, 0, rnd() < 0.15 ? 'palm' : null, rr(0.9, 1.3));
    }
    for (const [x, z] of [[-34, -56], [-56, -32], [56, -32], [34, -58], [-56, 32], [-34, 56], [56, 34]]) tree(green, x, z, 0.27, null, 1);
  }
  function nearBuilding(x, z) {
    for (const [bx0, bz0] of ESTATES) if (Math.abs(x - bx0) < 19 && Math.abs(z - bz0) < 19) return true;
    return false;
  }

  // Hawker centre (block north-middle, facing the road to the north): an open pavilion with a two-tier roof
  // and a louvred clerestory, a row of stalls with bright signboards, round tables with stools and people, and
  // umbrella tables on the plaza by the road. A bowl picture board stands on the roof.
  function hawkerCentre(b, green) {
    W.addBox(0, -45.5, 16, 12.6, 0, 11);
    A(b, 0, 0.25, -46, Math.PI, (q) => {            // local +z = toward the road (north)
      bx(q, 32, 0.12, 25, '#f1e2c6', 0, 0, -0.5);
      for (let x = -14; x <= 14; x += 2) bx(q, 0.9, 0.02, 25, '#e6d2b0', x, 0.12, -0.5);    // floor tiles
      for (let x = -12; x <= 12; x += 6) for (const z of [-7.5, 7.5]) {
        q.cyl(0.42, 0.42, 5.2, 8, P.cream, x, 0.12, z); q.cyl(0.55, 0.55, 0.8, 8, P.teal, x, 0.12, z);
      }
      bx(q, 29, 0.45, 18.4, '#c9472c', 0, 5.3, 0);                                          // eaves
      q.prism(28.6, 18.6, 3.0, P.coral, 0, 5.75, 0);
      bx(q, 22, 1.5, 7.2, P.honey, 0, 7.3, 0);                                              // louvred clerestory
      for (let x = -10.5; x <= 10.5; x += 1.5) { bx(q, 0.5, 1.5, 0.1, P.honeyDark, x, 7.3, 3.65); bx(q, 0.5, 1.5, 0.1, P.honeyDark, x, 7.3, -3.65); }
      bx(q, 23.4, 0.35, 9.2, '#c9472c', 0, 8.8, 0);
      q.prism(23, 9.4, 2.2, '#ff8a5c', 0, 9.15, 0);
      // the picture board on the roof (two posts)
      bx(q, 0.25, 2.6, 0.25, '#7f8a96', -1.6, 10.6, 0); bx(q, 0.25, 2.6, 0.25, '#7f8a96', 1.6, 10.6, 0);
      // stalls along the back
      const stall = [P.coral, P.teal, P.berry, P.leaf, P.plum];
      for (let i = 0; i < 5; i++) {
        const x = -11 + i * 5.5;
        bx(q, 5.0, 2.8, 0.3, light(stall[i], 0.55), x, 0.12, -7.8);
        bx(q, 4.6, 1.1, 1.6, P.cream, x, 0.12, -6.6);
        bx(q, 4.8, 0.12, 1.8, stall[i], x, 1.22, -6.6);
        bx(q, 4.8, 0.95, 0.2, stall[i], x, 3.05, -5.8);                                     // signboard
        q.add(QUAD, '#fffaf0', x, 3.52, -5.68, 0, 0, 0, 2.6, 0.5, 1);
        for (let k = 0; k < 3; k++) q.ball(0.22, rpick(['#ffd45c', '#ff6b5c', '#fff6e0', '#8fd06a']), x - 1.2 + k * 1.2, 1.5, -6.6);
        figure(q, x + 1.2, 0.12, -7.3, 0, false, 0.95);                                     // the cook
      }
      // tables and stools inside, with people having lunch
      for (let x = -9; x <= 9; x += 4.5) for (const z of [-1.8, 2.8]) {
        q.cyl(0.95, 0.95, 0.12, 9, '#fbf7ee', x, 1.0, z); q.cyl(0.16, 0.16, 1.0, 5, '#9a8f86', x, 0.12, z);
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; q.cyl(0.3, 0.3, 0.55, 6, stall[(k + Math.abs(x)) % 5], x + Math.cos(a) * 1.45, 0.12, z + Math.sin(a) * 1.45); }
        if ((x + z * 3) % 2 === 0 || rnd() < 0.4) figure(q, x + 1.45, 0.12, z, -Math.PI / 2, true, 0.95);
        if (rnd() < 0.45) figure(q, x - 1.45, 0.12, z, Math.PI / 2, true, 0.95);
      }
      // umbrella tables on the plaza by the road
      const um = [P.coral, P.honey, P.teal, P.rose];
      for (let i = 0; i < 4; i++) {
        const x = -10.5 + i * 7, z = 10.6;
        q.cyl(0.8, 0.8, 0.1, 8, '#fbf7ee', x, 0.95, z); q.cyl(0.1, 0.1, 3.0, 5, '#7f8a96', x, 0.12, z);
        q.add(new THREE.ConeGeometry(2.3, 0.9, 8), um[i], x, 3.3, z);
        q.add(new THREE.ConeGeometry(2.32, 0.3, 8), light(um[i], 0.5), x, 2.95, z);
        for (const a of [0.3, 3.4]) q.cyl(0.28, 0.28, 0.5, 6, P.cream, x + Math.cos(a) * 1.3, 0.12, z + Math.sin(a) * 1.3);
        if (i % 2 === 0) figure(q, x + 1.3, 0.12, z + 0.4, -Math.PI / 2 - 0.3, true, 0.95);
      }
    });
    SIGNS.push({ pic: 'bowl', x: 0, y: 0.25 + 12.3, z: -46, nx: 0, nz: -1, size: 3.4, ring: P.coral });
    tree(green, -16, -34, 0.27, 'rain'); tree(green, 15, -34, 0.27, 'flame');
  }

  // Shophouse row (block west-middle), facades facing the loop road to the west: bright two-storey shopfronts with a
  // shaded five-foot way, louvred shutters, white cornices, pediments, red lanterns, potted plants, a tiled roof.
  function shophouses(b, green) {
    W.addBox(-54.1, 0, 5.6, 17.6);
    const walls = ['#ffc9a0', '#9fdcc4', '#ffb3c6', '#b9d2ff', '#ffe58a', '#ffbe98', '#cdbcff'];
    const shut = ['#2f9e7a', '#4f7fe0', '#19a79b', '#e0527a', '#8e62c8', '#2f9e7a', '#f28b4b'];
    for (let k = 0; k < 7; k++) {
      const z = -15 + k * 5.0, col = walls[k], sc = shut[k];
      A(b, -54, 0.25, z, -Math.PI / 2, (q) => {               // local +z = facing west (toward the road)
        bx(q, 5, 3.4, 9, light(col, 0.25), 0, 0, -0.8);          // ground floor (behind the five-foot way)
        bx(q, 5, 0.06, 2.2, k % 2 ? '#e8b48a' : '#f0c9a2', 0, 0, 4.7);   // five-foot way tiles
        q.add(QUAD, '#5a4652', 0, 1.35, 3.71, 0, 0, 0, 2.0, 2.6, 1);    // open shop door
        pane(q, -1.75, 1.6, 3.71, 0, 1.0, 1.6, true); pane(q, 1.75, 1.6, 3.71, 0, 1.0, 1.6, true);
        for (const x of [-1.25, 1.25]) bx(q, 0.3, 2.6, 0.12, sc, x, 0, 3.74);
        for (const x of [-2.25, 2.25]) { bx(q, 0.55, 3.4, 0.55, '#fff6e6', x, 0, 5.3); bx(q, 0.75, 0.3, 0.75, '#fff6e6', x, 0, 5.3); }
        bx(q, 5, 0.6, 0.6, '#fff6e6', 0, 2.85, 5.3);              // arcade beam
        bx(q, 3.6, 0.7, 0.14, k % 2 ? P.coral : '#c9472c', 0, 2.8, 5.66);   // shop signboard
        q.add(QUAD, '#fff3c4', 0, 3.15, 5.74, 0, 0, 0, 2.4, 0.28, 1);
        for (const x of [-1.3, 1.3]) { q.ball(0.34, '#e8473b', x, 2.25, 4.9, 0, 1, 1.15, 1); bx(q, 0.06, 0.4, 0.06, P.honey, x, 1.6, 4.9); }   // lanterns
        q.cyl(0.35, 0.25, 0.55, 6, P.woodLight, 2.0, 0.06, 4.3); q.ball(0.5, P.leaf, 2.0, 0.95, 4.3);   // potted plant
        // upper floor overhanging the walkway
        bx(q, 5, 3.8, 10.6, col, 0, 3.4, 0);
        bx(q, 5.2, 0.35, 10.9, '#fff6e6', 0, 3.3, 0);
        for (const x of [-1.5, 0, 1.5]) {
          pane(q, x, 5.3, 5.32, 0, 0.8, 1.9);
          bx(q, 0.42, 1.9, 0.1, sc, x - 0.62, 4.35, 5.36); bx(q, 0.42, 1.9, 0.1, sc, x + 0.62, 4.35, 5.36);
          bx(q, 0.95, 0.2, 0.22, '#fff6e6', x, 6.3, 5.38);
        }
        bx(q, 5.3, 0.45, 11.0, '#fff6e6', 0, 7.2, 0);             // cornice
        bx(q, 5.0, 0.9, 0.4, col, 0, 7.6, 5.15);                  // parapet
        if (k % 2 === 0) q.prism(2.6, 0.4, 1.0, '#fff6e6', 0, 8.5, 5.15);   // little pediment
        q.prism(5.2, 10.6, 2.3, k % 3 === 1 ? '#c85a3a' : '#d9673f', 0, 7.65, -0.2);
      });
    }
    hdb(b, -38, 0, Math.PI / 2, 22, 7, 6, 6, { roof: 'pitch', people: 3 });
    tree(green, -38, -15, 0.27, 'round'); tree(green, -38, 15, 0.27, 'flame');
  }

  // The park (centre): a pond with lily pads, ducks and a little red bridge, a looping path, a gazebo,
  // flower beds, benches with people and big rain trees.
  function park(b, green) {
    const PX = 1.5, PZ = -1;
    W.addCircle(PX - 3.2, PZ, 4.6); W.addCircle(PX + 3.2, PZ, 4.6); W.addCircle(-8, 10, 2.9);
    const ell = (n, cx, cz, rx, rz) => { const o = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; o.push({ x: cx + Math.cos(a) * rx, z: cz + Math.sin(a) * rz }); } return o; };
    green.strip(ell(28, 0, 2, 12.2, 12.6), -0.85, 0.85, 0.29, '#efdcb4');            // the jogging path
    green.disc(7.6, 14, '#d9c79e', PX, 0.29, PZ, 1, 0.74);
    green.disc(7.0, 14, '#5fb7e3', PX, 0.31, PZ, 1, 0.72);
    green.disc(4.0, 10, '#7cc8ec', PX - 1.5, 0.315, PZ - 1, 1, 0.6);
    for (const [x, z] of [[-1.8, 1.5], [3.4, 2.4], [5.6, -2.5], [-2.8, -2.6], [1.0, -3.6]]) {
      green.disc(0.6, 7, '#4fa847', PX + x, 0.33, PZ + z);
      if (rnd() < 0.6) green.ball(0.18, '#ff8fc0', PX + x + 0.15, 0.4, PZ + z);
    }
    for (const [x, z, r] of [[0.5, 0.6, 0.6], [2.2, 1.4, 2.4], [-0.6, -1.4, -1]]) {            // ducks
      b.at(PX + x, 0.31, PZ + z, r, (q) => { q.ball(0.42, '#fffaf0', 0, 0.2, 0, 0, 1.25, 0.7, 1); q.ball(0.26, '#fffaf0', 0, 0.62, 0.35); q.box(0.14, 0.08, 0.26, P.honey, 0, 0.6, 0.62); });
    }
    // a little red bridge over the pond's waist
    b.at(PX + 6.8, 0.27, PZ, 0, (q) => {
      for (let k = -3; k <= 3; k++) q.box(1.0, 0.25, 2.2, '#e8473b', k * 0.9, 0.9 - Math.abs(k) * 0.12 - (Math.abs(k) > 2 ? 0.25 : 0), 0, 0, 0, -k * 0.06);
      for (const z of [-1.05, 1.05]) q.box(6.2, 0.18, 0.14, '#c9372b', 0, 1.6, z);
    });
    // gazebo
    b.at(-8, 0.27, 10, 0, (q) => {
      q.cyl(2.6, 2.8, 0.3, 6, '#e9d9bb', 0, 0, 0);
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; q.cyl(0.16, 0.16, 2.6, 5, P.cream, Math.cos(a) * 2.2, 0.3, Math.sin(a) * 2.2); }
      q.add(new THREE.ConeGeometry(3.4, 1.6, 6), P.teal, 0, 3.6, 0);
      q.add(new THREE.ConeGeometry(1.2, 1.2, 6), '#16928a', 0, 4.8, 0);
      q.ball(0.25, P.honey, 0, 5.5, 0);
    });
    figure(b, -8.6, 0.57, 9.7, 0.4, true); figure(b, -7.2, 0.57, 10.6, -2.2, true);
    // flower beds
    for (const [x, z, c] of [[10.5, 12, '#ff8fc0'], [-12, -7, '#ffd45c'], [11, -12, '#ff6b5c'], [-3, 15.5, '#b78cf0']]) {
      green.disc(2.0, 9, '#8a6a4a', x, 0.3, z, 1.3, 0.8);
      for (let k = 0; k < 7; k++) green.ball(0.32, k % 3 ? c : '#fff6e0', x + rr(-2, 2), 0.5, z + rr(-1.1, 1.1));
    }
    for (const [x, z] of [[-14, -14], [13.5, -14.5], [14, 17], [-14, 19], [3, 18.5], [-14.5, 2], [14.5, 4]]) tree(green, x, z, 0.27, 'rain', rr(0.85, 1.1));
    for (const [x, z, r] of [[8, -10, 0.7], [-11, -1, 1.7], [4, 15.2, 3.1]]) {
      b.at(x, 0.27, z, r, (q) => { q.box(2.4, 0.15, 0.7, P.wood, 0, 0.5, 0); q.box(2.4, 0.6, 0.12, P.wood, 0, 0.65, -0.32); q.box(0.2, 0.5, 0.6, '#7d6e66', -1, 0, 0); q.box(0.2, 0.5, 0.6, '#7d6e66', 1, 0, 0); });
    }
    figure(b, 8, 0.27, -10, 0.7 + Math.PI, true);
    figure(b, 9, 0.29, 3, 0.4, false); figure(b, 9.6, 0.29, 3.6, 0.6, false, 0.7);         // a grown-up and a child walking
    for (const [x, z] of [[-6, 26], [6, 28], [13, 24], [-13, 28]]) tree(green, x, z, 0.27, rnd() < 0.5 ? 'flame' : 'round', 1);
  }

  // The playground (south of the park): a soft coloured floor, a mosaic dragon to climb (a nod to the old
  // neighbourhood playgrounds), a slide tower, swings, a see-saw, a sand pit and children playing.
  function playground(b, green) {
    green.disc(11.5, 18, '#ff9f86', 0, 0.3, 46, 1.2, 1);
    W.addBox(-1, 48.5, 10.6, 1.7, 0, 3.5); W.addBox(9, 48.5, 2.1, 5.6, 0, 5); W.addBox(-6, 40, 3.5, 0.7, 0, 3.6);
    green.disc(10.2, 18, '#ffb39e', 0, 0.305, 46, 1.18, 0.96);
    green.disc(3.2, 10, '#f3dca8', 9, 0.31, 40.5);                                          // sand pit
    b.at(-1, 0.3, 48.5, 0, (q) => {
      // the dragon: head (facing -x), three humps of coloured rings, a curly tail
      q.at(-8.4, 0, 0, 0, (h) => {
        h.box(2.6, 2.8, 2.4, P.honey, 0, 0, 0);
        h.box(1.6, 1.2, 2.0, P.honeyLight, -1.9, 0.5, 0);
        h.box(1.4, 0.35, 1.8, '#e8473b', -1.9, 0.2, 0);                                     // mouth
        for (const z of [-0.75, 0.75]) {
          h.ball(0.5, '#ffffff', -1.2, 2.25, z); h.ball(0.26, '#3a2a3c', -1.55, 2.3, z);
          h.add(new THREE.ConeGeometry(0.3, 1.2, 5), P.coral, 0.4, 3.3, z, 0, 0, -0.5);
        }
        for (let k = 0; k < 4; k++) h.prism(0.7, 0.3, 0.9, k % 2 ? P.teal : P.coral, 0.6 + k * 0.5, 2.8 - k * 0.3, 0);
      });
      const hump = [P.coral, P.teal, P.berry];
      for (let k = 0; k < 3; k++) {
        const x = -4.4 + k * 4.0, t = new THREE.TorusGeometry(1.7, 0.55, 5, 9, Math.PI);
        q.add(t, hump[k], x, 0, 0, 0, 0, 0);
        for (let r = 0; r < 4; r++) { const a = (r + 0.5) / 4 * Math.PI; q.box(0.3, 0.3, 1.4, '#fff6e0', x + Math.cos(a) * 1.7, Math.sin(a) * 1.7 - 0.15, 0); }
      }
      q.add(new THREE.ConeGeometry(0.55, 2.8, 6), P.honey, 8.2, 0.9, 0, 0, 0, -1.2);
      q.ball(0.5, P.coral, 9.4, 1.5, 0);
    });
    b.at(9, 0.3, 52, Math.PI, (q) => {                       // slide tower
      for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) q.box(0.35, 3.4, 0.35, P.berry, x, 0, z);
      q.box(3.6, 0.3, 3.6, P.honey, 0, 2.4, 0);
      q.prism(4, 4, 1.8, P.coral, 0, 3.4, 0);
      for (let k = 0; k < 4; k++) q.box(1.4, 0.15, 0.3, '#fff6e0', 0, 0.5 + k * 0.55, -1.9 - k * 0.25);
      q.box(1.6, 0.25, 7, P.honey, 0, 1.2, 4.8, 0, -0.38);
      q.box(0.2, 0.5, 7, P.coral, 0.8, 1.4, 4.8, 0, -0.38); q.box(0.2, 0.5, 7, P.coral, -0.8, 1.4, 4.8, 0, -0.38);
    });
    b.at(-6, 0.3, 40, 0, (q) => {                            // swings
      q.box(0.3, 3.4, 0.3, P.teal, -3, 0, 0, 0, 0, 0.15); q.box(0.3, 3.4, 0.3, P.teal, 3, 0, 0, 0, 0, -0.15);
      q.box(6.6, 0.3, 0.3, P.teal, 0, 3.3, 0);
      for (const x of [-1.4, 1.4]) { q.box(0.06, 2.3, 0.06, '#7d6e66', x - 0.4, 1, 0); q.box(0.06, 2.3, 0.06, '#7d6e66', x + 0.4, 1, 0); q.box(1.0, 0.12, 0.5, P.coral, x, 0.95, 0); }
    });
    figure(b, -7.4, 1.0, 40, 0, true, 0.7);
    b.at(3, 0.3, 39.5, 0.3, (q) => { q.box(0.6, 0.6, 0.6, '#7d6e66', 0, 0, 0); q.box(5, 0.2, 0.6, P.honey, 0, 0.6, 0, 0, 0, 0.12); });
    figure(b, 9.6, 0.31, 40.5, 1, true, 0.7); figure(b, -2, 0.3, 44, 2.5, false, 0.7); figure(b, 5.5, 0.3, 46, -0.8, false, 0.7);
    figure(b, 12.5, 0.3, 44, -1.6, false, 1);                // a grown-up watching
    for (const [x, z] of [[-13, 36], [13, 58], [-12, 58], [14, 34]]) tree(green, x, z, 0.27, 'round', 1.1);
  }

  // MRT station entrance (block east-middle) under the viaduct station: a canopy, a lift, stairs up, a train board.
  function mrtEntrance(b, green) {
    W.addBox(46, -12.5, 7.8, 3.8, 0, 6); W.addBox(36.4, -11, 1.3, 1.8, 0, 1);
    b.at(46, 0.25, -12, 0, (q) => {
      q.box(16, 0.12, 9, '#efe4d0', 0, 0, 0.5);
      q.box(14, 4.2, 6, P.cream, 0, 0, -0.5);
      q.box(15, 0.5, 7.4, P.teal, 0, 4.2, -0.2);
      q.add(new THREE.CylinderGeometry(3.7, 3.7, 15, 8, 1, false, 0, Math.PI), '#16928a', 0, 4.7, -0.2, 0, 0, Math.PI / 2, 0.35, 1, 1);
      q.box(6, 3, 0.2, P.glassDark, 0, 0.12, 2.55);
      for (const x of [-2.2, 0, 2.2]) q.box(0.15, 3, 0.25, '#e9e2d6', x, 0.12, 2.6);
      q.box(2.2, DECK_Y - 4, 2.2, '#e0d6c8', -6.2, 4.2, -2); q.box(2.2, DECK_Y - 4, 2.2, '#e0d6c8', 6.2, 4.2, -2);   // lift shafts
      q.box(1.4, DECK_Y - 4.5, 0.15, P.glass, -6.2, 4.4, -0.88); q.box(1.4, DECK_Y - 4.5, 0.15, P.glass, 6.2, 4.4, -0.88);
      // a round train board on a post, by the entrance
      q.box(0.25, 3.6, 0.25, '#7f8a96', 8.6, 0.12, 3.2);
      for (let k = 0; k < 5; k++) q.box(2.2, 0.2, 0.8, '#d8cfc2', -9.6, 0.12 + k * 0.2, 2 - k * 0.6);   // steps
    });
    SIGNS.push({ pic: 'train', x: 54.6, y: 0.25 + 4.6, z: -8.8, nx: -0.7, nz: 0.7, size: 2.2, ring: P.teal });
    for (const [x, z] of [[34, 8], [58, 8], [46, 12]]) tree(green, x, z, 0.27, 'rain', 0.9);
    figure(b, 41, 0.37, -7.5, 0.3, false); figure(b, 49, 0.37, -6.6, -2.6, false);
  }

  // Bus depot (block south-east): a big friendly garage with an arched teal roof, two round windows over a
  // wide door, a half-raised striped shutter, a fuel pump under a canopy and a washing brush.
  function depotShed(b, green) {
    const D = W.depot;
    W.addBox(DEPOT_X, D.pos.z, 7.4, 10.4, 0, 11);
    W.addCircle(DEPOT_X - 10.6, D.pos.z - 8.6, 2.3); W.addCircle(DEPOT_X, D.pos.z + 12.6, 2.1);
    A(b, DEPOT_X, 0.25, D.pos.z, -Math.PI / 2, (q) => {      // local +z = toward the road (west), x along the road
      bx(q, 22, 0.15, 16, '#d8d0c4', 0, 0, 0);
      for (let x = -8; x <= 8; x += 4) bx(q, 0.4, 0.02, 4, P.honey, x, 0.15, 9);             // apron stripes
      bx(q, 20, 7, 14, P.cream, 0, 0.15, 0);
      bx(q, 20.4, 0.5, 14.4, P.teal, 0, 7.1, 0);
      const arch = new THREE.CylinderGeometry(10.2, 10.2, 14.6, 12, 1, false, -Math.PI / 2, Math.PI);
      q.add(arch, P.teal, 0, 7.6, 0, 0, -Math.PI / 2, 0, 1, 1, 0.42);
      const front = new THREE.CircleGeometry(10, 12, 0, Math.PI);
      for (const z of [7.31, -7.31]) q.add(front, P.cream, 0, 7.6, z, z > 0 ? 0 : Math.PI, 0, 0, 1, 0.4, 1);
      bx(q, 20.6, 0.35, 0.3, P.teal, 0, 7.45, 7.2);
      // two round windows above the door (plain windows, no eyes: the owner's choice)
      for (const x of [-5, 5]) {
        q.add(new THREE.CircleGeometry(1.55, 14), P.honey, x, 9.1, 7.34);
        q.add(new THREE.CircleGeometry(1.3, 14), '#9fd3e8', x, 9.1, 7.4);
        q.add(QUAD, P.honey, x, 9.1, 7.46, 0, 0, 0, 2.6, 0.16, 1);
        q.add(QUAD, P.honey, x, 9.1, 7.46, 0, 0, 0, 0.16, 2.6, 1);
      }
      // the big door: dark inside, a half-raised striped shutter, a honey frame
      q.add(QUAD, '#463a48', 0, 2.85, 7.02, 0, 0, 0, 11, 5.4, 1);
      for (let k = 0; k < 5; k++) bx(q, 11, 0.3, 0.2, k % 2 ? P.honeyLight : '#fff6e0', 0, 4.15 + k * 0.3, 7.08);
      bx(q, 0.7, 5.9, 0.5, P.honey, -5.85, 0.15, 7.15); bx(q, 0.7, 5.9, 0.5, P.honey, 5.85, 0.15, 7.15);
      bx(q, 12.4, 0.7, 0.5, P.honey, 0, 5.85, 7.15);
      // side windows
      for (const x of [-7, -2.5, 2.5, 7]) for (const z of [-7.02]) pane(q, x, 4.2, z, Math.PI, 2.2, 1.4);
      for (const z of [-4, 0, 4]) { pane(q, 10.02, 4.2, z, Math.PI / 2, 2.2, 1.4); pane(q, -10.02, 4.2, z, -Math.PI / 2, 2.2, 1.4); }
      // fuel pump under a canopy (on the left of the door as seen from the road)
      q.at(-8.6, 0.15, 10.6, 0, (f) => {
        f.box(1.3, 2.3, 1.0, P.coral, 0, 0, 0); f.box(0.9, 0.7, 0.1, P.cream, 0, 1.3, 0.52);
        f.box(0.2, 0.9, 0.2, '#555', 0.75, 0.7, 0.2);
        f.box(4.2, 0.35, 3.6, P.honey, 0, 3.4, 0); f.box(4.4, 0.2, 3.8, P.honeyDark, 0, 3.75, 0);
        for (const [x, z] of [[-1.8, -1.5], [1.8, -1.5], [-1.8, 1.5], [1.8, 1.5]]) f.box(0.2, 3.4, 0.2, '#e9e2d6', x, 0, z);
      });
      // a bus-wash brush round the side (out of the way of the garage cameras)
      q.at(12.6, 0.15, 0, Math.PI / 2, (f) => {
        f.box(0.3, 4.2, 0.3, '#7f8a96', -1.6, 0, 0); f.box(0.3, 4.2, 0.3, '#7f8a96', 1.6, 0, 0); f.box(3.6, 0.3, 0.4, '#7f8a96', 0, 4.2, 0);
        f.cyl(0.8, 0.8, 3.6, 8, '#5fb7e3', -0.9, 0.3, 0); f.cyl(0.8, 0.8, 3.6, 8, '#ff8fab', 0.9, 0.3, 0);
      });
    });
    figure(b, DEPOT_X - 7.6, 0.4, D.pos.z + 5.2, -Math.PI / 2, false);                          // the depot keeper waves hello
  }

  // ---------- MRT viaduct over the middle road (generic: cream concrete, no operator branding) ----------
  function buildViaduct(b, green) {
    const z = VIADUCT_Z, len = 340;
    b.box(len, 1.4, 6, '#ece3d6', 0, DECK_Y, z);
    b.box(len, 0.3, 6.4, '#d8cfc2', 0, DECK_Y - 0.1, z);
    b.box(len, 0.9, 0.4, '#e3dacd', 0, DECK_Y + 1.4, z - 2.9); b.box(len, 0.9, 0.4, '#e3dacd', 0, DECK_Y + 1.4, z + 2.9);
    b.box(len, 0.25, 0.25, '#a59a90', 0, DECK_Y + 1.4, z - 0.8); b.box(len, 0.25, 0.25, '#a59a90', 0, DECK_Y + 1.4, z + 0.8);
    // flower boxes along the parapets (pink bougainvillea)
    for (let x = -168; x <= 168; x += 8) for (const s of [-1, 1]) {
      if (Math.abs(x - 46) < 18) continue;
      green.box(3.2, 0.6, 0.7, '#5aa848', x, DECK_Y + 0.6, z + s * 3.35);
      green.ball(0.55, (x / 6) % 2 ? '#ff7fb0' : '#ff9fc6', x - 0.7, DECK_Y + 1.15, z + s * 3.4, 0, 1.3, 0.6, 0.8);
      green.ball(0.5, '#ff6fa6', x + 0.8, DECK_Y + 1.1, z + s * 3.4, 0, 1.2, 0.6, 0.8);
    }
    for (const x of [-160, -125, -96, -46, 0, 46, 96, 125, 160]) {
      W.addCircle(x, z, 0.95);
      b.cyl(0.95, 1.05, DECK_Y - 1.2, 8, '#e3dacd', x, 0, z);
      b.box(2.4, 0.8, 2.4, '#d8cfc2', x, 0, z);
      b.box(6.8, 1.2, 2.4, '#e3dacd', x, DECK_Y - 1.3, z);
      b.prism(2.4, 6.8, 0.01, '#e3dacd', x, DECK_Y - 1.3, z, Math.PI / 2);
    }
    // the elevated station (over the east part of the middle road): platforms, glass sides, a curved roof
    b.box(32, 0.6, 13, '#ece3d6', 46, DECK_Y + 1.4, z);
    b.box(32, 0.4, 2.2, P.honey, 46, DECK_Y + 2.0, z - 5.2); b.box(32, 0.4, 2.2, P.honey, 46, DECK_Y + 2.0, z + 5.2);
    for (const zz of [z - 6.3, z + 6.3]) {
      b.box(32, 1.2, 0.2, light(P.teal, 0.55), 46, DECK_Y + 2.0, zz);
      for (let x = 31; x <= 61; x += 5) b.box(0.4, 5.4, 0.4, '#e9e2d6', x, DECK_Y + 2, zz);
    }
    const roof = new THREE.CylinderGeometry(7.6, 7.6, 34, 10, 1, true, 0, Math.PI);
    b.add(roof, P.teal, 46, DECK_Y + 7.2, z, 0, 0, Math.PI / 2, 0.42, 1, 1);
    b.add(roof, '#16928a', 46, DECK_Y + 7.2, z, 0, 0, Math.PI / 2, 0.42, 1, -1);           // its inside (seen from below)
    b.box(34, 0.4, 0.4, '#e9e2d6', 46, DECK_Y + 7.0, z - 7.4); b.box(34, 0.4, 0.4, '#e9e2d6', 46, DECK_Y + 7.0, z + 7.4);
    SIGNS.push({ pic: 'train', x: 46, y: DECK_Y + 5.2, z: z + 6.45, nx: 0, nz: 1, size: 2.4, ring: P.teal });
    SIGNS.push({ pic: 'train', x: 46, y: DECK_Y + 5.2, z: z - 6.45, nx: 0, nz: -1, size: 2.4, ring: P.teal });
  }
  // A generic three-car train: cream with a coral stripe, a rounded nose with a friendly face at each end.
  function buildTrain() {
    const b = BB.mk.builder(), wb = BB.mk.builder();
    for (let k = 0; k < 3; k++) {
      const x = (k - 1) * 10.4;
      b.box(9.9, 2.9, 2.8, '#fbf8f1', x, 0.4, 0);
      b.box(9.9, 0.45, 2.85, P.coral, x, 0.95, 0);
      b.box(9.9, 0.18, 2.85, P.honey, x, 1.4, 0);
      b.box(9.7, 0.35, 2.5, '#e2ddd2', x, 3.3, 0);
      for (const s of [-1, 1]) {
        for (let w = 0; w < 4; w++) wb.add(QUAD, '#9cc9e2', x - 3.6 + w * 2.4, 2.25, s * 1.43, s > 0 ? 0 : Math.PI, 0, 0, 1.6, 0.9, 1);
        for (const dx of [-1.2, 1.2]) b.box(0.9, 2.1, 0.06, '#e9e2d6', x + dx * 3, 0.5, s * 1.42);
      }
      for (const wx of [-3.6, 3.6]) b.cyl(0.42, 0.42, 2.6, 6, '#5a5260', x + wx, 0, 0, 0, Math.PI / 2);
    }
    for (const s of [-1, 1]) {                              // noses
      const nx = s * 15.6;
      b.box(0.9, 2.9, 2.8, '#fbf8f1', nx, 0.4, 0);
      b.box(0.9, 0.45, 2.85, P.coral, nx, 0.95, 0);
      b.box(0.8, 1.4, 2.5, P.glassDark, nx + s * 0.1, 1.7, 0);
      for (const z of [-0.6, 0.6]) { b.ball(0.32, '#ffffff', nx + s * 0.5, 2.5, z, 0, 0.4, 1, 1); b.ball(0.16, '#3a2a3c', nx + s * 0.6, 2.48, z, 0, 0.4, 1, 1); }
      b.box(0.1, 0.12, 0.8, '#ffffff', nx + s * 0.48, 1.25, 0);
    }
    const m = b.mesh(); m.name = 'train';
    m.position.set(trainX, DECK_Y + 1.5, VIADUCT_Z + 1.4);
    trainWin = wb.mesh(winMat); m.add(trainWin);
    return m;
  }
  // Soft paper clouds: flat-bottomed clusters of puffs, white on top and a touch of lilac underneath.
  function buildClouds() {
    const b = BB.mk.builder();
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * Math.PI * 2 + rr(0, 0.4), r = rr(120, 260), y = rr(55, 90);
      const x = Math.cos(a) * r, z = Math.sin(a) * r, s = rr(0.8, 1.4);
      b.at(x, y, z, -a, (q) => {
        q.ball(9 * s, '#eef0fb', 0, 0, 0, 1, 2.4, 0.35, 1.1);
        for (let j = 0; j < 4; j++) q.ball(rr(4.5, 7) * s, '#ffffff', rr(-11, 11) * s, rr(1.5, 4) * s, rr(-3, 3) * s, 0, 1.2, 0.85, 1);
      });
    }
    cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.94 });
    const m = new THREE.Mesh(b.geometry(), cloudMat);
    m.name = 'clouds';
    return m;
  }

  // ---------- life: little cars on the outer road, birds ----------
  const CAR_N = 9, carState = [];
  function buildCars() {
    const b = BB.mk.builder();
    b.box(1.9, 0.75, 4.0, '#ffffff', 0, 0.35, 0);                 // body (takes the instance colour)
    b.box(1.95, 0.25, 4.05, '#d0d0d0', 0, 0.3, 0);                // a darker skirt
    b.box(1.65, 0.7, 2.2, '#ffffff', 0, 1.1, -0.2);               // cabin
    b.box(1.68, 0.48, 2.0, '#3c4a5a', 0, 1.18, -0.2);             // windows
    b.box(1.5, 0.5, 0.06, '#3c4a5a', 0, 1.18, 0.92, 0, -0.5);     // windscreen
    for (const x of [-0.6, 0.6]) b.box(0.4, 0.22, 0.06, '#fff8d0', x, 0.68, 2.01);
    for (const [x, z] of [[-0.95, 1.3], [0.95, 1.3], [-0.95, -1.3], [0.95, -1.3]]) b.add(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 8), '#3a3440', x, 0.38, z, 0, 0, Math.PI / 2);
    const mesh = new THREE.InstancedMesh(b.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), CAR_N);
    const cols = [P.coral, P.berry, P.honey, P.teal, '#f4f1ea', P.plum, P.mint, P.rose, '#4fa3e0'];
    for (let i = 0; i < CAR_N; i++) {
      mesh.setColorAt(i, new THREE.Color(cols[i % cols.length]));
      carState.push({ s: i / CAR_N * ringPath.len + rr(0, 10), dir: i % 2 ? 1 : -1, v: rr(7, 10) });
    }
    mesh.name = 'cars'; mesh.frustumCulled = false;
    return mesh;
  }
  const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _p4 = new THREE.Vector3(), _s4 = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
  const _rp = {};
  function busNear(x, z, r) {
    const B = BB.bus;
    if (!B || !B.front) return false;
    for (const o of [B.front.position, B.rear.position]) if (Math.hypot(o.x - x, o.z - z) < r + 3) return true;
    return false;
  }
  function updateCars(dt) {
    for (let i = 0; i < CAR_N; i++) {
      const c = carState[i];
      // keep a gentle gap to the car in front on the same lane
      let v = c.v;
      for (const o of carState) if (o !== c && o.dir === c.dir) {
        const gap = ((o.s - c.s) * c.dir + ringPath.len) % ringPath.len;
        if (gap > 0 && gap < 9) v = Math.min(v, o.v * (gap / 9));
      }
      ringAt(c.s + c.dir * 7, 1.75 * c.dir, _rp);         // the bus just ahead in our lane? wait (never block it)
      if (busNear(_rp.x, _rp.z, 4.5)) { const here = ringAt(c.s, 1.75 * c.dir, {}); if (!busNear(here.x, here.z, 2.5)) v = 0; }
      c.s += c.dir * v * dt;
      ringAt(c.s, 1.75 * c.dir, _rp);          // drive on the left: the lane left of travel
      _q4.setFromAxisAngle(_up, Math.atan2(_rp.dx * c.dir, _rp.dz * c.dir));
      _m4.compose(_p4.set(_rp.x, 0.03, _rp.z), _q4, _s4);
      cars.setMatrixAt(i, _m4);
    }
    cars.instanceMatrix.needsUpdate = true;
  }
  const BIRD_N = 9, birdState = [];
  function buildBirds() {
    const pos = [0, 0, 0.5, 0, 0, -0.4, -1.2, 0.5, -0.3, 0, 0, 0.5, 1.2, 0.5, -0.3, 0, 0, -0.4,
      0, 0.05, 0.7, -0.15, -0.1, -0.5, 0.15, -0.1, -0.5];
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#5a4a6e', side: THREE.DoubleSide }), BIRD_N);
    for (let i = 0; i < BIRD_N; i++) birdState.push({ flock: i % 3, a: rr(0, 6.28), off: [rr(-5, 5), rr(-2, 2), rr(-5, 5)], ph: rr(0, 6) });
    mesh.name = 'birds'; mesh.frustumCulled = false;
    return mesh;
  }
  const FLOCKS = [{ x: 0, z: 0, r: 60, y: 34, w: 0.12 }, { x: -40, z: 30, r: 45, y: 28, w: -0.15 }, { x: 50, z: -40, r: 50, y: 40, w: 0.1 }];
  function updateBirds(dt, t) {
    for (let i = 0; i < BIRD_N; i++) {
      const bd = birdState[i], f = FLOCKS[bd.flock], a = t * f.w + bd.flock * 2;
      const x = f.x + Math.cos(a) * f.r + bd.off[0], z = f.z + Math.sin(a) * f.r + bd.off[2], y = f.y + bd.off[1] + Math.sin(t * 0.7 + bd.ph) * 1.5;
      _q4.setFromAxisAngle(_up, Math.atan2(-Math.sin(a) * Math.sign(f.w), Math.cos(a) * Math.sign(f.w)));
      const flap = 0.25 + 0.75 * Math.abs(Math.sin(t * 7 + bd.ph));
      _m4.compose(_p4.set(x, y, z), _q4, _s4.set(1.1, flap * 1.1, 1.1));
      birds.setMatrixAt(i, _m4);
    }
    _s4.set(1, 1, 1);
    birds.instanceMatrix.needsUpdate = true;
  }

  // ---------- street lamps: poles in the town mesh, heads in their own mesh, warm pools on the road at night ----------
  function buildLamps(town, lamps) {
    const pts = [];
    const lamp = (x, z, h) => {                       // h: heading of the arm (toward the road)
      TREES.cyl(0.13, 0.17, 5.4, 5, '#8f96a0', x, 0.25, z); W.addCircle(x, z, 0.3);
      const ax = Math.sin(h), az = Math.cos(h);
      TREES.box(0.14, 0.14, 1.6, '#8f96a0', x + ax * 0.7, 5.5, z + az * 0.7, h);
      lamps.box(0.55, 0.22, 0.9, '#ffffff', x + ax * 1.45, 5.3, z + az * 1.45, h);
      pts.push({ x: x + ax * 2.2, z: z + az * 2.2 });
    };
    for (const e of W.roads.edges) {
      for (let s = 16, k = 0; s < e.length - 12; s += 24, k++) {
        const p = W.pointAt(e, s), side = k % 2 ? 1 : -1;
        const x = p.x + p.dz * side * (RH + 0.7), z = p.z - p.dx * side * (RH + 0.7);
        if (inDepotYard(x, z)) continue;
        if (W.stops.concat([W.depot]).some((st) => Math.hypot(st.pos.x - x, st.pos.z - z) < 8)) continue;
        if (!clearOfRoads(x, z, RH + 0.4)) continue;
        lamp(x, z, Math.atan2(-p.dz * side, p.dx * side));
      }
    }
    return pts;
  }
  function buildPools(pts) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(255,226,140,0.9)'); gr.addColorStop(0.5, 'rgba(255,214,120,0.45)'); gr.addColorStop(1, 'rgba(255,214,120,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const pos = [], uv = [], r = 4.2;
    for (const p of pts) {
      pos.push(p.x - r, 0.07, p.z - r, p.x - r, 0.07, p.z + r, p.x + r, 0.07, p.z + r, p.x - r, 0.07, p.z - r, p.x + r, 0.07, p.z + r, p.x + r, 0.07, p.z - r);
      uv.push(0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    poolMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, fog: false });
    const m = new THREE.Mesh(geo, poolMat); m.name = 'lampPools'; m.renderOrder = 1; m.visible = false;
    return m;
  }

  // ---------- bus stops: a shelter with a curved roof, glass back, bench, bin, side panel, a pole with a picture sign ----------
  function buildStops(b) {
    for (const st of W.stops) {
      addBoxAt(st.pos.x, st.pos.z, st.heading, 0.3, 0, 1.1, 4.1, 3.6);
      addBoxAt(st.pos.x, st.pos.z, st.heading, -0.9, 4.6, 0.2, 0.2, 4);
      b.at(st.pos.x, 0.25, st.pos.z, st.heading, (q) => {
        // local: +z forward (travel), +x toward the kerb side (away from the road)
        q.box(3.0, 0.06, 8.4, '#e3d6bc', 0.3, 0.0, 0);                 // paving
        for (let z = -3.6; z <= 3.6; z += 1.2) q.box(0.5, 0.02, 1.0, '#f0d36a', -1.0, 0.06, z);   // tactile strip
        for (const z of [-3.3, 3.3]) { q.box(0.22, 3.1, 0.22, '#7f8a96', 1.05, 0, z); q.box(0.18, 2.9, 0.18, '#7f8a96', -0.6, 0, z); }
        q.box(0.12, 2.2, 6.4, '#cfeaf3', 1.1, 0.5, 0);                // back panel (glass)
        q.box(0.2, 0.3, 6.6, P.teal, 1.1, 2.75, 0);
        const roof = new THREE.CylinderGeometry(3.4, 3.4, 8.0, 8, 1, false, -0.5, 1.0);
        q.add(roof, P.teal, 0.25, 0.0, 0, 0, -Math.PI / 2, 0, 1, 1, 1);
        q.box(0.7, 0.12, 5, P.wood, 0.6, 0.85, 0); q.box(0.12, 0.5, 5, P.wood, 0.95, 0.95, 0);   // bench
        q.box(0.2, 1.3, 2.4, P.honeyLight, 1.12, 0.9, -2.0);           // a colourful side panel
        q.box(0.22, 0.6, 1.0, P.coral, 1.14, 1.2, -2.3); q.box(0.22, 0.4, 0.6, P.teal, 1.14, 1.5, -1.6);
        q.cyl(0.32, 0.28, 0.9, 7, '#5aa848', 0.9, 0, 3.9);            // bin
        q.box(0.15, 3.7, 0.15, '#7f8a96', -0.9, 0, 4.6);               // sign pole
        q.box(0.1, 1.0, 0.7, '#fff6e0', -0.9, 1.4, 4.6);               // route board under the sign
        for (let k = 0; k < 3; k++) q.box(0.12, 0.14, 0.5, [P.coral, P.teal, P.berry][k], -0.9, 1.55 + k * 0.28, 4.6);
      });
    }
  }
  // Picture signs: one atlas texture, one mesh, both faces. Stops' pole signs, the depot board and the landmark boards.
  // The rounded corners are cut with alphaTest (no black corners).
  function buildSigns() {
    const list = W.stops.map((st) => {
      const cx = st.pos.x - st.side.x * 0.9 + st.fwd.x * 4.6, cz = st.pos.z - st.side.z * 0.9 + st.fwd.z * 4.6;
      return { pic: st.pic, x: cx, y: 0.25 + 3.55, z: cz, nx: -st.fwd.x, nz: -st.fwd.z, size: 2.2, ring: P.honey };
    });
    list.push({ pic: 'depot', x: DEPOT_X - 7.5, y: 0.25 + 6.95, z: W.depot.pos.z, nx: -1, nz: 0, size: 2.9, ring: P.teal });
    for (const s of SIGNS) list.push(s);
    const cell = 128, cv = document.createElement('canvas');
    cv.width = cell * list.length; cv.height = cell;
    const x = cv.getContext('2d');
    list.forEach((st, i) => {
      const X = i * cell;
      x.beginPath(); x.roundRect ? x.roundRect(X + 3, 3, cell - 6, cell - 6, 24) : x.rect(X + 3, 3, cell - 6, cell - 6);
      x.fillStyle = st.ring; x.fill();
      x.beginPath(); x.roundRect ? x.roundRect(X + 11, 11, cell - 22, cell - 22, 17) : x.rect(X + 11, 11, cell - 22, cell - 22);
      x.fillStyle = '#fffaf0'; x.fill();
      x.drawImage(BB.pic(st.pic, 96), X + 18, 18, 92, 92);
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    const pos = [], uv = [];
    list.forEach((st, i) => {
      const { x: cx, y: cy, z: cz, nx, nz, size } = st;
      const rx = nz, rz = -nx;          // right along the board as seen from its front
      const u0 = (i + 0.004) / list.length, u1 = (i + 0.996) / list.length, h = size / 2;
      const quad = (sgn) => {
        const ox = nx * 0.06 * sgn, oz = nz * 0.06 * sgn;
        const A0 = [cx - rx * h * sgn + ox, cy - h, cz - rz * h * sgn + oz], B0 = [cx + rx * h * sgn + ox, cy - h, cz + rz * h * sgn + oz];
        const C0 = [cx + rx * h * sgn + ox, cy + h, cz + rz * h * sgn + oz], D0 = [cx - rx * h * sgn + ox, cy + h, cz - rz * h * sgn + oz];
        pos.push(...A0, ...B0, ...C0, ...A0, ...C0, ...D0);
        uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
      };
      quad(1); quad(-1);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.FrontSide }));
    m.name = 'signs';
    return m;
  }

  // ---------- per frame ----------
  let clock = 0;
  W.update = function (dt) {
    if (!W.built) return;
    const Bs = BB.bus;
    if (Bs && Bs.front && BB.camera) {
      fadeU.uCam.value.copy(BB.camera.position);
      fadeU.uBus.value.set((Bs.front.position.x + Bs.rear.position.x) / 2, 1.8, (Bs.front.position.z + Bs.rear.position.z) / 2);
    }
    clock += dt;
    // the sky eases toward its target share (set by main.js from the hub's time messages)
    const sk = W.sky;
    if (Math.abs(sk.target - sk.share) > 0.0005) {
      sk.share += BB.clamp(sk.target - sk.share, -dt * 0.25, dt * 0.25);
      applySky(sk.share);
    }
    skyU.time.value = clock;
    if (sky && BB.camera) sky.position.copy(BB.camera.position);
    if (clouds) clouds.rotation.y += dt * 0.004;
    if (train) {                           // glides back and forth, pausing at the station
      if (trainWait > 0) trainWait -= dt;
      else {
        const before = trainX;
        trainX += trainDir * 15 * dt;
        if ((before - 46) * (trainX - 46) <= 0 && before !== 46) { trainX = 46; trainWait = 3; }
        if (trainX > 175) { trainDir = -1; } else if (trainX < -175) { trainDir = 1; }
      }
      train.position.x = trainX;
    }
    if (cars) updateCars(dt);
    if (birds) { birds.visible = sk.night < 0.6; if (birds.visible) updateBirds(dt, clock); }
  };
})();
