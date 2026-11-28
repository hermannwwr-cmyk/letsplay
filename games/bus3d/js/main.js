/* Bendy Bus 3D: boot, renderer, resize, main loop, and the hub-mode flow.
   Boot order: core.js (BB, audio, storage) -> world -> jobs -> depot -> ui -> bus -> net (family) -> home screen -> hub hello.
   The loop pauses while the page is hidden or the hub holds the game (BB.held); one error in a frame is logged and
   the next frame carries on. Hub mode (only with ?hub=1 in a frame, see /CLAUDE.md): the last-minute warning between
   stops, the goodnight moment once time is up (after the stop in progress), stars, the evening sky. */
(function () {
  'use strict';
  const BB = window.BB;

  function fail(msg) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font:700 28px system-ui;color:#3a2a3c;background:#fdebc8;text-align:center;padding:20px';
    d.textContent = msg; document.body.appendChild(d);
  }
  const safe = (fn) => { try { fn(); } catch (e) { console.error(e); } };

  function boot() {
    const canvas = document.getElementById('c');
    const dpr = Math.min(window.devicePixelRatio || 1, BB.cfg.pixelRatioCap);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 2, powerPreference: 'high-performance' });
    } catch (e) { fail('Oops! This device cannot draw the 3D bus.'); return; }
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0xf9e8c8);
    BB.renderer = renderer;
    BB.scene = new THREE.Scene();
    BB.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 900);

    BB.world.build(BB.scene);
    BB.jobs.init();
    BB.depot.init();
    BB.ui.init();
    BB.bus.build();
    // playing together is automatic (public world rooms); the private family room is no longer offered, so a device
    // that joined one earlier goes back to the shared town
    if (BB.net) safe(() => { if (typeof BB.net.mode === 'function' && BB.net.mode() === 'family' && typeof BB.net.setMode === 'function') BB.net.setMode('world'); });
    if (BB.net) safe(() => BB.net.init());
    if (BB.depot.afterBus) BB.depot.afterBus();
    // Christmas (BB.xmas, core.js): the town dresses up when world.js knows how
    const xmasWorld = () => safe(() => { if (BB.world.setXmas) BB.world.setXmas(!!BB.xmas); });
    xmasWorld(); BB.on('xmas:changed', xmasWorld);

    resize();
    addEventListener('resize', resize);
    addEventListener('orientationchange', () => setTimeout(resize, 200));
    document.addEventListener('visibilitychange', () => BB.setHeld('hidden', document.hidden));
    BB.setHeld('hidden', document.hidden);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    BB.update = function (dt) {
      BB.world.update(dt);
      BB.bus.update(dt);
      BB.jobs.update(dt);
      if (BB.depot.update) BB.depot.update(dt);
      BB.ui.update(dt);
      if (BB.net) BB.net.update(dt);
      if (BB.HUB) hubUpdate(dt);
    };
    BB.render = () => renderer.render(BB.scene, BB.camera);

    // The game starts on its home screen: the bus parked at its garage, ONE big Play button (to the garage, where the
    // child makes their bus and taps Drive), and in hub mode the all-games button.
    safe(() => { if (BB.bus.placeAtDepot) BB.bus.placeAtDepot('title'); });
    if (BB.ui.afterBus) BB.ui.afterBus();
    BB.ui.showHome({ say: false });
    // The welcome is said as the home screen opens; iOS blocks speech before a first tap, so if it wasn't heard it is
    // said (queued) after the first tap while the home screen is still showing.
    const welcome = BB.ui.homeWelcome();
    BB.say(welcome);
    let welcomeAgain = false;            // at most once, and only if it never started and isn't still queued
    BB.on('audio:unlocked', () => BB.later(0, () => {
      if (welcomeAgain || !BB.ui.homeShown() || BB.heard(welcome) || BB.pending(welcome)) return;
      welcomeAgain = true; BB.say(welcome, { queue: true });
    }));
    let started = false;                 // once, however many taps arrive
    BB.on('depot:closed', (d) => {
      if (!d || d.home || BB.bedtime) return;
      const first = !!d.start && !started;
      if (first) {
        started = true;
        BB.music.start();
        // a short hello if the welcome was never heard, then how to drive, queued so nothing cuts in
        if (!BB.heard(welcome)) BB.say('Hello, driver!');
        BB.say(BB.ui.driveTip ? BB.ui.driveTip() : 'Hold the green pedal to go! Turn the wheel to steer!', { queue: true });
        if (BB.ui.showTips) BB.ui.showTips();
      }
      // no job yet (the first drive, or Home before the first job began): one starts shortly, unless the child went
      // back to the garage or the home screen meanwhile (a job that was waiting is picked up by jobs.js instead)
      if (BB.jobs.phase === 'idle' && !BB.jobs.current) {
        BB.later(first ? 2200 : 1200, () => {
          if (!BB.bedtime && !BB.depot.isOpen && !BB.ui.homeShown() && BB.jobs.phase === 'idle' && !BB.jobs.current) BB.jobs.start();
        });
      }
    });
    BB.on('audio:unlocked', () => { if (BB.music.on) BB.music.start(); });

    let last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      if (BB.held) { last = now; adaptQuality(-1); return; }
      const raw = now - last;
      const dt = Math.min(0.05, Math.max(0, raw / 1000));
      last = now;
      adaptQuality(raw);
      try { BB.update(dt); } catch (e) { console.error(e); }
      try { BB.render(); } catch (e) { console.error(e); }
    }
    requestAnimationFrame(frame);

    if (BB.HUB) hubSetup();
  }

  // Smooth on older iPads: the sharpest screens draw ~4 million pixels a frame. When frames keep coming slowly (below
  // ~40 a second for about 3 s of play), the game draws at a slightly lower resolution (2 -> 1.6 -> 1.3 -> 1 pixel per
  // screen point; hardly visible on a tablet), and steps back up after a long smooth spell (at most a few times, so it
  // never see-saws). Pauses, hidden pages and the first seconds (shaders compiling) don't count.
  const DPR_STEPS = [2, 1.6, 1.3, 1];
  let dprStep = 0, slowT = 0, fastT = 0, ema = 16.7, ups = 0, warm = 4;
  const deviceDpr = () => Math.min(window.devicePixelRatio || 1, BB.cfg.pixelRatioCap);
  function adaptQuality(ms) {
    if (ms < 0 || ms > 1000) { fastT = 0; return; }          // (held, hidden, or a long one-off pause)
    if (warm > 0) { warm -= ms / 1000; return; }
    ema += (Math.min(ms, 100) - ema) * 0.06;
    const s = ms / 1000;
    slowT = ema > 25 ? slowT + s : Math.max(0, slowT - s);
    fastT = ema < 14 ? fastT + s : 0;
    if (slowT > 3 && dprStep < DPR_STEPS.length - 1 && DPR_STEPS[dprStep + 1] < deviceDpr()) { dprStep++; changed(); }
    else if (fastT > 25 && dprStep > 0 && ups < 2) { dprStep--; ups++; changed(); }
    function changed() { slowT = fastT = 0; ema = 16.7; warm = 1; resize(); }
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // pixel ratio can change (zoom, moving to another screen); capped at 2, and lower while frames are slow (above)
    const dpr = Math.min(deviceDpr(), DPR_STEPS[dprStep]);
    if (BB.renderer.getPixelRatio() !== dpr) BB.renderer.setPixelRatio(dpr);
    BB.renderer.setSize(w, h);
    const aspect = w / Math.max(1, h);
    BB.camera.aspect = aspect;
    BB.camera.fov = aspect < 1 ? 66 : aspect > 1.9 ? 44 : 50;
    BB.camera.updateProjectionMatrix();
    // In the hub's frame env(safe-area-inset-*) is 0, so on a phone held sideways keep clear of the notch ourselves.
    // (Only notched phones are that wide, about 2.1 : 1; an iPhone SE, 16 : 9, has no notch and needs every pixel.)
    const phoneSide = aspect > 1.9 && h <= 500;
    document.documentElement.style.setProperty('--padx', BB.HUB && phoneSide ? '44px' : '0px');
    BB.emit('resize', { w, h });
  }

  // ---------- hub mode flow ----------
  const H = BB.hub;
  let warned = false, warnPending = false, zeroT = 0, stopsSinceZero = 0;
  const CALM = { idle: 1, done: 1, depot: 1, toDepot: 1, toPump: 1, bedtime: 1, home: 1 };   // (toPump: the drive to the fuel pump stops for bed)
  function hubSetup() {
    BB.on('hub:time', () => {
      if (BB.world.setSky && !BB.bedtime) safe(() => BB.world.setSky(H.share));
      if (!(H.limit > 0 && H.left != null) || H.left > 60) { warned = false; warnPending = false; }
      else if (H.left > 0 && !warned) { warned = true; warnPending = true; }
      if (!H.timeUp()) { zeroT = 0; stopsSinceZero = 0; }
    });
    BB.on('job:stopDone', () => { if (H.timeUp()) stopsSinceZero++; });
    BB.on('job:done', () => H.post({ hub: 'stars', count: BB.save.jobsDone | 0 }));
    // everything is set up: say hello (and how many jobs we've done, for the stars on the launcher)
    H.post({ hub: 'hello', game: 'bus' });
    if (BB.save.jobsDone > 0) H.post({ hub: 'stars', count: BB.save.jobsDone | 0 });
  }
  function hubUpdate(dt) {
    if (BB.bedtime || H.paused) return;
    const J = BB.jobs, ph = J.phase;
    // (the bus wash too: its pay card and the wash show finish first, then goodnight)
    // (and the job-done banner: a trophy is shown and said in full before the goodnight, never under the night)
    const busy = (J.busy && J.busy()) || ph === 'question' || ph === 'stop' || ph === 'tow' || ph === 'done' || !!(BB.ui.washBusy && BB.ui.washBusy());
    // the last-minute warning waits for a calm moment between stops, never over a question or the counting
    if (warnPending && !H.timeUp() && !busy && !BB.depot.isOpen && !BB.ui.homeShown()) {
      warnPending = false;
      BB.ui.toast('🌙', 2600);
      BB.say('The bus is getting sleepy. Nearly time for bed!', { queue: true });
    }
    if (!H.timeUp()) return;
    zeroT += dt;
    // time is up: finish the stop in progress, then goodnight (never in the middle of a question)
    const calm = CALM[ph] || ph === undefined || (ph === 'drive' && (stopsSinceZero > 0 || zeroT > 120));
    if (calm && !busy) goodnight();
  }
  // Goodnight: the last passengers get off, the bus parks with its lights off under a night sky, says
  // "Goodnight, bus!", snores a little, and then we tell the hub (which shows everyone asleep). Once.
  async function goodnight() {
    if (BB.bedtime) return;
    BB.bedtime = true;
    if (BB.net) safe(() => BB.net.goodnight());           // friends see the bus park and its lights go off
    const J = BB.jobs, B = BB.bus;
    J.phase = 'bedtime'; J.wantDepot = false;
    safe(() => { if (J.hideQuestion) J.hideQuestion(); });
    safe(() => { if (BB.depot.isOpen) BB.depot.close(); });
    safe(() => { B.stopAt(null); B.go(false); B.locked = true; });
    BB.ui.hideAll();
    BB.music.stop();
    BB.say('Time for bed, little bus!', { queue: true });   // queued: never cuts off "Sparkly clean!" or a stop's last line
    for (let i = 0; i < 40 && B.speed > 0.2; i++) await BB.wait(100);
    if ((B.passengers | 0) > 0 && J.allOff) {
      // the last passengers really walk off and away (at most ~15 s, then carry on regardless)
      await new Promise((res) => { let done = false; const fin = () => { if (!done) { done = true; res(); } }; BB.later(15000, fin); try { J.allOff(fin); } catch (e) { console.error(e); fin(); } });
      BB.say('Bye bye! Thank you, bus!', { queue: true });
      await BB.wait(500);
      safe(() => B.closeDoors());
    } else if ((B.passengers | 0) > 0) {
      B.openDoors();
      await BB.wait(700);
      BB.say('Bye bye! Thank you, bus!', { queue: true });
      while ((B.passengers | 0) > 0) { B.passengers--; BB.sfx.pop(); await BB.wait(380); }
      await BB.wait(400);
      safe(() => { B.doorsOpen = false; BB.sfx.door(); });
    }
    safe(() => B.setCamera('title'));
    safe(() => { if (B.setLights) B.setLights(false); });
    safe(() => { if (BB.world.setSky) BB.world.setSky(1); });
    BB.ui.night(true);
    BB.sfx.lullaby();
    await BB.wait(1600);
    await BB.say('Goodnight, bus!');
    BB.sfx.snore();
    await BB.wait(2600);
    if (BB.net) safe(() => BB.net.leave('sleep'));
    H.sleep();
  }
  BB.goodnight = goodnight;

  if (typeof THREE === 'undefined') fail('Oops! The 3D bits did not load.');
  else boot();
})();
