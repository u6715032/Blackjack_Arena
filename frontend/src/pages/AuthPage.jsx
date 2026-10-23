import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

export default function AuthPage({mode}) {
  const {user,authenticate}=useAuth(); const navigate=useNavigate();
  const [values,setValues]=useState({username:'',email:'',password:''}); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const register=mode==='register';
  if(user) return <Navigate to="/single" replace/>;
  async function submit(event) {
    event.preventDefault();setBusy(true);setError('');
    try {await authenticate(mode,values);navigate('/single');} catch(error){setError(error.message);} finally{setBusy(false);}
  }
  function field(event) {setValues({...values,[event.target.name]:event.target.value});}
  return <section className="auth-page"><div className="auth-intro"><span className="eyebrow">BLACKJACK ARENA</span><h1>{register?'Your seat is waiting.':'Welcome back to the table.'}</h1><p>A classic card game, good company, and a chance to learn something with every hand.</p><span className="auth-spade">♠</span></div>
    <form className="panel auth-form" onSubmit={submit}><span className="eyebrow">{register?'JOIN THE ARENA':'TAKE YOUR SEAT'}</span><h2>{register?'Create an account':'Log in'}</h2>
      {register&&<label>Username<input name="username" autoComplete="username" value={values.username} onChange={field} required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+"/><small>3–24 letters, numbers, or underscores.</small></label>}
      <label>Email<input type="email" name="email" autoComplete="email" value={values.email} onChange={field} required maxLength={254}/></label>
      <label>Password<input type="password" name="password" autoComplete={register?'new-password':'current-password'} value={values.password} onChange={field} required minLength={10} maxLength={72}/><small>At least 10 characters; maximum 72 UTF-8 bytes.</small></label>
      {error&&<p className="notice error" role="alert">{error}</p>}<button disabled={busy}>{busy?'Please wait…':register?'Create account →':'Log in →'}</button>
      <p>{register?'Already have an account?':'New to the arena?'} <Link to={register?'/login':'/register'}>{register?'Log in':'Create an account'}</Link></p></form></section>;
}
