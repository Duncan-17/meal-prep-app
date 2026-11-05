#!/usr/bin/env node
/**
 * Account administration, from this machine only. PLAN.md §11.
 *
 * By the user's decision there is no admin screen or endpoint on the web — an
 * admin feature that does not exist cannot be attacked. Instead this script
 * runs SQL against the D1 database through wrangler, which uses YOUR
 * Cloudflare login. Anyone without that login cannot run it against
 * production, whatever they find in this public repository.
 *
 *   node scripts/admin.mjs <--remote|--local> list
 *   node scripts/admin.mjs <--remote|--local> reset-password <username>
 *   node scripts/admin.mjs <--remote|--local> sign-out <username>
 *   node scripts/admin.mjs <--remote|--local> disable <username>
 *   node scripts/admin.mjs <--remote|--local> enable <username>
 *   node scripts/admin.mjs <--remote|--local> claim-legacy <username>
 *
 * --remote is the live database; --local is the one `npm run dev:api` uses.
 * One of them is required, so production is never touched by accident.
 *
 * reset-password makes a random temporary password and prints it ONCE. It
 * computes the login proof with the very same code the browser uses
 * (src/auth/derive.ts — Node runs the TypeScript directly), stores only its
 * hash, and ends every session the account had.
 */

import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { USERNAME_PATTERN, loginProof } from '../src/auth/derive.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DATABASE = 'meal-prep';

function usage(message) {
  if (message) console.error(`\n${message}\n`);
  console.error(
    'Usage: node scripts/admin.mjs <--remote|--local> <list | reset-password | sign-out | disable | enable | claim-legacy> [username]',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const where = args.find((arg) => arg === '--remote' || arg === '--local');
const [command, rawName] = args.filter((arg) => !arg.startsWith('--'));
if (where === undefined) usage('Say --remote (the live database) or --local.');
if (command === undefined) usage();

/**
 * Run SQL through wrangler with --command. No shell parses it: spawnSync is
 * given node and an argument array, so the SQL arrives as one argument.
 * (Not --file: against the REMOTE database that is a bulk import, which
 * prints upload progress before its JSON and returns no rows from a SELECT.)
 */
function sql(statement) {
  const result = spawnSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', DATABASE, where, '--json', '--command', statement],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }
  const parsed = JSON.parse(result.stdout);
  return parsed.flatMap((entry) => entry.results ?? []);
}

/** Usernames are interpolated into SQL, so only the server's own pattern gets through. */
function username() {
  if (rawName === undefined) usage(`${command} needs a username.`);
  const name = rawName.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(name)) usage(`"${rawName}" is not a valid username.`);
  return name;
}

function requireUser(name) {
  const [user] = sql(`SELECT id, username, disabled FROM users WHERE username = '${name}';`);
  if (user === undefined) {
    console.error(`No account called "${name}".`);
    process.exit(1);
  }
  return user;
}

/** 16 characters from an alphabet with no look-alikes (0/O, 1/l/I), in groups of four. */
function temporaryPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(''),
  );
  return groups.join('-');
}

async function sha256Hex(base64) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Buffer.from(digest).toString('hex');
}

switch (command) {
  case 'list': {
    const users = sql(
      `SELECT u.username, u.disabled, u.created_at,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
              (SELECT COUNT(*) FROM user_records r WHERE r.user_id = u.id AND r.deleted = 0) AS records
       FROM users u ORDER BY u.created_at;`,
    );
    const [legacy] = sql(`SELECT COUNT(*) AS n FROM user_records WHERE user_id = '';`);
    console.table(
      users.map((user) => ({
        username: user.username,
        created: new Date(user.created_at).toISOString().slice(0, 10),
        disabled: user.disabled === 1,
        sessions: user.sessions,
        records: user.records,
      })),
    );
    if ((legacy?.n ?? 0) > 0) {
      console.log(`${legacy.n} records from before accounts belong to nobody yet (claim-legacy).`);
    }
    break;
  }

  case 'reset-password': {
    const name = username();
    const user = requireUser(name);
    const password = temporaryPassword();
    const hash = await sha256Hex(await loginProof(name, password));
    sql(
      `UPDATE users SET auth_hash = '${hash}' WHERE id = '${user.id}';
       DELETE FROM sessions WHERE user_id = '${user.id}';`,
    );
    console.log(`\nTemporary password for ${name}:\n\n    ${password}\n`);
    console.log('Every session of theirs has ended. They should change it under Plan → Account.');
    break;
  }

  case 'sign-out': {
    const user = requireUser(username());
    sql(`DELETE FROM sessions WHERE user_id = '${user.id}';`);
    console.log(`Signed ${user.username} out everywhere.`);
    break;
  }

  case 'disable':
  case 'enable': {
    const user = requireUser(username());
    const disable = command === 'disable';
    sql(
      `UPDATE users SET disabled = ${disable ? 1 : 0} WHERE id = '${user.id}';` +
        (disable ? ` DELETE FROM sessions WHERE user_id = '${user.id}';` : ''),
    );
    console.log(`${user.username} is ${disable ? 'disabled and signed out' : 'enabled'}.`);
    break;
  }

  case 'claim-legacy': {
    // Records from before accounts (user_id '') become this account's, and
    // the pre-accounts table they were copied from is emptied.
    //
    // OR IGNORE: if the account has already synced its own version of a row
    // (an edit made after signing in, before this ran), that version was
    // written later and wins; the stale pre-accounts copy is then dropped.
    //
    // Signing in with "Keep it" does NOT make this unnecessary: the device
    // only uploads rows changed since its last sync, so everything it had
    // already synced exists in the account only once this has run.
    const user = requireUser(username());
    const [counts] = sql(
      `SELECT COUNT(*) AS total,
              SUM(NOT EXISTS (SELECT 1 FROM user_records mine
                              WHERE mine.user_id = '${user.id}'
                                AND mine.tbl = l.tbl AND mine.id = l.id)) AS moving
       FROM user_records l WHERE l.user_id = '';`,
    );
    sql(
      `UPDATE OR IGNORE user_records SET user_id = '${user.id}' WHERE user_id = '';
       DELETE FROM user_records WHERE user_id = '';
       DELETE FROM records;`,
    );
    const total = counts?.total ?? 0;
    const moving = counts?.moving ?? 0;
    console.log(
      `${moving} records from before accounts moved to ${user.username}; ` +
        `${total - moving} were older copies of rows the account already had, and were dropped.`,
    );
    break;
  }

  default:
    usage(`Unknown command "${command}".`);
}
