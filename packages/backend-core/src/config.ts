import { config as loadEnv } from 'dotenv'
import { z } from 'zod'

loadEnv()

const envSchema = z.object({
  AUTH_API_HOST: z.string().default('0.0.0.0'),
  AUTH_API_PORT: z.coerce.number().default(3000),
  AUTH_API_PUBLIC_URL: z.string().url().default('https://auth.localhost:8443'),
  DATABASE_URL: z.string().default('postgresql://auth_sandbox:auth_sandbox@postgres:5432/auth_sandbox_2'),
  DATABASE_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/).default('auth_api'),
  TRACE_API_INTERNAL_URL: z.string().url().default('http://127.0.0.1:3001'),
  OBSERVABILITY_WRITE_MODE: z.enum(['direct', 'http']).optional(),
  KEYCLOAK_BASE_URL: z.string().default('http://keycloak:8080'),
  KEYCLOAK_PUBLIC_URL: z.string().default('https://keycloak.localhost:8443'),
  KEYCLOAK_REALM: z.string().default('auth-sandbox-2'),
  KEYCLOAK_CLIENT_ID: z.string().default('app-web'),
  KEYCLOAK_CLIENT_SECRET: z.string().default('change-me'),
  KEYCLOAK_BROWSER_CLIENT_ID: z.string().default('browser-app'),
  KEYCLOAK_BROWSER_CLIENT_SECRET: z.string().default('change-me-browser'),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().default('auth-api-admin'),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().default('change-me-admin'),
  KEYCLOAK_INTERNAL_REDEEM_CLIENT_ID: z.string().default('auth-api-internal-redeem'),
  KEYCLOAK_INTERNAL_REDEEM_CLIENT_SECRET: z.string().default('change-me-internal-redeem'),
  KEYCLOAK_ADMIN_USERNAME: z.string().default('admin'),
  KEYCLOAK_ADMIN_PASSWORD: z.string().default('admin'),
  AUTH_API_FLOW_TOKEN_SECRET: z.string().min(16).default('change-me-flow-token-secret'),
  CORS_ORIGIN: z.string().default('https://app.localhost:8443,https://admin.localhost:8443,https://home.localhost:8443'),
  CHALLENGE_TTL_SECONDS: z.coerce.number().default(300)
})

const env = envSchema.parse(process.env)
const defaultObservabilityWriteMode = (process.env.OBSERVABILITY_SERVICE_NAME ?? 'auth-api') === 'trace-api'
  ? 'direct'
  : 'http'

export const appConfig = {
  host: env.AUTH_API_HOST,
  port: env.AUTH_API_PORT,
  publicUrl: env.AUTH_API_PUBLIC_URL,
  databaseUrl: env.DATABASE_URL,
  databaseSchema: env.DATABASE_SCHEMA,
  traceApiInternalUrl: env.TRACE_API_INTERNAL_URL,
  observabilityWriteMode: env.OBSERVABILITY_WRITE_MODE ?? defaultObservabilityWriteMode,
  challengeTtlSeconds: env.CHALLENGE_TTL_SECONDS,
  flowTokenSecret: env.AUTH_API_FLOW_TOKEN_SECRET,
  corsOrigins: env.CORS_ORIGIN.split(',').map((value) => value.trim())
}

export const keycloakConfig = {
  baseUrl: env.KEYCLOAK_BASE_URL,
  publicUrl: env.KEYCLOAK_PUBLIC_URL,
  realm: env.KEYCLOAK_REALM,
  clientId: env.KEYCLOAK_CLIENT_ID,
  clientSecret: env.KEYCLOAK_CLIENT_SECRET,
  browserClientId: env.KEYCLOAK_BROWSER_CLIENT_ID,
  browserClientSecret: env.KEYCLOAK_BROWSER_CLIENT_SECRET,
  adminClientId: env.KEYCLOAK_ADMIN_CLIENT_ID,
  adminClientSecret: env.KEYCLOAK_ADMIN_CLIENT_SECRET,
  internalRedeemClientId: env.KEYCLOAK_INTERNAL_REDEEM_CLIENT_ID,
  internalRedeemClientSecret: env.KEYCLOAK_INTERNAL_REDEEM_CLIENT_SECRET,
  adminUsername: env.KEYCLOAK_ADMIN_USERNAME,
  adminPassword: env.KEYCLOAK_ADMIN_PASSWORD
}
