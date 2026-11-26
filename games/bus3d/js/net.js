/* Little Bus Captain: playing together (always on: the world, or a private family).
   Each child drives their own bus (own type, colour and number) in the same town and sees the others' buses; they can
   honk (a friend's bus nearby flashes its lights back: a wave). Gentle: no racing, no scores, buses pass through each
   other (a friend's bus is ghosted when it is close to ours, near our stop or in front of the camera), and each device
   keeps its own jobs, questions and coins. No names, no chat, no free text: only bus state, the ride's looks (type,
   paint ids, route-number digits, part/sticker ids) and honks are sent. Everything that comes in is checked: known ids
   only, digits only, positions on the map, clamped speeds and angles, per-sender rate limits (states 25/s, looks every
   2 s, honks and waves every 1.5 s, the sky once a second); anything else is dropped (a type we don't know is shown
   as a single-decker).
   Friends see the ride the child really drives: the three buses, or the taxi, fire engine, ambulance, ice cream van
   or tow truck in its own colours (buildBody's ride()), with its siren lights flashing while its siren is on.
   A friend on their home screen or in their garage stands in the workshop, where our own ride stands on ours: such
   a friend is never drawn (state flag 64, or simply being inside the workshop).
   BB.net.driving() lists the friends out driving now: jobs.js sends the next stops their way (meetPick), so the
   players end up together.

   MODES (saved as bus3d.netmode; whenever online the game joins by itself, at start and again after a dropped link,
   coming back online or the page showing again):
   - 'world' (the default, the owner's choice "everyone in the world"): public rooms lbc-world-1, -2, ... of up to 10
     buses. Start at the last room that worked (bus3d.worldroom); a full room -> the next one at once; alone in a room
     above 1 for a minute -> try from room 1 again, so players gather. Weather and time of day are shared (below).
     Arrivals and departures: one short line at most every 30 s ("A friend's bus is here!", "Bye bye, bus 7!").
   - 'family' (a grown-up's option): a private room named by a saved 5-picture code (bus3d.family, random on first
     run); another device joins by entering it once (setFamily). Day/night and weather follow the earliest member.
     Arrivals and departures name the buses ("Bus 20 is here!").
   An empty room just means "alone for now". Offline, unreachable or (family) full is SILENT: play alone, retry with
   backoff (2 s doubling to 60 s, at once on 'online' / the page showing). Lines are said only at a calm moment
   (driving or the garage, never over a question, the teaching or the counting).

   API (for the garage's Together section and the HUD):
     BB.net.mode()            'world' | 'family';  BB.net.setMode(m) saves it and reconnects
     BB.net.room()            'world 3' | 'family'
     BB.net.family()          -> the 5 picture ids, e.g. ['bus', 'star', 'cat', 'sun', 'flower']
     BB.net.setFamily(ids)    join another family: 5 picture ids or indices (0-11); saved; switches to family mode
                              and reconnects. -> true/false (enterFamily() uses it)
     BB.net.newFamily()       a fresh random family code; saved; reconnects if in family mode. -> the new ids
     BB.net.status()          'offline' | 'connecting' | 'alone' | 'together'
     BB.net.friends()         -> [{ id, type, paint, color, routeNo }] the other rides here now (routeNo '' if not a bus)
     BB.net.driving()         -> [{ x, z }] the friends out driving in the town now (not home, garage, asleep, hidden)
     BB.net.PICS / pic(name, size)   the 12 code pictures (and UI pictures: together, home, speak, tick, cross, del,
                              cloud, join, make) as paper-cut canvases
     BB.net.showFamily()      a card: our code (spoken, each picture lit in turn) and the buses here now
     BB.net.enterFamily()     a card: tap another device's 5 pictures to join that family
     BB.net.fillFriends(el, withMe)  little bus chips (picture + number, spoken on tap) into an element
     events: 'net:status' {status}, 'net:friends' {friends}
     Internal: init(), update(dt), goodnight(), leave(why) (bedtime and the hub removing the frame: a polite goodbye,
     then no reconnecting).

   Layers:
   1. Transport (a room as a message bus):  const t = wsTransport(url); t.connect(roomName);
        t.onOpen({ self, peers })   self: my member id (lower = in the room longer; ids can be reused after a leave)
        t.onPeerJoin(id)  t.onPeerLeave(id)  t.onMessage(from, msg)
        t.onError(kind)             before open: 'offline' | 'full'
        t.onClose('lost')           after open: our link dropped
        t.send(msg)  t.close()      (close is quiet: no callbacks)
      The only transport is the owner's Cloudflare relay (relay/worker.js: a Worker and one Durable Object per room, no
      device hosts, the room lives while anyone is in it; it adds {from}, caps 10 members, 4 KB and 40 msgs/s): a
      WebSocket to <RELAY>/room/<lbc-world-N | lbc-5 letters>; welcome {id, members}, join/leave, full; we ping every 20 s. (The
      PeerJS fallback was dropped with the always-on family: it needs a host device, which doesn't fit.)
      Test only: ?relay=ws://127.0.0.1:8787 (a local `wrangler dev`; only localhost addresses are accepted).
   2. Room logic (below): every member sends its own state about 10 times a second (less when standing still; one
      "parked" state when the page hides; parked while the hub holds the game), its looks ('hi') when it arrives or
      someone new comes, honks and waves. Weather and time of day follow one member in every room, world rooms too
      (the sky authority: the lowest member id still here, every 3 s; when it leaves the next one carries on; silent
      for 12 s -> our own weather clock again); our own bedtime night (hub mode) always wins and is never sent.
   3. Friends' rides: cheap low-detail models (one draw call each, bending in the vertex shader for bendies) plus
      ONE instanced mesh for all their wheels, one for all their blob shadows and one for all their floating
      route-number badges: ~12 draw calls for 9 friends. Interpolated ~200 ms behind.
   The HUD shows the friends here as little bus pictures with their numbers, top right under the buttons. */
(function () {
  'use strict';
  const hypot2 = (a, b) => Math.sqrt(a * a + b * b);   // (Math.hypot is slow and makes garbage on every call)
  const BB = window.BB, P = BB.P;
  const N = BB.net = { self: -1, MAX: 10 };
  const remotes = new Map();                      // friends' buses by member id

  const LETTERS = 'bcdfghjkmnpq';                 // picture index -> a letter in the room name
  const PICS = ['bus', 'star', 'cat', 'sun', 'flower', 'fish', 'heart', 'moon', 'tree', 'kite', 'ball', 'boat'];
  const CODE_LEN = 5;
  // The family-room relay (relay/worker.js, deployed on Cloudflare).
  const RELAY = 'wss://bus-captain-rooms.hermannwwr.workers.dev';
  // test only: ?relay=ws://127.0.0.1:8787 (a local `wrangler dev`); only localhost addresses are accepted
  const RELAY_TEST = (location.search.match(/[?&]relay=(wss?:\/\/(?:127\.0\.0\.1|localhost)(?::\d{2,5})?)(?=[&#/]|$)/) || [])[1] || null;
  const RELAY_URL = RELAY_TEST || RELAY;
  const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  // ================= the relay transport (WebSocket to the Cloudflare room) =================
  function wsTransport(base) {
    const T = {};
    let ws = null, state = 'idle', openT = 0, pingT = 0, heard = 0;
    const call = (fn, ...a) => { if (T[fn]) { try { T[fn](...a); } catch (e) { console.error(e); } } };
    const offline = () => end('lost');                         // the device says the network went away
    function cleanup() {
      clearTimeout(openT); clearInterval(pingT); openT = pingT = 0;
      removeEventListener('offline', offline);
      if (ws) { const w = ws; ws = null; w.onopen = w.onmessage = w.onclose = w.onerror = null; try { w.close(1000, 'bye'); } catch (e) { /* closed */ } }
    }
    const fail = (k) => { if (state === 'done') return; state = 'done'; cleanup(); call('onError', k); };
    const end = (why) => { if (state !== 'open') return; state = 'done'; cleanup(); call('onClose', why); };
    T.connect = function (code) {
      state = 'opening';
      try { ws = new WebSocket(base.replace(/\/+$/, '') + '/room/' + code); } catch (e) { setTimeout(() => fail('offline'), 0); return; }
      openT = setTimeout(() => fail('offline'), 10000);
      ws.onmessage = (e) => {
        heard = performance.now();
        if (typeof e.data !== 'string' || e.data.length > 8192) return;
        let m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (!m || typeof m !== 'object' || Array.isArray(m)) return;
        if ('from' in m) {                                   // a friend's message
          if (state !== 'open' || !Number.isInteger(m.from)) return;
          const from = m.from; delete m.from;
          call('onMessage', from, m);
          return;
        }
        if (m.t === 'welcome' && state === 'opening') {      // (members [] = we're the first one here: fine)
          clearTimeout(openT); state = 'open';
          pingT = setInterval(() => {
            if (performance.now() - heard > 50000) { end('lost'); return; }   // no pong: the link is dead
            T.send({ t: 'ping' });
          }, 20000);
          addEventListener('offline', offline);
          call('onOpen', { self: m.id | 0, peers: (Array.isArray(m.members) ? m.members : []).filter(Number.isInteger) });
        } else if (m.t === 'full') fail('full');
        else if (state !== 'open') return;
        else if (m.t === 'join' && Number.isInteger(m.id)) call('onPeerJoin', m.id);
        else if (m.t === 'leave' && Number.isInteger(m.id)) call('onPeerLeave', m.id);
      };
      ws.onclose = (e) => { if (state === 'open') end('lost'); else fail(e && e.code === 4001 ? 'full' : 'offline'); };
      ws.onerror = () => { /* onclose follows */ };
    };
    T.send = function (msg) {
      if (state !== 'open' || !ws || ws.readyState !== 1 || ws.bufferedAmount > 65536) return;
      try { ws.send(JSON.stringify(msg)); } catch (e) { /* dropped */ }
    };
    T.close = function () { state = 'done'; cleanup(); };
    return T;
  }
  const makeTransport = () => wsTransport(RELAY_URL);
  N.transports = { relay: wsTransport, make: makeTransport };
  // Worth trying? (the device thinks it is online and has WebSockets)
  N.canTry = () => navigator.onLine !== false && typeof WebSocket === 'function';

  // ================= room logic (transport-agnostic) =================
  let T = null, link = 'offline', members = new Set(), tickT = 0, lastHi = '';     // link: offline | connecting | open
  const authority = () => { let a = N.self; for (const m of members) if (m < a) a = m; return a; };
  N.isAuthority = () => link === 'open' && authority() === N.self;
  const send = (msg) => { if (T && link === 'open') T.send(msg); };

  function myLook() {
    const S = BB.save;
    const ty = S.busType || 'bendy';
    // vp: the colour the child gave one of the other rides ('' = its classic colours); pa stays the bus's colour
    const vp = isBus(ty) ? '' : String((S.vehiclePaint && S.vehiclePaint[ty]) || '');
    return { ty, pa: S.paint || 'green', vp, no: String(S.routeNo || '88'), st: (S.stickers || []).slice(0, 3), pt: Object.assign({}, S.parts || {}) };
  }
  const RIDES = ['taxi', 'fire', 'ambulance', 'icecream', 'tow'];          // the rides that aren't buses
  const RIDE_NAME = { taxi: 'taxi', fire: 'fire engine', ambulance: 'ambulance', icecream: 'ice cream van', tow: 'tow truck' };
  const RIDE_PAINT = { taxi: '#f5b83d', fire: '#e8463a', ambulance: '#f4f1ea', icecream: '#ff8fab', tow: '#ffb81f' };
  const isBus = (ty) => RIDES.indexOf(ty) < 0;
  // the colour a friend's ride is drawn in: a bus in its paint, another ride in its own colour or its classic one
  function lookHex(l) {
    if (isBus(l.ty)) return paintHex(l.pa);
    if (l.vp) return paintHex(l.vp);
    return (BB.fleet && BB.fleet.PAINT && BB.fleet.PAINT[l.ty]) || RIDE_PAINT[l.ty];
  }
  // how a friend's ride is called in a spoken line: "bus 7", "the fire engine"
  const sayRide = (o, cap) => (o.ty && !isBus(o.ty) ? (cap ? 'The ' : 'the ') + RIDE_NAME[o.ty] : (cap ? 'Bus ' : 'bus ') + o.no);
  function sendHi(force) {
    const look = myLook(), key = JSON.stringify(look);
    if (!force && key === lastHi) return;
    lastHi = key; send({ t: 'hi', look });
  }
  function cleanLook(l) {
    if (!l || typeof l !== 'object') return null;
    const types = ['bendy', 'double', 'single'].concat(RIDES);
    const word = (v) => typeof v === 'string' && /^[a-z0-9]{1,12}$/.test(v);    // ids only, never shown as text
    // paint and number must be real ones (a look that isn't is ignored: that bus isn't shown); a type we don't know
    // (a newer game?) is shown as a plain single-decker
    if (typeof l.ty !== 'string' || !BB.PAINTS.some((p) => p.id === l.pa) || !/^[1-9][0-9]{0,2}$/.test(String(l.no))) return null;
    const ty = types.indexOf(l.ty) >= 0 ? l.ty : 'single';
    const vp = !isBus(ty) && typeof l.vp === 'string' && BB.PAINTS.some((p) => p.id === l.vp) ? l.vp : '';
    const pt = {};
    if (l.pt && typeof l.pt === 'object' && !Array.isArray(l.pt)) for (const k of ['lights', 'bumpers', 'wheels', 'rims']) if (word(l.pt[k])) pt[k] = l.pt[k];
    return { ty, pa: l.pa, vp, no: String(l.no), st: Array.isArray(l.st) ? l.st.filter(word).slice(0, 3) : [], pt };
  }
  // my state: [x, z, heading, rear heading, speed, steer, flags]; flags 1 doors, 2 lights, 4 at a stop, 8 asleep,
  // 16 parked (hidden or held), 32 in the garage, 64 standing in the workshop (the home screen or the garage: friends
  // don't draw us there, or everybody's ride would stand in the same spot), 128 siren on
  function myState(parked) {
    const B = BB.bus; if (!B || !B.front) return [0, 0, 0, 0, 0, 0, 16];
    const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
    const held = !!(parked || BB.held);
    let fl = 0;
    if (B.doorsOpen) fl |= 1;
    if (B.lightsOn && !BB.bedtime) fl |= 2;
    if (B.atStop) fl |= 4;
    if (BB.bedtime) fl |= 8;
    if (held) fl |= 16;
    if (BB.depot && BB.depot.isOpen) fl |= 32;
    if (B.inWorkshop) fl |= 64;
    if (B.sirenOn && B.sirenOn()) fl |= 128;
    return [r2(B.front.position.x), r2(B.front.position.z), r3(wrapA(B.front.rotation.y)), r3(wrapA((B.rear || B.front).rotation.y)),
      held ? 0 : r2(B.speed || 0), r2(B.steer || 0), fl];
  }
  function cleanState(d) {
    if (!Array.isArray(d) || d.length !== 7) return null;
    for (const v of d) if (typeof v !== 'number' || !isFinite(v)) return null;
    const Bd = (BB.world && BB.world.BOUNDS) || { x0: -1000, x1: 1000, z0: -1000, z1: 1000 };
    if (d[0] < Bd.x0 - 40 || d[0] > Bd.x1 + 40 || d[1] < Bd.z0 - 40 || d[1] > Bd.z1 + 40) return null;   // off the map: ignored
    if (Math.abs(d[2]) > 7 || Math.abs(d[3]) > 7) return null;
    return { x: d[0], z: d[1], h: wrapA(d[2]), hr: wrapA(d[3]), sp: BB.clamp(d[4], -12, 12), st: BB.clamp(d[5], -1, 1), fl: (d[6] | 0) & 255 };
  }

  let lastKey = '', lastAt = 0, skyAt = 0, hiAt = 0, staleAt = 0, parkedSent = false;
  function tick() {
    flushNews();
    if (!T || link !== 'open') return;
    const now = performance.now();
    // a friend we haven't heard from for a while (a device that died without a goodbye) fades away quietly: after
    // 30 s, or 90 s if it said it was parked (its page hidden); it comes back with its next looks ('hi' every 15 s)
    if (now - staleAt > 1000) {
      staleAt = now;
      for (const r of [...remotes.values()]) {
        const last = r.snaps.length ? r.snaps[r.snaps.length - 1] : null, quiet = now / 1000 - (r.heard || r.born || 0);
        if (!r.leaving && quiet > (last && (last.fl & 16) ? 90 : 30)) removeRemote(r.id, null, true);
      }
    }
    if (document.hidden) { if (!parkedSent) { parkedSent = true; send({ t: 's', d: myState(true) }); } return; }
    parkedSent = false;
    const d = myState(false), key = d.join(',');
    if (key !== lastKey || now - lastAt > 500) { send({ t: 's', d }); lastKey = key; lastAt = now; }
    if (now - hiAt > 15000) { hiAt = now; sendHi(true); }
    const W = BB.world;
    if (N.isAuthority()) {
      if (W && !W.weatherAuto) W.weatherAuto = true;                  // (we decide the sky: our own weather clock)
      skyWant = -1;
      if (members.size && now - skyAt > 3000) { skyAt = now; sendSky(); }
    } else if (now - skyHeard > 12000) {
      // nothing from the one who decides (gone without a goodbye, asleep, or an older game that keeps its own sky):
      // our own weather clock again, from the weather we have now
      if (W && !W.weatherAuto) W.weatherAuto = true;
      skyWant = -1;
    }
    // world mode: alone in a higher room for a minute -> look for company in the lower rooms again
    if (mode === 'world' && worldN > 1 && !members.size) {
      if (!aloneAt) aloneAt = now;
      else if (now - aloneAt > 60000) { aloneAt = 0; gather(); }
    } else aloneAt = 0;
  }
  // The sky is shared in a room (world rooms too: the owner asked for the same weather for everyone): the member who
  // decides (authority(): the lowest member id still here) sends its weather and its time of day every 3 s and at once
  // to a newcomer; the others follow. Its own bedtime night (hub mode) is never sent (d: -1 = "keep your own clock"),
  // and ours always wins here: while W.bedSky() nothing touches our day clock. When the one who decides leaves, the
  // next lowest id carries on from the same sky.
  let skyHeard = -1e9, skyWant = -1, skyWantAt = 0;
  function sendSky() {
    const W = BB.world; if (!W || BB.bedtime) return;
    const bed = W.bedSky && W.bedSky();
    send({ t: 'sky', d: bed ? -1 : Math.round(W.dayTime * 10000) / 10000, w: W.weather });
  }
  function applySky(d, w) {
    const W = BB.world; if (!W) return;
    skyHeard = performance.now();
    if (typeof w === 'string' && W.WEATHERS.indexOf(w) >= 0) { W.weatherAuto = false; if (W.weather !== w) W.setWeather(w); }
    if (typeof d !== 'number' || !isFinite(d) || d < 0 || d >= 1) { skyWant = -1; return; }
    skyWant = d; skyWantAt = skyHeard;
  }
  // our day clock follows the shared one: a small step is taken at once; a big one (we just came into the room) is a
  // jump on the home screen or in the garage, and a quick, smooth turn of the sky while driving (never a flash from
  // day to night). Runs every frame; no objects made.
  function followSky(dt) {
    if (skyWant < 0) return;
    const W = BB.world; if (!W || (W.bedSky && W.bedSky()) || BB.bedtime) { skyWant = -1; return; }
    const want = (skyWant + (performance.now() - skyWantAt) / 1000 * W.day.speed) % 1;      // (their clock ran on meanwhile)
    const diff = ((want - W.dayTime) % 1 + 1.5) % 1 - 0.5, ad = Math.abs(diff);
    if (ad < 0.003) return;
    const calmPlace = (BB.depot && BB.depot.isOpen) || (BB.ui && BB.ui.titleShown && BB.ui.titleShown());
    if (ad < 0.012 || calmPlace) { W.setDayTime(want); return; }
    W.setDayTime(W.dayTime + Math.sign(diff) * Math.min(ad, dt * 0.06));
  }

  function onMsg(from, m) {
    if (!Number.isInteger(from) || from === N.self || !m || typeof m !== 'object') return;
    if (!members.has(from)) { if (members.size >= N.MAX - 1) return; members.add(from); }   // (a message can arrive just before its join)
    const r = remotes.get(from), now = performance.now();
    // per-sender limits, so a misbehaving client can't flood us: states 25/s, looks every 2 s, honks/waves every 1.5 s
    const lim = rate.get(from) || { s: 0, sN: 0, hi: -1e9, honk: -1e9, wave: -1e9, sky: -1e9 };
    rate.set(from, lim);
    switch (m.t) {
      case 's': {
        if (now - lim.s > 1000) { lim.s = now; lim.sN = 0; }
        if (++lim.sN > 25) return;
        const s = cleanState(m.d); if (s && r) pushSnap(r, s); else if (s) pending.set(from, s); break;
      }
      case 'hi': {
        const look = cleanLook(m.look); if (!look) return;
        if (r && now - lim.hi < 2000 && JSON.stringify(r.look) !== JSON.stringify(look)) return;   // no rapid look changes
        lim.hi = now; upsertRemote(from, look); break;
      }
      case 'sky': if (from === authority() && now - lim.sky > 1000) { lim.sky = now; applySky(m.d, m.w); } break;
      case 'honk': if (r && now - lim.honk > 1500) { lim.honk = now; friendHonk(r, m.tune === true); } break;
      case 'wave': if (r && now - lim.wave > 1500) { lim.wave = now; friendWave(r); } break;
      case 'bye': if (r) r.byeWhy = m.why === 'sleep' ? 'sleep' : 'home'; break;
    }
  }
  const pending = new Map();             // a state that came before the looks
  const rate = new Map();                // per-sender message limits

  // ================= the family code =================
  const validCode = (a) => Array.isArray(a) && a.length === CODE_LEN && a.every((i) => Number.isInteger(i) && i >= 0 && i < PICS.length);
  function newCode() {
    const out = [], a = new Uint8Array(16);
    while (out.length < CODE_LEN) { crypto.getRandomValues(a); for (const v of a) if (v < 252 && out.length < CODE_LEN && !out.includes(v % 12)) out.push(v % 12); }   // 5 different pictures (easier to copy); entering a code still accepts repeats
    return out;
  }
  const codeStr = (c) => c.map((i) => LETTERS[i]).join('');
  const toCode = (ids) => {
    if (!Array.isArray(ids) || ids.length !== CODE_LEN) return null;
    const a = ids.map((v) => (typeof v === 'number' ? v : PICS.indexOf(String(v).toLowerCase())));
    return validCode(a) ? a : null;
  };
  let fam = BB.store.get('family', null);
  if (!validCode(fam)) { fam = newCode(); BB.store.set('family', fam); }
  let famCode = codeStr(fam);                     // the room name's letters
  N.PICS = PICS.slice();
  N.family = () => fam.map((i) => PICS[i]);
  N.setFamily = function (ids) {                     // (switches to family mode)
    const a = toCode(ids); if (!a) return false;
    if (codeStr(a) === famCode && mode === 'family') return true;
    fam = a; BB.store.set('family', fam); famCode = codeStr(fam);
    if (mode !== 'family') { mode = 'family'; BB.store.set('netmode', mode); }
    relink(); return true;
  };
  N.newFamily = function () {
    let a; do { a = newCode(); } while (codeStr(a) === famCode);
    fam = a; BB.store.set('family', fam); famCode = codeStr(fam);
    if (mode === 'family') relink();
    return N.family();
  };

  // ================= modes: the world (default) or a private family =================
  // world: public rooms lbc-world-1, -2, ... (10 buses each): start at the last good one, the next one when full; alone
  // in a higher room for a minute -> try the lower ones again, so players gather. family: the private picture code.
  const WORLD_MAX = 200;
  let mode = BB.store.get('netmode', 'world') === 'family' ? 'family' : 'world';
  let worldN = BB.clamp(BB.store.get('worldroom', 1) | 0, 1, WORLD_MAX), fullTries = 0, aloneAt = 0;
  const roomName = () => (mode === 'family' ? 'lbc-' + famCode : 'lbc-world-' + worldN);
  N.mode = () => mode;
  N.room = () => (mode === 'family' ? 'family' : 'world ' + worldN);
  N.setMode = function (m) {
    m = m === 'family' ? 'family' : 'world';
    if (m === mode) return mode;
    mode = m; BB.store.set('netmode', mode);
    if (mode === 'world') worldN = BB.clamp(BB.store.get('worldroom', 1) | 0, 1, WORLD_MAX);
    relink(); BB.emit('net:status', { status: N.status() });
    return mode;
  };
  function gather() { if (mode !== 'world') return; worldN = 1; unlink('home'); backoff = 0; connect(); }

  // ================= status =================
  const liveFriends = () => [...remotes.values()].filter((r) => !r.leaving);
  N.status = () => (link === 'open' ? (liveFriends().length ? 'together' : 'alone') : link === 'connecting' ? 'connecting' : 'offline');
  N.friends = () => liveFriends().map((r) => ({ id: r.id, type: r.look.ty, paint: r.look.pa, color: lookHex(r.look), routeNo: isBus(r.look.ty) ? r.look.no : '' }));
  // where the friends' buses are now (their latest known spot), e.g. so a start bay isn't taken twice
  N.busSpots = () => liveFriends().map((r) => { const s = r.snaps && r.snaps[r.snaps.length - 1]; return s ? { x: s.x, z: s.z } : null; }).filter(Boolean);
  // standing in the workshop (the home screen or the garage)? By its flag, or by where it is (older games send no flag)
  function inShop(s) {
    if (s.fl & 96) return true;
    const ws = BB.world && BB.world.workshop;
    return !!ws && Math.abs(s.x - ws.x) < 17 && Math.abs(s.z - ws.z) < 17;
  }
  // the friends who are out driving in the town now (not on their home screen or in the garage, not asleep, not put
  // away, heard from lately): jobs.js sends our next stops their way, so everybody ends up together
  N.driving = function () {
    const out = [], now = performance.now() / 1000;
    for (const r of remotes.values()) {
      const s = r.snaps && r.snaps[r.snaps.length - 1];
      if (!s || r.leaving || r.lost || (s.fl & 24) || inShop(s) || now - (r.heard || 0) > 12) continue;
      out.push({ x: s.x, z: s.z });
    }
    return out;
  };
  let lastStatus = '', lastFriends = '';
  function syncStatus() {
    const st = N.status();
    if (st !== lastStatus) { lastStatus = st; BB.emit('net:status', { status: st }); }
    const fr = N.friends(), key = JSON.stringify(fr);
    if (key !== lastFriends) { lastFriends = key; BB.emit('net:friends', { friends: fr }); }
  }

  // ================= always on: connect, reconnect, leave =================
  let backoff = 0, retryT = 0, lostT = 0, stopped = false;
  function connect() {
    clearTimeout(retryT); retryT = 0;
    if (T || stopped || BB.bedtime || (BB.hub && BB.hub.paused)) return;
    if (!N.canTry()) { link = 'offline'; syncStatus(); return; }      // ('online' brings us back)
    const t = T = makeTransport();
    link = 'connecting'; syncStatus();
    t.onOpen = ({ self, peers }) => {
      if (T !== t) return;
      clearTimeout(lostT); lostT = 0;
      N.self = self; members = new Set(peers); link = 'open'; backoff = 0; fullTries = 0; aloneAt = 0;
      if (mode === 'world') BB.store.set('worldroom', worldN);
      for (const id of [...remotes.keys()]) if (!members.has(id)) removeRemote(id, null, true);
      for (const r of remotes.values()) r.lost = false;
      lastKey = ''; skyAt = 0; skyHeard = performance.now(); skyWant = -1;
      sendHi(true); tick();
      clearInterval(tickT); tickT = setInterval(tick, 100);
      syncFriends();
    };
    t.onPeerJoin = (id) => { if (T !== t) return; members.add(id); if (remotes.has(id)) removeRemote(id, null, true); sendHi(true); lastKey = ''; if (N.isAuthority()) { skyAt = performance.now(); sendSky(); } };
    t.onPeerLeave = (id) => { if (T !== t) return; members.delete(id); pending.delete(id); rate.delete(id); removeRemote(id); };
    t.onMessage = (from, msg) => { if (T === t) onMsg(from, msg); };
    t.onError = (k) => {
      if (T !== t) return; T = null;
      // a full world room: straight on to the next one (round to 1 after the last)
      if (k === 'full' && mode === 'world' && ++fullTries < WORLD_MAX) { worldN = worldN >= WORLD_MAX ? 1 : worldN + 1; link = 'connecting'; setTimeout(connect, 150); return; }
      fullTries = 0; link = 'offline'; syncStatus(); retry(k === 'full' ? 60000 : 0);
    };
    t.onClose = () => { if (T !== t) return; T = null; dropped(); };
    t.connect(roomName());
  }
  // Our link dropped: friends' buses go see-through for a moment while we try again; gone quietly if we can't.
  function dropped() {
    clearInterval(tickT); tickT = 0; members = new Set(); pending.clear();
    link = 'offline';
    for (const r of remotes.values()) r.lost = true;
    clearTimeout(lostT); lostT = setTimeout(() => { lostT = 0; if (link !== 'open') clearFriends(); }, 12000);
    if (BB.world) BB.world.weatherAuto = true;
    skyWant = -1;
    syncStatus(); retry(1500);
  }
  function retry(ms) {
    clearTimeout(retryT); retryT = 0;
    if (stopped || BB.bedtime) return;
    const wait = ms || Math.min(60000, 2000 * Math.pow(2, backoff));
    backoff = Math.min(backoff + 1, 6);
    retryT = setTimeout(connect, wait * (0.8 + Math.random() * 0.4));
  }
  function clearFriends() { for (const id of [...remotes.keys()]) removeRemote(id, null, true); news.length = 0; syncFriends(); }
  // leave the room politely (a goodbye first) and forget the friends
  function unlink(why) {
    clearTimeout(retryT); clearTimeout(lostT); retryT = lostT = 0;
    clearInterval(tickT); tickT = 0;
    if (T) { const t = T; T = null; if (link === 'open') t.send({ t: 'bye', why: why === 'sleep' ? 'sleep' : 'home' }); t.close(); }
    link = 'offline'; members = new Set(); pending.clear();
    if (BB.world) BB.world.weatherAuto = true;
    skyWant = -1;
    clearFriends(); syncStatus();
  }
  function relink() { unlink('home'); backoff = 0; connect(); }
  // bedtime or the hub removing the frame: goodbye, and no reconnecting
  N.leave = function (why) { stopped = true; unlink(why); };
  N.goodnight = function () { lastKey = ''; tick(); hidePanel(); };

  // ================= friends coming and going: said at a calm moment =================
  const news = [];
  function calm() {
    if (BB.bedtime || BB.held) return false;
    const J = BB.jobs;
    if (J && ((J.busy && J.busy()) || J.teaching || J.phase === 'question' || J.phase === 'stop' || J.phase === 'tow')) return false;
    return !(BB.ui && BB.ui.titleShown && BB.ui.titleShown());
  }
  function addNews(item) {
    if (item.kind === 'bye') {                             // came and went before we said hello: say nothing
      const i = news.findIndex((n) => n.kind === 'hi' && n.id === item.id && n.no === item.no && n.ty === item.ty);
      if (i >= 0) { news.splice(i, 1); return; }
    }
    news.push(item); if (news.length > 12) news.shift();
  }
  let newsAt = -1e9;
  function flushNews() {
    if (!news.length || !calm()) return;
    if (mode === 'world') {
      // public rooms change often: one short line at most every 30 s (what came meanwhile is dropped)
      const now = performance.now();
      if (now - newsAt < 30000) { news.length = 0; return; }
      newsAt = now;
      const hi = news.filter((n) => n.kind === 'hi'), bye = news.filter((n) => n.kind === 'bye');
      news.length = 0;
      if (hi.length) { BB.sfx.sparkle(); BB.say(hi.length > 1 ? 'Friends are here!' : `A friend's ${hi[0].ty && !isBus(hi[0].ty) ? RIDE_NAME[hi[0].ty] : 'bus'} is here!`, { queue: true }); }
      else if (bye.length) BB.say(`Bye bye, ${sayRide(bye[0])}!`, { queue: true });
      return;
    }
    const hi = news.filter((n) => n.kind === 'hi'), bye = news.filter((n) => n.kind === 'bye');
    news.length = 0;
    if (hi.length) {
      BB.sfx.sparkle();
      const nos = hi.map((n, i) => sayRide(n, !i));
      if (hi.length > 3) BB.say(`${hi.length} friends are here!`, { queue: true });
      else if (hi.length === 1) BB.say(`${nos[0]} is here!`, { queue: true });
      else BB.say(`${nos.slice(0, -1).join(', ')} and ${nos[nos.length - 1]} are here!`, { queue: true });
    }
    for (const n of bye.slice(0, 3)) BB.say(n.sleep ? `Goodnight, ${sayRide(n)}!` : `Bye bye, ${sayRide(n)}!`, { queue: true });
  }

  // ================= friends' buses (low detail) =================
  const MAXB = 12;                                        // atlas slots (9 friends need 9)
  let shared = null;
  function paintHex(id) { return (BB.PAINTS.find((p) => p.id === id) || BB.PAINTS[0]).color; }
  const darkHex = (c, t) => (BB.ui && BB.ui.darkHex ? BB.ui.darkHex(c, t) : c);
  function dimsOf(type) {
    if (BB.fleet && BB.fleet.dims) { try { return BB.fleet.dims(type); } catch (e) { /* fall back */ } }
    return { type: 'bendy', LF: 7.4, LR: 6, GAP: 1, axlesF: [1.7, -1.9], axlesR: [-1.2], doorsF: [3.0], doorsR: [1.4], deck: 1, roof: 3.56, tyre: 0.52, wheelX: 1.08, width: 2.5 };
  }
  function buildShared() {
    if (shared) return shared;
    const scene = BB.scene;
    // all friends' wheels: one instanced mesh (tyre, hub and a bar that shows them turning)
    const wb = BB.mk.builder();
    wb.add(new THREE.CylinderGeometry(0.52, 0.52, 0.36, 12), '#3a343f', 0, 0, 0, 0, 0, Math.PI / 2);
    wb.add(new THREE.CylinderGeometry(0.28, 0.28, 0.38, 10), '#c9d2db', 0, 0, 0, 0, 0, Math.PI / 2);
    wb.add(new THREE.BoxGeometry(0.4, 0.46, 0.1), '#8a8290', 0, 0, 0);
    const wheels = new THREE.InstancedMesh(wb.geometry(), BB.mk.mat, 9 * 8);
    wheels.name = 'friendWheels'; wheels.count = 0; wheels.frustumCulled = false; wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(wheels);
    // all friends' blob shadows (one per carriage)
    const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: BB.mk.blobTex, transparent: true, depthWrite: false }), 9 * 2);
    shadows.name = 'friendShadows'; shadows.count = 0; shadows.frustumCulled = false; shadows.renderOrder = 1; shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(shadows);
    // all floating route-number badges: one instanced quad, each instance picks its slot in a 4x3 atlas
    const atlas = document.createElement('canvas'); atlas.width = 512; atlas.height = 192;
    const tex = new THREE.CanvasTexture(atlas);
    const slotAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAXB), 1); slotAttr.setUsage(THREE.DynamicDrawUsage);
    const bg = new THREE.PlaneGeometry(1, 0.5); bg.setAttribute('aSlot', slotAttr);
    const bmat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    bmat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSlot;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvUv = (vUv + vec2(mod(aSlot, 4.0), 2.0 - floor(aSlot / 4.0))) / vec2(4.0, 3.0);');
    };
    const badges = new THREE.InstancedMesh(bg, bmat, MAXB);
    badges.name = 'friendBadges'; badges.count = 0; badges.frustumCulled = false; badges.renderOrder = 3; badges.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(badges);
    shared = { wheels, shadows, badges, atlas, tex, slotAttr };
    return shared;
  }
  function drawBadge(r) {
    const s = buildShared(), x = s.atlas.getContext('2d'), col = lookHex(r.look);
    const ox = (r.slot % 4) * 128, oy = Math.floor(r.slot / 4) * 64;
    x.clearRect(ox, oy, 128, 64);
    const rr = (X, Y, W, H, R, f) => { x.beginPath(); x.roundRect ? x.roundRect(X, Y, W, H, R) : x.rect(X, Y, W, H); x.fillStyle = f; x.fill(); };
    rr(ox + 4, oy + 4, 120, 56, 18, darkHex(col, 0.25));
    rr(ox + 4, oy + 3, 117, 53, 17, col);
    if (!isBus(r.look.ty)) {                              // another ride: its little picture instead of a number
      rr(ox + 13, oy + 11, 100, 38, 10, '#fff6e0');
      x.save(); x.translate(ox + 36, oy + 10); x.scale(0.6, 0.6); sideRide(x, 0, 0, 1, col, r.look.ty); x.restore();
      s.tex.needsUpdate = true; return;
    }
    rr(ox + 13, oy + 11, 100, 38, 10, '#2b2430');
    x.fillStyle = '#ffb81f'; x.font = '800 32px "Courier New", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(r.look.no, ox + 63, oy + 31);
    s.tex.needsUpdate = true;
  }
  // One merged mesh per friend: body, windows (glow a little at night) and lamps, each part flagged with how much it
  // bends (0 front carriage, 0.5 the joint, 1 the rear carriage) about the hitch.
  function buildBody(r) {
    const D = r.dims = dimsOf(r.look.ty), col = lookHex(r.look), deep = darkHex(col, 0.22);
    const parts = [];
    const kit = (bend, glow) => { const b = BB.mk.builder(); parts.push({ b, bend, glow }); return b; };
    const GLASS = '#a9d4e6', TOP = D.roof;
    function carriage(bend, L, zc, front, back, doors, axles) {
      const b = kit(bend, 0), w = kit(bend, 0.35), l = kit(bend, 1);
      b.box(2.5, TOP - 0.1 - 0.36, L, col, 0, 0.36, zc);
      b.box(2.36, 0.12, L - 0.3, '#fff6e0', 0, TOP - 0.12, zc);
      b.box(2.54, 0.24, L - 0.1, deep, 0, 0.34, zc);                               // a deeper skirt
      for (const az of axles) b.box(2.56, 0.5, 1.3, '#3f3744', 0, 0.3, zc + az);    // wheel arches
      const bands = D.deck === 2 ? [[1.45, 2.6], [3.35, 4.4]] : [[1.45, 2.75]];
      const wl = L - (front ? 1.9 : 0.7) - (back ? 0.5 : 0.2), wz = zc - (front ? 0.55 : 0) + (back ? 0.15 : 0);
      for (const [y0, y1] of bands) w.box(2.54, y1 - y0, wl, GLASS, 0, y0, wz);
      for (const dz of doors) w.box(0.06, 2.0, 1.1, '#6f8fa8', 1.26, 0.6, zc + dz);
      if (front) {
        w.box(2.3, 1.6, 0.06, GLASS, 0, 1.15, zc + L / 2);
        b.box(1.5, 0.32, 0.08, '#2b2430', 0, TOP - 0.6, zc + L / 2 + 0.01);
        for (const sx of [-0.82, 0.82]) l.box(0.42, 0.2, 0.08, '#fff3c4', sx, 0.55, zc + L / 2 + 0.01);
      }
      if (back) for (const sx of [-0.95, 0.95]) l.box(0.3, 0.42, 0.08, '#ff5a4a', sx, 0.7, zc - L / 2 - 0.05);
    }
    // The other rides: a few boxes each, in the shapes and colours a child knows them by (one mesh, like the buses).
    // glow 2 / 3 = the two halves of a siren's light bar (they flash in turn while the friend's siren is on).
    function ride(ty) {
      const b = kit(0, 0), w = kit(0, 0.35), l = kit(0, 1), s1 = kit(0, 2), s2 = kit(0, 3);
      const L = D.LF, Wd = D.width, hw = Wd / 2, zf = L / 2, zb = -L / 2, CREAM = '#fff6e0', DARK = '#3f3744';
      for (const az of D.axlesF) b.box(Wd + 0.06, D.tyre + 0.12, D.tyre * 2 + 0.3, DARK, 0, 0.28, az);          // wheel arches
      for (const sx of [-1, 1]) {
        l.box(0.36, 0.2, 0.08, '#fff3c4', sx * (hw - 0.34), ty === 'taxi' ? 0.68 : 0.9, zf + 0.01);
        l.box(0.26, 0.3, 0.08, '#ff5a4a', sx * (hw - 0.3), 0.7, zb - 0.02);
      }
      if (ty === 'taxi') {
        b.box(Wd + 0.04, 0.22, L - 0.1, deep, 0, 0.3, 0);
        b.box(Wd, 0.56, L, col, 0, 0.5, 0);                                         // hood, doors and boot
        b.box(Wd + 0.03, 0.09, L - 0.3, '#26232b', 0, 0.76, 0);                     // the dark band
        b.box(Wd - 0.1, 1.1, 3.0, col, 0, 1.05, -0.35);                             // the tall cabin
        w.box(Wd - 0.06, 0.72, 2.5, GLASS, 0, 1.24, -0.35);
        w.box(Wd - 0.3, 0.72, 0.06, GLASS, 0, 1.24, 1.16); w.box(Wd - 0.3, 0.6, 0.06, GLASS, 0, 1.3, -1.86);
        w.box(0.8, 0.28, 0.36, '#fff3c4', 0, 2.15, -0.35);                          // the lit roof sign
        b.box(0.9, 0.06, 0.44, '#26232b', 0, 2.13, -0.35);
      } else if (ty === 'fire') {
        const cab0 = 0.85;
        b.box(Wd + 0.04, 0.56, L, '#8f8a96', 0, 0.3, 0);
        b.box(Wd, 1.85, zf - cab0, col, 0, 0.85, (zf + cab0) / 2);                  // the crew cab
        w.box(Wd + 0.04, 1.0, zf - cab0 - 0.6, GLASS, 0, 1.5, (zf + cab0) / 2 - 0.05);
        w.box(Wd - 0.2, 1.05, 0.06, GLASS, 0, 1.47, zf + 0.01);
        b.box(Wd, 1.6, cab0 - 0.05 - zb, col, 0, 0.85, (zb + cab0 - 0.05) / 2);     // the equipment body
        for (let i = 0; i < 3; i++) b.box(Wd + 0.05, 1.2, 1.35, '#d5d9e0', 0, 1.0, cab0 - 0.3 - i * 1.55 - 0.675);   // silver lockers
        b.box(Wd + 0.07, 0.09, L - 0.2, '#fff3e0', 0, 0.88, 0);                     // the white stripe
        b.box(Wd - 0.2, 0.16, 0.5, CREAM, 0, 2.7, zf - 0.45);                       // the light bar
        s1.box(0.6, 0.2, 0.4, '#ff4a3a', -0.6, 2.72, zf - 0.45); s2.box(0.6, 0.2, 0.4, '#ff4a3a', 0.6, 2.72, zf - 0.45);
        b.cyl(0.5, 0.55, 0.3, 8, '#5a5260', 0, 2.45, -3.0);                         // the ladder: turntable, rails, rungs
        for (const sx of [-1, 1]) b.box(0.09, 0.18, 6.6, '#dfe3ea', sx * 0.42, 2.92, 0.1);
        for (let i = 0; i < 9; i++) b.box(0.8, 0.06, 0.08, '#aab2bf', 0, 2.98, -3.0 + i * 0.77);
        b.box(1.3, 0.8, 0.44, '#ffd45c', 0, 1.35, zb - 0.2);                        // the hose reel
      } else if (ty === 'ambulance') {
        const cabEnd = 1.55, bz = (zb + cabEnd) / 2, bl = cabEnd - zb;
        b.box(Wd + 0.04, 0.3, L, '#a9a6ae', 0, 0.3, 0);
        b.box(Wd, 0.56, zf - 2.3, col, 0, 0.58, (zf + 2.3) / 2);                    // hood
        b.box(Wd, 1.72, 2.36 - cabEnd, col, 0, 0.58, (2.36 + cabEnd) / 2);          // cab
        w.box(Wd + 0.04, 0.85, 0.6, GLASS, 0, 1.28, 1.98); w.box(Wd - 0.2, 0.85, 0.06, GLASS, 0, 1.28, 2.37);
        b.box(Wd + 0.04, 2.2, bl, col, 0, 0.58, bz);                                // the tall box body
        b.box(Wd + 0.07, 0.2, bl - 0.2, '#4fa3e0', 0, 1.0, bz); b.box(Wd + 0.07, 0.07, bl - 0.2, '#ff6b5c', 0, 1.24, bz);
        // a heart on both sides (never a red cross): a turned square and two round tops, right through the body
        const hy = 1.98, hz = -1.5, PINK = '#ff6b5c', hx = Wd + 0.1;
        b.add(new THREE.BoxGeometry(hx, 0.5, 0.5), PINK, 0, hy, hz, 0, Math.PI / 4, 0);
        for (const sz of [-1, 1]) b.add(new THREE.CylinderGeometry(0.25, 0.25, hx, 10), PINK, 0, hy + 0.177, hz + sz * 0.177, 0, 0, Math.PI / 2);
        w.box(0.9, 0.5, 0.06, GLASS, 0, 1.75, zb - 0.01);
        s1.box(0.5, 0.18, 0.3, '#4fa3ff', -0.6, 2.78, 1.2); s2.box(0.5, 0.18, 0.3, '#ff4a3a', 0.6, 2.78, 1.2);
      } else if (ty === 'icecream') {
        const cab = 1.9, bz = (zb + cab) / 2, bl = cab - zb;
        b.box(Wd + 0.04, 0.26, L, deep, 0, 0.3, 0);
        b.box(Wd, 0.62, zf - cab, col, 0, 0.55, (zf + cab) / 2);                    // hood
        b.box(Wd, 2.2, bl, col, 0, 0.55, bz);                                       // the tall body
        b.box(Wd + 0.1, 0.16, bl + 0.2, CREAM, 0, 2.75, bz);                        // a cream roof
        w.box(Wd - 0.2, 0.9, 0.06, GLASS, 0, 1.5, cab + 0.01); w.box(Wd + 0.04, 0.85, 0.9, GLASS, 0, 1.5, 1.3);
        w.box(0.06, 0.95, 1.9, '#6f8fa8', hw + 0.01, 1.35, -0.9);                   // the serving hatch (kerb side)
        b.box(0.6, 0.1, 2.1, CREAM, hw + 0.28, 2.32, -0.9, 0, 0, -0.25);            // its awning
        b.box(Wd + 0.05, 0.2, bl - 0.3, CREAM, 0, 0.85, bz);
        b.cyl(0.42, 0.06, 0.7, 8, '#e0a85a', 0, 2.91, -0.6);                        // the big cone on the roof
        b.ball(0.46, CREAM, 0, 3.75, -0.6, 1); b.ball(0.12, '#e8463a', 0, 4.25, -0.6);
      } else {                                                                       // tow truck
        const cab0 = 0.8, cab1 = 2.3, DK = '#3a343f';
        b.box(Wd + 0.04, 0.5, L, '#4a4250', 0, 0.3, 0);
        b.box(Wd, 0.7, zf - cab1, col, 0, 0.8, (zf + cab1) / 2);                    // hood
        b.box(Wd, 1.9, cab1 - cab0, col, 0, 0.8, (cab0 + cab1) / 2);                // cab
        w.box(Wd + 0.04, 0.8, 1.0, GLASS, 0, 1.65, (cab0 + cab1) / 2); w.box(Wd - 0.2, 0.8, 0.06, GLASS, 0, 1.65, cab1 + 0.01);
        w.box(0.9, 0.2, 0.34, '#ff9d2e', 0, 2.7, 1.55);                             // an amber lamp
        b.box(Wd, 0.36, cab0 - zb, '#5a5260', 0, 0.8, (zb + cab0) / 2);             // the flat bed and its sides
        for (const sx of [-1, 1]) b.box(0.14, 0.34, cab0 - zb, col, sx * (hw - 0.07), 1.16, (zb + cab0) / 2);
        b.box(0.6, 1.5, 0.6, col, 0, 1.16, 0.2);                                    // the boom: post, arm, cable, hook
        b.add(new THREE.BoxGeometry(0.34, 0.34, 3.7), DK, 0, 2.35, -1.5, 0, 0.42, 0);
        b.box(0.08, 1.2, 0.08, DK, 0, 1.85, -3.15); b.box(0.36, 0.16, 0.16, '#d5d9e0', 0, 1.7, -3.15);
        for (let i = 0; i < 4; i++) b.box(0.5, 0.3, 0.08, i % 2 ? '#2b2430' : '#ffd45c', -0.75 + i * 0.5, 0.82, zb - 0.02);   // stripes on the tail
      }
    }
    const art = D.LR > 0, rideTy = isBus(r.look.ty) ? null : r.look.ty;
    r.hitch = art ? -(D.LF / 2 + D.GAP / 2) : 0;
    if (rideTy) ride(rideTy);
    else carriage(0, D.LF, 0, true, !art, D.doorsF, D.axlesF);
    if (art) {
      const zr = -(D.LF / 2 + D.GAP + D.LR / 2);
      kit(0.5, 0).box(2.3, TOP - 0.8, D.GAP + 0.3, '#5a5260', 0, 0.45, r.hitch);
      carriage(1, D.LR, zr, false, true, D.doorsR, D.axlesR);
    }
    const gs = parts.filter((p) => p.b.parts.length).map((p) => ({ g: p.b.geometry(), bend: p.bend, glow: p.glow }));
    let n = 0; for (const p of gs) n += p.g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), colA = new Float32Array(n * 3), bend = new Float32Array(n), glow = new Float32Array(n);
    let o = 0;
    for (const p of gs) {
      const c = p.g.attributes.position.count;
      pos.set(p.g.attributes.position.array, o * 3); nor.set(p.g.attributes.normal.array, o * 3); colA.set(p.g.attributes.color.array, o * 3);
      bend.fill(p.bend, o, o + c); glow.fill(p.glow, o, o + c); o += c; p.g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colA, 3)); geo.setAttribute('aBend', new THREE.BufferAttribute(bend, 1));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    geo.computeBoundingSphere(); geo.boundingSphere.radius += art ? D.LR : 0;
    const u = r.u = { uBend: { value: 0 }, uHitch: { value: r.hitch }, uLamp: { value: 0 }, uNight: { value: 0 }, uSirA: { value: 0 }, uSirB: { value: 0 } };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aBend;\nattribute float aGlow;\nuniform float uBend;\nuniform float uHitch;\nvarying float vGlow;\n'
          + 'vec3 bendV(vec3 v) { float a = uBend * aBend; float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }')
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = bendV(vec3( normal ));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif')
        .replace('#include <begin_vertex>', 'vec3 transformed = bendV(position - vec3(0.0, 0.0, uHitch)) + vec3(0.0, 0.0, uHitch);\nvGlow = aGlow;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLamp;\nuniform float uNight;\nuniform float uSirA;\nuniform float uSirB;\nvarying float vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * (vGlow > 2.5 ? uSirB : vGlow > 1.5 ? uSirA : vGlow > 0.9 ? uLamp : vGlow * uNight);');
    };
    r.mat = mat; r.mesh = new THREE.Mesh(geo, mat); r.mesh.name = 'friend:' + r.id; r.mesh.visible = false;
    BB.scene.add(r.mesh);
  }
  function disposeBody(r) { if (r.mesh) { BB.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mat.dispose(); r.mesh = null; } }
  function freeSlot() { const used = new Set([...remotes.values()].map((r) => r.slot)); for (let i = 0; i < MAXB; i++) if (!used.has(i)) return i; return 0; }
  function upsertRemote(id, look) {
    let r = remotes.get(id);
    if (r && r.leaving) { removeRemote(id, null, true); r = null; }
    if (r && JSON.stringify(r.look) === JSON.stringify(look)) return;
    const fresh = !r;
    if (fresh) {
      if (remotes.size >= N.MAX - 1) return;
      r = { id, look, snaps: [], alpha: 0, spin: 0, gy: 0, flash: 0, byeWhy: null, leaving: false, lost: false, slot: freeSlot(), pose: null, born: performance.now() / 1000 };
      remotes.set(id, r);
    } else disposeBody(r);
    r.look = look; buildShared(); buildBody(r); drawBadge(r);
    if (pending.has(id)) { pushSnap(r, pending.get(id)); pending.delete(id); }
    syncFriends();
    const lk = JSON.stringify(look), back = recent.get(lk) > performance.now() - 120000;
    if (fresh && !BB.bedtime && !back) addNews({ kind: 'hi', id, no: look.no, ty: look.ty });
  }
  function removeRemote(id, why, now) {
    const r = remotes.get(id); if (!r) return;
    if (now) { recent.set(JSON.stringify(r.look), performance.now()); disposeBody(r); remotes.delete(id); syncFriends(); return; }
    if (r.leaving) return;
    r.leaving = true;
    recent.set(JSON.stringify(r.look), performance.now());
    setTimeout(() => { if (remotes.get(id) === r) { disposeBody(r); remotes.delete(id); syncFriends(); } }, 3000);   // (no frames drawn meanwhile)
    if (!BB.bedtime && link === 'open' && r.byeWhy) addNews({ kind: 'bye', id, no: r.look.no, ty: r.look.ty, sleep: r.byeWhy === 'sleep' });
    syncFriends();
  }
  const recent = new Map();              // looks of buses that left lately (a dropped link that comes back isn't news)
  function pushSnap(r, s) {
    s.t = performance.now() / 1000;
    r.snaps.push(s); if (r.snaps.length > 40) r.snaps.splice(0, r.snaps.length - 40);
    r.heard = s.t;
  }
  const DELAY = 0.2;                     // seconds behind: room for the 10 Hz updates to arrive
  function sample(r, t) {
    const s = r.snaps; if (!s.length) return null;
    while (s.length > 2 && s[1].t <= t) s.shift();
    const a = s[0], b = s[1], o = r.cur || (r.cur = { x: 0, z: 0, h: 0, hr: 0, sp: 0, st: 0, fl: 0, jump: false });
    o.jump = false;
    if (!b || t <= a.t) {
      if (t <= a.t || a.sp === 0) return a;
      const k = Math.min(0.25, t - a.t) * a.sp, f = Math.sin(a.h), g = Math.cos(a.h);   // a moment of dead reckoning
      o.x = a.x + f * k; o.z = a.z + g * k; o.h = a.h; o.hr = a.hr; o.sp = a.sp; o.st = a.st; o.fl = a.fl;
      return o;
    }
    // a jump (Drive: from the workshop to a start bay; Home; a tow): no sliding across the town in between
    if (Math.abs(b.x - a.x) + Math.abs(b.z - a.z) > 25) { o.x = b.x; o.z = b.z; o.h = b.h; o.hr = b.hr; o.sp = 0; o.st = 0; o.fl = b.fl; o.jump = true; return o; }
    const k = BB.clamp((t - a.t) / Math.max(0.001, b.t - a.t), 0, 1);
    o.x = a.x + (b.x - a.x) * k; o.z = a.z + (b.z - a.z) * k; o.h = a.h + wrapA(b.h - a.h) * k; o.hr = a.hr + wrapA(b.hr - a.hr) * k;
    o.sp = a.sp + (b.sp - a.sp) * k; o.st = a.st + (b.st - a.st) * k; o.fl = b.fl;
    return o;
  }

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  N.update = function (dt) {
    updatePuffs(dt); followSky(dt);
    if (!remotes.size) { if (shared && (shared.wheels.count || shared.badges.count || shared.shadows.count)) shared.wheels.count = shared.badges.count = shared.shadows.count = 0; return; }
    const S = buildShared(), B = BB.bus, W = BB.world, now = performance.now() / 1000;
    const night = W.night ? W.night() : 0;
    const mx = B.front ? (B.front.position.x + B.rear.position.x) / 2 : 0, mz = B.front ? (B.front.position.z + B.rear.position.z) / 2 : 0;
    const atStop = !!(B.atStop || (B.isSettling && B.isSettling()));
    const bay = B.target && W.bayOf ? W.bayOf(B.target) : null;
    const cam = BB.camera ? BB.camera.position : null;
    const inYard = !!(W.inDepotYard && W.inDepotYard(mx, mz));
    let wi = 0, si = 0, bi = 0;
    for (const r of [...remotes.values()]) {
      const p = sample(r, now - DELAY);
      if (!p || !r.mesh) { if (r.leaving) { disposeBody(r); remotes.delete(r.id); } continue; }
      const D = r.dims, art = D.LR > 0, h = p.h, hr = art ? p.hr : p.h;
      const fx = Math.sin(h), fz = Math.cos(h), rx = Math.sin(hr), rz = Math.cos(hr);
      const hx = p.x - fx * (D.LF / 2 + D.GAP / 2), hz = p.z - fz * (D.LF / 2 + D.GAP / 2);
      const rcx = hx - rx * (D.GAP / 2 + D.LR / 2), rcz = hz - rz * (D.GAP / 2 + D.LR / 2);
      const cx = art ? (p.x + rcx) / 2 : p.x, cz = art ? (p.z + rcz) / 2 : p.z;
      // gentle: see-through when close to our bus, at our stop, or in the garage; fades in and out
      const d = hypot2(cx - mx, cz - mz);
      let a = 1;
      // a friend on their home screen or in their garage stands in the workshop, right where our own ride stands on
      // ours: never drawn there (nor one that just jumped: it fades in again at its new place)
      const away = inShop(p) || p.jump;
      if (away) { a = 0; r.alpha = 0; }
      else if (BB.depot && BB.depot.isOpen) { if (d < 26) a = 0; }
      else {
        if (d < 13) a = 0.35;
        if (inYard && d < 7.5) a = 0;                       // two rides parked in the same start bay: only ours shows
        if (atStop && d < 26) a = Math.min(a, 0.25);
        if (bay && hypot2(cx - bay.x, cz - bay.z) < 16 && hypot2(mx - bay.x, mz - bay.z) < 50) a = Math.min(a, 0.3);
      }
      // nothing big right in front of the camera: fade a friend's bus near the camera or on the line to our bus
      if (cam) {
        const vx = mx - cam.x, vz = mz - cam.z, wx = cx - cam.x, wz = cz - cam.z, L2 = vx * vx + vz * vz || 1;
        const k = BB.clamp((wx * vx + wz * vz) / L2, 0, 1), off = hypot2(wx - vx * k, wz - vz * k), dc = hypot2(wx, wz);
        if (k < 0.95 && off < 4.5) a = Math.min(a, 0.2);
        if (dc < 16) a = Math.min(a, BB.clamp((dc - 7) / 9, 0, 1) * 0.4);
      }
      if (r.lost) a *= 0.45;
      if (r.leaving) a = 0;
      r.alpha += BB.clamp(a - r.alpha, -dt * 1.6, dt * 1.6);
      if (r.leaving && r.alpha <= 0.01) { disposeBody(r); remotes.delete(r.id); syncFriends(); continue; }
      const vis = r.alpha > 0.02;
      r.mesh.visible = vis;
      if (!vis) continue;
      const tr = r.alpha < 0.99;
      if (r.mat.transparent !== tr) { r.mat.transparent = tr; r.mat.depthWrite = !tr; r.mat.needsUpdate = true; }
      r.mat.opacity = r.alpha;
      r.gy += ((W.groundY ? W.groundY(p.x, p.z) : 0) - r.gy) * Math.min(1, dt * 8);
      r.mesh.position.set(p.x, r.gy, p.z); r.mesh.rotation.y = h;
      r.u.uBend.value = art ? wrapA(hr - h) : 0;
      const parked = (p.fl & 16) !== 0, asleep = (p.fl & 8) !== 0, lights = (p.fl & 2) !== 0;
      r.flash = Math.max(0, r.flash - dt);
      const blink = r.flash > 0 ? (Math.floor(r.flash * 8) % 2 ? 1.2 : 0) : null;
      r.u.uLamp.value = blink != null ? blink : lights ? 0.2 + 0.8 * night : 0;
      r.u.uNight.value = asleep ? 0 : night * 0.7;
      const sir = (p.fl & 128) !== 0 && !asleep ? (Math.floor(now * 4) % 2 ? 1 : 2) : 0;
      r.u.uSirA.value = sir === 1 ? 1.5 : 0.1 * night; r.u.uSirB.value = sir === 2 ? 1.5 : 0.1 * night;
      const sp = parked ? 0 : p.sp;
      r.spin += sp * dt / D.tyre;
      // wheels
      if (r.alpha > 0.3) {
        const wk = D.tyre / 0.52;                           // (the shared wheel is a bus's: smaller on a taxi)
        const wheel = (ccx, ccz, yaw, ox, oz, steer) => {
          if (wi >= 72) return;
          const c = Math.cos(yaw), s = Math.sin(yaw);
          _p.set(ccx + ox * c + oz * s, r.gy + D.tyre, ccz - ox * s + oz * c);
          _e.set(r.spin, yaw + steer, 0); _q.setFromEuler(_e);
          S.wheels.setMatrixAt(wi++, _m.compose(_p, _q, _s.set(1, wk, wk)));
        };
        const front = Math.max(...D.axlesF);
        for (const az of D.axlesF) for (const sx of [-1, 1]) wheel(p.x, p.z, h, sx * (D.wheelX + 0.04), az, az === front ? p.st * 0.8 : 0);
        if (art) for (const az of D.axlesR) for (const sx of [-1, 1]) wheel(rcx, rcz, hr, sx * (D.wheelX + 0.04), az, 0);
        // shadows
        const shadow = (x, z, yaw, L) => { if (si >= 18) return; _e.set(-Math.PI / 2, yaw, 0); _q.setFromEuler(_e); S.shadows.setMatrixAt(si++, _m.compose(_p.set(x, r.gy + 0.08, z), _q, _s.set((D.width || 2.5) + 1.1, L + 1.6, 1))); };
        shadow(p.x, p.z, h, D.LF); if (art) shadow(rcx, rcz, hr, D.LR);
      }
      // the floating route-number badge over the front carriage (bigger further away, so it stays readable)
      if (r.alpha > 0.3 && BB.camera && bi < MAXB) {
        const bx = p.x, by = r.gy + D.roof + 1.4, bz = p.z;
        const dist = BB.camera.position.distanceTo(_p.set(bx, by, bz));
        const k = BB.clamp(dist / 14, 1.3, 3.2);
        S.badges.setMatrixAt(bi, _m.compose(_p, BB.camera.quaternion, _s.set(k * 1.6, k * 1.6, 1)));
        S.slotAttr.array[bi] = r.slot; bi++;
      }
      r.pose = { x: p.x, z: p.z, cx, cz, y: r.gy + D.roof };
    }
    S.wheels.count = wi; S.shadows.count = si; S.badges.count = bi;
    if (wi) S.wheels.instanceMatrix.needsUpdate = true;
    if (si) S.shadows.instanceMatrix.needsUpdate = true;
    if (bi) { S.badges.instanceMatrix.needsUpdate = true; S.slotAttr.needsUpdate = true; }
  };

  // ================= honks and waves =================
  let honkAt = 0, waveAt = 0;
  function myMid() { const B = BB.bus; return B.front ? { x: (B.front.position.x + B.rear.position.x) / 2, z: (B.front.position.z + B.rear.position.z) / 2 } : { x: 0, z: 0 }; }
  function friendHonk(r, tune) {
    if (!r.pose || r.leaving) return;
    const m = myMid(), d = hypot2(r.pose.cx - m.x, r.pose.cz - m.z);
    BB.sfx.horn(tune, BB.clamp(1 - d / 160, 0.2, 0.7));
    puff('note', r.pose.x, r.pose.y + 0.6, r.pose.z);
    // a friend honked close by: our bus waves back (flashes its lights), and they see it
    const now = performance.now();
    if (d < 45 && !BB.bedtime && now - waveAt > 2500) {
      waveAt = now;
      BB.later(450, () => { if (link !== 'open' || BB.bedtime) return; flashMine(); send({ t: 'wave' }); });
    }
  }
  function friendWave(r) { if (!r.pose || r.leaving) return; r.flash = 1.3; puff('heart', r.pose.x, r.pose.y + 0.6, r.pose.z); }
  function flashMine() {
    const B = BB.bus, was = B.lightsOn;
    const p = myMid(); puff('heart', p.x, (B.front ? B.front.position.y : 0) + 4.4, p.z);
    for (let i = 0; i < 6; i++) BB.later(i * 160, () => { if (!BB.bedtime) B.setLights(i % 2 === 1 ? was : !was); });
    BB.later(6 * 160, () => { if (!BB.bedtime) B.setLights(was); });
  }
  // little floating pictures (a music note for a honk, a heart for a wave)
  const puffs = [], puffTex = {};
  function puffPic(kind) {
    if (puffTex[kind]) return puffTex[kind];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); x.scale(0.64, 0.64);
    if (kind === 'note') {
      x.fillStyle = '#d98700'; x.beginPath(); x.ellipse(36, 74, 15, 11, -0.4, 0, Math.PI * 2); x.fill(); x.fillRect(46, 18, 7, 56);
      x.beginPath(); x.moveTo(46, 18); x.quadraticCurveTo(70, 20, 78, 42); x.quadraticCurveTo(66, 32, 53, 34); x.fill();
      x.fillStyle = '#ffb81f'; x.beginPath(); x.ellipse(33, 71, 15, 11, -0.4, 0, Math.PI * 2); x.fill(); x.fillRect(43, 15, 7, 56);
    } else { pathHeart(x, 50, 52, 1.05, '#c9433a'); pathHeart(x, 47, 48, 1.0, '#ef5a4b'); }
    return (puffTex[kind] = new THREE.CanvasTexture(c));
  }
  function pathHeart(x, cx, cy, s, f) {
    x.beginPath(); x.moveTo(cx, cy + 30 * s);
    x.bezierCurveTo(cx - 44 * s, cy + 2 * s, cx - 30 * s, cy - 34 * s, cx, cy - 14 * s);
    x.bezierCurveTo(cx + 30 * s, cy - 34 * s, cx + 44 * s, cy + 2 * s, cx, cy + 30 * s); x.fillStyle = f; x.fill();
  }
  function puff(kind, x, y, z) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffPic(kind), transparent: true, depthWrite: false, fog: false }));
    sp.position.set(x, y, z); sp.scale.setScalar(1.8); sp.renderOrder = 4; sp.userData.t = 0;
    BB.scene.add(sp); puffs.push(sp);
  }
  function updatePuffs(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const sp = puffs[i]; sp.userData.t += dt;
      const t = sp.userData.t;
      sp.position.y += dt * 1.6; sp.position.x += Math.sin(t * 6) * dt * 0.6;
      sp.material.opacity = BB.clamp(1.6 - t, 0, 1);
      sp.scale.setScalar(1.8 + Math.min(0.6, t));
      if (t > 1.6) { BB.scene.remove(sp); sp.material.dispose(); puffs.splice(i, 1); }
    }
  }

  // ================= pictures (paper-cut: flat shapes, a darker crescent lower right) =================
  const picCache = {};
  function shaded(x, build, f) {
    if (BB.paper) { BB.paper(x, build, f); return; }                 // the shared kit: crescent and rim
    const p = new Path2D(); build(p);
    x.fillStyle = darkHex(f, 0.2); x.fill(p);
    x.save(); x.clip(p); x.translate(-4, -5); x.fillStyle = f; x.fill(p); x.restore();
  }
  const rrP = (p, X, Y, W, H, R) => { if (p.roundRect) p.roundRect(X, Y, W, H, R); else p.rect(X, Y, W, H); };
  const circ = (x, X, Y, R, f) => { x.beginPath(); x.arc(X, Y, R, 0, Math.PI * 2); x.fillStyle = f; x.fill(); };
  function starP(p, cx, cy, R, r, n = 5) { for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, rad = i % 2 ? r : R; if (i) p.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); else p.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } p.closePath(); }
  function heartP(p, cx, cy, s) { p.moveTo(cx, cy + 30 * s); p.bezierCurveTo(cx - 44 * s, cy + 2 * s, cx - 30 * s, cy - 34 * s, cx, cy - 14 * s); p.bezierCurveTo(cx + 30 * s, cy - 34 * s, cx + 44 * s, cy + 2 * s, cx, cy + 30 * s); }
  function sideBus(x, ox, oy, s, col, type) {   // a little side view of a bus (facing right) at (ox, oy), width ~ 84*s
    x.save(); x.translate(ox, oy); x.scale(s, s);
    const dbl = type === 'double', bendy = type === 'bendy', top = dbl ? -6 : 14;
    const body = (bx, bw) => shaded(x, (p) => rrP(p, bx, top, bw, 60 - top, 9), col);
    if (bendy) { body(0, 46); body(50, 38); x.fillStyle = '#5a5260'; x.fillRect(45, top + 6, 6, 60 - top - 12); } else body(0, 86);
    x.fillStyle = '#bfe6f5';
    for (const ry of dbl ? [top + 7, top + 31] : [top + 8]) for (let wx = 6; wx < 72; wx += 15) if (!(bendy && wx > 38 && wx < 52)) { x.beginPath(); rrP(x, wx, ry, 11, 13, 3); x.fill(); }
    x.beginPath(); rrP(x, 74, top + 6, 9, 22, 3); x.fill();
    for (const wx of bendy ? [16, 36, 74] : [18, 68]) { circ(x, wx, 62, 9, '#3a343f'); circ(x, wx, 62, 4, '#c9d2db'); }
    x.restore();
  }
  // the same for the other rides (taxi, fire engine, ambulance, ice cream van, tow truck), same size and place
  function sideRide(x, ox, oy, s, col, type) {
    x.save(); x.translate(ox, oy); x.scale(s, s);
    const part = (X, Y, W, H, R, f) => shaded(x, (p) => rrP(p, X, Y, W, H, R), f);
    const glass = (X, Y, W, H) => { x.fillStyle = '#bfe6f5'; x.beginPath(); rrP(x, X, Y, W, H, 3); x.fill(); };
    const flat = (X, Y, W, H, f) => { x.fillStyle = f; x.fillRect(X, Y, W, H); };
    let wheels = [18, 68];
    if (type === 'taxi') {
      part(22, 18, 40, 26, 9, col); part(4, 36, 80, 24, 9, col);
      glass(27, 23, 14, 13); glass(44, 23, 14, 13);
      flat(6, 46, 76, 4, '#26232b'); part(34, 9, 16, 10, 4, '#fff3c4');
    } else if (type === 'fire') {
      part(0, 24, 60, 36, 6, col); part(58, 20, 28, 40, 8, col);
      glass(66, 26, 15, 14); flat(4, 34, 14, 18, '#d5d9e0'); flat(22, 34, 14, 18, '#d5d9e0'); flat(40, 34, 14, 18, '#d5d9e0');
      flat(2, 14, 66, 4, '#dfe3ea'); for (let i = 0; i < 7; i++) flat(6 + i * 9, 11, 3, 10, '#aab2bf');
      flat(68, 14, 10, 6, '#ff4a3a'); wheels = [16, 70];
    } else if (type === 'ambulance') {
      part(0, 8, 60, 52, 7, col); part(58, 26, 28, 34, 8, col);
      glass(66, 30, 15, 13); flat(2, 42, 56, 6, '#4fa3e0');
      const h = new Path2D(); heartP(h, 30, 26, 0.36); x.fillStyle = '#ff6b5c'; x.fill(h);
      flat(22, 3, 12, 6, '#4fa3ff');
    } else if (type === 'icecream') {
      part(2, 18, 62, 42, 7, col); part(62, 30, 24, 30, 8, col);
      glass(68, 34, 13, 12); part(12, 26, 34, 16, 4, '#fff6e0'); flat(0, 16, 66, 5, '#fff6e0');
      x.fillStyle = '#e0a85a'; x.beginPath(); x.moveTo(24, 6); x.lineTo(38, 6); x.lineTo(31, 18); x.closePath(); x.fill();
      circ(x, 31, 3, 8, '#fff6e0'); wheels = [18, 70];
    } else {                                                             // tow truck
      part(54, 20, 32, 40, 8, col); part(0, 42, 58, 18, 5, '#5a5260');
      glass(64, 26, 16, 14); flat(60, 15, 12, 6, '#ff9d2e');
      x.strokeStyle = '#3a343f'; x.lineWidth = 6; x.lineCap = 'round'; x.beginPath(); x.moveTo(50, 40); x.lineTo(8, 16); x.stroke();
      x.lineWidth = 2.5; x.beginPath(); x.moveTo(8, 16); x.lineTo(8, 34); x.stroke();
      wheels = [16, 70];
    }
    for (const wx of wheels) { circ(x, wx, 62, 9, '#3a343f'); circ(x, wx, 62, 4, '#c9d2db'); }
    x.restore();
  }
  function pic(name, size = 128) {
    const key = name + ':' + size;
    if (picCache[key]) return picCache[key];
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'); x.scale(size / 100, size / 100); x.lineCap = x.lineJoin = 'round';
    const house = (roof) => {
      shaded(x, (p) => rrP(p, 20, 44, 60, 46, 6), '#fff6e0');
      shaded(x, (p) => { p.moveTo(10, 48); p.lineTo(50, 12); p.lineTo(90, 48); p.closePath(); }, roof);
      shaded(x, (p) => rrP(p, 41, 62, 18, 28, 4), '#9b6238');
      x.fillStyle = '#bfe6f5'; x.fillRect(26, 54, 11, 11); x.fillRect(63, 54, 11, 11);
    };
    switch (name) {
      case 'bus': sideBus(x, 7, 22, 1.0, '#f5b83d', 'single'); break;
      case 'star': shaded(x, (p) => starP(p, 50, 54, 44, 19), '#ffb81f'); break;
      case 'cat':
        shaded(x, (p) => { p.moveTo(24, 46); p.lineTo(28, 12); p.lineTo(48, 32); p.closePath(); p.moveTo(76, 46); p.lineTo(72, 12); p.lineTo(52, 32); p.closePath(); }, '#f5a23d');
        shaded(x, (p) => p.arc(50, 56, 32, 0, Math.PI * 2), '#f5a23d');
        circ(x, 39, 52, 4.5, '#3a2a3c'); circ(x, 61, 52, 4.5, '#3a2a3c');
        x.fillStyle = '#ff8fab'; x.beginPath(); x.moveTo(45, 62); x.lineTo(55, 62); x.lineTo(50, 68); x.fill();
        x.strokeStyle = '#a8601a'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(30, 64); x.lineTo(14, 61); x.moveTo(30, 69); x.lineTo(15, 72); x.moveTo(70, 64); x.lineTo(86, 61); x.moveTo(70, 69); x.lineTo(85, 72); x.stroke();
        break;
      case 'sun':
        for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; shaded(x, (p) => { p.moveTo(50 + Math.cos(a - 0.17) * 30, 50 + Math.sin(a - 0.17) * 30); p.lineTo(50 + Math.cos(a) * 47, 50 + Math.sin(a) * 47); p.lineTo(50 + Math.cos(a + 0.17) * 30, 50 + Math.sin(a + 0.17) * 30); p.closePath(); }, '#ffb81f'); }
        shaded(x, (p) => p.arc(50, 50, 28, 0, Math.PI * 2), '#ffd45c');
        break;
      case 'flower':
        shaded(x, (p) => rrP(p, 46, 50, 8, 44, 4), '#5aa848');
        shaded(x, (p) => p.ellipse(64, 76, 14, 7, -0.5, 0, Math.PI * 2), '#6fc45a');
        for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; shaded(x, (p) => p.arc(50 + Math.cos(a) * 18, 38 + Math.sin(a) * 18, 14, 0, Math.PI * 2), '#ff8fab'); }
        shaded(x, (p) => p.arc(50, 38, 11, 0, Math.PI * 2), '#ffd45c');
        break;
      case 'fish':
        shaded(x, (p) => { p.moveTo(70, 50); p.lineTo(94, 30); p.lineTo(94, 70); p.closePath(); }, '#3d8fe0');
        shaded(x, (p) => p.ellipse(44, 50, 32, 22, 0, 0, Math.PI * 2), '#4fa3e0');
        circ(x, 30, 45, 6, '#fff'); circ(x, 29, 45, 3, '#3a2a3c');
        break;
      case 'heart': shaded(x, (p) => heartP(p, 50, 52, 1.05), '#ef5a4b'); break;
      case 'moon': {
        x.save(); const cut = new Path2D(); cut.rect(0, 0, 100, 100); cut.arc(68, 36, 30, 0, Math.PI * 2); x.clip(cut, 'evenodd');
        shaded(x, (p) => p.arc(48, 54, 38, 0, Math.PI * 2), '#ffe08a'); x.restore();
        break;
      }
      case 'tree':
        shaded(x, (p) => rrP(p, 43, 56, 14, 38, 4), '#9b6238');
        shaded(x, (p) => p.arc(50, 40, 31, 0, Math.PI * 2), '#6fc45a');
        circ(x, 40, 32, 8, '#93d97a');
        break;
      case 'kite':
        x.strokeStyle = '#9b6238'; x.lineWidth = 3; x.beginPath(); x.moveTo(50, 78); x.bezierCurveTo(40, 88, 62, 92, 52, 99); x.stroke();
        shaded(x, (p) => { p.moveTo(50, 4); p.lineTo(82, 40); p.lineTo(50, 80); p.lineTo(18, 40); p.closePath(); }, '#8e62c8');
        x.fillStyle = '#b08ae0'; x.beginPath(); x.moveTo(50, 4); x.lineTo(82, 40); x.lineTo(50, 40); x.fill(); x.beginPath(); x.moveTo(18, 40); x.lineTo(50, 40); x.lineTo(50, 80); x.fill();
        for (const [bx, by] of [[44, 86], [58, 94]]) { x.fillStyle = '#ff6b5c'; x.beginPath(); x.moveTo(bx - 7, by - 5); x.lineTo(bx + 7, by + 5); x.lineTo(bx + 7, by - 5); x.lineTo(bx - 7, by + 5); x.fill(); }
        break;
      case 'ball': {
        shaded(x, (p) => p.arc(50, 50, 40, 0, Math.PI * 2), '#fff6e0');
        x.save(); x.beginPath(); x.arc(50, 50, 40, 0, Math.PI * 2); x.clip();
        x.fillStyle = '#ef5a4b'; x.beginPath(); x.moveTo(50, 50); x.arc(50, 50, 44, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); x.fill();
        x.fillStyle = '#4fa3e0'; x.beginPath(); x.moveTo(50, 50); x.arc(50, 50, 44, Math.PI / 6 - 0.5, Math.PI / 6 + 0.5); x.fill();
        x.fillStyle = '#ffb81f'; x.beginPath(); x.moveTo(50, 50); x.arc(50, 50, 44, Math.PI * 5 / 6 - 0.5, Math.PI * 5 / 6 + 0.5); x.fill();
        x.fillStyle = 'rgba(80,40,60,.18)'; x.beginPath(); x.arc(42, 40, 44, 0, Math.PI * 2); x.arc(50, 50, 44, 0, Math.PI * 2, true); x.fill('evenodd');
        x.restore(); circ(x, 50, 50, 6, '#fff6e0');
        break;
      }
      case 'boat':
        shaded(x, (p) => rrP(p, 4, 80, 92, 14, 7), '#4fa3e0');
        shaded(x, (p) => rrP(p, 48, 14, 5, 54, 2), '#9b6238');
        shaded(x, (p) => { p.moveTo(55, 16); p.lineTo(55, 62); p.lineTo(86, 62); p.closePath(); }, '#fff6e0');
        shaded(x, (p) => { p.moveTo(46, 24); p.lineTo(46, 62); p.lineTo(22, 62); p.closePath(); }, '#ffd45c');
        shaded(x, (p) => { p.moveTo(10, 64); p.lineTo(90, 64); p.lineTo(76, 84); p.lineTo(24, 84); p.closePath(); }, '#ef5a4b');
        break;
      // ---- UI pictures ----
      case 'together': {
        const mine = paintHex(BB.save.paint);
        sideBus(x, 2, 44, 0.62, mine === '#4fa3e0' ? '#3fae49' : '#4fa3e0', 'single');
        sideBus(x, 40, 52, 0.62, mine, BB.save.busType || 'bendy');
        shaded(x, (p) => heartP(p, 50, 26, 0.55), '#ef5a4b');
        break;
      }
      case 'make': house('#ef5a4b'); shaded(x, (p) => p.arc(78, 24, 17, 0, Math.PI * 2), '#5cb85c'); x.fillStyle = '#fff'; x.fillRect(70, 21, 16, 6); x.fillRect(75, 16, 6, 16); break;
      case 'join':
        house('#4fa3e0');
        shaded(x, (p) => p.arc(76, 22, 18, 0, Math.PI * 2), '#ffb81f');
        circ(x, 70, 22, 6, '#fff6e0'); x.fillStyle = '#fff6e0'; x.fillRect(74, 20, 14, 4); x.fillRect(83, 20, 3, 8);
        break;
      case 'cloud':
        shaded(x, (p) => { p.arc(34, 56, 18, 0, Math.PI * 2); p.moveTo(70, 56); p.arc(52, 42, 22, 0, Math.PI * 2); p.moveTo(86, 58); p.arc(70, 58, 16, 0, Math.PI * 2); p.moveTo(20, 60); rrP(p, 18, 52, 66, 22, 11); }, '#c4d6e6');
        x.strokeStyle = '#7a8da0'; x.lineWidth = 4;
        for (const r of [8, 15]) { x.beginPath(); x.arc(52, 66, r, -Math.PI * 0.8, -Math.PI * 0.2); x.stroke(); }
        circ(x, 52, 66, 3, '#7a8da0');
        shaded(x, (p) => p.arc(78, 78, 15, 0, Math.PI * 2), '#ef5a4b');
        x.strokeStyle = '#fff'; x.lineWidth = 4; x.beginPath(); x.moveTo(72, 72); x.lineTo(84, 84); x.moveTo(84, 72); x.lineTo(72, 84); x.stroke();
        break;
      case 'home':
        house('#f5a23d');
        shaded(x, (p) => p.arc(22, 24, 17, 0, Math.PI * 2), '#19a79b');
        x.strokeStyle = '#fff'; x.lineWidth = 5; x.beginPath(); x.moveTo(30, 24); x.lineTo(14, 24); x.moveTo(20, 17); x.lineTo(13, 24); x.lineTo(20, 31); x.stroke();
        break;
      case 'speak':
        shaded(x, (p) => { p.moveTo(18, 38); p.lineTo(34, 38); p.lineTo(54, 20); p.lineTo(54, 80); p.lineTo(34, 62); p.lineTo(18, 62); p.closePath(); }, '#4fa3e0');
        x.strokeStyle = '#3d8fe0'; x.lineWidth = 6;
        for (const r of [14, 26]) { x.beginPath(); x.arc(56, 50, r, -0.8, 0.8); x.stroke(); }
        break;
      case 'tick': shaded(x, (p) => p.arc(50, 50, 44, 0, Math.PI * 2), '#5cb85c'); x.strokeStyle = '#fff'; x.lineWidth = 11; x.beginPath(); x.moveTo(28, 52); x.lineTo(44, 67); x.lineTo(73, 35); x.stroke(); break;
      case 'cross': shaded(x, (p) => p.arc(50, 50, 44, 0, Math.PI * 2), '#f26b5b'); x.strokeStyle = '#fff'; x.lineWidth = 10; x.beginPath(); x.moveTo(33, 33); x.lineTo(67, 67); x.moveTo(67, 33); x.lineTo(33, 67); x.stroke(); break;
      case 'del':
        shaded(x, (p) => { p.moveTo(36, 22); p.lineTo(90, 22); p.lineTo(90, 78); p.lineTo(36, 78); p.lineTo(10, 50); p.closePath(); }, '#f5a23d');
        x.strokeStyle = '#fff'; x.lineWidth = 8; x.beginPath(); x.moveTo(48, 36); x.lineTo(74, 64); x.moveTo(74, 36); x.lineTo(48, 64); x.stroke();
        break;
      default: circ(x, 50, 50, 40, P.plum);
    }
    return (picCache[key] = c);
  }
  N.pic = pic;
  function miniBus(look) {
    const key = 'mini:' + look.ty + look.pa + (look.vp || '');
    if (picCache[key]) return picCache[key];
    const c = document.createElement('canvas'); c.width = 96; c.height = 64;
    const x = c.getContext('2d'); x.scale(96 / 100, 64 / 66);
    if (isBus(look.ty)) sideBus(x, 6, look.ty === 'double' ? 12 : 0, 1.02, paintHex(look.pa), look.ty);
    else sideRide(x, 6, 0, 1.02, lookHex(look), look.ty);
    return (picCache[key] = c);
  }
  // a friend's little picture for other files (ui.js: the home screen's strip): type, bus paint id, drawn colour
  N.mini = (type, paint, color) => {
    if (isBus(type)) return miniBus({ ty: type, pa: paint });
    const key = 'minic:' + type + color;
    if (picCache[key]) return picCache[key];
    const c = document.createElement('canvas'); c.width = 96; c.height = 64;
    const x = c.getContext('2d'); x.scale(96 / 100, 64 / 66);
    sideRide(x, 6, 0, 1.02, /^#[0-9a-f]{6}$/i.test(color) ? color : RIDE_PAINT[type], type);
    return (picCache[key] = c);
  };
  const cv = (canvas) => { const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; c.getContext('2d').drawImage(canvas, 0, 0); return c; };

  // ================= the room cards and the friends strip =================
  // (the way in is the garage's Together section, depot.js: New room / Join room, or Our room / Leave)
  BB.css(`
  .bbn-wrap { position: absolute; inset: 0; z-index: 58; background: rgba(40,30,50,.38); display: flex; align-items: center; justify-content: center;
    pointer-events: auto; animation: bbn-fade .2s; font-family: ${BB.FONT}; padding: var(--st) var(--sr) var(--sb) var(--sl); box-sizing: border-box; }
  @keyframes bbn-fade { from { opacity: 0; } }
  @keyframes bbn-pop { from { transform: scale(.3); opacity: 0; } }
  .bbn-card { position: relative; background: linear-gradient(#fff6e0, #fdebc8); border: 5px solid #d9b57f; border-radius: 34px; padding: 18px 22px 18px;
    display: flex; flex-direction: column; align-items: center; gap: 14px; max-width: 100%; max-height: 100%; box-sizing: border-box;
    box-shadow: inset -6px -8px 0 rgba(217,181,127,.35), 0 10px 0 rgba(120,80,40,.2); animation: bbn-pop .3s cubic-bezier(.2,1.5,.5,1); }
  .bbn-card canvas { display: block; }
  .bbn-title { font: 700 30px/1.1 ${BB.FONT}; color: #3a2a3c; text-align: center; }
  .bbn-row { display: flex; gap: 14px; align-items: flex-end; justify-content: center; flex-wrap: nowrap; }
  /* every button: a picture and its word */
  .bbn-big, .bbn-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; cursor: pointer; touch-action: manipulation;
    font: 700 16px/1 ${BB.FONT}; color: #4a3424; box-sizing: border-box; flex: none; }
  .bbn-big { width: 176px; height: 186px; border-radius: 30px; border: 4px solid #ecd3a8; background: #fff; padding: 8px 8px 12px; font-size: 22px;
    box-shadow: 0 6px 0 rgba(120,80,40,.15); }
  .bbn-big canvas { width: 130px; height: 130px; }
  .bbn-btn { width: 84px; height: 92px; border-radius: 24px; border: 3px solid #ecd3a8; background: #fff; padding: 4px 2px 7px; box-shadow: 0 4px 0 rgba(120,80,40,.13); }
  .bbn-btn canvas { width: 58px; height: 58px; }
  .bbn-btn .lb, .bbn-big .lb { white-space: nowrap; }
  .bbn-x { position: absolute; z-index: 3; top: -18px; right: -18px; width: 64px; height: 64px; border-radius: 50%; border: none; padding: 0; background: none; cursor: pointer; touch-action: manipulation;
    display: flex; flex-direction: column; align-items: center; }
  .bbn-x canvas { width: 60px; height: 60px; flex: none; }
  .bbn-x .lb { font: 700 13px/1 ${BB.FONT}; color: #4a3424; background: #fff6e0; border: 2px solid #d9b57f; border-radius: 9px; padding: 1px 6px 2px; margin-top: -6px; }
  .bbn-big.pressed, .bbn-btn.pressed, .bbn-key.pressed, .bbn-x.pressed { transform: translateY(4px); }
  .bbn-code { --s: clamp(64px, min(14vw, 24vh), 128px); display: flex; gap: 10px; }
  .bbn-code > div { width: var(--s); height: var(--s); border-radius: 24px; background: #fff; border: 4px solid #ecd3a8; box-sizing: border-box; padding: 6px;
    box-shadow: 0 5px 0 rgba(120,80,40,.15); animation: bbn-pop .35s cubic-bezier(.2,1.5,.5,1) both; }
  .bbn-code > div canvas { width: 100%; height: 100%; }
  .bbn-code > div.lit { border-color: #ffb81f; box-shadow: 0 0 0 5px rgba(255,212,92,.7); }
  .bbn-slots { --s: clamp(46px, min(9vw, 13vh), 84px); display: flex; gap: 8px; align-items: center; }
  .bbn-slots > div { width: var(--s); height: var(--s); border-radius: 18px; background: #f3e4c6; border: 3px dashed #d9b57f; box-sizing: border-box; padding: 4px; }
  .bbn-slots > div.full { background: #fff; border: 3px solid #ecd3a8; animation: bbn-pop .25s cubic-bezier(.2,1.5,.5,1); }
  .bbn-slots > div canvas { width: 100%; height: 100%; }
  .bbn-slots .bbn-btn { margin-left: 8px; }
  .bbn-keys { --k: clamp(60px, min(11.5vw, 19vh), 100px); display: grid; grid-template-columns: repeat(6, var(--k)); gap: 10px; }
  .bbn-key { width: var(--k); height: var(--k); border-radius: 22px; border: 3px solid #ecd3a8; background: #fff; padding: 4px 4px 3px; cursor: pointer; touch-action: manipulation;
    box-shadow: 0 5px 0 rgba(120,80,40,.15); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
    font: 700 max(12px, calc(var(--k) * .17))/1 ${BB.FONT}; color: #6b5440; box-sizing: border-box; }
  .bbn-key canvas { width: 76%; height: 76%; flex: none; }
  .bbn-card .shake { animation: bbn-shake .45s; }
  @keyframes bbn-shake { 25% { transform: translateX(-9px); } 75% { transform: translateX(9px); } }
  .bbn-friends { position: absolute; z-index: 6; right: var(--sr); top: calc(var(--st) + var(--hudh, 80px) + 10px); display: flex; flex-wrap: wrap; justify-content: flex-end;
    max-width: 46vw; gap: 6px; pointer-events: none; }
  .bbn-friends.hide { display: none; }
  .bbn-friend { pointer-events: auto; display: flex; flex-direction: column; align-items: center; background: #fff6e0; border: 3px solid #d9b57f; border-radius: 18px;
    padding: 2px 6px 0; box-shadow: inset -3px -4px 0 rgba(217,181,127,.35), 0 3px 0 rgba(120,80,40,.15); cursor: pointer; touch-action: manipulation; animation: bbn-pop .3s cubic-bezier(.2,1.5,.5,1); }
  .bbn-friend canvas { width: 44px; height: 29px; }
  .bbn-friend b { font: 800 14px/15px 'Courier New', monospace; color: #3a2a3c; margin-bottom: 2px; }
  .bbn-friends.many { gap: 4px; } .bbn-friends.many .bbn-friend { padding: 1px 3px 0; border-radius: 14px; border-width: 2px; }
  .bbn-friends.many .bbn-friend canvas { width: 34px; height: 23px; } .bbn-friends.many .bbn-friend b { font-size: 12px; line-height: 13px; }
  .bbn-friend.me { border-color: #19a79b; }
  .bbn-card .bbn-friends, .bbd .bbn-friends { position: static; max-width: none; flex-wrap: wrap; }
  .bbd-friends .bbn-friend canvas { width: 54px; height: 36px; }
  @media (max-height: 520px) {
    .bbn-card { padding: 12px 14px 12px; gap: 10px; border-radius: 28px; }
    .bbn-title { font-size: 24px; }
    .bbn-big { width: 140px; height: 150px; font-size: 19px; } .bbn-big canvas { width: 100px; height: 100px; }
    .bbn-btn { width: 70px; height: 76px; border-radius: 20px; font-size: 13px; } .bbn-btn canvas { width: 46px; height: 46px; }
    .bbn-x { width: 56px; height: 56px; top: -14px; right: -14px; } .bbn-x canvas { width: 52px; height: 52px; }
    .bbn-friend canvas { width: 40px; height: 27px; }
  }
  `);

  let wrap = null, card = null, panelKind = null, friendsEl = null;
  N.init = function () {
    const root = BB.ui.root;
    friendsEl = BB.el('div', 'bbn-friends hide', root);
    BB.on('depot:open', () => syncFriends());
    BB.on('depot:closed', () => { hidePanel(); sendHi(); syncFriends(); });
    BB.on('bus:type', () => { if (link === 'open') BB.later(100, () => sendHi()); });
    BB.on('bus:horn', () => {
      if (link !== 'open') return;
      const now = performance.now(); if (now - honkAt < 600) return; honkAt = now;
      send({ t: 'honk', tune: !!(BB.save.upgrades && BB.save.upgrades.horn) });
    });
    BB.on('hub:pause', () => N.leave('home'));
    addEventListener('pagehide', () => { stopped = true; unlink('home'); });
    addEventListener('pageshow', (e) => { if (e.persisted && !BB.bedtime) { stopped = false; backoff = 0; connect(); } });
    addEventListener('online', () => { backoff = 0; if (!T) connect(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { tick(); return; }
      lastKey = '';
      if (T) tick(); else { backoff = 0; connect(); }
    });
    syncStatus();
    setTimeout(connect, 300);                              // always on: join the family room by ourselves
  };
  function syncFriends() {
    if (!friendsEl) return;
    const n = [...remotes.values()].filter((r) => !r.leaving).length;
    friendsEl.innerHTML = '';
    const show = link === 'open' && n > 0 && !(BB.depot && BB.depot.isOpen) && !BB.bedtime;
    friendsEl.classList.toggle('hide', !show);
    friendsEl.classList.toggle('many', n > 4);
    if (show) fillFriends(friendsEl, false);
    if (panelKind === 'code' && card) { const f = card.querySelector('.bbn-friends'); if (f) { f.innerHTML = ''; fillFriends(f, true); } }
    syncStatus();
  }
  N.fillFriends = (el, withMe) => fillFriends(el, withMe);
  function fillFriends(el, withMe) {
    const list = [...remotes.values()].filter((r) => !r.leaving).map((r) => r.look);
    if (withMe) list.unshift(Object.assign(myLook(), { me: true }));
    for (const look of list) {
      const f = BB.el('div', 'bbn-friend' + (look.me ? ' me' : ''), el);
      const bus = isBus(look.ty);
      f.appendChild(cv(miniBus(look))); BB.el('b', '', f, bus ? look.no : '');
      BB.tap(f, () => BB.say(bus ? (look.me ? `Your bus, number ${look.no}!` : `Bus ${look.no}!`) : (look.me ? `Your ${RIDE_NAME[look.ty]}!` : `A friend's ${RIDE_NAME[look.ty]}!`)));
    }
  }

  function hidePanel() { if (wrap) wrap.remove(); wrap = card = null; panelKind = null; if (codeT) { BB.cancelLater(codeT); codeT = null; } }
  function panel(kind, closable = true) {
    hidePanel();
    if (BB.ui.releaseAll) BB.ui.releaseAll();
    panelKind = kind;
    wrap = BB.el('div', 'bbn-wrap', BB.ui.root);
    card = BB.el('div', 'bbn-card', wrap);
    if (closable) {
      const x = BB.el('button', 'bbn-x', card); x.appendChild(cv(pic('cross', 96))); BB.el('span', 'lb', x, 'Close'); x.setAttribute('aria-label', 'Close');
      BB.tap(x, () => { BB.sfx.click(); hidePanel(); });
    }
    BB.tap(wrap, (e) => { if (e.target === wrap && closable) hidePanel(); });
    return card;
  }
  // a button: a picture and its word (spoken by its own action)
  const btn = (parent, name, fn, cls, word) => {
    const b = BB.el('button', cls || 'bbn-btn', parent); b.type = 'button'; b.appendChild(cv(pic(name, 160)));
    if (word) { BB.el('span', 'lb', b, word); b.setAttribute('aria-label', word); }
    BB.tap(b, fn); return b;
  };

  // ================= the family cards (the garage's Together section opens these) =================
  let codeT = null;
  N.showFamily = function () {
    if (BB.bedtime) return;
    const c = panel('code');
    BB.el('div', 'bbn-title', c, 'Our family');
    const row = BB.el('div', 'bbn-code', c);
    const cells = fam.map((i, k) => { const d = BB.el('div', '', row); d.style.animationDelay = k * 90 + 'ms'; d.appendChild(cv(pic(PICS[i], 160))); return d; });
    const bottom = BB.el('div', 'bbn-row', c);
    btn(bottom, 'speak', () => sayCode(cells), null, 'Say it');
    fillFriends(BB.el('div', 'bbn-friends', bottom), true);
    btn(bottom, 'tick', () => { BB.sfx.click(); hidePanel(); }, null, 'OK');
    sayCode(cells, 'Our family code is: ', ' Tap these pictures on another tablet, and we can play together!');
  };
  // say the code, lighting each picture in turn
  function sayCode(cells, pre = '', post = '') {
    BB.say(pre + fam.map((i) => PICS[i]).join(', ') + '.' + post);
    if (codeT) BB.cancelLater(codeT);
    cells.forEach((el) => el.classList.remove('lit'));
    let k = 0;
    const step = () => { cells.forEach((el, j) => el.classList.toggle('lit', j === k)); k++; codeT = k <= cells.length ? BB.later(750, step) : null; };
    codeT = BB.later(300 + pre.length * 55, step);
  }
  N.enterFamily = function () {
    if (BB.bedtime) return;
    const c = panel('enter');
    const entered = [];
    let busy = false;
    const top = BB.el('div', 'bbn-slots', c);
    const slots = []; for (let i = 0; i < CODE_LEN; i++) slots.push(BB.el('div', '', top));
    btn(top, 'del', () => { if (!entered.length || busy) return; entered.pop(); BB.sfx.click(); BB.say('Delete!'); show(); }, null, 'Delete');
    const keys = BB.el('div', 'bbn-keys', c);
    const show = () => slots.forEach((el, i) => { el.innerHTML = ''; el.classList.toggle('full', i < entered.length); if (i < entered.length) el.appendChild(cv(pic(PICS[entered[i]], 96))); });
    PICS.forEach((name, i) => {
      btn(keys, name, () => {
        if (entered.length >= CODE_LEN || busy) return;
        entered.push(i); BB.sfx.pop(); show(); BB.say(name[0].toUpperCase() + name.slice(1) + '!');
        if (entered.length === CODE_LEN) { busy = true; BB.later(700, () => { if (panelKind === 'enter') done(entered.slice()); }); }
      }, 'bbn-key', name[0].toUpperCase() + name.slice(1));
    });
    function done(code) {
      hidePanel();
      if (codeStr(code) === famCode) { BB.say('That is our family already!', { queue: true }); return; }
      N.setFamily(code);
      BB.sfx.cheer(); if (BB.ui.confetti) BB.ui.confetti();
      BB.say('Hooray! Now we are one family. We play together whenever we are both playing!', { queue: true });
    }
    BB.say('Tap the pictures from the other tablet!', { queue: true });
  };
})();
