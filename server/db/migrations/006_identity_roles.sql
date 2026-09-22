-- Centralized RideOn identity role model.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'customer'
    CHECK (role IN ('customer','vendor'));

CREATE INDEX IF NOT EXISTS customers_role_idx ON customers(role);

UPDATE customers c
SET role = 'vendor'
WHERE EXISTS (SELECT 1 FROM vendors v WHERE v.owner_customer_id = c.id);

CREATE INDEX IF NOT EXISTS vendors_owner_customer_idx ON vendors(owner_customer_id);
