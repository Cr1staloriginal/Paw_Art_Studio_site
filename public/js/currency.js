/* Approximate USD display for RUB service prices. This does not change payment currency. */
(() => {
  'use strict';
  const selectors = '.services .price, #pawServicePrice, #packageTotalPrice, .package-total-price';
  let rubPerUsd = null;
  let rateDate = null;

  const locale = () => window.PAS_I18N?.language === 'en' ? 'en-US' : 'ru-RU';
  const note = () => window.PAS_I18N?.language === 'en'
    ? 'Approximate reference conversion only. Final price and payment remain in RUB.'
    : 'Примерный пересчёт по справочному курсу. Итоговая цена и оплата остаются в рублях.';

  function getAmount(text) {
    const match = String(text || '').match(/(\d[\d\s\u00a0]*(?:[.,]\d{1,2})?)\s*₽/);
    if (!match) return null;
    const value = Number(match[1].replace(/[\s\u00a0]/g, '').replace(',', '.'));
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function render(target) {
    const amount = getAmount(target.textContent);
    let output = target.nextElementSibling;
    if (output && !output.classList.contains('pas-usd-equivalent')) output = null;
    if (amount === null || !rubPerUsd) {
      if (output) output.remove();
      return;
    }
    if (!output) {
      output = document.createElement('small');
      output.className = 'pas-usd-equivalent';
      target.insertAdjacentElement('afterend', output);
    }
    const usd = amount / rubPerUsd;
    output.textContent = '≈ ' + new Intl.NumberFormat(locale(), {
      style: 'currency', currency: 'USD', maximumFractionDigits: 2
    }).format(usd);
    output.title = note() + (rateDate ? ' Rate date: ' + rateDate : '');
  }

  function refresh() {
    document.querySelectorAll(selectors).forEach(render);
  }

  const observer = new MutationObserver(records => {
    if (records.some(record => {
      const node = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      return !node?.closest('.pas-usd-equivalent');
    })) refresh();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  window.addEventListener('pas:languagechange', refresh);
  fetch('/api/exchange-rate', { headers: { Accept: 'application/json' } })
    .then(response => {
      if (!response.ok) throw new Error('Rate unavailable');
      return response.json();
    })
    .then(data => {
      const rate = Number(data.rubPerUsd);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid rate');
      rubPerUsd = rate;
      rateDate = data.date || null;
      refresh();
    })
    .catch(() => {
      // Keep original RUB prices visible if the reference-rate service is unavailable.
    });
  refresh();
})();
