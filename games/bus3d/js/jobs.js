/* Bendy Bus 3D: jobs.
   A job = drive to 2-3 stops in turn. At each stop people get on or off and the child answers one adding or
   taking-away question shown with pictures to count (a ten-frame of seats plus the people joining or leaving),
   with three big number buttons. Wrong answer -> "Let's count together!" and the teaching scene, then try again.
   Cash for every stop and a bonus for the whole job (never taken away). Also: low-fuel trips to the depot and the
   friendly tow when the tank runs dry. Exposes BB.jobs = { current, start(), update(dt), ... }. */
(function () {
  'use strict';
  const BB = window.BB, P = BB.P;
  const J = BB.jobs = { current: null, phase: 'idle', walkers: [], waiting: [] };

  const CASH_STOP = 3, CASH_STOP_RETRY = 2, CASH_JOB = 5;
  // Difficulty grows with the number of questions answered (BB.save.questions). Every number stays 0-10.
  const LEVELS = [
    { kMax: 1, tot: 4, sub: false },       // first questions: 2 + 1, 3 + 1
    { kMax: 2, tot: 6, sub: false },
    { kMax: 2, tot: 7, sub: true },
    { kMax: 3, tot: 9, sub: true },
    { kMax: 5, tot: 10, sub: true },
  ];
  const level = () => { const q = BB.save.questions | 0; return q < 2 ? 0 : q < 4 ? 1 : q < 7 ? 2 : q < 11 ? 3 : 4; };

  // n = passengers on the bus now. Returns {kind, pre, n, k, answer, choices}.
  // pre: people who board first without a question (when the bus is empty), so every question starts from a group.
  function makeQuestion(n) {
    const lv = level(), L = LEVELS[lv];
    let pre = 0;
    if (n === 0) { pre = lv === 0 ? 2 : BB.randInt(1, 3); n = pre; }
    let kind = 'add';
    if (n + 1 > L.tot) kind = 'sub';                           // too full to add more: someone gets off
    else if (L.sub && n >= 2 && Math.random() < 0.5) kind = 'sub';
    let k;
    if (kind === 'add') k = BB.randInt(1, Math.max(1, Math.min(L.kMax, L.tot - n, 10 - n)));
    else k = BB.randInt(1, Math.max(1, Math.min(L.kMax, n - (lv < 3 ? 1 : 0))));
    const answer = kind === 'add' ? n + k : n - k;
    const pool = BB.shuffle([answer - 1, answer + 1, answer + 2, answer - 2, kind === 'add' ? n : n + k]).filter((v, i, a) => v >= 0 && v <= 10 && v !== answer && a.indexOf(v) === i);
    const choices = BB.shuffle([answer, pool[0], pool[1]]);
    return { kind, pre, n, k, answer, choices, tries: 0 };
  }
  J.makeQuestion = makeQuestion;

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
  // Put the people for the next question at the stop's shelter (facing the road).
  function setWaiting(stop, q) {
    clearWaiting();
    if (!stop || !q || q.kind !== 'add') return;
    const total = q.pre + q.k;
    for (let i = 0; i < total; i++) {
      const m = person(BB.randInt(0, 7));
      // a little queue on the pavement just past the shelter roof (so they're not hidden under it), toward the front door
      const along = 4.6 + Math.floor(i / 2) * 0.9, off = (i % 2) * 0.8 - 0.1;
      m.position.set(stop.pos.x + stop.fwd.x * along + stop.side.x * off, 0.25, stop.pos.z + stop.fwd.z * along + stop.side.z * off);
      m.rotation.y = Math.atan2(-stop.side.x, -stop.side.z);
      m.userData.pre = i < q.pre;
      J.waiting.push(m);
    }
  }
  // Walk a person to a point (a function, so it can follow the bus door), then call done.
  function walk(m, toFn, dur, done) { J.walkers.push({ m, from: m.position.clone(), toFn, t: 0, dur, done }); }
  function boardPeople(list, cb) {
    if (!list.length) { cb(); return; }
    let left = list.length;
    list.forEach((m, i) => BB.later(i * 280, () => walk(m, () => BB.bus.doorWorld().setY(0.25), 1.1, () => { removePerson(m); BB.sfx.pop(); if (--left === 0) cb(); })));
  }
  function alightPeople(count, stop) {
    for (let i = 0; i < count; i++) {
      BB.later(i * 300, () => {
        const m = person(BB.randInt(0, 7)), d = BB.bus.doorWorld().setY(0.25);
        m.position.copy(d);
        const tx = stop.pos.x + stop.side.x * 4 + stop.fwd.x * BB.rand(-5, 5), tz = stop.pos.z + stop.side.z * 4 + stop.fwd.z * BB.rand(-5, 5);
        walk(m, () => new THREE.Vector3(tx, 0.25, tz), 1.6, () => BB.later(800, () => removePerson(m)));
      });
    }
  }

  // ---------- question card (DOM) ----------
  BB.css(`
  .bbq { position: absolute; left: 50%; bottom: max(10px, env(safe-area-inset-bottom)); transform: translateX(-50%);
    --cell: 50px; width: min(820px, calc(100vw - 24px)); background: #fff6e0; border: 4px solid #d9b57f; border-radius: 28px;
    box-shadow: 0 8px 0 rgba(120,80,40,.18); padding: 14px 18px; display: flex; gap: 16px; align-items: center;
    pointer-events: auto; font-family: 'Fredoka', 'Baloo 2', system-ui, sans-serif; color: #3a2a3c;
    animation: bbq-in .35s cubic-bezier(.2,1.4,.5,1); }
  @keyframes bbq-in { from { transform: translate(-50%, 140%); } }
  .bbq-pic { flex: 1; display: flex; align-items: center; gap: 14px; justify-content: center; min-width: 0; }
  .bbq-frame { display: grid; grid-template-columns: repeat(5, var(--cell)); gap: 6px; padding: 8px; background: #3fae49;
    border-radius: 16px; }
  .bbq-seat { width: var(--cell); height: var(--cell); border-radius: 12px; background: #d6efd2; position: relative;
    display: flex; align-items: center; justify-content: center; transition: transform .2s, opacity .3s, background .2s; }
  .bbq-seat:nth-child(n+6) { background: #ffe2b8; }
  .bbq-seat svg, .bbq-wait svg { width: 82%; height: 82%; }
  .bbq-seat.leaving { outline: 4px dashed #ff6b5c; outline-offset: -4px; }
  .bbq-seat.gone svg { opacity: .18; }
  .bbq-seat.count, .bbq-wait span.count { transform: scale(1.18); background: #ffd45c !important; }
  .bbq.hint .bbq-seat.full { animation: bbq-glow 1s infinite alternate; }
  @keyframes bbq-glow { to { box-shadow: 0 0 0 5px #ffd45c, 0 0 18px #ffb81f; } }
  .bbq-plus { font-size: 44px; font-weight: 700; color: #19a79b; }
  .bbq-wait { display: flex; flex-wrap: wrap; gap: 4px; max-width: calc(var(--cell) * 2.6); }
  .bbq-wait span { width: var(--cell); height: var(--cell); border-radius: 12px; background: #e3f6ff; display: flex; align-items: center; justify-content: center; transition: transform .2s; }
  .bbq-side { display: flex; flex-direction: column; gap: 10px; align-items: center; }
  .bbq-ask { display: flex; gap: 10px; align-items: center; }
  .bbq-btn { width: 84px; height: 84px; border-radius: 24px; border: none; font: 700 46px 'Fredoka', 'Baloo 2', system-ui, sans-serif;
    color: #fff; background: #4fa3e0; box-shadow: 0 6px 0 #2f7fbc; cursor: pointer; touch-action: manipulation; }
  .bbq-btn:nth-child(2) { background: #f26b5b; box-shadow: 0 6px 0 #c84a3c; }
  .bbq-btn:nth-child(3) { background: #5cb85c; box-shadow: 0 6px 0 #3f913f; }
  .bbq-btn.pressed { transform: translateY(4px); box-shadow: 0 2px 0 rgba(0,0,0,.2); }
  .bbq-btn.no { opacity: .35; }
  .bbq-btn.yes { animation: bbq-pop .4s; }
  @keyframes bbq-pop { 50% { transform: scale(1.25); } }
  .bbq.teaching .bbq-btn { opacity: .35; pointer-events: none; }
  .bbq-say { width: 60px; height: 60px; border-radius: 50%; border: 3px solid #d9b57f; background: #fff; font-size: 28px; cursor: pointer; }
  @media (max-height: 520px) {
    .bbq { padding: 8px 12px; gap: 10px; border-radius: 22px; --cell: 38px; }
    .bbq-frame { gap: 4px; padding: 6px; }
    .bbq-btn { width: 66px; height: 66px; font-size: 38px; border-radius: 20px; }
    .bbq-say { width: 56px; height: 56px; }
  }`);
  const COLORS = [P.coral, P.teal, P.honey, P.berry, P.plum, P.leaf, P.rose, '#f28b4b', '#4cb5a0', '#d9a679'];
  const face = (c) => `<svg viewBox="0 0 40 40"><path d="M8 40 Q8 26 20 26 Q32 26 32 40Z" fill="${c}"/><circle cx="20" cy="16" r="9" fill="#f1c7a0"/><path d="M11 15 Q12 6 20 6 Q28 6 29 15 Q24 10 20 11 Q15 10 11 15Z" fill="#3a2a2c"/><circle cx="17" cy="17" r="1.4" fill="#3a2a3c"/><circle cx="23" cy="17" r="1.4" fill="#3a2a3c"/><path d="M17 21 Q20 23 23 21" stroke="#c0614e" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;
  let card = null;
  function sentence(q) {
    const fr = (x) => x === 1 ? '1 friend is' : x + ' friends are';
    return q.kind === 'add'
      ? `${fr(q.n)} on the bus. ${q.k} more ${q.k === 1 ? 'gets' : 'get'} on. How many now?`
      : `${fr(q.n)} on the bus. ${q.k} ${q.k === 1 ? 'gets' : 'get'} off. How many are left?`;
  }
  function renderPic(q, el) {
    let html = '<div class="bbq-frame">';
    for (let i = 0; i < 10; i++) {
      const full = i < q.n, leaving = q.kind === 'sub' && i >= q.n - q.k && i < q.n;
      html += `<div class="bbq-seat${full ? ' full' : ''}${leaving ? ' leaving' : ''}" data-i="${i}">${full ? face(COLORS[i]) : ''}</div>`;
    }
    html += '</div>';
    if (q.kind === 'add') {
      html += '<div class="bbq-plus">+</div><div class="bbq-wait">';
      for (let i = 0; i < q.k; i++) html += `<span data-w="${i}">${face(COLORS[(q.n + i) % 10])}</span>`;
      html += '</div>';
    }
    el.innerHTML = html;
  }
  function showQuestion(q, onRight) {
    hideQuestion();
    card = BB.el('div', 'bbq', BB.ui.root);
    const pic = BB.el('div', 'bbq-pic', card);
    const side = BB.el('div', 'bbq-side', card);
    const ask = BB.el('div', 'bbq-ask', side);
    renderPic(q, pic);
    const sayBtn = BB.el('button', 'bbq-say', side, '🔊');
    BB.tap(sayBtn, () => BB.say(sentence(q)));
    q.choices.forEach((v) => {
      const b = BB.el('button', 'bbq-btn', ask, String(v));
      b.dataset.v = v;
      BB.tap(b, () => answer(q, v, b, pic, onRight));
    });
    BB.emit('question:show', { q });
    J.phase = 'question';
    J.question = q;
    const start = () => BB.say(sentence(q));
    if (!BB.save.seen[q.kind]) {                // first time adding / taking away: a worked example first
      BB.save.seen[q.kind] = true; BB.saveNow();
      const demo = q.kind === 'add' ? { kind: 'add', n: 1, k: 1, answer: 2 } : { kind: 'sub', n: 3, k: 1, answer: 2 };
      J.teach(demo, pic, true).then(() => { renderPic(q, pic); start(); });
    } else start();
  }
  function hideQuestion() { if (card) { card.remove(); card = null; BB.emit('question:hide'); } }
  J.hideQuestion = hideQuestion;
  J.showQuestion = showQuestion;
  function answer(q, v, btn, pic, onRight) {
    if (!card || card.classList.contains('teaching') || q.done) return;
    if (v === q.answer) {
      q.done = true;
      btn.classList.add('yes'); BB.sfx.right();
      BB.save.questions = (BB.save.questions | 0) + 1; BB.saveNow();
      BB.say(`Yes! ${q.answer}!`);
      BB.later(1100, () => { hideQuestion(); onRight(q); });
    } else {
      q.tries++;
      btn.classList.add('no'); BB.sfx.wrong();
      if (q.tries >= 2) card.classList.add('hint');
      J.teach(q, pic, false).then(() => { if (!card) return; renderPic(q, pic); card.querySelectorAll('.bbq-btn').forEach((b) => b.classList.remove('no')); BB.say(q.kind === 'add' ? 'Now you try! How many now?' : 'Now you try! How many are left?'); });
    }
  }

  // ---------- the teaching scene (placeholder) ----------
  // Counts the pictures one by one with the voice. demo = a worked example shown the first time each kind appears.
  // TODO(jobs polish): a friendlier teaching scene (a character, counting fingers, seats lighting up on the 3D bus,
  // "5 and 2 more" ten-frame language), and the hint after 2 wrong tries.
  const wait = (ms) => new Promise((r) => BB.later(ms, r));
  J.teach = async function (q, pic, demo) {
    if (!card) return;
    card.classList.add('teaching');
    renderPic(q, pic);
    await BB.say(demo ? (q.kind === 'add' ? 'Let me show you how adding works!' : 'Let me show you how taking away works!') : "Let's count together!");
    const seats = pic.querySelectorAll('.bbq-seat'), waits = pic.querySelectorAll('.bbq-wait span');
    let c = 0;
    const tick = async (el) => { if (!card) return; c++; el.classList.add('count'); BB.sfx.tick(); BB.say(String(c)); await wait(850); };
    if (q.kind === 'add') {
      for (let i = 0; i < q.n; i++) await tick(seats[i]);
      for (let i = 0; i < q.k && waits[i]; i++) await tick(waits[i]);
    } else {
      await BB.say(`${q.k} ${q.k === 1 ? 'gets' : 'get'} off.`);
      for (let i = q.n - q.k; i < q.n; i++) { seats[i].classList.add('gone'); BB.sfx.pop(); await wait(400); }
      for (let i = 0; i < q.n - q.k; i++) await tick(seats[i]);
    }
    if (!card) return;
    await BB.say(`That makes ${q.answer}!`);
    await wait(500);
    if (card) card.classList.remove('teaching');
  };

  // ---------- the job loop ----------
  function pickStops() {
    const count = (BB.save.jobsDone | 0) < 1 ? 2 : BB.randInt(2, 3);
    const here = BB.bus.atStop || J.lastStop;
    const list = BB.shuffle(BB.world.stops.filter((s) => s !== here));
    return list.slice(0, count);
  }
  J.start = function () {
    if (BB.hub.timeUp()) { J.phase = 'bedtime'; BB.emit('jobs:bedtime'); return; }   // TODO(hub): goodnight moment
    const job = { stops: pickStops(), index: 0, cash: 0, q: null };
    J.current = job;
    BB.emit('job:new', { job });
    BB.say(`New job! Drive to ${job.stops[0].say}!`);
    nextStop(true);
  };
  function nextStop(quiet) {
    const job = J.current; if (!job) return;
    const stop = job.stops[job.index];
    job.q = makeQuestion(BB.bus.passengers);
    setWaiting(stop, job.q);
    J.phase = 'drive';
    BB.bus.stopAt(stop, onArrive);
    BB.emit('job:target', { stop, job });
    if (!quiet) BB.say(`Now drive to ${stop.say}!`);
  }
  J.nextStop = nextStop;
  function onArrive(stop) {
    const job = J.current; if (!job) return;
    J.phase = 'stop'; J.lastStop = stop;
    BB.bus.openDoors(); BB.sfx.ding();
    const q = job.q;
    BB.later(500, () => {
      const pre = J.waiting.filter((m) => m.userData.pre);
      J.waiting = J.waiting.filter((m) => !m.userData.pre);
      boardPeople(pre, () => {
        if (q.pre) BB.bus.passengers = q.n;
        showQuestion(q, () => afterRight(stop, q));
      });
    });
  }
  function afterRight(stop, q) {
    const job = J.current;
    const cash = q.tries ? CASH_STOP_RETRY : CASH_STOP;
    const finish = () => {
      BB.bus.passengers = q.answer;
      BB.depot.add(cash); job.cash += cash;
      BB.emit('job:stopDone', { correct: true, cash, stop });
      BB.later(900, () => {
        BB.bus.closeDoors();
        job.index++;
        if (job.index >= job.stops.length) jobDone();
        else if (J.wantDepot) J.goDepot();
        else nextStop();
      });
    };
    if (q.kind === 'add') { const list = J.waiting; J.waiting = []; boardPeople(list, finish); }
    else { BB.bus.passengers = q.answer; alightPeople(q.k, stop); BB.later(900, finish); }
  }
  function jobDone() {
    const job = J.current;
    BB.save.jobsDone = (BB.save.jobsDone | 0) + 1; BB.saveNow();
    BB.depot.add(CASH_JOB); job.cash += CASH_JOB;
    BB.sfx.cheer();
    BB.say('Job done! Great driving!');
    BB.emit('job:done', { cash: job.cash, job });
    J.current = null; J.phase = 'done';
    BB.later(3200, () => {
      if (J.phase !== 'done') return;
      if (J.wantDepot || BB.bus.fuel <= BB.cfg.fuelLow) J.goDepot();
      else J.start();
    });
  }

  // ---------- depot trips, low fuel and the tow ----------
  J.goDepot = function (reason) {
    if (J.phase === 'question' || J.phase === 'stop') { J.wantDepot = true; return; }
    J.wantDepot = false;
    J.phase = 'toDepot';
    BB.bus.closeDoors();
    BB.bus.stopAt(BB.world.depot, () => {
      J.phase = 'depot';
      BB.bus.openDoors();
      BB.depot.open();
    });
    BB.emit('job:target', { stop: BB.world.depot, job: J.current });
    if (reason !== 'quiet') BB.say(reason === 'fuel' ? "I'm getting hungry, let's go to the depot!" : "Let's drive to the depot!");
  };
  BB.on('depot:closed', () => {
    if (J.phase !== 'depot') return;
    BB.bus.closeDoors();
    if (J.current) nextStop();
    else J.start();
  });
  BB.on('bus:fuelLow', () => {
    if (J.phase === 'drive' || J.phase === 'done') J.goDepot('fuel');
    else if (J.phase !== 'toDepot') { J.wantDepot = true; }
  });
  // Out of fuel: a friendly tow to the depot and a free top-up. No cost, no lost progress.
  // TODO(jobs/world polish): the tow truck itself (drives up, hooks on, pulls the bus to the depot).
  BB.on('bus:fuelEmpty', () => {
    J.phase = 'tow'; BB.bus.locked = true;
    BB.say("Oh! We're out of fuel. Here comes the tow truck!");
    BB.later(2200, () => BB.ui.fade(() => {
      BB.bus.placeAt(BB.world.depot);
      BB.bus.atStop = null;
      BB.bus.refuel(1);
    }, () => {
      BB.bus.locked = false;
      BB.say("Free fuel at the depot! Let's go!");
      if (J.current) nextStop(true); else J.start();
    }));
  });

  // ---------- per frame ----------
  J.update = function (dt) {
    for (let i = J.walkers.length - 1; i >= 0; i--) {
      const w = J.walkers[i];
      w.t += dt / w.dur;
      const to = w.toFn(), t = Math.min(1, w.t);
      w.m.position.lerpVectors(w.from, to, t);
      w.m.position.y = to.y + Math.abs(Math.sin(t * Math.PI * 5)) * 0.18;
      const dx = to.x - w.from.x, dz = to.z - w.from.z;
      if (dx || dz) w.m.rotation.y = Math.atan2(dx, dz);
      if (w.t >= 1) { J.walkers.splice(i, 1); if (w.done) w.done(); }
    }
    // gentle idle bob for people waiting at the stop
    const t = performance.now() / 1000;
    J.waiting.forEach((m, i) => { m.position.y = 0.25 + Math.max(0, Math.sin(t * 2 + i)) * 0.05; });
  };

  J.init = function () { buildLooks(); };
})();
