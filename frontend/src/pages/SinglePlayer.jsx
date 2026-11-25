import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { BlackjackTable } from "../components/GameTable";
import BetControl from "../components/BetControl";

export default function SinglePlayer() {
  const { user, refreshBalance } = useAuth();
  const [wager, setWager] = useState("1");
  const [payoutMode, setPayoutMode] = useState("standard");
  const [game, setGame] = useState(null);
  const [botCount, setBotCount] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/games/single")
      .then((data) => setGame(data.game))
      .catch((error) => setError(error.message))
      .finally(() => setBusy(false));
  }, []);
  async function update(path, body) {
    setBusy(true);
    setError("");
    try {
      const data = await api(path, { method: "POST", body });
      setGame(data.game);
      await refreshBalance();
    } catch (error) {
      setError(error.message);
      const current = await api("/games/single").catch(() => null);
      if (current) setGame(current.game);
    } finally {
      setBusy(false);
    }
  }
  const canStart = !game || (game.status === "complete" && game.saved);
  function action(action) {
    return update("/games/single/action", {
      action,
      roundId: game.id,
      revision: game.revision,
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR PACE. YOUR TABLE.</span>
          <h1>Single player</h1>
          <p>Play the dealer. Learn alongside the network.</p>
        </div>
        <span className="outline-tag">VIRTUAL CHIPS ONLY</span>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {canStart && (
        <div className="round-setup panel">
          <label>
            Neural network tablemates
            <select
              value={botCount}
              onChange={(event) => setBotCount(Number(event.target.value))}
            >
              <option value={0}>Just me</option>
              <option value={1}>1 neural network bot</option>
              <option value={2}>2 neural network bots</option>
            </select>
          </label>
          <BetControl
            amount={wager}
            onChange={setWager}
            balance={user.chips}
            disabled={busy}
          />
          <label>
            Payout rules
            <select
              value={payoutMode}
              onChange={(event) => setPayoutMode(event.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="experimental">Experimental (optional)</option>
            </select>
          </label>
          <small>Standard returns 2× on a win, 2.5× on a natural blackjack, and the stake on a push. Payouts round down to whole chips.</small>
          {payoutMode === "experimental" && (
            <small>
              After 10 saved games, players below 40% wins receive 2.1× on
              ordinary wins; otherwise standard 2× applies. Natural blackjack
              returns 2.5×. Whole-chip payouts round down. The rule is fixed
              before cards are shown.
            </small>
          )}
          <button
            disabled={
              busy ||
              !Number.isSafeInteger(Number(wager)) ||
              Number(wager) < 1 ||
              Number(wager) > user.chips
            }
            onClick={() =>
              update("/games/single", {
                botCount,
                wager: Number(wager),
                payoutMode,
              })
            }
          >
            {busy
              ? "Dealing…"
              : game
                ? "Deal next round →"
                : "Deal my first hand →"}
          </button>
        </div>
      )}
      {game && (game.aiError || game.saveError) && (
        <div className="notice" role="alert">
          <p>{game.aiError || game.saveError}</p>
          <button disabled={busy} onClick={() => update("/games/single/retry")}>
            {game.aiError ? "Retry AI" : "Retry saving"}
          </button>
        </div>
      )}
      {game ? (
        <BlackjackTable
          game={game}
          userId={user.id}
          busy={busy}
          onAction={action}
          onAdvice={() =>
            api("/games/single/advice", {
              method: "POST",
              body: { roundId: game.id, revision: game.revision },
            })
          }
        />
      ) : (
        <div className="empty-table">
          <span>♠</span>
          <h2>A fresh shoe. A fresh start.</h2>
          <p>
            {busy
              ? "Loading your table…"
              : "Choose your tablemates and deal a hand."}
          </p>
        </div>
      )}
      <p className="table-footnote">
        Six decks · Ace is 1 or 11 · Dealer stands on soft 17 · Natural
        Blackjack beats a normal 21
      </p>
    </>
  );
}
