import type {
  ArtifactDetailResponse,
  ClientEventInput,
  FinishLoginInput,
  FinishLoginResponse,
  RefreshTokensInput,
  RefreshTokensResponse,
  RegisterDeviceInput,
  RegisterDeviceResponse,
  SetPasswordInput,
  SpanDetailResponse,
  StartLoginInput,
  StartLoginResponse,
  TraceDetailResponse,
  TraceListResponse
} from '@auth-sandbox-2/shared-types'

const API_BASE = import.meta.env.VITE_AUTH_API_URL ?? 'https://auth.localhost:8443'

export type TraceRequestOptions = {
  traceId?: string
  sessionId?: string | null
  parentSpanId?: string | null
}

function createTraceHeaders(options?: TraceRequestOptions) {
  const traceId = options?.traceId ?? crypto.randomUUID()
  return {
    'x-trace-id': traceId,
    'x-correlation-id': traceId,
    'x-client-name': 'app-web',
    ...(options?.parentSpanId ? { 'x-span-id': options.parentSpanId } : {}),
    ...(options?.sessionId ? { 'x-session-id': options.sessionId } : {})
  }
}

async function request<T>(path: string, init?: RequestInit, options?: TraceRequestOptions) {
  const traceHeaders = createTraceHeaders(options)
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...traceHeaders,
      ...(init?.headers ?? {})
    }
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export const api = {
  registerDevice: (body: RegisterDeviceInput, options?: TraceRequestOptions) => request<RegisterDeviceResponse>('/api/device/register', { method: 'POST', body: JSON.stringify(body) }, options),
  setPassword: (body: SetPasswordInput, options?: TraceRequestOptions) => request<{ passwordSet: true }>('/api/device/set-password', { method: 'POST', body: JSON.stringify(body) }, options),
  startLogin: (body: StartLoginInput, options?: TraceRequestOptions) => request<StartLoginResponse>('/api/device/login/start', { method: 'POST', body: JSON.stringify(body) }, options),
  finishLogin: (body: FinishLoginInput, options?: TraceRequestOptions) => request<FinishLoginResponse>('/api/device/login/finish', { method: 'POST', body: JSON.stringify(body) }, options),
  refresh: (body: RefreshTokensInput, options?: TraceRequestOptions) => request<RefreshTokensResponse>('/api/device/token/refresh', { method: 'POST', body: JSON.stringify(body) }, options),
  logout: (body: RefreshTokensInput, options?: TraceRequestOptions) => request<{ logout: true }>('/api/device/logout', { method: 'POST', body: JSON.stringify(body) }, options),
  listTraces: (params?: URLSearchParams) => request<TraceListResponse>(`/api/observability/traces${params ? `?${params.toString()}` : ''}`),
  getTrace: (traceId: string) => request<TraceDetailResponse>(`/api/observability/traces/${traceId}`),
  getSpan: (spanId: string) => request<SpanDetailResponse>(`/api/observability/spans/${spanId}`),
  getArtifact: (artifactId: string) => request<ArtifactDetailResponse>(`/api/observability/artifacts/${artifactId}`),
  sendClientEvent: (body: ClientEventInput, options?: TraceRequestOptions) => request<{ traceId: string; spanId: string }>('/api/observability/client-events', { method: 'POST', body: JSON.stringify(body) }, options)
}
