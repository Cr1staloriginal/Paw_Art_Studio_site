'use strict';
const fs = require('node:fs');
const s = fs.readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
const checks = [
  ['production JWT secret validation', /JWT_SECRET.length < 32/.test(s)],
  ['explicit production admin credentials', /SECURITY: production requires explicit ADMIN_EMAIL and ADMIN_PASSWORD/.test(s)],
  ['Express CORS allowlist', /app.use(cors({ origin: corsOrigin/.test(s)],
  ['Socket.IO CORS allowlist', /cors: { origin: corsOrigin/.test(s)],
  ['security headers', /X-Content-Type-Options/.test(s) && /Strict-Transport-Security/.test(s)],
  ['login rate limit', /api\/auth\/login', rateLimit/.test(s)],
  ['registration rate limit', /api\/auth\/register', rateLimit/.test(s)],
  ['password reset rate limit', /api\/auth\/reset-password', rateLimit/.test(s)],
  ['Socket.IO JWT authentication', /io.use\(\(socket, next\) =>[\s\S]{0,700}jwt.verify/.test(s)],
  ['no wildcard CORS', !/origin: ['\"]\*['\"]/.test(s)],
];
let failures = 0;
for (const [name, ok] of checks) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failures++; }
console.log(`${checks.length - failures}/${checks.length} checks passed`);
if (failures) process.exitCode = 1;
