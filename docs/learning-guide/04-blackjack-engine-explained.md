# 04 — Blackjack engine explained

`backend/src/game/engine.js` contains the rules. The engine has no React, database,
or HTTP dependency, so unit tests can call its functions directly.

## Cards and shoe

Each card is a small object, for example `{ rank: "A", suit: "spades" }`.
`createShoe` creates 6 × 4 × 13 = 312 objects. `shuffleCards` uses Fisher–Yates
with Node's cryptographic `randomInt`; it shuffles a copy. `drawCard` removes the
last card with `pop()` and throws if the shoe is empty. A fresh six-deck shoe is
created for each round, keeping this version's dealing easy to explain.

Dealer and player initial cards are dealt in two passes around the table.
The server does not disclose shoe order or the hidden dealer card.

## Ace algorithm

Start each Ace at 1. If there is an Ace and adding 10 would not exceed 21, raise
one Ace to 11. Two Aces cannot both be 11 without busting.

The key actual scoring condition is:

```js
if (hand.some(card => card.rank === 'A') && total + 10 <= 21) total += 10;
```

| Hand | Minimum | Best total | Usable Ace? |
| --- | --- | --- | --- |
| A, A | 2 | 12 | Yes |
| A, A, 9 | 11 | 21 | Yes |
| A, A, 9, K | 21 | 21 | No |
| A, 6 | 7 | 17 | Yes |
| K, 9, 3 | 22 | 22 (bust) | No |

`hasUsableAce` answers whether an Ace currently counts as 11, not whether any Ace
exists. This distinction is one of the neural network's four input features.

## Natural Blackjack and comparison

`isNaturalBlackjack` requires exactly two cards totaling 21. A three-card 21 is
not natural. `determineRoundResult` applies these checks in this order:

1. A bust player loses, even if the dealer also busts.
2. A player natural beats everything except a dealer natural, which pushes.
3. A dealer natural beats an ordinary player 21.
4. A dealer bust or a larger player total wins.
5. Equal qualifying totals push; otherwise the player loses.

The order prevents the common bug of treating all totals of 21 as equivalent.
There are no wagers or payout multipliers.

## Turn state

`createRound` creates `players`, `dealerHand`, `shoe`, `currentPlayerIndex`,
`status`, and `revision`. Players have `playing`, `stood`, `bust`, `blackjack`,
or `disconnected` status. A round has `playing` or `complete` status.

`determineLegalActions` returns HIT/STAND only for the active player. `processHit`
draws and recalculates; reaching 21 or busting automatically ends that turn.
`processStand` ends the turn. Both increment `revision` and call `advanceTurn`.
`advanceTurn` skips finished participants and completes the dealer when none remain.

A dealer natural resolves immediately after dealing. Otherwise
`executeDealerTurn` hits below 17 and stands at every 17, including A+6. The
dealer never calls the model. Dealer cards are then revealed, results calculated,
and the service attempts persistence.

`applyAction` verifies both round ID and revision before processing. A repeated
request with an earlier revision cannot draw twice. `publicGame` explicitly
constructs a permitted response and replaces the hidden card with a placeholder.
The dealer total is `null` while hidden because it would reveal information.

## More than six cards

The scoring and dealing engine imposes no six-card limit. The model's expanded
dataset contains reachable states up to 20 cards. A player cannot request another
move after 21; that rule limits nonterminal hands to 19 cards. See chapter 07 for
why an apparent 21-Ace example cannot occur through legal actions.

## Exercise

Write expected results on paper before running tests for A+K versus 7+7+7,
A+A+9+K, and dealer A+6. Change the dealer loop from `< 17` to `<= 17` in a local
experiment, run `npm test`, explain the failing soft-17 test, then restore the rule.
