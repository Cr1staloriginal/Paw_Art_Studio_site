# Paw Art Studio

Сайт студии дизайна с регистрацией, подтверждением email, кошельком, промокодами, реферальной системой и админ-панелью.

## Стек

- **Backend:** Node.js 18+, Express, Socket.IO
- **БД:** SQLite (better-sqlite3)
- **Auth:** JWT + bcrypt
- **Почта:** Nodemailer (Gmail SMTP)
- **Платежи:** ЮKassa
- **Frontend:** ванильный HTML/CSS/JS

## Быстрый старт

```bash
# 1. Установить зависимости
npm install

# 2. Создать .env из примера
cp .env.example .env

# 3. Заполнить .env (см. ниже)

# 4. Запустить
npm start


## Developer Console

A responsive technical console is available at `/developer.html`. Its API endpoints are protected server-side and require an authenticated account with `users.is_developer = 1`. The page is not linked from the public navigation, but its URL is not treated as a security control.

**Access must be explicitly authorized by the site owner.** Do not grant the flag without approval. After approval, connect to the production database using the normal operator procedure and grant the role to the approved account:

```sql
UPDATE users SET is_developer = 1 WHERE email = 'approved-developer@example.com';
```

To revoke access:

```sql
UPDATE users SET is_developer = 0 WHERE email = 'approved-developer@example.com';
```

The console currently provides runtime/database status, in-memory error logs, SQLite integrity checks and downloadable SQLite backups. Logs are in memory and reset on restart; they intentionally do not expose environment secrets. Backups contain private user data and must be stored securely.

## Production security notes

- Set a unique random `JWT_SECRET` of at least 32 characters and a strong `ADMIN_PASSWORD` of at least 12 characters in production. The server refuses to start in production with missing/default values.
- JWT sessions expire after 12 hours; users may need to sign in again after deployment.
- Client-supplied wallet credits are disabled. Wallet deposits must go through the payment provider flow.
- YooKassa webhook events are treated as untrusted: the server retrieves the payment from the YooKassa API and checks the succeeded status, RUB amount, user metadata and matching pending local payment before crediting the wallet.
- Socket.IO connections require a valid JWT. Joining and sending messages is limited to the two participants recorded for that chat; the sender ID comes from the verified token.
- Before deployment, test the payment flow in the provider's test mode and verify existing chat clients against the new authenticated socket protocol.
