import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// A minimal valid PDF: the upload pipeline checks the %PDF signature before scanning.
const pdf = (label) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\n% ${label}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);

test("records managers curate collections whose permissions, view-only rules, versions, and holds govern every access",async ({page,browser,request},info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,code = (name) => `${name}_${info.project.name}_${Date.now() % 100000}`;
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const people = {};
  for (const [key,role] of [["manager","records_manager"],["manager2","records_manager"],["contributor","academic_registrar"],["hr","hr_officer"],["student","student"]]) {
    people[key] = await account(`repo.${key}.${stamp}@example.com`);
    await api("POST","/api/access/role-assignments",{accountId:people[key].id,roleCode:role,scope:{},reason:"Repository journey"},admin.token);
  }
  const {manager,manager2,contributor,hr,student} = people;

  // Collections: only records managers create them, and confidential material can never be opened to students.
  const handbooks = await api("POST","/api/repository/collections",{code:code("handbooks"),name:`Student handbooks ${stamp}`,classification:"internal",viewRoles:["academic_registrar"],studentAccess:true,allowDownload:true,retentionYears:5,reason:"Handbooks"},manager.token);
  await denied("POST","/api/repository/collections",{code:code("nope"),name:"Not allowed",classification:"internal",reason:"No authority"},contributor.token,403);
  await denied("POST","/api/repository/collections",{code:code("leak"),name:"Leak",classification:"confidential",studentAccess:true,reason:"Bad"},manager.token,400);
  await denied("POST","/api/repository/collections",{code:handbooks.code,name:"Duplicate",classification:"internal",reason:"Dup"},manager.token,409);

  // The records manager creates the confidential, view-only HR collection in the UI.
  await signIn(page,manager,"svu.registry.session");
  await page.locator("[data-resource-collections] > summary").click();
  await submit(page.locator("[data-resource-collection-create]"),{code:code("hr"),name:`HR policies ${stamp}`,classification:"confidential",viewRoles:"hr_officer",studentAccess:"false",allowDownload:"false",retentionYears:7,reason:"HR policy library"});
  await expect(page.getByRole("status")).toHaveText("Collection created.");
  const hrCollection = (await api("GET","/api/repository",undefined,manager.token)).collections.find((row) => row.name === `HR policies ${stamp}`);
  expect(hrCollection).toMatchObject({classification:"confidential",viewRoles:["hr_officer"],studentAccess:false,allowDownload:false,retentionYears:7});

  // The contributor records a handbook and uploads its file in the UI; it waits for the scan and an independent publisher.
  await signIn(page,contributor,"svu.registry.session");
  expect((await api("GET","/api/repository",undefined,contributor.token)).collections.map((row) => row.id)).not.toContain(hrCollection.id);
  await denied("POST","/api/repository/items",{collectionId:hrCollection.id,title:"Hidden",reason:"Out of reach"},contributor.token,404);
  await page.locator("details:has([data-resource-create]) > summary").click();
  await submit(page.locator("[data-resource-create]"),{collectionId:handbooks.id,title:`Student handbook ${stamp}`,summary:"Rules, services and support for students",keywords:"Handbook, rules",reason:"Annual handbook"});
  await expect(page.getByRole("status")).toHaveText("Document record created. Upload its file next.");
  const handbookId = await page.locator("[data-resource-detail]").getAttribute("data-resource-detail");
  await page.locator("details:has([data-resource-upload]) > summary").click();
  await page.locator('[data-resource-upload] [name="file"]').setInputFiles({name:"handbook-2026.pdf",mimeType:"application/pdf",buffer:pdf("v1")});
  await submit(page.locator("[data-resource-upload]"),{changeNote:"First edition"});
  await expect(page.getByRole("status")).toHaveText("Version 1 uploaded. It needs a malware scan and an independent publisher.");
  let item = await api("GET",`/api/repository/items/${handbookId}`,undefined,manager.token);
  expect(item.versions[0]).toMatchObject({version:1,status:"pending",lifecycle:"uploaded",fileName:"handbook-2026.pdf"});
  const firstDocument = item.versions[0].documentId;
  await denied("POST",`/api/repository/items/${handbookId}/versions/1/review`,{outcome:"published",reason:"Unscanned"},manager.token,409);
  await api("POST",`/api/documents/${firstDocument}/scan-results`,{result:"clean"},admin.token);
  await denied("POST",`/api/repository/items/${handbookId}/versions/1/review`,{outcome:"published",reason:"No publish authority"},contributor.token,403);
  await denied("POST",`/api/repository/items/${handbookId}/versions`,{fileName:"second.pdf",contentType:"application/pdf",sizeBytes:100,changeNote:"Too soon"},contributor.token,409);
  // Repository files are hidden from the generic document endpoints.
  await denied("GET",`/api/documents/${firstDocument}`,undefined,admin.token,404);
  expect((await api("GET","/api/documents",undefined,admin.token)).some((row) => row.id === firstDocument)).toBe(false);

  await signIn(page,manager,"svu.registry.session");
  await submit(page.locator("[data-resource-search]"),{q:"handbook"});
  await openItem(handbookId);
  await submit(page.locator('[data-resource-review="1"]'),{outcome:"published",reason:"Approved by Student Affairs"});
  await expect(page.getByRole("status")).toHaveText("Version published.");
  item = await api("GET",`/api/repository/items/${handbookId}`,undefined,manager.token);
  expect(item.item).toMatchObject({status:"published",currentVersion:1,retentionUntil:expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)});
  expect(Number(item.item.retentionUntil.slice(0,4)) - new Date().getUTCFullYear()).toBe(5);

  // An HR policy, uploaded by one manager and published by another, is view-only for HR officers and invisible to others.
  const hrDetail = await api("POST","/api/repository/items",{collectionId:hrCollection.id,title:`Leave policy ${stamp}`,keywords:["leave"],reason:"HR policy"},manager.token);
  const hrId = hrDetail.item.id,hrVersion = await api("POST",`/api/repository/items/${hrId}/versions`,{fileName:"leave.pdf",contentType:"application/pdf",sizeBytes:pdf("hr").length,changeNote:"Approved policy"},manager.token);
  expect((await request.fetch(hrVersion.upload.url,{method:"PUT",data:pdf("hr"),headers:{"Content-Type":"application/pdf"}})).ok()).toBe(true);
  await api("POST",`/api/documents/${hrVersion.documentId}/scan-results`,{result:"clean"},admin.token);
  await denied("POST",`/api/repository/items/${hrId}/versions/1/review`,{outcome:"published",reason:"Own upload"},manager.token,403);
  await api("POST",`/api/repository/items/${hrId}/versions/1/review`,{outcome:"published",reason:"Second records manager"},manager2.token);
  const view = await api("POST",`/api/repository/items/${hrId}/access`,{mode:"view",reason:"Checking leave rules"},hr.token);
  const served = await request.fetch(view.url);
  expect([served.status(),served.headers()["content-disposition"],served.headers()["x-content-type-options"]]).toEqual([200,'inline; filename="leave.pdf"',"nosniff"]);
  await denied("POST",`/api/repository/items/${hrId}/access`,{mode:"download"},hr.token,403);
  expect((await request.fetch(view.url.replace("op=view","op=download"))).status()).toBe(403);
  for (const outsider of [student,contributor]) await denied("GET",`/api/repository/items/${hrId}`,undefined,outsider.token,404);

  // Library catalogue: a book with author, year, type, and programmes, published like any other item.
  const programmeCode = `LIB-${info.project.name}`.toUpperCase();
  await denied("POST","/api/repository/items",{collectionId:handbooks.id,title:"Bad year",publicationYear:3000,reason:"Bad"},contributor.token,400);
  const book = await api("POST","/api/repository/items",{collectionId:handbooks.id,title:`Things Fall Apart ${stamp}`,author:"Chinua Achebe",publicationYear:1958,resourceType:"book",programmeCodes:[programmeCode.toLowerCase()],keywords:["literature"],reason:"Set text"},contributor.token);
  expect(book.item).toMatchObject({author:"Chinua Achebe",publicationYear:1958,resourceType:"book",programmeCodes:[programmeCode]});
  const bookVersion = await api("POST",`/api/repository/items/${book.item.id}/versions`,{fileName:"achebe.pdf",contentType:"application/pdf",sizeBytes:pdf("book").length,changeNote:"Library copy"},contributor.token);
  await request.fetch(bookVersion.upload.url,{method:"PUT",data:pdf("book"),headers:{"Content-Type":"application/pdf"}});
  await api("POST",`/api/documents/${bookVersion.documentId}/scan-results`,{result:"clean"},admin.token);
  await api("POST",`/api/repository/items/${book.item.id}/versions/1/review`,{outcome:"published",reason:"Catalogued"},manager.token);
  expect((await api("GET",`/api/repository?q=achebe&collectionId=${handbooks.id}`,undefined,student.token)).items.map((row) => row.id)).toEqual([book.item.id]);
  expect((await api("GET",`/api/repository?resourceType=book&programme=${programmeCode}&collectionId=${handbooks.id}`,undefined,student.token)).items.map((row) => row.id)).toEqual([book.item.id]);
  expect((await api("GET",`/api/repository?resourceType=thesis&programme=${programmeCode}`,undefined,student.token)).total).toBe(0);

  // Students find the handbook by keyword, view it inline, and download it; the access is logged for managers.
  await signIn(page,student,"svu.applicant.session");
  await submit(page.locator("[data-resource-search]"),{resourceType:"book",programme:programmeCode});
  await expect(page.locator(`[data-resource-item="${book.item.id}"] [data-resource-catalogue]`)).toHaveText(`Chinua Achebe - 1958 - Book - ${programmeCode}`);
  await submit(page.locator("[data-resource-search]"),{resourceType:"",programme:""});
  await page.locator('[data-resource-keyword="handbook"]').first().click();
  await expect(page.locator("[data-resource-total]")).toHaveText("1 document(s)");
  await openItem(handbookId);
  await page.locator('[data-resource-access="view"]').click();
  await expect(page.locator("[data-resource-viewer]")).toHaveAttribute("src",/op=view/);
  const download = page.waitForEvent("download");
  await page.locator('[data-resource-access="download"]').click();
  expect((await download).suggestedFilename()).toBe("handbook-2026.pdf");
  expect((await api("GET","/api/repository?q=leave",undefined,student.token)).total).toBe(0);
  expect((await api("GET","/api/repository?q=100%25_x",undefined,student.token)).total).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("student-resources.png"),fullPage:true});

  // A new version supersedes the first; earlier versions are for managers only. Withdrawal hides the item from students.
  const second = await api("POST",`/api/repository/items/${handbookId}/versions`,{fileName:"handbook-2026b.pdf",contentType:"application/pdf",sizeBytes:pdf("v2").length,changeNote:"Corrected fees page"},contributor.token);
  await request.fetch(second.upload.url,{method:"PUT",data:pdf("v2"),headers:{"Content-Type":"application/pdf"}});
  await api("POST",`/api/documents/${second.documentId}/scan-results`,{result:"clean"},admin.token);
  item = await api("POST",`/api/repository/items/${handbookId}/versions/2/review`,{outcome:"published",reason:"Correction approved"},manager.token);
  expect(item.versions.map((row) => [row.version,row.status])).toEqual([[2,"published"],[1,"superseded"]]);
  await denied("POST",`/api/repository/items/${handbookId}/access`,{mode:"view",version:1},student.token,403);
  expect((await api("POST",`/api/repository/items/${handbookId}/access`,{mode:"view",version:1,reason:"Audit"},manager.token)).version).toBe(1);
  const log = (await api("GET",`/api/repository/items/${handbookId}`,undefined,manager.token)).access.map((row) => row.action);
  expect(log).toEqual(expect.arrayContaining(["repository.item.viewed","repository.item.downloaded","repository.version.published","repository.item.created"]));
  expect((await api("GET",`/api/repository/items/${handbookId}`,undefined,student.token)).access).toBeNull();
  await api("POST",`/api/repository/items/${handbookId}/withdraw`,{reason:"Replaced by the 2027 handbook"},manager.token);
  await denied("GET",`/api/repository/items/${handbookId}`,undefined,student.token,404);
  await denied("POST",`/api/repository/items/${handbookId}/withdraw`,{reason:"Again"},manager.token,409);

  // Legal holds are reasoned and counted in the retention review.
  await api("POST",`/api/repository/items/${hrId}/hold`,{legalHold:true,reason:"Employment tribunal"},manager.token);
  await denied("POST",`/api/repository/items/${hrId}/hold`,{legalHold:true,reason:"Again"},manager.token,409);
  await denied("POST",`/api/repository/items/${hrId}/hold`,{legalHold:false,reason:"Not a manager"},hr.token,403);
  const retention = await api("GET","/api/repository/retention",undefined,manager.token);
  expect(retention.heldCount).toBeGreaterThanOrEqual(1);
  await denied("GET","/api/repository/retention",undefined,contributor.token,403);

  // Clicks made while a search is still loading are ignored by the page, so retry until the detail is shown.
  async function openItem(id) {
    await expect(async () => {await page.locator(`[data-resource-open="${id}"]`).click(); await expect(page.locator(`[data-resource-detail="${id}"]`)).toBeVisible({timeout:2000});}).toPass({timeout:20000});
  }
  async function signIn(target,person,key) {
    await target.goto("/#resources");
    await target.evaluate(([storageKey,token]) => {sessionStorage.clear(); sessionStorage.setItem(storageKey,JSON.stringify({token}));},[key,person.token]);
    await target.reload();
    await expect(target.locator("[data-resource-total]")).toBeVisible();
  }
  async function outboxToken(email) {
    const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),"utf8"))));
    return messages.find((row) => row.recipientEmail === email).variables.activationToken;
  }
  async function account(email) {
    const password = "Kariba-Dam-Applicant-2026!",legalName = `Repository Person ${email.split("@")[0]}`;
    await api("POST","/api/admissions/registrations",{email,preferredName:"Person",legalName});
    await api("POST","/api/identity/activations",{token:await outboxToken(email),password,preferredName:"Person",legalName});
    const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);
    return {email,password,token:session.token,id:me.account.id};
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
