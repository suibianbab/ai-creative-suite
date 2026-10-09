"use client";

import type { ImageLayer, MaskStroke } from "@acs/image-document";
import { useEffect, useRef, useState } from "react";
import { type ImageAssetMap, maskedSource } from "./render";

type Props = {
  layer: ImageLayer;
  assets: ImageAssetMap;
  onStroke: (stroke: MaskStroke) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onClose: () => void;
};

type PreviewBackground = "checker" | "white" | "black" | "magenta";

const previewBackgrounds: { value: PreviewBackground; label: string }[] = [
  { value: "checker", label: "棋盘" },
  { value: "white", label: "白底" },
  { value: "black", label: "黑底" },
  { value: "magenta", label: "高对比" },
];

export function MaskReview({
  layer,
  assets,
  onStroke,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onClose,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<MaskStroke | null>(null);
  const [mode, setMode] = useState<MaskStroke["mode"]>("erase");
  const [radius, setRadius] = useState(18);
  const [zoom, setZoom] = useState(1);
  const [showOriginal, setShowOriginal] = useState(false);
  const [background, setBackground] = useState<PreviewBackground>("checker");
  const scale = Math.min(
    1,
    1000 / Math.max(layer.sourceWidth, layer.sourceHeight),
  );
  const previewWidth = Math.round(layer.sourceWidth * scale);
  const previewHeight = Math.round(layer.sourceHeight * scale);
  const renderScale = Math.min(1, scale * zoom);
  const renderWidth = Math.round(layer.sourceWidth * renderScale);
  const renderHeight = Math.round(layer.sourceHeight * renderScale);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
  }, [zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    context.fillStyle =
      background === "white"
        ? "#ffffff"
        : background === "black"
          ? "#111111"
          : background === "magenta"
            ? "#eb2596"
            : "#c8d4ce";
    context.fillRect(0, 0, renderWidth, renderHeight);
    if (background === "checker") {
      context.fillStyle = "#eef2ed";
      const cell = Math.max(
        1,
        Math.round((24 * renderWidth) / (previewWidth * zoom)),
      );
      for (let y = 0; y < renderHeight; y += cell) {
        for (let x = 0; x < renderWidth; x += cell) {
          if ((x / cell + y / cell) % 2 === 0)
            context.fillRect(x, y, cell, cell);
        }
      }
    }
    const source = showOriginal
      ? assets[layer.assetId]
      : maskedSource(layer, assets);
    if (source) context.drawImage(source, 0, 0, renderWidth, renderHeight);
  }, [
    layer,
    assets,
    previewWidth,
    zoom,
    renderWidth,
    renderHeight,
    showOriginal,
    background,
  ]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(
        layer.sourceWidth,
        Math.max(
          0,
          ((event.clientX - bounds.left) / bounds.width) * layer.sourceWidth,
        ),
      ),
      y: Math.min(
        layer.sourceHeight,
        Math.max(
          0,
          ((event.clientY - bounds.top) / bounds.height) * layer.sourceHeight,
        ),
      ),
    };
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (showOriginal || !layer.mask) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    strokeRef.current = { mode, radius, points: [point(event)] };
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = strokeRef.current;
    if (!stroke) return;
    const next = point(event);
    const previous = stroke.points[stroke.points.length - 1]!;
    if (Math.hypot(next.x - previous.x, next.y - previous.y) < 2) return;
    stroke.points.push(next);
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.strokeStyle = mode === "erase" ? "#e4554f" : "#3b9e66";
    context.lineWidth = Math.max(2, radius * 2 * renderScale);
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(previous.x * renderScale, previous.y * renderScale);
    context.lineTo(next.x * renderScale, next.y * renderScale);
    context.stroke();
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = strokeRef.current;
    if (!stroke) return;
    strokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    onStroke(stroke);
  }

  return (
    <div className="mask-dialog-backdrop" role="presentation">
      <section className="mask-dialog" aria-label="蒙版修正">
        <div className="mask-dialog-header">
          <div>
            <h2>蒙版修正</h2>
            <p>
              笔刷只修改透明度；原图颜色和细节保持原样。按画布中的撤销可回退整笔。
            </p>
          </div>
          <button type="button" onClick={onClose}>
            完成
          </button>
        </div>
        <div className="mask-controls">
          <button
            type="button"
            className={mode === "erase" ? "active" : ""}
            onClick={() => setMode("erase")}
          >
            擦除背景残留
          </button>
          <button
            type="button"
            className={mode === "restore" ? "active" : ""}
            onClick={() => setMode("restore")}
          >
            恢复主体
          </button>
          <label>
            笔刷 {radius}px
            <input
              type="range"
              min="2"
              max="120"
              value={radius}
              onChange={(event) => setRadius(Number(event.target.value))}
            />
          </label>
          <label>
            缩放 {zoom}×
            <input
              type="range"
              min="1"
              max="4"
              step="0.5"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            className={showOriginal ? "active" : ""}
            onClick={() => setShowOriginal(!showOriginal)}
          >
            {showOriginal ? "返回蒙版" : "对比原图"}
          </button>
          <div
            className="mask-background-controls"
            role="group"
            aria-label="蒙版预览背景"
          >
            {previewBackgrounds.map((option) => (
              <button
                key={option.value}
                type="button"
                className={background === option.value ? "active" : ""}
                aria-pressed={background === option.value}
                onClick={() => setBackground(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={onUndo} disabled={!canUndo}>
            撤销
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo}>
            重做
          </button>
        </div>
        <div className="mask-preview-scroll" ref={scrollRef}>
          <canvas
            ref={canvasRef}
            width={renderWidth}
            height={renderHeight}
            style={{ width: previewWidth * zoom, height: previewHeight * zoom }}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            aria-label="在原图坐标中绘制蒙版修正"
          />
        </div>
        <p className="mask-footnote">
          切换白底、黑底与高对比色检查残留和边缘；预览背景不会写入项目或导出。蒙版尺寸必须与原图一致，半透明玻璃仍需专门的材质处理。
        </p>
      </section>
    </div>
  );
}
