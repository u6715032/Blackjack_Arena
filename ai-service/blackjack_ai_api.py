"""HTTP inference wrapper for the blackjack_nn.py training script.

Put this file next to blackjack_nn.py, with models/blackjack_nn.pt present.
Install: python -m pip install fastapi uvicorn torch numpy
Run:     python -m uvicorn blackjack_ai_api:app --host 127.0.0.1 --port 8000
Docs:    http://127.0.0.1:8000/docs
"""

from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# Reuse EXACT model architecture, input normalization, and strategy labels
# from the script that created the .pt checkpoint.
from blackjack_nn import LABELS, basic_strategy, normalize, torch_network

app = FastAPI(title="Blackjack Arena AI API", version="1.0")
MODEL_PATH = Path(__file__).resolve().parent / "models" / "blackjack_nn.pt"

if not MODEL_PATH.is_file():
    raise FileNotFoundError(f"Trained model not found: {MODEL_PATH}. Run blackjack_nn.py train first.")

checkpoint = torch.load(MODEL_PATH, map_location="cpu", weights_only=True)
net = torch_network(torch)
net.load_state_dict(checkpoint["state_dict"])
net.eval()


class HandState(BaseModel):
    total: int = Field(ge=4, le=21, description="Player's best hand total")
    dealer: int = Field(ge=2, le=11, description="Visible dealer value; 11=Ace")
    soft: int = Field(ge=0, le=1, description="1 when an Ace counts as 11")
    cards: int = Field(ge=2, le=6, description="Number of cards in hand")


@app.get("/health")
def health():
    return {"ready": True, "model": MODEL_PATH.name}


@app.post("/predict")
def predict(hand: HandState):
    if hand.soft == 1 and hand.total < 12:
        raise HTTPException(status_code=422, detail="A usable Ace requires a total of at least 12.")

    raw = np.array([[hand.total, hand.dealer, hand.soft, hand.cards]], dtype=np.float32)
    features = torch.from_numpy(normalize(raw))
    with torch.inference_mode():
        scores = net(features).cpu().numpy()[0]

    recommended = LABELS[int(np.argmax(scores))]
    reference = LABELS[basic_strategy(hand.total, hand.dealer, hand.soft)]
    agreement = recommended == reference
    kind = "soft" if hand.soft else "hard"
    if agreement:
        explanation = (
            f"The reference Hit/Stand strategy recommends {recommended} "
            f"for a {kind} {hand.total} against dealer {hand.dealer}."
        )
    else:
        explanation = (
            f"The network suggests {recommended}, but the reference Hit/Stand strategy "
            f"suggests {reference}. This disagreement should be reviewed."
        )

    return {
        "action": recommended,
        "scores": {"stand": round(float(scores[0]), 4), "hit": round(float(scores[1]), 4)},
        "reference_action": reference,
        "agrees_with_reference": agreement,
        "explanation": explanation,
        "warning": "Scores indicate model preference, not probabilities of winning.",
    }
