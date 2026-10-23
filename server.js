require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server: SocketServer } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { YooKassa } = require('yookassa-api-sdk');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change_me';
const IS_PROD = process.env.NODE_ENV === 'production';
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'paw.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars');
const PORTFOLIO_DIR = path.join(UPLOAD_DIR, 'portfolio');
const CONTENT_DIR = path.join(UPLOAD_DIR, 'content');
const SITE_URL = process.env.SITE_URL || 'https://pawartstudio.store';

[DATABASE_PATH].forEach(p => {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
[UPLOAD_DIR, AVATAR_DIR, PORTFOLIO_DIR, CONTENT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// --- Почта ---
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// --- ЮKassa ---
let yookassa = null;
if (process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY) {
  yookassa = YooKassa({
    shop_id: process.env.YOOKASSA_SHOP_ID,
    secret_key: process.env.YOOKASSA_SECRET_KEY,
  });
  console.log('✅ ЮKassa инициализирована');
} else {
  console.log('⚠️ ЮKassa не настроена');
}

const io = new SocketServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

// --- Multer ---
const storage = multer.diskStorage({
  destination: (req, file, cb) =>
    cb(null, file.fieldname === 'avatar' ? AVATAR_DIR : PORTFOLIO_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype)),
});

const contentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CONTENT_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
  },
});
const contentUpload = multer({
  storage: contentStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype)),
});

// --- БД ---
const db = new Database(DATABASE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'client',
    requested_role TEXT,
    balance INTEGER NOT NULL DEFAULT 0,
    avatar TEXT,
    bio TEXT,
    is_root INTEGER NOT NULL DEFAULT 0,
    email_verified INTEGER NOT NULL DEFAULT 0,
    verification_code TEXT,
    verification_expires INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('in','out')),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    comment TEXT,
    card_number TEXT,
    admin_comment TEXT,
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER,
    reviewed_by INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    budget INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    client_id INTEGER NOT NULL,
    executor_id INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (executor_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a INTEGER NOT NULL,
    user_b INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (user_a, user_b),
    FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at INTEGER,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS site_content (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    project TEXT,
    service TEXT NOT NULL,
    budget TEXT,
    reference TEXT,
    contact_method TEXT NOT NULL DEFAULT 'Сайт',
    contact_detail TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    payment_id TEXT UNIQUE,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS promocodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL COLLATE NOCASE,
    bonus INTEGER NOT NULL DEFAULT 0,
    discount INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS promo_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    promo_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (promo_id, user_id),
    FOREIGN KEY (promo_id) REFERENCES promocodes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS referral_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referral_code TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_msg_chat ON messages(chat_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_wd_user ON withdrawals(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wd_status ON withdrawals(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ref_code ON referral_clicks(referral_code, created_at DESC);
`);

function safeAddColumn(table, column, definition) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`➕ Добавлена колонка ${table}.${column}`);
    }
  } catch (e) { console.warn(`⚠️ Миграция ${table}.${column}:`, e.message); }
}
db.exec("CREATE TABLE IF NOT EXISTS password_reset_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL COLLATE NOCASE, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)");
db.exec("CREATE INDEX IF NOT EXISTS idx_password_reset_email ON password_reset_codes(email, created_at DESC)");
safeAddColumn('users', 'referral_code', 'TEXT');
safeAddColumn('users', 'referred_by', 'INTEGER');

// Portfolio author fields: user_id remains the uploader.
safeAddColumn('portfolio', 'author_name', 'TEXT');
safeAddColumn('portfolio', 'author_user_id', 'INTEGER');
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_portfolio_author_user
  ON portfolio(author_user_id);
  CREATE INDEX IF NOT EXISTS idx_portfolio_uploader
  ON portfolio(user_id);
`);

// Backfill legacy entries: before author fields existed, the uploader
// was the only available author reference. Preserve explicit authors.
db.exec(`
  UPDATE portfolio
  SET author_user_id = user_id
  WHERE author_user_id IS NULL
    AND EXISTS (SELECT 1 FROM users WHERE users.id = portfolio.user_id);

  UPDATE portfolio
  SET author_name = (
    SELECT users.name FROM users WHERE users.id = portfolio.user_id
  )
  WHERE (author_name IS NULL OR TRIM(author_name) = '')
    AND EXISTS (SELECT 1 FROM users WHERE users.id = portfolio.user_id);
`);

try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ref_code ON users(referral_code) WHERE referral_code IS NOT NULL');
} catch (e) { /* ignore */ }

// --- Главный админ ---
const adminExists = db.prepare('SELECT * FROM users WHERE email = ?').get(ADMIN_EMAIL);
if (!adminExists) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare(`INSERT INTO users (name, email, password, role, balance, is_root, email_verified, referral_code, created_at)
              VALUES (?, ?, ?, 'admin', 0, 1, 1, ?, ?)`)
    .run('Главный админ', ADMIN_EMAIL, hash, 'ROOT-' + Math.random().toString(36).slice(2, 8), Date.now());
  console.log(`✅ Создан ГЛАВНЫЙ админ: ${ADMIN_EMAIL}`);
} else {
  if (adminExists.role !== 'admin' || adminExists.is_root !== 1) {
    db.prepare(`UPDATE users SET role = 'admin', is_root = 1 WHERE id = ?`).run(adminExists.id);
    console.log(`👑 Главный админ восстановлен`);
  }
  if (!bcrypt.compareSync(ADMIN_PASSWORD, adminExists.password)) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?')
      .run(bcrypt.hashSync(ADMIN_PASSWORD, 10), adminExists.id);
    console.log(`🔑 Пароль главного админа обновлён`);
  }
}

// --- Дефолтный промокод ---
const promoExists = db.prepare('SELECT id FROM promocodes WHERE code = ?').get('PAWSTART');
if (!promoExists) {
  db.prepare(`INSERT INTO promocodes (code, bonus, max_uses, active, created_at)
              VALUES ('PAWSTART', 10000, 1000, 1, ?)`).run(Date.now());
  console.log('🎟️ Создан промокод PAWSTART');
}

// --- Дефолтный контент ---
const DEFAULT_CONTENT = {
  hero_title: 'Paw Art Studio',
  hero_subtitle: 'Маскоты, стикеры и визуал с характером',
  about_title: 'О студии',
  about_text: 'Мы создаём уникальный визуал для брендов.',
  about_stat_1_desc: 'проектов',
  about_stat_2_desc: 'клиентов',
  about_stat_3_desc: 'срок',
  support_email: 'support@pawartstudio.store',
  support_telegram: '',
};
// Fill missing defaults without overwriting values configured in the editor.
{
  const insertDefault = db.prepare('INSERT OR IGNORE INTO site_content (key, value, updated_at) VALUES (?, ?, ?)');
  const now = Date.now();
  for (const [key, value] of Object.entries(DEFAULT_CONTENT)) insertDefault.run(key, String(value), now);
}
const contentCount = db.prepare('SELECT COUNT(*) AS n FROM site_content').get().n;
if (contentCount === 0) {
  const now = Date.now();
  const stmt = db.prepare('INSERT INTO site_content (key, value, updated_at) VALUES (?, ?, ?)');
  const tx = db.transaction(items => {
    for (const [k, v] of Object.entries(items)) stmt.run(k, String(v), now);
  });
  tx(DEFAULT_CONTENT);
  console.log('📄 Загружен дефолтный контент');
}

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '7d' : 0 }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: IS_PROD ? '30d' : 0 }));

// --- Helpers ---
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Не найден' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Токен недействителен' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нужны права админа' });
  next();
}

function rootOnly(req, res, next) {
  if (req.user.role !== 'admin' || req.user.is_root !== 1)
    return res.status(403).json({ error: 'Только главный админ' });
  next();
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    requestedRole: u.requested_role,
    balance: u.balance,
    avatar: u.avatar,
    bio: u.bio,
    isRoot: u.is_root === 1,
    emailVerified: u.email_verified === 1,
    referralCode: u.referral_code,
    createdAt: u.created_at,
  };
}

function withdrawalRow(w) {
  if (!w) return null;
  return {
    id: w.id,
    userId: w.user_id,
    amount: w.amount,
    status: w.status,
    comment: w.comment,
    cardNumber: w.card_number,
    adminComment: w.admin_comment,
    createdAt: w.created_at,
    reviewedAt: w.reviewed_at,
    reviewedBy: w.reviewed_by,
  };
}

function txRow(t) {
  if (!t) return null;
  return { id: t.id, title: t.title, amount: t.amount, type: t.type, date: t.created_at };
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateReferralCode() {
  return 'PAW' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function sendVerificationEmail(email, code) {
  if (!process.env.SMTP_HOST) {
    console.warn('⚠️ SMTP не настроен, код не отправлен:', code);
    return;
  }
  await mailer.sendMail({
    from: process.env.SMTP_FROM || 'Paw Art Studio <no-reply@pawartstudio.store>',
    to: email,
    subject: 'Подтверждение регистрации — Paw Art Studio',
    html: `
      <h2>Добро пожаловать в Paw Art Studio!</h2>
      <p>Ваш код подтверждения:</p>
      <h1 style="font-size: 32px; letter-spacing: 4px;">${code}</h1>
      <p>Код действителен 15 минут.</p>
    `,
  });
}

app.get('/health', (req, res) =>
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() })
);

/* ==================== AUTH ==================== */
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, ref } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Заполните все поля' });
  if (String(password).length < 6)
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });

  const cleanEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
    return res.status(400).json({ error: 'Некорректный email' });

  const existing = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(cleanEmail);
  if (existing && existing.email_verified === 1)
    return res.status(400).json({ error: 'Email занят' });

  let referrer = null;
  if (ref) {
    referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(String(ref).trim().toUpperCase());
  }

  const code = generateCode();
  const expires = Date.now() + 15 * 60 * 1000;

  try {
    const hash = bcrypt.hashSync(String(password), 10);
    const now = Date.now();

    const tx = db.transaction(() => {
      if (existing && existing.email_verified === 0) {
        db.prepare(`UPDATE users SET name = ?, password = ?, verification_code = ?, verification_expires = ?
                    WHERE id = ?`)
          .run(String(name).trim(), hash, code, expires, existing.id);
        return existing.id;
      }
      const myRefCode = generateReferralCode();
      const info = db.prepare(`INSERT INTO users
        (name, email, password, role, balance, email_verified, verification_code, verification_expires, referral_code, referred_by, created_at)
        VALUES (?, ?, ?, 'client', 0, 0, ?, ?, ?, ?, ?)`)
        .run(String(name).trim(), cleanEmail, hash, code, expires, myRefCode, referrer ? referrer.id : null, now);
      return info.lastInsertRowid;
    });

    const userId = tx();

    sendVerificationEmail(cleanEmail, code).catch(err =>
      console.error('❌ Ошибка отправки письма:', err.message)
    );

    res.json({ ok: true, userId, email: cleanEmail, message: 'Код подтверждения отправлен на email' });
  } catch (e) {
    console.error('❌ Ошибка регистрации:', e);
    res.status(500).json({ error: 'Внутренняя ошибка сервера. Попробуйте позже.' });
  }
});

app.post('/api/auth/verify-email', (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || code === undefined || code === null) return res.status(400).json({ error: 'Укажите email и код' });
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode = String(code).trim();
    if (!/^\d{6}$/.test(cleanCode)) return res.status(400).json({ error: 'Введите шестизначный код из письма' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.email_verified === 1) return res.status(400).json({ error: 'Email уже подтверждён. Попробуйте войти.' });
    if (!user.verification_code) return res.status(400).json({ error: 'Код не найден. Запросите новый.' });
    if (String(user.verification_code) !== cleanCode) return res.status(400).json({ error: 'Неверный код. Проверьте письмо и попробуйте снова.' });
    if (!user.verification_expires || Date.now() > Number(user.verification_expires)) {
      return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
    }

    const updated = db.transaction(() => {
      const result = db.prepare('UPDATE users SET email_verified = 1, verification_code = NULL, verification_expires = NULL WHERE id = ? AND email_verified = 0 AND verification_code = ? AND verification_expires > ?').run(user.id, cleanCode, Date.now());
      if (result.changes !== 1) throw new Error('VERIFY_STATE_CHANGED');
      return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    })();

    if (!updated) return res.status(500).json({ error: 'Не удалось загрузить данные пользователя' });
    const token = jwt.sign({ id: updated.id }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ ok: true, token, user: publicUser(updated) });
  } catch (err) {
    if (err.message === 'VERIFY_STATE_CHANGED') {
      return res.status(409).json({ error: 'Код уже использован или истёк. Запросите новый.' });
    }
    console.error('❌ Ошибка подтверждения email:', err);
    return res.status(500).json({ error: 'Ошибка сервера при подтверждении email. Попробуйте позже.' });
  }
});

app.post('/api/auth/resend-code', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Укажите email' });
  const cleanEmail = String(email).trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.email_verified === 1) return res.status(400).json({ error: 'Email уже подтверждён' });

  const code = generateCode();
  const expires = Date.now() + 15 * 60 * 1000;
  db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?')
    .run(code, expires, user.id);

  await sendVerificationEmail(cleanEmail, code).catch(err =>
    console.error('❌ Ошибка отправки письма:', err.message)
  );
  res.json({ ok: true, message: 'Код отправлен повторно' });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Укажите корректный email' });
  const user = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(email);
  if (user && user.email_verified === 1) {
    const code = generateCode();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const now = Date.now();
    db.prepare('DELETE FROM password_reset_codes WHERE email = ?').run(email);
    db.prepare('INSERT INTO password_reset_codes (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)').run(email, codeHash, now + 15 * 60 * 1000, now);
    try {
      if (!process.env.SMTP_HOST) throw new Error('SMTP не настроен');
      await mailer.sendMail({
        from: process.env.SMTP_FROM || 'Paw Art Studio <no-reply@pawartstudio.store>',
        to: email,
        subject: 'Сброс пароля — Paw Art Studio',
        html: '<h2>Сброс пароля Paw Art Studio</h2><p>Код для установки нового пароля:</p><h1 style="font-size:32px;letter-spacing:4px">' + code + '</h1><p>Код действует 15 минут. Если вы не запрашивали сброс, проигнорируйте письмо.</p>'
      });
    } catch (err) {
      db.prepare('DELETE FROM password_reset_codes WHERE email = ?').run(email);
      console.error('Ошибка отправки письма сброса пароля:', err.message);
      return res.status(503).json({ error: 'Не удалось отправить письмо. Попробуйте позже или обратитесь в поддержку.' });
    }
  }
  res.json({ ok: true, message: 'Если аккаунт существует, код отправлен на почту' });
});

app.post('/api/auth/reset-password', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  const password = String(req.body?.password || '');
  if (!email || !/^\d{6}$/.test(code) || password.length < 6) return res.status(400).json({ error: 'Проверьте email, шестизначный код и пароль (минимум 6 символов)' });
  const record = db.prepare('SELECT * FROM password_reset_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email);
  if (!record) return res.status(400).json({ error: 'Код не найден. Запросите новый.' });
  if (Date.now() > record.expires_at) {
    db.prepare('DELETE FROM password_reset_codes WHERE id = ?').run(record.id);
    return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
  }
  if (record.attempts >= 5) {
    db.prepare('DELETE FROM password_reset_codes WHERE id = ?').run(record.id);
    return res.status(429).json({ error: 'Слишком много попыток. Запросите новый код.' });
  }
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  if (hash !== record.code_hash) {
    db.prepare('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE id = ?').run(record.id);
    return res.status(400).json({ error: 'Неверный код' });
  }
  const user = db.prepare('SELECT id FROM users WHERE email = ? AND email_verified = 1').get(email);
  if (!user) return res.status(400).json({ error: 'Аккаунт не найден или email не подтверждён' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
  db.prepare('DELETE FROM password_reset_codes WHERE email = ?').run(email);
  res.json({ ok: true, message: 'Пароль успешно изменён' });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Заполните все поля' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password), user.password))
    return res.status(401).json({ error: 'Неверный email или пароль' });
  if (user.email_verified !== 1)
    return res.status(403).json({ error: 'Email не подтверждён. Проверьте почту.' });

  if (!user.referral_code) {
    const newCode = generateReferralCode();
    db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(newCode, user.id);
    user.referral_code = newCode;
  }

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

/* ==================== CONTENT ==================== */
app.get('/api/content', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM site_content').all();
  const content = {};
  rows.forEach(r => { content[r.key] = r.value; });
  res.json({ content });
});

const CONTENT_KEY_ALLOWLIST = new Set([
  'hero_eyebrow', 'hero_title', 'hero_subtitle', 'hero_badge_1', 'hero_badge_2',
  'hero_badge_3', 'hero_image', 'about_title', 'about_text', 'about_quote',
  'about_stat_1', 'about_stat_1_desc', 'about_stat_2', 'about_stat_2_desc',
  'about_stat_3', 'about_stat_3_desc', 'contact_discord', 'contact_telegram',
  'contact_email', 'support_email', 'support_telegram', 'footer_text',
  ...Array.from({ length: 7 }, (_, i) => i + 1).flatMap(n => [
    `service_${n}_name`, `service_${n}_desc`, `service_${n}_price`, `service_${n}_image`
  ]),
  ...Array.from({ length: 5 }, (_, i) => i + 1).flatMap(n => [
    `pricing_${n}_name`, `pricing_${n}_price`, `pricing_${n}_features`,
    `faq_${n}_q`, `faq_${n}_a`
  ])
]);

app.post('/api/admin/content', auth, rootOnly, (req, res) => {
  const updates = req.body?.updates;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates))
    return res.status(400).json({ error: 'Ожидается объект updates' });
  const entries = Object.entries(updates);
  if (!entries.length) return res.status(400).json({ error: 'Нет полей для сохранения' });
  if (entries.length > 100) return res.status(400).json({ error: 'Слишком много полей' });
  for (const [key, value] of entries) {
    if (!CONTENT_KEY_ALLOWLIST.has(key))
      return res.status(400).json({ error: `Недопустимый ключ: ${key}` });
    if (value !== null && value !== undefined && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
      return res.status(400).json({ error: `Недопустимое значение для ${key}` });
    if (String(value ?? '').length > 20000)
      return res.status(400).json({ error: `Поле ${key} слишком длинное` });
  }

  const now = Date.now();
  const stmt = db.prepare(`INSERT INTO site_content (key, value, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  try {
    const tx = db.transaction(items => {
      for (const [key, value] of items) stmt.run(key, String(value ?? ''), now);
    });
    tx(entries);
    res.json({ ok: true, count: entries.length });
  } catch (e) {
    console.error('[admin/content] Ошибка сохранения:', e);
    res.status(500).json({ error: 'Не удалось сохранить контент' });
  }
});

app.post('/api/admin/content/upload', auth, rootOnly, (req, res, next) => {
  contentUpload.single('image')(req, res, err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Файл больше 5 МБ' });
      return res.status(400).json({ error: 'Допустимы изображения PNG, JPG, WEBP и GIF' });
    }
    if (!req.file) return res.status(400).json({ error: 'Выберите изображение' });
    res.json({ ok: true, url: '/uploads/content/' + req.file.filename });
  });
});

/* ==================== YOOKASSA ==================== */
app.post('/api/payments/create', auth, async (req, res) => {
  if (!yookassa)
    return res.status(503).json({ error: 'ЮKassa не настроена. Обратитесь к админу.' });

  const rub = Number(req.body?.amount);
  const kopecks = Math.round(rub * 100);
  if (!kopecks || isNaN(kopecks) || kopecks < 100)
    return res.status(400).json({ error: 'Минимум 1 ₽' });

  try {
    const payment = await yookassa.payments.create({
      amount: { value: rub.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: `${SITE_URL}/dashboard` },
      description: `Пополнение баланса Paw Art Studio (#${req.user.id})`,
      metadata: { userId: String(req.user.id) },
    }, crypto.randomUUID());

    db.prepare(`INSERT INTO payments (user_id, payment_id, amount, status, created_at)
                VALUES (?, ?, ?, 'pending', ?)`)
      .run(req.user.id, payment.id, kopecks, Date.now());

    res.json({ paymentId: payment.id, confirmationUrl: payment.confirmation.confirmation_url });
  } catch (err) {
    const providerMessage = String(
      err?.description || err?.response?.data?.description ||
      err?.response?.data?.message || err?.message || 'неизвестная ошибка'
    );
    const providerCode = err?.code || err?.response?.data?.code || err?.error_code || null;
    const providerStatus = err?.status || err?.statusCode || err?.response?.status || null;

    // Never log credentials or request headers; retain only useful diagnostic fields.
    console.error('❌ ЮKassa: создание платежа отклонено', {
      message: providerMessage,
      code: providerCode,
      status: providerStatus,
    });

    const forbidden = /transaction forbidden|unspecified error/i.test(providerMessage);
    const userMessage = forbidden
      ? 'ЮKassa отклонила создание платежа. Проверьте статус магазина и актуальность Shop ID/секретного ключа в настройках сервера. Если данные верны, обратитесь в поддержку ЮKassa — ограничение может быть на стороне магазина.'
      : 'Не удалось создать платёж в ЮKassa. Попробуйте позже; подробности ошибки записаны в журнал сервера.';
    res.status(502).json({ error: userMessage, code: providerCode || undefined });
  }
});

app.post('/api/payments/webhook', express.json(), (req, res) => {
  const { event, object } = req.body || {};
  console.log('🔔 Webhook:', event, object?.id);

  if (event === 'payment.succeeded' && object) {
    const userId = parseInt(object.metadata?.userId, 10);
    const amount = Math.round(parseFloat(object.amount?.value || '0') * 100);

    if (userId && amount > 0) {
      const existing = db.prepare('SELECT id, status FROM payments WHERE payment_id = ?').get(object.id);
      if (existing && existing.status === 'succeeded') return res.status(200).send('OK');

      if (existing) {
        db.prepare('UPDATE payments SET status = ? WHERE payment_id = ?').run('succeeded', object.id);
      } else {
        db.prepare(`INSERT INTO payments (user_id, payment_id, amount, status, created_at)
                    VALUES (?, ?, ?, 'succeeded', ?)`).run(userId, object.id, amount, Date.now());
      }

      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
      if (user) {
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
        db.prepare(`INSERT INTO transactions (user_id, title, amount, type, created_at)
                    VALUES (?, 'Пополнение через ЮKassa', ?, 'in', ?)`).run(userId, amount, Date.now());
        console.log(`✅ Зачислено ${amount / 100} ₽ → #${userId}`);
      }
    }
  }
  res.status(200).send('OK');
});

/* ==================== PROFILE ==================== */
app.post('/api/profile/update', auth, (req, res) => {
  const { name, bio, currentPassword, newPassword } = req.body || {};
  const updates = [];
  const params = [];

  if (name && String(name).trim()) { updates.push('name = ?'); params.push(String(name).trim()); }
  if (typeof bio === 'string') { updates.push('bio = ?'); params.push(bio.trim().slice(0, 500)); }

  if (newPassword) {
    if (!currentPassword) return res.status(400).json({ error: 'Введите текущий пароль' });
    if (!bcrypt.compareSync(currentPassword, req.user.password))
      return res.status(400).json({ error: 'Текущий пароль неверен' });
    if (String(newPassword).length < 6)
      return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });
    updates.push('password = ?');
    params.push(bcrypt.hashSync(String(newPassword), 10));
  }

  if (!updates.length) return res.status(400).json({ error: 'Нечего обновлять' });
  params.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(u) });
});

app.post('/api/profile/avatar', auth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const url = '/uploads/avatars/' + req.file.filename;
  if (req.user.avatar) {
    const old = path.join(UPLOAD_DIR, req.user.avatar.replace(/^\/uploads\//, ''));
    if (fs.existsSync(old)) try { fs.unlinkSync(old); } catch {}
  }
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(url, req.user.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(u) });
});

/* ==================== WALLET ==================== */
app.post('/api/wallet/deposit', auth, (req, res) => {
  const k = Math.round(Number(req.body?.amount) * 100);
  if (!k || isNaN(k) || k <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(k, req.user.id);
  db.prepare(`INSERT INTO transactions (user_id, title, amount, type, created_at)
              VALUES (?, 'Пополнение баланса', ?, 'in', ?)`).run(req.user.id, k, Date.now());
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(u) });
});

app.post('/api/wallet/withdraw', auth, (req, res) => {
  const { amount, cardNumber } = req.body || {};
  const k = Math.round(Number(amount) * 100);
  if (!k || isNaN(k) || k <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
  if (k < 100) return res.status(400).json({ error: 'Минимум 1 ₽' });
  if (!cardNumber || String(cardNumber).replace(/\s/g, '').length < 16)
    return res.status(400).json({ error: 'Укажите корректный номер карты (16 цифр)' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.balance < k) return res.status(400).json({ error: 'Недостаточно средств' });

  const pendingSum = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM withdrawals
                                 WHERE user_id = ? AND status = 'pending'`).get(user.id).s;
  if (user.balance - pendingSum < k)
    return res.status(400).json({ error: 'Недостаточно средств (учитывая заявки)' });

  const now = Date.now();
  const cleanCard = String(cardNumber).replace(/\s/g, '');

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(k, user.id);
    const info = db.prepare(`INSERT INTO withdrawals (user_id, amount, status, card_number, created_at)
                             VALUES (?, ?, 'pending', ?, ?)`).run(user.id, k, cleanCard, now);
    return info.lastInsertRowid;
  });

  const wdId = tx();
  const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(wdId);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ withdrawal: withdrawalRow(withdrawal), user: publicUser(updated) });
});

app.get('/api/wallet/withdrawals', auth, (req, res) => {
  const items = db.prepare(`SELECT * FROM withdrawals WHERE user_id = ?
                            ORDER BY created_at DESC LIMIT 100`).all(req.user.id);
  res.json({ withdrawals: items.map(withdrawalRow) });
});

app.get('/api/wallet/transactions', auth, (req, res) => {
  const txs = db.prepare(`SELECT id, title, amount, type, created_at FROM transactions
                          WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`).all(req.user.id);
  res.json({ transactions: txs.map(txRow) });
});

/* ==================== ПРОМОКОДЫ ==================== */
app.post('/api/wallet/promo/redeem', auth, (req, res) => {
  const rawCode = String(req.body?.code || '').trim().toUpperCase();
  if (!rawCode) return res.status(400).json({ error: 'Введите промокод' });

  const promo = db.prepare('SELECT * FROM promocodes WHERE code = ?').get(rawCode);
  if (!promo) return res.status(404).json({ error: 'Промокод не найден' });
  if (!promo.active) return res.status(400).json({ error: 'Промокод неактивен' });
  if (promo.expires_at && Date.now() > promo.expires_at)
    return res.status(400).json({ error: 'Промокод истёк' });
  if (promo.max_uses && promo.uses >= promo.max_uses)
    return res.status(400).json({ error: 'Лимит использований исчерпан' });

  const already = db.prepare('SELECT id FROM promo_redemptions WHERE promo_id = ? AND user_id = ?')
    .get(promo.id, req.user.id);
  if (already) return res.status(400).json({ error: 'Вы уже использовали этот промокод' });

  try {
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO promo_redemptions (promo_id, user_id, created_at) VALUES (?, ?, ?)`)
        .run(promo.id, req.user.id, Date.now());
      db.prepare('UPDATE promocodes SET uses = uses + 1 WHERE id = ?').run(promo.id);
      if (promo.bonus > 0) {
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(promo.bonus, req.user.id);
        db.prepare(`INSERT INTO transactions (user_id, title, amount, type, created_at)
                    VALUES (?, ?, ?, 'in', ?)`)
          .run(req.user.id, `Промокод ${promo.code}`, promo.bonus, Date.now());
      }
    });
    tx();

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const bonusRub = (promo.bonus / 100).toFixed(2);
    res.json({
      user: publicUser(updated),
      message: promo.bonus > 0
        ? `Промокод активирован! Начислено ${bonusRub} ₽`
        : `Промокод активирован! Скидка ${promo.discount}%`,
      bonus: promo.bonus,
      discount: promo.discount,
    });
  } catch (e) {
    console.error('❌ Ошибка промокода:', e);
    res.status(500).json({ error: 'Не удалось активировать промокод' });
  }
});

/* ==================== РЕФЕРАЛЫ ==================== */
app.get('/api/referrals/me', auth, (req, res) => {
  let code = req.user.referral_code;
  if (!code) {
    code = generateReferralCode();
    db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(code, req.user.id);
  }

  const clicks = db.prepare('SELECT COUNT(*) AS n FROM referral_clicks WHERE referral_code = ?').get(code).n;
  const invited = db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?').get(req.user.id).n;

  res.json({
    code,
    link: `${SITE_URL}/?ref=${code}`,
    clicks,
    invited,
  });
});

app.get('/api/referrals/click/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Нет кода' });

  const owner = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(code);
  if (!owner) return res.status(404).json({ error: 'Реферал не найден' });

  db.prepare(`INSERT INTO referral_clicks (referral_code, ip, user_agent, created_at)
              VALUES (?, ?, ?, ?)`)
    .run(code, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 300), Date.now());

  res.json({ ok: true, code });
});

/* ==================== CONTACT REQUESTS ==================== */
function optionalRequestUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    return db.prepare('SELECT id FROM users WHERE id = ?').get(payload.id) || null;
  } catch { return null; }
}

app.post('/api/requests', (req, res) => {
  try {
    const b = req.body || {};
    const v = {
      name: String(b.name || '').trim(), project: String(b.project || '').trim(),
      service: String(b.service || '').trim(), budget: String(b.budget || '').trim(),
      reference: String(b.reference || '').trim(),
      contactMethod: String(b.contactMethod || 'Сайт').trim(),
      contactDetail: String(b.contactDetail || '').trim()
    };
    if (!v.name || !v.service) return res.status(400).json({ error: 'Укажите имя и услугу' });
    const limits = { name: 100, project: 200, service: 100, budget: 100, reference: 5000, contactDetail: 300 };
    for (const [key, max] of Object.entries(limits)) {
      if (v[key].length > max) return res.status(400).json({ error: 'Поле превышает допустимую длину: ' + key });
    }
    if (!['Сайт', 'Discord', 'Telegram', 'VK', 'Телефон', 'Email'].includes(v.contactMethod))
      return res.status(400).json({ error: 'Неизвестный способ связи' });
    if (v.contactMethod !== 'Сайт' && !v.contactDetail)
      return res.status(400).json({ error: 'Укажите контакт для связи' });
    const user = optionalRequestUser(req);
    const result = db.prepare(`
      INSERT INTO requests (user_id, name, project, service, budget, reference, contact_method, contact_detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user ? user.id : null, v.name, v.project || null, v.service, v.budget || null,
      v.reference || null, v.contactMethod, v.contactDetail || null, Date.now());
    return res.status(201).json({ ok: true, id: Number(result.lastInsertRowid), message: 'Заявка успешно сохранена' });
  } catch (err) {
    console.error('[requests] Ошибка сохранения:', err);
    return res.status(500).json({ error: 'Не удалось сохранить заявку' });
  }
});

app.get('/api/admin/requests/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Некорректный ID заявки' });
  try {
    const r = db.prepare(`
      SELECT r.*, u.name AS account_name, u.email AS account_email, u.role AS account_role
      FROM requests r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ?
    `).get(id);
    if (!r) return res.status(404).json({ error: 'Заявка не найдена' });
    return res.json({ request: {
      id: Number(r.id), userId: r.user_id == null ? null : Number(r.user_id),
      name: r.name || '', project: r.project || '', service: r.service || '',
      budget: r.budget || '', reference: r.reference || '',
      contactMethod: r.contact_method || 'Сайт', contactDetail: r.contact_detail || '',
      createdAt: Number(r.created_at || 0),
      account: r.user_id == null ? null : {
        id: Number(r.user_id), name: r.account_name || '',
        email: r.account_email || '', role: r.account_role || 'client'
      }
    }});
  } catch (err) {
    console.error('[admin/requests/:id] Ошибка:', err);
    return res.status(500).json({ error: 'Не удалось загрузить заявку' });
  }
});

app.get('/api/admin/users/:id/full', auth, adminOnly, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Некорректный ID пользователя' });
  try {
    const user = db.prepare('SELECT id, name, email, role, balance, avatar, bio, created_at, is_root FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    const transactions = db.prepare('SELECT id, title, amount, type, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(userId).map(t => ({
      id: Number(t.id), title: t.title || '', amount: Number(t.amount || 0), type: t.type, date: Number(t.created_at || 0)
    }));
    const withdrawals = db.prepare('SELECT id, amount, status, comment, card_number, admin_comment, created_at, reviewed_at FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(userId).map(w => ({
      id: Number(w.id), amount: Number(w.amount || 0), status: w.status, comment: w.comment || '',
      cardNumber: w.card_number || '', adminComment: w.admin_comment || '', createdAt: Number(w.created_at || 0),
      reviewedAt: w.reviewed_at == null ? null : Number(w.reviewed_at)
    }));
    const stats = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE 0 END), 0) AS totalIn,
             COALESCE(SUM(CASE WHEN type = 'out' THEN amount ELSE 0 END), 0) AS totalOut
      FROM transactions WHERE user_id = ?
    `).get(userId);
    return res.json({
      user: { id: Number(user.id), name: user.name || '', email: user.email || '', role: user.role || 'client',
        balance: Number(user.balance || 0), avatar: user.avatar || null, bio: user.bio || '',
        createdAt: Number(user.created_at || 0), isRoot: Number(user.is_root || 0) === 1 },
      transactions, withdrawals,
      stats: { totalIn: Number(stats.totalIn || 0), totalOut: Number(stats.totalOut || 0) }
    });
  } catch (err) {
    console.error('[admin/users/:id/full] Ошибка:', err);
    return res.status(500).json({ error: 'Не удалось загрузить историю пользователя' });
  }
});

/* ==================== ADMIN: users and balance ==================== */
app.get('/api/admin/users', auth, (req, res) => {
  const isAdmin = req.user?.role === 'admin' || Number(req.user?.is_root) === 1;
  if (!isAdmin) return res.status(403).json({ error: 'Недостаточно прав' });

  try {
    // Only expose fields required by the UI, never password hashes.
    const users = db.prepare(`
      SELECT id, name, email, role, balance, avatar, is_root, created_at
      FROM users
      ORDER BY id DESC
      LIMIT 5000
    `).all().map(u => ({
      id: Number(u.id),
      name: String(u.name || 'Без имени'),
      email: String(u.email || ''),
      role: String(u.role || 'client'),
      balance: Number(u.balance ?? 0),
      avatar: u.avatar || null,
      isRoot: Number(u.is_root) === 1,
      createdAt: Number(u.created_at || 0)
    }));
    return res.json({ users });
  } catch (err) {
    console.error('[admin/users] Ошибка:', err);
    return res.status(500).json({ error: 'Не удалось загрузить пользователей' });
  }
});


// Admin statistics: all monetary values are stored and returned in kopecks.
app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  try {
    const scalar = (sql, ...params) => Number(db.prepare(sql).get(...params)?.n || 0);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stats = {
      money: {
        totalBalance: scalar('SELECT COALESCE(SUM(balance), 0) AS n FROM users'),
        totalIn: scalar("SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE type = 'in'"),
        totalOut: scalar("SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE type = 'out'")
      },
      withdrawals: {
        pendingCount: scalar("SELECT COUNT(*) AS n FROM withdrawals WHERE status = 'pending'"),
        pendingSum: scalar("SELECT COALESCE(SUM(amount), 0) AS n FROM withdrawals WHERE status = 'pending'")
      },
      users: {
        total: scalar('SELECT COUNT(*) AS n FROM users'),
        new7: scalar('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', sevenDaysAgo),
        clients: scalar("SELECT COUNT(*) AS n FROM users WHERE role = 'client'"),
        executors: scalar("SELECT COUNT(*) AS n FROM users WHERE role = 'executor'"),
        managers: scalar("SELECT COUNT(*) AS n FROM users WHERE role = 'manager'"),
        admins: scalar("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
      },
      projects: {
        total: scalar('SELECT COUNT(*) AS n FROM projects'),
        inProgress: scalar("SELECT COUNT(*) AS n FROM projects WHERE status = 'in_progress'"),
        completed: scalar("SELECT COUNT(*) AS n FROM projects WHERE status = 'completed'"),
        cancelled: scalar("SELECT COUNT(*) AS n FROM projects WHERE status = 'cancelled'")
      },
      messages: { total: scalar('SELECT COUNT(*) AS n FROM messages') },
      portfolio: { total: scalar('SELECT COUNT(*) AS n FROM portfolio') },
      payments: {
        succeededSum: scalar("SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE LOWER(status) IN ('succeeded', 'success', 'paid')")
      }
    };
    return res.json(stats);
  } catch (err) {
    console.error('[admin/stats] Ошибка:', err);
    return res.status(500).json({ error: 'Не удалось загрузить статистику' });
  }
});

app.get('/api/admin/requests', auth, adminOnly, (req, res) => {
  try {
    const requests = db.prepare(`
      SELECT id, name, email, avatar, role, requested_role, created_at
      FROM users
      WHERE requested_role IS NOT NULL AND TRIM(requested_role) <> ''
      ORDER BY created_at ASC, id ASC
      LIMIT 1000
    `).all().map(u => ({
      id: Number(u.id),
      name: String(u.name || 'Без имени'),
      email: String(u.email || ''),
      avatar: u.avatar || null,
      role: String(u.role || 'client'),
      requestedRole: String(u.requested_role),
      createdAt: Number(u.created_at || 0)
    }));
    const contactRequests = db.prepare(`
      SELECT r.id, r.user_id, r.name, r.project, r.service, r.budget, r.reference,
             r.contact_method, r.contact_detail, r.created_at, u.email AS user_email
      FROM requests r LEFT JOIN users u ON u.id = r.user_id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1000
    `).all().map(r => ({
      id: Number(r.id), userId: r.user_id == null ? null : Number(r.user_id),
      name: String(r.name || ''), project: String(r.project || ''),
      service: String(r.service || ''), budget: String(r.budget || ''),
      reference: String(r.reference || ''), contactMethod: String(r.contact_method || 'Сайт'),
      contactDetail: String(r.contact_detail || ''), createdAt: Number(r.created_at || 0),
      userEmail: String(r.user_email || '')
    }));
    return res.json({ requests, contactRequests });
  } catch (err) {
    console.error('[admin/requests] Ошибка:', err);
    return res.status(500).json({ error: 'Не удалось загрузить заявки' });
  }
});

app.post('/api/admin/approve', auth, adminOnly, (req, res) => {
  const userId = Number(req.body?.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0)
    return res.status(400).json({ error: 'Некорректный ID пользователя' });
  const target = db.prepare('SELECT id, requested_role FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'Заявка не найдена' });
  if (!['executor', 'manager'].includes(target.requested_role))
    return res.status(400).json({ error: 'У пользователя нет ожидающей заявки' });
  db.prepare('UPDATE users SET role = requested_role, requested_role = NULL WHERE id = ?').run(userId);
  return res.json({ ok: true, userId });
});

app.post('/api/admin/reject', auth, adminOnly, (req, res) => {
  const userId = Number(req.body?.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0)
    return res.status(400).json({ error: 'Некорректный ID пользователя' });
  const target = db.prepare('SELECT id, requested_role FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'Заявка не найдена' });
  if (!target.requested_role)
    return res.status(400).json({ error: 'У пользователя нет ожидающей заявки' });
  db.prepare('UPDATE users SET requested_role = NULL WHERE id = ?').run(userId);
  return res.json({ ok: true, userId });
});

app.post('/api/admin/balance', auth, (req, res) => {
  const isAdmin = req.user?.role === 'admin' || Number(req.user?.is_root) === 1;
  const isRoot = req.user?.role === 'admin' && Number(req.user?.is_root) === 1;
  if (!isAdmin) return res.status(403).json({ error: 'Недостаточно прав' });

  const userId = Number(req.body?.userId);
  const amountRubles = req.body?.amount;
  if (!Number.isSafeInteger(userId) || userId <= 0 ||
      typeof amountRubles !== 'number' || !Number.isFinite(amountRubles) ||
      amountRubles === 0 || Math.abs(amountRubles) > 1_000_000) {
    return res.status(400).json({ error: 'Некорректная сумма или ID пользователя' });
  }

  const amountKopecks = Math.round(amountRubles * 100);
  if (!Number.isSafeInteger(amountKopecks) || amountKopecks === 0) {
    return res.status(400).json({ error: 'Сумма превышает допустимый диапазон' });
  }

  try {
    const adjustBalance = db.transaction(() => {
      const target = db.prepare(
        'SELECT id, role, balance FROM users WHERE id = ?'
      ).get(userId);

      if (!target) {
        const error = new Error('Пользователь не найден');
        error.status = 404;
        throw error;
      }
      if (target.role === 'admin' && !isRoot && userId !== Number(req.user.id)) {
        const error = new Error('Изменять баланс другого администратора может только главный администратор');
        error.status = 403;
        throw error;
      }

      const current = Number(target.balance ?? 0);
      if (!Number.isSafeInteger(current) || current < 0) {
        const error = new Error('Текущий баланс некорректен; требуется проверка БД');
        error.status = 409;
        throw error;
      }

      const nextBig = BigInt(current) + BigInt(amountKopecks);
      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      const sqliteMax = 9223372036854775807n;
      if (nextBig < 0n || nextBig > maxSafe || nextBig > sqliteMax) {
        const error = new Error('Итоговый баланс вне допустимого диапазона');
        error.status = 400;
        throw error;
      }

      const next = Number(nextBig);
      db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(next, userId);
      db.prepare(`
        INSERT INTO transactions (user_id, title, amount, type, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        userId,
        amountKopecks > 0 ? 'Корректировка баланса администратором' : 'Списание администратором',
        Math.abs(amountKopecks),
        amountKopecks > 0 ? 'in' : 'out',
        Date.now()
      );
      return next;
    });

    return res.json({ ok: true, userId, balance: adjustBalance() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[admin/balance] Ошибка:', err);
    return res.status(500).json({ error: 'Не удалось изменить баланс' });
  }
});

/* ==================== ADMIN: withdrawals ==================== */
app.get('/api/admin/withdrawals', auth, adminOnly, (req, res) => {
  const items = db.prepare(`SELECT w.*, u.name AS user_name, u.email AS user_email, u.avatar AS user_avatar,
                                   r.name AS reviewer_name
                            FROM withdrawals w
                            JOIN users u ON u.id = w.user_id
                            LEFT JOIN users r ON r.id = w.reviewed_by
                            ORDER BY w.created_at DESC LIMIT 200`).all();
  res.json({
    withdrawals: items.map(w => ({
      ...withdrawalRow(w),
      // Keep nested user shape expected by the current frontend, plus legacy flat fields.
      user: { id: Number(w.user_id), name: w.user_name || 'Без имени', email: w.user_email || '', avatar: w.user_avatar || null },
      userName: w.user_name,
      userEmail: w.user_email,
      reviewerName: w.reviewer_name,
    })),
  });
});

app.post('/api/admin/withdrawals/:id/approve', auth, adminOnly, (req, res) => {
  const { adminComment } = req.body || {};
  const wd = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!wd) return res.status(404).json({ error: 'Заявка не найдена' });
  if (wd.status !== 'pending') return res.status(400).json({ error: 'Заявка уже обработана' });

  db.prepare(`UPDATE withdrawals SET status = 'approved', admin_comment = ?,
              reviewed_at = ?, reviewed_by = ? WHERE id = ?`)
    .run(adminComment || 'Перевод выполнен', Date.now(), req.user.id, wd.id);

  const updated = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(wd.id);
  res.json({ withdrawal: withdrawalRow(updated) });
});

app.post('/api/admin/withdrawals/:id/reject', auth, adminOnly, (req, res) => {
  const { adminComment } = req.body || {};
  const wd = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!wd) return res.status(404).json({ error: 'Заявка не найдена' });
  if (wd.status !== 'pending') return res.status(400).json({ error: 'Заявка уже обработана' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(wd.amount, wd.user_id);
    db.prepare(`INSERT INTO transactions (user_id, title, amount, type, created_at)
                VALUES (?, 'Возврат по заявке на вывод', ?, 'in', ?)`).run(wd.user_id, wd.amount, Date.now());
    db.prepare(`UPDATE withdrawals SET status = 'rejected', admin_comment = ?,
                reviewed_at = ?, reviewed_by = ? WHERE id = ?`)
      .run(adminComment || 'Отклонено', Date.now(), req.user.id, wd.id);
  });
  tx();

  const updated = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(wd.id);
  res.json({ withdrawal: withdrawalRow(updated) });
});

/* ==================== ROLE ==================== */
app.post('/api/role/request', auth, (req, res) => {
  const { role } = req.body || {};
  if (!['executor', 'manager'].includes(role))
    return res.status(400).json({ error: 'Некорректная роль' });
  if (req.user.role === 'admin') return res.status(400).json({ error: 'Админ не меняет роль' });
  if (req.user.role === role) return res.status(400).json({ error: 'Эта роль уже ваша' });

  db.prepare('UPDATE users SET requested_role = ? WHERE id = ?').run(role, req.user.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(u) });
});

/* ==================== PROJECTS ==================== */
app.get('/api/projects', auth, (req, res) => {
  try {
    const role = req.user?.role;
    const userId = Number(req.user?.id);
    let where = '';
    let params = [];

    // Клиенты видят только собственные заказы.
    if (role === 'client') {
      where = 'WHERE p.client_id = ?';
      params = [userId];
    } else if (role === 'executor') {
      // Исполнители видят открытые заказы и заказы, уже назначенные им.
      where = "WHERE (p.status = 'open' AND p.executor_id IS NULL) OR p.executor_id = ?";
      params = [userId];
    } else if (role !== 'admin' && role !== 'manager') {
      return res.status(403).json({ error: 'Нет доступа к заказам' });
    }

    const rows = db.prepare(`SELECT p.*,
                                    u.name AS client_name, u.avatar AS client_avatar,
                                    e.name AS executor_name, e.avatar AS executor_avatar
                             FROM projects p
                             LEFT JOIN users u ON u.id = p.client_id
                             LEFT JOIN users e ON e.id = p.executor_id
                             ${where}
                             ORDER BY p.created_at DESC LIMIT 100`).all(...params);
    const projects = rows.map(p => ({
      ...p,
      clientId: p.client_id ?? null,
      executorId: p.executor_id ?? null,
      client: { id: p.client_id ?? 0, name: p.client_name || 'Пользователь', avatar: p.client_avatar ?? null },
      executor: p.executor_id ? {
        id: p.executor_id, name: p.executor_name || 'Исполнитель', avatar: p.executor_avatar ?? null,
      } : null,
    }));
    res.json({ projects });
  } catch (err) {
    console.error('❌ Ошибка загрузки заказов:', err);
    res.status(500).json({ error: 'Не удалось загрузить заказы' });
  }
});

app.post('/api/projects', auth, (req, res) => {
  const { title, description, category, budget } = req.body || {};
  if (!title || !description || !category)
    return res.status(400).json({ error: 'Заполните поля' });
  const now = Date.now();
  const info = db.prepare(`INSERT INTO projects
    (title, description, category, budget, status, client_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`)
    .run(title, description, category, Math.round(Number(budget) * 100) || 0, req.user.id, now, now);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
  res.json({ project });
});

/* ==================== PORTFOLIO ==================== */

// Authorize before Multer writes an uploaded file.
function portfolioUploadAccess(req, res, next) {
  const user = req.user;
  if (user.role === 'executor' || user.role === 'admin' || Number(user.is_root) === 1) {
    return next();
  }
  return res.status(403).json({ error: 'Нет прав для загрузки работ в портфолио' });
}

app.post('/api/portfolio', auth, portfolioUploadAccess, upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    const { title, description, category } = req.body || {};
    const cleanTitle = String(title || '').trim();
    const cleanDescription = String(description || '').trim();
    const cleanCategory = String(category || 'Другое').trim();

    const removeUploadedFile = () => {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
    };

    if (!cleanTitle) {
      removeUploadedFile();
      return res.status(400).json({ error: 'Укажите название работы' });
    }
    if (cleanTitle.length > 120) {
      removeUploadedFile();
      return res.status(400).json({ error: 'Название не должно превышать 120 символов' });
    }
    if (cleanDescription.length > 500) {
      removeUploadedFile();
      return res.status(400).json({ error: 'Описание не должно превышать 500 символов' });
    }

    const user = req.user;
    let authorUserId = null;
    let authorName = '';

    if (user.role === 'executor') {
      // Never trust author fields submitted by an executor.
      authorUserId = user.id;
      authorName = user.name;
    } else {
      const rawAuthorUserId = String(req.body.authorUserId || '').trim();

      if (rawAuthorUserId) {
        const parsedId = Number(rawAuthorUserId);
        if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
          removeUploadedFile();
          return res.status(400).json({ error: 'Некорректный пользователь' });
        }

        const author = db.prepare('SELECT id, name FROM users WHERE id = ?').get(parsedId);
        if (!author) {
          removeUploadedFile();
          return res.status(400).json({ error: 'Выбранный пользователь не найден' });
        }

        authorUserId = author.id;
        authorName = author.name;
      } else {
        authorName = String(req.body.authorName || '').trim();
        if (!authorName) {
          removeUploadedFile();
          return res.status(400).json({ error: 'Укажите имя автора' });
        }
        if (authorName.length > 100) {
          removeUploadedFile();
          return res.status(400).json({ error: 'Имя автора слишком длинное' });
        }
      }
    }

    const result = db.prepare(`
      INSERT INTO portfolio (
        user_id, author_user_id, author_name, filename,
        title, description, category, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id, authorUserId, authorName, req.file.filename,
      cleanTitle, cleanDescription, cleanCategory, Date.now()
    );

    return res.status(201).json({
      ok: true,
      id: Number(result.lastInsertRowid),
      filename: req.file.filename,
      url: '/uploads/portfolio/' + encodeURIComponent(req.file.filename),
      authorName
    });
  } catch (err) {
    console.error('Ошибка загрузки портфолио:', err);
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return res.status(500).json({ error: 'Не удалось сохранить работу' });
  }
});

app.get('/api/portfolio/all', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        p.id, p.filename, p.title, p.description, p.category,
        p.created_at AS createdAt, p.author_user_id AS authorUserId,
        COALESCE(
          NULLIF(TRIM(u.name), ''),
          NULLIF(TRIM(p.author_name), ''),
          NULLIF(TRIM(uploader.name), ''),
          'Аноним'
        ) AS authorName,
        u.avatar AS authorAvatar
      FROM portfolio p
      LEFT JOIN users u ON u.id = p.author_user_id
      LEFT JOIN users uploader ON uploader.id = p.user_id
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 200
    `).all();

    const items = rows.map(row => ({
      ...row,
      filename: row.filename
        ? (row.filename.startsWith('/uploads/')
            ? row.filename
            : '/uploads/portfolio/' + encodeURIComponent(row.filename))
        : null,
      authorName: row.authorName || 'Аноним',
      authorAvatar: row.authorAvatar || null
    }));

    return res.json({ items });
  } catch (err) {
    console.error('Ошибка загрузки публичного портфолио:', err);
    return res.status(500).json({ error: 'Не удалось загрузить портфолио' });
  }
});

app.get('/api/portfolio/me', auth, (req, res) => {
  try {
    const userId = req.user.id;
    const rows = db.prepare(`
      SELECT p.id, p.filename, p.title, p.description, p.category,
             p.created_at AS createdAt, p.author_name AS authorName,
             p.author_user_id AS authorUserId
      FROM portfolio p
      WHERE p.author_user_id = ? OR p.user_id = ?
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 200
    `).all(userId, userId);

    const items = rows.map(row => ({
      ...row,
      filename: row.filename
        ? (row.filename.startsWith('/uploads/')
            ? row.filename
            : '/uploads/portfolio/' + encodeURIComponent(row.filename))
        : null
    }));

    return res.json({ items });
  } catch (err) {
    console.error('Ошибка загрузки личного портфолио:', err);
    return res.status(500).json({ error: 'Не удалось загрузить ваши работы' });
  }
});

// Public profile endpoint exposes only fields intended for visitors.
app.get('/api/users/:id/public', (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Некорректный ID пользователя' });
  try {
    const user = db.prepare('SELECT id, name, avatar, bio, created_at AS createdAt FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    const rows = db.prepare('SELECT id, filename, title, description, category, created_at AS createdAt FROM portfolio WHERE author_user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').all(userId);
    const items = rows.map(row => ({ ...row, filename: row.filename ? (row.filename.startsWith('/uploads/') ? row.filename : '/uploads/portfolio/' + encodeURIComponent(row.filename)) : null }));
    return res.json({ user: { id: user.id, name: user.name, avatar: user.avatar || null, bio: user.bio || '', createdAt: user.createdAt }, items });
  } catch (err) {
    console.error('Ошибка загрузки публичного профиля:', err);
    return res.status(500).json({ error: 'Не удалось загрузить профиль' });
  }
});

app.get('/api/users/list', auth, (req, res) => {
  if (req.user.role !== 'admin' && Number(req.user.is_root) !== 1) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }

  try {
    const users = db.prepare(`
      SELECT id, name, avatar
      FROM users
      ORDER BY name COLLATE NOCASE ASC
      LIMIT 1000
    `).all();
    return res.json({ users });
  } catch (err) {
    console.error('Ошибка списка пользователей:', err);
    return res.status(500).json({ error: 'Не удалось загрузить список пользователей' });
  }
});

// Keep portfolio deletion limited to the uploader or an administrator.
app.delete('/api/portfolio/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Некорректный ID работы' });
  }

  const item = db.prepare('SELECT id, user_id FROM portfolio WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'Работа не найдена' });

  const isAdmin = req.user.role === 'admin' || Number(req.user.is_root) === 1;
  const isUploader = item.user_id === req.user.id;
  const author = db.prepare('SELECT author_user_id FROM portfolio WHERE id = ?').get(id);
  const isAuthor = author?.author_user_id === req.user.id;
  if (!isAdmin && !isUploader && !isAuthor) {
    return res.status(403).json({ error: 'Нет прав удалить эту работу' });
  }

  try {
    db.prepare('DELETE FROM portfolio WHERE id = ?').run(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка удаления работы:', err);
    return res.status(500).json({ error: 'Не удалось удалить работу' });
  }
});

app.get('/api/portfolio', (req, res) => {
  const userId = req.query.userId ? parseInt(req.query.userId, 10) : null;
  const items = userId
    ? db.prepare('SELECT * FROM portfolio WHERE user_id = ? ORDER BY created_at DESC').all(userId)
    : db.prepare('SELECT * FROM portfolio ORDER BY created_at DESC LIMIT 100').all();
  res.json({ portfolio: items });
});

/* ==================== CHATS ==================== */
io.on('connection', (socket) => {
  socket.on('chat:join', ({ chatId }) => {
    if (chatId) socket.join('chat:' + chatId);
  });
  socket.on('chat:message', ({ chatId, senderId, text }) => {
    if (!chatId || !senderId || !text) return;
    const now = Date.now();
    const info = db.prepare(`INSERT INTO messages (chat_id, sender_id, text, created_at)
                             VALUES (?, ?, ?, ?)`).run(chatId, senderId, String(text).slice(0, 2000), now);
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
    io.to('chat:' + chatId).emit('chat:message', msg);
  });
});

// Explicit 404 handlers for unknown API endpoints and page URLs.
app.use('/api', (req, res) => res.status(404).json({ error: 'API_ENDPOINT_NOT_FOUND', message: 'Такой API-маршрут не существует.' }));
app.use((req, res) => {
  res.status(404).type('html').send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Страница не найдена — Paw Art Studio</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0810;color:#f8effa;font:16px system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}.box{max-width:520px}.code{font-size:clamp(4rem,15vw,7rem);font-weight:800;line-height:1;color:#ec4899}p{color:#c4b5c5;line-height:1.6}a{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:12px;background:#ec4899;color:white;text-decoration:none;font-weight:700}</style></head><body><main class="box"><div class="code">404</div><h1>Такой страницы нет</h1><p>Возможно, ссылка устарела или адрес введён с ошибкой. Вернитесь на главную и продолжите знакомство с Paw Art Studio.</p><a href="/">На главную</a></main></body></html>`);
});

/* ==================== SERVER ==================== */
server.listen(PORT, HOST, () => {
  console.log(`🚀 Paw Art Studio запущен на http://${HOST}:${PORT}`);
  console.log(`🌐 Сайт: ${SITE_URL}`);
});

process.on('SIGTERM', () => { db.close(); server.close(() => process.exit(0)); });
