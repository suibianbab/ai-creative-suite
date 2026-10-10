# Image Studio text-instruction MVP

The editor now uses a local Qwen3 8B model through Ollama to translate conversational Chinese into a bounded set of existing ImageDocument operations. The model returns canonical clauses, never raw document operations or asset IDs. `planModelImageInstruction` validates the response with the same local planner and ImageDocument operation layer as manual editing. The user sees a canvas preview and operation list before applying. Applying up to four clauses creates one undo step. The source image asset and its pixels remain unchanged. If Ollama is unavailable, exact local-rule commands still work.

Supported examples:

- `改成竖图` (also `方图`, `横图`, `1:1`, `4:5`, `16:9`)
- `背景改成白色` (also `黑色`, `浅灰色`, or a six-digit hex color)
- `把商品移到右边` (also `左边`, `中间`, `顶部`, `底部`)
- `添加标题：秋日新品` or `标题改为「秋日新品」`
- `把商品亮度调到 20；对比度降低 10；饱和度提高 30；曝光提高 0.5` (brightness/contrast/saturation: -100 to 100; exposure: -2 to 2 stops)
- `改成竖图；背景改成浅灰色；把商品移到右边；添加标题：秋日新品`

The model adapter splits comma/semicolon-separated requests and asks the model to account for every segment. It rejects a request if any segment is unsupported; known ambiguous `长图` is rejected rather than guessed. The planner rejects unsupported, overly long, or invalid operations before changing the document. A multi-clause request never commits a partial result. Editing the document or instruction after preview invalidates that preview. A selected image or text layer is used; when there is exactly one layer of the required kind, it can be selected implicitly.

This is **model-backed language understanding for the existing operation set**, not unrestricted image editing. It does not generate scenes, perform inpainting, remove blemishes, change product pixels, or provide professional color management. Those effects require a separate image provider and quality review. PhotoCraft classification: basic edits are `BUILD`, generative edits are `AI_PROVIDER`, professional color management is `WAIT`. Only the instruction text is sent to the workstation's loopback Ollama API; no image pixels or external service receive it. The route is enabled in Next development mode or by setting `IMAGE_INSTRUCTION_PROVIDER=ollama` for a local production build. The model defaults to `qwen3:8b` and may be changed with `IMAGE_INSTRUCTION_OLLAMA_MODEL`. Cloud deployment needs the shared authenticated AI Gateway, usage controls and provider abstraction before enabling this route publicly.

Verification: `pnpm test` covers model-output validation, one-step undo, source asset preservation, adjustment range validation, JSON persistence, and all-or-nothing rejection. `pnpm lint`, `pnpm typecheck`, and `pnpm build` are the local gates. Live Qwen3 checks include “让商品稍微亮一点，背景换成浅灰色” and an unsupported mixed re-paint request. Browser QA should import one product image, inspect the AI preview, apply, undo once, and check that an unsupported mixed request changes nothing. Model interpretation can still be wrong; review the operation list before applying.
