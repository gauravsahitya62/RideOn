-- Customer-owned addresses for persistent profile data.
CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label VARCHAR(50) NOT NULL,
  recipient VARCHAR(100) NOT NULL,
  phone VARCHAR(16) NOT NULL,
  street VARCHAR(160) NOT NULL,
  area VARCHAR(120) NOT NULL DEFAULT '',
  city VARCHAR(100) NOT NULL,
  postal_code VARCHAR(10) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_addresses_customer_created_idx ON customer_addresses(customer_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_one_default_idx ON customer_addresses(customer_id) WHERE is_default=true;
