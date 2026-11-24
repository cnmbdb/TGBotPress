ALTER TABLE t_platform_plugin_install DROP CONSTRAINT IF EXISTS t_platform_plugin_install_source_check;
ALTER TABLE t_platform_plugin_install
  ADD CONSTRAINT t_platform_plugin_install_source_check
  CHECK (source IN ('builtin', 'github-packages', 'npmjs'));

ALTER TABLE t_platform_plugin_install_attempt DROP CONSTRAINT IF EXISTS t_platform_plugin_install_attempt_source_check;
ALTER TABLE t_platform_plugin_install_attempt
  ADD CONSTRAINT t_platform_plugin_install_attempt_source_check
  CHECK (source IN ('builtin', 'github-packages', 'npmjs'));
