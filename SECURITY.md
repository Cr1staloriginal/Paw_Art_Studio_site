# Security hardening and deployment

This branch is a baseline hardening pass, not a penetration-test certificate.

## Required production environment

Set these on the VPS (never commit real secrets):
- NODE_ENV=production
- JWT_SECRET: unique random secret, at least 32 characters
- ADMIN_EMAIL and ADMIN_PASSWORD: explicit strong credentials
- SITE_URL=https://pawartstudio.store
- CORS_ORIGINS: optional comma-separated exact trusted origins; keep empty unless needed

Generate a secret with:
```bash
openssl rand -base64 48
```

Rotating JWT_SECRET invalidates all existing login tokens.

## Changes

- Restricts Express and Socket.IO CORS to SITE_URL plus CORS_ORIGINS.
- Adds baseline browser security headers and disables x-powered-by.
- Adds per-IP/per-route in-memory rate limits to registration, login, email verification/resend, password reset and contact requests.
- Adds a static security audit script.

## Known remaining work

- The rate limiter is per-process. Use a shared Redis-backed store when running multiple workers/instances.
- Verify HTTP-to-HTTPS redirects and TLS at the reverse proxy. HSTS is enabled in production; only retain includeSubDomains if every subdomain supports HTTPS.
- Some upload filters still trust client-provided MIME/extension. Add signature-based file inspection, malware scanning, archive-bomb limits and isolated storage before treating uploads as hardened.
- CSP is not enforced because the current frontend may use inline scripts/styles. Build and test a nonce/hash-based policy before enabling it.
- Review every authorization boundary and dynamic SQL statement; prepared statements alone do not prevent IDOR.
- Run npm audit and review advisories; do not force-upgrade dependencies without regression testing.

## Verification

```bash
npm ci
npm run security:audit
npm test
npm audit --audit-level=high
node --check server.js
```

Deploy to staging first. Test login, registration, password reset, admin operations, chat, uploads, order delivery and payment webhooks. Back up the SQLite database and upload directories before production deployment.
