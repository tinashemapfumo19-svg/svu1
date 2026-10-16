// Canonical notification templates that platform services depend on. Loaded idempotently by
// `npm run reference:load` and the dev seed. Change wording by adding a new version.

export const notificationTemplates = [
  {id:'nt_student_sharing_invitation_v1',code:'student.sharing_invitation',channel:'email',subject:'Student record sharing invitation',
    body:'A student has invited you to view selected university records. Invitation: {{invitationLink}}. Email verification expires {{challengeExpiresAt}}. Access expires {{expiresAt}}. This invitation does not grant permission until you accept.',version:1,status:'active'},
  {id:'nt_course_resource_email_v1',code:'course.resource',channel:'email',subject:'New course resource: {{courseCode}}',
    body:'A new {{kind}} is available for {{courseCode}}: {{title}}. Sign in to your course workspace to view it.',version:1,status:'active'},
  {id:'nt_course_feedback_email_v1',code:'course.feedback',channel:'email',subject:'Coursework feedback is available: {{courseCode}}',
    body:'Your coursework feedback for {{courseCode}} is available. Sign in to view your private marks, feedback and returned files.',version:1,status:'active'},
  // Automated reminders and digests (migration 105, docs/AUTOMATIONS.md).
  {id:'nt_course_deadline_reminder_v1',code:'course.deadline_reminder',channel:'email',subject:'Assignment due {{when}}: {{courseCode}}',
    body:'Your assignment "{{title}}" for {{courseCode}} is due {{dueAt}} (UTC). You have not submitted it yet. Submit it from the course page in Study.',version:1,status:'active'},
  {id:'nt_course_submission_receipt_v1',code:'course.submission_receipt',channel:'email',subject:'Submission received: {{courseCode}}',
    body:'We received your submission for "{{title}}" ({{courseCode}}), attempt {{attempt}}, at {{submittedAt}} (UTC). File: {{fileName}}. Receipt: {{receipt}}. Keep this message as proof of submission.',version:1,status:'active'},
  {id:'nt_course_missing_work_v1',code:'course.missing_work',channel:'email',subject:'Missing submissions: {{courseCode}}',
    body:'{{missingCount}} of {{enrolledCount}} students have not submitted "{{title}}" for {{courseCode}}, which was due {{dueAt}} (UTC). Open the course to see who, and send them a reminder.',version:1,status:'active'},
  {id:'nt_course_missing_reminder_v1',code:'course.missing_reminder',channel:'email',subject:'Reminder from your lecturer: {{courseCode}}',
    body:'Your lecturer has reminded you that "{{title}}" for {{courseCode}} has not been submitted. {{lateNote}}',version:1,status:'active'},
  {id:'nt_course_evaluation_open_v1',code:'course.evaluation_open',channel:'email',subject:'Tell us about {{courseCode}}',
    body:'The anonymous course evaluation for {{courseCode}} is open until {{closesOn}}. It takes about two minutes, and your lecturer only sees results once enough students have answered.',version:1,status:'active'},
  {id:'nt_appointment_confirmed_v1',code:'appointment.confirmed',channel:'email',subject:'Appointment confirmed: {{when}}',
    body:'Your {{kind}} appointment with {{with}} is booked for {{when}} (UTC) at {{location}}. You can cancel it in Student Office if your plans change.',version:1,status:'active'},
  {id:'nt_appointment_booked_v1',code:'appointment.booked',channel:'email',subject:'New booking: {{when}}',
    body:'{{student}} booked your {{kind}} slot at {{when}} (UTC). Reason: {{reason}}',version:1,status:'active'},
  {id:'nt_appointment_cancelled_v1',code:'appointment.cancelled',channel:'email',subject:'Appointment cancelled: {{when}}',
    body:'The {{kind}} appointment at {{when}} (UTC) was cancelled by {{by}}. Reason: {{reason}}',version:1,status:'active'},
  {id:'nt_admissions_offer_expiry_v1',code:'admissions.offer_expiry_reminder',channel:'email',subject:'Your offer expires {{when}}',
    body:'Your offer for {{programmeName}} ({{intakeLabel}}) expires on {{expiresOn}} (UTC). Accept or decline it in the applicant portal before then.',version:1,status:'active'},
  {id:'nt_registration_ready_v1',code:'registration.ready',channel:'email',subject:'You can now confirm your registration',
    body:'Your course selection for {{periodName}} now meets the registration checks. Confirm your registration in Student Office.',version:1,status:'active'},
  {id:'nt_finance_due_reminder_v1',code:'finance.due_reminder',channel:'email',subject:'Payment due {{dueOn}}',
    body:'Student {{studentNumber}}: {{amount}} is due on {{dueOn}}. Your statement is in Student Office under Fees & Payments.',version:1,status:'active'},
  {id:'nt_finance_hold_notice_v1',code:'finance.hold_notice',channel:'email',subject:'A financial hold is on your account',
    body:'Student {{studentNumber}}: a financial hold is on your account because {{amount}} is overdue. Registration actions may be blocked until it is paid or a payment plan is approved. See Fees & Payments in Student Office.',version:1,status:'active'},
  {id:'nt_support_waiting_reminder_v1',code:'support.waiting_reminder',channel:'email',subject:'Your support case is waiting for your reply',
    body:'Student support is waiting for your reply on a {{category}} case opened on {{openedOn}}. Open Requests in Student Office to reply.',version:1,status:'active'},
  {id:'nt_support_unanswered_v1',code:'support.unanswered',channel:'email',subject:'Support case without an update for {{days}} days',
    body:'A {{priority}}-priority {{category}} support case assigned to you has had no update for {{days}} days. Open Support in the staff workspace.',version:1,status:'active'},
  {id:'nt_staff_weekly_digest_v1',code:'staff.weekly_digest',channel:'email',subject:'Your week: {{headline}}',
    body:'{{lines}} Open your staff home to start.',version:1,status:'active'},
  {id:'nt_results_published_email_v1',code:'results.published',channel:'email',subject:'Your results are available',
    body:'New results are available in your student portal. Sign in to view your official results.',version:1,status:'active'},
  {id:'nt_exam_seating_email_v1',code:'exams.seating',channel:'email',subject:'Examination seating for {{courseCode}} has been {{action}}',
    body:'Examination seating for {{courseCode}} has been {{action}} after independent review. Sign in to view your current published examination record. Seat labels and candidate lists are not included in this message.',version:1,status:'active'},
  {id:'nt_exam_arrangement_email_v1',code:'exams.arrangement',channel:'email',subject:'Your examination arrangement request has been {{action}}',
    body:'Your examination arrangement request has been {{action}}. Sign in to view your private case record and the current published examination timetable.',version:1,status:'active'},
  {id:'nt_exam_paper_release_email_v1',code:'exams.paper_release',channel:'email',subject:'Your examination paper release has been {{action}}',
    body:'A confidential paper release has been {{action}}. Access window: {{availableAt}} to {{expiresAt}}. Sign in to your staff workspace for the current custody record.',version:1,status:'active'},
  {
    id: 'nt_exams_duties_email_v1',code: 'exams.duties',channel: 'email',
    subject: 'Your {{periodName}} invigilation duties are {{action}}',
    body: 'Your invigilation roster for {{periodName}} is {{action}} with {{count}} sitting(s). Your staff workspace shows the current published duties, dates, venues and calendar download.',
    version: 1,status: 'active'
  },
  {
    id: "nt_registry_award_email_v1", code: "registry.award", channel: "email",
    subject: "Your award has been conferred: {{awardTitle}}",
    body: "Student {{studentNumber}}: the {{awardTitle}} ({{classification}}) has been conferred with effect from {{conferredOn}}. Your programme is now recorded as completed in the student portal.",
    version: 1, status: "active"
  },
  {
    id: "nt_exams_timetable_email_v1", code: "exams.timetable", channel: "email",
    subject: "Your {{periodName}} examination timetable is {{action}}",
    body: "Student {{studentNumber}}: your examination timetable for {{periodName}} is {{action}} with {{count}} sitting(s). Check the student portal for dates, times and venues; the portal always shows the current timetable.",
    version: 1, status: "active"
  },
  {
    id: "nt_results_amended_email_v1", code: "results.amended", channel: "email",
    subject: "Your {{courseCode}} result has been amended",
    body: "Student {{studentNumber}}: your {{courseCode}} mark was amended from {{fromMark}} to {{toMark}} (grade {{grade}}) after independent review: {{reason}}. Your results in the student portal now show the amended mark.",
    version: 1, status: "active"
  },
  {
    id: "nt_finance_sponsorship_email_v1", code: "finance.sponsorship", channel: "email",
    subject: "A sponsor is now covering your fees",
    body: "Student {{studentNumber}}: {{sponsor}} now covers {{percent}}% of your eligible fees. {{covered}} of your current charges has been moved to the sponsor. Any remaining balance is still yours to pay; see your statement in the student portal.",
    version: 1, status: "active"
  },
  {
    id: "nt_finance_plan_email_v1", code: "finance.plan", channel: "email",
    subject: "Your payment plan has been approved",
    body: "Student {{studentNumber}}: your payment plan of {{count}} instalments for {{total}} is approved. The first instalment of {{firstAmount}} is due on {{firstDue}}. While instalments are paid on time, the covered fees will not place a hold on your registration.",
    version: 1, status: "active"
  },
  {
    id: "nt_staff_appointment_email_v1", code: "staff.appointment", channel: "email",
    subject: "Staff appointment waiting for you: {{employeeNumber}}",
    body: "Hello {{preferredName}}, South Valley University has recorded a staff appointment ({{employeeNumber}}) for your existing account. Sign in as usual and accept or decline it under Staff appointment. Nothing changes on your account until you accept.",
    version: 1, status: "active"
  },
  {
    id: "nt_staff_invitation_email_v1", code: "staff.invitation", channel: "email",
    subject: "Activate your South Valley University staff account",
    body: "Hello {{preferredName}}, your staff record {{employeeNumber}} has been created. Use this code to set your password and activate your account: {{activationToken}}. It expires in 7 days.",
    version: 1, status: "active"
  },
  {
    id: "nt_finance_payment_receipt_email_v1", code: "finance.payment_receipt", channel: "email",
    subject: "Payment received - receipt {{receiptNumber}}",
    body: "We received {{amount}} by {{method}} (reference {{externalRef}}) on {{receivedOn}} for student {{studentNumber}}. Receipt {{receiptNumber}}. Your {{currency}} balance is now {{balance}}.",
    version: 1, status: "active"
  },
  {
    id: "nt_finance_charges_billed_email_v1", code: "finance.charges_billed", channel: "email",
    subject: "New charges for {{periodName}}",
    body: "{{amount}} has been billed to student {{studentNumber}} for {{periodName}}, due {{dueOn}}. Your statement is in the student portal.",
    version: 1, status: "active"
  },
  {
    id: "nt_finance_adjustment_decided_email_v1", code: "finance.adjustment_decided", channel: "email",
    subject: "Your student account {{kind}} was {{outcome}}",
    body: "The {{kind}}{{amountText}} on student {{studentNumber}}'s account was {{outcome}}: {{reason}}",
    version: 1, status: "active"
  },
  {
    id: "nt_admissions_portal_message_email_v1", code: "admissions.portal_message", channel: "email",
    subject: "An update from SVU Admissions", body: "{{message}}", version: 1, status: "active"
  },
  {
    id: "nt_identity_password_recovery_email_v1",
    code: "identity.password_recovery",
    channel: "email",
    subject: "Reset your South Valley University password",
    body: "Use this code to reset your password within {{expiresInMinutes}} minutes: {{recoveryToken}}. If you did not ask for this, you can ignore this message.",
    version: 1,
    status: "active"
  },
  {
    id: "nt_admissions_registration_activation_email_v1",
    code: "admissions.registration_activation",
    channel: "email",
    subject: "Finish creating your South Valley University applicant account",
    body: "Hello {{preferredName}}, use this code to set your password and start your application: {{activationToken}}. It expires in 7 days.",
    version: 1,
    status: "active"
  },
  {
    id: "nt_admissions_registration_existing_email_v1",
    code: "admissions.registration_existing",
    channel: "email",
    subject: "You already have a South Valley University account",
    body: "Someone asked to register this email address, but an account already exists. Sign in, or reset your password if you have forgotten it.",
    version: 1,
    status: "active"
  },
  {
    id: "nt_admissions_application_received_email_v1",
    code: "admissions.application_received",
    channel: "email",
    subject: "We received your application {{referenceNumber}}",
    body: "Thank you. Your application for {{programme}} was submitted as {{referenceNumber}}. You can follow its progress in the applicant portal.",
    version: 1,
    status: "active"
  },
  {
    id: "nt_admissions_information_requested_email_v1",
    code: "admissions.information_requested",
    channel: "email",
    subject: "More information needed for application {{referenceNumber}}",
    body: "Admissions needs more information to continue reviewing {{referenceNumber}}: {{message}} Sign in to the applicant portal to upload documents and respond.",
    version: 1,
    status: "active"
  },
  {
    id: "nt_admissions_offer_issued_email_v1",
    code: "admissions.offer_issued",
    channel: "email",
    subject: "Your offer from South Valley University ({{referenceNumber}})",
    body: "Congratulations. We are pleased to offer you a place on {{programme}}. {{conditions}} Please accept or decline in the applicant portal by {{expiresOn}}.",
    version: 1,
    status: "active"
  },
  {
    id: "nt_admissions_application_unsuccessful_email_v1",
    code: "admissions.application_unsuccessful",
    channel: "email",
    subject: "Update on your application {{referenceNumber}}",
    body: "Thank you for applying to {{programme}}. After careful review we are unable to offer you a place. Reason: {{reason}}.",
    version: 1,
    status: "active"
  },
  {
    id: "nt_admissions_welcome_student_email_v1",
    code: "admissions.welcome_student",
    channel: "email",
    subject: "Welcome to South Valley University: your student number is {{studentNumber}}",
    body: "Welcome to {{programme}}. Your student number is {{studentNumber}}. Keep signing in with your existing account; registration and onboarding steps will appear in the portal.",
    version: 1,
    status: "active"
  },
  {
    id: "nt_identity_password_changed_email_v1",
    code: "identity.password_changed",
    channel: "email",
    subject: "Your South Valley University password was changed",
    body: "Your password was changed and all other sessions were signed out. If this was not you, contact the IT service desk immediately.",
    version: 1,
    status: "active"
  }
];

export async function loadNotificationTemplates(db) {
  let inserted = 0;
  for (const template of notificationTemplates) {
    const result = await db.query(
      `insert into notification_templates (id, code, channel, subject, body, version, status)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do nothing`,
      [template.id, template.code, template.channel, template.subject, template.body, template.version, template.status]
    );
    inserted += result.rowCount;
  }
  return inserted;
}
