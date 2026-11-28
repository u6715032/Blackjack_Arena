import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "../AuthContext";
import RoomLobby, { PlayerList } from "../components/RoomLobby";
import { BlackjackTable } from "../components/GameTable";
import BetControl from "../components/BetControl";

export default function Multiplayer() {
  const { user, refreshBalance } = useAuth();
  const [wager, setWager] = useState("1");
  const socketRef = useRef(null);
  const [room, setRoom] = useState(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  function receiveRoom(nextRoom) {
    const snapshot = nextRoom && {
      ...nextRoom,
      serverTimeOffset: nextRoom.serverTime - Date.now(),
    };
    setRoom((current) => {
      if (
        current?.game &&
        nextRoom?.game?.id === current.game.id &&
        nextRoom.game.revision < current.game.revision
      )
        return current;
      return snapshot;
    });
    refreshBalance().catch(() => {});
  }
  function send(event, data = {}) {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket?.connected)
        return reject(new Error("Reconnect before sending a room action."));
      socket.timeout(20000).emit(event, data, (timeout, response) => {
        if (timeout)
          return reject(
            new Error(
              "The server did not respond. Reconnect to refresh the room.",
            ),
          );
        if (!response.ok) return reject(new Error(response.error));
        resolve(response.data);
      });
    });
  }
  useEffect(() => {
    const socket = io({ withCredentials: true, autoConnect: false });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      setError("");
      send("room:get")
        .then(receiveRoom)
        .catch((error) => setError(error.message));
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (error) => setError(error.message));
    socket.on("room:update", receiveRoom);
    socket.connect();
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);
  async function update(event, data) {
    setBusy(true);
    setError("");
    try {
      receiveRoom(await send(event, data));
    } catch (error) {
      setError(error.message);
      await send("room:get")
        .then(receiveRoom)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const game = room?.game;
  function action(action) {
    return update("game:action", {
      action,
      roundId: game.id,
      revision: game.revision,
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Multiplayer</h1>
        </div>
        <span className="outline-tag">
          <span className={`status-dot ${connected ? "gold" : ""}`} />
          {connected ? "CONNECTED" : "CONNECTING…"}
        </span>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!connected && (
        <p className="notice">
          Connection interrupted. Your hand stands when your last connection
          closes. Reconnecting will restore the room if it is still active.
        </p>
      )}
      {!room ? (
        <div className="multiplayer-menu">
          <section className="panel">
            <span className="mode-icon">♣</span>
            <span className="eyebrow">SET THE TABLE</span>
            <h2>Create a room</h2>
            <p>
              Open a private room and invite friends with a six-character code.
            </p>
            <button
              disabled={!connected || busy}
              onClick={() => update("room:create")}
            >
              Create private room →
            </button>
          </section>
          <form
            className="panel"
            onSubmit={(event) => {
              event.preventDefault();
              update("room:join", { code });
            }}
          >
            <span className="mode-icon">♠</span>
            <span className="eyebrow">PULL UP A CHAIR</span>
            <h2>Join your friends</h2>
            <label>
              Room code
              <input
                value={code}
                onChange={(event) =>
                  setCode(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z2-9]/g, "")
                      .slice(0, 6),
                  )
                }
                placeholder="ABC234"
                autoComplete="off"
                required
                minLength={6}
                maxLength={6}
              />
            </label>
            <button
              className="secondary"
              disabled={!connected || busy || code.length !== 6}
            >
              Join room →
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="room-toolbar">
            <span>
              ROOM <b>{room.code}</b> · {room.players.length}/4 players
            </span>
            <button
              className="text-button"
              disabled={busy || !connected}
              onClick={() => update("room:leave")}
            >
              Leave room ↗
            </button>
          </div>
          {(!game || (game.status === "complete" && game.saved)) && (
            <div className="round-setup panel">
              <BetControl
                amount={wager}
                onChange={setWager}
                balance={user.chips}
                disabled={busy || !connected}
              />
              <button
                disabled={
                  busy ||
                  !connected ||
                  !Number.isSafeInteger(Number(wager)) ||
                  Number(wager) < 1 ||
                  Number(wager) > user.chips
                }
                onClick={() => update("room:wager", { amount: Number(wager) })}
              >
                Set wager
              </button>
              <span>
                Current wager:{" "}
                {room.players.find((player) => player.id === user.id)?.wager}{" "}
                chips
              </span>
            </div>
          )}
          {!game ? (
            <RoomLobby
              room={room}
              userId={user.id}
              onStart={() => update("room:start")}
              busy={busy || !connected}
            />
          ) : (
            <>
              <BlackjackTable
                game={game}
                serverTimeOffset={room.serverTimeOffset}
                userId={user.id}
                busy={busy || !connected}
                onAction={action}
                onAdvice={() =>
                  send("game:advice", {
                    roundId: game.id,
                    revision: game.revision,
                  })
                }
              />
              {game.saveError && (
                <div className="notice" role="alert">
                  <p>{game.saveError}</p>
                  <button
                    disabled={busy || !connected}
                    onClick={() => update("game:save")}
                  >
                    Retry saving
                  </button>
                </div>
              )}
              {game.status === "complete" &&
                game.saved &&
                (room.hostId === user.id ? (
                  <button
                    className="next-round"
                    disabled={
                      busy ||
                      !connected ||
                      room.players.filter((player) => player.connected).length <
                        2
                    }
                    onClick={() => update("room:start")}
                  >
                    Deal next round →
                  </button>
                ) : (
                  <p>Waiting for the host to deal the next round.</p>
                ))}
              <PlayerList
                players={room.players}
                hostId={room.hostId}
                userId={user.id}
              />
            </>
          )}
        </>
      )}
      <p className="table-footnote">
        The server controls every card and turn. Active rooms reset if the
        server restarts.
      </p>
    </>
  );
}
