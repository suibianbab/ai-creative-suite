# 浏览器本地项目导入（内部开发基线）

2026-10-09 已应用 `0004_local_image_imports.sql`。`LocalImageImportService` 接收本地 ImageDocument、它引用的全部原图/蒙版文件和稳定的请求键，创建服务端 Asset，并把文档中的本地 Asset ID 改写为服务端 ID 后保存项目版本。原图内容不被改写或覆盖。

导入记录先于对象写入落库，保存本地项目 ID、请求摘要和服务端项目 ID。每个本地文件使用导入记录与本地 Asset ID 生成稳定的素材幂等键。若写入部分原图后发生故障，相同请求重试会复用已有素材，再继续保存项目；同一请求键但文档或原图发生变化时拒绝。一个组织/工作区的导入记录不能被另一作用域读取或复用。

在 `apps/api` 目录执行 `node --env-file=../../.env --import tsx src/image-projects/local-image-import.integration.ts`。集成测试使用一次性 PostgreSQL schema 和 RustFS 真正对象，模拟原图上传后项目保存失败，验证重试、原图读回、蒙版 ID 映射、跨组织隔离和导入记录不可更改。

当前仅有内部服务，没有浏览器上传入口或自动同步。浏览器 IndexedDB 项目仍留在本机；接入实际身份提供方、成员管理、文件传输限制、独立安全审查与端到端浏览器验证后，才能开放导入 API。并发重试或数据库故障仍可能在对象存储留下无引用对象；其默认只报告的清扫开发基线见 [`ORPHAN_OBJECT_RETENTION.md`](./ORPHAN_OBJECT_RETENTION.md)，正式自动执行尚待独立复核。每次导入最多 50 个文件、总计 100 MiB，单个文件仍受 Asset Foundation 的 25 MiB 限制。
