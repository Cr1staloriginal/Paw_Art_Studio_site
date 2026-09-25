/* Paw Art Studio v3.3 — с защитой главного админа */

const API = '';
const TOKEN_KEY = 'paw_token';

const ROLE_LABELS = { client: 'Клиент', executor: 'Исполнитель', manager: 'Менеджер', admin: 'Администратор' };
const STATUS_LABELS = { open: 'Открыт', in_progress: 'В работе', review: 'На проверке', completed: 'Завершён', cancelled: 'Отменён' };
const WD_STATUS = { pending: 'На рассмотрении', approved: 'Одобрено', rejected: 'Отклонено' };
const WD_STATUS_CLASS = { pending: 'status-review', approved: 'status-completed', rejected: 'status-cancelled' };

const state = {
    user: null, transactions: [], userWithdrawals: [],
    adminUsers: [], adminRequests: [], adminStats: null, adminWithdrawals: [],
    projects: [], projectFilter: 'all', currentProject: null,
    chats: [], chatMessages: {}, currentChatId: null, chatPeer: null,
    socket: null, onlineUsers: new Set(),
    moneyMode: 'deposit',
    allPortfolio: [], myPortfolio: [], portfolioFilter: 'all',
};

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const isForm = options.body instanceof FormData;
    if (isForm) delete headers['Content-Type'];
    const res = await fetch(API + path, {
        ...options, headers,
        body: isForm ? options.body : (options.body ? JSON.stringify(options.body) : undefined),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
        const err = new Error(data?.error || `Ошибка ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

function formatMoney(k) {
    const r = (Number(k) || 0) / 100;
    return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(r) + ' ₽';
}
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatTime(ts) {
    const d = new Date(ts), now = new Date(), diff = (now - d) / 1000;
    if (diff < 60) return 'сейчас';
    if (diff < 3600) return Math.floor(diff / 60) + ' мин';
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}
function formatDateTime(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
        + ' · ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function userAvatarHtml(u) {
    if (u?.avatar) return `<img src="${escapeHtml(u.avatar)}" alt="">`;
    return `<span>${(u?.name || '?').charAt(0).toUpperCase()}</span>`;
}

function scrollToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.pageYOffset - 70;
    window.scrollTo({ top, behavior: 'smooth' });
    closeMenu();
}
function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); closeMenu(); }
function toggleMenu() {
    document.getElementById('navLinks').classList.toggle('open');
    document.getElementById('burger').classList.toggle('active');
}
function closeMenu() {
    document.getElementById('navLinks').classList.remove('open');
    document.getElementById('burger').classList.remove('active');
}

document.addEventListener('click', (e) => {
    const nav = document.getElementById('navLinks'), burger = document.getElementById('burger');
    if (nav && burger && !nav.contains(e.target) && !burger.contains(e.target)) closeMenu();
    const box = document.getElementById('userBox'), menu = document.getElementById('userMenu');
    if (box && menu && !box.contains(e.target)) menu.classList.add('hidden');
});
window.addEventListener('resize', () => { if (window.innerWidth > 900) closeMenu(); });

function showToast(text, type) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = text;
    t.classList.toggle('error', type === 'error');
    t.classList.add('show');
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => t.classList.remove('show'), 3500);
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
    document.getElementById('loginForm').reset();
    document.getElementById('registerForm').reset();
}
function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
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
        const { token, user } = await api('/api/auth/register', { method: 'POST', body: { name, email, password } });
        setToken(token); state.user = user; closeAuth();
        await afterLogin();
        showToast('🎉 Аккаунт создан! Бонус 500 ₽ зачислен.');
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { btn.disabled = false; }
}
async function logout() {
    setToken(null); state.user = null; state.chats = []; state.chatMessages = {}; state.currentChatId = null;
    if (state.socket) { state.socket.disconnect(); state.socket = null; }
    closeDashboard(); closeAdminPanel(); closeMessenger(); closeProfileEditor(); closeMyPortfolio(); closeUserFull();
    updateUI(); loadProjects(); loadAllPortfolio();
    showToast('👋 Вы вышли');
}
async function afterLogin() {
    updateUI(); connectSocket();
    await Promise.all([loadProjects(), loadAllPortfolio(), loadChats()]);
}

/* UI */
function updateUI() {
    const u = state.user;
    const loginBtn = document.getElementById('loginBtn'), userBox = document.getElementById('userBox');
    const adminBtn = document.getElementById('adminBtn'), adminMenuLink = document.getElementById('adminMenuLink');
    const msgrFab = document.getElementById('msgrFab'), createProjectBtn = document.getElementById('createProjectBtn');

    if (u) {
        loginBtn.classList.add('hidden'); userBox.classList.remove('hidden'); msgrFab.classList.remove('hidden');
        document.getElementById('userName').textContent = u.name;
        document.getElementById('userRole').textContent = ROLE_LABELS[u.role] || u.role;
        document.getElementById('balanceChip').textContent = formatMoney(u.balance);
        document.getElementById('dashName').textContent = u.name;
        document.getElementById('dashRole').textContent = ROLE_LABELS[u.role] || u.role;
        document.getElementById('dashBalance').textContent = formatMoney(u.balance);
        document.getElementById('roleCurrentValue').textContent = ROLE_LABELS[u.role] || u.role;

        const avatarEl = document.getElementById('dashAvatar');
        const userAvatarEl = document.getElementById('userAvatar');
        if (u.avatar) {
            avatarEl.innerHTML = `<img src="${escapeHtml(u.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
            userAvatarEl.innerHTML = `<img src="${escapeHtml(u.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        } else {
            avatarEl.textContent = u.name.charAt(0).toUpperCase();
            userAvatarEl.innerHTML = `<span id="userInitial">${u.name.charAt(0).toUpperCase()}</span>`;
        }

        const pendingBlock = document.getElementById('rolePending'), requestBlock = document.getElementById('roleRequestBlock');
        if (u.requestedRole) {
            pendingBlock.classList.remove('hidden'); requestBlock.classList.add('hidden');
            document.getElementById('rolePendingText').textContent = `Заявка на роль «${ROLE_LABELS[u.requestedRole]}» на рассмотрении`;
        } else if (u.role === 'admin') {
            pendingBlock.classList.add('hidden'); requestBlock.classList.add('hidden');
        } else {
            pendingBlock.classList.add('hidden'); requestBlock.classList.remove('hidden');
        }

        if (u.role === 'admin') {
            adminBtn.classList.remove('hidden');
            adminMenuLink.classList.remove('hidden');
            if (u.isRoot) {
                adminBtn.style.background = 'linear-gradient(135deg, #fbbf24, #f59e0b)';
                adminBtn.title = '👑 Главный админ';
            } else {
                adminBtn.style.background = '';
                adminBtn.title = 'Админ';
            }
        } else {
            adminBtn.classList.add('hidden');
            adminMenuLink.classList.add('hidden');
        }

        if (u.role === 'executor') createProjectBtn.classList.add('hidden');
        else createProjectBtn.classList.remove('hidden');
    } else {
        loginBtn.classList.remove('hidden'); userBox.classList.add('hidden');
        adminBtn.classList.add('hidden'); adminMenuLink.classList.add('hidden'); msgrFab.classList.add('hidden');
    }
}
function toggleUserMenu() { document.getElementById('userMenu').classList.toggle('hidden'); }
function isAnyModalOpen() {
    return ['adminModal','authModal','moneyModal','dashboardModal','profileModal','projectModal','projectDetailModal','myPortfolioModal','userFullModal']
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

/* DASHBOARD */
function openDashboard() {
    if (!state.user) return openAuth();
    document.getElementById('dashboardModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('userMenu').classList.add('hidden');
    loadDashboardData();
}
function closeDashboard() {
    document.getElementById('dashboardModal').classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
}
function switchDashTab(tab) {
    document.querySelectorAll('.dash-tab').forEach(t => t.classList.toggle('active', t.dataset.dtab === tab));
    document.getElementById('dashWallet').classList.toggle('hidden', tab !== 'wallet');
    document.getElementById('dashWithdrawals').classList.toggle('hidden', tab !== 'withdrawals');
    document.getElementById('dashHistory').classList.toggle('hidden', tab !== 'history');
    document.getElementById('dashRolePanel').classList.toggle('hidden', tab !== 'role');
}
async function loadDashboardData() {
    updateUI();
    try {
        const [txRes, wdRes] = await Promise.all([
            api('/api/wallet/transactions'),
            api('/api/wallet/withdrawals'),
        ]);
        state.transactions = txRes.transactions;
        state.userWithdrawals = wdRes.withdrawals;
        renderTransactions(); renderWalletStats(); renderUserWithdrawals();
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
function renderWalletStats() {
    const totalIn = state.transactions.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0);
    const totalOut = state.transactions.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0);
    document.getElementById('wsIn').textContent = formatMoney(totalIn);
    document.getElementById('wsOut').textContent = formatMoney(totalOut);
    document.getElementById('wsProjects').textContent = state.projects.length;
}
function renderTransactions() {
    const list = document.getElementById('txList');
    if (!list) return;
    if (!state.transactions.length) { list.innerHTML = '<div class="tx-empty">Пока нет операций</div>'; return; }
    list.innerHTML = state.transactions.map(tx => {
        const dateStr = formatDateTime(tx.date);
        const sign = tx.type === 'in' ? '+' : '−';
        const icon = tx.type === 'in' ? 'fa-arrow-down' : 'fa-arrow-up';
        return `<div class="tx-row">
            <div class="tx-icon ${tx.type}"><i class="fas ${icon}"></i></div>
            <div class="tx-info"><div class="tx-title">${escapeHtml(tx.title)}</div><div class="tx-date">${dateStr}</div></div>
            <div class="tx-amount ${tx.type}">${sign} ${formatMoney(tx.amount)}</div>
        </div>`;
    }).join('');
}
function renderUserWithdrawals() {
    const list = document.getElementById('userWithdrawalsList');
    if (!list) return;
    if (!state.userWithdrawals.length) {
        list.innerHTML = '<div class="tx-empty">Пока нет заявок на вывод</div>';
        return;
    }
    list.innerHTML = state.userWithdrawals.map(w => {
        const cls = WD_STATUS_CLASS[w.status] || 'status-review';
        const comment = w.comment ? `<div class="wd-comment">💬 ${escapeHtml(w.comment)}</div>` : '';
        return `<div class="withdrawal-card">
            <div class="wd-head">
                <div class="wd-amount">${formatMoney(w.amount)}</div>
                <span class="project-status ${cls}">${WD_STATUS[w.status]}</span>
            </div>
            <div class="wd-date">Создано: ${formatDateTime(w.createdAt)}</div>
            ${w.reviewedAt ? `<div class="wd-date">Рассмотрено: ${formatDateTime(w.reviewedAt)}</div>` : ''}
            ${comment}
        </div>`;
    }).join('');
}
async function requestRole(role) {
    if (!state.user) return openAuth();
    try {
        const { user } = await api('/api/role/request', { method: 'POST', body: { role } });
        state.user = user; updateUI();
        showToast(`✅ Заявка на роль «${ROLE_LABELS[role]}» отправлена`);
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}

/* MONEY */
function openDeposit() {
    state.moneyMode = 'deposit';
    document.getElementById('moneyTitle').textContent = 'Пополнение баланса';
    document.getElementById('moneySub').textContent = 'Выберите сумму или введите свою';
    document.getElementById('moneyNote').innerHTML = 'Комиссия <strong>0%</strong>. Моментально.';
    document.getElementById('moneySubmit').textContent = 'Пополнить';
    document.getElementById('moneyAmount').value = '';
    document.getElementById('moneyModal').classList.add('open');
}
function openWithdraw() {
    state.moneyMode = 'withdraw';
    document.getElementById('moneyTitle').textContent = 'Заявка на вывод';
    document.getElementById('moneySub').textContent = 'Админ подтвердит вручную';
    document.getElementById('moneyNote').innerHTML = 'Комиссия <strong>0%</strong>. Сумма замораживается до подтверждения. Минимум <strong>0.01 ₽</strong>.';
    document.getElementById('moneySubmit').textContent = 'Отправить заявку';
    document.getElementById('moneyAmount').value = '';
    document.getElementById('moneyModal').classList.add('open');
}
function closeMoney() {
    document.getElementById('moneyModal').classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
}
function setMoney(n) { document.getElementById('moneyAmount').value = n; }
async function submitMoney() {
    if (!state.user) return;
    const amount = Number(document.getElementById('moneyAmount').value);
    if (!amount || isNaN(amount) || amount <= 0) return showToast('⚠️ Введите сумму', 'error');
    if (amount < 0.01) return showToast('⚠️ Минимум 0.01 ₽', 'error');
    const btn = document.getElementById('moneySubmit'); btn.disabled = true;
    try {
        if (state.moneyMode === 'withdraw') {
            const { user } = await api('/api/wallet/withdraw', { method: 'POST', body: { amount } });
            state.user = user; updateUI(); closeMoney();
            await loadDashboardData();
            showToast(`⏳ Заявка на вывод ${formatMoney(Math.round(amount * 100))} отправлена админу`);
        } else {
            const { user } = await api('/api/wallet/deposit', { method: 'POST', body: { amount } });
            state.user = user; updateUI(); closeMoney();
            await loadDashboardData();
            showToast(`✅ Баланс пополнен на ${formatMoney(Math.round(amount * 100))}`);
        }
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { btn.disabled = false; }
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
    if (u.avatar) preview.innerHTML = `<img src="${escapeHtml(u.avatar)}" alt="">`;
    else preview.textContent = u.name.charAt(0).toUpperCase();
    document.getElementById('profileModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('userMenu').classList.add('hidden');
}
function closeProfileEditor() {
    document.getElementById('profileModal').classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
}
async function handleProfileUpdate(e) {
    e.preventDefault();
    const name = document.getElementById('profileName').value.trim();
    const bio = document.getElementById('profileBio').value.trim();
    const currentPassword = document.getElementById('profileCurrentPass').value;
    const newPassword = document.getElementById('profileNewPass').value;
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    try {
        const { user } = await api('/api/profile/update', { method: 'POST', body: { name, bio, currentPassword, newPassword } });
        state.user = user; updateUI(); closeProfileEditor();
        showToast('✅ Профиль обновлён');
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { btn.disabled = false; }
}
async function uploadAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return showToast('❌ Максимум 5 МБ', 'error');
    const fd = new FormData(); fd.append('avatar', file);
    try {
        const { user } = await api('/api/profile/avatar', { method: 'POST', body: fd });
        state.user = user; updateUI();
        document.getElementById('avatarPreview').innerHTML = `<img src="${escapeHtml(user.avatar)}" alt="">`;
        showToast('✅ Аватар обновлён');
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
    e.target.value = '';
}

/* PROJECTS */
async function loadProjects() {
    const list = document.getElementById('projectsList');
    if (!list) return;
    if (!state.user) {
        list.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>Войдите, чтобы увидеть заказы</p></div>`;
        return;
    }
    try {
        const { projects } = await api('/api/projects');
        state.projects = projects;
        renderProjects();
    } catch (err) {
        list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escapeHtml(err.message)}</p></div>`;
    }
}
function renderProjects() {
    const list = document.getElementById('projectsList');
    if (!list) return;
    let items = state.projects;
    if (state.projectFilter !== 'all') items = items.filter(p => p.status === state.projectFilter);
    if (!items.length) {
        list.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>${state.projects.length ? 'В этой категории пусто' : 'Пока нет заказов'}</p></div>`;
        return;
    }
    list.innerHTML = items.map(p => {
        const canTake = state.user.role === 'executor' && p.status === 'open';
        const canOpen = p.clientId === state.user.id || (p.executor && p.executor.id === state.user.id)
            || state.user.role === 'admin' || state.user.role === 'manager' || state.user.role === 'executor';
        const clientAvatar = p.client.avatar ? `<img src="${escapeHtml(p.client.avatar)}" alt="">` : escapeHtml(p.client.name.charAt(0).toUpperCase());
        return `<div class="project-card" onclick="${canOpen ? `openProjectDetail(${p.id})` : `showToast('Возьмите заказ в работу')`}">
            <div class="project-head">
                <div>
                    <div class="project-title">${escapeHtml(p.title)}</div>
                    <div class="project-client"><span class="project-client-avatar">${clientAvatar}</span>${escapeHtml(p.client.name)}</div>
                </div>
                <span class="project-status status-${p.status}">${STATUS_LABELS[p.status]}</span>
            </div>
            <div class="project-desc">${escapeHtml(p.description)}</div>
            <div class="project-meta">
                <span class="project-category">${escapeHtml(p.category)}</span>
                <span class="project-budget">${p.budget > 0 ? formatMoney(p.budget) : 'Бюджет не указан'}</span>
            </div>
            ${p.executor ? `<div class="project-executor" style="margin-top:8px">Исполнитель: <b>${escapeHtml(p.executor.name)}</b></div>` : ''}
            ${canTake ? `<div class="project-actions"><button class="project-act-btn primary" onclick="event.stopPropagation(); acceptProject(${p.id})"><i class="fas fa-hand-paper"></i> Взять в работу</button></div>` : ''}
        </div>`;
    }).join('');
}
function filterProjects(status) {
    state.projectFilter = status;
    document.querySelectorAll('#projectFilters .filter').forEach(b => b.classList.toggle('active', b.dataset.status === status));
    renderProjects();
}
function openProjectCreator() {
    if (!state.user) return openAuth();
    if (state.user.role === 'executor') return showToast('⚠️ Исполнители не создают заказы', 'error');
    document.getElementById('projectModal').classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeProjectCreator() {
    document.getElementById('projectModal').classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
}
async function handleProjectCreate(e) {
    e.preventDefault();
    const title = document.getElementById('projTitle').value.trim();
    const description = document.getElementById('projDescription').value.trim();
    const category = document.getElementById('projCategory').value;
    const budget = Number(document.getElementById('projBudget').value) || 0;
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    try {
        await api('/api/projects', { method: 'POST', body: { title, description, category, budget } });
        closeProjectCreator(); e.target.reset(); await loadProjects();
        showToast('✅ Заказ создан');
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { btn.disabled = false; }
}
async function acceptProject(id) {
    try {
        await api(`/api/projects/${id}/accept`, { method: 'POST' });
        await loadProjects();
        showToast('✅ Заказ взят в работу');
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
async function openProjectDetail(id) {
    try {
        const { project } = await api(`/api/projects/${id}`);
        state.currentProject = project;
        renderProjectDetail(project);
        document.getElementById('projectDetailModal').classList.add('open');
        document.body.style.overflow = 'hidden';
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
function closeProjectDetail() {
    document.getElementById('projectDetailModal').classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
}
function renderProjectDetail(p) {
    const wrap = document.getElementById('projectDetailContent');
    const isClient = p.clientId === state.user.id;
    const isExecutor = p.executor && p.executor.id === state.user.id;
    const isAdmin = state.user.role === 'admin' || state.user.role === 'manager';
    const canChangeStatus = isClient || isExecutor || isAdmin;
    const statuses = ['open', 'in_progress', 'review', 'completed', 'cancelled'];
    wrap.innerHTML = `
        <div class="pd-title">${escapeHtml(p.title)}</div>
        <div style="margin-bottom:12px"><span class="project-status status-${p.status}">${STATUS_LABELS[p.status]}</span></div>
        <div class="pd-row"><span class="pd-label">Заказчик</span><span class="pd-value">${escapeHtml(p.client.name)}</span></div>
        <div class="pd-row"><span class="pd-label">Категория</span><span class="pd-value">${escapeHtml(p.category)}</span></div>
        <div class="pd-row"><span class="pd-label">Бюджет</span><span class="pd-value">${p.budget > 0 ? formatMoney(p.budget) : '—'}</span></div>
        ${p.executor ? `<div class="pd-row"><span class="pd-label">Исполнитель</span><span class="pd-value">${escapeHtml(p.executor.name)}</span></div>` : ''}
        <div class="pd-desc">${escapeHtml(p.description)}</div>
        <div class="pd-actions">
            ${p.executor ? `<button class="btn btn-outline" onclick="openChatWith(${p.executor.id})"><i class="fas fa-comments"></i> Написать исполнителю</button>` : ''}
        </div>
        ${canChangeStatus ? `
            <div class="section-divider"><span>Изменить статус</span></div>
            <div class="pd-actions" style="flex-wrap:wrap">
                ${statuses.filter(s => s !== p.status).map(s => `
                    <button class="project-act-btn" onclick="changeStatus(${p.id}, '${s}')">${STATUS_LABELS[s]}</button>
                `).join('')}
            </div>` : ''}
    `;
}
async function changeStatus(id, status) {
    try {
        await api(`/api/projects/${id}/status`, { method: 'POST', body: { status } });
        closeProjectDetail(); await loadProjects();
        showToast('✅ Статус обновлён');
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}

/* PORTFOLIO */
async function loadAllPortfolio() {
    const wrap = document.getElementById('portfolioGallery');
    if (!wrap) return;
    try {
        const { items } = await api('/api/portfolio/all');
        state.allPortfolio = items;
        renderAllPortfolio();
    } catch {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-image"></i><p>Не удалось загрузить работы</p></div>`;
    }
}
function renderAllPortfolio() {
    const wrap = document.getElementById('portfolioGallery');
    if (!wrap) return;
    let items = state.allPortfolio;
    if (state.portfolioFilter !== 'all') items = items.filter(i => i.category === state.portfolioFilter);
    if (!items.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-image"></i><p>Работы появятся здесь</p></div>`;
        return;
    }
    wrap.innerHTML = items.map((it, i) => `
        <div class="portfolio-item" onclick="openLightbox(${i})">
            <span class="portfolio-tag">${escapeHtml(it.category)}</span>
            <img src="${escapeHtml(it.filename)}" alt="${escapeHtml(it.title)}" loading="lazy">
            <div class="portfolio-info">
                <div class="portfolio-title">${escapeHtml(it.title)}</div>
                <div class="portfolio-author">
                    <span class="project-client-avatar">${it.authorAvatar ? `<img src="${escapeHtml(it.authorAvatar)}" alt="">` : escapeHtml((it.authorName || '?').charAt(0).toUpperCase())}</span>
                    ${escapeHtml(it.authorName || '—')}
                </div>
            </div>
        </div>
    `).join('');
}
function openLightbox(index) {
    let items = state.allPortfolio;
    if (state.portfolioFilter !== 'all') items = items.filter(i => i.category === state.portfolioFilter);
    const it = items[index];
    if (!it) return;
    document.getElementById('lbImg').src = it.filename;
    document.getElementById('lbTitle').textContent = it.title;
    document.getElementById('lbDesc').textContent = `${it.category} · ${it.authorName || ''}${it.description ? ' · ' + it.description : ''}`;
    document.getElementById('lightbox').classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeLightbox() {
    document.getElementById('lightbox').classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
}
function openMyPortfolio() {
    if (!state.user) return openAuth();
    if (!['executor', 'admin', 'manager'].includes(state.user.role)) return showToast('⚠️ Только для исполнителей', 'error');
    document.getElementById('myPortfolioModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('userMenu').classList.add('hidden');
    loadMyPortfolio();
}
function closeMyPortfolio() {
    document.getElementById('myPortfolioModal').classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
}
async function loadMyPortfolio() {
    try {
        const { items } = await api('/api/portfolio/me');
        state.myPortfolio = items;
        renderMyPortfolio();
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
function renderMyPortfolio() {
    const grid = document.getElementById('myPortfolioGrid');
    if (!grid) return;
    if (!state.myPortfolio.length) { grid.innerHTML = `<div class="empty-state small"><i class="fas fa-image"></i><p>Пока нет работ</p></div>`; return; }
    grid.innerHTML = state.myPortfolio.map(it => `
        <div class="my-portfolio-item">
            <img src="${escapeHtml(it.filename)}" alt="${escapeHtml(it.title)}">
            <button class="my-portfolio-delete" onclick="deletePortfolioItem(${it.id})">×</button>
        </div>
    `).join('');
}
function previewPortfolioFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { showToast('❌ Максимум 5 МБ', 'error'); e.target.value = ''; return; }
    document.getElementById('uploadZoneText').textContent = f.name;
}
async function handlePortfolioUpload(e) {
    e.preventDefault();
    const file = document.getElementById('portfolioInput').files?.[0];
    if (!file) return showToast('⚠️ Выберите файл', 'error');
    const title = document.getElementById('portTitle').value.trim();
    const description = document.getElementById('portDescription').value.trim();
    const category = document.getElementById('portCategory').value;
    if (!title) return showToast('⚠️ Укажите название', 'error');
    const fd = new FormData();
    fd.append('image', file); fd.append('title', title);
    fd.append('description', description); fd.append('category', category);
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    try {
        await api('/api/portfolio', { method: 'POST', body: fd });
        e.target.reset();
        document.getElementById('uploadZoneText').textContent = 'Нажмите, чтобы выбрать изображение';
        await loadMyPortfolio(); await loadAllPortfolio();
        showToast('✅ Работа загружена');
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { btn.disabled = false; }
}
async function deletePortfolioItem(id) {
    if (!confirm('Удалить работу?')) return;
    try {
        await api(`/api/portfolio/${id}`, { method: 'DELETE' });
        await loadMyPortfolio(); await loadAllPortfolio();
        showToast('🗑️ Удалено');
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}

/* SOCKET */
function connectSocket() {
    if (!getToken()) return;
    if (state.socket) state.socket.disconnect();
    state.socket = io({ auth: { token: getToken() } });
    state.socket.on('connect', () => { if (state.currentChatId) state.socket.emit('chat:join', { chatId: state.currentChatId }); });
    state.socket.on('chat:new', (msg) => {
        const arr = state.chatMessages[msg.chatId] || [];
        if (!arr.find(m => m.id === msg.id)) { arr.push(msg); state.chatMessages[msg.chatId] = arr; }
        if (state.currentChatId === msg.chatId) appendMessageToWindow(msg);
        loadChats();
    });
    state.socket.on('chat:notify', ({ chatId, message }) => {
        if (state.currentChatId !== chatId) {
            incrementUnreadBadge();
            showToast(`💬 ${message.senderName}: ${message.text.slice(0, 40)}`);
        }
    });
    state.socket.on('presence', ({ userId, online }) => {
        if (online) state.onlineUsers.add(userId); else state.onlineUsers.delete(userId);
        renderChatList();
    });
    state.socket.on('chat:typing', ({ name }) => {
        const el = document.getElementById('chatHeadRole');
        if (el) {
            const orig = el.dataset.orig || el.textContent;
            el.dataset.orig = orig;
            el.textContent = `${name} печатает...`;
            clearTimeout(el._t);
            el._t = setTimeout(() => { el.textContent = orig; }, 2000);
        }
    });
}
function incrementUnreadBadge() {
    const b1 = document.getElementById('chatBadge'), b2 = document.getElementById('msgrBadge');
    const cur = parseInt(b1.textContent || '0', 10) || 0;
    const next = cur + 1;
    [b1, b2].forEach(b => { if (b) { b.textContent = next; b.classList.remove('hidden'); } });
}

/* MESSENGER PANEL */
function openMessenger() {
    if (!state.user) return openAuth();
    document.getElementById('messenger').classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('userMenu').classList.add('hidden');
    loadChats();
    closeChat();
}
function closeMessenger() {
    document.getElementById('messenger').classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
    if (state.currentChatId) state.socket?.emit('chat:leave', { chatId: state.currentChatId });
    closeChat();
}
async function loadChats() {
    if (!state.user) return;
    try {
        const { chats } = await api('/api/chats');
        state.chats = chats;
        renderChatList();
        updateTotalUnread();
    } catch {}
}
function updateTotalUnread() {
    const total = state.chats.reduce((s, c) => s + c.unread, 0);
    const b1 = document.getElementById('chatBadge'), b2 = document.getElementById('msgrBadge');
    if (total > 0) [b1, b2].forEach(b => { if (b) { b.textContent = total > 99 ? '99+' : total; b.classList.remove('hidden'); } });
    else [b1, b2].forEach(b => { if (b) b.classList.add('hidden'); });
}
function renderChatList() {
    const list = document.getElementById('chatList');
    if (!list) return;
    if (!state.chats.length) {
        list.innerHTML = `<div class="empty-state small"><i class="fas fa-comments"></i><p>Нет чатов</p></div>`;
        return;
    }
    list.innerHTML = state.chats.map(c => {
        const peer = c.peer;
        const preview = c.lastMessage?.text || 'Нет сообщений';
        const time = c.lastMessage ? formatTime(c.lastMessage.createdAt) : '';
        const unread = c.unread > 0 ? `<span class="chat-unread">${c.unread}</span>` : '';
        const online = state.onlineUsers.has(peer.id) ? `<span class="chat-online"></span>` : '';
        return `<div class="chat-row" onclick="openChatWith(${peer.id})">
            <div class="chat-avatar">${userAvatarHtml(peer)}${online}</div>
            <div class="chat-info"><div class="chat-name">${escapeHtml(peer.name)}</div><div class="chat-preview">${escapeHtml(preview)}</div></div>
            <div class="chat-meta"><div class="chat-time">${time}</div>${unread}</div>
        </div>`;
    }).join('');
}
async function openChatWith(peerId) {
    if (!state.user) return openAuth();
    try {
        const { chatId } = await api('/api/chats', { method: 'POST', body: { peerId } });
        state.currentChatId = chatId;
        const chat = state.chats.find(c => c.id === chatId);
        if (chat) state.chatPeer = chat.peer;
        else {
            const usersRes = await api('/api/users/list');
            state.chatPeer = usersRes.users.find(u => u.id === peerId);
        }
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
        document.getElementById('messenger').classList.add('open');
        document.body.style.overflow = 'hidden';
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
function renderChatMessages(messages) {
    const wrap = document.getElementById('chatMessages');
    if (!wrap) return;
    if (!messages.length) { wrap.innerHTML = `<div class="empty-state small"><i class="fas fa-comment"></i><p>Начните переписку</p></div>`; return; }
    wrap.innerHTML = messages.map(m => msgHtml(m)).join('');
    wrap.scrollTop = wrap.scrollHeight;
}
function msgHtml(m) {
    const isOut = m.senderId === state.user.id;
    return `<div class="msg ${isOut ? 'msg-out' : 'msg-in'}">${escapeHtml(m.text)}<span class="msg-time">${formatTime(m.createdAt)}</span></div>`;
}
function appendMessageToWindow(m) {
    const wrap = document.getElementById('chatMessages');
    if (!wrap) return;
    const empty = wrap.querySelector('.empty-state');
    if (empty) empty.remove();
    wrap.insertAdjacentHTML('beforeend', msgHtml(m));
    wrap.scrollTop = wrap.scrollHeight;
}
function sendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || !state.currentChatId) return;
    if (!state.socket || !state.socket.connected) return showToast('⚠️ Нет соединения', 'error');
    state.socket.emit('chat:send', { chatId: state.currentChatId, text });
    input.value = '';
}
document.addEventListener('input', (e) => {
    if (e.target.id === 'chatInput' && state.currentChatId && state.socket) {
        clearTimeout(window._typingTimer);
        window._typingTimer = setTimeout(() => {
            state.socket.emit('chat:typing', { chatId: state.currentChatId });
        }, 300);
    }
});

/* ADMIN */
async function openAdminPanel() {
    if (!state.user || state.user.role !== 'admin') return showToast('⛔ Нет доступа', 'error');
    document.getElementById('adminModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('userMenu').classList.add('hidden');
    await loadAdminData();
    switchAdminTab('dashboard');
}
function closeAdminPanel() {
    document.getElementById('adminModal').classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
}
function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.atab === tab));
    document.getElementById('adminDashboard').classList.toggle('hidden', tab !== 'dashboard');
    document.getElementById('adminWithdrawals').classList.toggle('hidden', tab !== 'withdrawals');
    document.getElementById('adminRequests').classList.toggle('hidden', tab !== 'requests');
    document.getElementById('adminUsers').classList.toggle('hidden', tab !== 'users');
}
async function loadAdminData() {
    try {
        const [uR, rR, sR, wR] = await Promise.all([
            api('/api/admin/users'),
            api('/api/admin/requests'),
            api('/api/admin/stats'),
            api('/api/admin/withdrawals'),
        ]);
        state.adminUsers = uR.users;
        state.adminRequests = rR.requests;
        state.adminStats = sR;
        state.adminWithdrawals = wR.withdrawals;
        renderAdminDashboard();
        renderAdminWithdrawals();
        renderAdminRequests();
        renderAdminUsers();
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
function renderAdminDashboard() {
    const wrap = document.getElementById('dashboardStats');
    if (!wrap || !state.adminStats) return;
    const s = state.adminStats;
    wrap.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card stat-money stats-wide">
                <span class="stat-card-icon"><i class="fas fa-coins"></i></span>
                <div class="stat-card-value">${formatMoney(s.money.totalBalance)}</div>
                <div class="stat-card-label">Всего на счетах</div>
            </div>
            <div class="stat-card" style="border-color:rgba(250,204,21,0.35)">
                <span class="stat-card-icon"><i class="fas fa-hourglass-half"></i></span>
                <div class="stat-card-value">${s.withdrawals.pendingCount}</div>
                <div class="stat-card-label">Заявок на вывод</div>
            </div>
            <div class="stat-card" style="border-color:rgba(250,204,21,0.35)">
                <span class="stat-card-icon"><i class="fas fa-clock"></i></span>
                <div class="stat-card-value" style="font-size:1.1rem">${formatMoney(s.withdrawals.pendingSum)}</div>
                <div class="stat-card-label">Заморожено</div>
            </div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-users"></i></span><div class="stat-card-value">${s.users.total}</div><div class="stat-card-label">Пользователей</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-user-plus"></i></span><div class="stat-card-value">+${s.users.new7}</div><div class="stat-card-label">Новых за 7 дней</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-folder-open"></i></span><div class="stat-card-value">${s.projects.total}</div><div class="stat-card-label">Заказов</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-spinner"></i></span><div class="stat-card-value">${s.projects.inProgress}</div><div class="stat-card-label">В работе</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-check-circle"></i></span><div class="stat-card-value">${s.projects.completed}</div><div class="stat-card-label">Завершено</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-comments"></i></span><div class="stat-card-value">${s.messages.total}</div><div class="stat-card-label">Сообщений</div></div>
            <div class="stat-card"><span class="stat-card-icon"><i class="fas fa-image"></i></span><div class="stat-card-value">${s.portfolio.total}</div><div class="stat-card-label">Работ</div></div>
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
    const list = document.getElementById('withdrawalsList');
    const badge = document.getElementById('wdCount');
    if (!list) return;
    const pending = state.adminWithdrawals.filter(w => w.status === 'pending');
    badge.textContent = pending.length;
    if (!state.adminWithdrawals.length) {
        list.innerHTML = '<div class="admin-empty">💸 Нет заявок на вывод</div>';
        return;
    }
    list.innerHTML = state.adminWithdrawals.map(w => {
        const cls = WD_STATUS_CLASS[w.status] || 'status-review';
        const av = w.user.avatar
            ? `<img src="${escapeHtml(w.user.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
            : escapeHtml(w.user.name.charAt(0).toUpperCase());
        const actions = w.status === 'pending' ? `
            <div class="request-actions" style="margin-top:10px">
                <button class="admin-act-btn primary" onclick="approveWithdrawal(${w.id})"><i class="fas fa-check"></i> Одобрить</button>
                <button class="admin-act-btn danger" onclick="rejectWithdrawal(${w.id})"><i class="fas fa-times"></i> Отклонить</button>
            </div>` : '';
        return `<div class="withdrawal-card ${w.status === 'pending' ? 'pending' : ''}">
            <div class="wd-head">
                <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
                    <div class="admin-user-avatar" style="width:36px;height:36px;font-size:0.9rem">${av}</div>
                    <div style="min-width:0;flex:1">
                        <div class="wd-user">${escapeHtml(w.user.name)}</div>
                        <div class="wd-email">${escapeHtml(w.user.email)}</div>
                    </div>
                </div>
                <div class="wd-amount">${formatMoney(w.amount)}</div>
                <span class="project-status ${cls}">${WD_STATUS[w.status]}</span>
            </div>
            <div class="wd-date">Создано: ${formatDateTime(w.createdAt)}</div>
            ${w.reviewedAt ? `<div class="wd-date">Рассмотрено: ${formatDateTime(w.reviewedAt)}</div>` : ''}
            ${w.comment ? `<div class="wd-comment">💬 ${escapeHtml(w.comment)}</div>` : ''}
            ${actions}
        </div>`;
    }).join('');
}
async function approveWithdrawal(id) {
    if (!confirm('Подтвердить выплату? Деньги уйдут пользователю.')) return;
    try {
        await api(`/api/admin/withdrawals/${id}/approve`, { method: 'POST' });
        showToast('✅ Выплата одобрена');
        await loadAdminData();
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
async function rejectWithdrawal(id) {
    const comment = prompt('Причина отклонения (необязательно):', '');
    if (comment === null) return;
    try {
        await api(`/api/admin/withdrawals/${id}/reject`, { method: 'POST', body: { comment } });
        showToast('↩️ Заявка отклонена, деньги возвращены');
        await loadAdminData();
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
function renderAdminRequests() {
    const list = document.getElementById('requestsList');
    const badge = document.getElementById('reqCount');
    if (!list) return;
    badge.textContent = state.adminRequests.length;
    if (!state.adminRequests.length) { list.innerHTML = '<div class="admin-empty">🎉 Нет новых заявок</div>'; return; }
    list.innerHTML = state.adminRequests.map(u => {
        const dateStr = new Date(u.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const av = u.avatar ? `<img src="${escapeHtml(u.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : escapeHtml(u.name.charAt(0).toUpperCase());
        return `<div class="request-card">
            <div class="request-head">
                <div class="admin-user-avatar">${av}</div>
                <div class="request-info">
                    <div class="request-name">${escapeHtml(u.name)}</div>
                    <div class="request-role">→ ${ROLE_LABELS[u.requestedRole] || u.requestedRole}</div>
                    <div class="request-date">${escapeHtml(u.email)} · с ${dateStr}</div>
                </div>
            </div>
            <div class="request-actions">
                <button class="admin-act-btn primary" onclick="approveRequest(${u.id})"><i class="fas fa-check"></i> Одобрить</button>
                <button class="admin-act-btn danger" onclick="rejectRequest(${u.id})"><i class="fas fa-times"></i> Отклонить</button>
            </div>
        </div>`;
    }).join('');
}
function renderAdminUsers() {
    const list = document.getElementById('usersList');
    if (!list) return;
    const search = (document.getElementById('userSearch')?.value || '').trim().toLowerCase();
    let users = state.adminUsers.slice();
    if (search) users = users.filter(u => u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search));
    users.sort((a, b) => {
        if (a.isRoot && !b.isRoot) return -1;
        if (b.isRoot && !a.isRoot) return 1;
        if (a.role === 'admin' && b.role !== 'admin') return -1;
        if (b.role === 'admin' && a.role !== 'admin') return 1;
        return b.createdAt - a.createdAt;
    });
    if (!users.length) { list.innerHTML = '<div class="admin-empty">Ничего не найдено</div>'; return; }

    const me = state.user;
    const iAmRoot = me && me.isRoot;

    list.innerHTML = users.map(u => {
        const isSelf = me && u.id === me.id;
        const isRootUser = u.isRoot;
        const isAdminUser = u.role === 'admin';
        const selfTag = isSelf ? ' <span style="color:var(--text-mute);font-weight:500">(вы)</span>' : '';
        const rootTag = isRootUser ? ' <span style="color:#fbbf24;font-weight:700">👑</span>' : '';
        const av = u.avatar ? `<img src="${escapeHtml(u.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : escapeHtml(u.name.charAt(0).toUpperCase());

        const canChangeRole = iAmRoot ? !isSelf : (!isAdminUser && !isSelf);
        const canAdjustBalance = iAmRoot ? true : (!isAdminUser || isSelf);
        const canSetAdmin = iAmRoot && !isSelf;

        const roleButtons = canChangeRole ? `
            <button class="admin-act-btn" onclick="adminSetRole(${u.id},'client')">Клиент</button>
            <button class="admin-act-btn" onclick="adminSetRole(${u.id},'executor')">Исполнитель</button>
            <button class="admin-act-btn" onclick="adminSetRole(${u.id},'manager')">Менеджер</button>
            ${canSetAdmin ? `<button class="admin-act-btn" onclick="adminSetRole(${u.id},'admin')">Админ</button>` : ''}
        ` : `<span style="color:var(--text-mute);font-size:0.78rem;padding:6px 12px">${isRootUser ? '👑 Главный админ' : '🔒 Недоступно'}</span>`;

        const balanceButton = canAdjustBalance
            ? `<button class="admin-act-btn" onclick="adminAdjustBalance(${u.id})"><i class="fas fa-coins"></i> Баланс</button>`
            : '';

        return `<div class="admin-user-row">
            <div class="admin-user-avatar" ${isRootUser ? 'style="box-shadow:0 0 0 2px #fbbf24;"' : ''}>${av}</div>
            <div class="admin-user-info">
                <div class="admin-user-name">${escapeHtml(u.name)}${rootTag}${selfTag}</div>
                <div class="admin-user-email">${escapeHtml(u.email)}</div>
            </div>
            <span class="admin-user-role role-badge-${u.role}">${ROLE_LABELS[u.role] || u.role}</span>
            <span class="admin-user-balance">${formatMoney(u.balance)}</span>
            <div class="admin-user-actions">
                <button class="admin-act-btn primary" onclick="openUserFull(${u.id})"><i class="fas fa-eye"></i> История и баланс</button>
                ${roleButtons}
                ${balanceButton}
            </div>
        </div>`;
    }).join('');
}
async function approveRequest(userId) {
    try { await api('/api/admin/approve', { method: 'POST', body: { userId } });
        showToast('✅ Одобрено'); await loadAdminData(); await fetchMe();
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
async function rejectRequest(userId) {
    try { await api('/api/admin/reject', { method: 'POST', body: { userId } });
        showToast('❌ Отклонено'); await loadAdminData();
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
async function adminSetRole(userId, role) {
    try { await api('/api/admin/role', { method: 'POST', body: { userId, role } });
        showToast(`✅ Роль → ${ROLE_LABELS[role]}`); await loadAdminData(); await fetchMe();
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
async function adminAdjustBalance(userId) {
    const u = state.adminUsers.find(x => x.id === userId);
    if (!u) return;
    const input = prompt(`Изменить баланс ${u.name}\nТекущий: ${formatMoney(u.balance)}\n\nВведите число (500 — добавить, -200 — списать):`, '0');
    if (input === null) return;
    const amount = Number(input);
    if (!amount || isNaN(amount)) return showToast('⚠️ Некорректная сумма', 'error');
    try {
        await api('/api/admin/balance', { method: 'POST', body: { userId, amount } });
        showToast('✅ Баланс обновлён'); await loadAdminData(); await fetchMe();
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}

/* USER FULL */
let currentUserFullId = null;
let currentUserFullData = null;

async function openUserFull(userId) {
    currentUserFullId = userId;
    try {
        const data = await api(`/api/admin/users/${userId}/full`);
        currentUserFullData = data;
        renderUserFull(data);
        document.getElementById('userFullModal').classList.add('open');
        document.body.style.overflow = 'hidden';
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
}
function closeUserFull() {
    document.getElementById('userFullModal').classList.remove('open');
    if (!isAnyModalOpen()) document.body.style.overflow = '';
}
function renderUserFull(data) {
    const { user, transactions, withdrawals, stats } = data;
    const av = user.avatar
        ? `<img src="${escapeHtml(user.avatar)}" alt="">`
        : escapeHtml(user.name.charAt(0).toUpperCase());
    document.getElementById('userFullContent').innerHTML = `
        <div class="user-modal-head">
            <div class="user-modal-avatar">${av}</div>
            <div>
                <h3>${escapeHtml(user.name)}</h3>
                <div class="user-modal-email">${escapeHtml(user.email)}</div>
                <div style="margin-top:6px">
                    <span class="admin-user-role role-badge-${user.role}">${ROLE_LABELS[user.role] || user.role}</span>
                </div>
            </div>
        </div>
        <div class="user-modal-stats">
            <div class="user-modal-stat">
                <div class="user-modal-stat-value">${formatMoney(user.balance)}</div>
                <div class="user-modal-stat-label">Баланс</div>
            </div>
            <div class="user-modal-stat">
                <div class="user-modal-stat-value" style="color:var(--accent-3)">+${formatMoney(stats.totalIn)}</div>
                <div class="user-modal-stat-label">Пополнено</div>
            </div>
            <div class="user-modal-stat">
                <div class="user-modal-stat-value" style="color:var(--accent)">−${formatMoney(stats.totalOut)}</div>
                <div class="user-modal-stat-label">Списано</div>
            </div>
        </div>
        <div class="user-modal-tabs">
            <button class="user-modal-tab active" data-utab="tx" onclick="switchUserTab('tx')">
                <i class="fas fa-history"></i> Платежи (${transactions.length})
            </button>
            <button class="user-modal-tab" data-utab="wd" onclick="switchUserTab('wd')">
                <i class="fas fa-money-check-alt"></i> Выводы (${withdrawals.length})
            </button>
        </div>
        <div class="user-modal-panel" id="userFullTx">
            ${transactions.length ? transactions.map(t => {
                const dateStr = formatDateTime(t.date);
                const sign = t.type === 'in' ? '+' : '−';
                const icon = t.type === 'in' ? 'fa-arrow-down' : 'fa-arrow-up';
                return `<div class="tx-row">
                    <div class="tx-icon ${t.type}"><i class="fas ${icon}"></i></div>
                    <div class="tx-info">
                        <div class="tx-title">${escapeHtml(t.title)}</div>
                        <div class="tx-date">${dateStr}</div>
                    </div>
                    <div class="tx-amount ${t.type}">${sign} ${formatMoney(t.amount)}</div>
                </div>`;
            }).join('') : '<div class="tx-empty">Нет операций</div>'}
        </div>
        <div class="user-modal-panel hidden" id="userFullWd">
            ${withdrawals.length ? withdrawals.map(w => {
                const cls = WD_STATUS_CLASS[w.status] || 'status-review';
                return `<div class="withdrawal-card ${w.status === 'pending' ? 'pending' : ''}">
                    <div class="wd-head">
                        <div class="wd-amount">${formatMoney(w.amount)}</div>
                        <span class="project-status ${cls}">${WD_STATUS[w.status]}</span>
                    </div>
                    <div class="wd-date">Создано: ${formatDateTime(w.createdAt)}</div>
                    ${w.reviewedAt ? `<div class="wd-date">Рассмотрено: ${formatDateTime(w.reviewedAt)}</div>` : ''}
                    ${w.comment ? `<div class="wd-comment">💬 ${escapeHtml(w.comment)}</div>` : ''}
                </div>`;
            }).join('') : '<div class="tx-empty">Нет заявок на вывод</div>'}
        </div>
    `;
}
function switchUserTab(tab) {
    document.querySelectorAll('.user-modal-tab').forEach(t => t.classList.toggle('active', t.dataset.utab === tab));
    document.getElementById('userFullTx').classList.toggle('hidden', tab !== 'tx');
    document.getElementById('userFullWd').classList.toggle('hidden', tab !== 'wd');
}

/* SERVICE / PLAN / CONTACT */
function selectService(name, price) {
    showToast(`✨ ${name} — ${price}`);
    const select = document.getElementById('formService');
    if (select) {
        const found = Array.from(select.options).find(o => o.value === name || o.text === name);
        if (found) select.value = found.value;
    }
    scrollToSection('contact');
}
function selectPlan(name, price) {
    document.getElementById('planDisplay').textContent = `${name} — ${price}`;
    document.getElementById('selectedPlan').style.display = 'block';
    const msg = document.getElementById('formMessage');
    if (!msg.value.includes('Пакет:')) {
        msg.value = msg.value ? `${msg.value}\nПакет: ${name} (${price})` : `Пакет: ${name} (${price})`;
    }
    showToast(`✅ Пакет «${name}»`);
    scrollToSection('contact');
}
function handleSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('formName').value || 'Клиент';
    showToast(`🎉 ${name}, заявка отправлена!`);
    e.target.reset();
    document.getElementById('selectedPlan').style.display = 'none';
}

/* FILTERS */
document.querySelectorAll('#projectFilters .filter').forEach(btn => {
    btn.addEventListener('click', () => filterProjects(btn.dataset.status));
});
document.querySelectorAll('.port-filters .filter').forEach(btn => {
    btn.addEventListener('click', () => {
        state.portfolioFilter = btn.dataset.filter;
        document.querySelectorAll('.port-filters .filter').forEach(b => b.classList.toggle('active', b === btn));
        renderAllPortfolio();
    });
});
document.querySelectorAll('.service-card').forEach(card => {
    card.addEventListener('click', () => selectService(card.dataset.service, card.dataset.price));
});

/* SCROLL */
function animateOnScroll() {
    const els = document.querySelectorAll('.service-card, .pricing-card');
    const trigger = window.innerHeight - 100;
    els.forEach((el, i) => {
        if (el.classList.contains('visible')) return;
        if (el.getBoundingClientRect().top < trigger) setTimeout(() => el.classList.add('visible'), i * 60);
    });
}
function animateCounter(el, target, suffix = '', duration = 1500) {
    const st = performance.now();
    function u(now) {
        const p = Math.min((now - st) / duration, 1);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.floor(target * e);
        if (p < 1) requestAnimationFrame(u); else el.textContent = target + suffix;
    }
    requestAnimationFrame(u);
}
let statsAnimated = false;
function checkStats() {
    if (statsAnimated) return;
    const stats = document.querySelector('.about-grid');
    if (!stats) return;
    if (stats.getBoundingClientRect().top < window.innerHeight - 50) {
        statsAnimated = true;
        animateCounter(document.getElementById('stat1'), 50);
        animateCounter(document.getElementById('stat2'), 30);
        animateCounter(document.getElementById('stat3'), 5, ' дн.');
    }
}
function onScroll() {
    const y = window.scrollY;
    const header = document.getElementById('header'), scrollTop = document.getElementById('scrollTop');
    if (header) header.classList.toggle('scrolled', y > 20);
    if (scrollTop) scrollTop.classList.toggle('show', y > 500);
    animateOnScroll(); checkStats();
}
window.addEventListener('scroll', onScroll, { passive: true });

async function init() {
    await fetchMe();
    if (!state.user) { await loadProjects(); await loadAllPortfolio(); }
    setTimeout(onScroll, 200);
    console.log('🐾 Paw Art Studio v3.3 ready — главный админ защищён');
}
init();