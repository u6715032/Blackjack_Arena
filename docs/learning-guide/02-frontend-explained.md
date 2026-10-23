# 02 — React frontend explained

The frontend translates server state into cards, messages, and buttons. It does
not store the authoritative shoe or calculate official results.

## Components and props

A component is a function that returns JSX. Props are values given by its parent.
The actual table passes one permitted card to a reusable component:

```jsx
<PlayingCard key={index} card={card} />
```

`PlayingCard` uses `card.rank` and `card.suit`. If `card.hidden` is true, it draws
a patterned card back. The same component is used by the home illustration, human
hands, bots, and dealer. `PlayerHand` receives `player`, `active`, and `isYou`.
It does not fetch its own cards; the parent supplies them.

`components/GameTable.jsx` groups closely related small components so students
can follow the table without opening dozens of files:

| Component | Responsibility |
| --- | --- |
| `PlayingCard` | One visible or hidden card |
| `PlayerHand` | Player name, cards, total, status |
| `DealerHand` | Dealer cards and permitted total |
| `AIPlayerDisplay` | Bot label around a player hand |
| `ActionButtons` | HIT/STAND controls |
| `GameResult` | Personal round outcome and save status |
| `StrategyAssistant` | Request and display advice |
| `BlackjackTable` | Compose the complete game display |

`Navbar`, `RoomLobby`, and `PlayerList` handle navigation and waiting-room display.

## State, hooks, and context

State is information that can change and cause React to render again. In the
actual single-player page:

```jsx
const [game, setGame] = useState(null);
const [botCount, setBotCount] = useState(1);
```

The server response replaces `game`. Selecting tablemates changes `botCount`.
Neither operation changes the server until the page sends a request.

`useEffect` performs work connected to a component's lifecycle. The single-player
page loads an existing game on mount. The multiplayer page creates its socket on
mount and disconnects it on unmount. This cleanup prevents abandoned connections.
`useRef` holds that socket without rerendering whenever its object changes.

`AuthProvider` uses context to share `user`, `loading`, `authenticate`, and
`logout` between pages and navigation. This avoids passing login props through
every table component. JWT secrets and password hashes never enter that context.
The HTTP-only session cookie is handled by the browser, not read by React.

## API communication

`api.js` sends requests to Express under `/api`. A real action includes the round
and revision so the backend can reject an old double-click:

```js
{ action, roundId: game.id, revision: game.revision }
```

After a successful action, `SinglePlayer` displays the returned game. After a
failed action, it also reloads the current game to recover from a stale screen.
`busy` disables repeated clicks while an action is processing. Server validation
is still required because a malicious client can ignore disabled buttons.

The strategy assistant clears advice when the round ID or revision changes. It
only displays advice tagged with the current state. Clicking “Play hit/stand”
sends a normal human action; receiving advice alone never sends an action.

Multiplayer uses acknowledgements: an emitted event receives `{ok, data}` or
`{ok:false,error}`. `room:update` broadcasts replace room state in every client.
Offline buttons cannot queue gameplay moves for a later turn.

## Layout and accessibility

Plain CSS uses dark green surfaces, gold controls, responsive grids, and wrapping
cards. Media queries adapt to small screens. Text describes whose turn it is;
color is not the only indication. Form inputs have labels and password/username
hints use `aria-describedby`. Status and error messages use live regions or
`role="alert"` where useful. System font fallbacks work when Google Fonts cannot load.

## Exercise

Add a purely visual “cards in hand” label to `PlayerHand` using
`player.hand.length`. Test it on a narrow viewport. Then remove it or commit it
as a reviewed improvement. Do not introduce another source of game totals.
