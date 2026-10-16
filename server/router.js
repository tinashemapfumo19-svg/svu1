import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { maxUploadBytes } from "./modules/documents.js";
import { requestError } from "./support.js";
import { examinationReportPermissions } from './modules/examination-reporting.js';
import { academicReportPermissions } from './modules/academic-reporting.js';
import { assessmentReportPermissions } from './modules/assessment-reporting.js';
import { courseUploadLimit } from './modules/course-workspace.js';

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

export function createRouter({ rootDir, config, repository, logger }) {
  const publicRoot = resolve(rootDir);

  async function route(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    logger.info("request", { method: req.method, path: requestUrl.pathname });

    try {
      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApi(req, res, requestUrl, repository, config);
        return;
      }

      await serveStatic(req, res, requestUrl, publicRoot);
    } catch (error) {
      logger.error("request_failed", {
        method: req.method,
        path: requestUrl.pathname,
        error: error.message
      });
      sendJson(res, error.statusCode || 500, {
        error: {
          code: error.statusCode ? "REQUEST_FAILED" : "SERVER_ERROR",
          message: error.statusCode ? error.message : "The request could not be completed."
        }
      });
    }
  }

  return route;
}

function sendExamPaper(res,{paper,bytes}) {
  res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':bytes.length,'Content-Disposition':`attachment; filename="${paper.fileName.replace(/[^\w.-]/g,'_')}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(bytes);
}

async function handleApi(req, res, url, repository, config) {
  if(url.pathname==='/api/email-delivery/webhooks/resend' && req.method==='POST') {
    if(config.email.provider!=='resend')throw requestError(503,'Email webhook is not configured.');
    const chunks=[];let length=0;
    for await(const chunk of req){length+=chunk.length;if(length>65536)throw requestError(413,'Email event exceeds the size limit.');chunks.push(chunk);}
    const data=await repository.receiveEmailWebhook(Buffer.concat(chunks).toString('utf8'),req.headers);
    sendJson(res,200,{data});return;
  }
  if(url.pathname==='/api/email-delivery' && req.method==='GET') {
    const actor=await requirePermission(req,repository,'integrations.view');
    res.setHeader('Cache-Control','no-store');sendJson(res,200,{data:await repository.listEmailDeliveries(Object.fromEntries(url.searchParams),actor)});return;
  }
  if(url.pathname==='/api/email-delivery/process' && req.method==='POST') {
    const actor=await requirePermission(req,repository,'integrations.manage');sendJson(res,200,{data:await repository.processEmailDeliveries(await readJson(req,1000),actor)});return;
  }
  const emailAction=url.pathname.match(/^\/api\/email-delivery\/([^/]+)\/(retry|cancel)$/);
  if(emailAction && req.method==='POST') {
    const actor=await requirePermission(req,repository,'integrations.manage');sendJson(res,200,{data:await repository.changeEmailDelivery(emailAction[1],emailAction[2],await readJson(req,3000),actor)});return;
  }
  const discussion=url.pathname.match(/^\/api\/course-workspaces\/([^/]+)\/([^/]+)\/discussions(?:\/([^/]+)(?:\/(reply|lock|posts\/([^/]+)\/(moderate|report)))?)?$/);
  if (discussion) {
    const [,period,course,id,operation,postId,postAction]=discussion;
    const actor=await requireAnyPermission(req,repository,['registry.self','teaching.self']);
    let data;
    if (req.method==='GET' && !operation) {
      if ([...url.searchParams.keys()].length>1) throw requestError(400,'Use one discussion page filter.');
      data=await repository.listCourseDiscussions(decodeURIComponent(period),decodeURIComponent(course),id,Object.fromEntries(url.searchParams),actor);
    } else if (req.method==='POST' && (!id || operation)) data=await repository.writeCourseDiscussion(decodeURIComponent(period),decodeURIComponent(course),id,postId,postAction || operation || 'create',await readJson(req,16000),actor);
    if (!data) throw requestError(404,'Discussion route was not found.');
    sendJson(res,200,{data});return;
  }
  // Assistive AI features (docs/AI_ASSIST.md). Each handler re-checks access through the underlying read.
  if (url.pathname === '/api/ai/status' && req.method === 'GET') { sendJson(res,200,{data:repository.aiAssistStatus()});return; }
  if (url.pathname === '/api/guidance/ask' && req.method === 'POST') {
    sendJson(res,200,{data:await repository.askAdmissionsGuidance(await readJson(req,4000),req.socket.remoteAddress || 'unknown')});return;
  }
  if (url.pathname === '/api/help/ask' && req.method === 'POST') {
    // Open to visitors; a signed-in caller gets pages for their own permissions.
    const actor = getBearerToken(req) ? await requireAuthenticated(req,repository) : null;
    sendJson(res,200,{data:await repository.askSvu(await readJson(req,8000),{actor,clientKey:req.socket.remoteAddress || 'unknown'})});return;
  }
  if (url.pathname === '/api/help/feedback' && req.method === 'POST') {
    const actor = await requireAuthenticated(req,repository);
    sendJson(res,200,{data:await repository.recordHelpFeedback(await readJson(req,1000),actor)});return;
  }
  if (url.pathname === '/api/registry/early-warning' && req.method === 'GET') {
    const actor = await requirePermission(req,repository,'registry.view');
    if (url.searchParams.get('format') === 'csv') {
      const csv = await repository.listStudentsNeedingSupport(actor,{format:'csv'});
      res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="early-warning-${new Date().toISOString().slice(0,10)}.csv"`,'Cache-Control':'no-store'});
      res.end(`﻿${csv}`);return;
    }
    sendJson(res,200,{data:await repository.listStudentsNeedingSupport(actor)});return;
  }
  const followUp = url.pathname.match(/^\/api\/registry\/early-warning\/([^/]{1,80})\/follow-ups$/);
  if (followUp && req.method === 'POST') {
    const actor = await requirePermission(req,repository,'registry.view');
    sendJson(res,201,{data:await repository.recordEarlyWarningFollowUp(decodeURIComponent(followUp[1]),await readJson(req,4000),actor)});return;
  }
  const aiSupport = url.pathname.match(/^\/api\/support\/cases\/([^/]+)\/assist$/);
  if (aiSupport && req.method === 'POST') {
    const actor = await requireAnyPermission(req,repository,['support.view','support.manage']);
    sendJson(res,200,{data:await repository.assistSupportCase(decodeURIComponent(aiSupport[1]),actor)});return;
  }
  const aiExplain = url.pathname.match(/^\/api\/registry\/me\/programmes\/([^/]+)\/explain$/);
  if (aiExplain && req.method === 'POST') {
    const actor = await requirePermission(req,repository,'registry.self');
    sendJson(res,200,{data:await repository.explainMyAcademicRecord(decodeURIComponent(aiExplain[1]),actor)});return;
  }
  const aiDocument = url.pathname.match(/^\/api\/admissions\/applications\/([^/]+)\/document-check$/);
  if (aiDocument && req.method === 'POST') {
    const actor = await requirePermission(req,repository,'admissions.apply');
    sendJson(res,200,{data:await repository.checkApplicationDocument(decodeURIComponent(aiDocument[1]),await readJson(req,Math.ceil(courseUploadLimit*4/3)+25000),actor)});return;
  }
  if (url.pathname === '/api/me/work-summary' && req.method === 'GET') {
    const actor = await requireAuthenticated(req,repository);
    sendJson(res,200,{data:await repository.myWorkSummary(actor)});return;
  }
  const smsRoute = url.pathname.match(/^\/api\/me\/sms(?:\/(code|verify))?$/);
  if (smsRoute) {
    const actor = await requireAuthenticated(req,repository);
    const [,step] = smsRoute;
    let data;
    if (!step && req.method === 'GET') data = await repository.getSmsSettings(actor);
    else if (!step && req.method === 'PUT') data = await repository.setSmsEnabled(await readJson(req,500),actor);
    else if (!step && req.method === 'DELETE') data = await repository.removeSmsNumber(actor);
    else if (step === 'code' && req.method === 'POST') data = await repository.requestSmsCode(await readJson(req,500),actor);
    else if (step === 'verify' && req.method === 'POST') data = await repository.verifySmsCode(await readJson(req,500),actor);
    else throw requestError(405,'Method not allowed.');
    sendJson(res,200,{data});return;
  }
  if (url.pathname === '/api/push/status' && req.method === 'GET') { sendJson(res,200,{data:repository.pushStatus()});return; }
  if (url.pathname === '/api/me/push-subscriptions' && ['GET','POST','DELETE'].includes(req.method)) {
    const actor = await requireAuthenticated(req,repository);
    const data = req.method === 'GET' ? await repository.myPushDevices(actor) : req.method === 'POST' ? await repository.savePushSubscription({...await readJson(req,4000),userAgent:req.headers['user-agent'] || ''},actor) : await repository.deletePushSubscription(await readJson(req,2000),actor);
    sendJson(res,200,{data});return;
  }
  if (url.pathname === '/api/me/notification-preferences' && ['GET','PUT'].includes(req.method)) {
    const actor = await requireAuthenticated(req,repository);
    sendJson(res,200,{data:req.method === 'GET' ? await repository.getNotificationPreferences(actor) : await repository.saveNotificationPreferences(await readJson(req,4000),actor)});return;
  }
  if (url.pathname === '/api/calendar/feed' && ['GET','POST','DELETE'].includes(req.method)) {
    const actor = await requireAnyPermission(req,repository,['registry.self','teaching.self','admissions.apply','appointments.host']);
    const data = req.method === 'GET' ? await repository.calendarFeedStatus(actor) : req.method === 'POST' ? await repository.createCalendarFeed(actor) : await repository.revokeCalendarFeed(actor);
    sendJson(res,200,{data});return;
  }
  const feedMatch = url.pathname.match(/^\/api\/calendar\/feed\/([A-Za-z0-9_-]{1,64})\.ics$/);
  if (feedMatch && req.method === 'GET') {
    // Opened by calendar apps without a session: the unguessable token in the address is the credential.
    const origin = `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${String(req.headers.host || '').replace(/[^A-Za-z0-9.:-]/g,'')}`;
    const body = await repository.calendarFeed(feedMatch[1],{origin});
    res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'inline; filename="svu-calendar.ics"','Cache-Control':'private, max-age=900','X-Content-Type-Options':'nosniff'});
    res.end(body);return;
  }
  if (url.pathname === '/api/calendar/me' && req.method === 'GET') {
    const actor = await requireAnyPermission(req,repository,['registry.self','teaching.self','admissions.apply','appointments.host']);
    sendJson(res,200,{data:await repository.listMyCalendar(actor,Object.fromEntries(url.searchParams))});return;
  }
  if (url.pathname === '/api/automations' && req.method === 'GET') {
    const actor = await requirePermission(req,repository,'notification.send');
    sendJson(res,200,{data:await repository.listAutomationRuns(actor)});return;
  }
  if (url.pathname === '/api/automations/run' && req.method === 'POST') {
    const actor = await requirePermission(req,repository,'notification.send');
    sendJson(res,200,{data:await repository.runAutomationsNow(actor)});return;
  }
  if (url.pathname === '/api/payments/paynow/result' && req.method === 'POST') {
    // Paynow's server-to-server status update; verified by its hash inside the module. Always answer plainly.
    const fields = Object.fromEntries(new URLSearchParams((await readBody(req,8000)).toString('utf8')));
    await repository.paymentProviderResult(fields).catch(() => false);
    res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}); res.end('ok'); return;
  }
  const paymentList = url.pathname.match(/^\/api\/registry\/me\/programmes\/([^/]+)\/payments(\/checkout)?$/);
  if (paymentList && ((req.method === 'GET' && !paymentList[2]) || (req.method === 'POST' && paymentList[2]))) {
    const actor = await requirePermission(req,repository,'registry.self');
    const programmeId = decodeURIComponent(paymentList[1]);
    sendJson(res,200,{data:req.method === 'GET' ? await repository.listMyPayments(programmeId,actor) : await repository.startCheckout(programmeId,await readJson(req,1000),actor)});return;
  }
  const paymentOne = url.pathname.match(/^\/api\/payments\/(pay_[0-9a-f-]{36})(\/simulate)?$/);
  if (paymentOne && ((req.method === 'GET' && !paymentOne[2]) || (req.method === 'POST' && paymentOne[2]))) {
    const actor = await requirePermission(req,repository,'registry.self');
    sendJson(res,200,{data:req.method === 'GET' ? await repository.getPaymentIntent(paymentOne[1],actor) : await repository.simulatePaymentOutcome(paymentOne[1],await readJson(req,500),actor)});return;
  }
  if (url.pathname === '/api/appointments/slots' && ['GET','POST'].includes(req.method)) {
    if (req.method === 'GET') { const actor = await requirePermission(req,repository,'registry.self'); sendJson(res,200,{data:await repository.listOpenAppointmentSlots(actor,{kind:url.searchParams.get('kind') || ''})});return; }
    const actor = await requirePermission(req,repository,'appointments.host');
    sendJson(res,201,{data:await repository.createAppointmentSlots(await readJson(req,2000),actor)});return;
  }
  if (url.pathname === '/api/appointments/hosting' && req.method === 'GET') {
    const actor = await requirePermission(req,repository,'appointments.host');
    sendJson(res,200,{data:await repository.listMyAppointmentSlots(actor)});return;
  }
  const appointmentAction = url.pathname.match(/^\/api\/appointments\/(slots|bookings)\/((?:apt|apb)_[0-9a-f-]{36})\/(book|cancel)$/);
  if (appointmentAction && req.method === 'POST') {
    const [,kind,id,action] = appointmentAction;
    const actor = await requireAuthenticated(req,repository);
    const body = await readJson(req,2000);
    let data;
    if (kind === 'slots' && action === 'book') data = await repository.bookAppointment(id,body,actor);
    else if (kind === 'slots' && action === 'cancel') data = await repository.cancelAppointmentSlot(id,body,actor);
    else if (kind === 'bookings' && action === 'cancel') data = await repository.cancelAppointmentBooking(id,body,actor);
    else throw requestError(404,'Not found.');
    sendJson(res,200,{data});return;
  }
  if (url.pathname === '/api/evaluations' && ['GET','POST'].includes(req.method)) {
    const actor = await requirePermission(req,repository,'evaluations.manage');
    sendJson(res,200,{data:req.method === 'GET' ? await repository.listPeriodEvaluations(url.searchParams.get('period') || '',actor) : await repository.openPeriodEvaluations(await readJson(req,2000),actor)});return;
  }
  const evaluationClose = url.pathname.match(/^\/api\/evaluations\/(cev_[0-9a-f-]{36})\/close$/);
  if (evaluationClose && req.method === 'POST') {
    const actor = await requirePermission(req,repository,'evaluations.manage');
    sendJson(res,200,{data:await repository.closeEvaluation(evaluationClose[1],actor)});return;
  }
  const evaluationRoute = url.pathname.match(/^\/api\/course-workspaces\/([^/]+)\/([^/]+)\/evaluation$/);
  if (evaluationRoute && ['GET','POST'].includes(req.method)) {
    const [,periodId,courseId] = evaluationRoute.map((part) => part && decodeURIComponent(part));
    const actor = await requireAnyPermission(req,repository,['teaching.self','registry.self']);
    sendJson(res,200,{data:req.method === 'GET' ? await repository.courseEvaluation(periodId,courseId,actor) : await repository.submitEvaluation(periodId,courseId,await readJson(req,8000),actor)});return;
  }
  if (url.pathname === '/api/attendance/check-in' && req.method === 'POST') {
    const actor = await requirePermission(req,repository,'registry.self');
    sendJson(res,200,{data:await repository.checkInAttendance(await readJson(req,1000),actor)});return;
  }
  const attendanceRoute = url.pathname.match(/^\/api\/course-workspaces\/([^/]+)\/([^/]+)\/attendance(?:\/(att_[0-9a-f-]{36})(?:\/(live|close|marks))?)?$/);
  if (attendanceRoute) {
    const [,periodId,courseId,sessionId,action] = attendanceRoute.map((part) => part && decodeURIComponent(part));
    const actor = await requireAnyPermission(req,repository,['teaching.self','registry.self']);
    const origin = `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${String(req.headers.host || '').replace(/[^A-Za-z0-9.:-]/g,'')}`;
    let data;
    if (!sessionId && req.method === 'GET') data = await repository.courseAttendance(periodId,courseId,actor);
    else if (!sessionId && req.method === 'POST') data = await repository.openAttendance(periodId,courseId,await readJson(req,2000),actor);
    else if (action === 'live' && req.method === 'GET') data = await repository.attendanceLive(periodId,courseId,sessionId,actor,{origin});
    else if (action === 'close' && req.method === 'POST') data = await repository.closeAttendance(periodId,courseId,sessionId,actor);
    else if (action === 'marks' && req.method === 'POST') data = await repository.markAttendance(periodId,courseId,sessionId,await readJson(req,1000),actor);
    else throw requestError(405,'Method not allowed.');
    sendJson(res,200,{data});return;
  }
  if (req.method === 'GET' && url.pathname === '/api/course-workspaces/summaries') {
    const actor = await requirePermission(req,repository,'registry.self');
    sendJson(res,200,{data:await repository.getCourseWorkspaceSummaries(url.searchParams.get('programme'),actor)});return;
  }
  const courseWorkspace = url.pathname.match(/^\/api\/course-workspaces\/([^/]+)\/([^/]+)(?:\/resources(?:\/([^/]+)(?:\/(submit|download|review|ai-check|remind-missing|feedback-draft))?)?)?$/);
  if (courseWorkspace) {
    const [,encodedPeriod,encodedCourse,id,action] = courseWorkspace;
    const periodId = decodeURIComponent(encodedPeriod),courseId = decodeURIComponent(encodedCourse);
    const actor = await requireAnyPermission(req,repository,['registry.self','teaching.self']);
    if (req.method === 'GET' && action === 'download') {
      const {file,bytes} = await repository.downloadCourseFile(periodId,courseId,id,url.searchParams.get('submission'),actor,url.searchParams.get('review'));
      res.writeHead(200,{'Content-Type':file.contentType,'Content-Length':bytes.length,'Content-Disposition':`attachment; filename="${file.fileName.replace(/[^\w.-]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(bytes);return;
    }
    let data;
    if (req.method === 'GET' && !id && !url.pathname.endsWith('/resources')) data = await repository.getCourseWorkspace(periodId,courseId,actor);
    else if (req.method === 'POST' && action === 'submit') data = await repository.submitCourseAssignment(periodId,courseId,id,await readJson(req,Math.ceil(courseUploadLimit*4/3)+25000),actor);
    else if (req.method === 'POST' && action === 'feedback-draft') data = await repository.draftCourseFeedback(periodId,courseId,id,await readJson(req,20000),actor);
    else if (req.method === 'POST' && action === 'remind-missing') data = await repository.remindMissingSubmissions(periodId,courseId,id,actor);
    else if (req.method === 'POST' && action === 'ai-check') data = await repository.checkCourseAssignmentAi(periodId,courseId,id,await readJson(req,Math.ceil(courseUploadLimit*4/3)+25000),actor);
    else if (req.method === 'POST' && action === 'review') data = await repository.reviewCourseAssignment(periodId,courseId,id,await readJson(req,Math.ceil(courseUploadLimit*4/3)+25000),actor);
    else if (req.method === 'POST' && !action && (id || url.pathname.endsWith('/resources'))) data = await repository.saveCourseResource(periodId,courseId,id || null,await readJson(req,Math.ceil(courseUploadLimit*4/3)+25000),actor);
    if (!data) throw requestError(404,'Course workspace route was not found.');
    sendJson(res,200,{data});return;
  }
  if (req.method === 'GET' && url.pathname === '/api/enquiries/metadata') {
    const actor = await requirePermission(req,repository,'enquiries.manage');sendJson(res,200,{data:await repository.prospectiveEnquiryMetadata(actor)});return;
  }
  const enquiry = url.pathname.match(/^\/api\/enquiries\/(me\/)?cases(?:\/([^/]+)(?:\/(comment|update|escalate|withdraw|reopen))?)?$/);
  if (enquiry && ['GET','POST'].includes(req.method)) {
    const [,own,id,action] = enquiry,self = Boolean(own);
    if (req.method === 'GET' && action || req.method === 'POST' && !id && !self) throw requestError(404,'Enquiry route was not found.');
    const actor = await requirePermission(req,repository,self ? 'enquiries.self' : 'enquiries.manage');
    const data = req.method === 'GET' ? id ? await repository.getProspectiveEnquiry(id,actor,self) : await repository.listProspectiveEnquiries(Object.fromEntries(url.searchParams),actor,self)
      : !id ? await repository.createProspectiveEnquiry(await readJson(req,24000),actor) : action ? await repository.actOnProspectiveEnquiry(id,action,await readJson(req,24000),actor,self) : null;
    if (!data) throw requestError(404,'Enquiry route was not found.');
    sendJson(res,req.method === 'POST' && !id ? 201 : 200,{data});return;
  }
  if (req.method === 'GET' && url.pathname === '/api/guidance/articles') {
    sendJson(res,200,{data:await repository.listPublicGuidance(Object.fromEntries(url.searchParams))});return;
  }
  const guidance = url.pathname.match(/^\/api\/guidance\/manage\/(metadata|articles)(?:\/([^/]+)(?:\/(versions|withdraw)(?:\/([^/]+)\/(publish))?)?)?$/);
  if (guidance) {
    const [,kind,id,action,versionId,publish] = guidance;
    const permission = action === 'withdraw' || publish ? 'guidance.publish' : req.method === 'POST' ? 'guidance.manage' : null;
    const actor = permission ? await requirePermission(req,repository,permission) : await requireAnyPermission(req,repository,['guidance.manage','guidance.publish']);
    let data;
    if (req.method === 'GET' && kind === 'metadata' && !id) data = await repository.guidanceMetadata(actor);
    else if (req.method === 'GET' && kind === 'articles' && !action) data = id ? await repository.getStaffGuidance(id,actor) : await repository.listStaffGuidance(Object.fromEntries(url.searchParams),actor);
    else if (req.method === 'POST' && kind === 'articles') {
      const body = await readJson(req,36000);
      if (!id) data = await repository.createGuidance(body,actor);
      else if (publish) data = await repository.publishGuidance(id,versionId,body,actor);
      else if (action === 'versions' && !versionId) data = await repository.draftGuidanceVersion(id,body,actor);
      else if (action === 'withdraw') data = await repository.withdrawGuidance(id,body,actor);
    }
    if (!data) throw requestError(404,'Guidance route was not found.');
    sendJson(res,200,{data});return;
  }
  const communicationOwn = url.pathname.match(/^\/api\/admissions\/me\/communications\/(preferences|messages)(?:\/([^/]+)\/read)?$/);
  if (communicationOwn) {
    const [,kind,id] = communicationOwn,actor = await requirePermission(req,repository,'communications.self');
    let data;
    if (req.method === 'GET' && !id) data = kind === 'preferences' ? await repository.getCommunicationPreferences(actor) : await repository.listApplicantMessages(Object.fromEntries(url.searchParams),actor);
    else if (req.method === 'PUT' && kind === 'preferences' && !id) data = await repository.setCommunicationPreferences(await readJson(req,2000),actor);
    else if (req.method === 'POST' && kind === 'messages' && id) {const body = await readJson(req,2000);if (!body || Array.isArray(body) || Object.keys(body).length) throw requestError(400,'Unsupported message-read fields.');data = await repository.readApplicantMessage(id,actor);}
    else throw requestError(404,'Communication route was not found.');
    sendJson(res,200,{data});return;
  }
  const communicationStaff = url.pathname.match(/^\/api\/admissions\/communications\/(metadata|preview|campaigns)(?:\/([^/]+)(?:\/(publish))?)?$/);
  if (communicationStaff) {
    const [,kind,id,action] = communicationStaff,actor = await requirePermission(req,repository,'admissions.communicate');let data;
    if (req.method === 'GET' && kind === 'metadata' && !id) data = await repository.communicationMetadata(actor);
    else if (req.method === 'GET' && kind === 'campaigns' && !action) data = id ? await repository.getApplicantCommunication(id,actor) : await repository.listApplicantCommunications(Object.fromEntries(url.searchParams),actor);
    else if (req.method === 'POST' && kind === 'preview' && !id) data = await repository.previewApplicantCommunication(await readJson(req,24000),actor);
    else if (req.method === 'POST' && kind === 'campaigns' && id && action === 'publish') data = await repository.publishApplicantCommunication(id,await readJson(req,2000),actor);
    else throw requestError(404,'Communication route was not found.');
    sendJson(res,200,{data});return;
  }
  if (url.pathname === '/api/restricted-profiles/policies') {
    const actor=await requireAnyPermission(req,repository,['restricted.policy.manage','restricted.policy.approve']);
    res.setHeader('Cache-Control','no-store');
    if (req.method === 'GET') {sendJson(res,200,{data:await repository.restrictedPolicyWorkspace(actor,Object.fromEntries(url.searchParams))});return;}
    if (req.method === 'POST') {sendJson(res,201,{data:await repository.createRestrictedPolicy(await readJson(req,12000),actor)});return;}
  }
  if (url.pathname === '/api/student-sharing/register' && req.method === 'POST') {
    sendJson(res,201,{data:await repository.registerShareRecipient(await readJson(req,6000))});return;
  }
  if (url.pathname === '/api/student-sharing/accept' && req.method === 'POST') {
    const actor=await requireAuthenticated(req,repository);sendJson(res,200,{data:await repository.acceptStudentShare(await readJson(req,2000),actor)});return;
  }
  const ownShare=url.pathname.match(/^\/api\/registry\/me\/sharing\/([^/]+)$/);
  if (ownShare && ['GET','POST'].includes(req.method)) {
    const actor=await requirePermission(req,repository,'registry.self');
    sendJson(res,req.method==='POST' ? 201 : 200,{data:req.method==='GET' ? await repository.ownStudentShares(ownShare[1],Object.fromEntries(url.searchParams),actor) : await repository.inviteStudentShare(ownShare[1],await readJson(req,4000),actor)});return;
  }
  if (url.pathname === '/api/student-sharing/received' && req.method === 'GET') {
    const actor=await requireAuthenticated(req,repository);sendJson(res,200,{data:await repository.receivedStudentShares(Object.fromEntries(url.searchParams),actor)});return;
  }
  const shareAction=url.pathname.match(/^\/api\/student-sharing\/([^/]+)\/(revoke|resend|decline)$/);
  if (shareAction && req.method==='POST') {
    const actor=await requireAuthenticated(req,repository);sendJson(res,200,{data:await repository.changeStudentShare(shareAction[1],shareAction[2],await readJson(req,2000),actor)});return;
  }
  const shareRead=url.pathname.match(/^\/api\/student-sharing\/([^/]+)\/(programme_status|confirmed_registration|published_results|fee_summary)$/);
  if (shareRead && req.method==='GET') {
    const actor=await requireAuthenticated(req,repository);sendJson(res,200,{data:await repository.readSharedStudentRecord(shareRead[1],shareRead[2],Object.fromEntries(url.searchParams),actor)});return;
  }
  if (url.pathname === '/api/restricted-profiles/care' && req.method === 'GET') {
    const actor=await requireAnyPermission(req,repository,['restricted.religion.read','restricted.disability.read','restricted.medical.read']);
    res.setHeader('Cache-Control','no-store');sendJson(res,200,{data:await repository.restrictedCareWorkspace(Object.fromEntries(url.searchParams),actor)});return;
  }
  const restrictedPolicy=url.pathname.match(/^\/api\/restricted-profiles\/policies\/([^/]+)$/);
  if (restrictedPolicy && req.method === 'POST') {
    const actor=await requireAnyPermission(req,repository,['restricted.policy.manage','restricted.policy.approve']);
    res.setHeader('Cache-Control','no-store');
    sendJson(res,200,{data:await repository.decideRestrictedPolicy(restrictedPolicy[1],await readJson(req,2000),actor)});return;
  }
  const restrictedSelf=url.pathname.match(/^\/api\/registry\/me\/restricted\/([^/]+)(?:\/(religion|disability|medical)(?:\/(withdraw))?)?$/);
  if (restrictedSelf) {
    const [,id,group,action]=restrictedSelf,actor=await requirePermission(req,repository,'registry.self');
    res.setHeader('Cache-Control','no-store');let data;
    if (req.method === 'GET' && !group) data=await repository.ownRestrictedProfile(id,actor);
    else if (req.method === 'PUT' && group && !action) data=await repository.saveRestrictedProfile(id,group,await readJson(req,12000),actor);
    else if (req.method === 'POST' && action === 'withdraw') data=await repository.withdrawRestrictedConsent(id,group,await readJson(req,2000),actor);
    else throw requestError(404,'Restricted profile route was not found.');
    sendJson(res,200,{data});return;
  }
  const restrictedRead=url.pathname.match(/^\/api\/restricted-profiles\/students\/([^/]+)\/(religion|disability|medical)\/read$/);
  if (restrictedRead && req.method === 'POST') {
    const [,id,group]=restrictedRead,actor=await requirePermission(req,repository,`restricted.${group}.read`);
    res.setHeader('Cache-Control','no-store');
    sendJson(res,200,{data:await repository.readRestrictedProfile(id,group,await readJson(req,2000),actor)});return;
  }
  const supportCase = url.pathname.match(/^\/api\/support\/(me\/)?cases(?:\/([^/]+)(?:\/(comment|update|escalate|reopen|close))?)?$/);
  if (supportCase && ['GET','POST'].includes(req.method)) {
    const [,own,id,action] = supportCase,self = Boolean(own);
    if (req.method === 'POST' && !id && !self || req.method === 'GET' && action) throw requestError(404,'Support route was not found.');
    const actor = await requirePermission(req,repository,self ? 'support.self' : req.method === 'POST' ? 'support.manage' : 'support.view');
    const data = req.method === 'GET' ? id ? await repository.getSupportCase(id,actor,self) : await repository.listSupportCases(Object.fromEntries(url.searchParams),actor,self)
      : !id ? await repository.createSupportCase(await readJson(req,24000),actor) : action ? await repository.actOnSupportCase(id,action,await readJson(req,24000),actor,self) : null;
    if (!data) throw requestError(404,'Support route was not found.');
    sendJson(res,req.method === 'POST' && !id ? 201 : 200,{data});return;
  }
  if (req.method === 'GET' && ['/api/reports/registry','/api/reports/registry/dictionary','/api/reports/registry/intakes'].includes(url.pathname)) {
    const actor = await requirePermission(req,repository,'registry.view');
    sendJson(res,200,{data:url.pathname.endsWith('/dictionary') ? await repository.registryMetricDictionary(actor) : url.pathname.endsWith('/intakes') ? await repository.listRegistryReportingIntakes(actor) : await repository.registryOperationsReport(Object.fromEntries(url.searchParams),actor)});return;
  }
  if (req.method === 'GET' && ['/api/reports/enquiries','/api/reports/enquiries/dictionary','/api/reports/enquiries/intakes'].includes(url.pathname)) {
    const actor = await requirePermission(req,repository,'enquiries.manage');
    sendJson(res,200,{data:url.pathname.endsWith('/dictionary') ? await repository.enquiryMetricDictionary(actor) : url.pathname.endsWith('/intakes') ? await repository.listEnquiryReportingIntakes(actor) : await repository.enquiryOperationsReport(Object.fromEntries(url.searchParams),actor)});return;
  }
  if (req.method === 'GET' && ['/api/reports/support','/api/reports/support/dictionary','/api/reports/support/intakes'].includes(url.pathname)) {
    const actor = await requirePermission(req,repository,'support.view');
    sendJson(res,200,{data:url.pathname.endsWith('/dictionary') ? await repository.supportMetricDictionary(actor) : url.pathname.endsWith('/intakes') ? await repository.listSupportReportingIntakes(actor) : await repository.supportOperationsReport(Object.fromEntries(url.searchParams),actor)});return;
  }
  if (req.method === 'GET' && ['/api/reports/communications','/api/reports/communications/dictionary','/api/reports/communications/intakes'].includes(url.pathname)) {
    const actor = await requirePermission(req,repository,'admissions.communicate');
    sendJson(res,200,{data:url.pathname.endsWith('/dictionary') ? await repository.communicationMetricDictionary(actor) : url.pathname.endsWith('/intakes') ? await repository.listCommunicationReportingIntakes(actor) : await repository.communicationOperationsReport(Object.fromEntries(url.searchParams),actor)});return;
  }
  if (url.pathname === '/api/reports/schedules' && ['GET','POST'].includes(req.method)) {
    const actor = await requireAuthenticated(req,repository);
    sendJson(res,200,{data:req.method === 'GET' ? await repository.listReportSchedules(Object.fromEntries(url.searchParams),actor) : await repository.createReportSchedule(await readJson(req,100_000),actor)});return;
  }
  const reportSchedule = url.pathname.match(/^\/api\/reports\/schedules\/([^/]+)(?:\/(transitions|run))?$/);
  if (reportSchedule && (req.method === 'GET' && !reportSchedule[2] || req.method === 'POST' && reportSchedule[2])) {
    const actor = await requireAuthenticated(req,repository);
    sendJson(res,200,{data:req.method === 'GET' ? await repository.readReportSchedule(reportSchedule[1],actor) : reportSchedule[2] === 'transitions' ? await repository.transitionReportSchedule(reportSchedule[1],await readJson(req,10_000),actor) : await repository.runReportSchedule(reportSchedule[1],actor)});return;
  }
  if (url.pathname === '/api/reports/editions' && ['GET','POST'].includes(req.method)) {
    const actor = await requireAuthenticated(req,repository);
    sendJson(res,200,{data:req.method === 'GET' ? await repository.listReportEditions(Object.fromEntries(url.searchParams),actor) : await repository.captureReportEdition(await readJson(req,100_000),actor)});return;
  }
  const reportEdition = url.pathname.match(/^\/api\/reports\/editions\/([^/]+)(?:\/(download|withdraw))?$/);
  if (reportEdition && (req.method === 'GET' && reportEdition[2] !== 'withdraw' || req.method === 'POST' && reportEdition[2] === 'withdraw')) {
    const actor = await requireAuthenticated(req,repository);
    sendJson(res,200,{data:reportEdition[2] === 'withdraw' ? await repository.withdrawReportEdition(reportEdition[1],await readJson(req,10_000),actor) : await repository.readReportEdition(reportEdition[1],actor,reportEdition[2] === 'download')});return;
  }
  if (req.method === 'GET' && ['/api/reports/continuation','/api/reports/continuation/dictionary','/api/reports/continuation/periods'].includes(url.pathname)) {
    const actor = await requirePermission(req,repository,'registry.view');
    sendJson(res,200,{data:url.pathname.endsWith('/dictionary') ? await repository.continuationMetricDictionary(actor) : url.pathname.endsWith('/periods') ? await repository.listContinuationReportingPeriods(actor) : await repository.continuationOperationsReport(Object.fromEntries(url.searchParams),actor)});return;
  }
  if (req.method === 'GET' && ['/api/reports/academic','/api/reports/academic/dictionary','/api/reports/academic/intakes'].includes(url.pathname)) {
    const actor = await requireAnyPermission(req,repository,academicReportPermissions);
    sendJson(res,200,{data:url.pathname.endsWith('/dictionary') ? await repository.academicMetricDictionary(actor) : url.pathname.endsWith('/intakes') ? await repository.listAcademicReportingIntakes(actor) : await repository.academicOperationsReport(Object.fromEntries(url.searchParams),actor)});return;
  }
  if (req.method === 'GET' && ['/api/reports/assessment','/api/reports/assessment/dictionary','/api/reports/assessment/metadata'].includes(url.pathname)) {
    const actor = await requireAnyPermission(req,repository,assessmentReportPermissions);
    sendJson(res,200,{data:url.pathname.endsWith('/dictionary') ? await repository.assessmentMetricDictionary(actor) : url.pathname.endsWith('/metadata') ? await repository.assessmentReportingMetadata(actor) : await repository.assessmentOperationsReport(Object.fromEntries(url.searchParams),actor)});return;
  }
  if (req.method === 'GET' && ['/api/reports/admissions','/api/reports/admissions/dictionary','/api/reports/admissions/intakes'].includes(url.pathname)) {
    const actor = await requirePermission(req,repository,'admissions.review');
    sendJson(res,200,{data:url.pathname.endsWith('/dictionary') ? await repository.admissionsMetricDictionary(actor) : url.pathname.endsWith('/intakes') ? await repository.listAdmissionsReportingIntakes(actor) : await repository.admissionsOperationsReport(Object.fromEntries(url.searchParams),actor)});return;
  }
  if (req.method === 'GET' && ['/api/reports/examinations','/api/reports/examinations/dictionary'].includes(url.pathname)) {
    const actor = await requireAnyPermission(req,repository,examinationReportPermissions);
    sendJson(res,200,{data:url.pathname.endsWith('/dictionary') ? await repository.examinationMetricDictionary(actor) : await repository.examinationOperationsReport(Object.fromEntries(url.searchParams),actor)});return;
  }
  const ownArrangementHistory = url.pathname.match(/^\/api\/registry\/me\/programmes\/([^/]+)\/exam-arrangements$/);
  if (req.method === 'GET' && (url.pathname === '/api/exams/arrangements/history' || ownArrangementHistory)) {
    const actor = await requireAnyPermission(req,repository,ownArrangementHistory ? ['registry.self'] : ['exams.arrangements.manage','exams.arrangements.review']);
    const filters = Object.fromEntries(['q','status','limit','offset'].map((key) => [key,url.searchParams.get(key)]));
    sendJson(res,200,{data:await repository.listArrangementHistory(filters,actor,ownArrangementHistory?.[1] || null)});return;
  }
  if (req.method === 'GET' && url.pathname === '/api/exams/arrangements/sittings') {
    const actor = await requireAnyPermission(req,repository,['exams.arrangements.manage','exams.arrangements.review']);sendJson(res,200,{data:await repository.listArrangementSittings(actor)});return;
  }
  const arrangementSitting = url.pathname.match(/^\/api\/exams\/(me\/)?sittings\/([^/]+)\/arrangements$/);
  if (arrangementSitting && ['GET','POST'].includes(req.method)) {
    const self = Boolean(arrangementSitting[1]),actor = await requireAnyPermission(req,repository,self ? ['registry.self'] : ['exams.arrangements.manage','exams.arrangements.review']);
    sendJson(res,req.method === 'POST' ? 201 : 200,{data:req.method === 'POST' ? await repository.requestExamArrangement(arrangementSitting[2],await readJson(req,20000),actor,self) : await repository.getExamArrangements(arrangementSitting[2],actor,self)});return;
  }
  const arrangementAction = url.pathname.match(/^\/api\/exams\/(me\/)?arrangements\/([^/]+)\/(review|close)$/);
  if (arrangementAction && req.method === 'POST' && !(arrangementAction[1] && arrangementAction[3] === 'review')) {
    const self = Boolean(arrangementAction[1]),actor = await requirePermission(req,repository,self ? 'registry.self' : arrangementAction[3] === 'review' ? 'exams.arrangements.review' : 'exams.arrangements.manage');
    sendJson(res,200,{data:arrangementAction[3] === 'review' ? await repository.reviewExamArrangement(arrangementAction[2],await readJson(req,20000),actor) : await repository.closeExamArrangement(arrangementAction[2],await readJson(req,20000),actor,self)});return;
  }
  const paperAuthority = ['teaching.self','assessment.plan.manage','exams.papers.manage','exams.papers.review','exams.papers.scan','exams.papers.release'];
  const orderPapers = url.pathname.match(/^\/api\/exams\/orders\/([^/]+)\/papers$/);
  if (orderPapers && ['GET','POST'].includes(req.method)) {
    const actor = await requireAnyPermission(req,repository,paperAuthority);
    sendJson(res,req.method === 'POST' ? 201 : 200,{data:req.method === 'POST' ? await repository.requestExamPaperUpload(orderPapers[1],await readJson(req,20000),actor) : await repository.getExamPapers(orderPapers[1],actor)});return;
  }
  if (url.pathname === '/api/exams/paper-releases/me' && req.method === 'GET') {
    const actor = await requirePermission(req,repository,'exams.duties.self');sendJson(res,200,{data:await repository.ownExamPaperReleases(actor)});return;
  }
  const paperRelease = url.pathname.match(/^\/api\/exams\/paper-releases\/([^/]+)\/(download|acknowledge|revoke)$/);
  if (paperRelease && req.method === 'POST') {
    const actor = await requirePermission(req,repository,paperRelease[2] === 'revoke' ? 'exams.papers.release' : 'exams.duties.self');
    const input = await readJson(req,20000);
    if (paperRelease[2] === 'download') {sendExamPaper(res,await repository.downloadReleasedExamPaper(paperRelease[1],input,actor));return;}
    sendJson(res,200,{data:paperRelease[2] === 'revoke' ? await repository.revokeExamPaperRelease(paperRelease[1],input,actor) : await repository.acknowledgeExamPaperRelease(paperRelease[1],input,actor)});return;
  }
  const examPaper = url.pathname.match(/^\/api\/exams\/papers\/([^/]+)\/(content|scan|submit|review|withdraw|download|release)$/);
  if (examPaper && (req.method === 'POST' && examPaper[2] !== 'content' || req.method === 'PUT' && examPaper[2] === 'content')) {
    const [,id,action] = examPaper;
    const required = {scan:'exams.papers.scan',review:'exams.papers.review',release:'exams.papers.release'};
    const actor = required[action] ? await requirePermission(req,repository,required[action]) : await requireAnyPermission(req,repository,paperAuthority);
    if (action === 'content') {sendJson(res,200,{data:await repository.receiveExamPaperUpload(id,await readBody(req,maxUploadBytes),actor)});return;}
    const input = await readJson(req,20000);
    if (action === 'download') {sendExamPaper(res,await repository.downloadExamPaper(id,input,actor));return;}
    const methods = {scan:'scanExamPaper',submit:'submitExamPaper',review:'reviewExamPaper',withdraw:'withdrawExamPaper',release:'releaseExamPaper'};
    sendJson(res,200,{data:await repository[methods[action]](id,input,actor)});return;
  }
  // Public: anyone holding a transcript can check it by its verification code.
  const transcriptVerify = url.pathname.match(/^\/api\/verify\/transcripts\/([^/]{1,40})$/);
  if (transcriptVerify && req.method === "GET") {
    // One code box on the Verify page: transcripts and certificates first, then self-service letters.
    const code = decodeURIComponent(transcriptVerify[1]);
    let data;
    try { data = await repository.verifyTranscript(code); }
    catch (error) { if (error.statusCode !== 404) throw error; data = await repository.verifyLetter(code); }
    sendJson(res,200,{data}); return;
  }
  if (url.pathname === "/api/registry/me/card" && req.method === "GET") {
    const actor = await requirePermission(req,repository,"registry.self");
    const origin = `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${String(req.headers.host || '').replace(/[^A-Za-z0-9.:-]/g,'')}`;
    sendJson(res,200,{data:await repository.getMyCard(actor,{origin})}); return;
  }
  const cardVerify = url.pathname.match(/^\/api\/verify\/card\/(card-[A-Za-z0-9_.-]{1,260})$/);
  if (cardVerify && req.method === "GET") { sendJson(res,200,{data:await repository.verifyStudentCard(cardVerify[1])}); return; }
  const letterList = url.pathname.match(/^\/api\/registry\/me\/programmes\/([^/]+)\/letters$/);
  if (letterList && ["GET","POST"].includes(req.method)) {
    const actor = await requirePermission(req,repository,"registry.self");
    sendJson(res,req.method === "POST" ? 201 : 200,{data:req.method === "GET" ? await repository.listMyLetters(letterList[1],actor) : await repository.issueMyLetter(letterList[1],await readJson(req,1000),actor)}); return;
  }
  const letterOne = url.pathname.match(/^\/api\/registry\/me\/letters\/(ltr_[A-Za-z0-9-]{1,60})$/);
  if (letterOne && req.method === "GET") {
    const actor = await requirePermission(req,repository,"registry.self");
    const origin = `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${String(req.headers.host || '').replace(/[^A-Za-z0-9.:-]/g,'')}`;
    sendJson(res,200,{data:await repository.getMyLetter(letterOne[1],actor,{origin})}); return;
  }
  const letterRevoke = url.pathname.match(/^\/api\/registry\/letters\/(ltr_[A-Za-z0-9-]{1,60})\/revoke$/);
  if (letterRevoke && req.method === "POST") {
    const actor = await requirePermission(req,repository,"registry.transcript.issue");
    sendJson(res,200,{data:await repository.revokeLetter(letterRevoke[1],await readJson(req,2000),actor)}); return;
  }
  if (url.pathname === "/api/exams/periods" && req.method === "GET") {
    const actor = await requireAnyPermission(req,repository,["exams.schedule","exams.publish","results.view"]);
    sendJson(res,200,{data:await repository.listExamPeriods(actor)}); return;
  }
  if (url.pathname === '/api/exams/duties/me' && req.method === 'GET') {
    const actor = await requirePermission(req,repository,'exams.duties.self');
    sendJson(res,200,{data:await repository.ownExamDuties(actor)}); return;
  }
  if (url.pathname === '/api/exams/publications' && req.method === 'GET') {
    const actor = await requireAnyPermission(req,repository,['exams.schedule','exams.publish']);
    sendJson(res,200,{data:await repository.listExamPublications(Object.fromEntries(url.searchParams),actor)});return;
  }
  const examPublication = url.pathname.match(/^\/api\/exams\/periods\/([^/]+)\/publications\/([^/]+)(?:\/sittings\/([^/]+)\/manifest)?$/);
  if (examPublication && req.method === 'GET') {
    const [,periodId,revision,sittingId] = examPublication,actor = await requireAnyPermission(req,repository,['exams.schedule','exams.publish']);
    sendJson(res,200,{data:sittingId ? await repository.getPublicationManifest(periodId,Number(revision),sittingId,Object.fromEntries(url.searchParams),actor) : await repository.getExamPublication(periodId,Number(revision),actor)});return;
  }
  const examSeating = url.pathname.match(/^\/api\/exams\/sittings\/([^/]+)\/seating(?:\/(publish|history))?$/);
  if (examSeating) {
    const [,id,action] = examSeating;
    if (req.method === 'GET' && action !== 'publish') {
      const actor = await requireAnyPermission(req,repository,['exams.schedule','exams.publish']);
      sendJson(res,200,{data:action === 'history' ? await repository.examSeatingHistory(id,actor) : await repository.getExamSeating(id,actor)});return;
    }
    if (req.method === 'POST' && action !== 'history') {
      const actor = await requirePermission(req,repository,action === 'publish' ? 'exams.publish' : 'exams.schedule');
      sendJson(res,200,{data:action === 'publish' ? await repository.publishExamSeating(id,await readJson(req),actor) : await repository.saveExamSeating(id,await readJson(req),actor)});return;
    }
  }
  const examManifest = url.pathname.match(/^\/api\/exams\/(me\/)?sittings\/([^/]+)\/manifest$/);
  if (examManifest && req.method === 'GET') {
    const self = Boolean(examManifest[1]);
    const actor = self ? await requirePermission(req,repository,'exams.duties.self') : await requireAnyPermission(req,repository,['exams.schedule','exams.publish']);
    sendJson(res,200,{data:await repository.getExamManifest(examManifest[2],actor,self)});return;
  }
  const examVenue = url.pathname.match(/^\/api\/exams\/venues(?:\/([^/]+)(?:\/(history))?)?$/);
  if (examVenue) {
    const [,id,history] = examVenue;
    if (req.method === 'GET' && !id) {
      const actor = await requireAnyPermission(req,repository,['exams.schedule','exams.publish','results.view','exams.venues.manage']);
      sendJson(res,200,{data:await repository.listExamVenues(actor)}); return;
    }
    if (req.method === 'GET' && history) {
      const actor = await requirePermission(req,repository,'exams.venues.manage');
      sendJson(res,200,{data:await repository.examVenueHistory(id,actor)}); return;
    }
    if (req.method === 'POST' && !history) {
      const actor = await requirePermission(req,repository,'exams.venues.manage');
      sendJson(res,id ? 200 : 201,{data:await repository.saveExamVenue(id || null,await readJson(req),actor)}); return;
    }
  }
  const invigilators = url.pathname.match(/^\/api\/exams\/sittings\/([^/]+)\/invigilators$/);
  if (invigilators && req.method === 'POST') {
    const actor = await requirePermission(req,repository,'exams.schedule');
    sendJson(res,200,{data:await repository.replaceExamInvigilators(invigilators[1],await readJson(req),actor)}); return;
  }
  const examPeriod = url.pathname.match(/^\/api\/exams\/periods\/([^/]+)(?:\/(sittings|publish|refresh-candidates))?$/);
  if (examPeriod) {
    const [,periodId,action] = examPeriod;
    if (req.method === 'POST' && action === 'refresh-candidates') {
      const actor = await requirePermission(req,repository,'exams.schedule');
      sendJson(res,200,{data:await repository.refreshExamCandidates(periodId,await readJson(req),actor)}); return;
    }
    if (req.method === "GET" && !action) {
      const actor = await requireAnyPermission(req,repository,["exams.schedule","exams.publish","results.view"]);
      sendJson(res,200,{data:await repository.getExamTimetable(periodId,actor)}); return;
    }
    if (req.method === "POST" && action === "sittings") {
      const actor = await requirePermission(req,repository,"exams.schedule");
      sendJson(res,201,{data:await repository.scheduleSitting(periodId,await readJson(req),actor)}); return;
    }
    if (req.method === "POST" && action === "publish") {
      const actor = await requirePermission(req,repository,"exams.publish");
      sendJson(res,200,{data:await repository.publishExamTimetable(periodId,await readJson(req),actor)}); return;
    }
  }
  const examSitting = url.pathname.match(/^\/api\/exams\/sittings\/([^/]+)$/);
  const examOrderReview = url.pathname.match(/^\/api\/exams\/orders\/([^/]+)\/review$/);
  if (examOrderReview && req.method === "POST") {
    const actor = await requirePermission(req,repository,"exams.schedule");
    sendJson(res,200,{data:await repository.reviewExamOrder(examOrderReview[1],await readJson(req),actor)}); return;
  }
  if (examSitting && req.method === "POST") {
    const actor = await requirePermission(req,repository,"exams.schedule");
    sendJson(res,200,{data:await repository.changeSitting(examSitting[1],await readJson(req),actor)}); return;
  }
  const ownExams = url.pathname.match(/^\/api\/registry\/me\/programmes\/([^/]+)\/exams$/);
  if (ownExams && req.method === "GET") {
    const actor = await requirePermission(req,repository,"registry.self");
    sendJson(res,200,{data:await repository.listOwnExams(ownExams[1],actor)}); return;
  }
  const withdrawalList = url.pathname.match(/^\/api\/registry\/(me\/)?programmes\/([^/]+)\/withdrawals$/);
  if (withdrawalList && req.method === "GET") {
    const actor = await requirePermission(req,repository,withdrawalList[1] ? "registry.self" : "registry.view");
    sendJson(res,200,{data:await repository.listCourseWithdrawals(withdrawalList[2],actor,Boolean(withdrawalList[1]))}); return;
  }
  const withdrawalRequest = url.pathname.match(/^\/api\/registry\/(me\/)?programmes\/([^/]+)\/registrations\/([^/]+)\/withdrawals$/);
  if (withdrawalRequest && req.method === "POST") {
    const own = Boolean(withdrawalRequest[1]);
    const actor = await requirePermission(req,repository,own ? "registry.self" : "registry.exception.request");
    sendJson(res,201,{data:await repository.requestCourseWithdrawal(withdrawalRequest[2],withdrawalRequest[3],await readJson(req),actor,own)}); return;
  }
  const withdrawalReview = url.pathname.match(/^\/api\/registry\/programmes\/([^/]+)\/withdrawals\/([0-9]+)\/review$/);
  if (withdrawalReview && req.method === "POST") {
    const actor = await requirePermission(req,repository,"registry.exception.approve");
    sendJson(res,200,{data:await repository.reviewCourseWithdrawal(withdrawalReview[1],Number(withdrawalReview[2]),await readJson(req),actor)}); return;
  }
  const extensionRoute = url.pathname.match(/^\/api\/registry\/programmes\/([^/]+)\/registrations\/([^/]+)\/extensions(?:\/([0-9]+)\/review)?$/);
  if (extensionRoute && req.method === "POST") {
    const [,programmeId,periodId,extensionId] = extensionRoute;
    const actor = await requirePermission(req,repository,extensionId ? "registry.exception.approve" : "registry.exception.request"),input = await readJson(req);
    sendJson(res,extensionId ? 200 : 201,{data:extensionId ? await repository.reviewWindowExtension(programmeId,periodId,Number(extensionId),input,actor) : await repository.requestWindowExtension(programmeId,periodId,input,actor)}); return;
  }
  if (url.pathname === "/api/reports/document-issuance" && req.method === "GET") {
    const actor = await requireAnyPermission(req,repository,["registry.transcript.issue","results.view"]);
    sendJson(res,200,{data:await repository.listDocumentIssuance(actor,Object.fromEntries(url.searchParams))}); return;
  }
  if (url.pathname === "/api/finance/sponsors") {
    if (req.method === "GET") { const actor = await requirePermission(req,repository,"finance.view"); sendJson(res,200,{data:await repository.listSponsors(actor)}); return; }
    if (req.method === "POST") { const actor = await requirePermission(req,repository,"finance.adjustment.request"); sendJson(res,201,{data:await repository.createSponsor(await readJson(req),actor)}); return; }
  }
  const sponsorPayment = url.pathname.match(/^\/api\/finance\/sponsors\/([^/]+)\/payments$/);
  if (sponsorPayment && req.method === "POST") {
    const actor = await requirePermission(req,repository,"finance.payment.record");
    sendJson(res,201,{data:await repository.recordSponsorPayment(sponsorPayment[1],await readJson(req),actor)}); return;
  }
  const sponsorshipRoute = url.pathname.match(/^\/api\/finance\/programmes\/([^/]+)\/sponsorships(?:\/([0-9]+)\/(review|end))?$/);
  if (sponsorshipRoute) {
    const [,programmeId,sponsorshipId,action] = sponsorshipRoute;
    if (req.method === "GET" && !sponsorshipId) { const actor = await requirePermission(req,repository,"finance.view"); sendJson(res,200,{data:await repository.listProgrammeSponsorships(programmeId,actor)}); return; }
    if (req.method === "POST") {
      const actor = await requirePermission(req,repository,action === "review" ? "finance.adjustment.approve" : "finance.adjustment.request"),input = await readJson(req);
      const data = !action ? await repository.requestSponsorship(programmeId,input,actor) : action === "review" ? await repository.reviewSponsorship(programmeId,Number(sponsorshipId),input,actor) : await repository.endSponsorship(programmeId,Number(sponsorshipId),input,actor);
      sendJson(res,action ? 200 : 201,{data}); return;
    }
  }
  const planRoute = url.pathname.match(/^\/api\/finance\/programmes\/([^/]+)\/plans(?:\/([0-9]+)\/(review|cancel))?$/);
  if (planRoute) {
    const [,programmeId,planId,action] = planRoute;
    if (req.method === "GET" && !planId) {
      const actor = await requirePermission(req,repository,"finance.view");
      sendJson(res,200,{data:await repository.listPaymentPlans(programmeId,actor)}); return;
    }
    if (req.method === "POST") {
      const actor = await requirePermission(req,repository,action === "review" ? "finance.adjustment.approve" : "finance.adjustment.request"),input = await readJson(req);
      const data = !action ? await repository.requestPaymentPlan(programmeId,input,actor) : action === "review" ? await repository.reviewPaymentPlan(programmeId,Number(planId),input,actor) : await repository.cancelPaymentPlan(programmeId,Number(planId),input,actor);
      sendJson(res,action ? 200 : 201,{data}); return;
    }
  }
  if (url.pathname.startsWith("/api/integrations")) {
    const path = url.pathname.slice("/api/integrations".length);
    if (req.method === "GET" && path === "") {
      const actor = await requirePermission(req,repository,"integrations.view");
      sendJson(res,200,{data:await repository.listIntegrations(actor)}); return;
    }
    if (req.method === "GET" && path === "/outbox") {
      await requirePermission(req,repository,"integrations.view");
      sendJson(res,200,{data:await repository.listOutbox(Object.fromEntries(url.searchParams))}); return;
    }
    const attempts = path.match(/^\/outbox\/([0-9]+)\/attempts$/);
    if (req.method === "GET" && attempts) {
      await requirePermission(req,repository,"integrations.view");
      sendJson(res,200,{data:await repository.listAttempts(Number(attempts[1]))}); return;
    }
    if (req.method === "POST") {
      const actor = await requirePermission(req,repository,"integrations.manage"),input = await readJson(req,100_000);
      if (path === "/connections") { sendJson(res,201,{data:await repository.createConnection(input,actor)}); return; }
      const connection = path.match(/^\/connections\/([^/]+)(?:\/(check))?$/);
      if (connection && connection[2]) { sendJson(res,200,{data:await repository.checkConnection(connection[1],input,actor)}); return; }
      if (connection) { sendJson(res,200,{data:await repository.updateConnection(connection[1],input,actor)}); return; }
      if (path === "/outbox") { sendJson(res,201,{data:await repository.enqueueManual(input,actor)}); return; }
      if (path === "/outbox/process") { sendJson(res,200,{data:await repository.processOutbox(input,actor)}); return; }
      const message = path.match(/^\/outbox\/([0-9]+)\/(retry|cancel)$/);
      if (message) { sendJson(res,200,{data:await (message[2] === "retry" ? repository.retryMessage(Number(message[1]),input,actor) : repository.cancelMessage(Number(message[1]),input,actor))}); return; }
    }
  }
  if (url.pathname === "/api/document-templates") {
    if (req.method === "GET") {
      const actor = await requireAnyPermission(req,repository,["documents.templates.manage","documents.templates.approve"]);
      sendJson(res,200,{data:await repository.listDocumentTemplates(actor)}); return;
    }
    if (req.method === "POST") {
      const actor = await requirePermission(req,repository,"documents.templates.manage");
      sendJson(res,201,{data:await repository.draftDocumentTemplate(await readJson(req),actor)}); return;
    }
  }
  const templateReview = url.pathname.match(/^\/api\/document-templates\/([^/]+)\/review$/);
  if (templateReview && req.method === "POST") {
    const actor = await requirePermission(req,repository,"documents.templates.approve");
    sendJson(res,200,{data:await repository.reviewDocumentTemplate(templateReview[1],await readJson(req),actor)}); return;
  }
  if (url.pathname === "/api/identity/staff-appointments" && req.method === "GET") {
    const actor = await requireAuthenticated(req,repository);
    sendJson(res,200,{data:await repository.listOwnStaffAppointments(actor)}); return;
  }
  const appointment = url.pathname.match(/^\/api\/identity\/staff-appointments\/([^/]+)$/);
  if (appointment && req.method === "POST") {
    const actor = await requireAuthenticated(req,repository);
    sendJson(res,200,{data:await repository.respondToStaffAppointment(appointment[1],await readJson(req),actor)}); return;
  }
  if (url.pathname.startsWith("/api/repository")) {
    const path = url.pathname.slice("/api/repository".length);
    if (req.method === "GET" && path === "") {
      const actor = await requireAuthenticated(req,repository);
      sendJson(res,200,{data:await repository.listRepository(actor,Object.fromEntries(url.searchParams))}); return;
    }
    if (req.method === "GET" && path === "/retention") {
      const actor = await requirePermission(req,repository,"repository.manage");
      sendJson(res,200,{data:await repository.retentionQueue(actor)}); return;
    }
    if (req.method === "POST" && path === "/collections") {
      const actor = await requirePermission(req,repository,"repository.manage");
      sendJson(res,201,{data:await repository.createCollection(await readJson(req),actor)}); return;
    }
    const collection = path.match(/^\/collections\/([^/]+)$/);
    if (req.method === "POST" && collection) {
      const actor = await requirePermission(req,repository,"repository.manage");
      sendJson(res,200,{data:await repository.updateCollection(collection[1],await readJson(req),actor)}); return;
    }
    if (req.method === "POST" && path === "/items") {
      const actor = await requirePermission(req,repository,"repository.contribute");
      sendJson(res,201,{data:await repository.createItem(await readJson(req,100_000),actor)}); return;
    }
    const item = path.match(/^\/items\/([^/]+)(?:\/(versions|access|withdraw|hold)(?:\/([0-9]+)\/(review))?)?$/);
    if (item) {
      const [,itemId,action,versionNumber,review] = item;
      if (req.method === "GET" && !action) {
        const actor = await requireAuthenticated(req,repository);
        sendJson(res,200,{data:await repository.getRepositoryItem(itemId,actor)}); return;
      }
      if (req.method === "POST") {
        const permission = !action ? "repository.contribute" : action === "versions" ? (review ? "repository.publish" : "repository.contribute")
          : action === "withdraw" ? "repository.publish" : action === "hold" ? "repository.manage" : null;
        if (versionNumber && action !== "versions") throw requestError(404,"Not found.");
        const actor = permission ? await requirePermission(req,repository,permission) : await requireAuthenticated(req,repository);
        const input = await readJson(req,100_000);
        const data = !action ? await repository.updateItem(itemId,input,actor)
          : action === "versions" ? (review ? await repository.reviewVersion(itemId,Number(versionNumber),input,actor) : await repository.createVersion(itemId,input,actor))
          : action === "access" ? await repository.accessItem(itemId,input,actor)
          : action === "withdraw" ? await repository.withdrawItem(itemId,input,actor) : await repository.setLegalHold(itemId,input,actor);
        sendJson(res,action === "versions" && !review ? 201 : 200,{data}); return;
      }
    }
  }
  const awardRoute = url.pathname.match(/^\/api\/registry\/(me\/)?programmes\/([^/]+)\/award(?:\/(rules|requests)(?:\/([^/]+)\/(publish|review))?)?$/);
  if (awardRoute) {
    const [,self,programmeId,kind,itemId,action] = awardRoute;
    if (req.method === "GET" && !kind) {
      const actor = await requireAnyPermission(req,repository,self ? ["registry.self"] : ["registry.view","academic.view","registry.award.request","registry.award.approve"]);
      sendJson(res,200,{data:await repository.getAward(programmeId,actor,Boolean(self))}); return;
    }
    if (!self && req.method === "POST" && kind && Boolean(itemId) === Boolean(action) && (kind === "rules" ? action !== "review" : action !== "publish")) {
      const permission = kind === "rules" ? (action ? "academic.policy.publish" : "academic.policy.manage") : (action ? "registry.award.approve" : "registry.award.request");
      const actor = await requirePermission(req,repository,permission),input = await readJson(req);
      const data = kind === "rules" ? (action ? await repository.publishCompletionRules(programmeId,itemId,input,actor) : await repository.draftCompletionRules(programmeId,input,actor))
        : action ? await repository.reviewAward(programmeId,Number(itemId),input,actor) : await repository.requestAward(programmeId,input,actor);
      sendJson(res,action ? 200 : 201,{data}); return;
    }
  }
  const transcriptRoute = url.pathname.match(/^\/api\/registry\/(me\/)?programmes\/([^/]+)\/transcripts(?:\/([^/]+)\/(revoke))?$/);
  if (transcriptRoute) {
    const [,self,programmeId,transcriptId,action] = transcriptRoute;
    if (req.method === "GET" && !transcriptId) {
      const actor = await requirePermission(req,repository,self ? "registry.self" : "results.view");
      sendJson(res,200,{data:await repository.listTranscripts(programmeId,actor,Boolean(self))}); return;
    }
    if (!self && req.method === "POST") {
      const actor = await requirePermission(req,repository,"registry.transcript.issue"),input = await readJson(req);
      sendJson(res,action ? 200 : 201,{data:action ? await repository.revokeTranscript(programmeId,transcriptId,input,actor) : await repository.issueTranscript(programmeId,input,actor)}); return;
    }
  }
  if (url.pathname === "/api/finance/fee-schedules") {
    if (req.method === "GET") {
      const actor = await requirePermission(req,repository,"finance.view");
      sendJson(res,200,{data:await repository.listFeeSchedules(Object.fromEntries(url.searchParams),actor)}); return;
    }
    if (req.method === "POST") {
      const actor = await requirePermission(req,repository,"finance.schedule.manage");
      sendJson(res,201,{data:await repository.createFeeSchedule(await readJson(req,100_000),actor)}); return;
    }
  }
  const schedulePublish = url.pathname.match(/^\/api\/finance\/fee-schedules\/([^/]+)\/publish$/);
  if (schedulePublish && req.method === "POST") {
    const actor = await requirePermission(req,repository,"finance.schedule.publish");
    sendJson(res,200,{data:await repository.publishFeeSchedule(schedulePublish[1],await readJson(req),actor)}); return;
  }
  if (url.pathname === "/api/finance/billing-runs" && req.method === "POST") {
    const actor = await requirePermission(req,repository,"finance.billing.run");
    sendJson(res,201,{data:await repository.runBilling(await readJson(req),actor)}); return;
  }
  const assessmentRoute = url.pathname.match(/^\/api\/assessment\/offerings\/([^/]+)\/([^/]+)(?:\/(plans|marks|imports|submit|orders))?$/);
  if (assessmentRoute) {
    const [,periodId,courseId,action] = assessmentRoute;
    const actor = await requireAnyPermission(req,repository,["teaching.self","assessment.marks","assessment.review","assessment.moderate","assessment.external","assessment.plan.manage","assessment.plan.approve","teaching.view","results.view"]);
    if (req.method === "GET" && !action) { sendJson(res,200,{data:await repository.getAssessment(periodId,courseId,actor)}); return; }
    if (req.method === "POST" && action === "plans") { sendJson(res,201,{data:await repository.draftAssessmentPlan(periodId,courseId,await readJson(req),actor)}); return; }
    if (req.method === "POST" && action === "orders") { sendJson(res,201,{data:await repository.submitExamOrder(periodId,courseId,await readJson(req),actor)}); return; }
    if (req.method === "PUT" && action === "marks") { sendJson(res,200,{data:await repository.saveAssessmentMarks(periodId,courseId,await readJson(req,2_000_000),actor)}); return; }
    if (req.method === "POST" && action === "imports") { sendJson(res,200,{data:await repository.importAssessmentMarks(periodId,courseId,await readJson(req,2_000_000),actor)}); return; }
    if (req.method === "POST" && action === "submit") { sendJson(res,201,{data:await repository.submitAssessmentMarks(periodId,courseId,await readJson(req),actor)}); return; }
  }
  const deferredCompletion = url.pathname.match(/^\/api\/assessment\/deferred-sittings\/([^/]+)\/completions$/);
  if (deferredCompletion && req.method === "POST") {
    const actor = await requireAnyPermission(req,repository,["teaching.self","assessment.marks"]);
    sendJson(res,201,{data:await repository.recordDeferredCompletion(deferredCompletion[1],await readJson(req,2_000_000),actor)}); return;
  }
  const deferredReview = url.pathname.match(/^\/api\/assessment\/deferred-completions\/([0-9]+)\/review$/);
  if (deferredReview && req.method === "POST") {
    const actor = await requirePermission(req,repository,"assessment.review");
    sendJson(res,200,{data:await repository.reviewDeferredCompletion(deferredReview[1],await readJson(req),actor)}); return;
  }
  const planApprove = url.pathname.match(/^\/api\/assessment\/plans\/([^/]+)\/approve$/);
  if (planApprove && req.method === "POST") {
    const actor = await requirePermission(req,repository,"assessment.plan.approve");
    sendJson(res,200,{data:await repository.approveAssessmentPlan(planApprove[1],await readJson(req),actor)}); return;
  }
  const submissionReview = url.pathname.match(/^\/api\/assessment\/submissions\/([0-9]+)\/review$/);
  if (submissionReview && req.method === "POST") {
    const actor = await requirePermission(req,repository,"assessment.review");
    sendJson(res,200,{data:await repository.reviewAssessmentSubmission(submissionReview[1],await readJson(req),actor)}); return;
  }
  const submissionModeration = url.pathname.match(/^\/api\/assessment\/submissions\/([0-9]+)\/moderation$/);
  if (submissionModeration && req.method === "POST") {
    const actor = await requireAnyPermission(req,repository,["assessment.moderate","assessment.external"]);
    sendJson(res,201,{data:await repository.moderateAssessmentSubmission(submissionModeration[1],await readJson(req),actor)}); return;
  }
  const amendmentRoute = url.pathname.match(/^\/api\/registry\/programmes\/([^/]+)\/results\/([^/]+)\/amendments(?:\/([0-9]+)\/review)?$/);
  if (amendmentRoute) {
    const [,programmeId,periodId,amendmentId] = amendmentRoute;
    if (req.method === "GET" && !amendmentId) {
      const actor = await requirePermission(req,repository,"results.view");
      sendJson(res,200,{data:await repository.listResultAmendments(programmeId,periodId,actor)}); return;
    }
    if (req.method === "POST") {
      const actor = await requirePermission(req,repository,amendmentId ? "results.amend.approve" : "results.amend.request"),input = await readJson(req);
      sendJson(res,amendmentId ? 200 : 201,{data:amendmentId ? await repository.reviewResultAmendment(programmeId,periodId,amendmentId,input,actor) : await repository.requestResultAmendment(programmeId,periodId,input,actor)}); return;
    }
  }
  if (url.pathname === "/api/lms/v1/manifest" && req.method === "GET") {
    const actor = await requirePermission(req,repository,"lms.sync");
    sendJson(res,200,{data:await repository.lmsManifest(actor,Object.fromEntries(url.searchParams))}); return;
  }
  if (url.pathname === "/api/lms/v1/outcomes" && req.method === "POST") {
    const actor = await requirePermission(req,repository,"lms.sync");
    sendJson(res,201,{data:await repository.receiveLmsOutcomes(await readJson(req,1_000_000),actor)}); return;
  }
  if (url.pathname === "/api/lms/outcomes" && req.method === "GET") {
    const actor = await requirePermission(req,repository,"lms.outcomes.review");
    sendJson(res,200,{data:await repository.listLmsOutcomes(actor)}); return;
  }
  const lmsReview = url.pathname.match(/^\/api\/lms\/outcomes\/([0-9]+)\/review$/);
  if (lmsReview && req.method === "POST") {
    const actor = await requirePermission(req,repository,"lms.outcomes.review");
    sendJson(res,200,{data:await repository.reviewLmsOutcomes(lmsReview[1],await readJson(req),actor)}); return;
  }
  const lmsTransfer = url.pathname.match(/^\/api\/lms\/periods\/([^/]+)\/transfer$/);
  if (lmsTransfer && req.method === "POST") {
    const actor = await requirePermission(req,repository,"lms.outcomes.review");
    sendJson(res,201,{data:await repository.transferLmsOutcomes(lmsTransfer[1],await readJson(req),actor)}); return;
  }
  if (url.pathname === "/api/teaching/overview" && req.method === "GET") {
    const actor = await requirePermission(req,repository,"teaching.view");
    sendJson(res,200,{data:await repository.teachingOverview(actor)}); return;
  }
  if (url.pathname === "/api/teaching/me" && req.method === "GET") {
    const actor = await requirePermission(req,repository,"teaching.self");
    sendJson(res,200,{data:await repository.myTeaching(actor)}); return;
  }
  const teachingPeriod = url.pathname.match(/^\/api\/teaching\/periods\/([^/]+)(\/allocations)?$/);
  if (teachingPeriod) {
    const [,periodId,allocations] = teachingPeriod;
    if (req.method === "GET" && !allocations) {
      const actor = await requirePermission(req,repository,"teaching.view");
      sendJson(res,200,{data:await repository.getPeriodTeaching(periodId,actor)}); return;
    }
    if (req.method === "POST" && allocations) {
      const actor = await requirePermission(req,repository,"teaching.allocate");
      sendJson(res,201,{data:await repository.proposeAllocation(periodId,await readJson(req),actor)}); return;
    }
  }
  const allocationRoute = url.pathname.match(/^\/api\/teaching\/allocations\/([0-9]+)\/(review|end|class-list)$/);
  if (allocationRoute) {
    const [,allocationId,action] = allocationRoute;
    if (action === "class-list" && req.method === "GET") {
      let actor;
      try { actor = await requirePermission(req,repository,"teaching.self"); } catch (error) { if (error.statusCode !== 403) throw error; actor = await requirePermission(req,repository,"teaching.view"); }
      sendJson(res,200,{data:await repository.allocationClassList(allocationId,actor)}); return;
    }
    if (req.method === "POST" && action !== "class-list") {
      const actor = await requirePermission(req,repository,action === "review" ? "teaching.approve" : "teaching.allocate"),input = await readJson(req);
      sendJson(res,200,{data:action === "review" ? await repository.reviewAllocation(allocationId,input,actor) : await repository.endAllocation(allocationId,input,actor)}); return;
    }
  }
  if (/^\/api\/(?:cashbooks|cashbook-policies|cashbook-periods)(?:\/|$)/.test(url.pathname)) {
    const actor=await requireAnyPermission(req,repository,['cashbook.view','cashbook.manage','cashbook.approve','cashbook.policy.manage','cashbook.policy.approve']);
    res.setHeader('Cache-Control','no-store');
    if([...url.searchParams.keys()].some(key=>url.searchParams.getAll(key).length!==1) || req.method!=='GET' && url.search)throw requestError(400,'Invalid cashbook query parameters.');
    const filters=Object.fromEntries(url.searchParams);
    const report=url.pathname.match(/^\/api\/cashbooks\/([^/]+)\/reports$/);
    if(report && req.method==='GET'){sendJson(res,200,{data:await repository.cashbookReport(report[1],filters,actor)});return;}
    if(url.pathname==='/api/cashbooks' && req.method==='GET'){sendJson(res,200,{data:await repository.cashbookWorkspace(filters,actor)});return;}
    if(url.pathname==='/api/cashbooks' && req.method==='POST'){sendJson(res,201,{data:await repository.createCashbook(await readJson(req,65536),actor)});return;}
    if(url.pathname==='/api/cashbook-policies' && req.method==='POST'){sendJson(res,201,{data:await repository.createCashbookPolicy(await readJson(req,65536),actor)});return;}
    const policy=url.pathname.match(/^\/api\/cashbook-policies\/([^/]+)$/);
    if(policy && req.method==='PUT'){sendJson(res,200,{data:await repository.changeCashbookPolicy(policy[1],await readJson(req,65536),actor)});return;}
    const book=url.pathname.match(/^\/api\/cashbooks\/([^/]+)(?:\/(accounts|movements|periods))?$/);
    if(book && req.method==='GET' && !book[2]){sendJson(res,200,{data:await repository.getCashbook(book[1],filters,actor)});return;}
    if(book && req.method==='POST' && book[2]){const operations={accounts:'createCashbookAccount',movements:'recordCashbookMovement',periods:'createCashbookPeriod'};sendJson(res,201,{data:await repository[operations[book[2]]](book[1],await readJson(req,65536),actor)});return;}
    const period=url.pathname.match(/^\/api\/cashbook-periods\/([^/]+)(?:\/(capture|close))?$/);
    if(period && req.method==='GET' && !period[2]){sendJson(res,200,{data:await repository.getCashbookPeriod(period[1],filters,actor)});return;}
    if(period && req.method==='POST' && period[2]){sendJson(res,200,{data:await repository[period[2]==='capture' ? 'captureCashbookPeriod' : 'closeCashbookPeriod'](period[1],await readJson(req,65536),actor)});return;}
    throw requestError(404,'Cashbook route was not found.');
  }
  if(url.pathname==='/api/fleet' || url.pathname.startsWith('/api/fleet/')){
    const actor=await requireAnyPermission(req,repository,['fleet.view','fleet.manage','fleet.approve','fleet.incidents']);
    res.setHeader('Cache-Control','no-store');
    if([...url.searchParams.keys()].some(key=>url.searchParams.getAll(key).length!==1) || req.method!=='GET' && url.search)throw requestError(400,'Invalid fleet query parameters.');
    const filters=Object.fromEntries(url.searchParams);
    if(url.pathname==='/api/fleet' && req.method==='GET'){sendJson(res,200,{data:await repository.fleetWorkspace(filters,actor)});return;}
    if(url.pathname==='/api/fleet/references' && req.method==='GET'){sendJson(res,200,{data:await repository.fleetReferences(filters,actor)});return;}
    const collection=url.pathname.match(/^\/api\/fleet\/(vehicles|drivers|trips|fuel|service|incidents)$/);
    if(collection && req.method==='GET'){sendJson(res,200,{data:await repository.fleetList(collection[1],filters,actor)});return;}
    if(collection && req.method==='POST'){
      const method={vehicles:'registerFleetVehicle',drivers:'requestFleetDriver',trips:'requestFleetTrip',fuel:'recordFleetFuel',incidents:'recordFleetIncident'}[collection[1]];
      if(method){sendJson(res,201,{data:await repository[method](await readJson(req,65536),actor)});return;}
    }
    const operation=url.pathname.match(/^\/api\/fleet\/(drivers|authorisations|trips|vehicles|vehicle-corrections|meter-changes|reading-corrections|fuel|incidents)\/([^/]+)(?:\/(decision|revoke|events|service|reverse|resolve|corrections|meters|readings))?$/);
    if(operation){
      const [,kind,id,action]=operation;
      if(req.method==='GET' && kind==='incidents' && !action){sendJson(res,200,{data:await repository.getFleetIncident(id,filters,actor)});return;}
      if(req.method==='GET' && kind==='trips' && action==='events'){sendJson(res,200,{data:await repository.fleetTripHistory(id,filters,actor)});return;}
      if(req.method==='GET' && kind==='vehicles' && action==='corrections'){sendJson(res,200,{data:await repository.fleetVehicleCorrections(id,filters,actor)});return;}
      if(req.method==='POST' && kind==='vehicles' && action==='corrections'){sendJson(res,201,{data:await repository.requestFleetVehicleCorrection(id,await readJson(req,65536),actor)});return;}
      if(req.method==='POST' && kind==='vehicle-corrections' && action==='decision'){sendJson(res,200,{data:await repository.decideFleetVehicleCorrection(id,await readJson(req,65536),actor)});return;}
      if(req.method==='GET' && kind==='vehicles' && action==='meters'){sendJson(res,200,{data:await repository.fleetMeters(id,filters,actor)});return;}
      if(req.method==='POST' && kind==='vehicles' && ['meters','readings'].includes(action)){sendJson(res,201,{data:await repository[action==='meters'?'requestFleetMeterChange':'requestFleetReadingCorrection'](id,await readJson(req,65536),actor)});return;}
      if(req.method==='POST' && ['meter-changes','reading-corrections'].includes(kind) && action==='decision'){sendJson(res,200,{data:await repository[kind==='meter-changes'?'decideFleetMeterChange':'decideFleetReadingCorrection'](id,await readJson(req,65536),actor)});return;}
      const method={ 'drivers:decision':'decideFleetDriver','authorisations:revoke':'revokeFleetDriver','trips:events':'recordFleetTripEvent','vehicles:service':'recordFleetService','fuel:reverse':'reverseFleetFuel','incidents:resolve':'resolveFleetIncident'}[`${kind}:${action}`];
      if(req.method==='POST' && method){sendJson(res,200,{data:await repository[method](id,await readJson(req,65536),actor)});return;}
    }
    throw requestError(404,'Fleet route was not found.');
  }
  if (url.pathname === "/api/assets/reports" && req.method === 'GET') {
    const actor=await requireAnyPermission(req,repository,['assets.view','assets.manage','assets.approve']);
    if ([...url.searchParams.keys()].some(key=>url.searchParams.getAll(key).length!==1)) throw requestError(400,'Duplicate asset report filters.');
    res.setHeader('Cache-Control','no-store');
    sendJson(res,200,{data:await repository.assetReport(Object.fromEntries(url.searchParams),actor)});return;
  }
  if (url.pathname === "/api/assets") {
    if (req.method === "GET") {const actor=await requireAnyPermission(req,repository,["assets.view","assets.manage","assets.approve"]);sendJson(res,200,{data:await repository.assetWorkspace(Object.fromEntries(url.searchParams),actor)});return;}
    if (req.method === "POST") {const actor=await requirePermission(req,repository,"assets.manage");sendJson(res,201,{data:await repository.registerInstitutionAsset(await readJson(req),actor)});return;}
  }
  const assetRoute=url.pathname.match(/^\/api\/assets\/([^/]+)(?:\/(allocate|return|check|dispose|review|copy))?$/);
  if (assetRoute) {
    const [,id,action]=assetRoute;
    if (req.method === "GET" && !action) {const actor=await requireAnyPermission(req,repository,["assets.view","assets.manage","assets.approve"]);sendJson(res,200,{data:await repository.getInstitutionAsset(id,Object.fromEntries(url.searchParams),actor)});return;}
    if (req.method === "PUT" && !action) {const actor=await requirePermission(req,repository,"assets.manage");sendJson(res,200,{data:await repository.editInstitutionAsset(id,await readJson(req),actor)});return;}
    if (req.method === "POST" && action) {const actor=await requirePermission(req,repository,action==='review' ? 'assets.approve' : 'assets.manage');const input=await readJson(req);sendJson(res,action==='copy' ? 201 : 200,{data:action==='copy' ? await repository.copyInstitutionAssets(id,input,actor) : await repository.recordAssetAction(id,action,input,actor)});return;}
  }
  if (url.pathname === "/api/staff-leave") {
    const actor = await requireAnyPermission(req,repository,["leave.self","leave.manage"]);
    if (req.method === "GET") {sendJson(res,200,{data:await repository.leaveWorkspace(Object.fromEntries(url.searchParams),actor)});return;}
    if (req.method === "POST") {sendJson(res,201,{data:await repository.requestStaffLeave(await readJson(req),actor)});return;}
  }
  if (url.pathname === "/api/staff-leave/categories" && req.method === "POST") {
    const actor = await requirePermission(req,repository,"leave.manage");
    sendJson(res,201,{data:await repository.createLeaveCategory(await readJson(req),actor)});return;
  }
  const leaveCategory = url.pathname.match(/^\/api\/staff-leave\/categories\/([A-Z][A-Z0-9_]{1,39})$/);
  if (leaveCategory && req.method === "PUT") {
    const actor = await requirePermission(req,repository,"leave.manage");
    sendJson(res,200,{data:await repository.setLeaveCategoryActive(leaveCategory[1],await readJson(req),actor)});return;
  }
  if (url.pathname === "/api/staff-leave/balances") {
    const actor = await requireAnyPermission(req,repository,["leave.self","leave.manage"]);
    if (req.method === "GET") {sendJson(res,200,{data:await repository.getLeaveBalance(url.searchParams.get("staffId"),url.searchParams.get("categoryCode"),Number(url.searchParams.get("year")),actor)});return;}
    if (req.method === "POST") {sendJson(res,201,{data:await repository.adjustLeaveBalance(await readJson(req),actor)});return;}
  }
  const leaveRequest = url.pathname.match(/^\/api\/staff-leave\/requests\/([^/]+)(?:\/(recommend|approve|deny|cancel|reverse))?$/);
  if (leaveRequest) {
    const actor = await requireAnyPermission(req,repository,["leave.self","leave.manage"]);
    if (req.method === "GET" && !leaveRequest[2]) {sendJson(res,200,{data:await repository.getStaffLeave(leaveRequest[1],actor)});return;}
    if (req.method === "POST" && leaveRequest[2]) {sendJson(res,200,{data:await repository.decideStaffLeave(leaveRequest[1],leaveRequest[2],await readJson(req),actor)});return;}
  }
  if (url.pathname === "/api/staff") {
    if (req.method === "GET") {
      const actor = await requirePermission(req,repository,"staff.view");
      sendJson(res,200,{data:await repository.listStaff(Object.fromEntries(url.searchParams),actor)}); return;
    }
    if (req.method === "POST") {
      const actor = await requirePermission(req,repository,"staff.manage");
      sendJson(res,201,{data:await repository.createStaffMember(await readJson(req),actor)}); return;
    }
  }
  const staffRoute = url.pathname.match(/^\/api\/staff\/([^/]+)(?:\/(employment|status))?$/);
  if (staffRoute) {
    const [,staffId,action] = staffRoute;
    if (req.method === "GET" && !action) {
      await requirePermission(req,repository,"staff.view");
      sendJson(res,200,{data:await repository.getStaffMember(staffId)}); return;
    }
    if (req.method === "POST" && action) {
      const actor = await requirePermission(req,repository,"staff.manage"),input = await readJson(req);
      sendJson(res,200,{data:action === "employment" ? await repository.changeStaffEmployment(staffId,input,actor) : await repository.changeStaffStatus(staffId,input,actor)}); return;
    }
  }
  if (url.pathname === "/api/finance/opening-balances" && req.method === "POST") {
    const actor = await requirePermission(req,repository,"finance.migrate");
    sendJson(res,200,{data:await repository.importOpeningBalances(await readJson(req,5_000_000),actor)}); return;
  }
  if (url.pathname === "/api/finance/reports/control-totals" && req.method === "GET") {
    const actor = await requirePermission(req,repository,"finance.view");
    sendJson(res,200,{data:await repository.financeControlTotals(Object.fromEntries(url.searchParams),actor)}); return;
  }
  if (url.pathname === "/api/finance/reports/control-totals/dictionary" && req.method === "GET") {
    const actor = await requirePermission(req,repository,"finance.view");
    sendJson(res,200,{data:await repository.financeMetricDictionary(actor)}); return;
  }
  if (url.pathname === "/api/finance/payment-imports") {
    if (req.method === "GET") {
      const actor = await requirePermission(req,repository,"finance.import");
      sendJson(res,200,{data:await repository.listPaymentImports(actor)}); return;
    }
    if (req.method === "POST") {
      const actor = await requirePermission(req,repository,"finance.import");
      sendJson(res,201,{data:await repository.importPaymentStatement(await readJson(req,2_000_000),actor)}); return;
    }
  }
  const importLine = url.pathname.match(/^\/api\/finance\/payment-imports\/lines\/([0-9]+)\/resolve$/);
  if (importLine && req.method === "POST") {
    const actor = await requirePermission(req,repository,"finance.import");
    sendJson(res,200,{data:await repository.resolvePaymentImportLine(importLine[1],await readJson(req),actor)}); return;
  }
  const adjustmentRoute = url.pathname.match(/^\/api\/registry\/(me\/)?programmes\/([^/]+)\/adjustments(?:\/([0-9]+)\/review)?$/);
  if (adjustmentRoute) {
    const [,self,programmeId,adjustmentId] = adjustmentRoute;
    if (req.method === "GET" && !adjustmentId) {
      const actor = await requirePermission(req,repository,self ? "registry.self" : "finance.view");
      sendJson(res,200,{data:await repository.listFinanceAdjustments(programmeId,actor,Boolean(self))}); return;
    }
    if (req.method === "POST" && !self) {
      const actor = await requirePermission(req,repository,adjustmentId ? "finance.adjustment.approve" : "finance.adjustment.request"),input = await readJson(req,100_000);
      sendJson(res,adjustmentId ? 200 : 201,{data:adjustmentId ? await repository.reviewFinanceAdjustment(programmeId,adjustmentId,input,actor) : await repository.requestFinanceAdjustment(programmeId,input,actor)}); return;
    }
  }
  const accountRoute = url.pathname.match(/^\/api\/registry\/(me\/)?programmes\/([^/]+)\/(account|payments)$/);
  if (accountRoute) {
    const [,self,programmeId,resource] = accountRoute;
    if (resource === "account" && req.method === "GET") {
      const actor = await requirePermission(req,repository,self ? "registry.self" : "finance.view");
      sendJson(res,200,{data:await repository.getStudentAccount(programmeId,actor,Boolean(self))}); return;
    }
    if (resource === "payments" && !self && req.method === "POST") {
      const actor = await requirePermission(req,repository,"finance.payment.record");
      sendJson(res,201,{data:await repository.recordStudentPayment(programmeId,await readJson(req),actor)}); return;
    }
  }
  const duplicateRoute = url.pathname.match(/^\/api\/registry\/programmes\/([^/]+)\/duplicates(?:\/([0-9]+)\/review)?$/);
  if (duplicateRoute) {
    const [,programmeId,caseId] = duplicateRoute;
    if (req.method === "GET" && !caseId) {
      const actor = await requirePermission(req,repository,"registry.view");
      sendJson(res,200,{data:await repository.getDuplicateContext(programmeId,Object.fromEntries(url.searchParams),actor)}); return;
    }
    if (req.method === "POST") {
      const actor = await requirePermission(req,repository,`registry.duplicate.${caseId ? "approve" : "request"}`),input = await readJson(req,100_000);
      sendJson(res,caseId ? 200 : 201,{data:caseId ? await repository.reviewDuplicateResolution(programmeId,caseId,input,actor) : await repository.requestDuplicateResolution(programmeId,input,actor)}); return;
    }
  }
  const identityRoute = url.pathname.match(/^\/api\/registry\/(?:me|programmes\/([^/]+))\/identity(?:\/([0-9]+)\/review)?$/);
  if (identityRoute) {
    const [,programmeId,requestId] = identityRoute;
    if (req.method === "GET" && !requestId) {
      const actor = await requirePermission(req,repository,programmeId ? "registry.view" : "registry.self");
      sendJson(res,200,{data:programmeId ? await repository.getStudentIdentity(programmeId,actor) : await repository.getOwnIdentity(actor)}); return;
    }
    if (req.method === "POST" && (programmeId || !requestId)) {
      const actor = await requirePermission(req,repository,programmeId ? `registry.identity.${requestId ? "approve" : "request"}` : "registry.self"),input = await readJson(req,100_000);
      const data = !programmeId ? await repository.requestOwnIdentityCorrection(input,actor)
        : requestId ? await repository.reviewStudentIdentityCorrection(programmeId,requestId,input,actor) : await repository.requestStudentIdentityCorrection(programmeId,input,actor);
      sendJson(res,requestId ? 200 : 201,{data}); return;
    }
  }
  const transferRoute = url.pathname.match(/^\/api\/registry\/(me\/)?programmes\/([^/]+)\/transfers(?:\/([0-9]+)\/review)?$/);
  if (transferRoute) {
    const [,self,programmeId,requestId] = transferRoute;
    if (req.method === "GET" && !requestId) {
      const actor = await requirePermission(req,repository,self ? "registry.self" : "registry.view");
      sendJson(res,200,{data:await repository.getProgrammeTransfers(programmeId,actor,Boolean(self))}); return;
    }
    if (!self && req.method === "POST") {
      const actor = await requirePermission(req,repository,`registry.transfer.${requestId ? "approve" : "request"}`),input = await readJson(req,100_000);
      sendJson(res,requestId ? 200 : 201,{data:requestId ? await repository.reviewProgrammeTransfer(programmeId,requestId,input,actor) : await repository.requestProgrammeTransfer(programmeId,input,actor)}); return;
    }
  }
  const creditRoute = url.pathname.match(/^\/api\/registry\/(me\/)?programmes\/([^/]+)\/credits(?:\/([0-9]+)\/review)?$/);
  if (creditRoute) {
    const [,self,programmeId,recognitionId] = creditRoute;
    if (req.method === "GET" && !recognitionId) {
      const actor = await requirePermission(req,repository,self ? "registry.self" : "registry.view");
      sendJson(res,200,{data:await repository.getCreditRecognitionContext(programmeId,actor,Boolean(self))}); return;
    }
    if (req.method === "POST" && !self) {
      const actor = await requirePermission(req,repository,`registry.credit.${recognitionId ? "approve" : "request"}`),input = await readJson(req,100_000);
      sendJson(res,recognitionId ? 200 : 201,{data:recognitionId ? await repository.reviewCreditRecognition(programmeId,recognitionId,input,actor) : await repository.requestCreditRecognition(programmeId,input,actor)}); return;
    }
  }
  const lifecycleRoute = url.pathname.match(/^\/api\/registry\/(me\/)?programmes\/([^/]+)\/lifecycle(?:\/([0-9]+)\/review)?$/);
  if (lifecycleRoute) {
    const [,self,programmeId,requestId] = lifecycleRoute;
    if (req.method === "GET" && !requestId) {
      const actor = await requirePermission(req,repository,self ? "registry.self" : "registry.view");
      sendJson(res,200,{data:await repository.getProgrammeLifecycle(programmeId,actor,Boolean(self))}); return;
    }
    if (req.method === "POST" && !self) {
      const actor = await requirePermission(req,repository,`registry.lifecycle.${requestId ? "approve" : "request"}`),input = await readJson(req,100_000);
      sendJson(res,requestId ? 200 : 201,{data:requestId ? await repository.reviewProgrammeLifecycle(programmeId,requestId,input,actor) : await repository.requestProgrammeLifecycle(programmeId,input,actor)}); return;
    }
  }
  const academicRoutes = url.pathname.match(/^\/api\/registry\/(me\/)?programmes\/([^/]+)\/academic(?:\/(policies)(?:\/([^/]+)\/(publish))?|\/([^/]+)\/decisions(?:\/([^/]+)\/(review))?)?$/);
  if (academicRoutes) {
    const [,self,programmeId,policies,policyId,publish,periodId,decisionId,review] = academicRoutes;
    if (req.method === "GET" && !policies && !periodId) {
      const actor = await requirePermission(req,repository,self ? "registry.self" : "academic.view");
      sendJson(res,200,{data:await repository.listAcademicContext(programmeId,actor,Boolean(self))}); return;
    }
    if (!self && req.method === "POST" && (policies || periodId)) {
      const permission = policies ? `academic.policy.${publish ? "publish" : "manage"}` : `academic.${review ? "approve" : "request"}`;
      const actor = await requirePermission(req,repository,permission),input = await readJson(req,100_000);
      const data = policies ? publish ? await repository.publishAcademicPolicy(programmeId,policyId,input,actor) : await repository.createAcademicPolicy(programmeId,input,actor)
        : review ? await repository.reviewAcademicDecision(programmeId,periodId,decisionId,input,actor) : await repository.requestAcademicDecision(programmeId,periodId,input,actor);
      sendJson(res,publish || review ? 200 : 201,{data}); return;
    }
  }
  const resultRoutes = url.pathname.match(/^\/api\/registry\/(me\/)?programmes\/([^/]+)\/results(?:\/([^/]+)\/batches(?:\/([^/]+)\/(review|publish))?)?$/);
  if (resultRoutes) {
    const [,self,programmeId,periodId,batchId,action] = resultRoutes;
    if (req.method === "GET" && !periodId) {
      const actor = await requirePermission(req,repository,self ? "registry.self" : "results.view");
      sendJson(res,200,{data:await repository.listProgrammeResults(programmeId,actor,Boolean(self))});
      return;
    }
    if (!self && req.method === "POST" && periodId) {
      const actor = await requirePermission(req,repository,`results.${action || "import"}`);
      const input = await readJson(req,2_000_000);
      const data = action === "review" ? await repository.reviewResultBatch(programmeId,periodId,batchId,input,actor)
        : action === "publish" ? await repository.publishResultBatch(programmeId,periodId,batchId,input,actor)
        : await repository.importResultBatch(programmeId,periodId,input,actor);
      sendJson(res,action ? 200 : 201,{data});
      return;
    }
  }
  const exceptionRoute = url.pathname.match(/^\/api\/registry\/programmes\/([^/]+)\/registrations\/([^/]+)\/exceptions(?:\/([0-9]+)\/review)?$/);
  if (exceptionRoute && req.method === "POST") {
    const [,programmeId,periodId,exceptionId] = exceptionRoute;
    const actor = await requirePermission(req,repository,exceptionId ? "registry.exception.approve" : "registry.exception.request");
    const input = await readJson(req);
    sendJson(res,exceptionId ? 200 : 201,{data:exceptionId ? await repository.reviewRegistrationException(programmeId,periodId,exceptionId,input,actor) : await repository.requestRegistrationException(programmeId,periodId,input,actor)});
    return;
  }
  const registrationRoutes = url.pathname.match(/^\/api\/registry\/(me\/)?programmes\/([^/]+)\/(registrations|registration-periods)(?:\/([^/]+)(?:\/(confirm|checks))?)?$/);
  if (registrationRoutes) {
    const [, self, programmeId, resource, periodId, action] = registrationRoutes;
    if (resource === "registrations" && !periodId && req.method === "GET") {
      const actor = await requirePermission(req, repository, self ? "registry.self" : "registry.view");
      sendJson(res, 200, { data: await repository.listProgrammeRegistrations(programmeId, actor, Boolean(self)) });
      return;
    }
    if (!self && resource === "registration-periods" && req.method === "POST" && !action) {
      const actor = await requirePermission(req, repository, "registry.registration.configure");
      const input = await readJson(req);
      sendJson(res, periodId ? 200 : 201, { data: periodId ? await repository.configureRegistrationPeriod(programmeId, periodId, input, actor) : await repository.createRegistrationPeriod(programmeId, input, actor) });
      return;
    }
    if (self && resource === "registrations" && periodId && ((req.method === "PUT" && !action) || (req.method === "POST" && action === "confirm"))) {
      const actor = await requirePermission(req, repository, "registry.self");
      const input = await readJson(req);
      sendJson(res, 200, { data: action ? await repository.confirmCourseRegistration(programmeId, periodId, input, actor) : await repository.saveCourseSelection(programmeId, periodId, input, actor) });
      return;
    }
    if (!self && resource === "registrations" && periodId && req.method === "POST" && action === "checks") {
      const input = await readJson(req);
      if (!["academic", "financial"].includes(input.checkType)) throw requestError(400, "Select academic or financial clearance.");
      const actor = await requirePermission(req, repository, `registry.registration.${input.checkType}`);
      sendJson(res, 201, { data: await repository.recordRegistrationCheck(programmeId, periodId, input, actor) });
      return;
    }
  }
  if (url.pathname === "/api/registry/me" && ["GET", "PUT"].includes(req.method)) {
    const actor = await requirePermission(req, repository, "registry.self");
    sendJson(res, 200, { data: req.method === "GET" ? await repository.getOwnStudent(actor) : await repository.saveStudentProfile(await readJson(req), actor) });
    return;
  }
  if (url.pathname === "/api/registry/students" && req.method === "GET") {
    const actor = await requirePermission(req, repository, "registry.view");
    sendJson(res, 200, { data: await repository.listRegistryStudents(Object.fromEntries(url.searchParams), actor) });
    return;
  }
  const registryProgramme = url.pathname.match(/^\/api\/registry\/programmes\/([^/]+)(?:\/(approve))?$/);
  if (registryProgramme && ((req.method === "GET" && !registryProgramme[2]) || (req.method === "POST" && registryProgramme[2]))) {
    const actor = await requirePermission(req, repository, req.method === "GET" ? "registry.view" : "registry.onboard");
    sendJson(res, 200, { data: req.method === "GET" ? await repository.getRegistryProgramme(registryProgramme[1], actor) : await repository.approveStudentOnboarding(registryProgramme[1], await readJson(req), actor) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    const database = await repository.health();
    sendJson(res, 200, {
      status: "ok",
      app: config.appName,
      env: config.env,
      checkedAt: new Date().toISOString(),
      database: {
        status: "ok",
        checkedAt: database.checked_at
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/foundation/status") {
    sendJson(res, 200, await repository.foundationStatus());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/audit/events") {
    await requirePermission(req, repository, "audit.view");
    sendJson(res, 200, {
      data: await repository.listAuditEvents({
        actorId: url.searchParams.get("actorId"),
        action: url.searchParams.get("action"),
        subjectType: url.searchParams.get("subjectType"),
        subjectId: url.searchParams.get("subjectId"),
        occurredFrom: url.searchParams.get("occurredFrom"),
        occurredTo: url.searchParams.get("occurredTo"),
        limit: url.searchParams.get("limit")
      })
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/master-data/programmes") {
    sendJson(res, 200, { data: await repository.listProgrammes() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/master-data/programmes") {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    const programme = await repository.createProgramme(body, actor);
    sendJson(res, 201, { data: programme });
    return;
  }

  const programmeEdit = url.pathname.match(/^\/api\/master-data\/programmes\/([^/]+)$/);
  if (req.method === 'PATCH' && programmeEdit) {
    const actor = await requirePermission(req, repository, 'master_data.publish');
    sendJson(res, 200, {data:await repository.updateProgramme(programmeEdit[1], await readJson(req), actor)});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/master-data/organization-units") {
    sendJson(res, 200, {
      data: await repository.listOrganizationUnits({
        unitType: url.searchParams.get("unitType"),
        status: url.searchParams.get("status")
      })
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/master-data/organization-units") {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 201, { data: await repository.createOrganizationUnit(body, actor) });
    return;
  }

  const unitMatch = url.pathname.match(/^\/api\/master-data\/organization-units\/([^/]+)(?:\/(history|deactivate|reactivate))?$/);
  if (unitMatch) {
    const [, unitId, action] = unitMatch;
    if (req.method === "GET" && action === "history") {
      sendJson(res, 200, { data: await repository.listOrganizationUnitHistory(unitId) });
      return;
    }
    if (req.method === "PATCH" && !action) {
      const actor = await requirePermission(req, repository, "master_data.publish");
      const body = await readJson(req);
      sendJson(res, 200, { data: await repository.updateOrganizationUnit(unitId, body, actor) });
      return;
    }
    if (req.method === "POST" && action === "deactivate") {
      const actor = await requirePermission(req, repository, "master_data.publish");
      const body = await readJson(req);
      sendJson(res, 200, { data: await repository.deactivateOrganizationUnit(unitId, body, actor) });
      return;
    }
    if (req.method === "POST" && action === "reactivate") {
      const actor = await requirePermission(req, repository, "master_data.publish");
      const body = await readJson(req);
      sendJson(res, 200, { data: await repository.reactivateOrganizationUnit(unitId, body, actor) });
      return;
    }
  }

  const programmeVersionsMatch = url.pathname.match(/^\/api\/master-data\/programmes\/([^/]+)\/versions$/);
  if (req.method === "GET" && programmeVersionsMatch) {
    sendJson(res, 200, await repository.listProgrammeVersions(programmeVersionsMatch[1], url.searchParams.get("asOf")));
    return;
  }

  if (req.method === "POST" && programmeVersionsMatch) {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 201, { data: await repository.createProgrammeVersion(programmeVersionsMatch[1], body, actor) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/master-data/courses") {
    sendJson(res, 200, {
      data: await repository.listCourses({
        departmentId: url.searchParams.get("departmentId"),
        status: url.searchParams.get("status")
      })
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/master-data/courses") {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 201, { data: await repository.createCourse(body, actor) });
    return;
  }

  const courseMatch = url.pathname.match(/^\/api\/master-data\/courses\/([^/]+)(?:\/(retire|prerequisites))?$/);
  const courseHandlers = {
    PATCH: "updateCourse",
    "POST retire": "retireCourse",
    "PUT prerequisites": "setCoursePrerequisites"
  };
  const courseRoute = courseMatch && courseHandlers[`${req.method} ${courseMatch[2] || ""}`.trim()];
  if (courseRoute) {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 200, { data: await repository[courseRoute](courseMatch[1], body, actor) });
    return;
  }

  const curriculumMatch = url.pathname.match(/^\/api\/master-data\/programme-versions\/([^/]+)\/curriculum(?:\/([^/]+))?$/);
  if (curriculumMatch && req.method === "GET" && !curriculumMatch[2]) {
    sendJson(res, 200, { data: await repository.getCurriculum(curriculumMatch[1]) });
    return;
  }

  if (curriculumMatch && req.method === "POST" && !curriculumMatch[2]) {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 201, { data: await repository.addCurriculumEntry(curriculumMatch[1], body, actor) });
    return;
  }

  if (curriculumMatch && req.method === "DELETE" && curriculumMatch[2]) {
    const actor = await requirePermission(req, repository, "master_data.publish");
    sendJson(res, 200, { data: await repository.removeCurriculumEntry(curriculumMatch[1], curriculumMatch[2], actor) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/master-data/grading-schemes") {
    sendJson(res, 200, { data: await repository.listGradingSchemes() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/master-data/grading-schemes") {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 201, { data: await repository.createGradingScheme(body, actor) });
    return;
  }

  const schemeActionMatch = url.pathname.match(/^\/api\/master-data\/grading-schemes\/([^/]+)\/(publish|retire)$/);
  if (req.method === "POST" && schemeActionMatch) {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    const [, schemeId, action] = schemeActionMatch;
    const scheme = action === "publish"
      ? await repository.publishGradingScheme(schemeId, body, actor)
      : await repository.retireGradingScheme(schemeId, body, actor);
    sendJson(res, 200, { data: scheme });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/master-data/gpa-rule-sets") {
    sendJson(res, 200, { data: await repository.listGpaRuleSets() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/master-data/gpa-rule-sets") {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 201, { data: await repository.createGpaRuleSet(body, actor) });
    return;
  }

  const ruleSetActionMatch = url.pathname.match(/^\/api\/master-data\/gpa-rule-sets\/([^/]+)\/(publish|retire|calculate)$/);
  if (req.method === "POST" && ruleSetActionMatch) {
    const [, ruleSetId, action] = ruleSetActionMatch;
    if (action === "calculate") {
      await requireAuthenticated(req, repository);
      sendJson(res, 200, { data: await repository.calculateGpaPreview(ruleSetId, await readJson(req)) });
      return;
    }
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    const ruleSet = action === "publish"
      ? await repository.publishGpaRuleSet(ruleSetId, body, actor)
      : await repository.retireGpaRuleSet(ruleSetId, body, actor);
    sendJson(res, 200, { data: ruleSet });
    return;
  }

  const programmeRequirements=url.pathname.match(/^\/api\/master-data\/programme-versions\/([^/]+)\/requirements$/);
  if (req.method==='PUT' && programmeRequirements) {
    const actor=await requirePermission(req,repository,'master_data.publish');
    sendJson(res,200,{data:await repository.updateProgrammeRequirements(programmeRequirements[1],await readJson(req),actor)});return;
  }
  const versionActionMatch = url.pathname.match(/^\/api\/master-data\/programme-versions\/([^/]+)\/(publish|retire)$/);
  if (req.method === "POST" && versionActionMatch) {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    const [, versionId, action] = versionActionMatch;
    const version = action === "publish"
      ? await repository.publishProgrammeVersion(versionId, body, actor)
      : await repository.retireProgrammeVersion(versionId, body, actor);
    sendJson(res, 200, { data: version });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/master-data/academic-periods") {
    sendJson(res, 200, await repository.listAcademicPeriods({
      periodType: url.searchParams.get("periodType"),
      status: url.searchParams.get("status"),
      asOf: url.searchParams.get("asOf")
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/master-data/academic-periods") {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 201, { data: await repository.createAcademicPeriod(body, actor) });
    return;
  }

  const periodMatch = url.pathname.match(/^\/api\/master-data\/academic-periods\/([^/]+)(?:\/(transitions))?$/);
  if (periodMatch && req.method === "PATCH" && !periodMatch[2]) {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 200, { data: await repository.updateAcademicPeriod(periodMatch[1], body, actor) });
    return;
  }

  if (periodMatch && req.method === "POST" && periodMatch[2] === "transitions") {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 200, { data: await repository.transitionAcademicPeriod(periodMatch[1], body, actor) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/master-data/reference-lists") {
    sendJson(res, 200, { data: await repository.listReferenceLists() });
    return;
  }

  const referenceListMatch = url.pathname.match(/^\/api\/master-data\/reference-lists\/([^/]+)(?:\/(values))?$/);
  if (referenceListMatch && req.method === "GET" && !referenceListMatch[2]) {
    sendJson(res, 200, {
      data: await repository.getReferenceList(referenceListMatch[1], {
        asOf: url.searchParams.get("asOf"),
        includeRetired: url.searchParams.get("includeRetired") === "true"
      })
    });
    return;
  }

  if (referenceListMatch && req.method === "POST" && referenceListMatch[2] === "values") {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 201, { data: await repository.createReferenceValue(referenceListMatch[1], body, actor) });
    return;
  }

  const referenceValueMatch = url.pathname.match(/^\/api\/master-data\/reference-values\/([^/]+)(?:\/(retire|restore))?$/);
  if (referenceValueMatch && req.method === "PATCH" && !referenceValueMatch[2]) {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 200, { data: await repository.updateReferenceValue(referenceValueMatch[1], body, actor) });
    return;
  }

  if (referenceValueMatch && req.method === "POST" && referenceValueMatch[2]) {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    const status = referenceValueMatch[2] === "retire" ? "retired" : "active";
    sendJson(res, 200, { data: await repository.setReferenceValueStatus(referenceValueMatch[1], status, body, actor) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admissions/catalogue") {
    sendJson(res, 200, { data: await repository.listCatalogue() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admissions/registrations") {
    const body = await readJson(req);
    sendJson(res, 202, { data: await repository.registerApplicant(body) });
    return;
  }

  if (url.pathname === "/api/admissions/profile" && ["GET", "PUT"].includes(req.method)) {
    const actor = await requirePermission(req, repository, "admissions.apply");
    const data = req.method === "GET"
      ? await repository.getApplicantProfile(actor)
      : await repository.saveApplicantProfile(actor, await readJson(req));
    sendJson(res, 200, { data });
    return;
  }

  if (url.pathname === "/api/admissions/applications" && ["GET", "POST"].includes(req.method)) {
    const actor = await requirePermission(req, repository, "admissions.apply");
    if (req.method === "GET") {
      sendJson(res, 200, { data: await repository.listMyApplications(actor) });
    } else {
      sendJson(res, 201, { data: await repository.createApplication(actor, await readJson(req)) });
    }
    return;
  }

  const applicationMatch = url.pathname.match(/^\/api\/admissions\/applications\/([^/]+)(?:\/(documents|fee|submit|withdraw|respond|offer-response|deferral))?$/);
  if (applicationMatch) {
    const [, applicationId, action] = applicationMatch;
    const route = `${req.method} ${action || ""}`.trim();
    if (["GET", "PATCH", "POST documents", "POST fee", "POST submit", "POST withdraw", "POST respond", "POST offer-response", "POST deferral"].includes(route)) {
      const actor = await requirePermission(req, repository, "admissions.apply");
      const body = req.method === "GET" ? {} : await readJson(req);
      if (route === "GET") {
        sendJson(res, 200, { data: await repository.getApplication(actor, applicationId) });
      } else if (route === "PATCH") {
        sendJson(res, 200, { data: await repository.updateApplication(actor, applicationId, body) });
      } else if (route === "POST documents") {
        await repository.assertApplicationDocumentAllowed(actor, applicationId, body.documentType);
        const upload = await repository.createUploadRequest({
          ...body,
          ownerType: "Application",
          ownerId: applicationId,
          classification: "confidential",
          reason: `Applicant upload: ${body.documentType}`
        }, actor);
        sendJson(res, 201, { data: upload });
      } else if (route === "POST fee") {
        sendJson(res, 200, { data: await repository.acknowledgeApplicationFee(actor, applicationId, body) });
      } else if (route === "POST submit") {
        sendJson(res, 200, { data: await repository.submitApplication(actor, applicationId) });
      } else if (route === "POST offer-response") {
        sendJson(res, 200, { data: await repository.respondToOffer(actor, applicationId, body) });
      } else if (route === "POST deferral") {
        sendJson(res, 201, { data: await repository.requestDeferral(actor, applicationId, body) });
      } else if (route === "POST respond") {
        sendJson(res, 200, { data: await repository.respondToInformationRequest(actor, applicationId, body) });
      } else {
        sendJson(res, 200, { data: await repository.withdrawApplication(actor, applicationId, body) });
      }
      return;
    }
  }

  const manifestMatch = url.pathname.match(/^\/api\/admissions\/review\/intakes\/([^/]+)\/manifest$/);
  if (req.method === "GET" && manifestMatch) {
    const actor = await requirePermission(req, repository, "admissions.review");
    sendJson(res, 200, { data: await repository.getIntakeManifest(actor, manifestMatch[1]) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admissions/review/offers/expire") {
    const actor = await requirePermission(req, repository, "admissions.decide");
    sendJson(res, 200, { data: await repository.expireOffers(actor) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admissions/review/applications") {
    const actor = await requirePermission(req, repository, "admissions.review");
    sendJson(res, 200, {
      data: await repository.listReviewQueue(actor, {
        intakeId: url.searchParams.get("intakeId"),
        programmeCode: url.searchParams.get("programmeCode"),
        state: url.searchParams.get("state"),
        assigned: url.searchParams.get("assigned"),
        limit: url.searchParams.get("limit"),
        offset: url.searchParams.get("offset"),
        reviewRoute: url.searchParams.get("reviewRoute"),
        includeClosed: url.searchParams.get("includeClosed") === "true"
      })
    });
    return;
  }

  const reviewMatch = url.pathname.match(/^\/api\/admissions\/review\/applications\/([^/]+)(?:\/(assign|notes|request-information|decision|convert|deferral|reopen|withdraw))?$/);
  if (reviewMatch) {
    const [, applicationId, action] = reviewMatch;
    const route = `${req.method} ${action || ""}`.trim();
    const handlers = {
      GET: "getReviewApplication",
      "POST assign": "assignReviewer",
      "POST notes": "addApplicationNote",
      "POST request-information": "requestInformation",
      "POST decision": "recordDecision",
      "POST convert": "convertApplication",
      "POST deferral": "resolveDeferral",
      "POST reopen": "reopenApplication",
      "POST withdraw": "withdrawReviewedApplication"
    };
    if (handlers[route]) {
      // Decisions need decision authority; everything else in review needs admissions.review.
      const actor = await requirePermission(req, repository, ["POST decision", "POST convert", "POST deferral", "POST reopen", "POST withdraw"].includes(route) ? "admissions.decide" : "admissions.review");
      const body = req.method === "GET" ? {} : await readJson(req);
      const status = route === "POST notes" ? 201 : 200;
      sendJson(res, status, { data: await repository[handlers[route]](actor, applicationId, body) });
      return;
    }
  }

  if (url.pathname === "/api/admissions/review/messages" && req.method === "POST") {
    const actor = await requirePermission(req, repository, "admissions.review");
    sendJson(res, 201, { data: await repository.communicateApplications(actor, await readJson(req)) });
    return;
  }
  if (url.pathname === "/api/admissions/migrations" && req.method === "POST") {
    const actor = await requirePermission(req, repository, "admissions.migrate");
    sendJson(res, 201, { data: await repository.importAdmissionsExport(actor, await readJson(req)) });
    return;
  }
  const admissionsMigrationMatch = url.pathname.match(/^\/api\/admissions\/migrations\/([^/]+)$/);
  if (admissionsMigrationMatch && req.method === "GET") {
    const actor = await requirePermission(req, repository, "admissions.migrate");
    sendJson(res, 200, { data: await repository.reconcileAdmissionsBatch(actor, admissionsMigrationMatch[1]) });
    return;
  }
  const admissionsRouteMatch = url.pathname.match(/^\/api\/admissions\/routes(?:\/(undergraduate|postgraduate))?$/);
  if (admissionsRouteMatch && ["GET", "PUT"].includes(req.method)) {
    const actor = await requirePermission(req, repository, req.method === "GET" ? "admissions.review" : "admissions.configure");
    if (req.method === "PUT" && !admissionsRouteMatch[1]) throw requestError(400, "Select a route to configure.");
    sendJson(res, 200, { data: req.method === "GET" ? await repository.listAdmissionsRoutes()
      : await repository.configureAdmissionsRoute(actor, admissionsRouteMatch[1], await readJson(req)) });
    return;
  }

  const intakeTransitionMatch = url.pathname.match(/^\/api\/master-data\/intakes\/([^/]+)\/transitions$/);
  if (req.method === "POST" && intakeTransitionMatch) {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    sendJson(res, 200, { data: await repository.transitionIntake(intakeTransitionMatch[1], body, actor) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/master-data/intakes") {
    sendJson(res, 200, { data: await repository.listIntakes() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/master-data/intakes") {
    const actor = await requirePermission(req, repository, "master_data.publish");
    const body = await readJson(req);
    const intake = await repository.createIntake(body, actor);
    sendJson(res, 201, { data: intake });
    return;
  }

  const intakeEdit = url.pathname.match(/^\/api\/master-data\/intakes\/([^/]+)$/);
  if (req.method === 'PATCH' && intakeEdit) {
    const actor = await requirePermission(req, repository, 'master_data.publish');
    sendJson(res, 200, {data:await repository.updateIntake(intakeEdit[1], await readJson(req), actor)});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tasks") {
    const actor = await requirePermission(req, repository, "task.assign");
    sendJson(res, 200, { data: await repository.listTasks(actor) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/workflows/instances") {
    const actor = await requirePermission(req, repository, "workflow.transition");
    sendJson(res, 200, { data: await repository.listWorkflowInstances(actor) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/workflows/definitions") {
    sendJson(res, 200, { data: await repository.listWorkflowDefinitions() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/workflows/instances") {
    const actor = await requirePermission(req, repository, "workflow.transition");
    const body = await readJson(req);
    sendJson(res, 201, { data: await repository.createWorkflowInstance(body, actor) });
    return;
  }

  const workflowInstanceMatch = url.pathname.match(/^\/api\/workflows\/instances\/([^/]+)$/);
  if (req.method === "GET" && workflowInstanceMatch) {
    const actor = await requirePermission(req, repository, "workflow.transition");
    sendJson(res, 200, { data: await repository.getWorkflowInstance(workflowInstanceMatch[1], actor) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/identity/invitations") {
    const actor = await requirePermission(req, repository, "identity.invite");
    const body = await readJson(req);
    const invitation = await repository.createInvitation(body, actor);
    sendJson(res, 201, { data: invitation });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/identity/activations") {
    const body = await readJson(req);
    const account = await repository.activateAccount(body);
    sendJson(res, 200, { data: account });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/identity/sessions") {
    const body = await readJson(req);
    const session = await repository.createSession({
      ...body,
      ipAddress: req.socket.remoteAddress,
      userAgent: req.headers["user-agent"] || null
    });
    sendJson(res, 201, { data: session });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/identity/me") {
    const actor = await requireAuthenticated(req, repository);
    sendJson(res, 200, {
      data: {
        ...await repository.getMe(actor),
        assurance: actor.assurance,
        mfa: await repository.getMfaSummary(actor.accountId)
      }
    });
    return;
  }

  if (url.pathname === '/api/chat-command-context') {
    res.setHeader('Cache-Control','no-store');
    const actor=await requireAuthenticated(req,repository);
    if(req.method!=='GET')throw requestError(405,'Message authority is read-only.');
    if([...url.searchParams].length)throw requestError(400,'Unsupported message authority query.');
    sendJson(res,200,{data:await repository.chatCommandContext({},actor)});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/identity/me/password") {
    const actor = await requireAuthenticated(req, repository);
    sendJson(res, 200, { data: await repository.changeOwnPassword(actor, await readJson(req)) });
    return;
  }

  if (url.pathname === "/api/identity/me/sessions" && ["GET", "DELETE"].includes(req.method)) {
    const actor = await requireAuthenticated(req, repository);
    sendJson(res, 200, { data: req.method === "GET" ? await repository.listOwnSessions(actor) : await repository.revokeOtherSessions(actor) });
    return;
  }

  // Enrolment works from a full session or from a sign-in that policy says must enrol first.
  if (req.method === "POST" && url.pathname === "/api/identity/mfa/totp") {
    const actor = await requireAuthenticated(req, repository, { allowStatuses: ["active", "mfa_enrolment_required"] });
    sendJson(res, 201, { data: await repository.startTotpEnrolment(actor) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/identity/mfa/totp/confirm") {
    const actor = await requireAuthenticated(req, repository, { allowStatuses: ["active", "mfa_enrolment_required"] });
    const body = await readJson(req);
    sendJson(res, 200, { data: await repository.confirmTotpEnrolment(actor, body) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/identity/sessions/current/mfa") {
    const actor = await requireAuthenticated(req, repository, { allowStatuses: ["mfa_pending"] });
    const body = await readJson(req);
    sendJson(res, 200, { data: await repository.verifySessionMfa(actor, body) });
    return;
  }

  const mfaResetMatch = url.pathname.match(/^\/api\/identity\/accounts\/([^/]+)\/mfa\/reset$/);
  if (req.method === "POST" && mfaResetMatch) {
    const actor = await requirePermission(req, repository, "identity.manage");
    // Removing your own second factor would let a stolen password take over the account.
    if (mfaResetMatch[1] === actor.accountId) throw requestError(403, "Ask another administrator to reset your authenticator.");
    const body = await readJson(req);
    sendJson(res, 200, { data: await repository.resetMfa(mfaResetMatch[1], body, actor) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/identity/recovery-requests") {
    const body = await readJson(req);
    sendJson(res, 202, { data: await repository.requestPasswordRecovery(body) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/identity/recovery-confirmations") {
    const body = await readJson(req);
    sendJson(res, 200, { data: await repository.confirmPasswordRecovery(body) });
    return;
  }

  const sessionMatch = url.pathname.match(/^\/api\/identity\/sessions\/([^/]+)$/);
  if (req.method === "DELETE" && sessionMatch) {
    // A sign-in that is waiting on MFA may still cancel itself.
    const actor = await requireAuthenticated(req, repository, { allowStatuses: ["active", "mfa_pending", "mfa_enrolment_required"] });
    const session = await repository.revokeSession(sessionMatch[1], actor);
    sendJson(res, 200, { data: session });
    return;
  }

  const accountSessionsMatch = url.pathname.match(/^\/api\/identity\/accounts\/([^/]+)\/sessions$/);
  if (req.method === "GET" && accountSessionsMatch) {
    await requirePermission(req, repository, "identity.manage");
    const sessions = await repository.listAccountSessions(accountSessionsMatch[1]);
    sendJson(res, 200, { data: sessions });
    return;
  }

  const accountSuspendMatch = url.pathname.match(/^\/api\/identity\/accounts\/([^/]+)\/suspend$/);
  if (req.method === "POST" && accountSuspendMatch) {
    const actor = await requirePermission(req, repository, "identity.manage");
    if (accountSuspendMatch[1] === actor.accountId) throw requestError(403, "You cannot suspend your own account.");
    const body = await readJson(req);
    const account = await repository.suspendAccount(accountSuspendMatch[1], body, actor);
    sendJson(res, 200, { data: account });
    return;
  }

  const accountReactivateMatch = url.pathname.match(/^\/api\/identity\/accounts\/([^/]+)\/reactivate$/);
  if (req.method === "POST" && accountReactivateMatch) {
    const actor = await requirePermission(req, repository, "identity.manage");
    const body = await readJson(req);
    const account = await repository.reactivateAccount(accountReactivateMatch[1], body, actor);
    sendJson(res, 200, { data: account });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/identity/accounts") {
    await requirePermission(req, repository, "identity.manage");
    sendJson(res, 200, { data: await repository.listAccounts(Object.fromEntries(url.searchParams)) });
    return;
  }

  const roleEndMatch = url.pathname.match(/^\/api\/access\/role-assignments\/([^/]+)\/end$/);
  if (req.method === "POST" && roleEndMatch) {
    const actor = await requirePermission(req, repository, "access.assign_role");
    sendJson(res, 200, { data: await repository.endRoleAssignment(roleEndMatch[1], await readJson(req), actor) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/access/role-assignments") {
    const actor = await requirePermission(req, repository, "access.assign_role");
    const body = await readJson(req);
    const assignment = await repository.createRoleAssignment(body, actor);
    sendJson(res, 201, { data: assignment });
    return;
  }

  const workflowTransitionMatch = url.pathname.match(/^\/api\/workflows\/instances\/([^/]+)\/transitions$/);
  if (req.method === "POST" && workflowTransitionMatch) {
    const actor = await requirePermission(req, repository, "workflow.transition");
    const body = await readJson(req);
    const workflow = await repository.transitionWorkflow(workflowTransitionMatch[1], body, actor);
    sendJson(res, 200, { data: workflow });
    return;
  }

  const taskAssignMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/assign$/);
  if (req.method === "POST" && taskAssignMatch) {
    const actor = await requirePermission(req, repository, "task.assign");
    const body = await readJson(req);
    const task = await repository.assignTask(taskAssignMatch[1], body, actor);
    sendJson(res, 200, { data: task });
    return;
  }

  const taskCompleteMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/complete$/);
  if (req.method === "POST" && taskCompleteMatch) {
    const actor = await requirePermission(req, repository, "task.assign");
    const body = await readJson(req);
    const task = await repository.completeTask(taskCompleteMatch[1], body, actor);
    sendJson(res, 200, { data: task });
    return;
  }

  const taskHandoffMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/handoff$/);
  if (req.method === "POST" && taskHandoffMatch) {
    const actor = await requirePermission(req, repository, "task.assign");
    const body = await readJson(req);
    const task = await repository.handoffTask(taskHandoffMatch[1], body, actor);
    sendJson(res, 200, { data: task });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/documents") {
    const actor = await requirePermission(req, repository, "document.create");
    const body = await readJson(req);
    const document = await repository.createDocument(body, actor);
    sendJson(res, 201, { data: document });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/documents/upload-requests") {
    const actor = await requirePermission(req, repository, "document.create");
    const body = await readJson(req);
    const uploadRequest = await repository.createUploadRequest(body, actor);
    sendJson(res, 201, { data: uploadRequest });
    return;
  }

  const documentScanMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/scan-results$/);
  if (req.method === "POST" && documentScanMatch) {
    const actor = await requirePermission(req, repository, "document.scan.record");
    const body = await readJson(req);
    const document = await repository.recordDocumentScan(documentScanMatch[1], body, actor);
    sendJson(res, 200, { data: document });
    return;
  }

  // Signed links carry their own authorization, so these two routes take no bearer token.
  const documentContentMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/content$/);
  if (documentContentMatch && req.method === "PUT" && url.searchParams.get("op") === "upload") {
    const bytes = await readBody(req, maxUploadBytes);
    const result = await repository.receiveUpload(documentContentMatch[1], {
      expires: url.searchParams.get("expires"),
      signature: url.searchParams.get("signature")
    }, bytes);
    sendJson(res, 200, { data: result });
    return;
  }

  if (documentContentMatch && req.method === "GET" && ["download", "view"].includes(url.searchParams.get("op"))) {
    const operation = url.searchParams.get("op");
    const { document, bytes } = await repository.readDownload(documentContentMatch[1], {
      expires: url.searchParams.get("expires"),
      signature: url.searchParams.get("signature")
    }, operation);
    // Views are inline. Stored files are limited to signature-checked PDF/JPEG/PNG and served with nosniff, so nothing
    // scriptable reaches the browser; a CSP sandbox is not used because browsers refuse to render PDFs inside one.
    res.writeHead(200, {
      "Content-Type": document.contentType || "application/octet-stream",
      "Content-Length": bytes.length,
      "Content-Disposition": `${operation === "view" ? "inline" : "attachment"}; filename="${String(document.fileName || document.id).replace(/[^\w.-]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    });
    res.end(bytes);
    return;
  }

  const documentMatch = url.pathname.match(/^\/api\/documents\/([^/]+)(?:\/(reviews|download-requests))?$/);
  if (documentMatch && req.method === "GET" && !documentMatch[2] && documentMatch[1] !== "upload-requests") {
    const actor = await requirePermission(req, repository, "document.create");
    sendJson(res, 200, { data: await repository.getDocument(documentMatch[1], actor) });
    return;
  }

  if (documentMatch && req.method === "POST" && documentMatch[2] === "reviews") {
    const actor = await requirePermission(req, repository, "document.review");
    const body = await readJson(req);
    sendJson(res, 201, { data: await repository.reviewDocument(documentMatch[1], body, actor) });
    return;
  }

  if (documentMatch && req.method === "POST" && documentMatch[2] === "download-requests") {
    const actor = await requirePermission(req, repository, "document.create");
    const body = await readJson(req);
    sendJson(res, 201, { data: await repository.createDownloadRequest(documentMatch[1], body, actor) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/documents") {
    await requirePermission(req, repository, "document.create");
    sendJson(res, 200, {
      data: await repository.listDocuments({
        ownerType: url.searchParams.get("ownerType"),
        ownerId: url.searchParams.get("ownerId")
      })
    });
    return;
  }

  const privateRoute=url.pathname.match(/^\/api\/private-messages\/(preferences|changes|conversations)(?:\/([A-Za-z0-9_-]+)(?:\/(accept|decline|close|block|messages|read|activity)(?:\/([A-Za-z0-9_-]+)\/report)?)?)?$/);
  if(privateRoute) {
    const actor=await requirePermission(req,repository,'messages.self');
    const [,kind,id,action,messageId]=privateRoute;let data;
    res.setHeader('Cache-Control','no-store');
    const keys=[...url.searchParams.keys()];
    if(new Set(keys).size!==keys.length || req.method!=='GET' && keys.length)throw requestError(400,'Unsupported private message query.');
    if(req.method==='GET' && kind==='preferences' && !id && !keys.length)data=await repository.getPrivateMessagePreferences(actor);
    else if(req.method==='PUT' && kind==='preferences' && !id)data=await repository.setPrivateMessagePreferences(await readJson(req,4000),actor);
    else if(req.method==='GET' && kind==='changes' && !id && !keys.length)data=await repository.privateMessageChanges(actor);
    else if(kind==='conversations' && !id && req.method==='GET')data=await repository.listPrivateConversations(Object.fromEntries(url.searchParams),actor);
    else if(kind==='conversations' && !id && req.method==='POST')data=await repository.invitePrivateContact(await readJson(req,4000),actor);
    else if(kind==='conversations' && id && !action && req.method==='GET')data=await repository.privateConversationSummary(id,Object.fromEntries(url.searchParams),actor);
    else if(kind==='conversations' && id && action==='activity' && !messageId && req.method==='GET')data=await repository.privateMessageActivity(id,Object.fromEntries(url.searchParams),actor);
    else if(kind==='conversations' && id && action==='messages' && !messageId && req.method==='GET')data=await repository.listPrivateMessages(id,Object.fromEntries(url.searchParams),actor);
    else if(kind==='conversations' && id && action==='messages' && !messageId && req.method==='POST')data=await repository.sendPrivateMessage(id,await readJson(req,20000),actor);
    else if(kind==='conversations' && id && ['accept','decline','close'].includes(action) && !messageId && req.method==='POST')data=await repository.changePrivateConversation(id,action,await readJson(req,4000),actor);
    else if(kind==='conversations' && id && action==='block' && !messageId && req.method==='POST')data=await repository.setPrivateContactBlock(id,await readJson(req,4000),actor);
    else if(kind==='conversations' && id && action==='read' && !messageId && req.method==='POST')data=await repository.markPrivateMessagesRead(id,await readJson(req,4000),actor);
    else if(kind==='conversations' && id && action==='messages' && messageId && req.method==='POST')data=await repository.reportPrivateMessage(id,messageId,await readJson(req,12000),actor);
    else throw requestError(404,'Private message route was not found.');
    sendJson(res,200,{data});return;
  }

  const roomReports=url.pathname.match(/^\/api\/message-rooms\/reports(?:\/([A-Za-z0-9_-]+)(?:\/(triage))?)?$/);
  if(roomReports) {
    const [,id,operation]=roomReports,view=url.searchParams.get('view') ?? 'own';
    const actor=await requirePermission(req,repository,operation || view==='triage' ? 'rooms.triage' : 'rooms.self');res.setHeader('Cache-Control','no-store');
    const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length || req.method!=='GET' && keys.length)throw requestError(400,'Unsupported report query.');
    let data;
    if(req.method==='GET' && !operation)data=id ? await repository.roomReportDetail(id,Object.fromEntries(url.searchParams),actor) : await repository.listRoomReports(Object.fromEntries(url.searchParams),actor);
    else if(req.method==='POST' && id && operation==='triage')data=await repository.triageRoomReport(id,await readJson(req,12000),actor);
    else throw requestError(404,'Report route was not found.');
    sendJson(res,200,{data});return;
  }
  const roomInvitationContext=url.pathname.match(/^\/api\/message-rooms\/([A-Za-z0-9_-]+)\/invitation-command-context$/);
  if(roomInvitationContext){
    res.setHeader('Cache-Control','no-store');const actor=await requirePermission(req,repository,'rooms.self');
    if(req.method!=='POST')throw requestError(405,'Use a read-only invitation context request.');
    if([...url.searchParams].length)throw requestError(400,'Invitation context query fields are not allowed.');
    sendJson(res,200,{data:await repository.roomInvitationCommandContext(roomInvitationContext[1],await readJson(req,4000),actor)});return;
  }
  const roomCommandContext=url.pathname.match(/^\/api\/message-rooms\/([A-Za-z0-9_-]+)\/command-context$/);
  if(roomCommandContext){
    res.setHeader('Cache-Control','no-store');const actor=await requirePermission(req,repository,'rooms.self');
    if(req.method!=='GET')throw requestError(405,'Room command context is read-only.');
    const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length)throw requestError(400,'Repeated room command fields are not allowed.');
    sendJson(res,200,{data:await repository.roomCommandContext(roomCommandContext[1],Object.fromEntries(url.searchParams),actor)});return;
  }
  const roomRoute=url.pathname.match(/^\/api\/message-rooms(?:\/(preferences|[A-Za-z0-9_-]+)(?:\/(activate|close|join|members|messages|activity)(?:\/([A-Za-z0-9_-]+)\/(accept|decline|leave|remove|ban|unban|promote|demote|moderate|report))?)?)?$/);
  if(roomRoute) {
    const [,id,action,target,operation]=roomRoute;
    const permission=req.method==='POST' && !id || action==='join' || ['promote','demote'].includes(operation) ? 'rooms.manage' : ['activate','close'].includes(action) ? 'rooms.approve' : 'rooms.self';
    const actor=await requirePermission(req,repository,permission);res.setHeader('Cache-Control','no-store');
    const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length || req.method!=='GET' && keys.length)throw requestError(400,'Unsupported room query.');
    let data;
    if(req.method==='GET' && id==='changes' && !action)data=await repository.roomChanges(Object.fromEntries(url.searchParams),actor);
    else if(req.method==='GET' && !id)data=await repository.roomWorkspace(Object.fromEntries(url.searchParams),actor);
    else if(req.method==='GET' && id!=='preferences' && !action)data=await repository.roomSummary(id,Object.fromEntries(url.searchParams),actor);
    else if(req.method==='GET' && id!=='preferences' && action==='activity' && !target)data=await repository.roomMessageActivity(id,Object.fromEntries(url.searchParams),actor);
    else if(req.method==='POST' && !id)data=await repository.createMessageRoom(await readJson(req,20000),actor);
    else if(req.method==='PUT' && id==='preferences' && !action)data=await repository.setRoomPreferences(await readJson(req,4000),actor);
    else if(req.method==='POST' && id!=='preferences' && ['activate','close'].includes(action) && !target)data=await repository.changeMessageRoom(id,action,await readJson(req,4000),actor);
    else if(req.method==='POST' && id!=='preferences' && action==='join' && !target)data=await repository.joinOwnMessageRoom(id,await readJson(req,4000),actor);
    else if(req.method==='GET' && id!=='preferences' && action==='members' && !target)data=await repository.listRoomMembers(id,Object.fromEntries(url.searchParams),actor);
    else if(req.method==='POST' && id!=='preferences' && action==='members' && !target)data=await repository.inviteRoomMember(id,await readJson(req,4000),actor);
    else if(req.method==='POST' && id!=='preferences' && action==='members' && target && operation!=='moderate')data=await repository.changeRoomMember(id,target,operation,await readJson(req,12000),actor);
    else if(req.method==='GET' && id!=='preferences' && action==='messages' && !target)data=await repository.listRoomMessages(id,Object.fromEntries(url.searchParams),actor);
    else if(req.method==='POST' && id!=='preferences' && action==='messages' && !target)data=await repository.sendRoomMessage(id,await readJson(req,20000),actor);
    else if(req.method==='POST' && id!=='preferences' && action==='messages' && target && operation==='moderate')data=await repository.moderateRoomMessage(id,target,await readJson(req,12000),actor);
    else if(req.method==='POST' && id!=='preferences' && action==='messages' && target && operation==='report')data=await repository.reportRoomMessage(id,target,await readJson(req,12000),actor);
    else throw requestError(404,'Room route was not found.');
    sendJson(res,200,{data});return;
  }

  if (req.method === 'GET' && url.pathname === '/api/notifications/me') {
    const actor = await requireAuthenticated(req,repository);
    const keys = [...url.searchParams.keys()];
    if (new Set(keys).size !== keys.length) throw requestError(400,'Repeated message filters are not allowed.');
    sendJson(res,200,{data:await repository.listOwnNotifications(Object.fromEntries(url.searchParams),actor)});
    return;
  }
  const ownNotificationRead = url.pathname.match(/^\/api\/notifications\/me\/([A-Za-z0-9_-]+)\/read$/);
  if (req.method === 'POST' && ownNotificationRead) {
    const actor = await requireAuthenticated(req,repository);
    sendJson(res,200,{data:await repository.markOwnNotificationRead(ownNotificationRead[1],await readJson(req),actor)});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/notifications/templates") {
    await requirePermission(req, repository, "notification.send");
    sendJson(res, 200, { data: await repository.listNotificationTemplates() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notifications/preview") {
    await requirePermission(req, repository, "notification.send");
    const body = await readJson(req);
    const preview = await repository.previewNotification(body);
    sendJson(res, 200, { data: preview });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notifications/send") {
    const actor = await requirePermission(req, repository, "notification.send");
    const body = await readJson(req);
    const notification = await repository.sendNotification(body, actor);
    sendJson(res, 202, { data: notification });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/notifications") {
    await requirePermission(req, repository, "notification.send");
    sendJson(res, 200, {
      data: await repository.listNotifications({
        recipientAccountId: url.searchParams.get("recipientAccountId"),
        status: url.searchParams.get("status")
      })
    });
    return;
  }

  sendJson(res, 404, {
    error: {
      code: "NOT_FOUND",
      message: "The requested API route does not exist."
    }
  });
}

async function requireAuthenticated(req, repository, options) {
  return repository.authenticateSession(getBearerToken(req), options);
}

async function requirePermission(req, repository, permissionCode) {
  return repository.requirePermission(getBearerToken(req), permissionCode);
}

// For resources whose authority is resolved in the module (for example allocation-derived lecturer access): the caller must
// hold at least one of the listed permissions; the first one held becomes the authorizing permission.
async function requireAnyPermission(req, repository, permissionCodes) {
  let denied;
  for (const code of permissionCodes) {
    try { return await requirePermission(req, repository, code); } catch (error) { if (error.statusCode !== 403) throw error; denied = error; }
  }
  throw denied;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

// Only the UI and the generated evidence it reads are public. Everything else in the working
// directory (server source, migrations, logs, legacy dumps, dev outbox) must never be served.
const publicPaths = [
  /^\/index\.html$/,
  // Installable app: manifest, service worker (it must sit at the root to control every page), offline page and icons.
  /^\/(?:manifest\.webmanifest|sw\.js|offline\.html)$/,
  /^\/src\/assets\/icons\/icon-(?:192|512|maskable-512)\.png$/,
  // Drawn illustrations (docs/VISUAL_SYSTEM.md).
  /^\/src\/assets\/illustrations\/[a-z-]+\.svg$/,
  /^\/src\/[\w.-]+\.(?:js|css|svg)$/,
  /^\/src\/assets\/campus-concept(?:-mobile)?\.jpg$/,
  /^\/src\/assets\/chat-smileys\/(?:emoticon_(?:smile|evilgrin|surprised|grin|unhappy|happy|waii|wink|tongue)|weather_(?:rain|snow|sun|clouds|cloudy|lightning)|arrow_(?:right|left)|exclamation|lightbulb)\.png$/,
  /^\/src\/assets\/chat-smileys\/ATTRIBUTION\.txt$/,
  /^\/docs\/phase-1\/[\w-]+\.generated\.json$/
];

export function isPublicPath(pathname) {
  return publicPaths.some((pattern) => pattern.test(pathname));
}

async function serveStatic(req, res, url, publicRoot) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    sendText(res, 400, "Bad request");
    return;
  }
  if (!isPublicPath(decodedPath)) {
    sendText(res, 404, "Not found");
    return;
  }
  const safePath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(publicRoot, safePath));

  if (!filePath.startsWith(publicRoot)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(res, 404, "Not found");
      return;
    }
    sendText(res, 500, "Server error");
  }
}

// Reads a raw body but stops as soon as it passes the limit, so large uploads cannot exhaust memory.
async function readBody(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      const error = new Error(`Upload exceeds the ${limit}-byte limit.`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, limit = Infinity) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw requestError(413,"JSON request exceeds the allowed size.");
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}
