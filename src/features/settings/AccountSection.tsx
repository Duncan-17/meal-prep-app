/**
 * Who is signed in, and the three things an account can do here. PLAN.md §11.
 *
 * Signing out erases this device's copy — the next person to sign in on it
 * starts empty — so it uploads first and says so if anything could not go.
 * A forgotten password is reset by the admin from the command line; there is
 * no "forgot password" link because nothing here sends email.
 */

import { useState, useSyncExternalStore, type FormEvent } from 'react';

import { MIN_PASSWORD_LENGTH } from '@/auth/derive';
import {
  changePassword,
  getAuthState,
  signOut,
  signOutOtherDevices,
  subscribeAuth,
} from '@/auth/session';
import { db } from '@/db/schema';
import { syncNow } from '@/db/sync';

export function AccountSection() {
  const auth = useSyncExternalStore(subscribeAuth, getAuthState);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [unsynced, setUnsynced] = useState<number | null>(null);

  if (auth.status !== 'signedIn') return null;

  async function attempt(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (success !== undefined) setMessage({ text: success, error: false });
    } catch (caught) {
      setMessage({ text: caught instanceof Error ? caught.message : String(caught), error: true });
    } finally {
      setBusy(false);
    }
  }

  /** Upload first; only ask for confirmation if something is still waiting. */
  async function startSignOut() {
    await syncNow();
    const pending = await db.syncOutbox.count();
    if (pending > 0) setUnsynced(pending);
    else await signOut();
  }

  return (
    <section className="section">
      <h2 className="section__title">Account</h2>
      <p className="screen__sub">Signed in as {auth.username}</p>

      {message !== null && (
        <p className={`notice notice__body${message.error ? ' notice--error' : ''}`} role="status">
          {message.text}
        </p>
      )}

      {unsynced !== null ? (
        <div className="notice notice--warn">
          <p className="notice__title">
            {unsynced} change{unsynced === 1 ? '' : 's'} not uploaded
          </p>
          <p className="notice__body">
            Signing out erases this device’s copy, so they would be lost.
          </p>
          <div className="account__actions">
            <button type="button" className="btn" onClick={() => setUnsynced(null)}>
              Stay signed in
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={() => void attempt(signOut)}
            >
              Sign out anyway
            </button>
          </div>
        </div>
      ) : (
        <div className="account__actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => setChanging(!changing)}
            aria-expanded={changing}
          >
            Change password
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void attempt(signOutOtherDevices, 'Every other device has been signed out.')
            }
          >
            Sign out other devices
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void attempt(startSignOut)}
          >
            Sign out
          </button>
        </div>
      )}

      {changing && (
        <PasswordForm
          busy={busy}
          onSubmit={(current, next) =>
            attempt(async () => {
              await changePassword(current, next);
              setChanging(false);
            }, 'Password changed. Other devices have been signed out.')
          }
        />
      )}
    </section>
  );
}

function PasswordForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (current: string, next: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (next.length < MIN_PASSWORD_LENGTH) {
      setProblem(`Passwords are at least ${MIN_PASSWORD_LENGTH} characters.`);
    } else if (next !== again) {
      setProblem('The new passwords do not match.');
    } else {
      setProblem(null);
      void onSubmit(current, next);
    }
  }

  return (
    <form className="account__form" onSubmit={submit} noValidate>
      <label className="field">
        <span className="field__label">Current password</span>
        <input
          className="field__input"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">
          New password <span className="field__unit">({MIN_PASSWORD_LENGTH}+ characters)</span>
        </span>
        <input
          className="field__input"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">New password again</span>
        <input
          className="field__input"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(event) => setAgain(event.target.value)}
        />
      </label>
      {problem !== null && (
        <p className="notice notice--error notice__body" role="alert">
          {problem}
        </p>
      )}
      <button type="submit" className="btn btn--primary" disabled={busy}>
        {busy ? 'Changing…' : 'Change password'}
      </button>
    </form>
  );
}
