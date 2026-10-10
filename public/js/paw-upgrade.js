/* Paw Art Studio — wallet / mascot upgrade.
   Loads after js/script.js. Backend endpoints are provided in server-patch/README.md. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (n) => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(n)||0) + ' ₽';

  function injectDashboard() {
    const wallet = $('dashWallet');
    if (!wallet || $('pawUpgradeTabs')) return;
    const tabs = document.createElement('div');
    tabs.id = 'pawUpgradeTabs';
    tabs.className = 'paw-upgrade-tabs';
    tabs.innerHTML = `
      <button class="active" data-paw-tab="promo">🎟️ Промокод</button>
      <button data-paw-tab="referral">🎁 Рефералы</button>
      <button data-paw-tab="support">💬 Поддержка</button>`;
    const panels = document.createElement('div');
    panels.id = 'pawUpgradePanels';
    panels.innerHTML = `
      <section class="paw-upgrade-panel" data-paw-panel="promo">
        <h4>Активировать промокод</h4>
        <p class="paw-upgrade-muted">Введи код, чтобы получить доступную скидку или бонус на баланс.</p>
        <form id="pawPromoForm" class="paw-upgrade-row">
          <input id="pawPromoCode" maxlength="40" autocomplete="off" placeholder="Например, PAWSTART" required>
          <button class="btn" type="submit">Активировать</button>
        </form>
        <p id="pawPromoMessage" class="paw-upgrade-muted" aria-live="polite"></p>
      </section>
      <section class="paw-upgrade-panel" data-paw-panel="referral" hidden>
        <h4>Приглашай друзей 🐾</h4>
        <p class="paw-upgrade-muted">Поделись персональной ссылкой. Здесь можно посмотреть количество переходов по ней. Начисление бонусов требует отдельной настройки правил студии.</p>
        <div class="paw-upgrade-code" id="pawReferralLink">Загружаем ссылку…</div>
        <div class="paw-upgrade-row"><button class="btn" id="pawCopyReferral">Скопировать ссылку</button></div>
        <p id="pawReferralStats" class="paw-upgrade-muted"></p>
      </section>
      <section class="paw-upgrade-panel" data-paw-panel="support" hidden>
        <h4>Нужен вывод средств?</h4>
        <p class="paw-upgrade-muted">Для безопасности прямой вывод отключён. Напиши в поддержку — сотрудник проверит баланс и поможет оформить выплату вручную.</p>
        <div class="paw-upgrade-row"><a class="btn paw-support-button" id="pawSupportLink" href="mailto:support@pawartstudio.store?subject=Запрос%20на%20вывод%20средств">💬 Обратиться в поддержку</a></div>
        <p class="paw-upgrade-muted">Перед запуском замени адрес поддержки на актуальный контакт студии.</p>
      </section>`;
    wallet.insertAdjacentElement('afterend', tabs);
    tabs.insertAdjacentElement('afterend', panels);

    tabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-paw-tab]');
      if (!button) return;
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === button));
      panels.querySelectorAll('[data-paw-panel]').forEach(p => p.hidden = p.dataset.pawPanel !== button.dataset.pawTab);
    });

    $('pawPromoForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = $('pawPromoCode').value.trim();
      const msg = $('pawPromoMessage');
      const button = event.submitter;
      if (!code) return;
      if (typeof api !== 'function') { msg.textContent = 'Не удалось подключиться к API.'; return; }
      if (button) button.disabled = true;
      msg.textContent = 'Проверяем код…';
      try {
        const result = await api('/api/wallet/promo/redeem', {method:'POST', body:{code}});
        if (result.user && typeof state !== 'undefined') { state.user = result.user; if (typeof updateUI === 'function') updateUI(); }
        msg.textContent = result.message || 'Промокод применён!';
        $('pawPromoCode').value = '';
        if (typeof loadDashboardData === 'function') await loadDashboardData();
      } catch (error) {
        msg.textContent = error.message || 'Не удалось применить промокод.';
      } finally { if (button) button.disabled = false; }
    });

    $('pawCopyReferral').addEventListener('click', async () => {
      const text = $('pawReferralLink').textContent.trim();
      try { await navigator.clipboard.writeText(text); $('pawCopyReferral').textContent = 'Скопировано ✓'; }
      catch { window.prompt('Скопируй ссылку:', text); }
    });
    loadReferral();
  }

  async function loadReferral() {
    if (!$('pawReferralLink') || typeof api !== 'function') return;
    try {
      const data = await api('/api/referrals/me');
      $('pawReferralLink').textContent = data.link;
      $('pawReferralStats').textContent = `Переходов по ссылке: ${data.clicks || 0}`;
    } catch (e) {
      $('pawReferralLink').textContent = 'Ссылка появится после входа в аккаунт.';
      $('pawReferralStats').textContent = e.message || '';
    }
  }

  const oldOpenWithdraw = window.openWithdraw;
  window.openWithdraw = function () {
    if (!window.state || !state.user) return typeof openAuth === 'function' ? openAuth() : undefined;
    const tabs = $('pawUpgradeTabs');
    if (tabs) {
      tabs.querySelector('[data-paw-tab="support"]').click();
      tabs.scrollIntoView({behavior:'smooth',block:'center'});
    } else {
      const message = 'Для вывода средств напиши в поддержку Paw Art Studio.';
      if (confirm(message + '\\nОткрыть письмо в поддержку?')) location.href = 'mailto:support@pawartstudio.store?subject=Запрос%20на%20вывод%20средств';
    }
  };

  function replaceHeroGallery() {
    const gallery = document.querySelector('.hero-gallery');
    if (!gallery || gallery.dataset.pawReplaced) return;
    gallery.dataset.pawReplaced = '1';
    gallery.classList.add('paw-mascot-card');
    gallery.innerHTML = `
      <div class="paw-mascot-art" role="img" aria-label="Маскот Paw Art Studio — пушистая альпака">🦙</div>
      <div class="paw-mascot-copy"><strong>Твой творческий напарник — Paw!</strong><span>Маскоты, стикеры и визуал с характером ✨</span></div>`;
  }

  function init() {
    injectDashboard();
    replaceHeroGallery();
    const dashboard = $('dashboardModal');
    if (dashboard && window.MutationObserver) {
      new MutationObserver(() => { if (dashboard.classList.contains('open')) loadReferral(); })
        .observe(dashboard, {attributes:true,attributeFilter:['class']});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
