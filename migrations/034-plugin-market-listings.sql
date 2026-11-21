CREATE TABLE IF NOT EXISTS t_platform_plugin_market_listing (
 id bigserial PRIMARY KEY, name varchar(100) NOT NULL, description text NOT NULL,
 npm_package varchar(214) NOT NULL, image_data bytea, image_type varchar(20),
 created_by varchar(100) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
