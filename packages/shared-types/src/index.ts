export type IsoDateTime = string

export type RegistrationCodeRecord = {
  id: string
  userId: string
  displayName: string | null
  code: string
  expiresAt: IsoDateTime
  useCount: number
  createdAt: IsoDateTime
}

export type DeviceRecord = {
  id: string
  userId: string
  deviceName: string
  publicKeyHash: string
  active: boolean
  createdAt: IsoDateTime
}

export type CreateRegistrationCodeInput = {
  userId: string
  displayName?: string
  validForDays?: number
}

export type RegisterDeviceInput = {
  userId: string
  deviceName: string
  activationCode: string
  publicKey: string
}

export type RegisterDeviceResponse = {
  deviceId: string
  deviceName: string
  publicKeyHash: string
  passwordRequired: boolean
}

export type SetPasswordInput = {
  userId: string
  password: string
}

export type StartLoginInput = {
  publicKeyHash: string
}

export type StartLoginResponse = {
  nonce: string
  encryptedKey: string
  encryptedData: string
  iv: string
  expiresAt: IsoDateTime
}

export type FinishLoginInput = {
  nonce: string
  encryptedKey: string
  encryptedData: string
  iv: string
  signature: string
}

export type RefreshTokensInput = {
  refreshToken: string
}

export type LogoutInput = {
  refreshToken: string
}

export type JwtClaims = Record<string, boolean | number | string | string[] | null | undefined>

export type JsonPrimitive = boolean | number | string | null

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined }

export type JsonObject = { [key: string]: JsonValue | undefined }

export type TokenBundle = {
  accessToken: string
  idToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  scope: string
  accessTokenClaims: JwtClaims
  idTokenClaims: JwtClaims
  userInfo: JsonObject
  tokenIntrospection: JsonObject
}

export type FinishLoginResponse = TokenBundle & {
  requiredAction: string | null
}

export type RefreshTokensResponse = TokenBundle

export type LogoutResponse = {
  logout: true
}

export type HealthResponse = {
  status: 'ok'
  service: string
}

export type TraceStatus = 'running' | 'success' | 'error'

export type SpanKind = 'client_event' | 'http_in' | 'http_out' | 'crypto' | 'process'

export type ActorType = 'client' | 'backend' | 'proxy' | 'keycloak'

export type TraceListItem = {
  traceId: string
  correlationId: string
  traceType: string
  title: string
  status: TraceStatus
  startedAt: IsoDateTime
  finishedAt: IsoDateTime | null
  durationMs: number | null
  rootClient: string | null
  rootEntrypoint: string | null
  userId: string | null
  deviceId: string | null
  spanCount: number
  errorCount: number
  actors: string[]
}

export type TraceListResponse = {
  items: TraceListItem[]
  page: number
  pageSize: number
  total: number
}

export type TraceOverview = {
  traceId: string
  correlationId: string
  traceType: string
  status: TraceStatus
  title: string
  summary: string | null
  startedAt: IsoDateTime
  finishedAt: IsoDateTime | null
  durationMs: number | null
  rootClient: string | null
  rootEntrypoint: string | null
  userId: string | null
  deviceId: string | null
  sessionId: string | null
}

export type TraceLane = {
  actorType: ActorType
  actorName: string
}

export type SpanSummary = {
  spanId: string
  parentSpanId: string | null
  kind: SpanKind
  actorType: ActorType
  actorName: string
  operation: string
  method?: string | null
  url?: string | null
  route?: string | null
  targetName?: string | null
  status: TraceStatus
  statusCode?: number | null
  startedAt: IsoDateTime
  finishedAt: IsoDateTime | null
  durationMs: number | null
  artifactCount: number
  hasError: boolean
}

export type TraceDetailResponse = {
  trace: TraceOverview
  lanes: TraceLane[]
  spans: SpanSummary[]
}

export type ArtifactSummary = {
  artifactId: string
  artifactType: string
  name: string
  encoding: string | null
  contentType: string | null
  direction: string | null
  summary: string | null
}

export type SpanDetail = {
  spanId: string
  traceId: string
  parentSpanId: string | null
  kind: SpanKind
  actorType: ActorType
  actorName: string
  targetName: string | null
  operation: string
  method: string | null
  url: string | null
  route: string | null
  status: TraceStatus
  statusCode: number | null
  startedAt: IsoDateTime
  finishedAt: IsoDateTime | null
  durationMs: number | null
  userId: string | null
  deviceId: string | null
  sessionId: string | null
  challengeId: string | null
  notes: string | null
}

export type SpanDetailResponse = {
  span: SpanDetail
  relatedSpans: {
    parent: string | null
    children: string[]
    siblings: string[]
  }
  artifacts: ArtifactSummary[]
}

export type FieldExplanation = {
  fieldPath: string
  label: string
  rawValue: string | null
  normalizedValue: string | null
  explanation: string
}

export type ArtifactDetailResponse = {
  artifact: {
    artifactId: string
    spanId: string
    artifactType: string
    name: string
    contentType: string | null
    encoding: string | null
    direction: string | null
    explanation: string | null
  }
  views: {
    raw: string
    decoded: unknown
    decrypted: unknown
    explained: FieldExplanation[]
  }
}

export type ClientEventArtifactInput = {
  artifactType: string
  name: string
  contentType?: string | null
  encoding?: string | null
  direction?: string | null
  rawValue: string
  explanation?: string | null
}

export type ClientEventInput = {
  traceId: string
  traceType?: string
  parentSpanId?: string | null
  actorName: string
  operation: string
  status?: TraceStatus
  timestamp?: IsoDateTime
  userId?: string | null
  deviceId?: string | null
  sessionId?: string | null
  artifacts?: ClientEventArtifactInput[]
}

export type MockApiTraceEnvelope = {
  traceId: string | null
  correlationId: string | null
}

export type MockApiProfileResponse = MockApiTraceEnvelope & {
  subject: string
  userId: string
  username: string
  audience: string[]
  scope: string[]
  issuer: string
  clientId: string | null
  issuedAt: IsoDateTime | null
  expiresAt: IsoDateTime | null
}

export type MockApiMessageRecord = {
  id: string
  text: string
  authorUserId: string
  createdAt: IsoDateTime
  category: 'seed' | 'note'
}

export type MockApiMessagesResponse = MockApiTraceEnvelope & {
  items: MockApiMessageRecord[]
}

export type MockApiCreateMessageInput = {
  text: string
}

export type MockApiCreateMessageResponse = MockApiTraceEnvelope & {
  item: MockApiMessageRecord
}
