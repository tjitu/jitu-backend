const { before,after,test }=require('node:test');
const assert=require('node:assert/strict');
const { randomUUID }=require('node:crypto');
const { createTestDatabase,fixture,acceptLatest,quote,payment,boost }=require('./affiliate-fixture.cjs');
let db,pool;
before(async () => { db=await createTestDatabase(); pool=db.pool; });
after(async () => { await db?.cleanup(); });

test('standard affiliate uses 15% discount and 10% of eligible paid IDR',async () => {
  const f=await fixture(pool),q=await quote(pool,f.voucher);
  assert.equal(q.originalAmount,11000); assert.equal(q.discountAmount,1650); assert.equal(q.paidAmount,9350);
  assert.equal(q.commission,935); assert.equal(q.paidAmount-q.commission,8415);
  assert.equal(new Date(q.expiresAt)-new Date(q.createdAt),15*60000);
});
test('non-affiliate promotion retains its own pricing and no attribution',async () => {
  const id=randomUUID(); await pool.query('INSERT INTO "Voucher" (id,code,"discountPercent") VALUES ($1,$1,40)',[id]);
  assert.equal(await quote(pool,id),null);
});
test('agreement and active account are required server side',async () => {
  const f=await fixture(pool,false);
  await assert.rejects(boost(pool,f.id),/AGREEMENT_REQUIRED/);
  await assert.rejects(quote(pool,f.voucher),/AGREEMENT_REQUIRED/);
  await acceptLatest(pool,f.id);
  await pool.query('UPDATE "AffiliateProfile" SET "isActive"=false WHERE id=$1',[f.id]);
  await assert.rejects(boost(pool,f.id),/inactive/);
});
test('commission and discount boost stack; each discount category is exclusive',async () => {
  const f=await fixture(pool);
  const commission=await boost(pool,f.id),discount=await boost(pool,f.id,'SUPER_DISCOUNT');
  assert.equal(new Date(commission.expiresAt)-new Date(commission.activatedAt),86400000);
  assert.equal(new Date(discount.expiresAt)-new Date(discount.activatedAt),86400000);
  const q=await quote(pool,f.voucher); assert.equal(q.discountRate,2500); assert.equal(q.commissionRate,1500);
  assert.equal(q.discountAmount,2750); assert.equal(q.commission,1238); assert.equal(q.boostIds.length,2);
  await assert.rejects(boost(pool,f.id,'DISCOUNT'),/already active/);
  await assert.rejects(boost(pool,f.id,'COMMISSION'),/already active/);
});
test('default monthly quota is 10/10/5 and reset is idempotent in Jakarta',async () => {
  const f=await fixture(pool);
  await Promise.all(Array.from({length:6},() => pool.query('SELECT affiliate_ensure_quota($1)',[f.id])));
  const {rows}=await pool.query('SELECT type,allocated,bonus,used,month FROM "AffiliateQuota" WHERE "affiliateId"=$1 ORDER BY type',[f.id]);
  assert.deepEqual(rows.map(q => [q.type,q.allocated]),[['COMMISSION',10],['DISCOUNT',10],['SUPER_DISCOUNT',5]]);
  assert.equal(rows.length,3);
  const boundary=await pool.query(`SELECT to_char('2026-11-30T17:00:00Z'::timestamptz AT TIME ZONE 'Asia/Jakarta','YYYY-MM') AS month`);
  assert.equal(boundary.rows[0].month,'2026-12');
  await pool.query(`INSERT INTO "AffiliateQuota" (id,"affiliateId",month,type,allocated,bonus,used) VALUES ($1,$2,'2026-01','COMMISSION',100,100,0)`,[randomUUID(),f.id]);
  await pool.query('SELECT affiliate_ensure_quota($1)',[f.id]);
  const current=(await pool.query('SELECT allocated,bonus FROM "AffiliateQuota" WHERE "affiliateId"=$1 AND month=$2 AND type=$3',[f.id,rows[0].month,'COMMISSION'])).rows[0];
  assert.deepEqual(current,{allocated:10,bonus:0});
});
test('expired boosts revert to base and exhaustion prevents another activation',async () => {
  const f=await fixture(pool);
  await pool.query('SELECT affiliate_ensure_quota($1)',[f.id]);
  const q=(await pool.query('SELECT * FROM "AffiliateQuota" WHERE "affiliateId"=$1 AND type=$2',[f.id,'COMMISSION'])).rows[0];
  await pool.query(`INSERT INTO "AffiliateBoost" (id,"affiliateId","quotaId",type,"group","baseRate",additional,"activatedAt","expiresAt","requestKey")
    VALUES ($1,$2,$3,'COMMISSION','COMMISSION',1000,500,NOW()-interval '25 hours',NOW()-interval '1 hour',$1)`,[randomUUID(),f.id,q.id]);
  assert.equal((await quote(pool,f.voucher)).commissionRate,1000);
  await pool.query('UPDATE "AffiliateQuota" SET used=allocated+bonus WHERE id=$1',[q.id]);
  await assert.rejects(boost(pool,f.id),/Insufficient/);
});
test('payment recognition is idempotent and snapshots survive reassignment',async () => {
  const a=await fixture(pool),b=await fixture(pool),q=await quote(pool,a.voucher),p=await payment(pool,q);
  assert.equal((await pool.query('SELECT count(*) FROM "AffiliateLedger" WHERE "checkoutId"=$1',[q.id])).rows[0].count,'0');
  await pool.query('UPDATE "Voucher" SET "affiliateId"=$2 WHERE id=$1',[a.voucher,b.id]);
  await pool.query(`UPDATE "Payment" SET status='CONFIRMED' WHERE id=$1`,[p]);
  await pool.query(`UPDATE "Payment" SET status='CONFIRMED' WHERE id=$1`,[p]);
  const entries=(await pool.query('SELECT * FROM "AffiliateLedger" WHERE "checkoutId"=$1',[q.id])).rows;
  assert.equal(entries.length,1); assert.equal(entries[0].affiliateId,a.id); assert.equal(entries[0].amount,935);
  await assert.rejects(pool.query('UPDATE "AffiliateCheckout" SET commission=1 WHERE id=$1',[q.id]),/immutable/);
  await assert.rejects(pool.query('DELETE FROM "AffiliateLedger" WHERE "checkoutId"=$1',[q.id]),/immutable/);
  await assert.rejects(pool.query('UPDATE "Payment" SET "affiliateCheckoutId"=NULL WHERE id=$1',[p]),/immutable/);
});
test('partial/full refund adjustments are cumulative, traceable, and idempotent',async () => {
  const f=await fixture(pool),q=await quote(pool,f.voucher),p=await payment(pool,q,'CONFIRMED');
  await pool.query('SELECT affiliate_refund($1,1000)',[p]);
  await pool.query('SELECT affiliate_refund($1,1000)',[p]);
  assert.equal((await pool.query('SELECT sum(amount)::int AS amount FROM "AffiliateLedger" WHERE "checkoutId"=$1',[q.id])).rows[0].amount,835);
  await pool.query('SELECT affiliate_refund($1,9350)',[p]); await pool.query('SELECT affiliate_refund($1,500)',[p]);
  const total=(await pool.query('SELECT sum(amount)::int AS amount,count(*)::int AS count FROM "AffiliateLedger" WHERE "checkoutId"=$1',[q.id])).rows[0];
  assert.deepEqual(total,{amount:0,count:3});
  await assert.rejects(pool.query('SELECT affiliate_refund($1,10000)',[p]),/Invalid/);
});
test('config/accepted snapshots are immutable and new required agreement blocks future activations',async () => {
  const f=await fixture(pool),q=await quote(pool,f.voucher);
  await assert.rejects(pool.query('UPDATE "AffiliateAcceptance" SET snapshot=$2 WHERE "affiliateId"=$1',[f.id,'tampered']),/immutable/);
  await assert.rejects(pool.query('UPDATE "AffiliateAgreement" SET content=$1 WHERE id=$2',['tampered','required']),/new agreement version/);
  const version=(await pool.query('SELECT max(version)+1 AS version FROM "AffiliateAgreement"')).rows[0].version;
  const id=randomUUID();
  await pool.query(`INSERT INTO "AffiliateAgreement" (id,version,title,content,party,status,"effectiveAt","publishedAt")
    VALUES ($1,$2,'New test terms','Updated test content','Test party','PUBLISHED',NOW()-interval '1 minute',NOW())`,[id,version]);
  await assert.rejects(boost(pool,f.id),/AGREEMENT_REQUIRED/);
  assert.equal(q.commission,935);
  const p=await payment(pool,q,'CONFIRMED'); assert.ok(p);
  assert.equal((await pool.query('SELECT sum(amount)::int AS amount FROM "AffiliateLedger" WHERE "checkoutId"=$1',[q.id])).rows[0].amount,935);
  await acceptLatest(pool,f.id); await boost(pool,f.id);
});
test('RLS and function privileges deny browser database roles',async () => {
  const rows=(await pool.query(`SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('AffiliateLedger','AffiliateAcceptance','AffiliateProfile')`)).rows;
  assert.equal(rows.length,3); assert.ok(rows.every(r => r.relrowsecurity));
  const f=(await pool.query(`SELECT has_function_privilege('public','affiliate_activate(text,text,text)','EXECUTE') AS allowed`)).rows[0];
  assert.equal(f.allowed,false);
});
test('a valid checkout retains boost rates after expiration; a new checkout uses current rates',async () => {
  const f=await fixture(pool); await pool.query('SELECT affiliate_ensure_quota($1)',[f.id]);
  const quota=(await pool.query('SELECT id FROM "AffiliateQuota" WHERE "affiliateId"=$1 AND type=$2',[f.id,'COMMISSION'])).rows[0].id;
  await pool.query(`INSERT INTO "AffiliateBoost" (id,"affiliateId","quotaId",type,"group","baseRate",additional,"activatedAt","expiresAt","requestKey")
    VALUES ($1,$2,$3,'COMMISSION','COMMISSION',1000,500,NOW()-interval '24 hours'+interval '2 seconds',NOW()+interval '2 seconds',$1)`,[randomUUID(),f.id,quota]);
  const original=await quote(pool,f.voucher); assert.equal(original.commissionRate,1500);
  await new Promise(resolve => setTimeout(resolve,2200));
  const latest=await quote(pool,f.voucher); assert.equal(latest.commissionRate,1000);
  await payment(pool,original,'CONFIRMED');
  assert.equal((await pool.query('SELECT amount FROM "AffiliateLedger" WHERE "checkoutId"=$1',[original.id])).rows[0].amount,1403);
});
test('paid commission remains traceable as a negative balance after a refund',async () => {
  const f=await fixture(pool),q=await quote(pool,f.voucher),p=await payment(pool,q,'CONFIRMED'),key=randomUUID();
  await pool.query(`SELECT affiliate_payout($1,935,NOW(),$2,'PAID','test',$2,'admin')`,[f.id,key]);
  await pool.query('SELECT affiliate_refund($1,9350)',[p]);
  const result=(await pool.query(`SELECT (SELECT sum(amount) FROM "AffiliateLedger" WHERE "affiliateId"=$1)-
    (SELECT sum(amount) FROM "AffiliatePayout" WHERE "affiliateId"=$1 AND status='PAID') AS outstanding`,[f.id])).rows[0];
  assert.equal(Number(result.outstanding),-935);
  await assert.rejects(pool.query('SELECT affiliate_payout($1,1,NOW(),$2,$3,$4,$2,$5)',[f.id,randomUUID(),'PAID','test','admin']),/exceeds/);
});
test('lazy monthly allocation uses terms at month start, not mid-month configuration',async () => {
  const f=await fixture(pool);
  await pool.query(`UPDATE "AffiliateProfile" SET "createdAt"=NOW()-interval '60 days' WHERE id=$1`,[f.id]);
  await pool.query(`INSERT INTO "AffiliateTerms" (id,"affiliateId",config,"effectiveAt")
    SELECT $1,$2,config,NOW()-interval '60 days' FROM "AffiliateDefaults"`,[randomUUID(),f.id]);
  await pool.query(`INSERT INTO "AffiliateTerms" (id,"affiliateId",config,"effectiveAt")
    SELECT $1,$2,jsonb_set(config,'{boosts,COMMISSION,quota}','99'),NOW()-interval '1 minute' FROM "AffiliateDefaults"`,[randomUUID(),f.id]);
  await pool.query('SELECT affiliate_ensure_quota($1)',[f.id]);
  assert.equal((await pool.query(`SELECT allocated FROM "AffiliateQuota" WHERE "affiliateId"=$1 AND type='COMMISSION'`,[f.id])).rows[0].allocated,10);
});
