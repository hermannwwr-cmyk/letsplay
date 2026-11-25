/* Little Bus Captain: HUD and screens (DOM over the canvas, inside #ui).
   Every button is a paper tile with a picture and a word under it, spoken on tap (BB.icon pictures, Fredoka letters).
   Top bar: left Home, Coins, Fuel (a little dial); middle Next stop (the stop's picture and progress dots) and, in hub
   mode, the shared clock chip; right Garage, Music, Sound. Bottom: the one-thumb joystick (or the steering wheel and
   the Go / Back pedals), Horn and Helper on the other side, Turn around above the joystick when the bus faces away.
   Home: in hub mode back to the app's launcher ({hub:'exit'}), standalone back to the start garage; with a trip in
   progress a kind "Go home?" card asks first. Also the title screen, toasts, coins, confetti, a fade for the tow, the
   goodnight overlay, the first-drive tips and the turn-sideways card (standalone portrait). Exposes BB.ui. */
(function () {
  'use strict';
  const BB = window.BB, P = BB.P;
  const U = BB.ui = { root: null };

  BB.css(`
  #ui { font-family: ${BB.FONT}; color: #3a2a3c;
    --bt: 72px; --bh: 80px; --ic: 42px; --lb: 15px;           /* HUD tiles: width, height (with the word), picture, word */
    --dt: 78px; --dh: 86px; --dic: 48px;                      /* driving tiles (horn, helper, turn around) */
    --joy: 176px; --wh: 200px; --pgw: 120px; --pgh: 150px; --pbw: 84px; --pbh: 104px; --hudh: 80px; }
  @media (max-height: 520px) {
    #ui { --bt: 60px; --bh: 64px; --ic: 34px; --lb: 13px; --dt: 68px; --dh: 72px; --dic: 40px;
      --joy: 136px; --wh: 144px; --pgw: 96px; --pgh: 118px; --pbw: 70px; --pbh: 86px; --hudh: 64px; }
  }
  #ui button { font-family: inherit; }
  .bbu-hud { position: absolute; inset: 0; pointer-events: none; transition: opacity .3s; }
  .bbu-hud.off { opacity: 0; } .bbu-hud.off * { pointer-events: none !important; }
  /* the paper tile: picture, then its word */
  .bbu-b { pointer-events: auto; position: relative; flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    min-width: var(--bt); height: var(--bh); padding: 3px 7px 5px; box-sizing: border-box; border-radius: 20px; margin: 0;
    background: #fff6e0; border: 3px solid #d9b57f; box-shadow: inset -4px -5px 0 rgba(217,181,127,.45), 0 4px 0 rgba(120,80,40,.18);
    cursor: pointer; touch-action: manipulation; font: 700 var(--lb)/1 ${BB.FONT}; color: #4a3424; -webkit-tap-highlight-color: transparent; }
  .bbu-b > canvas, .bbu-b > svg { width: var(--ic); height: var(--ic); display: block; flex: none; }
  .bbu-b .lb { display: block; white-space: nowrap; letter-spacing: .2px; }
  .bbu-b .row { display: flex; align-items: center; gap: 5px; height: var(--ic); }
  .bbu-b.pressed { transform: translateY(3px); box-shadow: inset -4px -5px 0 rgba(217,181,127,.45), 0 1px 0 rgba(120,80,40,.18); }
  .bbu-b.off { background: #efe3cb; color: #7d6a58; }
  .bbu-b.on { background: #d3f4e8; border-color: #19a79b; box-shadow: inset -4px -5px 0 rgba(25,167,155,.25), 0 4px 0 rgba(20,110,100,.25); }
  .bbu-b.drv { min-width: var(--dt); height: var(--dh); border-radius: 22px; }
  .bbu-b.drv > canvas { width: var(--dic); height: var(--dic); }
  .bbu-top { position: absolute; top: var(--st); left: var(--sl); right: var(--sr); display: flex; align-items: flex-start; gap: 14px; }
  .bbu-grp { display: flex; gap: 8px; align-items: flex-start; flex: none; }
  .bbu-mid { flex: 1; min-width: 0; display: flex; justify-content: center; align-items: flex-start; gap: 12px; }
  .bbu-b .row canvas { width: var(--ic); height: var(--ic); flex: none; }
  .bbu-cash .row b { font-size: calc(var(--ic) * .74); line-height: 1; min-width: .6em; text-align: left; color: #3a2a3c; }
  .bbu-cash.bump { animation: bbu-bump .5s; }
  @keyframes bbu-bump { 40% { transform: scale(1.14); } }
  .bbu-fuel canvas { width: calc(var(--ic) * 2.3); height: calc(var(--ic) * 1.15); display: block; }
  .bbu-fuel .row { height: var(--ic); align-items: flex-end; }
  .bbu-job { visibility: hidden; padding-left: 10px; padding-right: 12px; }
  .bbu-job .row canvas { width: var(--ic); height: var(--ic); }
  .bbu-job .dots { display: flex; gap: 5px; }
  .bbu-job .dots i { width: 15px; height: 15px; border-radius: 50%; background: #eadfca; border: 2px solid #d9b57f; box-sizing: border-box; }
  .bbu-job .dots i.done { background: #5cb85c; border-color: #3f913f; }
  .bbu-job .dots i.now { background: #ffd45c; border-color: #d98700; animation: bbu-now 1.2s ease-in-out infinite; }
  @keyframes bbu-now { 50% { transform: scale(1.25); } }
  @media (max-height: 520px) { .bbu-job .dots { gap: 3px; } .bbu-job .dots i { width: 12px; height: 12px; } .bbu-top { gap: 8px; } .bbu-grp { gap: 6px; } }
  /* the shared "all games" button (hub mode, title and garage screens), with its word on a little tag */
  .bbu-exit { position: absolute; z-index: 30; left: var(--sl); top: var(--st); width: 64px; height: 64px; padding: 0; border-radius: 50%;
    background: #fff6e0; border: 3px solid #d9b57f; box-sizing: border-box; pointer-events: auto; cursor: pointer; touch-action: manipulation;
    box-shadow: inset -4px -5px 0 rgba(217,181,127,.42), 0 4px 10px rgba(60,40,20,.25); animation: bbu-bob 2.4s ease-in-out infinite; }
  .bbu-exit svg { width: 100%; height: 100%; display: block; }
  .bbu-exit .tag { position: absolute; left: 50%; top: calc(100% + 1px); transform: translateX(-50%); background: #fff6e0; border: 2px solid #d9b57f;
    border-radius: 10px; padding: 1px 8px 2px; font: 700 13px/1.1 ${BB.FONT}; color: #4a3424; white-space: nowrap; box-shadow: 0 2px 0 rgba(120,80,40,.15); }
  .bbu-exit.pressed { transform: translateY(2px); box-shadow: inset -4px -5px 0 rgba(217,181,127,.42), 0 2px 4px rgba(60,40,20,.25); }
  @keyframes bbu-bob { 0%, 100% { translate: 0 -2px; } 50% { translate: 0 2px; } }
  /* the shared play clock chip (hub mode): cream pill, drawn clock, m:ss; orange with a moon in the last minute */
  .bbu-clock { pointer-events: auto; display: flex; align-items: center; gap: 6px; height: 56px; box-sizing: border-box; padding: 0 16px 0 10px;
    background: #fff6e0; border-radius: 999px; font: 700 28px/1 ${BB.FONT}; color: #3a2a3c; white-space: nowrap; flex: none; cursor: pointer;
    font-variant-numeric: tabular-nums; box-shadow: inset -3px -4px 0 rgba(217,181,127,.45), 0 4px 0 rgba(120,80,40,.15);
    transition: background .4s, color .4s; touch-action: manipulation; }
  .bbu-clock svg { width: 34px; height: 34px; display: block; }
  .bbu-clock .ic-moon, .bbu-clock.late .ic-clock { display: none; } .bbu-clock.late .ic-moon { display: block; }
  .bbu-clock.late { background: #ff9a2e; color: #fff; text-shadow: 0 2px 0 rgba(0,0,0,.2); box-shadow: inset -3px -4px 0 rgba(180,90,10,.35), 0 4px 0 rgba(0,0,0,.15); }
  .bbu-clock.hidden { display: none; }
  .bbu-top .bbu-clock { margin-top: calc((var(--bh) - 56px) / 2); }
  html.hub-sound-wait .bbu-snd { visibility: hidden; }
  /* goodnight */
  .bbu-night { position: absolute; inset: 0; pointer-events: auto; opacity: 0; transition: opacity 2.5s;
    background: radial-gradient(ellipse at 50% 30%, rgba(40,48,120,.25), rgba(14,18,60,.62)); }
  .bbu-night.on { opacity: 1; }
  .bbu-night .moon { position: absolute; right: calc(var(--sr) + 40px); top: calc(var(--st) + 20px); width: 90px; height: 90px; }
  .bbu-night .star { position: absolute; width: 8px; height: 8px; border-radius: 50%; background: #fff3b8; animation: bbu-twinkle 2s ease-in-out infinite; }
  @keyframes bbu-twinkle { 50% { opacity: .3; transform: scale(.6); } }
  .bbu-night .zzz { position: absolute; left: 50%; top: 38%; font-size: 54px; font-weight: 700; color: #fff3b8; opacity: 0;
    text-shadow: 0 3px 0 rgba(0,0,0,.25); animation: bbu-zzz 3s ease-out infinite 1.5s; }
  @keyframes bbu-zzz { 0% { opacity: 0; transform: translate(0, 10px) scale(.6); } 30% { opacity: 1; } 100% { opacity: 0; transform: translate(40px, -60px) scale(1.2); } }
  /* driving controls: the joystick bottom-right (.lefty: bottom-left), Horn with Helper above it on the other side,
     Turn around above the joystick */
  .bbu-joy { position: absolute; bottom: var(--sb); right: calc(var(--sr) + 6px); width: var(--joy); height: var(--joy); border-radius: 50%;
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
  .bbu-horn { position: absolute; left: calc(var(--sl) + 6px); bottom: var(--sb); }
  .bbu-assist { position: absolute; left: calc(var(--sl) + 6px); bottom: calc(var(--sb) + var(--dh) + 14px); }
  .bbu-uturn { position: absolute; right: calc(var(--sr) + 6px + (var(--joy) - var(--dt) - 14px) / 2); bottom: calc(var(--sb) + var(--joy) + 14px);
    min-width: calc(var(--dt) + 14px); display: none; animation: bbu-pop .3s cubic-bezier(.2,1.5,.5,1), bbu-glow 1s .3s infinite alternate; }
  .bbu-uturn.on { display: flex; }
  @keyframes bbu-glow { to { box-shadow: inset -4px -5px 0 rgba(217,181,127,.45), 0 4px 0 rgba(120,80,40,.18), 0 0 0 9px rgba(255,212,92,.6); } }
  .lefty .bbu-joy { right: auto; left: calc(var(--sl) + 6px); }
  .lefty .bbu-horn, .lefty .bbu-assist { left: auto; right: calc(var(--sr) + 6px); }
  .lefty .bbu-uturn { right: auto; left: calc(var(--sl) + 6px + (var(--joy) - var(--dt) - 14px) / 2); }
  /* steering-wheel layout (.ctl-wheel): the wheel bottom-left, Go and Back pedals bottom-right, Horn and Helper beside
     the wheel; .lefty mirrors it */
  .bbu-wheel, .bbu-ped { display: none; }
  .ctl-wheel .bbu-joy { display: none !important; }
  .ctl-wheel .bbu-wheel, .ctl-wheel .bbu-ped { display: block; }
  .bbu-wheel { position: absolute; left: calc(var(--sl) + 6px); bottom: var(--sb); width: var(--wh); height: var(--wh); border-radius: 50%;
    pointer-events: auto; touch-action: none; }
  .bbu-wheel .rot { position: absolute; inset: 0; transition: transform .05s linear; }
  .bbu-wheel svg { width: 100%; height: 100%; display: block; pointer-events: none; filter: drop-shadow(0 6px 0 rgba(80,60,40,.25)); }
  .bbu-ped { position: absolute; bottom: var(--sb); border: none; padding: 0; pointer-events: auto; touch-action: none; cursor: pointer; }
  .bbu-ped svg { width: 100%; height: 100%; display: block; pointer-events: none; }
  .bbu-ped .lb { position: absolute; left: 0; right: 0; bottom: 9%; text-align: center; font: 700 calc(var(--lb) + 5px)/1 ${BB.FONT}; color: #fff;
    text-shadow: 0 2px 0 rgba(0,0,0,.22); pointer-events: none; }
  .bbu-ped.back .lb { font-size: calc(var(--lb) + 2px); }
  .bbu-ped.go { right: calc(var(--sr) + 6px); width: var(--pgw); height: var(--pgh); border-radius: 30px 30px 26px 26px;
    background: linear-gradient(#7ad86f, #3fae49 55%, #2f8f3a); box-shadow: inset -5px -6px 0 rgba(0,0,0,.1), 0 8px 0 #24702d, 0 10px 18px rgba(0,0,0,.15); }
  .bbu-ped.back { right: calc(var(--sr) + 6px + var(--pgw) + 14px); width: var(--pbw); height: var(--pbh); border-radius: 24px;
    background: linear-gradient(#ffd27a, #f5a23d 55%, #d98226); box-shadow: inset -4px -5px 0 rgba(0,0,0,.1), 0 6px 0 #a8601a, 0 8px 14px rgba(0,0,0,.12); }
  .bbu-ped.down { transform: translateY(6px); } .bbu-ped.go.down { box-shadow: 0 2px 0 #24702d; } .bbu-ped.back.down { box-shadow: 0 1px 0 #a8601a; }
  .bbu-ped.go.nudge { animation: bbu-pednudge 1.4s ease-in-out infinite; }
  @keyframes bbu-pednudge { 50% { box-shadow: 0 8px 0 #24702d, 0 0 0 14px rgba(255,212,92,.55); } }
  .ctl-wheel .bbu-horn { left: calc(var(--sl) + 6px + var(--wh) + 16px); }
  .ctl-wheel .bbu-assist { left: calc(var(--sl) + 6px + var(--wh) + 16px + var(--dt) + 12px); bottom: var(--sb); }
  .ctl-wheel .bbu-uturn { right: calc(var(--sr) + 6px + (var(--pgw) - var(--dt) - 14px) / 2); bottom: calc(var(--sb) + var(--pgh) + 16px); }
  .ctl-wheel.lefty .bbu-wheel { left: auto; right: calc(var(--sr) + 6px); }
  .ctl-wheel.lefty .bbu-ped.go { right: auto; left: calc(var(--sl) + 6px); }
  .ctl-wheel.lefty .bbu-ped.back { right: auto; left: calc(var(--sl) + 6px + var(--pgw) + 14px); }
  .ctl-wheel.lefty .bbu-horn { left: auto; right: calc(var(--sr) + 6px + var(--wh) + 16px); }
  .ctl-wheel.lefty .bbu-assist { left: auto; right: calc(var(--sr) + 6px + var(--wh) + 16px + var(--dt) + 12px); }
  .ctl-wheel.lefty .bbu-uturn { right: auto; left: calc(var(--sl) + 6px + (var(--pgw) - var(--dt) - 14px) / 2); }
  /* first-drive tips: a hand that drags the knob up (wheel layout: a hand turning the wheel, a hand pressing Go) */
  .bbu-tip { position: absolute; width: 70px; height: 70px; pointer-events: none; z-index: 3; right: calc(var(--sr) + 6px + var(--joy) / 2 - 28px); bottom: calc(var(--sb) + var(--joy) / 4);
    animation: bbu-hand 1.8s ease-in-out infinite; }
  .lefty .bbu-tip { right: auto; left: calc(var(--sl) + 6px + var(--joy) / 2 - 28px); }
  @keyframes bbu-hand { 0%, 15% { transform: translateY(0); opacity: 0; } 25% { opacity: 1; } 60%, 75% { transform: translateY(-52px); opacity: 1; } 100% { transform: translateY(-52px); opacity: 0; } }
  .bbu-tip.wheelhand { right: auto; left: calc(var(--sl) + 6px + var(--wh) * .6); bottom: calc(var(--sb) + var(--wh) * .65); animation: bbu-turnhand 2s ease-in-out infinite; }
  .bbu-tip.pedalhand { right: calc(var(--sr) + 6px + var(--pgw) / 4); bottom: calc(var(--sb) + var(--pgh) / 4); animation: bbu-presshand 1.2s ease-in-out infinite; }
  .lefty .bbu-tip.wheelhand { left: auto; right: calc(var(--sr) + 6px + var(--wh) * .6); } .lefty .bbu-tip.pedalhand { right: auto; left: calc(var(--sl) + 6px + var(--pgw) / 4); }
  @keyframes bbu-turnhand { 0%, 100% { transform: translate(0, 0) rotate(0deg); } 50% { transform: translate(-46px, 30px) rotate(-30deg); } }
  @keyframes bbu-presshand { 50% { transform: translateY(12px) scale(.94); } }
  @media (max-height: 520px) { .bbu-tip { width: 56px; height: 56px; } }
  .bbu-wobble { animation: bbu-wobble .35s ease-out; }
  @keyframes bbu-wobble { 25% { transform: translate(-5px, 2px); } 50% { transform: translate(4px, -2px); } 75% { transform: translate(-2px, 1px); } }
  @keyframes bbu-pop { from { transform: scale(.3); opacity: 0; } }
  .bbu-title { position: absolute; inset: 0; pointer-events: auto; display: flex; flex-direction: column; align-items: center; justify-content: space-between;
    padding: calc(var(--st) + 14px) var(--sr) calc(var(--sb) + 10px) var(--sl); box-sizing: border-box; cursor: pointer;
    background: linear-gradient(rgba(255,246,224,.0), rgba(255,246,224,0) 60%, rgba(255,230,180,.35)); }
  .bbu-logo { font-size: clamp(44px, 9vw, 92px); font-weight: 700; color: #fff; letter-spacing: 1px; line-height: 1;
    text-shadow: 0 5px 0 #2f8f3a, 0 8px 14px rgba(0,0,0,.2); -webkit-text-stroke: 3px #3fae49; paint-order: stroke fill; }
  .bbu-logo span { color: #ffd45c; -webkit-text-stroke-color: #d98700; text-shadow: 0 5px 0 #b06e00, 0 8px 14px rgba(0,0,0,.2); }
  .bbu-tap { font-size: clamp(28px, 5vw, 44px); font-weight: 700; background: #ffb81f; color: #fff; border-radius: 40px; padding: 10px 34px;
    box-shadow: 0 7px 0 #d98700; text-shadow: 0 2px 0 #d98700; animation: bbu-pulse 1.3s ease-in-out infinite; }
  @keyframes bbu-pulse { 50% { transform: scale(1.07); } }
  .bbu-toast { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); font-size: 40px; font-weight: 700; color: #fff;
    text-shadow: 0 3px 0 #d98700, 0 0 12px rgba(0,0,0,.2); pointer-events: none; animation: bbu-float 1.4s ease-out forwards; white-space: nowrap;
    display: flex; align-items: center; gap: 8px; z-index: 20; }
  .bbu-toast canvas { width: 48px; height: 48px; }
  @keyframes bbu-float { from { transform: translate(-50%, 20px) scale(.6); opacity: 0; } 20% { transform: translate(-50%, 0) scale(1.1); opacity: 1; } 80% { opacity: 1; } to { transform: translate(-50%, -40px); opacity: 0; } }
  .bbu-fade { position: absolute; inset: 0; background: #fff6e0; opacity: 0; transition: opacity .6s; pointer-events: auto; z-index: 70; }
  .bbu-confetti { position: absolute; top: -20px; width: 12px; height: 18px; border-radius: 3px; pointer-events: none; animation: bbu-fall linear forwards; }
  @keyframes bbu-fall { to { transform: translateY(110vh) rotate(720deg); } }
  /* a kind question card ("Go home?"): a picture, a few words, big Yes and No */
  .bbu-ask { position: absolute; inset: 0; z-index: 57; background: rgba(40,30,50,.38); display: flex; align-items: center; justify-content: center;
    pointer-events: auto; animation: bbu-fadein .2s; padding: var(--st) var(--sr) var(--sb) var(--sl); box-sizing: border-box; }
  @keyframes bbu-fadein { from { opacity: 0; } }
  .bbu-ask .card { background: linear-gradient(#fff6e0, #fdebc8); border: 5px solid #d9b57f; border-radius: 34px; padding: 18px 26px 22px;
    display: flex; flex-direction: column; align-items: center; gap: 10px; box-shadow: inset -6px -8px 0 rgba(217,181,127,.35), 0 10px 0 rgba(120,80,40,.2);
    animation: bbu-pop .3s cubic-bezier(.2,1.5,.5,1); max-height: 100%; box-sizing: border-box; }
  .bbu-ask .pic { width: 104px; height: 104px; display: block; }
  .bbu-ask .q { font: 700 40px/1.1 ${BB.FONT}; color: #3a2a3c; text-align: center; }
  .bbu-ask .row { display: flex; gap: 22px; margin-top: 4px; }
  .bbu-ask .bbu-b { --bt: 120px; --bh: 124px; --ic: 78px; --lb: 22px; border-radius: 28px; background: #fff; border-color: #ecd3a8; }
  .bbu-ask .bbu-b.yes { border-color: #5cb85c; } .bbu-ask .bbu-b.no { border-color: #f26b5b; }
  @media (max-height: 520px) {
    .bbu-ask .card { flex-direction: row; flex-wrap: wrap; justify-content: center; max-width: 560px; padding: 12px 20px 16px; gap: 6px 18px; }
    .bbu-ask .pic { width: 74px; height: 74px; } .bbu-ask .q { font-size: 34px; } .bbu-ask .row { flex-basis: 100%; justify-content: center; }
    .bbu-ask .bbu-b { --bt: 104px; --bh: 104px; --ic: 64px; --lb: 19px; }
  }
  /* the turn-sideways card (standalone portrait; the hub shows its own card in hub mode) */
  .bbu-turn { position: absolute; inset: 0; z-index: 80; display: none; align-items: center; justify-content: center;
    background: radial-gradient(circle at 50% 40%, #fff6e0, #fdebc8 70%); pointer-events: auto; }
  .bbu-turn .card { display: flex; flex-direction: column; align-items: center; gap: 8px; background: #fff6e0; border: 5px solid #d9b57f; border-radius: 34px;
    padding: 22px 30px 26px; box-shadow: inset -6px -8px 0 rgba(217,181,127,.35), 0 10px 0 rgba(120,80,40,.18); font: 700 32px/1.1 ${BB.FONT}; text-align: center; }
  .bbu-turn .phone { width: 160px; height: 160px; }
  .bbu-turn .phone .dev { transform-origin: 60px 60px; animation: bbu-rot 2.4s ease-in-out infinite; }
  @keyframes bbu-rot { 0%, 20% { transform: rotate(0deg); } 55%, 100% { transform: rotate(-90deg); } }
  .bbu-turn .phone .arc { animation: bbu-arc 2.4s ease-in-out infinite; }
  @keyframes bbu-arc { 0%, 15% { opacity: 1; } 55%, 100% { opacity: .25; } }
  @media (orientation: portrait) { .bbu-turn.standalone { display: flex; } }
  /* narrower screens: the clock moves under Coins */
  @media (max-width: 900px) { .bbu-top .bbu-clock { position: absolute; left: 0; top: calc(var(--bh) + 8px); margin-top: 0; font-size: 25px; } .bbu-top .bbu-clock svg { width: 30px; height: 30px; } }
  `);

  function darkHex(c, t = 0.22) { return BB.dark ? BB.dark(c, t) : c; }
  U.darkHex = darkHex;
  const picCanvas = (name, size = 80) => BB.iconEl(name, size, true);
  const JOY_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true">'
    + '<path d="M50 6 L60 18 H40 Z" fill="#3fae49"/><path d="M50 94 L60 82 H40 Z" fill="#f5a23d"/>'
    + '<path d="M6 50 L18 40 V60 Z" fill="#19a79b"/><path d="M94 50 L82 40 V60 Z" fill="#19a79b"/></svg>';
  // paper-cut steering wheel: rim (a deeper tone on its lower right), three spokes, the hub with a little horn
  const WHEEL_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true">'
    + '<circle cx="50" cy="50" r="43" fill="none" stroke="#4a4250" stroke-width="13"/>'
    + '<path d="M80 22 A43 43 0 0 1 22 80" fill="none" stroke="#3a3440" stroke-width="13"/>'
    + '<circle cx="50" cy="50" r="43" fill="none" stroke="#6c6470" stroke-width="3" stroke-dasharray="4 7" opacity=".6"/>'
    + '<path d="M12 46 H38 M62 46 H88 M50 60 V90" stroke="#5a5260" stroke-width="11" stroke-linecap="round"/>'
    + '<circle cx="50" cy="50" r="17" fill="#f26b5b"/><path d="M62 38 A17 17 0 0 1 38 62 A17 17 0 0 0 62 38Z" fill="#d0473a"/>'
    + '<path d="M42 47 h6 l8 -5 v16 l-8 -5 h-6z" fill="#fff6e0"/>'
    + '<rect x="46" y="4" width="8" height="12" rx="3" fill="#ffb81f"/></svg>';
  const PEDAL_SVG = {
    go: '<svg viewBox="0 0 100 125" aria-hidden="true"><path d="M50 14 L80 50 H62 V80 H38 V50 H20 Z" fill="#fff"/></svg>',
    back: '<svg viewBox="0 0 100 125" aria-hidden="true"><path d="M50 84 L80 50 H62 V18 H38 V50 H20 Z" fill="#fff"/></svg>',
  };
  const HAND_SVG = '<svg viewBox="0 0 64 64"><path d="M26 8 a5 5 0 0 1 10 0 V30 l4-1 a5 5 0 0 1 6 4 l2 2 a5 5 0 0 1 6 5 V46 c0 8-6 14-14 14 h-6 c-6 0-10-3-13-8 L13 41 a5 5 0 0 1 8-6 l5 5 Z" fill="#ffe0bd" stroke="#c98b5e" stroke-width="2.5" stroke-linejoin="round"/></svg>';
  // the shared all-games picture: a 2x2 grid of rounded cards
  const CARD = [['#f26b5b', 17.3, 17.3], ['#f5b83d', 35.85, 17.3], ['#5cb85c', 17.3, 35.85], ['#4fa3e0', 35.85, 35.85]];
  const GAMES_SVG = (box = '0 0 64 64') => `<svg viewBox="${box}" aria-hidden="true">` + CARD.map(([c, x, y]) =>
    `<rect x="${x}" y="${y}" width="10.85" height="10.85" rx="2.4" fill="${c}" stroke="${darkHex(c)}" stroke-width="1.3"/>`).join('') + '</svg>';

  // A paper tile button: picture (a BB.icon name, or markup) and its word; fn on tap (pointerup).
  U.btn = function (parent, icon, label, fn, cls) {
    const b = BB.el('button', 'bbu-b' + (cls ? ' ' + cls : ''), parent);
    b.type = 'button';
    if (icon) b.appendChild(typeof icon === 'string' && icon[0] !== '<' ? BB.iconEl(icon, 128) : (typeof icon === 'string' ? BB.el('span', '', null, icon).firstChild : icon));
    BB.el('span', 'lb', b, label);
    b.setAttribute('aria-label', label);
    if (fn) BB.tap(b, fn);
    return b;
  };
  // swap a tile's picture (e.g. Music on/off)
  U.setIcon = function (b, icon) { const old = b.querySelector('canvas, svg'); const nu = BB.iconEl(icon, 128); if (old) b.replaceChild(nu, old); else b.prepend(nu); };

  let uturnBtn, facing = false, driving = true, tips = [];
  let hud, cashEl, fuelEl, fuelCv, jobEl, jobPic, jobDots, joyEl, knobEl, wheelEl, wheelRot, pedGo, pedBack, hornEl, assistEl, titleEl, soundBtn, musicBtn, exitBtn, homeBtn, garageBtn;

  U.init = function () {
    U.root = document.getElementById('ui');
    hud = BB.el('div', 'bbu-hud off', U.root);
    const top = BB.el('div', 'bbu-top', hud);
    const left = BB.el('div', 'bbu-grp', top);
    // Home: in hub mode the all-games picture (back to the app), standalone a house (back to the start garage)
    homeBtn = U.btn(left, BB.HUB ? GAMES_SVG('12 12 40 40') : 'home', 'Home', () => U.homeTap(), 'bbu-home');
    cashEl = U.btn(left, null, 'Coins', () => { const n = BB.depot.cash; BB.say(n === 1 ? 'You have 1 coin!' : `You have ${n} coins!`); }, 'bbu-cash');
    const crow = BB.el('span', 'row', null); cashEl.prepend(crow);
    crow.appendChild(BB.iconEl('coin', 96)); BB.el('b', '', crow, String(BB.depot.cash));
    fuelEl = U.btn(left, null, 'Fuel', () => {
      const f = BB.bus.fuel;
      BB.say(f > 0.55 ? 'Lots of fuel!' : f > BB.cfg.fuelLow + 0.05 ? 'Half a tank of fuel.' : "Fuel is getting low, let's go to the garage!");
    }, 'bbu-fuel');
    const frow = BB.el('span', 'row', null); fuelEl.prepend(frow); fuelCv = BB.el('canvas', '', frow);
    const mid = BB.el('div', 'bbu-mid', top);
    jobEl = U.btn(mid, null, 'Next stop', () => { const t = BB.bus.target; if (t) BB.say(`Drive to ${t.say}!`); }, 'bbu-job');
    const jrow = BB.el('span', 'row', null); jobEl.prepend(jrow);
    jobPic = BB.el('canvas', '', jrow); jobPic.width = jobPic.height = 96;
    jobDots = BB.el('span', 'dots', jrow);
    if (BB.HUB) mid.appendChild(U.makeClock());
    const right = BB.el('div', 'bbu-grp', top);
    garageBtn = U.btn(right, 'garage', 'Garage', () => {
      const ph = BB.jobs.phase;
      if (ph === 'drive' || ph === 'done' || ph === 'stop' || ph === 'question') { BB.say("Let's go to the garage!"); BB.jobs.goDepot('quiet'); }
      else if (ph === 'toDepot') BB.say("We're going to the garage!");
      else BB.say('Garage!');
    });
    musicBtn = U.btn(right, 'music', 'Music', () => {
      const on = !BB.audio.music;
      BB.audio.setSound(BB.audio.mute, on, true);
      BB.sfx.click(); BB.say(on ? 'Music on!' : 'Music off!');
    }, 'bbu-snd');
    soundBtn = U.btn(right, 'sound', 'Sound', () => {
      const mute = !BB.audio.mute;
      BB.audio.setSound(mute, BB.audio.music, true);
      if (!mute) { BB.sfx.click(); BB.say('Sound on!'); }
    }, 'bbu-snd');
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
    // the steering wheel: drag round it (the wheel turns with the finger's angle, up to about 135 degrees each way,
    // and eases back to the middle when let go), and the Go and Back pedals (hold)
    wheelEl = BB.el('div', 'bbu-wheel', hud); wheelRot = BB.el('div', 'rot', wheelEl, WHEEL_SVG);
    wheelEl.setAttribute('aria-label', 'steering wheel');
    let wheelId = null, lastA = 0;
    const angOf = (e) => { const r = wheelEl.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
    wheelEl.addEventListener('pointerdown', (e) => {
      e.preventDefault(); if (wheelId != null) return;
      wheelId = e.pointerId; try { wheelEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      lastA = angOf(e); wheel.drag = true;
    });
    wheelEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== wheelId) return;
      const a = angOf(e); let d = a - lastA; while (d > 180) d -= 360; while (d < -180) d += 360; lastA = a;
      wheel.rot = BB.clamp(wheel.rot + d, -135, 135); showWheel();
      if (Math.abs(wheel.rot) > 25) hideTip('wheelhand');
      applyInput();
    });
    const wheelUp = (e) => { if (e.pointerId !== wheelId) return; wheelId = null; wheel.drag = false; };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) wheelEl.addEventListener(ev, wheelUp);
    wheelEl.addEventListener('contextmenu', (e) => e.preventDefault());
    const pedal = (cls, key, word) => {
      const b = BB.el('button', 'bbu-ped ' + cls, hud, PEDAL_SVG[cls] + `<span class="lb">${word}</span>`); b.setAttribute('aria-label', word);
      const ptrs = new Set();
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } ptrs.add(e.pointerId); pedals[key] = true; b.classList.add('down'); if (key === 'go') { b.classList.remove('nudge'); hideTip('pedalhand'); } applyInput(); });
      const up = (e) => { ptrs.delete(e.pointerId); if (!ptrs.size) { pedals[key] = false; b.classList.remove('down'); applyInput(); } };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      b._ptrs = ptrs;
      return b;
    };
    pedBack = pedal('back', 'back', 'Back'); pedGo = pedal('go', 'go', 'Go');
    hornEl = U.btn(hud, 'horn', 'Horn', () => BB.bus.horn(), 'drv bbu-horn');
    assistEl = U.btn(hud, 'helper', 'Helper', () => U.setAssist(!BB.save.assist), 'drv bbu-assist');
    U.setLefty(!!BB.save.leftHand, true);
    U.setControl(BB.save.control, true);
    // turn around: offered while the bus faces away from where it should go (bus.js emits bus:facingAway)
    uturnBtn = U.btn(hud, 'uturn', 'Turn around', () => {
      if (!BB.bus.turnAround) return;
      if (BB.bus.turnAround() === false) { BB.sfx.wrong(); return; }   // not allowed right now: stays offered
      BB.sfx.whoosh(); BB.say('Turn around!'); facing = false; syncUturn();
    }, 'drv bbu-uturn');
    BB.on('bus:turnAround', () => { facing = false; syncUturn(); });
    BB.on('bus:facingAway', (d) => { facing = !!(d && d.on); syncUturn(); });

    // title
    titleEl = BB.el('div', 'bbu-title', U.root, '<div class="bbu-logo">Little Bus <span>Captain</span></div><div class="bbu-tap">Tap to drive!</div>');
    titleEl.style.display = 'none';
    BB.tap(titleEl, () => { if (BB.bedtime || !U.titleShown()) return; U.hideTitle(); BB.emit('title:start'); });
    // standalone portrait card (the hub shows its own card in hub mode)
    const turn = BB.el('div', 'bbu-turn' + (BB.HUB ? '' : ' standalone'), U.root, '<div class="card"><svg class="phone" viewBox="0 0 120 120" aria-hidden="true">'
      + '<path class="arc" d="M100 48 A44 44 0 0 0 60 16" stroke="#19a79b" stroke-width="8" fill="none" stroke-linecap="round"/><path class="arc" d="M50 6 L64 16 L50 27Z" fill="#19a79b"/>'
      + '<g class="dev"><rect x="34" y="24" width="52" height="76" rx="12" fill="#c84a3c"/><rect x="31" y="21" width="52" height="76" rx="12" fill="#f26b5b"/>'
      + '<rect x="37" y="29" width="40" height="58" rx="6" fill="#fff6e0"/>'
      + '<rect x="45" y="48" width="24" height="15" rx="4" fill="#3fae49"/><rect x="48" y="51" width="7" height="5" rx="1.5" fill="#d4eef8"/><rect x="58" y="51" width="7" height="5" rx="1.5" fill="#d4eef8"/>'
      + '<circle cx="50" cy="64" r="2.6" fill="#3a2a3c"/><circle cx="64" cy="64" r="2.6" fill="#3a2a3c"/><circle cx="57" cy="92" r="2.4" fill="#fff6e0"/></g></svg>'
      + '<div>Turn me sideways!</div></div>');
    BB.tap(turn, () => BB.say('Turn me sideways!'));
    if (!BB.HUB && window.matchMedia) {
      const mq = matchMedia('(orientation: portrait)');
      const said = () => { if (mq.matches && BB.audio.unlocked) BB.say('Turn me sideways!'); };
      if (mq.addEventListener) mq.addEventListener('change', said); else if (mq.addListener) mq.addListener(said);
    }
    // the shared "all games" button (hub mode): on the title and garage screens, with the word "Home" under it
    if (BB.HUB) {
      exitBtn = BB.el('button', 'bbu-exit', U.root, GAMES_SVG() + '<span class="tag">Home</span>');
      exitBtn.setAttribute('aria-label', 'Back to all games');
      exitBtn.style.display = 'none';
      BB.tap(exitBtn, () => { BB.sfx.pop(); BB.hush(); BB.hub.post({ hub: 'exit' }); });
    }

    // keyboard (for testing; touch is first): arrows / WASD, Space = GO, H = horn, Esc = No on the card
    const KEYS = { ArrowUp: 'go', KeyW: 'go', Space: 'go', ArrowDown: 'back', KeyS: 'back', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
    const press = (k, on) => { keys[k] = on; if (on && k === 'go') U.hideTips(); applyInput(); };
    addEventListener('keydown', (e) => {
      if (askEl && (e.code === 'Escape' || e.code === 'Enter')) { e.preventDefault(); if (!e.repeat) (e.code === 'Enter' ? askEl._yes : askEl._no)(); return; }
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
    BB.on('depot:open', () => { U.releaseAll(); U.closeAsk(); hud.classList.add('off'); U.showExit(true); });
    BB.on('depot:closed', () => { U.showExit(false); if (!BB.bedtime) hud.classList.remove('off'); });
  };
  function syncSound() {
    const A = BB.audio;
    musicBtn.classList.toggle('off', !A.music || A.mute); U.setIcon(musicBtn, A.music && !A.mute ? 'music' : 'musicOff');
    soundBtn.classList.toggle('off', A.mute); U.setIcon(soundBtn, A.mute ? 'soundOff' : 'sound');
  }
  function syncUturn() { const on = facing && driving && !!BB.bus.turnAround; if (uturnBtn) uturnBtn.classList.toggle('on', on); }
  // first-drive tip: a hand dragging the knob up (until the bus is driven forward, or 12 s)
  // (wheel layout: a hand turning the wheel and a hand pressing Go)
  U.showTips = function () {
    U.hideTips();
    if (isWheel()) { tips = [BB.el('div', 'bbu-tip wheelhand', hud, HAND_SVG), BB.el('div', 'bbu-tip pedalhand', hud, HAND_SVG)]; pedGo.classList.add('nudge'); }
    else { tips = [BB.el('div', 'bbu-tip', hud, HAND_SVG)]; joyEl.classList.add('nudge'); }
    BB.later(12000, U.hideTips);
  };
  U.hideTips = function () { for (const t of tips) t.remove(); tips = []; if (joyEl) joyEl.classList.remove('nudge'); if (pedGo) pedGo.classList.remove('nudge'); };
  function hideTip(cls) { tips = tips.filter((t) => { if (t.classList.contains(cls)) { t.remove(); return false; } return true; }); }
  U.driveTip = () => (isWheel() ? 'Hold the green pedal to go! Turn the wheel to steer!' : 'Push up to go! Slide to steer!');
  function setDriving(on) {
    driving = on; syncUturn();
    if (!on) U.hideTips();
    for (const el of [joyEl, wheelEl, pedGo, pedBack, hornEl, assistEl]) el.style.visibility = on ? '' : 'hidden';
    if (!on) U.releaseAll();
  }
  function renderJob() {
    const job = BB.jobs.current, t = BB.bus.target;
    if (!t && !job) { jobEl.style.visibility = 'hidden'; return; }
    jobEl.style.visibility = 'visible';
    const stop = t || (job && job.stops[Math.min(job.index, job.stops.length - 1)]);
    const x = jobPic.getContext('2d'); x.clearRect(0, 0, 96, 96); if (stop) x.drawImage(BB.pic(stop.pic, 96), 0, 0);
    jobDots.innerHTML = '';
    // going to the garage: just its picture; on a job, a dot per stop
    if (job && !(t && t.id === 'depot')) job.stops.forEach((s, i) => BB.el('i', i < job.index ? 'done' : i === job.index ? 'now' : '', jobDots));
    jobEl.querySelector('.lb').textContent = t && t.id === 'depot' ? 'Garage' : 'Next stop';
  }

  // ---------- Home ----------
  // A trip is in progress: a job, a stop or the drive to the garage. Then a kind card asks first.
  const tripOn = () => { const J = BB.jobs; return !!(J.current || (J.busy && J.busy()) || J.phase === 'toDepot'); };
  U.homeTap = function () {
    if (BB.bedtime || BB.depot.isOpen) return;
    U.releaseAll();
    if (!tripOn()) { goHome(); return; }
    U.ask({
      pic: BB.HUB ? GAMES_SVG() : 'home', words: 'Go home?', say: 'Go home?',
      yes: () => goHome(true), no: () => { BB.say('OK! Keep driving!'); },
    });
  };
  function goHome(asked) {
    if (BB.bedtime) return;
    if (BB.HUB) { BB.sfx.pop(); BB.hush(); BB.hub.post({ hub: 'exit' }); return; }
    // standalone: back to the start garage (the job waits there and carries on after Drive)
    const J = BB.jobs;
    if (J.phase === 'tow') { BB.say("Let's wait for the tow truck!"); return; }
    BB.sfx.whoosh();
    if (!asked) BB.say('Home!');
    U.fade(() => {
      if (BB.bedtime) return;
      try { if (J.hideQuestion) J.hideQuestion(); } catch (e) { console.error(e); }
      J.wantDepot = false;
      J.phase = 'depot';                     // jobs.js picks the job up again when the garage closes (depot:closed)
      try { BB.bus.stopAt(null); } catch (e) { console.error(e); }
      try { if (BB.bus.placeAtDepot) BB.bus.placeAtDepot(); } catch (e) { console.error(e); }
      BB.depot.open({ start: true });
    });
  }
  U.goHome = goHome;
  // A kind question card: {pic: icon name or svg, words, say, yes(), no()}. Big Yes and No, both spoken words.
  let askEl = null;
  U.ask = function (o) {
    U.closeAsk();
    const w = askEl = BB.el('div', 'bbu-ask', U.root);
    const card = BB.el('div', 'card', w);
    if (o.pic && o.pic[0] === '<') { const s = BB.el('div', '', null, o.pic).firstChild; s.classList.add('pic'); card.appendChild(s); }
    else if (o.pic) { const c = BB.iconEl(o.pic, 160); c.className = 'pic'; card.appendChild(c); }
    BB.el('div', 'q', card, o.words);
    const row = BB.el('div', 'row', card);
    let done = false;
    const close = (fn) => { if (done) return; done = true; U.closeAsk(); try { fn && fn(); } catch (e) { console.error(e); } };
    w._yes = () => { BB.sfx.pop(); close(o.yes); };
    w._no = () => { BB.sfx.click(); close(o.no); };
    U.btn(row, 'check', 'Yes', w._yes, 'yes');
    U.btn(row, 'cross', 'No', w._no, 'no');
    BB.tap(w, (e) => { if (e.target === w) w._no(); });
    BB.sfx.pop();
    if (o.say) BB.say(o.say);
    return w;
  };
  U.closeAsk = function () { if (askEl) { askEl.remove(); askEl = null; } };
  U.asking = () => !!askEl;

  // Driving input from the joystick and the keyboard (keys win while held). BB.bus.input gets
  // {analog: true, throttle: -1..1, steer: -1..1} plus the old booleans (thresholds) for a bus without analog support;
  // no input object at all: GO falls back to BB.bus.go().
  // Wheel layout: steer = wheel angle / 135 degrees, throttle = GO ? 1 : reverse ? -0.7 : 0.
  const joy = { x: 0, y: 0 }, keys = {}, pedals = {}, wheel = { rot: 0, drag: false };
  const isWheel = () => BB.save.control === 'wheel';
  function current() {
    const wh = isWheel();
    const throttle = keys.go ? 1 : keys.back ? -1 : wh ? (pedals.go ? 1 : pedals.back ? -0.7 : 0) : joy.y;
    const steer = keys.left && !keys.right ? -1 : keys.right && !keys.left ? 1 : wh ? wheel.rot / 135 : joy.x;
    return { throttle, steer };
  }
  function showWheel() { if (wheelRot) wheelRot.style.transform = `rotate(${wheel.rot.toFixed(1)}deg)`; }
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
    for (const k in pedals) pedals[k] = false;
    for (const b of [pedGo, pedBack]) if (b) { b.classList.remove('down'); b._ptrs.clear(); }
    wheel.drag = false;                   // (the wheel itself eases back to the middle in U.update)
    try { applyInput(); } catch (e) { /* bus not built yet */ }
  };
  U.input = () => { const c = current(); return { throttle: c.throttle, steer: c.steer, go: c.throttle > 0.25, back: c.throttle < -0.25, left: c.steer < -0.3, right: c.steer > 0.3 }; };
  // Lane helper (BB.bus.assist, saved as save.assist): the HUD toggle and the garage's tiles both use this.
  U.setAssist = function (on, quiet) {
    BB.save.assist = !!on; BB.saveNow();
    if (BB.bus) BB.bus.assist = !!on;
    if (assistEl) { assistEl.classList.toggle('on', !!on); U.setIcon(assistEl, on ? 'helperOn' : 'helper'); }
    BB.emit('assist:changed', { on: !!on });
    if (!quiet) { BB.sfx.pop(); BB.say(on ? 'Lane helper on!' : 'Lane helper off!'); }
  };
  // Joystick (or pedals) on the left for left-handed drivers (save.leftHand).
  U.setLefty = function (on, quiet) {
    BB.save.leftHand = !!on; if (!quiet) BB.saveNow();
    if (hud) hud.classList.toggle('lefty', !!on);
    if (!quiet) { BB.sfx.pop(); BB.say(isWheel() ? (on ? 'Pedals on the left!' : 'Pedals on the right!') : (on ? 'Joystick on the left!' : 'Joystick on the right!')); }
  };
  // Controls: 'joystick' (default) or 'wheel' (save.control).
  U.setControl = function (mode, quiet) {
    mode = mode === 'wheel' ? 'wheel' : 'joystick';
    BB.save.control = mode; if (!quiet) BB.saveNow();
    U.releaseAll(); wheel.rot = 0; showWheel();
    if (hud) hud.classList.toggle('ctl-wheel', mode === 'wheel');
    if (!quiet) { BB.sfx.pop(); BB.say(mode === 'wheel' ? 'Steering wheel!' : 'Joystick!'); }
  };
  U.afterBus = function () { U.setAssist(!!BB.save.assist, true); };

  U.showTitle = function () { titleEl.style.display = ''; hud.classList.add('off'); U.showExit(true); };
  U.hideTitle = function () { titleEl.style.display = 'none'; hud.classList.remove('off'); U.showExit(false); };
  U.titleShown = () => titleEl.style.display !== 'none';
  U.showExit = function (on) { if (exitBtn) exitBtn.style.display = on && !BB.hub.slept && !BB.bedtime ? '' : 'none'; };
  // hide everything for the goodnight moment
  U.hideAll = function () { titleEl.style.display = 'none'; hud.classList.add('off'); U.showExit(false); U.closeAsk(); U.releaseAll(); };

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
  // A new clock chip element (the HUD has one, the garage another); all are kept up to date. A tap says the time left
  // the same way the hub does (whole minutes rounded up; "less than a minute" in the last minute), at most every 3 s.
  let clockSaid = 0;
  U.makeClock = function () {
    const c = BB.el('div', 'bbu-clock hidden', null, CLOCK_SVG + '<span class="t"></span>');
    c.setAttribute('aria-label', 'Time left');
    BB.tap(c, () => {
      const H = BB.hub, now = performance.now();
      if (!(H.limit > 0 && H.left != null) || now - clockSaid < 3000) return;
      clockSaid = now;
      const m = Math.ceil(H.left / 60);
      BB.say(H.left <= 60 ? 'Less than a minute left!' : `${m} minutes left!`);
    });
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
    const cw = fuelCv.clientWidth || 96, ch = fuelCv.clientHeight || 48, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (fuelCv.width !== Math.round(cw * dpr)) { fuelCv.width = Math.round(cw * dpr); fuelCv.height = Math.round(ch * dpr); }
    const x = fuelCv.getContext('2d'); x.setTransform(fuelCv.width / 120, 0, 0, fuelCv.height / 60, 0, 0);
    x.clearRect(0, 0, 120, 60);
    const cx = 60, cy = 54, R = 46, a0 = Math.PI + 0.32, a1 = 2 * Math.PI - 0.32, at = (t) => a0 + (a1 - a0) * t;
    x.lineCap = 'round';
    x.lineWidth = 10; x.strokeStyle = '#eadfca'; x.beginPath(); x.arc(cx, cy, R, a0, a1); x.stroke();
    x.save();
    if (low) { x.shadowColor = 'rgba(255,90,60,' + (blink ? 0.9 : 0.35) + ')'; x.shadowBlur = blink ? 10 : 4; }
    x.strokeStyle = '#ff6b5c'; x.beginPath(); x.arc(cx, cy, R, a0, at(0.22)); x.stroke();
    x.restore();
    x.strokeStyle = '#5cb85c'; x.beginPath(); x.arc(cx, cy, R, at(0.7), a1); x.stroke();
    x.strokeStyle = '#b9a98a'; x.lineWidth = 2.5;
    for (let i = 0; i <= 4; i++) { const a = at(i / 4); x.beginPath(); x.moveTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)); x.lineTo(cx + Math.cos(a) * (R - 15), cy + Math.sin(a) * (R - 15)); x.stroke(); }
    x.font = `700 17px ${BB.FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    // (just inside the ends, so the needle never covers them)
    x.fillStyle = '#d0473a'; x.fillText('E', cx + Math.cos(at(0.12)) * (R - 23), cy + Math.sin(at(0.12)) * (R - 23));
    x.fillStyle = '#3f913f'; x.fillText('F', cx + Math.cos(at(0.88)) * (R - 23), cy + Math.sin(at(0.88)) * (R - 23));
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
    x.strokeStyle = '#3a2a3c'; x.lineWidth = 4;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); x.stroke();
    x.fillStyle = '#f26b5b'; x.beginPath(); x.arc(cx, cy, 6, 0, Math.PI * 2); x.fill();
  }
  U.update = function (dt) {
    if (!wheel.drag && wheel.rot !== 0) {            // the wheel eases back to the middle
      wheel.rot = Math.abs(wheel.rot) < 0.5 ? 0 : wheel.rot * Math.max(0, 1 - (dt || 0.016) * 7);
      showWheel(); applyInput();
    }
    const f = BB.bus.fuel;
    needle = needle < 0 ? f : needle + (f - needle) * Math.min(1, (dt || 0.016) * 3);
    const low = f <= BB.cfg.fuelLow;
    gaugeT += dt || 0.016;
    const blink = low && Math.floor(gaugeT * 2.5) % 2 === 0;
    const key = Math.round(needle * 400) + (low ? 'L' : '') + (blink ? 'B' : '') + fuelCv.clientWidth;
    if (key !== gaugeKey && !hud.classList.contains('off')) { gaugeKey = key; drawGauge(needle, low, blink); }
  };
})();
