// The pages Ask SVU may point people to (docs/ASK_SVU.md). Each entry says what the page is for and who can open it;
// the server sends the assistant only the pages the asker can open, and drops any link it returns that is not on
// that list. Keep descriptions factual: the assistant answers "how do I..." questions from them.
//   access: 'public' (anyone), 'signedIn' (any session), 'signedOut' (visitors only), or a list of permission codes
//   (any one is enough; 'area.*' matches every code starting with 'area.').
const staffAdmissions = ['admissions.review', 'admissions.decide', 'admissions.completeness', 'admissions.configure', 'admissions.communicate', 'admissions.migrate', 'enquiries.manage', 'enquiries.escalate', 'guidance.manage', 'guidance.publish'];
const system = ['foundation.view', 'identity.manage', 'identity.invite', 'audit.view', 'workflow.transition', 'task.assign', 'master_data.publish', 'notification.send'];

export const helpPages = [
  // Everyone
  { id: 'signin', route: '#signin', title: 'Sign in', access: 'signedOut', text: 'Sign in with your university email and password. Forgot password starts a reset by email. Staff accounts may need two-step verification.' },
  { id: 'apply', route: '#apply', title: 'Apply', access: 'public', text: 'Browse programmes and intakes, read admissions guidance, ask a question, send an enquiry, or create an applicant account and start an application.' },
  { id: 'verify', route: '#verify', title: 'Verify a document', access: 'public', text: 'Check that a South Valley University transcript or certificate is genuine using the verification code printed on it.' },
  { id: 'resources', route: '#resources', title: 'Resources', access: 'public', text: 'Search the university repository and library catalogue; staff with permission also manage templates and documents here.' },
  { id: 'home', route: '#home', title: 'Home', access: 'signedIn', text: 'Your starting page: items needing your attention, this week, your work areas, recent updates and quick actions. Staff who hold office hours publish appointment times here and see who booked.' },
  { id: 'inbox', route: '#messages', title: 'Inbox', access: 'signedIn', text: 'Notifications and messages from the university, private conversations and chat rooms. Mark items read, filter unread.' },
  { id: 'settings', route: '#settings', title: 'Account and security', access: 'signedIn', text: 'Change your password, turn on two-step verification, see signed-in devices and sign out of other sessions, update your profile, mute optional notifications, install the app, turn on phone notifications, and add a mobile number for urgent text messages.' },
  // Applicants
  { id: 'my-application', route: '#apply', title: 'My application', access: ['admissions.apply'], text: 'Continue a draft application, upload required documents, pay the application fee, submit, track status, and accept or decline an offer before it expires.' },
  // Students: Study
  { id: 'study-today', route: '#study/today', title: 'Study: Today', access: ['registry.self'], text: 'Your academic day: things needing attention (registration, holds, support replies), this week\'s deadlines, next examination and your courses.' },
  { id: 'study-courses', route: '#study/courses', title: 'Study: Courses', access: ['registry.self'], text: 'Courses you are enrolled in. Open a course for learning materials, online classes, assignments (submit work, check AI similarity, download your receipt), class attendance check-in with the code shown in class and your attendance rate, the anonymous course evaluation when open, announcements and discussions.' },
  { id: 'study-calendar', route: '#study/timetable', title: 'Study: Calendar', access: ['registry.self'], text: 'Month, week and list calendar of assignment deadlines, classes, examinations, fee due dates and appointments; add them to your phone calendar once, or subscribe so your phone stays up to date; your published examination timetable and special-arrangement requests.' },
  { id: 'study-results', route: '#study/results', title: 'Study: Results & Progress', access: ['registry.self'], text: 'Published marks, GPA, academic decisions and completion progress, with a plain-language explanation.' },
  { id: 'study-resources', route: '#study/resources', title: 'Study: Resources', access: ['registry.self'], text: 'Search the university repository and library catalogue.' },
  // Students: Student Office
  { id: 'office-overview', route: '#office/overview', title: 'Student Office: Overview', access: ['registry.self'], text: 'Registration, account, requests and documents at a glance.' },
  { id: 'office-registration', route: '#office/registration', title: 'Student Office: Registration', access: ['registry.self'], text: 'Choose and confirm your courses for an open registration period; see what blocks registration (holds, prerequisites, missing requirements).' },
  { id: 'office-fees', route: '#office/fees', title: 'Student Office: Fees & Payments', access: ['registry.self'], text: 'Account statement, balance and amounts due, financial holds, payment plans, a timeline of fee due dates, and Pay online (card or mobile money) when online payment is switched on. Other payments appear once Finance records them.' },
  { id: 'office-details', route: '#office/details', title: 'Student Office: My Details', access: ['registry.self'], text: 'Contact details, next of kin, identity and programme record; request corrections.' },
  { id: 'office-documents', route: '#office/documents', title: 'Student Office: Documents', access: ['registry.self'], text: 'Issue your own confirmation of enrolment or proof of registration letter (with a verification code and QR code), and see official transcripts and certificates issued by the registry.' },
  { id: 'office-card', route: '#office/card', title: 'Student Office: ID Card', access: ['registry.self'], text: 'Your digital student ID card with a QR code that proves you are a current student; show it when asked for student ID.' },
  { id: 'office-appointments', route: '#office/appointments', title: 'Student Office: Appointments', access: ['registry.self'], text: 'Book time with a lecturer (office hours), an academic adviser, or the finance, student support or registry desks; see and cancel your bookings.' },
  { id: 'office-requests', route: '#office/requests', title: 'Student Office: Requests', access: ['registry.self'], text: 'Open and track support cases and requests to the university; reply when a case is waiting for you.' },
  { id: 'office-sharing', route: '#office/sharing', title: 'Student Office: Record Sharing', access: ['registry.self'], text: 'Share your academic record with an employer or another institution for a limited time, and withdraw sharing.' },
  { id: 'shared', route: '#shared', title: 'Shared records', access: ['sharing.read'], text: 'Records that students have shared with you.' },
  // Lecturers
  { id: 'my-teaching', route: '#learning', title: 'My teaching', access: ['teaching.self'], text: 'Your allocated courses and class lists. Publish materials, classes, assignments and announcements; take attendance with a rotating QR code; see who has submitted; remind students; mark and release feedback (with an optional AI feedback draft); see course evaluation results; add deadlines to your calendar.' },
  // Staff
  { id: 'admissions', route: '#admissions', title: 'Admissions', access: staffAdmissions, text: 'Application queues, completeness checks, evidence, requests for information, decisions and offers, enquiries, guidance publishing and intake manifests.' },
  { id: 'staff-students', route: '#registry/students', title: 'Workspace: Students', access: ['registry.view'], text: 'Search student records; onboarding, identity, registration, results, lifecycle changes and the early-warning list of students who may need support (with follow-up notes and a CSV download).' },
  { id: 'staff-support', route: '#registry/support', title: 'Workspace: Support', access: ['support.view', 'support.manage', 'support.escalate'], text: 'Student support cases: assignment, replies (with suggested triage), escalation, resolution and service reports.' },
  { id: 'staff-finance', route: '#registry/finance', title: 'Workspace: Finance', access: ['finance.*'], text: 'Payment imports and matching, sponsors, adjustments, control totals and finance reports.' },
  { id: 'staff-teaching', route: '#registry/teaching', title: 'Workspace: Teaching', access: ['teaching.*', 'assessment.*', 'lms.*'], text: 'Teaching allocation, assessment plans and marks, LMS transfer, and opening anonymous course evaluations for a semester.' },
  { id: 'staff-exams', route: '#registry/exams', title: 'Workspace: Examinations', access: ['exams.*'], text: 'Examination timetables, papers, rooms, seating, special arrangements and examination reports.' },
  { id: 'staff-documents', route: '#registry/documents', title: 'Workspace: Documents', access: ['registry.transcript.issue', 'documents.templates.manage', 'documents.templates.approve'], text: 'Issue official transcripts and certificates; manage document templates.' },
  { id: 'staff-reports', route: '#registry/reports', title: 'Workspace: Reports', access: ['reports.schedule', 'registry.view', 'results.view', 'academic.view', 'audit.view'], text: 'Enrolment, outcomes and continuation reports, report editions and scheduled reports.' },
  { id: 'staff-academic', route: '#registry/academic', title: 'Workspace: Academic setup', access: ['master_data.publish'], text: 'Faculties, programmes, curricula, academic periods, intakes, grading and GPA rules.' },
  { id: 'staff-admin', route: '#registry/admin', title: 'Workspace: People & systems', access: ['staff.view', 'staff.manage', 'integrations.view', 'integrations.manage'], text: 'Staff records, appointments and integration governance.' },
  { id: 'staff-leave', route: '#registry/leave', title: 'Workspace: Staff leave', access: ['leave.self', 'leave.manage'], text: 'Request leave, recommend and approve requests, and see leave balances.' },
  { id: 'staff-assets', route: '#registry/assets', title: 'Workspace: Assets', access: ['assets.view', 'assets.manage', 'assets.approve'], text: 'Asset register, allocations, stock checks and disposals.' },
  { id: 'staff-fleet', route: '#registry/fleet', title: 'Workspace: Fleet', access: ['fleet.view'], text: 'Vehicles, drivers, trips, fuel, servicing and incidents.' },
  { id: 'staff-cashbook', route: '#registry/cashbook', title: 'Workspace: Cashbook', access: ['cashbook.view'], text: 'Cashbook movements, reconciliation and period closure.' },
  { id: 'system', route: '#foundation', title: 'System administration', access: system, text: 'Accounts, role grants, invitations, sessions, two-step verification resets, audit log, service health and automations (reminders and digests, with Run now).' }
];

// Approved external sites the assistant may link to, as { id, url, title, text }. Empty until the university
// approves a list (D-41); they are offered to everyone and opened in a new tab.
export const helpExternalLinks = [];

export function canOpenPage(page, permissions = null) {
  if (page.access === 'public') return true;
  if (page.access === 'signedOut') return permissions === null;
  if (permissions === null) return false;
  if (page.access === 'signedIn') return true;
  return page.access.some(code => code.endsWith('.*') ? permissions.some(held => held.startsWith(code.slice(0, -1))) : permissions.includes(code));
}

export function pagesFor(permissions = null) {
  const external = helpExternalLinks.map(link => ({ id: link.id, route: link.url, title: link.title, text: link.text, access: 'public', external: true }));
  const pages = [...helpPages, ...external].filter(page => canOpenPage(page, permissions));
  // Applicants get "My application" for #apply instead of the public entry.
  return pages.some(page => page.id === 'my-application') ? pages.filter(page => page.id !== 'apply') : pages;
}

// Rough keyword overlap, used to order pages and by the offline simulated assistant.
const common = new Set('the and for you your how can where what when see get find from with this that are our out who use any all into one not has have'.split(' '));
const words = value => (String(value).toLowerCase().match(/[a-z]{3,}/g) || []).filter(word => !common.has(word)).map(word => word.slice(0, 6)); // crude stem: register ~ registration
const overlap = (question, page) => { const asked = new Set(words(question)); return words(`${page.title} ${page.text}`).filter(word => asked.has(word)).length; };
export function rankPages(question, pages) {
  return pages.map(page => ({ page, score: overlap(question, page) })).sort((a, b) => b.score - a.score).map(row => row.page);
}
export function bestPage(question, pages) {
  const [top] = rankPages(question, pages);
  return top && overlap(question, top) > 0 ? top : null;
}
