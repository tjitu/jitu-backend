ALTER TABLE "TryOut"
  ADD COLUMN "growthConfig" jsonb NOT NULL DEFAULT '{"enabled":false}',
  ADD COLUMN "growthVersion" integer NOT NULL DEFAULT 0,
  ADD COLUMN "growthUpdatedBy" text;

CREATE TABLE "TryoutRegistrationVerification" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tryoutId" text NOT NULL REFERENCES "TryOut"(id) ON DELETE CASCADE,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('PENDING_VERIFICATION','APPROVED','REJECTED')),
  "instagramUsername" text,
  "submittedChecklist" jsonb NOT NULL DEFAULT '{}',
  "adminChecklist" jsonb NOT NULL DEFAULT '{}',
  "configSnapshot" jsonb NOT NULL,
  "configVersion" integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  "submissionNumber" integer NOT NULL DEFAULT 1,
  "requestKey" text NOT NULL,
  "submittedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" timestamptz,
  "verifiedBy" text,
  "approvalMethod" text,
  "rejectionReasons" text[] NOT NULL DEFAULT '{}',
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tryoutId","userId")
);
CREATE INDEX "growth_verification_queue_idx" ON "TryoutRegistrationVerification" ("tryoutId",status,"submittedAt",id);
CREATE INDEX "growth_verification_user_idx" ON "TryoutRegistrationVerification" ("userId");

CREATE TABLE "TryoutVerificationHistory" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tryoutId" text NOT NULL REFERENCES "TryOut"(id) ON DELETE CASCADE,
  "verificationId" text REFERENCES "TryoutRegistrationVerification"(id) ON DELETE CASCADE,
  action text NOT NULL,
  "actorId" text NOT NULL,
  before jsonb,
  after jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "growth_history_verification_idx" ON "TryoutVerificationHistory" ("verificationId","createdAt",id);
CREATE TABLE "TryoutGrowthEvent" (
  id text PRIMARY KEY,
  "tryoutId" text NOT NULL REFERENCES "TryOut"(id) ON DELETE CASCADE,
  "userId" text REFERENCES "user"(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN ('registration_button_clicked','social_engagement_modal_viewed',
    'social_engagement_link_clicked','social_engagement_modal_abandoned','registration_submitted',
    'registration_approved','registration_rejected','registration_resubmitted','community_invitation_clicked','community_invitation_viewed')),
  source text NOT NULL CHECK (source IN ('CLIENT','SERVER')),
  "sessionId" text,
  metadata jsonb NOT NULL DEFAULT '{}',
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "growth_event_tryout_idx" ON "TryoutGrowthEvent" ("tryoutId","createdAt",event);

CREATE FUNCTION growth_defaults() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT '{"enabled":false,"manualVerification":true,
 "profileUrl":"https://www.instagram.com/jituptn/","campaignUrl":"",
 "items":{"follow":{"enabled":true,"required":true},"likeTag":{"enabled":true,"required":true},"story":{"enabled":true,"required":true}},
 "mentionRequired":true,"prize":{"enabled":false,"winners":5,"type":"Saldo E-Wallet","info":""},
 "community":{"enabled":false,"url":""}}'::jsonb;
$$;

CREATE FUNCTION growth_validate_config(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c jsonb; d jsonb:=growth_defaults(); k text; item jsonb;
BEGIN
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR octet_length(p_input::text)>12000 THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Konfigurasi pendaftaran tidak valid.';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) x WHERE x NOT IN
   ('enabled','manualVerification','profileUrl','campaignUrl','items','mentionRequired','prize','community')) THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Pengaturan tidak dikenal.';
 END IF;
 c:=d||p_input;
 IF jsonb_typeof(c->'items')<>'object' OR jsonb_typeof(c->'prize')<>'object' OR jsonb_typeof(c->'community')<>'object' THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Format pengaturan tidak valid.';
 END IF;
 c:=jsonb_set(c,'{prize}',(d->'prize')||(c->'prize'));
 c:=jsonb_set(c,'{community}',(d->'community')||(c->'community'));
 FOREACH k IN ARRAY ARRAY['enabled','manualVerification','mentionRequired'] LOOP
  IF jsonb_typeof(c->k)<>'boolean' THEN RAISE EXCEPTION 'GROWTH_CONFIG: Pengaturan harus berupa boolean.'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['follow','likeTag','story'] LOOP
  item:=(d->'items'->k)||COALESCE(c->'items'->k,'{}');
  IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'enabled')<>'boolean' OR jsonb_typeof(item->'required')<>'boolean' THEN
   RAISE EXCEPTION 'GROWTH_CONFIG: Pengaturan checklist tidak valid.';
  END IF;
  c:=jsonb_set(c,ARRAY['items',k],item,true);
 END LOOP;
 IF NOT (c->'items'->'story'->>'enabled')::boolean THEN c:=jsonb_set(c,'{mentionRequired}','false'); END IF;
 IF jsonb_typeof(c->'prize'->'enabled')<>'boolean' OR jsonb_typeof(c->'community'->'enabled')<>'boolean' THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Pengaturan hadiah atau komunitas tidak valid.';
 END IF;
 IF jsonb_typeof(c->'prize'->'winners')<>'number' OR COALESCE(c->'prize'->>'winners','') !~ '^[0-9]{1,3}$' OR (c->'prize'->>'winners')::int NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Jumlah pemenang harus 1–100.';
 END IF;
 IF length(COALESCE(c->'prize'->>'type','')) NOT BETWEEN 1 AND 80 OR length(COALESCE(c->'prize'->>'info',''))>500 THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Informasi hadiah tidak valid.';
 END IF;
 IF (c->>'enabled')::boolean THEN
  IF COALESCE(c->>'profileUrl','') !~ '^https://(www\.)?instagram\.com/[A-Za-z0-9._]+/?$' THEN
   RAISE EXCEPTION 'GROWTH_CONFIG: Isi URL profil Instagram yang valid.';
  END IF;
  IF ((c->'items'->'likeTag'->>'enabled')::boolean OR (c->'items'->'story'->>'enabled')::boolean)
   AND COALESCE(c->>'campaignUrl','') !~ '^https://(www\.)?instagram\.com/(p|reel|tv)/[A-Za-z0-9_-]+/?(\?[^[:space:]]*)?$' THEN
   RAISE EXCEPTION 'GROWTH_CONFIG: Isi URL postingan kampanye Instagram yang valid.';
  END IF;
 END IF;
 IF (c->'community'->>'enabled')::boolean AND COALESCE(c->'community'->>'url','') !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Isi URL HTTPS komunitas yang valid.';
 END IF;
 RETURN c;
END $$;

CREATE FUNCTION growth_config_update(p_config jsonb,p_current integer,p_expected integer) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 IF p_expected IS DISTINCT FROM p_current THEN RAISE EXCEPTION 'GROWTH_CONFLICT: Pengaturan telah berubah. Muat ulang sebelum menyimpan.'; END IF;
 RETURN growth_validate_config(p_config);
END $$;

CREATE FUNCTION growth_config_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."growthUpdatedBy" IS NOT NULL AND (TG_OP='INSERT' OR NEW."growthConfig" IS DISTINCT FROM OLD."growthConfig") THEN
  INSERT INTO "TryoutVerificationHistory" ("tryoutId",action,"actorId",before,after)
  VALUES (NEW.id,'CONFIG_UPDATED',NEW."growthUpdatedBy",CASE WHEN TG_OP='UPDATE' THEN OLD."growthConfig" ELSE NULL END,NEW."growthConfig");
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER growth_config_audit AFTER INSERT OR UPDATE OF "growthConfig" ON "TryOut" FOR EACH ROW EXECUTE FUNCTION growth_config_audit();

ALTER TABLE "TryoutRegistrationVerification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TryoutVerificationHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TryoutGrowthEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "TryoutRegistrationVerification","TryoutVerificationHistory","TryoutGrowthEvent" FROM PUBLIC;
