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
      pos: { x: p.x + kx * (RH + 1.6), z: p.z + kz * (RH + 1.6) },     // the shelter, on the pavement
      heading: W.headingOf(fx, fz), fwd: { x: fx, z: fz }, side: { x: kx, z: kz },
    };
  }
  W.stops = STOP_DEFS.map(placeOnKerb);
  W.depot = placeOnKerb({ id: 'depot', name: 'Bus Depot', say: 'the depot', pic: 'depot', from: 'n22', to: 'n23', t: 0.4, toward: [46, 46] });
  const DEPOT_X = 41;            // the depot shed's centre (its door faces the road at x = DEPOT_X - 7)
  W.stopById = (id) => id === 'depot' ? W.depot : W.stops.find((s) => s.id === id);

  // ---------- building the scene ----------
  let train = null, clouds = null, sky = null, trainX = -170, trainDir = 1, trainWait = 0;
  const DECK_Y = 12;                       // underside of the MRT viaduct deck
  const VIADUCT_Z = g(1);

  W.build = function (scene) {
    W.scene = scene;
    scene.fog = new THREE.Fog(0xf6e7cc, 95, 260);
    buildSky(scene);
    // soft, mostly flat light (paper-cut look): ambient + a little sky/ground + one gentle warm sun from the upper left
    const amb = new THREE.AmbientLight(0xfff8ec, 0.5);
    const hemi = new THREE.HemisphereLight(0xfff3dc, 0xb8a58a, 0.22);
    const sun = new THREE.DirectionalLight(0xfff0d0, 0.4); sun.position.set(-60, 120, 45);
    scene.add(amb, hemi, sun);

    const ground = BB.mk.builder();
    ground.disc(420, 40, P.grass, 0, 0, 0);
    scene.add(tag(ground.mesh(), 'ground'));

    const roads = BB.mk.builder(), town = BB.mk.builder(), green = BB.mk.builder();
    buildRoads(roads);
    buildBlocks(roads, green);
    buildStreetTrees(green);
    buildHDBs(town);
    buildLandmarks(town, green);
    buildViaduct(town);
    buildStops(town);
    scene.add(tag(roads.mesh(), 'roads'), tag(town.mesh(), 'town'), tag(green.mesh(), 'green'));
    scene.add(buildSigns());
    train = buildTrain(); scene.add(train);
    clouds = buildClouds(); scene.add(clouds);
    W.built = true;
  };
  const tag = (m, name) => { m.name = name; m.matrixAutoUpdate = false; m.updateMatrix(); return m; };

  function buildSky(scene) {
    const geo = new THREE.SphereGeometry(420, 24, 12);
    const col = [], pos = geo.attributes.position, c = new THREE.Color();
    const top = new THREE.Color('#58b4ec'), mid = new THREE.Color('#9fd7f4'), hor = new THREE.Color('#f9e8c8');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 420;
      if (y > 0.25) c.copy(mid).lerp(top, BB.smooth((y - 0.25) / 0.6)); else c.copy(hor).lerp(mid, BB.smooth(y / 0.25));
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10; sky.name = 'sky';
    scene.add(sky);
    // TODO(world polish): evening/night sky following BB.hub.share (hub mode), sun disc.
  }

  // Roads: a ribbon per edge, squares at junctions, dashed centre lines, a planted median under the viaduct,
  // a yellow bus bay box at every stop and the pavement round the outside of the loop.
  const ROAD_Y = 0.04;
  function buildRoads(b) {
    for (const e of W.roads.edges) b.strip(e.points, -RH, RH, ROAD_Y, P.road);
    for (const n of W.roads.nodes) b.box(RH * 2, 0.01, RH * 2, P.road, n.x, ROAD_Y - 0.005, n.z);
    for (const e of W.roads.edges) {
      const underViaduct = Math.abs(e.points[0].z - VIADUCT_Z) < 1 && Math.abs(e.points[e.points.length - 1].z - VIADUCT_Z) < 1;
      if (underViaduct) {                                    // planted median strip instead of dashes
        const a = W.pointAt(e, 9), z = W.pointAt(e, e.length - 9);
        const len = Math.abs(z.x - a.x), cx = (a.x + z.x) / 2;
        b.box(len, 0.3, 1.4, P.kerb, cx, 0, a.z);
        b.box(len - 0.4, 0.12, 1.0, P.grassDark, cx, 0.3, a.z);
        continue;
      }
      for (let s = 9; s < e.length - 9; s += 6) {
        const p = W.pointAt(e, s + 1.3);
        b.box(0.28, 0.02, 2.6, P.roadLine, p.x, ROAD_Y, p.z, W.headingOf(p.dx, p.dz));
      }
    }
    // stop line boxes ("give way" style) before each junction, on the lane side
    // TODO(world polish): zebra crossings near the hawker centre and the playground.
    for (const st of W.stops.concat([W.depot])) {
      const e = W.edge(st.edge), p = W.pointAt(e, st.s);
      const cx = p.x + st.side.x * (C.lane + 0.9), cz = p.z + st.side.z * (C.lane + 0.9);   // where the bus pulls in
      const h = st.heading, col = st.id === 'depot' ? P.teal : P.honey;
      // a yellow box outline on the road: the bus bay
      b.at(cx, ROAD_Y + 0.01, cz, h, (q) => {
        q.box(0.3, 0.02, 15, col, 1.45, 0, 1.5); q.box(0.3, 0.02, 15, col, -1.45, 0, 1.5);
        q.box(3.2, 0.02, 0.3, col, 0, 0, -6); q.box(3.2, 0.02, 0.3, col, 0, 0, 9);
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
    kind = kind || (rnd() < 0.6 ? 'rain' : 'round');
    const col = rpick(TREE_GREENS);
    b.disc(2.6 * s, 7, P.grassDark, x + 0.6, y0 + 0.02, z + 0.5, 1, 0.8);       // soft shadow patch
    if (kind === 'rain') {                    // Singapore rain tree: a wide umbrella crown
      b.cyl(0.32 * s, 0.5 * s, 3.4 * s, 5, P.woodDark, x, y0, z);
      b.ball(3.2 * s, col, x, y0 + 4.6 * s, z, 0, 1.35, 0.5, 1.35);
      b.ball(2.0 * s, BB.P.leaf, x + 1.2 * s, y0 + 5.3 * s, z - 0.8 * s, 0, 1.2, 0.55, 1.2);
    } else if (kind === 'palm') {
      b.cyl(0.25 * s, 0.4 * s, 5.5 * s, 5, P.wood, x, y0, z, 0, 0.08, 0);
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; b.box(0.5 * s, 0.15, 3 * s, P.pine, x + Math.sin(a) * 1.3 * s, y0 + 5.4 * s, z + Math.cos(a) * 1.3 * s, a, 0.35); }
    } else {
      b.cyl(0.28 * s, 0.4 * s, 2.4 * s, 5, P.woodDark, x, y0, z);
      b.ball(2.1 * s, col, x, y0 + 3.9 * s, z, 0, 1, 1.1, 1);
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
          tree(b, x, z, Math.hypot(x, z) > 74 ? 0.2 : 0.27, 'round', 0.8);
        }
      }
    }
  }
  const inDepotYard = (x, z) => x > 27 && x < 50 && z > 27 && z < 55;

  // ---------- HDB blocks ----------
  // A slab: void deck (open ground floor with pillars), cream body with window bands, a coloured stair tower,
  // a coloured roof band and a water tank. Facing: long side along local x.
  const ACCENTS = [P.coral, P.teal, P.honey, P.berry, P.plum, '#4cb5a0', '#f28b4b'];
  function hdb(b, x, z, ry, len, dep, floors, accent) {
    accent = accent || rpick(ACCENTS);
    const fh = 2.7, vd = 3.2, H = vd + floors * fh;
    b.at(x, 0, z, ry, (q) => {
      q.box(len - 1.2, vd, dep - 1.2, '#b5a596', 0, 0, 0);                     // void deck (shady)
      for (let px = -len / 2 + 0.6; px <= len / 2 - 0.5; px += len / 5) for (const pz of [-dep / 2 + 0.5, dep / 2 - 0.5]) q.box(0.7, vd, 0.7, P.hdb, px, 0, pz);
      q.box(len, floors * fh, dep, P.hdb, 0, vd, 0);
      for (let f = 0; f < floors; f++) {
        const y = vd + f * fh + 0.9;
        q.box(len * 0.86, 1.0, 0.16, P.glass, -0.6, y, dep / 2 + 0.04);
        q.box(len * 0.86, 1.0, 0.16, P.glass, -0.6, y, -dep / 2 - 0.04);
        q.box(len + 0.2, 0.22, dep + 0.2, f % 3 === 2 ? accent : '#efe2c8', 0, vd + f * fh, 0);  // floor ledges, some coloured
      }
      q.box(3, H + 1.6, dep + 0.6, accent, len / 2 + 1.2, 0, 0);               // stair/lift tower
      q.box(0.18, H * 0.8, 1.2, light(accent), len / 2 + 2.75, vd, 0);
      q.box(len + 0.6, 1.0, dep + 0.6, accent, 0, H, 0);                        // roof band
      q.box(4, 1.6, 3, '#d9cdb8', -len / 4, H + 1, 0);                          // water tank
    });
  }
  // A point block (square tower).
  function tower(b, x, z, ry, size, floors, accent) {
    accent = accent || rpick(ACCENTS);
    const fh = 2.7, vd = 3.2, H = vd + floors * fh;
    b.at(x, 0, z, ry, (q) => {
      q.box(size - 1, vd, size - 1, '#b5a596', 0, 0, 0);
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) q.box(0.8, vd, 0.8, P.hdb, px * (size / 2 - 0.5), 0, pz * (size / 2 - 0.5));
      q.box(size, floors * fh, size, P.hdb, 0, vd, 0);
      for (let f = 0; f < floors; f++) {
        const y = vd + f * fh + 0.9;
        for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) q.at(0, 0, 0, r, (w) => w.box(size * 0.7, 1, 0.16, P.glass, 0, y, size / 2 + 0.04));
      }
      q.box(1.4, floors * fh, size + 0.3, accent, 0, vd, 0);
      q.box(size + 0.3, floors * fh * 0.25, 1.4, accent, 0, vd + floors * fh * 0.75, 0);
      q.box(size + 0.6, 1, size + 0.6, accent, 0, H, 0);
    });
  }
  const light = (c, t = 0.35) => '#' + new THREE.Color(c).lerp(new THREE.Color('#ffffff'), t).getHexString();
  W.hdb = hdb; W.tower = tower;

  function buildHDBs(b) {
    // corner blocks inside the loop's curves
    hdb(b, -45, -45, -Math.PI / 4, 18, 8, 9, P.coral);
    tower(b, 43, -43, 0, 10, 12, P.teal);
    hdb(b, -45, 45, Math.PI / 4, 18, 8, 10, P.berry);
    // outside the loop: a ring of estates
    const spots = [];
    for (const side of [-1, 1]) {
      for (const k of [-60, -10, 40]) spots.push([k + 8, side * 98, 0]);          // north and south rows
      for (const k of [-58, 52]) spots.push([side * 98, k, Math.PI / 2]);         // west and east (clear of the viaduct)
      spots.push([side * 128, 8, Math.PI / 2]);
    }
    for (const [x, z, ry] of spots) {
      if (rnd() < 0.3) tower(b, x, z, ry, 11, Math.round(rr(11, 15)));
      else hdb(b, x, z, ry, rr(24, 30), 8, Math.round(rr(9, 14)));
    }
    for (const [x, z] of [[96, 96], [-96, 96], [96, -98], [-98, -96]]) tower(b, x, z, Math.PI / 4, 11, Math.round(rr(12, 16)));
    // further out: a few taller blocks fading into the haze
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * Math.PI * 2 + 0.2, r = rr(165, 200);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(z - VIADUCT_Z) < 14) continue;
      hdb(b, x, z, -a + Math.PI / 2, rr(24, 32), 9, Math.round(rr(14, 20)));
    }
  }

  // ---------- landmarks ----------
  function buildLandmarks(b, green) {
    // Hawker centre (block north-middle): a big pitched roof on pillars, stalls with coloured boards, round tables.
    b.at(0, 0.25, -46, 0, (q) => {
      q.box(28, 0.3, 18, '#e9d9bb', 0, 0, 0);
      for (let x = -12; x <= 12; x += 6) for (const z of [-8, 8]) q.cyl(0.35, 0.35, 5, 6, P.cream, x, 0.3, z);
      q.box(29, 0.6, 19, '#d3502f', 0, 5.2, 0);
      q.prism(29, 19.4, 4.2, P.coral, 0, 5.8, 0);
      q.prism(12, 7, 2.2, P.honey, 0, 9.4, 0);
      for (let x = -11; x <= 11; x += 5.5) {
        q.box(4.6, 2.4, 2.6, P.cream, x, 0.3, -6.4);
        q.box(4.6, 0.9, 0.2, rpick([P.coral, P.teal, P.honey, P.berry, P.leaf]), x, 2.6, -5.0);
      }
      for (let x = -9; x <= 9; x += 4.5) for (const z of [-0.5, 4]) {
        q.cyl(0.9, 0.9, 0.12, 8, '#f3f0e6', x, 1.05, z); q.cyl(0.15, 0.15, 1.0, 5, '#9a8f86', x, 0.3, z);
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; q.cyl(0.32, 0.32, 0.6, 6, P.coral, x + Math.cos(a) * 1.4, 0.3, z + Math.sin(a) * 1.4); }
      }
    });
    tree(green, -16, -34, 0.27, 'rain'); tree(green, 15, -60, 0.27, 'rain');

    // Shophouse row (block west-middle), facades facing the loop road to the west.
    const shopCols = ['#ffd2a8', '#bfe7d4', '#ffc4d0', '#cfe0ff', '#fff0a8', '#ffcfb0', '#d9ccff'];
    for (let k = 0; k < 7; k++) {
      const z = -15 + k * 5.0, col = shopCols[k % shopCols.length];
      b.at(-54, 0.25, z, -Math.PI / 2, (q) => {               // local +z = facing west (toward the road)
        q.box(5, 3.2, 9, light(col, 0.1), 0, 0, -0.6);          // ground floor (set back: five-foot way)
        q.box(5, 3.6, 10.6, col, 0, 3.2, 0);                     // upper floor overhanging the walkway
        q.box(0.5, 3.2, 0.5, P.cream, -2.2, 0, 4.9); q.box(0.5, 3.2, 0.5, P.cream, 2.2, 0, 4.9);
        q.box(1.3, 1.8, 0.2, '#3f8f6a', -1.2, 4.0, 5.32); q.box(1.3, 1.8, 0.2, '#3f8f6a', 1.2, 4.0, 5.32);  // shutters
        q.box(5.2, 0.4, 11, P.cream, 0, 6.8, 0);
        q.prism(5.2, 11.4, 2.4, '#d0603e', 0, 7.2, 0, Math.PI / 2);
        q.box(3.4, 0.7, 0.2, rpick([P.coral, P.teal, P.honey, P.berry]), 0, 2.4, 3.95);   // shop sign board
      });
    }
    hdb(b, -38, 0, Math.PI / 2, 22, 7, 6, P.leaf);
    tree(green, -38, -15, 0.27, 'round'); tree(green, -38, 15, 0.27, 'round');

    // The park (centre): a pond, trees, benches, a path.
    green.disc(8, 12, '#62b8e0', 1, 0.3, -4, 1.1, 0.8);
    green.disc(8.8, 12, '#d9c79e', 1, 0.29, -4, 1.1, 0.8);
    for (const [x, z] of [[8, -12], [10, 6], [-12, 10], [-12, -12], [3, 14], [12, -2], [-2, -14]]) tree(green, x, z, 0.27, 'rain', rr(0.9, 1.2));
    for (const [x, z, r] of [[6, -6, 0.3], [-11, 1, 1.5]]) b.at(x, 0.27, z, r, (q) => { q.box(2.4, 0.15, 0.7, P.wood, 0, 0.5, 0); q.box(0.2, 0.5, 0.6, '#7d6e66', -1, 0, 0); q.box(0.2, 0.5, 0.6, '#7d6e66', 1, 0, 0); });
    // Playground (south part of the park block): a rubber mat, a slide tower, swings, a see-saw.
    green.disc(11, 16, '#ff9f86', 0, 0.3, 46, 1.2, 1);
    b.at(-3, 0.3, 45, 0, (q) => {
      for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) q.box(0.35, 3.4, 0.35, P.berry, x, 0, z);
      q.box(3.6, 0.3, 3.6, P.honey, 0, 2.4, 0);
      q.prism(4, 4, 1.8, P.coral, 0, 3.4, 0);
      q.box(1.6, 0.25, 7, P.honey, 0, 1.2, 4.8, 0, -0.38);            // the slide
      q.box(0.2, 0.5, 7, P.coral, 0.8, 1.4, 4.8, 0, -0.38); q.box(0.2, 0.5, 7, P.coral, -0.8, 1.4, 4.8, 0, -0.38);
    });
    b.at(6, 0.3, 42, 0, (q) => {
      q.box(0.3, 3.4, 0.3, P.teal, -3, 0, 0, 0, 0, 0.15); q.box(0.3, 3.4, 0.3, P.teal, 3, 0, 0, 0, 0, -0.15);
      q.box(6.6, 0.3, 0.3, P.teal, 0, 3.3, 0);
      for (const x of [-1.4, 1.4]) { q.box(0.06, 2.3, 0.06, '#7d6e66', x - 0.4, 1, 0); q.box(0.06, 2.3, 0.06, '#7d6e66', x + 0.4, 1, 0); q.box(1.0, 0.12, 0.5, P.coral, x, 0.95, 0); }
    });
    b.at(4, 0.3, 51, 0.4, (q) => { q.box(0.6, 0.6, 0.6, '#7d6e66', 0, 0, 0); q.box(5, 0.2, 0.6, P.honey, 0, 0.6, 0, 0, 0, 0.12); });
    for (const [x, z] of [[-12, 36], [12, 58], [-12, 58], [13, 34]]) tree(green, x, z, 0.27, 'round', 1.1);

    // MRT station entrance (block east-middle) under the viaduct station.
    b.at(46, 0.25, -12, 0, (q) => {
      q.box(14, 4, 6, P.cream, 0, 0, 0);
      q.box(15, 0.6, 7, P.teal, 0, 4, 0);
      q.box(6, 3, 0.2, P.glassDark, 0, 0, 3.05);
      q.box(1.2, DECK_Y - 4, 1.2, '#d8cfc2', -6, 4, -2); q.box(1.2, DECK_Y - 4, 1.2, '#d8cfc2', 6, 4, -2);   // lift shafts
    });
    for (const [x, z] of [[34, 8], [58, 8], [46, 12]]) tree(green, x, z, 0.27, 'rain', 0.9);

    // Bus depot (block south-east): a big shed with its door facing the road, a fuel pump, parked buses' bays.
    const D = W.depot;
    b.at(DEPOT_X, 0.25, D.pos.z, 0, (q) => {
      q.box(14, 0.15, 21, '#d8d0c4', 0, 0, 0);
      q.box(14, 7, 20, P.cream, 0, 0.15, 0);
      q.box(14.4, 0.6, 20.4, P.teal, 0, 7.1, 0);
      q.prism(20.6, 14.6, 3.2, P.teal, 0, 7.7, 0, Math.PI / 2);
      q.box(0.3, 5.4, 9, '#4a3f4c', -7.05, 0.15, 0);                    // the big door opening
      q.box(0.4, 0.6, 9.6, P.honey, -7.1, 5.55, 0);
      q.box(1.2, 2.2, 1, P.coral, -9.5, 0, -8); q.box(0.9, 0.7, 0.2, P.cream, -9.5, 1.2, -7.4);   // fuel pump
      q.box(3, 0.3, 4, P.honey, -9.5, 2.6, -8); q.box(0.2, 2.6, 0.2, '#7f8a96', -8.2, 0, -6.3); q.box(0.2, 2.6, 0.2, '#7f8a96', -10.8, 0, -6.3);
    });

    // Scattered trees and a few palms outside the loop and in the corner blocks.
    for (let k = 0; k < 90; k++) {
      const a = rnd() * Math.PI * 2, r = rr(80, 190);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearOfRoads(x, z, RH + 4)) continue;
      if (Math.abs(z - VIADUCT_Z) < 6) continue;
      if (nearBuilding(x, z)) continue;
      tree(green, x, z, 0, rnd() < 0.15 ? 'palm' : null, rr(0.9, 1.3));
    }
    for (const [x, z] of [[-34, -56], [-56, -32], [56, -32], [34, -58], [-56, 32], [-34, 56], [56, 34]]) tree(green, x, z, 0.27, null, 1);
  }
  // Rough footprint check against the outer estates (kept simple: a ring of avoid-circles filled while placing).
  function nearBuilding(x, z) {
    for (const [bx, bz] of [[-52, 98], [-2, 98], [48, 98], [-52, -98], [-2, -98], [48, -98], [98, -58], [98, 52], [-98, -58], [-98, 52], [128, 8], [-128, 8], [96, 96], [-96, 96], [96, -98], [-98, -96]]) {
      if (Math.abs(x - bx) < 18 && Math.abs(z - bz) < 18) return true;
    }
    return false;
  }

  // ---------- MRT viaduct over the middle road (generic: cream concrete, no operator branding) ----------
  function buildViaduct(b) {
    const z = VIADUCT_Z, len = 340;
    b.box(len, 1.4, 6, '#e8dfd2', 0, DECK_Y, z);
    b.box(len, 0.9, 0.4, '#d8cfc2', 0, DECK_Y + 1.4, z - 2.9); b.box(len, 0.9, 0.4, '#d8cfc2', 0, DECK_Y + 1.4, z + 2.9);
    b.box(len, 0.25, 0.25, '#a59a90', 0, DECK_Y + 1.4, z - 0.8); b.box(len, 0.25, 0.25, '#a59a90', 0, DECK_Y + 1.4, z + 0.8);
    for (const x of [-160, -125, -96, -46, 0, 46, 96, 125, 160]) {
      b.box(1.6, DECK_Y, 1.6, '#ddd4c8', x, 0, z);
      b.box(6.4, 1.2, 2.2, '#ddd4c8', x, DECK_Y - 1.2, z);
    }
    // the elevated station (over the east part of the middle road)
    b.box(30, 0.6, 12, '#e8dfd2', 46, DECK_Y + 1.4, z);
    b.box(30, 0.4, 2, P.honey, 46, DECK_Y + 2.0, z - 5); b.box(30, 0.4, 2, P.honey, 46, DECK_Y + 2.0, z + 5);
    for (const x of [33, 46, 59]) for (const zz of [z - 5.6, z + 5.6]) b.box(0.4, 5, 0.4, '#cfc4b6', x, DECK_Y + 2, zz);
    b.box(32, 0.5, 13, P.teal, 46, DECK_Y + 7, z);
    b.prism(32, 13, 1.6, '#16928a', 46, DECK_Y + 7.5, z);
  }
  function buildTrain() {
    const b = BB.mk.builder();
    for (let k = 0; k < 3; k++) {
      const x = (k - 1) * 10.2;
      b.box(9.8, 2.9, 2.8, '#f4f1ea', x, 0.4, 0);
      b.box(9.8, 0.5, 2.85, '#e2564a', x, 0.9, 0);
      b.box(8.6, 1.0, 2.9, P.glassDark, x, 1.8, 0);
      b.box(9.6, 0.3, 2.6, '#d7d2c8', x, 3.3, 0);
      for (const wx of [-3.5, 3.5]) b.cyl(0.4, 0.4, 2.6, 6, '#555', x + wx, 0, 0, 0, Math.PI / 2);
    }
    b.box(1.0, 2.0, 2.4, P.glassDark, 15.4, 1.4, 0); b.box(1.0, 2.0, 2.4, P.glassDark, -15.4, 1.4, 0);
    const m = b.mesh(); m.name = 'train';
    m.position.set(trainX, DECK_Y + 1.5, VIADUCT_Z + 1.4);
    return m;
  }
  function buildClouds() {
    const b = BB.mk.builder();
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2 + rr(0, 0.4), r = rr(120, 260), y = rr(60, 90);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      for (let j = 0; j < 4; j++) b.ball(rr(6, 11), '#ffffff', x + rr(-12, 12), y + rr(-2, 3), z + rr(-6, 6), 0, 1.4, 0.7, 1);
    }
    const m = new THREE.Mesh(b.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.92 }));
    m.name = 'clouds';
    return m;
  }

  // ---------- bus stops: shelter, bench, pole with a picture sign ----------
  function buildStops(b) {
    for (const st of W.stops) {
      b.at(st.pos.x, 0.25, st.pos.z, st.heading, (q) => {
        // local: +z forward (travel), +x toward the kerb side (away from the road)
        q.box(2.6, 0.06, 8, '#d9cdb4', 0.3, 0.0, 0);                 // paving
        for (const z of [-3.2, 3.2]) q.box(0.25, 3.2, 0.25, '#7f8a96', 1.0, 0, z);
        q.box(0.15, 2.2, 6.6, '#bfe3ef', 1.05, 0.6, 0);                // back panel (glass)
        q.box(3.0, 0.3, 7.6, P.teal, 0.4, 3.2, 0);                    // roof
        q.box(0.7, 0.12, 5, P.wood, 0.55, 0.9, 0);                     // bench
        q.box(0.15, 3.6, 0.15, '#7f8a96', -0.9, 0, 4.6);               // sign pole
      });
    }
  }
  // Picture signs: one atlas texture, one mesh, both faces.
  function buildSigns() {
    const list = W.stops.concat([W.depot]);
    const cell = 128, cv = document.createElement('canvas');
    cv.width = cell * list.length; cv.height = cell;
    const x = cv.getContext('2d');
    list.forEach((st, i) => {
      x.fillStyle = '#ffffff'; x.beginPath();
      x.roundRect ? x.roundRect(i * cell + 4, 4, cell - 8, cell - 8, 22) : x.rect(i * cell + 4, 4, cell - 8, cell - 8); x.fill();
      x.lineWidth = 7; x.strokeStyle = st.id === 'depot' ? P.teal : P.honey; x.stroke();
      x.drawImage(BB.pic(st.pic, 96), i * cell + 16, 16, 96, 96);
    });
    const tex = new THREE.CanvasTexture(cv);
    const pos = [], uv = [];
    list.forEach((st, i) => {
      const isDepot = st.id === 'depot';
      const size = isDepot ? 4 : 2.2;
      // depot: over its door facing the road; stops: on the pole, facing the oncoming bus
      let cx, cy, cz, nx, nz;
      if (isDepot) { cx = DEPOT_X - 7.4; cy = 0.25 + 6.9; cz = st.pos.z; nx = -1; nz = 0; }
      else { cx = st.pos.x - st.side.x * 0.9 + st.fwd.x * 4.6; cy = 0.25 + 3.5; cz = st.pos.z - st.side.z * 0.9 + st.fwd.z * 4.6; nx = -st.fwd.x; nz = -st.fwd.z; }
      const rx = nz, rz = -nx;          // right along the board as seen from its front
      const u0 = i / list.length, u1 = (i + 1) / list.length, h = size / 2;
      const quad = (sgn) => {
        const ox = nx * 0.06 * sgn, oz = nz * 0.06 * sgn;
        const A = [cx - rx * h * sgn + ox, cy - h, cz - rz * h * sgn + oz], B = [cx + rx * h * sgn + ox, cy - h, cz + rz * h * sgn + oz];
        const Cc = [cx + rx * h * sgn + ox, cy + h, cz + rz * h * sgn + oz], D = [cx - rx * h * sgn + ox, cy + h, cz - rz * h * sgn + oz];
        pos.push(...A, ...B, ...Cc, ...A, ...Cc, ...D);
        uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
      };
      quad(1); quad(-1);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
    m.name = 'signs';
    return m;
  }

  // ---------- per frame ----------
  W.update = function (dt) {
    if (!W.built) return;
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
    // TODO(world polish): decorative traffic (cars that never block), people on the void decks, birds.
  };
})();
