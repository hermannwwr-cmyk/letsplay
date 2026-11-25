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
  const J = BB.jobs = { current: null, phase: 'idle', walkers: [], waiting: [], extras: [], question: null, teaching: false };

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
  // a vehicle job (taxi, fire engine, ambulance, ice cream van, tow truck): questions on the card only
  const vmode = () => !!(J.current && J.current.vehicle);
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
      if (tries < 40 && (J.recent || []).includes(qKey(c))) continue;   // not a sum from the last 5 questions, if we can help it
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

  // An adding question with k from kMin up to kMaxWanted (a group getting on), inside this level's limits.
  function makeAddQuestion(n0, kMin, kMaxWanted) {
    const L = LEVELS[level()];
    let n = n0;
    const hiN = Math.max(1, Math.min(7, L.tot - kMin));
    if (n < 1 || n > hiN) n = BB.randInt(1, Math.max(1, Math.min(3, hiN)));
    const kHi = Math.max(1, Math.min(kMaxWanted, L.tot - n, 10 - n));
    const k = BB.randInt(Math.min(kMin, kHi), kHi);
    const q = { kind: 'add', n, k, answer: n + k, pre: n - n0, tries: 0 };
    q.choices = makeChoices(q);
    return q;
  }

  // ---------- special jobs: school run, airport rush, party bus (at most about 1 job in 3) ----------
  // A themed group gets on at the first stop (that is the question: "3 children get on") and gets off at the second.
  const THEMES = {
    school: { word: ['child', 'children'], prop: 'bag', kid: true, start: 'School run! Good morning!', drop: 'School time! Bye bye, children!' },
    airport: { word: ['traveller', 'travellers'], prop: 'case', start: 'Airport rush! The planes have landed!', drop: 'Welcome to the city! Have a lovely trip!' },
    party: { word: ['party friend', 'party friends'], prop: 'balloon', start: 'Party bus! A birthday group is waiting!', drop: 'Happy birthday! Bye bye!' },
  };
  const stopLike = (re) => (BB.world.stops || []).find((s) => s && !s.minor && re.test((s.id || '') + ' ' + (s.name || '') + ' ' + (s.pic || '')));
  function morning() {
    const W = BB.world, d = W && W.day;
    if (W && typeof W.night === 'function' && +W.night() > 0.3) return false;
    return !!(d && typeof d.t === 'number' && d.t >= 0.03 && d.t <= 0.3);
  }
  function pickTheme() {
    if (level() < 1 || (BB.save.jobsDone | 0) < 3) return null;     // the first jobs stay close to home
    if ((J.sinceSpecial == null ? 2 : J.sinceSpecial) < 2 || Math.random() > 0.5) return null;
    // only when the themed stop is near enough by road (about 400 units), so no long trip across the map
    const here = BB.bus.atStop || J.lastStop;
    const near = (id) => { const st = themeStop(id); if (!st) return id === 'school'; return st !== here && stopDist(here && okStop(here) ? here : null, st) <= 400; };
    const ok = [];
    if (morning() && near('school')) ok.push('school');
    if (stopLike(/airport/i) && near('airport')) ok.push('airport');
    if (stopLike(/beach|park/i) && near('party')) ok.push('party');
    return ok.length ? BB.pick(ok) : null;
  }
  function themeStop(id) {
    if (id === 'school') return stopLike(/school/i);
    if (id === 'airport') return stopLike(/airport/i);
    if (id === 'party') return stopLike(/beach/i) || stopLike(/park/i);
    return null;
  }
  // a short original "good morning" jingle (C major, up and down)
  function jingle() {
    if (typeof BB.tone !== 'function') return;
    const f = (semi) => 440 * Math.pow(2, (semi - 9) / 12);
    [12, 16, 19, 24, 19, 24].forEach((n, i) => { try { BB.tone(f(n), i === 5 ? 0.4 : 0.16, { type: 'triangle', vol: 0.08, at: i * 0.15 }); } catch (e) { /* no sound */ } });
  }

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
  // style: { kid, prop: 'bag'|'case'|'balloon'|'umbrella'|'cat'|'kite'|'durian'|'paper', geo (a friend's own look) }
  const KID_LOOKS = [2, 5];
  function person(i, style) {
    style = style || {};
    const geo = style.geo || LOOKS[(style.kid ? KID_LOOKS[i % 2] : i) % LOOKS.length];
    const m = new THREE.Mesh(geo, BB.mk.mat); m.name = 'person'; BB.scene.add(m);
    if (style.prop && PROPS[style.prop]) {
      const pm = new THREE.Mesh(PROPS[style.prop], BB.mk.mat); pm.name = 'prop';
      if (style.kid) pm.scale.setScalar(0.72);
      m.add(pm); m.userData.prop = pm; m.userData.propKind = style.prop;
    }
    if (style.friend) m.userData.friend = style.friend;
    return m;
  }

  // ---------- props and the passenger friends ----------
  // Props are tiny merged meshes in the people's paper-cut colours (y is the bottom of a box/cylinder, a ball's centre).
  const PROPS = {};
  function buildProps() {
    const mk = (fn) => { const b = BB.mk.builder(); fn(b); return b.geometry(); };
    PROPS.bag = mk((b) => { b.box(0.46, 0.52, 0.2, P.coral, 0, 0.74, -0.32); b.box(0.36, 0.12, 0.04, P.honeyLight, 0, 0.92, -0.43); });
    PROPS.case = mk((b) => { b.box(0.44, 0.6, 0.26, P.berry, 0.66, 0.04, 0); b.box(0.44, 0.07, 0.27, P.honeyLight, 0.66, 0.32, 0); b.box(0.07, 0.24, 0.07, '#3a2a3c', 0.66, 0.64, 0); });
    PROPS.balloon = mk((b) => { b.cyl(0.015, 0.015, 1.3, 4, '#fff6e0', 0.4, 1.0, 0); b.ball(0.32, P.rose, 0.4, 2.62, 0, 1, 0.92, 1.12, 0.92); b.ball(0.06, '#ff6f91', 0.4, 2.26, 0); });
    PROPS.umbrella = mk((b) => { b.cyl(0.03, 0.03, 1.5, 4, '#3a2a3c', 0.32, 1.1, 0); b.cyl(0.06, 0.9, 0.38, 8, P.teal, 0.32, 2.5, 0); b.cyl(0.2, 0.06, 0.12, 8, '#127a71', 0.32, 2.88, 0); });
    PROPS.cat = mk((b) => {
      b.box(0.5, 0.32, 0.36, P.woodLight, 0.52, 0.58, 0.12); b.box(0.52, 0.06, 0.38, P.wood, 0.52, 0.9, 0.12);
      b.ball(0.15, '#f28b4b', 0.52, 1.05, 0.12); b.box(0.06, 0.1, 0.04, '#f28b4b', 0.45, 1.13, 0.12); b.box(0.06, 0.1, 0.04, '#f28b4b', 0.59, 1.13, 0.12);
    });
    PROPS.kite = mk((b) => { b.box(0.62, 0.62, 0.04, P.coral, 0.75, 2.55, -0.3, 0, 0, Math.PI / 4); b.box(0.04, 0.62, 0.05, P.honeyLight, 0.75, 2.55, -0.3, 0, 0, Math.PI / 4); b.cyl(0.012, 0.012, 1.5, 4, '#fff6e0', 0.48, 1.0, -0.15); });
    PROPS.durian = mk((b) => { b.ball(0.2, '#8bbf3a', 0.44, 0.98, 0.22, 0); b.ball(0.17, '#6fa52e', 0.46, 1.01, 0.25, 0, 1.15, 1.15, 1.15); b.box(0.04, 0.1, 0.04, '#9b6238', 0.44, 1.15, 0.22); });
    PROPS.paper = mk((b) => { b.box(0.52, 0.38, 0.03, '#f4f1ea', 0, 1.12, 0.34); b.box(0.42, 0.05, 0.035, '#8a8290', 0, 1.38, 0.34); b.box(0.3, 0.05, 0.035, '#8a8290', -0.04, 1.26, 0.34); });
  }
  // Recurring passenger friends (generic, the game's own people style). Met once -> BB.save.friendsMet, 'friend:met'.
  const FRIENDS = [
    { id: 'granny', name: 'Granny Mei', prop: 'cat', look: { shirt: P.plum, skin: '#f1c7a0', hair: '#e8e4dc', bun: true } },
    { id: 'kai', name: 'Kai', prop: 'kite', look: { shirt: '#f28b4b', skin: '#d9a679', hair: '#1f1b22', kid: true } },
    { id: 'rose', name: 'Auntie Rose', prop: 'durian', look: { shirt: P.leaf, skin: '#a8714a', hair: '#3a2a2c', bun: true } },
    { id: 'tan', name: 'Uncle Tan', prop: 'paper', look: { shirt: '#9fb6c8', skin: '#f5d3b5', hair: '#8a8290' } },
  ];
  J.FRIENDS = FRIENDS.map((f) => ({ id: f.id, name: f.name, prop: f.prop }));
  function friendGeo(L) {
    const b = BB.mk.builder(), s = L.kid ? 0.72 : 1, pants = '#4a5a78';
    b.box(0.22 * s, 0.8 * s, 0.24 * s, pants, -0.13 * s, 0, 0); b.box(0.22 * s, 0.8 * s, 0.24 * s, pants, 0.13 * s, 0, 0);
    b.cyl(0.26 * s, 0.32 * s, 0.85 * s, 6, L.shirt, 0, 0.78 * s, 0);
    b.ball(0.27 * s, L.skin, 0, 1.9 * s, 0);
    b.ball(0.28 * s, L.hair, 0, 2.0 * s, -0.05 * s, 0, 1, 0.7, 1);
    if (L.bun) b.ball(0.13 * s, L.hair, 0, 2.18 * s, -0.24 * s);
    b.box(0.12 * s, 0.6 * s, 0.14 * s, L.shirt, -0.36 * s, 0.95 * s, 0); b.box(0.12 * s, 0.6 * s, 0.14 * s, L.shirt, 0.36 * s, 0.95 * s, 0);
    return b.geometry();
  }
  function friendsMet() {
    let a = Array.isArray(BB.save.friendsMet) ? BB.save.friendsMet : null;
    if (!a) { const b = BB.store.get('friendsMet', []); a = Array.isArray(b) ? b.slice() : []; BB.save.friendsMet = a; }
    return a;
  }
  function meetFriend(id) {
    const f = FRIENDS.find((x) => x.id === id); if (!f) return false;
    const met = friendsMet();
    if (met.includes(id)) return false;
    met.push(id); BB.save.friendsMet = met; BB.saveNow();
    BB.store.set('friendsMet', met);                     // kept here too, in case the save drops unknown keys
    BB.emit('friend:met', { id: f.id, name: f.name });
    return true;
  }
  J.friendsMet = () => friendsMet().slice();
  function friendStyle(f) { if (!f.geo) f.geo = friendGeo(f.look); return { geo: f.geo, prop: f.prop, kid: !!f.look.kid, friend: f.id }; }
  const removePerson = (m) => { BB.scene.remove(m); };
  function clearWaiting() { for (const m of J.waiting) removePerson(m); J.waiting = []; }
  const GROUND = 0.25;
  // Points next to the bus, in the front carriage's frame (+x is the door side, the kerb).
  // Points around the door, from BB.bus.doorWorld() and seatWorld() only, so every bus type works (bendy,
  // double-decker, single-decker): 'out' is the direction from the bus's middle through the door, onto the pavement.
  const _v = new THREE.Vector3();
  // exit: the rear door for getting off (B.exitDoorWorld() when the bus has one), else the front door.
  function doorFrame(exit) {
    const B = BB.bus, d = exit && typeof B.exitDoorWorld === 'function' ? B.exitDoorWorld(new THREE.Vector3()) : B.doorWorld(new THREE.Vector3());
    const h = B.heading || 0, fx = Math.sin(h), fz = Math.cos(h);
    const c = B.pos || d;                                    // a point on the bus's middle line
    const along = (d.x - c.x) * fx + (d.z - c.z) * fz;
    let ox = d.x - (c.x + fx * along), oz = d.z - (c.z + fz * along);
    const ol = Math.hypot(ox, oz);
    if (ol < 0.2) { ox = fz; oz = -fx; } else { ox /= ol; oz /= ol; }   // fallback: left of travel (the kerb side)
    return { d, ox, oz, fx, fz };
  }
  const doorOut = (exit) => { const f = doorFrame(exit); return new THREE.Vector3(f.d.x + f.ox * 0.5, GROUND, f.d.z + f.oz * 0.5); };
  const doorIn = (exit) => { const f = doorFrame(exit); return new THREE.Vector3(f.d.x - f.ox * 1.1, 0.55, f.d.z - f.oz * 1.1); };
  // a spot on the pavement beside the bus (between the bus and the stop camera): 'out' units from the door,
  // 'along' units along the bus
  const kerbSpot = (out, along, exit) => { const f = doorFrame(exit); return new THREE.Vector3(f.d.x + f.ox * out + f.fx * along, GROUND, f.d.z + f.oz * out + f.fz * along); };

  // Put the people for the next question at the stop's shelter, in a little queue facing the road.
  function setWaiting(stop, q) {
    clearWaiting();
    if (!stop || !q) return;
    const pre = Math.max(0, q.pre), total = pre + (q.kind === 'add' ? q.k : 0);
    const friendAt = q.friend && q.kind === 'add' ? total - 1 : -1;
    for (let i = 0; i < total; i++) {
      let style = i < pre ? q.preStyle : q.style;
      if (i === friendAt) { const f = FRIENDS.find((x) => x.id === q.friend); if (f) style = friendStyle(f); }
      if (q.bonus) style = Object.assign({}, style || {}, { prop: style && style.prop ? style.prop : 'umbrella' });
      const m = person(BB.randInt(0, 7), style);
      if (q.bonus) m.userData.waveDown = true;
      // one clear line along the pavement just past the shelter, nearest first, so every person can be counted
      const along = 3.4 + i * 0.95, off = -1.0;     // negative = toward the road, in front of the shelter
      m.position.set(stop.pos.x + stop.fwd.x * along + stop.side.x * off, GROUND, stop.pos.z + stop.fwd.z * along + stop.side.z * off);
      m.rotation.y = Math.atan2(-stop.side.x, -stop.side.z);
      m.userData.pre = i < pre;
      m.userData.seed = Math.random() * 6;
      J.waiting.push(m);
    }
  }
  // Walk a person to a point at a gentle pace. Resolves on arrival.
  function walkTo(m, to, speed = 3.3, opts = {}) {
    return new Promise((resolve) => {
      const from = m.position.clone(), dist = Math.hypot(to.x - from.x, to.z - from.z);
      J.walkers.push({ m, from, to: to.clone(), t: 0, dur: Math.max(0.35, dist / speed), done: resolve, shrink: !!opts.shrink });
    });
  }
  // One person gets on: walk to the door, step in, and appear in the next seat (the bus draws seated heads by count).
  async function boardOne(m, onSeat) {
    await walkTo(m, doorOut());
    await walkTo(m, doorIn(), 2.8);
    removePerson(m);
    BB.bus.passengers = BB.clamp((BB.bus.passengers | 0) + 1, 0, 10);
    BB.sfx.pop();
    if (onSeat) onSeat(BB.bus.passengers - 1);
  }
  // People get on one after another (a little overlap, so a queue of 4 doesn't take ages).
  function boardPeople(list, onSeat) {
    return Promise.all(list.map((m, i) => wait(i * 380).then(() => boardOne(m, onSeat))));
  }
  // One person gets off: the last seated leaves first (seat n-1), steps out of the door and walks away along the
  // pavement, waving goodbye with a little hop.
  async function alightOne(onLeave, stay, style) {
    const seat = (BB.bus.passengers | 0) - 1;
    if (seat < 0) return;
    BB.bus.passengers = seat;
    if (onLeave) onLeave(seat);
    const m = person(BB.randInt(0, 7), style);
    m.position.copy(doorIn(true));
    BB.sfx.pop();
    await walkTo(m, doorOut(true), 2.8);
    // stand on the pavement where the stop camera sees them (not over the seats or the card), wave, then walk off
    const k = J.extras.length, spot = waveSpot(k);
    m.userData.spot = spot;
    J.extras.push(m);
    walkTo(m, spot, 3).then(async () => {
      m.userData.jump = 1; m.userData.jumpDelay = 0;
      if (m.userData.propKind === 'balloon') popBalloon(m, style && style.onPop);
      await wait(1300);
      if (stay && !m.userData.released) return;          // stays in view until the question is answered
      walkAway(m);
    });
  }
  // A spot on the pavement for the k-th person who got off: in view of the stop camera, clear of the seats (so the
  // count on the bus stays readable) and of the question card, nearest the exit door first. Works for every bus
  // type and screen size because it is worked out on screen; falls back to a spot next to the exit door.
  function waveSpot(k) { return freeSpot(J.extras.map((m) => m.userData.spot).filter(Boolean), false, kerbSpot(1.7 + (k % 2) * 0.5, -0.8 - k * 0.9, true)); }
  // A free pavement spot in view (not over the seats, not under the card, not on another person), nearest the front
  // door (front) or the exit door. With no card yet, the card's usual place is kept clear.
  function freeSpot(taken, front, fallback) {
    try {
      const W = innerWidth, H = innerHeight, cam = BB.camera;
      const proj = (p) => { const q = p.clone().project(cam); return q.z > 1 ? null : [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H]; };
      // the seats' box on screen (with a margin)
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < 10; i++) {
        const a = BB.bus.seatWorld(i, new THREE.Vector3());
        for (const dy of [0, 1.5]) { const s2 = proj(new THREE.Vector3(a.x, a.y + dy, a.z)); if (s2) { x0 = Math.min(x0, s2[0]); x1 = Math.max(x1, s2[0]); y0 = Math.min(y0, s2[1]); y1 = Math.max(y1, s2[1]); } }
      }
      const seatBox = [x0 - 30, y0 - 40, x1 + 30, y1 + 20];
      const c = document.querySelector('.bbq');
      const cr = c ? c.getBoundingClientRect() : H <= 520 ? { left: 0, top: 0, right: 345, bottom: H } : { left: W / 2 - 440, top: H - 280, right: W / 2 + 440, bottom: H };
      const hit = (r, b) => b && r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1];
      const exit = doorFrame(true), frontD = doorFrame(false);
      const span = front ? 0 : (exit.d.x - frontD.d.x) * frontD.fx + (exit.d.z - frontD.d.z) * frontD.fz;   // the door, along the bus
      const cands = [];
      for (const out of [2.4, 3.4, 1.6]) {
        for (let along = span + 4; along >= span - 14; along -= 0.9) {
          const p = kerbSpot(out, along, false);
          const foot = proj(p), head = proj(new THREE.Vector3(p.x, p.y + 2.3, p.z));
          if (!foot || !head) continue;
          const r = [Math.min(foot[0], head[0]) - 18, head[1] - 50, Math.max(foot[0], head[0]) + 18, foot[1]];
          if (r[0] < 10 || r[2] > W - 10 || r[1] < 60 || r[3] > H - 4) continue;
          if (hit(r, seatBox) || (cr && hit(r, [cr.left, cr.top, cr.right, cr.bottom]))) continue;
          if (taken.some((t) => t.distanceTo(p) < 0.85)) continue;
          cands.push({ p, d: Math.abs(along - span) + (out - 2.4) * (out - 2.4) });
        }
      }
      if (!cands.length) return fallback;
      cands.sort((a, b) => a.d - b.d);
      return cands[0].p;
    } catch (e) { return fallback; }
  }
  // At arrival the queue steps up to spots the stop camera sees, nearest the front door, and faces the bus.
  function queueIntoView() {
    const taken = [];
    J.waiting.forEach((m, i) => {
      const p = freeSpot(taken, true, kerbSpot(1.6 + (i % 2) * 0.5, 1.2 + i * 0.9, false));
      taken.push(p); m.userData.spot = p;
      walkTo(m, p, 3.8).then(() => { const d = doorOut(); m.rotation.y = Math.atan2(d.x - m.position.x, d.z - m.position.z); });
    });
  }
  // a party friend's balloon floats up out of their hand and pops in a little burst (onPop once per group)
  function popBalloon(m, onPop) {
    const b = m.userData.prop; if (!b) return;
    m.userData.prop = null; m.userData.propKind = null;
    const y0 = b.position.y;
    tween(1.1, (t) => { b.position.y = y0 + t * t * 2.6; b.rotation.z = Math.sin(t * 9) * 0.2; }).then(() => {
      m.remove(b); BB.sfx.pop();
      if (onPop) onPop();
    });
  }
  function walkAway(m) {
    if (m.userData.gone) return;
    m.userData.gone = true;
    J.extras = J.extras.filter((x) => x !== m);
    const away = kerbSpot(1.8 + Math.random() * 0.6, -9 - Math.random() * 4, true);   // along the pavement
    walkTo(m, away, 3.2, { shrink: true }).then(() => removePerson(m));
  }
  // the people who got off for the question walk away (after the answer, or when the stop ends)
  function releaseExtras() { for (const m of J.extras.slice()) { m.userData.released = true; walkAway(m); } scene.unwave(); }
  // several people get off one after another, overlapping (a new one every 0.45 s), so 4 take about 3 s
  async function alightPeople(count, onLeave, stay, style) {
    const all = [];
    for (let i = 0; i < count; i++) { all.push(alightOne(onLeave, stay, style)); if (i < count - 1) await wait(450); }
    await Promise.all(all);
  }
  // Everybody gets off and walks away (e.g. for a goodnight moment). cb when the bus is empty.
  J.allOff = async function (cb) {
    try {
      if ((BB.bus.passengers | 0) > 0) { BB.bus.openDoors(); await wait(600); await alightPeople(BB.bus.passengers | 0); }
    } finally { if (cb) cb(); }
  };

  // ---------- the double-decker's upper deck: a few riders (decoration, never counted) ----------
  // The question is only about the ten seats downstairs; upstairs a few people sit by the upper windows so the
  // double-decker doesn't look empty. They ride with the bus (children of its front carriage) and are rebuilt when the
  // bus type changes.
  const UPPER_FLOOR = 3.2;                 // fleet.js: the upper deck's floor height (deck2) above the road
  let upstairs = [];
  function buildUpstairs() {
    for (const m of upstairs) if (m.parent) m.parent.remove(m);
    upstairs = [];
    const B = BB.bus;
    if (B.type !== 'double' || !B.front || !B.seats || !LOOKS.length) return;
    const zs = B.seats.slice(0, 5).map((p) => p.z), picks = BB.shuffle([0, 1, 2, 3, 4]).slice(0, 3);
    picks.forEach((zi, n) => {
      const m = new THREE.Mesh(LOOKS[(n * 3 + 1) % LOOKS.length], BB.mk.mat);
      m.name = 'upstairs';
      m.scale.setScalar(0.72);
      const side = n % 2 ? -0.62 : 0.62;
      m.position.set(side, UPPER_FLOOR - 0.5, zs[zi] + 0.2);   // seated: legs below the floor line, head in the window
      m.rotation.y = 0;                                        // facing forward like everyone on a bus
      B.front.add(m);
      upstairs.push(m);
    });
  }
  BB.on('bus:type', () => { try { buildUpstairs(); } catch (e) { console.error(e); } });
  // hidden while the bus is at a stop (and during a question), so nobody counts them by mistake
  BB.on('jobs:busy', (d) => { for (const m of upstairs) m.visible = !(d && d.on); });

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
  // The sprites live in the scene and follow BB.bus.seatWorld(i) every frame (any bus type, any seat layout).
  function ensureMarks() {
    if (marks.length) return true;
    if (!BB.scene || typeof BB.bus.seatWorld !== 'function') return false;
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFor(''), transparent: true, depthTest: false, depthWrite: false, fog: false }));
      sp.renderOrder = 20; sp.visible = false; sp.userData = { base: 0.72, pulse: false, pop: 0 };
      BB.scene.add(sp); marks.push(sp);
    }
    return true;
  }
  // A bigger number over the bus's middle while "3 friends are on the bus" is said (only the starting number).
  let countTag = null;
  function showCount(n) {
    if (!BB.scene || typeof BB.bus.seatWorld !== 'function') return;
    if (!countTag) {
      countTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFor(''), transparent: true, depthTest: false, depthWrite: false, fog: false }));
      countTag.renderOrder = 21; countTag.userData = { base: 1.5, pulse: false, pop: 0 }; BB.scene.add(countTag);
    }
    countTag.material.map = texFor(String(n)); countTag.material.needsUpdate = true;
    countTag.visible = n > 0; countTag.userData.pop = 1;
    placeCount();
  }
  function placeCount() {
    if (!countTag) return;
    try {
      const a = BB.bus.seatWorld(0, new THREE.Vector3()), b = BB.bus.seatWorld(9, new THREE.Vector3());
      countTag.position.set((a.x + b.x) / 2, Math.max(a.y, b.y) + 3.2, (a.z + b.z) / 2);
    } catch (e) { countTag.visible = false; }
  }
  function hideCount() { if (countTag) countTag.visible = false; }
  function placeMark(i) {
    try { BB.bus.seatWorld(i, _v); marks[i].position.set(_v.x, _v.y + 1.9, _v.z); } catch (e) { marks[i].visible = false; }
  }
  // Only the seat being counted shows its number above the bus (several would pile up at the stop camera angle).
  function mark(i, label, pulse) {
    return;                                    // replaced by the seat bubbles (scene.bubble); kept for reference
    // eslint-disable-next-line no-unreachable
    if (!ensureMarks() || i < 0 || i > 9) return;
    clearMarks();
    const sp = marks[i];
    sp.material.map = texFor(label == null ? '' : String(label)); sp.material.needsUpdate = true;
    sp.visible = true; sp.userData.pulse = !!pulse; sp.userData.pop = 1;
    placeMark(i);
  }
  function unmark(i) { if (marks[i]) marks[i].visible = false; }
  function clearMarks() { for (const sp of marks) sp.visible = false; }

  // ---------- teaching on the real bus: a DOM layer anchored to the seats ----------
  // Each seat (BB.bus.seatWorld(i), any bus type) gets, when asked: a soft glow halo round the passenger's head, a big
  // number bubble above it (only the current and the previous count stay, so nothing piles up), and, while a question
  // is up, an invisible tap target so the child can count the real passengers. Mina flies from head to head. People
  // who got off get a little wave bubble on the pavement. Positions are projected from the 3D scene every frame.
  BB.css(`
  .bbs { position: absolute; inset: 0; pointer-events: none; overflow: hidden; --hs: 58px; --bub: 64px; --bf: 44px; }
  .bbs-at { position: absolute; left: 0; top: 0; will-change: transform; }
  .bbs-halo { position: absolute; width: var(--hs); height: var(--hs); left: calc(var(--hs) / -2); top: calc(var(--hs) / -2); border-radius: 50%;
    box-sizing: border-box; border: 4px solid #ffd45c; background: none;              /* a ring only: the face stays visible */
    box-shadow: 0 0 10px 3px rgba(255,190,40,.85), inset 0 0 8px 1px rgba(255,214,92,.6);
    animation: bbs-in .25s cubic-bezier(.2,1.6,.5,1); }
  .bbs.night .bbs-halo { background: radial-gradient(circle, rgba(255,236,190,.26) 0 40%, rgba(255,236,190,0) 68%); mix-blend-mode: screen; }   /* lifts the face a little, never covers it */
  .bbs-bub { position: absolute; min-width: var(--bub); height: var(--bub); left: calc(var(--bub) / -2); top: calc(var(--hs) / -2 - var(--bub) - 6px);
    box-sizing: border-box; padding: 0 8px; border-radius: calc(var(--bub) / 2); background: #fff6e0; border: 4px solid #ffb81f; color: #d98700;
    font: 700 var(--bf)/1 'Fredoka', 'Baloo 2', system-ui, sans-serif; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 5px 0 rgba(120,80,40,.2); animation: bbs-in .35s cubic-bezier(.2,1.6,.5,1); transform-origin: 50% 120%; transition: opacity .3s, transform .3s; }
  .bbs-bub::after { content: ''; position: absolute; left: 50%; bottom: -12px; margin-left: -8px; border: 8px solid transparent; border-top-color: #ffb81f; border-bottom: 0; }
  .bbs-bub.big { background: #19a79b; border-color: #127a71; color: #fff; } .bbs-bub.big::after { border-top-color: #127a71; }
  .bbs-bub.q { background: #fff; color: #d98700; animation: bbs-in .35s cubic-bezier(.2,1.6,.5,1), bbq-ask 1.1s .35s ease-in-out infinite alternate; }
  .bbs-bub.old { opacity: .5; transform: scale(.72); }
  .bbs-bub.wave { border-color: #ff6b5c; font-size: calc(var(--bf) * .75); } .bbs-bub.wave::after { border-top-color: #ff6b5c; }
  @keyframes bbs-in { from { transform: scale(.2); opacity: 0; } }
  .bbs-hit { position: absolute; width: var(--hs); height: var(--hs); left: calc(var(--hs) / -2); top: calc(var(--hs) / -2); border-radius: 50%; pointer-events: auto; cursor: pointer; }
  .bbs-bird { position: absolute; width: 74px; height: 74px; left: calc(var(--hs) / 2 - 4px); top: calc(var(--hs) / -2 - 62px); transition: opacity .3s; transform: scaleX(-1); }   /* beside the bubble, beak toward it */
  .bbs-bird svg { width: 100%; height: 100%; display: block; transform-origin: 50% 90%; }
  .bbs-bird.hop svg { animation: bbq-hop .42s ease-out; }
  @media (max-height: 520px) { .bbs { --hs: 40px; --bub: 46px; --bf: 32px; } .bbs-bird { width: 54px; height: 54px; top: calc(var(--hs) / -2 - 46px); } }
  `);
  const scene = (function () {
    let layer = null, bird = null, birdAt = null, birdPos = null;
    const halos = new Map(), bubbles = [], waves = [], hits = new Map();
    const v = new THREE.Vector3();
    function root() {
      if (!layer || !layer.isConnected) {
        const ui = (BB.ui && BB.ui.root) || document.getElementById('ui');
        layer = document.createElement('div'); layer.className = 'bbs';
        ui.insertBefore(layer, ui.firstChild);         // under the HUD and the card
      }
      return layer;
    }
    function headOf(i) { BB.bus.seatWorld(i, v); v.y += 1.0; return v; }
    function toScreen(p) {
      const q = p.clone().project(BB.camera);
      if (q.z > 1) return null;
      return [(q.x + 1) / 2 * innerWidth, (1 - q.y) / 2 * innerHeight];
    }
    function at(el, p) { const s = p && toScreen(p); if (!s) { el.style.display = 'none'; return; } el.style.display = ''; el.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px)`; }
    function holder(cls, inner) { const a = BB.el('div', 'bbs-at', root()); const e = BB.el('div', cls, a, inner); return { a, e }; }
    return {
      halo(i, on) {
        if (vmode()) return;
        if (typeof BB.bus.seatWorld !== 'function') return;
        if (on && !halos.has(i)) halos.set(i, holder('bbs-halo'));
        else if (!on && halos.has(i)) { halos.get(i).a.remove(); halos.delete(i); }
      },
      bubble(i, label, cls) {
        if (vmode()) return;
        if (typeof BB.bus.seatWorld !== 'function') return;
        for (let j = bubbles.length - 1; j >= 0; j--) if (bubbles[j].i === i) { bubbles[j].a.remove(); bubbles.splice(j, 1); }
        bubbles.forEach((b) => b.e.classList.add('old'));
        while (bubbles.length > 1) bubbles.shift().a.remove();   // only the previous count stays (faded)
        const h = holder('bbs-bub' + (cls ? ' ' + cls : ''), String(label)); h.i = i;
        bubbles.push(h);
      },
      wave(meshes) {
        this.unwave();
        for (const m of meshes) { const h = holder('bbs-bub wave', '\u{1F44B}'); h.m = m; waves.push(h); }
      },
      unwave() { while (waves.length) waves.pop().a.remove(); },
      clear() { for (const h of halos.values()) h.a.remove(); halos.clear(); while (bubbles.length) bubbles.pop().a.remove(); },
      bird(i) {
        if (i == null) { if (bird) bird.a.style.opacity = '0'; birdAt = null; return; }
        if (!bird) { bird = holder('bbs-bird', BIRD); }
        bird.a.style.opacity = '1';
        if (birdAt !== i) { bird.e.classList.remove('hop'); void bird.e.offsetWidth; bird.e.classList.add('hop'); }
        birdAt = i;
      },
      // tap targets over the seated passengers while a question is up
      setHits(n, onTap) {
        for (const [i, h] of hits) if (i >= n) { h.a.remove(); hits.delete(i); }
        for (let i = 0; i < n; i++) if (!hits.has(i)) {
          const h = holder('bbs-hit'); hits.set(i, h);
          h.e.addEventListener('pointerup', (e) => { e.stopPropagation(); if (BB.audio && BB.audio.unlock) BB.audio.unlock(); onTap(i); });
        }
      },
      reset() { this.clear(); this.unwave(); this.bird(null); this.setHits(0); },
      update(dt) {
        if (!layer || typeof BB.bus.seatWorld !== 'function') return;
        // rings and bubbles follow the on-screen distance between neighbouring heads, so close heads never blob
        const a = toScreen(headOf(1).clone()), b = toScreen(headOf(2).clone());
        if (a && b) {
          const gap = Math.hypot(a[0] - b[0], a[1] - b[1]), phone = innerHeight <= 520;
          const hs = Math.round(BB.clamp(gap * 0.92, 22, phone ? 40 : 58));
          const bub = Math.round(BB.clamp(hs * 1.15, phone ? 38 : 46, phone ? 46 : 64));
          if (hs !== this._hs) {
            this._hs = hs;
            layer.style.setProperty('--hs', hs + 'px'); layer.style.setProperty('--bub', bub + 'px');
            layer.style.setProperty('--bf', Math.round(bub * 0.68) + 'px');
          }
        }
        const night = !!(BB.world && typeof BB.world.night === 'function' && +BB.world.night() > 0.5);   // lights 0..1
        if (night !== this._night) { this._night = night; layer.classList.toggle('night', night); }
        for (const [i, h] of halos) at(h.a, headOf(i));
        for (const b of bubbles) at(b.a, headOf(b.i));
        for (const [i, h] of hits) at(h.a, headOf(i));
        for (const w of waves) { const p = w.m.position.clone(); p.y += 1.9; at(w.a, w.m.parent ? p : null); }
        if (bird && birdAt != null) {
          const t = headOf(birdAt).clone();
          birdPos = birdPos ? birdPos.lerp(t, Math.min(1, dt * 7)) : t;
          at(bird.a, birdPos);
        }
      },
    };
  })();

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
  .bbq-side { display: flex; flex-direction: column; gap: 10px; align-items: center; padding-bottom: 6px; }
  .bbq-row { display: flex; gap: 12px; align-items: center; }
  .bbq-ask { display: flex; gap: 12px; align-items: center; }
  /* the written number sentence: 2 + 1 = ?  (each number over its own little group of people, so it can be counted) */
  .bbq-sum { display: flex; align-items: flex-start; gap: 6px; min-height: 76px; font: 700 46px/1 'Fredoka', 'Baloo 2', system-ui, sans-serif; }
  .bbq-term { display: flex; flex-direction: column; align-items: center; gap: 5px; opacity: 0; transform: scale(.4);
    transition: opacity .3s, transform .35s cubic-bezier(.2,1.6,.5,1); }
  .bbq-term.show { opacity: 1; transform: none; }
  .bbq-term b { display: block; min-width: .9em; height: 54px; line-height: 56px; padding: 0 9px; border-radius: 16px; text-align: center;
    box-sizing: border-box; transition: background .2s, transform .2s, box-shadow .2s; }
  .bbq-term.lit b { background: #ffd45c; transform: scale(1.15); box-shadow: 0 0 0 4px #ffb81f; }
  .bbq-term.op b { color: #a08a70; padding: 0 2px; }
  .bbq-term.n1 b { color: #2f8f3a; }
  .bbq-term.n2.add b { color: #19a79b; }
  .bbq-term.n2.sub b { color: #ff6b5c; border: 3px dashed #ff6b5c; line-height: 50px; }
  .bbq-term.ans b { min-width: 62px; border: 4px solid #ffb81f; background: #fff; color: #d98700; line-height: 48px; animation: bbq-ask 1.1s ease-in-out infinite alternate; }
  @keyframes bbq-ask { to { box-shadow: 0 0 0 6px rgba(255,212,92,.6); transform: scale(1.06); } }
  .bbq-term.ans.filled b { animation: bbq-pop .5s; background: #ffd45c; color: #fff; text-shadow: 0 2px 0 #d98700; border-color: #ffb81f; }
  .bbq-term.ans { position: relative; }
  .bbq-spark { position: absolute; left: 50%; top: 27px; width: 14px; height: 14px; margin: -7px; pointer-events: none;
    background: #ffd45c; clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
    animation: bbq-spark .7s ease-out forwards; }
  @keyframes bbq-spark { from { transform: translate(0, 0) scale(.4); opacity: 1; } to { transform: translate(var(--dx), var(--dy)) scale(1.2) rotate(90deg); opacity: 0; } }
  /* little people: a round head over rounded shoulders, in the group's colour */
  .bbq-dots { display: grid; grid-template-columns: repeat(5, 26px); gap: 2px 3px; justify-content: start; --pc: #3fae49; }
  .bbq-dots i { width: 26px; height: 30px; background:
    radial-gradient(circle at 50% 27%, var(--pc) 0 26%, transparent 28%),
    radial-gradient(ellipse 50% 42% at 50% 100%, var(--pc) 0 98%, transparent 100%); }
  .bbq-term.n2.add .bbq-dots { --pc: #19a79b; }
  .bbq-sum.bags .bbq-dots i { background: none; }
  .bbq-sum.bags .bbq-dots i svg { width: 100%; height: 100%; display: block; }
  .bbq-term.n2.sub .bbq-dots { --pc: #ff6b5c; } .bbq-term.n2.sub .bbq-dots i { opacity: .45; }
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
    .bbq-side { gap: 6px; padding-bottom: 4px; }
    .bbq-row, .bbq-ask { gap: 8px; }
    .bbq-sum { font-size: 32px; min-height: 52px; gap: 4px; }
    .bbq-term { gap: 3px; }
    .bbq-term b { height: 38px; line-height: 40px; padding: 0 7px; border-radius: 12px; }
    .bbq-term.n2.sub b { line-height: 34px; }
    .bbq-term.ans b { min-width: 46px; line-height: 32px; border-width: 3px; }
    .bbq-spark { top: 19px; }
    .bbq-dots { grid-template-columns: repeat(5, 16px); gap: 1px 2px; }
    .bbq-dots i { width: 16px; height: 18px; }
    .bbq-btn { width: 64px; height: 64px; font-size: 38px; border-radius: 20px; }
    .bbq-say { width: 56px; height: 56px; }
    .bbj { font-size: 36px; padding: 8px 20px; top: 20%; } .bbj svg { width: 42px; height: 42px; } .bbj canvas { width: 40px; height: 40px; }
  }
  @media (max-height: 380px) {
    .bbq { --cell: 30px; --bird: 54px; gap: 5px; padding: 4px 10px 8px; }
    .bbq-frame { gap: 3px; padding: 5px; }
    .bbq-sum { min-height: 0; }
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
  // A suitcase picture for the ten-frame when the question counts suitcases.
  let iconMode = 'people';
  function suitcase(i) {
    const c = SHIRTS[(i * 3 + 1) % 10];
    return `<svg viewBox="0 0 40 40"><rect x="15" y="5" width="10" height="7" rx="3" fill="none" stroke="#3a2a3c" stroke-width="2.6"/>` +
      `<rect x="7" y="10" width="26" height="25" rx="5" fill="${c}"/><path d="M27 12 Q33 12 33 18 V30 Q33 35 28 35 H27Z" fill="#000" opacity=".13"/>` +
      `<rect x="7" y="19" width="26" height="4" fill="#ffd45c"/><circle cx="12" cy="37" r="2" fill="#3a2a3c"/><circle cx="28" cy="37" r="2" fill="#3a2a3c"/></svg>`;
  }
  // Pictures for the vehicle jobs' questions (the same flat paper-cut style as the faces).
  const ICONS = {
    window: () => '<svg viewBox="0 0 40 40"><rect x="6" y="6" width="28" height="28" rx="4" fill="#c84a3c"/><rect x="10" y="10" width="20" height="20" rx="2" fill="#9cc7dc"/>' +
      '<path d="M20 10 V30" stroke="#fbf1dc" stroke-width="2.5"/><circle cx="16" cy="15" r="6" fill="#8a8290" opacity=".85"/><circle cx="24" cy="12" r="5" fill="#a8a0ae" opacity=".85"/></svg>',
    fighter: (i) => `<svg viewBox="0 0 40 40"><path d="M8 40 Q8 26 20 26 Q32 26 32 40Z" fill="#3d5a80"/><rect x="12" y="31" width="16" height="3" fill="#ffd45c"/>` +
      `<circle cx="20" cy="18" r="8" fill="${SKINS[(i * 3) % 5]}"/><path d="M9 16 Q10 6 20 6 Q30 6 31 16 H34 V18 H6 V16Z" fill="#ef5a4b"/><rect x="17" y="8" width="6" height="5" rx="1" fill="#ffd45c"/>` +
      `<circle cx="17" cy="20" r="1.4" fill="#3a2a3c"/><circle cx="23" cy="20" r="1.4" fill="#3a2a3c"/><path d="M17.5 23.5 Q20 25.5 22.5 23.5" stroke="#c0614e" stroke-width="1.4" fill="none"/></svg>`,
    teddy: () => '<svg viewBox="0 0 40 40"><circle cx="11" cy="9" r="5" fill="#b5793e"/><circle cx="29" cy="9" r="5" fill="#b5793e"/><ellipse cx="20" cy="29" rx="11" ry="10" fill="#b5793e"/>' +
      '<circle cx="20" cy="16" r="10" fill="#c58a55"/><ellipse cx="20" cy="19" rx="4.5" ry="3.5" fill="#e2b07c"/><circle cx="20" cy="18" r="1.5" fill="#3a2a3c"/>' +
      '<circle cx="16" cy="14" r="1.3" fill="#3a2a3c"/><circle cx="24" cy="14" r="1.3" fill="#3a2a3c"/><path d="M28 30 Q33 30 33 26" stroke="#9b6238" stroke-width="3" fill="none"/><rect x="15" y="26" width="10" height="5" rx="2" fill="#ff8fab"/></svg>',
    icecream: (i) => `<svg viewBox="0 0 40 40"><path d="M12 20 L20 38 L28 20Z" fill="#e2b07c"/><path d="M14 23 L26 23 M16 28 L24 28" stroke="#c58a55" stroke-width="1.5"/>` +
      `<circle cx="20" cy="15" r="9" fill="${['#ff8fab', '#fff3d6', '#8b5a3c', '#8fe0c4'][i % 4]}"/><circle cx="16" cy="11" r="2" fill="#fff" opacity=".6"/><circle cx="21" cy="5" r="2.5" fill="#ef5a4b"/></svg>`,
    car: (i) => `<svg viewBox="0 0 40 40"><path d="M5 26 V21 Q5 18 8 18 L12 12 Q13 10 16 10 H25 Q28 10 29 12 L33 18 Q36 18 36 21 V26Z" fill="${['#4fa3e0', '#f5b83d', '#5cb85c', '#ef5a4b', '#8e62c8'][i % 5]}"/>` +
      `<path d="M14 18 L16.5 13 H20 V18Z M22 18 V13 H25 L28 18Z" fill="#cfe9f5"/><circle cx="12" cy="27" r="4.5" fill="#3a2a3c"/><circle cx="29" cy="27" r="4.5" fill="#3a2a3c"/><circle cx="12" cy="27" r="1.8" fill="#c8c0b8"/><circle cx="29" cy="27" r="1.8" fill="#c8c0b8"/></svg>`,
  };
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

  let card = null, pic = null, frame = null, bird = null, seatEls = [], btnEls = [], sumEl = null;

  // ---------- the written number sentence ----------
  // "2 + 1 = ?" / "8 − 2 = ?" (a real minus sign). Parts: n1 (on the bus), n2 (getting on: mint / getting off: dashed
  // coral), ask (the pulsing "?" box). Each number sits over its own little group of dots to count. Parts appear as the
  // story is told (showSum), light up when spoken or counted (litSum), and the "?" fills in after a right answer.
  const MINUS = '\u2212';
  function buildSum(q) {
    if (!sumEl) return;
    // little people under each number, or (suitcases, firefighters, teddies, ice creams, cars) tiny copies of the card's pictures
    const mode = q.icon || (q.what === 'bags' ? 'bags' : 'people');
    const pic = (i) => mode === 'bags' ? suitcase(i) : ICONS[mode] ? ICONS[mode](i) : '';
    const dots = (n, from = 0) => '<span class="bbq-dots">' + Array.from({ length: n }, (_, i) => `<i>${mode === 'people' ? '' : pic(from + i)}</i>`).join('') + '</span>';
    sumEl.innerHTML =
      `<span class="bbq-term n1" data-p="n1"><b>${q.n}</b>${dots(q.n)}</span>` +
      `<span class="bbq-term op" data-p="n2"><b>${q.kind === 'add' ? '+' : MINUS}</b></span>` +
      `<span class="bbq-term n2 ${q.kind}" data-p="n2"><b>${q.k}</b>${dots(q.k, q.n)}</span>` +
      `<span class="bbq-term op" data-p="ask"><b>=</b></span>` +
      `<span class="bbq-term ans" data-p="ask"><b>?</b></span>`;
  }
  function showSum(...parts) { if (sumEl) sumEl.querySelectorAll('.bbq-term').forEach((t) => { if (parts.includes(t.dataset.p)) t.classList.add('show'); }); }
  // light one part (n1, n2 or ask), or none
  function litSum(part) { if (sumEl) sumEl.querySelectorAll('.bbq-term').forEach((t) => t.classList.toggle('lit', !!part && t.dataset.p === part && !t.classList.contains('op'))); }
  function fillSum(answer) {
    if (!sumEl) return;
    const t = sumEl.querySelector('.bbq-term.ans'); if (!t) return;
    t.querySelector('b').textContent = String(answer);
    t.classList.remove('filled'); void t.offsetWidth; t.classList.add('filled', 'show');
    for (let i = 0; i < 8; i++) {
      const sp = BB.el('i', 'bbq-spark', t), a = i / 8 * Math.PI * 2;
      sp.style.setProperty('--dx', Math.round(Math.cos(a) * 48) + 'px'); sp.style.setProperty('--dy', Math.round(Math.sin(a) * 40) + 'px');
      BB.later(800, () => sp.remove());
    }
  }
  let seq = 0;                      // bumps whenever a talking sequence (story, teaching) should stop
  let tapped = [];                  // seats the child has tapped to count, in order

  // q.what 'bags' = the question counts suitcases (an airport job, every traveller has one); q.word = a themed group
  const nPhrase = (n, q) => q && q.text ? q.text.n : q && q.what === 'bags' ? `${n} ${plural(n, 'suitcase is', 'suitcases are')} on the bus.` : `${n} ${plural(n, 'friend is', 'friends are')} on the bus.`;
  const kPhrase = (q) => {
    if (q.text) return q.text.k;
    if (q.what === 'bags') return q.kind === 'add' ? `${q.k} more ${plural(q.k, 'suitcase comes', 'suitcases come')} on.` : `${q.k} ${plural(q.k, 'suitcase goes', 'suitcases go')} off.`;
    if (q.word && q.kind === 'add') return `${q.k} ${plural(q.k, q.word[0], q.word[1])} ${plural(q.k, 'gets', 'get')} on.`;
    return q.kind === 'add' ? `${q.k} more ${plural(q.k, 'gets', 'get')} on.` : `${q.k} ${plural(q.k, 'gets', 'get')} off.`;
  };
  const askPhrase = (q) => q.text ? q.text.ask : q.what === 'bags' ? (q.kind === 'add' ? 'How many suitcases are on the bus now?' : 'How many suitcases are left?')
    : q.kind === 'add' ? 'How many are on the bus now?' : 'How many are left on the bus?';
  J.sentence = (q) => `${nPhrase(q.n, q)} ${kPhrase(q)} ${askPhrase(q)}`;

  // Seat states on the card: '' empty, 'full', 'new' (just got on), 'gone' (just got off).
  function setSeat(i, state) {
    const el = seatEls[i]; if (!el) return;
    const had = el.dataset.state || '';
    el.dataset.state = state;
    el.classList.toggle('full', state === 'full' || state === 'new');
    el.classList.toggle('new', state === 'new');
    el.classList.toggle('gone', state === 'gone');
    if (!state) el.innerHTML = '';
    else if (!had) el.innerHTML = iconMode === 'people' ? face(i) : iconMode === 'bags' ? suitcase(i) : (ICONS[iconMode] ? ICONS[iconMode](i) : face(i));
  }
  const isFull = (i) => seatEls[i] && (seatEls[i].dataset.state === 'full' || seatEls[i].dataset.state === 'new');
  function badge(i, num, big) {
    const el = seatEls[i]; if (!el) return;
    let b = el.querySelector('.num');
    if (!b) b = BB.el('b', 'num', el);
    else { b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; }
    b.textContent = String(num); b.classList.toggle('big', !!big);
    scene.bubble(i, num, num === '?' ? 'q' : big ? 'big' : '');
  }
  function light(i, on) { if (seatEls[i]) seatEls[i].classList.toggle('lit', on); scene.halo(i, on); }
  function clearCounting() {
    scene.clear();
    tapped = [];
    seatEls.forEach((el) => { el.classList.remove('lit', 'bye'); const b = el.querySelector('.num'); if (b) b.remove(); });
    clearMarks();
  }

  // Mina hops to a seat (perching on its top-right corner) or back to her spot on the frame's top-right corner.
  // Mina never sits on a face: she flies along the top edge of the frame to the column of the seat being counted
  // and leans over it (the seat itself glows), or rests on the frame's top-right corner.
  // Mina points on the real bus (scene); on the card she stays at her spot on the frame.
  function birdTo(i, beside) {
    if (vmode()) scene.bird(null);              // vehicle jobs: Mina hops along the card's pictures
    else { scene.bird(i == null ? null : i); if (i != null) i = null; }
    if (!bird || !frame) return;
    const bw = bird.offsetWidth, bh = bird.offsetHeight;
    const el = i == null ? null : seatEls[i];
    const y = frame.offsetTop - bh * 0.86;                  // feet on the frame's top edge
    // seats' offsetParent is .bbq-pic; her beak (right side) points down at the seat
    const x = el ? el.offsetLeft + el.offsetWidth * 0.5 - bw * 0.72 : frame.offsetLeft + frame.offsetWidth - bw * 0.5;
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
    iconMode = q.icon || (q.what === 'bags' ? 'bags' : 'people');
    sumEl = BB.el('div', 'bbq-sum' + (iconMode !== 'people' ? ' bags' : ''), side);
    buildSum(q);
    const row = BB.el('div', 'bbq-row', side);
    const ask = BB.el('div', 'bbq-ask', row);
    const sayBtn = BB.el('button', 'bbq-say', row, SPEAKER);
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
    const cq = J.question;
    if (cq) litSum(cq.kind === 'add' && i >= cq.n ? 'n2' : 'n1');
    if (card && card.classList.contains('counting')) {
      birdTo(i);
      const all = seatEls.filter((el, j) => isFull(j)).length, q = J.question;
      if (tapped.length === all && q) { card.classList.remove('counting'); BB.later(700, () => litSum('ask')); say(q.kind === 'sub' ? 'So how many are left?' : 'So how many now?').then(() => litSum(null)); }
    }
  }

  function hideQuestion(now, keepSeq) {
    if (!keepSeq) { seq++; stopGen++; releaseExtras(); }
    hideCount();
    scene.reset();
    J.teaching = false;
    if (card) {
      const c = card;
      card = null; bird = null; frame = null; pic = null; seatEls = []; btnEls = []; sumEl = null;
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
    await wait(450);                          // the stop camera settles about 1 s after arrival
    if (!alive()) return;
    queueIntoView();
    await wait(450);
    if (!alive()) return;
    // a passenger friend in the queue waves and says hello (met for the first time: added to the friends list)
    if (q.friend) {
      const f = FRIENDS.find((x) => x.id === q.friend), fm = J.waiting.find((m) => m.userData.friend === q.friend);
      if (f) {
        if (fm) { fm.userData.jump = 1; fm.userData.jumpDelay = 0; }
        const first = meetFriend(f.id);
        await say(first ? `Hello, Captain! I'm ${f.name}!` : `Hello again, Captain! It's me, ${f.name}!`);
        if (!alive()) return;
      }
    }
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
    // (no worked example before the first question: the owner removed it; Mina teaches after a wrong answer)
    // the first time on a double-decker: only the people downstairs count
    if (BB.bus.type === 'double' && !BB.save.seen.downstairs) {
      BB.save.seen.downstairs = true; BB.saveNow();
      await say('We count the people downstairs!');
      if (!alive()) return;
    }
    if (q.what === 'bags') { await say('Every traveller has one suitcase. Let\'s count the suitcases!'); if (!alive()) return; }
    // the story, told while it happens
    for (let i = 0; i < q.n; i++) light(i, true);
    showSum('n1'); litSum('n1'); showCount(q.n);
    await say(nPhrase(q.n, q));
    hideCount();
    for (let i = 0; i < q.n; i++) light(i, false);
    litSum(null);
    if (!alive()) return;
    showSum('n2'); litSum('n2');
    if (q.kind === 'add') {
      const list = J.waiting; J.waiting = [];
      await Promise.all([say(kPhrase(q)), boardPeople(list, (seat) => { if (card) setSeat(seat, 'new'); })]);
    } else {
      await Promise.all([say(kPhrase(q)), alightPeople(q.k, (seat) => { if (card) { setSeat(seat, 'gone'); seatEls[seat].classList.add('bye'); } }, true)]);
    }
    litSum(null);
    if (!alive() || !card) return;
    for (let i = 0; i < 10; i++) seatEls[i].classList.remove('bye');
    if (q.kind === 'sub') scene.wave(J.extras);
    BB.bus.passengers = q.answer;
    setPhase('question');
    q.onRight = onRight;
    const s = ++seq;
    showSum('ask'); litSum('ask');
    await say(askPhrase(q));
    litSum(null);
    if (s !== seq || !card) return;
    card.classList.remove('wait');
  }
  // The card shows just the starting group (seats 0..n-1), e.g. after the worked example.
  function showGroup(n) {
    clearCounting();
    for (let i = 0; i < 10; i++) setSeat(i, '');
    for (let i = 0; i < n; i++) setSeat(i, 'full');
  }


  const PRAISE = ['Well done!', 'Super counting!', 'Hooray!', 'You got it!'];
  const XMAS_PRAISE = ['Ho ho ho! Well done!', 'Merry counting!', 'Jingle jingle, you got it!'];
  const praise = () => BB.pick(BB.xmas && Math.random() < 0.6 ? XMAS_PRAISE : PRAISE);
  const sumWords = (q) => q.kind === 'add' ? `${q.n} plus ${q.k} makes ${q.answer}!` : `${q.n} take away ${q.k} leaves ${q.answer}!`;
  async function answer(q, v, btn) {
    if (!card || J.teaching || q.done || card.classList.contains('wait')) return;
    seq++;                                       // stop any counting voice
    if (v === q.answer) {
      q.done = true;
      J.stopStart = null;
      card.classList.add('wait');
      card.classList.remove('hint', 'counting');
      btn.classList.add('yes'); BB.sfx.right();
      BB.save.questions = (BB.save.questions | 0) + 1; BB.saveNow();
      J.lastKey = qKey(q);
      J.recent = (J.recent || []).concat(J.lastKey).slice(-5);
      const cash = (q.tries ? CASH_STOP_RETRY : CASH_STOP) + (q.bonus ? 1 : 0);   // +1 for stopping in the rain
      // celebrate: every friend on the bus bounces, coins fly to the cash counter
      clearMarks();
      seatEls.forEach((el, i) => { if (isFull(i)) { el.classList.add('lit'); BB.later(160 + i * 60, () => el.classList.remove('lit')); } });
      const counted = flyCoins(btn, cash);
      showSum('n1', 'n2', 'ask'); litSum(null); fillSum(q.answer);
      await Promise.all([say(`Yes! ${sumWords(q)} ${praise()}`), wait(1500), counted]);
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
    litSum(null);
    card.classList.add('hint', 'counting');
    const first = seatEls.findIndex((el, i) => isFull(i));
    birdTo(first >= 0 ? first : null);
    if (bird) bird.classList.add('talk');
    card.classList.add('wait');
    await say(vmode() ? "Let's count together! Tap each picture and count." : "Let's count together! Tap each friend and count.");
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
      buildSum(q); showSum('n1', 'n2', 'ask');          // the example's own sentence, filled in at the end
      BB.bus.passengers = n;                            // the real bus shows the example too (restored afterwards)
    }
    const demoSeat = (count) => { if (q.demo && card) { BB.bus.passengers = count; BB.sfx.pop(); } };
    const done = () => { litSum(null); fillSum(a); };
    const run = async () => {
      const intro = mode === 'demo' ? (q.kind === 'add' ? 'Let me show you how to count on!' : 'Let me show you how to take away!') : "Let's count together!";
      if (!await step(intro)) return;
      if (q.kind === 'add') {
        for (let i = 0; i < n; i++) light(i, true);
        badge(n - 1, n, true); mark(n - 1, n); birdTo(n - 1);
        litSum('n1');
        if (!await step(`We have ${n}.`, 700)) return;
        litSum('n2');
        if (!await step(vmode() ? `And ${k} more. Let's count on!` : `${k} more got on. Let's count on!`, 300)) return;
        const last = full ? a : a - 1;
        for (let i = n; i < last; i++) { demoSeat(i + 1); if (!await countSeat(i, i + 1)) return; }
        if (full) {
          done();
          if (!await step(`${n} and ${k} more make ${a}!`, 400)) return;
          if (a > 5 && a < 10) {                      // ten-frame language: the rows on the bus
            for (let i = 0; i < 5; i++) light(i, true);
            if (!await step(`A full row of 5, and ${a - 5} more!`, 300)) return;
          }
        }
        else { quiz(a - 1); litSum('ask'); }
      } else {
        for (let i = 0; i < n; i++) light(i, true);
        badge(n - 1, n, true); mark(n - 1, n); birdTo(n - 1);
        litSum('n1');
        if (!await step(`We had ${n}.`, 600)) return;
        clearCounting();
        for (let i = a; i < n; i++) { seatEls[i].classList.add('bye'); }
        birdTo(a < 10 ? a : null);
        litSum('n2');
        if (q.demo) demoSeat(a);
        else { scene.wave(J.extras); J.extras.forEach((m) => { m.userData.jump = 1; m.userData.jumpDelay = Math.random() * 0.3; }); }
        if (!await step(vmode() ? `Take away ${k}.` : `${k} got off. Bye bye!`, 600)) return;
        litSum('ask');
        if (a === 0) { if (full && !await step(vmode() ? 'None are left!' : 'Nobody is left!', 300)) return; }
        else {
          if (!await step(vmode() ? "How many are left? Let's count." : "Who is left? Let's count.", 200)) return;
          const last = full ? a : a - 1;
          let from = 0;
          if (last >= 5 && a > 5) {
            for (let i = 0; i < 5; i++) light(i, true);
            badge(4, 5, true); mark(4, 5); birdTo(4);
            if (!await step(full ? `A full row of 5, and ${a - 5} more!` : 'A full row of 5!', 400)) return;
            from = 5;
          }
          for (let i = from; i < last; i++) if (!await countSeat(i, i + 1)) return;
          if (!full) quiz(a - 1);
        }
        if (full) { done(); if (!await step(`${n} take away ${k} leaves ${a}!`, 400)) return; }
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
    litSum(null);
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
  // Road distance from a stop (BB.world.stopDistance) or from the bus (BB.bus.routeLength), else a straight line.
  function stopDist(from, s) {
    try {
      if (!from && typeof BB.bus.routeLength === 'function') { const d = +BB.bus.routeLength(s); if (isFinite(d)) return d; }
      if (from && typeof BB.world.stopDistance === 'function') { const d = +BB.world.stopDistance(from, s); if (isFinite(d)) return d; }
    } catch (e) { /* fall back */ }
    const p = from ? from.pos : (BB.bus.pos || { x: 0, z: 0 });
    return Math.hypot(s.pos.x - p.x, s.pos.z - p.z);
  }
  // Short legs (about 7 s of driving): each next stop is picked from BB.world.stopsByDistance(current) within about
  // 40-80 road units, at random among those (variety, not always the nearest), never the stop just visited or one
  // already in the job, leaning toward named stops (st.minor = small automatic ones with shared names like "the flats").
  const LEG_MIN = 40, LEG_MAX = 80;         // ~70 units apart: mostly the very next stop, about 7 s of driving
  const okStop = (s) => s && s.pos && s.edge != null && s.say;
  function nextNear(from, exclude) {
    const W = BB.world, all = (W.stops || []).filter((s) => okStop(s) && !exclude.includes(s));
    let ranked;
    if (from && typeof W.stopsByDistance === 'function') ranked = W.stopsByDistance(from, all).map((s2) => ({ s: s2, d: stopDist(from, s2) }));
    else ranked = all.map((s2) => ({ s: s2, d: stopDist(from, s2) })).sort((p, q) => p.d - q.d);
    ranked = ranked.filter((o) => o.s !== from && isFinite(o.d));
    if (!ranked.length) return null;
    let pool = ranked.filter((o) => o.d >= LEG_MIN && o.d <= LEG_MAX);
    if (!pool.length) pool = ranked.filter((o) => o.d >= 25 && o.d <= 130);       // nothing that close: widen a little
    if (!pool.length) pool = ranked.filter((o) => o.d >= 25).slice(0, 2);
    if (!pool.length) pool = ranked.slice(0, 3);
    // named stops count three times, so they come up more often than the small ones
    const bag = []; for (const o of pool) { bag.push(o.s); if (!o.s.minor) bag.push(o.s, o.s); }
    return BB.pick(bag);
  }
  J.nextNear = nextNear;
  function pickStops() {
    const count = (BB.save.jobsDone | 0) < 1 ? 2 : BB.randInt(2, 3);
    const here = BB.bus.atStop || J.lastStop;
    const exclude = here ? [here] : [];
    const list = [];
    let from = here && here.id !== 'depot' && okStop(here) ? here : null;
    for (let i = 0; i < count; i++) {
      const s2 = nextNear(from, exclude.concat(list));
      if (!s2) break;
      list.push(s2); from = s2;
    }
    J.lastJobStops = list;
    return list;
  }
  const stopLine = (st, first) => first
    ? (st.minor ? `New job! First stop, ${st.say}!` : `New job! Drive to ${st.say}!`)
    : (st.minor ? `Next stop, ${st.say}!` : `Now drive to ${st.say}!`);
  function bedtime() {
    clearWaiting();
    if (J.current) { J.current = null; BB.bus.stopAt(null); BB.emit('job:target', { stop: null, job: null }); }
    setPhase('bedtime');
    BB.emit('jobs:bedtime');
  }
  J.start = function () {
    if (J.current) return;                    // a job is already running: starting twice must not make two
    if (timeUp()) { bedtime(); return; }
    const vk = vehicleKind();
    if (vk !== 'bus' && startVehicleJob(vk)) return;
    const theme = pickTheme();
    const job = { stops: pickStops(), index: 0, cash: 0, q: null, theme, groupOn: 0 };
    if (theme) {
      // the themed stop first (the school, the airport, the beach/park), then one other stop for the drop
      const ts = themeStop(theme), here = BB.bus.atStop || J.lastStop;
      if (ts && ts !== here) { const d2 = nextNear(ts, [ts, here].filter(Boolean)); job.stops = d2 ? [ts, d2] : job.stops.slice(0, 2); }
      else job.stops = job.stops.slice(0, 2);
      J.lastJobStops = job.stops.slice();
      J.sinceSpecial = 0;
    } else J.sinceSpecial = (J.sinceSpecial == null ? 2 : J.sinceSpecial) + 1;
    J.current = job;
    BB.emit('job:new', { job, theme });
    if (theme === 'school') jingle();
    say(theme ? `${THEMES[theme].start} Drive to ${job.stops[0].say}!` : stopLine(job.stops[0], true), { queue: true });
    nextStop(true);
  };
  // Head for the job's current stop: a new question (and the people for it waiting at the shelter).
  function nextStop(quiet) {
    const job = J.current; if (!job) return;
    // raining: someone with an umbrella waves the bus down at an extra stop on the way (once a job, one more coin)
    let bonusLine = null;
    const raining = BB.world && typeof BB.world.isRaining === 'function' && BB.world.isRaining();
    if (raining && !job.theme && !job.bonusDone && job.index > 0 && level() >= 1 && Math.random() < 0.5) {
      const here = BB.bus.atStop || J.lastStop;
      const extra = nextNear(here && okStop(here) ? here : null, job.stops.concat(here ? [here] : []));
      if (extra) {
        job.stops.splice(job.index, 0, extra); job.bonusIdx = job.index; job.bonusDone = true;
        bonusLine = `Look! Someone is waving in the rain! Let's stop at ${extra.say}!`;
      }
    }
    const stop = job.stops[job.index], n0 = BB.bus.passengers | 0;
    if (job.theme && job.index === 0) {
      const T = THEMES[job.theme], L = LEVELS[level()];
      const q = makeAddQuestion(n0, 2, Math.max(2, Math.min(4, L.kMax + 1)));
      q.word = T.word; q.style = { prop: T.prop, kid: !!T.kid }; q.group = job.theme;
      // at the airport, when the bus starts empty everyone aboard is a traveller: sometimes count the suitcases
      if (job.theme === 'airport' && n0 === 0 && q.pre >= 0) { q.preStyle = { prop: 'case' }; if (Math.random() < 0.5) q.what = 'bags'; }
      job.q = q;
    } else if (job.bonusIdx === job.index) {
      job.q = makeAddQuestion(n0, 1, Math.max(1, Math.min(3, LEVELS[level()].kMax)));
      job.q.bonus = true;
    } else job.q = makeQuestion(n0, J.lastKey);
    // now and then one of the people getting on is a passenger friend (at most one a job)
    if (job.q.kind === 'add' && !job.q.group && !job.friendDone && Math.random() < 0.3) { job.q.friend = BB.pick(FRIENDS).id; job.friendDone = true; }
    setWaiting(stop, job.q);
    driveTo(stop, bonusLine ? 'silent' : quiet);
    if (bonusLine) { BB.emit('job:new', { job, bonus: true }); say(bonusLine, { queue: true }); }
  }
  J.nextStop = nextStop;
  J.setWaiting = setWaiting;
  J._kerbSpot = kerbSpot;
  // Drive to the current stop again (after the depot or a tow), keeping its question and the people waiting.
  function resumeJob(quiet) {
    const job = J.current;
    if (!job) { J.start(); return; }
    if (timeUp()) { bedtime(); return; }
    if (job.vehicle) {
      if (vehicleKind() !== job.vehicle) { J.current = null; J.start(); return; }   // swapped vehicles in the garage
      driveLeg(quiet); return;
    }
    if (vehicleKind() !== 'bus') { clearWaiting(); J.current = null; J.start(); return; }
    const stop = job.stops[job.index];
    if (!job.q || job.q.n !== (BB.bus.passengers | 0) + job.q.pre) { nextStop(quiet); return; }
    if (!J.waiting.length && (job.q.pre > 0 || job.q.kind === 'add')) setWaiting(stop, job.q);
    driveTo(stop, quiet);
  }
  function driveTo(stop, quiet) {
    const job = J.current;
    J.stopStart = null;
    setPhase('drive');
    BB.bus.stopAt(stop, onArrive);
    BB.emit('job:target', { stop, job });
    if (!quiet) say(stopLine(stop, false), { queue: true });          // quiet: true, or 'silent' (another line says it)
  }
  function onArrive(stop) {
    const job = J.current; if (!job) return;
    setPhase('stop'); J.lastStop = stop;
    BB.bus.openDoors(); BB.sfx.ding();
    const q = job.q;
    J.stopStart = { job, stop, q, pax0: BB.bus.passengers | 0 };     // to replay this stop exactly after Home
    BB.later(600, () => { if (J.phase === 'stop') runStop(stop, q, (qq, cash) => afterRight(stop, qq, cash)); });
  }
  async function afterRight(stop, q, cash) {
    const job = J.current; if (!job) return;
    job.cash += cash;
    BB.emit('job:stopDone', { correct: true, cash, stop, tries: q.tries, bonus: !!q.bonus });
    if (q.group) job.groupOn = q.k + (q.preStyle ? Math.max(0, q.pre) : 0);   // the themed group now on board
    if (q.bonus) await say('Thank you for stopping in the rain!');
    await wait(500);
    if (J.current !== job || BB.bedtime) return;
    if (J.phase === 'home') {
      job.index++; job.q = null;
      if (job.index >= job.stops.length) { BB.bus.passengers = 0; J.current = null; BB.save.jobsDone = (BB.save.jobsDone | 0) + 1; BB.saveNow(); }
      return;
    }
    job.index++;
    if (job.index >= job.stops.length) {
      // end of the line: everybody gets off with a wave (so the next job starts fresh, no getting-off warm-ups).
      // A themed group leaves with its props and its own goodbye (balloons float up and pop: "Happy birthday!").
      const all = BB.bus.passengers | 0;
      if (all > 0) {
        if (job.theme && job.groupOn > 0) {
          const T = THEMES[job.theme], g = Math.min(job.groupOn, all);
          let popped = false;
          const style = { prop: T.prop, kid: !!T.kid, onPop: () => { if (!popped && BB.ui && BB.ui.confetti) { popped = true; BB.ui.confetti(); } } };
          let dropLine = T.drop;
          if (job.theme === 'airport' && !/city/i.test(((stop && stop.id) || '') + ' ' + ((stop && stop.name) || ''))) dropLine = 'Bye bye! Have a lovely trip!';
          await Promise.all([say(dropLine), alightPeople(g, null, false, style).then(() => all - g > 0 ? alightPeople(all - g) : null)]);
        } else {
          await Promise.all([say('Last stop! Everybody off. Thank you, bus!'), alightPeople(all)]);
        }
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
    await Promise.all([say(BB.xmas ? 'Ho ho ho! Job done! Great driving!' : 'Job done! Great driving!'), wait(2800)]);
    if (J.phase !== 'done' || BB.bedtime) return;
    if (timeUp()) { bedtime(); return; }
    if (J.wantDepot || BB.bus.fuel <= BB.cfg.fuelLow + 0.06) J.goDepot(BB.bus.fuel <= BB.cfg.fuelLow + 0.06 ? 'fuel' : undefined);
    else J.start();
  }

  // ---------- vehicles kids can drive: a job kind per vehicle ----------
  // Each vehicle job is a few legs: drive to a place, then a little scene with spoken lines and one or two questions on
  // the card (the vehicle's own pictures + the written sum, every number 0-10, adding and taking away, the same
  // teaching on wrong answers, 3 coins each, never lost). Everything new in bus.js / world.js is feature-detected.
  const VEHICLES = ['taxi', 'fire', 'ambulance', 'icecream', 'tow'];
  let legGen = 0;                  // bumps when a vehicle scene should stop (Home, bedtime); a right answer doesn't
  function vehicleKind() {
    const B = BB.bus, F = BB.fleet;
    const k = B.kind || (F && F.KIND && F.KIND[B.type]) || B.type;
    return VEHICLES.includes(k) ? k : 'bus';
  }
  J.vehicleKind = vehicleKind;
  const vcall = (names, ...args) => { for (const n of names) if (typeof BB.bus[n] === 'function') { try { return BB.bus[n](...args); } catch (e) { console.error(e); } } return undefined; };
  const siren = (on) => vcall(['setSiren', 'siren'], on);
  const ladder = (on) => vcall(['setLadder', 'ladder', 'raiseLadder'], on);
  const hatch = (on) => vcall(['setHatch', 'hatch', 'openHatch'], on);
  // places: world.js scene spots and W.places when they exist, else the ordinary stops / the depot
  // a scene spot for a tag ('fire' | 'car' | 'picnic' | 'icecream'), away from the bus (world.js W.sceneSpot)
  function sceneSpot(tag) {
    const W = BB.world, p = BB.bus.pos;
    try { if (typeof W.sceneSpot === 'function') { const sp = W.sceneSpot(tag, p ? p.x : null, p ? p.z : null); if (sp && sp.pos) return sp; } } catch (e) { console.error(e); }
    return farFrom(spots(), BB.bus.atStop || J.lastStop);
  }
  function spots() {
    const W = BB.world, list = W.sceneSpots || W.spots || (W.places && W.places.spots) || [];
    const ok = (Array.isArray(list) ? list : Object.values(list)).filter((s) => s && s.pos);
    return ok.length ? ok : (W.stops || []).filter((s) => s && s.pos && s.say);
  }
  const place = (name, fallback) => { const P2 = BB.world.places; return (P2 && P2[name] && P2[name].pos) ? P2[name] : fallback; };
  const sayOf = (t) => (t && t.say && t.say !== 'here') ? t.say : 'the spot on the map';
  // where a scene is: "at the beach", or (a plain roadside spot) "down the road"
  const where = (t) => (t && t.say && t.say !== 'here') ? ` at ${t.say}` : '';   // a plain roadside spot: no name
  function farFrom(list, here) { const l = list.filter((x) => x !== here && x !== J.lastStop); return BB.pick(l.length ? l : list); }

  // A question about the vehicle's things: kind 'add' or 'sub' (sub becomes add before taking away is learned),
  // n0 = how many there are now (null = pick), within this level's limits and 0-10.
  function sceneQ(kind, n0, words, icon) {
    const lv = level(), L = LEVELS[lv];
    if (kind === 'sub' && !(L.sub > 0)) kind = 'add';
    let n = n0, k;
    if (kind === 'add') {
      const hiN = Math.min(8, L.tot - 1);
      if (n == null || n < 1 || n > hiN) n = BB.randInt(1, Math.max(1, Math.min(lv < 2 ? 3 : 6, hiN)));
      k = BB.randInt(1, Math.max(1, Math.min(L.kMax, L.tot - n, 10 - n)));
    } else {
      if (n == null || n < 2 || n > Math.min(10, L.tot)) n = BB.randInt(3, Math.min(10, L.tot));
      k = BB.randInt(1, Math.max(1, Math.min(L.subK || L.kMax, L.zero ? n : n - 1)));
    }
    const q = { kind, n, k, answer: kind === 'add' ? n + k : n - k, pre: 0, tries: 0, icon };
    q.choices = makeChoices(q);
    q.text = words(q);
    return q;
  }
  // the questions of the leg being played, kept so a replay after Home asks exactly the same ones
  let curLeg = null;
  function legQ(kind, n0, words, icon) {
    const L2 = curLeg;
    if (L2 && L2._qs && L2._qs[L2._qi]) { const q = L2._qs[L2._qi++]; q.tries = 0; q.done = false; q.onRight = null; return q; }
    const q = sceneQ(kind, n0, words, icon);
    if (L2 && L2._qs) L2._qs[L2._qi++] = q;
    return q;
  }
  const pl = (n, one, many) => `${n} ${plural(n, one, many)}`;
  const isAre = (n) => plural(n, 'is', 'are');
  const WORDS = {
    bagsIn: (q) => q.kind === 'add'
      ? { n: `${pl(q.n, 'bag', 'bags')} ${isAre(q.n)} in the boot.`, k: `${q.k} more ${plural(q.k, 'goes', 'go')} in.`, ask: 'How many bags are in the boot now?' }
      : { n: `${pl(q.n, 'bag', 'bags')} ${isAre(q.n)} in the boot.`, k: `${q.k} ${plural(q.k, 'comes', 'come')} out.`, ask: 'How many bags are left in the boot?' },
    fighters: (q) => ({ n: `${pl(q.n, 'firefighter is', 'firefighters are')} spraying water.`, k: `${q.k} more ${plural(q.k, 'comes', 'come')} to help.`, ask: 'How many firefighters now?' }),
    windows: (q) => ({ n: `${pl(q.n, 'window has', 'windows have')} smoke.`, k: `${q.k} ${plural(q.k, 'is', 'are')} clear now.`, ask: 'How many windows still have smoke?' }),
    teddies: (q) => q.kind === 'add'
      ? { n: `${pl(q.n, 'teddy bear is', 'teddy bears are')} in the kit.`, k: `${q.k} more ${plural(q.k, 'goes', 'go')} in.`, ask: 'How many teddy bears now?' }
      : { n: `${pl(q.n, 'teddy bear is', 'teddy bears are')} in the kit.`, k: `${q.k} ${plural(q.k, 'goes', 'go')} to children at the clinic.`, ask: 'How many teddy bears are left?' },
    sold: (q) => q.kind === 'sub'
      ? { n: `${pl(q.n, 'ice cream is', 'ice creams are')} in the van.`, k: `${q.k} ${plural(q.k, 'is', 'are')} sold.`, ask: 'How many ice creams are left?' }
      : { n: `${pl(q.n, 'ice cream is', 'ice creams are')} in the van.`, k: `${q.k} more ${plural(q.k, 'goes', 'go')} in.`, ask: 'How many ice creams now?' },
    cones: (q) => ({ n: `${pl(q.n, 'cone is', 'cones are')} in the box.`, k: `${q.k} more ${plural(q.k, 'goes', 'go')} in.`, ask: 'How many cones now?' }),
    yard: (q) => q.kind === 'add'
      ? { n: `${pl(q.n, 'car is', 'cars are')} in the yard.`, k: `${q.k} more ${plural(q.k, 'car comes', 'cars come')} in.`, ask: 'How many cars are in the yard now?' }
      : { n: `${pl(q.n, 'car is', 'cars are')} in the yard.`, k: `${q.k} ${plural(q.k, 'is', 'are')} fixed and ${plural(q.k, 'drives', 'drive')} away.`, ask: 'How many cars are left?' },
  };

  // One question on the card: the story (pictures pop in or fade out as it's told), then the ask. Resolves on the
  // right answer (after the praise and the coins), or never if the job stops (Home, bedtime).
  function askScene(q) {
    return new Promise((resolve) => {
      const g = legGen, alive = () => g === legGen && !BB.bedtime && !!J.current && J.phase !== 'home';
      (async () => {
        buildCard(q); J.question = q;
        if (q.scene) { try { q.scene.show(q.n); scnFrame(q.scene.points(Math.max(q.n, q.kind === 'add' ? q.n + q.k : q.n))); } catch (e) { console.error(e); } }
        await wait(350); if (!alive()) return;
        for (let i = 0; i < q.n; i++) light(i, true);
        showSum('n1'); litSum('n1');
        await say(q.text.n);
        for (let i = 0; i < q.n; i++) light(i, false);
        litSum(null); if (!alive() || !card) return;
        showSum('n2'); litSum('n2');
        const pops = [];
        for (let j = 0; j < q.k; j++) pops.push(wait(250 + j * 380).then(() => {
          if (!card) return;
          if (q.kind === 'add') setSeat(q.n + j, 'new'); else { const i = q.n - 1 - j; setSeat(i, 'gone'); seatEls[i].classList.add('bye'); }
          if (q.scene) { try { if (q.kind === 'add') q.scene.add(q.n + j); else q.scene.remove(q.n - 1 - j); } catch (e) { console.error(e); } }
          BB.sfx.pop();
        }));
        await Promise.all([say(q.text.k), ...pops]);
        litSum(null); if (!alive() || !card) return;
        seatEls.forEach((el) => el.classList.remove('bye'));
        setPhase('question');
        q.onRight = (qq, cash) => { const job = J.current; if (job) job.cash += cash; BB.emit('job:stopDone', { correct: true, cash, vehicle: job && job.vehicle, tries: qq.tries }); resolve(); };
        const s2 = ++seq;
        showSum('ask'); litSum('ask');
        await say(q.text.ask);
        litSum(null);
        if (s2 !== seq || !card) return;
        card.classList.remove('wait');
      })().catch((e) => console.error(e));
    });
  }
  // people (a family, Auntie, a queue of children) appear by the vehicle's door and hop in, or hop out and walk away
  async function hopIn(count, style) {
    const list = [];
    for (let i = 0; i < count; i++) { const m = person(BB.randInt(0, 7), style); m.position.copy(kerbSpot(2.2 + (i % 2) * 0.5, 1 + i * 0.9, false)); list.push(m); }
    await wait(300);
    await Promise.all(list.map((m, i) => wait(i * 350).then(async () => { await walkTo(m, doorOut(), 3.2); removePerson(m); BB.sfx.pop(); })));
  }
  async function hopOut(count, style) {
    for (let i = 0; i < count; i++) {
      const m = person(BB.randInt(0, 7), style); m.position.copy(doorOut()); J.extras.push(m);
      walkTo(m, kerbSpot(2.2, -1 - i * 0.9, false), 3).then(() => { m.userData.jump = 1; m.userData.jumpDelay = 0; BB.later(1400, () => walkAway(m)); });
      await wait(350);
    }
  }
  function queueKids(count) {
    clearWaiting();
    for (let i = 0; i < count; i++) {
      const m = person(BB.randInt(0, 7), { kid: true });
      m.position.copy(kerbSpot(2.4, 1.2 + i * 0.9, false)); m.userData.seed = Math.random() * 6;
      J.waiting.push(m);
    }
  }
  // ---------- the vehicle scenes in 3D: what's counted, matching the card ----------
  // Cheap merged meshes in a "tray" of two rows of five on the pavement beside the vehicle (like the card's
  // ten-frame): cars in the depot yard, bags behind the taxi's boot, teddy bears on a kit box, firefighters and a
  // kiosk's smoky windows. They pop in / drive off / hop away / clear as the story is told, and the scene camera is
  // asked to frame them (target.frame + BB.bus.reframe()).
  const SCN = { items: [], extra: [], target: null, n: 0 };
  let SGEO = null, frameNo = 0;
  function sceneGeos() {
    if (SGEO) return SGEO;
    const mk = (fn) => { const b = BB.mk.builder(); fn(b); return b.geometry(); };
    const car = (c) => mk((b) => {
      b.box(1.7, 0.7, 3.6, c, 0, 0.3, 0); b.box(1.5, 0.6, 1.8, '#cfe9f5', 0, 1.0, -0.2); b.box(1.56, 0.12, 1.86, c, 0, 1.58, -0.2);
      for (const x of [-0.82, 0.82]) for (const z of [-1.2, 1.2]) b.cyl(0.34, 0.34, 0.24, 8, '#3a2a3c', x, 0.34, z, 0, 0, Math.PI / 2);
    });
    SGEO = {
      cars: ['#4fa3e0', '#f5b83d', '#5cb85c', '#ef5a4b', '#8e62c8'].map(car),
      bag: mk((b) => { b.box(0.62, 0.72, 0.36, P.berry, 0, 0, 0); b.box(0.63, 0.09, 0.37, P.honeyLight, 0, 0.34, 0); b.box(0.09, 0.26, 0.09, '#3a2a3c', 0, 0.72, 0); }),
      teddy: mk((b) => {
        b.ball(0.3, '#b5793e', 0, 0.3, 0); b.ball(0.24, '#c58a55', 0, 0.76, 0); b.ball(0.1, '#b5793e', -0.18, 0.95, 0); b.ball(0.1, '#b5793e', 0.18, 0.95, 0);
        b.ball(0.09, '#e2b07c', 0, 0.72, 0.2); b.ball(0.09, '#ff8fab', 0, 0.42, 0.26);
      }),
      kit: mk((b) => { b.box(4.4, 0.5, 2.0, '#fbf7ee', 0, 0, 0); b.box(4.44, 0.12, 2.04, '#ff8fab', 0, 0.36, 0); // a coral heart on the lid (the ambulance's emblem; never a cross)
        b.ball(0.17, '#ff6b5c', 1.63, 0.5, 0.7, 1, 1, 0.22, 1); b.ball(0.17, '#ff6b5c', 1.87, 0.5, 0.7, 1, 1, 0.22, 1);
        b.box(0.32, 0.06, 0.32, '#ff6b5c', 1.75, 0.47, 0.52, Math.PI / 4); }),
      fighter: friendGeo({ shirt: '#3d5a80', skin: '#d9a679', hair: '#ef5a4b' }),          // red helmet
      jet: mk((b) => { b.cyl(0.06, 0.11, 2.4, 5, '#bfe6f5', 0, 0, 0); }),
      kiosk: mk((b) => {
        b.box(6.8, 4.0, 3.0, '#fbf1dc', 0, 0, 0); b.box(7.2, 0.4, 3.4, '#ef5a4b', 0, 4.0, 0); b.box(6.82, 0.5, 3.02, '#e2c08d', 0, 0, 0);
      }),
      win: mk((b) => { b.box(0.95, 0.85, 0.08, '#4d6f8a', 0, 0, 0); b.box(1.1, 0.1, 0.1, '#c84a3c', 0, -0.06, 0); }),
      smoke: mk((b) => { b.ball(0.5, '#8a8290', 0, 0.45, 0); b.ball(0.4, '#a8a0ae', 0.35, 0.95, 0); b.ball(0.32, '#bdb6c2', -0.2, 1.35, 0); }),
    };
    return SGEO;
  }
  // a tray of slots: 'out' units onto the pavement, 'along' units along the vehicle from its front door, sp apart
  function tray(out, along, sp, rowSp, y = 0) {
    const f = doorFrame(false);
    const fn = (i) => { const r = Math.floor(i / 5), c = i % 5; return new THREE.Vector3(f.d.x + f.ox * (out + r * rowSp) + f.fx * (along - c * sp), GROUND + y, f.d.z + f.oz * (out + r * rowSp) + f.fz * (along - c * sp)); };
    fn.f = f; fn.face = Math.atan2(f.ox, f.oz);        // facing the stop camera (out onto the pavement)
    return fn;
  }
  function scnMesh(geo, pos, rotY, pop) {
    const m = new THREE.Mesh(geo, BB.mk.mat); m.position.copy(pos); m.rotation.y = rotY || 0; m.name = 'sceneItem';
    BB.scene.add(m);
    if (pop) { m.scale.setScalar(0.01); tween(0.3, (t) => m.scale.setScalar(Math.max(0.01, t < 0.7 ? t / 0.7 * 1.15 : 1.15 - (t - 0.7) / 0.3 * 0.15))); }
    return m;
  }
  const scnDrop = (m) => { if (m && m.parent) m.parent.remove(m); };
  function scnClear() {
    for (const m of SCN.items.concat(SCN.extra)) scnDrop(m);
    SCN.items = []; SCN.extra = [];
    if (SCN.target) { delete SCN.target.frame; delete SCN.target.frameKey; SCN.target = null; vcall(['reframe']); }
  }
  J._scnClear = scnClear;
  // ask the scene camera to show these world points too
  function scnFrame(pts) {
    const job = J.current, t = job && job.legs && job.legs[job.index] && job.legs[job.index].to;
    if (!t || !pts.length) return;
    t.frame = pts.map((p) => ({ x: p.x, y: 0, z: p.z })).concat(pts.map((p) => ({ x: p.x, y: 2.4, z: p.z })));
    t.frameKey = 'scn' + (++frameNo);
    SCN.target = t;
    vcall(['reframe']);
  }
  // Scene kinds: { show(n) (make sure n are there), add(i) (one more arrives), remove(i) (one goes), points(count) }
  function yardScene() {
    const G = sceneGeos(), slot = tray(3.8, -1.5, 2.5, 4.6);
    const make = (i, pop) => scnMesh(G.cars[i % 5], slot(i), slot.face, pop);
    return {
      show(n) { while (SCN.items.length < n) SCN.items.push(make(SCN.items.length, false)); },
      add(i) {          // drives in from the pavement side
        const m = make(i, false), to = slot(i), from = to.clone().add(new THREE.Vector3(slot.f.ox * 9, 0, slot.f.oz * 9));
        m.position.copy(from); m.rotation.y = slot.face + Math.PI; SCN.items[i] = m;
        tween(0.9, (t) => { const e = 1 - (1 - t) * (1 - t); m.position.lerpVectors(from, to, e); if (t >= 1) m.rotation.y = slot.face; });
      },
      remove(i) {       // fixed: drives away
        const m = SCN.items[i]; if (!m) return; SCN.items[i] = null;
        const from = m.position.clone(), to = from.clone().add(new THREE.Vector3(slot.f.ox * 12, 0, slot.f.oz * 12));
        tween(1.1, (t) => { m.position.lerpVectors(from, to, t * t); }).then(() => scnDrop(m));
      },
      points: (c) => Array.from({ length: Math.max(1, c) }, (_, i) => slot(i)),
    };
  }
  function bagScene() {
    const G = sceneGeos(), slot = tray(2.5, -2.2, 0.85, 0.95), from = kerbSpot(3.2, 2.0, false);
    const make = (i, pop) => scnMesh(G.bag, slot(i), slot.face, pop);
    return {
      show(n) { while (SCN.items.length < n) SCN.items.push(make(SCN.items.length, false)); },
      add(i) {          // swung from the family into the boot
        const m = make(i, false), to = slot(i); m.position.copy(from); SCN.items[i] = m;
        tween(0.7, (t) => { m.position.lerpVectors(from, to, t); m.position.y = GROUND + Math.sin(t * Math.PI) * 1.6; });
      },
      remove(i) {       // lifted out onto the pavement
        const m = SCN.items[i]; if (!m) return; SCN.items[i] = null; SCN.extra.push(m);
        const a = m.position.clone(), to = a.clone().add(new THREE.Vector3(slot.f.ox * 2.2, 0, slot.f.oz * 2.2));
        tween(0.6, (t) => { m.position.lerpVectors(a, to, t); m.position.y = GROUND + Math.sin(t * Math.PI) * 1.0; });
      },
      points: (c) => Array.from({ length: Math.max(1, c) }, (_, i) => slot(i)).concat([from]),
    };
  }
  function teddyScene() {
    const G = sceneGeos(), slot = tray(2.7, -0.9, 0.8, 0.85, 0.5);
    if (!SCN.extra.some((m) => m.userData.kit)) {        // the kit box under the teddies
      const c = slot(2).clone().add(new THREE.Vector3(slot.f.ox * 0.42, -0.5, slot.f.oz * 0.42));
      const kit = scnMesh(G.kit, c, Math.atan2(slot.f.fx, slot.f.fz) + Math.PI / 2, false); kit.userData.kit = true; SCN.extra.push(kit);
    }
    const make = (i, pop) => scnMesh(G.teddy, slot(i), slot.face, pop);
    return {
      show(n) { while (SCN.items.length < n) SCN.items.push(make(SCN.items.length, false)); },
      add(i) { SCN.items[i] = make(i, true); },
      remove(i) {       // a teddy hops off to a child at the clinic
        const m = SCN.items[i]; if (!m) return; SCN.items[i] = null;
        const a = m.position.clone(), to = a.clone().add(new THREE.Vector3(slot.f.ox * 3, -0.5, slot.f.oz * 3));
        tween(0.7, (t) => { m.position.lerpVectors(a, to, t); m.position.y += Math.sin(t * Math.PI) * 1.2; }).then(() => scnDrop(m));
      },
      points: (c) => Array.from({ length: Math.max(1, c) }, (_, i) => slot(i)),
    };
  }
  // the fire: a kiosk with a 2x5 grid of windows (the smoky ones puff smoke) and firefighters spraying water
  function fireScene(smoky) {
    const G = sceneGeos(), f = doorFrame(false);
    const face = Math.atan2(f.ox, f.oz), base = kerbSpot(3.2, 12.5, false);   // ahead of the engine, beside the camera's view (not in front of it)
    const kiosk = scnMesh(G.kiosk, base, face, false); SCN.extra.push(kiosk);
    const winPos = (i) => { const r = Math.floor(i / 5), c = i % 5, side = (c - 2) * 1.25; return new THREE.Vector3(base.x + f.ox * 1.55 + f.fx * side, GROUND + (r ? 1.25 : 2.55), base.z + f.oz * 1.55 + f.fz * side); };
    const smoke = [];
    for (let i = 0; i < 10; i++) {
      SCN.extra.push(scnMesh(G.win, winPos(i), face, false));
      if (i < smoky) { const s2 = scnMesh(G.smoke, winPos(i).add(new THREE.Vector3(f.ox * 0.8, 0.5, f.oz * 0.8)), face, false); s2.scale.setScalar(1.3); smoke[i] = s2; SCN.extra.push(s2); }   // out in front of the window, seen from any camera
    }
    const slot = tray(2.8, 8.0, 1.05, 1.1);
    const fighter = (i, pop) => {
      const m = scnMesh(G.fighter, slot(i), Math.atan2(f.fx, f.fz), pop);          // facing the kiosk
      const jet = new THREE.Mesh(G.jet, BB.mk.mat); jet.position.set(0.2, 1.1, 0.3); jet.rotation.x = 1.05; m.add(jet);
      return m;
    };
    return {
      fighters: {
        show(n) { while (SCN.items.length < n) SCN.items.push(fighter(SCN.items.length, false)); },
        add(i) { SCN.items[i] = fighter(i, true); },
        remove() {},
        points: (c) => Array.from({ length: Math.max(1, c) }, (_, i) => slot(i)).concat([base, winPos(0), winPos(4)]),
      },
      windows: {
        show() {},
        add() {},
        remove(i) { const s2 = smoke[i]; if (!s2) return; smoke[i] = null; tween(0.8, (t) => s2.scale.setScalar(Math.max(0.01, 1.3 * (1 - t)))).then(() => scnDrop(s2)); },
        points: () => [base, winPos(0), winPos(4), winPos(5), winPos(9)],
      },
    };
  }

  // the broken-down car for the tow truck: our own little car, or the bus.js hook helper's
  let towCar = null;
  function brokenCar() {
    if (towCar) return towCar;
    const b = BB.mk.builder();
    b.box(1.7, 0.7, 3.6, '#4fa3e0', 0, 0.35, 0); b.box(1.5, 0.6, 1.8, '#cfe9f5', 0, 1.05, -0.2); b.box(1.55, 0.12, 1.85, '#4fa3e0', 0, 1.62, -0.2);
    for (const x of [-0.8, 0.8]) for (const z of [-1.2, 1.2]) b.cyl(0.35, 0.35, 0.25, 8, '#3a2a3c', x, 0.0, z, 0, 0, Math.PI / 2);
    towCar = b.mesh(); towCar.name = 'brokenCar';
    return towCar;
  }

  // The legs of each vehicle job: { to: place, go: line when setting off, run: async scene }.
  function vehicleLegs(kind) {
    const W = BB.world, here = BB.bus.atStop || J.lastStop, stops = (W.stops || []).filter((s) => s && s.pos && s.say);
    const spot = sceneSpot({ taxi: 'picnic', fire: 'fire', ambulance: 'picnic', icecream: 'icecream', tow: 'car' }[kind]), landmark = farFrom(stops, spot);
    const L = [];
    const carry = { bags: null, teddies: null };
    if (kind === 'taxi') {
      const fam = BB.randInt(1, 4);
      L.push({ to: spot, start: `Taxi job! A family is waiting${where(spot)}. Let's go!`, run: async (ok) => {
        await say(plural(fam, 'Hello, taxi! In I get!', 'Hello, taxi! In we get!')); if (!ok()) return;
        hatch(true); await hopIn(fam); if (!ok()) return;
        const q = legQ('add', null, WORDS.bagsIn, 'bags'); q.scene = bagScene(); await askScene(q); carry.bags = q.answer; hatch(false);
      } });
      L.push({ to: landmark, go: `Now drive to ${sayOf(landmark)}!`, run: async (ok) => {
        hatch(true);
        const qb = legQ('sub', carry.bags, WORDS.bagsIn, 'bags'); qb.scene = bagScene(); await askScene(qb); if (!ok()) return;
        hatch(false); hopOut(fam); await say('Thank you, taxi! Bye bye!');
      } });
    } else if (kind === 'fire') {
      const station = place('fireStation', W.depot);
      L.push({ to: spot, start: `Fire engine! There's smoke${where(spot)}! Siren on, let's go!`, onGo: () => siren(true), run: async (ok) => {
        const subOk = LEVELS[level()].sub > 0, qw = subOk ? legQ('sub', null, WORDS.windows, 'window') : null;
        const fs = fireScene(qw ? qw.n : 4);
        await say("We're here! Ladder up!"); ladder(true); if (!ok()) return;
        const qf = legQ('add', null, WORDS.fighters, 'fighter'); qf.scene = fs.fighters;
        await askScene(qf); if (!ok()) return;
        if (qw) { qw.scene = fs.windows; await askScene(qw); if (!ok()) return; }
        siren(false); ladder(false); BB.sfx.cheer(); if (BB.ui && BB.ui.confetti) BB.ui.confetti();
        await say('The fire is out! Hooray!');
      } });
      L.push({ to: station, go: 'Back to the fire station!', run: async () => { await say('Thank you, firefighters!'); } });
    } else if (kind === 'ambulance') {
      const clinic = place('clinic', farFrom(stops, spot));
      const auntie = { geo: (FRIENDS[2].geo || (FRIENDS[2].geo = friendGeo(FRIENDS[2].look))) };
      L.push({ to: spot, start: `Ambulance! Auntie needs a check-up. She's waiting${where(spot)}. Let's go!`, onGo: () => siren(true), run: async (ok) => {
        siren(false);
        await say('Hello, Auntie! Hop in!'); if (!ok()) return;
        await hopIn(1, auntie); if (!ok()) return;
        const q = legQ('add', null, WORDS.teddies, 'teddy'); q.scene = teddyScene(); await askScene(q); carry.teddies = q.answer;
      } });
      L.push({ to: clinic, go: 'Off to the clinic!', run: async (ok) => {
        const qt = legQ('sub', carry.teddies, WORDS.teddies, 'teddy'); qt.scene = teddyScene(); await askScene(qt); if (!ok()) return;
        hopOut(1, auntie); await say('All better! Thank you!');
      } });
    } else if (kind === 'icecream') {
      const park = stopLike(/park/i) || farFrom(stops, here), beach = stopLike(/beach/i) || farFrom(stops, park);
      L.push({ to: park, start: `Ice cream van! Let's go to ${sayOf(park)}!`, run: async (ok) => {
        jingle(); queueKids(BB.randInt(2, 4)); hatch(true);
        await say('Ice cream! Ice cream! The children are waiting!'); if (!ok()) return;
        await askScene(legQ('sub', null, WORDS.sold, 'icecream')); if (!ok()) return;
        for (const m of J.waiting.splice(0)) { m.userData.jump = 1; J.extras.push(m); BB.later(900, () => walkAway(m)); }
        hatch(false); await say('Yummy! Thank you!');
      } });
      L.push({ to: beach, go: `Now drive to ${sayOf(beach)}!`, run: async (ok) => {
        jingle(); queueKids(BB.randInt(2, 4)); hatch(true);
        await askScene(legQ('add', null, WORDS.cones, 'icecream')); if (!ok()) return;
        for (const m of J.waiting.splice(0)) { m.userData.jump = 1; J.extras.push(m); BB.later(900, () => walkAway(m)); }
        hatch(false); await say('Yummy! Bye bye!');
      } });
    } else if (kind === 'tow') {
      const yard = W.depot;
      L.push({ to: spot, start: `Tow truck! A car has broken down${where(spot)}. Let's help!`, run: async (ok) => {
        const car = brokenCar();
        if (!(BB.bus.has && BB.bus.has('hook')) || vcall(['hookOn', 'hookCar'], car) === undefined) {
          // no hook helper: the car is lifted behind the truck
          if (car.parent) car.parent.remove(car);
          car.position.set(0, 0.35, -5.2); car.rotation.set(0.12, 0, 0); BB.bus.front.add(car);
        }
        BB.sfx.pop(); await say('Hook on! Up it goes!');
      } });
      L.push({ to: yard, go: 'Tow it to the depot!', run: async (ok) => {
        if (typeof BB.bus.hookOn === 'function') vcall(['hookOn'], null);
        if (towCar && towCar.parent) towCar.parent.remove(towCar);                    // the car stays in the yard (out of view)
        await say('Here we are! The car is safe in the yard.'); if (!ok()) return;
        const ys = yardScene();
        const q = legQ('add', null, WORDS.yard, 'car'); q.scene = ys; await askScene(q); if (!ok()) return;
        if (LEVELS[level()].sub > 0) { const q2 = legQ('sub', q.answer, WORDS.yard, 'car'); q2.scene = ys; await askScene(q2); }
      } });
    }
    return L;
  }
  function startVehicleJob(kind) {
    const legs = vehicleLegs(kind);
    if (!legs.length) return false;
    const job = { vehicle: kind, legs, stops: legs.map((l) => l.to), index: 0, cash: 0, q: null };
    J.current = job;
    BB.emit('job:new', { job, vehicle: kind });
    say(legs[0].start, { queue: true });
    driveLeg(true);
    return true;
  }
  function driveLeg(quiet) {
    const job = J.current; if (!job || !job.vehicle) return;
    const leg = job.legs[job.index];
    try { BB.bus.closeDoors(); } catch (e) { console.error(e); }   // leaves the scene spot (clears atStop) so it can drive
    if (leg.onGo) leg.onGo();
    setPhase('drive');
    J.stopStart = null;
    BB.bus.stopAt(leg.to, () => arriveLeg(job, leg));
    BB.emit('job:target', { stop: leg.to, job });
    if (!quiet && leg.go) say(leg.go, { queue: true });
  }
  async function arriveLeg(job, leg) {
    if (J.current !== job) return;
    curLeg = leg; leg._qi = 0; leg._qs = leg._qs || [];
    setPhase('stop'); J.lastStop = leg.to;
    BB.sfx.ding();
    const g = ++legGen, ok = () => g === legGen && J.current === job && !BB.bedtime && J.phase !== 'home';
    await wait(900);                         // the scene camera settles
    if (!ok()) return;
    try { await leg.run(ok); } catch (e) { console.error(e); }
    if (!ok()) return;
    await wait(1200);
    scnClear();
    job.index++;
    if (job.index >= job.legs.length) { jobDone(); return; }
    if (timeUp()) { bedtime(); return; }
    driveLeg();
  }

  // ---------- depot trips, low fuel and the tow ----------
  J.goDepot = function (reason) {
    if (J.phase === 'bedtime' || J.phase === 'toDepot' || J.phase === 'depot') return;
    // busy (a stop, a question, the tow) or settling into a stop's bay: go after the stop instead
    const settling = typeof BB.bus.isSettling === 'function' && BB.bus.isSettling();
    if (J.phase === 'question' || J.phase === 'stop' || J.phase === 'tow' || settling) { J.wantDepot = true; return; }
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
  let towTruck = null;
  function getTowTruck() {
    if (towTruck) return towTruck;            // made once and reused for every tow
    towTruck = makeTowTruck();
    return towTruck;
  }
  function makeTowTruck() {
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
    const df = doorFrame(), c = B.pos || df.d;            // just past the bus's nose (the door is near the front)
    const dAlong = (df.d.x - c.x) * fx + (df.d.z - c.z) * fz + 1.3;
    const front = new THREE.Vector3(c.x + fx * dAlong, 0, c.z + fz * dAlong);
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
    }).then(() => { truck.visible = false; truck.scale.setScalar(1); });   // hidden, kept for the next tow
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
    setPhase('tow'); BB.bus.locked = true; BB.bus.go(false);
    J.wantDepot = false;
    await say("Oh! We're out of fuel. Here comes the tow truck!");
    const truck = getTowTruck();
    try { if (truck) await towWithTruck(truck); else await towWithFade(); } catch (e) { console.error(e); await towWithFade(); }
    BB.bus.locked = false;
    if (BB.bedtime) return;
    await say("Let's go!", { queue: true });           // still 'tow': a depot tap now is remembered (wantDepot)
    if (BB.bedtime) return;
    if (timeUp()) { bedtime(); return; }
    setPhase('drive');
    if (J.wantDepot) { J.goDepot('quiet'); return; }
    if (J.current) resumeJob(true); else J.start();
  });

  // ---------- the horn: people nearby jump and wave ----------
  let lastHorn = 0;
  function onHorn() {
    const now = performance.now();
    if (now - lastHorn < 300) return;
    lastHorn = now;
    const bp = BB.bus.pos || (BB.bus.front && BB.bus.front.position);
    for (const m of J.waiting.concat(J.extras, J.walkers.map((w) => w.m))) {
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

  // ---------- Home in the middle of a stop ----------
  // ui.js sets phase 'home' (and hides the card). The stop is put back exactly as it was on arrival: nobody keeps
  // walking on or off, the passengers are back, the same people wait at the stop, and the same question (same story)
  // plays when the job resumes after Play and Drive.
  function rewindStop() {
    const st = J.stopStart; J.stopStart = null;
    if (!st || J.current !== st.job) return;
    stopGen++; seq++;
    for (const w of J.walkers) removePerson(w.m);
    J.walkers = [];
    for (const m of J.extras) removePerson(m);
    J.extras = [];
    tweens.length = 0;
    scene.reset(); hideCount(); clearMarks();
    BB.bus.passengers = st.pax0;
    const q = st.q;
    q.tries = 0; q.done = false; q.onRight = null;
    setWaiting(st.stop, q);
  }

  // ---------- per frame ----------
  J.update = function (dt) {
    if (J.phase === 'home') {
      if (J.stopStart) rewindStop();
      if (J.current && J.current.vehicle && J.stopStart !== false) { legGen++; clearWaiting(); scnClear(); for (const m of J.extras) removePerson(m); J.extras = []; J.walkers = []; }
      return;                                  // nothing walks or boards while the home screen is up
    }
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
    // in the rain, the people with umbrellas at the bonus stop hop and wave as the bus comes near
    if (J.phase === 'drive' && BB.bus.pos) {
      for (const m of J.waiting) {
        const u = m.userData;
        if (!u.waveDown || u.jump > 0) continue;
        if (Math.hypot(m.position.x - BB.bus.pos.x, m.position.z - BB.bus.pos.z) < 45) {
          u.waveT = (u.waveT || Math.random()) - dt;
          if (u.waveT <= 0) { u.waveT = 1.6 + Math.random(); u.jump = 1; u.jumpDelay = 0; }
        }
      }
    }
    // a horn toot: two happy jumps with a wiggle, facing the bus
    const bp = BB.bus.pos;
    for (const m of J.waiting.concat(J.extras, J.walkers.map((w) => w.m))) {
      const u = m.userData;
      if (J.extras.includes(m) && !J.walkers.some((w) => w.m === m)) m.position.y = GROUND;   // standing on the pavement
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
    marks.forEach((sp, i) => { if (sp.visible) placeMark(i); });
    const qq = J.question, canTap = card && J.phase === 'question' && qq && !qq.done;
    scene.setHits(canTap && !vmode() ? BB.clamp(BB.bus.passengers | 0, 0, 10) : 0, (i) => { if (!card) return; if (J.teaching) skipTeach(); else if (J.phase === 'question') countTap(i); });
    if (!vmode() && BB.bus.seats && BB.bus.seats.length >= 10) scene.update(dt);   // vehicles have no seats
    if (countTag && countTag.visible) placeCount();
    for (const sp of (countTag ? marks.concat(countTag) : marks)) {
      if (!sp.visible) continue;
      const u = sp.userData;
      u.pop = Math.max(0, u.pop - dt * 4);
      const s = u.base * (1 + u.pop * 0.5) * (u.pulse ? 1 + Math.sin(now * 6) * 0.12 : 1);
      sp.scale.set(s, s, 1);
    }
  };

  J.init = function () { buildLooks(); buildProps(); BB.later(0, () => { try { buildUpstairs(); } catch (e) { console.error(e); } }); };
})();
