"""Actual TensorFlow training for full reachable hand coverage.

Reuses original architecture, labels, seed, Adam, loss and stratified splitting.
Original script and model artifacts stay untouched. Run: python train_expanded.py
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
from blackjack_nn import (SEED, LABELS, build_keras_model, export_to_pt,
                          normalize, stratified_split, torch_network)
from expanded_states import (FEATURE_ORDER, MAX_CARDS, SCALES,
                             make_expanded_dataset, normalize_expanded)
BASE = Path(__file__).resolve().parent

def confusion_matrix(truth, predicted):
    matrix = np.zeros((2, 2), dtype=int)
    for actual, guess in zip(truth, predicted):
        matrix[int(actual), int(guess)] += 1
    return matrix.tolist()

def verify_original(raw):
    checkpoint = torch.load(BASE / "models/blackjack_nn.pt", map_location="cpu", weights_only=True)
    network = torch_network(torch)
    network.load_state_dict(checkpoint["state_dict"])
    network.eval()
    original_keras = tf.keras.models.load_model(BASE / "models/blackjack_nn.keras", compile=False)
    features = normalize(raw[raw[:, 3] <= 6])
    with torch.inference_mode():
        torch_scores = network(torch.from_numpy(features)).numpy()
    keras_scores = original_keras(features, training=False).numpy()
    return {"parameters": sum(parameter.numel() for parameter in network.parameters()),
            "scales": checkpoint["scales"], "labels": checkpoint["labels"],
            "max_tensorflow_pytorch_difference": float(np.max(np.abs(torch_scores - keras_scores)))}

def train(epochs, output):
    tf.keras.utils.set_random_seed(SEED)
    raw, labels = make_expanded_dataset()
    train_ids, validation_ids, test_ids = stratified_split(labels)
    features = normalize_expanded(raw)
    original = verify_original(raw)
    model = build_keras_model(tf)
    history = model.fit(features[train_ids], labels[train_ids],
                        validation_data=(features[validation_ids], labels[validation_ids]),
                        epochs=epochs, batch_size=32, verbose=2,
                        callbacks=[tf.keras.callbacks.EarlyStopping(
                            monitor="val_loss", patience=60, restore_best_weights=True)])
    test_loss, test_accuracy = model.evaluate(features[test_ids], labels[test_ids], verbose=0)
    all_scores = model(features, training=False).numpy()
    predicted = all_scores.argmax(axis=1)
    output.mkdir(parents=True, exist_ok=True)
    model.save(output / "blackjack_nn.keras")
    export_to_pt(model, output / "blackjack_nn.pt", features)
    checkpoint = torch.load(output / "blackjack_nn.pt", map_location="cpu", weights_only=True)
    checkpoint.update({"scales": SCALES, "feature_order": FEATURE_ORDER,
                       "minimum_cards": 2, "maximum_cards": MAX_CARDS,
                       "dataset_version": "reachable-s17-hit-stand-v1"})
    torch.save(checkpoint, output / "blackjack_nn.pt")
    network = torch_network(torch)
    network.load_state_dict(checkpoint["state_dict"])
    network.eval()
    with torch.inference_mode():
        converted_scores = network(torch.from_numpy(features)).numpy()
    maximum_error = float(np.max(np.abs(converted_scores - all_scores)))
    assert maximum_error <= 1e-5
    assert np.array_equal(converted_scores.argmax(axis=1), predicted)
    disagreements = np.flatnonzero(predicted != labels)
    report = {
        "seed": SEED, "architecture": [4, 16, 8, 2], "trainable_parameters": model.count_params(),
        "scales": SCALES, "card_count_range": [2, MAX_CARDS],
        "distinct_reachable_states": len(raw), "train_states": len(train_ids),
        "validation_states": len(validation_ids), "test_states": len(test_ids),
        "epochs_run": len(history.history["loss"]),
        "held_out_test_accuracy": float(test_accuracy), "held_out_test_loss": float(test_loss),
        "test_confusion_matrix_rows_truth_columns_prediction_stand_hit": confusion_matrix(labels[test_ids], predicted[test_ids]),
        "all_states_reference_agreement": float(np.mean(predicted == labels)),
        "all_states_disagreement_count": len(disagreements),
        "max_tensorflow_pytorch_score_difference_all_states": maximum_error,
        "tensorflow_pytorch_actions_agree_all_states": True,
        "test_accuracy_by_card_count": {}, "example_disagreements": [],
        "original_model_inspection": original,
        "versions": {"tensorflow": tf.__version__, "torch": str(torch.__version__), "numpy": np.__version__},
        "original_sha256": {},
        "interpretation": "Accuracy measures imitation of reference labels, not win rate. Enumeration covers reachable feature tuples, not shoe compositions. Test tuples are disjoint from training. This finite feature domain is not evidence of optimality.",
    }
    for count in range(2, MAX_CARDS + 1):
        subset = test_ids[raw[test_ids, 3] == count]
        report["test_accuracy_by_card_count"][str(count)] = {
            "test_states": len(subset),
            "accuracy": float(np.mean(predicted[subset] == labels[subset])) if len(subset) else None}
    for index in disagreements[:30]:
        report["example_disagreements"].append({"features": raw[index].tolist(),
            "model": LABELS[int(predicted[index])], "reference": LABELS[int(labels[index])]})
    for name in ["blackjack_nn.py", "models/blackjack_nn.pt", "models/blackjack_nn.keras"]:
        report["original_sha256"][name] = hashlib.sha256((BASE / name).read_bytes()).hexdigest()
    (output / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: report[key] for key in ["held_out_test_accuracy", "held_out_test_loss",
          "all_states_disagreement_count", "max_tensorflow_pytorch_score_difference_all_states"]}, indent=2))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=600)
    parser.add_argument("--output", type=Path, default=BASE / "models/expanded")
    args = parser.parse_args()
    train(args.epochs, args.output)
