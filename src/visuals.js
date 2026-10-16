(function () {
  // App-wide visual consistency (docs/VISUAL_SYSTEM.md), applied after any screen renders so every area gets it without
  // editing each screen: real icons in place of text symbols on buttons.
  const ui = window.svuUI;

  // Buttons and links whose whole label is a text symbol get the matching icon; the symbol becomes the accessible name.
  const symbols = { '↻': ['refresh', 'Refresh'], '⟳': ['refresh', 'Refresh'], '←': ['arrowLeft', 'Previous'], '→': ['arrowRight', 'Next'], '×': ['x', 'Close'], '✕': ['x', 'Close'], '✓': ['check', 'Done'], '✔': ['check', 'Done'] };
  function symbolIcons(root) {
    for (const node of root.querySelectorAll('button, a.icon-button, a.button')) {
      if (node.children.length || node.dataset.iconised) continue;
      const entry = symbols[node.textContent.trim()];
      if (!entry) continue;
      node.dataset.iconised = '1';
      if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', node.getAttribute('title') || entry[1]);
      node.innerHTML = ui.icons[entry[0]];
      node.classList.add('has-icon');
    }
  }

  let scheduled = false;
  const run = () => { scheduled = false; const app = document.querySelector('#app'); if (!app) return; symbolIcons(document.body); };
  new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(run); } }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => requestAnimationFrame(run));
})();
