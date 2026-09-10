/**
 * Export and import the whole database as JSON.
 *
 * The format and its validation live in `@/domain/backup` so they can be
 * tested without a browser; this file is only the Dexie side.
 */

import { backupFilename, buildBackup, parseBackup, type BackupFile } from '@/domain/backup';
import { db, TABLE_NAMES } from '@/db/schema';

/** Read every table into a backup object. */
export async function exportBackup(): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {};

  await db.transaction('r', db.tables, async () => {
    for (const name of TABLE_NAMES) {
      data[name] = await db.table(name).toArray();
    }
  });

  return buildBackup(data);
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await exportBackup(), null, 2);
}

/**
 * Hand the user a backup file.
 *
 * Object URLs leak the blob until revoked, so it is revoked on the next tick —
 * after the click has been dispatched, before the page can accumulate them.
 */
export async function downloadBackup(): Promise<void> {
  const json = await exportBackupJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = backupFilename();
  anchor.click();

  setTimeout(() => URL.revokeObjectURL(url), 0);
  await markBackedUp();
}

/**
 * REPLACE the database with the contents of a backup.
 *
 * Destructive by design — a backup restore that merged would duplicate every
 * row. The file is fully validated before anything is cleared, and the whole
 * replace runs in one transaction, so a bad file leaves the existing data
 * untouched rather than half-deleted.
 */
export async function importBackup(json: string): Promise<BackupFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  const file = parseBackup(raw, TABLE_NAMES);

  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLE_NAMES) {
      const rows = file.data[name];
      if (rows === undefined) continue; // table absent from an older backup
      await db.table(name).clear();
      if (rows.length > 0) {
        await db.table(name).bulkAdd(rows);
      }
    }
  });

  return file;
}

async function markBackedUp(): Promise<void> {
  const existing = await db.settings.get('settings');
  await db.settings.put({
    id: 'settings',
    pinnedNutrients: existing?.pinnedNutrients ?? [],
    ...(existing?.offContact === undefined ? {} : { offContact: existing.offContact }),
    lastBackupAt: Date.now(),
  });
}
