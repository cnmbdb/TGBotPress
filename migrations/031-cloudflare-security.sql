CREATE TABLE IF NOT EXISTS t_platform_cloudflare_security (rid integer PRIMARY KEY DEFAULT 1 CHECK (rid=1), config_ciphertext text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
