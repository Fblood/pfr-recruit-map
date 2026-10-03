// Flags when the page is framed (e.g. inside a Google Site) so styles.css can
// drop chrome that only makes sense standalone. Kept as its own file, not an
// inline <script>, so the Content-Security-Policy can forbid inline scripts.
if (window.parent !== window) document.documentElement.classList.add("is-embedded");
