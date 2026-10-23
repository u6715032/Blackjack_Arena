"""Seeded offline simulation. It is evidence of this simulator, not a win guarantee."""
import json
import random
from pathlib import Path
import numpy as np
import torch
from blackjack_ai_api import load_model
from blackjack_nn import SHOE, basic_strategy, hand_value
from expanded_states import make_expanded_dataset, normalize_expanded

BASE = Path(__file__).resolve().parent

def natural(hand):
    return len(hand) == 2 and hand_value(hand)[0] == 21

def result(player, dealer):
    player_total, _ = hand_value(player)
    dealer_total, _ = hand_value(dealer)
    if player_total > 21:
        return "loss"
    if natural(player):
        return "push" if natural(dealer) else "win"
    if natural(dealer):
        return "loss"
    if dealer_total > 21 or player_total > dealer_total:
        return "win"
    return "push" if player_total == dealer_total else "loss"

def simulate(policy, rounds=10000, seed=2026):
    rng = random.Random(seed)
    counts = {"win": 0, "loss": 0, "push": 0}
    actions = 0
    largest_hand = 0
    for _ in range(rounds):
        shoe = list(SHOE)
        rng.shuffle(shoe)
        player = [shoe.pop()]
        dealer = [shoe.pop()]
        player.append(shoe.pop())
        dealer.append(shoe.pop())
        if not natural(player) and not natural(dealer):
            while hand_value(player)[0] < 21:
                total, soft = hand_value(player)
                action = policy((total, dealer[0], soft, len(player)))
                actions += 1
                if action == 0:
                    break
                player.append(shoe.pop())
        if not natural(dealer):
            while hand_value(dealer)[0] < 17:
                dealer.append(shoe.pop())
        largest_hand = max(largest_hand, len(player))
        counts[result(player, dealer)] += 1
    return {"rounds": rounds, "seed": seed, "outcomes": counts,
            "decision_count": actions, "largest_player_hand_observed": largest_hand,
            "win_fraction": counts["win"] / rounds}

if __name__ == "__main__":
    raw, _ = make_expanded_dataset()
    network = load_model(BASE / "models/expanded/blackjack_nn.pt")
    with torch.inference_mode():
        decisions = network(torch.from_numpy(normalize_expanded(raw))).numpy().argmax(axis=1)
    # Cache real forward-pass decisions to make offline evaluation fast. Live bots
    # still call FastAPI on each turn; this table is never used by the application.
    model_decisions = {tuple(int(value) for value in state): int(action) for state, action in zip(raw, decisions)}
    report = {"neural_network": simulate(lambda state: model_decisions[state]),
              "reference": simulate(lambda state: basic_strategy(*state[:3])),
              "interpretation": "10,000 seeded single-hand rounds per policy with a fresh six-deck shoe each round. The same seed starts each policy, but different actions change card consumption. No money, no continuous learning, no claim of statistical significance or optimal strategy."}
    (BASE / "models/expanded/simulation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
