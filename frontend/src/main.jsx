import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import AuthPage from './pages/AuthPage';
import SinglePlayer from './pages/SinglePlayer';
import Multiplayer from './pages/Multiplayer';
import Profile from './pages/Profile';
import './styles.css';

function Protected({children}) {
  const {user,loading}=useAuth();
  if(loading) return <p role="status">Loading your session…</p>;
  return user?children:<Navigate to="/login" replace/>;
}
function App() {
  const {error}=useAuth();
  return <><Navbar/><main>{error&&<p className="notice error" role="alert">{error}</p>}<Routes>
    <Route path="/" element={<Home/>}/><Route path="/login" element={<AuthPage mode="login"/>}/><Route path="/register" element={<AuthPage mode="register"/>}/>
    <Route path="/single" element={<Protected><SinglePlayer/></Protected>}/><Route path="/multiplayer" element={<Protected><Multiplayer/></Protected>}/><Route path="/profile" element={<Protected><Profile/></Protected>}/>
    <Route path="*" element={<div className="empty-table"><h1>That table doesn’t exist.</h1><Link to="/">Back to the arena →</Link></div>}/>
  </Routes></main><footer><Link className="brand" to="/">♠ BLACKJACK ARENA</Link><span>A student-built game. A shared learning experience.</span><small>No real money. No betting.</small></footer></>;
}
createRoot(document.getElementById('root')).render(<BrowserRouter><AuthProvider><App/></AuthProvider></BrowserRouter>);
