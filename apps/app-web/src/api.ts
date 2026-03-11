import type {
  FinishLoginInput,
  FinishLoginResponse,
  RefreshTokensInput,
  RefreshTokensResponse,
  RegisterDeviceInput,
  RegisterDeviceResponse,
  SetPasswordInput,
  StartLoginInput,
  StartLoginResponse
} from '@auth-sandbox-2/shared-types'

const API_BASE = import.meta.env.VITE_AUTH_API_URL ?? 'https://auth.localhost:8443'

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
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
  registerDevice: (body: RegisterDeviceInput) => request<RegisterDeviceResponse>('/api/device/register', { method: 'POST', body: JSON.stringify(body) }),
  setPassword: (body: SetPasswordInput) => request<{ passwordSet: true }>('/api/device/set-password', { method: 'POST', body: JSON.stringify(body) }),
  startLogin: (body: StartLoginInput) => request<StartLoginResponse>('/api/device/login/start', { method: 'POST', body: JSON.stringify(body) }),
  finishLogin: (body: FinishLoginInput) => request<FinishLoginResponse>('/api/device/login/finish', { method: 'POST', body: JSON.stringify(body) }),
  refresh: (body: RefreshTokensInput) => request<RefreshTokensResponse>('/api/device/token/refresh', { method: 'POST', body: JSON.stringify(body) }),
  logout: (body: RefreshTokensInput) => request<{ logout: true }>('/api/device/logout', { method: 'POST', body: JSON.stringify(body) })
}
