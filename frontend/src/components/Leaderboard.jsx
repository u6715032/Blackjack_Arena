import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";

export default function Leaderboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [position, setPosition] = useState(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState("balance");
  const refresh = useCallback(async () => {
    try {
      const [rankings, own] = await Promise.all([
        api(`/leaderboard?sort=${sort}`),
        user ? api(`/leaderboard/me?sort=${sort}`) : Promise.resolve(null),
      ]);
      setData(rankings);
      setPosition(own?.player || null);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [user?.id, sort]);
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    window.addEventListener("chips:changed", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("chips:changed", refresh);
    };
  }, [refresh]);
  const visiblePlayers = data?.players.slice(0, 5) || [];
  return (
    <section className="leaderboard">
      <h2>Chip leaderboard</h2>
      <p>Current virtual chip balances</p>
      <label>
        Rank by{" "}
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="balance">Chip balance</option>
          <option value="net">Balance after debt</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <ol>
        {visiblePlayers.map((player) => (
          <li
            key={player.id}
            className={`${player.rank <= 3 ? "top-rank" : ""} ${player.id === user?.id ? "current-rank" : ""}`}
          >
            <span>
              #{player.rank} {player.username}
              {player.id === user?.id ? " (you)" : ""}
            </span>
            <b>
              {player.chips.toLocaleString()}{" "}
              <small>· net {player.netChips.toLocaleString()}</small>
            </b>
          </li>
        ))}
      </ol>
      {position && !visiblePlayers.some((player) => player.id === user?.id) && (
        <p>
          Your rank: #{position.rank} · {position.chips.toLocaleString()} chips
        </p>
      )}
    </section>
  );
}
