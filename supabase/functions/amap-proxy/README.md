# 高德地图代理已停用

2026-10-21 起入口仅返回 HTTP 410，不再读取安全密钥或转发请求。
以下开通步骤仅作为历史说明，不应在当前网站重新启用。

这一步不修改房源和账号数据。安全密钥只存放在 Supabase Secrets，不进入 GitHub Pages 源码或构建产物。

1. 打开已有 Supabase 项目 → Edge Functions → Secrets。
2. 新建 `AMAP_SECURITY_JSCODE`，值填写高德控制台的“安全密钥”（不是 Key），保存。不要发送到聊天中。
3. 创建 Edge Function，命名 `amap-proxy`，使用本目录 `index.ts` 的完整代码。
4. 仅对此函数关闭 JWT verification，再部署。地图 SDK 的请求没有 Supabase 登录令牌；函数只代理地图，不读写房源、账号或文件。保留其他函数原有验证设置。
5. 网站的公开构建变量 `NEXT_PUBLIC_AMAP_SERVICE_HOST` 配置为：

   ```text
   https://zywbyjnbzgwmdypgobvh.supabase.co/functions/v1/amap-proxy/_AMapService
   ```

6. `NEXT_PUBLIC_AMAP_KEY` 为高德 Web 端 JS API Key，可公开。域名白名单使用 `ning73988-jpg.github.io`。重新构建并发布网站。

若使用 CLI，可用 `supabase functions deploy amap-proxy --no-verify-jwt --project-ref zywbyjnbzgwmdypgobvh`。Secret 请通过控制台填写，避免进入命令行历史。

公开代理限制来源与指定 Key，目标固定为高德官方服务。来源校验不能代替流量限制；需结合高德控制台的域名限制、配额和使用统计管理调用。公开运营还需确认账号适用的服务许可。

当前网站只标注真实已保存的高德坐标（GCJ-02，经度在前、纬度在后），不根据演示园区或空值推测房源位置。Key 已填写，但 Secret、函数部署及网站发布未完成前，地图不能视为已开通。
