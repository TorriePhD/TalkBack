import { useState } from 'react';
import { signInWithEmail, signUpWithEmail } from '../../../lib/auth';
import { supabaseConfigError } from '../../../lib/supabase';

export function AuthPanel() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<'signup' | 'login' | null>(null);

  const handleSignUp = async () => {
    setError(null);
    setInfo(null);
    setActiveAction('signup');

    try {
      const result = await signUpWithEmail({ email, password });
      setInfo(
        result.requiresEmailConfirmation
          ? 'Account created. Check your email to confirm the account before logging in.'
          : 'Account created and signed in.',
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to create the account.',
      );
    } finally {
      setActiveAction(null);
    }
  };

  const handleLogin = async () => {
    setError(null);
    setInfo(null);
    setActiveAction('login');

    try {
      await signInWithEmail({ email, password });
      setInfo('Logged in.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to log in.');
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <section className="surface auth-shell">
      <div className="section-header">
        <div>
          <h2>Sign In</h2>
          <p>
            This app now uses Supabase Auth. Create an account with an email and password, then
            only your own friendships and rounds will load.
          </p>
        </div>
      </div>

      {supabaseConfigError ? <div className="error-banner">{supabaseConfigError}</div> : null}

      <div className="stack">
        <div className="field">
          <label htmlFor="authEmail">Email address</label>
          <input
            id="authEmail"
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            value={email}
          />
        </div>

        <div className="field">
          <label htmlFor="authPassword">Password</label>
          <input
            id="authPassword"
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 6 characters"
            type="password"
            value={password}
          />
        </div>

        <div className="button-row">
          <button
            className="button primary"
            disabled={!email.trim() || !password.trim() || activeAction !== null}
            onClick={() => {
              void handleLogin();
            }}
            type="button"
          >
            {activeAction === 'login' ? 'Logging in...' : 'Log in'}
          </button>
          <button
            className="button secondary"
            disabled={!email.trim() || !password.trim() || activeAction !== null}
            onClick={() => {
              void handleSignUp();
            }}
            type="button"
          >
            {activeAction === 'signup' ? 'Creating account...' : 'Create account'}
          </button>
        </div>

        <div className="helper-text">
          Supabase can also handle OAuth providers like Google or GitHub, but this app is wired
          for email/password accounts so friend requests can target exact email addresses.
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <div className="info-banner">{info}</div> : null}
      </div>
    </section>
  );
}
