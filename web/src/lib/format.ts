export const fmtTime = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const fmtDateLong = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export const fmtDateShort = (iso: string) =>
  new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function relTime(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDateShort(iso);
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Stable avatar hue per person (decorative only). */
export function avatarColor(name: string) {
  const palette = ['#7C5CFF', '#FF5C9A', '#2BB0FF', '#FF9F43', '#20C997', '#B45CFF'];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export function uuid() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
