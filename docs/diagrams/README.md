# Diagramme — auth-sandbox-2

Übersicht aller statischen Diagramme im Repository. Alle Diagramme sind GitHub-nativ sichtbar und erfordern keine lokale Runtime.

---

## Datenbankstruktur

| Diagramm | Beschreibung | Link |
|---|---|---|
| auth_api Schema | Vollständige Tabellenstruktur des auth-api-Schemas: devices, device_bindings, login_challenges, assurance_flows, assurance_flow_events, registration_people, registration_person_codes, registration_person_sms_numbers | [diagram.svg](./database/auth-api-schema/diagram.svg) · [README](./database/auth-api-schema/README.md) |

---

## Sequenzdiagramme

### Admin & Registrierung

| Diagramm | Beschreibung | Link |
|---|---|---|
| Admin provisioning and registration identity | Admin Web bereitet wiederverwendbare Person-, Code- und SMS-Datensätze vor, bevor ein Gerät die Registrierung startet | [diagram.svg](./sequences/admin-provisioning-and-registration-identity/diagram.svg) · [README](./sequences/admin-provisioning-and-registration-identity/README.md) |

### EKW-Broker-Login

| Diagramm | Beschreibung | Link |
|---|---|---|
| EKW broker login into WebMock | WebMock bootet eine Keycloak-Session durch den webmock-ekw-login Client, dann stille Promotion auf ein einmaliges target-client handoff via prompt=none | [diagram.svg](./sequences/ekw-broker-login-into-webmock/diagram.svg) · [README](./sequences/ekw-broker-login-into-webmock/README.md) |

### Geräte-Registrierung & Login

| Diagramm | Beschreibung | Link |
|---|---|---|
| Device registration and password bootstrap | AppMock erstellt zuerst ein ungebundenes Gerät, bindet dann die Nutzeridentität, backend-seitige Keycloak-Credential-Erstellung und optionales Password-Setup | [diagram.svg](./sequences/device-registration-and-password-bootstrap/diagram.svg) · [README](./sequences/device-registration-and-password-bootstrap/README.md) |
| Encrypted device login and protected API use | Gespeichertes Gerät wandelt verschlüsselte Challenge in OIDC-Token um und nutzt sie sofort gegen die geschützte Mock-API | [diagram.svg](./sequences/encrypted-device-login-and-protected-api-use/diagram.svg) · [README](./sequences/encrypted-device-login-and-protected-api-use/README.md) |
| Refresh and logout lifecycle | Geräte-Session bleibt erneuerbar durch Keycloak Refresh Tokens und kann über den Logout-Endpoint widerrufen werden | [diagram.svg](./sequences/refresh-and-logout-lifecycle/diagram.svg) · [README](./sequences/refresh-and-logout-lifecycle/README.md) |
| SSO bootstrap from device app into WebMock | AppMock bereitet einen allowlisted Browser-Bootstrap in WebMock durch auth-api und Keycloak PAR state vor | [diagram.svg](./sequences/sso-bootstrap-from-device-app-into-webmock/diagram.svg) · [README](./sequences/sso-bootstrap-from-device-app-into-webmock/README.md) |

### Browser-Step-Up

| Diagramm | Beschreibung | Link |
|---|---|---|
| Browser login and inline 2se step-up | WebMock erreicht 1se durch Passwort-Login oder EKW-Handoff, dann kann Keycloak die Browser-Session auf 2se hochstufen via inline SMS-TAN Backchannel Flow | [diagram.svg](./sequences/browser-login-and-inline-2se-step-up/diagram.svg) · [README](./sequences/browser-login-and-inline-2se-step-up/README.md) |

### Observability

| Diagramm | Beschreibung | Link |
|---|---|---|
| Trace capture and inspection | Browser-Clients, Backend-Services, Keycloak-Aufrufe und Proxy-Hops werden durch Trace-IDs, Artefakte und Caddy-Logs verbunden | [diagram.svg](./sequences/trace-capture-and-inspection/diagram.svg) · [README](./sequences/trace-capture-and-inspection/README.md) |

---

## Artefakt-Struktur

Jedes Diagramm hat ein eigenes Verzeichnis mit:

- `diagram.mmd` — Mermaid-Quelltext (versioniert)
- `diagram.svg` — gerendertes Diagramm (GitHub-nativ sichtbar)
- `README.md` — Beschreibung mit Titel, Summary, Actors und Schritt-für-Schritt-Erklärung

Datenbankdiagramm:
- `docs/diagrams/database/auth-api-schema/`

Sequenzdiagramme:
- `docs/diagrams/sequences/<slug>/`

## Hinweis

Die Diagramme in `docs/diagrams/` sind die Source-of-Truth. Die Homepage (`apps/home-web/src/main.tsx`) verwendet dieselben Artefakte oder verweist darauf, statt eine getrennte Diagramm-Pflege zu betreiben.