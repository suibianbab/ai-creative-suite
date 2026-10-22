// Edit one VideoProject shot in the saved native EffectCraft project.
// Landscape and portrait compositions are two render targets for the same shot.
var changed = 0;
for (var i = 1; i <= app.project.numItems; i++) {
  var comp = app.project.item(i);
  if (comp.name === "L_04" || comp.name === "P_04") {
    var layer = comp.layer("Closing title");
    var prop = layer
      .property("ADBE Text Properties")
      .property("ADBE Text Document");
    var doc = prop.value;
    doc.text = "增长，始终可见";
    prop.setValue(doc);
    changed++;
    writeLn(comp.name + ": " + doc.text);
  }
}
if (changed !== 2) throw new Error("Expected both aspect variants of shot 4");
