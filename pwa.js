// pwa.js
// Registers service worker and auto-activates updates.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });

      // If there's an updated SW waiting, activate it now
      if (reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      // When a new SW is found, ask it to activate immediately
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });

      // When controller changes (new SW takes over), refresh once
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // prevent infinite reload loops
        if (window.__swReloaded) return;
        window.__swReloaded = true;
        window.location.reload();
      });

    } catch (e) {
      // ignore
    }
  });
}
