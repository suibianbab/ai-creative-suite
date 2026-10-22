// EffectCraft v0.14.0 native sample. Four VideoProject shots, two aspect targets.
// The platform owns shot order and duration; every composition is exactly one shot.
var C = {
  bg: [0.071, 0.129, 0.216],
  fg: [0.96, 0.97, 0.98],
  secondary: [0.68, 0.8, 0.9],
  accent: [1.0, 0.737, 0.376],
  bar: [0.29, 0.624, 0.859],
};
var values = [32, 46, 58, 82];
var labels = ["Q1", "Q2", "Q3", "Q4"];

function solid(comp, name, color, w, h, x, y) {
  var l = comp.layers.addSolid(color, name, w, h, 1, 3);
  l.property("ADBE Transform Group").property("ADBE Position").setValue([x, y]);
  return l;
}
function text(comp, name, content, size, color, x, y) {
  var l = comp.layers.addText(content);
  l.name = name;
  var prop = l.property("ADBE Text Properties").property("ADBE Text Document");
  var d = prop.value;
  d.font = "Microsoft YaHei";
  d.fontSize = size;
  d.fillColor = color;
  d.applyFill = true;
  prop.setValue(d);
  l.property("ADBE Transform Group").property("ADBE Position").setValue([x, y]);
  return l;
}
function fade(l, start, end) {
  var p = l.property("ADBE Transform Group").property("ADBE Opacity");
  p.setValueAtTime(start, 0);
  p.setValueAtTime(end, 100);
}
function slide(l, x, y, start, end, offset) {
  var p = l.property("ADBE Transform Group").property("ADBE Position");
  p.setValueAtTime(start, [x, y + offset]);
  p.setValueAtTime(end, [x, y]);
}
function frame(comp, w, h, tag) {
  solid(comp, "Background", C.bg, w, h, w / 2, h / 2);
  solid(
    comp,
    "Accent rule",
    C.accent,
    Math.round(w * 0.1),
    5,
    w * 0.11,
    h * 0.13,
  );
  text(
    comp,
    "Eyebrow",
    tag,
    Math.round(w * 0.027),
    C.secondary,
    w / 2,
    h * 0.13,
  );
  text(
    comp,
    "Footer",
    "VIDEO STUDIO  /  DATA MOTION",
    Math.round(w * 0.018),
    C.secondary,
    w / 2,
    h * 0.94,
  );
}
function shot(index, w, h, prefix) {
  var portrait = h > w;
  var comp = app.project.items.addComp(prefix + "_0" + index, w, h, 1, 3, 30);
  var titleY = portrait ? h * 0.26 : h * 0.32;
  var titleSize = portrait ? 68 : 90;
  var subtitleSize = portrait ? 34 : 40;
  frame(comp, w, h, "2026  /  QUARTERLY SALES");
  if (index === 1) {
    var t1 = text(
      comp,
      "Main title",
      "季度销量观察",
      titleSize,
      C.fg,
      w / 2,
      titleY,
    );
    var t2 = text(
      comp,
      "Subtitle",
      "用数据看增长",
      subtitleSize,
      C.secondary,
      w / 2,
      titleY + (portrait ? 105 : 100),
    );
    fade(t1, 0.2, 0.8);
    slide(t1, w / 2, titleY, 0.2, 0.8, 55);
    fade(t2, 0.7, 1.3);
    slide(t2, w / 2, titleY + (portrait ? 105 : 100), 0.7, 1.3, 35);
    solid(
      comp,
      "Hero underline",
      C.accent,
      Math.round(w * 0.38),
      6,
      w / 2,
      titleY + (portrait ? 175 : 160),
    );
  } else if (index === 2) {
    var ct = text(
      comp,
      "Chart title",
      "四季度销量对比",
      portrait ? 54 : 70,
      C.fg,
      w / 2,
      portrait ? h * 0.27 : h * 0.24,
    );
    fade(ct, 0.1, 0.5);
    var baseline = portrait ? h * 0.77 : h * 0.8;
    var maxHeight = portrait ? h * 0.34 : h * 0.37;
    var barW = portrait ? 100 : 150;
    var step = portrait ? 140 : 215;
    var startX = w / 2 - step * 1.5;
    solid(comp, "Baseline", C.secondary, step * 4.25, 2, w / 2, baseline);
    for (var i = 0; i < 4; i++) {
      var x = startX + i * step;
      var bh = (maxHeight * values[i]) / 82;
      var bar = solid(
        comp,
        "Bar " + labels[i] + " " + values[i],
        i === 3 ? C.accent : C.bar,
        barW,
        bh,
        x,
        baseline - bh / 2,
      );
      var pos = bar.property("ADBE Transform Group").property("ADBE Position");
      var sc = bar.property("ADBE Transform Group").property("ADBE Scale");
      pos.setValueAtTime(0.3 + i * 0.15, [x, baseline]);
      pos.setValueAtTime(1.5 + i * 0.15, [x, baseline - bh / 2]);
      sc.setValueAtTime(0.3 + i * 0.15, [100, 0]);
      sc.setValueAtTime(1.5 + i * 0.15, [100, 100]);
      var val = text(
        comp,
        "Value " + labels[i],
        String(values[i]),
        portrait ? 32 : 36,
        C.fg,
        x,
        baseline - bh - 35,
      );
      fade(val, 1.4 + i * 0.15, 1.9 + i * 0.15);
      text(
        comp,
        "Label " + labels[i],
        labels[i],
        portrait ? 30 : 34,
        C.secondary,
        x,
        baseline + (portrait ? 64 : 54),
      );
    }
  } else if (index === 3) {
    var n = text(
      comp,
      "Key number",
      "82",
      portrait ? 215 : 240,
      C.accent,
      w / 2,
      portrait ? h * 0.48 : h * 0.65,
    );
    var c = text(
      comp,
      "Number caption",
      "第四季度销量",
      portrait ? 47 : 55,
      C.fg,
      w / 2,
      portrait ? h * 0.33 : h * 0.29,
    );
    var s = text(
      comp,
      "Number note",
      "从 Q1 的 32 增长到 Q4 的 82",
      subtitleSize,
      C.secondary,
      w / 2,
      portrait ? h * 0.62 : h * 0.84,
    );
    fade(n, 0.3, 1.1);
    slide(n, w / 2, portrait ? h * 0.48 : h * 0.65, 0.3, 1.1, 90);
    fade(c, 0.1, 0.6);
    fade(s, 1.1, 1.6);
  } else {
    var end = text(
      comp,
      "Closing title",
      "增长，清晰可见",
      portrait ? 65 : 85,
      C.fg,
      w / 2,
      portrait ? h * 0.44 : h * 0.45,
    );
    var sub = text(
      comp,
      "Closing subtitle",
      "从数据出发，做更好的决定",
      subtitleSize,
      C.secondary,
      w / 2,
      portrait ? h * 0.56 : h * 0.59,
    );
    fade(end, 0.2, 0.9);
    slide(end, w / 2, portrait ? h * 0.44 : h * 0.45, 0.2, 0.9, 50);
    fade(sub, 0.9, 1.5);
    solid(
      comp,
      "Closing accent",
      C.accent,
      Math.round(w * 0.35),
      6,
      w / 2,
      portrait ? h * 0.65 : h * 0.7,
    );
  }
  writeLn(comp.name + " " + comp.numLayers + " layers");
}
for (var i = 1; i <= 4; i++) shot(i, 1280, 720, "L");
for (var j = 1; j <= 4; j++) shot(j, 720, 1280, "P");
