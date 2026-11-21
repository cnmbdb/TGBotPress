-- Fresh-database permission defaults only; no credentials, API keys, wallet data or historical business rows.
INSERT INTO public.t_permissions VALUES (5, '主页', 'web', '2020-09-22 08:33:50', '2020-09-22 08:33:50', '', 0);

INSERT INTO public.t_permissions VALUES (6, '主页列表', 'web', '2020-09-22 08:37:02', '2020-09-22 08:37:02', 'admin.home', 5);

INSERT INTO public.t_permissions VALUES (7, '系统管理', 'web', '2020-09-22 08:37:37', '2020-09-22 08:37:37', '', 0);

INSERT INTO public.t_permissions VALUES (8, '管理员管理', 'web', '2020-09-22 08:38:14', '2020-09-22 08:38:14', 'admin.system.admin.index', 7);

INSERT INTO public.t_permissions VALUES (9, '权限管理', 'web', '2020-09-22 08:38:23', '2020-09-22 08:38:23', 'admin.system.permission.index', 7);

INSERT INTO public.t_permissions VALUES (10, '角色管理', 'web', '2020-09-22 08:38:34', '2020-09-22 08:38:34', 'admin.system.role.index', 7);

INSERT INTO public.t_permissions VALUES (19, '系统设置', 'web', '2021-07-09 05:42:29', '2021-07-09 05:42:29', '', 0);

INSERT INTO public.t_permissions VALUES (20, '配置信息', 'web', '2021-07-09 05:42:47', '2021-07-09 05:42:47', 'admin.setting.config.index', 19);

INSERT INTO public.t_permissions VALUES (11, '添加管理员', 'web', '2020-09-22 08:39:33', '2020-09-22 08:39:33', 'admin.system.admin.add', 8);

INSERT INTO public.t_permissions VALUES (12, '修改管理员状态', 'web', '2020-09-22 09:23:59', '2020-09-22 09:23:59', 'admin.system.admin.change_status', 8);

INSERT INTO public.t_permissions VALUES (13, '修改管理员资料', 'web', '2020-09-22 09:24:12', '2020-09-22 09:24:12', 'admin.system.admin.update', 8);

INSERT INTO public.t_permissions VALUES (14, '删除管理员', 'web', '2020-09-22 09:24:21', '2020-09-22 09:24:21', 'admin.system.admin.delete', 8);

INSERT INTO public.t_permissions VALUES (15, '添加角色', 'web', '2020-09-22 09:25:14', '2020-09-22 09:25:14', 'admin.system.role.add', 10);

INSERT INTO public.t_permissions VALUES (16, '编辑角色权限', 'web', '2020-09-22 09:25:23', '2020-09-22 09:25:23', 'admin.system.role.show_permissions', 10);

INSERT INTO public.t_permissions VALUES (17, '修改角色名称', 'web', '2020-09-22 09:25:30', '2020-09-22 09:25:30', 'admin.system.role.update', 10);

INSERT INTO public.t_permissions VALUES (18, '删除角色', 'web', '2020-09-22 09:25:38', '2020-09-22 09:25:38', 'admin.system.role.del', 10);

INSERT INTO public.t_permissions VALUES (21, '搜索查询_配置信息', 'web', '2021-07-09 05:42:55', '2021-07-09 05:42:55', 'admin.search', 20);

INSERT INTO public.t_permissions VALUES (22, '数据字典', 'web', '2021-07-09 05:43:06', '2021-07-09 05:43:06', 'admin.setting.dictionary.index', 19);

INSERT INTO public.t_permissions VALUES (23, '添加数据字典', 'web', '2021-07-09 05:43:27', '2021-07-09 05:43:27', 'admin.setting.dictionary.store', 22);

INSERT INTO public.t_permissions VALUES (24, '编辑数据字典', 'web', '2021-07-09 05:43:38', '2021-07-09 05:43:38', 'admin.setting.dictionary.update', 22);

INSERT INTO public.t_permissions VALUES (25, '删除数据字典', 'web', '2021-07-09 05:43:49', '2021-07-09 05:43:49', 'admin.setting.dictionary.delete', 22);

INSERT INTO public.t_permissions VALUES (26, '搜索查询_数据字典', 'web', '2021-07-09 05:43:56', '2021-07-09 05:43:56', 'admin.search', 22);

INSERT INTO public.t_permissions VALUES (27, '应用升级', 'web', '2021-07-09 05:44:09', '2021-07-09 05:44:09', 'admin.setting.app_version.index', 19);

INSERT INTO public.t_permissions VALUES (28, '升级应用升级', 'web', '2021-07-09 05:44:25', '2021-07-09 05:44:25', 'admin.setting.app_version.store', 27);

INSERT INTO public.t_permissions VALUES (29, '编辑应用升级', 'web', '2021-07-09 05:44:36', '2021-07-09 05:44:36', 'admin.setting.app_version.edit', 27);

INSERT INTO public.t_permissions VALUES (30, '搜索查询_应用升级', 'web', '2021-07-09 05:44:53', '2021-07-09 05:44:53', 'admin.search', 27);

INSERT INTO public.t_permissions VALUES (31, '机器人管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO public.t_permissions VALUES (32, '群组用户', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO public.t_permissions VALUES (33, '闪兑管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO public.t_permissions VALUES (34, '能量管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO public.t_permissions VALUES (35, '会员管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO public.t_permissions VALUES (36, '监控管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO public.t_permissions VALUES (37, '归集管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO public.t_permissions VALUES (38, '商城管理', 'web', '2026-02-22 06:44:53.057733', '2026-02-22 06:44:53.057733', '', 0);

INSERT INTO public.t_permissions VALUES (39, '克隆/代理', 'web', '2026-09-17 00:00:00', '2026-09-17 00:00:00', '', 0);

INSERT INTO public.t_permissions VALUES (40, '克隆/代理基础设置', 'web', '2026-09-17 00:00:00', '2026-09-17 00:00:00', 'admin.telegram.cloneproxy.basic', 39);

INSERT INTO public.t_permissions VALUES (41, '克隆/代理商户管理', 'web', '2026-09-17 00:00:00', '2026-09-17 00:00:00', 'admin.telegram.cloneproxy.merchants', 39);

INSERT INTO public.t_role_has_permissions VALUES (5, 1);

INSERT INTO public.t_role_has_permissions VALUES (6, 1);

INSERT INTO public.t_role_has_permissions VALUES (7, 1);

INSERT INTO public.t_role_has_permissions VALUES (8, 1);

INSERT INTO public.t_role_has_permissions VALUES (9, 1);

INSERT INTO public.t_role_has_permissions VALUES (10, 1);

INSERT INTO public.t_role_has_permissions VALUES (19, 1);

INSERT INTO public.t_role_has_permissions VALUES (20, 1);

INSERT INTO public.t_role_has_permissions VALUES (11, 1);

INSERT INTO public.t_role_has_permissions VALUES (12, 1);

INSERT INTO public.t_role_has_permissions VALUES (13, 1);

INSERT INTO public.t_role_has_permissions VALUES (14, 1);

INSERT INTO public.t_role_has_permissions VALUES (15, 1);

INSERT INTO public.t_role_has_permissions VALUES (16, 1);

INSERT INTO public.t_role_has_permissions VALUES (17, 1);

INSERT INTO public.t_role_has_permissions VALUES (18, 1);

INSERT INTO public.t_role_has_permissions VALUES (21, 1);

INSERT INTO public.t_role_has_permissions VALUES (22, 1);

INSERT INTO public.t_role_has_permissions VALUES (23, 1);

INSERT INTO public.t_role_has_permissions VALUES (24, 1);

INSERT INTO public.t_role_has_permissions VALUES (25, 1);

INSERT INTO public.t_role_has_permissions VALUES (26, 1);

INSERT INTO public.t_role_has_permissions VALUES (27, 1);

INSERT INTO public.t_role_has_permissions VALUES (28, 1);

INSERT INTO public.t_role_has_permissions VALUES (29, 1);

INSERT INTO public.t_role_has_permissions VALUES (30, 1);

INSERT INTO public.t_role_has_permissions VALUES (31, 1);

INSERT INTO public.t_role_has_permissions VALUES (32, 1);

INSERT INTO public.t_role_has_permissions VALUES (33, 1);

INSERT INTO public.t_role_has_permissions VALUES (34, 1);

INSERT INTO public.t_role_has_permissions VALUES (35, 1);

INSERT INTO public.t_role_has_permissions VALUES (36, 1);

INSERT INTO public.t_role_has_permissions VALUES (37, 1);

INSERT INTO public.t_role_has_permissions VALUES (38, 1);

INSERT INTO public.t_role_has_permissions VALUES (39, 1);

INSERT INTO public.t_role_has_permissions VALUES (40, 1);

INSERT INTO public.t_role_has_permissions VALUES (41, 1);

INSERT INTO public.t_roles VALUES (1, '超级管理员', 'web', '2026-02-22 06:41:09.980014', '2026-02-22 06:41:09.980014');

INSERT INTO public.t_model_has_roles(role_id,model_type,model_id)
VALUES (1, 'App\Models\Admin\Admin', 1);

SELECT setval('public.t_roles_id_seq', (SELECT COALESCE(MAX(id), 1) FROM public.t_roles), true);
SELECT setval('public.t_permissions_id_seq', (SELECT COALESCE(MAX(id), 1) FROM public.t_permissions), true);
