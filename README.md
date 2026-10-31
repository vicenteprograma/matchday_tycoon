# Football Matchday

A football-themed property trading board game for two to six players. Buy stadiums and players, collect rent, build stands and trophies, and bankrupt your rivals.

Everything on the board is original: the stadiums are invented, and so are the players.

## What is here

| Path | What it is |
| --- | --- |
| `prototype/football-matchday.html` | The playable prototype. A single page that was built and published as a Claude artifact, where it keeps its match in a shared database. Outside Claude it loads but cannot start a match. |
| `src/rules.js` | The game rules as plain functions on a state object. No browser or network code. Generated from the prototype by `npm run sync`. |
| `test/rules.test.js` | Rules tests and random full-game simulations that check the state stays consistent. |
| `scripts/sync-rules.js` | Copies the rules block out of the prototype into `src/rules.js`. |

## Running the tests

Needs Node 18 or newer. There are no dependencies.

```
npm test
```

## How the rules work

- Everyone starts with £1,500. Roll two dice and move. Doubles roll again, and a third double sends you to the Dugout.
- Land on an unowned ground and you may buy it. If you decline, or cannot pay, it is auctioned (£10, £50 or £100 bids, or drop out).
- Own every ground in a league and rent doubles. Then build evenly across it: four stands (trophies on players), then a Grand Stadium (Legend status on players). The bank holds 32 small upgrades and 12 big ones.
- Build, sell (for half) and mortgage at any time, even on other players' turns. Lifting a mortgage costs the mortgage value plus 10%. Receiving a mortgaged ground costs a 10% bank fee.
- Coach lines pay £25, £50, £100, £200. Utilities pay 4 times the dice, or 10 times with both.
- Half-Time: with three or more players, pay £20 into the pot. If a different player paid in earlier, you collect the pot first. With two players, nothing happens.
- The Dugout: pay £50, use a Get-out card, or roll doubles. After three failed turns you pay £50 and move.
- Transfer Window and Fan Club decks have 16 cards each.
- Trades: swap grounds and cash. Grounds in a league with stands cannot be traded.
- Out of cash means selling stands, then mortgaging, then bankruptcy. Assets go to the creditor, or to auction if the bank was owed.

Not included yet: auctions when two players want the last stands, and selling Get-out cards.

## Plan for the online version

The aim is a server that lets people play from different places. The prototype leans on Claude's shared database for the one thing a server must do itself: decide whose move is valid, and tell everyone what happened.

1. **Server owns the state.** Run `src/rules.js` on the server. Clients send an action (`roll`, `buy`, `bid`, `offer` and so on) and receive the new state. The rules functions already work this way: take a state, apply one action, return the changed state.
2. **Identity.** Decide how people join: an invite link to a room is the simplest, accounts can come later.
3. **Realtime.** WebSockets so every player sees moves as they happen.
4. **Hidden information.** Nothing is hidden in this game apart from the card deck order, which the server keeps.
5. **Persistence.** Save each room's state so a match survives a restart.
6. **Client.** Reuse the prototype's board and panels, replacing its database calls with the socket.
