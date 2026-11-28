// Little Bus Captain family-room relay: a Cloudflare Worker plus one Durable Object per room.
// Each device opens a WebSocket to /room/<code>; the room passes every message on to the others.
// It keeps nothing: no names, no logs of positions, nothing stored. A room disappears when empty.
// (The shared play-time settings channel, /family/<name>, is the Family class at the end of this file.)
//
// Messages are small JSON objects from the game. The relay adds {from: <member id>} and sends to everyone else,
// or to one member when the message has {to: <member id>}. It also sends:
//   {t:'welcome', id, members:[ids]}   to a new member
//   {t:'join', id} / {t:'leave', id}   to the others
//   {t:'full'}                         when the room already has MAX members (then closes)

const MAX = 10;                  // players per room
const MAX_MSG = 4096;            // bytes per message
const RATE = 40;                 // messages per second per member (the game sends ~10)

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/health') return new Response('ok', { headers: cors(req, env) });
    if (url.pathname === '/check') {        // tests the rooms (Durable Object) part: should say "rooms ok"
      try {
        if (!env.ROOMS) return new Response('no ROOMS binding');
        const r = await env.ROOMS.get(env.ROOMS.idFromName('lbc-check')).fetch('https://room/ping');
        return new Response(r.ok ? 'rooms ok: ' + (await r.text()) : 'rooms error ' + r.status + ': ' + (await r.text()));
      } catch (e) { return new Response('rooms error: ' + (e && e.message || e)); }
    }
    const f = url.pathname.match(/^\/family\/([a-z0-9]{3,16})$/);
    if (f) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      if (!originOk(req, env)) return new Response('forbidden', { status: 403 });
      if (!env.FAMILY) return new Response('no FAMILY binding', { status: 503 });
      return env.FAMILY.get(env.FAMILY.idFromName('family-' + f[1])).fetch(req);
    }
    const m = url.pathname.match(/^\/room\/([a-z0-9-]{4,40})$/);
    if (!m) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    if (!originOk(req, env)) return new Response('forbidden', { status: 403 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
    return stub.fetch(req);
  },
};

function allowed(env) { return (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean); }
function originOk(req, env) {
  const list = allowed(env); if (list.includes('*')) return true;
  const o = req.headers.get('Origin') || 'null';
  return list.some(a => a === o || (a.startsWith('*.') && o.endsWith(a.slice(1))));
}
function cors(req, env) { return { 'Access-Control-Allow-Origin': originOk(req, env) ? (req.headers.get('Origin') || '*') : 'null' }; }

export class Room {
  constructor(state) { this.state = state; }

  members() { return this.state.getWebSockets().map(ws => ws.deserializeAttachment()).filter(Boolean); }

  async fetch(req) {
    if (new URL(req.url).pathname === '/ping') return new Response('room ' + this.state.getWebSockets().length + ' connected');
    const socks = this.state.getWebSockets();
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    if (socks.length >= MAX) {
      server.accept(); server.send(JSON.stringify({ t: 'full' })); server.close(4001, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    const used = new Set(this.members().map(a => a.id));
    let id = 1; while (used.has(id)) id++;
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ id, win: 0, n: 0 });
    server.send(JSON.stringify({ t: 'welcome', id, members: [...used].sort((a, b) => a - b), max: MAX }));
    this.broadcast({ t: 'join', id }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const ws of this.state.getWebSockets()) if (ws !== except) { try { ws.send(s); } catch (e) { /* gone */ } }
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > MAX_MSG) return;
    const a = ws.deserializeAttachment(); if (!a) return;
    const now = Math.floor(Date.now() / 1000);
    if (a.win !== now) { a.win = now; a.n = 0; }
    if (++a.n > RATE) { ws.serializeAttachment(a); return; }
    ws.serializeAttachment(a);
    let msg; try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    if (msg.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    msg.from = a.id;
    const to = msg.to; delete msg.to;
    const s = JSON.stringify(msg);
    for (const o of this.state.getWebSockets()) {
      if (o === ws) continue;
      if (to != null) { const b = o.deserializeAttachment(); if (!b || b.id !== to) continue; }
      try { o.send(s); } catch (e) { /* gone */ }
    }
  }

  async webSocketClose(ws) { this.left(ws); }
  async webSocketError(ws) { this.left(ws); }
  left(ws) {
    const a = ws.deserializeAttachment(); if (!a || a.gone) return;
    a.gone = true; ws.serializeAttachment(a);
    try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    this.broadcast({ t: 'leave', id: a.id }, ws);
  }
}

// =====================================================================
//  The shared play-time settings channel: /family/<name> (the app uses /family/all).
//  One Durable Object keeps, for every device that has joined, its short name, its play-time settings
//  (each field with the time it was last changed: [value, ms]) and its last reported status, so a grown-up's
//  admin panel on any device can see and change every device, and a device that was offline gets the newest
//  settings when it connects again. "Last change wins": a field only changes for a newer time stamp.
//  Everything that comes in is checked and clamped; anything else is dropped. No secrets, no free text but
//  the device names (16 plain characters).
//
//  device -> relay                                        relay -> device
//   {t:'hello', dev, kind, name:[v,ts], s:{...}, st}       {t:'you', rec}         its own record (merged)
//   {t:'set', to: dev|'*', f:{limit, extra, reset, name}}  {t:'dev', rec}         a changed record (to that device
//   {t:'add', to: dev|'*', n, day, ts}  (+n min today)                             and to watchers)
//   {t:'st', st:{left, used, limit, extra, day, screen}}   {t:'list', devs:[rec]} to a watcher
//   {t:'watch', on}  (an admin panel is open)              {t:'poll'}             please send your status now
//   {t:'forget', id} (an offline device)                   {t:'gone', id}         to watchers
//   {t:'ping'}                                             {t:'pong'}
//                                                          {t:'badpin'}           a wrong (or missing) PIN
//  Admin messages (watch, forget, and set/add for any device but the sender itself) must carry pin: the
//  ADMIN_PIN var from wrangler.toml; without the right one they are ignored (5 wrong tries a minute per
//  connection, then even the right one waits). A device's own hello, status and own settings need no PIN.
//  The PIN is also in the app's public code, so it keeps children out, not a determined adult.
//  s fields: limit [0|10|15|20|30, ts]; extra [{day, n: 0..60}, ts]; reset [{day}, ts] ("start today again").
//  A '*' set also keeps the limit as the family's, which a device joining later takes if it is newer.
// =====================================================================
const FAM_MAX_DEVICES = 50;            // devices listed; a new one replaces the one seen longest ago
const FAM_FORGET = 30 * 864e5;         // devices not seen for 30 days are forgotten
const FAM_MAX_SOCKETS = 100;           // open connections (a device may have two tabs)
const FAM_MAX_MSG = 2048;
const FAM_RATE = 10;                   // messages per second per connection (the app sends one every ~20 s)
const FAM_ST_SAVE = 10 * 60e3;         // a status alone is written to storage at most every 10 minutes per device
const LIMITS = [0, 10, 15, 20, 30];
const KINDS = ['iPad', 'iPhone', 'Tablet', 'Phone', 'Computer'];
const SCREENS = ['launcher', 'game', 'sleep', 'other'];
const DAY_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;
const ID_RE = /^[A-Za-z0-9]{8,16}$/;

const famInt = (v, a, b) => { v = Math.floor(Number(v)); return Number.isFinite(v) && v >= a && v <= b ? v : null; };
const famTs = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, Date.now()) : null; };
const famDay = v => (typeof v === 'string' && DAY_RE.test(v) ? v : null);
function famName(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[^A-Za-z0-9 '.\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16).trim();
  return s || null;
}
// one [value, ts] field, checked; null if it isn't valid
function famField(key, f) {
  if (!Array.isArray(f) || f.length !== 2) return null;
  const ts = famTs(f[1]); if (ts === null) return null;
  const v = f[0];
  if (key === 'limit') return LIMITS.includes(v) ? [v, ts] : null;
  if (key === 'name') { const n = famName(v); return n ? [n, ts] : null; }
  if (!v || typeof v !== 'object') return null;
  const day = famDay(v.day); if (!day) return null;
  if (key === 'extra') { const n = famInt(v.n, 0, 60); return n === null ? null : [{ day, n }, ts]; }
  if (key === 'reset') return [{ day }, ts];
  return null;
}
function famStatus(st) {
  if (!st || typeof st !== 'object') return null;
  const day = famDay(st.day); if (!day) return null;
  return {
    day, left: st.left === null ? null : famInt(st.left, 0, 7200), used: famInt(st.used, 0, 86400) || 0,
    limit: LIMITS.includes(st.limit) ? st.limit : 0, extra: famInt(st.extra, 0, 60) || 0,
    screen: SCREENS.includes(st.screen) ? st.screen : 'other', at: Date.now(),
  };
}
const newer = (a, b) => !!b && (!a || b[1] > a[1]);
const PIN_TRIES = 5;                   // wrong PINs a minute per connection

export class Family {
  constructor(state, env) { this.state = state; this.env = env || {}; this.devs = null; this.all = null; this.stSaved = new Map(); }

  // the admin PIN: right, and not after too many wrong tries this minute (kept on the connection)
  pinOk(ws, a, pin) {
    const want = String(this.env.ADMIN_PIN || '');
    const min = Math.floor(Date.now() / 60000);
    if (a.pinMin !== min) { a.pinMin = min; a.pinBad = 0; }
    const ok = !!want && a.pinBad < PIN_TRIES && typeof pin === 'string' && pin === want;
    if (!ok) { a.pinBad++; this.send(ws, { t: 'badpin', wait: a.pinBad >= PIN_TRIES }); }
    ws.serializeAttachment(a);
    return ok;
  }

  async load() {
    if (this.devs) return;
    const map = await this.state.storage.list({ prefix: 'd:' });
    this.devs = new Map();
    for (const [, rec] of map) if (rec && rec.id) this.devs.set(rec.id, rec);
    this.all = (await this.state.storage.get('all')) || {};
    // forget devices not seen for a month
    const old = Date.now() - FAM_FORGET, gone = [];
    for (const [id, r] of this.devs) if (!(r.seen > old) && !this.online(id)) { this.devs.delete(id); gone.push('d:' + id); }
    if (gone.length) await this.state.storage.delete(gone);
  }
  online(id) {
    for (const ws of this.state.getWebSockets()) { const a = ws.deserializeAttachment(); if (a && a.dev === id && !a.gone) return true; }
    return false;
  }
  pub(r) { return { id: r.id, kind: r.kind, name: r.name, s: r.s, st: r.st || null, seen: r.seen || 0, on: this.online(r.id) }; }
  async put(r) { this.stSaved.set(r.id, Date.now()); await this.state.storage.put('d:' + r.id, r); }

  async fetch(req) {
    if (new URL(req.url).pathname === '/ping') return new Response('family ' + this.state.getWebSockets().length + ' connected');
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    if (this.state.getWebSockets().length >= FAM_MAX_SOCKETS) {
      server.accept(); server.send(JSON.stringify({ t: 'full' })); server.close(4001, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ dev: null, watch: false, win: 0, n: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* gone */ } }
  // a changed record goes to its own device(s) and to every open admin panel
  tell(r, alsoOwner = true) {
    const s = JSON.stringify({ t: 'dev', rec: this.pub(r) });
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment(); if (!a || a.gone || !a.dev) continue;
      if (a.watch || (alsoOwner && a.dev === r.id)) { try { ws.send(s); } catch (e) { /* gone */ } }
    }
  }
  toWatchers(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.state.getWebSockets()) { const a = ws.deserializeAttachment(); if (a && a.watch && !a.gone) { try { ws.send(s); } catch (e) { /* gone */ } } }
  }
  merge(r, f, withName) {
    let changed = false;
    for (const k of ['limit', 'extra', 'reset']) {
      const v = famField(k, f && f[k]);
      if (v && newer(r.s[k], v)) { r.s[k] = v; changed = true; }
    }
    if (withName) { const v = famField('name', f && f.name); if (v && newer(r.name, v)) { r.name = v; changed = true; } }
    return changed;
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > FAM_MAX_MSG) return;
    const a = ws.deserializeAttachment(); if (!a || a.gone) return;
    const sec = Math.floor(Date.now() / 1000);
    if (a.win !== sec) { a.win = sec; a.n = 0; }
    if (++a.n > FAM_RATE) { ws.serializeAttachment(a); return; }
    ws.serializeAttachment(a);
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return;
    if (m.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    await this.load();
    if (m.t === 'hello') {
      if (a.dev || typeof m.dev !== 'string' || !ID_RE.test(m.dev)) return;
      const kind = KINDS.includes(m.kind) ? m.kind : 'Computer';
      let r = this.devs.get(m.dev);
      if (!r) {
        if (this.devs.size >= FAM_MAX_DEVICES) {          // make room: forget the offline device seen longest ago
          let oldest = null;
          for (const x of this.devs.values()) if (!this.online(x.id) && (!oldest || (x.seen || 0) < (oldest.seen || 0))) oldest = x;
          if (!oldest) { this.send(ws, { t: 'full' }); return; }
          this.devs.delete(oldest.id); await this.state.storage.delete('d:' + oldest.id);
          this.toWatchers({ t: 'gone', id: oldest.id });
        }
        // a first name from the device kind and the lowest free number: "iPad 1", "iPad 2"...
        const used = new Set([...this.devs.values()].map(x => x.name && x.name[0]));
        let n = 1; while (used.has(kind + ' ' + n)) n++;
        r = { id: m.dev, kind, name: [kind + ' ' + n, 0], s: {}, st: null, seen: 0 };
        this.devs.set(r.id, r);
      }
      r.kind = kind;
      this.merge(r, m.s, false);
      const nm = famField('name', m.name); if (nm && newer(r.name, nm)) r.name = nm;
      if (this.all.limit && newer(r.s.limit, this.all.limit)) r.s.limit = this.all.limit;
      const st = famStatus(m.st); if (st) r.st = st;
      r.seen = Date.now();
      a.dev = r.id; ws.serializeAttachment(a);
      await this.put(r);
      this.send(ws, { t: 'you', rec: this.pub(r) });
      this.tell(r, false);
      return;
    }
    if (!a.dev) return;                                   // everything else needs a hello first
    if (m.t === 'st') {
      const r = this.devs.get(a.dev), st = famStatus(m.st); if (!r || !st) return;
      r.st = st; r.seen = Date.now();
      if (Date.now() - (this.stSaved.get(r.id) || 0) > FAM_ST_SAVE) await this.put(r);
      this.tell(r, false);
    } else if (m.t === 'watch') {
      if (m.on && !this.pinOk(ws, a, m.pin)) return;
      a.watch = !!m.on; ws.serializeAttachment(a);
      if (a.watch) {
        this.send(ws, { t: 'list', devs: [...this.devs.values()].map(r => this.pub(r)) });
        const s = JSON.stringify({ t: 'poll' });          // fresh minutes left from everyone online
        for (const o of this.state.getWebSockets()) if (o !== ws) { try { o.send(s); } catch (e) { /* gone */ } }
      }
    } else if (m.t === 'set' || m.t === 'add') {
      if (m.to !== a.dev && !this.pinOk(ws, a, m.pin)) return;      // only its own settings without the PIN
      const targets = m.to === '*' ? [...this.devs.values()] : [this.devs.get(m.to)].filter(Boolean);
      if (!targets.length) return;
      if (m.t === 'set') {
        if (m.to === '*') { const l = famField('limit', m.f && m.f.limit); if (l && newer(this.all.limit, l)) { this.all.limit = l; await this.state.storage.put('all', this.all); } }
        for (const r of targets) if (this.merge(r, m.f, m.to !== '*')) { await this.put(r); this.tell(r); }
      } else {
        const n = famInt(m.n, 1, 60), day = famDay(m.day), ts = famTs(m.ts);
        if (n === null || !day || ts === null) return;
        for (const r of targets) {
          const cur = r.s.extra, had = cur && cur[0].day === day ? cur[0].n : 0;
          r.s.extra = [{ day, n: Math.min(60, had + n) }, Math.max(ts, cur ? cur[1] + 1 : 0)];
          await this.put(r); this.tell(r);
        }
      }
    } else if (m.t === 'forget') {
      if (!this.pinOk(ws, a, m.pin)) return;
      const id = m.id; if (typeof id !== 'string' || !this.devs.has(id) || this.online(id)) return;
      this.devs.delete(id); await this.state.storage.delete('d:' + id);
      this.toWatchers({ t: 'gone', id });
    }
  }

  async webSocketClose(ws) { await this.left(ws); }
  async webSocketError(ws) { await this.left(ws); }
  async left(ws) {
    const a = ws.deserializeAttachment(); if (!a || a.gone) return;
    a.gone = true; ws.serializeAttachment(a);
    try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    if (!a.dev) return;
    await this.load();
    const r = this.devs.get(a.dev); if (!r) return;
    r.seen = Date.now();
    if (!this.online(r.id)) { await this.put(r); this.tell(r, false); }
  }
}
