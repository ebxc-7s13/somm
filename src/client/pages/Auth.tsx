import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useDocumentTitle } from '../hooks';
import { Link, useNavigate, useQuery } from '../router';
import { useAuth } from '../state';

function AuthForm({ mode }: { mode: 'signin' | 'signup' }) {
  useDocumentTitle(mode === 'signin' ? 'Sign in' : 'Create account');
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const query = useQuery();
  const next = query.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(mode === 'signin' ? '/api/auth/signin' : '/api/auth/signup', { handle, password, ...(mode === 'signup' && displayName ? { displayName } : {}) });
      const me = await refresh();
      navigate(safeNext ?? (mode === 'signup' || !me?.counts.tracks ? '/welcome' : '/map'), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const demo = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/demo');
      await refresh();
      navigate('/welcome', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 520 }}>
      <p className="eyebrow">{mode === 'signin' ? 'Welcome back' : 'Join SOMM'}</p>
      <h1>{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
      <p className="muted">
        {mode === 'signup'
          ? 'Pick a pseudonymous handle. No email, real name or birthday — just enough to keep your map and your Trees.'
          : 'Use your SOMM handle and password. SOMM never asks for your Spotify, YouTube or Apple password.'}
      </p>
      <form className="panel" onSubmit={submit} noValidate style={{ marginTop: 'var(--space-5)' }}>
        <div className="field">
          <label htmlFor="handle">Handle</label>
          <input
            id="handle"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            required
            minLength={3}
            maxLength={24}
            aria-describedby="handle-hint"
          />
          <span id="handle-hint" className="hint">
            3–24 characters: letters, numbers, dot, dash or underscore.
          </span>
        </div>
        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="display">Display name (optional)</label>
            <input id="display" className="input" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" />
          </div>
        )}
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
            aria-describedby={mode === 'signup' ? 'pw-hint' : undefined}
          />
          {mode === 'signup' && (
            <span id="pw-hint" className="hint">
              At least 10 characters. There is no email recovery, so keep it somewhere safe.
            </span>
          )}
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row-between" style={{ marginTop: 'var(--space-4)' }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <Link to={mode === 'signin' ? '/signup' : '/signin'} className="small">
            {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </Link>
        </div>
      </form>
      <div className="panel panel-tight" style={{ marginTop: 'var(--space-4)' }}>
        <div className="row-between">
          <span className="small muted">Just looking? The demo account is deleted after 24 hours.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={demo} disabled={busy}>
            Try the demo
          </button>
        </div>
      </div>
    </div>
  );
}

export function SignIn() {
  return <AuthForm mode="signin" />;
}

export function SignUp() {
  return <AuthForm mode="signup" />;
}
