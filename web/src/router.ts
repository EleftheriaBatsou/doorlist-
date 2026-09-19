import { createRouter, createWebHistory } from 'vue-router';
import { isAuthed } from './lib/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/HomeView.vue') },
    { path: '/e/:slug', component: () => import('./views/PublicEventView.vue') },
    { path: '/t/:code', component: () => import('./views/TicketView.vue') },
    { path: '/login', component: () => import('./views/LoginView.vue') },
    { path: '/admin', component: () => import('./views/AdminEventsView.vue'), meta: { admin: true } },
    { path: '/admin/events/new', component: () => import('./views/EventEditorView.vue'), meta: { admin: true } },
    { path: '/admin/events/:id/edit', component: () => import('./views/EventEditorView.vue'), meta: { admin: true } },
    { path: '/admin/events/:id', component: () => import('./views/DashboardView.vue'), meta: { admin: true } },
    { path: '/scan/:id', component: () => import('./views/ScannerView.vue'), meta: { admin: true } },
    { path: '/:pathMatch(.*)*', component: () => import('./views/NotFoundView.vue') },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  if (!to.meta.admin) return true;
  try {
    if (await isAuthed()) return true;
  } catch {
    // Offline: let an already-loaded scanner keep working; the API will re-check.
    if (to.path.startsWith('/scan/')) return true;
  }
  return { path: '/login', query: { next: to.fullPath } };
});
