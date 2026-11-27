const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

async function createTestDatabase() {
  const url = new URL(process.env.AFFILIATE_TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/postgres');
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Affiliate integration tests require a local PostgreSQL server');
  const admin = new Pool({ connectionString: url.toString() });
  const database = `jitu_affiliate_test_${randomUUID().replaceAll('-','')}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  const pool = new Pool({ connectionString: url.toString(),max: 15 });
  const cleanup = async () => {
    await pool.end();
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
  };
  try {
    await pool.query(`CREATE TABLE "Voucher" (id text PRIMARY KEY,code text UNIQUE,"discountPercent" int NOT NULL,
      "commissionPercent" int DEFAULT 0,"maxDiscount" int,"minPurchase" int DEFAULT 0,"maxUsage" int,"usedCount" int DEFAULT 0,
      "isActive" boolean DEFAULT true,"expiresAt" timestamptz,description text,"referrerName" text,
      "issuedToUserId" text,"issuedToName" text,"issuedToEmail" text,"issuedByUserId" text,"issuedByName" text,"issuedByEmail" text,
      "createdAt" timestamptz DEFAULT now(),"updatedAt" timestamptz DEFAULT now());
      CREATE TABLE "TokenPackage" (id text PRIMARY KEY,name text,"tokenAmount" int,price int,"isActive" boolean DEFAULT true);
      CREATE TABLE "user" (id text PRIMARY KEY,name text,email text,image text);
      CREATE TABLE "Payment" (id text PRIMARY KEY,"orderId" text UNIQUE,"userId" text,"tokenPackageId" text,
        amount int NOT NULL,"originalAmount" int,"discountAmount" int DEFAULT 0,"tokenAmount" int DEFAULT 1,
        status text NOT NULL,"voucherId" text REFERENCES "Voucher"(id),"voucherCode" text,"paymentMethod" text DEFAULT 'QRIS',
        metadata jsonb,"snapToken" text,"createdAt" timestamptz DEFAULT now(),"updatedAt" timestamptz DEFAULT now());
      INSERT INTO "TokenPackage" VALUES ('product','Test product',1,11000,true);`);
    const migrations = path.join(__dirname,'../prisma/migrations');
    for (const directory of (await readdir(migrations)).filter(name => name.startsWith('20261127')).sort()) {
      await pool.query(await readFile(path.join(migrations,directory,'migration.sql'),'utf8'));
    }
    await pool.query(`INSERT INTO "AffiliateAgreement" (id,version,title,content,party,status,"effectiveAt","publishedAt")
      VALUES ('required',2,'Test agreement','Test affiliate agreement: {{affiliate_name}}. {{base_commission}}. {{acceptance_timestamp}}.',
        'Test contracting party','PUBLISHED',NOW()-interval '1 day',NOW())`);
    return { pool,url: url.toString(),database,cleanup };
  } catch (error) { await cleanup(); throw error; }
}
async function fixture(pool, accepted = true, config) {
  const id=randomUUID(),voucher=randomUUID();
  await pool.query(`INSERT INTO "AffiliateProfile" (id,"userId",name,identifier) VALUES ($1,$1,'Test Affiliate',$2)`,[id,`${id}@test.invalid`]);
  await pool.query(`INSERT INTO "AffiliateTerms" (id,"affiliateId",config,"effectiveAt") SELECT $1,$2,COALESCE($3::jsonb,config),NOW()-interval '1 day' FROM "AffiliateDefaults" WHERE id='default'`,[randomUUID(),id,config ? JSON.stringify(config) : null]);
  if (accepted) await acceptLatest(pool,id);
  await pool.query(`INSERT INTO "Voucher" (id,code,"discountPercent","affiliateId") VALUES ($1,UPPER($1),33,$2)`,[voucher,id]);
  return { id,voucher,code: voucher.toUpperCase() };
}
async function acceptLatest(pool,id) {
  await pool.query(`INSERT INTO "AffiliateAcceptance" (id,"affiliateId","agreementId",version,snapshot,identity,"contentHash")
    SELECT $1,$2,id,version,'Test accepted immutable content','{}','test-hash' FROM "AffiliateAgreement"
    WHERE status='PUBLISHED' AND "requiresAcceptance" AND "effectiveAt"<=NOW() ORDER BY version DESC LIMIT 1
    ON CONFLICT ("affiliateId","agreementId") DO NOTHING`,[randomUUID(),id]);
}
async function quote(pool,voucher,id=randomUUID(),amount=11000) {
  return (await pool.query('SELECT affiliate_quote($1,$2,$3) AS result',[voucher,amount,id])).rows[0].result;
}
async function payment(pool,snapshot,status='PENDING') {
  const id=randomUUID();
  await pool.query(`INSERT INTO "Payment" (id,"orderId","userId","tokenPackageId",amount,status,"voucherId","voucherCode","affiliateCheckoutId")
    VALUES ($1,$1,'student','product',$2,$3,$4,$5,$6)`,[id,snapshot.paidAmount,status,snapshot.voucherId,snapshot.code,snapshot.id]);
  return id;
}
async function boost(pool,id,type='COMMISSION',key=randomUUID()) {
  return (await pool.query('SELECT affiliate_activate($1,$2,$3) AS result',[id,type,key])).rows[0].result;
}
module.exports={ createTestDatabase,fixture,acceptLatest,quote,payment,boost };
