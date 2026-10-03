// Registers the offline service worker and shows a small OFFLINE tag when the
// device has no connection (the map keeps working from the saved copy).
(function () {
  "use strict";
  const tag = document.getElementById("netTag");
  function sync() { if (tag) tag.hidden = navigator.onLine; }
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      // Embedded in another site, or storage blocked: offline just stays off.
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
