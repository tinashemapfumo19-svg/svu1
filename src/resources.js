(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const typeLabels = {book:"Book",journal_article:"Journal article",thesis:"Thesis",past_paper:"Past paper",course_notes:"Course notes",video:"Video",dataset:"Dataset",other:"Other"};
  const catalogueLine = (row) => [row.author,row.publicationYear,typeLabels[row.resourceType],row.programmeCodes?.length ? row.programmeCodes.join(", ") : ""].filter(Boolean).join(" - ");
  const initialState = () => ({data:null,item:null,templates:null,filters:{q:"",keyword:"",collectionId:"",resourceType:"",programme:""},notice:"",busy:false,viewer:null,retention:null});
  const state = initialState();
  let boundToken = null,generation = 0,activeAction = null;
  // Staff sign in through the registry and students through the portal; the repository works with either session.
  function session() {
    for (const key of ["svu.registry.session","svu.applicant.session"]) {
      try { const value = JSON.parse(sessionStorage.getItem(key) || "null"); if (value?.token) return value; } catch { /* Ignore unreadable sessions. */ }
    }
    return null;
  }
  function clearPrivateState() {
    const busy = state.busy;
    Object.assign(state,initialState(),{busy});
  }
  function synchronizeSession() {
    const token = session()?.token || null;
    if (token !== boundToken) {boundToken = token;generation++;clearPrivateState();}
    return {token,generation};
  }
  function isCurrent(binding) {
    const current = synchronizeSession();
    return binding.token === current.token && binding.generation === current.generation;
  }
  async function api(method,path,body) {
    const binding = activeAction || synchronizeSession(),token = binding.token;
    if (!isCurrent(binding)) throw new Error('The repository session changed.');
    const response = await fetch(path,{method,headers:{"Content-Type":"application/json",...(token ? {Authorization:`Bearer ${token}`} : {})},body:body === undefined ? undefined : JSON.stringify(body)});
    const payload = await response.json().catch(() => ({}));
    if (!isCurrent(binding)) throw new Error('The repository session changed.');
    if (!response.ok) {const error = new Error(payload.error?.message || `Request failed (${response.status}).`);error.status = response.status;throw error;}
    return payload.data;
  }
  const size = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1,Math.round(bytes / 1024))} KB`;
  const collectionName = (id) => state.data?.collections.find((row) => row.id === id)?.name || "";

  const templateLabels = {institutionName:"Institution name",title:"Document title",signatoryName:"Signatory name (optional)",signatoryTitle:"Signatory title",footerText:"Footer text",
    notes:"Transcript notes",preamble:"Certificate preamble",conferralText:"Conferral text (must include {{programme}})"};
  const kindLabels = {progressive:"Transcript",certificate:"Award certificate"};
  // Official-document templates: a draft by one person, approval by another, and immutable published versions.
  function templatesView() {
    const data = state.templates;
    if (!data) return "";
    return `<details data-document-templates><summary>Official document templates</summary>
      ${["progressive","certificate"].map((kind) => {
        const rows = data.templates.filter((row) => row.kind === kind),published = rows.find((row) => row.status === "published"),draft = rows.find((row) => row.status === "draft");
        const base = (draft || published)?.content || data.defaults[kind];
        return `<section class="template-kind" data-template-kind="${kind}"><h3>${kindLabels[kind]}</h3>
          <p data-template-current>${published ? `Version ${published.version} in force since ${esc(new Date(published.publishedAt).toLocaleDateString())}` : "Built-in wording in force (no approved template yet)"}</p>
          ${draft ? `<div data-template-draft="${esc(draft.id)}"><p>Draft version ${draft.version} awaiting approval - ${esc(draft.reason)}</p>
            <dl class="transcript-meta">${Object.entries(draft.content).map(([key,value]) => `<dt>${esc(templateLabels[key])}</dt><dd>${esc(value) || "-"}</dd>`).join("")}</dl>
            ${data.capabilities.approve && draft.createdBy !== data.accountId ? `<form class="form form-grid" data-template-review="${esc(draft.id)}"><label class="field"><span>Template decision</span><select class="input" name="outcome"><option value="published">Approve and publish</option><option value="rejected">Reject</option></select></label>
              <label class="field"><span>Decision reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Record template decision</button></div></form>` : ""}</div>` : ""}
          ${data.capabilities.manage && !draft ? `<details><summary>Draft new ${kindLabels[kind].toLowerCase()} wording</summary><form class="form form-grid" data-template-draft-form="${kind}">
            ${Object.keys(base).map((key) => `<label class="field"><span>${esc(templateLabels[key])}</span><input class="input" name="${key}" value="${esc(base[key])}" maxlength="1000"></label>`).join("")}
            <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Submit for approval</button></div></form></details>` : ""}
        </section>`;
      }).join("")}</details>`;
  }
  function listView() {
    const data = state.data,can = data.capabilities;
    return `<section class="ui-panel"><form class="staff-filter resource-search" data-resource-search>
        <label class="field field-wide"><span>Search documents</span><input class="input" name="q" maxlength="200" value="${esc(state.filters.q)}" placeholder="Title, description, or keyword"></label>
        <label class="field"><span>Collection</span><select class="input" name="collectionId"><option value="">All collections</option>${data.collections.map((row) => `<option value="${esc(row.id)}" ${row.id === state.filters.collectionId ? "selected" : ""}>${esc(row.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Keyword</span><input class="input" name="keyword" maxlength="40" value="${esc(state.filters.keyword)}"></label>
        <label class="field"><span>Resource type</span><select class="input" name="resourceType"><option value="">Any</option>${Object.entries(typeLabels).map(([value,label]) => `<option value="${value}" ${state.filters.resourceType === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="field"><span>Programme</span><input class="input" name="programme" maxlength="60" value="${esc(state.filters.programme)}" placeholder="Programme code"></label>
        <div><button class="button button-primary" type="submit">Search</button></div></form></section>
      <section class="ui-panel resource-results">${window.svuUI.head("Documents", { actions: `<p class="ui-meta" data-resource-total>${data.total} document(s)</p>` })}
      ${data.items.length ? `<ul class="resource-list ui-rows">${data.items.map((row) => `<li data-resource-item="${esc(row.id)}" class="resource-row">${window.svuUI.ico(row.resourceType ? "book" : "file", "blue", "ui-icon-sm")}<div><button class="resource-link" type="button" data-resource-open="${esc(row.id)}">${esc(row.title)}</button>
        <span class="muted">${esc(collectionName(row.collectionId))}${row.currentVersion ? ` - version ${row.currentVersion}` : ""}${row.status !== "published" ? ` - ${esc(row.status)}` : ""}</span>
        ${catalogueLine(row) ? `<span data-resource-catalogue>${esc(catalogueLine(row))}</span>` : ""}${row.summary ? `<span>${esc(row.summary.slice(0,200))}</span>` : ""}${row.keywords.length ? `<span class="resource-keywords">${row.keywords.map((word) => `<button class="chip" type="button" data-resource-keyword="${esc(word)}">${esc(word)}</button>`).join("")}</span>` : ""}</div></li>`).join("")}</ul>`
        : window.svuUI.emptyState({ glyph: "search", title: "No documents found", text: "No documents you can see match this search. Try fewer filters or another keyword.", compact: true })}</section>
      ${templatesView()}
      ${can.contribute ? `<details><summary>Add a document</summary><form class="form form-grid" data-resource-create>
        <label class="field"><span>Collection</span><select class="input" name="collectionId" required>${data.collections.filter((row) => row.status === "active").map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Title</span><input class="input" name="title" minlength="3" maxlength="200" required></label>
        <label class="field"><span>Summary</span><input class="input" name="summary" maxlength="4000"></label>
        <label class="field"><span>Keywords (comma separated)</span><input class="input" name="keywords" maxlength="800"></label>
        <label class="field"><span>Author (library items)</span><input class="input" name="author" maxlength="200"></label>
        <label class="field"><span>Publication year</span><input class="input" type="number" name="publicationYear" min="1000" max="2100"></label>
        <label class="field"><span>Resource type</span><select class="input" name="resourceType"><option value="">Not catalogued</option>${Object.entries(typeLabels).map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
        <label class="field"><span>Programmes (comma separated codes)</span><input class="input" name="programmeCodes" maxlength="400"></label>
        <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Create document record</button></div></form></details>` : ""}
      ${can.manage ? `<details data-resource-collections><summary>Collections (${data.collections.length})</summary>
        <ul>${data.collections.map((row) => `<li data-resource-collection="${esc(row.code)}">${esc(row.name)} - ${esc(row.classification)}, ${row.allowDownload ? "download allowed" : "view only"}${row.studentAccess ? ", students" : ""}${row.viewRoles.length ? `, roles: ${esc(row.viewRoles.join(", "))}` : ""}${row.retentionYears ? `, keep ${row.retentionYears} years` : ""} - ${esc(row.status)}</li>`).join("")}</ul>
        <form class="form form-grid" data-resource-collection-create>
          <label class="field"><span>Code</span><input class="input" name="code" pattern="[a-z0-9_]{3,40}" required></label>
          <label class="field"><span>Name</span><input class="input" name="name" maxlength="120" required></label>
          <label class="field"><span>Classification</span><select class="input" name="classification">${["public","internal","confidential","restricted"].map((value) => `<option value="${value}">${value}</option>`).join("")}</select></label>
          <label class="field"><span>View roles (comma separated codes)</span><input class="input" name="viewRoles"></label>
          <label class="field"><span>Open to students</span><select class="input" name="studentAccess"><option value="false">No</option><option value="true">Yes</option></select></label>
          <label class="field"><span>Downloads</span><select class="input" name="allowDownload"><option value="true">Allowed</option><option value="false">View only</option></select></label>
          <label class="field"><span>Retention (years, blank for none)</span><input class="input" type="number" name="retentionYears" min="1" max="100"></label>
          <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Create collection</button></div></form></details>
        <details data-resource-retention-panel><summary>Retention review</summary><button class="button button-secondary" type="button" data-resource-retention>Load items past retention</button>
          ${state.retention ? `<p>${state.retention.items.length} item(s) past retention; ${state.retention.heldCount} under legal hold.</p><ul>${state.retention.items.map((row) => `<li data-resource-retention-item="${esc(row.id)}">${esc(row.title)} - retention ended ${esc(row.retentionUntil)}</li>`).join("")}</ul>` : ""}</details>` : ""}`;
  }
  function detailView() {
    const {item,collection,versions,access,capabilities:can,accountId} = state.item;
    const current = versions.find((row) => row.version === item.currentVersion);
    const pending = versions.find((row) => row.status === "pending");
    return `<section class="resource-detail" data-resource-detail="${esc(item.id)}"><header class="section-header"><h2>${esc(item.title)}</h2><button class="button button-secondary" type="button" data-resource-back>Back to search</button></header>
      <p>${esc(collection.name)} - ${esc(collection.classification)} - <strong data-resource-status>${esc(item.status)}</strong>${item.legalHold ? " - <strong>legal hold</strong>" : ""}${item.retentionUntil ? ` - keep until ${esc(item.retentionUntil)}` : ""}</p>
      ${catalogueLine(item) ? `<p data-resource-catalogue>${esc(catalogueLine(item))}</p>` : ""}${item.description ? `<p>${esc(item.description)}</p>` : ""}${item.summary ? `<p>${esc(item.summary)}</p>` : ""}
      ${current ? `<p data-resource-current>Version ${current.version}: ${esc(current.fileName)} (${size(current.sizeBytes)}) - ${esc(current.changeNote)}</p>
        <div class="button-row"><button class="button button-primary" type="button" data-resource-access="view">View</button>${can.download ? `<button class="button button-secondary" type="button" data-resource-access="download">Download</button>` : `<span class="muted" data-resource-view-only>View only</span>`}</div>` : "<p>No published version yet.</p>"}
      ${state.viewer ? `<iframe class="resource-viewer" data-resource-viewer title="${esc(item.title)}" src="${esc(state.viewer)}"></iframe>` : ""}
      ${versions.length > 1 || pending ? `<h3>Versions</h3><ul>${versions.map((row) => `<li data-resource-version="${row.version}">v${row.version} ${esc(row.fileName)} - ${esc(row.status)}${row.status === "pending" ? ` (file ${esc(row.lifecycle)})` : ""} - ${esc(row.changeNote)}</li>`).join("")}</ul>` : ""}
      ${pending && can.publish && pending.uploadedBy !== accountId ? `<form class="form form-grid" data-resource-review="${pending.version}"><label class="field"><span>Version decision</span><select class="input" name="outcome"><option value="published">Publish</option><option value="rejected">Reject</option></select></label>
        <label class="field"><span>Decision reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Record decision</button></div></form>` : ""}
      ${can.contribute && !pending && item.status !== "withdrawn" ? `<details><summary>Upload ${current ? "a new version" : "the file"}</summary><form class="form form-grid" data-resource-upload>
        <label class="field"><span>File (PDF, JPEG, or PNG, up to 10 MB)</span><input class="input" type="file" name="file" accept="application/pdf,image/jpeg,image/png" required></label>
        <label class="field"><span>Change note</span><input class="input" name="changeNote" maxlength="1000" required></label><div><button class="button button-primary" type="submit">Upload version</button></div></form></details>` : ""}
      ${can.publish && item.status === "published" ? `<details><summary>Withdraw</summary><form class="form form-grid" data-resource-withdraw><label class="field"><span>Withdrawal reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">Withdraw document</button></div></form></details>` : ""}
      ${can.manage ? `<form class="form form-grid" data-resource-hold><label class="field"><span>${item.legalHold ? "Release legal hold" : "Place legal hold"} - reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">${item.legalHold ? "Release hold" : "Place hold"}</button></div></form>` : ""}
      ${access ? `<details data-resource-access-log><summary>Access and change log (${access.length})</summary><ul>${access.map((row) => `<li>${esc(window.svuUI.dateTime(row.occurredAt))} - ${esc(row.action)} - ${esc(row.actorId)} - ${esc(row.reason)}</li>`).join("")}</ul></details>` : ""}
    </section>`;
  }
  function render(app) {
    synchronizeSession();
    if (location.hash.split("?")[0] !== "#resources" && location.hash.split("?")[0] !== "#study/resources") return;
    const signedIn = Boolean(session());
    const study = location.hash.startsWith("#study/");
    const ui = window.svuUI;
    const body = !signedIn ? ui.emptyState({ glyph: "lock", title: "Sign in to see documents", text: "Documents are shown according to your role and programme.", act: `<div class="ui-actions"><a class="button button-primary" href="#signin">Sign in</a></div>` })
      : state.item ? detailView() : state.data ? listView()
      : state.busy ? '<div class="staff-loading ui-bare"><span class="visually-hidden">Loading documents</span><div></div><div></div></div>'
      : ui.emptyState({ glyph: "file", title: "Documents could not be loaded", text: "Try again to load the repository.", act: '<button class="icon-button" type="button" data-resource-retry title="Refresh documents" aria-label="Refresh documents">&#8635;</button>', compact: true });
    app.innerHTML = `<section class="resources-page ${study ? "" : "registry-workspace"}">${study ? "" : `<header class="section-header staff-page-head"><div><p class="eyebrow">Library and repository</p><h1 class="page-title">Document repository</h1><p class="ui-meta ui-page-description">Search university documents, library items and official templates.</p></div></header>`}
      ${state.notice ? `<div class="notice" role="status">${esc(state.notice)}</div>` : ""}
      <div class="staff-body">${body}</div>
    </section>`;
    ui.enhance(app);
    bind(app);
    markBusy(app);
  }
  function markBusy(app) {
    const page = app.querySelector('.resources-page');
    page?.setAttribute('aria-busy',String(state.busy));
    if (state.busy) page?.querySelectorAll('button,input,select,textarea').forEach((node) => {node.disabled = true;});
  }
  async function act(app,work) {
    const binding = synchronizeSession();
    if (!binding.token) {render(app);return;}
    if (state.busy) return;
    state.busy = true; state.notice = ""; activeAction = binding; markBusy(app);
    try { await work(); } catch (error) {
      if (isCurrent(binding)) {
        if ([401,403,404].includes(error.status)) clearPrivateState();
        state.notice = error.message;
      }
    } finally {
      activeAction = null; state.busy = false;
      if (!isCurrent(binding)) {clearPrivateState();window.renderResources(app);}
      else render(app);
    }
  }
  const search = async () => {
    const params = new URLSearchParams(Object.entries(state.filters).filter(([,value]) => value));
    state.data = await api("GET",`/api/repository?${params}`);
    state.templates = await api("GET","/api/document-templates").catch(() => null);
  };
  const openItem = async (id) => {state.item = await api("GET",`/api/repository/items/${id}`); state.viewer = null;};
  function bind(app) {
    const on = (selector,event,handler) => app.querySelectorAll(selector).forEach((node) => node.addEventListener(event,handler));
    const form = (selector,work) => on(selector,"submit",(event) => {event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); act(app,() => work(values,event.target));});
    on('[data-resource-retry]','click',() => act(app,search));
    form("[data-resource-search]",async (values) => {state.filters = {q:values.q.trim(),keyword:values.keyword.trim(),collectionId:values.collectionId,resourceType:values.resourceType,programme:values.programme.trim()}; await search();});
    on("[data-resource-keyword]","click",(event) => act(app,async () => {state.filters = {...state.filters,keyword:event.currentTarget.dataset.resourceKeyword}; await search();}));
    on("[data-resource-open]","click",(event) => act(app,() => openItem(event.currentTarget.dataset.resourceOpen)));
    on("[data-resource-back]","click",() => act(app,async () => {state.item = null; state.viewer = null; await search();}));
    form("[data-resource-create]",async (values) => {
      const catalogue = {...(values.author ? {author:values.author} : {}),...(values.publicationYear ? {publicationYear:Number(values.publicationYear)} : {}),...(values.resourceType ? {resourceType:values.resourceType} : {}),
        programmeCodes:values.programmeCodes.split(",").map((code) => code.trim()).filter(Boolean)};
      const detail = await api("POST","/api/repository/items",{collectionId:values.collectionId,title:values.title,summary:values.summary,keywords:values.keywords.split(",").map((word) => word.trim()).filter(Boolean),...catalogue,reason:values.reason});
      state.item = detail; state.notice = "Document record created. Upload its file next.";
    });
    form("[data-template-draft-form]",async (values,node) => {
      const {reason,...content} = values;
      await api("POST","/api/document-templates",{kind:node.dataset.templateDraftForm,content,reason});
      await search(); state.notice = "Template submitted for approval.";
    });
    form("[data-template-review]",async (values,node) => {
      await api("POST",`/api/document-templates/${node.dataset.templateReview}/review`,values);
      await search(); state.notice = values.outcome === "published" ? "Template approved and in force." : "Template rejected.";
    });
    form("[data-resource-collection-create]",async (values) => {
      await api("POST","/api/repository/collections",{code:values.code,name:values.name,classification:values.classification,viewRoles:values.viewRoles.split(",").map((code) => code.trim()).filter(Boolean),
        studentAccess:values.studentAccess === "true",allowDownload:values.allowDownload === "true",retentionYears:values.retentionYears ? Number(values.retentionYears) : null,reason:values.reason});
      await search(); state.notice = "Collection created.";
    });
    on("[data-resource-retention]","click",() => act(app,async () => {state.retention = await api("GET","/api/repository/retention");}));
    if (!state.item) return;
    const id = state.item.item.id;
    on("[data-resource-access]","click",(event) => act(app,async () => {
      const mode = event.currentTarget.dataset.resourceAccess,link = await api("POST",`/api/repository/items/${id}/access`,{mode});
      if (!isCurrent(activeAction)) return;
      if (mode === "view") state.viewer = link.url;
      else {const anchor = document.createElement("a"); anchor.href = link.url; anchor.download = link.fileName; anchor.click();}
    }));
    form("[data-resource-upload]",async (values) => {
      const file = values.file;
      if (!file?.size) throw new Error("Choose a file to upload.");
      const created = await api("POST",`/api/repository/items/${id}/versions`,{fileName:file.name,contentType:file.type,sizeBytes:file.size,changeNote:values.changeNote});
      if (!created.upload.url) throw new Error(created.upload.note || "No storage is configured.");
      const response = await fetch(created.upload.url,{method:"PUT",headers:{"Content-Type":file.type},body:file});
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message || "Upload failed.");
      await openItem(id); state.notice = `Version ${created.version} uploaded. It needs a malware scan and an independent publisher.`;
    });
    form("[data-resource-review]",async (values,node) => {state.item = await api("POST",`/api/repository/items/${id}/versions/${node.dataset.resourceReview}/review`,values); state.notice = values.outcome === "published" ? "Version published." : "Version rejected.";});
    form("[data-resource-withdraw]",async (values) => {state.item = await api("POST",`/api/repository/items/${id}/withdraw`,values); state.notice = "Document withdrawn.";});
    form("[data-resource-hold]",async (values) => {state.item = await api("POST",`/api/repository/items/${id}/hold`,{legalHold:!state.item.item.legalHold,reason:values.reason}); state.notice = state.item.item.legalHold ? "Legal hold placed." : "Legal hold released.";});
  }
  window.renderResources = (app) => {
    render(app);
    if (['#resources', '#study/resources'].includes(location.hash.split('?')[0]) && session() && !state.data && !state.notice) act(app,search);
  };
})();
