/**
 * Export and import, plus the nudge to actually do it.
 *
 * IndexedDB is not durable storage. A browser storage sweep, a "clear site
 * data", a reinstalled phone — any of those takes every Component, batch and
 * meal log with it, silently. This file is the whole safety net (PLAN.md §7),
 * which is why the reminder is deliberately hard to ignore once it is stale.
 */

import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '@/db/schema';
import { downloadBackup, importBackup } from '@/db/backup';
import { backupSummary, parseBackup, totalRows } from '@/domain/backup';
import { dayDifference, formatDay, toDayKey, todayKey } from '@/domain/dates';

/** Past this many days, the reminder stops being a quiet line of text. */
const STALE_DAYS = 14;

export function BackupSection() {
  const settings = useLiveQuery(() => db.settings.get('settings'), []);
  const fileInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ json: string; summary: string } | null>(null);

  const lastBackupAt = settings?.lastBackupAt;
  const daysSince =
    lastBackupAt === undefined
      ? null
      : Math.abs(dayDifference(toDayKey(new Date(lastBackupAt)), todayKey()));
  const stale = daysSince === null || daysSince >= STALE_DAYS;

  async function runExport() {
    setBusy(true);
    setError(null);
    try {
      await downloadBackup();
      setMessage('Backup saved to your downloads.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Import is read-then-confirm. It REPLACES everything, so the user sees what
   * they are about to overwrite before anything is touched.
   */
  async function stageImport(file: File) {
    setError(null);
    setMessage(null);
    try {
      const json = await file.text();
      const parsed: unknown = JSON.parse(json);
      const backup = parseBackup(parsed);
      const rows = totalRows(backup);
      const tables = backupSummary(backup)
        .filter((entry) => entry.rows > 0)
        .map((entry) => `${entry.rows} ${entry.table}`)
        .join(', ');
      setPending({
        json,
        summary: `${rows} row${rows === 1 ? '' : 's'} from ${formatDay(
          toDayKey(new Date(backup.exportedAt)),
        )}${tables === '' ? '' : ` — ${tables}`}`,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function confirmImport() {
    if (pending === null) return;
    setBusy(true);
    setError(null);
    try {
      await importBackup(pending.json);
      setPending(null);
      setMessage('Backup restored.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h2 className="section__title">Backup</h2>

      <div className={`notice${stale ? ' notice--warn' : ''}`}>
        <p className="notice__title">
          {lastBackupAt === undefined
            ? 'Never backed up'
            : daysSince === 0
              ? 'Backed up today'
              : `Last backup ${daysSince} day${daysSince === 1 ? '' : 's'} ago`}
        </p>
        <p className="notice__body">
          A file you keep yourself — a copy that survives anything, sync included.
        </p>
      </div>

      <div className="builder__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => void runExport()}
        >
          {busy ? 'Working…' : 'Export a backup'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          Restore from a file
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void stageImport(file);
          // Reset so picking the same file twice still fires.
          event.target.value = '';
        }}
      />

      {pending !== null && (
        <div className="notice notice--error">
          <p className="notice__title">Replace everything with this backup?</p>
          <p className="notice__body">{pending.summary}</p>
          <p className="notice__body">
            This wipes what is here now — and, once it syncs, on your other devices too. Export
            first if you are not sure.
          </p>
          <div className="builder__actions">
            <button type="button" className="btn" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={() => void confirmImport()}
            >
              Replace everything
            </button>
          </div>
        </div>
      )}

      {message !== null && <p className="screen__sub">{message}</p>}

      {error !== null && (
        <div className="notice notice--error">
          <p className="notice__body">{error}</p>
        </div>
      )}
    </section>
  );
}
