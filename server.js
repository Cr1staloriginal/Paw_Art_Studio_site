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
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|gif|webp|avif)$/i.test(file.mimetype)),
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

  CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,description TEXT DEFAULT '',discord_url TEXT DEFAULT '',
    logo_url TEXT DEFAULT '',owner_name TEXT DEFAULT '',contact_email TEXT DEFAULT '',referral_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    discount_percent INTEGER NOT NULL DEFAULT 0,reward_percent REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS partner_contests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,partner_id INTEGER NOT NULL,title TEXT NOT NULL,description TEXT DEFAULT '',
    prize TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',created_at INTEGER NOT NULL,
    FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS partner_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,partner_id INTEGER NOT NULL,project_id INTEGER NOT NULL UNIQUE,user_id INTEGER,
    order_amount INTEGER NOT NULL,reward_amount INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,reviewed_at INTEGER,reviewed_by INTEGER,
    FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE CASCADE,FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS partner_payout_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,partner_id INTEGER NOT NULL,amount INTEGER NOT NULL,payment_details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',comment TEXT DEFAULT '',created_at INTEGER NOT NULL,reviewed_at INTEGER,reviewed_by INTEGER,
    FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS partner_ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,partner_id INTEGER NOT NULL,title TEXT NOT NULL,description TEXT DEFAULT '',
    target_url TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,
    FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS partner_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,partner_id INTEGER NOT NULL,ip_hash TEXT,user_agent TEXT,created_at INTEGER NOT NULL,
    FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS partner_balance_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,partner_id INTEGER NOT NULL,project_id INTEGER,amount INTEGER NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,created_by INTEGER,
    FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_adjustment_project ON partner_balance_adjustments(project_id) WHERE project_id IS NOT NULL;
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
safeAddColumn('users', 'partner_id', 'INTEGER');
safeAddColumn('promocodes', 'partner_id', 'INTEGER');
safeAddColumn('projects', 'partner_paid_at', 'INTEGER');
safeAddColumn('projects', 'partner_payment_reference', 'TEXT');
safeAddColumn('projects', 'base_budget', 'INTEGER NOT NULL DEFAULT 0');
safeAddColumn('projects', 'discount_percent', 'INTEGER NOT NULL DEFAULT 0');
safeAddColumn('projects', 'promo_code', 'TEXT');
safeAddColumn('projects', 'partner_id', 'INTEGER');
safeAddColumn('projects', 'payment_status', "TEXT NOT NULL DEFAULT 'unpaid'");
safeAddColumn('partner_ledger', 'payment_verified_at', 'INTEGER');
safeAddColumn('partner_ledger', 'payment_reference', 'TEXT');
safeAddColumn('partner_ledger', 'paid_amount', 'INTEGER NOT NULL DEFAULT 0');
safeAddColumn('payments', 'project_id', 'INTEGER');
safeAddColumn('payments', 'purpose', "TEXT NOT NULL DEFAULT 'wallet_topup'");
safeAddColumn('partners', 'partner_user_id', 'INTEGER');
safeAddColumn('partners', 'payout_minimum', 'INTEGER NOT NULL DEFAULT 100');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_user_id ON partners(partner_user_id) WHERE partner_user_id IS NOT NULL');
const PARTNER_ATTRIBUTION_DAYS = Math.max(1, Math.min(365, Number(process.env.PARTNER_ATTRIBUTION_DAYS) || 30));
safeAddColumn('requests', 'promo_code', 'TEXT');
safeAddColumn('requests', 'discount_percent', 'INTEGER NOT NULL DEFAULT 0');
safeAddColumn('requests', 'partner_id', 'INTEGER');
db.exec('CREATE INDEX IF NOT EXISTS idx_users_partner_id ON users(partner_id)');

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

function siteEditorOnly(req, res, next) {
  if (!['admin', 'manager'].includes(req.user?.role))
    return res.status(403).json({ error: 'Доступно редакторам сайта и администраторам' });
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
  let code;
  do { code='PAW'+Math.random().toString(36).slice(2,8).toUpperCase(); }
  while(db.prepare('SELECT 1 FROM users WHERE referral_code=?').get(code)||db.prepare('SELECT 1 FROM partners WHERE referral_code=?').get(code));
  return code;
}

function ensurePartnerLedgerForCompletedProject(projectId, now = Date.now()) {
  const project = db.prepare("SELECT id,client_id,budget,partner_id,status,payment_status,partner_paid_at,partner_payment_reference FROM projects WHERE id=?").get(projectId);
  if (!project || project.status !== 'completed' || !project.partner_id || Number(project.budget) <= 0) return false;
  const partner = db.prepare('SELECT id,reward_percent FROM partners WHERE id=?').get(project.partner_id);
  if (!partner || Number(partner.reward_percent) <= 0) return false;
  const reward = Math.floor(Number(project.budget) * Number(partner.reward_percent) / 100);
  if (reward <= 0) return false;
  const paid=project.payment_status==='paid';
  const result = db.prepare("INSERT OR IGNORE INTO partner_ledger(partner_id,project_id,user_id,order_amount,reward_amount,status,created_at,payment_verified_at,payment_reference) VALUES(?,?,?,?,?,'pending',?,?,?)")
    .run(partner.id,project.id,project.client_id,project.budget,reward,now,paid?(project.partner_paid_at||now):null,paid?(project.partner_payment_reference||''):null);
  return result.changes > 0;
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
  let referredPartner = null;
  if (ref) {
    const referralCode = String(ref).trim().toUpperCase();
    referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(referralCode);
  }
  if (req.body?.partnerToken) {
    try {
      const claim = jwt.verify(String(req.body.partnerToken), JWT_SECRET);
      if (claim.type === 'partner_referral' && claim.code) referredPartner = db.prepare("SELECT id FROM partners WHERE referral_code = ? AND status = 'active'").get(String(claim.code).toUpperCase());
    } catch { /* expired or invalid partner attribution is ignored */ }
  }

  const code = generateCode();
  const expires = Date.now() + 15 * 60 * 1000;

  try {
    const hash = bcrypt.hashSync(String(password), 10);
    const now = Date.now();

    const tx = db.transaction(() => {
      if (existing && existing.email_verified === 0) {
        db.prepare(`UPDATE users SET name = ?, password = ?, verification_code = ?, verification_expires = ?, partner_id = COALESCE(partner_id, ?)
                    WHERE id = ?`)
          .run(String(name).trim(), hash, code, expires, referredPartner ? referredPartner.id : null, existing.id);
        return existing.id;
      }
      const myRefCode = generateReferralCode();
      const info = db.prepare(`INSERT INTO users
        (name, email, password, role, balance, email_verified, verification_code, verification_expires, referral_code, referred_by, partner_id, created_at)
        VALUES (?, ?, ?, 'client', 0, 0, ?, ?, ?, ?, ?, ?)`)
        .run(String(name).trim(), cleanEmail, hash, code, expires, myRefCode, referrer ? referrer.id : null, referredPartner ? referredPartner.id : null, now);
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
  ...Array.from({ length: 6 }, (_, i) => i + 1).flatMap(n => [
    `service_${n}_name`, `service_${n}_desc`, `service_${n}_price`, `service_${n}_unit_price`, `service_${n}_min_qty`, `service_${n}_max_qty`, `service_${n}_image`
  ]),
  ...Array.from({ length: 5 }, (_, i) => i + 1).flatMap(n => [
    `pricing_${n}_name`, `pricing_${n}_price`, `pricing_${n}_features`,
    `faq_${n}_q`, `faq_${n}_a`
  ]),
  ...[
    'package_ds_avatar_price', 'package_ds_banner_price', 'package_ds_sticker_price',
    'package_ds_mascot_price', 'package_ds_roles_price', 'package_ds_boost_price',
    'package_streamer_model2d_price', 'package_streamer_emoji_price',
    'package_streamer_art_price', 'package_streamer_overlay_price',
    'package_brand_brand_mascot_price', 'package_brand_brand_sticker_price',
    'package_brand_brand_overlay_price', 'package_full_full_mascot_price',
    'package_full_full_sticker_price', 'package_full_full_overlay_price',
    'package_full_full_banner_price', 'package_full_full_animation_price',
    'package_offer_1_price', 'package_offer_2_price'
  ]
]);

app.post('/api/admin/content', auth, siteEditorOnly, (req, res) => {
  const updates = req.body?.updates;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates))
    return res.status(400).json({ error: 'Ожидается объект updates' });
  const entries = Object.entries(updates);
  if (!entries.length) return res.status(400).json({ error: 'Нет полей для сохранения' });
  if (entries.length > 250) return res.status(400).json({ error: 'Слишком много полей' });
  for (const [key, value] of entries) {
    if (!CONTENT_KEY_ALLOWLIST.has(key))
      return res.status(400).json({ error: `Недопустимый ключ: ${key}` });
    if (value !== null && value !== undefined && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
      return res.status(400).json({ error: `Недопустимое значение для ${key}` });
    if (String(value ?? '').length > 20000)
      return res.status(400).json({ error: `Поле ${key} слишком длинное` });
    // Текстовые ориентиры пакетов (например, «10 000–12 000 ₽») не являются
    // числовыми ценами элементов пакета.
    const isPackageItemPrice = key.startsWith('package_') &&
      key.endsWith('_price') && !/^package_offer_\d+_price$/.test(key);
    const isServiceUnitPrice = /^service_\d+_unit_price$/.test(key);
    const isServiceQuantity = /^service_\d+_(?:min_qty|max_qty)$/.test(key);
    if (isPackageItemPrice || isServiceUnitPrice || isServiceQuantity) {
      const rawValue = String(value ?? '').trim();
      if (isServiceUnitPrice && rawValue === '') continue;
      const normalized = rawValue.replace(',', '.');
      const number = Number(normalized);
      if (!/^\d+(?:\.\d{1,2})?$/.test(normalized) ||
          !Number.isFinite(number) || number < 0 ||
          number > (isServiceQuantity ? 100000 : 10000000) ||
          (isServiceQuantity && !Number.isInteger(number))) {
        return res.status(400).json({ error: `Поле ${key} содержит некорректное значение` });
      }
    }
  }

  for (let i = 1; i <= 6; i++) {
    const minKey = `service_${i}_min_qty`;
    const maxKey = `service_${i}_max_qty`;
    const minRow = db.prepare('SELECT value FROM site_content WHERE key = ?').get(minKey);
    const maxRow = db.prepare('SELECT value FROM site_content WHERE key = ?').get(maxKey);
    const min = Number(Object.prototype.hasOwnProperty.call(updates, minKey) ? updates[minKey] : (minRow?.value ?? 1));
    const max = Number(Object.prototype.hasOwnProperty.call(updates, maxKey) ? updates[maxKey] : (maxRow?.value ?? 1));
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > 100000) {
      return res.status(400).json({ error: `Для услуги ${i}: максимум должен быть целым числом и не меньше минимума` });
    }
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

app.post('/api/admin/content/upload', auth, siteEditorOnly, (req, res, next) => {
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
app.post('/api/projects/:id/pay',auth,async(req,res)=>{
 const id=Number(req.params.id);
 if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:'Некорректный ID заказа'});
 if(!yookassa)return res.status(503).json({error:'ЮKassa не настроена. Оплата заказа пока недоступна.'});
 const project=db.prepare('SELECT id,client_id,budget,status,payment_status FROM projects WHERE id=?').get(id);
 if(!project)return res.status(404).json({error:'Заказ не найден'});
 if(Number(project.client_id)!==Number(req.user.id))return res.status(403).json({error:'Оплатить заказ может только его заказчик'});
 if(project.status==='cancelled'||project.payment_status==='refunded'||project.payment_status==='refund_required')return res.status(409).json({error:'Этот заказ нельзя оплатить: он отменён или ожидает возврата'});
 if(project.payment_status==='paid')return res.status(409).json({error:'Заказ уже оплачен'});
 const amount=Number(project.budget);
 if(!Number.isSafeInteger(amount)||amount<100)return res.status(400).json({error:'У заказа не указана корректная сумма (минимум 1 ₽)'});
 const pending=db.prepare("SELECT id FROM payments WHERE project_id=? AND purpose='project' AND status='pending' ORDER BY created_at DESC LIMIT 1").get(id);
 if(pending)return res.status(409).json({error:'Для этого заказа уже создан платёж. Завершите оплату или дождитесь отмены платежа.'});
 try{
  const payment=await yookassa.payments.create({
   amount:{value:(amount/100).toFixed(2),currency:'RUB'},capture:true,
   confirmation:{type:'redirect',return_url:SITE_URL+'/dashboard?projectPayment=success&projectId='+id},
   description:'Оплата заказа Paw Art Studio #'+id,
   metadata:{userId:String(req.user.id),projectId:String(id),paymentType:'project'}
  },crypto.randomUUID());
  db.prepare("INSERT INTO payments(user_id,payment_id,amount,status,created_at,project_id,purpose) VALUES(?,?,?,'pending',?,?,'project')").run(req.user.id,payment.id,amount,Date.now(),id);
  db.prepare("UPDATE projects SET payment_status='pending' WHERE id=?").run(id);
  res.json({paymentId:payment.id,confirmationUrl:payment.confirmation.confirmation_url});
 }catch(err){
  console.error('❌ ЮKassa: создание оплаты заказа отклонено',{message:String(err?.description||err?.message||'unknown'),code:err?.code||null});
  res.status(502).json({error:'Не удалось создать платёж за заказ через ЮKassa. Попробуйте позже.'});
 }
});

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

app.post('/api/payments/webhook', async (req, res) => {
  const { event, object } = req.body || {};
  if (!['payment.succeeded','payment.canceled'].includes(event) || !object?.id) return res.status(200).send('OK');

  // Never trust the webhook payload alone: fetch the payment from YooKassa.
  // Unknown payments, mismatched users and mismatched amounts are ignored.
  try {
    if (!process.env.YOOKASSA_SHOP_ID || !process.env.YOOKASSA_SECRET_KEY) {
      console.error('❌ YooKassa webhook ignored: credentials are not configured');
      return res.status(503).send('Payment verification unavailable');
    }

    const authHeader = 'Basic ' + Buffer.from(
      process.env.YOOKASSA_SHOP_ID + ':' + process.env.YOOKASSA_SECRET_KEY
    ).toString('base64');
    const verifyResponse = await fetch(
      'https://api.yookassa.ru/v3/payments/' + encodeURIComponent(String(object.id)),
      { headers: { Authorization: authHeader, Accept: 'application/json' } }
    );
    if (!verifyResponse.ok) {
      console.warn('⚠️ YooKassa webhook: payment verification failed', verifyResponse.status);
      return res.status(502).send('Payment verification failed');
    }

    const verified = await verifyResponse.json();
    if(event==='payment.canceled'&&verified.status==='canceled'){
      const canceled=db.transaction(()=>{
        const row=db.prepare('SELECT id,project_id,purpose,status FROM payments WHERE payment_id=?').get(String(verified.id));
        if(!row||row.status!=='pending')return false;
        db.prepare("UPDATE payments SET status='canceled' WHERE id=?").run(row.id);
        if(row.purpose==='project'&&row.project_id)db.prepare("UPDATE projects SET payment_status='unpaid' WHERE id=? AND payment_status='pending'").run(row.project_id);
        return true;
      })();
      if(canceled)console.log('ℹ️ Платёж отменён в ЮKassa:',String(verified.id));
      return res.status(200).send('OK');
    }
    if (verified.status !== 'succeeded' || verified.paid !== true) {
      console.warn('⚠️ YooKassa webhook ignored: payment is not succeeded');
      return res.status(200).send('OK');
    }

    const userId = Number(verified.metadata?.userId);
    const amount = Math.round(Number(verified.amount?.value) * 100);
    if (!Number.isSafeInteger(userId) || userId <= 0 ||
        !Number.isSafeInteger(amount) || amount <= 0) {
      console.warn('⚠️ YooKassa webhook ignored: invalid verified metadata or amount');
      return res.status(200).send('OK');
    }

    const applyPayment = db.transaction(() => {
      const payment = db.prepare(
        'SELECT id,user_id,amount,status,project_id,purpose FROM payments WHERE payment_id=?'
      ).get(String(verified.id));
      if (!payment || Number(payment.user_id)!==userId || Number(payment.amount)!==amount || payment.status==='succeeded') return false;
      const user=db.prepare('SELECT id FROM users WHERE id=?').get(userId);
      if(!user)return false;
      const now=Date.now();
      if(payment.purpose==='project'){
        const projectId=Number(verified.metadata?.projectId);
        if(!projectId||Number(payment.project_id)!==projectId)return false;
        const project=db.prepare('SELECT id,client_id,status FROM projects WHERE id=?').get(projectId);
        if(!project||Number(project.client_id)!==userId)return false;
        db.prepare("UPDATE payments SET status='succeeded' WHERE id=?").run(payment.id);
        if(project.status==='cancelled'){
          db.prepare("UPDATE projects SET payment_status='refund_required',partner_payment_reference=? WHERE id=?").run(String(verified.id),projectId);
          return 'refund_required';
        }
        db.prepare("UPDATE projects SET payment_status='paid',partner_paid_at=?,partner_payment_reference=? WHERE id=?").run(now,String(verified.id),projectId);
        db.prepare("UPDATE partner_ledger SET payment_verified_at=?,payment_reference=? WHERE project_id=? AND status IN ('pending','approved')").run(now,String(verified.id),projectId);
        ensurePartnerLedgerForCompletedProject(projectId,now);
        return 'project';
      }
      db.prepare("UPDATE payments SET status='succeeded' WHERE id=?").run(payment.id);
      db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(amount,userId);
      db.prepare(`INSERT INTO transactions(user_id,title,amount,type,created_at) VALUES(?,'Пополнение через ЮKassa',?,'in',?)`).run(userId,amount,now);
      return 'wallet';
    });

    const applied=applyPayment();
    if(applied==='wallet')console.log(`✅ Проверенное пополнение ЮKassa: ${amount/100} ₽ → #${userId}`);
    else if(applied==='project')console.log(`✅ Заказ #${verified.metadata.projectId} оплачен через ЮKassa`);
    else if(applied==='refund_required')console.warn(`⚠️ Платёж по отменённому заказу #${verified.metadata.projectId} требует возврата`);
    return res.status(200).send('OK');
  } catch (err) {
    console.error('❌ Ошибка проверки webhook YooKassa:', err?.message || err);
    return res.status(500).send('Webhook processing failed');
  }
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
  // A client must never be able to mint balance by posting an arbitrary amount.
  // Real deposits must go through /api/payments/create and a verified YooKassa webhook.
  return res.status(410).json({
    error: 'Прямое пополнение отключено. Используйте защищённую оплату через ЮKassa.'
  });
});

app.post('/api/wallet/withdraw', auth, (req, res) => {
  if (req.user.role !== 'executor')
    return res.status(403).json({ error: 'Вывод средств доступен только исполнителям заказов' });

  const { amount, cardNumber } = req.body || {};
  const numericAmount = Number(amount);
  const k = Math.round(numericAmount * 100);
  if (!Number.isFinite(numericAmount) || !k || k <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
  if (k < 100) return res.status(400).json({ error: 'Минимум 1 ₽' });

  const cleanCard = String(cardNumber || '').replace(/[\s-]/g, '');
  if (!/^\d{16,19}$/.test(cleanCard))
    return res.status(400).json({ error: 'Укажите корректный номер карты (16–19 цифр)' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || user.balance < k) return res.status(400).json({ error: 'Недостаточно средств' });

  // Средства резервируются списанием при создании заявки; отказ вернёт их на баланс.
  const now = Date.now();
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

  const partner = db.prepare("SELECT id FROM partners WHERE referral_code = ? AND status = 'active'").get(code);
  if (partner) {
    const ipHash = crypto.createHash('sha256').update(String(req.ip || '') + ':' + String(process.env.REFERRAL_HASH_SALT || JWT_SECRET)).digest('hex');
    const recentClick=db.prepare('SELECT id FROM partner_clicks WHERE partner_id=? AND ip_hash=? AND created_at>? LIMIT 1').get(partner.id,ipHash,Date.now()-24*60*60*1000);
    if(!recentClick)db.prepare('INSERT INTO partner_clicks (partner_id,ip_hash,user_agent,created_at) VALUES (?,?,?,?)').run(partner.id,ipHash,String(req.headers['user-agent']||'').slice(0,300),Date.now());
    const partnerToken = jwt.sign({ type: 'partner_referral', code }, JWT_SECRET, { expiresIn: PARTNER_ATTRIBUTION_DAYS * 86400 });
    return res.json({ok:true,code,partner:true,partnerToken,attributionDays:PARTNER_ATTRIBUTION_DAYS});
  }
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
      reference: String(b.reference || '').trim(), contactMethod: String(b.contactMethod || 'Сайт').trim(),
      contactDetail: String(b.contactDetail || '').trim(), promoCode: String(b.promoCode || '').trim().toUpperCase()
    };
    if (!v.name || !v.service) return res.status(400).json({ error: 'Укажите имя и услугу' });
    const limits = { name: 100, project: 200, service: 100, budget: 100, reference: 5000, contactDetail: 300, promoCode: 32 };
    for (const [key, max] of Object.entries(limits)) if (v[key].length > max)
      return res.status(400).json({ error: 'Поле превышает допустимую длину: ' + key });
    if (!['Сайт', 'Discord', 'Telegram', 'VK', 'Телефон', 'Email'].includes(v.contactMethod))
      return res.status(400).json({ error: 'Неизвестный способ связи' });
    if (v.contactMethod !== 'Сайт' && !v.contactDetail)
      return res.status(400).json({ error: 'Укажите контакт для связи' });
    const user = optionalRequestUser(req);
    let promo = null;
    if (v.promoCode) {
      if (!user) return res.status(401).json({ error: 'Для применения промокода войдите в аккаунт' });
      promo = db.prepare('SELECT * FROM promocodes WHERE code=?').get(v.promoCode);
      if (!promo || !promo.active) return res.status(400).json({ error: 'Промокод не найден или неактивен' });
      if (promo.partner_id && !db.prepare("SELECT id FROM partners WHERE id=? AND status='active'").get(promo.partner_id)) return res.status(400).json({ error: 'Промокод партнёра временно недоступен' });
      if (promo.expires_at && Date.now() > promo.expires_at) return res.status(400).json({ error: 'Срок действия промокода истёк' });
      if (promo.max_uses && promo.uses >= promo.max_uses) return res.status(400).json({ error: 'Лимит использований промокода исчерпан' });
      if (db.prepare('SELECT id FROM promo_redemptions WHERE promo_id=? AND user_id=?').get(promo.id,user.id))
        return res.status(400).json({ error: 'Вы уже использовали этот промокод' });
      if (!promo.discount) return res.status(400).json({ error: 'Этот промокод не даёт скидку на заявку' });
    }
    const now=Date.now();
    // An inquiry reserves the promo code but does not consume it; redemption happens only when a project order is created.
    const result=db.prepare('INSERT INTO requests(user_id,name,project,service,budget,reference,contact_method,contact_detail,promo_code,discount_percent,partner_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(user?user.id:null,v.name,v.project||null,v.service,v.budget||null,v.reference||null,v.contactMethod,v.contactDetail||null,promo?promo.code:null,promo?promo.discount:0,promo?promo.partner_id:null,now);
    return res.status(201).json({ ok:true,id:Number(result.lastInsertRowid),discountPercent:promo?promo.discount:0,message:promo?'Заявка отправлена с промокодом '+promo.code+' (скидка '+promo.discount+'%)':'Заявка успешно сохранена' });
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
      promoCode: r.promo_code || '', discountPercent: Number(r.discount_percent || 0), partnerId: r.partner_id == null ? null : Number(r.partner_id),
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

  // Подтверждать следует только после фактического ручного перевода денег.
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO transactions (user_id, title, amount, type, created_at)
                VALUES (?, 'Вывод средств', ?, 'out', ?)`).run(wd.user_id, wd.amount, Date.now());
    db.prepare(`UPDATE withdrawals SET status = 'approved', admin_comment = ?,
                reviewed_at = ?, reviewed_by = ? WHERE id = ? AND status = 'pending'`)
      .run(adminComment || 'Перевод выполнен вручную', Date.now(), req.user.id, wd.id);
  });
  tx();

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
  const b=req.body||{},title=String(b.title||'').trim(),description=String(b.description||'').trim(),category=String(b.category||'').trim();
  if(!title||!description||!category)return res.status(400).json({error:'Заполните поля'});
  if(title.length>120||description.length>2000||category.length>80)return res.status(400).json({error:'Превышена допустимая длина полей'});
  const rawBudget=Number(b.budget||0),baseBudget=Math.round(rawBudget*100);
  if(!Number.isFinite(rawBudget)||rawBudget<0||!Number.isSafeInteger(baseBudget)||baseBudget>1000000000)return res.status(400).json({error:'Некорректный бюджет'});
  const promoCode=String(b.promoCode||'').trim().toUpperCase();
  let promo=null;
  if(promoCode){
    if(baseBudget<100)return res.status(400).json({error:'Чтобы применить скидку, укажите бюджет заказа не менее 1 ₽'});
    promo=db.prepare('SELECT * FROM promocodes WHERE code=?').get(promoCode);
    if(!promo||!promo.active)return res.status(400).json({error:'Промокод не найден или неактивен'});
    if(promo.partner_id&&!db.prepare("SELECT id FROM partners WHERE id=? AND status='active'").get(promo.partner_id))return res.status(400).json({error:'Промокод партнёра временно недоступен'});
    if(promo.expires_at&&Date.now()>promo.expires_at)return res.status(400).json({error:'Срок действия промокода истёк'});
    if(promo.max_uses&&promo.uses>=promo.max_uses)return res.status(400).json({error:'Лимит использований промокода исчерпан'});
    if(!promo.discount)return res.status(400).json({error:'Этот промокод не даёт скидку на заказ'});
    if(db.prepare('SELECT id FROM promo_redemptions WHERE promo_id=? AND user_id=?').get(promo.id,req.user.id))return res.status(400).json({error:'Вы уже использовали этот промокод'});
  }
  const discount=promo?Number(promo.discount):0,finalBudget=Math.round(baseBudget*(100-discount)/100);
  const partnerId=promo?.partner_id||req.user.partner_id||null,now=Date.now();
  try{
    const create=db.transaction(()=>{
      if(promo){
        const used=db.prepare('UPDATE promocodes SET uses=uses+1 WHERE id=? AND active=1 AND (max_uses IS NULL OR max_uses=0 OR uses<max_uses) AND (expires_at IS NULL OR expires_at>=?)').run(promo.id,now);
        if(!used.changes)throw new Error('Лимит использований промокода исчерпан или срок его действия закончился');
        db.prepare('INSERT INTO promo_redemptions(promo_id,user_id,created_at) VALUES(?,?,?)').run(promo.id,req.user.id,now);
      }
      const info=db.prepare(`INSERT INTO projects(title,description,category,budget,status,client_id,created_at,updated_at,base_budget,discount_percent,promo_code,partner_id)
        VALUES(?,?,?,?,'open',?,?,?,?,?,?,?)`).run(title,description,category,finalBudget,req.user.id,now,now,baseBudget,discount,promo?promo.code:null,partnerId);
      return Number(info.lastInsertRowid);
    });
    const id=create(),project=db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    res.status(201).json({project,pricing:{baseBudget,discountPercent:discount,finalBudget,saved:baseBudget-finalBudget}});
  }catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'Промокод уже использован'});console.error('[projects:create]',e);res.status(500).json({error:'Не удалось создать заказ'});}
});


/* Project detail/actions used by the client-side project cards. */
app.get('/api/projects/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Некорректный ID заказа' });
  try {
    const p = db.prepare(`SELECT p.*, u.name AS client_name, u.avatar AS client_avatar,
                                e.name AS executor_name, e.avatar AS executor_avatar
                         FROM projects p
                         LEFT JOIN users u ON u.id = p.client_id
                         LEFT JOIN users e ON e.id = p.executor_id
                         WHERE p.id = ?`).get(id);
    if (!p) return res.status(404).json({ error: 'Заказ не найден' });
    const isAdmin = req.user.role === 'admin' || req.user.role === 'manager' || Number(req.user.is_root) === 1;
    const canView = isAdmin || Number(p.client_id) === Number(req.user.id) ||
      (req.user.role === 'executor' && (p.status === 'open' || Number(p.executor_id) === Number(req.user.id)));
    if (!canView) return res.status(403).json({ error: 'Нет доступа к этому заказу' });
    return res.json({ project: {
      ...p, clientId: p.client_id, executorId: p.executor_id,
      client: { id: p.client_id, name: p.client_name || 'Пользователь', avatar: p.client_avatar || null },
      executor: p.executor_id ? { id: p.executor_id, name: p.executor_name || 'Исполнитель', avatar: p.executor_avatar || null } : null
    }});
  } catch (err) {
    console.error('Ошибка загрузки заказа:', err);
    return res.status(500).json({ error: 'Не удалось загрузить заказ' });
  }
});

app.post('/api/projects/:id/accept', auth, (req, res) => {
  if (req.user.role !== 'executor') return res.status(403).json({ error: 'Только исполнитель может взять заказ' });
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Некорректный ID заказа' });
  try {
    const result = db.prepare(`UPDATE projects SET executor_id = ?, status = 'in_progress', updated_at = ?
      WHERE id = ? AND status = 'open' AND executor_id IS NULL`).run(req.user.id, Date.now(), id);
    if (!result.changes) {
      const exists = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
      return res.status(exists ? 409 : 404).json({ error: exists ? 'Заказ уже взят или закрыт' : 'Заказ не найден' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка принятия заказа:', err);
    return res.status(500).json({ error: 'Не удалось взять заказ' });
  }
});

app.post('/api/projects/:id/status', auth, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  const allowed = ['open', 'in_progress', 'review', 'completed', 'cancelled'];
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Некорректный ID заказа' });
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Некорректный статус заказа' });
  try {
    const p = db.prepare('SELECT id, client_id, executor_id FROM projects WHERE id = ?').get(id);
    if (!p) return res.status(404).json({ error: 'Заказ не найден' });
    const isAdmin = req.user.role === 'admin' || req.user.role === 'manager' || Number(req.user.is_root) === 1;
    if (!isAdmin && Number(p.client_id) !== Number(req.user.id) && Number(p.executor_id) !== Number(req.user.id))
      return res.status(403).json({ error: 'Нет доступа к изменению этого заказа' });
    const now=Date.now();
    const finish=db.transaction(()=>{
      db.prepare('UPDATE projects SET status=?,updated_at=? WHERE id=?').run(status,now,id);
      if(status==='cancelled') {
        const ledger=db.prepare('SELECT * FROM partner_ledger WHERE project_id=?').get(id);
        if(ledger&&Number(ledger.paid_amount)>0)db.prepare('INSERT OR IGNORE INTO partner_balance_adjustments(partner_id,project_id,amount,reason,created_at,created_by) VALUES(?,?,?,?,?,?)').run(ledger.partner_id,id,ledger.paid_amount,'Возврат/отмена уже выплаченного партнёрского заказа',now,req.user.id);
        db.prepare("UPDATE partner_ledger SET status=CASE WHEN status='pending' THEN 'rejected' ELSE 'reversed' END,reviewed_at=?,reviewed_by=? WHERE project_id=? AND status IN ('pending','approved','paid')").run(now,req.user.id,id);
        db.prepare("UPDATE projects SET payment_status=CASE WHEN payment_status='paid' THEN 'refund_required' ELSE payment_status END WHERE id=?").run(id);
      }
      if(status==='completed')ensurePartnerLedgerForCompletedProject(id,now);
    });
    finish();
    return res.json({ok:true});
  } catch (err) {
    console.error('Ошибка изменения статуса заказа:', err);
    return res.status(500).json({ error: 'Не удалось изменить статус заказа' });
  }
});

/* ==================== PORTFOLIO ==================== */

// Authorize before Multer writes an uploaded file.
function portfolioUploadAccess(req, res, next) {
  const user = req.user;
  if (user.role === 'executor' || user.role === 'manager' || user.role === 'admin' || Number(user.is_root) === 1) {
    return next();
  }
  return res.status(403).json({ error: 'Нет прав для загрузки работ в портфолио' });
}

function portfolioUploadMiddleware(req, res, next) {
  upload.single('image')(req, res, err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Изображение больше 5 МБ' });
      console.error('Ошибка приёма файла портфолио:', err.message);
      return res.status(400).json({ error: 'Не удалось принять изображение. Используйте PNG, JPG, WEBP, AVIF или GIF до 5 МБ.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Выберите изображение PNG, JPG, WEBP, AVIF или GIF до 5 МБ.' });
    next();
  });
}

app.post('/api/portfolio', auth, portfolioUploadAccess, portfolioUploadMiddleware, (req, res) => {
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
  if (!['admin', 'manager'].includes(req.user.role) && Number(req.user.is_root) !== 1) {
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
  const isSiteEditor = req.user.role === 'manager';
  const isUploader = item.user_id === req.user.id;
  const author = db.prepare('SELECT author_user_id FROM portfolio WHERE id = ?').get(id);
  const isAuthor = author?.author_user_id === req.user.id;
  if (!isAdmin && !isSiteEditor && !isUploader && !isAuthor) {
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


/* Chat API endpoints used by the messenger UI. */
app.get('/api/chats', auth, (req, res) => {
  try {
    const uid = Number(req.user.id);
    const rows = db.prepare(`
      SELECT c.id, c.user_a, c.user_b,
        CASE WHEN c.user_a = ? THEN b.id ELSE a.id END AS peer_id,
        CASE WHEN c.user_a = ? THEN b.name ELSE a.name END AS peer_name,
        CASE WHEN c.user_a = ? THEN b.avatar ELSE a.avatar END AS peer_avatar,
        (SELECT m.text FROM messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_text,
        (SELECT m.created_at FROM messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_created,
        (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.sender_id != ? AND m.read_at IS NULL) AS unread
      FROM chats c
      JOIN users a ON a.id = c.user_a
      JOIN users b ON b.id = c.user_b
      WHERE c.user_a = ? OR c.user_b = ?
      ORDER BY COALESCE(last_created, c.created_at) DESC
    `).all(uid, uid, uid, uid, uid, uid);
    return res.json({ chats: rows.map(r => ({
      id: Number(r.id),
      peer: { id: Number(r.peer_id), name: r.peer_name || 'Пользователь', avatar: r.peer_avatar || null },
      lastMessage: r.last_text == null ? null : { text: r.last_text, createdAt: Number(r.last_created || 0) },
      unread: Number(r.unread || 0)
    })) });
  } catch (err) {
    console.error('Ошибка загрузки чатов:', err);
    return res.status(500).json({ error: 'Не удалось загрузить чаты' });
  }
});

app.post('/api/chats', auth, (req, res) => {
  const uid = Number(req.user.id);
  const peerId = Number(req.body?.peerId);
  if (!Number.isSafeInteger(peerId) || peerId <= 0 || peerId === uid)
    return res.status(400).json({ error: 'Некорректный собеседник' });
  try {
    const peer = db.prepare('SELECT id FROM users WHERE id = ?').get(peerId);
    if (!peer) return res.status(404).json({ error: 'Пользователь не найден' });
    const userA = Math.min(uid, peerId);
    const userB = Math.max(uid, peerId);
    let chat = db.prepare('SELECT id FROM chats WHERE user_a = ? AND user_b = ?').get(userA, userB);
    if (!chat) {
      try {
        const info = db.prepare('INSERT INTO chats (user_a, user_b, created_at) VALUES (?, ?, ?)').run(userA, userB, Date.now());
        chat = { id: Number(info.lastInsertRowid) };
      } catch (err) {
        // Handle simultaneous attempts to create the same conversation.
        chat = db.prepare('SELECT id FROM chats WHERE user_a = ? AND user_b = ?').get(userA, userB);
        if (!chat) throw err;
      }
    }
    return res.json({ chatId: Number(chat.id) });
  } catch (err) {
    console.error('Ошибка создания чата:', err);
    return res.status(500).json({ error: 'Не удалось открыть чат' });
  }
});

app.get('/api/chats/:chatId/messages', auth, (req, res) => {
  const chatId = Number(req.params.chatId);
  if (!Number.isSafeInteger(chatId) || chatId <= 0) return res.status(400).json({ error: 'Некорректный ID чата' });
  try {
    const chat = db.prepare('SELECT user_a, user_b FROM chats WHERE id = ?').get(chatId);
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (![Number(chat.user_a), Number(chat.user_b)].includes(Number(req.user.id)))
      return res.status(403).json({ error: 'Нет доступа к этому чату' });
    db.prepare('UPDATE messages SET read_at = ? WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL')
      .run(Date.now(), chatId, req.user.id);
    const messages = db.prepare(`
      SELECT m.id, m.chat_id AS chatId, m.sender_id AS senderId, m.text, m.created_at AS createdAt, m.read_at AS readAt
      FROM messages m WHERE m.chat_id = ? ORDER BY m.created_at ASC, m.id ASC LIMIT 500
    `).all(chatId).map(m => ({ ...m, id: Number(m.id), chatId: Number(m.chatId), senderId: Number(m.senderId), createdAt: Number(m.createdAt), readAt: m.readAt == null ? null : Number(m.readAt) }));
    return res.json({ messages });
  } catch (err) {
    console.error('Ошибка загрузки сообщений:', err);
    return res.status(500).json({ error: 'Не удалось загрузить сообщения' });
  }
});

/* ==================== CHATS ==================== */
// Authenticate sockets with the same JWT used by the REST API.
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Требуется авторизация'));
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(payload.id);
    if (!user) return next(new Error('Пользователь не найден'));
    socket.data.user = { id: Number(user.id), name: user.name || 'Пользователь' };
    next();
  } catch {
    next(new Error('Сессия истекла. Войдите снова.'));
  }
});

io.on('connection', (socket) => {
  const uid = Number(socket.data.user.id);
  socket.on('chat:join', ({ chatId } = {}) => {
    const id = Number(chatId);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const chat = db.prepare('SELECT user_a, user_b FROM chats WHERE id = ?').get(id);
    if (chat && [Number(chat.user_a), Number(chat.user_b)].includes(uid)) socket.join('chat:' + id);
  });
  socket.on('chat:leave', ({ chatId } = {}) => {
    const id = Number(chatId);
    if (Number.isSafeInteger(id) && id > 0) socket.leave('chat:' + id);
  });
  socket.on('chat:send', ({ chatId, text } = {}) => {
    const id = Number(chatId);
    const cleanText = String(text || '').trim().slice(0, 2000);
    if (!Number.isSafeInteger(id) || id <= 0 || !cleanText) return;
    const chat = db.prepare('SELECT user_a, user_b FROM chats WHERE id = ?').get(id);
    if (!chat || ![Number(chat.user_a), Number(chat.user_b)].includes(uid)) {
      socket.emit('chat:error', { message: 'Нет доступа к этому чату' });
      return;
    }
    try {
      const now = Date.now();
      const info = db.prepare('INSERT INTO messages (chat_id, sender_id, text, created_at) VALUES (?, ?, ?, ?)')
        .run(id, uid, cleanText, now);
      const msg = { id: Number(info.lastInsertRowid), chatId: id, senderId: uid, text: cleanText, createdAt: now, readAt: null };
      io.to('chat:' + id).emit('chat:new', msg);
      io.to('chat:' + id).emit('chat:notify', { chatId: id, message: { senderName: socket.data.user.name, text: cleanText } });
    } catch (err) {
      console.error('Ошибка отправки сообщения:', err);
      socket.emit('chat:error', { message: 'Не удалось отправить сообщение' });
    }
  });
  socket.on('chat:typing', ({ chatId } = {}) => {
    const id = Number(chatId);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const chat = db.prepare('SELECT user_a, user_b FROM chats WHERE id = ?').get(id);
    if (chat && [Number(chat.user_a), Number(chat.user_b)].includes(uid)) socket.to('chat:' + id).emit('chat:typing', { name: socket.data.user.name });
  });
});

/* ==================== PARTNERS ==================== */
function partnerRow(p){return{id:Number(p.id),name:p.name,description:p.description||'',discordUrl:p.discord_url||'',logoUrl:p.logo_url||'',ownerName:p.owner_name||'',contactEmail:p.contact_email||'',partnerUserId:p.partner_user_id==null?null:Number(p.partner_user_id),referralCode:p.referral_code,discountPercent:Number(p.discount_percent||0),rewardPercent:Number(p.reward_percent||0),status:p.status};}
app.get('/api/partners',(req,res)=>{
 const partners=db.prepare("SELECT * FROM partners WHERE status='active' ORDER BY name").all();
 const ads=db.prepare("SELECT a.*,p.referral_code FROM partner_ads a JOIN partners p ON p.id=a.partner_id WHERE a.active=1 AND p.status='active' ORDER BY a.created_at DESC").all();
 const contests=db.prepare("SELECT c.*,p.referral_code FROM partner_contests c JOIN partners p ON p.id=c.partner_id WHERE c.status='active' AND p.status='active' ORDER BY c.created_at DESC").all();
 res.json({partners:partners.map(p=>({
  id:Number(p.id),name:p.name,description:p.description||'',discordUrl:p.discord_url||'',logoUrl:p.logo_url||'',
  referralCode:p.referral_code,discountPercent:Number(p.discount_percent||0),
  ads:ads.filter(a=>a.referral_code===p.referral_code).map(a=>({title:a.title,description:a.description,target_url:a.target_url})),
  contests:contests.filter(c=>c.referral_code===p.referral_code).map(c=>({title:c.title,description:c.description,prize:c.prize}))
 }))});
});
app.get('/api/admin/partners',auth,adminOnly,(req,res)=>{
 const partners=db.prepare("SELECT p.*,(SELECT COUNT(*) FROM partner_clicks c WHERE c.partner_id=p.id) clicks,(SELECT COUNT(*) FROM users u WHERE u.partner_id=p.id) registrations,(SELECT COUNT(*) FROM partner_ledger l WHERE l.partner_id=p.id) orders,(SELECT COALESCE(SUM(reward_amount-paid_amount),0) FROM partner_ledger l WHERE l.partner_id=p.id AND l.status='approved') payable,(SELECT COALESCE(SUM(paid_amount),0) FROM partner_ledger l WHERE l.partner_id=p.id) paid,(SELECT COALESCE(SUM(reward_amount),0) FROM partner_ledger l WHERE l.partner_id=p.id AND l.status='pending') pending,(SELECT COALESCE(SUM(amount),0) FROM partner_balance_adjustments a WHERE a.partner_id=p.id) adjustments,(SELECT COALESCE(SUM(amount),0) FROM partner_payout_requests r WHERE r.partner_id=p.id AND r.status IN ('pending','approved')) reserved FROM partners p ORDER BY p.created_at DESC").all().map(p=>({...partnerRow(p),clicks:Number(p.clicks),registrations:Number(p.registrations),orders:Number(p.orders),payable:Number(p.payable),paid:Number(p.paid),pending:Number(p.pending),adjustments:Number(p.adjustments),available:Number(p.payable)-Number(p.adjustments)-Number(p.reserved)}));
 const promos=db.prepare("SELECT c.*,p.name partner_name FROM promocodes c JOIN partners p ON p.id=c.partner_id ORDER BY c.created_at DESC").all();
 const contests=db.prepare("SELECT c.*,p.name partner_name FROM partner_contests c JOIN partners p ON p.id=c.partner_id ORDER BY c.created_at DESC").all();
 const ads=db.prepare("SELECT a.*,p.name partner_name FROM partner_ads a JOIN partners p ON p.id=a.partner_id ORDER BY a.created_at DESC").all();
 const ledger=db.prepare("SELECT l.*,p.name partner_name,u.name customer_name,pr.payment_status project_payment_status,pr.partner_payment_reference FROM partner_ledger l JOIN partners p ON p.id=l.partner_id JOIN projects pr ON pr.id=l.project_id LEFT JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 100").all();
 const payouts=db.prepare("SELECT r.*,p.name partner_name FROM partner_payout_requests r JOIN partners p ON p.id=r.partner_id ORDER BY r.created_at DESC LIMIT 100").all();
 res.json({partners,promos,contests,ads,ledger,payouts});
});
app.post('/api/admin/partners',auth,adminOnly,(req,res)=>{
 const b=req.body||{},name=String(b.name||'').trim(),code=String(b.referralCode||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'');
 const accountEmail=String(b.accountEmail||'').trim().toLowerCase();
 const linkedUser=accountEmail?db.prepare('SELECT id,email_verified FROM users WHERE email=?').get(accountEmail):null;
 if(accountEmail&&(!linkedUser||linkedUser.email_verified!==1))return res.status(400).json({error:'Аккаунт партнёра не найден или email не подтверждён. Попросите партнёра сначала зарегистрироваться.'});
 const discount=Math.max(0,Math.min(100,Math.round(Number(b.discountPercent)||0))),reward=Math.max(0,Math.min(50,Number(b.rewardPercent)||0)),discord=String(b.discordUrl||'').trim();
 if(!name||name.length>100||!/^[A-Z0-9_-]{3,24}$/.test(code))return res.status(400).json({error:'Проверьте название и код партнёра (3–24 символа)'});
 if(db.prepare('SELECT id FROM users WHERE referral_code=?').get(code))return res.status(409).json({error:'Этот код уже занят личной реферальной системой'});
 if(discord&&!/^https:\/\/(discord\.gg|discord\.com)\//i.test(discord))return res.status(400).json({error:'Некорректная Discord-ссылка'});
 try{const now=Date.now(),r=db.prepare("INSERT INTO partners(name,description,discord_url,logo_url,owner_name,contact_email,referral_code,discount_percent,reward_percent,status,created_at,updated_at,partner_user_id) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?,?)").run(name,String(b.description||'').slice(0,1000),discord,String(b.logoUrl||'').slice(0,500),String(b.ownerName||'').slice(0,100),String(b.contactEmail||'').trim().slice(0,160),code,discount,reward,now,now,linkedUser?.id||null);res.status(201).json({partner:partnerRow(db.prepare('SELECT * FROM partners WHERE id=?').get(r.lastInsertRowid))});}
 catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'Реферальный код уже занят'});console.error(e);res.status(500).json({error:'Не удалось создать партнёра'});}
});
app.patch('/api/admin/partners/:id',auth,adminOnly,(req,res)=>{
 const id=Number(req.params.id),b=req.body||{},p=db.prepare('SELECT * FROM partners WHERE id=?').get(id);if(!p)return res.status(404).json({error:'Партнёр не найден'});
 const status=['active','paused','rejected','pending'].includes(b.status)?b.status:p.status,discount=b.discountPercent===undefined?p.discount_percent:Math.max(0,Math.min(100,Math.round(Number(b.discountPercent)||0))),reward=b.rewardPercent===undefined?p.reward_percent:Math.max(0,Math.min(50,Number(b.rewardPercent)||0));
 let linkedUserId=p.partner_user_id||null;
 if(b.accountEmail!==undefined){const email=String(b.accountEmail||'').trim().toLowerCase();if(email){const u=db.prepare('SELECT id,email_verified FROM users WHERE email=?').get(email);if(!u||u.email_verified!==1)return res.status(400).json({error:'Аккаунт не найден или email не подтверждён'});linkedUserId=u.id;}else linkedUserId=null;}
 db.prepare('UPDATE partners SET status=?,discount_percent=?,reward_percent=?,partner_user_id=?,updated_at=? WHERE id=?').run(status,discount,reward,linkedUserId,Date.now(),id);res.json({ok:true});
});
app.post('/api/admin/partners/:id/promos',auth,adminOnly,(req,res)=>{
 const id=Number(req.params.id),p=db.prepare('SELECT * FROM partners WHERE id=?').get(id),b=req.body||{};if(!p)return res.status(404).json({error:'Партнёр не найден'});
 const code=String(b.code||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,''),discount=Math.max(0,Math.min(100,Math.round(Number(b.discountPercent)||p.discount_percent||0))),bonus=Math.max(0,Math.round(Number(b.bonusRub)||0)*100);
 if(!/^[A-Z0-9_-]{3,32}$/.test(code)||(!discount&&!bonus))return res.status(400).json({error:'Укажите код и скидку или бонус'});
 try{db.prepare('INSERT INTO promocodes(code,bonus,discount,active,created_at,partner_id) VALUES(?,?,?,1,?,?)').run(code,bonus,discount,Date.now(),id);res.status(201).json({ok:true,code});}
 catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'Промокод уже существует'});res.status(500).json({error:'Не удалось создать промокод'});}
});
app.post('/api/admin/partners/:id/contests',auth,adminOnly,(req,res)=>{
 const id=Number(req.params.id),b=req.body||{},title=String(b.title||'').trim();if(!db.prepare('SELECT id FROM partners WHERE id=?').get(id))return res.status(404).json({error:'Партнёр не найден'});
 if(!title||title.length>120)return res.status(400).json({error:'Укажите название конкурса'});
 const r=db.prepare("INSERT INTO partner_contests(partner_id,title,description,prize,status,created_at) VALUES(?,?,?,?,?,?)").run(id,title,String(b.description||'').slice(0,2000),String(b.prize||'').slice(0,300),'active',Date.now());res.status(201).json({ok:true,id:Number(r.lastInsertRowid)});
});
app.post('/api/admin/partners/:id/ads',auth,adminOnly,(req,res)=>{
 const id=Number(req.params.id),b=req.body||{},title=String(b.title||'').trim(),url=String(b.targetUrl||'').trim();if(!db.prepare('SELECT id FROM partners WHERE id=?').get(id))return res.status(404).json({error:'Партнёр не найден'});
 if(!title||title.length>120||!/^https:\/\//i.test(url))return res.status(400).json({error:'Нужны заголовок и HTTPS-ссылка'});
 const r=db.prepare('INSERT INTO partner_ads(partner_id,title,description,target_url,created_at) VALUES(?,?,?,?,?)').run(id,title,String(b.description||'').slice(0,1000),url,Date.now());res.status(201).json({ok:true,id:Number(r.lastInsertRowid)});
});
app.post('/api/admin/projects/:id/confirm-payment',auth,adminOnly,(req,res)=>{
 const projectId=Number(req.params.id),reference=String(req.body?.reference||'').trim();
 if(!Number.isSafeInteger(projectId)||projectId<=0||reference.length<3||reference.length>120)return res.status(400).json({error:'Укажите корректный заказ и подтверждение оплаты'});
 const project=db.prepare('SELECT id,status,payment_status FROM projects WHERE id=?').get(projectId);
 if(!project)return res.status(404).json({error:'Заказ не найден'});
 if(project.status!=='completed')return res.status(409).json({error:'Сначала заказ должен получить статус «Завершён»'});
 if(project.payment_status==='paid')return res.status(409).json({error:'Оплата этого заказа уже подтверждена'});
 const now=Date.now();
 db.transaction(()=>{
  db.prepare("UPDATE projects SET partner_paid_at=?,partner_payment_reference=?,payment_status='paid' WHERE id=?").run(now,reference,projectId);
  db.prepare("UPDATE partner_ledger SET payment_verified_at=?,payment_reference=? WHERE project_id=? AND status IN ('pending','approved')").run(now,reference,projectId);
  ensurePartnerLedgerForCompletedProject(projectId,now);
 })();
 res.json({ok:true,confirmedAt:now});
});
app.post('/api/admin/projects/:id/refund',auth,adminOnly,(req,res)=>{
 const id=Number(req.params.id),reference=String(req.body?.reference||'').trim(),comment=String(req.body?.comment||'').trim();
 if(!Number.isSafeInteger(id)||id<=0||reference.length<3||reference.length>120)return res.status(400).json({error:'Укажите заказ и подтверждение фактического возврата'});
 const project=db.prepare('SELECT id,payment_status FROM projects WHERE id=?').get(id);
 if(!project)return res.status(404).json({error:'Заказ не найден'});
 if(!['paid','refund_required'].includes(project.payment_status))return res.status(409).json({error:'Заказ не находится в статусе, требующем возврата'});
 const now=Date.now();
 try{
  db.transaction(()=>{
   const ledger=db.prepare('SELECT * FROM partner_ledger WHERE project_id=?').get(id);
   if(ledger&&Number(ledger.paid_amount)>0)db.prepare('INSERT OR IGNORE INTO partner_balance_adjustments(partner_id,project_id,amount,reason,created_at,created_by) VALUES(?,?,?,?,?,?)').run(ledger.partner_id,id,ledger.paid_amount,'Возврат оплаченного заказа #'+id,now,req.user.id);
   db.prepare("UPDATE partner_ledger SET status=CASE WHEN status='pending' THEN 'rejected' ELSE 'reversed' END,reviewed_at=?,reviewed_by=? WHERE project_id=? AND status IN ('pending','approved','paid')").run(now,req.user.id,id);
   db.prepare("UPDATE projects SET payment_status='refunded',partner_paid_at=NULL,partner_payment_reference=? WHERE id=?").run('REFUND:'+reference+(comment?' '+comment.slice(0,100):''),id);
   db.prepare("UPDATE payments SET status='refunded' WHERE project_id=? AND purpose='project' AND status='succeeded'").run(id);
  })();
  res.json({ok:true,message:'Возврат зафиксирован. Партнёрское начисление сторнировано.'});
 }catch(e){console.error('[partner refund]',e);res.status(500).json({error:'Не удалось зафиксировать возврат'});}
});
app.post('/api/admin/partner-ledger/:id/:action',auth,adminOnly,(req,res)=>{
 const id=Number(req.params.id),row=db.prepare('SELECT l.*,p.status project_status,p.partner_paid_at FROM partner_ledger l JOIN projects p ON p.id=l.project_id WHERE l.id=?').get(id),action=req.params.action;
 if(!row)return res.status(404).json({error:'Начисление не найдено'});
 if(action==='approve'){
  if(row.status!=='pending')return res.status(409).json({error:'Начисление уже обработано'});
  if(row.project_status!=='completed'||!row.partner_paid_at||!row.payment_verified_at)return res.status(409).json({error:'Нельзя одобрить: заказ не завершён или оплата не подтверждена администратором'});
  db.prepare("UPDATE partner_ledger SET status='approved',reviewed_at=?,reviewed_by=? WHERE id=? AND status='pending'").run(Date.now(),req.user.id,id);
 } else return res.status(400).json({error:'Выплаты проводятся через заявку партнёра, а не напрямую из начисления'});
 res.json({ok:true});
});
app.get('/api/partner/me',auth,(req,res)=>{
 const p=db.prepare("SELECT * FROM partners WHERE partner_user_id=? AND status='active'").get(req.user.id);
 if(!p)return res.status(403).json({error:'К этому аккаунту не привязан активный партнёр. Обратитесь к администратору.'});
 const stats=db.prepare("SELECT COUNT(*) orders,COALESCE(SUM(CASE WHEN status='pending' THEN reward_amount ELSE 0 END),0) pending,COALESCE(SUM(CASE WHEN status='approved' THEN reward_amount-paid_amount ELSE 0 END),0) approved,COALESCE(SUM(paid_amount),0) paid,COALESCE(SUM(CASE WHEN status='reversed' THEN reward_amount ELSE 0 END),0) reversed FROM partner_ledger WHERE partner_id=?").get(p.id);
 const clicks=db.prepare('SELECT COUNT(*) n FROM partner_clicks WHERE partner_id=?').get(p.id).n;
 const registrations=db.prepare('SELECT COUNT(*) n FROM users WHERE partner_id=?').get(p.id).n;
 const adjustments=db.prepare('SELECT COALESCE(SUM(amount),0) n FROM partner_balance_adjustments WHERE partner_id=?').get(p.id).n;
 const reserved=db.prepare("SELECT COALESCE(SUM(amount),0) n FROM partner_payout_requests WHERE partner_id=? AND status IN ('pending','approved')").get(p.id).n;
 const available=Number(stats.approved)-Number(adjustments)-Number(reserved);
 const payouts=db.prepare('SELECT id,amount,status,comment,created_at,reviewed_at FROM partner_payout_requests WHERE partner_id=? ORDER BY created_at DESC LIMIT 30').all(p.id);
 const ledger=db.prepare('SELECT id,project_id,order_amount,reward_amount,paid_amount,status,created_at,reviewed_at FROM partner_ledger WHERE partner_id=? ORDER BY created_at DESC LIMIT 50').all(p.id);
 res.json({partner:partnerRow(p),stats:{clicks:Number(clicks),registrations:Number(registrations),orders:Number(stats.orders),pending:Number(stats.pending),approved:Number(stats.approved),paid:Number(stats.paid),reversed:Number(stats.reversed),available},payouts,ledger});
});
app.post('/api/partner/payouts',auth,(req,res)=>{
 const p=db.prepare("SELECT * FROM partners WHERE partner_user_id=? AND status='active'").get(req.user.id);
 if(!p)return res.status(403).json({error:'Активный партнёрский аккаунт не найден'});
 const details=String(req.body?.paymentDetails||'').trim();
 if(details.length<5||details.length>500)return res.status(400).json({error:'Укажите корректные платёжные реквизиты'});
 const create=db.transaction(()=>{
  const approved=Number(db.prepare("SELECT COALESCE(SUM(reward_amount-paid_amount),0) n FROM partner_ledger WHERE partner_id=? AND status='approved'").get(p.id).n);
  const adjustments=Number(db.prepare('SELECT COALESCE(SUM(amount),0) n FROM partner_balance_adjustments WHERE partner_id=?').get(p.id).n);
  const reserved=Number(db.prepare("SELECT COALESCE(SUM(amount),0) n FROM partner_payout_requests WHERE partner_id=? AND status IN ('pending','approved')").get(p.id).n);
  const available=approved-adjustments-reserved;
  if(available<Number(p.payout_minimum||100))throw new Error('Недостаточно средств для выплаты. Доступно '+(Math.max(0,available)/100).toFixed(2)+' ₽');
  const result=db.prepare("INSERT INTO partner_payout_requests(partner_id,amount,payment_details,status,created_at) VALUES(?,?,?,'pending',?)").run(p.id,available,details,Date.now());
  return Number(result.lastInsertRowid);
 });
 try{const id=create();res.status(201).json({ok:true,id,message:'Заявка на выплату отправлена администратору'});}catch(e){res.status(400).json({error:e.message||'Не удалось создать заявку'});}
});
app.patch('/api/admin/partners/:id/campaigns/:kind/:campaignId',auth,adminOnly,(req,res)=>{
 const partnerId=Number(req.params.id),campaignId=Number(req.params.campaignId),kind=req.params.kind,active=req.body?.active===true?1:req.body?.active===false?0:null;
 if(!Number.isSafeInteger(partnerId)||!Number.isSafeInteger(campaignId)||active===null||!['ads','contests'].includes(kind))return res.status(400).json({error:'Некорректные параметры кампании'});
 const table=kind==='ads'?'partner_ads':'partner_contests';
 const result=db.prepare('UPDATE '+table+' SET '+(kind==='ads'?'active':'status')+'=? WHERE id=? AND partner_id=?').run(kind==='ads'?active:(active?'active':'paused'),campaignId,partnerId);
 if(!result.changes)return res.status(404).json({error:'Кампания не найдена'});
 res.json({ok:true});
});
app.post('/api/admin/partners/:id/payouts',auth,adminOnly,(req,res)=>{
 const id=Number(req.params.id),p=db.prepare("SELECT * FROM partners WHERE id=? AND status='active'").get(id),b=req.body||{};
 if(!p)return res.status(404).json({error:'Активный партнёр не найден'});
 const amount=Math.round(Number(b.amountRub)*100),details=String(b.paymentDetails||'').trim();
 if(!Number.isSafeInteger(amount)||amount<100||details.length<5||details.length>500)return res.status(400).json({error:'Проверьте сумму и реквизиты'});
 const approved=Number(db.prepare("SELECT COALESCE(SUM(reward_amount-paid_amount),0) total FROM partner_ledger WHERE partner_id=? AND status='approved'").get(id).total);
 const adjustments=Number(db.prepare('SELECT COALESCE(SUM(amount),0) total FROM partner_balance_adjustments WHERE partner_id=?').get(id).total);
 const reserved=Number(db.prepare("SELECT COALESCE(SUM(amount),0) total FROM partner_payout_requests WHERE partner_id=? AND status IN ('pending','approved')").get(id).total);
 if(amount!==approved-adjustments-reserved)return res.status(400).json({error:'Сумма должна совпадать с доступным остатком: '+((approved-adjustments-reserved)/100).toFixed(2)+' ₽'});
 db.prepare("INSERT INTO partner_payout_requests(partner_id,amount,payment_details,status,created_at) VALUES(?,?,?,'pending',?)").run(id,amount,details,Date.now());
 res.status(201).json({ok:true});
});
app.patch('/api/admin/partner-payouts/:id',auth,adminOnly,(req,res)=>{
 const id=Number(req.params.id),status=String(req.body?.status||''),row=db.prepare('SELECT * FROM partner_payout_requests WHERE id=?').get(id);if(!row)return res.status(404).json({error:'Заявка не найдена'});
 if(!['approved','rejected','paid'].includes(status)||!(row.status==='pending'||(row.status==='approved'&&(status==='paid'||status==='rejected'))))return res.status(409).json({error:'Недопустимый статус заявки'});
 const now=Date.now();
 const update=db.transaction(()=>{
  db.prepare('UPDATE partner_payout_requests SET status=?,comment=?,reviewed_at=?,reviewed_by=? WHERE id=?').run(status,String(req.body?.comment||'').slice(0,500),now,req.user.id,id);
  if(status==='paid'){
   let remaining=Number(row.amount);
   const ledgers=db.prepare("SELECT id,reward_amount,paid_amount FROM partner_ledger WHERE partner_id=? AND status='approved' AND reward_amount>paid_amount ORDER BY created_at,id").all(row.partner_id);
   for(const item of ledgers){
    if(remaining<=0)break;
    const due=Number(item.reward_amount)-Number(item.paid_amount),portion=Math.min(due,remaining),newPaid=Number(item.paid_amount)+portion;
    db.prepare("UPDATE partner_ledger SET paid_amount=?,status=CASE WHEN ? >= reward_amount THEN 'paid' ELSE 'approved' END,reviewed_at=?,reviewed_by=? WHERE id=? AND status='approved'").run(newPaid,newPaid,now,req.user.id,item.id);
    remaining-=portion;
   }
   if(remaining!==0)throw new Error('Не удалось распределить сумму выплаты по начислениям');
  }
 });
 try{update();}catch(e){return res.status(409).json({error:e.message});}
 res.json({ok:true});
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
