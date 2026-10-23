import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { BlackjackTable } from '../components/GameTable';

export default function SinglePlayer() {
  const {user}=useAuth(); const [game,setGame]=useState(null); const [botCount,setBotCount]=useState(1);
  const [busy,setBusy]=useState(true); const [error,setError]=useState('');
  useEffect(()=>{api('/games/single').then(data=>setGame(data.game)).catch(error=>setError(error.message)).finally(()=>setBusy(false));},[]);
  async function update(path,body) {
    setBusy(true);setError('');
    try {const data=await api(path,{method:'POST',body});setGame(data.game);}
    catch(error){setError(error.message); const current=await api('/games/single').catch(()=>null); if(current)setGame(current.game);}
    finally{setBusy(false);}
  }
  const canStart=!game || (game.status==='complete'&&game.saved);
  function action(action) {return update('/games/single/action',{action,roundId:game.id,revision:game.revision});}
  return <><div className="page-heading"><div><span className="eyebrow">YOUR PACE. YOUR TABLE.</span><h1>Single player</h1><p>Play the dealer. Learn alongside the network.</p></div><span className="outline-tag">NO BETTING · JUST BLACKJACK</span></div>
    {error&&<p className="notice error" role="alert">{error}</p>}
    {canStart&&<div className="round-setup panel"><label>Neural network tablemates<select value={botCount} onChange={event=>setBotCount(Number(event.target.value))}><option value={0}>Just me</option><option value={1}>1 neural network bot</option><option value={2}>2 neural network bots</option></select></label>
      <button disabled={busy} onClick={()=>update('/games/single',{botCount})}>{busy?'Dealing…':game?'Deal next round →':'Deal my first hand →'}</button></div>}
    {game&&(game.aiError||game.saveError)&&<div className="notice" role="alert"><p>{game.aiError||game.saveError}</p><button disabled={busy} onClick={()=>update('/games/single/retry')}>{game.aiError?'Retry AI':'Retry saving'}</button></div>}
    {game?<BlackjackTable game={game} userId={user.id} busy={busy} onAction={action} onAdvice={()=>api('/games/single/advice',{method:'POST',body:{roundId:game.id,revision:game.revision}})}/>
      :<div className="empty-table"><span>♠</span><h2>A fresh shoe. A fresh start.</h2><p>{busy?'Loading your table…':'Choose your tablemates and deal a hand.'}</p></div>}
    <p className="table-footnote">Six decks · Ace is 1 or 11 · Dealer stands on soft 17 · Natural Blackjack beats a normal 21</p></>;
}
