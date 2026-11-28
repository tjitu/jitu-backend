const { Pool }=require('pg');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
async function createGrowthDatabase() {
 const url=new URL(process.env.GROWTH_TEST_DATABASE_URL||'postgresql://postgres@127.0.0.1:5432/postgres');
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Growth tests require localhost PostgreSQL');
 const admin=new Pool({connectionString:url.toString()}),name='jitu_growth_test_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE DATABASE "${name}"`);url.pathname='/'+name;
 const pool=new Pool({connectionString:url.toString(),max:15});
 const cleanup=async()=>{await pool.end();await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();};
 try {
  await pool.query(`CREATE TABLE "user" (id text PRIMARY KEY,name text,email text,"isSandbox" boolean DEFAULT false,
   "isPremium" boolean DEFAULT false,"premiumExpiresAt" timestamp,"isBanned" boolean DEFAULT false,"tokenBalance" integer DEFAULT 10,"phoneNumber" text,school text,"updatedAt" timestamp DEFAULT NOW());
   CREATE TABLE "TryOut" (id text PRIMARY KEY,title text,"solutionPrice" integer DEFAULT 0,"scheduledStart" timestamp,
    "scheduledEnd" timestamp,curation_status text DEFAULT 'PUBLISHED');
   CREATE TABLE "TryOutAttempt" (id text PRIMARY KEY,"userId" text,try_out_id text,status text,total_score integer,
    current_subtest_order integer,started_at timestamp);
   CREATE TABLE "UnlockedSolution" (id text PRIMARY KEY,"userId" text,"tryOutId" text,"unlockedAt" timestamp DEFAULT NOW(),UNIQUE("userId","tryOutId"));
   CREATE TABLE "TokenTransaction" (id text PRIMARY KEY,"userId" text,amount integer,type text,"referenceId" text,"createdAt" timestamp);
   INSERT INTO "TryOut" (id,title) VALUES ('legacy','Legacy tryout');`);
  const migrations=path.resolve(__dirname,'../prisma/migrations');
  for(const dir of (await fs.readdir(migrations)).filter(x=>x.startsWith('20261128')).sort()) {
   await pool.query(await fs.readFile(path.join(migrations,dir,'migration.sql'),'utf8'));
  }
  return {pool,url:url.toString(),cleanup};
 } catch(error) {await cleanup();throw error;}
}
async function fixture(pool,overrides={}) {
 const user=randomUUID(),tryout=randomUUID();
 const config=(await pool.query('SELECT growth_defaults() AS c')).rows[0].c;
 config.enabled=true;config.campaignUrl='https://www.instagram.com/p/TestCampaign/';Object.assign(config,overrides);
 await pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$2,$3)',[user,'Test participant',user+'@test.invalid']);
 await pool.query(`INSERT INTO "TryOut" (id,title,"scheduledStart","scheduledEnd","growthConfig","growthVersion")
  VALUES ($1,'Test tryout',(NOW() AT TIME ZONE 'UTC')+interval '1 hour',(NOW() AT TIME ZONE 'UTC')+interval '1 day',growth_validate_config($2::jsonb),1)`,[tryout,JSON.stringify(config)]);
 const communityVersion=(await pool.query('SELECT version FROM "TryoutGrowthSettings" WHERE id=$1',['global'])).rows[0].version;
 return {user,tryout,config,input:{instagramUsername:'@Test.User',participantDetails:{phoneNumber:'081234567890',email:'contact@test.invalid',school:'SMA JITU'},checklist:{follow:true,likeTag:true,story:true,community:true},configVersion:1,communityVersion,requestKey:randomUUID(),sessionId:randomUUID()}};
}
async function submit(pool,f,input=f.input) {return (await pool.query('SELECT growth_submit($1,$2,$3::jsonb) AS s',[f.tryout,f.user,JSON.stringify(input)])).rows[0].s;}
async function review(pool,f,id,version,action,extra={}) {
 return (await pool.query('SELECT growth_review($1,$2,$3,$4::jsonb) AS s',[f.tryout,id,'test-admin',JSON.stringify({version,action,...extra})])).rows[0].s;
}
const confirmed={follow:true,like:true,tag:true,story:true,mention:true};
module.exports={createGrowthDatabase,fixture,submit,review,confirmed};
