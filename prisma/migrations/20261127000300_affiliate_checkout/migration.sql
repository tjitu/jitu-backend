-- Shared by the Nest checkout and the Next server route. A reservation is made
-- before contacting Midtrans; an orphan reservation expires with its checkout.
CREATE FUNCTION affiliate_quote(vid text, original_amount integer, checkout_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v "Voucher"; c jsonb; rates jsonb; r "AffiliateCheckout";
  d int; commission_rate int; boosts text[] := '{}'; pending_uses int;
BEGIN
  SELECT * INTO v FROM "Voucher" WHERE id = vid FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referral code not found'; END IF;
  IF v."affiliateId" IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM "AffiliateProfile" WHERE id = v."affiliateId" FOR UPDATE;
  PERFORM affiliate_require_accepted(v."affiliateId");
  IF NOT v."isActive" OR (v."expiresAt" IS NOT NULL AND v."expiresAt" <= CURRENT_TIMESTAMP) OR
    (v."maxUsage" IS NOT NULL AND v."usedCount" >= v."maxUsage") OR original_amount < v."minPurchase" OR original_amount < 0 THEN
    RAISE EXCEPTION 'Referral code is not eligible for this checkout';
  END IF;
  IF checkout_id IS NOT NULL THEN
    SELECT * INTO r FROM "AffiliateCheckout" WHERE id = checkout_id;
    IF FOUND THEN
      IF r."voucherId" <> vid OR r."originalAmount" <> original_amount OR r."expiresAt" <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'Checkout reservation does not match';
      END IF;
      RETURN to_jsonb(r);
    END IF;
  END IF;
  IF v."maxUsage" IS NOT NULL THEN
    SELECT count(*) INTO pending_uses FROM "AffiliateCheckout" s LEFT JOIN "Payment" p ON p."affiliateCheckoutId"=s.id
      WHERE s."voucherId"=vid AND s.id IS DISTINCT FROM checkout_id AND (
        (p.id IS NULL AND s."expiresAt">CURRENT_TIMESTAMP) OR
        (p.id IS NOT NULL AND p.status::text<>'CONFIRMED' AND COALESCE(p.metadata->>'affiliate_terminal','false')<>'true'));
    IF v."usedCount"+pending_uses>=v."maxUsage" THEN RAISE EXCEPTION 'Referral usage limit is reserved by another checkout'; END IF;
  END IF;
  c := affiliate_config(v."affiliateId");
  rates := affiliate_rates(v."affiliateId");
  d := (rates->>'discount')::int; commission_rate := (rates->>'commission')::int;
  SELECT ARRAY(SELECT jsonb_array_elements_text(rates->'boostIds')) INTO boosts;
  r.id := checkout_id; r."affiliateId" := v."affiliateId"; r."voucherId" := vid; r.code := v.code;
  r."originalAmount" := original_amount; r."baseDiscount" := (c->>'discount')::int;
  r."baseCommission" := (c->>'commission')::int; r."discountRate" := d; r."commissionRate" := commission_rate;
  r."boostIds" := boosts;
  r."discountAmount" := round(original_amount::numeric * d / 10000)::int;
  IF v."maxDiscount" > 0 THEN r."discountAmount" := least(r."discountAmount",v."maxDiscount"); END IF;
  r."paidAmount" := greatest(0,original_amount - r."discountAmount");
  r.commission := round(r."paidAmount"::numeric * commission_rate / 10000)::int;
  r."createdAt" := CURRENT_TIMESTAMP; r."expiresAt" := CURRENT_TIMESTAMP + interval '15 minutes';
  IF checkout_id IS NOT NULL THEN INSERT INTO "AffiliateCheckout" SELECT r.*; END IF;
  RETURN to_jsonb(r);
END $$;

ALTER TABLE "AffiliateCheckout" ADD CONSTRAINT affiliate_checkout_valid CHECK (
  "originalAmount" >= 0 AND "discountAmount" >= 0 AND "paidAmount" = "originalAmount" - "discountAmount" AND
  "baseDiscount" BETWEEN 0 AND 10000 AND "baseCommission" BETWEEN 0 AND 10000 AND
  "discountRate" BETWEEN 0 AND 10000 AND "commissionRate" BETWEEN 0 AND 10000 AND
  "expiresAt" > "createdAt" AND
  commission = round("paidAmount"::numeric * "commissionRate" / 10000)::int);

CREATE FUNCTION affiliate_payment_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "AffiliateCheckout";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."affiliateCheckoutId" IS DISTINCT FROM NEW."affiliateCheckoutId" THEN
      RAISE EXCEPTION 'Payment attribution is immutable';
    END IF;
  END IF;
  IF NEW."affiliateCheckoutId" IS NULL THEN
    -- Reject newly created assigned vouchers that bypass the affiliate quote.
    IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM "Voucher" WHERE id = NEW."voucherId" AND "affiliateId" IS NOT NULL) THEN
      RAISE EXCEPTION 'Affiliate checkout snapshot required';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT s FROM "AffiliateCheckout" WHERE id = NEW."affiliateCheckoutId";
  IF NEW.amount <> s."paidAmount" OR NEW."voucherId" IS DISTINCT FROM s."voucherId" OR
    NEW."voucherCode" IS DISTINCT FROM s.code THEN RAISE EXCEPTION 'Payment does not match affiliate snapshot'; END IF;
  IF TG_OP = 'INSERT' AND s."expiresAt" <= CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'Checkout expired'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER affiliate_payment_snapshot BEFORE INSERT OR UPDATE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION affiliate_payment_snapshot();

CREATE FUNCTION affiliate_payment_commission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "AffiliateCheckout";
BEGIN
  IF NEW."affiliateCheckoutId" IS NOT NULL AND NEW.status::text = 'CONFIRMED' THEN
    SELECT * INTO STRICT s FROM "AffiliateCheckout" WHERE id = NEW."affiliateCheckoutId";
    INSERT INTO "AffiliateLedger" (id,"affiliateId","checkoutId","eventKey",kind,amount)
      VALUES (gen_random_uuid()::text,s."affiliateId",s.id,'commission:' || NEW.id,'COMMISSION',s.commission)
      ON CONFLICT ("eventKey") DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER affiliate_payment_commission AFTER INSERT OR UPDATE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION affiliate_payment_commission();

-- Uses the verified cumulative refund total returned by Midtrans Get Status.
-- Repeated or out-of-order notifications cannot create a duplicate adjustment.
CREATE FUNCTION affiliate_refund(order_id text, cumulative_amount integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s "AffiliateCheckout"; p "Payment"; reversed int; target int; prior_refund int;
BEGIN
  SELECT * INTO p FROM "Payment" WHERE "orderId" = order_id FOR UPDATE;
  IF NOT FOUND OR p."affiliateCheckoutId" IS NULL THEN RETURN; END IF;
  SELECT * INTO STRICT s FROM "AffiliateCheckout" WHERE id = p."affiliateCheckoutId";
  PERFORM 1 FROM "AffiliateProfile" WHERE id = s."affiliateId" FOR UPDATE;
  IF cumulative_amount < 0 OR cumulative_amount > s."paidAmount" OR p.status::text <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'Invalid verified refund total';
  END IF;
  target := round(cumulative_amount::numeric * s."commissionRate" / 10000)::int;
  target := least(s.commission,target);
  SELECT COALESCE(-sum(amount),0)::int,COALESCE(max("refundTotal"),0)::int INTO reversed,prior_refund
    FROM "AffiliateLedger" WHERE "checkoutId" = s.id AND kind = 'REFUND';
  IF cumulative_amount > prior_refund THEN
    INSERT INTO "AffiliateLedger" (id,"affiliateId","checkoutId","eventKey",kind,amount,"refundTotal")
      VALUES (gen_random_uuid()::text,s."affiliateId",s.id,'refund:' || p.id || ':' || cumulative_amount,'REFUND',reversed-target,cumulative_amount);
    INSERT INTO "AffiliateAudit" (id,"actorId",event,"entityId",after) VALUES
      (gen_random_uuid()::text,'midtrans','COMMISSION_REFUND',s.id,jsonb_build_object('cumulativeRefund',cumulative_amount,'adjustment',reversed-target));
  END IF;
END $$;
