# PhotoCraft Capability Watchlist

2026-10-10: ADR-0012 supersedes the earlier native-first classification. `INTEGRATE` below is the target routing and still requires a working PhotoCraft bridge. The native implementations remain development/legacy utilities; they are not the long-term primary editor.

| Capability | Business Need | Decision | Preferred Provider | Fallback | Notes |
|---|---|---|---|---|---|
| Transform | High | INTEGRATE | PhotoCraft | legacy native preview | Core editor operation |
| Crop | High | INTEGRATE | PhotoCraft | legacy native preview | `image.crop` verified in local 0.6.0 bridge with editable source pixels retained |
| Basic Text | High | INTEGRATE | PhotoCraft | legacy native preview | Core editor operation |
| Basic Adjustments | High | INTEGRATE | PhotoCraft | legacy native preview | Brightness, contrast, saturation, exposure, vibrance, shadows and highlights use native editable adjustment layers |
| Masked Product Recolor | High | INTEGRATE | PhotoCraft | AI provider / legacy native preview | Verify preservation of labels, texture and shadows |
| Basic Shadow | High | INTEGRATE | PhotoCraft | legacy native preview | Verify editable source |
| Remove BG | High | AI_PROVIDER | AI | simple mask | Ecommerce critical |
| Generative Fill | High | AI_PROVIDER | AI | unavailable | Do not reimplement |
| Curves | Medium | INTEGRATE | PhotoCraft | none | Advanced mode |
| Levels | Medium | INTEGRATE | PhotoCraft | none | Advanced mode |
| Advanced Mask | Medium | INTEGRATE | PhotoCraft | simple native mask | Beta |
| Semantic fine-hair/fur segmentation | High | AI_PROVIDER | Existing BiRefNet mask into PhotoCraft selection | PhotoCraft native tools and mask brush | 0.6.0 and isolated 0.7.0 native selection failed cat-fur visual QA. Provider-to-native editable mask passed one browser case; premium fine-fur quality remains pending |
| Layer Effects | Medium | INTEGRATE | PhotoCraft | rasterized preview | Beta |
| PSD Import | Medium | INTEGRATE | PhotoCraft | flattened import | Beta |
| PSD Export | Low/Medium | INTEGRATE | PhotoCraft | none | Beta |
| Smart Objects | Low | WAIT | - | - | Do not build now |
| Advanced Channels | Low | WAIT | - | - | Not ecommerce MVP |
| Liquify | Low | WAIT | - | - | Not ecommerce MVP |
| Professional Color Management | High | INTEGRATE | PhotoCraft | WAIT | Display P3 ICC retention and sRGB conversion verified across PNG/JPEG/WebP/TIFF/PSD; CMYK/HDR/soft proof not verified |
| Advanced Brush Engine | Medium | INTEGRATE | PhotoCraft | WAIT | Use editor tools, do not duplicate |

Before adopting a new PhotoCraft release, add current upstream status, pinned version, compatibility results and migration notes.

2026-10-12 猫耳灰色样片：Pinned PhotoCraft 0.6.0 的原生 Hue/Saturation 调整层、主体蒙版与耳朵套索交集、`paint.stroke` 蒙版画笔构成可编辑精修链路。耳根下方指定检查框的最大通道平均改动由 6.79 降至 3.26，耳内采样点保持换色。本例证明 PhotoCraft 蒙版精修可减少溢色；更多毛发和不同背景样本尚未完成商业验收。见 `qa/IMG-019-2026-10-12.md`。

2026-10-12 点提示评估：PhotoCraft `select.quick`、SAM 1、SAM 2.1 的正负点（含范围框）在同一猫耳图上均未达到上述基线；该能力暂列 `AI_PROVIDER` 的候选研究，不接入默认桥接、不替代 PhotoCraft 原生蒙版精修。见 `qa/IMG-020-2026-10-12.md`。
