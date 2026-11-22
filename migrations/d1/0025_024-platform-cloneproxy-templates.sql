BEGIN;
INSERT INTO t_telegram_bot_keyboard (rid,keyboard_type,keyboard_name,keyboard_icon_custom_emoji_id,inline_type,keyboard_value,status,create_by,create_time,update_by,update_time,seq_sn)
SELECT 16,1,'克隆/代理',NULL,0,'-',0,NULL,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP,89
WHERE NOT EXISTS (SELECT 1 FROM t_telegram_bot_keyboard WHERE keyboard_type=1 AND keyboard_name='克隆/代理');
INSERT INTO t_telegram_bot_keyreply (rid,bot_rid,key_type,monitor_word,reply_photo,reply_content,opt_type,status,create_by,create_time,update_by,update_time)
SELECT 15,1,1,'克隆/代理','', '欢迎使用克隆代理机器人',1,0,NULL,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM t_telegram_bot_keyreply WHERE bot_rid=1 AND monitor_word='克隆/代理');
INSERT INTO t_telegram_bot_keyreply_keyboard (rid,bot_rid,keyreply_rid,keyboard_rid,create_by,create_time,update_by,update_time)
SELECT 777,1,k.rid,kb.rid,NULL,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP
FROM t_telegram_bot_keyreply k,t_telegram_bot_keyboard kb
WHERE k.bot_rid=1 AND k.monitor_word='克隆/代理' AND kb.keyboard_type=1 AND kb.keyboard_name='克隆/代理'
AND NOT EXISTS (SELECT 1 FROM t_telegram_bot_keyreply_keyboard r WHERE r.bot_rid=1 AND r.keyreply_rid=k.rid AND r.keyboard_rid=kb.rid);
COMMIT;
