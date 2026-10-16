import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { matchesFileSignature } from "../storage.js";
import {
  assertActorCanAccessScope,
  getResourceScope,
  insertAudit,
  requestError,
  requireFields,
  withTransaction
} from "../support.js";

// Private documents: metadata in PostgreSQL, bytes in a storage adapter, access only through
// short-lived HMAC-signed URLs issued after permission, scope, and lifecycle checks.
//
// Lifecycle: upload_requested -> uploaded -> available (scan clean) -> verified | rejected (review)
//                                        \-> quarantined (signature mismatch or infected)

export const allowedUploadContentTypes = ["application/pdf", "image/jpeg", "image/png"];
export const documentClassifications = ["public", "internal", "confidential", "restricted"];
export const maxUploadBytes = 10 * 1024 * 1024;
const uploadUrlTtlMs = 1000 * 60 * 15;
const downloadUrlTtlMs = 1000 * 60 * 5;
const downloadableLifecycles = ["available", "verified"];

const documentSelect = `select
  id,
  owner_type as "ownerType",
  owner_id as "ownerId",
  document_type as "documentType",
  classification,
  storage_key as "storageKey",
  checksum,
  lifecycle,
  malware_scan_status as "malwareScanStatus",
  file_name as "fileName",
  content_type as "contentType",
  size_bytes as "sizeBytes",
  signature_verified as "signatureVerified",
  scanned_at as "scannedAt",
  created_at as "createdAt"
from documents`;

export function assertUploadIsAllowed(input) {
  const problems = [];
  if (!allowedUploadContentTypes.includes(input.contentType)) {
    problems.push(`content type must be one of ${allowedUploadContentTypes.join(", ")}`);
  }
  if (!documentClassifications.includes(input.classification)) {
    problems.push(`classification must be one of ${documentClassifications.join(", ")}`);
  }
  const size = Number(input.sizeBytes);
  if (!Number.isInteger(size) || size <= 0 || size > maxUploadBytes) {
    problems.push(`size must be between 1 and ${maxUploadBytes} bytes`);
  }
  if (typeof input.fileName !== "string" || input.fileName.length > 255 || /[\\/\0]/.test(input.fileName)) {
    problems.push("file name must be a plain name without path separators");
  }
  if (input.checksum && !/^[a-f0-9]{64}$/i.test(input.checksum)) {
    problems.push("checksum must be a SHA-256 hex digest");
  }
  if (problems.length > 0) {
    throw requestError(400, `Upload rejected: ${problems.join("; ")}.`);
  }
}

export function signDocumentUrl(key, operation, documentId, expiresAt) {
  return createHmac("sha256", key).update(`${operation}:${documentId}:${expiresAt}`).digest("base64url");
}

export function verifyDocumentUrl(key, operation, documentId, expires, signature, now = Date.now()) {
  if (!expires || !signature) {
    throw requestError(403, "This link is missing its signature.");
  }
  const expected = Buffer.from(signDocumentUrl(key, operation, documentId, expires));
  const provided = Buffer.from(String(signature));
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw requestError(403, "This link's signature is not valid.");
  }
  if (Number(expires) < now) {
    throw requestError(410, "This link has expired; request a new one.");
  }
}

export function signedPath(key, operation, documentId, ttlMs) {
  const expires = Date.now() + ttlMs;
  const signature = signDocumentUrl(key, operation, documentId, expires);
  return {
    url: `/api/documents/${documentId}/content?op=${operation}&expires=${expires}&signature=${signature}`,
    expiresAt: new Date(expires).toISOString()
  };
}

export function createDocumentsModule(pool, { storage = null, signingKey }) {
  // Repository files are reachable here only for the malware scan; reading, review, and download go through the
  // repository so its collection permissions and download controls apply.
  async function loadForActor(db, documentId, actor, { forUpdate = false, allowRepository = false } = {}) {
    const result = await db.query(`${documentSelect} where id = $1 ${forUpdate ? "for update" : ""}`, [documentId]);
    if (result.rowCount === 0 || (result.rows[0].ownerType === "RepositoryVersion" && !allowRepository)) {
      throw requestError(404, "Document was not found.");
    }
    const document = result.rows[0];
    assertActorCanAccessScope(actor, await getResourceScope(db, document.ownerType, document.ownerId));
    return document;
  }

  return {
    async createDocument(input, actor) {
      requireFields(input, ["ownerType", "ownerId", "documentType", "classification", "storageKey"]);
      assertActorCanAccessScope(actor, await getResourceScope(pool, input.ownerType, input.ownerId));
      const id = `doc_${randomUUID()}`;
      return withTransaction(pool, async (client) => {
        await client.query(
          `insert into documents (id, owner_type, owner_id, document_type, classification, storage_key, checksum, lifecycle, malware_scan_status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, input.ownerType, input.ownerId, input.documentType, input.classification, input.storageKey,
            input.checksum || "pending", input.lifecycle || "uploaded", input.malwareScanStatus || "pending"]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "document.created",
          subjectType: "Document",
          subjectId: id,
          reason: input.reason || "Phase 1 document metadata demo"
        });
        return (await client.query(`${documentSelect} where id = $1`, [id])).rows[0];
      });
    },

    async listDocuments(filters = {}) {
      const conditions = ["owner_type <> 'RepositoryVersion'"];
      const values = [];
      if (filters.ownerType) {
        values.push(filters.ownerType);
        conditions.push(`owner_type = $${values.length}`);
      }
      if (filters.ownerId) {
        values.push(filters.ownerId);
        conditions.push(`owner_id = $${values.length}`);
      }
      const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
      return (await pool.query(`${documentSelect} ${where} order by created_at desc`, values)).rows;
    },

    async getDocument(documentId, actor) {
      const document = await loadForActor(pool, documentId, actor);
      const reviews = await pool.query(
        `select id, decision, reason, reviewer_account_id as "reviewerAccountId", reviewed_at as "reviewedAt"
         from document_reviews where document_id = $1 order by reviewed_at`,
        [documentId]
      );
      return { ...document, reviews: reviews.rows };
    },

    async createUploadRequest(input, actor) {
      requireFields(input, ["ownerType", "ownerId", "documentType", "classification", "fileName", "contentType", "sizeBytes"]);
      assertUploadIsAllowed(input);
      assertActorCanAccessScope(actor, await getResourceScope(pool, input.ownerType, input.ownerId));

      const id = `doc_${randomUUID()}`;
      const document = {
        id,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        documentType: input.documentType,
        classification: input.classification,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: Number(input.sizeBytes),
        storageKey: `private/${input.ownerType.toLowerCase()}/${randomUUID()}`,
        checksum: input.checksum ? input.checksum.toLowerCase() : "pending",
        lifecycle: "upload_requested",
        malwareScanStatus: "pending"
      };
      const upload = storage
        ? { provider: storage.provider, method: "PUT", ...signedPath(signingKey, "upload", id, uploadUrlTtlMs) }
        : { provider: "unconfigured", method: "PUT", url: null, expiresAt: null, note: "No storage provider is configured (ADR-004)." };

      return withTransaction(pool, async (client) => {
        await client.query(
          `insert into documents (
            id, owner_type, owner_id, document_type, classification, storage_key, checksum, lifecycle,
            malware_scan_status, file_name, content_type, size_bytes, upload_expires_at
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [id, document.ownerType, document.ownerId, document.documentType, document.classification, document.storageKey,
            document.checksum, document.lifecycle, document.malwareScanStatus, document.fileName, document.contentType,
            document.sizeBytes, upload.expiresAt]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "document.upload_requested",
          subjectType: "Document",
          subjectId: id,
          reason: input.reason || `Upload intent issued for ${document.documentType}`
        });
        return {
          document,
          upload: { ...upload, headers: { "Content-Type": document.contentType }, maxSizeBytes: document.sizeBytes }
        };
      });
    },

    // Receives the bytes for a signed upload link. The declared size is a hard limit, the first bytes
    // must match the declared type, and a declared checksum must match what arrived.
    async receiveUpload(documentId, query, bytes) {
      if (!storage) {
        throw requestError(501, "No storage provider is configured (ADR-004).");
      }
      verifyDocumentUrl(signingKey, "upload", documentId, query.expires, query.signature);
      const result = await pool.query(`${documentSelect} where id = $1`, [documentId]);
      const document = result.rows[0];
      if (!document) {
        throw requestError(404, "Document was not found.");
      }
      if (document.lifecycle !== "upload_requested") {
        throw requestError(409, `This document is already ${document.lifecycle}.`);
      }
      if (bytes.length === 0 || bytes.length > Number(document.sizeBytes)) {
        throw requestError(413, `Upload must be between 1 and ${document.sizeBytes} bytes (the declared size).`);
      }

      const checksum = createHash("sha256").update(bytes).digest("hex");
      if (document.checksum !== "pending" && document.checksum !== checksum) {
        throw requestError(422, "The uploaded bytes do not match the declared SHA-256 checksum.");
      }
      const signatureOk = matchesFileSignature(document.contentType, bytes);
      await storage.put(document.storageKey, bytes);

      return withTransaction(pool, async (client) => {
        const lifecycle = signatureOk ? "uploaded" : "quarantined";
        await client.query(
          `update documents
           set lifecycle = $1, checksum = $2, size_bytes = $3, signature_verified = $4,
               malware_scan_status = case when $4 then malware_scan_status else 'not_scanned_signature_mismatch' end
           where id = $5 and lifecycle = 'upload_requested'`,
          [lifecycle, checksum, bytes.length, signatureOk, documentId]
        );
        await insertAudit(client, {
          actorId: "signed_upload",
          action: signatureOk ? "document.uploaded" : "document.quarantined",
          subjectType: "Document",
          subjectId: documentId,
          reason: signatureOk
            ? `Received ${bytes.length} bytes; signature matches ${document.contentType}`
            : `File signature does not match declared ${document.contentType}`
        });
        return { id: documentId, lifecycle, checksum, sizeBytes: bytes.length, signatureVerified: signatureOk };
      });
    },

    async recordDocumentScan(documentId, input, actor) {
      requireFields(input, ["result"]);
      if (!["clean", "infected"].includes(input.result)) {
        throw requestError(400, "Scan result must be clean or infected.");
      }
      return withTransaction(pool, async (client) => {
        const before = await loadForActor(client, documentId, actor, { forUpdate: true, allowRepository: true });
        if (before.lifecycle !== "uploaded") {
          throw requestError(409, `Only uploaded documents can be scanned; this one is ${before.lifecycle}.`);
        }
        // The scanner may also report a type mismatch the magic-byte check missed.
        const signatureVerified = before.signatureVerified !== false && input.signatureVerified !== false;
        const scanStatus = input.result === "clean" && signatureVerified ? "clean" : "infected";
        const lifecycle = scanStatus === "clean" ? "available" : "quarantined";
        await client.query(
          `update documents
           set malware_scan_status = $1, lifecycle = $2, signature_verified = $3, scanned_at = now(), scanned_by = $4
           where id = $5`,
          [scanStatus, lifecycle, signatureVerified, actor.accountId, documentId]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: scanStatus === "clean" ? "document.scan.passed" : "document.quarantined",
          subjectType: "Document",
          subjectId: documentId,
          reason: input.reason || `Scan result ${input.result}; signature ${signatureVerified ? "verified" : "mismatch"}`
        });
        return (await client.query(`${documentSelect} where id = $1`, [documentId])).rows[0];
      });
    },

    async reviewDocument(documentId, input, actor) {
      requireFields(input, ["decision", "reason"]);
      if (!["verified", "rejected"].includes(input.decision)) {
        throw requestError(400, "decision must be verified or rejected.");
      }
      return withTransaction(pool, async (client) => {
        const before = await loadForActor(client, documentId, actor, { forUpdate: true });
        if (before.lifecycle !== "available") {
          throw requestError(409, `Only scanned, available documents can be reviewed; this one is ${before.lifecycle}.`);
        }
        const reviewId = `drv_${randomUUID()}`;
        await client.query(
          `insert into document_reviews (id, document_id, decision, reason, reviewer_account_id)
           values ($1, $2, $3, $4, $5)`,
          [reviewId, documentId, input.decision, input.reason, actor.accountId]
        );
        await client.query("update documents set lifecycle = $1 where id = $2", [input.decision, documentId]);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: `document.${input.decision}`,
          subjectType: "Document",
          subjectId: documentId,
          reason: input.reason,
          beforeRef: before.lifecycle,
          afterRef: input.decision
        });
        return { id: documentId, lifecycle: input.decision, reviewId };
      });
    },

    async createDownloadRequest(documentId, input, actor) {
      if (!storage) {
        throw requestError(501, "No storage provider is configured (ADR-004).");
      }
      const document = await loadForActor(pool, documentId, actor);
      if (!downloadableLifecycles.includes(document.lifecycle)) {
        throw requestError(409, `Only clean documents can be downloaded; this one is ${document.lifecycle}.`);
      }
      // Access to private documents is itself sensitive, so every issued link is audited with a purpose.
      await insertAudit(pool, {
        actorId: actor.accountId,
        action: "document.download_requested",
        subjectType: "Document",
        subjectId: documentId,
        reason: input.reason || "Document viewed"
      });
      return { method: "GET", ...signedPath(signingKey, "download", documentId, downloadUrlTtlMs) };
    },

    // "view" links are issued only by the repository, for inline viewing without a download prompt.
    async readDownload(documentId, query, operation = "download") {
      if (!storage) {
        throw requestError(501, "No storage provider is configured (ADR-004).");
      }
      if (!["download", "view"].includes(operation)) throw requestError(400, "Unknown document operation.");
      verifyDocumentUrl(signingKey, operation, documentId, query.expires, query.signature);
      const result = await pool.query(`${documentSelect} where id = $1`, [documentId]);
      const document = result.rows[0];
      if (!document || !downloadableLifecycles.includes(document.lifecycle)) {
        throw requestError(409, "This document is no longer available.");
      }
      return { document, bytes: await storage.get(document.storageKey) };
    }
  };
}
