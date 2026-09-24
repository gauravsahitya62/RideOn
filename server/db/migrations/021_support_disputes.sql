-- Forward-only Customer Support & Disputes foundation.
-- Financial records are intentionally not mutated by ticket creation or messaging.

CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq;

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number VARCHAR(32) NOT NULL UNIQUE
    DEFAULT ('RID-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('support_ticket_number_seq')::text, 6, '0')),
  booking_id UUID NULL REFERENCES bookings(id) ON DELETE SET NULL,
  raised_by_user_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  assigned_to_user_id UUID NULL REFERENCES customers(id) ON DELETE SET NULL,
  category VARCHAR(40) NOT NULL,
  subject VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  resolution TEXT NULL,
  idempotency_key VARCHAR(128) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL,
  CONSTRAINT support_ticket_category_allowed CHECK (
    category IN ('Payment','Refund','Security Deposit','Booking','Vehicle','Delivery','Pickup/Return','Damage','Cancellation','Account','Technical Issue','Other')
  ),
  CONSTRAINT support_ticket_priority_allowed CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT support_ticket_status_allowed CHECK (status IN ('open','in_progress','waiting_for_user','resolved','closed')),
  CONSTRAINT support_ticket_subject_length CHECK (char_length(subject) BETWEEN 3 AND 160),
  CONSTRAINT support_ticket_description_length CHECK (char_length(description) BETWEEN 10 AND 5000),
  CONSTRAINT support_ticket_resolution_length CHECK (resolution IS NULL OR char_length(resolution) <= 5000),
  CONSTRAINT support_ticket_idempotency_length CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT support_ticket_resolved_at_consistency CHECK (
    (status IN ('resolved','closed') AND resolved_at IS NOT NULL)
    OR (status NOT IN ('resolved','closed') AND resolved_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_raised_idempotency_idx
  ON support_tickets(raised_by_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS support_tickets_raised_updated_idx
  ON support_tickets(raised_by_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS support_tickets_booking_updated_idx
  ON support_tickets(booking_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS support_tickets_status_priority_updated_idx
  ON support_tickets(status, priority, updated_at DESC);

CREATE INDEX IF NOT EXISTS support_tickets_category_updated_idx
  ON support_tickets(category, updated_at DESC);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  message TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ticket_message_length CHECK (char_length(message) BETWEEN 1 AND 5000)
);

CREATE INDEX IF NOT EXISTS ticket_messages_ticket_created_idx
  ON ticket_messages(ticket_id, created_at ASC);

CREATE INDEX IF NOT EXISTS ticket_messages_sender_created_idx
  ON ticket_messages(sender_user_id, created_at DESC);
