export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: any,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : undefined;
  try {
    const isForm = body instanceof FormData;
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body && !isForm ? { 'content-type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : undefined;
    if (!res.ok) {
      if (res.status === 401 && !url.startsWith('/api/auth') && !location.pathname.startsWith('/login')) {
        location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
      }
      throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data);
    }
    return data as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown, opts?: { timeoutMs?: number }) => request<T>('POST', url, body ?? {}, opts),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  upload: <T>(url: string, form: FormData) => request<T>('POST', url, form),
};

/** True when the failure was the network (offline/timeout), not a server answer. */
export const isNetworkError = (e: unknown) => !(e instanceof ApiError);
