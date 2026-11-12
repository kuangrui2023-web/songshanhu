# DeepSeek 找房

前台通过 Supabase `ai-search` 函数调用 DeepSeek。密钥只配置在 Edge Functions Secrets 的 `DEEPSEEK_API_KEY`；禁止添加到网页、NEXT_PUBLIC 环境变量、GitHub 或日志。可选 `DEEPSEEK_MODEL`，默认 `deepseek-flash`。

部署顺序：先应用 `ai_search.sql`，再将 `functions/ai-search/index.ts` 与同目录的 `fees.js` 一起部署（`verify_jwt=true`），最后发布静态网页。浏览器使用现有项目 anon JWT，不需要客户注册才能找房。

每次请求重新读取 `public_listings` 的公开字段；不读取留言、用户资料、内部底价、跟进记录或联系人信息。发布或下架后，下次 AI 请求自动使用当前目录。当前最多处理200套，超过时明确提示。无需另行上传知识库。用户当前需求及此前最多3条需求发送给 DeepSeek，用于追问；只保留在当前页面内存中，刷新或清空后删除，不写入数据库或 localStorage。

模型按公开目录返回 JSON 和房源 UUID；服务端核对 ID、类型和数值硬条件，浏览器继续应用筛选/排序并提供详情入口。文本均转义展示，不执行模型 HTML。未知信息需现场核实。不提供全网房源搜索或距离计算。

费用保护：`reserve_ai_search` 仅 service_role 可调用。默认全站每天200次（北京时间）、每网络地址每UTC小时15次，包含失败尝试。限额由数据库事务统一计数，跨实例有效；只存带服务端盐的轮换地址哈希及计数，不存原始IP和问题。到限额后仍可用普通筛选。后续调整限额请修改函数迁移，不要公开该表或执行权限。

来源限制目前为 GitHub Pages 正式来源和本地127.0.0.1:5183预览来源。后续绑定自定义域名时同步更新 allowedOrigins。JWT校验保持启用。模型异常、超时、余额不足、密钥错误明确报错，不假装已用 AI 成功返回本地匹配。平台自身的网络访问日志遵循各服务的日志策略。

接口遵循官方文档：https://api-docs.deepseek.com/ 和 https://api-docs.deepseek.com/guides/json_mode/ 。API 按模型实际 token 用量收费，无需也未进行 Vercel 部署。

## 月费用口径

`public/experience/fees.js` 是前台、普通搜索和 AI 服务的共同计算来源；打包脚本将它复制到函数目录。按十进制精确相乘，每项四舍五入到分后相加，预算硬上限不向上取整。月租金只含租金；明确包含物业或总预算时以租金与物业两项合计筛选。不含物业的表达优先识别。缺少面积或单价时对应费用为待确认，不能当作0；已明确填0的单价按0计算。推荐理由和费用问题回答使用服务器核实金额，避免模型自行重算。
