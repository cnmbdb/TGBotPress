CREATE TABLE IF NOT EXISTS t_platform_ets_account_binding (
 admin_id bigint PRIMARY KEY REFERENCES t_admin(id) ON DELETE CASCADE,
 ets_user_id CHAR(36) NOT NULL,
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
