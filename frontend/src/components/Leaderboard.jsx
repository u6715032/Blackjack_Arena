import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";

export default function Leaderboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [position, setPosition] = useState(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [rankings, own] = await Promise.all([
        api("/leaderboard"),
        user ? api("/leaderboard/me") : Promise.resolve(null),
      ]);
      setData(rankings);
      setPosition(own?.player || null);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [user?.id]);
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    window.addEventListener("chips:changed", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("chips:changed", refresh);
    };
  }, [refresh]);
  return (
    <section className="leaderboard">
      <h2>Chip leaderboard</h2>
      <p>Current virtual chip balances</p>
      {error && <p role="alert">{error}</p>}
      <ol>
        {data?.players.map((player) => (
          <li
            key={player.id}
            className={`${player.rank <= 3 ? "top-rank" : ""} ${player.id === user?.id ? "current-rank" : ""}`}
          >
            <span>
              #{player.rank} {player.username}
              {player.id === user?.id ? " (you)" : ""}
            </span>
            <b>{player.chips.toLocaleString()}</b>
          </li>
        ))}
      </ol>
      {position && !data?.players.some((player) => player.id === user?.id) && (
        <p>
          Your rank: #{position.rank} · {position.chips.toLocaleString()} chips
        </p>
      )}
    </section>
  );
}
