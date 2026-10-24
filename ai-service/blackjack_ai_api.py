"""Internal prediction API using the same model utilities as offline training.

From ai-service:
python -m uvicorn blackjack_ai_api:app --host 127.0.0.1 --port 8000
"""

from contextlib import asynccontextmanager
import os
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field, model_validator

from model import (
    DATASET_VERSION, LABELS, MAX_CARDS, MIN_CARDS, MODEL_DIRECTORY, VALID_STATES,
    basic_strategy, load_model, normalize,
)

BASE = Path(__file__).resolve().parent


class HandState(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    total: int = Field(ge=4, le=21)
    dealer: int = Field(ge=2, le=11)
    soft: int = Field(ge=0, le=1)
    cards: int = Field(ge=MIN_CARDS, le=MAX_CARDS)

    @model_validator(mode="after")
    def check_reachable_state(self):
        if (self.total, self.dealer, self.soft, self.cards) not in VALID_STATES:
            raise ValueError("These features do not describe a reachable hand under the game rules.")
        return self


def explain_prediction(hand, action, reference):
    kind = "soft" if hand.soft else "hard"
    dealer = "Ace" if hand.dealer == 11 else str(hand.dealer)
    if action != reference:
        return (
            f"The neural network recommends {action} for {kind} {hand.total} against {dealer}, "
            f"but the reference HIT/STAND strategy recommends {reference}. "
            "This is a model disagreement, not a guaranteed good move."
        )
    return (
        f"The neural network recommends {action} for {kind} {hand.total} against dealer {dealer}. "
        "The reference HIT/STAND strategy agrees. "
        "This comparison supports the explanation; it does not expose the network's reasoning."
    )


def create_app(model_path=None):
    selected_path = Path(
        model_path or os.environ.get("MODEL_PATH", MODEL_DIRECTORY / "blackjack_nn.pt")
    )
    if not selected_path.is_absolute():
        selected_path = BASE / selected_path

    @asynccontextmanager
    async def lifespan(application):
        # A loading failure stops startup rather than offering a false-ready API.
        application.state.network = load_model(selected_path)
        yield

    application = FastAPI(
        title="Blackjack Arena Neural Network", version="2.0", lifespan=lifespan
    )

    @application.get("/health")
    def health():
        return {
            "ready": True,
            "model": selected_path.name,
            "parameters": 234,
            "card_count_range": [MIN_CARDS, MAX_CARDS],
            "dataset_version": DATASET_VERSION,
        }

    @application.post("/predict")
    def predict(hand: HandState):
        features = normalize([[hand.total, hand.dealer, hand.soft, hand.cards]])
        with torch.inference_mode():
            scores = application.state.network(torch.from_numpy(features)).numpy()[0]
        action = LABELS[int(np.argmax(scores))]
        reference = LABELS[basic_strategy(hand.total, hand.dealer, hand.soft)]
        return {
            "action": action,
            "scores": {"stand": float(scores[0]), "hit": float(scores[1])},
            "reference_action": reference,
            "agrees_with_reference": action == reference,
            "explanation": explain_prediction(hand, action, reference),
            "warning": "Scores indicate model preference, not probabilities of winning.",
        }

    return application


app = create_app()
