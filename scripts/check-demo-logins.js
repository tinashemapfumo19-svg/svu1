import { createSeedData } from './seed-data.js';

const base = new URL(process.env.SVU_BASE_URL || 'http://127.0.0.1:4177');
if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
  throw new Error('Demo credentials may only be checked against a local server.');
}

let failed = false;
for (const account of createSeedData().accounts.filter((row) => row.devPassword)) {
  let session;
  try {
    const response = await fetch(new URL('/api/identity/sessions', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.email, password: account.devPassword }),
      signal: AbortSignal.timeout(10000)
    });
    const body = await response.json();
    session = body.data;
    if (!response.ok || session?.status !== 'active') failed = true;
    console.log(`${account.email}: HTTP ${response.status}, ${session?.status || 'login failed'}`);
  } catch (error) {
    failed = true;
    console.error(`${account.email}: ${error.message}`);
  } finally {
    if (session?.id && session?.token) {
      try {
        const response = await fetch(new URL(`/api/identity/sessions/${encodeURIComponent(session.id)}`, base), {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.token}` },
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        failed = true;
        console.error(`${account.email}: probe logout failed (${error.message})`);
      }
    }
  }
}
process.exitCode = failed ? 1 : 0;
