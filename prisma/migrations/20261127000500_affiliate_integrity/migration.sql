CREATE INDEX "AffiliateTerms_agreementId_idx" ON "AffiliateTerms"("agreementId");
CREATE INDEX "AffiliateBoost_quotaId_idx" ON "AffiliateBoost"("quotaId");
CREATE INDEX "AffiliateAcceptance_agreementId_idx" ON "AffiliateAcceptance"("agreementId");
CREATE INDEX "AffiliateCheckout_voucherId_idx" ON "AffiliateCheckout"("voucherId");
CREATE INDEX "AffiliateLedger_checkoutId_idx" ON "AffiliateLedger"("checkoutId");
ALTER TABLE "AffiliateLedger" ADD CONSTRAINT affiliate_ledger_valid CHECK (
  (kind='COMMISSION' AND amount>=0 AND "refundTotal"=0) OR (kind='REFUND' AND amount<=0 AND "refundTotal">0));

CREATE FUNCTION affiliate_payout_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payout history is immutable'; END IF;
  IF (to_jsonb(OLD)-'status') IS DISTINCT FROM (to_jsonb(NEW)-'status') OR
    (OLD.status <> NEW.status AND (OLD.status <> 'PENDING' OR NEW.status NOT IN ('PAID','CANCELLED'))) THEN
    RAISE EXCEPTION 'Payout history is immutable except pending settlement';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER affiliate_payout_immutable BEFORE UPDATE OR DELETE ON "AffiliatePayout"
  FOR EACH ROW EXECUTE FUNCTION affiliate_payout_immutable();
CREATE FUNCTION affiliate_payment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."affiliateCheckoutId" IS NOT NULL THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Affiliate payment history cannot be deleted'; END IF;
    IF OLD.status::text='CONFIRMED' AND NEW.status::text<>'CONFIRMED' THEN
      RAISE EXCEPTION 'Use a verified refund adjustment for a confirmed affiliate payment';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER affiliate_payment_history BEFORE UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION affiliate_payment_history();
REVOKE ALL ON FUNCTION affiliate_payout_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION affiliate_payment_history() FROM PUBLIC;
