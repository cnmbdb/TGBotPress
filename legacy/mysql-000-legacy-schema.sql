-- Generated from legacy/000-legacy-schema.sql; do not edit by hand.
-- Fresh-database legacy schema only. Derived from the project schema snapshot; historical rows and DROP statements are intentionally excluded.
-- Applied only when the public schema contains no tables. Existing databases are never replayed.
CREATE TABLE t_admin (
    id BIGINT AUTO_INCREMENT NOT NULL,
    name VARCHAR(30) NOT NULL,
    password VARCHAR(100) NOT NULL,
    head VARCHAR(255) DEFAULT NULL,
    status smallint DEFAULT '1' NOT NULL,
    remember_token VARCHAR(100) DEFAULT NULL,
    created_at DATETIME(6),
    updated_at DATETIME(6),
    white_ip VARCHAR(3000) DEFAULT NULL,
    security_email VARCHAR(254) DEFAULT NULL,
    security_email_verified_at DATETIME(6)
);


CREATE TABLE t_admin_login_log (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    admin_name VARCHAR(100) NOT NULL,
    login_ip VARCHAR(1000) DEFAULT NULL,
    login_time DATETIME(6),
    admin_id bigint,
    login_location VARCHAR(120) DEFAULT '未知',
    public_ip VARCHAR(45),
    device_type VARCHAR(40) DEFAULT '未知',
    user_agent text,
    session_hash VARCHAR(64)
);

CREATE TABLE t_admin_security_settings (
    rid smallint NOT NULL,
    ip_whitelist_enabled boolean DEFAULT false NOT NULL,
    ip_whitelist text DEFAULT '' NOT NULL,
    verification_enabled boolean DEFAULT false NOT NULL,
    verification_method VARCHAR(40) DEFAULT 'captcha' NOT NULL,
    session_lifetime_minutes integer DEFAULT 120 NOT NULL,
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT t_admin_security_settings_pkey PRIMARY KEY (rid),
    CONSTRAINT t_admin_security_settings_singleton CHECK (rid = 1)
);

CREATE TABLE t_admin_device_session (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    admin_id bigint NOT NULL,
    session_hash VARCHAR(64) NOT NULL,
    login_ip VARCHAR(45),
    public_ip VARCHAR(45),
    location VARCHAR(120) DEFAULT '未知',
    device_type VARCHAR(40) DEFAULT '未知',
    user_agent text,
    login_time DATETIME(6) NOT NULL,
    last_seen_at DATETIME(6) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6),
    CONSTRAINT t_admin_device_session_pkey PRIMARY KEY (rid),
    CONSTRAINT t_admin_device_session_session_hash_key UNIQUE (session_hash)
);

CREATE INDEX t_admin_login_log_admin_time_idx ON t_admin_login_log (admin_id, login_time DESC);

CREATE INDEX t_admin_device_session_admin_active_idx ON t_admin_device_session (admin_id, revoked_at, expires_at);


CREATE TABLE t_bind_a_send_n_binding (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid bigint NOT NULL,
    wallet_addr VARCHAR(100) NOT NULL,
    status smallint DEFAULT 0 NOT NULL,
    activate_threshold numeric(14,2) DEFAULT 0,
    activate_time DATETIME(6),
    activated_by integer,
    unbind_time DATETIME(6),
    unbind_by integer,
    unbind_reason VARCHAR(500),
    create_by integer NOT NULL,
    create_time DATETIME(6) NOT NULL,
    update_by integer,
    update_time DATETIME(6)
);


CREATE TABLE t_bind_a_send_n_config (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer,
    is_enable smallint DEFAULT 1 NOT NULL,
    energy_per_send integer DEFAULT 65000 NOT NULL,
    activate_threshold numeric(14,2) DEFAULT 0 NOT NULL,
    daily_limit integer DEFAULT 9999 NOT NULL,
    monthly_limit integer DEFAULT 9999 NOT NULL,
    n_addr_daily_limit integer DEFAULT 9999 NOT NULL,
    audit_threshold numeric(14,2) DEFAULT 0 NOT NULL,
    audit_enabled smallint DEFAULT 0 NOT NULL,
    whitelist text,
    blacklist text,
    retry_count smallint DEFAULT 3 NOT NULL,
    energy_platform_bot_rid integer,
    create_by integer NOT NULL,
    create_time DATETIME(6) NOT NULL,
    update_by integer,
    update_time DATETIME(6)
);


CREATE TABLE t_bind_a_send_n_grant (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    binding_rid integer NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid bigint NOT NULL,
    a_addr VARCHAR(100) NOT NULL,
    n_addr VARCHAR(100) NOT NULL,
    tx_hash VARCHAR(200) NOT NULL,
    energy_amount integer NOT NULL,
    grant_status smallint DEFAULT 0 NOT NULL,
    audit_status smallint DEFAULT 0 NOT NULL,
    retry_count smallint DEFAULT 0 NOT NULL,
    fail_reason VARCHAR(500),
    grant_time DATETIME(6),
    update_time DATETIME(6),
    create_time DATETIME(6)
);


CREATE TABLE t_collection_wallet (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    chain_type VARCHAR(10) DEFAULT 'trc' NOT NULL,
    wallet_addr VARCHAR(200) NOT NULL,
    notice_tg_uid VARCHAR(100) DEFAULT NULL,
    notice_tg_groupid VARCHAR(100) DEFAULT NULL,
    trx_collection_amount numeric(16,6) DEFAULT 0 NOT NULL,
    usdt_collection_amount numeric(16,6) DEFAULT 0 NOT NULL,
    trx_reserved_amount numeric(16,6) DEFAULT 0 NOT NULL,
    usdt_reserved_amount numeric(16,6) DEFAULT 0 NOT NULL,
    status smallint DEFAULT 1 NOT NULL,
    create_time DATETIME(6),
    update_time DATETIME(6),
    wallet_addr_privatekey VARCHAR(2000),
    trx_reserve_amount numeric(16,6) DEFAULT 0 NOT NULL,
    usdt_reserve_amount numeric(16,6) DEFAULT 0 NOT NULL,
    collection_wallet_addr VARCHAR(200),
    permission_id integer DEFAULT 0 NOT NULL,
    tg_notice_obj VARCHAR(500),
    comments VARCHAR(100),
    trx_balance numeric(16,6) DEFAULT 0,
    usdt_balance numeric(16,6) DEFAULT 0
);

CREATE TABLE t_collection_wallet_list (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    wallet_addr VARCHAR(200) NOT NULL,
    collection_wallet_addr VARCHAR(200) NOT NULL,
    coin_name VARCHAR(20) NOT NULL,
    collection_amount numeric(16,6) DEFAULT 0 NOT NULL,
    collection_time DATETIME(6),
    collection_hash VARCHAR(200) DEFAULT NULL,
    create_time DATETIME(6)
);



CREATE TABLE t_energy_ai_bishu (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid VARCHAR(100) NOT NULL,
    wallet_addr VARCHAR(100) NOT NULL,
    status smallint DEFAULT 0 NOT NULL,
    current_bandwidth_quantity bigint DEFAULT 0 NOT NULL,
    current_energy_quantity bigint DEFAULT 0 NOT NULL,
    is_buy CHAR(1) DEFAULT 'N' NOT NULL,
    is_notice CHAR(1) DEFAULT 'N' NOT NULL,
    is_notice_admin CHAR(1) DEFAULT 'N' NOT NULL,
    total_buy_usdt numeric(14,2) DEFAULT 0 NOT NULL,
    max_buy_quantity integer DEFAULT 0 NOT NULL,
    total_buy_quantity integer DEFAULT 0 NOT NULL,
    total_buy_energy_quantity bigint DEFAULT 0 NOT NULL,
    comments VARCHAR(2000) DEFAULT NULL,
    back_comments VARCHAR(2000) DEFAULT NULL,
    create_by integer NOT NULL,
    create_time DATETIME(6) NOT NULL,
    update_by integer,
    update_time DATETIME(6),
    energy_platform_rid integer,
    bishu_stop_day integer DEFAULT 0 NOT NULL,
    is_active CHAR(1) DEFAULT 'N' NOT NULL,
    active_time DATETIME(6),
    last_energy_time DATETIME(6)
);


CREATE TABLE t_energy_ai_trusteeship (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid bigint NOT NULL,
    wallet_addr VARCHAR(100) NOT NULL,
    status smallint DEFAULT '1' NOT NULL,
    current_bandwidth_quantity bigint DEFAULT '0' NOT NULL,
    current_energy_quantity bigint DEFAULT '0' NOT NULL,
    min_energy_quantity integer DEFAULT 32000 NOT NULL,
    per_buy_energy_quantity integer DEFAULT 32000 NOT NULL,
    total_buy_energy_quantity bigint DEFAULT '0' NOT NULL,
    total_used_trx numeric(14,2) DEFAULT 0.00 NOT NULL,
    total_buy_quantity integer DEFAULT 0 NOT NULL,
    is_buy CHAR(1) DEFAULT 'N' NOT NULL,
    is_notice CHAR(1) DEFAULT 'N' NOT NULL,
    is_notice_admin CHAR(1) DEFAULT 'N' NOT NULL,
    last_buy_time DATETIME(6),
    last_used_trx numeric(14,2) DEFAULT NULL,
    comments VARCHAR(2000) DEFAULT NULL,
    back_comments VARCHAR(2000) DEFAULT NULL,
    create_by integer NOT NULL,
    create_time DATETIME(6) NOT NULL,
    update_by integer,
    update_time DATETIME(6),
    max_buy_quantity integer DEFAULT 0 NOT NULL
);


CREATE TABLE t_energy_platform (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    poll_group CHAR(1) NOT NULL,
    platform_name smallint NOT NULL,
    status smallint DEFAULT '1' NOT NULL,
    platform_uid VARCHAR(100) DEFAULT NULL,
    permission_id integer DEFAULT 0 NOT NULL,
    platform_balance numeric(28,6) DEFAULT '0' NOT NULL,
    alert_platform_balance numeric(28,6) DEFAULT '0' NOT NULL,
    platform_apikey VARCHAR(3000) DEFAULT NULL,
    tg_notice_obj VARCHAR(200) DEFAULT NULL,
    tg_notice_bot_rid integer,
    seq_sn integer DEFAULT 0 NOT NULL,
    last_alert_time DATETIME(6),
    comments VARCHAR(3000) DEFAULT NULL,
    create_time DATETIME(6) NOT NULL,
    update_time DATETIME(6)
);

CREATE TABLE t_energy_platform_bot (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    poll_group CHAR(1) NOT NULL,
    tg_admin_uid VARCHAR(500) DEFAULT NULL,
    status smallint DEFAULT '1' NOT NULL,
    receive_wallet VARCHAR(100) DEFAULT NULL,
    get_tx_time DATETIME(6),
    tg_notice_obj_receive VARCHAR(200) DEFAULT NULL,
    tg_notice_obj_send VARCHAR(200) DEFAULT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    is_open_ai_trusteeship CHAR(1) DEFAULT 'N' NOT NULL,
    trx_price_energy_32000 integer,
    trx_price_energy_65000 integer,
    per_energy_day integer,
    create_time DATETIME(6) NOT NULL,
    update_time DATETIME(6),
    agent_tg_uid bigint,
    agent_per_price numeric(18,6),
    bishu_stop_day integer DEFAULT 0 NOT NULL,
    is_open_bishu CHAR(1) DEFAULT 'Y' NOT NULL,
    per_bishu_usdt_price numeric(4,2) DEFAULT 0.50 NOT NULL,
    per_bishu_energy_quantity integer DEFAULT 65000 NOT NULL,
    per_energy_day_bishu integer DEFAULT 1,
    bishu_recovery_type smallint DEFAULT 1 NOT NULL,
    bishu_daili_type smallint DEFAULT 1 NOT NULL,
    ai_trusteeship_recovery_type VARCHAR(20) DEFAULT '1' NOT NULL
);


CREATE TABLE t_energy_platform_order (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    energy_platform_rid integer NOT NULL,
    energy_platform_bot_rid integer NOT NULL,
    platform_name smallint NOT NULL,
    platform_uid VARCHAR(50) NOT NULL,
    source_type smallint DEFAULT '1' NOT NULL,
    receive_address VARCHAR(50) NOT NULL,
    platform_order_id VARCHAR(100) NOT NULL,
    energy_amount integer NOT NULL,
    energy_day smallint NOT NULL,
    energy_time DATETIME(6) NOT NULL,
    recovery_status smallint DEFAULT '1' NOT NULL,
    recovery_time DATETIME(6),
    use_trx numeric(14,6) DEFAULT NULL
);


CREATE TABLE t_energy_platform_package (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    package_type smallint DEFAULT '1' NOT NULL,
    package_name VARCHAR(50) NOT NULL,
    energy_amount integer NOT NULL,
    energy_day smallint NOT NULL,
    trx_price numeric(14,2) DEFAULT 0.00 NOT NULL,
    usdt_price numeric(14,2) DEFAULT 0.00 NOT NULL,
    status smallint DEFAULT '1' NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    create_by integer,
    create_time DATETIME(6),
    update_by integer,
    update_time DATETIME(6),
    callback_data VARCHAR(50) NOT NULL,
    show_notes VARCHAR(1000) DEFAULT NULL,
    package_pic VARCHAR(200) DEFAULT NULL,
    agent_trx_price numeric(14,2) DEFAULT 0.00 NOT NULL
);



CREATE TABLE t_energy_quick_order (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid VARCHAR(100) NOT NULL,
    wallet_addr VARCHAR(100) NOT NULL,
    quick_order_amount bigint DEFAULT 0 NOT NULL,
    quick_order_status smallint DEFAULT 0 NOT NULL,
    create_time DATETIME(6),
    update_time DATETIME(6),
    energy_amount integer DEFAULT 0 NOT NULL,
    energy_day smallint DEFAULT 3 NOT NULL,
    status smallint DEFAULT 0 NOT NULL,
    is_notice CHAR(1) DEFAULT 'N' NOT NULL,
    package_rid integer,
    comments VARCHAR(255) DEFAULT NULL,
    package_name VARCHAR(100),
    pay_price numeric(20,6),
    pay_type VARCHAR(20),
    pay_time DATETIME(6)
);


CREATE TABLE t_energy_special (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer,
    tg_uid bigint,
    wallet_addr VARCHAR(50) NOT NULL,
    wallet_energy bigint DEFAULT 0 NOT NULL,
    max_energy bigint DEFAULT 0 NOT NULL,
    send_energy bigint DEFAULT 0 NOT NULL,
    per_energy integer DEFAULT 0 NOT NULL,
    less_than_energy integer DEFAULT 0 NOT NULL,
    status smallint DEFAULT 0 NOT NULL,
    total_usdt_recharge numeric(14,2) DEFAULT 0 NOT NULL,
    total_trx_recharge numeric(14,2) DEFAULT 0 NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    comments VARCHAR(200) DEFAULT NULL
);

CREATE TABLE t_energy_special_list (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer,
    tg_uid bigint,
    wallet_addr VARCHAR(50) NOT NULL,
    send_wallet_addr VARCHAR(50) NOT NULL,
    before_energy bigint,
    daili_energy integer,
    daili_hash VARCHAR(100) DEFAULT NULL,
    daili_trx numeric(18,6) DEFAULT NULL,
    status smallint DEFAULT 1 NOT NULL,
    daili_time DATETIME(6),
    huishou_time DATETIME(6),
    huishou_hash VARCHAR(100) DEFAULT NULL
);



CREATE TABLE t_energy_third_part (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    order_type smallint NOT NULL,
    tg_uid bigint NOT NULL,
    platform_rid integer NOT NULL,
    bot_rid integer NOT NULL,
    cishu_energy integer NOT NULL,
    wallet_addr VARCHAR(50) NOT NULL,
    before_trx numeric(16,6) NOT NULL,
    change_trx numeric(16,6) NOT NULL,
    after_trx numeric(16,6) NOT NULL,
    order_time DATETIME(6) NOT NULL,
    process_status smallint DEFAULT 0 NOT NULL,
    process_time DATETIME(6),
    process_comments VARCHAR(2000) DEFAULT NULL
);


CREATE TABLE t_energy_wallet_trade_list (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    tx_hash VARCHAR(100) NOT NULL,
    transferfrom_address VARCHAR(200) NOT NULL,
    transferto_address VARCHAR(200) NOT NULL,
    coin_name VARCHAR(20) NOT NULL,
    amount VARCHAR(100) NOT NULL,
    "timestamp" VARCHAR(20) NOT NULL,
    process_status smallint DEFAULT '0' NOT NULL,
    process_time DATETIME(6),
    process_comments VARCHAR(2000) DEFAULT NULL,
    get_time DATETIME(6),
    energy_platform_rid integer,
    energy_platform_bot_rid integer,
    platform_order_rid integer,
    energy_package_rid integer,
    tg_notice_status_receive CHAR(1) DEFAULT 'N' NOT NULL,
    tg_notice_status_send CHAR(1) DEFAULT 'N' NOT NULL
);


CREATE TABLE t_fms_recharge_order (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    recharge_tg_uid VARCHAR(100) NOT NULL,
    recharge_tg_username VARCHAR(100) DEFAULT NULL,
    recharge_coin_name VARCHAR(50) NOT NULL,
    recharge_pay_price numeric(12,4) NOT NULL,
    need_pay_price numeric(12,4) NOT NULL,
    status smallint DEFAULT '0' NOT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    create_time DATETIME(6) NOT NULL,
    update_time DATETIME(6),
    expire_time DATETIME(6) NOT NULL,
    cancel_time DATETIME(6),
    complete_time DATETIME(6),
    tx_hash VARCHAR(100) DEFAULT NULL
);


CREATE TABLE t_fms_wallet_trade_list (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    tx_hash VARCHAR(100) NOT NULL,
    transferfrom_address VARCHAR(200) NOT NULL,
    transferto_address VARCHAR(200) NOT NULL,
    coin_name VARCHAR(20) NOT NULL,
    amount VARCHAR(100) NOT NULL,
    "timestamp" VARCHAR(20) NOT NULL,
    process_status smallint DEFAULT '0' NOT NULL,
    process_time DATETIME(6),
    process_comments VARCHAR(255) DEFAULT NULL,
    get_time DATETIME(6),
    tg_notice_status_receive CHAR(1) DEFAULT 'N' NOT NULL,
    tg_notice_status_send CHAR(1) DEFAULT 'N' NOT NULL,
    recharge_order_rid integer
);


CREATE TABLE t_model_has_permissions (
    permission_id bigint NOT NULL,
    model_type VARCHAR(255) NOT NULL,
    model_id bigint NOT NULL
);

CREATE TABLE t_model_has_roles (
    role_id bigint NOT NULL,
    model_type VARCHAR(255) NOT NULL,
    model_id bigint NOT NULL
);

CREATE TABLE t_monitor_bot (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    status smallint DEFAULT '1' NOT NULL,
    free_monitor_wallet integer DEFAULT 4 NOT NULL,
    price_usdt_5 numeric(16,4) DEFAULT 0.0000 NOT NULL,
    price_usdt_10 numeric(16,4) DEFAULT 0.0000 NOT NULL,
    price_usdt_20 numeric(16,4) DEFAULT 0.0000 NOT NULL,
    price_usdt_50 numeric(16,4) DEFAULT 0.0000 NOT NULL,
    price_usdt_100 numeric(16,4) DEFAULT 0.0000 NOT NULL,
    price_usdt_200 numeric(16,4) DEFAULT 0.0000 NOT NULL,
    comments VARCHAR(3000) DEFAULT NULL,
    create_time DATETIME(6) NOT NULL,
    update_time DATETIME(6)
);


CREATE TABLE t_monitor_wallet (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    chain_type VARCHAR(10) NOT NULL,
    monitor_wallet VARCHAR(200) NOT NULL,
    status smallint DEFAULT '1' NOT NULL,
    bot_rid integer,
    tg_notice_obj VARCHAR(200) DEFAULT NULL,
    balance_alert numeric(14,2) DEFAULT 0.00 NOT NULL,
    balance_amount numeric(14,2) DEFAULT 0.00 NOT NULL,
    comments VARCHAR(100) DEFAULT NULL,
    create_time DATETIME(6),
    update_time DATETIME(6),
    monitor_trx_transaction CHAR(2) DEFAULT 'NN' NOT NULL,
    monitor_approve_transaction CHAR(2) DEFAULT 'NN' NOT NULL,
    monitor_multi_transaction CHAR(2) DEFAULT 'NN' NOT NULL,
    monitor_pledge_transaction CHAR(2) DEFAULT 'NN' NOT NULL,
    monitor_usdt_transaction CHAR(2) DEFAULT 'YY' NOT NULL
);


CREATE TABLE t_permissions (
    id BIGINT AUTO_INCREMENT NOT NULL,
    name VARCHAR(255) NOT NULL,
    guard_name VARCHAR(255) DEFAULT 'web' NOT NULL,
    created_at DATETIME(6),
    updated_at DATETIME(6),
    route VARCHAR(255) DEFAULT NULL,
    pid integer
);


CREATE TABLE t_premium_platform (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    platform_name smallint NOT NULL,
    tg_admin_uid VARCHAR(500) DEFAULT NULL,
    platform_hash VARCHAR(500) DEFAULT NULL,
    platform_cookie VARCHAR(3000) DEFAULT NULL,
    platform_phrase VARCHAR(3000) DEFAULT NULL,
    status smallint DEFAULT '1' NOT NULL,
    receive_wallet VARCHAR(100) DEFAULT NULL,
    get_tx_time DATETIME(6),
    tg_notice_obj_receive VARCHAR(200) DEFAULT NULL,
    tg_notice_obj_send VARCHAR(200) DEFAULT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    create_time DATETIME(6) NOT NULL,
    update_time DATETIME(6)
);

CREATE TABLE t_premium_platform_order (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    premium_platform_rid integer NOT NULL,
    source_type smallint DEFAULT '1' NOT NULL,
    buy_tg_uid VARCHAR(100) NOT NULL,
    buy_tg_username VARCHAR(100) DEFAULT NULL,
    premium_tg_username VARCHAR(100) NOT NULL,
    need_pay_usdt numeric(12,4) NOT NULL,
    status smallint DEFAULT '0' NOT NULL,
    premium_platform_package_rid integer NOT NULL,
    premium_package_month integer NOT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    create_time DATETIME(6) NOT NULL,
    update_time DATETIME(6),
    expire_time DATETIME(6) NOT NULL,
    cancel_time DATETIME(6),
    complete_time DATETIME(6),
    recipient VARCHAR(1000) DEFAULT NULL,
    tx_hash VARCHAR(200) DEFAULT NULL,
    tg_notice_user CHAR(1) DEFAULT 'N' NOT NULL,
    tg_notice_admin CHAR(1) DEFAULT 'N' NOT NULL
);


CREATE TABLE t_premium_platform_package (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    premium_platform_rid integer NOT NULL,
    package_name VARCHAR(50) NOT NULL,
    package_month integer NOT NULL,
    usdt_price numeric(14,2) NOT NULL,
    callback_data VARCHAR(50) NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    status smallint DEFAULT '1' NOT NULL,
    show_notes VARCHAR(1000) DEFAULT NULL,
    package_pic VARCHAR(200) DEFAULT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    create_time DATETIME(6) NOT NULL,
    update_time DATETIME(6)
);



CREATE TABLE t_premium_wallet_trade_list (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    tx_hash VARCHAR(100) NOT NULL,
    transferfrom_address VARCHAR(200) NOT NULL,
    transferto_address VARCHAR(200) NOT NULL,
    coin_name VARCHAR(20) NOT NULL,
    amount VARCHAR(100) NOT NULL,
    "timestamp" VARCHAR(20) NOT NULL,
    process_status smallint DEFAULT '0' NOT NULL,
    process_time DATETIME(6),
    process_comments VARCHAR(255) DEFAULT NULL,
    get_time DATETIME(6),
    tg_notice_status_receive CHAR(1) DEFAULT 'N' NOT NULL,
    tg_notice_status_send CHAR(1) DEFAULT 'N' NOT NULL,
    platform_order_rid integer,
    premium_package_rid integer,
    premium_platform_rid integer
);


CREATE TABLE t_role_has_permissions (
    permission_id bigint NOT NULL,
    role_id bigint NOT NULL
);

CREATE TABLE t_roles (
    id BIGINT AUTO_INCREMENT NOT NULL,
    name VARCHAR(255) NOT NULL,
    guard_name VARCHAR(255) DEFAULT 'web' NOT NULL,
    created_at DATETIME(6),
    updated_at DATETIME(6)
);


CREATE TABLE t_shop_goods (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    goods_name VARCHAR(50) NOT NULL,
    goods_type smallint NOT NULL,
    goods_usdt_price numeric(16,4) DEFAULT 0.0000 NOT NULL,
    goods_trx_price numeric(16,4) DEFAULT 0.0000 NOT NULL,
    show_notes VARCHAR(1000) DEFAULT NULL,
    status smallint DEFAULT '1' NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    comments VARCHAR(3000) DEFAULT NULL,
    create_time DATETIME(6) NOT NULL,
    update_time DATETIME(6)
);

CREATE TABLE t_shop_goods_bot (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    goods_rid integer NOT NULL,
    bot_rid integer NOT NULL,
    goods_usdt_discount numeric(4,2) DEFAULT 1.00 NOT NULL,
    goods_trx_discount numeric(4,2) DEFAULT 1.00 NOT NULL,
    status smallint DEFAULT '1' NOT NULL,
    comments VARCHAR(3000) DEFAULT NULL,
    create_time DATETIME(6) NOT NULL,
    update_time DATETIME(6)
);


CREATE TABLE t_shop_goods_cdkey (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    goods_rid integer NOT NULL,
    cdkey_no VARCHAR(100) NOT NULL,
    cdkey_pwd VARCHAR(2000) NOT NULL,
    cdkey_usdt_price numeric(16,4) DEFAULT 0.0000 NOT NULL,
    cdkey_trx_price numeric(16,4) DEFAULT 0.0000 NOT NULL,
    status smallint DEFAULT '0' NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    create_time DATETIME(6) NOT NULL,
    update_time DATETIME(6)
);



CREATE TABLE t_shop_order (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid VARCHAR(50) NOT NULL,
    tg_username VARCHAR(100) DEFAULT NULL,
    cdkey_no VARCHAR(100) DEFAULT NULL,
    cdkey_pwd VARCHAR(2000) DEFAULT NULL,
    pay_type smallint NOT NULL,
    pay_price VARCHAR(50) DEFAULT NULL,
    comments VARCHAR(3000) DEFAULT NULL,
    pay_time DATETIME(6)
);


CREATE TABLE t_sys_admin_opt_log (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    admin_id integer NOT NULL,
    opt_module VARCHAR(200) DEFAULT NULL,
    opt_ref_sn VARCHAR(100) DEFAULT NULL,
    opt_time DATETIME(6),
    opt_content text
);


CREATE TABLE t_sys_config (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    config_key VARCHAR(50) NOT NULL,
    config_val VARCHAR(500) NOT NULL,
    comments VARCHAR(255) NOT NULL,
    create_by VARCHAR(50) DEFAULT NULL,
    create_time DATETIME(6),
    update_by VARCHAR(50) DEFAULT NULL,
    update_time DATETIME(6)
);


CREATE TABLE t_sys_data_dictionary (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    dic_key VARCHAR(100) NOT NULL,
    dic_value VARCHAR(500) NOT NULL,
    dic_name VARCHAR(200) DEFAULT NULL,
    create_time DATETIME(6),
    update_time DATETIME(6)
);


CREATE TABLE t_telegram_bot (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_token VARCHAR(100) NOT NULL,
    bot_admin_username VARCHAR(100) DEFAULT '-',
    bot_firstname VARCHAR(100) DEFAULT NULL,
    bot_username VARCHAR(100) DEFAULT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    create_by integer,
    create_time DATETIME(6),
    update_by integer,
    update_time DATETIME(6),
    recharge_wallet_addr VARCHAR(100) DEFAULT NULL,
    get_tx_time DATETIME(6),
    last_update_id bigint DEFAULT 0
);

CREATE TABLE t_telegram_bot_ad (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    notice_cycle smallint DEFAULT '1' NOT NULL,
    notice_obj VARCHAR(200) NOT NULL,
    notice_photo VARCHAR(500) DEFAULT NULL,
    notice_ad VARCHAR(2000) NOT NULL,
    status smallint DEFAULT '1' NOT NULL,
    last_notice_time DATETIME(6),
    create_by integer,
    create_time DATETIME(6),
    update_by integer,
    update_time DATETIME(6)
);

CREATE TABLE t_telegram_bot_ad_keyboard (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    ad_rid integer NOT NULL,
    keyboard_rid integer NOT NULL,
    create_by integer,
    create_time DATETIME(6),
    update_by integer,
    update_time DATETIME(6)
);



CREATE TABLE t_telegram_bot_command (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    command VARCHAR(50) NOT NULL,
    description VARCHAR(100) NOT NULL,
    command_type smallint DEFAULT '1' NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    create_by integer,
    create_time DATETIME(6),
    update_by integer,
    update_time DATETIME(6)
);


CREATE TABLE t_telegram_bot_group (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    group_type VARCHAR(50) NOT NULL,
    tg_groupid bigint NOT NULL,
    tg_groupusername VARCHAR(200) DEFAULT NULL,
    tg_groupnickname VARCHAR(200) DEFAULT NULL,
    status smallint DEFAULT 1 NOT NULL,
    is_admin VARCHAR(1) DEFAULT 'N',
    first_time DATETIME(6),
    last_time DATETIME(6),
    stop_time DATETIME(6),
    follow_count integer DEFAULT 0
);


CREATE TABLE t_telegram_bot_keyboard (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    keyboard_type smallint DEFAULT '1' NOT NULL,
    keyboard_name VARCHAR(20) NOT NULL,
    keyboard_icon_custom_emoji_id VARCHAR(64),
    inline_type smallint DEFAULT '0' NOT NULL,
    keyboard_value VARCHAR(500) NOT NULL,
    status smallint DEFAULT '0' NOT NULL,
    create_by integer,
    create_time DATETIME(6),
    update_by integer,
    update_time DATETIME(6),
    seq_sn integer DEFAULT 0 NOT NULL
);


CREATE TABLE t_telegram_bot_keyreply (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    key_type smallint NOT NULL,
    monitor_word VARCHAR(500) NOT NULL,
    reply_photo VARCHAR(300) DEFAULT NULL,
    reply_content VARCHAR(2000) NOT NULL,
    opt_type integer NOT NULL,
    status smallint DEFAULT '0' NOT NULL,
    create_by integer,
    create_time DATETIME(6),
    update_by integer,
    update_time DATETIME(6)
);

CREATE TABLE t_telegram_bot_keyreply_keyboard (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    keyreply_rid integer NOT NULL,
    keyboard_rid integer NOT NULL,
    create_by integer,
    create_time DATETIME(6),
    update_by integer,
    update_time DATETIME(6)
);




CREATE TABLE t_telegram_bot_user (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid bigint NOT NULL,
    tg_username VARCHAR(200) DEFAULT NULL,
    tg_nickname VARCHAR(200) DEFAULT NULL,
    status smallint DEFAULT 1 NOT NULL,
    bind_trc_wallet_addr VARCHAR(200) DEFAULT NULL,
    first_time DATETIME(6),
    last_time DATETIME(6),
    stop_time DATETIME(6),
    cash_trx numeric(20,6) DEFAULT 0 NOT NULL,
    cash_usdt numeric(20,6) DEFAULT 0 NOT NULL,
    max_monitor_wallet integer DEFAULT 0 NOT NULL
);


CREATE TABLE t_transit_user_wallet (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    chain_type VARCHAR(10) NOT NULL,
    wallet_addr VARCHAR(200) NOT NULL,
    total_transit_usdt VARCHAR(200) DEFAULT '0' NOT NULL,
    total_transit_sxf VARCHAR(200) DEFAULT '0' NOT NULL,
    total_yuzhi_sxf VARCHAR(200) DEFAULT '0' NOT NULL,
    need_feedback_sxf VARCHAR(200) DEFAULT '0' NOT NULL,
    send_feedback_sxf VARCHAR(200) DEFAULT '0' NOT NULL,
    last_transit_time DATETIME(6),
    last_yuzhi_time DATETIME(6)
);


CREATE TABLE t_transit_wallet (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    chain_type VARCHAR(10) NOT NULL,
    receive_wallet VARCHAR(200) NOT NULL,
    send_wallet VARCHAR(200) NOT NULL,
    send_wallet_privatekey VARCHAR(2000) DEFAULT NULL,
    show_notes VARCHAR(500) DEFAULT NULL,
    status smallint DEFAULT '1' NOT NULL,
    tg_notice_obj_receive VARCHAR(200) DEFAULT NULL,
    tg_notice_obj_send VARCHAR(200) DEFAULT NULL,
    get_tx_time DATETIME(6),
    create_time DATETIME(6),
    update_time DATETIME(6),
    bot_rid integer,
    auto_stock_min_trx integer DEFAULT 0 NOT NULL,
    auto_stock_per_usdt integer DEFAULT 0 NOT NULL
);

CREATE TABLE t_transit_wallet_black (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    chain_type VARCHAR(10) NOT NULL,
    black_wallet VARCHAR(200) NOT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    create_time DATETIME(6),
    update_time DATETIME(6)
);


CREATE TABLE t_transit_wallet_coin (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    transit_wallet_id integer NOT NULL,
    in_coin_name VARCHAR(20) NOT NULL,
    out_coin_name VARCHAR(20) NOT NULL,
    is_realtime_rate smallint DEFAULT '1' NOT NULL,
    profit_rate numeric(4,2) DEFAULT 1.00 NOT NULL,
    exchange_rate numeric(8,2) DEFAULT 0.00 NOT NULL,
    kou_out_amount numeric(8,2) DEFAULT 0.00 NOT NULL,
    min_transit_amount integer NOT NULL,
    max_transit_amount integer NOT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    create_by integer,
    create_time DATETIME(6),
    update_by integer,
    update_time DATETIME(6)
);



CREATE TABLE t_transit_wallet_trade_list (
    rid BIGINT AUTO_INCREMENT NOT NULL,
    tx_hash VARCHAR(100) NOT NULL,
    transferfrom_address VARCHAR(200) NOT NULL,
    transferto_address VARCHAR(200) NOT NULL,
    coin_name VARCHAR(20) NOT NULL,
    amount VARCHAR(100) NOT NULL,
    "timestamp" VARCHAR(20) NOT NULL,
    process_status smallint DEFAULT '0' NOT NULL,
    process_time DATETIME(6),
    process_comments VARCHAR(255) DEFAULT NULL,
    get_time DATETIME(6),
    sendback_address VARCHAR(200) DEFAULT NULL,
    sendback_amount VARCHAR(100) DEFAULT '0' NOT NULL,
    sendback_time DATETIME(6),
    sendback_coin_name VARCHAR(20) DEFAULT NULL,
    sendback_tx_hash VARCHAR(100) DEFAULT NULL,
    sendback_contract_ret VARCHAR(20) DEFAULT NULL,
    tg_notice_status_receive CHAR(1) DEFAULT 'N' NOT NULL,
    tg_notice_status_send CHAR(1) DEFAULT 'N' NOT NULL,
    current_exchange_rate numeric(8,2) DEFAULT 0.00 NOT NULL,
    current_huan_yuzhi_amount numeric(14,2) DEFAULT 0.00 NOT NULL
);



















































ALTER TABLE t_admin_login_log
    ADD CONSTRAINT t_admin_login_log_pkey PRIMARY KEY (rid);

ALTER TABLE t_admin
    ADD CONSTRAINT t_admin_pkey PRIMARY KEY (id);

ALTER TABLE t_bind_a_send_n_binding
    ADD CONSTRAINT t_bind_a_send_n_binding_pkey PRIMARY KEY (rid);

ALTER TABLE t_bind_a_send_n_config
    ADD CONSTRAINT t_bind_a_send_n_config_pkey PRIMARY KEY (rid);

ALTER TABLE t_bind_a_send_n_grant
    ADD CONSTRAINT t_bind_a_send_n_grant_pkey PRIMARY KEY (rid);

ALTER TABLE t_collection_wallet_list
    ADD CONSTRAINT t_collection_wallet_list_pkey PRIMARY KEY (rid);

ALTER TABLE t_collection_wallet
    ADD CONSTRAINT t_collection_wallet_pkey PRIMARY KEY (rid);

ALTER TABLE t_energy_ai_bishu
    ADD CONSTRAINT t_energy_ai_bishu_pkey PRIMARY KEY (rid);

ALTER TABLE t_energy_ai_trusteeship
    ADD CONSTRAINT t_energy_ai_trusteeship_pkey PRIMARY KEY (rid);

ALTER TABLE t_energy_platform_bot
    ADD CONSTRAINT t_energy_platform_bot_pkey PRIMARY KEY (rid);

ALTER TABLE t_energy_platform_order
    ADD CONSTRAINT t_energy_platform_order_pkey PRIMARY KEY (rid);

ALTER TABLE t_energy_platform_package
    ADD CONSTRAINT t_energy_platform_package_pkey PRIMARY KEY (rid);

ALTER TABLE t_energy_platform
    ADD CONSTRAINT t_energy_platform_pkey PRIMARY KEY (rid);

ALTER TABLE t_energy_quick_order
    ADD CONSTRAINT t_energy_quick_order_pkey PRIMARY KEY (rid);

ALTER TABLE t_energy_special_list
    ADD CONSTRAINT t_energy_special_list_pkey PRIMARY KEY (rid);

ALTER TABLE t_energy_special
    ADD CONSTRAINT t_energy_special_pkey PRIMARY KEY (rid);

ALTER TABLE t_energy_third_part
    ADD CONSTRAINT t_energy_third_part_pkey PRIMARY KEY (rid);

ALTER TABLE t_energy_wallet_trade_list
    ADD CONSTRAINT t_energy_wallet_trade_list_pkey PRIMARY KEY (rid);

ALTER TABLE t_fms_recharge_order
    ADD CONSTRAINT t_fms_recharge_order_pkey PRIMARY KEY (rid);

ALTER TABLE t_fms_wallet_trade_list
    ADD CONSTRAINT t_fms_wallet_trade_list_pkey PRIMARY KEY (rid);

ALTER TABLE t_model_has_permissions
    ADD CONSTRAINT t_model_has_permissions_pkey PRIMARY KEY (permission_id, model_id, model_type);

ALTER TABLE t_model_has_roles
    ADD CONSTRAINT t_model_has_roles_pkey PRIMARY KEY (role_id, model_id, model_type);

ALTER TABLE t_monitor_bot
    ADD CONSTRAINT t_monitor_bot_pkey PRIMARY KEY (rid);

ALTER TABLE t_monitor_wallet
    ADD CONSTRAINT t_monitor_wallet_pkey PRIMARY KEY (rid);

ALTER TABLE t_permissions
    ADD CONSTRAINT t_permissions_name_guard_name_key UNIQUE (name, guard_name);

ALTER TABLE t_permissions
    ADD CONSTRAINT t_permissions_pkey PRIMARY KEY (id);

ALTER TABLE t_premium_platform_order
    ADD CONSTRAINT t_premium_platform_order_pkey PRIMARY KEY (rid);

ALTER TABLE t_premium_platform_package
    ADD CONSTRAINT t_premium_platform_package_pkey PRIMARY KEY (rid);

ALTER TABLE t_premium_platform
    ADD CONSTRAINT t_premium_platform_pkey PRIMARY KEY (rid);

ALTER TABLE t_premium_wallet_trade_list
    ADD CONSTRAINT t_premium_wallet_trade_list_pkey PRIMARY KEY (rid);

ALTER TABLE t_role_has_permissions
    ADD CONSTRAINT t_role_has_permissions_pkey PRIMARY KEY (permission_id, role_id);

ALTER TABLE t_roles
    ADD CONSTRAINT t_roles_name_guard_name_key UNIQUE (name, guard_name);

ALTER TABLE t_roles
    ADD CONSTRAINT t_roles_pkey PRIMARY KEY (id);

ALTER TABLE t_shop_goods_bot
    ADD CONSTRAINT t_shop_goods_bot_pkey PRIMARY KEY (rid);

ALTER TABLE t_shop_goods_cdkey
    ADD CONSTRAINT t_shop_goods_cdkey_pkey PRIMARY KEY (rid);

ALTER TABLE t_shop_goods
    ADD CONSTRAINT t_shop_goods_pkey PRIMARY KEY (rid);

ALTER TABLE t_shop_order
    ADD CONSTRAINT t_shop_order_pkey PRIMARY KEY (rid);

ALTER TABLE t_sys_admin_opt_log
    ADD CONSTRAINT t_sys_admin_opt_log_pkey PRIMARY KEY (rid);

ALTER TABLE t_sys_config
    ADD CONSTRAINT t_sys_config_pkey PRIMARY KEY (rid);

ALTER TABLE t_sys_data_dictionary
    ADD CONSTRAINT t_sys_data_dictionary_pkey PRIMARY KEY (rid);

ALTER TABLE t_telegram_bot_ad_keyboard
    ADD CONSTRAINT t_telegram_bot_ad_keyboard_pkey PRIMARY KEY (rid);

ALTER TABLE t_telegram_bot_ad
    ADD CONSTRAINT t_telegram_bot_ad_pkey PRIMARY KEY (rid);

ALTER TABLE t_telegram_bot_command
    ADD CONSTRAINT t_telegram_bot_command_pkey PRIMARY KEY (rid);

ALTER TABLE t_telegram_bot_group
    ADD CONSTRAINT t_telegram_bot_group_pkey PRIMARY KEY (rid);

ALTER TABLE t_telegram_bot_keyboard
    ADD CONSTRAINT t_telegram_bot_keyboard_pkey PRIMARY KEY (rid);

ALTER TABLE t_telegram_bot_keyreply_keyboard
    ADD CONSTRAINT t_telegram_bot_keyreply_keyboard_pkey PRIMARY KEY (rid);

ALTER TABLE t_telegram_bot_keyreply
    ADD CONSTRAINT t_telegram_bot_keyreply_pkey PRIMARY KEY (rid);

ALTER TABLE t_telegram_bot
    ADD CONSTRAINT t_telegram_bot_pkey PRIMARY KEY (rid);

ALTER TABLE t_telegram_bot_user
    ADD CONSTRAINT t_telegram_bot_user_pkey PRIMARY KEY (rid);

ALTER TABLE t_transit_user_wallet
    ADD CONSTRAINT t_transit_user_wallet_pkey PRIMARY KEY (rid);

ALTER TABLE t_transit_wallet_black
    ADD CONSTRAINT t_transit_wallet_black_pkey PRIMARY KEY (rid);

ALTER TABLE t_transit_wallet_coin
    ADD CONSTRAINT t_transit_wallet_coin_pkey PRIMARY KEY (rid);

ALTER TABLE t_transit_wallet
    ADD CONSTRAINT t_transit_wallet_pkey PRIMARY KEY (rid);

ALTER TABLE t_transit_wallet_trade_list
    ADD CONSTRAINT t_transit_wallet_trade_list_pkey PRIMARY KEY (rid);

CREATE INDEX idx_energy_third_part_1 ON t_energy_third_part (tg_uid);

CREATE UNIQUE INDEX t_energy_wallet_trade_list_tx_hash_uindex ON t_energy_wallet_trade_list (tx_hash);

CREATE INDEX idx_energy_ai_bishu_is_active ON t_energy_ai_bishu (is_active);

CREATE INDEX idx_energy_ai_bishu_last_energy ON t_energy_ai_bishu (last_energy_time);

CREATE TABLE t_telegram_bot_moderation_config (
    bot_rid integer PRIMARY KEY,
    support_enabled boolean NOT NULL DEFAULT false,
    support_chat_id bigint,
    support_captcha_enabled boolean NOT NULL DEFAULT true,
    support_verified_minutes integer NOT NULL DEFAULT 1440,
    ad_score_threshold smallint NOT NULL DEFAULT 4,
    ad_keywords text,
    create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE t_telegram_bot_group_policy (
    rid BIGINT AUTO_INCREMENT PRIMARY KEY,
    bot_rid integer NOT NULL,
    tg_groupid bigint NOT NULL,
    join_captcha_enabled boolean NOT NULL DEFAULT false,
    group_moderation_enabled boolean NOT NULL DEFAULT false,
    block_forwarded_messages boolean NOT NULL DEFAULT false,
    no_avatar_captcha_enabled boolean NOT NULL DEFAULT false,
    no_username_captcha_enabled boolean NOT NULL DEFAULT false,
    new_account_captcha_enabled boolean NOT NULL DEFAULT false,
    new_account_max_age_seconds integer NOT NULL DEFAULT 86400,
    ad_keywords text,
    ad_keywords_auto_upload boolean NOT NULL DEFAULT true,
    ad_keywords_auto_sync boolean NOT NULL DEFAULT true,
    ad_action VARCHAR(20) NOT NULL DEFAULT 'verify',
    ad_restrict_duration_seconds integer NOT NULL DEFAULT 3600,
    verification_timeout_seconds integer NOT NULL DEFAULT 180,
    ad_verification_timeout_seconds integer NOT NULL DEFAULT 1800,
    rate_limit_count smallint NOT NULL DEFAULT 6,
    rate_limit_window_seconds smallint NOT NULL DEFAULT 10,
    create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT t_telegram_bot_group_policy_bot_group_unique UNIQUE (bot_rid, tg_groupid)
);

CREATE TABLE t_telegram_group_message_history (
    rid BIGINT AUTO_INCREMENT PRIMARY KEY,
    bot_rid integer NOT NULL,
    chat_id bigint NOT NULL,
    message_id bigint NOT NULL,
    user_id bigint,
    message_date DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    message_text text,
    message_json jsonb NOT NULL,
    create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT t_telegram_group_message_history_unique UNIQUE (bot_rid, chat_id, message_id)
);

CREATE INDEX idx_telegram_group_message_history_recent
    ON t_telegram_group_message_history (bot_rid, chat_id, message_date DESC);

CREATE TABLE t_telegram_moderated_member (
    rid BIGINT AUTO_INCREMENT PRIMARY KEY,
    bot_rid integer NOT NULL,
    chat_id bigint NOT NULL,
    user_id bigint NOT NULL,
    action VARCHAR(30) NOT NULL,
    restricted_until DATETIME(6),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT t_telegram_moderated_member_bot_chat_user_unique UNIQUE (bot_rid, chat_id, user_id)
);

CREATE INDEX idx_telegram_moderated_member_active
    ON t_telegram_moderated_member (status, restricted_until, update_time DESC);

CREATE TABLE t_telegram_verification (
    rid BIGINT AUTO_INCREMENT PRIMARY KEY,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    verification_type VARCHAR(30) NOT NULL,
    bot_rid integer NOT NULL,
    chat_id bigint,
    user_id bigint NOT NULL,
    user_chat_id bigint,
    verification_message_id bigint,
    mini_app_message_id bigint,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    expires_at DATETIME(6) NOT NULL,
    verified_at DATETIME(6),
    create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE t_telegram_support_message (
    rid BIGINT AUTO_INCREMENT PRIMARY KEY,
    bot_rid integer NOT NULL,
    user_id bigint NOT NULL,
    support_chat_id bigint NOT NULL,
    user_message_id bigint,
    support_message_id bigint,
    direction VARCHAR(20) NOT NULL,
    is_ad boolean NOT NULL DEFAULT false,
    create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE t_telegram_moderation_log (
    rid BIGINT AUTO_INCREMENT PRIMARY KEY,
    bot_rid integer NOT NULL,
    chat_id bigint,
    user_id bigint,
    message_id bigint,
    event_type VARCHAR(40) NOT NULL,
    action VARCHAR(30) NOT NULL,
    score smallint NOT NULL DEFAULT 0,
    reasons text,
    content_preview VARCHAR(500),
    create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_telegram_verification_lookup ON t_telegram_verification (bot_rid, user_id, verification_type, status);

CREATE INDEX idx_telegram_verification_expiry ON t_telegram_verification (status, expires_at);

CREATE INDEX idx_telegram_support_reply ON t_telegram_support_message (bot_rid, support_chat_id, support_message_id);

CREATE INDEX idx_telegram_moderation_log_recent ON t_telegram_moderation_log (bot_rid, create_time DESC);

CREATE TABLE t_telegram_clone_proxy_config (
    rid BIGINT AUTO_INCREMENT PRIMARY KEY,
    master_bot_rid integer NOT NULL,
    is_enable smallint NOT NULL DEFAULT 0,
    charge_enable smallint NOT NULL DEFAULT 0,
    merchant_limit integer NOT NULL DEFAULT 0,
    open_price numeric(20,6) NOT NULL DEFAULT 0,
    default_revenue_ratio numeric(7,2) NOT NULL DEFAULT 0,
    create_time DATETIME(6),
    update_time DATETIME(6)
);

CREATE TABLE t_telegram_clone_proxy_merchant (
    rid BIGINT AUTO_INCREMENT PRIMARY KEY,
    master_bot_rid integer NOT NULL,
    bot_rid integer NOT NULL,
    owner_tg_uid bigint NOT NULL,
    owner_tg_username VARCHAR(200) NOT NULL,
    owner_tg_name VARCHAR(200) DEFAULT NULL,
    bot_token_hash VARCHAR(64) NOT NULL,
    revenue_ratio numeric(7,2) NOT NULL DEFAULT 0,
    status smallint NOT NULL DEFAULT 1,
    total_revenue_usdt numeric(20,6) NOT NULL DEFAULT 0,
    total_revenue_trx numeric(20,6) NOT NULL DEFAULT 0,
    webhook_status smallint NOT NULL DEFAULT 0,
    webhook_error VARCHAR(500) DEFAULT NULL,
    create_time DATETIME(6),
    update_time DATETIME(6)
);

CREATE TABLE t_telegram_clone_proxy_order (
    rid BIGINT AUTO_INCREMENT PRIMARY KEY,
    merchant_rid bigint,
    master_bot_rid integer NOT NULL,
    bot_rid integer,
    order_type VARCHAR(30) NOT NULL,
    source_type VARCHAR(30) NOT NULL DEFAULT 'manual',
    source_order_rid bigint,
    pay_user_tg_uid bigint NOT NULL,
    pay_user_tg_username VARCHAR(200) DEFAULT NULL,
    amount numeric(20,6) NOT NULL DEFAULT 0,
    need_pay_amount numeric(20,6) NOT NULL DEFAULT 0,
    coin_name VARCHAR(20) NOT NULL DEFAULT 'usdt',
    payment_method VARCHAR(20) NOT NULL DEFAULT 'free',
    status smallint NOT NULL DEFAULT 0,
    revenue_ratio numeric(7,2) NOT NULL DEFAULT 0,
    revenue_amount numeric(20,6) NOT NULL DEFAULT 0,
    external_order_rid bigint,
    tx_hash VARCHAR(200) DEFAULT NULL,
    comments VARCHAR(1000) DEFAULT NULL,
    create_time DATETIME(6),
    update_time DATETIME(6),
    paid_time DATETIME(6),
    expire_time DATETIME(6),
    complete_time DATETIME(6)
);

CREATE UNIQUE INDEX uq_telegram_clone_proxy_config_master
    ON t_telegram_clone_proxy_config (master_bot_rid);

CREATE UNIQUE INDEX uq_telegram_clone_proxy_merchant_bot
    ON t_telegram_clone_proxy_merchant (bot_rid);

CREATE UNIQUE INDEX uq_telegram_clone_proxy_merchant_owner
    ON t_telegram_clone_proxy_merchant (master_bot_rid, owner_tg_uid);

CREATE UNIQUE INDEX uq_telegram_clone_proxy_merchant_token
    ON t_telegram_clone_proxy_merchant (bot_token_hash);

CREATE UNIQUE INDEX uq_telegram_clone_proxy_source_order
    ON t_telegram_clone_proxy_order (source_type, source_order_rid);

ALTER TABLE t_telegram_clone_proxy_order
  ADD COLUMN active_opening_master_bot_rid INT GENERATED ALWAYS AS (CASE WHEN order_type='opening' AND status IN (0,1) THEN master_bot_rid ELSE NULL END) STORED,
  ADD COLUMN active_opening_pay_user_tg_uid BIGINT GENERATED ALWAYS AS (CASE WHEN order_type='opening' AND status IN (0,1) THEN pay_user_tg_uid ELSE NULL END) STORED;
CREATE UNIQUE INDEX uq_telegram_clone_proxy_opening_pending_user ON t_telegram_clone_proxy_order (active_opening_master_bot_rid, active_opening_pay_user_tg_uid);

CREATE INDEX idx_telegram_clone_proxy_merchant_status
    ON t_telegram_clone_proxy_merchant (master_bot_rid, status, create_time DESC);

CREATE INDEX idx_telegram_clone_proxy_order_merchant_type
    ON t_telegram_clone_proxy_order (merchant_rid, order_type, status, create_time DESC);

CREATE INDEX idx_telegram_clone_proxy_order_opening_user
    ON t_telegram_clone_proxy_order (master_bot_rid, pay_user_tg_uid, order_type, status);
