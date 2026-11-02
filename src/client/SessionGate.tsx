import { useEffect, useState, type ReactNode } from 'react';
export type SessionUser = { id: string; username: string; role: 'owner' | 'member' };
export default function SessionGate({ children }: { children: (user: SessionUser, logout: () => void) => ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null); const [loading, setLoading] = useState(true); const [message, setMessage] = useState(''); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [ownerToken, setOwnerToken] = useState('');
  useEffect(() => {
    const start = async () => {
      try {
        const invite = new URLSearchParams(location.hash.slice(1)).get('invite');
        if (invite) {
          history.replaceState(null, '', location.pathname);
          const r = await fetch('/auth/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: invite }) });
          const data = await r.json() as { user?: SessionUser; error?: string }; if (!r.ok) throw new Error(data.error); setUser(data.user || null);
        } else {
          const token = sessionStorage.getItem('patex-token');
          const r = await fetch('/auth/session', { headers: token ? { authorization: `Bearer ${token}` } : {} }); const data = await r.json() as { user: SessionUser | null }; setUser(data.user);
        }
      } catch (error) { setMessage((error as Error).message); } finally { setLoading(false); }
    };
    void start();
  }, []);
  const login = async () => {
    setLoading(true);
    try {
      if (ownerToken) {
        const r = await fetch('/auth/owner', { method: 'POST', headers: { authorization: `Bearer ${ownerToken}` } }); const data = await r.json() as { user: SessionUser | null }; if (!data.user) throw new Error('Invalid owner access token'); sessionStorage.removeItem('patex-token'); setUser(data.user);
      } else {
        const r = await fetch('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) }); const data = await r.json() as { user?: SessionUser; error?: string }; if (!r.ok) throw new Error(data.error); sessionStorage.removeItem('patex-token'); setUser(data.user || null);
      }
      setPassword(''); setOwnerToken('');
    } catch (error) { setMessage((error as Error).message); } finally { setLoading(false); }
  };
  if (user) return children(user, () => { void fetch('/auth/logout', { method: 'POST' }).finally(() => { sessionStorage.removeItem('patex-token'); setUser(null); }); });
  return <div className="login-screen"><form className="project-dialog" aria-label="Sign in to Patex" onSubmit={event => { event.preventDefault(); void login(); }}><h1>Patex</h1><p>Write, calculate, and publish in your private workspace.</p><label>Username<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)}/></label><details><summary>Owner access token</summary><input type="password" aria-label="Owner access token" value={ownerToken} onChange={event => setOwnerToken(event.target.value)}/></details>{message && <p role="alert">{message}</p>}<button className="primary" disabled={loading}>{loading ? 'Connecting…' : 'Sign in'}</button><small>New pilot users receive a private invitation from the workspace owner.</small></form></div>;
}
