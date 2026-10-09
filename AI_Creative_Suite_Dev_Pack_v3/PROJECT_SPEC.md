# AI Creative Suite — 完整产品与技术开发总方案 v2

## 1. 产品总定位

产品升级为 AI Creative Suite，不再只是 AI 动画网站。

两条一级产品线：

- AI Image Studio：电商图片编辑与视觉内容生产
- AI Motion Studio：动画、视频、交互与 3D 内容生产

共享底层：

- SaaS Core
- Asset Intelligence
- Brand System
- Credits / Usage / Billing
- AI Gateway
- Creative Document
- Agent Runtime
- Enterprise Deployment
- Admin

最终目标：让电商、品牌和企业用户从商品图开始，一路完成修图、设计、动画、视频和 3D 内容生产，结果可编辑、可复用、可批量、可品牌化、可私有部署。

---

## 2. 核心用户

### 电商卖家
Shopify、Amazon、TikTok Shop、AliExpress、Alibaba、独立站、社媒卖家。

### 外贸公司 / 工厂
产品图、详情页、技术图、展会物料、产品视频、工厂介绍。

### DTC 品牌
品牌视觉、社媒内容、产品广告、Banner、视频。

### 营销团队 / 设计服务商
批量制作、多尺寸适配、模板、团队协作、企业知识库。

---

## 3. 产品信息架构

主导航：

Home / Create / Projects / Assets / Brand / Templates

Create：

- Image
- Motion
- Video
- 3D

第一阶段重点：Image + Motion。

---

# Part A — AI Image Studio

## 4. 核心定位

AI 电商图片编辑与视觉内容生产工具。

核心能力：

- 上传
- 抠图
- 白底图
- 透明 PNG
- 商品精修
- AI 换背景
- 场景图
- Banner / 广告图
- 详情页图
- 多尺寸适配
- 批量处理
- 品牌一致性
- AI 局部修改

## 5. 基础编辑

Canvas：

- Select
- Move
- Resize
- Rotate
- Crop
- Duplicate
- Delete
- Multi-select
- Align
- Distribute
- Snap
- Zoom
- Pan

属性：

- Brightness
- Contrast
- Saturation
- Exposure
- Sharpness
- Blur
- Opacity
- Shadow
- Border
- Radius

## 6. AI 抠图

结果保存为非破坏式结构：

Original + Mask + Shadow Layer

支持复杂边缘、布料、毛发、半透明材质。

## 7. 商品精修

支持：

- 提亮
- 降噪
- 修反光
- 压高光
- 材质增强
- 色彩修正
- 修褶皱
- 背景清理

## 8. Product Identity Lock

默认 ON。

保护：

- Logo
- 产品结构
- 关键颜色
- 图案
- 产品文字
- 接口位置
- 材质特征
- 尺寸比例

## 9. AI 场景图

商品图 → Identity Lock → Background Generation → Composition → Lighting Match → Shadow Match

场景：

- 白底
- 纯色
- 渐变
- 科技
- 家居
- 户外
- 办公
- 节日
- 高端广告

## 10. 详情页图片

自动生成：

- 卖点图
- 参数图
- 尺寸图
- 结构图
- 功能图
- 对比图
- 工艺图
- 使用场景
- FAQ 图

## 11. 广告图 / Banner

支持：

- Shopify
- Amazon
- Amazon A+
- Facebook
- Instagram
- TikTok
- LinkedIn
- Alibaba

自动做文字层级、主体留白、Logo、CTA、安全区。

## 12. 多尺寸适配

不是裁剪，而是 Responsive Composition。

支持：

- 1:1
- 4:5
- 16:9
- 9:16
- Banner
- Long-form

## 13. 批量处理

上传 10~500 张 → 选择 Workflow → Batch Process → Exception Review → Export

Preset 示例：

Remove BG → White BG → Center → Add Shadow → Resize → Watermark → Export

## 14. ImageDocument

Image Studio 源文件：

- Canvas
- Layers
- Masks
- Adjustments
- Text
- Vectors
- Filters
- Smart Assets
- References

AI 优先产生结构化 Patch，不整图重做。

## 15. 非破坏式编辑

必须支持：

- Undo
- Redo
- Compare
- Restore
- parent_asset_id

原始 Asset 永远保留。

## 16. ArtCraft / PhotoCraft 融合

只借鉴：

- Layer
- Mask
- Adjustment
- Smart Filter
- Agent-ready editing

通过 ImageEditorAdapter 接入，不让业务绑定其内部格式。

## 17. Vector 能力

用于 Logo、SVG、图标、信息图、流程图。

支持：

- Image Trace
- Path
- Node
- Fill
- Stroke
- Gradient
- Boolean
- Group
- Text

VectorDocument 独立。

## 18. Image → Motion

Image Studio 项目可一键：

Turn into Motion

流程：

Image Project → Assets/Layers → Storyboard → Motion Scene → Animation

这是 Image 和 Motion 的核心增长桥梁。

---


---

# PhotoCraft 集成策略更新（v3）

PhotoCraft 当前仍处于快速迭代阶段，因此不再把它视为 AI Image Studio 的核心底座。新的长期策略是：

> **Thin Native Editor + ImageDocument + Operation Layer + Capability Router + PhotoCraft Adapter + AI Image Providers + Ecommerce Workflow Engine**

架构：

```text
                 AI IMAGE STUDIO

                      UI
                      │
                      ▼
               ImageDocument
                      │
                      ▼
              Operation Layer
                      │
                      ▼
             Capability Router
         ┌────────────┼────────────┐
         ▼            ▼            ▼
     Native Web   PhotoCraft       AI
       Engine       Adapter      Provider
```

核心原则：

- 我们自己掌握产品体验、业务工作流和 ImageDocument；
- PhotoCraft 负责传统 Photoshop 类高级编辑能力；
- AI Provider 负责生成式图片能力；
- 不长期维护同一种高级能力的两套完整实现；
- PhotoCraft 未来变强时，只替换 Executor，不重做 UI、业务工作流和项目格式。

## Thin Native Editor 边界

Native Web Editor 只负责：

```text
Canvas
Selection
Move / Resize / Rotate
Crop
Basic Text
Basic Shape
Opacity
Layer List / Z-order
Group
Align / Snap
Duplicate / Delete
Asset Placement
Undo / Redo Orchestration
Export Shell
```

禁止为了补齐 PhotoCraft 暂时缺失而大规模自研：

```text
Advanced Channels
Advanced Brush Engine
Liquify
Full Smart Objects
Complex PSD Typography
Professional Color Management
Complete Photoshop Filter Set
Advanced RAW Workflow
Full Plugin Ecosystem
```

## PhotoCraft 负责的能力

优先由 PhotoCraft Adapter 承担：

```text
Advanced Masks
Adjustment Layers
Curves
Levels
Color Balance
Blend Modes
Layer Effects
Traditional Filters
PSD Import / Export
Advanced Selection
Smart-object-like workflow
Advanced Compositing
```

但所有能力都必须先通过 Capability Registry 判断稳定性。

## AI Provider 负责的能力

以下能力主要由 ImageProvider 完成：

```text
Remove Background
Generative Fill
Object Removal
Background Replace
Scene Generation
Outpaint
Relight
Restyle
Upscale
Shadow Generation
Image Variation
Product Scene
```

## Image Capability Router

新增 `ImageCapabilityRouter`。例如：

```text
transform       → native
crop            → native
basic_text      → native
curves          → photocraft
advanced_mask   → photocraft
psd_import      → photocraft
remove_bg       → ai
generative_fill → ai
```

UI 不允许直接调用 PhotoCraft API。统一走：

```text
editor.applyOperation(...)
```

再由 Capability Router 决定 Executor。

## Capability Registry

每项能力记录：

```text
Capability
Provider
Status
Fallback
Last Reviewed Version
Migration Plan
```

状态：

```text
STABLE
BETA
PARTIAL
WAIT
DISABLED
```

前端根据 Registry 决定是否展示、是否标 Beta、是否允许生产使用。

## BUILD / WAIT / INTEGRATE / AI_PROVIDER

每个 Photoshop 类功能在开发前必须先分类。

### BUILD
只有当功能高频、阻塞商业化、实现成本可控且未来迁移成本低时才自研。

典型：

```text
Basic Crop
Basic Text
Basic Shadow
Transform
Layer Reorder
```

### INTEGRATE
PhotoCraft 已具备或预计近期具备的 Photoshop 通用能力。

典型：

```text
Curves
Levels
Advanced Mask
PSD
Layer Effects
Traditional Filters
```

### WAIT
不属于核心商业路径、开发成本又高。

典型：

```text
Advanced Channels
Liquify
Complex Smart Objects
Professional Color Management
Advanced Brush System
```

### AI_PROVIDER
生成式图片能力直接走 AI。

典型：

```text
Remove BG
Generative Fill
Scene Generation
Object Removal
Relight
Outpaint
```

## PhotoCraft Capability Watchlist

长期维护：

```text
docs/photocraft-capabilities.md
```

每次决定实现 Photoshop 类功能前先检查该文件。

## PhotoCraft 升级策略

禁止直接跟随 upstream main：

```text
Upstream Release
→ Pin Version
→ Integration Branch
→ Compatibility Suite
→ Golden Image Regression
→ Performance Benchmark
→ Manual Approval
→ Production
```

## Compatibility Suite

固定测试：

```text
Simple Product Layout
Large Ecommerce Banner
Text-heavy Advertisement
Mask-heavy Project
Adjustment-heavy Project
PSD Import / Export
Transparent Product
Complex Shadow
Large Resolution Image
50+ Layer Project
```

检查：

```text
Document Fidelity
Screenshot Diff
Render Correctness
Performance
Memory
Crash Rate
Operation Compatibility
```

## PSD 策略

第一阶段：

```text
PSD Import (Beta)
PSD Export (Beta)
```

复杂 PSD 导入后提供 Compatibility Report，不宣传 Full Photoshop Compatibility。

## Fallback 策略

每项 Capability 定义：

```text
Primary Provider
Fallback Provider
Failure Behavior
```

Fallback 只能是最小可用能力，不允许因此长期维护两套完整高级实现。

## ImageDocument Compatibility Layer

建议目录：

```text
packages/
  image-document/
  image-capabilities/
  image-adapters/
    native-web/
    photocraft/
    psd/
    ai/
```

主业务和项目数据始终依赖自己的 ImageDocument。

## Simple / Advanced Mode

Simple Mode 默认展示：

```text
Remove BG
White BG
Scene
Enhance
Resize
Text
Logo
Shadow
Generate
Batch
```

Advanced Mode 才展示：

```text
Layers
Masks
Curves
Levels
Effects
Filters
Advanced Selection
PSD
```

Advanced 能力允许标 Beta。

## 自研边界

长期原则：

> **我们自研“电商创作工作流”，不自研“Photoshop”。**

核心投入应该放在：

```text
Ecommerce Workflow
Batch
Templates
Brand
Product Identity
AI Editing
Turn into Motion
Motion
Visual QA
Enterprise
```

## 与 Motion Studio 隔离

Motion Studio 不直接依赖 PhotoCraft。

```text
Motion Scene
→ Asset Renderer
→ ImageDocument
→ Capability Router
→ Native / PhotoCraft / AI
```

PhotoCraft 不可用时，Motion Studio 主流程仍应可运行。

## Image Studio 开发阶段调整

### Phase 3A — Thin Native Editor Core
Canvas / Selection / Transform / Crop / Basic Text / Layer List / Asset Placement / Undo-Redo Shell / Basic Export

### Phase 3B — AI Ecommerce Image
Remove BG / White BG / AI Edit / Product Scene / Enhance / Product Identity Lock / Multi-size Export

### Phase 3C — Ecommerce Workflow Engine
Batch / Banner / Detail Images / Templates / Brand Integration / Preset Workflow

### Phase 3D — PhotoCraft Adapter Beta
Masks / Curves / Adjustment Layers / Layer Styles / PSD / Traditional Filters

### Phase 3E — Progressive Capability Migration
随着 PhotoCraft 成熟，仅通过 Capability Router 替换 Executor，不改 UI、ImageDocument、业务流程和用户项目格式。

## 进度原则

PhotoCraft 任何单项功能都不得成为主产品上线阻塞项。

核心电商路径使用 Native / AI / minimal fallback 完成；专业 Photoshop 深度能力可以 WAIT。

# Part B — AI Motion Studio

## 19. 主流程

User Input → Creative Brief → Brand Intelligence → Reference Analysis → Design Exploration → Style Bible → Storyboard → Storyboard Editor → Asset Resolution → Scene Planning → Engine Router → Scene Generation → Scene Editor → Visual QA → Final Composition → Export

## 20. Storyboard Editor

支持：

- Add
- Delete
- Duplicate
- Reorder
- Split
- Merge
- Duration
- Narration
- Visual Description
- Camera
- Transition
- Lock
- AI Rewrite
- Multi-select

Locked Scene 不允许 AI 自动覆盖。

## 21. Design Exploration

先生成 3~4 个视觉方向。

每个包含：

- Style Frame
- Palette
- Typography
- Composition
- Motion Direction

选定后形成 Master Visual Reference。

## 22. Brand Intelligence

输入官网、Logo、品牌手册、产品图、历史广告。

输出 Brand Bible：

- Logo
- Colors
- Typography
- Tone
- Image Style
- Motion Style
- Forbidden Style
- Approved Assets

## 23. Style Bible

统一：

- Visual Language
- Palette
- Typography
- Shape
- Lighting
- Composition
- Camera
- Motion
- Forbidden Styles

编译 Design Tokens。

## 24. Reference System

- STYLE_REFERENCE
- PRODUCT_REFERENCE
- CHARACTER_REFERENCE
- ENVIRONMENT_REFERENCE
- SCENE_REFERENCE

## 25. MotionDocument

高级 Motion Scene：

- Layers
- Timeline
- Keyframes
- Effects
- Masks
- Track Mattes
- Camera
- Lights
- Expressions
- Assets

## 26. HyperFrames

默认 Scene Engine。

支持：

- HTML
- SVG
- CSS
- GSAP
- D3
- Canvas
- Three.js
- Lottie

Scene 首先产出可编辑源，不直接只产 MP4。

## 27. Three.js

用于：

- 产品旋转
- 轻量 3D
- 3D 数据
- 技术可视化
- 交互 3D

## 28. Blender

用于：

- 高端产品动画
- 真实材质
- 复杂灯光
- 机械拆解
- Premium 3D

独立 Blender Worker。

## 29. 2.5D

图片 → Foreground / Midground / Background / Depth / Camera

支持 Parallax、Push、Pull、Pan、DOF。

## 30. Image → 3D

后续：

Product Image → Cutout → Reconstruction / Depth Mesh → GLB → Three.js

## 31. Remotion

只负责 Final Composition：

- Scene 拼接
- Audio
- Voice
- Caption
- Final Timeline

HyperFrames 负责场景怎么动；Remotion 负责整部视频怎么拼。

## 32. Scene Editor

Assets / Layers | Canvas | Inspector
Timeline
AI Bar

AI Scope：

- Selected Element
- Selected Layer
- Current Scene
- Selected Scenes
- Entire Project

重要 AI 修改支持 Accept / Reject / Compare。

一次 AI 操作是一个 Undo Unit。

---

# Part C — Shared Platform

## 33. Asset Intelligence

Asset Types：

- IMAGE
- VIDEO
- AUDIO
- SVG
- FONT
- 3D_MODEL
- DOCUMENT

Sources：

- USER_UPLOAD
- AI_GENERATED
- AI_EDITED
- WEBSITE_IMPORTED
- BRAND_LIBRARY
- EXAMPLE_LIBRARY
- STOCK
- BLENDER_RENDER

保存：

- origin
- derivatives
- usage
- tags
- provenance
- reference role
- version

## 34. AI Image Provider

统一 ImageProvider：

- generate()
- edit()

可接：

- OpenAI
- Google
- 国内模型
- ComfyUI
- Self-hosted

## 35. Visual Quality

Image QA：

- subject correctness
- product identity
- resolution
- cropping
- artifact
- unexpected text
- brand consistency
- layout

Motion QA：

- composition
- hierarchy
- typography
- color
- spacing
- graphics
- consistency
- motion
- clarity
- professionalism

目标评分 >= 85。

## 36. Anti-AI Look

默认禁止：

- 蓝紫渐变泛滥
- Glow 泛滥
- Glassmorphism 泛滥
- Card overload
- 随机圆角
- Emoji 专业图标
- 所有元素都动
- 随机 Bounce
- 随机 360° 旋转
- 无意义粒子

## 37. Templates / Example Factory

Image Templates：

- Amazon 主图
- Shopify Banner
- A+ 图
- Instagram 广告
- 产品卖点图

Motion Templates：

- Product Reveal
- Tech Explainer
- Data Story
- Logo Reveal
- 3D Product

内部 Example Factory：

Brief → Generate → Validate → Visual QA → Polish → Human Approval → Publish

---

# Part D — Agent Runtime

## 38. Agent Runtime

吸收 Octop 思想：

- Agent
- Skill
- Workspace
- Browser
- Knowledge
- Connector
- Sandbox

后台角色：

- Creative Director
- Image Director
- Storyboard Director
- Visual Director
- Motion Designer
- 3D Artist
- Brand Researcher
- Quality Director

## 39. Octop 策略

不把 Octop 当主 SaaS 后端。

不做每用户一个 Octop。

定义：

AgentRuntime
- NativeAgentRuntime
- OctopAdapter

只借 Skills、Workspace、Browser、Knowledge、Connector、Agent lifecycle。

## 40. Browser Research Agent

用于：

- 分析品牌官网
- 分析参考网页
- 抓产品图
- 截图
- Motion DNA
- Brand Bible

## 41. Knowledge Base

企业上传：

- 产品说明书
- 品牌手册
- 历史广告
- PDF
- 产品资料
- 设计规范

## 42. Connectors

后续支持：

- Google Drive
- OneDrive
- SharePoint
- Dropbox
- Shopify
- Figma
- Notion
- DAM
- CMS

---

# Part E — SaaS Core

## 43. 通用 SaaS Core

服务：

- AI Image Studio
- AI Motion Studio
- Interior AI
- Future Products

负责：

- Auth
- Users
- Organizations
- Workspaces
- Products
- Plans
- Entitlements
- Credits
- Usage
- Billing
- Payments
- License
- RBAC
- Rate Limits
- Concurrency
- Audit
- Admin

## 44. 登录

Cloud：

- Email
- Password
- Magic Link
- Google

国内可加：

- 手机号
- 微信

Enterprise：

- OIDC
- SAML
- LDAP
- AD
- 企业微信
- 钉钉
- 飞书

## 45. 用户结构

User → Organization → Workspace → Project

Project Type：

- IMAGE
- MOTION
- INTERIOR

## 46. Entitlements

不要 `if plan == pro`。

使用 Plan + Entitlements。

## 47. Credits

Wallet + Immutable Credit Ledger

Types：

- GRANT
- PURCHASE
- RESERVE
- COMMIT
- REFUND
- REVERSAL
- ADMIN_ADJUSTMENT

昂贵任务：

Estimate → Reserve → Run → Commit Actual → Refund Difference

## 48. Usage Metering

统一记录 Image / Motion / Interior 操作。

进入 Pricing Engine。

价格后台配置，不硬编码。

---

# Part F — Deployment

## 49. 三种部署模式

同一代码库：

- Cloud
- Enterprise
- AirGap

## 50. Cloud

- Public Signup
- Subscription
- Credit Pack
- Online Payment
- Shared Worker Pool
- External AI
- Cloud Storage

## 51. Enterprise

- No Public Signup
- SSO
- License
- Private Storage
- Private Model
- Audit
- Retention
- Dedicated Workers

## 52. AirGap

- No Internet
- Local Models
- Local Fonts
- Local JS
- Local Storage
- Offline License

## 53. Provider Adapters

必须抽象：

- AuthProvider
- BillingProvider
- LicenseProvider
- ModelProvider
- ImageProvider
- VideoProvider
- TTSProvider
- EmbeddingProvider
- StorageProvider
- NotificationProvider
- TelemetryProvider
- AgentRuntime

---

# Part G — Security / Runtime

## 54. 安全

AI 生成代码不在 API Server 执行。

必须：

- Sandbox
- CSP
- Dependency Allowlist
- Network Restriction
- CPU/RAM Limit
- Timeout
- Temporary FS

防：

- SSRF
- Path Traversal
- Tenant Escape
- Malicious SVG
- Malicious HTML

## 55. Workers

- Generation Worker
- Image Worker
- Browser Worker
- Vision Worker
- Render Worker
- Blender Worker

状态：

PENDING / RESERVED / RUNNING / VALIDATING / REVIEWING / RENDERING / SUCCEEDED / FAILED / CANCELED

---

# Part H — Tech Stack

## 56. 技术栈

Frontend：
Next.js / React / TypeScript / Tailwind / shadcn/ui / Zustand / TanStack Query / Zod

Backend：
NestJS / TypeScript

DB：
PostgreSQL / Prisma

Queue：
Redis / BullMQ

Storage：
S3 / OSS / COS / MinIO

Animation：
HyperFrames / SVG / GSAP / Three.js

Advanced：
Blender / Remotion / EffectCraft-like / PhotoCraft-like / VectorCraft-like adapters

Testing：
Vitest / Playwright

Observability：
OpenTelemetry / Sentry

## 57. Monorepo

apps/
- web
- api
- admin

packages/
- shared
- database
- auth
- saas-core
- billing
- credits
- ai-gateway
- asset-engine
- image-document
- vector-document
- motion-document
- storyboard
- scene-schema
- render-engine
- hyperframes-engine
- three-engine
- blender-engine
- remotion-engine
- agent-runtime
- quality-engine
- example-engine

workers/
- generation-worker
- image-worker
- browser-worker
- vision-worker
- render-worker
- blender-worker

---

# Part I — Development Phases

## Phase 0 — Foundation

Monorepo / DB / Redis / Storage / CI / Docker / Design System

## Phase 1 — SaaS Core

Auth / User / Org / Workspace / Product / Plan / Entitlement / Credits / Ledger

## Phase 2 — Asset Foundation

Upload / Asset Library / Thumbnail / Processing / Provenance / Usage Tracking

## Phase 3 — AI Image Studio MVP

ImageDocument / Image Editor / Remove BG / White BG / AI Edit / Identity Lock / Multi-size Export

## Phase 4 — Ecommerce Image Workflows

Product Scene / Banner / Detail Images / Batch Processing / Templates

## Phase 5 — Motion Foundation

Creative Brief / Storyboard / Style Bible / Brand Bible

## Phase 6 — HyperFrames Golden Spike

Typography / SVG / GSAP / Chart / Three.js

## Phase 7 — Scene Generator

SceneSchema / Generation / Browser QA / Repair

## Phase 8 — Motion Editor

Canvas / Inspector / Timeline / AI Bar / Undo / Redo

## Phase 9 — Visual QA

Image QA / Aesthetic QA / Consistency QA / Motion QA

## Phase 10 — Gallery / Example Factory

Image Templates / Motion Templates / Golden Cases / Remix

## Phase 11 — Billing Production

Subscription / Payment / Credit Pack / Webhook / Invoice

## Phase 12 — Audio / Remotion

Voice / Music / Caption / Final Composition

## Phase 13 — Agent Runtime

Skills / Browser / Workspace / Knowledge / OctopAdapter

## Phase 14 — Enterprise

Deployment Profiles / SSO / License / Private Model / Audit / AirGap

## Phase 15 — Advanced 3D

2.5D / Image-to-3D / Blender / Premium Product Video

---

# Part J — Codex Development Policy

## 58. 默认开发档

GPT-5.6 Sol / Medium

## 59. LOW

Docs / Lint / Small UI / Simple CRUD / Tests / Types

推荐：
GPT-5.6 Sol / Low

## 60. NORMAL

Normal Feature / API / Asset / Image UI / Provider Adapter

推荐：
GPT-5.6 Sol / Medium

## 61. HIGH

ImageDocument / MotionDocument / Scene Editor / Storyboard Editor / Render Pipeline / Undo-Redo / Complex State / Migration

推荐：
GPT-5.6 Sol / High
或 GPT-6 Astra / Medium-High

## 62. CRITICAL

Credits / Billing / Tenant Isolation / Sandbox / SSO / Security / Agent Runtime / AirGap / Large Migration

推荐：
GPT-6 Astra / High

极难问题才 XHigh。

## 63. 每次任务固定流程

Read PROJECT_SPEC
→ Read Context
→ Read Current State
→ Read ADR
→ Inspect Code
→ Classify Risk
→ Recommend Model
→ Write Plan
→ Implement
→ Test
→ Review Diff
→ Update Docs

## 64. 独立 Review

以下模块必须 fresh context Review：

- Credits
- Billing
- Auth
- RBAC
- Creative Document
- Scene Editor
- Sandbox
- Agent Runtime
- Enterprise Deployment

---

# Part K — Quality Gates

## 65. Image Definition of Done

- Original preserved
- ImageDocument valid
- Undo/Redo works
- Export works
- No asset loss
- Product Identity Lock tested
- Visual QA passed

## 66. Motion Definition of Done

- Runtime success
- No critical console error
- No overflow
- Render success
- Aesthetic >= 85
- Consistency >= 85

## 67. SaaS Core Definition of Done

- Tenant isolation
- Idempotency
- Concurrency test
- Failure/retry
- Audit
- Migration

---

# 68. 商业策略

Image Studio：

高频、低门槛、适合拉新。

Motion Studio：

相对低频、更高价值、更高客单。

最关键增长路径：

Image User
→ 积累产品图 / Brand / Assets
→ Turn into Motion
→ Motion User

因此 Image Studio 不只是一个功能，也是 Motion Studio 的高频获客入口。

---

# 69. 最终产品结构

Products：

- AI Image Studio
- AI Motion Studio
- Interior AI

共享：

- SaaS Core
- AI Gateway
- Asset System
- Brand System
- Agent Runtime
- Enterprise Platform

---

# 70. 最终护城河

不是某个模型。

而是：

ImageDocument
+ MotionDocument
+ Asset Intelligence
+ Brand Intelligence
+ Storyboard
+ Product Identity Lock
+ Batch Ecommerce Workflows
+ Engine Router
+ Visual QA
+ Agent Runtime
+ Editable Output
+ SaaS Core
+ Enterprise Deployment

---

# 71. 最终用户体验示例

用户上传 20 张商品图：

批量抠图
→ 白底图
→ 场景图
→ Banner
→ 详情页图
→ Turn into Motion
→ 产品视频
→ TikTok / Instagram / YouTube 多尺寸导出

整套流程在一个平台内完成。

---

# 72. 最终成功标准

> 让电商、品牌和企业用户可以在一个 AI 原生平台中，从商品图开始，一路完成修图、设计、动画、视频和 3D 内容生产，并且结果可编辑、可复用、可批量、可品牌化、可私有部署。
