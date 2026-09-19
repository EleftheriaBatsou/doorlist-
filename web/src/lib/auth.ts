import { api } from './api';

let cached: boolean | null = null;

export async function isAuthed(force = false): Promise<boolean> {
  if (cached !== null && !force) return cached;
  cached = (await api.get<{ authenticated: boolean }>('/api/auth/me')).authenticated;
  return cached;
}

export function setAuthed(v: boolean) {
  cached = v;
}
