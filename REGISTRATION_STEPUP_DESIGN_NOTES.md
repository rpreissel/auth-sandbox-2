# Registration, Account-Upgrade und Step-up mit Keycloak

Dieses Dokument fasst die Ergebnisse der Session zusammen. Es dient als Grundlage fuer spaetere Architektur-, API- und Sicherheitsdesigns.

## Zielbild

- Keycloak bleibt Identity Store, Session- und Token-Issuer.
- Der eigentliche mehrstufige Registrierungs-, Upgrade- und Step-up-Workflow lebt im `auth-api`.
- Zwischenstaende werden nicht in Keycloak, sondern im `auth-api` persistiert.
- Dieselben fachlichen Methoden (`sms`, `eid`, `code`, spaeter weitere) sollen fuer Registrierung, Account-Upgrade und Step-up wiederverwendbar sein.
- Keycloak soll nicht als Workflow-Engine fuer komplexe, persistente Verifikationsablaeufe missbraucht werden.

## Grundprinzipien

### 1. Klare Rollentrennung

**Keycloak**

- OIDC Authorization Server
- Ausgabe von Access-/Refresh-/ID-Tokens
- Verwaltung von Usern, Credentials und Sessions
- finale Entscheidung ueber Token mit `acr`, `amr`, `auth_time`

**auth-api**

- Orchestrierung von Registrierung, Upgrade und Step-up
- Persistenz von Zwischenschritten
- Methodenspezifische Integrationen (`sms`, `eid`, `code`, ...)
- Erzeugung eines kurzlebigen Nachweises fuer Keycloak nach erfolgreicher Verifikation

### 2. Keine halbfertigen User in Keycloak

- Keycloak-User sollen moeglichst erst bei `finalize` angelegt oder final beschrieben werden.
- Ob ein User schon existiert, kann bewusst erst am Ende eines Flows entschieden werden.
- Die bestehende Regel bleibt: `username == userId`.

### 3. Generische statt methodenspezifische APIs

Die API soll nicht nach Verfahren geschnitten sein wie:

- `/sms/register`
- `/eid/register`
- `/code/register`

Stattdessen eine generische Flow-/Assurance-API, in die neue Methoden eingesteckt werden koennen.

## Domainenmodell

Es wurden drei zentrale Ebenen herausgearbeitet:

### Purpose

Warum der Flow laeuft:

- `registration`
- `account_upgrade`
- `step_up`

### Method

Wie verifiziert wird:

- `sms`
- `eid`
- `code`
- spaeter z. B. `passkey`, `bankid`, weitere

### Result / Assurance

Was nach erfolgreicher Verifikation fachlich erreicht wurde, z. B.:

- `phone_verified`
- `legal_identity_verified`
- `device_bound`
- `high_assurance`

Wichtig: Andere Systeme sollten moeglichst nur mit dem Ergebnis bzw. Assurance-Level arbeiten, nicht mit der konkreten Methode.

## Persistenz im auth-api

Fuer komplexe Registrierungs- und Step-up-Flows soll das `auth-api` einen persistierten Flow verwalten, z. B. `registration_session` oder allgemeiner `assurance_flow`.

Moegliche Daten pro Flow:

- `flowId`
- `purpose`
- `status`
- `requiredAcr`
- `achievedAcr`
- `deviceId`
- `subjectId`
- methodenspezifische Zwischenergebnisse
- Challenge-/Proof-Metadaten
- Ablaufzeit
- Idempotency-Key
- Audit-Events

Beispielhafte Statusmaschine:

- `started`
- `method_selected`
- `challenge_sent`
- `challenge_verified`
- `finalizable`
- `finalized`
- `expired`
- `failed`

## API-Design: generische Flow-API

Empfohlene grobe Form:

### Flow anlegen

`POST /flows`

Beispiel:

```json
{
  "purpose": "registration",
  "requiredAcr": "level_1"
}
```

Antwort:

```json
{
  "flowId": "flow_123",
  "flowToken": "flow-token",
  "availableServices": ["sms_tan", "eid", "person_code"]
}
```

### Flow lesen

`GET /flows/{flowId}`

Liefert z. B.:

- aktuellen Status
- erlaubte Methoden
- bereits erreichte Assurance
- naechste erlaubte Aktionen

### Service waehlen

- `POST /flows/{flowId}/select-service`

Antwort mit `serviceToken`

### Direktes Service-API

- `POST /identification/person-code/complete`
- `POST /identification/sms-tan/start`
- `POST /identification/sms-tan/resend`
- `POST /identification/sms-tan/complete`

Hier werden z. B. TAN, eID-Assertion oder Registrierungscode eingereicht. Erfolgreiche Services liefern ein `serviceResultToken`.

### Flow finalisieren

`POST /flows/{flowId}/finalize`

Hier wird erst entschieden:

- neuer User
- bestehender User
- Konto wird nur aufgewertet
- Step-up war erfolgreich und erzeugt ein hoeheres Assurance-Level

## Wiederverwendung fuer Registrierung und Account-Upgrade

Dieselben fachlichen Operationen koennen fuer mehrere Zwecke genutzt werden, z. B.:

- Telefonnummer verifizieren
- Identitaet pruefen
- Device binden
- weiteres Credential hinzufuegen

Der Unterschied liegt nicht primaer im Endpoint, sondern in:

- `purpose`
- Berechtigungsregeln
- Finalisierung

Das bedeutet:

- gleiche Business-Logik ist wiederverwendbar
- unterschiedliche Policies je nach Token- und Flow-Kontext

## Schutz der APIs

Es wurden drei Sicherheitskontexte herausgearbeitet.

### 1. Flow-Token

Kurzlebiges Token des `auth-api` fuer laufende Flows.

Enthaelt oder referenziert z. B.:

- `flowId`
- `purpose`
- erlaubte Aktionen
- aktuellen Schritt
- TTL
- Binding an Device, Session oder Nonce

Geeignet fuer:

- anonyme oder noch nicht abgeschlossene Registrierung
- laufende Upgrade- und Step-up-Flows

### 2. User-Token

Normales Keycloak Access Token fuer bekannte/eingeloggte User.

Geeignet fuer:

- `account_upgrade`
- `step_up`
- Aufrufe, die an einen bestehenden Account gebunden sein muessen

### 3. Interne Service-Authentisierung

Fuer Kommunikation `Keycloak <-> auth-api`, z. B.:

- mTLS
- oder signierte Service-zu-Service-Authentisierung

Im aktuellen Demo-Setup wird diese interne Authentisierung durch einen dedizierten Keycloak-Service-Account fuer die internen Redeem- und Browser-Step-up-Endpunkte repraesentiert. Browserseitige Admin-, Passwort- und Trace-Aufrufe werden davon getrennt ueber exakte Proxy-Bearer-Tokens abgesichert, die Caddy injiziert.

## Wichtige Sicherheitsregeln

Tokenpruefung allein reicht nicht. Zusaetzlich muss immer der Flow-Zustand geprueft werden:

- gehoert das Token zu genau diesem `flowId`?
- ist der Flow noch offen?
- ist dieser Schritt aktuell erlaubt?
- passt die Methode zum `purpose`?
- wurde der Schritt schon abgeschlossen?
- passt das Device-/Session-Binding?
- ist der Abschluss idempotent?

Zusatzpunkte:

- One-time-Codes und Handles nur einmal nutzbar
- sehr kurze TTLs
- Rate Limits pro Methode
- Replay-Schutz
- Audit Logging

## Registrierung: empfohlener Ablauf

1. Client startet Flow im `auth-api`.
2. `auth-api` erstellt persistierte Flow-Session.
3. Client waehlt Methode (`sms`, `eid`, `code`, ...).
4. Methode wird im `auth-api` gestartet und abgeschlossen.
5. `auth-api` persistiert erfolgreiche Zwischenschritte.
6. Erst bei `finalize` prueft das Backend gegen Keycloak:
   - existiert `username == userId` bereits?
   - falls nein: User anlegen
   - Credential(s) setzen oder aktualisieren
   - Passwort nur dann setzen, wenn noch keines existiert
7. Danach werden echte Keycloak-Tokens bzw. eine Keycloak-Session erzeugt.

## Step-up im Browser mit Keycloak und `acr_values`

Empfohlener Kanal fuer Browser:

1. Client startet normalen OIDC Authorization Request gegen Keycloak mit `acr_values`.
2. Keycloak prueft, ob das angeforderte `acr` bereits durch die aktuelle Session erfuellt ist.
3. Falls nicht, springt ein Custom Authenticator im Browser-Flow an.
4. Dieser Authenticator startet backchannel einen Step-up-Flow im `auth-api`.
5. Keycloak leitet den Browser zur Step-up-UI bzw. zum `auth-api` weiter.
6. User fuehrt die zusaetzliche Verifikation durch.
7. `auth-api` beendet den Flow nicht mit einem finalen Token im Frontchannel, sondern mit einem kurzlebigen One-Time-`result_code`.
8. Browser wird zu einem Keycloak-Callback zurueckgeleitet.
9. Keycloak redeemt den `result_code` serverseitig beim `auth-api`.
10. `auth-api` liefert das validierte Ergebnis zurueck, z. B.:

```json
{
  "subject": "kc-user-123",
  "achievedAcr": "urn:example:acr:substantial",
  "amr": ["pwd", "sms"],
  "authTime": 1773561000,
  "flowId": "flow-123"
}
```

11. Keycloak validiert dieses Ergebnis und hebt Session bzw. Auth-Kontext an.
12. Danach gibt Keycloak normale OIDC-Tokens mit aktualisiertem `acr`, `amr` und `auth_time` aus.

Der fruehere Gedanke eines oeffentlichen Browser-Step-up-Startendpunkts wurde verworfen. Der Browser startet keinen separaten Public-Step-up-Shortcut mehr, sondern nur noch einen normalen Keycloak-Auth-Request mit hoeherem `acr_values`, worauf Keycloak intern den Step-up-Backchannel anstoesst.

### Warum dieses Rueckantwort-Muster?

- Der Browser sieht nicht den eigentlichen Vertrauensnachweis.
- Keycloak bleibt Herr ueber Session-State.
- Replay- und Session-Mixup-Schutz sind einfacher.

## Native Mobile App ohne Browser-Flow

Fuer eine native App mit eigenen UIs pro Methode ist das Ziel nicht ein Browser-Cookie, sondern eine echte Keycloak-User-Session mit normalen Tokens und Refresh Token.

Empfohlener Ablauf:

1. App startet Flow direkt im `auth-api`.
2. App zeigt eigene UIs fuer SMS/eID/Code.
3. `auth-api` finalisiert den Flow.
4. `auth-api` gibt **keine** finalen Keycloak-Tokens aus, sondern einen kurzlebigen, einmaligen `assurance_handle`.
5. Die App ruft den Keycloak Token-Endpoint mit einem eigenen Grant-Type auf.
6. Keycloak redeemt den `assurance_handle` serverseitig beim `auth-api`.
7. Keycloak legt/aktualisiert die User-Session und mintet normale Tokens.

## Custom Grant fuer Mobile

### SPI

Das relevante SPI ist:

- `org.keycloak.protocol.oidc.grants.OAuth2GrantType`
- `org.keycloak.protocol.oidc.grants.OAuth2GrantTypeFactory`
- `org.keycloak.protocol.oidc.grants.OAuth2GrantTypeSpi`

### Verfuegbarkeit

- offizielles `OAuth Grant Type SPI` ab **Keycloak 24.0.0**

### Idee des Grants

Beispiel:

```text
grant_type=urn:example:grant:assurance-bootstrap
```

Ablauf im Grant:

1. Keycloak authentisiert den Client.
2. Grant liest z. B. `assurance_handle`.
3. Grant ruft `auth-api` backchannel auf.
4. `auth-api` bestaetigt Subjekt, `acr`, `amr`, `auth_time` und Gueltigkeit.
5. Keycloak legt Session an oder hebt sie an.
6. Keycloak gibt normale Tokens aus.

## Browser und Mobile gemeinsam unterstuetzen

Empfohlenes gemeinsames Zielbild:

- **eine** gemeinsame Flow-Engine im `auth-api`
- **ein** gemeinsames Methodenmodell
- **ein** gemeinsamer Redeem-/Vertrauensmechanismus zwischen Keycloak und `auth-api`
- **zwei** kanal-spezifische Adapter in Keycloak:
  - Browser: Custom Authenticator im Browser-Flow
  - Mobile: Custom Grant am Token-Endpoint

Damit wird doppelte Fachlogik vermieden. Nur der letzte Kanal-Schritt in Richtung Keycloak unterscheidet sich.

## Warum Keycloak nicht die komplette Methodenlogik enthalten sollte

Nicht empfohlen:

- komplexe SMS/eID/Code-Logik direkt in mehreren Keycloak-Authenticators zu kapseln
- persistente, komplexe Zwischenzustaende in Keycloak-Session-Notes allein abzubilden
- halbfertige Registrierungsobjekte frueh in Keycloak anzulegen

Empfohlen:

- Keycloak orchestriert die OIDC-/Session-Seite
- `auth-api` orchestriert die Verifikations- und Registrierungslogik

## Resultierende Design-Entscheidungen

### Empfohlen

- generische Flow-API statt methodenspezifischer APIs
- `purpose`, `method` und `assurance` sauber trennen
- persistente Flow-Zwischenstaende im `auth-api`
- Registrierung und Account-Upgrade ueber dieselbe fachliche Engine
- Browser-Step-up ueber OIDC Auth Request mit `acr_values`
- Browser-Rueckantwort an Keycloak ueber `result_code` + serverseitiges Redeem
- Mobile-Step-up/Bootstrap ueber Custom Grant + serverseitiges Redeem
- finale Keycloak-Tokens immer nur aus Keycloak
- browserseitige Demo-Schutzschicht ueber Caddy-injizierte Proxy-Tokens fuer Admin-, Passwort- und Trace-Routen
- separate Trace-Absicherung fuer Browser-Lesezugriffe und interne Observability-Writes

### Nicht empfohlen

- echte User-Tokens vor Ende des Flows ausstellen
- Step-up-Ergebnis ungeschuetzt ueber den Frontchannel zurueckgeben
- Keycloak als zentrale Workflow-Engine fuer alle Methodenschritte nutzen
- Required Actions fuer diesen Fachflow nutzen

## Sicherheitsmatrix im laufenden Repo

`POST /api/flows` ist jetzt purpose-spezifisch gehaertet: `registration` bleibt anonym bootstrap-bar, waehrend `step_up` und `account_upgrade` einen gueltigen Keycloak-User-Bearer der erlaubten Browser-/App-Clients verlangen. Wenn fuer diese geschuetzten Zwecke ein `subjectId` mitgegeben wird, muss er zum Bearer passen; sonst fuellt `auth-api` ihn aus dem Token.

```mermaid
flowchart TB
  subgraph Public[Reachable without API bearer token]
    P1[POST /api/flows]
    P2[POST /api/device/login/start]
    P3[POST /api/device/login/finish]
    P4[POST /api/device/token/refresh]
    P5[POST /api/device/logout]
  end

  subgraph FlowScoped[Flow-scoped tokens from auth-api]
    F1[flowToken] --> F2[GET /api/flows/:flowId]
    F1 --> F3[POST /api/flows/:flowId/select-service]
    F1 --> F4[POST /api/flows/:flowId/finalize]
    S1[serviceToken] --> S2[POST /api/identification/person-code/complete]
    S1 --> S3[POST /api/identification/sms-tan/start]
    S1 --> S4[POST /api/identification/sms-tan/resend]
    S1 --> S5[POST /api/identification/sms-tan/complete]
  end

  subgraph ProxyScoped[Caddy-injected proxy tokens]
    A1[admin proxy token] --> A2[/api/admin/*]
    A3[app proxy token] --> A4[/api/device/set-password]
    A3 --> A5[/api/step-up/mobile/complete]
    T1[trace browser token] --> T2[/traces + trace detail routes]
    T1 --> T3[/client-events]
  end

  subgraph Internal[Internal-only]
    I1[Keycloak service-account bearer] --> I2[/api/internal/browser-step-up/start]
    I1 --> I3[/api/internal/browser-step-up/complete]
    I1 --> I4[/api/internal/flows/redeem]
    I5[trace internal write token] --> I6[/internal/observability/*]
  end
```

## Offene Designfragen fuer die naechste Runde

Diese Punkte wurden als moegliche Vertiefung identifiziert:

1. Exaktes Datenmodell fuer `assurance_flow` / `registration_session`
2. Exakte Endpunkt-Matrix inkl. erlaubter Token pro Endpoint
3. Mapping-Regeln von Methoden auf `acr`/`amr`/dauerhafte Assurance
4. Idempotenz- und Locking-Strategie bei `finalize`
5. Wie genau Session-Upgrade in Keycloak gespeichert wird
6. Ob Step-up temporaer oder dauerhaft fachlich wirken soll
7. Ob fuer Browser zusaetzlich ein Web-UI im `auth-api` oder in einem separaten Frontend liegt
8. Wie Downstream-APIs spaeter `acr`, `amr` und `auth_time` validieren sollen

## Kurzfazit

Das tragfaehigste Modell aus der Session ist:

- `auth-api` als zentrale, persistente Assurance- und Registrierungs-Engine
- Keycloak als Quelle der finalen Sessions und Tokens
- generische Methoden statt harter Verfahren-APIs
- ein gemeinsames fachliches Modell fuer Registrierung, Account-Upgrade und Step-up
- Browser-Unterstuetzung ueber Authenticator + `acr_values`
- Mobile-Unterstuetzung ueber Custom Grant ab Keycloak 24+

Damit bleibt das System erweiterbar, ohne andere Backends bei jeder neuen Verifikationsmethode aendern zu muessen.
