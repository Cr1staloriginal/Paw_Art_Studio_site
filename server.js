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
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i.test(file.mimetype)),
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
safeAddColumn('users', 'referral_code', 'TEXT');
safeAddColumn('users', 'referred_by', 'INTEGER');

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
  support_email: 'support@pawartstudio.store',
  support_telegram: '',
};
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
        VALUES (?, ?, ?, 'client', 50000, 0, ?, ?, ?, ?, ?)`)
        .run(String(name).trim(), cleanEmail, hash, code, expires, myRefCode, referrer ? referrer.id : null, now);
      db.prepare(`INSERT INTO transactions (user_id, title, amount, type, created_at)
                  VALUES (?, 'Бонус новичка', 50000, 'in', ?)`)
        .run(info.lastInsertRowid, now);
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
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Укажите email и код' });

  const cleanEmail = String(email).trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.email_verified === 1) return res.status(400).json({ error: 'Email уже подтверждён' });
  if (!user.verification_code || user.verification_code !== String(code).trim())
    return res.status(400).json({ error: 'Неверный код' });
  if (user.verification_expires && Date.now() > user.verification_expires)
    return res.status(400).json({ error: 'Код истёк. Запросите новый.' });

  db.prepare('UPDATE users SET email_verified = 1, verification_code = NULL, verification_expires = NULL WHERE id = ?')
    .run(user.id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const token = jwt.sign({ id: updated.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: publicUser(updated) });
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

app.post('/api/admin/content', auth, rootOnly, (req, res) => {
  const updates = req.body?.updates;
  if (!updates || typeof updates !== 'object')
    return res.status(400).json({ error: 'Нет данных' });
  const now = Date.now();
  const stmt = db.prepare(`INSERT INTO site_content (key, value, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  try {
    const tx = db.transaction(items => {
      for (const [k, v] of Object.entries(items)) stmt.run(k, String(v ?? ''), now);
    });
    tx(updates);
    res.json({ ok: true, count: Object.keys(updates).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/content/upload', auth, rootOnly, contentUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  res.json({ url: '/uploads/content/' + req.file.filename });
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
    });

    db.prepare(`INSERT INTO payments (user_id, payment_id, amount, status, created_at)
                VALUES (?, ?, ?, 'pending', ?)`)
      .run(req.user.id, payment.id, kopecks, Date.now());

    res.json({ paymentId: payment.id, confirmationUrl: payment.confirmation.confirmation_url });
  } catch (err) {
    console.error('❌ ЮKassa ошибка:', err);
    res.status(500).json({ error: 'Не удалось создать платёж: ' + (err.message || 'неизвестно') });
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

/* ==================== ADMIN: withdrawals ==================== */
app.get('/api/admin/withdrawals', auth, adminOnly, (req, res) => {
  const items = db.prepare(`SELECT w.*, u.name AS user_name, u.email AS user_email,
                                   r.name AS reviewer_name
                            FROM withdrawals w
                            JOIN users u ON u.id = w.user_id
                            LEFT JOIN users r ON r.id = w.reviewed_by
                            ORDER BY w.created_at DESC LIMIT 200`).all();
  res.json({
    withdrawals: items.map(w => ({
      ...withdrawalRow(w),
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
app.get('/api/projects', (req, res) => {
  const items = db.prepare(`SELECT p.*, u.name AS client_name, u.avatar AS client_avatar
                            FROM projects p JOIN users u ON u.id = p.client_id
                            ORDER BY p.created_at DESC LIMIT 100`).all();
  res.json({ projects: items });
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
app.post('/api/portfolio', auth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const { title, description, category } = req.body || {};
  const info = db.prepare(`INSERT INTO portfolio (user_id, filename, title, description, category, created_at)
                           VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, req.file.filename, title || 'Без названия', description || '', category || 'other', Date.now());
  res.json({ id: info.lastInsertRowid, url: '/uploads/portfolio/' + req.file.filename });
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

/* ==================== SERVER ==================== */
server.listen(PORT, HOST, () => {
  console.log(`🚀 Paw Art Studio запущен на http://${HOST}:${PORT}`);
  console.log(`🌐 Сайт: ${SITE_URL}`);
});

process.on('SIGTERM', () => { db.close(); server.close(() => process.exit(0)); });
