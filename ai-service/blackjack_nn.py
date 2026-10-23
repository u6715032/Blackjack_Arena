#!/usr/bin/env python3
"""Blackjack Arena: terminal-only TensorFlow neural network experiment.

Train a supervised MLP on legal, synthetic Blackjack states labeled by a
Hit/Stand-only rule baseline; save both native TensorFlow .keras and a real
PyTorch .pt checkpoint (converted from TensorFlow weights).

Install:
    python -m pip install numpy tensorflow torch
Train:
    python blackjack_nn.py train
Predict using the saved .pt file:
    python blackjack_nn.py predict --total 16 --dealer 10 --soft 0 --cards 2

Network: 4 inputs -> 16 ReLU -> 8 ReLU -> 2 softmax (234 parameters).
Class 0 = STAND, 1 = HIT. Predictions imitate a strategy baseline; this
is supervised learning, NOT reinforcement learning or a win predictor.
"""

import argparse
import os
import random
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np

LABELS = ("STAND", "HIT")
SEED = 42
# Six decks: four copies of each rank per deck, with 10/J/Q/K valued 10.
SHOE = [rank for _ in range(24) for rank in (2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 11)]


def hand_value(cards):
    """Return (best non-busting total or minimum total, has_usable_ace)."""
    total = sum(1 if card == 11 else card for card in cards)
    if 11 in cards and total + 10 <= 21:
        return total + 10, 1
    return total, 0


def basic_strategy(total, dealer, soft):
    """Reference rules for six-deck, stand-soft-17, HIT/STAND-only Blackjack."""
    if total >= 21:
        return 0  # STAND; already 21
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


def make_dataset(samples=160_000, seed=SEED):
    """Collect distinct legal player-state snapshots sampled without replacement."""
    rng = random.Random(seed)
    states = set()
    for _ in range(samples):
        # Sample a legal hand from a six-deck shoe. No betting information.
        card_count = rng.choices((2, 3, 4, 5, 6), weights=(35, 28, 19, 12, 6), k=1)[0]
        drawn = rng.sample(SHOE, card_count + 1)
        player_cards, dealer_upcard = drawn[:-1], drawn[-1]
        total, soft = hand_value(player_cards)
        if total <= 21:
            states.add((total, dealer_upcard, soft, card_count))
    if len(states) < 100:
        raise RuntimeError("Not enough unique valid states were generated.")
    raw = np.array(sorted(states), dtype=np.int32)
    labels = np.array([basic_strategy(int(t), int(d), int(s)) for t, d, s, _ in raw], dtype=np.int32)
    return raw, labels


def normalize(raw):
    """Normalize identically for both training and deployment (no fitted stats)."""
    array = np.asarray(raw, dtype=np.float32).reshape(-1, 4).copy()
    array /= np.array([21.0, 11.0, 1.0, 6.0], dtype=np.float32)
    return array


def stratified_split(labels, seed=SEED):
    """Return disjoint train/validation/test indices, stratified by label."""
    rng = np.random.default_rng(seed)
    splits = [[], [], []]
    for label in (0, 1):
        ids = np.flatnonzero(labels == label)
        rng.shuffle(ids)
        a, b = int(0.70 * len(ids)), int(0.85 * len(ids))
        for group, part in zip(splits, (ids[:a], ids[a:b], ids[b:])):
            group.extend(part.tolist())
    return [rng.permutation(np.array(part, dtype=np.int64)) for part in splits]


def build_keras_model(tf):
    model = tf.keras.Sequential([
        tf.keras.Input(shape=(4,), name="state"),
        tf.keras.layers.Dense(16, activation="relu", name="hidden1"),
        tf.keras.layers.Dense(8, activation="relu", name="hidden2"),
        tf.keras.layers.Dense(2, activation="softmax", name="action"),
    ], name="blackjack_mlp")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    assert model.count_params() == 234, model.count_params()
    return model


def torch_network(torch):
    import torch.nn as nn

    class BlackjackTorchNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.fc1 = nn.Linear(4, 16)
            self.fc2 = nn.Linear(16, 8)
            self.out = nn.Linear(8, 2)

        def forward(self, x):
            x = torch.relu(self.fc1(x))
            x = torch.relu(self.fc2(x))
            return torch.softmax(self.out(x), dim=1)

    return BlackjackTorchNet()


def export_to_pt(keras_model, target_path, test_states):
    """Copy TensorFlow Dense kernels/biases into a genuine PyTorch checkpoint."""
    import torch

    net = torch_network(torch)
    pairs = (("hidden1", net.fc1), ("hidden2", net.fc2), ("action", net.out))
    with torch.no_grad():
        for keras_name, pytorch_layer in pairs:
            kernel, bias = keras_model.get_layer(keras_name).get_weights()
            # Keras Dense uses [input, output]; PyTorch Linear uses [output, input].
            pytorch_layer.weight.copy_(torch.from_numpy(kernel.T.copy()))
            pytorch_layer.bias.copy_(torch.from_numpy(bias.copy()))
    net.eval()
    checkpoint = {
        "state_dict": net.state_dict(),
        "architecture": [4, 16, 8, 2],
        "labels": list(LABELS),
        "feature_order": ["player_total", "dealer_upcard", "usable_ace", "cards_in_hand"],
        "scales": [21.0, 11.0, 1.0, 6.0],
    }
    torch.save(checkpoint, target_path)
    # Ensure numerical agreement for actual examples before reporting success.
    with torch.no_grad():
        torch_probs = net(torch.tensor(test_states, dtype=torch.float32)).numpy()
    keras_probs = keras_model.predict(test_states, verbose=0)
    max_error = float(np.max(np.abs(torch_probs - keras_probs)))
    if max_error > 1e-5:
        raise RuntimeError(f"TensorFlow/PyTorch conversion mismatch: {max_error:.8f}")
    print(f"Converted .pt checkpoint verified (max score difference {max_error:.2e}).")


def train(args):
    import tensorflow as tf

    random.seed(SEED)
    np.random.seed(SEED)
    tf.keras.utils.set_random_seed(SEED)

    raw, labels = make_dataset(args.samples)
    train_ids, val_ids, test_ids = stratified_split(labels)
    x = normalize(raw)
    print(f"Distinct legal states: {len(raw)}")
    print(f"Train: {len(train_ids)} | validation: {len(val_ids)} | test: {len(test_ids)}")
    print(f"Labels: STAND={int((labels == 0).sum())}, HIT={int((labels == 1).sum())}")

    model = build_keras_model(tf)
    print(f"Network: 4 -> 16 -> 8 -> 2 | trainable parameters: {model.count_params()}")
    history = model.fit(
        x[train_ids], labels[train_ids],
        validation_data=(x[val_ids], labels[val_ids]),
        epochs=args.epochs,
        batch_size=32,
        verbose=2,
        callbacks=[tf.keras.callbacks.EarlyStopping(
            monitor="val_loss", patience=15, restore_best_weights=True
        )],
    )
    test_loss, test_acc = model.evaluate(x[test_ids], labels[test_ids], verbose=0)
    predicted = np.argmax(model.predict(x[test_ids], verbose=0), axis=1)
    print(f"\nTest accuracy (agreement with strategy labels): {test_acc:.2%}")
    print(f"Test cross-entropy loss: {test_loss:.4f}")
    print("Confusion matrix (rows=truth STAND/HIT; columns=predicted STAND/HIT):")
    cm = np.zeros((2, 2), dtype=int)
    for truth, pred in zip(labels[test_ids], predicted):
        cm[int(truth), int(pred)] += 1
    print(cm)
    print(f"Epochs used: {len(history.history['loss'])}")

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    keras_path = output_dir / "blackjack_nn.keras"
    pt_path = output_dir / "blackjack_nn.pt"
    model.save(str(keras_path))
    print(f"Saved native TensorFlow model: {keras_path.resolve()}")
    export_to_pt(model, pt_path, x[test_ids[: min(50, len(test_ids))]])
    print(f"Saved real PyTorch checkpoint: {pt_path.resolve()}")
    print("\nReminder: these are strategy-label predictions, NOT win probabilities.")


def predict(args):
    import torch

    raw = np.array([[args.total, args.dealer, args.soft, args.cards]], dtype=np.float32)
    if not 4 <= args.total <= 21:
        raise ValueError("Player total should be between 4 and 21.")
    if not 2 <= args.dealer <= 11:
        raise ValueError("Dealer upcard should be between 2 and 11 (Ace=11).")
    if not 2 <= args.cards <= 6:
        raise ValueError("Card count should be between 2 and 6.")
    if args.soft and args.total < 12:
        raise ValueError("A usable Ace implies a soft total of at least 12.")
    path = Path(args.output) / "blackjack_nn.pt"
    if not path.exists():
        raise FileNotFoundError(f"No model found at {path}. Run: python blackjack_nn.py train")
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    net = torch_network(torch)
    net.load_state_dict(checkpoint["state_dict"])
    net.eval()
    with torch.no_grad():
        probabilities = net(torch.from_numpy(normalize(raw))).numpy()[0]
    action = LABELS[int(np.argmax(probabilities))]
    reference = LABELS[basic_strategy(args.total, args.dealer, args.soft)]
    print(f"State: total={args.total}, dealer={args.dealer}, usable_ace={args.soft}, cards={args.cards}")
    print(f"Neural network: {action}")
    print(f"Output scores: STAND={probabilities[0]:.4f}, HIT={probabilities[1]:.4f}")
    print(f"Rule-based reference: {reference}")
    if action != reference:
        print("WARNING: neural-network output differs from the reference strategy.")
    print("Output scores are not win probabilities.")


def main():
    parser = argparse.ArgumentParser(description="Terminal-only Blackjack TensorFlow NN experiment")
    sub = parser.add_subparsers(dest="command", required=True)
    tr = sub.add_parser("train", help="Train TensorFlow NN and export .keras + .pt")
    tr.add_argument("--samples", type=int, default=160_000, help="Random hands sampled")
    tr.add_argument("--epochs", type=int, default=120, help="Maximum training epochs")
    tr.add_argument("--output", default="models", help="Output folder")
    tr.set_defaults(func=train)
    pr = sub.add_parser("predict", help="Test a state against the saved .pt file")
    pr.add_argument("--total", type=int, required=True, help="Player's best hand total")
    pr.add_argument("--dealer", type=int, required=True, help="Dealer upcard value; Ace=11")
    pr.add_argument("--soft", type=int, choices=[0, 1], required=True, help="Usable Ace 1=yes, 0=no")
    pr.add_argument("--cards", type=int, default=2, help="Number of player cards")
    pr.add_argument("--output", default="models", help="Folder containing blackjack_nn.pt")
    pr.set_defaults(func=predict)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
