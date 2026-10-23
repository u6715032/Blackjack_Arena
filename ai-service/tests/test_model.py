import json
from pathlib import Path
import numpy as np
import pytest
import torch
from fastapi.testclient import TestClient
from blackjack_nn import LABELS, hand_value, stratified_split
from blackjack_ai_api import HandState, create_app, load_model
from expanded_states import (MAX_CARDS, SCALES, make_expanded_dataset,
                             normalize_expanded, reachable_hands)

BASE = Path(__file__).resolve().parents[1]
MODEL = BASE / "models/expanded/blackjack_nn.pt"

@pytest.fixture(scope="module")
def client():
    with TestClient(create_app(MODEL)) as client:
        yield client

def test_actual_model_and_metadata(client):
    assert client.get("/health").json()["card_count_range"] == [2, 20]
    network = load_model(MODEL)
    assert sum(parameter.numel() for parameter in network.parameters()) == 234
    assert not network.training
    assert LABELS == ("STAND", "HIT")

def test_preprocessing():
    np.testing.assert_allclose(normalize_expanded([[21, 11, 1, 20]]), [[1, 1, 1, 1]])
    assert SCALES == [21, 11, 1, 20]

def test_all_enumerated_hands_are_reachable_without_passing_21():
    for hand in reachable_hands():
        assert hand_value(hand)[0] <= 21
        assert len(hand) <= MAX_CARDS
        for size in range(2, len(hand)):
            assert hand_value(hand[:size])[0] < 21
        assert max(hand.count(value) for value in set(hand)) <= 24

def test_split_has_no_duplicate_tuple_leakage():
    raw, labels = make_expanded_dataset()
    train, validation, test = map(set, stratified_split(labels))
    assert not train & test and not train & validation and not test & validation
    assert len(train | validation | test) == len(raw)
    assert len(set(map(tuple, raw))) == len(raw)

@pytest.mark.parametrize("state", [
    {"total": 18, "dealer": 10, "soft": 1, "cards": 7},
    {"total": 20, "dealer": 11, "soft": 0, "cards": 19},
    {"total": 21, "dealer": 2, "soft": 0, "cards": 20},
    {"total": 16, "dealer": 10, "soft": 0, "cards": 2},
])
def test_prediction_uses_real_forward_pass(client, state):
    result = client.post("/predict", json=state)
    assert result.status_code == 200
    prediction = result.json()
    network = load_model(MODEL)
    with torch.inference_mode():
        scores = network(torch.from_numpy(normalize_expanded([list(state.values())]))).numpy()[0]
    assert prediction["action"] == LABELS[int(scores.argmax())]
    assert prediction["scores"]["hit"] == pytest.approx(float(scores[1]))
    assert sum(prediction["scores"].values()) == pytest.approx(1)

@pytest.mark.parametrize("changes", [
    {"total": 22}, {"total": 3}, {"dealer": 1}, {"cards": 21}, {"cards": 1},
    {"soft": 2}, {"soft": 1, "total": 10}, {"cards": 19, "total": 4},
    {"cards": "2"}, {"total": True}, {"extra": "hidden card"},
])
def test_invalid_values_rejected(client, changes):
    state = {"total": 16, "dealer": 10, "soft": 0, "cards": 2, **changes}
    assert client.post("/predict", json=state).status_code == 422

def test_missing_or_original_model_cannot_claim_ready(tmp_path):
    with pytest.raises(FileNotFoundError):
        with TestClient(create_app(tmp_path / "absent.pt")):
            pass
    with pytest.raises(ValueError, match="metadata"):
        load_model(BASE / "models/blackjack_nn.pt")

def test_real_disagreements_are_disclosed(client):
    report = json.loads((MODEL.parent / "evaluation.json").read_text())
    for example in report["example_disagreements"]:
        total, dealer, soft, cards = example["features"]
        response = client.post("/predict", json=dict(total=total, dealer=dealer, soft=soft, cards=cards)).json()
        assert not response["agrees_with_reference"]
        assert response["action"] == example["model"]
        assert response["reference_action"] == example["reference"]
        assert "disagreement" in response["explanation"]

def test_tensorflow_pytorch_parity_for_entire_feature_domain():
    import tensorflow as tf
    raw, _ = make_expanded_dataset()
    features = normalize_expanded(raw)
    keras_model = tf.keras.models.load_model(MODEL.parent / "blackjack_nn.keras", compile=False)
    keras_scores = keras_model(features, training=False).numpy()
    with torch.inference_mode():
        torch_scores = load_model(MODEL)(torch.from_numpy(features)).numpy()
    np.testing.assert_allclose(keras_scores, torch_scores, atol=1e-5, rtol=1e-5)
    np.testing.assert_array_equal(keras_scores.argmax(axis=1), torch_scores.argmax(axis=1))

def test_original_files_are_unchanged():
    import hashlib
    report = json.loads((MODEL.parent / "evaluation.json").read_text())
    for name, digest in report["original_sha256"].items():
        assert hashlib.sha256((BASE / name).read_bytes()).hexdigest() == digest
