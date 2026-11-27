(() => {
  'use strict';
  const STORAGE_KEY = 'pas_language';
  const translations = {
    'Услуги':'Services','Заказы':'Orders','Портфолио':'Portfolio','О нас':'About us','Контакты':'Contact',
    'Войти':'Sign in','Выйти':'Sign out','Сообщения':'Messages','Найти пользователя':'Find a user',
    'Введите имя пользователя...':'Enter a username...','Написать сообщение...':'Write a message...',
    'Кабинет и баланс':'Account & balance','Редактировать профиль':'Edit profile','Моё портфолио':'My portfolio',
    'Админ-панель':'Admin panel','Редактор сайта':'Site editor','Пользователь':'User',
    'Клиент':'Client','Исполнитель':'Artist','Менеджер':'Manager','Администратор':'Administrator',
    'Визуал, который работает на вас':'Visuals that work for you',
    'Маскоты, стикеры, оформление для стримеров, серверов и брендов.':'Mascots, stickers and visuals for streamers, servers and brands.',
    'Заказать проект':'Order a project','Смотреть работы':'View portfolio',
    'Твой творческий напарник — Paw!':'Your creative companion — Paw!',
    'Маскоты, стикеры и визуал с характером ✨':'Mascots, stickers and visuals with personality ✨',
    'Создаём уникальный визуальный стиль для тебя, твоего проекта и сообщества.':'We create a unique visual identity for you, your project and your community.',
    'Готовые паки':'Ready-made bundles','Выбрать услугу':'Choose a service',
    'Есть идея для проекта?':'Have a project idea?','Подберём подходящую услугу и обсудим детали':'We’ll help you choose a service and discuss the details',
    'FAQ':'FAQ','Создать заказ':'Create an order','Опишите задачу':'Describe your task',
    'Название *':'Title *','Описание *':'Description *','Категория *':'Category *',
    'Бюджет заказа, ₽':'Order budget, ₽','Как с вами связаться? *':'How can we contact you? *',
    'Мессенджер Paw Art Studio':'Paw Art Studio messenger','Ваш контакт *':'Your contact *',
    'Исполнитель свяжется с вами выбранным способом. Переписка на сайте будет отключена.':'The artist will contact you using your selected method. Website messaging will be disabled.',
    'Промокод партнёра':'Partner promo code','Маскот':'Mascot','Стикеры':'Stickers','Баннеры':'Banners',
    'Аватарки':'Avatars','Арт':'Artwork','Анимация':'Animation','3D арт':'3D art','Другое':'Other',
    'Админ-панель':'Admin panel','Управление и статистика':'Management and statistics',
    'Статистика':'Statistics','Выплаты':'Payouts','Заявки':'Requests','Пользователи':'Users','Партнёры':'Partners',
    'Добавить официального партнёра':'Add an official partner','Добавить партнёра':'Add partner',
    'Начисления и заявки на выплаты':'Credits and payout requests','Поиск...':'Search...',
    'Сохранить':'Save','Сохранить всё':'Save all','Загрузить':'Upload','Закрыть':'Close',
    'Пополнение баланса':'Add funds','Выберите сумму или введите свою':'Choose an amount or enter your own',
    'Сумма (можно копейки)':'Amount (decimals allowed)','Перейти к оплате':'Continue to payment',
    'Комиссия':'Fee','Оплата через ЮKassa.':'Payments powered by YooKassa.',
    'Настройка пака':'Bundle configuration','Выбери состав комплекта':'Choose bundle contents',
    'Предварительная стоимость':'Estimated total','Заказать пак':'Order bundle',
    'Итоговая стоимость предварительная — детали и сроки согласуем перед началом работы.':'The total is an estimate. We’ll confirm the details and timeline before starting.',
    'Моё портфолио':'My portfolio','Загружайте свои работы':'Upload your work',
    'Нажмите, чтобы выбрать изображение':'Click to choose an image','Название':'Title','Описание':'Description',
    'Категория':'Category','Имя автора *':'Artist name *','Загрузить':'Upload',
    'Смена пароля':'Change password','Текущий пароль':'Current password','Новый пароль':'New password',
    'Сохранить':'Save','Создать заказ':'Create order','Загрузка профиля…':'Loading profile…',
    'Переписка внутри сайта будет доступна, если выбран этот способ связи.':'Website messaging is available when this contact method is selected.',
    'Пользовательское соглашение':'Terms of Service','Телефон':'Phone','Email':'Email',
    'Скоро здесь появятся наши партнёры.':'Our partners will appear here soon.',
    'Не удалось загрузить партнёров.':'Could not load partners.'
  };
  const reverse = Object.fromEntries(Object.entries(translations).map(([ru,en]) => [en,ru]));
  let language = localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ru';
  const original = new WeakMap();
  function translateValue(value) {
    const text = String(value ?? '');
    const trimmed = text.trim();
    if (!trimmed) return text;
    const translated = language === 'en' ? translations[trimmed] : reverse[trimmed];
    if (!translated) return text;
    return text.replace(trimmed, translated);
  }
  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!original.has(node)) original.set(node, node.nodeValue);
      const source = original.get(node);
      const key = source.trim();
      const translated = language === 'en' ? translations[key] : null;
      const nextValue = translated ? source.replace(key, translated) : source;
      if (node.nodeValue !== nextValue) node.nodeValue = nextValue;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    for (const attr of ['placeholder','title','aria-label','alt']) {
      if (!node.hasAttribute(attr)) continue;
      const keyAttr = 'data-pas-original-' + attr;
      if (!node.hasAttribute(keyAttr)) node.setAttribute(keyAttr, node.getAttribute(attr));
      const source = node.getAttribute(keyAttr);
      node.setAttribute(attr, translateValue(source));
    }
    node.childNodes.forEach(processNode);
  }
  function applyLanguage(next) {
    language = next === 'en' ? 'en' : 'ru';
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
    document.querySelectorAll('.pas-language-option').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.lang === language));
      button.classList.toggle('active', button.dataset.lang === language);
    });
    processNode(document.body);
    window.dispatchEvent(new CustomEvent('pas:languagechange', { detail: { language } }));
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('.pas-language-option');
    if (button) applyLanguage(button.dataset.lang);
  });
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(processNode);
      else if (record.type === 'characterData') processNode(record.target);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.PAS_I18N = {
    get language() { return language; },
    t(value) { return translateValue(value); },
    setLanguage: applyLanguage
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => applyLanguage(language), { once: true });
  else applyLanguage(language);
})();