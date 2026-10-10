# Image Studio background replacement spike

Date: 2026-10-10. Scope: local development Image Studio and a synthetic product. This is a functional golden spike, not an advertising-quality acceptance.

## Workflow and boundaries

1. Import a product photograph and attach a same-size cutout mask. Select the masked image layer.
2. Use **试用背景样片** to preview an empty studio plate. In a development server with `IMAGE_BACKGROUND_PROVIDER=openai` and `OPENAI_API_KEY`, **AI 生成背景** requests a new plate from the configured image provider. The prompt asks for an empty product-photography scene with no product, brand or text.
3. Cancel or apply the preview. Apply adds an independent `AI 背景` image layer below the product as one undoable ImageDocument transaction. The product's original asset and mask are not modified. Repeating the action replaces the earlier generated background layer.
4. Position the product on the scene, export PNG, and save the local or development cloud project. The background is an ordinary project asset and is included in project persistence.

The local sample is [`warm-studio-empty.png`](../apps/web/public/samples/warm-studio-empty.png). The app's provider adapter is [`background-provider.ts`](../apps/web/src/app/image-studio/background-provider.ts); composition rules are in [`background-plate.ts`](../packages/image-document/src/background-plate.ts). The API route is development-only because the production path still needs authenticated workspace jobs and the Credit Ledger. It returns 503 without the opt-in configuration, limits prompt size and output PNG size, rejects cross-origin requests, and permits one active generation per server process. Its live provider path has **not** been tested: no API key was available in this environment. The built-in sample exercises the same preview and apply path without external billing.

The optional route uses the [OpenAI Images generation endpoint](https://developers.openai.com/api/reference/resources/images/methods/generate). The model can be set with `IMAGE_BACKGROUND_MODEL`; see [`apps/web/.env.example`](../apps/web/.env.example). Do not put a provider key in a browser environment variable.

## Evidence and quality decision

The image generator made an empty warm stone studio plate and a separate synthetic unbranded pump-bottle photograph. The local mask service made the bottle silhouette. In the browser, the plate previewed behind the unchanged bottle; one undo removed the entire background transaction and redo restored it. A 1080 × 1080 PNG exported, and after a browser reload the local project reopened with both layers. See [`UI-008-2026-10-10.md`](../qa/UI-008-2026-10-10.md) and the ignored local artifacts under `artifacts/background-replacement-spike-2026-10-10/`.

The composite has a plausible studio layout, but the bottle base has no convincing contact shadow and the lighting match is approximate. This sample does **not** pass a final commercial-advertisement quality gate. Transparent and reflective products remain harder because an ordinary opaque mask cannot reconstruct refracted light, reflection or new-background color spill. Before that gate, the editor needs explicit subject-to-surface alignment, contact-shadow/light matching and full-size edge review across varied products. The provider route also needs real generation, auth, credits, moderation and failure-path tests before product exposure.

Synthetic source prompts are recorded in the UI-008 report for reproducibility. No third-party product rights are implicated by this sample.
