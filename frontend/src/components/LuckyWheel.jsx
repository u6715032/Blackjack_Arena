import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";

const colors = [
  "#214b3b",
  "#b69b5a",
  "#53735e",
  "#8a7146",
  "#d5bd7b",
  "#f2df9d",
];
export default function LuckyWheel() {
  const { user, refreshBalance } = useAuth();
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState(null);
  const requestId = useRef(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function show() {
    setOpen(true);
    setError("");
    try {
      setConfig(await api("/wheel"));
    } catch (e) {
      setError(e.message);
    }
  }
  async function spin() {
    if (!config || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    requestId.current ||= crypto.randomUUID();
    try {
      const response = await api("/wheel/spin", {
        method: "POST",
        body: { requestId: requestId.current },
      });
      requestId.current = null;
      const before = config.prizes
        .slice(0, response.prizeIndex)
        .reduce((sum, item) => sum + item.probability, 0);
      const midpoint =
        (before + config.prizes[response.prizeIndex].probability / 2) * 360;
      const target = (360 - midpoint) % 360;
      const extra = (target - (rotation % 360) + 360) % 360;
      setRotation(rotation + 1800 + extra);
      refreshBalance().catch(() => {});
      window.dispatchEvent(new Event("chips:changed"));
      timer.current = setTimeout(() => {
        setResult(response.prize);
        setBusy(false);
      }, config.cooldownMs);
    } catch (e) {
      setError(`${e.message} Retry to check the same spin.`);
      setBusy(false);
    }
  }
  let cursor = 0;
  const stops = config?.prizes
    .map((prize, index) => {
      const start = cursor;
      cursor += prize.probability * 100;
      return `${colors[index]} ${start}% ${cursor}%`;
    })
    .join(", ");
  return (
    <section className="wheel-entry">
      <div>
        <strong>Lucky wheel</strong>
        <p>2 chips per spin · virtual prizes</p>
      </div>
      <button onClick={show} disabled={!user}>
        Open wheel
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <section
            className="wheel-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wheel-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="text-button modal-close"
              onClick={() => setOpen(false)}
              disabled={busy}
              aria-label="Close wheel"
            >
              ×
            </button>
            <h2 id="wheel-title">Lucky wheel</h2>
            {config && (
              <>
                <div className="wheel-wrap">
                  <div className="wheel-pointer" />
                  <div
                    className="wheel-disc"
                    style={{
                      background: `conic-gradient(${stops})`,
                      transform: `rotate(${rotation}deg)`,
                    }}
                  />
                </div>
                <div className="wheel-probabilities">
                  {config.prizes.map((prize, index) => (
                    <span key={prize.chips}>
                      <i style={{ background: colors[index] }} />
                      {prize.chips} chips:{" "}
                      {Number((prize.probability * 100).toFixed(3))}%
                    </span>
                  ))}
                </div>
                <p>
                  Expected return: {config.expectedPayout.toFixed(2)} chips per
                  spin · theoretical RTP {config.theoreticalRtp.toFixed(1)}%
                </p>
                <button
                  onClick={spin}
                  disabled={
                    busy || (!requestId.current && user.chips < config.cost)
                  }
                >
                  {busy ? "Spinning…" : `Spin for ${config.cost} chips`}
                </button>
                {result !== null && (
                  <p role="status">
                    {result
                      ? `You received ${result} chips.`
                      : "No chips this spin."}
                  </p>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
