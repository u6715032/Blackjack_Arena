import { randomInt, randomUUID } from "node:crypto";

export function createShoe() {
  const cards = [];
  for (let deck = 0; deck < 6; deck += 1) {
    for (const suit of ["clubs", "diamonds", "hearts", "spades"]) {
      for (const rank of [
        "A",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "J",
        "Q",
        "K",
      ]) {
        cards.push({ rank, suit });
      }
    }
  }
  return cards;
}

export function shuffleCards(cards) {
  const shuffled = [...cards];
  // Fisher-Yates gives every permutation equal probability. crypto avoids Math.random.
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

export function drawCard(shoe) {
  if (shoe.length === 0) throw new Error("The shoe is empty.");
  return shoe.pop();
}

export function cardValue(card) {
  if (card.rank === "A") return 11;
  return ["J", "Q", "K"].includes(card.rank) ? 10 : Number(card.rank);
}

export function calculateHandTotal(hand) {
  let total = hand.reduce(
    (sum, card) => sum + (card.rank === "A" ? 1 : cardValue(card)),
    0,
  );
  // Start every Ace at 1; at most one Ace can be raised by ten without busting.
  if (hand.some((card) => card.rank === "A") && total + 10 <= 21) total += 10;
  return total;
}

export function hasUsableAce(hand) {
  const minimum = hand.reduce(
    (sum, card) => sum + (card.rank === "A" ? 1 : cardValue(card)),
    0,
  );
  return hand.some((card) => card.rank === "A") && minimum + 10 <= 21;
}

export function isNaturalBlackjack(hand) {
  return hand.length === 2 && calculateHandTotal(hand) === 21;
}

export function determineRoundResult(playerHand, dealerHand) {
  const playerTotal = calculateHandTotal(playerHand);
  const dealerTotal = calculateHandTotal(dealerHand);
  if (playerTotal > 21) return "loss";
  if (isNaturalBlackjack(playerHand))
    return isNaturalBlackjack(dealerHand) ? "push" : "win";
  if (isNaturalBlackjack(dealerHand)) return "loss";
  if (dealerTotal > 21 || playerTotal > dealerTotal) return "win";
  return playerTotal === dealerTotal ? "push" : "loss";
}

export function executeDealerTurn(dealerHand, shoe) {
  while (calculateHandTotal(dealerHand) < 17) dealerHand.push(drawCard(shoe));
}

export function determineLegalActions(game, playerId) {
  const player = game.players[game.currentPlayerIndex];
  if (
    game.status !== "playing" ||
    player?.id !== playerId ||
    player.status !== "playing"
  )
    return [];
  return ["HIT", "STAND"];
}

function finishRound(game) {
  // A dealer natural is resolved immediately. Otherwise the fixed S17 rule runs.
  if (!isNaturalBlackjack(game.dealerHand))
    executeDealerTurn(game.dealerHand, game.shoe);
  game.status = "complete";
  game.currentPlayerIndex = -1;
  for (const player of game.players)
    player.result = determineRoundResult(player.hand, game.dealerHand);
  game.completedAt = new Date();
}

export function advanceTurn(game) {
  if (game.status !== "playing") return;
  while (
    game.currentPlayerIndex < game.players.length &&
    game.players[game.currentPlayerIndex].status !== "playing"
  ) {
    game.currentPlayerIndex += 1;
  }
  if (game.currentPlayerIndex >= game.players.length) finishRound(game);
}

export function createRound(participants, mode, suppliedShoe) {
  if (!participants.length || participants.length > 4)
    throw new Error("A round needs 1–4 participants.");
  if (
    new Set(participants.map((player) => player.id)).size !==
    participants.length
  )
    throw new Error("Player IDs must be unique.");
  const game = {
    id: randomUUID(),
    mode,
    revision: 0,
    status: "playing",
    currentPlayerIndex: 0,
    shoe: suppliedShoe ? [...suppliedShoe] : shuffleCards(createShoe()),
    players: participants.map((player) => ({
      ...player,
      hand: [],
      status: "playing",
      result: null,
    })),
    dealerHand: [],
    saved: false,
    saveError: null,
    aiError: null,
  };
  for (let card = 0; card < 2; card += 1) {
    for (const player of game.players) player.hand.push(drawCard(game.shoe));
    game.dealerHand.push(drawCard(game.shoe));
  }
  for (const player of game.players) {
    if (calculateHandTotal(player.hand) === 21) player.status = "blackjack";
  }
  if (isNaturalBlackjack(game.dealerHand)) finishRound(game);
  else advanceTurn(game);
  return game;
}

export function processHit(game, playerId) {
  if (!determineLegalActions(game, playerId).includes("HIT"))
    throw new Error("It is not your turn.");
  const player = game.players[game.currentPlayerIndex];
  player.hand.push(drawCard(game.shoe));
  const total = calculateHandTotal(player.hand);
  if (total >= 21) player.status = total > 21 ? "bust" : "stood";
  game.revision += 1;
  advanceTurn(game);
}

export function processStand(game, playerId) {
  if (!determineLegalActions(game, playerId).includes("STAND"))
    throw new Error("It is not your turn.");
  game.players[game.currentPlayerIndex].status = "stood";
  game.revision += 1;
  advanceTurn(game);
}

export function applyAction(game, playerId, action, roundId, revision) {
  if (roundId !== game.id || revision !== game.revision)
    throw new Error("The table changed. Refresh and try again.");
  if (action === "HIT") return processHit(game, playerId);
  if (action === "STAND") return processStand(game, playerId);
  throw new Error("Choose HIT or STAND.");
}

export function standDisconnectedPlayer(game, playerId) {
  if (!game || game.status !== "playing") return;
  const player = game.players.find((player) => player.id === playerId);
  if (player?.status === "playing") {
    player.status = "disconnected";
    game.revision += 1;
    advanceTurn(game);
  }
}

export function predictionFeatures(playerHand, dealerUpcard) {
  return {
    total: calculateHandTotal(playerHand),
    dealer: cardValue(dealerUpcard),
    soft: Number(hasUsableAce(playerHand)),
    cards: playerHand.length,
  };
}

export function publicGame(game) {
  if (!game) return null;
  const revealed = game.status === "complete";
  // Build an allowlist. Never serialize the internal game or shoe into an API response.
  return {
    id: game.id,
    mode: game.mode,
    revision: game.revision,
    status: game.status,
    currentPlayerId: game.players[game.currentPlayerIndex]?.id ?? null,
    players: game.players.map((player) => ({
      id: player.id,
      username: player.username,
      isBot: Boolean(player.isBot),
      hand: player.hand,
      total: calculateHandTotal(player.hand),
      soft: hasUsableAce(player.hand),
      blackjack: isNaturalBlackjack(player.hand),
      status: player.status,
      result: player.result,
    })),
    dealer: {
      hand: revealed ? game.dealerHand : [game.dealerHand[0], { hidden: true }],
      total: revealed ? calculateHandTotal(game.dealerHand) : null,
      blackjack: revealed && isNaturalBlackjack(game.dealerHand),
    },
    saved: game.saved,
    saveError: game.saveError,
    aiError: game.aiError,
  };
}
