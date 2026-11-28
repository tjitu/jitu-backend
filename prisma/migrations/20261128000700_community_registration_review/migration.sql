CREATE OR REPLACE FUNCTION growth_review(p_tryout text,p_id text,p_actor text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v "TryoutRegistrationVerification"; before_row jsonb; checks jsonb; c jsonb; k text;
 action text:=p_input->>'action'; reasons text[]; required text[]:='{}';
BEGIN
 -- User lock first, consistent with free and paid registration transactions.
 PERFORM u.id FROM "user" u JOIN "TryoutRegistrationVerification" r ON r."userId"=u.id
 WHERE r.id=p_id AND r."tryoutId"=p_tryout FOR UPDATE OF u;
 SELECT * INTO v FROM "TryoutRegistrationVerification" WHERE id=p_id AND "tryoutId"=p_tryout FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: Pengajuan tidak ditemukan.'; END IF;
 IF v.version<>COALESCE((p_input->>'version')::int,-1) OR v.status<>'PENDING_VERIFICATION' THEN
  RAISE EXCEPTION 'GROWTH_CONFLICT: Pengajuan telah diproses atau berubah. Muat ulang sebelum melanjutkan.';
 END IF;
 IF action IS NULL OR action NOT IN ('SAVE_PROGRESS','APPROVE','REJECT') OR length(COALESCE(p_actor,''))=0 THEN
  RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Tindakan verifikasi tidak valid.';
 END IF;
 checks:=COALESCE(p_input->'checklist','{}'); c:=v."configSnapshot";
 IF jsonb_typeof(checks)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(checks) x WHERE x NOT IN ('follow','like','tag','story','mention','community')) THEN
  RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Checklist admin tidak valid.';
 END IF;
 FOREACH k IN ARRAY ARRAY['follow','like','tag','story','mention','community'] LOOP
  IF checks ? k AND jsonb_typeof(checks->k)<>'boolean' THEN RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Checklist admin tidak valid.'; END IF;
 END LOOP;
 checks:=v."adminChecklist"||checks;
 IF (c->'items'->'follow'->>'enabled')::boolean AND (c->'items'->'follow'->>'required')::boolean THEN required:=required||ARRAY['follow']; END IF;
 IF (c->'items'->'likeTag'->>'enabled')::boolean AND (c->'items'->'likeTag'->>'required')::boolean THEN required:=required||ARRAY['like','tag']; END IF;
 IF (c->'items'->'story'->>'enabled')::boolean AND (c->'items'->'story'->>'required')::boolean THEN
  required:=required||ARRAY['story'];
  IF (c->>'mentionRequired')::boolean THEN required:=required||ARRAY['mention']; END IF;
 END IF;
 IF COALESCE((c->'items'->'community'->>'enabled')::boolean,false) THEN required:=required||ARRAY['community']; END IF;
 IF action='APPROVE' THEN
  FOREACH k IN ARRAY required LOOP
   IF COALESCE(checks->>k,'false')<>'true' THEN RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Konfirmasi seluruh persyaratan wajib sebelum menyetujui.'; END IF;
  END LOOP;
 END IF;
 reasons:='{}';
 IF action='REJECT' THEN
  IF jsonb_typeof(p_input->'rejectionReasons') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_input->'rejectionReasons') NOT BETWEEN 1 AND 8 THEN
   RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Pilih atau tulis alasan penolakan.';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'rejectionReasons') x
    WHERE jsonb_typeof(x)<>'string' OR length(btrim(x#>>'{}')) NOT BETWEEN 2 AND 500) THEN
   RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Alasan penolakan harus 2Ã¢â‚¬â€œ500 karakter.';
  END IF;
  SELECT array_agg(DISTINCT btrim(x)) INTO reasons FROM jsonb_array_elements_text(p_input->'rejectionReasons') x;
 END IF;
 before_row:=to_jsonb(v);
 UPDATE "TryoutRegistrationVerification" SET "adminChecklist"=checks,version=version+1,"updatedAt"=CURRENT_TIMESTAMP,
  status=CASE action WHEN 'APPROVE' THEN 'APPROVED' WHEN 'REJECT' THEN 'REJECTED' ELSE status END,
  "verifiedAt"=CASE WHEN action<>'SAVE_PROGRESS' THEN CURRENT_TIMESTAMP ELSE NULL END,
  "verifiedBy"=CASE WHEN action<>'SAVE_PROGRESS' THEN p_actor ELSE NULL END,
  "approvalMethod"=CASE WHEN action='APPROVE' THEN 'MANUAL' ELSE NULL END,"rejectionReasons"=reasons
 WHERE id=p_id RETURNING * INTO v;
 INSERT INTO "TryoutVerificationHistory" ("tryoutId","verificationId",action,"actorId",before,after)
 VALUES(p_tryout,v.id,action,p_actor,before_row,to_jsonb(v));
 IF action='APPROVE' THEN PERFORM growth_admit(p_tryout,v."userId"); END IF;
 IF action IN ('APPROVE','REJECT') THEN
  PERFORM growth_server_event(p_tryout,v."userId",CASE action WHEN 'APPROVE' THEN 'registration_approved' ELSE 'registration_rejected' END,
   v."requestKey",jsonb_build_object('method','MANUAL','engagementVerified',action='APPROVE'));
 END IF;
 RETURN to_jsonb(v);
END $$;

-- Enable the new default free-registration requirements on existing tryouts.
-- Pending submissions retain their original requirements snapshot.
UPDATE "TryOut" SET "growthConfig"=growth_validate_config("growthConfig"),"growthVersion"="growthVersion"+1,
 "growthUpdatedBy"='system:free-registration-requirements';


CREATE OR REPLACE FUNCTION growth_client_event(p_tryout text,p_user text,p_input jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE kind text:=p_input->>'event'; event_id text:=p_input->>'eventId'; link text:=p_input->>'link';
BEGIN
 IF kind IS NULL OR kind NOT IN ('registration_button_clicked','social_engagement_modal_viewed',
  'social_engagement_link_clicked','social_engagement_modal_abandoned','community_invitation_clicked','community_invitation_viewed')
  OR event_id IS NULL OR event_id !~ '^[0-9a-fA-F-]{36}$' OR length(COALESCE(p_input->>'sessionId',''))>100 THEN
  RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Event tidak valid.';
 END IF;
 IF kind='social_engagement_link_clicked' AND (link IS NULL OR link NOT IN ('follow','likeTag','story','community')) THEN
  RAISE EXCEPTION 'GROWTH_REQUIREMENTS: Tautan event tidak valid.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "TryOut" WHERE id=p_tryout) THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: Tryout tidak ditemukan.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user,20261128));
 -- Bound noisy client telemetry. Registration/approval audit is never dropped.
 IF (SELECT count(*) FROM "TryoutGrowthEvent" WHERE "userId"=p_user AND source='CLIENT' AND "createdAt">CURRENT_TIMESTAMP-interval '1 minute')>=60 THEN RETURN; END IF;
 INSERT INTO "TryoutGrowthEvent" (id,"tryoutId","userId",event,source,"sessionId",metadata)
 VALUES ('client:'||p_user||':'||event_id,p_tryout,p_user,kind,'CLIENT',p_input->>'sessionId',
  CASE WHEN link IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('link',link) END) ON CONFLICT(id) DO NOTHING;
END $$;


-- These are privileged server operations, never public Supabase RPC endpoints.
DO $$ DECLARE r record; role_name text; BEGIN
 FOR r IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'growth_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',r.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',r.signature,role_name);
   END IF;
  END LOOP;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON "TryoutRegistrationVerification","TryoutVerificationHistory","TryoutGrowthEvent" FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
