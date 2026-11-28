CREATE FUNCTION growth_user_state(p_tryout text,p_user text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t "TryOut"; v "TryoutRegistrationVerification"; c jsonb; registered boolean; history jsonb;
BEGIN
 SELECT * INTO t FROM "TryOut" WHERE id=p_tryout;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: Tryout tidak ditemukan.'; END IF;
 c:=growth_validate_config(t."growthConfig");
 SELECT * INTO v FROM "TryoutRegistrationVerification" WHERE "tryoutId"=p_tryout AND "userId"=p_user;
 SELECT EXISTS(SELECT 1 FROM "TryOutAttempt" WHERE try_out_id=p_tryout AND "userId"=p_user) INTO registered;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('action',h.action,'createdAt',h."createdAt",'status',h.after->>'status',
  'rejectionReasons',h.after->'rejectionReasons') ORDER BY h."createdAt",h.id),'[]') INTO history
 FROM "TryoutVerificationHistory" h WHERE h."verificationId"=v.id;
 RETURN jsonb_build_object('tryoutId',t.id,'tryoutName',t.title,'config',
  CASE WHEN v.status='PENDING_VERIFICATION' THEN v."configSnapshot" ELSE c END,
  'configVersion',t."growthVersion",'isRegistered',registered,
  'registrationClosed',t."scheduledEnd" IS NOT NULL AND (t."scheduledEnd" AT TIME ZONE 'UTC')<=CURRENT_TIMESTAMP,
  'exempt',EXISTS(SELECT 1 FROM "user" WHERE id=p_user AND COALESCE("isSandbox",false)),
  'verification',CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('id',v.id,'status',v.status,
   'instagramUsername',v."instagramUsername",'submittedChecklist',v."submittedChecklist",'version',v.version,
   'submittedAt',v."submittedAt",'verifiedAt',v."verifiedAt",'approvalMethod',v."approvalMethod",
   'rejectionReasons',v."rejectionReasons",'history',history) END);
END $$;

CREATE FUNCTION growth_server_event(p_tryout text,p_user text,p_event text,p_session text,p_metadata jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql AS $$
 INSERT INTO "TryoutGrowthEvent" (id,"tryoutId","userId",event,source,"sessionId",metadata)
 VALUES (gen_random_uuid()::text,p_tryout,p_user,p_event,'SERVER',p_session,p_metadata);
$$;

CREATE FUNCTION growth_admit(p_tryout text,p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 -- Callers serialize on the user row, matching existing paid registration locks.
 PERFORM id FROM "user" WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROWTH_FORBIDDEN: Pengguna tidak ditemukan.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "TryOutAttempt" WHERE try_out_id=p_tryout AND "userId"=p_user) THEN
  INSERT INTO "TryOutAttempt" (id,"userId",try_out_id,status,total_score,current_subtest_order,started_at)
  VALUES (gen_random_uuid()::text,p_user,p_tryout,'NOT_STARTED',0,0,CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
 END IF;
END $$;

CREATE FUNCTION growth_submit(p_tryout text,p_user text,p_input jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t "TryOut"; v "TryoutRegistrationVerification"; previous jsonb; c jsonb; checks jsonb;
 username text; k text; req text; new_status text; action text; sandbox boolean; banned boolean;
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
 c:=growth_validate_config(t."growthConfig");
 IF NOT (c->>'enabled')::boolean AND NOT (c->'community'->>'enabled')::boolean
  AND NOT (c->'prize'->>'enabled')::boolean AND v.id IS NULL THEN RETURN NULL; END IF;
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
 FOREACH k IN ARRAY ARRAY['follow','likeTag','story'] LOOP
  IF checks ? k AND jsonb_typeof(checks->k)<>'boolean' THEN RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Checklist tidak valid.'; END IF;
  IF (c->>'enabled')::boolean AND (c->'items'->k->>'enabled')::boolean AND (c->'items'->k->>'required')::boolean
   AND COALESCE(checks->>k,'false')<>'true' THEN RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Lengkapi seluruh persyaratan wajib.'; END IF;
 END LOOP;
 checks:=jsonb_build_object('follow',COALESCE((checks->>'follow')::boolean,false),
  'likeTag',COALESCE((checks->>'likeTag')::boolean,false),'story',COALESCE((checks->>'story')::boolean,false));
 username:=lower(regexp_replace(btrim(COALESCE(p_input->>'instagramUsername','')),'^@',''));
 IF ((c->>'enabled')::boolean AND (c->>'manualVerification')::boolean) OR username<>'' THEN
  IF length(username) NOT BETWEEN 1 AND 30 OR username !~ '^[a-z0-9_][a-z0-9._]*$' OR username ~ '\.$|\.\.' THEN
   RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Masukkan username Instagram yang valid.';
  END IF;
 END IF;
 previous:=CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END;
 action:=CASE WHEN v.id IS NULL THEN 'SUBMITTED' ELSE 'RESUBMITTED' END;
 new_status:=CASE WHEN (c->>'enabled')::boolean AND (c->>'manualVerification')::boolean THEN 'PENDING_VERIFICATION' ELSE 'APPROVED' END;
 INSERT INTO "TryoutRegistrationVerification" ("tryoutId","userId",status,"instagramUsername","submittedChecklist",
  "configSnapshot","configVersion","requestKey","approvalMethod")
 VALUES (p_tryout,p_user,new_status,NULLIF(username,''),checks,c,t."growthVersion",req,
  CASE WHEN new_status='APPROVED' THEN 'CHECKLIST' ELSE NULL END)
 ON CONFLICT ("tryoutId","userId") DO UPDATE SET status=EXCLUDED.status,"instagramUsername"=EXCLUDED."instagramUsername",
  "submittedChecklist"=EXCLUDED."submittedChecklist","configSnapshot"=EXCLUDED."configSnapshot","configVersion"=EXCLUDED."configVersion",
  "adminChecklist"='{}',"rejectionReasons"='{}',"verifiedAt"=NULL,"verifiedBy"=NULL,"approvalMethod"=EXCLUDED."approvalMethod",
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

CREATE FUNCTION growth_assert_access(p_tryout text,p_user text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
 IF EXISTS(SELECT 1 FROM "user" WHERE id=p_user AND COALESCE("isSandbox",false)) THEN RETURN true; END IF;
 SELECT status INTO s FROM "TryoutRegistrationVerification" WHERE "tryoutId"=p_tryout AND "userId"=p_user;
 IF s='PENDING_VERIFICATION' THEN RAISE EXCEPTION 'GROWTH_PENDING: Pendaftaranmu masih menunggu verifikasi.'; END IF;
 IF s='REJECTED' THEN RAISE EXCEPTION 'GROWTH_REJECTED: Pendaftaran belum disetujui. Ajukan ulang persyaratanmu.'; END IF;
 RETURN true;
END $$;

CREATE FUNCTION growth_finalize_paid(p_tryout text,p_user text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v "TryoutRegistrationVerification"; previous jsonb;
BEGIN
 PERFORM id FROM "user" WHERE id=p_user FOR UPDATE;
 SELECT * INTO v FROM "TryoutRegistrationVerification" WHERE "tryoutId"=p_tryout AND "userId"=p_user FOR UPDATE;
 IF v.id IS NULL OR v.status='APPROVED' THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM "TryOut" WHERE id=p_tryout AND "solutionPrice">0) OR
  NOT (EXISTS(SELECT 1 FROM "UnlockedSolution" WHERE "tryOutId"=p_tryout AND "userId"=p_user) OR
   EXISTS(SELECT 1 FROM "user" WHERE id=p_user AND "isPremium"=true AND ("premiumExpiresAt" IS NULL OR ("premiumExpiresAt" AT TIME ZONE 'UTC')>CURRENT_TIMESTAMP))) THEN
  RAISE EXCEPTION 'GROWTH_FORBIDDEN: Hak berbayar belum tersedia.';
 END IF;
 previous:=to_jsonb(v);
 UPDATE "TryoutRegistrationVerification" SET status='APPROVED',"approvalMethod"='PAID',"rejectionReasons"='{}',
  version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=v.id RETURNING * INTO v;
 INSERT INTO "TryoutVerificationHistory" ("tryoutId","verificationId",action,"actorId",before,after)
 VALUES(p_tryout,v.id,'PAID_ACCESS',p_user,previous,to_jsonb(v));
 PERFORM growth_server_event(p_tryout,p_user,'registration_approved',v."requestKey",'{"method":"PAID","engagementVerified":false}');
END $$;
