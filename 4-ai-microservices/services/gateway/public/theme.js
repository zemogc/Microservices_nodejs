// Loaded in <head> so the saved theme applies before the first paint.
// Storage can be unavailable (private mode, blocked cookies), hence the try/catch.
(function () {
  let theme;
  try {
    theme = localStorage.getItem('theme');
  } catch {}
  if (!theme) theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
})();
