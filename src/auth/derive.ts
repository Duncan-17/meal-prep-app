/**
 * Password → login proof, in the browser. PLAN.md §11.
 *
 * The password never leaves the device. Argon2id stretches it into a 32-byte
 * master key, and HKDF splits that into independent values:
 *
 *   - `login-proof` — sent to the server, which stores its SHA-256.
 *   - `data-key-wrap` — reserved for end-to-end encryption (§11, step 3): it
 *     will wrap the key that encrypts the user's data, and is never sent.
 *
 * Because they come from HKDF with different labels, knowing the proof (or the
 * server's hash of it) reveals nothing about the wrapping key.
 *
 * The salt is derived from the username rather than stored, so a sign-in needs
 * no round trip to fetch it — and so the server never has to answer "what is
 * this user's salt?", which would tell anyone whether a username exists. The
 * cost: a password change keeps the same salt. Bitwarden makes the same trade
 * with the email address.
 *
 * Deliberately free of `@/` imports and of anything Dexie or React: the admin
 * script (`scripts/admin.mjs`) imports this file directly under Node, so an
 * admin password reset produces exactly the proof the browser will.
 */

import { argon2id } from 'hash-wasm';

/** By the user's choice (2026-11-04): length only, no common-password list. */
export const MIN_PASSWORD_LENGTH = 8;

export interface Argon2Params {
  /** KiB. */
  memorySize: number;
  iterations: number;
  parallelism: number;
}

/**
 * 64 MiB, 3 passes. Above OWASP's minimum (19 MiB, 2 passes); measured at
 * 0.57 s on the development laptop, so roughly 1–2 s on a phone — once per
 * sign-in, and expensive for anyone trying guesses at scale.
 *
 * Changing these changes every login proof: existing accounts could no longer
 * sign in. That would need a versioned migration, not an edit.
 */
export const ARGON2_PARAMS: Argon2Params = { memorySize: 65_536, iterations: 3, parallelism: 1 };

const SALT_DOMAIN = 'meal-prep-app/v1/';

/** Mirrors the server's rule, so the form can say what is wrong before sending. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,31}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

async function saltFor(username: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(SALT_DOMAIN + username),
  );
  return new Uint8Array(digest);
}

/**
 * Argon2id over the password. NFC normalization first, so an accented letter
 * typed on a phone and on a laptop is the same password.
 */
export async function deriveMasterKey(
  username: string,
  password: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<Uint8Array<ArrayBuffer>> {
  const master = await argon2id({
    password: password.normalize('NFC'),
    salt: await saltFor(normalizeUsername(username)),
    ...params,
    hashLength: 32,
    outputType: 'binary',
  });
  // Copied into a plain ArrayBuffer, which is what WebCrypto's types accept.
  return new Uint8Array(master);
}

async function hkdf(master: Uint8Array<ArrayBuffer>, label: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(label),
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** The value the server checks: base64 of 32 bytes. */
export async function loginProof(
  username: string,
  password: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<string> {
  return toBase64(await hkdf(await deriveMasterKey(username, password, params), 'login-proof'));
}
