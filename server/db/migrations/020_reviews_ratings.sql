-- Forward-only Reviews & Ratings foundation.
-- One review per completed booking and direction. Customer reviews are
-- published against the vendor who owned the booked vehicle; vendor reviews
-- are published against the customer who made the booking.

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  reviewer_user_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  reviewee_user_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  review_type VARCHAR(32) NOT NULL,
  rating SMALLINT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reviews_type_allowed CHECK (review_type IN ('customer_to_vendor','vendor_to_customer')),
  CONSTRAINT reviews_rating_allowed CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT reviews_comment_length CHECK (comment IS NULL OR char_length(comment) <= 1000),
  CONSTRAINT reviews_reviewer_reviewee_different CHECK (reviewer_user_id <> reviewee_user_id),
  CONSTRAINT reviews_one_per_booking_direction UNIQUE (booking_id, reviewer_user_id, review_type)
);

CREATE INDEX IF NOT EXISTS reviews_reviewee_type_created_idx
  ON reviews(reviewee_user_id, review_type, created_at DESC);

CREATE INDEX IF NOT EXISTS reviews_booking_created_idx
  ON reviews(booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS reviews_vehicle_type_created_idx
  ON reviews((booking_id), review_type, created_at DESC);
