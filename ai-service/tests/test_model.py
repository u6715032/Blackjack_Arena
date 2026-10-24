"""Tests use the shipped neural network, including its known disagreements."""

import hashlib
import json

import numpy as np
import pytest
import torch
from fastapi.testclient import TestClient

import blackjack_ai_api
from blackjack_ai_api import create_app
from model import (
    LABELS, MAX_CARDS, MODEL_DIRECTORY, SCALES, hand_value,
    load_model, make_dataset, normalize, reachable_hands, stratified_split,
)

MODEL = MODEL_DIRECTORY / "blackjack_nn.pt"


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app(MODEL)) as test_client:
        yield test_client


def test_actual_model_and_metadata(client):
    assert client.get("/health").json()["card_count_range"] == [2, 20]
    network = load_model(MODEL)
    assert sum(parameter.numel() for parameter in network.parameters()) == 234
    assert not network.training
    assert LABELS == ("STAND", "HIT")


def test_preprocessing():
    np.testing.assert_allclose(normalize([[21, 11, 1, 20]]), [[1, 1, 1, 1]])
    assert SCALES == [21, 11, 1, 20]


def test_all_enumerated_hands_are_reachable_without_passing_21():
    for hand in reachable_hands():
        assert hand_value(hand)[0] <= 21
        assert len(hand) <= MAX_CARDS
        for size in range(2, len(hand)):
            assert hand_value(hand[:size])[0] < 21
        assert max(hand.count(value) for value in set(hand)) <= 24


def test_split_has_no_duplicate_tuple_leakage():
    raw, labels = make_dataset()
    train, validation, test = map(set, stratified_split(labels))
    assert not train & test and not train & validation and not test & validation
    assert len(train | validation | test) == len(raw) == 2190
    assert len(set(map(tuple, raw))) == len(raw)


@pytest.mark.parametrize("state", [
    {"total": 18, "dealer": 10, "soft": 1, "cards": 7},
    {"total": 20, "dealer": 11, "soft": 0, "cards": 19},
    {"total": 21, "dealer": 2, "soft": 0, "cards": 20},
    {"total": 16, "dealer": 10, "soft": 0, "cards": 2},
])
def test_prediction_uses_real_forward_pass(client, state):
    response = client.post("/predict", json=state)
    assert response.status_code == 200
    prediction = response.json()
    features = [[state["total"], state["dealer"], state["soft"], state["cards"]]]
    with torch.inference_mode():
        scores = load_model(MODEL)(torch.from_numpy(normalize(features))).numpy()[0]
    assert prediction["action"] == LABELS[int(scores.argmax())]
    assert prediction["scores"]["hit"] == pytest.approx(float(scores[1]))
    assert sum(prediction["scores"].values()) == pytest.approx(1)


# Captured from the serving checkpoint before the refactor, in STAND/HIT order.
@pytest.mark.parametrize("features,expected", [
    ([16, 10, 0, 2], [0.00028147775446996093, 0.9997184872627258]),
    ([18, 10, 1, 7], [0.06878963857889175, 0.9312103390693665]),
    ([20, 11, 0, 19], [1.0, 7.882694173142771e-24]),
    ([21, 2, 0, 20], [1.0, 9.607988587554942e-25]),
    ([12, 4, 0, 2], [0.4928727447986603, 0.5071272850036621]),
    ([12, 3, 0, 9], [0.5277612805366516, 0.47223877906799316]),
])
def test_captured_prediction_regressions(features, expected):
    with torch.inference_mode():
        actual = load_model(MODEL)(torch.from_numpy(normalize([features]))).numpy()[0]
    np.testing.assert_allclose(actual, expected, atol=1e-6, rtol=1e-5)
    assert int(actual.argmax()) == int(np.argmax(expected))


@pytest.mark.parametrize("changes", [
    {"total": 22}, {"total": 3}, {"dealer": 1}, {"cards": 21}, {"cards": 1},
    {"soft": 2}, {"soft": 1, "total": 10}, {"cards": 19, "total": 4},
    {"cards": "2"}, {"total": True}, {"extra": "hidden card"},
])
def test_invalid_values_rejected(client, changes):
    state = {"total": 16, "dealer": 10, "soft": 0, "cards": 2, **changes}
    assert client.post("/predict", json=state).status_code == 422


def test_missing_model_cannot_claim_ready(tmp_path):
    with pytest.raises(FileNotFoundError):
        with TestClient(create_app(tmp_path / "absent.pt")):
            pass


@pytest.mark.parametrize("field", [
    "architecture", "labels", "feature_order", "scales",
    "minimum_cards", "maximum_cards", "dataset_version",
])
def test_incompatible_metadata_cannot_claim_ready(tmp_path, field):
    checkpoint = torch.load(MODEL, map_location="cpu", weights_only=True)
    checkpoint[field] = None
    invalid_path = tmp_path / "incompatible.pt"
    torch.save(checkpoint, invalid_path)
    with pytest.raises(ValueError, match=field):
        with TestClient(create_app(invalid_path)):
            pass


def test_nonfinite_weights_are_rejected(tmp_path):
    checkpoint = torch.load(MODEL, map_location="cpu", weights_only=True)
    checkpoint["state_dict"]["fc1.weight"][0, 0] = float("nan")
    invalid_path = tmp_path / "nonfinite.pt"
    torch.save(checkpoint, invalid_path)
    with pytest.raises(ValueError, match="non-finite"):
        load_model(invalid_path)


def test_model_is_loaded_once_per_api_lifespan(monkeypatch):
    loads = []

    def counted_load(path):
        loads.append(path)
        return load_model(path)

    monkeypatch.setattr(blackjack_ai_api, "load_model", counted_load)
    with TestClient(create_app(MODEL)) as test_client:
        for _ in range(2):
            response = test_client.post("/predict", json={"total": 16, "dealer": 10, "soft": 0, "cards": 2})
            assert response.status_code == 200
    assert len(loads) == 1


def test_real_disagreements_are_disclosed(client):
    report = json.loads((MODEL_DIRECTORY / "evaluation.json").read_text())
    for example in report["example_disagreements"]:
        total, dealer, soft, cards = example["features"]
        response = client.post("/predict", json=dict(total=total, dealer=dealer, soft=soft, cards=cards)).json()
        assert not response["agrees_with_reference"]
        assert response["action"] == example["model"]
        assert response["reference_action"] == example["reference"]
        assert "disagreement" in response["explanation"]


def test_tensorflow_pytorch_parity_for_entire_feature_domain():
    import tensorflow as tf

    raw, _ = make_dataset()
    features = normalize(raw)
    keras_model = tf.keras.models.load_model(MODEL_DIRECTORY / "blackjack_nn.keras", compile=False)
    keras_scores = keras_model(features, training=False).numpy()
    with torch.inference_mode():
        torch_scores = load_model(MODEL)(torch.from_numpy(features)).numpy()
    np.testing.assert_allclose(keras_scores, torch_scores, atol=1e-5, rtol=1e-5)
    np.testing.assert_array_equal(keras_scores.argmax(axis=1), torch_scores.argmax(axis=1))


def test_evaluation_matches_shipped_predictions():
    raw, labels = make_dataset()
    _, _, test_indices = stratified_split(labels)
    with torch.inference_mode():
        actions = load_model(MODEL)(torch.from_numpy(normalize(raw))).numpy().argmax(axis=1)
    report = json.loads((MODEL_DIRECTORY / "evaluation.json").read_text())
    assert report["distinct_reachable_states"] == len(raw)
    assert report["all_states_disagreement_count"] == int(np.sum(actions != labels))
    assert report["held_out_test_accuracy"] == pytest.approx(float(np.mean(actions[test_indices] == labels[test_indices])))


def test_artifacts_match_recorded_fingerprints():
    report = json.loads((MODEL_DIRECTORY / "evaluation.json").read_text())
    for name, digest in report["artifact_sha256"].items():
        assert hashlib.sha256((MODEL_DIRECTORY / name).read_bytes()).hexdigest() == digest


def test_training_uses_matching_architecture_and_reports_actual_exports(tmp_path):
    # A one-epoch smoke run writes only to pytest's temporary directory.
    from train import train

    train(epochs=1, output=tmp_path)
    report = json.loads((tmp_path / "evaluation.json").read_text())
    assert report["epochs_run"] == 1
    assert report["trainable_parameters"] == 234
    assert report["tensorflow_pytorch_actions_agree_all_states"]
    assert report["max_tensorflow_pytorch_score_difference_all_states"] <= 1e-5
    assert load_model(tmp_path / "blackjack_nn.pt") is not None
    for name, digest in report["artifact_sha256"].items():
        assert hashlib.sha256((tmp_path / name).read_bytes()).hexdigest() == digest
