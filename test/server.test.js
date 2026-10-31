'use strict';
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'matchday-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { server, rooms } = require('../server/index.js');
const { applyAction, publicState } = require('../server/game.js');
const R = require('../src/rules.js');

let port;
test.before(async () => {
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});
test.after(() => { server.close(); });

/** A tiny client: keeps the latest state and lets a test wait for the next message of a kind. */
function client(token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const c = { ws, token, state: null, code: null, inbox: [], waiters: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === 'state') { c.state = m.state; c.code = m.code; }
    c.inbox.push(m);
    c.waiters = c.waiters.filter((w) => !w(m));
  });
  c.open = new Promise((r) => ws.on('open', r));
  c.send = (o) => ws.send(JSON.stringify(o));
  c.next = (pred) => new Promise((res) => {
    const found = c.inbox.find(pred);
    if (found) { c.inbox.splice(c.inbox.indexOf(found), 1); return res(found); }
    c.waiters.push((m) => { if (pred(m)) { c.inbox.splice(c.inbox.indexOf(m), 1); res(m); return true; } return false; });
  });
  c.act = async (o) => { c.inbox.length = 0; c.send(Object.assign({ t: 'do' }, o)); return c.next((m) => m.t === 'state' || m.t === 'rejected'); };
  return c;
}
const tok = (n) => (n + 'x'.repeat(24)).slice(0, 24);

test('two people can create a room, join by code, start and play a turn', async () => {
  const host = client(tok('host')), guest = client(tok('guest'));
  await Promise.all([host.open, guest.open]);
  host.send({ t: 'create', token: host.token, name: 'Ana' });
  const created = await host.next((m) => m.t === 'state');
  const code = created.code;
  assert.match(code, /^[A-Z2-9]{5}$/);
  assert.equal(created.state.phase, 'lobby');
  assert.equal(created.state.host, 'me');

  guest.send({ t: 'join', room: code.toLowerCase(), token: guest.token, name: 'Ben' });
  await guest.next((m) => m.t === 'state');
  assert.equal(guest.state.players.length, 2);
  assert.equal(guest.state.host, 'host', 'guest is not the host');
  assert.equal(guest.state.players[1].uid, 'me');
  assert.equal(guest.state.players[0].uid, 'p0', 'other players are shown only as placeholders');
  assert.equal(guest.state.deck, undefined, 'the deck order stays on the server');

  // Only the host can start.
  let r = await guest.act({ a: 'start' });
  assert.equal(r.t, 'rejected');
  r = await host.act({ a: 'start' });
  assert.equal(r.t, 'state');
  assert.equal(host.state.phase, 'play');

  // Only the player whose turn it is can roll.
  const turnSeat = host.state.turn;
  const [mover, other] = turnSeat === 0 ? [host, guest] : [guest, host];
  await other.next((m) => m.t === 'state'); // wait for the broadcast of start
  r = await other.act({ a: 'roll' });
  assert.equal(r.t, 'rejected');
  r = await mover.act({ a: 'roll' });
  assert.equal(r.t, 'state');
  assert.ok(mover.state.log.length > 1);
  host.ws.close(); guest.ws.close();
});

test('a stranger cannot act as someone else, and bad messages are refused', async () => {
  const s = R.newLobby('u1');
  s.players[0].name = 'A';
  assert.deepEqual(applyAction(s, 'u2', { a: 'start' }), { error: 'not_allowed' });
  assert.deepEqual(applyAction(s, 'u1', { a: 'start' }), { error: 'not_allowed' }, 'needs two seats');
  assert.deepEqual(applyAction(s, 'u1', { a: 'nonsense' }), { error: 'not_playing' });
  assert.deepEqual(applyAction(s, 'u1', {}), { error: 'bad_action' });
  applyAction(s, 'u1', { a: 'addHot' });
  assert.deepEqual(applyAction(s, 'u1', { a: 'start' }), { ok: true });
  const turnUid = 'u1'; // the host plays every practice seat
  assert.deepEqual(applyAction(s, 'u2', { a: 'roll' }), { error: 'not_allowed' });
  assert.deepEqual(applyAction(s, turnUid, { a: 'build', seat: 0, sq: 'x' }), { error: 'not_allowed' });
  assert.deepEqual(applyAction(s, 'u1', { a: 'offer', from: 0, to: 1, gs: 'x', rs: [], gc: 0, rc: 0 }), { error: 'not_allowed' });
});

test('the host can play practice seats and take over a seat that has left', () => {
  const s = R.newLobby('h');
  s.players[0].name = 'Host';
  applyAction(s, 'g', { a: 'join', name: 'Guest' });
  applyAction(s, 'h', { a: 'start' });
  assert.equal(applyAction(s, 'g', { a: 'takeover', seat: 0 }).error, 'not_allowed');
  assert.deepEqual(applyAction(s, 'h', { a: 'takeover', seat: 1 }), { ok: true });
  assert.ok(s.players[1].hot && !s.players[1].uid);
  // Force the guest's seat to be on turn: the host can now roll for it.
  s.turn = 1; s.stage = 'roll';
  assert.equal(applyAction(s, 'h', { a: 'roll' }).ok, true);
});

test('a late visitor can watch but not join a running match', () => {
  const s = R.newLobby('h');
  applyAction(s, 'h', { a: 'addHot' });
  applyAction(s, 'h', { a: 'start' });
  assert.deepEqual(applyAction(s, 'late', { a: 'join', name: 'Late' }), { error: 'started' });
  const v = publicState(s, 'late');
  assert.equal(v.you, -1);
  assert.ok(v.players.every((p) => p.uid !== 'me'));
});

test('a seat is kept when the same person reconnects with the same token', async () => {
  const a = client(tok('keep1')), b = client(tok('keep2'));
  await Promise.all([a.open, b.open]);
  a.send({ t: 'create', token: a.token, name: 'One' });
  const { code } = await a.next((m) => m.t === 'state');
  b.send({ t: 'join', room: code, token: b.token, name: 'Two' });
  await b.next((m) => m.t === 'state');
  b.ws.close();
  const b2 = client(tok('keep2'));
  await b2.open;
  b2.send({ t: 'join', room: code, token: b2.token, name: 'Two' });
  await b2.next((m) => m.t === 'state');
  assert.equal(b2.state.players.length, 2, 'no duplicate seat');
  assert.equal(b2.state.you, 1);
  a.ws.close(); b2.ws.close();
});

test('unknown rooms and short tokens are refused', async () => {
  const c = client(tok('zzz'));
  await c.open;
  c.send({ t: 'join', room: 'NOPE1', token: c.token, name: 'x' });
  assert.equal((await c.next((m) => m.t === 'error')).code, 'no_room');
  c.send({ t: 'create', token: 'short', name: 'x' });
  assert.equal((await c.next((m) => m.t === 'error')).code, 'bad_token');
  c.ws.close();
  assert.ok(rooms.size >= 1);
});
