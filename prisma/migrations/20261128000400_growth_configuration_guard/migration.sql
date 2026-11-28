CREATE FUNCTION growth_configuration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c jsonb; k text;
BEGIN
 c:=growth_validate_config(NEW."growthConfig");
 FOREACH k IN ARRAY ARRAY['profileUrl','campaignUrl'] LOOP
  IF jsonb_typeof(c->k) IS DISTINCT FROM 'string' OR length(c->>k)>2048 THEN
   RAISE EXCEPTION 'GROWTH_CONFIG: URL harus berupa teks dengan maksimum 2048 karakter.';
  END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['type','info'] LOOP
  IF jsonb_typeof(c->'prize'->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'GROWTH_CONFIG: Informasi hadiah harus berupa teks.'; END IF;
 END LOOP;
 IF jsonb_typeof(c->'community'->'url') IS DISTINCT FROM 'string' OR length(c->'community'->>'url')>2048 THEN
  RAISE EXCEPTION 'GROWTH_CONFIG: URL komunitas tidak valid.';
 END IF;
 NEW."growthConfig":=c;
 RETURN NEW;
END $$;
CREATE TRIGGER growth_configuration_guard BEFORE INSERT OR UPDATE OF "growthConfig" ON "TryOut"
FOR EACH ROW EXECUTE FUNCTION growth_configuration_guard();
REVOKE ALL ON FUNCTION growth_configuration_guard() FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION growth_configuration_guard() FROM %I',r); END IF;
 END LOOP;
END $$;
