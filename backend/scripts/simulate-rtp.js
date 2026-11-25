// Monte Carlo illustration, not an exact theoretical RTP. Uses fresh unbiased shoes.
import {
  createRound,
  processHit,
  processStand,
  isNaturalBlackjack,
} from "../src/game/engine.js";
import { payout } from "../src/services/betting.js";

const trials = Number(process.argv[2] || 10000);
if (!Number.isSafeInteger(trials) || trials < 1 || trials > 1000000)
  throw new Error("Choose 1 to 1,000,000 trials.");
const stake = 10;
let wins = 0,
  pushes = 0,
  standard = 0,
  boost = 0;
for (let i = 0; i < trials; i++) {
  const game = createRound(
    [{ id: "simulation", username: "Simulation" }],
    "single",
  );
  while (game.status === "playing") {
    const player = game.players[0];
    const total = player.hand.reduce(
      (sum, card) =>
        sum +
        (card.rank === "A"
          ? 1
          : ["J", "Q", "K"].includes(card.rank)
            ? 10
            : Number(card.rank)),
      0,
    );
    const best =
      total +
      (player.hand.some((card) => card.rank === "A") && total + 10 <= 21
        ? 10
        : 0);
    if (best < 17) processHit(game, "simulation");
    else processStand(game, "simulation");
  }
  const player = game.players[0];
  if (player.result === "win") wins++;
  if (player.result === "push") pushes++;
  standard += payout(stake, player.result, isNaturalBlackjack(player.hand));
  boost += payout(
    stake,
    player.result,
    isNaturalBlackjack(player.hand),
    "experimental-boost-v1",
  );
}
console.log(
  JSON.stringify(
    {
      trials,
      stake,
      strategy: "hit below 17; stand otherwise",
      winPercentage: (wins / trials) * 100,
      pushPercentage: (pushes / trials) * 100,
      standardEstimatedRtp: (standard / (stake * trials)) * 100,
      experimentalEstimatedRtp: (boost / (stake * trials)) * 100,
      note: "Monte Carlo estimates; random sampling error applies, and results depend on player strategy and wager rounding.",
    },
    null,
    2,
  ),
);
