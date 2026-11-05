/**
 * D1-backed stores for `syncLogic.ts` and `authLogic.ts`.
 *
 * The schema creates itself on first use, as it always has here (PLAN.md §10):
 * a fresh database works the moment it is bound, with no migration command to
 * remember to run against production. Every statement is `IF NOT EXISTS` or
 * guarded, so running it on every cold start is harmless.
 *
 * **The per-user migration (2026-11-04, PLAN.md §11).** Sync used to keep one
 * `records` table keyed by (tbl, id). Making the user part of the KEY needs a
 * new primary key, which SQLite cannot alter in place — so rows move to
 * `user_records`, keyed (user_id, tbl, id), once. They arrive with user_id ''
 * (owned by nobody: no real user id is empty, so no one can read them) and
 * keep their revs, so every device's download cursor stays valid. The admin
 * script's `claim-legacy` hands them to an account. `records` itself is left
 * in place until then, and that command empties it.
 */

import type { AttemptWindow, AuthStore, SessionRow, UserRow } from './authLogic';
import type { IncomingRecord, StoredRecord, SyncStats, SyncStore } from './syncLogic';

let schemaReady: Promise<unknown> | null = null;

export function ensureSchema(db: D1Database): Promise<unknown> {
  schemaReady ??= db
    .batch([
      // The pre-accounts table. Still created so the copy below can always
      // read it, on a fresh database as much as an old one.
      db.prepare(
        `CREATE TABLE IF NOT EXISTS records (
           tbl TEXT NOT NULL,
           id TEXT NOT NULL,
           data TEXT,
           updated_at INTEGER NOT NULL,
           deleted INTEGER NOT NULL DEFAULT 0,
           rev INTEGER NOT NULL,
           PRIMARY KEY (tbl, id)
         )`,
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS user_records (
           user_id TEXT NOT NULL,
           tbl TEXT NOT NULL,
           id TEXT NOT NULL,
           data TEXT,
           updated_at INTEGER NOT NULL,
           deleted INTEGER NOT NULL DEFAULT 0,
           rev INTEGER NOT NULL,
           PRIMARY KEY (user_id, tbl, id)
         )`,
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS user_records_rev ON user_records (user_id, rev)'),
      db.prepare('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)'),
      // Runs once: the marker row written next stops it ever copying again,
      // even after `claim-legacy` has emptied `records`.
      db.prepare(
        `INSERT INTO user_records (user_id, tbl, id, data, updated_at, deleted, rev)
         SELECT '', tbl, id, data, updated_at, deleted, rev FROM records
         WHERE NOT EXISTS (SELECT 1 FROM schema_meta WHERE key = 'records_by_user')`,
      ),
      db.prepare(
        "INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('records_by_user', '2026-11-04')",
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS users (
           id TEXT PRIMARY KEY,
           username TEXT NOT NULL UNIQUE,
           auth_hash TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           disabled INTEGER NOT NULL DEFAULT 0
         )`,
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS sessions (
           token_hash TEXT PRIMARY KEY,
           user_id TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           last_seen_at INTEGER NOT NULL,
           expires_at INTEGER NOT NULL,
           user_agent TEXT NOT NULL DEFAULT ''
         )`,
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)'),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS auth_attempts (
           key TEXT PRIMARY KEY,
           window_start INTEGER NOT NULL,
           count INTEGER NOT NULL
         )`,
      ),
    ])
    .catch((error: unknown) => {
      schemaReady = null; // let the next request try again
      throw error;
    });
  return schemaReady;
}

// ── Sync ────────────────────────────────────────────────────────────────────

/** D1 statements per batch call — comfortably inside D1's limits. */
const D1_CHUNK = 50;

/*
 * One statement does the whole "strictly newer wins" rule: insert, or on a
 * clash update only WHERE the incoming change is newer. The clash is on
 * (user_id, tbl, id), so it can only ever be with the caller's own row. The
 * rev subquery is over ALL users — revs only need to go up — and a D1 batch
 * runs its statements in order in one transaction, so they come out strictly
 * increasing.
 */
const UPSERT_NEWER = `
  INSERT INTO user_records (user_id, tbl, id, data, updated_at, deleted, rev)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT COALESCE(MAX(rev), 0) + 1 FROM user_records))
  ON CONFLICT (user_id, tbl, id) DO UPDATE SET
    data = excluded.data,
    updated_at = excluded.updated_at,
    deleted = excluded.deleted,
    rev = excluded.rev
  WHERE excluded.updated_at > user_records.updated_at`;

export function d1SyncStore(db: D1Database): SyncStore {
  return {
    async upsertNewer(userId: string, records: readonly IncomingRecord[]): Promise<number> {
      let written = 0;
      for (let start = 0; start < records.length; start += D1_CHUNK) {
        const chunk = records.slice(start, start + D1_CHUNK);
        const results = await db.batch(
          chunk.map((record) =>
            db
              .prepare(UPSERT_NEWER)
              .bind(
                userId,
                record.tbl,
                record.id,
                record.deleted ? null : JSON.stringify(record.data),
                record.updatedAt,
                record.deleted ? 1 : 0,
              ),
          ),
        );
        for (const result of results) written += result.meta.changes ?? 0;
      }
      return written;
    },

    async stats(userId: string): Promise<SyncStats> {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS records, COALESCE(SUM(deleted), 0) AS deleted,
                  COALESCE(MAX(rev), 0) AS latestRev
           FROM user_records WHERE user_id = ?1`,
        )
        .bind(userId)
        .first<SyncStats>();
      return row ?? { records: 0, deleted: 0, latestRev: 0 };
    },

    async changesSince(userId: string, since: number, limit: number): Promise<StoredRecord[]> {
      const { results } = await db
        .prepare(
          `SELECT tbl, id, data, updated_at, deleted, rev FROM user_records
           WHERE user_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3`,
        )
        .bind(userId, since, limit)
        .all<{
          tbl: string;
          id: string;
          data: string | null;
          updated_at: number;
          deleted: number;
          rev: number;
        }>();
      return results.map((row) => ({
        tbl: row.tbl,
        id: row.id,
        data: row.data,
        updatedAt: row.updated_at,
        deleted: row.deleted === 1,
        rev: row.rev,
      }));
    },
  };
}

// ── Auth ────────────────────────────────────────────────────────────────────

interface UserDbRow {
  id: string;
  username: string;
  auth_hash: string;
  created_at: number;
  disabled: number;
}

const toUser = (row: UserDbRow | null): UserRow | null =>
  row === null
    ? null
    : {
        id: row.id,
        username: row.username,
        authHash: row.auth_hash,
        createdAt: row.created_at,
        disabled: row.disabled === 1,
      };

export function d1AuthStore(db: D1Database): AuthStore {
  return {
    async userByName(username) {
      return toUser(
        await db
          .prepare('SELECT * FROM users WHERE username = ?1')
          .bind(username)
          .first<UserDbRow>(),
      );
    },
    async userById(id) {
      return toUser(
        await db.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first<UserDbRow>(),
      );
    },
    async createUser(user) {
      const result = await db
        .prepare(
          `INSERT INTO users (id, username, auth_hash, created_at, disabled)
           VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (username) DO NOTHING`,
        )
        .bind(user.id, user.username, user.authHash, user.createdAt, user.disabled ? 1 : 0)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },
    async setAuthHash(userId, authHash) {
      await db
        .prepare('UPDATE users SET auth_hash = ?2 WHERE id = ?1')
        .bind(userId, authHash)
        .run();
    },

    async createSession(session: SessionRow) {
      await db
        .prepare(
          `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(
          session.tokenHash,
          session.userId,
          session.createdAt,
          session.lastSeenAt,
          session.expiresAt,
          session.userAgent,
        )
        .run();
    },
    async session(tokenHash) {
      const row = await db
        .prepare('SELECT * FROM sessions WHERE token_hash = ?1')
        .bind(tokenHash)
        .first<{
          token_hash: string;
          user_id: string;
          created_at: number;
          last_seen_at: number;
          expires_at: number;
          user_agent: string;
        }>();
      return row === null
        ? null
        : {
            tokenHash: row.token_hash,
            userId: row.user_id,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
            expiresAt: row.expires_at,
            userAgent: row.user_agent,
          };
    },
    async touchSession(tokenHash, lastSeenAt, expiresAt) {
      await db
        .prepare('UPDATE sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1')
        .bind(tokenHash, lastSeenAt, expiresAt)
        .run();
    },
    async deleteSession(tokenHash) {
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash).run();
    },
    async deleteUserSessions(userId, except) {
      await db
        .prepare('DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2')
        .bind(userId, except ?? '')
        .run();
    },
    async deleteExpiredSessions(now) {
      await db.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now).run();
    },

    async attempts(key) {
      const row = await db
        .prepare('SELECT window_start, count FROM auth_attempts WHERE key = ?1')
        .bind(key)
        .first<{ window_start: number; count: number }>();
      return row === null ? null : { windowStart: row.window_start, count: row.count };
    },
    async setAttempts(key, window: AttemptWindow) {
      await db
        .prepare(
          `INSERT INTO auth_attempts (key, window_start, count) VALUES (?1, ?2, ?3)
           ON CONFLICT (key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count`,
        )
        .bind(key, window.windowStart, window.count)
        .run();
    },
    async clearAttempts(key) {
      await db.prepare('DELETE FROM auth_attempts WHERE key = ?1').bind(key).run();
    },
  };
}
