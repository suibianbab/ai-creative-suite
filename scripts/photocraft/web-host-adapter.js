// PhotoCraft 0.6.0 host adapter. Installed beside the official, unmodified WASM bundle.
// The upstream Web app has no postMessage API; it already accepts browser drops and
// writes .pcraft through a temporary download anchor. Keep this shim version pinned.
(() => {
  const protocol = "acs-photocraft/1";
  if (window.parent === window) return;
  let interactionReported = false;

  function send(type, extra = {}, transfer = []) {
    window.parent.postMessage(
      { protocol, type, ...extra },
      location.origin,
      transfer,
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== location.origin)
      return;
    const message = event.data;
    if (message?.protocol !== protocol) return;
    if (message.type === "open" && message.bytes instanceof ArrayBuffer) {
      const canvas = document.getElementById("photocraft_canvas");
      if (!canvas || document.getElementById("photocraft_loading")) {
        send("error", { message: "PhotoCraft 画布尚未准备好" });
        return;
      }
      const name = String(message.name || "project.pcraft").replace(
        /[\\/]/g,
        "_",
      );
      const file = new File([message.bytes], name, {
        type: name.endsWith(".pcraft")
          ? "application/octet-stream"
          : "image/png",
      });
      const data = new DataTransfer();
      data.items.add(file);
      const drop = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      });
      canvas.dispatchEvent(drop);
      interactionReported = false;
      send("open-dispatched", { name, accepted: drop.defaultPrevented });
    }
    if (message.type === "save") {
      const canvas = document.getElementById("photocraft_canvas");
      if (!canvas) {
        send("error", { message: "PhotoCraft 画布未就绪，无法保存" });
        return;
      }
      canvas.focus();
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          canvas.focus();
          canvas.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "s",
              code: "KeyS",
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
          send("save-dispatched");
        }),
      );
    }
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isTrusted) return;
      // PhotoCraft's menus, panels and layer controls live outside the canvas
      // element. Treat any trusted pointer action in its editor as a possible
      // document change so the host never previews stale pixels.
      if (
        !interactionReported &&
        document.getElementById("photocraft_canvas")
      ) {
        interactionReported = true;
        send("canvas-interaction");
      }
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.isTrusted) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s")
        return;
      if (
        !interactionReported &&
        document.getElementById("photocraft_canvas")
      ) {
        interactionReported = true;
        send("canvas-interaction");
      }
    },
    true,
  );

  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const name = this.download;
    if (/\.(pcraft|psd)$/i.test(name || "") && this.href.startsWith("blob:")) {
      fetch(this.href)
        .then((response) => response.arrayBuffer())
        .then((bytes) => {
          interactionReported = false;
          send("saved", { name, bytes }, [bytes]);
        })
        .catch((error) => send("error", { message: String(error) }));
      return;
    }
    return originalClick.call(this);
  };

  const ready = () => {
    if (document.getElementById("photocraft_loading")) {
      requestAnimationFrame(ready);
    } else {
      send("ready", { engine: "PhotoCraft", version: "0.6.0" });
    }
  };
  ready();
})();
