export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, any> = {}) {
    super(message);
  }
  /** 서버가 처리했는지 알 수 없는 상태(네트워크 끊김·타임아웃) */
  get unknownOutcome() { return this.status === 0; }
}

let csrfToken = '';
export const setCsrf = (t: string) => { csrfToken = t; };

export async function api<T = any>(method: string, url: string, body?: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-csrf-token': csrfToken } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, 'network', '네트워크 연결이 불안정합니다. 연결을 확인한 뒤 다시 시도해 주세요.');
  } finally {
    clearTimeout(timer);
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* 빈 응답 */ }
  if (!res.ok) {
    const e = data?.error ?? {};
    const { code, message, ...extra } = e;
    if (res.status === 401) window.dispatchEvent(new CustomEvent('fd:unauthenticated'));
    throw new ApiError(res.status, code ?? 'error', message ?? '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', extra);
  }
  return data as T;
}

export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
