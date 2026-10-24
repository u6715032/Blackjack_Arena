"""Offline TensorFlow training, held-out evaluation, and verified PyTorch export.

From ai-service: python train.py --epochs 600
Use --output /path/to/experiment to keep the website's current weights intact.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("TF_NUM_INTRAOP_THREADS", "2")
os.environ.setdefault("TF_NUM_INTEROP_THREADS", "2")

import numpy as np
import tensorflow as tf
import torch

from model import (
    ARCHITECTURE, LABELS, MAX_CARDS, MIN_CARDS, MODEL_DIRECTORY, SCALES, SEED,
    build_keras_model, export_to_pytorch, make_dataset, normalize, stratified_split,
)


def confusion_matrix(truth, predicted):
    matrix = np.zeros((2, 2), dtype=int)
    for actual, guess in zip(truth, predicted):
        matrix[int(actual), int(guess)] += 1
    return matrix.tolist()


def make_evaluation_report(network, history, raw, labels, partitions, test_metrics, maximum_error):
    """Keep measured results together; no values are guessed or copied from old runs."""
    train_indices, validation_indices, test_indices = partitions
    test_loss, test_accuracy = test_metrics
    predicted = network(normalize(raw), training=False).numpy().argmax(axis=1)
    disagreements = np.flatnonzero(predicted != labels)
    report = {
        "seed": SEED,
        "architecture": ARCHITECTURE,
        "trainable_parameters": network.count_params(),
        "scales": SCALES,
        "card_count_range": [MIN_CARDS, MAX_CARDS],
        "distinct_reachable_states": len(raw),
        "train_states": len(train_indices),
        "validation_states": len(validation_indices),
        "test_states": len(test_indices),
        "epochs_run": len(history.history["loss"]),
        "held_out_test_accuracy": float(test_accuracy),
        "held_out_test_loss": float(test_loss),
        "test_confusion_matrix_rows_truth_columns_prediction_stand_hit": confusion_matrix(
            labels[test_indices], predicted[test_indices]
        ),
        "all_states_reference_agreement": float(np.mean(predicted == labels)),
        "all_states_disagreement_count": len(disagreements),
        "max_tensorflow_pytorch_score_difference_all_states": maximum_error,
        "tensorflow_pytorch_actions_agree_all_states": True,
        "test_accuracy_by_card_count": {},
        "example_disagreements": [],
        "versions": {
            "tensorflow": tf.__version__, "torch": str(torch.__version__), "numpy": np.__version__,
        },
        "interpretation": (
            "Accuracy measures imitation of reference labels, not win rate. "
            "Enumeration covers reachable feature tuples, not shoe compositions. "
            "Test tuples are disjoint from training. This finite feature domain "
            "is not evidence of optimality."
        ),
    }
    for count in range(MIN_CARDS, MAX_CARDS + 1):
        subset = test_indices[raw[test_indices, 3] == count]
        report["test_accuracy_by_card_count"][str(count)] = {
            "test_states": len(subset),
            "accuracy": float(np.mean(predicted[subset] == labels[subset])) if len(subset) else None,
        }
    for index in disagreements[:30]:
        report["example_disagreements"].append({
            "features": raw[index].tolist(),
            "model": LABELS[int(predicted[index])],
            "reference": LABELS[int(labels[index])],
        })
    return report


def train(epochs, output):
    if epochs < 1:
        raise ValueError("Epochs must be at least 1.")
    tf.keras.utils.set_random_seed(SEED)
    raw, labels = make_dataset()
    partitions = stratified_split(labels)
    train_indices, validation_indices, test_indices = partitions
    features = normalize(raw)
    network = build_keras_model()
    history = network.fit(
        features[train_indices], labels[train_indices],
        validation_data=(features[validation_indices], labels[validation_indices]),
        epochs=epochs, batch_size=32, verbose=2,
        callbacks=[tf.keras.callbacks.EarlyStopping(
            monitor="val_loss", patience=60, restore_best_weights=True,
        )],
    )
    test_metrics = network.evaluate(features[test_indices], labels[test_indices], verbose=0)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    network.save(output / "blackjack_nn.keras")
    maximum_error = export_to_pytorch(network, output / "blackjack_nn.pt", features)
    report = make_evaluation_report(
        network, history, raw, labels, partitions, test_metrics, maximum_error,
    )
    # Fingerprints let tests catch accidental replacement of either shipped file.
    report["artifact_sha256"] = {
        name: hashlib.sha256((output / name).read_bytes()).hexdigest()
        for name in ("blackjack_nn.pt", "blackjack_nn.keras")
    }
    (output / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: report[key] for key in (
        "held_out_test_accuracy", "held_out_test_loss", "all_states_disagreement_count",
        "max_tensorflow_pytorch_score_difference_all_states",
    )}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=600, help="Maximum training epochs")
    parser.add_argument("--output", type=Path, default=MODEL_DIRECTORY, help="Output artifact directory")
    args = parser.parse_args()
    train(args.epochs, args.output)


if __name__ == "__main__":
    main()
