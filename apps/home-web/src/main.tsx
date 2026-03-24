import { StrictMode, useEffect, useId, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'

type SequenceStep = {
  from: string
  to: string
  label: string
  detail: string
}

type SequenceDiagramDefinition = {
  title: string
  summary: string
  actors: string[]
  steps: SequenceStep[]
}

const sequenceDiagrams: SequenceDiagramDefinition[] = [
  {
    title: 'Admin provisioning and registration identity',
    summary: 'Admin Web prepares the reusable person, code, and phone records before a device starts enrollment.',
    actors: ['Admin Web', 'Auth API', 'Keycloak', 'Postgres'],
    steps: [
      {
        from: 'Admin Web',
        to: 'Auth API',
        label: 'Create registration identity',
        detail: 'Admin submits userId, person data, optional activation code, and optional phone number.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Ensure Keycloak user exists',
        detail: 'The backend keeps the Keycloak username equal to userId and creates the user only when needed.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Upsert person, code, and SMS records',
        detail: 'Registration identities are stored as reusable records that later flows can verify against.'
      },
      {
        from: 'Auth API',
        to: 'Admin Web',
        label: 'Return prepared identity',
        detail: 'Admin can review the created registration inputs and use them for later device enrollment.'
      }
    ]
  },
  {
    title: 'Device registration and password bootstrap',
    summary: 'App Web runs the registration flow, stores the custom device credential, and triggers backend password setup when the user still has none.',
    actors: ['App Web', 'Auth API', 'Postgres', 'Keycloak'],
    steps: [
      {
        from: 'App Web',
        to: 'Auth API',
        label: 'Start registration flow with device material',
        detail: 'The app sends userId, device name, and the public signing key so auth-api can create a registration flow.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Create flow and available services',
        detail: 'The backend persists the registration flow state and exposes code or SMS-TAN verification options.'
      },
      {
        from: 'App Web',
        to: 'Auth API',
        label: 'Complete code or SMS verification',
        detail: 'The user finishes the selected registration service and proves control over the prepared identity.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Create device credential',
        detail: 'Auth-api creates the custom device credential in Keycloak while keeping the credential concept intact.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Persist device and password status',
        detail: 'Device metadata, public-key hashes, and the password-setup-required flag are stored in the auth database.'
      },
      {
        from: 'Auth API',
        to: 'App Web',
        label: 'Return registration result',
        detail: 'The app learns whether it can continue directly or must ask the backend to set an initial password.'
      },
      {
        from: 'App Web',
        to: 'Auth API',
        label: 'Submit initial password when required',
        detail: 'If the user has no password yet, the app submits one through the backend instead of using Keycloak required actions.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Set password via Admin API',
        detail: 'The backend resets the Keycloak password directly and then the saved device binding is ready for automatic login.'
      }
    ]
  },
  {
    title: 'Encrypted device login and protected API use',
    summary: 'A saved device turns the encrypted challenge into OIDC tokens and immediately uses them against the protected mock API.',
    actors: ['App Web', 'Auth API', 'Postgres', 'Keycloak', 'Mock API'],
    steps: [
      {
        from: 'App Web',
        to: 'Auth API',
        label: 'Request encrypted challenge',
        detail: 'The app starts login by sending the stored public-key hash from the saved device binding.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Load device and persist nonce',
        detail: 'Auth-api looks up the device, creates a short-lived encrypted challenge, and stores the nonce for verification.'
      },
      {
        from: 'Auth API',
        to: 'App Web',
        label: 'Return encrypted payload',
        detail: 'Only the registered device key can sign the payload that comes back to the browser.'
      },
      {
        from: 'App Web',
        to: 'Auth API',
        label: 'Submit signature over challenge',
        detail: 'The browser signs the encrypted data locally and sends the signature back without exporting the private key.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Exchange custom device-login grant',
        detail: 'After signature validation, auth-api exchanges the verified login with Keycloak for access, ID, and refresh tokens.'
      },
      {
        from: 'Auth API',
        to: 'App Web',
        label: 'Return token bundle',
        detail: 'The app receives the full token set plus decoded claims for inspection in the UI.'
      },
      {
        from: 'App Web',
        to: 'Mock API',
        label: 'Call protected endpoint',
        detail: 'The access token is used immediately against the demo API to prove the issued session is usable.'
      },
      {
        from: 'Mock API',
        to: 'Keycloak',
        label: 'Validate JWT through JWKS',
        detail: 'Mock-api verifies the token signature and audience before returning the protected response.'
      }
    ]
  },
  {
    title: 'Refresh and logout lifecycle',
    summary: 'The device session stays renewable through Keycloak refresh tokens and can be revoked again through the logout endpoint.',
    actors: ['App Web', 'Auth API', 'Keycloak'],
    steps: [
      {
        from: 'App Web',
        to: 'Auth API',
        label: 'Refresh token bundle',
        detail: 'The app sends the current refresh token when the demo session should continue without a new device signature.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Redeem refresh token',
        detail: 'Auth-api exchanges the refresh token at the Keycloak token endpoint and receives a renewed session bundle.'
      },
      {
        from: 'Auth API',
        to: 'App Web',
        label: 'Return rotated tokens',
        detail: 'The app updates its token wallet, decoded claims, and downstream API state with the fresh credentials.'
      },
      {
        from: 'App Web',
        to: 'Auth API',
        label: 'Request logout',
        detail: 'The demo ends the current device session by sending the remaining refresh token to auth-api.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Revoke session at logout endpoint',
        detail: 'The backend calls the Keycloak logout endpoint so the refresh token and server-side session are invalidated.'
      },
      {
        from: 'Auth API',
        to: 'App Web',
        label: 'Confirm local session clear',
        detail: 'The UI drops its local tokens but keeps the device binding so a new encrypted login can start again later.'
      }
    ]
  },
  {
    title: 'Browser login and inline 2se step-up',
    summary: 'Mock Web starts at 1se, then Keycloak upgrades the browser session through the inline SMS-TAN backchannel flow.',
    actors: ['Mock Web', 'Keycloak', 'KC Extension', 'Auth API', 'Postgres'],
    steps: [
      {
        from: 'Mock Web',
        to: 'Keycloak',
        label: 'Sign in with acr_values=1se',
        detail: 'The browser login begins at the weaker level and returns a normal Keycloak browser session.'
      },
      {
        from: 'Keycloak',
        to: 'Mock Web',
        label: 'Return 1se session and tokens',
        detail: 'Mock Web can inspect the current acr and shows that stronger endpoints still require a step-up.'
      },
      {
        from: 'Mock Web',
        to: 'Keycloak',
        label: 'Start fresh auth with acr_values=2se',
        detail: 'The browser explicitly asks for a stronger assurance level instead of using a public shortcut endpoint.'
      },
      {
        from: 'Keycloak',
        to: 'KC Extension',
        label: 'Enter inline browser step-up branch',
        detail: 'LoA conditions route the request into the custom Keycloak extension that drives the backchannel flow.'
      },
      {
        from: 'KC Extension',
        to: 'Auth API',
        label: 'Start internal browser step-up',
        detail: 'The extension calls auth-api with its internal service-account bearer to create the SMS-TAN challenge.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Create flow, challenge, and result code',
        detail: 'Auth-api stores the step-up flow state and the SMS challenge artifacts that Keycloak will display inline.'
      },
      {
        from: 'Auth API',
        to: 'KC Extension',
        label: 'Return masked target and demo TAN',
        detail: 'The extension gets the inline challenge payload and renders the SMS-TAN form directly inside Keycloak.'
      },
      {
        from: 'Mock Web',
        to: 'Keycloak',
        label: 'Submit SMS-TAN in Keycloak form',
        detail: 'The user completes the stronger factor without leaving the Keycloak browser flow.'
      },
      {
        from: 'KC Extension',
        to: 'Auth API',
        label: 'Complete and redeem step-up result',
        detail: 'The extension finalizes the flow and redeems the result code so Keycloak receives the upgraded assurance context.'
      },
      {
        from: 'Keycloak',
        to: 'Mock Web',
        label: 'Return upgraded 2se session',
        detail: 'The browser session and tokens now satisfy the stronger endpoint requirements.'
      }
    ]
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
        <LinkCard title="Mock Web" href="https://mock.localhost:8443" description="Browser Keycloak login with 1se-by-default and an interactive 2se step-up path." />
        <LinkCard title="Admin Web" href="https://admin.localhost:8443" description="Create registration codes and inspect existing device bindings." />
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
        <h2>Sequence diagrams</h2>
        <p className="panel-copy">
          The homepage now maps the full sandbox journey: admin provisioning, device enrollment, backend-driven password setup,
          encrypted login, token lifecycle, and browser 2se step-up.
        </p>
        <div className="sequence-stack">
          {sequenceDiagrams.map((diagram) => (
            <SequenceDiagram
              key={diagram.title}
              title={diagram.title}
              summary={diagram.summary}
              actors={diagram.actors}
              steps={diagram.steps}
            />
          ))}
        </div>
      </section>
    </main>
  )
}

function SequenceDiagram(props: { title: string; summary: string; actors: string[]; steps: SequenceStep[] }) {
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
        <p className="sequence-summary">{props.summary}</p>
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
