/* Little Bus Captain: hands-on moments and the water spray.
   BB.hands: one finger-driven moment at a time, laid over the 3D scene (a DOM layer inside #ui, under the HUD and the
   question card). While a question's story is told, the child DOES its "k" part: taps each friend aboard, drags each
   bag to the taxi, aims the fire hose at the smoky windows, turns the tow truck's winch. jobs.js describes the
   moment; this file draws the glowing targets, the pointing hand and the number bubbles, counts aloud, and helps:
     no finger for HINT_AT seconds (after the invitation) -> the hint line is spoken and the hand grows
     no finger for AUTO_AT seconds  -> the game does the next one itself, then one more every AUTO_GAP seconds
   so a moment can never block the game, and nothing can be done wrong (a drag let go anywhere still lands).
   The waiting is counted in game time (H.update(dt)), so it stands still on a hold or a hidden page.

   BB.hands.run(opts) -> Promise<boolean> (true = all done, false = stopped):
     kind    'tap' | 'drag' | 'aim' | 'crank'
     count   how many actions (tap, drag, aim), ignored for crank
     targets [fn(out) -> world point] one per thing to touch; `repeat: true` = one target tapped `count` times;
             `ordered: true` = the things go in list order whichever one is touched (only the next one glows)
     drop    fn(out) -> world point of the place things are dragged to (drag)
     act(j, idx, auto)   the j-th action (0-based) on target idx; may return a promise the moment waits for
     drag(idx, point)    the finger carries target idx over the ground (point = null when it lets go)
     aim(x, y)           the finger points at a screen spot (aim); the scene calls BB.hands.hit(idx) when it is hit
     auto(idx)           aim only: point at target idx by itself
     turn(p)             crank only: the winch is at p (0..1)
     say, hint           the spoken invitation and the later hint
     bubble(j, idx, out) world point of the number bubble (default: the target)
   BB.hands.stop() ends the moment at once. BB.hands.state() is read by nothing in the game (tools only).

   BB.water: the fire hose. Up to 10 streams in ONE instanced mesh (a parabola of droplets that widens into spray,
   a little splash and two mist puffs where it lands). stream(i, from, to, on) / update(dt) / clear(). */
(function () {
  'use strict';
  const BB = window.BB;
  const H = BB.hands = {};
  const HINT_AT = 6, AUTO_AT = 12, AUTO_GAP = 2.4, SAY_GRACE = 3;   // (the waiting starts when the invitation has been said: about 3 s)
  H.HINT_AT = HINT_AT; H.AUTO_AT = AUTO_AT;

  BB.css(`
  .bbh { position: absolute; inset: 0; pointer-events: none; overflow: hidden; --t: 84px; --bub: 60px; --hand: 76px; font-family: 'Fredoka', 'Baloo 2', system-ui, sans-serif; }
  .bbh-at { position: absolute; left: 0; top: 0; will-change: transform; }
  .bbh-t { position: absolute; width: var(--t); height: var(--t); left: calc(var(--t) / -2); top: calc(var(--t) / -2); border-radius: 50%;
    pointer-events: auto; touch-action: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .bbh.aim .bbh-t { pointer-events: none; }
  .bbh.aim { --t: 62px; }
  .bbh-t.ring::before { content: ''; position: absolute; inset: 12%; border-radius: 50%; box-sizing: border-box; border: 5px solid #ffd45c;
    box-shadow: 0 0 12px 3px rgba(255,190,40,.85), inset 0 0 9px 1px rgba(255,214,92,.65); animation: bbh-pulse .9s ease-in-out infinite alternate; }
  .bbh-t.held::before { border-color: #19a79b; box-shadow: 0 0 12px 3px rgba(25,167,155,.7); animation: none; transform: scale(1.12); }
  @keyframes bbh-pulse { from { transform: scale(.9); opacity: .75; } to { transform: scale(1.08); opacity: 1; } }
  .bbh-drop { position: absolute; width: calc(var(--t) * 1.25); height: calc(var(--t) * 1.25); left: calc(var(--t) * -.625); top: calc(var(--t) * -.625);
    border-radius: 50%; box-sizing: border-box; border: 5px dashed #19a79b; background: rgba(25,167,155,.14); animation: bbh-pulse 1.1s ease-in-out infinite alternate; }
  .bbh-hand { position: absolute; width: var(--hand); height: var(--hand); left: calc(var(--hand) * -.36); top: calc(var(--hand) * .04); opacity: .92;
    transition: opacity .3s; filter: drop-shadow(0 4px 0 rgba(120,80,40,.22)); }
  .bbh-hand svg { width: 100%; height: 100%; display: block; transform-origin: 40% 10%; animation: bbh-tap 1s ease-in-out infinite; }
  .bbh-hand.move svg { animation: none; }
  .bbh-hand.big { --hand: 96px; }
  @keyframes bbh-tap { 0%, 100% { transform: translateY(12px); } 45% { transform: translateY(0) scale(.94); } }
  .bbh-bub { position: absolute; min-width: var(--bub); height: var(--bub); left: calc(var(--bub) / -2); top: calc(var(--bub) * -1.1);
    box-sizing: border-box; padding: 0 8px; border-radius: calc(var(--bub) / 2); background: #fff6e0; border: 4px solid #ffb81f; color: #d98700;
    font: 700 calc(var(--bub) * .68)/1 'Fredoka', 'Baloo 2', system-ui, sans-serif; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 5px 0 rgba(120,80,40,.2); animation: bbh-in .35s cubic-bezier(.2,1.6,.5,1); transform-origin: 50% 120%; transition: opacity .35s, transform .35s; }
  .bbh-bub::after { content: ''; position: absolute; left: 50%; bottom: -12px; margin-left: -8px; border: 8px solid transparent; border-top-color: #ffb81f; border-bottom: 0; }
  .bbh-bub.old { opacity: 0; transform: scale(.7); }
  @keyframes bbh-in { from { transform: scale(.2); opacity: 0; } }
  .bbh-pad { position: absolute; inset: 0; pointer-events: auto; touch-action: none; }
  .bbh-crank { position: absolute; right: max(26px, env(safe-area-inset-right)); bottom: 34%; width: 230px; height: 230px; pointer-events: auto; touch-action: none;
    cursor: grab; animation: bbh-in .4s cubic-bezier(.2,1.5,.5,1); -webkit-tap-highlight-color: transparent; }
  .bbh-crank svg { width: 100%; height: 100%; display: block; overflow: visible; }
  .bbh-crank .rot { transform-origin: 100px 100px; }
  .bbh-crank.glow .rim { animation: bbh-rim .8s ease-in-out infinite alternate; }
  @keyframes bbh-rim { to { stroke: #ffd45c; stroke-width: 9; } }
  @media (max-height: 520px) {
    .bbh { --t: 64px; --bub: 46px; --hand: 58px; }
    .bbh.aim { --t: 46px; }
    .bbh-hand.big { --hand: 72px; }
    .bbh-crank { width: 168px; height: 168px; bottom: max(14px, env(safe-area-inset-bottom)); }
  }
  `);
  // a pointing hand cut from paper: cream skin, a deeper rim, a darker crescent on the lower right, a teal cuff
  const HAND = `<svg viewBox="0 0 80 80"><g stroke="#d9a05f" stroke-width="3" stroke-linejoin="round">
    <rect x="23" y="4" width="16" height="42" rx="8" fill="#ffe2bd"/>
    <path d="M14 44 Q14 34 24 34 H50 Q62 34 62 46 V56 Q62 70 48 70 H30 Q14 70 14 56 Z" fill="#ffe2bd"/>
    <path d="M14 48 Q5 44 7 37 Q10 31 18 36" fill="#ffe2bd"/></g>
    <path d="M60 44 V56 Q60 68 48 68 H34 Q52 64 54 44 Z" fill="#f0c493"/>
    <path d="M35.5 8 V40 H32 Q34 24 31.5 7 Z" fill="#f0c493"/>
    <rect x="22" y="66" width="34" height="11" rx="5.5" fill="#19a79b" stroke="#127a71" stroke-width="3"/></svg>`;
  // the winch wheel: a cream drum with a coral rim, honey spokes and a round knob to hold
  const CRANK = `<svg viewBox="0 0 200 200"><circle cx="103" cy="105" r="92" fill="rgba(120,80,40,.2)"/>
    <g class="rot"><circle class="rim" cx="100" cy="100" r="88" fill="#fff6e0" stroke="#f26b5b" stroke-width="12"/>
    <path d="M162 162 A88 88 0 0 0 188 100 L176 100 A76 76 0 0 1 154 154 Z" fill="#c84a3c"/>
    <g stroke="#f5b83d" stroke-width="13" stroke-linecap="round"><path d="M100 100 V30 M100 100 L39 135 M100 100 L161 135"/></g>
    <circle cx="100" cy="100" r="24" fill="#f5b83d" stroke="#d98700" stroke-width="5"/><path d="M112 112 A17 17 0 0 0 117 100 A17 17 0 0 1 100 117 Z" fill="#d98700"/>
    <circle cx="100" cy="30" r="25" fill="#19a79b" stroke="#127a71" stroke-width="6"/><path d="M114 44 A20 20 0 0 0 120 30 A20 20 0 0 1 100 50 Z" fill="#127a71"/></g></svg>`;

  let layer = null, cur = null;
  const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _hit = new THREE.Vector3(), _ndc = new THREE.Vector2();
  const _ray = new THREE.Raycaster(), _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _s = { x: 0, y: 0 };
  function root() {
    if (!layer || !layer.isConnected) {
      const ui = (BB.ui && BB.ui.root) || document.getElementById('ui');
      layer = document.createElement('div'); layer.className = 'bbh';
      ui.insertBefore(layer, ui.firstChild);           // under the HUD and the question card
    }
    return layer;
  }
  // a world point on screen (CSS px); false when it is behind the camera
  function proj(p, out) {
    _v.copy(p).project(BB.camera);
    if (_v.z > 1) return false;
    out.x = (_v.x + 1) / 2 * innerWidth; out.y = (1 - _v.y) / 2 * innerHeight;
    return true;
  }
  H.project = proj;
  // where a screen point's ray meets the level plane at height y (out), or null
  function ground(x, y, planeY, out) {
    _ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
    _ray.setFromCamera(_ndc, BB.camera);
    _plane.constant = -planeY;
    return _ray.ray.intersectPlane(_plane, out);
  }
  H.ground = ground;
  H.ray = (x, y) => { _ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); _ray.setFromCamera(_ndc, BB.camera); return _ray.ray; };
  // move an anchor only when it really moved (the stop camera stands almost still: hardly any style writes)
  function place(a, x, y, show) {
    if (!show) { if (a._on !== false) { a._on = false; a.style.display = 'none'; } return; }
    if (a._on === false) { a._on = true; a.style.display = ''; }
    if (Math.abs(x - (a._x || 0)) < 0.5 && Math.abs(y - (a._y || 0)) < 0.5 && a._x != null) return;
    a._x = x; a._y = y;
    a.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
  }
  const anchor = () => BB.el('div', 'bbh-at', root());
  const asking = () => !!(BB.ui && BB.ui.asking && BB.ui.asking());
  const unlock = () => { if (BB.audio && BB.audio.unlock) BB.audio.unlock(); };

  function bubble(c, j, idx) {
    const a = anchor(), b = { a, p: new THREE.Vector3(), t: 0 };
    BB.el('div', 'bbh-bub', a, String(j + 1));
    if (c.o.bubble) c.o.bubble(j, idx, b.p); else if (c.targets[idx]) c.targets[idx].at(b.p);
    for (const o of c.bubbles) o.old = true;
    c.bubbles.push(b);
  }
  // one action done (by the finger, or by the game when auto is true)
  function did(c, idx, auto) {
    if (cur !== c || c.done >= c.count) return;
    const t = c.targets[idx];
    if (t && !c.o.repeat) { if (t.used) return; t.used = true; t.el.remove(); }
    const j = c.done++;
    c.idle = auto ? AUTO_AT - AUTO_GAP : 0;
    bubble(c, j, idx);
    try { BB.sfx.tick(); } catch (e) { /* no sound */ }
    BB.say(String(j + 1), { queue: false });           // counting aloud: one, two, three
    let r = null;
    try { r = c.o.act ? c.o.act(j, idx, !!auto) : null; } catch (e) { console.error(e); }
    if (r && typeof r.then === 'function') c.pending.push(r.catch((e) => console.error(e)));
    if (c.done >= c.count) finish(c, true);
  }
  function next(c) { for (let i = 0; i < c.targets.length; i++) if (!c.targets[i].used) return i; return -1; }
  function finish(c, ok) {
    if (c.ended) return;
    c.ended = true;
    for (const t of c.targets) t.el.remove();
    if (c.hand) c.hand.remove();
    if (c.drop) c.drop.remove();
    if (c.pad) c.pad.remove();
    if (c.crank) c.crank.remove();
    if (layer) layer.classList.remove('aim');
    const done = () => { for (const b of c.bubbles) b.a.remove(); c.bubbles.length = 0; if (cur === c) cur = null; };
    if (!ok) { done(); c.resolve(false); return; }
    c.closing = 1.3;                                   // the last number stays a moment (H.update clears it)
    c.done2 = done;
    Promise.all(c.pending).then(() => c.resolve(!c.stopped));
  }

  H.run = function (o) {
    H.stop();
    return new Promise((resolve) => {
      const c = cur = { o, kind: o.kind || 'tap', count: Math.max(1, o.count | 0), done: 0, idle: o.say ? -SAY_GRACE : 0, hinted: false, targets: [], bubbles: [], pending: [],
        resolve, ended: false, closing: null, hand: null, drop: null, pad: null, crank: null, dragging: null, t: 0, p: 0 };
      const L = root();
      L.classList.toggle('aim', c.kind === 'aim');
      if (c.kind === 'aim') {
        // the whole view is the aiming pad (the HUD and the card sit on top and keep their own taps)
        c.pad = BB.el('div', 'bbh-pad', L);
        const aim = (e) => { c.idle = 0; c.touched = true; try { o.aim(e.clientX, e.clientY); } catch (err) { console.error(err); } };
        c.pad.addEventListener('pointerdown', (e) => { e.preventDefault(); c.down = true; try { c.pad.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } aim(e); });
        c.pad.addEventListener('pointermove', (e) => { if (c.down) aim(e); });
        const up = () => { c.down = false; unlock(); };
        c.pad.addEventListener('pointerup', up); c.pad.addEventListener('pointercancel', up);
      }
      if (c.kind === 'crank') {
        c.count = 1;
        c.crank = BB.el('div', 'bbh-crank', L, CRANK);
        c.rot = c.crank.querySelector('.rot'); c.ang = 0; c.tick = 0;
        const angle = (e) => { const r = c.crank.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
        const turn = (d) => {
          if (c.ended) return;
          c.ang += d; c.p = Math.min(1, c.p + Math.abs(d) / (Math.PI * 2 * (o.turns || 3)));
          c.rot.style.transform = 'rotate(' + (c.ang * 57.2958).toFixed(1) + 'deg)';
          c.tick += Math.abs(d); if (c.tick > 0.8) { c.tick = 0; try { BB.sfx.tick(); } catch (e) { /* none */ } }
          try { if (o.turn) o.turn(c.p); } catch (err) { console.error(err); }
          if (c.p >= 1) { try { if (o.act) { const r = o.act(0, 0, !!c.autoOn); if (r && r.then) c.pending.push(r); } } catch (err) { console.error(err); } c.done = 1; finish(c, true); }
        };
        c.turnBy = turn;
        c.crank.addEventListener('pointerdown', (e) => { e.preventDefault(); c.down = true; c.last = angle(e); c.moved = 0; c.idle = 0; try { c.crank.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
        c.crank.addEventListener('pointermove', (e) => {
          if (!c.down) return;
          const a = angle(e); let d = a - c.last; c.last = a;
          if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
          c.moved += Math.abs(d); c.idle = 0; c.autoOn = false;
          turn(d);
        });
        const up = () => { if (c.down && c.moved < 0.15) turn(Math.PI / 2.5); c.down = false; unlock(); };   // a tap gives a little turn too
        c.crank.addEventListener('pointerup', up); c.crank.addEventListener('pointercancel', () => { c.down = false; });
      }
      (o.targets || []).forEach((at, idx) => {
        const a = anchor(), el = BB.el('div', 'bbh-t', a), t = { at, a, el, used: false, p: new THREE.Vector3() };
        c.targets.push(t);
        if (c.kind === 'aim') return;
        let down = false, sx = 0, sy = 0, moved = false;
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault(); down = true; moved = false; sx = e.clientX; sy = e.clientY; c.idle = 0;
          if (c.kind === 'drag') { try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } el.classList.add('held'); c.dragging = t; }
        });
        el.addEventListener('pointermove', (e) => {
          if (!down || c.kind !== 'drag') return;
          if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 8) moved = true;
          if (!moved) return;
          c.idle = 0;
          const k = o.ordered ? next(c) : idx, g = ground(e.clientX, e.clientY, o.plane || 0, _hit);
          if (g && o.drag) { try { o.drag(k, g); } catch (err) { console.error(err); } }
          t.fx = e.clientX; t.fy = e.clientY; t.follow = true;
        });
        const up = (e) => {
          if (!down) return; down = false; unlock();
          el.classList.remove('held'); c.dragging = null; t.follow = false;
          const k = o.ordered ? next(c) : idx;
          if (c.kind === 'drag' && moved && o.drag) { try { o.drag(k, null); } catch (err) { console.error(err); } }
          if (e.type === 'pointerup' || moved) did(c, k, false);
        };
        el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      });
      if (c.kind === 'drag' && o.drop) { c.drop = anchor(); BB.el('div', 'bbh-drop', c.drop); c.dropP = new THREE.Vector3(); }
      c.hand = anchor(); c.handEl = BB.el('div', 'bbh-hand' + (c.kind === 'drag' || c.kind === 'crank' ? ' move' : ''), c.hand, HAND);
      if (o.say) BB.say(o.say, { queue: true });
      H.update(0);
    });
  };
  // the scene says target idx was hit (aim)
  H.hit = (idx) => { if (cur && !cur.ended) did(cur, idx, !!cur.autoOn); };
  H.active = () => !!(cur && !cur.ended);
  H.stop = function () { const c = cur; if (!c) return; if (c.ended) { c.stopped = true; if (c.done2) c.done2(); c.closing = null; cur = null; return; } finish(c, false); };
  H.state = function () {
    const c = cur; if (!c || c.ended) return { on: false };
    const r = c.crank ? c.crank.getBoundingClientRect() : null;
    return { on: true, kind: c.kind, done: c.done, count: c.count, idle: +c.idle.toFixed(2), hinted: c.hinted, p: +c.p.toFixed(3),
      targets: c.targets.map((t) => ({ used: t.used, x: t.a._x, y: t.a._y, on: t.a._on !== false })),
      drop: c.drop ? { x: c.drop._x, y: c.drop._y } : null, crank: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 } : null };
  };

  H.update = function (dt) {
    try { if (W.mesh) W.update(dt); } catch (e) { console.error(e); }
    const c = cur; if (!c) return;
    if (c.ended) {
      if (c.closing != null) { c.closing -= dt; if (c.closing <= 0) { c.closing = null; if (c.done2) c.done2(); } }
    }
    for (let i = c.bubbles.length - 1; i >= 0; i--) {
      const b = c.bubbles[i];
      b.t += dt;
      if (b.old && !b.faded && b.t > 0.9) { b.faded = true; b.a.firstChild.classList.add('old'); }
      if (b.faded && b.t > 1.6) { b.a.remove(); c.bubbles.splice(i, 1); continue; }
      { const on = proj(b.p, _s); place(b.a, BB.clamp(_s.x, 40, innerWidth - 40), Math.max(_s.y, innerHeight <= 520 ? 62 : 86), on); }   // (never off the edge)
    }
    if (c.ended) return;
    c.t += dt;
    const o = c.o, nx = next(c);
    for (let i = 0; i < c.targets.length; i++) {
      const t = c.targets[i]; if (t.used) continue;
      t.at(t.p);
      const ring = !o.ordered || i === nx;
      if (ring !== t.ring) { t.ring = ring; t.el.classList.toggle('ring', ring); }
      if (t.follow) place(t.a, t.fx, t.fy, true);       // under the finger while it is carried
      else { const on = proj(t.p, _s); place(t.a, BB.clamp(_s.x, 34, innerWidth - 34), BB.clamp(_s.y, 34, innerHeight - 34), on); }   // (always within reach)
    }
    if (c.drop) { o.drop(c.dropP); const on = proj(c.dropP, _s); place(c.drop, _s.x, _s.y, on); }
    // the pointing hand: on the next thing to touch; for a drag it glides from the thing to the drop place; round
    // the winch it circles
    if (c.kind === 'crank') {
      const r = c.crank.getBoundingClientRect(), a = c.t * 2.2;
      place(c.hand, r.left + r.width / 2 + Math.cos(a) * r.width * 0.34, r.top + r.height / 2 + Math.sin(a) * r.height * 0.34, !c.down);
    } else if (nx >= 0 && !c.dragging && !(c.kind === 'aim' && c.down)) {
      const t = c.targets[nx];
      if (proj(t.p, _s)) {
        let x = _s.x, y = _s.y;
        if (c.drop && proj(c.dropP, _s)) { const u = BB.smooth(BB.clamp((c.t % 2.2) / 1.5, 0, 1)); x += (_s.x - x) * u; y += (_s.y - y) * u; }
        place(c.hand, x, y, true);
      } else place(c.hand, 0, 0, false);
    } else place(c.hand, 0, 0, false);
    // waiting for a finger: a hint, then the game helps
    if (asking() || c.down || c.dragging) return;
    c.idle += dt;
    if (!c.hinted && c.idle >= HINT_AT) {
      c.hinted = true; c.handEl.classList.add('big');
      if (c.crank) c.crank.classList.add('glow');
      if (o.hint) BB.say(o.hint, { queue: true });
    }
    if (c.idle >= AUTO_AT) {
      c.autoOn = true;
      if (c.kind === 'crank') { c.turnBy(dt * 3.2); return; }
      if (c.kind === 'aim') { if (nx >= 0 && c.autoIdx !== nx) { c.autoIdx = nx; try { o.auto(nx); } catch (e) { console.error(e); } } return; }
      if (nx >= 0) did(c, o.repeat ? 0 : nx, true);
      else finish(c, true);                             // (nothing left to touch: never wait for ever)
    }
  };

  // ---------- the water spray ----------
  const PER = 18, SPL = 6, MIST = 2, EACH = PER + SPL + MIST, MAXS = 10;
  const W = BB.water = { mesh: null, n: 0, t: 0 };
  const streams = [];
  const _m = new THREE.Matrix4(), _c = new THREE.Color();
  const TINTS = ['#ffffff', '#d9f2fc', '#bfe6f7', '#eaf8fe'];
  function ensure() {
    if (W.mesh) return W.mesh;
    const g = new THREE.IcosahedronGeometry(1, 0);                       // 20 triangles a droplet
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#6fa9c4', emissiveIntensity: 0.35 }), MAXS * EACH);
    mesh.name = 'water'; mesh.frustumCulled = false; mesh.count = 0;
    for (let i = 0; i < MAXS * EACH; i++) mesh.setColorAt(i, _c.set(i % EACH >= PER + SPL ? '#ffffff' : TINTS[i % TINTS.length]));
    mesh.instanceColor.needsUpdate = true;
    W.mesh = mesh;
    return mesh;
  }
  // stream i runs from `from` (the nozzle) to `to` (where it lands); on = false lets it run dry
  W.stream = function (i, from, to, on) {
    if (i < 0 || i >= MAXS) return;
    const mesh = ensure();
    if (!mesh.parent && BB.scene) BB.scene.add(mesh);
    let s = streams[i];
    if (!s) s = streams[i] = { on: false, grow: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), want: new THREE.Vector3(), set: false, ph: i * 0.37 };
    if (from) s.from.copy(from);
    if (to) { s.want.copy(to); if (!s.set || s.grow <= 0) { s.to.copy(to); s.set = true; } }
    s.on = on !== false;
  };
  W.off = function () { for (const s of streams) if (s) s.on = false; };
  W.clear = function () {
    for (const s of streams) if (s) { s.on = false; s.grow = 0; s.set = false; }
    if (W.mesh) { W.mesh.count = 0; if (W.mesh.parent) W.mesh.parent.remove(W.mesh); }
  };
  W.landing = (i, out) => { const s = streams[i]; if (!s) return null; return out.copy(s.to); };
  function put(mesh, n, x, y, z, sc) {
    const e = _m.elements;
    e[0] = sc; e[1] = 0; e[2] = 0; e[4] = 0; e[5] = sc; e[6] = 0; e[8] = 0; e[9] = 0; e[10] = sc; e[12] = x; e[13] = y; e[14] = z;
    mesh.setMatrixAt(n, _m);
  }
  // a bead of the jet: r thick, stretched to half-length l along its way (tx, ty, tz)
  function bead(mesh, n, x, y, z, tx, ty, tz, r, l) {
    const e = _m.elements, tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    let ax = tz, az = -tx; const al = Math.sqrt(ax * ax + az * az);          // level, across the jet
    if (al < 0.001) { ax = 1; az = 0; } else { ax /= al; az /= al; }
    const bx = -ty * az, by = az * tx - ax * tz, bz = ty * ax;               // the third axis (across x along)
    e[0] = ax * r; e[1] = 0; e[2] = az * r; e[4] = tx * l; e[5] = ty * l; e[6] = tz * l; e[8] = bx * r; e[9] = by * r; e[10] = bz * r;
    e[12] = x; e[13] = y; e[14] = z;
    mesh.setMatrixAt(n, _m);
  }
  W.update = function (dt) {
    const mesh = W.mesh; if (!mesh || !mesh.parent) return;
    W.t += dt;
    const t = W.t;
    let n = 0;
    _m.identity();
    for (let k = 0; k < streams.length; k++) {
      const s = streams[k]; if (!s) continue;
      s.grow = BB.clamp(s.grow + (s.on ? dt * 2.2 : -dt * 3), 0, 1);
      if (s.grow <= 0) continue;
      const e = Math.min(1, dt * 7);
      s.to.x += (s.want.x - s.to.x) * e; s.to.y += (s.want.y - s.to.y) * e; s.to.z += (s.want.z - s.to.z) * e;
      const fx = s.from.x, fy = s.from.y, fz = s.from.z, dx = s.to.x - fx, dy = s.to.y - fy, dz = s.to.z - fz;
      const len = Math.sqrt(dx * dx + dz * dz), h = Math.min(1.7, 0.3 + len * 0.075);         // the arc's rise
      const path = Math.sqrt(len * len + dy * dy) + h, half = path / PER * 0.5;
      // a chain of long beads near the nozzle that shorten, fatten and scatter into spray toward the end
      for (let i = 0; i < PER; i++) {
        const u = ((i + s.ph) / PER + t * (9 / Math.max(4, path))) % 1;
        if (u > s.grow) continue;
        const wob = Math.sin(i * 2.4 + t * 11 + k) * 0.09 * u * u;
        bead(mesh, n++, fx + dx * u + wob, fy + dy * u + 4 * h * u * (1 - u) + wob, fz + dz * u - wob,
          dx, dy + 4 * h * (1 - 2 * u), dz, 0.06 + 0.075 * u, half * (0.92 - 0.45 * u * u));
      }
      if (s.grow > 0.9) {
        for (let j = 0; j < SPL; j++) {
          const u = (j / SPL + t * 2.3 + s.ph) % 1, a = j * 2.4 + k;
          put(mesh, n++, s.to.x + Math.cos(a) * 0.55 * u, s.to.y + 0.75 * u - 1.5 * u * u, s.to.z + Math.sin(a) * 0.55 * u, 0.13 * (1 - u) + 0.03);
        }
        for (let j = 0; j < MIST; j++) put(mesh, n++, s.to.x + (j ? 0.16 : -0.14), s.to.y + (j ? 0.12 : -0.05), s.to.z, 0.2 + 0.07 * Math.sin(t * 8 + j * 2 + k));
      }
    }
    mesh.count = n; W.n = n;
    mesh.instanceMatrix.needsUpdate = true;
  };
})();
