import { routeImageCapability } from "@acs/image-document";

export interface BackgroundRemovalProvider {
  createMask(original: File): Promise<File>;
}

class LocalMaskProvider implements BackgroundRemovalProvider {
  async createMask(original: File): Promise<File> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(
        "http://127.0.0.1:4101/v1/masks/remove-background",
        {
          method: "POST",
          headers: { "Content-Type": original.type },
          body: original,
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const message = (await response.text()).slice(0, 180);
        throw new Error(message || `蒙版服务返回 HTTP ${response.status}`);
      }
      if (!response.headers.get("Content-Type")?.startsWith("image/png")) {
        throw new Error("蒙版服务返回了非 PNG 内容");
      }
      const blob = await response.blob();
      if (blob.size === 0) throw new Error("蒙版服务返回了空文件");
      return new File([blob], `${original.name}-mask.png`, {
        type: "image/png",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        throw new Error("蒙版服务超时，请稍后重试");
      if (error instanceof TypeError)
        throw new Error(
          "无法连接本机蒙版服务，请先启动 local_mask_provider.py",
        );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function removeBackground(original: File): Promise<File> {
  if (routeImageCapability("remove-bg") !== "ai-provider")
    throw new Error("抠图 Provider 路由配置错误");
  const provider: BackgroundRemovalProvider = new LocalMaskProvider();
  return provider.createMask(original);
}
