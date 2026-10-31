'use strict';
// Turns a client message into a change to a room's state, after checking the sender is allowed to make it.
// No network code here, so it can be tested directly.
const R = require('../src/rules.js');

const MAX_SEATS = 6;

function cleanName(raw, fallback) {
  const n = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);
  return n || fallback;
}

/** Does this viewer control the seat? Humans control their own seat; the host also controls practice seats. */
function controls(s, seat, uid) {
  const p = s.players[seat];
  return !!p && !p.bankrupt && !!uid && (p.uid === uid || (!!p.hot && s.host === uid));
}

function seatOf(s, uid) {
  return s.players.findIndex((p) => p.uid && p.uid === uid);
}

function int(v, lo, hi) {
  return Number.isInteger(v) && v >= lo && v <= hi ? v : null;
}

function intList(v, max) {
  if (!Array.isArray(v) || v.length > max) return null;
  const out = [];
  for (const x of v) {
    const n = int(x, 0, 39);
    if (n === null) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

const OK = { ok: true };
const no = (error) => ({ error });

/**
 * Apply one action from the viewer `uid`. Mutates `s` only when the result is { ok: true }.
 * `msg.a` names the action. Returns { ok: true } or { error: 'reason' }.
 */
function applyAction(s, uid, msg) {
  const a = msg && msg.a;
  if (typeof a !== 'string') return no('bad_action');
  const play = s.phase === 'play';
  const turn = s.players[s.turn];

  switch (a) {
    /* ---------- lobby ---------- */
    case 'join': {
      const seat = seatOf(s, uid);
      const name = cleanName(msg.name, 'Player');
      if (seat >= 0) { s.players[seat].name = name; return OK; }
      if (s.phase !== 'lobby') return no('started');
      if (s.players.length >= MAX_SEATS) return no('full');
      s.players.push({ uid, name });
      return OK;
    }
    case 'leave': {
      const seat = seatOf(s, uid);
      if (s.phase !== 'lobby' || seat < 0 || s.host === uid) return no('not_allowed');
      s.players.splice(seat, 1);
      return OK;
    }
    case 'addHot': {
      if (s.host !== uid || s.phase !== 'lobby' || s.players.length >= MAX_SEATS) return no('not_allowed');
      const n = s.players.filter((p) => p.hot).length + 1;
      s.players.push({ hot: true, hn: 'Practice ' + n });
      return OK;
    }
    case 'remove': {
      const i = int(msg.seat, 0, MAX_SEATS - 1);
      if (s.host !== uid || s.phase !== 'lobby' || i === null || !s.players[i] || s.players[i].uid === s.host) return no('not_allowed');
      s.players.splice(i, 1);
      return OK;
    }
    case 'takeover': {
      // The host takes over a seat whose player has left, so the match is not stuck waiting.
      const i = int(msg.seat, 0, MAX_SEATS - 1);
      const p = s.players[i];
      if (s.host !== uid || i === null || !p || !p.uid || p.uid === s.host || p.bankrupt || s.phase === 'over') return no('not_allowed');
      s.players[i] = Object.assign({}, p, { hot: true, hn: (p.name || 'Player') + ' (host plays)' });
      delete s.players[i].uid;
      delete s.players[i].name;
      return OK;
    }
    case 'start': {
      if (s.host !== uid || s.phase !== 'lobby' || s.players.length < 2) return no('not_allowed');
      R.startGame(s);
      return OK;
    }
    case 'reset': {
      if (s.host !== uid) return no('not_allowed');
      const fresh = R.newLobby(s.host);
      fresh.players = s.players.map((p) => (p.hot ? { hot: true, hn: p.hn } : { uid: p.uid, name: p.name }));
      for (const k of Object.keys(s)) delete s[k];
      Object.assign(s, fresh);
      return OK;
    }
  }

  if (!play) return no('not_playing');

  switch (a) {
    /* ---------- the player whose turn it is ---------- */
    case 'roll':
      if (s.stage !== 'roll' || !controls(s, s.turn, uid)) return no('not_allowed');
      R.doRoll(s); return OK;
    case 'buy':
      if (s.stage !== 'buy' || !controls(s, s.turn, uid) || turn.cash < R.SQ[s.buy].p) return no('not_allowed');
      R.doBuy(s); return OK;
    case 'pass':
      if (s.stage !== 'buy' || !controls(s, s.turn, uid)) return no('not_allowed');
      R.doPass(s); return OK;
    case 'end':
      if (s.stage !== 'end' || !controls(s, s.turn, uid)) return no('not_allowed');
      R.doEnd(s); return OK;
    case 'bail':
      if (s.stage !== 'roll' || !turn.inJail || turn.cash < 50 || !controls(s, s.turn, uid)) return no('not_allowed');
      R.doBail(s); return OK;
    case 'card':
      if (s.stage !== 'roll' || !turn.inJail || !turn.jf.length || !controls(s, s.turn, uid)) return no('not_allowed');
      R.doCard(s); return OK;

    /* ---------- auction ---------- */
    case 'bid': {
      const inc = int(msg.inc, 10, 100);
      if (!s.auc || s.stage !== 'auction' || ![10, 50, 100].includes(inc) || !controls(s, s.auc.cur, uid)) return no('not_allowed');
      if (s.players[s.auc.cur].cash < s.auc.bid + inc) return no('too_poor');
      R.doBid(s, inc); return OK;
    }
    case 'fold':
      if (!s.auc || s.stage !== 'auction' || !controls(s, s.auc.cur, uid)) return no('not_allowed');
      R.doFold(s); return OK;

    /* ---------- any time: build, sell, mortgage ---------- */
    case 'build': case 'sell': case 'mort': case 'unmort': {
      const seat = int(msg.seat, 0, MAX_SEATS - 1);
      const sq = int(msg.sq, 0, 39);
      if (seat === null || sq === null || !controls(s, seat, uid)) return no('not_allowed');
      const fn = { build: R.doBuild, sell: R.doSell, mort: R.doMort, unmort: R.doUnmort }[a];
      return fn(s, seat, sq) ? OK : no('not_allowed');
    }

    /* ---------- trades ---------- */
    case 'offer': {
      const from = int(msg.from, 0, MAX_SEATS - 1), to = int(msg.to, 0, MAX_SEATS - 1);
      const gs = intList(msg.gs, 28), rs = intList(msg.rs, 28);
      const gc = int(msg.gc, 0, 100000), rc = int(msg.rc, 0, 100000);
      if ([from, to, gc, rc].includes(null) || !gs || !rs || !controls(s, from, uid)) return no('not_allowed');
      return R.doOffer(s, { from, to, gs, gc, rs, rc }) ? OK : no('invalid_trade');
    }
    case 'accept':
      if (!s.trade || !controls(s, s.trade.to, uid)) return no('not_allowed');
      return R.doAccept(s) ? OK : no('not_allowed');
    case 'decline':
      if (!s.trade || !controls(s, s.trade.to, uid)) return no('not_allowed');
      return R.doDropTrade(s, true) ? OK : no('not_allowed');
    case 'withdraw':
      if (!s.trade || !controls(s, s.trade.from, uid)) return no('not_allowed');
      return R.doDropTrade(s, false) ? OK : no('not_allowed');
  }
  return no('unknown_action');
}

/**
 * What one viewer is allowed to see. Other players' ids are replaced by placeholders, the deck order stays on the
 * server, and the viewer's own seat is marked 'me' so the page knows what it controls.
 */
function publicState(s, uid) {
  const you = seatOf(s, uid);
  const out = JSON.parse(JSON.stringify(s));
  delete out.deck;
  out.host = s.host === uid ? 'me' : 'host';
  out.you = you;
  out.players = out.players.map((p, i) => {
    const q = Object.assign({}, p);
    if (p.uid) q.uid = p.uid === uid ? 'me' : 'p' + i;
    return q;
  });
  return out;
}

module.exports = { applyAction, publicState, controls, seatOf, cleanName, MAX_SEATS };
