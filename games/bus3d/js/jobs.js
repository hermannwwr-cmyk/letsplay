/* Bendy Bus 3D: jobs.
   A job = drive to 2-3 stops in turn. At each stop people get on or off and the child answers one adding or
   taking-away question shown with pictures to count: a ten-frame of seats (two rows of five, like the bus's own seats),
   with the friends who got on ringed in mint and the ones who got off left as faded dashed ghosts, and three big
   number buttons in a random order. Seats can be tapped to count aloud ("1, 2, 3...").
   Wrong answer -> Mina the mynah bird (the bus conductor) walks through it step by step: count on for adding, wave
   goodbye and count what's left for taking away, with "5 and 2 more" ten-frame language; the answer buttons are dimmed
   until "Now, which number is it?". The same scene guides the first question of each kind. Tap the card to skip it.
   Hint after 2 wrong tries: the seats glow on the card and numbers glow above the bus's seats.
   Cash: 3 coins for a first-try answer, 2 after a retry (never taken away), 5 more for the whole job; coins fly to the
   cash counter. Also: low-fuel trips to the depot and the friendly tow when the tank runs dry.
   Exposes BB.jobs = { current, phase, start(), update(dt), busy(), allOff(cb), ... }.
   Every flow timer goes through BB.later / BB.wait (they freeze while the game is held) and every spoken line is
   awaited before the next one, so nothing is cut off. */
(function () {
  'use strict';
  const BB = window.BB, P = BB.P;
  const J = BB.jobs = { current: null, phase: 'idle', walkers: [], waiting: [], question: null, teaching: false };

  const CASH_STOP = 3, CASH_STOP_RETRY = CASH_STOP, CASH_JOB = 5;   // same coins after a retry: no hidden penalty
  const wait = (ms) => (BB.wait ? BB.wait(ms) : new Promise((r) => BB.later(ms, r)));
  const cancelLater = (t) => { if (t == null) return; if (BB.cancelLater) BB.cancelLater(t); else clearTimeout(t); };
  // Lines queue behind whatever is being said (another part of the game may be talking); our own lines are awaited
  // one after another. Only a child's own tap (counting, skip, say again) cuts in.
  const say = (text, opts) => BB.say(text, opts || { queue: true });
  const sayNow = (text) => BB.say(text, { queue: false });
  const plural = (n, one, many) => (n === 1 ? one : many);
  const timeUp = () => !!(BB.bedtime || (BB.hub && BB.hub.timeUp && BB.hub.timeUp()));

  // phase + a "busy" signal (a stop or a question is in progress) for the bedtime flow in main.js
  let wasBusy = false;
  function setPhase(p) {
    J.phase = p;
    const b = J.busy();
    if (b !== wasBusy) { wasBusy = b; BB.emit('jobs:busy', { on: b }); }
  }
  J.busy = () => J.phase === 'stop' || J.phase === 'question' || J.phase === 'tow';

  // ---------- difficulty ----------
  // Grows with the number of questions answered (BB.save.questions). Every number stays 0-10.
  // tot = most people on the bus, kMax = most getting on/off at once, sub = chance of taking away.
  const LEVELS = [
    { kMax: 1, tot: 4, sub: 0 },                 // the very first questions: 2 + 1, then 3 + 1
    { kMax: 2, tot: 6, sub: 0 },
    { kMax: 2, tot: 7, sub: 0.45, subK: 1 },     // taking away starts gently: one gets off
    { kMax: 3, tot: 9, sub: 0.5 },
    { kMax: 4, tot: 10, sub: 0.5, zero: true },  // now and then everybody gets off: 0 left
  ];
  const level = () => { const q = BB.save.questions | 0; return q < 2 ? 0 : q < 4 ? 1 : q < 7 ? 2 : q < 11 ? 3 : 4; };
  J.level = level;
  const qKey = (q) => q.kind + q.n + '/' + q.k;

  // n0 = passengers on the bus now. Returns {kind, pre, n, k, answer, choices}.
  // pre: people who get on (> 0) or off (< 0) first, without a question, so the question starts from a good group.
  function makeQuestion(n0, avoid) {
    const lv = level(), L = LEVELS[lv], first = !(BB.save.questions | 0);
    let q = null;
    for (let tries = 0; tries < 60 && !q; tries++) {
      const free = tries > 10;                   // after a few tries, also change who is on the bus first
      const kind = Math.random() < L.sub ? 'sub' : 'add';
      let n = n0, k;
      // a new starting group, at most 4 people getting on or off first (so the stop doesn't take ages)
      const regroup = (lo, hi) => { const a = Math.max(lo, n0 - 4), b = Math.min(hi, n0 + 4); return a <= b ? BB.randInt(a, b) : BB.randInt(lo, hi); };
      if (kind === 'add') {
        // adding needs n <= 8, so three possible answers fit (9 + 1 would only leave 9 and 10)
        const hiN = Math.min(8, L.tot - 1);
        if (n < 1 || n > hiN || (free && Math.random() < 0.6)) n = first ? 2 : regroup(1, Math.min(lv < 2 ? 3 : 6, hiN));
        k = BB.randInt(1, Math.max(1, Math.min(L.kMax, L.tot - n, 10 - n)));
      } else {
        if (n < 2 || n > L.tot || (free && Math.random() < 0.6)) n = regroup(3, L.tot);
        k = BB.randInt(1, Math.max(1, Math.min(L.subK || L.kMax, L.zero ? n : n - 1)));
      }
      const c = { kind, n, k, answer: kind === 'add' ? n + k : n - k };
      if (c.answer < 0 || c.answer > 10 || c.n > 10) continue;
      if (avoid && qKey(c) === avoid) continue;
      if (c.n < n0 && tries < 45) continue;      // people getting off before the question is confusing: avoid it
      q = c;
    }
    if (!q) q = { kind: 'add', n: 2, k: 1, answer: 3 };
    q.pre = q.n - n0;
    q.choices = makeChoices(q);
    q.tries = 0;
    return q;
  }
  J.makeQuestion = makeQuestion;

  // Three numbers in a row (e.g. 3 4 5) that contain the answer, all possible for this question (adding can't give
  // fewer than were on the bus, taking away can't give more), shown in a random order.
  function makeChoices(q) {
    const a = q.answer;
    const tryRange = (lo, hi) => [a - 2, a - 1, a].filter((s) => s >= lo && s + 2 <= hi);
    let starts = q.kind === 'add' ? tryRange(q.n, 10) : tryRange(0, q.n);
    if (!starts.length) starts = tryRange(0, 10);
    const s = BB.pick(starts);
    return BB.shuffle([s, s + 1, s + 2]);
  }
  J.makeChoices = makeChoices;

  // ---------- people (low-poly, one mesh each, shared geometries) ----------
  const LOOKS = [];
  function buildLooks() {
    const shirts = [P.coral, P.teal, P.honey, P.berry, P.plum, P.leaf, P.rose, '#f28b4b'];
    const skins = ['#f1c7a0', '#d9a679', '#a8714a', '#f5d3b5', '#7a4b2e'];
    const hairs = ['#3a2a2c', '#6b4a2e', '#1f1b22', '#b5793e'];
    for (let i = 0; i < 8; i++) {
      const b = BB.mk.builder(), kid = i % 3 === 2, s = kid ? 0.72 : 1;
      b.box(0.22 * s, 0.8 * s, 0.24 * s, '#4a5a78', -0.13 * s, 0, 0); b.box(0.22 * s, 0.8 * s, 0.24 * s, '#4a5a78', 0.13 * s, 0, 0);
      b.cyl(0.26 * s, 0.32 * s, 0.85 * s, 6, shirts[i], 0, 0.78 * s, 0);
      b.ball(0.27 * s, skins[i % skins.length], 0, 1.9 * s, 0);
      b.ball(0.28 * s, hairs[i % hairs.length], 0, 2.0 * s, -0.05 * s, 0, 1, 0.7, 1);
      b.box(0.12 * s, 0.6 * s, 0.14 * s, shirts[i], -0.36 * s, 0.95 * s, 0); b.box(0.12 * s, 0.6 * s, 0.14 * s, shirts[i], 0.36 * s, 0.95 * s, 0);
      LOOKS.push(b.geometry());
    }
  }
  function person(i) { const m = new THREE.Mesh(LOOKS[i % LOOKS.length], BB.mk.mat); m.name = 'person'; BB.scene.add(m); return m; }
  const removePerson = (m) => { BB.scene.remove(m); };
  function clearWaiting() { for (const m of J.waiting) removePerson(m); J.waiting = []; }
  const GROUND = 0.25;
  // Points next to the bus, in the front carriage's frame (+x is the door side, the kerb).
  const busPoint = (x, z, y) => { const v = new THREE.Vector3(x, 0, z); BB.bus.front.localToWorld(v); v.y = y == null ? GROUND : y; return v; };
  const doorOut = () => busPoint(2.0, 2.6);
  const doorIn = () => busPoint(0.4, 2.6, 0.55);

  // Put the people for the next question at the stop's shelter, in a little queue facing the road.
  function setWaiting(stop, q) {
    clearWaiting();
    if (!stop || !q) return;
    const pre = Math.max(0, q.pre), total = pre + (q.kind === 'add' ? q.k : 0);
    for (let i = 0; i < total; i++) {
      const m = person(BB.randInt(0, 7));
      const along = 4.6 + Math.floor(i / 2) * 0.9, off = (i % 2) * 0.8 - 0.1;
      m.position.set(stop.pos.x + stop.fwd.x * along + stop.side.x * off, GROUND, stop.pos.z + stop.fwd.z * along + stop.side.z * off);
      m.rotation.y = Math.atan2(-stop.side.x, -stop.side.z);
      m.userData.pre = i < pre;
      m.userData.seed = Math.random() * 6;
      J.waiting.push(m);
    }
  }
  // Walk a person to a point at a gentle pace. Resolves on arrival.
  function walkTo(m, to, speed = 2.6, opts = {}) {
    return new Promise((resolve) => {
      const from = m.position.clone(), dist = Math.hypot(to.x - from.x, to.z - from.z);
      J.walkers.push({ m, from, to: to.clone(), t: 0, dur: Math.max(0.35, dist / speed), done: resolve, shrink: !!opts.shrink });
    });
  }
  // One person gets on: walk to the door, step in, and appear in the next seat (the bus draws seated heads by count).
  async function boardOne(m, onSeat) {
    await walkTo(m, doorOut());
    await walkTo(m, doorIn(), 2.2);
    removePerson(m);
    BB.bus.passengers = BB.clamp((BB.bus.passengers | 0) + 1, 0, 10);
    BB.sfx.pop();
    if (onSeat) onSeat(BB.bus.passengers - 1);
  }
  // People get on one after another (a little overlap, so a queue of 4 doesn't take ages).
  function boardPeople(list, onSeat) {
    return Promise.all(list.map((m, i) => wait(i * 520).then(() => boardOne(m, onSeat))));
  }
  // One person gets off: the last seated leaves first (seat n-1), steps out of the door and walks away along the
  // pavement, waving goodbye with a little hop.
  async function alightOne(onLeave) {
    const seat = (BB.bus.passengers | 0) - 1;
    if (seat < 0) return;
    BB.bus.passengers = seat;
    if (onLeave) onLeave(seat);
    const m = person(BB.randInt(0, 7));
    m.position.copy(doorIn());
    BB.sfx.pop();
    await walkTo(m, doorOut(), 2.2);
    const away = busPoint(BB.rand(4.2, 5.4), 2.6 + BB.rand(-7, 7));
    walkTo(m, away, 2.4, { shrink: true }).then(() => removePerson(m));
    await wait(250);
  }
  async function alightPeople(count, onLeave) {
    for (let i = 0; i < count; i++) { await alightOne(onLeave); await wait(260); }
  }
  // Everybody gets off and walks away (e.g. for a goodnight moment). cb when the bus is empty.
  J.allOff = async function (cb) {
    try {
      if ((BB.bus.passengers | 0) > 0) { BB.bus.openDoors(); await wait(600); await alightPeople(BB.bus.passengers | 0); }
    } finally { if (cb) cb(); }
  };

  // ---------- glowing numbers above the bus's seats (3D) ----------
  // Little sprites over each seat, so counting on the card lights up the real bus too.
  const markTex = {};
  function texFor(label) {
    if (markTex[label]) return markTex[label];
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 30, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,214,92,0.7)'); g.addColorStop(1, 'rgba(255,190,40,0)');
    x.fillStyle = g; x.beginPath(); x.arc(64, 64, 64, 0, Math.PI * 2); x.fill();
    if (label === '') {                       // a little star
      x.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 19 : 44, a = -Math.PI / 2 + i * Math.PI / 5; x.lineTo(64 + Math.cos(a) * r, 66 + Math.sin(a) * r); }
      x.closePath(); x.fillStyle = '#ffd45c'; x.fill();
    } else {
      x.fillStyle = '#ffb81f'; x.beginPath(); x.arc(64, 64, 44, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff6e0'; x.beginPath(); x.arc(62, 62, 37, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#d98700'; x.font = '800 54px "Fredoka","Baloo 2",system-ui,sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label, 62, 66);
    }
    const t = new THREE.CanvasTexture(c);
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; else if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    return (markTex[label] = t);
  }
  const marks = [];
  function ensureMarks() {
    if (marks.length || !BB.bus.front || !BB.bus.seats || BB.bus.seats.length < 10) return marks.length > 0;
    for (let i = 0; i < 10; i++) {
      const s = BB.bus.seats[i];
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFor(''), transparent: true, depthTest: false, depthWrite: false, fog: false }));
      sp.position.set(s.x * 1.5, 4.0, s.z);
      sp.renderOrder = 20; sp.visible = false; sp.userData = { base: 0.72, pulse: false, pop: 0 };
      BB.bus.front.add(sp); marks.push(sp);
    }
    return true;
  }
  // Only the seat being counted shows its number above the bus (several would pile up at the stop camera angle).
  function mark(i, label, pulse) {
    if (!ensureMarks() || i < 0 || i > 9) return;
    clearMarks();
    const sp = marks[i];
    sp.material.map = texFor(label == null ? '' : String(label)); sp.material.needsUpdate = true;
    sp.visible = true; sp.userData.pulse = !!pulse; sp.userData.pop = 1;
  }
  function unmark(i) { if (marks[i]) marks[i].visible = false; }
  function clearMarks() { for (const sp of marks) sp.visible = false; }

  // ---------- the question card (DOM) ----------
  BB.css(`
  .bbq { position: absolute; left: 50%; bottom: max(10px, env(safe-area-inset-bottom)); transform: translateX(-50%);
    --cell: 52px; --bird: 92px; background: #fff6e0; border: 4px solid #d9b57f; border-radius: 28px;
    box-shadow: 0 8px 0 rgba(120,80,40,.18); padding: 10px 20px 14px; display: flex; gap: 22px; align-items: flex-end;
    pointer-events: auto; font-family: 'Fredoka', 'Baloo 2', system-ui, sans-serif; color: #3a2a3c; box-sizing: border-box;
    animation: bbq-in .4s cubic-bezier(.2,1.4,.5,1); touch-action: manipulation; }
  @keyframes bbq-in { from { transform: translate(-50%, 140%); } }
  .bbq.out { animation: bbq-out .3s ease-in forwards; }
  @keyframes bbq-out { to { transform: translate(-50%, 140%); opacity: 0; } }
  .bbq-pic { position: relative; padding-top: calc(var(--bird) * .42); padding-right: calc(var(--bird) * .4); }
  .bbq-frame { display: grid; grid-template-columns: repeat(5, var(--cell)); gap: 6px; padding: 8px; background: #3fae49;
    border-radius: 18px; box-shadow: inset -4px -5px 0 #2f8f3a; }
  .bbq-seat { width: var(--cell); height: var(--cell); border-radius: 13px; background: #d6efd2; position: relative;
    display: flex; align-items: center; justify-content: center; transition: transform .2s, background .25s, box-shadow .25s; }
  .bbq-seat:nth-child(n+6) { background: #ffe2b8; }
  .bbq-seat svg { width: 86%; height: 86%; transition: opacity .35s, transform .35s; }
  .bbq-seat.full svg { animation: bbq-sit .35s cubic-bezier(.2,1.6,.5,1); }
  @keyframes bbq-sit { from { transform: translateY(-40%) scale(.5); opacity: 0; } }
  .bbq-seat.new { box-shadow: inset 0 0 0 4px #19a79b; }
  .bbq-seat.gone { box-shadow: inset 0 0 0 3px #ff6b5c; background: #fff6e0 !important; }
  .bbq-seat.gone svg { opacity: .22; filter: grayscale(.6); }
  .bbq-seat.bye svg { animation: bbq-bye .5s ease-in-out 2; }
  @keyframes bbq-bye { 25% { transform: rotate(-14deg); } 75% { transform: rotate(14deg); } }
  .bbq-seat.lit { background: #ffd45c !important; transform: scale(1.1); box-shadow: 0 0 0 4px #ffb81f, 0 0 16px #ffb81f; z-index: 1; }
  .bbq-seat.lit.gone svg { opacity: .5; }
  .bbq-seat .num { position: absolute; left: -7px; top: -9px; z-index: 4; min-width: 26px; height: 26px; padding: 0 3px; box-sizing: border-box;
    border-radius: 13px; background: #ff6b5c; color: #fff; font: 700 19px/26px 'Fredoka', 'Baloo 2', system-ui, sans-serif;
    text-align: center; box-shadow: 0 2px 0 #c84a3c; animation: bbq-pop .35s cubic-bezier(.2,1.6,.5,1); pointer-events: none; }
  .bbq-seat .num.big { background: #19a79b; box-shadow: 0 2px 0 #127a71; }
  .bbq.hint .bbq-seat.full:not(.lit) { animation: bbq-glow .9s infinite alternate; }
  @keyframes bbq-glow { to { box-shadow: 0 0 0 5px #ffd45c, 0 0 18px #ffb81f; } }
  .bbq-bird { position: absolute; width: var(--bird); height: var(--bird); left: 0; top: 0; pointer-events: none; z-index: 3;
    transition: transform .42s cubic-bezier(.3,1.3,.5,1); will-change: transform; }
  .bbq-bird svg { width: 100%; height: 100%; display: block; transform-origin: 50% 90%; }
  .bbq-bird.hop svg { animation: bbq-hop .42s ease-out; }
  @keyframes bbq-hop { 40% { transform: translateY(-30%) scaleY(1.06); } 80% { transform: translateY(0) scaleY(.9); } }
  .bbq-bird.talk svg { animation: bbq-talk .5s ease-in-out infinite alternate; }
  @keyframes bbq-talk { to { transform: rotate(-6deg); } }
  .bbq-side { display: flex; gap: 12px; align-items: center; padding-bottom: 6px; }
  .bbq-ask { display: flex; gap: 12px; align-items: center; }
  .bbq-btn { width: 88px; height: 88px; border-radius: 26px; border: none; font: 700 50px/1 'Fredoka', 'Baloo 2', system-ui, sans-serif;
    color: #fff; background: #4fa3e0; box-shadow: inset -5px -6px 0 rgba(0,0,0,.12), 0 6px 0 #2f7fbc; cursor: pointer;
    touch-action: manipulation; padding: 0; transition: opacity .3s, transform .15s; }
  .bbq-btn:nth-child(2) { background: #f5b83d; box-shadow: inset -5px -6px 0 rgba(0,0,0,.12), 0 6px 0 #c98f1c; }
  .bbq-btn:nth-child(3) { background: #b07ad8; box-shadow: inset -5px -6px 0 rgba(0,0,0,.12), 0 6px 0 #8a55b4; }
  .bbq-btn.pressed { transform: translateY(4px); }
  .bbq-btn.shake { animation: bbq-shake .45s; }
  @keyframes bbq-shake { 20%, 60% { transform: translateX(-8px) rotate(-4deg); } 40%, 80% { transform: translateX(8px) rotate(4deg); } }
  .bbq-btn.yes { animation: bbq-pop .5s; box-shadow: 0 0 0 6px #ffd45c, 0 6px 0 rgba(0,0,0,.2); }
  @keyframes bbq-pop { 50% { transform: scale(1.25); } }
  .bbq.wait .bbq-btn, .bbq.teaching .bbq-btn { opacity: .35; pointer-events: none; }
  .bbq-say { width: 60px; height: 60px; border-radius: 50%; border: 3px solid #d9b57f; background: #fff; cursor: pointer; padding: 0;
    display: flex; align-items: center; justify-content: center; touch-action: manipulation; box-shadow: 0 4px 0 rgba(120,80,40,.15); }
  .bbq-say svg { width: 34px; height: 34px; }
  .bbq-say.pressed { transform: translateY(3px); box-shadow: none; }
  .bbq.teaching .bbq-say, .bbq.wait .bbq-say { opacity: .35; }
  .bbq-coin { position: absolute; left: 0; top: 0; width: 40px; height: 40px; pointer-events: none; z-index: 30; }
  .bbj { position: absolute; left: 50%; top: 24%; transform: translate(-50%, 0); display: flex; align-items: center; gap: 12px;
    background: #fff6e0; border: 4px solid #d9b57f; border-radius: 32px; padding: 10px 26px; pointer-events: none;
    box-shadow: 0 8px 0 rgba(120,80,40,.18); font: 800 48px/1 'Fredoka', 'Baloo 2', system-ui, sans-serif; color: #d98700;
    animation: bbj-in .5s cubic-bezier(.2,1.5,.5,1); }
  .bbj.out { transition: opacity .4s, transform .4s; opacity: 0; transform: translate(-50%, -30px); }
  @keyframes bbj-in { from { transform: translate(-50%, 0) scale(.3); opacity: 0; } }
  .bbj svg { width: 56px; height: 56px; animation: bbq-pop .5s both; }
  .bbj svg:nth-child(2) { animation-delay: .15s; } .bbj svg:nth-child(3) { animation-delay: .3s; }
  .bbj canvas { width: 52px; height: 52px; margin-left: 10px; }
  @media (max-height: 520px) {
    .bbq { left: max(10px, env(safe-area-inset-left), var(--padx, 0px)); bottom: max(8px, env(safe-area-inset-bottom)); transform: none;
      flex-direction: column; align-items: center; gap: 8px; padding: 6px 12px 12px; border-radius: 22px; --cell: 36px; --bird: 66px; }
    @keyframes bbq-in { from { transform: translateX(-120%); } }
    .bbq.out { animation-name: bbq-out-l; }
    @keyframes bbq-out-l { to { transform: translateX(-120%); opacity: 0; } }
    .bbq-frame { gap: 4px; padding: 6px; border-radius: 14px; }
    .bbq-seat { border-radius: 10px; }
    .bbq-seat .num { min-width: 22px; height: 22px; font-size: 16px; line-height: 22px; left: -6px; top: -8px; }
    .bbq-side { gap: 8px; padding-bottom: 4px; }
    .bbq-ask { gap: 8px; }
    .bbq-btn { width: 64px; height: 64px; font-size: 38px; border-radius: 20px; }
    .bbq-say { width: 56px; height: 56px; }
    .bbj { font-size: 36px; padding: 8px 20px; top: 20%; } .bbj svg { width: 42px; height: 42px; } .bbj canvas { width: 40px; height: 40px; }
  }`);

  // A friendly face for each seat (shirt, skin and hair vary; the same seat always shows the same friend).
  const SHIRTS = [P.coral, P.teal, P.honey, P.berry, P.plum, P.leaf, P.rose, '#f28b4b', '#4cb5a0', '#e0607e'];
  const SKINS = ['#f1c7a0', '#d9a679', '#a8714a', '#f5d3b5', '#7a4b2e'];
  const HAIRS = ['#3a2a2c', '#6b4a2e', '#1f1b22', '#b5793e', '#2a1d1a'];
  function face(i) {
    const c = SHIRTS[i % 10], sk = SKINS[(i * 3) % 5], h = HAIRS[(i * 2 + 1) % 5], long = i % 3 === 1;
    return `<svg viewBox="0 0 40 40"><path d="M7 40 Q7 25 20 25 Q33 25 33 40Z" fill="${c}"/>` +
      `<path d="M26 27 Q33 30 33 40 H26Z" fill="#000" opacity=".12"/>` +
      (long ? `<path d="M10 16 Q10 30 14 30 L26 30 Q30 30 30 16Z" fill="${h}"/>` : '') +
      `<circle cx="20" cy="16" r="9" fill="${sk}"/><path d="M24 23 Q29 20 29 15 Q29 22 22 25Z" fill="#000" opacity=".1"/>` +
      `<path d="M11 15 Q12 6 20 6 Q28 6 29 15 Q24 10 20 11 Q15 10 11 15Z" fill="${h}"/>` +
      `<circle cx="16.5" cy="17" r="1.5" fill="#3a2a3c"/><circle cx="23.5" cy="17" r="1.5" fill="#3a2a3c"/>` +
      `<circle cx="14" cy="20" r="1.8" fill="#ff8fab" opacity=".55"/><circle cx="26" cy="20" r="1.8" fill="#ff8fab" opacity=".55"/>` +
      `<path d="M17 21 Q20 23.5 23 21" stroke="#c0614e" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;
  }
  // Mina the mynah, the bus conductor: a round brown bird with a yellow eye patch and a teal conductor's cap.
  const BIRD = `<svg viewBox="0 0 80 80"><path d="M16 50 L2 58 L5 44Z" fill="#3f2b26"/>
    <ellipse cx="40" cy="48" rx="25" ry="23" fill="#6b4a3e"/>
    <path d="M63 42 A25 23 0 0 1 28 69 Q52 66 63 42Z" fill="#553a30"/>
    <ellipse cx="45" cy="58" rx="12" ry="9" fill="#9a7a66"/>
    <path d="M20 44 Q30 36 40 49 Q32 60 20 55Z" fill="#4a332c"/><path d="M24 51 Q28 49 32 52 Q28 55 24 53Z" fill="#fff6e0"/>
    <ellipse cx="52" cy="38" rx="8.5" ry="7.5" fill="#ffcf3f"/>
    <circle cx="53" cy="37.5" r="3.4" fill="#2a1d1a"/><circle cx="54.2" cy="36.3" r="1.1" fill="#fff"/>
    <path d="M59 42 L73 45.5 L59 49.5Z" fill="#ffb81f"/><path d="M59 46 L73 45.5 L59 49.5Z" fill="#d98700"/>
    <circle cx="47" cy="47" r="3" fill="#ff8fab" opacity=".75"/>
    <path d="M27 31 Q38 15 54 25 L56 31Z" fill="#19a79b"/><path d="M48 29 L67 31 L54 34Z" fill="#127a71"/>
    <circle cx="41" cy="25" r="3.2" fill="#ffd45c"/>
    <path d="M35 69 v7 M45 69 v7 M32 76 h6 M42 76 h6" stroke="#ffb81f" stroke-width="3" stroke-linecap="round"/></svg>`;
  const SPEAKER = '<svg viewBox="0 0 40 40"><path d="M6 15 H13 L22 7 V33 L13 25 H6Z" fill="#19a79b"/><path d="M27 13 Q32 20 27 27 M30 9 Q38 20 30 31" stroke="#19a79b" stroke-width="3.2" fill="none" stroke-linecap="round"/></svg>';
  const STAR = '<svg viewBox="0 0 40 40"><path d="M20 3 L25 14.5 L37.5 15.5 L28 24 L31 36.5 L20 30 L9 36.5 L12 24 L2.5 15.5 L15 14.5Z" fill="#ffd45c"/><path d="M28 24 L31 36.5 L20 30Z" fill="#ffb81f"/></svg>';

  let card = null, pic = null, frame = null, bird = null, seatEls = [], btnEls = [];
  let seq = 0;                      // bumps whenever a talking sequence (story, teaching) should stop
  let tapped = [];                  // seats the child has tapped to count, in order

  const nPhrase = (n) => `${n} ${plural(n, 'friend is', 'friends are')} on the bus.`;
  const kPhrase = (q) => q.kind === 'add' ? `${q.k} more ${plural(q.k, 'gets', 'get')} on.` : `${q.k} ${plural(q.k, 'gets', 'get')} off.`;
  const askPhrase = (q) => q.kind === 'add' ? 'How many are on the bus now?' : 'How many are left on the bus?';
  J.sentence = (q) => `${nPhrase(q.n)} ${kPhrase(q)} ${askPhrase(q)}`;

  // Seat states on the card: '' empty, 'full', 'new' (just got on), 'gone' (just got off).
  function setSeat(i, state) {
    const el = seatEls[i]; if (!el) return;
    const had = el.dataset.state || '';
    el.dataset.state = state;
    el.classList.toggle('full', state === 'full' || state === 'new');
    el.classList.toggle('new', state === 'new');
    el.classList.toggle('gone', state === 'gone');
    if (!state) el.innerHTML = '';
    else if (!had) el.innerHTML = face(i);
  }
  const isFull = (i) => seatEls[i] && (seatEls[i].dataset.state === 'full' || seatEls[i].dataset.state === 'new');
  function badge(i, num, big) {
    const el = seatEls[i]; if (!el) return;
    let b = el.querySelector('.num');
    if (!b) b = BB.el('b', 'num', el);
    else { b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; }
    b.textContent = String(num); b.classList.toggle('big', !!big);
  }
  function light(i, on) { if (seatEls[i]) seatEls[i].classList.toggle('lit', on); }
  function clearCounting() {
    tapped = [];
    seatEls.forEach((el) => { el.classList.remove('lit', 'bye'); const b = el.querySelector('.num'); if (b) b.remove(); });
    clearMarks();
  }

  // Mina hops to a seat (perching on its top-right corner) or back to her spot on the frame's top-right corner.
  function birdTo(i, beside) {
    if (!bird || !frame) return;
    const bw = bird.offsetWidth, bh = bird.offsetHeight;
    let x, y;
    const el = i == null ? null : seatEls[i];
    // seats' offsetParent is .bbq-pic; she perches on the top-right corner, ahead of the count (badges sit top-left)
    if (el && beside) { x = el.offsetLeft + el.offsetWidth - bw * 0.18; y = el.offsetTop + el.offsetHeight - bh * 0.95; }   // next to it, not on it
    else if (el) { x = el.offsetLeft + el.offsetWidth - bw * 0.5; y = el.offsetTop - bh * 0.62; }
    else { x = frame.offsetLeft + frame.offsetWidth - bw * 0.5; y = frame.offsetTop - bh * 0.78; }   // perched on the card's top edge
    bird.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    bird.classList.remove('hop'); void bird.offsetWidth; bird.classList.add('hop');
  }

  function buildCard(q) {
    hideQuestion(true, true);
    card = BB.el('div', 'bbq wait', BB.ui.root || document.getElementById('ui'));
    pic = BB.el('div', 'bbq-pic', card);
    frame = BB.el('div', 'bbq-frame', pic);
    seatEls = [];
    for (let i = 0; i < 10; i++) { const s = BB.el('div', 'bbq-seat', frame); s.dataset.i = i; seatEls.push(s); }
    bird = BB.el('div', 'bbq-bird', pic, BIRD);
    const side = BB.el('div', 'bbq-side', card);
    const ask = BB.el('div', 'bbq-ask', side);
    const sayBtn = BB.el('button', 'bbq-say', side, SPEAKER);
    sayBtn.setAttribute('aria-label', 'Say it again');
    BB.tap(sayBtn, () => { if (J.phase === 'question' && !J.teaching && !q.done) { seq++; sayNow(J.sentence(q)); } });
    btnEls = q.choices.map((v) => {
      const b = BB.el('button', 'bbq-btn', ask, String(v));
      b.dataset.v = v;
      BB.tap(b, () => answer(q, v, b));
      return b;
    });
    for (let i = 0; i < q.n; i++) setSeat(i, 'full');
    // taps on the card: skip the teaching scene, or count the seats aloud
    card.addEventListener('pointerup', (e) => {
      if (!card || e.target.closest('button')) return;
      if (BB.audio && BB.audio.unlock) BB.audio.unlock();
      if (J.teaching) { skipTeach(); return; }
      const seat = e.target.closest('.bbq-seat');
      if (seat && J.phase === 'question' && !q.done) countTap(+seat.dataset.i);
    });
    requestAnimationFrame(() => birdTo(null));
    BB.emit('question:show', { q });
  }

  // The child taps seats to count: each friend not counted yet gets the next number, said aloud.
  function countTap(i) {
    if (!isFull(i)) return;
    if (tapped.includes(i)) {
      const full = seatEls.filter((el, j) => isFull(j)).length;
      if (tapped.length < full) return;               // already counted: ignore until they've counted everyone
      clearCounting();                                 // counted everyone: tap again to start over
    }
    tapped.push(i);
    light(i, true); badge(i, tapped.length); mark(i, tapped.length);
    BB.sfx.tick();
    sayNow(String(tapped.length));
    if (card && card.classList.contains('counting')) {
      birdTo(i);
      const all = seatEls.filter((el, j) => isFull(j)).length, q = J.question;
      if (tapped.length === all && q) { card.classList.remove('counting'); say(q.kind === 'sub' ? 'So how many are left?' : 'So how many now?'); }
    }
  }

  function hideQuestion(now, keepSeq) {
    if (!keepSeq) { seq++; stopGen++; }
    J.teaching = false;
    if (card) {
      const c = card;
      card = null; bird = null; frame = null; pic = null; seatEls = []; btnEls = [];
      if (now) c.remove(); else { c.classList.add('out'); BB.later(350, () => c.remove()); }
      BB.emit('question:hide');
    }
    clearMarks();
  }
  J.hideQuestion = () => hideQuestion();

  // ---------- a stop: people get on or off, then the question ----------
  let stopGen = 0;                  // bumps when a stop's flow should stop (the card closes, bedtime)
  async function runStop(stop, q, onRight) {
    const g = ++stopGen;
    const alive = () => g === stopGen && J.phase === 'stop' && !BB.bedtime;
    // first, people who get on (or, rarely, off) without a question, so the question starts from a good group.
    // Getting off happens quietly: anything spoken here would sound like the question.
    if (q.pre > 0) {
      const pre = J.waiting.filter((m) => m.userData.pre);
      J.waiting = J.waiting.filter((m) => !m.userData.pre);
      await Promise.all([say('Hello! In you get!'), boardPeople(pre)]);
    } else if (q.pre < 0) {
      await alightPeople(-q.pre);
    }
    if (!alive()) return;
    BB.bus.passengers = q.n;
    buildCard(q);
    J.question = q;
    await wait(350);
    if (!alive()) return;
    // the first time adding / taking away: Mina shows a worked example with different numbers, then it's our turn
    if (!BB.save.seen[q.kind]) {
      BB.save.seen[q.kind] = true; BB.saveNow();
      await J.teach(demoFor(q), 'demo');
      if (!alive() || !card) return;
      showGroup(q.n);
      await wait(400);
      if (!alive()) return;
    }
    // the story, told while it happens
    for (let i = 0; i < q.n; i++) light(i, true);
    await say(nPhrase(q.n));
    for (let i = 0; i < q.n; i++) light(i, false);
    if (!alive()) return;
    if (q.kind === 'add') {
      const list = J.waiting; J.waiting = [];
      await Promise.all([say(kPhrase(q)), boardPeople(list, (seat) => { if (card) setSeat(seat, 'new'); })]);
    } else {
      await Promise.all([say(kPhrase(q)), alightPeople(q.k, (seat) => { if (card) { setSeat(seat, 'gone'); seatEls[seat].classList.add('bye'); } })]);
    }
    if (!alive() || !card) return;
    for (let i = 0; i < 10; i++) seatEls[i].classList.remove('bye');
    BB.bus.passengers = q.answer;
    setPhase('question');
    q.onRight = onRight;
    const s = ++seq;
    await say(askPhrase(q));
    if (s !== seq || !card) return;
    card.classList.remove('wait');
  }
  // The card shows just the starting group (seats 0..n-1), e.g. after the worked example.
  function showGroup(n) {
    clearCounting();
    for (let i = 0; i < 10; i++) setSeat(i, '');
    for (let i = 0; i < n; i++) setSeat(i, 'full');
  }
  // A worked example of the same kind with different numbers (and a different answer) from the real question.
  function demoFor(q) {
    const list = q.kind === 'add' ? [[3, 2], [2, 2], [4, 1], [1, 2], [5, 1]] : [[5, 2], [4, 1], [6, 3], [3, 1], [5, 1]];
    const pick = list.find(([n, k]) => (q.kind === 'add' ? n + k : n - k) !== q.answer && !(n === q.n && k === q.k)) || list[0];
    const [n, k] = pick;
    return { kind: q.kind, n, k, answer: q.kind === 'add' ? n + k : n - k, demo: true };
  }

  const PRAISE = [(a) => `Yes! ${a}! Well done!`, (a) => `That's right, ${a}!`, (a) => `${a}! Super counting!`, (a) => `Yes, ${a}! Hooray!`];
  async function answer(q, v, btn) {
    if (!card || J.teaching || q.done || card.classList.contains('wait')) return;
    seq++;                                       // stop any counting voice
    if (v === q.answer) {
      q.done = true;
      card.classList.add('wait');
      card.classList.remove('hint', 'counting');
      btn.classList.add('yes'); BB.sfx.right();
      BB.save.questions = (BB.save.questions | 0) + 1; BB.saveNow();
      J.lastKey = qKey(q);
      const cash = q.tries ? CASH_STOP_RETRY : CASH_STOP;
      // celebrate: every friend on the bus bounces, coins fly to the cash counter
      clearMarks();
      seatEls.forEach((el, i) => { if (isFull(i)) { el.classList.add('lit'); BB.later(160 + i * 60, () => el.classList.remove('lit')); } });
      const counted = flyCoins(btn, cash);
      await Promise.all([say(BB.pick(PRAISE)(q.answer)), wait(1300), counted]);
      hideQuestion();
      if (q.onRight) q.onRight(q, cash);
    } else {
      // Wrong buttons stay tappable (just a little wobble), so counting and the hint really matter.
      q.tries++;
      btn.classList.remove('shake'); void btn.offsetWidth; btn.classList.add('shake');
      BB.sfx.wrong();
      if (q.tries === 1) await countTogether(q);             // 1st: the child counts, Mina points
      else await J.teach(q, q.tries === 2 ? 'wrong' : 'show'); // 2nd: Mina walks through it (no total); 3rd+: she shows it all
    }
  }

  // First wrong try: the seats glow and Mina invites the child to tap and count them.
  async function countTogether(q) {
    const s = ++seq;
    clearCounting();
    card.classList.add('hint', 'counting');
    const first = seatEls.findIndex((el, i) => isFull(i));
    birdTo(first >= 0 ? first : null);
    if (bird) bird.classList.add('talk');
    card.classList.add('wait');
    await say("Let's count together! Tap each friend and count.");
    if (s !== seq || !card) return;
    if (bird) bird.classList.remove('talk');
    card.classList.remove('wait');
  }

  // Coins fly from the right answer to the cash counter; the cash is added as they land. Resolves when added.
  function flyCoins(fromEl, n) {
    return new Promise((resolve) => {
      let added = false;
      const add = () => { if (added) return; added = true; BB.depot.add(n); resolve(); };
      const safety = BB.later(1800, add);
      const root = (BB.ui && BB.ui.root) || document.body;
      const target = document.querySelector('.bbu-cash canvas') || document.querySelector('.bbu-cash');
      const r0 = fromEl.getBoundingClientRect(), r1 = target ? target.getBoundingClientRect() : { left: 20, top: 20, width: 40, height: 40 };
      const x0 = r0.left + r0.width / 2 - 20, y0 = r0.top + r0.height / 2 - 20, x1 = r1.left + r1.width / 2 - 20, y1 = r1.top + r1.height / 2 - 20;
      const coin = BB.pic('coin', 80);
      for (let i = 0; i < n; i++) {
        const c = document.createElement('canvas'); c.width = c.height = 80; c.className = 'bbq-coin';
        c.getContext('2d').drawImage(coin, 0, 0);
        root.appendChild(c);
        const mx = (x0 + x1) / 2 + (i - 1) * 40, my = Math.min(y0, y1) - 60 - i * 10;
        const kf = [
          { transform: `translate(${x0}px, ${y0}px) scale(.4)`, opacity: 0 },
          { transform: `translate(${x0 + (i - 1) * 30}px, ${y0 - 50}px) scale(1.15)`, opacity: 1, offset: 0.25 },
          { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.6 },
          { transform: `translate(${x1}px, ${y1}px) scale(.8)`, opacity: 1 },
        ];
        if (!c.animate) { c.remove(); continue; }
        const a = c.animate(kf, { duration: 900, delay: 120 + i * 150, easing: 'ease-in', fill: 'both' });
        a.onfinish = () => { c.remove(); if (i === 0) { cancelLater(safety); add(); } };
      }
      if (!document.body.animate) { cancelLater(safety); add(); }
    });
  }

  // ---------- the teaching scene ----------
  // Mina walks through it on the card, seat by seat (the seat being counted also shows its number above the bus):
  //   adding:      "We have 5." (the group glows, 5 on its last seat) "2 more got on. Let's count on!" "6" ...
  //   taking away: "We had 7." "3 got off. Bye bye!" (they wave) "Who is left? Let's count." 1, 2, 3 ...
  //                (past 5: "A full row, 5!" then 6, 7 ...)
  // mode 'demo':  a worked example before the first question of a kind (different numbers), ends with the whole
  //               sentence "5 and 2 more make 7!" and "Now it's your turn!".
  // mode 'wrong': (2nd wrong try) stops one short: the last friend glows with a "?" and Mina asks "So how many now?"
  // mode 'show':  (3rd wrong try and after) counts all the way and says the total, then asks again.
  // About 8-13 s; a tap on the card skips to the end.
  J.teach = async function (q, mode) {
    if (!card) return;
    const s = ++seq;
    J.teaching = true;
    card.classList.add('teaching');
    card.classList.remove('counting');
    clearCounting();
    if (bird) bird.classList.add('talk');
    const ok = () => s === seq && !!card;
    const step = async (text, minMs = 0) => { if (!ok()) return false; await Promise.all([say(text), wait(minMs)]); return ok(); };
    const countSeat = async (i, num, big) => {
      if (!ok()) return false;
      birdTo(i); light(i, true); badge(i, num, big); mark(i, num); BB.sfx.tick();
      await Promise.all([say(String(num)), wait(700)]);
      return ok();
    };
    const quiz = (i) => { birdTo(i, true); light(i, true); badge(i, '?', true); clearMarks(); };   // the one the child works out
    const n = q.n, k = q.k, a = q.answer, full = mode !== 'wrong';
    if (q.demo) {                                           // lay out the example on the card
      for (let i = 0; i < 10; i++) setSeat(i, '');
      if (q.kind === 'add') { for (let i = 0; i < n; i++) setSeat(i, 'full'); for (let i = n; i < a; i++) setSeat(i, 'new'); }
      else { for (let i = 0; i < n; i++) setSeat(i, 'full'); for (let i = a; i < n; i++) setSeat(i, 'gone'); }
    }
    const run = async () => {
      const intro = mode === 'demo' ? (q.kind === 'add' ? 'Let me show you how to count on!' : 'Let me show you how to take away!') : "Let's count together!";
      if (!await step(intro)) return;
      if (q.kind === 'add') {
        for (let i = 0; i < n; i++) light(i, true);
        badge(n - 1, n, true); mark(n - 1, n); birdTo(n - 1);
        if (!await step(`We have ${n}.`, 700)) return;
        if (!await step(`${k} more got on. Let's count on!`, 300)) return;
        const last = full ? a : a - 1;
        for (let i = n; i < last; i++) if (!await countSeat(i, i + 1)) return;
        if (full) { if (!await step(`${n} and ${k} more make ${a}!`, 400)) return; }
        else quiz(a - 1);
      } else {
        for (let i = 0; i < n; i++) light(i, true);
        badge(n - 1, n, true); mark(n - 1, n); birdTo(n - 1);
        if (!await step(`We had ${n}.`, 600)) return;
        clearCounting();
        for (let i = a; i < n; i++) { seatEls[i].classList.add('bye'); }
        birdTo(a < 10 ? a : null);
        if (!await step(`${k} got off. Bye bye!`, 600)) return;
        if (a === 0) { if (full && !await step('Nobody is left!', 300)) return; }
        else {
          if (!await step("Who is left? Let's count.", 200)) return;
          const last = full ? a : a - 1;
          let from = 0;
          if (last >= 5 && a > 5) {
            for (let i = 0; i < 5; i++) light(i, true);
            badge(4, 5, true); mark(4, 5); birdTo(4);
            if (!await step('A full row, 5!', 400)) return;
            from = 5;
          }
          for (let i = from; i < last; i++) if (!await countSeat(i, i + 1)) return;
          if (!full) quiz(a - 1);
        }
        if (full && !await step(`${n} take away ${k} leaves ${a}!`, 400)) return;
      }
      if (mode === 'demo') { await step("Now it's your turn!", 300); if (ok()) endTeach(); return; }
      if (ok()) await finishTeach(q);
    };
    await run();
  };
  // keepQuiz: leave the "?" friend glowing (with Mina beside it) while she asks; all number badges go.
  function endTeach(keepQuiz) {
    if (!card) return;
    J.teaching = false;
    card.classList.remove('teaching');
    if (bird) bird.classList.remove('talk');
    seatEls.forEach((el) => el.classList.remove('bye'));
    const quizSeat = keepQuiz ? seatEls.findIndex((el) => { const b = el.querySelector('.num'); return b && b.textContent === '?'; }) : -1;
    clearCounting();
    if (quizSeat >= 0) { light(quizSeat, true); badge(quizSeat, '?', true); birdTo(quizSeat, true); }
    else birdTo(null);
  }
  // Back to the question: badges cleared (the seats keep glowing as the hint), the buttons light up and Mina asks.
  async function finishTeach(q) {
    if (!card) return;
    endTeach(true);
    card.classList.add('hint');
    card.classList.remove('wait');
    await say(q && q.kind === 'sub' ? 'So how many are left?' : 'So how many now?');
  }
  // A tap on the card skips the teaching scene (the worked example just ends; the story carries on).
  function skipTeach() {
    if (!J.teaching || !card) return;
    seq++;
    BB.hush();
    if (J.question && J.phase === 'question') finishTeach(J.question);
    else endTeach();                    // the worked example: the stop's story carries on
  }

  // ---------- job done ----------
  function celebrateJob(cash) {
    const root = (BB.ui && BB.ui.root) || document.body;
    const el = BB.el('div', 'bbj', root, STAR + STAR + STAR);
    const c = document.createElement('canvas'); c.width = c.height = 80; c.getContext('2d').drawImage(BB.pic('coin', 80), 0, 0);
    el.appendChild(c); BB.el('span', '', el, '+' + cash);
    BB.later(2600, () => { el.classList.add('out'); BB.later(450, () => el.remove()); });
  }

  // ---------- the job loop ----------
  // Stops for a new job: never where we are, and the previous job's stops only when there aren't enough others,
  // so the same places don't come round job after job.
  function pickStops() {
    const count = (BB.save.jobsDone | 0) < 1 ? 2 : BB.randInt(2, 3);
    const here = BB.bus.atStop || J.lastStop, before = J.lastJobStops || [];
    const all = BB.world.stops.filter((s) => s !== here);
    const fresh = BB.shuffle(all.filter((s) => !before.includes(s))), old = BB.shuffle(all.filter((s) => before.includes(s)));
    const list = fresh.concat(old).slice(0, count);
    J.lastJobStops = list;
    return list;
  }
  function bedtime() {
    clearWaiting();
    if (J.current) { J.current = null; BB.bus.stopAt(null); BB.emit('job:target', { stop: null, job: null }); }
    setPhase('bedtime');
    BB.emit('jobs:bedtime');
  }
  J.start = function () {
    if (timeUp()) { bedtime(); return; }
    const job = { stops: pickStops(), index: 0, cash: 0, q: null };
    J.current = job;
    BB.emit('job:new', { job });
    say(`New job! Drive to ${job.stops[0].say}!`, { queue: true });
    nextStop(true);
  };
  // Head for the job's current stop: a new question (and the people for it waiting at the shelter).
  function nextStop(quiet) {
    const job = J.current; if (!job) return;
    const stop = job.stops[job.index];
    job.q = makeQuestion(BB.bus.passengers | 0, J.lastKey);
    setWaiting(stop, job.q);
    driveTo(stop, quiet);
  }
  J.nextStop = nextStop;
  // Drive to the current stop again (after the depot or a tow), keeping its question and the people waiting.
  function resumeJob(quiet) {
    const job = J.current;
    if (!job) { J.start(); return; }
    if (timeUp()) { bedtime(); return; }
    const stop = job.stops[job.index];
    if (!job.q || job.q.n !== (BB.bus.passengers | 0) + job.q.pre) { nextStop(quiet); return; }
    if (!J.waiting.length && (job.q.pre > 0 || job.q.kind === 'add')) setWaiting(stop, job.q);
    driveTo(stop, quiet);
  }
  function driveTo(stop, quiet) {
    const job = J.current;
    setPhase('drive');
    BB.bus.stopAt(stop, onArrive);
    BB.emit('job:target', { stop, job });
    if (!quiet) say(`Now drive to ${stop.say}!`, { queue: true });
  }
  function onArrive(stop) {
    const job = J.current; if (!job) return;
    setPhase('stop'); J.lastStop = stop;
    BB.bus.openDoors(); BB.sfx.ding();
    const q = job.q;
    BB.later(600, () => { if (J.phase === 'stop') runStop(stop, q, (qq, cash) => afterRight(stop, qq, cash)); });
  }
  async function afterRight(stop, q, cash) {
    const job = J.current; if (!job) return;
    job.cash += cash;
    BB.emit('job:stopDone', { correct: true, cash, stop, tries: q.tries });
    await wait(500);
    if (J.current !== job || BB.bedtime) return;
    job.index++;
    if (job.index >= job.stops.length) {
      // end of the line: everybody gets off with a wave (so the next job starts fresh, no getting-off warm-ups)
      if ((BB.bus.passengers | 0) > 0) {
        await Promise.all([say('Last stop! Everybody off. Thank you, bus!'), alightPeople(BB.bus.passengers | 0)]);
        if (J.current !== job || BB.bedtime) return;
      }
      BB.bus.closeDoors();
      jobDone(); return;
    }
    BB.bus.closeDoors();
    if (timeUp()) { bedtime(); return; }     // time is up: this stop is finished, no new one
    setPhase('drive');
    // check the tank before announcing the next stop, so we never say "drive to the shops" then "let's go to the depot"
    if (J.wantDepot || BB.bus.fuel <= BB.cfg.fuelLow + 0.06) J.goDepot(BB.bus.fuel <= BB.cfg.fuelLow + 0.06 ? 'fuel' : undefined);
    else nextStop();
  }
  async function jobDone() {
    const job = J.current;
    BB.save.jobsDone = (BB.save.jobsDone | 0) + 1; BB.saveNow();
    BB.depot.add(CASH_JOB); job.cash += CASH_JOB;
    J.current = null; setPhase('done');
    BB.sfx.cheer();
    celebrateJob(job.cash);
    BB.emit('job:done', { cash: job.cash, job });
    await Promise.all([say('Job done! Great driving!'), wait(2800)]);
    if (J.phase !== 'done' || BB.bedtime) return;
    if (timeUp()) { bedtime(); return; }
    if (J.wantDepot || BB.bus.fuel <= BB.cfg.fuelLow + 0.06) J.goDepot(BB.bus.fuel <= BB.cfg.fuelLow + 0.06 ? 'fuel' : undefined);
    else J.start();
  }

  // ---------- depot trips, low fuel and the tow ----------
  J.goDepot = function (reason) {
    if (J.phase === 'question' || J.phase === 'stop' || J.phase === 'tow' || J.phase === 'bedtime') { if (J.phase !== 'bedtime') J.wantDepot = true; return; }
    J.wantDepot = false;
    setPhase('toDepot');
    BB.bus.closeDoors();
    BB.bus.stopAt(BB.world.depot, () => {
      setPhase('depot');
      BB.bus.openDoors();
      BB.depot.open();
    });
    BB.emit('job:target', { stop: BB.world.depot, job: J.current });
    if (reason !== 'quiet') say(reason === 'fuel' ? "I'm getting hungry, let's go to the depot!" : "Let's drive to the depot!", { queue: true });
  };
  BB.on('depot:closed', () => {
    if (J.phase !== 'depot') return;
    BB.bus.closeDoors();
    if (timeUp()) { bedtime(); return; }
    if (J.current) resumeJob(); else J.start();
  });
  BB.on('bus:fuelLow', () => {
    if (J.phase === 'drive' || J.phase === 'done') J.goDepot('fuel');
    else if (J.phase !== 'toDepot' && J.phase !== 'depot' && J.phase !== 'bedtime') J.wantDepot = true;
  });

  // Out of fuel: a friendly tow truck backs up to the bus (beep, beep), hooks on and pulls it to the depot, where a
  // free top-up gets it going again. No cost, no lost progress. Uses the art builder's tow truck when there is one
  // (BB.bus.makeTowTruck() or BB.world.towTruck), else a soft fade.
  function getTowTruck() {
    try {
      if (typeof BB.bus.makeTowTruck === 'function') return BB.bus.makeTowTruck();
      const w = BB.world.towTruck;
      if (typeof w === 'function') return w();
      if (w && w.isObject3D) return w;
    } catch (e) { console.error(e); }
    return null;
  }
  const tweens = [];
  function tween(dur, fn) { return new Promise((resolve) => tweens.push({ t: 0, dur, fn, done: resolve })); }
  // Where the truck's back meets the bus's front, for a truck facing the same way as the bus.
  function towSpots(truck) {
    const B = BB.bus, h = B.heading, fx = Math.sin(h), fz = Math.cos(h);
    truck.rotation.set(0, 0, 0); truck.position.set(0, 0, 0); truck.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(truck);
    const back = isFinite(box.min.z) ? -box.min.z : 3;
    const front = busPoint(0, 3.6);                     // just past the bus's nose
    const hook = new THREE.Vector3(front.x + fx * (back + 0.4), 0, front.z + fz * (back + 0.4));
    return { h, fx, fz, hook };
  }
  async function towWithTruck(truck) {
    const B = BB.bus;
    const sp = towSpots(truck);
    truck.rotation.y = sp.h;
    truck.scale.setScalar(1);
    truck.visible = true;
    if (!truck.parent) BB.scene.add(truck);
    const start = new THREE.Vector3(sp.hook.x + sp.fx * 24, 0, sp.hook.z + sp.fz * 24);
    // it reverses up to the bus, beeping
    let beepT = 0;
    await tween(3.4, (t, dt) => {
      const e = 1 - Math.pow(1 - t, 2.2);
      truck.position.lerpVectors(start, sp.hook, e);
      beepT -= dt; if (beepT <= 0 && t < 0.95) { beepT = 0.5; BB.sfx.beep(); }
    });
    BB.sfx.pop();
    await say('Clink! Hold on tight, bus!');
    // off it goes, gently pulling, while the screen fades to the depot
    const from = truck.position.clone();
    tween(1.6, (t) => { truck.position.set(from.x + sp.fx * 4 * t * t, 0, from.z + sp.fz * 4 * t * t); });
    await wait(500);
    await new Promise((resolve) => BB.ui.fade(() => {
      B.placeAt(BB.world.depot);
      B.atStop = null;
      B.refuel(1);
      const d = towSpots(truck);
      truck.rotation.y = d.h; truck.position.copy(d.hook);
      Object.assign(sp, d);
    }, resolve));
    BB.sfx.pop();
    // the truck unhooks and drives away, shrinking out of sight
    const from2 = truck.position.clone();
    tween(2.6, (t) => {
      const e = t * t;
      truck.position.set(from2.x + sp.fx * 28 * e, 0, from2.z + sp.fz * 28 * e);
      truck.scale.setScalar(t < 0.7 ? 1 : Math.max(0.01, 1 - (t - 0.7) / 0.3));
    }).then(() => { truck.visible = false; if (truck.parent && truck !== BB.world.towTruck) truck.parent.remove(truck); });
    await say('Free fuel! Thank you, tow truck!');
  }
  function towWithFade() {
    return new Promise((resolve) => {
      BB.later(1400, () => BB.ui.fade(() => {
        BB.bus.placeAt(BB.world.depot);
        BB.bus.atStop = null;
        BB.bus.refuel(1);
      }, resolve));
    }).then(() => say('Free fuel at the depot!'));
  }
  BB.on('bus:fuelEmpty', async () => {
    if (J.phase === 'tow' || BB.bedtime) return;
    const back = J.phase;
    setPhase('tow'); BB.bus.locked = true; BB.bus.go(false);
    J.wantDepot = false;
    await say("Oh! We're out of fuel. Here comes the tow truck!");
    const truck = getTowTruck();
    try { if (truck) await towWithTruck(truck); else await towWithFade(); } catch (e) { console.error(e); await towWithFade(); }
    BB.bus.locked = false;
    if (BB.bedtime) return;
    setPhase(back === 'toDepot' ? 'drive' : back);
    await say("Let's go!", { queue: true });
    if (timeUp()) { bedtime(); return; }
    if (J.current) resumeJob(true); else J.start();
  });

  // ---------- the horn: people nearby jump and wave ----------
  let lastHorn = 0;
  function onHorn() {
    const now = performance.now();
    if (now - lastHorn < 300) return;
    lastHorn = now;
    const bp = BB.bus.pos || (BB.bus.front && BB.bus.front.position);
    for (const m of J.waiting.concat(J.walkers.map((w) => w.m))) {
      if (bp && Math.hypot(m.position.x - bp.x, m.position.z - bp.z) > 30) continue;
      m.userData.jump = 1; m.userData.jumpDelay = Math.random() * 0.25;
    }
  }
  BB.on('bus:horn', onHorn);
  // bus.js has no horn event yet: listen by wrapping BB.bus.horn (once; deduped with the event above)
  if (typeof BB.bus.horn === 'function' && !BB.bus.horn.__jobs) {
    const orig = BB.bus.horn;
    BB.bus.horn = function () { const r = orig.apply(this, arguments); onHorn(); return r; };
    BB.bus.horn.__jobs = true;
  }

  // ---------- per frame ----------
  J.update = function (dt) {
    for (let i = J.walkers.length - 1; i >= 0; i--) {
      const w = J.walkers[i];
      w.t += dt / w.dur;
      const t = Math.min(1, w.t), to = w.to;
      w.m.position.lerpVectors(w.from, to, t);
      w.m.position.y = w.from.y + (to.y - w.from.y) * t + Math.abs(Math.sin(t * w.dur * Math.PI * 2.6)) * 0.16;
      const dx = to.x - w.from.x, dz = to.z - w.from.z;
      if (dx * dx + dz * dz > 0.01) w.m.rotation.y = Math.atan2(dx, dz);
      if (w.shrink && t > 0.7) w.m.scale.setScalar(Math.max(0.01, 1 - (t - 0.7) / 0.3));
      if (w.t >= 1) { J.walkers.splice(i, 1); if (w.done) w.done(); }
    }
    // people waiting at the stop bob gently, now and then a happy little hop
    const now = performance.now() / 1000;
    J.waiting.forEach((m, i) => {
      if (J.walkers.some((w) => w.m === m)) return;
      const s = m.userData.seed || i;
      m.position.y = GROUND + Math.max(0, Math.sin(now * 2 + s)) * 0.05 + Math.max(0, Math.sin(now * 1.3 + s * 2) - 0.92) * 3;
    });
    // a horn toot: two happy jumps with a wiggle, facing the bus
    const bp = BB.bus.pos;
    for (const m of J.waiting.concat(J.walkers.map((w) => w.m))) {
      const u = m.userData;
      if (!(u.jump > 0)) continue;
      if (u.jumpDelay > 0) { u.jumpDelay -= dt; continue; }
      u.jump = Math.max(0, u.jump - dt / 1.1);
      const ph = (1 - u.jump) * 2;                         // 0..2: two hops
      m.position.y += Math.sin((ph % 1) * Math.PI) * 0.55;
      m.rotation.z = Math.sin(ph * Math.PI * 2) * 0.18 * u.jump;
      if (bp && !J.walkers.some((w) => w.m === m)) m.rotation.y = Math.atan2(bp.x - m.position.x, bp.z - m.position.z);
      if (u.jump === 0) m.rotation.z = 0;
    }
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt / tw.dur;
      const t = Math.min(1, tw.t);
      try { tw.fn(t, dt); } catch (e) { console.error(e); }
      if (tw.t >= 1) { tweens.splice(i, 1); tw.done(); }
    }
    // the glowing numbers above the seats pop in and the hint ones pulse
    for (const sp of marks) {
      if (!sp.visible) continue;
      const u = sp.userData;
      u.pop = Math.max(0, u.pop - dt * 4);
      const s = u.base * (1 + u.pop * 0.5) * (u.pulse ? 1 + Math.sin(now * 6) * 0.12 : 1);
      sp.scale.set(s, s, 1);
    }
  };

  J.init = function () { buildLooks(); };
})();
