import { createHash } from 'node:crypto';
import { requestError } from '../support.js';

export function validateSeatEntries(entries,manifest,{complete = false} = {}) {
  if (!Array.isArray(entries) || entries.length > 5000) throw requestError(400,'Provide up to 5000 candidate seat assignments.');
  const candidates = new Map(manifest.rooms.flatMap((room) => room.candidates.map((row) => [row.studentNumber,room.key]))),seen = new Set(),labels = new Map();
  const result = entries.map((entry) => {
    if (!entry || Object.keys(entry).some((key) => !['roomKey','studentNumber','seat'].includes(key)) || typeof entry.studentNumber !== 'string'
      || typeof entry.seat !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,29}$/.test(entry.seat.trim()) || candidates.get(entry.studentNumber) !== entry.roomKey
      || seen.has(entry.studentNumber)) throw requestError(400,'Assign each published candidate at most once, in their published room, with a seat label of 1-30 letters, digits, spaces or . _ / -.');
    seen.add(entry.studentNumber);
    const seat = entry.seat.trim().replace(/ +/g,' '),key = seat.toUpperCase();
    const roomLabels = labels.get(entry.roomKey) || new Set();
    if (roomLabels.has(key)) throw requestError(400,'Seat labels must be distinct within each room.');
    roomLabels.add(key);labels.set(entry.roomKey,roomLabels);
    return {roomKey:entry.roomKey,studentNumber:entry.studentNumber,seat};
  }).sort((a,b) => a.roomKey.localeCompare(b.roomKey) || a.studentNumber.localeCompare(b.studentNumber));
  if (complete && result.length && result.length !== candidates.size) throw requestError(409,'Assign every published candidate before publishing, or clear all seats to withdraw the seating plan.');
  return result;
}

export function freezeSeatPlan(revision,publishedRevision,manifestDigest,entries) {
  const content = {revision,publishedRevision,manifestDigest,entries:entries.map(({roomKey,studentNumber,seat}) => ({roomKey,studentNumber,seat}))};
  return {...content,digest:createHash('sha256').update(JSON.stringify(content)).digest('hex')};
}

export function currentSeatPlan(snapshot,publication,manifest) {
  return snapshot && publication.status === 'published' && publication.revision === publication.publishedRevision
    && snapshot.publishedRevision === publication.publishedRevision && snapshot.manifestDigest === manifest?.digest ? snapshot : null;
}

export async function seatingForManifest(db,sittingId,publication,manifest) {
  const plan = (await db.query('select published_snapshot as snapshot from exam_seating_plans where sitting_id = $1',[sittingId])).rows[0];
  return currentSeatPlan(plan?.snapshot,publication,manifest);
}
