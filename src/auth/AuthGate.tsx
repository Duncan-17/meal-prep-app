/**
 * Nothing of the app renders until someone is signed in (PLAN.md §11).
 *
 * Offline is not signed out: with no connection, the account that owns this
 * device's data is trusted, so the app still opens on a train. The server
 * checks the session again on the next sync, and a rejected session brings
 * this screen back without touching local data.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import {
  cancelClaim,
  checkSession,
  eraseThisDevice,
  getAuthState,
  keepLocalData,
  sessionEnded,
  subscribeAuth,
} from '@/auth/session';
import { LoginScreen } from '@/auth/LoginScreen';
import { ensureDefaults } from '@/db/init';
import { onSyncSignedOut, resumeSync, startSync } from '@/db/sync';

let started = false;

/** Seed defaults, then sync — once per page, after the first sign-in. */
function startApp() {
  if (started) {
    resumeSync();
    return;
  }
  started = true;
  // Sync starts AFTER the seeds so its first scan sees them (and stamps them
  // 0, so they lose to real goals already in the database — `ownTimestamp`).
  void ensureDefaults()
    .catch((error: unknown) => console.error('Failed to seed defaults', error))
    .then(() => startSync());
}

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useSyncExternalStore(subscribeAuth, getAuthState);

  useEffect(() => {
    void checkSession();
    return onSyncSignedOut(() => void sessionEnded());
  }, []);

  useEffect(() => {
    if (auth.status === 'signedIn') startApp();
  }, [auth.status]);

  switch (auth.status) {
    case 'checking':
      return <div className="authscreen" aria-busy="true" />;
    case 'signedOut':
      return <LoginScreen {...auth} />;
    case 'claim':
      return <ClaimScreen {...auth} />;
    case 'signedIn':
      return children;
  }
}

function ClaimScreen({
  username,
  otherOwner,
  pending,
}: {
  username: string;
  otherOwner?: string;
  pending: number;
}) {
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) => {
    setBusy(true);
    void action().finally(() => setBusy(false));
  };

  return (
    <div className="authscreen">
      <div className="authscreen__card">
        {otherOwner === undefined ? (
          <>
            <h1 className="screen__title">This device already has data</h1>
            <p className="screen__sub">
              It was saved before accounts existed. Keep it in {username}’s account, or erase it
              from this device?
            </p>
            <div className="authscreen__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => run(keepLocalData)}
              >
                Keep it
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy}
                onClick={() => run(eraseThisDevice)}
              >
                Erase it
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="screen__title">This device has {otherOwner}’s data</h1>
            <p className="screen__sub">
              To sign in as {username}, it has to be erased from this device. {otherOwner}’s synced
              data stays safe in their account.
              {pending > 0 &&
                ` ${pending} change${pending === 1 ? '' : 's'} from this device never reached the server and will be lost.`}
            </p>
            <div className="authscreen__actions">
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy}
                onClick={() => run(eraseThisDevice)}
              >
                Erase and continue
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => run(cancelClaim)}
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
