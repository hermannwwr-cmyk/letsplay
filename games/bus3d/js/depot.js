/* Bendy Bus 3D: the depot ("garage") and the economy.
   Cash (bus3d.cash, never taken away except when the child buys something), the saved progress (BB.save, stored as
   bus3d.save by core.js) and the garage screen, opened when the bus pulls in at the depot:
   - the bus rises on a striped turntable lift that sways gently, a 3D fuel pump in front of it, a striped awning;
   - a paper panel with big picture tabs: Fuel, Paint, Stickers, Hats, Extras (spoken on tap);
   - the first tap on something new previews it live on the bus and says its price, a second tap buys it
     (coin jingle, coins fly from the counter); too few coins -> "Let's do more jobs!" and a coin goal to aim for;
   - fuel is never refused: short of coins, the rest is free.
   Stickers and hats are built here and hung on BB.bus.stickerAnchors / BB.bus.hatMount when bus.js provides them
   (otherwise on fallback spots on the carriages).
   Exposes BB.depot = { open(), close(), cash, add(n), spend(n), save, applyLooks(), update(dt) };
   emits cash:changed, depot:open, depot:closed. */
(function () {
  'use strict';
  const BB = window.BB, P = BB.P;
  const D = BB.depot = { cash: Math.max(0, BB.store.get('cash', 0) | 0), save: BB.save, isOpen: false };
  const S = BB.save;

  D.add = function (n) {
    n = Math.max(0, n | 0); if (!n) return;
    D.cash += n; BB.store.set('cash', D.cash);
    BB.emit('cash:changed', { cash: D.cash, delta: n });
  };
  D.spend = function (n) {
    if (D.cash < n) return false;
    D.cash -= n; BB.store.set('cash', D.cash);
    BB.emit('cash:changed', { cash: D.cash, delta: -n });
    return true;
  };

  // ---------- the shop ----------
  const PAINT_PRICE = 3;               // cheap enough that the first garage visit can buy something
  const STICKERS = [
    { id: 'star', say: 'A star sticker!', price: 4, name: 'star' }, { id: 'heart', say: 'A heart sticker!', price: 4, name: 'heart' },
    { id: 'flower', say: 'A flower sticker!', price: 4, name: 'flower' }, { id: 'rainbow', say: 'A rainbow sticker!', price: 5, name: 'rainbow' },
    { id: 'cat', say: 'A cat sticker!', price: 5, name: 'cat' }, { id: 'otter', say: 'An otter sticker!', price: 5, name: 'otter' },
  ];
  const HATS = [
    { id: 'party', say: 'A party hat!', price: 5, love: 'I love my party hat!' }, { id: 'flowers', say: 'A flower crown!', price: 6, love: 'I love my flower crown!' },
    { id: 'bunny', say: 'Bunny ears!', price: 8, love: 'I love my bunny ears!' }, { id: 'crown', say: 'A golden crown!', price: 10, love: 'I love my golden crown!' },
  ];
  // Upgrades are fun, never needed.
  const UPGRADES = [
    { id: 'horn', say: 'A horn that plays a tune!', price: 12, love: 'I love my new horn! Toot toot!' },
    { id: 'lights', say: 'Super bright headlights!', price: 15, love: 'I love my bright lights!' },
    { id: 'sticker3', say: 'A super sticker spot! Now the bus can wear three stickers.', price: 20, love: 'I love my super sticker spot!' },
  ];
  const PAINT_SAY = { green: 'Green!', red: 'Red!', blue: 'Blue!', yellow: 'Yellow!', purple: 'Purple!', pink: 'Pink!' };
  const TABS = [
    { id: 'fuel', say: 'Fuel!' }, { id: 'paint', say: 'Paint!' }, { id: 'sticker', say: 'Stickers!' },
    { id: 'hat', say: 'Hats!' }, { id: 'upgrade', say: 'Super extras!' },
  ];
  const slots = () => (S.upgrades.sticker3 ? 3 : 2);
  if (!S.paints.includes('green')) S.paints.unshift('green');
  S.stickers = S.stickers.filter((id) => STICKERS.some((s) => s.id === id)).slice(0, slots());
  if (S.hat && !HATS.some((h) => h.id === S.hat)) S.hat = null;

  // ---------- pictures (paper-cut look: flat shapes, a darker crescent lower right, die-cut white edge) ----------
  const cache = {};
  function mkCanvas(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }
  function dark(hex, t = 0.22) { return BB.ui && BB.ui.darkHex ? BB.ui.darkHex(hex, t) : hex; }
  // Draw fn(x) on a 100x100 board, then add a white sticker edge around it.
  function art(key, size, fn, edge = 0) {
    const k = key + ':' + size + ':' + edge;
    if (cache[k]) return cache[k];
    const a = mkCanvas(size), x = a.getContext('2d');
    x.scale(size / 100, size / 100); x.lineJoin = x.lineCap = 'round';
    fn(x);
    let out = a;
    if (edge) {
      const w = mkCanvas(size), wx = w.getContext('2d');
      wx.drawImage(a, 0, 0); wx.globalCompositeOperation = 'source-in'; wx.fillStyle = '#ffffff'; wx.fillRect(0, 0, size, size);
      out = mkCanvas(size); const o = out.getContext('2d'), r = edge * size / 100;
      o.globalAlpha = 0.25; o.drawImage(w, r * 0.4, r * 0.9); o.globalAlpha = 1;   // soft lift
      for (let i = 0; i < 16; i++) { const t = i / 16 * Math.PI * 2; o.drawImage(w, Math.cos(t) * r, Math.sin(t) * r); }
      o.drawImage(a, 0, 0);
    }
    cache[k] = out;
    return out;
  }
  const circ = (x, X, Y, R, f) => { x.beginPath(); x.arc(X, Y, R, 0, Math.PI * 2); x.fillStyle = f; x.fill(); };
  const ell = (x, X, Y, RX, RY, f, rot = 0) => { x.beginPath(); x.ellipse(X, Y, RX, RY, rot, 0, Math.PI * 2); x.fillStyle = f; x.fill(); };
  // Paper-cut shading: the shape in a deeper tone, then the shape again nudged up-left, so a darker crescent shows
  // on its lower right.
  function shaded(x, build, f) {
    const p = new Path2D(); build(p);
    x.fillStyle = dark(f, 0.2); x.fill(p);
    x.save(); x.clip(p); x.translate(-5, -6); x.fillStyle = f; x.fill(p); x.restore();
  }
  function starPath(p, cx, cy, R, r, n = 5) {
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + i * Math.PI / n, rad = i % 2 ? r : R;
      i ? p.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad) : p.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    p.closePath();
  }
  function heartPath(p, cx, cy, s) {
    p.moveTo(cx, cy + 30 * s);
    p.bezierCurveTo(cx - 44 * s, cy + 2 * s, cx - 30 * s, cy - 36 * s, cx, cy - 16 * s);
    p.bezierCurveTo(cx + 30 * s, cy - 36 * s, cx + 44 * s, cy + 2 * s, cx, cy + 30 * s);
    p.closePath();
  }
  const face = (x, cx, cy, eye = '#3a2a3c') => {
    circ(x, cx - 9, cy, 3.6, eye); circ(x, cx + 9, cy, 3.6, eye);
    circ(x, cx - 8, cy - 1.2, 1.1, '#fff'); circ(x, cx + 10, cy - 1.2, 1.1, '#fff');
  };
  const STICKER_ART = {
    star: (x) => shaded(x, (p) => starPath(p, 50, 53, 42, 19), P.honey),
    heart: (x) => { shaded(x, (p) => heartPath(p, 50, 52, 1.05), P.coral); ell(x, 34, 38, 6, 4, 'rgba(255,255,255,.55)', -0.6); },
    flower: (x) => {
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; shaded(x, (p) => p.ellipse(50 + Math.cos(a) * 24, 50 + Math.sin(a) * 24, 17, 17, 0, 0, Math.PI * 2), P.rose); }
      shaded(x, (p) => p.arc(50, 50, 15, 0, Math.PI * 2), P.honeyLight);
    },
    rainbow: (x) => {
      const cols = [P.coral, '#ff9a3c', P.honeyLight, P.leaf, '#4fa3e0'];
      cols.forEach((c, i) => { x.beginPath(); x.arc(50, 70, 42 - i * 7, Math.PI, 0); x.lineWidth = 7.5; x.strokeStyle = c; x.lineCap = 'butt'; x.stroke(); });
      for (const cx of [14, 86]) { circ(x, cx, 72, 11, '#ffffff'); circ(x, cx + (cx < 50 ? 9 : -9), 75, 9, '#f2ecf5'); }
    },
    cat: (x) => {
      const c = '#f5a04a';
      shaded(x, (p) => { p.moveTo(18, 40); p.lineTo(24, 10); p.lineTo(44, 28); p.closePath(); }, c);
      shaded(x, (p) => { p.moveTo(82, 40); p.lineTo(76, 10); p.lineTo(56, 28); p.closePath(); }, c);
      shaded(x, (p) => p.ellipse(50, 55, 36, 32, 0, 0, Math.PI * 2), c);
      ell(x, 50, 66, 14, 10, '#fff1dc'); face(x, 50, 50);
      x.beginPath(); x.moveTo(46, 60); x.lineTo(54, 60); x.lineTo(50, 65); x.closePath(); x.fillStyle = P.rose; x.fill();
      x.strokeStyle = '#c2702a'; x.lineWidth = 2.5;
      x.beginPath(); x.moveTo(50, 22); x.lineTo(50, 32); x.moveTo(42, 24); x.lineTo(44, 33); x.moveTo(58, 24); x.lineTo(56, 33); x.stroke();
    },
    otter: (x) => {
      const c = '#a8724a';
      circ(x, 20, 34, 10, dark(c, 0.15)); circ(x, 80, 34, 10, dark(c, 0.15));
      shaded(x, (p) => p.ellipse(50, 54, 38, 34, 0, 0, Math.PI * 2), c);
      ell(x, 50, 66, 22, 15, '#f3dcc0'); face(x, 50, 48);
      ell(x, 50, 59, 6, 4.2, '#3a2a3c');
      x.strokeStyle = '#3a2a3c'; x.lineWidth = 2.4; x.beginPath(); x.moveTo(50, 63); x.quadraticCurveTo(45, 70, 41, 66); x.moveTo(50, 63); x.quadraticCurveTo(55, 70, 59, 66); x.stroke();
    },
  };
  const HAT_ART = {
    party: (x) => {
      shaded(x, (p) => { p.moveTo(50, 8); p.lineTo(80, 84); p.lineTo(20, 84); p.closePath(); }, P.berry);
      x.save(); const cl = new Path2D(); cl.moveTo(50, 8); cl.lineTo(80, 84); cl.lineTo(20, 84); cl.closePath(); x.clip(cl);
      x.fillStyle = P.honeyLight; for (let i = 0; i < 4; i++) { x.save(); x.translate(50, 30 + i * 17); x.rotate(-0.35); x.fillRect(-40, -3.5, 80, 7); x.restore(); }
      x.restore();
      circ(x, 50, 9, 9, P.coral); circ(x, 47, 6, 3, '#ffb3a9');
      shaded(x, (p) => p.ellipse(50, 85, 33, 8, 0, 0, Math.PI * 2), P.coral);
    },
    flowers: (x) => {
      shaded(x, (p) => p.ellipse(50, 66, 42, 13, 0, 0, Math.PI * 2), P.leaf);
      const cols = [P.rose, P.honeyLight, P.coral, '#c9a7f0', P.rose];
      cols.forEach((c, i) => {
        const cx = 16 + i * 17, cy = 58 - Math.sin((i / 4) * Math.PI) * 14;
        for (let k = 0; k < 5; k++) { const a = k * Math.PI * 0.4; circ(x, cx + Math.cos(a) * 7, cy + Math.sin(a) * 7, 6, c); }
        circ(x, cx, cy, 4.5, P.honey);
      });
    },
    bunny: (x) => {
      for (const s of [-1, 1]) {
        x.save(); x.translate(50 + s * 16, 50); x.rotate(s * 0.18);
        shaded(x, (p) => p.ellipse(0, -10, 12, 36, 0, 0, Math.PI * 2), '#fbf3f6');
        ell(x, 0, -8, 6, 26, '#ffb7c9');
        x.restore();
      }
      shaded(x, (p) => p.ellipse(50, 86, 36, 8, 0, 0, Math.PI * 2), '#f2e6ec');
    },
    crown: (x) => {
      shaded(x, (p) => { p.moveTo(14, 82); p.lineTo(14, 34); p.lineTo(32, 54); p.lineTo(50, 22); p.lineTo(68, 54); p.lineTo(86, 34); p.lineTo(86, 82); p.closePath(); }, P.honey);
      x.fillStyle = P.honeyDark; x.fillRect(14, 70, 72, 6);
      circ(x, 50, 60, 6, P.coral); circ(x, 30, 64, 4.5, '#4fa3e0'); circ(x, 70, 64, 4.5, P.leaf);
      for (const [cx, cy] of [[14, 32], [50, 20], [86, 32]]) circ(x, cx, cy, 5, P.honeyLight);
    },
  };
  const ICON_ART = {
    fuel: (x) => { x.drawImage(BB.pic('pump', 100), 0, 0); },
    paint: (x) => {   // a paint pot with a drip
      shaded(x, (p) => { p.moveTo(22, 36); p.lineTo(78, 36); p.lineTo(72, 88); p.quadraticCurveTo(50, 94, 28, 88); p.closePath(); }, '#cfd6de');
      shaded(x, (p) => p.ellipse(50, 36, 29, 9, 0, 0, Math.PI * 2), P.coral);
      shaded(x, (p) => { p.moveTo(32, 38); p.lineTo(40, 38); p.lineTo(40, 58); p.arc(36, 58, 4, 0, Math.PI); p.closePath(); }, P.coral);
      x.strokeStyle = '#8f98a3'; x.lineWidth = 4; x.beginPath(); x.arc(50, 36, 34, Math.PI * 1.05, Math.PI * 1.95); x.stroke();
      shaded(x, (p) => { p.moveTo(64, 6); p.lineTo(82, 14); p.lineTo(70, 40); p.lineTo(58, 34); p.closePath(); }, P.woodLight);
      shaded(x, (p) => { p.moveTo(58, 34); p.lineTo(70, 40); p.lineTo(66, 50); p.lineTo(54, 44); p.closePath(); }, P.teal);
    },
    sticker: (x) => { x.drawImage(art('st-star', 100, STICKER_ART.star, 7), 0, 0); },
    hat: (x) => { x.drawImage(art('hat-party', 100, HAT_ART.party), 0, 0); },
    upgrade: (x) => {   // a spanner
      x.save(); x.translate(50, 50); x.rotate(-0.75);
      shaded(x, (p) => { p.rect(-8, -6, 16, 46); }, '#9aa4b0');
      shaded(x, (p) => { p.arc(0, -22, 20, 0, Math.PI * 2); }, '#9aa4b0');
      x.fillStyle = '#ffffff'; x.globalCompositeOperation = 'destination-out'; x.fillRect(-7, -48, 14, 26); x.globalCompositeOperation = 'source-over';
      x.restore();
    },
    horn: (x) => {
      shaded(x, (p) => { p.moveTo(12, 44); p.lineTo(52, 44); p.lineTo(86, 22); p.lineTo(86, 78); p.lineTo(52, 56); p.lineTo(12, 56); p.closePath(); }, P.honey);
      shaded(x, (p) => p.rect(26, 56, 10, 14), P.honeyDark);
      x.fillStyle = P.berry; for (const [cx, cy] of [[30, 22], [44, 14], [58, 26]]) { circ(x, cx, cy, 5, P.berry); x.fillRect(cx + 3, cy - 18, 3, 18); }
    },
    lights: (x) => {
      x.fillStyle = 'rgba(255,212,92,.55)';
      for (let i = 0; i < 8; i++) { x.save(); x.translate(50, 42); x.rotate(i * Math.PI / 4); x.fillRect(-3, -44, 6, 12); x.restore(); }
      shaded(x, (p) => p.arc(50, 42, 24, 0, Math.PI * 2), P.honeyLight);
      shaded(x, (p) => p.rect(38, 62, 24, 20), '#9aa4b0');
      x.fillStyle = '#7a838e'; x.fillRect(38, 68, 24, 3); x.fillRect(38, 75, 24, 3);
      ell(x, 42, 34, 6, 9, 'rgba(255,255,255,.7)', 0.5);
    },
    sticker3: (x) => {
      x.drawImage(art('st-star', 100, STICKER_ART.star, 7), 2, 6, 76, 76);
      shaded(x, (p) => p.arc(76, 74, 18, 0, Math.PI * 2), P.leaf);
      x.fillStyle = '#fff'; x.fillRect(67, 71, 18, 6); x.fillRect(73, 65, 6, 18);
    },
  };
  const stickerPic = (id, size = 128) => art('st-' + id, size, STICKER_ART[id], 7);
  const hatPic = (id, size = 128) => art('hat-' + id, size, HAT_ART[id]);
  const iconPic = (id, size = 128) => art('ic-' + id, size, ICON_ART[id]);
  function paintPic(color, size = 128) {
    return art('pt-' + color, size, (x) => {
      shaded(x, (p) => p.arc(50, 52, 38, 0, Math.PI * 2), color);
      ell(x, 36, 36, 10, 6, 'rgba(255,255,255,.55)', -0.6);
    });
  }
  D.pics = { sticker: stickerPic, hat: hatPic, icon: iconPic };
  D.stickerPic = (id) => (STICKER_ART[id] ? stickerPic(id, 128) : null);
  const cv = (src, css) => { const c = mkCanvas(src.width); c.getContext('2d').drawImage(src, 0, 0); if (css) c.style.cssText = css; return c; };

  // ---------- 3D: stickers and hats on the bus ----------
  const stickerMat = {}, stickerGeo = new THREE.PlaneGeometry(1.35, 1.35);
  function stickerMesh(id) {
    if (!stickerMat[id]) {
      const t = new THREE.CanvasTexture(stickerPic(id, 128));
      stickerMat[id] = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
    }
    const m = new THREE.Mesh(stickerGeo, stickerMat[id]); m.name = 'sticker'; m.renderOrder = 2;
    return m;
  }
  const hatGeo = {};
  function hatMesh(id) {
    if (!hatGeo[id]) {
      const b = BB.mk.builder();
      if (id === 'party') {
        b.cyl(0.02, 0.62, 1.5, 10, P.berry, 0, 0.05, 0);
        for (let i = 0; i < 3; i++) { const y = 0.3 + i * 0.38, r = 0.62 * (1 - (y + 0.05) / 1.55); b.cyl(r + 0.03, r + 0.06, 0.12, 10, P.honeyLight, 0, y, 0); }
        b.ball(0.2, P.coral, 0, 1.6, 0, 1);
        b.cyl(0.7, 0.7, 0.1, 12, P.coral, 0, 0, 0);
      } else if (id === 'flowers') {
        b.add(new THREE.TorusGeometry(0.72, 0.12, 6, 16), P.leaf, 0, 0.12, 0, 0, Math.PI / 2);
        const cols = [P.rose, P.honeyLight, P.coral, '#c9a7f0', P.rose, P.honeyLight, P.coral, '#c9a7f0'];
        cols.forEach((c, i) => {
          const a = i / cols.length * Math.PI * 2, cx = Math.cos(a) * 0.72, cz = Math.sin(a) * 0.72;
          for (let k = 0; k < 5; k++) { const t = k / 5 * Math.PI * 2; b.ball(0.13, c, cx + Math.cos(t) * 0.14, 0.32, cz + Math.sin(t) * 0.14, 0, 1, 0.6, 1); }
          b.ball(0.09, P.honey, cx, 0.38, cz);
        });
      } else if (id === 'bunny') {
        b.cyl(0.5, 0.55, 0.16, 10, '#f2e6ec', 0, 0, 0);
        for (const s of [-1, 1]) {
          b.add(new THREE.SphereGeometry(0.22, 8, 6), '#fbf3f6', s * 0.3, 0.95, 0, 0, 0, -s * 0.18, 1, 4, 0.55);
          b.add(new THREE.SphereGeometry(0.12, 8, 6), '#ffb7c9', s * 0.3 - s * 0.01, 0.95, 0.1, 0, 0, -s * 0.18, 1, 6, 0.4);
        }
      } else if (id === 'crown') {
        b.cyl(0.62, 0.62, 0.42, 10, P.honey, 0, 0, 0);
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2;
          b.add(new THREE.ConeGeometry(0.17, 0.5, 4), P.honey, Math.cos(a) * 0.55, 0.62, Math.sin(a) * 0.55, a);
          b.ball(0.08, P.honeyLight, Math.cos(a) * 0.55, 0.9, Math.sin(a) * 0.55);
          b.ball(0.08, i % 2 ? P.coral : '#4fa3e0', Math.cos(a + 0.52) * 0.63, 0.2, Math.sin(a + 0.52) * 0.63);
        }
      }
      hatGeo[id] = b.geometry();
    }
    const m = new THREE.Mesh(hatGeo[id], BB.mk.mat); m.name = 'hat'; m.scale.setScalar(1.45);
    return m;
  }
  let fallback = null;
  function mounts() {
    const B = BB.bus;
    if (!fallback && B.front && B.rear) {
      // spots on the lower body panels, both sides (+x = kerb side, -x = road side), clear of doors and wheels
      const spot = (car, z, side) => { const o = new THREE.Object3D(); o.position.set(side * 1.275, 1.25, z); o.rotation.y = side * Math.PI / 2; car.add(o); return o; };
      const hat = new THREE.Object3D(); hat.position.set(0, 3.16, 1.9); B.front.add(hat);
      fallback = {
        hat,
        stickers: [[spot(B.front, 0.75, 1), spot(B.front, 0.75, -1)], [spot(B.rear, -0.2, 1), spot(B.rear, -0.2, -1)], [spot(B.front, -0.75, 1), spot(B.front, -0.75, -1)]],
      };
    }
    const hat = B.hatMount || (fallback && fallback.hat);
    const raw = (Array.isArray(B.stickerAnchors) && B.stickerAnchors.length) ? B.stickerAnchors : (fallback ? fallback.stickers : []);
    return { hat, stickers: raw.map((a) => (Array.isArray(a) ? a : [a])) };
  }
  const placed = [];
  // Show a look on the bus: {paint, stickers:[ids], hat, lights}. Missing fields come from the saved choices.
  D.applyLooks = function (look) {
    const B = BB.bus; if (!B || !B.front) return;
    look = Object.assign({ paint: S.paint, stickers: S.stickers, hat: S.hat, lights: !!S.upgrades.lights }, look || {});
    // bus.js applies paint and lights; stickers and hats are ours (so it is given none of its own to show)
    try { B.applyCustom(Object.assign({}, S, { paint: look.paint, stickers: [], hat: null, upgrades: Object.assign({}, S.upgrades, { lights: look.lights }) })); } catch (e) { console.error(e); }
    for (const m of placed) if (m.parent) m.parent.remove(m);
    placed.length = 0;
    const mt = mounts();
    look.stickers.forEach((id, i) => {
      if (!STICKER_ART[id] || !mt.stickers[i]) return;
      for (const a of mt.stickers[i]) { const m = stickerMesh(id); m.position.z = 0.012; if (a.userData && a.userData.size) m.scale.setScalar(a.userData.size / 1.35); a.add(m); placed.push(m); }
    });
    if (look.hat && HAT_ART[look.hat] && mt.hat) { const h = hatMesh(look.hat); if (B.hatMount) h.scale.setScalar(1.25); mt.hat.add(h); placed.push(h); }
  };
  D.afterBus = function () { D.applyLooks(); build3D(); };

  // ---------- 3D: the turntable lift and the fuel pump ----------
  let lift = null, pump = null, pumpScreen = null, liftY = 0, liftWant = 0, sway = 0, hop = 0, hopV = 0, pivot = new THREE.Vector3(), fill = 0;
  function build3D() {
    if (lift) return;
    const b = BB.mk.builder(), R = 8.2;
    b.cyl(R, R, 0.5, 32, '#8d8794', 0, -0.5, 0);
    b.cyl(R - 0.5, R - 0.5, 0.04, 32, '#b9b2bf', 0, 0, 0);
    for (let i = 0; i < 24; i++) {                                        // striped rim
      const a = i / 24 * Math.PI * 2;
      b.box(2.1, 0.06, 0.45, i % 2 ? P.honey : '#4a4250', Math.cos(a) * (R - 0.24), -0.02, Math.sin(a) * (R - 0.24), -a + Math.PI / 2);
    }
    for (let i = 0; i < 4; i++) b.box(0.25, 0.05, (R - 0.6) * 2, '#a39cab', 0, 0.01, 0, i * Math.PI / 4);   // spokes
    b.cyl(1.2, 1.2, 0.06, 16, P.honey, 0, 0.02, 0);
    lift = b.mesh(); lift.name = 'turntable'; lift.visible = false;
    BB.scene.add(lift);
    const pb = BB.mk.builder();
    pb.box(1.4, 0.25, 1.1, '#8a8290', 0, 0, 0);
    pb.box(1.1, 2.3, 0.8, P.coral, 0, 0.25, 0);
    pb.box(1.2, 0.3, 0.9, dark(P.coral, 0.2), 0, 2.55, 0);
    pb.box(0.18, 0.5, 0.18, '#5a5260', 0.62, 1.3, 0.1);
    pb.add(new THREE.TorusGeometry(0.5, 0.07, 6, 12, Math.PI), '#4a4250', 0.75, 1.3, 0.1, Math.PI / 2, 0, -Math.PI / 2);
    pump = pb.mesh(); pump.name = 'pump'; pump.visible = false;
    pumpScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.55), new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
    pumpScreen.position.set(0, 1.85, 0.41); pump.add(pumpScreen);
    BB.scene.add(pump);
  }
  function placeProps() {
    const B = BB.bus; if (!lift || !B.front) return;
    pivot.set((B.front.position.x + B.rear.position.x) / 2, 0, (B.front.position.z + B.rear.position.z) / 2);
    lift.position.set(pivot.x, -0.6, pivot.z); lift.rotation.y = B.heading; lift.visible = true;
    const h = B.heading, fx = Math.sin(h), fz = Math.cos(h), kx = Math.cos(h), kz = -Math.sin(h);
    const nx = B.front.position.x + fx * 3.7, nz = B.front.position.z + fz * 3.7;
    pump.position.set(nx + fx * 3.2 - kx * 0.6, 0.2, nz + fz * 3.2 - kz * 0.6);
    pump.rotation.y = h + Math.PI / 2 + 0.5;  // turned toward the camera on the road side
    pump.visible = true;
  }
  function setGroup(theta, y) {
    const g = BB.bus.group; if (!g) return;
    g.rotation.y = theta;
    const c = Math.cos(theta), s = Math.sin(theta);   // rotate about the pivot: p' = R(p - c) + c
    g.position.set(pivot.x - (c * pivot.x + s * pivot.z), y, pivot.z - (-s * pivot.x + c * pivot.z));
  }
  let tt = 0;
  D.update = function (dt) {
    if (!lift) return;
    const target = D.isOpen ? 0.7 : 0;
    liftY += (target - liftY) * Math.min(1, dt * 2.2);
    if (D.isOpen) { tt += dt; sway += ((Math.sin(tt * 0.45) * 0.22) - sway) * Math.min(1, dt * 1.5); }
    else sway += (0 - sway) * Math.min(1, dt * 4);
    hopV -= 30 * dt; hop = Math.max(0, hop + hopV * dt); if (hop === 0 && hopV < 0) hopV = 0;
    const active = D.isOpen || liftY > 0.01 || Math.abs(sway) > 0.002 || hop > 0;
    if (active) {
      setGroup(sway, liftY + hop);
      lift.position.y = liftY - 0.6 * (1 - liftY / 0.7); lift.rotation.y = BB.bus.heading + sway;
    } else if (lift.visible) {
      lift.visible = false; pump.visible = false; setGroup(0, 0); BB.bus.group.position.set(0, 0, 0);
    }
    if (fill > 0) { fill = Math.max(0, fill - dt); pumpScreen.material.color.set(Math.floor(fill * 8) % 2 ? 0x8fe0c4 : 0xfff6e0); }
  };
  D.hop = () => { hopV = 7; };

  // ---------- the garage screen (DOM) ----------
  BB.css(`
  .bbd { position: absolute; top: 0; right: 0; bottom: 0; width: min(440px, 52vw); pointer-events: auto; z-index: 10;
    background: linear-gradient(#fff6e0, #fdebc8); border-left: 5px solid #d9b57f; box-shadow: -8px 0 0 rgba(120,80,40,.12);
    padding: var(--st) var(--sr) var(--sb) 14px; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 10px; font-family: 'Baloo 2', 'Fredoka', system-ui, sans-serif;
    color: #3a2a3c; animation: bbd-in .35s ease-out; }
  @keyframes bbd-in { from { transform: translateX(100%); } }
  .bbd canvas { display: block; }
  .bbd-head { display: flex; align-items: center; gap: 8px; flex: none; min-height: 56px; }
  .bbd-cash { display: flex; align-items: center; gap: 6px; font-size: 32px; font-weight: 800; height: 56px; box-sizing: border-box;
    background: #fff; border: 3px solid #d9b57f; border-radius: 30px; padding: 0 16px 0 6px; }
  .bbd-cash canvas { width: 42px; height: 42px; }
  .bbd-cash.bump { animation: bbd-bump .5s; } @keyframes bbd-bump { 40% { transform: scale(1.15); } }
  .bbd-goal { display: flex; align-items: center; gap: 6px; font-size: 22px; font-weight: 800; color: #b06e00; animation: bbd-pop .3s; }
  .bbd-goal canvas { width: 34px; height: 34px; }
  .bbd-goal .bar { width: 70px; height: 14px; border-radius: 8px; background: #eadfca; overflow: hidden; }
  .bbd-goal .bar i { display: block; height: 100%; background: #ffb81f; }
  .bbd-head .bbu-clock { margin-left: auto; }
  .bbd-tabs { display: flex; gap: 6px; flex: none; }
  .bbd-tab { flex: 1; height: 64px; min-width: 56px; border-radius: 20px 20px 12px 12px; border: 3px solid #ecd3a8; background: #fffaf0;
    display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; touch-action: manipulation;
    box-shadow: 0 4px 0 rgba(120,80,40,.12); }
  .bbd-tab canvas { width: 48px; height: 48px; }
  .bbd-tab.on { background: #fff; border-color: #19a79b; box-shadow: 0 0 0 3px #8fe0c4; }
  .bbd-tab.pressed, .bbd-tile.pressed { transform: translateY(3px); }
  .bbd-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 10px;
    padding: 6px 2px 10px; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
  .bbd-tile { position: relative; width: 84px; height: 84px; border-radius: 24px; border: 3px solid #ecd3a8; background: #fff;
    display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; touch-action: manipulation; flex: none;
    box-shadow: 0 4px 0 rgba(120,80,40,.12); }
  .bbd-body.anim .bbd-tile { animation: bbd-pop .3s cubic-bezier(.2,1.5,.5,1) both; }
  .bbd-tile canvas { width: 66px; height: 66px; }
  .bbd-tile.on { border-color: #19a79b; box-shadow: 0 0 0 4px #8fe0c4; }
  .bbd-tile.on::after { content: ''; position: absolute; top: -8px; right: -8px; width: 26px; height: 26px; border-radius: 50%;
    background: #19a79b url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12.5l4 4 8-9' stroke='white' stroke-width='3.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/80% no-repeat; }
  .bbd-tile.preview { border-color: #ffb81f; background: #fff8e0; animation: bbd-glow 1s infinite alternate; }
  @keyframes bbd-glow { to { box-shadow: 0 0 0 6px rgba(255,212,92,.7); } }
  @keyframes bbd-pop { from { transform: scale(.4); opacity: 0; } }
  .bbd-price { position: absolute; bottom: -9px; right: -9px; display: flex; align-items: center; gap: 1px; background: #ffd45c; border: 2px solid #d98700;
    border-radius: 14px; font-size: 18px; font-weight: 800; padding: 0 7px 0 2px; color: #7a4a00; line-height: 24px; }
  .bbd-price canvas { width: 20px; height: 20px; }
  .bbd-tile.preview .bbd-price { background: #5cb85c; border-color: #3f913f; color: #fff; font-size: 22px; line-height: 30px; padding: 0 9px 0 4px;
    bottom: -14px; right: -14px; box-shadow: 0 3px 0 #2f7a2f; animation: bbd-buy .8s ease-in-out infinite; }
  .bbd-tile.preview .bbd-price canvas { width: 24px; height: 24px; }
  @keyframes bbd-buy { 50% { transform: scale(1.18); } }
  .bbd-tile.preview .bbd-price::before { content: ''; width: 18px; height: 18px; margin-right: 2px;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12.5l4 4 8-9' stroke='white' stroke-width='3.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat; }
  .bbd-tile .slotdots { position: absolute; top: 4px; left: 6px; font-size: 13px; }
  .bbd-fuel { display: flex; align-items: center; gap: 12px; width: 100%; background: #fff; border-radius: 24px; padding: 10px 12px; border: 3px solid #ecd3a8; box-sizing: border-box; }
  .bbd-fuel > canvas { width: 70px; height: 70px; flex: none; }
  .bbd-gauge { flex: 1; height: 34px; border-radius: 18px; background: #eadfca; overflow: hidden; position: relative; }
  .bbd-gauge i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ff6b5c, #ffb81f 30%, #5cb85c 60%); }
  .bbd-gauge b { position: absolute; bottom: 4px; width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,.8); animation: bbd-bubble 1s ease-out forwards; }
  @keyframes bbd-bubble { to { transform: translateY(-24px) scale(.4); opacity: 0; } }
  .bbd-fill { min-width: 96px; height: 72px; border-radius: 24px; border: none; background: #5cb85c; color: #fff; box-shadow: 0 6px 0 #3f913f;
    font: 800 26px 'Baloo 2', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 0 12px; cursor: pointer;
    touch-action: manipulation; flex: none; }
  .bbd-fill canvas { width: 30px; height: 30px; }
  .bbd-fill.pressed { transform: translateY(4px); box-shadow: 0 2px 0 #3f913f; }
  .bbd-fill.full { background: #d6efd2; box-shadow: none; }
  .bbd-go { flex: none; height: 72px; border-radius: 26px; border: none; background: #4fa3e0; box-shadow: 0 6px 0 #2f7fbc; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 10px; touch-action: manipulation; }
  .bbd-go svg { height: 46px; width: auto; }
  .bbd-go.pressed { transform: translateY(4px); box-shadow: 0 2px 0 #2f7fbc; }
  .bbd .shake { animation: bbd-shake .4s; }
  @keyframes bbd-shake { 25% { transform: translateX(-7px); } 75% { transform: translateX(7px); } }
  .bbd-awning { position: absolute; left: 0; top: 0; right: min(440px, 52vw); height: 46px; pointer-events: none; z-index: 5;
    background: repeating-linear-gradient(90deg, #19a79b 0 44px, #fff6e0 44px 88px);
    -webkit-mask: radial-gradient(circle at 22px 24px, #000 22px, transparent 22.5px) 0 22px / 44px 100% repeat-x, linear-gradient(#000, #000) 0 0 / 100% 24px no-repeat;
            mask: radial-gradient(circle at 22px 24px, #000 22px, transparent 22.5px) 0 22px / 44px 100% repeat-x, linear-gradient(#000, #000) 0 0 / 100% 24px no-repeat;
    filter: drop-shadow(0 4px 0 rgba(0,0,0,.12)); animation: bbd-drop .5s ease-out; }
  @keyframes bbd-drop { from { transform: translateY(-100%); } }
  .bbd-coin { position: absolute; width: 34px; height: 34px; z-index: 40; pointer-events: none; }
  .bbd-spark { position: absolute; z-index: 40; pointer-events: none; width: 14px; height: 14px; border-radius: 50%; }
  @media (min-height: 700px) and (min-width: 1000px) {
    .bbd-tile { width: 100px; height: 100px; border-radius: 28px; } .bbd-tile canvas { width: 80px; height: 80px; } .bbd-body { gap: 14px; }
  }
  @media (max-height: 560px) {
    .bbd { gap: 6px; padding-left: 10px; }
    .bbd-head { min-height: 52px; } .bbd-cash { height: 52px; font-size: 26px; } .bbd-cash canvas { width: 34px; height: 34px; }
    .bbd-tab { height: 56px; } .bbd-tab canvas { width: 40px; height: 40px; }
    .bbd-tile { width: 72px; height: 72px; border-radius: 20px; } .bbd-tile canvas { width: 54px; height: 54px; }
    .bbd-body { gap: 9px; }
    .bbd-go { height: 60px; } .bbd-go svg { height: 38px; }
    .bbd-fuel { padding: 6px 10px; } .bbd-fuel > canvas { width: 56px; height: 56px; } .bbd-fill { height: 62px; }
    .bbd-awning { height: 34px; }
    .bbd-head .bbu-clock { height: 56px; font-size: 24px; padding: 0 12px 0 8px; } .bbd-head .bbu-clock svg { width: 30px; height: 30px; }
  }`);

  const BUS_SVG = '<svg viewBox="0 0 120 56" aria-hidden="true"><rect x="4" y="6" width="92" height="38" rx="10" fill="#fff6e0"/>'
    + '<rect x="12" y="13" width="18" height="14" rx="3" fill="#2f7fbc"/><rect x="34" y="13" width="18" height="14" rx="3" fill="#2f7fbc"/><rect x="56" y="13" width="18" height="14" rx="3" fill="#2f7fbc"/>'
    + '<rect x="78" y="13" width="12" height="22" rx="3" fill="#2f7fbc"/><circle cx="26" cy="46" r="8" fill="#3a2a3c"/><circle cx="76" cy="46" r="8" fill="#3a2a3c"/>'
    + '<path d="M100 14 L118 28 L100 42 Z" fill="#fff6e0"/></svg>';

  let panel = null, awning = null, tab = 'paint', preview = null, goalEl = null, cashSpan = null, cashBox = null, bodyEl = null;
  const coinCv = (px) => cv(BB.pic('coin', 64), `width:${px}px;height:${px}px`);

  // first tap on something new: try it on, say its price and how to buy it
  function speakPrice(text, price) { BB.say(price ? `${text} ${price} ${price === 1 ? 'coin' : 'coins'}. Tap again to buy!` : text); }
  let previewAt = 0;
  function setPreview(p) { preview = p; previewAt = performance.now(); showLook(); }
  // a second tap within 400 ms is an accidental double tap, not "buy"
  const tooSoon = () => performance.now() - previewAt < 400;
  // after buying: the bus shows off its new thing and says how much it loves it
  function showOff(kind, id, line) {
    BB.later(900, () => {
      try { if (BB.bus.showOff) BB.bus.showOff(kind, id); } catch (e) { console.error(e); }
      BB.emit('depot:showOff', { kind, id });
      BB.say(line, { queue: true });
    });
  }
  function showLook() {
    const look = {};
    if (preview) {
      if (preview.kind === 'paint') look.paint = preview.id;
      if (preview.kind === 'hat') look.hat = preview.id;
      if (preview.kind === 'sticker') look.stickers = nextStickers(preview.id);
      if (preview.kind === 'upgrade' && preview.id === 'lights') look.lights = true;
    }
    D.applyLooks(look);
  }
  // Wearing sticker id: add it, or if every slot is full, replace the oldest.
  function nextStickers(id) {
    const list = S.stickers.filter((s) => s !== id);
    list.push(id);
    while (list.length > slots()) list.shift();
    return list;
  }

  function flyCoins(toEl, n) {
    if (!cashBox || !toEl) return;
    const a = cashBox.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const root = BB.ui.root.getBoundingClientRect();
    const count = Math.min(6, Math.max(3, n));
    for (let i = 0; i < count; i++) {
      const c = coinCv(34); c.className = 'bbd-coin'; BB.ui.root.appendChild(c);
      const x0 = a.left - root.left + 10, y0 = a.top - root.top + 10, x1 = b.left - root.left + b.width / 2 - 17, y1 = b.top - root.top + b.height / 2 - 17;
      const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 60;
      const anim = c.animate([
        { transform: `translate(${x0}px, ${y0}px) scale(.6)`, opacity: 0 },
        { transform: `translate(${mx}px, ${my}px) scale(1.1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${x1}px, ${y1}px) scale(.5)`, opacity: 0.2 },
      ], { duration: 650, delay: i * 80, easing: 'ease-in-out', fill: 'both' });
      anim.onfinish = () => c.remove();
      BB.later(650 + i * 80 + 400, () => c.remove());
    }
  }
  function sparkle(el) {
    if (!el) return;
    const r = el.getBoundingClientRect(), root = BB.ui.root.getBoundingClientRect();
    const cols = [P.honeyLight, P.rose, P.mint, '#ffffff', P.coral];
    for (let i = 0; i < 12; i++) {
      const s = BB.el('div', 'bbd-spark', BB.ui.root); s.style.background = cols[i % cols.length];
      const x = r.left - root.left + r.width / 2, y = r.top - root.top + r.height / 2, a = i / 12 * Math.PI * 2, d = 50 + Math.random() * 30;
      const an = s.animate([{ transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 1 }, { transform: `translate(${x + Math.cos(a) * d}px, ${y + Math.sin(a) * d}px) scale(.2)`, opacity: 0 }],
        { duration: 700, easing: 'ease-out', fill: 'both' });
      an.onfinish = () => s.remove();
      BB.later(1200, () => s.remove());
    }
  }
  function bumpCash() { if (cashBox) { cashBox.classList.remove('bump'); void cashBox.offsetWidth; cashBox.classList.add('bump'); } }
  function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  // Not enough coins: gentle, and a coin goal to aim for.
  function notYet(el, price) {
    shake(el); BB.sfx.wrong();
    const need = price - D.cash;
    BB.say(`Let's do more jobs! ${need} more ${need === 1 ? 'coin' : 'coins'}.`);
    if (goalEl) goalEl.remove();
    goalEl = BB.el('div', 'bbd-goal', null);
    goalEl.appendChild(coinCv(34));
    BB.el('span', '', goalEl, `${D.cash}/${price}`);
    const bar = BB.el('div', 'bar', goalEl); BB.el('i', '', bar).style.width = Math.round(100 * D.cash / price) + '%';
    cashBox.after(goalEl);
  }
  // Pay and celebrate. Returns false (and says so gently) when there aren't enough coins.
  function buy(el, price) {
    if (!D.spend(price)) { notYet(el, price); return false; }
    flyCoins(el, price); BB.sfx.jingle(); bumpCash();
    BB.later(600, () => { sparkle(el); BB.sfx.sparkle(); D.hop(); });
    if (goalEl) { goalEl.remove(); goalEl = null; }
    return true;
  }

  function tile(parent, picCanvas, opts) {
    const t = BB.el('button', 'bbd-tile' + (opts.on ? ' on' : '') + (opts.preview ? ' preview' : ''), parent);
    t.appendChild(cv(picCanvas));
    if (opts.price) { const pr = BB.el('span', 'bbd-price', t); pr.appendChild(coinCv(20)); BB.el('span', '', pr, String(opts.price)); }
    t.style.animationDelay = (opts.i || 0) * 40 + 'ms';
    BB.tap(t, () => opts.tap(t));
    return t;
  }

  function renderBody(animate) {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    bodyEl.classList.toggle('anim', !!animate);
    const isPrev = (kind, id) => preview && preview.kind === kind && preview.id === id;
    if (tab === 'fuel') {
      const row = BB.el('div', 'bbd-fuel', bodyEl);
      row.appendChild(cv(BB.pic('pump', 128)));
      const gauge = BB.el('div', 'bbd-gauge', row), bar = BB.el('i', '', gauge);
      bar.style.width = Math.round(BB.bus.fuel * 100) + '%';
      const full = BB.bus.fuel >= 0.98, pay = 0;   // fuel is always free: the coins are for the fun things
      const btn = BB.el('button', 'bbd-fill' + (full ? ' full' : ''), row);
      if (full) btn.innerHTML = '<svg viewBox="0 0 24 24" width="40" height="40"><path d="M5 12.5l4.5 4.5 9.5-10" stroke="#3f913f" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      else btn.innerHTML = '<svg viewBox="0 0 24 24" width="44" height="44"><path d="M12 2.5C9 7 6 10.2 6 14a6 6 0 0 0 12 0c0-3.8-3-7-6-11.5z" fill="#fff6e0"/><path d="M9.2 14.5a3 3 0 0 0 2.6 2.9" stroke="#5cb85c" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>';
      BB.tap(btn, () => {
        if (BB.bus.fuel >= 0.98) { BB.say('The tank is full! Yum!'); return; }
        if (btn.dataset.busy) return;
        btn.dataset.busy = '1';
        BB.sfx.gurgle(1.6); fill = 1.8;
        // the gauge fills with bubbles
        const from = BB.bus.fuel;
        bar.animate([{ width: Math.round(from * 100) + '%' }, { width: '100%' }], { duration: 1600, easing: 'ease-in-out', fill: 'forwards' });
        for (let i = 0; i < 10; i++) BB.later(i * 150, () => { const b = BB.el('b', '', gauge); b.style.left = (Math.max(from, i / 10) * 90 + 3) + '%'; BB.later(1000, () => b.remove()); });
        BB.bus.refuel(1);
        BB.later(1700, () => { BB.say('Yum! A full tank!'); D.hop(); renderBody(); });
      });
      if (!full) BB.later(300, () => { if (tab === 'fuel' && panel) btn.classList.add('shake'); });
    } else if (tab === 'paint') {
      BB.PAINTS.forEach((p, i) => {
        const own = S.paints.includes(p.id);
        tile(bodyEl, paintPic(p.color), { i, on: S.paint === p.id && !preview, preview: isPrev('paint', p.id), price: own ? 0 : PAINT_PRICE, tap: (el) => {
          if (own) { setPreview(null); S.paint = p.id; BB.saveNow(); D.applyLooks(); BB.sfx.pop(); D.hop(); BB.say(PAINT_SAY[p.id] || 'Lovely!'); renderBody(); return; }
          if (!isPrev('paint', p.id)) { setPreview({ kind: 'paint', id: p.id }); BB.sfx.whoosh(); speakPrice(PAINT_SAY[p.id], PAINT_PRICE); renderBody(); return; }
          if (tooSoon()) return;
          if (!buy(el, PAINT_PRICE)) return;
          S.paints.push(p.id); S.paint = p.id; BB.saveNow(); preview = null; D.applyLooks();
          BB.say(['Shiny!', 'So pretty!', 'Lovely!'][Math.floor(Math.random() * 3)]);
          showOff('paint', p.id, `I love my ${p.id} paint!`);
          BB.later(700, renderBody);
        } });
      });
    } else if (tab === 'sticker') {
      STICKERS.forEach((st, i) => {
        const own = S.stickersOwned.includes(st.id), on = S.stickers.includes(st.id);
        tile(bodyEl, stickerPic(st.id), { i, on: on && !preview, preview: isPrev('sticker', st.id), price: own ? 0 : st.price, tap: (el) => {
          if (own) {
            setPreview(null);
            if (on) { S.stickers = S.stickers.filter((s) => s !== st.id); BB.sfx.pop(); BB.say('Peeled off!'); }
            else { S.stickers = nextStickers(st.id); BB.sfx.pop(); D.hop(); BB.say(st.say); }
            BB.saveNow(); D.applyLooks(); renderBody(); return;
          }
          if (!isPrev('sticker', st.id)) { setPreview({ kind: 'sticker', id: st.id }); BB.sfx.whoosh(); speakPrice(st.say, st.price); renderBody(); return; }
          if (tooSoon()) return;
          if (!buy(el, st.price)) return;
          S.stickersOwned.push(st.id); S.stickers = nextStickers(st.id); BB.saveNow(); preview = null; D.applyLooks();
          BB.say('Stuck on! Cool!');
          showOff('sticker', st.id, `I love my ${st.name} sticker!`);
          BB.later(700, renderBody);
        } });
      });
    } else if (tab === 'hat') {
      HATS.forEach((h, i) => {
        const own = S.hatsOwned.includes(h.id), on = S.hat === h.id;
        tile(bodyEl, hatPic(h.id), { i, on: on && !preview, preview: isPrev('hat', h.id), price: own ? 0 : h.price, tap: (el) => {
          if (own) {
            setPreview(null);
            if (on) { S.hat = null; BB.sfx.pop(); BB.say('Hat off!'); } else { S.hat = h.id; BB.sfx.pop(); D.hop(); BB.say(h.say); }
            BB.saveNow(); D.applyLooks(); renderBody(); return;
          }
          if (!isPrev('hat', h.id)) { setPreview({ kind: 'hat', id: h.id }); BB.sfx.whoosh(); speakPrice(h.say, h.price); renderBody(); return; }
          if (tooSoon()) return;
          if (!buy(el, h.price)) return;
          S.hatsOwned.push(h.id); S.hat = h.id; BB.saveNow(); preview = null; D.applyLooks();
          BB.say('What a smart bus!');
          showOff('hat', h.id, h.love);
          BB.later(700, renderBody);
        } });
      });
    } else if (tab === 'upgrade') {
      UPGRADES.forEach((u, i) => {
        const own = !!S.upgrades[u.id];
        tile(bodyEl, iconPic(u.id), { i, on: own, preview: isPrev('upgrade', u.id), price: own ? 0 : u.price, tap: (el) => {
          const demo = () => { if (u.id === 'horn') BB.later(500, () => BB.sfx.horn(true)); };
          if (own) { BB.say(u.say); demo(); return; }
          if (!isPrev('upgrade', u.id)) { setPreview({ kind: 'upgrade', id: u.id }); BB.sfx.whoosh(); speakPrice(u.say, u.price); demo(); renderBody(); return; }
          if (tooSoon()) return;
          if (!buy(el, u.price)) return;
          S.upgrades[u.id] = true; BB.saveNow(); preview = null; D.applyLooks();
          BB.sfx.cheer(); BB.say('Hooray!');
          showOff('upgrade', u.id, u.love);
          if (u.id === 'horn') BB.later(1200, () => BB.bus.horn());
          BB.later(700, renderBody);
        } });
      });
    }
  }
  function setTab(id, quiet) {
    tab = id;
    if (preview) { preview = null; D.applyLooks(); }
    if (goalEl) { goalEl.remove(); goalEl = null; }
    panel.querySelectorAll('.bbd-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    bodyEl.scrollTop = 0;
    renderBody(true);
    if (!quiet) { BB.sfx.click(); BB.say((TABS.find((t) => t.id === id) || {}).say || ''); }
  }

  function render() {
    panel.innerHTML = '';
    const head = BB.el('div', 'bbd-head', panel);
    cashBox = BB.el('div', 'bbd-cash', head); cashBox.appendChild(coinCv(42)); cashSpan = BB.el('span', '', cashBox, String(D.cash));
    BB.tap(cashBox, () => BB.say(D.cash === 1 ? 'You have 1 coin.' : `You have ${D.cash} coins.`));
    if (BB.HUB && BB.ui.makeClock) head.appendChild(BB.ui.makeClock());
    const tabs = BB.el('div', 'bbd-tabs', panel);
    for (const t of TABS) {
      const b = BB.el('button', 'bbd-tab', tabs); b.dataset.tab = t.id; b.appendChild(cv(iconPic(t.id, 96)));
      BB.tap(b, () => setTab(t.id));
    }
    bodyEl = BB.el('div', 'bbd-body', panel);
    const go = BB.el('button', 'bbd-go', panel, BUS_SVG);
    BB.tap(go, () => { BB.sfx.pop(); D.close(); });
    setTab(tab, true);
    BB.emit('depot:render', { panel });
  }

  D.open = function () {
    if (D.isOpen) return;
    D.isOpen = true;
    preview = null; goalEl = null;
    tab = BB.bus.fuel < 0.6 ? 'fuel' : 'paint';
    awning = BB.el('div', 'bbd-awning', BB.ui.root);
    panel = BB.el('div', 'bbd', BB.ui.root);
    render();
    placeProps(); tt = 0;
    BB.bus.setCamera('depot');
    BB.emit('depot:open');
    BB.sfx.whoosh();
    BB.say(BB.bus.fuel < 0.6 ? 'Welcome to the garage! Tap the pump for free fuel. Then make your bus beautiful!' : 'Welcome to the garage! Make your bus beautiful!');
  };
  D.close = function () {
    if (!D.isOpen) return;
    D.isOpen = false;
    preview = null; D.applyLooks();
    for (const el of [panel, awning]) if (el) el.remove();
    panel = awning = bodyEl = cashBox = cashSpan = goalEl = null;
    BB.bus.setCamera('chase');
    BB.emit('depot:closed');
  };
  D.render = () => { if (panel) renderBody(); };
  D.tab = () => tab;
  BB.on('cash:changed', () => { if (cashSpan) cashSpan.textContent = String(D.cash); });
  D.init = function () { /* the 3D props are built once the bus exists (D.afterBus) */ };
})();
