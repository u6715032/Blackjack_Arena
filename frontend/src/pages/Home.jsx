import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import LuckyWheel from "../components/LuckyWheel";
import Leaderboard from "../components/Leaderboard";
import Friends from "../components/Friends";

export default function Home() {
  const { user, reward } = useAuth();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = reward?.nextRewardAt
    ? Math.max(
        0,
        Math.ceil((new Date(reward.nextRewardAt).getTime() - now) / 1000),
      )
    : 0;
  const hours = String(Math.floor(remaining / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  const countdown = `${hours}h ${minutes}m ${seconds}s`;
  return (
    <div className="home-page dashboard">
      <div className="dashboard-main">
        <section className="welcome">
          <span className="eyebrow">BLACKJACK ARENA</span>
          <h1>
            {user ? `Welcome back, ${user.username}.` : "Welcome to the table."}
          </h1>
          <p>Play blackjack with virtual chips. No real money.</p>
        </section>
        <section className="mode-section">
          <h2>Choose a table</h2>
          <div className="mode-grid">
            <Link to="/single" className="mode-card">
              <span className="mode-icon">♠</span>
              <h3>Single player</h3>
              <p>Play at your own pace with optional AI tablemates.</p>
              <span className="mode-link">
                Play solo <span>↗</span>
              </span>
            </Link>
            <Link to="/multiplayer" className="mode-card">
              <span className="mode-icon">♣</span>
              <h3>Multiplayer</h3>
              <p>Share a private table with up to three friends.</p>
              <span className="mode-link">
                Join a table <span>↗</span>
              </span>
            </Link>
          </div>
        </section>
        <div className="dashboard-rewards">
          {user && (
            <section className="daily-reward" aria-label="Daily reward">
              <strong>Daily reward · 10 chips</strong>
              <span>
                {reward?.granted ? "10 chips added. " : ""}
                {remaining
                  ? `Next reward in ${countdown}`
                  : "Access your session to collect your next reward."}
              </span>
            </section>
          )}
          <LuckyWheel />
        </div>
      </div>
      <aside className="dashboard-sidebar">
        <Friends />
        <Leaderboard />
      </aside>
    </div>
  );
}
