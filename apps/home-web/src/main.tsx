import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'

function HomeApp() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">auth-sandbox-2</p>
        <h1>Minimal device-login sandbox with Keycloak, OpenTofu, observability, and browser tooling.</h1>
        <p>
          This project focuses only on registration codes, device registration, encrypted challenge login,
          backend-driven password setup, token inspection, refresh, and logout.
        </p>
      </section>

      <section className="grid links">
        <LinkCard title="Homepage" href="https://home.localhost:8443" description="Overview, links, and flow diagram." />
        <LinkCard title="App Web" href="https://app.localhost:8443" description="Register a device, log in, inspect tokens and claims." />
        <LinkCard title="Admin Web" href="https://admin.localhost:8443" description="Create registration codes and inspect devices." />
        <LinkCard title="Auth API" href="https://auth.localhost:8443/api/health" description="Fastify backend health endpoint." />
        <LinkCard title="Keycloak" href="https://keycloak.localhost:8443" description="Realm, users, credentials, and admin console." />
        <LinkCard title="Grafana" href="https://grafana.localhost:8443" description="Trace, log, and error correlation." />
      </section>

      <section className="panel">
        <h2>Main flows</h2>
        <div className="flow-grid">
          <article>
            <strong>1. Registration code</strong>
            <p>Admin creates a code for a `userId`. The backend ensures the Keycloak user exists.</p>
          </article>
          <article>
            <strong>2. Device registration</strong>
            <p>App sends user, device name, activation code, and signing key. Backend stores DB state and Keycloak credential.</p>
          </article>
          <article>
            <strong>3. Password step</strong>
            <p>Backend checks Keycloak password state. If missing, the frontend sends a password and the backend sets it.</p>
          </article>
          <article>
            <strong>4. Encrypted login</strong>
            <p>App requests a challenge, signs the encrypted payload, and exchanges it through Keycloak for tokens.</p>
          </article>
          <article>
            <strong>5. Token lifecycle</strong>
            <p>App displays tokens and claims, then supports refresh and logout.</p>
          </article>
          <article>
            <strong>6. Observability</strong>
            <p>Grafana, Tempo, and Loki show spans, errors, and correlated logs.</p>
          </article>
        </div>
      </section>

      <section className="panel diagram-panel">
        <h2>Flow diagram</h2>
        <div className="diagram">
          <div>Admin Web</div>
          <span>creates code</span>
          <div>Auth API</div>
          <span>ensures user</span>
          <div>Keycloak</div>
          <span>device register</span>
          <div>App Web</div>
          <span>stores device</span>
          <div>Postgres</div>
          <span>encrypted challenge</span>
          <div>Auth API</div>
          <span>login token</span>
          <div>Keycloak</div>
          <span>tokens + logs</span>
          <div>Grafana</div>
        </div>
      </section>
    </main>
  )
}

function LinkCard(props: { title: string; href: string; description: string }) {
  return (
    <a className="link-card" href={props.href}>
      <strong>{props.title}</strong>
      <span>{props.description}</span>
      <code>{props.href}</code>
    </a>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HomeApp />
  </StrictMode>
)
