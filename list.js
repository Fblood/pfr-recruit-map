// Station list: a plain-text alternative to the map (screen readers, quick
// scanning, studying from a list) with a Copy button so the whole thing can be
// pasted into a phone's notes app. Built straight from PFR_DATA.stations so it
// can never drift from what the map shows.
(function () {
  "use strict";

  const dialog = document.getElementById("listDialog");
  if (!dialog || typeof dialog.showModal !== "function") {
    const btn = document.getElementById("openList");
    if (btn) btn.hidden = true; // very old browser: no <dialog>, skip the feature
    return;
  }
  const openBtn = document.getElementById("openList");
  const bodyEl = document.getElementById("listBody");
  const countEl = document.getElementById("listCount");
  const copyBtn = document.getElementById("listCopy");
  const filterEl = document.getElementById("listFilters");

  // The source data is upper-case ("5247 N LOMBARD ST"); show it the way a
  // person writes it, keeping directionals and ordinals intact.
  const SPECIAL_CASE = { DEWITT: "DeWitt" }; // names plain title-casing gets wrong
  function prettyAddress(raw) {
    return String(raw).split(/\s+/).map((w) => {
      if (SPECIAL_CASE[w]) return SPECIAL_CASE[w];
      if (/^(N|S|E|W|NE|NW|SE|SW)$/.test(w)) return w;
      if (/^\d/.test(w)) return w.toLowerCase();
      return w.charAt(0) + w.slice(1).toLowerCase();
    }).join(" ");
  }

  const stations = PFR_DATA.stations.features
    .map((f) => {
      const p = f.properties;
      const cs = p.crossStreets || {};
      return {
        num: Number(p.STATION),
        address: prettyAddress(p.ADDRESS) + (p.addressNote ? ` (${p.addressNote})` : ""),
        cross: [cs.cross_street_1, cs.cross_street_2].filter(Boolean).join(" & "),
        battalion: p.battalion || null,
        neighborhood: p.neighborhood || "",
        units: (p.profile && p.profile.units) || [],
      };
    })
    .sort((a, b) => a.num - b.num);

  let battalion = "all";
  const visible = () => stations.filter((s) => battalion === "all" || s.battalion === Number(battalion));

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function render() {
    const rows = visible();
    countEl.textContent = `${rows.length} station${rows.length === 1 ? "" : "s"}`;
    bodyEl.innerHTML = rows.map((s) => `
      <tr>
        <th scope="row">${s.num}</th>
        <td>
          <span class="list-addr">${esc(s.address)}</span>
          ${s.cross ? `<span class="list-sub">${esc(s.cross)}</span>` : ""}
          <span class="list-meta">${s.battalion ? `Bn ${s.battalion}` : ""}${s.neighborhood ? ` &middot; ${esc(s.neighborhood)}` : ""}${s.units.length ? `<span class="list-units">${esc(s.units.join(" "))}</span>` : ""}</span>
        </td>
      </tr>`).join("");
  }

  function asText() {
    const head = battalion === "all" ? "All stations" : `Battalion ${battalion}`;
    const lines = visible().map((s) => {
      const where = `${s.address}${s.cross ? ` (${s.cross})` : ""}`;
      const meta = [s.battalion ? `Bn ${s.battalion}` : "", s.neighborhood, s.units.join(" ")].filter(Boolean).join(" · ");
      return `Station ${s.num} · ${where}\n  ${meta}`;
    });
    return `PF&R stations, ${head} (unofficial study list, Recruit Class 26-04)\n\n${lines.join("\n")}\n`;
  }

  // navigator.clipboard needs a secure context and, inside an iframe, a
  // permission the host page may not grant -- fall back to the old
  // select-and-copy so the button works wherever the site is embedded.
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      dialog.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  let copyTimer = null;
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(asText());
    copyBtn.textContent = ok ? "Copied ✓" : "Copy failed";
    copyBtn.classList.toggle("is-done", ok);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copyBtn.textContent = "Copy list"; copyBtn.classList.remove("is-done"); }, 2200);
  });

  filterEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-bn]");
    if (!b) return;
    battalion = b.dataset.bn;
    filterEl.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });

  openBtn.addEventListener("click", () => { render(); dialog.showModal(); });
  document.getElementById("listClose").addEventListener("click", () => dialog.close());
  // Tap outside the sheet (on the dimmed backdrop) to close.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
})();
