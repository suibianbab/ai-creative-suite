# 身份与工作区授权（开发基线）

2026-10-09 在开发虚拟机 PostgreSQL 应用 `0003_identity_memberships.sql`，建立用户、外部身份映射、组织成员关系、工作区成员关系。该迁移不创建默认管理员、公开注册入口或测试账号。

## 信任边界

- `AuthProvider` 是身份提供方接口。当前 `JwtAuthProvider` 接受部署方明确配置的签发者、API 受众、公钥集和允许算法，仅验证非对称签名 JWT。可使用 HTTPS 公钥集或本地公钥集，供 Cloud 与隔离部署选用；没有从令牌头读取密钥 URL，也没有自动发现任意签发者。
- 验证要求签名、签发者、受众、`sub`、`iat`、`exp` 和最大令牌年龄。仅把已验证的 `(issuer, subject)` 用来查找本地用户；JWT 中的组织、工作区、角色声明不授权。
- `AccessContextResolver` 每次查询当前数据库。用户必须启用，组织成员和指定工作区成员都必须有效。读操作要求有效成员关系；写操作还要求组织不是 `VIEWER`，工作区是 `OWNER` 或 `EDITOR`。传入工作区 UUID 仅用于选择目标，返回的组织/工作区 `TenantScope` 从成员记录推导。
- 撤销任一成员关系或禁用用户后，下一次数据库授权查询即拒绝。未来后台任务应从已存储任务记录恢复租户上下文，不能直接重用浏览器令牌声明。

在 `apps/api` 目录执行 `node --env-file=../../.env --import tsx src/auth/access-context.integration.ts`。测试用随机数据库 schema、自生成 RSA 公私钥和签名令牌，覆盖错误签名、签发者/受众、缺失有效期、过期、未知身份、伪造角色声明、跨组织访问、只读角色和即时撤销。

## 尚未开放的能力

开发虚拟机已另行部署 Keycloak 26.8.0 的 `acs-dev` 测试 realm。`keycloak-smoke.ts` 使用真实签发的短期访问令牌、远程 JWKS 与一次性 PostgreSQL schema，已验证工作区写入授权及成员撤销后立即拒绝；详情见 `docs/VM_INFRASTRUCTURE.md`。测试代码仅在回环 SSH 隧道上注入 HTTP JWKS；生产 `JwtAuthProvider.remote` 仍要求 HTTPS。

此模块仍是内部开发基线。测试 realm 的密码授权只用于联调，尚未实现用户注册/邀请、正式浏览器登录、成员管理和审计；API 没有受保护的素材/项目 HTTP 路由。Cloud 的邮箱、Magic Link、Google 登录与 Enterprise 的 SAML/LDAP 等需分别通过 AuthProvider 适配。对外开放前必须完成独立新上下文安全审查、端到端鉴权测试、权限变更审计和密钥轮换演练。
