export async function api(path, options = {}) {
  let response;
  try {
    response=await fetch(`/api${path}`,{
      credentials:'include', headers:{'Content-Type':'application/json'},
      ...options, body:options.body===undefined ? undefined : JSON.stringify(options.body),
    });
  } catch { throw new Error('Cannot reach the game server. Check that Express is running.'); }
  const data=await response.json().catch(()=>({error:'The server returned an unreadable response.'}));
  if(!response.ok) { const error=new Error(data.error || 'Request failed.'); error.status=response.status; throw error; }
  return data;
}
