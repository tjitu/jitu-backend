const {before,after,test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createGrowthDatabase,fixture,submit,review,confirmed}=require('./growth-fixture.cjs');
let db,pool;
before(async()=>{db=await createGrowthDatabase();pool=db.pool;});
after(async()=>{await db?.cleanup();});
test('existing tryouts have growth disabled and retain the legacy registration path',async()=>{
 const f=await fixture(pool,{enabled:false});assert.equal(await submit(pool,f),null);
 const legacy=(await pool.query('SELECT "growthConfig","growthVersion" FROM "TryOut" WHERE id=$1',['legacy'])).rows[0];
 assert.deepEqual(legacy.growthConfig,{enabled:false});assert.equal(legacy.growthVersion,0);
});
test('manual submission requires a valid normalized Instagram username and required checklist',async()=>{
 const f=await fixture(pool);
 for(const instagramUsername of ['', '@@invalid', 'has space', 'bad..dots', 'trailing.', 'a'.repeat(31)]) {
  await assert.rejects(submit(pool,f,{...f.input,instagramUsername}),/GROWTH_REQUIREMENTS/);
 }
 await assert.rejects(submit(pool,f,{...f.input,checklist:{follow:true}}),/persyaratan wajib/);
 const state=await submit(pool,f);assert.equal(state.verification.instagramUsername,'test.user');
 assert.equal(state.verification.status,'PENDING_VERIFICATION');assert.equal(state.isRegistered,false);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM "TryOutAttempt" WHERE "userId"=$1',[f.user])).rows[0].n,0);
 await assert.rejects(pool.query('SELECT growth_assert_access($1,$2)',[f.tryout,f.user]),/GROWTH_PENDING/);
});
test('concurrent and retried submissions produce one pending record and one submission event',async()=>{
 const f=await fixture(pool);const states=await Promise.all(Array.from({length:10},()=>submit(pool,f)));
 assert.equal(new Set(states.map(x=>x.verification.id)).size,1);
 const duplicate=await submit(pool,f,{...f.input,requestKey:randomUUID(),instagramUsername:'different.user'});
 assert.equal(duplicate.verification.instagramUsername,'test.user');assert.equal(duplicate.verification.version,1);
 const count=(await pool.query('SELECT count(*)::int AS n FROM "TryoutGrowthEvent" WHERE "tryoutId"=$1 AND event=$2',[f.tryout,'registration_submitted'])).rows[0].n;
 assert.equal(count,1);
});
test('admin checklist is independent and partial progress cannot grant access',async()=>{
 const f=await fixture(pool),state=await submit(pool,f),v=state.verification;
 await assert.rejects(review(pool,f,v.id,v.version,'APPROVE'),/Konfirmasi seluruh/);
 const saved=await review(pool,f,v.id,v.version,'SAVE_PROGRESS',{checklist:{follow:true}});
 assert.equal(saved.status,'PENDING_VERIFICATION');assert.deepEqual(saved.adminChecklist,{follow:true});
 await assert.rejects(review(pool,f,v.id,saved.version,'APPROVE'),/Konfirmasi seluruh/);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM "TryOutAttempt" WHERE "userId"=$1',[f.user])).rows[0].n,0);
});
test('approval records actor and time and creates one scheduled NOT_STARTED attempt',async()=>{
 const f=await fixture(pool),state=await submit(pool,f),v=state.verification;
 const result=await review(pool,f,v.id,v.version,'APPROVE',{checklist:confirmed});
 assert.equal(result.status,'APPROVED');assert.equal(result.verifiedBy,'test-admin');assert.ok(result.verifiedAt);
 const attempts=(await pool.query('SELECT * FROM "TryOutAttempt" WHERE "userId"=$1',[f.user])).rows;
 assert.equal(attempts.length,1);assert.equal(attempts[0].status,'NOT_STARTED');
 await pool.query('SELECT growth_assert_access($1,$2)',[f.tryout,f.user]);
 await assert.rejects(review(pool,f,v.id,result.version,'REJECT',{rejectionReasons:['Tidak dapat diverifikasi']}),/GROWTH_CONFLICT/);
});
test('concurrent approve/reject cannot decide the same submission twice',async()=>{
 const f=await fixture(pool),v=(await submit(pool,f)).verification;
 const outcomes=await Promise.allSettled([
  review(pool,f,v.id,v.version,'APPROVE',{checklist:confirmed}),
  review(pool,f,v.id,v.version,'REJECT',{rejectionReasons:['Username Instagram tidak ditemukan.']}),
 ]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.match(outcomes.find(x=>x.status==='rejected').reason.message,/GROWTH_CONFLICT/);
 const events=(await pool.query(`SELECT count(*)::int AS n FROM "TryoutGrowthEvent" WHERE "tryoutId"=$1 AND event IN ('registration_approved','registration_rejected')`,[f.tryout])).rows[0].n;
 assert.equal(events,1);
});
test('rejection requires reasons; resubmission preserves history and clears admin progress',async()=>{
 const f=await fixture(pool),v=(await submit(pool,f)).verification;
 await assert.rejects(review(pool,f,v.id,v.version,'REJECT'),/alasan penolakan/);
 const rejected=await review(pool,f,v.id,v.version,'REJECT',{checklist:{follow:true},rejectionReasons:['Belum like postingan tryout.','Belum tag 3 teman.']});
 assert.equal(rejected.rejectionReasons.length,2);
 const again=await submit(pool,f,{...f.input,requestKey:randomUUID(),version:rejected.version,instagramUsername:'correct.user'});
 assert.equal(again.verification.status,'PENDING_VERIFICATION');assert.equal(again.verification.instagramUsername,'correct.user');
 const full=(await pool.query('SELECT * FROM "TryoutRegistrationVerification" WHERE id=$1',[v.id])).rows[0];
 assert.deepEqual(full.adminChecklist,{});assert.deepEqual(full.rejectionReasons,[]);assert.equal(full.submissionNumber,2);
 const history=(await pool.query('SELECT action,after FROM "TryoutVerificationHistory" WHERE "verificationId"=$1 ORDER BY "createdAt",id',[v.id])).rows;
 assert.deepEqual(history.map(x=>x.action),['SUBMITTED','REJECT','RESUBMITTED']);
 assert.equal(history[0].after.instagramUsername,'test.user');assert.equal(history[2].after.instagramUsername,'correct.user');
});
test('resubmission after registration closes is rejected',async()=>{
 const f=await fixture(pool),v=(await submit(pool,f)).verification;
 const rejected=await review(pool,f,v.id,v.version,'REJECT',{rejectionReasons:['Aktivitas Instagram tidak dapat diverifikasi.']});
 await pool.query('UPDATE "TryOut" SET "scheduledEnd"=(NOW() AT TIME ZONE \'UTC\')-interval \'1 minute\' WHERE id=$1',[f.tryout]);
 await assert.rejects(submit(pool,f,{...f.input,version:rejected.version,requestKey:randomUUID()}),/GROWTH_CLOSED/);
});
test('checklist-only registration admits users without claiming manual Instagram verification',async()=>{
 const f=await fixture(pool,{manualVerification:false});const state=await submit(pool,f,{...f.input,instagramUsername:''});
 assert.equal(state.isRegistered,true);assert.equal(state.verification.status,'APPROVED');assert.equal(state.verification.verifiedAt,null);
 const metadata=(await pool.query('SELECT metadata FROM "TryoutGrowthEvent" WHERE "tryoutId"=$1 AND event=$2',[f.tryout,'registration_approved'])).rows[0].metadata;
 assert.equal(metadata.engagementVerified,false);assert.equal(metadata.method,'CHECKLIST');
});
test('pending requirements are snapshotted and Story expiry never automatically rejects',async()=>{
 const f=await fixture(pool),v=(await submit(pool,f)).verification;
 await pool.query(`UPDATE "TryoutRegistrationVerification" SET "submittedAt"=NOW()-interval '30 hours' WHERE id=$1`,[v.id]);
 const next=structuredClone(f.config);next.items.story={enabled:false,required:false};
 await pool.query('UPDATE "TryOut" SET "growthConfig"=growth_validate_config($2::jsonb),"growthVersion"=2 WHERE id=$1',[f.tryout,JSON.stringify(next)]);
 const state=(await pool.query('SELECT growth_user_state($1,$2) AS s',[f.tryout,f.user])).rows[0].s;
 assert.equal(state.verification.status,'PENDING_VERIFICATION');assert.equal(state.config.items.story.required,true);
 await assert.rejects(review(pool,f,v.id,v.version,'APPROVE',{checklist:{follow:true,like:true,tag:true}}),/Konfirmasi seluruh/);
 assert.equal((await review(pool,f,v.id,v.version,'APPROVE',{checklist:confirmed})).status,'APPROVED');
});
test('paid access resolves pending status only after actual paid eligibility exists',async()=>{
 const f=await fixture(pool),v=(await submit(pool,f)).verification;
 await pool.query('UPDATE "TryOut" SET "solutionPrice"=1 WHERE id=$1',[f.tryout]);
 await assert.rejects(pool.query('SELECT growth_finalize_paid($1,$2)',[f.tryout,f.user]),/GROWTH_FORBIDDEN/);
 await pool.query('INSERT INTO "UnlockedSolution" (id,"userId","tryOutId") VALUES ($1,$2,$3)',[randomUUID(),f.user,f.tryout]);
 await pool.query('SELECT growth_finalize_paid($1,$2)',[f.tryout,f.user]);
 const row=(await pool.query('SELECT * FROM "TryoutRegistrationVerification" WHERE id=$1',[v.id])).rows[0];
 assert.equal(row.approvalMethod,'PAID');assert.equal(row.status,'APPROVED');assert.equal(row.verifiedBy,null);
});
