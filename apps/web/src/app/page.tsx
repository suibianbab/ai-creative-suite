import { PRODUCT_TYPES } from "@acs/shared";
import Link from "next/link";

const products = [
  {
    type: PRODUCT_TYPES[0],
    title: "Image Studio",
    description: "导入商品图，编辑构图与文字，并导出 PNG。",
    label: "编辑原型可试用",
  },
  {
    type: PRODUCT_TYPES[1],
    title: "Motion Studio",
    description: "可编辑的分镜、动画、视频与 3D 内容。",
    label: "即将开发",
  },
] as const;

export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          ✦
        </div>
        <span className="brand-name">AI Creative Suite</span>
        <span className="phase-tag">Foundation</span>
      </header>

      <section className="intro" aria-labelledby="intro-heading">
        <p className="eyebrow">一个工作区 · 两种创作方式</p>
        <h1 id="intro-heading">从商品图片，到每一种动态表达。</h1>
        <p className="intro-copy">
          图片编辑原型已开放；AI 修图、动画与 3D 能力将继续经过样片验证后接入。
        </p>
      </section>

      <section className="product-grid" aria-label="产品线">
        {products.map((product) => (
          <article className="product-card" key={product.type}>
            <div className="card-head">
              <span className="product-type">{product.type}</span>
              <span className="status">{product.label}</span>
            </div>
            <h2>{product.title}</h2>
            <p>{product.description}</p>
            {product.type === "IMAGE" && (
              <Link className="product-link" href="/image-studio">
                打开 Image Studio →
              </Link>
            )}
          </article>
        ))}
      </section>

      <footer>Phase 0 · 基础服务建设中</footer>
    </main>
  );
}
