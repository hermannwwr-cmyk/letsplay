/* Bendy Bus 3D: boot, renderer, resize, main loop.
   Boot order: core.js (BB, audio, storage) -> world -> jobs -> depot -> ui -> bus -> title screen -> hub hello.
   The loop pauses while the page is hidden or the hub holds the game (BB.held). */
(function () {
  'use strict';
  const BB = window.BB;

  function fail(msg) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font:700 28px system-ui;color:#3a2a3c;background:#fdebc8;text-align:center;padding:20px';
    d.textContent = msg; document.body.appendChild(d);
  }

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
      BB.ui.update(dt);
    };
    BB.render = () => renderer.render(BB.scene, BB.camera);

    // title screen: the bus at the depot, the camera slowly circling
    BB.bus.setCamera('title', true);
    BB.ui.showTitle();
    BB.say(BB.HUB ? 'Tap to drive!' : 'Hello! Tap to drive the bendy bus!');
    BB.on('title:start', () => {
      BB.bus.setCamera('chase');
      BB.music.start();
      BB.say("Let's drive! Hold the GO button.");
      BB.later(2200, () => BB.jobs.start());
    });
    BB.on('audio:unlocked', () => { if (BB.music.on) BB.music.start(); });

    let last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      if (BB.held) { last = now; return; }
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      try { BB.update(dt); } catch (e) { console.error(e); }
      BB.render();
    }
    requestAnimationFrame(frame);

    // hub mode: say hello at the end of setup (TODO(hub-mode builder): the rest of hub mode)
    BB.hub.post({ hub: 'hello', game: 'bus' });
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    BB.renderer.setSize(w, h);
    const aspect = w / Math.max(1, h);
    BB.camera.aspect = aspect;
    BB.camera.fov = aspect < 1 ? 66 : aspect > 1.9 ? 44 : 50;
    BB.camera.updateProjectionMatrix();
  }

  if (typeof THREE === 'undefined') fail('Oops! The 3D bits did not load.');
  else boot();
})();
