/* Paw Art Studio v3.8 — гибрид: старый дизайн + новые фичи */

const API = '';
const TOKEN_KEY = 'paw_token';
const ROLE_LABELS = { client: 'Клиент', executor: 'Исполнитель', manager: 'Менеджер', admin: 'Администратор' };
const STATUS_LABELS = { open: 'Открыт', in_progress: 'В работе', review: 'На проверке', completed: 'Завершён', cancelled: 'Отменён' };
const WD_STATUS = { pending: 'На рассмотрении', approved: 'Одобрено', rejected: 'Отклонено' };
const WD_STATUS_CLASS = { pending: 'status-review', approved: 'status-completed', rejected: 'status-cancelled' };

const state = {
    user: null, transactions: [], userWithdrawals: [],
    adminUsers: [], adminRequests: [], adminContactRequests: [], adminStats: null, adminWithdrawals: [],
    projects: [], projectFilter: 'all', currentProject: null,
    chats: [], chatMessages: {}, currentChatId: null, chatPeer: null,
    socket: null, onlineUsers: new Set(),
    moneyMode: 'deposit',
    allPortfolio: [], myPortfolio: [], portfolioFilter: 'all',
    content: null,
    pendingEmail: null,
};

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const isForm = options.body instanceof FormData;
    if (isForm) delete headers['Content-Type'];
    const res = await fetch(API + path, { ...options, headers, body: isForm ? options.body : (options.body ? JSON.stringify(options.body) : undefined) });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) { const err = new Error(data?.error || `Ошибка ${res.status}`); err.status = res.status; throw err; }
    return data;
}

function formatMoney(k) { const r = (Number(k) || 0) / 100; return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(r) + ' ₽'; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function formatTime(ts) { const d = new Date(ts), now = new Date(), diff = (now - d) / 1000; if (diff < 60) return 'сейчас'; if (diff < 3600) return Math.floor(diff / 60) + ' мин'; if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }); }
function formatDateTime(ts) { const d = new Date(ts); return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' · ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function userAvatarHtml(u) { if (u?.avatar) return `<img src="${escapeHtml(u.avatar)}" alt="">`; return `<span>${(u?.name || '?').charAt(0).toUpperCase()}</span>`; }

function scrollToSection(id) { const el = document.getElementById(id); if (!el) { console.warn(`Раздел не найден: #${id}`); showToast('Раздел временно недоступен', 'error'); return; } const header = document.querySelector('header'); const offset = (header?.getBoundingClientRect().height || 70) + 12; const top = el.getBoundingClientRect().top + window.pageYOffset - offset; window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`); closeMenu(); }
function dismissInquiryBar() {
    const bar = document.getElementById('pawInquiryBar');
    if (bar) bar.classList.add('is-dismissed');
}
function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); closeMenu(); }
function toggleMenu() { document.getElementById('navLinks').classList.toggle('open'); document.getElementById('burger').classList.toggle('active'); }
function closeMenu() { document.getElementById('navLinks').classList.remove('open'); document.getElementById('burger').classList.remove('active'); }

document.addEventListener('click', (e) => {
    const nav = document.getElementById('navLinks'), burger = document.getElementById('burger');
    if (nav && burger && !nav.contains(e.target) && !burger.contains(e.target)) closeMenu();
    const box = document.getElementById('userBox'), menu = document.getElementById('userMenu');
    if (box && menu && !box.contains(e.target)) menu.classList.add('hidden');
});
window.addEventListener('resize', () => { if (window.innerWidth > 900) closeMenu(); });

function showToast(text, type) { const t = document.getElementById('toast'); if (!t) return; t.textContent = text; t.classList.toggle('error', type === 'error'); t.classList.add('show'); clearTimeout(t._timeout); t._timeout = setTimeout(() => t.classList.remove('show'), 3500); }

/* EMAIL */
const CONTACT_EMAIL = 'pawartstudioofficial@gmail.com';

function openEmail() {
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (isMobile) window.location.href = `mailto:${CONTACT_EMAIL}`;
    else window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${CONTACT_EMAIL}&su=${encodeURIComponent('Заявка с сайта Paw Art Studio')}`, '_blank');
}
function copyEmail() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(CONTACT_EMAIL).then(() => showToast(`📋 Email скопирован: ${CONTACT_EMAIL}`)).catch(() => fallbackCopy(CONTACT_EMAIL));
    } else fallbackCopy(CONTACT_EMAIL);
}
function fallbackCopy(text) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast(`📋 Email скопирован: ${text}`); } catch (e) { showToast('❌ Не удалось скопировать', 'error'); }
    document.body.removeChild(ta);
}
function openSocial(type, value) {
    if (!value) return;
    if (type === 'discord') { const url = value.startsWith('http') ? value : `https://${value}`; window.open(url, '_blank'); }
    else if (type === 'telegram') { const username = value.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, ''); window.open(`https://t.me/${username}`, '_blank'); }
}

/* AUTH */
function openAuth() {
    document.getElementById('authModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    switchAuthTab('login');
}
function closeAuth() {
    document.getElementById('authModal').classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
    document.getElementById('loginForm')?.reset();
    document.getElementById('registerForm')?.reset();
    document.getElementById('verifyForm')?.reset();
    // Возвращаем табы на место
    document.getElementById('authTabs')?.classList.remove('hidden');
    document.getElementById('loginForm')?.classList.add('hidden');
    document.getElementById('registerForm')?.classList.add('hidden');
    document.getElementById('verifyForm')?.classList.add('hidden');
    document.getElementById('forgotPasswordForm')?.classList.add('hidden');
    document.getElementById('resetPasswordForm')?.classList.add('hidden');
    // Сбрасываем активный таб на login
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'login'));
}

function showForgotPassword() {
    ['loginForm','registerForm','verifyForm','resetPasswordForm'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById('authTabs')?.classList.add('hidden');
    document.getElementById('forgotPasswordForm')?.classList.remove('hidden');
    const subtitle = document.getElementById('authSubtitle');
    if (subtitle) subtitle.textContent = 'Восстановление доступа';
    const loginEmail = document.getElementById('loginEmail')?.value.trim();
    const forgotEmail = document.getElementById('forgotEmail');
    if (forgotEmail && loginEmail && !forgotEmail.value) forgotEmail.value = loginEmail;
    const error = document.getElementById('resetPasswordError'); if (error) error.textContent = '';
}
async function handleForgotPassword(e) {
    e.preventDefault();
    const email = document.getElementById('forgotEmail').value.trim();
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    try {
        await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
        state.pendingEmail = email;
        document.getElementById('forgotPasswordForm').classList.add('hidden');
        document.getElementById('resetPasswordForm').classList.remove('hidden');
        document.getElementById('authSubtitle').textContent = 'Установить новый пароль';
        showToast('Если аккаунт существует, код отправлен на почту');
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { btn.disabled = false; }
}
async function handleResetPassword(e) {
    e.preventDefault();
    const code = document.getElementById('resetCode').value.trim();
    const password = document.getElementById('resetNewPassword').value;
    const confirm = document.getElementById('resetConfirmPassword').value;
    const error = document.getElementById('resetPasswordError');
    if (password.length < 6) { error.textContent = 'Пароль должен содержать минимум 6 символов'; return; }
    if (password !== confirm) { error.textContent = 'Пароли не совпадают'; return; }
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    try {
        await api('/api/auth/reset-password', { method: 'POST', body: { email: state.pendingEmail || document.getElementById('forgotEmail').value.trim(), code, password } });
        e.target.reset();
        document.getElementById('resetPasswordForm').classList.add('hidden');
        document.getElementById('authTabs').classList.remove('hidden');
        switchAuthTab('login');
        document.getElementById('loginEmail').value = state.pendingEmail || '';
        showToast('Пароль изменён. Теперь войдите с новым паролем.');
    } catch (err) { error.textContent = err.message; showToast('❌ ' + err.message, 'error'); }
    finally { btn.disabled = false; }
}

function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('authTabs').classList.remove('hidden');
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
    document.getElementById('verifyForm').classList.add('hidden');
    document.getElementById('forgotPasswordForm')?.classList.add('hidden');
    document.getElementById('resetPasswordForm')?.classList.add('hidden');
    const sub = document.getElementById('authSubtitle');
    if (sub) sub.textContent = tab === 'register' ? 'Создайте новый аккаунт' : 'Войдите или создайте аккаунт';
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    try {
        const { token, user } = await api('/api/auth/login', { method: 'POST', body: { email, password } });
        setToken(token); state.user = user; closeAuth();
        await afterLogin();
        showToast(`👋 Добро пожаловать, ${user.name}!`);
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { btn.disabled = false; }
}

async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    try {
        const ref = getRefFromUrl() || localStorage.getItem('paw_ref');
        const data = await api('/api/auth/register', { method: 'POST', body: { name, email, password, ref } });
        state.pendingEmail = data.email;

        // Показать панель верификации, скрыть остальные
        document.getElementById('authTabs').classList.add('hidden');
        document.getElementById('loginForm').classList.add('hidden');
        document.getElementById('registerForm').classList.add('hidden');
        document.getElementById('verifyForm').classList.remove('hidden');
        document.getElementById('verifyEmailTarget').textContent = data.email;
        const vErr = document.getElementById('verifyError'); if (vErr) vErr.textContent = '';
        showToast('📧 Код отправлен на ' + data.email);
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { btn.disabled = false; }
}

async function handleVerify(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const codeInput = document.getElementById('verifyCode');
    const errorEl = document.getElementById('verifyError');
    const btn = form.querySelector('button[type="submit"]');
    const code = codeInput.value.replace(/\D/g, '').slice(0, 6);
    const email = state.pendingEmail;
    codeInput.value = code;
    if (errorEl) errorEl.textContent = '';

    if (!email) {
        if (errorEl) errorEl.textContent = 'Email не найден. Вернитесь к регистрации и запросите код заново.';
        return;
    }
    if (!/^\d{6}$/.test(code)) {
        if (errorEl) errorEl.textContent = 'Введите ровно 6 цифр из письма.';
        codeInput.focus();
        return;
    }

    if (btn) btn.disabled = true;
    codeInput.disabled = true;
    let data;
    try {
        data = await api('/api/auth/verify-email', { method: 'POST', body: { email, code } });
        if (!data || typeof data.token !== 'string' || !data.token || !data.user || !data.user.id) {
            throw new Error('Сервер вернул неполные данные. Попробуйте позже.');
        }
    } catch (err) {
        console.error('Ошибка подтверждения email:', err);
        if (errorEl) errorEl.textContent = err.message || 'Не удалось подтвердить email. Попробуйте ещё раз.';
        showToast('❌ ' + (err.message || 'Ошибка подтверждения email'), 'error');
        if (btn) btn.disabled = false;
        codeInput.disabled = false;
        return;
    }

    setToken(data.token);
    state.user = data.user;
    closeAuth();
    showToast('🎉 Email подтверждён! Добро пожаловать, ' + data.user.name + '!');
    try {
        await afterLogin();
    } catch (loginError) {
        console.error('Ошибка загрузки данных после авторизации:', loginError);
        showToast('Вы вошли, но не все данные кабинета удалось загрузить. Обновите страницу.', 'error');
    } finally {
        if (btn) btn.disabled = false;
        codeInput.disabled = false;
    }
}

async function resendCode() {
    if (!state.pendingEmail) return showToast('⚠️ Email не найден', 'error');
    try {
        await api('/api/auth/resend-code', { method: 'POST', body: { email: state.pendingEmail } });
        showToast('📧 Код отправлен повторно');
    } catch (err) {
        const vErr = document.getElementById('verifyError'); if (vErr) vErr.textContent = err.message;
        showToast('❌ ' + err.message, 'error');
    }
}

function getRefFromUrl() {
    return new URLSearchParams(location.search).get('ref') || null;
}

async function logout() {
    setToken(null); state.user = null; state.chats = []; state.chatMessages = {}; state.currentChatId = null;
    if (state.socket) { state.socket.disconnect(); state.socket = null; }
    closeDashboard(); closeAdminPanel(); closeMessenger(); closeProfileEditor(); closeMyPortfolio(); closeUserFull(); closeContentEditor();
    updateUI(); loadProjects(); loadAllPortfolio();
    showToast('👋 Вы вышли');
}
async function afterLogin() { updateUI(); connectSocket(); await Promise.all([loadProjects(), loadAllPortfolio(), loadChats()]); }

/* UI */
function updateUI() {
    const u = state.user;
    const loginBtn = document.getElementById('loginBtn'), userBox = document.getElementById('userBox');
    const adminBtn = document.getElementById('adminBtn'), adminMenuLink = document.getElementById('adminMenuLink');
    const msgrFab = document.getElementById('msgrFab'), createProjectBtn = document.getElementById('createProjectBtn');
    const contentLink = document.getElementById('contentMenuLink');

    if (u) {
        loginBtn.classList.add('hidden'); userBox.classList.remove('hidden'); msgrFab.classList.remove('hidden');
        document.getElementById('userName').textContent = u.name;
        document.getElementById('userRole').textContent = ROLE_LABELS[u.role] || u.role;
        document.getElementById('balanceChip').textContent = formatMoney(u.balance);
        document.getElementById('dashName').textContent = u.name;
        document.getElementById('dashRole').textContent = ROLE_LABELS[u.role] || u.role;
        document.getElementById('dashBalance').textContent = formatMoney(u.balance);
        document.getElementById('roleCurrentValue').textContent = ROLE_LABELS[u.role] || u.role;

        const avatarEl = document.getElementById('dashAvatar'), userAvatarEl = document.getElementById('userAvatar');
        if (u.avatar) {
            avatarEl.innerHTML = `<img src="${escapeHtml(u.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
            userAvatarEl.innerHTML = `<img src="${escapeHtml(u.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        } else {
            avatarEl.textContent = u.name.charAt(0).toUpperCase();
            userAvatarEl.innerHTML = `<span id="userInitial">${u.name.charAt(0).toUpperCase()}</span>`;
        }

        const pendingBlock = document.getElementById('rolePending'), requestBlock = document.getElementById('roleRequestBlock');
        if (u.requestedRole) { pendingBlock.classList.remove('hidden'); requestBlock.classList.add('hidden'); document.getElementById('rolePendingText').textContent = `Заявка на роль «${ROLE_LABELS[u.requestedRole]}» на рассмотрении`; }
        else if (u.role === 'admin') { pendingBlock.classList.add('hidden'); requestBlock.classList.add('hidden'); }
        else { pendingBlock.classList.add('hidden'); requestBlock.classList.remove('hidden'); }

        const canEditSite = u.role === 'admin' || u.role === 'manager';
        if (u.role === 'admin') {
            adminBtn.classList.remove('hidden'); adminMenuLink.classList.remove('hidden');
            const isRoot = u.isRoot === true || Number(u.isRoot ?? u.is_root ?? 0) === 1;
            const editorAdminButton = document.getElementById('contentEditorAdminButton');
            adminBtn.style.background = isRoot ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' : '';
            adminBtn.title = isRoot ? '👑 Главный админ' : 'Админ';
            if (contentLink) contentLink.classList.remove('hidden');
            if (editorAdminButton) editorAdminButton.classList.remove('hidden');
        } else {
            adminBtn.classList.add('hidden'); adminMenuLink.classList.add('hidden');
            if (contentLink) contentLink.classList.toggle('hidden', !canEditSite);
            const editorAdminButton = document.getElementById('contentEditorAdminButton');
            if (editorAdminButton) editorAdminButton.classList.toggle('hidden', !canEditSite);
        }
        if (u.role === 'executor') createProjectBtn.classList.add('hidden'); else createProjectBtn.classList.remove('hidden');
    } else {
        loginBtn.classList.remove('hidden'); userBox.classList.add('hidden');
        adminBtn.classList.add('hidden'); adminMenuLink.classList.add('hidden'); msgrFab.classList.add('hidden');
        if (contentLink) contentLink.classList.add('hidden');
        const editorAdminButton = document.getElementById('contentEditorAdminButton');
        if (editorAdminButton) editorAdminButton.classList.add('hidden');
    }
}
function toggleUserMenu() { document.getElementById('userMenu').classList.toggle('hidden'); }
function isAnyModalOpen() {
    return ['adminModal','authModal','moneyModal','dashboardModal','profileModal','projectModal','projectDetailModal','myPortfolioModal','userFullModal','contentModal','packageModal']
        .some(id => document.getElementById(id)?.classList.contains('open'));
}

async function fetchMe() {
    if (!getToken()) return;
    try {
        const { user } = await api('/api/me');
        state.user = user; updateUI(); connectSocket();
        await Promise.all([loadProjects(), loadAllPortfolio(), loadChats()]);
    } catch {
        setToken(null); state.user = null; updateUI(); loadProjects(); loadAllPortfolio();
    }
}

/* CONTENT */
async function loadAndApplyContent() {
    try { const { content } = await api('/api/content'); state.content = content; applyContent(content); }
    catch (err) { console.warn('Контент не загружен:', err.message); }
}
function applyContent(c) {
    if (!c) return;
    ['hero_eyebrow','hero_title','hero_subtitle','hero_badge_1','hero_badge_2','hero_badge_3'].forEach(k => setText(`[data-content="${k}"]`, c[k]));
    if (c.hero_image) {
        const heroBg = document.querySelector('.hero-bg');
        if (heroBg) {
            heroBg.style.backgroundImage = `url("${String(c.hero_image).replace(/["\\\\]/g, '')}")`;
            heroBg.style.backgroundSize = 'cover';
            heroBg.style.backgroundPosition = 'center';
        }
    }
    for (let i = 1; i <= 7; i++) {
        setText(`[data-content="service_${i}_name"]`, c[`service_${i}_name`]);
        setText(`[data-content="service_${i}_desc"]`, c[`service_${i}_desc`]);
        setText(`[data-content="service_${i}_price"]`, c[`service_${i}_price`]);
        const servicePrice = String(c[`service_${i}_price`] ?? '').trim();
        const priceNode = document.querySelector(`[data-content="service_${i}_price"]`);
        const serviceCard = priceNode?.closest('.service-card');
        if (serviceCard && servicePrice) {
            serviceCard.dataset.price = servicePrice;
            const numericPrice = Number(servicePrice.replace(/[^0-9,\.]/g, '').replace(',', '.'));
            if (Number.isFinite(numericPrice) && numericPrice > 0) serviceCard.dataset.unitPrice = String(numericPrice);
        }
        const serviceName = c[`service_${i}_name`];
        const serviceDesc = c[`service_${i}_desc`];
        if (serviceCard && serviceName) serviceCard.dataset.service = serviceName;
        if (serviceCard && serviceDesc) serviceCard.dataset.detail = serviceDesc;
        const image = document.querySelector(`[data-content="service_${i}_image"]`);
        if (image && c[`service_${i}_image`]) {
            if (image.matches('img')) image.src = c[`service_${i}_image`];
            else image.style.backgroundImage = `url("${String(c[`service_${i}_image`]).replace(/["\\\\]/g, '')}")`;
        }
    }
    for (let i = 1; i <= 5; i++) {
        setText(`[data-content="pricing_${i}_name"]`, c[`pricing_${i}_name`]);
        setText(`[data-content="pricing_${i}_price"]`, c[`pricing_${i}_price`]);
        const features = (c[`pricing_${i}_features`] || '').split('|').filter(Boolean);
        const ul = document.querySelector(`[data-content="pricing_${i}_features"]`);
        if (ul && features.length) ul.innerHTML = features.map(f => `<li><i class="fas fa-check"></i> ${escapeHtml(f.trim())}</li>`).join('');
    }
    ['about_text','about_quote','about_stat_1','about_stat_1_desc','about_stat_2','about_stat_2_desc','about_stat_3','about_stat_3_desc'].forEach(k => setText(`[data-content="${k}"]`, c[k]));
    setText('[data-content="contact_discord"]', c.contact_discord);
    setText('[data-content="contact_telegram"]', c.contact_telegram);
    setText('[data-content="contact_email"]', c.contact_email);
    setText('[data-content="footer_text"]', c.footer_text);
    for (let i = 1; i <= 5; i++) {
        setText(`[data-content="faq_${i}_q"]`, c[`faq_${i}_q`]);
        setText(`[data-content="faq_${i}_a"]`, c[`faq_${i}_a`]);
    }
}
function setText(selector, value) { if (value === undefined || value === null) return; const el = document.querySelector(selector); if (el) el.textContent = value; }

/* CONTENT EDITOR */
const CONTENT_FIELDS = [
    { section: '🎨 Hero', fields: [
        { key: 'hero_eyebrow', label: 'Надзаголовок' }, { key: 'hero_title', label: 'Заголовок' },
        { key: 'hero_subtitle', label: 'Подзаголовок', type: 'textarea' },
        { key: 'hero_badge_1', label: 'Бейдж 1' }, { key: 'hero_badge_2', label: 'Бейдж 2' }, { key: 'hero_badge_3', label: 'Бейдж 3' },
        { key: 'hero_image', label: 'Фоновое изображение', type: 'image' },
    ]},
    { section: '🛠 Услуги', fields: Array.from({ length: 7 }, (_, i) => { const n = i + 1; return [
        { key: `service_${n}_name`, label: `Услуга ${n} — название` }, { key: `service_${n}_desc`, label: `Услуга ${n} — описание`, type: 'textarea' }, { key: `service_${n}_price`, label: `Услуга ${n} — цена` }, { key: `service_${n}_image`, label: `Услуга ${n} — изображение`, type: 'image' },
    ]; }).flat() },
    { section: '💰 Тарифы', fields: Array.from({ length: 5 }, (_, i) => { const n = i + 1; return [
        { key: `pricing_${n}_name`, label: `Тариф ${n} — название` }, { key: `pricing_${n}_price`, label: `Тариф ${n} — цена` }, { key: `pricing_${n}_features`, label: `Тариф ${n} — фичи (через |)`, type: 'textarea' },
    ]; }).flat() },
    { section: '👥 О нас', fields: [
        { key: 'about_text', label: 'Текст', type: 'textarea' }, { key: 'about_quote', label: 'Цитата', type: 'textarea' },
        { key: 'about_stat_1', label: 'Цифра 1' }, { key: 'about_stat_1_desc', label: 'Подпись 1' },
        { key: 'about_stat_2', label: 'Цифра 2' }, { key: 'about_stat_2_desc', label: 'Подпись 2' },
        { key: 'about_stat_3', label: 'Цифра 3' }, { key: 'about_stat_3_desc', label: 'Подпись 3' },
    ]},
    { section: '📞 Контакты', fields: [{ key: 'contact_discord', label: 'Discord' }, { key: 'contact_telegram', label: 'Telegram' }, { key: 'contact_email', label: 'Email' }] },
    { section: '❓ FAQ', fields: Array.from({ length: 5 }, (_, i) => { const n = i + 1; return [{ key: `faq_${n}_q`, label: `Вопрос ${n}` }, { key: `faq_${n}_a`, label: `Ответ ${n}`, type: 'textarea' }]; }).flat() },
    { section: '📄 Footer', fields: [{ key: 'footer_text', label: 'Текст под логотипом' }] },
];

async function openContentEditor() {
    if (!state.user) return openAuth();
    if (!['admin', 'manager'].includes(state.user.role)) return showToast('⛔ Нет доступа к редактору сайта', 'error');

    const modal = document.getElementById('contentModal');
    if (!modal) return showToast('❌ Окно редактора не найдено', 'error');

    try {
        const { content } = await api('/api/content');
        state.content = content || {};
    } catch (err) {
        showToast('❌ Не удалось загрузить редактор: ' + err.message, 'error');
        return;
    }

    renderContentEditor();
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('userMenu')?.classList.add('hidden');
}
function closeContentEditor() {
    document.getElementById('contentModal')?.classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
}

function renderContentEditor() {
    const c = state.content || {};
    const wrap = document.getElementById('contentEditorWrap');
    if (!wrap) return;
    wrap.innerHTML = CONTENT_FIELDS.map(group => `
        <section class="content-group">
            <h4 class="content-group-title">${escapeHtml(group.section)}</h4>
            ${group.fields.map(f => {
                const val = c[f.key] ?? '';
                const label = escapeHtml(f.label);
                const key = escapeHtml(f.key);
                if (f.type === 'textarea') return `<label class="content-label">${label}<textarea data-content-key="${key}" class="content-input">${escapeHtml(val)}</textarea></label>`;
                if (f.type === 'image') return `<div class="content-label"><span>${label}</span><div class="content-image-row"><input type="text" data-content-key="${key}" class="content-input" value="${escapeHtml(val)}" placeholder="/uploads/content/..." /><input type="file" id="content-img-${key}" accept="image/png,image/jpeg,image/webp,image/gif" hidden onchange="uploadContentImage(event, '${key}')" /><button type="button" class="btn btn-outline" onclick="document.getElementById('content-img-${key}').click()" aria-label="Загрузить изображение"><i class="fas fa-camera"></i></button></div><img data-content-preview="${key}" src="${escapeHtml(val)}" alt="" ${val ? '' : 'hidden'} style="max-width:200px;max-height:140px;object-fit:contain;margin-top:8px;border-radius:8px;"></div>`;
                return `<label class="content-label">${label}<input type="text" data-content-key="${key}" class="content-input" value="${escapeHtml(val)}" /></label>`;
            }).join('')}
        </section>
    `).join('');
}
async function uploadContentImage(e, key) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type) || file.size > 5 * 1024 * 1024) {
        showToast('Выберите PNG, JPG, WEBP или GIF до 5 МБ', 'error');
        e.target.value = '';
        return;
    }
    const fd = new FormData();
    fd.append('image', file);
    const input = document.querySelector(`#contentEditorWrap [data-content-key="${key}"]`);
    const preview = document.querySelector(`#contentEditorWrap [data-content-preview="${key}"]`);
    try {
        const { url } = await api('/api/admin/content/upload', { method: 'POST', body: fd });
        if (input) input.value = url;
        if (preview) { preview.src = url; preview.hidden = false; }
        showToast('✅ Картинка загружена. Нажмите «Сохранить всё»');
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    } finally {
        e.target.value = '';
    }
}
async function saveContent() {
    const inputs = document.querySelectorAll('#contentEditorWrap [data-content-key]');
    const updates = {};
    inputs.forEach(input => { updates[input.dataset.contentKey] = input.value.trim(); });
    const btn = document.getElementById('contentSaveBtn');
    if (!btn) return;
    btn.disabled = true;
    const oldLabel = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохраняем…';
    try {
        const result = await api('/api/admin/content', { method: 'POST', body: { updates } });
        state.content = { ...(state.content || {}), ...updates };
        applyContent(state.content);
        showToast(`✅ Контент сохранён (${result.count ?? Object.keys(updates).length} полей)`);
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = oldLabel;
    }
}

/* PACKAGE CONFIGURATOR */
const PACKAGES = {
    ds: { title: 'Пак DS', items: [
        { id: 'avatar',  name: 'Ава',                       price: 1200, min: 0, max: 5,  default: 1  },
        { id: 'banner',  name: 'Баннер (сезонный)',         price: 1500, min: 0, max: 12, default: 3  },
        { id: 'sticker', name: 'Стикер',                    price: 300,  min: 0, max: 30, default: 10 },
        { id: 'mascot',  name: 'Маскот',                    price: 4000, min: 0, max: 3,  default: 1  },
        { id: 'roles',   name: 'Настройка ролей и каналов', price: 2000, min: 0, max: 1,  default: 1  },
        { id: 'boost',   name: 'Буст',                      price: 250,  min: 0, max: 50, default: 18 },
    ]},
    streamer: { title: 'Пак стримера', items: [
        { id: 'model2d', name: '2D моделька', price: 6000, min: 0, max: 2,  default: 1 },
        { id: 'emoji',   name: 'Эмодзи',      price: 400,  min: 0, max: 20, default: 5 },
        { id: 'art',     name: 'Арт',         price: 1500, min: 0, max: 10, default: 3 },
        { id: 'overlay', name: 'Оверлей',     price: 2500, min: 0, max: 10, default: 4 },
    ]},
    // Возвращены только комплекты без прямого дубля самостоятельных услуг.
    brand: { title: 'Пак «Бренд»', items: [
        { id: 'brand-mascot',  name: 'Маскот',  price: 4000, min: 0, max: 1,  default: 1 },
        { id: 'brand-sticker', name: 'Стикер',  price: 300,  min: 0, max: 30, default: 10 },
        { id: 'brand-overlay', name: 'Оверлей', price: 3000, min: 0, max: 3,  default: 1 },
    ]},
    full: { title: 'Пак «Под ключ»', items: [
        { id: 'full-mascot',    name: 'Маскот',   price: 4000, min: 0, max: 1,  default: 1 },
        { id: 'full-sticker',   name: 'Стикер',   price: 300,  min: 0, max: 30, default: 10 },
        { id: 'full-overlay',   name: 'Оверлей',  price: 3000, min: 0, max: 3,  default: 1 },
        { id: 'full-banner',    name: 'Баннер',   price: 1500, min: 0, max: 5,  default: 2 },
        { id: 'full-animation', name: 'Анимация', price: 5000, min: 0, max: 2,  default: 1 },
    ]},
};

let currentPackageId = null;
let currentPackageConfig = {};

function openPackageConfigurator(packageId) {
    if (!state.user) return openAuth();
    const pkg = PACKAGES[packageId]; if (!pkg) return;
    currentPackageId = packageId; currentPackageConfig = {};
    pkg.items.forEach(item => { currentPackageConfig[item.id] = item.default; });
    document.getElementById('packageTitle').textContent = pkg.title;
    renderPackageConfigurator();
    document.getElementById('packageModal').classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closePackageConfigurator() { document.getElementById('packageModal').classList.remove('open'); if (!isAnyModalOpen()) document.body.style.overflow = ''; }
function renderPackageConfigurator() {
    const pkg = PACKAGES[currentPackageId]; if (!pkg) return;
    document.getElementById('packageConfigurator').innerHTML = pkg.items.map(item => `
        <div class="package-item">
            <div class="package-item-info"><span class="package-item-name">${item.name}</span><span class="package-item-price">${formatMoney(item.price * 100)} / шт.</span></div>
            <div class="package-item-controls"><button type="button" onclick="changePackageItem('${item.id}', -1)">−</button><span class="package-item-count" id="count-${item.id}">${currentPackageConfig[item.id]}</span><button type="button" onclick="changePackageItem('${item.id}', 1)">+</button></div>
        </div>
    `).join('');
    updatePackageTotal();
}
function changePackageItem(itemId, delta) {
    const pkg = PACKAGES[currentPackageId]; const item = pkg.items.find(i => i.id === itemId); if (!item) return;
    let v = currentPackageConfig[itemId] + delta;
    if (v < item.min) v = item.min; if (v > item.max) v = item.max;
    currentPackageConfig[itemId] = v;
    document.getElementById(`count-${itemId}`).textContent = v;
    updatePackageTotal();
}
function updatePackageTotal() {
    const pkg = PACKAGES[currentPackageId]; if (!pkg) return;
    let total = 0;
    pkg.items.forEach(item => { total += item.price * (currentPackageConfig[item.id] || 0); });
    document.getElementById('packageTotalPrice').textContent = formatMoney(total * 100);
}
function orderCustomPackage() {
    const pkg = PACKAGES[currentPackageId]; if (!pkg) return;
    let total = 0; const details = [];
    pkg.items.forEach(item => {
        const count = currentPackageConfig[item.id] || 0;
        if (count > 0) {
            total += item.price * count;
            details.push(`${item.name}: ${count} шт. — ${formatMoney(item.price * count * 100)}`);
        }
    });
    if (!details.length) return showToast('⚠️ Добавьте хотя бы один элемент в пак', 'error');

    const titleInput = document.getElementById('projTitle');
    const description = document.getElementById('projDescription');
    const category = document.getElementById('projCategory');
    if (titleInput) titleInput.value = pkg.title;
    if (description) description.value = `Состав пакета «${pkg.title}»:\n${details.join('\n')}\n\nПредварительная стоимость: ${formatMoney(total * 100)}. Итоговую стоимость и сроки согласуем перед началом работы.`;
    if (category) category.value = 'Другое';

    closePackageConfigurator();
    showToast(`✅ ${pkg.title} добавлен в заявку — ${formatMoney(total * 100)}`);
    if (typeof openProjectCreator === 'function') openProjectCreator();
    else document.getElementById('projects')?.scrollIntoView({ behavior: 'smooth' });
}

/* DASHBOARD */
function openDashboard() { if (!state.user) return openAuth(); document.getElementById('dashboardModal').classList.add('open'); document.body.style.overflow = 'hidden'; document.getElementById('userMenu').classList.add('hidden'); loadDashboardData(); }
function closeDashboard() { document.getElementById('dashboardModal').classList.remove('open'); if (!isAnyModalOpen()) document.body.style.overflow = ''; }
function switchDashTab(tab) {
    document.querySelectorAll('.dash-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.dtab === tab);
    });

    const panels = {
        wallet: document.getElementById('dashWallet'),
        withdrawals: document.getElementById('dashWithdrawals'),
        history: document.getElementById('dashHistory'),
        role: document.getElementById('dashRolePanel')
    };
    Object.entries(panels).forEach(([name, panel]) => {
        if (panel) panel.classList.toggle('hidden', name !== tab);
    });

    const showWalletExtras = tab === 'wallet';
    ['pawUpgradeTabs', 'pawUpgradePanels'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.classList.toggle('hidden', !showWalletExtras);
    });
}
async function loadDashboardData() {
    updateUI();
    try { const [txRes, wdRes] = await Promise.all([api('/api/wallet/transactions'), api('/api/wallet/withdrawals')]); state.transactions = txRes.transactions; state.userWithdrawals = wdRes.withdrawals; renderTransactions(); renderWalletStats(); renderUserWithdrawals(); }
    catch (err) { showToast('❌ ' + err.message, 'error'); }
}
function renderWalletStats() { const totalIn = state.transactions.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0); const totalOut = state.transactions.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0); const userId = Number(state.user?.id); const userProjects = userId ? state.projects.filter(p => Number(p.client_id ?? p.clientId ?? p.client?.id) === userId || Number(p.executor_id ?? p.executorId ?? p.executor?.id) === userId) : []; document.getElementById('wsIn').textContent = formatMoney(totalIn); document.getElementById('wsOut').textContent = formatMoney(totalOut); document.getElementById('wsProjects').textContent = userProjects.length; }
function renderTransactions() {
    const list = document.getElementById('txList'); if (!list) return;
    if (!state.transactions.length) { list.innerHTML = '<div class="tx-empty">Пока нет операций</div>'; return; }
    list.innerHTML = state.transactions.map(tx => { const dateStr = formatDateTime(tx.date); const sign = tx.type === 'in' ? '+' : '−'; const icon = tx.type === 'in' ? 'fa-arrow-down' : 'fa-arrow-up'; return `<div class="tx-row"><div class="tx-icon ${tx.type}"><i class="fas ${icon}"></i></div><div class="tx-info"><div class="tx-title">${escapeHtml(tx.title)}</div><div class="tx-date">${dateStr}</div></div><div class="tx-amount ${tx.type}">${sign} ${formatMoney(tx.amount)}</div></div>`; }).join('');
}
function renderUserWithdrawals() {
    const list = document.getElementById('userWithdrawalsList'); if (!list) return;
    if (!state.userWithdrawals.length) { list.innerHTML = '<div class="tx-empty">Пока нет заявок</div>'; return; }
    list.innerHTML = state.userWithdrawals.map(w => { const cls = WD_STATUS_CLASS[w.status] || 'status-review'; const comment = w.comment ? `<div class="wd-comment">💬 ${escapeHtml(w.comment)}</div>` : ''; const card = w.cardNumber ? `<div class="wd-date">💳 ${escapeHtml(w.cardNumber)}</div>` : ''; return `<div class="withdrawal-card"><div class="wd-head"><div class="wd-amount">${formatMoney(w.amount)}</div><span class="project-status ${cls}">${WD_STATUS[w.status]}</span></div>${card}<div class="wd-date">Создано: ${formatDateTime(w.createdAt)}</div>${w.reviewedAt ? `<div class="wd-date">Рассмотрено: ${formatDateTime(w.reviewedAt)}</div>` : ''}${comment}</div>`; }).join('');
}
async function requestRole(role) {
    if (!state.user) return openAuth();
    try { const { user } = await api('/api/role/request', { method: 'POST', body: { role } }); state.user = user; updateUI(); showToast(`✅ Заявка отправлена`); }
    catch (err) { showToast('❌ ' + err.message, 'error'); }
}

/* MONEY */
function openDeposit() {
    state.moneyMode = 'deposit';
    document.getElementById('moneyTitle').textContent = 'Пополнение баланса';
    document.getElementById('moneySub').textContent = 'Выберите сумму или введите свою';
    document.getElementById('moneyNote').innerHTML = 'Комиссия <strong>0%</strong>. Оплата через ЮKassa.';
    document.getElementById('moneySubmit').textContent = 'Перейти к оплате';
    document.getElementById('moneyAmount').value = '';
    document.getElementById('moneyCardBlock').classList.add('hidden');
    document.getElementById('moneyAmount').min = 1;
    document.getElementById('moneyModal').classList.add('open');
    document.body.style.overflow = 'hidden';
}
function openWithdraw() {
    state.moneyMode = 'withdraw';
    document.getElementById('moneyTitle').textContent = 'Заявка на вывод';
    document.getElementById('moneySub').textContent = 'Админ подтвердит вручную';
    document.getElementById('moneyNote').innerHTML = 'Комиссия <strong>0%</strong>. Минимум <strong>1 ₽</strong>.';
    document.getElementById('moneySubmit').textContent = 'Отправить заявку';
    document.getElementById('moneyAmount').value = '';
    document.getElementById('moneyCard').value = '';
    document.getElementById('moneyCardBlock').classList.remove('hidden');
    document.getElementById('moneyAmount').min = 1;
    document.getElementById('moneyModal').classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeMoney() { document.getElementById('moneyModal').classList.remove('open'); if (!isAnyModalOpen()) document.body.style.overflow = ''; }
function setMoney(n) { document.getElementById('moneyAmount').value = n; }
async function submitMoney() {
    if (!state.user) return;
    const amount = Number(document.getElementById('moneyAmount').value);
    if (!amount || isNaN(amount) || amount <= 0) return showToast('⚠️ Введите сумму', 'error');
    if (amount < 1) return showToast('⚠️ Минимум 1 ₽', 'error');

    const btn = document.getElementById('moneySubmit'); btn.disabled = true; const oldText = btn.textContent;
    try {
        if (state.moneyMode === 'withdraw') {
            const cardNumber = document.getElementById('moneyCard').value.replace(/\s/g, '');
            if (cardNumber.length < 16) { showToast('⚠️ Введите корректный номер карты (16 цифр)', 'error'); btn.disabled = false; return; }
            const { user } = await api('/api/wallet/withdraw', { method: 'POST', body: { amount, cardNumber } });
            state.user = user; updateUI(); closeMoney(); await loadDashboardData();
            showToast(`⏳ Заявка на вывод отправлена`);
        } else {
            btn.textContent = 'Создаём платёж...';
            const { confirmationUrl } = await api('/api/payments/create', { method: 'POST', body: { amount } });
            closeMoney();
            showToast('🔄 Перенаправляем на ЮKassa...');
            setTimeout(() => { window.location.href = confirmationUrl; }, 800);
        }
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = oldText; }
}

/* PROFILE */
function openProfileEditor() {
    if (!state.user) return openAuth();
    const u = state.user;
    document.getElementById('profileName').value = u.name;
    document.getElementById('profileBio').value = u.bio || '';
    document.getElementById('profileCurrentPass').value = '';
    document.getElementById('profileNewPass').value = '';
    const preview = document.getElementById('avatarPreview');
    if (u.avatar) preview.innerHTML = `<img src="${escapeHtml(u.avatar)}" alt="">`; else preview.textContent = u.name.charAt(0).toUpperCase();
    document.getElementById('profileModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('userMenu').classList.add('hidden');
}
function closeProfileEditor() { document.getElementById('profileModal').classList.remove('open'); if (!isAnyModalOpen()) document.body.style.overflow = ''; }
async function handleProfileUpdate(e) {
    e.preventDefault();
    const name = document.getElementById('profileName').value.trim();
    const bio = document.getElementById('profileBio').value.trim();
    const currentPassword = document.getElementById('profileCurrentPass').value;
    const newPassword = document.getElementById('profileNewPass').value;
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    try { const { user } = await api('/api/profile/update', { method: 'POST', body: { name, bio, currentPassword, newPassword } }); state.user = user; updateUI(); closeProfileEditor(); showToast('✅ Профиль обновлён'); }
    catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { btn.disabled = false; }
}
async function uploadAvatar(e) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) return showToast('❌ Максимум 5 МБ', 'error');
    const fd = new FormData(); fd.append('avatar', file);
    try { const { user } = await api('/api/profile/avatar', { method: 'POST', body: fd }); state.user = user; updateUI(); document.getElementById('avatarPreview').innerHTML = `<img src="${escapeHtml(user.avatar)}" alt="">`; showToast('✅ Аватар обновлён'); }
    catch (err) { showToast('❌ ' + err.message, 'error'); }
    e.target.value = '';
}

/* PROJECTS */
function normalizeProject(p) {
    if (!p || typeof p !== 'object') return p;
    const client = p.client && typeof p.client === 'object' ? p.client : {};
    const executor = p.executor && typeof p.executor === 'object' ? p.executor : {};
    const clientId = p.clientId ?? p.client_id ?? client.id ?? 0;
    const executorId = p.executorId ?? p.executor_id ?? executor.id ?? null;
    return {
        ...p, clientId, executorId,
        client: { id: client.id ?? clientId, name: client.name || p.client_name || 'Пользователь', avatar: client.avatar ?? p.client_avatar ?? null },
        executor: executorId ? { id: executor.id ?? executorId, name: executor.name || p.executor_name || 'Исполнитель', avatar: executor.avatar ?? p.executor_avatar ?? null } : null,
    };
}
async function loadProjects() {
    const list = document.getElementById('projectsList'); if (!list) return;
    if (!state.user) { list.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>Войдите, чтобы увидеть заказы</p></div>`; return; }
    try {
        const data = await api('/api/projects');
        state.projects = (Array.isArray(data?.projects) ? data.projects : []).map(normalizeProject);
        renderProjects();
    } catch (err) {
        list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escapeHtml(err.message)}</p></div>`;
    }
}
function renderProjects() {
    const list = document.getElementById('projectsList'); if (!list) return;
    let items = state.projects;
    if (state.projectFilter !== 'all') items = items.filter(p => p.status === state.projectFilter);
    if (!items.length) { list.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>${state.projects.length ? 'Пусто' : 'Нет заказов'}</p></div>`; return; }
    list.innerHTML = items.map(p => {
        const userId = Number(state.user?.id);
        const clientId = Number(p.clientId ?? p.client_id);
        const executorId = Number(p.executor?.id ?? p.executorId ?? p.executor_id);
        const isClient = state.user?.role === 'client';
        const isExecutor = state.user?.role === 'executor';
        const isPrivileged = state.user?.role === 'admin' || state.user?.role === 'manager';
        const canTake = isExecutor && p.status === 'open' && !p.executor;
        const canOpen = isPrivileged || (isClient && clientId === userId) || (isExecutor && (p.status === 'open' || executorId === userId));
        // Старые/неполные записи могут не содержать объект client — карточка всё равно должна отображаться.
        const client = p.client && typeof p.client === 'object' ? p.client : {};
        const clientName = typeof (client.name || p.client_name) === 'string' && (client.name || p.client_name).trim()
            ? (client.name || p.client_name).trim() : 'Пользователь';
        const clientAvatarUrl = client.avatar ?? p.client_avatar ?? null;
        const clientAvatar = clientAvatarUrl ? `<img src="${escapeHtml(clientAvatarUrl)}" alt="">` : escapeHtml(clientName.charAt(0).toUpperCase() || 'П');
        return `<div class="project-card" onclick="${canOpen ? `openProjectDetail(${p.id})` : `showToast('Возьмите в работу')`}"><div class="project-head"><div><div class="project-title">${escapeHtml(p.title || 'Без названия')}</div><div class="project-client"><span class="project-client-avatar">${clientAvatar}</span>${escapeHtml(clientName)}</div></div><span class="project-status status-${p.status}">${STATUS_LABELS[p.status] || p.status || 'Неизвестен'}</span></div><div class="project-desc">${escapeHtml(p.description || '')}</div><div class="project-meta"><span class="project-category">${escapeHtml(p.category || 'Без категории')}</span><span class="project-budget">${p.budget > 0 ? formatMoney(p.budget) : '—'}</span></div>${p.executor ? `<div class="project-executor" style="margin-top:8px">Исполнитель: <b>${escapeHtml(p.executor.name || 'Исполнитель')}</b></div>` : ''}${canTake ? `<div class="project-actions"><button class="project-act-btn primary" onclick="event.stopPropagation(); acceptProject(${p.id})"><i class="fas fa-hand-paper"></i> Взять</button></div>` : ''}</div>`;
    }).join('');
}
function filterProjects(status) { state.projectFilter = status; document.querySelectorAll('#projectFilters .filter').forEach(b => b.classList.toggle('active', b.dataset.status === status)); renderProjects(); }
function openProjectCreator() { if (!state.user) return openAuth(); if (state.user.role === 'executor') return showToast('⚠️ Исполнители не создают заказы', 'error'); document.getElementById('projectModal').classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeProjectCreator() { document.getElementById('projectModal').classList.remove('open'); if (!isAnyModalOpen()) document.body.style.overflow = ''; }
async function handleProjectCreate(e) {
    e.preventDefault();
    const title = document.getElementById('projTitle').value.trim();
    const description = document.getElementById('projDescription').value.trim();
    const category = document.getElementById('projCategory').value;
    // Бюджет больше не запрашивается в форме; поле оставлено необязательным для API-совместимости.
    const budgetInput = document.getElementById('projBudget');
    const budget = budgetInput ? (Number(budgetInput.value) || 0) : 0;
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    try { await api('/api/projects', { method: 'POST', body: { title, description, category, budget } }); closeProjectCreator(); e.target.reset(); await loadProjects(); showToast('✅ Заказ создан'); }
    catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { btn.disabled = false; }
}
async function acceptProject(id) { try { await api(`/api/projects/${id}/accept`, { method: 'POST' }); await loadProjects(); showToast('✅ Взято в работу'); } catch (err) { showToast('❌ ' + err.message, 'error'); } }
async function openProjectDetail(id) {
    try {
        const { project } = await api(`/api/projects/${id}`);
        const normalized = normalizeProject(project);
        state.currentProject = normalized;
        renderProjectDetail(normalized);
        document.getElementById('projectDetailModal').classList.add('open');
        document.body.style.overflow = 'hidden';
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
function closeProjectDetail() { document.getElementById('projectDetailModal').classList.remove('open'); if (!isAnyModalOpen()) document.body.style.overflow = ''; }
function renderProjectDetail(p) {
    const wrap = document.getElementById('projectDetailContent');
    if (!p || typeof p !== 'object' || !wrap) return;
    p = normalizeProject(p);
    const client = p.client && typeof p.client === 'object' ? p.client : {};
    const clientName = client.name || p.client_name || 'Пользователь';
    const isClient = Number(p.clientId ?? p.client_id) === Number(state.user?.id);
    const isExecutor = Number(p.executor?.id ?? p.executor_id) === Number(state.user?.id);
    const isAdmin = state.user?.role === 'admin' || state.user?.role === 'manager';
    const canChangeStatus = isClient || isExecutor || isAdmin;
    const statuses = ['open', 'in_progress', 'review', 'completed', 'cancelled'];
    wrap.innerHTML = `
        <div class="pd-title">${escapeHtml(p.title)}</div>
        <div style="margin-bottom:12px"><span class="project-status status-${p.status}">${STATUS_LABELS[p.status]}</span></div>
        <div class="pd-row"><span class="pd-label">Заказчик</span><span class="pd-value">${escapeHtml(clientName)}</span></div>
        <div class="pd-row"><span class="pd-label">Категория</span><span class="pd-value">${escapeHtml(p.category)}</span></div>
        <div class="pd-row"><span class="pd-label">Бюджет</span><span class="pd-value">${p.budget > 0 ? formatMoney(p.budget) : '—'}</span></div>
        ${p.executor ? `<div class="pd-row"><span class="pd-label">Исполнитель</span><span class="pd-value">${escapeHtml(p.executor.name)}</span></div>` : ''}
        <div class="pd-desc">${escapeHtml(p.description)}</div>
        <div class="pd-actions">${p.executor ? `<button class="btn btn-outline" onclick="openChatWith(${p.executor.id})"><i class="fas fa-comments"></i> Написать</button>` : ''}</div>
        ${canChangeStatus ? `<div class="section-divider"><span>Изменить статус</span></div><div class="pd-actions" style="flex-wrap:wrap">${statuses.filter(s => s !== p.status).map(s => `<button class="project-act-btn" onclick="changeStatus(${p.id}, '${s}')">${STATUS_LABELS[s]}</button>`).join('')}</div>` : ''}
    `;
}
async function changeStatus(id, status) { try { await api(`/api/projects/${id}/status`, { method: 'POST', body: { status } }); closeProjectDetail(); await loadProjects(); showToast('✅ Статус обновлён'); } catch (err) { showToast('❌ ' + err.message, 'error'); } }

/* PORTFOLIO */
async function loadAllPortfolio() {
    const wrap = document.getElementById('portfolioGallery');
    if (!wrap) return;

    try {
        const data = await api('/api/portfolio/all');
        state.allPortfolio = Array.isArray(data?.items)
            ? data.items.filter(item => item && typeof item === 'object')
            : [];
        renderAllPortfolio();
    } catch (err) {
        console.error('Не удалось загрузить портфолио:', err);
        state.allPortfolio = [];
        wrap.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-image"></i>
                <p>Работы появятся здесь</p>
            </div>`;
    }
}

async function openPublicProfile(userId) {
    const id = Number(userId);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const modal = document.getElementById('publicProfileModal');
    const content = document.getElementById('publicProfileContent');
    if (!modal || !content) return;
    content.innerHTML = '<div class="empty-state small"><i class="fas fa-spinner fa-spin"></i><p>Загрузка профиля…</p></div>';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    try {
        const data = await api('/api/users/' + id + '/public');
        const user = data?.user;
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!user) throw new Error('Пользователь не найден');
        const name = String(user.name || 'Пользователь');
        const avatar = String(user.avatar || '').trim();
        const bio = String(user.bio || '').trim();
        const avatarHtml = avatar
            ? '<img src="' + escapeHtml(avatar) + '" alt="" style="width:84px;height:84px;object-fit:cover;border-radius:50%">'
            : '<div class="avatar-preview" style="width:84px;height:84px;font-size:2rem">' + escapeHtml(name.charAt(0).toUpperCase()) + '</div>';
        const worksHtml = items.length
            ? '<div class="public-profile-works">' + items.map(item => {
                const title = escapeHtml(item.title || 'Без названия');
                const image = String(item.filename || '');
                return '<article class="my-portfolio-item" style="position:relative">' +
                    (image ? '<img src="' + escapeHtml(image) + '" alt="' + title + '" loading="lazy">' : '<div class="portfolio-image-placeholder">Изображение недоступно</div>') +
                    '<div style="padding:8px"><strong>' + title + '</strong>' +
                    (item.description ? '<p>' + escapeHtml(item.description) + '</p>' : '') +
                    '<small>' + escapeHtml(item.category || 'Другое') + '</small></div></article>';
            }).join('') + '</div>'
            : '<div class="empty-state small"><i class="fas fa-image"></i><p>У этого автора пока нет опубликованных работ</p></div>';
        content.innerHTML = '<div class="auth-head" style="display:flex;align-items:center;gap:16px;text-align:left">' +
            avatarHtml + '<div><h3 style="margin:0">' + escapeHtml(name) + '</h3>' +
            '<p style="margin:6px 0 0;color:var(--text-mute)">' + (bio ? escapeHtml(bio) : 'Публичный профиль автора') + '</p></div></div>' +
            '<h4 style="margin:22px 0 12px">Работы автора</h4>' + worksHtml;
    } catch (err) {
        content.innerHTML = '<div class="empty-state small"><i class="fas fa-user-slash"></i><p>' +
            escapeHtml(err.message || 'Не удалось загрузить профиль') + '</p></div>';
    }
}
function closePublicProfile() {
    const modal = document.getElementById('publicProfileModal');
    if (modal) modal.classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
}

function renderAllPortfolio() {
    const wrap = document.getElementById('portfolioGallery');
    if (!wrap) return;

    const allItems = Array.isArray(state.allPortfolio) ? state.allPortfolio : [];
    let items = allItems.filter(it => it && typeof it === 'object');

    if (state.portfolioFilter !== 'all') {
        items = items.filter(it => it.category === state.portfolioFilter);
    }

    if (!items.length) {
        wrap.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-image"></i>
                <p>Работы появятся здесь</p>
            </div>`;
        return;
    }

    wrap.innerHTML = items.map((it, i) => {
        const title = String(it.title || 'Без названия');
        const category = String(it.category || 'Другое');
        const authorName = String(it.authorName || 'Аноним');
        const avatar = String(it.authorAvatar || '').trim();
        const filename = String(it.filename || '').trim();
        const initial = escapeHtml(authorName.charAt(0).toUpperCase());

        const avatarHtml = avatar
            ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy"
                   onerror="this.style.display='none';this.nextElementSibling.classList.remove('hidden')">
               <span class="portfolio-author-initial hidden">${initial}</span>`
            : `<span class="portfolio-author-initial">${initial}</span>`;

        const imageHtml = filename
            ? `<img src="${escapeHtml(filename)}" alt="${escapeHtml(title)}"
                    loading="lazy"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
               <div class="portfolio-image-placeholder" style="display:none">
                   <i class="fas fa-image"></i><span>Изображение недоступно</span>
               </div>`
            : `<div class="portfolio-image-placeholder">
                   <i class="fas fa-image"></i><span>Изображение недоступно</span>
               </div>`;

        return `
            <div class="portfolio-item" onclick="openLightbox(${i})">
                <span class="portfolio-tag">${escapeHtml(category)}</span>
                ${imageHtml}
                <div class="portfolio-info">
                    <div class="portfolio-title">${escapeHtml(title)}</div>
                    <div class="portfolio-author">
                        <span class="project-client-avatar">${avatarHtml}</span>
                        ${Number.isSafeInteger(Number(it.authorUserId)) && Number(it.authorUserId) > 0
                            ? `<button type="button" class="portfolio-author-link" onclick="event.stopPropagation(); openPublicProfile(${Number(it.authorUserId)})" title="Открыть профиль автора">${escapeHtml(authorName)}</button>`
                            : `<span>${escapeHtml(authorName)}</span>`}
                    </div>
                </div>
            </div>`;
    }).join('');
}
function openLightbox(index) {
    let items = state.allPortfolio;
    if (state.portfolioFilter !== 'all') items = items.filter(i => i.category === state.portfolioFilter);
    const it = items[index]; if (!it) return;
    document.getElementById('lbImg').src = it.filename;
    document.getElementById('lbTitle').textContent = it.title;
    document.getElementById('lbDesc').textContent = `${it.category} · ${it.authorName || ''}${it.description ? ' · ' + it.description : ''}`;
    document.getElementById('lightbox').classList.add('open'); document.body.style.overflow = 'hidden';
}
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); if (!isAnyModalOpen()) document.body.style.overflow = ''; }
async function openMyPortfolio() {
    if (!state.user) return openAuth();

    const user = state.user;
    const isAdmin = user.role === 'admin' || user.isRoot === true || Number(user.is_root) === 1;
    const isEditor = user.role === 'manager';
    const isExecutor = user.role === 'executor';

    if (!isAdmin && !isEditor && !isExecutor) {
        return showToast('⚠️ Портфолио доступно редакторам, исполнителям и администраторам', 'error');
    }

    const modal = document.getElementById('myPortfolioModal');
    const isEditor = user.role === 'manager';
    const authorBlock = document.getElementById('adminAuthorBlock');
    if (authorBlock) authorBlock.classList.toggle('hidden', !isAdmin && !isEditor);

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('userMenu')?.classList.add('hidden');

    if (isAdmin || isEditor) await loadPortfolioAuthors();
    await loadMyPortfolio();
}

async function loadPortfolioAuthors() {
    const select = document.getElementById('portAuthorUser');
    if (!select) return;

    select.innerHTML = '<option value="">Указать автора вручную</option>';
    try {
        const data = await api('/api/users/list');
        const users = Array.isArray(data?.users) ? data.users : [];
        const currentUserId = Number(state.user?.id);
        let hasCurrentUser = false;
        for (const user of users) {
            const option = document.createElement('option');
            option.value = String(user.id);
            option.textContent = user.name || `Пользователь ${user.id}`;
            if (Number(user.id) === currentUserId) hasCurrentUser = true;
            select.appendChild(option);
        }
        if (currentUserId > 0 && !hasCurrentUser) {
            const option = document.createElement('option');
            option.value = String(currentUserId);
            option.textContent = state.user.name || 'Мой профиль';
            select.appendChild(option);
        }
        if (currentUserId > 0) select.value = String(currentUserId);
    } catch (err) {
        console.error('Не удалось загрузить авторов:', err);
        showToast('❌ Не удалось загрузить список авторов', 'error');
    }
    select.onchange = syncPortfolioAuthor;
    syncPortfolioAuthor();
}

function syncPortfolioAuthor() {
    const select = document.getElementById('portAuthorUser');
    const input = document.getElementById('portAuthorName');
    if (!select || !input) return;

    const selected = select.options[select.selectedIndex];
    if (select.value) {
        input.value = selected?.textContent || '';
        input.readOnly = true;
    } else {
        input.readOnly = false;
        input.value = '';
    }
}
function closeMyPortfolio() { document.getElementById('myPortfolioModal').classList.remove('open'); if (!isAnyModalOpen()) document.body.style.overflow = ''; }
async function loadMyPortfolio() { try { const { items } = await api('/api/portfolio/me'); state.myPortfolio = items; renderMyPortfolio(); } catch (err) { showToast('❌ ' + err.message, 'error'); } }
function renderMyPortfolio() {
    const grid = document.getElementById('myPortfolioGrid'); if (!grid) return;
    if (!state.myPortfolio.length) { grid.innerHTML = `<div class="empty-state small"><i class="fas fa-image"></i><p>Пока нет работ</p></div>`; return; }
    grid.innerHTML = state.myPortfolio.map(it => `<div class="my-portfolio-item"><img src="${escapeHtml(it.filename)}" alt="${escapeHtml(it.title)}"><button class="my-portfolio-delete" onclick="deletePortfolioItem(${it.id})">×</button></div>`).join('');
}
function previewPortfolioFile(e) { const f = e.target.files?.[0]; if (!f) return; if (f.size > 5 * 1024 * 1024) { showToast('❌ Максимум 5 МБ', 'error'); e.target.value = ''; return; } document.getElementById('uploadZoneText').textContent = f.name; }
async function handlePortfolioUpload(e) {
    e.preventDefault();

    const user = state.user;
    if (!user) return showToast('⚠️ Сначала войдите в аккаунт', 'error');

    const isAdmin = user.role === 'admin' || user.isRoot === true || Number(user.is_root) === 1;
    const isEditor = user.role === 'manager';
    const isExecutor = user.role === 'executor';
    if (!isAdmin && !isEditor && !isExecutor) return showToast('❌ Недостаточно прав', 'error');

    const form = e.currentTarget;
    const fileInput = document.getElementById('portfolioInput');
    const file = fileInput?.files?.[0];
    if (!file) return showToast('⚠️ Выберите изображение', 'error');
    if (file.size > 5 * 1024 * 1024) return showToast('⚠️ Максимальный размер — 5 МБ', 'error');

    const title = document.getElementById('portTitle').value.trim();
    const description = document.getElementById('portDescription').value.trim();
    const category = document.getElementById('portCategory').value;
    if (!title) return showToast('⚠️ Укажите название работы', 'error');

    const fd = new FormData();
    fd.append('image', file);
    fd.append('title', title);
    fd.append('description', description);
    fd.append('category', category);

    if (isAdmin || isEditor) {
        const authorName = document.getElementById('portAuthorName')?.value.trim() || '';
        const authorUserId = document.getElementById('portAuthorUser')?.value || '';
        if (!authorUserId && !authorName) return showToast('⚠️ Укажите имя автора', 'error');
        fd.append('authorName', authorName);
        if (authorUserId) fd.append('authorUserId', authorUserId);
    }

    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;

    try {
        await api('/api/portfolio', { method: 'POST', body: fd });
        form.reset();

        const uploadZoneText = document.getElementById('uploadZoneText');
        if (uploadZoneText) uploadZoneText.textContent = 'Нажмите, чтобы выбрать изображение';

        const authorNameInput = document.getElementById('portAuthorName');
        if (authorNameInput) authorNameInput.readOnly = false;

        await Promise.all([loadMyPortfolio(), loadAllPortfolio()]);
        showToast('✅ Работа успешно загружена');
    } catch (err) {
        console.error('Ошибка загрузки работы:', err);
        showToast('❌ ' + err.message, 'error');
    } finally {
        if (button) button.disabled = false;
    }
}
async function deletePortfolioItem(id) { if (!confirm('Удалить работу?')) return; try { await api(`/api/portfolio/${id}`, { method: 'DELETE' }); await loadMyPortfolio(); await loadAllPortfolio(); showToast('🗑️ Удалено'); } catch (err) { showToast('❌ ' + err.message, 'error'); } }

/* SOCKET */
function connectSocket() {
    if (!getToken() || typeof io !== 'function') return;
    if (state.socket) state.socket.disconnect();
    state.socket = io({ auth: { token: getToken() } });
    state.socket.on('connect', () => { if (state.currentChatId) state.socket.emit('chat:join', { chatId: state.currentChatId }); });
    state.socket.on('connect_error', (err) => showToast('❌ Чат: ' + (err.message || 'ошибка соединения'), 'error'));
    state.socket.on('chat:error', (data) => showToast('❌ ' + (data?.message || 'Сообщение не отправлено'), 'error'));
    state.socket.on('chat:new', (msg) => { const arr = state.chatMessages[msg.chatId] || []; if (!arr.find(m => m.id === msg.id)) { arr.push(msg); state.chatMessages[msg.chatId] = arr; } if (state.currentChatId === msg.chatId) appendMessageToWindow(msg); loadChats(); });
    state.socket.on('chat:notify', ({ chatId, message }) => { if (state.currentChatId !== chatId) { incrementUnreadBadge(); showToast(`💬 ${message.senderName}: ${message.text.slice(0, 40)}`); } });
    state.socket.on('presence', ({ userId, online }) => { if (online) state.onlineUsers.add(userId); else state.onlineUsers.delete(userId); renderChatList(); });
    state.socket.on('chat:typing', ({ name }) => { const el = document.getElementById('chatHeadRole'); if (el) { const orig = el.dataset.orig || el.textContent; el.dataset.orig = orig; el.textContent = `${name} печатает...`; clearTimeout(el._t); el._t = setTimeout(() => { el.textContent = orig; }, 2000); } });
}
function incrementUnreadBadge() { const b1 = document.getElementById('chatBadge'), b2 = document.getElementById('msgrBadge'); const cur = parseInt(b1.textContent || '0', 10) || 0; const next = cur + 1; [b1, b2].forEach(b => { if (b) { b.textContent = next; b.classList.remove('hidden'); } }); }

/* MESSENGER */
function openMessenger() { if (!state.user) return openAuth(); document.getElementById('messenger').classList.add('open'); document.body.style.overflow = 'hidden'; document.getElementById('userMenu').classList.add('hidden'); loadChats(); closeChat(); }
function closeMessenger() { document.getElementById('messenger').classList.remove('open'); if (!isAnyModalOpen()) document.body.style.overflow = ''; if (state.currentChatId) state.socket?.emit('chat:leave', { chatId: state.currentChatId }); closeChat(); }
async function loadChats() { if (!state.user) return; try { const { chats } = await api('/api/chats'); state.chats = chats; renderChatList(); updateTotalUnread(); } catch {} }
function updateTotalUnread() { const total = state.chats.reduce((s, c) => s + c.unread, 0); const b1 = document.getElementById('chatBadge'), b2 = document.getElementById('msgrBadge'); if (total > 0) [b1, b2].forEach(b => { if (b) { b.textContent = total > 99 ? '99+' : total; b.classList.remove('hidden'); } }); else [b1, b2].forEach(b => { if (b) b.classList.add('hidden'); }); }
function renderChatList() {
    const list = document.getElementById('chatList'); if (!list) return;
    if (!state.chats.length) { list.innerHTML = `<div class="empty-state small"><i class="fas fa-comments"></i><p>Нет чатов</p></div>`; return; }
    list.innerHTML = state.chats.map(c => { const peer = c.peer; const preview = c.lastMessage?.text || 'Нет сообщений'; const time = c.lastMessage ? formatTime(c.lastMessage.createdAt) : ''; const unread = c.unread > 0 ? `<span class="chat-unread">${c.unread}</span>` : ''; const online = state.onlineUsers.has(peer.id) ? `<span class="chat-online"></span>` : ''; return `<div class="chat-row" onclick="openChatWith(${peer.id})"><div class="chat-avatar">${userAvatarHtml(peer)}${online}</div><div class="chat-info"><div class="chat-name">${escapeHtml(peer.name)}</div><div class="chat-preview">${escapeHtml(preview)}</div></div><div class="chat-meta"><div class="chat-time">${time}</div>${unread}</div></div>`; }).join('');
}
async function openChatWith(peerId) {
    if (!state.user) return openAuth();
    try {
        const { chatId } = await api('/api/chats', { method: 'POST', body: { peerId } });
        state.currentChatId = chatId;
        const chat = state.chats.find(c => c.id === chatId);
        if (chat) state.chatPeer = chat.peer;
        else { const usersRes = await api('/api/users/list'); state.chatPeer = usersRes.users.find(u => u.id === peerId); }
        const { messages } = await api(`/api/chats/${chatId}/messages`);
        state.chatMessages[chatId] = messages;
        document.getElementById('chatList').classList.add('hidden');
        document.getElementById('chatWindow').classList.remove('hidden');
        document.getElementById('chatHead').classList.remove('hidden');
        document.getElementById('msgrBack').classList.remove('hidden');
        document.getElementById('msgrTitle').innerHTML = '<i class="fas fa-comments"></i> Чат';
        document.getElementById('chatHeadAvatar').innerHTML = userAvatarHtml(state.chatPeer);
        document.getElementById('chatHeadName').textContent = state.chatPeer?.name || '—';
        document.getElementById('chatHeadRole').textContent = ROLE_LABELS[state.chatPeer?.role] || '';
        renderChatMessages(messages);
        state.socket?.emit('chat:join', { chatId });
        document.getElementById('messenger').classList.add('open'); document.body.style.overflow = 'hidden';
        await loadChats();
        setTimeout(() => document.getElementById('chatInput').focus(), 300);
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
function closeChat() {
    if (state.currentChatId) state.socket?.emit('chat:leave', { chatId: state.currentChatId });
    state.currentChatId = null; state.chatPeer = null;
    document.getElementById('chatWindow').classList.add('hidden');
    document.getElementById('chatList').classList.remove('hidden');
    document.getElementById('msgrBack').classList.add('hidden');
    document.getElementById('msgrTitle').innerHTML = '<i class="fas fa-comments"></i> Сообщения';
    renderChatList();
}
function renderChatMessages(messages) { const wrap = document.getElementById('chatMessages'); if (!wrap) return; if (!messages.length) { wrap.innerHTML = `<div class="empty-state small"><i class="fas fa-comment"></i><p>Начните переписку</p></div>`; return; } wrap.innerHTML = messages.map(m => msgHtml(m)).join(''); wrap.scrollTop = wrap.scrollHeight; }
function msgHtml(m) { const isOut = m.senderId === state.user.id; return `<div class="msg ${isOut ? 'msg-out' : 'msg-in'}">${escapeHtml(m.text)}<span class="msg-time">${formatTime(m.createdAt)}</span></div>`; }
function appendMessageToWindow(m) { const wrap = document.getElementById('chatMessages'); if (!wrap) return; const empty = wrap.querySelector('.empty-state'); if (empty) empty.remove(); wrap.insertAdjacentHTML('beforeend', msgHtml(m)); wrap.scrollTop = wrap.scrollHeight; }
function sendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || !state.currentChatId) return;
    if (!state.socket || !state.socket.connected) return showToast('⚠️ Нет соединения с чатом. Обновите страницу и войдите снова.', 'error');
    state.socket.emit('chat:send', { chatId: state.currentChatId, text });
    input.value = '';
}
document.addEventListener('input', (e) => { if (e.target.id === 'chatInput' && state.currentChatId && state.socket) { clearTimeout(window._typingTimer); window._typingTimer = setTimeout(() => { state.socket.emit('chat:typing', { chatId: state.currentChatId }); }, 300); } });

/* ADMIN */
async function openAdminPanel() { if (!state.user || state.user.role !== 'admin') return showToast('⛔ Нет доступа', 'error'); document.getElementById('adminModal').classList.add('open'); document.body.style.overflow = 'hidden'; document.getElementById('userMenu').classList.add('hidden'); await loadAdminData(); switchAdminTab('dashboard'); }
function closeAdminPanel() { document.getElementById('adminModal').classList.remove('open'); if (!isAnyModalOpen()) document.body.style.overflow = ''; }
function switchAdminTab(tab) { document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.atab === tab)); document.getElementById('adminDashboard').classList.toggle('hidden', tab !== 'dashboard'); document.getElementById('adminWithdrawals').classList.toggle('hidden', tab !== 'withdrawals'); document.getElementById('adminRequests').classList.toggle('hidden', tab !== 'requests'); document.getElementById('adminUsers').classList.toggle('hidden', tab !== 'users'); }

async function loadAdminData() {
    const usersList = document.getElementById('usersList');
    if (usersList) usersList.innerHTML = '<div class="admin-empty">Загружаем пользователей…</div>';

    // Load sections independently so one unavailable endpoint cannot block users.
    const results = await Promise.allSettled([
        api('/api/admin/users'),
        api('/api/admin/requests'),
        api('/api/admin/stats'),
        api('/api/admin/withdrawals')
    ]);
    const [usersResult, requestsResult, statsResult, withdrawalsResult] = results;

    if (usersResult.status === 'fulfilled') {
        const data = usersResult.value;
        state.adminUsers = Array.isArray(data?.users) ? data.users.map(u => ({
            ...u,
            id: Number(u.id),
            name: String(u.name || 'Без имени'),
            email: String(u.email || ''),
            role: String(u.role || 'client'),
            balance: Number(u.balance ?? 0),
            isRoot: u.isRoot === true || Number(u.isRoot ?? u.is_root ?? 0) === 1,
            createdAt: Number(u.createdAt ?? u.created_at ?? 0)
        })) : [];
        renderAdminUsers();
    } else {
        state.adminUsers = [];
        if (usersList) usersList.innerHTML =
            '<div class="admin-empty">Не удалось загрузить пользователей. Проверьте авторизацию и Network.</div>';
        console.error('[Admin] Не удалось загрузить пользователей:', usersResult.reason);
        showToast('❌ Не удалось загрузить пользователей: ' +
            (usersResult.reason?.message || 'ошибка запроса'), 'error');
    }

    if (requestsResult.status === 'fulfilled') {
        state.adminRequests = Array.isArray(requestsResult.value?.requests)
            ? requestsResult.value.requests : [];
        state.adminContactRequests = Array.isArray(requestsResult.value?.contactRequests)
            ? requestsResult.value.contactRequests : [];
        renderAdminRequests();
    } else {
        state.adminRequests = [];
        const requestsList = document.getElementById('requestsList');
        if (requestsList) requestsList.innerHTML = '<div class="admin-empty">Не удалось загрузить заявки. Проверьте права и серверные логи.</div>';
        const reqCount = document.getElementById('reqCount');
        if (reqCount) reqCount.textContent = '—';
        console.error('[Admin] Ошибка загрузки заявок:', requestsResult.reason);
    }

    if (statsResult.status === 'fulfilled') {
        state.adminStats = statsResult.value;
        renderAdminDashboard();
    } else {
        state.adminStats = null;
        const dashboard = document.getElementById('dashboardStats');
        if (dashboard) dashboard.innerHTML = '<div class="admin-empty">Не удалось загрузить статистику. Проверьте права, API и логи сервера.</div>';
        console.error('[Admin] Ошибка загрузки статистики:', statsResult.reason);
    }

    if (withdrawalsResult.status === 'fulfilled') {
        state.adminWithdrawals = Array.isArray(withdrawalsResult.value?.withdrawals)
            ? withdrawalsResult.value.withdrawals : [];
        renderAdminWithdrawals();
    } else {
        state.adminWithdrawals = [];
        const withdrawalsList = document.getElementById('withdrawalsList');
        if (withdrawalsList) withdrawalsList.innerHTML = '<div class="admin-empty">Не удалось загрузить выплаты. Проверьте права и серверные логи.</div>';
        const wdCount = document.getElementById('wdCount');
        if (wdCount) wdCount.textContent = '—';
        console.error('[Admin] Ошибка загрузки выплат:', withdrawalsResult.reason);
    }
}
function renderAdminDashboard() {
    const wrap = document.getElementById('dashboardStats'); if (!wrap || !state.adminStats) return;
    const s = state.adminStats;
    wrap.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card stat-money stats-wide"><span class="stat-card-icon"><i class="fas fa-coins"></i></span><div class="stat-card-value">${formatMoney(s.money.totalBalance)}</div><div class="stat-card-label">Всего на счетах</div></div>
            <div class="stat-card" style="border-color:rgba(250,204,21,0.35)"><span class="stat-card-icon"><i class="fas fa-hourglass-half"></i></span><div class="stat-card-value">${s.withdrawals.pendingCount}</div><div class="stat-card-label">Заявок на вывод</div></div>
            <div class="stat-card" style="border-color:rgba(250,204,21,0.35)"><span class="stat-card-icon"><i class="fas fa-clock"></i></span><div class="stat-card-value" style="font-size:1.1rem">${formatMoney(s.withdrawals.pendingSum)}</div><div class="stat-card-label">Заморожено</div></div>
            <div class="stat-card stat-card-clickable" role="button" tabindex="0" onclick="openAdminUsersFromStats('all')" title="Открыть список аккаунтов"><span class="stat-card-icon"><i class="fas fa-users"></i></span><div class="stat-card-value">${s.users.total}</div><div class="stat-card-label">Пользователей · открыть список ↗</div></div>
            <div class="stat-card stat-card-clickable" role="button" tabindex="0" onclick="openAdminUsersFromStats('recent')" title="Посмотреть новые регистрации"><span class="stat-card-icon"><i class="fas fa-user-plus"></i></span><div class="stat-card-value">+${s.users.new7}</div><div class="stat-card-label">Новых за 7 дней · посмотреть ↗</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-folder-open"></i></span><div class="stat-card-value">${s.projects.total}</div><div class="stat-card-label">Заказов</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-spinner"></i></span><div class="stat-card-value">${s.projects.inProgress}</div><div class="stat-card-label">В работе</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-check-circle"></i></span><div class="stat-card-value">${s.projects.completed}</div><div class="stat-card-label">Завершено</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-times-circle"></i></span><div class="stat-card-value">${s.projects.cancelled || 0}</div><div class="stat-card-label">Отменено</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-comments"></i></span><div class="stat-card-value">${s.messages.total}</div><div class="stat-card-label">Сообщений</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-image"></i></span><div class="stat-card-value">${s.portfolio.total}</div><div class="stat-card-label">Работ</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-credit-card"></i></span><div class="stat-card-value" style="font-size:1.1rem">${formatMoney(s.payments?.succeededSum || 0)}</div><div class="stat-card-label">Оплачено ЮKassa</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-arrow-down"></i></span><div class="stat-card-value" style="font-size:1.1rem">${formatMoney(s.money.totalIn)}</div><div class="stat-card-label">Пополнений</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-arrow-up"></i></span><div class="stat-card-value" style="font-size:1.1rem">${formatMoney(s.money.totalOut)}</div><div class="stat-card-label">Списаний</div></div>
        </div>
        <div class="section-divider"><span>Роли</span></div>
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-card-value">${s.users.clients}</div><div class="stat-card-label">Клиентов</div></div>
            <div class="stat-card"><div class="stat-card-value">${s.users.executors}</div><div class="stat-card-label">Исполнителей</div></div>
            <div class="stat-card"><div class="stat-card-value">${s.users.managers}</div><div class="stat-card-label">Менеджеров</div></div>
            <div class="stat-card"><div class="stat-card-value">${s.users.admins}</div><div class="stat-card-label">Админов</div></div>
        </div>`;
}
function renderAdminWithdrawals() {
    const list = document.getElementById('withdrawalsList'); const badge = document.getElementById('wdCount'); if (!list) return;
    const pending = state.adminWithdrawals.filter(w => w.status === 'pending'); badge.textContent = pending.length;
    if (!state.adminWithdrawals.length) { list.innerHTML = '<div class="admin-empty">💸 Нет заявок</div>'; return; }
    list.innerHTML = state.adminWithdrawals.map(w => { const cls = WD_STATUS_CLASS[w.status] || 'status-review'; const av = w.user.avatar ? `<img src="${escapeHtml(w.user.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : escapeHtml(w.user.name.charAt(0).toUpperCase()); const actions = w.status === 'pending' ? `<div class="request-actions" style="margin-top:10px"><button class="admin-act-btn primary" onclick="approveWithdrawal(${w.id})"><i class="fas fa-check"></i> Одобрить</button><button class="admin-act-btn danger" onclick="rejectWithdrawal(${w.id})"><i class="fas fa-times"></i> Отклонить</button></div>` : ''; const card = w.cardNumber ? `<div class="wd-date">💳 ${escapeHtml(w.cardNumber)}</div>` : ''; return `<div class="withdrawal-card ${w.status === 'pending' ? 'pending' : ''}"><div class="wd-head"><div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0"><div class="admin-user-avatar" style="width:36px;height:36px;font-size:0.9rem">${av}</div><div style="min-width:0;flex:1"><div class="wd-user">${escapeHtml(w.user.name)}</div><div class="wd-email">${escapeHtml(w.user.email)}</div></div></div><div class="wd-amount">${formatMoney(w.amount)}</div><span class="project-status ${cls}">${WD_STATUS[w.status]}</span></div>${card}<div class="wd-date">Создано: ${formatDateTime(w.createdAt)}</div>${w.reviewedAt ? `<div class="wd-date">Рассмотрено: ${formatDateTime(w.reviewedAt)}</div>` : ''}${w.comment ? `<div class="wd-comment">💬 ${escapeHtml(w.comment)}</div>` : ''}${actions}</div>`; }).join('');
}
async function approveWithdrawal(id) { if (!confirm('Подтвердить выплату?')) return; try { await api(`/api/admin/withdrawals/${id}/approve`, { method: 'POST' }); showToast('✅ Одобрено'); await loadAdminData(); } catch (err) { showToast('❌ ' + err.message, 'error'); } }
async function rejectWithdrawal(id) { const comment = prompt('Причина отклонения:', ''); if (comment === null) return; try { await api(`/api/admin/withdrawals/${id}/reject`, { method: 'POST', body: { comment } }); showToast('↩️ Отклонено'); await loadAdminData(); } catch (err) { showToast('❌ ' + err.message, 'error'); } }
function renderAdminRequests() {
    const list = document.getElementById('requestsList');
    const badge = document.getElementById('reqCount');
    if (!list) return;
    const roleRequests = Array.isArray(state.adminRequests) ? state.adminRequests : [];
    const contactRequests = Array.isArray(state.adminContactRequests) ? state.adminContactRequests : [];
    if (badge) badge.textContent = roleRequests.length + contactRequests.length;
    const roleHtml = roleRequests.map(u => {
        const dateStr = new Date(Number(u.createdAt) || 0).toLocaleDateString('ru-RU');
        const name = String(u.name || 'Без имени');
        const avatar = u.avatar ? `<img src="${escapeHtml(u.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : escapeHtml(name.charAt(0).toUpperCase());
        return `<div class="request-card"><div class="request-head"><div class="admin-user-avatar">${avatar}</div><div class="request-info"><div class="request-name">${escapeHtml(name)}</div><div class="request-role">→ ${escapeHtml(ROLE_LABELS[u.requestedRole] || u.requestedRole || '')}</div><div class="request-date">${escapeHtml(u.email || '')} · с ${escapeHtml(dateStr)}</div></div></div><div class="request-actions"><button class="admin-act-btn primary" onclick="approveRequest(${Number(u.id)})"><i class="fas fa-check"></i> Одобрить</button><button class="admin-act-btn danger" onclick="rejectRequest(${Number(u.id)})"><i class="fas fa-times"></i> Отклонить</button></div></div>`;
    }).join('');
    const contactHtml = contactRequests.map(r => {
        const dateStr = new Date(Number(r.createdAt) || 0).toLocaleString('ru-RU');
        const details = [['Проект',r.project],['Услуга',r.service],['Бюджет',r.budget],['Способ связи',r.contactMethod],['Контакт',r.contactDetail],['Референсы',r.reference],['Email аккаунта',r.userEmail]].filter(([,v]) => String(v || '').trim());
        return `<div class="request-card"><div class="request-head"><div class="admin-user-avatar">✉</div><div class="request-info"><div class="request-name">${escapeHtml(r.name || 'Без имени')}</div><div class="request-role">Заявка с сайта #${Number(r.id)}</div><div class="request-date">${escapeHtml(dateStr)}</div></div></div><div style="display:grid;gap:6px;margin-top:12px">${details.map(([label,value]) => `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`).join('')}</div><div class="request-actions"><button class="admin-act-btn" onclick="openContactRequest(${Number(r.id)})"><i class="fas fa-eye"></i> Подробности</button></div></div>`;
    }).join('');
    list.innerHTML = (roleHtml ? '<h3 style="margin:16px 0 10px">Заявки на роли</h3>' + roleHtml : '') +
        (contactHtml ? '<h3 style="margin:24px 0 10px">Заявки с сайта</h3>' + contactHtml : '') ||
        '<div class="admin-empty">🎉 Нет заявок</div>';
}
async function openContactRequest(id) {
    try {
        const r = (await api(`/api/admin/requests/${Number(id)}`)).request;
        const lines = [
            `Заявка #${r.id}`, `Имя: ${r.name}`, `Проект: ${r.project || '—'}`,
            `Услуга: ${r.service}`, `Бюджет: ${r.budget || '—'}`,
            `Способ связи: ${r.contactMethod}`, `Контакт: ${r.contactDetail || '—'}`,
            `Референсы: ${r.reference || '—'}`,
            `Дата: ${new Date(r.createdAt).toLocaleString('ru-RU')}`,
            r.account ? `Аккаунт: ${r.account.name} (${r.account.email})` : 'Гость без аккаунта'
        ];
        window.alert(lines.join('\\n'));
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}

function openAdminUsersFromStats(filter) {
    state.adminUserStatsFilter = filter === 'recent' ? 'recent' : 'all';
    switchAdminTab('users');
    const search = document.getElementById('userSearch');
    if (search) search.value = '';
    renderAdminUsers();
}

function renderAdminUsers() {
    const list = document.getElementById('usersList');
    if (!list) return;

    const allUsers = Array.isArray(state.adminUsers) ? state.adminUsers : [];
    if (!allUsers.length) {
        list.innerHTML = '<div class="admin-empty">В системе пока нет пользователей</div>';
        return;
    }

    const search = (document.getElementById('userSearch')?.value || '').trim().toLowerCase();
    const statsFilter = state.adminUserStatsFilter || 'all';
    const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let users = allUsers.filter(u => {
        const name = String(u.name || '').toLowerCase();
        const email = String(u.email || '').toLowerCase();
        const createdAt = Number(u.createdAt ?? u.created_at ?? 0);
        const matchesSearch = !search || name.includes(search) || email.includes(search) || String(u.id ?? '').includes(search);
        return matchesSearch && (statsFilter !== 'recent' || createdAt >= recentCutoff);
    });

    users.sort((a, b) => {
        const aRoot = a.isRoot === true || Number(a.isRoot ?? a.is_root ?? 0) === 1;
        const bRoot = b.isRoot === true || Number(b.isRoot ?? b.is_root ?? 0) === 1;
        if (aRoot !== bRoot) return aRoot ? -1 : 1;
        if ((a.role === 'admin') !== (b.role === 'admin')) return a.role === 'admin' ? -1 : 1;
        return Number(b.createdAt ?? b.created_at ?? 0) -
            Number(a.createdAt ?? a.created_at ?? 0);
    });

    if (!users.length) {
        list.innerHTML = '<div class="admin-empty">По вашему запросу ничего не найдено</div>';
        return;
    }

    const me = state.user;
    const myId = Number(me?.id);
    const iAmRoot = me?.role === 'admin' &&
        (me?.isRoot === true || Number(me?.is_root ?? 0) === 1);

    const filterBanner = statsFilter === 'recent' ? '<div style="margin:0 0 14px;padding:12px;border:1px solid var(--accent);border-radius:12px">🆕 Регистрации за последние 7 дней <button class="admin-act-btn" onclick="openAdminUsersFromStats(\'all\')">Показать всех</button></div>' : '<div style="margin-bottom:12px;color:var(--text-mute);font-size:.88rem">Аккаунты · сначала последние регистрации</div>';
    list.innerHTML = filterBanner + users.map(u => {
        const id = Number(u.id);
        const name = String(u.name || 'Без имени');
        const email = String(u.email || '');
        const role = String(u.role || 'client');
        const isSelf = Number.isFinite(myId) && id === myId;
        const isRootUser = u.isRoot === true || Number(u.isRoot ?? u.is_root ?? 0) === 1;
        const isAdminUser = role === 'admin';
        const avatar = u.avatar
            ? `<img src="${escapeHtml(u.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
            : escapeHtml(name.charAt(0).toUpperCase() || '?');

        const canChangeRole = iAmRoot ? !isSelf : (!isAdminUser && !isSelf);
        const canAdjustBalance = iAmRoot ? true : (!isAdminUser || isSelf);
        const canSetAdmin = iAmRoot && !isSelf;
        const roleButtons = canChangeRole
            ? `<button class="admin-act-btn" onclick="adminSetRole(${id},'client')">Клиент</button><button class="admin-act-btn" onclick="adminSetRole(${id},'executor')">Исполнитель</button><button class="admin-act-btn" onclick="adminSetRole(${id},'manager')">Менеджер</button>${canSetAdmin ? `<button class="admin-act-btn" onclick="adminSetRole(${id},'admin')">Админ</button>` : ''}`
            : `<span style="color:var(--text-mute);font-size:0.78rem;padding:6px 12px">${isRootUser ? '👑 Главный админ' : '🔒 Недоступно'}</span>`;
        const balanceButton = canAdjustBalance
            ? `<button class="admin-act-btn" onclick="adminAdjustBalance(${id})"><i class="fas fa-coins"></i> Баланс</button>`
            : '';

        return `<div class="admin-user-row"><div class="admin-user-avatar" ${isRootUser ? 'style="box-shadow:0 0 0 2px #fbbf24;"' : ''}>${avatar}</div><div class="admin-user-info"><div class="admin-user-name">${escapeHtml(name)}${isRootUser ? ' <span style="color:#fbbf24;font-weight:700">👑</span>' : ''}${isSelf ? ' <span style="color:var(--text-mute);font-weight:500">(вы)</span>' : ''}</div><div class="admin-user-email">${escapeHtml(email)}<br><span style="opacity:.72;font-size:.78rem">Регистрация: ${Number(u.createdAt ?? u.created_at ?? 0) ? new Date(Number(u.createdAt ?? u.created_at ?? 0)).toLocaleString("ru-RU") : "дата неизвестна"} · ID #${id}</span></div></div><span class="admin-user-role role-badge-${escapeHtml(role)}">${escapeHtml(ROLE_LABELS[role] || role)}</span><span class="admin-user-balance">${escapeHtml(formatMoney(Number(u.balance) || 0))}</span><div class="admin-user-actions"><button class="admin-act-btn primary" onclick="openUserFull(${id})"><i class="fas fa-eye"></i> История</button>${roleButtons}${balanceButton}</div></div>`;
    }).join('');
}
async function approveRequest(userId) { try { await api('/api/admin/approve', { method: 'POST', body: { userId } }); showToast('✅ Одобрено'); await loadAdminData(); await fetchMe(); } catch (err) { showToast('❌ ' + err.message, 'error'); } }
async function rejectRequest(userId) { try { await api('/api/admin/reject', { method: 'POST', body: { userId } }); showToast('❌ Отклонено'); await loadAdminData(); } catch (err) { showToast('❌ ' + err.message, 'error'); } }
async function adminSetRole(userId, role) { try { await api('/api/admin/role', { method: 'POST', body: { userId, role } }); showToast(`✅ Роль → ${ROLE_LABELS[role]}`); await loadAdminData(); await fetchMe(); } catch (err) { showToast('❌ ' + err.message, 'error'); } }
async function adminAdjustBalance(userId) {
    const u = state.adminUsers.find(x => Number(x.id) === Number(userId));
    if (!u) return showToast('❌ Пользователь не найден', 'error');

    const input = prompt(
        `Изменить баланс ${u.name}\\nТекущий: ${formatMoney(u.balance)}\\nВведите сумму в рублях (положительная — добавить, отрицательная — списать):`,
        '0'
    );
    if (input === null) return;

    const normalized = input.trim().replace(',', '.');
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
        return showToast('⚠️ Введите сумму с точностью до копеек', 'error');
    }

    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
        return showToast('⚠️ Сумма должна быть в пределах ±1 000 000 ₽ и не равна нулю', 'error');
    }

    const amountKopecks = Math.round(amount * 100);
    if (!Number.isSafeInteger(amountKopecks)) {
        return showToast('⚠️ Сумма слишком большая', 'error');
    }

    try {
        await api('/api/admin/balance', {
            method: 'POST',
            body: { userId: Number(userId), amount }
        });
        showToast('✅ Баланс обновлён');
        await loadAdminData();
        await fetchMe();
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    }
}
async function openUserFull(userId) {
    try { const data = await api(`/api/admin/users/${userId}/full`); renderUserFull(data); document.getElementById('userFullModal').classList.add('open'); document.body.style.overflow = 'hidden'; } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
function closeUserFull() { document.getElementById('userFullModal').classList.remove('open'); if (!isAnyModalOpen()) document.body.style.overflow = ''; }
function renderUserFull(data) {
    const { user, transactions, withdrawals, stats } = data;
    const av = user.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="">` : escapeHtml(user.name.charAt(0).toUpperCase());
    document.getElementById('userFullContent').innerHTML = `
        <div class="user-modal-head"><div class="user-modal-avatar">${av}</div><div><h3>${escapeHtml(user.name)}</h3><div class="user-modal-email">${escapeHtml(user.email)}</div><div style="margin-top:6px"><span class="admin-user-role role-badge-${user.role}">${ROLE_LABELS[user.role] || user.role}</span></div></div></div>
        <div class="user-modal-stats">
            <div class="user-modal-stat"><div class="user-modal-stat-value">${formatMoney(user.balance)}</div><div class="user-modal-stat-label">Баланс</div></div>
            <div class="user-modal-stat"><div class="user-modal-stat-value" style="color:var(--accent-3)">+${formatMoney(stats.totalIn)}</div><div class="user-modal-stat-label">Пополнено</div></div>
            <div class="user-modal-stat"><div class="user-modal-stat-value" style="color:var(--accent)">−${formatMoney(stats.totalOut)}</div><div class="user-modal-stat-label">Списано</div></div>
        </div>
        <div class="user-modal-tabs">
            <button class="user-modal-tab active" data-utab="tx" onclick="switchUserTab('tx')"><i class="fas fa-history"></i> Платежи (${transactions.length})</button>
            <button class="user-modal-tab" data-utab="wd" onclick="switchUserTab('wd')"><i class="fas fa-money-check-alt"></i> Выводы (${withdrawals.length})</button>
        </div>
        <div class="user-modal-panel" id="userFullTx">${transactions.length ? transactions.map(t => { const dateStr = formatDateTime(t.date); const sign = t.type === 'in' ? '+' : '−'; const icon = t.type === 'in' ? 'fa-arrow-down' : 'fa-arrow-up'; return `<div class="tx-row"><div class="tx-icon ${t.type}"><i class="fas ${icon}"></i></div><div class="tx-info"><div class="tx-title">${escapeHtml(t.title)}</div><div class="tx-date">${dateStr}</div></div><div class="tx-amount ${t.type}">${sign} ${formatMoney(t.amount)}</div></div>`; }).join('') : '<div class="tx-empty">Нет операций</div>'}</div>
        <div class="user-modal-panel hidden" id="userFullWd">${withdrawals.length ? withdrawals.map(w => { const cls = WD_STATUS_CLASS[w.status] || 'status-review'; return `<div class="withdrawal-card ${w.status === 'pending' ? 'pending' : ''}"><div class="wd-head"><div class="wd-amount">${formatMoney(w.amount)}</div><span class="project-status ${cls}">${WD_STATUS[w.status]}</span></div>${w.cardNumber ? `<div class="wd-date">💳 ${escapeHtml(w.cardNumber)}</div>` : ''}<div class="wd-date">Создано: ${formatDateTime(w.createdAt)}</div>${w.reviewedAt ? `<div class="wd-date">Рассмотрено: ${formatDateTime(w.reviewedAt)}</div>` : ''}${w.comment ? `<div class="wd-comment">💬 ${escapeHtml(w.comment)}</div>` : ''}</div>`; }).join('') : '<div class="tx-empty">Нет заявок</div>'}</div>
    `;
}
function switchUserTab(tab) { document.querySelectorAll('.user-modal-tab').forEach(t => t.classList.toggle('active', t.dataset.utab === tab)); document.getElementById('userFullTx').classList.toggle('hidden', tab !== 'tx'); document.getElementById('userFullWd').classList.toggle('hidden', tab !== 'wd'); }

/* SERVICE / PLAN / CONTACT */
function selectService(name, price) { showToast(`✨ ${name} — ${price}`); const select = document.getElementById('formService'); if (select) { const found = Array.from(select.options).find(o => o.value === name || o.text === name); if (found) select.value = found.value; } scrollToSection('services'); }
function selectPlan(name, price) { document.getElementById('planDisplay').textContent = `${name} — ${price}`; document.getElementById('selectedPlan').style.display = 'block'; const msg = document.getElementById('formMessage'); if (!msg.value.includes('Пакет:')) msg.value = msg.value ? `${msg.value}\nПакет: ${name} (${price})` : `Пакет: ${name} (${price})`; showToast(`✅ ${name}`); scrollToSection('services'); }
const contactLabels = {
    Сайт: { label: 'Ваш контакт на сайте', placeholder: 'Имя пользователя или ссылка на профиль' },
    Discord: { label: 'Ваш ник в Discord', placeholder: 'Например, username' },
    Telegram: { label: 'Ваш ник в Telegram', placeholder: '@username' },
    VK: { label: 'Ссылка на профиль VK', placeholder: 'https://vk.com/...' },
    Телефон: { label: 'Ваш номер телефона', placeholder: '+7 ...' },
    Email: { label: 'Ваша электронная почта', placeholder: 'name@example.com' }
};
function updateContactDetailField() {
    const method = document.getElementById('formContactMethod');
    const block = document.getElementById('contactDetailBlock');
    const input = document.getElementById('formContactDetail');
    const label = document.getElementById('contactDetailLabel');
    if (!method || !block || !input || !label) return;

    const config = contactLabels[method.value];
    const visible = Boolean(config);
    block.hidden = !visible;
    block.style.display = visible ? 'grid' : 'none';
    if (visible) block.removeAttribute('hidden');
    else block.setAttribute('hidden', '');

    input.required = visible;
    input.autocomplete = method.value === 'Телефон' ? 'tel' : method.value === 'Email' ? 'email' : 'off';
    input.inputMode = method.value === 'Телефон' ? 'tel' : method.value === 'Email' ? 'email' : 'text';
    if (config) {
        label.textContent = config.label;
        input.placeholder = config.placeholder;
        input.setAttribute('aria-label', config.label);
    } else {
        input.value = '';
        input.placeholder = 'Укажите контакт';
        input.removeAttribute('aria-label');
    }
}
window.updateContactDetailField = updateContactDetailField;
const contactMethodSelect = document.getElementById('formContactMethod');
contactMethodSelect?.addEventListener('change', updateContactDetailField);
contactMethodSelect?.addEventListener('input', updateContactDetailField);
if (contactMethodSelect) {
    contactMethodSelect.dispatchEvent(new Event('change', { bubbles: true }));
}
updateContactDetailField();

async function handleSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const button = document.getElementById('contactSubmitBtn');
    const payload = {
        name: document.getElementById('formName').value.trim(),
        project: document.getElementById('formProject').value.trim(),
        service: document.getElementById('formService').value,
        reference: document.getElementById('formMessage').value.trim(),
        contactMethod: document.getElementById('formContactMethod').value,
        contactDetail: document.getElementById('formContactDetail').value.trim()
    };
    if (button) { button.disabled = true; button.textContent = 'Отправляем...'; }
    try {
        await api('/api/requests', { method: 'POST', body: payload });
        showToast(`🎉 ${payload.name}, заявка успешно отправлена!`);
        form.reset();
        updateContactDetailField();
        const selectedPlan = document.getElementById('selectedPlan');
        if (selectedPlan) selectedPlan.style.display = 'none';
    } catch (err) {
        console.error('[Contact form] Ошибка:', err);
        showToast('❌ Не удалось отправить заявку. Попробуйте ещё раз.', 'error');
    } finally {
        if (button) { button.disabled = false; button.textContent = 'Отправить заявку'; }
    }
}

/* FILTERS */
document.querySelectorAll('#projectFilters .filter').forEach(btn => { btn.addEventListener('click', () => filterProjects(btn.dataset.status)); });
document.querySelectorAll('.port-filters .filter').forEach(btn => { btn.addEventListener('click', () => { state.portfolioFilter = btn.dataset.filter; document.querySelectorAll('.port-filters .filter').forEach(b => b.classList.toggle('active', b === btn)); renderAllPortfolio(); }); });
document.querySelectorAll('.service-card').forEach(card => { card.addEventListener('click', () => selectService(card.dataset.service, card.dataset.price)); });

/* SCROLL */
function animateOnScroll() { const els = document.querySelectorAll('.service-card, .pricing-card'); const trigger = window.innerHeight - 100; els.forEach((el, i) => { if (el.classList.contains('visible')) return; if (el.getBoundingClientRect().top < trigger) setTimeout(() => el.classList.add('visible'), i * 60); }); }
function animateCounter(el, target, suffix = '', duration = 1500) { const st = performance.now(); function u(now) { const p = Math.min((now - st) / duration, 1); const e = 1 - Math.pow(1 - p, 3); el.textContent = Math.floor(target * e); if (p < 1) requestAnimationFrame(u); else el.textContent = target + suffix; } requestAnimationFrame(u); }
let statsAnimated = false;
function checkStats() {
    if (statsAnimated) return;
    const stats = document.querySelector('.about-grid'); if (!stats) return;
    if (stats.getBoundingClientRect().top < window.innerHeight - 50) {
        statsAnimated = true;
        const s1 = document.querySelector('[data-content="about_stat_1"]'), s2 = document.querySelector('[data-content="about_stat_2"]'), s3 = document.querySelector('[data-content="about_stat_3"]');
        if (s1) animateCounter(s1, parseInt(s1.textContent) || 50);
        if (s2) animateCounter(s2, parseInt(s2.textContent) || 30);
        if (s3) animateCounter(s3, parseInt(s3.textContent) || 5, ' дн.');
    }
}
function onScroll() { const y = window.scrollY; const header = document.getElementById('header'), scrollTop = document.getElementById('scrollTop'); if (header) header.classList.toggle('scrolled', y > 20); if (scrollTop) scrollTop.classList.toggle('show', y > 500); animateOnScroll(); checkStats(); }
window.addEventListener('scroll', onScroll, { passive: true });

/* Формат номера карты */
document.getElementById('moneyCard')?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 16);
    e.target.value = v.replace(/(.{4})/g, '$1 ').trim();
});

/* Кнопки формы верификации */
document.getElementById('resendCodeBtn')?.addEventListener('click', resendCode);
document.getElementById('backToRegisterBtn')?.addEventListener('click', () => {
    document.getElementById('verifyForm').classList.add('hidden');
    document.getElementById('authTabs').classList.remove('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'register'));
    const vErr = document.getElementById('verifyError'); if (vErr) vErr.textContent = '';
});

/* INIT */
async function init() {
    // Реферальный трекинг
    const ref = getRefFromUrl();
    if (ref) {
        fetch('/api/referrals/click/' + encodeURIComponent(ref)).catch(() => {});
        localStorage.setItem('paw_ref', ref);
    }
    await loadAndApplyContent();
    await fetchMe();
    if (!state.user) { await loadProjects(); await loadAllPortfolio(); }
    setTimeout(onScroll, 200);
    console.log('🐾 Paw Art Studio v3.8 (hybrid) ready');
}
init();
