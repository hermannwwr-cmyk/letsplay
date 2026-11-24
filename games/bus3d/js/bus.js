/* Bendy Bus 3D: the bus.
   An articulated (bendy) bus: front carriage + accordion joint + rear carriage, each placed on the driving path so
   it bends round corners; wheels spin, doors slide, ten seats (two rows of five, a ten-frame) with passengers' heads.
   Driving: the bus follows the road graph in the LEFT lane (Singapore). GO pedal = hold to drive, release to slow.
   Near a junction the options (left/straight/right) are offered (bus:atJunction); if none is chosen the bus follows
   the route to its target (the glowing ribbon). It pulls into the target stop by itself (bus:arrived).
   Also: chase / title / depot camera, fuel use (bus:fuelLow, bus:fuelEmpty), the ribbon and the target beacon.
   Exposes BB.bus (see SPEC.md "Shared contract"). */
(function () {
  'use strict';
  const BB = window.BB, C = BB.cfg, P = BB.P;

  const B = BB.bus = {
    group: null, front: null, rear: null, joint: null,
    pos: new THREE.Vector3(), heading: 0, speed: 0, edge: null, t: 0, dir: 1,
    fuel: BB.save.fuel, seats: [], passengers: 0, paint: P.busGreen,
    target: null, atStop: null, doorsOpen: false, going: false, noFuel: false,
    camMode: 'title', junction: null, route: [],
  };

  const LF = 7.4, LR = 6.0, GAP = 1.0;   // front carriage, rear carriage, joint gap lengths
  const FRONT_AXLE = 1.3, MID_AXLE = 5.6, REAR_AXLE = 4.2;   // axle distances (from nose / from joint)
  const STOP_AHEAD = 3.0;                // the nose stops this far past the shelter's middle
  const BAY = 1.0;                       // how far the bus pulls toward the kerb at a stop
  const R = C.corner;

  // ---------- path: a polyline the bus drives along (lane points + smooth corners) ----------
  const newPath = () => ({ pts: [], cum: [] });
  function pPush(p, x, z) {
    const n = p.pts.length;
    if (n) {
      const q = p.pts[n - 1], d = Math.hypot(x - q.x, z - q.z);
      if (d < 0.02) return;
      p.cum.push(p.cum[n - 1] + d);
    } else p.cum.push(0);
    p.pts.push({ x, z });
  }
  const pLen = (p) => p.cum.length ? p.cum[p.cum.length - 1] : 0;
  function pIndex(p, s) {                // last i with cum[i] <= s
    let lo = 0, hi = p.cum.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (p.cum[mid] <= s) lo = mid; else hi = mid - 1; }
    return lo;
  }
  // Point and unit direction at distance s (extrapolates straight past either end).
  function pSample(p, s, out) {
    out = out || {};
    const n = p.pts.length;
    let i = BB.clamp(pIndex(p, s), 0, n - 2);
    const a = p.pts[i], b = p.pts[i + 1], l = (p.cum[i + 1] - p.cum[i]) || 1e-6;
    const t = (s - p.cum[i]) / l;
    out.dx = (b.x - a.x) / l; out.dz = (b.z - a.z) / l;
    out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
    return out;
  }
  function pCut(p, s) {
    if (s >= pLen(p)) return;
    const q = pSample(p, s), i = pIndex(p, s);
    p.pts.length = i + 1; p.cum.length = i + 1;
    pPush(p, q.x, q.z);
  }
  function pAddLane(p, lane, from, to) {
    const tmp = { pts: lane.pts, cum: lane.cum };
    const a = pSample(tmp, from); pPush(p, a.x, a.z);
    for (let i = 0; i < lane.pts.length; i++) if (lane.cum[i] > from && lane.cum[i] < to) pPush(p, lane.pts[i].x, lane.pts[i].z);
    const b = pSample(tmp, to); pPush(p, b.x, b.z);
  }
  // Path currently ends at the end of a lane (a junction): replace its last R with a curve into lane2.
  function pCorner(p, lane2) {
    const end = pLen(p), a = pSample(p, end - R), A = { x: a.x, z: a.z, dx: a.dx, dz: a.dz };
    pCut(p, end - R);
    const b = pSample({ pts: lane2.pts, cum: lane2.cum }, R);
    // control point: where the two lane lines meet (or halfway when they are parallel)
    const cr = A.dx * b.dz - A.dz * b.dx;
    let cx = (A.x + b.x) / 2, cz = (A.z + b.z) / 2;
    if (Math.abs(cr) > 0.15) {
      const wx = b.x - A.x, wz = b.z - A.z, u = (wx * b.dz - wz * b.dx) / cr;
      cx = A.x + A.dx * u; cz = A.z + A.dz * u;
    }
    for (let k = 1; k <= 10; k++) {
      const t = k / 10, m = 1 - t;
      pPush(p, m * m * A.x + 2 * m * t * cx + t * t * b.x, m * m * A.z + 2 * m * t * cz + t * t * b.z);
    }
    pAddLane(p, lane2, R, lane2.len);
  }

  // ---------- driving state ----------
  let path = newPath();
  let S = 0;                              // the nose's distance along the path
  let cur = null;                         // {edge, dir, lane, endS}: the lane being driven, endS = its end on the path
  let cornerEnd = -1;                     // path distance where the current turn curve ends
  let bay = null;                         // {s0, s1, e0}: pull toward the kerb between s0..s1, out again after e0
  let targetS = null;                     // path distance where the nose stops for B.target (when on this lane)
  let wheelAngle = 0, doorT = 0, ribbonTimer = 0, saveTimer = 0, lowWarned = false;
  const W = () => BB.world;

  const nodeAhead = () => W().node(cur.dir > 0 ? cur.edge.b : cur.edge.a);
  function laneDistOf(stop) {             // a stop's distance along its lane (lanes of straight edges = centre line)
    const e = W().edge(stop.edge);
    return stop.dir > 0 ? stop.s : e.length - stop.s;
  }
  function computeTargetS() {
    targetS = null;
    const t = B.target;
    if (!t || !cur || t.edge !== cur.edge.id || t.dir !== cur.dir) return;
    const s = cur.endS - cur.lane.len + laneDistOf(t) + STOP_AHEAD;
    if (s > S - 0.3) targetS = s;
  }

  // Options at the junction ahead: [{dir:'left'|'straight'|'right', edge, d, turn}]
  function optionsAhead() {
    const node = nodeAhead(), L = cur.lane, n = L.pts.length;
    const ix = L.pts[n - 1].x - L.pts[n - 2].x, iz = L.pts[n - 1].z - L.pts[n - 2].z;
    const hin = Math.atan2(ix, iz), out = [];
    for (const id of node.edges) {
      if (id === cur.edge.id) continue;
      const e = W().edge(id), d = e.a === node.id ? 1 : -1, l2 = W().lane(e, d);
      const hout = Math.atan2(l2.pts[1].x - l2.pts[0].x, l2.pts[1].z - l2.pts[0].z);
      let turn = hout - hin; while (turn > Math.PI) turn -= 2 * Math.PI; while (turn < -Math.PI) turn += 2 * Math.PI;
      out.push({ dir: turn > 0.5 ? 'left' : turn < -0.5 ? 'right' : 'straight', edge: e, d, turn });
    }
    return out;
  }
  // Shortest route (directed edges) from the lane after the current one to the target's lane.
  function planRoute(target) {
    if (!target || !cur) return null;
    if (targetS != null) return [];                       // it's ahead on this lane
    const key = (e, d) => e.id + (d > 0 ? '+' : '-');
    const startK = key(cur.edge, cur.dir), dist = { [startK]: 0 }, prev = {};
    const open = [{ e: cur.edge, d: cur.dir, k: startK, c: 0 }];
    while (open.length) {
      open.sort((a, b) => a.c - b.c);
      const it = open.shift();
      if (it.c > dist[it.k]) continue;
      if (it.k !== startK && it.e.id === target.edge && it.d === target.dir) {
        const seq = []; let k = it.k, node = it;
        while (k !== startK) { seq.unshift({ edge: node.e, d: node.d }); node = prev[k]; k = node.k; }
        return seq;
      }
      const nid = it.d > 0 ? it.e.b : it.e.a, nn = W().node(nid);
      for (const id of nn.edges) {
        if (id === it.e.id) continue;
        const e = W().edge(id), d = e.a === nid ? 1 : -1, k = key(e, d), c = it.c + e.length;
        if (dist[k] == null || c < dist[k]) { dist[k] = c; prev[k] = it; open.push({ e, d, k, c }); }
      }
    }
    return null;
  }
  function suggestedOption(opts) {
    const r = planRoute(B.target);
    if (r && r.length) { const o = opts.find((q) => q.edge === r[0].edge && q.d === r[0].d); if (o) return o; }
    return opts.find((q) => q.dir === 'straight') || opts.find((q) => q.dir === 'left') || opts[0];
  }

  function commitTurn() {
    const J = B.junction;
    const opts = J ? J.opts : optionsAhead();
    let o = J && J.chosen ? opts.find((q) => q.dir === J.chosen) : null;
    if (!o) o = suggestedOption(opts);
    const lane2 = W().lane(o.edge, o.d);
    const startCorner = cur.endS - R;
    pCorner(path, lane2);
    cornerEnd = startCorner + 2 * R + 1;
    cur = { edge: o.edge, dir: o.d, lane: lane2, endS: pLen(path) };
    if (J) BB.emit('bus:junctionDone', { dir: o.dir });
    B.junction = null;
    computeTargetS();
    refreshRibbon();
  }

  // Lateral offset toward the kerb (bus bays) at path distance s.
  function latAt(s) {
    if (!bay) return 0;
    const inn = BB.smooth((s - bay.s0) / (bay.s1 - bay.s0)), out = 1 - BB.smooth((s - bay.e0) / 18);
    return BAY * Math.min(inn, out);
  }
  const _a = {}, _b = {}, _c = {};
  function sampleL(s, out) {
    pSample(path, s, out);
    const l = latAt(s);
    if (l) { out.x += out.dz * l; out.z -= out.dx * l; }
    return out;
  }

  // Drop path far behind the bus so it doesn't grow forever.
  function trimPath() {
    if (S < 160) return;
    const i = pIndex(path, S - 70);
    if (i < 2) return;
    const off = path.cum[i];
    path.pts.splice(0, i); path.cum.splice(0, i);
    for (let k = 0; k < path.cum.length; k++) path.cum[k] -= off;
    S -= off; cur.endS -= off; cornerEnd -= off;
    if (targetS != null) targetS -= off;
    if (bay) { bay.s0 -= off; bay.s1 -= off; bay.e0 -= off; }
  }

  // ---------- public: placing, targets, doors, controls ----------
  // Park the bus at a stop or the depot (used at start, after a tow).
  B.placeAt = function (stop) {
    const e = W().edge(stop.edge), lane = W().lane(e, stop.dir);
    path = newPath(); pAddLane(path, lane, 0, lane.len);
    cur = { edge: e, dir: stop.dir, lane, endS: pLen(path) };
    S = laneDistOf(stop) + STOP_AHEAD;
    bay = { s0: S - 40, s1: S - 30, e0: Infinity };
    B.speed = 0; B.junction = null; cornerEnd = -1;
    B.atStop = stop; B.target = null; targetS = null;
    placeModel(); snapCamera();
    refreshRibbon();
  };
  // Drive to (and pull in at) a stop or the depot; cb(stop) runs on arrival. Null clears the target.
  B.stopAt = function (stop, cb) {
    B.target = stop || null; B.onArrive = cb || null;
    computeTargetS();
    if (B.junction) { const o = suggestedOption(B.junction.opts); B.junction.suggested = o.dir; BB.emit('bus:atJunction', { options: B.junction.opts.map((q) => q.dir), suggested: o.dir }); }
    refreshRibbon();
  };
  B.openDoors = function () { if (!B.doorsOpen) { B.doorsOpen = true; BB.sfx.door(); } };
  B.closeDoors = function () {
    if (!B.doorsOpen && !B.atStop) return;
    B.doorsOpen = false; BB.sfx.door();
    if (B.atStop) { if (bay) bay.e0 = S - 2; B.atStop = null; }
  };
  B.go = function (on) { B.going = !!on; };
  B.choose = function (dir) {
    if (!B.junction || !B.junction.opts.some((q) => q.dir === dir)) return false;
    B.junction.chosen = dir; BB.sfx.click();
    BB.emit('bus:chosen', { dir });
    return true;
  };
  B.refuel = function (amount) {
    B.fuel = BB.clamp(amount == null ? 1 : B.fuel + amount, 0, 1);
    if (B.fuel > C.fuelLow + 0.05) lowWarned = false;
    B.noFuel = B.fuel <= 0;
    BB.save.fuel = B.fuel; BB.saveNow();
    BB.emit('fuel:changed', { fuel: B.fuel });
  };
  B.horn = function () { BB.sfx.horn(!!BB.save.upgrades.horn); };
  // World position of seat i (0..9).
  B.seatWorld = function (i, v) { v = v || new THREE.Vector3(); const s = B.seats[i]; v.set(s.x, s.y, s.z); return B.front.localToWorld(v); };
  B.doorWorld = function (v) { v = v || new THREE.Vector3(); v.set(1.6, 0, 2.6); return B.front.localToWorld(v); };
  B.pathAhead = () => cur ? cur.endS - S : 0;

  // ---------- model ----------
  // TODO(world/bus art polish): a friendlier bus (a face on the front, rounder corners, sticker spots, roof hat
  // mount), passengers with hair and smiles, a few people on the rear carriage too.
  let paintMat, glassMat, wheelsF = [], wheelsR = [], doorF, doorR, heads, shirts, lightCones, beacon, ribbon, ribbonTex;
  function buildModel() {
    paintMat = new THREE.MeshLambertMaterial({ color: B.paint, vertexColors: true });
    glassMat = new THREE.MeshLambertMaterial({ color: 0xbfe6f5, transparent: true, opacity: 0.38, depthWrite: false });
    B.group = new THREE.Group(); B.group.name = 'bus';
    B.front = carriage(true); B.rear = carriage(false); B.joint = jointMesh();
    B.group.add(B.front, B.rear, B.joint);
    // seats: two rows of five (a ten-frame). Row 1 = seats 0-4 on the door (left, +x) side, front to back.
    for (let i = 0; i < 10; i++) B.seats.push({ x: i < 5 ? 0.62 : -0.62, y: 1.25, z: 1.9 - (i % 5) * 1.15 });
    // passengers' heads and shoulders (instanced; count follows B.passengers)
    const hg = new THREE.IcosahedronGeometry(0.33, 0); hg.translate(0, 0.62, 0); hg.computeVertexNormals();
    const sg = new THREE.CylinderGeometry(0.28, 0.38, 0.6, 6).toNonIndexed(); sg.computeVertexNormals();
    heads = new THREE.InstancedMesh(hg, new THREE.MeshLambertMaterial(), 10);
    shirts = new THREE.InstancedMesh(sg, new THREE.MeshLambertMaterial(), 10);
    const skins = ['#f1c7a0', '#d9a679', '#a8714a', '#f5d3b5', '#7a4b2e'], tops = [P.coral, P.teal, P.honey, P.berry, P.plum, P.leaf, P.rose];
    const m = new THREE.Matrix4();
    B.seats.forEach((s, i) => {
      m.makeTranslation(s.x, s.y, s.z); heads.setMatrixAt(i, m); shirts.setMatrixAt(i, m);
      heads.setColorAt(i, new THREE.Color(skins[(i * 3) % skins.length])); shirts.setColorAt(i, new THREE.Color(tops[(i * 2 + 1) % tops.length]));
    });
    heads.count = shirts.count = 0;
    B.front.add(heads, shirts);
    // headlight beams (upgrade)
    const lb = BB.mk.builder();
    for (const x of [-0.85, 0.85]) lb.add(new THREE.ConeGeometry(1.4, 7, 10, 1, true), '#fff6c0', x, 0.9, LF / 2 + 3.5, 0, Math.PI / 2 + 0.12);
    lightCones = new THREE.Mesh(lb.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    lightCones.visible = false; B.front.add(lightCones);
    BB.scene.add(B.group);
    buildRibbon(); buildBeacon();
    B.setPaint(BB.save.paint);
    B.applyCustom(BB.save);
  }
  function carriage(isFront) {
    const L = isFront ? LF : LR, g = new THREE.Group();
    const paint = BB.mk.builder(), det = BB.mk.builder(), glass = BB.mk.builder();
    const zf = L / 2, zb = -L / 2;
    // painted body (vertex colour white = paint colour, grey = a deeper tone of it)
    paint.box(2.5, 1.15, L, '#ffffff', 0, 0.45, 0);
    paint.box(2.52, 0.28, L, '#c8c8c8', 0, 0.42, 0);                      // darker skirt
    paint.box(2.5, 0.32, L, '#ffffff', 0, 2.62, 0);                       // band under the roof
    for (let z = zb + 0.15; z <= zf - 0.1; z += L / 5) paint.box(2.5, 1.05, 0.16, '#ffffff', 0, 1.6, z);   // window pillars
    paint.box(2.36, 0.22, L - 0.1, '#eeeeee', 0, 2.94, 0);                // roof (painted, so the bus reads from above)
    det.box(1.3, 0.3, L * 0.32, '#e6dccb', 0, 3.1, -L * 0.1);             // roof pod (air-con)
    det.box(2.3, 0.1, L - 0.2, '#6c6470', 0, 0.55, 0);                    // floor (seen through glass)
    glass.box(2.46, 1.0, L - 0.2, '#ffffff', 0, 1.62, 0);
    // seats (backs) inside
    for (let i = 0; i < 5 && isFront; i++) for (const x of [0.62, -0.62]) det.box(0.8, 0.7, 0.18, P.berry, x, 0.6, 1.9 - i * 1.15 - 0.42);
    if (isFront) {
      det.box(2.52, 1.25, 0.12, P.glassDark, 0, 1.45, zf + 0.02);         // windscreen
      det.box(2.0, 0.34, 0.14, '#2b2430', 0, 2.62, zf + 0.04);            // destination sign
      det.box(1.4, 0.18, 0.16, P.honey, 0, 2.7, zf + 0.06);
      det.box(2.56, 0.36, 0.3, '#5a5260', 0, 0.38, zf);                   // bumper
      for (const x of [-0.88, 0.88]) { det.box(0.5, 0.26, 0.12, '#fffbe0', x, 0.78, zf + 0.04); det.box(0.3, 0.14, 0.12, P.honey, x, 1.08, zf + 0.04); }
      det.box(0.1, 0.5, 0.1, '#5a5260', 1.33, 2.0, zf - 0.3); det.box(0.1, 0.24, 0.3, '#5a5260', 1.38, 1.8, zf - 0.15);   // mirrors
      det.box(0.1, 0.5, 0.1, '#5a5260', -1.33, 2.0, zf - 0.3); det.box(0.1, 0.24, 0.3, '#5a5260', -1.38, 1.8, zf - 0.15);
      det.box(0.7, 0.9, 0.5, '#4a4250', -0.62, 0.6, zf - 0.8);            // driver's seat
    } else {
      det.box(2.0, 0.9, 0.12, P.glassDark, 0, 1.65, zb - 0.02);           // rear window
      det.box(2.56, 0.36, 0.3, '#5a5260', 0, 0.38, zb);
      for (const x of [-0.95, 0.95]) det.box(0.34, 0.5, 0.12, '#e8473b', x, 0.85, zb - 0.04);
    }
    const pm = paint.mesh(paintMat), dm = det.mesh(), gm = glass.mesh(glassMat);
    gm.renderOrder = 3;
    g.add(pm, dm, gm);
    // doors (kerb side, +x): front door near the nose, rear door on the rear carriage
    const db = BB.mk.builder();
    db.box(0.08, 1.95, 0.55, P.glassDark, 0, 0, -0.29); db.box(0.08, 1.95, 0.55, P.glassDark, 0, 0, 0.29);
    db.box(0.1, 0.1, 1.15, '#d0c8bc', 0, 1.95, 0);
    const door = db.mesh(); door.position.set(1.27, 0.5, isFront ? zf - 1.0 : zf - 1.6); door.userData.z = door.position.z;
    g.add(door);
    if (isFront) doorF = door; else doorR = door;
    // wheels: one mesh per axle (both wheels), spinning about x
    const axles = isFront ? [zf - FRONT_AXLE, zf - MID_AXLE] : [zf - REAR_AXLE];
    for (const z of axles) {
      const wb = BB.mk.builder();
      for (const x of [-1.08, 1.08]) {
        wb.add(new THREE.CylinderGeometry(0.52, 0.52, 0.36, 10), '#2f2a33', x, 0, 0, 0, 0, Math.PI / 2);
        wb.add(new THREE.CylinderGeometry(0.25, 0.25, 0.38, 6), '#d6d0c6', x, 0, 0, 0, 0, Math.PI / 2);
        wb.box(0.4, 0.08, 0.12, '#8d8794', x, -0.04, 0);
      }
      const wm = wb.mesh(); wm.position.set(0, 0.52, z);
      g.add(wm);
      (isFront ? wheelsF : wheelsR).push(wm);
    }
    const blob = BB.mk.blob(3.6, L + 1.6); blob.position.y = 0.08; g.add(blob);
    return g;
  }
  function jointMesh() {
    const b = BB.mk.builder();
    for (let k = 0; k < 6; k++) b.box(2.3, 2.35, 0.12, k % 2 ? '#4f4756' : '#3d3644', 0, 0.55, -0.5 + k * 0.2);
    b.box(2.0, 0.08, 1.1, '#6c6470', 0, 0.5, 0);
    const m = b.mesh(); m.name = 'joint'; return m;
  }

  B.setPaint = function (c) {
    const found = BB.PAINTS.find((p) => p.id === c);
    B.paint = found ? found.color : (typeof c === 'string' && c[0] === '#' ? c : P.busGreen);
    if (paintMat) paintMat.color.set(B.paint);
  };
  // Apply the saved customisation (paint, upgrades). TODO(depot polish): stickers, the hat/roof decoration,
  // the third "super sticker" slot.
  B.applyCustom = function (save) {
    save = save || BB.save;
    B.setPaint(save.paint);
    if (lightCones) lightCones.visible = !!(save.upgrades && save.upgrades.lights);
  };

  // ---------- placing the model on the path ----------
  const fwdF = new THREE.Vector3(), fwdR = new THREE.Vector3();
  function placeModel() {
    const fa = sampleL(S - FRONT_AXLE, _a), fb = sampleL(S - MID_AXLE, _b);
    let dx = fa.x - fb.x, dz = fa.z - fb.z, l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const hf = Math.atan2(dx, dz);
    // front carriage: its axles on the path
    const cfx = fa.x - dx * (LF / 2 - FRONT_AXLE), cfz = fa.z - dz * (LF / 2 - FRONT_AXLE);
    B.front.position.set(cfx, 0, cfz); B.front.rotation.y = hf;
    fwdF.set(dx, 0, dz);
    // joint: just behind the front carriage; rear carriage hangs from it, its axle on the path
    const jx = cfx - dx * (LF / 2 + GAP / 2), jz = cfz - dz * (LF / 2 + GAP / 2);
    const ra = sampleL(S - LF - GAP - REAR_AXLE + 0.1, _c);
    let rx = jx - ra.x, rz = jz - ra.z; l = Math.hypot(rx, rz) || 1; rx /= l; rz /= l;
    const hr = Math.atan2(rx, rz);
    B.rear.position.set(jx - rx * (GAP / 2 + LR / 2), 0, jz - rz * (GAP / 2 + LR / 2)); B.rear.rotation.y = hr;
    fwdR.set(rx, 0, rz);
    let dh = hr - hf; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    B.joint.position.set(jx, 0, jz); B.joint.rotation.y = hf + dh / 2;
    B.pos.copy(B.front.position); B.heading = hf;
    if (cur) {
      const laneS = S - (cur.endS - cur.lane.len);
      B.edge = cur.edge.id; B.dir = cur.dir;
      const es = BB.clamp(laneS, 0, cur.edge.length);
      B.t = cur.dir > 0 ? es / cur.edge.length : 1 - es / cur.edge.length;
    }
  }

  // ---------- camera ----------
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmpV = new THREE.Vector3();
  let orbit = 0.6;
  function desiredCamera(dt) {
    const mode = B.camMode;
    const mx = (B.front.position.x + B.rear.position.x) / 2, mz = (B.front.position.z + B.rear.position.z) / 2;
    if (mode === 'title') {
      // swing gently on the road side of the bus (never through the buildings beside it)
      orbit += dt * 0.25;
      const h = B.heading, kx = Math.cos(h), kz = -Math.sin(h), fx = Math.sin(h), fz = Math.cos(h);
      const a = 0.75 + Math.sin(orbit) * 0.35;            // angle from the bus's front toward the road side
      camPos.set(mx + (fx * Math.cos(a) - kx * Math.sin(a)) * 21, 8 + Math.sin(orbit * 0.7), mz + (fz * Math.cos(a) - kz * Math.sin(a)) * 21);
      camLook.set(mx, 1.6, mz);
    } else if (mode === 'depot') {
      // from the road side, looking at the bus's door side, with the whole bus left of the depot panel
      const h = (B.heading + Math.atan2(fwdR.x, fwdR.z)) / 2, kx = Math.cos(h), kz = -Math.sin(h);
      const d = 27, cam = BB.camera, vis = 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect;
      const panel = Math.min(440, innerWidth * 0.52) / Math.max(1, innerWidth);
      const sh = vis * panel / 2;                                   // shift the view so the bus sits in the free part
      camPos.set(mx - kx * d - kz * sh, 9, mz - kz * d + kx * sh);
      camLook.set(mx - kz * sh, 1.4, mz + kx * sh);
    } else if (B.atStop) {
      // at a stop: from ahead of the bus, looking back along the kerb at the front door, the shelter and the people
      const h = B.heading, kx = Math.cos(h), kz = -Math.sin(h), fx = Math.sin(h), fz = Math.cos(h);
      const nx = B.front.position.x + fx * LF / 2, nz = B.front.position.z + fz * LF / 2;
      camPos.set(nx + fx * 13 - kx * 7, 10, nz + fz * 13 - kz * 7);
      camLook.set(nx - fx * 5 + kx * 1.5, -1.5, nz - fz * 5 + kz * 1.5);
    } else {
      // chase: close behind and fairly high, trailing along the path (so it stays over the road on curves)
      const wide = BB.camera.aspect > 1.9;              // phones held sideways: a little further back, bus nearer the middle
      const back = (wide ? 21 : 18.5) + B.speed * 0.25;
      const p = pSample(path, S - back, _a);
      camPos.set(p.x, wide ? 13.5 : 12.5, p.z);
      const q = pSample(path, S + (wide ? -4 : 2), _b);
      camLook.set(q.x, 0, q.z);
    }
  }
  function snapCamera() { desiredCamera(0); BB.camera.position.copy(camPos); curLook.copy(camLook); BB.camera.lookAt(curLook); }
  const curLook = new THREE.Vector3();
  function updateCamera(dt) {
    desiredCamera(dt);
    const k = 1 - Math.exp(-(B.camMode === 'chase' && !B.atStop ? 3.2 : 1.8) * dt);
    BB.camera.position.lerp(camPos, k);
    curLook.lerp(camLook, Math.min(1, k * 1.4));
    BB.camera.lookAt(curLook);
  }
  B.setCamera = function (mode, snap) { B.camMode = mode; if (snap) snapCamera(); };

  // ---------- ribbon (glowing chevrons on the road to the target) and beacon ----------
  const RIB_MAX = 320;
  function buildRibbon() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(255,214,92,0.55)'; x.fillRect(0, 0, 64, 64);
    x.fillStyle = 'rgba(255,255,240,0.95)';
    x.beginPath(); x.moveTo(8, 18); x.lineTo(32, 46); x.lineTo(56, 18); x.lineTo(56, 32); x.lineTo(32, 60); x.lineTo(8, 32); x.closePath(); x.fill();
    ribbonTex = new THREE.CanvasTexture(c); ribbonTex.wrapS = ribbonTex.wrapT = THREE.RepeatWrapping;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RIB_MAX * 2 * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(RIB_MAX * 2 * 2), 2));
    const idx = [];
    for (let i = 0; i < RIB_MAX - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    ribbon = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: ribbonTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    ribbon.frustumCulled = false; ribbon.renderOrder = 2; ribbon.name = 'ribbon';
    BB.scene.add(ribbon);
  }
  function buildBeacon() {
    const b = BB.mk.builder();
    b.add(new THREE.ConeGeometry(1.1, 2.2, 6), P.honey, 0, 0, 0, 0, Math.PI);
    b.add(new THREE.TorusGeometry(1.2, 0.22, 4, 12), P.honeyLight, 0, 1.6, 0, 0, Math.PI / 2);
    beacon = new THREE.Mesh(b.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    beacon.name = 'beacon'; beacon.visible = false;
    BB.scene.add(beacon);
  }
  // Rebuild the ribbon from the nose along the planned route to the target.
  function refreshRibbon() {
    ribbonTimer = 0.3;
    if (!ribbon) return;
    if (!B.target || !cur || B.atStop === B.target) { ribbon.geometry.setDrawRange(0, 0); B.route = []; return; }
    const tmp = newPath();
    const s0 = S + 2;
    const a = pSample(path, s0); pPush(tmp, a.x, a.z);
    for (let i = 0; i < path.pts.length; i++) if (path.cum[i] > s0) pPush(tmp, path.pts[i].x, path.pts[i].z);
    const route = planRoute(B.target);
    B.route = route || [];
    if (route == null) { ribbon.geometry.setDrawRange(0, 0); return; }
    let endAt;
    if (!route.length) endAt = targetS - s0;
    else {
      let i = 0;
      for (; i < route.length; i++) { pCorner(tmp, W().lane(route[i].edge, route[i].d)); if (pLen(tmp) > 260) { i++; break; } }
      const last = route[route.length - 1];
      endAt = i >= route.length ? pLen(tmp) - W().lane(last.edge, last.d).len + laneDistOf(B.target) + STOP_AHEAD - 2 : pLen(tmp);
    }
    endAt = Math.min(endAt, pLen(tmp), 260);
    // resample into a strip
    const pos = ribbon.geometry.attributes.position.array, uv = ribbon.geometry.attributes.uv.array;
    let n = 0;
    const step = 1.2, w = 1.0, q = {};
    for (let s = 0; s <= endAt && n < RIB_MAX; s += step) {
      pSample(tmp, Math.min(s, endAt), q);
      const lx = q.dz * w, lz = -q.dx * w;
      pos[n * 6] = q.x + lx; pos[n * 6 + 1] = 0.09; pos[n * 6 + 2] = q.z + lz;
      pos[n * 6 + 3] = q.x - lx; pos[n * 6 + 4] = 0.09; pos[n * 6 + 5] = q.z - lz;
      uv[n * 4] = 0; uv[n * 4 + 1] = -s / 2.2; uv[n * 4 + 2] = 1; uv[n * 4 + 3] = -s / 2.2;
      n++;
    }
    ribbon.geometry.attributes.position.needsUpdate = true; ribbon.geometry.attributes.uv.needsUpdate = true;
    ribbon.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
  }
  B.refreshRibbon = refreshRibbon;

  // ---------- per frame ----------
  let clock = 0;
  B.update = function (dt) {
    if (!cur) return;
    clock += dt;
    // speed: GO pedal, auto pull-in near the target, gentle in turns, never at a stop with doors open
    let want = B.going ? C.maxSpeed : 0;
    if (targetS != null && targetS - S < 22 && !B.doorsOpen) want = Math.max(want, 4.5);  // pulls in by itself
    if (B.doorsOpen || B.atStop || B.noFuel || B.camMode !== 'chase' || B.locked) want = 0;
    const remain = cur.endS - S;
    const plan = B.junction ? (B.junction.chosen || B.junction.suggested) : null;
    if ((plan && plan !== 'straight' && remain < 26) || S < cornerEnd) want = Math.min(want, C.turnSpeed);
    if (targetS != null) want = Math.min(want, Math.sqrt(2 * 4.2 * Math.max(0, targetS - S)) + 0.25);
    if (B.speed < want) B.speed = Math.min(want, B.speed + C.accel * dt);
    else B.speed = Math.max(want, B.speed - (want === 0 && !B.going ? C.coast : C.coast * 1.3) * dt);
    let ds = B.speed * dt;
    if (targetS != null && S + ds >= targetS) ds = Math.max(0, targetS - S);
    S += ds;

    // junction ahead: offer the options, then commit to one
    if (!B.junction && remain < 40 && remain > R + 4) {
      const opts = optionsAhead();
      const sug = suggestedOption(opts);
      B.junction = { opts, chosen: null, suggested: sug.dir };
      if (opts.length > 1) BB.emit('bus:atJunction', { options: opts.map((o) => o.dir), suggested: sug.dir });
    }
    if (cur.endS - S < R + 3) commitTurn();

    // arriving at the target
    if (targetS != null && S >= targetS - 0.02 && B.speed < 1.2) {
      const stop = B.target; S = targetS; B.speed = 0;
      targetS = null; B.target = null; B.atStop = stop;
      if (bay) bay.e0 = Infinity;
      refreshRibbon();
      BB.emit('bus:arrived', { stop });
      const cb = B.onArrive; B.onArrive = null;
      if (cb) cb(stop);
    }
    // bus bay for the target on this lane: steer toward the kerb before it, out again after leaving
    if (targetS != null) {
      if (!bay || (Math.abs(bay.s1 - (targetS - 2)) > 0.01 && (bay.e0 === Infinity || S > bay.e0 + 25))) bay = { s0: targetS - 26, s1: targetS - 2, e0: Infinity };
    } else if (bay && bay.e0 !== Infinity && S - LF - GAP - LR - 2 > bay.e0 + 18) bay = null;

    // fuel
    if (ds > 0 && !B.noFuel) {
      B.fuel = Math.max(0, B.fuel - ds * C.fuelPerUnit);
      if (!lowWarned && B.fuel <= C.fuelLow) { lowWarned = true; BB.emit('bus:fuelLow', { fuel: B.fuel }); }
      if (B.fuel <= 0) { B.noFuel = true; BB.emit('bus:fuelEmpty', {}); }
      saveTimer -= dt;
      if (saveTimer <= 0) { saveTimer = 4; BB.save.fuel = B.fuel; BB.saveNow(); }
    }
    trimPath();
    placeModel();

    // wheels, doors, passengers
    wheelAngle += ds / 0.52;
    for (const w of wheelsF) w.rotation.x = wheelAngle;
    for (const w of wheelsR) w.rotation.x = wheelAngle;
    doorT += ((B.doorsOpen ? 1 : 0) - doorT) * Math.min(1, dt * 6);
    for (const d of [doorF, doorR]) { d.position.x = 1.27 + doorT * 0.1; d.position.z = d.userData.z + doorT * 1.1; }
    const n = BB.clamp(B.passengers | 0, 0, 10);
    if (heads.count !== n) { heads.count = shirts.count = n; }

    // ribbon flow and target beacon
    ribbonTex.offset.y -= dt * 1.1;
    ribbonTimer -= dt;
    if (ribbonTimer <= 0) refreshRibbon();
    if (B.target) {
      beacon.visible = true;
      const t = B.target, bx = t.id === 'depot' ? t.pos.x + t.side.x * 3 : t.pos.x, bz = t.id === 'depot' ? t.pos.z + t.side.z * 3 : t.pos.z;
      beacon.position.set(bx, 6.4 + Math.abs(Math.sin(clock * 3)) * 0.9, bz);
      beacon.rotation.y = clock * 1.5;
    } else beacon.visible = false;

    BB.sfx.engine(B.camMode === 'chase' ? B.speed / C.maxSpeed : 0);
    updateCamera(dt);
  };
  B.updateCamera = updateCamera;

  B.build = function () {
    buildModel();
    B.placeAt(BB.world.depot);
    B.atStop = null;                      // parked, not "at a stop" (doors shut)
    if (bay) bay.e0 = S - 2;
    B.fuel = BB.save.fuel; B.noFuel = B.fuel <= 0;
  };
})();
