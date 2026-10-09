# ImageDocument 服务端持久化（开发基线）

2026-10-09 已在开发虚拟机 PostgreSQL 执行 `0002_image_projects.sql`。它建立项目、不可变文档版本、版本使用的 Asset 引用；组合外键约束组织与工作区，项目头通过延迟外键指向已提交版本。

内部 `ImageProjectStore` 提供 `save` 和 `get`：

- 保存时完整检查 `ImageDocument` 版本、画布、图层、Product Identity Lock、原图与蒙版引用及文档体积；只接受本工作区的 IMAGE Asset。
- 第一次保存要求 `expectedVersion = 0`；后续保存必须提交当前版本号。版本不匹配拒绝覆盖。每次成功保存追加一个不可修改版本，并原子更新项目头。
- `requestKey` 与请求内容哈希支持准确重试；同一键配不同内容拒绝。并发首次创建同一项目和请求键只产生一个版本。
- `get` 同时限定组织和工作区。历史版本和素材引用行禁止更新或删除；数据库外键阻止跨组织及跨工作区素材链接。

运行集成测试：在 `apps/api` 目录执行 `node --env-file=../../.env --import tsx src/image-projects/image-project-store.integration.ts`。测试在随机 schema 中建两个组织、三个工作区，真实写入 RustFS 测试对象，覆盖并发重试、版本冲突、跨租户/跨工作区拒绝、非法引用和历史不可变，结束后删除专属测试数据。

当前这是**内部服务**。尚无登录、成员关系和工作区角色解析，因此不开放项目或原图 HTTP API，也不把浏览器 IndexedDB 项目自动同步到服务端。浏览器本地 Asset UUID 与服务端新建 Asset UUID 需要在导入流程中明确映射，不能直接假定相同。接入前需设计可信身份提供方、工作区角色和同步冲突处理，并完成独立新上下文审查。迁移已应用，后续只能新增迁移，不能修改现有文件。
