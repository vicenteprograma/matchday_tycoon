'use strict';
// Decides the next move for a bot seat. Pure function: state in, one action out (or null if no
// bot is currently waiting on anything). No network code, so it can be tested directly.
const R = require('../src/rules.js');
const { BOT_UID, controls } = require('./game.js');

/**
 * How each AI level plays. "hard" is the original bot. Easier levels are weaker in the ways a casual
 * player is: they skip purchases, hold back cash, stop bidding early, build less, never pay to leave the
 * Dugout, and accept trades that are worse for them.
 *
 *   buyChance    chance of buying an affordable ground (otherwise it goes to auction)
 *   buffer       cash it tries to keep spare after buying, bidding, building or paying bail
 *   bid          highest auction bid, as a fraction of the ground's price
 *   build        whether it ever builds stands and trophies
 *   buildChance  chance of building when it could, each time it is asked
 *   payBail      whether it pays £50 to leave the Dugout (otherwise it waits for doubles)
 *   trade        accepts a trade when what it gets is at least this fraction of what it gives
 */
const LEVELS = {
  hard:   { buyChance: 1,    buffer: 100, bid: 0.8, build: true,  buildChance: 1,   payBail: true,  trade: 1 },
  medium: { buyChance: 0.6,  buffer: 250, bid: 0.5, build: true,  buildChance: 0.35, payBail: true,  trade: 0.75 },
  easy:   { buyChance: 0.5,  buffer: 300, bid: 0.4, build: false, buildChance: 0,   payBail: false, trade: 0.6 },
};

/** A seat with no level (saved before levels existed) plays at the original strength. */
function profileOf(s, seat) {
  const p = s.players[seat];
  return LEVELS[p && p.level] || LEVELS.hard;
}

/** `rng` returns a number in [0, 1). It is a parameter so tests can fix the dice. */
function decide(s, rng = Math.random) {
  if (s.phase !== 'play') return null;

  // A pending trade can be answered by its target seat regardless of whose turn it is.
  if (s.trade && controls(s, s.trade.to, BOT_UID)) {
    return { a: wantsTrade(s.trade, profileOf(s, s.trade.to)) ? 'accept' : 'decline' };
  }

  if (s.stage === 'auction' && s.auc && controls(s, s.auc.cur, BOT_UID)) {
    return auctionMove(s, profileOf(s, s.auc.cur));
  }

  if (!controls(s, s.turn, BOT_UID)) return null;
  const p = s.players[s.turn];
  const prof = profileOf(s, s.turn);

  if (s.stage === 'roll') {
    if (p.inJail) {
      if (p.jf.length > 0) return { a: 'card' };
      if (prof.payBail && p.cash - 50 >= prof.buffer) return { a: 'bail' };
      return { a: 'roll' };
    }
    return { a: 'roll' };
  }

  if (s.stage === 'buy') {
    const q = R.SQ[s.buy];
    const wants = p.cash - q.p >= prof.buffer && rng() < prof.buyChance;
    return { a: wants ? 'buy' : 'pass' };
  }

  if (s.stage === 'end') {
    const sq = prof.build ? pickBuild(s, s.turn, prof.buffer) : null;
    if (sq === null || rng() >= prof.buildChance) return { a: 'end' };
    return { a: 'build', seat: s.turn, sq };
  }

  return null;
}

function auctionMove(s, prof) {
  const a = s.auc, q = R.SQ[a.sq], cash = s.players[a.cur].cash;
  const maxBid = Math.floor(q.p * prof.bid); // a bot won't pay more than this much over the odds
  if (a.bid + 10 <= maxBid && cash - (a.bid + 10) >= prof.buffer) return { a: 'bid', inc: 10 };
  return { a: 'fold' };
}

/** The first affordable upgrade on a ground the bot already has a monopoly on, if any. */
function pickBuild(s, pi, buffer) {
  const p = s.players[pi];
  for (const i of R.owned(s, pi)) {
    if (!R.canBuild(s, pi, i)) continue;
    const cost = R.G[R.SQ[i].g].cost;
    if (p.cash - cost >= buffer) return i;
  }
  return null;
}

function wantsTrade(t, prof) {
  const value = (list) => list.reduce((n, i) => n + R.SQ[i].p, 0);
  const gets = value(t.gs) + t.gc;
  const gives = value(t.rs) + t.rc;
  return gets >= gives * prof.trade;
}

module.exports = { decide, LEVELS };
