-- Forward-only KYC infrastructure.
-- Sensitive identity verification records live in a dedicated schema so the KYC
-- core can later be extracted into an independent B2B service.
CREATE SCHEMA IF NOT EXISTS kyc_core;

DO $$
BEGIN
  CREATE TYPE kyc_core.document_status AS ENUM ('PENDING','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS kyc_core.verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id VARCHAR(100) NOT NULL DEFAULT 'rideon_internal',
  external_user_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  document_type VARCHAR(40) NOT NULL,
  document_hash TEXT,
  document_status kyc_core.document_status NOT NULL DEFAULT 'PENDING',
  ocr_data_extracted JSONB NOT NULL DEFAULT '{}'::jsonb,
  liveness_score NUMERIC(6,5),
  face_match_score NUMERIC(6,5),
  government_ref_id VARCHAR(255),
  provider VARCHAR(80),
  provider_verification_id VARCHAR(255),
  provider_event_id VARCHAR(255),
  decision_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (liveness_score IS NULL OR (liveness_score >= 0 AND liveness_score <= 1)),
  CHECK (face_match_score IS NULL OR (face_match_score >= 0 AND face_match_score <= 1))
);

CREATE INDEX IF NOT EXISTS kyc_verifications_user_created_idx
  ON kyc_core.verifications(external_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS kyc_verifications_status_created_idx
  ON kyc_core.verifications(document_status, created_at DESC);

CREATE INDEX IF NOT EXISTS kyc_verifications_client_user_idx
  ON kyc_core.verifications(client_id, external_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS kyc_verifications_provider_event_unique_idx
  ON kyc_core.verifications(provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS kyc_verifications_provider_ref_idx
  ON kyc_core.verifications(provider, provider_verification_id)
  WHERE provider_verification_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS kyc_verifications_document_hash_idx
  ON kyc_core.verifications(document_hash)
  WHERE document_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS kyc_core.global_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_hash TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kyc_global_blacklist_created_idx
  ON kyc_core.global_blacklist(created_at DESC);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS kyc_status VARCHAR(24) NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS active_kyc_id UUID;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_kyc_status_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_kyc_status_check
  CHECK (kyc_status IN ('UNVERIFIED','PENDING','VERIFIED','REJECTED','BLACKLISTED'));

CREATE INDEX IF NOT EXISTS customers_kyc_status_idx
  ON public.customers(kyc_status);

CREATE INDEX IF NOT EXISTS customers_active_kyc_idx
  ON public.customers(active_kyc_id)
  WHERE active_kyc_id IS NOT NULL;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_active_kyc_fk;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_active_kyc_fk
  FOREIGN KEY (active_kyc_id)
  REFERENCES kyc_core.verifications(id)
  ON DELETE SET NULL;

-- KYC is intentionally server-owned. The API database role remains the owner;
-- ordinary PUBLIC privileges are removed so clients cannot query the sensitive
-- schema directly through PostgreSQL/Supabase REST.
REVOKE ALL ON SCHEMA kyc_core FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA kyc_core FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA kyc_core FROM PUBLIC;
