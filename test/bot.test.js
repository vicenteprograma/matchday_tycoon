'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/rules.js');
const { applyAction, BOT_UID } = require('../server/game.js');
const Bot = require('../server/bot.js');

/** A match with no human seats at all, so Bot.decide always has something to do, whoever is on turn. */
function allBotGame(n) {
  const s = R.newLobby('host');
  s.players[0] = { bot: true, name: 'Bot 1' };
  for (let i = 1; i < n; i++) s.players.push({ bot: true, name: 'Bot ' + (i + 1) });
  assert.equal(applyAction(s, 'host', { a: 'start' }).ok, true);
  return s;
}

test('a lobby can seat AI players, and only the server can move them', () => {
  const s = R.newLobby('host');
  applyAction(s, 'host', { a: 'addBot' });
  assert.equal(s.players[1].bot, true);
  assert.equal(s.players[1].uid, undefined);
  applyAction(s, 'host', { a: 'addBot' });
  applyAction(s, 'host', { a: 'start' });
  s.turn = 1; s.stage = 'roll'; // force play onto a bot seat regardless of the random kick-off
  assert.equal(applyAction(s, 'host', { a: 'roll' }).error, 'not_allowed', "the host doesn't play bot seats");
  assert.equal(applyAction(s, 'someone-else', { a: 'roll' }).error, 'not_allowed');
  assert.equal(applyAction(s, BOT_UID, { a: 'roll' }).ok, true, 'the server can move the seat on turn');
});

test('Bot.decide buys when it can afford a comfortable buffer, and passes otherwise', () => {
  const s = allBotGame(2);
  s.stage = 'buy';
  s.buy = 1; // Boundary Park, £60
  s.players[s.turn].cash = 1000;
  assert.deepEqual(Bot.decide(s), { a: 'buy' });
  s.players[s.turn].cash = 120; // would leave only £60 spare
  assert.deepEqual(Bot.decide(s), { a: 'pass' });
});

test('Bot.decide uses a Get-out card before paying bail, and pays bail before stalling in the Dugout', () => {
  const s = allBotGame(2);
  const p = s.players[s.turn];
  s.stage = 'roll';
  p.inJail = true;
  p.jf = ['chance'];
  p.cash = 1000;
  assert.deepEqual(Bot.decide(s), { a: 'card' });
  p.jf = [];
  assert.deepEqual(Bot.decide(s), { a: 'bail' });
  p.cash = 90;
  assert.deepEqual(Bot.decide(s), { a: 'roll' });
});

test('Bot.decide folds an auction once the bid passes its valuation', () => {
  const s = allBotGame(2);
  s.stage = 'auction';
  s.auc = { sq: 1, bid: 0, high: null, active: [0, 1], cur: s.turn };
  s.players[s.turn].cash = 1000;
  assert.deepEqual(Bot.decide(s), { a: 'bid', inc: 10 });
  s.auc.bid = 50; // 50 is already 80%+ of the £60 list price
  assert.deepEqual(Bot.decide(s), { a: 'fold' });
});

test('Bot.decide accepts a trade offer that is at least as good as it gives, and declines a lopsided one', () => {
  const s = allBotGame(2);
  s.own = { 1: 0, 6: 1 }; // seat 0 owns sq 1 (£60), seat 1 owns sq 6 (£100)
  s.trade = { from: 0, to: 1, gs: [1], gc: 0, rs: [6], rc: 0 }; // seat 1 gives away £100 for £60
  assert.deepEqual(Bot.decide(s), { a: 'decline' });
  s.trade = { from: 0, to: 1, gs: [1], gc: 50, rs: [6], rc: 0 }; // now £110 in for £100 out
  assert.deepEqual(Bot.decide(s), { a: 'accept' });
});

test('two AI players can play a whole match to the end with no human input', () => {
  const s = allBotGame(2);
  let n = 0;
  while (s.phase === 'play' && n < 20000) {
    const action = Bot.decide(s);
    assert.ok(action, 'the bots must always have something to do in an all-bot match');
    const res = applyAction(s, BOT_UID, action);
    assert.equal(res.ok, true, 'bot action ' + action.a + ' was rejected: ' + res.error);
    for (const p of s.players) assert.ok(p.cash >= 0, 'cash went negative');
    n++;
  }
  assert.equal(s.phase, 'over', 'the match should finish within the move budget');
  assert.ok(Number.isInteger(s.winner) && !s.players[s.winner].bankrupt);
});

/* ---------- AI levels ---------- */

/** Put the seat that is about to act at a given level. */
function setLevel(s, seat, level) { s.players[seat].level = level; }

test('addBot takes a level, defaults to medium for anything else, and a reset keeps it', () => {
  const s = R.newLobby('host');
  for (const level of ['easy', 'medium', 'hard']) applyAction(s, 'host', { a: 'addBot', level });
  applyAction(s, 'host', { a: 'addBot', level: 'impossible' });
  applyAction(s, 'host', { a: 'addBot' });
  assert.deepEqual(s.players.slice(1).map((p) => p.level), ['easy', 'medium', 'hard', 'medium', 'medium']);
  assert.equal(s.players[1].name, 'Bot 1 (easy)');
  applyAction(s, 'host', { a: 'reset' });
  assert.deepEqual(s.players.slice(1).map((p) => p.level), ['easy', 'medium', 'hard', 'medium', 'medium']);
});

test('a bot with no level (saved before levels existed) plays at hard strength', () => {
  const s = allBotGame(2);
  s.stage = 'buy'; s.buy = 1; s.players[s.turn].cash = 1000;
  assert.deepEqual(Bot.decide(s, () => 0.99), { a: 'buy' });
});

test('buying: easy and medium skip some purchases and want more cash left over', () => {
  const s = allBotGame(2);
  s.stage = 'buy'; s.buy = 1; // £60
  const p = s.players[s.turn];
  p.cash = 1000;
  setLevel(s, s.turn, 'hard');
  assert.deepEqual(Bot.decide(s, () => 0.99), { a: 'buy' });
  setLevel(s, s.turn, 'easy');
  assert.deepEqual(Bot.decide(s, () => 0.4), { a: 'buy' });
  assert.deepEqual(Bot.decide(s, () => 0.6), { a: 'pass' }, 'easy passes on half its chances');
  setLevel(s, s.turn, 'medium');
  assert.deepEqual(Bot.decide(s, () => 0.5), { a: 'buy' });
  assert.deepEqual(Bot.decide(s, () => 0.7), { a: 'pass' });
  p.cash = 280; // £220 left over: fine for hard, too thin for medium (needs £250) and easy (needs £300)
  setLevel(s, s.turn, 'hard');
  assert.deepEqual(Bot.decide(s, () => 0), { a: 'buy' });
  setLevel(s, s.turn, 'medium');
  assert.deepEqual(Bot.decide(s, () => 0), { a: 'pass' });
  setLevel(s, s.turn, 'easy');
  assert.deepEqual(Bot.decide(s, () => 0), { a: 'pass' });
});

test('building: hard always builds, medium sometimes, easy never', () => {
  const s = allBotGame(2);
  const me = s.turn;
  R.groupSq(0).forEach((i) => { s.own[i] = me; }); // the whole brown league
  s.players[me].cash = 2000;
  s.stage = 'end';
  setLevel(s, me, 'hard');
  assert.equal(Bot.decide(s, () => 0.99).a, 'build');
  setLevel(s, me, 'medium');
  assert.equal(Bot.decide(s, () => 0.1).a, 'build');
  assert.equal(Bot.decide(s, () => 0.9).a, 'end');
  setLevel(s, me, 'easy');
  assert.equal(Bot.decide(s, () => 0).a, 'end');
});

test('the Dugout: easy waits for doubles instead of paying £50', () => {
  const s = allBotGame(2);
  const p = s.players[s.turn];
  s.stage = 'roll'; p.inJail = true; p.jf = []; p.cash = 1000;
  setLevel(s, s.turn, 'hard');
  assert.deepEqual(Bot.decide(s), { a: 'bail' });
  setLevel(s, s.turn, 'medium');
  assert.deepEqual(Bot.decide(s), { a: 'bail' });
  setLevel(s, s.turn, 'easy');
  assert.deepEqual(Bot.decide(s), { a: 'roll' });
  p.jf = ['chance'];
  assert.deepEqual(Bot.decide(s), { a: 'card' }, 'easy still uses a Get-out card');
});

test('auctions: easier bots stop bidding sooner', () => {
  const s = allBotGame(2);
  s.stage = 'auction';
  s.auc = { sq: 9, bid: 70, high: null, active: [0, 1], cur: s.turn }; // £120 ground
  s.players[s.turn].cash = 2000;
  setLevel(s, s.turn, 'hard');   // will go to £96
  assert.deepEqual(Bot.decide(s), { a: 'bid', inc: 10 });
  setLevel(s, s.turn, 'medium'); // will go to £60
  assert.deepEqual(Bot.decide(s), { a: 'fold' });
  s.auc.bid = 0;
  assert.deepEqual(Bot.decide(s), { a: 'bid', inc: 10 });
  s.auc.bid = 50;
  setLevel(s, s.turn, 'easy');   // will go to £48
  assert.deepEqual(Bot.decide(s), { a: 'fold' });
  s.auc.bid = 30;
  assert.deepEqual(Bot.decide(s), { a: 'bid', inc: 10 });
});

test('trades: easier bots accept worse deals', () => {
  const s = allBotGame(2);
  s.own = { 1: 0, 6: 1 }; // seat 1 would give a £100 ground for a £60 one: 60% of its worth
  s.trade = { from: 0, to: 1, gs: [1], gc: 0, rs: [6], rc: 0 };
  setLevel(s, 1, 'hard');
  assert.deepEqual(Bot.decide(s), { a: 'decline' });
  setLevel(s, 1, 'medium');
  assert.deepEqual(Bot.decide(s), { a: 'decline' });
  setLevel(s, 1, 'easy');
  assert.deepEqual(Bot.decide(s), { a: 'accept' });
});

test('matches with easy, medium and hard bots run without any rejected move', () => {
  for (let g = 0; g < 20; g++) {
    const s = R.newLobby('host');
    s.players[0] = { bot: true, level: 'easy', name: 'E' };
    s.players.push({ bot: true, level: 'medium', name: 'M' }, { bot: true, level: 'hard', name: 'H' });
    applyAction(s, 'host', { a: 'start' });
    for (let n = 0; n < 4000 && s.phase === 'play'; n++) {
      const action = Bot.decide(s);
      assert.ok(action);
      const res = applyAction(s, BOT_UID, action);
      assert.equal(res.ok, true, action.a + ' rejected: ' + res.error);
    }
  }
});
