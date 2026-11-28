/* Little Bus Captain: the home screen, the HUD and the other screens (DOM over the canvas, inside #ui).
   Home screen (the game starts here): "Little Bus Captain" lettering, the child's bus parked at its garage with the
   camera swinging gently round it, ONE big Play button (to the garage), the family strip (status picture and the
   buses here now), the Book tile, the wish card (the ride being saved up for, with its coin bar) and, in hub mode,
   the all-games button with its "Home" tag (to the app's launcher).
   HUD: every button is a paper tile with a picture and a word under it, spoken on tap (BB.icon pictures, Fredoka).
   Driving is kept clear so the road shows (the owner asked for fewer buttons): a small top bar with Home, one tile
   for coins and the fuel dial, Next stop (the stop's picture and progress dots) and, in hub mode, the shared clock
   chip, then Garage and Sound; at the bottom only the steering wheel (turn it by the rim, or push from its middle;
   tap its middle to honk) and the Go / Back pedals, plus Turn around or Wash when they're needed. When the bus has
   stood still for a while (and the road isn't asking it to wait) the thing to press next lights up: the Go pedal, or
   Turn around while that is offered; backing up beeps. Music and the lane helper are in the garage's Settings, and
   the fire engine's and ambulance's sirens switch themselves on and off with their jobs.
   Home goes back to the home screen (hub and standalone alike); with a trip in progress a kind "Go home?" card asks
   first, and the job waits (phase 'home') until Play and Drive. Also toasts, coins, confetti, a fade for the tow, the
   goodnight overlay, the first-drive tips and the turn-sideways card (standalone portrait). Exposes BB.ui. */
(function () {
  'use strict';
  const BB = window.BB, P = BB.P;
  const U = BB.ui = { root: null };

  BB.css(`
  #ui { font-family: ${BB.FONT}; color: #3a2a3c;
    --bt: 72px; --bh: 80px; --ic: 42px; --lb: 15px;           /* HUD tiles: width, height (with the word), picture, word */
    --dt: 78px; --dh: 86px; --dic: 48px;                      /* driving tiles (horn, helper, turn around) */
    --joy: 176px; --wh: 184px; --pgw: 112px; --pgh: 138px; --pbw: 80px; --pbh: 98px; --hudh: 64px; }
  @media (max-height: 520px) {
    #ui { --bt: 60px; --bh: 64px; --ic: 34px; --lb: 13px; --dt: 68px; --dh: 72px; --dic: 40px;
      --joy: 136px; --wh: 144px; --pgw: 96px; --pgh: 118px; --pbw: 70px; --pbh: 86px; --hudh: 54px; }
  }
  /* the driving top bar: small tiles, so the road shows */
  .bbu-top { --bt: 60px; --bh: 64px; --ic: 32px; --lb: 13px; }
  @media (max-height: 520px) { .bbu-top { --bt: 50px; --bh: 54px; --ic: 27px; --lb: 11px; } }
  .bbu-b.nolb .lb { display: none; }
  .bbu-top .bbu-b { border-radius: 16px; border-width: 2.5px; padding: 2px 6px 4px; }
  .bbu-cash .row { gap: 4px; }
  .bbu-cash .row .fuel { width: calc(var(--ic) * 1.7); height: calc(var(--ic) * .85); margin-left: 6px; align-self: flex-end; }
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
  .bbu-cash .row b { font-size: calc(var(--ic) * .8); line-height: 1; min-width: .6em; text-align: left; color: #3a2a3c; }
  .bbu-cash.bump, .bbu-job.bump { animation: bbu-bump .5s; }
  @keyframes bbu-bump { 40% { transform: scale(1.14); } }
  /* the fuel dial: always exactly 2 : 1 (a true half circle; this beats the tiles' square .row canvas rule) */
  .bbu-b.bbu-cash .row canvas.fuel { width: calc(var(--ic) * 1.7); height: calc(var(--ic) * .85); display: block; }
  .bbu-job { visibility: hidden; padding-left: 10px; padding-right: 12px; }
  /* the Garage tile when there are enough coins for the wish: a gold glow and the ride's picture on a little card */
  .bbu-b.wishready { border-color: #ffb81f; animation: bbu-glow 1s infinite alternate; }
  .bbu-b .wishpic { position: absolute; left: 50%; top: calc(100% + 5px); transform: translateX(-50%); width: 50px; height: 37px; padding: 1px 2px; box-sizing: border-box; display: none;
    background: #fff6e0; border: 2.5px solid #ffb81f; border-radius: 12px; box-shadow: 0 3px 0 rgba(120,80,40,.2); animation: bbu-bob 1.6s ease-in-out infinite; }
  .bbu-b.wishready .wishpic { display: block; }
  .bbu-b .wishpic canvas { width: 100%; height: 100%; display: block; }
  @media (max-height: 520px) { .bbu-b .wishpic { width: 42px; height: 31px; top: calc(100% + 4px); } }
  /* the friends' chips (net.js) hang below the top bar on the right: below the wish card while it shows */
  #ui.wishup:not(.home) .bbn-friends { top: calc(var(--st) + var(--hudh, 80px) + 54px); }
  @media (max-height: 520px) { #ui.wishup:not(.home) .bbn-friends { top: calc(var(--st) + var(--hudh, 80px) + 44px); } }
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
  /* driving tiles (base positions; the steering-wheel layout below, .ctl-wheel, is always on) */
  .bbu-uturn { position: absolute; right: calc(var(--sr) + 6px + (var(--joy) - var(--dt) - 14px) / 2); bottom: calc(var(--sb) + var(--joy) + 14px);
    min-width: calc(var(--dt) + 14px); display: none; animation: bbu-pop .3s cubic-bezier(.2,1.5,.5,1), bbu-glow 1s .3s infinite alternate; }
  .bbu-uturn.on { display: flex; }
  @keyframes bbu-glow { to { box-shadow: inset -4px -5px 0 rgba(217,181,127,.45), 0 4px 0 rgba(120,80,40,.18), 0 0 0 9px rgba(255,212,92,.6); } }
  /* the Wash tile (a dusty bus): beside the wheel, only when the bus is dusty */
  .bbu-wash { position: absolute; left: calc(var(--sl) + 6px + var(--wh) + 16px); bottom: var(--sb); display: none; animation: bbu-pop .3s cubic-bezier(.2,1.5,.5,1); }
  .bbu-wash.on { display: flex; }
  .ctl-wheel.lefty .bbu-wash { left: auto; right: calc(var(--sr) + 6px + var(--wh) + 16px); }
  /* "TURBO!" over the bus for a moment (the secret turbo) */
  .bbu-turbo { position: absolute; left: 50%; top: 46%; z-index: 21; pointer-events: none; font: 700 52px/1 ${BB.FONT}; color: #ffd45c; letter-spacing: 2px;
    -webkit-text-stroke: 3px #d98700; paint-order: stroke fill; text-shadow: 0 4px 0 #b06e00, 0 0 18px rgba(255,212,92,.8); animation: bbu-turbo 1.6s ease-out forwards; }
  @keyframes bbu-turbo { 0% { transform: translate(-50%, 20px) scale(.4) rotate(-8deg); opacity: 0; } 18% { transform: translate(-50%, 0) scale(1.15) rotate(-4deg); opacity: 1; }
    75% { opacity: 1; } 100% { transform: translate(-50%, -50px) scale(1) rotate(-4deg); opacity: 0; } }
  @media (max-height: 520px) { .bbu-turbo { font-size: 38px; top: 54%; } }
  /* a refused turbo: a tiny puff of grey-gold sparks over the bus */
  .bbu-fizz { position: absolute; left: 50%; top: 56%; width: 0; height: 0; z-index: 21; pointer-events: none; }
  .bbu-fizz i { position: absolute; left: -7px; top: -7px; width: 14px; height: 14px; border-radius: 50%; background: #ffb81f; opacity: 0;
    box-shadow: 0 0 6px rgba(255,184,31,.8); animation: bbu-fizz .75s ease-out forwards; }
  .bbu-fizz i:nth-child(2n) { background: #ff8a3d; width: 10px; height: 10px; }
  .bbu-fizz i:nth-child(3n) { background: #fff6e0; }
  .bbu-fizz b { position: absolute; left: -26px; top: -26px; width: 52px; height: 52px; border-radius: 50%; background: rgba(236,230,220,.85); animation: bbu-puff .8s ease-out forwards; }
  @keyframes bbu-puff { 0% { transform: scale(.3); opacity: .9; } 100% { transform: scale(1.4); opacity: 0; } }
  @keyframes bbu-fizz { 0% { opacity: 1; transform: rotate(var(--a)) translateX(6px) scale(1); } 100% { opacity: 0; transform: rotate(var(--a)) translateX(54px) scale(.3); } }
  .bbu-ask .price { display: flex; align-items: center; gap: 6px; font: 700 34px/1 ${BB.FONT}; color: #7a4a00; background: #ffd45c; border: 3px solid #d98700;
    border-radius: 24px; padding: 2px 16px 2px 6px; box-shadow: 0 3px 0 rgba(150,90,0,.3); }
  .bbu-ask .price canvas { width: 40px; height: 40px; }
  .bbu-wcoin { position: absolute; width: 40px; height: 40px; z-index: 60; pointer-events: none; }
  .lefty .bbu-uturn { right: auto; left: calc(var(--sl) + 6px + (var(--joy) - var(--dt) - 14px) / 2); }
  /* steering-wheel layout (.ctl-wheel): the wheel bottom-left, Go and Back pedals bottom-right; .lefty mirrors it */
  .bbu-wheel, .bbu-ped { display: none; }
  .ctl-wheel .bbu-wheel, .ctl-wheel .bbu-ped { display: block; }
  .bbu-wheel { position: absolute; left: calc(var(--sl) + 6px); bottom: var(--sb); width: var(--wh); height: var(--wh); border-radius: 50%;
    pointer-events: auto; touch-action: none; }
  .bbu-wheel { transition: transform .12s ease-out; } .bbu-wheel.grab { transform: scale(1.05); }   /* (held: it swells a little, "got it") */
  .bbu-wheel .rot { position: absolute; inset: 0; transition: transform .05s linear; }
  .bbu-wheel.honk svg { animation: bbu-honk .3s ease-out; }
  @keyframes bbu-honk { 40% { transform: scale(.94); } }
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
  /* "press me": the Go pedal lights up with a gold rim and its arrow bobs. The rim glows mostly inside the pedal (a
     white edge, then gold), with only a thin gold and amber line outside it, so it shows whole even where the pedal
     sits close to the screen's edge or the Back pedal, and on every ground (it is on the pedal, not the road). The
     shadow lists match the pedal's own, shadow for shadow, so the rim swells smoothly instead of blinking. */
  .bbu-ped.go.nudge, .bbu-ped.go.idle { animation: bbu-pednudge 1.4s ease-in-out infinite; }
  .bbu-ped.go.nudge svg, .bbu-ped.go.idle svg { animation: bbu-pedarrow 1.4s ease-in-out infinite; }
  @keyframes bbu-pedarrow { 50% { transform: translateY(-6%); } }
  @keyframes bbu-pednudge {
    0%, 100% { box-shadow: inset 0 0 0 0 #fff, inset 0 0 0 0 #ffc23a, inset -5px -6px 0 rgba(0,0,0,.1), 0 8px 0 #24702d, 0 0 0 0 #ffb81f, 0 0 0 0 rgba(176,104,0,.75), 0 10px 18px rgba(0,0,0,.15); }
    50% { box-shadow: inset 0 0 0 4px #fff, inset 0 0 0 11px #ffc23a, inset -5px -6px 0 rgba(0,0,0,.1), 0 8px 0 #24702d, 0 0 0 3.5px #ffb81f, 0 0 0 5px rgba(176,104,0,.75), 0 10px 18px rgba(0,0,0,.15); } }
  /* the Turn around tile gets the same gold rim when it is the thing to press (the bus faces away and stands still) */
  .bbu-uturn.idle { animation: bbu-pop .3s cubic-bezier(.2,1.5,.5,1), bbu-uturnnudge 1.4s ease-in-out infinite; }
  .bbu-uturn.idle canvas { animation: bbu-pedarrow 1.4s ease-in-out infinite; }
  @keyframes bbu-uturnnudge {
    0%, 100% { box-shadow: inset 0 0 0 0 #fff, inset 0 0 0 0 #ffc23a, inset -4px -5px 0 rgba(217,181,127,.45), 0 4px 0 rgba(120,80,40,.18), 0 0 0 0 #ffb81f, 0 0 0 0 rgba(176,104,0,.75); }
    50% { box-shadow: inset 0 0 0 3px #fff, inset 0 0 0 8px #ffc23a, inset -4px -5px 0 rgba(217,181,127,.45), 0 4px 0 rgba(120,80,40,.18), 0 0 0 3.5px #ffb81f, 0 0 0 5px rgba(176,104,0,.75); } }
  .ctl-wheel .bbu-uturn { right: calc(var(--sr) + 6px + (var(--pgw) - var(--dt) - 14px) / 2); bottom: calc(var(--sb) + var(--pgh) + 16px); }
  .ctl-wheel.lefty .bbu-wheel { left: auto; right: calc(var(--sr) + 6px); }
  .ctl-wheel.lefty .bbu-ped.go { right: auto; left: calc(var(--sl) + 6px); }
  .ctl-wheel.lefty .bbu-ped.back { right: auto; left: calc(var(--sl) + 6px + var(--pgw) + 14px); }
  .ctl-wheel.lefty .bbu-uturn { right: auto; left: calc(var(--sl) + 6px + (var(--pgw) - var(--dt) - 14px) / 2); }
  /* first-drive tips: a hand turning the wheel and a hand pressing Go */
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
  /* the home screen: the lettering, your bus parked at its garage (the 3D view behind), ONE big Play button,
     the family strip top right (and the all-games button top left in hub mode) */
  .bbu-title { position: absolute; inset: 0; z-index: 25; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: space-between;
    padding: calc(var(--st) + 8px) var(--sr) calc(var(--sb) + 6px) var(--sl); box-sizing: border-box;
    background: linear-gradient(rgba(255,246,224,.55), rgba(255,246,224,0) 30%, rgba(255,246,224,0) 70%, rgba(255,230,180,.45)); }
  .bbu-title > * { pointer-events: auto; }
  /* the garage's striped awning hangs along the top here too (over the shed's plain roof) */
  .bbu-title::before { content: ''; position: absolute; left: 0; top: 0; right: 0; height: 30px; pointer-events: none;
    background: repeating-linear-gradient(90deg, #19a79b 0 44px, #fff6e0 44px 88px);
    -webkit-mask: radial-gradient(circle at 22px 15px, #000 15px, transparent 15.5px) 0 15px / 44px 100% repeat-x, linear-gradient(#000, #000) 0 0 / 100% 16px no-repeat;
            mask: radial-gradient(circle at 22px 15px, #000 15px, transparent 15.5px) 0 15px / 44px 100% repeat-x, linear-gradient(#000, #000) 0 0 / 100% 16px no-repeat;
    filter: drop-shadow(0 3px 0 rgba(0,0,0,.12)); }
  @media (max-height: 520px) { .bbu-title::before { height: 24px; } }
  .bbu-logo { font-size: clamp(42px, min(8.5vw, 13vh), 96px); font-weight: 700; color: #fff; letter-spacing: 1px; line-height: 1; text-align: center; cursor: pointer;
    text-shadow: 0 5px 0 #2f8f3a, 0 8px 14px rgba(0,0,0,.2); -webkit-text-stroke: 3px #3fae49; paint-order: stroke fill; margin-top: calc(var(--bh) - 2px); animation: bbu-bob 3.4s ease-in-out infinite; }
  .bbu-logo span { color: #ffd45c; -webkit-text-stroke-color: #d98700; text-shadow: 0 5px 0 #b06e00, 0 8px 14px rgba(0,0,0,.2); }
  .bbu-play { display: flex; align-items: center; gap: 16px; height: 108px; padding: 0 44px 0 18px; border: none; border-radius: 56px; cursor: pointer; touch-action: manipulation;
    background: linear-gradient(#7ad86f, #3fae49 55%, #2f8f3a); box-shadow: inset -6px -8px 0 rgba(0,0,0,.1), 0 8px 0 #24702d, 0 12px 22px rgba(0,0,0,.18);
    font: 700 52px/1 ${BB.FONT}; color: #fff; text-shadow: 0 3px 0 #24702d; animation: bbu-pulse 1.4s ease-in-out infinite; position: relative; overflow: hidden; }
  .bbu-play canvas { width: 76px; height: 76px; flex: none; }
  .bbu-play::after { content: ''; position: absolute; top: 0; bottom: 0; width: 70px; left: -90px; background: linear-gradient(100deg, transparent, rgba(255,255,255,.45), transparent);
    animation: bbd-shine 2.8s ease-in-out infinite; }
  .bbu-play.pressed { transform: translateY(5px); box-shadow: 0 3px 0 #24702d; animation: none; }
  .bbu-play.call { animation: bbu-pulse 1.4s ease-in-out infinite, bbu-wiggle .9s ease-in-out 2; }
  @keyframes bbu-pulse { 50% { transform: scale(1.06); } }
  @keyframes bbu-wiggle { 20% { rotate: -3deg; } 40% { rotate: 3deg; } 60% { rotate: -2deg; } 80% { rotate: 1deg; } }
  .bbu-fam { position: absolute; top: var(--st); right: var(--sr); pointer-events: none !important; }
  .bbu-title .bbu-bookbtn { position: absolute; left: var(--sl); bottom: var(--sb); }
  /* the home screen's wish (bottom right): the ride being saved up for, a bar that fills with the coins and how many
     more it takes (a green tick once there are enough). The square picture canvas has an empty band above and below
     its 4 : 3 picture: the negative margins tuck those away. */
  .bbu-title .bbu-wish { position: absolute; right: var(--sr); bottom: var(--sb); height: auto; padding: 5px 12px 9px; gap: 5px; --wp: 112px;
    animation: bbu-pop .4s cubic-bezier(.2,1.5,.5,1); }
  .bbu-wish > canvas.ride { width: var(--wp); height: var(--wp); margin: calc(var(--wp) * -.125) 0; }
  .bbu-wish .row { height: auto; gap: 6px; }
  .bbu-wish .bar { width: calc(var(--wp) * .62); height: 13px; border-radius: 7px; background: #eadfca; overflow: hidden; box-shadow: inset 0 2px 0 rgba(120,80,40,.12); }
  .bbu-wish .bar i { display: block; height: 100%; width: 0; min-width: 6px; border-radius: 7px; background: #ffb81f; transition: width 1s ease-out; }
  .bbu-wish .row canvas { width: 24px; height: 24px; margin-right: -3px; }
  .bbu-wish .row b { font: 700 22px/1 ${BB.FONT}; color: #9a5d00; }
  .bbu-wish .ok { width: 26px; height: 26px; border-radius: 50%; flex: none; background: #19a79b url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12.5l4 4 8-9' stroke='white' stroke-width='3.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/80% no-repeat; }
  .bbu-wish.ready { border-color: #19a79b; box-shadow: inset -4px -5px 0 rgba(25,167,155,.2), 0 4px 0 rgba(20,110,100,.25); }
  .bbu-wish.ready .bar i { background: #5cb85c; }
  @media (max-height: 520px) { .bbu-title .bbu-wish { --wp: 84px; padding: 4px 9px 7px; gap: 4px; } .bbu-wish .bar { height: 11px; }
    .bbu-wish .row canvas { width: 20px; height: 20px; } .bbu-wish .row b { font-size: 18px; } .bbu-wish .ok { width: 22px; height: 22px; } }
  /* (a narrow, upright window, e.g. the hub's "Play anyway" in iPad Split View: a smaller card, and in the narrowest
     ones the card and the Book tile sit above the Play button instead of beside it) */
  @media (max-width: 640px) { .bbu-title .bbu-wish { --wp: 84px; padding: 4px 9px 7px; } }
  @media (max-width: 480px) { .bbu-title .bbu-wish, .bbu-title .bbu-bookbtn { bottom: calc(var(--sb) + 126px); } }
  /* the spotter book: two paper pages, a sticker per find (grey "?" outlines for the rest) */
  .bbu-book { position: absolute; inset: 0; z-index: 59; background: rgba(40,30,50,.4); display: flex; align-items: center; justify-content: center;
    pointer-events: auto; animation: bbu-fadein .2s; padding: var(--st) var(--sr) var(--sb) var(--sl); box-sizing: border-box; --sk: 92px; --skl: 14px; }
  .bbu-book .bk { position: relative; display: flex; gap: 0; background: #b06e3c; padding: 10px; border-radius: 26px; box-shadow: 0 10px 0 rgba(80,40,20,.3);
    animation: bbu-pop .3s cubic-bezier(.2,1.5,.5,1); max-height: 100%; box-sizing: border-box; }
  .bbu-book .pg { background: linear-gradient(90deg, #fffaf0, #fdf0d6); padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .bbu-book .pg:first-of-type { border-radius: 18px 4px 4px 18px; box-shadow: inset -10px 0 12px -10px rgba(120,80,40,.35); }
  .bbu-book .pg:last-of-type { border-radius: 4px 18px 18px 4px; background: linear-gradient(90deg, #fdf0d6, #fffaf0); box-shadow: inset 10px 0 12px -10px rgba(120,80,40,.35); }
  .bbu-book h3 { margin: 0; font: 700 22px/1.1 ${BB.FONT}; color: #8a5a2c; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  .bbu-book h3 canvas { width: 30px; height: 30px; }
  .bbu-book .grid { display: grid; gap: 8px; }
  .bbu-book .stk { width: var(--sk); display: flex; flex-direction: column; align-items: center; gap: 2px; border: none; background: none; padding: 0; cursor: pointer;
    touch-action: manipulation; font: 700 var(--skl)/1.05 ${BB.FONT}; color: #5a3e2b; text-align: center; }
  .bbu-book .stk canvas, .bbu-book .stk .q { width: var(--sk); height: var(--sk); display: block; }
  .bbu-book .stk canvas { filter: drop-shadow(0 3px 0 rgba(120,80,40,.25)); }
  .bbu-book .stk .q { box-sizing: border-box; border: 3px dashed #d0bfa0; border-radius: 22px; display: flex; align-items: center; justify-content: center;
    font: 700 calc(var(--sk) * .5)/1 ${BB.FONT}; color: #d0bfa0; background: rgba(255,255,255,.4); }
  /* names wrap onto a second line where the stickers are small ("Grandpa / Lee"), so neighbours never run together */
  .bbu-book .stk .lb { min-height: 1.05em; white-space: normal; max-width: calc(var(--sk) + 4px); overflow-wrap: normal; }
  .bbu-book .stk.pressed { transform: translateY(3px); }
  .bbu-book .stk.fresh canvas { animation: bbu-pop .5s cubic-bezier(.2,1.6,.5,1); }
  .bbu-book .x { position: absolute; z-index: 3; top: -18px; right: -18px; width: 64px; height: 64px; border: none; background: none; padding: 0; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; touch-action: manipulation; }
  .bbu-book .x canvas { width: 60px; height: 60px; }
  .bbu-book .x .lb { font: 700 13px/1 ${BB.FONT}; color: #4a3424; background: #fff6e0; border: 2px solid #d9b57f; border-radius: 9px; padding: 1px 6px 2px; margin-top: -6px; }
  .bbu-book .count { font: 700 16px/1 ${BB.FONT}; color: #a07a50; margin-left: auto; }
  .bbu-book .pg:last-of-type h3 { padding-right: 46px; }        /* (the Close button sits over this page's top corner) */
  @media (max-height: 520px) { .bbu-book .pg:last-of-type h3 { padding-right: 40px; } }
  @media (max-height: 820px) { .bbu-book { --sk: 80px; } }
  @media (max-height: 700px) { .bbu-book { --sk: 70px; --skl: 13px; } }
  @media (max-height: 520px) { .bbu-book { --sk: 56px; --skl: 12px; } .bbu-book h3 { font-size: 17px; } .bbu-book h3 canvas { width: 22px; height: 22px; }
    .bbu-book .pg { padding: 8px 10px 10px; gap: 5px; } .bbu-book .grid { gap: 5px 6px; } .bbu-book .bk { padding: 7px; }
    .bbu-book .x { width: 56px; height: 56px; top: -14px; right: -14px; } .bbu-book .x canvas { width: 52px; height: 52px; } }
  /* "New sticker!" while driving */
  .bbu-newst { position: absolute; z-index: 21; left: 50%; top: calc(var(--st) + var(--bh) + 14px); transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
    background: #fff6e0; border: 4px solid #ffb81f; border-radius: 26px; padding: 6px 18px 6px 8px; box-shadow: 0 6px 0 rgba(150,90,0,.25); pointer-events: none;
    font: 700 26px/1 ${BB.FONT}; color: #9a5d00; animation: bbu-newst 2.8s ease-in-out forwards; white-space: nowrap; }
  .bbu-newst canvas { width: 64px; height: 64px; }
  @keyframes bbu-newst { 0% { transform: translate(-50%, -30px) scale(.5); opacity: 0; } 12% { transform: translate(-50%, 0) scale(1.08); opacity: 1; } 20%, 85% { transform: translate(-50%, 0) scale(1); opacity: 1; } 100% { transform: translate(-50%, -20px); opacity: 0; } }
  @media (max-height: 520px) { .bbu-newst { font-size: 20px; } .bbu-newst canvas { width: 46px; height: 46px; } }
  /* Christmas: a Santa hat on the lettering, a few twinkling sparkles on the home screen (no snow: Singapore), festive confetti */
  .bbu-logo { position: relative; }
  html.xmas .bbu-logo::before { content: ''; position: absolute; left: -.32em; top: -.52em; width: .95em; height: .86em; transform: rotate(-16deg);
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 90'%3E%3Cpath d='M14 70 Q30 14 66 12 Q86 12 92 44 Q78 30 70 40 Q60 58 62 70Z' fill='%23d63c35'/%3E%3Cpath d='M30 66 Q40 26 66 18 Q60 40 58 68Z' fill='%23ef5a4b'/%3E%3Crect x='6' y='62' width='66' height='18' rx='9' fill='%23fff6e0' stroke='%23e2d3b5' stroke-width='3'/%3E%3Ccircle cx='90' cy='50' r='10' fill='%23fff6e0' stroke='%23e2d3b5' stroke-width='3'/%3E%3C/svg%3E") center/contain no-repeat; filter: drop-shadow(0 3px 0 rgba(0,0,0,.15)); pointer-events: none; }
  .bbu-snow { position: absolute; inset: 0; pointer-events: none !important; overflow: hidden; display: none; }
  html.xmas .bbu-snow { display: block; }
  .bbu-snow i { position: absolute; width: 12px; height: 12px; opacity: 0; background: #ffe27a;
    clip-path: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%); animation: bbu-twinkle2 ease-in-out infinite; }
  .bbu-snow i:nth-child(3n) { background: #fffbe8; }
  @keyframes bbu-twinkle2 { 0%, 100% { opacity: 0; transform: scale(.4) rotate(0deg); } 50% { opacity: .9; transform: scale(1) rotate(45deg); } }
  .bbu-confetti.flake { border-radius: 0; background: #fff !important; clip-path: polygon(50% 0, 60% 38%, 98% 25%, 66% 50%, 98% 75%, 60% 62%, 50% 100%, 40% 62%, 2% 75%, 34% 50%, 2% 25%, 40% 38%); width: 18px; height: 18px; }
  .bbu-confetti.star { border-radius: 0; background: #ffd45c !important; clip-path: polygon(50% 0, 62% 36%, 100% 38%, 70% 60%, 80% 98%, 50% 76%, 20% 98%, 30% 60%, 0 38%, 38% 36%); width: 18px; height: 18px; }
  #ui.home .bbn-friends { display: none; }       /* (the home screen has its own friends strip) */
  .bbu-fam .ind { position: relative; display: flex; align-items: center; gap: 6px; padding: 4px 10px 4px 6px; min-height: var(--bh); box-sizing: border-box;
    border-radius: 20px; background: #fff6e0; border: 3px solid #d9b57f; box-shadow: inset -4px -5px 0 rgba(217,181,127,.45), 0 4px 0 rgba(120,80,40,.18);
    font: 700 var(--lb)/1 ${BB.FONT}; color: #4a3424; pointer-events: none; }
  .bbu-fam .col { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .bbu-fam .col canvas { width: var(--ic); height: var(--ic); }
  .bbu-fam .bus { display: flex; flex-direction: column; align-items: center; background: #fff; border: 2px solid #ecd3a8; border-radius: 12px; padding: 2px 4px 1px; }
  .bbu-fam .bus canvas { width: 46px; height: 31px; display: block; }
  .bbu-fam .bus b { font: 800 13px/14px 'Courier New', monospace; color: #3a2a3c; }
  .bbu-fam .cnt { position: absolute; top: -9px; left: -7px; min-width: 26px; height: 26px; border-radius: 13px; background: #5cb85c; color: #fff;
    font: 700 17px/26px ${BB.FONT}; text-align: center; box-shadow: 0 3px 0 #3f913f; padding: 0 4px; box-sizing: border-box; }
  .bbu-fam .more { font: 700 18px/1 ${BB.FONT}; color: #6b5440; padding: 0 2px; }
  @media (max-height: 520px) {
    .bbu-play { height: 84px; font-size: 40px; padding: 0 34px 0 14px; border-radius: 44px; gap: 12px; } .bbu-play canvas { width: 58px; height: 58px; }
    .bbu-fam .bus canvas { width: 38px; height: 26px; } .bbu-fam .bus b { font-size: 12px; line-height: 13px; }
  }
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
  /* narrower screens (phones): the clock stays in the top bar beside Next stop (the bar has room since it was
     trimmed), a little smaller, so it never sits over the road or the question card */
  @media (max-width: 900px) { .bbu-top .bbu-clock { height: 44px; padding: 0 12px 0 8px; gap: 4px; font-size: 22px; margin-top: calc((var(--bh) - 44px) / 2); }
    .bbu-top .bbu-clock svg { width: 26px; height: 26px; } }
  @media (max-width: 620px) { .bbu-top .bbu-clock { height: 40px; padding: 0 9px 0 6px; font-size: 19px; margin-top: calc((var(--bh) - 40px) / 2); }
    .bbu-top .bbu-clock svg { width: 22px; height: 22px; } .bbu-mid { gap: 6px; } }
  /* small phones held sideways: the wheel, the pedals and the joystick are sized from the height (the wheel at most
     about 40% of it), lifted a little off the bottom edge so their shadows and glows show, and never under 64 px */
  @media (max-height: 430px) {
    #ui { --wh: clamp(118px, 39vh, 136px); --joy: clamp(118px, 39vh, 132px); --pgw: 86px; --pgh: clamp(92px, 29vh, 106px);
      --pbw: 66px; --pbh: clamp(72px, 23vh, 82px); --cb: calc(var(--sb) + 4px); }
    .bbu-wheel, .bbu-ped, .bbu-joy, .bbu-wash { bottom: var(--cb); }
    .bbu-uturn { bottom: calc(var(--cb) + var(--joy) + 12px); }
    .ctl-wheel .bbu-uturn { bottom: calc(var(--cb) + var(--pgh) + 14px); }
    .bbu-tip { bottom: calc(var(--cb) + var(--joy) / 4); }
    .bbu-tip.wheelhand { bottom: calc(var(--cb) + var(--wh) * .65); } .bbu-tip.pedalhand { bottom: calc(var(--cb) + var(--pgh) / 4); }
    .bbu-ped .lb { font-size: calc(var(--lb) + 3px); }
    .bbu-ped.go.nudge, .bbu-ped.go.idle { animation-name: bbu-pednudge-s; }
  }
  @keyframes bbu-pednudge-s {
    0%, 100% { box-shadow: inset 0 0 0 0 #fff, inset 0 0 0 0 #ffc23a, inset -5px -6px 0 rgba(0,0,0,.1), 0 8px 0 #24702d, 0 0 0 0 #ffb81f, 0 0 0 0 rgba(176,104,0,.75), 0 10px 18px rgba(0,0,0,.15); }
    50% { box-shadow: inset 0 0 0 3px #fff, inset 0 0 0 8px #ffc23a, inset -5px -6px 0 rgba(0,0,0,.1), 0 8px 0 #24702d, 0 0 0 3px #ffb81f, 0 0 0 4.5px rgba(176,104,0,.75), 0 10px 18px rgba(0,0,0,.15); } }
  `);

  function darkHex(c, t = 0.22) { return BB.dark ? BB.dark(c, t) : c; }
  U.darkHex = darkHex;
  const picCanvas = (name, size = 80) => BB.iconEl(name, size, true);
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

  let uturnBtn, washBtn, facing = false, driving = true, tips = [], wheelLetGo = null;
  let hud, cashEl, fuelCv, jobEl, jobPic, jobDots, wheelEl, wheelRot, pedGo, pedBack, titleEl, soundBtn, exitBtn, homeBtn, garageBtn, playBtn, famEl, wishEl;

  U.init = function () {
    U.root = document.getElementById('ui');
    hud = BB.el('div', 'bbu-hud off', U.root);
    const top = BB.el('div', 'bbu-top', hud);
    const left = BB.el('div', 'bbu-grp', top);
    // Home: back to the game's home screen (from there the all-games button leaves to the app in hub mode)
    homeBtn = U.btn(left, 'home', 'Home', () => U.homeTap(), 'bbu-home');
    // one small tile for the coins and the fuel dial (tap: both are said)
    cashEl = U.btn(left, null, 'Coins', () => {
      const n = BB.depot.cash, f = BB.bus.fuel, low = f <= BB.cfg.fuelLow + 0.05;
      // (and the wish, the ride being saved up for: how many more coins it takes)
      let w = null; try { w = BB.depot.wish && BB.depot.wish(); } catch (e) { /* none */ }
      const wl = !w ? '' : w.need > 0 ? `${w.need} more for the ${w.name}!` : `Enough for the ${w.name}!`;
      BB.say((n === 1 ? 'You have 1 coin! ' : `You have ${n} coins! `) +
        (low ? "Fuel is getting low, let's go to the garage!" : wl || (f > 0.55 ? 'Lots of fuel!' : 'Half a tank of fuel.')));
    }, 'bbu-cash nolb');
    const crow = BB.el('span', 'row', null); cashEl.prepend(crow);
    crow.appendChild(BB.iconEl('coin', 96)); BB.el('b', '', crow, String(BB.depot.cash));
    fuelCv = BB.el('canvas', 'fuel', crow);
    const mid = BB.el('div', 'bbu-mid', top);
    jobEl = U.btn(mid, null, 'Next stop', () => { const t = BB.bus.target; if (t) BB.say(BB.bus.washBay && t === BB.bus.washBay ? 'Drive to the bus wash!' : `Drive to ${t.say}!`); }, 'bbu-job');
    const jrow = BB.el('span', 'row', null); jobEl.prepend(jrow);
    jobPic = BB.el('canvas', '', jrow); jobPic.width = jobPic.height = 96;
    jobDots = BB.el('span', 'dots', jrow);
    if (BB.HUB) mid.appendChild(U.makeClock());
    const right = BB.el('div', 'bbu-grp', top);
    garageBtn = U.btn(right, 'garage', 'Garage', () => {
      const ph = BB.jobs.phase;
      if (ph === 'drive' || ph === 'done' || ph === 'stop' || ph === 'question') {
        let wl = null; try { wl = BB.depot.wishNews && BB.depot.wishNews('tile'); } catch (e) { wl = null; }   // (now and then, not every tap)
        BB.say(wl || "Let's go to the garage!"); BB.jobs.goDepot('quiet');
      }
      else if (ph === 'toDepot') BB.say("We're going to the garage!");
      else BB.say('Garage!');
    });
    // enough coins for the wish (the ride being saved up for, depot.js): the Garage tile glows gold and shows that
    // ride's little picture, so the child knows it is waiting there
    const wishPic = BB.el('span', 'wishpic', garageBtn);
    let wishId = '';
    const wishReady = () => { let w = null; try { w = BB.depot && BB.depot.wish ? BB.depot.wish() : null; } catch (e) { w = null; } return w && w.need <= 0 ? w : null; };
    U.syncWish = function () {
      const w = wishReady();
      garageBtn.classList.toggle('wishready', !!w);
      U.root.classList.toggle('wishup', !!w);           // (friends' chips, net.js, move down past the little card)
      if (w && w.id !== wishId) {
        wishId = w.id; wishPic.innerHTML = '';
        try { const pc = w.pic(), c = document.createElement('canvas'); c.width = pc.width; c.height = pc.height; c.getContext('2d').drawImage(pc, 0, 0); wishPic.appendChild(c); } catch (e) { console.error(e); }
      }
    };
    for (const ev of ['cash:changed', 'wish:changed', 'depot:closed']) BB.on(ev, () => U.syncWish());
    U.syncWish();
    soundBtn = U.btn(right, 'sound', 'Sound', () => {
      const mute = !BB.audio.mute;
      BB.audio.setSound(mute, BB.audio.music, true);
      if (!mute) { BB.sfx.click(); BB.say('Sound on!'); }
    }, 'bbu-snd');
    BB.on('sound:changed', syncSound); syncSound();

    // driving: the steering wheel and the Go / Back pedals (the only controls: the owner chose them over a joystick)
    // The steering wheel takes a finger two ways, and eases back to the middle when let go:
    //  - pushed from its middle (where a thumb lands first, and where the angle means little) it works like a stick
    //    ('push'): the wheel turns the way the finger slides, left or right, from nothing (a tap's wobble is left out)
    //    to all the way when the finger has gone a little over one wheel-radius, and it is straight again when the
    //    finger is back where it began. Where the finger is decides it, so a slide that comes back, or carries on
    //    across, always steers the way it goes, whatever the finger did before.
    //    One thing more, like a real wheel: out on the SIDES of the rim, a finger going up or down round the rim turns
    //    the wheel round with it (so a push that reaches the side and goes on round a little keeps turning that way,
    //    instead of easing back). That extra turn ('wind') comes only from going round where going round is going up
    //    or down (not in or out, not across, and never along the top or the bottom, where going round is going
    //    sideways); a slide the other way takes it off first, it fades as the finger comes in off the rim, and it is
    //    gone once the finger is back near the middle. And on every move, a finger going more sideways than up or
    //    down never turns the wheel the other way: whatever the finger did before, a slide steers the way it goes.
    //  - held by its rim it is a real wheel ('wheel'): it turns with the finger's angle, up to about 135 degrees each
    //    way. Brought into the middle it becomes the stick above, from where the wheel stands.
    // The horn is the red middle: a short press there that doesn't turn the wheel honks, decided when the finger
    // lifts, so a little wobble doesn't spoil it. The Go and Back pedals are held.
    wheelEl = BB.el('div', 'bbu-wheel', hud); wheelRot = BB.el('div', 'rot', wheelEl, WHEEL_SVG);
    wheelEl.setAttribute('aria-label', 'steering wheel');
    // Shares of the wheel's radius (the picture: the red horn out to 0.34, the spokes to 0.73, then the rim):
    // MID: a press that starts inside it is a push, and may be the horn (the horn's old reach); RED: the red horn,
    // with a finger's margin; CORE: a rim press brought this far in becomes a stick; RIM: out on the rim (where going
    // round turns the wheel like a real wheel); IN: the wind has faded away by here.
    // STEER_PX: a push steers once the finger has gone this far sideways, and from nothing (the way there doesn't
    // count). STEP_PX: the way round is measured in steps at least this long (a finger's tremble has no direction).
    // The horn: a press that never turned the wheel by HORN_DEG or more (so a quick sideways jab steers and doesn't
    // honk), and was either under TAP_MS and slid less than TAP_PX or stayed on the red horn, or under PRESS_MS and
    // barely moved (STILL_PX) or stayed on the red horn sliding less than TAP_PX.
    const MID = 0.6, RED = 0.42, CORE = 0.3, RIM = 0.72, IN = 0.3, STEER_PX = 9, STEP_PX = 5;
    const TAP_MS = 350, TAP_PX = 24, PRESS_MS = 700, STILL_PX = 12, HORN_DEG = 12;
    const wp = { x: 0, y: 0, R: 1 };
    const wheelAt = (e) => {            // the finger, measured from the wheel's middle
      const r = wheelEl.getBoundingClientRect();
      wp.x = e.clientX - (r.left + r.width / 2); wp.y = e.clientY - (r.top + r.height / 2); wp.R = (wheelEl.offsetWidth || r.width || 2) / 2;
      return wp;
    };
    let wheelId = null, mode = '', inHub = false, onRed = false, downT = 0, downX = 0, downY = 0, far = 0, wide = 0;
    let px = 0, py = 0, lmX = 0, lmY = 0, qx = 0, qy = 0, qX = 0, anchorX = 0, anchorRot = 0, dead = 0, wind = 0, fades = 0;
    // the stick: the wheel's angle for a finger at x (from the anchor; the first `dead` pixels either way are still)
    const stickRot = (x, R) => { const d = x - anchorX, a = Math.abs(d) - dead; return BB.clamp(anchorRot + (a > 0 ? (d < 0 ? -a : a) : 0) / R * 135, -135, 135); };
    const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
    wheelEl.addEventListener('pointerdown', (e) => {
      e.preventDefault(); if (wheelId != null) return;
      wheelId = e.pointerId; try { wheelEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const p = wheelAt(e), r = Math.hypot(p.x, p.y);
      wheel.drag = true; px = qx = p.x; py = qy = p.y; qX = e.clientX; lmX = e.clientX; lmY = e.clientY;
      downT = e.timeStamp || performance.now(); downX = e.clientX; downY = e.clientY; far = 0; wide = 0;
      inHub = r < p.R * MID; onRed = r < p.R * RED;
      mode = inHub ? 'push' : 'wheel';
      anchorX = downX; anchorRot = wheel.rot; dead = STEER_PX; wind = 0; fades = 0;
      wheelEl.classList.add('grab');
    });
    wheelEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== wheelId) return;
      const p = wheelAt(e), x = p.x, y = p.y, R = p.R, r = Math.hypot(x, y);
      const travel = Math.hypot(e.clientX - downX, e.clientY - downY); if (travel > far) far = travel;
      const side = Math.abs(e.clientX - downX); if (side > wide) wide = side;
      if (r >= R * MID) inHub = false;                 // out of the middle: a turn, not the horn
      if (r >= R * RED) onRed = false;
      if (mode === 'push') {
        const base = stickRot(e.clientX, R);
        // Measured over steps of at least STEP_PX: is the finger going round out on the rim (both ends of the step on
        // the rim, and the step mostly going round rather than in or out)? Then the wheel turns like a real wheel,
        // by the angle the finger went round (dA, degrees, clockwise = to the right): the wind takes up the
        // difference from the stick. A sideways slide across under or over the middle mostly goes in or out where it
        // meets the rim, so it stays a stick. A step the stick takes back the other way (a slide coming back, or
        // going on across) first takes the wind off, so the wheel answers the finger at once.
        const sx = x - qx, sy = y - qy;
        if (sx * sx + sy * sy >= STEP_PX * STEP_PX) {
          const rq = Math.hypot(qx, qy), dS = base - stickRot(qX, R);
          let ro = 0, dA = 0;
          if (rq >= R * RIM && r >= R * RIM) {
            dA = (Math.atan2(y, x) - Math.atan2(qy, qx)) * 180 / Math.PI; while (dA > 180) dA -= 360; while (dA < -180) dA += 360;
            if (Math.abs(dA) < 60) { const round = Math.abs(dA) * Math.PI / 180 * (r + rq) / 2, inout = Math.abs(r - rq); ro = BB.smooth((round / (round + inout) - 0.5) / 0.3); }
            // only where going round is going up or down (the sides of the rim): along the top or the bottom going
            // round is going sideways, and there the wheel must simply follow the finger's way, like the stick
            ro *= BB.smooth((1 - Math.abs(sx) / Math.max(Math.abs(sy), 0.001)) / 0.5);
          }
          if (ro > 0) wind += (dA - dS) * ro;
          const off = Math.abs(dS) * (1 - ro);
          if (wind !== 0 && off > 0 && sgn(dS) === -sgn(wind)) wind = Math.abs(wind) <= off ? 0 : wind - sgn(wind) * off;
          qx = x; qy = y; qX = e.clientX;
        }
        // Coming in off the rim fades the wind away for good (going back out doesn't bring it back), all gone once
        // the finger is near the middle; at the lock, out on the rim, the finger slips round the rim (the wind never
        // piles up beyond the lock, so going back answers at once).
        const fade = BB.smooth((r / R - IN) / (RIM - IN));
        if (fade < fades) wind = fades > 0 ? wind * fade / fades : 0;
        fades = fade;
        if (fade >= 1) wind = BB.clamp(wind, -135 - base, 135 - base);
        // the one promise, checked on every move: a finger going more sideways than up or down never turns the wheel
        // the other way (if anything above would, the wheel just waits where it is)
        const mx = e.clientX - lmX, my = e.clientY - lmY;
        if (Math.abs(mx) > Math.abs(my) && (base + wind - wheel.rot) * mx < 0) wind = wheel.rot - base;
        wheel.rot = BB.clamp(base + wind, -135, 135);
      } else {
        // How far round the middle the finger went since the last move (degrees, clockwise = to the right), faded out
        // where the move passes right by the middle (there the angle means nothing, and a finger crossing it would
        // flip the wheel right over).
        let dA = (Math.atan2(y, x) - Math.atan2(py, px)) * 180 / Math.PI; while (dA > 180) dA -= 360; while (dA < -180) dA += 360;
        const sx = x - px, sy = y - py, len2 = sx * sx + sy * sy, t = len2 > 0 ? BB.clamp(-(px * sx + py * sy) / len2, 0, 1) : 0;
        const near = Math.hypot(px + sx * t, py + sy * t) / R;
        wheel.rot = BB.clamp(wheel.rot + dA * BB.smooth((near - 0.1) / 0.15), -135, 135);
        if (r < R * CORE) {
          // brought into the middle: a stick from here on, starting from where the wheel stands
          mode = 'push'; anchorX = e.clientX; anchorRot = wheel.rot; dead = 0; wind = 0; fades = 0; qx = x; qy = y; qX = e.clientX;
        }
      }
      px = x; py = y; lmX = e.clientX; lmY = e.clientY;
      showWheel();
      if (Math.abs(wheel.rot) > 25) hideTip('wheelhand');
      applyInput();
    });
    // The horn: a press that began on the wheel's middle, never left it and never turned the wheel (by HORN_DEG)
    // honks when the finger lifts: a quick one that slid only a little (or stayed on the red horn), or a slower one
    // that hardly moved (or stayed on the red horn and slid only a little). A slide that turned the wheel is a turn,
    // not the horn, however quick (so quick little steering jabs never add up to the secret turbo). Any small turn
    // begun meanwhile eases away by itself. (The events' own times are used, so a busy frame between finger down
    // and finger up doesn't make a quick tap look like a long one.)
    const wheelUp = (e) => {
      if (e.pointerId !== wheelId) return; wheelId = null; wheel.drag = false;
      wheelEl.classList.remove('grab');
      const held = (e.timeStamp || performance.now()) - downT, R = (wheelEl.offsetWidth || 2) / 2;
      const turned = (wide - STEER_PX) / R * 135 >= HORN_DEG;
      const horn = !turned && (held < TAP_MS ? far < TAP_PX || onRed : held < PRESS_MS && (far < STILL_PX || (onRed && far < TAP_PX)));
      if (e.type === 'pointerup' && inHub && horn) honk();
      inHub = onRed = false; mode = ''; wind = 0;
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) wheelEl.addEventListener(ev, wheelUp);
    wheelLetGo = () => { wheelId = null; inHub = onRed = false; mode = ''; wind = 0; };
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
    // The horn: the wheel's red middle. A secret: three quick honks (within about a second) while driving fire the
    // turbo, when bus.js has one ready (BB.bus.boost / boostReady); otherwise it is just the horn
    const honks = [];
    function honk() {
      BB.bus.horn();
      wheelEl.classList.remove('honk'); void wheelEl.offsetWidth; wheelEl.classList.add('honk');
      const now = performance.now(); honks.push(now); while (honks.length && now - honks[0] > 1100) honks.shift();
      if (honks.length >= 3) { honks.length = 0; secretTurbo(); }
    }
    U.honk = honk;
    BB.on('bus:type', () => renderJob());
    U.setLefty(!!BB.save.leftHand, true);
    U.setControl(BB.save.control, true);
    // turn around: offered while the bus faces away from where it should go (bus.js emits bus:facingAway)
    uturnBtn = U.btn(hud, 'uturn', 'Turn around', () => {
      if (!BB.bus.turnAround) return;
      if (BB.bus.turnAround() === false) { BB.sfx.wrong(); return; }   // not allowed right now: stays offered
      BB.sfx.whoosh(); BB.say('Turn around!'); facing = false; syncUturn();
    }, 'drv bbu-uturn');
    // the bus wash (bus.js: save.dirt, washBay, wash(), 'bus:washBay', 'bus:washed'; feature-detected)
    washBtn = U.btn(hud, 'wash', 'Wash', () => U.goWash(), 'drv bbu-wash');
    BB.on('bus:washBay', (d) => { if (d && d.inBay) U.atWash(); else washDeclined = false; });   // (asked again only after leaving the bay)
    BB.on('bus:washed', () => washDone());
    BB.on('bus:dirt', syncWash);
    BB.on('bus:turnAround', () => { facing = false; idleGo = 0; syncUturn(); });
    BB.on('bus:facingAway', (d) => { facing = !!(d && d.on); syncUturn(); });

    // the home screen: the lettering, ONE big Play button (to the garage), the family strip
    titleEl = BB.el('div', 'bbu-title', U.root);
    titleEl.style.display = 'none';
    const logo = BB.el('div', 'bbu-logo', titleEl, 'Little Bus <span>Captain</span>');
    BB.tap(logo, () => BB.say('Little Bus Captain!'));
    playBtn = BB.el('button', 'bbu-play', titleEl); playBtn.type = 'button'; playBtn.setAttribute('aria-label', 'Play');
    playBtn.appendChild(BB.iconEl('play', 128)); BB.el('span', 'lb', playBtn, 'Play');
    BB.tap(playBtn, () => U.play());
    famEl = BB.el('div', 'bbu-fam', titleEl);
    U.btn(titleEl, 'book', 'Book', () => U.openBook(), 'bbu-bookbtn');
    wishEl = BB.el('button', 'bbu-b bbu-wish', titleEl); wishEl.type = 'button'; wishEl.style.display = 'none';
    BB.tap(wishEl, () => wishTap());
    const snow = BB.el('div', 'bbu-snow', titleEl);
    for (let i = 0; i < 14; i++) {        // (twinkling sparkles in the sky, not snow)
      const f = BB.el('i', '', snow), sz = 9 + Math.random() * 9;
      f.style.cssText = `left:${4 + Math.random() * 92}%;top:${4 + Math.random() * 50}%;width:${sz}px;height:${sz}px;animation-duration:${2.2 + Math.random() * 2.5}s;animation-delay:${-Math.random() * 4}s`;
    }
    for (const ev of ['net:status', 'net:friends', 'net:changed']) BB.on(ev, () => { if (U.titleShown()) syncFam(); });
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
      else if (e.code === 'Enter' && U.titleShown()) U.play();
      else if (e.code === 'Enter' && BB.depot.isOpen && !BB.bedtime) BB.depot.close();
    });
    addEventListener('keyup', (e) => { const k = KEYS[e.code]; if (k) press(k, false); });
    addEventListener('blur', () => U.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) U.releaseAll(); });
    BB.on('held', (d) => { if (d.on) U.releaseAll(); });
    BB.on('bus:bump', () => { const c = document.getElementById('c'); if (!c) return; c.classList.remove('bbu-wobble'); void c.offsetWidth; c.classList.add('bbu-wobble'); BB.sfx.pop(); });

    // events
    // (quiet: the job's coins fly in from the job-done banner; the counter goes up as they land, U.coinsLanded)
    const showCash = () => { cashEl.querySelector('b').textContent = String(BB.depot.cash); };
    const bumpCash = () => { cashEl.classList.remove('bump'); void cashEl.offsetWidth; cashEl.classList.add('bump'); };
    BB.on('cash:changed', (d) => {
      if (d.quiet && d.delta > 0) { BB.later(2600, showCash); return; }
      showCash();
      if (d.delta > 0) { bumpCash(); U.coins(d.delta); }
    });
    U.coinsLanded = () => { showCash(); bumpCash(); BB.sfx.coin(); };
    BB.on('job:new', () => renderJob());
    BB.on('job:target', () => { if (washRoute) washRoute = null; renderJob(); });   // (the job took over the way)
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
    BB.on('depot:open', () => { U.releaseAll(); U.closeAsk(); hud.classList.add('off'); U.showExit(false); });
    BB.on('depot:closed', (d) => { U.showExit(false); if (d && d.home) U.showHome(); else if (!BB.bedtime) hud.classList.remove('off'); });
  };
  function syncSound() {
    const A = BB.audio;
    soundBtn.classList.toggle('off', A.mute); U.setIcon(soundBtn, A.mute ? 'soundOff' : 'sound');
  }
  function syncUturn() { const on = facing && driving && !!BB.bus.turnAround; if (uturnBtn) uturnBtn.classList.toggle('on', on); if (on && pedGo) pedGo.classList.remove('nudge'); }
  // ---------- the bus wash ----------
  // A dusty bus (save.dirt > 0.4, only looks) gets a Wash tile: the ribbon leads to the wash bay next to the garage. In
  // the bay a pay card: 3 coins (never taken without a yes; too few = "Let's do more jobs!"). Then bus.js's wash
  // show, "Sparkly clean!", and the job's own way back.
  const WASH_PRICE = 3;
  const washOK = () => !!(BB.bus && BB.bus.washBay && typeof BB.bus.wash === 'function');
  const dirt = () => (BB.bus && typeof BB.bus.dirt === 'number' ? BB.bus.dirt : +BB.save.dirt || 0);
  const dusty = () => dirt() > 0.4;
  let washRoute = null, washing = false, washDeclined = false, washAsk = false;
  function syncWash() {
    if (!washBtn) return;
    const ph = BB.jobs.phase;
    washBtn.classList.toggle('on', washOK() && dusty() && driving && !washing && !washRoute && (ph === 'drive' || ph === 'done' || ph === 'idle'));
  }
  U.syncWash = syncWash;
  setInterval(() => { if (hud && !hud.classList.contains('off')) syncWash(); }, 1000);
  // ---------- the secret turbo (three quick honks) ----------
  function secretTurbo() {
    const B = BB.bus;
    if (!B || typeof B.boost !== 'function' || !driving || BB.bedtime) return;
    if (typeof B.isLooking === 'function' && B.isLooking()) return;           // (an event's look-up: just the horn)
    // not now (cooling down, near a stop): a little fizz and a puff of sparks, so it doesn't seem broken
    let r = false;
    if (typeof B.boostReady !== 'function' || B.boostReady()) { try { r = B.boost(); } catch (e) { console.error(e); } }
    if (r === false) { turboFizz(); return; }
    if (BB.sfx.turbo) BB.sfx.turbo(); else BB.sfx.whoosh();
    BB.say('Turbo!');
    const t = BB.el('div', 'bbu-turbo', U.root, 'TURBO!'); BB.later(1700, () => t.remove());
    const m = BB.save.spotted && typeof BB.save.spotted === 'object' && !Array.isArray(BB.save.spotted) ? BB.save.spotted : (BB.save.spotted = {});
    if (!m.turbo) {                                        // found for the first time: a sticker for the book
      m.turbo = 1; BB.saveNow();
      BB.say('You found a secret!', { queue: true });
      BB.later(1800, () => gotSticker('turbo', 'Secret turbo', () => BB.spotPic('turbo', 128)));   // (after TURBO! has gone)
    }
  }
  let fizzSaid = -1e9;
  function turboFizz() {
    if (BB.sfx.fizz) BB.sfx.fizz();
    const p = BB.el('div', 'bbu-fizz', U.root); BB.el('b', '', p);
    for (let i = 0; i < 9; i++) { const sp = BB.el('i', '', p); sp.style.setProperty('--a', (i / 9 * 360 + Math.random() * 30) + 'deg'); sp.style.animationDelay = (Math.random() * 0.1) + 's'; }
    BB.later(900, () => p.remove());
    const now = performance.now();
    if (now - fizzSaid > 30000 && !BB.speaking()) { fizzSaid = now; BB.say('Not yet, Captain!'); }
  }
  U.secretTurbo = secretTurbo;
  // ---------- the other rides ----------
  // What kind of ride this is: 'bus', 'taxi', 'fire', 'ambulance', 'icecream' or 'tow' (fleet.js KIND when it says).
  const KIND_OF = { fire: 'fire', fireEngine: 'fire', fireTruck: 'fire', ambulance: 'ambulance', medic: 'ambulance', checkup: 'ambulance',
    icecream: 'icecream', iceCream: 'icecream', tow: 'tow', towTruck: 'tow', taxi: 'taxi' };
  const rideKind = (type) => { const K = BB.fleet && BB.fleet.KIND; const k = (K && K[type]) || type; return KIND_OF[k] || KIND_OF[type] || 'bus'; };
  U.rideKind = () => { const B = BB.bus; return B && typeof B.kind === 'string' ? (KIND_OF[B.kind] || 'bus') : rideKind(B && B.type); };
  // put the job's own target back (its arrival callback too) after the wash, or if the child says no
  function washBack() {
    const r = washRoute; washRoute = null;
    // (bus.js refuses a new target while the bus is still pulling into a bay: try again a moment later)
    const put = (tries) => {
      let done = true;
      try { if (r) done = BB.bus.stopAt(r.target || null, r.cb || null) !== false; } catch (e) { console.error(e); }
      if (!done && tries > 0 && !washRoute) BB.later(400, () => put(tries - 1));
      renderJob(); syncWash();
    };
    put(50);
  }
  U.goWash = function () {
    if (!washOK() || washing || washRoute || BB.bedtime) return;
    washDeclined = false;
    const B = BB.bus;
    washRoute = { target: B.target, cb: B.onArrive };
    if (B.stopAt(B.washBay, () => U.atWash()) === false) { washRoute = null; BB.say('Let\'s finish this stop first!'); return; }
    BB.sfx.pop(); BB.say("Let's go to the bus wash!");
    renderJob(); syncWash();
  };
  U.atWash = function () {
    if (!washOK() || washing || washDeclined || BB.bedtime || askEl || BB.depot.isOpen) return;
    if (BB.bus.inWash === false) return;                  // (bus.js: only once the bus is really in the bay)
    U.releaseAll();
    if (!dusty() && dirt() < 0.15) { BB.say('Your bus is already clean and shiny!'); if (washRoute) washBack(); return; }
    const price = BB.el('div', 'price', null); price.appendChild(BB.iconEl('coin', 96)); BB.el('span', '', price, String(WASH_PRICE));
    washAsk = true;
    U.ask({ pic: 'wash', words: 'Wash the bus?', extra: price, say: `A wash costs ${WASH_PRICE} coins. Wash the bus?`,
      yes: () => { washAsk = false; payWash(); }, no: () => { washAsk = false; washDeclined = true; BB.say('OK! Maybe next time.'); washBack(); } });
  };
  // The wash card, or the wash itself, is on: bedtime waits for it (main.js), like it waits for a question.
  U.washBusy = () => washing || (washAsk && !!askEl);
  function payWash() {
    const cash = BB.depot.cash;
    if (cash < WASH_PRICE) {
      const need = WASH_PRICE - cash;
      BB.sfx.wrong(); BB.say(`Let's do more jobs! You need ${need} more ${need === 1 ? 'coin' : 'coins'}.`);
      washDeclined = true; washBack(); return;
    }
    flyCoinsOut(WASH_PRICE); BB.sfx.jingle();
    BB.depot.spend(WASH_PRICE);
    BB.save.washPaid = WASH_PRICE; BB.saveNow();      // (until the wash finishes: a reload mid-wash gives the coins back)
    washing = true; syncWash();
    BB.later(700, () => {
      let r = false;
      try { r = BB.bus.wash(); } catch (e) { console.error(e); }
      if (r === false) { washing = false; BB.save.washPaid = 0; BB.saveNow(); BB.depot.add(WASH_PRICE); BB.say("Let's drive right into the bus wash first!"); washBack(); return; }   // (coins back)
      if (r && r.then) r.then(() => washDone(), () => washDone());
    });
    // never stuck: if bus.js never says it's done (the show itself runs ~6.4 s on the game clock)
    const safety = () => { if (!washing) return; if (BB.bus.locked && BB.bus.inWash) { BB.later(5000, safety); return; } washDone(); };
    BB.later(20000, safety);
  }
  function washDone() {
    if (!washing) return;
    washing = false; washAsk = false;
    BB.save.washPaid = 0; BB.saveNow();
    BB.sfx.sparkle(); BB.say('Sparkly clean!');
    U.toast('✨', 1600); U.confetti(0.5);
    washBack();
  }
  // coins fly from the counter toward the bus
  function flyCoinsOut(n) {
    const a = cashEl.getBoundingClientRect(), root = U.root.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const c = BB.iconEl('coin', 80); c.className = 'bbu-wcoin'; U.root.appendChild(c);
      const x0 = a.left - root.left + 8, y0 = a.top - root.top + 8, x1 = innerWidth / 2 - 20 + (i - 1) * 30, y1 = innerHeight * 0.55;
      if (!c.animate) { c.remove(); continue; }
      const an = c.animate([{ transform: `translate(${x0}px, ${y0}px) scale(.7)`, opacity: 1 }, { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 40}px) scale(1.1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${x1}px, ${y1}px) scale(.5)`, opacity: 0 }], { duration: 800, delay: i * 120, easing: 'ease-in-out', fill: 'both' });
      an.onfinish = () => c.remove(); BB.later(1600, () => c.remove());
    }
  }
  // first-drive tip: a hand turning the wheel and one pressing Go (until the bus is driven forward, or 12 s)
  // (wheel layout: a hand turning the wheel and a hand pressing Go)
  U.showTips = function () {
    U.hideTips();
    tips = [BB.el('div', 'bbu-tip wheelhand', hud, HAND_SVG), BB.el('div', 'bbu-tip pedalhand', hud, HAND_SVG)]; pedGo.classList.add('nudge');
    BB.later(12000, U.hideTips);
  };
  U.hideTips = function () { for (const t of tips) t.remove(); tips = []; if (pedGo) pedGo.classList.remove('nudge'); };
  function hideTip(cls) { tips = tips.filter((t) => { if (t.classList.contains(cls)) { t.remove(); return false; } return true; }); }
  U.driveTip = () => 'Hold the green pedal to go! Turn the wheel to steer!';
  function setDriving(on) {
    driving = on; syncUturn();
    if (!on) U.hideTips();
    for (const el of [wheelEl, pedGo, pedBack, washBtn]) if (el) el.style.visibility = on ? '' : 'hidden';
    if (!on) U.releaseAll();
    syncWash();
  }
  // the Next stop tile's word on a job of the other rides
  const JOB_WORD = { fire: 'Fire!', ambulance: 'Ambulance', icecream: 'Ice cream', tow: 'Tow' };
  const JOB_PIC = { fire: 'fire', ambulance: 'medic', icecream: 'icecream', tow: 'tow', taxi: 'taxi' };
  const JOB_WORD_TAXI = 'Taxi';
  let jobKey = '';
  function renderJob() {
    const job = BB.jobs.current, t = BB.bus.target;
    if (!t && !job) { jobEl.style.visibility = 'hidden'; return; }
    jobEl.style.visibility = 'visible';
    const stop = t || (job && job.stops[Math.min(job.index, job.stops.length - 1)]);
    const wash = !!(t && BB.bus.washBay && t === BB.bus.washBay);
    const depot = !!(t && t.id === 'depot');
    // the picture of where the job is going (a job of the other rides may name its own: job.pic, or the target's pic)
    // (a roadside scene spot has no picture of its own: the fire, the check-up, the ice cream queue, the broken-down car)
    // (the other rides go to their own stops, not bus stops: the Next stop tile shows the job's own picture)
    const vk = job && job.vehicle && (KIND_OF[job.vehicle] || job.vehicle);
    const pic = wash ? null : (!depot && job && job.pic) || (vk && JOB_PIC[vk]) || (stop && stop.pic) || JOB_PIC[U.rideKind()] || 'tree';
    const x = jobPic.getContext('2d'); x.clearRect(0, 0, 96, 96); if (stop) x.drawImage(wash ? BB.icon('wash', 96) : BB.pic(pic, 96), 0, 0);
    jobDots.innerHTML = '';
    // going to the garage: just its picture; on a job, a dot per stop
    if (job && !wash && !(t && t.id === 'depot')) job.stops.forEach((s, i) => BB.el('i', i < job.index ? 'done' : i === job.index ? 'now' : '', jobDots));
    const word = wash ? 'Wash' : depot ? 'Garage' : (job && JOB_WORD[KIND_OF[job.kind] || KIND_OF[job.vehicle] || U.rideKind()]) || (vk === 'taxi' ? JOB_WORD_TAXI : 'Next stop');
    jobEl.querySelector('.lb').textContent = word;
    // somewhere new to go: the tile gives a little pop, so the eye finds the new picture
    const key = word + '|' + (pic || '') + '|' + (stop ? stop.id : '') + '|' + (job ? job.index : '');
    if (key !== jobKey) { jobKey = key; if (hud && !hud.classList.contains('off')) { jobEl.classList.remove('bump'); void jobEl.offsetWidth; jobEl.classList.add('bump'); } }
  }

  // ---------- Home ----------
  // A trip is in progress: a job, a stop or the drive to the garage. Then a kind card asks first.
  const tripOn = () => { const J = BB.jobs; return !!(J.current || (J.busy && J.busy()) || J.phase === 'toDepot'); };
  U.homeTap = function () {
    if (BB.bedtime || BB.depot.isOpen || U.titleShown()) return;
    U.releaseAll();
    if (!tripOn()) { goHome(); return; }
    U.ask({ pic: 'home', words: 'Go home?', say: 'Go home?', yes: () => goHome(true), no: () => { BB.say('OK! Keep driving!'); } });
  };
  // Back to the home screen (hub and standalone alike): the bus parks at its garage; a job in progress waits there
  // and carries on after Play and Drive (jobs.js resumes it when the garage closes).
  function goHome(asked) {
    if (BB.bedtime) return;
    const J = BB.jobs;
    if (J.phase === 'tow') { BB.say("Let's wait for the tow truck!"); return; }
    BB.sfx.whoosh();
    if (!asked) BB.say('Home!');
    U.fade(() => {
      if (BB.bedtime) return;
      try { if (J.hideQuestion) J.hideQuestion(); } catch (e) { console.error(e); }
      J.wantDepot = false;
      if (J.phase !== 'idle') J.phase = 'home';   // (idle: never driven yet; the first Drive starts the first job)
      try { BB.bus.stopAt(null); } catch (e) { console.error(e); }
      U.showHome({ say: false });
    });
  }
  U.goHome = goHome;
  // A kind question card: {pic: icon name or svg, words, say, yes(), no()}. Big Yes and No, both spoken words.
  let askEl = null;
  U.ask = function (o) {
    U.closeAsk();
    askedIn = BB.events ? BB.events.current : null;    // (the road event this card belongs to, if any: see roadWait)
    const w = askEl = BB.el('div', 'bbu-ask', U.root);
    const card = BB.el('div', 'card', w);
    if (o.pic && o.pic.nodeType === 1) { o.pic.classList.add('pic'); card.appendChild(o.pic); }
    else if (o.pic && o.pic[0] === '<') { const s = BB.el('div', '', null, o.pic).firstChild; s.classList.add('pic'); card.appendChild(s); }
    else if (o.pic) { const c = BB.iconEl(o.pic, 160); c.className = 'pic'; card.appendChild(c); }
    BB.el('div', 'q', card, o.words);
    if (o.extra) card.appendChild(o.extra);
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

  // Driving input from the wheel and pedals and the keyboard (keys win while held). BB.bus.input gets
  // {analog: true, throttle: -1..1, steer: -1..1} plus the old booleans (thresholds) for a bus without analog support;
  // no input object at all: GO falls back to BB.bus.go().
  // Wheel layout: steer = wheel angle / 135 degrees, throttle = GO ? 1 : reverse ? -0.7 : 0.
  const keys = {}, pedals = {}, wheel = { rot: 0, drag: false };
  function current() {
    const throttle = keys.go ? 1 : keys.back ? -1 : pedals.go ? 1 : pedals.back ? -0.7 : 0;
    const steer = keys.left && !keys.right ? -1 : keys.right && !keys.left ? 1 : wheel.rot / 135;
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
    for (const k in pedals) pedals[k] = false;
    for (const b of [pedGo, pedBack]) if (b) { b.classList.remove('down'); b._ptrs.clear(); }
    wheel.drag = false;                   // (the wheel itself eases back to the middle in U.update)
    if (wheelLetGo) wheelLetGo();         // (a finger still down on it no longer steers, nor honks, until it presses again)
    if (wheelEl) wheelEl.classList.remove('grab');
    try { applyInput(); } catch (e) { /* bus not built yet */ }
  };
  U.input = () => { const c = current(); return { throttle: c.throttle, steer: c.steer, go: c.throttle > 0.25, back: c.throttle < -0.25, left: c.steer < -0.3, right: c.steer > 0.3 }; };
  // Lane helper (BB.bus.assist, saved as save.assist): the HUD toggle and the garage's tiles both use this.
  U.setAssist = function (on, quiet) {
    if (!quiet) { BB.save.assistChosen = true; autoAssist = false; }   // (a grown-up chose in the garage's Settings)
    BB.save.assist = !!on; BB.saveNow();
    if (BB.bus) BB.bus.assist = !!on;
    BB.emit('assist:changed', { on: !!on });
    if (!quiet) { BB.sfx.pop(); BB.say(on ? 'Lane helper on!' : 'Lane helper off!'); }
  };
  // The pedals on the left (and the wheel on the right) for left-handed drivers (save.leftHand).
  U.setLefty = function (on, quiet) {
    BB.save.leftHand = !!on; if (!quiet) BB.saveNow();
    if (hud) hud.classList.toggle('lefty', !!on);
    if (!quiet) { BB.sfx.pop(); BB.say(on ? 'Pedals on the left!' : 'Pedals on the right!'); }
  };
  // The steering wheel is the only control (save.control is always 'wheel'; kept for older callers).
  U.setControl = function (mode, quiet) {
    BB.save.control = 'wheel'; if (!quiet) BB.saveNow();
    U.releaseAll(); wheel.rot = 0; showWheel();
    if (hud) hud.classList.add('ctl-wheel');
  };
  // The lane helper is on by default (the owner's choice); only a grown-up's choice in the garage's Settings
  // (save.assistChosen) turns it off.
  let autoAssist = false;
  U.afterBus = function () {
    autoAssist = !BB.save.assistChosen;
    U.setAssist(autoAssist ? true : !!BB.save.assist, true);
  };
  U.facingAway = () => facing && driving;

  // ---------- the home screen ----------
  // opts.say: false = no welcome (the line is said by whoever opened it). The bus parks in front of its garage and the
  // camera swings gently round it ('title').
  U.homeWelcome = () => (BB.xmas ? 'Merry Christmas, Little Bus Captain! Tap Play!' : BB.HUB ? 'Hello, Little Bus Captain! Tap Play!' : 'Welcome, Little Bus Captain! Tap Play!');
  let homeIdle = null, homeCalls = 0;
  U.showHome = function (opts = {}) {
    if (BB.bedtime) return;
    U.closeAsk(); U.releaseAll(); U.hideTips();
    titleEl.style.display = ''; U.root.classList.add('home'); hud.classList.add('off'); U.showExit(true);
    try { if (BB.bus.placeAtDepot) BB.bus.placeAtDepot('title'); else BB.bus.setCamera('title'); } catch (e) { console.error(e); }
    syncFam(); showWish();
    if (opts.say !== false) BB.say(U.homeWelcome());
    homeCalls = 0; if (homeIdle) BB.cancelLater(homeIdle); homeIdle = BB.later(12000, homeNudge);
    BB.emit('home:open');
  };
  function homeNudge() {
    homeIdle = null;
    if (!U.titleShown() || BB.bedtime || homeCalls >= 2) return;
    if (!BB.speaking()) { homeCalls++; playBtn.classList.remove('call'); void playBtn.offsetWidth; playBtn.classList.add('call'); BB.say('Tap Play to go to your garage!'); }
    homeIdle = BB.later(homeCalls ? 18000 : 4000, homeNudge);
  }
  // The wish on the home screen: the ride the child is saving up for (BB.depot.wish(): the locked ride tapped last in
  // the garage, or the cheapest one not bought yet), with a bar that fills as the coins come in. A tap says how many
  // more coins it takes, or that there are enough (and Play gives a wiggle: the garage is that way). No card once
  // every ride is theirs. Nothing here may ever keep the home screen from opening, hence the try/catch.
  function showWish() {
    if (!wishEl) return;
    let w = null; try { w = BB.depot.wish && BB.depot.wish(); } catch (e) { console.error(e); }
    wishEl.style.display = 'none'; wishEl.innerHTML = '';
    if (!w) return;
    try {
      const src = w.pic(), c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0);
      c.className = 'ride'; wishEl.appendChild(c);
      const row = BB.el('span', 'row', wishEl), fill = BB.el('i', '', BB.el('span', 'bar', row));
      if (w.need > 0) { row.appendChild(BB.iconEl('coin', 64)); BB.el('b', '', row, String(w.need)); } else BB.el('span', 'ok', row);
      wishEl.classList.toggle('ready', w.need <= 0);
      wishEl.setAttribute('aria-label', w.need > 0 ? `${w.need} more coins for the ${w.name}` : `Enough coins for the ${w.name}`);
      wishEl.style.display = '';
      const share = Math.round(100 * BB.clamp((w.price - w.need) / w.price, 0, 1));
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = share + '%'; }));   // (the bar fills up as the screen opens)
    } catch (e) { console.error(e); wishEl.style.display = 'none'; }
  }
  function wishTap() {
    let w = null; try { w = BB.depot.wish && BB.depot.wish(); } catch (e) { /* none */ }
    if (!w) return;
    BB.sfx.pop();
    if (w.need > 0) { BB.say(`${w.need} more ${w.need === 1 ? 'coin' : 'coins'} for the ${w.name}!`); return; }
    BB.say(`You have enough coins for the ${w.name}! It is in the garage!`);
    playBtn.classList.remove('call'); void playBtn.offsetWidth; playBtn.classList.add('call');
  }
  U.hideHome = function () { titleEl.style.display = 'none'; U.root.classList.remove('home'); U.showExit(false); if (homeIdle) { BB.cancelLater(homeIdle); homeIdle = null; } };
  // Play: to the garage. A job that was waiting (Home in the middle of one) carries on after Drive.
  U.play = function () {
    if (BB.bedtime || !U.titleShown()) return;
    BB.sfx.pop();
    U.hideHome();
    const J = BB.jobs;
    if (J.phase === 'home') J.phase = 'depot';
    BB.depot.open({ start: true });
  };
  U.homeShown = () => titleEl.style.display !== 'none';
  U.titleShown = U.homeShown;
  U.showTitle = () => U.showHome(); U.hideTitle = () => U.hideHome();
  // the family strip: the family's status picture and the buses here now (BB.net.status(), BB.net.friends())
  const miniCache = {};
  function miniBus(type, paint) {
    const k = type + paint; if (miniCache[k]) return miniCache[k];
    const c = document.createElement('canvas'); c.width = 96; c.height = 64;
    const x = c.getContext('2d'); x.scale(96 / 100, 64 / 66);
    const col = (BB.PAINTS.find((p) => p.id === paint) || BB.PAINTS[0]).color;
    BB.sideBus(x, 6, type === 'double' ? 12 : 0, 1.02, col, type);
    return (miniCache[k] = c);
  }
  U.miniBus = (type, paint, color) => { const src = (BB.net && BB.net.mini && BB.fleet.KIND[type] && BB.fleet.KIND[type] !== 'bus') ? BB.net.mini(type, paint, color) : miniBus(type, paint), c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); return c; };
  U.family = function () {
    const N = BB.net; if (!N || typeof N.status !== 'function' || typeof N.friends !== 'function') return null;
    let status, friends;
    try { status = N.status(); friends = N.friends() || []; } catch (e) { console.error(e); return null; }
    if (status === 'together' && !friends.length) status = 'alone';
    return { status, friends };
  };
  let famKey = '';
  function syncFam() {
    const f = U.family();
    const key = f ? f.status + ':' + f.friends.map((x) => x.id + x.type + x.paint + x.color + x.routeNo).join(',') : 'none';
    if (key === famKey && famEl.firstChild) return;
    famKey = key; famEl.innerHTML = '';
    // (playing together is automatic: just a little picture of who is here, no button; nothing when nobody is)
    if (!f || f.status !== 'together' || !f.friends.length) return;
    const b = BB.el('div', 'ind', famEl); b.setAttribute('aria-label', `${f.friends.length} friends`);
    const col = BB.el('span', 'col', b);
    col.appendChild(BB.iconEl('world', 128)); BB.el('span', 'lb', col, 'Friends');
    BB.el('span', 'cnt', b, String(f.friends.length));   // (how many friends)
    for (const fr of f.friends.slice(0, 4)) { const d = BB.el('span', 'bus', b); d.appendChild(U.miniBus(fr.type, fr.paint, fr.color)); BB.el('b', '', d, String(fr.routeNo || '')); }
    if (f.friends.length > 4) BB.el('span', 'more', b, '+' + (f.friends.length - 4));
  }
  U.showExit = function (on) { if (exitBtn) exitBtn.style.display = on && !BB.hub.slept && !BB.bedtime ? '' : 'none'; };
  // hide everything for the goodnight moment
  U.hideAll = function () { U.closeBook(); U.hideHome(); hud.classList.add('off'); U.showExit(false); U.closeAsk(); U.releaseAll(); };

  // ---------- the spotter book ----------
  // "Things I spotted" (events.js: 'spot' {id, name} the first time each special vehicle or sight is seen; BB.events.seen)
  // and "My passenger friends" (jobs.js: J.FRIENDS, J.friendsMet(), 'friend:met'). Found ones are picture stickers
  // (tap: the name), the rest grey "?" outlines. Something new while driving: a "New sticker!" pop, never over a question.
  const SPOTS = [['fireTruck', 'Fire truck'], ['ambulance', 'Ambulance'], ['police', 'Police car'], ['towTruck', 'Tow truck'], ['iceCream', 'Ice cream van'],
    ['milkVan', 'Milk van'], ['rubbishTruck', 'Rubbish truck'], ['otters', 'Otters'], ['parade', 'Parade'], ['fireworks', 'Fireworks'], ['plane', 'Aeroplane']];
  const FRIEND_LOOK = { granny: { shirt: P.plum, skin: '#f1c7a0', hair: '#e8e4dc', bun: true }, kai: { shirt: '#f28b4b', skin: '#d9a679', hair: '#1f1b22' },
    rose: { shirt: P.leaf, skin: '#a8714a', hair: '#3a2a2c', bun: true }, tan: { shirt: '#9fb6c8', skin: '#f5d3b5', hair: '#8a8290' } };
  // (events.js: BB.events.NAMES {id: name} and seen {id: times}; also saved as BB.save.spotted)
  function spotList() {
    const N = BB.events && BB.events.NAMES;
    const list = N && typeof N === 'object' ? Object.keys(N).map((id) => [id, N[id]]) : SPOTS.slice();
    // (the secret, three quick honks: only in the book once found, so it stays a secret)
    if (BB.save.spotted && BB.save.spotted.turbo && !list.some((q) => q[0] === 'turbo')) list.push(['turbo', 'Secret turbo']);
    return list;
  }
  function spotSeen() {
    const out = new Set();
    for (const src of [BB.save.spotted, BB.events && BB.events.seen]) {
      try {
        if (src instanceof Set || Array.isArray(src)) src.forEach((v) => out.add(v));
        else if (src && typeof src === 'object') for (const k in src) if (src[k]) out.add(k);
      } catch (e) { /* ignore */ }
    }
    return out;
  }
  function friendList() {
    const J = BB.jobs, list = (J && Array.isArray(J.FRIENDS)) ? J.FRIENDS : [];
    let met = [];
    try { met = J && typeof J.friendsMet === 'function' ? J.friendsMet() : (BB.save.friendsMet || []); } catch (e) { met = []; }
    return list.map((f) => ({ id: f.id, name: f.name, prop: f.prop, look: f.look || FRIEND_LOOK[f.id], met: met.includes(f.id) }));
  }
  let bookEl = null, freshIds = new Set();
  U.closeBook = function () { if (bookEl) { bookEl.remove(); bookEl = null; } };
  U.openBook = function () {
    U.closeBook(); U.releaseAll();
    const w = bookEl = BB.el('div', 'bbu-book', U.root), bk = BB.el('div', 'bk', w);
    const x = BB.el('button', 'x', bk); x.type = 'button'; x.appendChild(BB.iconEl('cross', 96)); BB.el('span', 'lb', x, 'Close'); x.setAttribute('aria-label', 'Close');
    BB.tap(x, () => { BB.sfx.click(); U.closeBook(); });
    BB.tap(w, (e) => { if (e.target === w) U.closeBook(); });
    const page = (icon, title, cols, items) => {
      const pg = BB.el('div', 'pg', bk), h = BB.el('h3', '', pg);
      h.appendChild(icon); BB.el('span', '', h, title);
      BB.el('span', 'count', h, `${items.filter((i) => i.found).length}/${items.length}`);
      const g = BB.el('div', 'grid', pg); g.style.gridTemplateColumns = `repeat(${cols}, var(--sk))`;
      for (const it of items) {
        const b = BB.el('button', 'stk' + (freshIds.has(it.id) ? ' fresh' : ''), g); b.type = 'button';
        if (it.found) {
          const src = it.pic(), c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0);
          b.appendChild(c); BB.el('span', 'lb', b, it.name); b.setAttribute('aria-label', it.name);
        }
        else { BB.el('span', 'q', b, '?'); BB.el('span', 'lb', b, ''); b.setAttribute('aria-label', 'not found yet'); }
        BB.tap(b, () => { BB.sfx.pop(); BB.say(it.found ? it.name + '!' : it.missing); });
      }
    };
    const seen = spotSeen();
    page(BB.spotPic('fireTruck', 64), 'Things I spotted', 4, spotList().map(([id, name]) => ({ id, name, found: seen.has(id), pic: () => BB.spotPic(id, 160), missing: 'Not found yet! Keep your eyes open when you drive!' })));
    const fl = friendList();
    page(BB.friendPic({ id: 'granny', look: FRIEND_LOOK.granny, prop: 'cat' }, 64), 'My passenger friends', fl.length > 6 ? 4 : fl.length > 4 ? 3 : 2, fl.map((f) => ({ id: 'friend-' + f.id, name: f.name, found: f.met, pic: () => BB.friendPic(f, 160), missing: 'Not met yet! Maybe they will get on your bus one day!' })));
    freshIds.clear();
    BB.sfx.page();
    BB.say('My sticker book!');
  };
  // something new: remember it, then a "New sticker!" pop at a calm moment
  const newQueue = [];
  function calmForPop() {
    if (BB.bedtime || BB.held || !hud || hud.classList.contains('off') || BB.depot.isOpen || U.titleShown() || askEl || bookEl) return false;
    const J = BB.jobs; if ((J.busy && J.busy()) || J.phase === 'question' || document.querySelector('.bbq')) return false;
    return true;
  }
  function popNext() {
    // (not while the job-done banner is up: on phones the two overlapped; it pops just after)
    if (!newQueue.length || document.querySelector('.bbu-newst') || document.querySelector('.bbj') || !calmForPop()) return;
    const it = newQueue.shift();
    const el = BB.el('div', 'bbu-newst', U.root); el.appendChild(it.pic()); BB.el('span', '', el, 'New sticker!');
    BB.sfx.page(); BB.later(250, () => BB.sfx.sparkle());
    BB.say(`New sticker! ${it.name}!`, { queue: true });
    BB.later(2900, () => el.remove());
  }
  setInterval(popNext, 1000);
  function gotSticker(id, name, pic) {
    if (newQueue.some((q) => q.id === id)) return;
    freshIds.add(id);
    newQueue.push({ id, name, pic: () => { const src = pic(), c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); return c; } });
    popNext();
  }
  BB.on('spot', (d) => {
    if (!d || !d.id) return;
    if (!BB.events) {                 // (events.js keeps the record itself; without it, a note here)
      const m = BB.save.spotted && typeof BB.save.spotted === 'object' && !Array.isArray(BB.save.spotted) ? BB.save.spotted : (BB.save.spotted = {});
      if (m[d.id]) return;
      m[d.id] = 1; BB.saveNow();
    }
    gotSticker(d.id, d.name || (SPOTS.find((q) => q[0] === d.id) || [0, d.id])[1], () => BB.spotPic(d.id, 128));
  });
  BB.on('friend:met', (d) => {
    if (!d || !d.id) return;
    const f = friendList().find((x) => x.id === d.id) || { id: d.id, name: d.name };
    gotSticker('friend-' + d.id, d.name || f.name, () => BB.friendPic(f, 128));
  });

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
  U.confetti = function (share = 1) {
    const cols = [P.coral, P.honey, P.teal, P.berry, P.leaf, P.rose];
    for (let i = 0; i < Math.round(40 * share); i++) {
      const c = BB.el('div', 'bbu-confetti' + (BB.xmas && i % 3 ? (i % 3 === 1 ? ' flake' : ' star') : ''), U.root);
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
    // one scale both ways (never squashed), centred: a true half circle on a 120 x 60 board
    const x = fuelCv.getContext('2d'), sc = Math.min(fuelCv.width / 120, fuelCv.height / 60);
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, fuelCv.width, fuelCv.height);
    x.setTransform(sc, 0, 0, sc, (fuelCv.width - 120 * sc) / 2, (fuelCv.height - 60 * sc) / 2);
    // E at the left end of the half circle, F at the right end; the needle turns in step with the fuel (0..1)
    const cx = 60, cy = 53, R = 46, a0 = Math.PI, a1 = 2 * Math.PI, at = (t) => a0 + (a1 - a0) * t;
    x.lineCap = 'round';
    x.lineWidth = 10; x.strokeStyle = '#eadfca'; x.beginPath(); x.arc(cx, cy, R, a0, a1); x.stroke();
    x.save();
    if (low) { x.shadowColor = 'rgba(255,90,60,' + (blink ? 0.9 : 0.35) + ')'; x.shadowBlur = blink ? 10 : 4; }
    x.strokeStyle = '#ff6b5c'; x.beginPath(); x.arc(cx, cy, R, a0, at(0.2)); x.stroke();
    x.restore();
    x.strokeStyle = '#5cb85c'; x.beginPath(); x.arc(cx, cy, R, at(0.8), a1); x.stroke();
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
  // Is something on the road asking the bus to wait right now? Only the moments where waiting is the right thing:
  // an otter family on the crossing just ahead ("Stop! Let the otters cross!"), an ambulance coming past ("Make
  // way!") until it is by, the bus stopped beside the ice cream truck ("Stop near the truck for a treat!") until
  // the treat has been offered, and a look up at the fireworks or a plane. The other events (the broken-down car,
  // the milk van, the parade, ...) go on round the bus, and driving on is fine. (Read from BB.events' current event
  // and its spots(); jobs.js can use BB.ui.roadWait() too, so its spoken hints never say "go" while the road says
  // "wait".)
  let askedIn = null;
  function roadWait() {
    const E = BB.events, B = BB.bus, id = E && E.active && E.active();
    if (!id || !B || !B.pos) return false;
    if (B.isLooking && B.isLooking()) return true;
    if (id !== 'otters' && id !== 'ambulance' && id !== 'iceCream') return false;
    let q = null; try { q = E.current && E.current.spots && E.current.spots(); } catch (e) { return false; }
    const s = q && q[0]; if (!s) return false;                  // (the otters: none on the crossing now)
    const dx = s[1] - B.pos.x, dz = s[3] - B.pos.z, d = Math.sqrt(dx * dx + dz * dz);
    if (id === 'otters') return d < 60;
    if (id === 'iceCream') return d < 30 && askedIn !== E.current;
    return d < 50 && dx * Math.sin(B.heading) + dz * Math.cos(B.heading) < 8;   // the ambulance: close, not yet by
  }
  U.roadWait = () => { try { return roadWait(); } catch (e) { return false; } };
  // Two small cues while driving (both on the game clock, so they stand still on a hold):
  //  - the bus could go but has stood still with no foot on a pedal for a few seconds: the thing to press next lights
  //    up with a gold rim, so a child who can't read (or missed the words) sees it: the Go pedal, or the Turn around
  //    tile instead while that is offered (only one of them, never both). Never while the road asks the bus to wait
  //    (roadWait above); the few seconds start again once it is over;
  //  - backing up beeps softly, like a real bus (and tells the ears that the orange pedal goes backwards).
  let idleGo = 0, goGlow = 0, backBeep = 0, waitTick = 0, waiting = false;
  function driveCues(dt) {
    const B = BB.bus;
    const can = driving && hud && !hud.classList.contains('off') && !askEl && !bookEl && !BB.bedtime && B.camMode === 'chase' && !B.atStop && !B.locked && !B.noFuel && !B.doorsOpen;
    const foot = pedals.go || pedals.back || keys.go || keys.back;
    const still = can && !foot && Math.abs(B.speed) < 0.3;
    if (!still) waitTick = 0;
    else if ((waitTick -= dt) <= 0) { waitTick = 0.2; waiting = U.roadWait(); }   // (5 times a second is plenty)
    idleGo = still && !waiting ? idleGo + dt : 0;
    // 0: nothing, 1: the Go pedal, 2: the Turn around tile (shown while the bus faces away, see syncUturn)
    const glow = idleGo > 4 ? (uturnBtn && uturnBtn.classList.contains('on') ? 2 : 1) : 0;
    if (glow !== goGlow) { goGlow = glow; if (pedGo) pedGo.classList.toggle('idle', glow === 1); if (uturnBtn) uturnBtn.classList.toggle('idle', glow === 2); }
    if (can && (pedals.back || keys.back) && B.speed < -0.6) { backBeep -= dt; if (backBeep <= 0) { backBeep = 0.64; BB.sfx.backBeep(); } }
    else backBeep = 0;
  }
  U.update = function (dt) {
    if (!wheel.drag && wheel.rot !== 0) {            // the wheel eases back to the middle
      wheel.rot = Math.abs(wheel.rot) < 0.5 ? 0 : wheel.rot * Math.max(0, 1 - (dt || 0.016) * 7);
      showWheel(); applyInput();
    }
    driveCues(dt || 0.016);
    const f = BB.bus.fuel;
    needle = needle < 0 ? f : needle + (f - needle) * Math.min(1, (dt || 0.016) * 3);
    const low = f <= BB.cfg.fuelLow;
    gaugeT += dt || 0.016;
    const blink = low && Math.floor(gaugeT * 2.5) % 2 === 0;
    const key = Math.round(needle * 400) + (low ? 'L' : '') + (blink ? 'B' : '') + fuelCv.clientWidth;
    if (key !== gaugeKey && !hud.classList.contains('off')) { gaugeKey = key; drawGauge(needle, low, blink); }
  };
})();
