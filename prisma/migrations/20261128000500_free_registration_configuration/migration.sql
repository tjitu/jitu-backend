CREATE TABLE "TryoutGrowthSettings" (
 id text PRIMARY KEY DEFAULT 'global' CHECK(id='global'),
 "communityUrl" text NOT NULL,version integer NOT NULL DEFAULT 1,
 "updatedBy" text,"updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "TryoutGrowthSettings" (id,"communityUrl","updatedBy")
VALUES ('global','https://chat.whatsapp.com/GYG22u7at5NCyPHk4XQso2','system:registration-requirements');
ALTER TABLE "TryoutGrowthSettings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "TryoutGrowthSettings" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON "TryoutGrowthSettings" FROM %I',r); END IF;
 END LOOP;
END $$;
CREATE FUNCTION growth_community_url() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT "communityUrl" FROM "TryoutGrowthSettings" WHERE id='global';
$$;
CREATE FUNCTION growth_settings_update(p_url text,p_version integer,p_actor text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE settings "TryoutGrowthSettings";
BEGIN
 IF length(p_url)>2048 OR p_url IS NULL OR p_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Isi URL HTTPS komunitas yang valid.';
 END IF;
 UPDATE "TryoutGrowthSettings" SET "communityUrl"=p_url,version=version+1,"updatedBy"=p_actor,"updatedAt"=CURRENT_TIMESTAMP
 WHERE id='global' AND version=p_version RETURNING * INTO settings;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROWTH_CONFLICT: Link komunitas telah berubah. Muat ulang sebelum menyimpan.'; END IF;
 RETURN to_jsonb(settings);
END $$;

CREATE OR REPLACE FUNCTION growth_defaults() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT '{"enabled":true,"manualVerification":true,
 "profileUrl":"https://www.instagram.com/jituptn/","campaignUrl":"",
 "items":{"follow":{"enabled":true,"required":true},"likeTag":{"enabled":true,"required":true},"story":{"enabled":true,"required":true}},
 "mentionRequired":true,"prize":{"enabled":false,"winners":5,"type":"Saldo E-Wallet","info":""},
 "community":{"enabled":false,"url":""}}'::jsonb || jsonb_build_object('community',jsonb_build_object('enabled',false,'url',growth_community_url()));
$$;

CREATE OR REPLACE FUNCTION growth_validate_config(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
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
 c:=jsonb_set(c,'{enabled}','true');
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
 c:=jsonb_set(c,'{items,follow}','{"enabled":true,"required":true}');
 IF NOT (c->'items'->'story'->>'enabled')::boolean THEN c:=jsonb_set(c,'{mentionRequired}','false'); END IF;
 IF jsonb_typeof(c->'prize'->'enabled')<>'boolean' OR jsonb_typeof(c->'community'->'enabled')<>'boolean' THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Pengaturan hadiah atau komunitas tidak valid.';
 END IF;
 IF jsonb_typeof(c->'prize'->'winners')<>'number' OR COALESCE(c->'prize'->>'winners','') !~ '^[0-9]{1,3}$' OR (c->'prize'->>'winners')::int NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Jumlah pemenang harus 1Ã¢â‚¬â€œ100.';
 END IF;
 IF length(COALESCE(c->'prize'->>'type','')) NOT BETWEEN 1 AND 80 OR length(COALESCE(c->'prize'->>'info',''))>500 THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Informasi hadiah tidak valid.';
 END IF;
 IF (c->>'enabled')::boolean THEN
  IF COALESCE(c->>'profileUrl','') !~ '^https://(www\.)?instagram\.com/[A-Za-z0-9._]+/?$' THEN
   RAISE EXCEPTION 'GROWTH_CONFIG: Isi URL profil Instagram yang valid.';
  END IF;
  IF ((c->'items'->'likeTag'->>'enabled')::boolean OR (c->'items'->'story'->>'enabled')::boolean)
   AND COALESCE(c->>'campaignUrl','')<>'' AND COALESCE(c->>'campaignUrl','') !~ '^https://(www\.)?instagram\.com/(p|reel|tv)/[A-Za-z0-9_-]+/?(\?[^[:space:]]*)?$' THEN
   RAISE EXCEPTION 'GROWTH_CONFIG: Isi URL postingan kampanye Instagram yang valid.';
  END IF;
 END IF;
 IF COALESCE(c->>'campaignUrl','')<>'' AND COALESCE(c->>'campaignUrl','') !~ '^https://(www\.)?instagram\.com/(p|reel|tv)/[A-Za-z0-9_-]+/?(\?[^[:space:]]*)?$' THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Isi URL postingan kampanye Instagram yang valid.';
 END IF;
 IF COALESCE(c->'community'->>'url','')<>'' AND COALESCE(c->'community'->>'url','') !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: Isi URL HTTPS komunitas yang valid.';
 END IF;
 c:=jsonb_set(c,'{community,url}',to_jsonb(growth_community_url()));
 RETURN c;
END $$;


CREATE FUNCTION growth_effective_config(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb:=growth_validate_config(p_input); community_mode boolean;
BEGIN
 community_mode:=btrim(c->>'campaignUrl')='';
 c:=jsonb_set(c,'{items,community}',jsonb_build_object('enabled',community_mode,'required',community_mode));
 IF community_mode THEN
  c:=jsonb_set(c,'{items,likeTag,enabled}','false');
  c:=jsonb_set(c,'{items,story,enabled}','false');
  c:=jsonb_set(c,'{mentionRequired}','false');
  c:=jsonb_set(c,'{community,enabled}','true');
 END IF;
 RETURN c;
END $$;
ALTER TABLE "TryOut" ALTER COLUMN "growthConfig" SET DEFAULT '{"enabled":true}';
ALTER TABLE "TryoutRegistrationVerification" ADD COLUMN "contactDetails" jsonb NOT NULL DEFAULT '{}';
