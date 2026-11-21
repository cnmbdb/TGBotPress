CREATE TABLE IF NOT EXISTS t_platform_version_image_check (
  image_key text PRIMARY KEY CHECK (image_key='platform'),
  image_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','checking','ready','failed')),
  digest text,
  build_commit text,
  created_at timestamptz,
  checked_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  checking_until timestamptz,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS t_platform_version_image_check_due_idx ON t_platform_version_image_check(status,next_check_at,checking_until);
