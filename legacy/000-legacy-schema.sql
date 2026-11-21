-- Fresh-database legacy schema only. Derived from the project schema snapshot; historical rows and DROP statements are intentionally excluded.
-- Applied only when the public schema contains no tables. Existing databases are never replayed.
CREATE TABLE public.t_admin (
    id bigint NOT NULL,
    name character varying(30) NOT NULL,
    password character varying(100) NOT NULL,
    head character varying(255) DEFAULT NULL::character varying,
    status smallint DEFAULT '1'::smallint NOT NULL,
    remember_token character varying(100) DEFAULT NULL::character varying,
    created_at timestamp without time zone,
    updated_at timestamp without time zone,
    white_ip character varying(3000) DEFAULT NULL::character varying,
    security_email character varying(254) DEFAULT NULL::character varying,
    security_email_verified_at timestamp without time zone
);

CREATE SEQUENCE public.t_admin_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_admin_id_seq OWNED BY public.t_admin.id;

CREATE TABLE public.t_admin_login_log (
    rid integer NOT NULL,
    admin_name character varying(100) NOT NULL,
    login_ip character varying(1000) DEFAULT NULL::character varying,
    login_time timestamp without time zone,
    admin_id bigint,
    login_location character varying(120) DEFAULT '未知'::character varying,
    public_ip character varying(45),
    device_type character varying(40) DEFAULT '未知'::character varying,
    user_agent text,
    session_hash character varying(64)
);

CREATE TABLE public.t_admin_security_settings (
    rid smallint NOT NULL,
    ip_whitelist_enabled boolean DEFAULT false NOT NULL,
    ip_whitelist text DEFAULT ''::text NOT NULL,
    verification_enabled boolean DEFAULT false NOT NULL,
    verification_method character varying(40) DEFAULT 'captcha'::character varying NOT NULL,
    session_lifetime_minutes integer DEFAULT 120 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT t_admin_security_settings_pkey PRIMARY KEY (rid),
    CONSTRAINT t_admin_security_settings_singleton CHECK (rid = 1)
);

CREATE TABLE public.t_admin_device_session (
    rid bigserial NOT NULL,
    admin_id bigint NOT NULL,
    session_hash character varying(64) NOT NULL,
    login_ip character varying(45),
    public_ip character varying(45),
    location character varying(120) DEFAULT '未知'::character varying,
    device_type character varying(40) DEFAULT '未知'::character varying,
    user_agent text,
    login_time timestamp without time zone NOT NULL,
    last_seen_at timestamp without time zone NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    revoked_at timestamp without time zone,
    CONSTRAINT t_admin_device_session_pkey PRIMARY KEY (rid),
    CONSTRAINT t_admin_device_session_session_hash_key UNIQUE (session_hash)
);

CREATE INDEX IF NOT EXISTS t_admin_login_log_admin_time_idx ON public.t_admin_login_log (admin_id, login_time DESC);

CREATE INDEX IF NOT EXISTS t_admin_device_session_admin_active_idx ON public.t_admin_device_session (admin_id, revoked_at, expires_at);

CREATE SEQUENCE public.t_admin_login_log_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_admin_login_log_rid_seq OWNED BY public.t_admin_login_log.rid;

CREATE TABLE public.t_bind_a_send_n_binding (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid bigint NOT NULL,
    wallet_addr character varying(100) NOT NULL,
    status smallint DEFAULT 0 NOT NULL,
    activate_threshold numeric(14,2) DEFAULT 0,
    activate_time timestamp without time zone,
    activated_by integer,
    unbind_time timestamp without time zone,
    unbind_by integer,
    unbind_reason character varying(500),
    create_by integer NOT NULL,
    create_time timestamp without time zone NOT NULL,
    update_by integer,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_bind_a_send_n_binding_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_bind_a_send_n_binding_rid_seq OWNED BY public.t_bind_a_send_n_binding.rid;

CREATE TABLE public.t_bind_a_send_n_config (
    rid integer NOT NULL,
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
    create_time timestamp without time zone NOT NULL,
    update_by integer,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_bind_a_send_n_config_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_bind_a_send_n_config_rid_seq OWNED BY public.t_bind_a_send_n_config.rid;

CREATE TABLE public.t_bind_a_send_n_grant (
    rid integer NOT NULL,
    binding_rid integer NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid bigint NOT NULL,
    a_addr character varying(100) NOT NULL,
    n_addr character varying(100) NOT NULL,
    tx_hash character varying(200) NOT NULL,
    energy_amount integer NOT NULL,
    grant_status smallint DEFAULT 0 NOT NULL,
    audit_status smallint DEFAULT 0 NOT NULL,
    retry_count smallint DEFAULT 0 NOT NULL,
    fail_reason character varying(500),
    grant_time timestamp without time zone,
    update_time timestamp without time zone,
    create_time timestamp without time zone
);

CREATE SEQUENCE public.t_bind_a_send_n_grant_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_bind_a_send_n_grant_rid_seq OWNED BY public.t_bind_a_send_n_grant.rid;

CREATE TABLE public.t_collection_wallet (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    chain_type character varying(10) DEFAULT 'trc'::character varying NOT NULL,
    wallet_addr character varying(200) NOT NULL,
    notice_tg_uid character varying(100) DEFAULT NULL::character varying,
    notice_tg_groupid character varying(100) DEFAULT NULL::character varying,
    trx_collection_amount numeric(16,6) DEFAULT 0 NOT NULL,
    usdt_collection_amount numeric(16,6) DEFAULT 0 NOT NULL,
    trx_reserved_amount numeric(16,6) DEFAULT 0 NOT NULL,
    usdt_reserved_amount numeric(16,6) DEFAULT 0 NOT NULL,
    status smallint DEFAULT 1 NOT NULL,
    create_time timestamp without time zone,
    update_time timestamp without time zone,
    wallet_addr_privatekey character varying(2000),
    trx_reserve_amount numeric(16,6) DEFAULT 0 NOT NULL,
    usdt_reserve_amount numeric(16,6) DEFAULT 0 NOT NULL,
    collection_wallet_addr character varying(200),
    permission_id integer DEFAULT 0 NOT NULL,
    tg_notice_obj character varying(500),
    comments character varying(100),
    trx_balance numeric(16,6) DEFAULT 0,
    usdt_balance numeric(16,6) DEFAULT 0
);

CREATE TABLE public.t_collection_wallet_list (
    rid integer NOT NULL,
    wallet_addr character varying(200) NOT NULL,
    collection_wallet_addr character varying(200) NOT NULL,
    coin_name character varying(20) NOT NULL,
    collection_amount numeric(16,6) DEFAULT 0 NOT NULL,
    collection_time timestamp without time zone,
    collection_hash character varying(200) DEFAULT NULL::character varying,
    create_time timestamp without time zone
);

CREATE SEQUENCE public.t_collection_wallet_list_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_collection_wallet_list_rid_seq OWNED BY public.t_collection_wallet_list.rid;

CREATE SEQUENCE public.t_collection_wallet_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_collection_wallet_rid_seq OWNED BY public.t_collection_wallet.rid;

CREATE TABLE public.t_energy_ai_bishu (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid character varying(100) NOT NULL,
    wallet_addr character varying(100) NOT NULL,
    status smallint DEFAULT 0 NOT NULL,
    current_bandwidth_quantity bigint DEFAULT 0 NOT NULL,
    current_energy_quantity bigint DEFAULT 0 NOT NULL,
    is_buy character(1) DEFAULT 'N'::bpchar NOT NULL,
    is_notice character(1) DEFAULT 'N'::bpchar NOT NULL,
    is_notice_admin character(1) DEFAULT 'N'::bpchar NOT NULL,
    total_buy_usdt numeric(14,2) DEFAULT 0 NOT NULL,
    max_buy_quantity integer DEFAULT 0 NOT NULL,
    total_buy_quantity integer DEFAULT 0 NOT NULL,
    total_buy_energy_quantity bigint DEFAULT 0 NOT NULL,
    comments character varying(2000) DEFAULT NULL::character varying,
    back_comments character varying(2000) DEFAULT NULL::character varying,
    create_by integer NOT NULL,
    create_time timestamp without time zone NOT NULL,
    update_by integer,
    update_time timestamp without time zone,
    energy_platform_rid integer,
    bishu_stop_day integer DEFAULT 0 NOT NULL,
    is_active character(1) DEFAULT 'N'::bpchar NOT NULL,
    active_time timestamp without time zone,
    last_energy_time timestamp without time zone
);

CREATE SEQUENCE public.t_energy_ai_bishu_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_energy_ai_bishu_rid_seq OWNED BY public.t_energy_ai_bishu.rid;

CREATE TABLE public.t_energy_ai_trusteeship (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid bigint NOT NULL,
    wallet_addr character varying(100) NOT NULL,
    status smallint DEFAULT '1'::smallint NOT NULL,
    current_bandwidth_quantity bigint DEFAULT '0'::bigint NOT NULL,
    current_energy_quantity bigint DEFAULT '0'::bigint NOT NULL,
    min_energy_quantity integer DEFAULT 32000 NOT NULL,
    per_buy_energy_quantity integer DEFAULT 32000 NOT NULL,
    total_buy_energy_quantity bigint DEFAULT '0'::bigint NOT NULL,
    total_used_trx numeric(14,2) DEFAULT 0.00 NOT NULL,
    total_buy_quantity integer DEFAULT 0 NOT NULL,
    is_buy character(1) DEFAULT 'N'::bpchar NOT NULL,
    is_notice character(1) DEFAULT 'N'::bpchar NOT NULL,
    is_notice_admin character(1) DEFAULT 'N'::bpchar NOT NULL,
    last_buy_time timestamp without time zone,
    last_used_trx numeric(14,2) DEFAULT NULL::numeric,
    comments character varying(2000) DEFAULT NULL::character varying,
    back_comments character varying(2000) DEFAULT NULL::character varying,
    create_by integer NOT NULL,
    create_time timestamp without time zone NOT NULL,
    update_by integer,
    update_time timestamp without time zone,
    max_buy_quantity integer DEFAULT 0 NOT NULL
);

CREATE SEQUENCE public.t_energy_ai_trusteeship_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_energy_ai_trusteeship_rid_seq OWNED BY public.t_energy_ai_trusteeship.rid;

CREATE TABLE public.t_energy_platform (
    rid integer NOT NULL,
    poll_group character(1) NOT NULL,
    platform_name smallint NOT NULL,
    status smallint DEFAULT '1'::smallint NOT NULL,
    platform_uid character varying(100) DEFAULT NULL::character varying,
    permission_id integer DEFAULT 0 NOT NULL,
    platform_balance numeric(28,6) DEFAULT '0'::numeric NOT NULL,
    alert_platform_balance numeric(28,6) DEFAULT '0'::numeric NOT NULL,
    platform_apikey character varying(3000) DEFAULT NULL::character varying,
    tg_notice_obj character varying(200) DEFAULT NULL::character varying,
    tg_notice_bot_rid integer,
    seq_sn integer DEFAULT 0 NOT NULL,
    last_alert_time timestamp without time zone,
    comments character varying(3000) DEFAULT NULL::character varying,
    create_time timestamp without time zone NOT NULL,
    update_time timestamp without time zone
);

CREATE TABLE public.t_energy_platform_bot (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    poll_group character(1) NOT NULL,
    tg_admin_uid character varying(500) DEFAULT NULL::character varying,
    status smallint DEFAULT '1'::smallint NOT NULL,
    receive_wallet character varying(100) DEFAULT NULL::character varying,
    get_tx_time timestamp without time zone,
    tg_notice_obj_receive character varying(200) DEFAULT NULL::character varying,
    tg_notice_obj_send character varying(200) DEFAULT NULL::character varying,
    comments character varying(255) DEFAULT NULL::character varying,
    is_open_ai_trusteeship character(1) DEFAULT 'N'::bpchar NOT NULL,
    trx_price_energy_32000 integer,
    trx_price_energy_65000 integer,
    per_energy_day integer,
    create_time timestamp without time zone NOT NULL,
    update_time timestamp without time zone,
    agent_tg_uid bigint,
    agent_per_price numeric(18,6),
    bishu_stop_day integer DEFAULT 0 NOT NULL,
    is_open_bishu character(1) DEFAULT 'Y'::bpchar NOT NULL,
    per_bishu_usdt_price numeric(4,2) DEFAULT 0.50 NOT NULL,
    per_bishu_energy_quantity integer DEFAULT 65000 NOT NULL,
    per_energy_day_bishu integer DEFAULT 1,
    bishu_recovery_type smallint DEFAULT 1 NOT NULL,
    bishu_daili_type smallint DEFAULT 1 NOT NULL,
    ai_trusteeship_recovery_type character varying(20) DEFAULT '1'::character varying NOT NULL
);

CREATE SEQUENCE public.t_energy_platform_bot_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_energy_platform_bot_rid_seq OWNED BY public.t_energy_platform_bot.rid;

CREATE TABLE public.t_energy_platform_order (
    rid integer NOT NULL,
    energy_platform_rid integer NOT NULL,
    energy_platform_bot_rid integer NOT NULL,
    platform_name smallint NOT NULL,
    platform_uid character varying(50) NOT NULL,
    source_type smallint DEFAULT '1'::smallint NOT NULL,
    receive_address character varying(50) NOT NULL,
    platform_order_id character varying(100) NOT NULL,
    energy_amount integer NOT NULL,
    energy_day smallint NOT NULL,
    energy_time timestamp without time zone NOT NULL,
    recovery_status smallint DEFAULT '1'::smallint NOT NULL,
    recovery_time timestamp without time zone,
    use_trx numeric(14,6) DEFAULT NULL::numeric
);

CREATE SEQUENCE public.t_energy_platform_order_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_energy_platform_order_rid_seq OWNED BY public.t_energy_platform_order.rid;

CREATE TABLE public.t_energy_platform_package (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    package_type smallint DEFAULT '1'::smallint NOT NULL,
    package_name character varying(50) NOT NULL,
    energy_amount integer NOT NULL,
    energy_day smallint NOT NULL,
    trx_price numeric(14,2) DEFAULT 0.00 NOT NULL,
    usdt_price numeric(14,2) DEFAULT 0.00 NOT NULL,
    status smallint DEFAULT '1'::smallint NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    create_by integer,
    create_time timestamp without time zone,
    update_by integer,
    update_time timestamp without time zone,
    callback_data character varying(50) NOT NULL,
    show_notes character varying(1000) DEFAULT NULL::character varying,
    package_pic character varying(200) DEFAULT NULL::character varying,
    agent_trx_price numeric(14,2) DEFAULT 0.00 NOT NULL
);

CREATE SEQUENCE public.t_energy_platform_package_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_energy_platform_package_rid_seq OWNED BY public.t_energy_platform_package.rid;

CREATE SEQUENCE public.t_energy_platform_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_energy_platform_rid_seq OWNED BY public.t_energy_platform.rid;

CREATE TABLE public.t_energy_quick_order (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid character varying(100) NOT NULL,
    wallet_addr character varying(100) NOT NULL,
    quick_order_amount bigint DEFAULT 0 NOT NULL,
    quick_order_status smallint DEFAULT 0 NOT NULL,
    create_time timestamp without time zone,
    update_time timestamp without time zone,
    energy_amount integer DEFAULT 0 NOT NULL,
    energy_day smallint DEFAULT 3 NOT NULL,
    status smallint DEFAULT 0 NOT NULL,
    is_notice character(1) DEFAULT 'N'::bpchar NOT NULL,
    package_rid integer,
    comments character varying(255) DEFAULT NULL::character varying,
    package_name character varying(100),
    pay_price numeric(20,6),
    pay_type character varying(20),
    pay_time timestamp without time zone
);

CREATE SEQUENCE public.t_energy_quick_order_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_energy_quick_order_rid_seq OWNED BY public.t_energy_quick_order.rid;

CREATE TABLE public.t_energy_special (
    rid integer NOT NULL,
    bot_rid integer,
    tg_uid bigint,
    wallet_addr character varying(50) NOT NULL,
    wallet_energy bigint DEFAULT 0 NOT NULL,
    max_energy bigint DEFAULT 0 NOT NULL,
    send_energy bigint DEFAULT 0 NOT NULL,
    per_energy integer DEFAULT 0 NOT NULL,
    less_than_energy integer DEFAULT 0 NOT NULL,
    status smallint DEFAULT 0 NOT NULL,
    total_usdt_recharge numeric(14,2) DEFAULT 0 NOT NULL,
    total_trx_recharge numeric(14,2) DEFAULT 0 NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    comments character varying(200) DEFAULT NULL::character varying
);

CREATE TABLE public.t_energy_special_list (
    rid integer NOT NULL,
    bot_rid integer,
    tg_uid bigint,
    wallet_addr character varying(50) NOT NULL,
    send_wallet_addr character varying(50) NOT NULL,
    before_energy bigint,
    daili_energy integer,
    daili_hash character varying(100) DEFAULT NULL::character varying,
    daili_trx numeric(18,6) DEFAULT NULL::numeric,
    status smallint DEFAULT 1 NOT NULL,
    daili_time timestamp without time zone,
    huishou_time timestamp without time zone,
    huishou_hash character varying(100) DEFAULT NULL::character varying
);

CREATE SEQUENCE public.t_energy_special_list_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_energy_special_list_rid_seq OWNED BY public.t_energy_special_list.rid;

CREATE SEQUENCE public.t_energy_special_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_energy_special_rid_seq OWNED BY public.t_energy_special.rid;

CREATE TABLE public.t_energy_third_part (
    rid integer NOT NULL,
    order_type smallint NOT NULL,
    tg_uid bigint NOT NULL,
    platform_rid integer NOT NULL,
    bot_rid integer NOT NULL,
    cishu_energy integer NOT NULL,
    wallet_addr character varying(50) NOT NULL,
    before_trx numeric(16,6) NOT NULL,
    change_trx numeric(16,6) NOT NULL,
    after_trx numeric(16,6) NOT NULL,
    order_time timestamp without time zone NOT NULL,
    process_status smallint DEFAULT 0 NOT NULL,
    process_time timestamp without time zone,
    process_comments character varying(2000) DEFAULT NULL::character varying
);

CREATE SEQUENCE public.t_energy_third_part_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_energy_third_part_rid_seq OWNED BY public.t_energy_third_part.rid;

CREATE TABLE public.t_energy_wallet_trade_list (
    rid integer NOT NULL,
    tx_hash character varying(100) NOT NULL,
    transferfrom_address character varying(200) NOT NULL,
    transferto_address character varying(200) NOT NULL,
    coin_name character varying(20) NOT NULL,
    amount character varying(100) NOT NULL,
    "timestamp" character varying(20) NOT NULL,
    process_status smallint DEFAULT '0'::smallint NOT NULL,
    process_time timestamp without time zone,
    process_comments character varying(2000) DEFAULT NULL::character varying,
    get_time timestamp without time zone,
    energy_platform_rid integer,
    energy_platform_bot_rid integer,
    platform_order_rid integer,
    energy_package_rid integer,
    tg_notice_status_receive character(1) DEFAULT 'N'::bpchar NOT NULL,
    tg_notice_status_send character(1) DEFAULT 'N'::bpchar NOT NULL
);

CREATE SEQUENCE public.t_energy_wallet_trade_list_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_energy_wallet_trade_list_rid_seq OWNED BY public.t_energy_wallet_trade_list.rid;

CREATE TABLE public.t_fms_recharge_order (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    recharge_tg_uid character varying(100) NOT NULL,
    recharge_tg_username character varying(100) DEFAULT NULL::character varying,
    recharge_coin_name character varying(50) NOT NULL,
    recharge_pay_price numeric(12,4) NOT NULL,
    need_pay_price numeric(12,4) NOT NULL,
    status smallint DEFAULT '0'::smallint NOT NULL,
    comments character varying(255) DEFAULT NULL::character varying,
    create_time timestamp without time zone NOT NULL,
    update_time timestamp without time zone,
    expire_time timestamp without time zone NOT NULL,
    cancel_time timestamp without time zone,
    complete_time timestamp without time zone,
    tx_hash character varying(100) DEFAULT NULL::character varying
);

CREATE SEQUENCE public.t_fms_recharge_order_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_fms_recharge_order_rid_seq OWNED BY public.t_fms_recharge_order.rid;

CREATE TABLE public.t_fms_wallet_trade_list (
    rid integer NOT NULL,
    tx_hash character varying(100) NOT NULL,
    transferfrom_address character varying(200) NOT NULL,
    transferto_address character varying(200) NOT NULL,
    coin_name character varying(20) NOT NULL,
    amount character varying(100) NOT NULL,
    "timestamp" character varying(20) NOT NULL,
    process_status smallint DEFAULT '0'::smallint NOT NULL,
    process_time timestamp without time zone,
    process_comments character varying(255) DEFAULT NULL::character varying,
    get_time timestamp without time zone,
    tg_notice_status_receive character(1) DEFAULT 'N'::bpchar NOT NULL,
    tg_notice_status_send character(1) DEFAULT 'N'::bpchar NOT NULL,
    recharge_order_rid integer
);

CREATE SEQUENCE public.t_fms_wallet_trade_list_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_fms_wallet_trade_list_rid_seq OWNED BY public.t_fms_wallet_trade_list.rid;

CREATE TABLE public.t_model_has_permissions (
    permission_id bigint NOT NULL,
    model_type character varying(255) NOT NULL,
    model_id bigint NOT NULL
);

CREATE TABLE public.t_model_has_roles (
    role_id bigint NOT NULL,
    model_type character varying(255) NOT NULL,
    model_id bigint NOT NULL
);

CREATE TABLE public.t_monitor_bot (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    status smallint DEFAULT '1'::smallint NOT NULL,
    free_monitor_wallet integer DEFAULT 4 NOT NULL,
    price_usdt_5 numeric(16,4) DEFAULT 0.0000 NOT NULL,
    price_usdt_10 numeric(16,4) DEFAULT 0.0000 NOT NULL,
    price_usdt_20 numeric(16,4) DEFAULT 0.0000 NOT NULL,
    price_usdt_50 numeric(16,4) DEFAULT 0.0000 NOT NULL,
    price_usdt_100 numeric(16,4) DEFAULT 0.0000 NOT NULL,
    price_usdt_200 numeric(16,4) DEFAULT 0.0000 NOT NULL,
    comments character varying(3000) DEFAULT NULL::character varying,
    create_time timestamp without time zone NOT NULL,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_monitor_bot_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_monitor_bot_rid_seq OWNED BY public.t_monitor_bot.rid;

CREATE TABLE public.t_monitor_wallet (
    rid integer NOT NULL,
    chain_type character varying(10) NOT NULL,
    monitor_wallet character varying(200) NOT NULL,
    status smallint DEFAULT '1'::smallint NOT NULL,
    bot_rid integer,
    tg_notice_obj character varying(200) DEFAULT NULL::character varying,
    balance_alert numeric(14,2) DEFAULT 0.00 NOT NULL,
    balance_amount numeric(14,2) DEFAULT 0.00 NOT NULL,
    comments character varying(100) DEFAULT NULL::character varying,
    create_time timestamp without time zone,
    update_time timestamp without time zone,
    monitor_trx_transaction character(2) DEFAULT 'NN'::bpchar NOT NULL,
    monitor_approve_transaction character(2) DEFAULT 'NN'::bpchar NOT NULL,
    monitor_multi_transaction character(2) DEFAULT 'NN'::bpchar NOT NULL,
    monitor_pledge_transaction character(2) DEFAULT 'NN'::bpchar NOT NULL,
    monitor_usdt_transaction character(2) DEFAULT 'YY'::bpchar NOT NULL
);

CREATE SEQUENCE public.t_monitor_wallet_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_monitor_wallet_rid_seq OWNED BY public.t_monitor_wallet.rid;

CREATE TABLE public.t_permissions (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    guard_name character varying(255) DEFAULT 'web'::character varying NOT NULL,
    created_at timestamp without time zone,
    updated_at timestamp without time zone,
    route character varying(255) DEFAULT NULL::character varying,
    pid integer
);

CREATE SEQUENCE public.t_permissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_permissions_id_seq OWNED BY public.t_permissions.id;

CREATE TABLE public.t_premium_platform (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    platform_name smallint NOT NULL,
    tg_admin_uid character varying(500) DEFAULT NULL::character varying,
    platform_hash character varying(500) DEFAULT NULL::character varying,
    platform_cookie character varying(3000) DEFAULT NULL::character varying,
    platform_phrase character varying(3000) DEFAULT NULL::character varying,
    status smallint DEFAULT '1'::smallint NOT NULL,
    receive_wallet character varying(100) DEFAULT NULL::character varying,
    get_tx_time timestamp without time zone,
    tg_notice_obj_receive character varying(200) DEFAULT NULL::character varying,
    tg_notice_obj_send character varying(200) DEFAULT NULL::character varying,
    comments character varying(255) DEFAULT NULL::character varying,
    create_time timestamp without time zone NOT NULL,
    update_time timestamp without time zone
);

CREATE TABLE public.t_premium_platform_order (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    premium_platform_rid integer NOT NULL,
    source_type smallint DEFAULT '1'::smallint NOT NULL,
    buy_tg_uid character varying(100) NOT NULL,
    buy_tg_username character varying(100) DEFAULT NULL::character varying,
    premium_tg_username character varying(100) NOT NULL,
    need_pay_usdt numeric(12,4) NOT NULL,
    status smallint DEFAULT '0'::smallint NOT NULL,
    premium_platform_package_rid integer NOT NULL,
    premium_package_month integer NOT NULL,
    comments character varying(255) DEFAULT NULL::character varying,
    create_time timestamp without time zone NOT NULL,
    update_time timestamp without time zone,
    expire_time timestamp without time zone NOT NULL,
    cancel_time timestamp without time zone,
    complete_time timestamp without time zone,
    recipient character varying(1000) DEFAULT NULL::character varying,
    tx_hash character varying(200) DEFAULT NULL::character varying,
    tg_notice_user character(1) DEFAULT 'N'::bpchar NOT NULL,
    tg_notice_admin character(1) DEFAULT 'N'::bpchar NOT NULL
);

CREATE SEQUENCE public.t_premium_platform_order_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_premium_platform_order_rid_seq OWNED BY public.t_premium_platform_order.rid;

CREATE TABLE public.t_premium_platform_package (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    premium_platform_rid integer NOT NULL,
    package_name character varying(50) NOT NULL,
    package_month integer NOT NULL,
    usdt_price numeric(14,2) NOT NULL,
    callback_data character varying(50) NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    status smallint DEFAULT '1'::smallint NOT NULL,
    show_notes character varying(1000) DEFAULT NULL::character varying,
    package_pic character varying(200) DEFAULT NULL::character varying,
    comments character varying(255) DEFAULT NULL::character varying,
    create_time timestamp without time zone NOT NULL,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_premium_platform_package_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_premium_platform_package_rid_seq OWNED BY public.t_premium_platform_package.rid;

CREATE SEQUENCE public.t_premium_platform_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_premium_platform_rid_seq OWNED BY public.t_premium_platform.rid;

CREATE TABLE public.t_premium_wallet_trade_list (
    rid integer NOT NULL,
    tx_hash character varying(100) NOT NULL,
    transferfrom_address character varying(200) NOT NULL,
    transferto_address character varying(200) NOT NULL,
    coin_name character varying(20) NOT NULL,
    amount character varying(100) NOT NULL,
    "timestamp" character varying(20) NOT NULL,
    process_status smallint DEFAULT '0'::smallint NOT NULL,
    process_time timestamp without time zone,
    process_comments character varying(255) DEFAULT NULL::character varying,
    get_time timestamp without time zone,
    tg_notice_status_receive character(1) DEFAULT 'N'::bpchar NOT NULL,
    tg_notice_status_send character(1) DEFAULT 'N'::bpchar NOT NULL,
    platform_order_rid integer,
    premium_package_rid integer,
    premium_platform_rid integer
);

CREATE SEQUENCE public.t_premium_wallet_trade_list_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_premium_wallet_trade_list_rid_seq OWNED BY public.t_premium_wallet_trade_list.rid;

CREATE TABLE public.t_role_has_permissions (
    permission_id bigint NOT NULL,
    role_id bigint NOT NULL
);

CREATE TABLE public.t_roles (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    guard_name character varying(255) DEFAULT 'web'::character varying NOT NULL,
    created_at timestamp without time zone,
    updated_at timestamp without time zone
);

CREATE SEQUENCE public.t_roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_roles_id_seq OWNED BY public.t_roles.id;

CREATE TABLE public.t_shop_goods (
    rid integer NOT NULL,
    goods_name character varying(50) NOT NULL,
    goods_type smallint NOT NULL,
    goods_usdt_price numeric(16,4) DEFAULT 0.0000 NOT NULL,
    goods_trx_price numeric(16,4) DEFAULT 0.0000 NOT NULL,
    show_notes character varying(1000) DEFAULT NULL::character varying,
    status smallint DEFAULT '1'::smallint NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    comments character varying(3000) DEFAULT NULL::character varying,
    create_time timestamp without time zone NOT NULL,
    update_time timestamp without time zone
);

CREATE TABLE public.t_shop_goods_bot (
    rid integer NOT NULL,
    goods_rid integer NOT NULL,
    bot_rid integer NOT NULL,
    goods_usdt_discount numeric(4,2) DEFAULT 1.00 NOT NULL,
    goods_trx_discount numeric(4,2) DEFAULT 1.00 NOT NULL,
    status smallint DEFAULT '1'::smallint NOT NULL,
    comments character varying(3000) DEFAULT NULL::character varying,
    create_time timestamp without time zone NOT NULL,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_shop_goods_bot_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_shop_goods_bot_rid_seq OWNED BY public.t_shop_goods_bot.rid;

CREATE TABLE public.t_shop_goods_cdkey (
    rid integer NOT NULL,
    goods_rid integer NOT NULL,
    cdkey_no character varying(100) NOT NULL,
    cdkey_pwd character varying(2000) NOT NULL,
    cdkey_usdt_price numeric(16,4) DEFAULT 0.0000 NOT NULL,
    cdkey_trx_price numeric(16,4) DEFAULT 0.0000 NOT NULL,
    status smallint DEFAULT '0'::smallint NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    create_time timestamp without time zone NOT NULL,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_shop_goods_cdkey_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_shop_goods_cdkey_rid_seq OWNED BY public.t_shop_goods_cdkey.rid;

CREATE SEQUENCE public.t_shop_goods_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_shop_goods_rid_seq OWNED BY public.t_shop_goods.rid;

CREATE TABLE public.t_shop_order (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid character varying(50) NOT NULL,
    tg_username character varying(100) DEFAULT NULL::character varying,
    cdkey_no character varying(100) DEFAULT NULL::character varying,
    cdkey_pwd character varying(2000) DEFAULT NULL::character varying,
    pay_type smallint NOT NULL,
    pay_price character varying(50) DEFAULT NULL::character varying,
    comments character varying(3000) DEFAULT NULL::character varying,
    pay_time timestamp without time zone
);

CREATE SEQUENCE public.t_shop_order_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_shop_order_rid_seq OWNED BY public.t_shop_order.rid;

CREATE TABLE public.t_sys_admin_opt_log (
    rid integer NOT NULL,
    admin_id integer NOT NULL,
    opt_module character varying(200) DEFAULT NULL::character varying,
    opt_ref_sn character varying(100) DEFAULT NULL::character varying,
    opt_time timestamp without time zone,
    opt_content text
);

CREATE SEQUENCE public.t_sys_admin_opt_log_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_sys_admin_opt_log_rid_seq OWNED BY public.t_sys_admin_opt_log.rid;

CREATE TABLE public.t_sys_config (
    rid integer NOT NULL,
    config_key character varying(50) NOT NULL,
    config_val character varying(500) NOT NULL,
    comments character varying(255) NOT NULL,
    create_by character varying(50) DEFAULT NULL::character varying,
    create_time timestamp without time zone,
    update_by character varying(50) DEFAULT NULL::character varying,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_sys_config_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_sys_config_rid_seq OWNED BY public.t_sys_config.rid;

CREATE TABLE public.t_sys_data_dictionary (
    rid integer NOT NULL,
    dic_key character varying(100) NOT NULL,
    dic_value character varying(500) NOT NULL,
    dic_name character varying(200) DEFAULT NULL::character varying,
    create_time timestamp without time zone,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_sys_data_dictionary_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_sys_data_dictionary_rid_seq OWNED BY public.t_sys_data_dictionary.rid;

CREATE TABLE public.t_telegram_bot (
    rid integer NOT NULL,
    bot_token character varying(100) NOT NULL,
    bot_admin_username character varying(100) DEFAULT '-'::character varying,
    bot_firstname character varying(100) DEFAULT NULL::character varying,
    bot_username character varying(100) DEFAULT NULL::character varying,
    comments character varying(255) DEFAULT NULL::character varying,
    create_by integer,
    create_time timestamp without time zone,
    update_by integer,
    update_time timestamp without time zone,
    recharge_wallet_addr character varying(100) DEFAULT NULL::character varying,
    get_tx_time timestamp without time zone,
    last_update_id bigint DEFAULT 0
);

CREATE TABLE public.t_telegram_bot_ad (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    notice_cycle smallint DEFAULT '1'::smallint NOT NULL,
    notice_obj character varying(200) NOT NULL,
    notice_photo character varying(500) DEFAULT NULL::character varying,
    notice_ad character varying(2000) NOT NULL,
    status smallint DEFAULT '1'::smallint NOT NULL,
    last_notice_time timestamp without time zone,
    create_by integer,
    create_time timestamp without time zone,
    update_by integer,
    update_time timestamp without time zone
);

CREATE TABLE public.t_telegram_bot_ad_keyboard (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    ad_rid integer NOT NULL,
    keyboard_rid integer NOT NULL,
    create_by integer,
    create_time timestamp without time zone,
    update_by integer,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_telegram_bot_ad_keyboard_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_telegram_bot_ad_keyboard_rid_seq OWNED BY public.t_telegram_bot_ad_keyboard.rid;

CREATE SEQUENCE public.t_telegram_bot_ad_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_telegram_bot_ad_rid_seq OWNED BY public.t_telegram_bot_ad.rid;

CREATE TABLE public.t_telegram_bot_command (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    command character varying(50) NOT NULL,
    description character varying(100) NOT NULL,
    command_type smallint DEFAULT '1'::smallint NOT NULL,
    seq_sn integer DEFAULT 0 NOT NULL,
    create_by integer,
    create_time timestamp without time zone,
    update_by integer,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_telegram_bot_command_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_telegram_bot_command_rid_seq OWNED BY public.t_telegram_bot_command.rid;

CREATE TABLE public.t_telegram_bot_group (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    group_type character varying(50) NOT NULL,
    tg_groupid bigint NOT NULL,
    tg_groupusername character varying(200) DEFAULT NULL::character varying,
    tg_groupnickname character varying(200) DEFAULT NULL::character varying,
    status smallint DEFAULT 1 NOT NULL,
    is_admin character varying(1) DEFAULT 'N'::character varying,
    first_time timestamp without time zone,
    last_time timestamp without time zone,
    stop_time timestamp without time zone,
    follow_count integer DEFAULT 0
);

CREATE SEQUENCE public.t_telegram_bot_group_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_telegram_bot_group_rid_seq OWNED BY public.t_telegram_bot_group.rid;

CREATE TABLE public.t_telegram_bot_keyboard (
    rid integer NOT NULL,
    keyboard_type smallint DEFAULT '1'::smallint NOT NULL,
    keyboard_name character varying(20) NOT NULL,
    keyboard_icon_custom_emoji_id character varying(64),
    inline_type smallint DEFAULT '0'::smallint NOT NULL,
    keyboard_value character varying(500) NOT NULL,
    status smallint DEFAULT '0'::smallint NOT NULL,
    create_by integer,
    create_time timestamp without time zone,
    update_by integer,
    update_time timestamp without time zone,
    seq_sn integer DEFAULT 0 NOT NULL
);

CREATE SEQUENCE public.t_telegram_bot_keyboard_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_telegram_bot_keyboard_rid_seq OWNED BY public.t_telegram_bot_keyboard.rid;

CREATE TABLE public.t_telegram_bot_keyreply (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    key_type smallint NOT NULL,
    monitor_word character varying(500) NOT NULL,
    reply_photo character varying(300) DEFAULT NULL::character varying,
    reply_content character varying(2000) NOT NULL,
    opt_type integer NOT NULL,
    status smallint DEFAULT '0'::smallint NOT NULL,
    create_by integer,
    create_time timestamp without time zone,
    update_by integer,
    update_time timestamp without time zone
);

CREATE TABLE public.t_telegram_bot_keyreply_keyboard (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    keyreply_rid integer NOT NULL,
    keyboard_rid integer NOT NULL,
    create_by integer,
    create_time timestamp without time zone,
    update_by integer,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_telegram_bot_keyreply_keyboard_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_telegram_bot_keyreply_keyboard_rid_seq OWNED BY public.t_telegram_bot_keyreply_keyboard.rid;

CREATE SEQUENCE public.t_telegram_bot_keyreply_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_telegram_bot_keyreply_rid_seq OWNED BY public.t_telegram_bot_keyreply.rid;

CREATE SEQUENCE public.t_telegram_bot_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_telegram_bot_rid_seq OWNED BY public.t_telegram_bot.rid;

CREATE TABLE public.t_telegram_bot_user (
    rid integer NOT NULL,
    bot_rid integer NOT NULL,
    tg_uid bigint NOT NULL,
    tg_username character varying(200) DEFAULT NULL::character varying,
    tg_nickname character varying(200) DEFAULT NULL::character varying,
    status smallint DEFAULT 1 NOT NULL,
    bind_trc_wallet_addr character varying(200) DEFAULT NULL::character varying,
    first_time timestamp without time zone,
    last_time timestamp without time zone,
    stop_time timestamp without time zone,
    cash_trx numeric(20,6) DEFAULT 0 NOT NULL,
    cash_usdt numeric(20,6) DEFAULT 0 NOT NULL,
    max_monitor_wallet integer DEFAULT 0 NOT NULL
);

CREATE SEQUENCE public.t_telegram_bot_user_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_telegram_bot_user_rid_seq OWNED BY public.t_telegram_bot_user.rid;

CREATE TABLE public.t_transit_user_wallet (
    rid integer NOT NULL,
    chain_type character varying(10) NOT NULL,
    wallet_addr character varying(200) NOT NULL,
    total_transit_usdt character varying(200) DEFAULT '0'::character varying NOT NULL,
    total_transit_sxf character varying(200) DEFAULT '0'::character varying NOT NULL,
    total_yuzhi_sxf character varying(200) DEFAULT '0'::character varying NOT NULL,
    need_feedback_sxf character varying(200) DEFAULT '0'::character varying NOT NULL,
    send_feedback_sxf character varying(200) DEFAULT '0'::character varying NOT NULL,
    last_transit_time timestamp without time zone,
    last_yuzhi_time timestamp without time zone
);

CREATE SEQUENCE public.t_transit_user_wallet_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_transit_user_wallet_rid_seq OWNED BY public.t_transit_user_wallet.rid;

CREATE TABLE public.t_transit_wallet (
    rid integer NOT NULL,
    chain_type character varying(10) NOT NULL,
    receive_wallet character varying(200) NOT NULL,
    send_wallet character varying(200) NOT NULL,
    send_wallet_privatekey character varying(2000) DEFAULT NULL::character varying,
    show_notes character varying(500) DEFAULT NULL::character varying,
    status smallint DEFAULT '1'::smallint NOT NULL,
    tg_notice_obj_receive character varying(200) DEFAULT NULL::character varying,
    tg_notice_obj_send character varying(200) DEFAULT NULL::character varying,
    get_tx_time timestamp without time zone,
    create_time timestamp without time zone,
    update_time timestamp without time zone,
    bot_rid integer,
    auto_stock_min_trx integer DEFAULT 0 NOT NULL,
    auto_stock_per_usdt integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.t_transit_wallet_black (
    rid integer NOT NULL,
    chain_type character varying(10) NOT NULL,
    black_wallet character varying(200) NOT NULL,
    comments character varying(255) DEFAULT NULL::character varying,
    create_time timestamp without time zone,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_transit_wallet_black_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_transit_wallet_black_rid_seq OWNED BY public.t_transit_wallet_black.rid;

CREATE TABLE public.t_transit_wallet_coin (
    rid integer NOT NULL,
    transit_wallet_id integer NOT NULL,
    in_coin_name character varying(20) NOT NULL,
    out_coin_name character varying(20) NOT NULL,
    is_realtime_rate smallint DEFAULT '1'::smallint NOT NULL,
    profit_rate numeric(4,2) DEFAULT 1.00 NOT NULL,
    exchange_rate numeric(8,2) DEFAULT 0.00 NOT NULL,
    kou_out_amount numeric(8,2) DEFAULT 0.00 NOT NULL,
    min_transit_amount integer NOT NULL,
    max_transit_amount integer NOT NULL,
    comments character varying(255) DEFAULT NULL::character varying,
    create_by integer,
    create_time timestamp without time zone,
    update_by integer,
    update_time timestamp without time zone
);

CREATE SEQUENCE public.t_transit_wallet_coin_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_transit_wallet_coin_rid_seq OWNED BY public.t_transit_wallet_coin.rid;

CREATE SEQUENCE public.t_transit_wallet_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_transit_wallet_rid_seq OWNED BY public.t_transit_wallet.rid;

CREATE TABLE public.t_transit_wallet_trade_list (
    rid integer NOT NULL,
    tx_hash character varying(100) NOT NULL,
    transferfrom_address character varying(200) NOT NULL,
    transferto_address character varying(200) NOT NULL,
    coin_name character varying(20) NOT NULL,
    amount character varying(100) NOT NULL,
    "timestamp" character varying(20) NOT NULL,
    process_status smallint DEFAULT '0'::smallint NOT NULL,
    process_time timestamp without time zone,
    process_comments character varying(255) DEFAULT NULL::character varying,
    get_time timestamp without time zone,
    sendback_address character varying(200) DEFAULT NULL::character varying,
    sendback_amount character varying(100) DEFAULT '0'::character varying NOT NULL,
    sendback_time timestamp without time zone,
    sendback_coin_name character varying(20) DEFAULT NULL::character varying,
    sendback_tx_hash character varying(100) DEFAULT NULL::character varying,
    sendback_contract_ret character varying(20) DEFAULT NULL::character varying,
    tg_notice_status_receive character(1) DEFAULT 'N'::bpchar NOT NULL,
    tg_notice_status_send character(1) DEFAULT 'N'::bpchar NOT NULL,
    current_exchange_rate numeric(8,2) DEFAULT 0.00 NOT NULL,
    current_huan_yuzhi_amount numeric(14,2) DEFAULT 0.00 NOT NULL
);

CREATE SEQUENCE public.t_transit_wallet_trade_list_rid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.t_transit_wallet_trade_list_rid_seq OWNED BY public.t_transit_wallet_trade_list.rid;

ALTER TABLE ONLY public.t_admin ALTER COLUMN id SET DEFAULT nextval('public.t_admin_id_seq'::regclass);

ALTER TABLE ONLY public.t_admin_login_log ALTER COLUMN rid SET DEFAULT nextval('public.t_admin_login_log_rid_seq'::regclass);

ALTER TABLE ONLY public.t_bind_a_send_n_binding ALTER COLUMN rid SET DEFAULT nextval('public.t_bind_a_send_n_binding_rid_seq'::regclass);

ALTER TABLE ONLY public.t_bind_a_send_n_config ALTER COLUMN rid SET DEFAULT nextval('public.t_bind_a_send_n_config_rid_seq'::regclass);

ALTER TABLE ONLY public.t_bind_a_send_n_grant ALTER COLUMN rid SET DEFAULT nextval('public.t_bind_a_send_n_grant_rid_seq'::regclass);

ALTER TABLE ONLY public.t_collection_wallet ALTER COLUMN rid SET DEFAULT nextval('public.t_collection_wallet_rid_seq'::regclass);

ALTER TABLE ONLY public.t_collection_wallet_list ALTER COLUMN rid SET DEFAULT nextval('public.t_collection_wallet_list_rid_seq'::regclass);

ALTER TABLE ONLY public.t_energy_ai_bishu ALTER COLUMN rid SET DEFAULT nextval('public.t_energy_ai_bishu_rid_seq'::regclass);

ALTER TABLE ONLY public.t_energy_ai_trusteeship ALTER COLUMN rid SET DEFAULT nextval('public.t_energy_ai_trusteeship_rid_seq'::regclass);

ALTER TABLE ONLY public.t_energy_platform ALTER COLUMN rid SET DEFAULT nextval('public.t_energy_platform_rid_seq'::regclass);

ALTER TABLE ONLY public.t_energy_platform_bot ALTER COLUMN rid SET DEFAULT nextval('public.t_energy_platform_bot_rid_seq'::regclass);

ALTER TABLE ONLY public.t_energy_platform_order ALTER COLUMN rid SET DEFAULT nextval('public.t_energy_platform_order_rid_seq'::regclass);

ALTER TABLE ONLY public.t_energy_platform_package ALTER COLUMN rid SET DEFAULT nextval('public.t_energy_platform_package_rid_seq'::regclass);

ALTER TABLE ONLY public.t_energy_quick_order ALTER COLUMN rid SET DEFAULT nextval('public.t_energy_quick_order_rid_seq'::regclass);

ALTER TABLE ONLY public.t_energy_special ALTER COLUMN rid SET DEFAULT nextval('public.t_energy_special_rid_seq'::regclass);

ALTER TABLE ONLY public.t_energy_special_list ALTER COLUMN rid SET DEFAULT nextval('public.t_energy_special_list_rid_seq'::regclass);

ALTER TABLE ONLY public.t_energy_third_part ALTER COLUMN rid SET DEFAULT nextval('public.t_energy_third_part_rid_seq'::regclass);

ALTER TABLE ONLY public.t_energy_wallet_trade_list ALTER COLUMN rid SET DEFAULT nextval('public.t_energy_wallet_trade_list_rid_seq'::regclass);

ALTER TABLE ONLY public.t_fms_recharge_order ALTER COLUMN rid SET DEFAULT nextval('public.t_fms_recharge_order_rid_seq'::regclass);

ALTER TABLE ONLY public.t_fms_wallet_trade_list ALTER COLUMN rid SET DEFAULT nextval('public.t_fms_wallet_trade_list_rid_seq'::regclass);

ALTER TABLE ONLY public.t_monitor_bot ALTER COLUMN rid SET DEFAULT nextval('public.t_monitor_bot_rid_seq'::regclass);

ALTER TABLE ONLY public.t_monitor_wallet ALTER COLUMN rid SET DEFAULT nextval('public.t_monitor_wallet_rid_seq'::regclass);

ALTER TABLE ONLY public.t_permissions ALTER COLUMN id SET DEFAULT nextval('public.t_permissions_id_seq'::regclass);

ALTER TABLE ONLY public.t_premium_platform ALTER COLUMN rid SET DEFAULT nextval('public.t_premium_platform_rid_seq'::regclass);

ALTER TABLE ONLY public.t_premium_platform_order ALTER COLUMN rid SET DEFAULT nextval('public.t_premium_platform_order_rid_seq'::regclass);

ALTER TABLE ONLY public.t_premium_platform_package ALTER COLUMN rid SET DEFAULT nextval('public.t_premium_platform_package_rid_seq'::regclass);

ALTER TABLE ONLY public.t_premium_wallet_trade_list ALTER COLUMN rid SET DEFAULT nextval('public.t_premium_wallet_trade_list_rid_seq'::regclass);

ALTER TABLE ONLY public.t_roles ALTER COLUMN id SET DEFAULT nextval('public.t_roles_id_seq'::regclass);

ALTER TABLE ONLY public.t_shop_goods ALTER COLUMN rid SET DEFAULT nextval('public.t_shop_goods_rid_seq'::regclass);

ALTER TABLE ONLY public.t_shop_goods_bot ALTER COLUMN rid SET DEFAULT nextval('public.t_shop_goods_bot_rid_seq'::regclass);

ALTER TABLE ONLY public.t_shop_goods_cdkey ALTER COLUMN rid SET DEFAULT nextval('public.t_shop_goods_cdkey_rid_seq'::regclass);

ALTER TABLE ONLY public.t_shop_order ALTER COLUMN rid SET DEFAULT nextval('public.t_shop_order_rid_seq'::regclass);

ALTER TABLE ONLY public.t_sys_admin_opt_log ALTER COLUMN rid SET DEFAULT nextval('public.t_sys_admin_opt_log_rid_seq'::regclass);

ALTER TABLE ONLY public.t_sys_config ALTER COLUMN rid SET DEFAULT nextval('public.t_sys_config_rid_seq'::regclass);

ALTER TABLE ONLY public.t_sys_data_dictionary ALTER COLUMN rid SET DEFAULT nextval('public.t_sys_data_dictionary_rid_seq'::regclass);

ALTER TABLE ONLY public.t_telegram_bot ALTER COLUMN rid SET DEFAULT nextval('public.t_telegram_bot_rid_seq'::regclass);

ALTER TABLE ONLY public.t_telegram_bot_ad ALTER COLUMN rid SET DEFAULT nextval('public.t_telegram_bot_ad_rid_seq'::regclass);

ALTER TABLE ONLY public.t_telegram_bot_ad_keyboard ALTER COLUMN rid SET DEFAULT nextval('public.t_telegram_bot_ad_keyboard_rid_seq'::regclass);

ALTER TABLE ONLY public.t_telegram_bot_command ALTER COLUMN rid SET DEFAULT nextval('public.t_telegram_bot_command_rid_seq'::regclass);

ALTER TABLE ONLY public.t_telegram_bot_group ALTER COLUMN rid SET DEFAULT nextval('public.t_telegram_bot_group_rid_seq'::regclass);

ALTER TABLE ONLY public.t_telegram_bot_keyboard ALTER COLUMN rid SET DEFAULT nextval('public.t_telegram_bot_keyboard_rid_seq'::regclass);

ALTER TABLE ONLY public.t_telegram_bot_keyreply ALTER COLUMN rid SET DEFAULT nextval('public.t_telegram_bot_keyreply_rid_seq'::regclass);

ALTER TABLE ONLY public.t_telegram_bot_keyreply_keyboard ALTER COLUMN rid SET DEFAULT nextval('public.t_telegram_bot_keyreply_keyboard_rid_seq'::regclass);

ALTER TABLE ONLY public.t_telegram_bot_user ALTER COLUMN rid SET DEFAULT nextval('public.t_telegram_bot_user_rid_seq'::regclass);

ALTER TABLE ONLY public.t_transit_user_wallet ALTER COLUMN rid SET DEFAULT nextval('public.t_transit_user_wallet_rid_seq'::regclass);

ALTER TABLE ONLY public.t_transit_wallet ALTER COLUMN rid SET DEFAULT nextval('public.t_transit_wallet_rid_seq'::regclass);

ALTER TABLE ONLY public.t_transit_wallet_black ALTER COLUMN rid SET DEFAULT nextval('public.t_transit_wallet_black_rid_seq'::regclass);

ALTER TABLE ONLY public.t_transit_wallet_coin ALTER COLUMN rid SET DEFAULT nextval('public.t_transit_wallet_coin_rid_seq'::regclass);

ALTER TABLE ONLY public.t_transit_wallet_trade_list ALTER COLUMN rid SET DEFAULT nextval('public.t_transit_wallet_trade_list_rid_seq'::regclass);

ALTER TABLE ONLY public.t_admin_login_log
    ADD CONSTRAINT t_admin_login_log_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_admin
    ADD CONSTRAINT t_admin_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.t_bind_a_send_n_binding
    ADD CONSTRAINT t_bind_a_send_n_binding_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_bind_a_send_n_config
    ADD CONSTRAINT t_bind_a_send_n_config_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_bind_a_send_n_grant
    ADD CONSTRAINT t_bind_a_send_n_grant_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_collection_wallet_list
    ADD CONSTRAINT t_collection_wallet_list_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_collection_wallet
    ADD CONSTRAINT t_collection_wallet_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_energy_ai_bishu
    ADD CONSTRAINT t_energy_ai_bishu_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_energy_ai_trusteeship
    ADD CONSTRAINT t_energy_ai_trusteeship_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_energy_platform_bot
    ADD CONSTRAINT t_energy_platform_bot_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_energy_platform_order
    ADD CONSTRAINT t_energy_platform_order_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_energy_platform_package
    ADD CONSTRAINT t_energy_platform_package_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_energy_platform
    ADD CONSTRAINT t_energy_platform_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_energy_quick_order
    ADD CONSTRAINT t_energy_quick_order_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_energy_special_list
    ADD CONSTRAINT t_energy_special_list_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_energy_special
    ADD CONSTRAINT t_energy_special_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_energy_third_part
    ADD CONSTRAINT t_energy_third_part_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_energy_wallet_trade_list
    ADD CONSTRAINT t_energy_wallet_trade_list_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_fms_recharge_order
    ADD CONSTRAINT t_fms_recharge_order_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_fms_wallet_trade_list
    ADD CONSTRAINT t_fms_wallet_trade_list_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_model_has_permissions
    ADD CONSTRAINT t_model_has_permissions_pkey PRIMARY KEY (permission_id, model_id, model_type);

ALTER TABLE ONLY public.t_model_has_roles
    ADD CONSTRAINT t_model_has_roles_pkey PRIMARY KEY (role_id, model_id, model_type);

ALTER TABLE ONLY public.t_monitor_bot
    ADD CONSTRAINT t_monitor_bot_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_monitor_wallet
    ADD CONSTRAINT t_monitor_wallet_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_permissions
    ADD CONSTRAINT t_permissions_name_guard_name_key UNIQUE (name, guard_name);

ALTER TABLE ONLY public.t_permissions
    ADD CONSTRAINT t_permissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.t_premium_platform_order
    ADD CONSTRAINT t_premium_platform_order_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_premium_platform_package
    ADD CONSTRAINT t_premium_platform_package_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_premium_platform
    ADD CONSTRAINT t_premium_platform_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_premium_wallet_trade_list
    ADD CONSTRAINT t_premium_wallet_trade_list_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_role_has_permissions
    ADD CONSTRAINT t_role_has_permissions_pkey PRIMARY KEY (permission_id, role_id);

ALTER TABLE ONLY public.t_roles
    ADD CONSTRAINT t_roles_name_guard_name_key UNIQUE (name, guard_name);

ALTER TABLE ONLY public.t_roles
    ADD CONSTRAINT t_roles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.t_shop_goods_bot
    ADD CONSTRAINT t_shop_goods_bot_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_shop_goods_cdkey
    ADD CONSTRAINT t_shop_goods_cdkey_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_shop_goods
    ADD CONSTRAINT t_shop_goods_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_shop_order
    ADD CONSTRAINT t_shop_order_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_sys_admin_opt_log
    ADD CONSTRAINT t_sys_admin_opt_log_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_sys_config
    ADD CONSTRAINT t_sys_config_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_sys_data_dictionary
    ADD CONSTRAINT t_sys_data_dictionary_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_telegram_bot_ad_keyboard
    ADD CONSTRAINT t_telegram_bot_ad_keyboard_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_telegram_bot_ad
    ADD CONSTRAINT t_telegram_bot_ad_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_telegram_bot_command
    ADD CONSTRAINT t_telegram_bot_command_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_telegram_bot_group
    ADD CONSTRAINT t_telegram_bot_group_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_telegram_bot_keyboard
    ADD CONSTRAINT t_telegram_bot_keyboard_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_telegram_bot_keyreply_keyboard
    ADD CONSTRAINT t_telegram_bot_keyreply_keyboard_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_telegram_bot_keyreply
    ADD CONSTRAINT t_telegram_bot_keyreply_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_telegram_bot
    ADD CONSTRAINT t_telegram_bot_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_telegram_bot_user
    ADD CONSTRAINT t_telegram_bot_user_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_transit_user_wallet
    ADD CONSTRAINT t_transit_user_wallet_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_transit_wallet_black
    ADD CONSTRAINT t_transit_wallet_black_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_transit_wallet_coin
    ADD CONSTRAINT t_transit_wallet_coin_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_transit_wallet
    ADD CONSTRAINT t_transit_wallet_pkey PRIMARY KEY (rid);

ALTER TABLE ONLY public.t_transit_wallet_trade_list
    ADD CONSTRAINT t_transit_wallet_trade_list_pkey PRIMARY KEY (rid);

CREATE INDEX IF NOT EXISTS idx_energy_third_part_1 ON public.t_energy_third_part USING btree (tg_uid);

CREATE UNIQUE INDEX IF NOT EXISTS t_energy_wallet_trade_list_tx_hash_uindex ON public.t_energy_wallet_trade_list USING btree (tx_hash);

CREATE INDEX IF NOT EXISTS idx_energy_ai_bishu_is_active ON public.t_energy_ai_bishu (is_active);

CREATE INDEX IF NOT EXISTS idx_energy_ai_bishu_last_energy ON public.t_energy_ai_bishu (last_energy_time) WHERE last_energy_time IS NOT NULL;

DO $$
BEGIN



  IF to_regclass('public.transit_wallet') IS NULL THEN
    EXECUTE 'CREATE VIEW public.transit_wallet AS SELECT * FROM public.t_transit_wallet';
  END IF;

  IF to_regclass('public.transit_wallet_black') IS NULL THEN
    EXECUTE 'CREATE VIEW public.transit_wallet_black AS SELECT * FROM public.t_transit_wallet_black';
  END IF;

  IF to_regclass('public.transit_wallet_coin') IS NULL THEN
    EXECUTE 'CREATE VIEW public.transit_wallet_coin AS SELECT * FROM public.t_transit_wallet_coin';
  END IF;

  IF to_regclass('public.transit_wallet_trade_list') IS NULL THEN
    EXECUTE 'CREATE VIEW public.transit_wallet_trade_list AS SELECT * FROM public.t_transit_wallet_trade_list';
  END IF;

  IF to_regclass('public.transit_user_wallet') IS NULL THEN
    EXECUTE 'CREATE VIEW public.transit_user_wallet AS SELECT * FROM public.t_transit_user_wallet';
  END IF;



  IF to_regclass('public.monitor_wallet') IS NULL THEN
    EXECUTE 'CREATE VIEW public.monitor_wallet AS SELECT * FROM public.t_monitor_wallet';
  END IF;



  IF to_regclass('public.collection_wallet') IS NULL THEN
    EXECUTE 'CREATE VIEW public.collection_wallet AS SELECT * FROM public.t_collection_wallet';
  END IF;

  IF to_regclass('public.collection_wallet_list') IS NULL THEN
    EXECUTE 'CREATE VIEW public.collection_wallet_list AS SELECT * FROM public.t_collection_wallet_list';
  END IF;



  IF to_regclass('public.premium_platform') IS NULL THEN
    EXECUTE 'CREATE VIEW public.premium_platform AS SELECT * FROM public.t_premium_platform';
  END IF;

  IF to_regclass('public.premium_platform_order') IS NULL THEN
    EXECUTE 'CREATE VIEW public.premium_platform_order AS SELECT * FROM public.t_premium_platform_order';
  END IF;

  IF to_regclass('public.premium_platform_package') IS NULL THEN
    EXECUTE 'CREATE VIEW public.premium_platform_package AS SELECT * FROM public.t_premium_platform_package';
  END IF;

  IF to_regclass('public.premium_wallet_trade_list') IS NULL THEN
    EXECUTE 'CREATE VIEW public.premium_wallet_trade_list AS SELECT * FROM public.t_premium_wallet_trade_list';
  END IF;



  IF to_regclass('public.fms_recharge_order') IS NULL THEN
    EXECUTE 'CREATE VIEW public.fms_recharge_order AS SELECT * FROM public.t_fms_recharge_order';
  END IF;

  IF to_regclass('public.fms_wallet_trade_list') IS NULL THEN
    EXECUTE 'CREATE VIEW public.fms_wallet_trade_list AS SELECT * FROM public.t_fms_wallet_trade_list';
  END IF;



  IF to_regclass('public.telegram_bot_ad') IS NULL THEN
    EXECUTE 'CREATE VIEW public.telegram_bot_ad AS SELECT * FROM public.t_telegram_bot_ad';
  END IF;

  IF to_regclass('public.telegram_bot_ad_keyboard') IS NULL THEN
    EXECUTE 'CREATE VIEW public.telegram_bot_ad_keyboard AS SELECT * FROM public.t_telegram_bot_ad_keyboard';
  END IF;

  IF to_regclass('public.telegram_bot_user') IS NULL THEN
    EXECUTE 'CREATE VIEW public.telegram_bot_user AS SELECT * FROM public.t_telegram_bot_user';
  END IF;



  IF to_regclass('public.energy_platform_package') IS NULL THEN
    EXECUTE 'CREATE VIEW public.energy_platform_package AS SELECT * FROM public.t_energy_platform_package';
  END IF;
END $$;

CREATE TABLE public.t_telegram_bot_moderation_config (
    bot_rid integer PRIMARY KEY,
    support_enabled boolean NOT NULL DEFAULT false,
    support_chat_id bigint,
    support_captcha_enabled boolean NOT NULL DEFAULT true,
    support_verified_minutes integer NOT NULL DEFAULT 1440,
    ad_score_threshold smallint NOT NULL DEFAULT 4,
    ad_keywords text,
    create_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.t_telegram_bot_group_policy (
    rid bigserial PRIMARY KEY,
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
    ad_action character varying(20) NOT NULL DEFAULT 'verify',
    ad_restrict_duration_seconds integer NOT NULL DEFAULT 3600,
    verification_timeout_seconds integer NOT NULL DEFAULT 180,
    ad_verification_timeout_seconds integer NOT NULL DEFAULT 1800,
    rate_limit_count smallint NOT NULL DEFAULT 6,
    rate_limit_window_seconds smallint NOT NULL DEFAULT 10,
    create_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT t_telegram_bot_group_policy_bot_group_unique UNIQUE (bot_rid, tg_groupid)
);

CREATE TABLE public.t_telegram_group_message_history (
    rid bigserial PRIMARY KEY,
    bot_rid integer NOT NULL,
    chat_id bigint NOT NULL,
    message_id bigint NOT NULL,
    user_id bigint,
    message_date timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    message_text text,
    message_json jsonb NOT NULL,
    create_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT t_telegram_group_message_history_unique UNIQUE (bot_rid, chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_group_message_history_recent
    ON public.t_telegram_group_message_history (bot_rid, chat_id, message_date DESC);

CREATE TABLE public.t_telegram_moderated_member (
    rid bigserial PRIMARY KEY,
    bot_rid integer NOT NULL,
    chat_id bigint NOT NULL,
    user_id bigint NOT NULL,
    action character varying(30) NOT NULL,
    restricted_until timestamp without time zone,
    status character varying(20) NOT NULL DEFAULT 'active',
    create_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT t_telegram_moderated_member_bot_chat_user_unique UNIQUE (bot_rid, chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_moderated_member_active
    ON public.t_telegram_moderated_member (status, restricted_until, update_time DESC);

CREATE TABLE public.t_telegram_verification (
    rid bigserial PRIMARY KEY,
    token_hash character varying(64) NOT NULL UNIQUE,
    verification_type character varying(30) NOT NULL,
    bot_rid integer NOT NULL,
    chat_id bigint,
    user_id bigint NOT NULL,
    user_chat_id bigint,
    verification_message_id bigint,
    mini_app_message_id bigint,
    status character varying(20) NOT NULL DEFAULT 'pending',
    expires_at timestamp without time zone NOT NULL,
    verified_at timestamp without time zone,
    create_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.t_telegram_support_message (
    rid bigserial PRIMARY KEY,
    bot_rid integer NOT NULL,
    user_id bigint NOT NULL,
    support_chat_id bigint NOT NULL,
    user_message_id bigint,
    support_message_id bigint,
    direction character varying(20) NOT NULL,
    is_ad boolean NOT NULL DEFAULT false,
    create_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.t_telegram_moderation_log (
    rid bigserial PRIMARY KEY,
    bot_rid integer NOT NULL,
    chat_id bigint,
    user_id bigint,
    message_id bigint,
    event_type character varying(40) NOT NULL,
    action character varying(30) NOT NULL,
    score smallint NOT NULL DEFAULT 0,
    reasons text,
    content_preview character varying(500),
    create_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telegram_verification_lookup ON public.t_telegram_verification (bot_rid, user_id, verification_type, status);

CREATE INDEX IF NOT EXISTS idx_telegram_verification_expiry ON public.t_telegram_verification (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_telegram_support_reply ON public.t_telegram_support_message (bot_rid, support_chat_id, support_message_id);

CREATE INDEX IF NOT EXISTS idx_telegram_moderation_log_recent ON public.t_telegram_moderation_log (bot_rid, create_time DESC);

CREATE TABLE public.t_telegram_clone_proxy_config (
    rid bigserial PRIMARY KEY,
    master_bot_rid integer NOT NULL,
    is_enable smallint NOT NULL DEFAULT 0,
    charge_enable smallint NOT NULL DEFAULT 0,
    merchant_limit integer NOT NULL DEFAULT 0,
    open_price numeric(20,6) NOT NULL DEFAULT 0,
    default_revenue_ratio numeric(7,2) NOT NULL DEFAULT 0,
    create_time timestamp without time zone,
    update_time timestamp without time zone
);

CREATE TABLE public.t_telegram_clone_proxy_merchant (
    rid bigserial PRIMARY KEY,
    master_bot_rid integer NOT NULL,
    bot_rid integer NOT NULL,
    owner_tg_uid bigint NOT NULL,
    owner_tg_username character varying(200) NOT NULL,
    owner_tg_name character varying(200) DEFAULT NULL::character varying,
    bot_token_hash character varying(64) NOT NULL,
    revenue_ratio numeric(7,2) NOT NULL DEFAULT 0,
    status smallint NOT NULL DEFAULT 1,
    total_revenue_usdt numeric(20,6) NOT NULL DEFAULT 0,
    total_revenue_trx numeric(20,6) NOT NULL DEFAULT 0,
    webhook_status smallint NOT NULL DEFAULT 0,
    webhook_error character varying(500) DEFAULT NULL::character varying,
    create_time timestamp without time zone,
    update_time timestamp without time zone
);

CREATE TABLE public.t_telegram_clone_proxy_order (
    rid bigserial PRIMARY KEY,
    merchant_rid bigint,
    master_bot_rid integer NOT NULL,
    bot_rid integer,
    order_type character varying(30) NOT NULL,
    source_type character varying(30) NOT NULL DEFAULT 'manual',
    source_order_rid bigint,
    pay_user_tg_uid bigint NOT NULL,
    pay_user_tg_username character varying(200) DEFAULT NULL::character varying,
    amount numeric(20,6) NOT NULL DEFAULT 0,
    need_pay_amount numeric(20,6) NOT NULL DEFAULT 0,
    coin_name character varying(20) NOT NULL DEFAULT 'usdt'::character varying,
    payment_method character varying(20) NOT NULL DEFAULT 'free'::character varying,
    status smallint NOT NULL DEFAULT 0,
    revenue_ratio numeric(7,2) NOT NULL DEFAULT 0,
    revenue_amount numeric(20,6) NOT NULL DEFAULT 0,
    external_order_rid bigint,
    tx_hash character varying(200) DEFAULT NULL::character varying,
    comments character varying(1000) DEFAULT NULL::character varying,
    create_time timestamp without time zone,
    update_time timestamp without time zone,
    paid_time timestamp without time zone,
    expire_time timestamp without time zone,
    complete_time timestamp without time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_clone_proxy_config_master
    ON public.t_telegram_clone_proxy_config (master_bot_rid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_clone_proxy_merchant_bot
    ON public.t_telegram_clone_proxy_merchant (bot_rid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_clone_proxy_merchant_owner
    ON public.t_telegram_clone_proxy_merchant (master_bot_rid, owner_tg_uid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_clone_proxy_merchant_token
    ON public.t_telegram_clone_proxy_merchant (bot_token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_clone_proxy_source_order
    ON public.t_telegram_clone_proxy_order (source_type, source_order_rid)
    WHERE source_order_rid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_clone_proxy_opening_pending_user
    ON public.t_telegram_clone_proxy_order (master_bot_rid, pay_user_tg_uid)
    WHERE order_type = 'opening' AND status IN (0, 1);

CREATE INDEX IF NOT EXISTS idx_telegram_clone_proxy_merchant_status
    ON public.t_telegram_clone_proxy_merchant (master_bot_rid, status, create_time DESC);

CREATE INDEX IF NOT EXISTS idx_telegram_clone_proxy_order_merchant_type
    ON public.t_telegram_clone_proxy_order (merchant_rid, order_type, status, create_time DESC);

CREATE INDEX IF NOT EXISTS idx_telegram_clone_proxy_order_opening_user
    ON public.t_telegram_clone_proxy_order (master_bot_rid, pay_user_tg_uid, order_type, status);

DO $$
BEGIN
    PERFORM * FROM pg_extension WHERE extname = 'pg_row_security';
    IF FOUND THEN
        EXECUTE format('ALTER TABLE %I.%I RESET row_security', 'public', 'energy_platform_package');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'unrestrict skipped: %', SQLERRM;
END $$;

