/**
 * Sign in or create an account. Username and one password (PLAN.md §11).
 *
 * The password is stretched with Argon2id right here before anything is sent
 * (`derive.ts`), which takes a second or two on a phone — hence the explicit
 * "Signing in…" rather than a frozen button.
 */

import { useState, type FormEvent } from 'react';

import { MIN_PASSWORD_LENGTH, USERNAME_PATTERN, normalizeUsername } from '@/auth/derive';
import { signIn } from '@/auth/session';

type Mode = 'login' | 'signup';

export function LoginScreen({ lastUser, reason }: { lastUser?: string; reason?: string }) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState(lastUser ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function problem(): string | null {
    if (!USERNAME_PATTERN.test(normalizeUsername(username))) {
      return 'Usernames are 3–32 characters: letters, numbers, and _ . -';
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Passwords are at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (mode === 'signup' && password !== confirm) return 'The passwords do not match.';
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = problem();
    setError(found);
    if (found !== null) return;

    setBusy(true);
    try {
      await signIn(mode, username, password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
    setConfirm('');
  }

  return (
    <div className="authscreen">
      <form className="authscreen__card" onSubmit={(event) => void submit(event)} noValidate>
        <h1 className="screen__title">Meal Prep</h1>

        {/* The app's segmented control, so it reads as a switch and the submit
            button below stays the only primary action on the card. */}
        <div className="segmented segmented--full authscreen__modes" role="tablist">
          {(['login', 'signup'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={mode === option}
              className={`segmented__option${mode === option ? ' segmented__option--on' : ''}`}
              onClick={() => switchTo(option)}
            >
              {option === 'login' ? 'Sign in' : 'New account'}
            </button>
          ))}
        </div>

        {reason !== undefined && <p className="notice notice__body">{reason}</p>}

        <label className="field">
          <span className="field__label">Username</span>
          <input
            className="field__input"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">
            Password{' '}
            {mode === 'signup' && (
              <span className="field__unit">({MIN_PASSWORD_LENGTH}+ characters)</span>
            )}
          </span>
          <input
            className="field__input"
            type="password"
            name="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {mode === 'signup' && (
          <label className="field">
            <span className="field__label">Password again</span>
            <input
              className="field__input"
              type="password"
              name="confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
        )}

        {error !== null && (
          <p className="notice notice--error notice__body" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy
            ? mode === 'login'
              ? 'Signing in…'
              : 'Creating account…'
            : mode === 'login'
              ? 'Sign in'
              : 'Create account'}
        </button>
      </form>
    </div>
  );
}
