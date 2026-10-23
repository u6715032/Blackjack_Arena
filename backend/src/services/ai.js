export function createAiClient(baseUrl) {
  return async function predict(features) {
    try {
      const response = await fetch(`${baseUrl}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(features),
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error("Prediction rejected.");
      const prediction = await response.json();
      const scores = prediction.scores;
      if (
        !["HIT", "STAND"].includes(prediction.action) ||
        !scores ||
        ![scores.hit, scores.stand].every(
          (score) => Number.isFinite(score) && score >= 0 && score <= 1,
        ) ||
        Math.abs(scores.hit + scores.stand - 1) > 0.01 ||
        typeof prediction.explanation !== "string"
      ) {
        throw new Error("Invalid model response.");
      }
      return prediction;
    } catch {
      const error = new Error(
        "Neural network unavailable. Start the Python AI service, then retry. No substitute strategy was used.",
      );
      error.status = 503;
      throw error;
    }
  };
}
