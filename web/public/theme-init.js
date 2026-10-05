// Applies the saved colour theme before the app renders, so there is no flash of the wrong theme.
// Kept as an external file because the CSP forbids inline scripts.
(function () {
  var pref = 'dark';
  try {
    pref = localStorage.getItem('zn.theme') || 'dark';
  } catch (e) {
    /* storage unavailable */
  }
  var resolved = pref === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : pref === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
})();
