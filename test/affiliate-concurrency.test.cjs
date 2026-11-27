const { before,after,test }=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createTestDatabase,fixture,quote,payment,boost}=require('./affiliate-fixture.cjs');
let db,pool;
before(async () => { db=await createTestDatabase(); pool=db.pool; });
after(async () => { await db?.cleanup(); });
test('concurrent duplicate activation consumes exactly one quota',async () => {
  const f=await fixture(pool),key=randomUUID();
  const results=await Promise.all(Array.from({length:10},() => boost(pool,f.id,'COMMISSION',key)));
  assert.equal(new Set(results.map(r => r.id)).size,1);
  const rows=(await pool.query('SELECT used FROM "AffiliateQuota" WHERE "affiliateId"=$1 AND type=$2',[f.id,'COMMISSION'])).rows;
  assert.equal(rows[0].used,1);
  await assert.rejects(boost(pool,f.id,'DISCOUNT',key),/another boost/);
});
test('different concurrent activation requests cannot stack in one category',async () => {
  const f=await fixture(pool);
  const results=await Promise.allSettled([boost(pool,f.id,'DISCOUNT'),boost(pool,f.id,'SUPER_DISCOUNT')]);
  assert.equal(results.filter(r => r.status==='fulfilled').length,1);
  assert.equal((await pool.query('SELECT sum(used)::int AS used FROM "AffiliateQuota" WHERE "affiliateId"=$1',[f.id])).rows[0].used,1);
});
test('concurrent checkout reservations respect per-activation transaction cap',async () => {
  const config=(await pool.query('SELECT config FROM "AffiliateDefaults"')).rows[0].config;
  config.boosts.COMMISSION.maxTransactions=1;
  const f=await fixture(pool,true,config); await boost(pool,f.id);
  const results=await Promise.all(Array.from({length:5},() => quote(pool,f.voucher)));
  assert.equal(results.filter(q => q.commissionRate===1500).length,1);
  assert.equal(results.filter(q => q.commissionRate===1000).length,4);
});
test('concurrent payment callbacks create one commission entry',async () => {
  const f=await fixture(pool),q=await quote(pool,f.voucher),p=await payment(pool,q);
  await Promise.all(Array.from({length:8},() => pool.query(`UPDATE "Payment" SET status='CONFIRMED' WHERE id=$1`,[p])));
  const rows=(await pool.query('SELECT amount FROM "AffiliateLedger" WHERE "checkoutId"=$1',[q.id])).rows;
  assert.deepEqual(rows.map(r => r.amount),[935]);
});
async function payout(id,amount,key=randomUUID(),reference=key,status='PAID') {
  return (await pool.query('SELECT affiliate_payout($1,$2,NOW(),$3,$4,$5,$6,$7) AS result',[id,amount,reference,status,'test internal note',key,'test-admin'])).rows[0].result;
}
test('payout duplicate requests settle once and concurrent payouts cannot overspend',async () => {
  const f=await fixture(pool),q=await quote(pool,f.voucher); await payment(pool,q,'CONFIRMED');
  const key=randomUUID();
  const same=await Promise.all([payout(f.id,500,key),payout(f.id,500,key)]);
  assert.equal(same[0].id,same[1].id);
  const race=await Promise.allSettled([payout(f.id,400),payout(f.id,400)]);
  assert.equal(race.filter(r => r.status==='fulfilled').length,1);
  const total=(await pool.query('SELECT sum(amount)::int AS amount FROM "AffiliatePayout" WHERE "affiliateId"=$1',[f.id])).rows[0].amount;
  assert.equal(total,900);
});
test('pending payout reserves balance and cancellation releases it',async () => {
  const f=await fixture(pool),q=await quote(pool,f.voucher); await payment(pool,q,'CONFIRMED');
  const pending=await payout(f.id,900,randomUUID(),randomUUID(),'PENDING');
  await assert.rejects(payout(f.id,100),/exceeds/);
  await pool.query('SELECT affiliate_payout_status($1,$2,$3)',[pending.id,'CANCELLED','admin']);
  await payout(f.id,900);
  await assert.rejects(pool.query('SELECT affiliate_payout_status($1,$2,$3)',[pending.id,'PAID','admin']),/already settled/);
});
test('bonus quota requests are idempotent and unused quota does not renew active boosts',async () => {
  const f=await fixture(pool),key=randomUUID(),active=await boost(pool,f.id);
  await Promise.all(Array.from({length:4},() => pool.query('SELECT affiliate_bonus($1,$2,3,$3,$4)',[f.id,'COMMISSION','admin',key])));
  const q=(await pool.query('SELECT bonus,used FROM "AffiliateQuota" WHERE "affiliateId"=$1 AND type=$2',[f.id,'COMMISSION'])).rows[0];
  assert.deepEqual(q,{bonus:3,used:1});
  assert.equal((await pool.query('SELECT "expiresAt" FROM "AffiliateBoost" WHERE id=$1',[active.id])).rows[0].expiresAt.toISOString(),new Date(active.expiresAt).toISOString());
});
test('affiliate referral usage limit reserves the remaining slot atomically',async () => {
  const f=await fixture(pool);await pool.query('UPDATE "Voucher" SET "maxUsage"=1 WHERE id=$1',[f.voucher]);
  const results=await Promise.allSettled([quote(pool,f.voucher),quote(pool,f.voucher)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(results.find(r=>r.status==='rejected').reason.message.includes('reserved'));
});
test('local cancellation holds a transaction cap until verified gateway termination',async () => {
  const config=(await pool.query('SELECT config FROM "AffiliateDefaults"')).rows[0].config;config.boosts.COMMISSION.maxTransactions=1;
  const f=await fixture(pool,true,config);await boost(pool,f.id);
  const first=await quote(pool,f.voucher),id=await payment(pool,first);
  await pool.query(`UPDATE "Payment" SET status='CANCELLED' WHERE id=$1`,[id]);
  assert.equal((await quote(pool,f.voucher)).commissionRate,1000);
  await pool.query(`UPDATE "Payment" SET metadata='{"affiliate_terminal":true}'::jsonb WHERE id=$1`,[id]);
  assert.equal((await quote(pool,f.voucher)).commissionRate,1500);
});
