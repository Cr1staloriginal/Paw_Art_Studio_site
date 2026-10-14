(() => {
  'use strict';
  const token = () => localStorage.getItem('paw_token');
  const $ = id => document.getElementById(id);
  const notice = (message, type = '') => { const el = $('notice'); el.textContent = message; el.className = 'notice show' + (type ? ' ' + type : ''); };
  async function api(path, options = {}) {
    const headers = { Authorization: 'Bearer ' + (token() || ''), ...(options.headers || {}) };
    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || 'Ошибка ' + response.status); error.status = response.status; throw error; }
    return data;
  }
  const fmtDate = value => new Date(value).toLocaleString('ru-RU');
  const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function showError(error) {
    if (error.status === 401) notice('Сессия завершена. Войдите на сайт и откройте панель снова.', 'error');
    else if (error.status === 403) notice('Нет доступа. Учётной записи необходимо явно выдать право разработчика с согласия владельца сайта.', 'error');
    else notice(error.message || 'Не удалось выполнить запрос', 'error');
  }
  async function loadOverview() {
    try {
      const data = await api('/api/developer/overview');
      $('serviceStatus').textContent = data.service.status === 'ok' ? 'Работает' : 'Проблема';
      $('uptime').textContent = 'Работает ' + Math.floor(data.service.uptimeSeconds / 3600) + ' ч · ' + data.service.node;
      $('dbStatus').textContent = data.database.status === 'ok' ? 'Исправна' : 'Проверить';
      $('dbDetail').textContent = 'SQLite: ' + data.database.check;
      $('userCount').textContent = Number(data.counts.users).toLocaleString('ru-RU');
      $('yooStatus').textContent = data.payments.yookassaConfigured ? 'Настроена' : 'Не настроена';
      $('pendingCount').textContent = data.counts.paymentsPending;
      $('runtimeVersion').textContent = data.service.environment + ' · ' + data.service.node;
      $('updatedAt').textContent = 'Обновлено: ' + new Date().toLocaleTimeString('ru-RU');
      notice('Доступ подтверждён. Диагностика загружена.', 'success');
      renderLogs(data.recentErrors || []);
    } catch (error) { showError(error); }
  }
  function renderLogs(items) {
    const wrap = $('logsList');
    if (!items.length) { wrap.innerHTML = '<p class="muted">Записей пока нет. Логи процесса хранятся в памяти и очищаются при перезапуске.</p>'; return; }
    wrap.innerHTML = items.map(item => '<article class="log-entry"><span class="log-time">' + safe(fmtDate(item.at)) + '</span><span class="log-level">' + safe(item.level) + '</span><span class="log-message">' + safe(item.message) + '</span></article>').join('');
  }
  async function loadLogs() {
    try { const level = $('logLevel').value; const data = await api('/api/developer/logs?limit=200' + (level ? '&level=' + encodeURIComponent(level) : '')); renderLogs(data.logs || []); }
    catch (error) { showError(error); }
  }
  async function checkDatabase() {
    const btn = $('checkDbBtn'); btn.disabled = true; $('maintenanceResult').hidden = false; $('maintenanceResult').textContent = 'Проверяем…';
    try { const result = await api('/api/developer/database-check', { method: 'POST' }); $('maintenanceResult').textContent = JSON.stringify(result, null, 2); notice(result.ok ? 'Проверка базы данных завершена успешно.' : 'Проверка обнаружила проблему.', result.ok ? 'success' : 'error'); }
    catch (error) { $('maintenanceResult').textContent = error.message; showError(error); }
    finally { btn.disabled = false; }
  }
  async function backup() {
    const btn = $('backupBtn'); btn.disabled = true;
    try {
      const response = await fetch('/api/developer/backup', { method: 'POST', headers: { Authorization: 'Bearer ' + (token() || '') } });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw Object.assign(new Error(data.error || 'Не удалось создать бэкап'), { status: response.status }); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'paw-art-studio-backup.db'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); notice('Резервная копия скачана. Храните её в безопасном месте.', 'success');
    } catch (error) { showError(error); }
    finally { btn.disabled = false; }
  }
  $('refreshBtn').addEventListener('click', loadOverview);
  $('logsBtn').addEventListener('click', loadLogs);
  $('logLevel').addEventListener('change', loadLogs);
  $('checkDbBtn').addEventListener('click', checkDatabase);
  $('backupBtn').addEventListener('click', backup);
  if (!token()) notice('Сначала войдите в Paw Art Studio под уполномоченной учётной записью.', 'error');
  else loadOverview();
})();