/**
 * Where the data lives, said plainly — and a button to sync now.
 *
 * Sync runs on its own (db/sync.ts); this only reports it. Offline is
 * presented as normal rather than as an error, because it is: edits are safe
 * on the device and go up when there is a connection.
 */

import { useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '@/db/schema';
import {
  fetchServerStats,
  getSyncStatus,
  redownloadEverything,
  subscribeSyncStatus,
  syncNow,
  type ServerStats,
  type SyncStatus,
} from '@/db/sync';

export function SyncSection() {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const { title, body, tone } = describe(status);

  return (
    <section className="section">
      <h2 className="section__title">Sync</h2>
      <div
        className={`notice${tone === 'warn' ? ' notice--warn' : tone === 'error' ? ' notice--error' : ''}`}
      >
        <p className="notice__title">{title}</p>
        <p className="notice__body">{body}</p>
        {status.state === 'error' && status.error !== undefined && (
          <p className="notice__body">{status.error}</p>
        )}
      </div>
      <button
        type="button"
        className="btn"
        disabled={status.state === 'syncing'}
        onClick={() => void syncNow()}
      >
        {status.state === 'syncing' ? 'Syncing…' : 'Sync now'}
      </button>

      <SyncDetails busy={status.state === 'syncing'} />
    </section>
  );
}

/**
 * What this device holds and how far it has downloaded, beside what the
 * database holds. Added 2026-10-08 when a phone said "synced" yet had none of
 * the laptop's data: comparing these numbers says which side is wrong, and
 * "Re-download everything" repairs the device side.
 */
function SyncDetails({ busy }: { busy: boolean }) {
  const local = useLiveQuery(async () => {
    const [recipes, foods, fridge, meals, meta, pending] = await Promise.all([
      db.components.count(),
      db.ingredients.where('source').equals('manual').count(),
      db.fridgeEntries.filter((entry) => entry.remaining > 0).count(),
      db.mealLogs.count(),
      db.syncMeta.get('sync'),
      db.syncOutbox.count(),
    ]);
    return { recipes, foods, fridge, meals, cursor: meta?.cursor ?? 0, pending };
  }, []);
  const [server, setServer] = useState<ServerStats | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  async function checkServer() {
    setServerError(null);
    try {
      setServer(await fetchServerStats());
    } catch (caught) {
      setServerError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <details
      className="syncdetails"
      onToggle={(event) => event.currentTarget.open && void checkServer()}
    >
      <summary>Sync details</summary>
      <dl className="syncdetails__list">
        <dt>This address</dt>
        <dd>{window.location.host}</dd>
        <dt>On this device</dt>
        <dd>
          {local === undefined
            ? '…'
            : `${local.recipes} recipes · ${local.foods} foods · ${local.fridge} in the fridge · ${local.meals} meals`}
        </dd>
        <dt>Downloaded up to</dt>
        <dd>{local === undefined ? '…' : `change #${local.cursor}`}</dd>
        <dt>Waiting to upload</dt>
        <dd>{local === undefined ? '…' : local.pending}</dd>
        <dt>In the database</dt>
        <dd>
          {serverError !== null
            ? serverError
            : server === null
              ? '…'
              : `${server.records - server.deleted} records · latest change #${server.latestRev}`}
        </dd>
      </dl>
      <div className="builder__actions">
        <button type="button" className="btn" onClick={() => void checkServer()}>
          Check again
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void redownloadEverything().then(checkServer)}
        >
          Re-download everything
        </button>
      </div>
    </details>
  );
}

function describe(status: SyncStatus): {
  title: string;
  body: string;
  tone: 'ok' | 'warn' | 'error';
} {
  const waiting =
    status.pending === 0
      ? ''
      : ` ${status.pending} change${status.pending === 1 ? '' : 's'} waiting to upload.`;

  switch (status.state) {
    case 'syncing':
      return { title: 'Syncing…', body: 'Swapping changes with the database.', tone: 'ok' };
    case 'offline':
      return {
        title: 'Offline',
        body: `Everything is saved on this device and will sync when there is a connection.${waiting}`,
        tone: 'ok',
      };
    case 'unconfigured':
      return {
        title: 'Sync is not set up yet',
        body: `The server has no database connected, so data stays on this device for now.${waiting}`,
        tone: 'warn',
      };
    case 'signedOut':
      return {
        title: 'Signed out',
        body: `Sign in again to keep syncing. Everything stays on this device meanwhile.${waiting}`,
        tone: 'warn',
      };
    case 'error':
      return {
        title: 'Sync hit a problem',
        body: `Nothing is lost — changes stay on this device and will retry.${waiting}`,
        tone: 'error',
      };
    case 'idle':
      return {
        title:
          status.lastSyncedAt === undefined
            ? 'Not synced yet'
            : `Synced ${relative(status.lastSyncedAt)}`,
        body: `Saved on this device and in your account, so every device you sign in on sees the same data.${waiting}`,
        tone: 'ok',
      };
  }
}

function relative(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return new Date(at).toLocaleDateString();
}
