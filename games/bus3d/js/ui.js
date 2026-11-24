/* Bendy Bus 3D: HUD and screens (DOM over the canvas, inside #ui).
   Cash with a coin, fuel gauge as a picture, the job card (picture of the next stop + progress dots), the GO pedal,
   turn arrows at junctions, horn, depot button, sound buttons, the title screen ("Tap to drive!"), toasts, coins,
   confetti, a fade for the tow, and a turn-sideways hint (standalone portrait).
   Listens to events; exposes BB.ui. */
(function () {
  'use strict';
  const BB = window.BB, P = BB.P;
  const U = BB.ui = { root: null };

  BB.css(`
  #ui { font-family: 'Baloo 2', 'Fredoka', system-ui, sans-serif; color: #3a2a3c; }
  #ui button { font-family: inherit; }
  .bbu-hud { position: absolute; inset: 0; pointer-events: none; transition: opacity .3s; }
  .bbu-hud.off { opacity: 0; } .bbu-hud.off * { pointer-events: none !important; }
  .bbu-top { position: absolute; top: max(10px, env(safe-area-inset-top)); left: max(12px, env(safe-area-inset-left));
    right: max(12px, env(safe-area-inset-right)); display: flex; align-items: flex-start; gap: 10px; }
  .bbu-pill { pointer-events: auto; display: flex; align-items: center; gap: 6px; background: #fff6e0; border: 3px solid #d9b57f;
    border-radius: 32px; padding: 4px 14px 4px 6px; height: 56px; box-sizing: border-box; box-shadow: 0 4px 0 rgba(120,80,40,.15); }
  .bbu-pill canvas { width: 40px; height: 40px; }
  .bbu-cash b { font-size: 30px; min-width: 1.2em; }
  .bbu-cash.bump { animation: bbu-bump .5s; }
  @keyframes bbu-bump { 40% { transform: scale(1.18); } }
  .bbu-fuel .bar { width: 96px; height: 20px; border-radius: 12px; background: #eadfca; overflow: hidden; display: flex; gap: 3px; padding: 2px; box-sizing: border-box; }
  .bbu-fuel .bar i { flex: 1; border-radius: 6px; background: #5cb85c; }
  .bbu-fuel .bar i.off { background: transparent; }
  .bbu-fuel.low .bar i { background: #ff9a3c; } .bbu-fuel.low { animation: bbu-bump 1.2s infinite; }
  .bbu-job { margin: 0 auto; pointer-events: auto; display: flex; align-items: center; gap: 8px; padding-right: 16px; }
  .bbu-job canvas { width: 46px; height: 46px; }
  .bbu-job .dots { display: flex; gap: 6px; }
  .bbu-job .dots i { width: 16px; height: 16px; border-radius: 50%; background: #eadfca; border: 2px solid #d9b57f; }
  .bbu-job .dots i.done { background: #5cb85c; border-color: #3f913f; }
  .bbu-job .dots i.now { background: #ffd45c; border-color: #d98700; }
  .bbu-right { display: flex; gap: 8px; }
  .bbu-round { pointer-events: auto; width: 56px; height: 56px; border-radius: 50%; background: #fff6e0; border: 3px solid #d9b57f;
    box-shadow: 0 4px 0 rgba(120,80,40,.15); display: flex; align-items: center; justify-content: center; font-size: 26px; cursor: pointer;
    padding: 0; touch-action: manipulation; }
  .bbu-round canvas { width: 40px; height: 40px; }
  .bbu-round.pressed, .bbu-pill.pressed { transform: translateY(3px); box-shadow: none; }
  .bbu-round.offx { opacity: .5; }
  .bbu-exit { width: 64px; height: 64px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 12px; box-sizing: border-box;
    animation: bbu-bob 2.4s ease-in-out infinite; }
  .bbu-exit i { border-radius: 5px; } @keyframes bbu-bob { 50% { transform: translateY(-3px); } }
  .bbu-go { position: absolute; right: max(18px, env(safe-area-inset-right)); bottom: max(18px, env(safe-area-inset-bottom));
    width: 136px; height: 136px; border-radius: 50%; border: none; pointer-events: auto; cursor: pointer; touch-action: none;
    background: radial-gradient(circle at 40% 35%, #7ad86f, #3fae49 60%, #2f8f3a); box-shadow: 0 8px 0 #24702d, 0 10px 18px rgba(0,0,0,.18);
    color: #fff; font-size: 40px; font-weight: 800; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; }
  .bbu-go svg { width: 54px; height: 54px; }
  .bbu-go.down { transform: translateY(6px) scale(.97); box-shadow: 0 2px 0 #24702d; }
  .bbu-go.nudge { animation: bbu-nudge 1.4s ease-in-out infinite; }
  @keyframes bbu-nudge { 50% { box-shadow: 0 8px 0 #24702d, 0 0 0 14px rgba(255,212,92,.6); } }
  .bbu-horn { position: absolute; left: max(18px, env(safe-area-inset-left)); bottom: max(18px, env(safe-area-inset-bottom)); width: 84px; height: 84px; font-size: 40px; }
  .bbu-arrows { position: absolute; left: 50%; bottom: max(18px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: 14px; pointer-events: none; }
  .bbu-arrow { width: 100px; height: 100px; border-radius: 28px; border: 4px solid #d9b57f; background: #fff6e0; pointer-events: auto; cursor: pointer;
    box-shadow: 0 6px 0 rgba(120,80,40,.2); display: flex; align-items: center; justify-content: center; padding: 0; touch-action: manipulation;
    animation: bbu-pop .3s cubic-bezier(.2,1.5,.5,1); }
  .bbu-arrow svg { width: 64px; height: 64px; }
  .bbu-arrow.sug { border-color: #ffb81f; background: #fff1c2; animation: bbu-pop .3s cubic-bezier(.2,1.5,.5,1), bbu-glow 1s .3s infinite alternate; }
  .bbu-arrow.picked { border-color: #19a79b; background: #c9f2e4; transform: scale(1.1); }
  .bbu-arrow.pressed { transform: translateY(4px); }
  @keyframes bbu-pop { from { transform: scale(.3); opacity: 0; } }
  @keyframes bbu-glow { to { box-shadow: 0 6px 0 rgba(120,80,40,.2), 0 0 0 8px rgba(255,212,92,.55); } }
  .bbu-title { position: absolute; inset: 0; pointer-events: auto; display: flex; flex-direction: column; align-items: center; justify-content: space-between;
    padding: max(24px, env(safe-area-inset-top)) 16px max(28px, env(safe-area-inset-bottom)); box-sizing: border-box; cursor: pointer;
    background: linear-gradient(rgba(255,246,224,.0), rgba(255,246,224,0) 60%, rgba(255,230,180,.35)); }
  .bbu-logo { font-size: clamp(44px, 9vw, 92px); font-weight: 800; color: #fff; letter-spacing: 1px; line-height: 1;
    text-shadow: 0 5px 0 #2f8f3a, 0 8px 14px rgba(0,0,0,.2); -webkit-text-stroke: 3px #3fae49; paint-order: stroke fill; }
  .bbu-logo span { color: #ffd45c; -webkit-text-stroke-color: #d98700; text-shadow: 0 5px 0 #b06e00, 0 8px 14px rgba(0,0,0,.2); }
  .bbu-tap { font-size: clamp(28px, 5vw, 44px); font-weight: 800; background: #ffb81f; color: #fff; border-radius: 40px; padding: 10px 34px;
    box-shadow: 0 7px 0 #d98700; text-shadow: 0 2px 0 #d98700; animation: bbu-pulse 1.3s ease-in-out infinite; }
  @keyframes bbu-pulse { 50% { transform: scale(1.07); } }
  .bbu-toast { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); font-size: 40px; font-weight: 800; color: #fff;
    text-shadow: 0 3px 0 #d98700, 0 0 12px rgba(0,0,0,.2); pointer-events: none; animation: bbu-float 1.4s ease-out forwards; white-space: nowrap;
    display: flex; align-items: center; gap: 8px; }
  .bbu-toast canvas { width: 48px; height: 48px; }
  @keyframes bbu-float { from { transform: translate(-50%, 20px) scale(.6); opacity: 0; } 20% { transform: translate(-50%, 0) scale(1.1); opacity: 1; } 80% { opacity: 1; } to { transform: translate(-50%, -40px); opacity: 0; } }
  .bbu-fade { position: absolute; inset: 0; background: #fff6e0; opacity: 0; transition: opacity .6s; pointer-events: auto; }
  .bbu-confetti { position: absolute; top: -20px; width: 12px; height: 18px; border-radius: 3px; pointer-events: none; animation: bbu-fall linear forwards; }
  @keyframes bbu-fall { to { transform: translateY(110vh) rotate(720deg); } }
  .bbu-turn { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 16px;
    background: #fdebc8; pointer-events: auto; font-size: 30px; font-weight: 800; text-align: center; }
  .bbu-turn .phone { width: 80px; height: 130px; border: 8px solid #3a2a3c; border-radius: 18px; animation: bbu-rot 2s ease-in-out infinite; }
  @keyframes bbu-rot { 40%, 100% { transform: rotate(-90deg); } }
  @media (orientation: portrait) { .bbu-turn.standalone { display: flex; } }
  @media (max-height: 520px) {
    .bbu-pill, .bbu-round { height: 56px; } .bbu-pill { padding-right: 10px; } .bbu-cash b { font-size: 24px; }
    .bbu-fuel .bar { width: 64px; } .bbu-go { width: 112px; height: 112px; font-size: 32px; } .bbu-go svg { width: 44px; height: 44px; }
    .bbu-arrow { width: 84px; height: 84px; } .bbu-arrow svg { width: 52px; height: 52px; } .bbu-horn { width: 72px; height: 72px; font-size: 34px; }
  }`);

  const picCanvas = (name, size = 80) => { const c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').drawImage(BB.pic(name, size), 0, 0); return c; };
  const ARROW = {
    left: '<svg viewBox="0 0 64 64"><path d="M40 52 V30 Q40 22 32 22 H22 V12 L6 27 L22 42 V32 H30 V52Z" fill="#19a79b"/></svg>',
    straight: '<svg viewBox="0 0 64 64"><path d="M24 58 V26 H12 L32 6 L52 26 H40 V58Z" fill="#19a79b"/></svg>',
    right: '<svg viewBox="0 0 64 64"><path d="M24 52 V30 Q24 22 32 22 H42 V12 L58 27 L42 42 V32 H34 V52Z" fill="#19a79b"/></svg>',
  };
  let hud, cashEl, fuelEl, fuelBars, jobEl, jobPic, jobDots, goBtn, arrowsEl, titleEl, soundBtn, musicBtn, exitBtn;

  U.init = function () {
    U.root = document.getElementById('ui');
    hud = BB.el('div', 'bbu-hud off', U.root);
    const top = BB.el('div', 'bbu-top', hud);
    // all-games button (hub mode only). TODO(hub-mode builder): show it on the title/garage screen as the hub spec says.
    if (BB.HUB) {
      exitBtn = BB.el('button', 'bbu-round bbu-exit', top, '<i style="background:#f26b5b"></i><i style="background:#f5b83d"></i><i style="background:#5cb85c"></i><i style="background:#4fa3e0"></i>');
      BB.tap(exitBtn, () => BB.hub.post({ hub: 'exit' }));
    }
    cashEl = BB.el('div', 'bbu-pill bbu-cash', top); cashEl.appendChild(picCanvas('coin', 64)); BB.el('b', '', cashEl, String(BB.depot.cash));
    fuelEl = BB.el('div', 'bbu-pill bbu-fuel', top); fuelEl.appendChild(picCanvas('pump', 64));
    const bar = BB.el('div', 'bar', fuelEl); fuelBars = [];
    for (let i = 0; i < 5; i++) fuelBars.push(BB.el('i', '', bar));
    jobEl = BB.el('div', 'bbu-pill bbu-job', top); jobPic = BB.el('canvas', '', jobEl); jobPic.width = jobPic.height = 80;
    jobDots = BB.el('div', 'dots', jobEl);
    BB.tap(jobEl, () => { const t = BB.bus.target; if (t) BB.say(`Drive to ${t.say}!`); });
    jobEl.style.visibility = 'hidden';
    const right = BB.el('div', 'bbu-right', top);
    const depotBtn = BB.el('button', 'bbu-round', right); depotBtn.appendChild(picCanvas('depot', 80));
    BB.tap(depotBtn, () => { if (BB.jobs.phase === 'drive' || BB.jobs.phase === 'done') BB.jobs.goDepot(); });
    musicBtn = BB.el('button', 'bbu-round', right, '🎵');
    soundBtn = BB.el('button', 'bbu-round', right, '🔊');
    BB.tap(musicBtn, () => BB.audio.setSound(BB.audio.mute, !BB.audio.music, true));
    BB.tap(soundBtn, () => BB.audio.setSound(!BB.audio.mute, BB.audio.music, true));
    BB.on('sound:changed', syncSound); syncSound();

    // GO pedal: hold to drive
    goBtn = BB.el('button', 'bbu-go', hud, '<svg viewBox="0 0 64 64"><path d="M14 10 L54 32 L14 54 Z" fill="#fff"/></svg>GO');
    const down = (e) => { e.preventDefault(); goBtn.setPointerCapture && goBtn.setPointerCapture(e.pointerId); goBtn.classList.add('down'); goBtn.classList.remove('nudge'); BB.bus.go(true); };
    const up = () => { goBtn.classList.remove('down'); BB.bus.go(false); };
    goBtn.addEventListener('pointerdown', down);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) goBtn.addEventListener(ev, up);
    goBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    const horn = BB.el('button', 'bbu-round bbu-horn', hud, '📯');
    BB.tap(horn, () => BB.bus.horn());
    arrowsEl = BB.el('div', 'bbu-arrows', hud);

    // title
    titleEl = BB.el('div', 'bbu-title', U.root, '<div class="bbu-logo">Bendy <span>Bus</span></div><div class="bbu-tap">Tap to drive!</div>');
    titleEl.style.display = 'none';
    BB.tap(titleEl, () => { U.hideTitle(); BB.emit('title:start'); });
    // standalone portrait hint (the hub shows its own card in hub mode)
    BB.el('div', 'bbu-turn' + (BB.HUB ? '' : ' standalone'), U.root, '<div class="phone"></div><div>Turn me sideways!</div>');

    // keyboard (for testing; touch is first)
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'ArrowUp' || e.code === 'Space') { BB.bus.go(true); goBtn.classList.add('down'); e.preventDefault(); }
      else if (e.code === 'ArrowLeft') BB.bus.choose('left');
      else if (e.code === 'ArrowRight') BB.bus.choose('right');
      else if (e.code === 'ArrowDown') BB.bus.choose('straight');
      else if (e.code === 'KeyH') BB.bus.horn();
      else if (e.code === 'Enter' && titleEl.style.display !== 'none') { U.hideTitle(); BB.emit('title:start'); }
    });
    addEventListener('keyup', (e) => { if (e.code === 'ArrowUp' || e.code === 'Space') { BB.bus.go(false); goBtn.classList.remove('down'); } });
    addEventListener('blur', () => { BB.bus.go(false); goBtn.classList.remove('down'); });

    // events
    BB.on('cash:changed', (d) => {
      cashEl.querySelector('b').textContent = String(d.cash);
      if (d.delta > 0) { cashEl.classList.remove('bump'); void cashEl.offsetWidth; cashEl.classList.add('bump'); U.coins(d.delta); }
    });
    BB.on('job:new', () => renderJob());
    BB.on('job:target', () => renderJob());
    BB.on('job:stopDone', () => renderJob());
    BB.on('job:done', () => { renderJob(); U.confetti(); });
    BB.on('bus:atJunction', (d) => showArrows(d.options, d.suggested));
    BB.on('bus:chosen', (d) => arrowsEl.querySelectorAll('.bbu-arrow').forEach((b) => b.classList.toggle('picked', b.dataset.dir === d.dir)));
    BB.on('bus:junctionDone', () => { arrowsEl.innerHTML = ''; });
    BB.on('bus:arrived', () => { arrowsEl.innerHTML = ''; });
    BB.on('question:show', () => setDriving(false));
    BB.on('question:hide', () => setDriving(true));
    BB.on('depot:open', () => hud.classList.add('off'));
    BB.on('depot:closed', () => hud.classList.remove('off'));
  };
  function syncSound() {
    soundBtn.textContent = BB.audio.mute ? '🔇' : '🔊';
    musicBtn.classList.toggle('offx', !BB.audio.music || BB.audio.mute);
  }
  function setDriving(on) {
    goBtn.style.display = on ? '' : 'none';
    arrowsEl.style.display = on ? '' : 'none';
    hud.querySelector('.bbu-horn').style.display = on ? '' : 'none';
  }
  function renderJob() {
    const job = BB.jobs.current, t = BB.bus.target;
    if (!t && !job) { jobEl.style.visibility = 'hidden'; return; }
    jobEl.style.visibility = 'visible';
    const stop = t || (job && job.stops[Math.min(job.index, job.stops.length - 1)]);
    const x = jobPic.getContext('2d'); x.clearRect(0, 0, 80, 80); if (stop) x.drawImage(BB.pic(stop.pic, 80), 0, 0);
    jobDots.innerHTML = '';
    if (job) job.stops.forEach((s, i) => BB.el('i', i < job.index ? 'done' : i === job.index ? 'now' : '', jobDots));
  }
  function showArrows(options, suggested) {
    arrowsEl.innerHTML = '';
    for (const dir of ['left', 'straight', 'right']) {
      if (!options.includes(dir)) continue;
      const b = BB.el('button', 'bbu-arrow' + (dir === suggested ? ' sug' : ''), arrowsEl, ARROW[dir]);
      b.dataset.dir = dir;
      BB.tap(b, () => BB.bus.choose(dir));
    }
    BB.sfx.beep();
  }

  U.showTitle = function () { titleEl.style.display = ''; hud.classList.add('off'); };
  U.hideTitle = function () { titleEl.style.display = 'none'; hud.classList.remove('off'); goBtn.classList.add('nudge'); };
  U.toast = function (html, ms = 1400) { const t = BB.el('div', 'bbu-toast', U.root, html); BB.later(ms, () => t.remove()); return t; };
  U.coins = function (n) { const t = U.toast(`+${n}`); t.prepend(picCanvas('coin', 64)); BB.sfx.coin(); };
  U.confetti = function () {
    const cols = [P.coral, P.honey, P.teal, P.berry, P.leaf, P.rose];
    for (let i = 0; i < 40; i++) {
      const c = BB.el('div', 'bbu-confetti', U.root);
      c.style.left = Math.random() * 100 + 'vw'; c.style.background = cols[i % cols.length];
      c.style.animationDuration = (1.8 + Math.random() * 1.6) + 's'; c.style.animationDelay = Math.random() * 0.5 + 's';
      BB.later(4200, () => c.remove());
    }
  };
  // Fade to cream, run mid() while hidden, fade back, then end().
  U.fade = function (mid, end) {
    const f = BB.el('div', 'bbu-fade', U.root);
    requestAnimationFrame(() => { f.style.opacity = '1'; });
    BB.later(700, () => { try { mid && mid(); } finally { BB.later(400, () => { f.style.opacity = '0'; BB.later(650, () => { f.remove(); end && end(); }); }); } });
  };

  let fuelShown = -1;
  U.update = function () {
    const f = BB.bus.fuel, lv = Math.ceil(f * 5 - 0.001);
    if (lv !== fuelShown) {
      fuelShown = lv;
      fuelBars.forEach((b, i) => b.classList.toggle('off', i >= lv));
      fuelEl.classList.toggle('low', f <= BB.cfg.fuelLow);
    }
    // TODO(hub-mode builder): play clock chip (cream pill, drawn clock, m:ss, orange with a moon in the last minute).
  };
})();
