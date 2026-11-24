/* Bendy Bus 3D: HUD and screens (DOM over the canvas, inside #ui).
   Cash with a coin, fuel gauge as a picture, the job card (picture of the next stop + progress dots), the GO pedal,
   steering and GO/reverse pedals (hold, multi-touch), horn, depot button, sound buttons, the title screen ("Tap to drive!"), toasts, coins,
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
  .bbu-top { position: absolute; top: var(--st); left: var(--sl); right: var(--sr); display: flex; align-items: flex-start; gap: 10px; }
  .bbu-pill { pointer-events: auto; display: flex; align-items: center; gap: 6px; background: #fff6e0; border: 3px solid #d9b57f;
    border-radius: 32px; padding: 4px 14px 4px 6px; height: 56px; box-sizing: border-box; box-shadow: 0 4px 0 rgba(120,80,40,.15); }
  .bbu-pill canvas { width: 40px; height: 40px; }
  .bbu-cash b { font-size: 30px; min-width: 1.2em; }
  .bbu-cash.bump { animation: bbu-bump .5s; }
  @keyframes bbu-bump { 40% { transform: scale(1.18); } }
  /* the fuel gauge: a little dashboard dial (canvas) */
  .bbu-fuel { padding: 0 8px; height: 68px; cursor: pointer; }
  .bbu-fuel canvas { width: 120px; height: 60px; display: block; }
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
  /* the shared "all games" button (hub mode, title and garage screens) */
  .bbu-exit { position: absolute; z-index: 30; left: var(--sl); top: var(--st); width: 64px; height: 64px; padding: 0; border-radius: 50%;
    background: #fff6e0; border: 3px solid #d9b57f; box-sizing: border-box; pointer-events: auto; cursor: pointer; touch-action: manipulation;
    box-shadow: inset -4px -5px 0 rgba(217,181,127,.42), 0 4px 10px rgba(60,40,20,.25); animation: bbu-bob 2.4s ease-in-out infinite; }
  .bbu-exit svg { width: 100%; height: 100%; display: block; }
  .bbu-exit.pressed { transform: translateY(2px); box-shadow: inset -4px -5px 0 rgba(217,181,127,.42), 0 2px 4px rgba(60,40,20,.25); }
  @keyframes bbu-bob { 0%, 100% { translate: 0 -2px; } 50% { translate: 0 2px; } }
  /* the shared play clock chip (hub mode): cream pill, drawn clock, m:ss; orange with a moon in the last minute */
  .bbu-clock { pointer-events: auto; display: flex; align-items: center; gap: 6px; height: 56px; box-sizing: border-box; padding: 0 16px 0 10px;
    background: #fff6e0; border-radius: 999px; font-size: 28px; font-weight: 800; color: #3a2a3c; white-space: nowrap; flex: none;
    font-variant-numeric: tabular-nums; box-shadow: inset -3px -4px 0 rgba(217,181,127,.45), 0 4px 0 rgba(120,80,40,.15);
    transition: background .4s, color .4s; }
  .bbu-clock svg { width: 34px; height: 34px; display: block; }
  .bbu-clock .ic-moon, .bbu-clock.late .ic-clock { display: none; } .bbu-clock.late .ic-moon { display: block; }
  .bbu-clock.late { background: #ff9a2e; color: #fff; text-shadow: 0 2px 0 rgba(0,0,0,.2); box-shadow: inset -3px -4px 0 rgba(180,90,10,.35), 0 4px 0 rgba(0,0,0,.15); }
  .bbu-clock.hidden { display: none; }
  html.hub-sound-wait .bbu-snd { visibility: hidden; }
  /* goodnight */
  .bbu-night { position: absolute; inset: 0; pointer-events: auto; opacity: 0; transition: opacity 2.5s;
    background: radial-gradient(ellipse at 50% 30%, rgba(40,48,120,.25), rgba(14,18,60,.62)); }
  .bbu-night.on { opacity: 1; }
  .bbu-night .moon { position: absolute; right: calc(var(--sr) + 40px); top: calc(var(--st) + 20px); width: 90px; height: 90px; }
  .bbu-night .star { position: absolute; width: 8px; height: 8px; border-radius: 50%; background: #fff3b8; animation: bbu-twinkle 2s ease-in-out infinite; }
  @keyframes bbu-twinkle { 50% { opacity: .3; transform: scale(.6); } }
  .bbu-night .zzz { position: absolute; left: 50%; top: 38%; font-size: 54px; font-weight: 800; color: #fff3b8; opacity: 0;
    text-shadow: 0 3px 0 rgba(0,0,0,.25); animation: bbu-zzz 3s ease-out infinite 1.5s; }
  @keyframes bbu-zzz { 0% { opacity: 0; transform: translate(0, 10px) scale(.6); } 30% { opacity: 1; } 100% { opacity: 0; transform: translate(40px, -60px) scale(1.2); } }
  /* driving controls: hold-buttons, several at once (steer + GO). Steering bottom-left, pedals bottom-right. */
  /* one-thumb joystick (bottom-right; .lefty puts it bottom-left), horn on the other side with the lane-helper toggle above it */
  .bbu-joy { position: absolute; bottom: var(--sb); right: calc(var(--sr) + 6px); width: 176px; height: 176px; border-radius: 50%;
    pointer-events: auto; touch-action: none; box-sizing: border-box; border: 4px solid #d9b57f;
    background: radial-gradient(circle at 45% 40%, #fffdf6, #fff6e0 55%, #f1dfb8);
    box-shadow: inset -6px -8px 0 rgba(217,181,127,.4), 0 6px 0 rgba(120,80,40,.2), 0 8px 18px rgba(0,0,0,.12); }
  .bbu-joy > svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .bbu-knob { position: absolute; left: 50%; top: 50%; width: 46%; height: 46%; margin: -23% 0 0 -23%; border-radius: 50%; pointer-events: none;
    background: radial-gradient(circle at 40% 35%, #7ad86f, #3fae49 60%, #2f8f3a); box-shadow: 0 6px 0 #24702d, 0 8px 12px rgba(0,0,0,.18);
    transition: transform .28s cubic-bezier(.3,1.7,.5,1); }
  .bbu-knob::after { content: ''; position: absolute; left: 22%; top: 16%; width: 30%; height: 20%; border-radius: 50%; background: rgba(255,255,255,.45); transform: rotate(-25deg); }
  .bbu-joy.drag .bbu-knob { transition: none; }
  .bbu-joy.nudge { animation: bbu-nudge 1.4s ease-in-out infinite; }
  @keyframes bbu-nudge { 50% { box-shadow: inset -6px -8px 0 rgba(217,181,127,.4), 0 6px 0 rgba(120,80,40,.2), 0 0 0 14px rgba(255,212,92,.55); } }
  .bbu-horn { position: absolute; left: calc(var(--sl) + 6px); bottom: var(--sb); width: 72px; height: 72px; font-size: 34px; }
  .bbu-assist { position: absolute; left: calc(var(--sl) + 10px); bottom: calc(var(--sb) + 72px + 24px); width: 64px; height: 64px; padding: 0; }
  .bbu-assist svg { width: 48px; height: 48px; } .bbu-assist .spk { opacity: 0; }
  .bbu-assist.on { background: #c9f2e4; border-color: #19a79b; } .bbu-assist.on .spk { opacity: 1; }
  .lefty .bbu-joy { right: auto; left: calc(var(--sl) + 6px); }
  .lefty .bbu-horn { left: auto; right: calc(var(--sr) + 6px); }
  .lefty .bbu-assist { left: auto; right: calc(var(--sr) + 10px); }
  .bbu-wobble { animation: bbu-wobble .35s ease-out; }
  @keyframes bbu-wobble { 25% { transform: translate(-5px, 2px); } 50% { transform: translate(4px, -2px); } 75% { transform: translate(-2px, 1px); } }
  @keyframes bbu-pop { from { transform: scale(.3); opacity: 0; } }
  @keyframes bbu-glow { to { box-shadow: 0 6px 0 rgba(120,80,40,.2), 0 0 0 8px rgba(255,212,92,.55); } }
  .bbu-title { position: absolute; inset: 0; pointer-events: auto; display: flex; flex-direction: column; align-items: center; justify-content: space-between;
    padding: calc(var(--st) + 14px) var(--sr) calc(var(--sb) + 10px) var(--sl); box-sizing: border-box; cursor: pointer;
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
  .bbu-turn { position: absolute; inset: 0; z-index: 60; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 16px;
    background: #fdebc8; pointer-events: auto; font-size: 30px; font-weight: 800; text-align: center; }
  .bbu-turn .phone { width: 150px; height: 150px; }
  .bbu-turn .phone .dev { transform-origin: 60px 60px; animation: bbu-rot 2.4s ease-in-out infinite; }
  @keyframes bbu-rot { 0%, 20% { transform: rotate(0deg); } 55%, 100% { transform: rotate(-90deg); } }
  .bbu-turn .phone .arc { animation: bbu-arc 2.4s ease-in-out infinite; }
  @keyframes bbu-arc { 0%, 15% { opacity: 1; } 55%, 100% { opacity: .25; } }
  /* turn-around button (bus:facingAway) */
  .bbu-uturn { position: absolute; right: calc(var(--sr) + 6px + 46px); bottom: calc(var(--sb) + 176px + 16px); width: 84px; height: 84px; border-radius: 26px;
    background: #fff6e0; border: 4px solid #d9b57f; padding: 0; pointer-events: auto; cursor: pointer; touch-action: manipulation; display: none;
    box-shadow: inset -4px -5px 0 rgba(217,181,127,.45), 0 6px 0 rgba(120,80,40,.22); animation: bbu-pop .3s cubic-bezier(.2,1.5,.5,1), bbu-glow 1s .3s infinite alternate; }
  .bbu-uturn.on { display: flex; align-items: center; justify-content: center; }
  .bbu-uturn svg { width: 64px; height: 64px; }
  .bbu-uturn.pressed { transform: translateY(4px); }
  @keyframes bbu-glow { to { box-shadow: inset -4px -5px 0 rgba(217,181,127,.45), 0 6px 0 rgba(120,80,40,.22), 0 0 0 9px rgba(255,212,92,.6); } }
  /* first-drive tips: bouncing arrows pointing at the GO pedal and the steering buttons */
.lefty .bbu-uturn { right: auto; left: calc(var(--sl) + 6px + 46px); }
  /* first-drive tip: a hand that drags the knob up */
  .bbu-tip { position: absolute; width: 70px; height: 70px; pointer-events: none; z-index: 3; right: calc(var(--sr) + 6px + 60px); bottom: calc(var(--sb) + 40px);
    animation: bbu-hand 1.8s ease-in-out infinite; }
  .lefty .bbu-tip { right: auto; left: calc(var(--sl) + 6px + 60px); }
  @keyframes bbu-hand { 0%, 15% { transform: translateY(0); opacity: 0; } 25% { opacity: 1; } 60%, 75% { transform: translateY(-52px); opacity: 1; } 100% { transform: translateY(-52px); opacity: 0; } }
  @media (orientation: portrait) { .bbu-turn.standalone { display: flex; } }
  /* narrower screens: the clock moves under the coins, the fuel gauge gets shorter */
  @media (max-width: 900px) {
    .bbu-top .bbu-clock { position: absolute; left: 0; top: 66px; height: 56px; font-size: 24px; }
    .bbu-top .bbu-clock svg { width: 30px; height: 30px; }
  }
  @media (max-width: 720px) { .bbu-job .dots { gap: 4px; } .bbu-job .dots i { width: 13px; height: 13px; } .bbu-top { gap: 7px; } .bbu-right { gap: 6px; } }
  @media (max-height: 520px) {
    .bbu-pill, .bbu-round { height: 56px; } .bbu-pill { padding-right: 10px; } .bbu-cash b { font-size: 24px; }
    .bbu-fuel { height: 56px; padding: 0 6px; } .bbu-fuel canvas { width: 100px; height: 50px; }
    .bbu-joy { width: 132px; height: 132px; }
    .bbu-horn { width: 56px; height: 56px; font-size: 28px; }
    .bbu-assist { width: 56px; height: 56px; left: calc(var(--sl) + 6px); bottom: calc(var(--sb) + 56px + 24px); } .bbu-assist svg { width: 42px; height: 42px; }
    .lefty .bbu-assist { left: auto; right: calc(var(--sr) + 6px); }
    .bbu-uturn { width: 64px; height: 64px; border-radius: 20px; right: calc(var(--sr) + 6px + 34px); bottom: calc(var(--sb) + 132px + 12px); }
    .lefty .bbu-uturn { left: calc(var(--sl) + 6px + 34px); }
    .bbu-uturn svg { width: 48px; height: 48px; }
    .bbu-tip { width: 56px; height: 56px; right: calc(var(--sr) + 6px + 42px); bottom: calc(var(--sb) + 26px); } .lefty .bbu-tip { left: calc(var(--sl) + 6px + 42px); }
  }`);

  function darkHex(c, t = 0.22) {
    const n = parseInt(c.slice(1), 16), f = (v) => Math.round(v * (1 - t)).toString(16).padStart(2, '0');
    return '#' + f((n >> 16) & 255) + f((n >> 8) & 255) + f(n & 255);
  }
  U.darkHex = darkHex;
  const picCanvas = (name, size = 80) => { const c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').drawImage(BB.pic(name, size), 0, 0); return c; };
  const JOY_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true">'
    + '<path d="M50 6 L60 18 H40 Z" fill="#3fae49"/><path d="M50 94 L60 82 H40 Z" fill="#f5a23d"/>'
    + '<path d="M6 50 L18 40 V60 Z" fill="#19a79b"/><path d="M94 50 L82 40 V60 Z" fill="#19a79b"/></svg>';
  const ASSIST_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 4 V44 M38 4 V44" stroke="#9aa4b0" stroke-width="3.5" stroke-dasharray="6 5" stroke-linecap="round"/>'
    + '<rect x="16" y="10" width="16" height="30" rx="5" fill="#3fae49"/><rect x="18.5" y="13" width="11" height="6" rx="2" fill="#bfe6f5"/>'
    + '<path class="spk" d="M40 6 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 z" fill="#ffb81f"/></svg>';
  U.ASSIST_SVG = ASSIST_SVG;
  const HAND_SVG = '<svg viewBox="0 0 64 64"><path d="M26 8 a5 5 0 0 1 10 0 V30 l4-1 a5 5 0 0 1 6 4 l2 2 a5 5 0 0 1 6 5 V46 c0 8-6 14-14 14 h-6 c-6 0-10-3-13-8 L13 41 a5 5 0 0 1 8-6 l5 5 Z" fill="#ffe0bd" stroke="#c98b5e" stroke-width="2.5" stroke-linejoin="round"/></svg>';

  let uturnBtn, facing = false, driving = true, tips = [];
  let hud, cashEl, fuelEl, fuelCv, jobEl, jobPic, jobDots, joyEl, knobEl, hornEl, assistEl, titleEl, soundBtn, musicBtn, exitBtn;

  U.init = function () {
    U.root = document.getElementById('ui');
    hud = BB.el('div', 'bbu-hud off', U.root);
    const top = BB.el('div', 'bbu-top', hud);
    cashEl = BB.el('div', 'bbu-pill bbu-cash', top); cashEl.appendChild(picCanvas('coin', 64)); BB.el('b', '', cashEl, String(BB.depot.cash));
    BB.tap(cashEl, () => { const n = BB.depot.cash; BB.say(n === 1 ? 'You have 1 coin!' : `You have ${n} coins!`); });
    fuelEl = BB.el('div', 'bbu-pill bbu-fuel', top); fuelCv = BB.el('canvas', '', fuelEl);
    BB.tap(fuelEl, () => { const f = BB.bus.fuel; BB.say(f > 0.55 ? 'Lots of fuel!' : f > BB.cfg.fuelLow + 0.05 ? 'Half a tank of fuel.' : "Fuel is getting low, let's go to the garage!"); });
    jobEl = BB.el('div', 'bbu-pill bbu-job', top); jobPic = BB.el('canvas', '', jobEl); jobPic.width = jobPic.height = 80;
    jobDots = BB.el('div', 'dots', jobEl);
    BB.tap(jobEl, () => { const t = BB.bus.target; if (t) BB.say(`Drive to ${t.say}!`); });
    jobEl.style.visibility = 'hidden';
    if (BB.HUB) top.appendChild(U.makeClock());
    const right = BB.el('div', 'bbu-right', top);
    const depotBtn = BB.el('button', 'bbu-round', right); depotBtn.appendChild(picCanvas('depot', 80));
    BB.tap(depotBtn, () => {
      const ph = BB.jobs.phase;
      if (ph === 'drive' || ph === 'done' || ph === 'stop' || ph === 'question') { BB.say("Let's go to the garage!"); BB.jobs.goDepot('quiet'); }
      else if (ph === 'toDepot') BB.say("We're going to the garage!");
    });
    musicBtn = BB.el('button', 'bbu-round bbu-snd', right, '🎵');
    soundBtn = BB.el('button', 'bbu-round bbu-snd', right, '🔊');
    BB.tap(musicBtn, () => BB.audio.setSound(BB.audio.mute, !BB.audio.music, true));
    BB.tap(soundBtn, () => BB.audio.setSound(!BB.audio.mute, BB.audio.music, true));
    BB.on('sound:changed', syncSound); syncSound();

    // driving: one-thumb joystick (up = go, down = reverse, sideways = steer; the knob springs back), the horn,
    // and the lane-helper toggle
    joyEl = BB.el('div', 'bbu-joy', hud, JOY_SVG); knobEl = BB.el('div', 'bbu-knob', joyEl);
    joyEl.setAttribute('aria-label', 'joystick');
    let joyId = null;
    const joyMove = (e) => {
      const r = joyEl.getBoundingClientRect(), R = r.width * 0.34;
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
      knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
      const dz = (v) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
      joy.x = dz(dx / R); joy.y = dz(-dy / R);
      if (joy.y > 0.2) U.hideTips();
      applyInput();
    };
    const joyUp = (e) => { if (e.pointerId !== joyId) return; joyId = null; joyEl.classList.remove('drag'); joy.x = joy.y = 0; knobEl.style.transform = ''; applyInput(); };
    joyEl.addEventListener('pointerdown', (e) => {
      e.preventDefault(); if (joyId != null) return;
      joyId = e.pointerId; try { joyEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      joyEl.classList.add('drag'); joyEl.classList.remove('nudge'); joyMove(e);
    });
    joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) joyEl.addEventListener(ev, joyUp);
    joyEl.addEventListener('contextmenu', (e) => e.preventDefault());
    hornEl = BB.el('button', 'bbu-round bbu-horn', hud, '📯');
    BB.tap(hornEl, () => BB.bus.horn());
    assistEl = BB.el('button', 'bbu-round bbu-assist', hud, ASSIST_SVG);
    assistEl.setAttribute('aria-label', 'lane helper');
    BB.tap(assistEl, () => U.setAssist(!BB.save.assist));
    U.setLefty(!!BB.save.leftHand, true);
    // turn around: offered while the bus faces away from where it should go (bus.js emits bus:facingAway)
    uturnBtn = BB.el('button', 'bbu-uturn', hud, '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 56 V28 a14 14 0 0 1 28 0 V34" stroke="#19a79b" stroke-width="9" fill="none" stroke-linecap="round"/>'
      + '<path d="M33 32 L46 48 L59 32 Z" fill="#19a79b"/></svg>');
    uturnBtn.setAttribute('aria-label', 'turn around');
    BB.tap(uturnBtn, () => {
      if (!BB.bus.turnAround) return;
      if (BB.bus.turnAround() === false) { BB.sfx.wrong(); return; }   // not allowed right now: stays offered
      BB.sfx.whoosh(); facing = false; syncUturn();
    });
    BB.on('bus:turnAround', () => { facing = false; syncUturn(); });
    BB.on('bus:facingAway', (d) => { facing = !!(d && d.on); syncUturn(); });

    // title
    titleEl = BB.el('div', 'bbu-title', U.root, '<div class="bbu-logo">Bendy <span>Bus</span></div><div class="bbu-tap">Tap to drive!</div>');
    titleEl.style.display = 'none';
    BB.tap(titleEl, () => { if (BB.bedtime || !U.titleShown()) return; U.hideTitle(); BB.emit('title:start'); });
    // standalone portrait hint (the hub shows its own card in hub mode)
    BB.el('div', 'bbu-turn' + (BB.HUB ? '' : ' standalone'), U.root, '<svg class="phone" viewBox="0 0 120 120" aria-hidden="true">'
      + '<path class="arc" d="M100 48 A44 44 0 0 0 60 16" stroke="#19a79b" stroke-width="8" fill="none" stroke-linecap="round"/><path class="arc" d="M50 6 L64 16 L50 27Z" fill="#19a79b"/>'
      + '<g class="dev"><rect x="34" y="24" width="52" height="76" rx="12" fill="#c84a3c"/><rect x="31" y="21" width="52" height="76" rx="12" fill="#f26b5b"/>'
      + '<rect x="37" y="29" width="40" height="58" rx="6" fill="#fff6e0"/>'
      + '<rect x="45" y="48" width="24" height="15" rx="4" fill="#3fae49"/><rect x="48" y="51" width="7" height="5" rx="1.5" fill="#bfe6f5"/><rect x="58" y="51" width="7" height="5" rx="1.5" fill="#bfe6f5"/>'
      + '<circle cx="50" cy="64" r="2.6" fill="#3a2a3c"/><circle cx="64" cy="64" r="2.6" fill="#3a2a3c"/><circle cx="57" cy="92" r="2.4" fill="#fff6e0"/></g></svg>'
      + '<div>Turn me sideways!</div>');
    // the shared "all games" button (hub mode): on the title and garage screens only
    if (BB.HUB) {
      const CARD = [['#f26b5b', 17.3, 17.3], ['#f5b83d', 35.85, 17.3], ['#5cb85c', 17.3, 35.85], ['#4fa3e0', 35.85, 35.85]];
      exitBtn = BB.el('button', 'bbu-exit', U.root, '<svg viewBox="0 0 64 64" aria-hidden="true">' + CARD.map(([c, x, y]) =>
        `<rect x="${x}" y="${y}" width="10.85" height="10.85" rx="2.4" fill="${c}" stroke="${darkHex(c)}" stroke-width="1.3"/>`).join('') + '</svg>');
      exitBtn.setAttribute('aria-label', 'Back to all games');
      exitBtn.style.display = 'none';
      BB.tap(exitBtn, () => { BB.sfx.pop(); BB.hush(); BB.hub.post({ hub: 'exit' }); });
    }

    // keyboard (for testing; touch is first): arrows / WASD, Space = GO, H = horn
    const KEYS = { ArrowUp: 'go', KeyW: 'go', Space: 'go', ArrowDown: 'back', KeyS: 'back', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
    const press = (k, on) => { keys[k] = on; if (on && k === 'go') U.hideTips(); applyInput(); };
    addEventListener('keydown', (e) => {
      const k = KEYS[e.code];
      if (k) { e.preventDefault(); if (!e.repeat) press(k, true); return; }
      if (e.repeat) return;
      if (e.code === 'KeyH') BB.bus.horn();
      else if (e.code === 'Enter' && BB.depot.isOpen && !BB.bedtime) BB.depot.close();
    });
    addEventListener('keyup', (e) => { const k = KEYS[e.code]; if (k) press(k, false); });
    addEventListener('blur', () => U.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) U.releaseAll(); });
    BB.on('held', (d) => { if (d.on) U.releaseAll(); });
    BB.on('bus:bump', () => { const c = document.getElementById('c'); if (!c) return; c.classList.remove('bbu-wobble'); void c.offsetWidth; c.classList.add('bbu-wobble'); BB.sfx.pop(); });

    // events
    BB.on('cash:changed', (d) => {
      cashEl.querySelector('b').textContent = String(d.cash);
      if (d.delta > 0) { cashEl.classList.remove('bump'); void cashEl.offsetWidth; cashEl.classList.add('bump'); U.coins(d.delta); }
    });
    BB.on('job:new', () => renderJob());
    BB.on('job:target', () => renderJob());
    BB.on('job:stopDone', () => renderJob());
    BB.on('job:done', () => { renderJob(); U.confetti(); });
    // driving controls only while driving: hidden from arrival at a stop (people boarding, the question) until the
    // stop is finished
    let qShown = false;
    const syncDriving = () => setDriving(!qShown && !(BB.jobs.busy && BB.jobs.busy()));
    BB.on('question:show', () => { qShown = true; syncDriving(); });
    BB.on('question:hide', () => { qShown = false; syncDriving(); });
    BB.on('jobs:busy', syncDriving);
    BB.on('bus:arrived', (d) => { if (!d || !d.stop || d.stop.id !== 'depot') setDriving(false); BB.later(50, syncDriving); });
    BB.on('depot:open', () => { U.releaseAll(); hud.classList.add('off'); U.showExit(true); });
    BB.on('depot:closed', () => { U.showExit(false); if (!BB.bedtime) hud.classList.remove('off'); });
  };
  function syncSound() {
    soundBtn.textContent = BB.audio.mute ? '🔇' : '🔊';
    musicBtn.classList.toggle('offx', !BB.audio.music || BB.audio.mute);
  }
  function syncUturn() { const on = facing && driving && !!BB.bus.turnAround; if (uturnBtn) uturnBtn.classList.toggle('on', on); }
  // first-drive tip: a hand dragging the knob up (until the bus is driven forward, or 12 s)
  U.showTips = function () {
    U.hideTips();
    tips = [BB.el('div', 'bbu-tip', hud, HAND_SVG)];
    joyEl.classList.add('nudge');
    BB.later(12000, U.hideTips);
  };
  U.hideTips = function () { for (const t of tips) t.remove(); tips = []; if (joyEl) joyEl.classList.remove('nudge'); };
  function setDriving(on) {
    driving = on; syncUturn();
    if (!on) U.hideTips();
    for (const el of [joyEl, hornEl, assistEl]) el.style.display = on ? '' : 'none';
    if (!on) U.releaseAll();
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
  // Driving input from the joystick and the keyboard (keys win while held). BB.bus.input gets
  // {analog: true, throttle: -1..1, steer: -1..1} plus the old booleans (thresholds) for a bus without analog support;
  // no input object at all: GO falls back to BB.bus.go().
  const joy = { x: 0, y: 0 }, keys = {};
  function current() {
    const throttle = keys.go ? 1 : keys.back ? -1 : joy.y;
    const steer = keys.left && !keys.right ? -1 : keys.right && !keys.left ? 1 : joy.x;
    return { throttle, steer };
  }
  function applyInput() {
    const B = BB.bus, inp = B.input, c = current();
    if (inp && typeof inp === 'object') {
      inp.analog = true; inp.throttle = c.throttle; inp.steer = c.steer;
      inp.fwd = c.throttle > 0.25; inp.back = c.throttle < -0.25; inp.left = c.steer < -0.3; inp.right = c.steer > 0.3;
    } else if (B.go) B.go(c.throttle > 0.25);
  }
  U.releaseAll = function () {
    for (const k in keys) keys[k] = false;
    joy.x = joy.y = 0;
    if (knobEl) { knobEl.style.transform = ''; joyEl.classList.remove('drag'); }
    try { applyInput(); } catch (e) { /* bus not built yet */ }
  };
  U.input = () => { const c = current(); return { throttle: c.throttle, steer: c.steer, go: c.throttle > 0.25, back: c.throttle < -0.25, left: c.steer < -0.3, right: c.steer > 0.3 }; };
  // Lane helper (BB.bus.assist, saved as save.assist): the HUD toggle and the garage's tile both use this.
  U.setAssist = function (on, quiet) {
    BB.save.assist = !!on; BB.saveNow();
    if (BB.bus) BB.bus.assist = !!on;
    if (assistEl) assistEl.classList.toggle('on', !!on);
    BB.emit('assist:changed', { on: !!on });
    if (!quiet) { BB.sfx.pop(); BB.say(on ? 'Lane helper on!' : 'Lane helper off!'); }
  };
  // Joystick on the left for left-handed drivers (save.leftHand).
  U.setLefty = function (on, quiet) {
    BB.save.leftHand = !!on; if (!quiet) BB.saveNow();
    if (hud) hud.classList.toggle('lefty', !!on);
    if (!quiet) { BB.sfx.pop(); BB.say(on ? 'Joystick on the left!' : 'Joystick on the right!'); }
  };
  U.afterBus = function () { U.setAssist(!!BB.save.assist, true); };

  U.showTitle = function () { titleEl.style.display = ''; hud.classList.add('off'); U.showExit(true); };
  U.hideTitle = function () { titleEl.style.display = 'none'; hud.classList.remove('off'); U.showExit(false); };
  U.titleShown = () => titleEl.style.display !== 'none';
  U.showExit = function (on) { if (exitBtn) exitBtn.style.display = on && !BB.hub.slept ? '' : 'none'; };
  // hide everything for the goodnight moment
  U.hideAll = function () { titleEl.style.display = 'none'; hud.classList.add('off'); U.showExit(false); U.releaseAll(); };

  // ---------- play clock chip (hub mode) ----------
  const clocks = [];
  const CLOCK_SVG = '<svg class="ic-clock" viewBox="0 0 24 24" aria-hidden="true">'
    + '<circle cx="12" cy="13" r="9.5" fill="#f26b5b"/><circle cx="12" cy="13" r="7" fill="#fffdf6"/>'
    + '<rect x="9.5" y="1.2" width="5" height="2.6" rx="1.2" fill="#f26b5b"/>'
    + '<path d="M12 13V8.6M12 13l3 1.8" stroke="#3a2a3c" stroke-width="2" stroke-linecap="round" fill="none"/>'
    + '<circle cx="12" cy="13" r="1.3" fill="#3a2a3c"/></svg>'
    + '<svg class="ic-moon" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M15.5 3.2a9.3 9.3 0 1 0 5.6 13.7A7.6 7.6 0 0 1 15.5 3.2z" fill="#fff3b8"/>'
    + '<circle cx="9.5" cy="15.5" r="1.1" fill="#f2c94c"/><circle cx="13.5" cy="18.2" r=".8" fill="#f2c94c"/></svg>';
  // A new clock chip element (the HUD has one, the garage another); all are kept up to date.
  U.makeClock = function () {
    const c = BB.el('div', 'bbu-clock hidden', null, CLOCK_SVG + '<span class="t"></span>');
    clocks.push(c); syncClock(true);
    return c;
  };
  let clockKey = '';
  function syncClock(force) {
    const H = BB.hub, on = BB.HUB && H.limit > 0 && H.left != null;
    const key = on ? H.left : 'off';
    if (key === clockKey && !force) return;
    clockKey = key;
    for (const c of clocks) {
      c.classList.toggle('hidden', !on);
      if (!on) continue;
      c.classList.toggle('late', H.left <= 60);
      c.lastChild.textContent = `${Math.floor(H.left / 60)}:${String(H.left % 60).padStart(2, '0')}`;
    }
  }
  if (BB.HUB) BB.on('hub:time', () => syncClock());

  // ---------- goodnight overlay ----------
  let nightEl = null;
  U.night = function (on) {
    if (!on) { if (nightEl) nightEl.remove(); nightEl = null; return; }
    if (nightEl) return;
    nightEl = BB.el('div', 'bbu-night', U.root, '<svg class="moon" viewBox="0 0 24 24"><path d="M15.5 3.2a9.3 9.3 0 1 0 5.6 13.7A7.6 7.6 0 0 1 15.5 3.2z" fill="#fff3b8"/>'
      + '<circle cx="9.5" cy="15.5" r="1.1" fill="#f2c94c"/><circle cx="13.5" cy="18.2" r=".8" fill="#f2c94c"/></svg><div class="zzz">z z z</div>');
    for (let i = 0; i < 18; i++) {
      const st = BB.el('i', 'star', nightEl);
      st.style.left = (4 + Math.random() * 92) + '%'; st.style.top = (3 + Math.random() * 40) + '%';
      st.style.animationDelay = (Math.random() * 2) + 's';
    }
    requestAnimationFrame(() => requestAnimationFrame(() => nightEl && nightEl.classList.add('on')));
  };
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

  // ---------- fuel gauge: a half-round dial with E and F, a red zone, a smooth needle, a blinking warning lamp ----------
  let needle = -1, gaugeKey = '', gaugeT = 0;
  function drawGauge(f, low, blink) {
    const cw = fuelCv.clientWidth || 120, ch = fuelCv.clientHeight || 60, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (fuelCv.width !== Math.round(cw * dpr)) { fuelCv.width = Math.round(cw * dpr); fuelCv.height = Math.round(ch * dpr); }
    const x = fuelCv.getContext('2d'); x.setTransform(fuelCv.width / 120, 0, 0, fuelCv.height / 60, 0, 0);
    x.clearRect(0, 0, 120, 60);
    const cx = 60, cy = 54, R = 44, a0 = Math.PI + 0.32, a1 = 2 * Math.PI - 0.32, at = (t) => a0 + (a1 - a0) * t;
    x.lineCap = 'round';
    x.lineWidth = 9; x.strokeStyle = '#eadfca'; x.beginPath(); x.arc(cx, cy, R, a0, a1); x.stroke();
    x.save();
    if (low) { x.shadowColor = 'rgba(255,90,60,' + (blink ? 0.9 : 0.35) + ')'; x.shadowBlur = blink ? 10 : 4; }
    x.strokeStyle = '#ff6b5c'; x.beginPath(); x.arc(cx, cy, R, a0, at(0.22)); x.stroke();
    x.restore();
    x.strokeStyle = '#5cb85c'; x.beginPath(); x.arc(cx, cy, R, at(0.7), a1); x.stroke();
    x.strokeStyle = '#b9a98a'; x.lineWidth = 2.5;
    for (let i = 0; i <= 4; i++) { const a = at(i / 4); x.beginPath(); x.moveTo(cx + Math.cos(a) * (R - 9), cy + Math.sin(a) * (R - 9)); x.lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14)); x.stroke(); }
    x.font = '800 15px "Baloo 2", "Fredoka", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    // (just inside the ends, so the needle never covers them)
    x.fillStyle = '#d0473a'; x.fillText('E', cx + Math.cos(at(0.13)) * (R - 21), cy + Math.sin(at(0.13)) * (R - 21));
    x.fillStyle = '#3f913f'; x.fillText('F', cx + Math.cos(at(0.87)) * (R - 21), cy + Math.sin(at(0.87)) * (R - 21));
    // the pump icon is the warning lamp: it blinks orange when the tank is low
    const lamp = low && blink;
    if (lamp) { x.fillStyle = 'rgba(255,154,46,.35)'; x.beginPath(); x.arc(cx, 37, 12, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = lamp ? '#ff9a2e' : '#c9b99a';
    x.beginPath(); x.roundRect ? x.roundRect(cx - 6, 29, 9, 14, 2) : x.rect(cx - 6, 29, 9, 14); x.fill();
    x.fillRect(cx - 7.5, 42, 12, 2.5);
    x.strokeStyle = x.fillStyle; x.lineWidth = 2; x.beginPath(); x.moveTo(cx + 3, 32); x.lineTo(cx + 7, 34); x.lineTo(cx + 7, 40); x.stroke();
    x.fillStyle = '#fff6e0'; x.fillRect(cx - 4.5, 31, 6, 4);
    // needle
    const a = at(BB.clamp(f, 0, 1));
    x.strokeStyle = '#3a2a3c'; x.lineWidth = 3.5;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); x.stroke();
    x.fillStyle = '#f26b5b'; x.beginPath(); x.arc(cx, cy, 5.5, 0, Math.PI * 2); x.fill();
  }
  U.update = function (dt) {
    const f = BB.bus.fuel;
    needle = needle < 0 ? f : needle + (f - needle) * Math.min(1, (dt || 0.016) * 3);
    const low = f <= BB.cfg.fuelLow;
    gaugeT += dt || 0.016;
    const blink = low && Math.floor(gaugeT * 2.5) % 2 === 0;
    const key = Math.round(needle * 400) + (low ? 'L' : '') + (blink ? 'B' : '') + fuelCv.clientWidth;
    if (key !== gaugeKey && !hud.classList.contains('off')) { gaugeKey = key; drawGauge(needle, low, blink); }
  };
})();
