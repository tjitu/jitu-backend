-- Central defaults, expressed in basis points. All monetary values are whole IDR.
INSERT INTO "AffiliateDefaults" (id, config) VALUES ('default', '{
  "discount":1500,"commission":1000,"boosts":{
    "COMMISSION":{"additional":500,"quota":10,"durationHours":24,"available":true,"maxTransactions":null},
    "DISCOUNT":{"additional":500,"quota":10,"durationHours":24,"available":true,"maxTransactions":null},
    "SUPER_DISCOUNT":{"additional":1000,"quota":5,"durationHours":24,"available":true,"maxTransactions":null}
  }}'::jsonb);

CREATE FUNCTION affiliate_validate_config(c jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; b jsonb; base int;
BEGIN
  IF c IS NULL OR jsonb_typeof(c) <> 'object' THEN RETURN false; END IF;
  IF NOT (c ?& ARRAY['discount','commission','boosts']) THEN RETURN false; END IF;
  IF (c->>'discount') !~ '^\d+$' OR (c->>'commission') !~ '^\d+$' THEN RETURN false; END IF;
  IF (c->>'discount')::int NOT BETWEEN 0 AND 10000 OR
     (c->>'commission')::int NOT BETWEEN 0 AND 10000 THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['COMMISSION','DISCOUNT','SUPER_DISCOUNT'] LOOP
    b := c->'boosts'->k;
    IF b IS NULL OR NOT (b ?& ARRAY['additional','quota','durationHours','available','maxTransactions']) THEN RETURN false; END IF;
    IF COALESCE(b->>'additional','') !~ '^\d+$' OR COALESCE(b->>'quota','') !~ '^\d+$' OR
       COALESCE(b->>'durationHours','') !~ '^\d+$' OR jsonb_typeof(b->'available') <> 'boolean' THEN RETURN false; END IF;
    base := (c->>(CASE WHEN k = 'COMMISSION' THEN 'commission' ELSE 'discount' END))::int;
    IF (b->>'additional')::int + base > 10000 OR (b->>'quota')::int NOT BETWEEN 0 AND 10000 OR
       (b->>'durationHours')::int NOT BETWEEN 1 AND 744 THEN RETURN false; END IF;
    IF b->>'maxTransactions' IS NOT NULL AND
       (b->>'maxTransactions' !~ '^\d+$' OR (b->>'maxTransactions')::int NOT BETWEEN 1 AND 1000000) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE "AffiliateDefaults" ADD CONSTRAINT affiliate_defaults_valid CHECK (affiliate_validate_config(config));
ALTER TABLE "AffiliateTerms" ADD CONSTRAINT affiliate_terms_valid CHECK (affiliate_validate_config(config));
ALTER TABLE "AffiliateQuota" ADD CONSTRAINT affiliate_quota_valid CHECK (
  allocated >= 0 AND bonus >= 0 AND used >= 0 AND used <= allocated + bonus AND
  type IN ('COMMISSION','DISCOUNT','SUPER_DISCOUNT') AND month ~ '^\d{4}-\d{2}$');
ALTER TABLE "AffiliateBoost" ADD CONSTRAINT affiliate_boost_valid CHECK (
  "expiresAt" > "activatedAt" AND "baseRate" >= 0 AND additional >= 0 AND "baseRate" + additional <= 10000 AND
  ("maxTransactions" IS NULL OR "maxTransactions" > 0) AND
  ((type = 'COMMISSION' AND "group" = 'COMMISSION') OR
   (type IN ('DISCOUNT','SUPER_DISCOUNT') AND "group" = 'DISCOUNT')));
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT affiliate_payout_valid CHECK (amount > 0 AND status IN ('PENDING','PAID','CANCELLED'));
ALTER TABLE "AffiliateAcceptance" ADD CONSTRAINT affiliate_acceptance_valid CHECK (status = 'ACCEPTED');
ALTER TABLE "AffiliateAgreement" ADD CONSTRAINT affiliate_agreement_valid CHECK (
  status IN ('DRAFT','PUBLISHED') AND (status = 'DRAFT' OR ("effectiveAt" IS NOT NULL AND "publishedAt" IS NOT NULL)));

CREATE FUNCTION affiliate_config(aid text,at_time timestamptz DEFAULT CURRENT_TIMESTAMP) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT config FROM "AffiliateTerms" t WHERE t."affiliateId" = aid AND t."effectiveAt" <= at_time
    AND (t."agreementId" IS NULL OR EXISTS (
      SELECT 1 FROM "AffiliateAcceptance" a WHERE a."affiliateId" = aid AND a."agreementId" = t."agreementId" AND a."acceptedAt"<=at_time))
  ORDER BY t."effectiveAt" DESC, t."createdAt" DESC, t.id DESC LIMIT 1
$$;

CREATE FUNCTION affiliate_rates(aid text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb := affiliate_config(aid); b "AffiliateBoost"; d int; rate int; boosts text[] := '{}'; reserved int;
BEGIN
  d := (c->>'discount')::int; rate := (c->>'commission')::int;
  FOR b IN SELECT * FROM "AffiliateBoost" WHERE "affiliateId"=aid AND "expiresAt">CURRENT_TIMESTAMP ORDER BY id LOOP
    IF b."maxTransactions" IS NOT NULL THEN
      SELECT count(*) INTO reserved FROM "AffiliateCheckout" s LEFT JOIN "Payment" p ON p."affiliateCheckoutId"=s.id
        WHERE s."boostIds" @> ARRAY[b.id] AND (p.status::text='CONFIRMED' OR
          (p.id IS NULL AND s."expiresAt">CURRENT_TIMESTAMP) OR
          (p.id IS NOT NULL AND COALESCE(p.metadata->>'affiliate_terminal','false')<>'true'));
      IF reserved>=b."maxTransactions" THEN CONTINUE; END IF;
    END IF;
    boosts := array_append(boosts,b.id);
    IF b."group"='COMMISSION' THEN rate := b."baseRate"+b.additional; ELSE d := b."baseRate"+b.additional; END IF;
  END LOOP;
  RETURN jsonb_build_object('discount',d,'commission',rate,'boostIds',boosts);
END $$;

CREATE FUNCTION affiliate_require_accepted(aid text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE required_id text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "AffiliateProfile" WHERE id = aid AND "isActive") THEN
    RAISE EXCEPTION 'Affiliate account is inactive' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO required_id FROM "AffiliateAgreement" WHERE status = 'PUBLISHED' AND "requiresAcceptance"
    AND "effectiveAt" <= CURRENT_TIMESTAMP ORDER BY version DESC LIMIT 1;
  IF required_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM "AffiliateAcceptance" WHERE "affiliateId" = aid AND "agreementId" = required_id) THEN
    RAISE EXCEPTION 'AGREEMENT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
END $$;

CREATE FUNCTION affiliate_ensure_quota(aid text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c jsonb; k text; started_at timestamptz; m text := to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta','YYYY-MM');
BEGIN
  SELECT "createdAt" INTO started_at FROM "AffiliateProfile" WHERE id = aid FOR UPDATE;
  c := COALESCE(affiliate_config(aid,greatest(started_at,date_trunc('month',CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')),affiliate_config(aid));
  FOREACH k IN ARRAY ARRAY['COMMISSION','DISCOUNT','SUPER_DISCOUNT'] LOOP
    INSERT INTO "AffiliateQuota" (id,"affiliateId",month,type,allocated,bonus,used)
      VALUES (gen_random_uuid()::text,aid,m,k,(c->'boosts'->k->>'quota')::int,0,0)
      ON CONFLICT ("affiliateId",month,type) DO NOTHING;
  END LOOP;
END $$;

CREATE FUNCTION affiliate_activate(aid text, kind text, request_key text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c jsonb; b jsonb; q "AffiliateQuota"; result "AffiliateBoost"; g text;
BEGIN
  PERFORM 1 FROM "AffiliateProfile" WHERE id = aid FOR UPDATE;
  PERFORM affiliate_require_accepted(aid);
  SELECT * INTO result FROM "AffiliateBoost" WHERE "affiliateId" = aid AND "requestKey" = request_key;
  IF FOUND THEN
    IF result.type <> kind THEN RAISE EXCEPTION 'Idempotency key already used for another boost'; END IF;
    RETURN to_jsonb(result);
  END IF;
  IF kind NOT IN ('COMMISSION','DISCOUNT','SUPER_DISCOUNT') OR length(request_key) NOT BETWEEN 8 AND 100 THEN
    RAISE EXCEPTION 'Invalid boost request';
  END IF;
  c := affiliate_config(aid); b := c->'boosts'->kind;
  IF NOT (b->>'available')::boolean THEN RAISE EXCEPTION 'Boost unavailable'; END IF;
  g := CASE WHEN kind = 'COMMISSION' THEN 'COMMISSION' ELSE 'DISCOUNT' END;
  IF EXISTS (SELECT 1 FROM "AffiliateBoost" WHERE "affiliateId" = aid AND "group" = g AND "expiresAt" > CURRENT_TIMESTAMP) THEN
    RAISE EXCEPTION 'A boost in this category is already active';
  END IF;
  PERFORM affiliate_ensure_quota(aid);
  SELECT * INTO q FROM "AffiliateQuota" WHERE "affiliateId" = aid AND type = kind
    AND month = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta','YYYY-MM') FOR UPDATE;
  IF q.used >= q.allocated + q.bonus THEN RAISE EXCEPTION 'Insufficient boost quota'; END IF;
  UPDATE "AffiliateQuota" SET used = used + 1 WHERE id = q.id;
  INSERT INTO "AffiliateBoost" (id,"affiliateId","quotaId",type,"group","baseRate",additional,"expiresAt","maxTransactions","requestKey")
    VALUES (gen_random_uuid()::text,aid,q.id,kind,g,
      (c->>(CASE WHEN g = 'COMMISSION' THEN 'commission' ELSE 'discount' END))::int,
      (b->>'additional')::int,CURRENT_TIMESTAMP + make_interval(hours => (b->>'durationHours')::int),
      (b->>'maxTransactions')::int,request_key) RETURNING * INTO result;
  INSERT INTO "AffiliateAudit" (id,"actorId",event,"entityId",after)
    VALUES (gen_random_uuid()::text,aid,'BOOST_ACTIVATED',result.id,to_jsonb(result));
  RETURN to_jsonb(result);
END $$;

-- The allocation row is created once per Jakarta month, on first access; this
-- avoids dependence on a cron job and preserves active boosts over month changes.
CREATE FUNCTION affiliate_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Historical affiliate record is immutable'; END $$;
CREATE TRIGGER affiliate_acceptance_immutable BEFORE UPDATE OR DELETE ON "AffiliateAcceptance"
  FOR EACH ROW EXECUTE FUNCTION affiliate_immutable();
CREATE TRIGGER affiliate_terms_immutable BEFORE UPDATE OR DELETE ON "AffiliateTerms"
  FOR EACH ROW EXECUTE FUNCTION affiliate_immutable();
CREATE TRIGGER affiliate_boost_immutable BEFORE UPDATE OR DELETE ON "AffiliateBoost"
  FOR EACH ROW EXECUTE FUNCTION affiliate_immutable();
CREATE TRIGGER affiliate_checkout_immutable BEFORE UPDATE OR DELETE ON "AffiliateCheckout"
  FOR EACH ROW EXECUTE FUNCTION affiliate_immutable();
CREATE TRIGGER affiliate_ledger_immutable BEFORE UPDATE OR DELETE ON "AffiliateLedger"
  FOR EACH ROW EXECUTE FUNCTION affiliate_immutable();
CREATE TRIGGER affiliate_audit_immutable BEFORE UPDATE OR DELETE ON "AffiliateAudit"
  FOR EACH ROW EXECUTE FUNCTION affiliate_immutable();
CREATE FUNCTION affiliate_published_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN RAISE EXCEPTION 'Create a new agreement version to change published content'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER affiliate_agreement_immutable BEFORE UPDATE OR DELETE ON "AffiliateAgreement"
  FOR EACH ROW EXECUTE FUNCTION affiliate_published_immutable();
