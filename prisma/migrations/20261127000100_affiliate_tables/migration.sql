-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "affiliateCheckoutId" TEXT;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "affiliateId" TEXT;
ALTER TABLE "Voucher" ADD COLUMN     "affiliateAssignedBy" TEXT;

-- CreateTable
CREATE TABLE "AffiliateProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateDefaults" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "config" JSONB NOT NULL,

    CONSTRAINT "AffiliateDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateTerms" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "agreementId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateQuota" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "allocated" INTEGER NOT NULL,
    "bonus" INTEGER NOT NULL DEFAULT 0,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AffiliateQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateBoost" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "quotaId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "baseRate" INTEGER NOT NULL,
    "additional" INTEGER NOT NULL,
    "activatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "maxTransactions" INTEGER,
    "requestKey" TEXT NOT NULL,

    CONSTRAINT "AffiliateBoost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateAgreement" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "party" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveAt" TIMESTAMPTZ(3),
    "requiresAcceptance" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateAcceptance" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "identity" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateCheckout" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "originalAmount" INTEGER NOT NULL,
    "baseDiscount" INTEGER NOT NULL,
    "baseCommission" INTEGER NOT NULL,
    "discountRate" INTEGER NOT NULL,
    "commissionRate" INTEGER NOT NULL,
    "boostIds" TEXT[],
    "discountAmount" INTEGER NOT NULL,
    "paidAmount" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateLedger" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "refundTotal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliatePayout" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidAt" TIMESTAMPTZ(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliatePayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateProfile_userId_key" ON "AffiliateProfile"("userId");

-- CreateIndex
CREATE INDEX "AffiliateTerms_affiliateId_effectiveAt_idx" ON "AffiliateTerms"("affiliateId", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateQuota_affiliateId_month_type_key" ON "AffiliateQuota"("affiliateId", "month", "type");

-- CreateIndex
CREATE INDEX "AffiliateBoost_affiliateId_group_expiresAt_idx" ON "AffiliateBoost"("affiliateId", "group", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateBoost_affiliateId_requestKey_key" ON "AffiliateBoost"("affiliateId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateAgreement_version_key" ON "AffiliateAgreement"("version");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateAcceptance_affiliateId_agreementId_key" ON "AffiliateAcceptance"("affiliateId", "agreementId");

-- CreateIndex
CREATE INDEX "AffiliateCheckout_affiliateId_createdAt_idx" ON "AffiliateCheckout"("affiliateId", "createdAt");

-- CreateIndex
CREATE INDEX "AffiliateCheckout_boostIds_idx" ON "AffiliateCheckout" USING GIN ("boostIds");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateLedger_eventKey_key" ON "AffiliateLedger"("eventKey");

-- CreateIndex
CREATE INDEX "AffiliateLedger_affiliateId_createdAt_idx" ON "AffiliateLedger"("affiliateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliatePayout_reference_key" ON "AffiliatePayout"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliatePayout_requestKey_key" ON "AffiliatePayout"("requestKey");

-- CreateIndex
CREATE INDEX "AffiliatePayout_affiliateId_paidAt_idx" ON "AffiliatePayout"("affiliateId", "paidAt");

-- CreateIndex
CREATE INDEX "AffiliateAudit_entityId_createdAt_idx" ON "AffiliateAudit"("entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_affiliateCheckoutId_key" ON "Payment"("affiliateCheckoutId");

-- CreateIndex
CREATE INDEX "Voucher_affiliateId_idx" ON "Voucher"("affiliateId");

-- AddForeignKey
ALTER TABLE "AffiliateTerms" ADD CONSTRAINT "AffiliateTerms_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateTerms" ADD CONSTRAINT "AffiliateTerms_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "AffiliateAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateQuota" ADD CONSTRAINT "AffiliateQuota_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateBoost" ADD CONSTRAINT "AffiliateBoost_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateBoost" ADD CONSTRAINT "AffiliateBoost_quotaId_fkey" FOREIGN KEY ("quotaId") REFERENCES "AffiliateQuota"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateAcceptance" ADD CONSTRAINT "AffiliateAcceptance_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateAcceptance" ADD CONSTRAINT "AffiliateAcceptance_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "AffiliateAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCheckout" ADD CONSTRAINT "AffiliateCheckout_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCheckout" ADD CONSTRAINT "AffiliateCheckout_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateLedger" ADD CONSTRAINT "AffiliateLedger_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateLedger" ADD CONSTRAINT "AffiliateLedger_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "AffiliateCheckout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_affiliateCheckoutId_fkey" FOREIGN KEY ("affiliateCheckoutId") REFERENCES "AffiliateCheckout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
