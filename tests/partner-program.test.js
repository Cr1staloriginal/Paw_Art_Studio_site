const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

test('partner referral, discount, verified reward and payout lifecycle', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paw-partners-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const port = 32000 + (process.pid % 10000);
  const env = {
    ...process.env, NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1',
    DATABASE_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'uploads'),
    JWT_SECRET: 'test-secret-partner-suite', ADMIN_EMAIL: 'admin@test.local',
    ADMIN_PASSWORD: 'AdminTest123'
  };
  const child = spawn(process.execPath, ['server.js'], { env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  const db = new Database(dbPath);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitReady() {
    for (let i=0;i<80;i++) {
      try { const r=await fetch(base+'/health'); if(r.ok)return; } catch {}
      await sleep(250);
    }
    throw new Error('Server did not start');
  }
  async function request(url, options={}) {
    const r=await fetch(base+url,{...options,headers:{'Content-Type':'application/json',...(options.token?{Authorization:'Bearer '+options.token}:{}),...(options.headers||{})},body:options.body?JSON.stringify(options.body):undefined});
    const data=await r.json().catch(()=>({}));
    return {status:r.status,data};
  }
  async function login(email,password) {
    const r=await request('/api/auth/login',{method:'POST',body:{email,password}});
    assert.equal(r.status,200,JSON.stringify(r.data));
    return r.data.token;
  }
  t.after(async()=>{child.kill('SIGTERM');db.close();await sleep(150);fs.rmSync(dir,{recursive:true,force:true});});
  await waitReady();

  const adminToken=await login('admin@test.local','AdminTest123');
  const hash=bcrypt.hashSync('PartnerPass123',8);
  db.prepare("INSERT INTO users(name,email,password,role,email_verified,created_at,referral_code) VALUES('Partner','partner@test.local',?,'client',1,?, 'PARTNERUSER')").run(hash,Date.now());
  const created=await request('/api/admin/partners',{method:'POST',token:adminToken,body:{
    name:'Test Furry Server',referralCode:'TESTPAW',discountPercent:10,rewardPercent:5,
    contactEmail:'contact@test.local',accountEmail:'partner@test.local'
  }});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const partnerId=created.data.partner.id;
  const partnerToken=await login('partner@test.local','PartnerPass123');
  assert.equal((await request('/api/partner/me',{token:partnerToken})).status,200);

  const click=await request('/api/referrals/click/TESTPAW');
  assert.equal(click.status,200);
  assert.ok(click.data.partnerToken);
  const registered=await request('/api/auth/register',{method:'POST',body:{
    name:'Referred Customer',email:'customer@test.local',password:'CustomerPass123',ref:'TESTPAW',partnerToken:click.data.partnerToken
  }});
  assert.equal(registered.status,200,JSON.stringify(registered.data));
  db.prepare("UPDATE users SET email_verified=1 WHERE email='customer@test.local'").run();
  const customerToken=await login('customer@test.local','CustomerPass123');
  const customer=db.prepare("SELECT id,partner_id FROM users WHERE email='customer@test.local'").get();
  assert.equal(customer.partner_id,partnerId);

  const promo=await request('/api/admin/partners/'+partnerId+'/promos',{method:'POST',token:adminToken,body:{code:'TEST10',discountPercent:10}});
  assert.equal(promo.status,201);
  const inquiry=await request('/api/requests',{method:'POST',token:customerToken,body:{
    name:'Customer',service:'Mascot',promoCode:'TEST10',contactMethod:'Сайт'
  }});
  assert.equal(inquiry.status,201,JSON.stringify(inquiry.data));
  assert.equal(inquiry.data.discountPercent,10);
  const duplicatePromo=await request('/api/requests',{method:'POST',token:customerToken,body:{
    name:'Customer',service:'Mascot',promoCode:'TEST10',contactMethod:'Сайт'
  }});
  assert.equal(duplicatePromo.status,201);

  const project=await request('/api/projects',{method:'POST',token:customerToken,body:{
    title:'Test order',description:'Integration test',category:'Mascot',budget:1000,promoCode:'TEST10'
  }});
  assert.equal(project.status,201,JSON.stringify(project.data));
  assert.equal(project.data.project.base_budget,100000);
  assert.equal(project.data.project.budget,90000);
  assert.equal(project.data.project.discount_percent,10);
  const duplicateProject=await request('/api/projects',{method:'POST',token:customerToken,body:{title:'Duplicate',description:'Duplicate promo test',category:'Mascot',budget:1000,promoCode:'TEST10'}});
  assert.equal(duplicateProject.status,400);
  assert.equal((await request('/api/projects/'+project.data.project.id+'/pay',{method:'POST',token:customerToken,body:{}})).status,503);
  const projectId=project.data.project.id;
  assert.equal((await request('/api/projects/'+projectId+'/status',{method:'POST',token:customerToken,body:{status:'completed'}})).status,200);
  let adminData=(await request('/api/admin/partners',{token:adminToken})).data;
  let ledger=adminData.ledger.find(x=>x.project_id===projectId);
  assert.ok(ledger);
  assert.equal(ledger.status,'pending');
  assert.equal((await request('/api/admin/partner-ledger/'+ledger.id+'/approve',{method:'POST',token:adminToken,body:{}})).status,409);
  assert.equal((await request('/api/admin/projects/'+projectId+'/confirm-payment',{method:'POST',token:adminToken,body:{reference:'TEST-TRANSFER-001'}})).status,200);
  assert.equal((await request('/api/admin/partner-ledger/'+ledger.id+'/approve',{method:'POST',token:adminToken,body:{}})).status,200);
  let partnerData=(await request('/api/partner/me',{token:partnerToken})).data;
  assert.equal(partnerData.stats.available,4500);

  const payout=await request('/api/partner/payouts',{method:'POST',token:partnerToken,body:{paymentDetails:'Test bank account 0001'}});
  assert.equal(payout.status,201,JSON.stringify(payout.data));
  adminData=(await request('/api/admin/partners',{token:adminToken})).data;
  const payoutRow=adminData.payouts.find(x=>x.id===payout.data.id);
  assert.ok(payoutRow);
  assert.equal((await request('/api/admin/partner-payouts/'+payout.data.id,{method:'PATCH',token:adminToken,body:{status:'approved'}})).status,200);
  assert.equal((await request('/api/admin/partner-payouts/'+payout.data.id,{method:'PATCH',token:adminToken,body:{status:'paid',comment:'Transferred'}})).status,200);
  partnerData=(await request('/api/partner/me',{token:partnerToken})).data;
  assert.equal(partnerData.stats.available,0);
  assert.equal(partnerData.stats.paid,4500);

  assert.equal((await request('/api/projects/'+projectId+'/status',{method:'POST',token:customerToken,body:{status:'cancelled'}})).status,200);
  partnerData=(await request('/api/partner/me',{token:partnerToken})).data;
  assert.equal(partnerData.stats.available,-4500);
  assert.equal(partnerData.stats.paid,4500);
  const refund=await request('/api/admin/projects/'+projectId+'/refund',{method:'POST',token:adminToken,body:{reference:'REFUND-TEST-001',comment:'Returned to customer'}});
  assert.equal(refund.status,200,JSON.stringify(refund.data));

  const contest=await request('/api/admin/partners/'+partnerId+'/contests',{method:'POST',token:adminToken,body:{title:'Community Art Contest',prize:'Gift card'}});
  assert.equal(contest.status,201);
  const ad=await request('/api/admin/partners/'+partnerId+'/ads',{method:'POST',token:adminToken,body:{title:'Partner announcement',targetUrl:'https://example.com'}});
  assert.equal(ad.status,201);
  let publicData=(await request('/api/partners')).data;
  assert.equal(publicData.partners[0].contests.length,1);
  assert.equal(publicData.partners[0].ads.length,1);
  assert.equal((await request('/api/admin/partners/'+partnerId+'/campaigns/contests/'+contest.data.id,{method:'PATCH',token:adminToken,body:{active:false}})).status,200);
  publicData=(await request('/api/partners')).data;
  assert.equal(publicData.partners[0].contests.length,0);
  assert.equal(fs.existsSync(path.join(__dirname,'..','public','partner.html')),true);
});
