// Minimal RFC 5545 calendar file. Mirrored in the worker (which uploads it to storage).
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function fold(line: string): string {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 73) out.push((i ? ' ' : '') + line.slice(i, i + 73));
  return out.join('\r\n');
}

export function buildIcs(ev: {
  uid: string;
  title: string;
  description: string;
  venue: string;
  startsAt: Date;
  url: string;
  durationHours?: number;
}): string {
  const end = new Date(ev.startsAt.getTime() + (ev.durationHours ?? 3) * 3600_000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Doorlist//Tickets//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}@doorlist`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(ev.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(ev.title)}`,
    `DESCRIPTION:${esc(`${ev.description}\n\nYour ticket: ${ev.url}`)}`,
    `LOCATION:${esc(ev.venue)}`,
    `URL:${ev.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(fold)
    .join('\r\n');
}
