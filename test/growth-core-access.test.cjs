const {before,after,test}=require('node:test'),assert=require('node:assert/strict');
const {PrismaClient}=require('../dist/generated/prisma/client');
const {PrismaPg}=require('@prisma/adapter-pg');
const {createGrowthDatabase,fixture,submit,review,confirmed}=require('./growth-fixture.cjs');
const {assertGrowthAccess}=require('../dist/src/modules/tryout/growth-registration');
const {ExamService}=require('../dist/src/modules/exam/exam.service');
const {TryoutService}=require('../dist/src/modules/tryout/tryout.service');
let db,client,exam,tryouts;
before(async()=>{
 db=await createGrowthDatabase();client=new PrismaClient({adapter:new PrismaPg({connectionString:db.url})});
 exam=new ExamService(client,{});tryouts=new TryoutService(client,exam);
});
after(async()=>{await client?.$disconnect();await db?.cleanup();});
const denied=code=>error=>{assert.equal(error.getStatus?.(),403);assert.equal(error.getResponse().code,code);return true;};
test('real Prisma 7 errors become safe 403 responses for pending and rejected registrations',async()=>{
 const f=await fixture(db.pool),v=(await submit(db.pool,f)).verification;
 await assert.rejects(assertGrowthAccess(client,f.tryout,f.user),denied('GROWTH_PENDING'));
 await review(db.pool,f,v.id,v.version,'REJECT',{rejectionReasons:['Aktivitas Instagram tidak dapat diverifikasi.']});
 await assert.rejects(assertGrowthAccess(client,f.tryout,f.user),denied('GROWTH_REJECTED'));
});
test('Core exam start and question endpoints reject unapproved users before reading questions or creating attempts',async()=>{
 const f=await fixture(db.pool);await submit(db.pool,f);
 await assert.rejects(exam.startExam(f.tryout,f.user),denied('GROWTH_PENDING'));
 await assert.rejects(tryouts.getSubtestQuestions(f.tryout,1,f.user),denied('GROWTH_PENDING'));
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM "TryOutAttempt" WHERE "userId"=$1',[f.user])).rows[0].n,0);
});
test('approval passes the verification gate but retains the future scheduling restriction',async()=>{
 const f=await fixture(db.pool),v=(await submit(db.pool,f)).verification;
 await review(db.pool,f,v.id,v.version,'APPROVE',{checklist:confirmed});
 await assertGrowthAccess(client,f.tryout,f.user);
 await assert.rejects(exam.startExam(f.tryout,f.user),error=>{assert.equal(error.getResponse().code,'TRYOUT_NOT_STARTED');return true;});
 assert.deepEqual((await db.pool.query('SELECT status FROM "TryOutAttempt" WHERE "userId"=$1',[f.user])).rows,[{status:'NOT_STARTED'}]);
});
