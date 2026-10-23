import { useEffect, useState } from 'react';
import { api } from '../api';
export default function Profile() {
  const [profile,setProfile]=useState(null);const [history,setHistory]=useState([]);const [page,setPage]=useState(1);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let current=true;setLoading(true);setError('');
    Promise.all([api('/profile'),api(`/history?page=${page}`)]).then(([profile,history])=>{if(current){setProfile(profile);setHistory(history.history);}})
      .catch(error=>{if(current)setError(error.message);}).finally(()=>{if(current)setLoading(false);});
    return ()=>{current=false;};
  },[page]);
  const statistics=profile?.statistics;
  return <><div className="page-heading"><div><span className="eyebrow">YOUR TIME AT THE TABLE</span><h1>{profile?.user.username || 'Your profile'}</h1><p>{profile?.user.email} {profile&&`· Joined ${new Date(profile.user.createdAt).toLocaleDateString()}`}</p></div></div>
    {error&&<p className="notice error" role="alert">{error}</p>}{loading&&<p role="status">Loading your records…</p>}
    {statistics&&<div className="statistics-grid">{[['Games played',statistics.totalGames],['Wins',statistics.wins],['Losses',statistics.losses],['Pushes',statistics.pushes],['Win percentage',`${statistics.winPercentage}%`]].map(([label,value])=><div className="panel statistic" key={label}><span className="eyebrow">{label}</span><strong>{value}</strong></div>)}</div>}
    <section className="panel history"><div className="section-heading"><div><span className="eyebrow">ONE HAND AT A TIME</span><h2>Round history</h2></div><small>Page {page} · 20 rounds per page</small></div>
      <div className="table-scroll"><table><thead><tr><th>Date</th><th>Table</th><th>Your total</th><th>Dealer</th><th>Result</th></tr></thead><tbody>{history.map(round=><tr key={round._id}><td>{new Date(round.playedAt).toLocaleString()}</td><td>{round.mode==='single'?'Single player':'Multiplayer'}</td><td>{round.playerTotal}</td><td>{round.dealerTotal}</td><td><span className={`result-badge ${round.result}`}>{round.result}</span></td></tr>)}</tbody></table></div>
      {!loading&&!history.length&&<p className="empty-history">No rounds on this page. Your completed hands will appear here.</p>}
      <div className="pagination"><button className="secondary small" disabled={page===1||loading} onClick={()=>setPage(page-1)}>← Previous</button><button className="secondary small" disabled={history.length<20||loading} onClick={()=>setPage(page+1)}>Next →</button></div></section>
    <p className="fine-print">Win percentage = wins ÷ all completed rounds × 100. Pushes count as completed games.</p></>;
}
