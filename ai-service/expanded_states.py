"""Reachable states for automatic stop at 21, without clipping inputs."""
from collections import deque
import numpy as np
from blackjack_nn import basic_strategy, hand_value

MAX_CARDS = 20
SCALES = [21.0, 11.0, 1.0, float(MAX_CARDS)]
FEATURE_ORDER = ["player_total", "dealer_upcard", "usable_ace", "cards_in_hand"]

def reachable_hands():
    """Keep one real hand per (minimum total, Ace flag, count).

    Any non-busting hand consumes fewer than the 24 copies of each rank in six
    decks. These states leave a card of every rank available for the upcard.
    Face cards are equivalent to 10. Stop at 21, as the game engine does.
    """
    pending = deque([[]])
    seen = set()
    hands = []
    while pending:
        cards = pending.popleft()
        minimum = sum(1 if card == 11 else card for card in cards)
        key = (minimum, 11 in cards, len(cards))
        if key in seen or minimum > 21:
            continue
        seen.add(key)
        total, _ = hand_value(cards)
        if len(cards) >= 2:
            hands.append(cards)
        if len(cards) >= 2 and total >= 21:
            continue
        for value in (11, 2, 3, 4, 5, 6, 7, 8, 9, 10):
            pending.append(cards + [value])
    return hands

def make_expanded_dataset():
    states = set()
    for hand in reachable_hands():
        total, soft = hand_value(hand)
        for dealer in range(2, 12):
            states.add((total, dealer, soft, len(hand)))
    raw = np.array(sorted(states), dtype=np.int32)
    assert int(raw[:, 3].max()) == MAX_CARDS
    labels = np.array([basic_strategy(int(total), int(dealer), int(soft))
                       for total, dealer, soft, _ in raw], dtype=np.int32)
    return raw, labels

def normalize_expanded(raw):
    return np.asarray(raw, dtype=np.float32).reshape(-1, 4) / np.array(SCALES, dtype=np.float32)

RAW_STATES, _ = make_expanded_dataset()
VALID_STATES = {tuple(int(value) for value in row) for row in RAW_STATES}
