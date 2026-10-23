import { useEffect, useState } from "react";

const suitSymbols = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" };
export function PlayingCard({ card }) {
  if (card.hidden)
    return (
      <div className="playing-card card-back" aria-label="Hidden dealer card">
        <span>♠</span>
      </div>
    );
  return (
    <div
      className={`playing-card ${["hearts", "diamonds"].includes(card.suit) ? "red-card" : ""}`}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span className="card-corner">
        {card.rank}
        <small>{suitSymbols[card.suit]}</small>
      </span>
      <span className="card-suit">{suitSymbols[card.suit]}</span>
      <span className="card-bottom">{card.rank}</span>
    </div>
  );
}
export function PlayerHand({ player, active, isYou }) {
  return (
    <section
      className={`player-hand ${active ? "active-hand" : ""}`}
      aria-label={`${player.username}'s hand`}
    >
      <div className="hand-heading">
        <span>
          {player.username} {isYou && <small className="you-label">YOU</small>}
        </span>
        <span className="total">
          {player.total}
          {player.soft && <small> soft</small>}
        </span>
      </div>
      <div className="cards">
        {player.hand.map((card, index) => (
          <PlayingCard key={index} card={card} />
        ))}
      </div>
      <div className="hand-status">
        {player.blackjack
          ? "Natural Blackjack"
          : active
            ? "Taking a turn"
            : player.status === "bust"
              ? "Bust"
              : player.status === "disconnected"
                ? "Disconnected · stood"
                : player.status === "playing"
                  ? "Waiting"
                  : "Stand"}
        {player.result && (
          <span className={`result-badge ${player.result}`}>
            {player.result}
          </span>
        )}
      </div>
    </section>
  );
}
export function AIPlayerDisplay(props) {
  return (
    <div className="ai-seat">
      <span className="seat-label">◈ NEURAL NETWORK BOT</span>
      <PlayerHand {...props} />
    </div>
  );
}
export function DealerHand({ dealer }) {
  return (
    <section className="dealer-hand">
      <div className="dealer-title">
        <span>DEALER</span>
        <span>
          {dealer.total ?? "One card hidden"}
          {dealer.blackjack ? " · Blackjack" : ""}
        </span>
      </div>
      <div className="cards">
        {dealer.hand.map((card, index) => (
          <PlayingCard key={index} card={card} />
        ))}
      </div>
      <small>Stands on all 17s</small>
    </section>
  );
}
export function ActionButtons({ enabled, busy, onAction }) {
  return (
    <div className="action-buttons">
      <button disabled={!enabled || busy} onClick={() => onAction("HIT")}>
        Hit <span>＋</span>
      </button>
      <button
        className="secondary"
        disabled={!enabled || busy}
        onClick={() => onAction("STAND")}
      >
        Stand <span>✓</span>
      </button>
    </div>
  );
}
export function GameResult({ game, userId }) {
  const player = game.players.find((player) => player.id === userId);
  if (game.status !== "complete") return null;
  const titles = {
    win: "You win.",
    loss: "Dealer wins.",
    push: "It’s a push.",
  };
  return (
    <div className="round-result" role="status">
      <span className="eyebrow">ROUND COMPLETE</span>
      <h2>{titles[player?.result] || "Round complete."}</h2>
      <p>
        Your total: {player?.total} <span className="muted">/</span> Dealer:{" "}
        {game.dealer.total}
      </p>
      <small>
        {game.saved
          ? "Result saved to your history."
          : game.saveError || "Saving result…"}
      </small>
    </div>
  );
}
export function StrategyAssistant({ game, userId, onAdvice, onAction, busy }) {
  const [advice, setAdvice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setAdvice(null);
    setError("");
  }, [game.id, game.revision]);
  const enabled = game.status === "playing" && game.currentPlayerId === userId;
  const currentAdvice =
    advice?.roundId === game.id && advice?.revision === game.revision
      ? advice
      : null;
  async function requestAdvice() {
    setLoading(true);
    setError("");
    try {
      setAdvice(await onAdvice());
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <aside className="assistant panel">
      <div className="assistant-icon">◈</div>
      <span className="eyebrow">A SECOND OPINION</span>
      <h2>Strategy assistant</h2>
      <p>
        Four inputs. One trained network. A little perspective for your next
        move.
      </p>
      <button
        className="secondary full-width"
        disabled={!enabled || busy || loading}
        onClick={requestAdvice}
      >
        {loading ? "Asking the network…" : "Analyze my hand"}
      </button>
      {!enabled && <small>Available during your turn.</small>}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {currentAdvice && (
        <div className="advice" aria-live="polite">
          <span className="eyebrow">MODEL RECOMMENDS</span>
          <h3>{currentAdvice.action}</h3>
          <p>{currentAdvice.explanation}</p>
          <div className="score-row">
            <span>HIT {(currentAdvice.scores.hit * 100).toFixed(1)}%</span>
            <span>STAND {(currentAdvice.scores.stand * 100).toFixed(1)}%</span>
          </div>
          <small>
            Model preference scores, not chances of winning. The explanation
            compares with a reference strategy; it does not reveal the network’s
            reasoning.
          </small>
          <button
            disabled={!enabled || busy}
            onClick={() => onAction(currentAdvice.action)}
          >
            Play {currentAdvice.action.toLowerCase()}
          </button>
          <small>You decide. Advice never plays a move automatically.</small>
        </div>
      )}
      <div className="assistant-note">
        <span>234</span>
        <small>
          trained parameters
          <br />
          Shared by bots & assistant
        </small>
      </div>
    </aside>
  );
}
export function BlackjackTable({ game, userId, busy, onAction, onAdvice }) {
  const currentPlayer = game.players.find(
    (player) => player.id === game.currentPlayerId,
  );
  const yourTurn = game.status === "playing" && game.currentPlayerId === userId;
  return (
    <div className="game-layout">
      <div>
        <div className="table-surface">
          <div className="table-topline">
            <span className="live-dot" /> SIX DECKS{" "}
            <span>HIT / STAND ONLY</span>
          </div>
          <DealerHand dealer={game.dealer} />
          <div className="table-watermark">
            BLACKJACK <span>ARENA</span>
            <small>PLAY. LEARN. REPEAT.</small>
          </div>
          <div className="player-seats">
            {game.players.map((player) =>
              player.isBot ? (
                <AIPlayerDisplay
                  key={player.id}
                  player={player}
                  active={player.id === game.currentPlayerId}
                />
              ) : (
                <PlayerHand
                  key={player.id}
                  player={player}
                  active={player.id === game.currentPlayerId}
                  isYou={player.id === userId}
                />
              ),
            )}
          </div>
        </div>
        <div className="table-controls">
          <div>
            <span className={`status-dot ${yourTurn ? "gold" : ""}`} />
            <span aria-live="polite">
              {busy
                ? "Processing turn…"
                : game.status === "complete"
                  ? "Round finished"
                  : yourTurn
                    ? "Your move"
                    : `${currentPlayer?.username || "Dealer"}’s turn`}
            </span>
          </div>
          <ActionButtons enabled={yourTurn} busy={busy} onAction={onAction} />
        </div>
        <GameResult game={game} userId={userId} />
      </div>
      <StrategyAssistant
        game={game}
        userId={userId}
        onAdvice={onAdvice}
        onAction={onAction}
        busy={busy}
      />
    </div>
  );
}
