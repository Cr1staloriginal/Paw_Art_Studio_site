/* Paw Art Studio — service details, quantity slider and live estimate */
(() => {
  'use strict';

  let activeCard = null;
  const locale = () => window.PAS_I18N?.language === 'en' ? 'en-US' : 'ru-RU';
  const tr = (ru, en) => locale() === 'en-US' ? en : ru;
  const money = (value) => new Intl.NumberFormat(locale(), {style:'currency',currency:'RUB',maximumFractionDigits:0}).format(value);
  const modal = document.createElement('div');
  modal.className = 'paw-service-modal';
  modal.id = 'pawServiceModal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <section class="paw-service-dialog" role="dialog" aria-modal="true" aria-labelledby="pawServiceTitle" aria-describedby="pawServiceDescription">
      <button type="button" class="paw-service-close" aria-label="Закрыть окно">×</button>
      <img class="paw-service-detail-image" id="pawServiceImage" alt="" hidden>
      <h3 id="pawServiceTitle"></h3>
      <p id="pawServiceDescription"></p>
      <div class="paw-service-quantity" id="pawServiceQuantityWrap">
        <div class="paw-service-quantity-head">
          <label for="pawServiceQuantity">Количество</label>
          <output id="pawServiceQuantityValue" for="pawServiceQuantity">1 шт.</output>
        </div>
        <input type="range" id="pawServiceQuantity" min="1" max="1" step="1" value="1" aria-label="Количество услуги">
        <div class="paw-service-range-limits"><span id="pawServiceMin"></span><span id="pawServiceMax"></span></div>
      </div>
      <div class="paw-service-price" id="pawServicePrice"></div>
      <p class="paw-service-note" id="pawServiceNote"></p>
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
    activeCard = null;
  };

  const updatePrice = () => {
    if (!activeCard) return;
    const kind = activeCard.dataset.kind || 'quote';
    const min = Number(activeCard.dataset.min ?? 1);
    const max = Number(activeCard.dataset.max ?? 1);
    const price = Number(activeCard.dataset.unitPrice ?? 0);
    const input = $('pawServiceQuantity');
    const qty = Math.max(min, Math.min(max, Math.round(Number(input.value) || 0)));
    input.value = String(qty);
    $('pawServiceQuantityValue').textContent = qty + ' ' + tr('шт.','pcs');
    $('pawServicePrice').textContent = kind === 'quote'
      ? (window.PAS_I18N?.t(activeCard.dataset.price || 'Стоимость обсуждается') || activeCard.dataset.price || tr('Стоимость обсуждается','Price to be discussed'))
      : (kind === 'fixed' && qty === 0 ? tr('Не добавлено','Not included') : money(qty * price));
    $('pawServiceNote').textContent = kind === 'quote'
      ? tr('Цена указана ориентировочно. До начала работы согласуем задачу, сроки и итоговую стоимость.','The price is indicative. We will agree on the task, timeline and final price before work begins.')
      : (kind === 'fixed' && qty === 0
        ? tr('Маскот не будет включён в заявку. Перед заказом его концепцию нужно обсудить лично.','The mascot will not be added to the request. Its concept must be discussed separately before ordering.')
        : tr('Это предварительный расчёт по выбранному количеству. Окончательную стоимость подтвердим до начала работы.','This is an estimate based on the selected quantity. The final price will be confirmed before work begins.'));
    $('pawServiceMin').textContent = min + ' ' + tr('шт.','pcs');
    $('pawServiceMax').textContent = max + ' ' + tr('шт.','pcs');
    modal.querySelector('.paw-service-order').disabled = kind === 'fixed' && qty === 0;
  };

  const open = (card) => {
    activeCard = card;
    const kind = card.dataset.kind || 'quote';
    const min = Number(card.dataset.min ?? 1);
    const max = Number(card.dataset.max ?? 1);
    $('pawServiceTitle').textContent = card.dataset.service || tr('Услуга','Service');
    $('pawServiceDescription').textContent = card.dataset.detail || card.querySelector('p')?.textContent || '';
    const sourceImage = card.querySelector('.service-image img, img');
    const detailImage = $('pawServiceImage');
    if (sourceImage?.getAttribute('src')) {
      detailImage.src = sourceImage.getAttribute('src');
      detailImage.alt = sourceImage.alt || (tr('Пример услуги «','Example service “') + (card.dataset.service || tr('Услуга','Service')) + (locale() === 'en-US' ? '”' : '»'));
      detailImage.hidden = false;
    } else {
      detailImage.removeAttribute('src');
      detailImage.alt = '';
      detailImage.hidden = true;
    }
    $('pawServiceQuantityWrap').hidden = kind === 'quote';
    $('pawServiceQuantity').min = String(min);
    $('pawServiceQuantity').max = String(max);
    $('pawServiceQuantity').step = '1';
    $('pawServiceQuantity').value = String(min);
    updatePrice();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    modal.querySelector('.paw-service-close').focus();
  };

  // Добавляем отдельную кнопку с подробностями в каждую карточку услуги.
  document.querySelectorAll('.paw-service-card').forEach((card) => {
    const content = card.querySelector('.service-content') || card;
    if (!content.querySelector('.paw-service-more')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'paw-service-more';
      button.textContent = tr('Подробнее','Details');
      button.setAttribute('aria-label', tr('Подробнее об услуге ','More about this service ') + (card.dataset.service || ''));
      content.appendChild(button);
    }
  });

  document.addEventListener('click', (event) => {
    const card = event.target.closest('.paw-service-card');
    if (card) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      open(card);
      return;
    }

    if (event.target === modal || event.target.closest('.paw-service-close,.paw-service-cancel')) {
      close();
      return;
    }

    if (event.target.closest('.paw-service-order') && activeCard) {
      const qty = Number($('pawServiceQuantity').value || 1);
      const title = activeCard.dataset.service;
      const kind = activeCard.dataset.kind || 'quote';
      if (kind === 'fixed' && qty === 0) return;

      const price = kind === 'quote' ? activeCard.dataset.price : $('pawServicePrice').textContent;
      const category = document.getElementById('projCategory');
      const titleInput = document.getElementById('projTitle');
      const description = document.getElementById('projDescription');

      if (category && Array.from(category.options).some((item) => item.value === title)) category.value = title;
      if (titleInput) titleInput.value = title + (kind === 'quote' ? '' : ' — ' + qty + ' ' + tr('шт.','pcs'));
      if (description) {
        description.value = (activeCard.dataset.detail || '') +
          (kind === 'quote' ? '' : '\n' + tr('Количество:','Quantity:') + ' ' + qty + '. ' + tr('Предварительная стоимость:','Estimated price:') + ' ' + (window.PAS_I18N?.t(price) || price) + '.');
      }
      // Поле бюджета убрано из формы заказа; предварительная цена остаётся в окне услуги.

      close();
      if (typeof window.openProjectCreator === 'function') {
        window.openProjectCreator();
      } else {
        const projectModal = document.getElementById('projectModal');
        if (projectModal) projectModal.classList.add('active');
        if (typeof window.scrollToSection === 'function') window.scrollToSection('services'); else document.getElementById('services')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  window.addEventListener('pas:languagechange', updatePrice);
})();