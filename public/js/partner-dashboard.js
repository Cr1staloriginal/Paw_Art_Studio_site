(() => {
  const TOKEN_KEY = 'paw_token';
  const notice = document.getElementById('notice');
  const dashboard = document.getElementById('dashboard');
  const money = cents => (Number(cents || 0) / 100).toLocaleString('ru-RU', {minimumFractionDigits:0, maximumFractionDigits:2}) + ' ₽';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => value ? new Date(Number(value)).toLocaleString('ru-RU') : '—';
  const statuses = {pending:'На рассмотрении',approved:'Одобрено',paid:'Выплачено',rejected:'Отклонено',reversed:'Сторнировано'};
  async function api(path, options={}) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) throw new Error('Сначала войдите в аккаунт на главной странице, затем откройте кабинет партнёра.');
    const response = await fetch(path, {method:options.method || 'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:options.body ? JSON.stringify(options.body) : undefined});
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  }
  function showError(message) { notice.textContent=message; notice.classList.remove('hidden'); }
  async function load() {
    try {
      const data = await api('/api/partner/me');
      const p=data.partner, s=data.stats;
      notice.classList.add('hidden'); dashboard.classList.remove('hidden');
      document.getElementById('partnerName').textContent=p.name;
      document.getElementById('partnerDescription').textContent=p.description || 'Официальный партнёр Paw Art Studio';
      const link=location.origin+'/?ref='+encodeURIComponent(p.referralCode);
      const linkEl=document.getElementById('partnerLink');linkEl.href=link;linkEl.textContent=link;
      for(const [id,value] of Object.entries({clicks:s.clicks,registrations:s.registrations,orders:s.orders,paidOrders:s.paidOrders,conversion:s.conversionPercent+'%',pending:money(s.pending),approved:money(s.approved),available:money(s.available),paid:money(s.paid)}))document.getElementById(id).textContent=value;
      document.getElementById('payoutHistory').innerHTML=(data.payouts||[]).map(x=>'<div style="padding:9px 0;border-bottom:1px solid var(--line)"><b>'+money(x.amount)+'</b> · '+esc(statuses[x.status]||x.status)+'<div class="muted">'+date(x.created_at)+(x.comment?' · '+esc(x.comment):'')+'</div></div>').join('') || 'Пока нет заявок.';
      document.getElementById('ledgerRows').innerHTML=(data.ledger||[]).map(x=>'<tr><td>#'+x.project_id+'</td><td>'+money(x.order_amount)+'</td><td>'+money(x.reward_amount)+'</td><td>'+esc(statuses[x.status]||x.status)+(Number(x.paid_amount)>0?' · выплачено '+money(x.paid_amount):'')+'</td><td>'+date(x.created_at)+'</td></tr>').join('') || '<tr><td colspan="5">Нет начислений.</td></tr>';
    } catch(e) { showError(e.message); }
  }
  document.getElementById('payoutForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=event.currentTarget.querySelector('button[type=submit]');button.disabled=true;
    try {const paymentDetails=document.getElementById('paymentDetails').value.trim();const result=await api('/api/partner/payouts',{method:'POST',body:{paymentDetails}});document.getElementById('paymentDetails').value='';showError(result.message||'Заявка отправлена.');await load();}
    catch(e){showError(e.message);}
    finally{button.disabled=false;}
  });
  document.getElementById('copyLink').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(document.getElementById('partnerLink').href);notice.textContent='Партнёрская ссылка скопирована.';notice.classList.remove('hidden');}
    catch{showError('Не удалось скопировать ссылку. Скопируйте её вручную.');}
  });
  load();
})();