/* Bendy Bus 3D: the world.
   A compact Singapore-style neighbourhood: a 3x3 block grid inside a loop road with rounded (curved) corners,
   HDB blocks with coloured stripes and void decks, a hawker centre, an MRT viaduct over the middle road with a train
   gliding along, shophouses, a park and playground, the bus depot, street trees and five bus stops whose signs show a
   picture (no words). Everything static is merged into a few vertex-coloured meshes (see BB.mk in core.js).
   Exposes BB.world = { scene, roads:{nodes,edges}, stops, depot, update(dt), ...helpers }. */
(function () {
  'use strict';
  const hypot2 = (a, b) => Math.sqrt(a * a + b * b);   // (Math.hypot is slow and makes garbage on every call)
  const BB = window.BB, P = BB.P, C = BB.cfg;
  // Dual carriageways: two lanes each way (about 4.2 m each). The blocks grow with the roads so the buildings keep
  // their size. These go into the shared config (bus.js reads lane/roadHalf too): kerb lane centre 6.7 from the
  // middle, inner lane 2.5, road half-width 9.2.
  C.block = 56; C.roadHalf = 9.2; C.lane = 6.7; C.laneInner = 2.5; C.laneDivider = 4.6;
  // Fuel: a job of 2-3 stops is about 200 road units (measured: 120-280), and the first job after the pump starts
  // with the drive out of the depot yard (~300 more), so a full tank lasts about 3 jobs (measured with the lane
  // helper: 2.5-3.5) before the "getting hungry" trip to the fuel pump in the depot yard (C.fuelLow; as core.js).
  C.fuelPerUnit = 1 / 900;
  const S = C.block, RH = C.roadHalf;
  const K = S / 46;                              // the layout was first drawn for 46-unit blocks: older numbers x K
  const g = (i) => (i - 1.5) * S;                // grid line -> world coordinate (-69, -23, 23, 69)

  // Deterministic random so the town looks the same every visit.
  let seed = 12345;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rr = (a, b) => a + rnd() * (b - a);
  const rpick = (arr) => arr[Math.floor(rnd() * arr.length)];

  // ---------- pictures for the new stops (BB.pic falls back to these when core.js doesn't draw the name) ----------
  // plane (airport), city (towers), lantern (old town), beach (umbrella), supertree (gardens), ferris (big wheel),
  // wash (the depot's bus wash). Same paper-cut look on the same 100x100 board.
  const MY_PICS = {
    plane(x, pp) {
      BB.paper(x, (p) => { p.moveTo(18, 52); p.lineTo(48, 46); p.lineTo(62, 14); p.lineTo(72, 14); p.lineTo(66, 46); p.lineTo(86, 44); p.quadraticCurveTo(96, 48, 86, 54); p.lineTo(66, 54); p.lineTo(72, 86); p.lineTo(62, 86); p.lineTo(48, 56); p.lineTo(18, 50); p.closePath(); }, '#f4f1ea');
      BB.paper(x, (p) => { p.moveTo(14, 44); p.lineTo(22, 44); p.lineTo(30, 52); p.lineTo(22, 60); p.lineTo(14, 60); p.closePath(); }, '#4fa3e0', { depth: 0.4 });
      for (const wx of [56, 64, 72]) { x.beginPath(); x.arc(wx, 50, 2.4, 0, 7); x.fillStyle = '#4d6f8a'; x.fill(); }
    },
    city(x, pp) {
      const B = [[10, 40, 18, '#9cc7dc'], [30, 18, 20, '#8fe0c4'], [52, 30, 18, '#ffd45c'], [72, 10, 18, '#9cc7dc']];
      for (const [X, Y, Wd, c] of B) {
        BB.paper(x, (p) => pp.rr(p, X, Y, Wd, 90 - Y, 3), c, { depth: 0.5 });
        x.fillStyle = 'rgba(255,255,255,.6)'; for (let yy = Y + 6; yy < 84; yy += 9) x.fillRect(X + 4, yy, Wd - 8, 3);
      }
      BB.paper(x, (p) => pp.rr(p, 4, 86, 92, 8, 3), '#8a8290', { depth: 0.3 });
    },
    lantern(x, pp) {
      BB.paperStroke(x, (p) => { p.moveTo(50, 4); p.lineTo(50, 18); }, '#7a5a3a', 3);
      BB.paper(x, (p) => pp.rr(p, 38, 16, 24, 7, 3), '#ffb81f', { depth: 0.3 });
      BB.paper(x, (p) => p.ellipse(50, 50, 30, 28, 0, 0, Math.PI * 2), '#ef4b3c');
      for (const dx of [-16, 0, 16]) BB.paperStroke(x, (p) => { p.moveTo(50 + dx, 24); p.quadraticCurveTo(50 + dx * 1.5, 50, 50 + dx, 76); }, '#c8352a', 2);
      BB.paper(x, (p) => pp.rr(p, 38, 76, 24, 7, 3), '#ffb81f', { depth: 0.3 });
      BB.paperStroke(x, (p) => { p.moveTo(46, 84); p.lineTo(44, 96); p.moveTo(54, 84); p.lineTo(56, 96); }, '#ffb81f', 3);
    },
    beach(x, pp) {
      BB.paper(x, (p) => { p.moveTo(0, 80); p.quadraticCurveTo(50, 66, 100, 76); p.lineTo(100, 100); p.lineTo(0, 100); p.closePath(); }, '#f6d98e', { depth: 0.4, rim: false });
      BB.paperStroke(x, (p) => { p.moveTo(52, 34); p.lineTo(46, 86); }, '#8a6a48', 4);
      BB.paper(x, (p) => { p.moveTo(12, 40); p.quadraticCurveTo(50, -4, 90, 40); p.closePath(); }, '#ff6b5c');
      BB.paper(x, (p) => { p.moveTo(36, 40); p.quadraticCurveTo(50, 4, 64, 40); p.closePath(); }, '#fff6e0', { depth: 0.3 });
    },
    supertree(x, pp) {
      BB.paper(x, (p) => { p.moveTo(44, 92); p.lineTo(48, 40); p.lineTo(52, 40); p.lineTo(56, 92); p.closePath(); }, '#8e62c8');
      BB.paper(x, (p) => { p.moveTo(14, 24); p.lineTo(86, 24); p.lineTo(58, 46); p.lineTo(42, 46); p.closePath(); }, '#b07ad8');
      for (const [X, Y] of [[22, 24], [38, 20], [62, 20], [78, 24], [50, 18]]) { x.beginPath(); x.arc(X, Y, 4, 0, 7); x.fillStyle = '#6fc45a'; x.fill(); }
      BB.paper(x, (p) => p.ellipse(50, 94, 22, 4, 0, 0, Math.PI * 2), '#6fc45a', { depth: 0.2, rim: false });
    },
    ferris(x, pp) {
      BB.paperStroke(x, (p) => { p.moveTo(50, 50); p.lineTo(30, 94); p.moveTo(50, 50); p.lineTo(70, 94); }, '#8a8290', 5);
      x.save(); x.lineWidth = 5; x.strokeStyle = '#e9e2d6'; x.beginPath(); x.arc(50, 46, 36, 0, 7); x.stroke(); x.restore();
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; BB.paperStroke(x, (p) => { p.moveTo(50, 46); p.lineTo(50 + Math.cos(a) * 36, 46 + Math.sin(a) * 36); }, '#cfc7ba', 1.6); }
      const cols = ['#ff6b5c', '#ffb81f', '#19a79b', '#5d73e8', '#ff8fab', '#6fc45a', '#8e62c8', '#ffd45c'];
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; BB.paper(x, (p) => p.ellipse(50 + Math.cos(a) * 36, 46 + Math.sin(a) * 36, 7, 7, 0, 0, 7), cols[k], { depth: 0.3, rimW: 1.6 }); }
      BB.paper(x, (p) => p.ellipse(50, 46, 6, 6, 0, 0, 7), '#ffb81f', { depth: 0.3 });
    },
    // flats (a pastel HDB block with a stripe) and a market (a striped awning over fruit) for the neighbourhood stops
    flats(x, pp) {
      BB.paper(x, (p) => pp.rr(p, 22, 14, 56, 78, 4), '#ffe1cf');
      BB.paper(x, (p) => pp.rr(p, 22, 14, 12, 78, 3), '#ff6b5c', { depth: 0.3 });
      x.fillStyle = '#9cc7dc'; for (let yy = 22; yy < 80; yy += 11) for (const xx of [40, 52, 64]) x.fillRect(xx, yy, 8, 6);
      BB.paper(x, (p) => pp.rr(p, 10, 88, 80, 6, 3), '#6fc45a', { depth: 0.2, rim: false });
    },
    market(x, pp) {
      BB.paper(x, (p) => pp.rr(p, 14, 46, 72, 40, 4), '#c58a55');
      for (let k = 0; k < 6; k++) BB.paper(x, (p) => { p.moveTo(10 + k * 13.3, 22); p.lineTo(23.3 + k * 13.3, 22); p.lineTo(23.3 + k * 13.3, 40); p.quadraticCurveTo(16.6 + k * 13.3, 48, 10 + k * 13.3, 40); p.closePath(); }, k % 2 ? '#fff6e0' : '#19a79b', { depth: 0.2, rimW: 1.2 });
      for (const [X, c] of [[28, '#ff6b5c'], [42, '#ffb81f'], [56, '#6fc45a'], [70, '#ff8fab']]) BB.paper(x, (p) => p.ellipse(X, 56, 6, 6, 0, 0, 7), c, { depth: 0.3, rimW: 1.2 });
    },
    // the fire station (a red firefighter's helmet) and the clinic (a heart: no red cross)
    firestation(x, pp) {
      BB.paper(x, (p) => { p.moveTo(10, 74); p.quadraticCurveTo(50, 62, 90, 74); p.quadraticCurveTo(92, 84, 80, 84); p.lineTo(20, 84); p.quadraticCurveTo(8, 84, 10, 74); p.closePath(); }, '#d9382c', { depth: 0.4 });
      BB.paper(x, (p) => { p.moveTo(20, 72); p.quadraticCurveTo(22, 22, 50, 20); p.quadraticCurveTo(78, 22, 80, 72); p.closePath(); }, '#ef4b3c');
      BB.paperStroke(x, (p) => { p.moveTo(50, 22); p.lineTo(50, 66); }, '#c8352a', 4);
      BB.paper(x, (p) => p.ellipse(50, 50, 11, 13, 0, 0, 7), '#ffd45c', { depth: 0.3, rimW: 1.6 });
    },
    clinic(x, pp) {
      BB.paper(x, (p) => pp.rr(p, 10, 10, 80, 80, 14), '#fff6e0', { depth: 0.3, rimColor: '#7fd1c3' });
      BB.paper(x, (p) => { p.moveTo(50, 80); p.bezierCurveTo(14, 58, 16, 22, 38, 24); p.bezierCurveTo(46, 25, 50, 32, 50, 36); p.bezierCurveTo(50, 32, 54, 25, 62, 24); p.bezierCurveTo(84, 22, 86, 58, 50, 80); p.closePath(); }, '#ff6b8a');
      x.fillStyle = 'rgba(255,255,255,.6)'; x.beginPath(); x.ellipse(36, 36, 6, 4, -0.6, 0, 7); x.fill();
    },
    wash(x, pp) {
      BB.paper(x, (p) => pp.rr(p, 10, 44, 80, 34, 8), '#3fae49');
      x.fillStyle = '#cfe8f3'; for (const wx of [18, 38, 58]) x.fillRect(wx, 50, 15, 12);
      for (const [X, Y, R] of [[22, 30, 9], [42, 22, 12], [64, 28, 10], [80, 40, 7], [30, 84, 6], [60, 86, 7]]) BB.paper(x, (p) => p.ellipse(X, Y, R, R, 0, 0, 7), '#e9f6ff', { depth: 0.3, rimW: 1.6, rimColor: '#7cc4e8' });
    },
  };
  // (core.js lists the names it draws itself in BB.pic.extra; every other name here is drawn by world.js, e.g. the
  // flats and the market, which core.js doesn't have: they showed as a plain circle before)
  if (typeof BB.pic === 'function') {
    const basePic = BB.pic, cache = {}, coreHas = BB.pic.extra || {};
    BB.pic = function (name, size = 128) {
      const fn = !coreHas[name] && MY_PICS[name];
      if (!fn) return basePic(name, size);
      const key = name + size;
      if (cache[key]) return cache[key];
      const c = document.createElement('canvas'); c.width = c.height = size;
      const x = c.getContext('2d'); x.scale(size / 100, size / 100); x.lineJoin = 'round'; x.lineCap = 'round';
      try { fn(x, BB.paths || { rr: (p, X, Y, Wd, H) => p.rect(X, Y, Wd, H) }); } catch (e) { console.error(e); }
      return (cache[key] = c);
    };
    BB.pic.extra = Object.assign({}, coreHas, MY_PICS);
  }

  const W = BB.world = { scene: null, roads: { nodes: [], edges: [] }, stops: [], depot: null };

  // ---------- road graph ----------
  const nodeById = {}, edgeById = {};
  function addNode(i, j) {
    const n = { id: 'n' + i + j, x: g(i), z: g(j), edges: [] };
    nodeById[n.id] = n; W.roads.nodes.push(n); return n;
  }
  function addEdge(a, b, points) {
    const e = { id: 'e' + W.roads.edges.length, a: a.id, b: b.id, points, length: 0, cum: [0] };
    for (let i = 1; i < points.length; i++) { e.length += hypot2(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z); e.cum.push(e.length); }
    a.edges.push(e.id); b.edges.push(e.id);
    edgeById[e.id] = e; W.roads.edges.push(e); return e;
  }
  const straight = (a, b) => addEdge(a, b, [{ x: a.x, z: a.z }, { x: b.x, z: b.z }]);
  // Quarter arc around (cx, cz) from node a to node b.
  function arc(a, b, cx, cz) {
    const r = hypot2(a.x - cx, a.z - cz);
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
  // ---------- the wider map: an outer road round the town, the expressway, the airport and the depot yard ----------
  // A rounded rectangle of roads (x = +-200, z = -190 .. 190) joined to the loop by four connectors. Its north side is
  // the expressway (wider: three lanes each way; the bus's lane, 6.7 from the middle, is the middle one), which runs on
  // east to the airport. The bus depot's yard is a loop of two aisles off the south connector (in at one gate, out at
  // the other). Edges carry a kind ('town', 'outer', 'highway', 'yard') and a half width (W.halfOf).
  const OX = 200, HZ = -190, SZ = 190, CR = 40;
  W.HZ = HZ; W.SZ = SZ; W.OX = OX;
  function addNodeXY(id, x, z) { const n = { id, x, z, edges: [] }; nodeById[id] = n; W.roads.nodes.push(n); return n; }
  for (const e of W.roads.edges) { e.kind = 'town'; e.half = RH; }
  (function buildOuter() {
    const N = (id) => nodeById[id], mk = (id, x, z) => addNodeXY(id, x, z);
    const H1 = mk('H1', 28, HZ), NWa = mk('NWa', -OX + CR, HZ), NWb = mk('NWb', -OX, HZ + CR), W1 = mk('W1', -OX, -28);
    const SWb = mk('SWb', -OX, SZ - CR), SWa = mk('SWa', -OX + CR, SZ), S1 = mk('S1', 28, SZ), SEa = mk('SEa', OX - CR, SZ);
    const SEb = mk('SEb', OX, SZ - CR), E1 = mk('E1', OX, 28), NE = mk('NE', OX, HZ);   // (a plain T junction: the expressway runs on east)
    const AJ = mk('AJ', 400, HZ), AP1 = mk('AP1', 400, HZ - 26), AP2 = mk('AP2', 400, HZ - 86);
    const Yg1 = mk('Yg1', 28, 128), Yg2 = mk('Yg2', 28, 166), Ya = mk('Ya', 118, 128), Yb = mk('Yb', 118, 166);
    const kind = (e, k, h) => { e.kind = k; e.half = h || RH; return e; };
    for (const [a, b] of [[NWa, H1], [H1, NE], [NE, AJ]]) kind(straight(a, b), 'highway', 13.2);
    kind(arc(NWa, NWb, -OX + CR, HZ + CR), 'outer'); kind(straight(NWb, W1), 'outer'); kind(straight(W1, SWb), 'outer');
    kind(arc(SWb, SWa, -OX + CR, SZ - CR), 'outer'); kind(straight(SWa, S1), 'outer'); kind(straight(S1, SEa), 'outer');
    kind(arc(SEa, SEb, OX - CR, SZ - CR), 'outer'); kind(straight(SEb, E1), 'outer'); kind(straight(E1, NE), 'outer');
    for (const [a, b] of [[N('n20'), H1], [N('n01'), W1], [N('n23'), Yg1], [Yg1, Yg2], [Yg2, S1], [N('n32'), E1]]) kind(straight(a, b), 'outer');
    kind(straight(AJ, AP1), 'outer'); kind(straight(AP1, AP2), 'outer'); kind(arc(AP2, AP1, 400, HZ - 56), 'outer');
    kind(straight(Yg1, Ya), 'yard'); kind(arc(Ya, Yb, 118, 147), 'yard'); kind(straight(Yb, Yg2), 'yard');
  })();
  W.halfOf = (e) => (e && e.half) || RH;
  // The bus stays inside this box (the sea wall to the south, the airport fence to the north, tunnels east and west).
  const BX0 = -244, BX1 = 548, BZ0 = -300, BZ1 = 211;
  W.BOUNDS = { x0: BX0, x1: BX1, z0: BZ0, z1: BZ1 };
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
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hypot2(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    return (laneCache[key] = { pts, cum, len: cum[cum.length - 1], edge: e, dir });
  };
  function offsetLine(src, off) {
    const out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[Math.max(0, i - 1)], b = src[Math.min(src.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const l = hypot2(dx, dz) || 1; dx /= l; dz /= l;
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
    { id: 'hawker', name: 'Hawker Centre', say: 'the hawker centre', pic: 'bowl', from: 'n10', to: 'n20', t: 0.5, toward: [0, -S] },
    { id: 'shops', name: 'Shophouses', say: 'the shops', pic: 'shop', from: 'n01', to: 'n02', t: 0.5, toward: [-S, 0] },
    { id: 'park', name: 'Park', say: 'the park', pic: 'tree', from: 'n11', to: 'n12', t: 0.45, toward: [0, 0] },
    { id: 'playground', name: 'Playground', say: 'the playground', pic: 'slide', from: 'n13', to: 'n23', t: 0.5, toward: [0, S] },
    { id: 'mrt', name: 'MRT Station', say: 'the MRT station', pic: 'train', from: 'n21', to: 'n22', t: 0.55, toward: [S, 0] },
    // the wider map
    // (on the terminal's side of the drop-off road: the bus comes straight down from the expressway into the bay and
    // goes round the loop after; a bay on the loop side was only reachable by a tight 90-degree turn off the loop)
    { id: 'airport', name: 'Airport', say: 'the airport', pic: 'plane', from: 'AP1', to: 'AP2', t: 0.5, toward: [360, HZ - 56] },
    { id: 'city', name: 'City', say: 'the city', pic: 'city', from: 'E1', to: 'NE', t: 0.37, toward: [260, -50] },
    { id: 'chinatown', name: 'Old Town', say: 'old town', pic: 'lantern', from: 'W1', to: 'SWb', t: 0.45, toward: [-150, 50] },
    { id: 'beach', name: 'Beach', say: 'the beach', pic: 'beach', from: 'S1', to: 'SEa', t: 0.68, toward: [118, 260] },
    { id: 'gardens', name: 'Gardens', say: 'the gardens', pic: 'supertree', from: 'SWa', to: 'S1', t: 0.61, toward: [-45, 120] },
    { id: 'wheel', name: 'Big Wheel', say: 'the big wheel', pic: 'ferris', from: 'SWa', to: 'S1', t: 0.21, toward: [-120, 120] },
    // neighbourhood stops in between, so the next stop is never far (about 150-250 along the roads)
    { id: 'flats', name: 'Flats', say: 'the flats', pic: 'flats', from: 'n22', to: 'n32', t: 0.5, toward: [56, 56] },
    { id: 'market', name: 'Market', say: 'the market', pic: 'market', from: 'n10', to: 'n11', t: 0.5, toward: [-56, -56] },
    { id: 'garden', name: 'Little Garden', say: 'the little garden', pic: 'tree', from: 'n02', to: 'n12', t: 0.5, toward: [-56, 56] },
    { id: 'northRoad', name: 'North Flats', say: 'the north flats', pic: 'flats', from: 'n20', to: 'H1', t: 0.3, toward: [-20, -116] },
    { id: 'eastLink', name: 'Towers', say: 'the towers', pic: 'city', from: 'n32', to: 'E1', t: 0.5, toward: [142, 0] },
    { id: 'westGate', name: 'West Flats', say: 'the west flats', pic: 'flats', from: 'NWb', to: 'W1', t: 0.5, toward: [-150, -89] },
    { id: 'expressWest', name: 'Expressway West', say: 'the expressway', pic: 'tree', from: 'NWa', to: 'H1', t: 0.5, toward: [-66, -150] },
    { id: 'expressEast', name: 'Expressway East', say: 'the expressway', pic: 'city', from: 'H1', to: 'NE', t: 0.5, toward: [114, -150] },
    { id: 'airportRoad', name: 'Airport Road', say: 'the airport road', pic: 'plane', from: 'NE', to: 'AJ', t: 0.5, toward: [300, -150] },
    { id: 'seaView', name: 'Sea View', say: 'the sea view', pic: 'beach', from: 'SWa', to: 'S1', t: 0.45, toward: [-75, 260] },
    { id: 'lanterns', name: 'Lantern Street', say: 'lantern street', pic: 'lantern', from: 'W1', to: 'SWb', t: 0.67, toward: [-260, 91] },
    { id: 'seaside', name: 'Seaside', say: 'the seaside', pic: 'beach', from: 'SEb', to: 'E1', t: 0.15, toward: [260, 132] },
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
      pos: { x: p.x + kx * (e.half + 2.5), z: p.z + kz * (e.half + 2.5) },   // the shelter, on the pavement (clear of the bus roof)
      heading: W.headingOf(fx, fz), fwd: { x: fx, z: fz }, side: { x: kx, z: kz },
    };
  }
  W.stops = STOP_DEFS.map(placeOnKerb);
  // The bus depot: an open-air yard off the south connector. W.depot is the child's bay on the north aisle (where the
  // bus waits after Drive and where depot trips end); the workshop (customising, the home screen) is the big open
  // shed at the yard's east end; the wash bay is a drive-through gantry on the south aisle.
  W.depot = placeOnKerb({ id: 'depot', name: 'Bus Depot', say: 'the depot', pic: 'depot', from: 'Yg1', to: 'Ya', t: 0.42, toward: [70, 100] });
  W.washBay = placeOnKerb({ id: 'wash', name: 'Bus Wash', say: 'the bus wash', pic: 'wash', from: 'Yb', to: 'Yg2', t: 0.45, toward: [80, 200] });
  // where the bus waits after Drive: on the yard's way out, just short of the gate (past the bus wash), facing out,
  // so the first drive is a short one (from the garage's own bay it was a long loop round the yard, ~35 s)
  W.yardStart = placeOnKerb({ id: 'yardStart', name: 'Bus Depot', say: 'the depot', pic: 'depot', from: 'Yb', to: 'Yg2', t: 0.85, toward: [40, 200] });
  // The fuel pump (the yard's fuel island, on the kerb side of the north aisle; built in buildDepot) and the bay
  // where a ride stands beside it: the north aisle's kerb lane, heading east. jobs.js moves the bay along the kerb
  // for each ride (bay._bay) so the ride's fuel cap stops just past the pump.
  // W.pump: the pump's middle on the ground; nozzle: where the nozzle hangs on its back (world point, height y).
  W.pump = { x: 98, z: 117.1, nozzle: { x: 98.62, y: 1.0, z: 117.15 } };
  W.pumpBay = placeOnKerb({ id: 'pump', name: 'Fuel Pump', say: 'the fuel pump', pic: 'pump', from: 'Yg1', to: 'Ya', t: 0.8, toward: [98, 100] });
  // More start bays, so buses of friends who tap Drive at about the same time don't stand inside each other: beside
  // it in the inner lane, then on the road just outside the gates (between the two gates, both directions, kerb and
  // inner lanes). BB.bus.placeInYard takes the first free one (W.startSlots()).
  W.yardSlotsKerb = [
    placeOnKerb({ id: 'startN', name: 'Bus Depot', say: 'the depot', pic: 'depot', from: 'Yg2', to: 'Yg1', t: 0.5, toward: [0, 147] }),    // heading north
    placeOnKerb({ id: 'startS', name: 'Bus Depot', say: 'the depot', pic: 'depot', from: 'Yg1', to: 'Yg2', t: 0.5, toward: [60, 147] }),   // heading south
  ];
  let startSlots = null;
  W.startSlots = function () {
    if (startSlots) return startSlots;
    // the same bay one lane in (the inner lane), for a bus beside the one in the kerb lane
    const inner = (st) => {
      const b = W.bayOf(st), d = -(C.lane - C.laneInner), sh = (q) => ({ x: q.x + st.side.x * d, z: q.z + st.side.z * d });
      return Object.assign({}, st, { id: st.id + 'In', _bay: Object.assign({}, b, sh(b), { nose: sh(b.nose) }) });
    };
    // the parking bays in the middle of the yard, between the parked buses (the owner's choice): nose to the south
    // aisle, the yard's way out, so the bus drives forward out of its bay and turns right for the gate
    const park = PARK_START.map((i) => {
      const x = 52 + i * 9.4, z = 147, fwd = { x: 0, z: 1 }, side = { x: -1, z: 0 };
      return { id: 'park' + i, name: 'Bus Depot', say: 'the depot', pic: 'depot', kind: 'start', pos: { x, z }, heading: 0, fwd, side,
        _bay: { nose: { x, z: z + 7.2 }, x, z, heading: 0, fwd, side, len: 15.4, width: 3.4 } };
    });
    const [n, s2] = W.yardSlotsKerb;
    return (startSlots = park.concat([W.yardStart, inner(W.yardStart), s2, n, inner(s2), inner(n)]));
  };
  const PARK_START = [1, 3, 5];          // which of the 7 parking bays are kept empty for starting (nearest the gate first)
  W.workshop = { x: 166, z: 147, heading: -Math.PI / 2 };       // the bus's middle and heading in the workshop
  W.YARD = { x0: 37.2, x1: 188, z0: 104, z1: 178 };
  W.inDepotYard = (x, z) => x > W.YARD.x0 && x < W.YARD.x1 && z > W.YARD.z0 && z < W.YARD.z1;
  // ---------- places for the special vehicles' jobs, and roadside scene spots ----------
  // W.places: target bays (usable by BB.bus.stopAt like stops) in front of a fire station and a small clinic (on the
  // grass east of the outer road, set well back so the side-view camera has room), and the ice cream depot (the
  // depot's own bay). W.sceneSpots: plain kerb spots along quiet roads where jobs.js can stage a scene (a kiosk
  // on fire, a broken-down car, a picnic queue); each has tags saying what fits there. W.sceneSpot(tag, nearX, nearZ)
  // picks one. Every bay has {id, kind, name, say, pic, edge, s, dir, pos (the pavement spot), heading, fwd, side}.
  const PLACE_DEFS = {
    fireStation: { id: 'firestation', kind: 'fire', name: 'Fire Station', say: 'the fire station', pic: 'firestation', from: 'E1', to: 'SEb', t: 0.5, toward: [260, 90], col: '#ef4b3c' },
    clinic: { id: 'clinic', kind: 'clinic', name: 'Clinic', say: 'the clinic', pic: 'clinic', from: 'E1', to: 'NE', t: 0.68, toward: [260, -120], col: '#ff8fab' },
  };
  W.places = {};
  for (const k in PLACE_DEFS) { const d = PLACE_DEFS[k], pl = placeOnKerb(d); pl.kind = d.kind; pl.place = true; pl.col = d.col; W.places[k] = pl; }
  W.places.iceCreamDepot = W.depot;
  const SPOT_DEFS = [
    { id: 'spotBeach', tags: ['picnic', 'icecream', 'car'], from: 'S1', to: 'SEa', t: 0.25, toward: [61, 260] },
    { id: 'spotPark', tags: ['picnic', 'icecream', 'fire'], from: 'n12', to: 'n13', t: 0.5, toward: [-60, 56] },
    { id: 'spotTown', tags: ['fire', 'car', 'icecream'], from: 'n20', to: 'n21', t: 0.5, toward: [60, -56] },
    { id: 'spotNorth', tags: ['car', 'fire'], from: 'H1', to: 'n20', t: 0.5, toward: [60, -137] },
    { id: 'spotEast', tags: ['car', 'picnic', 'fire'], from: 'E1', to: 'NE', t: 0.18, toward: [260, 0] },
    { id: 'spotYardRoad', tags: ['car', 'icecream'], from: 'n22', to: 'n23', t: 0.5, toward: [60, 56] },
  ];
  W.sceneSpots = SPOT_DEFS.map((d) => { const sp = placeOnKerb(Object.assign({ name: 'here', say: 'here', pic: null }, d)); sp.kind = 'scene'; sp.tags = d.tags; return sp; });
  W.sceneSpot = function (tag, nx, nz) {
    let list = W.sceneSpots.filter((sp) => !tag || sp.tags.indexOf(tag) >= 0);
    if (!list.length) list = W.sceneSpots.slice();
    if (nx != null) { list = list.filter((sp) => hypot2(sp.pos.x - nx, sp.pos.z - nz) > 70).concat(list.filter((sp) => hypot2(sp.pos.x - nx, sp.pos.z - nz) <= 70)); return list[Math.floor(Math.random() * Math.min(3, list.length))]; }
    return list[Math.floor(Math.random() * list.length)];
  };
  // Turn any target {pos:{x,z}, heading, kind} (or {x, z, heading}) into a bay on the nearest road's kerb lane, in
  // place (it keeps its identity, so jobs.js can compare it). The bay's travel direction follows heading when given
  // (else the side of the road the point is on).
  W.makeBay = function (o) {
    if (!o || o.edge != null) return o;
    const P0 = o.pos || o, x = +P0.x || 0, z = +P0.z || 0;
    let best = null, bd = Infinity;
    for (const e of W.roads.edges) {
      if (e.kind === 'yard') continue;
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1], c = e.points[i], dx = c.x - a.x, dz = c.z - a.z, l2 = dx * dx + dz * dz || 1;
        const t = BB.clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1), d = hypot2(a.x + dx * t - x, a.z + dz * t - z);
        if (d < bd) { bd = d; best = { e, s: e.cum[i - 1] + t * Math.sqrt(l2) }; }
      }
    }
    const e = best.e, p = W.pointAt(e, best.s);
    let dir;
    if (o.heading != null) dir = (Math.sin(o.heading) * p.dx + Math.cos(o.heading) * p.dz) >= 0 ? 1 : -1;
    else dir = (p.dz * (x - p.x) - p.dx * (z - p.z)) >= 0 ? 1 : -1;    // the side the point is on is the kerb
    const s = BB.clamp(best.s, 12, e.length - 12), q = W.pointAt(e, s), fx = q.dx * dir, fz = q.dz * dir, kx = fz, kz = -fx;
    Object.assign(o, { id: o.id || ('bay' + Math.round(x) + '_' + Math.round(z)), kind: o.kind || 'scene', name: o.name || 'here', say: o.say || 'here',
      edge: e.id, t: s / e.length, dir, s, kerbSide: 'left', heading: W.headingOf(fx, fz), fwd: { x: fx, z: fz }, side: { x: kx, z: kz },
      pos: { x: q.x + kx * (e.half + 2.5), z: q.z + kz * (e.half + 2.5) } });
    delete o._bay;
    return o;
  };
  // every bay the town keeps clear (trees, lamps, the stop cameras' spots)
  const allBays = () => W.stops.concat([W.depot, W.places.fireStation, W.places.clinic], W.sceneSpots, W.yardSlotsKerb);
  W.allBays = allBays;
  // ---------- many small stops: one about every 4 s of driving (the owner asked for closer stops) ----------
  // Along every straight road, on each kerb, a small stop (pole, little canopy, bench, sign) about every 30 (110 on the
  // expressway), well clear of junctions, the named stops, the places and scene spots, and the roads under the MRT
  // viaduct. Each gets a picture of what is near it (flats, trees, a market, swings; the seaside, the towers, old
  // town, the airport road in those areas). They are ordinary stops (st.minor = true); W.build drops any whose
  // shelter would stand in something.
  const MINOR_PICS = { flats: ['Flats', 'the flats'], tree: ['Trees', 'the trees'], market: ['Market', 'the market'], slide: ['Swings', 'the swings'],
    beach: ['Seaside', 'the seaside'], city: ['Towers', 'the towers'], lantern: ['Old Town', 'old town'], plane: ['Airport Road', 'the airport road'] };
  const minorPic = (x, z, i) => z > 170 ? 'beach' : (x > 215 && z < -150) ? 'plane' : (x > 95 && x < 215 && z < -30 && z > -180) ? 'city' : x < -175 ? 'lantern' : ['flats', 'tree', 'market', 'slide'][i % 4];
  (function addMinorStops() {
    const nodeClear = (id, e) => { const n = nodeById[id]; return n.edges.length >= 3 ? Math.max(...n.edges.map((q) => edgeById[q].half || RH)) + (e.kind === 'town' ? 9 : 18) : 12; };
    let k = 0;
    for (const e of W.roads.edges) {
      if (e.kind === 'yard' || e.points.length > 2) continue;                       // (not in the yard, not on curves)
      if (/^AP/.test(e.a) || /^AP/.test(e.b)) continue;                               // (the airport drop-off has its own stop)
      const a = e.points[0], b = e.points[e.points.length - 1];
      if (Math.abs(a.z - g(1)) < 12 && Math.abs(b.z - g(1)) < 12 && Math.abs(a.x) < 200) continue;   // under the viaduct
      const step = e.kind === 'highway' ? 110 : 30, s0 = nodeClear(e.a, e) + 4, s1 = e.length - nodeClear(e.b, e) - 4;
      if (s1 - s0 < 0) continue;
      for (const dir of [1, -1]) {
        const taken = allBays().filter((q) => q.edge === e.id && q.dir === dir).map((q) => q.s);
        const n = Math.max(1, Math.round((s1 - s0) / step) + 1);
        for (let i = 0; i < n; i++) {
          const sv = n === 1 ? (s0 + s1) / 2 : s0 + (s1 - s0) * i / (n - 1);
          if (taken.some((t) => Math.abs(t - sv) < 26)) continue;
          const p = W.pointAt(e, sv), lx = p.dz * dir, lz = -p.dx * dir;           // kerb side of this direction
          const toward = [p.x + lx * 30, p.z + lz * 30], kx = p.x + lx * (e.half + 2.5), kz = p.z + lz * (e.half + 2.5);
          const pic = minorPic(kx, kz, k++), nm = MINOR_PICS[pic];
          const st = placeOnKerb({ id: 'stop' + k, name: nm[0], say: nm[1], pic, from: e.a, to: e.b, t: sv / e.length, toward });
          st.minor = true; W.stops.push(st); taken.push(sv);
        }
      }
    }
  })();
  // ---------- many more scene spots: about every 20 along the quiet roads ----------
  // The special vehicles' jobs go about as far as a bus job (40-80 road units, ~7 s), so they need scene spots
  // everywhere, not just the six above. Along straight roads (not the yard, the airport drop-off
  // or under the viaduct), on each kerb, a plain spot about every 20, wherever its bay (about 13 behind the spot to 4
  // ahead) and its people (6 behind to 8 ahead) keep clear of the stops' shelters. Only one scene is ever staged at a
  // time, so the spots may overlap each other. They are kept aside (GEN_SPOTS) until the town stands, so the street
  // trees and lamp posts don't make way for them (the side-view camera hides the props between it and the vehicle);
  // W.build then drops the ones with something in the way and gives each the tags whose zones are clear
  // (fitSceneSpots: 'fire' needs the burning kiosk's room ahead, 'yard' the tray of cars behind).
  const GEN_SPOTS = [];
  (function addSceneSpots() {
    // (the first few hand-placed spots get a name from what they're near too, like the made ones below)
    W.sceneSpots.forEach((sp, i) => { if (!sp.near) sp.near = MINOR_PICS[minorPic(sp.pos.x, sp.pos.z, i)][1]; });
    const nodeClear = (id, e) => { const n = nodeById[id]; return n.edges.length >= 3 ? Math.max(...n.edges.map((q) => edgeById[q].half || RH)) + 9 : 12; };
    let k = 0;
    for (const e of W.roads.edges) {
      if (e.kind === 'yard' || e.points.length > 2) continue;
      if (/^AP/.test(e.a) || /^AP/.test(e.b)) continue;
      const a = e.points[0], b = e.points[e.points.length - 1];
      if (Math.abs(a.z - g(1)) < 12 && Math.abs(b.z - g(1)) < 12 && Math.abs(a.x) < 200) continue;   // under the viaduct
      const lo = nodeClear(e.a, e) + 4, hi = e.length - nodeClear(e.b, e) - 4;
      if (hi < lo) continue;
      const n = Math.max(1, Math.round((hi - lo) / 20) + 1);
      for (const dir of [1, -1]) {
        const bays = allBays().filter((q) => q.edge === e.id && q.dir === dir).map((q) => q.s);
        for (let i = 0; i < n; i++) {
          const sv = n === 1 ? (lo + hi) / 2 : lo + (hi - lo) * i / (n - 1);
          if (bays.some((t) => { const d = (t - sv) * dir; return d > 0 ? d < 14 : -d < 19; })) continue;   // (d > 0: ahead)
          const p = W.pointAt(e, sv), lx = p.dz * dir, lz = -p.dx * dir;
          const sp = placeOnKerb({ id: 'scene' + (++k), name: 'here', say: 'here', pic: null, from: e.a, to: e.b, t: sv / e.length, toward: [p.x + lx * 30, p.z + lz * 30] });
          sp.kind = 'scene'; sp.tags = ['picnic', 'icecream', 'car']; sp.gen = true;
          sp.near = MINOR_PICS[minorPic(sp.pos.x, sp.pos.z, k)][1];        // what it's near, for the spoken lines
          GEN_SPOTS.push(sp);
        }
      }
    }
  })();
  // A scene spot's zones, in its own frame: a = along the kerb from the spot (forward +), o = out past the kerb line.
  // 'small' = people, bags, teddies, the ice cream queue; 'fire' = the kiosk and firefighters ahead; 'yard' = the
  // tray of cars behind (the tow truck's yard scene).
  // (fire also needs the camera's room in front of the kiosk and the firefighters: nothing solid 5-20 out, so the
  // side-view camera can stand there and see them all past the kiosk; the same behind the tray of cars for 'yard';
  // with only some of that room (out to 13) they are 'fire2' / 'yard2': jobs.js uses those only when nothing better
  // is near)
  const SCENE_ZONES = { small: [-6, 8, 0.6, 3.8], fire: [3, 19, 0.6, 4.6], fireCam: [-2, 17, 5, 20], yard: [-14, 3, 1.8, 9.4], yardCam: [-12, 2, 9.4, 18], fireCam2: [-2, 17, 5, 13], yardCam2: [-12, 2, 9.4, 13] };
  function sceneWorld(sp, a, o) {
    const e = edgeById[sp.edge], p = W.pointAt(e, sp.s);
    return { x: p.x + sp.fwd.x * a + sp.side.x * (e.half + o), z: p.z + sp.fwd.z * a + sp.side.z * (e.half + o) };
  }
  // Once the town stands: add the spots kept aside, drop those whose bay has something in it (or that sit by the yard
  // fence), and give each one the tags whose zones are clear of roads, buildings and solid posts (trees and lamp posts
  // don't count: the scene camera hides them).
  function fitSceneSpots(blockedBay, nearYard) {
    // (the road pieces near a spot are listed once per spot, as [ax, az, dx, dz, l2, reach] runs: every zone of the
    //  spot is sampled against that short list instead of against every road in town)
    const near = new Map();
    const roadsNear = (sp, p) => {
      let L = near.get(sp); if (L) return L;
      L = [];
      for (const e of W.roads.edges) {
        if (e.id === sp.edge) continue;
        for (let i = 1; i < e.points.length; i++) {
          const a = e.points[i - 1], c = e.points[i], dx = c.x - a.x, dz = c.z - a.z;
          if (Math.min(a.x, c.x) - p.x > 90 || p.x - Math.max(a.x, c.x) > 90 || Math.min(a.z, c.z) - p.z > 90 || p.z - Math.max(a.z, c.z) > 90) continue;
          L.push(a.x, a.z, dx, dz, dx * dx + dz * dz || 1, (e.half || RH) + 0.6);
        }
      }
      near.set(sp, L); return L;
    };
    const zoneClear = (sp, z) => {
      const e = edgeById[sp.edge], p = W.pointAt(e, sp.s), L = roadsNear(sp, p);
      for (let a = z[0]; a <= z[1] + 0.01; a += 1.5) for (let o = z[2]; o <= z[3] + 0.01; o += 1.2) {
        const x = p.x + sp.fwd.x * a + sp.side.x * (e.half + o), zz = p.z + sp.fwd.z * a + sp.side.z * (e.half + o);
        if (W.solidAt(x, zz, 0.6)) return false;
        for (let k = 0; k < L.length; k += 6) {
          const t = BB.clamp(((x - L[k]) * L[k + 2] + (zz - L[k + 1]) * L[k + 3]) / L[k + 4], 0, 1);
          if (hypot2(L[k] + L[k + 2] * t - x, L[k + 1] + L[k + 3] * t - zz) < L[k + 5]) return false;
        }
      }
      return true;
    };
    for (const sp of GEN_SPOTS.splice(0)) W.sceneSpots.push(sp);
    for (let i = W.sceneSpots.length - 1; i >= 0; i--) {
      const sp = W.sceneSpots[i];
      if (blockedBay(sp) || nearYard(sp) || !zoneClear(sp, SCENE_ZONES.small)) { W.sceneSpots.splice(i, 1); continue; }
      sp.tags = ['picnic', 'icecream', 'car'];
      if (zoneClear(sp, SCENE_ZONES.fire) && zoneClear(sp, SCENE_ZONES.fireCam2)) sp.tags.push(zoneClear(sp, SCENE_ZONES.fireCam) ? 'fire' : 'fire2');
      if (zoneClear(sp, SCENE_ZONES.yard) && zoneClear(sp, SCENE_ZONES.yardCam2)) sp.tags.push(zoneClear(sp, SCENE_ZONES.yardCam) ? 'yard' : 'yard2');
    }
    // the stops can stage scenes too (their shelter hides from the scene camera like at any stop): the same tags
    for (const st of W.stops) {
      if (!zoneClear(st, SCENE_ZONES.small)) { st.tags = []; continue; }
      st.tags = ['picnic', 'icecream', 'car'];
      if (zoneClear(st, SCENE_ZONES.fire) && zoneClear(st, SCENE_ZONES.fireCam2)) st.tags.push(zoneClear(st, SCENE_ZONES.fireCam) ? 'fire' : 'fire2');
      if (zoneClear(st, SCENE_ZONES.yard) && zoneClear(st, SCENE_ZONES.yardCam2)) st.tags.push(zoneClear(st, SCENE_ZONES.yardCam) ? 'yard' : 'yard2');
    }
  }

  W.stopById = (id) => id === 'depot' ? W.depot : id === 'wash' ? W.washBay : W.stops.find((s) => s.id === id) ||
    Object.values(W.places).find((p) => p.id === id) || W.sceneSpots.find((p) => p.id === id);
  // Road distance (world units, along the kerb-lane way, no U-turns) from stop a's bay, driving on in a's direction,
  // to stop b's bay approached in b's direction. a and b: stops (W.stops, W.depot, W.washBay) or their ids.
  // Cached. For jobs.js: pick nearer stops early on (W.stopsByDistance(from) lists them nearest first).
  const distCache = {};
  W.stopDistance = function (a, b) {
    a = typeof a === 'string' ? W.stopById(a) : a; b = typeof b === 'string' ? W.stopById(b) : b;
    if (!a || !b) return Infinity;
    if (a === b) return 0;
    const key = a.id + '>' + b.id;
    if (distCache[key] != null) return distCache[key];
    const ea = edgeById[a.edge], eb = edgeById[b.edge];
    let best = Infinity;
    if (ea === eb && a.dir === b.dir && (b.s - a.s) * a.dir > 0) best = Math.abs(b.s - a.s);
    const entry = b.dir > 0 ? eb.a : eb.b, tail = b.dir > 0 ? b.s : eb.length - b.s;
    const dist = {}, open = [];
    const push = (e, d, c) => { const k = e.id + (d > 0 ? '+' : '-'); if (dist[k] == null || c < dist[k]) { dist[k] = c; open.push({ e, d, k }); } };
    push(ea, a.dir, a.dir > 0 ? ea.length - a.s : a.s);
    while (open.length) {
      open.sort((p, q) => dist[p.k] - dist[q.k]);
      const it = open.shift(), c0 = dist[it.k];
      if (c0 >= best) break;
      const n = it.d > 0 ? it.e.b : it.e.a;
      if (n === entry && !(it.e === eb)) best = Math.min(best, c0 + tail);
      for (const id of nodeById[n].edges) {
        const e2 = edgeById[id]; if (e2 === it.e) continue;          // (no U-turns)
        if (e2.kind === 'yard' && ea.kind !== 'yard' && eb.kind !== 'yard') continue;   // (the yard is only for the depot)
        push(e2, e2.a === n ? 1 : -1, c0 + e2.length);
      }
    }
    return (distCache[key] = best);
  };
  W.stopsByDistance = function (from, list) {
    from = typeof from === 'string' ? W.stopById(from) : from;
    return (list || W.stops).filter((s) => s && s !== from).map((s) => ({ s, d: from ? W.stopDistance(from, s) : 0 })).sort((p, q) => p.d - q.d).map((o) => o.s);
  };


  // ---------- building the scene ----------
  // Draw calls: sky, ground, roads, town, green, lit windows, lamp heads, lamp pools, signs, train (+ its windows),
  // clouds, cars, birds: about 14 for the whole world.
  let train = null, trainWin = null, clouds = null, sky = null, cars = null, birds = null, pools = null;
  let seaGlints = null;
  let trainX = -200, trainDir = 1, trainWait = 0;
  let amb, hemi, sun, winMat, lampMat, poolMat, cloudMat;
  let WIN = null;                          // the lit-at-night windows builder (filled alongside the town)
  let TREES = null;                        // trees and lamp posts (their own mesh, so they can fade out of the way)
  // Props (trees, lamp posts) between the camera and the bus, or right by the camera, are hidden whole: each
  // prop's vertices carry its centre and size (aCenter) and the vertex shader drops the entire prop off screen.
  const fadeU = { uCam: { value: new THREE.Vector3(0, -999, 0) }, uBus: { value: new THREE.Vector3(0, -999, 0) }, uWedge: { value: 0 } };
  const PROPS = new Map();                 // builder -> [{s, e, x, z, r}] part ranges
  function propStart(b) { return b.parts.length; }
  function propEnd(b, s, x, z, r) { if (!PROPS.has(b)) PROPS.set(b, []); PROPS.get(b).push({ s, e: b.parts.length, x, z, r }); }
  // Build the aCenter attribute for a builder (call after b.geometry()/mesh(): b.counts = the vertices each part kept).
  function propAttr(b) {
    const counts = b.counts;
    const total = counts.reduce((a, c) => a + c, 0), arr = new Float32Array(total * 3).fill(1e5);
    const starts = []; let o = 0; for (const c of counts) { starts.push(o); o += c; }
    for (const pr of PROPS.get(b) || []) for (let k = pr.s; k < pr.e; k++) for (let v = 0; v < counts[k]; v++) { const q = (starts[k] + v) * 3; arr[q] = pr.x; arr[q + 1] = pr.z; arr[q + 2] = pr.r; }
    return new THREE.BufferAttribute(arr, 3);
  }
  function propMesh(b, mat, name) {
    const m = b.mesh(mat);
    m.geometry.setAttribute('aCenter', propAttr(b));
    return tag(m, name);
  }
  // Split a builder into square areas (CHUNK units a side, by each part's centre; a prop's parts by the prop's centre), so
  // the camera's frustum and the far cull skip whole areas instead of drawing the entire town every frame.
  // Returns the area builders (props remapped).
  function chunkBuilder(b, CHUNK) {
    const cells = new Map(), props = PROPS.get(b) || [], owner = new Int32Array(b.parts.length).fill(-1), _c = new THREE.Vector3();
    props.forEach((pr, i) => { for (let k = pr.s; k < pr.e; k++) owner[k] = i; });
    const open = new Map();                                     // prop index -> its start in its area builder
    b.parts.forEach((p, k) => {
      let x, z; const pi = owner[k];
      if (pi >= 0) { x = props[pi].x; z = props[pi].z; }
      else { const g = p.geo; if (!g.boundingBox) g.computeBoundingBox(); g.boundingBox.getCenter(_c).applyMatrix4(p.m); x = _c.x; z = _c.z; }
      const key = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
      let c = cells.get(key); if (!c) { c = BB.mk.builder(); c.trim = b.trim; c.pack = b.pack; cells.set(key, c); }
      if (pi >= 0 && !open.has(pi)) open.set(pi, c.parts.length);
      c.parts.push(p);
      if (pi >= 0 && k === props[pi].e - 1) { if (!PROPS.has(c)) PROPS.set(c, []); const pr = props[pi]; PROPS.get(c).push({ s: open.get(pi), e: c.parts.length, x: pr.x, z: pr.z, r: pr.r }); }
    });
    PROPS.delete(b); b.parts = [];
    return [...cells.values()];
  }
  // Add a builder to the scene as area meshes: frustum-culled, and hidden beyond farR of the camera (in the fog).
  function addChunked(scene, b, mat, name, prop, farR, size) {
    for (const c of chunkBuilder(b, size || 160)) {
      if (!c.parts.length) continue;
      const m = prop ? propMesh(c, mat, name) : tag(c.mesh(mat), name);
      m.geometry.computeBoundingBox(); m.userData.box = m.geometry.boundingBox.clone(); m.userData.farR = farR || 240;
      FAR_CULL.push(m); scene.add(m);
    }
  }
  function fadeMat(m) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCam = fadeU.uCam; sh.uniforms.uBus = fadeU.uBus; sh.uniforms.uWedge = fadeU.uWedge;
      sh.vertexShader = 'attribute vec3 aCenter; uniform vec3 uCam; uniform vec3 uBus; uniform float uWedge;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        if (aCenter.x < 9e4) {
          vec2 c = aCenter.xy; float rr = aCenter.z; bool hideMe = distance(c, uCam.xz) < rr + 3.0;
          vec3 ab = uBus - uCam; float l2 = max(dot(ab, ab), 1e-3);
          for (int k = 0; k < 2; k++) {
            vec3 p = vec3(c.x, k == 0 ? 2.0 : 5.0, c.y); float tt = clamp(dot(p - uCam, ab) / l2, 0.0, 1.0);
            if (tt > 0.02 && tt < 0.97 && distance(p, uCam + ab * tt) < rr + 1.2) hideMe = true;
          }
          // the stop view: everything standing in the wedge between the camera and the bus's near side goes
          if (uWedge > 0.0) {
            vec2 a2 = uBus.xz - uCam.xz; float L = max(length(a2), 1e-3); vec2 u = a2 / L, pc = c - uCam.xz;
            float al = dot(pc, u), lat = abs(pc.x * u.y - pc.y * u.x);
            if (al > -rr && al < L - 1.6 && lat < max(al, 0.0) * uWedge + rr + 1.0) hideMe = true;
          }
          if (hideMe) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
        }`);
    };
    return m;
  }
  const DECK_Y = 12;                       // underside of the MRT viaduct deck
  const VIADUCT_Z = g(1);

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
  function addCol(o) {
    // (every collider is stored with the same fields in the same order, so the hot loops below read them quickly)
    const c = { x: o.x, z: o.z, r: o.r, hw: o.hw, hd: o.hd, ry: o.ry, cos: 1, sin: 0, R: 0, top: o.top, y0: o.y0, sightOnly: !!o.sightOnly, deck: !!o.deck, _ps: 0, _ss: 0 };
    const R = c.r != null ? c.r : hypot2(c.hw, c.hd);
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
    addCol({ x: x + lx * c + lz * s + FRAME.x, z: z - lx * s + lz * c + FRAME.z, hw, hd, ry, top });
  }
  // While a landmark group is being built inside a moved frame (shifted()), FRAME holds that move, so colliders,
  // props and signs given in the group's own coordinates land in the right place.
  const FRAME = { x: 0, z: 0 };
  // (a circle with a top is a solid post or pillar: the cameras can't see through it; trees and lamp posts have none)
  W.addCircle = (x, z, r, top) => addCol(top != null ? { x: x + FRAME.x, z: z + FRAME.z, r, top } : { x: x + FRAME.x, z: z + FRAME.z, r });
  // Something the cameras can't see through but the bus drives under (a viaduct's or flyover's deck): a turned box
  // from y0 up to top, left out of driving (pushOut, solidAt).
  W.addSightBox = (x, z, hw, hd, ry, y0, top) => addCol({ x: x + FRAME.x, z: z + FRAME.z, hw, hd, ry, y0, top, sightOnly: true, deck: y0 > 2.5 });
  W.addBox = (x, z, hw, hd, ry = 0, top = 10) => addCol({ x: x + FRAME.x, z: z + FRAME.z, hw, hd, ry, top });
  function shifted(builders, dx, dz, fn) {
    FRAME.x += dx; FRAME.z += dz;
    const run = (i) => i === builders.length ? fn() : builders[i].at(dx, 0, dz, 0, () => run(i + 1));
    run(0);
    FRAME.x -= dx; FRAME.z -= dz;
  }
  W.MAP_R = 260;                               // (old: the bus stayed in a circle; now W.BOUNDS)
  // Push a circle (x,z,r) out of everything it overlaps. Returns {x, z, hit} (hit = how far it was pushed).
  const _push = { x: 0, z: 0, hit: 0 };
  let pushStamp = 0;                           // (marks colliders already handled this call: no new array each call)
  W.pushOut = function (x, z, r) {
    let hit = 0;
    const stamp = ++pushStamp;
    for (let pass = 0; pass < 2; pass++) {
      const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const list = grid.get(ckey(i + di, j + dj)); if (!list) continue;
        for (let n = 0, nl = list.length; n < nl; n++) {
          const c = list[n];
          if (c.sightOnly || (pass === 0 && c._ps === stamp)) continue; c._ps = stamp;
          const dx = x - c.x, dz = z - c.z;
          if (dx * dx + dz * dz > (c.R + r) * (c.R + r)) continue;
          if (c.r != null) {
            const d = hypot2(dx, dz), m = c.r + r - d;
            if (m > 0) { const ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0; x += ux * m; z += uz * m; hit += m; }
          } else {
            const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;      // into the box's frame
            const qx = lx < -c.hw ? -c.hw : lx > c.hw ? c.hw : lx, qz = lz < -c.hd ? -c.hd : lz > c.hd ? c.hd : lz;
            let ox = lx - qx, oz = lz - qz, d = hypot2(ox, oz), px, pz, m;
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
    // (the bounds are plain numbers here: this runs about 25 times a frame, and reading them from W.BOUNDS kept
    //  throwing Chrome's optimised code away, which made it some ten times slower)
    if (x < BX0 + r) { hit += BX0 + r - x; x = BX0 + r; } else if (x > BX1 - r) { hit += x - BX1 + r; x = BX1 - r; }
    if (z < BZ0 + r) { hit += BZ0 + r - z; z = BZ0 + r; } else if (z > BZ1 - r) { hit += z - BZ1 + r; z = BZ1 - r; }
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
  // Does a building (box collider), a solid post or pillar (a circle with a top) or a deck stand between two points?
  // Boxes are sampled every unit along the line against their footprints and heights; posts are tested exactly
  // (they are thin). Trees and lamp posts are left out: they fade instead. Used by the cameras.
  let sightStamp = 0;                          // (marks the posts already tested in this call)
  W.blocksSight = function (x0, y0, z0, x1, y1, z1) {
    const L = hypot2(x1 - x0, z1 - z0), n = Math.max(4, Math.ceil(L)), stamp = ++sightStamp;
    for (let k = 1; k < n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t;
      const list = grid.get(ckey(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!list) continue;
      for (let q = 0, ql = list.length; q < ql; q++) {
        const c = list[q];
        if (c.r != null) {
          if (c.top == null || c._ss === stamp) continue;
          c._ss = stamp;
          // the line's closest approach to the post's axis (in plan), and its height while inside the post
          const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1e-9;
          const tc = ((c.x - x0) * dx + (c.z - z0) * dz) / l2, cx = x0 + dx * tc - c.x, cz = z0 + dz * tc - c.z, d2 = cx * cx + cz * cz;
          if (d2 >= c.r * c.r) continue;
          const half = Math.sqrt((c.r * c.r - d2) / l2), ta = Math.max(0.02, tc - half), tb = Math.min(0.98, tc + half);
          if (ta > tb) continue;
          if (Math.min(y0 + (y1 - y0) * ta, y0 + (y1 - y0) * tb) < c.top) return true;
          continue;
        }
        if (y > c.top || (c.y0 != null && y < c.y0)) continue;
        const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.hw && Math.abs(lz) < c.hd) return true;
      }
    }
    return false;
  };
  // Does a building, a box or a solid post (a circle with a height: pillars, gate posts) stand within r of (x,z)?
  // (Trees and lamp posts don't count.)
  W.solidAt = function (x, z, r) {
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const list = grid.get(ckey(Math.floor(x / CELL) + di, Math.floor(z / CELL) + dj));
      if (!list) continue;
      for (const c of list) {
        const dx = x - c.x, dz = z - c.z;
        if (dx * dx + dz * dz > (c.R + r) * (c.R + r)) continue;
        if (c.sightOnly || (c.r == null && c.top < 0.5)) continue;    // (nor the stops' shelters: they hide too)
        if (c.r != null) { if (c.top != null) return true; continue; }
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.hw + r && Math.abs(lz) < c.hd + r) return true;
      }
    }
    return false;
  };
  // Is (x,z) under a flyover's or the viaduct's deck?
  W.underDeck = function (x, z) {
    const list = grid.get(ckey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    for (const c of list) {
      if (!c.deck) continue;
      const dx = x - c.x, dz = z - c.z;
      if (Math.abs(dx * c.cos - dz * c.sin) < c.hw + 1 && Math.abs(dx * c.sin + dz * c.cos) < c.hd + 1) return true;
    }
    return false;
  };
  W.insideTall = function (x, y, z) {
    const list = grid.get(ckey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    for (const c of list) {
      if (c.r != null || y > c.top) continue;
      const dx = x - c.x, dz = z - c.z;
      if (Math.abs(dx * c.cos - dz * c.sin) < c.hw + 0.8 && Math.abs(dx * c.sin + dz * c.cos) < c.hd + 0.8) return true;
    }
    return false;
  };
  W.viaduct = { z: VIADUCT_Z, deckY: DECK_Y, halfW: 4, x0: -185, x1: 185 };
  // Where the bus parks at a stop (or the depot): its nose 3 past the shelter, 1 toward the kerb from its lane.
  W.bayOf = function (st) {
    if (st._bay) return st._bay;
    if (st.edge == null && W.makeBay) W.makeBay(st);           // (a job target {pos, heading}: made into a bay first)
    const e = W.edge(st.edge), p = W.pointAt(e, st.s), off = C.lane + 0.45;
    const nx = p.x + st.side.x * off + st.fwd.x * 3, nz = p.z + st.side.z * off + st.fwd.z * 3;
    return (st._bay = { nose: { x: nx, z: nz }, x: nx - st.fwd.x * 7.2, z: nz - st.fwd.z * 7.2, heading: st.heading, fwd: st.fwd, side: st.side, len: 15.4, width: 3.4 });
  };

  W.build = function (scene) {
    W.scene = scene;
    scene.fog = new THREE.Fog(0xfbeed6, 95, 260);
    // the town is big now: nothing past the fog is drawn (the camera's far plane), the sky dome sits inside it
    if (BB.camera) { BB.camera.far = 380; BB.camera.updateProjectionMatrix(); }
    buildSky(scene);
    // soft, mostly flat light (paper-cut look): ambient + a little sky/ground + one gentle warm sun from the upper left
    amb = new THREE.AmbientLight(0xfff8ec, 0.5);
    hemi = new THREE.HemisphereLight(0xfff3dc, 0xb8a58a, 0.22);
    sun = new THREE.DirectionalLight(0xfff0d0, 0.4); sun.position.set(-60, 120, 45);
    scene.add(amb, hemi, sun);

    const ground = BB.mk.builder();
    ground.disc(720, 48, P.grass, 140, 0, 0);
    scene.add(tag(ground.mesh(), 'ground'));

    const roads = lean(BB.mk.builder()), town = lean(BB.mk.builder()), green = BB.mk.builder(), lamps = lean(BB.mk.builder());
    TREES = lean(BB.mk.builder());
    WIN = lean(BB.mk.builder());
    buildRoads(roads);
    buildBlocks(roads, green);
    buildStreetTrees(green);
    buildHDBs(town);
    buildLandmarks(town, green);
    buildViaduct(town, green);
    buildDistricts(green);
    // small stops whose shelter would stand in a building, a tree or a post are left out
    // (and so are those whose bay has anything in it, or that sit by the depot yard's fence)
    const blockedBay = (st) => { const bay = W.bayOf(st); for (const a of [-7, -3.5, 0, 3.5, 7]) if (W.pushOut(bay.x + bay.fwd.x * a, bay.z + bay.fwd.z * a, 1.7).hit > 0.02) return true; return false; };
    const nearYard = (st) => st.pos.x > W.YARD.x0 - 8 && st.pos.x < W.YARD.x1 + 8 && st.pos.z > W.YARD.z0 - 8 && st.pos.z < W.YARD.z1 + 8;
    // (nor those under a flyover's deck, where its piers and the deck would stand between the stop camera and the bus)
    const underDeck = (st) => { const bay = W.bayOf(st); for (const a of [-10, -5, 0, 5, 10]) for (const o of [0, 6, 12]) if (W.underDeck(bay.x + bay.fwd.x * a + bay.side.x * o, bay.z + bay.fwd.z * a + bay.side.z * o)) return true; return false; };
    for (let i = W.stops.length - 1; i >= 0; i--) { const st = W.stops[i]; if (st.minor && (W.pushOut(st.pos.x, st.pos.z, 1.8).hit > 0.05 || blockedBay(st) || nearYard(st) || underDeck(st))) W.stops.splice(i, 1); }
    buildStops(TREES);   // (with the props: the shelter hides when it stands between the stop camera and the bus)
    buildPlaces(town);
    const poolPts = buildLamps(town, lamps);
    fitSceneSpots((st) => blockedBay(st) || underDeck(st), nearYard);   // (after the trees and lamp posts, which don't make way for the scene spots)
    const meadow = lean(BB.mk.builder()); buildMeadow(meadow);   // (last, with its own random numbers: soft grass patches, flowers and bushes; nothing to bump into)
    roadMat = new THREE.MeshLambertMaterial({ vertexColors: true });   // its own material: it darkens in the rain
    for (const p of green.parts) town.parts.push(p);      // (same material: one draw per area)
    green.parts = [];
    addChunked(scene, roads, roadMat, 'roads', false, 205, 260); addChunked(scene, town, BB.mk.mat, 'town', false, 205, 130);
    scene.add(tag(meadow.mesh(roadMat), 'meadow'));   // (small and light, about 4,000 triangles: one mesh; darker when wet like the roads)
    const farMesh = (m, name) => { m.geometry.computeBoundingBox(); m.userData.box = m.geometry.boundingBox.clone(); FAR_CULL.push(m); scene.add(tag(m, name)); };
    for (const k in DIST_B) if (DIST_B[k].parts.length) farMesh(DIST_B[k].mesh(), 'd:' + k);
    washFx = buildWashFx();
    for (const k in LMB) { const lm = LMB[k].mesh(); lm.geometry.computeBoundingSphere(); farMesh(lm, 'lm:' + k); }
    for (const m of [wheelRim, planes, washRig, washFx].concat(LM_MOVERS)) if (m) scene.add(m);
    // the standing ones (the wash rig, the wheel, landmark movers) are far-culled too, by their box
    for (const m of [wheelRim, washRig].concat(LM_MOVERS)) if (m) { m.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(m); if (!bb.isEmpty()) { m.userData.box = bb; m.userData.farR = m === wheelRim ? 210 : 140; FAR_CULL.push(m); } }
    // (and the two moving planes: drawn only while the airfield is near enough to be seen through the haze)
    if (planes) { planes.userData.box = new THREE.Box3(new THREE.Vector3(216, 0, -345), new THREE.Vector3(546, 40, -300)); planes.userData.farR = 285; FAR_CULL.push(planes); }
    for (const m of [boomN, boomS]) if (m && !m.parent) scene.add(m);
    addChunked(scene, TREES, fadeMat(new THREE.MeshLambertMaterial({ vertexColors: true })), 'trees', true, 195, 240);
    TREES = null;
    winMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x000000 });
    addChunked(scene, WIN, winMat, 'windows', false, 200, 240);
    lampMat = fadeMat(new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xe9e4da }));
    scene.add(propMesh(lamps, lampMat, 'lamps'));
    pools = buildPools(poolPts); scene.add(pools);
    WIN = null;
    scene.add(buildSigns());
    train = buildTrain(); scene.add(train);
    clouds = buildClouds(); scene.add(clouds);
    seaGlints = buildSeaGlints(); scene.add(seaGlints);
    buildTownCars(); cars = buildCars(); scene.add(cars);
    birds = buildBirds(); scene.add(birds);
    scene.add(buildFolk());
    boats = buildBoats(); scene.add(boats);
    W.built = true;
    puddles = buildPuddles(); scene.add(puddles);
    rain = buildRain(); scene.add(rain);
    rainbow = buildRainbow(); scene.add(rainbow);
    W.built = true;
    W.setDayTime(W.day.t);
    W.prewarm();
  };
  // Compile every shader up front, including the ones only weather and night use (rain, puddles, rainbow, lamp
  // pools...), so the first shower doesn't stutter while they compile: hidden objects are shown for one compile.
  W.prewarm = function () {
    const R = BB.renderer, cam = BB.camera;
    if (!R || !cam || !W.scene || typeof R.compile !== 'function') return;
    const hidden = [];
    W.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try { R.compile(W.scene, cam); } catch (e) { console.error(e); }
    for (const o of hidden) o.visible = false;
  };
  const tag = (m, name) => { m.name = name; m.matrixAutoUpdate = false; m.updateMatrix(); return m; };
  // a builder for the static town: faces no camera can see are left out and the mesh is stored compactly (BB.mk, core.js)
  const lean = (b) => { b.trim = true; b.pack = true; return b; };
  const light = (c, t = 0.35) => '#' + new THREE.Color(c).lerp(new THREE.Color('#ffffff'), t).getHexString();
  const dark = (c, t = 0.2) => '#' + new THREE.Color(c).lerp(new THREE.Color('#3a2a3c'), t).getHexString();
  W.light = light; W.dark = dark;

  // ---------- sky: a gradient dome with a paper sun, a crescent moon and stars, following the play time ----------
  // share 0..1 = morning -> afternoon -> evening -> night (the hub's sky clock). Keyframes:
  // [share, top, middle, horizon(=fog), ambient colour, ambient, sun colour, sun, hemi, glow colour, glow]
  const SKY = [
    [0.00, '#5fb8ef', '#a6dcf6', '#ffe9d8', '#fff6ec', 0.48, '#fff0d8', 0.50, 0.22, '#ffc8c0', 0.30],
    [0.40, '#4fb1ea', '#9fd7f4', '#fbeed6', '#fff8ec', 0.48, '#fff0d0', 0.50, 0.22, '#ffe0b0', 0.00],
    [0.62, '#69b0e6', '#b9def2', '#ffe2a8', '#fff0dc', 0.47, '#ffe0b0', 0.49, 0.20, '#ffd27a', 0.25],
    [0.72, '#f0967a', '#ffbf8e', '#ffd27a', '#ffdcbc', 0.48, '#ffb27a', 0.44, 0.18, '#ffb070', 0.55],
    [0.80, '#c86a9e', '#ef8f9c', '#ffa07a', '#ecbccc', 0.43, '#ff9a8a', 0.30, 0.14, '#ff8c9c', 0.45],
    // (night is a soft moonlit blue, light enough that roads, pavements, people and the stops stay easy to see:
    // the owner found it too dark)
    [0.90, '#4a3f8f', '#86599e', '#c9789c', '#b4abdc', 0.52, '#c8aee6', 0.26, 0.14, '#d070a0', 0.25],
    [1.00, '#1c2154', '#2b3470', '#3f4b92', '#a9b4ea', 0.62, '#c4d0ff', 0.30, 0.16, '#3f4b92', 0.00],
  ];
  const skyU = {
    top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hor: { value: new THREE.Color() },
    glow: { value: new THREE.Color() }, glowAmt: { value: 0 }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunCol: { value: new THREE.Color('#ffd45c') }, sunAmt: { value: 1 }, moonDir: { value: new THREE.Vector3(0.4, 0.6, 0.7).normalize() },
    moonAmt: { value: 0 }, starAmt: { value: 0 }, time: { value: 0 },
    hill1: { value: new THREE.Color() }, hill2: { value: new THREE.Color() },   // two layers of far paper hills on the horizon
  };
  W.sky = { share: 0, target: 0, night: 0, evening: 0, lights: 0 };
  let roadMat = null, puddles = null, rain = null, rainbow = null;
  const wetU = { value: 1 };   // 1 dry, 0.76 soaked: the town walkers' and cars' ground shadows darken with the road
  function buildSky(scene) {
    const geo = new THREE.SphereGeometry(360, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `precision highp float;
        uniform vec3 top, mid, hor, glow, sunDir, sunCol, moonDir, hill1, hill2; uniform float glowAmt, sunAmt, moonAmt, starAmt, time;
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
          // layered paper hills all round the horizon (in front of the setting sun and the rising moon)
          if (y < 0.11) {
            float az = atan(d.x, d.z);
            float h1 = 0.052 + 0.026 * sin(az * 5.0 + 1.3) + 0.016 * sin(az * 9.0 + 4.0) + 0.005 * sin(az * 23.0);
            float h2 = 0.024 + 0.016 * sin(az * 7.0 + 2.1) + 0.010 * sin(az * 13.0 + 0.7);
            c = mix(c, hill1, smoothstep(h1 + 0.0012, h1 - 0.0012, y));
            c = mix(c, hill2, smoothstep(h2 + 0.0012, h2 - 0.0012, y));
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
    const lights = clamp01((ph - 0.72) / 0.24);                    // (full only in the ~30 s of real night)
    W.sky.night = night; W.sky.evening = evening; W.sky.lights = lights;
    if (W.scene && W.scene.fog) { W.scene.fog.color.copy(skyU.hor.value); W.scene.fog.near = 95 - 20 * night; W.scene.fog.far = 260 - 30 * night; }
    // the sun sets low in the west-south-west and rises in the east-north-east; the moon is opposite
    const el = 0.62 - 0.72 * clamp01(ph / 0.86), az = W.day && W.day.rising ? 0.9 : -2.25;
    skyU.sunDir.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    skyU.sunAmt.value = clamp01((el + 0.05) / 0.08);
    lerpCol(skyU.sunCol.value, '#ffd45c', '#ff8a3d', clamp01((ph - 0.5) / 0.3));
    skyU.moonAmt.value = clamp01((ph - 0.78) / 0.14); skyU.starAmt.value = clamp01((ph - 0.82) / 0.12);
    lerpCol(skyU.hill2.value, '#86c2ae', '#232a66', night).lerp(_c1.set(evening > 0 ? '#c9799a' : '#86c2ae'), evening * 0.6);
    skyU.hill1.value.copy(skyU.hill2.value).lerp(skyU.hor.value, 0.66 - 0.2 * night); skyU.hill2.value.lerp(skyU.hor.value, 0.46 - 0.2 * night);
    if (cloudMat) lerpCol(cloudMat.color, '#ffffff', ph < 0.85 ? '#ffc6b0' : '#5c6299', ph < 0.85 ? evening : night).lerp(_c1.set('#ffffff'), ph < 0.85 ? 0.25 : 0);
    if (winMat) winMat.emissive.set('#ffbf52').multiplyScalar(0.95 * lights);
    if (lampMat) lerpCol(lampMat.color, '#e9e4da', '#fff1b0', lights);
    if (poolMat) { poolMat.opacity = 0.55 * lights; pools.visible = lights > 0.02; }
    if (trainWin) trainWin.material = winMat;
  }
  // ---------- the day clock ----------
  // dayTime t 0..1: 0 dawn, ~0.25 midday, 0.5 sunset, 0.62 dusk, 0.7-0.92 night (windows, lamps, headlights), then
  // dawn again. A full day takes 1/speed seconds of play (6 minutes). In hub mode, with a minute of play time left,
  // it eases into the night and stays there (the bedtime cue); setSky(1) at goodnight does the same at once.
  W.day = { t: 0.12, speed: 1 / 360, bed: false, rising: false, auto: true };
  // The 6-minute day as [t, sky phase] keyframes (phase: 0 morning .. 0.62 afternoon .. 0.8 evening .. 1 night).
  // Full dark (lamps and lit windows at full) lasts about 30 s: sunset, a short dusk, the night, then dawn.
  const DAY_KEYS = [[0, 0.06], [0.6, 0.62], [0.7, 0.8], [0.75, 1], [0.82, 1], [0.85, 0.86], [0.89, 0.72], [0.93, 0], [1, 0.06]];
  const NIGHT0 = 0.755, NIGHT1 = 0.82;                             // the bedtime night holds inside these
  function phaseOf(t) {
    for (let i = 1; i < DAY_KEYS.length; i++) {
      const [t1, p1] = DAY_KEYS[i];
      if (t <= t1) { const [t0, p0] = DAY_KEYS[i - 1]; return p0 + (p1 - p0) * (t - t0) / (t1 - t0); }
    }
    return DAY_KEYS[0][1];
  }
  W.setDayTime = function (t) { W.day.t = ((+t || 0) % 1 + 1) % 1; dayDirty = true; };
  Object.defineProperty(W, 'dayTime', { get: () => W.day.t, set: (v) => W.setDayTime(v) });
  let dayDirty = true;
  // Old API: main.js calls setSky(share) from the hub's time messages. The day clock replaces the share-based sky;
  // share >= 1 (the goodnight moment) still means: night now.
  W.setSky = function (share, instant) {
    W.sky.target = clamp01(+share || 0);
    if (W.sky.target >= 0.999) { W.day.bed = true; if (instant || !W.built) W.setDayTime(0.78); }
  };
  function bedtime() { const H = BB.hub; return W.day.bed || !!(H && H.on && H.limit > 0 && H.left != null && H.left <= 60); }
  W.bedSky = bedtime;                    // (net.js: a friend's sky isn't copied while our own bedtime night shows)
  function updateDay(dt) {
    const d = W.day;
    if (bedtime()) {                                               // ease forward into the night and stay
      const inNight = d.t >= NIGHT0 && d.t <= NIGHT1;
      if (!inNight) { d.t = (d.t + dt * (d.t > NIGHT1 || d.t < 0.45 ? 0.03 : 0.02)) % 1; dayDirty = true; }
    } else if (d.auto) { d.t = (d.t + dt * d.speed) % 1; dayDirty = true; }
  }

  // ---------- weather ----------
  // sunny, cloudy, drizzle (light rain), rain, storm (soft rumble, a soft sky flash). Changes every 2-3 minutes with
  // smooth transitions; a rainbow sometimes follows the rain. setWeather(kind) picks one (auto changes continue
  // unless weatherAuto is false).
  const WX = { sunny: [0, 0, 0], cloudy: [0.7, 0, 0], drizzle: [0.8, 0.35, 0], rain: [1, 0.8, 0], storm: [1, 1, 1] };
  W.WEATHERS = Object.keys(WX);
  const wx = { kind: 'sunny', cloud: 0, rain: 0, storm: 0, wet: 0, bow: 0, bowT: 0, timer: rr(120, 180), flash: 0, nextFlash: 8, wasWet: false };
  W.weatherState = wx; W.weatherAuto = true;
  Object.defineProperty(W, 'weather', { get: () => wx.kind, set: (k) => W.setWeather(k) });
  W.setWeather = function (kind, instant) {
    if (!WX[kind]) return false;
    wx.kind = kind; wx.timer = rr(120, 180);
    if (instant) { [wx.cloud, wx.rain, wx.storm] = WX[kind]; wx.wet = wx.rain > 0.2 ? 1 : 0; }
    return true;
  };
  W.isRaining = () => wx.rain > 0.15;
  W.isStormy = () => wx.storm > 0.4;
  function updateWeather(dt) {
    if (W.weatherAuto && (wx.timer -= dt) <= 0) {
      const order = ['sunny', 'sunny', 'sunny', 'cloudy', 'cloudy', 'drizzle', 'rain', 'rain', 'storm'];
      let k; do { k = order[Math.floor(Math.random() * order.length)]; } while (k === wx.kind);
      W.setWeather(k);
    }
    const tg = WX[wx.kind], step = dt * 0.06;
    wx.cloud += BB.clamp(tg[0] - wx.cloud, -step, step);
    wx.rain += BB.clamp(tg[1] - wx.rain, -step * 1.3, step * 1.3);
    wx.storm += BB.clamp(tg[2] - wx.storm, -step, step);
    wx.wet += wx.rain > 0.15 ? Math.min(1 - wx.wet, dt * 0.1) : -Math.min(wx.wet, dt * 0.02);
    // a rainbow after the rain (sometimes), opposite the sun, by day
    if (wx.rain > 0.5) wx.wasWet = true;
    if (wx.wasWet && wx.rain < 0.08 && (wx.kind === 'sunny' || wx.kind === 'cloudy')) { wx.wasWet = false; if (Math.random() < 0.65) wx.bowT = 45; }
    wx.bowT = Math.max(0, wx.bowT - dt);
    const bowWant = wx.bowT > 0 && W.sky.night < 0.3 ? 0.55 : 0;
    wx.bow += BB.clamp(bowWant - wx.bow, -dt * 0.05, dt * 0.08);
    // storm: a soft flash now and then, and a gentle rumble a moment later
    wx.flash = Math.max(0, wx.flash - dt * 4);
    if (wx.storm > 0.6 && (wx.nextFlash -= dt) <= 0) { wx.flash = 1; wx.nextFlash = rr(8, 15); setTimeout(rumble, 700); }
  }
  function rumble() {
    const A = BB.audio, ctx = A && A.ctx;
    if (!ctx || ctx.state !== 'running' || A.mute || BB.held) return;
    try {
      const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      let v = 0; for (let i = 0; i < n; i++) { v = v * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = v * 6; }
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t0 = ctx.currentTime;
      f.type = 'lowpass'; f.frequency.value = 260; src.buffer = buf;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.09, t0 + 0.4); g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.9);
      src.connect(f); f.connect(g); g.connect(A.sfxBus || ctx.destination); src.start(t0); src.stop(t0 + 2);
    } catch (e) { /* no sound */ }
  }
  // After applySky(phase): grey the sky and dim the light with the clouds, rain, flashes; wet roads and puddles.
  const _grey = new THREE.Color();
  function weatherSky() {
    const c = wx.cloud, nightK = W.sky.night;
    _grey.set('#a7aeb8').multiplyScalar(0.3 + 0.7 * (1 - nightK));
    for (const u of [skyU.top.value, skyU.mid.value, skyU.hor.value]) u.lerp(_grey, c * 0.72);
    skyU.sunAmt.value *= 1 - c * 0.85; skyU.starAmt.value *= 1 - c; skyU.moonAmt.value *= 1 - c * 0.7; skyU.glowAmt.value *= 1 - c * 0.7;
    if (amb) { amb.intensity *= 1 - 0.16 * c; sun.intensity *= 1 - 0.55 * c; }
    if (wx.flash > 0) { const f = wx.flash * wx.flash; if (amb) amb.intensity += 0.45 * f; for (const u of [skyU.top.value, skyU.mid.value, skyU.hor.value]) u.lerp(_c1.set('#eef0ff'), 0.35 * f); }
    if (W.scene && W.scene.fog) { W.scene.fog.color.copy(skyU.hor.value); W.scene.fog.near = Math.max(30, W.scene.fog.near - 45 * wx.rain); W.scene.fog.far -= 100 * wx.rain; }
    if (cloudMat) { cloudMat.color.lerp(_grey, c * 0.6); cloudMat.opacity = 0.94; }
    if (clouds) clouds.scale.set(1 + 0.35 * c, 1 + 0.6 * c, 1 + 0.35 * c);
    if (roadMat) roadMat.color.setScalar(1 - 0.24 * wx.wet);
    wetU.value = 1 - 0.24 * wx.wet;
    if (puddles) { puddles.visible = wx.wet > 0.03; puddles.material.opacity = 0.5 * wx.wet; }
    if (rain) { rain.visible = wx.rain > 0.02; rain.material.uniforms.uAmount.value = wx.rain; rain.material.uniforms.uDark.value = nightK; }
    { const mist = 0.8 * Math.max(c * 0.8, wx.rain); skyU.hill1.value.lerp(skyU.hor.value, mist); skyU.hill2.value.lerp(skyU.hor.value, mist); }   // the hills sink into the mist
    if (seaGlints) seaGlints.material.uniforms.uAmt.value = (1 - nightK) * (1 - c * 0.8);
    if (rainbow) { rainbow.visible = wx.bow > 0.01; rainbow.material.opacity = wx.bow; }
    W.sky.lights = Math.max(W.sky.lights, wx.storm * 0.8);        // headlights and lamps on in a storm
    if (winMat && wx.storm > 0) winMat.emissive.set('#ffbf52').multiplyScalar(0.95 * W.sky.lights);
    if (lampMat) lerpCol(lampMat.color, '#e9e4da', '#fff1b0', W.sky.lights);
    if (poolMat) { poolMat.opacity = 0.55 * W.sky.lights; pools.visible = W.sky.lights > 0.02; }
  }
  // Rain: one LineSegments draw call; the streaks live in a box that wraps round the camera in the vertex shader.
  function buildRain() {
    const N = 1400, pos = new Float32Array(N * 6), end = new Float32Array(N * 2), rnd2 = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * 70, y = Math.random() * 34, z = Math.random() * 70, r0 = Math.random();
      pos.set([x, y, z, x, y, z], i * 6); end.set([0, 1], i * 2); rnd2.set([r0, r0], i * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1)); geo.setAttribute('aR', new THREE.BufferAttribute(rnd2, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uDark: { value: 0 } },
      transparent: true, depthWrite: false, fog: false,
      vertexShader: `uniform float uTime, uAmount; uniform vec3 uCam; attribute float aEnd, aR; varying float vA;
        void main() {
          vec3 p = position;
          float y = mod(p.y - uTime * 24.0 * (0.8 + 0.4 * aR), 34.0);
          vec3 w = vec3(uCam.x + mod(p.x - uCam.x, 70.0) - 35.0, uCam.y - 16.0 + y, uCam.z + mod(p.z - uCam.z, 70.0) - 35.0);
          w += vec3(0.25, 1.3, 0.1) * aEnd;
          vA = aR < uAmount ? 0.55 : 0.0;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
          if (aR >= uAmount) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
        }`,
      fragmentShader: `uniform float uDark; varying float vA; void main() { gl_FragColor = vec4(mix(vec3(0.86, 0.92, 1.0), vec3(0.6, 0.66, 0.85), uDark), vA); }`,
    });
    const m = new THREE.LineSegments(geo, mat); m.frustumCulled = false; m.visible = false; m.name = 'rain'; m.renderOrder = 4;
    return m;
  }
  // Puddles: soft sheens on the roads, shown while wet.
  function buildPuddles() {
    const b = BB.mk.builder();
    for (const e of W.roads.edges) for (let s = RH + 4; s < e.length - RH - 4; s += rr(9, 15)) {
      const p = W.pointAt(e, s), off = rpick([-1, 1]) * rr(1, RH - 1.5);
      b.disc(rr(0.9, 1.8), 9, rpick(['#b9cde0', '#a9c0d8', '#c7d8e8']), p.x + p.dz * off, ROAD_Y + 0.015, p.z - p.dx * off, rr(1, 2.2), rr(0.6, 1));
    }
    const m = new THREE.Mesh(b.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    m.name = 'puddles'; m.visible = false; m.renderOrder = 1;
    return m;
  }
  // A rainbow: seven soft bands on a half ring, far away opposite the sun; it follows the camera like the sky.
  function buildRainbow() {
    const geo = new THREE.RingGeometry(150, 175, 48, 7, 0, Math.PI), cols = ['#b58cff', '#6f8fff', '#5fc6ff', '#7ddc7a', '#ffe066', '#ffab4a', '#ff6b6b'];
    const pos = geo.attributes.position, col = [], c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) { const rr0 = hypot2(pos.getX(i), pos.getY(i)); c.set(cols[Math.min(6, Math.floor((rr0 - 150) / 25 * 7))]); col.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    m.name = 'rainbow'; m.visible = false; m.renderOrder = -9; m.frustumCulled = false;
    return m;
  }
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
  function zebra(b, from, to) {
    const e = W.edgeBetween(from, to), st = W.stops.concat([W.depot]).find((q) => q.edge === e.id);
    const s0 = RH + 4, s1 = e.length - RH - 4;
    let d = s0;
    if (st) { const bay = W.bayOf(st), bp = (bay.x - e.points[0].x) * (e.points[e.points.length - 1].x - e.points[0].x) + (bay.z - e.points[0].z) * (e.points[e.points.length - 1].z - e.points[0].z); d = bp / e.length > e.length / 2 ? s0 : s1; }
    const p = W.pointAt(e, d);
    b.at(p.x, ROAD_Y + 0.012, p.z, W.headingOf(p.dx, p.dz), (q) => {
      for (let k = -8; k <= 8; k++) q.box(0.62, 0.02, 3.2, '#fffaf0', k * 1.06, 0, 0);
    });
  }
  // The widest road meeting at a node (its junction square); 0 for a bend in one road (two edges).
  const nodeHalf = (n) => n.edges.length < 3 ? 0 : Math.max(...n.edges.map((id) => edgeById[id].half || RH));
  function buildRoads(b) {
    const YARD_COL = '#cfc7ba';
    for (const e of W.roads.edges) b.strip(e.points, -e.half, e.half, ROAD_Y, e.kind === 'yard' ? YARD_COL : P.road);
    for (const n of W.roads.nodes) {
      const hh = nodeHalf(n); if (!hh) continue;
      const yard = n.edges.every((id) => edgeById[id].kind === 'yard');
      b.box(hh * 2, 0.01, hh * 2, yard ? YARD_COL : P.road, n.x, ROAD_Y - 0.005, n.z);
    }
    for (const e of W.roads.edges) {
      const h0 = nodeHalf(nodeById[e.a]), h1 = nodeHalf(nodeById[e.b]), H = e.half;
      if (e.kind === 'yard') {                                // the yard: a dashed yellow aisle line only
        for (let s = h0 + 2; s < e.length - h1 - 2; s += 5) { const p = W.pointAt(e, s + 1.2); b.box(0.3, 0.02, 2.4, P.honey, p.x, ROAD_Y, p.z, W.headingOf(p.dx, p.dz)); }
        continue;
      }
      const inner = subPts(e, h0 + 0.4, e.length - h1 - 0.4);
      b.strip(inner, H - 0.75, H - 0.5, ROAD_Y + 0.008, '#efe6d2');                 // solid edge lines
      b.strip(inner, -H + 0.5, -H + 0.75, ROAD_Y + 0.008, '#efe6d2');
      const divs = e.kind === 'highway' ? [4.65, 8.75] : [C.laneDivider];
      for (let s = h0 + 2; s < e.length - h1 - 2; s += 5.5) {                          // dashed lane dividers
        const p = W.pointAt(e, s + 1.3), hh = W.headingOf(p.dx, p.dz);
        for (const dv of divs) for (const sd of [1, -1]) b.box(0.24, 0.02, 2.4, P.roadLine, p.x + p.dz * sd * dv, ROAD_Y, p.z - p.dx * sd * dv, hh);
      }
      const underViaduct = Math.abs(e.points[0].z - VIADUCT_Z) < 1 && Math.abs(e.points[e.points.length - 1].z - VIADUCT_Z) < 1;
      if (underViaduct) {                                    // planted median strip instead of dashes
        const a = W.pointAt(e, h0 + 4), z = W.pointAt(e, e.length - h1 - 4);
        const len = Math.abs(z.x - a.x), cx = (a.x + z.x) / 2;
        b.box(len, 0.3, 1.4, P.kerb, cx, 0, a.z);
        b.box(len - 0.4, 0.12, 1.0, P.grassDark, cx, 0.3, a.z);
        for (let x = cx - len / 2 + 2; x < cx + len / 2 - 1; x += 3) b.ball(0.5, rnd() < 0.5 ? '#ff7fb0' : '#5aa848', x, 0.55, a.z, 0, 1, 0.7, 1);
        continue;
      }
      const mid = subPts(e, h0 + 0.4, e.length - h1 - 0.4);
      if (e.kind === 'highway') {                            // a low concrete barrier down the middle
        b.strip(mid, -0.45, 0.45, ROAD_Y + 0.01, '#d9d2c6');
        for (let k = 0; k < mid.length - 1; k++) {
          const a = mid[k], c = mid[k + 1], l = hypot2(c.x - a.x, c.z - a.z);
          b.box(0.5, 0.8, l, '#e6e0d5', (a.x + c.x) / 2, 0, (a.z + c.z) / 2, Math.atan2(c.x - a.x, c.z - a.z));
        }
      } else { b.strip(mid, 0.12, 0.3, ROAD_Y + 0.008, '#f3d27a'); b.strip(mid, -0.3, -0.12, ROAD_Y + 0.008, '#f3d27a'); }
      // pavements: both sides of the outer roads, the outer side of the loop (the blocks are inside)
      const sides = e.kind === 'town' ? [] : [1, -1];
      if (e.kind === 'town' && e.points.length > 2 || ['n10-n20', 'n20-n10', 'n31-n32', 'n32-n31', 'n23-n13', 'n13-n23', 'n02-n01', 'n01-n02'].includes(e.a + '-' + e.b)) {
        const pm = W.pointAt(e, e.length / 2), lx = pm.dz, lz = -pm.dx;
        sides.push(hypot2(pm.x + lx * 12, pm.z + lz * 12) > hypot2(pm.x, pm.z) ? 1 : -1);
      }
      const ps = subPts(e, h0, e.length - h1);
      for (const sd of sides) {
        if (sd > 0) { b.strip(ps, H, H + 3, 0.2, P.pave); b.strip(ps, H, H + 0.5, 0.24, P.kerb); }
        else { b.strip(ps, -H - 3, -H, 0.2, P.pave); b.strip(ps, -H - 0.5, -H, 0.24, P.kerb); }
      }
    }
    // zebra crossings near the hawker centre, the playground, the shops, the park and the MRT station
    zebra(b, 'n10', 'n20'); zebra(b, 'n13', 'n23'); zebra(b, 'n01', 'n02'); zebra(b, 'n21', 'n22'); zebra(b, 'n11', 'n12');
    for (const st of W.stops.concat([W.depot, W.washBay, W.places.fireStation, W.places.clinic])) {
      const bay = W.bayOf(st), col = st.col || (st.id === 'depot' || st.id === 'wash' ? P.teal : P.honey), L = bay.len / 2;
      b.at(bay.x, ROAD_Y + 0.01, bay.z, bay.heading, (q) => {   // a yellow box outline on the road: the bus bay
        q.box(0.3, 0.02, bay.len, col, 1.6, 0, 0); q.box(0.3, 0.02, bay.len, col, -1.6, 0, 0);
        q.box(3.5, 0.02, 0.3, col, 0, 0, -L); q.box(3.5, 0.02, 0.3, col, 0, 0, L);
        for (let z = -L + 2; z <= L - 1.5; z += 2.4) q.box(2.8, 0.02, 0.25, light(col, 0.3), 0, 0, z, 0.6);   // hatching
      });
    }
  }

  const nearRing = () => false;   // (the old decorative ring road is gone: the cars drive on the expressway)
  W.nearRing = nearRing;

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
    if (inCamSpot(x + FRAME.x, z + FRAME.z)) return;   // keep the stop and garage camera views clear
    if (hypot2(x + FRAME.x, z + FRAME.z) < 200) W.addCircle(x, z, 0.9 * s);
    if (TREES) b = TREES;                     // trees go in their own mesh: hidden whole when they block the view
    const p0 = propStart(b);
    // (its soft shadow patch is part of it, so a tree hidden for the stop's side view leaves no green patch behind
    // on the pavement)
    b.disc(2.6 * s, 7, P.grassDark, x + 0.6, y0 + 0.02, z + 0.5, 1, 0.8);
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
    propEnd(b, p0, x + FRAME.x, z + FRAME.z, kind === 'rain' ? 4.3 * s : kind === 'flame' ? 3.6 * s : kind === 'palm' ? 3 * s : 2.4 * s);
    TREE_SPOTS.push([x + FRAME.x, z + FRAME.z, y0 + (kind === 'rain' ? 4.6 : kind === 'palm' ? 5.4 : 4.0) * s, (kind === 'rain' ? 3.6 : kind === 'palm' ? 1.6 : 2.4) * s]);
  }
  W.tree = tree;
  // Where the resting cameras stand (each stop's view, the garage views): no trees or lamp posts there.
  const CAM_SPOTS = (function () {
    const out = [];
    for (const st of allBays()) {
      const bay = W.bayOf(st), f = bay.fwd, k = bay.side, fcx = bay.x + f.x * 3.5, fcz = bay.z + f.z * 3.5;
      out.push([fcx + k.x * 11, fcz + k.z * 11, 5], [fcx + k.x * 15, fcz + k.z * 15, 4]);   // the stop view (side-on, from the pavement)
      if (st.id === 'depot') { out.push([bay.x - k.x * 28, bay.z - k.z * 28, 9], [bay.x - k.x * 16, bay.z - k.z * 16, 6], [fcx + f.x * 11 - k.x * 4.5, fcz + f.z * 11 - k.z * 4.5, 5], [fcx - k.x * 11, fcz - k.z * 11, 5]); }
    }
    return out;
  })();
  function inCamSpot(x, z) { for (const [cx, cz, r] of CAM_SPOTS) if (hypot2(x - cx, z - cz) < r) return true; return false; }
  // Is (x,z) clear of roads (and stops)? Used when scattering things.
  function clearOfRoads(x, z, margin) {
    for (const e of W.roads.edges) {
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1], c = e.points[i];
        const dx = c.x - a.x, dz = c.z - a.z, l2 = dx * dx + dz * dz;
        const t = BB.clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
        if (hypot2(a.x + dx * t - x, a.z + dz * t - z) < margin - RH + (e.half || RH)) return false;
      }
    }
    for (const st of allBays()) if (hypot2(st.pos.x - x, st.pos.z - z) < 7) return false;
    if (W.inDepotYard(x, z) || inReserved(x, z)) return false;
    return true;
  }
  W.clearOfRoads = clearOfRoads;
  function buildStreetTrees(b) {
    for (const e of W.roads.edges) {
      if (e.points.length > 2) continue;           // not along the loop's curves (they'd crowd the kerb lane there)
      if (e.kind === 'yard') continue;
      const step = e.kind === 'town' ? 11 : 26, off = e.half + 1.3;
      for (let s = junctionClear(e, e.a, 18); s < e.length - junctionClear(e, e.b, 15); s += step) {   // (not right at the junctions: a turning bendy's rear cuts in there)
        const p = W.pointAt(e, s);
        for (const side of [1, -1]) {
          const x = p.x + p.dz * side * off, z = p.z - p.dx * side * off;
          if (Math.abs(z - VIADUCT_Z) < RH + 4 && Math.abs(x) < 210) continue;
          if (inDepotYard(x, z)) continue;
          if (!clearOfRoads(x, z, RH + 1)) continue;
          if (allBays().some((st) => hypot2(st.pos.x - x, st.pos.z - z) < 9)) continue;
          if (x < -S - 2 && x > -S - 20 && Math.abs(z) < 20) continue;      // keep the shophouse fronts clear
          tree(b, x, z, hypot2(x, z) > 74 ? 0.2 : 0.27, 'round', 0.8);
        }
      }
    }
  }
  const inDepotYard = (x, z) => W.inDepotYard(x, z);
  // How far from an edge's end node street trees and lamp posts start: well clear of a junction (a turning bus swings
  // its front out and cuts in with its rear carriage there, on both sides), closer at a plain bend.
  function junctionClear(e, nid, base) {
    const n = nodeById[nid], extra = e.half - RH;
    return n && n.edges.length >= 3 ? Math.max(base, 32) + extra : base + extra;
  }
  // Areas kept for the new districts (no scattered trees or estates there): [x0, z0, x1, z1]
  const RESERVED = [
    [W.YARD.x0 - 2, W.YARD.z0 - 4, W.YARD.x1 + 2, W.YARD.z1 + 2],          // the depot
    [215, -330, 560, -205],                                                 // the airport
    [104, -172, 190, -36], [104, 40, 190, 96],                              // the city towers
    [-262, -160, -172, 160],                                                // old town (both sides of the west road)
    [-180, 200, 180, 400],                                                  // the waterfront, the beach and the sea
    [-60, -240, 120, -205],                                                 // the flyover
  ];
  const inReserved = (x, z) => RESERVED.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3]);
  W.inReserved = inReserved;

  // ---------- meadow details: soft grass patches, flower clumps and low bushes along the roads ----------
  // Paper scraps on the grass so the big lawns aren't one flat green. They keep their own random numbers (the town's
  // layout stays as it was), have no colliders, and are about 4,000 triangles in all, in one mesh of their own. Flat things may lie
  // anywhere on the grass; bushes stay 11 or more from the road edge, clear of the scenes staged by the kerb.
  let dseed = 24680;
  const drnd = () => { dseed = dseed + 0x6D2B79F5 | 0; let t = Math.imul(dseed ^ dseed >>> 15, 1 | dseed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const dr = (a, b) => a + drnd() * (b - a), dpick = (arr) => arr[Math.floor(drnd() * arr.length)];
  const PETALS = ['#ffffff', '#ffd45c', '#ff8fab', '#ff6b5c', '#c7a8f5', '#fff0a8'];
  // (the beach, the garden of tree towers and the wheel's pier stand in the sea's near strip)
  const onShore = (x, z) => (x > 48 && x < 192 && z < SZ + 60) || (Math.abs(x + 45) < 38 && z < SZ + 64) || (Math.abs(x + 122) < 25 && z < SZ + 66);
  function buildMeadow(b) {
    const DISC = new THREE.CircleGeometry(1, 6); DISC.rotateX(-Math.PI / 2);
    const BUD = new THREE.ConeGeometry(1, 1, 3, 1, true), BUSH = new THREE.OctahedronGeometry(1, 0);   // (kept very cheap: 3 and 8 triangles)
    const PATCH = [light(P.grass, 0.13), light(P.grass, 0.2), '#69b553', '#7fc862'], bays = allBays();
    let n = 0;
    for (const e of W.roads.edges) {
      if (e.kind === 'yard') continue;
      for (let s = 5; s < e.length - 5; s += 3.6) {
        const p = W.pointAt(e, s);
        for (const side of [1, -1]) {
          if (drnd() < 0.62) continue;                           // (fewer: keeps busy views within the triangle budget)
          const u = drnd(), off = e.half + 4.6 + u * u * 34, a = dr(-2, 2);
          const x = p.x + p.dz * side * off + p.dx * a, z = p.z - p.dx * side * off + p.dz * a;
          if (z > SZ + 8 || !clearOfRoads(x, z, RH + 4.4) || W.pushOut(x, z, 1.6).hit > 0.001 || inCamSpot(x, z)) continue;
          const y = W.groundY(x, z) ? 0.27 : 0, k = drnd(); n++;
          if (k < 0.46) {                                        // a paler or deeper scrap of grass
            // (never over the paving: a scrap near the road is made smaller, or left out, so that it stays 3.3 clear
            // of the road's edge and well clear of a stop's paving, since it is drawn a little above the ground)
            let r = dr(1.8, 4.6);
            const col = dpick(PATCH), rot = dr(0, 3.1), sx = dr(1, 1.7);
            const clear = (q) => { if (!clearOfRoads(x, z, RH + 3.3 + q * sx)) return false; for (const st of bays) if (hypot2(st.pos.x - x, st.pos.z - z) < 9 + q * sx) return false; return true; };
            while (r > 1 && !clear(r)) r *= 0.8;
            if (r > 1) b.add(DISC, col, x, y + 0.03, z, rot, 0, 0, r * sx, 1, r);
          } else if (k < 0.8 || off < e.half + 11) {             // a clump of flowers in one or two colours
            const c1 = dpick(PETALS), c2 = drnd() < 0.5 ? c1 : dpick(PETALS), m = 3 + Math.floor(drnd() * 3);
            for (let i = 0; i < m; i++) {
              const fa = i / m * 6.283 + dr(0, 0.8), fr = dr(0.25, 1.05), fs = dr(0.2, 0.3);
              b.add(BUD, i % 2 ? c2 : c1, x + Math.cos(fa) * fr, y + 0.2, z + Math.sin(fa) * fr * 0.75, dr(0, 1.5), 0, 0, fs, 0.36, fs);
            }
          } else {                                               // a low round bush, some in flower
            const r = dr(0.7, 1.15), col = dpick(TREE_GREENS);
            b.add(DISC, P.grassDark, x + 0.35, y + 0.035, z + 0.3, 0, 0, 0, r * 1.45, 1, r * 1.15);
            b.add(BUSH, col, x, y + r * 0.5, z, dr(0, 3), 0, 0, r, r * 0.72, r);
            if (drnd() < 0.25) b.add(BUSH, light(col, 0.16), x - r * 0.5, y + r * 0.62, z - r * 0.35, dr(0, 3), 0, 0, r * 0.55, r * 0.5, r * 0.55);
            if (drnd() < 0.35) { const c = dpick(PETALS); for (let i = 0; i < 3; i++) { const fa = i * 2.1 + dr(0, 1); b.add(BUD, c, x + Math.cos(fa) * r * 0.55, y + r * 0.95, z + Math.sin(fa) * r * 0.55, 0, 0, 0, 0.2, 0.3, 0.2); } }
          }
        }
      }
    }
    // the sea: pale paper wave streaks (static; the twinkles are buildSeaGlints)
    const sea = DIST_B.waterfront;
    if (sea) for (let i = 0; i < 150; i++) {
      const x = dr(-300, 420), z = SZ + 30 + dr(0, 1) * dr(0, 1) * 210;
      if (onShore(x, z)) continue;
      sea.add(DISC, i % 3 ? '#74c3e8' : '#8fd2ef', x, 0.1, z, 0, 0, 0, dr(4, 13), 1, dr(0.3, 0.65));
    }
    W.meadowCount = n;
  }
  // Sunlight twinkling on the sea: little diamonds that open and close in the vertex shader (one draw call, only
  // drawn near the waterfront, faded out at night and in the rain).
  function buildSeaGlints() {
    const N = 110, pos = new Float32Array(N * 18), off = new Float32Array(N * 12), ph = new Float32Array(N * 6);
    const Q = [[-1, 0], [0, 1], [1, 0], [-1, 0], [1, 0], [0, -1]];
    for (let i = 0; i < N; i++) {
      let x, z; do { x = dr(-230, 330); z = SZ + 30 + dr(0, 1) * dr(0, 1) * 150; } while (onShore(x, z));
      const s = dr(0.5, 1.1), f = dr(0, 6.283);
      for (let v = 0; v < 6; v++) { pos.set([x, 0.14, z], i * 18 + v * 3); off.set([Q[v][0] * s * 1.5, Q[v][1] * s * 0.6], i * 12 + v * 2); ph[i * 6 + v] = f; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aOff', new THREE.BufferAttribute(off, 2)); geo.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAmt: { value: 1 } }, transparent: true, depthWrite: false,
      vertexShader: 'attribute vec2 aOff; attribute float aPh; uniform float uTime; void main(){ float s = max(0.0, sin(uTime * 1.3 + aPh)); s = s * s * s; gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(aOff.x * s, 0.0, aOff.y * s), 1.0); }',
      fragmentShader: 'uniform float uAmt; void main(){ gl_FragColor = vec4(1.0, 1.0, 0.94, 0.85 * uAmt); }',
    });
    const m = new THREE.Mesh(geo, mat);
    m.name = 'seaGlints'; geo.computeBoundingBox(); m.userData.box = geo.boundingBox.clone(); m.userData.farR = 150; FAR_CULL.push(m);
    return m;
  }

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
    if (!far) BLDG.push({ x: x + FRAME.x, z: z + FRAME.z, ry, len, dep, H });
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
    if (!opt.far) BLDG.push({ x: x + FRAME.x, z: z + FRAME.z, ry, len: size, dep: size, H: H + 0.9 });
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
    BLDG.push({ x: x + FRAME.x, z: z + FRAME.z, ry, len, dep, H });
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
    // (the two long blocks run along their curve, facing out to it, and stand back from it, so a bendy bus cutting
    // the inside of the curve never meets a corner)
    const cIn = 25.4;                              // 35.9 from the curve's centre, along the diagonal
    hdb(b, g(1) - cIn, g(1) - cIn, -3 * Math.PI / 4, 20, 8, 9, 0, { people: 3, roof: 'flat' });
    tower(b, 43 * K, -43 * K, 0, 11, 12, 1);
    bayBlock(b, g(1) - cIn, g(2) + cIn, -Math.PI / 4, 20, 8, 10, 2);
    // outside the loop: estates in a mix of block types and colour schemes (clear of the connectors, the depot, the
    // city towers and old town)
    const spots = [];
    for (const k of [-60, -10, 40]) spots.push([(k + 8) * K, -100 * K, 0]);          // north row
    for (const k of [-60, -10]) spots.push([(k + 8) * K, 100 * K, 0]);                // south row (the depot is east)
    for (const k of [-58, 52]) spots.push([-100 * K, k * K, Math.PI / 2]);            // west
    spots.push([-128 * K, 8 * K, Math.PI / 2]);
    let si = 3;
    for (const [x, z, ry] of spots) {
      const r = rnd(), sc = si++;
      if (r < 0.28) tower(b, x, z, ry, 11, Math.round(rr(11, 15)), sc);
      else if (r < 0.55) bayBlock(b, x, z, ry, rr(22, 26), 8, Math.round(rr(9, 13)), sc);
      else hdb(b, x, z, ry, rr(24, 30), 8, Math.round(rr(9, 14)), sc);
      ESTATES.push([x, z]);
    }
    for (const [x, z] of [[-100 * K, 100 * K], [-100 * K, -100 * K]]) { tower(b, x, z, Math.PI / 4, 11, Math.round(rr(12, 16)), si++); ESTATES.push([x, z]); }
    // beyond the expressway and old town: taller blocks fading into the haze (simpler windows)
    for (const [x, z, a] of [[-150, -232, 0], [-110, -250, 0.4], [150, -236, 0], [190, -255, 0.3], [-290, -90, 1.2], [-292, 40, 1.4], [-285, 150, 1.5]]) {
      if (rnd() < 0.4) tower(b, x, z, a, 12, Math.round(rr(14, 19)), si++, { far: true });
      else hdb(b, x, z, a, rr(24, 30), 9, Math.round(rr(13, 18)), si++, { far: true, people: 0 });
    }
  }

  // ---------- landmarks ----------
  const SIGNS = [];          // extra picture boards on landmarks: {pic, x, y, z, nx, nz, size, ring}
  const sign = (s) => SIGNS.push(Object.assign({}, s, { x: s.x + FRAME.x, z: s.z + FRAME.z }));
  function buildLandmarks(b, green) {
    const all = [b, green, WIN, TREES], d = 46 * (K - 1);   // each group moves out with its (bigger) block
    shifted(all, 0, -d, () => hawkerCentre(b, green));
    shifted(all, -d, 0, () => shophouses(b, green));
    park(b, green);
    shifted(all, 0, d, () => playground(b, green));
    shifted(all, d, 0, () => mrtEntrance(b, green));
    tower(b, 43 * K, 43 * K, 0, 11, 13, 6);           // the south-east corner block (the old depot moved out to its yard)
    tree(green, 30 + RH + 6, 62, 0.27, 'rain'); tree(green, 62, 30 + RH + 6, 0.27, 'flame');
    // Scattered trees and a few palms outside the loop and in the corner blocks.
    for (let k = 0; k < 110; k++) {
      const a = rnd() * Math.PI * 2, r = rr(80, 190) * K;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearOfRoads(x, z, RH + 4)) continue;
      if (nearRing(x, z, 3)) continue;
      if (Math.abs(z - VIADUCT_Z) < 6) continue;
      if (nearBuilding(x, z)) continue;
      tree(green, x, z, 0, rnd() < 0.15 ? 'palm' : null, rr(0.9, 1.3));
    }
    for (const [x, z] of [[-34, -56], [-56, -32], [56, -32], [34, -58], [-56, 32], [-34, 56], [56, 34]]) if (clearOfRoads(x * K, z * K, RH + 3)) tree(green, x * K, z * K, 0.27, null, 1);
  }
  function nearBuilding(x, z) {
    for (const [bx0, bz0] of ESTATES) if (Math.abs(x - bx0) < 19 && Math.abs(z - bz0) < 19) return true;
    return false;
  }

  // Hawker centre (block north-middle, facing the road to the north): an open pavilion with a two-tier roof
  // and a louvred clerestory, a row of stalls with bright signboards, round tables with stools and people, and
  // umbrella tables on the plaza by the road. A bowl picture board stands on the roof.
  function hawkerCentre(b, green) {
    W.addBox(0, -45.5, 18, 12.6, 0, 1);      // the plaza (low: it doesn't block the cameras' view)
    W.addBox(0, -46, 14.6, 9.4, 0, 11);      // the pavilion
    A(b, 0, 0.25, -46, Math.PI, (q) => {            // local +z = toward the road (north)
      bx(q, 36, 0.12, 25, '#f1e2c6', 0, 0, -0.5);
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
      // umbrella tables on the plaza, at the sides of the pavilion (the road side stays open for the stop's view)
      const um = [P.coral, P.honey, P.teal, P.rose];
      for (let i = 0; i < 4; i++) {
        const x = i < 2 ? -16 : 16, z = i % 2 ? 5 : -3.5;
        q.cyl(0.8, 0.8, 0.1, 8, '#fbf7ee', x, 0.95, z); q.cyl(0.1, 0.1, 3.0, 5, '#7f8a96', x, 0.12, z);
        q.add(new THREE.ConeGeometry(2.3, 0.9, 8), um[i], x, 3.3, z);
        q.add(new THREE.ConeGeometry(2.32, 0.3, 8), light(um[i], 0.5), x, 2.95, z);
        for (const a of [0.3, 3.4]) q.cyl(0.28, 0.28, 0.5, 6, P.cream, x + Math.cos(a) * 1.3, 0.12, z + Math.sin(a) * 1.3);
        if (i % 2 === 0) figure(q, x + 1.3, 0.12, z + 0.4, -Math.PI / 2 - 0.3, true, 0.95);
      }
    });
    sign({ pic: 'bowl', x: 0, y: 0.25 + 12.3, z: -46, nx: 0, nz: -1, size: 3.4, ring: P.coral });
    tree(green, -16, -34, 0.27, 'rain'); tree(green, 15, -34, 0.27, 'flame');
  }

  // Shophouse row (block west-middle), facades facing the loop road to the west: bright two-storey shopfronts with a
  // shaded five-foot way, louvred shutters, white cornices, pediments, red lanterns, potted plants, a tiled roof.
  function shophouses(b, green) {
    W.addBox(-45.1, 0, 5.6, 17.6);              // (set back 9 from where it first stood: a wide pavement for the stop's side view)
    const walls = ['#ffc9a0', '#9fdcc4', '#ffb3c6', '#b9d2ff', '#ffe58a', '#ffbe98', '#cdbcff'];
    const shut = ['#2f9e7a', '#4f7fe0', '#19a79b', '#e0527a', '#8e62c8', '#2f9e7a', '#f28b4b'];
    for (let k = 0; k < 7; k++) {
      const z = -15 + k * 5.0, col = walls[k], sc = shut[k];
      A(b, -45, 0.25, z, -Math.PI / 2, (q) => {               // local +z = facing west (toward the road)
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
    for (const z of [-15, -5, 5, 15]) tree(green, -32, z, 0.27, z % 10 ? 'round' : 'flame');   // (a row of trees behind the shophouses)
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
    sign({ pic: 'train', x: 54.6, y: 0.25 + 4.6, z: -8.8, nx: -0.7, nz: 0.7, size: 2.2, ring: P.teal });
    for (const [x, z] of [[34, 8], [58, 8], [46, 12]]) tree(green, x, z, 0.27, 'rain', 0.9);
    figure(b, 41, 0.37, -7.5, 0.3, false); figure(b, 49, 0.37, -6.6, -2.6, false);
  }

  // Bus depot (block south-east): a big friendly garage with an arched teal roof, two round windows over a
  // wide door, a half-raised striped shutter, a fuel pump under a canopy and a washing brush.


  // ---------- MRT viaduct over the middle road (generic: cream concrete, no operator branding) ----------
  function buildViaduct(b, green) {
    const z = VIADUCT_Z, len = 370;
    b.box(len, 1.4, 6, '#ece3d6', 0, DECK_Y, z);
    // (the deck, its crossheads and the station hide what's behind them from the cameras: in pieces, for the grid)
    for (let x = -len / 2; x < len / 2 - 0.1; x += 37) W.addSightBox(x + 18.5, z, 18.5, 3.4, 0, DECK_Y - 1.3, DECK_Y + 2.3);
    W.addSightBox(S - 8, z, 8, 7.4, 0, DECK_Y, DECK_Y + 9.5); W.addSightBox(S + 8, z, 8, 7.4, 0, DECK_Y, DECK_Y + 9.5);
    b.box(len, 0.3, 6.4, '#d8cfc2', 0, DECK_Y - 0.1, z);
    b.box(len, 0.9, 0.4, '#e3dacd', 0, DECK_Y + 1.4, z - 2.9); b.box(len, 0.9, 0.4, '#e3dacd', 0, DECK_Y + 1.4, z + 2.9);
    b.box(len, 0.25, 0.25, '#a59a90', 0, DECK_Y + 1.4, z - 0.8); b.box(len, 0.25, 0.25, '#a59a90', 0, DECK_Y + 1.4, z + 0.8);
    // flower boxes along the parapets (pink bougainvillea)
    for (let x = -180; x <= 180; x += 8) for (const s of [-1, 1]) {
      if (Math.abs(x - S) < 18) continue;
      green.box(3.2, 0.6, 0.7, '#5aa848', x, DECK_Y + 0.6, z + s * 3.35);
      green.ball(0.55, (x / 6) % 2 ? '#ff7fb0' : '#ff9fc6', x - 0.7, DECK_Y + 1.15, z + s * 3.4, 0, 1.3, 0.6, 0.8);
      green.ball(0.5, '#ff6fa6', x + 0.8, DECK_Y + 1.1, z + s * 3.4, 0, 1.2, 0.6, 0.8);
    }
    for (const x of [-176, -136, -2 * S, -S, 0, S, 2 * S, 136, 176]) {
      W.addCircle(x, z, 1.05, DECK_Y);
      b.cyl(0.95, 1.05, DECK_Y - 1.2, 8, '#e3dacd', x, 0, z);
      b.box(2.4, 0.8, 2.4, '#d8cfc2', x, 0, z);
      b.box(6.8, 1.2, 2.4, '#e3dacd', x, DECK_Y - 1.3, z);
      b.prism(2.4, 6.8, 0.01, '#e3dacd', x, DECK_Y - 1.3, z, Math.PI / 2);
    }
    // the elevated station (over the east part of the middle road): platforms, glass sides, a curved roof
    b.box(32, 0.6, 13, '#ece3d6', S, DECK_Y + 1.4, z);
    b.box(32, 0.4, 2.2, P.honey, S, DECK_Y + 2.0, z - 5.2); b.box(32, 0.4, 2.2, P.honey, S, DECK_Y + 2.0, z + 5.2);
    for (const zz of [z - 6.3, z + 6.3]) {
      b.box(32, 1.2, 0.2, light(P.teal, 0.55), S, DECK_Y + 2.0, zz);
      for (let x = S - 15; x <= S + 15; x += 5) b.box(0.4, 5.4, 0.4, '#e9e2d6', x, DECK_Y + 2, zz);
    }
    const roof = new THREE.CylinderGeometry(7.6, 7.6, 34, 10, 1, true, 0, Math.PI);
    b.add(roof, P.teal, S, DECK_Y + 7.2, z, 0, 0, Math.PI / 2, 0.42, 1, 1);
    b.add(roof, '#16928a', S, DECK_Y + 7.2, z, 0, 0, Math.PI / 2, 0.42, 1, -1);           // its inside (seen from below)
    b.box(34, 0.4, 0.4, '#e9e2d6', S, DECK_Y + 7.0, z - 7.4); b.box(34, 0.4, 0.4, '#e9e2d6', S, DECK_Y + 7.0, z + 7.4);
    SIGNS.push({ pic: 'train', x: S, y: DECK_Y + 5.2, z: z + 6.45, nx: 0, nz: 1, size: 2.4, ring: P.teal });
    SIGNS.push({ pic: 'train', x: S, y: DECK_Y + 5.2, z: z - 6.45, nx: 0, nz: -1, size: 2.4, ring: P.teal });
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
      // a rounded driver's cab: a sloping nose with a big windscreen, headlights, the stripe carried round
      b.box(1.2, 1.5, 2.8, '#fbf8f1', nx + s * 0.1, 0.4, 0);
      b.box(1.25, 0.45, 2.85, P.coral, nx + s * 0.1, 0.95, 0);
      b.box(1.25, 0.18, 2.85, P.honey, nx + s * 0.1, 1.4, 0);
      b.box(0.7, 1.5, 2.6, '#fbf8f1', nx - s * 0.15, 1.9, 0);
      b.box(0.2, 1.35, 2.3, '#3f5f7d', nx + s * 0.32, 1.95, 0, 0, 0, -s * 0.38);     // windscreen, raked back
      b.box(0.22, 0.25, 2.3, '#e2ddd2', nx + s * 0.05, 3.25, 0, 0, 0, -s * 0.5);
      for (const z of [-0.95, 0.95]) { b.box(0.08, 0.2, 0.42, '#fff6c8', nx + s * 0.72, 0.62, z); b.box(0.08, 0.12, 0.26, '#ff6a4a', nx + s * 0.72, 0.38, z * 0.85); }
      b.box(0.1, 0.35, 0.9, '#5a5260', nx + s * 0.7, 0.1, 0);                         // coupler skirt
    }
    const m = b.mesh(); m.name = 'train';
    m.position.set(trainX, DECK_Y + 1.5, VIADUCT_Z + 1.4);
    trainWin = wb.mesh(winMat); m.add(trainWin);
    return m;
  }
  // Soft paper clouds: flat-bottomed clusters of puffs, white on top and a touch of lilac underneath.
  function buildClouds() {
    const b = BB.mk.builder();
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2 + rr(0, 0.4), r = rr(120, 260), y = rr(55, 90);
      const x = Math.cos(a) * r, z = Math.sin(a) * r, s = rr(0.8, 1.4);
      b.at(x, y, z, -a, (q) => {
        q.ball(9 * s, '#eef0fb', 0, 0, 0, 0, 2.4, 0.35, 1.1);
        for (let j = 0; j < 4; j++) q.ball(rr(4.5, 7) * s, '#ffffff', rr(-11, 11) * s, rr(1.5, 4) * s, rr(-3, 3) * s, 0, 1.2, 0.85, 1);
      });
    }
    // a ring of low cloud banks just above the far hills (the driving camera looks down, so these are the ones it sees)
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2 + dr(0, 0.45), r = dr(286, 312), y = dr(27, 44), s = dr(1.1, 1.8);
      b.at(Math.cos(a) * r, y, Math.sin(a) * r, -a + Math.PI / 2, (q) => {
        q.ball(8 * s, '#f1f2fb', 0, 0, 0, 0, 2.6, 0.32, 1);
        for (let j = 0; j < 3; j++) q.ball(dr(4, 6.5) * s, '#ffffff', (j - 1) * dr(7, 10) * s, dr(1.2, 3.2) * s, dr(-2, 2), 0, 1.25, 0.8, 1);
      });
    }
    cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.94 });
    const m = new THREE.Mesh(b.geometry(), cloudMat);
    m.name = 'clouds';
    return m;
  }

  // ---------- life: little cars on the outer road, birds ----------
  const CAR_N = 18, carState = [], CAR_X0 = -150, CAR_X1 = 552;   // cars on the expressway's outer and inner lanes
  const carU = { uNight: { value: 0 }, uWet: wetU };
  function buildCars() {
    const b = BB.mk.builder(), keep = [];
    // keep: 0 = painted in the car's own colour, 1 = stays as it is (glass, wheels), 2 = a lamp (glows at night),
    //       3 = the shadow on the road (darker when the road is wet)
    const box = (k, ...a) => { b.box(...a); keep.push(k); };
    box(0, 1.9, 0.75, 4.0, '#ffffff', 0, 0.35, 0);                 // body
    box(0, 1.95, 0.25, 4.05, '#d0d0d0', 0, 0.3, 0);                // a darker skirt
    box(0, 1.65, 0.7, 2.2, '#ffffff', 0, 1.1, -0.2);               // cabin
    box(1, 1.68, 0.48, 2.0, '#3c4a5a', 0, 1.18, -0.2);             // windows
    box(1, 1.5, 0.5, 0.06, '#3c4a5a', 0, 1.18, 0.92, 0, -0.5);     // windscreen
    box(1, 1.5, 0.45, 0.06, '#3c4a5a', 0, 1.18, -1.32, 0, 0.45);   // rear window
    for (const x of [-0.6, 0.6]) { box(2, 0.42, 0.2, 0.06, '#fff3c4', x, 0.7, 2.01); box(2, 0.36, 0.18, 0.06, '#ff3020', x, 0.7, -2.01); }   // head and tail lights
    box(1, 0.5, 0.14, 0.04, '#f0f0f0', 0, 0.42, 2.03);            // number plate
    const shadow = new THREE.CircleGeometry(1, 8); shadow.rotateX(-Math.PI / 2);
    b.add(shadow, '#645e69', 0, 0.05, 0, 0, 0, 0, 1.3, 1, 2.4); keep.push(3);          // a soft shadow on the road, just above its painted lines
    // wheels: a tyre and its outer face only (the inner face is never seen)
    const TYRE = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 8, 1, true), HUB = new THREE.CircleGeometry(0.38, 8);
    for (const [x, z] of [[-0.95, 1.3], [0.95, 1.3], [-0.95, -1.3], [0.95, -1.3]]) {
      b.add(TYRE, '#3a3440', x, 0.38, z, 0, 0, Math.PI / 2); keep.push(1);
      b.add(HUB, '#3a3440', x + Math.sign(x) * 0.15, 0.38, z, Math.sign(x) * Math.PI / 2); keep.push(1);
    }
    const geo = b.geometry(), counts = b.counts;
    let total = 0; for (let k = 0; k < counts.length; k++) total += counts[k];
    const aKeep = new Float32Array(total);
    for (let k = 0, o = 0; k < counts.length; k++) for (let v = 0; v < counts[k]; v++, o++) aKeep[o] = keep[k];
    geo.setAttribute('aKeep', new THREE.BufferAttribute(aKeep, 1));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (sh) => {      // only the bodywork takes the car's colour; the lamps glow once the street lamps are on
      sh.uniforms.uNight = carU.uNight; sh.uniforms.uWet = carU.uWet;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aKeep; uniform float uNight; uniform float uWet; varying float vGlow;')
        .replace('#include <color_vertex>', 'vColor = aKeep > 2.5 ? color * uWet : aKeep > 0.5 ? color : color * instanceColor; vGlow = aKeep > 1.5 && aKeep < 2.5 ? uNight : 0.0;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 1.3;');
    };
    // (the town's own cars come first in the mesh, then the expressway's: W.update draws only the first lot when the
    //  expressway is out of sight)
    const mesh = new THREE.InstancedMesh(geo, mat, TOWN_CARS + CAR_N);
    const cols = [P.coral, P.berry, P.honey, P.teal, '#f4f1ea', P.plum, P.mint, P.rose, '#4fa3e0'];
    for (let i = 0; i < TOWN_CARS; i++) mesh.setColorAt(i, new THREE.Color(cols[(i * 4 + 2) % cols.length]));
    for (let i = 0; i < CAR_N; i++) {
      mesh.setColorAt(TOWN_CARS + i, new THREE.Color(cols[i % cols.length]));
      carState.push({ s: CAR_X0 + (i / CAR_N) * (CAR_X1 - CAR_X0) + rr(0, 10), dir: i % 2 ? 1 : -1, lane: (i >> 1) % 2 ? 10.8 : 2.6, v: rr(8, 12) });
    }
    mesh.name = 'cars'; mesh.frustumCulled = false;
    return mesh;
  }
  const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _p4 = new THREE.Vector3(), _s4 = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
  const _rp = {};
  function busNear(x, z, r) {
    const B = BB.bus;
    if (!B || !B.front) return false;
    const a = B.front.position, b = B.rear.position, R = (r + 3) * (r + 3);
    return (a.x - x) * (a.x - x) + (a.z - z) * (a.z - z) < R || (b.x - x) * (b.x - x) + (b.z - z) * (b.z - z) < R;
  }
  // Cars glide along the expressway (east on the north side, west on the south side: drive on the left), keep a
  // gap to the car ahead, wait for the bus if it is in their lane just ahead, and fade in and out at the ends.
  function updateCars(dt) {
    const span = CAR_X1 - CAR_X0;
    for (let i = 0; i < CAR_N; i++) {
      const c = carState[i];
      let v = c.v;
      for (let oi = 0; oi < CAR_N; oi++) { const o = carState[oi]; if (o === c || o.dir !== c.dir || o.lane !== c.lane) continue;
        const gap = (((o.s - c.s) * c.dir) % span + span) % span;
        if (gap > 0 && gap < 12) v = Math.min(v, o.v * (gap / 12));
      }
      const z = HZ - c.dir * c.lane;
      if (busNear(c.s + c.dir * 8, z, 4.5) && !busNear(c.s, z, 2.5)) v = 0;
      for (let k = 0; k < TOWN_CARS; k++) {              // a town car crossing just ahead: let it through
        const t = townCars[k]; if (!t || t.gone) continue;
        const ah = (t.x - c.s) * c.dir;
        if (ah > 0 && ah < 12 && Math.abs(t.z - z) < 2.4) v = Math.min(v, c.v * BB.clamp((ah - 5) / 6, 0, 1));
      }
      c.s += c.dir * v * dt;
      if (c.s > CAR_X1) c.s -= span; else if (c.s < CAR_X0) c.s += span;
      const sc = BB.clamp(Math.min(c.s - CAR_X0, CAR_X1 - c.s) / 8, 0.01, 1);
      _q4.setFromAxisAngle(_up, c.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      _m4.compose(_p4.set(c.s, 0.03, z), _q4, _s4.set(sc, sc, sc));
      cars.setMatrixAt(TOWN_CARS + i, _m4);
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
      if (inCamSpot(x, z)) return;
      const s0 = propStart(TREES), s1 = propStart(lamps);
      TREES.cyl(0.13, 0.17, 5.4, 5, '#8f96a0', x, 0.25, z); W.addCircle(x, z, 0.3);
      const ax = Math.sin(h), az = Math.cos(h);
      TREES.box(0.14, 0.14, 1.6, '#8f96a0', x + ax * 0.7, 5.5, z + az * 0.7, h);
      lamps.box(0.55, 0.22, 0.9, '#ffffff', x + ax * 1.45, 5.3, z + az * 1.45, h);
      propEnd(TREES, s0, x + ax * 0.7, z + az * 0.7, 1.0); propEnd(lamps, s1, x + ax * 0.7, z + az * 0.7, 1.0);
      pts.push({ x: x + ax * 2.2, z: z + az * 2.2 });
    };
    for (const e of W.roads.edges) {
      if (e.points.length > 2) continue;           // none on the loop's curves (they'd stand in the inside lane's way)
      if (e.kind === 'yard') continue;
      for (let s = junctionClear(e, e.a, 20), k = 0; s < e.length - junctionClear(e, e.b, 15); s += e.kind === 'town' ? 24 : 34, k++) {
        const p = W.pointAt(e, s), side = k % 2 ? 1 : -1;
        const x = p.x + p.dz * side * (e.half + 0.7), z = p.z - p.dx * side * (e.half + 0.7);
        if (inDepotYard(x, z)) continue;
        if (allBays().some((st) => hypot2(st.pos.x - x, st.pos.z - z) < 8)) continue;
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
      if (st.minor) {                       // a small stop: paving, a pole with a little canopy, a bench, a bin
        addBoxAt(st.pos.x, st.pos.z, st.heading, 0.6, 0, 0.5, 1.6, 0.2);
        const p1 = propStart(b);
        b.at(st.pos.x, 0.25, st.pos.z, st.heading, (q) => {
          q.box(2.4, 0.06, 5.0, '#e3d6bc', 0.3, 0, 0);
          q.box(0.16, 2.7, 0.16, '#7f8a96', 0.9, 0, -1.4); q.box(0.16, 2.7, 0.16, '#7f8a96', 0.9, 0, 1.4);
          q.box(1.6, 0.14, 3.6, P.teal, 0.5, 2.7, 0);
          q.box(0.6, 0.12, 2.6, P.wood, 0.7, 0.85, 0);
          q.box(0.15, 3.7, 0.15, '#7f8a96', -0.9, 0, 2.6);
        });
        propEnd(b, p1, st.pos.x, st.pos.z, 3.0);
        continue;
      }
      addBoxAt(st.pos.x, st.pos.z, st.heading, 0.3, 0, 1.1, 4.1, 0.2);    // (top 0.2: the shelter hides from the cameras,
      addBoxAt(st.pos.x, st.pos.z, st.heading, -0.9, 4.6, 0.2, 0.2, 0.2); //  so it never blocks their sight lines)
      const p0 = propStart(b);
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
      propEnd(b, p0, st.pos.x, st.pos.z, 4.4);
    }
  }
  // The fire station and the clinic, set back on the kerb side of their bays (local +z = the bay's travel direction,
  // +x = away from the road), with an apron or path to the pavement and a picture board facing the road.
  function buildPlaces(b) {
    const sign = (pl, lx, y, lz, size, ring) => {
      const c = Math.cos(pl.heading), sn = Math.sin(pl.heading);
      SIGNS.push({ pic: pl.pic, x: pl.pos.x + lx * c + lz * sn, y, z: pl.pos.z - lx * sn + lz * c, nx: -pl.side.x, nz: -pl.side.z, size, ring });
    };
    const F = W.places.fireStation, RED = '#e8463a', CREAM = '#fff6e0';
    b.at(F.pos.x, 0, F.pos.z, F.heading, (q) => {
      q.box(21, 0.14, 26, '#cfc6b8', 10.5, 0.02, 0);                                // the apron
      q.at(6, 0, 0, 0, (q) => {                                                      // (set back 6 more: room for the camera)
      q.box(14, 8, 22, CREAM, 21, 0, 0);                                             // the engine house
      q.box(14.6, 1.2, 22.6, RED, 21, 8, 0);                                         // red parapet
      for (const z of [-5.5, 5.5]) {                                                 // two big red doors with windows
        q.box(0.3, 6, 8.6, RED, 13.9, 0, z);
        for (let k = 0; k < 4; k++) q.box(0.32, 0.12, 8.6, dark(RED, 0.15), 13.85, 1 + k * 1.4, z);
        q.box(0.34, 0.9, 7, '#a9d6ec', 13.83, 4.6, z);
      }
      q.box(0.4, 8, 0.8, CREAM, 13.8, 0, 0);
      q.box(5, 15, 5, CREAM, 25.5, 0, -8.5); q.box(5.6, 1, 5.6, RED, 25.5, 15, -8.5);   // the hose tower
      for (const y of [4, 8, 12]) q.box(0.2, 1.2, 1.6, '#a9d6ec', 22.9, y, -8.5);
      q.cyl(0.6, 0.6, 1.2, 8, '#ffd45c', 25.5, 16, -8.5);                             // a little bell on top
      });
      q.box(0.5, 1.1, 0.5, RED, 3.2, 0, 9.5); q.cyl(0.32, 0.32, 0.25, 8, '#ffd45c', 3.2, 1.1, 9.5);   // a hydrant
    });
    addBoxAt(F.pos.x, F.pos.z, F.heading, 27, 0, 7, 11, 9); addBoxAt(F.pos.x, F.pos.z, F.heading, 31.5, -8.5, 2.6, 2.6, 16);
    sign(F, 19.6, 7.2, 0, 3.4, RED);
    const H = W.places.clinic, MINT = '#d3efe2';
    b.at(H.pos.x, 0, H.pos.z, H.heading, (q) => {
      q.box(20, 0.12, 4, '#e4d6bd', 10, 0.02, 0);                                    // the path in
      q.at(6, 0, 0, 0, (q) => {
      q.box(16, 6.5, 24, '#fbfbf6', 22, 0, 0);                                       // the clinic
      q.box(16.4, 0.8, 24.4, MINT, 22, 6.5, 0);
      q.box(0.3, 3, 4, '#a9d6ec', 13.9, 0.2, 0);                                     // glass doors
      q.box(3, 0.3, 6, '#7fd1c3', 12.6, 3.4, 0);                                     // a canopy
      for (const z of [-8, -4, 4, 8]) q.box(0.3, 1.6, 2.6, '#a9d6ec', 13.9, 2.6, z);
      for (const z of [-9, 9]) { q.cyl(1.4, 1.6, 0.6, 8, '#e3d6bc', 10, 0, z); q.ball(1.3, '#6fc45a', 10, 1.4, z, 0); }   // planters
      });
    });
    addBoxAt(H.pos.x, H.pos.z, H.heading, 28, 0, 8, 12, 7);
    sign(H, 19.7, 5.0, -6, 2.6, '#ff8fab');
  }
  // Picture signs: one atlas texture, one mesh, both faces. Stops' pole signs, the depot board and the landmark boards.
  // The rounded corners are cut with alphaTest (no black corners).
  function buildSigns() {
    const list = W.stops.map((st) => {
      const al = st.minor ? 2.6 : 4.6, cx = st.pos.x - st.side.x * 0.9 + st.fwd.x * al, cz = st.pos.z - st.side.z * 0.9 + st.fwd.z * al;
      return { pic: st.pic, x: cx, y: 0.25 + 3.55, z: cz, nx: -st.fwd.x, nz: -st.fwd.z, size: 2.2, ring: P.honey, stop: true };
    });
    for (const s of SIGNS) list.push(s);
    // one atlas cell per different picture (and ring colour): many stops share a few pictures
    const cells = [], cellOf = new Map();
    for (const st of list) { const key = st.pic + '|' + st.ring; if (!cellOf.has(key)) { cellOf.set(key, cells.length); cells.push(st); } st.cell = cellOf.get(key); }
    const cell = 128, cv = document.createElement('canvas');
    cv.width = cell * cells.length; cv.height = cell;
    const x = cv.getContext('2d');
    cells.forEach((st, i) => {
      const X = i * cell;
      x.beginPath(); x.roundRect ? x.roundRect(X + 3, 3, cell - 6, cell - 6, 24) : x.rect(X + 3, 3, cell - 6, cell - 6);
      x.fillStyle = st.ring; x.fill();
      x.beginPath(); x.roundRect ? x.roundRect(X + 11, 11, cell - 22, cell - 22, 17) : x.rect(X + 11, 11, cell - 22, cell - 22);
      x.fillStyle = '#fffaf0'; x.fill();
      x.drawImage(BB.pic(st.pic, 96), X + 18, 18, 92, 92);
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    const pos = [], uv = [], cen = [];
    list.forEach((st, i) => {
      const { x: cx, y: cy, z: cz, nx, nz, size } = st;
      for (let k = 0; k < 12; k++) cen.push(st.stop ? cx : 1e5, cz, 1.1);   // stop signs hide when they block the stop view
      const rx = nz, rz = -nx;          // right along the board as seen from its front
      const u0 = (st.cell + 0.004) / cells.length, u1 = (st.cell + 0.996) / cells.length, h = size / 2;
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
    geo.setAttribute('aCenter', new THREE.Float32BufferAttribute(cen, 3));
    const m = new THREE.Mesh(geo, fadeMat(new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.FrontSide })));
    m.name = 'signs';
    return m;
  }

  // ---------- the wider map: the depot yard, the expressway, the airport, the city, old town, the waterfront ----------
  // All static, merged into one vertex-coloured mesh ('districts'); lit windows go into WIN, trees and lamps into
  // TREES (they fade out of the cameras' way). Landmark models come from BB.landmarks (js/landmarks.js) when it is
  // loaded: each builder is called as BB.landmarks.<name>(q, opts) with q a BB.mk builder already placed and turned
  // (local +z faces the road), drawing static parts into q (opts.win: the lit-windows builder in the same frame).
  // Without it (or if one throws) the simple models below are used. Everything is generic: no names or logos.
  const LMB = {};                          // landmark batches, one per district area (each one draw call, culled when out of view)
  let curDist = 'misc';
  const LM_MOVERS = [];
  // Place landmark `name` at (x, z) turned ry (its front, +z, toward ry): merged into the batch, its colliders added,
  // its moving parts kept for the scene. Returns its info, or null (no kit, or it failed: use the simple model).
  function LMP(name, x, z, ry, ...args) {
    const L = BB.landmarks;
    if (!L || typeof L[name] !== 'function' || typeof L.batch !== 'function') return null;
    try {
      // (one batch per district and area, so a big district's landmarks are culled area by area)
      const key = curDist + '@' + Math.floor((x + FRAME.x) / 200) + ',' + Math.floor((z + FRAME.z) / 200);
      const bt = LMB[key] || (LMB[key] = L.batch());
      if (bt.kit && bt.kit.b) lean(bt.kit.b);
      const info = bt.add(name, x, z, ry, ...args);
      for (const c of info.circles || []) addCol({ x: c.x, z: c.z, r: c.r, top: Math.min(14, info.height || 8) });   // (solid: no fading)
      if (name === 'chinatownRow') {          // the upper floor over the arcade: the cameras can't see through it either
        const n = args[0] || 4, c = Math.cos(ry), sn = Math.sin(ry), lz = 6 - 1.1;
        addCol({ x: x + lz * sn + FRAME.x, z: z + lz * c + FRAME.z, hw: n * 2.6, hd: 1.3, ry, y0: 3.9, top: 11.3, sightOnly: true });
      }
      if (name === 'elevatedRoad' && Array.isArray(info.path) && !x && !z && !ry) {        // its deck, for the cameras
        const P2 = info.path, hw = (info.width || 9) / 2;
        for (let i = 1; i < P2.length; i += 2) {
          const a = P2[i - 1], c = P2[Math.min(P2.length - 1, i + 1)], len = hypot2(c.x - a.x, c.z - a.z);
          if (len < 0.1 || Math.max(a.y, c.y) < 1) continue;
          addCol({ x: (a.x + c.x) / 2, z: (a.z + c.z) / 2, hw, hd: len / 2 + 0.3, ry: Math.atan2(c.x - a.x, c.z - a.z), y0: Math.min(a.y, c.y) - 1.4, top: Math.max(a.y, c.y) + 1.2, sightOnly: true, deck: Math.min(a.y, c.y) > 2.5 });
        }
      }
      for (const o of info.boxes || []) addCol({ x: o.x, z: o.z, hw: o.hw, hd: o.hd, ry: o.ry || 0, top: o.top != null ? o.top : 10 });
      if (info.movers) LM_MOVERS.push(info.movers);
      return info;
    } catch (e) { console.error('[landmarks] ' + name, e); return null; }
  }
  const LM = () => false;                  // (the old in-builder form: the kit now places whole models with LMP)
  const TREE_SPOTS = [], BLDG = [];        // for the Christmas lights: tree crowns, building roof outlines
  const XMAS_TREES = [];                   // where the big Christmas trees stand [x, z, height]
  let wheelRim = null, planes = null, boomN = null, boomS = null, washRig = null, washFx = null;
  const planeState = [];

  // a cheap parked bus (no faces): body, glass band, roof, wheels; type 'single' | 'double' | 'bendy'
  function cheapBus(q, type, col) {
    const L = type === 'bendy' ? 7.2 : 10.8, H = type === 'double' ? 4.3 : 3.0;
    const body = (z0, len) => {
      bx(q, 2.5, H - 0.4, len, col, 0, 0.4, z0);
      bx(q, 2.56, 0.9, len - 0.6, '#3d4f60', 0, 1.35, z0);
      if (type === 'double') bx(q, 2.56, 0.9, len - 0.6, '#3d4f60', 0, 2.95, z0);
      bx(q, 2.3, 0.25, len * 0.4, '#f1ebe0', 0, H, z0 - len * 0.1);
      bx(q, 2.6, 0.18, len, '#fff6e0', 0, 1.0, z0);
      for (const z of [z0 + len / 2 - 1.8, z0 - len / 2 + 2]) for (const sx of [-1.2, 1.2]) q.cyl(0.5, 0.5, 0.36, 8, '#3a3440', sx, 0.5, z, 0, 0, Math.PI / 2);
    };
    if (type === 'bendy') { body(4.1, L); body(-4.0, 6.4); bx(q, 2.3, 2.4, 1.0, '#4a4250', 0, 0.5, 0.0); } else body(0, L);
    bx(q, 2.3, 0.5, 0.1, '#f7d36a', 0, 0.55, (type === 'bendy' ? 4.1 + L / 2 : L / 2) + 0.02);
  }

  // ---- the bus depot: an open-air yard with painted bays, parked buses, a fuel island, a drive-through wash, a big
  // open workshop where the bus is made beautiful, a gatehouse and boom gates at both gates ----
  function buildDepot(b) {
    const Y = W.YARD, cx = (Y.x0 + Y.x1) / 2, cz = (Y.z0 + Y.z1) / 2;
    b.box(Y.x1 - Y.x0, 0.03, Y.z1 - Y.z0, '#d6cec1', cx, 0.005, cz);                       // the yard's concrete
    // fence round the yard (low, so the cameras look over it), open at the two gates
    const fence = (x0, z0, x1, z1) => {
      const len = hypot2(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      b.box(0.12, 1.5, len, '#5aa848', mx, 0, mz, ry); b.box(0.16, 0.12, len, '#3f8a3a', mx, 1.5, mz, ry);
      for (let k = 0; k <= Math.floor(len / 4); k++) { const t = k / Math.max(1, Math.floor(len / 4)); b.box(0.18, 1.7, 0.18, '#3f8a3a', x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t); }
      W.addBox(mx, mz, Math.abs(x1 - x0) / 2 + 0.2, Math.abs(z1 - z0) / 2 + 0.2, 0, 1.4);
    };
    // (the south fence has a gap at the wash, so its show can be watched from the waterfront)
    // (the south-east corner follows the outer road's curve, so the fence never stands on the road)
    const CR0 = 28.6, ccx = OX - CR, ccz = SZ - CR, aS = Math.asin((Y.z1 - ccz) / CR0), aE = Math.acos((Y.x1 - ccx) / CR0);
    fence(Y.x0, Y.z0, Y.x1, Y.z0); fence(Y.x0, Y.z1, 58, Y.z1); fence(100, Y.z1, ccx + CR0 * Math.cos(aS), Y.z1); fence(Y.x1, Y.z0, Y.x1, ccz + CR0 * Math.sin(aE));
    for (let k = 0; k < 12; k++) { const a0 = aS + (aE - aS) * k / 12, a1 = aS + (aE - aS) * (k + 1) / 12; fence(ccx + CR0 * Math.cos(a0), ccz + CR0 * Math.sin(a0), ccx + CR0 * Math.cos(a1), ccz + CR0 * Math.sin(a1)); }
    b.box(42, 0.35, 0.5, P.kerb, 79, 0, Y.z1);
    fence(Y.x0, Y.z0, Y.x0, 112); fence(Y.x0, 140, Y.x0, 154);
    // the middle island: painted bays and a row of parked buses (all three kinds), nose to the north aisle
    b.box(70, 0.06, 18.4, '#c9c1b3', 81, 0, 147);
    const types = ['single', 'double', 'bendy', 'single', 'double', 'single', 'bendy'], cols = ['#3fae49', '#ef5a4b', '#3d8fe0', '#f5b83d', '#3fae49', '#8e62c8', '#ef5a4b'];
    for (let i = 0; i < 7; i++) {
      const x = 52 + i * 9.4;
      for (const sx of [-1.9, 1.9]) b.box(0.18, 0.02, 15.5, '#fff6e0', x + sx, 0.06, 147);
      if (PARK_START.includes(i)) continue;                 // (kept empty: the child's bus starts here)
      if (LMP('parkedBus', x, 147, Math.PI, types[i], cols[i])) continue;
      b.at(x, 0.06, types[i] === 'bendy' ? 146 : 147.5, Math.PI, (q) => cheapBus(q, types[i], cols[i]));
      W.addBox(x, 147, 1.4, types[i] === 'bendy' ? 8.8 : 6.0, 0, 4.5);
    }
    // the gatehouse on the island's west end, boom gates across both aisles
    const lmGate = LMP('gatehouse', 42, 147, Math.PI / 2);
    if (!lmGate) b.at(42, 0.06, 147, 0, (q) => {
      q.box(4.2, 2.8, 5.2, '#fff6e0', 0, 0, 0); q.box(4.6, 0.4, 5.6, P.teal, 0, 2.8, 0);
      q.box(0.06, 1.0, 3.6, '#9fd3e8', 2.12, 1.2, 0); q.box(3.0, 1.0, 0.06, '#9fd3e8', 0, 1.2, 2.62); q.box(3.0, 1.0, 0.06, '#9fd3e8', 0, 1.2, -2.62);
      for (const z of [-9.8, 9.8]) { q.box(0.5, 1.1, 0.5, '#e9e2d6', 0, 0, z); q.box(0.6, 0.3, 0.6, P.coral, 0, 1.1, z); }
    });
    if (!lmGate) W.addBox(42, 147, 2.3, 2.9, 0, 3.4);
    const lbN = LMP('boomGate', 42, 137.6, Math.PI / 2, 17.4), lbS = LMP('boomGate', 42, 156.4, -Math.PI / 2, 17.4);
    if (lbN && lbS && lbN.movers && lbS.movers) { boomN = lbN.movers; boomS = lbS.movers; boomN.userData.lm = boomS.userData.lm = true; }
    const boomArm = (dir) => {
      const q = BB.mk.builder();
      for (let k = 0; k < 8; k++) q.box(0.16, 0.16, 2.0, k % 2 ? '#ef4b3c' : '#ffffff', 0, -0.08, dir * (k * 2.0 + 1.0));
      const m = q.mesh(); m.position.set(42, 1.3, 147 + dir * 10.1); m.name = 'boom'; return m;
    };
    if (!boomN) { boomN = boomArm(-1); boomS = boomArm(1); }
    // the fuel island on the kerb side of the north aisle, under a canopy: one coral pump facing the aisle, so a bus
    // pulls up beside it in its pump bay (W.pumpBay) and the child carries the nozzle over (jobs.js). The nozzle and
    // its hose are jobs.js's own (they move); the pump has a little holster on its back where the nozzle hangs.
    {
      const PU = W.pump, ix = PU.x - 2.9, iz = PU.z;        // (the island runs on west of the pump: the fuel cap stops east of it, in the open)
      b.box(7.2, 0.3, 2.2, '#e9e2d6', ix, 0.04, iz); b.box(7.3, 0.08, 2.3, P.honey, ix, 0.34, iz);
      // the pump: a coral body with a cream screen on the aisle side, a darker cap, a grey holster on the back
      b.box(0.9, 1.9, 0.8, P.coral, PU.x, 0.42, iz); b.box(0.96, 0.32, 0.86, '#d8483b', PU.x, 2.32, iz);
      b.box(0.62, 0.5, 0.06, '#fff6e0', PU.x, 1.55, iz + 0.42); b.box(0.5, 0.12, 0.07, P.teal, PU.x, 1.18, iz + 0.42);
      b.box(0.08, 0.5, 0.4, '#5a5260', PU.x + 0.49, 1.0, iz + 0.05);
      // a little bin and a tyre stack at the island's far end (just for looks)
      b.cyl(0.32, 0.28, 0.75, 8, P.teal, ix - 0.9, 0.42, iz + 0.3);
      for (let k = 0; k < 3; k++) b.cyl(0.42, 0.42, 0.24, 10, '#3a3440', ix - 2.9, 0.42 + k * 0.25, iz);
      // the canopy on one wide pillar at the west end, high above the tallest bus, so nothing stands between the
      // stop camera and the pump, the hose and the fuel cap (the camera stands east of them on a phone)
      b.box(0.9, 7.0, 0.9, '#f4efe6', ix - 1.9, 0.38, iz - 0.2); b.box(1.1, 0.3, 1.1, P.honey, ix - 1.9, 0.38, iz - 0.2);
      b.box(9.6, 0.42, 5.6, '#fbf6ee', ix + 0.4, 7.2, iz + 0.4); b.box(9.8, 0.5, 5.8, P.teal, ix + 0.4, 7.62, iz + 0.4); b.box(9.84, 0.14, 5.84, P.honey, ix + 0.4, 7.76, iz + 0.4);
      W.addBox(ix, iz, 3.6, 1.1, 0, 1.0);                   // (the island: the bus slides along it, the cameras look over it)
      W.addCircle(PU.x, iz, 0.55, 1.0);                    // (the pump: low for the cameras, so the stop view may look past it)
      W.addCircle(ix - 1.9, iz - 0.2, 0.6, 7.2);
    }
    // the drive-through bus wash on the south aisle: two portal frames over the bay (the brushes are their own mesh)
    const wb = W.bayOf(W.washBay);
    b.at(wb.x, 0.04, wb.z, wb.heading, (q) => {
      for (const z of [-6.8, 6.8]) {
        for (const x of [-3.2, 3.2]) q.box(0.45, 5.6, 0.45, '#5fb7e3', x, 0, z);
        q.box(6.9, 0.6, 0.6, '#5fb7e3', 0, 5.3, z);
        q.box(5.2, 0.5, 0.15, '#ffffff', 0, 4.4, z * 1.02);
      }
      for (const x of [-3.2, 3.2]) q.box(0.3, 0.3, 13.6, '#4a9ccc', x, 5.4, 0);
      q.box(3.6, 0.03, 15.4, '#9fd3e8', 0, 0.01, 0);                                     // a blue wet floor
      for (let z = -6; z <= 6; z += 1.2) q.box(3.2, 0.02, 0.12, '#cfeaf6', 0, 0.03, z);
    });
    for (const z of [-6.8, 6.8]) for (const x of [-3.2, 3.2]) { const c = Math.cos(wb.heading), s2 = Math.sin(wb.heading); W.addCircle(wb.x + x * c + z * s2, wb.z - x * s2 + z * c, 0.35); }
    washRig = buildWashRig(wb);
    // the workshop: a big open shed on pillars at the east end (the bus is made beautiful here)
    const WS = W.workshop;
    b.at(WS.x, 0.04, WS.z, 0, (q) => {
      q.box(34, 0.12, 34, '#bdb5a8', 0, 0, 0);
      for (let x = -16; x <= 16; x += 4) q.box(0.3, 0.02, 34, '#f2c94c', x, 0.12, 0);
      for (const [x, z] of [[-16, -16], [0, -16], [16, -16], [-16, 16], [0, 16], [16, 16]]) { q.box(0.8, 9.6, 0.8, '#e9e2d6', x, 0, z); q.box(1.2, 0.5, 1.2, P.honey, x, 9.1, z); }
      q.box(35, 0.7, 35, P.teal, 0, 9.6, 0); q.box(35.6, 0.35, 35.6, '#fff6e0', 0, 9.4, 0);
      q.prism(35, 35, 2.4, '#16928a', 0, 10.3, 0, Math.PI / 2);
      // tool walls and benches on the south side (the kerb side of the bus)
      q.box(30, 2.6, 0.3, '#fff6e0', 0, 0, 16.6); q.box(30, 0.3, 0.4, P.coral, 0, 2.6, 16.6);
      for (let x = -12; x <= 12; x += 6) { q.box(4, 1.0, 1.4, P.woodLight, x, 0, 15.4); q.box(3.6, 0.2, 1.2, P.wood, x, 1.0, 15.4); q.box(0.8, 0.6, 0.6, P.coral, x - 1, 1.2, 15.4); }
      for (const [x, c] of [[-8, P.berry], [8, P.honey]]) { q.cyl(0.5, 0.5, 1.2, 8, c, x, 0, 13.6); q.cyl(0.5, 0.5, 1.2, 8, c, x + 1.1, 0, 13.6); }
      // a row of new tyres and a stack of paint pots on the north side
      for (let k = 0; k < 4; k++) q.cyl(0.55, 0.55, 0.35, 10, '#3a3440', -14 + k * 1.3, 0.15, -14.5, 0, 0, Math.PI / 2);
      for (let k = 0; k < 5; k++) q.cyl(0.35, 0.35, 0.5, 8, BB.PAINTS[k].color, 10 + k * 0.8, 0.15, -14.6);
    });
    for (const [x, z] of [[-16, -16], [0, -16], [16, -16], [-16, 16], [0, 16], [16, 16]]) W.addCircle(WS.x + x, WS.z + z, 0.6, 9.6);
    W.addBox(WS.x, WS.z + 16.6, 15, 0.4, 0, 2.6);
    SIGNS.push({ pic: 'depot', x: WS.x - 17.9, y: 12.4, z: WS.z, nx: -1, nz: 0, size: 3.6, ring: P.teal });
    SIGNS.push({ pic: 'wash', x: wb.x - wb.fwd.x * 6.8, y: 7.0, z: wb.z - wb.fwd.z * 6.8, nx: -wb.fwd.x, nz: -wb.fwd.z, size: 2.0, ring: '#5fb7e3' });
    XMAS_TREES.push([50, 111, 8]);
  }
  // The wash brushes: two tall ones (one each side of the bay) and one across the top, on a carriage that slides
  // along the bay during a wash. Their stripes show the spin.
  function buildWashRig(wb) {
    const g = new THREE.Group(); g.name = 'washRig';
    const brush = (horiz) => {
      const q = BB.mk.builder(), n = 10;
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2;
        q.box(0.32, 3.2, 0.32, k % 2 ? '#5fb7e3' : '#ff8fab', Math.cos(a) * 0.55, -1.6, Math.sin(a) * 0.55);
      }
      q.cyl(0.18, 0.18, 3.4, 6, '#e9e2d6', 0, -1.7, 0);
      const m = q.mesh(); m.userData.horiz = horiz; return m;
    };
    const L = brush(false), R = brush(false), T = brush(true);
    L.position.set(-1.95, 1.75, 0); R.position.set(1.95, 1.75, 0);
    T.rotation.z = Math.PI / 2; T.position.set(0, 4.15, 0); T.scale.set(1, 1.2, 1);
    const beam = BB.mk.builder(); beam.box(6.2, 0.5, 0.8, '#4a9ccc', 0, 4.9, 0); beam.box(0.4, 1.0, 0.6, '#4a9ccc', -2.8, 3.9, 0); beam.box(0.4, 1.0, 0.6, '#4a9ccc', 2.8, 3.9, 0);
    g.add(beam.mesh(), L, R, T);
    g.userData = { brushes: [L, R, T], bay: wb, t: 0, run: false };
    g.position.set(wb.x + wb.fwd.x * 6.0, 0.04, wb.z + wb.fwd.z * 6.0); g.rotation.y = wb.heading;
    return g;
  }

  // ---- the expressway: an interchange loop ramp by the town's north connector, an overpass and a tunnel far east,
  // a big sign to the airport ----
  function buildHighway(b) {
    // the elevated loop ramp north of the expressway (decoration: the bus stays on the ground)
    const cx = 60, cz = HZ - 34, R0 = 18;
    const deck = [];
    for (let k = 0; k <= 40; k++) { const a = -Math.PI / 2 + k / 40 * Math.PI * 1.6; deck.push({ x: cx + Math.cos(a) * R0, z: cz + Math.sin(a) * R0, y: 2 + 7 * Math.min(1, k / 18) }); }
    const ramp = LMP('elevatedRoad', 0, 0, 0, deck.map((p) => ({ x: p.x, z: p.z })).concat([{ x: cx + 60, z: cz }, { x: cx + 124, z: cz }]), { height: 9, lanes: 2, rampIn: 40, pillarEvery: 18 });
    for (let k = 0; k < deck.length - 1 && !ramp; k++) {
      const p = deck[k], q2 = deck[k + 1], len = hypot2(q2.x - p.x, q2.z - p.z) + 0.2, ry = Math.atan2(q2.x - p.x, q2.z - p.z);
      b.box(7, 0.8, len, '#e6dfd3', (p.x + q2.x) / 2, (p.y + q2.y) / 2, (p.z + q2.z) / 2, ry);
      b.box(7.4, 0.7, len, '#7b7480', (p.x + q2.x) / 2, (p.y + q2.y) / 2 + 0.8, (p.z + q2.z) / 2, ry);
      if (k % 4 === 0) { b.cyl(0.8, 0.9, p.y, 8, '#e3dacd', p.x, 0, p.z); W.addCircle(p.x, p.z, 0.9, p.y); }
    }
    // a straight deck carrying the loop over to the east, on tall piers
    if (!ramp) {
      b.box(7, 1.0, 120, '#e6dfd3', cx + 64, 9, cz, Math.PI / 2); b.box(7.4, 0.8, 120, '#7b7480', cx + 64, 10, cz, Math.PI / 2);
      for (let x = cx + 12; x <= cx + 120; x += 18) { b.cyl(0.9, 1.0, 9, 8, '#e3dacd', x, 0, cz); W.addCircle(x, cz, 1.0, 9); }
      for (const s2 of [-1, 1]) b.box(120, 0.9, 0.3, '#f1ebe0', cx + 64, 10.8, cz + s2 * 3.55);
    }
    // an overpass across the expressway beyond the airport turn, and the tunnel mouth at the far east end
    b.box(9, 1.2, 46, '#e6dfd3', 480, 8.6, HZ); b.box(9.4, 0.8, 46, '#7b7480', 480, 9.8, HZ);
    for (const z of [HZ - 19, HZ + 19]) { b.box(6, 8.6, 1.4, '#e3dacd', 480, 0, z); W.addBox(480, z, 3, 0.7, 0, 9); }
    b.box(2, 14, 40, '#d8cfc2', 554, 0, HZ); b.box(2.2, 6.4, 28, '#2b2430', 552.9, 0, HZ);
    b.ball(30, P.grassDark, 580, -6, HZ, 1, 1, 0.8, 1.6);
    W.addBox(556, HZ, 3, 22, 0, 14);
    // a big direction board over the expressway (a plane picture)
    for (const z of [HZ - 15, HZ + 15]) { b.box(0.6, 8, 0.6, '#5f8f5a', 300, 0, z); W.addCircle(300, z, 0.45, 11.2); }
    W.addSightBox(300, HZ, 0.6, 15.8, 0, 7.9, 11.6);      // (the board: the stop cameras nearby look past it)
    b.box(0.8, 3.2, 31, '#2f8a55', 300, 8, HZ); b.box(0.9, 0.3, 31.4, '#fff6e0', 300, 11.2, HZ);
    SIGNS.push({ pic: 'plane', x: 299.5, y: 9.6, z: HZ + 6.7, nx: -1, nz: 0, size: 2.6, ring: '#2f8a55' });
    SIGNS.push({ pic: 'city', x: 299.5, y: 9.6, z: HZ - 6.7, nx: -1, nz: 0, size: 2.6, ring: '#2f8a55' });
    BLDG.push({ x: cx + 64, z: cz, ry: Math.PI / 2, len: 120, dep: 7, H: 10.8 });
  }

  // ---- the airport, north of the expressway: a terminal with a curved roof facing the drop-off road, a control
  // tower, a fenced apron and runway, planes parked, one taxiing and one taking off now and then ----
  function planeModel(q, s) {
    q.cyl(1.6 * s, 1.6 * s, 26 * s, 10, '#f7f4ee', 0, 0, 0, 0, Math.PI / 2);              // fuselage along z
    q.ball(1.6 * s, '#f7f4ee', 0, 0, 13 * s, 1, 1, 1, 1.5);
    q.add(new THREE.ConeGeometry(1.6 * s, 6 * s, 10), '#f7f4ee', 0, 0.6 * s, -15.8 * s, 0, -Math.PI / 2);
    q.box(26 * s, 0.4 * s, 5 * s, '#e3e7ee', 0, -0.6 * s, 0.6 * s);                         // wings
    q.box(9 * s, 0.3 * s, 2.6 * s, '#e3e7ee', 0, 0.6 * s, -16.5 * s);                       // tailplane
    q.box(0.4 * s, 5 * s, 3.6 * s, '#4fa3e0', 0, 0.8 * s, -16.5 * s);                       // fin (a plain blue stripe: no logo)
    for (const x of [-6.5, 6.5]) q.cyl(0.8 * s, 0.9 * s, 3.2 * s, 8, '#c9cfd8', x * s, -1.6 * s, 1.8 * s, 0, Math.PI / 2);
    q.box(2.8 * s, 0.3 * s, 22 * s, '#4fa3e0', 0, 0.2 * s, 0.4 * s);                       // a cheerful stripe
    for (let k = -4; k <= 4; k++) q.box(3.25 * s, 0.4 * s, 0.6 * s, '#4d6f8a', 0, 0.85 * s, k * 2.4 * s);   // windows (both sides)
    for (const z of [9, -2]) q.box(0.3 * s, 1.6 * s, 0.3 * s, '#5a5260', 0, -3.2 * s, z * s);
  }
  function buildAirport(b, green) {
    // the terminal (west of the drop-off road), its forecourt and glass front
    // (set back from the road, so the stop's side-view camera on the forecourt has room in front of the roof)
    b.box(26, 0.18, 70, P.pave, 379, 0, HZ - 56);
    const TX = 340, TZ = HZ - 56;
    const lmT = LMP('airportTerminal', 356, TZ, -Math.PI / 2, { length: 60 });
    if (!lmT) W.addBox(TX, TZ, 28, 22, 0, 13);
    if (!lmT) A(b, TX, 0, TZ, Math.PI / 2, (q) => {
      bx(q, 44, 9, 54, '#f1ebe0', 0, 0, 0);
      bx(q, 44.4, 0.8, 54.4, '#d8cfc2', 0, 9, 0);
      q.add(new THREE.CylinderGeometry(30, 30, 46, 16, 1, false, -0.55, 1.1), '#e9e2d6', 0, -17.6, 0, 0, Math.PI / 2, 0, 1, 1, 1);
      for (let x = -20; x <= 20; x += 4) pane(q, x, 4.6, 27.05, 0, 3.4, 6.8, rnd() < 0.7, '#a9d6ec');
      bx(q, 46, 0.6, 3, '#fff6e0', 0, 8.4, 28.6);
      for (let x = -20; x <= 20; x += 8) bx(q, 0.4, 8.4, 0.4, '#e9e2d6', x, 0, 29.8);
      bx(q, 46, 0.3, 4, P.teal, 0, 8.8, 29.5);
    });
    SIGNS.push({ pic: 'plane', x: 367.8, y: 11.5, z: TZ, nx: 1, nz: 0, size: 3.6, ring: P.teal });
    // the airside: apron, taxiway and runway behind a fence
    b.box(330, 0.04, 34, '#a6a0a8', 385, 0, -340);
    for (let x = 230; x <= 540; x += 14) b.box(6, 0.02, 0.8, '#fff6e0', x, 0.05, -340);
    for (const x of [228, 542]) for (let k = -3; k <= 3; k++) b.box(1.2, 0.02, 4, '#fff6e0', x, 0.05, -340 + k * 3.6);
    b.box(300, 0.04, 14, '#b4aeb6', 380, 0, -316);
    b.box(120, 0.04, 30, '#b9b3bb', 290, 0, -310);
    for (let x = 216; x <= 546; x += 3.5) b.box(0.12, 2.0, 0.12, '#8f96a0', x, 0, -299);
    b.box(330, 0.08, 0.05, '#cfd4da', 381, 1.0, -299); b.box(330, 0.08, 0.05, '#cfd4da', 381, 1.9, -299);
    // the control tower
    if (!LMP('controlTower', 262, -318, 0)) A(b, 262, 0, -318, 0, (q) => {
      q.cyl(2.2, 3.0, 26, 10, '#f1ebe0', 0, 0, 0);
      q.cyl(4.8, 3.6, 1.2, 10, '#d8cfc2', 0, 26, 0);
      q.cyl(5.0, 5.0, 3.4, 10, '#4d6f8a', 0, 27.2, 0);
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; pane(q, Math.sin(a) * 5.05, 28.9, Math.cos(a) * 5.05, a, 2.8, 2.6, true, '#9fd3e8'); }
      q.cyl(5.6, 5.2, 0.8, 10, P.teal, 0, 30.6, 0);
      q.cyl(0.15, 0.15, 3, 4, '#8f96a0', 0, 31.4, 0); q.ball(0.4, '#ff4a3a', 0, 34.6, 0);
    });
    // parked planes at the apron
    for (const [x, z, h, v] of [[248, -308, Math.PI * 0.95, 0], [318, -306, Math.PI * 1.05, 2]]) if (!LMP('plane', x, z, h, v)) b.at(x, 3.0, z, h, (q) => planeModel(q, 1));
    // two moving planes (one instanced mesh): one taxis to and fro, one takes off down the runway now and then
    const pb = BB.mk.builder(); planeModel(pb, 1);
    planes = new THREE.InstancedMesh(pb.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 2);
    planes.name = 'planes'; planes.frustumCulled = false;
    planeState.push({ kind: 'taxi', t: 0 }, { kind: 'takeoff', t: rr(0, 20) });
    // grass round the airfield, a windsock
    b.box(0.2, 7, 0.2, '#8f96a0', 540, 0, -322); b.add(new THREE.ConeGeometry(0.7, 3, 8, 1, true), '#ff8a3a', 540, 6.6, -320.6, 0, Math.PI / 2);
    BLDG.push({ x: TX, z: TZ, ry: Math.PI / 2, len: 44, dep: 54, H: 9.2 });
    XMAS_TREES.push([418, HZ - 56, 7]);
  }
  function updatePlanes(dt) {
    for (let i = 0; i < 2; i++) {
      const st = planeState[i]; st.t += dt;
      let x, y = 3.0, z, h, pitch = 0;
      if (st.kind === 'taxi') {                         // to and fro along the taxiway, turning at each end
        const T = 70, u = (st.t % T) / T, w = u < 0.5 ? u * 2 : 2 - u * 2;
        x = 240 + 280 * (w * w * (3 - 2 * w)); z = -316; h = u < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      } else {                                          // roll, rotate, climb away, pause unseen, again
        const T = 46, u = st.t % T;
        if (u > 32) { planes.setMatrixAt(i, _m4.compose(_p4.set(0, -200, 0), _q4.identity(), _s4.set(0.01, 0.01, 0.01))); continue; }
        const s0 = Math.min(u, 14), vx = 0.9 * s0 * s0 + Math.max(0, u - 14) * 25.2;
        x = 230 + vx; z = -340; h = Math.PI / 2;
        const air = Math.max(0, x - 400); y = 3.0 + air * air * 0.0016 + air * 0.08; pitch = -Math.min(0.22, air * 0.004);
      }
      _q4.setFromEuler(_e4.set(pitch, h, 0));
      planes.setMatrixAt(i, _m4.compose(_p4.set(x, y, z), _q4, _s4.set(1, 1, 1)));
    }
    planes.instanceMatrix.needsUpdate = true;
  }

  // ---- the city: glassy towers east of the town, between the expressway and the east connector, and a few more
  // south of it (generic shapes: slabs, stepped and tapered towers with rooftop crowns) ----
  function buildCity(b) {
    const cols = ['#9cc7dc', '#8fd3c6', '#b9d2ff', '#f1ebe0', '#a9c4e0', '#ffe1b0'];
    const spots = [];
    for (const z of [-158, -130, -102, -76, -50]) for (const x of [120, 144, 168]) spots.push([x, z]);
    for (const z of [52, 80]) for (const x of [120, 144, 168]) spots.push([x, z]);
    let i = 0;
    for (const [x, z] of spots) {
      if ((i++ * 7) % 11 === 3) continue;              // a few gaps (little plazas)
      const w = rr(10, 13), d = rr(10, 13), h = rr(28, 78), col = rpick(cols), ry = 0;
      if (LMP('skylineTower', x, z, ry, i % 6, { height: h })) { BLDG.push({ x, z, ry, len: 14, dep: 14, H: h * 0.5 }); continue; }
      W.addBox(x, z, w / 2 + 0.3, d / 2 + 0.3, ry, h + 4);
      A(b, x, 0, z, ry, (q) => {
        const steps = h > 55 ? 3 : 2;
        let cw = w, cd = d, y = 0;
        for (let k = 0; k < steps; k++) {
          const sh = (h / steps) * (k === steps - 1 ? 1.0 : 1.05);
          bx(q, cw, sh, cd, k % 2 ? light(col, 0.25) : col, 0, y, 0);
          for (let yy = y + 3; yy < y + sh - 2; yy += 3.6) { bx(q, cw + 0.15, 0.25, cd + 0.15, '#f7f4ee', 0, yy, 0); }
          for (let yy = y + 4.5; yy < y + sh - 2; yy += 7.2) { pane(q, 0, yy, cd / 2 + 0.06, 0, cw - 1.6, 1.8, rnd() < 0.55, '#bfe3f2'); pane(q, -cw / 2 - 0.06, yy, 0, -Math.PI / 2, cd - 1.6, 1.8, rnd() < 0.55, '#bfe3f2'); }
          y += sh; cw *= 0.78; cd *= 0.78;
        }
        bx(q, cw * 0.9, 1.4, cd * 0.9, '#e9e2d6', 0, y, 0);
        if (h > 60) { q.cyl(0.18, 0.25, 7, 4, '#8f96a0', 0, y + 1.4, 0); q.ball(0.35, '#ff4a3a', 0, y + 8.5, 0); }
        else q.add(new THREE.ConeGeometry(Math.min(cw, cd) * 0.55, 4, 4), P.teal, 0, y + 1.4 + 2, 0, Math.PI / 4);
      });
      BLDG.push({ x, z, ry, len: w, dep: d, H: h * 0.5 });
    }
    XMAS_TREES.push([99, -62, 8]);
  }

  // ---- old town: two rows of colourful two-storey shophouses facing each other across the west road, with
  // lanterns strung over the road ----
  function oldTownRow(q, len) {
    const walls = ['#ffc9a0', '#9fdcc4', '#ffb3c6', '#b9d2ff', '#ffe58a', '#ffbe98', '#cdbcff', '#a8e6a1'];
    const n = Math.floor(len / 5);
    for (let k = 0; k < n; k++) {
      const x = -len / 2 + 2.5 + k * 5, col = walls[(k * 3) % walls.length];
      bx(q, 5, 3.2, 8, light(col, 0.25), x, 0, -1);
      bx(q, 5, 3.6, 9.6, col, x, 3.2, -0.2);
      bx(q, 5.2, 0.3, 10, '#fff6e6', x, 3.1, -0.2);
      pane(q, x, 1.5, 3.02, 0, 3.2, 1.8, true, '#ffe1a0');
      pane(q, x - 1.2, 4.9, 4.62, 0, 1.0, 1.6); pane(q, x + 1.2, 4.9, 4.62, 0, 1.0, 1.6);
      bx(q, 5.1, 0.4, 0.5, '#fff6e6', x, 6.8, 4.5);
      q.prism(5.2, 9.6, 2.0, k % 2 ? '#c85a3a' : '#d9673f', x, 6.8, -0.2);
      q.ball(0.4, '#e8473b', x, 2.6, 3.8, 0, 1, 1.2, 1);
      bx(q, 0.4, 3.2, 0.4, '#fff6e6', x - 2.3, 0, 4.4);
    }
  }
  function buildOldTown(b) {
    const X = -OX;
    const ROWS = [[-136, -100], [-86, -50], [0, 36], [54, 90], [106, 142]];
    for (const [z0, z1] of ROWS) {
      const len = z1 - z0, zc = (z0 + z1) / 2;
      // east row (faces west, its front 15 from the road's middle) and west row (faces east)
      for (const [x, ry] of [[X + 29, -Math.PI / 2], [X - 29, Math.PI / 2]]) {
        if (!LMP('chinatownRow', x, zc, ry, Math.min(4, Math.floor(len / 5.2)))) { A(b, x, 0, zc, ry, (q) => oldTownRow(q, len)); W.addBox(x, zc, 5.4, len / 2, 0, 9); }
        BLDG.push({ x, z: zc, ry, len, dep: 10, H: 7.2 });
      }
      b.box(9, 0.2, len, P.pave, X + 19.7, 0, zc); b.box(9, 0.2, len, P.pave, X - 19.7, 0, zc);
      // lantern strings across the road every 14
      for (let z = z0 + 8; z < z1 - 4; z += 18) {
        b.box(48, 0.06, 0.06, '#7a5a3a', X, 7.8, z);
        for (let x = X - 21; x <= X + 21; x += 4.2) b.ball(0.38, (Math.round(x) % 2) ? '#ef4b3c' : '#ffb81f', x, 7.3, z, 0, 1, 1.25, 1);
      }
    }
    // a red gate with green tiles at the north end of the street
    b.at(X, 0, -146, 0, (q) => {
      for (const x of [-11, 11]) { q.box(1.4, 9, 1.4, '#d9473b', x, 0, 0); q.box(2.2, 0.6, 2.2, '#c13a30', x, 0, 0); }
      q.box(26, 1.2, 1.6, '#d9473b', 0, 8.2, 0); q.prism(28, 3.4, 1.6, '#2f8a55', 0, 9.4, 0); q.box(8, 1.4, 0.4, '#ffb81f', 0, 6.4, 0.8);
    });
    for (const x of [-11, 11]) W.addCircle(X + x, -146, 1.0, 9);
    XMAS_TREES.push([X - 30, -28, 8]);
  }

  // ---- the waterfront: a promenade along the sea, the beach park (west), a garden of tall glowing tree towers and a
  // giant observation wheel (east) ----
  function superTree(q, h, col) {
    q.cyl(1.2, 0.9, h, 8, dark(col, 0.1), 0, 0, 0);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; q.box(0.25, h * 0.9, 0.25, light(col, 0.2), Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0, -a, 0, 0); }
    q.add(new THREE.CylinderGeometry(h * 0.32, 1.2, h * 0.28, 10, 1, true), col, 0, h * 0.86, 0);
    q.add(new THREE.CylinderGeometry(h * 0.32, h * 0.32, 0.5, 10), dark(col, 0.15), 0, h, 0);
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; q.ball(0.7, rpick(['#6fc45a', '#8fd06a', '#ff8fc0']), Math.cos(a) * h * 0.3, h + 0.3, Math.sin(a) * h * 0.3); }
  }
  function buildWaterfront(b, green) {
    b.box(1300, 0.06, 900, '#57b2dd', 100, 0.0, SZ + 24 + 450);                            // the sea
    b.box(1300, 0.08, 6, '#7fc8ea', 100, 0.0, SZ + 26);
    b.box(350, 0.2, 12, P.pave, 0, 0, SZ + 17.5);                                          // the promenade
    for (let x = -170; x <= 170; x += 3) b.box(0.12, 1.1, 0.12, '#e9e2d6', x, 0.2, SZ + 23.3);
    b.box(344, 0.1, 0.1, '#e9e2d6', 0, 1.3, SZ + 23.3);
    // beach park (west): sand, palms, umbrellas, loungers, a lifeguard tower
    let beachKit = true;
    for (const x of [74, 120, 166]) beachKit = !!LMP('beachPark', x, SZ + 37, 0) && beachKit;
    if (!beachKit) A(b, 120, 0, SZ + 40, 0, (q) => {
      q.box(132, 0.12, 30, '#f6d98e', 0, 0, 0);
      const um = [P.coral, P.honey, P.teal, P.rose, P.berry];
      for (let k = 0; k < 9; k++) {
        const x = -56 + k * 14, z = (k % 2) * 6 - 2;
        q.cyl(0.08, 0.08, 2.6, 4, '#e9e2d6', x, 0.1, z); q.add(new THREE.ConeGeometry(2.0, 0.8, 8), um[k % um.length], x, 2.9, z);
        q.box(0.9, 0.25, 2.0, '#fff6e0', x + 1.6, 0.12, z + 0.6, 0.3);
      }
      q.box(3, 0.3, 3, '#e9e2d6', 30, 3, -6); for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) q.box(0.2, 3, 0.2, '#e9e2d6', 30 + x, 0, -6 + z);
      q.box(2.6, 1.8, 2.6, P.coral, 30, 3.3, -6); q.prism(3.2, 3.2, 1, '#fff6e0', 30, 5.1, -6);
    });
    for (let k = 0; k < 7; k++) tree(green, 56 + k * 18, SZ + 33 + (k % 2) * 8, 0.12, 'palm', 1.1);
    // the garden of tree towers
    const GX = -45;
    b.box(70, 0.14, 34, '#7fcf6a', GX, 0, SZ + 44);
    const lmTrees = LMP('superTrees', GX, SZ + 44, 0, { count: 7, radius: 15 });
    if (!lmTrees) A(b, GX, 0, SZ + 44, 0, (q) => {
      const T = [[-26, -6, 18, '#b07ad8'], [-12, 8, 24, '#ff8fab'], [0, -8, 28, '#8e62c8'], [12, 6, 22, '#ffb81f'], [26, -4, 17, '#19a79b'], [-2, 12, 15, '#ff6b5c'], [22, 12, 14, '#5d73e8']];
      for (const [x, z, h, c] of T) q.at(x, 0.1, z, 0, (r) => superTree(r, h, c));
    });
    if (!lmTrees) for (const [x, z] of [[-26, -6], [-12, 8], [0, -8], [12, 6], [26, -4]]) W.addCircle(GX + x, SZ + 44 + z, 1.4);
    // the observation wheel: legs and a boarding hall (static), the rim (turns)
    const WX = -122, WZ = SZ + 46, HUB = 31, RW = 25;
    XMAS_TREES.push([-84, SZ + 17, 8]);
    b.box(44, 0.5, 30, '#e4d6bd', WX, 0, WZ + 2);                    // its pier
    if (LMP('observationWheel', WX, WZ, 0, { radius: 23 })) return;
    b.at(WX, 0, WZ, 0, (q) => {
      for (const s2 of [-1, 1]) for (const zz of [-5, 5]) {
        const lx = s2 * 14, len = hypot2(14, HUB), ang = Math.atan2(14, HUB);
        q.box(1.0, len, 1.0, '#e9e2d6', lx / 2, HUB / 2 - len / 2, zz * 0.6, 0, 0, s2 * ang);
      }
      q.add(new THREE.CylinderGeometry(1.2, 1.2, 9, 10), '#d8cfc2', 0, HUB, -1, 0, Math.PI / 2);
      q.box(30, 4.5, 12, '#fff6e0', 0, 0, 10); q.box(31, 0.6, 13, P.teal, 0, 4.5, 10);
    });
    W.addBox(WX, WZ + 10, 15, 6, 0, 5);
    const rim = BB.mk.builder(), cols = ['#ff6b5c', '#ffb81f', '#19a79b', '#5d73e8', '#ff8fab', '#6fc45a', '#8e62c8', '#ffd45c'];
    rim.add(new THREE.TorusGeometry(RW, 0.45, 5, 48), '#f1ebe0', 0, 0, 0.9); rim.add(new THREE.TorusGeometry(RW, 0.45, 5, 48), '#f1ebe0', 0, 0, -0.9);
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2;
      const m = new THREE.Matrix4().makeRotationZ(a - Math.PI / 2).setPosition(Math.cos(a) * RW / 2, Math.sin(a) * RW / 2, 0);
      rim.addM(new THREE.BoxGeometry(0.16, RW, 0.16), '#d8cfc2', m);
      rim.ball(1.5, cols[k % cols.length], Math.cos(a) * (RW + 1.4), Math.sin(a) * (RW + 1.4), 0, 1);
    }
    wheelRim = rim.mesh(); wheelRim.name = 'wheelRim'; wheelRim.position.set(WX, HUB, WZ - 4.5); wheelRim.rotation.y = 0;
  }

  // Each district is its own mesh (and landmark batch), hidden when the camera is far from it (past the fog).
  const DIST_B = {}, FAR_CULL = [];
  function buildDistricts(green) {
    for (const [k, fn] of [['depot', buildDepot], ['highway', buildHighway], ['airport', buildAirport], ['city', buildCity], ['oldtown', buildOldTown], ['waterfront', buildWaterfront]]) {
      curDist = k; DIST_B[k] = lean(BB.mk.builder()); fn(DIST_B[k], green);
    }
  }
  // distance culling: a district mesh is drawn only while the camera is within ~215 of its box (the fog hides it there)
  function cullFar() {
    const c = BB.camera && BB.camera.position; if (!c) return;
    for (const m of FAR_CULL) {
      const bb = m.userData.box; if (!bb) continue;
      const dx = Math.max(bb.min.x - c.x, 0, c.x - bb.max.x), dz = Math.max(bb.min.z - c.z, 0, c.z - bb.max.z);
      const R = m.userData.farR || 215; m.visible = dx * dx + dz * dz < R * R;
    }
  }

  // ---------- the bus wash show (bus.js runs the clock: W.washShow(t) each frame, null to stop) ----------
  // 0-0.6 s the brushes come up to speed; 0.6-4.4 s the carriage rolls along the bus and back, foam flies; 4.4-5.6 s
  // a rinse of blue spray; then everything settles.
  const FOAM_N = 180;
  function buildWashFx() {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(FOAM_N * 3), col = new Float32Array(FOAM_N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 2, 16, 16, 15);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    const m = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.55, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false }));
    m.frustumCulled = false; m.visible = false; m.name = 'washFx';
    m.userData.p = []; for (let i = 0; i < FOAM_N; i++) m.userData.p.push({ x: 0, y: -50, z: 0, vy: 0, life: 0 });
    return m;
  }
  W.washShow = function (t, dt) {
    if (!washRig) return;
    const u = washRig.userData, wb = u.bay;
    dt = dt || 0;
    if (t == null) { u.run = false; if (washFx) washFx.visible = false; washRig.position.set(wb.x + wb.fwd.x * 6.0, 0.04, wb.z + wb.fwd.z * 6.0); return; }
    u.run = true;
    // the carriage: from the bay's front end to its back and back again
    const k = t < 0.6 ? 0 : t < 4.4 ? (t - 0.6) / 3.8 : 1, along = 6.0 - 12.0 * Math.sin(Math.PI * k);
    washRig.position.set(wb.x + wb.fwd.x * along, 0.04, wb.z + wb.fwd.z * along);
    const spin = t < 5.6 ? Math.min(1, t / 0.6) : Math.max(0, 1 - (t - 5.6) / 0.6);
    for (const br of u.brushes) br.rotation.y += dt * 14 * spin * (br === u.brushes[1] ? -1 : 1);
    // foam (white, pink, pale blue) while brushing, blue spray when rinsing
    if (!washFx) return;
    washFx.visible = t < 6.4;
    const P0 = washFx.userData.p, pos = washFx.geometry.attributes.position.array, col = washFx.geometry.attributes.color.array;
    const rinse = t > 4.4 && t < 5.6, spark = t >= 5.6, emit = t > 0.5 && t < 6.3;
    for (let i = 0; i < FOAM_N; i++) {
      const q = P0[i];
      q.life -= dt;
      if (q.life <= 0 && emit && Math.random() < dt * 22) {
        const side = Math.random() < 0.5 ? -1 : 1, a = along + (Math.random() - 0.5) * (rinse ? 12 : 3);
        q.x = wb.x + wb.fwd.x * a + wb.side.x * side * (1.0 + Math.random() * 0.6); q.z = wb.z + wb.fwd.z * a + wb.side.z * side * (1.0 + Math.random() * 0.6);
        q.y = rinse ? 4.6 : 0.6 + Math.random() * 3.0; q.vy = rinse ? -6 - Math.random() * 3 : 0.3 + Math.random() * 0.5; q.life = rinse ? 0.7 : spark ? 0.5 : 1.4 + Math.random();
        const c = rinse ? [0.55, 0.8, 1.0] : spark ? [1, 0.95, 0.55] : rpick([[1, 1, 1], [1, 0.85, 0.92], [0.85, 0.95, 1]]);
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      }
      if (q.life > 0) { q.y = Math.max(0.1, q.y + q.vy * dt); pos[i * 3] = q.x; pos[i * 3 + 1] = q.y; pos[i * 3 + 2] = q.z; }
      else { pos[i * 3 + 1] = -50; }
    }
    washFx.material.size = rinse ? 0.35 : spark ? 0.45 : 0.8;
    washFx.geometry.attributes.position.needsUpdate = true; washFx.geometry.attributes.color.needsUpdate = true;
  };

  // ---------- Christmas: W.setXmas(on) ----------
  // Big decorated trees (the depot yard, the waterfront, the city, old town, the airport), wreaths on the bus stop
  // shelters, and fairy lights (one Points draw call) on the street trees and along the roofs; they glow at night.
  let xmasDecor = null, xmasLights = null, xmasKit = null, xmasOn = false;
  function bigXmasTree(q, h) {
    q.cyl(0.45, 0.6, h * 0.16, 6, P.woodDark, 0, 0, 0);
    for (let k = 0; k < 4; k++) q.add(new THREE.ConeGeometry(h * (0.36 - k * 0.07), h * 0.32, 9), k % 2 ? '#2f8a55' : '#3a9d5f', 0, h * (0.28 + k * 0.17), 0);
    q.add(new THREE.OctahedronGeometry(h * 0.07), '#ffd45c', 0, h * 1.02, 0);
    for (const [x, z, c] of [[1.2, 0.8, P.coral], [-1.0, 1.1, P.berry], [0.4, -1.3, P.honey], [-1.3, -0.6, P.teal]]) { q.box(0.9, 0.7, 0.9, c, x, 0, z); q.box(0.95, 0.12, 0.2, '#fff6e0', x, 0.7, z); }
  }
  function buildXmas() {
    const xb = BB.mk.builder(), lp = [], lc = [], xl = BB.landmarks && BB.landmarks.batch && BB.landmarks.christmasTree ? BB.landmarks.batch() : null;
    const cols = [[1, 0.35, 0.3], [1, 0.82, 0.3], [0.35, 0.85, 0.5], [0.45, 0.6, 1], [1, 0.55, 0.85]];
    const light = (x, y, z, i) => { lp.push(x, y, z); const c = cols[i % cols.length]; lc.push(c[0], c[1], c[2]); };
    for (const [x, z, h] of XMAS_TREES) {
      let kit = false;
      if (xl) try { xl.add('christmasTree', x, z, 0, h / 7); if (BB.landmarks.giftPile) xl.add('giftPile', x + h * 0.32, z + h * 0.2, 0.4, 4); kit = true; } catch (e) { console.error(e); }
      if (!kit) xb.at(x, 0.2, z, 0, (q) => bigXmasTree(q, h));
      for (let k = 0; k < 40; k++) { const t = k / 40, a = t * Math.PI * 9, r = h * 0.34 * (1 - t) + 0.3; light(x + Math.cos(a) * r, 0.2 + h * (0.2 + t * 0.75), z + Math.sin(a) * r, k); }
    }
    for (const st of W.stops) {
      const p = st.pos, wx = p.x - st.side.x * 0.1, wz = p.z - st.side.z * 0.1;
      xb.at(wx, 2.9, wz, st.heading + Math.PI / 2, (q) => {
        if (LM('wreath', q, { r: 0.6 })) return;
        q.add(new THREE.TorusGeometry(0.55, 0.18, 5, 12), '#2f8a55', 0, 0, 0); q.box(0.4, 0.3, 0.12, '#e8473b', 0, -0.55, 0.1);
      });
      for (let k = 0; k < 10; k++) light(p.x + st.fwd.x * (k - 4.5) * 0.8 - st.side.x * 1.3, 3.05, p.z + st.fwd.z * (k - 4.5) * 0.8 - st.side.z * 1.3, k);
    }
    let i = 0;
    for (const [x, z, y, r] of TREE_SPOTS) for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + i; light(x + Math.cos(a) * r * 0.85, y + (k % 2) * 0.6 - 0.2, z + Math.sin(a) * r * 0.85, i + k); i++; }
    for (const B of BLDG) {
      const c = Math.cos(B.ry), s2 = Math.sin(B.ry);
      const corner = (lx, lz) => ({ x: B.x + lx * c + lz * s2, z: B.z - lx * s2 + lz * c });
      const hl = B.len / 2 + 0.3, hd = B.dep / 2 + 0.3, pts = [corner(-hl, -hd), corner(hl, -hd), corner(hl, hd), corner(-hl, hd), corner(-hl, -hd)];
      for (let k = 0; k < 4; k++) {
        const a = pts[k], b2 = pts[k + 1], n = Math.max(2, Math.floor(hypot2(b2.x - a.x, b2.z - a.z) / 1.6));
        for (let j = 0; j < n; j++) light(a.x + (b2.x - a.x) * j / n, B.H + 0.4, a.z + (b2.z - a.z) * j / n, i++);
      }
    }
    xmasDecor = xb.mesh(); xmasDecor.name = 'xmasDecor'; xmasDecor.matrixAutoUpdate = false; xmasDecor.updateMatrix();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 1, 16, 16, 15);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    xmasLights = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.5, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, fog: true }));
    xmasLights.name = 'xmasLights'; xmasLights.frustumCulled = false;
    W.scene.add(xmasDecor, xmasLights);
    if (xl) { xmasKit = xl.mesh(); xmasKit.name = 'xmasKit'; W.scene.add(xmasKit); }
    if (BB.renderer && BB.camera) try { BB.renderer.compile(W.scene, BB.camera); } catch (e) { /* compiled on first draw */ }
  }
  W.setXmas = function (on) {
    xmasOn = !!on;
    if (xmasOn && !xmasDecor && W.built) buildXmas();
    if (xmasDecor) { xmasDecor.visible = xmasOn; xmasLights.visible = xmasOn; if (xmasKit) xmasKit.visible = xmasOn; }
    BB.emit('world:xmas', { on: xmasOn });
    return xmasOn;
  };
  W.isXmas = () => xmasOn;

  // ======================= town life: people on the pavements, little cars in the streets, boats on the sea =======================
  // Everything here is decoration that keeps out of the game's way: nothing has a collider, nothing ever blocks the
  // bus or a stop, and it all stands still while the game is held (it runs from W.update). Three draw calls at most:
  // the townsfolk (one instanced mesh), the town cars (extra instances of the expressway cars' mesh, so none), the
  // boats (one instanced mesh, only near the sea).
  // It has its own random numbers, so the town's layout and the clouds stay exactly as they were.
  let lseed = 97531;
  const lrnd = () => { lseed = lseed + 0x6D2B79F5 | 0; let t = Math.imul(lseed ^ lseed >>> 15, 1 | lseed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const lr = (a, b) => a + lrnd() * (b - a);
  const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  // A polyline stored flat ({x, z, cum, n, len}) and a point on it at distance s, written into a scratch object:
  // walkers and cars ask for one every frame, so nothing is made per call.
  function flatLine(pts) {
    const n = pts.length, x = new Float32Array(n), z = new Float32Array(n), cum = new Float32Array(n);
    for (let i = 0; i < n; i++) { x[i] = pts[i].x; z[i] = pts[i].z; if (i) cum[i] = cum[i - 1] + hypot2(x[i] - x[i - 1], z[i] - z[i - 1]); }
    return { x, z, cum, n, len: cum[n - 1] };
  }
  const _lp = { x: 0, z: 0, dx: 0, dz: 1 };
  function lineAt(L, s) {
    const cum = L.cum, n = L.n;
    if (s < 0) s = 0; else if (s > L.len) s = L.len;
    let i = 1; while (i < n - 1 && cum[i] < s) i++;
    const l = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / l, ax = L.x[i - 1], az = L.z[i - 1], bx = L.x[i], bz = L.z[i];
    _lp.dx = (bx - ax) / l; _lp.dz = (bz - az) / l; _lp.x = ax + (bx - ax) * t; _lp.z = az + (bz - az) * t;
    return _lp;
  }
  // The bus as the town's people and cars see it: its outline along the ground as a line of four points from the nose
  // to the tail (front carriage, joint, rear carriage: a bendy bus bends at its joint, so a sharp turn bends this line
  // too; a rigid one is a straight line), where it is heading and how fast. Worked out once a frame.
  const BUSG = { ok: false, p: new Float32Array(8), mx: 0, mz: 0, fx: 0, fz: 1, speed: 0, calm: false, calmT: 9, tx: 0, tz: 0, tr: 0, ex: 0, ez: 0, er: 0, tow: false };
  // The camera's view along the ground: where it stands, which way it looks and how wide (a wedge), and how fast it is
  // turning (`spin`, smoothed) or how long it has stood still (`still`).
  // (cosW: the wedge with a margin, for what is drawn; cosR: the picture itself, a little wider for a walker's size)
  const CAMG = { ok: false, x: 0, y: 10, z: 0, fx: 0, fz: 1, cosW: 0, cosR: 0, flat: false, yaw: 0, spin: 0, still: 0 };
  function camGeom(dt) {
    const cam = BB.camera, V = CAMG;
    V.ok = !!cam; if (!cam) return;
    const me = cam.matrixWorld.elements; let fx = -me[8], fz = -me[10]; const fl = hypot2(fx, fz);
    V.flat = fl > 0.2; if (V.flat) { fx /= fl; fz /= fl; }
    const yaw = Math.atan2(fx, fz), px = cam.position.x, pz = cam.position.z;
    const rate = dt > 0 ? Math.abs(wrapPi(yaw - V.yaw)) / dt : 0, moved = hypot2(px - V.x, pz - V.z);
    V.spin += (rate - V.spin) * Math.min(1, dt * 12);
    V.still = rate < 0.05 && moved < 0.02 + dt * 0.3 ? V.still + dt : 0;
    V.yaw = yaw; V.x = px; V.y = cam.position.y; V.z = pz; V.fx = fx; V.fz = fz;
    const half = Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect);
    V.cosW = Math.cos(Math.min(1.45, half + 0.2)); V.cosR = Math.cos(Math.min(1.45, half + 0.06));
  }
  // Is (x, z) in the picture itself (not just near its edge), as far as anybody is drawn?
  function inPicture(x, z) {
    const V = CAMG, dx = x - V.x, dz = z - V.z, d = hypot2(dx, dz);
    return d < 125 && (!V.flat || dx * V.fx + dz * V.fz > V.cosR * d);
  }
  // Can the camera see the ground at (x, z)? (anything nearer than `near` counts as seen)
  function inSight(x, z, near) {
    const V = CAMG, dx = x - V.x, dz = z - V.z, d = hypot2(dx, dz);
    return d < near || !V.flat || dx * V.fx + dz * V.fz > V.cosW * d;
  }
  // how far (x, z) is from a line of four points (an outline like BUSG.p)
  function segD(x, z, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = l2 > 1e-6 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return hypot2(ax + dx * t - x, az + dz * t - z);
  }
  function lineD(p, x, z) {
    const a = segD(x, z, p[0], p[1], p[2], p[3]), b = segD(x, z, p[2], p[3], p[4], p[5]), c = segD(x, z, p[4], p[5], p[6], p[7]);
    return a < b ? (a < c ? a : c) : (b < c ? b : c);
  }
  const busDist = (x, z) => lineD(BUSG.p, x, z);      // how far (x, z) is from the bus
  function busGeom(dt) {
    const B = BB.bus, G = BUSG, p = G.p;
    G.ok = !!(B && B.front && B.rear); if (!G.ok) return;
    const f = B.front.position, r = B.rear.position, art = hypot2(f.x - r.x, f.z - r.z) > 0.5;
    const L = B.length || 12;
    const fX = Math.sin(B.front.rotation.y), fZ = Math.cos(B.front.rotation.y), rX = Math.sin(B.rear.rotation.y), rZ = Math.cos(B.rear.rotation.y);
    if (art) {                        // (a bendy bus: the front carriage nose to back, then the rear carriage front to tail)
      const hf = L * 0.26, hr = L * 0.21;
      p[0] = f.x + fX * hf; p[1] = f.z + fZ * hf; p[2] = f.x - fX * hf; p[3] = f.z - fZ * hf;
      p[4] = r.x + rX * hr; p[5] = r.z + rZ * hr; p[6] = r.x - rX * L * 0.25; p[7] = r.z - rZ * L * 0.25;
    } else {
      p[0] = f.x + fX * L * 0.5; p[1] = f.z + fZ * L * 0.5; p[6] = f.x - fX * L * 0.5; p[7] = f.z - fZ * L * 0.5;
      p[2] = p[4] = f.x; p[3] = p[5] = f.z;
    }
    G.mx = (p[0] + p[6]) / 2; G.mz = (p[1] + p[7]) / 2; G.fx = fX; G.fz = fZ; G.speed = +B.speed || 0;
    G.tow = B.type === 'tow';
    // a stop, a scene, the tow or the wash in progress (the goodnight at a stop too): the side view must show only the
    // people the question is about
    const J = BB.jobs, wasCalm = G.calm;
    // (only with the driving camera: not in the garage or on the home screen, in the workshop at the depot)
    G.calm = !!((B.atStop || (B.isSettling && B.isSettling()) || (J && J.phase === 'tow') || B.inWash) && B.camMode === 'chase' && !B.inWorkshop);
    G.calmT = G.calm ? 0 : wasCalm ? 0 : G.calmT + dt;
    // the bay the bus is heading for (people wait there, a scene may be staged on its kerb), and the one it stands at
    // until it drives off again (the people getting off walk away there; the side view looks at it)
    const tg = B.target && B.target.pos ? B.target : B.atStop && B.atStop.pos ? B.atStop : null;
    // (a stop's queue stands along the kerb for up to 12 units: nobody strolls near it, so the people waiting are
    //  easy to tell apart and to count)
    if (tg) { G.tx = tg.pos.x; G.tz = tg.pos.z; G.tr = tg.kind === 'scene' || tg.place ? 24 : 20; } else G.tr = 0;
    stopView(); svPlan(); eventGeom(dt); friendGeom(dt);
  }

  // Where the side view at a stop will look. bus.js plans it once per stop from the kerb side, about 12 back from the
  // bay and straight across the road (a job's scene may stand further back, and wider on phones): worked out here from
  // the bay alone, as soon as the bus is near it, so whatever would stand in that view can step out of it, unseen,
  // before the camera swings round.
  const SV = { on: false, ok: false, st: null, asp: 0, ax: 0, az: 0, nx: 0, nz: 1, ux: 1, uz: 0, bx: 0, bz: 0, tan: 1 };
  function stopView() {
    const B = BB.bus, G = BUSG;
    let st = B.atStop || null;
    if (!st && B.target && B.target.pos && hypot2(B.target.pos.x - G.mx, B.target.pos.z - G.mz) < 90) st = B.target;
    SV.on = !!st;
    if (!st) { SV.st = null; SV.ok = false; return; }
    const cam = BB.camera, asp = cam ? cam.aspect : 1.5;
    if (st === SV.st && asp === SV.asp) return;
    SV.st = st; SV.asp = asp; SV.ok = false;
    if (st.edge == null && !st._bay && st.kind !== 'scene' && !st.place) return;     // (no bay to go by)
    let bay = null; try { bay = W.bayOf(st); } catch (e) { bay = null; }
    if (!bay || !bay.side || !bay.fwd) return;
    const scene = st.kind === 'scene' || !!st.place, back = scene ? 22 : 15;
    SV.bx = bay.x; SV.bz = bay.z; SV.nx = -bay.side.x; SV.nz = -bay.side.z; SV.ux = bay.fwd.x; SV.uz = bay.fwd.z;
    SV.ax = bay.x + bay.side.x * back; SV.az = bay.z + bay.side.z * back;
    const fov = scene && innerWidth <= 700 ? 68 : cam ? cam.fov : 50;
    SV.tan = Math.tan(Math.min(1.35, Math.atan(Math.tan(fov * Math.PI / 360) * asp) + (scene ? 0.3 : 0.14)));
    SV.ok = true;
  }
  function inStopView(x, z) {
    const dx = x - SV.ax, dz = z - SV.az, a = dx * SV.nx + dz * SV.nz;
    if (a < 0.5 || a > 150) return false;
    const l = dx * SV.ux + dz * SV.uz;
    return (l < 0 ? -l : l) < a * SV.tan + 8;
  }
  // Which bits of pavement that view will really show: in its wedge and not behind a building, as seen from where its
  // camera will stand (two spots, for the different buses and screens). Each stretch of pavement near the stop is
  // sampled every 3 units, once per stop, a few looks a frame (at most SV_LOOKS sight lines, so it never costs more
  // than about a tenth of a millisecond on a frame); walkers only keep out of the bits it shows (a stretch not looked
  // at yet counts as all in view). svVis[stretch]: undefined (not yet), null (none), or spans [s0, s1, s0, s1...].
  const svVis = [], svQueue = [], SV_LOOKS = 14;
  const svCur = { gi: -1, s: 0, open: -1, spans: null };
  let svFor = null;
  function svPlan() {
    if (!SV.ok) return;
    if (svFor !== SV.st) {
      svFor = SV.st; svQueue.length = 0; svCur.gi = -1;
      for (let gi = 0; gi < folkSegs.length; gi++) {
        svVis[gi] = undefined;
        const g = folkSegs[gi]; if (hypot2(g.cx - SV.ax, g.cz - SV.az) < 150 + g.r) svQueue.push(gi);
      }
    }
    // (the camera stands 10-12 back at 4.5-9 high; a scene's further back: looked from a little higher than that, and
    //  from 3.5 out, so a wall right behind where it will stand doesn't count)
    const scene = SV.st && (SV.st.kind === 'scene' || SV.st.place), back = scene ? 18 : 11, sx = -SV.nx, sz = -SV.nz;
    let looks = SV_LOOKS, samples = 80;
    while (looks > 0 && samples > 0) {
      if (svCur.gi < 0) { if (!svQueue.length) return; svCur.gi = svQueue.pop(); svCur.s = 0; svCur.open = -1; svCur.spans = []; }
      const gi = svCur.gi, g = folkSegs[gi], spans = svCur.spans;
      const s = svCur.s, end = s > g.len;
      let vis = false;
      samples--;
      if (!end) {
        const q = lineAt(g.line, s), x = q.x, z = q.z;
        if (inStopView(x, z)) {
          for (let e = 0; e < 2 && !vis; e++) {
            const al = e ? 6.5 : 1.5, ex = SV.bx + sx * back + SV.ux * al, ez = SV.bz + sz * back + SV.uz * al;
            const l = hypot2(x - ex, z - ez), t = l > 4 ? 3.5 / l : 0;
            looks--;
            vis = !W.blocksSight(ex + (x - ex) * t, 9 + (2.1 - 9) * t, ez + (z - ez) * t, x, 2.1, z);
          }
        }
      }
      if (vis && svCur.open < 0) svCur.open = s;
      if (!vis && svCur.open >= 0) { spans.push(svCur.open - 3, s); svCur.open = -1; }   // (3 either side of the samples seen)
      if (end) { svVis[gi] = spans.length ? spans : null; svCur.gi = -1; } else svCur.s = s + 3;
    }
  }
  // Will the stop's side view show a walker at (x, z), at s along stretch gi?
  function walkerInView(gi, s, x, z) {
    const v = svVis[gi];
    if (svFor !== SV.st || v === undefined) return inStopView(x, z);
    if (v === null) return false;
    for (let k = 0; k < v.length; k += 2) if (s >= v[k] && s <= v[k + 1]) return true;
    return false;
  }

  // A town event on the ground (a parade, the otters, a kiosk, a fire engine...): where its things are and how they
  // move, so walkers and cars keep out of their way. Looked up four times a second and moved on along their way in
  // between. Its vehicles (a fire engine, the rubbish truck...) are a line along their length (`hl` either side of
  // the middle, along their heading `ax, az`), not a point, so a car keeps clear of either end.
  const EVN = 10, EVP = { n: 0, x: new Float32Array(EVN), z: new Float32Array(EVN), vx: new Float32Array(EVN), vz: new Float32Array(EVN),
    px: new Float32Array(EVN), pz: new Float32Array(EVN), hl: new Float32Array(EVN), ax: new Float32Array(EVN), az: new Float32Array(EVN) };
  const EV_CARS = { fireTruck: 1, ambulance: 1, police: 1, brokenCar: 1, towTruck: 1, iceCream: 1, milkVan: 1, rubbishTruck: 1 };
  let evT = 0, evAge = 0;
  function eventGeom(dt) {
    const G = BUSG;
    evAge += dt;
    if ((evT -= dt) > 0) {
      const ag = Math.min(evAge, 0.3);
      for (let k = 0; k < EVP.n; k++) { EVP.x[k] = EVP.px[k] + EVP.vx[k] * ag; EVP.z[k] = EVP.pz[k] + EVP.vz[k] * ag; }
      return;
    }
    evT = 0.25;
    const ev = BB.events && BB.events.current, n0 = EVP.n, span = Math.max(0.05, evAge);
    let n = 0; evAge = 0; G.er = 0;
    const add = (x, z, len, h) => {
      if (n >= EVN || !(x === x) || !(z === z)) return;
      // (the same thing as last time, by its place in the list: how fast it moves)
      const same = n < n0 && hypot2(x - EVP.px[n], z - EVP.pz[n]) < 12;
      if (same) { EVP.vx[n] = (x - EVP.px[n]) / span; EVP.vz[n] = (z - EVP.pz[n]) / span; } else { EVP.vx[n] = 0; EVP.vz[n] = 0; }
      // (a vehicle: which way it lies, from its heading)
      const lies = len > 0 && typeof h === 'number' && h === h;
      EVP.ax[n] = lies ? Math.sin(h) : 0; EVP.az[n] = lies ? Math.cos(h) : 0;
      EVP.hl[n] = lies ? Math.min(6, len / 2) : 0;
      EVP.x[n] = EVP.px[n] = x; EVP.z[n] = EVP.pz[n] = z; n++;
    };
    if (ev && ev.id !== 'fireworks' && ev.id !== 'plane') {
      try { const a = ev.at && ev.at(); if (a) { G.ex = a.x; G.ez = a.z; G.er = 26; add(a.x, a.z, 0, null); } } catch (e) { /* no place */ }
      try { const sp = ev.spots && ev.spots(); if (sp) for (let k = 0; k < sp.length; k++) { const q = sp[k]; if (q) add(+q[1], +q[3], EV_CARS[q[0]] ? +q[6] || 0 : 0, q[8]); } } catch (e) { /* no spots */ }
    }
    EVP.n = n;
  }
  // how far (x, z) is from event thing k (along its length, for a vehicle), and the nearest point of it (_ep)
  const _ep = { x: 0, z: 0 };
  function evDist(k, x, z) {
    const hl = EVP.hl[k], cx = EVP.x[k], cz = EVP.z[k];
    if (hl > 0) { const a = BB.clamp((x - cx) * EVP.ax[k] + (z - cz) * EVP.az[k], -hl, hl); _ep.x = cx + EVP.ax[k] * a; _ep.z = cz + EVP.az[k] * a; }
    else { _ep.x = cx; _ep.z = cz; }
    return hypot2(x - _ep.x, z - _ep.z);
  }
  const nearEvent = (x, z, r) => { for (let k = 0; k < EVP.n; k++) if (evDist(k, x, z) < r) return true; return false; };

  // Friends' rides (playing together): where each one is and which way it is going (from its last two places heard),
  // as a straight line from its nose to well behind it (long enough for a bendy bus). Looked up twice a second and
  // moved on along its way in between. Each device has its own walkers and town cars, so they make way for these too.
  const FRN = 9, FRIENDS = [], FRI = new Int8Array(FRN), frUsed = new Uint8Array(FRN);
  for (let i = 0; i < FRN; i++) FRIENDS.push({ id: null, x: 0, z: 0, fx: 0, fz: 1, speed: 0, t: 0, known: false, p: new Float32Array(8), mx: 0, mz: 0 });
  let frN = 0, frT = 0, frClock = 0;
  function friendGeom(dt) {
    frClock += dt;
    if ((frT -= dt) <= 0) {
      frT = 0.4;
      const N = BB.net;
      let list = null;
      if (N && typeof N.driving === 'function' && typeof N.status === 'function') { try { if (N.status() === 'together') list = N.driving(); } catch (e) { list = null; } }
      // (a fixed pool of slots matched by id, so each friend keeps its heading)
      frUsed.fill(0);
      const m = list ? Math.min(list.length, FRN) : 0;
      for (let pass = 0; pass < 2; pass++) for (let j = 0; j < m; j++) {
        const q = list[j]; if (!q || !(q.x === q.x) || !(q.z === q.z)) continue;
        let k = -1;
        if (pass === 0) { for (let s = 0; s < FRN; s++) if (!frUsed[s] && FRIENDS[s].id === q.id) { k = s; break; } }
        else {
          let done = false; for (let s = 0; s < FRN; s++) if (frUsed[s] && FRIENDS[s].id === q.id) { done = true; break; }
          if (done) continue;
          for (let s = 0; s < FRN; s++) if (!frUsed[s]) { k = s; break; }
        }
        if (k < 0) continue;
        const o = FRIENDS[k]; frUsed[k] = 1;
        if (pass === 1 || o.id !== q.id) { o.id = q.id; o.known = false; o.speed = 0; }
        else {
          const mv = hypot2(q.x - o.x, q.z - o.z), el = Math.max(0.1, frClock - o.t);
          if (mv > 0.4 && mv < 30) { o.fx = (q.x - o.x) / mv; o.fz = (q.z - o.z) / mv; o.known = true; o.speed = Math.min(16, mv / el); } else o.speed *= 0.5;
        }
        o.x = q.x; o.z = q.z; o.t = frClock;
      }
      frN = 0;
      for (let s = 0; s < FRN; s++) { if (frUsed[s]) FRI[frN++] = s; else FRIENDS[s].id = null; }
    }
    for (let k = 0; k < frN; k++) {
      const o = FRIENDS[FRI[k]], p = o.p, ah = Math.min(0.6, frClock - o.t) * o.speed, x = o.x + o.fx * ah, z = o.z + o.fz * ah;
      if (o.known) { p[0] = x + o.fx * 6.5; p[1] = z + o.fz * 6.5; p[6] = x - o.fx * 11; p[7] = z - o.fz * 11; }
      else { p[0] = p[6] = x; p[1] = p[7] = z; }
      p[2] = p[4] = (p[0] + p[6]) / 2; p[3] = p[5] = (p[1] + p[7]) / 2;
      o.mx = p[2]; o.mz = p[3];
    }
  }
  // how near (x, z) is to a friend's ride (one whose heading isn't known yet counts as a wide circle)
  function friendDist(x, z) {
    let m = 1e9;
    for (let k = 0; k < frN; k++) { const o = FRIENDS[FRI[k]], d = lineD(o.p, x, z) - (o.known ? 0 : 6); if (d < m) m = d; }
    return m;
  }

  // ---------- townsfolk: people strolling along the pavements ----------
  // Every stretch of pavement that is free to walk (clear of buildings, shelters and the yard) has a few people on it,
  // about one every 10 units in the town, every 13 in old town and by the sea, fewer on the other outer roads. They
  // go round in a loop: out along the kerb-side lane of the pavement and back along the other, and where each one is
  // follows from the clock, plus how long it has stood still (`lag`). Nobody ever walks into, or through, somebody
  // ahead in the same lane: a walker comes up behind them, slows down and stands a step behind until there is room
  // (a waver, someone waiting to turn round); one who turns round only steps into the other lane where there is room
  // there, else waits a moment for the people in it to pass; and a hurry (catching up after a wave, getting out of a
  // place to keep clear) stops a few steps behind the next one. Someone who isn't out (gone home, or stepped out of
  // sight) never holds anybody up, gets out of their way unseen, and only comes back where there is room.
  // Only the ones the camera can see are drawn (one instanced mesh, FOLK_MAX at most), with legs and arms swinging
  // in the vertex shader.
  // They notice the bus: as it drives past, someone stops, turns and waves (children give a little hop), and when the
  // horn sounds everybody near hops and waves. In the rain they put up umbrellas; at night and in a storm most have
  // gone home. They keep out of the way where the game needs a clear view or a clear kerb: round the bay the bus is
  // heading for, in whatever its side view will show there (so the only people to count are the ones in the question),
  // round a town event, under the bus or a friend's ride, and wherever a stop's view is on.
  // Nobody ever pops in or out in plain view: someone who should go only goes while the camera can't see them (out of
  // its view, behind a building, behind the bus, or in the moment the camera swings round to or from a stop's side
  // view), and people walking towards a place that must stay clear turn round at its edge instead, and hurry out of it
  // if they are inside. Only when the bus (or a friend's) drives right onto them do they step away at once.
  const FOLK_MAX = 40;
  let folk = null, folkMat = null, folkClock = 0, folkR = 118, folkN = 0;
  const folkSegs = [];                      // {line, len, y, sd, v, cx, cz, r, i0, n}
  let FS = null;                            // per-walker numbers (typed arrays), see buildFolk
  const folkShown = new Int16Array(FOLK_MAX);   // which walkers were drawn last frame (for the horn)
  const folkU = { uRain: { value: 0 }, uWet: wetU };
  function folkGeometry() {
    const b = BB.mk.builder(), PANTS = '#4a5a78', part = [], tint = [];
    const add = (p, t) => { part.push(p); tint.push(t); };
    // part: 0 body, 1 left leg, 2 right leg, 3 left arm, 4 right arm (the waving one), 5 umbrella, 6 shadow
    // tint: 0 as painted, 1 shirt, 2 skin, 3 hair, 4 umbrella
    const disc = new THREE.CircleGeometry(0.46, 6); disc.rotateX(-Math.PI / 2);
    b.add(disc, '#c9b791', 0.08, 0.05, 0.06); add(6, 0);
    b.box(0.22, 0.8, 0.24, PANTS, -0.13, 0, 0); add(1, 0);
    b.box(0.22, 0.8, 0.24, PANTS, 0.13, 0, 0); add(2, 0);
    b.add(new THREE.CylinderGeometry(0.26, 0.32, 0.85, 6, 1, true), '#ffffff', 0, 0.78 + 0.425, 0); add(0, 1);
    b.ball(0.27, '#ffffff', 0, 1.9, 0); add(0, 2);
    b.ball(0.28, '#ffffff', 0, 2.0, -0.05, 0, 1, 0.7, 1); add(0, 3);
    b.box(0.12, 0.6, 0.14, '#ffffff', -0.36, 0.95, 0); add(3, 1);
    b.box(0.12, 0.6, 0.14, '#ffffff', 0.36, 0.95, 0); add(4, 1);
    b.box(0.05, 1.5, 0.05, '#6b5a4a', -0.24, 1.1, 0.14); add(5, 0);
    b.add(new THREE.ConeGeometry(0.98, 0.4, 7, 1, true), '#ffffff', -0.24, 2.48 + 0.2, 0.14); add(5, 4);
    const geo = b.geometry(), counts = b.counts;
    let total = 0; for (let k = 0; k < counts.length; k++) total += counts[k];
    const aPart = new Float32Array(total), aTint = new Float32Array(total);
    for (let k = 0, o = 0; k < counts.length; k++) for (let v = 0; v < counts[k]; v++, o++) { aPart[o] = part[k]; aTint[o] = tint[k]; }
    geo.setAttribute('aPart', new THREE.BufferAttribute(aPart, 1)); geo.setAttribute('aTint', new THREE.BufferAttribute(aTint, 1));
    const inst = (name, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(FOLK_MAX * size), size); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a; };
    inst('iShirt', 4); inst('iSkin', 3); inst('iHair', 3); inst('iAnim', 4);   // iShirt.w = hop height; iAnim = stride phase, stride, arm lift, umbrella colour
    return geo;
  }
  function folkMaterial() {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRain = folkU.uRain; sh.uniforms.uWet = folkU.uWet;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPart; attribute float aTint; attribute vec4 iShirt; attribute vec3 iSkin; attribute vec3 iHair; attribute vec4 iAnim; uniform float uRain; uniform float uWet;')
        .replace('#include <color_vertex>', `#include <color_vertex>
          if (aTint > 3.5) vColor = iAnim.w < 0.25 ? vec3(1.0, 0.42, 0.36) : iAnim.w < 0.5 ? vec3(1.0, 0.76, 0.2) : iAnim.w < 0.75 ? vec3(0.1, 0.65, 0.61) : vec3(0.62, 0.5, 0.92);
          else if (aTint > 2.5) vColor = iHair; else if (aTint > 1.5) vColor = iSkin; else if (aTint > 0.5) vColor = iShirt.rgb;
          else if (aPart > 5.5) vColor *= uWet;                                  // (the shadow, on wet paving)`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          if (aPart > 0.5 && aPart < 4.5) {
            // legs swing from the hips, arms the other way from the shoulders
            float sw = sin(iAnim.x) * iAnim.y * (aPart < 1.5 || aPart > 3.5 ? 1.0 : -1.0);
            float py = aPart < 2.5 ? 0.8 : 1.5, a = sw * (aPart < 2.5 ? 0.62 : 0.5);
            if (aPart > 2.5 && aPart < 3.5) a *= 1.0 - uRain;                    // (the left hand holds the umbrella still)
            float c = cos(a), s = sin(a); vec2 q = transformed.yz - vec2(py, 0.0);
            transformed.yz = vec2(q.x * c + q.y * s, -q.x * s + q.y * c) + vec2(py, 0.0);
            if (aPart > 3.5) {                                                   // the right arm goes up to wave
              float c2 = cos(iAnim.z), s2 = sin(iAnim.z); vec2 w = transformed.xy - vec2(0.36, 1.5);
              transformed.xy = vec2(w.x * c2 - w.y * s2, w.x * s2 + w.y * c2) + vec2(0.36, 1.5);
            }
          } else if (aPart > 4.5 && aPart < 5.5) {                               // the umbrella opens in the rain
            transformed = vec3(-0.24, 1.2, 0.14) + (transformed - vec3(-0.24, 1.2, 0.14)) * uRain;
          }
          if (aPart < 5.5) transformed.y += iShirt.w;                            // a hop (the shadow stays on the ground)`);
    };
    return m;
  }
  // The two walking lanes, measured in from the kerb: 1.5 and 2.3. (Lamp posts stand 0.7 in, and the paving is 2.6
  // wide round a block and 3 wide along the outer roads, so both lanes are on the paving and clear of the posts.)
  const FOLK_MID = 1.9, FOLK_HALF = 0.4;
  // Is this spot of pavement free to walk on, in both lanes? ((lx, lz) points across the pavement)
  function walkable(x, z, lx, lz, bays) {
    if (W.inDepotYard(x, z)) return false;
    for (let i = 0; i < bays.length; i++) { const q = bays[i]; if (hypot2(q.x - x, q.z - z) < q.r) return false; }
    for (let k = -1; k <= 1; k += 2) {
      const px = x + lx * FOLK_HALF * k, pz = z + lz * FOLK_HALF * k;
      if (W.pushOut(px, pz, 0.3).hit > 0.001 || onRoad(px, pz, 0.45)) return false;
    }
    return true;
  }
  // Is (x, z) on a road, or within m of its kerb? (where another road crosses or joins the one a pavement runs along)
  function onRoad(x, z, m) {
    const edges = W.roads.edges;
    for (let n = 0; n < edges.length; n++) {
      const e = edges[n], p = e.points, r = (e.half || RH) + m;
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], c = p[i], dx = c.x - a.x, dz = c.z - a.z, l2 = dx * dx + dz * dz;
        let t = l2 > 1e-6 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ox = a.x + dx * t - x, oz = a.z + dz * t - z;
        if (ox * ox + oz * oz < r * r) return true;
      }
    }
    return false;
  }
  function buildFolk() {
    const bays = W.stops.map((st) => ({ x: st.pos.x, z: st.pos.z, r: st.minor ? 5 : 8.5 }));
    bays.push({ x: W.places.fireStation.pos.x, z: W.places.fireStation.pos.z, r: 15 }, { x: W.places.clinic.pos.x, z: W.places.clinic.pos.z, r: 5 });
    const slots = [], runs = [];
    for (const e of W.roads.edges) {
      if (e.kind !== 'town' && e.kind !== 'outer') continue;
      if (/^A[JP]/.test(e.a) || /^A[JP]/.test(e.b)) continue;                       // (not round the airport's drop-off loop)
      const s0 = nodeHalf(nodeById[e.a]) + 3.5, s1 = e.length - nodeHalf(nodeById[e.b]) - 3.5;
      for (const sd of [1, -1]) {
        const off = (e.half + FOLK_MID) * sd;
        let run = -1;
        for (let s = s0; ; s += 1) {
          const end = s > s1;
          let ok = false;
          if (!end) { const p = W.pointAt(e, s); ok = walkable(p.x + p.dz * off, p.z - p.dx * off, p.dz, -p.dx, bays); }
          if (ok && run < 0) run = s;
          if (!ok && run >= 0) { if (s - 1 - run >= 14) runs.push({ e, a: run, c: s - 1, off, sd, pts: null }); run = -1; }
          if (end) break;
        }
      }
    }
    // Where two stretches meet (round a corner, across a side street), the end of one is kept 3.5 from the other, so
    // the people turning round at its end never stand in the other stretch's people (each stretch's people keep a step
    // apart, but they don't know about the next stretch's).
    // (an edge's own point just after the start or before the end is left out: two points that close, with their
    // different turns, would put a little backward kink in the line once it is moved out onto the pavement, and the
    // people there would walk back over the same spot)
    const tidy = (pts) => {
      const out = [pts[0]], last = pts[pts.length - 1];
      for (let i = 1; i < pts.length - 1; i++) { const q = out[out.length - 1]; if (hypot2(pts[i].x - q.x, pts[i].z - q.z) >= 2 && hypot2(pts[i].x - last.x, pts[i].z - last.z) >= 2) out.push(pts[i]); }
      out.push(last);
      return out;
    };
    const runPts = (r) => r.pts || (r.pts = offsetLine(tidy(subPts(r.e, r.a, r.c)), r.off));
    const runEnd = (r, s) => { const p = W.pointAt(r.e, s); return { x: p.x + p.dz * r.off, z: p.z - p.dx * r.off }; };
    const nearRun = (q, x, z, m) => {
      const pt = runPts(q);
      for (let i = 1; i < pt.length; i++) if (segD(x, z, pt[i - 1].x, pt[i - 1].z, pt[i].x, pt[i].z) < m) return true;
      return false;
    };
    for (const r of runs) for (let end = 0; end < 2; end++) {
      for (let k = 0; k < 10 && r.c - r.a >= 14; k++) {
        const p = runEnd(r, end ? r.c : r.a);
        let clash = false;
        for (const q of runs) if (q !== r && q.c - q.a >= 14 && hypot2(q.e.points[0].x - p.x, q.e.points[0].z - p.z) < q.e.length + 20 && nearRun(q, p.x, p.z, 3.5)) { clash = true; break; }
        if (!clash) break;
        if (end) r.c -= 1; else r.a += 1;
        r.pts = null;
      }
    }
    for (const r of runs) {
      if (r.c - r.a < 14) continue;
      const e = r.e, line = flatLine(runPts(r)), mid = lineAt(line, line.len / 2), mx = mid.x, mz = mid.z;
      const lively = e.kind === 'town' || mx < -175 || mz > 170;            // the town, old town, the seaside
      const n = Math.max(1, Math.round(line.len / (e.kind === 'town' ? 10 : lively ? 13 : 24)));
      const seg = { line, len: line.len, y: W.groundY(mx, mz) > 0 ? 0.25 : 0.2, sd: r.sd, v: lr(1.15, 1.6), cx: mx, cz: mz, r: line.len / 2 + 2, i0: slots.length, n };
      const ph0 = lrnd();
      for (let k = 0; k < n; k++) slots.push({ seg: folkSegs.length, phase: ((k + ph0 + lr(-0.2, 0.2)) / n) * 2 * line.len });
      folkSegs.push(seg);
    }
    const NS = slots.length, f32 = () => new Float32Array(NS);
    FS = { n: NS, seg: new Uint16Array(NS), phase: f32(), hash: f32(), kid: new Uint8Array(NS), shirt: new Uint8Array(NS), skin: new Uint8Array(NS), hair: new Uint8Array(NS), brolly: f32(),
      lag: f32(), waveT: f32(), cool: f32(), hop: f32(), wv: f32(), vis: f32(), here: new Uint8Array(NS),
      // the turn round at a clear place's edge (lateral place and heading eased, a little wait before the next one),
      // the frame each was last in view, and whether it was last found hidden behind something
      lw: f32(), hd: f32(), tb: f32(), seenF: new Uint32Array(NS), occ: new Uint8Array(NS), occAt: f32(),
      // where on the loop each one is this frame, how much it has stopped to let somebody ahead get on (0 walking,
      // 1 standing), and whether it is waiting for room in the other lane to turn round
      u: f32(), st: f32(), hold: new Uint8Array(NS) };
    for (let i = 0; i < NS; i++) {
      FS.seg[i] = slots[i].seg; FS.phase[i] = slots[i].phase; FS.hash[i] = lrnd(); FS.kid[i] = lrnd() < 0.3 ? 1 : 0;
      FS.shirt[i] = Math.floor(lrnd() * SHIRTS.length); FS.skin[i] = Math.floor(lrnd() * SKINS.length); FS.hair[i] = Math.floor(lrnd() * HAIRS.length);
      FS.brolly[i] = lrnd(); FS.hop[i] = 9; FS.cool[i] = lr(0, 6); FS.vis[i] = 1; FS.here[i] = 1; FS.occAt[i] = -9;
    }
    folkMat = folkMaterial();
    folk = new THREE.InstancedMesh(folkGeometry(), folkMat, FOLK_MAX);
    folk.name = 'folk'; folk.frustumCulled = false; folk.count = 0; folk.matrixAutoUpdate = false;
    folk.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return folk;
  }
  const FCOL = { shirt: null, skin: null, hair: null };
  const colTable = (list) => { const a = new Float32Array(list.length * 3), c = new THREE.Color(); list.forEach((h, i) => { c.set(h); a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }); return a; };
  // Should a walker at (x, z) be out and about? 1 yes; 0 no (they go when nobody can see them); -1 no, at once (the
  // bus, a friend's ride or an event's vehicle is right on top of them).
  function folkWant(here, x, z, gi, s) {
    const G = BUSG;
    if (!G.ok) return here;
    if (busDist(x, z) < 2.3 || (frN && friendDist(x, z) < 2.4)) return -1;
    for (let k = 0; k < EVP.n; k++) if (evDist(k, x, z) < 2.2) return -1;
    if (!here) return 0;
    if (G.tr > 0 && hypot2(x - G.tx, z - G.tz) < G.tr) return 0;
    if (G.er > 0 && hypot2(x - G.ex, z - G.ez) < G.er) return 0;
    if (SV.on && SV.ok) { if (walkerInView(gi, s, x, z)) return 0; }
    else if (G.calm) return 0;                     // (a stop with no bay to go by: nobody about)
    return 1;
  }
  // Is (x, z) hidden from the camera right now, behind a building? (head and both shoulders: hidden only if all three
  // are, so nobody peeps out past a corner; the bus doesn't count, its windows are glass and at a stop its near side is
  // cut away.) A few looks a frame, each one kept for a moment.
  let occBudget = 0, folkFrame = 1;
  function folkHidden(i, x, z) {
    if (folkClock - FS.occAt[i] < 0.3) return FS.occ[i] === 1;
    if (occBudget <= 0) return false;
    occBudget--; FS.occAt[i] = folkClock;
    const V = CAMG, dx = x - V.x, dz = z - V.z, l = hypot2(dx, dz) || 1, sx = -dz / l * 0.55, sz = dx / l * 0.55;
    const hid = W.blocksSight(V.x, V.y, V.z, x, 2.1, z) && W.blocksSight(V.x, V.y, V.z, x + sx, 1.7, z + sz) && W.blocksSight(V.x, V.y, V.z, x - sx, 1.7, z - sz);
    FS.occ[i] = hid ? 1 : 0;
    return hid;
  }
  function updateFolk(dt) {
    const G = BUSG, V = CAMG;
    if (!folk || !V.ok || !FS) return;
    if (!FCOL.shirt) { FCOL.shirt = colTable(SHIRTS); FCOL.skin = colTable(SKINS); FCOL.hair = colTable(HAIRS); }
    folkClock += dt;
    const frame = ++folkFrame;
    occBudget = 6;
    // (walkers outside the wedge the camera sees along the ground aren't drawn)
    const cx = V.x, cz = V.z, fx = V.fx, fz = V.fz, flat = V.flat, cosW = V.cosW;
    const night = W.sky.night, rainUp = BB.clamp((wx.rain - 0.1) / 0.2, 0, 1);
    folkU.uRain.value += BB.clamp(rainUp - folkU.uRain.value, -dt * 1.2, dt * 1.6);
    const awake = 1 - 0.62 * night - 0.3 * wx.storm;                                // who is out and about
    // The camera swinging round to or from a stop's side view: the picture moves so fast that somebody stepping out
    // of it (or back in) isn't noticed. On the way round to the side view everybody it sweeps over steps out (it
    // comes to rest within a few degrees of where it last swung fast, so whatever it will show has been swept, even
    // where the guess of that view was wrong); once it slows down, nobody walks into the picture (they turn round at
    // its edge). And if the side view has stood still a moment (0.3 s) with somebody still in it who shouldn't be,
    // they go then (a last resort, hardly ever needed).
    const swing = V.spin > 0.55 && (G.calm || G.calmT < 2.5), sweep = swing && G.calm, lastCall = G.calm && V.still > 0.3;
    const im = folk.instanceMatrix.array, A = folk.geometry.attributes, aS = A.iShirt.array, aK = A.iSkin.array, aH = A.iHair.array, aA = A.iAnim.array;
    const T = 0.9, R = folkR;
    let n = 0, over = false;
    const halfW = Math.acos(BB.clamp(cosW, -1, 1));
    for (let gi = 0, gl = folkSegs.length; gi < gl; gi++) {
      const g = folkSegs[gi], gx = g.cx - cx, gz = g.cz - cz, gd = hypot2(gx, gz);
      if (gd > R + g.r) continue;
      // (a stretch wholly outside the camera's wedge: nobody on it is placed, except the quarter looked at this frame)
      const segOut = flat && gd > g.r + 9 && halfW + Math.asin(g.r / gd) < Math.PI && (gx * fx + gz * fz) < gd * Math.cos(halfW + Math.asin(g.r / gd));
      const L = g.len, loop = 2 * L, i0 = g.i0, iEnd = g.i0 + g.n;
      // where everybody on this stretch is on its loop, before anyone's step changes this frame
      for (let i = i0; i < iEnd; i++) { const u0 = ((folkClock - FS.lag[i]) * g.v + FS.phase[i]) % loop; FS.u[i] = u0 < 0 ? u0 + loop : u0; }
      for (let i = i0; i < iEnd; i++) {
        // the nearest walker who is out (vis > 0) ahead on the loop (in this lane, going this way), and behind; for one
        // who isn't out, the nearest ahead whether out or not (so the ones out of sight never bunch up either, and
        // never come back out together in one spot)
        const ui = FS.u[i], out = FS.vis[i] > 0;
        let ahead = loop, behind = loop;
        for (let j = i0; j < iEnd; j++) {
          if (j === i) continue;
          const oj = FS.vis[j] > 0;
          if (!oj && out) continue;
          let dj = FS.u[j] - ui; if (dj < 0) dj += loop;
          if ((dj > 0 || j < i) && dj < ahead) ahead = dj;                   // (side by side: the lower number is ahead)
          if (!oj) continue;
          const bj = dj > 0 ? loop - dj : 0; if ((dj > 0 || j > i) && bj < behind) behind = bj;
        }
        // waving: stand still while the arm is up. Coming up behind somebody: slow down, and stand a step behind them
        // (also while waiting for room to turn round). One who isn't out falls back, or hurries ahead, unseen.
        let wv = FS.wv[i];
        if (FS.waveT[i] > 0) { FS.waveT[i] -= dt; wv = Math.min(1, wv + dt * 5); } else if (wv > 0) wv = Math.max(0, wv - dt * 4);
        FS.wv[i] = wv;
        let stT = ahead < 2.6 ? Math.min(1, (2.6 - ahead) / 1.1) : 0;
        if (FS.hold[i]) { stT = 1; FS.hold[i] = 0; }
        if (!out) stT = ahead < 2.6 && ahead <= behind ? 1 : 0;
        const st = FS.st[i] + BB.clamp(stT - FS.st[i], -dt * 3, dt * 5), stop = wv > st ? wv : st;
        FS.st[i] = st;
        // (then a little hurry to be back in step, but never into the one ahead)
        if (stop > 0) FS.lag[i] += dt * stop;
        else if (FS.lag[i] > 0 && ahead > 3.2) FS.lag[i] = Math.max(0, FS.lag[i] - dt * 0.45 * Math.min(1, (ahead - 3.2) / 3));
        if (!out && stT === 0 && behind < 2.6) FS.lag[i] -= dt * 1.2;
        if (FS.cool[i] > 0) FS.cool[i] -= dt;
        if (FS.tb[i] > 0) FS.tb[i] -= dt;
        if (FS.hop[i] < 1) FS.hop[i] += dt;
        if (segOut && ((i + frame) & 3) !== 0) continue;
        // where on the loop: out along the kerb half (w = 0), back along the other half (w = 1), a turn at each end
        let u = ((folkClock - FS.lag[i]) * g.v + FS.phase[i]) % loop; if (u < 0) u += loop;
        let w, turn;
        if (u > L - T && u < L + T) { w = (u - L + T) / (2 * T); turn = w; }
        else if (u > loop - T) { w = 1 - (u - loop + T) / (2 * T); turn = 2 - w; }
        else if (u < T) { w = 0.5 - u / (2 * T); turn = 2 - w; }
        else { w = u < L ? 0 : 1; turn = w; }
        const sAt = u < L ? u : loop - u, ws = w * w * (3 - 2 * w), p = lineAt(g.line, sAt), px = p.x, pz = p.z, pdx = p.dx, pdz = p.dz;
        const walkH = Math.atan2(pdx, pdz) + Math.PI * g.sd * turn;
        // seen by the camera? (the line between the two walking lanes, 0.4 either side, is near enough)
        const dx = px - cx, dz = pz - cz, d = hypot2(dx, dz);
        if (d > R || (flat && d > 9 && dx * fx + dz * fz < cosW * d)) {
          // out of sight: people go home and come out again, and step out of (or back into) a place to keep clear
          // (looked at every fourth frame, a quarter of them each frame: nobody sees them meanwhile)
          if (((i + frame) & 3) !== 0) continue;
          FS.here[i] = FS.hash[i] < awake ? 1 : 0;
          const lt = FOLK_HALF * (2 * ws - 1) * g.sd;
          // (and back out only where there is room, and at a stop not where its side view looks)
          const ox = px + pdz * lt, oz = pz - pdx * lt;
          FS.vis[i] = folkWant(FS.here[i], ox, oz, gi, sAt) > 0 && (out || (ahead > 2.2 && behind > 2.2)) && !(G.calm && inPicture(ox, oz)) ? 1 : 0;
          continue;
        }
        // in view: a turn round eases across (place and heading), from where they were if they were in view last frame
        if (FS.seenF[i] !== frame - 1) { FS.lw[i] = ws; FS.hd[i] = walkH; }
        else { FS.lw[i] += BB.clamp(ws - FS.lw[i], -dt * 3, dt * 3); FS.hd[i] += BB.clamp(wrapPi(walkH - FS.hd[i]), -dt * 4.5, dt * 4.5); }
        FS.seenF[i] = frame;
        const lat = FOLK_HALF * (2 * FS.lw[i] - 1) * g.sd, x = px + pdz * lat, z = pz - pdx * lat;
        // in plain view nobody pops in or out: a change waits until they're hidden (behind a building or the bus), or
        // for the camera's swing at a stop; only the bus (or a friend's ride, or an event's vehicle) right on top of
        // them sends them away at once
        let want = folkWant(FS.here[i], x, z, gi, sAt);
        // (at a stop nobody is wanted in the picture: swept out as the camera swings round to it, and afterwards anybody
        // behind a building in it goes while hidden, so nobody steps out from behind one into the view)
        if (want > 0 && G.calm && (sweep || inPicture(x, z))) want = 0;
        // (the side view has come to rest: anybody it really shows, not hidden behind something, must go after all)
        if (want > 0 && lastCall && SV.on && !folkHidden(i, x, z)) want = 0;
        if (want > 0 && !out && (ahead < 2.2 || behind < 2.2)) want = 0;         // (back only where there is room)
        let vis = FS.vis[i];
        if (want < 0) vis = Math.max(0, vis - dt * 6);
        else if (vis !== want) {
          if (swing || (lastCall && want === 0)) vis += BB.clamp(want - vis, -dt * 10, dt * 10);
          else if (vis > 0 && vis < 1) vis = want && vis >= 0.5 ? Math.min(1, vis + dt * 6) : Math.max(0, vis - dt * 6);   // (half way: carry on)
          else if (folkHidden(i, x, z)) vis = want;
        }
        FS.vis[i] = vis;
        // walking towards a place that must stay clear: turn round at its edge; inside one: turn to walk out of it,
        // and hurry a little (round the bay ahead, in its side view near the bay, round a town event)
        if (vis > 0.5 && G.ok) {
          const sg = u < L ? 1 : -1, ax = x + pdx * sg * 1.6, az = z + pdz * sg * 1.6;
          let inside = false, back = false;
          if (G.tr > 0) { const d0 = hypot2(x - G.tx, z - G.tz), d1 = hypot2(ax - G.tx, az - G.tz); if (d0 < G.tr) { inside = true; back = d1 < d0; } else back = d1 < G.tr; }
          if (!back && G.er > 0) { const d0 = hypot2(x - G.ex, z - G.ez), d1 = hypot2(ax - G.ex, az - G.ez); if (d0 < G.er) { inside = true; back = d1 < d0; } else back = back || d1 < G.er; }
          if (!back && SV.on && SV.ok) {
            const d0 = hypot2(x - SV.bx, z - SV.bz);
            if (d0 < 70) { if (walkerInView(gi, sAt, x, z)) { inside = true; back = hypot2(ax - SV.bx, az - SV.bz) < d0; } else back = walkerInView(gi, sAt + sg * 1.6, ax, az); }
          }
          // (at a stop, once the camera has slowed down: the edge of its picture)
          if (!back && G.calm && !swing && !inPicture(x, z) && inPicture(ax, az)) back = true;
          // (and a town event's things coming along the pavement, the otters or a runaway trolley: make way for them)
          for (let k = 0; k < EVP.n && !back; k++) { const d0 = evDist(k, x, z); if (d0 < 7 && evDist(k, ax, az) < d0) back = true; }
          if (back && FS.tb[i] <= 0) {
            // (turning round: into the other lane at the same spot, only where there is room in it; else wait there a
            // moment for the people in that lane to go by)
            const ut = loop - u;
            let room = true;
            for (let j = i0; j < iEnd && room; j++) {
              if (j === i || !(FS.vis[j] > 0)) continue;
              let dj = Math.abs(FS.u[j] - ut); if (dj > L) dj = loop - dj;
              if (dj < 2.6) room = false;
            }
            if (room) { FS.phase[i] = ((FS.phase[i] + loop - 2 * u) % loop + loop) % loop; FS.tb[i] = 2.5; } else FS.hold[i] = 1;
          }
          if (inside && ahead > 3.2) FS.lag[i] -= dt * 0.8 * Math.min(1, (ahead - 3.2) / 2);
        }
        const fade = BB.clamp((R - d) / 14, 0, 1), sc = vis * fade * (FS.kid[i] ? 0.72 : 1);
        if (sc < 0.03) continue;
        if (n >= FOLK_MAX) { over = true; continue; }
        // the bus goes by: stop, turn and wave
        let toBus = 0, near = 0;
        if (G.ok) {
          const bx = G.mx - x, bz = G.mz - z; near = hypot2(bx, bz); toBus = Math.atan2(bx, bz);
          if (want > 0 && FS.cool[i] <= 0 && near < 15 && Math.abs(G.speed) > 1.5 && (FS.kid[i] || FS.hash[i] * 7.3 % 1 < 0.7)) {
            FS.waveT[i] = 2 + Math.random() * 0.9; FS.cool[i] = 15 + Math.random() * 10;
            if (FS.kid[i]) FS.hop[i] = -Math.random() * 0.2;
          }
        }
        const hw = FS.hd[i], h = wv > 0 ? hw + wrapPi(toBus - hw) * (wv * wv * (3 - 2 * wv)) : hw;
        const hop = FS.hop[i] > 0 && FS.hop[i] < 0.42 ? Math.sin(FS.hop[i] / 0.42 * Math.PI) * 0.5 : 0;
        const c = Math.cos(h) * sc, sn = Math.sin(h) * sc, o = n * 16;
        im[o] = c; im[o + 1] = 0; im[o + 2] = -sn; im[o + 3] = 0; im[o + 4] = 0; im[o + 5] = sc; im[o + 6] = 0; im[o + 7] = 0;
        im[o + 8] = sn; im[o + 9] = 0; im[o + 10] = c; im[o + 11] = 0; im[o + 12] = x; im[o + 13] = g.y; im[o + 14] = z; im[o + 15] = 1;
        let q = FS.shirt[i] * 3; aS[n * 4] = FCOL.shirt[q]; aS[n * 4 + 1] = FCOL.shirt[q + 1]; aS[n * 4 + 2] = FCOL.shirt[q + 2]; aS[n * 4 + 3] = hop;
        q = FS.skin[i] * 3; aK[n * 3] = FCOL.skin[q]; aK[n * 3 + 1] = FCOL.skin[q + 1]; aK[n * 3 + 2] = FCOL.skin[q + 2];
        q = FS.hair[i] * 3; aH[n * 3] = FCOL.hair[q]; aH[n * 3 + 1] = FCOL.hair[q + 1]; aH[n * 3 + 2] = FCOL.hair[q + 2];
        // (the stride follows the walker's own clock, so a turn round never jolts the legs)
        aA[n * 4] = ((folkClock - FS.lag[i]) * g.v + FS.hash[i] * 40) * 3.1; aA[n * 4 + 1] = 1 - stop; aA[n * 4 + 2] = wv * (2.55 + 0.4 * Math.sin(folkClock * 11 + i)); aA[n * 4 + 3] = FS.brolly[i];
        folkShown[n] = i;
        n++;
      }
    }
    // (never more than FOLK_MAX: in a very busy street the far ones are left out first)
    folkR = over ? Math.max(60, folkR * 0.95) : Math.min(118, folkR + dt * 6);
    folk.count = n; folkN = n; folk.visible = n > 0;
    if (n) { folk.instanceMatrix.needsUpdate = true; A.iShirt.needsUpdate = true; A.iSkin.needsUpdate = true; A.iHair.needsUpdate = true; A.iAnim.needsUpdate = true; }
  }
  // The horn: everybody near the bus hops and waves.
  BB.on('bus:horn', () => {
    if (!FS || !BUSG.ok) return;
    for (let k = 0; k < folkN; k++) {
      const i = folkShown[k], o = k * 16, im = folk.instanceMatrix.array;
      if (hypot2(im[o + 12] - BUSG.mx, im[o + 14] - BUSG.mz) > 34 || !(FS.vis[i] > 0.5)) continue;
      if (!(FS.hop[i] < 0.42)) FS.hop[i] = -Math.random() * 0.25;
      FS.waveT[i] = Math.max(FS.waveT[i], 1.5 + Math.random() * 0.6); FS.cool[i] = Math.max(FS.cool[i], 5);
    }
    carToot();
  });
  W.folk = () => ({ walkers: FS ? FS.n : 0, stretches: folkSegs.length, shown: folkN });   // (for tools)

  // ---------- town cars: little cars driving round the town's streets ----------
  // TOWN_CARS more of the expressway's cars (the same instanced mesh: no extra draw call) drive round the town, the
  // outer roads and the expressway, turning at random at the junctions. They are polite and never in the way: they
  // keep to the lane by the middle line (the kerb lane, with its bays, stays the bus's), they wait at a junction while
  // the bus (or a friend's ride) is coming to it, a car in front of the bus keeps ahead of it and one behind stays well
  // back (out of the chase camera's sight), and they wait for a town event's things in the road ahead and pull over
  // to the kerb to let an ambulance or a police car by. They come and go only where the camera can't see them: a car
  // left far behind, near a stop in progress, near a town event, or stuck a long time is taken off the street while
  // nobody is looking, and comes back somewhere else, mostly ahead of the bus and out of view, so there is nearly
  // always some traffic to see. Only a car that the bus, a friend's ride or an event's vehicle drives right into is
  // whisked away in view.
  const TOWN_CARS = 10, LANES = [], townCars = [], CAR_FAR = 235;   // (a car further than CAR_FAR from the bus moves to its part of town)
  function buildLanes() {
    const ok = (e) => e.kind !== 'yard' && !/^A[JP]/.test(e.a) && !/^A[JP]/.test(e.b);
    for (const e of W.roads.edges) {
      if (!ok(e)) continue;
      for (const dir of [1, -1]) {
        const L = flatLine(offsetLine(dir > 0 ? e.points : e.points.slice().reverse(), e.kind === 'highway' ? C.lane : C.laneInner));
        L.e = e; L.from = dir > 0 ? e.a : e.b; L.to = dir > 0 ? e.b : e.a; L.next = [];
        const to = nodeById[L.to]; L.nx = to.x; L.nz = to.z; L.junction = to.edges.length >= 3; L.highNode = Math.abs(to.z - HZ) < 1;
        // the stop line before the junction at its far end, and how far in from its near end a car is still in that junction
        L.box = nodeHalf(to); L.stop = L.len - L.box - 3.5; L.clear = nodeHalf(nodeById[L.from]) + 5;
        LANES.push(L);
      }
    }
    for (const L of LANES) {
      for (const M of LANES) if (M.from === L.to && M.e !== L.e) L.next.push(M);
      if (!L.next.length) for (const M of LANES) if (M.from === L.to) L.next.push(M);   // (a dead end: back the way it came)
    }
  }
  // Plan the way from the car's lane into its next one: a curve from a point before the junction to a point after it
  // (bending round where the two lanes' lines cross), or a plain straight run where the road carries on.
  function planTurn(c) {
    const A = c.lane, N = c.next, n = A.n;
    const d1x = (A.x[n - 1] - A.x[n - 2]) / (A.cum[n - 1] - A.cum[n - 2]), d1z = (A.z[n - 1] - A.z[n - 2]) / (A.cum[n - 1] - A.cum[n - 2]);
    const d2x = (N.x[1] - N.x[0]) / N.cum[1], d2z = (N.z[1] - N.z[0]) / N.cum[1];
    const ex = N.x[0] - A.x[n - 1], ez = N.z[0] - A.z[n - 1], cr = d1x * d2z - d1z * d2x;
    c.straight = Math.abs(cr) < 0.25;
    if (c.straight) { c.sEnd = Math.max(1, A.len - 7); c.s2 = Math.min(7, N.len - 1); }
    else {
      const t = (ex * d2z - ez * d2x) / cr, u = (ex * d1z - ez * d1x) / cr, r = t < 0 ? 5 : 9;   // (t < 0: the tight turn, to the left)
      c.sEnd = BB.clamp(A.len + t - r, 1, A.len); c.s2 = BB.clamp(u + r, 0, N.len - 1);
      c.kx = A.x[n - 1] + d1x * t; c.kz = A.z[n - 1] + d1z * t;
    }
    let p = lineAt(A, c.sEnd); c.x0 = p.x; c.z0 = p.z;
    p = lineAt(N, c.s2); c.x2 = p.x; c.z2 = p.z;
    if (c.straight) { c.kx = (c.x0 + c.x2) / 2; c.kz = (c.z0 + c.z2) / 2; }
    const legs = hypot2(c.kx - c.x0, c.kz - c.z0) + hypot2(c.x2 - c.kx, c.z2 - c.kz), chord = hypot2(c.x2 - c.x0, c.z2 - c.z0);
    c.tlen = Math.max(1, (legs + chord) / 2);
  }
  function pickNext(c) {
    const opts = c.lane.next;
    // (straight on a little more often than a turn)
    let best = opts[0], bw = -1;
    for (let i = 0; i < opts.length; i++) {
      const M = opts[i], n = c.lane.n, A = c.lane;
      const dot = (A.x[n - 1] - A.x[n - 2]) * (M.x[1] - M.x[0]) + (A.z[n - 1] - A.z[n - 2]) * (M.z[1] - M.z[0]);
      const wgt = Math.random() * (dot > 0.5 ? 1.6 : 1);
      if (wgt > bw) { bw = wgt; best = M; }
    }
    c.next = best; planTurn(c);
  }
  // Can the camera see a car at (x, z)? (a little wider than the view, for the car's size; nothing past the haze)
  function carSeen(x, z) {
    const V = CAMG; if (!V.ok) return false;
    const dx = x - V.x, dz = z - V.z, d = hypot2(dx, dz);
    if (d > 265) return false;
    return d < 12 || !V.flat || dx * V.fx + dz * V.fz > V.cosW * d - 3;
  }
  // Put a car somewhere new: in the part of town the bus is in, mostly ahead of it (where the camera will soon look),
  // never where the camera can see it (except far off in the haze, where it grows in), not near the bus or a stop in
  // progress or a town event, and clear of the other cars.
  function placeCar(c) {
    const G = BUSG, V = CAMG;
    for (let tries = 0; tries < 10; tries++) {
      const L = LANES[Math.floor(Math.random() * LANES.length)];
      if (L.len < 30) continue;
      const s = 8 + Math.random() * (L.len - 24), p = lineAt(L, s), x = p.x, z = p.z;
      if (G.ok) {
        const dx = x - G.mx, dz = z - G.mz, d = hypot2(dx, dz);
        if (d < 80 || d > CAR_FAR - 30 || (G.calm && d < 95)) continue;
        if (tries < 8 && dx * G.fx + dz * G.fz < 0.25 * d) continue;
      }
      const seen = carSeen(x, z);
      if (seen && hypot2(x - V.x, z - V.z) < 200) continue;
      if (EVP.n > 0 && nearEvent(x, z, 60)) continue;
      let clear = true;
      for (let k = 0; k < townCars.length; k++) { const o = townCars[k]; if (o !== c && !o.gone && hypot2(o.x - x, o.z - z) < 22) { clear = false; break; } }
      if (!clear) continue;
      c.lane = L; c.s = s; c.x = x; c.z = z; c.h = Math.atan2(p.dx, p.dz); c.inTurn = false; c.v = c.v0; c.gone = false;
      c.lat = 0; c.latT = 0; c.mw = 0; c.stuck = 0; c.still = 0; c.push = 0; c.sc = seen ? 0 : 1;
      pickNext(c);
      if (c.s > c.sEnd) c.s = Math.max(0, c.sEnd - 1);
      return true;
    }
    return false;
  }
  function buildTownCars() {
    buildLanes();
    for (let i = 0; i < TOWN_CARS; i++) townCars.push({ lane: null, next: null, s: 0, sEnd: 0, s2: 0, straight: true, inTurn: false, tu: 0, tlen: 1, x0: 0, z0: 0, kx: 0, kz: 0, x2: 0, z2: 0,
      x: 0, z: -9999, h: 0, v: 0, v0: 7 + (i * 0.37 % 1) * 3, sc: 0, gone: true, wait: 0, push: 0, stuck: 0, still: 0, lat: 0, latT: 0, mw: 0 });
  }
  const inJunction = (o, node) => (o.lane.to === node && (o.inTurn || o.s > o.lane.stop + 1)) || (!o.inTurn && o.lane.from === node && o.s < o.lane.clear);
  const KERB_SHIFT = C.lane - C.laneInner;     // (pulling over: from the lane by the middle line to the kerb lane)
  function carMatrix(i, c) {
    const s = c.sc > 0 ? c.sc : 0.001;
    _q4.setFromAxisAngle(_up, c.h);
    _m4.compose(_p4.set(c.x, c.sc > 0 ? 0.03 : -50, c.z), _q4, _s4.set(s, s, s));
    cars.setMatrixAt(i, _m4);
  }
  function updateTownCars(dt) {
    const G = BUSG, V = CAMG;
    // (the camera swinging round to a stop's side view, or that view standing still: see updateFolk)
    const swing = V.spin > 0.55 && (G.calm || G.calmT < 2.5), lastCall = G.calm && V.still > 0.3;
    for (let i = 0; i < TOWN_CARS; i++) {
      const c = townCars[i];
      if (c.gone) {
        if (c.sc > 0) c.sc = Math.max(0, c.sc - dt * 7);                       // (whisked away: something drove into it)
        if (c.sc <= 0 && G.ok && (c.wait -= dt) <= 0 && !placeCar(c)) c.wait = 0.3;
        if (c.gone) { carMatrix(i, c); continue; }
      } else if (c.sc < 1) c.sc = Math.min(1, c.sc + dt * 1.6);
      const fX = Math.sin(c.h), fZ = Math.cos(c.h), lX = fZ, lZ = -fX, L = c.lane;
      let want = c.inTurn && !c.straight ? c.v0 * 0.6 : c.v0;
      // coming up to a junction's stop line (not yet over it): may have to wait there
      const toLine = L.stop - c.s, atLine = !c.inTurn && L.junction && toLine < 12 && toLine > -1;
      let wait = false, behind = false, makeWay = false;
      if (G.ok) {
        const md = hypot2(G.mx - c.x, G.mz - c.z), seen = carSeen(c.x, c.z);
        // driven into by the bus, a friend's ride or an event's vehicle: whisked away, even in view
        let hit = busDist(c.x, c.z) < 2.6 || (frN > 0 && friendDist(c.x, c.z) < 2.8);
        for (let k = 0; k < EVP.n && !hit; k++) if (evDist(k, c.x, c.z) < (EVP.hl[k] > 0 ? 2.6 : 3.2)) hit = true;
        // off the street (to come back somewhere else), only while nobody can see it: left far behind, near a stop in
        // progress, near a town event, or stuck a long time; and the tow truck's stop view (it counts cars) keeps clear
        // of town cars near the truck, going in the camera's swing if they must (one far off in the haze, small behind
        // everything, just drives on)
        const towView = G.calm && G.tow && md < 100 && ((SV.ok && inStopView(c.x, c.z)) || (swing && seen));
        const off = !seen && (md > CAR_FAR || c.stuck > 20 || c.still > 25 || towView || (G.calm && md < 75) ||
          (md > 125 && (c.x - V.x) * V.fx + (c.z - V.z) * V.fz < -10) || (EVP.n > 0 && nearEvent(c.x, c.z, 38)));
        if (hit || off || (towView && (swing || (lastCall && md < 75)))) { c.gone = true; c.wait = 0; if (off) c.sc = 0; carMatrix(i, c); continue; }
        // the bus and friends' rides: in my lane ahead (keep well back, out of the chase camera's sight), coming up
        // behind (keep ahead of it), near the junction I'm coming to (wait for it, unless we simply go the same way)
        for (let k = -1; k < frN; k++) {
          const o = k < 0 ? G : FRIENDS[FRI[k]];
          if (k >= 0 && !o.known) continue;
          const op = o.p, same = fX * o.fx + fZ * o.fz;
          let gapA = 99, beh = false;
          for (let q = 0; q < 4; q++) {
            const rx = op[q * 2] - c.x, rz = op[q * 2 + 1] - c.z, al = rx * fX + rz * fZ, la = Math.abs(rx * fZ - rz * fX);
            if (la < 2.7) { if (al > 0 && al < gapA) gapA = al; if (al <= 0 && al > -20 && same > 0.5) beh = true; }
          }
          if (gapA < 99) {
            if (same > 0.3) { if (gapA < 36) want = Math.min(want, Math.max(0, o.speed) * BB.clamp((gapA - 27) / 8, 0, 1.15)); }
            else if (gapA < 15) want = 0;
          }
          if (beh && gapA > 30) want = Math.min(16, Math.max(want, o.speed + 2.5));
          if (beh) behind = true;
          // (not for the bus standing at a stop clear of the junction: it stays put, by the kerb, and nobody would wait
          // for a bus that isn't moving)
          const parked = k < 0 && G.calm && Math.abs(G.speed) < 0.3 && lineD(G.p, L.nx, L.nz) > L.box + 3;
          if (atLine && !beh && !parked && hypot2(o.mx - L.nx, o.mz - L.nz) < 31 + L.box && !(c.straight && Math.abs(same) > 0.8)) wait = true;
        }
        // a town event's things: one in the road just ahead, wait behind it; something fast coming up behind in my
        // lane (an ambulance, a police car): pull over to the kerb and stop until it has gone by
        for (let k = 0; k < EVP.n; k++) {
          // (a vehicle by its nearest end, and well back from it: the rubbish truck backs up to its bins)
          evDist(k, c.x, c.z);
          const rx = _ep.x - c.x, rz = _ep.z - c.z, al = rx * fX + rz * fZ, la = rx * lX + rz * lZ;
          if (al > -2 && al < 30 && Math.abs(la) < 3.6) want = Math.min(want, c.v0 * BB.clamp((al - (EVP.hl[k] > 0 ? 10 : 9)) / 8, 0, 1));
          else if (al < -1 && al > -34 && Math.abs(la + c.lat) < 3 && (al > -14 || EVP.vx[k] * fX + EVP.vz[k] * fZ > c.v + 1.5)) makeWay = true;
        }
      }
      // making way (it stays on a moment after the thing behind has slowed or gone by): between junctions, pull over to
      // the kerb lane and stop; near a junction (no room to pull over), go on through it instead of waiting there
      if (makeWay) c.mw = Math.max(c.mw, 2);
      if (c.mw > 0) {
        c.mw -= dt;
        if (c.latT === 0 && !c.inTurn && toLine > 14 && L.e.kind !== 'highway' && busDist(c.x + lX * (KERB_SHIFT - c.lat), c.z + lZ * (KERB_SHIFT - c.lat)) > 10) c.latT = KERB_SHIFT;
        if (c.latT > 0) { if (!behind) want = Math.min(want, c.lat > KERB_SHIFT * 0.6 ? 0 : c.v0 * 0.5); }   // (the bus right behind: drive on in the kerb lane)
        else { if (atLine && !behind) wait = false; want = Math.max(want, c.v0); }
      } else c.latT = 0;
      if (toLine < 14 && c.mw <= 0) c.latT = 0;
      // turning on or off the expressway: wait for a gap in its cars
      if (atLine && L.highNode && !c.straight) for (let k = 0; k < CAR_N; k++) { const o = carState[k], ah = (L.nx - o.s) * o.dir; if (ah > -6 && ah < 24) { wait = true; break; } }
      // the other town cars: keep behind one just ahead, and one car at a time through a junction (of two arriving
      // together the one with the lower number goes first; a car that has waited for others a long time just goes)
      if (c.push > 0) c.push -= dt;
      let held = false;
      for (let k = 0; k < TOWN_CARS; k++) {
        const o = townCars[k]; if (o === c || o.gone) continue;
        if (atLine && c.push <= 0 && (inJunction(o, L.to) || (k < i && o.lane !== L && o.lane.to === L.to && !o.inTurn && o.lane.stop - o.s < 12))) { wait = true; held = true; continue; }
        const rx = o.x - c.x, rz = o.z - c.z, al = rx * fX + rz * fZ;
        if (al <= 0 || al > 10 || Math.abs(rx * fZ - rz * fX) > 2.3) continue;
        const oF = -(rx * Math.sin(o.h) + rz * Math.cos(o.h));                    // am I ahead of it too?
        if (oF > 0 && oF < 10 && i < k) continue;
        want = Math.min(want, c.v0 * BB.clamp((al - 4.5) / 5, 0, 1));
      }
      if (wait) want = Math.min(want, c.v0 * BB.clamp(toLine / 6, 0, 1));         // (rolls up to the line and stops there)
      c.stuck = held && c.v < 0.3 ? c.stuck + dt : 0;
      c.still = c.v < 0.3 ? c.still + dt : 0;
      if (c.stuck > 12) { c.stuck = 0; c.push = 5; }
      c.v += BB.clamp(want - c.v, -dt * 14, dt * 5);
      // along the lane, round the turn, into the next lane (pulled over to the kerb by c.lat, only between junctions)
      let tx, tz;
      if (!c.inTurn) {
        c.s += c.v * dt;
        if (c.s >= c.sEnd) { c.inTurn = true; c.tu = (c.s - c.sEnd) / c.tlen; c.lat = c.latT = 0; }
      } else c.tu += c.v * dt / c.tlen;
      if (c.inTurn && c.tu >= 1) { const left = (c.tu - 1) * c.tlen; c.lane = c.next; c.s = c.s2 + left; c.inTurn = false; pickNext(c); }
      c.lat += BB.clamp(c.latT - c.lat, -dt * 2.3, dt * 2.3);
      if (c.inTurn) {
        const u = c.tu, v1 = 1 - u;
        c.x = v1 * v1 * c.x0 + 2 * u * v1 * c.kx + u * u * c.x2; c.z = v1 * v1 * c.z0 + 2 * u * v1 * c.kz + u * u * c.z2;
        tx = v1 * (c.kx - c.x0) + u * (c.x2 - c.kx); tz = v1 * (c.kz - c.z0) + u * (c.z2 - c.kz);
      } else { const p = lineAt(c.lane, c.s); c.x = p.x + p.dz * c.lat; c.z = p.z - p.dx * c.lat; tx = p.dx; tz = p.dz; }
      if (tx * tx + tz * tz > 1e-6) c.h += wrapPi(Math.atan2(tx, tz) - c.h) * Math.min(1, dt * 9);
      carMatrix(i, c);
    }
    _s4.set(1, 1, 1);
  }
  // The horn again: the nearest little car in sight answers with a soft "meep meep" of its own (each car has its own
  // note; quieter further away; not during a stop or scene, and not more than once every few seconds).
  const TOOTS = [19, 21, 16, 24, 17, 22, 14, 20, 23, 18];
  let tootAt = -99;
  function carToot() {
    if (!BUSG.ok || BUSG.calm || folkClock - tootAt < 2.5 || typeof BB.tone !== 'function') return;
    let best = -1, bd = 55;
    for (let i = 0; i < TOWN_CARS; i++) {
      const c = townCars[i]; if (c.gone || c.sc < 0.9) continue;
      const d = hypot2(c.x - BUSG.mx, c.z - BUSG.mz);
      if (d < bd && inSight(c.x, c.z, 0)) { bd = d; best = i; }
    }
    if (best < 0) return;
    tootAt = folkClock;
    const f = 440 * Math.pow(2, (TOOTS[best % TOOTS.length] - 9) / 12), vol = 0.05 * BB.clamp(1.15 - bd / 55, 0.3, 1);
    try { BB.tone(f, 0.09, { type: 'triangle', vol, at: 0.62 }); BB.tone(f, 0.14, { type: 'triangle', vol, at: 0.78 }); } catch (e) { /* no sound */ }
  }
  // Is a town car standing within r of (x, z)? (an event's vehicle waits behind one in its way)
  W.townCarNear = function (x, z, r) {
    for (let i = 0; i < TOWN_CARS; i++) { const c = townCars[i]; if (!c.gone && c.sc > 0.5 && hypot2(c.x - x, c.z - z) < r) return true; }
    return false;
  };
  W.townCars = () => townCars.map((c) => ({ x: c.x, z: c.z, h: c.h, v: c.v, sc: c.sc, gone: c.gone, turning: c.inTurn, lat: c.lat }));   // (for tools)

  // ---------- sailing boats off the waterfront ----------
  // A handful of little boats with coloured sails go up and down the coast on long thin ovals, rocking on the swell.
  // One instanced mesh (about 60 triangles a boat), drawn only when the camera is near the sea.
  const BOAT_N = 6, boatState = [];
  let boats = null;
  const _e4 = new THREE.Euler(0, 0, 0, 'YXZ');
  function buildBoats() {
    const b = BB.mk.builder(), tint = [], HULL = '#fff6e0';
    const add = (t) => tint.push(t);
    const tri = (pts) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.concat(pts.slice(0, 3), pts.slice(6, 9), pts.slice(3, 6)), 3)); return g; };   // (both faces)
    b.box(1.9, 0.9, 5.0, HULL, 0, -0.3, -0.3); add(0);
    const bow = new THREE.ConeGeometry(1.34, 2.0, 4); bow.rotateY(Math.PI / 4); bow.rotateX(Math.PI / 2);
    b.add(bow, HULL, 0, 0.15, 3.2, 0, 0, 0, 1, 0.47, 1); add(0);                                                         // the bow
    b.box(1.96, 0.22, 5.06, '#ffffff', 0, 0.42, -0.3); add(1);                                                           // a stripe in the sail's colour
    b.box(1.2, 0.5, 1.5, '#e2b07c', 0, 0.6, -1.3); add(0);                                                               // a little cabin
    b.box(0.14, 6.6, 0.14, '#9b6238', 0, 0.6, 0.5); add(0);                                                              // the mast
    b.add(tri([0, 1.5, 0.3, 0, 7.0, 0.3, 0, 1.5, -3.0]), '#ffffff', 0, 0, 0); add(1);                                    // the mainsail
    b.add(tri([0, 1.3, 0.7, 0, 5.8, 0.7, 0, 1.3, 3.3]), '#ffffff', 0, 0, 0); add(2);                                     // the jib (white)
    b.box(0.05, 0.4, 0.7, '#ffffff', 0, 7.2, 0.15); add(1);                                                              // a pennant
    const geo = b.geometry(), counts = b.counts;
    let total = 0; for (let k = 0; k < counts.length; k++) total += counts[k];
    const aTint = new Float32Array(total);
    for (let k = 0, o = 0; k < counts.length; k++) for (let v = 0; v < counts[k]; v++, o++) aTint[o] = tint[k];
    geo.setAttribute('aTint', new THREE.BufferAttribute(aTint, 1));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (sh) => {     // only the sail, the stripe and the pennant take the boat's own colour
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTint;')
        .replace('#include <color_vertex>', 'vColor = aTint > 1.5 ? vec3(1.0, 0.98, 0.92) : aTint > 0.5 ? instanceColor : color;');
    };
    const mesh = new THREE.InstancedMesh(geo, mat, BOAT_N);
    const cols = [P.coral, P.honey, P.teal, '#ffffff', P.berry, P.rose], c = new THREE.Color();
    for (let i = 0; i < BOAT_N; i++) {
      mesh.setColorAt(i, c.set(cols[i % cols.length]));
      // (each on its own oval, just out past the beach, the gardens and the wheel's pier, which reach SZ + 66)
      boatState.push({ cx: -150 + i * 92 + lr(-20, 20), cz: SZ + 80 + (i % 3) * 15 + lr(-2, 2), ax: lr(70, 120), az: lr(6, 9), a: lr(0, 6.28), w: (i % 2 ? -1 : 1) * lr(0.016, 0.026), ph: lr(0, 6), s: lr(1.6, 2.0) });
    }
    mesh.name = 'boats'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
    return mesh;
  }
  function updateBoats(dt, t) {
    for (let i = 0; i < BOAT_N; i++) {
      const o = boatState[i];
      o.a += o.w * dt;
      const ca = Math.cos(o.a), sa = Math.sin(o.a);
      const vx = -o.ax * sa * o.w, vz = o.az * ca * o.w;
      _e4.set(Math.sin(t * 1.1 + o.ph) * 0.05, Math.atan2(vx, vz), Math.sin(t * 0.8 + o.ph * 2) * 0.07 + 0.05);
      _q4.setFromEuler(_e4);
      _m4.compose(_p4.set(o.cx + o.ax * ca, 0.32 + Math.sin(t * 1.3 + o.ph) * 0.12, o.cz + o.az * sa), _q4, _s4.set(o.s, o.s, o.s));
      boats.setMatrixAt(i, _m4);
    }
    _s4.set(1, 1, 1);
    boats.instanceMatrix.needsUpdate = true;
  }

  // ---------- per frame ----------
  let clock = 0, skyTimer = 0;
  W.update = function (dt) {
    if (!W.built) return;
    const Bs = BB.bus;
    if (Bs && Bs.front && BB.camera) {
      fadeU.uCam.value.copy(BB.camera.position);
      fadeU.uBus.value.set((Bs.front.position.x + Bs.rear.position.x) / 2, 1.8, (Bs.front.position.z + Bs.rear.position.z) / 2);
      // at a stop (side view) the props between the camera and the bus are hidden across the whole view, not
      // just on the line to the bus's middle
      const stopView = (Bs.atStop || (Bs.isSettling && Bs.isSettling())) && Bs.camMode === 'chase';
      fadeU.uWedge.value = stopView ? Math.tan(THREE.MathUtils.degToRad(BB.camera.fov) / 2) * BB.camera.aspect * 1.1 : 0;
    }
    clock += dt;
    // the day clock and the weather (the colour table, then the weather mixed in) - repainted a few times a second
    const sk = W.sky;
    updateDay(dt); updateWeather(dt);
    skyTimer -= dt;
    if (dayDirty && skyTimer <= 0 || wx.flash > 0 || skyTimer < -0.25) {
      skyTimer = 0.12; dayDirty = false;
      const ph = phaseOf(W.day.t); W.day.rising = W.day.t > 0.82 || W.day.t < 0.05; sk.share = ph;
      applySky(ph); weatherSky();
    }
    skyU.time.value = clock;
    if (sky && BB.camera) sky.position.copy(BB.camera.position);
    if (rain && rain.visible && BB.camera) { rain.material.uniforms.uTime.value = clock; rain.material.uniforms.uCam.value.copy(BB.camera.position); }
    if (rainbow && rainbow.visible && BB.camera) {
      const sd = skyU.sunDir.value, l = hypot2(sd.x, sd.z) || 1, cp = BB.camera.position;
      rainbow.position.set(cp.x - sd.x / l * 300, -30, cp.z - sd.z / l * 300);
      rainbow.lookAt(cp.x, -30, cp.z);
    }
    if (seaGlints && seaGlints.visible) seaGlints.material.uniforms.uTime.value = clock;
    if (clouds) { clouds.rotation.y += dt * 0.004; if (BB.camera) { clouds.position.x = BB.camera.position.x; clouds.position.z = BB.camera.position.z; } }
    if (wheelRim) wheelRim.rotation.z += dt * 0.07;
    if (planes) updatePlanes(dt);
    if (boomN && Bs && Bs.front) {                 // the boom gates lift for the bus
      const near = (zg) => hypot2(Bs.front.position.x - 42, Bs.front.position.z - zg) < 26 || hypot2(Bs.rear.position.x - 42, Bs.rear.position.z - zg) < 22;
      for (const [m, zg, sg] of [[boomN, 128, 1], [boomS, 166, -1]]) {
        if (m.userData.lm) { m.userData.setOpen(near(zg) ? 1 : 0); continue; }
        const want = near(zg) ? 1.35 : 0; m.userData.a = (m.userData.a || 0) + BB.clamp(want - (m.userData.a || 0), -dt * 1.6, dt * 1.6); m.rotation.x = sg * m.userData.a;
      }
    }
    if (xmasOn && xmasLights) xmasLights.material.size = 0.6 + 0.7 * W.sky.lights + 0.1 * Math.sin(clock * 3);
    if (train) {                           // glides back and forth, pausing at the station
      if (trainWait > 0) trainWait -= dt;
      else {
        const before = trainX;
        trainX += trainDir * 15 * dt;
        if ((before - S) * (trainX - S) <= 0 && before !== S) { trainX = S; trainWait = 3; }
        if (trainX > 166) { trainDir = -1; } else if (trainX < -166) { trainDir = 1; }
      }
      train.position.x = trainX;
    }
    busGeom(dt); camGeom(dt);
    updateFolk(dt);
    if (cars) {
      // (the expressway's cars are only drawn while the expressway is near; the town's cars always)
      updateTownCars(dt); updateCars(dt);
      carU.uNight.value = sk.lights;
      cars.count = !BB.camera || Math.abs(BB.camera.position.z - HZ) < 215 ? TOWN_CARS + CAR_N : TOWN_CARS;
    }
    // (the boats are all south of the camera: not drawn from far inland, nor when it looks away from the sea)
    if (boats && BB.camera) { boats.visible = BB.camera.position.z > 35 && (!CAMG.flat || CAMG.fz > -Math.sqrt(1 - CAMG.cosW * CAMG.cosW)); if (boats.visible) updateBoats(dt, clock); }
    cullFar();
    if (BB.landmarks && typeof BB.landmarks.update === 'function') BB.landmarks.update(dt);
    if (birds) { birds.visible = sk.night < 0.6; if (birds.visible) updateBirds(dt, clock); }
  };
})();
