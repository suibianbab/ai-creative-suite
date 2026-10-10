# Image Studio basic color adjustments

Image layers now support brightness, contrast and saturation from -100 to 100, plus exposure from -2 to 2 stops. A missing `adjustments` field means all four values are neutral, so existing version 1 ImageDocuments reopen without migration. `setAdjustments` is an ImageDocument operation: it validates the range, changes only the selected image layer, supports undo/redo, and leaves the original Asset ID and bytes unchanged. Reset removes the optional adjustment field.

The same canvas renderer is used for preview and PNG export. It applies browser Canvas 2D filters to the image draw only, after mask composition and before selection outlines or text. Exposure uses a power-of-two brightness factor, so it is an approximate display adjustment rather than a color-managed, linear-light photographic exposure tool. Curves, levels and professional color management remain advanced provider capabilities.

The local rule planner accepts explicit numeric instructions such as `亮度调到 20；对比度降低 10；饱和度提高 30；曝光提高 0.5`. It previews all operations and commits them as one undo step. This is still a bounded local command parser, not arbitrary natural-language or generative image editing.

`IMG-001` covers validation, JSON persistence, original references, atomic text instructions and undo/redo. `UI-006` uses a synthetic 256×256 color fixture to verify browser adjustment controls, local and cloud reopen, and export pixels. Release quality still needs visual review on rights-cleared ecommerce images, especially masks, transparency, brand colors and highlight clipping.
