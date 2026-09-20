import { ref } from 'vue';
import { api } from './api';

export interface User {
  id: string;
  name: string;
  email: string;
}

export const currentUser = ref<User | null>(null);
let loaded = false;

export async function loadUser(force = false): Promise<User | null> {
  if (loaded && !force) return currentUser.value;
  const res = await api.get<{ authenticated: boolean; user: User | null }>('/api/auth/me');
  currentUser.value = res.user;
  loaded = true;
  return currentUser.value;
}

export function setUser(u: User | null) {
  currentUser.value = u;
  loaded = true;
}
