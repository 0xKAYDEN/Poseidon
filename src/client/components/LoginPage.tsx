import React, { useEffect, useState } from 'react';
import type { ApiClient } from '../api';

interface LoginPageProps {
  api: ApiClient;
  onLoginSuccess: (token: string, username: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ api, onLoginSuccess }) => {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('testadmin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoHint, setDemoHint] = useState<{ defaultUsername: string; hasDefaultDemoPassword: boolean } | null>(null);

  useEffect(() => {
    api
      .getAuthInfo()
      .then(info => {
        setDemoHint(info);
        if (info.defaultUsername && authMode === 'login') {
          setUsername(info.defaultUsername);
        }
      })
      .catch(() => {});
  }, [api]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res =
        authMode === 'login'
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password);
      onLoginSuccess(res.token, res.username);
    } catch (err) {
      setError((err as Error).message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">Poseidon Automation</h1>
        <p className="login-subtitle">
          Sign in to design Lua blueprints, query the integrated database, and manage server executions.
        </p>

        <div className="segmented-control" style={{ marginBottom: '20px' }}>
          <button
            type="button"
            className={authMode === 'login' ? 'active' : ''}
            onClick={() => {
              setAuthMode('login');
              setError(null);
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={authMode === 'register' ? 'active' : ''}
            onClick={() => {
              setAuthMode('register');
              setUsername('');
              setPassword('');
              setError(null);
            }}
          >
            Create Account
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="form-field">
          <label htmlFor="poseidon-username">Username</label>
          <input
            id="poseidon-username"
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="Enter username"
            required
          />
        </div>

        <div className="form-field">
          <label htmlFor="poseidon-password">Password</label>
          <input
            id="poseidon-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
            placeholder={authMode === 'login' ? 'Enter password' : 'Minimum 4 characters'}
            required
          />
        </div>

        <button
          type="submit"
          className="btn-accent"
          disabled={loading}
          style={{ width: '100%', justifyContent: 'center', padding: '9px 14px', marginTop: '4px' }}
        >
          {loading
            ? authMode === 'login'
              ? 'Signing in...'
              : 'Creating account...'
            : authMode === 'login'
              ? 'Sign In'
              : 'Create Account'}
        </button>

        {authMode === 'login' && (
          <div className="login-hint">
            Test admin account: <strong className="mono">testadmin</strong> /{' '}
            <strong className="mono">poseidon123</strong>
            {demoHint?.hasDefaultDemoPassword && (
              <span>
                {' '}
                · Default: <strong className="mono">{demoHint.defaultUsername}</strong> /{' '}
                <strong className="mono">poseidon</strong>
              </span>
            )}
          </div>
        )}
      </form>
    </div>
  );
};
