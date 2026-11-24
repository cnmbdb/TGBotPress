CREATE TABLE IF NOT EXISTS t_platform_telegram_conversation_state (
  bot_rid integer NOT NULL,
  chat_id bigint NOT NULL,
  user_id bigint NOT NULL,
  state varchar(40) NOT NULL,
  prompt_message_id bigint,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (bot_rid, chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS t_platform_telegram_conversation_state_expiry_idx
  ON t_platform_telegram_conversation_state(expires_at);
