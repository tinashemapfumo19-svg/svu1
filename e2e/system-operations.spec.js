import { test, expect } from '@playwright/test';
import { loadConfig } from '../server/config.js';
import { createPool } from '../server/db.js';

test('shared login opens live workflow, task, reference and notification actions', async ({ page, request }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#signin?next=foundation');
  await page.locator('[data-shell-signin] [name=email]').fill('admin@southvalley.test');
  await page.locator('[data-shell-signin] [name=password]').fill('Phase1-Admin-Password-2026!');
  await page.locator('[data-shell-signin] button[type=submit]').click();
  await expect(page).toHaveURL(/#foundation$/);
  await ready();
  const session = await page.evaluate(() => window.svuSession.get());
  const me = (await (await request.get('/api/identity/me', { headers: { authorization: `Bearer ${session.token}` } })).json()).data;
  const stamp = `${info.project.name}.${Date.now()}`;

  await tab('workflows');
  await page.locator('details').filter({ hasText: 'Start workflow' }).first().locator('summary').click();
  const create = page.locator('[data-operation=workflow-create]');
  await create.locator('[name=subjectType]').fill('Application');
  await create.locator('[name=subjectId]').fill(`screen.${stamp}`);
  await create.locator('[name=programmeCode]').selectOption('BSC-IS');
  await create.locator('[name=reason]').fill('Native screen workflow');
  await create.locator('button[type=submit]').click();
  await ready();
  await expect(page.getByRole('heading', { name: `screen.${stamp}`, exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Workflow started.');
  const transition = page.locator('[data-operation=workflow-transition]');
  const next = await transition.locator('[name=toState]').inputValue();
  await transition.locator('[name=reason]').fill('Native screen transition');
  await transition.locator('button[type=submit]').click();
  await ready();
  await expect(page.locator('.system-page ol')).toContainText('Native screen transition');
  await expect(page.locator('.system-page ol')).toContainText(next);
  await screenshot('workflow-screen.png');

  const workflows = (await (await request.get('/api/workflows/instances', { headers: { authorization: `Bearer ${session.token}` } })).json()).data;
  const ownWorkflow = workflows.find(row => row.subjectId === `screen.${stamp}`);
  const config = loadConfig();
  expect(new URL(config.databaseUrl).pathname).toMatch(/^\/svu_rebuild_it_/);
  const pool = createPool(config), taskId = `task_screen_${stamp}`;
  try {
    await pool.query("insert into tasks(id,title,queue,workflow_instance_id,status,priority) values($1,$2,'screen.tasks',$3,'open','normal')", [taskId, `Native task ${stamp}`, ownWorkflow.id]);
  } finally { await pool.end(); }

  await tab('tasks');
  await page.locator('[data-operation=task-filter] [name=q]').fill(`Native task ${stamp}`);
  await page.locator('[data-operation=task-filter] button[type=submit]').click();
  await ready();
  const task = page.locator(`[data-operation=task-update][data-record-id="${taskId}"]`);
  await task.locator('xpath=..').locator('summary').click();
  await task.locator('[name=assignToMe]').check();
  await task.locator('[name=reason]').fill('Native task assignment');
  await task.locator('button[type=submit]').click();
  await ready();
  await expect(page.getByRole('status')).toHaveText('Task updated.');
  let tasks = (await (await request.get('/api/tasks', { headers: { authorization: `Bearer ${session.token}` } })).json()).data;
  expect(tasks.find(row => row.id === taskId).assigneeAccountId).toBe(me.account.id);
  const update = page.locator(`[data-operation=task-update][data-record-id="${taskId}"]`);
  await update.locator('xpath=..').locator('summary').click();
  await update.locator('[name=action]').selectOption('complete');
  await update.locator('[name=reason]').fill('Native task completion');
  await update.locator('button[type=submit]').click();
  await ready();
  tasks = (await (await request.get('/api/tasks', { headers: { authorization: `Bearer ${session.token}` } })).json()).data;
  expect(tasks.find(row => row.id === taskId).status).toBe('completed');

  await tab('reference');
  const select = page.locator('[data-operation=reference-select]');
  await select.locator('[name=code]').selectOption('study_mode');
  await select.locator('button[type=submit]').click();
  await ready();
  await page.locator('summary').filter({ hasText: /^Add value$/ }).click();
  const add = page.locator('[data-operation=reference-create]');
  const code = `SCREEN_${info.project.name.toUpperCase()}_${Date.now()}`;
  await add.locator('[name=valueCode]').fill(code);
  await add.locator('[name=label]').fill(`Native screen ${stamp}`);
  await add.locator('[name=effectiveFrom]').fill(new Date().toISOString().slice(0, 10));
  await add.locator('[name=reason]').fill('Native reference screen');
  await add.locator('button[type=submit]').click();
  await ready();
  const detail = (await (await request.get('/api/master-data/reference-lists/study_mode?includeRetired=true')).json()).data;
  const value = detail.values.find(row => row.valueCode === code);
  expect(value.label).toBe(`Native screen ${stamp}`);
  const status = page.locator(`[data-operation=reference-status][data-record-id="${value.id}"]`);
  await status.locator('[name=effectiveTo]').fill(new Date().toISOString().slice(0, 10));
  await status.locator('[name=reason]').fill('Native reference retirement');
  await status.locator('button[type=submit]').click();
  await ready();
  await expect(page.locator(`[data-operation=reference-status][data-record-id="${value.id}"]`)).toHaveAttribute('data-action', 'restore');
  await screenshot('reference-screen.png');

  await tab('notifications');
  const templates = (await (await request.get('/api/notifications/templates', { headers: { authorization: `Bearer ${session.token}` } })).json()).data;
  const template = templates.find(row => row.code === 'results.published' && row.status === 'active');
  const compose = page.locator('[data-operation=notification-template]');
  await compose.locator('[name=templateId]').selectOption(template.id);
  await compose.locator('button[type=submit]').click();
  await ready();
  const message = page.locator('[data-operation=notification-compose]');
  await message.locator('[name=recipientAccountId]').fill(me.account.id);
  await message.locator('button[value=preview]').click();
  await ready();
  await expect(page.locator('[data-notification-preview]')).toContainText('Your results are available');
  await message.locator('button[value=send]').click();
  await ready();
  await expect(page.getByRole('status')).toHaveText('Message queued.');
  await expect(page.locator('.system-operation-list')).toContainText('Your results are available');
  await screenshot('notification-screen.png');
  await tab('evidence');
  await expect(page.getByRole('heading', { name: 'Database recovery', exact: true })).toBeVisible();
  await expect(page.locator('.result-table').first()).toContainText('passed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);

  async function ready() { await expect(page.locator('.system-page')).toHaveAttribute('aria-busy', 'false'); }
  async function tab(name) {
    await page.locator(`[data-system-tab=${name}]`).click(); await ready();
    const selected = await page.locator(`[data-system-tab=${name}]`).boundingBox();
    const strip = await page.locator('[aria-label="System areas"]').boundingBox();
    expect(selected.x).toBeGreaterThanOrEqual(strip.x);
    expect(selected.x + selected.width).toBeLessThanOrEqual(strip.x + strip.width + 1);
  }
  async function screenshot(name) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    expect(await page.evaluate(() => scrollY)).toBe(0);
    const title = await page.getByRole('heading', { name: 'System', exact: true }).boundingBox();
    const header = await page.locator('.top-nav').boundingBox();
    expect(title.y).toBeGreaterThanOrEqual(header.y + header.height);
    await page.screenshot({ path: info.outputPath(name), fullPage: true });
  }
});

test('departed System responses cannot overwrite another screen or session', async ({ page }) => {
  await page.goto('/#signin?next=foundation');
  await page.locator('[data-shell-signin] [name=email]').fill('admin@southvalley.test');
  await page.locator('[data-shell-signin] [name=password]').fill('Phase1-Admin-Password-2026!');
  await page.locator('[data-shell-signin] button[type=submit]').click();
  await expect(page.locator('.system-page')).toHaveAttribute('aria-busy', 'false');
  let held;
  const pending = new Promise(resolve => { held = resolve; });
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  await page.route('**/api/tasks', async route => { held(); await wait; await route.fulfill({ json: { data: [{ id: 'departed', title: 'Private departed task', queue: 'old', status: 'open' }] } }); });
  await page.locator('[data-system-tab=tasks]').click();
  await pending;
  await page.evaluate(() => { location.hash = '#home'; });
  await expect(page.locator('.system-page')).toHaveCount(0);
  release();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).not.toContainText('Private departed task');
  await page.unroute('**/api/tasks');
  await page.goto('/#foundation');
  await expect(page.locator('.system-page')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => window.svuSession.clear());
  await expect(page).toHaveURL(/#signin\?next=foundation$/);
  await expect(page.locator('.system-page')).toHaveCount(0);
});
