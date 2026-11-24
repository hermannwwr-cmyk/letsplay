/* Bendy Bus 3D: the depot and the economy.
   Cash (bus3d.cash, never taken away except when the child buys something), the saved progress (BB.save, stored as
   bus3d.save by core.js) and the depot screen: refuel, upgrades, paint. Opened when the bus pulls in at the depot.
   Exposes BB.depot = { open(), close(), cash, add(n), spend(n), save }; emits cash:changed, depot:open, depot:closed. */
(function () {
  'use strict';
  const BB = window.BB, P = BB.P;
  const D = BB.depot = { cash: Math.max(0, BB.store.get('cash', 0) | 0), save: BB.save, isOpen: false };

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

  // Upgrades are fun, never needed. TODO(depot polish): the super sticker slot itself, stickers, the hat/roof
  // decoration, a garage backdrop, a jingle for buying.
  const UPGRADES = [
    { id: 'horn', icon: '🎺', price: 15, say: 'A horn that plays a tune!' },
    { id: 'lights', icon: '💡', price: 20, say: 'Bright headlights!' },
    { id: 'sticker3', icon: '⭐', price: 25, say: 'A super sticker spot!' },
  ];
  const PAINT_PRICE = 5;
  if (!Array.isArray(BB.save.paints)) BB.save.paints = ['green'];

  BB.css(`
  .bbd { position: absolute; top: 0; right: 0; bottom: 0; width: min(440px, 52vw); pointer-events: auto;
    background: linear-gradient(#fff6e0, #fdebc8); border-left: 5px solid #d9b57f; box-shadow: -8px 0 0 rgba(120,80,40,.12);
    padding: max(14px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 14px 16px; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 12px; overflow-y: auto; font-family: 'Baloo 2', 'Fredoka', system-ui, sans-serif;
    color: #3a2a3c; animation: bbd-in .35s ease-out; }
  @keyframes bbd-in { from { transform: translateX(100%); } }
  .bbd-top { display: flex; align-items: center; gap: 10px; }
  .bbd-top canvas { width: 54px; height: 54px; }
  .bbd-cash { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 30px; font-weight: 800;
    background: #fff; border: 3px solid #d9b57f; border-radius: 30px; padding: 2px 16px 2px 6px; }
  .bbd-cash canvas { width: 38px; height: 38px; }
  .bbd-row { display: flex; align-items: center; gap: 10px; background: #fff; border-radius: 22px; padding: 8px 10px;
    border: 3px solid #ecd3a8; }
  .bbd-row > canvas, .bbd-row > .bbd-ico { width: 52px; height: 52px; flex: none; font-size: 40px; text-align: center; line-height: 52px; }
  .bbd-gauge { flex: 1; height: 26px; border-radius: 14px; background: #eadfca; overflow: hidden; }
  .bbd-gauge i { display: block; height: 100%; background: linear-gradient(90deg, #ff6b5c, #ffb81f 30%, #5cb85c 60%); transition: width .6s; }
  .bbd-buy { min-width: 76px; height: 60px; border-radius: 20px; border: none; background: #5cb85c; color: #fff;
    box-shadow: 0 5px 0 #3f913f; font: 800 24px 'Baloo 2', system-ui, sans-serif; display: flex; align-items: center;
    justify-content: center; gap: 4px; padding: 0 10px; cursor: pointer; touch-action: manipulation; }
  .bbd-buy canvas { width: 26px; height: 26px; }
  .bbd-buy.pressed { transform: translateY(4px); box-shadow: 0 1px 0 #3f913f; }
  .bbd-buy.owned { background: #d6efd2; color: #3f913f; box-shadow: none; }
  .bbd-paints { display: flex; flex-wrap: wrap; gap: 8px; flex: 1; min-width: 0; }
  .bbd-pot { box-sizing: border-box; width: 56px; height: 56px; border-radius: 50%; border: 4px solid #fff; box-shadow: 0 0 0 3px #ecd3a8; cursor: pointer;
    position: relative; touch-action: manipulation; }
  .bbd-pot.on { box-shadow: 0 0 0 5px #19a79b; }
  .bbd-pot .price { position: absolute; bottom: -8px; right: -8px; background: #ffd45c; border-radius: 12px; font-size: 15px;
    font-weight: 800; padding: 0 6px; color: #7a4a00; }
  .bbd-ups { display: flex; gap: 8px; flex: 1; }
  .bbd-up { flex: 1; min-height: 76px; border-radius: 20px; border: 3px solid #ecd3a8; background: #fffaf0; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; justify-content: center; font: 800 18px 'Baloo 2', system-ui, sans-serif;
    color: #7a4a00; touch-action: manipulation; }
  .bbd-up b { font-size: 34px; line-height: 1.1; }
  .bbd-up.owned { background: #d6efd2; border-color: #5cb85c; color: #3f913f; }
  .bbd-go { margin-top: auto; height: 72px; border-radius: 26px; border: none; background: #4fa3e0; box-shadow: 0 6px 0 #2f7fbc;
    color: #fff; font: 800 34px 'Baloo 2', system-ui, sans-serif; cursor: pointer; flex: none; touch-action: manipulation; }
  .bbd-go.pressed { transform: translateY(4px); box-shadow: 0 2px 0 #2f7fbc; }
  .bbd .shake { animation: bbd-shake .4s; }
  @keyframes bbd-shake { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
  @media (max-height: 520px) {
    .bbd { gap: 7px; padding-top: 8px; padding-bottom: 8px; }
    .bbd-row { padding: 4px 8px; } .bbd-top canvas { width: 40px; height: 40px; }
    .bbd-pot { width: 44px; height: 44px; border-width: 3px; } .bbd-paints { gap: 6px; } .bbd-up { min-height: 58px; } .bbd-go { height: 58px; font-size: 28px; }
    .bbd-up b { font-size: 26px; } .bbd-cash { font-size: 24px; } .bbd-cash canvas { width: 30px; height: 30px; }
    .bbd-row > canvas, .bbd-row > .bbd-ico { width: 40px; height: 40px; font-size: 30px; line-height: 40px; }
  }`);

  let panel = null;
  const coinImg = (size) => { const c = BB.pic('coin', 64); const k = document.createElement('canvas'); k.width = k.height = 64; k.getContext('2d').drawImage(c, 0, 0); k.style.width = k.style.height = size + 'px'; return k; };
  const picEl = (name) => { const c = document.createElement('canvas'); c.width = c.height = 96; c.getContext('2d').drawImage(BB.pic(name, 96), 0, 0); return c; };
  const noCash = (el) => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); BB.sfx.wrong(); BB.say("Let's earn more coins with a job!"); };

  function render() {
    if (!panel) return;
    panel.innerHTML = '';
    const top = BB.el('div', 'bbd-top', panel);
    top.appendChild(picEl('depot'));
    const cash = BB.el('div', 'bbd-cash', top); cash.appendChild(coinImg(38)); BB.el('span', '', cash, String(D.cash));

    // fuel
    const fuel = BB.el('div', 'bbd-row', panel);
    fuel.appendChild(picEl('pump'));
    const gauge = BB.el('div', 'bbd-gauge', fuel); const fill = BB.el('i', '', gauge); fill.style.width = Math.round(BB.bus.fuel * 100) + '%';
    const price = Math.max(1, Math.ceil((1 - BB.bus.fuel) * 10));
    const full = BB.bus.fuel >= 0.98;
    const fb = BB.el('button', 'bbd-buy' + (full ? ' owned' : ''), fuel);
    if (full) fb.textContent = '✓'; else { fb.appendChild(coinImg(26)); BB.el('span', '', fb, String(Math.min(price, Math.max(D.cash, 0)) || 'free')); }
    BB.tap(fb, () => {
      if (BB.bus.fuel >= 0.98) { BB.say('The tank is full!'); return; }
      const pay = Math.min(price, D.cash);            // gentle: if there aren't enough coins, the rest is free
      if (pay) D.spend(pay);
      BB.bus.refuel(1); BB.sfx.coin();
      BB.say(pay < price ? 'Yum! Free fuel today!' : 'Yum! A full tank!');
      render();
    });

    // paint
    const paint = BB.el('div', 'bbd-row', panel);
    BB.el('div', 'bbd-ico', paint, '🎨');
    const pots = BB.el('div', 'bbd-paints', paint);
    for (const p of BB.PAINTS) {
      const own = BB.save.paints.includes(p.id);
      const pot = BB.el('div', 'bbd-pot' + (BB.save.paint === p.id ? ' on' : ''), pots, own ? '' : `<span class="price">${PAINT_PRICE}</span>`);
      pot.style.background = p.color;
      BB.tap(pot, () => {
        if (!own) { if (!D.spend(PAINT_PRICE)) { noCash(pot); return; } BB.save.paints.push(p.id); BB.sfx.coin(); }
        BB.save.paint = p.id; BB.saveNow(); BB.bus.applyCustom(BB.save); BB.sfx.pop();
        BB.say(['Shiny!', 'Lovely!', 'So pretty!'][Math.floor(Math.random() * 3)]);
        render();
      });
    }

    // upgrades
    const ups = BB.el('div', 'bbd-row', panel);
    BB.el('div', 'bbd-ico', ups, '🔧');
    const list = BB.el('div', 'bbd-ups', ups);
    for (const u of UPGRADES) {
      const own = !!BB.save.upgrades[u.id];
      const b = BB.el('div', 'bbd-up' + (own ? ' owned' : ''), list, `<b>${u.icon}</b><span>${own ? '✓' : u.price}</span>`);
      BB.tap(b, () => {
        if (own) { BB.say(u.say); if (u.id === 'horn') BB.bus.horn(); return; }
        if (!D.spend(u.price)) { noCash(b); return; }
        BB.save.upgrades[u.id] = true; BB.saveNow(); BB.bus.applyCustom(BB.save);
        BB.sfx.cheer(); BB.say(u.say);
        if (u.id === 'horn') BB.later(900, () => BB.bus.horn());
        render();
      });
    }

    const go = BB.el('button', 'bbd-go', panel, '🚌 ▶');
    BB.tap(go, () => D.close());
    BB.emit('depot:render', { panel });
  }

  D.open = function () {
    if (D.isOpen) return;
    D.isOpen = true;
    panel = BB.el('div', 'bbd', BB.ui.root);
    render();
    BB.bus.setCamera('depot');
    BB.emit('depot:open');
    BB.say(BB.bus.fuel < 0.5 ? 'Welcome to the depot! Tap the pump for fuel.' : 'Welcome to the depot!');
  };
  D.close = function () {
    if (!D.isOpen) return;
    D.isOpen = false;
    if (panel) panel.remove(); panel = null;
    BB.bus.setCamera('chase');
    BB.emit('depot:closed');
  };
  D.render = render;
  BB.on('cash:changed', () => { if (panel) { const s = panel.querySelector('.bbd-cash span'); if (s) s.textContent = String(D.cash); } });
  D.init = function () { /* nothing yet; TODO(depot polish) */ };
})();
