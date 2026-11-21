BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_telegram_conversation_state (
  bot_rid integer NOT NULL,
  chat_id bigint NOT NULL,
  user_id bigint NOT NULL,
  state varchar(40) NOT NULL,
  prompt_message_id bigint,
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (bot_rid, chat_id, user_id)
);
CREATE INDEX t_platform_telegram_conversation_state_expiry_idx
  ON t_platform_telegram_conversation_state(expires_at);
COMMIT;
