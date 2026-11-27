/* Little Bus Captain: hands-on moments and the water spray.
   BB.hands: one finger-driven moment at a time, laid over the 3D scene (a DOM layer inside #ui, under the HUD and the
   question card). While a question's story is told, the child DOES its "k" part: taps each friend aboard, drags each
   bag to the taxi, aims the fire hose at the smoky windows, turns the tow truck's winch. jobs.js describes the
   moment; this file draws it and helps. One look for every ride:
     the ring      a chunky honey ring on what to touch: 88 px (66 on phones), never two overlapping: when the things
                   stand a ring apart each wears its own, else only the next one does (the others can still be
                   touched: the thing nearest the finger is the one meant); a whole vehicle wears it round its box
     the hand      a paper hand that shows the gesture from the first moment: it taps (with a ripple), carries a thing
                   along a dotted path to the drop place, slides from window to window, or goes round the winch
     the drop      a dashed teal ring with a little arrow: where a dragged thing goes (it lights up under the finger)
     the bubble    the number of each thing done, counted aloud with a little note that climbs
   Every touch gets an answer: a pop of paper stars, the note, the number; a touch that missed makes the nearest
   ring wiggle and brings the hand to it (after two misses the hint is said, after four the game does one).
   One finger only (a second finger is ignored), and a quick double tap counts once. Nothing can be done wrong:
   a drag let go anywhere, or a plain tap, still lands. And it never blocks:
     no finger for HINT_AT seconds (after the invitation) -> the hint line is spoken and the hand grows
     no finger for AUTO_AT seconds  -> the game does the next one itself, then one more every AUTO_GAP seconds
   The waiting is counted in game time (H.update(dt)), so it stands still on a hold or a hidden page.
   Speech: the invitation is never cut off: a number counted while it is said waits its turn, and so do the
   numbers behind one another; only a late hint is cut by the child's own counting.

   BB.hands.run(opts) -> Promise<boolean> (true = all done, false = stopped):
     kind    'tap' | 'drag' | 'aim' | 'crank'
     count   how many actions (tap, drag, aim), ignored for crank
     targets one per thing to touch: fn(out) -> world point, or { at: fn(out), box: [world points] } for a whole big
             thing (the ring goes round its box on screen: "tap the fire engine"); `repeat: true` = one target tapped
             `count` times; `ordered: true` = the things go in list order whichever one is touched (one ring, on the
             next one; a touch anywhere on the group counts, also where one has just gone)
     drop    fn(out, idx) -> world point of the place thing idx (the one carried, else the next one) goes (drag)
     act(j, idx, auto)   the j-th action (0-based) on target idx; may return a promise the moment waits for
     drag(idx, point)    the finger carries target idx over the ground (point = null when it lets go)
     aim(x, y)           the finger points at a screen spot (aim); the scene calls BB.hands.hit(idx) when it is hit
     auto(idx)           aim only: point at target idx by itself
     turn(p)             crank only: the winch is at p (0..1)
     say, hint           the spoken invitation and the later hint
     bubble(j, idx, out) world point of the number bubble (default: the target)
   BB.hands.stop() ends the moment at once. BB.hands.size() = the ring size in CSS px (for laying things out).
   BB.hands.state() is read by nothing in the game (tools only).

   BB.water: the fire hose. Up to 10 streams in ONE instanced mesh (a parabola of droplets that widens into spray,
   a little splash and two mist puffs where it lands). stream(i, from, to, on) / update(dt) / clear(). */
(function () {
  'use strict';
  const BB = window.BB;
  const H = BB.hands = {};
  const HINT_AT = 6, AUTO_AT = 12, AUTO_GAP = 2.4;
  H.HINT_AT = HINT_AT; H.AUTO_AT = AUTO_AT;
  const hypot2 = (a, b) => Math.sqrt(a * a + b * b);
  const tsize = () => (innerHeight <= 520 ? 66 : 88);      // (the same numbers as --t below)
  H.size = tsize;

  BB.css(`
  .bbh { position: absolute; inset: 0; pointer-events: none; overflow: hidden; --t: 88px; --bub: 60px; --hand: 84px; --rim: 6px; font-family: 'Fredoka', 'Baloo 2', system-ui, sans-serif; }
  .bbh-pad { position: absolute; inset: 0; pointer-events: auto; touch-action: none; -webkit-tap-highlight-color: transparent; }
  .bbh-at { position: absolute; left: 0; top: 0; will-change: transform; pointer-events: none; }
  /* the ring: honey with a deeper rim outside and a cream line inside, so it shows on any colour */
  .bbh-t { position: absolute; width: var(--w, var(--t)); height: var(--h, var(--t)); left: calc(var(--w, var(--t)) / -2); top: calc(var(--h, var(--t)) / -2);
    border-radius: 50%; opacity: 0; transform: scale(.5); transition: opacity .18s, transform .28s cubic-bezier(.2,1.6,.5,1); }
  .bbh-t.box { border-radius: 30px; }
  .bbh-t.ring { opacity: 1; transform: none; }
  .bbh-t i { position: absolute; inset: 0; border-radius: inherit; box-sizing: border-box; border: var(--rim) solid #ffd45c;
    background: radial-gradient(closest-side, rgba(255,236,170,0) 70%, rgba(255,224,120,.22) 100%);
    box-shadow: 0 0 0 3px #f2a516, 0 0 14px 6px rgba(255,184,31,.55), inset 0 0 0 3px #fff6e0, inset 0 0 8px 2px rgba(255,214,92,.4);
    animation: bbh-pulse .85s ease-in-out infinite alternate; }
  .bbh-t.box i { background: none; animation-name: bbh-pulse-box; }
  @keyframes bbh-pulse { from { transform: scale(.92); } to { transform: scale(1.04); } }
  @keyframes bbh-pulse-box { from { transform: scale(.97); } to { transform: scale(1.02); } }
  .bbh.hint .bbh-t i { animation-duration: .5s; }
  .bbh-t.held i { border-color: #6fdacd; box-shadow: 0 0 0 3px #19a79b, 0 0 14px 6px rgba(25,167,155,.5), inset 0 0 0 3px #fff6e0; animation: none; transform: scale(.9); }
  .bbh-t.nudge, .bbh-crank.nudge { animation: bbh-nudge .55s ease-out; }
  @keyframes bbh-nudge { 25% { transform: scale(1.24) rotate(-5deg); } 50% { transform: scale(.96) rotate(4deg); } 75% { transform: scale(1.1) rotate(-2deg); } }
  /* the drop place */
  .bbh-drop { position: absolute; width: calc(var(--t) * 1.2); height: calc(var(--t) * 1.2); left: calc(var(--t) * -.6); top: calc(var(--t) * -.6);
    border-radius: 50%; box-sizing: border-box; border: var(--rim) dashed #19a79b; background: rgba(255,246,224,.3);
    box-shadow: 0 0 0 4px rgba(255,246,224,.9), 0 0 16px 6px rgba(25,167,155,.38); animation: bbh-pulse 1.1s ease-in-out infinite alternate; }
  .bbh-drop::after { content: ''; position: absolute; left: 50%; top: calc(var(--t) * -.36); width: calc(var(--t) * .34); height: calc(var(--t) * .26); margin-left: calc(var(--t) * -.17);
    background: #19a79b; clip-path: polygon(0 0, 100% 0, 50% 100%); animation: bbh-bob .6s ease-in-out infinite alternate; }
  @keyframes bbh-bob { to { transform: translateY(calc(var(--t) * .1)); } }
  .bbh-drop.near { border-style: solid; background: rgba(150,232,218,.5); animation: none; transform: scale(1.14); }
  /* the dotted path from the thing to the drop place, and its arrowhead */
  .bbh-dot { position: absolute; width: 18px; height: 18px; left: -9px; top: -9px; border-radius: 50%; background: #fff6e0; box-shadow: 0 0 0 4px #19a79b, 0 3px 0 4px rgba(18,122,113,.35);
    animation: bbh-march 1.2s linear infinite; }
  @keyframes bbh-march { 0%, 100% { transform: scale(.72); opacity: .7; } 50% { transform: scale(1.12); opacity: 1; } }
  .bbh-arrow { position: absolute; width: 40px; height: 40px; left: -20px; top: -20px; filter: drop-shadow(0 3px 0 rgba(18,122,113,.35)); }
  .bbh-arrow b { position: absolute; inset: 0; background: #19a79b; clip-path: polygon(6% 4%, 98% 50%, 6% 96%, 30% 50%); }
  /* the pointing hand */
  .bbh-hand { position: absolute; width: var(--hand); height: var(--hand); left: calc(var(--hand) * -.39); top: calc(var(--hand) * -.02);
    filter: drop-shadow(0 4px 0 rgba(120,80,40,.22)); }
  .bbh-hand svg { position: relative; width: 100%; height: 100%; display: block; transform-origin: 39% 5%; transition: transform .16s; }
  .bbh-hand.tap svg { animation: bbh-tap 1.15s ease-in-out infinite; }
  @keyframes bbh-tap { 0%, 100% { transform: translate(10px, 26px) rotate(7deg); } 40%, 60% { transform: translate(0, 0) scale(.93); } }
  .bbh-hand.press svg { transform: scale(.92); }
  .bbh-hand.lift svg { transform: translate(9px, 22px) rotate(7deg); }
  .bbh-rip { position: absolute; left: 39%; top: 5%; width: 0; height: 0; }
  .bbh-rip::before { content: ''; position: absolute; width: calc(var(--hand) * .9); height: calc(var(--hand) * .9); left: calc(var(--hand) * -.45); top: calc(var(--hand) * -.45);
    border-radius: 50%; box-sizing: border-box; border: 5px solid #fff6e0; box-shadow: 0 0 0 2px #ffb81f; opacity: 0; }
  .bbh-hand.tap .bbh-rip::before { animation: bbh-rip 1.15s ease-out infinite; }
  @keyframes bbh-rip { 0%, 38% { transform: scale(.15); opacity: 0; } 45% { opacity: .95; } 80%, 100% { transform: scale(1); opacity: 0; } }
  .bbh-hand.big { --hand: 104px; }
  /* a touch that counted: a ring that opens and six paper stars */
  .bbh-pop b { position: absolute; width: var(--t); height: var(--t); left: calc(var(--t) / -2); top: calc(var(--t) / -2); border-radius: 50%; box-sizing: border-box;
    border: var(--rim) solid #ffd45c; animation: bbh-popring .5s ease-out forwards; }
  @keyframes bbh-popring { from { transform: scale(.7); opacity: 1; } to { transform: scale(1.7); opacity: 0; } }
  .bbh-pop i { position: absolute; width: 18px; height: 18px; left: -9px; top: -9px; background: var(--c);
    clip-path: polygon(50% 0, 62% 36%, 100% 38%, 70% 60%, 80% 98%, 50% 76%, 20% 98%, 30% 60%, 0 38%, 38% 36%); animation: bbh-fly .6s ease-out forwards; }
  @keyframes bbh-fly { from { transform: translate(0, 0) scale(.4); opacity: 1; } to { transform: translate(var(--dx), var(--dy)) scale(1.15) rotate(150deg); opacity: 0; } }
  /* the number bubble (the same look as the counting bubbles over the seats) */
  .bbh-bub { position: absolute; min-width: var(--bub); height: var(--bub); left: calc(var(--bub) / -2); top: calc(var(--bub) * -1.1);
    box-sizing: border-box; padding: 0 8px; border-radius: calc(var(--bub) / 2); background: #fff6e0; border: 4px solid #ffb81f; color: #d98700;
    font: 700 calc(var(--bub) * .68)/1 'Fredoka', 'Baloo 2', system-ui, sans-serif; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 5px 0 rgba(120,80,40,.2); animation: bbh-in .35s cubic-bezier(.2,1.6,.5,1); transform-origin: 50% 120%; transition: opacity .35s, transform .35s; }
  .bbh-bub::after { content: ''; position: absolute; left: 50%; bottom: -12px; margin-left: -8px; border: 8px solid transparent; border-top-color: #ffb81f; border-bottom: 0; }
  .bbh-bub.old { opacity: 0; transform: scale(.7); }
  @keyframes bbh-in { from { transform: scale(.2); opacity: 0; } }
  /* the winch wheel: below the truck on tablets, in the empty column on the left on phones */
  .bbh-crank { position: absolute; left: 50%; bottom: max(20px, env(safe-area-inset-bottom)); width: 250px; height: 250px; margin-left: -125px; pointer-events: auto; touch-action: none;
    cursor: grab; animation: bbh-in .4s cubic-bezier(.2,1.5,.5,1); -webkit-tap-highlight-color: transparent; }
  .bbh-crank svg { width: 100%; height: 100%; display: block; overflow: visible; }
  .bbh-crank .rot { transform-origin: 120px 120px; }
  .bbh-crank .knob { transform-box: fill-box; transform-origin: center; animation: bbh-pulse .85s ease-in-out infinite alternate; }
  .bbh-crank.held .knob { animation: none; stroke: #6fdacd; }
  .bbh.hint .bbh-crank .rim { animation: bbh-rim .5s ease-in-out infinite alternate; }
  @keyframes bbh-rim { to { stroke: #ffd45c; } }
  @media (max-height: 520px) {
    .bbh { --t: 66px; --bub: 46px; --hand: 62px; --rim: 5px; }
    .bbh-t.box { border-radius: 22px; }
    .bbh-hand.big { --hand: 76px; }
    .bbh-dot { width: 13px; height: 13px; left: -6.5px; top: -6.5px; box-shadow: 0 0 0 3px #19a79b; }
    .bbh-arrow { width: 28px; height: 28px; left: -14px; top: -14px; }
    .bbh-pop i { width: 14px; height: 14px; left: -7px; top: -7px; }
    .bbh-crank { left: max(30px, env(safe-area-inset-left)); bottom: auto; top: calc(50% - 76px); width: 196px; height: 196px; margin-left: 0; }
  }
  `);
  // a pointing hand cut from paper: cream skin, a deeper rim, a darker crescent on the lower right, a teal cuff
  const HAND = `<i class="bbh-rip"></i><svg viewBox="0 0 80 80"><g stroke="#d9a05f" stroke-width="3" stroke-linejoin="round">
    <rect x="23" y="4" width="16" height="42" rx="8" fill="#ffe2bd"/>
    <path d="M14 44 Q14 34 24 34 H50 Q62 34 62 46 V56 Q62 70 48 70 H30 Q14 70 14 56 Z" fill="#ffe2bd"/>
    <path d="M14 48 Q5 44 7 37 Q10 31 18 36" fill="#ffe2bd"/></g>
    <path d="M60 44 V56 Q60 68 48 68 H34 Q52 64 54 44 Z" fill="#f0c493"/>
    <path d="M35.5 8 V40 H32 Q34 24 31.5 7 Z" fill="#f0c493"/>
    <rect x="22" y="66" width="34" height="11" rx="5.5" fill="#19a79b" stroke="#127a71" stroke-width="3"/></svg>`;
  // the winch wheel: a cream drum with a coral rim, honey spokes and a round teal knob to hold (it wears the ring);
  // round it a track with little arrows that fills with teal as the car goes up
  const TRACK = 2 * Math.PI * 108;
  const CRANK = `<svg viewBox="0 0 240 240"><circle cx="123" cy="126" r="112" fill="rgba(120,80,40,.2)"/>
    <circle cx="120" cy="120" r="108" fill="none" stroke="#d9b57f" stroke-width="22"/><circle cx="120" cy="120" r="108" fill="none" stroke="#fff6e0" stroke-width="16"/>
    <g fill="#e3b877"><path d="M196 44 l10 13 -15 -2z" transform="rotate(8 196 48)"/><path d="M214 176 l-3 16 -11 -11z"/><path d="M52 204 l-16 -4 11 -11z"/><path d="M20 82 l7 -15 9 13z"/></g>
    <circle class="prog" cx="120" cy="120" r="108" fill="none" stroke="#19a79b" stroke-width="16" stroke-linecap="round" stroke-dasharray="${TRACK.toFixed(1)}" stroke-dashoffset="${TRACK.toFixed(1)}" transform="rotate(-90 120 120)"/>
    <g class="rot"><circle class="rim" cx="120" cy="120" r="84" fill="#fff6e0" stroke="#f26b5b" stroke-width="12"/>
    <path d="M179 179 A84 84 0 0 0 204 120 L192 120 A72 72 0 0 1 171 171 Z" fill="#c84a3c"/>
    <g stroke="#f5b83d" stroke-width="13" stroke-linecap="round"><path d="M120 120 V52 M120 120 L61 154 M120 120 L179 154"/></g>
    <circle cx="120" cy="120" r="23" fill="#f5b83d" stroke="#d98700" stroke-width="5"/><path d="M131 131 A16 16 0 0 0 136 120 A16 16 0 0 1 120 136 Z" fill="#d98700"/>
    <circle class="knob" cx="120" cy="48" r="33" fill="rgba(255,224,120,.3)" stroke="#ffd45c" stroke-width="6"/>
    <circle cx="120" cy="48" r="24" fill="#19a79b" stroke="#127a71" stroke-width="6"/><path d="M134 62 A20 20 0 0 0 140 48 A20 20 0 0 1 120 68 Z" fill="#127a71"/></g></svg>`;
  const STARS = ['#ffd45c', '#ff6b5c', '#19a79b', '#4fa3e0', '#ff8fab', '#fff6e0'];
  // counting notes: up a bright five-note scale, one step for each thing (semitones above C5)
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  const note = (j) => { try { const f = 523.25 * Math.pow(2, SCALE[Math.min(j, 9)] / 12); BB.tone(f, 0.2, { type: 'triangle', vol: 0.09 }); BB.tone(f * 2, 0.12, { type: 'sine', vol: 0.03, at: 0.02 }); } catch (e) { /* no sound */ } };
  const soft = (f, at) => { try { BB.tone(f, 0.08, { type: 'sine', vol: 0.04, at: at || 0 }); } catch (e) { /* no sound */ } };

  let layer = null, cur = null;
  const _v = new THREE.Vector3(), _hit = new THREE.Vector3(), _ndc = new THREE.Vector2();
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
  const again = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

  // The room the rings have: the screen, less the HUD's row along the top and the question card (read twice a
  // second, never every frame). A thing that stands under the card gets its ring at the card's edge, within reach.
  function measure(c) {
    const T = tsize();
    if (T !== c.T && c.kind !== 'aim') for (const t of c.targets) if (!t.box) t.w = t.h = T;      // (the screen was turned or resized)
    c.T = T; c.phone = innerHeight <= 520; c.topY = c.phone ? 58 : 78;
    const k = document.querySelector('.bbq:not(.out)');
    c.card = !!k;
    if (k) { const r = k.getBoundingClientRect(); c.cl = r.left - 4; c.ct = r.top - 4; c.cr = r.right + 4; c.cb = r.bottom + 4; }
    if (c.crank) { const r = c.crank.getBoundingClientRect(); c.kx = r.left + r.width / 2; c.ky = r.top + r.height / 2; c.kw = r.width; }
  }
  function keep(c, s, r) {
    const Wd = innerWidth, Hd = innerHeight, top = c.topY + r * 0.6;
    s.x = BB.clamp(s.x, r + 4, Wd - r - 4); s.y = BB.clamp(s.y, top, Hd - r - 4);
    if (c.card && s.x + r > c.cl && s.x - r < c.cr && s.y + r > c.ct && s.y - r < c.cb) {
      if (c.phone) s.x = Math.min(Wd - r - 4, c.cr + r); else s.y = Math.max(top, c.ct - r);
    }
  }
  // a whole big thing (the fire engine, the ice cream van): the ring goes round its box on screen
  function projBox(c, t) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
    for (let k = 0; k < t.box.length; k++) {
      if (!proj(t.box[k], _s)) continue;
      n++; if (_s.x < x0) x0 = _s.x; if (_s.x > x1) x1 = _s.x; if (_s.y < y0) y0 = _s.y; if (_s.y > y1) y1 = _s.y;
    }
    t.seen = n > 0; if (!n) return;
    const Wd = innerWidth, Hd = innerHeight;
    x0 = Math.max(x0 - 8, 8); x1 = Math.min(x1 + 8, Wd - 8); y0 = Math.max(y0 - 8, c.topY); y1 = Math.min(y1 + 8, Hd - 8);
    if (c.card) { if (c.phone) x0 = Math.max(x0, Math.min(c.cr, x1 - c.T)); else y1 = Math.min(y1, Math.max(c.ct, y0 + c.T)); }
    const w = Math.max(c.T, x1 - x0), h = Math.max(c.T, y1 - y0);
    t.sx = (x0 + x1) / 2; t.sy = (y0 + y1) / 2;
    if (Math.abs(w - t.w) > 2 || Math.abs(h - t.h) > 2) { t.w = w; t.h = h; t.el.style.setProperty('--w', w.toFixed(0) + 'px'); t.el.style.setProperty('--h', h.toFixed(0) + 'px'); }
    // the hand taps the thing's own spot (the door, the hatch) when it has one
    t.ax = t.sx; t.ay = t.sy;
    if (t.at) { t.at(t.p); if (proj(t.p, _s)) { t.ax = BB.clamp(_s.x, t.sx - w / 2 + 24, t.sx + w / 2 - 24); t.ay = BB.clamp(_s.y, t.sy - h / 2 + 24, t.sy + h / 2 - 24); } }
  }
  // 0 in the middle of a target .. 1 at the edge of its reach (a generous third beyond the ring)
  function reach(t, x, y) {
    if (t.box) return hypot2(Math.max(0, Math.abs(x - t.sx) - t.w / 2), Math.max(0, Math.abs(y - t.sy) - t.h / 2)) / 20;
    return hypot2(x - t.hx, y - t.hy) / (t.w * 0.66);
  }
  // the next thing to touch: the one the child last reached for, else the first in the list
  function next(c) {
    if (c.focus >= 0 && !c.targets[c.focus].used) return c.focus;
    for (let i = 0; i < c.targets.length; i++) if (!c.targets[i].used) return i;
    return -1;
  }
  // which target a finger at (x, y) means: the nearest one in reach (things that share a ring: any of them, also
  // the place of one that has just gone, means the next one), or -1
  function pick(c, x, y) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < c.targets.length; i++) {
      const t = c.targets[i];
      if (!t.seen || (t.used && !c.shared)) continue;
      const d = reach(t, x, y);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0 || bd > 1) return -1;
    return c.shared ? next(c) : best;
  }
  function nearest(c, x, y) {
    if (c.shared) return next(c);
    let best = -1, bd = 1e9;
    for (let i = 0; i < c.targets.length; i++) { const t = c.targets[i]; if (t.used || !t.seen) continue; const d = hypot2(x - t.hx, y - t.hy); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  // do the things still to touch all stand clear of each other (so each can wear its own ring)? If any two are
  // closer than a ring, only the next one wears it: all the rings or one, never some of them
  function apart(c) {
    const lim = c.T * 0.98, n = c.targets.length;
    for (let i = 0; i < n; i++) {
      const t = c.targets[i]; if (t.used || !t.seen) continue;
      for (let j = i + 1; j < n; j++) {
        const u = c.targets[j];
        if (u.used || !u.seen) continue;
        if (hypot2(t.sx - u.sx, t.sy - u.sy) < lim) return false;
      }
    }
    return true;
  }

  function burst(c, x, y) {
    const a = anchor(); a.className = 'bbh-at bbh-pop';
    a.style.transform = 'translate(' + x.toFixed(0) + 'px,' + y.toFixed(0) + 'px)';
    BB.el('b', '', a);
    for (let i = 0; i < 6; i++) {
      const s = BB.el('i', '', a), an = i / 6 * Math.PI * 2 + 0.5, d = c.T * 0.85;
      s.style.setProperty('--c', STARS[i]); s.style.setProperty('--dx', Math.round(Math.cos(an) * d) + 'px'); s.style.setProperty('--dy', Math.round(Math.sin(an) * d) + 'px');
    }
    BB.later(700, () => a.remove());
  }
  function bubble(c, j, idx) {
    const a = anchor(), b = { a, p: new THREE.Vector3(), t: 0 };
    BB.el('div', 'bbh-bub', a, String(j + 1));
    const t = c.targets[idx];
    if (c.o.bubble) c.o.bubble(j, idx, b.p); else if (t && t.at) t.at(b.p); else if (t && t.box) b.p.copy(t.box[0]);
    for (const o of c.bubbles) o.old = true;
    c.bubbles.push(b);
  }
  // counting aloud: one, two, three. Never over the invitation, and the numbers never cut each other off; a hint
  // that is still being said when the child counts is cut (it isn't needed any more).
  function count(c, n) {
    const wait = c.inviting || c.nums > 0;
    c.nums++;
    BB.say(String(n), { queue: wait }).then(() => { c.nums = Math.max(0, c.nums - 1); });
  }
  // one action done (by the finger, or by the game when auto is true)
  function did(c, idx, auto) {
    if (cur !== c || c.done >= c.count) return;
    const t = c.targets[idx];
    if (t && !c.o.repeat) { if (t.used) return; t.used = true; t.ring = false; t.el.classList.remove('ring', 'held'); }
    const j = c.done++;
    c.idle = auto ? AUTO_AT - AUTO_GAP : 0;
    c.misses = 0; c.focus = -1;
    c.quietUntil = performance.now() + 240;            // (a quick double tap counts once)
    if (t) { burst(c, t.follow ? t.fx : t.box ? t.ax : t.sx, t.follow ? t.fy : t.box ? t.ay : t.sy); t.follow = false; }
    bubble(c, j, idx);
    note(j);
    count(c, j + 1);
    let r = null;
    try { r = c.o.act ? c.o.act(j, idx, !!auto) : null; } catch (e) { console.error(e); }
    if (r && typeof r.then === 'function') c.pending.push(r.catch((e) => console.error(e)));
    if (c.done >= c.count) finish(c, true);
  }
  // a touch that missed: no "wrong", just a little wiggle of the nearest ring, and the hand goes there
  function miss(c, x, y) {
    c.misses++; c.since = 9;
    soft(523, 0); soft(659, 0.07);
    const i = nearest(c, x, y);
    if (i >= 0) { if (!c.shared) c.focus = i; const t = c.targets[i]; t.ring = true; t.el.classList.add('ring'); again(t.el, 'nudge'); }
    else if (c.crank) again(c.crank, 'nudge');
    if (c.misses >= 4) c.idle = Math.max(c.idle, AUTO_AT);              // the game shows how: it does one
    else if (c.misses >= 2 && !c.hinted) c.idle = Math.max(c.idle, HINT_AT);
  }
  function finish(c, ok) {
    if (c.ended) return;
    c.ended = true;
    for (const t of c.targets) t.a.remove();
    for (const d of c.dots) d.remove();
    if (c.hand) c.hand.remove();
    if (c.drop) c.drop.remove();
    if (c.pad) c.pad.remove();
    if (c.crank) c.crank.remove();
    if (layer) layer.className = 'bbh';
    const done = () => { for (const b of c.bubbles) b.a.remove(); c.bubbles.length = 0; if (cur === c) cur = null; };
    if (!ok) { done(); c.resolve(false); return; }
    BB.later(260, () => { try { BB.sfx.sparkle(); } catch (e) { /* no sound */ } });
    c.closing = 1.3;                                   // the last number stays a moment (H.update clears it)
    c.done2 = done;
    Promise.all(c.pending).then(() => c.resolve(!c.stopped));
  }
  // the finger lets go (or the touch is taken away): a thing in the hand lands, a plain tap counts
  function letGo(c, moved, act) {
    const i = c.grab; c.grab = -1; c.pid = null; c.down = false;
    if (c.crank) c.crank.classList.remove('held');
    if (c.ignore) { c.ignore = false; return; }           // (a touch on nothing: the hand stays, pointing)
    c.since = 0;
    if (i < 0) return;
    const t = c.targets[i]; if (!t) return;
    t.el.classList.remove('held'); c.dragging = null;
    if (c.drop && c.near) { c.near = false; c.drop.firstChild.classList.remove('near'); }
    if (c.kind === 'drag' && moved && c.o.drag) { try { c.o.drag(i, null); } catch (err) { console.error(err); } }
    if (act) did(c, i, false); else t.follow = false;
  }

  H.run = function (o) {
    H.stop();
    return new Promise((resolve) => {
      const kind = o.kind || 'tap';
      const c = cur = { o, kind, count: Math.max(1, o.count | 0), done: 0, idle: 0, hinted: false, targets: [], bubbles: [], pending: [], dots: [], resolve, ended: false,
        closing: null, hand: null, drop: null, pad: null, crank: null, dragging: null, t: 0, p: 0, shared: !!(o.ordered || o.repeat), pid: null, down: false, grab: -1,
        moved: false, ignore: false, since: 9, misses: 0, focus: -1, quietUntil: 0, inviting: !!o.say, nums: 0, safeT: 0, pose: '', near: false, ang: 0,
        T: tsize(), phone: false, topY: 78, card: false, cl: 0, ct: 0, cr: 0, cb: 0, kx: 0, ky: 0, kw: 0, dx: 0, dy: 0, dropOn: false, pathOn: false, px0: 0, py0: 0, px1: 0, py1: 0, aimT: 0 };
      const L = root();
      L.className = 'bbh ' + kind;
      L.style.removeProperty('--t');
      // the whole view takes the finger (the HUD and the card sit on top and keep their own taps): one finger at a
      // time, the nearest thing in reach, and a touch on nothing is noticed too
      c.pad = BB.el('div', 'bbh-pad', L);
      const aim = (e) => { c.idle = 0; c.misses = 0; try { o.aim(e.clientX, e.clientY); } catch (err) { console.error(err); } };
      c.pad.addEventListener('pointerdown', (e) => {
        if (cur !== c || c.ended) return;
        e.preventDefault();
        if (c.pid != null) return;                       // one finger only
        c.pid = e.pointerId; c.down = true; c.ignore = false; c.grab = -1; c.moved = false; c.sx0 = e.clientX; c.sy0 = e.clientY;
        try { c.pad.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        if (kind === 'aim') { aim(e); return; }
        if (performance.now() < c.quietUntil) { c.ignore = true; return; }
        const i = kind === 'crank' ? -1 : pick(c, e.clientX, e.clientY);
        if (i < 0) { c.ignore = true; miss(c, e.clientX, e.clientY); return; }
        c.grab = i; c.idle = 0;
        const t = c.targets[i];
        t.el.classList.add('held'); soft(784, 0);
        if (kind === 'drag') {
          c.dragging = t; t.fx = e.clientX; t.fy = e.clientY;
          // (the thing never flies off to the horizon: it stays within a fair way of where it is going)
          c.far = 8;
          if (c.drop) { t.at(t.p); o.drop(c.dropP, i); c.far = Math.max(8, 1.6 * hypot2(t.p.x - c.dropP.x, t.p.z - c.dropP.z)); }
        }
      });
      c.pad.addEventListener('pointermove', (e) => {
        if (e.pointerId !== c.pid || cur !== c || c.ended) return;
        if (kind === 'aim') { aim(e); return; }
        if (c.ignore || c.grab < 0 || kind !== 'drag') return;
        if (!c.moved && Math.abs(e.clientX - c.sx0) + Math.abs(e.clientY - c.sy0) > 8) c.moved = true;
        if (!c.moved) return;
        c.idle = 0;
        const t = c.targets[c.grab], g = ground(e.clientX, e.clientY, o.plane || 0, _hit);
        if (g && c.drop) { const ddx = g.x - c.dropP.x, ddz = g.z - c.dropP.z, dl = hypot2(ddx, ddz); if (dl > c.far) { g.x = c.dropP.x + ddx / dl * c.far; g.z = c.dropP.z + ddz / dl * c.far; } }
        if (g && o.drag) { try { o.drag(c.grab, g); } catch (err) { console.error(err); } }
        t.fx = e.clientX; t.fy = e.clientY; t.follow = true;
      });
      const up = (e) => { if (e.pointerId !== c.pid) return; unlock(); const moved = c.moved; letGo(c, moved, kind !== 'aim' && (e.type === 'pointerup' || moved)); };
      c.pad.addEventListener('pointerup', up); c.pad.addEventListener('pointercancel', up);
      if (kind === 'crank') {
        c.count = 1;
        c.crank = BB.el('div', 'bbh-crank', L, CRANK);
        c.rot = c.crank.querySelector('.rot'); c.prog = c.crank.querySelector('.prog'); c.tick = 0;
        const angle = (e) => Math.atan2(e.clientY - c.ky, e.clientX - c.kx);
        const turn = (d) => {
          if (c.ended) return;
          c.ang += d; c.p = Math.min(1, c.p + Math.abs(d) / (Math.PI * 2 * (o.turns || 3)));
          c.rot.style.transform = 'rotate(' + (c.ang * 57.2958).toFixed(1) + 'deg)';
          c.prog.style.strokeDashoffset = (TRACK * (1 - c.p)).toFixed(1);
          c.tick += Math.abs(d); if (c.tick > 0.8) { c.tick = 0; try { BB.tone(440 + 440 * c.p, 0.05, { type: 'sine', vol: 0.06 }); } catch (e) { /* none */ } }   // (the clicks climb as the car goes up)
          try { if (o.turn) o.turn(c.p); } catch (err) { console.error(err); }
          if (c.p >= 1) {
            try { if (o.act) { const r = o.act(0, 0, !!c.autoOn); if (r && r.then) c.pending.push(r); } } catch (err) { console.error(err); }
            c.done = 1; burst(c, c.kx, c.ky); note(4); finish(c, true);
          }
        };
        c.turnBy = turn;
        c.crank.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          if (c.pid != null) return;
          measure(c);
          c.pid = e.pointerId; c.down = true; c.ignore = false; c.grab = -1; c.last = angle(e); c.moved = 0; c.idle = 0; c.misses = 0;
          c.crank.classList.add('held');
          try { c.crank.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        });
        c.crank.addEventListener('pointermove', (e) => {
          if (e.pointerId !== c.pid || !c.down) return;
          const a = angle(e); let d = a - c.last; c.last = a;
          if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
          c.moved += Math.abs(d); c.idle = 0; c.autoOn = false;
          turn(d);
        });
        const cup = (e) => {
          if (e.pointerId !== c.pid) return;
          const tap = e.type === 'pointerup' && c.moved < 0.15;
          unlock(); letGo(c, false, false);
          if (tap) turn(Math.PI / 2.5);                  // a tap gives a little turn too
        };
        c.crank.addEventListener('pointerup', cup); c.crank.addEventListener('pointercancel', cup);
      }
      (o.targets || []).forEach((tg) => {
        const fn = typeof tg === 'function', a = anchor(), el = BB.el('div', 'bbh-t' + (!fn && tg.box ? ' box' : ''), a, '<i></i>');
        c.targets.push({ at: fn ? tg : tg.at || null, box: fn ? null : tg.box || null, a, el, used: false, ring: false, seen: false, follow: false, p: new THREE.Vector3(),
          sx: 0, sy: 0, hx: 0, hy: 0, ax: 0, ay: 0, fx: 0, fy: 0, w: c.T, h: c.T });
      });
      if (kind === 'drag' && o.drop) {
        c.drop = anchor(); BB.el('div', 'bbh-drop', c.drop); c.dropP = new THREE.Vector3();
        for (let i = 0; i < 6; i++) { const d = anchor(); BB.el('div', i < 5 ? 'bbh-dot' : 'bbh-arrow', d, i < 5 ? null : '<b></b>'); if (i < 5) d.firstChild.style.animationDelay = (i * 0.15 - 1.2).toFixed(2) + 's'; d._on = false; d.style.display = 'none'; c.dots.push(d); }
      }
      c.hand = anchor(); c.handEl = BB.el('div', 'bbh-hand', c.hand, HAND);
      measure(c);
      if (o.say) { const end = () => { c.inviting = false; }; BB.say(o.say, { queue: true }).then(end, end); }
      H.update(0);
    });
  };
  // the scene says target idx was hit (aim)
  H.hit = (idx) => { if (cur && !cur.ended) did(cur, idx, !!cur.autoOn); };
  H.active = () => !!(cur && !cur.ended);
  H.stop = function () { const c = cur; if (!c) return; if (c.ended) { c.stopped = true; if (c.done2) c.done2(); c.closing = null; cur = null; return; } finish(c, false); };
  // (a hold, or the page hidden, takes the finger away: whatever it held stays where it is, ready to be touched again)
  BB.on('held', (d) => { const c = cur; if (d && d.on && c && !c.ended && c.pid != null) letGo(c, c.kind === 'drag' && !!c.moved, false); });
  H.state = function () {
    const c = cur; if (!c || c.ended) return { on: false };
    return { on: true, kind: c.kind, done: c.done, count: c.count, idle: +c.idle.toFixed(2), hinted: c.hinted, p: +c.p.toFixed(3), misses: c.misses, size: c.T,
      targets: c.targets.map((t) => ({ used: t.used, x: t.sx, y: t.sy, w: t.w, h: t.h, on: t.seen, ring: t.ring })),
      drop: c.drop ? { x: c.dx, y: c.dy } : null, crank: c.crank ? { x: c.kx, y: c.ky, r: c.kw / 2 } : null };
  };

  function pose(c, p) { if (c.pose !== p) { c.pose = p; c.handEl.className = 'bbh-hand ' + p + (c.hinted ? ' big' : ''); } }
  // the k-th thing still to do (aim: the hand slides from one to the next)
  function liveAt(c, k) { for (let i = 0; i < c.targets.length; i++) { const t = c.targets[i]; if (t.used || !t.seen) continue; if (k-- === 0) return t; } return null; }
  function hidePath(c) { if (!c.pathOn) return; c.pathOn = false; for (let i = 0; i < c.dots.length; i++) place(c.dots[i], 0, 0, false); }
  // the dotted path: five dots in a gentle arc from the thing to the drop place, and an arrowhead
  function showPath(c, x0, y0, x1, y1, arc) {
    if (c.pathOn && Math.abs(x0 - c.px0) + Math.abs(y0 - c.py0) + Math.abs(x1 - c.px1) + Math.abs(y1 - c.py1) < 1) return;
    c.pathOn = true; c.px0 = x0; c.py0 = y0; c.px1 = x1; c.py1 = y1;
    const len = hypot2(x1 - x0, y1 - y0) || 1, a = c.T * 0.5 / len, b = 1 - c.T * 0.62 / len;      // (from the ring's edge to the drop's edge)
    for (let i = 0; i < 6; i++) {
      const v = a + (b - a) * (i / 5);
      place(c.dots[i], x0 + (x1 - x0) * v, y0 + (y1 - y0) * v - Math.sin(v * Math.PI) * arc, true);
    }
    const ang = Math.atan2((y1 - y0) + Math.cos(b * Math.PI) * Math.PI * arc * -1, x1 - x0);
    c.dots[5].firstChild.style.transform = 'rotate(' + (ang * 57.2958).toFixed(0) + 'deg)';
  }
  // the pointing hand shows the gesture, from the start
  function gesture(c, nx) {
    const hide = c.down || c.since < 0.7;
    if (c.kind === 'crank') {
      // on the knob, then once round the wheel
      const u = c.t % 3.4, k = c.kw * 0.3, sw = BB.smooth((u - 0.5) / 2.0) * Math.PI * 1.8, a = c.ang - Math.PI / 2 + sw;
      pose(c, u < 0.3 || u > 2.7 ? 'lift' : 'press');
      place(c.hand, c.kx + Math.cos(a) * k, c.ky + Math.sin(a) * k, !hide && c.kw > 0 && u < 3.0);
      return;
    }
    const t = nx >= 0 ? c.targets[nx] : null;
    if (!t || !t.seen) { place(c.hand, 0, 0, false); hidePath(c); return; }
    const x = t.box ? t.ax : t.hx, y = t.box ? t.ay : t.hy;
    if (c.kind === 'drag' && c.drop && c.dropOn) {
      // press on the thing, carry it along the path, let go on the drop place
      const len = hypot2(c.dx - x, c.dy - y), arc = Math.min(54, len * 0.2);
      if (hide || len < c.T * 1.25) hidePath(c); else showPath(c, x, y, c.dx, c.dy, arc);
      const u = c.t % 3.0, v = BB.smooth((u - 0.55) / 1.25);
      pose(c, u < 0.3 || u > 1.95 ? 'lift' : 'press');
      place(c.hand, x + (c.dx - x) * v, y + (c.dy - y) * v - Math.sin(v * Math.PI) * arc, !hide && u < 2.45);
      return;
    }
    if (c.kind === 'aim') {
      // finger down, sliding from one glowing window to the next
      let n = 0; for (let i = 0; i < c.targets.length; i++) if (!c.targets[i].used && c.targets[i].seen) n++;
      const seg = Math.floor(c.t / 1.4), v = BB.smooth((c.t % 1.4) / 0.55);
      const to = liveAt(c, seg % n) || t, from = liveAt(c, (seg + n - 1) % n) || to;
      pose(c, 'press');
      place(c.hand, from.sx + (to.sx - from.sx) * v, from.sy + (to.sy - from.sy) * v + c.aimT * 0.12, !hide);
      return;
    }
    hidePath(c);
    pose(c, 'tap');
    place(c.hand, x, y, !hide);
  }

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
    c.t += dt; c.since += dt;
    if ((c.safeT -= dt) <= 0) { c.safeT = 0.5; measure(c); }
    const o = c.o, nx = next(c);
    // where every thing is on screen
    for (let i = 0; i < c.targets.length; i++) {
      const t = c.targets[i]; if (t.used) continue;
      if (t.box) projBox(c, t);
      else { t.at(t.p); t.seen = proj(t.p, _s); if (t.seen) { keep(c, _s, t.w / 2); t.sx = _s.x; t.sy = _s.y; } }
      if (!t.follow) { t.hx = t.sx; t.hy = t.sy; }
    }
    // aiming: the rings are only marks (the whole view is the pad), as big as the windows' spacing allows
    if (c.kind === 'aim' && !c.aimT) {
      let g = c.T;
      for (let i = 0; i < c.targets.length; i++) for (let j = i + 1; j < c.targets.length; j++) { const a = c.targets[i], b = c.targets[j]; if (a.seen && b.seen) g = Math.min(g, hypot2(a.sx - b.sx, a.sy - b.sy) * 0.94); }
      c.aimT = Math.max(40, g);
      layer.style.setProperty('--t', c.aimT.toFixed(0) + 'px');
      for (let i = 0; i < c.targets.length; i++) c.targets[i].w = c.targets[i].h = c.aimT;
    }
    // the rings: always on the next thing; on the others too when they all stand well apart (never two overlapping)
    // (while a thing is carried, only it wears its ring: the drop place is what matters then)
    const carried = c.dragging && c.dragging.follow ? c.dragging : null;
    const all = c.kind === 'aim' || (!c.shared && !carried && apart(c));
    for (let i = 0; i < c.targets.length; i++) {
      const t = c.targets[i]; if (t.used) continue;
      const ring = t.seen && (carried ? t === carried : i === nx || all);
      if (ring !== t.ring) { t.ring = ring; t.el.classList.toggle('ring', ring); }
      if (t.follow) place(t.a, t.fx, t.fy, true);       // under the finger while it is carried
      else place(t.a, t.sx, t.sy, t.seen);
    }
    if (c.drop) {
      o.drop(c.dropP, carried ? c.targets.indexOf(carried) : nx); c.dropOn = proj(c.dropP, _s);
      if (c.dropOn) { keep(c, _s, c.T * 0.6); c.dx = _s.x; c.dy = _s.y; }
      place(c.drop, c.dx, c.dy, c.dropOn);
      const near = !!(c.dragging && c.dragging.follow && hypot2(c.dragging.fx - c.dx, c.dragging.fy - c.dy) < c.T);
      if (near !== c.near) { c.near = near; c.drop.firstChild.classList.toggle('near', near); }
    }
    gesture(c, nx);
    // waiting for a finger: a hint, then the game helps
    if (asking() || c.down || c.dragging) return;
    if (c.inviting && c.t < 7) return;                  // (the waiting starts when the invitation has been said)
    c.idle += dt;
    if (!c.hinted && c.idle >= HINT_AT) {
      c.hinted = true; c.pose = ''; layer.classList.add('hint');
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
