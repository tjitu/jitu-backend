CREATE FUNCTION affiliate_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR OLD."affiliateId" IS DISTINCT FROM NEW."affiliateId" THEN
    INSERT INTO "AffiliateAudit" (id,"actorId",event,"entityId",before,after) VALUES
      (gen_random_uuid()::text,COALESCE(NEW."affiliateAssignedBy",'team-admin'),'REFERRAL_ASSIGNED',NEW.id,
        CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('affiliateId',OLD."affiliateId") ELSE NULL END,
        jsonb_build_object('affiliateId',NEW."affiliateId",'code',NEW.code));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER affiliate_assignment_audit AFTER INSERT OR UPDATE OF "affiliateId" ON "Voucher"
  FOR EACH ROW EXECUTE FUNCTION affiliate_assignment_audit();

CREATE FUNCTION affiliate_configure(aid text, c jsonb, effective_at timestamptz, agreement_id text, actor_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_config jsonb;
BEGIN
  PERFORM 1 FROM "AffiliateProfile" WHERE id = aid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Affiliate not found'; END IF;
  IF NOT affiliate_validate_config(c) THEN RAISE EXCEPTION 'Invalid affiliate configuration'; END IF;
  IF effective_at < CURRENT_TIMESTAMP OR NOT EXISTS (
    SELECT 1 FROM "AffiliateAgreement" WHERE id = agreement_id AND status = 'PUBLISHED'
      AND "requiresAcceptance" AND "effectiveAt" <= effective_at) THEN
    RAISE EXCEPTION 'Commercial configuration requires a published agreement and a future effective date';
  END IF;
  IF EXISTS (SELECT 1 FROM "AffiliateAcceptance" WHERE "affiliateId" = aid AND "agreementId" = agreement_id) THEN
    RAISE EXCEPTION 'Publish a new agreement before changing accepted commercial terms';
  END IF;
  before_config := affiliate_config(aid);
  INSERT INTO "AffiliateTerms" (id,"affiliateId",config,"effectiveAt","agreementId")
    VALUES (gen_random_uuid()::text,aid,c,effective_at,agreement_id);
  INSERT INTO "AffiliateAudit" (id,"actorId",event,"entityId",before,after)
    VALUES (gen_random_uuid()::text,actor_id,'TERMS_SCHEDULED',aid,before_config,
      jsonb_build_object('config',c,'effectiveAt',effective_at,'agreementId',agreement_id));
END $$;

CREATE FUNCTION affiliate_bonus(aid text, kind text, quantity int, actor_id text, request_key text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE m text := to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta','YYYY-MM');
BEGIN
  PERFORM 1 FROM "AffiliateProfile" WHERE id = aid FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "AffiliateAudit" WHERE event = 'BONUS_QUOTA' AND "entityId" = aid AND after->>'requestKey' = request_key) THEN RETURN; END IF;
  IF quantity NOT BETWEEN 1 AND 10000 OR kind NOT IN ('COMMISSION','DISCOUNT','SUPER_DISCOUNT') THEN RAISE EXCEPTION 'Invalid bonus'; END IF;
  PERFORM affiliate_ensure_quota(aid);
  UPDATE "AffiliateQuota" SET bonus = bonus + quantity WHERE "affiliateId" = aid AND month = m AND type = kind;
  INSERT INTO "AffiliateAudit" (id,"actorId",event,"entityId",after) VALUES
    (gen_random_uuid()::text,actor_id,'BONUS_QUOTA',aid,jsonb_build_object('type',kind,'quantity',quantity,'month',m,'requestKey',request_key));
END $$;

CREATE FUNCTION affiliate_payout(aid text, payout_amount int, paid_at timestamptz, payment_reference text,
  payout_status text, internal_notes text, request_key text, actor_id text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE balance bigint; settled bigint; result "AffiliatePayout";
BEGIN
  PERFORM 1 FROM "AffiliateProfile" WHERE id = aid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Affiliate not found'; END IF;
  SELECT * INTO result FROM "AffiliatePayout" WHERE "requestKey" = request_key OR reference = payment_reference;
  IF FOUND THEN
    IF result."affiliateId" <> aid OR result.amount <> payout_amount OR result.reference <> payment_reference THEN
      RAISE EXCEPTION 'Payout reference already used';
    END IF;
    RETURN to_jsonb(result);
  END IF;
  IF payout_status NOT IN ('PENDING','PAID') OR payout_amount <= 0 OR length(trim(payment_reference)) < 2 THEN
    RAISE EXCEPTION 'Invalid payout';
  END IF;
  SELECT COALESCE(sum(amount),0) INTO balance FROM "AffiliateLedger" WHERE "affiliateId" = aid;
  SELECT COALESCE(sum(amount),0) INTO settled FROM "AffiliatePayout" WHERE "affiliateId" = aid AND status IN ('PENDING','PAID');
  IF payout_amount > balance - settled THEN RAISE EXCEPTION 'Payout exceeds eligible outstanding commission'; END IF;
  INSERT INTO "AffiliatePayout" (id,"affiliateId",amount,"paidAt",reference,status,notes,"requestKey")
    VALUES (gen_random_uuid()::text,aid,payout_amount,paid_at,payment_reference,payout_status,internal_notes,request_key)
    RETURNING * INTO result;
  INSERT INTO "AffiliateAudit" (id,"actorId",event,"entityId",after)
    VALUES (gen_random_uuid()::text,actor_id,'PAYOUT_RECORDED',aid,to_jsonb(result));
  RETURN to_jsonb(result);
END $$;

CREATE FUNCTION affiliate_payout_status(payout_id text, next_status text, actor_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p "AffiliatePayout";
BEGIN
  SELECT * INTO STRICT p FROM "AffiliatePayout" WHERE id = payout_id;
  PERFORM 1 FROM "AffiliateProfile" WHERE id = p."affiliateId" FOR UPDATE;
  SELECT * INTO STRICT p FROM "AffiliatePayout" WHERE id = payout_id FOR UPDATE;
  IF p.status = next_status THEN RETURN; END IF;
  IF p.status <> 'PENDING' OR next_status NOT IN ('PAID','CANCELLED') THEN RAISE EXCEPTION 'Payout is already settled'; END IF;
  UPDATE "AffiliatePayout" SET status = next_status WHERE id = payout_id;
  INSERT INTO "AffiliateAudit" (id,"actorId",event,"entityId",before,after)
    VALUES (gen_random_uuid()::text,actor_id,'PAYOUT_STATUS_CHANGED',p."affiliateId",to_jsonb(p),jsonb_build_object('status',next_status));
END $$;

INSERT INTO "AffiliateAgreement" (id,version,title,content,party,summary,status,"requiresAcceptance") VALUES
  (gen_random_uuid()::text,1,'Perjanjian Kerja Sama Afiliasi JITU PTN',
  '# Perjanjian Afiliasi — Draft untuk Tinjauan Owner

## 1. Identitas Para Pihak
Pihak JITU: {{jitu_party}}
Affiliator: {{affiliate_name}} ({{affiliate_identifier}})
[OWNER_REVIEW: Lengkapi identitas pihak yang berwenang.]

## 2. Ruang Lingkup Kerja Sama
[OWNER_REVIEW: Tentukan ruang lingkup kerja sama.]

## 3. Hak dan Kewajiban JITU PTN
[OWNER_REVIEW: Tentukan hak dan kewajiban JITU.]

## 4. Hak dan Kewajiban Affiliator
[OWNER_REVIEW: Tentukan hak dan kewajiban affiliator.]

## 5. Referral Code dan Attribution
[OWNER_REVIEW: Tinjau kebijakan atribusi referral.]

## 6. Customer Discount dan Affiliate Commission
Base discount: {{base_discount}}. Base commission: {{base_commission}}.
[OWNER_REVIEW: Tinjau ketentuan komersial dan perubahannya.]

## 7. Affiliate Boost Program
{{boost_configuration}}
[OWNER_REVIEW: Tinjau ketentuan program boost.]

## 8. Commission Calculation dan Eligibility
[OWNER_REVIEW: Tentukan eligibility, pembulatan, dan penyesuaian refund.]

## 9. Payment dan Payout Terms
[OWNER_REVIEW: Tentukan jadwal, minimum payout, pajak, dan settlement.]

## 10. Marketing Guidelines
[OWNER_REVIEW: Tentukan panduan pemasaran.]

## 11. Prohibited Activities dan Fraud Prevention
[OWNER_REVIEW: Tentukan aktivitas terlarang dan kebijakan fraud.]

## 12. Confidentiality dan Data Privacy
[OWNER_REVIEW: Tentukan kerahasiaan, privasi, dan retensi data.]

## 13. Perubahan Ketentuan Kerja Sama
[OWNER_REVIEW: Tentukan prosedur perubahan dan persetujuan.]

## 14. Masa Berlaku dan Pengakhiran Kerja Sama
[OWNER_REVIEW: Tentukan masa berlaku dan pengakhiran.]

## 15. Penyelesaian Perselisihan
[OWNER_REVIEW: Tentukan ketentuan penyelesaian perselisihan.]

## 16. Digital Acceptance
Versi: {{agreement_version}}. Efektif: {{effective_date}}.
Disetujui pada: {{acceptance_timestamp}}.
[OWNER_REVIEW: Tinjau pernyataan persetujuan digital.]',
  '', 'Draft awal; wajib ditinjau System Owner sebelum dipublikasikan.','DRAFT',true);

-- Deny direct browser/PostgREST access. Server DB roles must receive explicit
-- grants when they do not own these objects; see docs/affiliate-program.md.
DO $$ DECLARE t text; f regprocedure; BEGIN
  FOREACH t IN ARRAY ARRAY['AffiliateDefaults','AffiliateProfile','AffiliateTerms','AffiliateQuota','AffiliateBoost',
    'AffiliateAgreement','AffiliateAcceptance','AffiliateCheckout','AffiliateLedger','AffiliatePayout','AffiliateAudit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon',t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated',t); END IF;
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'affiliate_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated',f); END IF;
  END LOOP;
END $$;
