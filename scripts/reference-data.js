// Canonical baseline reference values. Loaded idempotently by `npm run reference:load` and the dev seed.
// Codes are stable identifiers stored on records; labels can change, codes cannot.

export const referenceValues = {
  country: [
    ["ZW", "Zimbabwe"],
    ["ZA", "South Africa"],
    ["BW", "Botswana"],
    ["ZM", "Zambia"],
    ["MZ", "Mozambique"],
    ["MW", "Malawi"],
    ["NA", "Namibia"],
    ["GB", "United Kingdom"],
    ["US", "United States"]
  ],
  academic_level: [
    ["CERTIFICATE", "Certificate"],
    ["DIPLOMA", "Diploma"],
    ["UNDERGRADUATE", "Undergraduate degree"],
    ["POSTGRADUATE_DIPLOMA", "Postgraduate diploma"],
    ["MASTERS", "Master's degree"],
    ["DOCTORATE", "Doctorate"]
  ],
  study_mode: [
    ["FULL_TIME", "Full time"],
    ["PART_TIME", "Part time"],
    ["BLOCK_RELEASE", "Block release"],
    ["DISTANCE", "Distance learning"]
  ],
  currency: [
    ["USD", "US dollar", { minorUnits: 2 }],
    ["ZWG", "Zimbabwe Gold", { minorUnits: 2 }],
    ["ZAR", "South African rand", { minorUnits: 2 }]
  ],
  staff_category: [
    ["LECTURER", "Lecturer"],
    ["ACADEMIC_SUPPORT", "Academic support"],
    ["ADMINISTRATIVE", "Administrative"],
    ["TECHNICAL", "Technical"],
    ["MANAGEMENT", "Management"]
  ],
  charge_type: [
    ["TUITION", "Tuition"],
    ["REGISTRATION", "Registration fee"],
    ["EXAMINATION", "Examination fee"],
    ["LIBRARY", "Library and learning resources"]
  ],
  decision_reason: [
    ["ENTRY_REQUIREMENTS_NOT_MET", "Entry requirements not met"],
    ["INCOMPLETE_APPLICATION", "Application incomplete after information request"],
    ["DOCUMENTS_NOT_VERIFIED", "Supporting documents could not be verified"],
    ["CAPACITY_REACHED", "Programme capacity reached"],
    ["OTHER", "Other (see decision note)"]
  ],
  disability: [
    ["VISUAL", "Visual impairment"],
    ["HEARING", "Hearing impairment"],
    ["MOBILITY", "Mobility impairment"],
    ["LEARNING", "Specific learning difference"],
    ["MENTAL_HEALTH", "Mental health condition"],
    ["OTHER", "Other"],
    ["PREFER_NOT_TO_SAY", "Prefer not to say"]
  ]
};

export async function loadReferenceData(db) {
  let inserted = 0;
  for (const [listCode, values] of Object.entries(referenceValues)) {
    for (const [index, [valueCode, label, metadata = {}]] of values.entries()) {
      const result = await db.query(
        `insert into reference_values (id, list_code, value_code, label, status, sort_order, metadata, effective_from)
         values ($1, $2, $3, $4, 'active', $5, $6, '2026-01-01')
         on conflict (list_code, value_code) do nothing`,
        [`ref_${listCode}_${valueCode.toLowerCase()}`, listCode, valueCode, label, (index + 1) * 10, metadata]
      );
      inserted += result.rowCount;
    }
  }
  return inserted;
}
