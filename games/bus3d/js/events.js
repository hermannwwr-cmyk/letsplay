/* Little Bus Captain: busy town events (BB.events).
   Little stories that happen around the bus now and then, a few minutes apart, gentle and never in the way:
   fire truck to the rescue, an ambulance passing (make way!), a friendly police car chasing a runaway trolley or a
   floating balloon, a broken-down car and the tow truck, the ice cream truck (buy one for 2 coins), the morning milk
   van, the rubbish truck, a family of otters on the zebra crossing, a lion dance parade (a Santa float at Christmas),
   fireworks over the sea at night, a plane landing near the airport, and rainbow splashes in puddles after rain.
   Rules: at most one event at a time; none starts during a stop, a question, the tow, the garage, the home screen,
   bedtime or the last minute of play time; no spoken line or bonus bubble while a stop/question is on; nothing
   blocks the bus or a stop (parked vehicles stand off the lanes, away from stops and junctions; moving ones wait for
   the bus and go see-through if it drives into them); everything runs from the main update (held = frozen).
   Counting bubbles are optional bonuses: tap one and it counts aloud; it never asks for an answer.
   Cost: each vehicle is one merged mesh plus one for its flashing lights; people and props are instanced (one draw
   call per look in use); all particles are one Points draw call. Idle: no meshes in the scene at all.
   API: BB.events = { update(dt), trigger(name) (debug), stop(), current, seen, NAMES, spot(id), active() }.
   Emits 'spot' {id, name} the first time each special vehicle/event is seen (saved: bus3d.spotted and BB.save.spotted),
   'events:start' {id}, 'events:end' {id}. Load after the other game files, before main.js. */
(function () {
  'use strict';
  const BB = window.BB;
  if (!BB || typeof THREE === 'undefined') return;
  const P = BB.P || {};
  const W = () => BB.world, Bs = () => BB.bus, J = () => BB.jobs, C = () => BB.cfg;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const safe = (fn) => { try { return fn(); } catch (e) { console.error('[events]', e); return null; } };

  const NAMES = {
    fireTruck: 'Fire truck', ambulance: 'Ambulance', police: 'Police car', towTruck: 'Tow truck', iceCream: 'Ice cream truck',
    milkVan: 'Milk van', rubbishTruck: 'Rubbish truck', otters: 'Otters', parade: 'Parade', fireworks: 'Fireworks', plane: 'Plane',
  };
  const E = BB.events = { current: null, seen: {}, NAMES, hooked: false, enabled: true };

  // ---------- spotting (saved) ----------
  (function loadSeen() {
    let s = BB.save && BB.save.spotted;
    if (!s || typeof s !== 'object' || Array.isArray(s)) s = BB.store ? BB.store.get('spotted', null) : null;
    if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
    for (const k in s) if (NAMES[k]) E.seen[k] = Math.max(0, (+s[k] | 0) || (s[k] ? 1 : 0));
    if (BB.save) BB.save.spotted = E.seen;
  })();
  E.spot = function (id) {
    if (!NAMES[id]) return;
    const first = !E.seen[id];
    E.seen[id] = (E.seen[id] | 0) + 1;
    if (BB.store) BB.store.set('spotted', E.seen);
    if (BB.save) BB.save.spotted = E.seen;
    if (first) BB.emit('spot', { id, name: NAMES[id] });
  };

  // ---------- calm checks ----------
  const ui = () => BB.ui || {};
  const homeShown = () => !!(ui().homeShown && ui().homeShown());
  const lastMinute = () => { const H = BB.hub; return !!(H && H.on && H.limit > 0 && H.left != null && H.left <= 75); };
  const jobBusy = () => !!(J() && J().busy && J().busy());
  // may an event keep running (scene visible, driving view)?
  function canRun() {
    const B = Bs(), w = W();
    return !!(w && w.built && B && B.front && B.camMode === 'chase' && !homeShown() && !(BB.depot && BB.depot.isOpen)
      && !BB.bedtime && !(BB.hub && BB.hub.slept));
  }
  // the stop the bus is heading for is within R (the stop's side view would take over the camera)
  function targetNear(R) {
    const B = Bs(), w = W(), st = B && B.target; if (!st || !w.bayOf) return false;
    const bay = safe(() => w.bayOf(st)); return !!(bay && Math.hypot(bay.x - B.pos.x, bay.z - B.pos.z) < R);
  }
  // the bus builder's BB.bus.holdArrival(seconds): delays settling into the next bay while an event plays
  const holdable = () => { const B = Bs(); return !!(B && typeof B.holdArrival === 'function'); };
  function holdArrival(sec) { const B = Bs(); if (holdable()) safe(() => B.holdArrival(Math.min(8, sec))); }
  const pullingIn = () => { const B = Bs(); return !!(B && (B.atStop || (B.isSettling && B.isSettling()))); };
  // may a new event start?
  function canStart() {
    if (!canRun() || jobBusy() || lastMinute() || (BB.hub && BB.hub.timeUp && BB.hub.timeUp())) return false;
    const B = Bs(), jp = J() ? J().phase : 'idle';
    if (jp === 'tow' || jp === 'home' || jp === 'bedtime' || jp === 'depot' || jp === 'toDepot') return false;
    if (B.atStop || (B.isSettling && B.isSettling()) || (B.isSpinning && B.isSpinning()) || (B.isWashing && B.isWashing()) || B.inWash) return false;
    if (B.inDepot && B.inDepot()) return false;
    if (ui().asking && ui().asking()) return false;
    if (targetNear(holdable() ? 40 : 60)) return false;   // (the bus is about to pull into its stop)
    return true;
  }
  // no event speech, prompts or bubbles right now (a stop, a question, a card, ...)
  const quiet = () => !canRun() || jobBusy() || pullingIn() || targetNear(35) || !!(ui().asking && ui().asking()) || !!(BB.hub && BB.hub.timeUp && BB.hub.timeUp());
  const saidAt = {};                    // line -> clock when last said (the same line isn't said again for 8 minutes)
  function talk(text, important, again) {
    if (quiet()) return false;
    if (!again && saidAt[text] != null && clock - saidAt[text] < 480) return false;
    if (!important && BB.speaking && BB.speaking()) return false;
    saidAt[text] = clock;
    BB.say(text, { queue: true });
    return true;
  }

  // ---------- sound (effects bus, peaks <= 0.14; we stay at or under ~0.1) ----------
  const A = BB.audio;
  const N = (s) => 440 * Math.pow(2, (s - 9) / 12);
  const live = () => !!(A && A.ctx && A.ctx.state === 'running' && !A.mute && !BB.held);
  const duck = () => (jobBusy() ? 0.35 : 1);
  function tone(f, dur, o) { if (!live() || !BB.tone || (o && o.vol != null && !(o.vol >= 0.002))) return; try { BB.tone(f, dur, o); } catch (e) { /* no sound */ } }
  let noiseBuf = null;
  function noise(dur, o = {}) {
    if (!live() || (o.vol != null && !(o.vol >= 0.002) && !o.hold)) return null;
    const ctx = A.ctx;
    try {
      if (!noiseBuf) { const n = ctx.sampleRate; noiseBuf = ctx.createBuffer(1, n, n); const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.frequency.value = o.freq || 1000; if (o.q) f.Q.value = o.q;
      const g = ctx.createGain(), t = ctx.currentTime + (o.at || 0), v = Math.max(0.0002, Math.min(0.12, o.vol == null ? 0.05 : o.vol));
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.01));
      if (!o.hold) g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(A.sfxBus || ctx.destination);
      src.start(t, Math.random() * 0.5); if (!o.hold) src.stop(t + dur + 0.05);
      return {
        set(vv) { try { g.gain.setTargetAtTime(Math.max(0.0001, Math.min(0.12, vv)), ctx.currentTime, 0.12); } catch (e) { /* gone */ } },
        stop() { try { const t2 = ctx.currentTime; g.gain.cancelScheduledValues(t2); g.gain.setTargetAtTime(0.0001, t2, 0.08); src.stop(t2 + 0.5); } catch (e) { /* gone */ } },
      };
    } catch (e) { return null; }
  }
  // how loud something at (x, z) is for the bus (0..1)
  function near(x, z, R = 110) { const B = Bs(); if (!B || !B.front) return 0; return clamp(1 - Math.hypot(x - B.pos.x, z - B.pos.z) / R, 0, 1); }
  // Original two-tone calls (not copies of real sirens): a soft doorbell-like pair for the fire truck, a fifth for the
  // ambulance, a bouncy up-and-down chirp for the police car. Each returns how long one call lasts.
  const SIREN = {
    fire(k) { const v = 0.055 * k * duck(); tone(N(24), 0.24, { type: 'sine', vol: v, attack: 0.03 }); tone(N(28), 0.3, { type: 'sine', vol: v, at: 0.3, attack: 0.03 }); return 0.68; },
    ambulance(k) { const v = 0.045 * k * duck(); tone(N(19), 0.26, { type: 'triangle', vol: v, attack: 0.02 }); tone(N(26), 0.26, { type: 'triangle', vol: v, at: 0.3, attack: 0.02 }); return 0.62; },
    police(k) { const v = 0.04 * k * duck(); tone(N(19), 0.22, { type: 'triangle', vol: v, slide: N(26) }); tone(N(26), 0.22, { type: 'triangle', vol: v, at: 0.26, slide: N(19) }); return 0.56; },
  };
  const SND = {
    tune(k = 1) { [12, 16, 19, 16, 24, 19, 28].forEach((s, i) => tone(N(s), 0.16, { type: 'triangle', vol: 0.06 * k, at: i * 0.13 })); },
    // the ice cream truck's own little music-box tune (original)
    jingle(k = 1) {
      const m = [[19, 0], [24, 0.25], [23, 0.5], [21, 0.75], [19, 1.0], [16, 1.25], [19, 1.5], [24, 2.0], [26, 2.25], [28, 2.5], [26, 2.75], [24, 3.0]];
      for (const [s, at] of m) tone(N(s), 0.22, { type: 'sine', vol: 0.06 * k * duck(), at, attack: 0.005 });
      for (const [s, at] of [[12, 0], [7, 1.0], [12, 2.0], [7, 3.0]]) tone(N(s + 12), 0.4, { type: 'triangle', vol: 0.025 * k * duck(), at });
    },
    beep(k = 1) { tone(N(29), 0.16, { type: 'sine', vol: 0.05 * k * duck() }); },
    clunk(k = 1) { tone(N(2), 0.1, { type: 'square', vol: 0.04 * k }); noise(0.08, { freq: 700, vol: 0.04 * k }); },
    clink(k = 1) { tone(N(36), 0.06, { type: 'sine', vol: 0.05 * k }); tone(N(40), 0.06, { type: 'sine', vol: 0.04 * k, at: 0.07 }); },
    tick(k = 1) { tone(N(31), 0.03, { type: 'sine', vol: 0.025 * k }); },
    hiss(k = 1) { noise(0.5, { type: 'highpass', freq: 2500, vol: 0.025 * k, attack: 0.05 }); },
    squeak(k = 1) { const s = rand(30, 34); tone(N(s), 0.09, { type: 'sine', vol: 0.045 * k, slide: N(s + 5) }); },
    drum(k = 1) { tone(165, 0.2, { type: 'sine', vol: 0.11 * k, slide: 132 }); noise(0.06, { freq: 900, vol: 0.05 * k }); },
    tap(k = 1) { tone(330, 0.07, { type: 'triangle', vol: 0.05 * k }); noise(0.04, { type: 'bandpass', freq: 1800, vol: 0.03 * k }); },
    cymbal(k = 1) { noise(0.18, { type: 'highpass', freq: 5000, vol: 0.035 * k, attack: 0.003 }); },
    bells(k = 1) { for (let i = 0; i < 4; i++) tone(N(pick([36, 40, 43, 48])), 0.12, { type: 'sine', vol: 0.035 * k, at: i * 0.07 }); },
    pop(k = 1) { noise(0.3, { freq: 700, vol: 0.09 * k, attack: 0.004 }); for (let i = 0; i < 5; i++) tone(N(rand(38, 46)), 0.03, { type: 'sine', vol: 0.02 * k, at: 0.15 + i * 0.06 + Math.random() * 0.04 }); },
    whistle(k = 1) { tone(N(24), 0.7, { type: 'sine', vol: 0.022 * k, slide: N(36), attack: 0.1 }); },
    splash(k = 1) { noise(0.22, { type: 'bandpass', freq: 1400, q: 0.8, vol: 0.06 * k, attack: 0.005 }); },
    sparkle(k = 1) { [31, 35, 38, 43].forEach((s, i) => tone(N(s), 0.12, { type: 'sine', vol: 0.035 * k, at: i * 0.05 })); },
    happy(k = 1) { if (BB.sfx && BB.sfx.cheer) BB.sfx.cheer(); else SND.tune(k); },
  };

  // ---------- particles: one pooled Points draw call ----------
  const PN = 720;
  const parts = [];
  let pMesh = null, pGeo = null, pPos, pCol, pSize, pAlpha, pPtr = 0, pLive = 0;
  function buildParticles() {
    pGeo = new THREE.BufferGeometry();
    pPos = new Float32Array(PN * 3); pCol = new Float32Array(PN * 3); pSize = new Float32Array(PN); pAlpha = new Float32Array(PN);
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    pGeo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize, aAlpha; uniform float uScale; varying vec3 vC; varying float vA;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = min(320.0, aSize * uScale / max(0.5, -mv.z)); vC = aColor; vA = aAlpha; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main() { vec2 c = gl_PointCoord - 0.5; float r = length(c); if (r > 0.5) discard; gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.3, r)); }`,
      transparent: true, depthWrite: false,
    });
    pMesh = new THREE.Points(pGeo, mat); pMesh.name = 'eventFx'; pMesh.frustumCulled = false; pMesh.renderOrder = 5; pMesh.visible = false;
    for (let i = 0; i < PN; i++) parts.push({ life: 0 });
  }
  const _col = new THREE.Color();
  // emit one particle: {x,y,z, vx,vy,vz, life, size, size1, color, alpha, grav, drag, fin, glow, floor}
  function emit(o) {
    for (let n = 0; n < PN; n++) {
      pPtr = (pPtr + 1) % PN;
      const p = parts[pPtr];
      if (p.life > 0) continue;
      p.x = o.x; p.y = o.y; p.z = o.z; p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
      p.life = p.max = o.life || 1; p.s0 = o.size || 0.5; p.s1 = o.size1 != null ? o.size1 : p.s0;
      _col.set(o.color || '#ffffff');
      const k = o.glow ? 1 : lightK;
      p.r = _col.r * k; p.g = _col.g * k; p.b = _col.b * k;
      p.a = o.alpha == null ? 1 : o.alpha; p.grav = o.grav || 0; p.drag = o.drag || 0; p.fin = o.fin || 0.08; p.floor = o.floor;
      if (!pMesh.parent && BB.scene) BB.scene.add(pMesh);
      return p;
    }
    return null;
  }
  let lightK = 1;
  function updateParticles(dt) {
    if (!pMesh) return;
    let k = 0;
    for (let i = 0; i < PN; i++) {
      const p = parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.grav * dt;
      if (p.drag) { const dr = Math.exp(-p.drag * dt); p.vx *= dr; p.vy *= dr; p.vz *= dr; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor != null && p.y < p.floor) { p.y = p.floor; p.vy = 0; p.vx *= 0.5; p.vz *= 0.5; p.life = Math.min(p.life, 0.12); }
      const u = 1 - p.life / p.max;
      pPos[k * 3] = p.x; pPos[k * 3 + 1] = p.y; pPos[k * 3 + 2] = p.z;
      pCol[k * 3] = p.r; pCol[k * 3 + 1] = p.g; pCol[k * 3 + 2] = p.b;
      pSize[k] = p.s0 + (p.s1 - p.s0) * u;
      pAlpha[k] = p.a * Math.min(1, u / p.fin) * (1 - u * u);
      k++;
    }
    pLive = k;
    pGeo.setDrawRange(0, k);
    pMesh.visible = k > 0;
    if (k) {
      for (const n of ['position', 'aColor', 'aSize', 'aAlpha']) pGeo.attributes[n].needsUpdate = true;
      const cam = BB.camera, h = BB.renderer ? BB.renderer.domElement.height : innerHeight;
      if (cam) pMesh.material.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    } else if (pMesh.parent) pMesh.parent.remove(pMesh);
  }
  function clearParticles() { for (const p of parts) p.life = 0; if (pMesh) { pGeo.setDrawRange(0, 0); pMesh.visible = false; if (pMesh.parent) pMesh.parent.remove(pMesh); } }

  // ---------- art: people and props (instanced, immediate mode: each frame the event puts what it shows) ----------
  const CYL = (r, h, seg = 8) => new THREE.CylinderGeometry(r, r, h, seg);
  function personGeo(o) {
    const b = BB.mk.builder(), s = o.kid ? 0.72 : 1, sh = o.shirt, pants = o.pants || '#4a5a78';
    b.box(0.22 * s, 0.8 * s, 0.24 * s, pants, -0.13 * s, 0, 0); b.box(0.22 * s, 0.8 * s, 0.24 * s, pants, 0.13 * s, 0, 0);
    b.cyl(0.26 * s, 0.32 * s, 0.85 * s, 6, sh, 0, 0.78 * s, 0);
    if (o.stripe) { b.cyl(0.33 * s, 0.33 * s, 0.09 * s, 6, o.stripe, 0, 0.98 * s, 0); b.cyl(0.29 * s, 0.29 * s, 0.08 * s, 6, o.stripe, 0, 1.36 * s, 0); }
    b.ball(0.27 * s, o.skin || '#f1c7a0', 0, 1.9 * s, 0);
    if (o.hat === 'helmet') { b.ball(0.31 * s, o.hatCol, 0, 2.0 * s, 0, 0, 1, 0.78, 1); b.cyl(0.4 * s, 0.4 * s, 0.05 * s, 8, o.hatCol, 0, 1.9 * s, -0.04 * s); b.box(0.12 * s, 0.12 * s, 0.05 * s, '#e8473b', 0, 2.02 * s, 0.29 * s); }
    else if (o.hat === 'cap') { b.ball(0.29 * s, o.hatCol, 0, 2.0 * s, 0, 0, 1, 0.62, 1); b.box(0.3 * s, 0.04 * s, 0.22 * s, o.hatCol, 0, 1.95 * s, 0.27 * s); }
    else if (o.hat === 'elf') { b.add(new THREE.ConeGeometry(0.28 * s, 0.6 * s, 7), o.hatCol, 0, 2.25 * s, 0); b.ball(0.08 * s, '#fff6e0', 0, 2.56 * s, 0); }
    else b.ball(0.28 * s, o.hair || '#3a2a2c', 0, 2.0 * s, -0.05 * s, 0, 1, 0.7, 1);
    if (o.arms === 'fwd') for (const x of [-0.25, 0.25]) b.box(0.12 * s, 0.14 * s, 0.55 * s, sh, x * s, 1.32 * s, 0.24 * s);
    else if (o.arms === 'up') for (const x of [-0.36, 0.36]) b.box(0.12 * s, 0.6 * s, 0.14 * s, sh, x * s, 1.45 * s, 0, 0, 0, x < 0 ? 0.35 : -0.35);
    else for (const x of [-0.36, 0.36]) b.box(0.12 * s, 0.6 * s, 0.14 * s, sh, x * s, 0.95 * s, 0);
    if (o.nozzle) { b.add(CYL(0.08, 0.7, 6), '#d9d2c6', 0, 1.36 * s, 0.75 * s, 0, Math.PI / 2, 0); b.add(CYL(0.1, 0.12, 6), '#e8473b', 0, 1.36 * s, 0.42 * s, 0, Math.PI / 2, 0); }
    if (o.cone) { b.add(new THREE.ConeGeometry(0.1, 0.32, 6), '#e2b07c', 0.26 * s, 1.18 * s, 0.32 * s, 0, Math.PI, 0); b.ball(0.12, o.cone, 0.26 * s, 1.38 * s, 0.32 * s); }
    if (o.drum) { b.add(CYL(0.38, 0.36, 12), '#e8473b', 0, 1.1, 0.5, 0, Math.PI / 2, 0); for (const z of [0.31, 0.69]) b.add(CYL(0.4, 0.05, 12), '#ffd45c', 0, 1.1, z, 0, Math.PI / 2, 0); }
    if (o.cymbal) for (const x of [-0.3, 0.3]) b.add(CYL(0.3, 0.04, 10), '#ffd45c', x, 1.4, 0.35, 0, 0, Math.PI / 2);
    if (o.flag) { b.box(0.05, 2.4, 0.05, '#d9b57f', 0.36, 0.7, 0.15); b.box(0.03, 0.62, 0.9, o.flag, 0.36, 2.45, 0.62); b.box(0.035, 0.16, 0.9, '#ffd45c', 0.36, 2.45, 0.62); }
    if (o.carry) b.box(0.62, 0.34, 0.44, o.carry, 0, 1.15 * s, 0.42 * s);
    if (o.balloon) { b.box(0.02, 1.4, 0.02, '#fff6e0', 0.36, 1.0, 0.1); b.ball(0.36, o.balloon, 0.36, 2.7, 0.1, 1, 1, 1.15, 1); }
    return b.geometry();
  }
  function otterGeo(pup) {
    const b = BB.mk.builder(), s = pup ? 0.62 : 1, fur = '#7a5236', belly = '#c79a6c';
    b.ball(0.34 * s, fur, 0, 0.3 * s, -0.05 * s, 0, 1, 0.85, 1.9);           // long body
    b.ball(0.24 * s, belly, 0, 0.24 * s, 0.1 * s, 0, 1, 0.7, 1.4);
    b.ball(0.24 * s, fur, 0, 0.42 * s, 0.6 * s, 0, 1, 0.95, 1.1);            // head
    b.ball(0.12 * s, belly, 0, 0.36 * s, 0.8 * s);                          // muzzle
    b.ball(0.05 * s, '#2a2024', 0, 0.42 * s, 0.9 * s);                      // nose
    for (const x of [-0.1, 0.1]) { b.ball(0.04 * s, '#2a2024', x * s, 0.5 * s, 0.8 * s); b.ball(0.06 * s, fur, x * 1.6 * s, 0.6 * s, 0.56 * s); }
    b.add(new THREE.ConeGeometry(0.12 * s, 0.7 * s, 6), fur, 0, 0.18 * s, -0.8 * s, 0, -Math.PI / 2 - 0.15, 0);   // tail
    for (const [x, z] of [[-0.18, 0.3], [0.18, 0.3], [-0.18, -0.35], [0.18, -0.35]]) b.ball(0.08 * s, '#5e3e28', x * s, 0.07 * s, z * s, 0, 1, 0.7, 1.3);
    return b.geometry();
  }
  function lionGeo() {
    const b = BB.mk.builder(), red = '#e8473b', gold = '#ffd45c';
    for (const z of [-1.9, -0.7]) for (const x of [-0.2, 0.2]) b.box(0.2, 0.75, 0.24, '#ffb81f', x, 0, z);       // the dancers' legs
    for (const z of [-1.9, -0.7]) for (const x of [-0.2, 0.2]) b.box(0.26, 0.12, 0.34, '#3a343f', x, 0, z + 0.04);
    b.box(1.2, 0.9, 2.4, red, 0, 0.75, -1.3, 0, 0.12); b.box(1.24, 0.14, 2.42, gold, 0, 1.1, -1.3, 0, 0.12);    // the body cloth
    for (let k = 0; k < 5; k++) b.ball(0.16, k % 2 ? gold : '#fff6e0', 0, 1.75 - k * 0.1, -0.4 - k * 0.45);
    b.ball(0.2, '#fff6e0', 0, 1.2, -2.55);                                                                     // tail tuft
    b.ball(0.72, red, 0, 1.75, 0.35, 1, 1.05, 0.95, 1);                                                        // the head
    b.ball(0.5, gold, 0, 1.55, 0.78, 1, 1.15, 0.7, 0.8);                                                       // the snout
    b.box(0.9, 0.18, 0.5, '#fff6e0', 0, 1.12, 0.7);                                                            // the beard
    for (const x of [-0.32, 0.32]) { b.ball(0.2, '#ffffff', x, 2.05, 0.82); b.ball(0.1, '#3a2a3c', x, 2.07, 0.98); b.ball(0.16, gold, x * 1.5, 2.45, 0.35); }
    b.add(new THREE.ConeGeometry(0.16, 0.42, 6), gold, 0, 2.5, 0.55, 0, 0.5, 0);                               // the horn
    b.ball(0.13, '#ff8fab', 0, 1.62, 1.18);                                                                     // nose
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; b.ball(0.18, k % 2 ? '#fff6e0' : gold, Math.cos(a) * 0.78, 1.75 + Math.sin(a) * 0.55, 0.05); }
    return b.geometry();
  }
  function floatGeo() {                       // Santa's float: a cart with gifts, a little tree and Santa waving
    const b = BB.mk.builder(), red = '#e8473b';
    b.box(2.2, 0.5, 3.6, '#3a9d5f', 0, 0.45, 0); b.box(2.3, 0.18, 3.7, red, 0, 0.95, 0);
    for (const z of [-1.2, 1.2]) for (const x of [-1.1, 1.1]) { b.add(CYL(0.42, 0.22, 10), '#ffd45c', x, 0.42, z, 0, 0, Math.PI / 2); }
    for (const [x, z, c] of [[-0.6, 1.1, P.berry || '#5d73e8'], [0.55, 1.2, P.honey || '#ffb81f'], [0.6, -1.2, P.teal || '#19a79b']]) { b.box(0.6, 0.5, 0.6, c, x, 1.13, z); b.box(0.64, 0.1, 0.16, '#fff6e0', x, 1.45, z); }
    b.add(new THREE.ConeGeometry(0.55, 1.6, 8), '#2f8a55', -0.55, 1.95, -1.1); b.ball(0.13, '#ffd45c', -0.55, 2.8, -1.1);
    b.box(0.9, 0.5, 0.8, '#b0362c', 0, 1.13, 0);                                                              // the seat
    b.cyl(0.42, 0.48, 0.9, 8, red, 0, 1.5, 0); b.cyl(0.5, 0.5, 0.1, 8, '#fff6e0', 0, 1.62, 0);
    b.ball(0.3, '#f1c7a0', 0, 2.62, 0); b.ball(0.3, '#ffffff', 0, 2.42, 0.1, 0, 1, 0.9, 0.8);                // face and beard
    b.add(new THREE.ConeGeometry(0.3, 0.6, 8), red, 0, 3.0, -0.05, 0, -0.35, 0); b.ball(0.1, '#ffffff', 0, 3.2, -0.2);
    b.cyl(0.32, 0.32, 0.08, 8, '#ffffff', 0, 2.8, 0);
    b.box(0.14, 0.6, 0.14, red, 0.45, 2.2, 0, 0, 0, -0.6); b.ball(0.1, '#ffffff', 0.68, 2.72, 0);           // the waving arm
    return b.geometry();
  }
  function kioskGeo() {                     // a little roadside kiosk (front +z): mint walls, a striped awning, a coral roof
    const b = BB.mk.builder();
    b.box(3.4, 0.2, 3.2, '#e4d6bd', 0, 0, 0);
    b.box(3.0, 2.6, 2.8, '#8fe0c4', 0, 0.2, 0); b.box(2.2, 1.0, 0.06, '#5a4a5c', 0, 1.3, 1.41); b.box(2.4, 0.14, 0.3, '#ffd45c', 0, 1.2, 1.5);
    for (let k = 0; k < 6; k++) b.box(0.5, 0.06, 0.9, k % 2 ? '#fff6e0' : '#ff6b5c', -1.25 + k * 0.5, 2.45, 1.75, 0, -0.35, 0);
    b.box(3.4, 0.4, 3.2, '#ff6b5c', 0, 2.8, 0); b.box(0.9, 0.5, 0.06, '#fff6e0', 0, 2.75, 1.62);
    return b.geometry();
  }
  function crateGeo(n) {                      // a milk crate holding n bottles in a row of five
    const b = BB.mk.builder();
    b.box(1.1, 0.34, 0.32, '#4fa3e0', 0, 0, 0); b.box(1.12, 0.06, 0.34, '#3d8fe0', 0, 0.3, 0);
    for (let i = 0; i < n; i++) { b.cyl(0.08, 0.09, 0.42, 6, '#fbf7ee', -0.42 + i * 0.21, 0.12, 0); b.cyl(0.05, 0.05, 0.06, 6, '#3d8fe0', -0.42 + i * 0.21, 0.54, 0); }
    return b.geometry();
  }
  function binGeo() {
    const b = BB.mk.builder();
    b.box(0.7, 1.0, 0.7, '#3f9a52', 0, 0.08, 0); b.box(0.76, 0.1, 0.78, '#2f7f42', 0, 1.08, 0.02);
    for (const x of [-0.25, 0.25]) b.add(CYL(0.1, 0.08, 8), '#2f2a33', x, 0.1, -0.32, 0, 0, Math.PI / 2);
    return b.geometry();
  }
  function trolleyGeo() {
    const b = BB.mk.builder(), m = '#b9c2cc', d = '#8f99a6';
    b.box(0.9, 0.6, 1.2, m, 0, 0.45, 0); b.box(0.8, 0.05, 1.1, d, 0, 0.5, 0);
    for (let k = -2; k <= 2; k++) b.box(0.92, 0.04, 0.03, d, 0, 0.6 + 0.1 * (k + 2), 0.61);
    b.box(0.95, 0.06, 0.06, '#ff6b5c', 0, 1.2, -0.75); b.box(0.04, 0.4, 0.04, m, -0.4, 0.95, -0.68); b.box(0.04, 0.4, 0.04, m, 0.4, 0.95, -0.68);
    for (const [x, z] of [[-0.35, 0.45], [0.35, 0.45], [-0.35, -0.45], [0.35, -0.45]]) { b.box(0.03, 0.4, 0.03, d, x, 0.08, z); b.add(CYL(0.08, 0.06, 8), '#3a343f', x, 0.08, z, 0, 0, Math.PI / 2); }
    b.box(0.3, 0.25, 0.3, '#ffb81f', -0.15, 0.55, 0.2); b.box(0.25, 0.32, 0.25, '#6fc45a', 0.2, 0.55, -0.2);   // shopping inside
    return b.geometry();
  }
  function balloonGeo() { const b = BB.mk.builder(); b.ball(0.5, '#ff6b5c', 0, 1.6, 0, 1, 1, 1.18, 1); b.ball(0.12, '#ff8fab', -0.16, 1.8, 0.4); b.add(new THREE.ConeGeometry(0.08, 0.12, 5), '#d94c40', 0, 1.03, 0, 0, Math.PI, 0); b.box(0.02, 1.0, 0.02, '#fff6e0', 0, 0, 0); return b.geometry(); }

  const LOOKS = {
    fire: () => personGeo({ shirt: '#d9822b', stripe: '#ffe066', pants: '#3d4a63', hat: 'helmet', hatCol: '#ffd45c', arms: 'fwd', nozzle: true }),
    fireWalk: () => personGeo({ shirt: '#d9822b', stripe: '#ffe066', pants: '#3d4a63', hat: 'helmet', hatCol: '#ffd45c' }),
    police: () => personGeo({ shirt: '#3d6fc0', pants: '#2c3e6b', hat: 'cap', hatCol: '#2c3e6b', skin: '#d9a679' }),
    policeUp: () => personGeo({ shirt: '#3d6fc0', pants: '#2c3e6b', hat: 'cap', hatCol: '#2c3e6b', skin: '#d9a679', arms: 'fwd' }),
    worker: () => personGeo({ shirt: '#19a79b', stripe: '#ffe066', pants: '#3d4a63', hat: 'cap', hatCol: '#ff9a3c', skin: '#a8714a' }),
    milk: () => personGeo({ shirt: '#ffffff', pants: '#4a5a78', hat: 'cap', hatCol: '#4fa3e0', skin: '#f5d3b5' }),
    milkCarry: () => personGeo({ shirt: '#ffffff', pants: '#4a5a78', hat: 'cap', hatCol: '#4fa3e0', skin: '#f5d3b5', arms: 'fwd' }),
    driver: () => personGeo({ shirt: '#8e62c8', pants: '#4a5a78', hair: '#1f1b22', skin: '#d9a679' }),
    kidA: () => personGeo({ kid: true, shirt: '#ff6b5c', hair: '#3a2a2c' }),
    kidB: () => personGeo({ kid: true, shirt: '#ffb81f', hair: '#6b4a2e', skin: '#a8714a' }),
    kidC: () => personGeo({ kid: true, shirt: '#5d73e8', hair: '#1f1b22', skin: '#f5d3b5' }),
    kidConeA: () => personGeo({ kid: true, shirt: '#ff6b5c', hair: '#3a2a2c', cone: '#ff8fab' }),
    kidConeB: () => personGeo({ kid: true, shirt: '#ffb81f', hair: '#6b4a2e', skin: '#a8714a', cone: '#8fe0c4' }),
    kidConeC: () => personGeo({ kid: true, shirt: '#5d73e8', hair: '#1f1b22', skin: '#f5d3b5', cone: '#fff3b8' }),
    kidBalloon: () => personGeo({ kid: true, shirt: '#6fc45a', hair: '#3a2a2c', skin: '#d9a679', balloon: '#ff6b5c', arms: 'up' }),
    kidWave: () => personGeo({ kid: true, shirt: '#6fc45a', hair: '#3a2a2c', skin: '#d9a679', arms: 'up' }),
    drummer: () => personGeo({ shirt: '#e8473b', stripe: '#ffd45c', pants: '#3a343f', drum: true }),
    cymbal: () => personGeo({ shirt: '#ffb81f', pants: '#3a343f', cymbal: true, skin: '#d9a679' }),
    flag: () => personGeo({ shirt: '#19a79b', stripe: '#ffd45c', pants: '#3a343f', flag: '#e8473b', skin: '#f5d3b5' }),
    elf: () => personGeo({ shirt: '#3a9d5f', stripe: '#ffd45c', pants: '#e8473b', hat: 'elf', hatCol: '#e8473b' }),
    elfBell: () => personGeo({ shirt: '#e8473b', stripe: '#ffffff', pants: '#3a9d5f', hat: 'elf', hatCol: '#3a9d5f', flag: '#ffd45c' }),
    otter: () => otterGeo(false), otterPup: () => otterGeo(true),
    lion: lionGeo, float: floatGeo, kiosk: kioskGeo, crate: () => crateGeo(5), bin: binGeo, trolley: trolleyGeo, balloon: balloonGeo,
  };
  const crowd = {};
  let crowdGroup = null;
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function look(name) {
    let c = crowd[name];
    if (c) return c;
    const geo = name.indexOf('crate') === 0 && name !== 'crate' ? crateGeo(+name.slice(5) || 1) : LOOKS[name]();
    const m = new THREE.InstancedMesh(geo, BB.mk.mat, 10);
    m.name = 'ev:' + name; m.frustumCulled = false; m.count = 0; m.visible = false;
    c = crowd[name] = { m, n: 0 };
    if (!crowdGroup) { crowdGroup = new THREE.Group(); crowdGroup.name = 'eventPeople'; }
    crowdGroup.add(m);
    return c;
  }
  // put one of `name` at (x, y, z) facing heading h; tilt = lean forward (+) / back, roll = sideways wobble
  const LOOK_SCALE = { otter: 5, otterPup: 5, lion: 1.3, float: 1.3, kiosk: 1 };
  function put(name, x, y, z, h, s = 1, tilt = 0, roll = 0) {
    const c = look(name);
    s *= LOOK_SCALE[name] || 1.15;
    if (c.n >= 10) return;
    _eu.set(tilt, h, roll, 'YXZ'); _q.setFromEuler(_eu);
    c.m.setMatrixAt(c.n++, _m4.compose(_p.set(x, y, z), _q, _s.set(s, s, s)));
  }
  function crowdBegin() { for (const k in crowd) crowd[k].n = 0; }
  function crowdEnd() {
    let any = false;
    for (const k in crowd) {
      const c = crowd[k];
      if (c.m.count !== c.n || c.n) { c.m.count = c.n; c.m.visible = c.n > 0; if (c.n) c.m.instanceMatrix.needsUpdate = true; }
      any = any || c.n > 0;
    }
    if (crowdGroup) {
      if (any && !crowdGroup.parent && BB.scene) BB.scene.add(crowdGroup);
      else if (!any && crowdGroup.parent) crowdGroup.parent.remove(crowdGroup);
    }
  }
  const gy = (x, z) => (W().groundY ? W().groundY(x, z) : 0);

  // ---------- vehicles: one merged body (own material, so it can go see-through) + one flashing lights mesh ----------
  // Local frame: +z forward, +x = the vehicle's LEFT (the kerb side when parked), y up from the road.
  function wheels(b, w, zs, r = 0.42) {
    for (const z of zs) for (const s of [1, -1]) {
      b.add(CYL(r, 0.32, 10), '#2f2a33', s * (w / 2 - 0.14), r, z, 0, 0, Math.PI / 2);
      b.add(CYL(r * 0.5, 0.34, 8), '#d9d2c6', s * (w / 2 - 0.12), r, z, 0, 0, Math.PI / 2);
    }
  }
  const shadowUnder = (b, w, l) => b.box(w + 0.5, 0.02, l + 0.5, '#5f5866', 0, 0.045, 0);
  const glass = '#3f5f7d';
  // lights(b, on): draws the flashing lights in their "on" or "off" phase
  const VEH = {
    fire: { len: 8.4, w: 2.5, body(b) {
      const red = '#e8473b', dk = '#b8352b';
      shadowUnder(b, 2.5, 8.4);
      b.box(2.3, 0.5, 8.0, '#3a343f', 0, 0.45, 0);
      b.box(2.5, 2.0, 2.3, red, 0, 0.8, 2.95); b.box(2.2, 0.9, 0.06, glass, 0, 1.75, 4.11);
      for (const s of [1, -1]) b.box(0.06, 0.8, 1.2, glass, s * 1.26, 1.8, 3.1);
      b.box(2.5, 1.95, 5.5, red, 0, 0.8, -1.1);
      b.box(2.54, 0.22, 8.0, '#fff6e0', 0, 1.35, 0.15);
      for (const z of [-3.2, -1.6, 0.0]) for (const s of [1, -1]) b.box(0.05, 1.3, 0.06, dk, s * 1.27, 0.95, z);
      b.box(2.3, 0.12, 5.2, '#cfc6b8', 0, 2.75, -1.1);
      for (const x of [-0.55, 0.55]) b.box(0.12, 0.14, 6.8, '#e9e2d6', x, 2.88, -0.6);
      for (let z = -3.8; z <= 2.6; z += 0.55) b.box(1.1, 0.08, 0.08, '#e9e2d6', 0, 2.92, z);
      b.add(CYL(0.42, 0.9, 10), '#ffd45c', 0, 1.65, -3.9, 0, 0, Math.PI / 2);
      b.box(2.5, 0.35, 0.3, '#d9d2c6', 0, 0.5, 4.2);
      for (const s of [1, -1]) { b.box(0.42, 0.24, 0.06, '#fff6c8', s * 0.85, 1.05, 4.12); b.box(0.3, 0.26, 0.06, '#ff4a3a', s * 0.95, 1.0, -3.88); }
      wheels(b, 2.5, [2.9, -1.6, -3.0], 0.48);
    }, lights(b, on) {
      b.box(1.9, 0.12, 0.42, '#5a5260', 0, 2.8, 3.0);
      b.box(0.8, 0.26, 0.4, on ? '#ff3b2e' : '#ffe9c8', 0.5, 2.9, 3.0); b.box(0.8, 0.26, 0.4, on ? '#ffe9c8' : '#ff3b2e', -0.5, 2.9, 3.0);
      for (const s of [1, -1]) b.box(0.08, 0.2, 0.3, (on ? s > 0 : s < 0) ? '#ff3b2e' : '#ffd0c0', s * 1.27, 2.4, -3.7);
    } },
    ambulance: { len: 6.6, w: 2.3, body(b) {
      const wh = '#fbf7ee';
      shadowUnder(b, 2.3, 6.6);
      b.box(2.2, 0.4, 6.3, '#3a343f', 0, 0.45, 0);
      b.box(2.3, 2.5, 4.4, wh, 0, 0.6, -1.0);
      b.box(2.25, 1.5, 1.9, wh, 0, 0.6, 2.2); b.box(2.0, 0.7, 0.06, glass, 0, 1.4, 3.16);
      for (const s of [1, -1]) b.box(0.06, 0.6, 1.0, glass, s * 1.13, 1.45, 2.3);
      for (let k = 0; k < 8; k++) for (const s of [1, -1]) b.box(0.05, 0.36, 0.78, k % 2 ? '#ffd45c' : '#19a79b', s * 1.16, 1.0, -3.0 + k * 0.78 + 0.39);
      for (const s of [1, -1]) {           // a coral heart on each side (no protected emblems)
        b.add(new THREE.SphereGeometry(0.26, 8, 6), '#ff6b5c', s * 1.16, 2.25, -1.0 - 0.2, 0, 0, 0, 0.25, 1, 1);
        b.add(new THREE.SphereGeometry(0.26, 8, 6), '#ff6b5c', s * 1.16, 2.25, -1.0 + 0.2, 0, 0, 0, 0.25, 1, 1);
        b.add(new THREE.BoxGeometry(0.06, 0.4, 0.4), '#ff6b5c', s * 1.16, 2.02, -1.0, 0, Math.PI / 4, 0);
      }
      b.box(2.3, 0.3, 0.25, '#d9d2c6', 0, 0.5, 3.2);
      for (const s of [1, -1]) { b.box(0.38, 0.22, 0.06, '#fff6c8', s * 0.8, 0.95, 3.17); b.box(0.28, 0.3, 0.06, '#ff4a3a', s * 0.9, 1.2, -3.22); }
      wheels(b, 2.3, [2.2, -2.2]);
    }, lights(b, on) {
      b.box(1.7, 0.1, 0.4, '#5a5260', 0, 3.1, 0.9);
      b.box(0.75, 0.24, 0.38, on ? '#4f8bff' : '#e6f0ff', 0.45, 3.2, 0.9); b.box(0.75, 0.24, 0.38, on ? '#e6f0ff' : '#4f8bff', -0.45, 3.2, 0.9);
      for (const s of [1, -1]) b.box(0.08, 0.18, 0.18, (on ? s > 0 : s < 0) ? '#4f8bff' : '#dfe8ff', s * 1.17, 2.9, -3.1);
    } },
    police: { len: 4.7, w: 2.0, body(b) {
      const wh = '#fbf7ee', blue = '#2f5fb3';
      shadowUnder(b, 2.0, 4.7);
      b.box(2.0, 0.75, 4.6, wh, 0, 0.35, 0); b.box(2.02, 0.3, 4.62, blue, 0, 0.62, 0);
      for (let k = 0; k < 8; k++) for (const s of [1, -1]) b.box(0.04, 0.15, 0.55, k % 2 ? wh : blue, s * 1.02, 0.66, -1.9 + k * 0.55);
      b.box(1.8, 0.7, 2.4, wh, 0, 1.1, -0.3); b.box(1.7, 0.55, 0.05, glass, 0, 1.18, 0.92, 0, -0.45);
      for (const s of [1, -1]) b.box(0.05, 0.5, 2.0, glass, s * 0.91, 1.2, -0.3);
      b.box(1.6, 0.5, 0.05, glass, 0, 1.2, -1.52, 0, 0.4);
      for (const s of [1, -1]) { b.box(0.36, 0.18, 0.05, '#fff6c8', s * 0.65, 0.8, 2.31); b.box(0.3, 0.18, 0.05, '#ff4a3a', s * 0.7, 0.85, -2.31); }
      b.box(2.0, 0.22, 0.18, '#d9d2c6', 0, 0.3, 2.35); b.box(2.0, 0.22, 0.18, '#d9d2c6', 0, 0.3, -2.35);
      wheels(b, 2.0, [1.45, -1.45], 0.36);
    }, lights(b, on) {
      b.box(1.3, 0.1, 0.36, '#5a5260', 0, 1.8, -0.3);
      b.box(0.55, 0.2, 0.34, on ? '#ff3b4e' : '#3d6fff', 0.35, 1.9, -0.3); b.box(0.55, 0.2, 0.34, on ? '#3d6fff' : '#ff3b4e', -0.35, 1.9, -0.3);
    } },
    tow: { len: 6.6, w: 2.4, body(b) {
      shadowUnder(b, 2.4, 6.6);
      b.box(2.3, 0.45, 6.4, '#ff9a3c', 0, 0.45, -0.2);
      b.box(2.3, 1.25, 2.4, '#ffb81f', 0, 0.9, 1.6); b.box(2.0, 0.85, 0.06, glass, 0, 1.6, 2.81);
      for (const s of [1, -1]) b.box(0.06, 0.75, 1.3, glass, s * 1.16, 1.65, 1.6);
      b.box(1.8, 0.3, 3.4, '#e9e2d6', 0, 1.3, -1.6);
      b.box(0.4, 1.4, 0.4, P.coral || '#ff6b5c', 0, 1.6, -0.6);
      b.box(0.35, 0.35, 3.2, P.coral || '#ff6b5c', 0, 2.7, -1.9, 0, -0.45);
      b.box(0.06, 1.2, 0.06, '#5a5260', 0, 2.0, -3.35);
      for (let k = 0; k < 4; k++) b.box(0.3, 0.12, 0.2, k % 2 ? '#3a2a3c' : (P.honey || '#ffb81f'), -0.45 + k * 0.3, 0.75, -3.42);
      for (const s of [1, -1]) { b.box(0.4, 0.22, 0.06, '#fff6c8', s * 0.86, 0.95, 2.81); b.box(0.3, 0.3, 0.06, '#ff4a3a', s * 0.85, 0.75, -3.42); }
      wheels(b, 2.4, [1.6, -1.8], 0.48);
    }, lights(b, on) {
      b.box(1.7, 0.22, 0.4, on ? '#ffd45c' : '#ff6b2c', 0, 2.2, 1.6);
    } },
    car: { len: 4.2, w: 1.9, body(b) {
      const col = '#7fb2e5', dk = '#5f93c9';
      shadowUnder(b, 1.9, 4.2);
      b.box(1.9, 0.7, 4.1, col, 0, 0.35, 0); b.box(1.7, 0.65, 2.1, col, 0, 1.05, -0.35);
      b.box(1.6, 0.5, 0.05, glass, 0, 1.12, 0.72, 0, -0.4); b.box(1.5, 0.45, 0.05, glass, 0, 1.12, -1.42, 0, 0.35);
      for (const s of [1, -1]) b.box(0.05, 0.42, 1.7, glass, s * 0.86, 1.15, -0.35);
      b.box(1.7, 0.06, 1.2, dk, 0, 1.18, 1.62, 0, -0.75);                                // the bonnet, up
      for (const s of [1, -1]) b.box(0.34, 0.16, 0.05, '#fff6c8', s * 0.6, 0.75, 2.06);
      b.box(1.9, 0.2, 0.14, '#d9d2c6', 0, 0.28, 2.1); b.box(1.9, 0.2, 0.14, '#d9d2c6', 0, 0.28, -2.1);
      wheels(b, 1.9, [1.3, -1.3], 0.34);
    }, lights(b, on) {
      const c = on ? '#ffb31f' : '#8a6a3a';
      for (const s of [1, -1]) { b.box(0.22, 0.14, 0.06, c, s * 0.82, 0.62, 2.08); b.box(0.22, 0.16, 0.06, c, s * 0.82, 0.7, -2.08); }
    } },
    iceCream: { len: 5.6, w: 2.3, body(b) {
      const cream = '#fff6e0', pink = '#ff8fab';
      shadowUnder(b, 2.3, 5.6);
      b.box(2.2, 0.4, 5.4, '#3a343f', 0, 0.42, 0);
      b.box(2.3, 1.0, 3.8, pink, 0, 0.6, -0.8); b.box(2.3, 1.3, 3.8, cream, 0, 1.6, -0.8);
      b.box(2.32, 0.18, 3.82, '#8fe0c4', 0, 1.55, -0.8);
      b.box(2.2, 1.3, 1.6, pink, 0, 0.6, 1.9); b.box(2.0, 0.8, 0.06, glass, 0, 1.15, 2.71, 0, -0.25);
      b.box(0.06, 0.9, 2.2, '#5a4a5c', 1.16, 1.7, -0.8);                                   // the serving window (kerb side)
      for (let k = 0; k < 6; k++) b.box(0.6, 0.06, 0.38, k % 2 ? '#ffffff' : pink, 1.4, 2.62, -1.75 + k * 0.38, 0, 0, -0.45);   // awning
      b.box(0.3, 0.12, 2.3, '#ffd45c', 1.32, 1.62, -0.8);                                  // the counter
      b.add(new THREE.ConeGeometry(0.55, 1.3, 8), '#e2b07c', 0, 3.55, -0.8, 0, Math.PI, 0);  // the big cone on the roof
      b.ball(0.62, pink, 0, 4.25, -0.8, 1); b.ball(0.45, '#8fe0c4', 0, 4.8, -0.8, 1); b.ball(0.14, '#e8473b', 0, 5.25, -0.8);
      b.box(2.3, 0.3, 0.2, '#d9d2c6', 0, 0.45, 2.75);
      for (const s of [1, -1]) b.box(0.34, 0.2, 0.05, '#fff6c8', s * 0.75, 0.9, 2.72);
      wheels(b, 2.3, [1.8, -1.9], 0.4);
    }, lights(b, on) {
      const cs = ['#ff6b5c', '#ffd45c', '#8fe0c4', '#5d73e8'];
      for (let k = 0; k < 8; k++) for (const s of [1, -1]) b.box(0.12, 0.12, 0.12, cs[(k + (on ? 0 : 1) + (s > 0 ? 0 : 2)) % 4], s * 1.12, 2.3, -2.55 + k * 0.5);
    } },
    milk: { len: 4.9, w: 2.1, body(b) {
      const wh = '#fbf7ee', blue = '#4fa3e0';
      shadowUnder(b, 2.1, 4.9);
      b.box(2.0, 0.4, 4.7, '#3a343f', 0, 0.42, 0);
      b.box(2.1, 1.5, 1.7, wh, 0, 0.55, 1.4); b.box(1.9, 0.7, 0.05, glass, 0, 1.25, 2.26, 0, -0.2);
      for (const s of [1, -1]) b.box(0.05, 0.55, 0.9, glass, s * 1.06, 1.3, 1.45);
      b.box(2.12, 0.2, 1.72, blue, 0, 1.0, 1.4);
      b.box(2.1, 0.25, 3.0, wh, 0, 0.75, -0.95);                                             // the open back
      for (const s of [1, -1]) b.box(0.08, 0.5, 3.0, blue, s * 1.02, 0.95, -0.95);
      b.box(2.1, 0.5, 0.08, blue, 0, 0.95, -2.42);
      b.box(2.1, 1.4, 0.15, wh, 0, 1.05, 0.48); b.ball(0.32, blue, 0, 2.1, 1.3, 0, 1.4, 0.5, 1);
      for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) {                               // crates in the back
        const z = -1.9 + k * 0.9, y = 1.0 + r * 0.34;
        b.box(1.1, 0.34, 0.6, '#4fa3e0', -0.15, y, z); for (let i = 0; i < 5; i++) b.cyl(0.08, 0.08, 0.36, 6, '#fbf7ee', -0.57 + i * 0.21, y + 0.1, z);
      }
      for (const s of [1, -1]) b.box(0.32, 0.18, 0.05, '#fff6c8', s * 0.7, 0.85, 2.26);
      wheels(b, 2.1, [1.45, -1.5], 0.38);
    } },
    rubbish: { len: 7.6, w: 2.5, body(b) {
      const grn = '#3f9a52', lt = '#7cc36a';
      shadowUnder(b, 2.5, 7.6);
      b.box(2.3, 0.45, 7.4, '#3a343f', 0, 0.45, 0);
      b.box(2.5, 2.0, 2.0, grn, 0, 0.8, 2.75); b.box(2.2, 0.85, 0.06, glass, 0, 1.75, 3.76);
      for (const s of [1, -1]) b.box(0.06, 0.75, 1.1, glass, s * 1.26, 1.8, 2.9);
      b.box(2.5, 2.5, 4.6, lt, 0, 0.85, -0.6); b.box(2.3, 0.3, 4.4, lt, 0, 3.35, -0.6);
      for (let k = 0; k < 5; k++) b.box(2.56, 2.5, 0.12, grn, 0, 0.85, -2.6 + k * 1.0);
      b.box(2.5, 2.0, 1.0, '#5a5260', 0, 0.75, -3.4); b.box(2.0, 1.2, 0.08, '#2f2a33', 0, 1.1, -3.92);
      b.box(2.5, 0.3, 0.25, '#d9d2c6', 0, 0.5, 3.75);
      for (const s of [1, -1]) { b.box(0.4, 0.22, 0.06, '#fff6c8', s * 0.85, 1.0, 3.77); b.box(0.3, 0.3, 0.06, '#ff4a3a', s * 1.0, 1.0, -3.95); }
      wheels(b, 2.5, [2.7, -1.7, -2.9], 0.48);
    }, lights(b, on) {
      b.box(0.5, 0.25, 0.4, on ? '#ffb31f' : '#9a6a2a', 0.6, 2.8, 2.9); b.box(0.5, 0.25, 0.4, on ? '#9a6a2a' : '#ffb31f', -0.6, 2.8, 2.9);
    } },
  };
  const vehCache = {};
  const SV = 1.3;                       // event vehicles are drawn a bit bigger than life, so they read from the chase camera
  const VL = (k) => VEH[k].len * SV, VW = (k) => VEH[k].w * SV;
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  function vehicle(kind) {
    let v = vehCache[kind];
    if (!v) {
      const d = VEH[kind], b = BB.mk.builder(); d.body(b);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const g = new THREE.Group(); g.name = 'ev:' + kind;
      const body = new THREE.Mesh(b.geometry(), mat); body.name = kind + ':body'; g.add(body);
      let lights = null, geoOn = null, geoOff = null;
      if (d.lights) {
        const b1 = BB.mk.builder(); d.lights(b1, true); geoOn = b1.geometry();
        const b2 = BB.mk.builder(); d.lights(b2, false); geoOff = b2.geometry();
        lights = new THREE.Mesh(geoOn, lightMat); lights.name = kind + ':lights'; g.add(lights);
      }
      g.scale.setScalar(SV);
      v = vehCache[kind] = { kind, g, body, mat, lights, geoOn, geoOff, len: d.len * SV, w: d.w * SV, flash: 0, ghost: false, lit: false };
    }
    if (v.g.parent) v.g.parent.remove(v.g);
    v.g.position.set(0, -50, 0); v.g.rotation.set(0, 0, 0); v.g.scale.setScalar(SV); v.g.visible = true;
    v.setLights = (on) => { v.lit = !!on; if (v.lights) v.lights.visible = !!on; };
    v.setLights(false); setGhost(v, false);
    if (BB.scene) BB.scene.add(v.g);
    return v;
  }
  function setGhost(v, on) {
    if (v.ghost === on) return;
    v.ghost = on; v.mat.transparent = on; v.mat.opacity = on ? 0.32 : 1; v.mat.depthWrite = !on; v.mat.needsUpdate = true;
  }
  function flash(v, dt, hz = 4) {
    if (!v.lights || !v.lit) return;
    v.flash += dt * hz;
    v.lights.geometry = Math.floor(v.flash) % 2 ? v.geoOff : v.geoOn;
  }
  function dropVehicle(v) { if (v && v.g.parent) v.g.parent.remove(v.g); }
  // the bus's two ends (front carriage, rear carriage) in world space
  function busPts() { const B = Bs(); return B && B.front ? [B.front.position, B.rear ? B.rear.position : B.front.position] : []; }
  function nearBus(x, z, r) { for (const p of busPts()) if (Math.hypot(p.x - x, p.z - z) < r) return true; return false; }
  // (x, z) within r of the bus's centre line (front carriage to rear carriage, plus a little beyond each end)
  function overlapsBus(x, z, r) {
    const pts = busPts(); if (pts.length < 2) return false;
    const a = pts[0], b = pts[1], B = Bs(), fx = Math.sin(B.heading), fz = Math.cos(B.heading);
    const ax = a.x + fx * 3.5, az = a.z + fz * 3.5, bx = b.x - (a.x - b.x === 0 && a.z - b.z === 0 ? fx * 3.5 : 0), bz = b.z - (a.x - b.x === 0 && a.z - b.z === 0 ? fz * 3.5 : 0);
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / l2, -0.15, 1.15);
    return Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < r;
  }

  // ---------- roads: routes along the graph ----------
  // walk(e, s, dir, L): from distance s along edge e, travelling dir (+1 = a->b), for L units, going as straight as
  // possible at junctions (never into the depot yard). Returns segments [{e, dir, s0, s1}].
  function routeDirAt(x, z) {                    // the ribbon's direction just past the point nearest (x, z), or null
    const pts = Bs() && Bs().route; if (!pts || pts.length < 3) return null;
    let bi = -1, bd = 18;
    for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i].x - x, pts[i].z - z); if (d < bd) { bd = d; bi = i; } }
    if (bi < 0) return null;
    let j = bi, acc = 0; while (j < pts.length - 1 && acc < 14) { acc += Math.hypot(pts[j + 1].x - pts[j].x, pts[j + 1].z - pts[j].z); j++; }
    const dx = pts[j].x - x, dz = pts[j].z - z, l = Math.hypot(dx, dz); return l > 3 ? { x: dx / l, z: dz / l } : null;
  }
  function walk(e, s, dir, L, guide) {
    const segs = []; let rem = L;
    for (let guard = 0; guard < 14 && rem > 0.01; guard++) {
      const end = dir > 0 ? e.length : 0, avail = Math.abs(end - s), take = Math.min(avail, rem);
      if (take > 0.01) segs.push({ e, dir, s0: s, s1: s + dir * take });
      rem -= take;
      if (rem <= 0.01) break;
      const nodeId = dir > 0 ? e.b : e.a, n = W().node(nodeId);
      if (!n) break;
      const pe = W().pointAt(e, dir > 0 ? e.length - 0.01 : 0.01), rd = guide ? routeDirAt(n.x, n.z) : null;
      const hx = rd ? rd.x : pe.dx * dir, hz = rd ? rd.z : pe.dz * dir;
      let best = null, bestDot = -0.2;
      for (const id of n.edges) {
        if (id === e.id) continue;
        const e2 = W().edge(id); if (!e2 || e2.kind === 'yard') continue;
        const d2 = e2.a === nodeId ? 1 : -1, q = W().pointAt(e2, d2 > 0 ? Math.min(6, e2.length) : Math.max(0, e2.length - 6));
        const qx = q.x - n.x, qz = q.z - n.z, ql = Math.hypot(qx, qz) || 1, dot = (hx * qx + hz * qz) / ql;
        if (dot > bestDot) { bestDot = dot; best = { e: e2, dir: d2 }; }
      }
      if (!best) break;
      e = best.e; dir = best.dir; s = dir > 0 ? 0 : e.length;
    }
    return segs;
  }
  const segsLen = (segs) => segs.reduce((a, sg) => a + Math.abs(sg.s1 - sg.s0), 0);
  const reverseSegs = (segs) => segs.slice().reverse().map((sg) => ({ e: sg.e, dir: -sg.dir, s0: sg.s1, s1: sg.s0 }));
  function segPts(sg) {
    const e = sg.e, lo = Math.min(sg.s0, sg.s1), hi = Math.max(sg.s0, sg.s1), half = W().halfOf ? W().halfOf(e) : (e.half || C().roadHalf);
    const out = [W().pointAt(e, lo)];
    for (let i = 1; i < e.points.length - 1; i++) if (e.cum[i] > lo + 0.05 && e.cum[i] < hi - 0.05) out.push(e.points[i]);
    out.push(W().pointAt(e, hi));
    const pts = out.map((p) => ({ x: p.x, z: p.z, half }));
    return sg.s1 >= sg.s0 ? pts : pts.reverse();
  }
  // A route: the centre line through the segments with junction corners rounded (so offset lanes and pavements
  // never fold back on themselves), points every ~3 units, tangents and left normals.
  function buildRoute(segLists) {
    const raw = [];
    for (const segs of segLists) for (const sg of segs) for (const p of segPts(sg)) {
      const q = raw[raw.length - 1];
      if (!q || Math.hypot(p.x - q.x, p.z - q.z) > 0.3) raw.push(p);
    }
    if (raw.length < 2) return null;
    const fl = [raw[0]];
    for (let i = 1; i < raw.length - 1; i++) {
      const a = raw[i - 1], v = raw[i], c = raw[i + 1];
      let ux = v.x - a.x, uz = v.z - a.z; const l1 = Math.hypot(ux, uz) || 1; ux /= l1; uz /= l1;
      let wx = c.x - v.x, wz = c.z - v.z; const l2 = Math.hypot(wx, wz) || 1; wx /= l2; wz /= l2;
      const th = Math.acos(clamp(ux * wx + uz * wz, -1, 1));
      if (th < 0.2) { fl.push(v); continue; }
      const T = Math.min(18, l1 * 0.45, l2 * 0.45);
      const p1 = { x: v.x - ux * T, z: v.z - uz * T }, p2 = { x: v.x + wx * T, z: v.z + wz * T };
      for (let k = 0; k <= 8; k++) {
        const t = k / 8, m1 = (1 - t) * (1 - t), m2 = 2 * t * (1 - t), m3 = t * t;
        fl.push({ x: m1 * p1.x + m2 * v.x + m3 * p2.x, z: m1 * p1.z + m2 * v.z + m3 * p2.z, half: v.half });
      }
    }
    fl.push(raw[raw.length - 1]);
    const pts = [fl[0]];
    for (let i = 1; i < fl.length; i++) {
      const a = pts[pts.length - 1], b = fl[i], l = Math.hypot(b.x - a.x, b.z - a.z);
      if (l < 0.2) continue;
      const n = Math.ceil(l / 3);
      for (let k = 1; k <= n; k++) pts.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n, half: k === n ? b.half : a.half });
    }
    const cum = [0];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; p.tx = tx / l; p.tz = tz / l;
      if (i) cum.push(cum[i - 1] + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z));
    }
    const r = { pts, cum, len: cum[cum.length - 1], _i: 1 };
    r.at = (d) => routeAt(r, d);
    return r;
  }
  function routeAt(r, d) {
    d = clamp(d, 0, r.len);
    let i = clamp(r._i, 1, r.pts.length - 1);
    while (i < r.pts.length - 1 && r.cum[i] < d) i++;
    while (i > 1 && r.cum[i - 1] > d) i--;
    r._i = i;
    const a = r.pts[i - 1], b = r.pts[i], l = r.cum[i] - r.cum[i - 1] || 1, t = (d - r.cum[i - 1]) / l;
    let tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t; const n = Math.hypot(tx, tz) || 1; tx /= n; tz /= n;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx, tz, lx: tz, lz: -tx, half: a.half + (b.half - a.half) * t };
  }
  // nearest point of a route (between distances d0..d1) to (x, z): {d, lat (+ = left of travel), half, dist}
  function project(r, x, z, d0 = 0, d1 = Infinity) {
    let best = null;
    for (let i = 1; i < r.pts.length; i++) {
      if (r.cum[i] < d0 || r.cum[i - 1] > d1) continue;
      const a = r.pts[i - 1], b = r.pts[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1), qx = a.x + dx * t, qz = a.z + dz * t, dd = Math.hypot(x - qx, z - qz);
      if (!best || dd < best.dist) {
        const l = Math.sqrt(l2), lx = dz / l, lz = -dx / l;
        best = { d: r.cum[i - 1] + t * l, lat: (x - qx) * lx + (z - qz) * lz, half: a.half, dist: dd };
      }
    }
    return best;
  }
  // where the bus is on the road graph: {e, s, dir (+1 = a->b), off (+ = left of travel)}
  function busRoad() {
    const B = Bs(); if (!B || !B.front || !B.nearestRoad) return null;
    const nr = B.nearestRoad(B.pos.x, B.pos.z, B.heading);
    if (!nr || nr.d > (nr.edge.half || 9.2) + 2 || nr.edge.kind === 'yard') return null;
    const fx = Math.sin(B.heading), fz = Math.cos(B.heading), dir = fx * nr.dx + fz * nr.dz >= 0 ? 1 : -1;
    const tx = nr.dx * dir, tz = nr.dz * dir;
    return { e: nr.edge, s: nr.s, dir, off: (B.pos.x - nr.x) * tz + (B.pos.z - nr.z) * -tx };
  }
  // Oncoming route: from `ahead` units in front of the bus back toward it in the other carriageway, then on behind it.
  // The far side of the road (the bus's right) is the left kerb of this route. bus = the bus's distance along it.
  function oncoming(ahead, behind) {
    const br = busRoad(); if (!br) return null;
    const fwd = walk(br.e, br.s, br.dir, ahead, true), back = walk(br.e, br.s, -br.dir, behind);
    const r = buildRoute([reverseSegs(fwd), back]); if (!r) return null;
    r.bus = segsLen(fwd); r.br = br; r.sign = -1; r.far = true; r.d0 = 0; r.lane0 = C().lane;
    return r;
  }
  // Same-way route: from `behind` units behind the bus, through it and on ahead.
  function sameWay(behind, ahead) {
    const br = busRoad(); if (!br) return null;
    const back = walk(br.e, br.s, -br.dir, behind), fwd = walk(br.e, br.s, br.dir, ahead, true);
    const r = buildRoute([reverseSegs(back), fwd]); if (!r) return null;
    r.bus = segsLen(back); r.br = br; r.sign = 1; r.far = false;
    // something parking on the bus's own side comes from behind and overtakes in the other lane
    r.d0 = Math.max(0, r.bus - 45); r.lane0 = br.off > (C().laneDivider || 4.6) ? (C().laneInner || 2.5) : C().lane;
    return r;
  }
  // routes to stage a parked scene on: the far side of the road first, then the bus's own side
  function stageRoutes() {
    const out = [], a = oncoming(160, 90), b = sameWay(85, 150);
    if (a && a.bus > 110) out.push(a);
    if (b && b.len - b.bus > 90) out.push(b);
    return out;
  }
  // a parking spot is fine away from stops, junctions, the depot yard and solid things
  const stopList = () => { const w = W(); return (w.stops || []).concat([w.depot, w.washBay]).filter(Boolean); };
  function spotOK(x, z, rad = 2) {
    const w = W();
    const tgt = Bs() && Bs().target;
    for (const st of stopList()) {
      if (st.minor && st !== tgt) continue;       // events may pass beside the little stops the bus isn't going to
      const R = 18;
      if (st.pos && Math.hypot(st.pos.x - x, st.pos.z - z) < R) return false;
      const bay = w.bayOf ? safe(() => w.bayOf(st)) : null; if (bay && Math.hypot(bay.x - x, bay.z - z) < R) return false;
    }
    if (w.inDepotYard && w.inDepotYard(x, z)) return false;
    for (const n of w.roads.nodes) {           // clear of junction boxes (the widest road there, plus room to turn)
      if (n.edges.length < 3) continue;
      const hh = Math.max(...n.edges.map((id) => { const e = w.edge(id); return (e && e.half) || 9.2; }));
      if (Math.hypot(n.x - x, n.z - z) < hh + 5) return false;
    }
    for (const zb of zebras()) if (Math.hypot(zb.x - x, zb.z - z) < 12) return false;
    if (w.pushOut) { const q = w.pushOut(x, z, rad); if (q.hit > 0.15) return false; }
    return true;
  }
  // a parked vehicle of half-length hl at route distance d, kerb offset off: all clear?
  function parkOK(r, d, off, hl) {
    for (const k of [-hl, 0, hl]) { const p = r.at(d + k); if (!spotOK(p.x + p.lx * off, p.z + p.lz * off, 1.2)) return false; }
    return true;
  }
  const parkOff = (r, d, w) => r.at(d).half + w / 2 - 0.45;
  // the zebra crossings (world.js draws them near the busy places; same rule as there)
  let zebraCache = null;
  function zebras() {
    if (zebraCache) return zebraCache;
    const w = W(), out = [];
    for (const [a, b] of [['n10', 'n20'], ['n13', 'n23'], ['n01', 'n02'], ['n21', 'n22'], ['n11', 'n12']]) {
      const e = w.edgeBetween && w.edgeBetween(a, b); if (!e) continue;
      const half = e.half || C().roadHalf, st = (w.stops || []).concat([w.depot]).find((q) => q && q.edge === e.id);
      const s0 = half + 4, s1 = e.length - half - 4; let d = s0;
      if (st && w.bayOf) {
        const bay = w.bayOf(st), p0 = e.points[0], p1 = e.points[e.points.length - 1];
        const bp = (bay.x - p0.x) * (p1.x - p0.x) + (bay.z - p0.z) * (p1.z - p0.z);
        d = bp / e.length > e.length / 2 ? s0 : s1;
      }
      const p = w.pointAt(e, d);
      out.push({ x: p.x, z: p.z, dx: p.dx, dz: p.dz, half, park: a === 'n11' && b === 'n12' });
    }
    return (zebraCache = out);
  }

  // ---------- a vehicle driving along a route ----------
  // target: a distance to stop at (null: drive on). Moving vehicles wait while the bus is just ahead of them, and go
  // see-through while the bus overlaps them (the bus is never stopped or pushed).
  class Driver {
    constructor(v, r, o = {}) {
      this.v = v; this.r = r; this.d = o.d || 0; this.sp = o.sp || 0; this.vmax = o.vmax || 10;
      this.off = o.off != null ? o.off : C().lane; this.offT = this.off; this.target = o.target != null ? o.target : null;
      this.latV = 0; this.wait = 0; this.blocked = false; this.y = 0; this.hist = []; this.yieldBus = o.yieldBus !== false;
      this.place(0);
    }
    pose(d = this.d, off = this.off) { const p = this.r.at(d); return { x: p.x + p.lx * off, z: p.z + p.lz * off, h: Math.atan2(p.tx, p.tz), p }; }
    busAhead(sgn) {
      const hl = this.v.len / 2;
      for (const k of [1.2, 3.5, 6.5]) { const q = this.pose(this.d + sgn * (hl + k)); if (nearBus(q.x, q.z, 3.1)) return true; }
      return false;
    }
    get arrived() { return this.target != null && Math.abs(this.target - this.d) < 0.05 && Math.abs(this.sp) < 0.05; }
    update(dt) {
      let want = this.vmax;
      if (this.target != null) {
        const rem = this.target - this.d;
        want = Math.sign(rem) * Math.min(this.vmax, Math.sqrt(2 * 2.6 * Math.abs(rem)));
        if (Math.abs(rem) < 0.05) want = 0;
      }
      this.blocked = this.yieldBus && want !== 0 && this.busAhead(Math.sign(want));
      if (this.blocked) want = 0;
      this.wait = this.blocked ? this.wait + dt : 0;
      const speedingUp = Math.abs(want) > Math.abs(this.sp) && (Math.sign(want) === Math.sign(this.sp) || Math.abs(this.sp) < 0.05);
      const acc = speedingUp ? 3.4 : 6.5;
      this.sp += clamp(want - this.sp, -acc * dt, acc * dt);
      if (this.target != null && Math.abs(this.target - this.d) < 0.05 && Math.abs(want) < 0.01) { this.sp = 0; this.d = this.target; }
      this.d = clamp(this.d + this.sp * dt, 0, this.r.len);
      const dOff = clamp(this.offT - this.off, -2.3 * dt, 2.3 * dt);
      this.off += dOff; this.latV = dt > 0 ? dOff / dt : 0;
      this.hist.push(this.d, this.off); if (this.hist.length > 600) this.hist.splice(0, 2);
      this.place(dt);
    }
    // the (d, off) this vehicle had when it was `back` units further back along its trail (for something towed)
    trail(back) {
      const want = this.d - back;
      for (let i = this.hist.length - 2; i >= 0; i -= 2) if (this.hist[i] <= want) return { d: want, off: this.hist[i + 1] };
      return { d: want, off: this.hist.length ? this.hist[1] : this.off };
    }
    place(dt) {
      const q = this.pose(), v = this.v;
      const tilt = Math.abs(this.sp) > 0.2 ? Math.atan2(this.latV, Math.abs(this.sp) + 1.5) * Math.sign(this.sp) : 0;
      const g = gy(q.x, q.z); this.y += (g - this.y) * Math.min(1, (dt || 1) * 8);
      v.g.position.set(q.x, this.y, q.z); v.g.rotation.y = q.h + tilt;
      // see-through only when the bus really overlaps it (not when it simply passes in the next lane)
      const fx = Math.sin(q.h), fz = Math.cos(q.h); let hit = false;
      for (const k of [-0.4, 0, 0.4]) if (overlapsBus(q.x + fx * v.len * k, q.z + fz * v.len * k, 2.3)) { hit = true; break; }
      setGhost(v, hit);
      this.x = q.x; this.z = q.z; this.h = q.h + tilt;
    }
    get done() { return this.target == null && this.d >= this.r.len - 0.5; }
  }
  // world point in a vehicle's frame (lx = to its left, lz = forward)
  function local(dr, lx, lz, y = 0) { const h = dr.h, f = { x: Math.sin(h), z: Math.cos(h) }, l = { x: f.z, z: -f.x }; return { x: dr.x + l.x * lx + f.x * lz, y, z: dr.z + l.z * lx + f.z * lz }; }

  // ---------- seen in view? ----------
  const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _v3 = new THREE.Vector3();
  let frT = 0;
  function inView(x, y, z, maxD = 100) {
    const cam = BB.camera; if (!cam) return false;
    if (Math.hypot(x - cam.position.x, z - cam.position.z) > maxD) return false;
    return _fr.containsPoint(_v3.set(x, y, z));
  }
  function updateFrustum() { const cam = BB.camera; if (!cam) return; cam.updateMatrixWorld(); _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm); }

  // ---------- pictures (paper-cut, for the bubbles and the dashboard sticker) ----------
  const picCache = {};
  function pic(name) {
    if (picCache[name]) return picCache[name];
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); x.scale(1.28, 1.28); x.lineJoin = x.lineCap = 'round';
    const paper = BB.paper, rr = BB.paths ? BB.paths.rr : (p, X, Y, Wd, H) => p.rect(X, Y, Wd, H), arc = (p, X, Y, R) => { p.moveTo(X + R, Y); p.arc(X, Y, R, 0, Math.PI * 2); };
    if (!paper) return c;
    if (name === 'icecream') {
      paper(x, (p) => { p.moveTo(30, 48); p.lineTo(70, 48); p.lineTo(50, 96); p.closePath(); }, '#e2b07c', { rimColor: '#b58350' });
      x.strokeStyle = 'rgba(150,100,50,.55)'; x.lineWidth = 2; for (const k of [0, 1, 2]) { x.beginPath(); x.moveTo(34 + k * 10, 50); x.lineTo(56 + k * 4, 84 - k * 10); x.stroke(); }
      paper(x, (p) => arc(p, 50, 42, 21), '#ff8fab');
      paper(x, (p) => arc(p, 50, 22, 16), '#8fe0c4');
      paper(x, (p) => arc(p, 54, 7, 6), '#e8473b', { depth: 0.4 });
    } else if (name === 'firefighter') {
      paper(x, (p) => p.ellipse(50, 70, 44, 12, 0, 0, Math.PI * 2), '#ffb81f', { rimColor: '#d98700' });
      paper(x, (p) => { p.moveTo(14, 68); p.bezierCurveTo(14, 22, 86, 22, 86, 68); p.closePath(); }, '#ffd45c', { rimColor: '#d98700' });
      paper(x, (p) => rr(p, 44, 26, 12, 40, 5), '#ffb81f', { depth: 0.3, rim: false });
      paper(x, (p) => arc(p, 50, 50, 10), '#e8473b', { depth: 0.4 });
    } else if (name === 'bottle') {
      paper(x, (p) => { p.moveTo(38, 30); p.lineTo(62, 30); p.lineTo(62, 40); p.quadraticCurveTo(74, 48, 74, 60); p.lineTo(74, 90); p.quadraticCurveTo(74, 96, 68, 96); p.lineTo(32, 96); p.quadraticCurveTo(26, 96, 26, 90); p.lineTo(26, 60); p.quadraticCurveTo(26, 48, 38, 40); p.closePath(); }, '#fbf7ee', { rimColor: '#c9c2b5' });
      paper(x, (p) => rr(p, 36, 16, 28, 14, 4), '#4fa3e0', { depth: 0.4 });
      paper(x, (p) => rr(p, 30, 62, 40, 16, 4), '#4fa3e0', { depth: 0.3, rim: false });
    } else if (name === 'otter') {
      paper(x, (p) => { arc(p, 26, 30, 10); arc(p, 74, 30, 10); }, '#7a5236');
      paper(x, (p) => p.ellipse(50, 56, 38, 34, 0, 0, Math.PI * 2), '#8a6040', { rimColor: '#5e3e28' });
      paper(x, (p) => p.ellipse(50, 70, 22, 16, 0, 0, Math.PI * 2), '#d8b088', { depth: 0.3, rim: false });
      for (const ex of [36, 64]) { x.beginPath(); x.arc(ex, 50, 4.5, 0, 7); x.fillStyle = '#2a2024'; x.fill(); }
      x.beginPath(); x.ellipse(50, 63, 7, 5, 0, 0, 7); x.fillStyle = '#2a2024'; x.fill();
    }
    return (picCache[name] = c);
  }

  // ---------- the bonus counting bubble (optional; never asks for an answer) ----------
  // o: {pic, at() -> Vector3 (anchor), items() -> [Vector3], noun, groups (optional: numbers per crate)}
  BB.css(`
  .bbe-bub { position: absolute; left: 0; top: 0; z-index: 30; pointer-events: auto; display: flex; align-items: center; gap: 4px;
    padding: 5px 16px 5px 8px; background: #fff6e0; border: 4px solid #d9b57f; border-radius: 30px; box-shadow: 3px 5px 0 rgba(120,80,40,.18);
    font: 700 40px/1 ${BB.FONT}; color: #3a2a3c; transform: translate(-50%, -100%); touch-action: none; cursor: pointer;
    animation: bbe-in .35s ease-out; white-space: nowrap; }
  .bbe-bub::after { content: ''; position: absolute; left: 50%; bottom: -15px; margin-left: -11px; border: 11px solid transparent; border-top: 13px solid #d9b57f; border-bottom: 0; }
  .bbe-bub canvas { width: 54px; height: 54px; display: block; }
  .bbe-bub .n { min-width: 30px; text-align: center; }
  .bbe-bub .n.got { color: #19a79b; }
  .bbe-bub.pressed { filter: brightness(.95); }
  .bbe-num { position: absolute; left: 0; top: 0; z-index: 29; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%;
    background: #19a79b; border: 3px solid #0f7f75; color: #fff; font: 700 24px/34px ${BB.FONT}; text-align: center; pointer-events: none;
    box-shadow: 2px 3px 0 rgba(0,60,50,.25); animation: bbe-pop .3s ease-out; }
  .bbe-stk { position: absolute; left: calc(var(--sl, 12px) + 4px); top: calc(var(--st, 10px) + var(--bh, 80px) + 14px); display: flex; gap: 2px; pointer-events: none; z-index: 6; }
  .bbe-stk canvas { width: 44px; height: 44px; filter: drop-shadow(2px 3px 0 rgba(120,80,40,.22)); animation: bbe-pop .45s ease-out; }
  #ui.home .bbe-stk, .bbu-hud.off ~ .bbe-stk, #ui.home .bbe-bub, #ui.home .bbe-num { display: none; }
  @keyframes bbe-in { 0% { transform: translate(-50%, -100%) scale(.3); opacity: 0; } 70% { transform: translate(-50%, -100%) scale(1.08); } 100% { transform: translate(-50%, -100%) scale(1); } }
  @keyframes bbe-pop { 0% { transform: scale(.2); opacity: 0; } 70% { transform: scale(1.15); } 100% { transform: scale(1); } }
  `);
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const uiRoot = () => (BB.ui && BB.ui.root) || document.getElementById('ui') || document.body;
  let bubble = null;
  function showBubble(o) {
    hideBubble();
    if (quiet()) return null;
    const el = BB.el('div', 'bbe-bub', uiRoot());
    el.appendChild(pic(o.pic));
    const n = BB.el('span', 'n', el, '?');
    const bb = bubble = { o, el, n, nums: [], counting: false, t: 0, life: o.life || 14 };
    BB.tap(el, () => countAloud(bb));
    positionBubble(bb);
    BB.sfx && BB.sfx.pop && BB.sfx.pop();
    return bb;
  }
  function hideBubble() {
    if (!bubble) return;
    for (const t of bubble.timers || []) BB.cancelLater(t);
    bubble.el.remove(); for (const m of bubble.nums) m.el.remove();
    bubble = null;
  }
  function countAloud(bb) {
    if (bb.counting || bubble !== bb) return;
    bb.counting = true; bb.life = Math.max(bb.life, bb.t + 8);
    const items = bb.o.items(), total = Math.min(10, items.length);
    if (!total) return;
    let line;
    if (bb.o.groups && bb.o.groups.length > 1) {
      const g = bb.o.groups;
      line = `${WORDS[g[0]]}, and ${WORDS[total - g[0]]} more. ${WORDS[total]} ${bb.o.noun}!`;
    } else line = items.slice(0, total).map((_, i) => WORDS[i + 1]).join(', ') + `! ${WORDS[total]} ${total === 1 ? bb.o.one || bb.o.noun : bb.o.noun}!`;
    BB.say(line[0].toUpperCase() + line.slice(1), { queue: false });
    bb.timers = [];
    for (let i = 0; i < total; i++) {
      bb.timers.push(BB.later(i * 420, () => {
        if (bubble !== bb) return;
        const m = { el: BB.el('div', 'bbe-num', uiRoot(), String(i + 1)), i };
        bb.nums.push(m); BB.sfx && BB.sfx.tick && BB.sfx.tick();
        if (i === total - 1) { bb.n.textContent = String(total); bb.n.classList.add('got'); }
      }));
    }
  }
  function project2(v) {
    const cam = BB.camera, root = uiRoot(); if (!cam || !root) return null;
    const p = v.clone().project(cam);
    if (p.z > 1 || p.z < -1) return null;
    const wd = root.clientWidth || innerWidth, ht = root.clientHeight || innerHeight;
    return { x: (p.x + 1) / 2 * wd, y: (1 - p.y) / 2 * ht, wd, ht };
  }
  function positionBubble(bb) {
    const s = project2(bb.o.at());
    if (!s) { bb.el.style.visibility = 'hidden'; } else {
      bb.el.style.visibility = '';
      bb.el.style.left = clamp(s.x, 80, s.wd - 80) + 'px'; bb.el.style.top = clamp(s.y, 150, s.ht - 40) + 'px';
    }
    if (bb.nums.length) {
      const items = bb.o.items();
      for (const m of bb.nums) {
        const q = items[m.i] ? project2(items[m.i]) : null;
        if (!q) { m.el.style.visibility = 'hidden'; continue; }
        m.el.style.visibility = ''; m.el.style.left = q.x + 'px'; m.el.style.top = (q.y - 6) + 'px';
      }
    }
  }
  function updateBubble(dt) {
    if (!bubble) return;
    bubble.t += dt;
    if (quiet() || bubble.t > bubble.life) { hideBubble(); return; }
    positionBubble(bubble);
  }
  // the ice cream sticker on the dashboard (this drive only)
  let stickers = null;
  function addSticker() {
    if (!stickers) stickers = BB.el('div', 'bbe-stk', uiRoot());
    if (stickers.childElementCount >= 5) stickers.firstChild.remove();
    const c = document.createElement('canvas'); c.width = c.height = 128; c.getContext('2d').drawImage(pic('icecream'), 0, 0);
    stickers.appendChild(c);
  }

  // ---------- helpers for events ----------
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const seenNow = () => !!(E.current && E.current.seen);     // the child has had a good look at this event
  const busNear = (x, z, r) => { const B = Bs(); return !!(B && B.front && Math.hypot(B.pos.x - x, B.pos.z - z) < r); };
  const busDist = (x, z) => { const B = Bs(); return B && B.front ? Math.hypot(B.pos.x - x, B.pos.z - z) : 1e9; };
  function nearStop(ids, R) { for (const st of stopList()) if (ids.indexOf(st.id) >= 0 && st.pos && busNear(st.pos.x, st.pos.z, R)) return st; return null; }
  // candidate buildings (box colliders) on the far side of an oncoming route, `aheadMin..aheadMax` in front of the bus
  const aheadOf = (r, d) => (r.sign > 0 ? d - r.bus : r.bus - d);
  function buildingsAhead(r, aheadMin, aheadMax, topMin = 6, topMax = 36, faceMax = 16) {
    const w = W(), out = [], B = Bs();
    for (const c of w.colliders || []) {
      if (c.r != null || c.top == null || c.top < topMin || c.top > topMax || Math.min(c.hw, c.hd) < 2.2) continue;
      if (Math.abs(c.x - B.pos.x) > 160 || Math.abs(c.z - B.pos.z) > 160) continue;
      if (w.inDepotYard && w.inDepotYard(c.x, c.z)) continue;
      const pr = r.sign > 0 ? project(r, c.x, c.z, r.bus, r.len) : project(r, c.x, c.z, 0, r.bus); if (!pr) continue;
      const ahead = aheadOf(r, pr.d); if (ahead < aheadMin || ahead > aheadMax) continue;
      const face = pr.lat - Math.min(c.hw, c.hd);
      if (pr.lat < pr.half + 4 || face > pr.half + faceMax) continue;
      out.push({ c, d: pr.d, lat: pr.lat, face });
    }
    return out.sort((a, b) => a.face - b.face);
  }
  // the point on a box collider nearest to (x, z), moved `out` units outside it, at height y
  function boxFace(c, x, z, out, y) {
    const cs = c.cos != null ? c.cos : Math.cos(c.ry || 0), sn = c.sin != null ? c.sin : Math.sin(c.ry || 0);
    const dx = x - c.x, dz = z - c.z, lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    let qx = clamp(lx, -c.hw, c.hw), qz = clamp(lz, -c.hd, c.hd);
    const ox = lx - qx, oz = lz - qz, ol = Math.hypot(ox, oz) || 1;
    qx += ox / ol * out; qz += oz / ol * out;
    return V3(c.x + qx * cs + qz * sn, y, c.z - qx * sn + qz * cs);
  }
  // Can the chase camera see (x, y, z) well right now? In the picture (below the top bar), not under the MRT viaduct,
  // not behind a building or a post or pillar.
  function sightBlocked(x, y, z) {
    const cam = BB.camera, w = W(); if (!cam) return false;
    const c = cam.position;
    if (w.blocksSight && w.blocksSight(c.x, c.y, c.z, x, y, z)) return true;
    const dx = x - c.x, dz = z - c.z, L2 = dx * dx + dz * dz || 1;
    for (const k of w.colliders || []) {
      if (k.r == null || k.r < 0.5) continue;
      const t = ((k.x - c.x) * dx + (k.z - c.z) * dz) / L2; if (t < 0.12 || t > 0.97) continue;
      if (Math.hypot(k.x - (c.x + dx * t), k.z - (c.z + dz * t)) < k.r + 0.5) return true;
    }
    return false;
  }
  function underViaduct(x, z) { const v = W().viaduct; return !!(v && Math.abs(z - v.z) < v.halfW + 12 && x > v.x0 - 10 && x < v.x1 + 10); }
  function inFrame(x, y, z, m = 0.85, top = 0.7) {
    const cam = BB.camera; if (!cam) return false;
    const a = _v3.set(x, y, z).project(cam);
    return a.z < 1 && Math.abs(a.x) < m && a.y > -0.85 && a.y < top;
  }
  function stageOK(x, z, y = 1.5) { return !underViaduct(x, z) && inFrame(x, y, z, 0.82, 0.62) && !sightBlocked(x, y, z); }   // (the lower part of the picture)
  // how big (x, y, z) of height h and length wlen looks on screen, in CSS pixels (0 when out of the picture)
  function screenPx(x, y, z, h, wlen = 0, top = 0.7) {
    const cam = BB.camera; if (!cam || !inFrame(x, y + h / 2, z, 0.9, top)) return 0;
    const Hpx = (BB.renderer && BB.renderer.domElement.clientHeight) || innerHeight;
    const d = Math.max(1, Math.hypot(x - cam.position.x, y + h / 2 - cam.position.y, z - cam.position.z));
    return Math.max(h, 0.7 * wlen) * Hpx / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / d;
  }
  // seen: at least 60 px on screen, in the picture, in clear sight
  const SEEN_PX = 60;
  function bigOnScreen(x, y, z, h, wlen = 0, top = 0.7) { return screenPx(x, y, z, h, wlen, top) >= SEEN_PX && !sightBlocked(x, y + h / 2, z); }
  // A little roadside kiosk beside a parking spot, as a stand-in building: {c: box like a collider, kiosk: true}
  function kioskSpot(r, dPark, w) {
    const p = r.at(dPark), o = r.at(dPark).half + w + 2.6, x = p.x + p.lx * o, z = p.z + p.lz * o;
    if (!spotOK(x, z, 1.8) || !stageOK(x, z, 2)) return null;
    const ry = Math.atan2(-p.lx, -p.lz);                    // its front (+z) faces the road
    return { kiosk: true, c: { x, z, hw: 1.7, hd: 1.6, ry, cos: Math.cos(ry), sin: Math.sin(ry), top: 3.6 }, d: dPark };
  }
  // a parking distance on an oncoming route, `aheadMin..aheadMax` in front of the bus, for a vehicle of len x w
  function findPark(r, aheadMin, aheadMax, len, w) {
    for (let a = aheadMin; a <= aheadMax; a += 3) {
      const d = r.bus + (r.sign > 0 ? a : -a); if (d < len + 20 || d > r.len - len - 20) break;
      const p = r.at(d), o = parkOff(r, d, w);
      if (parkOK(r, d, o, len / 2) && stageOK(p.x + p.lx * o, p.z + p.lz * o)) return d;
    }
    return null;
  }

  // =====================================================================================================
  // The events. Each: {id, eligible() -> plan or null, start(plan) -> instance {update(dt) -> false when over, end()}}
  const EV = {};

  // ---- 1. fire truck to the rescue ----
  EV.fire = {
    weight: 3,
    plan(o = {}) {
      for (const r of stageRoutes()) for (const cand of buildingsAhead(r, 22, 55, 6, 36, 24)) {
        const dPark = cand.d;
        if (dPark < 30 || !parkOK(r, dPark, parkOff(r, dPark, VW('fire')), VL('fire') / 2)) continue;
        const p = r.at(dPark), o = parkOff(r, dPark, VW('fire'));
        const fx = p.x + p.lx * o, fz = p.z + p.lz * o, sm = boxFace(cand.c, fx, fz, 0.6, clamp(cand.c.top - 2.5, 3, 4.5));
        if (!stageOK(fx, fz) || underViaduct(sm.x, sm.z) || !inFrame(sm.x, sm.y, sm.z, 0.85, 0.75)) continue;
        return { r, cand, dPark };
      }
      for (const r of stageRoutes()) {             // no building handy: a kiosk with smoke coming out
        const dPark = findPark(r, 24, 56, VL('fire'), VW('fire')); if (dPark == null) continue;
        const cand = kioskSpot(r, dPark, VW('fire')); if (cand) return { r, cand, dPark };
      }
      return null;
    },
    start({ r, cand, dPark }) {
      const v = vehicle('fire'), off = parkOff(r, dPark, v.w);
      const dr = new Driver(v, r, { d: r.d0, off: r.lane0, vmax: r.far ? 11 : 15, target: dPark });
      const pp = dr.pose(dPark, off);
      const src = boxFace(cand.c, pp.x, pp.z, 0.6, clamp(cand.c.top - 2.5, 3, 4.5));
      const roof = boxFace(cand.c, pp.x, pp.z, -1.5, Math.min(cand.c.top, 14));
      let st = 'come', t = 0, fire = 1, sirenT = 0, smokeT = 0, sprayT = 0, hiss = null, said = false, steamT = 0, outT = 0;
      const crew = [];                       // {x, z, tx, tz, h}
      v.setLights(true);
      const me = {
        id: 'fire', spots: () => [['fireTruck', dr.x, 0, dr.z, 3.8, 'Oh! Smoke! Here comes the fire truck!', v.len], ['smoke', src.x, src.y, src.z, 7, 'Oh! Smoke! Here comes the fire truck!', 4]], at: () => src,
        update(dt) {
          t += dt; flash(v, dt);
          // smoke (grey, turning to white steam as the fire goes out), and a few orange flickers at first
          smokeT -= dt;
          if (fire > 0 && smokeT <= 0) {
            smokeT = 0.09 + (1 - fire) * 0.12;
            const g = Math.round(110 + 140 * (1 - fire)).toString(16).padStart(2, '0');
            emit({ x: src.x + rand(-0.6, 0.6), y: src.y, z: src.z + rand(-0.6, 0.6), vx: rand(0.2, 0.7), vy: rand(1.8, 2.6), vz: rand(-0.2, 0.4), life: rand(3.5, 5), size: 1.6, size1: 6.5, color: '#' + g + g + g, alpha: 0.75 * (0.5 + 0.5 * fire), drag: 0.15, fin: 0.12 });
            if (fire > 0.55 && Math.random() < 0.5) emit({ x: src.x + rand(-0.5, 0.5), y: src.y - 0.4, z: src.z + rand(-0.5, 0.5), vy: rand(1, 2), life: 0.6, size: 0.9, size1: 0.2, color: pick(['#ff9a3c', '#ffd45c', '#ff6b5c']), glow: true, alpha: 0.9, fin: 0.05 });
          }
          if (st === 'come') {
            dr.update(dt);
            if (dr.d > dPark - 18) dr.offT = off;
            if ((sirenT -= dt) <= 0) sirenT = SIREN.fire(near(dr.x, dr.z, 130));
            if (dr.arrived) {
              st = 'out'; t = 0;
              for (const k of [-2.2, 0, 2.2]) {
                const a = local(dr, v.w / 2 + 0.6, k), dir = { x: src.x - a.x, z: src.z - a.z }, dl = Math.hypot(dir.x, dir.z) || 1;
                const stand = Math.min(4.5, Math.max(1.5, dl - 4));
                crew.push({ x: a.x, z: a.z, sx: a.x, sz: a.z, tx: a.x + dir.x / dl * stand + rand(-0.4, 0.4), tz: a.z + dir.z / dl * stand, h: Math.atan2(dir.x, dir.z) });
              }
              if (seenNow()) talk('The firefighters are here!', true);
            }
          } else if (st === 'out') {
            const u = clamp(t / 1.6, 0, 1);
            for (const f of crew) { f.x = f.sx + (f.tx - f.sx) * u; f.z = f.sz + (f.tz - f.sz) * u; }
            if (u >= 1) { st = 'spray'; t = 0; hiss = noise(1, { type: 'bandpass', freq: 2200, q: 0.7, vol: 0.001, hold: true, attack: 0.3 }); }
          } else if (st === 'spray') {
            fire = Math.max(0, fire - dt / 13);
            if (hiss) hiss.set(0.035 * near(src.x, src.z, 90) * duck());
            sprayT -= dt;
            if (sprayT <= 0) {
              sprayT = 0.045;
              for (const f of crew) {
                const nz = { x: f.x + Math.sin(f.h) * 1.0, y: 1.36, z: f.z + Math.cos(f.h) * 1.0 };
                const tx = (fire > 0.15 ? src.x : roof.x) + rand(-1, 1), ty = (fire > 0.15 ? src.y : roof.y) + rand(-0.8, 0.8), tz = src.z + rand(-1, 1);
                const dist = Math.hypot(tx - nz.x, tz - nz.z), T = clamp(dist / 11, 0.5, 1.6), g = 9;
                emit({ x: nz.x, y: nz.y, z: nz.z, vx: (tx - nz.x) / T, vy: (ty - nz.y + 0.5 * g * T * T) / T, vz: (tz - nz.z) / T, grav: g, life: T, size: 0.32, size1: 0.55, color: '#9fd8ff', alpha: 0.85, fin: 0.02 });
              }
            }
            if ((steamT -= dt) <= 0) { steamT = 0.25; emit({ x: src.x + rand(-1, 1), y: src.y, z: src.z + rand(-1, 1), vy: rand(1.5, 2.5), vx: rand(0, 0.5), life: 2.2, size: 1.2, size1: 3.6, color: '#ffffff', alpha: 0.7, drag: 0.2 }); }
            if (t > 3 && !bubble && !me.asked) {
              me.asked = true;
              if (seenNow() && bigOnScreen(crew[1].x, 0, crew[1].z, 2)) {
                showBubble({ pic: 'firefighter', noun: 'firefighters', one: 'firefighter', at: () => (crew[1] ? V3(crew[1].x, 3.3, crew[1].z) : src), items: () => crew.map((f) => V3(f.x, 2.6, f.z)) });
                talk('How many firefighters?');
              }
            }
            if (fire <= 0) { st = 'done'; t = 0; if (hiss) { hiss.stop(); hiss = null; } }
          } else if (st === 'done') {
            if (!said && t > 1.2) { said = true; if (seenNow() && busNear(src.x, src.z, 120)) { talk('Fire is out! Thank you, firefighters!', true); SND.happy(); } }
            if (t > 3.2) {
              const u = clamp((t - 3.2) / 1.6, 0, 1);
              for (const f of crew) { f.x = f.tx + (f.sx - f.tx) * u; f.z = f.tz + (f.sz - f.tz) * u; f.h = Math.atan2(f.sx - f.tx, f.sz - f.tz); }
              if (u >= 1) { crew.length = 0; st = 'leave'; dr.target = null; dr.vmax = 8; dr.offT = C().lane; v.setLights(false); }
            }
          } else if (st === 'leave') {
            dr.update(dt);
            if (dr.done || (outT += dt) > 40) return false;
          }
          if (cand.kiosk) put('kiosk', cand.c.x, gy(cand.c.x, cand.c.z), cand.c.z, cand.c.ry);
          for (const f of crew) put(st === 'spray' ? 'fire' : 'fireWalk', f.x, gy(f.x, f.z), f.z, f.h, 1, 0, st === 'spray' ? 0 : Math.sin(t * 9) * 0.06);
          return true;
        },
        end() { if (hiss) hiss.stop(); dropVehicle(v); },
      };
      return me;
    },
  };

  // ---- 2. ambulance (from behind: make way!) ----
  EV.ambulance = {
    weight: 3,
    plan(o = {}) {
      const B = Bs(); if (Math.abs(B.speed) < 1.5) return null;
      const r = sameWay(65, 170); if (!r || r.bus < 50 || r.len - r.bus < 110) return null;
      return { r };
    },
    start({ r }) {
      const v = vehicle('ambulance'), Cc = C(), inner = Cc.laneInner || 2.5, kerb = Cc.lane;
      const br = r.br, dr = new Driver(v, r, { d: 0, vmax: 21, sp: 14, off: br.off > (Cc.laneDivider || 4.6) ? inner : kerb });
      v.setLights(true);
      let sirenT = 0, prompted = false, promptSp = 0, promptLat = 0, promptT = 0, madeWay = false, passed = false, passT = 0, said = false, t = 0, waitAll = 0, swapped = false;
      return {
        id: 'ambulance', spots: () => [['ambulance', dr.x, 0, dr.z, 3.6, null, v.len]],
        update(dt) {
          t += dt; flash(v, dt, 5);
          const B = Bs(), bp = project(r, B.pos.x, B.pos.z, dr.d - 20, dr.d + 90);
          const gap = bp && bp.dist < 12 ? bp.d - dr.d : null;
          if (gap != null && gap > 0 && gap < 60 && !swapped) {
            // take the lane the bus isn't in; if the bus stays in front, wait a little, then go round it anyway
            dr.offT = bp.lat > (Cc.laneDivider || 4.6) ? inner : (dr.wait > 4 ? kerb : dr.offT);
            if (dr.wait > 4) swapped = true;
          }
          if (gap != null && gap > 0 && gap < 32 && !prompted && !quiet()) {
            prompted = true; promptSp = Math.abs(B.speed); promptLat = bp.lat; promptT = t;
            talk('Here comes an ambulance! Make way! Move to the left!', true, true);
          }
          // close behind: keep about 9 faster than the bus, so it overtakes into view a second or two after the line
          if (gap != null && gap > 0) dr.vmax = Math.max(14, Math.abs(B.speed) + 9);
          // what the child did from the line until just after it passed: slowed down, or moved over to the left
          if (prompted && !madeWay && bp && (!passed || t - passT < 1.5)) {
            const sp = Math.abs(B.speed);
            if ((promptSp > 2.5 && sp < Math.max(2, promptSp - 3)) || bp.lat - promptLat > 2.5) madeWay = true;
          }
          if (!passed && gap != null && gap < -2) { passed = true; passT = t; }
          if (passed && !said && t - passT > 1.5) {
            said = true;
            if (prompted && !quiet()) {
              if (madeWay) {
                talk('Great driving! You let the ambulance go first!', true, true);
                if (BB.depot && BB.depot.add) BB.depot.add(1);
                if (BB.ui && BB.ui.coins) BB.ui.coins(1);
              } else talk('The ambulance got through!', true, true);
            }
          }
          dr.update(dt);
          if ((sirenT -= dt) <= 0) sirenT = SIREN.ambulance(near(dr.x, dr.z, 130));
          if (dr.blocked) waitAll += dt;
          if (dr.done || t > 70 || waitAll > 25) return false;
          if (passed && dr.d - (bp ? bp.d : 0) > 140) return false;
          return true;
        },
        end() { dropVehicle(v); },
      };
    },
  };

  // ---- 3. police and the runaway trolley / floating balloon ----
  EV.police = {
    weight: 3,
    plan(o = {}) {
      const r = oncoming(150, 80); if (!r || r.bus < 130) return null;
      { const p = r.at(r.bus - 36), o = p.half + 1.6; if (!stageOK(p.x + p.lx * o, p.z + p.lz * o)) return null; }
      return { r, balloon: Math.random() < 0.5 };
    },
    start({ r, balloon }) {
      const v = vehicle('police'), Cc = C();
      const d0 = r.bus - 44, pav = (d) => r.at(d).half + 1.6;
      const item = { d: d0, off: balloon ? Cc.lane : pav(d0), sp: balloon ? 2.4 : 3.2, caught: false, y: 0 };
      const dr = new Driver(v, r, { d: Math.max(0, d0 - 20), vmax: 7.5 });
      v.setLights(true);
      let st = 'chase', t = 0, sirenT = 0, cop = null, kid = null, saidSpot = false, leaveT = 0;
      if (balloon) { const kd = d0 + 26; const p = r.at(kd); kid = { x: p.x + p.lx * (pav(kd) + 0.6), z: p.z + p.lz * (pav(kd) + 0.6), h: Math.atan2(-p.lx, -p.lz), has: false }; }
      const itemPos = () => { const p = r.at(item.d); return { x: p.x + p.lx * item.off, z: p.z + p.lz * item.off, h: Math.atan2(p.tx, p.tz) }; };
      return {
        id: 'police', spots: () => [['police', dr.x, 0, dr.z, 2.3, balloon ? 'Oh! A balloon is floating away! The police car is coming to help!' : 'Oh! A runaway trolley! The police car is coming to help!', v.len]], at: () => { const q = itemPos(); return V3(q.x, 2, q.z); },
        update(dt) {
          t += dt; flash(v, dt, 5);
          if (st === 'chase') {
            if (!item.caught) { item.d += item.sp * dt; if (!balloon) item.off = pav(item.d); }
            const gap = item.d - dr.d - v.len / 2;
            dr.target = gap < 7 ? dr.d + Math.max(0, gap - 2.5) : null;
            if (gap < 7) item.sp = Math.max(0, item.sp - dt * 3);
            dr.update(dt);
            if ((sirenT -= dt) <= 0) sirenT = SIREN.police(0.8 * near(dr.x, dr.z, 120));
            if (gap < 3.5 && Math.abs(dr.sp) < 0.1) {
              item.caught = true; st = 'catch'; t = 0; dr.target = dr.d;
              const a = local(dr, v.w / 2 + 0.5, 1.2); cop = { x: a.x, z: a.z, sx: a.x, sz: a.z, h: dr.h };
            }
          } else if (st === 'catch') {
            const q = itemPos(), tx = q.x - Math.sin(q.h) * 0.9, tz = q.z - Math.cos(q.h) * 0.9;
            const u = clamp(t / 1.8, 0, 1); cop.x = cop.sx + (tx - cop.sx) * u; cop.z = cop.sz + (tz - cop.sz) * u; cop.h = Math.atan2(q.x - cop.x, q.z - cop.z);
            if (u >= 1) {
              st = balloon ? 'give' : 'park'; t = 0; cop.sx = cop.x; cop.sz = cop.z;
              if (seenNow() && busNear(q.x, q.z, 110)) { SND.tune(near(q.x, q.z, 120) + 0.2); talk('Got it! Thank you, police officer!', true); }
            }
          } else if (st === 'park') {            // push the trolley back onto the pavement, then back to the car
            const u = clamp(t / 2, 0, 1); item.off = pav(item.d) + 1.4 * u; if (u >= 1) { st = 'back'; t = 0; cop.sx = cop.x; cop.sz = cop.z; }
            const q = itemPos(); cop.x = q.x - Math.sin(q.h) * 0.9; cop.z = q.z - Math.cos(q.h) * 0.9;
          } else if (st === 'give') {            // carry the balloon to the child
            const u = clamp(t / 3, 0, 1); cop.x = cop.sx + (kid.x - 1.0 * Math.sin(kid.h) - cop.sx) * u; cop.z = cop.sz + (kid.z - 1.0 * Math.cos(kid.h) - cop.sz) * u; cop.h = Math.atan2(kid.x - cop.x, kid.z - cop.z);
            if (u >= 1) { kid.has = true; st = 'back'; t = 0; cop.sx = cop.x; cop.sz = cop.z; SND.happy(); }
          } else if (st === 'back') {
            const a = local(dr, v.w / 2 + 0.5, 1.2), u = clamp(t / 2.2, 0, 1);
            cop.x = cop.sx + (a.x - cop.sx) * u; cop.z = cop.sz + (a.z - cop.sz) * u; cop.h = Math.atan2(a.x - cop.sx, a.z - cop.sz);
            if (u >= 1) { cop = null; st = 'leave'; dr.target = null; dr.vmax = 8; v.setLights(false); }
          } else if (st === 'leave') {
            dr.update(dt);
            if (dr.done || (leaveT += dt) > 40) return false;
          }
          // draw the item, the officer and the child
          const q = itemPos();
          if (balloon) {
            if (!(kid && kid.has)) {
              const bob = Math.sin(t * 2.2) * 0.25, held = st === 'give' && cop;
              const bx = held ? cop.x + Math.sin(cop.h) * 0.45 : q.x, bz = held ? cop.z + Math.cos(cop.h) * 0.45 : q.z;
              put('balloon', bx, (held ? 1.4 : 1.6 + bob), bz, t * 0.3, 1, Math.sin(t * 1.7) * 0.15);
            }
          } else put('trolley', q.x, gy(q.x, q.z), q.z, q.h + (st === 'chase' ? Math.sin(t * 5) * 0.12 : 0), 1);
          if (cop) put(st === 'catch' || st === 'park' || st === 'give' ? 'policeUp' : 'police', cop.x, gy(cop.x, cop.z), cop.z, cop.h, 1, 0, st === 'catch' || st === 'back' ? Math.sin(t * 9) * 0.06 : 0);
          if (kid) put(kid.has ? 'kidBalloon' : 'kidWave', kid.x, gy(kid.x, kid.z) + (kid.has ? Math.abs(Math.sin(t * 6)) * 0.2 : 0), kid.z, kid.h);
          return true;
        },
        end() { dropVehicle(v); },
      };
    },
  };

  // ---- 4. car breakdown and the tow truck ----
  EV.breakdown = {
    weight: 2,
    plan(o = {}) {
      for (const r of stageRoutes()) { const dCar = findPark(r, 22, 56, VL('car') + 9, VW('tow')); if (dCar != null) return { r, dCar }; }
      return null;
    },
    start({ r, dCar }) {
      const car = vehicle('car'), tow = vehicle('tow'), Cc = C();
      const offC = parkOff(r, dCar, car.w), dTow = dCar + car.len / 2 + 1.0 + tow.len / 2;
      const cdr = new Driver(car, r, { d: dCar, off: offC, vmax: 0, target: dCar });
      const tdr = new Driver(tow, r, { d: r.d0, off: r.lane0, vmax: r.far ? 9 : 14, target: dTow });
      car.setLights(true); tow.setLights(true);
      let st = 'wait', t = 0, steamT = 0, tickT = 0, hook = 0, man = null, saidT = false, leaveT = 0;
      { const a = local(cdr, car.w / 2 + 1.0, 1.0); man = { x: a.x, z: a.z, h: cdr.h + Math.PI }; }
      return {
        id: 'breakdown', spots: () => [['brokenCar', cdr.x, 0, cdr.z, 2.2, 'Oh no! That car broke down. Here comes the tow truck!', car.len], ['towTruck', tdr.x, 0, tdr.z, 3.2, null, tow.len]], at: () => V3(cdr.x, 2, cdr.z),
        update(dt) {
          t += dt; flash(car, dt, 2.2); flash(tow, dt, 3);
          if ((tickT -= dt) <= 0) { tickT = 0.45; SND.tick(0.5 * near(cdr.x, cdr.z, 60)); }
          if (st === 'wait' || st === 'come') {
            if ((steamT -= dt) <= 0) {
              steamT = 0.14; const f = local(cdr, 0, 2.0 * SV, 1.3);
              emit({ x: f.x + rand(-0.3, 0.3), y: f.y, z: f.z + rand(-0.3, 0.3), vx: rand(-0.2, 0.2), vy: rand(1.2, 1.8), vz: rand(-0.2, 0.2), life: 1.8, size: 0.6, size1: 2.2, color: '#ffffff', alpha: 0.65, drag: 0.4 });
              if (Math.random() < 0.08) SND.hiss(near(cdr.x, cdr.z, 60));
            }
          }
          if (st === 'wait') {
            if (t > 2.5) { st = 'come'; t = 0; }
          } else if (st === 'come') {
            tdr.update(dt);
            if (tdr.d > dTow - 22) tdr.offT = parkOff(r, dTow, tow.w);
            if (tdr.arrived) { st = 'hook'; t = 0; SND.clunk(near(tdr.x, tdr.z, 60)); }
          } else if (st === 'hook') {
            hook = clamp(t / 2, 0, 1);
            if (man) { const a = local(tdr, tow.w / 2 + 0.6, 1.4), u = clamp(t / 1.5, 0, 1); man.x += (a.x - man.x) * u; man.z += (a.z - man.z) * u; if (u >= 1) man = null; }
            if (t > 2.4) { st = 'leave'; t = 0; tdr.target = null; tdr.vmax = 6.5; tdr.offT = Cc.lane; SND.clunk(near(tdr.x, tdr.z, 60)); }
          } else if (st === 'leave') {
            tdr.update(dt);
            if (t > 1.5 && !me2.bye && seenNow() && busNear(tdr.x, tdr.z, 90)) { me2.bye = true; talk('Bye bye, car! Off to the garage!'); }
            if (tdr.done || (leaveT += dt) > 45) return false;
          }
          // the car: towed with its front lifted behind the tow truck
          if (st === 'hook' || st === 'leave') {
            const tr = tdr.trail(tow.len / 2 + 0.6 + car.len / 2);
            cdr.d = tr.d; cdr.off = st === 'leave' ? tr.off : offC; cdr.place(dt);
            car.g.position.y = cdr.y + 0.55 * hook; car.g.rotation.order = 'YXZ'; car.g.rotation.x = -0.14 * hook;
          }
          if (man) put('driver', man.x, gy(man.x, man.z), man.z, man.h, 1, 0, st === 'hook' ? Math.sin(t * 9) * 0.06 : 0);
          return true;
        },
        end() { car.g.rotation.x = 0; dropVehicle(car); dropVehicle(tow); },
      };
      // (the closure above reads me2 for one-time lines)
    },
  };
  const me2 = {};               // one-time flags shared by the breakdown event (reset on each start)

  // ---- 5. ice cream truck (near the park, the playground, the gardens or the beach) ----
  EV.iceCream = {
    weight: 3,
    plan(o = {}) {
      if (!o.forced && W().night && W().night() > 0.3) return null;
      if (!o.forced && W().isRaining && W().isRaining()) return null;
      if (!o.forced && !nearStop(['park', 'playground', 'gardens', 'beach', 'wheel'], 170)) return null;
      for (const r of stageRoutes()) { const d = findPark(r, 22, 56, VL('iceCream') + 6, VW('iceCream')); if (d != null) return { r, d }; }
      return null;
    },
    start({ r, d }) {
      const v = vehicle('iceCream'), off = parkOff(r, d, v.w);
      const dr = new Driver(v, r, { d: r.d0, off: r.lane0, vmax: r.far ? 8 : 13, target: d });
      v.setLights(true);
      const looks = ['A', 'B', 'C', 'A'];
      const qd = (i) => d - r.sign * (v.len / 2 + 0.9 + i * 1.3), qo = off + v.w / 2 - 0.4;     // the queue: along the pavement, on the bus's side of the truck
      const kids = looks.map((lk, i) => { const kd = qd(i), p = r.at(kd), o = qo; return { lk, x: p.x + p.lx * o, z: p.z + p.lz * o, h: Math.atan2(r.sign * p.tx, r.sign * p.tz), cone: false, seed: Math.random() * 6 }; });
      let st = 'come', t = 0, jingleT = 0, serveT = 2, served = 0, offered = false, toldNear = false, parkedT = 0, leaveT = 0;
      const me = {
        id: 'iceCream', spots: () => [['iceCream', dr.x, 0, dr.z, 5, 'Ice cream! Stop near the truck for a treat!', v.len]], at: () => V3(dr.x, 4, dr.z),
        update(dt) {
          t += dt; flash(v, dt, 2);
          if ((jingleT -= dt) <= 0) { jingleT = st === 'park' ? 12 : 8; const k = near(dr.x, dr.z, 110); if (k > 0) SND.jingle(0.4 + 0.6 * k); }
          if (st === 'come') {
            dr.update(dt);
            if (dr.d > d - 16) dr.offT = off;
            if (dr.arrived) { st = 'park'; t = 0; }
          } else if (st === 'park') {
            parkedT += dt;
            if ((serveT -= dt) <= 0 && served < kids.length) {
              serveT = 3.4; const k = kids[served]; k.cone = true; served++;
              k.tx = k.x + Math.sin(k.h + Math.PI / 2) * rand(2, 4) * (served % 2 ? 1 : -1) - Math.sin(k.h) * 1.5;
              k.tz = k.z + Math.cos(k.h + Math.PI / 2) * rand(2, 4) * (served % 2 ? 1 : -1) - Math.cos(k.h) * 1.5;
              SND.clink(near(dr.x, dr.z, 60));
              if (served === 2 && !bubble && seenNow() && bigOnScreen(dr.x, 0, dr.z, 3)) showBubble({ pic: 'icecream', noun: 'ice creams', one: 'ice cream', life: 16, at: () => V3(dr.x, 6.2, dr.z), items: () => kids.filter((q) => q.cone).map((q) => V3(q.x, 2.0, q.z)) });
            }
            // the bus stopped close by: offer one
            const B = Bs();
            if (!offered && seenNow() && busNear(dr.x, dr.z, 30) && Math.abs(B.speed) < 0.4 && !quiet() && BB.ui && BB.ui.ask) {
              offered = true; hideBubble();
              const extra = BB.el('div', 'price', null); extra.appendChild(BB.iconEl ? BB.iconEl('coin', 64) : document.createElement('span')); extra.appendChild(document.createTextNode('2'));
              const picEl = document.createElement('canvas'); picEl.width = picEl.height = 128; picEl.getContext('2d').drawImage(pic('icecream'), 0, 0);
              talk('Buy an ice cream? Two coins!', true, true);
              BB.ui.ask({ pic: picEl, words: 'Ice cream?', extra,
                yes: () => {
                  const D = BB.depot, ok = !D || !D.spend || D.spend(2);
                  if (ok) { SND.jingle(1); addSticker(); BB.say('Yummy! An ice cream sticker for your bus!'); BB.emit('events:iceCream', {}); }
                  else BB.say('We need two coins. Next time!');
                },
                no: () => { BB.say('OK! Maybe next time!'); },
              });
            }
            const wanted = served >= kids.length && (parkedT > 26 || !busNear(dr.x, dr.z, 40)) && !(BB.ui && BB.ui.asking && BB.ui.asking());
            if (wanted && parkedT > 16) { st = 'leave'; t = 0; dr.target = null; dr.vmax = 7; dr.offT = C().lane; }
          } else if (st === 'leave') {
            dr.update(dt);
            if (dr.done || (leaveT += dt) > 45) return false;
            if (!busNear(dr.x, dr.z, 160) && leaveT > 6) return false;
          }
          for (const k of kids) {
            if (k.cone && k.tx != null) { k.x += (k.tx - k.x) * Math.min(1, dt * 1.2); k.z += (k.tz - k.z) * Math.min(1, dt * 1.2); }
            const hop = Math.abs(Math.sin(t * 4 + k.seed)) * (k.cone ? 0.12 : 0.06);
            put((k.cone ? 'kidCone' : 'kid') + k.lk, k.x, gy(k.x, k.z) + hop, k.z, k.cone ? k.h + Math.sin(t + k.seed) * 0.5 : k.h);
          }
          // the queue shuffles up
          for (let i = served; i < kids.length; i++) { const k = kids[i], kd = qd(i - served), p = r.at(kd), o = qo; k.x += (p.x + p.lx * o - k.x) * Math.min(1, dt * 2); k.z += (p.z + p.lz * o - k.z) * Math.min(1, dt * 2); }
          return true;
        },
        end() { dropVehicle(v); },
      };
      return me;
    },
  };

  // ---- 6. milk van (in the morning) ----
  EV.milk = {
    weight: 3,
    plan(o = {}) {
      const dt = W().day ? W().day.t : 0.3; if (!o.forced && !(dt < 0.24 || dt > 0.93)) return null;
      for (const r of stageRoutes()) for (const cand of buildingsAhead(r, 22, 50, 6, 60, 22)) {
        const dPark = cand.d; if (dPark < 30 || !parkOK(r, dPark, parkOff(r, dPark, VW('milk')), VL('milk') / 2 + 1)) continue;
        const p = r.at(dPark), o = parkOff(r, dPark, VW('milk')); if (!stageOK(p.x + p.lx * o, p.z + p.lz * o)) continue;
        return { r, cand, dPark };
      }
      for (const r of stageRoutes()) {             // no block handy: the corner kiosk gets its milk
        const dPark = findPark(r, 24, 56, VL('milk') + 2, VW('milk')); if (dPark == null) continue;
        const cand = kioskSpot(r, dPark, VW('milk')); if (cand) return { r, cand, dPark };
      }
      return null;
    },
    start({ r, cand, dPark }) {
      const v = vehicle('milk'), off = parkOff(r, dPark, v.w);
      const dr = new Driver(v, r, { d: r.d0, off: r.lane0, vmax: r.far ? 8 : 13, target: dPark });
      const pp = dr.pose(dPark, off), door = boxFace(cand.c, pp.x, pp.z, 1.2, 0);
      const partial = 1 + Math.floor(Math.random() * 4);         // the second crate holds 1-4 (the first is full: five)
      const pName = 'crate' + partial;
      let st = 'come', t = 0, man = null, trips = 0, carrying = false, leaveT = 0;
      const crates = [];                                           // {x, z, h, name, n}
      const me = {
        id: 'milk', spots: () => [['milkVan', dr.x, 0, dr.z, 2.8, 'Good morning! Here comes the milk van!', v.len]], at: () => V3(door.x, 2.5, door.z),
        update(dt) {
          t += dt;
          if (st === 'come') {
            dr.update(dt); if (dr.d > dPark - 16) dr.offT = off;
            if (dr.arrived) { st = 'walk'; t = 0; const a = local(dr, v.w / 2 + 0.5, -1.6); man = { x: a.x, z: a.z, sx: a.x, sz: a.z, h: 0 }; carrying = true; SND.clink(near(dr.x, dr.z, 60)); }
          } else if (st === 'walk' || st === 'back') {
            const a = local(dr, v.w / 2 + 0.5, -1.6), tgt = st === 'walk' ? { x: door.x + (trips ? 0.7 : -0.7) * Math.cos(dr.h), z: door.z - (trips ? 0.7 : -0.7) * Math.sin(dr.h) } : a;
            const from = st === 'walk' ? { x: man.sx, z: man.sz } : { x: man.sx, z: man.sz };
            const dist = Math.hypot(tgt.x - from.x, tgt.z - from.z), u = clamp(t * 1.4 / Math.max(1, dist), 0, 1);
            man.x = from.x + (tgt.x - from.x) * u; man.z = from.z + (tgt.z - from.z) * u; man.h = Math.atan2(tgt.x - from.x, tgt.z - from.z);
            if (u >= 1) {
              if (st === 'walk') {
                crates.push({ x: man.x + Math.sin(man.h) * 0.5, z: man.z + Math.cos(man.h) * 0.5, h: man.h + Math.PI / 2, name: trips ? pName : 'crate', n: trips ? partial : 5 });
                carrying = false; trips++; SND.clink(near(man.x, man.z, 60)); st = 'back'; t = 0; man.sx = man.x; man.sz = man.z;
                if (trips === 2 && !bubble && seenNow() && bigOnScreen(door.x, 0, door.z, 1.5)) {
                  showBubble({ pic: 'bottle', noun: 'bottles', one: 'bottle', groups: [5, partial], life: 16, at: () => V3(door.x, 2.6, door.z), items: () => bottleSpots(crates) });
                  talk('Count the bottles!');
                }
              } else if (trips < 2) { st = 'walk'; t = 0; carrying = true; man.sx = man.x; man.sz = man.z; SND.clink(near(man.x, man.z, 60)); }
              else { man = null; st = 'pause'; t = 0; }
            }
          } else if (st === 'pause') {
            if (t > 4) { st = 'leave'; dr.target = null; dr.vmax = 7; dr.offT = C().lane; if (seenNow() && busNear(dr.x, dr.z, 90)) talk('Milk for breakfast! Yum!'); }
          } else if (st === 'leave') {
            dr.update(dt);
            if (dr.done || (leaveT += dt) > 40) return false;
          }
          if (cand.kiosk) put('kiosk', cand.c.x, gy(cand.c.x, cand.c.z), cand.c.z, cand.c.ry);
          for (const c of crates) put(c.name, c.x, gy(c.x, c.z), c.z, c.h);
          if (man) {
            put(carrying ? 'milkCarry' : 'milk', man.x, gy(man.x, man.z), man.z, man.h, 1, 0, Math.sin(t * 9) * 0.05);
            if (carrying) put(trips ? pName : 'crate', man.x + Math.sin(man.h) * 0.48, gy(man.x, man.z) + 1.2, man.z + Math.cos(man.h) * 0.42, man.h + Math.PI / 2);
          }
          return true;
        },
        end() { dropVehicle(v); },
      };
      return me;
    },
  };
  function bottleSpots(crates) {
    const out = [];
    for (const c of crates) for (let i = 0; i < c.n; i++) { const lx = -0.42 + i * 0.21; out.push(V3(c.x + Math.cos(c.h) * lx, 0.75 + gy(c.x, c.z), c.z - Math.sin(c.h) * lx)); }
    return out;
  }

  // ---- 7. rubbish truck (bins lifted by its arms, beeping as it backs up) ----
  EV.rubbish = {
    weight: 2,
    plan(o = {}) {
      if (!o.forced && W().night && W().night() > 0.5) return null;
      for (const r of stageRoutes()) { const d = findPark(r, 24, 56, VL('rubbish') + 10, VW('rubbish')); if (d != null) return { r, d }; }
      return null;
    },
    start({ r, d }) {
      const v = vehicle('rubbish'), off = parkOff(r, d, v.w);
      const dStop = d + 7, dBack = d;            // drive past the bins, then reverse up to them
      const dr = new Driver(v, r, { d: r.d0, off: r.lane0, vmax: r.far ? 8 : 13, target: dStop });
      v.setLights(true);
      const nb = 2 + (Math.random() < 0.5 ? 1 : 0);
      const bins = [];
      for (let i = 0; i < nb; i++) { const bd = d - v.len / 2 - 1.4 - i * 1.0, p = r.at(bd), o = off + v.w / 2 + 0.2; bins.push({ x: p.x + p.lx * o, z: p.z + p.lz * o, hx: p.x + p.lx * o, hz: p.z + p.lz * o, y: 0, tip: 0, h: Math.atan2(p.tx, p.tz) }); }
      let st = 'come', t = 0, beepT = 0, bi = 0, leaveT = 0, man = null;
      return {
        id: 'rubbish', spots: () => [['rubbishTruck', dr.x, 0, dr.z, 4, 'Here comes the rubbish truck!', v.len]], at: () => V3(dr.x, 3, dr.z),
        update(dt) {
          t += dt; flash(v, dt, 2.5);
          if (st === 'come') {
            dr.update(dt); if (dr.d > dStop - 18) dr.offT = off;
            if (dr.arrived) { st = 'reverse'; t = 0; dr.target = dBack; dr.vmax = 1.6; }
          } else if (st === 'reverse') {
            dr.update(dt);
            if ((beepT -= dt) <= 0) { beepT = 0.55; SND.beep(near(dr.x, dr.z, 80)); }
            if (dr.arrived) { st = 'lift'; t = 0; const a = local(dr, v.w / 2 + 0.6, -v.len / 2 + 0.6); man = { x: a.x, z: a.z, h: dr.h + Math.PI / 2 }; }
          } else if (st === 'lift') {
            const b = bins[bi], back = local(dr, 0, -v.len / 2 - 0.55);
            const u = clamp(t / 4.2, 0, 1);
            // 0-0.25 roll to the back, 0.25-0.5 up, 0.5-0.65 tip and shake, 0.65-0.85 down, 0.85-1 roll home
            if (u < 0.25) { const k = BB.smooth(u / 0.25); b.x = b.hx + (back.x - b.hx) * k; b.z = b.hz + (back.z - b.hz) * k; }
            else if (u < 0.5) { const k = BB.smooth((u - 0.25) / 0.25); b.y = 2.2 * k; b.tip = 0.6 * k; }
            else if (u < 0.65) { b.y = 2.2; b.tip = 2.1 + Math.sin(t * 30) * 0.08; }
            else if (u < 0.85) { const k = BB.smooth((u - 0.65) / 0.2); b.y = 2.2 * (1 - k); b.tip = 0.6 * (1 - k); }
            else { const k = BB.smooth((u - 0.85) / 0.15); b.y = 0; b.tip = 0; b.x = back.x + (b.hx - back.x) * k; b.z = back.z + (b.hz - back.z) * k; }
            if (u > 0.5 && !b.dumped) { b.dumped = true; SND.clunk(near(dr.x, dr.z, 70)); }
            if (u >= 1) { bi++; t = 0; if (bi >= bins.length) { st = 'go'; } }
          } else if (st === 'go') {
            if (t > 1.2) { st = 'leave'; man = null; dr.target = null; dr.vmax = 7; dr.offT = C().lane; if (seenNow() && busNear(dr.x, dr.z, 90)) talk('All clean! Thank you, rubbish truck!'); }
          } else if (st === 'leave') {
            dr.update(dt);
            if (dr.done || (leaveT += dt) > 40) return false;
          }
          for (const b of bins) put('bin', b.x, gy(b.x, b.z) + b.y, b.z, dr.h + Math.PI, 1, -b.tip);
          if (man) put('worker', man.x, gy(man.x, man.z), man.z, man.h, 1, 0, st === 'lift' ? Math.sin(t * 6) * 0.04 : 0);
          return true;
        },
        end() { dropVehicle(v); },
      };
    },
  };
  const me3 = {};

  // ---- 12. otters crossing on a zebra crossing ----
  EV.otters = {
    weight: 3,
    plan(o = {}) {
      if (!o.forced && W().night && W().night() > 0.5) return null;
      const br = busRoad(); if (!br || br.e.kind === 'highway') return null;
      const r = buildRoute([walk(br.e, br.s, br.dir, 90, true)]); if (!r) return null;
      for (const zb of zebras()) {                // a real zebra crossing ahead first
        const pr = project(r, zb.x, zb.z); if (!pr || pr.dist > 4 || pr.d < 26 || pr.d > 58) continue;
        if (stageOK(zb.x, zb.z, 1)) return { r, dz: pr.d, own: false };
      }
      for (let a = 26; a <= 58; a += 3) {         // else any straight, clear bit of road: we paint our own stripes
        const p = r.at(a), q0 = r.at(a - 8), q1 = r.at(a + 8);
        if (p.half > 10 || q0.tx * q1.tx + q0.tz * q1.tz < 0.98) continue;
        if (spotOK(p.x, p.z, 1) && stageOK(p.x, p.z, 1)) return { r, dz: a, own: true };
      }
      return null;
    },
    start({ r, dz, own }) {
      const p = r.at(dz), half = p.half, side = Math.random() < 0.5 ? 1 : -1;
      // across the road: from one pavement (left of the bus's travel * side) to the other
      const A0 = { x: p.x + p.lx * side * (half + 3), z: p.z + p.lz * side * (half + 3) }, A1 = { x: p.x - p.lx * side * (half + 3), z: p.z - p.lz * side * (half + 3) };
      const h = Math.atan2(A1.x - A0.x, A1.z - A0.z), L = Math.hypot(A1.x - A0.x, A1.z - A0.z), sp = 2.3;
      const fam = []; { let s0 = 0; for (const pup of [false, true, true, false]) { fam.push({ pup, s: s0, across: false, seed: Math.random() * 6 }); s0 -= pup ? 3.4 : 4.6; } }
      const stripes = own ? zebraDecal(p.x, p.z, Math.atan2(p.tx, p.tz), half) : null;
      let t = 0, counted = 0, prompted = false, waited = false, wasSlow = false, endT = 0;
      return {
        id: 'otters', spots: () => { const o = fam.find((q) => q.s > 0 && q.s < L); if (!o) return []; const x = A0.x + Math.sin(h) * o.s, z = A0.z + Math.cos(h) * o.s; return [['otters', x, 0, z, 2.8, 'Look! A family of otters!', 12]]; }, at: () => V3(p.x, 1, p.z),
        update(dt) {
          t += dt;
          const B = Bs(), bp = project(r, B.pos.x, B.pos.z), toGo = bp && bp.dist < 12 ? dz - bp.d : null;
          let onRoad = false;
          for (const o of fam) {
            o.s = Math.min(L + 1, o.s + sp * dt);
            const lat = o.s - L / 2;
            if (Math.abs(lat) < half + 0.6 && o.s > 0) onRoad = true;
            if (!o.across && o.s > L - 3.5) {
              o.across = true; counted++;
              if (seenNow() && busNear(p.x, p.z, 75)) { if (!quiet()) BB.say(WORDS[counted][0].toUpperCase() + WORDS[counted].slice(1) + '!', { queue: true }); SND.squeak(near(p.x, p.z, 70)); }
            }
            if (Math.random() < dt * 0.4) SND.squeak(0.5 * near(p.x, p.z, 50));
          }
          // a gentle hand on the bus: coming up to the crossing while they're on the road, it eases to a stop ~12 before it
          if (onRoad && toGo != null && toGo > 0 && toGo < 40 && !jobBusy() && !pullingIn()) {
            const cap = clamp((toGo - 12) / 18, 0, 1) * 7;
            if (B.speed > cap) { B.speed = Math.max(cap, B.speed - dt * 6); wasSlow = true; }
          }
          if (onRoad && toGo != null && toGo > 3 && toGo < 50 && !prompted && inFrame(p.x, 0.5, p.z)) { prompted = true; talk('Stop! Let the otters cross!', true, true); }
          if (onRoad && toGo != null && toGo > 0 && toGo < 40 && Math.abs(B.speed) < 0.6) waited = true;
          const all = fam.every((o) => o.s >= L + 1);
          if (all) {
            if (!endT && seenNow() && busNear(p.x, p.z, 90)) talk(`${WORDS[fam.length][0].toUpperCase() + WORDS[fam.length].slice(1)} otters! Bye bye, otters!` + (waited || wasSlow ? ' Thank you for waiting!' : ''), true);
            if ((endT += dt) > 1.5) return false;
          }
          for (const o of fam) {
            if (o.s < -0.5 || o.s > L + 0.6) continue;
            const x = A0.x + Math.sin(h) * o.s, z = A0.z + Math.cos(h) * o.s;
            put(o.pup ? 'otterPup' : 'otter', x, gy(x, z) + Math.abs(Math.sin(t * 6 + o.seed)) * 0.2, z, h + Math.sin(t * 6 + o.seed) * 0.15, 1);
          }
          return true;
        },
        end() { if (stripes && stripes.parent) stripes.parent.remove(stripes); },
      };
    },
  };

  // our own zebra stripes for an otter crossing where the town has none (one cached mesh)
  let zebraMesh = null;
  function zebraDecal(x, z, h, half) {
    if (!zebraMesh) {
      const b = BB.mk.builder();
      for (let k = -9; k <= 9; k++) b.box(0.62, 0.02, 3.6, '#fffaf0', k * 1.06, 0, 0);
      zebraMesh = new THREE.Mesh(b.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2 }));
      zebraMesh.name = 'ev:zebra';
    }
    zebraMesh.position.set(x, 0.055, z); zebraMesh.rotation.set(0, h, 0); zebraMesh.scale.set(half / 9.2, 1, 1);
    if (BB.scene) BB.scene.add(zebraMesh);
    return zebraMesh;
  }

  // ---- 13. parade: a lion dance with drums (at Christmas: Santa's float with bells) ----
  EV.parade = {
    weight: 2,
    plan(o = {}) {
      if (!o.forced && W().isRaining && W().isRaining()) return null;
      if (!o.forced && !nearStop(['chinatown', 'city', 'gardens', 'wheel', 'park', 'beach', 'hawker', 'shops'], 230)) return null;
      const r = oncoming(110, 70); if (!r || r.bus < 90) return null;
      { const p = r.at(r.bus - 28), o = p.half + 1.7; if (!stageOK(p.x + p.lx * o, p.z + p.lz * o)) return null; }
      return { r };
    },
    start({ r }) {
      const xmas = !!BB.xmas;
      const line = xmas ? [['elfBell', 1.6], ['float', 3.4], ['elf', 2.2], ['elfBell', 1.6]] : [['flag', 1.6], ['lion', 3.6], ['drummer', 2.4], ['cymbal', 1.8], ['drummer', 1.8], ['flag', 1.6]];
      let s = r.bus - 30; const mem = [];
      for (const [lk, gap] of line) { s -= gap; mem.push({ lk, s0: s, seed: Math.random() * 6 }); }
      const off = (d) => r.at(d).half + 1.7, sp = 1.5;
      let t = 0, beat = 0, beatT = 0, said = false, bellT = 0;
      const head = () => { const m = mem[xmas ? 1 : 1]; const d = m.s0 + sp * t; const p = r.at(d); return { x: p.x + p.lx * off(d), z: p.z + p.lz * off(d) }; };
      return {
        id: 'parade', spots: () => { const q = head(); return [['parade', q.x, 0, q.z, 3.2, xmas ? 'Look! A Christmas parade! Ho ho ho! Merry Christmas!' : 'Look! A lion dance parade! Dong, dong, dong!', 12]]; }, at: () => { const q = head(); return V3(q.x, 3, q.z); },
        update(dt) {
          t += dt;
          const q = head(), k = near(q.x, q.z, 110) * duck();
          if (k > 0) {
            if (xmas) { if ((bellT -= dt) <= 0) { bellT = rand(0.5, 0.9); SND.bells(k); } }
            else if ((beatT -= dt) <= 0) {             // an original 8-step drum pattern with the cymbal on the off-beats
              beatT = 0.2;
              const PAT = 'D.dTD.dd', step = PAT[beat % 8];
              if (step === 'D') SND.drum(k); else if (step === 'd') SND.drum(0.6 * k); else if (step === 'T') SND.tap(k);
              if (beat % 4 === 2) SND.cymbal(k);
              beat++;
            }
          }
          let any = false;
          for (const m of mem) {
            const d = m.s0 + sp * t; if (d > r.len - 1) continue;
            any = true;
            const p = r.at(Math.max(0, d)), o = off(d), x = p.x + p.lx * o, z = p.z + p.lz * o, h = Math.atan2(p.tx, p.tz);
            if (d < 0) continue;
            if (m.lk === 'lion') {
              const jump = Math.max(0, Math.sin(t * 3.2)) * 0.45;
              put('lion', x, gy(x, z) + jump, z, h + Math.sin(t * 2.1) * 0.35, 1, -jump * 0.3, Math.sin(t * 4.2) * 0.08);
            } else if (m.lk === 'float') put('float', x, gy(x, z), z, h, 1);
            else put(m.lk, x, gy(x, z) + Math.abs(Math.sin(t * 6 + m.seed)) * 0.08, z, h, 1, 0, Math.sin(t * 6 + m.seed) * 0.05);
          }
          const last = mem[mem.length - 1].s0 + sp * t;
          if (!any || last > r.bus + 30 || t > 75) return false;
          return true;
        },
        end() {},
      };
    },
  };

  // ---- 14. fireworks over the sea at night ----
  const seaZ = () => (W().SZ != null ? W().SZ : 190);
  EV.fireworks = {
    weight: 0,
    plan(o = {}) {
      if (o.forced) return {};
      if (!W().night || W().night() < 0.55 || (W().isRaining && W().isRaining())) return null;
      const B = Bs(); if (B.pos.z < seaZ() - 150 || targetNear(120)) return null;
      return {};
    },
    start() {
      let t = 0, next = 0.5, n = 0; me4.live = 0; me4.said = false;
      const B0 = Bs(), aim = { x: B0.pos.x + Math.sin(B0.heading) * 65, y: 22, z: Math.max(seaZ() + 20, B0.pos.z + Math.cos(B0.heading) * 65) };
      const lk = lookUp(() => (me4.live > 0 ? { x: me4.x, y: me4.y, z: me4.z } : aim), 16);
      const total = 6, rockets = [];
      const cols = BB.xmas ? ['#ff4b4b', '#4fdc7a', '#ffd45c', '#ffffff'] : ['#ff6b5c', '#ffd45c', '#5fd0ff', '#b58cff', '#7dff8a', '#ff8fd0'];
      return {
        id: 'fireworks', spots: () => (me4.live > 0 ? [['fireworks', me4.x, me4.y - 7, me4.z, 14, 'Ooh! Fireworks over the sea!', 14, lk ? 0.92 : 0.84]] : []),
        update(dt) {
          t += dt;
          if (n < total && (next -= dt) <= 0) {
            next = rand(2.2, 3.2); n++;
            const cam = BB.camera ? BB.camera.position : Bs().pos, nearSea = Bs().pos.z > seaZ() - 150;
            const salvo = n === 1 ? 2 : 2 + (Math.random() < 0.5 ? 1 : 0);
            for (let q = 0; q < salvo; q++) {
              const hb = Bs().heading + (q - (salvo - 1) / 2) * 0.32 + rand(-0.08, 0.08), ahead = lk ? rand(55, 75) : rand(32, 44);
              let x = cam.x + Math.sin(hb) * ahead, z = cam.z + Math.cos(hb) * ahead;   // low and ahead without the camera turn
              if (nearSea) { x = clamp(x, -180, 380); z = Math.max(seaZ() + (lk ? 20 : 4), z); }
              rockets.push({ x, y: 1, z, vy: lk ? rand(26, 32) : rand(9, 12), top: lk ? rand(18, 30) : rand(5, 7.5), c1: pick(cols), c2: pick(cols), wait: q * 0.25 });
            }
            SND.whistle(near(cam.x, cam.z, 260));
          }
          me4.live = (me4.live || 0) - dt;
          if (Bs().atStop || jobBusy()) return false;          // a sky show never plays over a stop or a question
          for (let i = rockets.length - 1; i >= 0; i--) {
            const rk = rockets[i];
            if ((rk.wait -= dt) > 0) continue;
            rk.y += rk.vy * dt;
            emit({ x: rk.x, y: rk.y, z: rk.z, vy: -2, life: 0.5, size: 0.9, size1: 0.2, color: '#ffe9a8', glow: true, alpha: 0.9, fin: 0.01 });
            if (rk.y >= rk.top) {
              rockets.splice(i, 1);
              me4.x = rk.x; me4.y = rk.y; me4.z = rk.z; me4.live = 1.4;
              const big = lk ? 1.6 : 1;
              for (let k = 0; k < 80; k++) {
                const a = Math.random() * Math.PI * 2, u = rand(-1, 1), rr = Math.sqrt(1 - u * u), spd = rand(7.5, 10) * big;
                emit({ x: rk.x, y: rk.y, z: rk.z, vx: Math.cos(a) * rr * spd, vy: u * spd, vz: Math.sin(a) * rr * spd, grav: 3.2, drag: 0.8, life: rand(1.8, 2.6), size: 2.4 * big, size1: 1.0 * big, color: k % 3 ? rk.c1 : rk.c2, glow: true, fin: 0.01 });
              }
              SND.pop(near(rk.x, rk.z, 280));
              if (!me4.said) { me4.said = true; talk('Ooh! Fireworks!', true, true); if (E.current) { E.current.saidIntro = true; E.current.seen = true; E.current.spotted.fireworks = true; } E.spot('fireworks'); }
            }
          }
          return n < total || rockets.length > 0 || t < 3;
        },
        end() { lookBack(); },
      };
    },
  };
  const me4 = {};

  // ---- 15. a plane landing near the airport ----
  EV.plane = {
    weight: 0,
    plan(o = {}) {
      const B = Bs(), w = W();
      const nearAirport = !!(w.stopById && w.stopById('airport')) && B.pos.z < -110 && B.pos.x > -150;
      if (nearAirport && !targetNear(120)) return { land: true };
      return o.forced ? { land: false } : null;
    },
    start({ land }) {
      const B = Bs(), RZ = -340, east = B.pos.x < 330;
      const f = { x: Math.sin(B.heading), z: Math.cos(B.heading) };
      const S = { x: B.pos.x - f.x * 45, y: 26, z: B.pos.z - f.z * 45 };
      const Ap = east ? { x: 150, y: 16, z: RZ } : { x: 640, y: 16, z: RZ }, T = east ? { x: 270, y: 0, z: RZ } : { x: 520, y: 0, z: RZ }, R = east ? { x: 470, y: 0, z: RZ } : { x: 320, y: 0, z: RZ };
      // a low pass over the road ahead (the chase camera looks down: higher up it would be out of the picture), then round to land
      const look = V3(B.pos.x + f.x * 40, 14, B.pos.z + f.z * 40), lk = lookUp(look, 10), M = { x: B.pos.x + f.x * 38, y: lk ? 14 : 2.5, z: B.pos.z + f.z * 38 }, M2 = { x: B.pos.x + f.x * (lk ? 95 : 70), y: lk ? 18 : 2.5, z: B.pos.z + f.z * (lk ? 95 : 70) };
      const F = { x: B.pos.x + f.x * 320, y: 80, z: B.pos.z + f.z * 320 };
      const legs = land ? [[S, M, 24], [M, M2, lk ? 18 : 12], [M2, Ap, 30], [Ap, T, 30], [T, R, 0]] : [[S, M, 24], [M, M2, lk ? 18 : 12], [M2, F, 30]], LAST = legs.length - 1;
      let g = null, mat = null;
      if (BB.landmarks && typeof BB.landmarks.plane === 'function') {
        g = safe(() => BB.landmarks.plane(0));
        if (g) { mat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }); g.traverse((o) => { if (o.isMesh) o.material = mat; }); }
      }
      if (!g) {
        const b = BB.mk.builder();
        b.add(CYL(1.8, 26, 10), '#f7f4ee', 0, 2.2, 0, 0, Math.PI / 2, 0); b.ball(1.8, '#f7f4ee', 0, 2.2, 13, 1, 1, 1, 1.5);
        b.box(26, 0.4, 5, '#e3e7ee', 0, 1.6, 0.6); b.box(9, 0.3, 2.6, '#e3e7ee', 0, 2.8, -12); b.box(0.4, 5, 3.6, '#4fa3e0', 0, 3, -12);
        b.box(2.8, 0.3, 22, '#4fa3e0', 0, 2.4, 0.4);
        g = new THREE.Group(); g.add(b.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, fog: false })));
      }
      g.name = 'ev:plane'; BB.scene.add(g);
      let leg = 0, u = 0, sp = 24, h = Math.atan2(M.x - S.x, M.z - S.z), t = 0, whoosh = null, said = false, rollT = 0, bank = 0;
      const pos = { x: S.x, y: S.y, z: S.z };
      whoosh = noise(1, { type: 'lowpass', freq: 520, vol: 0.001, hold: true, attack: 0.5 });
      look.set(S.x, S.y, S.z);
      return {
        id: 'plane', spots: () => [['plane', pos.x, pos.y - 1, pos.z, 4, land ? 'Look! A plane is coming in to land!' : 'Look! A plane!', 30, lk ? 0.92 : 0.84]],
        update(dt) {
          t += dt;
          const [a, b, v1] = legs[leg], L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
          if (leg === LAST && land) sp = Math.max(6, sp - dt * 6); else sp += ((v1 || 30) - sp) * Math.min(1, dt);
          u += sp * dt / L;
          if (u >= 1) { if (leg < LAST) { leg++; u = 0; if (leg === LAST && land) SND.clunk(near(T.x, T.z, 200) + 0.2); } else u = 1; }
          const [a2, b2] = legs[leg];
          pos.x = a2.x + (b2.x - a2.x) * u; pos.y = a2.y + (b2.y - a2.y) * u; pos.z = a2.z + (b2.z - a2.z) * u;
          const ht = Math.atan2(b2.x - a2.x, b2.z - a2.z), dh = wrapA(ht - h) * Math.min(1, dt * 1.2);
          h += dh; bank += (clamp(-dh / Math.max(dt, 1e-3) * 0.8, -0.4, 0.4) - bank) * Math.min(1, dt * 2);
          const pitch = leg === LAST && land ? 0 : -Math.atan2(b2.y - a2.y, Math.hypot(b2.x - a2.x, b2.z - a2.z)) * 0.6 - (leg === LAST - 1 && u > 0.8 ? 0.06 : 0);
          look.set(pos.x, pos.y, pos.z);
          g.position.set(pos.x, pos.y, pos.z); g.rotation.set(0, 0, 0); g.rotation.order = 'YXZ'; g.rotation.y = h; g.rotation.x = pitch; g.rotation.z = bank;
          const k = clamp(1 - Math.hypot(pos.x - Bs().pos.x, pos.y, pos.z - Bs().pos.z) / 220, 0, 1);
          if (whoosh) whoosh.set(0.07 * k * duck());
          if (Bs().atStop || jobBusy()) return false;
          if (leg === LAST && u >= 1) rollT += dt;
          return rollT < 2 && t < 50;
        },
        end() { if (whoosh) whoosh.stop(); if (g.parent) g.parent.remove(g); if (mat) mat.dispose(); if (lk) lookBack(); },
      };
    },
  };

  // The bus builder's camera turn (BB.bus.lookAt(target, {duration} in seconds)), when it exists; target is a live
  // Vector3 we keep moving. Never while at a stop or a question.
  // Returns true when the camera really turned (false: no API yet, or the bus can't look now).
  function lookUp(target, sec) {
    const B = Bs();
    if (!B || typeof B.lookAt !== 'function' || B.atStop || jobBusy()) return false;
    return safe(() => B.lookAt(target, { duration: sec })) !== false && !!(B.isLooking ? B.isLooking() !== false : true);
  }
  function lookBack() { const B = Bs(); if (B && typeof B.lookAt === 'function' && (!B.isLooking || B.isLooking())) safe(() => B.lookAt(null)); }

  // ---- 16. rainbow puddles (ambient, not an event): splashes while driving on wet roads, rainbow sparkles after rain ----
  let splashT = 2, splashSaid = false, wasDry = true;
  function updateSplash(dt) {
    const w = W(), B = Bs(), wx = w.weatherState;
    if (!wx || !B || !B.front || B.camMode !== 'chase') return;
    if (wx.wet < 0.25) { if (wx.wet < 0.05) { wasDry = true; splashSaid = false; } return; }
    if (Math.abs(B.speed) < 3.5) return;
    if ((splashT -= dt) > 0) return;
    splashT = rand(0.9, 2.6);
    splash(B, !(w.isRaining && w.isRaining()));
  }
  function splash(B, rainbow) {
    const h = B.heading, f = { x: Math.sin(h), z: Math.cos(h) }, l = { x: f.z, z: -f.x };
    const cols = ['#ff6b6b', '#ffab4a', '#ffe066', '#7ddc7a', '#5fc6ff', '#6f8fff', '#b58cff'];
    for (const s of [1, -1]) {
      const x = B.pos.x + l.x * s * 1.3 + f.x * 1.0, z = B.pos.z + l.z * s * 1.3 + f.z * 1.0;
      for (let i = 0; i < 14; i++) emit({ x, y: 0.2, z, vx: l.x * s * rand(1.5, 3.5) + f.x * B.speed * 0.3, vy: rand(2.5, 4.5), vz: l.z * s * rand(1.5, 3.5) + f.z * B.speed * 0.3, grav: 12, life: rand(0.5, 0.8), size: 0.3, size1: 0.18, color: pick(['#cfe8ff', '#ffffff', '#a9d6ff']), alpha: 0.9, fin: 0.02, floor: 0.05 });
      if (rainbow) for (let i = 0; i < 7; i++) emit({ x: x + l.x * s * 0.6, y: 0.6, z: z + l.z * s * 0.6, vx: l.x * s * rand(0.6, 1.4), vy: rand(1.2, 2.2), vz: l.z * s * rand(0.6, 1.4), grav: 1.5, life: 1.2, size: 0.42, size1: 0.1, color: cols[i], glow: true, fin: 0.05 });
    }
    SND.splash(0.8);
    if (rainbow) SND.sparkle(0.7);
    if (rainbow && wasDry && !splashSaid) { splashSaid = true; wasDry = false; talk('Splash! A rainbow splash!'); }
  }

  // =====================================================================================================
  // ---------- the scheduler ----------
  const ORDER = ['fire', 'ambulance', 'police', 'breakdown', 'iceCream', 'milk', 'rubbish', 'otters', 'parade', 'fireworks', 'plane'];
  const ALIAS = { fireTruck: 'fire', towTruck: 'breakdown', tow: 'breakdown', ice: 'iceCream', icecream: 'iceCream', milkVan: 'milk', rubbishTruck: 'rubbish', santa: 'parade', lion: 'parade', otter: 'otters', ducks: 'otters', firework: 'fireworks', puddle: 'splash', puddles: 'splash', rainbow: 'splash' };
  const lastStart = {};
  const fresh = (id) => lastStart[id] == null || clock - lastStart[id] > 480;
  let gap = rand(30, 45), clock = 0, pulledOutAt = -1e9, wasAtStop = false, lastEnd = -1e9, recent = [], nightId = 0, wasNight = false, fwNight = -1, lastPlane = -1e9, started = false;
  function begin(id, plan) {
    for (const k in me2) delete me2[k]; for (const k in me3) delete me3[k];
    const inst = safe(() => EV[id].start(plan || {}));
    if (!inst) return false;
    inst.t0 = clock; inst.far = 0; inst.spotted = {}; lastStart[id] = clock;
    E.current = inst;
    recent.unshift(id); recent.length = Math.min(recent.length, 3);
    BB.emit('events:start', { id });
    return true;
  }
  function finish() {
    const c = E.current; if (!c) return;
    E.current = null;
    safe(() => c.end());
    hideBubble();
    lastEnd = clock;
    BB.emit('events:end', { id: c.id });
  }
  E.stop = function () { finish(); clearParticles(); crowdBegin(); crowdEnd(); };
  E.active = () => (E.current ? E.current.id : null);
  // Debug/test only (no button for it): start an event now, ignoring the timer. Returns true when it started.
  E.trigger = function (name) {
    if (!started) init();
    const id = ALIAS[name] || name;
    if (id === 'splash') { const B = Bs(); if (B && B.front) splash(B, true); return true; }
    if (!EV[id] || !canRun()) return false;
    const plan = safe(() => EV[id].plan({ forced: true }));
    if (!plan) return false;
    finish();
    return begin(id, plan);
  };
  E.can = (name) => { const id = ALIAS[name] || name; return !!(EV[id] && canRun() && safe(() => EV[id].plan({ forced: true }))); };
  function schedule(dt) {
    const w = W(), n = w.night ? w.night() : 0;
    const isNight = n > 0.55; if (isNight && !wasNight) nightId++; wasNight = isNight;
    const B = Bs(), atStopNow = !!(B && (B.atStop || (B.isSettling && B.isSettling())));
    if (wasAtStop && !atStopNow) pulledOutAt = clock;              // just pulled out: the road ahead is free for a while
    wasAtStop = atStopNow;
    if (E.current || !canStart()) return;
    // the sky shows come when they can be seen (once per night / now and then near the airport)
    if (clock - lastEnd > 30 && fwNight !== nightId && isNight && fresh('fireworks')) { const pl = safe(() => EV.fireworks.plan()); if (pl) { fwNight = nightId; begin('fireworks', pl); return; } }
    if (clock - lastEnd > 30 && clock - lastPlane > 480) { const pl = safe(() => EV.plane.plan()); if (pl) { lastPlane = clock; begin('plane', pl); return; } }
    gap -= dt * (Math.abs(B.speed) > 0.5 ? 1 : 0.35);
    // due: best right after pulling out of a stop; otherwise wait up to 25 s for that moment, then any calm moment
    if (gap > 0 || (clock - pulledOutAt > 8 && gap > -25)) return;
    const opts = [];
    for (const id of ORDER) {
      const ev = EV[id]; if (!ev.weight || recent.slice(0, 2).indexOf(id) >= 0 || !fresh(id)) continue;
      const pl = safe(() => ev.plan()); if (pl) opts.push({ id, pl, w: ev.weight });
    }
    if (!opts.length) { gap = rand(8, 15); return; }
    let r = Math.random() * opts.reduce((a, o) => a + o.w, 0), ch = opts[0];
    for (const o of opts) { r -= o.w; if (r <= 0) { ch = o; break; } }
    begin(ch.id, ch.pl);
    gap = rand(55, 80);
  }
  function spotting(dt) {
    const c = E.current; if (!c || !c.spots) return;
    if ((frT -= dt) > 0) return;
    frT = 0.35; updateFrustum();
    if (quiet()) return;                       // (never while pulling into a stop or during a question: later)
    for (const [id, x, y, z, hh, line, wlen, top] of c.spots() || []) {
      if (c.spotted[id]) continue;
      const px = screenPx(x, y, z, hh || 2, wlen || 0, top || 0.7);
      // coming into view: ease the bus down a little for a few seconds so the child gets a good look
      if (px >= SEEN_PX * 0.45 && !c.slowed && !sightBlocked(x, y + (hh || 2) / 2, z)) { c.slowed = true; c.slowT = 6; }
      if (px < SEEN_PX || sightBlocked(x, y + (hh || 2) / 2, z)) continue;
      c.spotted[id] = true; c.seen = true;
      if (!c.saidIntro) { c.saidIntro = true; const intro = (c.spots() || []).find((q) => q[5]); if (intro) talk(intro[5], true); }
      if (NAMES[id]) E.spot(id);             // (the UI's "New sticker!" is queued after our line)
    }
  }

  function init() {
    if (started) return;
    started = true;
    buildParticles();
  }
  // ---------- per frame (main.js calls BB.events.update(dt) after the others; otherwise we hook in ourselves) ----------
  let ticked = false;
  E.update = function (dt) {
    ticked = true;
    if (!E.enabled) return;
    const w = W(); if (!w || !w.built || !BB.scene || !Bs() || !Bs().front) return;
    if (!started) init();
    clock += dt;
    lightK = 1 - 0.55 * (w.night ? w.night() : 0);
    crowdBegin();
    if (E.current) {
      const c = E.current;
      if (!canRun()) finish();
      else {
        const keep = safe(() => c.update(dt));
        const a = c.at ? safe(() => c.at()) : null;
        if (a && !busNear(a.x, a.z, 260)) c.far += dt; else c.far = 0;
        if (clock - c.t0 < 25 && !c.doneTalk && targetNear(55)) {
          if (holdable()) { if (!c.held || clock - c.held > 6) { c.held = clock; holdArrival(8); } }
          else if (!c.heldUntil) c.heldUntil = clock + 8;
        }
        if (c.heldUntil && clock < c.heldUntil && targetNear(45) && !targetNear(16) && !jobBusy()) {
          const B = Bs(); if (B.speed > 3) B.speed = Math.max(3, B.speed - dt * 5);   // (no holdArrival yet: a slow roll in)
        }
        if (c.slowT > 0) {                       // the gentle look: never below 6.5, never at a stop or a question
          c.slowT -= dt; const B = Bs();
          if (B.speed > 6.5 && !jobBusy() && !pullingIn()) B.speed = Math.max(6.5, B.speed - dt * 5);
        }
        if (keep === false || keep === null || c.far > 5 || clock - c.t0 > 150) finish();
        else spotting(dt);
      }
    }
    if (!E.current) crowdBegin();
    crowdEnd();
    safe(() => updateSplash(dt));
    safe(() => schedule(dt));
    updateParticles(dt);
    updateBubble(dt);
  };
  BB.on('hub:pause', () => E.stop());
  // Fallback when main.js doesn't call us: wrap BB.update once it exists (no double update if it does call us).
  function autoHook() {
    if (E.hooked || typeof BB.update !== 'function') return E.hooked;
    const orig = BB.update;
    BB.update = function (dt) { ticked = false; orig(dt); if (!ticked) E.update(dt); };
    E.hooked = true;
    return true;
  }
  if (document.readyState === 'complete') setTimeout(autoHook, 0);
  else addEventListener('load', () => { if (!autoHook()) { let n = 0; const iv = setInterval(() => { if (autoHook() || ++n > 100) clearInterval(iv); }, 100); } });
  E.stats = () => ({ particles: pLive, people: Object.keys(crowd).reduce((a, k) => a + (crowd[k].n ? 1 : 0), 0), current: E.active() });
})();
