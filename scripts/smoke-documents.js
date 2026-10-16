import { createHash } from "node:crypto";

const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const studentCredentials = {
  email: "tinashe@example.edu",
  password: "Phase1-Student-Password-2026!"
};

const pdfBytes = Buffer.from(`%PDF-1.4\n% SVU smoke ${Date.now()}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const disguisedExecutable = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0x90)]);

const intentBody = (bytes, extra = {}) => ({
  ownerType: "Application",
  ownerId: "app_mock_001",
  documentType: "national_id",
  classification: "confidential",
  fileName: "national-id.pdf",
  contentType: "application/pdf",
  sizeBytes: bytes.length,
  checksum: sha256(bytes),
  reason: "Document smoke test",
  ...extra
});

const results = {};

try {
  const admin = await login(adminCredentials);
  const student = await login(studentCredentials);

  results.disallowedTypeRejected = await expectStatus("/api/documents/upload-requests",
    request("POST", intentBody(pdfBytes, { contentType: "application/x-php", fileName: "shell.php" }), admin.token), 400);
  results.oversizeDeclarationRejected = await expectStatus("/api/documents/upload-requests",
    request("POST", intentBody(pdfBytes, { sizeBytes: 50 * 1024 * 1024 }), admin.token), 400);

  const intent = (await send("POST", "/api/documents/upload-requests", intentBody(pdfBytes), admin.token)).data;
  const documentId = intent.document.id;
  results.storageProvider = intent.upload.provider;
  results.storageKeyHidesFileName = !intent.document.storageKey.includes("national-id");

  const tampered = intent.upload.url.replace(/signature=[^&]+/, "signature=forged");
  results.forgedUploadSignatureRejected = await expectStatus(tampered, upload(pdfBytes), 403);
  results.bodyLargerThanDeclaredRejected = await expectStatus(intent.upload.url, upload(Buffer.concat([pdfBytes, Buffer.from("x")])), 413);

  const uploaded = (await send("PUT", intent.upload.url, null, null, upload(pdfBytes))).data;
  results.uploadedLifecycle = uploaded.lifecycle;
  results.signatureVerified = uploaded.signatureVerified;
  results.secondUploadRejected = await expectStatus(intent.upload.url, upload(pdfBytes), 409);

  results.downloadBeforeScanRejected = await expectStatus(`/api/documents/${documentId}/download-requests`, request("POST", {}, admin.token), 409);
  results.studentScanDenied = await expectStatus(`/api/documents/${documentId}/scan-results`, request("POST", { result: "clean" }, student.token), 403);
  const scanned = (await send("POST", `/api/documents/${documentId}/scan-results`, { result: "clean" }, admin.token)).data;
  results.scannedLifecycle = scanned.lifecycle;

  results.studentReviewDenied = await expectStatus(`/api/documents/${documentId}/reviews`,
    request("POST", { decision: "verified", reason: "x" }, student.token), 403);
  results.reviewWithoutReasonRejected = await expectStatus(`/api/documents/${documentId}/reviews`,
    request("POST", { decision: "verified" }, admin.token), 400);
  await send("POST", `/api/documents/${documentId}/reviews`, { decision: "verified", reason: "Matches applicant record" }, admin.token);

  const link = (await send("POST", `/api/documents/${documentId}/download-requests`, { reason: "Completeness review" }, admin.token)).data;
  const download = await fetch(`${baseUrl}${link.url}`);
  const downloaded = Buffer.from(await download.arrayBuffer());
  results.downloadStatus = download.status;
  results.downloadMatchesUpload = downloaded.equals(pdfBytes);
  results.downloadIsAttachment = (download.headers.get("content-disposition") || "").startsWith("attachment");
  results.forgedDownloadRejected = await expectStatus(link.url.replace(/signature=[^&]+/, "signature=forged"), { method: "GET" }, 403);
  results.uploadLinkCannotDownload = await expectStatus(
    intent.upload.url.replace("op=upload", "op=download"),
    { method: "GET" },
    403
  );

  const detail = (await send("GET", `/api/documents/${documentId}`, null, admin.token)).data;
  results.finalLifecycle = detail.lifecycle;
  results.reviews = detail.reviews.map((review) => review.decision);

  const fake = (await send("POST", "/api/documents/upload-requests",
    intentBody(disguisedExecutable, { fileName: "transcript.pdf", documentType: "prior_transcript" }), admin.token)).data;
  const fakeUpload = (await send("PUT", fake.upload.url, null, null, upload(disguisedExecutable))).data;
  results.disguisedFileLifecycle = fakeUpload.lifecycle;
  results.quarantinedScanRejected = await expectStatus(`/api/documents/${fake.document.id}/scan-results`,
    request("POST", { result: "clean" }, admin.token), 409);
  results.quarantinedDownloadRejected = await expectStatus(`/api/documents/${fake.document.id}/download-requests`,
    request("POST", {}, admin.token), 409);

  const mismatched = (await send("POST", "/api/documents/upload-requests",
    intentBody(pdfBytes, { checksum: sha256(Buffer.from("something else")) }), admin.token)).data;
  results.checksumMismatchRejected = await expectStatus(mismatched.upload.url, upload(pdfBytes), 422);

  const audit = (await send("GET", `/api/audit/events?subjectType=Document&subjectId=${documentId}`, null, admin.token)).data;
  results.auditActions = [...new Set(audit.map((event) => event.action))].sort();

  const failures = [
    results.uploadedLifecycle !== "uploaded" && "upload should land in uploaded",
    results.scannedLifecycle !== "available" && "clean scan should make the document available",
    !results.downloadMatchesUpload && "downloaded bytes differ from uploaded bytes",
    results.finalLifecycle !== "verified" && "review should verify the document",
    results.disguisedFileLifecycle !== "quarantined" && "executable posing as PDF should be quarantined",
    results.auditActions.length !== 5 && "expected requested/uploaded/scanned/verified/downloaded audit events"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function upload(bytes) {
  return { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes };
}

async function login(credentials) {
  const response = await send("POST", "/api/identity/sessions", credentials);
  return response.data;
}

async function send(method, path, body, token, options) {
  const response = await fetch(`${baseUrl}${path}`, options || request(method, body, token));
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${path} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function request(method, body, token) {
  const options = {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json"
    }
  };
  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }
  return options;
}

async function expectStatus(path, options, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`Expected ${expectedStatus} for ${options.method} ${path}, received ${response.status}: ${body}`);
  }
  return response.status;
}
