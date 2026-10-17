(function () {
  // Sticky offsets belong to the rendered workspace, not to a guessed header height.
  let observer;
  let current;
  let currentKey;
  let positions = [];
  const selectors = [
    '.asset-detail > .section-header', '.leave-detail > .section-header',
    '.staff-detail > .section-header', '.fleet-vehicle > .section-header',
    '.fleet-incident > .section-header', '.teaching-period > .section-header',
    '.support-detail > .support-heading', '.cashbook-book > h3',
    '[data-restricted-read-result] > h4',
    '[data-arrangement-panel] > .section-header', '[data-paper-custody] > .section-header',
    '[data-exam-manifest-panel] > .section-header', '[data-exam-seating-panel] > .section-header',
    '[data-exam-publication-panel] > .section-header',
  ].join(',');
  function enhance(root) {
    const previous = current;
    const key = node => [location.hash, node?.querySelector('[data-staff-body]')?.dataset.staffBody, node?.querySelector('[data-system-body]')?.dataset.systemBody, node?.querySelector('.academic-tabs [aria-selected="true"]')?.textContent,
      ...[...(node?.querySelectorAll('.workspace-picker-filter input, .workspace-picker-filter select') || [])].map(field => field.value),
      node?.querySelector('.workspace-picker .staff-pager, .workspace-picker .hero-actions')?.textContent].join('|');
    if (previous?.isConnected && currentKey === key(previous)) positions = [...previous.querySelectorAll('.workspace-picker-results')].map(node => node.scrollTop);
    observer?.disconnect();
    current = root.matches?.('.registry-workspace') ? root : root.querySelector('.registry-workspace');
    if (!current) return;
    const workspace = current;
    const nextKey = key(workspace);
    if (nextKey !== currentKey) positions = [];
    currentKey = nextKey;
    const header = document.querySelector('.top-nav');
    const tabs = workspace.querySelector(':scope > .workspace-tabs');
    const academicTabs = workspace.querySelector('.academic-tabs, .fleet-toolbar');
    const jump = workspace.querySelector('.record-jump');
    const measure = () => {
      if (!workspace.isConnected) { observer?.disconnect(); return; }
      const height = node => node?.getBoundingClientRect().height || 0;
      const top = height(header) + height(tabs);
      const local = height(academicTabs);
      workspace.style.setProperty('--workspace-header-height', `${height(header)}px`);
      workspace.style.setProperty('--workspace-top', `${top}px`);
      workspace.style.setProperty('--workspace-local-height', `${local}px`);
      workspace.style.setProperty('--workspace-jump-height', `${height(jump)}px`);
      workspace.classList.toggle('workspace-layout-short', window.innerHeight - top - local < 360);
      for (const picker of workspace.querySelectorAll('.workspace-picker')) {
        const style = getComputedStyle(picker);
        const children = [...picker.children];
        const chrome = children.filter(node => !node.classList.contains('workspace-picker-results')).reduce((sum, node) => sum + height(node), 0)
          + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + (parseFloat(style.rowGap) || 0) * Math.max(0, children.length - 1);
        picker.classList.toggle('workspace-picker-unpinned', window.innerHeight - top - local - 28 < chrome + 120);
      }
    };
    for (const heading of workspace.querySelectorAll(selectors)) heading.classList.add('workspace-record-context');
    // Only established table wrappers become scroll containers; forms and editors keep page scrolling.
    for (const table of workspace.querySelectorAll('.staff-body table')) {
      const wrapper = table.parentElement;
      if (!wrapper.matches('.result-table-wrap, .support-queue-wrap, .academic-table, .ui-table-wrap')) continue;
      wrapper.classList.add('workspace-table');
      wrapper.setAttribute('tabindex', '0');
      wrapper.setAttribute('role', 'region');
      if (!wrapper.hasAttribute('aria-label') && !wrapper.hasAttribute('aria-labelledby')) {
        const heading = wrapper.closest('section, details')?.querySelector('h2, h3, summary');
        wrapper.setAttribute('aria-label', `${heading?.textContent.trim() || 'Records'} table`);
      }
    }
    measure();
    const results = [...workspace.querySelectorAll('.workspace-picker-results')];
    results.forEach((node, index) => {
      node.scrollTop = positions[index] || 0;
      node.addEventListener('scroll', () => {
        if (current === workspace && workspace.isConnected) positions[index] = node.scrollTop;
      });
    });
    // Capture before a record click replaces the workspace and detaches its list.
    workspace.addEventListener('click', () => {
      if (current === workspace) positions = results.map(node => node.scrollTop);
    }, {capture: true});
    if (window.ResizeObserver) {
      observer = new ResizeObserver(measure);
      for (const node of [header, tabs, academicTabs, jump, ...workspace.querySelectorAll('.workspace-picker-filter')]) if (node) observer.observe(node);
    }
  }
  window.addEventListener('resize', () => {
    if (current?.isConnected) enhance(current);
  });
  window.addEventListener('hashchange', () => { observer?.disconnect(); current = null; });
  window.svuWorkspaceLayout = {enhance};
})();
