CREATE TABLE IF NOT EXISTS t_platform_plugin_market_listing (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, name varchar(100) NOT NULL, description text NOT NULL,
 npm_package varchar(214) NOT NULL, image_data LONGBLOB, image_type varchar(20),
 created_by varchar(100) NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
