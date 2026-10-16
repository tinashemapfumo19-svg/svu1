import { requestError } from "../support.js";

export function admissionsDefinition(code, version, academicStages = ["Academic review"]) {
  const reserved = ["Draft", "Submitted", "Payment verified", "Completeness review", "Information requested", "Decision", "Offer issued", "Rejected", "Accepted", "Declined", "Deferred", "Withdrawn", "Expired"];
  if (!Array.isArray(academicStages) || academicStages.length < 1 || academicStages.length > 6
      || academicStages[0] !== "Academic review" || new Set(academicStages).size !== academicStages.length
      || academicStages.some((stage) => typeof stage !== "string" || !/^[A-Za-z][A-Za-z ]{2,49}$/.test(stage) || reserved.includes(stage))) {
    throw requestError(400, "academicStages must start with Academic review and contain 1-6 distinct review stages.");
  }
  const path = ["Draft", "Submitted", "Payment verified", "Completeness review", ...academicStages, "Decision"];
  return {
    id: `wf_${code}_v${version}`, code, version, initialState: "Draft",
    states: [...path, "Information requested", "Offer issued", "Rejected", "Accepted", "Declined", "Deferred", "Withdrawn", "Expired"],
    terminalStates: ["Rejected", "Accepted", "Declined", "Deferred", "Withdrawn", "Expired"],
    transitions: [
      ...path.slice(1).map((to, index) => ({ from: path[index], to })),
      ...["Completeness review", ...academicStages].map((from) => ({ from, to: "Information requested" })),
      { from: "Information requested", to: "Completeness review" },
      ...["Offer issued", "Rejected", "Deferred"].map((to) => ({ from: "Decision", to, permission: "admissions.decide" })),
      ...["Accepted", "Declined", "Expired"].map((to) => ({ from: "Offer issued", to })),
      { from: "Offer issued", to: "Deferred", permission: "admissions.decide" },
      ...[...path, "Information requested", "Offer issued"].map((from) => ({ from, to: "Withdrawn" }))
    ]
  };
}

export function requiredDocuments(application) {
  const requirements = application.requirements || {};
  const category = application.answers?.applicantCategory || "standard";
  return [...new Set([...(requirements.documents || []), ...(requirements.documentsByCategory?.[category] || [])])];
}

export function validateAdmissionsRequirements(requirements) {
  if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) throw requestError(400, "Requirements must be an object.");
  if (Object.keys(requirements).some(key=>!['documents','documentsByCategory'].includes(key))) throw requestError(400,'Unsupported admission requirement fields.');
  const validDocuments = (items) => Array.isArray(items) && items.length <= 30 && new Set(items).size===items.length && items.every((item) => typeof item === "string" && /^[a-z][a-z0-9_]{0,59}$/.test(item));
  if (requirements.documents !== undefined && !validDocuments(requirements.documents)) throw requestError(400, "documents must contain document type codes.");
  if (requirements.documentsByCategory !== undefined) {
    const groups = requirements.documentsByCategory;
    if (!groups || typeof groups !== "object" || Array.isArray(groups) || Object.keys(groups).length>20 || Object.entries(groups).some(([category, documents]) => ['standard','__proto__','constructor','prototype'].includes(category) || !/^[a-z][a-z0-9_]{0,39}$/.test(category) || !validDocuments(documents))) throw requestError(400, "documentsByCategory must map up to 20 distinct applicant category codes to document lists; standard uses the base list.");
  }
}
