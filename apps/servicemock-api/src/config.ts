import { config as loadEnv } from 'dotenv'
import { z } from 'zod'

loadEnv()

const envSchema = z.object({
  SERVICEMOCK_API_HOST: z.string().default('0.0.0.0'),
  SERVICEMOCK_API_PORT: z.coerce.number().default(3002),
  SERVICEMOCK_API_PUBLIC_URL: z.string().url().default('https://webmock.localhost:8443'),
  SERVICEMOCK_API_AUDIENCE: z.string().default('servicemock-api'),
  KEYCLOAK_BASE_URL: z.string().default('http://keycloak:8080'),
  KEYCLOAK_PUBLIC_URL: z.string().default('https://keycloak.localhost:8443'),
  KEYCLOAK_REALM: z.string().default('auth-sandbox-2'),
  CORS_ORIGIN: z.string().default('https://appmock.localhost:8443,https://admin.localhost:8443,https://webmock.localhost:8443')
})

const env = envSchema.parse(process.env)

export const serviceMockApiConfig = {
  host: env.SERVICEMOCK_API_HOST,
  port: env.SERVICEMOCK_API_PORT,
  publicUrl: env.SERVICEMOCK_API_PUBLIC_URL,
  audience: env.SERVICEMOCK_API_AUDIENCE,
  issuer: `${env.KEYCLOAK_PUBLIC_URL}/realms/${env.KEYCLOAK_REALM}`,
  jwksUrl: `${env.KEYCLOAK_BASE_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/certs`,
  corsOrigins: env.CORS_ORIGIN.split(',').map((value) => value.trim())
}
