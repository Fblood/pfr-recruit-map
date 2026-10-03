// Keyboard support for every role="tab" strip on the page (the study-mode
// tabs and the station popup's Overview / Info / History tabs): Left/Right
// move between tabs, Home/End jump to the ends, and only the selected tab is
// in the Tab order (roving tabindex) so keyboard users aren't made to tab
// through every button. Delegated, so it keeps working when app.js re-renders
// the popup.
(function () {
  "use strict";

  function tabsOf(list) { return Array.from(list.querySelectorAll('[role="tab"]')); }

  function syncRoving() {
    document.querySelectorAll('[role="tablist"]').forEach((list) => {
      const tabs = tabsOf(list);
      const selected = tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0];
      tabs.forEach((t) => t.setAttribute("tabindex", t === selected ? "0" : "-1"));
    });
  }

  document.addEventListener("keydown", (e) => {
    const tab = e.target.closest && e.target.closest('[role="tab"]');
    if (!tab) return;
    const tabs = tabsOf(tab.closest('[role="tablist"]'));
    const i = tabs.indexOf(tab);
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = tabs[(i + 1) % tabs.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === "Home") next = tabs[0];
    else if (e.key === "End") next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.click(); // selection follows focus -- these tabs just swap a view
  });

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; syncRoving(); });
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected"] });

  syncRoving();
})();
