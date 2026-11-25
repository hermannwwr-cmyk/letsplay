/* Little Bus Captain: the depot ("garage") and the economy.
   Cash (bus3d.cash, never taken away except when the child buys something), the saved progress (BB.save, stored as
   bus3d.save by core.js) and the garage screen, which the game starts in and which opens when the bus pulls in:
   - the bus rises on a striped turntable lift that sways gently, a 3D fuel pump in front of it, a striped awning;
   - a paper panel with three big labelled sections: My ride (the bus or another ride, colour, number), Shop (Stickers,
     Lights, Bumpers, Wheels, Extras) and Settings (which side the pedals go, lane helper, Christmas); every tile has a
     picture and a word, and everything is spoken on tap (playing together is automatic, net.js: no section here);
   - the first tap on something new previews it live on the bus and says its price, a second tap buys it
     (coin jingle, coins fly from the counter); too few coins -> "Let's do more jobs!" and a coin goal to aim for;
   - fuel is free: every visit fills the tank (the little tank over the 3D view, the pump's gurgle).
   Stickers are built here and hung on BB.bus.stickerAnchors (or fallback spots on the carriages); parts (lights,
   bumpers, wheels, rims) are drawn by bus.js (B.setPart / applyCustom with save.parts) and only sold here.
   Saved: bus3d.save.parts {kind: id} and partsOwned ['kind:id'].
   Exposes BB.depot = { open(), close(), cash, add(n), spend(n), save, applyLooks(), update(dt), setTab(id, shopId) };
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
    { id: 'gift', say: 'A Christmas present sticker!', price: 4, name: 'present', xmas: true },   // (in the shop at Christmas)
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
  // The other rides (fleet.js: taxi, ice cream van, tow truck, ambulance, fire engine) are bought once with coins; the
  // three buses are free. Owned ones are saved in save.vehiclesOwned.
  const VEH_PRICE = { taxi: 20, icecream: 30, tow: 40, ambulance: 50, fire: 60 };
  const BUS_KINDS = ['bendy', 'double', 'single'];
  const ownsVeh = (id) => !VEH_PRICE[id] || S.vehiclesOwned.includes(id);
  // a bus (route sign, number) or one of the other rides
  const isBusKind = (id) => BUS_KINDS.includes(id) || !!(BB.fleet && BB.fleet.KIND && BB.fleet.KIND[id] === 'bus');
  // the ride on show is a bus? (bus.js says B.kind once it is built)
  const isRideBus = (id) => (BB.bus && BB.bus.type === id && typeof BB.bus.kind === 'string' ? BB.bus.kind === 'bus' : isBusKind(id));
  D.ownsVehicle = ownsVeh; D.VEH_PRICE = VEH_PRICE;
  const curType = () => S.busType || fleetTypes()[0].id;
  const DIGITS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  if (!S.paints.includes('green')) S.paints.unshift('green');
  S.stickers = S.stickers.filter((id) => STICKERS.some((s) => s.id === id)).slice(0, slots());
  // Old saves: hats are gone from the shop (their coins come back quietly); "bright lights" became roof lamps.
  if (BB.saveMigrate && BB.saveMigrate.hatRefund) { D.cash += BB.saveMigrate.hatRefund; BB.store.set('cash', D.cash); }
  // A bus wash paid for but not finished (the page was closed or reloaded mid-wash): the coins come back, quietly.
  // (A wash that did finish has cleaned the bus; then the flag just goes.)
  if (S.washPaid > 0) { if (S.dirt > 0.15) { D.cash += S.washPaid; BB.store.set('cash', D.cash); } S.washPaid = 0; }
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
    if (BB.paper) { BB.paper(x, build, f, { depth: 1.25 }); return; }   // the shared kit: crescent and rim
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
    gift: (x) => {
      shaded(x, (p) => p.roundRect ? p.roundRect(16, 40, 68, 50, 7) : p.rect(16, 40, 68, 50), P.coral);
      shaded(x, (p) => p.roundRect ? p.roundRect(10, 28, 80, 18, 6) : p.rect(10, 28, 80, 18), light(P.coral));
      shaded(x, (p) => p.rect(43, 28, 14, 62), P.honey);
      shaded(x, (p) => { p.ellipse(37, 20, 14, 10, -0.5, 0, Math.PI * 2); p.moveTo(77, 20); p.ellipse(63, 20, 14, 10, 0.5, 0, Math.PI * 2); }, P.honey);
      circ(x, 50, 26, 6, P.honeyDark);
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
      // Christmas lights (when bus.js has them): a string of coloured bulbs on a swag of wire
      xmas: (x) => {
        x.strokeStyle = '#4a6b3a'; x.lineWidth = 3.5; x.beginPath(); x.moveTo(6, 34); x.quadraticCurveTo(28, 62, 50, 40); x.quadraticCurveTo(72, 62, 94, 34); x.stroke();
        [[14, 44, P.coral], [28, 52, P.honey], [42, 46, '#4fa3e0'], [58, 46, P.leaf], [72, 52, P.coral], [86, 44, P.honeyLight]].forEach(([cx, cy, c]) => {
          const g = x.createRadialGradient(cx, cy + 8, 2, cx, cy + 8, 14); g.addColorStop(0, c); g.addColorStop(1, 'rgba(255,255,255,0)');
          x.globalAlpha = 0.45; x.fillStyle = g; x.fillRect(cx - 14, cy - 6, 28, 28); x.globalAlpha = 1;
          shaded(x, (p) => p.ellipse(cx, cy + 8, 5.5, 8, 0, 0, Math.PI * 2), c);
          x.fillStyle = '#5a5260'; x.fillRect(cx - 3, cy - 2, 6, 4);
        });
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
  const XMAS_PART = /xmas|christmas|fairy/i;
  const partPic = (kind, id, size = 128) => art('pt-' + kind + '-' + id, size, (PART_ART[kind] && (PART_ART[kind][id] || (XMAS_PART.test(id) && PART_ART[kind].xmas))) || GENERIC_PART[kind](hashCol(id)));
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
    // a bus in the bus's colour; another ride in its own colour (save.vehiclePaint) or its classic one (fleet PAINT)
    const own = !isBusKind(t) && ((BB.PAINTS.find((p) => p.id === S.vehiclePaint[t]) || {}).color || (BB.fleet && BB.fleet.PAINT && BB.fleet.PAINT[t]));
    const col = own || (BB.PAINTS.find((p) => p.id === S.paint) || {}).color || P.busGreen;
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
  // The ride shown: the one being tried on in the garage, else the chosen one (bus.js rebuilds the model for a type).
  function syncVehicle() {
    const B = BB.bus; if (!B || typeof B.setType !== 'function') return;
    const want = preview && preview.kind === 'vehicle' ? preview.id : curType();
    if (!want || B.type === want || !fleetTypes().some((t) => t.id === want)) return;
    try { B.setType(want); } catch (e) { console.error(e); }
    for (const m of placed) if (m.parent) m.parent.remove(m);
    fallback = null; placed.length = 0;
    try { if (B.setRouteNumber) B.setRouteNumber(S.routeNo); } catch (e) { console.error(e); }
    if (D.isOpen) placeProps();
  }
  D.applyLooks = function (look) {
    const B = BB.bus; if (!B || !B.front) return;
    syncVehicle();
    const tryPaint = !!(look && look.paint);
    look = Object.assign({ paint: S.paint, stickers: S.stickers }, look || {});
    const parts = Object.assign({}, S.parts, look.parts || {});
    // the other rides wear their classic colours unless the child gave them one (save.vehiclePaint); the bus's own
    // colour stays saved for when it comes back (bus.js: setPaint(c, true) repaints a ride anyway)
    const veh = !isRideBus(B.type), vp = veh ? (tryPaint ? look.paint : S.vehiclePaint[B.type]) : null;
    // bus.js applies paint and parts; stickers are ours (so it is given none of its own to show)
    try { B.applyCustom(Object.assign({}, S, { busType: B.type || S.busType, paint: veh ? S.paint : look.paint, stickers: [], parts })); } catch (e) { console.error(e); }
    if (vp && typeof B.setPaint === 'function') { try { B.setPaint(vp, true); } catch (e) { console.error(e); } }
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
  // How far the front carriage's nose is ahead of its centre (its own +z), measured from its meshes, so the pump
  // stands clear of every bus type and every garage view (a 12 m single-decker's nose is much further out than the
  // bendy's front half).
  const _inv = new THREE.Matrix4(), _rel = new THREE.Matrix4(), _bb = new THREE.Box3();
  function noseAhead() {
    const f = BB.bus.front; if (!f) return 3.7;
    f.updateMatrixWorld(true); _inv.copy(f.matrixWorld).invert();
    let z = -Infinity;
    f.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.name === 'sticker') return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && (m.transparent || m.blending === THREE.AdditiveBlending)) return;   // (headlight beams reach far ahead)
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _bb.copy(o.geometry.boundingBox).applyMatrix4(_rel.multiplyMatrices(_inv, o.matrixWorld));
      z = Math.max(z, _bb.max.z);
    });
    return isFinite(z) && z > 1 && z < 14 ? z : 3.7;
  }
  function placeProps() {
    const B = BB.bus; if (!lift || !B.front) return;
    pivot.set((B.front.position.x + B.rear.position.x) / 2, 0, (B.front.position.z + B.rear.position.z) / 2);
    lift.position.set(pivot.x, -0.6, pivot.z); lift.rotation.y = B.heading; lift.visible = true;
    const h = B.heading, fx = Math.sin(h), fz = Math.cos(h), kx = Math.cos(h), kz = -Math.sin(h);
    const ahead = noseAhead() + 9.5;                // well past the nose (the garage views and the turntable's sway leave it out)
    const nx = B.front.position.x + fx * ahead, nz = B.front.position.z + fz * ahead;
    pump.position.set(nx - kx * 1.0, 0.2, nz - kz * 1.0);
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
  // A paper panel on the right with three big labelled sections: My ride (the ride, colour, number), Shop (Stickers,
  // Lights, Bumpers, Wheels, Extras) and Settings (which side the pedals go, lane helper, Christmas).
  // Tiles have a picture and a word; unowned ones a price chip; the chosen one a teal rim and a tick; one being tried
  // on glows, with a green "tap again to buy" chip. Over the 3D view, top left: Coins and Fuel (filled free on every
  // visit) and, in hub mode, the all-games button and the clock. One big "Drive!" button at the bottom.
  BB.css(`
  #ui { --pw: min(500px, 56vw); --tw: 84px; --th: 98px; --tic: 56px; --tlb: 14px; }
  @media (min-height: 700px) and (min-width: 1000px) { #ui { --tw: 96px; --th: 108px; --tic: 64px; --tlb: 15px; } }
  @media (max-height: 520px) { #ui { --tw: 62px; --th: 80px; --tic: 44px; --tlb: 13px; } }
  .bbd { position: absolute; top: 0; right: 0; bottom: 0; width: var(--pw); pointer-events: auto; z-index: 10;
    background: linear-gradient(#fff6e0, #fdebc8); border-left: 5px solid #d9b57f; box-shadow: -8px 0 0 rgba(120,80,40,.12);
    padding: var(--st) var(--sr) var(--sb) 14px; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 10px; font-family: ${BB.FONT}; color: #3a2a3c; animation: bbd-in .35s ease-out; }
  @keyframes bbd-in { from { transform: translateX(100%); } }
  .bbd canvas { display: block; }
  /* the four sections */
  .bbd-tabs { display: flex; gap: 8px; flex: none; }
  .bbd-tab { position: relative; flex: 1 1 0; min-width: 0; height: 86px; border-radius: 22px; border: 3px solid #e4c99a; background: #fffaf0; color: #6b5440;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; cursor: pointer; padding: 4px 2px 6px; touch-action: manipulation;
    box-shadow: inset -3px -4px 0 rgba(217,181,127,.3), 0 4px 0 rgba(120,80,40,.12); font: 700 16px/1 ${BB.FONT}; box-sizing: border-box; }
  .bbd-tab canvas { width: 46px; height: 46px; }
  .bbd-tab .lb { white-space: nowrap; }
  .bbd-tab.on { background: #fff; border-color: #19a79b; color: #127a71; box-shadow: 0 0 0 4px #8fe0c4, 0 4px 0 rgba(20,110,100,.2); }
  .bbd-tab .n { position: absolute; top: -9px; right: -6px; min-width: 28px; height: 28px; border-radius: 14px; background: #5cb85c; color: #fff;
    font: 700 18px/28px ${BB.FONT}; text-align: center; box-shadow: 0 3px 0 #3f913f; }
  /* the shop's kinds of things */
  .bbd-subs { display: flex; gap: 6px; flex: none; }
  .bbd-sub { flex: 1 1 0; min-width: 0; height: 64px; border-radius: 18px; border: 3px solid #ecd3a8; background: #fffaf0; color: #6b5440; padding: 3px 1px 5px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; cursor: pointer; touch-action: manipulation; box-sizing: border-box;
    box-shadow: 0 3px 0 rgba(120,80,40,.1); font: 700 14px/1 ${BB.FONT}; }
  .bbd-sub canvas { width: 32px; height: 32px; }
  .bbd-sub .lb { white-space: nowrap; }
  .bbd-sub.on { background: #fff4d6; border-color: #ffb81f; color: #9a5d00; box-shadow: 0 0 0 3px rgba(255,212,92,.6); }
  .bbd-tab.pressed, .bbd-sub.pressed, .bbd-tile.pressed { transform: translateY(3px); }
  /* the tiles */
  .bbd-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 12px 16px;
    padding: 10px 6px 12px; margin: -4px -6px 0; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
  .bbd-body::after { content: ''; flex-basis: 100%; height: 4px; }
  .bbd-body.more { -webkit-mask-image: linear-gradient(#000 calc(100% - 34px), transparent); mask-image: linear-gradient(#000 calc(100% - 34px), transparent); }
  /* a group: its heading (a little picture and a word) over its tiles; groups sit side by side when they fit */
  .bbd-grp { display: flex; flex-direction: column; gap: 8px; flex: 0 1 auto; max-width: 100%; min-width: 0; }
  .bbd-grp.full { flex-basis: 100%; }
  .bbd-tiles { display: flex; flex-wrap: wrap; gap: 12px 10px; }
  .bbd-sec { display: flex; align-items: center; gap: 8px; height: 30px; font: 700 18px/1 ${BB.FONT}; color: #8a6a48; white-space: nowrap; }
  .bbd-sec canvas { width: 30px; height: 30px; }
  .bbd-sec::after { content: ''; flex: 1; height: 3px; border-radius: 2px; background: #ecd3a8; }
  .bbd-tile { position: relative; width: var(--tw); height: var(--th); border-radius: 22px; border: 3px solid #ecd3a8; background: #fff; color: #4a3424;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; cursor: pointer; padding: 4px 2px 6px; touch-action: manipulation;
    flex: none; box-shadow: 0 4px 0 rgba(120,80,40,.12); box-sizing: border-box; font: 700 var(--tlb)/1 ${BB.FONT}; }
  .bbd-tile canvas { width: var(--tic); height: var(--tic); }
  .bbd-tile .lb { white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .bbd-tile.wide { width: calc(var(--tw) * 1.42); } .bbd-tile.wide canvas { width: calc(var(--tic) * 1.33); }
  .bbd-tile.big { width: calc(var(--tw) * 1.7); height: calc(var(--th) * 1.3); } .bbd-tile.big canvas { width: calc(var(--tic) * 1.5); height: calc(var(--tic) * 1.5); }
  .bbd-body.anim .bbd-tile { animation: bbd-pop .3s cubic-bezier(.2,1.5,.5,1) both; }
  .bbd-tile.on { border-color: #19a79b; background: #f1fcf8; color: #127a71; box-shadow: 0 0 0 4px #8fe0c4, 0 4px 0 rgba(20,110,100,.15); }
  .bbd-tile.on::after { content: ''; position: absolute; top: -10px; right: -10px; width: 30px; height: 30px; border-radius: 50%; box-shadow: 0 2px 0 #127a71;
    background: #19a79b url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12.5l4 4 8-9' stroke='white' stroke-width='3.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/80% no-repeat; }
  /* a ride not bought yet: a little padlock, top left (the price chip is top right) */
  .bbd-tile.locked::before { content: ''; position: absolute; top: -9px; left: -9px; width: 28px; height: 28px; border-radius: 50%; z-index: 1;
    background: #8a6a48 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M8 11 V8 a4 4 0 0 1 8 0 V11' stroke='%23fff6e0' stroke-width='2.6' fill='none'/%3E%3Crect x='5.5' y='10.5' width='13' height='9' rx='2.5' fill='%23ffd45c'/%3E%3C/svg%3E") center/76% no-repeat;
    box-shadow: 0 2px 0 #5a4430; }
  .bbd-tile.locked:not(.preview) canvas { opacity: .8; }
  .bbd-tile.preview { border-color: #ffb81f; background: #fff8e0; animation: bbd-glow 1s infinite alternate; }
  @keyframes bbd-glow { to { box-shadow: 0 0 0 7px rgba(255,212,92,.7); } }
  @keyframes bbd-pop { from { transform: scale(.4); opacity: 0; } }
  .bbd-price { position: absolute; top: -10px; right: -10px; display: flex; align-items: center; gap: 1px; background: #ffd45c; border: 2px solid #d98700;
    border-radius: 14px; font: 700 18px/24px ${BB.FONT}; padding: 0 7px 0 2px; color: #7a4a00; box-shadow: 0 2px 0 rgba(150,90,0,.3); }
  .bbd-price canvas { width: 20px; height: 20px; }
  .bbd-tile.preview .bbd-price { background: #5cb85c; border-color: #3f913f; color: #fff; font-size: 22px; line-height: 30px; padding: 0 9px 0 4px;
    top: -14px; right: -14px; box-shadow: 0 3px 0 #2f7a2f; animation: bbd-buy .8s ease-in-out infinite; }
  .bbd-tile.preview .bbd-price canvas { width: 24px; height: 24px; }
  @keyframes bbd-buy { 50% { transform: scale(1.16); } }
  .bbd-tile.preview .bbd-price::before { content: ''; width: 18px; height: 18px; margin-right: 2px;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12.5l4 4 8-9' stroke='white' stroke-width='3.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat; }
  .bbd-hint { flex-basis: 100%; font: 700 15px/1.2 ${BB.FONT}; color: #9a7a58; text-align: center; margin-top: -4px; }
  .bbd-goal { flex-basis: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; font: 700 20px/1 ${BB.FONT}; color: #b06e00; animation: bbd-pop .3s; }
  .bbd-goal canvas { width: 30px; height: 30px; }
  .bbd-goal .bar { width: 110px; height: 14px; border-radius: 8px; background: #eadfca; overflow: hidden; }
  .bbd-goal .bar i { display: block; height: 100%; background: #ffb81f; }
  /* a note card in the tiles (the dusty-bus hint) */
  .bbd-famstat { flex-basis: 100%; display: flex; align-items: center; gap: 10px; min-height: 58px; padding: 4px 16px 4px 8px; box-sizing: border-box; cursor: pointer;
    border-radius: 20px; border: 3px solid #ecd3a8; background: #fff; font: 700 20px/1.1 ${BB.FONT}; color: #6b5440; touch-action: manipulation; text-align: left; }
  .bbd-famstat canvas { width: 50px; height: 50px; flex: none; }
  .bbd-famstat.st-connecting { background: #fff6dc; border-color: #ffd45c; color: #9a5d00; }
  .bbd-famstat.pressed { transform: translateY(3px); }
  @media (max-height: 520px) { .bbd-famstat { min-height: 56px; font-size: 17px; } .bbd-famstat canvas { width: 42px; height: 42px; } }
  /* the big Drive button */
  .bbd-go { flex: none; height: 80px; margin-top: 2px; border-radius: 28px; border: none; background: linear-gradient(#5db4f0, #3d93d6); box-shadow: inset -5px -6px 0 rgba(0,0,0,.08), 0 7px 0 #2370ad;
    cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 14px; touch-action: manipulation; position: relative; overflow: hidden;
    font: 700 38px/1 ${BB.FONT}; color: #fff; text-shadow: 0 3px 0 #2370ad; }
  .bbd-go svg { height: 50px; width: auto; flex: none; }
  .bbd-go.pressed { transform: translateY(4px); box-shadow: 0 2px 0 #2370ad; }
  /* the start screen's hero: the Drive button glows and nudges, with a shine sweeping across it */
  .bbd-go.start { height: 90px; animation: bbd-gopulse 1.3s ease-in-out infinite; }
  .bbd-go.start::after { content: ''; position: absolute; top: 0; bottom: 0; width: 60px; left: -80px; background: linear-gradient(100deg, transparent, rgba(255,255,255,.55), transparent);
    animation: bbd-shine 2.6s ease-in-out infinite; }
  @keyframes bbd-shine { 60%, 100% { left: 110%; } }
  @keyframes bbd-gopulse { 50% { box-shadow: 0 7px 0 #2370ad, 0 0 0 12px rgba(79,163,224,.35); transform: scale(1.02); } }
  .bbd-go.start.call { animation: bbd-gopulse 1.3s ease-in-out infinite, bbd-wiggle .9s ease-in-out 2; }
  @keyframes bbd-wiggle { 20% { rotate: -2deg; } 40% { rotate: 2deg; } 60% { rotate: -1.5deg; } 80% { rotate: 1deg; } }
  /* over the 3D view, top left: coins, fuel (and the clock in hub mode) */
  .bbd-status { position: absolute; z-index: 12; top: var(--st); left: var(--sl); display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px;
    max-width: calc(100% - var(--pw) - var(--sl) - 12px); pointer-events: none; }
  .bbd-status > * { pointer-events: auto; }
  .bbd-status .bbd-home > canvas, .bbd-status .bbd-book > canvas { width: var(--ic); height: var(--ic); }
  .bbd-status .bbd-cash .row b { font-size: calc(var(--ic) * .74); line-height: 1; color: #3a2a3c; }
  .bbd-status .row canvas { width: var(--ic); height: var(--ic); }
  .bbd-cash.bump { animation: bbd-bump .5s; } @keyframes bbd-bump { 40% { transform: scale(1.15); } }
  .bbd-fuel { animation: bbd-pop .35s cubic-bezier(.2,1.5,.5,1); } .bbd-fuel.gone { display: none; }
  .bbd-tank { position: relative; width: calc(var(--ic) * 1.5); height: calc(var(--ic) * .5); border-radius: 10px; background: #eadfca; overflow: hidden;
    box-shadow: inset 0 2px 0 rgba(120,80,40,.15); }
  .bbd-tank i { display: block; height: 100%; width: 0; border-radius: 10px; background: linear-gradient(90deg, #ff6b5c, #ffb81f 35%, #5cb85c 70%); }
  .bbd-tank b { position: absolute; bottom: 2px; width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,.85); animation: bbd-bubble 1s ease-out forwards; }
  @keyframes bbd-bubble { to { transform: translateY(-18px) scale(.4); opacity: 0; } }
  .bbd-status .bbu-clock { margin-top: calc((var(--bh) - 56px) / 2); }
  .bbd-awning { position: absolute; left: 0; top: 0; right: var(--pw); height: 30px; pointer-events: none; z-index: 5;
    background: repeating-linear-gradient(90deg, #19a79b 0 44px, #fff6e0 44px 88px);
    -webkit-mask: radial-gradient(circle at 22px 15px, #000 15px, transparent 15.5px) 0 15px / 44px 100% repeat-x, linear-gradient(#000, #000) 0 0 / 100% 16px no-repeat;
            mask: radial-gradient(circle at 22px 15px, #000 15px, transparent 15.5px) 0 15px / 44px 100% repeat-x, linear-gradient(#000, #000) 0 0 / 100% 16px no-repeat;
    filter: drop-shadow(0 3px 0 rgba(0,0,0,.12)); animation: bbd-drop .5s ease-out; }
  @keyframes bbd-drop { from { transform: translateY(-100%); } }
  .bbd-coin { position: absolute; width: 34px; height: 34px; z-index: 40; pointer-events: none; }
  .bbd-spark { position: absolute; z-index: 40; pointer-events: none; width: 14px; height: 14px; border-radius: 50%; }
  .bbd .shake { animation: bbd-shake .4s; }
  @keyframes bbd-shake { 25% { transform: translateX(-7px); } 75% { transform: translateX(7px); } }
  /* the bus number keypad */
  /* over the panel, so the bus's route sign (the camera's close-up on the left) shows each digit as it is typed */
  .bbd-padwrap { position: absolute; inset: 0; z-index: 55; display: flex; align-items: center; justify-content: center;
    padding: var(--st) 0 var(--sb) calc(100% - var(--pw)); box-sizing: border-box;
    background: linear-gradient(90deg, rgba(40,30,50,0) calc(100% - var(--pw) - 40px), rgba(40,30,50,.32) calc(100% - var(--pw)));
    pointer-events: auto; animation: bbd-fade .2s; font-family: ${BB.FONT}; }
  @keyframes bbd-fade { from { opacity: 0; } }
  .bbd-padcard { background: linear-gradient(#fff6e0, #fdebc8); border: 5px solid #d9b57f; border-radius: 30px; padding: 18px; display: flex; flex-direction: column; gap: 14px;
    align-items: center; box-shadow: inset -6px -8px 0 rgba(217,181,127,.35), 0 10px 0 rgba(120,80,40,.2); animation: bbd-pop .3s cubic-bezier(.2,1.5,.5,1); }
  .bbd-padhead { display: flex; flex-direction: column; align-items: center; gap: 8px; font: 700 22px/1 ${BB.FONT}; color: #8a6a48; }
  .bbd-led { min-width: 200px; height: 84px; border-radius: 18px; background: #2b2430; color: #ffb81f; font: 800 64px/84px 'Courier New', monospace;
    text-align: center; letter-spacing: 6px; text-shadow: 0 0 10px rgba(255,184,31,.8); padding: 0 16px; box-sizing: border-box; }
  .bbd-led.typing { color: #ffd45c; }
  .bbd-keys { display: grid; grid-template-columns: repeat(3, 76px); gap: 10px; }
  .bbd-key { height: 76px; border-radius: 22px; border: 3px solid #ecd3a8; background: #fff; font: 700 40px ${BB.FONT}; color: #3a2a3c;
    box-shadow: 0 5px 0 rgba(120,80,40,.15); cursor: pointer; touch-action: manipulation; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0; }
  .bbd-key small { font: 700 13px/1 ${BB.FONT}; margin-top: 1px; }
  .bbd-key.pressed { transform: translateY(3px); box-shadow: 0 2px 0 rgba(120,80,40,.15); }
  .bbd-key.ok { background: #5cb85c; border-color: #3f913f; color: #fff; } .bbd-key.del { background: #fff1dc; color: #a8601a; }
  @media (min-height: 700px) and (min-width: 1000px) {
    .bbd-body { gap: 10px 18px; } .bbd-sec { height: 26px; }
  }
  @media (max-height: 560px) {
    .bbd { gap: 6px; padding-left: 10px; }
    .bbd-tab { height: 62px; font-size: 13px; border-radius: 18px; gap: 2px; } .bbd-tab canvas { width: 32px; height: 32px; }
    .bbd-subs { gap: 4px; } .bbd-sub { height: 56px; font-size: 12px; border-radius: 16px; } .bbd-sub canvas { width: 26px; height: 26px; }
    .bbd-body { gap: 8px 12px; padding-top: 8px; } .bbd-grp { gap: 5px; } .bbd-tiles { gap: 8px; }
    .bbd-sec { height: 20px; font-size: 15px; } .bbd-sec canvas { width: 22px; height: 22px; }
    .bbd-tile.wide { width: calc(var(--tw) * 1.5); } .bbd-tile.wide .lb { font-size: 12px; letter-spacing: -.2px; }
    .bbd-go { height: 58px; font-size: 28px; border-radius: 22px; } .bbd-go svg { height: 36px; }
    .bbd-go.start { height: 62px; }
    .bbd-padcard { flex-direction: row; padding: 12px; gap: 14px; }
    .bbd-keys { grid-template-columns: repeat(3, 60px); gap: 7px; } .bbd-key { height: 60px; font-size: 32px; border-radius: 18px; }
    .bbd-led { min-width: 150px; height: 70px; font-size: 50px; line-height: 70px; }
    .bbd-awning { height: 24px; }
    .bbd-status .bbu-clock { font-size: 25px; padding: 0 14px 0 9px; margin-top: 0; } .bbd-status .bbu-clock svg { width: 30px; height: 30px; }
  }
  @media (max-height: 560px) and (max-width: 720px) {
    .bbd-padcard { gap: 10px; padding: 10px; } .bbd-led { min-width: 110px; font-size: 42px; letter-spacing: 3px; padding: 0 10px; }
    .bbd-keys { grid-template-columns: repeat(3, 56px); gap: 6px; } .bbd-key { height: 56px; font-size: 30px; }
  }
  /* "more below": a little bouncing arrow over the bottom of the tiles while there is more to scroll to (a tap scrolls
     on). It sits in a zero-height strip between the tiles and Drive, so it never covers the Drive button. */
  .bbd-morewrap { flex: none; height: 0; position: relative; z-index: 2; margin-top: -10px; pointer-events: none; }
  .bbd-more { position: absolute; left: 50%; bottom: 4px; width: 64px; height: 36px; margin-left: -32px; padding: 0; box-sizing: border-box; display: none;
    border-radius: 18px; border: 3px solid #d9b57f; background: #fff6e0; box-shadow: 0 3px 0 rgba(120,80,40,.18); cursor: pointer; touch-action: manipulation;
    pointer-events: auto; animation: bbd-more 1.2s ease-in-out infinite; }
  .bbd-more.on { display: block; }
  .bbd-more svg { display: block; width: 28px; height: 20px; margin: 5px auto 0; pointer-events: none; }
  @keyframes bbd-more { 50% { transform: translateY(4px); } }
  @media (max-height: 560px) { .bbd-morewrap { margin-top: -6px; } }
  /* small phones held sideways (iPhone SE and the like): smaller tabs and a compact Drive button, so more of the panel is
     tiles; the tiles scroll above Drive and nothing goes under it */
  @media (max-height: 430px) {
    .bbd { gap: 5px; }
    .bbd-morewrap { margin-top: -5px; }
    .bbd-more { width: 56px; height: 30px; margin-left: -28px; bottom: -20px; border-radius: 15px; } .bbd-more svg { width: 24px; height: 17px; margin-top: 4px; }
    .bbd-tab { height: 56px; font-size: 13px; border-radius: 17px; } .bbd-tab canvas { width: 30px; height: 30px; }
    .bbd-tab .n { top: -6px; right: -4px; min-width: 24px; height: 24px; font-size: 15px; line-height: 24px; }
    .bbd-sub { height: 56px; }
    .bbd-body { padding-top: 11px; padding-bottom: 16px; }
    .bbd-body.more { -webkit-mask-image: linear-gradient(#000 calc(100% - 26px), transparent); mask-image: linear-gradient(#000 calc(100% - 26px), transparent); }
    .bbd-go, .bbd-go.start { height: 56px; margin-top: 3px; font-size: 26px; border-radius: 20px; gap: 10px; box-shadow: inset -4px -5px 0 rgba(0,0,0,.08), 0 5px 0 #2370ad; }
    .bbd-go svg { height: 30px; }
    .bbd-go.start { animation: bbd-gopulse-s 1.3s ease-in-out infinite; }
    .bbd-go.start.call { animation: bbd-gopulse-s 1.3s ease-in-out infinite, bbd-wiggle .9s ease-in-out 2; }
    .bbd-go.pressed { box-shadow: 0 1px 0 #2370ad; }
  }
  @keyframes bbd-gopulse-s { 50% { box-shadow: inset -4px -5px 0 rgba(0,0,0,.08), 0 5px 0 #2370ad, 0 0 0 5px rgba(79,163,224,.4); } }
  @media (max-height: 430px) and (max-width: 640px) { .bbd { padding-left: 8px; } .bbd-subs { gap: 3px; } .bbd-sub { padding: 3px 0 5px; } .bbd-tabs { gap: 6px; } }
  @media (max-height: 340px) { #ui { --tw: 60px; --th: 72px; --tic: 38px; } .bbd-body { gap: 6px 10px; } .bbd-tiles { gap: 8px; } }`);

  const BUS_SVG = '<svg viewBox="0 0 120 56" aria-hidden="true"><rect x="4" y="6" width="92" height="38" rx="10" fill="#fff6e0"/>'
    + '<rect x="12" y="13" width="18" height="14" rx="3" fill="#2f7fbc"/><rect x="34" y="13" width="18" height="14" rx="3" fill="#2f7fbc"/><rect x="56" y="13" width="18" height="14" rx="3" fill="#2f7fbc"/>'
    + '<rect x="78" y="13" width="12" height="22" rx="3" fill="#2f7fbc"/><circle cx="26" cy="46" r="8" fill="#3a2a3c"/><circle cx="76" cy="46" r="8" fill="#3a2a3c"/>'
    + '<path d="M100 14 L118 28 L100 42 Z" fill="#fff6e0"/></svg>';
  const SECTIONS = [
    { id: 'bus', icon: 'mybus', label: 'My ride', say: 'My ride! Choose what to drive, its colour and its number.' },
    { id: 'shop', icon: 'shop', label: 'Shop', say: 'The shop! Buy cool things with your coins.' },
    { id: 'settings', icon: 'settings', label: 'Settings', say: 'Settings! How do you like to drive?' },
  ];
  const SHOP = [
    { id: 'sticker', icon: 'stickers', label: 'Stickers', say: 'Stickers!' },
    { id: 'lights', icon: 'lights', label: 'Lights', say: 'Lights!' },
    { id: 'bumpers', icon: 'bumpers', label: 'Bumpers', say: 'Bumpers!' },
    { id: 'wheels', icon: 'wheels', label: 'Wheels', say: 'Wheels and rims!' },
    { id: 'upgrade', icon: 'extras', label: 'Extras', say: 'Super extras!' },
  ];
  // short words for the tiles (the full name is spoken)
  const SHORT = {
    lights: { std: 'Round', fog: 'Fog', led: 'Strip', roof: 'Roof', underglow: 'Glow' },
    bumpers: { std: 'Plain', chrome: 'Shiny', sport: 'Sport', bull: 'Big' },
    wheels: { std: 'Plain', big: 'Big', chunky: 'Chunky', white: 'White' },
    rims: { std: 'Silver', gold: 'Gold', red: 'Red', blue: 'Blue', star: 'Star' },
  };
  const shortOf = (pt) => (SHORT[pt.kind] && SHORT[pt.kind][pt.id]) || (XMAS_PART.test(pt.id) ? 'Christmas' : String(pt.name).split(/[\s-]/)[0]);
  const UPGRADE_WORD = { horn: 'Horn tune', sticker3: '3 stickers' };
  const PAINT_WORD = { green: 'Green', red: 'Red', blue: 'Blue', yellow: 'Yellow', purple: 'Purple', pink: 'Pink' };
  const TYPE_WORD = { bendy: 'Bendy', double: 'Double-decker', single: 'Single-decker', taxi: 'Taxi', icecream: 'Ice cream', tow: 'Tow truck', ambulance: 'Ambulance', fire: 'Fire engine' };
  const TYPE_SAY = { taxi: 'Taxi', icecream: 'Ice cream van', tow: 'Tow truck', ambulance: 'Ambulance', fire: 'Fire engine' };

  let fuelBtn = null, panel = null, awning = null, statusEl = null, tab = 'bus', shopTab = 'sticker', preview = null, goalEl = null, cashSpan = null, cashBox = null, bodyEl = null, tankEl = null;
  const coinCv = (px) => cv(BB.pic('coin', 64), `width:${px}px;height:${px}px`);

  // first tap on something new: try it on, say its price and how to buy it
  function speakPrice(text, price) { BB.say(price ? `${text} ${price} ${price === 1 ? 'coin' : 'coins'}. Tap again to buy!` : text); }
  let previewAt = 0;
  function setPreview(p) { preview = p; previewAt = performance.now(); showLook(); }
  // a second tap within 400 ms is an accidental double tap, not "buy"
  const tooSoon = () => performance.now() - previewAt < 400;
  // ---------- the camera follows the part ----------
  // Each section, shop kind and the number keypad has its own view of the bus (bus.js modes, feature-detected with
  // BB.bus.hasCamera; older bus.js: the depot views).
  const CAM_FALLBACK = { garageWhole: ['depot'], garageFront: ['depotClose', 'depot'], garageWheels: ['depotSide', 'depot'],
    garageSide: ['depot'], garageSign: ['depotClose', 'depot'], garageRear: ['depot'] };
  const SHOP_CAM = { sticker: 'garageSide', lights: 'garageFront', bumpers: 'garageFront', wheels: 'garageWheels', upgrade: 'garageWhole' };
  function camTo(mode) {
    const B = BB.bus; if (!B || !B.setCamera || !D.isOpen) return;
    const has = (m) => (typeof B.hasCamera === 'function' ? B.hasCamera(m) : m === 'depot');
    const pick = [mode].concat(CAM_FALLBACK[mode] || []).find(has) || 'depot';
    if (B.camMode !== pick) { try { B.setCamera(pick); } catch (e) { console.error(e); } }
  }
  const camFor = () => (padEl ? 'garageSign' : tab === 'shop' ? SHOP_CAM[shopTab] || 'garageWhole' : 'garageWhole');
  D.camFor = camFor;
  // after buying: the bus shows off its new thing (it is already in view) and says how much it loves it
  function showOff(kind, id, line) {
    BB.later(900, () => {
      try {
        if (BB.bus.showOff) BB.bus.showOff(kind, id);
        else if (D.isOpen) { camTo(camFor()); D.hop(); }
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
  // Not enough coins: gentle, and a coin goal to aim for (at the top of the tiles).
  function notYet(el, price) {
    shake(el); BB.sfx.wrong();
    const need = price - D.cash;
    BB.say(`Let's do more jobs! ${need} more ${need === 1 ? 'coin' : 'coins'}.`);
    if (goalEl) goalEl.remove();
    goalEl = BB.el('div', 'bbd-goal', null);
    goalEl.appendChild(coinCv(30));
    BB.el('span', '', goalEl, `${D.cash} / ${price}`);
    const bar = BB.el('div', 'bar', goalEl); BB.el('i', '', bar).style.width = Math.round(100 * D.cash / price) + '%';
    if (bodyEl) bodyEl.prepend(goalEl);
  }
  // Pay and celebrate. Returns false (and says so gently) when there aren't enough coins.
  function buy(el, price) {
    if (!D.spend(price)) { notYet(el, price); return false; }
    flyCoins(el, price); BB.sfx.jingle(); bumpCash();
    BB.later(600, () => { sparkle(el); BB.sfx.sparkle(); D.hop(); });
    if (goalEl) { goalEl.remove(); goalEl = null; }
    return true;
  }

  // a tile: a picture and its word, plus a price chip (not owned yet), a tick (chosen) or a glow (being tried on)
  function tile(parent, picCanvas, opts) {
    const t = BB.el('button', 'bbd-tile' + (opts.on ? ' on' : '') + (opts.preview ? ' preview' : '') + (opts.wide ? ' wide' : '') + (opts.big ? ' big' : '') + (opts.locked ? ' locked' : ''), parent);
    t.type = 'button';
    t.appendChild(cv(picCanvas));
    if (opts.label) { BB.el('span', 'lb', t, opts.label); t.setAttribute('aria-label', opts.label); }
    if (opts.price) { const pr = BB.el('span', 'bbd-price', t); pr.appendChild(coinCv(20)); BB.el('span', '', pr, String(opts.price)); }
    t.style.animationDelay = (opts.i || 0) * 35 + 'ms';
    BB.tap(t, () => { opts.tap(t); camTo(camFor()); });
    return t;
  }
  // a heading for a group of tiles: a little picture and a word
  function sec(icon, word, full) {
    const g = BB.el('div', 'bbd-grp' + (full ? ' full' : ''), bodyEl);
    const d = BB.el('div', 'bbd-sec', g); d.appendChild(BB.iconEl(icon, 64)); BB.el('span', '', d, word);
    return BB.el('div', 'bbd-tiles', g);
  }
  // the lane helper: a bus between two lane lines, with a sparkle when it is on
  const assistPic = (on) => BB.icon(on ? 'helperOn' : 'helper', 128);
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
    const head = BB.el('div', 'bbd-padhead', card);
    BB.el('span', '', head, 'Bus number');
    const led = BB.el('div', 'bbd-led', head, S.routeNo);
    const keys = BB.el('div', 'bbd-keys', card);
    const show = () => { led.textContent = buf || S.routeNo; led.classList.toggle('typing', !!buf); try { if (BB.bus.setRouteNumber) BB.bus.setRouteNumber(buf || S.routeNo); } catch (e) { /* ignore */ } };
    const key = (label, fn, cls, aria) => { const b = BB.el('button', 'bbd-key' + (cls ? ' ' + cls : ''), keys, label); if (aria) b.setAttribute('aria-label', aria); BB.tap(b, fn); return b; };
    for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9]) key(String(d), () => type(d));
    key('<svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><path d="M9 5 H20 V19 H9 L3 12 Z" fill="#f5a23d"/><path d="M12 9 l5 6 M17 9 l-5 6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg><small>Delete</small>',
      () => { buf = buf.slice(0, -1); BB.sfx.click(); BB.say('Delete!'); show(); }, 'del', 'Delete');
    key('0', () => type(0));
    key('<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M5 12.5l4.5 4.5 9.5-10" stroke="#fff" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><small>OK</small>', done, 'ok', 'OK');
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
      if (BB.iconRefresh) BB.iconRefresh();
      BB.say(`Bus ${S.routeNo}!`, { queue: true });
      renderBody();
    }
    BB.tap(padEl, (e) => { if (e.target === padEl) done(); });
    camTo('garageSign');
    BB.say('Choose your bus number!');
  }
  function closePad() { if (padEl) { padEl.remove(); padEl = null; camTo(camFor()); } }

  // the fade at the bottom of the tiles only while there is more to scroll to
  let moreEl = null;
  function syncMore() {
    if (!bodyEl) return;
    // (more than the empty space under the last row is still to come)
    let pad = 12; try { pad = parseFloat(getComputedStyle(bodyEl).paddingBottom) || 12; } catch (e) { /* ignore */ }
    const more = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight > pad + 12;
    bodyEl.classList.toggle('more', more);
    if (moreEl) moreEl.classList.toggle('on', more);
  }
  // Start screen, nothing tapped for a while: "Tap the blue Drive button!" (after ~10 s, once more after ~25 s).
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
      BB.say('Tap the blue Drive button to go!');
    }
    if (calls < 2) idleT = BB.later(1000, idleCheck);
  }

  // ---------- fuel: free, filled on every visit (the pump's gurgle; a little tank shows over the 3D view only while
  // it fills, then goes away) ----------
  let filling = false;
  function syncTank() { if (tankEl && !filling) tankEl.firstChild.style.width = Math.round(BB.bus.fuel * 100) + '%'; }
  function fillUp(auto) {
    if (BB.bus.fuel >= 0.98) { if (!auto) BB.say('The tank is full! Yum!'); syncTank(); return; }
    if (filling) return;
    filling = true;
    if (fuelBtn) fuelBtn.classList.remove('gone');
    BB.sfx.gurgle(1.6); fill = 1.8;
    const from = BB.bus.fuel, bar = tankEl && tankEl.firstChild;
    if (bar && bar.animate) bar.animate([{ width: Math.round(from * 100) + '%' }, { width: '100%' }], { duration: 1600, easing: 'ease-in-out', fill: 'forwards' });
    for (let i = 0; i < 8; i++) BB.later(i * 180, () => { if (!tankEl) return; const b = BB.el('b', '', tankEl); b.style.left = (Math.max(from, i / 8) * 85 + 4) + '%'; BB.later(1000, () => b.remove()); });
    BB.bus.refuel(1);
    BB.later(1700, () => {
      filling = false; syncTank(); D.hop();
      BB.say(auto ? 'Glug glug! A full tank, free! Now make your bus beautiful!' : 'Yum! A full tank!', { queue: !!auto });
      BB.later(2500, () => { if (fuelBtn && !filling) fuelBtn.classList.add('gone'); });
    });
  }

  function renderBody(animate) {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    if (goalEl) { goalEl.remove(); goalEl = null; }
    bodyEl.classList.toggle('anim', !!animate);
    BB.later(0, syncMore);
    const isPrev = (kind, id) => preview && preview.kind === kind && preview.id === id;
    const subs = panel.querySelector('.bbd-subs');
    subs.style.display = tab === 'shop' ? '' : 'none';
    subs.querySelectorAll('.bbd-sub').forEach((b) => b.classList.toggle('on', b.dataset.sub === shopTab));
    let n = 0;
    if (tab === 'bus') {
      // a dusty bus: a hint about the bus wash (bus.js: save.dirt, washBay)
      if (BB.bus.washBay && typeof BB.bus.wash === 'function' && (typeof BB.bus.dirt === 'number' ? BB.bus.dirt : +S.dirt || 0) > 0.4) {
        const h = BB.el('button', 'bbd-famstat st-connecting', bodyEl); h.type = 'button';
        h.appendChild(BB.iconEl('wash', 128)); BB.el('span', 'lb', h, 'Dusty! Try the bus wash');
        BB.tap(h, () => BB.say('Your bus is dusty! The bus wash is next to the garage. A wash costs 3 coins.'));
      }
      // (a) the ride: the buses are free to switch; the other rides are tried on with one tap and bought with a second
      let box = sec('mybus', 'Ride');
      fleetTypes().sort((a, b) => (VEH_PRICE[a.id] || 0) - (VEH_PRICE[b.id] || 0)).forEach((t) => {   // (buses first, then by price)
        const own = ownsVeh(t.id), price = VEH_PRICE[t.id] || 0, name = TYPE_SAY[t.id] || t.name;
        tile(box, typePic(t.id), { i: n++, on: curType() === t.id && !(preview && preview.kind === 'vehicle'), preview: isPrev('vehicle', t.id), locked: !own,
          price: own ? 0 : price, wide: true, label: TYPE_WORD[t.id] || t.name, tap: (el) => {
            if (own) {
              if (preview) setPreview(null);
              if (curType() === t.id) { BB.say(name + '!'); renderBody(); return; }
              S.busType = t.id; BB.saveNow(); applyType(); BB.sfx.whoosh(); D.hop(); BB.say(name + '!');
              BB.later(400, () => renderBody());
              return;
            }
            if (!isPrev('vehicle', t.id)) { setPreview({ kind: 'vehicle', id: t.id }); BB.sfx.whoosh(); D.hop(); speakPrice(name + '!', price); renderBody(); return; }
            if (tooSoon()) return;
            if (!buy(el, price)) return;
            S.vehiclesOwned.push(t.id); S.busType = t.id; preview = null; BB.saveNow(); applyType();
            BB.sfx.cheer(); BB.say(`Hooray! A ${name.toLowerCase()}!`);
            BB.later(900, () => { D.hop(); BB.say(`I love my ${name.toLowerCase()}!`, { queue: true }); });
            BB.later(700, () => renderBody());
          } });
      });
      // (c) the bus number (next to the rides when there is room; buses only: the other rides have no route sign)
      if (isBusKind(curType())) {
        box = sec('number', 'Number');
        tile(box, platePic(S.routeNo), { i: n++, wide: true, label: 'Change', tap: () => openPad() });
      }
      // (b) the colour: the bus's own; the other rides keep one each (save.vehiclePaint), or their classic colours
      box = sec('colour', 'Colour', true);
      const vt = curType(), veh = !isRideBus(vt), chosen = veh ? S.vehiclePaint[vt] || null : S.paint;
      const classic = veh && BB.fleet && BB.fleet.PAINT && BB.fleet.PAINT[vt];
      if (veh) tile(box, paintPic(typeof classic === 'string' ? classic : '#ef4b3c'), { i: n++, on: !chosen && !preview, label: 'Classic', tap: () => {
        setPreview(null); delete S.vehiclePaint[vt]; BB.saveNow(); D.applyLooks(); BB.sfx.pop(); D.hop(); BB.say('Classic colours!'); renderBody();
      } });
      const choose = (id) => { if (veh) S.vehiclePaint[vt] = id; else S.paint = id; };
      BB.PAINTS.forEach((p) => {
        const own = S.paints.includes(p.id);
        tile(box, paintPic(p.color), { i: n++, on: chosen === p.id && !preview, preview: isPrev('paint', p.id), price: own ? 0 : PAINT_PRICE, label: PAINT_WORD[p.id] || p.id, tap: (el) => {
          if (own) { setPreview(null); choose(p.id); BB.saveNow(); D.applyLooks(); BB.sfx.pop(); D.hop(); BB.say(PAINT_SAY[p.id] || 'Lovely!'); paintChanged(); return; }
          if (!isPrev('paint', p.id)) { setPreview({ kind: 'paint', id: p.id }); BB.sfx.whoosh(); speakPrice(PAINT_SAY[p.id], PAINT_PRICE); renderBody(); return; }
          if (tooSoon()) return;
          if (!buy(el, PAINT_PRICE)) return;
          S.paints.push(p.id); choose(p.id); BB.saveNow(); preview = null; D.applyLooks();
          BB.say(['Shiny!', 'So pretty!', 'Lovely!'][Math.floor(Math.random() * 3)]);
          showOff('paint', p.id, `I love my ${p.id} paint!`);
          BB.later(700, paintChanged);
        } });
      });
    } else if (tab === 'settings') {
      // (the steering wheel and pedals are the only controls: just which side the pedals go)
      let box = sec(S.leftHand ? 'handL' : 'handR', 'Pedals on');
      for (const [left, word] of [[false, 'Right'], [true, 'Left']]) {
        tile(box, BB.icon(left ? 'handL' : 'handR', 128), { i: n++, on: !!S.leftHand === left, label: word, tap: () => {
          if (!!S.leftHand === left) { BB.say(left ? 'Pedals on the left!' : 'Pedals on the right!'); return; }
          BB.ui.setLefty(left); renderBody();
        } });
      }
      box = sec('helperOn', 'Lane helper');
      for (const [on, word] of [[false, 'Off'], [true, 'On']]) {
        tile(box, assistPic(on), { i: n++, on: !!S.assist === on, label: word, tap: () => {
          if (!!S.assist === on) { BB.say(on ? 'Lane helper on!' : 'Lane helper off!'); return; }
          BB.ui.setAssist(on); renderBody();
        } });
      }
      // Christmas: by the date (1 December to 6 January), always, or never
      box = sec('xmasOn', 'Christmas');
      const XSAY = { auto: 'Christmas comes by itself, in December!', on: 'Christmas on! Ho ho ho!', off: 'Christmas off!' };
      for (const [pref, word, icon] of [['auto', 'Auto', 'xmasAuto'], ['on', 'On', 'xmasOn'], ['off', 'Off', 'xmasOff']]) {
        tile(box, BB.icon(icon, 128), { i: n++, on: (S.xmas || 'auto') === pref, label: word, tap: () => {
          BB.setXmas(pref); BB.sfx[pref === 'off' ? 'pop' : 'sparkle'](); BB.say(XSAY[pref]); renderBody();
        } });
      }
    } else if (tab === 'shop' && shopTab === 'sticker') {
      STICKERS.forEach((st) => {
        const own = S.stickersOwned.includes(st.id), on = S.stickers.includes(st.id);
        if (st.xmas && !BB.xmas && !own) return;          // the present sticker: in the shop at Christmas
        tile(bodyEl, stickerPic(st.id), { i: n++, on: on && !preview, preview: isPrev('sticker', st.id), price: own ? 0 : st.price, label: st.name[0].toUpperCase() + st.name.slice(1), tap: (el) => {
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
    } else if (tab === 'shop' && (shopTab === 'lights' || shopTab === 'bumpers' || shopTab === 'wheels')) {
      const kinds = shopTab === 'wheels' ? ['wheels', 'rims'] : [shopTab];
      for (const kind of kinds) {
        const box = kinds.length > 1 ? sec(kind === 'wheels' ? 'wheels' : 'colour', kind === 'wheels' ? 'Tyres' : 'Rims', true) : bodyEl;
        partsOf(kind).forEach((pt, i) => {
          const own = partOwned(kind, pt.id, i), on = partOn(kind, pt.id);
          if (XMAS_PART.test(pt.id) && !BB.xmas && !own) return;   // Christmas lights: in the shop at Christmas
          tile(box, partPic(kind, pt.id), { i: n++, on: on && !preview, preview: isPrev(kind, pt.id), price: own ? 0 : pt.price, label: shortOf(pt), tap: (el) => {
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
    } else if (tab === 'shop' && shopTab === 'upgrade') {
      UPGRADES.forEach((u) => {
        const own = !!S.upgrades[u.id];
        tile(bodyEl, iconPic(u.id), { i: n++, wide: true, on: own, preview: isPrev('upgrade', u.id), price: own ? 0 : u.price, label: UPGRADE_WORD[u.id] || u.id, tap: (el) => {
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
  // the My bus tab's picture shows the bus's colour: repaint it after a new paint
  function paintChanged() {
    if (BB.iconRefresh) BB.iconRefresh();
    for (const [id, icon] of [['bus', 'mybus']]) {
      const b = panel && panel.querySelector(`.bbd-tab[data-tab="${id}"] canvas`);
      if (b) b.replaceWith(BB.iconEl(icon, 128));
    }
    renderBody();
  }
  function setTab(id, quiet) {
    if (!SECTIONS.some((t) => t.id === id)) id = 'bus';
    tab = id;
    if (preview) { preview = null; D.applyLooks(); }
    panel.querySelectorAll('.bbd-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    bodyEl.scrollTop = 0;
    renderBody(true);
    camTo(camFor());
    if (!quiet) {
      BB.sfx.click();
      const sct = SECTIONS.find((t) => t.id === id) || {};
      if (id === 'shop') BB.say(sct.say + ' ' + ((SHOP.find((t) => t.id === shopTab) || {}).say || ''));
      else BB.say(sct.say || '');
    }
  }
  function setShop(id, quiet) {
    const same = id === shopTab;
    shopTab = id;
    if (preview) { preview = null; D.applyLooks(); }
    bodyEl.scrollTop = 0;
    renderBody(true);
    camTo(camFor());
    if (!quiet) {
      BB.sfx.click();
      // (the shop's opening line already ends with its first kind: "The shop! ... Stickers!"; don't say it twice)
      const line = (SHOP.find((t) => t.id === id) || {}).say || '';
      if (!(same && BB.speaking() && String(BB.lastSay() || '').endsWith(line))) BB.say(line);
    }
  }

  function render() {
    panel.innerHTML = '';
    const tabs = BB.el('div', 'bbd-tabs', panel);
    for (const t of SECTIONS) {
      const b = BB.el('button', 'bbd-tab', tabs); b.type = 'button'; b.dataset.tab = t.id;
      b.appendChild(BB.iconEl(t.icon, 128)); BB.el('span', 'lb', b, t.label); b.setAttribute('aria-label', t.label);
      BB.tap(b, () => setTab(t.id));
    }
    const subs = BB.el('div', 'bbd-subs', panel);
    for (const t of SHOP) {
      const b = BB.el('button', 'bbd-sub', subs); b.type = 'button'; b.dataset.sub = t.id;
      b.appendChild(BB.iconEl(t.icon, 96)); BB.el('span', 'lb', b, t.label); b.setAttribute('aria-label', t.label);
      BB.tap(b, () => setShop(t.id));
    }
    bodyEl = BB.el('div', 'bbd-body', panel);
    bodyEl.addEventListener('scroll', syncMore, { passive: true });
    moreEl = BB.el('button', 'bbd-more', BB.el('div', 'bbd-morewrap', panel),
      '<svg viewBox="0 0 28 20" aria-hidden="true"><path d="M4 5 L14 15 L24 5" stroke="#b07a3c" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    moreEl.type = 'button'; moreEl.setAttribute('aria-label', 'More');
    BB.tap(moreEl, () => { if (!bodyEl) return; BB.sfx.click(); try { bodyEl.scrollBy({ top: bodyEl.clientHeight * 0.7, behavior: 'smooth' }); } catch (e) { bodyEl.scrollTop += bodyEl.clientHeight * 0.7; } });
    const go = BB.el('button', 'bbd-go', panel, BUS_SVG + '<span>Drive!</span>');
    go.type = 'button'; go.setAttribute('aria-label', 'Drive');
    BB.tap(go, () => { BB.sfx.pop(); D.close(); });
    setTab(tab, true);
    // over the 3D view: coins, fuel, (the clock)
    statusEl.innerHTML = '';
    BB.ui.btn(statusEl, 'home', 'Home', () => { if (BB.bedtime) return; BB.sfx.whoosh(); BB.say('Home!'); D.close({ home: true }); }, 'bbd-home');
    if (BB.ui.openBook) BB.ui.btn(statusEl, 'book', 'Book', () => BB.ui.openBook(), 'bbd-book');
    cashBox = BB.ui.btn(statusEl, null, 'Coins', () => BB.say(D.cash === 1 ? 'You have 1 coin.' : `You have ${D.cash} coins.`), 'bbd-cash');
    const crow = BB.el('span', 'row', null); cashBox.prepend(crow); crow.appendChild(coinCv(42)); cashSpan = BB.el('b', '', crow, String(D.cash));
    fuelBtn = BB.ui.btn(statusEl, null, 'Fuel', () => fillUp(false), 'bbd-fuel' + (BB.bus.fuel >= 0.98 ? ' gone' : ''));
    const frow = BB.el('span', 'row', null); fuelBtn.prepend(frow); frow.appendChild(BB.iconEl('fuel', 96));
    tankEl = BB.el('span', 'bbd-tank', frow); BB.el('i', '', tankEl); syncTank();
    if (BB.HUB && BB.ui.makeClock) statusEl.appendChild(BB.ui.makeClock());
    BB.emit('depot:render', { panel });
  }

  // opts.start: the game's start screen (the bus in its garage before the first drive, or after Home): My bus first,
  // a bigger Drive button, and the welcome.
  D.open = function (opts) {
    if (D.isOpen) return;
    D.isOpen = true;
    D.isStart = !!(opts && opts.start);
    preview = null; goalEl = null; filling = false;
    tab = 'bus';
    awning = BB.el('div', 'bbd-awning', BB.ui.root);
    statusEl = BB.el('div', 'bbd-status', BB.ui.root);
    panel = BB.el('div', 'bbd', BB.ui.root);
    render();
    placeProps(); tt = 0;
    BB.bus.setCamera('depot');                    // (then the section's own view, if bus.js has it)
    camTo(camFor());
    BB.emit('depot:open');
    BB.sfx.whoosh();
    if (D.isStart) {
      if (BB.bus.fuel < 0.98) { BB.bus.refuel(1); syncTank(); }
      if (fuelBtn) fuelBtn.classList.add('gone');
      panel.querySelector('.bbd-go').classList.add('start');
      BB.say(D.welcome());
      lastTap = performance.now(); calls = 0; if (!idleT) idleT = BB.later(1000, idleCheck);
      return;
    }
    // fuel is free: every visit fills the tank, with the pump's gurgle as a little show
    const low = BB.bus.fuel < 0.98;
    BB.say(low ? 'Welcome to the garage! Let\'s fill up the tank.' : 'Welcome to the garage! Make your bus beautiful!');
    if (low) BB.later(900, () => { if (D.isOpen) fillUp(true); });
  };
  // opts.home: back to the home screen instead of driving off (a job in progress waits: jobs.js only picks it up when
  // the garage closes in its 'depot' phase, so it is set to 'home' until Play)
  D.close = function (opts) {
    if (!D.isOpen) return;
    const home = !!(opts && opts.home);
    D.isOpen = false;
    const start = D.isStart; D.isStart = false;
    closePad();
    if (BB.bus.fuel < 0.98) BB.bus.refuel(1);   // never leave the garage hungry
    preview = null; D.applyLooks();
    for (const el of [panel, awning, statusEl]) if (el) el.remove();
    panel = awning = statusEl = bodyEl = cashBox = cashSpan = goalEl = tankEl = fuelBtn = moreEl = null;
    if (home && BB.jobs.phase === 'depot') BB.jobs.phase = 'home';
    if (!home) BB.bus.setCamera('chase');
    BB.emit('depot:closed', { start, home });
  };
  D.welcome = () => 'Make your bus, then tap the blue Drive button!';
  D.render = () => { if (panel) renderBody(); };
  D.tab = () => tab;
  D.setTab = (id, sub) => { if (!panel) return; if (sub) shopTab = sub; setTab(id, true); };
  BB.on('resize', () => BB.later(50, syncMore));
  BB.on('cash:changed', () => { if (cashSpan) cashSpan.textContent = String(D.cash); });
  BB.on('xmas:changed', () => { if (panel && tab !== 'settings') renderBody(); });
  D.init = function () { /* the 3D props are built once the bus exists (D.afterBus) */ };
})();
