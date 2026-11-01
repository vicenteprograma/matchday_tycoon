'use strict';
// Decides the next move for a bot seat. Pure function: state in, one action out (or null if no
// bot is currently waiting on anything). No network code, so it can be tested directly.
const R = require('../src/rules.js');
const { BOT_UID, controls } = require('./game.js');

// Cash a bot tries to keep spare after acting, so it doesn't buy or build itself into a corner.
const BUFFER = 100;

function decide(s) {
  if (s.phase !== 'play') return null;

  // A pending trade can be answered by its target seat regardless of whose turn it is.
  if (s.trade && controls(s, s.trade.to, BOT_UID)) {
    return { a: wantsTrade(s, s.trade) ? 'accept' : 'decline' };
  }

  if (s.stage === 'auction' && s.auc && controls(s, s.auc.cur, BOT_UID)) {
    return auctionMove(s);
  }

  if (!controls(s, s.turn, BOT_UID)) return null;
  const p = s.players[s.turn];

  if (s.stage === 'roll') {
    if (p.inJail) {
      if (p.jf.length > 0) return { a: 'card' };
      if (p.cash - 50 >= BUFFER) return { a: 'bail' };
      return { a: 'roll' };
    }
    return { a: 'roll' };
  }

  if (s.stage === 'buy') {
    const q = R.SQ[s.buy];
    return { a: p.cash - q.p >= BUFFER ? 'buy' : 'pass' };
  }

  if (s.stage === 'end') {
    const sq = pickBuild(s, s.turn);
    return sq === null ? { a: 'end' } : { a: 'build', seat: s.turn, sq };
  }

  return null;
}

function auctionMove(s) {
  const a = s.auc, q = R.SQ[a.sq], cash = s.players[a.cur].cash;
  const maxBid = Math.floor(q.p * 0.8); // a bot won't pay more than this much over the odds
  if (a.bid + 10 <= maxBid && cash - (a.bid + 10) >= BUFFER) return { a: 'bid', inc: 10 };
  return { a: 'fold' };
}

/** The first affordable upgrade on a ground the bot already has a monopoly on, if any. */
function pickBuild(s, pi) {
  const p = s.players[pi];
  for (const i of R.owned(s, pi)) {
    if (!R.canBuild(s, pi, i)) continue;
    const cost = R.G[R.SQ[i].g].cost;
    if (p.cash - cost >= BUFFER) return i;
  }
  return null;
}

function wantsTrade(s, t) {
  const value = (list) => list.reduce((n, i) => n + R.SQ[i].p, 0);
  const gets = value(t.gs) + t.gc;
  const gives = value(t.rs) + t.rc;
  return gets >= gives;
}

module.exports = { decide };
