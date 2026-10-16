// Minimal iCalendar (RFC 5545) writer for calendar feeds. Text is escaped and lines folded at 75 octets.
const escapeText = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const day = (value) => new Date(value).toISOString().slice(0, 10).replace(/-/g, '');

export function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > (parts.length ? 74 : 75)) { parts.push(current); current = ''; }
    current += char;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

// events: [{ id, title, description, start, end?, allDay, url? }]
export function buildCalendar({ name, events, now = new Date() }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//South Valley University//Portal//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`, 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${escapeText(event.id)}@svu-portal`, `DTSTAMP:${stamp(now)}`);
    if (event.allDay) {
      const next = new Date(new Date(event.start).getTime() + 864e5);
      lines.push(`DTSTART;VALUE=DATE:${day(event.start)}`, `DTEND;VALUE=DATE:${day(next)}`);
    } else {
      lines.push(`DTSTART:${stamp(event.start)}`, `DTEND:${stamp(event.end || new Date(new Date(event.start).getTime() + 30 * 60000))}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.url && !/[\r\n]/.test(event.url)) lines.push(`URL:${event.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
