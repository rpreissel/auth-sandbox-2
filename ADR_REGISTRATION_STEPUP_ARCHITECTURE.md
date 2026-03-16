# ADR: Architektur fuer Registrierung, Account-Upgrade und Step-up mit Keycloak

- Status: Proposed
- Datum: 2026-03-15

## Kontext

Der Registrierungsprozess kann mehrstufig werden und Zwischenergebnisse ueber laengere Zeit persistieren muessen. Vor Abschluss eines Flows muessen bereits API-Aufrufe abgesichert werden. Zudem kann sich erst am Ende eines Flows herausstellen, ob ein User bereits existiert oder neu angelegt werden muss.

Zusaetzlich sollen dieselben fachlichen Verifikationsmethoden nicht nur fuer Registrierung, sondern auch fuer spaeteres Account-Upgrade und Step-up nutzbar sein. Die Menge der Verifikationsmethoden soll erweiterbar bleiben, ohne andere Backends bei jeder neuen Methode aendern zu muessen.

Rahmenbedingungen dieses Projekts:

- Keycloak bleibt zentraler Identity Store und Token-Issuer.
- `username` in Keycloak bleibt immer gleich `userId`.
- Das Credential-Konzept in Keycloak bleibt erhalten.
- Keine Keycloak Required Actions fuer diesen Flow.
- Die verschluesselte Challenge bleibt fuer den Device-Login fachlich relevant.

## Entscheidung

### 1. Keycloak bleibt Token- und Session-System, nicht Workflow-Engine

Komplexe Registrierungs-, Upgrade- und Step-up-Flows werden im `auth-api` orchestriert und persistiert. Keycloak bleibt zustaendig fuer:

- User
- Credentials
- Sessions
- OIDC Tokens
- Claims wie `acr`, `amr` und `auth_time`

### 2. Das `auth-api` implementiert eine generische Assurance-Flow-Engine

Das `auth-api` verwaltet persistierte Flows mit einem generischen Modell aus:

- `purpose`: `registration`, `account_upgrade`, `step_up`
- `method`: z. B. `sms`, `eid`, `code`, spaeter weitere
- `result` / `assurance`: z. B. `phone_verified`, `legal_identity_verified`, `high_assurance`

Die API wird an der Orchestrierungsgrenze generisch geschnitten. Das `auth-api` bleibt fuer Flow-Erzeugung, Service-Selektion und Finalisierung zustaendig; konkrete Identifikationsverfahren laufen ueber feste direkte Service-Endpoints.

Beispielhafte Endpoints:

- `POST /flows`
- `GET /flows/{flowId}`
- `POST /flows/{flowId}/select-service`
- `POST /flows/{flowId}/finalize`
- `POST /identification/person-code/complete`
- `POST /identification/sms-tan/start`
- `POST /identification/sms-tan/resend`
- `POST /identification/sms-tan/complete`

### 3. Zwischenstaende werden ausschliesslich im `auth-api` persistiert

Das `auth-api` speichert pro Flow mindestens:

- `flowId`
- `purpose`
- `status`
- `requiredAcr`
- `achievedAcr`
- `deviceId`
- `subjectId`
- methodenspezifische Zwischenergebnisse
- Ablaufzeit
- Idempotenz- und Audit-Informationen

Halbfertige Registrierungszustaende werden nicht in Keycloak modelliert.

### 4. Die Existenz des Users wird erst bei `finalize` entschieden

Bei Registrierung prueft das Backend erst am Ende gegen Keycloak, ob `username == userId` bereits existiert.

- Falls der User existiert, werden vorhandene Credentials oder Attribute ergaenzt.
- Falls der User nicht existiert, wird er angelegt.
- Falls kein Passwort vorhanden ist, setzt das Backend das Passwort ueber die Keycloak Admin API.

`finalize` wird idempotent und mit Locking auf relevanten Schluesseln gebaut.

### 5. Vor Abschluss werden keine normalen User-Tokens aus Keycloak verwendet

Vor dem Ende eines Flows werden API-Aufrufe ueber kurzlebige, zustandsgebundene Flow-Tokens abgesichert. Diese Tokens sind an mindestens folgende Informationen gebunden:

- `flowId`
- `purpose`
- erlaubte Aktion oder Schritt
- Ablaufzeit
- Device-, Session- oder Nonce-Binding

Fuer bestehende eingeloggte User kann zusaetzlich ein normales Keycloak User-Token vorhanden sein. Die gleiche Fachlogik darf von verschiedenen Token-Kontexten aus genutzt werden, aber immer mit unterschiedlichen Policies.

### 6. Browser-Step-up laeuft ueber normalen OIDC Auth Request mit `acr_values`

Fuer Browser-Clients startet der Client einen normalen Keycloak Authorization Request mit angefordertem `acr`.

Wenn die bestehende Session nicht ausreicht, startet ein Custom Authenticator in Keycloak einen Step-up-Flow im `auth-api`.

Nach erfolgreicher Verifikation antwortet das `auth-api` nicht mit finalen Tokens im Frontchannel, sondern mit einem kurzlebigen One-Time-`result_code`. Keycloak redeemt diesen Code serverseitig beim `auth-api`, validiert das Ergebnis und setzt anschliessend Session- und Token-Claims wie `acr`, `amr` und `auth_time`.

### 7. Native Mobile Apps nutzen einen Custom Grant in Keycloak

Native Apps koennen denselben fachlichen Flow direkt gegen das `auth-api` ausfuehren und eigene UIs fuer die einzelnen Methoden bereitstellen.

Nach erfolgreichem Abschluss gibt das `auth-api` einen kurzlebigen `assurance_handle` aus. Die App verwendet anschliessend den Keycloak Token-Endpoint mit einem eigenen Grant-Type, um eine echte Keycloak-User-Session und normale Tokens zu erhalten.

Der Custom Grant in Keycloak:

- authentisiert den Client
- nimmt den `assurance_handle` entgegen
- ruft das `auth-api` serverseitig zum Redeem auf
- erstellt oder aktualisiert die User-Session
- mintet normale OIDC Tokens

Das offizielle SPI dafuer ist das `OAuth Grant Type SPI` ab Keycloak `24.0.0`.

## Sicherheitsmodell

Es werden drei Sicherheitskontexte unterschieden:

### Flow-Token

Kurzlebig, zustandsgebunden, vom `auth-api` ausgestellt.

### User-Token

Normales Keycloak Access Token fuer bekannte oder eingeloggte User.

### Interne Service-Authentisierung

Gesicherte Kommunikation zwischen Keycloak und `auth-api`, z. B. per mTLS oder signierter Service-Authentisierung.

Zusaetzlich gilt fuer jeden geschuetzten Flow-Endpunkt:

- Token-Typ pruefen
- `flowId` pruefen
- Flow-Status pruefen
- erlaubten Schritt pruefen
- Method-Purpose-Kombination pruefen
- Replay verhindern
- Idempotenz absichern
- Audit Logging schreiben

## Konsequenzen

### Vorteile

- Neue Verifikationsmethoden koennen ohne API-Bruch fuer andere Backends eingefuehrt werden.
- Registrierung, Account-Upgrade und Step-up teilen sich dieselbe Fachlogik.
- Keycloak bleibt klar auf IdP-, Session- und Token-Aufgaben fokussiert.
- Browser und Mobile koennen unter einem gemeinsamen fachlichen Modell unterstuetzt werden.
- Die Entscheidung ueber bestehende oder neue User kann spaet und konsistent getroffen werden.

### Nachteile

- Zusaetzliche Komplexitaet im `auth-api` durch Flow-Engine und Persistenz.
- Zusatzerweiterungen in Keycloak sind notwendig:
  - Browser: Custom Authenticator
  - Mobile: Custom Grant
- Das Mapping von Methoden auf `acr`, `amr` und dauerhafte Assurance muss explizit modelliert werden.

## Verwarfene Alternativen

### Komplette Workflow-Logik direkt in Keycloak

Verworfen, weil Keycloak dadurch zu stark als Workflow-Engine missbraucht wuerde und die Erweiterbarkeit neuer Methoden unnoetig kompliziert wird.

### Fruehes Anlegen halbfertiger User in Keycloak

Verworfen, weil dadurch unklare Zwischenzustaende entstehen und sich die Endentscheidung ueber neue oder bestehende User schlechter kontrollieren laesst.

### Eigene verfahrensspezifische APIs pro Methode

Verworfen, weil jede neue Methode API-Aenderungen in mehreren Schichten nach sich ziehen wuerde und das Modell schlechter wiederverwendbar waere.

### Direkte Rueckgabe finaler Vertrauensdaten im Browser-Frontchannel

Verworfen zugunsten eines One-Time-Codes mit serverseitigem Redeem durch Keycloak.

## Folgearbeiten

- Datenmodell fuer `assurance_flow` ausarbeiten
- Endpoint-Matrix mit erlaubten Token-Kontexten definieren
- Mapping von Methoden auf `acr`, `amr` und dauerhafte Assurance spezifizieren
- Locking- und Idempotenzstrategie fuer `finalize` festlegen
- Keycloak-Erweiterungen fuer Browser- und Mobile-Pfad konkret entwerfen
