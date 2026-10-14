# PhotoCraft 色彩与导出验证

日期：2026-10-11；固定 PhotoCraft 0.6.0。

工作台读取 PhotoCraft 原生源文件的尺寸、图层数和色彩配置。导出使用 PhotoCraft 自身的 `convert`；可选择保留源 ICC，或先用 `edit.convertToProfile` 转为 sRGB。提供 PNG、JPEG、WebP、TIFF、PSD；原生可编辑项目仍保存为 `.pcraft`。平台没有实现另一个色彩变换引擎。

`IMG-014` 的 Display P3 测试源经上述五种格式导出后，文件内均含 P3 ICC。选择 sRGB 时导出为 sRGB ICC；用 Pillow ImageCms 把 P3 输出转回 sRGB 后，抽样像素与原始 sRGB 图接近。带蒙版的调整层导出 PSD 后重新导入 PhotoCraft，层和蒙版仍可编辑。

这证明基础 ICC 携带与转换链路，没有覆盖 CMYK、HDR、软打样、各浏览器显示器的色彩一致性或复杂 PSD 特性。色彩调整的曲线、色阶等高级工具由 PhotoCraft 画布提供；工作台自然语言入口目前只开放已验证的受限参数。

`IMG-016` 又验证 PhotoCraft 原生 Curves、Levels 调整层分别改变像素，保存 `.pcraft` 及导出 PSD 后重开仍保留两层可编辑调整。工作台浏览器 PSD 导出已实际下载并用 PhotoCraft CLI 重开，1254×1254、两层。高级曲线/色阶的自由交互继续由官方画布负责；工作台只把已验证的暗部/高光单项指令映射到 Curves。
