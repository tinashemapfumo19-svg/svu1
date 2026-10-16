import { requestError } from "../support.js";

const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;

export function validateExamOrder(input) {
  if (!input || Object.keys(input).some((key) => !['paper','durationMinutes','paperReference','materialsAllowed','requirements','reason'].includes(key))
    || !text(input.paper,60) || !Number.isInteger(input.durationMinutes) || input.durationMinutes < 15 || input.durationMinutes > 480 || input.durationMinutes % 15
    || !text(input.paperReference,200) || !text(input.materialsAllowed,500) || !text(input.reason,2000)
    || input.requirements !== undefined && (typeof input.requirements !== 'string' || input.requirements.length > 1000)) {
    throw requestError(400,"Provide a paper, duration of 15-480 minutes in steps of 15, paper reference, allowed materials, optional requirements, and a reason.");
  }
  return {paper:input.paper.trim(),durationMinutes:input.durationMinutes,paperReference:input.paperReference.trim(),materialsAllowed:input.materialsAllowed.trim(),requirements:(input.requirements || '').trim(),reason:input.reason.trim()};
}

export function assertOrderMatchesSitting(order,courseId,sitting) {
  if (order.status !== 'approved') throw requestError(409,"The exam order must be approved before scheduling.");
  if (order.courseId !== courseId || order.paper !== sitting.paper || order.durationMinutes !== sitting.durationMinutes) {
    throw requestError(409,"The course, paper, and duration must match the approved exam order.");
  }
}

export const examOrderSelect = `select eo.id,eo.period_id as "periodId",eo.course_id as "courseId",eo.paper,eo.duration_minutes as "durationMinutes",
  eo.paper_reference as "paperReference",eo.materials_allowed as "materialsAllowed",eo.requirements,eo.reason,eo.status,eo.submitted_by as "submittedBy",eo.submitted_at as "submittedAt",
  eo.reviewed_by as "reviewedBy",eo.reviewed_at as "reviewedAt",eo.review_reason as "reviewReason",
  (select s.id from exam_sittings s where s.order_id = eo.id and s.status = 'scheduled') as "sittingId" from exam_orders eo`;
