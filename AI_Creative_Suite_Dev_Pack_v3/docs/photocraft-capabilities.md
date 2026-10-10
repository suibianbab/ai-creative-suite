# PhotoCraft Capability Watchlist

| Capability | Business Need | Decision | Preferred Provider | Fallback | Notes |
|---|---|---|---|---|---|
| Transform | High | BUILD | Native | - | Core UX |
| Crop | High | BUILD | Native | - | Core UX |
| Basic Text | High | BUILD | Native | - | Core ecommerce need |
| Basic Adjustments | High | BUILD | Native | - | Brightness, contrast, saturation and approximate exposure; advanced tonal controls stay with PhotoCraft |
| Masked Product Recolor | High | BUILD | Native | - | Approximate whole-mask color change with source shading; labels and multicolor products require manual review |
| Basic Shadow | High | BUILD | Native | - | Cheap and frequent |
| Remove BG | High | AI_PROVIDER | AI | simple mask | Ecommerce critical |
| Generative Fill | High | AI_PROVIDER | AI | unavailable | Do not reimplement |
| Curves | Medium | INTEGRATE | PhotoCraft | none | Advanced mode |
| Levels | Medium | INTEGRATE | PhotoCraft | none | Advanced mode |
| Advanced Mask | Medium | INTEGRATE | PhotoCraft | simple native mask | Beta |
| Layer Effects | Medium | INTEGRATE | PhotoCraft | rasterized preview | Beta |
| PSD Import | Medium | INTEGRATE | PhotoCraft | flattened import | Beta |
| PSD Export | Low/Medium | INTEGRATE | PhotoCraft | none | Beta |
| Smart Objects | Low | WAIT | - | - | Do not build now |
| Advanced Channels | Low | WAIT | - | - | Not ecommerce MVP |
| Liquify | Low | WAIT | - | - | Not ecommerce MVP |
| Professional Color Management | Low | WAIT | - | - | Not MVP |
| Advanced Brush Engine | Low | WAIT | - | - | Not MVP |

Before adopting a new PhotoCraft release, add current upstream status, pinned version, compatibility results and migration notes.
