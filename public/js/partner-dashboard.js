(() => {
  const TOKEN_KEY = 'paw_token';
  const notice = document.getElementById('notice');
  const dashboard = document.getElementById('dashboard');
  const locale = () => window.PAS_I18N?.language === 'en' ? 'en-US' : 'ru-RU';
  const tr = (ru, en) => locale() === 'en-US' ? en : ru;
  const money = cents => new Intl.NumberFormat(locale(), {style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(cents || 0) / 100);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => value ? new Date(Number(value)).toLocaleString(locale()) : '—';
  const statusLabel = status => ({
    pending: tr('На рассмотрении','Under review'),
    approved: tr('Одобрено','Approved'),
    paid: tr('Выплачено','Paid'),
    rejected: tr('Отклонено','Rejected'),
    reversed: tr('Сторнировано','Reversed')
  })[status] || status;
  async function api(path, options={}) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) throw new Error(tr('Сначала войдите в аккаунт на главной странице, затем откройте кабинет партнёра.','Please sign in on the home page first, then open the partner dashboard.'));
    const response = await fetch(path, {method:options.method || 'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:options.body ? JSON.stringify(options.body) : undefined});
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(window.PAS_I18N?.t(data.error || 'Ошибка запроса') || data.error || tr('Ошибка запроса','Request error'));
    return data;
  }
  function showError(message) { notice.textContent=window.PAS_I18N?.t(message) || message; notice.classList.remove('hidden'); }
  async function load() {
    try {
      const data = await api('/api/partner/me');
      const p=data.partner, s=data.stats;
      notice.classList.add('hidden'); dashboard.classList.remove('hidden');
      document.getElementById('partnerName').textContent=p.name;
      document.getElementById('partnerDescription').textContent=p.description || tr('Официальный партнёр Paw Art Studio','Official Paw Art Studio partner');
      document.getElementById('partnerTerms').textContent=tr('Скидка по промокодам: ','Promo code discount: ')+Number(p.discountPercent||0)+'% · '+tr('Вознаграждение: ','Reward: ')+Number(p.rewardPercent||0)+'% · '+tr('Минимальная выплата: ','Minimum payout: ')+money(p.payoutMinimum||100);
      const link=location.origin+'/?ref='+encodeURIComponent(p.referralCode);
      const linkEl=document.getElementById('partnerLink');linkEl.href=link;linkEl.textContent=link;
      for(const [id,value] of Object.entries({clicks:s.clicks,registrations:s.registrations,orders:s.orders,paidOrders:s.paidOrders,conversion:s.conversionPercent+'%',pending:money(s.pending),approved:money(s.approved),available:money(s.available),paid:money(s.paid)}))document.getElementById(id).textContent=value;
      document.getElementById('promoList').innerHTML=(data.promos||[]).map(x=>'<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)"><div><b>'+esc(x.code)+'</b> · '+tr('скидка','discount')+' '+Number(x.discount)+'%<div class="muted">'+tr('Использовано','Used')+' '+Number(x.uses)+(x.max_uses?' / '+Number(x.max_uses):'')+(x.expires_at?' · '+tr('до','until')+' '+date(x.expires_at):' · '+tr('без срока','no expiry'))+'</div></div><button class="secondary" data-copy-promo="'+esc(x.code)+'">'+tr('Копировать','Copy')+'</button></div>').join('')||tr('Активных промокодов пока нет.','No active promo codes yet.');
      document.getElementById('payoutHistory').innerHTML=(data.payouts||[]).map(x=>'<div style="padding:9px 0;border-bottom:1px solid var(--line)"><b>'+money(x.amount)+'</b> · '+esc(statusLabel(x.status))+'<div class="muted">'+date(x.created_at)+(x.comment?' · '+esc(x.comment):'')+'</div></div>').join('') || tr('Пока нет заявок.','No payout requests yet.');
      document.getElementById('ledgerRows').innerHTML=(data.ledger||[]).map(x=>'<tr><td>#'+x.project_id+'</td><td>'+money(x.order_amount)+'</td><td>'+money(x.reward_amount)+'</td><td>'+esc(statusLabel(x.status))+(Number(x.paid_amount)>0?' · '+tr('выплачено','paid')+' '+money(x.paid_amount):'')+'</td><td>'+date(x.created_at)+'</td></tr>').join('') || '<tr><td colspan="5">'+tr('Нет начислений.','No rewards yet.')+'</td></tr>';
    } catch(e) { showError(e.message); }
  }
  document.getElementById('payoutForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=event.currentTarget.querySelector('button[type=submit]');button.disabled=true;
    try {const paymentDetails=document.getElementById('paymentDetails').value.trim();const result=await api('/api/partner/payouts',{method:'POST',body:{paymentDetails}});document.getElementById('paymentDetails').value='';showError(result.message||tr('Заявка отправлена.','Request submitted.'));await load();}
    catch(e){showError(e.message);}
    finally{button.disabled=false;}
  });
  document.getElementById('promoList').addEventListener('click',async event=>{const button=event.target.closest('[data-copy-promo]');if(!button)return;try{await navigator.clipboard.writeText(button.dataset.copyPromo);notice.textContent=tr('Промокод скопирован: ','Promo code copied: ')+button.dataset.copyPromo;notice.classList.remove('hidden');}catch{showError(tr('Не удалось скопировать промокод.','Could not copy promo code.'));}});
  document.getElementById('copyLink').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(document.getElementById('partnerLink').href);notice.textContent=tr('Партнёрская ссылка скопирована.','Partner link copied.');notice.classList.remove('hidden');}
    catch{showError(tr('Не удалось скопировать ссылку. Скопируйте её вручную.','Could not copy the link. Please copy it manually.'));}
  });
  window.addEventListener('pas:languagechange', () => load());
  load();
})();