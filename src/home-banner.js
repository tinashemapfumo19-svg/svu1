(function () {
  const app = document.querySelector('#app');
  if (!app) return;
  let banner = null;
  let frame = null;

  function update() {
    frame = null;
    const current = app.querySelector('.home-ui .dashboard-head, .student-greeting');
    if (current !== banner) {
      banner?.classList.remove('is-scrolled');
      banner = current;
    }
    if (!banner) return;
    const navigation = document.querySelector('.top-nav');
    const localNavigation = app.querySelector('.student-local-nav');
    const localHeight = localNavigation && getComputedStyle(localNavigation).position === 'sticky'
      ? localNavigation.getBoundingClientRect().height : 0;
    const offset = (navigation?.getBoundingClientRect().height || 0) + localHeight;
    banner.style.setProperty('--home-banner-top', `${offset}px`);
    banner.classList.toggle('is-scrolled', window.scrollY > 0 && banner.getBoundingClientRect().top <= offset + 1);
  }

  function schedule() {
    if (frame === null) frame = requestAnimationFrame(update);
  }

  // Dashboards replace their markup after loading data and when switching personas.
  new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  schedule();
})();
