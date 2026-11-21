CREATE TABLE IF NOT EXISTS t_platform_version_image_check (
  image_key text PRIMARY KEY CHECK (image_key='platform'),
  image_name text NOT NULL,
  status text NOT NULL DEFAULT ('pending') CHECK (status IN ('pending','checking','ready','failed')),
  digest text,
  build_commit text,
  created_at DATETIME(6),
  checked_at DATETIME(6),
  next_check_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  checking_until DATETIME(6),
  last_error_code text,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX t_platform_version_image_check_due_idx ON t_platform_version_image_check(status,next_check_at,checking_until);
