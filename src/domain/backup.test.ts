import { describe, expect, it } from 'vitest';

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BackupFormatError,
  backupFilename,
  backupSummary,
  buildBackup,
  parseBackup,
  totalRows,
} from '@/domain/backup';

const TABLES = ['ingredients', 'components', 'mealLogs'] as const;

function validFile(overrides: Record<string, unknown> = {}) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: '2026-09-10T12:00:00.000Z',
    data: { ingredients: [{ id: 1, name: 'Rice' }], components: [], mealLogs: [] },
    ...overrides,
  };
}

describe('buildBackup', () => {
  it('stamps the format, version and time', () => {
    const file = buildBackup({ ingredients: [] }, new Date('2026-09-10T12:00:00Z'));
    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.version).toBe(BACKUP_FORMAT_VERSION);
    expect(file.exportedAt).toBe('2026-09-10T12:00:00.000Z');
  });

  it('round-trips through JSON and validation', () => {
    const file = buildBackup({ ingredients: [{ id: 1 }], components: [] });
    const parsed = parseBackup(JSON.parse(JSON.stringify(file)));
    expect(parsed).toEqual(file);
  });
});

describe('parseBackup — rejects before anything is destroyed', () => {
  it('accepts a valid file', () => {
    expect(() => parseBackup(validFile(), TABLES)).not.toThrow();
  });

  it('rejects a non-object', () => {
    expect(() => parseBackup('nope')).toThrow(BackupFormatError);
    expect(() => parseBackup(null)).toThrow(/not a backup/);
    expect(() => parseBackup([])).toThrow(/not a backup/);
  });

  it('rejects some other application JSON file', () => {
    expect(() => parseBackup({ format: 'something-else', version: 1 })).toThrow(
      /not a Meal Prep backup/,
    );
  });

  it('rejects a missing or fractional version', () => {
    expect(() => parseBackup(validFile({ version: undefined }))).toThrow(/valid version/);
    expect(() => parseBackup(validFile({ version: 1.5 }))).toThrow(/valid version/);
  });

  it('refuses a backup from a newer build rather than mangling it', () => {
    expect(() => parseBackup(validFile({ version: BACKUP_FORMAT_VERSION + 1 }))).toThrow(
      /newer version of the app/,
    );
  });

  it('rejects a bad timestamp', () => {
    expect(() => parseBackup(validFile({ exportedAt: 'whenever' }))).toThrow(/timestamp/);
  });

  it('rejects a missing data section', () => {
    expect(() => parseBackup(validFile({ data: undefined }))).toThrow(/no data section/);
  });

  it('rejects a table that is not a list', () => {
    expect(() => parseBackup(validFile({ data: { ingredients: 'oops' } }))).toThrow(
      /not a list of rows/,
    );
  });

  it('rejects an unknown table so a wrong file cannot silently drop data', () => {
    expect(() => parseBackup(validFile({ data: { mystery: [] } }), TABLES)).toThrow(
      /unknown table "mystery"/,
    );
  });

  it('allows unknown tables when no expected list is given', () => {
    expect(() => parseBackup(validFile({ data: { mystery: [] } }))).not.toThrow();
  });

  it('accepts a backup missing a table that this build added later', () => {
    const older = validFile({ data: { ingredients: [] } });
    expect(() => parseBackup(older, TABLES)).not.toThrow();
  });
});

describe('backupSummary', () => {
  it('counts rows per table, alphabetically', () => {
    const file = parseBackup(validFile());
    expect(backupSummary(file)).toEqual([
      { table: 'components', rows: 0 },
      { table: 'ingredients', rows: 1 },
      { table: 'mealLogs', rows: 0 },
    ]);
  });

  it('totals every row', () => {
    expect(totalRows(parseBackup(validFile()))).toBe(1);
  });
});

describe('backupFilename', () => {
  it('is dated so successive backups do not overwrite each other', () => {
    expect(backupFilename(new Date('2026-09-10T12:00:00Z'))).toBe(
      'meal-prep-backup-2026-09-10.json',
    );
  });
});
