import { config as loadEnv } from 'dotenv'
import { z } from 'zod'

loadEnv()

const envSchema = z.object({
  AUTH_API_HOST: z.string().default('0.0.0.0'),
  AUTH_API_PORT: z.coerce.number().default(3000),
  AUTH_API_PUBLIC_URL: z.string().url().default('https://auth.localhost:8443'),
  DATABASE_URL: z.string().default('postgresql://auth_sandbox:auth_sandbox@postgres:5432/auth_sandbox_2'),
  KEYCLOAK_BASE_URL: z.string().default('http://keycloak:8080'),
  KEYCLOAK_PUBLIC_URL: z.string().default('https://keycloak.localhost:8443'),
  KEYCLOAK_REALM: z.string().default('auth-sandbox-2'),
  KEYCLOAK_CLIENT_ID: z.string().default('app-web'),
  KEYCLOAK_CLIENT_SECRET: z.string().default('change-me'),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().default('auth-api-admin'),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().default('change-me-admin'),
  KEYCLOAK_ADMIN_USERNAME: z.string().default('admin'),
  KEYCLOAK_ADMIN_PASSWORD: z.string().default('admin'),
  CORS_ORIGIN: z.string().default('https://app.localhost:8443,https://admin.localhost:8443,https://home.localhost:8443'),
  CHALLENGE_TTL_SECONDS: z.coerce.number().default(300),
  OTEL_ENABLED: z.string().default('true')
})

const env = envSchema.parse(process.env)

export const appConfig = {
  host: env.AUTH_API_HOST,
  port: env.AUTH_API_PORT,
  publicUrl: env.AUTH_API_PUBLIC_URL,
  databaseUrl: env.DATABASE_URL,
  challengeTtlSeconds: env.CHALLENGE_TTL_SECONDS,
  corsOrigins: env.CORS_ORIGIN.split(',').map((value) => value.trim())
}

export const keycloakConfig = {
  baseUrl: env.KEYCLOAK_BASE_URL,
  publicUrl: env.KEYCLOAK_PUBLIC_URL,
  realm: env.KEYCLOAK_REALM,
  clientId: env.KEYCLOAK_CLIENT_ID,
  clientSecret: env.KEYCLOAK_CLIENT_SECRET,
  adminClientId: env.KEYCLOAK_ADMIN_CLIENT_ID,
  adminClientSecret: env.KEYCLOAK_ADMIN_CLIENT_SECRET,
  adminUsername: env.KEYCLOAK_ADMIN_USERNAME,
  adminPassword: env.KEYCLOAK_ADMIN_PASSWORD
}

export const otelConfig = {
  enabled: env.OTEL_ENABLED === 'true'
}

export const runtimeFlags = {
  allowTelemetryFailure: true
}
