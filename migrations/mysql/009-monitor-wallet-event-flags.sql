-- The generated legacy schema already stores these switches as CHAR(2).
ALTER TABLE t_monitor_wallet
  MODIFY monitor_trx_transaction CHAR(2) NOT NULL DEFAULT 'NN',
  MODIFY monitor_approve_transaction CHAR(2) NOT NULL DEFAULT 'NN',
  MODIFY monitor_multi_transaction CHAR(2) NOT NULL DEFAULT 'NN',
  MODIFY monitor_pledge_transaction CHAR(2) NOT NULL DEFAULT 'NN';
CREATE OR REPLACE VIEW monitor_wallet AS SELECT * FROM t_monitor_wallet;
