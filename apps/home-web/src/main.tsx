import { StrictMode, useEffect, useId, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'

type SequenceStep = {
  from: string
  to: string
  label: string
  detail: string
}

const registrationActors = ['Admin Web', 'Auth API', 'Postgres', 'Keycloak', 'App Web']

const registrationSteps: SequenceStep[] = [
  {
    from: 'Admin Web',
    to: 'Auth API',
    label: 'Create registration code',
    detail: 'Admin enters a userId and asks the backend for an activation code.'
  },
  {
    from: 'Auth API',
    to: 'Keycloak',
    label: 'Ensure Keycloak user exists',
    detail: 'The backend keeps username equal to userId and creates the user when needed.'
  },
  {
    from: 'Auth API',
    to: 'Postgres',
    label: 'Store code metadata',
    detail: 'The activation code, expiry, and usage counters are persisted for later device registration.'
  },
  {
    from: 'App Web',
    to: 'Auth API',
    label: 'Register device with code + key',
    detail: 'The app submits userId, device name, activation code, and the public signing key.'
  },
  {
    from: 'Auth API',
    to: 'Keycloak',
    label: 'Create device credential',
    detail: 'The backend stores the custom credential in Keycloak and checks whether a password already exists.'
  },
  {
    from: 'Auth API',
    to: 'Postgres',
    label: 'Persist device record',
    detail: 'Device metadata, key hashes, and encrypted challenge material are stored in the auth database.'
  }
]

const loginActors = ['App Web', 'Auth API', 'Postgres', 'Keycloak']

const loginSteps: SequenceStep[] = [
  {
    from: 'App Web',
    to: 'Auth API',
    label: 'Request encrypted challenge',
    detail: 'The app starts login by sending the stored public-key hash.'
  },
  {
    from: 'Auth API',
    to: 'Postgres',
    label: 'Load device and save challenge',
    detail: 'The backend finds the device, creates a short-lived encrypted challenge, and persists the nonce.'
  },
  {
    from: 'Auth API',
    to: 'App Web',
    label: 'Return encrypted payload',
    detail: 'The app receives encrypted data that only the registered device key can sign.'
  },
  {
    from: 'App Web',
    to: 'Auth API',
    label: 'Submit signed challenge',
    detail: 'The browser signs the encrypted payload locally and sends the signature back to the backend.'
  },
  {
    from: 'Auth API',
    to: 'Keycloak',
    label: 'Exchange login token for OIDC tokens',
    detail: 'The backend turns the verified device login into Keycloak access, ID, and refresh tokens.'
  },
  {
    from: 'Keycloak',
    to: 'App Web',
    label: 'Use tokens, refresh, and logout',
    detail: 'The app shows token claims, can refresh the session, and can revoke it again via logout.'
  }
]

type MermaidModule = typeof import('mermaid')

let mermaidModulePromise: Promise<MermaidModule['default']> | undefined
let mermaidInitialized = false

function HomeApp() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">auth-sandbox-2</p>
        <h1>Minimal device-login sandbox with Keycloak, OpenTofu, and browser tooling.</h1>
        <p>
          This project focuses only on registration codes, device registration, encrypted challenge login,
          backend-driven password setup, token inspection, refresh, and logout.
        </p>
      </section>

      <section className="grid links">
        <LinkCard title="Homepage" href="https://home.localhost:8443" description="Overview, links, and sequence diagrams." />
        <LinkCard title="App Web" href="https://app.localhost:8443" description="Register a device, log in, inspect tokens and claims." />
        <LinkCard title="Admin Web" href="https://admin.localhost:8443" description="Create registration codes and inspect devices." />
        <LinkCard title="Auth API" href="https://auth.localhost:8443/api/health" description="Fastify backend health endpoint." />
        <LinkCard title="Keycloak" href="https://keycloak.localhost:8443" description="Realm, users, credentials, and admin console." />
        <LinkCard title="DB Viewer" href="https://db.localhost:8443" description="Inspect the shared Postgres database and its auth_api and keycloak schemas." />
      </section>

      <section className="panel">
        <h2>Sequence diagrams</h2>
        <p className="panel-copy">
          The sandbox has two important sequences: provisioning a device and then turning that device into a Keycloak session.
        </p>
        <div className="sequence-stack">
          <SequenceDiagram
            title="Registration and device setup"
            actors={registrationActors}
            steps={registrationSteps}
          />
          <SequenceDiagram
            title="Encrypted login and token lifecycle"
            actors={loginActors}
            steps={loginSteps}
          />
        </div>
      </section>
    </main>
  )
}

function SequenceDiagram(props: { title: string; actors: string[]; steps: SequenceStep[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const diagramId = useId().replace(/:/g, '-')
  const definition = useMemo(() => buildSequenceDefinition(props.actors, props.steps), [props.actors, props.steps])

  useEffect(() => {
    let cancelled = false

    async function renderDiagram() {
      const mermaid = await loadMermaid()

      try {
        const { svg, bindFunctions } = await mermaid.render(`mermaid-${diagramId}`, definition)

        if (cancelled || !containerRef.current) {
          return
        }

        containerRef.current.innerHTML = svg
        bindFunctions?.(containerRef.current)
      } catch {
        if (containerRef.current) {
          containerRef.current.textContent = 'Diagram rendering failed.'
        }
      }
    }

    void renderDiagram()

    return () => {
      cancelled = true
    }
  }, [definition, diagramId])

  return (
    <article className="sequence-card">
      <header>
        <h3>{props.title}</h3>
        <div className="sequence-actors" aria-label={`${props.title} actors`}>
          {props.actors.map((actor) => (
            <span key={actor}>{actor}</span>
          ))}
        </div>
      </header>

      <div className="mermaid-shell">
        <div ref={containerRef} className="mermaid-diagram" aria-label={`${props.title} mermaid sequence diagram`} />
      </div>
    </article>
  )
}

async function loadMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then((module) => module.default)
  }

  const mermaid = await mermaidModulePromise

  if (mermaidInitialized) {
    return mermaid
  }

  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    themeVariables: {
      primaryColor: '#fff8f2',
      primaryTextColor: '#102033',
      primaryBorderColor: '#d8b08d',
      lineColor: '#b24a1f',
      actorBorder: '#1f736b',
      actorBkg: '#eef6fa',
      actorTextColor: '#102033',
      signalColor: '#102033',
      signalTextColor: '#102033',
      labelBoxBkgColor: '#fff4e8',
      labelBoxBorderColor: '#d8b08d',
      labelTextColor: '#102033',
      noteBkgColor: '#fffdf8',
      noteBorderColor: '#d8b08d',
      noteTextColor: '#102033',
      activationBorderColor: '#1f736b',
      activationBkgColor: '#dff1ef',
      sequenceNumberColor: '#b24a1f'
    }
  })

  mermaidInitialized = true
  return mermaid
}

function buildSequenceDefinition(actors: string[], steps: SequenceStep[]) {
  const lines = ['sequenceDiagram', 'autonumber']

  for (const actor of actors) {
    const alias = actorAlias(actor)
    const keyword = actor.includes('Web') ? 'actor' : 'participant'
    lines.push(`${keyword} ${alias} as ${actor}`)
  }

  for (const step of steps) {
    const from = actorAlias(step.from)
    const to = actorAlias(step.to)
    lines.push(`${from}->>${to}: ${escapeMermaid(step.label)}`)
    lines.push(`Note over ${from},${to}: ${escapeMermaid(step.detail)}`)
  }

  return lines.join('\n')
}

function actorAlias(actor: string) {
  return actor.replace(/[^A-Za-z0-9]/g, '_')
}

function escapeMermaid(value: string) {
  return value.replace(/:/g, ' -').replace(/\n/g, '<br/>')
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
