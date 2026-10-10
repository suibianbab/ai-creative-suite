# Image Studio 云端项目开发闭环

当前开发环境使用 Keycloak 公开客户端的 Authorization Code + PKCE 登录。浏览器仅在当前标签会话存放短期访问令牌；API 用显式配置的签发者、受众和 JWKS 验签，再从数据库实时读取组织及工作区成员关系。工作区 ID 只是选择器，不提供权限。生产配置要求 HTTPS JWKS；HTTP 仅允许非生产环境的本机回环地址。API 默认只监听 `127.0.0.1`，部署到容器时需明确配置 `API_HOST`。

## 本地运行

1. 启动 VM SSH 隧道、PostgreSQL、RustFS 和 Keycloak。
2. 在 `apps/api` 执行 `node --env-file=../../.env --import tsx src/auth/dev-browser-provision.ts`。脚本创建或复用 `acs-dev-web` 公开客户端和开发工作区，并写入 Git 忽略的根目录 `.env` 与 `apps/web/.env.local`。它不会输出密码或客户端密钥。
3. 构建或重启 API 和 Web。Web 的 `NEXT_PUBLIC_*` 配置在启动时读取。打开 `http://localhost:3000/image-studio`，点击“登录工作区”。登录使用 `.env.auth.local` 中已有的开发测试用户。
4. 在浏览器中保存一个本地 ImageDocument 后点“保存到云端”；从“选择云端项目”打开它。再次编辑并保存会写入下一不可变版本。新增原图或蒙版会先按本地 Asset ID 幂等上传，再保存版本；上传或保存失败时本地项目仍可保留。

API 端点为 `GET /workspaces/:workspaceId/image-projects`、`GET /:projectId`、`GET /:projectId/assets/:assetId`、`POST /imports`、`POST /:projectId/assets` 和 `PUT /:projectId`。所有端点需要 Bearer 令牌与当前数据库授权。上传限制 50 文件、单文件 25 MiB、总计 100 MiB，接受 PNG/JPEG/WebP 并校验文件头。项目版本保存要求 `expectedVersion`；冲突返回 409。

回归用例 `PRJ-003` 对真实 PostgreSQL/RustFS 运行 HTTP 测试，覆盖匿名上传拒绝、跨租户拒绝、导入重试、原图字节、增量上传、旧版本冲突和成员撤销。`AUTH-003` 用真实 Keycloak 令牌读取已配置的开发工作区。浏览器已验证跳转到 Keycloak 登录页；完整登录、导入、刷新、重开的 `UI-003` 仍为待执行手工验收。独立新上下文安全复核、密钥轮换、生产身份提供方、审计及正式多用户管理尚未完成；这些开发路由不应对外开放。
