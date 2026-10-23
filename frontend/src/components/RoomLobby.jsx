export function PlayerList({players,hostId,userId}) {
  return <ul className="player-list">{players.map((player,index)=><li key={player.id}><span className="player-number">0{index+1}</span><span>{player.username}{player.id===userId?' (you)':''}<small>{player.id===hostId?'Host':'Player'}</small></span>
    <span className={player.connected?'connection-online':'muted'}>{player.connected?'Connected':'Disconnected'}</span></li>)}</ul>;
}
export default function RoomLobby({room,userId,onStart,busy}) {
  return <section className="panel lobby"><span className="eyebrow">YOUR PRIVATE TABLE</span><h2>Good company. Same dealer.</h2><p>Share this code with your friends. You need 2–4 connected players to begin.</p>
    <div className="room-code" aria-label="Room code">{room.code}</div><PlayerList players={room.players} hostId={room.hostId} userId={userId}/>
    {room.hostId===userId?<button disabled={busy||room.players.filter(player=>player.connected).length<2} onClick={onStart}>Start round →</button>:<p className="muted">Waiting for the host to start the round.</p>}
    <p className="fine-print">If your last connection closes, your hand stands automatically. Rejoining keeps your seat for the next round.</p></section>;
}
