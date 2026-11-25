// Little Bus Captain family-room relay: a Cloudflare Worker plus one Durable Object per room.
// Each device opens a WebSocket to /room/<code>; the room passes every message on to the others.
// It keeps nothing: no names, no logs of positions, nothing stored. A room disappears when empty.
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
