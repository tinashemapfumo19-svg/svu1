import { expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { resultsChecksum } from "../../server/modules/results.js";

export async function exerciseResults({page,staff,browser,request,admin,applicantToken,programme,stranger,stamp,testInfo}) {
  const base = `/api/registry/programmes/${programme.id}/results`;
  const own = `/api/registry/me/programmes/${programme.id}/results`;
  const registrar = await staff.evaluate(() => JSON.parse(sessionStorage.getItem("svu.registry.session")));
  const context = await api("GET",base,undefined,registrar.token);
  const periodId = context.periods[0].period.id;
  expect(context.periods[0].completion.counts).toMatchObject({expectedRecords:2,awaitingRecording:2,awaitingReview:0,awaitingPublication:0,publishedRecords:0});
  const batchPath = `${base}/${periodId}/batches`;
  const code = `result_${stamp.replaceAll(".","_")}`;
  const bands = [{minMark:0,maxMark:39,grade:"F",points:0,passing:false},{minMark:40,maxMark:69,grade:"C",points:2,passing:true},{minMark:70,maxMark:100,grade:"A",points:4,passing:true}];
  const scheme = await api("POST","/api/master-data/grading-schemes",{code,name:`Results ${stamp}`,bands,classifications:[{minGpa:3.5,label:"Distinction"},{minGpa:2,label:"Pass"}]},admin.token);
  await api("POST",`/api/master-data/grading-schemes/${scheme.id}/publish`,{effectiveFrom:"2026-01-01",reason:"Synthetic results policy"},registrar.token);
  const policy = await api("POST","/api/master-data/gpa-rule-sets",{code,name:`GPA ${stamp}`,gradingSchemeId:scheme.id,
    rules:{creditWeighted:true,retakePolicy:"latest",excludeGrades:[],includeFailed:true,rounding:{decimals:2,mode:"half_up"}},
    samples:[{name:"Two equal-credit passes",results:[{courseCode:"A",credits:15,mark:75},{courseCode:"B",credits:15,mark:50}],expectedGpa:3,expectedClassification:"Pass"}]},admin.token);
  await api("POST",`/api/master-data/gpa-rule-sets/${policy.id}/publish`,{effectiveFrom:"2026-01-01",reason:"Worked example verified"},registrar.token);
  await refused("GET",base,undefined,stranger.token,403);
  await refused("GET",base,undefined,applicantToken,403);
  await staff.locator("[data-results-refresh]").click();
  await expect(staff.locator("[data-results-refresh]")).toBeEnabled();
  await expect(staff.locator(`[data-result-completion="${periodId}"] [data-result-completion-count="awaitingRecording"]`)).toHaveText('2');
  const details = staff.locator(`[data-result-period="${periodId}"] > details`);
  await details.locator("summary").click();
  const downloadPromise = staff.waitForEvent("download");
  await staff.locator(`[data-result-roster="${periodId}"]`).click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  const roster = JSON.parse(await readFile(downloadedPath,"utf8"));
  expect(roster.rows.every((row) => row.mark === null)).toBe(true);
  const sampleRun = spawnSync(process.execPath,["scripts/results-export.js",downloadedPath,"--sample"],{encoding:"utf8"});
  expect(sampleRun.status,sampleRun.stderr).toBe(0);
  let sample = JSON.parse(sampleRun.stdout);
  sample.sourceRef = `SAMPLE-${stamp}`;
  let input = {...sample,gpaRuleSetId:policy.id,reason:"Synthetic final marks for pilot verification"};
  await refused("POST",batchPath,{...input,expectedMarkTotal:0},registrar.token,400);
  const incomplete = [sample.rows[0]];
  await refused("POST",batchPath,{...input,rows:incomplete,expectedRowCount:1,expectedMarkTotal:incomplete[0].mark,checksum:resultsChecksum(incomplete)},registrar.token,409);
  await refused("POST",batchPath,input,applicantToken,403);
  await importThroughUi(sample);
  let data = await api("GET",base,undefined,registrar.token);
  let batch = data.periods[0].batches.find((entry) => entry.status === "draft");
  expect(data.periods[0].completion.counts).toMatchObject({recordedRecords:2,awaitingRecording:0,awaitingReview:2,publishedRecords:0});
  await expect(staff.locator(`[data-result-completion="${periodId}"] [data-result-completion-count="awaitingReview"]`)).toHaveText('2');
  expect(await api("GET",own,undefined,applicantToken)).toEqual([]);
  await refused("POST",`${batchPath}/${batch.id}/publish`,{reason:"Unreviewed"},admin.token,409);
  await refused("POST",`${batchPath}/${batch.id}/review`,{outcome:"reviewed",reason:"Wrong scope",evidenceRef:"SAMPLE"},stranger.token,403);
  await refuseSourceChanges(batch.id,'review',admin.token);
  const rejectionDb=new pg.Client({connectionString:process.env.DATABASE_URL});await rejectionDb.connect();
  try {
    await rejectionDb.query("update result_batches set checksum=repeat('0',64) where id=$1",[batch.id]);
    await api("POST",`${batchPath}/${batch.id}/review`,{outcome:"rejected",reason:"Reject a damaged source without approving it",evidenceRef:`REJECT-${stamp}`},admin.token);
  } finally {try{await rejectionDb.query('update result_batches set checksum=$2 where id=$1',[batch.id,batch.checksum]);}finally{await rejectionDb.end();}}
  expect((await api('GET',base,undefined,registrar.token)).periods[0].completion.counts).toMatchObject({awaitingRecording:2,awaitingReview:0,publishedRecords:0,rejectedBatches:1});
  await refused("POST",batchPath,input,registrar.token,409);
  sample = {...sample,sourceRef:`SAMPLE-RECHECK-${stamp}`};
  await staff.locator("[data-results-refresh]").click();
  await expect(staff.locator("[data-results-refresh]")).toBeEnabled();
  await staff.locator(`[data-result-period="${periodId}"] > details summary`).click();
  await importThroughUi(sample);
  data = await api("GET",base,undefined,registrar.token);
  expect(data.periods[0].batches.some((entry) => entry.status === "rejected")).toBe(true);
  batch = data.periods[0].batches.find((entry) => entry.status === "draft");
  const registrarMe = await api("GET","/api/identity/me",undefined,registrar.token);
  const strangerMe = await api("GET","/api/identity/me",undefined,stranger.token);
  for (const accountId of [registrarMe.account.id,strangerMe.account.id]) await api("POST","/api/access/role-assignments",{accountId,roleCode:"examinations_officer",scope:{programmeCodes:["BSC-IS"],intakeIds:[programme.intakeId]},reason:"Independent result review test"},admin.token);
  await refused("POST",`${batchPath}/${batch.id}/review`,{outcome:"reviewed",reason:"Importer self approval",evidenceRef:"SELF"},registrar.token,403);
  await api("POST","/api/access/role-assignments",{accountId:strangerMe.account.id,roleCode:"student",scope:{},reason:"Owner privacy test"},admin.token);
  await refused("GET",own,undefined,stranger.token,404);
  await refuseForgedReview(batch.id,strangerMe.account.id,stranger.token);
  const reviewerContext = await browser.newContext({viewport:testInfo.project.use.viewport,isMobile:testInfo.project.use.isMobile,hasTouch:testInfo.project.use.hasTouch});
  const reviewer = await reviewerContext.newPage();
  try {
    await reviewer.goto("/#registry");
    await reviewer.locator('[data-registry-login] [name="email"]').fill(stranger.email);
    await reviewer.locator('[data-registry-login] [name="password"]').fill(stranger.password);
    await reviewer.locator("[data-registry-login]").getByRole("button",{name:"Sign in",exact:true}).click();
    await reviewer.locator(`[data-registry-detail="${programme.id}"]`).click();
    const reviewForm = reviewer.locator(`[data-result-review="${batch.id}"]`);
    await reviewForm.locator('[name="evidenceRef"]').fill(`MODERATION-${stamp}`);
    await reviewForm.locator('[name="reason"]').fill("Independent synthetic source and roster reconciliation");
    await reviewForm.getByRole("button",{name:"Record result review",exact:true}).click();
    await expect(reviewer.getByRole("status")).toHaveText("Result review recorded.");
    await expect(reviewer.locator(`[data-result-completion="${periodId}"] [data-result-completion-count="awaitingPublication"]`)).toHaveText('2');
    expect((await api('GET',base,undefined,stranger.token)).periods[0].completion.counts).toMatchObject({awaitingPublication:2,awaitingReview:0,publishedRecords:0});
    expect(await api("GET",own,undefined,applicantToken)).toEqual([]);
    await refused("POST",`${batchPath}/${batch.id}/publish`,{reason:"Importer publication"},registrar.token,403);
    await refuseSourceChanges(batch.id,'publish',stranger.token);
    const publishForm = reviewer.locator(`[data-result-publish="${batch.id}"]`);
    await publishForm.locator('[name="reason"]').fill("Release independently reviewed synthetic results");
    const publishedResponse = reviewer.waitForResponse((response) => response.url().endsWith(`/batches/${batch.id}/publish`));
    await publishForm.getByRole("button",{name:"Publish results",exact:true}).click();
    const retries = await Promise.all([api("POST",`${batchPath}/${batch.id}/publish`,{reason:"Concurrent retry"},stranger.token),api("POST",`${batchPath}/${batch.id}/publish`,{reason:"Concurrent retry"},stranger.token)]);
    const published = (await (await publishedResponse).json()).data;
    expect(retries.every((entry) => entry.id === published.id)).toBe(true);
    await expect(reviewer.getByRole("status")).toHaveText("Results published.");
    await expect(reviewer.locator(`[data-result-completion="${periodId}"] [data-result-completion-count="publishedRecords"]`)).toHaveText('2');
    await refused("POST",`${batchPath}/${batch.id}/review`,{outcome:"rejected",reason:"Cannot edit published results",evidenceRef:"LATE"},stranger.token,409);
    await page.reload();
    await expect(page.locator(".student-results")).toContainText(sample.sourceRef);
    await expect(page.locator(".student-results")).toContainText("GPA 3 - Pass");
    const ownResults = await api("GET",own,undefined,applicantToken);
    expect(ownResults).toHaveLength(1);
    expect(ownResults[0].results).toHaveLength(2);
    expect(ownResults[0].policy.ruleSetId).toBe(policy.id);
    const db = new pg.Client({connectionString:process.env.DATABASE_URL}); await db.connect();
    try {
      expect((await db.query("select count(*)::int as count from academic_results where batch_id = $1",[batch.id])).rows[0].count).toBe(2);
      expect((await db.query("select count(*)::int as count from audit_events where subject_id = $1 and action = 'results.batch.published'",[batch.id])).rows[0].count).toBe(1);
      const notices=(await db.query("select n.recipient_account_id,n.status,n.payload from notifications n join notification_templates t on t.id=n.template_id where t.code='results.published' and n.created_at=(select published_at from result_batches where id=$1)",[batch.id])).rows;
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({recipient_account_id:(await api('GET','/api/identity/me',undefined,applicantToken)).account.id,status:'queued',payload:{subject:'Your results are available',body:'New results are available in your student portal. Sign in to view your official results.',sensitive:false}});
      expect(Object.keys(notices[0].payload).sort()).toEqual(['body','sensitive','subject']);
      expect((await db.query("select metadata->>'queuedNotices' as count from audit_events where subject_id=$1 and action='results.batch.published'",[batch.id])).rows[0].count).toBe('1');
      const inbox = await api('GET','/api/notifications/me?limit=50',undefined,applicantToken);
      const publicationNotice = inbox.items.find(row=>row.subject==='Your results are available');
      expect(publicationNotice).toMatchObject({body:'New results are available in your student portal. Sign in to view your official results.',readAt:null});
      expect(Object.keys(publicationNotice).sort()).toEqual(['body','createdAt','id','readAt','subject']);
      expect((await api('GET',base,undefined,stranger.token)).periods[0].completion).toMatchObject({definitionVersion:'result-period-completion-v1',sourceCurrent:true,counts:{publishedRecords:2,awaitingRecording:0,awaitingPublication:0,rejectedBatches:1}});
      const original=(await db.query('select checksum from result_batches where id=$1',[batch.id])).rows[0].checksum;
      try {
        await db.query("update result_batches set checksum=repeat('0',64) where id=$1",[batch.id]);
        await refused('GET',base,undefined,stranger.token,409);
        await reviewer.locator('[data-results-refresh]').click();
        await expect(reviewer.getByRole('status')).toHaveText('Result completion source evidence requires reconciliation.');
        await expect(reviewer.locator('[data-result-completion], [data-result-batch]')).toHaveCount(0);
      } finally {await db.query('update result_batches set checksum=$2 where id=$1',[batch.id,original]);}
      await reviewer.locator('[data-results-refresh]').click();
      await expect(reviewer.locator(`[data-result-completion="${periodId}"] [data-result-completion-count="publishedRecords"]`)).toHaveText('2');
      const completionEvents=(await db.query("select metadata from audit_events where subject_id=$1 and action='results.completion.viewed'",[programme.id])).rows;
      expect(completionEvents.length).toBeGreaterThan(0);
      for(const event of completionEvents)expect(Object.keys(event.metadata).sort()).toEqual(['changedSourcePeriods','definitionVersion','periodCount']);
    } finally {await db.end();}
    for (const current of [page,reviewer]) {
      expect(await current.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await current.evaluate(() => scrollTo(0,0));
    }
    await page.screenshot({path:testInfo.outputPath("results-published-student.png"),fullPage:true});
    await reviewer.screenshot({path:testInfo.outputPath("results-published-reviewer.png"),fullPage:true});
  } finally {await reviewerContext.close();}

  async function importThroughUi(sample) {
    const form = staff.locator(`[data-result-import="${periodId}"]`);
    await form.locator('[name="export"]').setInputFiles({name:"sample-results.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(sample))});
    await form.locator('[name="gpaRuleSetId"]').selectOption(policy.id);
    await form.locator('[name="reason"]').fill("Synthetic final marks for pilot verification");
    await form.getByRole("button",{name:"Import result batch",exact:true}).click();
    await expect(staff.getByRole("status")).toHaveText("Result batch imported and reconciled.");
  }
  async function refuseSourceChanges(id,action,token) {
    const edits = [
      source => ({checksum:'0'.repeat(64)}),
      source => ({row_count:source.row_count+1}),
      source => {const rows=structuredClone(source.rows);rows[0].grade='FORGED';return {rows};},
      source => {const rows=structuredClone(source.rows);rows[0].mark++;return {rows,checksum:resultsChecksum(rows),mark_total:rows.reduce((sum,row)=>sum+row.mark,0)};},
      source => {const policy=structuredClone(source.policy_snapshot);policy.rule.rules.retakePolicy='best';return {policy_snapshot:policy};},
      source => ({created_at:new Date(Date.now()+5000).toISOString()})
    ];
    if(action==='publish')edits.push(source=>({evidence_ref:'FORGED'}),source=>({reviewed_at:new Date(Date.now()+5000).toISOString()}));
    for(const edit of edits)await changedBatch(id,edit,async () => {
      await refused('POST',`${batchPath}/${id}/${action}`,action==='review'?{outcome:'reviewed',reason:'Refuse changed source',evidenceRef:'SAMPLE'}:{reason:'Refuse changed source'},token,409);
    });
  }
  async function refuseForgedReview(id,reviewerId,token) {
    await changedBatch(id,()=>({status:'reviewed',reviewed_by:reviewerId,reviewed_at:new Date().toISOString(),review_reason:'FORGED',evidence_ref:'FORGED'}),async () => {
      await refused('POST',`${batchPath}/${id}/publish`,{reason:'A status field is not a review receipt'},token,409);
    });
  }
  async function changedBatch(id,edit,exercise) {
    const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
    let original;
    const write=source=>db.query(`update result_batches set rows=$2,checksum=$3,row_count=$4,mark_total=$5,policy_snapshot=$6,status=$7,
      created_at=$8,reviewed_by=$9,reviewed_at=$10,review_reason=$11,evidence_ref=$12 where id=$1`,
      [id,JSON.stringify(source.rows),source.checksum,source.row_count,source.mark_total,JSON.stringify(source.policy_snapshot),source.status,source.created_at,source.reviewed_by,source.reviewed_at,source.review_reason,source.evidence_ref]);
    try {
      // PostgreSQL text retains timestamp microseconds exactly when the fixture is restored.
      original=(await db.query('select rows,checksum,row_count,mark_total,policy_snapshot,status,created_at::text as created_at,reviewed_by,reviewed_at::text as reviewed_at,review_reason,evidence_ref from result_batches where id=$1',[id])).rows[0];
      const changed={...original,...edit(original)};
      const before=(await db.query("select count(*)::int as count from audit_events where subject_id=$1 and action in ('results.batch.reviewed','results.batch.published')",[id])).rows[0].count;
      await write(changed);await exercise();
      expect((await db.query('select status from result_batches where id=$1',[id])).rows[0].status).toBe(changed.status);
      expect((await db.query('select count(*)::int as count from academic_results where batch_id=$1',[id])).rows[0].count).toBe(0);
      expect((await db.query("select count(*)::int as count from audit_events where subject_id=$1 and action in ('results.batch.reviewed','results.batch.published')",[id])).rows[0].count).toBe(before);
    }finally {try{if(original)await write(original);}finally{await db.end();}}
  }
  async function api(method,path,data,token) {
    const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});
    expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  }
  async function refused(method,path,data,token,status) {
    const response = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});
    expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);
  }
}
