import { NavLink, Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../AuthContext";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  async function signOut() {
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setError(error.message);
    }
  }
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">
          <span className="brand-mark">♠</span>
          <span>
            BLACKJACK <b>ARENA</b>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <NavLink to="/single">Single player</NavLink>
          <NavLink to="/multiplayer">Multiplayer</NavLink>
          {user ? (
            <>
              <NavLink to="/profile">{user.username}</NavLink>
              <button className="text-button" onClick={signOut}>
                Log out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login">Log in</NavLink>
              <Link className="button small" to="/register">
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </>
  );
}
