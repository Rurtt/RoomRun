# RoomRun: tight near-miss + brave-line coins (2026-11-12)

Small change, agreed in chat with Pong 2026-11-12. Branch `fix/near-miss-brave-coins`.

## Why
- Pong played the near-miss build: "near miss doesn't feel like near miss". The text popped on normal dodges, the buzz (borrowed hit pulse) felt like a hit, and it fired on dodges that weren't close. [Pong: all three]
- Pong: "I only collect coins because it adds extra difficulty." Make that the point on purpose: coins mark the brave line, so grabbing coins and near-misses are the same skill (play close to danger). No unfair advantage from coins [Pong].

## What changed
- Near-miss window is in metres, measured from the latest point that still clears the obstacle at the kid's current speed, plus `config.nearMiss.slackMetres` = 1.5 m. Old: 0.5 s lane / 0.45 s jump after the move, which fired on almost every dodge. [Claude: metres, not seconds, because a 0.25 s time window never fires at a jog: a clearing jump at 7.2 m/s already takes >= 0.32 s]
  - Full speed: a lane dodge must start by ~1.5 m from the obstacle centre; near-miss if started within ~3 m. Jump: clears from ~2 m; near-miss within ~3.5 m.
- Near-miss sends no stick buzz. The firmware has only `hit / caught / pack / stop`; a light near-miss pulse needs a new motor code from the firmware owner. Text + sound stay.
- Bonus unchanged: +5 x combo multiplier.
- Coin rows: before 20 s (`track.braveFrom`) all in the free lane as before. After that, `track.braveChance` = 50% of coin rows run in an obstacle's lane: up to 3 m before a cart/tuk-tuk (grab, then a late dodge = near-miss), or for a jar/dog 2 coins leading in and 3 landing past it (z+3, +5, +7). Coins carry `rowZ` (their row) and `brave`.
- Not changed: combo, score (metres + coins), leaderboard, pack reward, cart coin loss.

## Checked
- 277 tests (new: dodge at 2.5 m = near-miss, 4 m = clean pass, 1 m = hit; jog-pace jump still has both near and not-near clears; brave share ~50%, never before 20 s, never on an obstacle, jump rows carry on past; coins never closer than 2 m in a lane). Build OK.
- Model sizes: tuk-tuk reaches 1.5 m from its centre, coins sit 3 m out: no visual overlap.
- Not seen in a browser, not played on sticks. Tune live with the debug panel (Backquote): `nearMiss.slackMetres`, `track.braveChance`, `track.braveFrom`.

## Stick test (Pong)
- Do normal early dodges stay quiet? Does a real close call say เฉียด! often enough to notice (target: a few per minute, not every row)?
- Do players chase the brave coins, and does it feel fair when they crash for them?
