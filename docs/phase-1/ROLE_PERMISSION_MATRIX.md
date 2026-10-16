# Phase 1 Role and Permission Matrix

## Permission Verbs

- `view`: read allowed records.
- `create`: create new records.
- `update`: edit records in an allowed state.
- `submit`: submit a case or workflow step.
- `review`: inspect and comment on submitted work.
- `approve`: make an authoritative decision.
- `publish`: expose a record or outcome to users.
- `export`: download controlled data.
- `administer`: configure system or master data.

## Baseline Roles

| Role | Purpose | Initial Scope | High-Risk Restrictions |
| --- | --- | --- | --- |
| Applicant | Apply for admission and manage own documents/messages | Own applicant profile and applications | Cannot view internal comments, staff queues, or other applicants. |
| Student | Use student portal after conversion | Own student profile, registrations, learning, finance view, documents | Cannot alter official academic, financial, or result records. |
| Lecturer | Teach assigned offerings | Assigned course offerings and enrolled class lists | Cannot assign self to courses, publish official results alone, or view unrelated records. |
| Admissions Officer | Process applications | Assigned or unassigned admissions queues within authorized intake/programme scope | Cannot issue final offers unless granted approval permission. |
| Admissions Manager | Approve decisions and manage admissions workload | Admissions scope by faculty/programme/intake | Cannot change identity or finance configuration without separate role. |
| Registry Officer | Manage student records and registration workflows | Students and programmes in assigned organizational scope | Cannot silently override progression or registration; must use exception workflows. |
| Finance Officer | Manage charges, payments, and financial clearance | Finance records by configured scope | Cannot alter academic standing or admissions decisions. |
| Academic Manager | Manage academic structure and teaching oversight | Faculty/department/programme scope | Cannot alter ledger transactions or identity secrets. |
| Examinations Officer | Configure and process assessments/results | Exam cycles and authorized programmes | Cannot bypass approval or amendment workflows. |
| Document Officer | Manage official document templates and issuance | Authorized document types | Cannot change source academic or financial facts. |
| Support Officer | Manage support cases and communications | Assigned cases and permitted profile summary | Cannot view protected medical/financial detail unless explicitly granted. |
| System Administrator | Configure technical platform and role assignments | Platform-wide technical controls | Cannot approve own privileged access changes; role changes require audit and approval. |
| Auditor | Inspect history and control evidence | Read-only audit/reporting scope | Cannot mutate business records. |

## Phase 1 Permission Matrix

| Capability | Applicant | Student | Lecturer | Admissions Officer | Admissions Manager | Registry Officer | Finance Officer | Academic Manager | System Admin | Auditor |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Own profile | view/update | view/update | view/update | view | view | view/update | view | view | administer | view |
| User account lifecycle | none | none | none | none | none | none | none | none | administer | view |
| Role assignment | none | none | none | none | none | none | none | approve scoped | administer | view |
| Audit events | own visible events | own visible events | assigned records | assigned records | admissions scope | registry scope | finance scope | academic scope | administer | view/export |
| Programme/intake catalogue | view | view | view | view | review | view | view | administer | administer technical | view |
| Workflow tasks | own tasks | own tasks | assigned tasks | review/update | approve/assign | review/update | review/update | approve/assign | administer technical | view |
| Documents | own upload/view | own upload/view | course documents | review | approve/reject | review | finance documents | academic documents | administer technical | view metadata |
| Notifications | own messages | own messages | course messages | send templated | approve bulk | send templated | send finance templates | send academic templates | administer templates | view delivery audit |
| Exports | none | own documents | assigned class lists | limited | admissions scope | registry scope | finance scope | academic scope | technical logs | audit exports |

## Approval Rules

- Privileged role assignment requires a second authorized actor.
- Bulk communication requires audience preview and approval.
- Master data publication requires academic manager or configured business owner approval.
- Sensitive export requires reason, watermark/log entry, and role-based scope.
- Any exception replacing a legacy direct override requires reason, evidence, expiry, and audit event.
