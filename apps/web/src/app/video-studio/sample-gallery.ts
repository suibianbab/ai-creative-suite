import {
  applyStyleBible,
  type MediaAsset,
  type SceneSource,
  type StyleBible,
  styleSceneSpec,
  type VideoProject,
  validateVideoProject,
} from "@acs/video-document";
import {
  defaultRegistry,
  type SceneSpec,
  validateSceneSpec,
} from "@acs/video-scene";

export type GallerySampleId =
  | "stem"
  | "data"
  | "product"
  | "renovation"
  | "appliance"
  | "quarterly";

export const GALLERY_SAMPLES: ReadonlyArray<{
  id: GallerySampleId;
  title: string;
  summary: string;
  detail: string;
  poster: string;
}> = [
  {
    id: "stem",
    title: "水循环 · STEM 解说",
    summary: "水循环七镜头解说：蒸发、凝结、降水与汇流",
    detail: "7 镜头 · 约 26 秒 · 环形总览＋分步图解，可改文字与流程",
    poster: "/samples/p4-stem.svg",
  },
  {
    id: "data",
    title: "季度销量 · 数据动画",
    summary: "标题、柱状对比、关键数字、结论",
    detail: "4 镜头 · 约 9 秒 · 可改图表数据与标题",
    poster: "/samples/p4-data.svg",
  },
  {
    id: "product",
    title: "FORM 01 帽子 · 产品展示",
    summary: "产品开场、真实商品画面、局部画面、卖点收尾",
    detail: "5 镜头 · 约 12 秒 · 可上传自己的视频替换商品素材",
    poster: "/samples/p4-product.png",
  },
  {
    id: "renovation",
    title: "两房变三房 · 家装方案",
    summary: "前后对比＋里程碑时间轴＋流程＋户型示意的完整家装讲解",
    detail:
      "7 镜头 · 约 24 秒 · 可改对比数值、时间轴节点、流程、标注与户型线稿",
    poster: "/samples/p4-renovation.svg",
  },
  {
    id: "appliance",
    title: "换滤芯四步 · 设备操作",
    summary: "操作流程＋安全提醒＋维护参数的设备指南",
    detail: "5 镜头 · 约 16.5 秒 · 可改步骤、提醒与周期数字",
    poster: "/samples/p4-appliance.svg",
  },
  {
    id: "quarterly",
    title: "季度业务数据简报 · 演示数据",
    summary: "数据图＋前后对比＋里程碑时间轴＋入场时序可调的完整简报",
    detail: "6 镜头 · 约 22 秒 · 演示数据，可改数值、入场时长与时序预设",
    poster: "/samples/p4-data.svg",
  },
];

const STEM_PALETTE = {
  background: "#101f34",
  foreground: "#f3f5f7",
  secondary: "#b4d8e4",
  accent: "#f5b652",
  object: "#42a5a0",
};
const DATA_PALETTE = {
  background: "#122137",
  foreground: "#f5f7fa",
  secondary: "#afcde6",
  accent: "#ffbc60",
  object: "#4a9fdb",
};
const RENOVATION_PALETTE = {
  background: "#241c14",
  foreground: "#f5efe6",
  secondary: "#e3cfae",
  accent: "#d97a3d",
  object: "#7d8b5a",
};
const APPLIANCE_PALETTE = {
  background: "#141a22",
  foreground: "#eef3f8",
  secondary: "#c3d4e6",
  accent: "#4aa3d9",
  object: "#5b7fa6",
};
const QUARTERLY_PALETTE = {
  background: "#0d1f2d",
  foreground: "#e8f0f8",
  secondary: "#a8c8e0",
  accent: "#ff9e4f",
  object: "#4a9d9d",
};

type SampleShot = {
  durationMs: number;
  description: string;
  narrationText: string;
  source: SceneSource;
};

function spec(
  componentId: string,
  durationMs: number,
  seed: number,
  params: Record<string, unknown>,
): SceneSource {
  const scene: SceneSpec = {
    specVersion: 1,
    componentId,
    // Codex P2-4：enterMs/sequence 感知组件用 @2。
    componentVersion:
      componentId === "compare-split" || componentId === "timeline-milestones"
        ? 2
        : 1,
    durationMs,
    seed,
    background: "#ffffff",
    params,
  };
  validateSceneSpec(scene, defaultRegistry);
  return { type: "spec", spec: scene };
}

function text(
  title: string,
  subtitle: string,
  durationMs: number,
  seed: number,
): SceneSource {
  return spec("text-animation", durationMs, seed, {
    title,
    subtitle,
    titleColor: "#1b2c29",
    subtitleColor: "#5d7469",
    entrance: "fade-up",
    enterMs: 450,
  });
}

function sampleShots(
  id: GallerySampleId,
  productAsset?: MediaAsset,
): SampleShot[] {
  if (id === "stem")
    return [
      {
        durationMs: 3000,
        description: "问题开场：一滴水会走过哪里",
        narrationText: "一滴水，会走过哪里？",
        source: text("一滴水的旅程", "水循环是怎样发生的？", 3000, 4101),
      },
      {
        durationMs: 4000,
        description: "总览：水在海洋、天空和陆地间循环",
        narrationText: "水在海洋、天空和陆地间不停移动。",
        source: spec("explainer-composition", 4000, 4102, {
          title: "水循环的四个阶段",
          titleColor: "#f3f5f7",
          textColor: "#f3f5f7",
          boxColor: "#dcebe1",
          arrowColor: "#f5b652",
          strokeColor: "#42a5a0",
          titleY: 145,
          titleEnterMs: 0,
          diagramOffsetX: 0,
          diagramOffsetY: -60,
          diagramEnterMs: 450,
          diagram: {
            kind: "cycle",
            steps: [
              { label: "蒸发", caption: "海面升腾" },
              { label: "凝结", caption: "高空成云" },
              { label: "降水", caption: "雨落大地" },
              { label: "汇流", caption: "江河归海" },
            ],
            centerText: "水循环",
          },
          annotations: [
            {
              text: "太阳能驱动这趟旅程",
              x: 500,
              y: 780,
              portraitY: 1340,
              enterMs: 2800,
            },
          ],
        }),
      },
      {
        durationMs: 4000,
        description: "蒸发：阳光加热海面，液态水变为水蒸气",
        narrationText: "阳光加热海面，水变成水蒸气。",
        source: spec("explainer-composition", 4000, 4103, {
          title: "第一步 · 蒸发",
          titleColor: "#f3f5f7",
          textColor: "#f3f5f7",
          boxColor: "#dcebe1",
          arrowColor: "#f5b652",
          strokeColor: "#42a5a0",
          titleY: 145,
          titleEnterMs: 0,
          diagramOffsetX: 0,
          diagramOffsetY: 40,
          diagramEnterMs: 450,
          diagram: {
            kind: "drawing",
            paths: [
              "M 692 300 A 48 48 0 1 1 788 300 A 48 48 0 1 1 692 300",
              "M 818 300 L 834 300 M 797 345 L 809 357 M 740 360 L 740 376 M 683 345 L 671 357 M 662 300 L 646 300 M 683 255 L 671 243 M 740 240 L 740 224 M 797 255 L 809 243",
              "M 120 590 C 220 572 320 608 420 590 C 520 572 620 608 720 590 C 780 578 840 602 880 590",
              "M 240 630 C 320 616 400 644 480 630 C 560 616 640 644 720 630",
              "M 280 560 C 265 525 295 495 280 460 C 265 425 295 395 280 370",
              "M 360 560 C 345 520 375 485 360 445 C 345 405 375 370 360 330",
              "M 440 560 C 425 530 455 500 440 465 C 425 430 455 400 440 365",
            ],
          },
          diagramLabels: [
            {
              text: "太阳",
              x: 600,
              y: 300,
              targetX: 680,
              targetY: 300,
              enterMs: 500,
            },
            {
              text: "海面",
              x: 180,
              y: 545,
              targetX: 240,
              targetY: 588,
              enterMs: 1100,
            },
            {
              text: "水蒸气",
              x: 360,
              y: 290,
              targetX: 360,
              targetY: 345,
              enterMs: 1700,
            },
          ],
          annotations: [
            {
              text: "阳光加热海面",
              x: 500,
              y: 730,
              portraitY: 1280,
              enterMs: 2000,
            },
            {
              text: "液态水变成水蒸气",
              x: 500,
              y: 785,
              portraitY: 1340,
              enterMs: 2600,
            },
          ],
        }),
      },
      {
        durationMs: 4000,
        description: "凝结：上升的水蒸气遇冷形成云",
        narrationText: "水蒸气上升，遇冷凝结成云。",
        source: spec("sketch-note", 4000, 4104, {
          title: "第二步 · 凝结",
          items: [
            { text: "水蒸气向上升", emphasis: "下划线" },
            { text: "遇冷凝结成云", emphasis: "圈" },
          ],
          inkColor: "#f3f5f7",
          accentColor: "#f5b652",
          writeMs: 900,
          drawMs: 700,
          staggerMs: 500,
        }),
      },
      {
        durationMs: 4000,
        description: "降水：云中水滴聚集并落下",
        narrationText: "云中水滴聚集，落下形成降水。",
        source: spec("explainer-composition", 4000, 4105, {
          title: "第三步 · 降水",
          titleColor: "#f3f5f7",
          textColor: "#f3f5f7",
          boxColor: "#dcebe1",
          arrowColor: "#f5b652",
          strokeColor: "#b4d8e4",
          titleY: 145,
          titleEnterMs: 0,
          diagramOffsetX: 0,
          diagramOffsetY: 20,
          diagramEnterMs: 450,
          diagram: {
            kind: "drawing",
            paths: [
              "M 280 380 C 255 380 245 360 253 341 C 258 324 275 316 292 318 C 303 281 339 259 378 267 C 404 232 457 226 486 252 C 519 250 547 274 551 307 C 578 310 598 331 598 355 C 598 372 584 385 563 385 Z",
              "M 327 440 L 302 508 M 406 440 L 381 508 M 485 440 L 460 508 M 560 440 L 535 508",
              "M 260 603 C 348 580 444 580 532 603 C 610 624 689 624 766 603",
            ],
          },
          diagramLabels: [
            {
              text: "云",
              x: 660,
              y: 300,
              targetX: 590,
              targetY: 320,
              enterMs: 600,
            },
            {
              text: "雨滴",
              x: 640,
              y: 470,
              targetX: 565,
              targetY: 474,
              enterMs: 1400,
            },
            {
              text: "海面",
              x: 790,
              y: 550,
              targetX: 760,
              targetY: 596,
              enterMs: 2000,
            },
          ],
          annotations: [
            {
              text: "云中水滴聚集",
              x: 500,
              y: 725,
              portraitY: 1125,
              enterMs: 1800,
            },
            {
              text: "落下形成降水",
              x: 500,
              y: 780,
              portraitY: 1180,
              enterMs: 2500,
            },
          ],
        }),
      },
      {
        durationMs: 4000,
        description: "汇流：雨水进入河流并回到海洋",
        narrationText: "雨水汇入河流，最终回到海洋。",
        source: spec("explainer-composition", 4000, 4106, {
          title: "第四步 · 汇流",
          titleColor: "#f3f5f7",
          textColor: "#f3f5f7",
          boxColor: "#dcebe1",
          arrowColor: "#f5b652",
          strokeColor: "#42a5a0",
          titleY: 145,
          titleEnterMs: 0,
          diagramOffsetX: 0,
          diagramOffsetY: -75,
          diagramEnterMs: 450,
          diagram: {
            kind: "flow",
            steps: [{ label: "降水" }, { label: "河流" }, { label: "海洋" }],
          },
          annotations: [
            {
              text: "地表与地下径流",
              x: 500,
              y: 740,
              portraitY: 1265,
              enterMs: 2200,
            },
          ],
        }),
      },
      {
        durationMs: 3000,
        description: "结语：点明水循环并邀请继续探索",
        narrationText: "这，就是水循环。",
        source: text("水，循环不息", "四步循环，生生不息", 3000, 4107),
      },
    ];
  if (id === "data")
    return [
      {
        durationMs: 2000,
        description: "开场：介绍季度销量数据",
        narrationText: "季度销量观察。",
        source: text("季度销量观察", "用数据看增长", 2000, 4201),
      },
      {
        durationMs: 2800,
        description: "柱状图对比四个季度",
        narrationText: "第四季度达到最高。",
        source: spec("bar-chart", 2800, 4202, {
          title: "四季度销量对比",
          bars: [
            { label: "一季度", value: 32 },
            { label: "二季度", value: 46 },
            { label: "三季度", value: 58 },
            { label: "四季度", value: 82 },
          ],
          barColor: "#2f6f4f",
          accentColor: "#d9822b",
          textColor: "#1b2c29",
          enterMs: 1400,
        }),
      },
      {
        durationMs: 2200,
        description: "关键数字：四季度 82 单位",
        narrationText: "关键数字是八十二。",
        source: spec("number-counter", 2200, 4203, {
          title: "四季度销量",
          value: 82,
          prefix: "",
          suffix: " 单位",
          decimals: 0,
          countMs: 1400,
          numberColor: "#1b2c29",
          accentColor: "#d9822b",
        }),
      },
      {
        durationMs: 2000,
        description: "收尾：给出增长结论",
        narrationText: "趋势清晰可见。",
        source: text("增长，清晰可见", "替换为你的真实数据", 2000, 4204),
      },
    ];
  if (id === "renovation")
    return [
      {
        durationMs: 3000,
        description: "开场：点出改造目标",
        narrationText: "两房能变三房吗？",
        source: text("两房变三房", "一次讲清改造方案", 3000, 4401),
      },
      {
        durationMs: 4000,
        description: "对比：改造前后空间感变化",
        narrationText: "改造前空间局促，改造后多出一间房。",
        source: spec("compare-split", 4000, 4410, {
          title: "空间利用对比",
          metricLabel: "两房 vs 三房",
          beforeLabel: "改造前",
          beforeValue: "两房",
          beforeNote: "客厅局促采光差",
          afterLabel: "改造后",
          afterValue: "三房",
          afterNote: "多一间多功能房",
          deltaText: "2 房 → 3 房",
          deltaPositive: true,
          textColor: "#f5efe6",
          panelColor: "#3a2c1e",
          accentColor: "#d97a3d",
          positiveColor: "#8bc4a0",
          negativeColor: "#e8837a",
          enterMs: 1200,
        }),
      },
      {
        durationMs: 3500,
        description: "总览：改造四步流程",
        narrationText: "量房、设计、施工、验收，四步走完。",
        source: spec("explainer-composition", 3500, 4402, {
          title: "改造四步",
          titleColor: "#f5efe6",
          textColor: "#f5efe6",
          boxColor: "#e3cfae",
          arrowColor: "#d97a3d",
          strokeColor: "#7d8b5a",
          titleY: 145,
          titleEnterMs: 0,
          diagramOffsetX: 0,
          diagramOffsetY: -75,
          diagramEnterMs: 450,
          diagram: {
            kind: "flow",
            steps: [
              { label: "量房" },
              { label: "设计" },
              { label: "施工" },
              { label: "验收" },
            ],
          },
          annotations: [
            {
              text: "工期与预算可控",
              x: 500,
              y: 730,
              portraitY: 1260,
              enterMs: 2000,
            },
          ],
        }),
      },
      {
        durationMs: 4000,
        description: "里程碑：施工阶段与完成状态",
        narrationText: "从签约设计到入住验收，四阶段推进。",
        source: spec("timeline-milestones", 4000, 4411, {
          title: "改造里程碑",
          milestones: [
            { date: "3 月", label: "签约", status: "done" },
            { date: "4 月", label: "拆改", status: "done" },
            { date: "6 月", label: "硬装", status: "active" },
            { date: "8 月", label: "入住", status: "pending" },
          ],
          textColor: "#f5efe6",
          lineColor: "#5a4a3a",
          doneColor: "#8bc4a0",
          activeColor: "#d97a3d",
          pendingColor: "#8a7a6a",
          enterMs: 1400,
        }),
      },
      {
        durationMs: 3500,
        description: "户型：示意墙体调整",
        narrationText: "非承重墙移除，空间重新划分。",
        source: spec("explainer-composition", 3500, 4403, {
          title: "户型调整示意",
          titleColor: "#f5efe6",
          textColor: "#f5efe6",
          boxColor: "#e3cfae",
          arrowColor: "#d97a3d",
          strokeColor: "#7d8b5a",
          titleY: 145,
          titleEnterMs: 0,
          diagramOffsetX: 0,
          diagramOffsetY: 20,
          diagramEnterMs: 450,
          diagram: {
            kind: "drawing",
            paths: [
              "M 220 300 L 780 300 L 780 620 L 220 620 Z",
              "M 500 300 L 500 620",
            ],
          },
          annotations: [
            {
              text: "非承重墙可移除",
              x: 500,
              y: 740,
              portraitY: 1240,
              enterMs: 1800,
            },
          ],
        }),
      },
      {
        durationMs: 3000,
        description: "提醒：两条关键原则",
        narrationText: "承重墙不能动，水电走顶更好修。",
        source: spec("sketch-note", 3000, 4404, {
          title: "两个关键提醒",
          items: [
            { text: "承重墙不可拆", emphasis: "下划线" },
            { text: "水电走顶易检修", emphasis: "圈" },
          ],
          inkColor: "#f5efe6",
          accentColor: "#d97a3d",
          writeMs: 900,
          drawMs: 700,
          staggerMs: 500,
        }),
      },
      {
        durationMs: 3000,
        description: "收尾：邀请下一步",
        narrationText: "从方案到入住，从一次量房开始。",
        source: text("从方案到入住", "下一步：预约实地量房", 3000, 4405),
      },
    ];
  if (id === "quarterly")
    return [
      {
        durationMs: 3000,
        description: "开场：简报标题（演示数据声明）",
        narrationText: "第三季度业务数据简报，演示数据。",
        source: text("Q3 数据简报", "以下为演示数据，非真实指标", 3000, 4801),
      },
      {
        durationMs: 4000,
        description: "数据图：季度收入柱状对比",
        narrationText: "七月到九月，收入逐月上升。",
        source: spec("bar-chart", 4000, 4802, {
          title: "月度收入（万元，演示）",
          bars: [
            { label: "7 月", value: 42 },
            { label: "8 月", value: 58 },
            { label: "9 月", value: 71 },
          ],
          barColor: "#4a9d9d",
          accentColor: "#ff9e4f",
          textColor: "#e8f0f8",
          enterMs: 1400,
        }),
      },
      {
        durationMs: 4000,
        description: "前后对比：季度环比变化（可调入场时长）",
        narrationText: "季度环比，从增长四成到增长六成。",
        source: spec("compare-split", 4000, 4803, {
          title: "收入环比（演示数据）",
          metricLabel: "月均收入增长",
          beforeLabel: "Q2",
          beforeValue: "+40%",
          beforeNote: "上季度基准",
          afterLabel: "Q3",
          afterValue: "+60%",
          afterNote: "本季度实际（演示）",
          deltaText: "+40% → +60%",
          deltaPositive: true,
          textColor: "#e8f0f8",
          panelColor: "#1a3040",
          accentColor: "#ff9e4f",
          positiveColor: "#4a9d9d",
          negativeColor: "#e8837a",
          enterMs: 2000,
          sequence: "stagger",
        }),
      },
      {
        durationMs: 4000,
        description: "里程碑：季度关键节点（可调同步入场）",
        narrationText: "产品、运营、市场三条线同步推进。",
        source: spec("timeline-milestones", 4000, 4804, {
          title: "Q3 里程碑（演示数据）",
          milestones: [
            { date: "7 月", label: "产品", status: "done" },
            { date: "8 月", label: "运营", status: "done" },
            { date: "9 月", label: "市场", status: "active" },
            { date: "Q4", label: "规划", status: "pending" },
          ],
          textColor: "#e8f0f8",
          lineColor: "#3a5068",
          doneColor: "#4a9d9d",
          activeColor: "#ff9e4f",
          pendingColor: "#7a8a9a",
          enterMs: 800,
          sequence: "sync",
        }),
      },
      {
        durationMs: 3500,
        description: "数字强调：核心指标（演示）",
        narrationText: "月均收入五十七万元。",
        source: spec("number-counter", 3500, 4805, {
          title: "月均收入（万元，演示）",
          value: 57,
          prefix: "",
          suffix: " 万元",
          decimals: 0,
          countMs: 1400,
          numberColor: "#e8f0f8",
          accentColor: "#ff9e4f",
        }),
      },
      {
        durationMs: 3000,
        description: "收尾：简报回顾",
        narrationText: "以上为演示数据，感谢观看。",
        source: text("Q3 简报回顾", "演示数据 · 下一期 Q4 展望", 3000, 4806),
      },
    ];
  if (id === "appliance")
    return [
      {
        durationMs: 3500,
        description: "开场：点明维护目标",
        narrationText: "换滤芯，只需四步。",
        source: text("换滤芯只需四步", "咖啡机维护指南", 3500, 4501),
      },
      {
        durationMs: 4000,
        description: "操作：维护四步流程",
        narrationText: "断电、开盖、更换、复位，一步不乱。",
        source: spec("explainer-composition", 4000, 4502, {
          title: "维护四步",
          titleColor: "#eef3f8",
          textColor: "#eef3f8",
          boxColor: "#c3d4e6",
          arrowColor: "#4aa3d9",
          strokeColor: "#5b7fa6",
          titleY: 145,
          titleEnterMs: 0,
          diagramOffsetX: 0,
          diagramOffsetY: -75,
          diagramEnterMs: 450,
          diagram: {
            kind: "flow",
            steps: [
              { label: "断电" },
              { label: "开盖" },
              { label: "更换" },
              { label: "复位" },
            ],
          },
          annotations: [
            {
              text: "热水排空后再操作",
              x: 500,
              y: 730,
              portraitY: 1250,
              enterMs: 2200,
            },
          ],
        }),
      },
      {
        durationMs: 3000,
        description: "安全：两条操作提醒",
        narrationText: "只用原厂滤芯，先断电再开盖。",
        source: spec("sketch-note", 3000, 4503, {
          title: "安全提醒",
          items: [
            { text: "只用原厂滤芯", emphasis: "下划线" },
            { text: "先断电再开盖", emphasis: "圈" },
          ],
          inkColor: "#eef3f8",
          accentColor: "#4aa3d9",
          writeMs: 900,
          drawMs: 700,
          staggerMs: 500,
        }),
      },
      {
        durationMs: 2500,
        description: "参数：滤芯更换周期",
        narrationText: "滤芯每九十天更换一次。",
        source: spec("number-counter", 2500, 4504, {
          title: "滤芯更换周期",
          value: 90,
          prefix: "",
          suffix: " 天",
          decimals: 0,
          countMs: 1400,
          numberColor: "#eef3f8",
          accentColor: "#4aa3d9",
        }),
      },
      {
        durationMs: 3500,
        description: "收尾：维护的价值",
        narrationText: "维护到位，风味常在。",
        source: text("维护到位，风味常在", "到期自动提醒更省心", 3500, 4505),
      },
    ];
  if (!productAsset || productAsset.original.durationMs < 3000)
    throw new Error("产品样片需要完整的 3 秒商品示例素材");
  return [
    {
      durationMs: 2000,
      description: "品牌开场：FORM 01 帽子",
      narrationText: "FORM 01，日常新形态。",
      source: text("FORM 01", "日常新形态", 2000, 4301),
    },
    {
      durationMs: 3000,
      description: "商品整体画面：保持原始外观与标识",
      narrationText: "经典帽型，细节可见。",
      source: {
        type: "media-clip",
        mediaAssetId: productAsset.assetId,
        inMs: 0,
        outMs: 3000,
        fit: "contain",
        focalX: 0.5,
        audio: "mute",
      },
    },
    {
      durationMs: 2000,
      description: "商品局部画面：帽身与标识",
      narrationText: "让材质与纹理成为主角。",
      source: {
        type: "media-clip",
        mediaAssetId: productAsset.assetId,
        inMs: 500,
        outMs: 2500,
        fit: "cover",
        focalX: 0.5,
        audio: "mute",
      },
    },
    {
      durationMs: 2500,
      description: "卖点文字：简洁造型与日常搭配",
      narrationText: "简洁造型，轻松搭配。",
      source: text("简洁造型", "轻松搭配每一天", 2500, 4304),
    },
    {
      durationMs: 2000,
      description: "品牌收尾：示例品牌占位，发布前请替换",
      narrationText: "FORM 01。",
      source: text("FORM 01", "你的品牌与口号", 2000, 4305),
    },
  ];
}

export async function createGallerySample(
  id: GallerySampleId,
  productAsset?: MediaAsset,
): Promise<{ project: VideoProject; bible: StyleBible | null }> {
  const entry = GALLERY_SAMPLES.find((item) => item.id === id);
  if (!entry) throw new Error("未知样片");
  const now = new Date().toISOString();
  const shots = sampleShots(id, productAsset).map((shot, order) => {
    const versionId = crypto.randomUUID();
    return {
      shotId: crypto.randomUUID(),
      order,
      locked: false,
      workingVersionId: versionId,
      contentVersions: [
        {
          versionId,
          createdAt: now,
          durationMs: shot.durationMs,
          description: shot.description,
          narrationText: shot.narrationText,
          sceneSource: shot.source,
          provenance: { engineId: "gallery-template", engineVersion: "1" },
        },
      ],
      events: [
        {
          kind: "submitted" as const,
          versionId,
          at: now,
          actor: "human" as const,
        },
      ],
    };
  });
  let project: VideoProject = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: entry.title,
    brief: {
      sentence: `样片库：${entry.title}。这是可编辑起点，请在发布前替换示例文案和素材。`,
      aspectTargets: ["landscape", "portrait"],
    },
    shots,
    renderRecords: [],
    deliveries: [],
    savedVersion: 1,
    ...(productAsset ? { mediaAssets: [productAsset] } : {}),
  };
  const palette =
    id === "stem"
      ? STEM_PALETTE
      : id === "renovation"
        ? RENOVATION_PALETTE
        : id === "appliance"
          ? APPLIANCE_PALETTE
          : id === "quarterly"
            ? QUARTERLY_PALETTE
            : DATA_PALETTE;
  let bible: StyleBible | null = null;
  if (id !== "product") {
    const versionId = crypto.randomUUID();
    bible = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      currentVersionId: versionId,
      versions: [
        {
          versionId,
          createdAt: now,
          name:
            id === "stem"
              ? "深蓝科学"
              : id === "renovation"
                ? "暖木家装"
                : id === "appliance"
                  ? "蓝灰技术"
                  : "深蓝数据",
          palette,
          fontFamily: "NotoSansSC",
          lightingPreset: "orbit3d-fixed-soft-studio",
        },
      ],
    };
    project = {
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        contentVersions: shot.contentVersions.map((version) => ({
          ...version,
          sceneSource:
            version.sceneSource.type === "spec"
              ? {
                  type: "spec" as const,
                  spec: styleSceneSpec(
                    version.sceneSource.spec as Record<string, unknown>,
                    bible!.versions[0]!,
                  ),
                }
              : version.sceneSource,
        })),
      })),
    };
    project = await applyStyleBible(project, bible, versionId);
  }
  return { project: validateVideoProject(project), bible };
}
