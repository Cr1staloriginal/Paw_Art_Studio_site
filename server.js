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

[DATABASE_PATH].forEach(p => {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
[UPLOAD_DIR, AVATAR_DIR, PORTFOLIO_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const io = new SocketServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, file.fieldname === 'avatar' ? AVATAR_DIR : PORTFOLIO_DIR),
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
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','approved','rejected')),
        comment TEXT,
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

    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_msg_chat ON messages(chat_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_wd_user ON withdrawals(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wd_status ON withdrawals(status, created_at DESC);
`);

/* ============================================================
   СОЗДАНИЕ / ВОССТАНОВЛЕНИЕ ГЛАВНОГО АДМИНА
   Этот пользователь защищён от снятия с роли кем угодно
============================================================ */
const adminExists = db.prepare('SELECT * FROM users WHERE email = ?').get(ADMIN_EMAIL);
if (!adminExists) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.prepare(`INSERT INTO users (name, email, password, role, balance, is_root, created_at)
        VALUES (?, ?, ?, 'admin', 0, 1, ?)`)
        .run('Главный админ', ADMIN_EMAIL, hash, Date.now());
    console.log(`✅ Создан ГЛАВНЫЙ админ: ${ADMIN_EMAIL}`);
} else {
    if (adminExists.role !== 'admin' || adminExists.is_root !== 1) {
        db.prepare(`UPDATE users SET role = 'admin', is_root = 1 WHERE id = ?`).run(adminExists.id);
        console.log(`🔒 Главный админ восстановлен: ${ADMIN_EMAIL}`);
    }
    if (!bcrypt.compareSync(ADMIN_PASSWORD, adminExists.password)) {
        db.prepare('UPDATE users SET password = ? WHERE id = ?')
            .run(bcrypt.hashSync(ADMIN_PASSWORD, 10), adminExists.id);
        console.log(`🔑 Пароль главного админа обновлён из .env`);
    }
}

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '7d' : 0 }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: IS_PROD ? '30d' : 0 }));

function auth(req, res, next) {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Требуется авторизация' });
    try {
        const payload = jwt.verify(h.slice(7), JWT_SECRET);
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
        if (!user) return res.status(401).json({ error: 'Не найден' });
        req.user = user;
        next();
    } catch { res.status(401).json({ error: 'Токен недействителен' }); }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нужны права админа' });
    next();
}

function rootOnly(req, res, next) {
    if (req.user.role !== 'admin' || req.user.is_root !== 1) {
        return res.status(403).json({ error: 'Доступно только главному админу' });
    }
    next();
}

function publicUser(u) {
    if (!u) return null;
    return {
        id: u.id, name: u.name, email: u.email, role: u.role,
        requestedRole: u.requested_role, balance: u.balance,
        avatar: u.avatar, bio: u.bio,
        isRoot: u.is_root === 1,
        createdAt: u.created_at,
    };
}
function shortUser(u) {
    if (!u) return null;
    return { id: u.id, name: u.name, avatar: u.avatar, role: u.role };
}
function withdrawalRow(w) {
    if (!w) return null;
    return {
        id: w.id, userId: w.user_id, amount: w.amount, status: w.status,
        comment: w.comment, createdAt: w.created_at,
        reviewedAt: w.reviewed_at, reviewedBy: w.reviewed_by,
    };
}
function txRow(t) {
    if (!t) return null;
    return { id: t.id, title: t.title, amount: t.amount, type: t.type, date: t.created_at };
}

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

/* AUTH */
app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    const cleanEmail = String(email).trim().toLowerCase();
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail)) return res.status(400).json({ error: 'Email занят' });

    const hash = bcrypt.hashSync(String(password), 10);
    const now = Date.now();
    const info = db.prepare(`INSERT INTO users (name, email, password, role, balance, created_at) VALUES (?, ?, ?, 'client', 50000, ?)`)
        .run(String(name).trim(), cleanEmail, hash, now);
    db.prepare(`INSERT INTO transactions (user_id, title, amount, type, created_at) VALUES (?, 'Бонус новичка', 50000, 'in', ?)`)
        .run(info.lastInsertRowid, now);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
    if (!user || !bcrypt.compareSync(String(password), user.password)) return res.status(401).json({ error: 'Неверный email или пароль' });
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

/* PROFILE */
app.post('/api/profile/update', auth, (req, res) => {
    const { name, bio, currentPassword, newPassword } = req.body || {};
    const updates = []; const params = [];
    if (name && String(name).trim()) { updates.push('name = ?'); params.push(String(name).trim()); }
    if (typeof bio === 'string') { updates.push('bio = ?'); params.push(bio.trim().slice(0, 500)); }
    if (newPassword) {
        if (!currentPassword) return res.status(400).json({ error: 'Введите текущий пароль' });
        if (!bcrypt.compareSync(currentPassword, req.user.password)) return res.status(400).json({ error: 'Текущий пароль неверен' });
        if (String(newPassword).length < 6) return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });
        updates.push('password = ?'); params.push(bcrypt.hashSync(String(newPassword), 10));
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

/* WALLET */
app.post('/api/wallet/deposit', auth, (req, res) => {
    const k = Math.round(Number(req.body?.amount) * 100);
    if (!k || isNaN(k) || k <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(k, req.user.id);
    db.prepare(`INSERT INTO transactions (user_id, title, amount, type, created_at) VALUES (?, 'Пополнение баланса', ?, 'in', ?)`).run(req.user.id, k, Date.now());
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(u) });
});

app.post('/api/wallet/withdraw', auth, (req, res) => {
    const k = Math.round(Number(req.body?.amount) * 100);
    if (!k || isNaN(k) || k <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
    if (k < 1) return res.status(400).json({ error: 'Минимум 0.01 ₽' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (user.balance < k) return res.status(400).json({ error: 'Недостаточно средств' });
    const pendingSum = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM withdrawals WHERE user_id = ? AND status = 'pending'`).get(user.id).s;
    if (user.balance - pendingSum < k) return res.status(400).json({ error: 'Недостаточно средств (учитывая заявки)' });
    const now = Date.now();
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(k, user.id);
    const info = db.prepare(`INSERT INTO withdrawals (user_id, amount, status, created_at) VALUES (?, ?, 'pending', ?)`).run(user.id, k, now);
    const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(info.lastInsertRowid);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.json({ withdrawal: withdrawalRow(withdrawal), user: publicUser(updated) });
});

app.get('/api/wallet/withdrawals', auth, (req, res) => {
    const items = db.prepare(`SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).all(req.user.id);
    res.json({ withdrawals: items.map(withdrawalRow) });
});

app.get('/api/wallet/transactions', auth, (req, res) => {
    const txs = db.prepare(`SELECT id, title, amount, type, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`).all(req.user.id);
    res.json({ transactions: txs.map(txRow) });
});

/* ROLE */
app.post('/api/role/request', auth, (req, res) => {
    const { role } = req.body || {};
    if (!['executor', 'manager'].includes(role)) return res.status(400).json({ error: 'Некорректная роль' });
    if (req.user.role === 'admin') return res.status(400).json({ error: 'Админ не меняет роль' });
    if (req.user.role === role) return res.status(400).json({ error: 'Эта роль уже ваша' });
    db.prepare('UPDATE users SET requested_role = ? WHERE id = ?').run(role, req.user.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(u) });
});

/* PROJECTS */
const PROJECT_STATUSES = ['open', 'in_progress', 'review', 'completed', 'cancelled'];

function getProjectById(id) {
    const p = db.prepare(`
        SELECT p.*, c.name AS client_name, c.avatar AS client_avatar,
            e.name AS executor_name, e.avatar AS executor_avatar
        FROM projects p
        LEFT JOIN users c ON c.id = p.client_id
        LEFT JOIN users e ON e.id = p.executor_id
        WHERE p.id = ?
    `).get(id);
    if (!p) return null;
    return {
        id: p.id, title: p.title, description: p.description, category: p.category,
        budget: p.budget, status: p.status, clientId: p.client_id,
        client: { id: p.client_id, name: p.client_name, avatar: p.client_avatar },
        executor: p.executor_id ? { id: p.executor_id, name: p.executor_name, avatar: p.executor_avatar } : null,
        createdAt: p.created_at, updatedAt: p.updated_at,
    };
}

app.post('/api/projects', auth, (req, res) => {
    const { title, description, category, budget } = req.body || {};
    if (!title || !description || !category) return res.status(400).json({ error: 'Заполните поля' });
    if (req.user.role === 'executor') return res.status(403).json({ error: 'Исполнители не создают заказы' });
    const now = Date.now();
    const info = db.prepare(`INSERT INTO projects (title, description, category, budget, status, client_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`)
        .run(String(title).trim(), String(description).trim(), category, Math.round((Number(budget) || 0) * 100), req.user.id, now, now);
    res.json({ project: getProjectById(info.lastInsertRowid) });
});

app.get('/api/projects', auth, (req, res) => {
    let rows;
    if (req.user.role === 'admin' || req.user.role === 'manager') {
        rows = db.prepare(`SELECT id FROM projects ORDER BY created_at DESC LIMIT 200`).all();
    } else if (req.user.role === 'executor') {
        rows = db.prepare(`SELECT id FROM projects WHERE status = 'open' OR executor_id = ? ORDER BY created_at DESC LIMIT 200`).all(req.user.id);
    } else {
        rows = db.prepare(`SELECT id FROM projects WHERE client_id = ? ORDER BY created_at DESC LIMIT 200`).all(req.user.id);
    }
    res.json({ projects: rows.map(r => getProjectById(r.id)) });
});

app.get('/api/projects/:id', auth, (req, res) => {
    const p = getProjectById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Проект не найден' });
    res.json({ project: p });
});

app.post('/api/projects/:id/accept', auth, (req, res) => {
    if (req.user.role !== 'executor') return res.status(403).json({ error: 'Только исполнители' });
    const p = getProjectById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Не найден' });
    if (p.status !== 'open') return res.status(400).json({ error: 'Уже занят' });
    db.prepare(`UPDATE projects SET executor_id = ?, status = 'in_progress', updated_at = ? WHERE id = ?`)
        .run(req.user.id, Date.now(), req.params.id);
    res.json({ project: getProjectById(req.params.id) });
});

app.post('/api/projects/:id/status', auth, (req, res) => {
    const { status } = req.body || {};
    if (!PROJECT_STATUSES.includes(status)) return res.status(400).json({ error: 'Некорректный статус' });
    const p = getProjectById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Не найден' });
    const isAdmin = req.user.role === 'admin' || req.user.role === 'manager';
    const isClient = p.clientId === req.user.id;
    const isExecutor = p.executor && p.executor.id === req.user.id;
    if (!isAdmin && !isClient && !isExecutor) return res.status(403).json({ error: 'Нет прав' });
    db.prepare(`UPDATE projects SET status = ?, updated_at = ? WHERE id = ?`).run(status, Date.now(), req.params.id);
    res.json({ project: getProjectById(req.params.id) });
});

/* PORTFOLIO */
function portfolioItem(p) {
    if (!p) return null;
    return { id: p.id, userId: p.user_id, filename: p.filename, title: p.title, description: p.description, category: p.category, createdAt: p.created_at };
}

app.post('/api/portfolio', auth, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const { title, description, category } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Укажите название' });
    const url = '/uploads/portfolio/' + req.file.filename;
    const info = db.prepare(`INSERT INTO portfolio (user_id, filename, title, description, category, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(req.user.id, url, String(title).trim(), (description || '').trim().slice(0, 500), category || 'Арт', Date.now());
    res.json({ item: portfolioItem(db.prepare('SELECT * FROM portfolio WHERE id = ?').get(info.lastInsertRowid)) });
});

app.get('/api/portfolio/me', auth, (req, res) => {
    const items = db.prepare('SELECT * FROM portfolio WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json({ items: items.map(portfolioItem) });
});

app.get('/api/portfolio/user/:id', (req, res) => {
    const u = db.prepare('SELECT id, name, avatar FROM users WHERE id = ?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Не найден' });
    const items = db.prepare('SELECT * FROM portfolio WHERE user_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json({ user: shortUser(u), items: items.map(portfolioItem) });
});

app.get('/api/portfolio/all', (req, res) => {
    const items = db.prepare(`
        SELECT p.*, u.name AS author_name, u.avatar AS author_avatar
        FROM portfolio p JOIN users u ON u.id = p.user_id
        ORDER BY p.created_at DESC LIMIT 200
    `).all();
    res.json({
        items: items.map(p => ({ ...portfolioItem(p), authorName: p.author_name, authorAvatar: p.author_avatar })),
    });
});

app.delete('/api/portfolio/:id', auth, (req, res) => {
    const item = db.prepare('SELECT * FROM portfolio WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Не найдено' });
    if (item.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Нет прав' });
    const fp = path.join(UPLOAD_DIR, item.filename.replace(/^\/uploads\//, ''));
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
    db.prepare('DELETE FROM portfolio WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

/* CHATS */
function findOrCreateChat(a, b) {
    const [min, max] = a < b ? [a, b] : [b, a];
    let chat = db.prepare('SELECT * FROM chats WHERE user_a = ? AND user_b = ?').get(min, max);
    if (!chat) {
        const info = db.prepare('INSERT INTO chats (user_a, user_b, created_at) VALUES (?, ?, ?)').run(min, max, Date.now());
        chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(info.lastInsertRowid);
    }
    return chat;
}

app.get('/api/chats', auth, (req, res) => {
    const chats = db.prepare(`SELECT * FROM chats WHERE user_a = ? OR user_b = ?`).all(req.user.id, req.user.id);
    const list = chats.map(c => {
        const otherId = c.user_a === req.user.id ? c.user_b : c.user_a;
        const other = db.prepare('SELECT id, name, avatar, role FROM users WHERE id = ?').get(otherId);
        const last = db.prepare('SELECT text, sender_id, created_at FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1').get(c.id);
        const unread = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL').get(c.id, req.user.id).n;
        return {
            id: c.id, peer: shortUser(other),
            lastMessage: last ? { text: last.text, senderId: last.sender_id, createdAt: last.created_at } : null,
            unread,
        };
    });
    list.sort((a, b) => (b.lastMessage?.createdAt || 0) - (a.lastMessage?.createdAt || 0));
    res.json({ chats: list });
});

app.post('/api/chats', auth, (req, res) => {
    const { peerId } = req.body || {};
    if (!peerId) return res.status(400).json({ error: 'Не указан получатель' });
    if (Number(peerId) === req.user.id) return res.status(400).json({ error: 'Нельзя с собой' });
    const peer = db.prepare('SELECT id FROM users WHERE id = ?').get(peerId);
    if (!peer) return res.status(404).json({ error: 'Пользователь не найден' });
    const chat = findOrCreateChat(req.user.id, Number(peerId));
    res.json({ chatId: chat.id });
});

app.get('/api/chats/:id/messages', auth, (req, res) => {
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (chat.user_a !== req.user.id && chat.user_b !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
    const msgs = db.prepare(`
        SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
        FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = ? ORDER BY m.created_at ASC LIMIT 500
    `).all(chat.id);
    db.prepare('UPDATE messages SET read_at = ? WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL')
        .run(Date.now(), chat.id, req.user.id);
    res.json({
        messages: msgs.map(m => ({
            id: m.id, chatId: m.chat_id, senderId: m.sender_id,
            senderName: m.sender_name, senderAvatar: m.sender_avatar,
            text: m.text, createdAt: m.created_at, readAt: m.read_at,
        })),
    });
});

app.get('/api/users/list', auth, (req, res) => {
    let users;
    if (req.user.role === 'admin' || req.user.role === 'manager') {
        users = db.prepare('SELECT id, name, avatar, role FROM users WHERE id != ? ORDER BY name').all(req.user.id);
    } else {
        users = db.prepare(`SELECT id, name, avatar, role FROM users WHERE id != ? AND role IN ('executor','manager','admin') ORDER BY name`).all(req.user.id);
    }
    res.json({ users: users.map(shortUser) });
});

/* ADMIN */
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
    const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
    res.json({ users: users.map(publicUser) });
});

app.get('/api/admin/users/:id/full', auth, adminOnly, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
    const txs = db.prepare(`SELECT id, title, amount, type, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 500`).all(u.id);
    const withdrawals = db.prepare(`SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).all(u.id);
    const projectsCount = db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE client_id = ? OR executor_id = ?`).get(u.id, u.id).n;
    const totalIn = txs.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0);
    const totalOut = txs.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0);
    res.json({
        user: publicUser(u),
        transactions: txs.map(txRow),
        withdrawals: withdrawals.map(withdrawalRow),
        stats: { totalIn, totalOut, txCount: txs.length, projectsCount, withdrawalsCount: withdrawals.length },
    });
});

app.get('/api/admin/requests', auth, adminOnly, (req, res) => {
    const users = db.prepare(`SELECT * FROM users WHERE requested_role IS NOT NULL AND role != 'admin' ORDER BY created_at DESC`).all();
    res.json({ requests: users.map(publicUser) });
});

/* ============================================================
   ИЕРАРХИЯ РОЛЕЙ — ГЛАВНАЯ ЗАЩИТА
============================================================ */
app.post('/api/admin/role', auth, adminOnly, (req, res) => {
    const { userId, role } = req.body || {};
    if (!['client', 'executor', 'manager', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Некорректная роль' });
    }

    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

    const iAmRoot = req.user.is_root === 1;
    const targetIsRoot = target.is_root === 1;
    const targetIsAdmin = target.role === 'admin';

    if (targetIsRoot && target.id !== req.user.id) {
        return res.status(403).json({ error: 'Нельзя изменить главного админа' });
    }
    if (target.id === req.user.id && role !== 'admin') {
        return res.status(400).json({ error: 'Нельзя снять роль админа с себя' });
    }
    if (!iAmRoot && targetIsAdmin && target.id !== req.user.id) {
        return res.status(403).json({ error: 'Только главный админ может менять других админов' });
    }
    if (!iAmRoot && role === 'admin') {
        return res.status(403).json({ error: 'Только главный админ может назначать админов' });
    }

    db.prepare('UPDATE users SET role = ?, requested_role = NULL WHERE id = ?').run(role, userId);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) });
});

app.post('/api/admin/approve', auth, adminOnly, (req, res) => {
    const t = db.prepare('SELECT * FROM users WHERE id = ?').get(req.body?.userId);
    if (!t || !t.requested_role) return res.status(400).json({ error: 'Заявка не найдена' });
    if (t.is_root === 1) return res.status(403).json({ error: 'Нельзя менять главного админа' });
    if (!['executor', 'manager'].includes(t.requested_role)) {
        return res.status(400).json({ error: 'Некорректная заявка' });
    }
    db.prepare('UPDATE users SET role = requested_role, requested_role = NULL WHERE id = ?').run(t.id);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(t.id)) });
});

app.post('/api/admin/reject', auth, adminOnly, (req, res) => {
    const t = db.prepare('SELECT * FROM users WHERE id = ?').get(req.body?.userId);
    if (t && t.is_root === 1) return res.status(403).json({ error: 'Нельзя трогать главного админа' });
    db.prepare('UPDATE users SET requested_role = NULL WHERE id = ?').run(req.body?.userId);
    res.json({ ok: true });
});

app.post('/api/admin/balance', auth, adminOnly, (req, res) => {
    const { userId, amount, comment } = req.body || {};
    const k = Math.round(Number(amount) * 100);
    if (!k || isNaN(k)) return res.status(400).json({ error: 'Некорректная сумма' });
    const t = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!t) return res.status(404).json({ error: 'Не найден' });

    const iAmRoot = req.user.is_root === 1;
    if (!iAmRoot && t.role === 'admin' && t.id !== req.user.id) {
        return res.status(403).json({ error: 'Только главный админ может менять баланс других админов' });
    }

    const nb = t.balance + k;
    if (nb < 0) return res.status(400).json({ error: 'Баланс не может быть отрицательным' });
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(nb, userId);
    db.prepare(`INSERT INTO transactions (user_id, title, amount, type, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(userId, comment || (k > 0 ? 'Начисление от админа' : 'Списание админом'), Math.abs(k), k > 0 ? 'in' : 'out', Date.now());
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) });
});

app.get('/api/admin/withdrawals', auth, adminOnly, (req, res) => {
    const rows = db.prepare(`
        SELECT w.*, u.name AS user_name, u.email AS user_email, u.avatar AS user_avatar
        FROM withdrawals w
        JOIN users u ON u.id = w.user_id
        ORDER BY CASE w.status WHEN 'pending' THEN 0 ELSE 1 END, w.created_at DESC
        LIMIT 200
    `).all();
    res.json({
        withdrawals: rows.map(w => ({
            ...withdrawalRow(w),
            user: { id: w.user_id, name: w.user_name, email: w.user_email, avatar: w.user_avatar },
        })),
    });
});

app.post('/api/admin/withdrawals/:id/approve', auth, adminOnly, (req, res) => {
    const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
    if (!w) return res.status(404).json({ error: 'Заявка не найдена' });
    if (w.status !== 'pending') return res.status(400).json({ error: 'Заявка уже обработана' });
    const now = Date.now();
    db.prepare(`UPDATE withdrawals SET status = 'approved', reviewed_at = ?, reviewed_by = ? WHERE id = ?`)
        .run(now, req.user.id, w.id);
    db.prepare(`INSERT INTO transactions (user_id, title, amount, type, created_at) VALUES (?, 'Вывод средств (одобрен)', ?, 'out', ?)`)
        .run(w.user_id, w.amount, now);
    res.json({ ok: true });
});

app.post('/api/admin/withdrawals/:id/reject', auth, adminOnly, (req, res) => {
    const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
    if (!w) return res.status(404).json({ error: 'Заявка не найдена' });
    if (w.status !== 'pending') return res.status(400).json({ error: 'Заявка уже обработана' });
    const comment = (req.body?.comment || '').trim().slice(0, 300);
    const now = Date.now();
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(w.amount, w.user_id);
    db.prepare(`INSERT INTO transactions (user_id, title, amount, type, created_at) VALUES (?, 'Возврат вывода (отклонён)', ?, 'in', ?)`)
        .run(w.user_id, w.amount, now);
    db.prepare(`UPDATE withdrawals SET status = 'rejected', comment = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`)
        .run(comment, now, req.user.id, w.id);
    res.json({ ok: true });
});

app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
    const g = (q) => db.prepare(q).get().n;
    res.json({
        users: {
            total: g('SELECT COUNT(*) AS n FROM users'),
            clients: g(`SELECT COUNT(*) AS n FROM users WHERE role = 'client'`),
            executors: g(`SELECT COUNT(*) AS n FROM users WHERE role = 'executor'`),
            managers: g(`SELECT COUNT(*) AS n FROM users WHERE role = 'manager'`),
            admins: g(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`),
            new7: db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at > ?').get(Date.now() - 7 * 86400000).n,
        },
        projects: {
            total: g('SELECT COUNT(*) AS n FROM projects'),
            open: g(`SELECT COUNT(*) AS n FROM projects WHERE status = 'open'`),
            inProgress: g(`SELECT COUNT(*) AS n FROM projects WHERE status = 'in_progress'`),
            completed: g(`SELECT COUNT(*) AS n FROM projects WHERE status = 'completed'`),
            new7: db.prepare('SELECT COUNT(*) AS n FROM projects WHERE created_at > ?').get(Date.now() - 7 * 86400000).n,
        },
        messages: { total: g('SELECT COUNT(*) AS n FROM messages') },
        portfolio: { total: g('SELECT COUNT(*) AS n FROM portfolio') },
        withdrawals: {
            pendingCount: g(`SELECT COUNT(*) AS n FROM withdrawals WHERE status = 'pending'`),
            pendingSum: db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM withdrawals WHERE status = 'pending'`).get().s,
            approvedSum: db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM withdrawals WHERE status = 'approved'`).get().s,
        },
        money: {
            totalBalance: db.prepare('SELECT COALESCE(SUM(balance), 0) AS s FROM users').get().s,
            totalIn: db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE type = 'in'`).get().s,
            totalOut: db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE type = 'out'`).get().s,
        },
    });
});

/* SOCKET.IO */
const onlineUsers = new Map();

io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Нет токена'));
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = db.prepare('SELECT id, name, avatar, role FROM users WHERE id = ?').get(payload.id);
        if (!user) return next(new Error('Не найден'));
        socket.user = user;
        next();
    } catch { next(new Error('Токен недействителен')); }
});

io.on('connection', (socket) => {
    const uid = socket.user.id;
    if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
    onlineUsers.get(uid).add(socket.id);
    io.emit('presence', { userId: uid, online: true });

    socket.on('chat:join', ({ chatId }) => {
        const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
        if (!chat) return;
        if (chat.user_a !== uid && chat.user_b !== uid) return;
        socket.join('chat:' + chatId);
    });

    socket.on('chat:leave', ({ chatId }) => socket.leave('chat:' + chatId));

    socket.on('chat:send', ({ chatId, text }, ack) => {
        const clean = String(text || '').trim().slice(0, 2000);
        if (!clean) return;
        const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
        if (!chat) return;
        if (chat.user_a !== uid && chat.user_b !== uid) return;
        const now = Date.now();
        const info = db.prepare(`INSERT INTO messages (chat_id, sender_id, text, created_at) VALUES (?, ?, ?, ?)`)
            .run(chatId, uid, clean, now);
        const msg = {
            id: info.lastInsertRowid, chatId: Number(chatId), senderId: uid,
            senderName: socket.user.name, senderAvatar: socket.user.avatar,
            text: clean, createdAt: now, readAt: null,
        };
        io.to('chat:' + chatId).emit('chat:new', msg);
        const otherId = chat.user_a === uid ? chat.user_b : chat.user_a;
        if (onlineUsers.has(otherId)) {
            for (const sid of onlineUsers.get(otherId)) {
                io.to(sid).emit('chat:notify', { chatId: Number(chatId), message: msg });
            }
        }
        if (typeof ack === 'function') ack({ ok: true, message: msg });
    });

    socket.on('chat:typing', ({ chatId }) => {
        socket.to('chat:' + chatId).emit('chat:typing', { chatId, userId: uid, name: socket.user.name });
    });

    socket.on('disconnect', () => {
        const set = onlineUsers.get(uid);
        if (set) {
            set.delete(socket.id);
            if (!set.size) {
                onlineUsers.delete(uid);
                io.emit('presence', { userId: uid, online: false });
            }
        }
    });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

process.on('unhandledRejection', (err) => console.error('❌ Unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('❌ Uncaught exception:', err));

server.listen(PORT, HOST, () => {
    console.log('');
    console.log('🐾 Paw Art Studio v3.3');
    console.log(`🌐 Сервер: http://${HOST}:${PORT}`);
    console.log(`🔑 ГЛАВНЫЙ админ (защищён от снятия): ${ADMIN_EMAIL}`);
    console.log(`💾 БД: ${DATABASE_PATH}`);
    console.log(`📁 Uploads: ${UPLOAD_DIR}`);
    console.log(`🌍 Режим: ${IS_PROD ? 'PRODUCTION' : 'development'}`);
    console.log('');
});