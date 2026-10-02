// Extension pages are CSP-restricted, so this lives in its own file rather
// than inline in blocked.html.
const params = new URLSearchParams(window.location.search);
const domain = params.get("domain");
if (domain) {
  const target = document.getElementById("domain-name");
  if (target) target.textContent = domain;
}

// window.close() only works for script-opened tabs, so prefer it and fall back
// to leaving focus mode guidance for the user.
document.getElementById("close-tab")?.addEventListener("click", (event) => {
  event.preventDefault();
  window.close();
  window.setTimeout(() => {
    document.getElementById("close-tab").textContent = "You can close this tab now";
  }, 300);
});
