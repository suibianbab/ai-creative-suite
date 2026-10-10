# Image Studio text-instruction MVP

The current browser editor accepts a small, explicit set of Chinese editing requests. It parses locally into existing `ImageOperation` values and validates them with the same operation layer as manual editing. The user sees a canvas preview and operation list before applying. Applying up to four semicolon-separated clauses creates one undo step. The source image asset and its pixels remain unchanged.

Supported examples:

- `改成竖图` (also `方图`, `横图`, `1:1`, `4:5`, `16:9`)
- `背景改成白色` (also `黑色`, `浅灰色`, or a six-digit hex color)
- `把商品移到右边` (also `左边`, `中间`, `顶部`, `底部`)
- `添加标题：秋日新品` or `标题改为「秋日新品」`
- `把商品亮度调到 20；对比度降低 10；饱和度提高 30；曝光提高 0.5` (brightness/contrast/saturation: -100 to 100; exposure: -2 to 2 stops)
- `改成竖图；背景改成浅灰色；把商品移到右边；添加标题：秋日新品`

The planner rejects unsupported, ambiguous, overly long, or invalid requests before changing the document. A multi-clause request never commits a partial result. Editing the document after preview invalidates that preview. A selected image or text layer is used; when there is exactly one layer of the required kind, it can be selected implicitly.

This is a **rule-based local command MVP**, not model-backed AI image editing. It does not understand arbitrary descriptions, generate scenes, perform inpainting, change product pixels, or make claims about visual quality. AI image changes remain an AI provider capability behind the capability router; a future model planner must emit validated, reviewable operations and preserve Product Identity Lock. No prompt or image is sent to an external service by this feature.

Verification: `pnpm test` covers one-step undo, source asset preservation, adjustment range validation, JSON persistence, and all-or-nothing rejection. `pnpm lint`, `pnpm typecheck`, and `pnpm build` are the local gates. Browser QA should import one product image, try the combined example, inspect the preview, apply, undo once, redo, save, reopen, and export.
