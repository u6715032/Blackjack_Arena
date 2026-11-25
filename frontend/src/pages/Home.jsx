import { Link } from "react-router-dom";
import { PlayingCard } from "../components/GameTable";
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
  const countdown = `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m ${remaining % 60}s`;
  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="live-dot" /> THE TABLE IS OPEN
          </span>
          <h1>
            A classic game.
            <br />A smarter <em>table.</em>
          </h1>
          <p>
            Take a seat, bring your friends, and find your next move with a
            trained neural network.
          </p>
          <div className="hero-footnote">
            <span>♠</span> Virtual chips only. No real money.
          </div>
        </div>
        <div
          className="hero-art"
          aria-label="An Ace and King make a natural Blackjack"
        >
          <div className="table-orbit orbit-one" />
          <div className="table-orbit orbit-two" />
          <span className="hero-art-label">THE PERFECT START</span>
          <div className="hero-cards">
            <PlayingCard card={{ rank: "A", suit: "spades" }} />
            <PlayingCard card={{ rank: "K", suit: "hearts" }} />
          </div>
          <span className="twenty-one">21</span>
          <span className="hero-art-bottom">YOUR NEXT HAND AWAITS</span>
        </div>
      </section>
      {user && (
        <section className="daily-reward" aria-label="Daily reward">
          <strong>Daily reward · 10 chips</strong>
          <span>
            {reward?.granted ? "10 chips added to your balance. " : ""}
            {remaining
              ? `Next reward in ${countdown}`
              : "Access your session to collect your next reward."}
          </span>
        </section>
      )}
      <LuckyWheel />
      <Friends />
      <Leaderboard />
      <section className="mode-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">FIND YOUR TABLE</span>
            <h2>How will you play?</h2>
          </div>
          <span className="muted">Same rules. Your kind of company.</span>
        </div>
        <div className="mode-grid">
          <Link to="/single" className="mode-card">
            <span className="mode-icon">♠</span>
            <span className="eyebrow">01 / SINGLE PLAYER</span>
            <h3>
              You, the dealer,
              <br />
              and a little intelligence.
            </h3>
            <p>
              Play at your pace. Add up to two neural network bots and ask for
              advice when you need it.
            </p>
            <span className="mode-link">
              Play solo <span>↗</span>
            </span>
          </Link>
          <Link to="/multiplayer" className="mode-card">
            <span className="mode-icon">♣</span>
            <span className="eyebrow">02 / MULTIPLAYER</span>
            <h3>
              A private table.
              <br />A shared experience.
            </h3>
            <p>
              Invite 2–4 friends with a room code. Take turns in real time
              against the same dealer.
            </p>
            <span className="mode-link">
              Bring your friends <span>↗</span>
            </span>
          </Link>
        </div>
      </section>
    </div>
  );
}
