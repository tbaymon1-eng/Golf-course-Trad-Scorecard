// Register service worker (PWA)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });

      // If there's an updated SW waiting, tell it to activate now
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });

      // When a new SW is found, tell it to activate now
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    } catch (e) {
      // ignore
    }
  });
}
