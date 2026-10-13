/* Paw Art Studio — service descriptions and live price estimates */
(() => {
  'use strict';
  let activeCard = null;
  const money = (value) => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
  const modal = document.createElement('div');
  modal.className = 'paw-service-modal';
  modal.id = 'pawServiceModal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <section class="paw-service-dialog" role="dialog" aria-modal="true" aria-labelledby="pawServiceTitle">
      <button type="button" class="paw-service-close" aria-label="Закрыть">×</button>
      <h3 id="pawServiceTitle"></h3>
      <p id="pawServiceDescription"></p>
      <div class="paw-service-quantity" id="pawServiceQuantityWrap">
        <label for="pawServiceQuantity">Количество</label>
        <input type="number" id="pawServiceQuantity" min="1" max="1" value="1" inputmode="numeric">
      </div>
      <div class="paw-service-price" id="pawServicePrice"></div>
      <p id="pawServiceNote"></p>
      <div class="paw-service-actions">
        <button type="button" class="paw-service-order">Обсудить / оформить заказ</button>
        <button type="button" class="paw-service-cancel">Закрыть</button>
      </div>
    </section>`;
  document.body.appendChild(modal);
  const $ = (id) => document.getElementById(id);
  const close = () => {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };
  const updatePrice = () => {
    if (!activeCard) return;
    const kind = activeCard.dataset.kind;
    const min = Number(activeCard.dataset.min || 1);
    const max = Number(activeCard.dataset.max || 1);
    const price = Number(activeCard.dataset.unitPrice || 0);
    const input = $('pawServiceQuantity');
    let qty = Number(input.value);
    if (!Number.isFinite(qty)) qty = min;
    qty = Math.max(min, Math.min(max, Math.round(qty)));
    input.value = String(qty);
    $('pawServicePrice').textContent = kind === 'quote' ? activeCard.dataset.price : money(qty * price);
    $('pawServiceNote').textContent = kind === 'quote'
      ? 'Окончательная стоимость зависит от сложности и согласуется лично до начала работы.'
      : (kind === 'fixed' && qty === 0 ? 'Маскот не добавлен в заказ.' : 'Предварительная стоимость. Итог подтвердим перед началом работы.');
  };
  const open = (card) => {
    activeCard = card;
    const kind = card.dataset.kind || 'quote';
    const min = Number(card.dataset.min || 1);
    const max = Number(card.dataset.max || 1);
    $('pawServiceTitle').textContent = card.dataset.service || 'Услуга';
    $('pawServiceDescription').textContent = card.dataset.detail || card.querySelector('p')?.textContent || '';
    $('pawServiceQuantityWrap').hidden = kind === 'quote';
    $('pawServiceQuantity').min = String(min);
    $('pawServiceQuantity').max = String(max);
    $('pawServiceQuantity').value = String(min);
    updatePrice();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    modal.querySelector('.paw-service-close').focus();
  };
  document.addEventListener('click', (event) => {
    const card = event.target.closest('.paw-service-card');
    if (card) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      open(card);
      return;
    }
    if (event.target === modal || event.target.closest('.paw-service-close,.paw-service-cancel')) close();
    if (event.target.closest('.paw-service-order') && activeCard) {
      const qty = Number($('pawServiceQuantity').value || 1);
      const title = activeCard.dataset.service;
      const kind = activeCard.dataset.kind;
      const price = kind === 'quote' ? activeCard.dataset.price : $('pawServicePrice').textContent;
      const category = document.getElementById('projCategory');
      const titleInput = document.getElementById('projTitle');
      const description = document.getElementById('projDescription');
      const budget = document.getElementById('projBudget');
      if (category && Array.from(category.options).some((item) => item.value === title)) category.value = title;
      if (titleInput) titleInput.value = title + (kind === 'quote' ? '' : ' — ' + qty + ' шт.');
      if (description) description.value = (activeCard.dataset.detail || '') + (kind === 'quote' ? '' : '\nКоличество: ' + qty + '. Предварительная стоимость: ' + price + '.');
      if (budget) budget.value = kind === 'quote' ? '' : String(qty * Number(activeCard.dataset.unitPrice || 0));
      close();
      if (typeof window.openProjectCreator === 'function') window.openProjectCreator();
      else {
        const projectModal = document.getElementById('projectModal');
        if (projectModal) projectModal.classList.add('active');
        document.getElementById('projects')?.scrollIntoView({behavior:'smooth'});
      }
    }
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) close();
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.paw-service-card')) {
      event.preventDefault();
      open(event.target);
    }
  });
  $('pawServiceQuantity').addEventListener('input', updatePrice);
})();