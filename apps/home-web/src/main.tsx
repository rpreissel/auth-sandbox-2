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
        detail: 'Admin Web sends userId, person data, optional activation code, and optional phone number so auth-api can create or refresh a reusable registration identity.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Ensure Keycloak user exists',
        detail: 'Auth-api calls the Keycloak Admin API and ensures that a realm user exists whose username stays exactly equal to userId, creating the user only when no matching account already exists.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Persist prepared registration channels',
        detail: 'Auth-api stores the person identity together with the reusable code and SMS records that later registration flows resolve against.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Upsert person, code, and SMS records',
        detail: 'The backend inserts or updates the person, code, and SMS records so later registration flows can offer only the services that actually exist.'
      },
      {
        from: 'Auth API',
        to: 'Admin Web',
        label: 'Return masked registration preview',
        detail: 'The response returns the prepared identity together with the current code and SMS data for onboarding.'
      },
      {
        from: 'Auth API',
        to: 'Admin Web',
        label: 'Return prepared identity',
        detail: 'Admin can review the prepared identity later and use it for follow-up enrollment.'
      }
    ]
  },
  {
    title: 'Device registration and password bootstrap',
    summary: 'AppMock Web runs the registration flow, stores the custom device credential, and triggers backend password setup when the user still has none.',
    actors: ['AppMock Web', 'Auth API', 'Postgres', 'Keycloak'],
    steps: [
      {
        from: 'AppMock Web',
        to: 'Auth API',
        label: 'Start registration flow with device material',
        detail: 'AppMock Web creates fresh device key material and sends the identity input, device name, public key, and required assurance level to auth-api.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Create flow and available services',
        detail: 'Auth-api stores the registration flow and determines which prepared verification services are available for this identity.'
      },
      {
        from: 'Auth API',
        to: 'AppMock Web',
        label: 'Return verification options and flow state',
        detail: 'The client receives the flow state and the available verification options for the next step.'
      },
      {
        from: 'AppMock Web',
        to: 'Auth API',
        label: 'Complete code or SMS verification',
        detail: 'AppMock Web selects person code or SMS-TAN, starts the chosen method when needed, and submits the entered code or TAN.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Consume verification and bind flow to user',
        detail: 'The backend verifies the submitted code or TAN, enforces validity, and marks the registration flow as verified for the resolved user.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Create device credential',
        detail: 'During finalization auth-api creates the custom device credential in Keycloak and binds it to the resolved user.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Persist device and password status',
        detail: 'Auth-api stores the device binding and returns whether password setup is still required for the user.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Check whether password credential exists',
        detail: 'After storing the device binding, auth-api fetches the user credentials from the Keycloak Admin API and checks whether any credential of type password already exists for the same user.'
      },
      {
        from: 'Auth API',
        to: 'AppMock Web',
        label: 'Return registration result',
        detail: 'The app learns whether it can continue directly into device login or must complete backend-driven password setup first.'
      },
      {
        from: 'AppMock Web',
        to: 'Auth API',
        label: 'Submit initial password when required',
        detail: 'If no password exists yet, the app sends the chosen password through auth-api instead of using Keycloak required actions.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Set password via Admin API',
        detail: 'Auth-api resolves the Keycloak user by username and calls the Admin API reset-password endpoint with temporary=false so the initial password becomes a normal stored password credential immediately.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Mark password bootstrap complete',
        detail: 'The device binding is now treated as fully activated, so the app can continue into encrypted login.'
      }
    ]
  },
  {
    title: 'Encrypted device login and protected API use',
    summary: 'A saved device turns the encrypted challenge into OIDC tokens and immediately uses them against the protected mock API.',
    actors: ['AppMock Web', 'Auth API', 'Postgres', 'Keycloak', 'ServiceMock API'],
    steps: [
      {
        from: 'AppMock Web',
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
        to: 'AppMock Web',
        label: 'Return challenge metadata and expiry',
        detail: 'The response includes the encrypted challenge data together with the nonce and expiry information.'
      },
      {
        from: 'Auth API',
        to: 'AppMock Web',
        label: 'Return encrypted payload',
        detail: 'Only the registered device key can sign the payload that comes back to the browser.'
      },
      {
        from: 'AppMock Web',
        to: 'Auth API',
        label: 'Submit signature over challenge',
        detail: 'The browser signs the base64-decoded encryptedData blob locally with the stored RSA private key using RSASSA-PKCS1-v1_5 plus SHA-256, then sends the signature together with nonce, encrypted payload parts, and IV without ever exporting the private key.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Verify nonce, binding, and replay window',
        detail: 'Auth-api loads the login_challenges row by nonce, rejects unknown, used, or expired challenges, and confirms that the handoff still belongs to the originally stored userId, deviceId, and publicKeyHash binding.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Exchange custom device-login grant',
        detail: 'Auth-api marks the challenge as used and forwards a base64url login token into the custom device-login grant. In Keycloak, the extension finds the stored device credential for the user by matching publicKeyHash, reads the PEM public key from that credential, base64-decodes encryptedData, and verifies the submitted signature with SHA256withRSA against exactly that encryptedData payload before issuing access, ID, and refresh tokens.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Record login outcome and last-used device',
        detail: 'The successful login updates the stored device usage state.'
      },
      {
        from: 'Auth API',
        to: 'AppMock Web',
        label: 'Return token bundle',
        detail: 'The app receives the access, ID, and refresh tokens for the authenticated device session.'
      },
      {
        from: 'AppMock Web',
        to: 'ServiceMock API',
        label: 'Call protected endpoint',
        detail: 'The access token is used immediately against the demo API to prove the issued session is usable.'
      },
      {
        from: 'ServiceMock API',
        to: 'Keycloak',
        label: 'Validate JWT through JWKS',
        detail: 'Mock-api verifies the token signature and audience before returning the protected response.'
      },
      {
        from: 'ServiceMock API',
        to: 'AppMock Web',
        label: 'Return protected business response',
        detail: 'The protected API returns a successful business response for the authenticated session.'
      }
    ]
  },
  {
    title: 'Refresh and logout lifecycle',
    summary: 'The device session stays renewable through Keycloak refresh tokens and can be revoked again through the logout endpoint.',
    actors: ['AppMock Web', 'Auth API', 'Keycloak'],
    steps: [
      {
        from: 'AppMock Web',
        to: 'Auth API',
        label: 'Refresh token bundle',
        detail: 'When the session should continue, AppMock Web sends the current refresh token to auth-api.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Redeem refresh token',
        detail: 'Auth-api posts grant_type=refresh_token together with the OIDC client credentials to the Keycloak token endpoint and asks for a fresh access, ID, and refresh-token bundle for the existing device session.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Rotate refresh-token session state',
        detail: 'Keycloak can rotate the refresh token and extend the server-side session lifetime while preserving the existing user session, so no new device challenge or browser authentication step is required.'
      },
      {
        from: 'Auth API',
        to: 'AppMock Web',
        label: 'Return rotated tokens',
        detail: 'Auth-api returns a renewed token bundle and the app replaces its stored session tokens.'
      },
      {
        from: 'AppMock Web',
        to: 'Auth API',
        label: 'Request logout',
        detail: 'To end the session, AppMock Web sends the still-valid refresh token to auth-api.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Revoke session at logout endpoint',
        detail: 'Auth-api posts client credentials plus the refresh token to the Keycloak logout endpoint, which invalidates the linked refresh token and ends the server-side OIDC session for that client session.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Reject future refresh redemption',
        detail: 'After logout the old refresh token becomes unusable for the refresh_token grant, which means the next session must go back through a fresh encrypted device-login challenge and signature proof.'
      },
      {
        from: 'Auth API',
        to: 'AppMock Web',
        label: 'Confirm local session clear',
        detail: 'The app clears its session tokens but keeps the stored device binding for later login.'
      }
    ]
  },
  {
    title: 'SSO bootstrap from device app into WebMock',
    summary: 'AppMock Web can prepare an allowlisted browser bootstrap into WebMock through auth-api and Keycloak PAR state.',
    actors: ['AppMock Web', 'Auth API', 'Keycloak', 'WebMock Web'],
    steps: [
      {
        from: 'AppMock Web',
        to: 'Auth API',
        label: 'Create SSO bootstrap launch',
        detail: 'AppMock Web creates a controlled browser bootstrap request from the current authenticated device context.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Create PAR-based auth launch',
        detail: 'Auth-api verifies that the bearer subject matches the requested user, consumes the device-login challenge into a login_token, creates a signed short-lived bootstrap state, and posts a PAR request with login_token, state, requested acr, client credentials, and redirect_uri to Keycloak.'
      },
      {
        from: 'Auth API',
        to: 'Auth API',
        label: 'Persist signed bootstrap state and allowlisted target',
        detail: 'The state payload is an HMAC-signed base64url envelope that carries jti, targetId, targetClientId, normalized targetPath, requestedAcr, and exp so the callback can reject tampered state, expired launches, or target paths that leave the allowlisted origin.'
      },
      {
        from: 'Auth API',
        to: 'AppMock Web',
        label: 'Return launch URL and target',
        detail: 'The response returns the prepared Keycloak launch URL together with the resolved target URL.'
      },
      {
        from: 'AppMock Web',
        to: 'Keycloak',
        label: 'Open bootstrap login tab',
        detail: 'The browser opens the prepared launch URL instead of constructing its own redirect path.'
      },
      {
        from: 'Keycloak',
        to: 'Auth API',
        label: 'Redeem callback and resolve target',
        detail: 'After the authorization code redirect reaches auth-api, the callback redeems the code with the bootstrap client credentials, validates the HMAC-signed state with timing-safe comparison, checks expiry and target metadata, and rebuilds the final allowlisted browser destination.'
      },
      {
        from: 'Auth API',
        to: 'WebMock Web',
        label: 'Attach browser session bootstrap context',
        detail: 'The browser arrives in WebMock with a normal Keycloak browser session established during the bootstrap flow.'
      },
      {
        from: 'Auth API',
        to: 'WebMock Web',
        label: 'Redirect into WebMock',
        detail: 'Auth-api returns a 303 redirect to the allowlisted WebMock URL, and the browser lands there with a ready Keycloak session that can continue either as 1se or directly request a stronger 2se step-up path.'
      }
    ]
  },
  {
    title: 'Browser login and inline 2se step-up',
    summary: 'WebMock Web starts at 1se, then Keycloak upgrades the browser session through the inline SMS-TAN backchannel flow.',
    actors: ['WebMock Web', 'Keycloak', 'KC Extension', 'Auth API', 'Postgres'],
    steps: [
      {
        from: 'WebMock Web',
        to: 'Keycloak',
        label: 'Sign in with acr_values=1se',
        detail: 'WebMock starts a normal browser login at assurance level 1se.'
      },
      {
        from: 'Keycloak',
        to: 'WebMock Web',
        label: 'Return 1se session and tokens',
        detail: 'Keycloak returns a browser session and tokens that satisfy 1se.'
      },
      {
        from: 'WebMock Web',
        to: 'WebMock Web',
        label: 'Detect stronger endpoint requirement',
        detail: 'WebMock detects that a stronger endpoint still requires a 2se step-up.'
      },
      {
        from: 'WebMock Web',
        to: 'Keycloak',
        label: 'Start fresh auth with acr_values=2se',
        detail: 'For step-up, WebMock sends the browser through a fresh OIDC authorization request with acr_values=2se so Keycloak can re-run the authentication flow and decide whether extra authenticators must execute.'
      },
      {
        from: 'Keycloak',
        to: 'KC Extension',
        label: 'Enter inline browser step-up branch',
        detail: 'Keycloak routes the stronger request into the custom inline step-up branch.'
      },
      {
        from: 'KC Extension',
        to: 'Auth API',
        label: 'Start internal browser step-up',
        detail: 'The extension starts an internal SMS-TAN step-up flow for the current user through auth-api.'
      },
      {
        from: 'Auth API',
        to: 'Postgres',
        label: 'Create flow, challenge, and result code',
        detail: 'Auth-api stores the step-up flow state, SMS challenge, and final result data.'
      },
      {
        from: 'Auth API',
        to: 'KC Extension',
        label: 'Return masked target and demo TAN',
        detail: 'The extension receives the masked target and the challenge data needed for inline verification.'
      },
      {
        from: 'KC Extension',
        to: 'Keycloak',
        label: 'Render inline challenge page',
        detail: 'Keycloak renders the inline SMS-TAN challenge inside the same browser login flow.'
      },
      {
        from: 'WebMock Web',
        to: 'Keycloak',
        label: 'Submit SMS-TAN in Keycloak form',
        detail: 'The user submits the SMS-TAN directly in the Keycloak form.'
      },
      {
        from: 'KC Extension',
        to: 'Auth API',
        label: 'Complete and redeem step-up result',
        detail: 'The extension completes the SMS-TAN step-up through auth-api and receives the stronger assurance result.'
      },
      {
        from: 'KC Extension',
        to: 'Keycloak',
        label: 'Promote browser session to 2se',
        detail: 'The authenticator upgrades the active browser session to 2se before redirecting back to the client.'
      },
      {
        from: 'Keycloak',
        to: 'WebMock Web',
        label: 'Return upgraded 2se session',
        detail: 'WebMock receives an upgraded browser session and tokens that satisfy 2se.'
      }
    ]
  },
  {
    title: 'Trace capture and inspection',
    summary: 'Browser clients, backend services, Keycloak calls, and proxy hops are stitched together through trace IDs, artifacts, and Caddy logs.',
    actors: ['Browser Apps', 'Auth API', 'ServiceMock API', 'Keycloak', 'Trace API', 'Trace Web', 'Caddy'],
    steps: [
      {
        from: 'Browser Apps',
        to: 'Auth API',
        label: 'Send API calls with trace headers',
        detail: 'Browser apps send their requests with trace and correlation headers so downstream calls can stay linked.'
      },
      {
        from: 'Browser Apps',
        to: 'Trace API',
        label: 'Emit client events',
        detail: 'Browser clients also emit client events so trace records include the originating user action.'
      },
      {
        from: 'Auth API',
        to: 'Trace API',
        label: 'Write server spans and decoded artifacts',
        detail: 'Auth-api writes server spans and artifacts into the shared trace store while preserving the incoming trace IDs.'
      },
      {
        from: 'Auth API',
        to: 'Keycloak',
        label: 'Record outbound spans and artifacts',
        detail: 'Outbound Keycloak calls are recorded as nested spans so the cross-service flow stays connected.'
      },
      {
        from: 'ServiceMock API',
        to: 'Trace API',
        label: 'Persist server spans through shared observability writes',
        detail: 'Protected downstream services keep the same trace chain and add their own server spans and artifacts.'
      },
      {
        from: 'Trace Web',
        to: 'Trace API',
        label: 'Load traces, spans, and artifacts',
        detail: 'Trace Web loads traces, spans, and artifacts from Trace API for inspection.'
      },
      {
        from: 'Trace Web',
        to: 'Caddy',
        label: 'Cross-check proxy hops by correlation ID',
        detail: 'Trace Web can also compare proxy hops from Caddy with the recorded trace chain.'
      },
      {
        from: 'Trace Web',
        to: 'Browser Apps',
        label: 'Explain full request journey',
        detail: 'The final trace view combines the recorded events and spans into one request journey across the sandbox.'
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
        <LinkCard title="AppMock Web" href="https://appmock.localhost:8443" description="Register a device, log in, inspect tokens and claims." />
        <LinkCard title="WebMock Web" href="https://webmock.localhost:8443" description="Browser Keycloak login with 1se-by-default and an interactive 2se step-up path." />
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
          encrypted login, token lifecycle, SSO bootstrap, browser 2se step-up, and trace inspection.
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

      <ol className="sequence-steps" aria-label={`${props.title} step details`}>
        {props.steps.map((step, index) => (
          <li key={`${step.from}-${step.to}-${index}`} className="sequence-step-item">
            <p className="sequence-step-heading">
              <span className="sequence-step-number">{index + 1}</span>
              <strong>{step.label}</strong>
              <span className="sequence-step-route">
                {step.from} to {step.to}
              </span>
            </p>
            <p className="sequence-step-detail">{step.detail}</p>
          </li>
        ))}
      </ol>
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
      sequenceNumberColor: '#ffffff',
      sequenceNumberBkgColor: '#102033',
      sequenceNumberBorderColor: '#102033'
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
