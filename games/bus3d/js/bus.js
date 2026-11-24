/* Bendy Bus 3D: the bus.
   A friendly articulated (bendy) bus: a front carriage with a face (eyes on the windscreen, a smile, rosy cheeks),
   an accordion joint and a rear carriage that follows the hitch like a trailer, so it bends on turns. Wheels spin and
   the front ones steer, doors slide, ten seats (two rows of five, a ten-frame) hold smiling passengers.
   Driving is FREE and gentle: BB.bus.input = {fwd, back, left, right} (the HUD and keys set it). Speed eases in and
   out, the top speed is low, reverse is slower, steering only turns while moving and straightens itself when let go.
   The bus never crashes: it slides along buildings, trees and posts (BB.world.pushOut) with a soft bump (bus:bump).
   Stops: the target bay glows on the road; drive in roughly (any angle within 45 degrees, either way round) and slow
   down, and the bus settles into the bay by itself (bus:arrived). Guidance: a glowing ribbon in the LEFT lane from
   the nearest road to the target, a bouncing marker over it and a small arrow over the bus when it's off the way.
   Singapore drives on the left: a gentle spoken tip if the bus keeps to the right lane for a while.
   Also: the chase / stop / title / depot camera, fuel use, lights, stickers, a hat, and a tow truck model.
   Exposes BB.bus (see SPEC.md "Shared contract"). */
(function () {
  'use strict';
  const BB = window.BB, C = BB.cfg, P = BB.P;

  const B = BB.bus = {
    group: null, front: null, rear: null, joint: null,
    pos: new THREE.Vector3(), heading: 0, speed: 0, edge: null, t: 0, dir: 1,
    fuel: BB.save.fuel, seats: [], passengers: 0, paint: P.busGreen,
    target: null, atStop: null, doorsOpen: false, going: false, noFuel: false,
    camMode: 'title', junction: null, route: [], steer: 0,
    input: { fwd: false, back: false, left: false, right: false },
    hatMount: null, stickerAnchors: [], lightsOn: true,
  };

  const LF = 7.4, LR = 6.0, GAP = 1.0;   // front carriage, rear carriage, joint gap lengths
  const FRONT_AXLE = 1.3, MID_AXLE = 5.6, REAR_AXLE = 4.2;   // axle distances (from nose / from joint)
  const WB = MID_AXLE - FRONT_AXLE;      // wheelbase of the front carriage
  const AX = MID_AXLE - LF / 2;          // front carriage centre -> its rear axle
  const HITCH = LF / 2 + GAP / 2;        // front carriage centre -> hitch
  const R_AXLE = GAP / 2 + REAR_AXLE, R_CTR = GAP / 2 + LR / 2;   // hitch -> rear axle / rear carriage centre
  const MAX_FWD = 9, MAX_BACK = 4, ACCEL = 4.2, BRAKE = 9, COAST = 5;
  const MAX_STEER = 0.55, STEER_IN = 2.2, STEER_OUT = 3.0, MAX_BEND = 55 * Math.PI / 180;
  const W = () => BB.world;
  const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  // ---------- state: the front carriage centre (fx,fz), its heading h, the rear carriage's heading hr ----------
  let fx = 0, fz = 0, h = 0, hr = 0, gy = 0;
  let settle = null;                    // {from:{fx,fz,h,hr}, to:{...}, t, stop}
  let wheelAngle = 0, doorT = 0, ribbonTimer = 0, saveTimer = 0, lowWarned = false, bumpCool = 0, wobble = 0;
  let wrongLaneT = 0, lastTip = -99, clock = 0, blinkT = 3;
  const fwdOf = (a) => ({ x: Math.sin(a), z: Math.cos(a) });

  // ---------- public: placing, targets, doors, controls ----------
  function poseAtBay(stop, reversed) {
    const bay = W().bayOf(stop);
    const hh = reversed ? wrapA(bay.heading + Math.PI) : bay.heading, f = fwdOf(hh);
    // the whole bus (front centre .. rear centre) sits centred on the bay
    const total = LF + GAP + LR, cx = bay.x + f.x * (total / 2 - LF / 2), cz = bay.z + f.z * (total / 2 - LF / 2);
    return { fx: cx, fz: cz, h: hh, hr: hh };
  }
  // Park the bus at a stop or the depot (used at start, after a tow).
  B.placeAt = function (stop) {
    const p = poseAtBay(stop, false);
    fx = p.fx; fz = p.fz; h = p.h; hr = p.hr;
    B.speed = 0; B.steer = 0; settle = null;
    B.atStop = stop; B.target = null; B.onArrive = null;
    placeModel(); snapCamera();
    refreshRibbon();
  };
  // Put the bus anywhere, straight, facing heading (x,z = the front carriage's centre). Used by tows and tests.
  B.setPose = function (x, z, heading) {
    fx = x; fz = z; h = hr = wrapA(heading || 0); B.speed = 0; B.steer = 0; settle = null; B.atStop = null;
    placeModel();
  };
  // Drive to (and settle in) a stop or the depot; cb(stop) runs on arrival. Null clears the target.
  B.stopAt = function (stop, cb) {
    B.target = stop || null; B.onArrive = cb || null;
    refreshRibbon();
  };
  B.openDoors = function () { if (!B.doorsOpen) { B.doorsOpen = true; BB.sfx.door(); } };
  B.closeDoors = function () {
    if (!B.doorsOpen && !B.atStop) return;
    if (B.doorsOpen) BB.sfx.door();
    B.doorsOpen = false; B.atStop = null;
  };
  B.go = function (on) { B.going = !!on; B.input.fwd = !!on; };
  B.choose = function () { return false; };          // (junction arrows are gone with free driving)
  B.refuel = function (amount) {
    B.fuel = BB.clamp(amount == null ? 1 : B.fuel + amount, 0, 1);
    if (B.fuel > C.fuelLow + 0.05) lowWarned = false;
    B.noFuel = B.fuel <= 0;
    BB.save.fuel = B.fuel; BB.saveNow();
    BB.emit('fuel:changed', { fuel: B.fuel });
  };
  B.horn = function () { BB.sfx.horn(!!BB.save.upgrades.horn); hornT = 0.6; BB.emit('bus:horn'); };
  let hornT = 0;
  // World position of seat i (0..9).
  B.seatWorld = function (i, v) { v = v || new THREE.Vector3(); const s = B.seats[i]; v.set(s.x, s.y, s.z); return B.front.localToWorld(v); };
  B.doorWorld = function (v) { v = v || new THREE.Vector3(); v.set(1.6, 0, LF / 2 - 1.0); return B.front.localToWorld(v); };
  B.pathAhead = () => 0;
  B.isSettling = () => !!settle;
  B.isFacingAway = () => facingAway;
  // Lights (the headlights and tail lights; off for the goodnight moment, which also closes the bus's eyes).
  // A gentle automatic turn-round (kid magic): the bus does a happy hop-and-spin on the spot and lands facing the
  // other way, in the left lane of the road it is on. The HUD shows a button for it while bus:facingAway is on.
  let spin = null;
  B.turnAround = function () {
    if (spin || settle || B.atStop || B.doorsOpen || B.locked || B.noFuel || B.camMode !== 'chase') return false;
    const m = midPoint(), h2 = wrapA(h + Math.PI), f2 = fwdOf(h2);
    let sx = 0, sz = 0;
    const near = nearestRoad(m.x, m.z);
    if (near && near.d < C.roadHalf + 1) {
      const dot = f2.x * near.dx + f2.z * near.dz;
      if (Math.abs(dot) > 0.7) {
        const s = Math.sign(dot), lx = near.dz * s, lz = -near.dx * s;          // left of the new way
        const lat = (m.x - near.x) * lx + (m.z - near.z) * lz;
        sx = lx * (C.lane - lat); sz = lz * (C.lane - lat);
      }
    }
    spin = { t: 0, m, h0: h, bend: wrapA(hr - h), sx, sz };
    B.speed = 0; B.steer = 0;
    BB.sfx.whoosh(); BB.sfx.sparkle && BB.sfx.sparkle();
    BB.emit('bus:turnAround', {});
    if (facingAway) { facingAway = false; BB.emit('bus:facingAway', { on: false }); }
    return true;
  };
  B.isSpinning = () => !!spin;
  function updateSpin(dt) {
    spin.t = Math.min(1, spin.t + dt / 1.5);
    const k = BB.smooth(spin.t), a = spin.h0 + Math.PI * k;
    h = wrapA(a); hr = wrapA(a + spin.bend * (1 - k));
    const mx = spin.m.x + spin.sx * k, mz = spin.m.z + spin.sz * k, f = fwdOf(h);
    fx = mx + f.x * ((LF + GAP + LR) / 2 - LF / 2); fz = mz + f.z * ((LF + GAP + LR) / 2 - LF / 2);
    spinHop = Math.sin(Math.PI * spin.t) * 0.7;
    if (spin.t >= 1) { spin = null; spinHop = 0; collide(); camH = h; refreshRibbon(); }
  }
  let spinHop = 0, facingAway = false, awayT = 0;
  B.setLights = function (on) { B.lightsOn = !!on; B.sleepy = !on; };

  // ---------- model ----------
  let paintMat, glassMat, lampMat, eyesF, pupils, wheelsF = [], wheelsR = [], steerWheels = [], doorF, doorR;
  let heads, hair, shirts, lightCones, beacon, ribbon, ribbonTex, bayGlow, bayTex, wayArrow, jointF, jointR;
  // Rounded profile (in x-y) extruded along z: the bus body's soft paper-cut look.
  function profile(w, y0, y1, rt, rb) {
    const s = new THREE.Shape(), x0 = -w / 2, x1 = w / 2;
    s.moveTo(x0 + rb, y0); s.lineTo(x1 - rb, y0); s.quadraticCurveTo(x1, y0, x1, y0 + rb);
    s.lineTo(x1, y1 - rt); s.quadraticCurveTo(x1, y1, x1 - rt, y1); s.lineTo(x0 + rt, y1);
    s.quadraticCurveTo(x0, y1, x0, y1 - rt); s.lineTo(x0, y0 + rb); s.quadraticCurveTo(x0, y0, x0 + rb, y0);
    return s;
  }
  function slab(w, y0, y1, rt, rb, len, bevel = 0.14) {
    const g = new THREE.ExtrudeGeometry(profile(w - 2 * bevel, y0 + bevel, y1 - bevel, rt, rb), { depth: len - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 3 });
    g.translate(0, 0, -(len - 2 * bevel) / 2);
    return g;
  }
  function buildModel() {
    paintMat = new THREE.MeshLambertMaterial({ color: B.paint, vertexColors: true });
    glassMat = new THREE.MeshLambertMaterial({ color: 0xbfe6f5, transparent: true, opacity: 0.4, depthWrite: false, emissive: 0x000000 });
    lampMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    B.group = new THREE.Group(); B.group.name = 'bus';
    B.front = carriage(true); B.rear = carriage(false);
    jointF = jointMesh(1); jointR = jointMesh(-1); B.joint = jointF;
    B.group.add(B.front, B.rear, jointF, jointR);
    // seats: two rows of five (a ten-frame). Row 1 = seats 0-4 on the door (left, +x) side, front to back.
    for (let i = 0; i < 10; i++) B.seats.push({ x: i < 5 ? 0.62 : -0.62, y: 1.25, z: 1.9 - (i % 5) * 1.15 });
    buildPassengers();
    // headlight beams (brighter with the upgrade; softly at night)
    const lb = BB.mk.builder();
    for (const x of [-0.8, 0.8]) lb.add(new THREE.ConeGeometry(1.4, 7, 10, 1, true), '#fff6c0', x, 0.9, LF / 2 + 3.5, 0, Math.PI / 2 + 0.12);
    lightCones = new THREE.Mesh(lb.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    lightCones.visible = false; B.front.add(lightCones);
    // hat mount on the front roof, sticker anchors on the sides (and a super sticker spot on the rear roof)
    B.hatMount = new THREE.Group(); B.hatMount.name = 'hatMount'; B.hatMount.position.set(0, 3.1, LF / 2 - 1.7); B.front.add(B.hatMount);
    const anchor = (car, x, y, z, ry, rx, size) => { const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.set(rx || 0, ry, 0, 'YXZ'); o.userData.size = size; car.add(o); return o; };
    B.stickerAnchors = [
      [anchor(B.front, 1.27, 1.0, 0.45, Math.PI / 2, 0, 1.15), anchor(B.front, -1.27, 1.0, 0.45, -Math.PI / 2, 0, 1.15)],
      [anchor(B.rear, 1.27, 1.0, -2.3, Math.PI / 2, 0, 1.0), anchor(B.rear, -1.27, 1.0, -2.3, -Math.PI / 2, 0, 1.0)],
      [anchor(B.rear, 0, 3.1, -0.4, 0, -Math.PI / 2, 2.0)],
    ];
    BB.scene.add(B.group);
    buildRibbon(); buildBeacon(); buildBayGlow(); buildWayArrow();
    B.setPaint(BB.save.paint);
    B.applyCustom(BB.save);
  }
  function carriage(isFront) {
    const L = isFront ? LF : LR, g = new THREE.Group();
    const paint = BB.mk.builder(), det = BB.mk.builder(), glass = BB.mk.builder(), lamps = BB.mk.builder();
    const zf = L / 2, zb = -L / 2;
    // painted body (vertex colour white = paint colour, grey = a deeper tone of it): a rounded lower body, window
    // pillars and a rounded roof
    paint.add(slab(2.5, 0.42, 1.32, 0.12, 0.18, L), '#ffffff');
    paint.add(slab(2.54, 0.4, 0.72, 0.1, 0.16, L + 0.04, 0.1), '#b9b9b9');             // darker skirt
    paint.add(slab(2.5, 2.36, 3.1, 0.5, 0.05, L), '#ffffff');
    const nWin = isFront ? 4 : 3;
    for (let k = 0; k <= nWin; k++) {
      const z = zb + 0.25 + (L - 0.5) * k / nWin;
      if (isFront && k === nWin) continue;
      paint.box(2.48, 1.06, 0.2, '#ffffff', 0, 1.31, z);
    }
    if (isFront) paint.box(2.48, 1.06, 0.25, '#ffffff', 0, 1.31, zf - 0.2);
    det.box(1.4, 0.32, L * 0.34, '#f4ecdc', 0, 3.02, -L * 0.12);                    // roof pod (air-con)
    det.box(1.1, 0.1, L * 0.3, '#ffffff', 0, 3.34, -L * 0.12);
    det.box(2.3, 0.1, L - 0.3, '#6c6470', 0, 0.62, 0);                               // floor (seen through glass)
    // a cream band along each side that stays cream whatever the paint
    for (const s of [1, -1]) det.box(0.06, 0.16, L - 0.5, '#fff6e0', s * 1.255, 1.1, 0);
    glass.box(2.42, 1.02, L - 0.3, '#ffffff', 0, 1.33, 0);
    // wheel arches (dark half discs on both sides)
    const axles = isFront ? [zf - FRONT_AXLE, zf - MID_AXLE] : [zf - REAR_AXLE];
    for (const z of axles) for (const s of [1, -1]) det.add(new THREE.CircleGeometry(0.72, 10, 0, Math.PI), '#4a3f4c', s * 1.262, 0.42, z, s * Math.PI / 2);
    for (let i = 0; i < 5 && isFront; i++) for (const x of [0.62, -0.62]) det.box(0.8, 0.72, 0.18, P.berry, x, 0.66, 1.9 - i * 1.15 - 0.42);
    if (isFront) {
      det.box(2.3, 1.1, 0.1, '#3f5f7d', 0, 1.32, zf + 0.01);                        // windscreen
      det.box(1.9, 0.3, 0.12, '#2b2430', 0, 2.48, zf + 0.0);                        // destination sign
      for (let k = 0; k < 5; k++) det.box(0.22, 0.14, 0.14, P.honeyLight, -0.6 + k * 0.3, 2.56, zf + 0.02);
      det.add(slab(2.6, 0.18, 0.55, 0.12, 0.12, 0.42, 0.06), '#5a5260', 0, 0, zf + 0.02);   // bumper
      // the face: a smile and rosy cheeks on the front panel (eyes are their own meshes, so they can blink)
      det.add(new THREE.TorusGeometry(0.34, 0.06, 4, 10, Math.PI), '#3a2a3c', 0, 0.96, zf + 0.03, 0, 0, Math.PI);
      for (const x of [-0.72, 0.72]) det.add(new THREE.CircleGeometry(0.17, 10), '#ff8f9f', x, 0.88, zf + 0.045, 0, 0, 0, 1, 0.7, 1);
      for (const x of [-0.88, 0.88]) { lamps.add(new THREE.CircleGeometry(0.2, 12), '#fff6c8', x, 0.75, zf + 0.06); det.add(new THREE.CircleGeometry(0.26, 12), '#e9e2d6', x, 0.75, zf + 0.05); lamps.box(0.22, 0.1, 0.06, P.honey, x * 1.22, 1.15, zf + 0.04); }
      for (const s of [1, -1]) { det.box(0.08, 0.5, 0.08, '#5a5260', s * 1.32, 1.95, zf - 0.3); det.ball(0.2, '#5a5260', s * 1.42, 1.75, zf - 0.2, 0, 0.6, 1.2, 0.9); }   // mirrors
      // the driver sits on the RIGHT (-x), with a cap and a steering wheel
      det.box(0.7, 0.9, 0.5, '#4a4250', -0.62, 0.62, zf - 0.85);
      det.cyl(0.22, 0.28, 0.6, 6, '#4f7fe0', -0.62, 1.15, zf - 0.75);
      det.ball(0.24, '#d9a679', -0.62, 1.95, zf - 0.75);
      det.ball(0.26, '#2b5aa8', -0.62, 2.05, zf - 0.78, 0, 1, 0.55, 1); det.box(0.34, 0.05, 0.26, '#2b5aa8', -0.62, 2.03, zf - 0.55);
      det.add(new THREE.TorusGeometry(0.22, 0.04, 4, 10), '#3a2a3c', -0.62, 1.55, zf - 0.38, 0, -0.9);
    } else {
      det.box(2.0, 0.9, 0.1, '#3f5f7d', 0, 1.4, zb - 0.01);                        // rear window
      det.add(slab(2.6, 0.18, 0.55, 0.12, 0.12, 0.42, 0.06), '#5a5260', 0, 0, zb - 0.02);
      for (const x of [-0.92, 0.92]) lamps.box(0.36, 0.42, 0.06, '#ff5a4a', x, 0.85, zb - 0.06);
      det.box(1.6, 0.2, 0.08, '#fff6e0', 0, 2.62, zb - 0.02);
    }
    const pm = paint.mesh(paintMat), dm = det.mesh(), gm = glass.mesh(glassMat), lm = lamps.mesh(lampMat);
    gm.renderOrder = 3;
    g.add(pm, dm, gm, lm);
    if (isFront) {
      // big friendly eyes on the windscreen (whites; pupils move with the steering; they blink)
      const eb = BB.mk.builder(), pb = BB.mk.builder();
      for (const x of [-0.5, 0.5]) { eb.ball(0.36, '#ffffff', x, 0, 0, 1, 1, 1.18, 0.35); eb.ball(0.4, '#f0e8da', x, 0.02, -0.03, 1, 1, 1.18, 0.3); }
      for (const x of [-0.5, 0.5]) { pb.ball(0.17, '#3a2a3c', x, -0.04, 0.1, 1, 1, 1.15, 0.4); pb.ball(0.06, '#ffffff', x + 0.06, 0.04, 0.16, 0, 1, 1, 0.5); }
      eyesF = new THREE.Group(); eyesF.position.set(0, 1.62, LF / 2 + 0.08);
      const em = eb.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }));
      pupils = pb.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }));
      eyesF.add(em, pupils); g.add(eyesF);
    }
    // doors (kerb side, +x): front door near the nose, rear door on the rear carriage
    const db = BB.mk.builder();
    db.box(0.08, 1.95, 0.55, P.glassDark, 0, 0, -0.29); db.box(0.08, 1.95, 0.55, P.glassDark, 0, 0, 0.29);
    db.box(0.1, 0.12, 1.2, P.honey, 0, 1.95, 0); db.box(0.1, 1.95, 0.08, P.honey, 0, 0, 0);
    const door = db.mesh(); door.position.set(1.27, 0.5, isFront ? zf - 1.0 : zf - 1.6); door.userData.z = door.position.z;
    g.add(door);
    if (isFront) doorF = door; else doorR = door;
    // wheels: one mesh per axle (both wheels), spinning about x; the front axle also steers
    for (const z of axles) {
      const wb = BB.mk.builder();
      for (const x of [-1.08, 1.08]) {
        wb.add(new THREE.CylinderGeometry(0.52, 0.52, 0.36, 12), '#2f2a33', x, 0, 0, 0, 0, Math.PI / 2);
        wb.add(new THREE.CylinderGeometry(0.27, 0.27, 0.38, 8), P.honeyLight, x, 0, 0, 0, 0, Math.PI / 2);
        wb.box(0.4, 0.42, 0.1, '#f4ecdc', x, -0.21, 0);
      }
      const wm = wb.mesh(); wm.position.set(0, 0.52, z); wm.rotation.order = 'YXZ';
      g.add(wm);
      (isFront ? wheelsF : wheelsR).push(wm);
      if (isFront && z === zf - FRONT_AXLE) steerWheels.push(wm);
    }
    const blob = BB.mk.blob(3.6, L + 1.6); blob.position.y = 0.08; g.add(blob);
    return g;
  }
  // The accordion: soft rounded rings, half on each carriage's side of the hitch, so it bends without gaps.
  function jointMesh(side) {
    const b = BB.mk.builder();
    for (let k = 0; k < 3; k++) b.add(slab(2.3, 0.5, 2.95, 0.4, 0.1, 0.13, 0.04), k % 2 ? '#5d5466' : '#463e50', 0, 0, side * (0.08 + k * 0.17));
    b.box(2.0, 0.08, 0.55, '#6c6470', 0, 0.5, side * 0.27);
    const m = b.mesh(); m.name = 'joint'; return m;
  }
  // Passengers: instanced heads with faces (they look out of the windows), hair and shirts.
  function buildPassengers() {
    const hb = BB.mk.builder();
    hb.ball(0.33, '#ffffff', 0, 0.62, 0, 1);
    for (const x of [-0.11, 0.11]) hb.ball(0.045, '#3a2a3c', x, 0.66, 0.3, 0);
    hb.add(new THREE.TorusGeometry(0.1, 0.025, 3, 8, Math.PI), '#3a2a3c', 0, 0.55, 0.3, 0, 0, Math.PI);
    for (const x of [-0.18, 0.18]) hb.ball(0.06, '#ff9fa8', x, 0.56, 0.27, 0, 1, 0.7, 0.4);
    const hairG = new THREE.SphereGeometry(0.36, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const hairB = BB.mk.builder(); hairB.add(hairG, '#ffffff', 0, 0.66, -0.04, 0, -0.35); hairB.ball(0.14, '#ffffff', 0, 0.78, -0.3, 0);
    const sg = new THREE.CylinderGeometry(0.28, 0.38, 0.6, 7).toNonIndexed(); sg.computeVertexNormals();
    const iv = { vertexColors: true };
    heads = new THREE.InstancedMesh(hb.geometry(), new THREE.MeshLambertMaterial(iv), 10);
    hair = new THREE.InstancedMesh(hairB.geometry(), new THREE.MeshLambertMaterial(iv), 10);
    shirts = new THREE.InstancedMesh(sg, new THREE.MeshLambertMaterial(), 10);
    const skins = ['#f1c7a0', '#d9a679', '#a8714a', '#f5d3b5', '#7a4b2e'], tops = [P.coral, P.teal, P.honey, P.berry, P.plum, P.leaf, P.rose];
    const hairs = ['#3a2a2c', '#6b4a2e', '#1f1b22', '#b5793e', '#d8d0c8', '#8a3b2e'];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    B.seats.forEach((s, i) => {
      q.setFromAxisAngle(up, (s.x > 0 ? 1 : -1) * (0.75 + (i % 3) * 0.15));
      m.compose(p.set(s.x, s.y, s.z), q, one);
      heads.setMatrixAt(i, m); hair.setMatrixAt(i, m); shirts.setMatrixAt(i, m);
      heads.setColorAt(i, new THREE.Color(skins[(i * 3) % skins.length])); shirts.setColorAt(i, new THREE.Color(tops[(i * 2 + 1) % tops.length]));
      hair.setColorAt(i, new THREE.Color(hairs[(i * 5 + 1) % hairs.length]));
    });
    heads.count = hair.count = shirts.count = 0;
    const pg = new THREE.Group(); pg.add(heads, hair, shirts); B.front.add(pg); B.paxGroup = pg;
  }

  B.setPaint = function (c) {
    const found = BB.PAINTS.find((p) => p.id === c);
    B.paint = found ? found.color : (typeof c === 'string' && c[0] === '#' ? c : P.busGreen);
    if (paintMat) paintMat.color.set(B.paint);
  };

  // ---------- stickers and hats ----------
  // Sticker pictures (paper stickers with a white border). Ids: star, heart, flower, smile, rainbow, paw, sun, fish.
  B.STICKERS = ['star', 'heart', 'flower', 'smile', 'rainbow', 'paw', 'sun', 'fish'];
  const stickerCache = {};
  B.stickerPic = function (id, size = 128) {
    const key = id + size;
    if (stickerCache[key]) return stickerCache[key];
    if (B.STICKERS.indexOf(id) < 0) return null;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'); x.scale(size / 100, size / 100); x.lineJoin = 'round'; x.lineCap = 'round';
    const path = () => {
      x.beginPath();
      switch (id) {
        case 'star': for (let i = 0; i < 10; i++) { const r = i % 2 ? 19 : 40, a = -Math.PI / 2 + i * Math.PI / 5; x.lineTo(50 + Math.cos(a) * r, 53 + Math.sin(a) * r); } x.closePath(); break;
        case 'heart': x.moveTo(50, 84); x.bezierCurveTo(10, 58, 12, 18, 38, 20); x.bezierCurveTo(46, 21, 50, 28, 50, 32); x.bezierCurveTo(50, 28, 54, 21, 62, 20); x.bezierCurveTo(88, 18, 90, 58, 50, 84); break;
        case 'flower': for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; x.moveTo(50 + Math.cos(a) * 22 + 17, 50 + Math.sin(a) * 22); x.arc(50 + Math.cos(a) * 22, 50 + Math.sin(a) * 22, 17, 0, Math.PI * 2); } break;
        case 'rainbow': x.arc(50, 70, 40, Math.PI, 0); x.lineTo(78, 70); x.arc(50, 70, 18, 0, Math.PI, true); x.closePath(); break;
        case 'paw': for (const [px, py, r] of [[50, 62, 20], [26, 38, 10], [42, 26, 10], [58, 26, 10], [74, 38, 10]]) { x.moveTo(px + r, py); x.arc(px, py, r, 0, Math.PI * 2); } break;
        case 'fish': x.ellipse(44, 50, 30, 20, 0, 0, Math.PI * 2); x.moveTo(70, 50); x.lineTo(92, 32); x.lineTo(92, 68); x.closePath(); break;
        default: x.arc(50, 50, 36, 0, Math.PI * 2);
      }
    };
    // white sticker border, then the colour, then a darker crescent lower right, then details
    x.save(); path(); x.strokeStyle = '#ffffff'; x.lineWidth = 14; x.stroke(); x.fillStyle = '#fff'; x.fill(); x.restore();
    const col = { star: P.honey, heart: P.coral, flower: P.rose, smile: P.honeyLight, rainbow: P.coral, paw: P.plum, sun: '#ffb81f', fish: '#4fa3e0' }[id];
    path(); x.fillStyle = col; x.fill();
    x.save(); path(); x.clip(); x.globalAlpha = 0.22; x.fillStyle = '#5a2a20'; x.beginPath(); x.arc(30, 30, 72, 0, Math.PI * 2); x.arc(18, 18, 72, 0, Math.PI * 2, true); x.fill(); x.restore();
    x.fillStyle = '#3a2a3c'; x.strokeStyle = '#3a2a3c'; x.lineWidth = 4;
    if (id === 'smile' || id === 'sun' || id === 'star') {
      const cy = id === 'star' ? 55 : 46;
      x.beginPath(); x.arc(41, cy, 4, 0, 7); x.arc(59, cy, 4, 0, 7); x.fill();
      x.beginPath(); x.arc(50, cy + 6, 10, 0.2, Math.PI - 0.2); x.stroke();
    }
    if (id === 'sun') { x.strokeStyle = '#ffb81f'; x.lineWidth = 6; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; x.beginPath(); x.moveTo(50 + Math.cos(a) * 42, 50 + Math.sin(a) * 42); x.lineTo(50 + Math.cos(a) * 48, 50 + Math.sin(a) * 48); x.stroke(); } }
    if (id === 'flower') { x.fillStyle = P.honeyLight; x.beginPath(); x.arc(50, 50, 13, 0, 7); x.fill(); }
    if (id === 'rainbow') { for (const [r, c2] of [[34, P.honey], [27, P.leaf], [21, '#4fa3e0']]) { x.strokeStyle = c2; x.lineWidth = 6; x.beginPath(); x.arc(50, 70, r, Math.PI, 0); x.stroke(); } }
    if (id === 'fish') { x.fillStyle = '#fff'; x.beginPath(); x.arc(30, 45, 6, 0, 7); x.fill(); x.fillStyle = '#3a2a3c'; x.beginPath(); x.arc(31, 45, 3, 0, 7); x.fill(); }
    if (id === 'heart') { x.fillStyle = 'rgba(255,255,255,.55)'; x.beginPath(); x.ellipse(34, 34, 7, 5, -0.6, 0, 7); x.fill(); }
    stickerCache[key] = c;
    return c;
  };
  const stickerMeshes = [[], [], []];
  // Put a sticker on slot 0 (front carriage sides), 1 (rear carriage sides) or 2 (the super spot on the rear roof).
  // src: a sticker id, any BB.pic name, a canvas, or null to remove it.
  B.setSticker = function (slot, src) {
    for (const m of stickerMeshes[slot] || []) { m.parent && m.parent.remove(m); m.geometry.dispose(); m.material.map && m.material.map.dispose(); m.material.dispose(); }
    stickerMeshes[slot] = [];
    if (!src || !B.stickerAnchors[slot]) return;
    const cv = typeof src === 'string' ? (B.stickerPic(src) || (BB.depot && BB.depot.stickerPic && BB.depot.stickerPic(src)) || BB.pic(src, 128)) : src;
    const tex = new THREE.CanvasTexture(cv);
    for (const a of B.stickerAnchors[slot]) {
      const s = a.userData.size;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }));
      a.add(m); stickerMeshes[slot].push(m);
    }
  };
  // Hats for the roof. Ids: party, crown, cap, flower, bow, chef.
  B.HATS = ['party', 'crown', 'cap', 'flower', 'bow', 'chef'];
  B.makeHat = function (id) {
    const b = BB.mk.builder();
    switch (id) {
      case 'party':
        b.add(new THREE.ConeGeometry(0.75, 1.8, 8), P.berry, 0, 0.9, 0);
        for (let k = 0; k < 6; k++) { const a = k * 1.1, y = 0.35 + k * 0.22, r = 0.68 - y * 0.37; b.ball(0.11, [P.honey, P.coral, '#ffffff'][k % 3], Math.sin(a) * r, y, Math.cos(a) * r); }
        b.ball(0.24, P.honeyLight, 0, 1.85, 0, 1);
        break;
      case 'crown':
        b.cyl(0.85, 0.85, 0.5, 10, P.honey, 0, 0, 0);
        for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; b.add(new THREE.ConeGeometry(0.25, 0.6, 4), P.honey, Math.sin(a) * 0.7, 0.8, Math.cos(a) * 0.7); b.ball(0.12, [P.coral, '#4fa3e0', P.leaf][k % 3], Math.sin(a) * 0.86, 0.25, Math.cos(a) * 0.86); }
        break;
      case 'cap':
        b.add(new THREE.SphereGeometry(0.85, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), P.coral, 0, 0, 0);
        b.box(1.3, 0.08, 1.0, P.coral, 0, 0, 0.95); b.ball(0.13, '#ffffff', 0, 0.85, 0);
        break;
      case 'flower':
        b.cyl(0.08, 0.1, 0.9, 5, P.leaf, 0, 0, 0);
        for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; b.ball(0.32, P.rose, Math.sin(a) * 0.45, 1.05, Math.cos(a) * 0.45, 1, 1, 0.5, 1); }
        b.ball(0.3, P.honeyLight, 0, 1.12, 0, 1, 1, 0.6, 1);
        b.box(0.5, 0.06, 0.25, P.leaf, 0.3, 0.45, 0, 0, 0, 0.5);
        break;
      case 'bow':
        b.ball(0.5, P.coral, -0.55, 0.45, 0, 1, 1.2, 0.8, 0.5); b.ball(0.5, P.coral, 0.55, 0.45, 0, 1, 1.2, 0.8, 0.5);
        b.ball(0.25, '#e8473b', 0, 0.45, 0, 1);
        break;
      case 'chef':
        b.cyl(0.6, 0.6, 0.6, 10, '#ffffff', 0, 0, 0);
        for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; b.ball(0.42, '#ffffff', Math.sin(a) * 0.38, 0.85, Math.cos(a) * 0.38, 1); }
        b.ball(0.45, '#fffaf0', 0, 1.05, 0, 1);
        break;
      default: return null;
    }
    const m = b.mesh(); m.name = 'hat:' + id; return m;
  };
  // Put a hat on the roof: an id from B.HATS, any Object3D (the depot can make its own), or null.
  let myHat = null;
  B.setHat = function (hat) {
    if (!B.hatMount) return;
    if (myHat) B.hatMount.remove(myHat);                  // only our own hat: the depot may hang its own here too
    myHat = typeof hat === 'string' ? B.makeHat(hat) : hat || null;
    if (myHat) B.hatMount.add(myHat);
  };
  // Apply the saved customisation: paint, headlights upgrade, stickers (save.stickers[0..2]; slot 2 needs the
  // super sticker upgrade) and the hat (save.hat).
  B.applyCustom = function (save) {
    save = save || BB.save;
    B.setPaint(save.paint);
    const st = Array.isArray(save.stickers) ? save.stickers : [];
    for (let i = 0; i < 3; i++) {
      const want = i === 2 && !(save.upgrades && save.upgrades.sticker3) ? null : st[i] || null;
      if (stickerMeshes[i].want !== want) { B.setSticker(i, want); stickerMeshes[i].want = want; }
    }
    if (B.hatMount && B.hatMount.userData.id !== (save.hat || null)) { B.setHat(save.hat || null); B.hatMount.userData.id = save.hat || null; }
  };

  // ---------- tow truck (the jobs builder animates it) ----------
  // B.makeTowTruck() -> Group (forward +z, about 2.4 wide, 6.6 long) with userData: wheels [meshes, spin about x],
  // beacon (the flashing light), hook (an Object3D at the tow hook, behind the truck), update(dt, speed).
  B.makeTowTruck = function () {
    const g = new THREE.Group(); g.name = 'towTruck';
    const b = BB.mk.builder();
    b.add(slab(2.3, 0.45, 1.3, 0.12, 0.15, 6.4), '#ff9a3c', 0, 0, -0.2);           // chassis
    b.add(slab(2.3, 1.2, 2.9, 0.45, 0.05, 2.4), '#ffb81f', 0, 0, 1.6);               // cab
    b.box(2.0, 0.9, 0.1, '#3f5f7d', 0, 1.6, 2.81);                                   // windscreen
    for (const s of [1, -1]) b.box(0.1, 0.8, 1.4, '#3f5f7d', s * 1.16, 1.65, 1.6);
    b.add(new THREE.TorusGeometry(0.3, 0.06, 4, 10, Math.PI), '#3a2a3c', 0, 1.05, 2.82, 0, 0, Math.PI);
    for (const x of [-0.8, 0.8]) { b.add(new THREE.CircleGeometry(0.18, 10), '#fff6c8', x, 0.8, 2.82); b.add(new THREE.CircleGeometry(0.15, 10), '#ff8f9f', x * 0.75, 1.0, 2.83, 0, 0, 0, 1, 0.7, 1); }
    b.add(slab(2.4, 0.2, 0.55, 0.1, 0.1, 0.35, 0.05), '#5a5260', 0, 0, 2.95);
    // the crane boom and hook
    b.box(1.8, 0.3, 3.4, '#e9e2d6', 0, 1.3, -1.6);
    b.box(0.4, 1.4, 0.4, P.coral, 0, 1.6, -0.6);
    b.box(0.35, 0.35, 3.2, P.coral, 0, 2.7, -1.9, 0, -0.45);
    b.box(0.06, 1.2, 0.06, '#5a5260', 0, 2.0, -3.35);
    b.add(new THREE.TorusGeometry(0.22, 0.07, 4, 8, Math.PI * 1.4), '#5a5260', 0, 1.85, -3.35, Math.PI / 2);
    for (let k = 0; k < 4; k++) b.box(0.3, 0.12, 0.2, k % 2 ? '#3a2a3c' : P.honey, -0.45 + k * 0.3, 0.75, -3.42);
    const body = b.mesh(); g.add(body);
    const eb = BB.mk.builder();
    for (const x of [-0.45, 0.45]) { eb.ball(0.28, '#ffffff', x, 1.95, 2.86, 1, 1, 1.15, 0.35); eb.ball(0.13, '#3a2a3c', x + 0.03, 1.92, 2.94, 0, 1, 1.1, 0.4); eb.ball(0.05, '#ffffff', x + 0.08, 1.99, 2.99, 0); }
    g.add(eb.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })));
    const beaconM = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.3, 8), new THREE.MeshBasicMaterial({ color: '#ff8a3d' }));
    beaconM.position.set(0, 3.05, 1.6); g.add(beaconM);
    const wheels = [];
    for (const z of [1.6, -1.8]) {
      const wb = BB.mk.builder();
      for (const x of [-1.05, 1.05]) { wb.add(new THREE.CylinderGeometry(0.48, 0.48, 0.34, 12), '#2f2a33', x, 0, 0, 0, 0, Math.PI / 2); wb.add(new THREE.CylinderGeometry(0.24, 0.24, 0.36, 8), '#e9e2d6', x, 0, 0, 0, 0, Math.PI / 2); wb.box(0.36, 0.38, 0.1, P.honey, x, -0.19, 0); }
      const wm = wb.mesh(); wm.position.set(0, 0.48, z); g.add(wm); wheels.push(wm);
    }
    const blob = BB.mk.blob(3.2, 7.4); blob.position.y = 0.08; g.add(blob);
    const hook = new THREE.Object3D(); hook.position.set(0, 1.6, -3.4); g.add(hook);
    let t = 0, spin = 0;
    g.userData = {
      wheels, beacon: beaconM, hook,
      update(dt, speed = 0) {
        t += dt; spin += speed * dt / 0.48;
        for (const w of wheels) w.rotation.x = spin;
        const on = Math.sin(t * 9) > 0;
        beaconM.material.color.set(on ? '#ffd45c' : '#ff6b2c'); beaconM.scale.setScalar(on ? 1.15 : 1);
      },
    };
    return g;
  };

  // ---------- placing the model ----------
  const _v = new THREE.Vector3();
  function rearPose() {
    const f = fwdOf(h), r = fwdOf(hr);
    const hx = fx - f.x * HITCH, hz = fz - f.z * HITCH;
    return { hx, hz, rx: hx - r.x * R_CTR, rz: hz - r.z * R_CTR, ax: hx - r.x * R_AXLE, az: hz - r.z * R_AXLE };
  }
  function placeModel() {
    const rp = rearPose();
    B.front.position.set(fx, gy, fz); B.front.rotation.y = h;
    B.rear.position.set(rp.rx, gy, rp.rz); B.rear.rotation.y = hr;
    jointF.position.set(rp.hx, gy, rp.hz); jointF.rotation.y = h;
    jointR.position.set(rp.hx, gy, rp.hz); jointR.rotation.y = hr;
    // a little wobble after a bump
    if (wobble > 0) { const w = Math.sin(clock * 30) * wobble * 0.05; B.front.rotation.z = w; B.rear.rotation.z = -w * 0.7; }
    else { B.front.rotation.z = 0; B.rear.rotation.z = 0; }
    B.pos.copy(B.front.position); B.heading = h;
  }

  // ---------- roads: nearest point, route along the graph, left-lane polyline ----------
  // Nearest point on the road graph to (x,z): {edge, s (from the edge's a end), x, z, dx, dz (a->b), d}.
  function nearestRoad(x, z) {
    let best = null;
    for (const e of W().roads.edges) {
      const p = e.points;
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], c = p[i], dx = c.x - a.x, dz = c.z - a.z, l2 = dx * dx + dz * dz || 1;
        const t = BB.clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
        const qx = a.x + dx * t, qz = a.z + dz * t, d = Math.hypot(qx - x, qz - z);
        if (!best || d < best.d) { const l = Math.sqrt(l2); best = { edge: e, s: e.cum[i - 1] + t * l, x: qx, z: qz, dx: dx / l, dz: dz / l, d }; }
      }
    }
    return best;
  }
  B.nearestRoad = nearestRoad;
  // Centre-line polyline from the road point nearest the bus to the target's parking spot, approaching in the stop's
  // travel direction. Returns {pts, sign} or null.
  function routeTo(stop) {
    const here = nearestRoad(fx, fz);
    if (!here) return null;
    const te = W().edge(stop.edge), entry = stop.dir > 0 ? te.a : te.b;
    const tAlong = stop.dir > 0 ? stop.s + 3 : te.length - stop.s + 3;   // distance from the entry node to the nose spot
    const e = here.edge;
    const pts = [{ x: here.x, z: here.z }];
    // already on the target's edge, behind the stop in its direction: straight there
    const along = stop.dir > 0 ? here.s : e.length - here.s;
    if (e === te && along < tAlong - 1) {
      const s1 = stop.dir > 0 ? stop.s + 3 : stop.s - 3;
      addEdgePart(pts, te, here.s, s1);
      return pts;
    }
    // Dijkstra over directed states (an edge driven one way, ending at its far junction). Turning round costs extra
    // (at the start if the bus faces the other way, and as a U-turn at a junction), so the ribbon prefers to carry
    // on the way the bus faces unless going round would be much longer.
    const f = fwdOf(h), facing = f.x * here.dx + f.z * here.dz, TURN = 300, UTURN = 400;   // turning round is hard in a bendy bus: go round the block instead
    const key = (ed, d) => ed.id + (d > 0 ? '+' : '-'), endOf = (ed, d) => d > 0 ? ed.b : ed.a;
    const dist = {}, prev = {}, open = [];
    const seed = (d, c) => { const k = key(e, d); dist[k] = c; prev[k] = null; open.push({ ed: e, d, k }); };
    seed(1, e.length - here.s + (facing < -0.3 ? TURN : 0));
    seed(-1, here.s + (facing > 0.3 ? TURN : 0));
    let best = null, bestC = Infinity;
    while (open.length) {
      open.sort((a, b) => dist[a.k] - dist[b.k]);
      const it = open.shift(), c0 = dist[it.k];
      if (c0 >= bestC) break;
      const n = endOf(it.ed, it.d);
      if (n === entry) {                                  // carry on onto the target's edge
        const c = c0 + tAlong + (it.ed === te ? UTURN : 0);
        if (c < bestC) { bestC = c; best = it; }
      }
      for (const eid of W().node(n).edges) {
        const e2 = W().edge(eid), d2 = e2.a === n ? 1 : -1, k2 = key(e2, d2);
        const c = c0 + e2.length + (e2 === it.ed ? UTURN : 0);
        if (dist[k2] == null || c < dist[k2]) { dist[k2] = c; prev[k2] = it; open.push({ ed: e2, d: d2, k: k2 }); }
      }
    }
    if (!best) return null;
    const chain = []; for (let s = best; s; s = prev[s.k]) chain.unshift(s);
    // the first state is the bus's own edge, driven from the bus to its end
    addEdgePart(pts, e, here.s, chain[0].d > 0 ? e.length : 0);
    for (let k = 1; k < chain.length; k++) { const s = chain[k]; addEdgePart(pts, s.ed, s.d > 0 ? 0 : s.ed.length, s.d > 0 ? s.ed.length : 0); }
    addEdgePart(pts, te, stop.dir > 0 ? 0 : te.length, stop.dir > 0 ? stop.s + 3 : stop.s - 3);
    return pts;
  }
  function addEdgePart(out, e, s0, s1) {
    const push = (p) => { const q = out[out.length - 1]; if (!q || Math.hypot(q.x - p.x, q.z - p.z) > 0.05) out.push({ x: p.x, z: p.z }); };
    push(W().pointAt(e, s0));
    if (s1 > s0) { for (let i = 1; i < e.points.length - 1; i++) if (e.cum[i] > s0 && e.cum[i] < s1) push(e.points[i]); }
    else { for (let i = e.points.length - 2; i > 0; i--) if (e.cum[i] < s0 && e.cum[i] > s1) push(e.points[i]); }
    push(W().pointAt(e, s1));
  }
  // Round sharp corners (junction turns) with a short curve, then move the line into the LEFT lane. A U-turn splits
  // the line: each piece goes into its own left lane and a half circle joins them.
  function leftLane(pts) {
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], p = pts[i], c = pts[i + 1];
      const ix = p.x - a.x, iz = p.z - a.z, ox = c.x - p.x, oz = c.z - p.z, li = Math.hypot(ix, iz), lo = Math.hypot(ox, oz);
      if (li > 1e-3 && lo > 1e-3 && (ix * ox + iz * oz) / (li * lo) < -0.9) {
        const A = leftLane(pts.slice(0, i + 1)), Bq = leftLane(pts.slice(i));
        const ux = ix / li, uz = iz / li, lx = uz, lz = -ux, r = C.lane, arc = [];
        for (let k = 1; k < 8; k++) { const t2 = k / 8 * Math.PI; arc.push({ x: p.x + lx * r * Math.cos(t2) + ux * r * Math.sin(t2), z: p.z + lz * r * Math.cos(t2) + uz * r * Math.sin(t2) }); }
        return A.concat(arc, Bq);
      }
    }
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], p = pts[i], c = pts[i + 1];
      let ix = p.x - a.x, iz = p.z - a.z, ox = c.x - p.x, oz = c.z - p.z;
      const li = Math.hypot(ix, iz), lo = Math.hypot(ox, oz);
      if (li < 1e-3 || lo < 1e-3) continue;
      ix /= li; iz /= li; ox /= lo; oz /= lo;
      if (ix * ox + iz * oz > 0.97) { out.push(p); continue; }
      const r = Math.min(6, li / 2, lo / 2);
      const A = { x: p.x - ix * r, z: p.z - iz * r }, Bp = { x: p.x + ox * r, z: p.z + oz * r };
      for (let k = 0; k <= 6; k++) { const t = k / 6, m = 1 - t; out.push({ x: m * m * A.x + 2 * m * t * p.x + t * t * Bp.x, z: m * m * A.z + 2 * m * t * p.z + t * t * Bp.z }); }
    }
    out.push(pts[pts.length - 1]);
    return W().offsetLine(out, C.lane + 0.25);           // a touch away from the centre line (and the viaduct piers)
  }

  // ---------- camera ----------
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let orbit = 0.6, camH = 0;
  function midPoint() { const r = B.rear.position; return { x: (fx + r.x) / 2, z: (fz + r.z) / 2 }; }
  const _w1 = new THREE.Vector3(), _w2 = new THREE.Vector3();
  // Move the wanted camera toward the bus (and a little up) until no building stands in the way.
  function clearSight(m, maxUp) {
    for (let k = 0; k < 5; k++) {
      if (!W().blocksSight(camPos.x, camPos.y, camPos.z, m.x, 2.2, m.z)) return;
      camPos.x = m.x + (camPos.x - m.x) * 0.8; camPos.z = m.z + (camPos.z - m.z) * 0.8;
      camPos.y = Math.min(maxUp, camPos.y + 1.5);
    }
  }
  // Under the MRT viaduct the camera stays below its deck.
  function underViaduct(x, z) { const v = W().viaduct; return v && x > v.x0 && x < v.x1 && Math.abs(z - v.z) < 9; }
  function desiredCamera(dt) {
    const mode = B.camMode;
    const m = midPoint(), mx = m.x, mz = m.z;
    let maxUp = 30;
    if (mode === 'title') {
      // swing gently on the road side of the bus (never through the buildings beside it)
      orbit += dt * 0.25;
      const kx = Math.cos(h), kz = -Math.sin(h), f = fwdOf(h);
      const a = 0.75 + Math.sin(orbit) * 0.35;
      camPos.set(mx + (f.x * Math.cos(a) - kx * Math.sin(a)) * 21, 8 + Math.sin(orbit * 0.7), mz + (f.z * Math.cos(a) - kz * Math.sin(a)) * 21);
      camLook.set(mx, 1.6, mz);
    } else if (mode === 'depot' || mode === 'depotClose') {
      // the garage: depot.js may turn the bus on a turntable, so frame it from its real (world) position
      B.front.getWorldPosition(_w1); B.rear.getWorldPosition(_w2);
      const wx = (_w1.x + _w2.x) / 2, wz = (_w1.z + _w2.z) / 2;
      if (mode === 'depot') {
        // from the road side, looking at the bus's door side, with the whole bus left of the depot panel
        const hh = h + wrapA(hr - h) / 2, kx = Math.cos(hh), kz = -Math.sin(hh);
        const d = 21, cam = BB.camera, vis = 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect;
        const panel = Math.min(440, innerWidth * 0.52) / Math.max(1, innerWidth);
        const sh = vis * panel / 2;
        camPos.set(wx - kx * d - kz * sh, 8, wz - kz * d + kx * sh);
        camLook.set(wx - kz * sh, 1.6, wz + kx * sh);
      } else {
        // close on the front and the roof (to show off a new hat), from ahead on the road side
        const fw = B.front.localToWorld(_w2.set(0, 0, LF / 2)).clone(), c = _w1;
        let dx = fw.x - c.x, dz = fw.z - c.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const kx = dz, kz = -dx;                          // the bus's left (door side)
        const cam = BB.camera, panel = Math.min(440, innerWidth * 0.52) / Math.max(1, innerWidth), sh = 9 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect * panel;
        camPos.set(fw.x + dx * 7.5 - kx * 4.5, 6.2, fw.z + dz * 7.5 - kz * 4.5);
        camLook.set(fw.x - dx * 1.8, 2.4, fw.z - dz * 1.8);
        let vx = camLook.x - camPos.x, vz = camLook.z - camPos.z; const vl = Math.hypot(vx, vz) || 1; vx /= vl; vz /= vl;
        camPos.x -= vz * sh; camPos.z += vx * sh; camLook.x -= vz * sh; camLook.z += vx * sh;   // bus left of the panel
      }
    } else if (B.atStop || settle) {
      // at a stop: from the road side, a little ahead, fairly low: the windows (seats), the door and the shelter
      const kx = Math.cos(h), kz = -Math.sin(h), f = fwdOf(h);
      camPos.set(fx + f.x * 6 - kx * 13.5, 8.5, fz + f.z * 6 - kz * 13.5);
      camLook.set(fx - f.x * 2 + kx * 1.2, 1.0, fz - f.z * 2 + kz * 1.2);
      // phones held sideways: the question card is a column on the left, so frame the bus toward the right
      if (innerHeight <= 500 && BB.jobs && BB.jobs.phase === 'question') {
        let dx = camLook.x - camPos.x, dz = camLook.z - camPos.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const sh = 6.5;                                   // move the camera to its left: the scene slides right
        camPos.x += dz * sh; camPos.z -= dx * sh; camLook.x += dz * sh; camLook.z -= dx * sh;
      }
    } else {
      // chase: behind and above the front carriage, trailing its heading smoothly
      camH += wrapA(h - camH) * Math.min(1, dt * 2.2);
      const wide = BB.camera.aspect > 1.9, f = fwdOf(camH);
      let back = (wide ? 19 : 17) + Math.max(0, B.speed) * 0.25;
      let up = wide ? 12.5 : 11.5;
      // pull in a little if the camera would be inside a building
      for (let k = 0; k < 4; k++) {
        const px = fx - f.x * back, pz = fz - f.z * back, q = W().pushOut(px, pz, 1.5);
        if (q.hit < 0.01) break;
        back *= 0.78;
      }
      camPos.set(fx - f.x * back, up, fz - f.z * back);
      camLook.set(fx + f.x * (wide ? 2 : 5), 0, fz + f.z * (wide ? 2 : 5));
    }
    if (underViaduct(camPos.x, camPos.z) || underViaduct(mx, mz)) maxUp = 10.2;
    camPos.y = Math.min(camPos.y, maxUp);
    clearSight(m, maxUp);
  }
  function snapCamera() { camH = h; desiredCamera(0); BB.camera.position.copy(camPos); curLook.copy(camLook); BB.camera.lookAt(curLook); }
  const curLook = new THREE.Vector3();
  // Smooth the camera in polar coordinates round the bus (angle, distance, height), so a change of view swings
  // round the bus instead of cutting through it.
  function updateCamera(dt) {
    desiredCamera(dt);
    const chase = B.camMode === 'chase' && !B.atStop && !settle;
    const k = 1 - Math.exp(-(chase ? 3.0 : 1.6) * dt);
    const m = midPoint(), cp = BB.camera.position;
    const a0 = Math.atan2(cp.x - m.x, cp.z - m.z), a1 = Math.atan2(camPos.x - m.x, camPos.z - m.z);
    const r0 = Math.hypot(cp.x - m.x, cp.z - m.z), r1 = Math.hypot(camPos.x - m.x, camPos.z - m.z);
    const a = a0 + wrapA(a1 - a0) * k;
    let r = r0 + (r1 - r0) * k;
    if (Math.abs(wrapA(a1 - a0)) > 0.3) r = Math.max(r, Math.min(r0, r1, 13));   // keep clear of the bus while swinging
    let ny = cp.y + (camPos.y - cp.y) * k;
    if (camPos.y <= 10.2 && (underViaduct(m.x + Math.sin(a) * r, m.z + Math.cos(a) * r) || underViaduct(m.x, m.z))) ny = Math.min(ny, 10.2);
    cp.set(m.x + Math.sin(a) * r, ny, m.z + Math.cos(a) * r);
    curLook.lerp(camLook, Math.min(1, k * 1.4));
    BB.camera.lookAt(curLook);
  }
  B.setCamera = function (mode, snap) { B.camMode = mode; if (snap) snapCamera(); };

  // ---------- guidance: ribbon (left lane), target marker, glowing bay, way arrow ----------
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
    b.add(new THREE.ConeGeometry(1.4, 2.8, 6), P.honey, 0, 0, 0, 0, Math.PI);
    b.add(new THREE.TorusGeometry(1.5, 0.28, 4, 12), P.honeyLight, 0, 2.0, 0, 0, Math.PI / 2);
    beacon = new THREE.Mesh(b.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    beacon.scale.setScalar(0.55);
    beacon.name = 'beacon'; beacon.visible = false;
    BB.scene.add(beacon);
  }
  function buildBayGlow() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(0, 0, 64, 256);
    x.strokeStyle = 'rgba(255,255,255,1)'; x.lineWidth = 9; x.lineJoin = 'round';
    x.beginPath(); x.roundRect ? x.roundRect(6, 6, 52, 244, 14) : x.rect(6, 6, 52, 244); x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.7)';
    for (let y = 40; y < 230; y += 46) { x.beginPath(); x.moveTo(16, y + 14); x.lineTo(32, y); x.lineTo(48, y + 14); x.lineTo(48, y + 24); x.lineTo(32, y + 10); x.lineTo(16, y + 24); x.closePath(); x.fill(); }
    bayTex = new THREE.CanvasTexture(c);
    bayGlow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 16.4), new THREE.MeshBasicMaterial({ map: bayTex, color: P.honeyLight, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3 }));
    bayGlow.rotation.order = 'YXZ'; bayGlow.renderOrder = 2; bayGlow.visible = false; bayGlow.name = 'bayGlow';
    BB.scene.add(bayGlow);
  }
  function buildWayArrow() {
    const s = new THREE.Shape();
    s.moveTo(0, 1.6); s.lineTo(1.3, 0.1); s.lineTo(0.5, 0.1); s.lineTo(0.5, -1.2); s.lineTo(-0.5, -1.2); s.lineTo(-0.5, 0.1); s.lineTo(-1.3, 0.1); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false }); g.rotateX(Math.PI / 2);
    wayArrow = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: P.honey }));
    wayArrow.visible = false; wayArrow.name = 'wayArrow';
    BB.scene.add(wayArrow);
  }
  let routePts = null;                    // the current left-lane route polyline (for the arrow and the lane tip)
  function refreshRibbon() {
    ribbonTimer = 0.35;
    if (!ribbon) return;
    if (!B.target || B.atStop === B.target || settle) { ribbon.geometry.setDrawRange(0, 0); routePts = null; B.route = []; return; }
    const c = routeTo(B.target);
    if (!c || c.length < 2) { ribbon.geometry.setDrawRange(0, 0); routePts = null; return; }
    const pts = leftLane(c);
    routePts = pts; B.route = pts;
    const pos = ribbon.geometry.attributes.position.array, uv = ribbon.geometry.attributes.uv.array;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const total = Math.min(cum[cum.length - 1], 300);
    let n = 0, i = 1;
    const step = 1.2, w = 1.0;
    for (let s = 0; s <= total && n < RIB_MAX; s += step) {
      while (i < pts.length - 1 && cum[i] < s) i++;
      const a = pts[i - 1], b = pts[i], l = (cum[i] - cum[i - 1]) || 1, t = BB.clamp((s - cum[i - 1]) / l, 0, 1);
      const dx = (b.x - a.x) / l, dz = (b.z - a.z) / l, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const lx = dz * w, lz = -dx * w;
      pos[n * 6] = x + lx; pos[n * 6 + 1] = 0.09; pos[n * 6 + 2] = z + lz;
      pos[n * 6 + 3] = x - lx; pos[n * 6 + 4] = 0.09; pos[n * 6 + 5] = z - lz;
      uv[n * 4] = 0; uv[n * 4 + 1] = -s / 2.2; uv[n * 4 + 2] = 1; uv[n * 4 + 3] = -s / 2.2;
      n++;
    }
    ribbon.geometry.attributes.position.needsUpdate = true; ribbon.geometry.attributes.uv.needsUpdate = true;
    ribbon.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
  }
  B.refreshRibbon = refreshRibbon;

  // ---------- driving ----------
  const circles = [];
  function busCircles() {
    const f = fwdOf(h), rp = rearPose(), r = fwdOf(hr);
    circles.length = 0;
    circles.push([fx + f.x * 2.5, fz + f.z * 2.5], [fx + f.x * 0.1, fz + f.z * 0.1], [fx - f.x * 2.3, fz - f.z * 2.3], [rp.rx + r.x * 1.9, rp.rz + r.z * 1.9], [rp.rx, rp.rz], [rp.rx - r.x * 1.9, rp.rz - r.z * 1.9]);
    return circles;
  }
  // Push the whole bus out of anything it overlaps; returns the push vector length and direction.
  function collide() {
    let tx = 0, tz = 0;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const c of busCircles()) {
        const q = W().pushOut(c[0], c[1], 1.3);
        if (q.hit > 0.001) { const dx = q.x - c[0], dz = q.z - c[1]; fx += dx; fz += dz; tx += dx; tz += dz; moved = true; }
      }
      if (!moved) break;
    }
    return { x: tx, z: tz, d: Math.hypot(tx, tz) };
  }
  function drive(dt) {
    const inp = B.input, canDrive = !B.atStop && !B.doorsOpen && !B.noFuel && !B.locked && B.camMode === 'chase' && !settle;
    const fwd = canDrive && (inp.fwd || B.going), back = canDrive && inp.back && !fwd;
    let left = canDrive && inp.left, right = canDrive && inp.right;
    // speed: ease toward the wanted speed; braking when the pedal points the other way
    let want = fwd ? MAX_FWD : back ? -MAX_BACK : 0;
    let cap = approachCap();
    if (cap < Infinity) want = BB.clamp(want, -cap, cap); else cap = 0;   // ease off coming into the target bay so it can settle
    const slowing = Math.abs(want) < Math.abs(B.speed) || (Math.sign(want) !== Math.sign(B.speed) && Math.abs(B.speed) > 0.2);
    const rate = !slowing ? ACCEL : (want === 0 && !cap) ? COAST : BRAKE;
    if (B.speed < want) B.speed = Math.min(want, B.speed + rate * dt); else B.speed = Math.max(want, B.speed - rate * dt);
    if (!canDrive) B.speed = settle ? 0 : B.speed * Math.max(0, 1 - dt * 6);
    if (Math.abs(B.speed) < 0.01) B.speed = 0;
    // steering: turns toward the wheel's way while held, straightens itself when let go
    const ms = MAX_STEER + 0.22 * (1 - Math.min(1, Math.abs(B.speed) / 4));   // tighter when slow: easier to turn round
    const st = left && !right ? ms : right && !left ? -ms : 0;
    if (st) B.steer += BB.clamp(st - B.steer, -STEER_IN * dt, STEER_IN * dt);
    else B.steer += BB.clamp(-B.steer, -STEER_OUT * dt, STEER_OUT * dt);
    const v = B.speed, ds = v * dt;
    // bicycle model on the front carriage (reference: its rear axle)
    const before = rearPose();
    const f0 = fwdOf(h);
    let ax = fx - f0.x * AX, az = fz - f0.z * AX;
    h = wrapA(h + ds * Math.tan(B.steer) / WB);
    const f1 = fwdOf(h);
    ax += f1.x * ds; az += f1.z * ds;
    fx = ax + f1.x * AX; fz = az + f1.z * AX;
    // the rear carriage follows the hitch like a trailer (and is kept from folding too far)
    const hx = fx - f1.x * HITCH, hz = fz - f1.z * HITCH;
    const dx = hx - before.ax, dz = hz - before.az;
    if (Math.hypot(dx, dz) > 1e-4) hr = Math.atan2(dx, dz);
    if (v < 0) hr += wrapA(h - hr) * Math.min(1, -ds * 0.18);  // reversing: a helping hand keeps it straight
    const bend = wrapA(hr - h);
    if (Math.abs(bend) > MAX_BEND) hr = wrapA(h + Math.sign(bend) * MAX_BEND);
    // never crash: slide along walls, trees and posts
    const push = collide();
    if (push.d > 0.01) {
      const nx = push.x / push.d, nz = push.z / push.d, mv = Math.sign(v) || 1;
      const head = -(nx * f1.x + nz * f1.z) * mv;          // > 0 when driving into it
      if (head > 0.35) { const v0 = Math.abs(B.speed), v1 = Math.max(Math.min(v0, 1.5), v0 * Math.max(0.3, 1 - head * 0.9 * Math.min(1, push.d * 6))); B.speed = Math.sign(B.speed) * v1; }   // keeps a crawl, so it slides along
      if (bumpCool <= 0 && Math.abs(v) > 1.2 && head > 0.3) { bumpCool = 0.8; wobble = 1; BB.emit('bus:bump', { strength: Math.min(1, Math.abs(v) / MAX_FWD) }); }
    }
    return Math.abs(ds);
  }
  // Coming into the target bay (lined up within 45 degrees, either way round): a speed limit that eases to a crawl
  // by the middle of the bay, so the bus can't overshoot it.
  function approachCap() {
    const t = B.target;
    if (!t || B.atStop) return Infinity;
    const bay = W().bayOf(t), m = midPoint(), dx = m.x - bay.x, dz = m.z - bay.z;
    const lat = dx * bay.side.x + dz * bay.side.z;
    if (Math.abs(lat) > 4.8) return Infinity;
    const dh = Math.abs(wrapA(h - bay.heading));
    if (dh > Math.PI / 4 && dh < Math.PI * 3 / 4) return Infinity;
    const f = fwdOf(h), mv = Math.sign(B.speed) || 1;
    const m2 = Math.sign((f.x * bay.fwd.x + f.z * bay.fwd.z) * mv) || 1;
    const prog = (dx * bay.fwd.x + dz * bay.fwd.z) * m2;
    if (prog < -26 || prog > 7) return Infinity;
    return 1.6 + Math.sqrt(10 * Math.max(0, 2 - prog));
  }
  // Is the bus roughly in the target bay? (mid point within the box, heading within 45 degrees either way round)
  function bayCheck() {
    const t = B.target;
    if (!t || B.atStop) return false;
    const bay = W().bayOf(t), m = midPoint();
    const dx = m.x - bay.x, dz = m.z - bay.z;
    const along = dx * bay.fwd.x + dz * bay.fwd.z, lat = dx * bay.side.x + dz * bay.side.z;
    const dh = Math.abs(wrapA(h - bay.heading));
    if (Math.abs(along) > 6 || Math.abs(lat) > 4.8) return false;
    if (dh < Math.PI / 4) return 'same';
    if (dh > Math.PI * 3 / 4) return 'reversed';
    return false;
  }
  function updateSettle(dt) {
    if (!settle) {
      const which = bayCheck();
      if (which && Math.abs(B.speed) < 2.0) {
        settle = { from: { fx, fz, h, hr }, to: poseAtBay(B.target, which === 'reversed'), t: 0, stop: B.target };
        B.speed = 0; ribbon.geometry.setDrawRange(0, 0);
      }
      return;
    }
    settle.t = Math.min(1, settle.t + dt / 0.9);
    const k = BB.smooth(settle.t), a = settle.from, b = settle.to;
    fx = a.fx + (b.fx - a.fx) * k; fz = a.fz + (b.fz - a.fz) * k;
    h = wrapA(a.h + wrapA(b.h - a.h) * k); hr = wrapA(a.hr + wrapA(b.hr - a.hr) * k);
    B.steer *= 0.9;
    if (settle.t >= 1) {
      const stop = settle.stop; settle = null;
      B.target = null; B.atStop = stop;
      refreshRibbon();
      BB.emit('bus:arrived', { stop });
      const cb = B.onArrive; B.onArrive = null;
      if (cb) cb(stop);
    }
  }
  // Keep left! Track how long the bus has been driving along a road in its right-hand lane.
  function laneCheck(dt) {
    const near = nearestRoad(fx, fz);
    if (near) {
      B.edge = near.edge.id; B.t = near.s / near.edge.length;
      const f = fwdOf(h), dot = f.x * near.dx + f.z * near.dz;
      B.dir = dot >= 0 ? 1 : -1;
      if (near.d < C.roadHalf && Math.abs(dot) > 0.8 && B.speed > 3) {
        const tx = near.dx * B.dir, tz = near.dz * B.dir, lat = (fx - near.x) * tz + (fz - near.z) * -tx;   // + = left of travel
        if (lat < -0.6) wrongLaneT += dt; else wrongLaneT = Math.max(0, wrongLaneT - dt * 2);
      } else wrongLaneT = Math.max(0, wrongLaneT - dt);
    }
    B.wrongLane = wrongLaneT > 1;
    const ph = BB.jobs && BB.jobs.phase;
    if (wrongLaneT > 5 && clock - lastTip > 40 && ph !== 'question' && ph !== 'stop' && !BB.bedtime) {
      lastTip = clock; wrongLaneT = 0;
      BB.emit('bus:wrongLane', {});
      BB.say('In Singapore we drive on the left!', { queue: true });
    }
  }

  // ---------- per frame ----------
  B.update = function (dt) {
    if (!B.front) return;
    clock += dt; bumpCool -= dt; wobble = Math.max(0, wobble - dt * 2.5); hornT -= dt;
    let ds = 0;
    if (spin) updateSpin(dt); else { ds = settle ? 0 : drive(dt); updateSettle(dt); }
    gy += (W().groundY(fx, fz) - gy) * Math.min(1, dt * 8);
    placeModel();
    if (spinHop) { B.front.position.y += spinHop; B.rear.position.y += spinHop; jointF.position.y += spinHop; jointR.position.y += spinHop; }
    laneCheck(dt);

    // fuel
    if (ds > 0 && !B.noFuel) {
      B.fuel = Math.max(0, B.fuel - ds * C.fuelPerUnit);
      if (!lowWarned && B.fuel <= C.fuelLow) { lowWarned = true; BB.emit('bus:fuelLow', { fuel: B.fuel }); }
      if (B.fuel <= 0) { B.noFuel = true; B.speed = 0; BB.emit('bus:fuelEmpty', {}); }
      saveTimer -= dt;
      if (saveTimer <= 0) { saveTimer = 4; BB.save.fuel = B.fuel; BB.saveNow(); }
    }

    // wheels, doors, passengers, face
    wheelAngle += (B.speed * dt) / 0.52;
    for (const w of wheelsF) w.rotation.x = wheelAngle;
    for (const w of wheelsR) w.rotation.x = wheelAngle;
    for (const w of steerWheels) w.rotation.y = B.steer * 0.8;
    doorT += ((B.doorsOpen ? 1 : 0) - doorT) * Math.min(1, dt * 6);
    for (const d of [doorF, doorR]) { d.position.x = 1.27 + doorT * 0.1; d.position.z = d.userData.z + doorT * 1.1; }
    const n = BB.clamp(B.passengers | 0, 0, 10);
    if (heads.count !== n) heads.count = hair.count = shirts.count = n;
    B.paxGroup.position.y = Math.abs(B.speed) > 0.5 ? Math.abs(Math.sin(clock * 9)) * 0.04 : 0;
    blinkT -= dt;
    let open = 1;
    if (B.sleepy) open = 0.1;
    else if (blinkT < 0) { open = Math.min(1, Math.abs(blinkT + 0.08) / 0.08); if (blinkT < -0.16) blinkT = 2.5 + Math.random() * 3; }
    if (hornT > 0) open = 1.15;
    eyesF.scale.y += (open - eyesF.scale.y) * Math.min(1, dt * (B.sleepy ? 3 : 30));
    pupils.visible = !B.sleepy;
    pupils.position.x += (B.steer * 0.25 - pupils.position.x) * Math.min(1, dt * 8);

    // lights: on at dusk and night (and brighter with the upgrade); off for the goodnight moment
    const night = W().night ? W().night() : 0, up = !!(BB.save.upgrades && BB.save.upgrades.lights);
    const lit = B.lightsOn ? Math.max(night, up ? 1 : 0) : 0;
    lightCones.visible = lit > 0.05;
    lightCones.material.opacity = 0.22 * lit * (up ? 1.2 : 0.8);
    lampMat.color.setScalar(B.lightsOn ? 1 : 0.45);
    glassMat.emissive.set('#ffd98a').multiplyScalar(0.35 * night * (B.lightsOn ? 1 : 0.2));

    // guidance: ribbon flow, the target marker and bay glow, the way arrow
    ribbonTex.offset.y -= dt * 1.1;
    ribbonTimer -= dt;
    if (ribbonTimer <= 0 && !settle) refreshRibbon();
    const t = B.target;
    if (t && !settle) {
      const bay = W().bayOf(t);
      beacon.visible = true;
      beacon.position.set(bay.x, 5.6 + Math.abs(Math.sin(clock * 3)) * 0.7, bay.z);
      const dB = Math.hypot(bay.x - fx, bay.z - fz);
      beacon.material.opacity = BB.clamp((dB - 12) / 22, 0.12, 0.9);
      beacon.rotation.y = clock * 1.5;
      bayGlow.visible = true;
      bayGlow.position.set(bay.x, 0.1, bay.z); bayGlow.rotation.set(-Math.PI / 2, bay.heading + Math.PI, 0);
      bayGlow.material.color.set(t.id === 'depot' ? '#5fe0d0' : P.honeyLight);
      bayGlow.material.opacity = 0.55 + 0.35 * Math.sin(clock * 4);
    } else { beacon.visible = false; bayGlow.visible = false; }
    updateWayArrow();

    BB.sfx.engine(B.camMode === 'chase' ? Math.abs(B.speed) / MAX_FWD : 0);
    updateCamera(dt);
  };
  // A small arrow over the bus pointing the way, when it is off the route or facing away from it.
  function updateWayArrow() {
    if (!routePts || !B.target || B.atStop || settle || spin || B.camMode !== 'chase') {
      wayArrow.visible = false;
      if (facingAway && !spin) { facingAway = false; awayT = 0; BB.emit('bus:facingAway', { on: false }); }
      return;
    }
    // the route point ~12 ahead of the point nearest the bus
    let bi = 0, bd = Infinity;
    // (the route starts at the road point nearest the bus, so only look near its start: a U-turn's way back may pass close by)
    for (let i = 0, acc = 0; i < routePts.length && acc < 16; i++) {
      if (i) acc += Math.hypot(routePts[i].x - routePts[i - 1].x, routePts[i].z - routePts[i - 1].z);
      const d = Math.hypot(routePts[i].x - fx, routePts[i].z - fz); if (d < bd) { bd = d; bi = i; }
    }
    let j = bi, acc = 0;
    while (j < routePts.length - 1 && acc < 12) { acc += Math.hypot(routePts[j + 1].x - routePts[j].x, routePts[j + 1].z - routePts[j].z); j++; }
    const tx = routePts[j].x - fx, tz = routePts[j].z - fz, ang = Math.atan2(tx, tz);
    const away = Math.abs(wrapA(ang - h));
    const off = bd > 7 || away > 1.6;
    wayArrow.visible = off;
    // facing away from the way (and on the route's road): offer the turn-round button
    if (!facingAway && away > 2.0 && bd < 10 && !spin) { awayT += 1 / 30; if (awayT > 0.7) { facingAway = true; BB.emit('bus:facingAway', { on: true }); } }
    else if (facingAway && (away < 1.5 || bd >= 12)) { facingAway = false; awayT = 0; BB.emit('bus:facingAway', { on: false }); }
    else if (!facingAway) awayT = 0;
    if (off) {
      const f = fwdOf(h);
      wayArrow.position.set(fx + f.x * 1.5, 5.2 + gy + Math.abs(Math.sin(clock * 4)) * 0.4, fz + f.z * 1.5);
      wayArrow.rotation.y = ang;
    }
  }
  B.updateCamera = updateCamera;

  B.build = function () {
    buildModel();
    B.placeAt(BB.world.depot);
    B.atStop = null;                      // parked, not "at a stop" (doors shut)
    B.fuel = BB.save.fuel; B.noFuel = B.fuel <= 0;
  };
})();
