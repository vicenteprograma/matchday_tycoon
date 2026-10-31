'use strict';
// Football Matchday server: serves the page and runs one WebSocket game room per invite code.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const R = require('../src/rules.js');
const { applyAction, publicState, cleanName } = require('./game.js');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 200;
const ROOM_TTL_DAYS = Number(process.env.ROOM_TTL_DAYS) || 30;
const STORE = path.join(DATA_DIR, 'rooms.json');
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const STATIC = {
  '/': ['web/index.html', 'text/html; charset=utf-8'],
  '/index.html': ['web/index.html', 'text/html; charset=utf-8'],
  '/rules.js': ['src/rules.js', 'text/javascript; charset=utf-8'],
};

/** rooms: code -> { state, touched } */
const rooms = new Map();
/** every open socket: ws -> { room, uid } */
const conns = new Map();

/* ---------- saving ---------- */
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    const cutoff = Date.now() - ROOM_TTL_DAYS * 86400000;
    for (const [code, r] of Object.entries(raw)) {
      if (r && r.state && r.state.rv === R.RV && r.touched > cutoff) rooms.set(code, r);
    }
    console.log(`Loaded ${rooms.size} saved room(s).`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Could not read saved rooms, starting empty:', e.message);
  }
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = STORE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(rooms)));
      fs.renameSync(tmp, STORE);
    } catch (e) { console.error('Could not save rooms:', e.message); }
  }, 400);
}

/* ---------- rooms ---------- */
function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let c = '';
    const b = crypto.randomBytes(5);
    for (let i = 0; i < 5; i++) c += CODE_CHARS[b[i] % CODE_CHARS.length];
    if (!rooms.has(c)) return c;
  }
  return null;
}
const uidOf = (token) => crypto.createHash('sha256').update('matchday:' + token).digest('hex').slice(0, 24);
const goodToken = (t) => typeof t === 'string' && t.length >= 16 && t.length <= 128;

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(code) {
  const r = rooms.get(code);
  if (!r) return;
  for (const [ws, c] of conns) {
    if (c.room === code) send(ws, { t: 'state', code, state: publicState(r.state, c.uid) });
  }
}
function touch(r) { r.touched = Date.now(); save(); }

function handle(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return send(ws, { t: 'error', code: 'bad_json' }); }
  if (!msg || typeof msg !== 'object') return send(ws, { t: 'error', code: 'bad_message' });
  const c = conns.get(ws);

  if (msg.t === 'create' || msg.t === 'join') {
    if (!goodToken(msg.token)) return send(ws, { t: 'error', code: 'bad_token' });
    const uid = uidOf(msg.token);
    const name = cleanName(msg.name, 'Player');
    if (msg.t === 'create') {
      if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', code: 'too_many_rooms' });
      const code = newCode();
      if (!code) return send(ws, { t: 'error', code: 'too_many_rooms' });
      const state = R.newLobby(uid);
      state.players[0].name = name;
      const r = { state, touched: Date.now() };
      rooms.set(code, r);
      conns.set(ws, { room: code, uid });
      save();
      return broadcast(code);
    }
    const code = String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const r = rooms.get(code);
    if (!r) return send(ws, { t: 'error', code: 'no_room' });
    conns.set(ws, { room: code, uid });
    const res = applyAction(r.state, uid, { a: 'join', name });
    if (res.ok) { r.state.v = (r.state.v || 0) + 1; touch(r); }
    else send(ws, { t: 'notice', code: res.error }); // e.g. match already started: you watch instead
    return broadcast(code);
  }

  if (msg.t === 'do') {
    if (!c) return send(ws, { t: 'error', code: 'not_in_room' });
    const r = rooms.get(c.room);
    if (!r) return send(ws, { t: 'error', code: 'no_room' });
    // Work on a copy so a rejected or half-applied action can never leave the room in a bad state.
    const copy = JSON.parse(JSON.stringify(r.state));
    let res;
    try { res = applyAction(copy, c.uid, msg); } catch (e) { console.error('action failed', msg.a, e); res = { error: 'server_error' }; }
    if (!res.ok) return send(ws, { t: 'rejected', a: msg.a, code: res.error });
    copy.v = (copy.v || 0) + 1;
    r.state = copy;
    touch(r);
    return broadcast(c.room);
  }
  send(ws, { t: 'error', code: 'unknown_message' });
}

/* ---------- http and websockets ---------- */
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  const hit = STATIC[url];
  if (!hit) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
  fs.readFile(path.join(__dirname, '..', hit[0]), (err, buf) => {
    if (err) { res.writeHead(500, { 'content-type': 'text/plain' }); return res.end('Server error'); }
    res.writeHead(200, { 'content-type': hit[1], 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    // Basic flood guard: at most 20 messages per second per connection.
    const now = Date.now();
    ws.win = (ws.win || []).filter((t) => now - t < 1000);
    if (ws.win.length >= 20) return;
    ws.win.push(now);
    handle(ws, data.toString());
  });
  ws.on('close', () => { conns.delete(ws); });
  ws.on('error', () => { conns.delete(ws); });
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000).unref();

function shutdown() {
  console.log('Shutting down, saving rooms.');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(Object.fromEntries(rooms)));
  } catch (e) { console.error(e.message); }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (require.main === module) {
  load();
  server.listen(PORT, () => console.log(`Football Matchday listening on port ${PORT}`));
}
module.exports = { server, rooms, load };
