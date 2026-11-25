/* Bendy Bus 3D: the depot ("garage") and the economy.
   Cash (bus3d.cash, never taken away except when the child buys something), the saved progress (BB.save, stored as
   bus3d.save by core.js) and the garage screen, opened when the bus pulls in at the depot:
   - the bus rises on a striped turntable lift that sways gently, a 3D fuel pump in front of it, a striped awning;
   - a paper panel with big picture tabs: Fuel, Paint, Stickers, Lights, Bumpers, Wheels & rims, Extras (spoken on tap);
   - the first tap on something new previews it live on the bus and says its price, a second tap buys it
     (coin jingle, coins fly from the counter); too few coins -> "Let's do more jobs!" and a coin goal to aim for;
   - fuel is free: every visit fills the tank (with the pump's gurgle), and the bus never leaves hungry.
   Stickers are built here and hung on BB.bus.stickerAnchors (or fallback spots on the carriages); parts (lights,
   bumpers, wheels, rims) are drawn by bus.js (B.setPart / applyCustom with save.parts) and only sold here.
   Saved: bus3d.save.parts {kind: id} and partsOwned ['kind:id'].
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
  // Real vehicle parts (the owner's choice): lights, bumpers, wheels and rims. bus.js draws them (B.PARTS, B.setPart);
  // the first item of each kind is the bus's own part (free, owned). Names and ids come from B.PARTS when it exists.
  const PART_KINDS = ['lights', 'bumpers', 'wheels', 'rims'];
  const MY_PARTS = {
    lights: [{ id: 'std', name: 'Round lamps' }, { id: 'fog', name: 'Fog lamps' }, { id: 'led', name: 'Light strip' }, { id: 'roof', name: 'Roof lamps' }],
    bumpers: [{ id: 'std', name: 'Bus bumper' }, { id: 'chrome', name: 'Shiny bumper' }, { id: 'sport', name: 'Sport bumper' }, { id: 'bull', name: 'Big bumper' }],
    wheels: [{ id: 'std', name: 'Bus wheels' }, { id: 'big', name: 'Big wheels' }, { id: 'chunky', name: 'Chunky tyres' }, { id: 'white', name: 'White-wall tyres' }],
    rims: [{ id: 'std', name: 'Silver rims' }, { id: 'gold', name: 'Gold rims' }, { id: 'red', name: 'Red rims' }, { id: 'blue', name: 'Blue rims' }, { id: 'star', name: 'Star rims' }],
  };
  const KIND_PRICE = { lights: [4, 6, 8, 10, 12], bumpers: [5, 7, 9, 11, 12], wheels: [6, 8, 10, 12, 12], rims: [4, 6, 8, 10, 12] };
  function partsOf(kind) {
    const theirs = BB.bus && BB.bus.PARTS && Array.isArray(BB.bus.PARTS[kind]) && BB.bus.PARTS[kind].length ? BB.bus.PARTS[kind] : null;
    return (theirs || MY_PARTS[kind]).map((it, i) => ({ kind, id: String(it.id), name: it.name || String(it.id), price: i === 0 ? 0 : KIND_PRICE[kind][Math.min(i - 1, 4)] }));
  }
  const partKey = (kind, id) => kind + ':' + id;
  const partOn = (kind, id) => (S.parts[kind] || partsOf(kind)[0].id) === id;
  const partOwned = (kind, id, i) => i === 0 || S.partsOwned.includes(partKey(kind, id));
  const partSay = (pt) => pt.name + '!';
  const partLove = (pt) => `I love my ${pt.name.toLowerCase()}!`;
  // Upgrades are fun, never needed.
  const UPGRADES = [
    { id: 'horn', say: 'A horn that plays a tune!', price: 12, love: 'I love my new horn! Toot toot!' },
    { id: 'sticker3', say: 'A super sticker spot! Now the bus can wear three stickers.', price: 20, love: 'I love my super sticker spot!' },
  ];
  const PAINT_SAY = { green: 'Green!', red: 'Red!', blue: 'Blue!', yellow: 'Yellow!', purple: 'Purple!', pink: 'Pink!' };
  const TABS = [
    { id: 'bus', say: 'Your bus!' }, { id: 'fuel', say: 'Fuel!' }, { id: 'sticker', say: 'Stickers!' },
    { id: 'lights', say: 'Lights!' }, { id: 'bumpers', say: 'Bumpers!' }, { id: 'wheels', say: 'Wheels and rims!' }, { id: 'upgrade', say: 'Super extras!' },
  ];
  const slots = () => (S.upgrades.sticker3 ? 3 : 2);
  // Bus types come from js/fleet.js (BB.fleet.TYPES / NAMES / preview) when it is there; switching is free.
  const MY_TYPES = [{ id: 'bendy', name: 'Bendy bus' }, { id: 'double', name: 'Double-decker' }, { id: 'single', name: 'Single-decker' }];
  function fleetTypes() {
    const F = BB.fleet;
    if (!F || !Array.isArray(F.TYPES) || !F.TYPES.length) return MY_TYPES;
    return F.TYPES.map((t) => {
      const id = typeof t === 'string' ? t : t && t.id;
      const nm = (t && t.name) || (F.NAMES && (F.NAMES[id] || (Array.isArray(F.NAMES) && F.NAMES[F.TYPES.indexOf(t)]))) || (MY_TYPES.find((m) => m.id === id) || {}).name || String(id);
      return { id: String(id), name: String(nm) };
    }).filter((t) => t.id);
  }
  const curType = () => S.busType || fleetTypes()[0].id;
  const DIGITS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  if (!S.paints.includes('green')) S.paints.unshift('green');
  S.stickers = S.stickers.filter((id) => STICKERS.some((s) => s.id === id)).slice(0, slots());
  // Old saves: hats are gone from the shop (their coins come back quietly); "bright lights" became roof lamps.
  if (BB.saveMigrate && BB.saveMigrate.hatRefund) { D.cash += BB.saveMigrate.hatRefund; BB.store.set('cash', D.cash); }
  if (S.upgrades.lights) { delete S.upgrades.lights; if (!S.partsOwned.includes('lights:roof')) S.partsOwned.push('lights:roof'); }
  BB.saveNow();

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
  // Parts pictures. Known ids get their own picture; unknown ones (from B.PARTS) get the kind's picture in a colour.
  const hashCol = (str) => { const cols = [P.coral, P.honey, P.teal, P.berry, P.plum, P.leaf, P.rose]; let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0; return cols[Math.abs(h) % cols.length]; };
  function tyre(x, R, tread, wall) {
    shaded(x, (p) => p.arc(50, 52, R, 0, Math.PI * 2), '#3a343f');
    if (tread) { x.fillStyle = '#3a343f'; for (let i = 0; i < 12; i++) { x.save(); x.translate(50, 52); x.rotate(i * Math.PI / 6); x.fillRect(-5, -R - 5, 10, 8); x.restore(); } }
    if (wall) { x.strokeStyle = '#fff6e0'; x.lineWidth = 6; x.beginPath(); x.arc(50, 52, R * 0.72, 0, Math.PI * 2); x.stroke(); }
  }
  function rim(x, R, col, star) {
    shaded(x, (p) => p.arc(50, 52, R, 0, Math.PI * 2), col);
    if (star) { shaded(x, (p) => starPath(p, 50, 52, R * 0.85, R * 0.4), light(col)); }
    else { x.fillStyle = dark(col, 0.25); for (let i = 0; i < 5; i++) { const a = i * Math.PI * 0.4 - Math.PI / 2; circ(x, 50 + Math.cos(a) * R * 0.55, 52 + Math.sin(a) * R * 0.55, R * 0.17, dark(col, 0.25)); } }
    circ(x, 50, 52, R * 0.22, dark(col, 0.35)); ell(x, 42, 44, R * 0.25, R * 0.15, 'rgba(255,255,255,.5)', -0.6);
  }
  const light = (hex) => mixHex(hex, '#ffffff', 0.35);
  function mixHex(a, b, t) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const m = (sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t); return '#' + [16, 8, 0].map((sh) => m(sh).toString(16).padStart(2, '0')).join(''); }
  function lamp(x, cx, cy, r, glow) {
    if (glow) { const g = x.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.2); g.addColorStop(0, 'rgba(255,240,170,.8)'); g.addColorStop(1, 'rgba(255,240,170,0)'); x.fillStyle = g; x.fillRect(cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4); }
    shaded(x, (p) => p.arc(cx, cy, r, 0, Math.PI * 2), '#9aa4b0'); circ(x, cx - 1, cy - 1, r * 0.72, '#fff1a8'); ell(x, cx - r * 0.3, cy - r * 0.3, r * 0.25, r * 0.16, '#ffffff', -0.6);
  }
  const PART_ART = {
    lights: {
      std: (x) => { lamp(x, 50, 52, 30, true); },
      fog: (x) => { shaded(x, (p) => p.rect(10, 62, 80, 10), '#6c6470'); lamp(x, 28, 50, 15, true); lamp(x, 72, 50, 15, true); for (const cx of [28, 72]) circ(x, cx - 1, 49, 9, P.honeyLight); },
      led: (x) => { shaded(x, (p) => p.roundRect ? p.roundRect(8, 40, 84, 22, 11) : p.rect(8, 40, 84, 22), '#6c6470'); for (let i = 0; i < 7; i++) lamp(x, 18 + i * 11, 51, 5, true); },
      underglow: (x) => {
        const g = x.createRadialGradient(50, 74, 4, 50, 74, 46); g.addColorStop(0, 'rgba(95,208,255,.9)'); g.addColorStop(1, 'rgba(95,208,255,0)');
        x.fillStyle = g; x.fillRect(0, 40, 100, 60);
        shaded(x, (p) => p.roundRect ? p.roundRect(10, 30, 80, 36, 8) : p.rect(10, 30, 80, 36), P.busGreen);
        x.fillStyle = '#bfe6f5'; for (let wx = 16; wx < 80; wx += 16) x.fillRect(wx, 36, 11, 11);
        for (const wx of [26, 74]) { circ(x, wx, 68, 8, '#3a343f'); circ(x, wx, 68, 3.5, '#c9d2db'); }
      },
      roof: (x) => { shaded(x, (p) => p.rect(8, 58, 84, 9), '#6c6470'); shaded(x, (p) => p.rect(14, 66, 6, 18), '#6c6470'); shaded(x, (p) => p.rect(80, 66, 6, 18), '#6c6470'); for (let i = 0; i < 4; i++) lamp(x, 21 + i * 19.5, 46, 9, true); },
    },
    bumpers: {
      std: (x) => { shaded(x, (p) => p.roundRect ? p.roundRect(8, 40, 84, 24, 8) : p.rect(8, 40, 84, 24), '#6c6470'); },
      chrome: (x) => { shaded(x, (p) => p.roundRect ? p.roundRect(8, 38, 84, 26, 13) : p.rect(8, 38, 84, 26), '#c9d2db'); x.fillStyle = 'rgba(255,255,255,.85)'; x.fillRect(16, 43, 60, 5); ell(x, 82, 45, 4, 2.5, '#fff'); },
      sport: (x) => { shaded(x, (p) => { p.moveTo(6, 40); p.lineTo(94, 40); p.lineTo(86, 68); p.lineTo(14, 68); p.closePath(); }, P.coral); x.fillStyle = '#3a2a3c'; for (const vx of [22, 42, 62]) x.fillRect(vx, 52, 16, 6); },
      bull: (x) => { x.strokeStyle = '#4a4250'; x.lineWidth = 9; x.lineCap = 'round'; x.beginPath(); x.moveTo(14, 74); x.lineTo(14, 34); x.quadraticCurveTo(50, 22, 86, 34); x.lineTo(86, 74); x.moveTo(14, 54); x.lineTo(86, 54); x.moveTo(38, 30); x.lineTo(38, 74); x.moveTo(62, 30); x.lineTo(62, 74); x.stroke(); },
    },
    wheels: {
      std: (x) => { tyre(x, 38); rim(x, 20, '#c9d2db'); },
      big: (x) => { tyre(x, 45); rim(x, 24, '#c9d2db'); },
      chunky: (x) => { tyre(x, 36, true); rim(x, 18, '#c9d2db'); },
      white: (x) => { tyre(x, 40, false, true); rim(x, 20, '#c9d2db'); },
    },
    rims: {
      std: (x) => { tyre(x, 42); rim(x, 28, '#c9d2db'); },
      gold: (x) => { tyre(x, 42); rim(x, 28, '#f5b83d'); },
      red: (x) => { tyre(x, 42); rim(x, 28, P.coral); },
      blue: (x) => { tyre(x, 42); rim(x, 28, '#4fa3e0'); },
      star: (x) => { tyre(x, 42); rim(x, 28, P.honeyLight, true); },
    },
  };
  const GENERIC_PART = {
    lights: (c) => (x) => { lamp(x, 50, 52, 30, true); circ(x, 50, 52, 12, c); },
    bumpers: (c) => (x) => { shaded(x, (p) => p.rect(8, 40, 84, 24), c); },
    wheels: (c) => (x) => { tyre(x, 40); rim(x, 20, c); },
    rims: (c) => (x) => { tyre(x, 42); rim(x, 28, c); },
  };
  const partPic = (kind, id, size = 128) => art('pt-' + kind + '-' + id, size, (PART_ART[kind] && PART_ART[kind][id]) || GENERIC_PART[kind](hashCol(id)));
  // A little side view of each bus type, in the current paint colour (used when fleet.js has no preview).
  function busSide(type, col) {
    return (x) => {
      const dbl = /double/.test(type), bendy = /bendy|artic/.test(type);
      const top = dbl ? 14 : 34, w = bendy ? 88 : 80, x0 = bendy ? 6 : 10;
      const body = (bx, bw) => shaded(x, (p) => p.roundRect ? p.roundRect(bx, top, bw, 78 - top, 8) : p.rect(bx, top, bw, 78 - top), col);
      if (bendy) { body(x0, 46); body(x0 + 49, 39); x.fillStyle = '#4a4250'; x.fillRect(x0 + 45, top + 6, 5, 78 - top - 10); }
      else body(x0, w);
      x.fillStyle = '#bfe6f5';
      const rows = dbl ? [top + 8, top + 34] : [top + 8];
      for (const ry of rows) for (let wx = x0 + 6; wx < x0 + w - 12; wx += 14) if (!(bendy && wx > x0 + 38 && wx < x0 + 52)) x.fillRect(wx, ry, 10, 12);
      x.fillStyle = '#2b2430'; x.fillRect(x0 + w - 14, top + 6, 10, 18);
      x.fillStyle = '#ffb81f'; x.fillRect(x0 + w - 13, top + 9, 8, 5);
      for (const wx of (bendy ? [x0 + 14, x0 + 36, x0 + 74] : [x0 + 18, x0 + w - 20])) { circ(x, wx, 80, 9, '#3a343f'); circ(x, wx, 80, 4, '#c9d2db'); }
    };
  }
  // The bus-type tiles: a snapshot of fleet.js's 3D preview (rendered once per type, colour and number into an
  // off-screen target), or a drawn side view when fleet.js or the renderer isn't there.
  const snaps = {};
  function snapshot(t, col) {
    const key = t + col + S.routeNo;
    if (snaps[key]) return snaps[key];
    const R = BB.renderer, W = 256, H = 192;
    const g = BB.fleet.preview(t, col, S.routeNo);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff6e0, 0x8a7a60, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(6, 10, 7); scene.add(sun);
    scene.add(g);
    const len = (g.userData && g.userData.length) || 12, ht = (g.userData && g.userData.height) || 3.2;
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 500), d = len * 0.98 + 2.5;
    cam.position.set(d * 0.9, ht * 0.6 + d * 0.2, d * 0.45); cam.lookAt(0, ht * 0.42, 0);
    const rt = new THREE.WebGLRenderTarget(W, H), px = new Uint8Array(W * H * 4), old = R.getClearColor(new THREE.Color()), oldA = R.getClearAlpha();
    try {
      R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(scene, cam);
      R.readRenderTargetPixels(rt, 0, 0, W, H, px);
    } finally { R.setRenderTarget(null); R.setClearColor(old, oldA); rt.dispose(); try { g.userData.dispose && g.userData.dispose(); } catch (e) { /* ignore */ } }
    const img = mkCanvas(W); img.height = H; const ix = img.getContext('2d'), id = ix.createImageData(W, H);
    for (let y = 0; y < H; y++) id.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);   // flip
    ix.putImageData(id, 0, 0);
    const out = mkCanvas(128); out.getContext('2d').drawImage(img, 0, 16, 128, 96);
    snaps[key] = out;
    return out;
  }
  function typePic(t, size = 128) {
    const col = (BB.PAINTS.find((p) => p.id === S.paint) || {}).color || P.busGreen;
    if (BB.fleet && typeof BB.fleet.preview === 'function' && BB.renderer) {
      try { return snapshot(t, col); } catch (e) { console.error(e); }
    }
    return art('bus-' + t + col, size, busSide(t, col));
  }
  function platePic(no, size = 128) {
    return art('plate-' + no, size, (x) => {
      shaded(x, (p) => p.roundRect ? p.roundRect(4, 26, 92, 48, 10) : p.rect(4, 26, 92, 48), '#2b2430');
      x.fillStyle = '#ffb81f'; x.font = '800 34px "Courier New", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.shadowColor = 'rgba(255,184,31,.8)'; x.shadowBlur = 6; x.fillText(no, 50, 51);
    });
  }
  // the two ways to drive: a joystick pad with its green knob, or a steering wheel
  const controlPic = (mode) => art('ctl-' + mode, 128, (x) => {
    if (mode === 'wheel') {
      x.lineWidth = 12; x.strokeStyle = '#4a4250'; x.beginPath(); x.arc(50, 50, 38, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = '#3a3440'; x.beginPath(); x.arc(50, 50, 38, -0.3, Math.PI * 0.8); x.stroke();
      x.strokeStyle = '#5a5260'; x.lineWidth = 9; x.lineCap = 'round'; x.beginPath(); x.moveTo(16, 47); x.lineTo(36, 47); x.moveTo(64, 47); x.lineTo(84, 47); x.moveTo(50, 62); x.lineTo(50, 86); x.stroke();
      shaded(x, (p) => p.arc(50, 50, 15, 0, Math.PI * 2), '#f26b5b');
    } else {
      shaded(x, (p) => p.arc(50, 52, 40, 0, Math.PI * 2), '#f1dfb8');
      x.fillStyle = '#3fae49'; x.beginPath(); x.moveTo(50, 16); x.lineTo(57, 25); x.lineTo(43, 25); x.fill();
      x.fillStyle = '#f5a23d'; x.beginPath(); x.moveTo(50, 88); x.lineTo(57, 79); x.lineTo(43, 79); x.fill();
      x.fillStyle = '#19a79b'; x.beginPath(); x.moveTo(14, 52); x.lineTo(23, 45); x.lineTo(23, 59); x.fill(); x.beginPath(); x.moveTo(86, 52); x.lineTo(77, 45); x.lineTo(77, 59); x.fill();
      shaded(x, (p) => p.arc(50, 52, 18, 0, Math.PI * 2), '#3fae49');
    }
  });
  const sidePic = (left) => art('side-' + left, 128, (x) => {
    shaded(x, (p) => p.roundRect ? p.roundRect(8, 20, 84, 60, 10) : p.rect(8, 20, 84, 60), '#9cc7dc');
    const cx = left ? 30 : 70;
    shaded(x, (p) => p.arc(cx, 60, 15, 0, Math.PI * 2), '#fff6e0'); circ(x, cx, 60, 7, P.busGreen);
    circ(x, left ? 72 : 28, 66, 6, '#fff6e0');
  });
  const ICON_ART = {
    bus: (x) => { busSide('single', P.busGreen)(x); },
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
    lights: (x) => { x.drawImage(art('pt-lights-fog', 100, PART_ART.lights.fog), 0, 0); },
    bumpers: (x) => { x.drawImage(art('pt-bumpers-chrome', 100, PART_ART.bumpers.chrome), 0, 0); },
    wheels: (x) => { x.drawImage(art('pt-rims-gold', 100, PART_ART.rims.gold), 0, 0); },
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
  const iconPic = (id, size = 128) => art('ic-' + id, size, ICON_ART[id]);
  function paintPic(color, size = 128) {
    return art('pt-' + color, size, (x) => {
      shaded(x, (p) => p.arc(50, 52, 38, 0, Math.PI * 2), color);
      ell(x, 36, 36, 10, 6, 'rgba(255,255,255,.55)', -0.6);
    });
  }
  D.pics = { sticker: stickerPic, part: partPic, icon: iconPic };
  D.stickerPic = (id) => (STICKER_ART[id] ? stickerPic(id, 128) : null);
  const cv = (src, css) => { const c = mkCanvas(src.width); c.getContext('2d').drawImage(src, 0, 0); if (css) c.style.cssText = css; return c; };

  // ---------- 3D: stickers on the bus ----------
  const stickerMat = {}, stickerGeo = new THREE.PlaneGeometry(1.35, 1.35);
  function stickerMesh(id) {
    if (!stickerMat[id]) {
      const t = new THREE.CanvasTexture(stickerPic(id, 128));
      stickerMat[id] = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
    }
    const m = new THREE.Mesh(stickerGeo, stickerMat[id]); m.name = 'sticker'; m.renderOrder = 2;
    return m;
  }
  let fallback = null;
  function mounts() {
    const B = BB.bus;
    if (!fallback && B.front && B.rear) {
      // spots on the lower body panels, both sides (+x = kerb side, -x = road side), clear of doors and wheels
      const spot = (car, z, side) => { const o = new THREE.Object3D(); o.position.set(side * 1.275, 1.25, z); o.rotation.y = side * Math.PI / 2; car.add(o); return o; };
      fallback = {
        stickers: [[spot(B.front, 0.75, 1), spot(B.front, 0.75, -1)], [spot(B.rear, -0.2, 1), spot(B.rear, -0.2, -1)], [spot(B.front, -0.75, 1), spot(B.front, -0.75, -1)]],
      };
    }
    const raw = (Array.isArray(B.stickerAnchors) && B.stickerAnchors.length) ? B.stickerAnchors : (fallback ? fallback.stickers : []);
    return { stickers: raw.map((a) => (Array.isArray(a) ? a : [a])) };
  }
  const placed = [];
  // Show a look on the bus: {paint, stickers:[ids], parts:{kind:id}}. Missing fields come from the saved choices.
  D.applyLooks = function (look) {
    const B = BB.bus; if (!B || !B.front) return;
    look = Object.assign({ paint: S.paint, stickers: S.stickers }, look || {});
    const parts = Object.assign({}, S.parts, look.parts || {});
    // bus.js applies paint and parts; stickers are ours (so it is given none of its own to show)
    try { B.applyCustom(Object.assign({}, S, { paint: look.paint, stickers: [], parts })); } catch (e) { console.error(e); }
    if (B.setPart) for (const k of PART_KINDS) { try { B.setPart(k, parts[k] || partsOf(k)[0].id); } catch (e) { console.error(e); } }
    for (const m of placed) if (m.parent) m.parent.remove(m);
    placed.length = 0;
    const mt = mounts();
    look.stickers.forEach((id, i) => {
      if (!STICKER_ART[id] || !mt.stickers[i]) return;
      for (const a of mt.stickers[i]) { const m = stickerMesh(id); m.position.z = 0.012; if (a.userData && a.userData.size) m.scale.setScalar(a.userData.size / 1.35); a.add(m); placed.push(m); }
    });
  };
  D.afterBus = function () { if (S.busType || S.routeNo) applyType(); else D.applyLooks(); build3D(); };

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
  .bbd { position: absolute; top: 0; right: 0; bottom: 0; width: min(480px, 56vw); pointer-events: auto; z-index: 10;
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
  .bbd-tabs { display: flex; gap: 4px; flex: none; overflow-x: auto; overflow-y: hidden; touch-action: pan-x; scrollbar-width: none; padding: 2px 3px 6px; margin: -2px -3px -6px; }
  .bbd-tabs::-webkit-scrollbar { display: none; }
  .bbd-break { flex-basis: 100%; height: 0; }
  .bbd-sec { flex-basis: 100%; display: flex; align-items: center; gap: 8px; height: 30px; margin-top: 4px; }
  .bbd-sec canvas { width: 34px; height: 34px; opacity: .8; }
  .bbd-sec::after { content: ''; flex: 1; height: 3px; border-radius: 2px; background: #ecd3a8; }
  .bbd-tile.wide { width: 128px; } .bbd-tile.wide canvas { width: 84px; height: 84px; }
  .bbd-body.bustab { gap: 10px 8px; } .bbd-body.bustab .bbd-sec { height: 24px; margin-top: 0; } .bbd-body.bustab .bbd-sec canvas { width: 26px; height: 26px; }
  @media (min-height: 700px) and (min-width: 1000px) {
    .bbd-body.bustab .bbd-tile { width: 80px; height: 80px; border-radius: 22px; } .bbd-body.bustab .bbd-tile canvas { width: 62px; height: 62px; }
    .bbd-body.bustab .bbd-tile.wide { width: 124px; } .bbd-body.bustab .bbd-tile.wide canvas { width: 84px; height: 84px; }
  }
  /* the start screen's hero: a bigger Drive button that glows and nudges, with a shine sweeping across it */
  .bbd-go.start { height: 88px; background: linear-gradient(#5db4f0, #3d93d6); box-shadow: 0 7px 0 #2370ad; position: relative; overflow: hidden;
    animation: bbd-gopulse 1.3s ease-in-out infinite; }
  .bbd-go.start svg { height: 58px; }
  .bbd-go.start::after { content: ''; position: absolute; top: 0; bottom: 0; width: 60px; left: -80px; background: linear-gradient(100deg, transparent, rgba(255,255,255,.55), transparent);
    animation: bbd-shine 2.6s ease-in-out infinite; }
  @keyframes bbd-shine { 60%, 100% { left: 110%; } }
  @keyframes bbd-gopulse { 50% { box-shadow: 0 7px 0 #2370ad, 0 0 0 12px rgba(79,163,224,.35); transform: scale(1.025); } }
  .bbd-go.start.call { animation: bbd-gopulse 1.3s ease-in-out infinite, bbd-wiggle .9s ease-in-out 2; }
  @keyframes bbd-wiggle { 20% { rotate: -2deg; } 40% { rotate: 2deg; } 60% { rotate: -1.5deg; } 80% { rotate: 1deg; } }
  /* the tab content scrolls above the Drive button; a soft fade shows there is more below */
  .bbd-body.more { -webkit-mask-image: linear-gradient(#000 calc(100% - 34px), transparent); mask-image: linear-gradient(#000 calc(100% - 34px), transparent); }
  .bbd-body::after { content: ''; flex-basis: 100%; height: 6px; }
  .bbd-padwrap { position: absolute; inset: 0; z-index: 55; background: rgba(40,30,50,.35); display: flex; align-items: center; justify-content: center;
    pointer-events: auto; animation: bbd-fade .2s; font-family: 'Baloo 2', 'Fredoka', system-ui, sans-serif; }
  @keyframes bbd-fade { from { opacity: 0; } }
  .bbd-padcard { background: #fff6e0; border: 5px solid #d9b57f; border-radius: 30px; padding: 18px; display: flex; flex-direction: column; gap: 14px;
    align-items: center; box-shadow: 0 10px 0 rgba(120,80,40,.2); animation: bbd-pop .3s cubic-bezier(.2,1.5,.5,1); }
  .bbd-led { min-width: 200px; height: 84px; border-radius: 18px; background: #2b2430; color: #ffb81f; font: 800 64px/84px 'Courier New', monospace;
    text-align: center; letter-spacing: 6px; text-shadow: 0 0 10px rgba(255,184,31,.8); padding: 0 16px; box-sizing: border-box; }
  .bbd-led.typing { color: #ffd45c; }
  .bbd-keys { display: grid; grid-template-columns: repeat(3, 76px); gap: 10px; }
  .bbd-key { height: 76px; border-radius: 22px; border: 3px solid #ecd3a8; background: #fff; font: 800 40px 'Baloo 2', system-ui, sans-serif; color: #3a2a3c;
    box-shadow: 0 5px 0 rgba(120,80,40,.15); cursor: pointer; touch-action: manipulation; display: flex; align-items: center; justify-content: center; padding: 0; }
  .bbd-key.pressed { transform: translateY(3px); box-shadow: 0 2px 0 rgba(120,80,40,.15); }
  .bbd-key.ok { background: #5cb85c; border-color: #3f913f; } .bbd-key.del { background: #fff1dc; }
  @media (max-height: 560px) {
    .bbd-padcard { flex-direction: row; padding: 12px; gap: 14px; }
    .bbd-keys { grid-template-columns: repeat(3, 60px); gap: 7px; } .bbd-key { height: 60px; font-size: 32px; border-radius: 18px; }
    .bbd-led { min-width: 150px; height: 70px; font-size: 50px; line-height: 70px; }
    .bbd-tile.wide { width: 108px; } .bbd-tile.wide canvas { width: 70px; height: 70px; }
    .bbd-sec { height: 24px; } .bbd-sec canvas { width: 26px; height: 26px; }
  }
  .bbd-tab { flex: 1 0 56px; height: 64px; min-width: 56px; border-radius: 20px 20px 12px 12px; border: 3px solid #ecd3a8; background: #fffaf0;
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
  .bbd-go { flex: none; height: 72px; margin-top: 4px; border-radius: 26px; border: none; background: #4fa3e0; box-shadow: 0 6px 0 #2f7fbc; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 10px; touch-action: manipulation; }
  .bbd-go svg { height: 46px; width: auto; }
  .bbd-go.pressed { transform: translateY(4px); box-shadow: 0 2px 0 #2f7fbc; }
  .bbd .shake { animation: bbd-shake .4s; }
  @keyframes bbd-shake { 25% { transform: translateX(-7px); } 75% { transform: translateX(7px); } }
  .bbd-awning { position: absolute; left: 0; top: 0; right: min(480px, 56vw); height: 46px; pointer-events: none; z-index: 5;
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
    .bbd-go.start { height: 64px; } .bbd-go.start svg { height: 42px; }
    .bbd-fuel { padding: 6px 10px; } .bbd-fuel > canvas { width: 56px; height: 56px; } .bbd-fill { height: 62px; }
    .bbd-awning { height: 34px; }
    .bbd-head .bbu-clock { height: 56px; font-size: 24px; padding: 0 12px 0 8px; } .bbd-head .bbu-clock svg { width: 30px; height: 30px; }
  }`);

  const BUS_SVG = '<svg viewBox="0 0 120 56" aria-hidden="true"><rect x="4" y="6" width="92" height="38" rx="10" fill="#fff6e0"/>'
    + '<rect x="12" y="13" width="18" height="14" rx="3" fill="#2f7fbc"/><rect x="34" y="13" width="18" height="14" rx="3" fill="#2f7fbc"/><rect x="56" y="13" width="18" height="14" rx="3" fill="#2f7fbc"/>'
    + '<rect x="78" y="13" width="12" height="22" rx="3" fill="#2f7fbc"/><circle cx="26" cy="46" r="8" fill="#3a2a3c"/><circle cx="76" cy="46" r="8" fill="#3a2a3c"/>'
    + '<path d="M100 14 L118 28 L100 42 Z" fill="#fff6e0"/></svg>';

  let panel = null, awning = null, tab = 'bus', preview = null, goalEl = null, cashSpan = null, cashBox = null, bodyEl = null;
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
      try {
        if (BB.bus.showOff) BB.bus.showOff(kind, id);
        else if (D.isOpen && kind !== 'upgrade') {      // a close look at the new thing, then back to the garage view
          // (wheels and rims: the garage view already shows the bus side on; lights, bumpers, paint, stickers: close up)
          BB.bus.setCamera((kind === 'wheels' || kind === 'rims') && BB.bus.hasCamera && BB.bus.hasCamera('depotSide') ? 'depotSide' : (kind === 'wheels' || kind === 'rims') ? 'depot' : 'depotClose'); D.hop();
          BB.later(3200, () => { if (D.isOpen && BB.bus.camMode !== 'depot') BB.bus.setCamera('depot'); });
        }
      } catch (e) { console.error(e); }
      BB.emit('depot:showOff', { kind, id });
      BB.say(line, { queue: true });
    });
  }
  function showLook() {
    const look = {};
    if (preview) {
      if (preview.kind === 'paint') look.paint = preview.id;
      if (PART_KINDS.includes(preview.kind)) look.parts = { [preview.kind]: preview.id };
      if (preview.kind === 'sticker') look.stickers = nextStickers(preview.id);
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
    const t = BB.el('button', 'bbd-tile' + (opts.on ? ' on' : '') + (opts.preview ? ' preview' : '') + (opts.wide ? ' wide' : ''), parent);
    t.appendChild(cv(picCanvas));
    if (opts.price) { const pr = BB.el('span', 'bbd-price', t); pr.appendChild(coinCv(20)); BB.el('span', '', pr, String(opts.price)); }
    t.style.animationDelay = (opts.i || 0) * 40 + 'ms';
    BB.tap(t, () => opts.tap(t));
    return t;
  }

  // a small picture heading for a group of tiles in the Bus tab
  function sec(icon) { const d = BB.el('div', 'bbd-sec', bodyEl); d.appendChild(cv(icon === 'plate' ? platePic('123', 64) : iconPic(icon, 64))); }
  // the lane helper: a bus between two lane lines, with a sparkle when it is on
  const assistPic = () => art('assist-' + !!S.assist, 128, (x) => {
    x.strokeStyle = '#9aa4b0'; x.lineWidth = 6; x.setLineDash([12, 10]); x.lineCap = 'round';
    x.beginPath(); x.moveTo(20, 8); x.lineTo(20, 92); x.moveTo(80, 8); x.lineTo(80, 92); x.stroke(); x.setLineDash([]);
    shaded(x, (p) => p.roundRect ? p.roundRect(34, 20, 32, 62, 10) : p.rect(34, 20, 32, 62), P.busGreen);
    x.fillStyle = '#bfe6f5'; x.fillRect(39, 26, 22, 12);
    if (S.assist) shaded(x, (p) => starPath(p, 84, 18, 14, 6, 4), P.honey);
  });
  // Apply the saved bus type and number (bus.js rebuilds its model for a new type, so the stickers go back on).
  function applyType() {
    if (BB.bus.setType && S.busType) {
      try { BB.bus.setType(S.busType); } catch (e) { console.error(e); }
      for (const m of placed) if (m.parent) m.parent.remove(m);
      fallback = null; placed.length = 0;
    }
    D.applyLooks();
    try { if (BB.bus.setRouteNumber) BB.bus.setRouteNumber(S.routeNo); } catch (e) { console.error(e); }
    if (D.isOpen) placeProps();
  }
  D.applyType = applyType;
  // the bus number keypad: digits are spoken as they are typed, OK says "Bus 190!"
  let padEl = null;
  function openPad() {
    closePad();
    let buf = '';
    padEl = BB.el('div', 'bbd-padwrap', BB.ui.root);
    const card = BB.el('div', 'bbd-padcard', padEl);
    const led = BB.el('div', 'bbd-led', card, S.routeNo);
    const keys = BB.el('div', 'bbd-keys', card);
    const show = () => { led.textContent = buf || S.routeNo; led.classList.toggle('typing', !!buf); try { if (BB.bus.setRouteNumber) BB.bus.setRouteNumber(buf || S.routeNo); } catch (e) { /* ignore */ } };
    const key = (label, fn, cls) => { const b = BB.el('button', 'bbd-key' + (cls ? ' ' + cls : ''), keys, label); BB.tap(b, fn); return b; };
    for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9]) key(String(d), () => type(d));
    key('<svg viewBox="0 0 24 24" width="34" height="34"><path d="M9 5 H20 V19 H9 L3 12 Z" fill="#f5a23d"/><path d="M12 9 l5 6 M17 9 l-5 6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>', () => { buf = buf.slice(0, -1); BB.sfx.click(); show(); }, 'del');
    key('0', () => type(0));
    key('<svg viewBox="0 0 24 24" width="38" height="38"><path d="M5 12.5l4.5 4.5 9.5-10" stroke="#fff" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>', done, 'ok');
    function type(d) {
      if (!buf && d === 0) { BB.sfx.wrong(); return; }
      if (buf.length >= 3) { shake(led); BB.sfx.wrong(); return; }
      buf += d; BB.sfx.click(); show();
      BB.say(DIGITS[d] + (buf.length === 3 ? '!' : '...'));
      if (buf.length === 3) BB.later(900, done);
    }
    function done() {
      if (!padEl) return;
      if (buf) { S.routeNo = buf; BB.saveNow(); }
      closePad(); applyType(); D.hop(); BB.sfx.sparkle();
      BB.say(`Bus ${S.routeNo}!`, { queue: true });
      renderBody();
    }
    BB.tap(padEl, (e) => { if (e.target === padEl) done(); });
    BB.say('Choose your bus number!');
  }
  function closePad() { if (padEl) padEl.remove(); padEl = null; }

  // the fade at the bottom of the tab content only while there is more to scroll to
  function syncMore() { if (bodyEl) bodyEl.classList.toggle('more', bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight > 8); }
  // Start screen, nothing tapped for a while: "Tap the blue bus to drive!" (after ~10 s, once more after ~25 s).
  let lastTap = 0, calls = 0, idleT = null;
  addEventListener('pointerup', () => { lastTap = performance.now(); }, { passive: true });
  function idleCheck() {
    idleT = null;
    if (!D.isOpen || !D.isStart || BB.bedtime) return;
    const idle = (performance.now() - lastTap) / 1000;
    if (((calls === 0 && idle >= 10) || (calls === 1 && idle >= 15)) && !BB.speaking()) {
      calls++; lastTap = performance.now();
      const go = panel && panel.querySelector('.bbd-go');
      if (go) { go.classList.remove('call'); void go.offsetWidth; go.classList.add('call'); }
      BB.say('Tap the blue bus to drive!');
    }
    if (calls < 2) idleT = BB.later(1000, idleCheck);
  }

  let autoFill = null;
  function renderBody(animate) {
    if (!bodyEl) return;
    autoFill = null;
    bodyEl.innerHTML = '';
    bodyEl.classList.toggle('anim', !!animate);
    bodyEl.classList.toggle('bustab', tab === 'bus');
    BB.later(0, syncMore);
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
      const doFill = (auto) => {
        if (BB.bus.fuel >= 0.98) { if (!auto) BB.say('The tank is full! Yum!'); return; }
        if (btn.dataset.busy) return;
        btn.dataset.busy = '1';
        BB.sfx.gurgle(1.6); fill = 1.8;
        // the gauge fills with bubbles
        const from = BB.bus.fuel;
        bar.animate([{ width: Math.round(from * 100) + '%' }, { width: '100%' }], { duration: 1600, easing: 'ease-in-out', fill: 'forwards' });
        for (let i = 0; i < 10; i++) BB.later(i * 150, () => { const b = BB.el('b', '', gauge); b.style.left = (Math.max(from, i / 10) * 90 + 3) + '%'; BB.later(1000, () => b.remove()); });
        BB.bus.refuel(1);
        BB.later(1700, () => {
          D.hop();
          if (auto) { BB.say('Glug glug! A full tank, free! Now make your bus beautiful!', { queue: true }); BB.later(1200, () => { if (panel && tab === 'fuel') setTab('bus', true); }); }
          else { BB.say('Yum! A full tank!'); renderBody(); }
        });
      };
      BB.tap(btn, () => doFill(false));
      autoFill = () => doFill(true);
      if (!full) BB.later(300, () => { if (tab === 'fuel' && panel) btn.classList.add('shake'); });
    } else if (tab === 'bus') {
      // (a) the bus type: free to switch
      sec('bus');
      fleetTypes().forEach((t, i) => {
        tile(bodyEl, typePic(t.id), { i, on: curType() === t.id, wide: true, tap: () => {
          if (curType() === t.id) { BB.say(t.name + '!'); return; }
          S.busType = t.id; BB.saveNow(); applyType(); BB.sfx.whoosh(); D.hop(); BB.say(t.name + '!');
          BB.later(400, () => renderBody());
        } });
      });
      // (b) the colour
      sec('paint');
      BB.PAINTS.forEach((p, i) => {
        const own = S.paints.includes(p.id);
        tile(bodyEl, paintPic(p.color), { i: i + 3, on: S.paint === p.id && !preview, preview: isPrev('paint', p.id), price: own ? 0 : PAINT_PRICE, tap: (el) => {
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
      // (c) the bus number, and the settings: lane helper, joystick side
      sec('plate');
      tile(bodyEl, platePic(S.routeNo), { i: 9, tap: () => openPad() });
      const as = tile(bodyEl, assistPic(), { i: 10, on: !!S.assist, tap: () => { BB.ui.setAssist(!S.assist); renderBody(); } });
      as.classList.add('toggle');
      tile(bodyEl, sidePic(!!S.leftHand), { i: 11, tap: () => { BB.ui.setLefty(!S.leftHand); renderBody(); } });
      // controls: joystick or steering wheel
      for (const [mode, i] of [['joystick', 12], ['wheel', 13]]) {
        tile(bodyEl, controlPic(mode), { i, on: (S.control || 'joystick') === mode, tap: () => {
          if ((S.control || 'joystick') === mode) { BB.say(mode === 'wheel' ? 'Steering wheel!' : 'Joystick!'); return; }
          BB.ui.setControl(mode); renderBody();
        } });
      }
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
    } else if (tab === 'lights' || tab === 'bumpers' || tab === 'wheels') {
      const kinds = tab === 'wheels' ? ['wheels', 'rims'] : [tab];
      let n = 0;
      for (const kind of kinds) {
        if (kinds.length > 1) BB.el('div', 'bbd-break', bodyEl);        // wheels on one row, rims on the next
        partsOf(kind).forEach((pt, i) => {
          const own = partOwned(kind, pt.id, i), on = partOn(kind, pt.id);
          tile(bodyEl, partPic(kind, pt.id), { i: n++, on: on && !preview, preview: isPrev(kind, pt.id), price: own ? 0 : pt.price, tap: (el) => {
            if (own) {
              setPreview(null);
              if (!on) { S.parts[kind] = pt.id; BB.saveNow(); D.applyLooks(); BB.sfx.pop(); D.hop(); }
              BB.say(partSay(pt)); renderBody(); return;
            }
            if (!isPrev(kind, pt.id)) { setPreview({ kind, id: pt.id }); BB.sfx.whoosh(); speakPrice(partSay(pt), pt.price); renderBody(); return; }
            if (tooSoon()) return;
            if (!buy(el, pt.price)) return;
            S.partsOwned.push(partKey(kind, pt.id)); S.parts[kind] = pt.id; BB.saveNow(); preview = null; D.applyLooks();
            BB.say(['Brilliant!', 'Super cool!', 'Wow!'][Math.floor(Math.random() * 3)]);
            showOff(kind, pt.id, partLove(pt));
            BB.later(700, renderBody);
          } });
        });
      }
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
    bodyEl.addEventListener('scroll', syncMore, { passive: true });
    const go = BB.el('button', 'bbd-go', panel, BUS_SVG);
    BB.tap(go, () => { BB.sfx.pop(); D.close(); });
    setTab(tab, true);
    BB.emit('depot:render', { panel });
  }

  // opts.start: the game's start screen (the bus in its garage before the first drive): the Bus tab first, a bigger
  // Drive button, and the welcome.
  D.open = function (opts) {
    if (D.isOpen) return;
    D.isOpen = true;
    D.isStart = !!(opts && opts.start);
    preview = null; goalEl = null;
    tab = 'bus';
    awning = BB.el('div', 'bbd-awning', BB.ui.root);
    panel = BB.el('div', 'bbd', BB.ui.root);
    render();
    placeProps(); tt = 0;
    BB.bus.setCamera('depot');
    BB.emit('depot:open');
    BB.sfx.whoosh();
    if (D.isStart) {
      if (BB.bus.fuel < 0.98) BB.bus.refuel(1);
      panel.querySelector('.bbd-go').classList.add('start');
      BB.say(D.welcome());
      lastTap = performance.now(); calls = 0; if (!idleT) idleT = BB.later(1000, idleCheck);
      return;
    }
    // fuel is free: every visit fills the tank, with the pump's gurgle as a little show
    const low = BB.bus.fuel < 0.98;
    if (low) { tab = 'fuel'; setTab('fuel', true); }
    BB.say(low ? 'Welcome to the garage! Let\'s fill up the tank.' : 'Welcome to the garage! Make your bus beautiful!');
    if (low) BB.later(900, () => { if (D.isOpen && autoFill) autoFill(); else if (D.isOpen) BB.bus.refuel(1); });
  };
  D.close = function () {
    if (!D.isOpen) return;
    D.isOpen = false;
    const start = D.isStart; D.isStart = false;
    closePad();
    if (BB.bus.fuel < 0.98) BB.bus.refuel(1);   // never leave the garage hungry
    preview = null; D.applyLooks();
    for (const el of [panel, awning]) if (el) el.remove();
    panel = awning = bodyEl = cashBox = cashSpan = goalEl = null;
    BB.bus.setCamera('chase');
    BB.emit('depot:closed', { start });
  };
  D.welcome = () => (BB.HUB ? 'Make your bus, then tap the blue button to drive!' : 'Welcome, Little Bus Captain! Make your bus, then tap the blue button to drive!');
  D.render = () => { if (panel) renderBody(); };
  D.tab = () => tab;
  BB.on('resize', () => BB.later(50, syncMore));
  BB.on('cash:changed', () => { if (cashSpan) cashSpan.textContent = String(D.cash); });
  D.init = function () { /* the 3D props are built once the bus exists (D.afterBus) */ };
})();
