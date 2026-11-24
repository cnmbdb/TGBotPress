CREATE TABLE IF NOT EXISTS t_platform_plugin_task_schedule (
  plugin_id text NOT NULL,
  task_id text NOT NULL,
  next_run_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plugin_id, task_id)
);
