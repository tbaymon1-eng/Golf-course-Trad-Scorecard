// Register service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      // console.log("Service Worker registered");
    } catch (e) {
      // console.log("SW registration failed", e);
    }
  });
}
