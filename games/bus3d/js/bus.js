/* Bendy Bus 3D: the bus.
   An articulated (bendy) bus that reads as a real bus (no face: the owner's choice): a front carriage,
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

  // Geometry of the current bus type (install() sets these from the model): front carriage, rear carriage, joint gap
  // lengths; axle distances (from the nose / from the rear carriage's front); ART = articulated (has a rear carriage).
  let LF = 7.4, LR = 6.0, GAP = 1.0, ART = true;
  let FRONT_AXLE = 1.3, MID_AXLE = 5.6, REAR_AXLE = 4.2;
  let WB = MID_AXLE - FRONT_AXLE;        // wheelbase of the front carriage
  let AX = MID_AXLE - LF / 2;            // front carriage centre -> its rear axle
  let HITCH = LF / 2 + GAP / 2;          // front carriage centre -> hitch
  let R_AXLE = GAP / 2 + REAR_AXLE, R_CTR = GAP / 2 + LR / 2;   // hitch -> rear axle / rear carriage centre
  const totalLen = () => LF + GAP + LR, frontOff = () => totalLen() / 2 - LF / 2;   // front centre ahead of the middle
  let MAX_FWD = 9, ACCEL = 4.2;                      // (per vehicle: see VEHICLE)
  const MAX_BACK = 4, BRAKE = 9, COAST = 5;
  // Cruising: on the long straight outer roads and the expressway, lined up with the road and well away from the next
  // junction or curve, the top speed eases up to MAX_CRUISE (the big map's long legs go quicker), and eases back down
  // (gently, CRUISE_DOWN) before the end of the straight.
  let MAX_CRUISE = 14, MAX_STEER = 0.55;
  const CRUISE_DOWN = 3.4, STEER_IN = 2.2, STEER_OUT = 3.0, MAX_BEND = 55 * Math.PI / 180;
  // How each vehicle drives: top speed, cruising speed on the open road, pick-up, steering lock. The buses share the
  // first line; the taxi is nimble, the fire engine and the ice cream van steady. (Turning circles follow from each
  // model's wheelbase.)
  const VEHICLE = {
    bus: { top: 9, cruise: 14, accel: 4.2, steer: 0.55 },
    taxi: { top: 10.5, cruise: 15, accel: 5.6, steer: 0.62 },
    ambulance: { top: 10, cruise: 15, accel: 5.0, steer: 0.58 },
    fire: { top: 8.8, cruise: 13, accel: 4.2, steer: 0.56 },
    icecream: { top: 8.2, cruise: 12, accel: 4.0, steer: 0.6 },
    tow: { top: 9, cruise: 13.5, accel: 4.4, steer: 0.58 },
  };
  const W = () => BB.world;
  const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  // ---------- state: the front carriage centre (fx,fz), its heading h, the rear carriage's heading hr ----------
  let fx = 0, fz = 0, h = 0, hr = 0, gy = 0;
  let settle = null;                    // {from:{fx,fz,h,hr}, to:{...}, t, stop}
  let wheelAngle = 0, doorT = 0, ribbonTimer = 0, saveTimer = 0, lowWarned = false, bumpCool = 0, wobble = 0;
  let wrongLaneT = 0, lastTip = -99, clock = 0;
  const fwdOf = (a) => ({ x: Math.sin(a), z: Math.cos(a) });

  // ---------- public: placing, targets, doors, controls ----------
  function poseAtBay(stop, reversed) {
    const bay = W().bayOf(stop);
    const hh = reversed ? wrapA(bay.heading + Math.PI) : bay.heading, f = fwdOf(hh);
    // the whole bus (front centre .. rear centre) sits centred on the bay
    const cx = bay.x + f.x * frontOff(), cz = bay.z + f.z * frontOff();
    return { fx: cx, fz: cz, h: hh, hr: hh };
  }
  // Park the bus at a stop or the depot (used at start, after a tow).
  B.placeAt = function (stop) {
    B.inWorkshop = false;
    const p = poseAtBay(stop, false);
    fx = p.fx; fz = p.fz; h = p.h; hr = p.hr;
    B.speed = 0; B.steer = 0; settle = null;
    B.atStop = stop; B.target = null; B.onArrive = null;
    placeModel(); snapCamera(); snapWall();
    refreshRibbon();
  };
  // The home screen and the garage: the bus stands in the depot's big open workshop (BB.world.workshop).
  function placeWorkshop() {
    const ws = W().workshop;
    if (!ws) { const p = poseAtBay(W().depot, false); fx = p.fx; fz = p.fz; h = hr = p.h; }
    else { const f = fwdOf(ws.heading); h = hr = ws.heading; fx = ws.x + f.x * frontOff(); fz = ws.z + f.z * frontOff(); }
    B.speed = 0; B.steer = 0; settle = null; B.inWorkshop = true; B.inWash = false;
    placeModel(); snapWall();
  }
  B.placeAtDepot = function (camera) {
    placeWorkshop(); B.atStop = null; B.target = null; B.onArrive = null; B.doorsOpen = false;
    refreshRibbon();
    B.setCamera(camera || 'depot', true);
  };
  // After Drive: the bus waits in its bay in the yard (W.depot), ready to drive out through the gate.
  B.placeInYard = function () {
    const t = B.target, cb = B.onArrive;                 // (a job may already have set its first stop)
    B.placeAt(W().depot); B.atStop = null; B.doorsOpen = false;
    if (t && t !== W().depot) { B.target = t; B.onArrive = cb; refreshRibbon(); }
  };
  // Is the bus inside the depot's yard (or its workshop)? 'bus:leftDepot' fires when it drives out of the gate.
  B.inDepot = function () { const m = midPoint(); return !!(W().inDepotYard && W().inDepotYard(m.x, m.z)); };
  // "Drive!": leave the depot (the child drives off into the kerb lane; the first job is started by jobs.js).
  B.leaveDepot = function () { B.closeDoors(); B.atStop = null; B.setCamera('chase'); };
  // Put the bus anywhere, straight, facing heading (x,z = the front carriage's centre). Used by tows and tests.
  B.setPose = function (x, z, heading) {
    fx = x; fz = z; h = hr = wrapA(heading || 0); B.speed = 0; B.steer = 0; settle = null; B.atStop = null;
    placeModel();
  };
  // Drive to (and settle in) a stop or the depot; cb(stop) runs on arrival. Null clears the target.
  B.stopAt = function (stop, cb) {
    if (stop && stop.edge == null && W().makeBay) W().makeBay(stop);    // a job target {pos, heading, kind}: made into a bay
    if (settle) {
      if (stop && stop !== settle.stop) return false;          // busy pulling in: finish this stop first
      if (!stop) settle = null;                                 // cancelled (e.g. goodnight)
    }
    B.target = stop || null; B.onArrive = cb || null;
    refreshRibbon();
    return true;
  };
  B.washBay = null;                    // set in build: BB.world.washBay (B.stopAt(B.washBay, cb) leads there)
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
  B.horn = function () { BB.sfx.horn(!!BB.save.upgrades.horn); BB.emit('bus:horn'); };
  // World position of seat i (0..9).
  B.seatWorld = function (i, v) { v = v || new THREE.Vector3(); const s = B.seats[i] || B.seats[B.seats.length - 1]; if (!s) return B.doorWorld(v); v.set(s.x, s.y, s.z); return B.front.localToWorld(v); };
  B.doorWorld = function (v) { v = v || new THREE.Vector3(); const d = M ? M.doorLocal : { x: 1.6, y: 0, z: LF / 2 - 1 }; v.set(d.x, 0, d.z); return B.front.localToWorld(v); };
  B.pathAhead = () => 0;
  // The exit door on the kerb side (where people get off): the second door of the seated carriage, or the rear
  // carriage's door on a bendy; the front door if the bus has only one.
  B.exitDoorWorld = function (v) {
    v = v || new THREE.Vector3();
    const d = doors[1] || doors[0];
    if (!d || !d.parent) return B.doorWorld(v);
    v.set(Math.abs(d.userData.x) + 0.35, 0, d.userData.z); return d.parent.localToWorld(v);
  };
  B.isSettling = () => !!settle;
  B.isFacingAway = () => facingAway;
  // Lights (the headlights and tail lights; off for the goodnight moment).
  // A gentle automatic turn-round (kid magic): the bus does a happy hop-and-spin on the spot and lands facing the
  // other way, in the left lane of the road it is on. The HUD shows a button for it while bus:facingAway is on.
  let spin = null;
  B.turnAround = function () {
    if (spin || settle || B.atStop || B.doorsOpen || B.locked || B.noFuel || B.camMode !== 'chase') return false;
    const m = midPoint(), h2 = wrapA(h + Math.PI), f2 = fwdOf(h2);
    let sx = 0, sz = 0;
    const near = nearestRoad(m.x, m.z);
    if (near && near.d < W().halfOf(near.edge) + 1) {
      const dot = f2.x * near.dx + f2.z * near.dz;
      if (Math.abs(dot) > 0.7) {
        const s = Math.sign(dot), lx = near.dz * s, lz = -near.dx * s;          // left of the new way
        const lat = (m.x - near.x) * lx + (m.z - near.z) * lz;
        sx = lx * (C.lane - lat); sz = lz * (C.lane - lat);
      }
    }
    const land = clearLanding(m.x + sx, m.z + sz, h2);
    spin = { t: 0, m, h0: h, bend: wrapA(hr - h), sx: land.x - m.x, sz: land.z - m.z, turn: Math.PI, dur: 1.8, lift: 7.5 };
    B.speed = 0; B.steer = 0;
    BB.sfx.whoosh(); BB.sfx.sparkle && BB.sfx.sparkle();
    BB.emit('bus:turnAround', {});
    if (facingAway) { facingAway = false; BB.emit('bus:facingAway', { on: false }); }
    return true;
  };
  B.isSpinning = () => !!spin;
  // The hop: up above the lamp posts, trees and shelters, turn while high (so it never sweeps through them), land.
  function updateSpin(dt) {
    spin.t = Math.min(1, spin.t + dt / spin.dur);
    const k = BB.smooth(BB.clamp((spin.t - 0.22) / 0.56, 0, 1)), a = spin.h0 + spin.turn * k;
    h = wrapA(a); hr = wrapA(a + spin.bend * (1 - k));
    const mx = spin.m.x + spin.sx * k, mz = spin.m.z + spin.sz * k, f = fwdOf(h);
    fx = mx + f.x * frontOff(); fz = mz + f.z * frontOff();
    spinHop = Math.sin(Math.PI * spin.t) * spin.lift;
    // near the ground (take-off, landing) slide the whole hop away from what it would touch; high up it clears lamp
    // posts and trees (a post it sweeps over must not drag the landing back into the same spot)
    if (spinHop < 2) { const pz = collide(true); spin.m.x += pz.x; spin.m.z += pz.z; }
    if (spin.t >= 1) { spin = null; spinHop = 0; collide(); collide(); collide(); camH = h; refreshRibbon(); }
  }
  let wipePh = 0, lastRoofT = -1, wallT = 0, lastWallT = -1;
  let stuckRef = null;
  let spinHop = 0, facingAway = false, awayT = 0, realMove = 0, jamT = 0, jamSide = 0, jamFlipped = false;
  // Where a straight bus with heading hh, centred at (mx,mz), comes to rest clear of everything (checked before a hop,
  // so it never lands overlapping anything).
  function clearLanding(mx, mz, hh) {
    const s0 = { fx, fz, h, hr }, f = fwdOf(hh), off = frontOff();
    h = hr = hh; fx = mx + f.x * off; fz = mz + f.z * off;
    collide();
    const out = { x: fx - f.x * off, z: fz - f.z * off };
    fx = s0.fx; fz = s0.fz; h = s0.h; hr = s0.hr;
    return out;
  }
  // Hop (same magic as the turn-round, without turning) into the left lane of the nearest road, facing along it.
  function hopFree() {
    const m = midPoint(), near = nearestRoad(m.x, m.z);
    if (!near) return;
    const f = fwdOf(h), s = (f.x * near.dx + f.z * near.dz) >= 0 ? 1 : -1, tx = near.dx * s, tz = near.dz * s;
    const ht = Math.atan2(tx, tz), lx = tz, lz = -tx;
    const land = clearLanding(near.x + lx * C.lane, near.z + lz * C.lane, ht);
    spin = { t: 0, m, h0: h, bend: wrapA(hr - h), sx: land.x - m.x, sz: land.z - m.z, turn: wrapA(ht - h), dur: 1.4, lift: 7 };
    B.speed = 0; B.steer = 0;
    BB.sfx.whoosh(); BB.sfx.sparkle && BB.sfx.sparkle();
    BB.emit('bus:hopFree', {});
  }
  // ---------- a look at something in the sky (BB.bus.lookAt) ----------
  // B.lookAt(target, {duration, hold, slow}): the chase camera gently turns and tilts toward target (a point {x,y,z}
  // read live every frame, so a moving Vector3 or Object3D position can be passed; or an Object3D; or a function
  // returning a point) for duration seconds (default 4, eases included), then eases back. hold: true keeps looking
  // until B.lookAt(null). While it lasts the bus is slowed (to about slow x its top speed, default 0.55; never below
  // a crawl, never stopped). Refused (returns false) at a stop, pulling in, during a question, a tow, the garage, the
  // home screen or a hop; ends early (easing back) if one of those starts. Runs on the game clock, so a hold freezes it.
  // B.lookAt(null) eases back now. B.isLooking() -> bool. Emits 'bus:look' {on}.
  let look = null, lookSlow = 1, lookK = 0;
  const _lp = new THREE.Vector3();
  function lookBlocked() {
    return !!(B.atStop || settle || spin || B.locked || B.camMode !== 'chase' || B.inWorkshop || (BB.jobs && BB.jobs.busy && BB.jobs.busy()));
  }
  B.lookAt = function (target, opts) {
    if (!target) { if (look) look.out = true; return true; }
    if (lookBlocked()) return false;
    opts = opts || {};
    const was = !!look;
    look = { target, t: 0, dur: Math.max(2, +opts.duration || 4), hold: !!opts.hold, slow: BB.clamp(opts.slow != null ? +opts.slow : 0.55, 0.3, 1), out: false };
    if (!was) BB.emit('bus:look', { on: true });
    return true;
  };
  B.isLooking = () => !!look;
  function lookPoint() {
    const t = look.target;
    try {
      if (typeof t === 'function') { const q = t(); if (q) _lp.set(+q.x || 0, +q.y || 0, +q.z || 0); }
      else if (t.isObject3D) t.getWorldPosition(_lp);
      else _lp.set(+t.x || 0, +t.y || 0, +t.z || 0);
    } catch (e) { look.out = true; }
    return _lp;
  }
  function updateLook(dt) {
    if (!look) { lookK = Math.max(0, lookK - dt / 0.9); lookSlow = 1; return; }
    look.t += dt;
    if (lookBlocked() || look.t > 30) look.out = true;
    const IN = 0.8, OUT = 1.0;
    if (!look.hold && look.t > look.dur - OUT) look.out = true;
    lookK = look.out ? Math.max(0, lookK - dt / OUT) : Math.min(1, lookK + dt / IN);
    lookSlow = 1 - BB.smooth(lookK) * (1 - look.slow);
    if (look.out && lookK <= 0) { look = null; lookSlow = 1; BB.emit('bus:look', { on: false }); }
  }
  // ---------- the special vehicles (fleet.js: taxi, fire engine, ambulance, ice cream van, tow truck) ----------
  // B.kind: 'bus' or the vehicle's kind (BB.fleet.KIND[type]). B.siren(on): the light bar flashes and a quiet,
  // original two-tone plays (fire engine and ambulance; on the game clock, so a hold silences it). B.raiseLadder(on)
  // (fire engine), B.openHatch(on) (ice cream van's serving hatch): eased over about a second; false when this
  // vehicle has none. B.hookOn(obj): hangs an Object3D (e.g. a broken-down car) on the tow hook, null drops it where
  // it is; B.hooked() -> the object or null. B.has(part) -> 'ladder' | 'hatch' | 'hook' | 'siren' present?
  // B.scenePoint(tag): a roadside scene spot (W.sceneSpots) for tag 'fire' | 'car' | 'picnic' | 'icecream', away from
  // the vehicle; pass it to B.stopAt (with .frame = [{x,y,z}, ...] points the side-view camera must also show).
  function setSirenLights(on) { const sr = extras.siren; if (sr && typeof sr.setOn === 'function') { try { sr.setOn(!!on); } catch (e) { console.error(e); } } }
  B.has = (part) => part === 'siren' ? !!extras.siren || B.kind === 'fire' || B.kind === 'ambulance' : !!extras[part];
  B.siren = function (on) {
    on = !!on && (B.kind === 'fire' || B.kind === 'ambulance' || !!extras.siren);
    if (sirenOn === on) return on;
    sirenOn = on; sirenT = 0; setSirenLights(on);
    BB.emit('bus:siren', { on });
    return on;
  };
  B.sirenOn = () => sirenOn;
  function sirenNote(hi) {
    const A = BB.audio, ctx = A && A.ctx; if (!ctx || ctx.state !== 'running' || BB.held) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), amb = B.kind === 'ambulance';
    o.type = 'triangle'; o.frequency.setValueAtTime(amb ? (hi ? 740 : 588) : (hi ? 660 : 494), t);   // (our own pair of notes)
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.04); g.gain.setValueAtTime(0.035, t + 0.36); g.gain.linearRampToValueAtTime(0, t + 0.44);
    o.connect(g); g.connect(A.sfxBus || A.master); o.start(t); o.stop(t + 0.46);
  }
  B.raiseLadder = function (on) { if (!extras.ladder) return false; partW.ladder = on ? 1 : 0; return true; };
  B.openHatch = function (on) { if (!extras.hatch) return false; partW.hatch = on ? 1 : 0; return true; };
  B.raiseBoom = function (on) { if (!extras.boom) return false; partW.boom = on ? 1 : 0; return true; };   // (tow truck)
  B.hookOn = function (obj) {
    const hk = extras.hook;
    if (!hk || !hk.isObject3D) return false;
    if (hooked && hooked !== obj) { if (BB.scene) BB.scene.attach(hooked); hooked = null; }
    const end = (hk.userData && hk.userData.end && hk.userData.end.isObject3D) ? hk.userData.end : hk;
    if (obj && obj.isObject3D) { end.attach(obj); obj.position.set(0, 0, 0); hooked = obj; BB.emit('bus:hooked', { on: true }); }
    else if (!obj) BB.emit('bus:hooked', { on: false });
    return true;
  };
  B.hooked = () => hooked;
  B.scenePoint = function (tag) { const w = W(); return w.sceneSpot ? w.sceneSpot(tag, fx, fz) : null; };
  // ease the ladder, the hatch and the boom between the angles fleet.js gives (ladder and boom turn about x through
  // userData.raise, the hatch about z through userData.open)
  function moveParts(dt) {
    for (const k of ['ladder', 'hatch', 'boom']) {
      const o = extras[k]; if (!o || !o.isObject3D) continue;
      const cur = partT[k] || 0, t = cur + BB.clamp((partW[k] || 0) - cur, -dt * 0.9, dt * 0.9);
      if (t === cur) continue;
      partT[k] = t;
      const e = BB.smooth(t), r = o.userData.raise || o.userData.open || (k === 'hatch' ? [0, 1.5] : [0, -0.75]);
      o.rotation[k === 'hatch' ? 'z' : 'x'] = r[0] + (r[1] - r[0]) * e;
    }
    if (sirenOn) { sirenT -= dt; if (sirenT <= 0) { sirenT = 0.48; sirenHi = !sirenHi; sirenNote(sirenHi); } }
    if (extras.siren && typeof extras.siren.update === 'function') { try { extras.siren.update(dt); } catch (e) { /* ignore */ } }
  }
  B.setLights = function (on) { B.lightsOn = !!on; if (M && M.setLights) M.setLights(!!on); };

  // ---------- model ----------
  // Three bus types: 'bendy' (two carriages and a joint), 'double' (a double-decker) and 'single'. BB.fleet (fleet.js)
  // builds their models when it is loaded; without it this file's own bendy bus is used. install() wires a model in;
  // the physics reads the geometry vars (LF, LR, GAP, axles, ART) it sets.
  let paintMat, glassMat, lampMat, wheelsF = [], wheelsR = [], steerWheels = [], doors = [], wipers = [];
  let heads, hair, shirts, lightCones, beacon, ribbon, ribbonTex, bayGlow, bayTex, wayArrow, jointF = null, jointR = null;
  let M = null;                       // the installed model: {type, roofParts, mounts, routeSign, doorLocal, roofY, paintMats}
  let extras = {}, partT = {}, partW = {}, sirenOn = false, sirenT = 0, sirenHi = false, hooked = null;
  let WHEEL = { r: 0.52, x: 1.08 };      // the model's tyre radius and wheel offset (the parts shop scales from these)
  let roofT = 0;                      // 0 = roof on, 1 = roof lifted away (the stop's cut-away view)
  const rearDummy = new THREE.Object3D();
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
    buildPassengers();
    // headlight beams (brighter with the upgrade; at night and in storms)
    const lb = BB.mk.builder();
    for (const x of [-0.8, 0.8]) lb.add(new THREE.ConeGeometry(1.4, 7, 10, 1, true), '#fff6c0', x, 0.9, 3.5, 0, Math.PI / 2 + 0.12);
    lightCones = new THREE.Mesh(lb.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    lightCones.visible = false;
    BB.scene.add(B.group);
    buildRibbon(); buildBeacon(); buildBayGlow(); buildWayArrow();
    B.setPaint(BB.save.paint);
    B.setType(BB.save.busType || 'bendy');
    B.applyCustom(BB.save);
  }
  B.TYPES = ['bendy', 'double', 'single'];        // the buses (fleet.js may add more vehicles: BB.fleet.TYPES)
  B.type = null; B.kind = 'bus';
  const allTypes = () => (BB.fleet && Array.isArray(BB.fleet.TYPES) ? BB.fleet.TYPES.concat(B.TYPES.filter((t) => BB.fleet.TYPES.indexOf(t) < 0)) : B.TYPES);
  const kindOf = (type) => (BB.fleet && BB.fleet.KIND && BB.fleet.KIND[type]) || (B.TYPES.indexOf(type) >= 0 ? 'bus' : type);
  // Swap the bus for another type (keeps where it is and which way it faces). Fleet models come from BB.fleet.
  B.setType = function (type, force) {
    if (allTypes().indexOf(type) < 0) type = 'bendy';
    const F = BB.fleet && typeof BB.fleet.build === 'function' ? BB.fleet : null;
    if (!F && type !== 'bendy') type = 'bendy';
    if (B.type === type && M && !force) return false;
    let m = null;
    if (F) { try { m = F.build(type, B.paint); } catch (e) { console.error('[fleet]', e); m = null; } }
    if (!m) { type = 'bendy'; m = ownBendy(); }
    // take the old model out (a fleet model disposes itself; our own: geometries disposed, shared materials kept)
    if (B.paxGroup && B.paxGroup.parent) B.paxGroup.parent.remove(B.paxGroup);
    if (lightCones.parent) lightCones.parent.remove(lightCones);
    for (const o of [bumperF, bumperR, lightPart, lightRoof]) if (o && o.parent) { o.parent.remove(o); o.geometry.dispose(); }
    for (const gl of glows) { if (gl.parent) gl.parent.remove(gl); gl.geometry.dispose(); gl.material.dispose(); }
    if (hooked && BB.scene) { BB.scene.attach(hooked); hooked = null; }
    if (M && M.dispose) { try { M.dispose(); } catch (e) { console.error(e); } }
    const keep = new Set([paintMat, glassMat, lampMat, BB.mk.mat]);
    for (const ch of B.group.children.slice()) {
      B.group.remove(ch);
      ch.traverse((o) => { if (o === B.paxGroup || o === lightCones) return; if (o.geometry && !o.isInstancedMesh && o !== lightCones) o.geometry.dispose(); });
    }
    if (B.paxGroup && B.paxGroup.parent) B.paxGroup.parent.remove(B.paxGroup);
    if (lightCones.parent) lightCones.parent.remove(lightCones);
    install(m, type);
    keep.clear();
    BB.emit('bus:type', { type });
    return true;
  };
  function install(m, type) {
    const car = m.carriages || [];
    B.front = car[0]; ART = !!car[1]; B.rear = car[1] || rearDummy;
    LF = m.length || 7.4; LR = ART ? (m.lengthRear || 6.0) : 0;
    GAP = !ART ? 0 : m.gap != null ? m.gap : m.hitch ? Math.max(0.2, 2 * (-m.hitch.front.z - LF / 2)) : 1.0;
    const wf = (m.wheels && m.wheels.front) || [], wr = (m.wheels && m.wheels.rear) || [];
    const zs = wf.map((w) => w.position.z);
    FRONT_AXLE = zs.length ? LF / 2 - Math.max(...zs) : 1.3;
    MID_AXLE = m.wheelbase ? FRONT_AXLE + m.wheelbase : zs.length > 1 ? LF / 2 - Math.min(...zs) : LF - 1.8;
    REAR_AXLE = ART ? (wr.length ? LR / 2 - wr[0].position.z : 4.2) : 0;
    WB = Math.max(2.5, MID_AXLE - FRONT_AXLE); AX = MID_AXLE - LF / 2; HITCH = LF / 2 + GAP / 2;
    R_AXLE = GAP / 2 + REAR_AXLE; R_CTR = GAP / 2 + LR / 2;
    B.group.add(B.front); if (ART) B.group.add(B.rear);
    jointF = jointR = null;
    if (m.joints) { jointF = m.joints[0]; jointR = m.joints[1] || null; }
    else if (m.joint || m.jointGroup) jointF = m.joint || m.jointGroup;
    else if (ART && !m.hitch) { jointF = jointMesh(1); jointR = jointMesh(-1); }   // (fleet bendies have the accordion built in)
    for (const j of [jointF, jointR]) if (j) B.group.add(j);
    B.joint = jointF;
    wheelsF = wf; wheelsR = wr;
    steerWheels = (m.wheels && m.wheels.steer) || (wf.length ? [wf.reduce((a, b) => (b.position.z > a.position.z ? b : a))] : []);
    for (const w of wheelsF.concat(wheelsR)) w.rotation.order = 'YXZ';
    // doors: Object3Ds (ours) or {mesh, slide} (fleet proxies that only slide along z)
    doors = (m.doors || []).map((d) => {
      const o = d.isObject3D ? d : d.mesh, zOnly = !d.isObject3D;
      o.userData.z = o.position.z; o.userData.x = o.position.x; o.userData.zOnly = zOnly; o.userData.slide = d.slide || 1.1;
      return o;
    });
    wipers = m.wipers || [];
    B.kind = kindOf(type);
    // seats: the model's own (a bus has 10, a taxi a few, a fire engine none), the default ten for an old bus model
    B.seats = Array.isArray(m.seatsLocal) ? m.seatsLocal.slice(0, 10) : B.kind === 'bus' ? defaultSeats() : [];
    const V = VEHICLE[B.kind] || VEHICLE[type] || VEHICLE.bus;
    MAX_FWD = V.top; MAX_CRUISE = V.cruise; ACCEL = V.accel; MAX_STEER = V.steer;
    // the vehicles' moving bits (fleet.js): ladder, hatch, tow hook, siren light bar
    const ud = Object.assign({}, B.front.userData || {}, m.userData || {});
    extras = { ladder: m.ladder || ud.ladder || null, hatch: m.hatch || ud.hatch || null, boom: m.boom || ud.boom || null, hook: m.hook || ud.hook || null, siren: m.siren || ud.siren || null };
    partT = { ladder: 0, hatch: 0, boom: 0 }; partW = { ladder: 0, hatch: 0, boom: 0 };
    const bm = extras.boom, br = bm && bm.userData && bm.userData.raise;     // (the tow boom starts part-raised)
    if (br) partT.boom = partW.boom = BB.clamp((bm.rotation.x - br[0]) / ((br[1] - br[0]) || 1), 0, 1);
    WHEEL = { r: (m.wheels && m.wheels.radius) || 0.52, x: (m.wheels && m.wheels.x) || 1.08 };
    if (sirenOn) { if (B.kind === 'fire' || B.kind === 'ambulance' || extras.siren) setSirenLights(true); else sirenOn = false; }
    // roof parts fade for the stop's cut-away view: a fleet model hands over its roof material; ours get clones
    const paintMats = [m.paintMaterial || paintMat], roofMats = [];
    const roofParts = (m.roofParts || []).map((o) => {
      o.userData.roofY = o.position.y;
      if (m.roofMaterial) return o;
      o.traverse((q) => {
        if (!q.material || q.userData.roofOwn) return;
        const wasPaint = paintMats.indexOf(q.material) >= 0;
        q.material = q.material.clone(); q.userData.roofOwn = true; roofMats.push({ mat: q.material, base: q.material.opacity, tr: q.material.transparent });
        if (wasPaint) paintMats.push(q.material);
      });
      return o;
    });
    if (m.roofMaterial) roofMats.push({ mat: m.roofMaterial, base: m.roofMaterial.opacity, tr: m.roofMaterial.transparent });
    // the kerb-side wall above the sill (fleet buses): it fades away at stops so the bus becomes a dollhouse
    // Outside the stop's side view the kerb wall is a solid wall: drawn opaque (with the rest of the body, so nothing
    // behind it shows through or sorts over it) and its see-through glass tinted like the rear carriage's windows
    // (uSolid = 1). Only while the stop view fades it does it turn see-through again.
    const wallMats = [];
    if (m.kerbWallMaterial) { solidGlass(m.kerbWallMaterial); wallMats.push({ mat: m.kerbWallMaterial, base: m.kerbWallMaterial.opacity, tr: false }); }
    if (m.roofMaterial) wallMats.push({ mat: m.roofMaterial, glassOnly: true, u: solidGlass(m.roofMaterial) });   // (the road side and the doors)
    const pm = m.partMounts || {};
    M = { type, roofParts, roofMats, wallMats, roofMaterial: m.roofMaterial || null, wallParts: m.kerbWallParts || [], height: m.height || 3.1, routeSign: m.routeSign || null, doorLocal: m.doorLocal || { x: 1.6, y: 0, z: LF / 2 - 1.0 },
      roofY: m.roofY || m.height || 3.1, paintMats, setPaint: m.setPaint, setLights: m.setLights, dispose: m.dispose,
      mounts: { lights: pm.lights || pm.lightsFront, bumpersFront: pm.bumpersFront || pm.bumperFront, bumpersRear: pm.bumpersRear || pm.bumperRear, roof: pm.roofFront || null,
        glow: [pm.underglow, pm.underglowRear].filter(Boolean) } };
    B.type = type; B.length = LF + GAP + LR; lastRoofT = -1; lastWallT = -1;
    // passengers, headlight beams, the (empty) old hat mount, sticker anchors
    B.front.add(B.paxGroup); seatPassengers();
    lightCones.position.set(0, 0, LF / 2); B.front.add(lightCones);
    B.hatMount = new THREE.Group(); B.hatMount.name = 'hatMount'; B.hatMount.position.set(0, M.roofY, LF / 2 - 1.7); B.front.add(B.hatMount);
    B.stickerAnchors = m.stickerAnchors || [[], [], []];
    for (let i = 0; i < 3; i++) { stickerMeshes[i] = []; stickerMeshes[i].want = undefined; }
    // the swappable parts on their mounts
    const mt = M.mounts;
    bumperF = new THREE.Mesh(new THREE.BufferGeometry(), BB.mk.mat); bumperF.name = 'bumperF';
    bumperR = new THREE.Mesh(new THREE.BufferGeometry(), BB.mk.mat); bumperR.name = 'bumperR';
    if (mt.bumpersFront) mt.bumpersFront.add(bumperF);
    if (mt.bumpersRear) mt.bumpersRear.add(bumperR);
    lightPart = new THREE.Mesh(new THREE.BufferGeometry(), lampMat); lightPart.name = 'lightPart';
    (mt.lights || B.front).add(lightPart);
    lightRoof = new THREE.Mesh(new THREE.BufferGeometry(), lampMat); lightRoof.name = 'lightRoof';
    (mt.roof || mt.lights || B.front).add(lightRoof);
    glows.length = 0;
    const glowAt = mt.glow.length ? mt.glow.map((g) => [g, (g.userData && g.userData.length) || LF, 0]) : [[B.front, LF, 0.06]].concat(ART ? [[B.rear, LR, 0.06]] : []);
    for (const [c, L, y] of glowAt) {
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(3.6, L + 1.0), glowMat()); gl.rotation.x = -Math.PI / 2; gl.position.y = y; gl.renderOrder = 1; gl.visible = false; c.add(gl); glows.push(gl);
    }
    for (const k of ['lights', 'bumpers', 'wheels', 'rims']) B.setPart(k, B.parts[k]);
    B.setPaint(B.paint);
    B.setRouteNumber(B.routeNo);
    partsApplied = false;
    if (B.front) placeModel();
    if (BB.scene) buildDirt();
    snapWall();
  }
  // Patch a fleet body material so its side windows can look solid: uniform uSolid (1 = side-facing glass panes are
  // opaque, tinted like the bendy's rear carriage windows; 0 = the model's own see-through glass). The windscreen and
  // the rear window (facing along the bus) keep their glass, so the driver still shows.
  function solidGlass(mat) {
    if (mat.userData.solidU) return mat.userData.solidU;
    const u = mat.userData.solidU = { value: 1 }, tint = new THREE.Color('#86a3b6'), prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.uniforms.uSolid = u; sh.uniforms.uSolidTint = { value: tint };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vSideN;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvSideN = abs(objectNormal.x);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSolid;\nuniform vec3 uSolidTint;\nvarying float vSideN;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n#ifdef USE_COLOR_ALPHA\nif (vColor.a < 0.99) { float sk = uSolid * smoothstep(0.55, 0.8, vSideN); diffuseColor.rgb = mix(diffuseColor.rgb, uSolidTint, sk); diffuseColor.a = mix(diffuseColor.a, 1.0, sk); }\n#endif');
    };
    const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
    mat.customProgramCacheKey = () => key() + '|bbSolidGlass';
    mat.needsUpdate = true;
    return u;
  }
  function defaultSeats() { const s = []; for (let i = 0; i < 10; i++) s.push({ x: i < 5 ? 0.62 : -0.62, y: 1.25, z: 1.9 - (i % 5) * 1.15 }); return s; }

  // This file's own bendy bus (used when fleet.js isn't there), in the same shape fleet.build() returns.
  function ownBendy() {
    LF = 7.4; LR = 6.0; GAP = 1.0; FRONT_AXLE = 1.3; MID_AXLE = 5.6; REAR_AXLE = 4.2;
    const f = carriage(true), r = carriage(false);
    const anchor = (c, x, y, z, ry, rx, size) => { const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.set(rx || 0, ry, 0, 'YXZ'); o.userData.size = size; c.add(o); return o; };
    const mount = (c, z) => { const o = new THREE.Object3D(); o.position.set(0, 0, z); c.add(o); return o; };
    const digitsF = new THREE.Mesh(new THREE.BufferGeometry(), lampMat), digitsR = new THREE.Mesh(new THREE.BufferGeometry(), lampMat);
    digitsF.position.set(-0.82, 2.43, 7.4 / 2 + 0.1); f.g.add(digitsF);
    digitsR.position.set(0, 2.46, -6.0 / 2 - 0.08); digitsR.rotation.y = Math.PI; r.g.add(digitsR);
    return {
      carriages: [f.g, r.g], wheels: { front: f.wheels, rear: r.wheels, steer: [f.wheels[0]] }, doors: [f.door, r.door],
      seatsLocal: defaultSeats(), doorLocal: { x: 1.6, y: 0, z: 7.4 / 2 - 1.0 }, roofParts: [f.roof], wipers: f.wipers,
      stickerAnchors: [
        [anchor(f.g, 1.27, 1.0, 0.45, Math.PI / 2, 0, 1.15), anchor(f.g, -1.27, 1.0, 0.45, -Math.PI / 2, 0, 1.15)],
        [anchor(r.g, 1.27, 1.0, -2.3, Math.PI / 2, 0, 1.0), anchor(r.g, -1.27, 1.0, -2.3, -Math.PI / 2, 0, 1.0)],
        [anchor(r.g, 0, 3.1, -0.4, 0, -Math.PI / 2, 2.0)],
      ],
      partMounts: { lights: mount(f.g, 7.4 / 2), bumpersFront: mount(f.g, 7.4 / 2 + 0.04), bumpersRear: (() => { const o = mount(r.g, -6.0 / 2 - 0.04); o.rotation.y = Math.PI; return o; })() },
      routeSign: { setNumber(s) { for (const d of [digitsF, digitsR]) { d.geometry.dispose(); d.geometry = digitGeometry(s); } } },
      length: 7.4, lengthRear: 6.0, gap: 1.0, paintMaterial: paintMat, roofY: 3.1,
    };
  }
  // LED route number: up to 3 digits as 7-segment bars, centred on the mesh's origin (facing +z).
  function digitGeometry(str) {
    const b = BB.mk.builder(), SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
    const s = String(str == null ? '' : str).replace(/[^0-9]/g, '').slice(0, 3), w = 0.12, hh = 0.18, gap = 0.17;
    b.box(0.2 + s.length * gap, 0.28, 0.04, '#1c1a20', 0, -0.14, -0.03);
    [...s].forEach((ch, i) => {
      const x = (i - (s.length - 1) / 2) * gap, segs = SEG[ch] || '';
      const H = (y) => b.box(w, 0.025, 0.03, '#ffb43a', x, y, 0), V = (dx, y) => b.box(0.025, hh / 2, 0.03, '#ffb43a', x + dx, y, 0);
      if (segs.includes('a')) H(0.075); if (segs.includes('g')) H(-0.012); if (segs.includes('d')) H(-0.1);
      if (segs.includes('f')) V(-w / 2, 0.0); if (segs.includes('b')) V(w / 2, 0.0);
      if (segs.includes('e')) V(-w / 2, -0.09); if (segs.includes('c')) V(w / 2, -0.09);
    });
    return b.geometry();
  }
  // Show a route number on the bus's displays (front, rear; fleet models may have more). Generic numbers only.
  B.routeNo = '10';
  B.setRouteNumber = function (str) {
    B.routeNo = String(str == null ? '10' : str).replace(/[^0-9]/g, '').slice(0, 3) || '10';
    if (M && M.routeSign && typeof M.routeSign.setNumber === 'function') { try { M.routeSign.setNumber(B.routeNo); } catch (e) { console.error(e); } }
  };
  function carriage(isFront) {
    const L = isFront ? LF : LR, g = new THREE.Group(), out = { g, wheels: [], wipers: [] };
    const paint = BB.mk.builder(), det = BB.mk.builder(), glass = BB.mk.builder(), lamps = BB.mk.builder();
    const roofP = BB.mk.builder(), roofD = BB.mk.builder();
    const zf = L / 2, zb = -L / 2;
    // painted body (vertex colour white = paint colour, grey = a deeper tone of it): a rounded lower body, window
    // pillars and a rounded roof
    paint.add(slab(2.5, 0.42, 1.32, 0.12, 0.18, L), '#ffffff');
    paint.add(slab(2.54, 0.4, 0.72, 0.1, 0.16, L + 0.04, 0.1), '#b9b9b9');             // darker skirt
    roofP.add(slab(2.5, 2.36, 3.1, 0.5, 0.05, L), '#ffffff');                           // the roof (lifts off at stops)
    // side windows with dark frames (pillars and a frame along the top and bottom of the glass)
    const nWin = isFront ? 4 : 3, FRAME = '#33303a';
    for (let k = 0; k <= nWin; k++) {
      const z = zb + 0.25 + (L - 0.5) * k / nWin;
      if (isFront && k === nWin) continue;
      det.box(2.5, 1.06, 0.16, FRAME, 0, 1.31, z);
    }
    if (isFront) det.box(2.5, 1.06, 0.3, FRAME, 0, 1.31, zf - 0.17);
    for (const s of [1, -1]) { det.box(0.05, 0.08, L - 0.3, FRAME, s * 1.252, 1.3, 0); det.box(0.05, 0.08, L - 0.3, FRAME, s * 1.252, 2.32, 0); }
    roofD.box(1.4, 0.32, L * 0.34, '#f4ecdc', 0, 3.02, -L * 0.12);                  // roof pod (air-con)
    roofD.box(1.1, 0.1, L * 0.3, '#ffffff', 0, 3.34, -L * 0.12);
    det.box(2.3, 0.1, L - 0.3, '#6c6470', 0, 0.62, 0);                               // floor (seen through glass)
    // a fleet-style stripe along each side that stays cream whatever the paint
    for (const s of [1, -1]) { det.box(0.06, 0.16, L - 0.4, '#fff6e0', s * 1.255, 1.08, 0); det.box(0.06, 0.07, L - 0.4, '#3a3440', s * 1.256, 0.98, 0); }
    glass.box(2.42, 1.02, L - 0.3, '#ffffff', 0, 1.33, 0);
    // wheel arches (dark half discs on both sides)
    const axles = isFront ? [zf - FRONT_AXLE, zf - MID_AXLE] : [zf - REAR_AXLE];
    for (const z of axles) for (const s of [1, -1]) det.add(new THREE.CircleGeometry(0.72, 10, 0, Math.PI), '#4a3f4c', s * 1.262, 0.42, z, s * Math.PI / 2);
    for (let i = 0; i < 5 && isFront; i++) for (const x of [0.62, -0.62]) det.box(0.8, 0.72, 0.18, P.berry, x, 0.66, 1.9 - i * 1.15 - 0.42);
    if (isFront) {
      const FZ = zf + 0.01;
      // a big windscreen in two panes split by a pillar, under a lit destination display
      det.box(2.42, 1.2, 0.08, '#33303a', 0, 1.22, FZ);                              // frame
      for (const x of [-0.6, 0.6]) det.box(1.12, 1.06, 0.1, '#46708f', x, 1.29, FZ + 0.01);
      for (const x of [-0.9, 0.3]) det.box(0.22, 0.9, 0.11, '#6a93b0', x, 1.38, FZ + 0.015, 0, 0, 0.12);   // a glint
      det.box(2.42, 0.4, 0.08, '#2a2630', 0, 2.36, FZ);                               // display housing
      for (let k = 0; k < 9; k++) lamps.box(0.1, 0.06 + (k % 3) * 0.03, 0.04, '#ffb43a', -0.3 + k * 0.15, 2.46, FZ + 0.06);   // destination
      // wipers (they sweep in the rain): pivots at the bottom of the glass
      for (const x of [-0.95, 0.25]) {
        const wp = new THREE.Group(); wp.position.set(x, 1.33, FZ + 0.08); wp.userData.rest = 0.18;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.045, 0.04), BB.mk.mat); arm.position.x = 0.36; wp.add(arm);
        wp.rotation.z = 0.18; g.add(wp); out.wipers.push(wp);
      }
      // lower front: grille, rectangular headlight clusters with indicators, bumper, a generic number plate
      det.box(2.44, 0.34, 0.06, '#d9d4cb', 0, 0.58, FZ);
      for (let k = 0; k < 3; k++) det.box(1.0, 0.04, 0.07, '#3a3440', 0, 0.63 + k * 0.08, FZ + 0.01);
      for (const s of [1, -1]) {
        det.box(0.62, 0.26, 0.06, '#33303a', s * 0.86, 0.6, FZ + 0.01);
        lamps.box(0.36, 0.18, 0.05, '#fff6c8', s * 0.94, 0.64, FZ + 0.04);
        lamps.box(0.16, 0.18, 0.05, '#ffae3a', s * 0.66, 0.64, FZ + 0.04);
        lamps.box(0.08, 0.1, 0.3, '#ffae3a', s * 1.26, 0.72, zf - 0.25);              // side indicator
      }
      // wing mirrors on arms, hanging forward of the windscreen
      for (const s of [1, -1]) {
        det.box(0.06, 0.06, 0.55, '#33303a', s * 1.3, 2.25, zf + 0.15, s * 0.25);
        det.box(0.06, 0.45, 0.06, '#33303a', s * 1.42, 1.85, zf + 0.42);
        det.box(0.22, 0.5, 0.1, '#2b2830', s * 1.44, 1.45, zf + 0.42);
        det.box(0.17, 0.42, 0.02, '#8fb6cf', s * 1.44, 1.49, zf + 0.37);
      }
      // the driver sits on the RIGHT (-x), with a cap and a steering wheel
      det.box(0.7, 0.9, 0.5, '#4a4250', -0.62, 0.62, zf - 0.85);
      det.cyl(0.22, 0.28, 0.6, 6, '#4f7fe0', -0.62, 1.15, zf - 0.75);
      det.ball(0.24, '#d9a679', -0.62, 1.95, zf - 0.75);
      det.ball(0.26, '#2b5aa8', -0.62, 2.05, zf - 0.78, 0, 1, 0.55, 1); det.box(0.34, 0.05, 0.26, '#2b5aa8', -0.62, 2.03, zf - 0.55);
      det.add(new THREE.TorusGeometry(0.22, 0.04, 4, 10), '#3a2a3c', -0.62, 1.55, zf - 0.38, 0, -0.9);
    } else {
      const BZ = zb - 0.01;
      det.box(2.1, 0.8, 0.08, '#33303a', 0, 1.52, BZ); det.box(1.9, 0.66, 0.1, '#46708f', 0, 1.59, BZ - 0.01);   // rear window
      det.box(1.3, 0.22, 0.08, '#2a2630', 0, 2.42, BZ);                              // route number display
      det.box(1.5, 0.62, 0.06, '#3a3440', 0, 0.62, BZ);                              // engine grille
      for (let k = 0; k < 5; k++) det.box(1.4, 0.05, 0.08, '#6c6470', 0, 0.68 + k * 0.11, BZ - 0.01);
      for (const s of [1, -1]) {                                                       // tail-light clusters
        det.box(0.34, 0.9, 0.06, '#33303a', s * 1.0, 0.58, BZ);
        lamps.box(0.26, 0.38, 0.05, '#ff4a3a', s * 1.0, 0.98, BZ - 0.03);
        lamps.box(0.26, 0.16, 0.05, '#ffae3a', s * 1.0, 0.8, BZ - 0.03);
        lamps.box(0.26, 0.14, 0.05, '#fbf3e0', s * 1.0, 0.63, BZ - 0.03);
      }
    }
    const pm = paint.mesh(paintMat), dm = det.mesh(), gm = glass.mesh(glassMat), lm = lamps.mesh(lampMat);
    gm.renderOrder = 3;
    g.add(pm, dm, gm, lm);
    const roof = new THREE.Group(); roof.name = 'roof'; roof.add(roofP.mesh(paintMat), roofD.mesh()); g.add(roof); out.roof = roof;
    // doors (kerb side, +x): front door near the nose, rear door on the rear carriage
    const db = BB.mk.builder();
    db.box(0.08, 1.95, 0.55, '#5d86a3', 0, 0, -0.29); db.box(0.08, 1.95, 0.55, '#5d86a3', 0, 0, 0.29);
    db.box(0.1, 0.1, 1.2, '#33303a', 0, 1.95, 0); db.box(0.1, 1.95, 0.08, '#33303a', 0, 0, 0);
    for (const z of [-0.29, 0.29]) db.box(0.1, 0.06, 0.55, '#33303a', 0, 0.9, z);
    const door = db.mesh(); door.position.set(1.27, 0.5, isFront ? zf - 1.0 : zf - 1.6); door.userData.z = door.position.z;
    g.add(door); out.door = door;
    // wheels: one mesh per axle (both wheels), spinning about x; the front axle also steers
    for (const z of axles) {
      const wm = new THREE.Mesh(wheelGeometry(), BB.mk.mat); wm.position.set(0, tyreR(), z); wm.rotation.order = 'YXZ';
      g.add(wm); out.wheels.push(wm);
    }
    const blob = BB.mk.blob(3.6, L + 1.6); blob.position.y = 0.08; g.add(blob);
    return out;
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
    for (let i = 0; i < 10; i++) {
      heads.setColorAt(i, new THREE.Color(skins[(i * 3) % skins.length])); shirts.setColorAt(i, new THREE.Color(tops[(i * 2 + 1) % tops.length]));
      hair.setColorAt(i, new THREE.Color(hairs[(i * 5 + 1) % hairs.length]));
    }
    heads.count = hair.count = shirts.count = 0;
    const pg = new THREE.Group(); pg.add(heads, hair, shirts); B.paxGroup = pg;
  }
  // Seat the passengers on the current model's seats (they look out of the windows, and up a little at stops).
  function seatPassengers() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1.15, 1.15, 1.15), p = new THREE.Vector3();
    B.seats.forEach((s, i) => {
      q.setFromAxisAngle(up, (s.x > 0 ? 1 : -1) * (0.75 + (i % 3) * 0.15));
      m.compose(p.set(s.x, s.y, s.z), q, sc);
      heads.setMatrixAt(i, m); hair.setMatrixAt(i, m); shirts.setMatrixAt(i, m);
    });
    heads.instanceMatrix.needsUpdate = hair.instanceMatrix.needsUpdate = shirts.instanceMatrix.needsUpdate = true;
  }

  // (the other vehicles keep their own colours: a red fire engine, a white ambulance, a yellow taxi; force = true
  // repaints one anyway)
  B.setPaint = function (c, force) {
    const own = B.kind !== 'bus' && BB.fleet && BB.fleet.PAINT && BB.fleet.PAINT[B.type];
    const found = BB.PAINTS.find((p) => p.id === c), want = found ? found.color : (typeof c === 'string' && c[0] === '#' ? c : P.busGreen);
    if (!own || force) B.paint = want;                     // (B.paint stays the bus's colour while another vehicle shows)
    const col = own && !force ? own : want;
    if (paintMat) paintMat.color.set(col);
    if (M && M.setPaint) M.setPaint(col);
    else if (M) for (const pm of M.paintMats) if (pm && pm.color) pm.color.set(col);
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
  let partsApplied = false;
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
  // ---------- parts: lights, bumpers, wheels, rims (the garage sells them; depot.js sets the prices) ----------
  // (ids match depot.js; the first of each kind is the bus's own part)
  B.PARTS = {
    lights: [{ id: 'std', name: 'Round lamps' }, { id: 'fog', name: 'Fog lamps' }, { id: 'led', name: 'Light strip' },
      { id: 'roof', name: 'Roof lamps' }, { id: 'underglow', name: 'Underglow' }],
    bumpers: [{ id: 'std', name: 'Bus bumper' }, { id: 'chrome', name: 'Shiny bumper' }, { id: 'sport', name: 'Sport bumper' }, { id: 'bull', name: 'Big bumper' }],
    wheels: [{ id: 'std', name: 'Bus wheels' }, { id: 'big', name: 'Big wheels' }, { id: 'chunky', name: 'Chunky tyres' }, { id: 'white', name: 'White-wall tyres' }],
    rims: [{ id: 'std', name: 'Silver rims' }, { id: 'gold', name: 'Gold rims' }, { id: 'red', name: 'Red rims' }, { id: 'blue', name: 'Blue rims' }, { id: 'star', name: 'Star rims' }],
  };
  const PART_ALIAS = { standard: 'std', lightbar: 'roof', sporty: 'sport', tough: 'bull', whitewall: 'white', silver: 'std' };
  B.GLOW_COLORS = ['#5fd0ff', '#ff5fd0', '#7dff8a', '#ffd45c', '#b58cff'];
  B.parts = { lights: 'std', bumpers: 'std', wheels: 'std', rims: 'std', glow: '#5fd0ff' };
  let bumperF = null, bumperR = null, lightPart = null, lightRoof = null;
  const glows = [];
  const tyreR = () => (B.parts.wheels === 'big' ? 0.62 : B.parts.wheels === 'chunky' ? 0.57 : 0.52) * WHEEL.r / 0.52;
  // One axle's two wheels (tyres + rims), merged; the wheel spins about x.
  function wheelGeometry() {
    const w = B.parts.wheels, rim = B.parts.rims, b = BB.mk.builder(), R = tyreR(), Wd = w === 'chunky' ? 0.46 : w === 'big' ? 0.42 : 0.36;
    const RIM = { std: ['#dfe3ea', '#aab2bf', 1], star: ['#4a4552', '#e6e9ef', 5], gold: ['#ffd45c', '#d99a1c', 6], red: ['#3a3440', '#ff4a3a', 8], blue: ['#7fb2ff', '#e6f0ff', 6] }[rim] || ['#dfe3ea', '#aab2bf', 1];
    for (const s of [-1, 1]) {
      const x = s * WHEEL.x, face = x + s * (Wd / 2 + 0.01);
      b.add(new THREE.CylinderGeometry(R, R, Wd, 14), '#2f2a33', x, 0, 0, 0, 0, Math.PI / 2);
      if (w === 'chunky') for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; b.add(new THREE.BoxGeometry(Wd + 0.02, 0.1, 0.16), '#3a3440', x, Math.cos(a) * R, Math.sin(a) * R, 0, a, 0); }
      if (w === 'white') b.add(new THREE.CylinderGeometry(R * 0.82, R * 0.82, Wd + 0.02, 14), '#fbf7ee', x, 0, 0, 0, 0, Math.PI / 2);
      const rr = R * (w === 'white' ? 0.6 : 0.55);
      b.add(new THREE.CylinderGeometry(rr, rr, Wd + 0.04, 10), RIM[0], x, 0, 0, 0, 0, Math.PI / 2);
      if (RIM[2] === 1) b.add(new THREE.BoxGeometry(0.05, rr * 1.6, 0.12), RIM[1], face, 0, 0);
      else for (let k = 0; k < RIM[2]; k++) { const a = k / RIM[2] * Math.PI * 2; b.add(new THREE.BoxGeometry(0.05, rr * 0.9, rim === 'red' ? 0.05 : 0.09), RIM[1], face + s * 0.01, Math.cos(a) * rr * 0.45, Math.sin(a) * rr * 0.45, 0, a, 0); }
      b.add(new THREE.CylinderGeometry(0.08, 0.08, Wd + 0.08, 6), rim === 'blue' ? '#ffffff' : '#5a5260', x, 0, 0, 0, 0, Math.PI / 2);
    }
    return b.geometry();
  }
  // Front or rear bumper with a generic number plate.
  // (built on its mount: the mount's +z points out of the bus, front or back)
  function bumperGeometry(kind) {
    const b = BB.mk.builder(), z = 0, s = 1;
    const col = { std: '#46404e', chrome: '#dfe3ea', sport: '#2b2830', bull: '#3a3440' }[kind] || '#46404e';
    b.add(slab(2.6, 0.18, 0.5, 0.1, 0.1, 0.4, 0.06), col, 0, 0, z);
    if (kind === 'chrome') { b.box(2.5, 0.08, 0.06, '#ffffff', 0, 0.4, z + s * 0.2); b.box(2.5, 0.05, 0.06, '#aab2bf', 0, 0.22, z + s * 0.2); }
    if (kind === 'sport') {
      b.add(new THREE.BoxGeometry(2.62, 0.08, 0.5), P.coral, 0, 0.16, z + s * 0.12);          // lip spoiler
      for (const x of [-0.9, 0.9]) b.box(0.4, 0.12, 0.06, '#1c1a20', x, 0.28, z + s * 0.21);   // vents
    }
    if (kind === 'bull') {
      for (const x of [-1.0, -0.35, 0.35, 1.0]) b.box(0.12, 0.85, 0.12, '#55505e', x, 0.2, z + s * 0.38);
      b.box(2.3, 0.12, 0.12, '#55505e', 0, 0.95, z + s * 0.38); b.box(2.4, 0.14, 0.14, '#55505e', 0, 0.55, z + s * 0.38);
      for (const x of [-1.0, 1.0]) b.box(0.12, 0.12, 0.4, '#55505e', x, 0.55, z + s * 0.2);
    }
    b.box(0.7, 0.18, 0.04, '#fbf7ee', 0, 0.26, z + s * 0.22); b.box(0.5, 0.06, 0.02, '#3a3440', 0, 0.32, z + s * 0.24);
    return b.geometry();
  }
  // Extra lights on the front carriage (MeshBasic: they always look lit and glow at night).
  function lightGeometry(kind) {
    // (built on the lights mount at the front face: +z out of the bus)
    const b = BB.mk.builder(), zf = 0.06, ry = M && M.mounts.roof ? 0 : M ? M.roofY : 3.1;
    if (kind === 'led') { b.box(2.2, 0.07, 0.04, '#ffffff', 0, 1.14, zf); b.box(2.24, 0.03, 0.04, '#cfeaff', 0, 1.1, zf); }
    else if (kind === 'fog') for (const x of [-0.7, 0.7]) { b.add(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10), '#33303a', x, 0.34, 0.25, 0, Math.PI / 2); b.add(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10), '#ffc23a', x, 0.34, 0.27, 0, Math.PI / 2); }
    else if (kind === 'roof') {
      b.box(2.0, 0.12, 0.3, '#33303a', 0, ry, -0.35);
      for (let k = 0; k < 6; k++) b.box(0.26, 0.14, 0.06, k % 2 ? '#fff6c8' : '#ffffff', -0.85 + k * 0.34, ry, -0.18);
    }
    if (!b.parts.length) return new THREE.BufferGeometry();
    return b.geometry();
  }
  let glowTex = null;
  function glowMat() {
    if (!glowTex) {
      const c = document.createElement('canvas'); c.width = 64; c.height = 128;
      const x = c.getContext('2d'), gr = x.createRadialGradient(32, 64, 6, 32, 64, 62);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 64, 128); glowTex = new THREE.CanvasTexture(c);
    }
    return new THREE.MeshBasicMaterial({ map: glowTex, color: B.parts.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
  }
  // Fit a part: kind 'lights' | 'bumpers' | 'wheels' | 'rims', id from B.PARTS[kind]. For the underglow, opt = a
  // colour ('#rrggbb', or pick from B.GLOW_COLORS). Rebuilds only that part's small mesh(es).
  B.setPart = function (kind, id, opt) {
    if (!B.PARTS[kind]) return false;
    id = PART_ALIAS[id] || id;
    if (!B.PARTS[kind].some((p) => p.id === id)) id = B.PARTS[kind][0].id;
    B.parts[kind] = id;
    if (kind === 'lights' && typeof opt === 'string') B.parts.glow = opt;
    if (!B.front || !lightPart) return true;
    if (kind === 'bumpers') for (const m of [bumperF, bumperR]) { m.geometry.dispose(); m.geometry = m.parent ? bumperGeometry(id) : new THREE.BufferGeometry(); }
    if (kind === 'wheels' || kind === 'rims') {
      for (const w of wheelsF.concat(wheelsR)) { if (w.userData.busWheels === false) continue; w.geometry.dispose(); w.geometry = wheelGeometry(); w.material = BB.mk.mat; w.position.y = tyreR(); }
    }
    if (kind === 'lights') {
      lightPart.geometry.dispose(); lightPart.geometry = id === 'roof' ? new THREE.BufferGeometry() : lightGeometry(id);
      lightRoof.geometry.dispose(); lightRoof.geometry = id === 'roof' ? lightGeometry(id) : new THREE.BufferGeometry();
      for (const gl of glows) { gl.visible = id === 'underglow'; gl.material.color.set(B.parts.glow); }
    }
    return true;
  };
  // Apply the saved customisation: paint, headlights upgrade, stickers (save.stickers[0..2]; slot 2 needs the
  // super sticker upgrade) and the parts (save.parts = {lights, bumpers, wheels, rims, glow}).
  B.applyCustom = function (save) {
    save = save || BB.save;
    if (save.busType && save.busType !== B.type) B.setType(save.busType);
    if (save.routeNo != null && String(save.routeNo) !== B.routeNo) B.setRouteNumber(save.routeNo);
    B.assist = !!save.assist;
    B.setPaint(save.paint);
    const st = Array.isArray(save.stickers) ? save.stickers : [];
    for (let i = 0; i < 3; i++) {
      const want = i === 2 && !(save.upgrades && save.upgrades.sticker3) ? null : st[i] || null;
      if (stickerMeshes[i].want !== want) { B.setSticker(i, want); stickerMeshes[i].want = want; }
    }
    const ps = save.parts || {};
    for (const k of ['lights', 'bumpers', 'wheels', 'rims']) {
      const want = PART_ALIAS[ps[k]] || ps[k] || B.PARTS[k][0].id, glow = k === 'lights' ? ps.glow || B.parts.glow : undefined;
      if (B.parts[k] !== want || (k === 'lights' && glow !== B.parts.glow) || !partsApplied) B.setPart(k, want, glow);
    }
    partsApplied = true;
  };

  // ---------- tow truck (the jobs builder animates it) ----------
  // B.makeTowTruck() -> Group (forward +z, about 2.4 wide, 6.6 long) with userData: wheels [meshes, spin about x],
  // beacon (the flashing light), hook (an Object3D at the tow hook, behind the truck), update(dt, speed).
  let towCache = null;
  B.makeTowTruck = function () {
    if (towCache) {                                   // one truck, reused (no new GPU buffers per tow)
      const g = towCache;
      if (g.parent) g.parent.remove(g);
      g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.scale.set(1, 1, 1); g.visible = true;
      for (const w of g.userData.wheels) w.rotation.x = 0;
      return g;
    }
    const g = towCache = new THREE.Group(); g.name = 'towTruck';
    const b = BB.mk.builder();
    b.add(slab(2.3, 0.45, 1.3, 0.12, 0.15, 6.4), '#ff9a3c', 0, 0, -0.2);           // chassis
    b.add(slab(2.3, 1.2, 2.9, 0.45, 0.05, 2.4), '#ffb81f', 0, 0, 1.6);               // cab
    b.box(2.0, 0.9, 0.1, '#3f5f7d', 0, 1.6, 2.81);                                   // windscreen
    for (const s of [1, -1]) b.box(0.1, 0.8, 1.4, '#3f5f7d', s * 1.16, 1.65, 1.6);
    b.box(1.1, 0.5, 0.06, '#3a3440', 0, 0.72, 2.81);                                  // grille
    for (let k = 0; k < 3; k++) b.box(1.0, 0.05, 0.08, '#8a8492', 0, 0.8 + k * 0.13, 2.82);
    for (const s of [1, -1]) { b.box(0.4, 0.22, 0.06, '#fff6c8', s * 0.86, 0.9, 2.81); b.box(0.14, 0.22, 0.06, '#ffae3a', s * 1.1, 0.9, 2.815); }
    b.box(0.6, 0.16, 0.04, '#fbf7ee', 0, 0.3, 3.13);                                   // number plate
    for (const s of [1, -1]) { b.box(0.06, 0.4, 0.06, '#33303a', s * 1.25, 1.9, 2.5); b.box(0.16, 0.36, 0.08, '#2b2830', s * 1.32, 1.65, 2.55); }   // mirrors
    for (const s of [1, -1]) b.box(0.3, 0.3, 0.06, '#ff4a3a', s * 0.85, 0.75, -3.42);  // tail lights
    b.add(slab(2.4, 0.2, 0.55, 0.1, 0.1, 0.35, 0.05), '#5a5260', 0, 0, 2.95);
    // the crane boom and hook
    b.box(1.8, 0.3, 3.4, '#e9e2d6', 0, 1.3, -1.6);
    b.box(0.4, 1.4, 0.4, P.coral, 0, 1.6, -0.6);
    b.box(0.35, 0.35, 3.2, P.coral, 0, 2.7, -1.9, 0, -0.45);
    b.box(0.06, 1.2, 0.06, '#5a5260', 0, 2.0, -3.35);
    b.add(new THREE.TorusGeometry(0.22, 0.07, 4, 8, Math.PI * 1.4), '#5a5260', 0, 1.85, -3.35, Math.PI / 2);
    for (let k = 0; k < 4; k++) b.box(0.3, 0.12, 0.2, k % 2 ? '#3a2a3c' : P.honey, -0.45 + k * 0.3, 0.75, -3.42);
    const body = b.mesh(); g.add(body);
    const beaconM = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 0.4), new THREE.MeshBasicMaterial({ color: '#ff8a3d' }));   // light bar
    beaconM.position.set(0, 3.0, 1.6); g.add(beaconM);
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
        beaconM.material.color.set(on ? '#ffd45c' : '#ff6b2c');
      },
    };
    return g;
  };

  // ---------- placing the model ----------
  const _v = new THREE.Vector3();
  function rearPose() {
    const f = fwdOf(h), r = fwdOf(ART ? hr : h);
    const hx = fx - f.x * HITCH, hz = fz - f.z * HITCH;
    return { hx, hz, rx: hx - r.x * R_CTR, rz: hz - r.z * R_CTR, ax: hx - r.x * R_AXLE, az: hz - r.z * R_AXLE };
  }
  function placeModel() {
    const rp = rearPose();
    B.front.position.set(fx, gy, fz); B.front.rotation.y = h;
    if (ART) { B.rear.position.set(rp.rx, gy, rp.rz); B.rear.rotation.y = hr; } else { hr = h; B.rear.position.set(fx, gy, fz); B.rear.rotation.y = h; }
    if (jointF) { jointF.position.set(rp.hx, gy, rp.hz); jointF.rotation.y = jointR ? h : h + wrapA(hr - h) / 2; }
    if (jointR) { jointR.position.set(rp.hx, gy, rp.hz); jointR.rotation.y = hr; }
    // a little wobble after a bump
    if (wobble > 0) { const w = Math.sin(clock * 30) * wobble * 0.05; B.front.rotation.z = w; if (ART) B.rear.rotation.z = -w * 0.7; }
    else { B.front.rotation.z = 0; if (ART) B.rear.rotation.z = 0; }
    B.pos.copy(B.front.position); B.heading = h;
  }

  // ---------- roads: nearest point, route along the graph, left-lane polyline ----------
  // Nearest point on the road graph to (x,z): {edge, s (from the edge's a end), x, z, dx, dz (a->b), d}.
  // With a heading hh, roads running across the bus count as further away (so a bus in a junction, lined up with
  // one of its roads, is taken to be on that road and not on the cross street).
  function nearestRoad(x, z, hh) {
    let best = null, bestS = Infinity;
    const f = hh == null ? null : fwdOf(hh);
    for (const e of W().roads.edges) {
      const p = e.points;
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], c = p[i], dx = c.x - a.x, dz = c.z - a.z, l2 = dx * dx + dz * dz || 1;
        const t = BB.clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
        const qx = a.x + dx * t, qz = a.z + dz * t, d = Math.hypot(qx - x, qz - z);
        const l = Math.sqrt(l2), sc = f ? d + 8 * (1 - Math.abs(f.x * dx + f.z * dz) / l) : d;
        if (sc < bestS) { bestS = sc; best = { edge: e, s: e.cum[i - 1] + t * l, x: qx, z: qz, dx: dx / l, dz: dz / l, d }; }
      }
    }
    return best;
  }
  B.nearestRoad = nearestRoad;
  // Centre-line polyline from the road point nearest the bus to the target's parking spot, approaching in the stop's
  // travel direction. Returns {pts, sign} or null.
  function routeTo(stop) {
    const here = nearestRoad(fx, fz, h);
    if (!here) return null;
    const te = W().edge(stop.edge), entry = stop.dir > 0 ? te.a : te.b;
    const tAlong = stop.dir > 0 ? stop.s + 3 : te.length - stop.s + 3;   // distance from the entry node to the nose spot
    const e = here.edge;
    const pts = [{ x: here.x, z: here.z }];
    // already on the target's edge, behind the stop in its direction: straight there
    const along = stop.dir > 0 ? here.s : e.length - here.s;
    const fd = fwdOf(h), withStop = (fd.x * here.dx + fd.z * here.dz) * stop.dir;   // > 0: facing the stop's way
    if (e === te && along < tAlong - 1 && withStop > -0.3) {
      const s1 = stop.dir > 0 ? stop.s + 3 : stop.s - 3;
      addEdgePart(pts, te, here.s, s1);
      return pts;
    }
    // Dijkstra over directed states (an edge driven one way, ending at its far junction). Turning round costs extra
    // (at the start if the bus faces the other way, and as a U-turn at a junction), so the ribbon prefers to carry
    // on the way the bus faces unless going round would be much longer.
    const f = fwdOf(h), facing = f.x * here.dx + f.z * here.dz, TURN = 300, UTURN = 1500;   // turning round is hard in a bendy bus: go round the block instead
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
  // The kerb lane's radius on a left turn: at least 6, and roomy enough for this bus's tightest turn.
  const turnIn = () => Math.max(6, WB / Math.tan(MAX_STEER + 0.22 * (1 - 3.2 / 4)) + 1.5);   // (at the helper's turning speed)
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
    // junction corners (a sharp bend at one point) are rounded with a circular fillet, so the kerb lane of a left turn
    // is about 6 round or more (turnIn(): each bus can follow it) and the line never folds
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const corners = [];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], p = pts[i], c = pts[i + 1];
      const ix = p.x - a.x, iz = p.z - a.z, ox = c.x - p.x, oz = c.z - p.z, li = Math.hypot(ix, iz), lo = Math.hypot(ox, oz);
      if (li < 1e-3 || lo < 1e-3) continue;
      const cs = (ix * ox + iz * oz) / (li * lo);
      if (cs > 0.9) continue;                                                      // gentle (an arc's own bends)
      const half = Math.tan(Math.acos(BB.clamp(cs, -1, 1)) / 2);
      // (a left turn starts a little earlier: it swings out toward the middle of the road, see below)
      const lft = (ox * iz - oz * ix) / (li * lo) > 0.2;
      const t = Math.min((C.lane + turnIn() + (lft ? 2 : 0)) * half, cum[i] * 0.95, (cum[cum.length - 1] - cum[i]) / 2);
      if (corners.length && cum[i] - t < corners[corners.length - 1].s1) continue;
      corners.push({ i, s0: cum[i] - t, s1: cum[i] + t, t, ux: ix / li, uz: iz / li, vx: ox / lo, vz: oz / lo });
    }
    // a point and the line's direction at distance s along it (the fillet's ends sit on the line itself, even
    // where it comes off one of the loop's curves)
    const at = (sv) => {
      let i = 1; while (i < pts.length - 1 && cum[i] < sv) i++;
      const l = (cum[i] - cum[i - 1]) || 1, u = BB.clamp((sv - cum[i - 1]) / l, 0, 1);
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * u, dx: (pts[i].x - pts[i - 1].x) / l, dz: (pts[i].z - pts[i - 1].z) / l };
    };
    const out = [];
    let ci = 0;
    for (let i = 0; i < pts.length; i++) {
      const c = corners[ci];
      if (c && cum[i] >= c.s0) {
        // a cubic curve tangent to the line at both ends, shaped like a circular arc (handles 4/3 tan(turn/4) R)
        const A = at(c.s0 + 1e-3), Bq = at(c.s1 - 1e-3);
        const th = Math.acos(BB.clamp(A.dx * Bq.dx + A.dz * Bq.dz, -1, 1)), ch = Math.hypot(Bq.x - A.x, Bq.z - A.z);
        const R = th > 1e-3 ? ch / (2 * Math.sin(th / 2)) : ch, hl = th > 1e-3 ? 4 / 3 * Math.tan(th / 4) * R : ch / 3;
        const P1 = { x: A.x + A.dx * hl, z: A.z + A.dz * hl }, P2 = { x: Bq.x - Bq.dx * hl, z: Bq.z - Bq.dz * hl };
        // (a corner point just short of the curve would fold the kerb lane once it is moved over: drop it)
        while (out.length > 1 && Math.hypot(out[out.length - 1].x - A.x, out[out.length - 1].z - A.z) < 2.5) out.pop();
        // a left turn (toward the kerb) swings out toward the middle of the road, as a bus does, so its inside rear
        // doesn't run over the junction's corner: the offset eases out and back (sin squared: no kink where it starts,
        // so the bend has no tight ends)
        const left = Bq.dx * A.dz - Bq.dz * A.dx > 0.2, sw = left ? Math.min(3.6, 3.6 * th / (Math.PI / 2)) : 0;
        for (let k = 0; k <= 12; k++) {
          const t = k / 12, m = 1 - t, sn = Math.sin(Math.PI * t);
          out.push({ x: m * m * m * A.x + 3 * m * m * t * P1.x + 3 * m * t * t * P2.x + t * t * t * Bq.x, z: m * m * m * A.z + 3 * m * m * t * P1.z + 3 * m * t * t * P2.z + t * t * t * Bq.z, o: C.lane - sw * sn * sn });
        }
        while (i < pts.length - 1 && cum[i + 1] <= c.s1 + 2.5 && i + 1 < pts.length - 1) i++;
        ci++; continue;
      }
      out.push(pts[i]);
    }
    for (let i = out.length - 1; i > 0; i--) if (Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z) < 0.2) out.splice(i, 1);   // no zero-length steps
    // into the kerb (left) lane: each point moved left of the way by its own offset (C.lane, less in a left turn)
    return out.map((q, i) => {
      const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const o = q.o != null ? q.o : C.lane;
      return { x: q.x + dz * o, z: q.z - dx * o };
    });                   // the kerb (left) lane
  }

  // ---------- camera ----------
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let orbit = 0.6, camH = 0, stopCam = null;
  function midPoint() { if (!ART) return { x: fx, z: fz }; const r = B.rear.position; return { x: (fx + r.x) / 2, z: (fz + r.z) / 2 }; }
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
  // ---------- the stop camera ----------
  // The screen space left for the bus at a stop: tablets have the question card along the bottom, phones held
  // sideways (500 px tall or less) a column on the left; the coins/fuel HUD runs along the top.
  function stopFrameRect() {
    const w = innerWidth, hh = innerHeight;
    if (hh <= 520) return { x0: Math.min(352, w * 0.54), y0: 66, x1: w - 10, y1: hh - 8 };
    return { x0: 14, y0: 80, x1: w - 14, y1: hh - Math.min(250, hh * 0.34) - 10 };
  }
  const fitCam = new THREE.PerspectiveCamera(50, 1, 0.5, 900), _p = new THREE.Vector3(), _q = new THREE.Vector3();
  // Plan the stop view for stop st: the points that must show (every seat with its head and number bubble, both doors),
  // the ones that should (the pavement by the exit door where people wave, then the whole bus), fitted into the free
  // space beside the card with the heads well apart. A true side-on view first; where a building blocks it, closer,
  // then a little along the kerb, then from higher up looking down over the building.
  function planStopCam(st, key) {
    const P0 = settle && settle.stop === st ? settle.to : { fx, fz, h };
    const c = Math.cos(P0.h), s = Math.sin(P0.h), kx = c, kz = -s, f = fwdOf(P0.h), g0 = W().groundY(P0.fx, P0.fz);
    const lw = (lx, ly, lz) => new THREE.Vector3(P0.fx + c * lx + s * lz, ly + g0, P0.fz - s * lx + c * lz);
    const heads = [], req = [], wave = [];
    const NS = B.seats.length;
    for (let i = 0; i < NS; i++) {
      const q = B.seats[i];
      heads.push(lw(q.x, q.y + 1.0, q.z)); req.push(lw(q.x, q.y + 2.25, q.z), lw(q.x, q.y - 0.4, q.z));
    }
    if (!NS) {                                                                // a vehicle with no seats: its whole body
      const Hb0 = M ? M.height : 3, tl = ART ? -(HITCH + R_CTR + LR / 2) : -LF / 2;
      for (const z of [LF / 2, tl]) req.push(lw(1.2, 0, z), lw(1.2, Hb0, z), lw(-1.2, Hb0, z));
    }
    // a job's scene: world points that must show too (firefighters, the hooked car, the ice cream queue)
    if (st && Array.isArray(st.frame)) for (const q of st.frame) if (q) req.push(new THREE.Vector3(+q.x || 0, (+q.y || 0) + g0, +q.z || 0));
    const iDoor = req.length;
    const dl = M ? M.doorLocal : { x: 1.6, z: LF / 2 - 1 };
    req.push(lw(dl.x, 0, dl.z), lw(dl.x, 2.5, dl.z));
    // the exit door in the front carriage's frame (a bendy's is on the rear carriage, straight behind at the bay)
    let ex = { x: dl.x, z: dl.z };
    const d1 = doors[1] || doors[0];
    if (d1 && d1.parent) {
      d1.parent.updateMatrixWorld(true); B.front.updateMatrixWorld(true);
      d1.parent.localToWorld(_p.set(Math.abs(d1.userData.x) + 0.35, 0, d1.userData.z));
      const rearSide = ART && (function (o) { for (; o; o = o.parent) { if (o === B.rear) return true; if (o === B.front) return false; } return false; })(d1);
      if (rearSide) {           // rear carriage: its frame straight behind the hitch
        B.rear.worldToLocal(_p); ex = { x: _p.x, z: _p.z - (HITCH + R_CTR) };
      } else { B.front.worldToLocal(_p); ex = { x: _p.x, z: _p.z }; }
    }
    req.push(lw(ex.x, 0, ex.z), lw(ex.x, 2.5, ex.z));
    req.push(lw(0.6, 0.3, LF / 2 + 0.35), lw(0.6, 2.8, LF / 2 + 0.35));     // the nose too (clear of the card on small phones)
    for (const al of [1.2, -1.6]) wave.push(lw(ex.x + 2.6, 0, ex.z + al), lw(ex.x + 2.6, 2.3, ex.z + al));
    const cam = BB.camera, R = stopFrameRect(), Wd = innerWidth, Hd = innerHeight;
    fitCam.fov = cam.fov; fitCam.aspect = cam.aspect; fitCam.updateProjectionMatrix();
    const aw = Math.max(80, R.x1 - R.x0), ah = Math.max(80, R.y1 - R.y0), rx = (R.x0 + R.x1) / 2, ry = (R.y0 + R.y1) / 2;
    const tanV = Math.tan(THREE.MathUtils.degToRad(fitCam.fov) / 2);
    const proj = (v) => { _q.copy(v).project(fitCam); return [(_q.x + 1) / 2 * Wd, (1 - _q.y) / 2 * Hd, _q.z]; };
    const box = (pts) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const v of pts) { const p = proj(v); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };
    // the centre of what must show
    let tx = 0, ty = 0, tz = 0; for (const v of req) { tx += v.x; ty += v.y; tz += v.z; } tx /= req.length; ty /= req.length; tz /= req.length;
    const T = new THREE.Vector3(tx, ty, tz), right = new THREE.Vector3(), up = new THREE.Vector3(), dir = new THREE.Vector3();
    // a camera looking along (yaw from straight at the kerb side, pitch down) from distance d, slid in its own
    // picture plane so the box of pts sits in the middle of the free space
    function place(yaw, pitch, d, pts) {
      const hx = -(kx * Math.cos(yaw) - f.x * Math.sin(yaw)), hz = -(kz * Math.cos(yaw) - f.z * Math.sin(yaw));
      dir.set(hx * Math.cos(pitch), -Math.sin(pitch), hz * Math.cos(pitch));
      fitCam.position.copy(T).addScaledVector(dir, -d);
      fitCam.lookAt(T); fitCam.updateMatrixWorld(true);
      const look = T.clone();
      for (let it = 0; it < 3; it++) {
        const bx = box(pts), u = d * tanV / (Hd / 2);           // world units per pixel at the bus
        right.setFromMatrixColumn(fitCam.matrixWorld, 0); up.setFromMatrixColumn(fitCam.matrixWorld, 1);
        const mx = -((rx - (bx.x0 + bx.x1) / 2) * u), my = (ry - (bx.y0 + bx.y1) / 2) * u;
        fitCam.position.addScaledVector(right, mx).addScaledVector(up, my); look.addScaledVector(right, mx).addScaledVector(up, my);
        if (fitCam.position.y < g0 + 1.3) { const dy = g0 + 1.3 - fitCam.position.y; fitCam.position.y += dy; look.y += dy; }
        fitCam.updateMatrixWorld(true);
      }
      return look;
    }
    // the distance at which pts fill the free space (to about 90%), and at which neighbouring heads are 36 px apart
    function fitD(yaw, pitch, pts) {
      let d = 14;
      for (let it = 0; it < 4; it++) { place(yaw, pitch, d, pts); const bx = box(pts); d = BB.clamp(d * Math.max(bx.w / (aw * 0.93), bx.h / (ah * 0.9)), 4, 60); }
      return d;
    }
    function spacingD(yaw, pitch) {
      const d = 14; place(yaw, pitch, d, req);
      return d * headGap() / 36;
    }
    // the whole bus (nose to tail, wheels to roof), shown when it fits with the heads still well apart
    const Hb = M ? M.height : 3.2, tail = ART ? -(HITCH + R_CTR + LR / 2) : -LF / 2, whole = [];
    for (const z of [LF / 2 + 0.3, tail - 0.3]) whole.push(lw(1.3, 0, z), lw(1.3, Hb + 0.2, z));
    const reqWave = req.concat(wave), all = reqWave.concat(whole);
    function plan(yaw, pitch, minD, withWave) {
      const dReq = fitD(yaw, pitch, req);
      let pts = req, d = dReq;
      if (withWave) {                          // the waving spot (and the whole bus) too, if the heads stay 36 px apart
        const lim = Math.max(dReq * 1.08, spacingD(yaw, pitch));
        for (const more of [all, reqWave]) { const dm = fitD(yaw, pitch, more); if (dm <= lim) { pts = more; d = dm; break; } }
      }
      d = Math.max(d, minD);
      const look = place(yaw, pitch, d, pts);
      return { pos: fitCam.position.clone(), look, d, gap: headGap() };
    }
    // the smallest on-screen gap between neighbouring heads (in a row, and across the two rows) for fitCam as it is
    function headGap() {
      const hp = heads.map(proj); let mn = 1e9;
      if (heads.length < 2) return 99;
      for (let i = 0; i < heads.length; i++) for (let j = i + 1; j < heads.length; j++) {
        if ((i < 5) === (j < 5) ? j - i !== 1 : Math.abs((i % 5) - (j % 5)) > 1) continue;
        mn = Math.min(mn, Math.hypot(hp[i][0] - hp[j][0], hp[i][1] - hp[j][1]));
      }
      return mn;
    }
    const mid = lw(0, 2.2, -frontOff());
    const checks = [heads[0], heads[4], heads[heads.length - 1], req[iDoor], req[iDoor + 1], req[iDoor + 2], req[iDoor + 3], mid].filter(Boolean);
    const clear = (p) => {
      if (W().insideTall(p.pos.x, p.pos.y, p.pos.z)) return false;
      for (const v of checks) if (W().blocksSight(p.pos.x, p.pos.y, p.pos.z, v.x, v.y, v.z)) return false;
      if (underViaduct(p.pos.x, p.pos.z) && p.pos.y > 10.2) return false;
      return true;
    };
    const D2R = Math.PI / 180;
    // [yaw, pitch, nearest distance]: not too close first (people on the pavement would loom large), then closer;
    // then a little along the kerb; then higher up, looking down over the building in the way
    const far = Hd <= 520 ? 9 : 12, near = Hd <= 520 ? 7.5 : 9.5, cands = [];
    for (const pitch of [15, 22, 30, 38]) cands.push([0, pitch, far, true]);
    for (const pitch of [15, 22, 30, 38]) cands.push([0, pitch, near, true]);
    for (const pitch of [15, 22, 30, 38]) cands.push([0, pitch, near, false]);
    for (const yaw of [10, -10]) for (const pitch of [15, 24]) cands.push([yaw, pitch, near, false]);
    for (const pitch of [38, 46, 54, 62]) cands.push([0, pitch, near, true]);
    for (const yaw of [18, -18]) for (const pitch of [24, 40]) cands.push([yaw, pitch, near, false]);
    // the first clear one whose neighbouring heads are well apart; on a small screen where none is, the clear one
    // with the most room between the heads (a steeper look lifts the far row above the near one)
    let pick = null, best = null;
    for (const [yaw, pitch, md, wv] of cands) {
      const p = plan(yaw * D2R, pitch * D2R, md, wv);
      if (!clear(p)) continue;
      if (p.gap >= 34) { pick = p; break; }
      if (!best || (p.gap > best.gap * 1.2 && pitch <= 38)) best = p;   // (not steeper than that for a little more room)
    }
    pick = pick || best || plan(0, 62 * D2R, near, true);
    return { key, pos: pick.pos, look: pick.look };
  }
  // ---------- the garage cameras ----------
  // Each view is planned once per bus type and screen size in the front carriage's own frame (+z forward, +x the
  // kerb side; the garage shed stands on the kerb side, so the views look from the road side, the front and the back;
  // the front ones from the kerb side of the nose, so depot.js's fuel pump, ahead on the road side, isn't in the way),
  // fitted into the space left of the garage panel (min(500px, 56vw) wide, with the Drive button at its foot) and
  // below the coins and fuel. Every frame the planned spot goes through B.front's world matrix, so the view rides
  // along with depot.js's swaying turntable lift. A change of view is an eased move round the bus on the road side.
  //   garageWhole  the whole bus, front three-quarter (type, colour); a slow little orbit
  //   garageFront  front three-quarter close from the kerb side: headlights, bumper, windscreen (lights, bumpers)
  //   garageWheels low side view on the front wheel (wheels, rims)
  //   garageSide   the body side and the roof edge, a little from above (stickers: the slots are on both sides)
  //   garageSign   the route number display by the front door (and the front one), from the kerb side of the nose
  //                (the bus number keypad)
  //   garageRear   rear three-quarter: tail lights and rear bumper
  // 'depot', 'depotClose' and 'depotSide' are the old names for garageWhole, garageFront and garageWheels.
  const GARAGE = { garageWhole: 1, garageFront: 1, garageWheels: 1, garageSide: 1, garageSign: 1, garageRear: 1, depot: 'garageWhole', depotClose: 'garageFront', depotSide: 'garageWheels' };
  const D2R_ = Math.PI / 180;
  let gplans = {}, gcam = null, gclock = 0;
  function garageRect() {
    const w = innerWidth, hh = innerHeight, pw = Math.min(500, w * 0.56), phone = hh <= 560;
    return { x0: 12, y0: phone ? 66 : 92, x1: w - pw - 14, y1: hh - (phone ? 10 : 16) };
  }
  // The points a view must show, in the front carriage's frame, and how it looks at them: phi = round from the road
  // side (0) toward the front (90; -90 the back), pitch = degrees down, fill = share of the free space to use.
  function garageSpec(mode) {
    const Hb = M ? M.height : 3.2, nose = LF / 2 + 0.15, tail = ART ? -(HITCH + R_CTR + LR / 2) - 0.15 : -LF / 2 - 0.15;
    const box = (x0, x1, y0, y1, z0, z1) => { const o = []; for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) o.push([x, y, z]); return o; };
    const axle = LF / 2 - FRONT_AXLE, signY = Math.min(2.86, Hb - 0.6);
    switch (mode) {
      case 'garageWhole': return { phi: 27, pitch: 15, fill: 0.84, pts: box(-1.3, 1.3, 0, Hb + 0.1, tail, nose + 0.3), orbit: 7 };
      case 'garageFront': return { phi: 145, pitch: 9, fill: 0.86, pts: box(-1.35, 1.35, 0.15, Math.min(Hb, 3.35), nose - 1.8, nose + 0.4) };
      case 'garageWheels': return { phi: 14, pitch: 4, fill: 0.78, pts: box(-1.3, -1.25, 0, 1.45, axle - 1.25, axle + 1.25), minY: 0.75 };
      case 'garageSide': return { phi: 4, pitch: 27, fill: 0.9, pts: box(-1.3, -1.3, 0, Hb, tail, nose).concat(box(0, 1.2, Hb, Hb, tail, nose)) };
      case 'garageSign': {        // the route number by the front door (the display above the windscreen too)
        const dz = M && M.doorLocal ? M.doorLocal.z : LF / 2 - 1, zc = dz - 1.45, wy = Math.min(2.84, Hb - 0.7) - 0.36;
        return { phi: 122, pitch: 2, fill: 0.62, pts: box(1.3, 1.3, wy - 0.15, wy + 0.45, zc - 0.85, zc + 0.85).concat(box(0.4, 1.3, signY - 0.1, signY + 0.4, nose - 0.1, nose)) };
      }
      case 'garageRear': return { phi: -48, pitch: 12, fill: 0.86, pts: box(-1.35, 1.35, 0.15, Hb, tail, tail + 2.0) };
    }
    return null;
  }
  // Fit a view: camera spot and look-at point in the front carriage's frame.
  const gCam = new THREE.PerspectiveCamera(50, 1, 0.3, 900), _g1 = new THREE.Vector3();
  // Plan a view; where it would stand in (or look through) the garage shed or another building, turn it toward the
  // bus's nose (kerb-side views) or raise it, a step at a time.
  function planGarage(mode) {
    const sp = garageSpec(mode);
    if (B.group) B.group.updateMatrixWorld(true);
    const mw = B.front.matrixWorld, w = new THREE.Vector3(), t = new THREE.Vector3();
    let first = null;
    // in the workshop, stay under its roof (about 9.4 up): a lower look where the view would be from above it
    if (B.inWorkshop) {
      for (let pt = sp.pitch; pt >= -2; pt -= 4) {
        const pl = fitGarage(Object.assign({}, sp, { pitch: pt }));
        w.copy(pl.pos).applyMatrix4(mw);
        if (w.y < 8.4 || pt <= -2) return pl;
      }
    }
    for (let k = 0; k < 9; k++) {
      const s2 = Object.assign({}, sp, { phi: sp.phi > 90 ? Math.max(90, sp.phi - 7 * k) : sp.phi, pitch: sp.phi > 90 ? sp.pitch + 2 * k : sp.pitch + 6 * k });
      const pl = fitGarage(s2);
      first = first || pl;
      w.copy(pl.pos).applyMatrix4(mw); t.copy(pl.centre).applyMatrix4(mw);
      if (!W().insideTall(w.x, w.y, w.z) && !W().blocksSight(w.x, w.y, w.z, t.x, t.y, t.z)) return pl;
    }
    return first;
  }
  function fitGarage(sp) {
    const cam = BB.camera, R = garageRect(), Wd = innerWidth, Hd = innerHeight;
    gCam.fov = cam.fov; gCam.aspect = cam.aspect; gCam.near = 0.3; gCam.updateProjectionMatrix();
    const pts = sp.pts.map((q) => new THREE.Vector3(q[0], q[1], q[2]));
    const T = new THREE.Vector3(); for (const v of pts) T.add(v); T.multiplyScalar(1 / pts.length);
    const aw = Math.max(60, R.x1 - R.x0), ah = Math.max(60, R.y1 - R.y0), rx = (R.x0 + R.x1) / 2, ry = (R.y0 + R.y1) / 2;
    const tanV = Math.tan(THREE.MathUtils.degToRad(gCam.fov) / 2), right = new THREE.Vector3(), up = new THREE.Vector3();
    const phi = sp.phi * D2R_, pitch = sp.pitch * D2R_;
    const u = new THREE.Vector3(-Math.cos(phi) * Math.cos(pitch), Math.sin(pitch), Math.sin(phi) * Math.cos(pitch));   // target -> camera
    const box = () => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const v of pts) { _g1.copy(v).project(gCam); const px = (_g1.x + 1) / 2 * Wd, py = (1 - _g1.y) / 2 * Hd; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); } return { x0, x1, y0, y1 }; };
    let d = 12, look = T.clone();
    const place = () => {
      gCam.position.copy(T).addScaledVector(u, d); look.copy(T); gCam.lookAt(look); gCam.updateMatrixWorld(true);
      for (let it = 0; it < 3; it++) {
        const bx = box(), k = d * tanV / (Hd / 2);
        right.setFromMatrixColumn(gCam.matrixWorld, 0); up.setFromMatrixColumn(gCam.matrixWorld, 1);
        const mx = -(rx - (bx.x0 + bx.x1) / 2) * k, my = (ry - (bx.y0 + bx.y1) / 2) * k;
        gCam.position.addScaledVector(right, mx).addScaledVector(up, my); look.addScaledVector(right, mx).addScaledVector(up, my);
        const minY = sp.minY != null ? sp.minY : 0.6;
        if (gCam.position.y < minY) { const dy = minY - gCam.position.y; gCam.position.y += dy; look.y += dy; }
        gCam.updateMatrixWorld(true);
      }
    };
    for (let it = 0; it < 5; it++) { place(); const bx = box(); d = BB.clamp(d * Math.max((bx.x1 - bx.x0) / (aw * sp.fill), (bx.y1 - bx.y0) / (ah * sp.fill)), 2.5, 60); }
    place();
    return { pos: gCam.position.clone(), look: look.clone(), centre: T.clone(), orbit: sp.orbit || 0 };
  }
  function garagePlan(mode) {
    const m = GARAGE[mode] === 1 ? mode : GARAGE[mode], key = m + '|' + B.type + '|' + innerWidth + 'x' + innerHeight + '|' + BB.camera.fov + '|' + (B.inWorkshop ? 'ws' : 'x');
    if (!gplans[key]) gplans[key] = planGarage(m);
    return gplans[key];
  }
  // The view's spot this frame (with the slow orbit), in the front carriage's frame.
  function garageLocal(mode, outPos, outLook) {
    const pl = garagePlan(mode);
    outPos.copy(pl.pos); outLook.copy(pl.look);
    if (pl.orbit) {
      const a = Math.sin(gclock * 0.22) * pl.orbit * D2R_, c = Math.cos(a), s2 = Math.sin(a), C0 = pl.centre;
      for (const v of [outPos, outLook]) { const x = v.x - C0.x, z = v.z - C0.z; v.x = C0.x + x * c + z * s2; v.z = C0.z - x * s2 + z * c; }
    }
  }
  const _gp = new THREE.Vector3(), _gl = new THREE.Vector3();
  function garageTarget(mode, outPos, outLook) {
    garageLocal(mode, _gp, _gl);
    if (B.group) B.group.updateMatrixWorld(true);
    outPos.copy(_gp).applyMatrix4(B.front.matrixWorld); outLook.copy(_gl).applyMatrix4(B.front.matrixWorld);
  }
  // An eased move (about 1.2 s) from wherever the camera is to the new view: round the bus's middle on the road
  // side (never through the bus, never across the kerb side where the shed stands), then it rides with the bus.
  function garageUpdate(dt) {
    gclock += dt;
    if (B.group) B.group.updateMatrixWorld(true);
    const mw = B.front.matrixWorld, inv = new THREE.Matrix4().copy(mw).invert();
    const mode = B.camMode, key = mode + '|' + innerWidth + 'x' + innerHeight + '|' + B.type;
    if (!gcam || gcam.key !== key) {
      const fromPos = BB.camera.position.clone().applyMatrix4(inv), fromLook = curLook.clone().applyMatrix4(inv);
      const same = gcam && GARAGE[gcam.mode] && (GARAGE[gcam.mode] === 1 ? gcam.mode : GARAGE[gcam.mode]) === (GARAGE[mode] === 1 ? mode : GARAGE[mode]) && gcam.type === B.type;
      gcam = { key, mode, type: B.type, fromPos, fromLook, t: same ? 1 : 0, dur: 1.25 };
    }
    garageLocal(mode, _gp, _gl);
    gcam.t = Math.min(1, gcam.t + dt / gcam.dur);
    const e = gcam.t < 1 ? gcam.t * gcam.t * (3 - 2 * gcam.t) : 1;
    const cz = ((LF / 2) + (ART ? -(HITCH + R_CTR + LR / 2) : -LF / 2)) / 2;   // the bus's middle along it
    let px, py, pz;
    if (e >= 1) { px = _gp.x; py = _gp.y; pz = _gp.z; }
    else {
      // angle round the middle measured from the road side (-x), so the kerb side (+-180) is never crossed
      const ang = (v) => Math.atan2(v.z - cz, -v.x), a0 = ang(gcam.fromPos), a1 = ang(_gp);
      const r0 = Math.hypot(gcam.fromPos.x, gcam.fromPos.z - cz), r1 = Math.hypot(_gp.x, _gp.z - cz);
      const a = a0 + (a1 - a0) * e, r = r0 + (r1 - r0) * e;
      px = -Math.cos(a) * r; pz = cz + Math.sin(a) * r; py = gcam.fromPos.y + (_gp.y - gcam.fromPos.y) * e;
      // never inside (or skimming) the bus: over it instead
      const Hb = M ? M.height : 3.2, halfL = (LF / 2) - cz + 1.4;
      if (Math.abs(px) < 2.4 && Math.abs(pz - cz) < halfL && py < Hb + 1.2) py = Hb + 1.2;
    }
    const lx = gcam.fromLook.x + (_gl.x - gcam.fromLook.x) * e, ly = gcam.fromLook.y + (_gl.y - gcam.fromLook.y) * e, lz = gcam.fromLook.z + (_gl.z - gcam.fromLook.z) * e;
    BB.camera.position.set(px, py, pz).applyMatrix4(mw);
    curLook.set(lx, ly, lz).applyMatrix4(mw);
    BB.camera.lookAt(curLook);
  }
  function desiredCamera(dt) {
    const mode = B.camMode;
    const m = midPoint(), mx = m.x, mz = m.z;
    let maxUp = 30;
    if (mode === 'title') {
      // swing gently on the road side of the bus (never through the buildings beside it)
      orbit += dt * 0.25;
      const kx = Math.cos(h), kz = -Math.sin(h), f = fwdOf(h);
      if (B.inWorkshop) {
        // (from the road side of the bus's nose, inside the open shed, looking down and out across the yard to the
        // sea: only a thin strip of the roof shows above the title; on wide, short screens the bus sits lower)
        const wideS = BB.camera.aspect > 1.6;
        const tc = wideS ? { fo: 23, so: 14, y: 8.6, lf: -6, ls: -6, ly: 0.4, sw: 0.5 } : { fo: 15, so: 11.5, y: 7.5, lf: -6, ls: -5, ly: 0, sw: 1.2 };
        // (a small vehicle, a taxi or a van, gets the same view from closer)
        const sc = BB.clamp(totalLen() / 10.8, 0.55, 1), sw = Math.sin(orbit) * tc.sw * sc, s2 = Math.sin(orbit * 0.7) * 0.25;
        const fo = tc.fo * sc + sw, so = tc.so * sc - sw, cy = 1.2 + (tc.y - 1.2) * sc, ly = tc.ly * sc;
        camPos.set(mx + f.x * fo - kx * so, cy + s2, mz + f.z * fo - kz * so);
        camLook.set(mx + f.x * tc.lf * sc - kx * tc.ls * sc, ly, mz + f.z * tc.lf * sc - kz * tc.ls * sc);
      } else {
        const a = 0.75 + Math.sin(orbit) * 0.35;
        camPos.set(mx + (f.x * Math.cos(a) - kx * Math.sin(a)) * 21, 8 + Math.sin(orbit * 0.7), mz + (f.z * Math.cos(a) - kz * Math.sin(a)) * 21);
        camLook.set(mx, 1.6, mz);
      }
    } else if (GARAGE[mode]) {
      // the garage views (planned in the bus's own frame, so they follow depot.js's turntable)
      garageTarget(mode, camPos, camLook); return;
    } else if (B.atStop || settle) {
      // at a stop: side-on from the pavement, looking at the kerb side (the doors): the kerb wall fades (dollhouse),
      // so both rows of seats, both doors and the pavement are in view. Worked out once per stop (and screen size)
      // from this bus's seats and doors and the screen space beside the question card, then held still.
      const st = B.atStop || (settle && settle.stop), key = st.id + '|' + B.type + '|' + innerWidth + 'x' + innerHeight + '|' + (B.atStop ? 1 : 0) + '|' + (st.frameKey || (st.frame ? st.frame.length : 0));
      if (!stopCam || stopCam.key !== key) stopCam = planStopCam(st, key);
      camPos.copy(stopCam.pos); camLook.copy(stopCam.look);
    } else {
      // chase: behind and above the front carriage, trailing its heading smoothly
      camH += wrapA(h - camH) * Math.min(1, dt * 2.2);
      const wide = BB.camera.aspect > 1.9;
      let back = (wide ? 19 : 17) + Math.max(0, B.speed) * 0.25;
      let up = wide ? 12.5 : 11.5;
      // a look at something (B.lookAt): swing round toward it (up to ~65 degrees) and tilt up for things in the sky
      let ch = camH, lk = null;
      const kL = look && look.target ? BB.smooth(lookK) : 0;
      if (kL > 0) {
        lk = lookPoint();
        const az = Math.atan2(lk.x - fx, lk.z - fz), dA = BB.clamp(wrapA(az - camH), -1.15, 1.15);
        ch = camH + dA * 0.75 * kL;
        const high = BB.clamp((lk.y - 6) / 30, 0, 1);
        up -= (4.5 * high + 1.0) * kL; back += 3 * kL;
      }
      const f = fwdOf(ch);
      // pull in a little if the camera would be inside a building
      for (let k = 0; k < 4; k++) {
        const px = fx - f.x * back, pz = fz - f.z * back, q = W().pushOut(px, pz, 1.5);
        if (q.hit < 0.01) break;
        back *= 0.78;
      }
      camPos.set(fx - f.x * back, up, fz - f.z * back);
      camLook.set(fx + f.x * (wide ? 2 : 5), 0, fz + f.z * (wide ? 2 : 5));
      if (kL > 0) {
        // look part of the way toward it (the bus stays in the picture), never higher than 20 up
        const w = 0.55 * kL;
        camLook.set(camLook.x + (lk.x - camLook.x) * w * 0.6, Math.min(20, camLook.y + (lk.y - camLook.y) * w * 0.75), camLook.z + (lk.z - camLook.z) * w * 0.6);
      }
    }
    if (underViaduct(camPos.x, camPos.z) || underViaduct(mx, mz)) maxUp = 10.2;
    camPos.y = Math.min(camPos.y, maxUp);
    if (!((B.atStop || settle) && mode === 'chase')) clearSight(m, maxUp);
  }
  function snapCamera() { camH = h; desiredCamera(0); BB.camera.position.copy(camPos); curLook.copy(camLook); BB.camera.lookAt(curLook); }
  const curLook = new THREE.Vector3();
  // Smooth the camera in polar coordinates round the bus (angle, distance, height), so a change of view swings
  // round the bus instead of cutting through it.
  function updateCamera(dt) {
    if (GARAGE[B.camMode]) { garageUpdate(dt); return; }
    gcam = null;
    desiredCamera(dt);
    const chase = B.camMode === 'chase' && !B.atStop && !settle;
    const stopView = (B.atStop || settle) && B.camMode === 'chase';
    const k = 1 - Math.exp(-(chase ? 3.0 : stopView ? 2.6 : 1.6) * dt);
    const m = midPoint(), cp = BB.camera.position;
    const a0 = Math.atan2(cp.x - m.x, cp.z - m.z), a1 = Math.atan2(camPos.x - m.x, camPos.z - m.z);
    const r0 = Math.hypot(cp.x - m.x, cp.z - m.z), r1 = Math.hypot(camPos.x - m.x, camPos.z - m.z);
    const a = a0 + wrapA(a1 - a0) * k;
    let r = r0 + (r1 - r0) * k;
    if (Math.abs(wrapA(a1 - a0)) > 0.3) r = Math.max(r, Math.min(r0, r1, 13));   // keep clear of the bus while swinging
    let ny = cp.y + (camPos.y - cp.y) * k;
    if (camPos.y <= 10.2 && (underViaduct(m.x + Math.sin(a) * r, m.z + Math.cos(a) * r) || underViaduct(m.x, m.z))) ny = Math.min(ny, 10.2);
    let px = m.x + Math.sin(a) * r, pz = m.z + Math.cos(a) * r;
    // while swinging: never inside a pillar, a trunk or a building, and go over anything in the way
    const capY = underViaduct(px, pz) || underViaduct(m.x, m.z) ? 10.2 : 30;
    // (the stop view was planned clear of buildings: once nearly there it is used as it is, and holds still)
    const settled = stopView && stopCam && Math.hypot(px - camPos.x, ny - camPos.y, pz - camPos.z) < 2.5;
    const q = stopView && stopCam ? null : W().pushOut(px, pz, 1.4);
    if (q && q.hit > 0.01) { px = q.x; pz = q.z; }
    for (let k = 0; k < 6 && !settled && W().blocksSight(px, ny, pz, m.x, 2.2, m.z); k++) {
      if (ny < capY - 0.5) ny = Math.min(capY, ny + 1.6);
      else { px = m.x + (px - m.x) * 0.85; pz = m.z + (pz - m.z) * 0.85; }
    }
    cp.set(px, ny, pz);
    curLook.lerp(camLook, Math.min(1, k * 1.4));
    BB.camera.lookAt(curLook);
  }
  B.setCamera = function (mode, snap) { B.camMode = mode; if (snap) snapCamera(); if (snap || mode !== 'chase') snapWall(); };
  B.reframe = () => { stopCam = null; };            // plan the stop/scene view again (e.g. after a bay's .frame changed)
  B.hasCamera = (mode) => mode === 'title' || mode === 'chase' || !!GARAGE[mode];
  B.CAMERAS = ['title', 'chase', 'depot', 'depotClose', 'depotSide', 'garageWhole', 'garageFront', 'garageWheels', 'garageSide', 'garageSign', 'garageRear'];

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
  let routePts = null, routeFor = null;                    // the current left-lane route polyline (for the arrow and the lane tip)
  function refreshRibbon() {
    ribbonTimer = 0.35;
    if (!ribbon) return;
    if (!B.target || B.atStop === B.target || settle) { ribbon.geometry.setDrawRange(0, 0); routePts = null; B.route = []; return; }
    // keep following the route already planned while the bus is still on it (so it doesn't flip to another plan in
    // the middle of a junction); plan afresh when the target changes or the bus has left the route
    let pts = null;
    if (routePts && routeFor === B.target && routePts.length > 2) {
      // (the distance to the line's segments, not just its corner points: a long straight has none in between)
      let bi = -1, bd = 1e9, bq = null;
      for (let i = 0, acc = 0; i < routePts.length - 1 && acc < 30; i++) {
        const a = routePts[i], b = routePts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
        const tt = BB.clamp(((fx - a.x) * dx + (fz - a.z) * dz) / l2, 0, 1), d = Math.hypot(a.x + dx * tt - fx, a.z + dz * tt - fz);
        if (d < bd) { bd = d; bi = i; bq = { x: a.x + dx * tt, z: a.z + dz * tt }; }
        acc += Math.sqrt(l2);
      }
      const f = fwdOf(h), nx = routePts[Math.min(routePts.length - 1, bi + 1)], dirOk = (nx.x - routePts[bi].x) * f.x + (nx.z - routePts[bi].z) * f.z > -0.2;
      if (bd < 5 && dirOk) pts = [bq].concat(routePts.slice(bi + 1));
    }
    if (!pts) {
      const c = routeTo(B.target);
      if (!c || c.length < 2) { ribbon.geometry.setDrawRange(0, 0); routePts = null; return; }
      pts = leftLane(c); routeFor = B.target;
    }
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
  // How far the bus has to drive from where it is now to stop (along the route the ribbon would show, in world
  // units; Infinity if there is no way). For jobs.js: about 9 units a second in town, up to 14 on the outer roads.
  B.routeLength = function (stop) {
    stop = typeof stop === 'string' ? W().stopById(stop) : stop;
    if (!stop || !B.front) return Infinity;
    if (B.atStop === stop) return 0;
    const c = routeTo(stop);
    if (!c || c.length < 2) return Infinity;
    let L = 0; for (let i = 1; i < c.length; i++) L += Math.hypot(c[i].x - c[i - 1].x, c[i].z - c[i - 1].z);
    return L;
  };

  // ---------- driving ----------
  const circles = []; let nFront = 8;
  function busCircles() {
    const f = fwdOf(h), rp = rearPose(), r = fwdOf(hr);
    circles.length = 0;
    const add = (cx, cz, d, along, side, rad) => circles.push([cx + d.x * along + d.z * side, cz + d.z * along - d.x * side, rad]);
    const hl = LF / 2, n = Math.max(2, Math.ceil((LF - 2.4) / 1.7));
    for (let k = 0; k < n; k++) add(fx, fz, f, -hl + 1.3 + (LF - 2.6) * k / (n - 1), 0, 1.3);
    for (const s of [-0.85, 0.85]) { add(fx, fz, f, hl - 0.35, s, 0.56); add(fx, fz, f, -hl + 0.35, s, 0.56); }   // the corners
    nFront = circles.length;
    if (!ART) return circles;
    for (const a of [2.2, 0.75, -0.75, -2.2]) add(rp.rx, rp.rz, r, a, 0, 1.3);
    for (const s of [-0.85, 0.85]) { add(rp.rx, rp.rz, r, 2.65, s, 0.56); add(rp.rx, rp.rz, r, -2.65, s, 0.56); }
    return circles;
  }
  // Push the whole bus out of anything it overlaps; returns the push vector length and direction.
  function collide(rigid) {
    let tx = 0, tz = 0;
    // front circles move the whole bus; a rear circle swings the rear carriage about the hitch (like a trailer
    // brushing a post), and only moves the bus when the bend limit is reached
    for (let it = 0; it < 6; it++) {
      let moved = false;
      const cs = busCircles();
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i], q = W().pushOut(c[0], c[1], c[2]);
        if (q.hit <= 0.001) continue;
        let dx = q.x - c[0], dz = q.z - c[1];
        moved = true;
        if (ART && i >= nFront && !rigid) {
          const f = fwdOf(h), hx = fx - f.x * HITCH, hz = fz - f.z * HITCH, vx = c[0] - hx, vz = c[1] - hz, l2 = vx * vx + vz * vz || 1;
          const want = (dx * vz - dz * vx) / l2, nb = wrapA(hr + want - h);
          if (Math.abs(nb) <= MAX_BEND) { hr = wrapA(hr + want); continue; }
          dx *= 0.6; dz *= 0.6;
        }
        fx += dx; fz += dz; tx += dx; tz += dz;
      }
      if (!moved) break;
    }
    return { x: tx, z: tz, d: Math.hypot(tx, tz) };
  }
  // How far the rear carriage's circles still overlap anything (after collide()).
  function rearOverlap() {
    const cs = busCircles(); let m = 0;
    for (let i = nFront; i < cs.length; i++) m = Math.max(m, W().pushOut(cs[i][0], cs[i][1], cs[i][2]).hit);
    return m;
  }
  function drive(dt) {
    const inp = B.input, canDrive = !B.atStop && !B.doorsOpen && !B.noFuel && !B.locked && B.camMode === 'chase' && !settle;
    // input: the one-thumb joystick (analog: throttle -1..1, steer -1..1, + = right) or the buttons/keys (booleans)
    let thr, kidSteer;
    if (inp.analog) {
      thr = canDrive ? BB.clamp(+inp.throttle || 0, -1, 1) : 0; if (Math.abs(thr) < 0.08) thr = 0;
      kidSteer = canDrive ? -BB.clamp(+inp.steer || 0, -1, 1) : 0; if (Math.abs(kidSteer) < 0.08) kidSteer = 0;
    } else {
      const fwd = canDrive && (inp.fwd || B.going), back = canDrive && inp.back && !fwd;
      thr = fwd ? 1 : back ? -1 : 0;
      kidSteer = canDrive ? (inp.left && !inp.right ? 1 : inp.right && !inp.left ? -1 : 0) : 0;
    }
    // speed: ease toward the wanted speed; braking when the pedal points the other way
    const top = thr > 0 ? cruiseTop() : MAX_FWD;
    let want = thr > 0 ? thr * top : thr * MAX_BACK;
    // assist also eases off for bends and turns (like a careful driver), unless the child is steering
    // In the last stretch before the target bay (lined up with it) the parking logic takes over: steer along the
    // bay's own line and let approachCap() slow the bus to a stop in it, so a throttle-only drive always parks.
    const asst = B.assist && canDrive && thr > 0 ? (bayAssist(MAX_STEER + 0.22) || assistSteer(MAX_STEER + 0.22)) : null;
    if (asst && !asst.bay && Math.abs(kidSteer) < 0.3) want = Math.min(want, Math.max(4.0, Math.min(top * (1 - 1.1 * Math.abs(asst.alpha)), asst.vBend)));
    if (lookSlow < 1 && want > 0) want = Math.min(want, Math.max(3.5, MAX_FWD * lookSlow));   // (B.lookAt: slower, never stopped)
    let cap = approachCap();
    if (cap < Infinity) want = BB.clamp(want, -cap, cap); else cap = 0;   // ease off coming into the target bay so it can settle
    const slowing = Math.abs(want) < Math.abs(B.speed) || (Math.sign(want) !== Math.sign(B.speed) && Math.abs(B.speed) > 0.2);
    const easeOff = slowing && thr > 0 && want > 0 && !cap && B.speed > MAX_FWD - 0.5;     // leaving a cruising stretch
    const rate = !slowing ? ACCEL : (want === 0 && !cap) ? COAST : easeOff ? CRUISE_DOWN : BRAKE;
    if (B.speed < want) B.speed = Math.min(want, B.speed + rate * dt); else B.speed = Math.max(want, B.speed - rate * dt);
    if (!canDrive) B.speed = settle ? 0 : B.speed * Math.max(0, 1 - dt * 6);
    if (Math.abs(B.speed) < 0.01) B.speed = 0;
    // steering: turns toward the wheel's way while held, straightens itself when let go
    const ms = MAX_STEER + 0.22 * (1 - Math.min(1, Math.abs(B.speed) / 4));   // tighter when slow: easier to turn round
    let st = kidSteer * ms;
    // assist (a garage option): keep gently to the kerb lane, follow its bends and the ribbon at junctions, pull in
    // at the stop. The child's own steering wins (blended by how hard they steer).
    if (asst && B.speed > 0.6) {
      const k = Math.min(1, Math.abs(kidSteer) / 0.5); st = BB.clamp(asst.steer, -ms, ms) * (1 - k) + st * k;
    }
    if (st) B.steer += BB.clamp(st - B.steer, -STEER_IN * dt, STEER_IN * dt);
    else B.steer += BB.clamp(-B.steer, -STEER_OUT * dt, STEER_OUT * dt);
    const v = B.speed, ds = v * dt, sx0 = fx, sz0 = fz;
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
    if (!ART) hr = h;
    else if (Math.hypot(dx, dz) > 1e-4) hr = Math.atan2(dx, dz);
    if (ART && v < 0) hr += wrapA(h - hr) * Math.min(1, -ds * 0.25 + dt * 0.9);  // reversing: a helping hand straightens it
    const bend = wrapA(hr - h);
    if (Math.abs(bend) > MAX_BEND) hr = wrapA(h + Math.sign(bend) * MAX_BEND);
    // a soft kerb: wheels running up onto the pavement (a long bus cutting a corner) are eased back onto the road
    if (v > 0.8) kerbGuide(dt);
    // never crash: slide along walls, trees and posts
    const push = collide();
    if (ART && rearOverlap() > 0.2) { const p2 = collide(true); push.x += p2.x; push.z += p2.z; push.d = Math.hypot(push.x, push.z); }   // the rear carriage at its bend limit: move the whole bus
    if (push.d > 0.01) {
      const nx = push.x / push.d, nz = push.z / push.d, mv = Math.sign(v) || 1;
      const head = -(nx * f1.x + nz * f1.z) * mv;          // > 0 when driving into it
      if (head > 0.35) { const v0 = Math.abs(B.speed), v1 = Math.max(Math.min(v0, 1.5), v0 * Math.max(0.3, 1 - head * 0.9 * Math.min(1, push.d * 6))); B.speed = Math.sign(B.speed) * v1; }   // keeps a crawl, so it slides along
      if (bumpCool <= 0 && Math.abs(v) > 1.2 && head > 0.3) { bumpCool = 0.8; wobble = 1; BB.emit('bus:bump', { strength: Math.min(1, Math.abs(v) / MAX_FWD) }); }
    }
    // jammed (pushing but hardly moving, e.g. nose on a post): after a moment ease sideways until free. The side is
    // picked once: the way the child steers, else the way the push leans, else toward the left of travel.
    const wantD = Math.abs(v * dt), got = Math.abs((fx - sx0) * f1.x + (fz - sz0) * f1.z);
    if (wantD > 0.004 && got < wantD * 0.25 && push.d > 0.001) {
      jamT += dt;
      if (!jamSide) {
        const lx0 = f1.z, lz0 = -f1.x, lean = push.d > 0.01 ? (push.x * lx0 + push.z * lz0) / push.d : 0;
        jamSide = Math.abs(B.steer) > 0.1 ? Math.sign(B.steer) * Math.sign(v || 1) : Math.abs(lean) > 0.15 ? Math.sign(lean) : 1;
      }
      if (jamT > 0.3) {
        const lx = f1.z, lz = -f1.x;
        fx += lx * jamSide * 1.6 * dt; fz += lz * jamSide * 1.6 * dt;
        collide();
      }
      if (jamT > 1.6 && !jamFlipped) { jamFlipped = true; jamSide = -jamSide; }   // that way is blocked: try the other
      if (jamT > 3.4) { jamT = 0; jamSide = 0; jamFlipped = false; hopFree(); }   // still hemmed in: a happy hop onto the road
    } else if (got > wantD * 0.6 || wantD <= 0.004) { jamT = 0; jamSide = 0; jamFlipped = false; }
    // the slow watchdog: pedal held for 2.5 s with the bus rocking on the spot (pinned against something, which the
    // jam check above can miss when it moves to and fro): the same happy hop onto the road
    if (Math.abs(thr) > 0.3 && canDrive) {
      if (!stuckRef) stuckRef = { x: fx, z: fz, t: 0 };
      stuckRef.t += dt;
      if (Math.hypot(fx - stuckRef.x, fz - stuckRef.z) > 1.2) stuckRef = { x: fx, z: fz, t: 0 };
      else if (stuckRef.t > 2.5) { stuckRef = null; jamT = 0; jamSide = 0; jamFlipped = false; hopFree(); }
    } else stuckRef = null;
    // speed, fuel and wheels follow how far the bus really moved (not how hard it pushes)
    const moved = (fx - sx0) * f1.x + (fz - sz0) * f1.z, real = Math.abs(moved) / Math.max(dt, 1e-4);
    if (Math.abs(B.speed) > real + 0.6) B.speed = Math.sign(B.speed) * (real + 0.6);
    realMove = moved;
    return Math.abs(moved);
  }
  // The top speed here (see MAX_CRUISE): MAX_FWD, or more on a long straight of the outer road or the expressway.
  let cruiseK = 0;
  function cruiseTop() {
    let k = 0;
    const near = nearestRoad(fx, fz, h), e = near && near.edge;
    if (e && (e.kind === 'outer' || e.kind === 'highway') && e.points.length <= 2 && near.d < W().halfOf(e)) {
      const f = fwdOf(h), dot = f.x * near.dx + f.z * near.dz;
      if (Math.abs(dot) > 0.94 && Math.abs(B.steer) < 0.22) {
        const ahead = dot > 0 ? e.length - near.s : near.s, behind = dot > 0 ? near.s : e.length - near.s;
        k = BB.clamp((ahead - 30) / 24, 0, 1) * BB.clamp(behind / 12, 0, 1);
        // the target bay on this road: back to normal speed in good time
        if (B.target) { const bay = W().bayOf(B.target), db = (bay.x - fx) * f.x + (bay.z - fz) * f.z; if (db > -4 && Math.abs((bay.x - fx) * f.z - (bay.z - fz) * f.x) < 14) k = Math.min(k, BB.clamp((db - 40) / 30, 0, 1)); }
      }
    }
    cruiseK = k;
    return MAX_FWD + (MAX_CRUISE - MAX_FWD) * k;
  }
  // The soft kerb: each of the bus's circles that hangs over the kerb (by up to 3.5: further out, on purpose, it is
  // left alone; and not at junctions) is pushed gently back toward the road, sideways only; on a bendy the rear
  // carriage swings back about the hitch.
  function nearJunction(x, z) {
    for (const n of W().roads.nodes) {
      if (n.edges.length < 3) continue;
      const m = (n.half || (n.half = Math.max(...n.edges.map((id) => W().halfOf(W().edge(id)))))) + 9;
      if (Math.abs(x - n.x) < m && Math.abs(z - n.z) < m) return true;
    }
    return false;
  }
  function kerbGuide(dt) {
    const cs = busCircles(), f = fwdOf(h), hx = fx - f.x * HITCH, hz = fz - f.z * HITCH;
    if (W().inDepotYard && W().inDepotYard(fx, fz)) return;          // (the yard is open concrete: no kerbs)
    let px = 0, pz = 0, n = 0, swing = 0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (nearJunction(c[0], c[1])) continue;         // (turning at a junction: the corners are the bus's own business)
      const near = nearestRoad(c[0], c[1]);
      if (!near || near.d < 1e-3) continue;
      const over = near.d + c[2] * 0.6 - W().halfOf(near.edge);
      if (over <= 0 || over > 3.5) continue;
      const k = Math.min(over, 1.2) * 1.6 * dt, dx = (near.x - c[0]) / near.d * k, dz = (near.z - c[1]) / near.d * k;
      if (ART && i >= nFront) { const vx = c[0] - hx, vz = c[1] - hz, l2 = vx * vx + vz * vz || 1; swing += (dx * vz - dz * vx) / l2; }
      else { px += dx; pz += dz; n++; }
    }
    if (n) { const sx = f.z, sz = -f.x, l = (px * sx + pz * sz) / n; fx += sx * l; fz += sz * l; }   // sideways only: it never holds the bus back
    if (swing) { const nb = wrapA(hr + swing - h); if (Math.abs(nb) <= MAX_BEND) hr = wrapA(hr + swing); }
  }
  // Assist's steering: pure pursuit of a point ahead on the ribbon (with a target) or on the kerb lane of the road
  // the bus is on, in the way it is going. Returns a steer angle, or null when off the roads.
  let laneR = null;
  function laneAssist(ms) { const keep = routePts; routePts = null; try { return assistSteer(ms); } finally { routePts = keep; } }
  function assistSteer(ms) {
    // the path to keep to: the ribbon (with a target, plus a little past the bay) or the kerb lane of this road
    const f = fwdOf(h);
    let r;
    if (routePts && routePts.length > 1 && B.target) {
      const bay = W().bayOf(B.target);
      r = routePts.concat([{ x: bay.nose.x + bay.fwd.x * 12, z: bay.nose.z + bay.fwd.z * 12 }]);
    } else {
      const near = nearestRoad(fx, fz);
      if (!near || near.d > W().halfOf(near.edge) + 2) return null;
      const s = (f.x * near.dx + f.z * near.dz) >= 0 ? 1 : -1, e = near.edge;
      r = [];
      for (let k = -2; k <= 30; k += 2) {
        const sd = near.s + s * k; if (sd < 0 || sd > e.length) continue;
        const p = W().pointAt(e, sd); r.push({ x: p.x + p.dz * s * C.lane, z: p.z - p.dx * s * C.lane });
      }
      if (r.length < 2) return null;
    }
    // Stanley steering at the front axle: line up with the path's direction and close the sideways gap
    const ax = fx + f.x * (LF / 2 - FRONT_AXLE), az = fz + f.z * (LF / 2 - FRONT_AXLE);
    let bi = -1, bd = 1e9, bt = 0;
    for (let i = 0, acc = 0; i < r.length - 1 && acc < 24; i++) {
      const a = r[i], b = r[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const tt = BB.clamp(((ax - a.x) * dx + (az - a.z) * dz) / l2, 0, 1), d = Math.hypot(a.x + dx * tt - ax, a.z + dz * tt - az);
      if (d < bd) { bd = d; bi = i; bt = tt; }
      acc += Math.sqrt(l2);
    }
    if (bi < 0 || bd > 12) { if (routePts && B.target && r !== laneR) { laneR = null; return laneAssist(ms); } return null; }
    const a = r[bi], b = r[bi + 1], th = Math.atan2(b.x - a.x, b.z - a.z);
    const qx = a.x + (b.x - a.x) * bt, qz = a.z + (b.z - a.z) * bt;
    const e = (ax - qx) * Math.cos(th) + (az - qz) * -Math.sin(th);          // + = the bus is left of the path
    // feed-forward for the path's own bend here (so the bus commits to a junction's arc instead of drifting wide)
    let ff = 0;
    if (bi + 2 < r.length) {
      const c2 = r[bi + 2], th2 = Math.atan2(c2.x - b.x, c2.z - b.z), l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c2.x - b.x, c2.z - b.z);
      const kap = l1 > 0.3 && l2 > 0.3 ? wrapA(th2 - th) / Math.max(1, (l1 + l2) / 2) : 0;   // (not across a zero-length step)
      if (Math.abs(kap) > 0.01) ff = Math.atan(WB * kap) * BB.clamp(bt * 2, 0.4, 1);
    }
    const steer = ff + wrapA(th - h) - Math.atan2(1.6 * e, Math.abs(B.speed) + 2);
    // how much the path turns within the next ~14 or more (much further at speed), for slowing down in good time
    // before a junction's turn (measured from the bus's own point on the path: a long straight counts as straight)
    // The tightest bend ahead (its radius, from each corner's turn and its segments) sets a speed limit: gentle on
    // the loop's wide curves, a slow roll round a junction's turn.
    // (measured over 4-unit chords of the path resampled every 2 units, so a small kink where two pieces of the line
    // meet doesn't read as a hairpin and hold the bus to a crawl)
    const look = 14 + Math.max(0, B.speed) * 1.6, samp = [qx, qz];
    let rMin = Infinity, need = 2, px = qx, pz = qz;
    for (let j = bi + 1; j < r.length && samp.length < 2 * (look / 2 + 3);) {
      const dx = r[j].x - px, dz = r[j].z - pz, d = Math.hypot(dx, dz);
      if (d >= need) { px += dx / d * need; pz += dz / d * need; samp.push(px, pz); need = 2; }
      else { need -= d; px = r[j].x; pz = r[j].z; j++; }
    }
    for (let i = 0; i + 8 < samp.length; i += 2) {
      const t1 = Math.atan2(samp[i + 4] - samp[i], samp[i + 5] - samp[i + 1]), t2 = Math.atan2(samp[i + 8] - samp[i + 4], samp[i + 9] - samp[i + 5]);
      const dth = Math.abs(wrapA(t2 - t1));
      // each bend's speed (about 3.2 sideways), and how fast the bus may still go this far before it (easing off at 3)
      if (dth > 0.02) { const vb = Math.sqrt(3.2 * 4 / dth), d = Math.max(0, i - 2); rMin = Math.min(rMin, Math.sqrt(vb * vb + 6 * d)); }
    }
    return { steer: BB.clamp(steer, -ms, ms), alpha: Math.max(Math.abs(wrapA(th - h)), Math.min(1, Math.abs(e) / 4)), vBend: rMin };
  }
  // Assist's parking: within ~34 behind the target bay (mid point), close to its line and heading roughly its way,
  // Stanley steering onto the bay's centre line. Null when not in that stretch.
  function bayAssist(ms) {
    const t = B.target;
    if (!t || B.atStop) return null;
    const bay = W().bayOf(t), m = midPoint(), dx = m.x - bay.x, dz = m.z - bay.z;
    const prog = dx * bay.fwd.x + dz * bay.fwd.z, lat = dx * bay.side.x + dz * bay.side.z;
    const dh = wrapA(bay.heading - h);
    if (prog < -34 || prog > 6 || Math.abs(lat) > 7 || Math.abs(dh) > 1.0) return null;
    const f = fwdOf(h), ax = fx + f.x * (LF / 2 - FRONT_AXLE), az = fz + f.z * (LF / 2 - FRONT_AXLE);
    const e = (ax - bay.x) * bay.side.x + (az - bay.z) * bay.side.z;      // + = toward the kerb
    const steer = dh - Math.atan2(1.4 * e, Math.abs(B.speed) + 2.5);
    return { steer: BB.clamp(steer, -ms, ms), alpha: 0, bay: true };
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
      } else if (B.washBay && !B.inWash && !B.atStop && !washT && (!B.target || B.target === B.washBay) && Math.abs(B.speed) < 1.2 && B.camMode === 'chase') {
        // stopping in the wash bay (driving through it the right way round) settles the bus there too
        const wb = W().bayOf(B.washBay), m = midPoint(), dx = m.x - wb.x, dz = m.z - wb.z;
        if (Math.abs(dx * wb.fwd.x + dz * wb.fwd.z) < 5 && Math.abs(dx * wb.side.x + dz * wb.side.z) < 2.6 && Math.abs(wrapA(h - wb.heading)) < 0.6) {
          settle = { from: { fx, fz, h, hr }, to: poseAtBay(B.washBay, false), t: 0, stop: B.washBay };
          B.speed = 0; ribbon.geometry.setDrawRange(0, 0);
        }
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
      const cb = B.target === stop ? B.onArrive : null;
      if (stop === B.washBay) {                      // in the wash bay: not a stop (the bus can drive on); the UI asks
        if (B.target === stop) { B.target = null; B.onArrive = null; }
        B.inWash = true; refreshRibbon();
        BB.emit('bus:washBay', { inBay: true });
        if (cb) cb(stop);
        return;
      }
      B.target = null; B.atStop = stop; B.onArrive = null;
      refreshRibbon();
      BB.emit('bus:arrived', { stop });
      if (stop === W().depot && BB.ui && typeof BB.ui.fade === 'function' && W().workshop) {
        // a depot trip ends in the workshop: a quick fade, then the garage opens round the bus there
        B.locked = true;
        BB.ui.fade(() => { if (!BB.bedtime) B.locked = false; placeWorkshop(); B.atStop = stop; snapCamera(); if (cb) cb(stop); });
        return;
      }
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
      if (near.d < W().halfOf(near.edge) && Math.abs(dot) > 0.8 && B.speed > 3) {
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
    clock += dt; bumpCool -= dt; wobble = Math.max(0, wobble - dt * 2.5);
    let ds = 0;
    updateLook(dt); moveParts(dt);
    if (spin) updateSpin(dt); else { ds = settle ? 0 : drive(dt); updateSettle(dt); }
    gy += (W().groundY(fx, fz) - gy) * Math.min(1, dt * 8);
    placeModel();
    if (spinHop) { for (const o of [B.front, ART ? B.rear : null, jointF, jointR]) if (o) o.position.y += spinHop; }
    laneCheck(dt);
    // leaving the depot (out through its gate), the wash bay, the wash show
    const inYard = B.inDepot();
    if (wasInYard && !inYard && B.camMode === 'chase' && !spin) BB.emit('bus:leftDepot', {});
    wasInYard = inYard;
    if (B.inWash && !washT && B.washBay) {
      const wb = W().bayOf(B.washBay), m = midPoint();
      if (Math.hypot(m.x - wb.x, m.z - wb.z) > 5) { B.inWash = false; BB.emit('bus:washBay', { inBay: false }); }
    }
    if (washT) updateWash(dt);

    // fuel
    if (ds > 0 && !B.noFuel) {
      B.fuel = Math.max(0, B.fuel - ds * C.fuelPerUnit);
      if (!lowWarned && B.fuel <= C.fuelLow) { lowWarned = true; BB.emit('bus:fuelLow', { fuel: B.fuel }); }
      if (B.fuel <= 0) { B.noFuel = true; B.speed = 0; BB.emit('bus:fuelEmpty', {}); }
      // dust: about a full coat in 7 minutes of driving, faster in the rain
      B.dirt = Math.min(1, (B.dirt || 0) + ds / 2600 * (W().isRaining && W().isRaining() ? 2.2 : 1));
      saveTimer -= dt;
      if (saveTimer <= 0 && !B.noFuel) { saveTimer = 4; BB.save.fuel = B.fuel; BB.save.dirt = Math.round(B.dirt * 1000) / 1000; BB.saveNow(); }
    }

    // wheels, doors, passengers, face
    wheelAngle += (spin ? 0 : realMove) / tyreR(); realMove = 0;
    for (const w of wheelsF) w.rotation.x = wheelAngle;
    for (const w of wheelsR) w.rotation.x = wheelAngle;
    for (const w of steerWheels) w.rotation.y = B.steer * 0.8;
    doorT += ((B.doorsOpen ? 1 : 0) - doorT) * Math.min(1, dt * 6);
    for (const d of doors) { if (!d.userData.zOnly) d.position.x = d.userData.x + Math.sign(d.userData.x || 1) * doorT * 0.1; d.position.z = d.userData.z + doorT * d.userData.slide; }
    // the stop's dollhouse view: the kerb-side wall fades away so the seats and the people can be counted from the
    // pavement (the old roof cut-away is kept for models without a kerb wall, but off: the owner preferred the side)
    const wantRoof = 0, wantWall = stopView() ? 1 : 0;
    updateDirt();
    wallT += BB.clamp(wantWall - wallT, -dt * 2, dt * 2);
    if (M && wallT !== lastWallT) {
      lastWallT = wallT;
      applyWall();
    }
    roofT += BB.clamp(wantRoof - roofT, -dt * 2.5, dt * 2.5);
    if (M && roofT !== lastRoofT) {
      lastRoofT = roofT;
      for (const o of M.roofParts) { o.position.y = o.userData.roofY + roofT * 2.4; o.visible = roofT < 0.97; }
      for (const r of M.roofMats) { const tr = r.tr || roofT > 0.01; if (r.mat.transparent !== tr) { r.mat.transparent = tr; r.mat.needsUpdate = true; } r.mat.opacity = r.base * (1 - roofT); r.mat.depthWrite = roofT < 0.5 && (!r.tr || r.mat === M.roofMaterial); }
    }
    // wipers sweep while it rains
    const raining = W().isRaining && W().isRaining();
    wipePh = raining ? wipePh + dt * (W().isStormy && W().isStormy() ? 6 : 4) : wipePh;
    for (const wp of wipers) {
      const sw = wp.userData.sweep, rest = sw ? sw[0] : (wp.userData.rest || 0), span = sw ? sw[1] - sw[0] : 1.35;
      wp.rotation.z = raining ? rest + (0.5 - 0.5 * Math.cos(wipePh)) * span : rest + (wp.rotation.z - rest) * 0.9;
    }
    const n = BB.clamp(B.passengers | 0, 0, B.seats.length);
    if (heads.count !== n) heads.count = hair.count = shirts.count = n;
    B.paxGroup.position.y = Math.abs(B.speed) > 0.5 ? Math.abs(Math.sin(clock * 9)) * 0.04 : 0;

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
    updateWayArrow(dt);

    BB.sfx.engine(B.camMode === 'chase' ? Math.min(1, Math.abs(B.speed) / MAX_FWD) : 0);
    updateCamera(dt);
  };
  // The stop's side view (the dollhouse): at a stop or pulling into one, with the chase camera (not the wash bay, not
  // the workshop, the garage or the home screen).
  function stopView() {
    if (B.camMode !== 'chase' || B.inWorkshop || spin) return false;
    const st = B.atStop || (settle && settle.stop);
    return !!st && st !== B.washBay;
  }
  // The kerb wall at wallT (0 = solid, 1 = faded away for the stop view).
  function applyWall() {
    if (!M) return;
    const solid = 1 - BB.clamp(wallT * 3, 0, 1);
    for (const r of M.wallMats) {
      if (r.glassOnly) { r.u.value = solid; continue; }
      const tr = r.tr || wallT > 0.01;
      if (r.mat.transparent !== tr) { r.mat.transparent = tr; r.mat.needsUpdate = true; }
      r.mat.opacity = r.base * (1 - 0.9 * wallT); r.mat.depthWrite = !tr || wallT < 0.5;
      if (r.mat.userData.solidU) r.mat.userData.solidU.value = solid;
    }
    for (const o of M.wallParts) o.visible = wallT < 0.98 || M.wallMats.some((r) => !r.glassOnly);
  }
  // Snap the kerb wall to what the camera mode wants (after a type change, a jump to the workshop, home or a stop).
  function snapWall() { wallT = stopView() ? 1 : 0; lastWallT = wallT; applyWall(); }
  B.snapWall = snapWall;

  // ---------- the bus wash ----------
  // B.wash(): in the wash bay (B.inWash, after 'bus:washBay' {inBay:true}) a ~6.4 s show: the bus is held in place
  // (B.atStop = the wash bay, so the side-view camera frames it), the brushes roll along it spinning, foam flies, a
  // rinse, the dust fades away, a sparkle; then 'bus:washed'. Hold-aware (it runs on the game clock).
  let washT = 0, wasInYard = false, washSpark = 0;
  B.wash = function () {
    if (!B.inWash || washT || !B.washBay) return false;
    washT = 1e-4; B.atStop = B.washBay; B.locked = true; B.speed = 0; B.steer = 0;
    B.dirtStart = B.dirt || 0;
    if (BB.sfx && BB.sfx.whoosh) BB.sfx.whoosh();
    BB.emit('bus:washStart', {});
    return true;
  };
  B.isWashing = () => !!washT;
  function updateWash(dt) {
    washT += dt;
    if (W().washShow) W().washShow(washT, dt);
    if (washT > 1.5) B.dirt = (B.dirtStart || 0) * Math.max(0, 1 - (washT - 1.5) / 3.6);
    if (washT > 5.4 && !washSpark) { washSpark = 1; if (BB.sfx && BB.sfx.sparkle) BB.sfx.sparkle(); }
    if (washT > 5.4) { const k = Math.sin(Math.PI * Math.min(1, (washT - 5.4) / 1.0)); glassMat.emissive.setRGB(0.5 * k, 0.5 * k, 0.45 * k); }
    if (washT >= 6.4) {
      washT = 0; washSpark = 0; B.dirt = 0; BB.save.dirt = 0; BB.saveNow();
      if (W().washShow) W().washShow(null);
      if (!BB.bedtime) { B.atStop = null; B.locked = false; }    // (a goodnight that started meanwhile keeps the bus parked)
      BB.emit('bus:washed', {});
    }
  }
  // ---------- dust ----------
  // A dusty band along the lower body and over the wheel arches of every carriage: one mesh in world space whose few
  // vertices follow the carriages each frame; its opacity is B.dirt (0..1). Purely for looks.
  let dirtMesh = null, dirtBase = null, dirtCar = null;
  function dirtTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, 'rgba(120,92,60,0)'); g.addColorStop(0.45, 'rgba(120,92,60,0.35)'); g.addColorStop(1, 'rgba(96,70,44,0.8)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 64);
    let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++) { x.beginPath(); x.ellipse(rnd() * 256, 34 + rnd() * 30, 2 + rnd() * 7, 1.5 + rnd() * 4, rnd() * 3, 0, 7); x.fillStyle = `rgba(${90 + rnd() * 40 | 0},${66 + rnd() * 30 | 0},${40 + rnd() * 20 | 0},${0.35 + rnd() * 0.5})`; x.fill(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; return t;
  }
  function buildDirt() {
    if (dirtMesh) { dirtMesh.geometry.dispose(); } else {
      dirtMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ map: dirtTexture(), transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      dirtMesh.name = 'dirt'; dirtMesh.frustumCulled = false; BB.scene.add(dirtMesh);
    }
    // quads on both sides of each carriage: [carriage 0 front / 1 rear, length, z centre]
    const pos = [], uv = [], car = [], idx = [];
    const quad = (ci, side, z0, z1, y0, y1) => {
      const b = pos.length / 3, x = side * 1.285;
      for (const [z, y, u, v] of [[z0, y0, 0, 1], [z1, y0, (z1 - z0) / 3, 1], [z1, y1, (z1 - z0) / 3, 0], [z0, y1, 0, 0]]) { pos.push(x, y, z); uv.push(u, v); car.push(ci); }
      if (side > 0) idx.push(b, b + 1, b + 2, b, b + 2, b + 3); else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    };
    for (const sd of [1, -1]) { quad(0, sd, -LF / 2 + 0.2, LF / 2 - 0.2, 0.3, 1.2); if (ART) quad(1, sd, -LR / 2 + 0.2, LR / 2 - 0.2, 0.3, 1.2); }
    dirtBase = new Float32Array(pos); dirtCar = car;
    const g = dirtMesh.geometry = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
  }
  const _dv = new THREE.Vector3();
  function updateDirt() {
    if (!dirtMesh) return;
    const d = BB.clamp(B.dirt || 0, 0, 1);
    dirtMesh.visible = d > 0.03 && B.front.visible !== false;
    if (!dirtMesh.visible) return;
    dirtMesh.material.opacity = Math.min(1, d * 1.15);
    B.group.updateMatrixWorld(true);
    const p = dirtMesh.geometry.attributes.position.array;
    for (let i = 0; i < dirtCar.length; i++) {
      _dv.set(dirtBase[i * 3], dirtBase[i * 3 + 1], dirtBase[i * 3 + 2]).applyMatrix4((dirtCar[i] ? B.rear : B.front).matrixWorld);
      p[i * 3] = _dv.x; p[i * 3 + 1] = _dv.y; p[i * 3 + 2] = _dv.z;
    }
    dirtMesh.geometry.attributes.position.needsUpdate = true; dirtMesh.geometry.computeVertexNormals();
  }
  B.setDirt = function (v) { B.dirt = BB.clamp(+v || 0, 0, 1); BB.save.dirt = B.dirt; };

  // A small arrow over the bus pointing the way, when it is off the route or facing away from it.
  function updateWayArrow(dt) {
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
    if (!facingAway && away > 2.0 && bd < 10 && !spin) { awayT += dt; if (awayT > 0.7) { facingAway = true; BB.emit('bus:facingAway', { on: true }); } }
    else if (facingAway && (away < 1.5 || bd >= 12)) { facingAway = false; awayT = 0; BB.emit('bus:facingAway', { on: false }); }
    else if (!facingAway) awayT = 0;
    if (off) {
      const f = fwdOf(h);
      wayArrow.position.set(fx + f.x * 1.5, 5.2 + gy + Math.abs(Math.sin(clock * 4)) * 0.4, fz + f.z * 1.5);
      wayArrow.rotation.y = ang;
    }
  }
  B.updateCamera = updateCamera;

  B.assist = !!BB.save.assist;
  B.build = function () {
    B.washBay = W().washBay || null;
    B.dirt = BB.clamp(+BB.save.dirt || 0, 0, 1);
    buildModel();
    // Drive (the garage closes, not to the home screen): a quick fade and the bus waits in its yard bay
    BB.on('depot:closed', (d) => {
      if (d && d.home) return;
      if (!B.inWorkshop) return;
      B.locked = true;
      const go = () => { if (!BB.bedtime) B.locked = false; B.placeInYard(); B.setCamera('chase', true); BB.emit('bus:inYard', {}); };
      if (BB.ui && typeof BB.ui.fade === 'function') BB.ui.fade(go); else go();
    });
    B.placeAt(BB.world.depot);
    B.atStop = null;                      // parked, not "at a stop" (doors shut)
    B.fuel = BB.save.fuel;
    // an empty (or nearly empty) tank from an earlier visit: a little free top-up, so the bus can drive and the
    // usual "I'm getting hungry" trip to the depot happens instead of a stuck bus
    if (!(B.fuel > 0.02)) { B.fuel = 0.12; BB.save.fuel = B.fuel; BB.saveNow(); }
    B.noFuel = false; lowWarned = false;
    if (W().prewarm) W().prewarm();          // (the bus's own hidden parts too: headlight beams, glows)
  };
})();
