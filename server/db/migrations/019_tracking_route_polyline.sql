-- Forward-only route geometry storage for active delivery tracking.
ALTER TABLE tracking_sessions
  ADD COLUMN IF NOT EXISTS last_route_polyline TEXT;
