# Diagramme — auth-sandbox-2

Übersicht aller Diagramme im Repository. Die jeweilige `README.md` in jedem Diagramm-Verzeichnis bettet das Mermaid-Diagramm direkt ein, sodass GitHub es inline rendert. Die Mermaid-README ist die einzige benötigte GitHub-Ansicht.

---

## Datenbankstruktur

| Diagramm | Beschreibung | Link |
|---|---|---|
| auth_api Schema | Vollständige Tabellenstruktur des auth-api-Schemas: devices, device_bindings, login_challenges, assurance_flows, assurance_flow_events, registration_people, registration_person_codes, registration_person_sms_numbers | [README](./database/auth-api-schema/README.md) |

---

## Sequenzdiagramme

### Admin & Registrierung

| Diagramm | Beschreibung | Link |
|---|---|---|
| Admin provisioning and registration identity | Admin Web bereitet wiederverwendbare Person-, Code- und SMS-Datensätze vor, bevor ein Gerät die Registrierung startet | [README](./sequences/admin-provisioning-and-registration-identity/README.md) |

### EKW-Broker-Login

| Diagramm | Beschreibung | Link |
|---|---|---|
| EKW broker login into WebMock | WebMock bootet eine Keycloak-Session durch den webmock-ekw-login Client, dann stille Promotion auf ein einmaliges target-client handoff via prompt=none | [README](./sequences/ekw-broker-login-into-webmock/README.md) |

### Geräte-Registrierung & Login

| Diagramm | Beschreibung | Link |
|---|---|---|
| Device registration and password bootstrap | AppMock erstellt zuerst ein ungebundenes Gerät, bindet dann die Nutzeridentität, backend-seitige Keycloak-Credential-Erstellung und optionales Password-Setup | [README](./sequences/device-registration-and-password-bootstrap/README.md) |
| Encrypted device login and protected API use | Gespeichertes Gerät wandelt verschlüsselte Challenge in OIDC-Token um und nutzt sie sofort gegen die geschützte Mock-API | [README](./sequences/encrypted-device-login-and-protected-api-use/README.md) |
| Refresh and logout lifecycle | Geräte-Session bleibt erneuerbar durch Keycloak Refresh Tokens und kann über den Logout-Endpoint widerrufen werden | [README](./sequences/refresh-and-logout-lifecycle/README.md) |
| SSO bootstrap from device app into WebMock | AppMock bereitet einen allowlisted Browser-Bootstrap in WebMock durch auth-api und Keycloak PAR state vor | [README](./sequences/sso-bootstrap-from-device-app-into-webmock/README.md) |

### Browser-Step-Up

| Diagramm | Beschreibung | Link |
|---|---|---|
| Browser login and inline 2se step-up | WebMock erreicht 1se durch Passwort-Login oder EKW-Handoff, dann kann Keycloak die Browser-Session auf 2se hochstufen via inline SMS-TAN Backchannel Flow | [README](./sequences/browser-login-and-inline-2se-step-up/README.md) |

### Observability

| Diagramm | Beschreibung | Link |
|---|---|---|
| Trace capture and inspection | Browser-Clients, Backend-Services, Keycloak-Aufrufe und Proxy-Hops werden durch Trace-IDs, Artefakte und Caddy-Logs verbunden | [README](./sequences/trace-capture-and-inspection/README.md) |

---

## Artefakt-Struktur

Jedes Diagramm hat ein eigenes Verzeichnis mit:

- `README.md` — primäre GitHub-Ansicht mit eingebettetem Mermaid-Diagramm
- `diagram.mmd` — Mermaid-Quelltext (Source-of-Truth)

Datenbankdiagramm:
- `docs/diagrams/database/auth-api-schema/`

Sequenzdiagramme:
- `docs/diagrams/sequences/<slug>/`

## Hinweis

Die Diagramme in `docs/diagrams/` sind die Source-of-Truth. Die Homepage (`apps/home-web/src/main.tsx`) verwendet dieselben Artefakte oder verweist darauf, statt eine getrennte Diagramm-Pflege zu betreiben.
