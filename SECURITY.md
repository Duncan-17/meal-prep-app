# Security policy

## Reporting a vulnerability

Please report privately through GitHub: open the repository's **Security** tab, then choose
**Report a vulnerability**. That opens a private advisory that only the maintainer can see.

Please don't open a public issue for anything that could put someone's data at risk.

Include what you found, how to reproduce it, and what an attacker could do with it. Expect an
acknowledgement within a week. This is a one-person project, so a fix may take longer, but you
will hear back either way.

## Scope

In scope:

- the live app at `meal-prep-app.dncanzano.workers.dev`;
- the Worker in `worker/`;
- the client in `src/`;
- the admin script.

Especially wanted: anything that lets one account read or change another's data, bypasses
sign-in, or exposes the USDA API key.

Out of scope:

- denial of service by volume;
- findings that need a compromised device or Cloudflare account;
- reports from automated scanners without a demonstrated impact;
- the limits already listed in [THREAT_MODEL.md](THREAT_MODEL.md#known-limits).

Please test against an account you created yourself, and never against other people's data.

## Supported versions

Only the current `main` branch, which is what is deployed.
