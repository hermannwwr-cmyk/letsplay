/* Bendy Bus 3D: boot, renderer, resize, main loop, and the hub-mode flow.
   Boot order: core.js (BB, audio, storage) -> world -> jobs -> depot -> ui -> bus -> title screen -> hub hello.
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
    if (BB.depot.afterBus) BB.depot.afterBus();

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
      if (BB.HUB) hubUpdate(dt);
    };
    BB.render = () => renderer.render(BB.scene, BB.camera);

    // The game starts in the bus garage: the child makes their bus (type, colour, number, parts), then taps Drive.
    safe(() => { if (BB.bus.placeAtDepot) BB.bus.placeAtDepot(); });
    if (BB.ui.afterBus) BB.ui.afterBus();
    BB.depot.open({ start: true });
    safe(() => BB.bus.updateCamera && BB.bus.setCamera('depot', true));
    // The welcome is said as the garage opens; iOS blocks speech before a first tap, so if it wasn't heard it is
    // said (queued) after the first tap while the start garage is still open.
    const welcome = BB.depot.welcome();
    let welcomeAgain = false;            // at most once, and only if it never started and isn't still queued
    BB.on('audio:unlocked', () => BB.later(0, () => {
      if (welcomeAgain || !BB.depot.isOpen || !BB.depot.isStart || BB.heard(welcome) || BB.pending(welcome)) return;
      welcomeAgain = true; BB.say(welcome, { queue: true });
    }));
    let started = false;                 // once, however many taps arrive
    BB.on('depot:closed', (d) => {
      if (!d || !d.start || started || BB.bedtime) return;
      started = true;
      BB.music.start();
      // a short hello if the welcome was never heard, then how to drive, queued so nothing cuts in
      if (!BB.heard(welcome)) BB.say('Hello, driver!');
      BB.say(BB.ui.driveTip ? BB.ui.driveTip() : 'Push up to go! Slide to steer!', { queue: true });
      if (BB.ui.showTips) BB.ui.showTips();
      BB.later(2200, () => { if (!BB.bedtime) BB.jobs.start(); });
    });
    BB.on('audio:unlocked', () => { if (BB.music.on) BB.music.start(); });

    let last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      if (BB.held) { last = now; return; }
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      try { BB.update(dt); } catch (e) { console.error(e); }
      try { BB.render(); } catch (e) { console.error(e); }
    }
    requestAnimationFrame(frame);

    if (BB.HUB) hubSetup();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // pixel ratio can change (zoom, moving to another screen); cap it at 2
    const dpr = Math.min(window.devicePixelRatio || 1, BB.cfg.pixelRatioCap);
    if (BB.renderer.getPixelRatio() !== dpr) BB.renderer.setPixelRatio(dpr);
    BB.renderer.setSize(w, h);
    const aspect = w / Math.max(1, h);
    BB.camera.aspect = aspect;
    BB.camera.fov = aspect < 1 ? 66 : aspect > 1.9 ? 44 : 50;
    BB.camera.updateProjectionMatrix();
    // In the hub's frame env(safe-area-inset-*) is 0, so on a phone held sideways keep clear of the notch ourselves.
    const phoneSide = aspect > 1.75 && h <= 500;
    document.documentElement.style.setProperty('--padx', BB.HUB && phoneSide ? '44px' : '0px');
    BB.emit('resize', { w, h });
  }

  // ---------- hub mode flow ----------
  const H = BB.hub;
  let warned = false, warnPending = false, zeroT = 0, stopsSinceZero = 0;
  const CALM = { idle: 1, done: 1, depot: 1, toDepot: 1, bedtime: 1 };
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
    const busy = (J.busy && J.busy()) || ph === 'question' || ph === 'stop' || ph === 'tow';
    // the last-minute warning waits for a calm moment between stops, never over a question or the counting
    if (warnPending && !H.timeUp() && !busy && !BB.depot.isOpen && !BB.ui.titleShown()) {
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
    const J = BB.jobs, B = BB.bus;
    J.phase = 'bedtime'; J.wantDepot = false;
    safe(() => { if (J.hideQuestion) J.hideQuestion(); });
    safe(() => { if (BB.depot.isOpen) BB.depot.close(); });
    safe(() => { B.stopAt(null); B.go(false); B.locked = true; });
    BB.ui.hideAll();
    BB.music.stop();
    BB.say('Time for bed, little bus!');
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
    H.sleep();
  }
  BB.goodnight = goodnight;

  if (typeof THREE === 'undefined') fail('Oops! The 3D bits did not load.');
  else boot();
})();
