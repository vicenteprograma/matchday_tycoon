# Matchday Tycoon

A football-themed property trading board game for two to six players, played in the browser. Buy stadiums and players, collect rent, build stands and trophies, and bankrupt your rivals.

The grounds are real football stadiums; the players are invented.

## Run it

With Docker:

```
docker compose up --build
```

Then open http://localhost:3000, enter a name and press **Create a match**. Send the link, or the five-letter code, to the people you want to play with. Each person opens it, enters a name, and takes a seat.

Without Docker (Node 18 or newer):

```
npm ci
npm start
```

Alone, press **Add practice seat** to control extra players yourself, or **Add AI player** to seat a computer opponent that rolls, buys, bids, builds, answers trade offers and ends its own turn. Pick **Easy**, **Medium** or **Hard** first. Hard is the original AI. Medium sits between the two: it skips some purchases, keeps more cash back, stops bidding sooner, accepts somewhat worse trades and builds only rarely. In bot-against-bot test games, Hard beats Medium about four times in five. Easy buys only half the time, never builds, never pays to leave the Dugout, and accepts lopsided trades. The settings are in the `LEVELS` table at the top of `server/bot.js`.

## Saved matches

The server keeps every match in one file, `rooms.json`, inside its data folder (`/data` in the container, `./data` when run directly). It is written a moment after each move and when the server stops, so a restart picks matches up where they were. Players get their seat back because the browser remembers a private token. Matches nobody has touched for 30 days are removed at start-up.

Settings, all optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `/data` in Docker | Where `rooms.json` is saved |
| `MAX_ROOMS` | `200` | Most matches kept at once |
| `ROOM_TTL_DAYS` | `30` | Days of inactivity before a saved match is deleted |

## Putting it on TrueNAS

The image has no secrets and one writable folder. In outline:

1. Build the image from the `Dockerfile` (or build it on another machine and push it to a registry TrueNAS can reach).
2. Run it as a container or compose app with port 3000 published.
3. Mount a dataset at `/data` so matches survive updates. The container runs as user id 1000 (`node`), so that dataset must be writable by it.
4. If you put it behind a reverse proxy, the proxy must pass WebSocket connections on `/ws`.

There are no accounts. Anyone who has a match's code can sit at the table, so keep it on your own network or behind a VPN or a proxy that asks for a login if it is reachable from the internet. A match that has already started can only be watched, not joined.

## How it fits together

| Path | What it is |
| --- | --- |
| `src/rules.js` | The game rules as plain functions on a state object. No browser or network code. Runs on the server and in the page. **This is the source of truth for the rules.** |
| `server/index.js` | HTTP and WebSocket server. Holds the rooms, saves them, and sends each player their own view of the state. |
| `server/game.js` | Checks that a player is allowed to make a move, then applies it with `src/rules.js`. |
| `web/index.html` | The page. Draws the board and sends moves to the server. It never decides what is legal. |
| `test/` | Rules tests, random full-game simulations, and tests that drive the real server over WebSockets. |
| `prototype/football-matchday.html` | The first single-page version, built as a Claude artifact with its own copy of the rules. Kept for reference. It no longer receives rule changes. |

The server is the authority: the page sends a request such as `roll` or `bid`, the server checks who sent it and whether it is legal, and everyone receives the new state. Other players' private tokens and the order of the card decks never leave the server.

## Tests

```
npm test
```

No setup needed beyond `npm ci`.

## The rules

- Everyone starts with £1,500. Roll two dice and move. Doubles roll again, and a third double sends you to the Dugout.
- Land on an unowned ground and you may buy it. If you decline, or cannot pay, it is auctioned (£10, £50 or £100 bids, or drop out).
- Own every ground in a league and rent doubles. Then build evenly across it: four stands (trophies on players), then a Grand Stadium (Legend status on players). The bank holds 32 small upgrades and 12 big ones.
- Build and sell (for half) only on your own turn. Mortgage and lift mortgages at any time, even on other players' turns. Lifting a mortgage costs the mortgage value plus 10%. Receiving a mortgaged ground costs a 10% bank fee.
- Coach lines pay £25, £50, £100, £200. Utilities pay 4 times the dice, or 10 times with both.
- Half-Time: with three or more players, pay £20 into the pot. If a different player paid in earlier, you collect the pot first. With two players, nothing happens.
- The Dugout: pay £50, use a Get-out card, or roll doubles. After three failed turns you pay £50 and move.
- Transfer Window and Fan Club decks have 16 cards each.
- Trades: swap grounds and cash. Grounds in a league with stands cannot be traded.
- Out of cash means selling stands, then mortgaging, then bankruptcy. Assets go to the creditor, or to auction if the bank was owed.

Not included yet: auctions when two players want the last stands, and selling Get-out cards.
