import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("integrations are catalogued with owners and agreements, and outbound messages retry, dead-letter, and replay safely",async ({page,request},info) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}_${Date.now() % 1000000}`;
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const auditor = await account(`integrations.auditor.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:auditor.id,roleCode:"auditor",scope:{},reason:"Integration oversight"},admin.token);

  // The catalogue starts with the connections the rebuild depends on; auditors can read it but not change it.
  const catalogue = await api("GET","/api/integrations",undefined,auditor.token);
  expect(catalogue.connections.map((row) => row.code)).toEqual(expect.arrayContaining(["lms_connector","email_provider","sms_provider","payment_gateway","malware_scanner","bank_statements"]));
  expect(catalogue.capabilities.manage).toBe(false);
  const code = `partner_${stamp}`;
  const definition = {code,name:`Partner exchange ${stamp}`,direction:"outbound",counterparty:"Partner college",purpose:"Share approved credit transfer decisions",owner:"Registry",classification:"internal",
    authMethod:"Mutual TLS",timeoutMs:200,maxAttempts:1,adapter:"development"};
  await denied("POST","/api/integrations/connections",{...definition,reason:"Not allowed"},auditor.token,403);
  await denied("POST","/api/integrations/connections",definition,admin.token,400);
  const connection = await api("POST","/api/integrations/connections",{...definition,reason:"New partner agreement in negotiation"},admin.token);
  await denied("POST","/api/integrations/connections",{...definition,reason:"Duplicate"},admin.token,409);
  await denied("POST",`/api/integrations/connections/${connection.id}`,{revision:connection.revision,status:"active",reason:"No agreement yet"},admin.token,409);
  const active = await api("POST",`/api/integrations/connections/${connection.id}`,{revision:connection.revision,status:"active",agreementRef:"DSA-2026-014",reason:"Agreement signed"},admin.token);
  expect(active).toMatchObject({status:"active",agreementRef:"DSA-2026-014",revision:2});

  // Idempotency: the same key and payload replays the original message; reusing the key for other content is refused.
  const queue = (key,payload,operation = "credit.decision") => api("POST","/api/integrations/outbox",{connectionCode:code,idempotencyKey:`${key}-${stamp}`,operation,payload,reason:"Journey"},admin.token);
  const ok = await queue("decision-0001",{decision:"approved"});
  expect(await queue("decision-0001",{decision:"approved"})).toMatchObject({id:ok.id,replayed:true});
  await denied("POST","/api/integrations/outbox",{connectionCode:code,idempotencyKey:`decision-0001-${stamp}`,operation:"credit.decision",payload:{decision:"rejected"},reason:"Different"},admin.token,409);
  const failing = await queue("decision-0002",{simulate:"fail"}),hanging = await queue("decision-0003",{simulate:"timeout"});
  await denied("POST","/api/integrations/outbox",{connectionCode:"bank_statements",idempotencyKey:`inbound-only-${stamp}`,operation:"x",reason:"Inbound"},admin.token,409);

  // The operator runs the delivery worker from the registry panel: one delivery, one rejection, one timeout.
  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  await page.locator("[data-integrations-panel] > summary").click();
  await page.locator("[data-integration-process]").click();
  await expect(page.getByRole("status")).toContainText("Delivery worker processed");
  const messages = Object.fromEntries((await api("GET",`/api/integrations/outbox?connection=${code}`,undefined,auditor.token)).map((row) => [row.id,row]));
  expect(messages[ok.id]).toMatchObject({status:"delivered",attempts:1,response:{receipt:expect.stringMatching(/^dev-/)}});
  expect(messages[failing.id]).toMatchObject({status:"dead",attempts:1,lastError:"Simulated provider rejection"});
  expect(messages[hanging.id]).toMatchObject({status:"dead",attempts:1,lastError:"Timed out after 200 ms"});
  expect((await api("GET",`/api/integrations/outbox/${hanging.id}/attempts`,undefined,auditor.token)).map((row) => row.outcome)).toEqual(["timeout"]);
  await expect(page.locator(`[data-integration="${code}"] [data-integration-dead]`)).toHaveText("2");

  // Dead letters are retried or cancelled with a reason; the attempt history keeps every try.
  await page.locator('[data-integration-queue="dead"]').click();
  await submit(page.locator(`[data-integration-retry="${failing.id}"]`),{reason:"Partner fixed their endpoint"});
  await expect(page.getByRole("status")).toHaveText("Message queued for another attempt.");
  expect((await api("GET",`/api/integrations/outbox?connection=${code}&status=pending`,undefined,auditor.token)).map((row) => row.id)).toContain(failing.id);
  await page.locator('[data-integration-queue="dead"]').click();
  await submit(page.locator(`[data-integration-cancel="${hanging.id}"]`),{reason:"Superseded by a corrected decision"});
  await expect(page.getByRole("status")).toHaveText("Message cancelled.");
  await denied("POST",`/api/integrations/outbox/${ok.id}/retry`,{reason:"Delivered already"},admin.token,409);
  await denied("POST",`/api/integrations/outbox/${hanging.id}/cancel`,{reason:"Again"},admin.token,409);
  await api("POST","/api/integrations/outbox/process",{connectionCode:code},admin.token);
  expect((await api("GET",`/api/integrations/outbox/${failing.id}/attempts`,undefined,auditor.token)).map((row) => [row.attempt,row.outcome])).toEqual([[1,"failed"],[1,"failed"]]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);

  // Contract checks run a ping through the real path; connections without an adapter report that plainly.
  await submit(page.locator("[data-integration-check]"),{code,reason:"Pre-go-live check"});
  await expect(page.getByRole("status")).toHaveText("Contract check passed.");
  expect((await api("POST","/api/integrations/connections/payment_gateway/check",{reason:"Provider pending"},admin.token)).outcome).toBe("not_configured");

  // Restricted payloads are never displayed; suspended connections hold messages; retired ones refuse them.
  await api("POST","/api/integrations/outbox",{connectionCode:"payment_gateway",idempotencyKey:`payment-${stamp}`,operation:"payment.refund",payload:{amount:50,account:"0000"},reason:"Refund"},admin.token);
  const restricted = (await api("GET","/api/integrations/outbox?connection=payment_gateway",undefined,auditor.token)).find((row) => row.idempotencyKey === `payment-${stamp}`);
  expect(restricted.payload).toEqual({redacted:true,fields:["account","amount"]});
  const current = (await api("GET","/api/integrations",undefined,admin.token)).connections.find((row) => row.code === code);
  await api("POST",`/api/integrations/connections/${current.id}`,{revision:current.revision,status:"suspended",reason:"Partner maintenance"},admin.token);
  const held = await queue("decision-0004",{decision:"approved"});
  await api("POST","/api/integrations/outbox/process",{connectionCode:code},admin.token);
  expect((await api("GET",`/api/integrations/outbox?connection=${code}&status=pending`,undefined,auditor.token)).map((row) => row.id)).toContain(held.id);
  await api("POST",`/api/integrations/connections/${current.id}`,{revision:current.revision + 1,status:"retired",reason:"Agreement ended"},admin.token);
  await denied("POST","/api/integrations/outbox",{connectionCode:code,idempotencyKey:`decision-0005-${stamp}`,operation:"credit.decision",reason:"Retired"},admin.token,409);
  await denied("POST",`/api/integrations/connections/${current.id}`,{revision:current.revision + 2,status:"active",reason:"Revive"},admin.token,409);
  const events = (await api("GET",`/api/audit/events?subjectId=${connection.id}`,undefined,admin.token)).map((row) => row.action);
  expect(events).toEqual(expect.arrayContaining(["integrations.connection.created","integrations.connection.active","integrations.connection.suspended","integrations.connection.retired","integrations.connection.checked"]));
  await page.screenshot({path:info.outputPath("integrations.png"),fullPage:true});

  async function outboxToken(email) {
    const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),"utf8"))));
    return messages.find((row) => row.recipientEmail === email).variables.activationToken;
  }
  async function account(email) {
    const password = "Kariba-Dam-Applicant-2026!",legalName = `Integration Person ${email.split("@")[0]}`;
    await api("POST","/api/admissions/registrations",{email,preferredName:"Person",legalName});
    await api("POST","/api/identity/activations",{token:await outboxToken(email),password,preferredName:"Person",legalName});
    const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);
    return {email,password,token:session.token,id:me.account.id};
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
