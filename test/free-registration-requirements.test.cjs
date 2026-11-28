const {before,after,test}=require('node:test'),assert=require('node:assert/strict');
const {createGrowthDatabase,fixture,submit,review}=require('./growth-fixture.cjs');
let db,pool;
before(async()=>{db=await createGrowthDatabase();pool=db.pool;});
after(async()=>{await db?.cleanup();});
test('missing campaign defaults to required follow and community without campaign tasks',async()=>{
 const f=await fixture(pool,{campaignUrl:''});const state=await submit(pool,f,{...f.input,checklist:{follow:true,community:true}});
 assert.equal(state.config.items.follow.required,true);assert.equal(state.config.items.community.required,true);
 assert.equal(state.config.items.likeTag.enabled,false);assert.equal(state.config.items.story.enabled,false);
 assert.equal(state.config.community.url,'https://chat.whatsapp.com/GYG22u7at5NCyPHk4XQso2');
 await assert.rejects(review(pool,f,state.verification.id,1,'APPROVE',{checklist:{follow:true}}),/Konfirmasi seluruh/);
 assert.equal((await review(pool,f,state.verification.id,1,'APPROVE',{checklist:{follow:true,community:true}})).status,'APPROVED');
});
test('follow cannot be disabled in either mode and Instagram is mandatory even without manual review',async()=>{
 for(const campaignUrl of ['', 'https://www.instagram.com/p/Test/']){
  const f=await fixture(pool,{campaignUrl,manualVerification:false});
  await assert.rejects(submit(pool,f,{...f.input,instagramUsername:''}),/username Instagram/);
  await assert.rejects(submit(pool,f,{...f.input,checklist:{...f.input.checklist,follow:false}}),/persyaratan wajib/);
  if(!campaignUrl)await assert.rejects(submit(pool,f,{...f.input,checklist:{follow:true,community:false}}),/persyaratan wajib/);
 }
 const f=await fixture(pool);f.config.items.follow={enabled:false,required:false};
 await pool.query('UPDATE "TryOut" SET "growthConfig"=$2::jsonb WHERE id=$1',[f.tryout,JSON.stringify(f.config)]);
 await assert.rejects(submit(pool,f,{...f.input,checklist:{...f.input.checklist,follow:false}}),/persyaratan wajib/);
});
test('invalid or missing personal information cannot persist registration or update the profile',async()=>{
 const f=await fixture(pool);
 for(const participantDetails of [undefined,{}, {...f.input.participantDetails,phoneNumber:'abc'}, {...f.input.participantDetails,email:'bad'}, {...f.input.participantDetails,school:''}]){
  await assert.rejects(submit(pool,f,{...f.input,participantDetails}),/GROWTH_PROFILE/);
 }
 assert.equal((await pool.query('SELECT count(*)::int n FROM "TryoutRegistrationVerification" WHERE "userId"=$1',[f.user])).rows[0].n,0);
 assert.equal((await pool.query('SELECT "phoneNumber" FROM "user" WHERE id=$1',[f.user])).rows[0].phoneNumber,null);
});
test('personal data is normalized, snapshotted and audited without changing login email',async()=>{
 const f=await fixture(pool);const state=await submit(pool,f);
 assert.deepEqual(state.verification.contactDetails,{phoneNumber:'+6281234567890',email:'contact@test.invalid',school:'SMA JITU'});
 const user=(await pool.query('SELECT email,"phoneNumber",school FROM "user" WHERE id=$1',[f.user])).rows[0];
 assert.equal(user.email,f.user+'@test.invalid');assert.equal(user.phoneNumber,'+6281234567890');assert.equal(user.school,'SMA JITU');
 const retry=await submit(pool,f,{...f.input,participantDetails:{...f.input.participantDetails,school:'Different school'}});
 assert.equal(retry.verification.contactDetails.school,'SMA JITU');
 const audit=(await pool.query('SELECT after FROM "TryoutVerificationHistory" WHERE "verificationId"=$1',[state.verification.id])).rows[0].after;
 assert.deepEqual(audit.contactDetails,state.verification.contactDetails);
});
test('changing the global link updates every tryout and pending outcome, with stale-form protection',async()=>{
 const f=await fixture(pool,{campaignUrl:''}),other=await fixture(pool,{campaignUrl:''});const state=await submit(pool,f);
 const setting=(await pool.query('SELECT version FROM "TryoutGrowthSettings" WHERE id=$1',['global'])).rows[0];
 await pool.query('SELECT growth_settings_update($1,$2,$3)',['https://chat.whatsapp.com/NewGlobalLink',setting.version,'real-admin']);
 for(const current of [f,other]){
  const latest=(await pool.query('SELECT growth_user_state($1,$2) s',[current.tryout,current.user])).rows[0].s;
  assert.equal(latest.config.community.url,'https://chat.whatsapp.com/NewGlobalLink');
 }
 await assert.rejects(submit(pool,other),/Link komunitas berubah/);
 const latest=await submit(pool,other,{...other.input,communityVersion:setting.version+1});assert.equal(latest.verification.status,'PENDING_VERIFICATION');
 await assert.rejects(pool.query('SELECT growth_settings_update($1,$2,$3)',['https://example.com/stale',setting.version,'admin']),/GROWTH_CONFLICT/);
 await assert.rejects(pool.query('SELECT growth_settings_update($1,$2,$3)',['javascript:alert(1)',setting.version+1,'admin']),/GROWTH_CONFIG/);
 assert.equal(state.verification.status,'PENDING_VERIFICATION');
});
