# 08 — Bot versus Analysis AI

There is one trained neural network with two callers, not two separately trained
intelligences. Neither feature can view the hidden dealer card.

| Question | Neural network bot | Strategy assistant |
| --- | --- | --- |
| Whose hand? | Its own bot hand | Requesting human's hand |
| When called? | Automatically on a bot turn | Human clicks Analyze my hand |
| Prediction source | Internal FastAPI model | Same internal FastAPI model |
| Who executes the action? | Backend automatically | Human explicitly chooses |
| Can it change human cards itself? | No | No |
| On outage | Turn pauses; visible Retry AI | Visible error; human can still act |

## Shared feature preparation

The backend function `predictionFeatures(playerHand, dealerUpcard)` calculates
the total, numeric visible card, usable-Ace flag, and card count. Both callers use
that function and `createAiClient`. React cannot submit a fictional high total
or dealer card to influence an official assistant request.

```js
const recommendation = await predict(
  predictionFeatures(player.hand, game.dealerHand[0])
);
```

The second dealer card is not passed. FastAPI receives four numbers, not the
complete internal game object.

## Automatic bot loop

`runBotsAndSave` reads the active participant. For a bot it requests inference
and passes the returned HIT or STAND to `processHit` or `processStand`. A HIT that
does not reach 21 leaves that bot active, so the loop asks the model again using
the new hand. A stand, bust, or 21 advances the engine. Once a human is active,
the loop returns and waits for human input.

If the model request fails, the bot remains paused. A Retry AI request tries the
model again. There is no hidden random/basic-strategy replacement. The game
engine still checks legal turns and ends a hand at 21 regardless of what an AI
might have predicted for a terminal state.

## Advisory human flow

`singleAdvice` or `roomAdvice` verifies the human's active turn and current round
revision, asks the same model, and returns the recommendation tagged with that
round/revision. It never calls a HIT/STAND function. The frontend clears advice
after state changes and displays a deliberate “Play hit/stand” button. Clicking
that button is an ordinary human action and is checked again by the backend.

## What the explanation means

The action comes from the network's largest output score. A separate reference
function supplies a comparison. `explain_prediction` describes agreement or
disagreement. It does not inspect hidden-neuron reasoning or guarantee the move
is optimal. If the reference says HIT and the network says STAND, the response
retains the model's STAND and clearly discloses the disagreement.

The two Softmax scores add to approximately one. Displaying them as percentages
does not make them calibrated chances of winning; the UI labels them preference
scores and explains the distinction.

## Exercise

Stop FastAPI during a disposable game containing a bot. Stand as the human and
observe the paused bot. Restart FastAPI and use Retry AI. Repeat by asking advice
without bots: advice fails visibly, but a human can still select a legal action.
Explain why the outage policies differ while using the same model.
