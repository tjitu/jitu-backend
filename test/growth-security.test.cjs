const {before,after,test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createGrowthDatabase,fixture,submit}=require('./growth-fixture.cjs');
let db,pool;
before(async()=>{db=await createGrowthDatabase();pool=db.pool;});
after(async()=>{await db?.cleanup();});
test('invalid URLs, prize counts and stale config versions are rejected',async()=>{
 const f=await fixture(pool);
 for(const patch of [{profileUrl:null},{campaignUrl:'javascript:alert(1)'},{campaignUrl:'https://instagram.com.evil.test/p/abc/'},
  {prize:{enabled:true,winners:0}},{community:{enabled:true,url:'javascript:alert(1)'}}]) {
  await assert.rejects(pool.query('SELECT growth_validate_config($1::jsonb)',[JSON.stringify({...f.config,...patch})]),/GROWTH_CONFIG/);
 }
 await assert.rejects(pool.query('SELECT growth_config_update($1::jsonb,2,1)',[JSON.stringify(f.config)]),/GROWTH_CONFLICT/);
 await assert.rejects(submit(pool,f,{...f.input,configVersion:0}),/GROWTH_CONFLICT/);
});
test('disabled requirements do not block registration or admin verification',async()=>{
 const f=await fixture(pool);f.config.items.story={enabled:false,required:false};f.config.mentionRequired=false;
 await pool.query('UPDATE "TryOut" SET "growthConfig"=$2::jsonb WHERE id=$1',[f.tryout,JSON.stringify(f.config)]);
 const state=await submit(pool,f,{...f.input,checklist:{follow:true,likeTag:true}});
 const row=(await pool.query('SELECT growth_review($1,$2,$3,$4::jsonb) AS s',[f.tryout,state.verification.id,'admin',
  JSON.stringify({action:'APPROVE',version:1,checklist:{follow:true,like:true,tag:true}})])).rows[0].s;
 assert.equal(row.status,'APPROVED');
});
test('banned users cannot submit and one participant cannot read another participant submission',async()=>{
 const f=await fixture(pool);await submit(pool,f);
 const other=await fixture(pool);
 const state=(await pool.query('SELECT growth_user_state($1,$2) AS s',[f.tryout,other.user])).rows[0].s;
 assert.equal(state.verification,null);
 await pool.query('UPDATE "user" SET "isBanned"=true WHERE id=$1',[other.user]);
 await assert.rejects(submit(pool,other),/GROWTH_FORBIDDEN/);
});
test('new tables use RLS and server functions have no PUBLIC execute privilege',async()=>{
 const tables=(await pool.query(`SELECT relname,relrowsecurity FROM pg_class WHERE relname IN
  ('TryoutRegistrationVerification','TryoutVerificationHistory','TryoutGrowthEvent')`)).rows;
 assert.equal(tables.length,3);assert.ok(tables.every(x=>x.relrowsecurity));
 const grants=(await pool.query(`SELECT p.proname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
  WHERE p.proname LIKE 'growth_%' AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows;
 assert.deepEqual(grants,[]);
});
test('client telemetry cannot spoof server decisions and repeated IDs are deduplicated',async()=>{
 const f=await fixture(pool),eventId=randomUUID();
 const emit=input=>pool.query('SELECT growth_client_event($1,$2,$3::jsonb)',[f.tryout,f.user,JSON.stringify({eventId,sessionId:f.input.sessionId,...input})]);
 await assert.rejects(emit({event:'registration_approved'}),/GROWTH_REQUIREMENTS/);
 await emit({event:'registration_button_clicked'});await emit({event:'registration_button_clicked'});
 const n=(await pool.query('SELECT count(*)::int AS n FROM "TryoutGrowthEvent" WHERE "tryoutId"=$1',[f.tryout])).rows[0].n;
 assert.equal(n,1);
});
test('conversion and community CTR use measured journeys; later submission clears abandonment',async()=>{
 const f=await fixture(pool);
 const emit=event=>pool.query('SELECT growth_client_event($1,$2,$3::jsonb)',[f.tryout,f.user,JSON.stringify({event,eventId:randomUUID(),sessionId:f.input.sessionId})]);
 await emit('registration_button_clicked');await emit('social_engagement_modal_viewed');await emit('social_engagement_modal_abandoned');
 let metrics=(await pool.query('SELECT growth_analytics($1) AS m',[f.tryout])).rows[0].m;
 assert.equal(metrics.abandonmentRate,100);
 await submit(pool,f);await emit('community_invitation_viewed');await emit('community_invitation_clicked');
 metrics=(await pool.query('SELECT growth_analytics($1) AS m',[f.tryout])).rows[0].m;
 assert.equal(metrics.conversionRate,100);assert.equal(metrics.abandonmentRate,0);assert.equal(metrics.communityClickThroughRate,100);
 assert.equal(metrics.pending,1);assert.equal(metrics.approved,0);
});
