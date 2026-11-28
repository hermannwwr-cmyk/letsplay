/* Bendy Bus 3D: jobs.
   A job = drive to 2-3 stops in turn. At each stop people get on or off and the child answers one adding or
   taking-away question shown with pictures to count: a ten-frame of seats (two rows of five, like the bus's own seats),
   with the friends who got on ringed in mint and the ones who got off left as faded dashed ghosts, and three big
   number buttons in a random order. Seats can be tapped to count aloud ("1, 2, 3...").
   Wrong answer -> Mina the mynah bird (the bus conductor) walks through it step by step: count on for adding, wave
   goodbye and count what's left for taking away, with "5 and 2 more" ten-frame language; the answer buttons are dimmed
   until "Now, which number is it?". The same scene guides the first question of each kind. Tap the card to skip it.
   Hint after 2 wrong tries: the seats glow on the card and numbers glow above the bus's seats.
   Hands-on: while the story is told the child does its "k" part with a finger (BB.hands, hands.js): taps each friend
   aboard or goodbye here, and each vehicle scene has its own moment (hands() in the scene builders).
   Cash: 1 coin per answered stop (never taken away), 2 more for the whole job; coins fly to the
   cash counter. A finished job puts a stamp on the way to a trophy (every 5th job) and shows the wish.
   Also: special trips with themed groups, passenger friends who say hello and goodbye, the fuel pump in the depot
   yard when the tank gets low (the child drives there and drags the nozzle over: a hands-on moment on every ride)
   and the friendly tow, to the pump, when the tank runs dry.
   Exposes BB.jobs = { current, phase, start(), update(dt), busy(), allOff(cb), ... }.
   Every flow timer goes through BB.later / BB.wait (they freeze while the game is held) and every spoken line is
   awaited before the next one, so nothing is cut off. */
(function () {
  'use strict';
  const hypot2 = (a, b) => Math.sqrt(a * a + b * b);   // (Math.hypot is slow and makes garbage on every call)
  const BB = window.BB, P = BB.P;
  const J = BB.jobs = { current: null, phase: 'idle', walkers: [], waiting: [], extras: [], question: null, teaching: false };
  // The hands-on moments (hands.js) are switched off on the buses (the owner's choice: young players didn't see
  // what to do at the bus stops): the people get on and off by themselves. The other rides keep theirs.
  // true brings them back on the buses too.
  const HANDS_ON = false;

  // (slower on purpose, the owner's choice: about 50 coins a day at 15 minutes, so the rides take a few weeks)
  const CASH_STOP = 1, CASH_STOP_RETRY = CASH_STOP, CASH_JOB = 2;   // same coins after a retry: no hidden penalty
  const wait = (ms) => (BB.wait ? BB.wait(ms) : new Promise((r) => BB.later(ms, r)));
  const cancelLater = (t) => { if (t == null) return; if (BB.cancelLater) BB.cancelLater(t); else clearTimeout(t); };
  // Lines queue behind whatever is being said (another part of the game may be talking); our own lines are awaited
  // one after another. Only a child's own tap (counting, skip, say again) cuts in.
  // (while the "Go home?" card is up the story waits, and if the child chose Home it says nothing more)
  const askUp = () => !!(BB.ui && BB.ui.asking && BB.ui.asking());
  const afterAsk = () => new Promise((r) => { const t = setInterval(() => { if (!askUp()) { clearInterval(t); r(); } }, 150); });
  const say = (text, opts) => askUp()
    ? afterAsk().then(() => (J.phase === 'home' || BB.bedtime ? undefined : BB.say(text, opts || { queue: true })))
    : BB.say(text, opts || { queue: true });
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
  J.busy = () => J.phase === 'stop' || J.phase === 'question' || J.phase === 'tow' || J.phase === 'pump';

  // ---------- difficulty ----------
  // Follows how the child is doing (BB.save.skill, 0 to 4.6; its whole part is the level). A right answer at the first
  // try lifts it a little (about three in a row for the next level), a question that needed Mina's walk-through (two
  // wrong tries or more) steps it back about half a level, one wrong try leaves it. Nothing is shown or said about
  // it: the sums just get a little bigger or smaller. Every number stays 0-10, and adding comes before taking away.
  // tot = most people on the bus, kMax = most getting on/off at once, sub = chance of taking away.
  const LEVELS = [
    { kMax: 1, tot: 4, sub: 0 },                 // the very first questions: 2 + 1, then 3 + 1
    { kMax: 2, tot: 6, sub: 0 },
    { kMax: 2, tot: 7, sub: 0.45, subK: 1 },     // taking away starts gently: one gets off
    { kMax: 3, tot: 9, sub: 0.5 },
    { kMax: 4, tot: 10, sub: 0.5, zero: true },  // now and then everybody gets off: 0 left
  ];
  const SKILL_MAX = LEVELS.length - 1 + 0.6, SKILL_UP = 0.4, SKILL_DOWN = 0.6;
  // (saves from before the skill existed start at the level their number of answered questions had reached)
  if (typeof BB.save.skill !== 'number' || !isFinite(BB.save.skill)) { const q0 = BB.save.questions | 0; BB.save.skill = q0 < 2 ? 0 : q0 < 4 ? 1 : q0 < 7 ? 2 : q0 < 11 ? 3 : 4; }
  BB.save.skill = Math.max(0, Math.min(SKILL_MAX, BB.save.skill));
  const level = () => Math.max(0, Math.min(LEVELS.length - 1, Math.floor(BB.save.skill + 1e-6)));
  J.level = level;
  // after a right answer: tries = wrong tries before it
  function learn(q) {
    const t = q.tries | 0, s0 = +BB.save.skill || 0;
    BB.save.skill = Math.max(0, Math.min(SKILL_MAX, t === 0 ? s0 + SKILL_UP : t >= 2 ? s0 - SKILL_DOWN : s0));
    J.sinceZero = q.answer === 0 ? 0 : (J.sinceZero == null ? 9 : J.sinceZero) + 1;
  }
  // "0 left" (everybody off) is a special one: not again within the next few questions
  const zeroOk = () => J.sinceZero == null || J.sinceZero >= 4;
  const qKey = (q) => q.kind + q.n + '/' + q.k;

  // n0 = passengers on the bus now. Returns {kind, pre, n, k, answer, choices}.
  // pre: people who get on (> 0) or off (< 0) first, without a question, so the question starts from a good group.
  function makeQuestion(n0, avoid) {
    const lv = level(), L = LEVELS[lv], first = !(BB.save.questions | 0);
    // A fair mix: an empty bus (the first stop of a job) always picks people up; never more than two taking-away
    // questions in a row, nor more than three adding ones (J.kinds = the last bus questions answered).
    const hist = J.kinds || [], last = (k, c) => hist.length >= c && hist.slice(-c).every((x) => x === k);
    const want = !(L.sub > 0) || n0 === 0 || last('sub', 2) ? 'add' : last('add', 3) ? 'sub' : null;
    let q = null;
    for (let tries = 0; tries < 60 && !q; tries++) {
      const free = tries > 10;                   // after a few tries, also change who is on the bus first
      const kind = want && tries < 50 ? want : Math.random() < L.sub ? 'sub' : 'add';
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
      if (c.answer === 0 && !zeroOk()) continue;
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

  // ---------- special trips (at most about 1 job in 3, from the 4th job on) ----------
  // A themed group gets on at the first stop (that is the question: "3 children get on") and gets off at the second,
  // each with their own thing (a school bag, a suitcase, a balloon...), which they still carry when they get off.
  // dir 'from': the group waits at the place itself (the airport, the beach, the market) and goes on to another stop;
  // dir 'to': they wait at a stop near the place and the second stop is the place (the playground, the big wheel, the
  // hawker centre). when: only at that time of day. pick: the line for the first stop; take: the line for the drive to
  // the place ('to' trips); drop: their goodbye at the end; done: the job-done line.
  const THEMES = {
    school: { dir: 'to', place: /playground/i, alt: /park|garden/i, word: ['child', 'children'], prop: 'bag', kid: true, when: () => morning(),
      pick: (st) => `School trip! Good morning! Pick up the children at ${st.say}!`, take: (st) => `Now take the children to ${st.say}!`,
      drop: 'Here we are! Have fun, children!', done: 'School trip done! Great driving!' },
    airport: { dir: 'from', place: /airport/i, word: ['traveller', 'travellers'], prop: 'case',
      pick: (st) => `Airport rush! The planes have landed! Drive to ${st.say}!`, drop: 'Welcome to the city! Have a lovely trip!', done: 'Airport rush done! Great driving!' },
    party: { dir: 'from', place: /beach/i, alt: /park/i, word: ['party friend', 'party friends'], prop: 'balloon',
      pick: (st) => `Party bus! A birthday group is waiting at ${st.say}!`, drop: 'Happy birthday! Bye bye!', done: 'Party bus done! Hooray!' },
    market: { dir: 'from', place: /market/i, word: ['shopper', 'shoppers'], prop: 'shop', when: () => !nightNow(),
      pick: (st) => `Market day! The shoppers are waiting at ${st.say} with full bags!`, done: 'Market day done! Great driving!',
      drop: () => (dayT() > 0.55 ? 'Thank you, Captain! Time to cook dinner!' : 'Thank you, Captain! What a lot of shopping!') },
    wheel: { dir: 'to', place: /wheel/i, word: ['visitor', 'visitors'], prop: 'camera',
      pick: (st) => `Big wheel trip! Pick up the visitors at ${st.say}!`, take: (st) => `Now take the visitors to ${st.say}!`,
      drop: 'Have fun on the big wheel! Wheee!', done: 'Big wheel trip done! Great driving!' },
    lunch: { dir: 'to', place: /hawker/i, word: ['hungry friend', 'hungry friends'], when: () => midday(),
      pick: (st) => `Lunch time! Pick up the hungry friends at ${st.say}!`, take: (st) => `Now take them to ${st.say}! Yum yum!`,
      drop: 'Enjoy your lunch! Yum yum!', done: 'Lunch trip done! Great driving!' },
  };
  const stopLike = (re) => (BB.world.stops || []).find((s) => s && !s.minor && re.test((s.id || '') + ' ' + (s.name || '') + ' ' + (s.pic || '')));
  const dayT = () => { const d = BB.world && BB.world.day; return d && typeof d.t === 'number' ? d.t : -1; };
  const nightNow = () => { const W = BB.world; return !!(W && typeof W.night === 'function' && +W.night() > 0.3); };
  function morning() { const t = dayT(); return !nightNow() && t >= 0.03 && t <= 0.3; }
  function midday() { const t = dayT(); return !nightNow() && t > 0.3 && t <= 0.55; }
  function pickTheme() {
    if (level() < 1 || (BB.save.jobsDone | 0) < 3) return null;     // the first jobs stay close to home
    if ((J.sinceSpecial == null ? 2 : J.sinceSpecial) < 2 || Math.random() > 0.5) return null;
    if (friendsOut()) return null;                                  // friends are out driving: stay with them (no themed trip away)
    // only when the place is near enough by road (about 400 units), so no long trip across the map; a different
    // trip from the last one while there are others
    const here = BB.bus.atStop || J.lastStop, from = here && okStop(here) ? here : null;
    const ok = [];
    for (const id in THEMES) {
      const T = THEMES[id], st = themeStop(id);
      if (!st || st === here || (T.when && !T.when())) continue;
      if (stopDist(from, st) <= 400) ok.push(id);
    }
    const fresh = ok.filter((id) => id !== J.lastTheme);
    return fresh.length ? BB.pick(fresh) : ok.length ? BB.pick(ok) : null;
  }
  function themeStop(id) {
    const T = THEMES[id]; if (!T) return null;
    return stopLike(T.place) || (T.alt ? stopLike(T.alt) : null);
  }
  // a 'to' trip's pick-up: a stop a short drive before the place (40-130 road units to it, a little more where stops
  // are few), one of the two nearest to the bus
  function pickupFor(place, here) {
    const from = here && okStop(here) ? here : null, out = [];
    for (const s of BB.world.stops || []) {
      if (!okStop(s) || s === place || s === here || s.say === place.say) continue;
      const d = stopDist(s, place);
      if (d >= 40 && d <= 220) out.push({ s, d: stopDist(from, s), near: d <= 130 });
    }
    const best = out.filter((o) => o.near).length ? out.filter((o) => o.near) : out;
    best.sort((a, b) => a.d - b.d);
    return best.length ? BB.pick(best.slice(0, 2)).s : null;
  }
  // a short original "good morning" jingle (C major, up and down)
  function jingle() {
    if (typeof BB.tone !== 'function') return;
    const f = (semi) => 440 * Math.pow(2, (semi - 9) / 12);
    [12, 16, 19, 24, 19, 24].forEach((n, i) => { try { BB.tone(f(n), i === 5 ? 0.4 : 0.16, { type: 'triangle', vol: 0.08, at: i * 0.15 }); } catch (e) { /* no sound */ } });
  }

  // ---------- people (low-poly, one mesh each, shared geometries) ----------
  const LOOKS = [], LOOK_DATA = [];
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
      LOOK_DATA.push({ shirt: shirts[i], skin: skins[i % skins.length], hair: hairs[i % hairs.length], kid });
    }
  }
  // style: { kid, prop: 'bag'|'case'|'balloon'|'umbrella'|'cat'|'kite'|'durian'|'paper', geo (a friend's own look) }
  const KID_LOOKS = [2, 5];
  // style.look ({shirt, skin, hair, kid}) dresses them exactly (someone getting off looks like whoever sat in that seat);
  // style.seat = the seat they will take (a traveller's suitcase then has that seat's colour, like on the card).
  const lookGeos = {};
  function lookGeo(L) { const k = [L.shirt, L.skin, L.hair, L.kid ? 1 : 0, L.bun ? 1 : 0, L.hat ? 1 : 0].join(); return lookGeos[k] || (lookGeos[k] = friendGeo(L)); }
  function person(i, style) {
    style = style || {};
    const li = (style.kid ? KID_LOOKS[i % 2] : i) % LOOKS.length;
    let geo = style.geo || (style.look ? lookGeo(style.look) : LOOKS[li]);
    // their thing is part of their own mesh (one draw call for a person and a bag, so a group of four shoppers costs
    // no more than four people); only a balloon is its own mesh, because it floats off and pops
    const pg = style.prop && PROPS[style.prop] ? (style.prop === 'case' && style.seat != null ? caseGeo(bagColor(style.seat)) : PROPS[style.prop]) : null;
    const both = pg && style.prop !== 'balloon' ? withProp(geo, pg, style.kid ? 0.72 : 1) : null;
    if (both) geo = both;
    const m = new THREE.Mesh(geo, BB.mk.mat); m.name = 'person'; BB.scene.add(m);
    m.userData.look = style.look || style.lookData || LOOK_DATA[li];
    if (pg) {
      if (!both) {
        const pm = new THREE.Mesh(pg, BB.mk.mat); pm.name = 'prop';
        if (style.kid) pm.scale.setScalar(0.72);
        m.add(pm); m.userData.prop = pm;
      }
      m.userData.propKind = style.prop; m.userData.propSeat = style.seat;
    }
    if (style.friend) m.userData.friend = style.friend;
    return m;
  }
  // a person's mesh with their thing merged in (k: the thing's scale, 0.72 for a child), made once per pair
  const withGeos = new Map();
  function withProp(geo, pg, k) {
    const key = geo.uuid + '|' + pg.uuid + '|' + k;
    if (withGeos.has(key)) return withGeos.get(key);
    const A = geo.attributes, B = pg.attributes;
    let out = null;
    if (!geo.index && !pg.index && A.position && B.position && A.normal && B.normal && A.color && B.color &&
        A.position.array instanceof Float32Array && B.position.array instanceof Float32Array &&
        A.normal.array.constructor === B.normal.array.constructor && A.color.array.constructor === B.color.array.constructor) {
      const cat = (a, b, scale) => { const r = new a.constructor(a.length + b.length); r.set(a); if (scale === 1) r.set(b, a.length); else for (let j = 0; j < b.length; j++) r[a.length + j] = b[j] * scale; return r; };
      out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(cat(A.position.array, B.position.array, k), 3));
      out.setAttribute('normal', new THREE.BufferAttribute(cat(A.normal.array, B.normal.array, 1), 3, A.normal.normalized));
      out.setAttribute('color', new THREE.BufferAttribute(cat(A.color.array, B.color.array, 1), 3, A.color.normalized));
      out.computeBoundingSphere();
    }
    withGeos.set(key, out);
    return out;
  }

  // ---------- props and the passenger friends ----------
  // Suitcases: suitcase i (the card's picture, a taxi's bag, the traveller who takes seat i) has the same colour
  // everywhere, so a child can match each one on the card with the one in the street.
  const BAG_COLS = [P.coral, P.teal, P.honey, P.berry, P.plum, P.leaf, P.rose, '#f28b4b', '#4cb5a0', '#e0607e'];
  const bagColor = (i) => BAG_COLS[((i | 0) * 3 + 1) % 10];
  const caseGeos = {};
  function caseGeo(c) {
    if (caseGeos[c]) return caseGeos[c];
    const b = BB.mk.builder();
    b.box(0.44, 0.6, 0.26, c, 0.66, 0.04, 0); b.box(0.44, 0.07, 0.27, P.honeyLight, 0.66, 0.32, 0); b.box(0.07, 0.24, 0.07, '#3a2a3c', 0.66, 0.64, 0);
    return (caseGeos[c] = b.geometry());
  }
  // Props are tiny merged meshes in the people's paper-cut colours (y is the bottom of a box/cylinder, a ball's centre).
  const PROPS = {};
  function buildProps() {
    const mk = (fn) => { const b = BB.mk.builder(); fn(b); return b.geometry(); };
    PROPS.bag = mk((b) => { b.box(0.46, 0.52, 0.2, P.coral, 0, 0.74, -0.32); b.box(0.36, 0.12, 0.04, P.honeyLight, 0, 0.92, -0.43); });
    PROPS.case = caseGeo(P.berry);
    PROPS.balloon = mk((b) => { b.cyl(0.015, 0.015, 1.3, 4, '#fff6e0', 0.4, 1.0, 0); b.ball(0.32, P.rose, 0.4, 2.62, 0, 1, 0.92, 1.12, 0.92); b.ball(0.06, '#ff6f91', 0.4, 2.26, 0); });
    PROPS.umbrella = mk((b) => { b.cyl(0.03, 0.03, 1.5, 4, '#3a2a3c', 0.32, 1.1, 0); b.cyl(0.06, 0.9, 0.38, 8, P.teal, 0.32, 2.5, 0); b.cyl(0.2, 0.06, 0.12, 8, '#127a71', 0.32, 2.88, 0); });
    PROPS.cat = mk((b) => {
      b.box(0.5, 0.32, 0.36, P.woodLight, 0.52, 0.58, 0.12); b.box(0.52, 0.06, 0.38, P.wood, 0.52, 0.9, 0.12);
      b.ball(0.15, '#f28b4b', 0.52, 1.05, 0.12); b.box(0.06, 0.1, 0.04, '#f28b4b', 0.45, 1.13, 0.12); b.box(0.06, 0.1, 0.04, '#f28b4b', 0.59, 1.13, 0.12);
    });
    PROPS.kite = mk((b) => { b.box(0.62, 0.62, 0.04, P.coral, 0.75, 2.55, -0.3, 0, 0, Math.PI / 4); b.box(0.04, 0.62, 0.05, P.honeyLight, 0.75, 2.55, -0.3, 0, 0, Math.PI / 4); b.cyl(0.012, 0.012, 1.5, 4, '#fff6e0', 0.48, 1.0, -0.15); });
    PROPS.durian = mk((b) => { b.ball(0.2, '#8bbf3a', 0.44, 0.98, 0.22, 0); b.ball(0.17, '#6fa52e', 0.46, 1.01, 0.25, 0, 1.15, 1.15, 1.15); b.box(0.04, 0.1, 0.04, '#9b6238', 0.44, 1.15, 0.22); });
    PROPS.paper = mk((b) => { b.box(0.52, 0.38, 0.03, '#f4f1ea', 0, 1.12, 0.34); b.box(0.42, 0.05, 0.035, '#8a8290', 0, 1.38, 0.34); b.box(0.3, 0.05, 0.035, '#8a8290', -0.04, 1.26, 0.34); });
    // a bunch of flowers in a paper cone, held in front
    PROPS.flowers = mk((b) => {
      b.cyl(0.13, 0.03, 0.36, 6, '#fff6e0', 0.24, 0.86, 0.3);
      b.ball(0.07, P.leaf, 0.15, 1.24, 0.34); b.ball(0.07, P.leaf, 0.33, 1.22, 0.28);
      b.ball(0.095, P.rose, 0.18, 1.3, 0.28); b.ball(0.095, P.honey, 0.3, 1.32, 0.33); b.ball(0.085, P.plum, 0.24, 1.36, 0.24);
    });
    // a little bird cage with a yellow songbird, hanging from the hand by its hook
    PROPS.cage = mk((b) => {
      const cx = 0.56, wood = '#b98a52';
      b.cyl(0.2, 0.21, 0.06, 8, wood, cx, 0.5, 0);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; b.box(0.025, 0.42, 0.025, '#d9b57f', cx + Math.cos(a) * 0.18, 0.56, Math.sin(a) * 0.18); }
      b.cyl(0.19, 0.19, 0.04, 8, wood, cx, 0.97, 0);
      b.ball(0.19, '#d9b57f', cx, 1.0, 0, 0, 1, 0.42, 1);
      b.box(0.03, 0.16, 0.03, '#8a6a3a', cx, 1.06, 0);
      b.box(0.3, 0.025, 0.025, wood, cx, 0.68, 0);
      b.ball(0.075, '#ffd45c', cx, 0.79, 0, 0, 1.15, 1, 1); b.ball(0.05, '#ffd45c', cx + 0.06, 0.87, 0); b.box(0.04, 0.025, 0.03, '#f28b4b', cx + 0.11, 0.86, 0);
    });
    // a football held at the side
    PROPS.ball = mk((b) => {
      const x = 0.5, y = 1.0, z = 0.12;
      b.ball(0.2, '#fffdf6', x, y, z, 1);
      for (const [dx, dy, dz] of [[0.17, 0.02, 0], [0, 0.17, 0.04], [0.02, 0.0, 0.18], [-0.1, -0.12, 0.1], [0.1, -0.1, -0.1]]) b.ball(0.065, '#3a2a3c', x + dx, y + dy, z + dz, 0, 1, 1, 1);
    });
    // a cake box with a ribbon and a bow, carried in front with both hands
    PROPS.cake = mk((b) => {
      b.box(0.52, 0.32, 0.4, '#ffe4ec', 0, 0.86, 0.42);
      b.box(0.08, 0.33, 0.41, P.rose, 0, 0.86, 0.42); b.box(0.53, 0.33, 0.08, P.rose, 0, 0.86, 0.42);
      b.ball(0.07, P.rose, -0.06, 1.22, 0.42, 0, 1.2, 0.8, 0.8); b.ball(0.07, P.rose, 0.06, 1.22, 0.42, 0, 1.2, 0.8, 0.8);
    });
    // a market shopping bag with greens sticking out
    PROPS.shop = mk((b) => {
      b.box(0.34, 0.4, 0.22, '#e9c48f', 0.52, 0.6, 0.04); b.box(0.35, 0.06, 0.23, '#d1a56b', 0.52, 0.94, 0.04);
      b.box(0.03, 0.16, 0.03, '#b98a52', 0.42, 1.0, 0.04); b.box(0.03, 0.16, 0.03, '#b98a52', 0.62, 1.0, 0.04); b.box(0.23, 0.03, 0.03, '#b98a52', 0.52, 1.14, 0.04);
      b.ball(0.11, P.leaf, 0.45, 1.04, 0.06); b.ball(0.09, '#8bbf3a', 0.58, 1.06, 0.0); b.cyl(0.0, 0.05, 0.26, 5, '#f28b4b', 0.55, 0.96, 0.1);
    });
    // a camera on a strap, at the chest
    PROPS.camera = mk((b) => {
      b.box(0.3, 0.19, 0.1, '#3a3f4a', 0, 1.24, 0.31); b.box(0.08, 0.05, 0.08, '#3a3f4a', -0.08, 1.43, 0.31);
      b.cyl(0.065, 0.075, 0.1, 8, '#1f2228', 0.03, 1.28, 0.33, 0, Math.PI / 2); b.ball(0.04, '#9fd4f2', 0.03, 1.335, 0.42);
      b.box(0.02, 0.5, 0.02, '#c84a3c', -0.13, 1.3, 0.24, 0, 0, -0.25); b.box(0.02, 0.5, 0.02, '#c84a3c', 0.13, 1.3, 0.24, 0, 0, 0.25);
    });
  }
  // Recurring passenger friends (generic, the game's own people style). Met once -> BB.save.friendsMet, 'friend:met'.
  // Each has their own thing (prop), says what they're up to when they get on (hi: two short lines, taken in turn,
  // so the hello stays about 3 s) and their own goodbye when they get off (bye), wherever that is: at the end of the
  // job, or as one of the people getting off at a stop. The grown-ups also take the taxi home with their bags
  // (taxi: [hello, goodbye]); the children don't ride a taxi on their own.
  const FRIENDS = [
    { id: 'granny', name: 'Granny Mei', prop: 'cat', look: { shirt: P.plum, skin: '#f1c7a0', hair: '#e8e4dc', bun: true },
      hi: ['Whiskers and I are visiting my sister!', 'Whiskers loves the bus!'], bye: 'Thank you, dear! Bye bye, Whiskers!',
      taxi: ['Whiskers and I had a holiday! Home, please!', 'Thank you, dear! Home sweet home!'] },
    { id: 'kai', name: 'Kai', prop: 'kite', look: { shirt: '#f28b4b', skin: '#d9a679', hair: '#1f1b22', kid: true },
      hi: ["I'm going to fly my kite!", 'Look at my new kite!'], bye: 'Bye, Captain! Up, up, kite!' },
    { id: 'rose', name: 'Auntie Rose', prop: 'durian', look: { shirt: P.leaf, skin: '#a8714a', hair: '#3a2a2c', bun: true },
      hi: ['Pooh! My durian is smelly!', 'I bought a big durian!'], bye: 'Thank you, Captain! Durian for dinner!',
      taxi: ['I did lots of shopping! Home, please!', 'Thank you, Captain! Durian for dinner!'] },
    { id: 'tan', name: 'Uncle Tan', prop: 'paper', look: { shirt: '#9fb6c8', skin: '#f5d3b5', hair: '#8a8290' },
      hi: ['I read my paper on the bus!', 'What a lovely day for a ride!'], bye: 'Thank you, Captain! Have a lovely day!',
      taxi: ['My bags are so heavy! Home, please!', 'Thank you, Captain! Have a lovely day!'] },
    { id: 'lily', name: 'Lily', prop: 'flowers', look: { shirt: '#ff8fab', skin: '#f1c7a0', hair: '#6b4a2e', kid: true, bun: true },
      hi: ['These flowers are for Grandma!', 'I picked flowers for Grandma!'], bye: 'Bye bye, Captain! Grandma will love them!' },
    { id: 'lee', name: 'Grandpa Lee', prop: 'cage', look: { shirt: '#e9c46a', skin: '#7a4b2e', hair: '#e8e4dc' },
      hi: ['My bird loves the bus! Tweet tweet!', 'My little bird sings on the bus!'], bye: 'Thank you, Captain! Tweet tweet!',
      taxi: ['My bird and I are going home! Tweet tweet!', 'Thank you, Captain! Tweet tweet!'] },
    { id: 'siti', name: 'Coach Siti', prop: 'ball', look: { shirt: P.teal, skin: '#d9a679', hair: '#1f1b22', bun: true },
      hi: ["Football time! Let's go!", 'I have a football match!'], bye: 'Thanks, Captain! Goal!',
      taxi: ['Football camp is over! Home, please!', 'Thanks, Captain! Goal!'] },
    { id: 'wong', name: 'Chef Wong', prop: 'cake', look: { shirt: '#fffdf6', skin: '#f5d3b5', hair: '#1f1b22', hat: true },
      hi: ['I baked a birthday cake! Drive gently!', 'Mind my cake, Captain!'], bye: 'Thank you, Captain! Happy birthday, everybody!',
      taxi: ['I bought food for my kitchen! Home, please!', 'Thank you, Captain! Yum yum!'] },
  ];
  J.FRIENDS = FRIENDS.map((f) => ({ id: f.id, name: f.name, prop: f.prop, look: f.look }));
  function friendGeo(L) {
    const b = BB.mk.builder(), s = L.kid ? 0.72 : 1, pants = '#4a5a78';
    b.box(0.22 * s, 0.8 * s, 0.24 * s, pants, -0.13 * s, 0, 0); b.box(0.22 * s, 0.8 * s, 0.24 * s, pants, 0.13 * s, 0, 0);
    b.cyl(0.26 * s, 0.32 * s, 0.85 * s, 6, L.shirt, 0, 0.78 * s, 0);
    b.ball(0.27 * s, L.skin, 0, 1.9 * s, 0);
    b.ball(0.28 * s, L.hair, 0, 2.0 * s, -0.05 * s, 0, 1, 0.7, 1);
    if (L.bun) b.ball(0.13 * s, L.hair, 0, 2.18 * s, -0.24 * s);
    if (L.hat) { b.cyl(0.24 * s, 0.22 * s, 0.24 * s, 8, '#ffffff', 0, 2.08 * s, 0); b.ball(0.3 * s, '#ffffff', 0, 2.4 * s, 0, 0, 1, 0.62, 1); }   // a chef's hat
    b.box(0.12 * s, 0.6 * s, 0.14 * s, L.shirt, -0.36 * s, 0.95 * s, 0); b.box(0.12 * s, 0.6 * s, 0.14 * s, L.shirt, 0.36 * s, 0.95 * s, 0);
    return b.geometry();
  }
  // Which friend gets on next: one not met yet when there is one (the sticker book fills up), never the one who
  // rode last time while there are others.
  // grownUp: only a friend who can take a taxi on their own
  function pickFriend(grownUp) {
    const all = grownUp ? FRIENDS.filter((f) => f.taxi && !f.look.kid) : FRIENDS;
    const met = friendsMet(), fresh = all.filter((f) => !met.includes(f.id));
    let pool = fresh.length && Math.random() < 0.8 ? fresh : all;
    const other = pool.filter((f) => f.id !== J.lastFriend); if (other.length) pool = other;
    const f = BB.pick(pool); J.lastFriend = f.id;
    return f;
  }
  // "Hi, Captain! I'm Kai! I'm going to fly my kite!" (met before: "Hello again! It's Kai! Look at my new kite!")
  // taxi: their taxi hello ("... Home, please!")
  const hiTurn = {};
  function friendHello(f, taxi) {
    const first = meetFriend(f.id);
    let hi;
    if (taxi && f.taxi) hi = f.taxi[0];
    else { const i = hiTurn[f.id] = first ? 0 : ((hiTurn[f.id] == null ? 0 : hiTurn[f.id]) + 1) % f.hi.length; hi = f.hi[i]; }
    return first ? `Hi, Captain! I'm ${f.name}! ${hi}` : `${BB.pick(['Hello again!', 'Hi, Captain!', 'Hello, my friend!'])} It's ${f.name}! ${hi}`;
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
  function friendStyle(f) { if (!f.geo) f.geo = friendGeo(f.look); return { geo: f.geo, lookData: f.look, prop: f.prop, kid: !!f.look.kid, friend: f.id }; }
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
    const ol = hypot2(ox, oz);
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
    if (stop) stop.queue = 0;
    if (!stop || !q) return;
    const pre = Math.max(0, q.pre), total = pre + (q.kind === 'add' ? q.k : 0);
    // (the stop view leaves the queue its strip of pavement, bus.js: so many places long)
    stop.queue = total ? Math.min(4, Math.max(q.kind === 'add' ? q.k : 1, Math.ceil(total / 2))) : 0;
    const friendAt = q.friend && q.kind === 'add' ? total - 1 : -1;
    for (let i = 0; i < total; i++) {
      let style = i < pre ? q.preStyle : q.style;
      if (i === friendAt) { const f = FRIENDS.find((x) => x.id === q.friend); if (f) style = friendStyle(f); }
      if (q.bonus) style = Object.assign({}, style || {}, { prop: style && style.prop ? style.prop : 'umbrella' });
      if (style && style.prop === 'case') style = Object.assign({}, style, { seat: q.n - pre + i });   // the seat they'll take
      const m = person(BB.randInt(0, 7), style);
      if (q.bonus) m.userData.waveDown = true;
      // one clear line along the pavement just past the shelter, nearest first, so every person can be counted
      const along = 3.4 + i * 0.95, off = -1.0;     // negative = toward the road, in front of the shelter
      m.position.set(stop.pos.x + stop.fwd.x * along + stop.side.x * off, GROUND, stop.pos.z + stop.fwd.z * along + stop.side.z * off);
      m.rotation.y = Math.atan2(-stop.side.x, -stop.side.z);
      m.userData.pre = i < pre;
      if (q.group && i >= pre) m.userData.group = true;            // (one of the themed group: "children", "shoppers")
      m.userData.seed = Math.random() * 6;
      J.waiting.push(m);
    }
  }
  // Walk a person to a point at a gentle pace. Resolves on arrival.
  function walkTo(m, to, speed = 3.3, opts = {}) {
    // (someone already on their way somewhere else changes course: never two walks pulling at one person)
    for (let i = J.walkers.length - 1; i >= 0; i--) if (J.walkers[i].m === m) { const w = J.walkers[i]; J.walkers.splice(i, 1); if (w.done) w.done(); }
    return new Promise((resolve) => {
      const from = m.position.clone(), dist = hypot2(to.x - from.x, to.z - from.z);
      J.walkers.push({ m, from, to: to.clone(), t: 0, dur: Math.max(0.35, dist / speed), done: resolve, shrink: !!opts.shrink });
    });
  }
  // Who sits where, beyond their colours (bus jobs): job.seats[i] = { friend: id } or { prop, kid }, so whoever gets
  // off from seat i is the same person again, still carrying their school bag, suitcase or balloon (and a friend says
  // their own goodbye). Seats always fill and empty from the top, so a record stays with its seat.
  function noteSeat(seat, m) {
    const job = J.current; if (!job || job.vehicle || seat < 0) return;
    const u = m.userData, seats = job.seats || (job.seats = {});
    if (u.friend) seats[seat] = { friend: u.friend };
    else if (u.propKind || u.group) seats[seat] = { prop: u.propKind || null, kid: !!(u.look && u.look.kid), seat: u.propSeat, group: !!u.group };   // (seat: a suitcase's colour)
    else delete seats[seat];
  }
  // One person gets on: walk to the door, step in, and appear in the next seat (the bus draws seated heads by count).
  async function boardOne(m, onSeat) {
    await walkTo(m, doorOut());
    await walkTo(m, doorIn(), 2.8);
    removePerson(m);
    BB.bus.passengers = BB.clamp((BB.bus.passengers | 0) + 1, 0, 10);
    if (m.userData.look && typeof BB.bus.setSeatLook === 'function') BB.bus.setSeatLook(BB.bus.passengers - 1, m.userData.look);   // the same colours in the seat
    noteSeat(BB.bus.passengers - 1, m);
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
    // whoever sat there gets off: a friend as themselves (their goodbye comes when the stop allows it), anyone else
    // in that seat's colours with the thing they got on with
    const job = J.current, rec = job && job.seats && job.seats[seat];
    if (rec) {
      delete job.seats[seat];
      const f = rec.friend && FRIENDS.find((x) => x.id === rec.friend);
      if (f) { style = Object.assign(friendStyle(f), style && style.onPop ? { onPop: style.onPop } : {}); job.friendBye = f; }
      else if (rec.prop && !(style && style.geo)) style = Object.assign({}, style || {}, { prop: rec.prop, kid: rec.kid, seat: rec.seat != null ? rec.seat : seat });
    }
    const sl = typeof BB.bus.seatLook === 'function' ? BB.bus.seatLook(seat) : null;
    const m = person(BB.randInt(0, 7), sl && !(style && style.geo) ? Object.assign({}, style || {}, { look: sl }) : style);
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
  // The camera as it will stand at this stop (BB.bus.stopView(): the planned view), so people are placed for the
  // picture the child will see, not for a camera still swinging round from behind the bus.
  const qCam = new THREE.PerspectiveCamera(50, 1, 0.5, 900);
  function viewCam() {
    const v = typeof BB.bus.stopView === 'function' ? BB.bus.stopView() : null, cam = BB.camera;
    if (!v || !v.pos) return cam;
    qCam.fov = v.fov || cam.fov; qCam.aspect = cam.aspect; qCam.near = cam.near; qCam.far = cam.far; qCam.updateProjectionMatrix();
    qCam.position.copy(v.pos); qCam.lookAt(v.look); qCam.updateMatrixWorld(true);
    return qCam;
  }
  // A spot on the pavement for the k-th person who got off: in view of the stop camera, clear of the seats (so the
  // count on the bus stays readable) and of the question card, nearest the exit door first. Works for every bus
  // type and screen size because it is worked out on screen; falls back to a spot next to the exit door.
  function waveSpot(k) { return freeSpot(J.extras.map((m) => m.userData.spot).filter(Boolean), false, kerbSpot(1.7 + (k % 2) * 0.5, -0.8 - k * 0.9, true)); }
  // Where the question card stands on screen: where it is, else where it stood last time at this screen size, else
  // its usual place (the stop view and the queue are planned before the card shows)
  let cardSeen = null;
  function cardRect() {
    const W = innerWidth, H = innerHeight, key = W + 'x' + H, c = document.querySelector('.bbq:not(.out)');
    if (c) { const r = c.getBoundingClientRect(); if (r.width > 0) cardSeen = { key, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }
    if (cardSeen && cardSeen.key === key) return cardSeen;
    return H <= 520 ? { left: 0, top: 0, right: Math.min(345, W * 0.42), bottom: H } : { left: W / 2 - 440, top: H - 250, right: W / 2 + 440, bottom: H };
  }
  // A free pavement spot in view (not over the seats, not under the card, not on another person), nearest the front
  // door (front) or the exit door. With no card yet, the card's usual place is kept clear.
  function freeSpot(taken, front, fallback) {
    try {
      const W = innerWidth, H = innerHeight, cam = viewCam();
      const proj = (p) => { const q = p.clone().project(cam); return q.z > 1 ? null : [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H]; };
      // the seats' box on screen (with a margin)
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < 10; i++) {
        const a = BB.bus.seatWorld(i, new THREE.Vector3());
        for (const dy of [0, 1.5]) { const s2 = proj(new THREE.Vector3(a.x, a.y + dy, a.z)); if (s2) { x0 = Math.min(x0, s2[0]); x1 = Math.max(x1, s2[0]); y0 = Math.min(y0, s2[1]); y1 = Math.max(y1, s2[1]); } }
      }
      const seatBox = [x0 - 30, y0 - 40, x1 + 30, y1 + 20];
      const cr = cardRect();
      const hit = (r, b) => b && r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1];
      const exit = doorFrame(true), frontD = doorFrame(false);
      const queue = front ? [] : J.waiting.map((m) => m.userData.spot).filter(Boolean);    // (people getting off never stand among the friends waiting to get on)
      const span = front ? 0 : (exit.d.x - frontD.d.x) * frontD.fx + (exit.d.z - frontD.d.z) * frontD.fz;   // the door, along the bus
      const cands = [];
      // (along the whole bus and a little past both ends: when the stop view is close and cuts the tail off, there is
      // still room in front of the nose; the nearest spot to the door wins)
      // dip = how much of a person may be hidden by the card: their shoes; or, where the view is so close that the
      // whole pavement lies behind the card, their legs (better than standing in front of a seated friend)
      for (const dip of [0.14, 0.5]) {
        for (const out of [2.4, 3.4, 1.6, 4.4]) {
          for (let along = Math.max(span + 4, 6); along >= span - (front ? 24 : 14); along -= 0.9) {   // (the queue may stand well back on a small screen, where the card covers the door: every friend must be seen, they are tapped aboard)
            const p = kerbSpot(out, along, false);
            const foot = proj(p), head = proj(new THREE.Vector3(p.x, p.y + 2.3, p.z));
            if (!foot || !head) continue;
            const tall = foot[1] - head[1];
            if (tall > H * 0.45) continue;                        // (nobody looms huge in the foreground)
            const r = [Math.min(foot[0], head[0]) - 18, head[1] - 50, Math.max(foot[0], head[0]) + 18, foot[1] - tall * dip];
            if (r[0] < 10 || r[2] > W - 10 || r[1] < 60 || r[3] > H - 4) continue;
            if (hit(r, seatBox) || (cr && hit(r, [cr.left, cr.top, cr.right, cr.bottom]))) continue;
            if (taken.some((t) => t.distanceTo(p) < 0.85) || queue.some((t) => t.distanceTo(p) < 1.6)) continue;
            cands.push({ p, d: Math.abs(along - span) + (out - 2.4) * (out - 2.4) });
          }
        }
        if (cands.length) break;
      }
      if (!cands.length) return fallback;
      cands.sort((a, b) => a.d - b.d);
      return cands[0].p;
    } catch (e) { return fallback; }
  }
  // The queue: a tidy row on the pavement where the stop view shows every one of them, nobody in front of a seated
  // friend (the count on the bus stays readable), nobody under the card or cut by the screen's edge. On a tablet (the
  // card along the bottom) the row runs ahead of the front door, beside the bus's nose; on a phone (the card on the
  // left) in front of the bus from its door back, heads below the seated friends' laps. bus.js leaves that strip of
  // pavement room in the stop view (stop.queue). minPx = the room each one needs on screen: the tap ring when they
  // are to be waved aboard (so the rings never overlap), less for a plain queue; a long queue stands two deep.
  // Returns n spots, or null when no such row fits (the nearest free spots are used instead).
  // fr (bus.js, while it plans a stop view): { cam, seat(i, v), kerb(out, along) } for the bus in its settled place;
  // strict: 'feet' = only rows with every friend's feet (and the ring round them) in view, 'toes' = or a toe hidden;
  // blind = a lamp post or a sign may stand in front of someone (when nothing else fits)
  function queueRow(n, minPx, fr, strict, blind) {
    const W = innerWidth, H = innerHeight, cam = fr ? fr.cam : viewCam(), phone = H <= 520;
    const spot = fr ? fr.kerb : (out, along) => kerbSpot(out, along, false);
    const pr = (p, dy) => { _v.set(p.x, p.y + dy, p.z).project(cam); return _v.z > 1 ? null : [(_v.x + 1) / 2 * W, (1 - _v.y) / 2 * H]; };
    // the seated friends on screen: across the row, and down to their laps
    let sx0 = 1e9, sx1 = -1e9, sy1 = -1e9;
    for (let i = 0; i < 10; i++) {
      const q = pr(fr ? fr.seat(i, new THREE.Vector3()) : BB.bus.seatWorld(i, new THREE.Vector3()), 0.35);
      if (q) { sx0 = Math.min(sx0, q[0]); sx1 = Math.max(sx1, q[0]); sy1 = Math.max(sy1, q[1]); }
    }
    const cr = cardRect();
    const half = Math.max(22, minPx / 2), x0 = (phone ? cr.right : 0) + half + 4, x1 = W - half - 4;
    // how much of a person the card or the screen's edge may hide: nothing, their feet and the ring lying round them
    // in view (-1); a toe (0.14); or, in a very close view, their legs (0.5)
    let dip = -1;
    const ok = (p) => {
      const foot = pr(p, 0), head = pr(p, 2.3);
      if (!foot || !head) return false;
      const tall = foot[1] - head[1], low = dip < 0 ? foot[1] + half * 0.42 : foot[1] - tall * dip;
      if (tall > H * 0.45 || foot[0] < x0 || foot[0] > x1 || head[0] < x0 || head[0] > x1 || head[1] < 70 || low > H - 3) return false;
      if (!phone && foot[0] + half > cr.left && foot[0] - half < cr.right && low > cr.top) return false;
      if (head[0] > sx0 - 36 && head[0] < sx1 + 36 && head[1] - Math.max(5, tall * 0.05) < sy1) return false;       // not in front of a seated friend
      // (nothing in the way: a post, a sign or a corner of a building between the camera and them; looked at across
      // their whole width, so a post hiding half of someone counts too)
      if (blind) return true;
      const cp = cam.position, W0 = BB.world, dx = p.x - cp.x, dz = p.z - cp.z, dl = hypot2(dx, dz) || 1, sx = -dz / dl * 0.34, sz = dx / dl * 0.34;
      return !(W0.blocksSight(cp.x, cp.y, cp.z, p.x, p.y + 1.1, p.z) || W0.blocksSight(cp.x, cp.y, cp.z, p.x + sx, p.y + 1.1, p.z + sz) ||
        W0.blocksSight(cp.x, cp.y, cp.z, p.x - sx, p.y + 1.1, p.z - sz) || W0.blocksSight(cp.x, cp.y, cp.z, p.x, p.y + 1.9, p.z));
    };
    for (dip of strict === 'feet' ? [-1] : strict ? [-1, 0.14] : [-1, 0.14, 0.5]) for (const rows of n > 4 ? [1, 2] : [1]) {
      for (const dir of phone ? [-1, 1] : [1, -1]) {
        for (const out of dir > 0 ? [2.0, 2.4, 1.6, 2.8, 3.2] : [2.8, 3.1, 3.4, 3.7, 4.0, 4.4, 4.8, 5.2]) {
          const a = pr(spot(out, 0), 0), b = pr(spot(out, 1), 0);
          if (!a || !b) continue;
          const step = Math.max(0.9, (minPx + 4) / Math.max(1, hypot2(a[0] - b[0], a[1] - b[1])));
          for (const lead of [0.35, 0.9, 1.6, 2.4]) {
            const spots = [];
            for (let i = 0; i < n; i++) {
              const r = i % rows, col = (i - r) / rows;
              const p = spot(out + r * 1.05, lead + dir * (col * step + r * step * 0.5));
              if (!ok(p)) break;
              spots.push(p);
            }
            if (spots.length === n) return spots;
          }
        }
      }
    }
    return null;
  }
  // How well the people waiting at the stop fit a stop view bus.js is planning (BB.bus calls this before the bus has
  // settled; fr as for queueRow): { fit, loose, tall }. fit: 3 = in one tidy row with a whole tap ring each, their
  // feet and the ring round them in view; 2 or 1 = with smaller rings; 0 = no such row. loose: the same, with their
  // toes allowed under the card or the screen's edge; blind: as loose, with something like a lamp post allowed in
  // front of someone (better than no row at all). tall = how tall they stand on screen (px).
  // (fr.queue: the places the stop keeps for them, st.queue; while nobody stands there yet, that many to tap)
  J.queueFit = function (fr) {
    const out = { fit: 3, loose: 3, blind: 3, tall: 999 };
    const all = J.waiting.length || Math.min(4, fr.queue | 0); if (!all) return out;
    const tap = J.waiting.length ? J.waiting.filter((m) => !m.userData.pre).length : all, T = BB.hands && BB.hands.size ? BB.hands.size() : 84;
    const px = tap && HANDS_ON && BB.hands ? [T + 4, T * 0.8, T * 0.62] : [50, 40], n = tap && HANDS_ON && BB.hands ? tap : all;
    const H = innerHeight, cam = fr.cam;
    for (const mode of ['feet', 'toes', 'blind']) {
      if (mode === 'blind' && out.loose) { out.blind = out.loose; break; }
      const strict = mode === 'feet';
      let tier = 0;
      for (let i = 0; i < px.length && !tier; i++) {
        const row = queueRow(n, px[i], fr, strict ? 'feet' : 'toes', mode === 'blind');
        if (!row) continue;
        tier = 3 - i;
        if (out.tall === 999) { _v.copy(row[0]).project(cam); const fy = _v.y; _v.set(row[0].x, row[0].y + 2.3, row[0].z).project(cam); out.tall = Math.round((_v.y - fy) / 2 * H); }
      }
      if (tier && tap && tap < all && !queueRow(all, 40, fr, strict ? 'feet' : 'toes', mode === 'blind')) tier = Math.min(tier, 1);   // (those who get on first stand in the row too)
      if (strict) out.fit = tier; else if (mode === 'toes') out.loose = Math.max(tier, out.fit); else out.blind = tier;
    }
    if (out.tall === 999) out.tall = 0;
    return out;
  };
  // The people waiting take their places in the queue and face the door. spread = they are about to be waved
  // aboard with a tap each: every one gets room for a ring of their own.
  function queueUp(spread) {
    const n = J.waiting.length; if (!n) return;
    const T = BB.hands && BB.hands.size ? BB.hands.size() : 84;
    // (their feet and rings in view first, then a toe hidden, then anything that fits; bigger room before smaller,
    // in the same order as the stop view was chosen, BB.jobs.queueFit)
    let row = null;
    const tiers = spread ? [[T + 4, 'feet'], [T * 0.8, 'feet'], [T + 4, 'toes'], [T * 0.8, 'toes'], [T * 0.62, 'toes'], [T * 0.8, null], [T * 0.62, null], [44, null]] : [[50, 'feet'], [40, 'feet'], [50, null], [40, null]];
    for (const blind of [false, true]) { for (const [px, mode] of tiers) { row = queueRow(n, px, null, mode, blind); if (row) break; } if (row) break; }
    const taken = [], f = doorFrame(false), face = Math.atan2(f.ox, f.oz);
    J.waiting.forEach((m, i) => {
      const p = row ? row[i] : freeSpot(taken, true, kerbSpot(1.6 + (i % 2) * 0.5, 1.2 + i * 0.9, false));
      taken.push(p); m.userData.spot = p;
      if (hypot2(p.x - m.position.x, p.z - m.position.z) < 0.15) return;
      // (they wait facing us, so their faces show; a tapped friend turns and walks to the door)
      walkTo(m, p, 3.8).then(() => { if (J.waiting.includes(m)) m.rotation.y = face; });
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
          const gap = hypot2(a[0] - b[0], a[1] - b[1]), phone = innerHeight <= 520;
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
  .bbq.wait.listen .bbq-ask { animation: bbq-listen .45s ease-in-out; }
  @keyframes bbq-listen { 30% { transform: translateY(5px) scale(.97); } 65% { transform: translateY(-2px); } }
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
  .bbj .track { position: relative; display: flex; align-items: center; gap: 8px; }
  .bbj .track::before { content: ''; position: absolute; left: 22px; right: 30px; top: 50%; margin-top: -2px; border-top: 4px dotted #e2cfa8; }
  .bbj .pip { position: relative; width: 56px; height: 50px; flex: none; display: flex; align-items: center; justify-content: center; }
  /* a ticket still to come: a dashed ticket-shaped place on the path */
  .bbj .pip:not(.on)::after { content: ''; width: 46px; height: 34px; box-sizing: border-box; border: 3px dashed #d6c39e; border-radius: 9px; background: #fff6e0; }
  .bbj .pip canvas.tk { display: block; width: 56px; height: 42px; margin: 0; transform: rotate(var(--r, 0deg)); filter: drop-shadow(0 2px 0 rgba(120,80,40,.2)); }
  .bbj .pip.on canvas.tk { animation: bbj-tk .45s var(--d, 0s) cubic-bezier(.2,1.5,.5,1) both; }
  @keyframes bbj-tk { from { transform: scale(.3) rotate(var(--r, 0deg)); opacity: 0; } }
  /* this job's ticket is stamped onto the path: it drops in big and tilted, lands with a squash and glows */
  .bbj .pip.new canvas.tk { animation: bbj-stamp .8s var(--d, 0s) cubic-bezier(.3,1.4,.5,1) both; filter: drop-shadow(0 0 7px rgba(255,196,50,.95)); }
  @keyframes bbj-stamp { 0% { transform: translateY(-38px) scale(1.8) rotate(-18deg); opacity: 0; } 40% { transform: translateY(0) scale(.9, .8) rotate(var(--r, 0deg)); opacity: 1; }
    65% { transform: scale(1.18) rotate(var(--r, 0deg)); } 100% { transform: scale(1.1) rotate(var(--r, 0deg)); } }
  .bbj .cup { position: relative; margin-left: 4px; width: 62px; height: 62px; display: flex; align-items: center; justify-content: center; }
  .bbj .cup svg { display: block; width: 62px; height: 62px; }
  /* the trophy at the end of the path waits in full colour (a little smaller, now and then a wiggle: "come and get me") */
  .bbj .cup:not(.on) svg { width: 52px; height: 52px; transform-origin: 50% 85%; animation: bbj-wait 3.2s ease-in-out -1.3s infinite; }   /* (its first wiggle about 1 s in, while the banner shows) */
  @keyframes bbj-wait { 0%, 72%, 100% { transform: rotate(0); } 78% { transform: rotate(-8deg) scale(1.06); } 86% { transform: rotate(6deg) scale(1.06); } 93% { transform: rotate(-3deg); } }
  .bbj .cup.new svg { animation: bbj-cup 1s .55s cubic-bezier(.2,1.5,.4,1) both; filter: drop-shadow(0 0 10px rgba(255,190,40,.95)); }
  @keyframes bbj-cup { 0% { transform: scale(.3) translateY(10px); } 45% { transform: scale(1.5) translateY(-6px) rotate(-6deg); } 70% { transform: scale(1.25) rotate(4deg); } 100% { transform: scale(1.3); } }
  .bbj.win { border-color: #ffb81f; box-shadow: 0 8px 0 rgba(120,80,40,.18), 0 0 0 6px rgba(255,212,92,.45); }
  .bbj canvas { width: 52px; height: 52px; margin-left: 10px; }
  .bbj-wish { position: absolute; left: 50%; top: calc(24% + 92px); transform: translate(-50%, 0); display: flex; align-items: center; gap: 10px;
    background: #fff6e0; border: 4px solid #d9b57f; border-radius: 26px; padding: 6px 20px 6px 12px; pointer-events: none;
    box-shadow: 0 6px 0 rgba(120,80,40,.18); font: 800 34px/1 'Fredoka', 'Baloo 2', system-ui, sans-serif; color: #b06e00;
    animation: bbj-in .5s cubic-bezier(.2,1.5,.5,1) .35s both; }
  .bbj-wish.out { transition: opacity .4s, transform .4s; opacity: 0; transform: translate(-50%, -30px); }
  .bbj-wish .ride { width: 84px; height: 63px; }
  .bbj-wish .bar { width: 150px; height: 18px; border-radius: 10px; background: #eadfca; overflow: hidden; }
  .bbj-wish .bar i { display: block; height: 100%; min-width: 6px; border-radius: 10px; background: #ffb81f; transition: width .9s ease-out; }
  .bbj-wish .coin { width: 34px; height: 34px; margin-right: -4px; }
  .bbj-wish .ok { width: 38px; height: 38px; border-radius: 50%; background: #19a79b url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12.5l4 4 8-9' stroke='white' stroke-width='3.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/80% no-repeat; }
  @media (max-height: 520px) {
    .bbj-wish { top: calc(24% + 78px); font-size: 26px; padding: 4px 14px 4px 8px; border-width: 3px; }
    .bbj-wish .ride { width: 64px; height: 48px; } .bbj-wish .bar { width: 110px; height: 14px; } .bbj-wish .coin { width: 26px; height: 26px; }
    .bbj-wish .ok { width: 30px; height: 30px; }
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
    .bbj { font-size: 36px; padding: 8px 20px; top: 20%; gap: 8px; } .bbj .pip { width: 42px; height: 36px; } .bbj .pip canvas.tk { width: 42px; height: 32px; }
    .bbj .cup, .bbj .cup svg { width: 46px; height: 46px; } .bbj .cup:not(.on) svg { width: 40px; height: 40px; }
    .bbj .pip:not(.on)::after { width: 34px; height: 25px; border-width: 2.5px; border-radius: 7px; } .bbj .track::before { left: 16px; right: 22px; border-top-width: 3px; }
    .bbj .track { gap: 5px; } .bbj canvas { width: 40px; height: 40px; margin-left: 6px; }
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
    const L = typeof BB.bus.seatLook === 'function' ? BB.bus.seatLook(i) : null;     // the colours of whoever sits in seat i
    const c = L ? L.shirt : SHIRTS[i % 10], sk = L ? L.skin : SKINS[(i * 3) % 5], h = L ? L.hair : HAIRS[(i * 2 + 1) % 5], long = i % 3 === 1;
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
    const c = bagColor(i);
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
    const pic = (i) => mode === 'bags' ? suitcase(lookOf(i)) : ICONS[mode] ? ICONS[mode](lookOf(i)) : '';
    const dots = (n, from = 0) => '<span class="bbq-dots">' + Array.from({ length: n }, (_, i) => `<i>${mode === 'people' ? '' : pic(from + i)}</i>`).join('') + '</span>';
    sumEl.innerHTML =
      `<span class="bbq-term n1" data-p="n1"><b>${q.n}</b>${dots(q.n)}</span>` +
      `<span class="bbq-term op" data-p="n2"><b>${q.kind === 'add' ? '+' : MINUS}</b></span>` +
      `<span class="bbq-term n2 ${q.kind}" data-p="n2"><b>${q.k}</b>${dots(q.k, q.kind === 'add' ? q.n : Math.max(0, q.n - q.k))}</span>` +
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
    else if (!had) { const k = lookOf(i); el.innerHTML = iconMode === 'people' ? face(i) : iconMode === 'bags' ? suitcase(k) : (ICONS[iconMode] ? ICONS[iconMode](k) : face(i)); }
  }
  // place i's picture again (a vehicle scene's thing moved into that place: its own colour; any number badge stays)
  function cardPic(i) {
    const el = seatEls[i]; if (!el || !el.dataset.state || iconMode === 'people') return;
    const k = lookOf(i), nums = Array.from(el.querySelectorAll('.num'));
    el.innerHTML = iconMode === 'bags' ? suitcase(k) : (ICONS[iconMode] ? ICONS[iconMode](k) : '');
    for (const n of nums) el.appendChild(n);
  }
  const isFull = (i) => seatEls[i] && (seatEls[i].dataset.state === 'full' || seatEls[i].dataset.state === 'new');
  // the picture for place i: the thing really standing there (a vehicle scene, SCN.look), else picture i
  const lookOf = (i) => (vmode() && SCN.look[i] != null ? SCN.look[i] : i);
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
      // the answer buttons are still faded (the story is being told): Mina gives a little hop and the buttons a
      // nudge, with a soft tick, so the tap is noticed; the story carries on (no words, they would cut it off)
      if (card.classList.contains('wait') && !q.done && e.target.closest('.bbq-ask')) { listenFirst(); return; }
      const seat = e.target.closest('.bbq-seat');
      if (seat && J.phase === 'question' && !q.done) countTap(+seat.dataset.i);
    });
    requestAnimationFrame(() => birdTo(null));
    BB.emit('question:show', { q });
  }

  let listenAt = 0;
  function listenFirst() {
    const now = performance.now();
    if (now - listenAt < 700 || !card) return;
    listenAt = now;
    BB.sfx.tick();
    if (bird) { bird.classList.remove('hop'); void bird.offsetWidth; bird.classList.add('hop'); }
    card.classList.remove('listen'); void card.offsetWidth; card.classList.add('listen');
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
    if (!keepSeq) { seq++; stopGen++; releaseExtras(); if (BB.hands) BB.hands.stop(); }
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
    await wait(250);                          // the stop camera settles about 1 s after arrival
    if (!alive()) return;
    // friends who will be waved aboard with a tap each stand well apart (room for a ring each): at once when nobody
    // gets on first, else when those have got on and the queue moves up to the door
    const tapOn = HANDS_ON && !!BB.hands && q.kind === 'add' && q.k > 0;
    queueUp(tapOn && !(q.pre > 0));
    await wait(350);
    if (!alive()) return;
    // a passenger friend in the queue waves and says hello (met for the first time: added to the friends list),
    // while the people before them get on
    let hello = null;
    if (q.friend) {
      const f = FRIENDS.find((x) => x.id === q.friend), fm = J.waiting.find((m) => m.userData.friend === q.friend);
      if (f) {
        if (fm) { fm.userData.jump = 1; fm.userData.jumpDelay = 0; }
        hello = say(friendHello(f));
      }
    }
    // first, people who get on (or, rarely, off) without a question, so the question starts from a good group.
    // Getting off happens quietly: anything spoken here would sound like the question.
    if (q.pre > 0) {
      const pre = J.waiting.filter((m) => m.userData.pre);
      J.waiting = J.waiting.filter((m) => !m.userData.pre);
      await Promise.all([hello || say(helloLine()), boardPeople(pre)]);
      if (alive() && tapOn) queueUp(true);
    } else {
      if (hello) { await hello; if (!alive()) return; }
      if (q.pre < 0) await alightPeople(-q.pre);
    }
    if (!alive()) return;
    BB.bus.passengers = q.n;
    buildCard(q);
    J.question = q;
    await wait(200);
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
    // the child waves each friend aboard, or says goodbye to each one, with a tap (BB.hands); then the story says it
    const onSeat = (seat) => { if (card) setSeat(seat, 'new'); };
    const onLeave = (seat) => { if (card) { setSeat(seat, 'gone'); seatEls[seat].classList.add('bye'); } };
    if (HANDS_ON && BB.hands && q.k > 0 && (q.kind !== 'add' || J.waiting.length)) {
      let done;
      if (q.kind === 'add') {
        const list = J.waiting.slice(), tall = (m) => (m.userData.look && m.userData.look.kid ? 0.72 : 1);
        const wd = q.word || ['friend', 'friends'];      // (a themed group: "Tap 3 children to get on!")
        done = await BB.hands.run({ kind: 'tap', count: list.length, say: `Tap ${pl(list.length, wd[0], wd[1])} to get on!`, hint: `Tap ${wd[0] === 'child' ? 'a child' : 'a ' + wd[0]}!`,
          // (each friend wears the ring flat round their feet, so they stay in full view: the whole friend is the place to tap)
          targets: list.map((m) => ({ at: (out) => { out.copy(m.position); out.y = GROUND + 1.2 * tall(m); return out; }, feet: (out) => { out.copy(m.position); out.y = GROUND; return out; } })),
          bubble: (j, idx, out) => { out.copy(list[idx].position); out.y = GROUND + 2.3 * tall(list[idx]); }, bubbleFollow: true,
          // (a happy hop as they set off for the door)
          act: (j, idx) => { const m = list[idx]; J.waiting = J.waiting.filter((x) => x !== m); m.userData.jump = 0.5; m.userData.jumpDelay = 0; return boardOne(m, onSeat); } });
      } else {
        // (who is getting off: a passenger friend by name, a themed group by its word, else "friends")
        const n = q.n, job = J.current, recs = (job && job.seats) || {}, TH = job && job.theme ? THEMES[job.theme] : null;
        const top = Array.from({ length: q.k }, (_, t) => recs[n - 1 - t]);
        const fr = q.k === 1 && top[0] && top[0].friend ? FRIENDS.find((x) => x.id === top[0].friend) : null;
        const wd = TH && top.every((r) => r && r.group) ? TH.word : ['friend', 'friends'];
        done = await BB.hands.run({ kind: 'tap', count: q.k, ordered: true, say: fr ? `Tap ${fr.name} to say goodbye!` : `Tap ${pl(q.k, wd[0], wd[1])} to say goodbye!`,
          hint: fr ? `Tap ${fr.name}!` : `Tap the glowing ${wd[0]}!`,
          targets: Array.from({ length: q.k }, (_, t) => (out) => { BB.bus.seatWorld(n - 1 - t, out); out.y += 1.0; return out; }),
          act: () => alightOne(onLeave, true) });
      }
      if (!done || !alive()) return;
      await say(kPhrase(q));
    } else if (q.kind === 'add') {
      const list = J.waiting; J.waiting = [];
      await Promise.all([say(kPhrase(q)), boardPeople(list, onSeat)]);
    } else {
      await Promise.all([say(kPhrase(q)), alightPeople(q.k, onLeave, true)]);
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
    card.classList.remove('wait');            // a child who knows already may answer while the question is still being asked
    await say(askPhrase(q));
    if (s !== seq || !card) return;
    litSum(null);
  }
  // The card shows just the starting group (seats 0..n-1), e.g. after the worked example.
  function showGroup(n) {
    clearCounting();
    for (let i = 0; i < 10; i++) setSeat(i, '');
    for (let i = 0; i < n; i++) setSeat(i, 'full');
  }


  const PRAISE = ['Well done!', 'Super counting!', 'Hooray!', 'You got it!', 'Great job, Captain!', 'Clever you!'];
  // people getting on before the story: a short hello, never the same one twice running
  const HELLOS = ['Hello! In you get!', 'Hop on!', 'Welcome aboard!', 'Good to see you!', 'All aboard!', 'Hello, hello!'];
  let lastHello = '';
  const helloLine = () => { let h; do h = BB.pick(HELLOS); while (h === lastHello); lastHello = h; return h; };
  const XMAS_PRAISE = ['Ho ho ho! Well done!', 'Merry counting!', 'Jingle jingle, you got it!'];
  let lastPraise = '';
  const praise = () => { let p; do p = BB.pick(BB.xmas && Math.random() < 0.6 ? XMAS_PRAISE : PRAISE); while (p === lastPraise); lastPraise = p; return p; };
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
      BB.save.questions = (BB.save.questions | 0) + 1; learn(q); BB.saveNow();
      J.lastKey = qKey(q);
      J.recent = (J.recent || []).concat(J.lastKey).slice(-5);
      if (!q.icon) J.kinds = (J.kinds || []).concat(q.kind).slice(-3);   // bus questions only (vehicle scenes have an icon)
      const cash = (q.tries ? CASH_STOP_RETRY : CASH_STOP) + (q.bonus ? 1 : 0);   // +1 for stopping in the rain
      // celebrate: every friend on the bus bounces, coins fly to the cash counter
      clearMarks();
      seatEls.forEach((el, i) => { if (isFull(i)) { el.classList.add('lit'); BB.later(160 + i * 60, () => el.classList.remove('lit')); } });
      const counted = flyCoins(btn, cash);
      showSum('n1', 'n2', 'ask'); litSum(null); fillSum(q.answer);
      await Promise.all([sayNow(`Yes! ${sumWords(q)} ${praise()}`), wait(1400), counted]);
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
  // land: instead of adding them, call this as they land (the job's coins: counted already, the counter waits for them)
  function flyCoins(fromEl, n, land) {
    return new Promise((resolve) => {
      let added = false;
      const add = () => { if (added) return; added = true; if (land) land(); else BB.depot.add(n); resolve(); };
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
        const mx = (x0 + x1) / 2 + (i - 1) * 40, my = Math.max(10, Math.min(y0, y1) - 60 - i * 10);   // (the arc's high point stays on the screen)
        const kf = [
          { transform: `translate(${x0}px, ${y0}px) scale(.4)`, opacity: 0 },
          { transform: `translate(${x0 + (i - 1) * 30}px, ${Math.max(10, y0 - 50)}px) scale(1.15)`, opacity: 1, offset: 0.25 },
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
  // The banner: a ticket for each job on a dotted path of four tickets to a trophy, and the job's coins. A ticket is a
  // teal paper ticket with the ride that did that job in its window (save.stamps), so the path reads as "my jobs", not
  // as money or a score; every 5th job wins the trophy, with the number of jobs on it (the launcher's stars are the
  // same number). The trophy waits at the end of the path in full colour, so the child sees where the path goes.
  // The job's coins then fly from the banner into the coin counter. Under it the wish (the ride being saved up for,
  // depot.js): its picture, a bar filling with the coins and how many more it takes (or a tick when there are
  // enough). Returns what to say about the wish: { line, ready }.
  const TICKETS = new WeakMap();     // the ride's garage picture -> its ticket, drawn once
  function ticketArt(ride) {
    let pc = null; try { pc = BB.depot.ridePic ? BB.depot.ridePic(ride) : null; } catch (e) { pc = null; }
    if (pc && TICKETS.has(pc)) return TICKETS.get(pc);
    const k = 1.25, c = document.createElement('canvas'); c.width = Math.round(132 * k); c.height = Math.round(100 * k);
    const x = c.getContext('2d'); x.scale(k, k); x.lineJoin = 'round';
    // the ticket: a rounded card with a round notch in each side, paper-cut (a deeper crescent lower right, a rim)
    const X0 = 5, Y0 = 7, X1 = 125, Y1 = 91, R = 13, cy = 49, nr = 10;
    const t = new Path2D();
    t.moveTo(X0 + R, Y0); t.lineTo(X1 - R, Y0); t.arcTo(X1, Y0, X1, Y0 + R, R);
    t.lineTo(X1, cy - nr); t.arc(X1, cy, nr, -Math.PI / 2, Math.PI / 2, true);
    t.lineTo(X1, Y1 - R); t.arcTo(X1, Y1, X1 - R, Y1, R); t.lineTo(X0 + R, Y1); t.arcTo(X0, Y1, X0, Y1 - R, R);
    t.lineTo(X0, cy + nr); t.arc(X0, cy, nr, Math.PI / 2, -Math.PI / 2, true);
    t.lineTo(X0, Y0 + R); t.arcTo(X0, Y0, X0 + R, Y0, R); t.closePath();
    BB.paper(x, t, P.teal, { rimW: 3 });
    // its window: cream, with the ride in it (the middle of its garage picture, 4:3, close up)
    const win = new Path2D(); BB.paths.rr(win, 21, 15, 86, 66, 10);
    x.fillStyle = '#fff6e0'; x.fill(win);
    if (pc) { x.save(); x.clip(win); x.drawImage(pc, pc.width * 0.06, pc.height * 0.17, pc.width * 0.88, pc.height * 0.66, 20, 15, 88, 66); x.restore(); }
    x.lineWidth = 2.2; x.strokeStyle = '#12867c'; x.stroke(win);
    if (pc) TICKETS.set(pc, c);
    return c;
  }
  const CUP = (num) => {
    const t = num == null ? '' : String(num), fs = t.length > 2 ? 12.5 : t.length > 1 ? 16 : 19;
    return '<svg viewBox="0 0 64 64"><path d="M17 15 H9.5 C7.5 15 6.5 16.6 6.5 18.5 C6.5 25 11 30.5 18 31.5" fill="none" stroke="#f2b51f" stroke-width="4.5" stroke-linecap="round"/>'
      + '<path d="M47 15 H54.5 C56.5 15 57.5 16.6 57.5 18.5 C57.5 25 53 30.5 46 31.5" fill="none" stroke="#e0a21a" stroke-width="4.5" stroke-linecap="round"/>'
      + '<path d="M15.5 9 H48.5 V22 C48.5 34.5 41 41.5 32 41.5 C23 41.5 15.5 34.5 15.5 22 Z" fill="#ffc93c"/>'
      + '<path d="M48.5 22 C48.5 34.5 41 41.5 32 41.5 C39 38.5 44.5 32 45.2 22 V9 H48.5 Z" fill="#e8a91c"/>'
      + '<rect x="13.5" y="6.5" width="37" height="6" rx="3" fill="#ffd96b"/><rect x="28" y="41" width="8" height="8" fill="#e8a91c"/>'
      + '<rect x="19" y="48" width="26" height="9" rx="3.5" fill="#f2b51f"/><path d="M45 51.5 V53.5 C45 55.4 43.4 57 41.5 57 H22.5 C21 57 19.7 56.1 19.2 54.8 H40 C42 54.8 43.4 53.5 43.6 51.5Z" fill="#d1931a"/>'
      + (t ? `<text x="31.5" y="${29.5 + (17 - fs) / 3}" text-anchor="middle" font-family="Fredoka, 'Baloo 2', system-ui, sans-serif" font-weight="700" font-size="${fs}" fill="#fff6e0" stroke="#c98a12" stroke-width="1.6" paint-order="stroke">${t}</text>`
        : '<path d="M22 14 C21 21 22.5 27 26 31" stroke="#ffe7a3" stroke-width="3.2" fill="none" stroke-linecap="round"/>')   // (waiting: a shine instead of the number)
      + '</svg>';
  };
  // the wish card goes when its time is up, or at once when the goodnight starts (main.js: its sleepy "z z z" sits
  // just where the card is)
  let wishEl = null;
  function dropWish() { const e = wishEl; wishEl = null; if (e) { e.classList.add('out'); BB.later(450, () => e.remove()); } }
  // a soft rising ding for each ticket up to this job's, a little stamp thump for the new one, a fanfare for a trophy
  function starDings(k) {
    if (typeof BB.tone !== 'function') return;
    const f = (semi) => 440 * Math.pow(2, (semi - 9) / 12);
    for (let i = 1; i <= Math.min(k, 4); i++) { try { BB.tone(f(19 + i * 3), 0.14, { type: 'sine', vol: i === k ? 0.08 : 0.05, at: 0.25 + (i - 1) * 0.12 }); } catch (e) { /* no sound */ } }
    if (k < 5) {
      try { BB.tone(f(4), 0.09, { type: 'triangle', vol: 0.09, slide: f(-3), at: 0.36 + (k - 1) * 0.12 }); } catch (e) { /* no sound */ }
      BB.later(420 + (k - 1) * 120, () => BB.sfx.sparkle());
    } else BB.later(650, () => { BB.sfx.right(); BB.later(380, () => BB.sfx.sparkle()); });
  }
  // cash: the job's coins in all (shown); jobCoins: the job's own coins, which fly to the counter; calm: time is up
  // (the goodnight comes next: no wish card)
  function celebrateJob(cash, n, jobCoins, calm) {
    const root = (BB.ui && BB.ui.root) || document.body;
    const k = ((Math.max(1, n) - 1) % 5) + 1, goal = Math.ceil(Math.max(1, n) / 5) * 5;   // k: this job's place on the way (5 = the trophy)
    const hist = Array.isArray(BB.save.stamps) ? BB.save.stamps : [], now = hist[hist.length - 1] || BB.bus.type || 'bendy';
    const el = BB.el('div', 'bbj' + (k === 5 ? ' win' : ''), root);
    const track = BB.el('span', 'track', el);
    for (let i = 1; i <= 4; i++) {
      const p = BB.el('span', 'pip' + (i <= k ? ' on' : '') + (i === k ? ' new' : ''), track);
      p.style.setProperty('--d', (0.1 + (i - 1) * 0.12) + 's'); p.style.setProperty('--r', [-4, 3, -2, 4][i - 1] + 'deg');   // (stuck on by hand)
      if (i > k) continue;
      try {
        const src = ticketArt(hist[hist.length - k + i - 1] || now), tc = document.createElement('canvas');
        tc.width = src.width; tc.height = src.height; tc.getContext('2d').drawImage(src, 0, 0); tc.className = 'tk'; p.appendChild(tc);
      } catch (e) { console.error(e); }
    }
    BB.el('span', 'cup' + (k === 5 ? ' on new' : ''), track, CUP(k === 5 ? goal : null));
    const c = document.createElement('canvas'); c.width = c.height = 80; c.className = 'coin'; c.getContext('2d').drawImage(BB.pic('coin', 80), 0, 0);
    el.appendChild(c); BB.el('span', 'cash', el, '+' + cash);
    starDings(k);
    // the job's coins fly from the banner into the counter once the ticket is in (the counter shows them as they land)
    // (not when the counter is hidden: the goodnight has started, or the garage)
    const landed = () => { if (BB.ui && BB.ui.coinsLanded) BB.ui.coinsLanded(); };
    const counterOn = () => { const t = document.querySelector('.bbu-cash'); return !!(t && t.getBoundingClientRect().width > 0); };
    if (jobCoins > 0) BB.later(1000, () => { if (c.isConnected && counterOn() && !BB.bedtime) flyCoins(c, jobCoins, landed); else landed(); });
    BB.later(k === 5 ? 3400 : 2700, () => { el.classList.add('out'); BB.later(450, () => el.remove()); });
    if (calm) return null;
    let w = null; try { w = BB.depot.wish && BB.depot.wish(); } catch (e) { console.error(e); }
    if (!w) return null;
    dropWish();
    const we = wishEl = BB.el('div', 'bbj-wish', root);
    try { const pc = w.pic(), c2 = document.createElement('canvas'); c2.width = pc.width; c2.height = pc.height; c2.getContext('2d').drawImage(pc, 0, 0); c2.className = 'ride'; we.appendChild(c2); } catch (e) { console.error(e); }
    const had = Math.max(0, w.price - w.need - cash);
    const fill = BB.el('i', '', BB.el('span', 'bar', we)); fill.style.width = Math.round(100 * Math.min(1, had / w.price)) + '%';
    BB.later(500, () => { fill.style.width = Math.round(100 * Math.min(1, (w.price - w.need) / w.price)) + '%'; });
    if (w.need > 0) { const c3 = document.createElement('canvas'); c3.width = c3.height = 64; c3.getContext('2d').drawImage(BB.pic('coin', 64), 0, 0); c3.className = 'coin'; we.appendChild(c3); BB.el('b', '', we, String(w.need)); }
    else BB.el('b', 'ok', we, '');
    BB.later(k === 5 ? 3900 : 3600, () => { if (wishEl === we) dropWish(); });
    // (enough coins: jobDone asks depot.js wishNews only when it is about to say it; the gold Garage tile shows it
    // the rest of the time)
    if (w.need <= 0) return { ready: true };
    return { line: `${w.need} more ${w.need === 1 ? 'coin' : 'coins'} for the ${w.name}!` };
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
    return hypot2(s.pos.x - p.x, s.pos.z - p.z);
  }
  // Short legs (about 7 s of driving): each next stop is picked from BB.world.stopsByDistance(current) within about
  // 40-80 road units, at random among those (variety, not always the nearest), never the stop just visited or one
  // already in the job, leaning toward named stops (st.minor = small automatic ones with shared names like "the flats").
  const LEG_MIN = 40, LEG_MAX = 80;         // ~70 units apart: mostly the very next stop, about 7 s of driving
  const okStop = (s) => s && s.pos && s.edge != null && s.say;
  // ---- playing together: jobs bring the players to one place (the owner asked: "all the players are together, even
  // if it takes long to drive to the players"). Everybody drives to one player, the leader: of all who are out
  // driving now (us and the friends, BB.net.driving()), the one who has been in the room longest (the lowest member
  // id; every device sees the same one). The leader just plays on in short hops, so the meeting place moves slowly
  // and nobody chases a place the others are leaving. null when nobody else is out driving, or we lead: then
  // nothing here changes anything.
  const MEET_FAR = 70, MEET_RING = 85;
  function friendsOut() {
    try { const fr = BB.net && typeof BB.net.driving === 'function' ? BB.net.driving() : null; return fr && fr.length ? fr : null; } catch (e) { return null; }
  }
  function meetPoint() {
    const fr = friendsOut(); if (!fr) return null;
    let lead = fr[0];
    for (const f of fr) if (f.id < lead.id) lead = f;
    if (!(BB.net.self > lead.id)) return null;                      // we are the leader: the others come to us
    return { x: lead.x, z: lead.z };
  }
  J.meetPoint = meetPoint;
  // The leader's own short hops lean towards the others (the middle of the friends out driving), so they meet sooner
  // and then stay near each other: from the usual choice of next places (pool: [{ s }]), the ones near the friends,
  // else the nearest to them. No friends out, or we follow (meetPick did that already): pool as it is.
  function leadPool(pool) {
    if (pool.length < 2) return pool;
    const fr = friendsOut(); if (!fr) return pool;
    let x = 0, z = 0;
    for (const f of fr) { x += f.x; z += f.z; }
    x /= fr.length; z /= fr.length;
    const by = pool.map((o) => ({ o, dg: hypot2(o.s.pos.x - x, o.s.pos.z - z) })).sort((a, b) => a.dg - b.dg);
    const ring = by.filter((e) => e.dg <= MEET_RING);
    return (ring.length ? ring : by.filter((e) => e.dg <= by[0].dg + 25)).map((e) => e.o);
  }
  // The next place when friends are out driving, from `from` (a bay, or null = where the vehicle is) among list
  // (bus stops for a bus, the ride's own spots for the others):
  // - a long way from the meeting point: one of the two places nearest to it, however long the drive;
  // - near it already: a normal short hop that stays near it (so the group keeps together and still moves around).
  // null = no friends, or nothing fits: the usual pick.
  function meetPick(from, list, exclude, weight) {
    const g = meetPoint(); if (!g) return null;
    const p = from ? from.pos : (BB.bus.pos || { x: 0, z: 0 });
    const c = [];
    for (const t of list) {
      if (!t || !t.pos || t === from || exclude.indexOf(t) >= 0) continue;
      const dp = hypot2(t.pos.x - p.x, t.pos.z - p.z);
      if (dp < 22) continue;                                     // (not the place we're standing at)
      c.push({ s: t, dp, dg: hypot2(t.pos.x - g.x, t.pos.z - g.z) });
    }
    if (!c.length) return null;
    const nm = (t) => t && ((t.say && t.say !== 'here') ? t.say : t.near), prev = nm(from);
    const reach = (o) => isFinite(stopDist(from, o.s));
    let pool;
    const far = hypot2(p.x - g.x, p.z - g.z);
    if (far > MEET_FAR) {
      // (only places that really bring us nearer: a ride with few places of its own may have none that way)
      c.sort((a, b) => a.dg - b.dg);
      pool = c.slice(0, 4).filter((o) => o.dg < far - 5 && reach(o)).slice(0, 2);
    } else {
      pool = c.filter((o) => o.dg <= MEET_RING && o.dp <= 130);
      const other = pool.filter((o) => nm(o.s) !== prev);          // (not the same spoken name twice running)
      if (other.length) pool = other;
      if (pool.length > 1) { const fresh = pool.filter((o) => recentLegs.indexOf(o.s.id) < 0); if (fresh.length) pool = fresh; }
      pool = pool.filter(reach);                                   // (none: the usual short hop keeps us near enough)
    }
    if (!pool.length) return null;
    const bag = [];
    for (const o of pool) { const n = weight ? weight(o.s) : 1; for (let i = 0; i < n; i++) bag.push(o.s); }
    return BB.pick(bag.length ? bag : pool.map((o) => o.s));
  }
  // strict: only a name not heard yet in this job (else null: the job is long enough without going "back")
  function nextNear(from, exclude, strict) {
    const W = BB.world, all = (W.stops || []).filter((s) => okStop(s) && !exclude.includes(s));
    const met = meetPick(from, all, exclude, (st) => (st.minor ? 1 : 3));
    if (met) return met;
    let ranked;
    if (from && typeof W.stopsByDistance === 'function') ranked = W.stopsByDistance(from, all).map((s2) => ({ s: s2, d: stopDist(from, s2) }));
    else ranked = all.map((s2) => ({ s: s2, d: stopDist(from, s2) })).sort((p, q) => p.d - q.d);
    ranked = ranked.filter((o) => o.s !== from && isFinite(o.d));
    if (!ranked.length) return null;
    let pool = ranked.filter((o) => o.d >= LEG_MIN && o.d <= LEG_MAX);
    if (!pool.length) pool = ranked.filter((o) => o.d >= 25 && o.d <= 130);       // nothing that close: widen a little
    if (!pool.length) { const n0 = (ranked.find((o) => o.d >= 25) || ranked[0]).d; pool = ranked.filter((o) => o.d >= 25 && o.d <= n0 + 80).slice(0, 5); }   // (from the garage yard: the few nearest from the gate)
    if (!pool.length) pool = ranked.slice(0, 3);
    // a name the child hasn't just heard: several small stops share a name ("old town", "the flats"), and a child can't
    // tell two "old town" stops in a row apart; "the seaside, the sea view, the seaside" in one job, or "first stop,
    // old town" while standing in old town, sounds like going back or nowhere. Best: none of this job's names nor
    // where the bus is, in the usual hop, else a little further (up to about 130 road units); else (strict: the
    // job's third stop) none, and the job ends at two stops; else not the stop just before. (Old town and the airport
    // road have only their own name for a long way: then stopLine says "drive to the next old town stop!")
    const prevSay = from && from.say, heard = new Set();
    if (prevSay) heard.add(prevSay);
    for (const s of exclude) if (s && s.say) heard.add(s.say);
    if (heard.size) {
      const samePic = (o) => !!(from && from.pic && o.s.pic === from.pic && o.s.minor && from.minor);
      const newName = (o) => !heard.has(o.s.say) && !samePic(o), notPrev = (o) => o.s.say !== prevSay && !samePic(o);
      let fresh = pool.filter(newName);
      if (!fresh.length) fresh = ranked.filter((o) => o.d >= 25 && o.d <= 130 && newName(o)).slice(0, 3);
      if (!fresh.length && strict) return null;
      if (!fresh.length) fresh = pool.filter(notPrev);
      if (!fresh.length) fresh = ranked.filter((o) => o.d >= 25 && o.d <= 160 && notPrev(o)).slice(0, 4);
      if (fresh.length) pool = fresh;
    }
    pool = leadPool(pool);
    // named stops count three times, so they come up more often than the small ones
    const bag = []; for (const o of pool) { bag.push(o.s); if (!o.s.minor) bag.push(o.s, o.s); }
    return BB.pick(bag);
  }
  J.nextNear = nextNear;
  function pickStops() {
    const count = (BB.save.jobsDone | 0) < 1 ? 2 : BB.randInt(2, 3);
    const here = BB.bus.atStop || J.lastStop;
    const exclude = here ? [here] : [];
    const from0 = here && here.id !== 'depot' && okStop(here) ? here : null;
    // a third stop only with a name not heard yet in this job ("the seaside, the sea view, the seaside" sounds like
    // going back): a few tries with another second stop, else the job has two stops
    let list = [];
    for (let tries = 0; tries < 5 && list.length < count; tries++) {
      const l = [];
      let from = from0;
      for (let i = 0; i < count; i++) {
        const s2 = nextNear(from, exclude.concat(l), i >= 2);
        if (!s2) break;
        l.push(s2); from = s2;
      }
      if (l.length > list.length) list = l;
    }
    J.lastJobStops = list;
    return list;
  }
  // (prev: the stop the bus is at; when the next one has the same name, it is "the next old town stop")
  const stopLine = (st, first, prev) => prev && prev.say && prev.say === st.say
    ? `${first ? 'New job! Drive' : 'Now drive'} to the next ${st.say.replace(/^the /, '')} stop!`
    : first
      ? (st.minor ? `New job! First stop, ${st.say}!` : `New job! Drive to ${st.say}!`)
      : (st.minor ? `Next stop, ${st.say}!` : `Now drive to ${st.say}!`);
  const hereStop = () => { const h = BB.bus.atStop || J.lastStop; return h && h.say ? h : null; };
  function bedtime() {
    clearWaiting(); clearMarker();
    dropWish();
    if (J.current) { J.current = null; BB.bus.stopAt(null); BB.emit('job:target', { stop: null, job: null }); }
    setPhase('bedtime');
    BB.emit('jobs:bedtime');
  }
  J.start = function () {
    if (J.current) return;                    // a job is already running: starting twice must not make two
    if (timeUp()) { bedtime(); return; }
    if (pumpDue(true) && J.goPump(BB.bus.fuel <= PUMP_LOW ? 'low' : 'drive')) return;   // (hungry, or just out of the garage under 60%)
    const vk = vehicleKind();
    if (vk !== 'bus' && startVehicleJob(vk)) return;
    let theme = pickTheme();
    const job = { stops: pickStops(), index: 0, cash: 0, q: null, theme: null, groupOn: 0 };
    if (theme) {
      // 'from': the place first (the airport, the beach, the market), then one other stop for the drop;
      // 'to': a stop just before the place, then the place (the playground, the big wheel, the hawker centre)
      const T = THEMES[theme], ts = themeStop(theme), here = BB.bus.atStop || J.lastStop;
      let two = null;
      if (ts && ts !== here) {
        if (T.dir === 'to') { const pu = pickupFor(ts, here); if (pu) two = [pu, ts]; }
        else { const d2 = nextNear(ts, [ts, here].filter(Boolean)); if (d2) two = [ts, d2]; }
      }
      if (two) { job.stops = two; job.theme = theme; J.lastJobStops = two.slice(); J.lastTheme = theme; J.sinceSpecial = 0; }
      else theme = null;                      // (no way to make it here: an everyday job instead)
    }
    if (!theme) J.sinceSpecial = (J.sinceSpecial == null ? 2 : J.sinceSpecial) + 1;
    J.current = job;
    BB.emit('job:new', { job, theme });
    if (theme === 'school' || theme === 'party') jingle();
    say(theme ? THEMES[theme].pick(job.stops[0]) : stopLine(job.stops[0], true, hereStop()), { queue: true });
    nextStop(true);
  };
  // Head for the job's current stop: a new question (and the people for it waiting at the shelter).
  function nextStop(quiet) {
    const job = J.current; if (!job) return;
    // friends are out driving: the job's later stops were chosen a while ago, so choose this one afresh, for where
    // the friends are now (see meetPick; alone, nothing changes)
    if (job.index > 0 && !job.theme && !job.vehicle && job.stops[job.index] && friendsOut()) {
      const at = BB.bus.atStop || J.lastStop, from = at && okStop(at) ? at : null;
      const again = nextNear(from, job.stops.slice(0, job.index).concat(at ? [at] : []));
      if (again) { job.stops[job.index] = again; for (let i = job.stops.length - 1; i > job.index; i--) if (job.stops[i] === again) job.stops.splice(i, 1); J.lastJobStops = job.stops.slice(); }
    }
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
    // now and then one of the people getting on is a passenger friend (at most one a job; one not met yet first),
    // never at the last stop, so they ride along for a while before their goodbye
    if (job.q.kind === 'add' && !job.q.group && !job.friendDone && job.index < job.stops.length - 1 && Math.random() < 0.3) { job.q.friend = pickFriend().id; job.friendDone = true; }
    setWaiting(stop, job.q);
    // a 'to' trip: the drive to the place says where the group is going ("Now take the children to the playground!")
    const TH = job.theme && THEMES[job.theme];
    const takeLine = TH && TH.take && job.index > 0 && job.index === job.stops.length - 1 ? TH.take(stop) : null;
    driveTo(stop, bonusLine || takeLine ? 'silent' : quiet);
    if (bonusLine) { BB.emit('job:new', { job, bonus: true }); say(bonusLine, { queue: true }); }
    else if (takeLine && !quiet) say(takeLine, { queue: true });
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
    if (!quiet) say(stopLine(stop, false, hereStop()), { queue: true });          // quiet: true, or 'silent' (another line says it)
  }
  // the friend still on the bus (job.seats), or null
  function friendAboard(job) {
    const seats = job && job.seats; if (!seats) return null;
    for (const k in seats) { const r = seats[k]; if (r && r.friend && +k < (BB.bus.passengers | 0)) { const f = FRIENDS.find((x) => x.id === r.friend); if (f) return f; } }
    return null;
  }
  // a friend's own goodbye, with a happy hop if they're still in view
  async function friendBye(job, f) {
    f = f || job.friendBye; job.friendBye = null;
    if (!f) return;
    const m = J.extras.concat(J.walkers.map((w) => w.m)).find((x) => x.userData.friend === f.id);
    if (m) { m.userData.jump = 1; m.userData.jumpDelay = 0.2; }
    await say(f.bye);
  }
  // everybody off at the end of an everyday job: never the same words twice running
  const END_LINES = ['Last stop! Everybody off. Thank you, bus!', 'Here we are! Everybody off!', 'Last stop! Bye bye, everybody!', 'Last stop! Thank you for riding!'];
  let lastEnd = '';
  const endLine = () => { let l; do l = BB.pick(END_LINES); while (l === lastEnd); lastEnd = l; return l; };
  function onArrive(stop) {
    const job = J.current; if (!job) return;
    setPhase('stop'); J.lastStop = stop;
    BB.bus.openDoors(); BB.sfx.ding();
    const q = job.q;
    // to replay this stop exactly after Home (who sits where too)
    J.stopStart = { job, stop, q, pax0: BB.bus.passengers | 0, seats: Object.assign({}, job.seats || {}), friendBye: job.friendBye || null };
    BB.later(350, () => { if (J.phase === 'stop') runStop(stop, q, (qq, cash) => afterRight(stop, qq, cash)); });
  }
  async function afterRight(stop, q, cash) {
    const job = J.current; if (!job) return;
    job.cash += cash;
    BB.emit('job:stopDone', { correct: true, cash, stop, tries: q.tries, bonus: !!q.bonus });
    if (q.group) job.groupOn = q.k + (q.preStyle ? Math.max(0, q.pre) : 0);   // the themed group now on board
    if (q.bonus) await say('Thank you for stopping in the rain!');
    // a friend got off here (one of the people getting off): their own goodbye, now the question is answered
    if (job.friendBye && J.current === job && J.phase !== 'home' && job.index < job.stops.length - 1) await friendBye(job);
    await wait(250);
    if (J.current !== job || BB.bedtime) return;
    if (J.phase === 'home') {
      job.index++; job.q = null; job.friendBye = null;
      if (job.index >= job.stops.length) { BB.bus.passengers = 0; J.current = null; BB.save.jobsDone = (BB.save.jobsDone | 0) + 1; stampJob(job); BB.saveNow(); }
      return;
    }
    job.index++;
    if (job.index >= job.stops.length) {
      // end of the line: everybody gets off with a wave (so the next job starts fresh, no getting-off warm-ups), each
      // with the thing they got on with (job.seats). A themed trip ends with the group's own goodbye (balloons float
      // up and pop: "Happy birthday!"); a friend on board says theirs as they step off.
      if (job.friendBye) { await friendBye(job); if (J.current !== job || BB.bedtime) return; }   // (a friend got off for this stop's question)
      const all = BB.bus.passengers | 0, T = job.theme ? THEMES[job.theme] : null;
      let line = T ? (typeof T.drop === 'function' ? T.drop() : T.drop) : endLine();
      if (job.theme === 'airport' && !/city/i.test(((stop && stop.id) || '') + ' ' + ((stop && stop.name) || ''))) line = 'Bye bye! Have a lovely trip!';
      if (all > 0) {
        let popped = false;
        const style = { onPop: () => { if (!popped && BB.ui && BB.ui.confetti) { popped = true; BB.ui.confetti(); } } };
        const fr = friendAboard(job);
        await Promise.all([say(line).then(() => (fr && J.current === job ? friendBye(job, fr) : null)), alightPeople(all, null, false, style)]);
        job.friendBye = null;
        if (J.current !== job || BB.bedtime) return;
      } else if (T) { await say(line); if (J.current !== job || BB.bedtime) return; }
      BB.bus.closeDoors();
      jobDone(); return;
    }
    BB.bus.closeDoors();
    if (timeUp()) { bedtime(); return; }     // time is up: this stop is finished, no new one
    setPhase('drive');
    // check the tank before announcing the next stop, so we never say "drive to the shops" then "let's go to the pump"
    // (the next stop is chosen afresh after the pump: job.q is cleared)
    if (J.wantDepot) J.goDepot();
    else if (pumpDue() && (job.q = null, J.goPump('low'))) { /* the job carries on after the pump */ }
    else nextStop();
  }
  // what to say when a job is done: the trip's own words, else never the same twice running
  const DONE_LINES = ['Job done! Great driving!', 'Job done! Everybody got there!', 'All done! What a captain!', 'Job done! Super driving!'];
  const VEH_DONE = { taxi: 'Taxi job done! Great driving!', fire: 'Fire engine job done! What a hero!', ambulance: 'Ambulance job done! Everybody feels better!',
    icecream: 'Ice cream job done! Yum yum!', tow: 'Tow truck job done! Great driving!' };
  let lastDone = '';
  function doneLine(job) {
    let l = job.vehicle ? VEH_DONE[job.vehicle] : job.theme && THEMES[job.theme] ? THEMES[job.theme].done : null;
    if (!l) { do l = BB.pick(DONE_LINES); while (l === lastDone); lastDone = l; }
    return (BB.xmas ? 'Ho ho ho! ' : '') + l;
  }
  // this job's ticket: the ride that did it (save.stamps, the last 5, with save.jobsDone)
  function stampJob(job) {
    BB.save.stamps = (Array.isArray(BB.save.stamps) ? BB.save.stamps : []).concat(String(BB.bus.type || (job && job.vehicle) || BB.save.busType || 'bendy')).slice(-5);
  }
  // every 5th job: a trophy (the jobs are counted in save.jobsDone; the launcher's stars are the same number)
  const trophyLine = (n) => n % 25 === 0 ? `${n} jobs! You are a super bus captain! A big shiny trophy for you!` : BB.pick([`That's ${n} jobs! A trophy for you!`, `Wow, ${n} jobs! Here's a trophy!`]);
  async function jobDone() {
    const job = J.current;
    const n = BB.save.jobsDone = (BB.save.jobsDone | 0) + 1;
    stampJob(job); BB.saveNow();
    BB.depot.add(CASH_JOB, { quiet: true }); job.cash += CASH_JOB;     // (they fly from the banner to the counter)
    J.current = null; setPhase('done');
    BB.sfx.cheer();
    const calm = timeUp() || !!BB.bedtime;
    const wish = celebrateJob(job.cash, n, CASH_JOB, calm), trophy = n % 5 === 0;
    BB.emit('job:done', { cash: job.cash, job, jobs: n, trophy });
    // a happy toot of our own horn (only here: not a honk for the friends nearby), not at bedtime
    if (trophy) BB.later(700, () => { if (BB.ui && BB.ui.confetti) BB.ui.confetti(0.8); if (!timeUp() && !BB.bedtime) { try { BB.sfx.horn(!!(BB.save.upgrades && BB.save.upgrades.horn)); } catch (e) { /* no horn */ } } });
    // one more line at most (once time is up, only the trophy: the goodnight waits for it, main.js): the trophy, else the wish when there are enough coins (now and then: depot.js
    // wishNews, asked only when it will really be said), else "one more job for a trophy", else how many more coins
    // the wish takes
    const wishNews = () => { try { return BB.depot.wishNews ? BB.depot.wishNews('job') : null; } catch (e) { return null; } };
    const extra = () => trophy ? trophyLine(n) : (wish && wish.ready && wishNews()) || (n % 5 === 4 ? 'One more job for a trophy!' : wish && !wish.ready ? wish.line : null);
    await Promise.all([say(doneLine(job)).then(() => { if (J.phase !== 'done' || BB.bedtime || (timeUp() && !trophy)) return null; const l = extra(); return l ? say(l) : null; }), wait((trophy ? 3400 : 2800) + (timeUp() ? 500 : 0))]);   // (time up: the banner has gone before the night comes)
    if (J.phase !== 'done' || BB.bedtime) return;
    if (timeUp()) { bedtime(); return; }
    if (J.wantDepot) J.goDepot();
    else J.start();                        // (J.start goes to the fuel pump first when the tank is low)
  }

  // ---------- vehicles kids can drive: a job kind per vehicle ----------
  // Each vehicle job is a few legs: drive to a place, then a little scene with spoken lines and one or two questions on
  // the card (the vehicle's own pictures + the written sum, every number 0-10, adding and taking away, the same
  // teaching on wrong answers, 1 coin each, never lost). Everything new in bus.js / world.js is feature-detected.
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
  // Where vehicle jobs go: every leg about as long as a bus job's (LEG_MIN-LEG_MAX road units, ~7 s of driving).
  // Targets are world.js scene spots (W.sceneSpots, with tags for what fits there), stops, and the fixed places
  // (W.places.fireStation / clinic, the depot), each used only when it is that close.
  // the scene spots and stops whose tags (world.js: what fits there) include tag ('picnic' | 'icecream' | 'fire' |
  // 'car' | 'yard'), or all of them
  // (the other rides have their own stops: never a bus stop, the owner asked; each gets the ride's own marker there)
  function spots(tag) {
    const W = BB.world, list = (W.sceneSpots || []).filter((s) => s && s.pos && s.edge != null);
    const t = tag ? list.filter((s) => !s.tags || s.tags.indexOf(tag) >= 0) : list;
    return t.length ? t : list;
  }
  const tagged = (tag) => spots().filter((s) => s.tags && s.tags.indexOf(tag) >= 0);   // (only those, maybe none)
  // road distance from `from` (a bay, or null = from where the vehicle is now) to every candidate that could be near
  // enough (a straight line is never longer than the road), nearest first
  function rankNear(from, list, exclude, reach = 135) {
    const p = from ? from.pos : (BB.bus.pos || { x: 0, z: 0 }), out = [];
    for (const s of list) {
      if (!s || !s.pos || s === from || exclude.indexOf(s) >= 0) continue;
      if (hypot2(s.pos.x - p.x, s.pos.z - p.z) > reach) continue;
      const d = stopDist(from, s);
      if (isFinite(d) && d > 1) out.push({ s, d });
    }
    out.sort((x, y) => x.d - y.d);
    // too few short trips to choose from (in the garage yard, or where the near places are a long way round by road,
    // like the one-way seaside and old town roads): look further afield, where the road may come round sooner
    if (reach < 600 && out.filter((o) => o.d >= 25 && o.d <= 160).length < 3) return rankNear(from, list, exclude, reach * 2.2);
    return out;
  }
  // one leg on from `from`: at random among the candidates LEG_MIN-LEG_MAX away (weighted by weight(s)), else the
  // nearest that are a little nearer or further; anything at all as a last resort
  // (spare: second-best candidates, used when none of list is near enough)
  function legTo(from, list, exclude = [], weight = null, spare = null) {
    // friends are out driving: a place of this ride's own near where everybody meets (see meetPick)
    const met = meetPick(from, spare ? list.concat(spare) : list, exclude, weight);
    if (met) { if (met.id) { recentLegs.push(met.id); if (recentLegs.length > 8) recentLegs.shift(); } return met; }
    if (spare) { const r = rankNear(from, list, exclude); if (!r.some((o) => o.d >= 25 && o.d <= 110)) list = list.concat(spare); }
    let ranked = rankNear(from, list, exclude);
    if (!ranked.length) ranked = list.filter((s) => s && s.pos && s !== from && exclude.indexOf(s) < 0).map((s) => ({ s, d: stopDist(from, s) })).filter((o) => isFinite(o.d)).sort((x, y) => x.d - y.d);
    if (!ranked.length) return BB.pick(list);
    let pool = ranked.filter((o) => o.d >= LEG_MIN && o.d <= LEG_MAX);
    // variety: with only a few that close (e.g. leaving the garage), a few a little nearer or further join in
    if (pool.length < 5) {
      // (leaving the garage yard everything is a few hundred units off: the few nearest from the gate then)
      const near0 = (ranked.find((o) => o.d >= 25) || ranked[0]).d, far = Math.max(115, near0 + 120);
      const more = ranked.filter((o) => o.d >= 25 && o.d <= far && pool.indexOf(o) < 0).sort((x, y) => Math.abs(x.d - 60) - Math.abs(y.d - 60));
      pool = pool.concat(more.slice(0, 5 - pool.length));
    }
    if (!pool.length) pool = ranked.filter((o) => o.d >= 25).slice(0, 1);
    if (!pool.length) pool = ranked.slice(0, 1);
    // and not the places of the last few vehicle jobs, while there are others
    // (not a place with the same spoken name as the one just before: "the flats", then "the flats" again)
    const nm = (t) => t && ((t.say && t.say !== 'here') ? t.say : t.near);
    if (from && nm(from)) {
      const dMin = Math.min(...pool.map((o) => o.d)), other = pool.filter((o) => nm(o.s) !== nm(from) && o.d <= dMin + 60);
      if (other.length) pool = other;            // (none near with another name: the spoken line says "the next … stop")
    }
    const recent = recentLegs.slice(-Math.min(8, pool.length - (pool.length >= 4 ? 2 : 1)));   // (always leaves one or two to pick from)
    const fresh = pool.length > 1 ? pool.filter((o) => recent.indexOf(o.s.id) < 0) : pool;
    if (fresh.length) pool = fresh;
    pool = leadPool(pool);
    const bag = []; for (const o of pool) { const n = weight ? weight(o.s) : 1; for (let i = 0; i < n; i++) bag.push(o.s); }
    const t = BB.pick(bag.length ? bag : pool.map((o) => o.s));
    if (t && t.id) { recentLegs.push(t.id); if (recentLegs.length > 8) recentLegs.shift(); }
    return t;
  }
  const recentLegs = [];        // ids of the last few places vehicle jobs went to
  J.legTo = legTo;
  // is a fixed place one short leg on from `from`?
  const isNear = (from, t) => { if (!t || !t.pos) return false; const d = stopDist(from, t); return d >= 25 && d <= LEG_MAX + 15; };
  const place = (name) => { const P2 = BB.world.places; return (P2 && P2[name] && P2[name].pos) ? P2[name] : null; };
  // a target's spoken name: a stop's own ("the swings"), a scene spot's surroundings ("the flats")
  const sayOf = (t) => (t && t.say && t.say !== 'here') ? t.say : (t && t.near) || 'the next spot';
  // where a scene is: "at the beach", or (a plain roadside spot) nothing
  const where = (t) => (t && t.say && t.say !== 'here') ? ` at ${t.say}` : '';

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
      k = BB.randInt(1, Math.max(1, Math.min(L.subK || L.kMax, L.zero && zeroOk() ? n : n - 1)));
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
    // (the bags stand on the pavement by the taxi, where they can be seen and counted)
    bagsIn: (q) => q.kind === 'add'
      ? { n: `${pl(q.n, 'bag', 'bags')} ${isAre(q.n)} by the taxi.`, k: `${q.k} more ${plural(q.k, 'bag comes', 'bags come')}.`, ask: 'How many bags now?' }
      : { n: `${pl(q.n, 'bag', 'bags')} ${isAre(q.n)} by the taxi.`, k: `${q.k} ${plural(q.k, 'is', 'are')} carried home.`, ask: 'How many bags are left?' },
    fighters: (q) => ({ n: `${pl(q.n, 'firefighter is', 'firefighters are')} spraying water.`, k: `${q.k} more ${plural(q.k, 'comes', 'come')} to help.`, ask: 'How many firefighters now?' }),
    windows: (q) => ({ n: `${pl(q.n, 'window has', 'windows have')} smoke.`, k: `${q.k} ${plural(q.k, 'is', 'are')} clear now.`, ask: 'How many windows still have smoke?' }),
    teddies: (q, where = ' at the clinic') => q.kind === 'add'
      ? { n: `${pl(q.n, 'teddy bear is', 'teddy bears are')} in the kit.`, k: `${q.k} more ${plural(q.k, 'goes', 'go')} in.`, ask: 'How many teddy bears now?' }
      : { n: `${pl(q.n, 'teddy bear is', 'teddy bears are')} in the kit.`, k: `${q.k} ${plural(q.k, 'goes', 'go')} to children${where}.`, ask: 'How many teddy bears are left?' },
    // (the ice creams stand on a little stand by the van; each child who buys one takes it)
    sold: (q) => q.kind === 'sub'
      ? { n: `${pl(q.n, 'ice cream is', 'ice creams are')} on the stand.`, k: `${q.k} ${plural(q.k, 'is', 'are')} sold.`, ask: 'How many ice creams are left?' }
      : { n: `${pl(q.n, 'ice cream is', 'ice creams are')} on the stand.`, k: `${q.k} more ${plural(q.k, 'is', 'are')} made.`, ask: 'How many ice creams now?' },
    cones: (q) => ({ n: `${pl(q.n, 'ice cream is', 'ice creams are')} on the stand.`, k: `${q.k} more ${plural(q.k, 'is', 'are')} made.`, ask: 'How many ice creams now?' }),
    yard: (q, lot = 'the yard') => q.kind === 'add'
      ? { n: `${pl(q.n, 'car is', 'cars are')} in ${lot}.`, k: `${q.k} more ${plural(q.k, 'car comes', 'cars come')} in.`, ask: `How many cars are in ${lot} now?` }
      : { n: `${pl(q.n, 'car is', 'cars are')} in ${lot}.`, k: `${q.k} ${plural(q.k, 'is', 'are')} fixed and ${plural(q.k, 'drives', 'drive')} away.`, ask: 'How many cars are left?' },
  };

  // One question on the card: the story (pictures pop in or fade out as it's told), then the ask. Resolves on the
  // right answer (after the praise and the coins), or never if the job stops (Home, bedtime).
  // picture i on the card joins (adding) or goes (taking away)
  function cardStep(q, i) {
    if (!card || !seatEls[i]) return;
    if (q.kind === 'add') setSeat(i, 'new'); else { setSeat(i, 'gone'); seatEls[i].classList.add('bye'); }
    BB.sfx.pop();
  }
  function askScene(q) {
    return new Promise((resolve) => {
      const g = legGen, alive = () => g === legGen && !BB.bedtime && !!J.current && J.phase !== 'home';
      (async () => {
        buildCard(q); J.question = q;
        if (q.scene) { try { q.scene.show(q.n); if (q.scene.prep) q.scene.prep(q); scnFrame(q.scene.points(Math.max(q.n, q.kind === 'add' ? q.n + q.k : q.n)), q.scene.close, q.scene.top, q.scene.pitch); } catch (e) { console.error(e); } }
        await wait(350); if (!alive()) return;
        for (let i = 0; i < q.n; i++) light(i, true);
        showSum('n1'); litSum('n1');
        await say(q.text.n);
        for (let i = 0; i < q.n; i++) light(i, false);
        litSum(null); if (!alive() || !card) return;
        showSum('n2'); litSum('n2');
        // the child does this part by hand (BB.hands): each thing they move is counted aloud and marked on the card
        let hs = null;
        if (q.scene && q.scene.hands && BB.hands) { try { hs = q.scene.hands(q, (i) => cardStep(q, i)); } catch (e) { console.error(e); } }
        if (hs) {
          const done = await BB.hands.run(hs);
          if (!done || !alive() || !card) return;
          await wait(500);
        }
        const pops = [];
        for (let j = 0; j < q.k && !hs; j++) pops.push(wait(250 + j * 380).then(() => {
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
        card.classList.remove('wait');
        await say(q.text.ask);
        if (s2 !== seq || !card) return;
        litSum(null);
      })().catch((e) => console.error(e));
    });
  }
  // people (a family, Auntie, a queue of children) appear by the vehicle's door and hop in, or hop out and walk away
  // meet: async (riders) => {...} while they stand in view at the kerb, before they walk to the door (their hello).
  // (they wait in J.waiting meanwhile, so Home or bedtime clears them away)
  async function hopIn(count, style, meet) {
    const list = [];
    for (let i = 0; i < count; i++) { const m = person(BB.randInt(0, 7), style); m.position.copy(kerbSpot(2.2 + (i % 2) * 0.5, 1 + i * 0.9, false)); list.push(m); J.waiting.push(m); }
    await wait(300);
    if (meet && list.every((m) => m.parent)) {
      // (facing us, so their faces show, with a happy hop: here we are!)
      let face = null; try { const f = doorFrame(false); face = Math.atan2(f.ox, f.oz); } catch (e) { face = null; }
      for (const m of list) { if (face != null) { m.rotation.y = face; m.userData.keepFace = true; } m.userData.jump = 1; m.userData.jumpDelay = 0; }
      try { await meet(list); } catch (e) { console.error(e); }
      for (const m of list) delete m.userData.keepFace;
    }
    if (list.some((m) => !m.parent)) return;                                   // (cleared meanwhile: Home, bedtime)
    J.waiting = J.waiting.filter((m) => list.indexOf(m) < 0);
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
  const SCN = { items: [], extra: [], target: null, n: 0, tick: null, dry: false, look: [] };   // tick(dt): the scene's own per-frame work (the fire)
  // SCN.look[i]: which picture the thing in place i really is (its colour), when it isn't picture i: things carried
  // by hand fill the places in order, whichever one the child picks up first, and the card shows each in its place
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
      bags: Array.from({ length: 10 }, (_, i) => mk((b) => { b.box(0.62, 0.72, 0.36, bagColor(i), 0, 0, 0); b.box(0.63, 0.09, 0.37, P.honeyLight, 0, 0.34, 0); b.box(0.09, 0.26, 0.09, '#3a2a3c', 0, 0.72, 0); })),   // bag i = the card's suitcase i
      // an ice cream: a wafer cone with one scoop; scoop i has the card's colour for ice cream i
      creams: ['#ff8fab', '#fff3d6', '#8b5a3c', '#8fe0c4'].map((c) => mk((b) => {
        b.cyl(0.2, 0.04, 0.5, 7, '#e2b07c', 0, 0, 0); b.ball(0.23, c, 0, 0.58, 0); b.ball(0.06, '#ef5a4b', 0, 0.84, 0);
      })),
      stand: mk((b) => { b.box(5.2, 0.4, 2.2, '#fbf7ee', 0, 0, 0); b.box(5.24, 0.1, 2.24, '#8fd3e8', 0, 0.4, 0); }),   // top at 0.5
      teddy: mk((b) => {
        b.ball(0.3, '#b5793e', 0, 0.3, 0); b.ball(0.24, '#c58a55', 0, 0.76, 0); b.ball(0.1, '#b5793e', -0.18, 0.95, 0); b.ball(0.1, '#b5793e', 0.18, 0.95, 0);
        b.ball(0.09, '#e2b07c', 0, 0.72, 0.2); b.ball(0.09, '#ff8fab', 0, 0.42, 0.26);
      }),
      kit: mk((b) => { b.box(5.4, 0.5, 2.2, '#fbf7ee', 0, 0, 0); b.box(5.44, 0.12, 2.24, '#ff8fab', 0, 0.36, 0); // a coral heart on the side (the ambulance's emblem; never a cross)
        b.ball(0.15, '#ff6b5c', 2.34, 0.27, 1.11, 1, 1, 1, 0.22); b.ball(0.15, '#ff6b5c', 2.56, 0.27, 1.11, 1, 1, 1, 0.22);
        b.box(0.26, 0.26, 0.06, '#ff6b5c', 2.45, 0.04, 1.11, 0, 0, Math.PI / 4); }),
      fighters: [0, 1, 2, 3, 4].map((k) => friendGeo({ shirt: '#3d5a80', skin: SKINS[(k * 3) % 5], hair: '#ef5a4b' }).scale(1.2, 1.2, 1.2)),   // (a bit bigger: easy to count)   // red helmet; firefighter i = the card's i
      // the kiosk with its ten windows (two rows of five, like the card), a pale frame round each pane: one mesh
      kioskWin: mk((b) => {
        b.box(6.8, 4.0, 3.0, '#fbf1dc', 0, 0, 0); b.box(7.2, 0.4, 3.4, '#ef5a4b', 0, 4.0, 0); b.box(7.0, 0.14, 3.2, '#c84a3c', 0, 3.9, 0); b.box(6.82, 0.5, 3.02, '#e2c08d', 0, 0, 0);
        for (let i = 0; i < 10; i++) {
          const x = (i % 5 - 2) * 1.25, y = i < 5 ? 2.55 : 1.25;
          b.box(1.07, 0.97, 0.06, '#fffaf0', x, y - 0.06, 1.5); b.box(0.95, 0.85, 0.08, '#4d6f8a', x, y, 1.51); b.box(0.42, 0.85, 0.09, '#5f86a3', x - 0.2, y, 1.51);
          b.box(1.16, 0.1, 0.16, '#c84a3c', x, y - 0.1, 1.52);
        }
      }),
      // a puff of smoke coming out of a window (it sits on the pane's lower edge and leans out toward the viewer)
      smoke: mk((b) => { b.ball(0.36, '#8a8290', 0, 0.5, 0.25); b.ball(0.28, '#a8a0ae', 0.26, 0.72, 0.36); b.ball(0.26, '#9a93a0', -0.25, 0.74, 0.3); b.ball(0.24, '#bdb6c2', 0.02, 1.0, 0.42); }),
    };
    return SGEO;
  }
  // a tray of slots: 'out' units onto the pavement, 'along' units along the vehicle from its front door, sp apart;
  // stag = how far the second (nearer) row stands to the side, in slots: half a slot puts each thing in the near row
  // between two in the far row, so both rows read from a low view (like the seats in the bus)
  function tray(out, along, sp, rowSp, y = 0, stag = 0) {
    const f = doorFrame(false);
    const fn = (i) => { const r = Math.floor(i / 5), c = i % 5 + r * stag; return new THREE.Vector3(f.d.x + f.ox * (out + r * rowSp) + f.fx * (along - c * sp), GROUND + y, f.d.z + f.oz * (out + r * rowSp) + f.fz * (along - c * sp)); };
    fn.mid = () => fn(0).lerp(fn(9), 0.5);           // the middle of the whole tray
    fn.f = f; fn.face = Math.atan2(f.ox, f.oz);        // facing the stop camera (out onto the pavement)
    return fn;
  }
  // batch: one of many little things that share a shape (teddies, ice creams, firefighters, cars): they are drawn
  // together, one instanced mesh per shape (scnBatch), each keeping an empty object of its own that moves as before;
  // a number instead of true is its size too (the little things a fifth bigger on a phone)
  function scnMesh(geo, pos, rotY, pop, batch) {
    const sc = typeof batch === 'number' ? batch : 1;
    let m = batch ? new THREE.Object3D() : null;
    if (m && !scnBatchAdd(geo, m)) m = null;           // (a full batch: a mesh of its own)
    if (!m) m = new THREE.Mesh(geo, BB.mk.mat);
    m.position.copy(pos); m.rotation.y = rotY || 0; m.name = 'sceneItem';
    BB.scene.add(m);
    m.userData.sc = sc;
    if (sc !== 1) m.scale.setScalar(sc);
    if (pop) { m.scale.setScalar(0.01); tween(0.3, (t) => m.scale.setScalar(sc * Math.max(0.01, t < 0.7 ? t / 0.7 * 1.15 : 1.15 - (t - 0.7) / 0.3 * 0.15))); }
    return m;
  }
  const BATCHES = new Map();          // shape -> { mesh (one instanced mesh), list (the things' own objects) }
  function scnBatchAdd(geo, o) {
    let b = BATCHES.get(geo);
    if (!b) { const mesh = new THREE.InstancedMesh(geo, BB.mk.mat, 12); mesh.name = 'sceneItem'; mesh.frustumCulled = false; mesh.count = 0; b = { mesh, list: [] }; BATCHES.set(geo, b); }
    if (b.list.length >= 12) return false;
    if (!b.mesh.parent) BB.scene.add(b.mesh);
    b.list.push(o); o.userData.batch = b;
    return true;
  }
  // every frame: each instance where its thing is (an empty batch leaves the scene)
  function scnBatchSync() {
    for (const b of BATCHES.values()) {
      if (!b.mesh.parent) continue;
      let n = 0;
      for (const o of b.list) { if (!o.parent) continue; o.updateMatrixWorld(); b.mesh.setMatrixAt(n++, o.matrixWorld); }
      b.mesh.count = n;
      if (n) b.mesh.instanceMatrix.needsUpdate = true; else b.mesh.parent.remove(b.mesh);
    }
  }
  // (userData.own: this mesh's geometry or instance buffers were made for it alone, so they are freed with it)
  const scnDrop = (m) => {
    if (!m) return;
    if (m.userData.batch) { const L = m.userData.batch.list, k = L.indexOf(m); if (k >= 0) L.splice(k, 1); m.userData.batch = null; }
    if (m.parent) m.parent.remove(m);
    if (m.userData.own) { if (m.isInstancedMesh) m.dispose(); else m.geometry.dispose(); }
  };
  function scnClear() {
    for (const m of SCN.items.concat(SCN.extra)) scnDrop(m);
    SCN.items = []; SCN.extra = []; SCN.tick = null; SCN.dry = false; SCN.look = [];
    for (const b of BATCHES.values()) { for (const o of b.list) { o.userData.batch = null; if (o.parent) o.parent.remove(o); } b.list.length = 0; b.mesh.count = 0; if (b.mesh.parent) b.mesh.parent.remove(b.mesh); }
    if (BB.hands) BB.hands.stop();
    if (BB.water) BB.water.clear();
    if (SCN.target) { delete SCN.target.frame; delete SCN.target.frameKey; delete SCN.target.frameClose; delete SCN.target.framePitch; delete SCN.target.blockers; SCN.target = null; vcall(['reframe']); }
    SCN.blockers = [];
  }
  J._scnClear = scnClear;
  // ask the scene camera to show these world points too
  // (close = a close-up of just these points, up to `top` high: the vehicle itself may then be out of the picture;
  // pitch = the least the camera looks down, in degrees: two rows of little things on a tray both show from above)
  function scnFrame(pts, close, top, pitch) {
    const job = J.current, t = job && job.legs && job.legs[job.index] && job.legs[job.index].to;
    if (!t || !pts.length) return;
    t.frame = pts.map((p) => ({ x: p.x, y: 0, z: p.z })).concat(pts.map((p) => ({ x: p.x, y: top || 2.4, z: p.z })));
    t.frameKey = 'scn' + (++frameNo);
    t.frameClose = !!close;
    t.framePitch = +pitch || 0;
    t.blockers = (SCN.blockers || []).slice();      // the scene's big props: the camera mustn't look past them (bus.js)
    SCN.target = t;
    vcall(['reframe']);
  }
  // Scene kinds: { show(n) (make sure n are there), add(i) (one more arrives), remove(i) (one goes), points(count),
  //   prep(q) (set the stage before the story: the things still to come, the children waiting),
  //   hands(q, step) -> the hands-on moment for the story's "k" part (BB.hands.run's options; step(i) marks picture
  //   i on the card) }. In a hands-on moment thing i in 3D is always picture i on the card (same colour, same place).
  // a thing hops from where it is to `to` in a little arc
  function scnHop(m, to, h, dur) {
    const a = m.position.clone();
    return tween(dur, (t) => { m.position.lerpVectors(a, to, t); m.position.y = a.y + (to.y - a.y) * t + Math.sin(t * Math.PI) * h; });
  }
  // Things the child will touch one by one (the bags still to come, the children waiting for a teddy) need room for
  // a ring each: where the planned view shows a row of them closer together than that, they step apart along their
  // own line, as far as the screen has room (where it hasn't, the moment shows one ring at a time: hands.js).
  const _q2 = new THREE.Vector3();
  function spreadRow(list) {
    if (list.length < 2 || !BB.hands || !BB.hands.size) return;
    const T = BB.hands.size() + 4, cam = viewCam(), W = innerWidth, H = innerHeight;
    const px = (p) => { _v.copy(p).project(cam); return (_v.x + 1) / 2 * W; }, py = () => (1 - _v.y) / 2 * H;
    const a = list[0].position;
    let mn = 1e9;
    for (let i = 1; i < list.length; i++) { const x1 = px(list[i].position), y1 = py(), x0 = px(list[i - 1].position), y0 = py(); mn = Math.min(mn, hypot2(x1 - x0, y1 - y0)); }
    if (mn >= T) return;
    let f = Math.min(2.6, T / Math.max(8, mn));
    // (not off the screen, not behind the card on a phone)
    const c = document.querySelector('.bbq'), cr = c ? c.getBoundingClientRect() : null;
    const x0 = (H <= 520 ? (cr ? cr.right : 345) : 0) + T / 2 + 2, x1 = W - T / 2 - 2;
    for (let tries = 0; tries < 8 && f > 1.03; tries++) {
      let fits = true;
      for (let i = 1; i < list.length && fits; i++) { const p = list[i].position; const x = px(_q2.set(a.x + (p.x - a.x) * f, p.y, a.z + (p.z - a.z) * f)); if (x < x0 || x > x1) fits = false; }
      if (fits) break;
      f = 1 + (f - 1) * 0.75;
    }
    if (f <= 1.03) return;
    for (let i = 1; i < list.length; i++) {
      const m = list[i], bx = m.position.x, bz = m.position.z, tx = a.x + (bx - a.x) * f, tz = a.z + (bz - a.z) * f;
      tween(0.3, (t) => { m.position.x = bx + (tx - bx) * t; m.position.z = bz + (tz - bz) * t; });
    }
  }
  // "Tap the fire engine", "tap the van": the whole vehicle is the target (its body's box on screen), and the hand
  // taps the spot the things come out of
  const rideTarget = (at) => (typeof BB.bus.bodyBox === 'function' ? { at: (out) => out.copy(at), box: BB.bus.bodyBox([]) } : (out) => out.copy(at));
  // Taking away: the last k things can be touched, in any order, and the ones left always fill the first places,
  // like the card's pictures: when one is taken from the middle of those k, the last one left moves into its place
  // (and the card's pictures swap with them), so neither the tray nor the card ever shows a gap in the middle.
  // The one that moves over never passes through the others: bags and ice creams hop high over them in an arc,
  // cars (too big to hop) shrink away and pop up again in the empty space once the car going home has left it.
  // targets: one per thing (its ring follows the thing itself, also while it moves over); place(t): where target
  // t's thing stands now; take(j, t): the j-th one taken is target t's thing: makes the move and returns the place
  // that empties (the last one left), which then holds the thing taken; bubble: the number bubble rides along with
  // the thing that leaves, `top` above it (never stays on a place another thing then fills).
  function takeAway(q, slot, dy, slide, top) {
    const where = Array.from({ length: q.k }, (_, t) => q.n - 1 - t), gone = [];
    const sc = (m) => m.userData.sc || 1;
    const mine = (m) => (m.userData.mv = (m.userData.mv || 0) + 1);     // a newer move stops an older one
    const moveOver = (m, to) => {
      const tk = mine(m), a0 = m.position.clone(), s0 = sc(m);
      if (slide) {       // a car: shrinks away, waits for the space to clear, pops up in it
        return tween(0.25, (k) => { if (m.userData.mv === tk) m.scale.setScalar(s0 * Math.max(0.01, 1 - k)); })
          .then(() => tween(0.45, () => {}))      // (game time, like the car going home)
          .then(() => { if (m.userData.mv !== tk) return null; m.position.copy(to); BB.sfx.pop && BB.sfx.pop();
            return tween(0.3, (k) => { if (m.userData.mv === tk) m.scale.setScalar(s0 * Math.max(0.01, k < 0.7 ? k / 0.7 * 1.15 : 1.15 - (k - 0.7) / 0.3 * 0.15)); }); });
      }
      const h = 1.9 * s0;   // (higher than a bag or an ice cream, wherever it passes over one)
      return tween(0.6, (k) => { if (m.userData.mv !== tk) return; m.position.lerpVectors(a0, to, k); m.position.y = a0.y + (to.y - a0.y) * k + Math.sin(k * Math.PI) * h; });
    };
    const at = (t, out) => { const m = gone[t] || SCN.items[where[t]], p = slot(where[t]); out.copy(p); if (m && !gone[t]) { out.x = m.position.x; out.z = m.position.z; } out.y = p.y + dy; return out; };
    return {
      targets: where.map((_, t) => (out) => at(t, out)),
      place: (t) => where[t],
      bubble: (j, t, out) => { const m = gone[t] || SCN.items[where[t]]; if (m) { out.copy(m.position); out.y += top * sc(m); } else at(t, out); return out; },
      take(j, t) {
        const i = where[t], last = q.n - 1 - j, it = SCN.items[i];
        if (it) { mine(it); it.scale.setScalar(sc(it)); gone[t] = it; }   // (stop it moving over, whole again: it goes)
        if (i !== last) {
          const mv = SCN.items[last]; SCN.items[last] = SCN.items[i]; SCN.items[i] = mv;
          const a = SCN.look[i] != null ? SCN.look[i] : i; SCN.look[i] = SCN.look[last] != null ? SCN.look[last] : last; SCN.look[last] = a;
          for (let u = 0; u < where.length; u++) if (where[u] === last) where[u] = i;
          if (mv) moveOver(mv, slot(i));
          cardPic(i); cardPic(last);
        }
        return last;
      },
    };
  }
  function yardScene(lot = 'the yard') {
    const G = sceneGeos(), slot = tray(3.8, -1.5, 2.5, 4.6);
    const make = (i, pop) => scnMesh(G.cars[i % 5], slot(i), slot.face, pop, true);
    // the cars still to come queue up ahead of the spaces, turned the other way (nose toward the car park, as if
    // driving in), with a wide gap before the parked ones, so they never read as part of the parked row: two in a
    // line, the next two in a nearer line between them (each car a ring apart on screen), three in a line past four
    let per = 2;
    const queue = (j) => { const r = Math.floor(j / per); return kerbSpot(3.8 + r * 2.9, 4.6 + (j % per) * 4.6 + (r % 2) * 2.3, false); };
    const queueFace = Math.atan2(-slot.f.fx, -slot.f.fz);
    let coming = [];
    const S = {
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
      prep(q) {
        coming = [];
        if (q.kind !== 'add') return;
        per = q.k > 4 ? 3 : 2;
        for (let j = 0; j < q.k; j++) { const m = make(q.n + j, true); m.position.copy(queue(j)); m.rotation.y = queueFace; coming.push(m); SCN.extra.push(m); }
      },
      hands(q, step) {
        if (q.kind === 'add') {
          return { kind: 'drag', count: q.k, plane: GROUND, say: `Park ${pl(q.k, 'more car', 'more cars')}!`, hint: 'Tap a car, or pull it to the green ring!',
            targets: coming.map((m) => (out) => { out.copy(m.position); out.y += 0.8; return out; }), drop: (out, idx, j) => out.copy(slot(q.n + j)),
            drag: (idx, p) => { if (p) coming[idx].position.set(p.x, GROUND, p.z); },
            bubble: (j, idx, out) => { out.copy(slot(q.n + j)); out.y += 1.9; },
            act: (j, idx) => {
              const m = coming[idx], i = q.n + j, a = m.position.clone(), to = slot(i);
              SCN.extra = SCN.extra.filter((x) => x !== m); SCN.items[i] = m; SCN.look[i] = q.n + idx; step(i);
              m.rotation.y = Math.atan2(to.x - a.x, to.z - a.z);
              return tween(0.8, (t) => { const e = 1 - (1 - t) * (1 - t); m.position.lerpVectors(a, to, e); if (t >= 1) m.rotation.y = slot.face; });
            } };
        }
        const ta = takeAway(q, slot, 0.8, true, 1.9);
        return { kind: 'tap', count: q.k, say: `Tap ${pl(q.k, 'car', 'cars')} to send ${plural(q.k, 'it', 'them')} home!`, hint: 'Tap a car!',
          targets: ta.targets, bubble: ta.bubble, bubbleFollow: true, act: (j, t) => { const i = ta.take(j, t); step(i); S.remove(i); } };
      },
      // (the cars stand between the camera and the truck: the camera looks over them, not through them)
      points: (c) => { const pts = Array.from({ length: Math.max(1, c) }, (_, i) => slot(i)); SCN.blockers = pts.map((p) => ({ x: p.x, z: p.z, hw: 0.95, hd: 1.9, ry: slot.face, y0: 0, top: GROUND + 1.75 }));
        return pts.concat(pts.map((p) => p.clone().add(new THREE.Vector3(slot.f.ox * 1.9, 0, slot.f.oz * 1.9))), coming.map((m) => m.position.clone().add(new THREE.Vector3(slot.f.fx * 2.0 + slot.f.ox * 1.0, 0, slot.f.fz * 2.0 + slot.f.oz * 1.0)))); },   // (and their far ends)
    };
    return S;
  }
  function bagScene() {
    const big = innerHeight <= 520 ? 1.2 : 1;            // (on phones the little things are a fifth bigger, and so is the tray)
    const G = sceneGeos(), slot = tray(2.5, -2.2, 0.95 * big, 1.3 * big, 0, 0.5), from = kerbSpot(3.2, 2.0, false);
    const make = (i, pop) => scnMesh(G.bags[i % 10], slot(i), slot.face, pop, big !== 1 ? big : false);
    // the bags still to come stand in a little row by the family
    const pile = (j) => kerbSpot(3.2 + Math.floor(j / 5) * 1.0, 1.0 + (j % 5) * 1.0, false);
    let coming = [];
    const S = {
      pitch: 26,          // (from a little above, the near row a long step nearer and between the far one's things: both rows read)
      show(n) { while (SCN.items.length < n) SCN.items.push(make(SCN.items.length, false)); },
      add(i) {          // swung from the family into the boot
        const m = make(i, false), to = slot(i); m.position.copy(from); SCN.items[i] = m;
        tween(0.7, (t) => { m.position.lerpVectors(from, to, t); m.position.y = GROUND + Math.sin(t * Math.PI) * 1.6; });
      },
      remove(i) {       // carried home: lifted out onto the pavement, then it hops off along it and is gone (so the
                        // bags left by the taxi are the only ones there to count)
        const m = SCN.items[i]; if (!m) return; SCN.items[i] = null; SCN.extra.push(m);
        const a = m.position.clone(), to = a.clone().add(new THREE.Vector3(slot.f.ox * 1.8, 0, slot.f.oz * 1.8));
        const away = to.clone().add(new THREE.Vector3(slot.f.ox * 2.5 - slot.f.fx * 4, 0, slot.f.oz * 2.5 - slot.f.fz * 4));
        return tween(0.55, (t) => { m.position.lerpVectors(a, to, t); m.position.y = GROUND + Math.sin(t * Math.PI) * 1.0; })
          .then(() => wait(250))
          .then(() => tween(0.75, (t) => { m.position.lerpVectors(to, away, t); m.position.y = GROUND + Math.abs(Math.sin(t * Math.PI * 3)) * 0.35; m.scale.setScalar((m.userData.sc || 1) * Math.max(0.01, 1 - t * t)); }))
          .then(() => { SCN.extra = SCN.extra.filter((x) => x !== m); scnDrop(m); });
      },
      prep(q) {
        coming = [];
        if (q.kind !== 'add') return;
        for (let j = 0; j < q.k; j++) { const m = make(q.n + j, true); m.position.copy(pile(j)); coming.push(m); SCN.extra.push(m); }
      },
      hands(q, step) {
        if (q.kind === 'add') {
          spreadRow(coming);
          return { kind: 'drag', count: q.k, plane: GROUND + 0.4, say: `Put ${pl(q.k, 'more bag', 'more bags')} by the taxi!`, hint: 'Tap a bag, or pull it to the green ring!',
            targets: coming.map((m) => (out) => { out.copy(m.position); out.y += 0.4; return out; }), drop: (out, idx, j) => { out.copy(slot(q.n + j)); out.y += 0.4; return out; },
            drag: (idx, p) => { if (p) coming[idx].position.set(p.x, GROUND + 0.45, p.z); },
            bubble: (j, idx, out) => { out.copy(slot(q.n + j)); out.y += 1.0; },
            act: (j, idx) => { const m = coming[idx], i = q.n + j; SCN.extra = SCN.extra.filter((x) => x !== m); SCN.items[i] = m; SCN.look[i] = q.n + idx; step(i); return scnHop(m, slot(i), 1.2, 0.55); } };
        }
        const ta = takeAway(q, slot, 0.4, false, 1.0);
        return { kind: 'tap', count: q.k, say: `Tap ${pl(q.k, 'bag', 'bags')} to carry home!`, hint: 'Tap the glowing bag!',
          targets: ta.targets, bubble: ta.bubble, bubbleFollow: true, act: (j, t) => { const i = ta.take(j, t); step(i); S.remove(i); } };
      },
      points: (c) => Array.from({ length: Math.max(1, c) }, (_, i) => slot(i)).concat([from], coming.map((m) => m.position.clone())),
    };
    return S;
  }
  function teddyScene() {
    const big = innerHeight <= 520 ? 1.2 : 1;            // (on phones the teddies are a fifth bigger, and so are the kit and its spacing)
    const G = sceneGeos(), slot = tray(2.7, -0.9, 0.95 * big, 1.3 * big, 0.5, 0.5);
    if (!SCN.extra.some((m) => m.userData.kit)) {        // the kit box under the teddies
      const c = slot.mid(); c.y -= 0.5;
      const kit = scnMesh(G.kit, c, Math.atan2(slot.f.fx, slot.f.fz) + Math.PI / 2, false); kit.userData.kit = true; SCN.extra.push(kit);
      if (big !== 1) kit.scale.set(big, 1, big);
    }
    const make = (i, pop) => scnMesh(G.teddy, slot(i), slot.face, pop, big !== 1 ? big : true);
    // the teddies still to go in sit on the pavement beside the kit
    const pile = (j) => kerbSpot(3.1 + Math.floor(j / 5) * 0.9, 0.5 + (j % 5) * 0.9, false);
    let coming = [], kids = [];
    const S = {
      pitch: 26,          // (from a little above, the near row a long step nearer and between the far one's things: both rows read)
      show(n) { while (SCN.items.length < n) SCN.items.push(make(SCN.items.length, false)); },
      add(i) { SCN.items[i] = make(i, true); },
      remove(i, kid) {       // a teddy hops off to a child
        const m = SCN.items[i]; if (!m) return; SCN.items[i] = null;
        const a = m.position.clone(), to = kid ? kid.position.clone().add(new THREE.Vector3(0, 0.75, 0)) : a.clone().add(new THREE.Vector3(slot.f.ox * 3, -0.5, slot.f.oz * 3));
        return tween(0.7, (t) => { m.position.lerpVectors(a, to, t); m.position.y += Math.sin(t * Math.PI) * 1.2; }).then(() => {
          scnDrop(m);
          if (kid && kid.parent) { const h = new THREE.Mesh(G.teddy, BB.mk.mat); h.scale.setScalar(0.6); h.position.set(0, 0.62, 0.34); kid.add(h); kid.userData.jump = 1; kid.userData.jumpDelay = 0; }   // hugged
        });
      },
      prep(q) {
        coming = []; kids = [];
        if (q.kind === 'add') { for (let j = 0; j < q.k; j++) { const m = make(q.n + j, true); m.position.copy(pile(j)); coming.push(m); SCN.extra.push(m); } return; }
        // one child for each teddy that goes, waiting in a row by the door
        clearWaiting();
        for (let j = 0; j < q.k; j++) {
          const m = person(BB.randInt(0, 7), { kid: true });
          m.position.copy(kerbSpot(3.1, 1.0 + j * 1.15, false)); m.rotation.y = slot.face; m.userData.seed = Math.random() * 6;   // one row, well apart
          J.waiting.push(m); kids.push(m);
        }
      },
      hands(q, step) {
        if (q.kind === 'add') {
          spreadRow(coming);
          return { kind: 'drag', count: q.k, plane: GROUND + 0.4, say: `Put ${pl(q.k, 'more teddy bear', 'more teddy bears')} in the kit!`, hint: 'Tap a teddy bear, or pull it to the green ring!',
            targets: coming.map((m) => (out) => { out.copy(m.position); out.y += 0.5; return out; }), drop: (out, idx, j) => out.copy(slot(q.n + j)),
            drag: (idx, p) => { if (p) coming[idx].position.set(p.x, GROUND + 0.4, p.z); },
            bubble: (j, idx, out) => { out.copy(slot(q.n + j)); out.y += 1.2; },
            act: (j, idx) => { const m = coming[idx], i = q.n + j; SCN.extra = SCN.extra.filter((x) => x !== m); SCN.items[i] = m; SCN.look[i] = q.n + idx; step(i); return scnHop(m, slot(i), 1.1, 0.55); } };
        }
        spreadRow(kids);
        return { kind: 'tap', count: q.k, say: `Tap ${pl(q.k, 'child', 'children')} to give a teddy bear!`, hint: 'Tap a child!',
          targets: kids.map((m) => ({ at: (out) => { out.copy(m.position); out.y = GROUND + 0.85; return out; }, feet: (out) => { out.copy(m.position); out.y = GROUND; return out; } })),
          bubble: (j, t, out) => { out.copy(kids[t].position); out.y = GROUND + 1.75; },
          act: (j, t) => { const i = q.n - 1 - j; step(i); return S.remove(i, kids[t]); } };
      },
      points: () => Array.from({ length: 10 }, (_, i) => slot(i)).concat(coming.map((m) => m.position.clone()), kids.map((m) => m.position.clone())),   // (the whole kit)
    };
    return S;
  }
  // the ice cream van's stand: two rows of five ice creams (like the card's ten-frame); a sold one goes to the next
  // child in the queue (who hops with joy), a new one pops on
  function iceScene() {
    const big = innerHeight <= 520 ? 1.2 : 1;            // (on phones the ice creams are a fifth bigger, and so are the stand and its spacing)
    const G = sceneGeos(), slot = tray(2.7, -0.9, 0.95 * big, 1.3 * big, 0.5, 0.5);
    if (!SCN.extra.some((m) => m.userData.stand)) {
      const c = slot.mid(); c.y -= 0.5;
      const st = scnMesh(G.stand, c, Math.atan2(slot.f.fx, slot.f.fz) + Math.PI / 2, false); st.userData.stand = true; SCN.extra.push(st);
      if (big !== 1) st.scale.set(big, 1, big);
    }
    const make = (i, pop) => scnMesh(G.creams[i % 4], slot(i), slot.face, pop, big !== 1 ? big : true);
    const hatchP = new THREE.Vector3(slot.f.d.x + slot.f.ox * 0.2, GROUND + 1.55, slot.f.d.z + slot.f.oz * 0.2);   // the serving hatch
    let served = 0;
    const S = {
      pitch: 26,          // (from a little above, the near row a long step nearer and between the far one's things: both rows read)
      show(n) { while (SCN.items.length < n) SCN.items.push(make(SCN.items.length, false)); },
      add(i) { SCN.items[i] = make(i, true); },
      remove(i) {
        const m = SCN.items[i]; if (!m) return; SCN.items[i] = null;
        const kid = J.waiting[served++], a = m.position.clone();
        const to = kid ? kid.position.clone().add(new THREE.Vector3(0, 1.0, 0)) : a.clone().add(new THREE.Vector3(slot.f.ox * 3, 0, slot.f.oz * 3));
        return tween(0.6, (t) => { m.position.lerpVectors(a, to, t); m.position.y += Math.sin(t * Math.PI) * 1.0; }).then(() => { scnDrop(m); if (kid) { kid.userData.jump = 1; kid.userData.jumpDelay = 0; } });
      },
      prep() {},
      hands(q, step) {
        if (q.kind === 'add') {       // each tap on the van makes one more: it comes out of the hatch and hops onto the stand
          return { kind: 'tap', count: q.k, repeat: true, say: `Tap the van to make ${pl(q.k, 'more ice cream', 'more ice creams')}!`, hint: 'Tap the ice cream van!',
            targets: [rideTarget(hatchP)],
            bubble: (j, idx, out) => { out.copy(slot(q.n + j)); out.y += 1.2; },
            act: (j) => { const i = q.n + j, m = make(i, true); m.position.copy(hatchP); SCN.items[i] = m; step(i); jingle(); return scnHop(m, slot(i), 0.9, 0.6); } };
        }
        // one ice cream for each child in the queue (who step apart where the view shows them in a clump)
        spreadRow(J.waiting);
        const kidP = new THREE.Vector3(), ta = takeAway(q, slot, 0.45, false, 1.2);
        return { kind: 'drag', count: q.k, plane: GROUND + 0.9, say: `Give ${pl(q.k, 'child', 'children')} an ice cream!`, hint: 'Tap an ice cream, or pull it to a child!',
          targets: ta.targets,
          dropFlat: true, drop: (out) => { const kid = J.waiting[Math.min(served, J.waiting.length - 1)]; if (kid) { kidP.copy(kid.position); kidP.y = GROUND; } return out.copy(kidP); },
          drag: (t, p) => { const m = SCN.items[ta.place(t)]; if (m && p) m.position.set(p.x, GROUND + 0.9, p.z); },
          bubble: (j, t, out) => { const kid = J.waiting[Math.min(j, J.waiting.length - 1)]; if (kid) { out.copy(kid.position); out.y = GROUND + 2.0; } else out.copy(slot(ta.place(t))); },
          act: (j, t) => { const i = ta.take(j, t); step(i); return S.remove(i); } };
      },
      points: () => Array.from({ length: 10 }, (_, i) => slot(i)).concat(J.waiting.map((k) => k.position)),   // (the whole stand)
    };
    return S;
  }
  // a hose (or any tube) along a list of points, as open five-sided pipes in the builder
  const TUBE = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), _up = new THREE.Vector3(0, 1, 0);
  function tube(b, pts, r, color) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1], d = new THREE.Vector3().subVectors(c, a), len = d.length();
      if (len < 0.001) continue;
      b.addM(TUBE, color, new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, c).multiplyScalar(0.5),
        new THREE.Quaternion().setFromUnitVectors(_up, d.multiplyScalar(1 / len)), new THREE.Vector3(r, len * 1.12, r)));
    }
  }
  // the fire: a kiosk with a 2x5 grid of windows (the smoky ones puff smoke) and a line of firefighters, each with
  // a hose from the engine, spraying an arc of water onto the wall (BB.water). The kiosk and its ten windows are
  // one mesh, all the smoke is one instanced mesh, all the hoses one mesh, all the water one instanced mesh.
  function fireScene(smoky) {
    const G = sceneGeos(), f = doorFrame(false), Wt = BB.water;
    const face = Math.atan2(f.ox, f.oz), base = kerbSpot(3.2, 12.5, false);   // ahead of the engine, beside the camera's view (not in front of it)
    const kiosk = scnMesh(G.kioskWin, base, face, false); SCN.extra.push(kiosk);
    SCN.blockers = [{ x: base.x, z: base.z, hw: 3.6, hd: 1.7, ry: face, y0: 0, top: GROUND + 4.4 }];
    const wins = [];              // the middle of each window pane
    // (window 0 at the top left as the camera sees it, like picture 0 on the card: the camera looks from the pavement
    // side, so the front of the vehicle is to the left)
    for (let i = 0; i < 10; i++) { const r = Math.floor(i / 5), side = (2 - i % 5) * 1.25; wins.push(new THREE.Vector3(base.x + f.ox * 1.6 + f.fx * side, GROUND + (r ? 1.25 : 2.55) + 0.42, base.z + f.oz * 1.6 + f.fz * side)); }
    // smoke: a puff out of each smoky window, billowing; it shrinks away when the window is sprayed clear
    const sm = new THREE.InstancedMesh(G.smoke, BB.mk.mat, 10); sm.name = 'sceneItem'; sm.frustumCulled = false; sm.userData.own = true;
    BB.scene.add(sm); SCN.extra.push(sm);
    const amt = [], want = [], dwell = [];
    for (let i = 0; i < 10; i++) { amt[i] = want[i] = i < smoky ? 1 : 0; dwell[i] = 0; }
    // one tidy line along the pavement, well apart, out in front of the kiosk's wall (so the water reaches the
    // windows), each one easy to count: from just short of the kiosk back along the engine
    const FOUT = 6.6, slots = [], nozz = [];
    for (let i = 0; i < 10; i++) {
      const al = 8.2 - i * 1.6;
      slots.push(new THREE.Vector3(f.d.x + f.ox * FOUT + f.fx * al, GROUND, f.d.z + f.oz * FOUT + f.fz * al));
      nozz.push(new THREE.Vector3(slots[i].x + f.fx * 0.62 + f.ox * 0.3, GROUND + 1.42, slots[i].z + f.fz * 0.62 + f.oz * 0.3));
    }
    const fdir = Math.atan2(f.fx, f.fz), ready = [];
    const ends = [-3.9, 0, 3.9].map((al) => new THREE.Vector3(base.x + f.ox * 1.6 + f.fx * al, GROUND, base.z + f.oz * 1.6 + f.fz * al));   // the kiosk's front, end to end
    let hose = null, time = 0, aimOn = false, sweeping = false, aimQ = null;
    const aimP = new THREE.Vector3(), _a = new THREE.Vector3(), _l = new THREE.Vector3(), _sc = new THREE.Vector3(), _mm = new THREE.Matrix4();
    const wall = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(f.ox, 0, f.oz), wins[0]);
    function hoses() {
      if (hose) { SCN.extra = SCN.extra.filter((m) => m !== hose); scnDrop(hose); }
      const b = BB.mk.builder(), g = GROUND + 0.08;
      for (let i = 0; i < 10; i++) {
        if (!ready[i]) continue;
        const s = slots[i], px = f.d.x - f.fx * (1.9 + i * 0.13), pz = f.d.z - f.fz * (1.9 + i * 0.13), V = (x, y, z) => new THREE.Vector3(x, y, z);
        const path = new THREE.CatmullRomCurve3([
          V(px, 0.95, pz), V(px + f.ox * 0.5, 0.45, pz + f.oz * 0.5), V(px + f.ox * 1.1, g, pz + f.oz * 1.1),
          V((px + s.x) / 2 + f.ox * 1.2, g, (pz + s.z) / 2 + f.oz * 1.2), V(s.x - f.fx * 0.45 + f.ox * 0.3, g, s.z - f.fz * 0.45 + f.oz * 0.3),
          V(s.x + f.fx * 0.05 + f.ox * 0.32, GROUND + 1.0, s.z + f.fz * 0.05 + f.oz * 0.32), V(nozz[i].x - f.fx * 0.3, nozz[i].y - 0.1, nozz[i].z - f.fz * 0.3)]).getPoints(16);
        tube(b, path, 0.07, '#f5b83d');
        tube(b, [V(nozz[i].x - f.fx * 0.34, nozz[i].y - 0.12, nozz[i].z - f.fz * 0.34), nozz[i]], 0.1, '#5a5260');      // the nozzle
        b.ball(0.12, '#ef5a4b', nozz[i].x, nozz[i].y, nozz[i].z);
      }
      hose = b.mesh(); hose.name = 'sceneItem'; hose.userData.own = true; BB.scene.add(hose); SCN.extra.push(hose);
    }
    const fighter = (i, pop) => scnMesh(G.fighters[i % 5], slots[i], fdir, pop, true);
    const arrive = (i) => { ready[i] = true; hoses(); };
    // where firefighter i sprays when nobody aims: its own patch of the wall above the windows, swaying a little
    function restAt(i, out) {
      const al = Math.min(2.9, -2.8 + i * 0.62) + Math.sin(time * 1.3 + i * 1.9) * 0.22;
      return out.set(base.x + f.ox * 1.6 + f.fx * al, GROUND + 3.55 + (i % 2) * 0.18 + Math.sin(time * 1.7 + i) * 0.1, base.z + f.oz * 1.6 + f.fz * al);
    }
    SCN.tick = function (dt) {
      time += dt;
      if (aimOn && !sweeping && !BB.hands.active()) aimOn = false;
      for (let i = 0; i < 10; i++) {
        if (!ready[i]) continue;
        if (aimOn) _a.set(aimP.x + f.fx * ((i % 3) - 1) * 0.13, aimP.y + ((i % 2) - 0.5) * 0.16, aimP.z + f.fz * ((i % 3) - 1) * 0.13); else restAt(i, _a);
        Wt.stream(i, nozz[i], _a, !SCN.dry);
      }
      // the windows the child is spraying: the water must rest on one for a moment
      if (aimQ && aimOn && BB.hands.active()) {
        const first = ready.indexOf(true), land = first >= 0 ? Wt.landing(first, _l) : null;
        for (let t = 0; t < aimQ.k; t++) {
          const i = aimQ.n - 1 - t; if (!(want[i] > 0)) continue;
          const near = land && land.distanceToSquared(wins[i]) < 0.55;
          dwell[i] = near ? dwell[i] + dt : Math.max(0, dwell[i] - dt * 2);
          if (dwell[i] >= 0.4) { dwell[i] = 0; BB.hands.hit(t); }
        }
      }
      for (let i = 0; i < 10; i++) {
        amt[i] += BB.clamp(want[i] - amt[i], -dt * 2.4, dt * 4);
        const s = Math.max(0.001, amt[i] * (1 - 0.5 * Math.min(1, dwell[i] / 0.4)) * (1 + 0.07 * Math.sin(time * 3.1 + i * 1.7)));
        _mm.makeRotationY(face); _mm.scale(_sc.set(s, s * (1 + 0.06 * Math.sin(time * 2.3 + i)), s));
        _mm.setPosition(wins[i].x + f.ox * 0.05, wins[i].y - 0.42 + Math.sin(time * 1.9 + i * 2.2) * 0.04, wins[i].z + f.oz * 0.05);
        sm.setMatrixAt(i, _mm);
      }
      sm.instanceMatrix.needsUpdate = true;
    };
    SCN.tick(0);
    const clampAim = (p) => {
      const side = BB.clamp((p.x - base.x) * f.fx + (p.z - base.z) * f.fz, -3.3, 3.3), y = BB.clamp(p.y, GROUND + 0.3, GROUND + 3.95);
      aimP.set(base.x + f.ox * 1.6 + f.fx * side, y, base.z + f.oz * 1.6 + f.fz * side);
    };
    return {
      fighters: {
        show(n) { while (SCN.items.length < n) { const i = SCN.items.length; SCN.items.push(fighter(i, false)); ready[i] = true; } hoses(); },
        add(i) { SCN.items[i] = fighter(i, true); arrive(i); },
        remove() {},
        prep() {},
        hands(q, step) {          // each tap on the engine calls one more firefighter out: they run to their place and spray
          const doorP = new THREE.Vector3(f.d.x + f.ox * 0.3, GROUND + 1.5, f.d.z + f.oz * 0.3), from = new THREE.Vector3(f.d.x + f.ox * 0.8, GROUND, f.d.z + f.oz * 0.8);
          return { kind: 'tap', count: q.k, repeat: true, say: `Tap the fire engine to call ${pl(q.k, 'more firefighter', 'more firefighters')}!`, hint: 'Tap the fire engine!',
            targets: [rideTarget(doorP)],
            bubble: (j, idx, out) => { out.copy(slots[q.n + j]); out.y += 2.9; },
            act: (j) => {
              const i = q.n + j, m = fighter(i, true); m.position.copy(from); SCN.items[i] = m; step(i);
              const to = slots[i]; m.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
              return tween(0.75, (t) => { m.position.lerpVectors(from, to, t); m.position.y = GROUND + Math.abs(Math.sin(t * Math.PI * 3)) * 0.25; }).then(() => { m.rotation.y = fdir; arrive(i); });
            } };
        },
        points: (c) => Array.from({ length: Math.max(1, c) }, (_, i) => slots[i]).concat(ends),
      },
      windows: {
        show() {},
        add() {},
        remove(i) { want[i] = 0; },
        prep() {},
        hands(q, step) {          // the child points the water at the glowing windows
          aimQ = q; restAt(Math.max(0, ready.indexOf(true)), aimP);
          return { kind: 'aim', count: q.k, say: `Spray ${pl(q.k, 'smoky window', 'smoky windows')}!`, hint: 'Touch a glowing window!',
            targets: Array.from({ length: q.k }, (_, t) => (out) => out.copy(wins[q.n - 1 - t])),
            // (a finger near a glowing window means that window: the water goes right onto it, so a small finger on a
            // small screen needn't be exact; anywhere else the water just follows the finger)
            aim: (x, y) => {
              const p = BB.hands.ray(x, y).intersectPlane(wall, _a); if (!p) return;
              let best = -1, bd = 0.95 * 0.95;
              for (let t = 0; t < q.k; t++) { const i = q.n - 1 - t; if (!(want[i] > 0)) continue; const d = p.distanceToSquared(wins[i]); if (d < bd) { bd = d; best = i; } }
              if (best >= 0) aimP.copy(wins[best]); else clampAim(p);
              aimOn = true;
            },
            auto: (t) => { aimP.copy(wins[q.n - 1 - t]); aimOn = true; },
            act: (j, t) => { const i = q.n - 1 - t; want[i] = 0; step(i); BB.sfx.whoosh(); } };
        },
        // a close-up of the kiosk: the windows are what is counted and sprayed here, so they are shown big, with
        // the firefighters nearest the kiosk whole beside it (two on a tablet, one on a phone), so nobody looms half
        // cut off in front; the others and the engine as far as the picture reaches
        close: true, top: 4.4,
        points: () => ends.concat(slots.filter((s, i) => ready[i]).slice(0, innerHeight <= 520 ? 1 : 2)),
      },
      // the water sweeps over the windows still smoking, one after another
      async sweep(ok) {
        sweeping = true;
        for (let i = 0; i < 10 && ok(); i++) { if (!(want[i] > 0)) continue; aimP.copy(wins[i]); aimOn = true; await wait(420); want[i] = 0; BB.sfx.pop(); }
        await wait(500);
        sweeping = false; aimOn = false;
      },
      dry() { SCN.dry = true; Wt.off(); },
    };
  }

  // ---------- each ride's own stops ----------
  // The other rides never use bus stops: they go to roadside spots (world.js W.sceneSpots), and the spot they're
  // driving to shows that ride's own marker, seen from far off: a round sign on a pole with the ride's picture (the
  // taxi stand, the check-up stop, the ice cream stop), a column of smoke where the fire is, the broken-down car
  // with a warning triangle for the tow truck. The marker goes when the job ends (or Home, bedtime).
  let marker = null;
  const MARK_PIC = { taxi: 'taxi', ambulance: 'medic', icecream: 'icecream', tow: 'tow', pump: 'pump' };
  const MARK_RIM = { taxi: '#f5b83d', ambulance: '#ff8fab', icecream: '#8fd3e8', tow: '#f28b4b', pump: '#19a79b' };
  const rideTexs = {};
  function rideMarkTex(kind) {
    if (rideTexs[kind]) return rideTexs[kind];
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    x.fillStyle = 'rgba(0,0,0,.18)'; x.beginPath(); x.arc(66, 68, 58, 0, Math.PI * 2); x.fill();
    x.fillStyle = MARK_RIM[kind] || '#d9b57f'; x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#fff6e0'; x.beginPath(); x.arc(64, 64, 48, 0, Math.PI * 2); x.fill();
    x.drawImage(BB.pic(MARK_PIC[kind], 128), 24, 24, 80, 80);
    const t = new THREE.CanvasTexture(c);
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; else if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    return (rideTexs[kind] = t);
  }
  let MGEO = null;
  function markGeos() {
    if (MGEO) return MGEO;
    const mk = (fn) => { const b = BB.mk.builder(); fn(b); return b.geometry(); };
    MGEO = {
      pole: mk((b) => { b.cyl(0.09, 0.09, 3.1, 6, '#8a8290', 0, 0, 0); b.cyl(0.32, 0.36, 0.14, 8, '#6c6470', 0, 0, 0); }),
      puff: mk((b) => { b.ball(0.9, '#8a8290', 0, 0, 0); b.ball(0.7, '#a8a0ae', 0.55, 0.35, 0.2); b.ball(0.6, '#bdb6c2', -0.45, 0.45, -0.1); }),
      triangle: mk((b) => { b.cyl(0.02, 0.62, 0.7, 3, '#ef5a4b', 0, 0, 0); b.cyl(0.02, 0.36, 0.42, 3, '#fff6e0', 0, 0.1, 0.03); }),
    };
    return MGEO;
  }
  function placeMarker(kind, t, legIdx) {
    clearMarker();
    if (!t || !t.pos || !t.fwd || !t.side || !BB.scene || t.place || t.id === 'depot') return;   // (the fire station, clinic and depot are their own places)
    const G = markGeos(), parts = [], add = (m) => { BB.scene.add(m); parts.push(m); return m; };
    // a point by the spot: 'along' the kerb (forward +, the way the ride drives in), 'out' onto the pavement (+)
    const at = (along, out, y = GROUND) => new THREE.Vector3(t.pos.x + t.fwd.x * along + t.side.x * out, y, t.pos.z + t.fwd.z * along + t.side.z * out);
    const m = { kind, parts, puffs: [], sign: null, t: 0, base: 2.7 };
    if (kind === 'pump') {
      // the fuel pump: a big round pump sign on a short pole on top of the canopy, seen from far across the town
      const PU = BB.world.pump, cx = PU.x - 2.4, cz = PU.z + 0.4;
      const pole = add(new THREE.Mesh(G.pole, BB.mk.mat)); pole.position.set(cx, 7.8, cz); pole.scale.set(1.4, 0.35, 1.4);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: rideMarkTex(kind), transparent: true, alphaTest: 0.05 }));
      sp.scale.set(3.6, 3.6, 1); sp.position.set(cx, 10.3, cz); add(sp); m.sign = sp; m.base = 3.6;
    } else if (kind === 'fire') {
      // smoke rising where the kiosk is on fire (world.js keeps that zone clear: 3-19 ahead, out to 4.6)
      const base = at(12.5, 0.7);
      for (let i = 0; i < 6; i++) { const p = add(new THREE.Mesh(G.puff, BB.mk.mat)); p.userData.ph = i / 6; p.userData.base = base; m.puffs.push(p); }
    } else if (kind === 'tow' && legIdx === 0) {
      // the broken-down car, two wheels up on the kerb ahead of the bay, and a warning triangle behind it
      const car = brokenCar(); if (car.parent) car.parent.remove(car);
      car.position.copy(at(7.5, -1.6)); car.rotation.set(0, Math.atan2(t.fwd.x, t.fwd.z), 0.06); car.scale.setScalar(1);
      BB.scene.add(car); m.car = car;
      const tri = add(new THREE.Mesh(G.triangle, BB.mk.mat)); tri.position.copy(at(3.6, -2.2)); tri.rotation.y = Math.atan2(t.fwd.x, t.fwd.z) + Math.PI;
    } else if (MARK_PIC[kind] && kind !== 'tow') {
      const pole = add(new THREE.Mesh(G.pole, BB.mk.mat)); pole.position.copy(at(5.5, 0.6));
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: rideMarkTex(kind), transparent: true, alphaTest: 0.05 }));
      sp.scale.set(2.7, 2.7, 1); sp.position.copy(at(5.5, 0.6, GROUND + 4.3)); add(sp); m.sign = sp;
    }
    marker = m;
  }
  // arrived: the smoke column gives way to the real fire scene; a sign stays while the ride is there
  function markerArrived() {
    if (!marker) return;
    if (marker.kind === 'fire') { for (const p of marker.puffs) if (p.parent) p.parent.remove(p); marker.puffs = []; }
  }
  function clearMarker() {
    if (!marker) return;
    for (const p of marker.parts) if (p.parent) p.parent.remove(p);
    if (marker.car && marker.car.parent === BB.scene) BB.scene.remove(marker.car);   // (not once it hangs on the tow hook)
    marker = null;
  }
  J._clearMarker = clearMarker;
  function updateMarker(dt) {
    if (!marker) return;
    marker.t += dt;
    if (marker.sign) { const s = marker.base * (1 + Math.sin(marker.t * 3) * 0.05); marker.sign.scale.set(s, s, 1); }
    for (const p of marker.puffs) {                    // puffs rise, swell and fade away (shrink), round and round
      const k = (marker.t * 0.22 + p.userData.ph) % 1, b = p.userData.base;
      p.position.set(b.x + Math.sin(k * 6 + p.userData.ph * 9) * 0.6, GROUND + 3.5 + k * 12, b.z + Math.cos(k * 5) * 0.4);
      p.scale.setScalar(Math.max(0.01, (0.6 + k * 1.6) * (k > 0.8 ? (1 - k) / 0.2 : 1)));
    }
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
    const W = BB.world, stops = (W.stops || []).filter((s) => s && s.pos && s.say && s.edge != null);
    // the first leg runs from where the vehicle is (its bay, or the road / the depot yard), every leg ~7 s
    const at = BB.bus.atStop, from0 = at && at.edge != null && at.id !== 'depot' && at.id !== 'wash' ? at : null;
    const spot = kind === 'icecream' ? null : legTo(from0, spots({ taxi: 'picnic', fire: 'fire', ambulance: 'picnic', tow: 'car' }[kind]), [], null, kind === 'fire' ? tagged('fire2') : null);
    const L = [];
    const carry = { bags: null, teddies: null };
    if (kind === 'taxi') {
      // a family, or now and then (about one taxi job in three) a passenger friend with their bags
      // (a grown-up friend: the children don't take a taxi on their own; they wave and say hello once they're in view)
      const fr = Math.random() < 0.35 ? pickFriend(true) : null, fam = fr ? 1 : BB.randInt(1, 4), who = fr ? friendStyle(fr) : null;
      const riders = fr ? fr.name : 'the family';
      L.push({ to: spot, start: fr ? `Taxi job! ${fr.name} is waiting${where(spot)}. Let's go!` : `Taxi job! A family is waiting${where(spot)}. Let's go!`, run: async (ok) => {
        hatch(true);
        await hopIn(fam, who, async () => { await say(fr ? friendHello(fr, true) : plural(fam, 'Hello, taxi! In I get!', 'Hello, taxi! In we get!')); }); if (!ok()) return;
        const q = legQ('add', null, WORDS.bagsIn, 'bags'); q.scene = bagScene(); await askScene(q); carry.bags = q.answer; hatch(false);
      } });
      const home = legTo(spot, spots('picnic'), [spot]);
      L.push({ to: home, go: `Now take ${riders} home!`, run: async (ok) => {
        hatch(true);
        const qb = legQ('sub', carry.bags, WORDS.bagsIn, 'bags'); qb.scene = bagScene(); await askScene(qb); if (!ok()) return;
        hatch(false); hopOut(fam, who); await say(fr ? (fr.taxi ? fr.taxi[1] : fr.bye) : 'Thank you, taxi! Bye bye!');
      } });
    } else if (kind === 'fire') {
      const station = place('fireStation');      // (the drive back only when the station is just down the road)
      L.push({ to: spot, start: BB.pick([`Fire engine! There's smoke${where(spot)}! Siren on, let's go!`, `Nee naw, nee naw! Smoke${where(spot)}! Let's go, fire engine!`]), onGo: () => siren(true), run: async (ok) => {
        const subOk = LEVELS[level()].sub > 0, qw = subOk ? legQ('sub', null, WORDS.windows, 'window') : null;
        const fs = fireScene(qw ? qw.n : 4);
        await say("We're here! Ladder up!"); ladder(true); if (!ok()) return;
        const qf = legQ('add', null, WORDS.fighters, 'fighter'); qf.scene = fs.fighters;
        await askScene(qf); if (!ok()) return;
        if (qw) {
          qw.scene = fs.windows; await askScene(qw); if (!ok()) return;
          if (qw.answer > 0) {                    // the windows still smoking get sprayed clear first
            await Promise.all([say('Spray the last ones! Whoosh!'), fs.sweep(ok)]); if (!ok()) return;
          }
        }
        fs.dry();
        siren(false); ladder(false); BB.sfx.cheer(); if (BB.ui && BB.ui.confetti) BB.ui.confetti();
        await say('The fire is out! Hooray!');
      } });
      if (isNear(spot, station)) L.push({ to: station, go: 'Back to the fire station!', run: async () => { await say('Thank you, firefighters!'); } });
    } else if (kind === 'ambulance') {
      // the clinic when it's just down the road, else Auntie goes home after her check-up in the ambulance
      // the patient is one of the passenger friends (a bumped knee, nothing worse), so the ambulance meets them too
      const clinic = place('clinic'), toClinic = isNear(spot, clinic), dest = toClinic ? clinic : legTo(spot, spots('picnic'), [spot]);
      const pf = pickFriend(), patient = { geo: pf.geo || (pf.geo = friendGeo(pf.look)), lookData: pf.look, kid: !!pf.look.kid };
      L.push({ to: spot, start: `Ambulance! ${pf.name} bumped a knee and is waiting${where(spot)}. Let's go!`, onGo: () => siren(true), run: async (ok) => {
        siren(false);
        // (the patient waits at the kerb, in view, while the crew says hello; then hops in)
        await hopIn(1, patient, async () => {
          const first = meetFriend(pf.id);
          await say(`${first ? `Hello, ${pf.name}! Nice to meet you!` : `Hello again, ${pf.name}!`} Hop in! We have teddy bears for brave children.`);
        }); if (!ok()) return;
        const q = legQ('add', null, WORDS.teddies, 'teddy'); q.scene = teddyScene(); await askScene(q); carry.teddies = q.answer;
      } });
      L.push({ to: dest, go: toClinic ? 'Off to the clinic!' : `The knee is better! Let's take ${pf.name} home!`, run: async (ok) => {
        const qt = legQ('sub', carry.teddies, (q0) => WORDS.teddies(q0, toClinic ? ' at the clinic' : ' nearby'), 'teddy'); qt.scene = teddyScene(); await askScene(qt); if (!ok()) return;
        for (const m of J.waiting.splice(0)) { m.userData.jump = 1; J.extras.push(m); BB.later(900, () => walkAway(m)); }   // the children, each with a teddy
        hopOut(1, patient); await say(`All better! Thank you, ambulance!`);
      } });
    } else if (kind === 'icecream') {
      // children wait at the van's own stops nearby (by the park, the swings and the seaside more often)
      const pool = spots('icecream'), fun = (t) => (/park|beach|swings|seaside/i.test((t.say || '') + ' ' + (t.near || '') + ' ' + (t.id || '')) ? 3 : 1);
      const park = legTo(from0, pool, [], fun), beach = legTo(park, pool, [park], fun);
      L.push({ to: park, start: BB.pick([`Ice cream van! Let's go to ${sayOf(park)}!`, `Ding-a-ling! The children at ${sayOf(park)} want ice cream!`]), run: async (ok) => {
        // exactly as many children queue as buy one (each takes an ice cream off the stand)
        const q = legQ('sub', null, WORDS.sold, 'icecream'); q.scene = iceScene();
        jingle(); queueKids(q.kind === 'sub' ? q.k : 2); hatch(true);
        await say('Ice cream! Ice cream! The children are waiting!'); if (!ok()) return;
        await askScene(q); if (!ok()) return;
        for (const m of J.waiting.splice(0)) { m.userData.jump = 1; J.extras.push(m); BB.later(900, () => walkAway(m)); }
        hatch(false); await say('Yummy! Thank you!');
      } });
      // (old town and the seaside are big: when the next stop has the same name, it's "the next ice cream stop")
      L.push({ to: beach, go: sayOf(beach) === sayOf(park) ? 'Now drive to the next ice cream stop!' : `Now drive to ${sayOf(beach)}!`, run: async (ok) => {
        jingle(); hatch(true);
        const q = legQ('add', null, WORDS.cones, 'icecream'); q.scene = iceScene(); await askScene(q); if (!ok()) return;
        queueKids(2); await wait(400);
        for (const m of J.waiting.splice(0)) { m.userData.jump = 1; J.extras.push(m); BB.later(900, () => walkAway(m)); }
        hatch(false); await say('Yummy! Bye bye!');
      } });
    } else if (kind === 'tow') {
      // the depot yard when it's just down the road, else the car park nearby (the cars are drawn beside the truck)
      const toDepot = isNear(spot, W.depot), yard = toDepot ? W.depot : legTo(spot, spots('yard'), [spot], null, tagged('yard2')), lot = toDepot ? 'the yard' : 'the car park';
      L.push({ to: spot, start: BB.pick([`Tow truck! A car has broken down${where(spot)}. Let's help!`, `Tow truck! A little car has a flat tyre${where(spot)}. Let's help!`]), run: async (ok) => {
        const car = brokenCar();
        if (!(BB.bus.has && BB.bus.has('hook')) || vcall(['hookOn', 'hookCar'], car) === undefined) {
          // no hook helper: the car is lifted behind the truck
          if (car.parent) car.parent.remove(car);
          car.position.set(0, 0.35, -5.2); car.rotation.set(0.12, 0, 0); BB.bus.front.add(car);
        }
        BB.sfx.pop();
        // (the stop view shows the hooked car too, all the way up: it hangs behind the truck)
        try {
          car.updateWorldMatrix(true, false);
          const cp = car.getWorldPosition(new THREE.Vector3()), f = doorFrame(false);
          scnFrame([-2.4, 0, 2.4].map((a) => new THREE.Vector3(cp.x + f.fx * a, 0, cp.z + f.fz * a)), false, 3.6);
        } catch (e) { console.error(e); }
        // the child winds the winch: a big wheel to turn with a finger, and the boom lifts the car as it turns
        if (BB.hands && BB.bus.has && BB.bus.has('hook') && typeof BB.bus.setBoom === 'function') {
          BB.bus.setBoom(0);
          await say('Hook on!'); if (!ok()) return;
          const done = await BB.hands.run({ kind: 'crank', turns: 3, say: 'Turn the wheel to lift the car!', hint: 'Put your finger on the wheel and go round and round!', turn: (p) => BB.bus.setBoom(p) });
          if (!done || !ok()) return;
          BB.sfx.right(); await say('Up it goes! Well done!');
        } else await say('Hook on! Up it goes!');
      } });
      L.push({ to: yard, go: toDepot ? 'Tow it to the depot!' : 'Tow it to the car park!', run: async (ok) => {
        if (typeof BB.bus.hookOn === 'function') vcall(['hookOn'], null);
        if (towCar && towCar.parent) towCar.parent.remove(towCar);                    // the car stays in the yard (out of view)
        await say(`Here we are! The car is safe in ${lot}.`); if (!ok()) return;
        const ys = yardScene(lot);
        const yw = (q0) => WORDS.yard(q0, lot);
        const q = legQ('add', null, yw, 'car'); q.scene = ys; await askScene(q); if (!ok()) return;
        if (LEVELS[level()].sub > 0) { const q2 = legQ('sub', q.answer, yw, 'car'); q2.scene = ys; await askScene(q2); }
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
    try { placeMarker(job.vehicle, leg.to, job.index); } catch (e) { console.error(e); }
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
    markerArrived();
    await wait(900);                         // the scene camera settles
    if (!ok()) return;
    try { await leg.run(ok); } catch (e) { console.error(e); }
    if (!ok()) return;
    await wait(1200);
    scnClear();
    job.index++;
    if (job.index >= job.legs.length) { clearMarker(); jobDone(); return; }
    if (timeUp()) { bedtime(); return; }
    if (pumpDue() && J.goPump('low')) return;          // (the next leg after the pump)
    driveLeg();
  }

  // ---------- depot trips, low fuel and the tow ----------
  J.goDepot = function (reason) {
    if (J.phase === 'bedtime' || J.phase === 'toDepot' || J.phase === 'depot') return;
    // busy (a stop, a question, the tow) or settling into a stop's bay: go after the stop instead
    const settling = typeof BB.bus.isSettling === 'function' && BB.bus.isSettling();
    if (J.phase === 'question' || J.phase === 'stop' || J.phase === 'tow' || J.phase === 'pump' || settling) { J.wantDepot = true; return; }
    J.wantDepot = false;
    if (J.phase === 'toPump') { clearMarker(); J.wantPump = false; }     // (the pump waits: after Drive it comes first)
    setPhase('toDepot');
    BB.bus.closeDoors();
    BB.bus.stopAt(null);
    BB.emit('job:target', { stop: BB.world.depot, job: J.current });
    if (reason !== 'quiet') say('Off to the garage!', { queue: true });
    // straight there with a quick fade (no long drive back across town and round the yard); a job in progress waits
    // and carries on after Drive
    BB.later(350, () => {
      if (J.phase !== 'toDepot' || BB.bedtime) return;
      const open = () => {
        if (J.phase !== 'toDepot' || BB.bedtime) return;
        try { BB.bus.placeAtDepot('depot'); } catch (e) { console.error(e); }
        setPhase('depot');
        BB.depot.open();
      };
      if (BB.ui && typeof BB.ui.fade === 'function') BB.ui.fade(open); else open();
    });
  };
  BB.on('depot:closed', () => {
    if (J.phase !== 'depot') return;
    BB.bus.closeDoors();
    J.lastStop = null;                         // the bus sets off from the garage yard: the next stops are picked from there
    if (timeUp()) { bedtime(); return; }
    if (pumpDue(true) && J.goPump(BB.bus.fuel <= PUMP_LOW ? 'low' : 'drive')) return;   // (under 60%: the pump first, the job after)
    if (J.current) resumeJob(); else J.start();
  });
  // the tank is getting low: on the way to a stop, the pump instead (the stop waits); anywhere else, after what is on
  // (the stop, the question, the job-done banner, the garage: pumpDue() is checked there)
  BB.on('bus:fuelLow', () => {
    if (J.phase === 'drive') J.goPump('low');
    else if (J.phase !== 'toPump' && J.phase !== 'pump' && J.phase !== 'bedtime') J.wantPump = true;
  });

  // Out of fuel: a friendly tow truck backs up to the bus (beep, beep), hooks on and pulls it to the fuel pump in the
  // depot yard, where the child fills the tank as on any pump visit (runPump). No cost, no lost progress. Uses the art builder's tow truck when there is one
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
      B.placeAt(pumpBay() || BB.world.depot);           // (beside the fuel pump: the child fills up next)
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
    await say('Thank you, tow truck!');
  }
  function towWithFade() {
    return new Promise((resolve) => {
      BB.later(1400, () => BB.ui.fade(() => {
        BB.bus.placeAt(pumpBay() || BB.world.depot);
      }, resolve));
    }).then(() => say("Here's the fuel pump!"));
  }
  BB.on('bus:fuelEmpty', async () => {
    if (J.phase === 'tow' || BB.bedtime) return;
    setPhase('tow'); BB.bus.locked = true; BB.bus.go(false);
    J.wantDepot = false; J.wantPump = false;
    try { BB.bus.stopAt(null); } catch (e) { console.error(e); }
    clearMarker(); siren(false);
    await say("Oh! We're out of fuel. Here comes the tow truck!");
    const truck = getTowTruck();
    try { if (truck) await towWithTruck(truck); else await towWithFade(); } catch (e) { console.error(e); await towWithFade(); }
    BB.bus.locked = false;
    J.lastStop = null;                                 // (towed to the depot yard: new stops are picked from there)
    if (BB.bedtime || J.phase !== 'tow') return;
    runPump();                                         // the tank is filled at the pump, by hand, as on every visit
  });

  // ---------- the fuel pump ----------
  // The tank is filled at the fuel pump on the depot yard's north aisle (world.js: W.pump, W.pumpBay), never in the
  // garage. When it gets low (bus:fuelLow; checked again between stops, between legs and between jobs, never during a
  // question), or when the bus leaves the garage with less than 60%, the pump becomes the target: the Next stop tile
  // shows the pump, the ribbon leads there, a pump sign stands over the canopy, and the bus settles in the pump bay
  // with its fuel cap just past the pump. Then one hands-on moment, on every ride (not switched off with
  // HANDS_ON: that is the bus stops only): the child drags the glowing nozzle along the dotted path to the ring on the
  // fuel cap (a tap, or letting go anywhere, also lands it; the hint after 6 s, the game does it after 12 s). The hose
  // follows the nozzle. Then the big gauge in the card's place fills in ten steps, counted aloud, with the pump's
  // gurgle: "A full tank! Thank you!". The nozzle goes back, and the job that was going carries on. Free, no coins.
  // Out of fuel altogether, the tow truck brings the bus to the pump and the same moment follows.
  const PUMP_LOW = BB.cfg.fuelLow + 0.06, PUMP_AFTER_DRIVE = 0.6, PUMP_GAP = 2.2;   // (the cap stops 2.2 past the pump: on a phone the camera stands ahead of it, so the pump is never in front of the cap)
  // is the pump due? the tank low (or the low warning came during something), or (soon) just out of the garage
  // with less than 60% (afterDrive: only while still in the depot yard)
  function pumpDue(afterDrive) {
    const f = BB.bus.fuel;
    if (f >= 0.98) { J.wantPump = false; return false; }
    if (J.wantPump || f <= PUMP_LOW) return true;
    return !!(afterDrive && f < PUMP_AFTER_DRIVE && BB.bus.inDepot && BB.bus.inDepot());
  }
  J.pumpDue = pumpDue;
  // the pump bay for the ride driven now: along the kerb so the fuel cap stops PUMP_GAP past the pump
  function pumpBay() {
    const W = BB.world, st = W.pumpBay, PU = W.pump;
    if (!st || !PU) return null;
    if (!st._bay0) { delete st._bay; st._bay0 = Object.assign({}, W.bayOf(st)); }
    const b0 = st._bay0, f = b0.fwd;
    const along = (PU.x - b0.x) * f.x + (PU.z - b0.z) * f.z + PUMP_GAP - (typeof BB.bus.capAlong === 'function' ? BB.bus.capAlong() : 0);
    const x = b0.x + f.x * along, z = b0.z + f.z * along;
    st._bay = Object.assign({}, b0, { x, z, nose: { x: x + f.x * 7.2, z: z + f.z * 7.2 } });
    return st;
  }
  J.pumpBay = pumpBay;
  const RIDE_WORD = { bus: 'bus', taxi: 'taxi', fire: 'fire engine', ambulance: 'ambulance', icecream: 'ice cream van', tow: 'tow truck' };
  // Head for the pump (reason: 'low' = hungry, 'drive' = just out of the garage, 'quiet'). Never once time is up;
  // during a stop, a question or the pump-in, it waits (wantPump). True when it is on its way (or waiting to go).
  J.goPump = function (reason) {
    if (J.phase === 'bedtime' || J.phase === 'toPump' || J.phase === 'pump' || J.phase === 'tow' || J.phase === 'home' || (BB.depot && BB.depot.isOpen) || timeUp()) return false;
    const settling = typeof BB.bus.isSettling === 'function' && BB.bus.isSettling();
    if (J.phase === 'question' || J.phase === 'stop' || settling) { J.wantPump = true; return true; }
    const st = pumpBay(); if (!st) return false;
    J.wantPump = false;
    clearMarker(); siren(false);
    setPhase('toPump');
    J.stopStart = null;
    BB.bus.closeDoors();
    BB.bus.stopAt(st, () => runPump());
    try { placeMarker('pump', st); } catch (e) { console.error(e); }
    BB.emit('job:target', { stop: st, job: J.current });
    if (reason !== 'quiet') say(reason === 'drive' ? "Let's fill up the tank first! Drive to the fuel pump!" : "I'm getting hungry! Let's drive to the fuel pump!", { queue: true });
    return true;
  };
  // the moment's own things: the nozzle and its hose (always by the pump while the bus is near the yard: the nozzle
  // hangs on the pump's back), the fuel cap on the bus (only during the moment) and the big gauge
  const PZ = { nozzle: null, hose: null, cap: null, gauge: null, cells: null, num: null, on: false, gen: 0, home: new THREE.Vector3(), hoseOut: new THREE.Vector3() };
  const NOZ_GRIP = new THREE.Vector3(0, -0.04, -0.75), NOZ_HOSE = new THREE.Vector3(0, -0.42, -0.9);
  const HOSE_SEG = 14, HOSE_SIDES = 6, HOSE_R = 0.075;
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3(), _pt = new THREE.Vector3(), _pn = new THREE.Vector3(), _pq = new THREE.Vector3(), _pu = new THREE.Vector3(0, 1, 0);
  function pumpBuild() {
    if (PZ.nozzle) return;
    const PU = BB.world.pump;
    // the nozzle: its spout tip is the mesh's origin and points along +z (so lookAt aims it); the grip and handle behind
    const b = BB.mk.builder();
    b.cyl(0.05, 0.045, 0.42, 6, '#c9d2db', 0, 0, -0.42, Math.PI / 2, 0, 0);
    b.box(0.17, 0.17, 0.1, P.coral, 0, -0.085, -0.47);
    b.box(0.22, 0.24, 0.44, P.teal, 0, -0.12, -0.74); b.box(0.23, 0.06, 0.45, '#127a71', 0, -0.13, -0.74);
    b.box(0.15, 0.36, 0.15, P.teal, 0, -0.44, -0.9);
    b.box(0.07, 0.07, 0.32, P.honey, 0, -0.38, -0.72);
    PZ.nozzle = b.mesh(); PZ.nozzle.name = 'pumpNozzle';
    PZ.home.set(PU.nozzle.x, PU.nozzle.y, PU.nozzle.z);
    PZ.hoseOut.set(PU.x + 0.5, 1.95, PU.z);
    nozzleHome();
    // the hose: one small tube whose rings are moved in place (no new objects while it follows the nozzle)
    const nv = (HOSE_SEG + 1) * HOSE_SIDES, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = [];
    for (let i = 0; i < HOSE_SEG; i++) for (let k = 0; k < HOSE_SIDES; k++) {
      const a = i * HOSE_SIDES + k, b2 = i * HOSE_SIDES + (k + 1) % HOSE_SIDES, c = a + HOSE_SIDES, d = b2 + HOSE_SIDES;
      idx.push(a, c, b2, b2, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(PU.x + 2, 1, PU.z + 1.5), 9);
    PZ.hose = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x4a4552 })); PZ.hose.name = 'pumpHose';
    PZ.hose.frustumCulled = true;
    // the fuel cap: a cream ring with a coral lid, facing out of the body's side (+z of the mesh)
    const cb = BB.mk.builder();
    cb.cyl(0.21, 0.21, 0.04, 12, '#e9e2d6', 0, 0, 0, Math.PI / 2, 0, 0);
    cb.cyl(0.14, 0.14, 0.06, 12, P.coral, 0, 0, 0.02, Math.PI / 2, 0, 0);
    PZ.cap = cb.mesh(); PZ.cap.name = 'fuelCap';
  }
  function nozzleHome() {
    const n = PZ.nozzle; if (!n) return;
    n.position.copy(PZ.home);
    _pa.set(PZ.home.x + 0.12, PZ.home.y - 1, PZ.home.z); n.lookAt(_pa);      // (spout down, hanging on the pump's back)
  }
  // the hose from the pump's top to the nozzle's handle: a sagging curve, rebuilt in place
  function hoseSync() {
    const h = PZ.hose, n = PZ.nozzle; if (!h || !n) return;
    n.updateMatrixWorld();
    const a = PZ.hoseOut, e = _pb.copy(NOZ_HOSE).applyMatrix4(n.matrixWorld);
    const d = a.distanceTo(e), sag = 0.35 + d * 0.32;
    const cx = (a.x + e.x) / 2, cz = (a.z + e.z) / 2, cy = Math.max(0.1, Math.min(a.y, e.y) - sag);
    const pos = h.geometry.attributes.position.array, nor = h.geometry.attributes.normal.array;
    for (let i = 0; i <= HOSE_SEG; i++) {
      const t = i / HOSE_SEG, u = 1 - t;
      _pc.set(u * u * a.x + 2 * u * t * cx + t * t * e.x, u * u * a.y + 2 * u * t * cy + t * t * e.y, u * u * a.z + 2 * u * t * cz + t * t * e.z);
      _pt.set(2 * u * (cx - a.x) + 2 * t * (e.x - cx), 2 * u * (cy - a.y) + 2 * t * (e.y - cy), 2 * u * (cz - a.z) + 2 * t * (e.z - cz)).normalize();
      _pn.crossVectors(_pt, Math.abs(_pt.y) > 0.9 ? _pq.set(1, 0, 0) : _pu).normalize();
      _pq.crossVectors(_pt, _pn);
      for (let k = 0; k < HOSE_SIDES; k++) {
        const an = k / HOSE_SIDES * Math.PI * 2, cs = Math.cos(an), sn = Math.sin(an), o = (i * HOSE_SIDES + k) * 3;
        const nx = _pn.x * cs + _pq.x * sn, ny = _pn.y * cs + _pq.y * sn, nz = _pn.z * cs + _pq.z * sn;
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
        pos[o] = _pc.x + nx * HOSE_R; pos[o + 1] = _pc.y + ny * HOSE_R; pos[o + 2] = _pc.z + nz * HOSE_R;
      }
    }
    h.geometry.attributes.position.needsUpdate = true; h.geometry.attributes.normal.needsUpdate = true;
  }
  // near the yard the nozzle and hose stand by the pump; far off they leave the scene (no draw calls)
  let pumpNear = false, pumpLook = 0;
  function pumpUpdate(dt) {
    const PU = BB.world.pump, bp = BB.bus.pos; if (!PU || !bp) return;
    if ((pumpLook -= dt) <= 0 || PZ.on) {
      pumpLook = 0.5;
      const near = PZ.on || (bp.x - PU.x) * (bp.x - PU.x) + (bp.z - PU.z) * (bp.z - PU.z) < 170 * 170;
      if (near !== pumpNear) {
        pumpNear = near;
        if (near) { pumpBuild(); BB.scene.add(PZ.nozzle, PZ.hose); PZ.hoseDirty = true; }
        else if (PZ.nozzle) { BB.scene.remove(PZ.nozzle); BB.scene.remove(PZ.hose); }
      }
    }
    if (!pumpNear) return;
    if (PZ.on && PZ.cap && PZ.cap.parent) { BB.bus.capWorld(PZ.cap.position); const sd = BB.world.pumpBay.side; _pa.set(PZ.cap.position.x + sd.x, PZ.cap.position.y, PZ.cap.position.z + sd.z); PZ.cap.lookAt(_pa); }
    if (PZ.on || PZ.hoseDirty) { hoseSync(); PZ.hoseDirty = false; }
  }
  // the big gauge in the card's place (along the bottom on tablets, the column on the left on phones): the pump, a
  // tank of ten cells and the number counted
  BB.css(`
  .bbg { position: absolute; left: 50%; bottom: max(16px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; align-items: center; gap: 18px;
    background: #fff6e0; border: 4px solid #d9b57f; border-radius: 28px; box-shadow: 0 8px 0 rgba(120,80,40,.18); padding: 12px 22px; pointer-events: none;
    font-family: 'Fredoka', 'Baloo 2', system-ui, sans-serif; color: #3a2a3c; animation: bbg-in .4s cubic-bezier(.2,1.4,.5,1); --cw: 40px; --ch: 66px; }
  @keyframes bbg-in { from { transform: translate(-50%, 150%); } }
  .bbg.out { animation: bbg-out .3s ease-in forwards; }
  @keyframes bbg-out { to { transform: translate(-50%, 150%); opacity: 0; } }
  .bbg canvas { width: 84px; height: 84px; display: block; }
  .bbg-tank { display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: #eadcc0; border-radius: 18px; box-shadow: inset 0 3px 0 rgba(120,80,40,.16); }
  .bbg-tank em { font: 700 26px/1 inherit; font-style: normal; color: #b08a5c; padding: 0 4px; }
  .bbg-tank i { width: var(--cw); height: var(--ch); border-radius: 11px; background: #fbf3e2; box-shadow: inset 0 -5px 0 rgba(120,80,40,.1); transition: background .25s; }
  .bbg-tank i.on { background: var(--c); box-shadow: inset 0 -6px 0 rgba(0,0,0,.14); animation: bbg-pop .35s cubic-bezier(.2,1.6,.5,1); }
  @keyframes bbg-pop { 40% { transform: scale(1.18, 1.12); } }
  .bbg-n { min-width: 72px; text-align: center; font-size: 60px; font-weight: 700; line-height: 1; color: #d98700; }
  .bbg.full { border-color: #19a79b; box-shadow: 0 8px 0 rgba(120,80,40,.18), 0 0 0 6px rgba(143,224,196,.6); }
  .bbg.full .bbg-n { color: #19a79b; }
  @media (max-height: 520px) {
    .bbg { left: max(12px, env(safe-area-inset-left), var(--padx, 0px)); bottom: auto; top: calc(50% + 26px); transform: translateY(-50%); flex-wrap: wrap; justify-content: center;
      width: 316px; box-sizing: border-box; gap: 6px 14px; padding: 8px 10px 10px; border-radius: 22px; --cw: 21px; --ch: 46px; }
    @keyframes bbg-in { from { transform: translate(-130%, -50%); } }
    @keyframes bbg-out { to { transform: translate(-130%, -50%); opacity: 0; } }
    .bbg canvas { width: 56px; height: 56px; } .bbg-n { font-size: 44px; min-width: 56px; }
    .bbg-tank { order: 3; gap: 4px; padding: 6px 7px; border-radius: 14px; } .bbg-tank em { font-size: 18px; padding: 0 1px; } .bbg-tank i { border-radius: 7px; }
  }`);
  const CELL_COL = ['#ff6b5c', '#ff8a4f', '#ffa53d', '#ffb81f', '#f2c42e', '#c9c93c', '#9cc94a', '#6fc45a', '#3fb47a', '#19a79b'];
  function gaugeShow() {
    gaugeHide(true);
    const g = PZ.gauge = BB.el('div', 'bbg', BB.ui.root || document.getElementById('ui'));
    g.appendChild(BB.iconEl ? BB.iconEl('fuel', 120) : BB.pic('pump', 120));
    const tank = BB.el('div', 'bbg-tank', g);
    BB.el('em', '', tank, 'E');
    PZ.cells = [];
    for (let i = 0; i < 10; i++) { const c = BB.el('i', '', tank); c.style.setProperty('--c', CELL_COL[i]); PZ.cells.push(c); }
    BB.el('em', '', tank, 'F');
    PZ.num = BB.el('b', 'bbg-n', g, '');
  }
  function gaugeHide(now) {
    const g = PZ.gauge; PZ.gauge = null; PZ.cells = null; PZ.num = null;
    if (!g) return;
    if (now) g.remove(); else { g.classList.add('out'); BB.later(350, () => g.remove()); }
  }
  // the end of the moment, or Home / bedtime in the middle of it: the nozzle back on the pump, the gauge and cap gone
  function pumpEnd(now) {
    PZ.gen++;
    PZ.on = false;
    if (BB.hands && BB.hands.active()) BB.hands.stop();
    gaugeHide(now);
    if (PZ.cap && PZ.cap.parent) PZ.cap.parent.remove(PZ.cap);
    nozzleHome(); PZ.hoseDirty = true;
    const st = BB.world.pumpBay;
    if (st && st.frame) { delete st.frame; delete st.frameKey; delete st.frameClose; vcall(['reframe']); }
  }
  // At the pump (arrived, or towed there): the moment, then the job carries on.
  async function runPump() {
    if (BB.bedtime) return;
    const W = BB.world, st = W.pumpBay, PU = W.pump;
    setPhase('pump'); J.lastStop = null; J.wantPump = false;
    clearMarker();
    BB.sfx.ding();
    pumpBuild(); pumpNear = false; pumpLook = 0;
    const g = ++PZ.gen, ok = () => g === PZ.gen && J.phase === 'pump' && !BB.bedtime;
    PZ.on = true;
    pumpUpdate(0);
    BB.scene.add(PZ.cap);
    // the stop camera shows the pump, the nozzle and the cap as well as the bus
    const cap = BB.bus.capWorld(new THREE.Vector3());
    st.frame = [{ x: PU.x + 0.6, y: 0, z: PU.z }, { x: PU.x + 0.6, y: 2.5, z: PU.z }, { x: PU.x - 0.6, y: 0, z: PU.z - 0.5 }, { x: PZ.home.x, y: 2.1, z: PZ.home.z }, { x: cap.x, y: 0, z: cap.z }, { x: cap.x, y: cap.y + 0.4, z: cap.z }];
    st.frameKey = 'pump' + g; st.frameClose = false;
    vcall(['reframe']);
    gaugeShow();
    await wait(900);
    if (!ok()) return;
    const word = RIDE_WORD[vehicleKind()] || 'bus', side = st.side;
    let filled = false;
    const done = BB.hands ? await BB.hands.run({
      kind: 'drag', count: 1, noCount: true, plane: cap.y,
      say: `Drag the nozzle to the ${word}!`, hint: `Put your finger on the nozzle and pull it to the ${word}!`,
      targets: [(out) => out.copy(NOZ_GRIP).applyMatrix4(PZ.nozzle.matrixWorld)],
      drop: (out) => { BB.bus.capWorld(out); out.x += side.x * 0.35; out.z += side.z * 0.35; return out; },
      drag: (i, p) => {
        if (!p) return;
        // the grip under the finger, the spout turned toward the cap
        const n = PZ.nozzle, c = BB.bus.capWorld(_pc);
        n.position.set(p.x, p.y + 0.15, p.z);
        _pa.set(c.x, c.y, c.z); if (_pa.distanceToSquared(n.position) > 0.04) n.lookAt(_pa);
        n.updateMatrixWorld(); _pb.copy(NOZ_GRIP).applyMatrix4(n.matrixWorld);
        n.position.x += p.x - _pb.x; n.position.z += p.z - _pb.z;
      },
      act: () => {
        // into the cap: the spout tip on the cap, pointing into the body and a little down
        const n = PZ.nozzle, a = n.position.clone(), c = BB.bus.capWorld(new THREE.Vector3()), q0 = n.quaternion.clone();
        n.position.copy(c); _pa.set(c.x - side.x, c.y - 0.35, c.z - side.z); n.lookAt(_pa);
        const q1 = n.quaternion.clone(); n.position.copy(a); n.quaternion.copy(q0);
        filled = true; BB.sfx.pop();
        return tween(0.45, (t) => { const e = BB.smooth ? BB.smooth(t) : t; n.position.lerpVectors(a, c, e); n.quaternion.slerpQuaternions(q0, q1, e); });
      },
    }) : true;
    if (!done || !ok()) return;
    if (!filled) { nozzleIn(side); }
    // the tank fills in ten steps, counted aloud, with the pump's gurgle
    const from = BB.bus.fuel;
    await wait(250); if (!ok()) return;
    for (let i = 1; i <= 10; i++) {
      if (!ok()) return;
      BB.sfx.gurgle(0.55, true);
      if (PZ.cells) PZ.cells[i - 1].classList.add('on');
      if (PZ.num) PZ.num.textContent = String(i);
      BB.bus.refuel(from + (1 - from) * i / 10 - BB.bus.fuel);   // (refuel adds)
      await Promise.all([say(i === 10 ? '10!' : String(i)), wait(620)]);
    }
    if (!ok()) return;
    BB.bus.refuel(1);
    if (PZ.gauge) PZ.gauge.classList.add('full');
    BB.sfx.gurgle(0.3); try { BB.sfx.sparkle(); } catch (e) { /* no sound */ }
    if (BB.ui && BB.ui.confetti) BB.ui.confetti(0.5);
    await say('A full tank! Thank you!');
    if (!ok()) return;
    // the nozzle goes back on the pump
    const n = PZ.nozzle, a = n.position.clone(), q0 = n.quaternion.clone();
    nozzleHome(); const b2 = n.position.clone(), q1 = n.quaternion.clone(); n.position.copy(a); n.quaternion.copy(q0);
    BB.sfx.pop();
    await tween(0.6, (t) => { n.position.lerpVectors(a, b2, t); n.position.y += Math.sin(t * Math.PI) * 0.5; n.quaternion.slerpQuaternions(q0, q1, t); });
    if (!ok()) return;
    pumpEnd(false);
    await wait(500);
    if (J.phase !== 'pump' || BB.bedtime) return;
    afterPump();
  }
  // (the game landed the nozzle without act: put it in the cap at once)
  function nozzleIn(side) {
    const n = PZ.nozzle, c = BB.bus.capWorld(new THREE.Vector3());
    n.position.copy(c); _pa.set(c.x - side.x, c.y - 0.35, c.z - side.z); n.lookAt(_pa);
  }
  // after the pump: bedtime if time is up, the garage if it was asked for, else the job carries on (or a new one)
  function afterPump() {
    if (timeUp()) { bedtime(); return; }
    setPhase('drive');
    try { BB.bus.closeDoors(); } catch (e) { console.error(e); }   // (leaves the pump bay so the bus can drive)
    if (J.wantDepot) { J.goDepot('quiet'); return; }
    const job = J.current;
    if (!job) { J.start(); return; }
    say('Off we go!', { queue: true });
    if (job.vehicle && job.index === 0 && job.legs[0] && job.legs[0].start) { say(job.legs[0].start, { queue: true }); resumeJob(true); }
    else resumeJob(false);
  }

  // ---------- the horn: people nearby jump and wave ----------
  let lastHorn = 0;
  function onHorn() {
    const now = performance.now();
    if (now - lastHorn < 300) return;
    lastHorn = now;
    const bp = BB.bus.pos || (BB.bus.front && BB.bus.front.position);
    for (const m of J.waiting.concat(J.extras, J.walkers.map((w) => w.m))) {
      if (bp && hypot2(m.position.x - bp.x, m.position.z - bp.z) > 30) continue;
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
    st.job.seats = Object.assign({}, st.seats || {}); st.job.friendBye = st.friendBye || null;   // who sits where, as on arrival
    const q = st.q;
    q.tries = 0; q.done = false; q.onRight = null;
    setWaiting(st.stop, q);
  }

  // ---------- per frame ----------
  // A gentle hint when the child seems lost: driving to a target and no nearer to it (by road) for about 15 s.
  // Standing still: hold the green pedal; facing away: turn around; else: follow the yellow arrows. At most every 40 s.
  let lostT = 0, lostBest = Infinity, lostTarget = null, lostCool = 0, lostTick = 0, stillT = 0;
  function updateLost(dt) {
    const B = BB.bus, t = B.target;
    lostCool = Math.max(0, lostCool - dt);
    const off = !t || (J.phase !== 'drive' && J.phase !== 'toPump') || B.atStop || (B.isSettling && B.isSettling()) || BB.bedtime || BB.depot.isOpen ||
      (BB.ui && BB.ui.homeShown && BB.ui.homeShown()) || (BB.ui && BB.ui.asking && BB.ui.asking()) ||
      // (a town event on screen, e.g. otters crossing or an ambulance coming: waiting for it is right, never "lost")
      (BB.events && BB.events.active && BB.events.active()) || (BB.ui && BB.ui.roadWait && BB.ui.roadWait());
    if (off) { lostT = 0; stillT = 0; lostTarget = null; return; }
    if (t !== lostTarget) { lostTarget = t; lostBest = Infinity; lostT = 0; stillT = 0; }
    lostT += dt; stillT = Math.abs(B.speed) < 0.6 ? stillT + dt : 0;
    if ((lostTick -= dt) <= 0) {
      lostTick = 1;
      let d = Infinity; try { d = +B.routeLength(t); } catch (e) { /* no route */ }
      if (isFinite(d) && d < lostBest - 4) { lostBest = d; lostT = 0; }
    }
    if (lostT < 15 || lostCool > 0) return;
    lostT = 0; lostCool = 40;
    const away = BB.ui && BB.ui.facingAway && BB.ui.facingAway();
    say(away ? 'Tap the turn around button!' : stillT > 8 ? 'Hold the green pedal to go!' : 'Follow the yellow arrows!');
  }
  J.update = function (dt) {
    if (wishEl && BB.bedtime) dropWish();
    if (BB.bedtime && marker) clearMarker();           // (the goodnight: no sign left standing)
    if (BB.bedtime && PZ.on) pumpEnd(true);
    try { updateMarker(dt); } catch (e) { console.error(e); }
    try { pumpUpdate(dt); } catch (e) { console.error(e); }
    try { updateLost(dt); } catch (e) { console.error(e); }
    if (J.phase === 'home') {
      if (BB.hands) BB.hands.stop();
      if (PZ.on) pumpEnd(true);                // (Home at the pump: the nozzle back, the gauge gone; after Drive the pump comes first)
      if (marker && marker.kind === 'pump') clearMarker();
      J.wantPump = false;
      if (J.stopStart) rewindStop();
      if (J.current && J.current.vehicle && J.stopStart !== false) { legGen++; clearWaiting(); scnClear(); clearMarker(); for (const m of J.extras) removePerson(m); J.extras = []; for (const w of J.walkers) removePerson(w.m); J.walkers = []; }
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
        if (hypot2(m.position.x - BB.bus.pos.x, m.position.z - BB.bus.pos.z) < 45) {
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
      if (bp && !u.keepFace && !J.walkers.some((w) => w.m === m)) m.rotation.y = Math.atan2(bp.x - m.position.x, bp.z - m.position.z);
      if (u.jump === 0) m.rotation.z = 0;
    }
    // the hands-on moment (targets, hints, the game's help), the fire's smoke and water
    if (BB.hands) {
      if (BB.hands.active() && (BB.bedtime || J.phase === 'drive' || J.phase === 'idle')) BB.hands.stop();
      if (SCN.tick) { try { SCN.tick(dt); } catch (e) { console.error(e); } }
      BB.hands.update(dt);
    }
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt / tw.dur;
      const t = Math.min(1, tw.t);
      try { tw.fn(t, dt); } catch (e) { console.error(e); }
      if (tw.t >= 1) { tweens.splice(i, 1); tw.done(); }
    }
    if (BATCHES.size) scnBatchSync();
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
