'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/rules.js');

const pick = (a) => a[Math.floor(Math.random() * a.length)];

function newGame(n) {
  const s = R.newLobby('host');
  for (let i = 1; i < n; i++) s.players.push({ hot: true, hn: 'p' + i });
  R.startGame(s);
  return s;
}

/** Roll with fixed dice by stubbing Math.random: each die is 1 + floor(r * 6). */
function rollWith(s, d1, d2) {
  const orig = Math.random;
  const seq = [(d1 - 1) / 6 + 0.01, (d2 - 1) / 6 + 0.01];
  Math.random = () => (seq.length ? seq.shift() : orig());
  try { R.doRoll(s); } finally { Math.random = orig; }
}

function checkInvariants(s) {
  for (const p of s.players) {
    assert.ok(p.cash >= 0 && !Number.isNaN(p.cash), 'cash must be a non-negative number, got ' + p.cash);
  }
  for (const k in s.own) {
    const o = s.own[k];
    assert.ok(s.players[o] && !s.players[o].bankrupt, 'ground ' + k + ' owned by missing or bankrupt player');
  }
  for (const k in s.stands) {
    assert.ok(s.own[k] !== undefined, 'stands on unowned ground ' + k);
    assert.ok(!s.mort[k], 'stands on mortgaged ground ' + k);
  }
  for (const k in s.mort) assert.ok(s.own[k] !== undefined, 'mortgage on unowned ground ' + k);
  const sup = R.supply(s);
  assert.ok(sup.small >= 0 && sup.big >= 0, 'bank supply went negative');
  assert.ok(s.pot >= 0 && s.pot % 20 === 0, 'bad Half-Time pot ' + s.pot);
  for (const d of ['chance', 'chest']) {
    const held = s.players.reduce((n, x) => n + x.jf.filter((z) => z === d).length, 0);
    assert.equal(s.deck[d].length + held, R.CARDS[d].length, d + ' deck lost or gained a card');
  }
}

function playRandomGame(nPlayers, maxSteps = 6000) {
  const s = newGame(nPlayers);
  let n = 0;
  while (s.phase === 'play' && n < maxSteps) {
    n++;
    const p = s.players[s.turn];
    if (s.stage === 'auction') {
      const a = s.auc, b = s.players[a.cur];
      const steps = [10, 50, 100].filter((x) => b.cash >= a.bid + x);
      if (Math.random() < 0.5 && steps.length) R.doBid(s, pick(steps)); else R.doFold(s);
    } else if (s.stage === 'roll') {
      if (p.inJail && p.cash > 300 && Math.random() < 0.3) R.doBail(s);
      if (p.inJail && p.jf.length && Math.random() < 0.5) R.doCard(s);
      R.doRoll(s);
    } else if (s.stage === 'buy') {
      if (Math.random() < 0.6) R.doBuy(s); else R.doPass(s);
    } else {
      const alive = s.players.map((x, i) => i).filter((i) => !s.players[i].bankrupt);
      const who = pick(alive);
      for (const i of R.owned(s, who)) {
        const r = Math.random();
        if (r < 0.5) R.doBuild(s, who, i);
        else if (r < 0.55) R.doSell(s, who, i);
        else if (r < 0.6) R.doMort(s, who, i);
        else if (r < 0.7) R.doUnmort(s, who, i);
      }
      if (!s.trade && Math.random() < 0.3) {
        const f = pick(alive), others = alive.filter((i) => i !== f);
        if (others.length) {
          const t = pick(others);
          const gs = R.owned(s, f).filter((i) => R.tradable(s, f, i)).slice(0, 1);
          const rs = R.owned(s, t).filter((i) => R.tradable(s, t, i)).slice(0, 1);
          if (R.doOffer(s, { from: f, to: t, gs, gc: Math.floor(Math.random() * 100), rs, rc: 0 })) {
            if (Math.random() < 0.7) R.doAccept(s); else R.doDropTrade(s, true);
          }
        }
      }
      R.doEnd(s);
    }
    checkInvariants(s);
  }
  return s;
}

test('board has 40 squares and both decks have 16 cards', () => {
  assert.equal(R.SQ.length, 40);
  assert.equal(R.CARDS.chance.length, 16);
  assert.equal(R.CARDS.chest.length, 16);
});

test('random games keep every invariant (2, 3, 4 and 6 players)', () => {
  for (const n of [2, 3, 4, 6]) {
    for (let g = 0; g < 60; g++) playRandomGame(n);
  }
});

test('Half-Time: pay £20 into the pot, collect a different player\'s pot, nothing with two players', () => {
  const s = newGame(3);
  const land = (pi) => {
    s.turn = pi; s.players[pi].pos = 18; s.players[pi].inJail = false;
    s.stage = 'roll'; s.dc = 0; s.dbl = false;
    rollWith(s, 1, 1); // 18 + 2 = 20, Half-Time
    s.dbl = false;
  };
  const cash0 = s.players[0].cash;
  land(0);
  assert.equal(cash0 - s.players[0].cash, 20);
  assert.equal(s.pot, 20);
  land(0); // own money is not returned to the same player
  assert.equal(s.pot, 40);
  const c1 = s.players[1].cash;
  land(1); // collects £40, pays £20
  assert.equal(s.players[1].cash - c1, 20);
  assert.equal(s.pot, 20);
  s.players[2].bankrupt = true;
  const c0 = s.players[0].cash, pot = s.pot;
  land(0);
  assert.equal(s.players[0].cash, c0, 'no payment with two players');
  assert.equal(s.pot, pot, 'pot untouched with two players');
});

test('rent doubles on a full league, then follows the stand table', () => {
  const s = newGame(2);
  const league = R.groupSq(0); // Boundary Park, Tomás Valderrama
  const first = league[0];
  s.own[first] = 0;
  assert.equal(R.rentFor(s, first, 7), R.SQ[first].r[0]);
  league.forEach((i) => { s.own[i] = 0; });
  assert.equal(R.rentFor(s, first, 7), R.SQ[first].r[0] * 2);
  s.players[0].cash = 1500;
  assert.ok(R.doBuild(s, 0, league[0]));
  assert.equal(R.canBuild(s, 0, league[0]), false, 'must build evenly');
  assert.ok(R.doBuild(s, 0, league[1]));
  assert.equal(R.rentFor(s, league[0], 7), R.SQ[league[0]].r[1]);
});

test('buildReason and sellReason explain a disabled button, and are null once the action is legal', () => {
  const s = newGame(2);
  const league = R.groupSq(0); // Boundary Park, Tomás Valderrama
  s.own[league[0]] = 0;
  assert.match(R.buildReason(s, 0, league[0]), /every ground in the league/);
  assert.equal(R.sellReason(s, 0, league[0]), 'Nothing built here to sell.');

  league.forEach((i) => { s.own[i] = 0; });
  s.players[0].cash = 0;
  assert.match(R.buildReason(s, 0, league[0]), /afford/);

  s.players[0].cash = 1500;
  assert.equal(R.buildReason(s, 0, league[0]), null, 'nothing left to explain once building is legal');
  assert.ok(R.doBuild(s, 0, league[0]));
  assert.match(R.buildReason(s, 0, league[0]), /evenly/, 'the other ground needs this level first');
  assert.equal(R.sellReason(s, 0, league[0]), null, 'selling the one you just built is fine');
});

test('coach lines pay 25, 50, 100, 200', () => {
  const s = newGame(2);
  const lines = R.SQ.map((q, i) => (q.t === 'st' ? i : -1)).filter((i) => i >= 0);
  assert.equal(lines.length, 4);
  const expect = [25, 50, 100, 200];
  lines.forEach((i, k) => { s.own[i] = 0; assert.equal(R.rentFor(s, lines[0], 7), expect[k]); });
});

test('mortgage: half price out, 55% to lift, no mortgaging with stands in the league', () => {
  const s = newGame(2);
  const i = R.groupSq(0)[0];
  s.own[i] = 0; s.players[0].cash = 100;
  assert.ok(R.doMort(s, 0, i));
  assert.equal(s.players[0].cash, 100 + R.SQ[i].p / 2);
  assert.ok(R.doUnmort(s, 0, i));
  assert.equal(s.players[0].cash, 100 + R.SQ[i].p / 2 - R.unmortCost(i));
  R.groupSq(0).forEach((j) => { s.own[j] = 0; });
  s.players[0].cash = 1000;
  R.doBuild(s, 0, R.groupSq(0)[0]);
  assert.equal(R.canMort(s, 0, R.groupSq(0)[1]), false);
});

test('the bank has 32 stands and 12 Grand Stadiums', () => {
  const s = newGame(2);
  assert.deepEqual(R.supply(s), { small: 32, big: 12 });
  // Fill the board's stands: two full leagues at 4 stands each use 4*... check the cap on building.
  s.players[0].cash = 1e6;
  let built = 0;
  for (let g = 0; g < 8; g++) R.groupSq(g).forEach((i) => { s.own[i] = 0; });
  for (let round = 0; round < 5; round++) {
    for (const i of Object.keys(s.own).map(Number)) { if (R.doBuild(s, 0, i)) built++; }
  }
  assert.ok(R.supply(s).small >= 0 && R.supply(s).big >= 0);
  assert.ok(built > 0);
});

test('unaffordable ground goes to auction, and the high bidder pays', () => {
  const s = newGame(2);
  s.turn = 0; s.players[0].pos = 0; s.players[0].cash = 10; s.stage = 'roll';
  rollWith(s, 1, 2); // lands on square 3, a ground that costs £60
  assert.equal(s.stage, 'auction');
  assert.equal(s.auc.sq, 3);
  const cashBefore = s.players.map((p) => p.cash);
  // First bidder bids £10, the other drops out: first bidder wins at £10.
  const first = s.auc.cur;
  const other = first === 0 ? 1 : 0;
  if (s.players[first].cash < 10) { R.doFold(s); assert.fail('test setup: first bidder cannot afford £10'); }
  R.doBid(s, 10);
  if (s.stage === 'auction') R.doFold(s); // the other player drops out
  assert.notEqual(s.stage, 'auction');
  assert.equal(s.own[3], first);
  assert.equal(s.players[first].cash, cashBefore[first] - 10);
  assert.equal(s.players[other].cash, cashBefore[other]);
});

test('trades move grounds and cash, and reject grounds in built leagues', () => {
  const s = newGame(2);
  const a = R.groupSq(0)[0], b = R.groupSq(1)[0];
  s.own[a] = 0; s.own[b] = 1;
  assert.ok(R.doOffer(s, { from: 0, to: 1, gs: [a], gc: 0, rs: [b], rc: 50 }));
  const c0 = s.players[0].cash, c1 = s.players[1].cash;
  assert.ok(R.doAccept(s));
  assert.equal(s.own[a], 1);
  assert.equal(s.own[b], 0);
  assert.equal(s.players[0].cash, c0 + 50);
  assert.equal(s.players[1].cash, c1 - 50);
  R.groupSq(2).forEach((i) => { s.own[i] = 0; });
  s.players[0].cash = 1000;
  R.doBuild(s, 0, R.groupSq(2)[0]);
  assert.equal(R.tradable(s, 0, R.groupSq(2)[0]), false);
});

test('the Dugout: paying £50 gets you out', () => {
  const s = newGame(2);
  s.turn = 0;
  const p = s.players[0];
  p.inJail = true; p.pos = 10; p.jt = 0; s.stage = 'roll';
  const c = p.cash;
  R.doBail(s);
  assert.equal(p.inJail, false);
  assert.equal(p.cash, c - 50);
});

test('the Dugout: three failed rolls cost £50 and move you', () => {
  const s = newGame(2);
  const p = s.players[0];
  p.inJail = true; p.pos = 10; p.jt = 0;
  const c = p.cash;
  for (let k = 0; k < 3; k++) {
    s.turn = 0; s.stage = 'roll'; s.dbl = false;
    rollWith(s, 1, 2); // never doubles
    if (k < 2) { assert.equal(p.inJail, true); assert.equal(p.pos, 10); }
  }
  assert.equal(p.inJail, false);
  assert.equal(p.pos, 13);
  assert.equal(p.cash, c - 50);
});

test('bankruptcy to the bank puts the player\'s grounds up for auction', () => {
  const s = newGame(3);
  const i = R.groupSq(7)[0]; // Alessandro Vidal, worth £175 mortgaged, not enough for £200
  s.own[i] = 0; s.players[0].cash = 0;
  s.turn = 0; s.stage = 'roll'; s.dbl = false; s.players[0].pos = 2;
  rollWith(s, 1, 1); // 2 + 2 = 4, Agent Fees (£200)
  assert.equal(s.players[0].bankrupt, true);
  assert.equal(s.stage, 'auction');
  assert.equal(s.auc.sq, i);
  assert.equal(s.own[i], undefined);
});
