"use client";

import type { MediaAsset } from "@acs/video-document";
// P2.5-T3 素材面板（spec §2.2 U4/X1）：file input → POST /api/media/ingest →
// 账本追加 + 保存由页面回调完成；失败行内中文错误，文档零改动。
import { useRef, useState } from "react";
import { assetLabel } from "./media-assets";

export function MediaPanel({
  assets,
  busy,
  onUpload,
}: {
  assets: MediaAsset[];
  busy: boolean;
  onUpload: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <section className="media-panel">
      <h4>素材</h4>
      {assets.length === 0 ? (
        <p className="media-empty">
          尚无素材——上传 mp4/webm/mov 或 png/jpg/webp（≤500MB，仅本地开发环境）
        </p>
      ) : (
        <ul className="media-list">
          {assets.map((asset) => (
            <li key={asset.assetId} className="media-item">
              {assetLabel(asset, assets)}
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
      />
      <button
        type="button"
        className="media-upload"
        disabled={busy || uploading}
        onClick={async () => {
          const file = inputRef.current?.files?.[0];
          if (!file) {
            setUploadError("请先选择文件");
            return;
          }
          setUploading(true);
          setUploadError(null);
          try {
            await onUpload(file);
            if (inputRef.current) inputRef.current.value = "";
          } catch (error) {
            setUploadError(
              error instanceof Error ? error.message : String(error),
            );
          } finally {
            setUploading(false);
          }
        }}
      >
        上传素材
      </button>
      {uploadError ? (
        <p className="media-upload-error" role="alert">
          {uploadError}
        </p>
      ) : null}
    </section>
  );
}
