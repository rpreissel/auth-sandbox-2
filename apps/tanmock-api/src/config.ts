import { config as loadEnv } from 'dotenv'
import { z } from 'zod'

loadEnv()

const envSchema = z.object({
  TANMOCK_API_HOST: z.string().default('0.0.0.0'),
  TANMOCK_API_PORT: z.coerce.number().default(3003),
  TANMOCK_API_PUBLIC_URL: z.string().url().default('https://tanmock.localhost:8443'),
  TANMOCK_API_INTERNAL_URL: z.string().url().default('http://tanmock-api:3003'),
  TANMOCK_ISSUER: z.string().url().default('https://tanmock.localhost:8443'),
  TANMOCK_CLIENT_ID: z.string().default('tanmock-broker'),
  TANMOCK_CLIENT_SECRET: z.string().default('change-me-tanmock-broker'),
  TANMOCK_ADMIN_CLIENT_ID: z.string().default('tanmock-admin-web'),
  TANMOCK_SIGNING_KEY_ID: z.string().default('tanmock-signing-key'),
  TANMOCK_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  TANMOCK_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  TANMOCK_AUTH_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  KEYCLOAK_BASE_URL: z.string().default('http://keycloak:8080'),
  KEYCLOAK_PUBLIC_URL: z.string().default('https://keycloak.localhost:8443'),
  KEYCLOAK_REALM: z.string().default('auth-sandbox-2'),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().default('auth-api-admin'),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().default('change-me-admin'),
  CORS_ORIGIN: z.string().default('https://tanmock.localhost:8443')
})

const env = envSchema.parse(process.env)

export const tanMockApiConfig = {
  host: env.TANMOCK_API_HOST,
  port: env.TANMOCK_API_PORT,
  publicUrl: env.TANMOCK_API_PUBLIC_URL,
  internalUrl: env.TANMOCK_API_INTERNAL_URL,
  issuer: env.TANMOCK_ISSUER,
  clientId: env.TANMOCK_CLIENT_ID,
  clientSecret: env.TANMOCK_CLIENT_SECRET,
  adminClientId: env.TANMOCK_ADMIN_CLIENT_ID,
  signingKeyId: env.TANMOCK_SIGNING_KEY_ID,
  accessTokenTtlSeconds: env.TANMOCK_ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlSeconds: env.TANMOCK_REFRESH_TOKEN_TTL_SECONDS,
  authCodeTtlSeconds: env.TANMOCK_AUTH_CODE_TTL_SECONDS,
  keycloakBaseUrl: env.KEYCLOAK_BASE_URL,
  keycloakPublicUrl: env.KEYCLOAK_PUBLIC_URL,
  keycloakRealm: env.KEYCLOAK_REALM,
  keycloakAdminClientId: env.KEYCLOAK_ADMIN_CLIENT_ID,
  keycloakAdminClientSecret: env.KEYCLOAK_ADMIN_CLIENT_SECRET,
  corsOrigins: env.CORS_ORIGIN.split(',').map((value) => value.trim())
}
