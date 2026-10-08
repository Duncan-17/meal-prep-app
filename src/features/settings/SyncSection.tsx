/**
 * Where the data lives, said plainly — and a button to sync now.
 *
 * Sync runs on its own (db/sync.ts); this only reports it. Offline is
 * presented as normal rather than as an error, because it is: edits are safe
 * on the device and go up when there is a connection.
 */

import { useSyncExternalStore } from 'react';

import { getSyncStatus, subscribeSyncStatus, syncNow, type SyncStatus } from '@/db/sync';

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
    </section>
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
        body: `Saved on this device and in your Cloudflare database, so every device sees the same data.${waiting}`,
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
