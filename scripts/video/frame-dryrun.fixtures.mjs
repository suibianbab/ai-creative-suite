// 干跑门禁的测试夹具：注册表之外直构 render 函数（不入 @acs/video-scene，
// 不受组件源码静态门禁约束——那个门禁管的是产品组件，不是这里的死循环夹具）。

export function renderFast(_args, _frame) {
  return { tag: "g", attrs: {}, children: [] };
}

export function renderHanging(args, frame) {
  if (frame < (args.hangAtFrame ?? 0))
    return { tag: "g", attrs: {}, children: [] };
  // 人为卡死：干跑门禁必须在预算内杀掉这一帧
  while (true) {
    // spin
  }
}

export function renderThrowing(args, frame) {
  if (frame === (args.throwAtFrame ?? 0)) throw new Error(`第 ${frame} 帧炸了`);
  return { tag: "g", attrs: {}, children: [] };
}
