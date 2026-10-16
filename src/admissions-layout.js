(function () {
  let state = null;
  const formKey = form => {
    if (!form) return null;
    const attributes = [...form.attributes].filter(attribute => attribute.name.startsWith('data-'));
    return attributes.length ? `form${attributes.map(attribute => `[${attribute.name}="${CSS.escape(attribute.value)}"]`).join('')}` : null;
  };

  function capture(root) {
    if (!root.querySelector('.admissions-page')) return null;
    const focused = document.activeElement;
    const focusedForm = formKey(focused?.closest('form'));
    const anchor = focusedForm ? root.querySelector(focusedForm) : [...root.querySelectorAll('[data-review-section]')].find(node => node.getBoundingClientRect().bottom > 130);
    return {
      sessionToken: state?.session?.token,
      tab: root.querySelector('[data-admissions-tab][aria-current]')?.dataset.admissionsTab,
      scrollY: window.scrollY,
      queueScroll: root.querySelector('[data-review-list]')?.scrollTop || 0,
      detailId: root.querySelector('[data-application-id]')?.dataset.applicationId,
      forms: [...root.querySelectorAll('form')].filter(form => form.closest('[data-application-id]') || form.dataset.form?.startsWith('review-')).map(form => ({ key: formKey(form), detail: Boolean(form.closest('[data-application-id]')), fields: [...form.elements].filter(field => field.name).map(field => ({ name: field.name, value: field.value, checked: field.checked })) })).filter(form => form.key),
      details: [...root.querySelectorAll('details')].map(node => ({ panel: node.closest('[data-admissions-panel]')?.dataset.admissionsPanel, summary: node.querySelector(':scope > summary')?.textContent, open: node.open })),
      focus: focusedForm && focused?.name ? { form: focusedForm, name: focused.name, start: focused.selectionStart, end: focused.selectionEnd } : null,
      anchor: anchor ? { key: focusedForm || `[data-review-section="${anchor.dataset.reviewSection}"]`, top: anchor.getBoundingClientRect().top } : null
    };
  }

  function restore(root, snapshot, options = {}) {
    if (!snapshot || snapshot.sessionToken !== state?.session?.token) return;
    const sameDetail = snapshot.detailId === root.querySelector('[data-application-id]')?.dataset.applicationId;
    for (const draft of snapshot.forms) {
      if (draft.key === options.resetForm || (draft.detail && !sameDetail)) continue;
      const form = root.querySelector(draft.key);
      if (!form) continue;
      const fields = [...form.elements].filter(field => field.name);
      for (const [index, saved] of draft.fields.entries()) {
        const field = fields[index];
        if (!field || field.name !== saved.name || field.type === 'file') continue;
        field.value = saved.value;
        if (['checkbox', 'radio'].includes(field.type)) field.checked = saved.checked;
      }
    }
    for (const saved of snapshot.details) {
      const node = [...root.querySelectorAll('details')].find(detail => detail.closest('[data-admissions-panel]')?.dataset.admissionsPanel === saved.panel && detail.querySelector(':scope > summary')?.textContent === saved.summary);
      if (node && (!node.closest('[data-application-id]') || sameDetail)) node.open = saved.open;
    }
    const list = root.querySelector('[data-review-list]');
    if (list) list.scrollTop = snapshot.queueScroll;
    if (snapshot.tab !== root.querySelector('[data-admissions-tab][aria-current]')?.dataset.admissionsTab) return;
    if (options.openDetail) {
      if (state) state.mobileQueueScroll = snapshot.scrollY;
      const detail = root.querySelector('.review-application');
      const offset = document.querySelector('.top-nav').getBoundingClientRect().height + root.querySelector('.admissions-tabs').getBoundingClientRect().height + 16;
      if (detail) { window.scrollTo({ top: Math.max(0, window.scrollY + detail.getBoundingClientRect().top - offset), behavior: 'instant' }); detail.focus({ preventScroll: true }); }
      return;
    }
    let scrollY = snapshot.scrollY;
    const anchor = sameDetail && snapshot.anchor ? root.querySelector(snapshot.anchor.key) : null;
    if (anchor && !anchor.closest('[hidden]')) scrollY = window.scrollY + anchor.getBoundingClientRect().top - snapshot.anchor.top;
    window.scrollTo({ top: Math.max(0, scrollY), behavior: 'instant' });
    if (snapshot.focus && sameDetail) {
      const form = root.querySelector(snapshot.focus.form);
      const field = [...(form?.elements || [])].find(node => node.name === snapshot.focus.name);
      if (field && !field.closest('[hidden]')) {
        field.focus({ preventScroll: true });
        if (snapshot.focus.start !== null && typeof field.setSelectionRange === 'function') field.setSelectionRange(snapshot.focus.start, snapshot.focus.end);
      }
    }
  }

  function activate(root, id) {
    root.querySelectorAll('[data-admissions-panel]').forEach(panel => { panel.hidden = panel.dataset.admissionsPanel !== id; });
    root.querySelectorAll('[data-admissions-tab]').forEach(link => { if (link.dataset.admissionsTab === id) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  }

  function bind(root, currentState) {
    state = currentState;
    root.querySelectorAll('[data-admissions-tab]').forEach(link => link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const id = link.dataset.admissionsTab;
      const old = root.querySelector('[data-admissions-tab][aria-current]')?.dataset.admissionsTab;
      if (old === id) return;
      state.tabScroll ||= {};
      state.tabScroll[old] = window.scrollY;
      history.pushState(null, '', link.getAttribute('href'));
      activate(root, id);
      window.scrollTo({ top: state.tabScroll[id] || 0, behavior: 'instant' });
    }));
    const search = root.querySelector('[data-review-search]');
    const applySearch = () => {
      const query = (search?.value || '').trim().toLowerCase();
      const rows = [...root.querySelectorAll('[data-review-search-text]')];
      rows.forEach(row => { row.hidden = !row.dataset.reviewSearchText.includes(query); });
      const empty = root.querySelector('[data-review-search-empty]');
      if (empty) empty.hidden = !query || rows.some(row => !row.hidden);
    };
    search?.addEventListener('input', () => { state.queueSearch = search.value; applySearch(); root.querySelector('[data-review-list]').scrollTop = 0; });
    applySearch();
    root.querySelector('[data-review-back]')?.addEventListener('click', () => {
      state.mobileDetail = false;
      root.querySelector('.admissions-workbench').classList.remove('is-detail-view');
      window.scrollTo({ top: state.mobileQueueScroll || 0, behavior: 'instant' });
      root.querySelector(`[data-review-detail="${CSS.escape(state.selectedId || '')}"]`)?.focus({ preventScroll: true });
    });
    root.querySelectorAll('[data-review-jump]').forEach(button => button.addEventListener('click', () => {
      const section = root.querySelector(`[data-review-section="${button.dataset.reviewJump}"]`);
      if (!section) return;
      if (section.tagName === 'DETAILS') section.open = true;
      section.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }));
  }

  window.admissionsLayout = { capture, restore, bind, formKey };
})();
