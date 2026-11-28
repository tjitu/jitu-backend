CREATE OR REPLACE FUNCTION growth_user_state(p_tryout text,p_user text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t "TryOut"; v "TryoutRegistrationVerification"; c jsonb; registered boolean; history jsonb; participant jsonb;
BEGIN
 SELECT * INTO t FROM "TryOut" WHERE id=p_tryout;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: Tryout tidak ditemukan.'; END IF;
 c:=growth_effective_config(t."growthConfig");
 SELECT jsonb_build_object('phoneNumber',COALESCE("phoneNumber",''),'email',email,'school',COALESCE(school,'')) INTO participant FROM "user" WHERE id=p_user;
 SELECT * INTO v FROM "TryoutRegistrationVerification" WHERE "tryoutId"=p_tryout AND "userId"=p_user;
 SELECT EXISTS(SELECT 1 FROM "TryOutAttempt" WHERE try_out_id=p_tryout AND "userId"=p_user) INTO registered;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('action',h.action,'createdAt',h."createdAt",'status',h.after->>'status',
  'rejectionReasons',h.after->'rejectionReasons') ORDER BY h."createdAt",h.id),'[]') INTO history
 FROM "TryoutVerificationHistory" h WHERE h."verificationId"=v.id;
 RETURN jsonb_build_object('tryoutId',t.id,'tryoutName',t.title,'config',
  CASE WHEN v.status='PENDING_VERIFICATION' THEN jsonb_set(v."configSnapshot",'{community,url}',to_jsonb(growth_community_url())) ELSE c END,
  'configVersion',t."growthVersion",'communityVersion',(SELECT version FROM "TryoutGrowthSettings" WHERE id='global'),'isRegistered',registered,'participantDetails',
  CASE WHEN v.status='REJECTED' AND v."contactDetails"<>'{}'::jsonb THEN v."contactDetails" ELSE participant END,
  'registrationClosed',t."scheduledEnd" IS NOT NULL AND (t."scheduledEnd" AT TIME ZONE 'UTC')<=CURRENT_TIMESTAMP,
  'exempt',EXISTS(SELECT 1 FROM "user" WHERE id=p_user AND COALESCE("isSandbox",false)),
  'verification',CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('id',v.id,'status',v.status,
   'instagramUsername',v."instagramUsername",'submittedChecklist',v."submittedChecklist",'version',v.version,
   'submittedAt',v."submittedAt",'verifiedAt',v."verifiedAt",'approvalMethod',v."approvalMethod",
   'rejectionReasons',v."rejectionReasons",'history',history,'contactDetails',v."contactDetails") END);
END $$;

CREATE OR REPLACE FUNCTION growth_submit(p_tryout text,p_user text,p_input jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t "TryOut"; v "TryoutRegistrationVerification"; previous jsonb; c jsonb; checks jsonb;
 username text; k text; req text; new_status text; action text; sandbox boolean; banned boolean; contact jsonb; phone text; contact_email text; school_name text;
BEGIN
 SELECT * INTO t FROM "TryOut" WHERE id=p_tryout FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: Tryout tidak ditemukan.'; END IF;
 SELECT COALESCE("isSandbox",false),COALESCE("isBanned",false) INTO sandbox,banned FROM "user" WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROWTH_FORBIDDEN: Pengguna tidak ditemukan.'; END IF;
 IF banned THEN RAISE EXCEPTION 'GROWTH_FORBIDDEN: Akun tidak dapat mendaftar.'; END IF;
 IF sandbox THEN RETURN NULL; END IF;
 IF COALESCE(to_jsonb(t)->>'curation_status','PUBLISHED')<>'PUBLISHED' THEN
  RAISE EXCEPTION 'GROWTH_FORBIDDEN: Pendaftaran tryout belum tersedia.';
 END IF;
 SELECT * INTO v FROM "TryoutRegistrationVerification" WHERE "tryoutId"=p_tryout AND "userId"=p_user FOR UPDATE;
 c:=growth_effective_config(t."growthConfig");
 IF v.id IS NULL AND EXISTS(SELECT 1 FROM "TryOutAttempt" WHERE try_out_id=p_tryout AND "userId"=p_user) THEN RETURN NULL; END IF;
 IF v.status='APPROVED' THEN
  PERFORM growth_admit(p_tryout,p_user); RETURN growth_user_state(p_tryout,p_user);
 END IF;
 IF v.status='PENDING_VERIFICATION' OR (v.id IS NOT NULL AND v."requestKey"=p_input->>'requestKey') THEN
  RETURN growth_user_state(p_tryout,p_user);
 END IF;
 IF t."scheduledEnd" IS NOT NULL AND (t."scheduledEnd" AT TIME ZONE 'UTC')<=CURRENT_TIMESTAMP THEN
  RAISE EXCEPTION 'GROWTH_CLOSED: Masa pendaftaran tryout sudah berakhir.';
 END IF;
 IF COALESCE((p_input->>'configVersion')::integer,-1)<>t."growthVersion" THEN
  RAISE EXCEPTION 'GROWTH_CONFLICT: Persyaratan berubah. Muat ulang sebelum mendaftar.';
 END IF;
 IF v.id IS NOT NULL AND COALESCE((p_input->>'version')::integer,-1)<>v.version THEN
  RAISE EXCEPTION 'GROWTH_CONFLICT: Pendaftaran telah berubah. Muat ulang halaman.';
 END IF;
 req:=p_input->>'requestKey';
 IF length(COALESCE(p_input->>'sessionId',''))>100 THEN RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Identitas sesi tidak valid.'; END IF;
 IF req IS NULL OR req !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Identitas pengajuan tidak valid.'; END IF;
 checks:=COALESCE(p_input->'checklist','{}');
 IF jsonb_typeof(checks)<>'object' THEN RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Checklist tidak valid.'; END IF;
 FOREACH k IN ARRAY ARRAY['follow','likeTag','story','community'] LOOP
  IF checks ? k AND jsonb_typeof(checks->k)<>'boolean' THEN RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Checklist tidak valid.'; END IF;
  IF (c->>'enabled')::boolean AND (c->'items'->k->>'enabled')::boolean AND (c->'items'->k->>'required')::boolean
   AND COALESCE(checks->>k,'false')<>'true' THEN RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Lengkapi seluruh persyaratan wajib.'; END IF;
 END LOOP;
 checks:=jsonb_build_object('follow',COALESCE((checks->>'follow')::boolean,false),
  'likeTag',COALESCE((checks->>'likeTag')::boolean,false),'story',COALESCE((checks->>'story')::boolean,false),
  'community',COALESCE((checks->>'community')::boolean,false));
 username:=lower(regexp_replace(btrim(COALESCE(p_input->>'instagramUsername','')),'^@',''));
 IF true THEN
  IF length(username) NOT BETWEEN 1 AND 30 OR username !~ '^[a-z0-9_][a-z0-9._]*$' OR username ~ '\.$|\.\.' THEN
   RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Masukkan username Instagram yang valid.';
  END IF;
 END IF;
 IF (c->'items'->'community'->>'enabled')::boolean AND COALESCE(c->'community'->>'url','')='' THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Link Komunitas JITU belum tersedia. Hubungi admin tryout.';
 END IF;
 IF (c->'items'->'community'->>'enabled')::boolean AND (p_input->>'communityVersion')::integer IS DISTINCT FROM (SELECT version FROM "TryoutGrowthSettings" WHERE id='global') THEN
  RAISE EXCEPTION 'GROWTH_CONFLICT: Link komunitas berubah. Muat ulang persyaratan sebelum mendaftar.';
 END IF;
 contact:=p_input->'participantDetails';
 IF jsonb_typeof(contact) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(contact) x WHERE jsonb_typeof(x.value)<>'string') THEN
  RAISE EXCEPTION 'GROWTH_PROFILE: Lengkapi nomor WhatsApp, email, dan sekolah.';
 END IF;
 phone:=regexp_replace(btrim(COALESCE(contact->>'phoneNumber','')),'[[:space:]().-]','','g');
 IF phone LIKE '0%' THEN phone:='+62'||substring(phone FROM 2); ELSIF phone LIKE '62%' THEN phone:='+'||phone; END IF;
 contact_email:=lower(btrim(COALESCE(contact->>'email',''))); school_name:=btrim(COALESCE(contact->>'school',''));
 IF phone !~ '^\+[1-9][0-9]{8,14}$' OR length(contact_email)>254 OR contact_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
  OR length(school_name) NOT BETWEEN 2 AND 150 THEN
  RAISE EXCEPTION 'GROWTH_PROFILE: Isi nomor WhatsApp, email, dan sekolah yang valid.';
 END IF;
 contact:=jsonb_build_object('phoneNumber',phone,'email',contact_email,'school',school_name);
 UPDATE "user" SET "phoneNumber"=phone,school=school_name,"updatedAt"=CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE id=p_user;
 previous:=CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END;
 action:=CASE WHEN v.id IS NULL THEN 'SUBMITTED' ELSE 'RESUBMITTED' END;
 new_status:=CASE WHEN (c->>'enabled')::boolean AND (c->>'manualVerification')::boolean THEN 'PENDING_VERIFICATION' ELSE 'APPROVED' END;
 INSERT INTO "TryoutRegistrationVerification" ("tryoutId","userId",status,"instagramUsername","submittedChecklist",
  "configSnapshot","configVersion","requestKey","approvalMethod","contactDetails")
 VALUES (p_tryout,p_user,new_status,NULLIF(username,''),checks,c,t."growthVersion",req,
  CASE WHEN new_status='APPROVED' THEN 'CHECKLIST' ELSE NULL END,contact)
 ON CONFLICT ("tryoutId","userId") DO UPDATE SET status=EXCLUDED.status,"instagramUsername"=EXCLUDED."instagramUsername",
  "submittedChecklist"=EXCLUDED."submittedChecklist","configSnapshot"=EXCLUDED."configSnapshot","configVersion"=EXCLUDED."configVersion",
  "contactDetails"=EXCLUDED."contactDetails","adminChecklist"='{}',"rejectionReasons"='{}',"verifiedAt"=NULL,"verifiedBy"=NULL,"approvalMethod"=EXCLUDED."approvalMethod",
  "requestKey"=EXCLUDED."requestKey",version="TryoutRegistrationVerification".version+1,
  "submissionNumber"="TryoutRegistrationVerification"."submissionNumber"+1,"submittedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
 RETURNING * INTO v;
 INSERT INTO "TryoutVerificationHistory" ("tryoutId","verificationId",action,"actorId",before,after)
 VALUES (p_tryout,v.id,action,p_user,previous,to_jsonb(v));
 PERFORM growth_server_event(p_tryout,p_user,CASE WHEN action='SUBMITTED' THEN 'registration_submitted' ELSE 'registration_resubmitted' END,COALESCE(p_input->>'sessionId',req),
  jsonb_build_object('submissionNumber',v."submissionNumber",'engagementVerified',false));
 IF new_status='APPROVED' THEN
  PERFORM growth_admit(p_tryout,p_user);
  PERFORM growth_server_event(p_tryout,p_user,'registration_approved',COALESCE(p_input->>'sessionId',req),'{"method":"CHECKLIST","engagementVerified":false}');
 END IF;
 RETURN growth_user_state(p_tryout,p_user);
END $$;
