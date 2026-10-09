# Asset Foundation（开发基线）

2026-10-09 已在开发虚拟机 PostgreSQL 17 的 `acs` 数据库执行 `0001_asset_foundation.sql`。迁移命令：在仓库根目录运行 `pnpm --filter @acs/api migrate`；迁移程序校验已应用文件的 SHA-256，禁止事后修改迁移。

## 已实现

- `organizations`、`workspaces`、`assets`、`asset_blobs` 四张表；组织和工作区组合外键阻止跨租户归属。Asset 指向同一 Asset 的 `ORIGINAL` Blob；提交时由延迟外键验证。
- 原件 blob 的内容哈希、字节数、类型、来源和服务端生成的对象键入库。原件关联、租户归属不可更改；Blob 禁止更新和删除。对象写入使用 `If-None-Match: *`，失败即拒绝覆盖。
- 内部 `AssetFoundation` 服务按组织和工作区同时查询；同一作用域的幂等键对完全相同输入返回同一 Asset，输入变化时报冲突。读取对象后再次验证大小与 SHA-256。
- 集成测试使用一次性 PostgreSQL schema、两个随机组织和 RustFS 对象键，验证跨租户读取拒绝、非法组织/工作区组合拒绝、原件不可变、并发幂等、对象防覆盖与内容校验。测试结束删除其专属 schema 和对象前缀。

测试命令：在 `apps/api` 目录运行 `node --env-file=../../.env --import tsx src/assets/asset-foundation.integration.ts`。需要本机到虚拟机的数据库和 S3 开发隧道。

## 接入边界

当前没有登录、成员关系和工作区角色的可信解析，因此**没有 Asset HTTP 上传或下载路由**。浏览器的 Image Studio 仍使用 IndexedDB，本服务尚未连接 ImageDocument。未来 API 必须从已验证身份推导 `TenantScope`，不能信任客户端提交的组织或工作区 ID。对象存储凭据不得交给浏览器。

对象先写入 S3，再提交数据库。数据库失败、进程崩溃或并发幂等竞争可能留下无引用对象；需要按数据库引用清单做延迟清扫。不能在提交结果不明确时立即删除，因为数据库可能已经提交。正式启用前还需定义保留和删除策略、独立的新上下文安全复核，以及进一步的对抗测试。此阶段仅作为开发基线。
