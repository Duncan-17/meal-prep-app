import { describe, expect, it } from 'vitest';

import { ARGON2_PARAMS, loginProof, type Argon2Params } from '@/auth/derive';

/** Cheap settings so the behaviour tests run in milliseconds. */
const FAST: Argon2Params = { memorySize: 1024, iterations: 1, parallelism: 1 };

describe('loginProof', () => {
  it('is 32 bytes, base64 — the shape the server accepts', async () => {
    const proof = await loginProof('duncan', 'password1', FAST);
    expect(atob(proof)).toHaveLength(32);
  });

  it('is the same every time for the same username and password', async () => {
    expect(await loginProof('duncan', 'password1', FAST)).toBe(
      await loginProof('duncan', 'password1', FAST),
    );
  });

  it('ignores username case and surrounding spaces, as the server does', async () => {
    expect(await loginProof(' Duncan ', 'password1', FAST)).toBe(
      await loginProof('duncan', 'password1', FAST),
    );
  });

  it('differs by password, and by username for the same password', async () => {
    const base = await loginProof('duncan', 'password1', FAST);
    expect(await loginProof('duncan', 'password2', FAST)).not.toBe(base);
    expect(await loginProof('alex', 'password1', FAST)).not.toBe(base);
  });

  it('treats composed and decomposed accents as one password', async () => {
    const composed = 'café-password';
    const decomposed = 'café-password';
    expect(composed).not.toBe(decomposed);
    expect(await loginProof('duncan', composed, FAST)).toBe(
      await loginProof('duncan', decomposed, FAST),
    );
  });

  /*
   * Pinned with the REAL parameters. If this fails, every existing account's
   * proof has changed and nobody can sign in — do not update the expected
   * value without a migration plan (see ARGON2_PARAMS).
   */
  it('has not changed for existing accounts', async () => {
    expect(await loginProof('duncan', 'correct horse', ARGON2_PARAMS)).toBe(
      'CXMP9vydSxCzbRkZ6D2UcaSq23lCJz5OOo09hkBXMIw=',
    );
  });
});
