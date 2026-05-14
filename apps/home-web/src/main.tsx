import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'

const diagramsGithubUrl = 'https://github.com/rpreissel/auth-sandbox-2/blob/main/docs/diagrams/README.md'

function HomeApp() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">auth-sandbox-2</p>
        <h1>Minimal device-login sandbox with Keycloak, OpenTofu, and browser tooling.</h1>
        <p>
          This project focuses only on registration codes, device registration, encrypted challenge login,
          backend-driven password setup, the TAN Mock identity broker, token inspection, refresh, and logout.
        </p>
      </section>

      <section className="grid links">
        <LinkCard title="Homepage" href="https://home.localhost:8443" description="Overview and links." />
        <LinkCard title="AppMock Web" href="https://appmock.localhost:8443" description="Register a device, log in, inspect tokens and claims." />
        <LinkCard title="WebMock Web" href="https://webmock.localhost:8443" description="Browser Keycloak login with 1se-by-default and an interactive 2se step-up path." />
        <LinkCard title="Admin Web" href="https://admin.localhost:8443" description="Create registration codes, manage TAN broker entries, and inspect existing device bindings." />
        <LinkCard title="Trace Viewer" href="https://trace.localhost:8443/" description="Inspect full demo traces, decoded JWTs, encrypted payloads, and proxy hops." />
        <LinkCard title="Auth API" href="https://auth.localhost:8443/api/health" description="Fastify backend health endpoint." />
        <LinkCard title="Keycloak" href="https://keycloak.localhost:8443" description="Realm, users, credentials, and admin console." />
        <LinkCard title="DB Viewer" href="https://db.localhost:8443" description="Inspect the shared Postgres database and its auth_api and keycloak schemas." />
      </section>

      <section className="panel login-panel">
        <h2>DB viewer login</h2>
        <p className="panel-copy">
          Adminer can default the server, but it does not cleanly prefill the full login in this local setup. Use these credentials for the shared database.
        </p>
        <div className="login-grid" aria-label="DB viewer login details">
          <CredentialItem label="URL" value="https://db.localhost:8443" />
          <CredentialItem label="System" value="PostgreSQL" />
          <CredentialItem label="Server" value="postgres" />
          <CredentialItem label="Username" value="postgres" />
          <CredentialItem label="Password" value="postgres" />
          <CredentialItem label="Database" value="auth_sandbox_2" />
          <CredentialItem label="Schemas" value="auth_api, keycloak" />
        </div>
      </section>

      <section className="panel">
        <a className="link-card diagram-link-card" href={diagramsGithubUrl} target="_blank" rel="noreferrer">
          <strong>GitHub-Diagramme</strong>
          <span>Alle Architektur-, Ablauf- und Datenbankdiagramme direkt auf GitHub ansehen.</span>
          <span className="diagram-link-cta">Diagramm-Dokumentation auf GitHub oeffnen</span>
          <code>{diagramsGithubUrl}</code>
        </a>
      </section>
    </main>
  )
}

function LinkCard(props: { title: string; href: string; description: string }) {
  return (
    <a className="link-card" href={props.href} target="_blank" rel="noreferrer">
      <strong>{props.title}</strong>
      <span>{props.description}</span>
      <code>{props.href}</code>
    </a>
  )
}

function CredentialItem(props: { label: string; value: string }) {
  return (
    <article className="credential-item">
      <span>{props.label}</span>
      <code>{props.value}</code>
    </article>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HomeApp />
  </StrictMode>
)
