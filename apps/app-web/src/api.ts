import type {
  ArtifactDetailResponse,
  ClientEventInput,
  CreateFlowInput,
  FinalizeFlowInput,
  FinishLoginInput,
  FinishLoginResponse,
  MockApiCreateMessageInput,
  MockApiCreateMessageResponse,
  MockApiMessagesResponse,
  MockApiProfileResponse,
  PublicAssuranceFlowRecord,
  SelectFlowServiceInput,
  ServiceResultEnvelope,
  SmsTanStartResponse,
  RefreshTokensInput,
  RefreshTokensResponse,
  SetPasswordInput,
  SpanDetailResponse,
  StartLoginInput,
  StartLoginResponse,
  TraceDetailResponse,
  TraceListResponse
} from '@auth-sandbox-2/shared-types'

const API_BASE = import.meta.env.VITE_AUTH_API_URL ?? ''
const TRACE_API_BASE = import.meta.env.VITE_TRACE_API_URL ?? '/trace-api'
const MOCK_API_BASE = import.meta.env.VITE_MOCK_API_URL ?? '/mock-api'

export type TraceRequestOptions = {
  traceId?: string
  sessionId?: string | null
  parentSpanId?: string | null
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function toApiError(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const body = await response.json() as { message?: unknown }
    const message = typeof body.message === 'string' && body.message.length > 0
      ? body.message
      : `Request failed with status ${response.status}`
    return new ApiError(response.status, message)
  }

  const text = await response.text()
  return new ApiError(response.status, text || `Request failed with status ${response.status}`)
}

async function parseJsonResponse<T>(response: Response) {
  if (!response.ok) {
    throw await toApiError(response)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
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

async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit, options?: TraceRequestOptions) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...createTraceHeaders(options),
      ...(init?.headers ?? {})
    }
  })

  return parseJsonResponse<T>(response)
}

async function bearerRequest<T>(path: string, token: string, init?: RequestInit, options?: TraceRequestOptions) {
  return requestJson<T>(API_BASE, path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  }, options)
}

async function mockRequest<T>(path: string, accessToken: string, init?: RequestInit, options?: TraceRequestOptions) {
  return requestJson<T>(MOCK_API_BASE, path, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {})
    }
  }, options)
}

export const api = {
  createFlow: (body: CreateFlowInput, options?: TraceRequestOptions) => requestJson<PublicAssuranceFlowRecord>(API_BASE, '/api/flows', { method: 'POST', body: JSON.stringify(body) }, options),
  selectFlowService: (flowId: string, flowToken: string, body: SelectFlowServiceInput, options?: TraceRequestOptions) => bearerRequest<PublicAssuranceFlowRecord>(`/api/flows/${flowId}/select-service`, flowToken, { method: 'POST', body: JSON.stringify(body) }, options),
  completePersonCode: (serviceToken: string, code: string, options?: TraceRequestOptions) => bearerRequest<ServiceResultEnvelope>('/api/identification/person-code/complete', serviceToken, { method: 'POST', body: JSON.stringify({ code }) }, options),
  startSmsTan: (serviceToken: string, options?: TraceRequestOptions) => bearerRequest<SmsTanStartResponse>('/api/identification/sms-tan/start', serviceToken, { method: 'POST', body: JSON.stringify({}) }, options),
  resendSmsTan: (serviceToken: string, options?: TraceRequestOptions) => bearerRequest<SmsTanStartResponse>('/api/identification/sms-tan/resend', serviceToken, { method: 'POST', body: JSON.stringify({}) }, options),
  completeSmsTan: (serviceToken: string, tan: string, options?: TraceRequestOptions) => bearerRequest<ServiceResultEnvelope>('/api/identification/sms-tan/complete', serviceToken, { method: 'POST', body: JSON.stringify({ tan }) }, options),
  finalizeFlow: (flowId: string, flowToken: string, body: FinalizeFlowInput, options?: TraceRequestOptions) => bearerRequest<PublicAssuranceFlowRecord>(`/api/flows/${flowId}/finalize`, flowToken, { method: 'POST', body: JSON.stringify(body) }, options),
  setPassword: (body: SetPasswordInput, options?: TraceRequestOptions) => requestJson<{ passwordSet: true }>(API_BASE, '/api/device/set-password', { method: 'POST', body: JSON.stringify(body) }, options),
  startLogin: (body: StartLoginInput, options?: TraceRequestOptions) => requestJson<StartLoginResponse>(API_BASE, '/api/device/login/start', { method: 'POST', body: JSON.stringify(body) }, options),
  finishLogin: (body: FinishLoginInput, options?: TraceRequestOptions) => requestJson<FinishLoginResponse>(API_BASE, '/api/device/login/finish', { method: 'POST', body: JSON.stringify(body) }, options),
  refresh: (body: RefreshTokensInput, options?: TraceRequestOptions) => requestJson<RefreshTokensResponse>(API_BASE, '/api/device/token/refresh', { method: 'POST', body: JSON.stringify(body) }, options),
  logout: (body: RefreshTokensInput, options?: TraceRequestOptions) => requestJson<{ logout: true }>(API_BASE, '/api/device/logout', { method: 'POST', body: JSON.stringify(body) }, options),
  listTraces: (params?: URLSearchParams) => requestJson<TraceListResponse>(TRACE_API_BASE, `/traces${params ? `?${params.toString()}` : ''}`),
  getTrace: (traceId: string) => requestJson<TraceDetailResponse>(TRACE_API_BASE, `/traces/${traceId}`),
  getSpan: (spanId: string) => requestJson<SpanDetailResponse>(TRACE_API_BASE, `/spans/${spanId}`),
  getArtifact: (artifactId: string) => requestJson<ArtifactDetailResponse>(TRACE_API_BASE, `/artifacts/${artifactId}`),
  sendClientEvent: (body: ClientEventInput, options?: TraceRequestOptions) => requestJson<{ traceId: string; spanId: string }>(TRACE_API_BASE, '/client-events', { method: 'POST', body: JSON.stringify(body) }, options),
  getMockProfile: (accessToken: string, options?: TraceRequestOptions) => mockRequest<MockApiProfileResponse>('/api/mock/profile', accessToken, undefined, options),
  listMockMessages: (accessToken: string, options?: TraceRequestOptions) => mockRequest<MockApiMessagesResponse>('/api/mock/messages', accessToken, undefined, options),
  createMockMessage: (accessToken: string, body: MockApiCreateMessageInput, options?: TraceRequestOptions) => mockRequest<MockApiCreateMessageResponse>('/api/mock/messages', accessToken, { method: 'POST', body: JSON.stringify(body) }, options)
}
