import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";

export default function Friends() {
  const { user, socialSocket } = useAuth();
  const [social, setSocial] = useState({
    friends: [],
    incoming: [],
    outgoing: [],
    blocked: [],
  });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState([]);
  const [active, setActive] = useState(null);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api("/social");
      setSocial(data);
      if (active && data.friends.some((friend) => friend.id === active.id)) {
        const conversation = await api(`/social/messages/${active.id}`);
        setMessages(conversation.messages);
      } else if (active) {
        setActive(null);
        setMessages([]);
      }
    } catch (e) {
      setError(e.message);
    }
  }, [user?.id, active?.id]);
  useEffect(() => {
    if (!user) return;
    refresh();
    const timer = setInterval(refresh, 15000);
    socialSocket?.on("social:update", refresh);
    socialSocket?.on("social:presence-change", refresh);
    return () => {
      clearInterval(timer);
      socialSocket?.off("social:update", refresh);
      socialSocket?.off("social:presence-change", refresh);
    };
  }, [refresh, socialSocket, user?.id]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, minimized]);
  async function action(id, operation) {
    setError("");
    setBusy(true);
    try {
      await api(`/social/friends/${id}/${operation}`, { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function searchUsers(event) {
    event.preventDefault();
    setError("");
    try {
      setSearch(
        (await api(`/social/search?q=${encodeURIComponent(query)}`)).users,
      );
    } catch (e) {
      setError(e.message);
    }
  }
  async function send(event) {
    event.preventDefault();
    if (!text.trim() || busy || !active) return;
    setBusy(true);
    setError("");
    try {
      await api(`/social/messages/${active.id}`, {
        method: "POST",
        body: { text },
      });
      setText("");
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!user) return null;
  return (
    <section className="friends-panel">
      <h2>Friends</h2>
      <form className="friend-search" onSubmit={searchUsers}>
        <input
          aria-label="Search usernames"
          placeholder="Search usernames"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          minLength={2}
          maxLength={24}
        />
        <button disabled={busy}>Search</button>
      </form>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {search.map((person) => (
        <div className="friend-row" key={person.id}>
          <span>{person.username}</span>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => action(person.id, "request")}
          >
            Add
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => action(person.id, "block")}
          >
            Block
          </button>
        </div>
      ))}
      {social.incoming.length > 0 && <h3>Requests</h3>}
      {social.incoming.map((person) => (
        <div className="friend-row" key={person.id}>
          <span>{person.username}</span>
          <button disabled={busy} onClick={() => action(person.id, "accept")}>
            Accept
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => action(person.id, "decline")}
          >
            Decline
          </button>
        </div>
      ))}
      {social.outgoing.map((person) => (
        <div className="friend-row" key={person.id}>
          <span>{person.username} · pending</span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => action(person.id, "cancel")}
          >
            Cancel
          </button>
        </div>
      ))}
      {social.friends.length === 0 && (
        <p>No friends yet. Search for a username to connect.</p>
      )}
      {social.friends.map((person) => (
        <div className="friend-row" key={person.id}>
          <button
            className="friend-name text-button"
            onClick={() => {
              setActive(person);
              setMinimized(false);
            }}
          >
            <span className={`status-dot ${person.online ? "gold" : ""}`} />{" "}
            {person.username} {person.unread ? `(${person.unread})` : ""}
          </button>
          <small>{person.online ? "Online" : "Offline"}</small>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => action(person.id, "remove")}
          >
            Remove
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => action(person.id, "block")}
          >
            Block
          </button>
        </div>
      ))}
      {social.blocked.length > 0 && (
        <details>
          <summary>Blocked players</summary>
          {social.blocked.map((person) => (
            <div className="friend-row" key={person.id}>
              <span>{person.username}</span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => action(person.id, "unblock")}
              >
                Unblock
              </button>
            </div>
          ))}
        </details>
      )}
      {active && (
        <aside
          className="chat-widget"
          aria-label={`Chat with ${active.username}`}
        >
          <div className="chat-header">
            <strong>{active.username}</strong>
            <div>
              <button
                className="text-button"
                onClick={() => setMinimized(!minimized)}
                aria-label={minimized ? "Expand chat" : "Minimize chat"}
              >
                {minimized ? "+" : "−"}
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setActive(null);
                  setMessages([]);
                }}
                aria-label="Close chat"
              >
                ×
              </button>
            </div>
          </div>
          {!minimized && (
            <>
              <div className="chat-history">
                {messages.map((message) => (
                  <div
                    className={`chat-message ${message.sender === user.id ? "mine" : ""}`}
                    key={message.id}
                  >
                    <p>{message.text}</p>
                    <time>{new Date(message.createdAt).toLocaleString()}</time>
                  </div>
                ))}
                <div ref={end} />
              </div>
              <form className="chat-compose" onSubmit={send}>
                <input
                  aria-label="Message"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={1000}
                  placeholder="Write a message"
                />
                <button disabled={busy || !text.trim()}>Send</button>
              </form>
            </>
          )}
        </aside>
      )}
    </section>
  );
}
