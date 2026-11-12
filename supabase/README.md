# 网站数据后台开通

当前网页托管在 GitHub Pages，房源与留言使用已有 Supabase 项目。网站首页采用 WorkBuddy 版本的布局与主要访客交互；上传和发布仍通过本站的安全管理后台完成。

## 已有项目升级

在现有 Supabase 项目的 SQL Editor 执行 [port_workbuddy.sql](port_workbuddy.sql)，保留原有房源与留言。它会增加公开园区、位置和联系方式字段，并把发布条件改为至少 1 张房源照片与园区名称。随后等待 GitHub Pages 重新发布，进入 `/admin/` 编辑房源。

## 开通步骤

1. 由网站所有者创建 Supabase 项目。进入 SQL Editor，执行 [setup.sql](setup.sql)。该脚本按全新项目编写，请不要直接覆盖已有生产数据库。
2. 在 Authentication → Users 创建第一个管理员邮箱账号。复制该用户 UUID，在 SQL Editor 执行：

   ```sql
   insert into public.admin_users (user_id, role, park, active)
   values ('这里填管理员 UUID', 'superadmin', null, true);
   ```

3. 在 GitHub 仓库 Settings → Secrets and variables → Actions 增加 `NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。只使用项目的公开 anon/publishable key，绝不把 service_role key 放进网页或 GitHub 构建变量。
4. 重新运行 Pages 工作流。访问网站 `/admin/` 登录，新增房源并上传至少 1 张实拍照片；资料不足时先保存为草稿。
5. 最后执行 `location_privacy.sql`：详细地址与坐标固定仅后台保存，园区匿名接口仅公开目录字段。发布前核对允许公开的园区名称与联系电话；底价、内部编号、渠道和跟进备注仍只在后台可见。

## 当前边界

### 公开房源编号与留言跟进（20261022b）

在现有片区隐私和两套联系人升级之后运行 `public_listing_codes.sql`。公开视图只追加 `listing_code`，值取自现有六位 `internal_code`，不重编、不回写历史资料；原字段名不直接公开。此节取代下文旧版本“编号仅后台”的历史描述，其余业主、园区、房号、底价、跟进记录等隐私边界不变。

前台卡片、详情和客户预览展示编号；首页输入六位编号（支持“编号：”前缀）直接精确查询、清除其他条件，不调用 AI。后台编号查找自动切回全部状态、全部园区，回收站不参与默认搜索。

留言页保留原 RLS 和回复接口，补房源编号关联、关键词及北京时间日期筛选、筛选结果和全部有效记录两种 CSV 导出。导出白名单不包含 receipt、client_request_id、内部业主信息，单元格继续防公式注入。全部有效记录不含回收站；回收站可单独筛选导出。

后台登录并完成首次加载后，每 15 秒在页面可见时检查留言，切回或恢复联网时补查。首次打开仅建立历史基线；同一留言 ID 不因刷新、回复或恢复重复提示。声音每次打开后台需管理员主动开启并试听，锁屏、关闭网页或浏览器限制播放时不保证声音；不是短信、微信或系统推送。仅轮询留言，不覆盖正在填写的房源表单。快捷回复本次不做。

### 两套房源联系方式（20261022）

在现有字段和片区隐私升级之后执行 `listing_owner_contacts.sql`，再部署前端。原 `contact_name` / `contact_phone` 保留为对外招商顾问；新增 `owner_contact_name` / `owner_contact_phone` 为业主或园区对接人，选填且固定仅后台。两组姓名与电话独立保存，不自动互相复制，也不从园区联系人自动填入公开栏。历史联系人不重写，新内部字段保持空白，须人工核对填写。

公开 `public_listings` 视图保持原有白名单，不增加内部联系人列；后台继续受现有园区管理员 RLS 控制。客户预览显式移除内部联系人，公开页面、分享及 AI 找房均不读取该字段。请勿将内部联系人写进对外标题、介绍或图片。检查：`node scripts/test-owner-contacts.cjs`。

- 管理员权限：唯一超管可管理账号、平台与全部业务；全园区管理员（content_admin）管理全部房源及留言，园区管理员（park_admin）仅管理指定园区。超管在网页「设置」新增账号或编辑管理范围。
- 线上预约：访客可提交需求，管理员可在网站后台的“咨询与预约”查看。运营前仍需配置反垃圾保护和隐私告知。
- 会员手机号验证、精准地图、企业供需审核与产业 AI 匹配尚未接通，不向访客展示私密内容。不能用前端隐藏代替后端授权。
- 网站与微信小程序可以共用后端业务数据，但小程序接入与正式公开发布还需单独完成主体类目、备案和平台审核。

### 访客撤回留言

在已有 visitor_intake.sql 后执行 visitor_withdraw.sql，增加基于回执的留言撤回功能。只设置撤回时间并移入回收站，不物理删除。撤回记录不再进入待处理列表，后台不可恢复为待回复；访客修改后重新提交生成新留言。

## 全园区管理员升级

在现有 setup / admin_workspace / visitor_withdraw 升级后执行 [admin_all_parks.sql](admin_all_parks.sql)，部署最新 admin-accounts 函数并发布前台。SQL 不会自动更改任何已有管理员的角色；由超管在网页设置中明确选择「全部园区（房源与留言）」。

新增 content_admin 角色通过 can_manage_park / can_manage_all_parks 控制房源和留言，is_superadmin 保持仅识别超级管理员。创建、编辑、停用与移除管理员的 RPC 继续要求超级管理员。界面的 __all_parks__ 仅是范围选择值，落库为 content_admin + park=NULL，不是实际园区。

脚本从真实房源的 park 字段同步缺失名称（不推测地址和坐标），并安装目录同步触发器；已停用的园区不会被自动启用。已有房源与账号的园区归属不会被重写。

## 新增房源分区表单升级

现有项目运行 `listing_editor_fields.sql`，仅增加字段及公开投影，不改写历史房源。新表单保存楼栋/房号分拆信息，旧合并字段在人工编辑前保留；客户读取 `public_listings`，仅后台字段不进入公开出口。不要直接给匿名角色授予 `listings` 表读取权限。新建项目基础脚本已同步公开投影；最后运行此升级脚本以设置可见性约束。

中介费、微信、视频号只有在 `field_visibility` 中对应键明确为 `true` 时才由公开视图返回，否则为 `null`；历史与新建房源均默认仅后台。

## 房源内部编号自动生成（20261021b）

在 `listing_editor_fields.sql` 升级之后应用 [listing_internal_codes.sql](listing_internal_codes.sql)。现有生产项目已应用，无需重复操作；新环境按依赖顺序安装。该脚本不回填或重写历史房源。

- 新房源首次保存时由私有数据库序列生成六位编号（100001–999999）。编号框只读，保存草稿与发布均可触发生成；多个管理员同时录入不会分配相同的新编号。
- 已有非空编号不变，包括历史不足六位的编号；历史空编号在下次保存时生成。重复 upsert、下架、回收与恢复都保留已有编号。
- 序列允许跳号，不循环、不复用；耗尽时明确报错。内部编号仍不进入 `public_listings`，匿名用户不能直接调用分配函数或使用序列。
- 验证只使用隔离临时表并回滚，不向生产房源表写入演示资料。

## 首次上架时间与 24 小时上新标识（20261021c）

在上述表单字段、内部编号升级之后运行 [listing_first_publication.sql](listing_first_publication.sql)，生产项目已应用。该脚本最后更新公开视图；以后若重跑旧版公开视图脚本，需再核对本字段没有被移除。

`first_published_at` 由数据库在首次发布时写入，不使用创建草稿的时间或最后编辑时间；普通编辑、下架重发与回收恢复均不会重置。旧房源优先从发布审计事件恢复首次上架时间；只有缺少审计的历史已发布房源才采用原创建时间。本次 29 套均有发布审计依据。

公开视图仅追加首次上架时间，原公开/内部字段规则保留。前台卡片图片左上角显示绿色“上新”，窗口为首次发布起不足 24 小时；满 24 小时自动移除，页面保持打开或切回前台也会重新核对。手填“新上/上新”标签不再绕过时间限制，其他促销标签保留。

回归测试：`node scripts/test-new-listings.cjs`；数据库触发器使用隔离临时表验证，不新增演示房源。

## 七大片区与固定位置隐私（20261021f）

在所有旧版公开视图升级后，最后运行 `location_privacy.sql`、再运行 `region_privacy.sql`。当前生产库已完成，不要用旧版视图覆盖新规则。

新增 listings.region，可取北部、中部、南部、生态园、大朗、寮步、大岭山或 NULL（待确认）。脚本只回填明确文字或同园区已有唯一片区，不把不知道的园区随意归类。管理员在后台可手动选择或使用不联网的关键词辅助识别；辅助识别不是外部 AI。既有资料的额外交叉复核记录只保存在本机 private-notes，不进入源码发布包。

公开 view 保留已有白名单列，追加 region；park/building/room/unit/address/latitude/longitude 固定 NULL，标题及说明等文字匹配本条私有园区名、地址、独立房号时替换为隐藏提示；原 listings 原文不变。匿名 parks 读取权限及公开策略撤销，后台园区权限保留。联系人及已明确批准的微信、视频号公开规则不变。媒体照片、视频里的招牌和水印不属于文字字段脱敏，应在上传前人工检查。

AI 找房 Edge Function v7 仅取 public_listings，以 region 匹配旧筛选参数 park；不向模型读取后台园区目录。查看位置链接只携带七片区白名单关键词，无坐标、园区、房号和详情页编号。

检查：node scripts/test-regions.cjs、node scripts/test-area-location.cjs、node scripts/test-location-privacy.cjs、node scripts/test-new-listings.cjs；GITHUB_PAGES 静态导出构建。

### 2026-10-27 片区选项扩展

执行 `region_options.sql`（在 `region_privacy.sql` 之后），将允许保存的片区扩展为原七项及东城、南城，并同步内部关键词识别和广义片区脱敏例外。现有房源不改写；后台将原北部、中部、南部、生态园显示为完整松山湖名称，仍保存原值。前台允许列表、筛选及 AI 片区枚举同时支持新增两项。东城、南城只显示片区名称，不编造地图示意点。
