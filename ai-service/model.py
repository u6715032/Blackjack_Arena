"""Shared Blackjack features, labels, networks, and checkpoint utilities.

TensorFlow is imported only when building a training model. Serving predictions
needs NumPy and PyTorch, without loading TensorFlow into the API process.
"""

from collections import deque
from pathlib import Path

import numpy as np
import torch
from torch import nn

LABELS = ("STAND", "HIT")
SEED = 42
ARCHITECTURE = [4, 16, 8, 2]
MIN_CARDS = 2
MAX_CARDS = 20
SCALES = [21.0, 11.0, 1.0, float(MAX_CARDS)]
FEATURE_ORDER = ["player_total", "dealer_upcard", "usable_ace", "cards_in_hand"]
DATASET_VERSION = "reachable-s17-hit-stand-v1"
MODEL_DIRECTORY = Path(__file__).resolve().parent / "models"


def hand_value(cards):
    """Return the best total and a 0/1 usable-Ace flag; input Aces have value 11."""
    total = sum(1 if card == 11 else card for card in cards)
    if 11 in cards and total + 10 <= 21:
        return total + 10, 1
    return total, 0


def basic_strategy(total, dealer, soft):
    """Reference labels for six-deck S17 HIT/STAND; never a live AI fallback."""
    if total >= 21:
        return 0
    if soft:
        if total >= 19:
            return 0
        if total == 18:
            return 0 if dealer <= 8 else 1
        return 1
    if total >= 17:
        return 0
    if total >= 13:
        return 0 if dealer <= 6 else 1
    if total == 12:
        return 0 if 4 <= dealer <= 6 else 1
    return 1


def reachable_hands():
    """Keep one real hand per (minimum total, Ace presence, card count).

    Those three values determine future scoring, so equivalent hands do not
    need exploring again. Any non-busting hand uses fewer than the 24 copies
    of each rank in six decks, leaving every dealer upcard available.
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
        if len(cards) >= MIN_CARDS:
            hands.append(cards)
        # The game ends a hand at 21; do not generate impossible later turns.
        if len(cards) >= MIN_CARDS and total >= 21:
            continue
        for value in (11, 2, 3, 4, 5, 6, 7, 8, 9, 10):
            pending.append(cards + [value])
    return hands


def make_dataset():
    """Enumerate distinct reachable feature tuples and their supervised labels."""
    states = set()
    for hand in reachable_hands():
        total, soft = hand_value(hand)
        for dealer in range(2, 12):
            states.add((total, dealer, soft, len(hand)))
    raw = np.array(sorted(states), dtype=np.int32)
    if int(raw[:, 3].max()) != MAX_CARDS:
        raise ValueError("Generated card coverage does not match model metadata.")
    labels = np.array([
        basic_strategy(int(total), int(dealer), int(soft))
        for total, dealer, soft, _ in raw
    ], dtype=np.int32)
    return raw, labels


def normalize(raw):
    """Use these exact fixed scales in training, export verification, and serving."""
    return np.asarray(raw, dtype=np.float32).reshape(-1, 4) / np.array(SCALES, dtype=np.float32)


def stratified_split(labels, seed=SEED):
    """Disjoint 70/15/15 train/validation/test indices, stratified by action."""
    random_generator = np.random.default_rng(seed)
    splits = [[], [], []]
    for label in (0, 1):
        indices = np.flatnonzero(labels == label)
        random_generator.shuffle(indices)
        train_end = int(0.70 * len(indices))
        validation_end = int(0.85 * len(indices))
        parts = (indices[:train_end], indices[train_end:validation_end], indices[validation_end:])
        for group, part in zip(splits, parts):
            group.extend(part.tolist())
    return [random_generator.permutation(np.array(part, dtype=np.int64)) for part in splits]


class BlackjackNetwork(nn.Module):
    """The deployed 234-parameter classifier; checkpoint layer names stay stable."""

    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(4, 16)
        self.fc2 = nn.Linear(16, 8)
        self.out = nn.Linear(8, 2)

    def forward(self, features):
        features = torch.relu(self.fc1(features))
        features = torch.relu(self.fc2(features))
        return torch.softmax(self.out(features), dim=1)


def build_keras_model():
    """Build the matching TensorFlow network for offline supervised training."""
    import tensorflow as tf

    network = tf.keras.Sequential([
        tf.keras.Input(shape=(4,), name="state"),
        tf.keras.layers.Dense(16, activation="relu", name="hidden1"),
        tf.keras.layers.Dense(8, activation="relu", name="hidden2"),
        tf.keras.layers.Dense(2, activation="softmax", name="action"),
    ], name="blackjack_mlp")
    network.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return network


def checkpoint_metadata():
    return {
        "architecture": ARCHITECTURE,
        "labels": list(LABELS),
        "feature_order": FEATURE_ORDER,
        "scales": SCALES,
        "minimum_cards": MIN_CARDS,
        "maximum_cards": MAX_CARDS,
        "dataset_version": DATASET_VERSION,
    }


def load_model(path):
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError("Trained model missing. Run python train.py in ai-service.")
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    for key, value in checkpoint_metadata().items():
        if checkpoint.get(key) != value:
            raise ValueError(f"Incompatible model metadata: {key}.")
    network = BlackjackNetwork()
    network.load_state_dict(checkpoint["state_dict"], strict=True)
    if not all(torch.isfinite(parameter).all() for parameter in network.parameters()):
        raise ValueError("Model weights contain non-finite values.")
    network.eval()
    return network


def export_to_pytorch(keras_model, path, normalized_states):
    """Copy actual learned weights and verify the conversion before saving."""
    network = BlackjackNetwork()
    layer_pairs = (("hidden1", network.fc1), ("hidden2", network.fc2), ("action", network.out))
    with torch.no_grad():
        for keras_name, pytorch_layer in layer_pairs:
            kernel, bias = keras_model.get_layer(keras_name).get_weights()
            # Dense stores [input, output]; Linear stores [output, input].
            pytorch_layer.weight.copy_(torch.from_numpy(kernel.T.copy()))
            pytorch_layer.bias.copy_(torch.from_numpy(bias.copy()))
    network.eval()
    with torch.inference_mode():
        pytorch_scores = network(torch.from_numpy(normalized_states)).numpy()
    keras_scores = keras_model(normalized_states, training=False).numpy()
    maximum_error = float(np.max(np.abs(pytorch_scores - keras_scores)))
    if maximum_error > 1e-5:
        raise ValueError(f"TensorFlow/PyTorch conversion mismatch: {maximum_error}.")
    if not np.array_equal(pytorch_scores.argmax(axis=1), keras_scores.argmax(axis=1)):
        raise ValueError("TensorFlow/PyTorch conversion changed predicted actions.")
    torch.save({"state_dict": network.state_dict(), **checkpoint_metadata()}, path)
    return maximum_error


# The API uses membership here to reject impossible total/Ace/count combinations.
VALID_STATES = {
    tuple(int(value) for value in state) for state in make_dataset()[0]
}
