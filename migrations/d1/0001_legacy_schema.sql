CREATE TABLE t_admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(30) NOT NULL,
    password VARCHAR(100) NOT NULL,
    head VARCHAR(255) DEFAULT NULL,
    status smallint DEFAULT '1' NOT NULL,
    remember_token VARCHAR(100) DEFAULT NULL,
    created_at TEXT,
    updated_at TEXT,
    white_ip VARCHAR(3000) DEFAULT NULL,
    security_email VARCHAR(254) DEFAULT NULL,
    security_email_verified_at TEXT
);


CREATE TABLE t_admin_login_log (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_name VARCHAR(100) NOT NULL,
    login_ip VARCHAR(1000) DEFAULT NULL,
    login_time TEXT,
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
    ip_whitelist text DEFAULT ('') NOT NULL,
    verification_enabled boolean DEFAULT false NOT NULL,
    verification_method VARCHAR(40) DEFAULT 'captcha' NOT NULL,
    session_lifetime_minutes integer DEFAULT 120 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT t_admin_security_settings_pkey PRIMARY KEY (rid),
    CONSTRAINT t_admin_security_settings_singleton CHECK (rid = 1)
);

CREATE TABLE t_admin_device_session (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id bigint NOT NULL,
    session_hash VARCHAR(64) NOT NULL,
    login_ip VARCHAR(45),
    public_ip VARCHAR(45),
    location VARCHAR(120) DEFAULT '未知',
    device_type VARCHAR(40) DEFAULT '未知',
    user_agent text,
    login_time TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    CONSTRAINT t_admin_device_session_session_hash_key UNIQUE (session_hash)
);

CREATE INDEX t_admin_login_log_admin_time_idx ON t_admin_login_log (admin_id, login_time DESC);

CREATE INDEX t_admin_device_session_admin_active_idx ON t_admin_device_session (admin_id, revoked_at, expires_at);


CREATE TABLE t_bind_a_send_n_binding (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    tg_uid bigint NOT NULL,
    wallet_addr VARCHAR(100) NOT NULL,
    status smallint DEFAULT 0 NOT NULL,
    activate_threshold numeric(14,2) DEFAULT 0,
    activate_time TEXT,
    activated_by integer,
    unbind_time TEXT,
    unbind_by integer,
    unbind_reason VARCHAR(500),
    create_by integer NOT NULL,
    create_time TEXT NOT NULL,
    update_by integer,
    update_time TEXT
);


CREATE TABLE t_bind_a_send_n_config (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    create_time TEXT NOT NULL,
    update_by integer,
    update_time TEXT
);


CREATE TABLE t_bind_a_send_n_grant (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    grant_time TEXT,
    update_time TEXT,
    create_time TEXT
);


CREATE TABLE t_collection_wallet (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    create_time TEXT,
    update_time TEXT,
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
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_addr VARCHAR(200) NOT NULL,
    collection_wallet_addr VARCHAR(200) NOT NULL,
    coin_name VARCHAR(20) NOT NULL,
    collection_amount numeric(16,6) DEFAULT 0 NOT NULL,
    collection_time TEXT,
    collection_hash VARCHAR(200) DEFAULT NULL,
    create_time TEXT
);



CREATE TABLE t_energy_ai_bishu (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    create_time TEXT NOT NULL,
    update_by integer,
    update_time TEXT,
    energy_platform_rid integer,
    bishu_stop_day integer DEFAULT 0 NOT NULL,
    is_active CHAR(1) DEFAULT 'N' NOT NULL,
    active_time TEXT,
    last_energy_time TEXT
);


CREATE TABLE t_energy_ai_trusteeship (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    last_buy_time TEXT,
    last_used_trx numeric(14,2) DEFAULT NULL,
    comments VARCHAR(2000) DEFAULT NULL,
    back_comments VARCHAR(2000) DEFAULT NULL,
    create_by integer NOT NULL,
    create_time TEXT NOT NULL,
    update_by integer,
    update_time TEXT,
    max_buy_quantity integer DEFAULT 0 NOT NULL
);


CREATE TABLE t_energy_platform (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    last_alert_time TEXT,
    comments VARCHAR(3000) DEFAULT NULL,
    create_time TEXT NOT NULL,
    update_time TEXT
);

CREATE TABLE t_energy_platform_bot (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    poll_group CHAR(1) NOT NULL,
    tg_admin_uid VARCHAR(500) DEFAULT NULL,
    status smallint DEFAULT '1' NOT NULL,
    receive_wallet VARCHAR(100) DEFAULT NULL,
    get_tx_time TEXT,
    tg_notice_obj_receive VARCHAR(200) DEFAULT NULL,
    tg_notice_obj_send VARCHAR(200) DEFAULT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    is_open_ai_trusteeship CHAR(1) DEFAULT 'N' NOT NULL,
    trx_price_energy_32000 integer,
    trx_price_energy_65000 integer,
    per_energy_day integer,
    create_time TEXT NOT NULL,
    update_time TEXT,
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
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    energy_platform_rid integer NOT NULL,
    energy_platform_bot_rid integer NOT NULL,
    platform_name smallint NOT NULL,
    platform_uid VARCHAR(50) NOT NULL,
    source_type smallint DEFAULT '1' NOT NULL,
    receive_address VARCHAR(50) NOT NULL,
    platform_order_id VARCHAR(100) NOT NULL,
    energy_amount integer NOT NULL,
    energy_day smallint NOT NULL,
    energy_time TEXT NOT NULL,
    recovery_status smallint DEFAULT '1' NOT NULL,
    recovery_time TEXT,
    use_trx numeric(14,6) DEFAULT NULL
);


CREATE TABLE t_energy_platform_package (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    create_time TEXT,
    update_by integer,
    update_time TEXT,
    callback_data VARCHAR(50) NOT NULL,
    show_notes VARCHAR(1000) DEFAULT NULL,
    package_pic VARCHAR(200) DEFAULT NULL,
    agent_trx_price numeric(14,2) DEFAULT 0.00 NOT NULL
);



CREATE TABLE t_energy_quick_order (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    tg_uid VARCHAR(100) NOT NULL,
    wallet_addr VARCHAR(100) NOT NULL,
    quick_order_amount bigint DEFAULT 0 NOT NULL,
    quick_order_status smallint DEFAULT 0 NOT NULL,
    create_time TEXT,
    update_time TEXT,
    energy_amount integer DEFAULT 0 NOT NULL,
    energy_day smallint DEFAULT 3 NOT NULL,
    status smallint DEFAULT 0 NOT NULL,
    is_notice CHAR(1) DEFAULT 'N' NOT NULL,
    package_rid integer,
    comments VARCHAR(255) DEFAULT NULL,
    package_name VARCHAR(100),
    pay_price numeric(20,6),
    pay_type VARCHAR(20),
    pay_time TEXT
);


CREATE TABLE t_energy_special (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer,
    tg_uid bigint,
    wallet_addr VARCHAR(50) NOT NULL,
    send_wallet_addr VARCHAR(50) NOT NULL,
    before_energy bigint,
    daili_energy integer,
    daili_hash VARCHAR(100) DEFAULT NULL,
    daili_trx numeric(18,6) DEFAULT NULL,
    status smallint DEFAULT 1 NOT NULL,
    daili_time TEXT,
    huishou_time TEXT,
    huishou_hash VARCHAR(100) DEFAULT NULL
);



CREATE TABLE t_energy_third_part (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    order_type smallint NOT NULL,
    tg_uid bigint NOT NULL,
    platform_rid integer NOT NULL,
    bot_rid integer NOT NULL,
    cishu_energy integer NOT NULL,
    wallet_addr VARCHAR(50) NOT NULL,
    before_trx numeric(16,6) NOT NULL,
    change_trx numeric(16,6) NOT NULL,
    after_trx numeric(16,6) NOT NULL,
    order_time TEXT NOT NULL,
    process_status smallint DEFAULT 0 NOT NULL,
    process_time TEXT,
    process_comments VARCHAR(2000) DEFAULT NULL
);


CREATE TABLE t_energy_wallet_trade_list (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash VARCHAR(100) NOT NULL,
    transferfrom_address VARCHAR(200) NOT NULL,
    transferto_address VARCHAR(200) NOT NULL,
    coin_name VARCHAR(20) NOT NULL,
    amount VARCHAR(100) NOT NULL,
    `timestamp` VARCHAR(20) NOT NULL,
    process_status smallint DEFAULT '0' NOT NULL,
    process_time TEXT,
    process_comments VARCHAR(2000) DEFAULT NULL,
    get_time TEXT,
    energy_platform_rid integer,
    energy_platform_bot_rid integer,
    platform_order_rid integer,
    energy_package_rid integer,
    tg_notice_status_receive CHAR(1) DEFAULT 'N' NOT NULL,
    tg_notice_status_send CHAR(1) DEFAULT 'N' NOT NULL
);


CREATE TABLE t_fms_recharge_order (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    recharge_tg_uid VARCHAR(100) NOT NULL,
    recharge_tg_username VARCHAR(100) DEFAULT NULL,
    recharge_coin_name VARCHAR(50) NOT NULL,
    recharge_pay_price numeric(12,4) NOT NULL,
    need_pay_price numeric(12,4) NOT NULL,
    status smallint DEFAULT '0' NOT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    create_time TEXT NOT NULL,
    update_time TEXT,
    expire_time TEXT NOT NULL,
    cancel_time TEXT,
    complete_time TEXT,
    tx_hash VARCHAR(100) DEFAULT NULL
);


CREATE TABLE t_fms_wallet_trade_list (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash VARCHAR(100) NOT NULL,
    transferfrom_address VARCHAR(200) NOT NULL,
    transferto_address VARCHAR(200) NOT NULL,
    coin_name VARCHAR(20) NOT NULL,
    amount VARCHAR(100) NOT NULL,
    `timestamp` VARCHAR(20) NOT NULL,
    process_status smallint DEFAULT '0' NOT NULL,
    process_time TEXT,
    process_comments VARCHAR(255) DEFAULT NULL,
    get_time TEXT,
    tg_notice_status_receive CHAR(1) DEFAULT 'N' NOT NULL,
    tg_notice_status_send CHAR(1) DEFAULT 'N' NOT NULL,
    recharge_order_rid integer
);


CREATE TABLE t_model_has_permissions (
    permission_id bigint NOT NULL,
    model_type VARCHAR(255) NOT NULL,
    model_id bigint NOT NULL,
    CONSTRAINT t_model_has_permissions_pkey PRIMARY KEY (permission_id, model_id, model_type)
);

CREATE TABLE t_model_has_roles (
    role_id bigint NOT NULL,
    model_type VARCHAR(255) NOT NULL,
    model_id bigint NOT NULL,
    CONSTRAINT t_model_has_roles_pkey PRIMARY KEY (role_id, model_id, model_type)
);

CREATE TABLE t_monitor_bot (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    create_time TEXT NOT NULL,
    update_time TEXT
);


CREATE TABLE t_monitor_wallet (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_type VARCHAR(10) NOT NULL,
    monitor_wallet VARCHAR(200) NOT NULL,
    status smallint DEFAULT '1' NOT NULL,
    bot_rid integer,
    tg_notice_obj VARCHAR(200) DEFAULT NULL,
    balance_alert numeric(14,2) DEFAULT 0.00 NOT NULL,
    balance_amount numeric(14,2) DEFAULT 0.00 NOT NULL,
    comments VARCHAR(100) DEFAULT NULL,
    create_time TEXT,
    update_time TEXT,
    monitor_trx_transaction CHAR(2) DEFAULT 'NN' NOT NULL,
    monitor_approve_transaction CHAR(2) DEFAULT 'NN' NOT NULL,
    monitor_multi_transaction CHAR(2) DEFAULT 'NN' NOT NULL,
    monitor_pledge_transaction CHAR(2) DEFAULT 'NN' NOT NULL,
    monitor_usdt_transaction CHAR(2) DEFAULT 'YY' NOT NULL
);


CREATE TABLE t_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    guard_name VARCHAR(255) DEFAULT 'web' NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    route VARCHAR(255) DEFAULT NULL,
    pid integer
);


CREATE TABLE t_premium_platform (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    platform_name smallint NOT NULL,
    tg_admin_uid VARCHAR(500) DEFAULT NULL,
    platform_hash VARCHAR(500) DEFAULT NULL,
    platform_cookie VARCHAR(3000) DEFAULT NULL,
    platform_phrase VARCHAR(3000) DEFAULT NULL,
    status smallint DEFAULT '1' NOT NULL,
    receive_wallet VARCHAR(100) DEFAULT NULL,
    get_tx_time TEXT,
    tg_notice_obj_receive VARCHAR(200) DEFAULT NULL,
    tg_notice_obj_send VARCHAR(200) DEFAULT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    create_time TEXT NOT NULL,
    update_time TEXT
);

CREATE TABLE t_premium_platform_order (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    create_time TEXT NOT NULL,
    update_time TEXT,
    expire_time TEXT NOT NULL,
    cancel_time TEXT,
    complete_time TEXT,
    recipient VARCHAR(1000) DEFAULT NULL,
    tx_hash VARCHAR(200) DEFAULT NULL,
    tg_notice_user CHAR(1) DEFAULT 'N' NOT NULL,
    tg_notice_admin CHAR(1) DEFAULT 'N' NOT NULL
);


CREATE TABLE t_premium_platform_package (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    create_time TEXT NOT NULL,
    update_time TEXT
);



CREATE TABLE t_premium_wallet_trade_list (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash VARCHAR(100) NOT NULL,
    transferfrom_address VARCHAR(200) NOT NULL,
    transferto_address VARCHAR(200) NOT NULL,
    coin_name VARCHAR(20) NOT NULL,
    amount VARCHAR(100) NOT NULL,
    `timestamp` VARCHAR(20) NOT NULL,
    process_status smallint DEFAULT '0' NOT NULL,
    process_time TEXT,
    process_comments VARCHAR(255) DEFAULT NULL,
    get_time TEXT,
    tg_notice_status_receive CHAR(1) DEFAULT 'N' NOT NULL,
    tg_notice_status_send CHAR(1) DEFAULT 'N' NOT NULL,
    platform_order_rid integer,
    premium_package_rid integer,
    premium_platform_rid integer
);


CREATE TABLE t_role_has_permissions (
    permission_id bigint NOT NULL,
    role_id bigint NOT NULL,
    CONSTRAINT t_role_has_permissions_pkey PRIMARY KEY (permission_id, role_id)
);

CREATE TABLE t_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    guard_name VARCHAR(255) DEFAULT 'web' NOT NULL,
    created_at TEXT,
    updated_at TEXT
);


CREATE TABLE t_shop_goods (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    goods_name VARCHAR(50) NOT NULL,
    goods_type smallint NOT NULL,
    goods_usdt_price numeric(16,4) DEFAULT 0.0000 NOT NULL,
    goods_trx_price numeric(16,4) DEFAULT 0.0000 NOT NULL,
    show_notes VARCHAR(1000) DEFAULT NULL,
    status smallint DEFAULT '1' NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    comments VARCHAR(3000) DEFAULT NULL,
    create_time TEXT NOT NULL,
    update_time TEXT
);

CREATE TABLE t_shop_goods_bot (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    goods_rid integer NOT NULL,
    bot_rid integer NOT NULL,
    goods_usdt_discount numeric(4,2) DEFAULT 1.00 NOT NULL,
    goods_trx_discount numeric(4,2) DEFAULT 1.00 NOT NULL,
    status smallint DEFAULT '1' NOT NULL,
    comments VARCHAR(3000) DEFAULT NULL,
    create_time TEXT NOT NULL,
    update_time TEXT
);


CREATE TABLE t_shop_goods_cdkey (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    goods_rid integer NOT NULL,
    cdkey_no VARCHAR(100) NOT NULL,
    cdkey_pwd VARCHAR(2000) NOT NULL,
    cdkey_usdt_price numeric(16,4) DEFAULT 0.0000 NOT NULL,
    cdkey_trx_price numeric(16,4) DEFAULT 0.0000 NOT NULL,
    status smallint DEFAULT '0' NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    create_time TEXT NOT NULL,
    update_time TEXT
);



CREATE TABLE t_shop_order (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    tg_uid VARCHAR(50) NOT NULL,
    tg_username VARCHAR(100) DEFAULT NULL,
    cdkey_no VARCHAR(100) DEFAULT NULL,
    cdkey_pwd VARCHAR(2000) DEFAULT NULL,
    pay_type smallint NOT NULL,
    pay_price VARCHAR(50) DEFAULT NULL,
    comments VARCHAR(3000) DEFAULT NULL,
    pay_time TEXT
);


CREATE TABLE t_sys_admin_opt_log (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id integer NOT NULL,
    opt_module VARCHAR(200) DEFAULT NULL,
    opt_ref_sn VARCHAR(100) DEFAULT NULL,
    opt_time TEXT,
    opt_content text
);


CREATE TABLE t_sys_config (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key VARCHAR(50) NOT NULL,
    config_val VARCHAR(500) NOT NULL,
    comments VARCHAR(255) NOT NULL,
    create_by VARCHAR(50) DEFAULT NULL,
    create_time TEXT,
    update_by VARCHAR(50) DEFAULT NULL,
    update_time TEXT
);


CREATE TABLE t_sys_data_dictionary (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    dic_key VARCHAR(100) NOT NULL,
    dic_value VARCHAR(500) NOT NULL,
    dic_name VARCHAR(200) DEFAULT NULL,
    create_time TEXT,
    update_time TEXT
);


CREATE TABLE t_telegram_bot (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_token VARCHAR(100) NOT NULL,
    bot_admin_username VARCHAR(100) DEFAULT '-',
    bot_firstname VARCHAR(100) DEFAULT NULL,
    bot_username VARCHAR(100) DEFAULT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    create_by integer,
    create_time TEXT,
    update_by integer,
    update_time TEXT,
    recharge_wallet_addr VARCHAR(100) DEFAULT NULL,
    get_tx_time TEXT,
    last_update_id bigint DEFAULT 0
);

CREATE TABLE t_telegram_bot_ad (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    notice_cycle smallint DEFAULT '1' NOT NULL,
    notice_obj VARCHAR(200) NOT NULL,
    notice_photo VARCHAR(500) DEFAULT NULL,
    notice_ad VARCHAR(2000) NOT NULL,
    status smallint DEFAULT '1' NOT NULL,
    last_notice_time TEXT,
    create_by integer,
    create_time TEXT,
    update_by integer,
    update_time TEXT
);

CREATE TABLE t_telegram_bot_ad_keyboard (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    ad_rid integer NOT NULL,
    keyboard_rid integer NOT NULL,
    create_by integer,
    create_time TEXT,
    update_by integer,
    update_time TEXT
);



CREATE TABLE t_telegram_bot_command (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    command VARCHAR(50) NOT NULL,
    description VARCHAR(100) NOT NULL,
    command_type smallint DEFAULT '1' NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    create_by integer,
    create_time TEXT,
    update_by integer,
    update_time TEXT
);


CREATE TABLE t_telegram_bot_group (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    group_type VARCHAR(50) NOT NULL,
    tg_groupid bigint NOT NULL,
    tg_groupusername VARCHAR(200) DEFAULT NULL,
    tg_groupnickname VARCHAR(200) DEFAULT NULL,
    status smallint DEFAULT 1 NOT NULL,
    is_admin VARCHAR(1) DEFAULT 'N',
    first_time TEXT,
    last_time TEXT,
    stop_time TEXT,
    follow_count integer DEFAULT 0
);


CREATE TABLE t_telegram_bot_keyboard (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    keyboard_type smallint DEFAULT '1' NOT NULL,
    keyboard_name VARCHAR(20) NOT NULL,
    keyboard_icon_custom_emoji_id VARCHAR(64),
    inline_type smallint DEFAULT '0' NOT NULL,
    keyboard_value VARCHAR(500) NOT NULL,
    status smallint DEFAULT '0' NOT NULL,
    create_by integer,
    create_time TEXT,
    update_by integer,
    update_time TEXT,
    seq_sn integer DEFAULT 0 NOT NULL
);


CREATE TABLE t_telegram_bot_keyreply (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    key_type smallint NOT NULL,
    monitor_word VARCHAR(500) NOT NULL,
    reply_photo VARCHAR(300) DEFAULT NULL,
    reply_content VARCHAR(2000) NOT NULL,
    opt_type integer NOT NULL,
    status smallint DEFAULT '0' NOT NULL,
    create_by integer,
    create_time TEXT,
    update_by integer,
    update_time TEXT
);

CREATE TABLE t_telegram_bot_keyreply_keyboard (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    keyreply_rid integer NOT NULL,
    keyboard_rid integer NOT NULL,
    create_by integer,
    create_time TEXT,
    update_by integer,
    update_time TEXT
);




CREATE TABLE t_telegram_bot_user (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    tg_uid bigint NOT NULL,
    tg_username VARCHAR(200) DEFAULT NULL,
    tg_nickname VARCHAR(200) DEFAULT NULL,
    status smallint DEFAULT 1 NOT NULL,
    bind_trc_wallet_addr VARCHAR(200) DEFAULT NULL,
    first_time TEXT,
    last_time TEXT,
    stop_time TEXT,
    cash_trx numeric(20,6) DEFAULT 0 NOT NULL,
    cash_usdt numeric(20,6) DEFAULT 0 NOT NULL,
    max_monitor_wallet integer DEFAULT 0 NOT NULL
);


CREATE TABLE t_transit_user_wallet (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_type VARCHAR(10) NOT NULL,
    wallet_addr VARCHAR(200) NOT NULL,
    total_transit_usdt VARCHAR(200) DEFAULT '0' NOT NULL,
    total_transit_sxf VARCHAR(200) DEFAULT '0' NOT NULL,
    total_yuzhi_sxf VARCHAR(200) DEFAULT '0' NOT NULL,
    need_feedback_sxf VARCHAR(200) DEFAULT '0' NOT NULL,
    send_feedback_sxf VARCHAR(200) DEFAULT '0' NOT NULL,
    last_transit_time TEXT,
    last_yuzhi_time TEXT
);


CREATE TABLE t_transit_wallet (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_type VARCHAR(10) NOT NULL,
    receive_wallet VARCHAR(200) NOT NULL,
    send_wallet VARCHAR(200) NOT NULL,
    send_wallet_privatekey VARCHAR(2000) DEFAULT NULL,
    show_notes VARCHAR(500) DEFAULT NULL,
    status smallint DEFAULT '1' NOT NULL,
    tg_notice_obj_receive VARCHAR(200) DEFAULT NULL,
    tg_notice_obj_send VARCHAR(200) DEFAULT NULL,
    get_tx_time TEXT,
    create_time TEXT,
    update_time TEXT,
    bot_rid integer,
    auto_stock_min_trx integer DEFAULT 0 NOT NULL,
    auto_stock_per_usdt integer DEFAULT 0 NOT NULL
);

CREATE TABLE t_transit_wallet_black (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_type VARCHAR(10) NOT NULL,
    black_wallet VARCHAR(200) NOT NULL,
    comments VARCHAR(255) DEFAULT NULL,
    create_time TEXT,
    update_time TEXT
);


CREATE TABLE t_transit_wallet_coin (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    create_time TEXT,
    update_by integer,
    update_time TEXT
);



CREATE TABLE t_transit_wallet_trade_list (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash VARCHAR(100) NOT NULL,
    transferfrom_address VARCHAR(200) NOT NULL,
    transferto_address VARCHAR(200) NOT NULL,
    coin_name VARCHAR(20) NOT NULL,
    amount VARCHAR(100) NOT NULL,
    `timestamp` VARCHAR(20) NOT NULL,
    process_status smallint DEFAULT '0' NOT NULL,
    process_time TEXT,
    process_comments VARCHAR(255) DEFAULT NULL,
    get_time TEXT,
    sendback_address VARCHAR(200) DEFAULT NULL,
    sendback_amount VARCHAR(100) DEFAULT '0' NOT NULL,
    sendback_time TEXT,
    sendback_coin_name VARCHAR(20) DEFAULT NULL,
    sendback_tx_hash VARCHAR(100) DEFAULT NULL,
    sendback_contract_ret VARCHAR(20) DEFAULT NULL,
    tg_notice_status_receive CHAR(1) DEFAULT 'N' NOT NULL,
    tg_notice_status_send CHAR(1) DEFAULT 'N' NOT NULL,
    current_exchange_rate numeric(8,2) DEFAULT 0.00 NOT NULL,
    current_huan_yuzhi_amount numeric(14,2) DEFAULT 0.00 NOT NULL
);



















































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
    create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE t_telegram_bot_group_policy (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT t_telegram_bot_group_policy_bot_group_unique UNIQUE (bot_rid, tg_groupid)
);

CREATE TABLE t_telegram_group_message_history (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    chat_id bigint NOT NULL,
    message_id bigint NOT NULL,
    user_id bigint,
    message_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    message_text text,
    message_json TEXT NOT NULL,
    create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT t_telegram_group_message_history_unique UNIQUE (bot_rid, chat_id, message_id)
);

CREATE INDEX idx_telegram_group_message_history_recent
    ON t_telegram_group_message_history (bot_rid, chat_id, message_date DESC);

CREATE TABLE t_telegram_moderated_member (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    chat_id bigint NOT NULL,
    user_id bigint NOT NULL,
    action VARCHAR(30) NOT NULL,
    restricted_until TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT t_telegram_moderated_member_bot_chat_user_unique UNIQUE (bot_rid, chat_id, user_id)
);

CREATE INDEX idx_telegram_moderated_member_active
    ON t_telegram_moderated_member (status, restricted_until, update_time DESC);

CREATE TABLE t_telegram_verification (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    verification_type VARCHAR(30) NOT NULL,
    bot_rid integer NOT NULL,
    chat_id bigint,
    user_id bigint NOT NULL,
    user_chat_id bigint,
    verification_message_id bigint,
    mini_app_message_id bigint,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    expires_at TEXT NOT NULL,
    verified_at TEXT,
    create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE t_telegram_support_message (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    user_id bigint NOT NULL,
    support_chat_id bigint NOT NULL,
    user_message_id bigint,
    support_message_id bigint,
    direction VARCHAR(20) NOT NULL,
    is_ad boolean NOT NULL DEFAULT false,
    create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE t_telegram_moderation_log (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_rid integer NOT NULL,
    chat_id bigint,
    user_id bigint,
    message_id bigint,
    event_type VARCHAR(40) NOT NULL,
    action VARCHAR(30) NOT NULL,
    score smallint NOT NULL DEFAULT 0,
    reasons text,
    content_preview VARCHAR(500),
    create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_telegram_verification_lookup ON t_telegram_verification (bot_rid, user_id, verification_type, status);

CREATE INDEX idx_telegram_verification_expiry ON t_telegram_verification (status, expires_at);

CREATE INDEX idx_telegram_support_reply ON t_telegram_support_message (bot_rid, support_chat_id, support_message_id);

CREATE INDEX idx_telegram_moderation_log_recent ON t_telegram_moderation_log (bot_rid, create_time DESC);

CREATE TABLE t_telegram_clone_proxy_config (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    master_bot_rid integer NOT NULL,
    is_enable smallint NOT NULL DEFAULT 0,
    charge_enable smallint NOT NULL DEFAULT 0,
    merchant_limit integer NOT NULL DEFAULT 0,
    open_price numeric(20,6) NOT NULL DEFAULT 0,
    default_revenue_ratio numeric(7,2) NOT NULL DEFAULT 0,
    create_time TEXT,
    update_time TEXT
);

CREATE TABLE t_telegram_clone_proxy_merchant (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    create_time TEXT,
    update_time TEXT
);

CREATE TABLE t_telegram_clone_proxy_order (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
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
    create_time TEXT,
    update_time TEXT,
    paid_time TEXT,
    expire_time TEXT,
    complete_time TEXT
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


CREATE UNIQUE INDEX uq_telegram_clone_proxy_opening_pending_user ON t_telegram_clone_proxy_order (master_bot_rid,pay_user_tg_uid) WHERE order_type='opening' AND status IN (0,1);

CREATE INDEX idx_telegram_clone_proxy_merchant_status
    ON t_telegram_clone_proxy_merchant (master_bot_rid, status, create_time DESC);

CREATE INDEX idx_telegram_clone_proxy_order_merchant_type
    ON t_telegram_clone_proxy_order (merchant_rid, order_type, status, create_time DESC);

CREATE INDEX idx_telegram_clone_proxy_order_opening_user
    ON t_telegram_clone_proxy_order (master_bot_rid, pay_user_tg_uid, order_type, status);

CREATE UNIQUE INDEX t_permissions_name_guard_name_key ON t_permissions (name, guard_name);
CREATE UNIQUE INDEX t_roles_name_guard_name_key ON t_roles (name, guard_name);

-- Fresh-database permission defaults only; no credentials, API keys, wallet data or historical business rows.
INSERT INTO t_permissions VALUES (5, '主页', 'web', '2020-09-22 08:33:50', '2020-09-22 08:33:50', '', 0);

INSERT INTO t_permissions VALUES (6, '主页列表', 'web', '2020-09-22 08:37:02', '2020-09-22 08:37:02', 'admin.home', 5);

INSERT INTO t_permissions VALUES (7, '系统管理', 'web', '2020-09-22 08:37:37', '2020-09-22 08:37:37', '', 0);

INSERT INTO t_permissions VALUES (8, '管理员管理', 'web', '2020-09-22 08:38:14', '2020-09-22 08:38:14', 'admin.system.admin.index', 7);

INSERT INTO t_permissions VALUES (9, '权限管理', 'web', '2020-09-22 08:38:23', '2020-09-22 08:38:23', 'admin.system.permission.index', 7);

INSERT INTO t_permissions VALUES (10, '角色管理', 'web', '2020-09-22 08:38:34', '2020-09-22 08:38:34', 'admin.system.role.index', 7);

INSERT INTO t_permissions VALUES (19, '系统设置', 'web', '2021-07-09 05:42:29', '2021-07-09 05:42:29', '', 0);

INSERT INTO t_permissions VALUES (20, '配置信息', 'web', '2021-07-09 05:42:47', '2021-07-09 05:42:47', 'admin.setting.config.index', 19);

INSERT INTO t_permissions VALUES (11, '添加管理员', 'web', '2020-09-22 08:39:33', '2020-09-22 08:39:33', 'admin.system.admin.add', 8);

INSERT INTO t_permissions VALUES (12, '修改管理员状态', 'web', '2020-09-22 09:23:59', '2020-09-22 09:23:59', 'admin.system.admin.change_status', 8);

INSERT INTO t_permissions VALUES (13, '修改管理员资料', 'web', '2020-09-22 09:24:12', '2020-09-22 09:24:12', 'admin.system.admin.update', 8);

INSERT INTO t_permissions VALUES (14, '删除管理员', 'web', '2020-09-22 09:24:21', '2020-09-22 09:24:21', 'admin.system.admin.delete', 8);

INSERT INTO t_permissions VALUES (15, '添加角色', 'web', '2020-09-22 09:25:14', '2020-09-22 09:25:14', 'admin.system.role.add', 10);

INSERT INTO t_permissions VALUES (16, '编辑角色权限', 'web', '2020-09-22 09:25:23', '2020-09-22 09:25:23', 'admin.system.role.show_permissions', 10);

INSERT INTO t_permissions VALUES (17, '修改角色名称', 'web', '2020-09-22 09:25:30', '2020-09-22 09:25:30', 'admin.system.role.update', 10);

INSERT INTO t_permissions VALUES (18, '删除角色', 'web', '2020-09-22 09:25:38', '2020-09-22 09:25:38', 'admin.system.role.del', 10);

INSERT INTO t_permissions VALUES (21, '搜索查询_配置信息', 'web', '2021-07-09 05:42:55', '2021-07-09 05:42:55', 'admin.search', 20);

INSERT INTO t_permissions VALUES (22, '数据字典', 'web', '2021-07-09 05:43:06', '2021-07-09 05:43:06', 'admin.setting.dictionary.index', 19);

INSERT INTO t_permissions VALUES (23, '添加数据字典', 'web', '2021-07-09 05:43:27', '2021-07-09 05:43:27', 'admin.setting.dictionary.store', 22);

INSERT INTO t_permissions VALUES (24, '编辑数据字典', 'web', '2021-07-09 05:43:38', '2021-07-09 05:43:38', 'admin.setting.dictionary.update', 22);

INSERT INTO t_permissions VALUES (25, '删除数据字典', 'web', '2021-07-09 05:43:49', '2021-07-09 05:43:49', 'admin.setting.dictionary.delete', 22);

INSERT INTO t_permissions VALUES (26, '搜索查询_数据字典', 'web', '2021-07-09 05:43:56', '2021-07-09 05:43:56', 'admin.search', 22);

INSERT INTO t_permissions VALUES (27, '应用升级', 'web', '2021-07-09 05:44:09', '2021-07-09 05:44:09', 'admin.setting.app_version.index', 19);

INSERT INTO t_permissions VALUES (28, '升级应用升级', 'web', '2021-07-09 05:44:25', '2021-07-09 05:44:25', 'admin.setting.app_version.store', 27);

INSERT INTO t_permissions VALUES (29, '编辑应用升级', 'web', '2021-07-09 05:44:36', '2021-07-09 05:44:36', 'admin.setting.app_version.edit', 27);

INSERT INTO t_permissions VALUES (30, '搜索查询_应用升级', 'web', '2021-07-09 05:44:53', '2021-07-09 05:44:53', 'admin.search', 27);

INSERT INTO t_permissions VALUES (31, '机器人管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO t_permissions VALUES (32, '群组用户', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO t_permissions VALUES (33, '闪兑管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO t_permissions VALUES (34, '能量管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO t_permissions VALUES (35, '会员管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO t_permissions VALUES (36, '监控管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO t_permissions VALUES (37, '归集管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO t_permissions VALUES (38, '商城管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO t_permissions VALUES (39, '克隆/代理', 'web', '2026-09-17 00:00:00', '2026-09-17 00:00:00', '', 0);

INSERT INTO t_permissions VALUES (40, '克隆/代理基础设置', 'web', '2026-09-17 00:00:00', '2026-09-17 00:00:00', 'admin.telegram.cloneproxy.basic', 39);

INSERT INTO t_permissions VALUES (41, '克隆/代理商户管理', 'web', '2026-09-17 00:00:00', '2026-09-17 00:00:00', 'admin.telegram.cloneproxy.merchants', 39);

INSERT INTO t_role_has_permissions VALUES (5, 1);

INSERT INTO t_role_has_permissions VALUES (6, 1);

INSERT INTO t_role_has_permissions VALUES (7, 1);

INSERT INTO t_role_has_permissions VALUES (8, 1);

INSERT INTO t_role_has_permissions VALUES (9, 1);

INSERT INTO t_role_has_permissions VALUES (10, 1);

INSERT INTO t_role_has_permissions VALUES (19, 1);

INSERT INTO t_role_has_permissions VALUES (20, 1);

INSERT INTO t_role_has_permissions VALUES (11, 1);

INSERT INTO t_role_has_permissions VALUES (12, 1);

INSERT INTO t_role_has_permissions VALUES (13, 1);

INSERT INTO t_role_has_permissions VALUES (14, 1);

INSERT INTO t_role_has_permissions VALUES (15, 1);

INSERT INTO t_role_has_permissions VALUES (16, 1);

INSERT INTO t_role_has_permissions VALUES (17, 1);

INSERT INTO t_role_has_permissions VALUES (18, 1);

INSERT INTO t_role_has_permissions VALUES (21, 1);

INSERT INTO t_role_has_permissions VALUES (22, 1);

INSERT INTO t_role_has_permissions VALUES (23, 1);

INSERT INTO t_role_has_permissions VALUES (24, 1);

INSERT INTO t_role_has_permissions VALUES (25, 1);

INSERT INTO t_role_has_permissions VALUES (26, 1);

INSERT INTO t_role_has_permissions VALUES (27, 1);

INSERT INTO t_role_has_permissions VALUES (28, 1);

INSERT INTO t_role_has_permissions VALUES (29, 1);

INSERT INTO t_role_has_permissions VALUES (30, 1);

INSERT INTO t_role_has_permissions VALUES (31, 1);

INSERT INTO t_role_has_permissions VALUES (32, 1);

INSERT INTO t_role_has_permissions VALUES (33, 1);

INSERT INTO t_role_has_permissions VALUES (34, 1);

INSERT INTO t_role_has_permissions VALUES (35, 1);

INSERT INTO t_role_has_permissions VALUES (36, 1);

INSERT INTO t_role_has_permissions VALUES (37, 1);

INSERT INTO t_role_has_permissions VALUES (38, 1);

INSERT INTO t_role_has_permissions VALUES (39, 1);

INSERT INTO t_role_has_permissions VALUES (40, 1);

INSERT INTO t_role_has_permissions VALUES (41, 1);

INSERT INTO t_roles VALUES (1, '超级管理员', 'web', '2026-02-22 06:41:09.980014', '2026-02-22 06:41:09.980014');

INSERT INTO t_model_has_roles(role_id,model_type,model_id)
VALUES (1, 'App\Models\Admin\Admin', 1);
