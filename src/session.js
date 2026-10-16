(function () {
  // One sign-in for the whole app. The per-area keys remain the storage so every workspace reads the same session.
  const keys = ["svu.registry.session", "svu.staff.session", "svu.applicant.session"];
  const listeners = new Set();
  let profile = null, profileToken = null, pending = null;
  const read = (key) => { try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch { return null; } };
  function get() {
    for (const key of keys) { const value = read(key); if (value?.token) return value; }
    return null;
  }
  function set(value) {
    const before = get()?.token || null;
    try {
      for (const key of keys) value?.token ? sessionStorage.setItem(key, JSON.stringify(value)) : sessionStorage.removeItem(key);
    } catch { /* Storage may be unavailable; the session then lasts only for this page. */ }
    if (before !== (value?.token || null)) { profile = null; profileToken = null; pending = null; listeners.forEach((listener) => listener(value || null)); }
  }
  const clear = () => set(null);
  // The signed-in profile (account, person, roles, permissions), cached per token.
  async function me() {
    const session = get();
    if (!session) { profile = null; profileToken = null; return null; }
    if (profileToken === session.token && profile) return profile;
    if (pending?.token === session.token) return pending.promise;
    const promise = fetch("/api/identity/me", { headers: { Accept: "application/json", Authorization: `Bearer ${session.token}` } })
      .then(async (response) => {
        if (response.status === 401) { if (get()?.token === session.token) clear(); return null; }
        if (!response.ok) return null;
        const data = (await response.json()).data;
        if (get()?.token !== session.token) return null;
        profile = data; profileToken = session.token; return data;
      })
      .catch(() => null)
      .finally(() => { if (pending?.token === session.token) pending = null; });
    pending = { token: session.token, promise };
    return promise;
  }
  const cached = () => (profileToken && profileToken === get()?.token ? profile : null);
  const can = (permission) => Boolean(cached()?.permissions?.includes(permission));
  const canAny = (list) => list.some((permission) => can(permission) || (permission.endsWith(".*") && (cached()?.permissions || []).some((code) => code.startsWith(permission.slice(0, -1)))));
  async function signOut() {
    const session = get();
    clear();
    if (session?.sessionId) await fetch(`/api/identity/sessions/${encodeURIComponent(session.sessionId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${session.token}` } }).catch(() => null);
  }
  window.addEventListener("storage", () => listeners.forEach((listener) => listener(get())));
  // Drop the cached profile, e.g. after enrolling MFA, and fetch it again.
  const refresh = () => { profile = null; profileToken = null; pending = null; return me(); };
  window.svuSession = { get, set, clear, me, refresh, cached, can, canAny, signOut, onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
})();
