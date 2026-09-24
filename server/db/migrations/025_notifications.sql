-- Forward-only notification and push-device foundation.
-- Existing migrations are not modified. No production data is deleted or rewritten.

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(1000) NOT NULL,
  booking_id UUID NULL REFERENCES bookings(id) ON DELETE SET NULL,
  ticket_id UUID NULL REFERENCES support_tickets(id) ON DELETE SET NULL,
  read_at TIMESTAMPTZ NULL,
  dedupe_key VARCHAR(180) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_type_allowed CHECK (type IN (
    'booking_created','booking_confirmed','booking_rejected','booking_cancelled',
    'payment_success','payment_failed','refund_initiated','refund_completed',
    'security_deposit_held','security_deposit_released','delivery_assigned',
    'delivery_started','vehicle_in_delivery','vehicle_delivered','booking_completed',
    'review_reminder','support_reply','new_booking','payment_received',
    'delivery_required','vehicle_returned','customer_review','new_support_ticket',
    'payment_issue','refund_issue','delivery_issue','dispute_created'
  )),
  CONSTRAINT notifications_title_length CHECK (char_length(title) BETWEEN 1 AND 160),
  CONSTRAINT notifications_body_length CHECK (char_length(body) BETWEEN 1 AND 1000),
  CONSTRAINT notifications_reference_check CHECK (booking_id IS NOT NULL OR ticket_id IS NOT NULL OR type NOT IN (
    'booking_created','booking_confirmed','booking_rejected','booking_cancelled',
    'payment_success','payment_failed','refund_initiated','refund_completed',
    'security_deposit_held','security_deposit_released','delivery_assigned',
    'delivery_started','vehicle_in_delivery','vehicle_delivered','booking_completed',
    'review_reminder','support_reply','new_booking','payment_received',
    'delivery_required','vehicle_returned','customer_review','support_reply'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_recipient_dedupe_idx
  ON notifications(recipient_user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON notifications(recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unread_created_idx
  ON notifications(recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_booking_created_idx
  ON notifications(booking_id, created_at DESC)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_ticket_created_idx
  ON notifications(ticket_id, created_at DESC)
  WHERE ticket_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  push_token VARCHAR(512) NOT NULL,
  platform VARCHAR(16) NOT NULL,
  device_id VARCHAR(255) NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT push_devices_platform_allowed CHECK (platform IN ('ios','android','web','unknown')),
  CONSTRAINT push_devices_token_length CHECK (char_length(push_token) BETWEEN 10 AND 512)
);

CREATE UNIQUE INDEX IF NOT EXISTS push_devices_token_idx ON push_devices(push_token);
CREATE INDEX IF NOT EXISTS push_devices_user_enabled_idx ON push_devices(user_id, enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  transactional_enabled BOOLEAN NOT NULL DEFAULT true,
  promotional_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
