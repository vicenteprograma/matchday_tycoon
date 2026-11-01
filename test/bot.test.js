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
