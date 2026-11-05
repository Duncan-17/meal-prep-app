# Threat model

What this app protects, from whom, how, and where the protection stops. Every control below is
in code and tested; file names point at where.

Last reviewed 2026-11-05, after accounts (PLAN.md §11 step 1) and hardening (step 2).
End-to-end encryption (step 3) is designed but **not built**. The limits that would remove are
listed under [Known limits](#known-limits).

## The system

```
Browser (PWA)                 Cloudflare                          USDA FoodData Central
+------------------+  HTTPS   +--------------------------------+  HTTPS  +-------------+
| React app        | -------> | static pages  (public/_headers)|         |             |
| IndexedDB        |  cookie  | Worker /api/*                  | ------> |  food data  |
| Argon2id (wasm)  | <------- |   auth, sync, USDA proxy       |   key   |             |
+------------------+          | D1: users, sessions,           |         +-------------+
                              |     user_records, rate limits  |
                              +--------------------------------+
```

**Trust boundaries:** the browser and the Worker (everything a client sends is untrusted); the
Worker and USDA (the API key crosses it, outbound only); the Worker and D1 (trusted, same
platform).

## What is worth protecting

| Asset                         | Why it matters                                                  |
| ----------------------------- | --------------------------------------------------------------- |
| A user's nutrition data       | Health-adjacent personal data: what someone eats, weighs, plans |
| Passwords                     | Reused elsewhere, as passwords always are                       |
| Session tokens                | Whoever holds one is that user until it expires                 |
| The USDA API key              | Shared quota; USDA deactivates keys found published             |
| Integrity of each user's data | Nobody should be able to change what someone else logged        |

## Who might attack it

1. **Anyone on the internet.** The repo is public and so is the address. They can read every
   line of code, sign up, and send any request they like.
2. **Another signed-in user.** They have a valid session and want someone else's data.
3. **A malicious website** the user visits while signed in, trying to make the browser act for
   them (CSRF, clickjacking).
4. **Someone who obtains a copy of the database** (a leaked backup, a compromised account at the
   host). Their target is the passwords and the data.

Out of scope: an attacker with control of the user's own unlocked device, or of Cloudflare
itself. Both are discussed under [Known limits](#known-limits).

## Threats and controls

### Authentication

| Threat                                  | Control                                                                                                                                                                                              | Where                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Password stolen from the server or wire | **The server never receives the password.** The browser stretches it with Argon2id (64 MiB, 3 passes) and sends a derived 32-byte proof. The server stores only SHA-256 of that proof.               | `src/auth/derive.ts`                    |
| Offline cracking of a leaked database   | A leaked hash forces the attacker through Argon2id for every guess. The salt is per username, so no table can be precomputed for all users at once.                                                  | `derive.ts`, pinned by `derive.test.ts` |
| Online guessing                         | 5 failures per username per minute (applies even to the right password once locked); 20 failures per IP per minute across usernames.                                                                 | `worker/authLogic.ts`, tested           |
| Finding out which usernames exist       | Unknown user and wrong password return the same 401 and the same message, and an unknown user still does a hash comparison. Sign-up must reveal a taken name, so it is limited to 5 per IP per hour. | `authLogic.ts`, tested                  |
| Timing side channel on the hash check   | Constant-time comparison.                                                                                                                                                                            | `constantTimeEqual`                     |
| Admin backdoor                          | There is no admin route or screen. Admin actions (password reset, disable, sign-out) run from the command line with the owner's own Cloudflare credentials.                                          | `scripts/admin.mjs`                     |

### Sessions

| Threat                          | Control                                                                                                                                                                                                                              | Where                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| Token stolen by injected script | Cookie is `HttpOnly`: page JavaScript cannot read it. The CSP (below) makes injecting script hard in the first place.                                                                                                                | `worker/index.ts`      |
| Token sent to another site      | `__Host-` prefix: `Secure`, `Path=/`, no `Domain`. Only this exact origin can set or receive it.                                                                                                                                     | `sessionCookie`        |
| Database leak exposes sessions  | The server stores SHA-256 of each token, never the token itself.                                                                                                                                                                     | `authLogic.ts`         |
| A stolen session lasts forever  | 30-day expiry, extended at most once a day while in use. Sign-out, "sign out other devices", a password change and an admin reset all delete the server-side rows, so a token stops working at once rather than whenever it expires. | `authLogic.ts`, tested |

### Cross-site attacks

| Threat                       | Control                                                                                                                                                                                                                                                                                                                                                               | Where                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| CSRF                         | Two independent locks. The session cookie is `SameSite=Strict`, and every non-GET request must carry a same-origin `Origin` header, so a request with none gets a 403.                                                                                                                                                                                                | `sameOrigin` in `index.ts`    |
| Clickjacking                 | `frame-ancestors 'none'` and `X-Frame-Options: DENY` on every response.                                                                                                                                                                                                                                                                                               | `public/_headers`, `index.ts` |
| XSS                          | React escapes all rendered text, and the code never uses `dangerouslySetInnerHTML`, `innerHTML` or `eval`. The CSP is a second line: scripts only from this origin, no inline script, no inline style markup, no plugins, no `<base>` hijack. The one relaxation is `'wasm-unsafe-eval'`, which Argon2id needs; it allows compiling WebAssembly, not JavaScript eval. | `public/_headers`             |
| API reply rendered as a page | API replies carry `default-src 'none'` and `nosniff`. Even if a browser were tricked into rendering one, nothing in it could run.                                                                                                                                                                                                                                     | `withSecurityHeaders`         |

### Authorization and data isolation

| Threat                                           | Control                                                                                                                                                                                   | Where                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Reading another user's data                      | Every API route except `health` and `auth/*` requires a session, and every query is scoped to that session's user id.                                                                     | `index.ts`, `d1Stores.ts`                  |
| Overwriting another user's row by reusing its id | **The user id is part of the primary key**: `(user_id, tbl, id)`, not a filter. A push naming someone else's id creates a row in the pusher's own space. Four tests attack this directly. | `worker/syncLogic.ts`, `syncLogic.test.ts` |
| SQL injection                                    | Every query is parameterised (`?1, ?2`). The admin script checks usernames against the server's pattern before they reach SQL.                                                            | `d1Stores.ts`, `admin.mjs`                 |

### Untrusted input and abuse

| Threat                               | Control                                                                                                                                                                                                                                                                              | Where                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| Malformed or hostile sync data       | The whole push is validated before anything is written: known table names only, ids of plain characters (≤ 64), finite non-negative timestamps.                                                                                                                                      | `parsePush`, tested   |
| A record that wins every future edit | Timestamps more than a day ahead of the server clock are refused, since "later edit wins" would otherwise let a record stamped in the year 9999 overrule everything after it.                                                                                                        | `parsePush`, tested   |
| Memory or storage exhaustion         | Bodies are capped before parsing (4 MB for sync, 16 kB for sign-in). The stream is counted as it arrives, so a body with no declared length cannot get around the cap. Each record is limited to 256 kB, and each account to 20,000 records and 50 MB, though deletions always pass. | `readJson`, `push`    |
| Burning the shared USDA key          | USDA lookups require a session and are limited to 60 per account per minute.                                                                                                                                                                                                         | `index.ts`, tested    |
| Unbounded rate-limit table           | Old rate-limit windows are deleted on each successful sign-in.                                                                                                                                                                                                                       | `deleteStaleAttempts` |

### Secrets and supply chain

| Threat                          | Control                                                                                                                                                                                                                                           | Where                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| USDA key leaking to the browser | The key exists only as a Cloudflare secret, and the browser calls the Worker. Cache keys never contain it, and error bodies are scrubbed of `api_key=` before they are returned.                                                                  | `worker/index.ts`         |
| A compromised dependency        | CI fails on any high or critical advisory, and on any advisory at all in what ships to the browser. Dependabot proposes updates only after a 5-day cooldown. Workflow actions are pinned to commit SHAs. CodeQL scans the code and the workflows. | `.github/`                |
| Hijacked CI token               | Workflows run with read-only permissions, and checkout does not keep credentials.                                                                                                                                                                 | `.github/workflows/*.yml` |

## Known limits

Stated plainly, because a threat model that claims everything protects nothing.

1. **The server can read your data.** Data is encrypted in transit (HTTPS) and at rest (by
   Cloudflare), but the Worker sees plaintext, and so would anyone who compromised the Cloudflare
   account. End-to-end encryption with a recovery code (PLAN.md §11 step 3) is designed to remove
   this. Until it ships, this app is not suitable for data you would not trust to the host.
2. **Even with E2EE, the server serves the code.** A compromised server could ship JavaScript
   that steals the key as you type. CSP and an open repo narrow this. Nothing in a web app fully
   removes it.
3. **Metadata.** Record ids embed their creation time, and the server sees table names, sizes and
   when each device syncs. It can therefore infer how often you log meals, even without contents.
4. **Passwords need only be 8 characters, and common ones are accepted.** That was the owner's
   decision for a personal app. Argon2id makes each guess expensive, but it cannot make a weak
   password strong.
5. **No second factor.** Passkeys are part of the step 3 design.
6. **Sign-up is open.** Each account is isolated and quota-limited, and sign-ups are limited per
   IP. A determined spammer with many IPs could still create accounts. The admin can disable them.
7. **A signed-in device is trusted offline.** If the network is unreachable, the app opens for the
   last account on that device without asking the server. Signing out erases the device's copy;
   locking the device itself is the operating system's job.
8. **Deleted data persists for a while.** D1 keeps about 30 days of point-in-time recovery. A
   deleted row really is gone from the live database, but not yet from the host's backups.
9. **Build-tool advisories.** `npm audit` reports moderate and low advisories inside
   `vite-plugin-pwa`'s build tooling (glob, minimatch, deepmerge). That code runs only on the
   build machine over this repo's own files, never in the browser. The only fix offered is a
   downgrade. CI blocks anything high or above, and anything at all in shipped code.
10. **`includeSubDomains` on HSTS** covers only subdomains of this app's own hostname, which has
    none. It cannot affect other `workers.dev` sites.

## How it was verified

- **Unit tests** (`npm test`): the auth rules, rate limits, session lifecycle, sync validation,
  quotas, and cross-user isolation attacks. All run against in-memory stores that implement the
  same interfaces as the D1 ones.
- **Over the wire**, against a local Worker:
  - forged and replayed tokens;
  - cross-origin POSTs and POSTs with no Origin;
  - identical login errors;
  - the lock-out;
  - a year-9999 timestamp, an id with markup in it, a 300 kB record, and a 5 MB body sent both
    with and without a declared length;
  - the 61st USDA call in a minute.
- **In a browser**, under the production CSP: sign-up, every screen, a food search and the
  offline service worker at phone and desktop widths, with a listener for CSP violations. None
  were reported.

Found a problem? See [SECURITY.md](SECURITY.md).
