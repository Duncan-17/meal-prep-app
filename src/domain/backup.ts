/**
 * Backup file format — pure shape and validation, no I/O.
 *
 * IndexedDB is not durable storage: a browser cleanup, a "clear site data", or
 * a reinstalled phone takes everything with it. This file is the whole safety
 * net, so it lands in Phase 1 rather than being deferred (PLAN.md §7).
 *
 * Validation is deliberately strict. An import REPLACES the database, so a
 * malformed file must be rejected before anything is deleted, not halfway
 * through.
 */

export const BACKUP_FORMAT = 'meal-prep-backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  /** Bumped only for a breaking change to the file layout. */
  version: number;
  /** ISO timestamp, for the filename and the "last backed up" note. */
  exportedAt: string;
  /** Table name → rows, exactly as stored. */
  data: Record<string, unknown[]>;
}

export function buildBackup(
  data: Record<string, unknown[]>,
  exportedAt: Date = new Date(),
): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    data,
  };
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

/**
 * Validate an untrusted parsed JSON value as a backup file.
 *
 * @param expectedTables when given, unknown table names are rejected. A file
 *   naming a table this build does not have is more likely a wrong file than a
 *   forward-compatible one, and silently ignoring it would lose data.
 * @throws BackupFormatError with a message worth showing the user.
 */
export function parseBackup(raw: unknown, expectedTables?: readonly string[]): BackupFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BackupFormatError('That file is not a backup — expected a JSON object.');
  }

  const candidate = raw as Record<string, unknown>;

  if (candidate.format !== BACKUP_FORMAT) {
    throw new BackupFormatError(
      `That file is not a Meal Prep backup (found format "${String(candidate.format)}").`,
    );
  }

  const version = candidate.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupFormatError('Backup is missing a valid version number.');
  }
  if (version > BACKUP_FORMAT_VERSION) {
    throw new BackupFormatError(
      `That backup was written by a newer version of the app (format ${version}, this build reads ${BACKUP_FORMAT_VERSION}). Update the app first.`,
    );
  }

  const exportedAt = candidate.exportedAt;
  if (typeof exportedAt !== 'string' || Number.isNaN(Date.parse(exportedAt))) {
    throw new BackupFormatError('Backup is missing a valid export timestamp.');
  }

  const data = candidate.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new BackupFormatError('Backup has no data section.');
  }

  const tables = data as Record<string, unknown>;
  for (const [name, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) {
      throw new BackupFormatError(`Backup table "${name}" is not a list of rows.`);
    }
    if (expectedTables !== undefined && !expectedTables.includes(name)) {
      throw new BackupFormatError(`Backup contains an unknown table "${name}".`);
    }
  }

  return {
    format: BACKUP_FORMAT,
    version,
    exportedAt,
    data: tables as Record<string, unknown[]>,
  };
}

/** Row counts per table, for the "you are about to replace…" confirmation. */
export function backupSummary(file: BackupFile): Array<{ table: string; rows: number }> {
  return Object.entries(file.data)
    .map(([table, rows]) => ({ table, rows: rows.length }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

export function totalRows(file: BackupFile): number {
  return Object.values(file.data).reduce((sum, rows) => sum + rows.length, 0);
}

/** `meal-prep-backup-2026-09-10.json` */
export function backupFilename(exportedAt: Date = new Date()): string {
  const iso = exportedAt.toISOString();
  return `meal-prep-backup-${iso.slice(0, 10)}.json`;
}
