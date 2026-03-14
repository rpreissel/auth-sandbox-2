import { config as loadEnv } from 'dotenv'
import { z } from 'zod'

loadEnv()

const envSchema = z.object({
  MOCK_API_HOST: z.string().default('0.0.0.0'),
  MOCK_API_PORT: z.coerce.number().default(3002),
  MOCK_API_PUBLIC_URL: z.string().url().default('https://mock.localhost:8443'),
  MOCK_API_AUDIENCE: z.string().default('mock-api'),
  KEYCLOAK_BASE_URL: z.string().default('http://keycloak:8080'),
  KEYCLOAK_PUBLIC_URL: z.string().default('https://keycloak.localhost:8443'),
  KEYCLOAK_REALM: z.string().default('auth-sandbox-2'),
  CORS_ORIGIN: z.string().default('https://app.localhost:8443,https://admin.localhost:8443,https://mock.localhost:8443')
})

const env = envSchema.parse(process.env)

export const mockApiConfig = {
  host: env.MOCK_API_HOST,
  port: env.MOCK_API_PORT,
  publicUrl: env.MOCK_API_PUBLIC_URL,
  audience: env.MOCK_API_AUDIENCE,
  issuer: `${env.KEYCLOAK_PUBLIC_URL}/realms/${env.KEYCLOAK_REALM}`,
  jwksUrl: `${env.KEYCLOAK_BASE_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/certs`,
  corsOrigins: env.CORS_ORIGIN.split(',').map((value) => value.trim())
}
