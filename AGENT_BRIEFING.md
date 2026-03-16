# Auftrag fuer einen anderen Agenten: `auth-sandbox-2` neu aufsetzen

## Ziel

Erstelle ein neues Projekt **parallel** zum bestehenden Repository mit dem Namen `auth-sandbox-2`.

Wichtige Rahmenbedingungen:
- **Nicht** das bestehende `auth-sandbox` umbauen
- **Neues Sibling-Projekt** neben `auth-sandbox` anlegen
- Nur das Thema **Geraete-/Device-Login** uebernehmen
- **Kein SSO**
- **Kein CMS**
- Alles so **minimal wie moeglich**
- Die **zentralen Device-Login-Konzepte** des aktuellen Projekts muessen erhalten bleiben, insbesondere:
  - Registration Codes
  - Device-Registrierung
  - Device-Credentials in Keycloak
  - encryptete Challenge fuer Login
  - Public-Key-/Credential-basierter Login
  - Passwort-Vergabe nach Registrierung, falls noch kein Passwort vorhanden ist

---

## Technische Zielarchitektur

## Muss-Vorgaben

- Container-basiertes lokales Setup mit **Docker Compose oder Podman Compose**
- Reverse Proxy mit **Caddy**
- IAM mit **Keycloak**
- **Alle Frontends in React + TypeScript**
- **Alle Backends ausser Keycloak in Node.js + TypeScript**
- So wenig Services und moving parts wie moeglich

## Ziel-Stack

Geplant ist ein bewusst kleiner Stack:

- `postgres`
- `keycloak`
- `auth-api` (Node.js + TypeScript)
- `app-web` (React + TypeScript) - simuliert das Device / die Mobile-App im Browser
- `admin-web` (React + TypeScript) - verwaltet Registration Codes und Devices
- `caddy`

Optional:
- `packages/shared-types` oder aehnlich fuer gemeinsame DTOs/Typen

---

## Architektur-Empfehlung

## Monorepo mit Workspaces

Das neue Projekt soll als **Monorepo mit Workspaces** aufgebaut werden, vorzugsweise mit `pnpm`.

Empfohlene Struktur:

```text
auth-sandbox-2/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  compose.yml
  Caddyfile
  .env.example
  README.md
  SETUP.md
  apps/
    auth-api/
    app-web/
    admin-web/
  packages/
    shared-types/
  e2e/
  keycloak-extension/   # nur falls wirklich noetig
```

Ziel:
- ein Repo
- ein Lockfile
- gemeinsame Typen
- klare Trennung der Apps
- einfache lokale Entwicklung und Builds

## Laufzeit-Modell

Die effektive Runtime soll minimal bleiben:

- `auth-api` als **einzige Node-Server-App**
- `app-web` und `admin-web` als React-Apps
- Frontends im produktionsnahen Setup als **statische Builds ueber Caddy** ausliefern
- Keycloak, Postgres und Caddy als eigene Container

Wichtig:
- Nicht mehrere Node-Anwendungen in einen Container packen
- Ein Prozess pro Container
- Wenn moeglich nur **ein** Node-Backend: `auth-api`

---

## Was aus dem Altprojekt uebernommen werden soll

Es soll **nicht** das gesamte alte Projekt kopiert werden. Uebernommen werden nur die **fachlichen Device-Login-Konzepte**.

## Relevante Referenzen im Altprojekt

Zur Analyse und Orientierung insbesondere diese Dateien nutzen:

- `README.md`
- `docs/CREDENTIAL_BASED_LOGIN_FLOW.md`
- `e2e/tests/device-registration.test.ts`
- `app-mock-react/tests/device-flow.spec.ts`
- `keycloak-extension/src/main/java/dev/authsandbox/keycloak/DeviceCredentialProvider.java`
- `keycloak-extension/src/main/java/dev/authsandbox/keycloak/DeviceCredentialModel.java`
- `keycloak-extension/src/main/java/dev/authsandbox/keycloak/DeviceLoginConditionAuthenticator.java`
- `auth-service/src/main/java/dev/authsandbox/authservice/service/DeviceService.java`
- `auth-service/src/main/java/dev/authsandbox/authservice/service/RegistrationCodeService.java`
- `compose.yml`
- `Caddyfile`

## Fachlich uebernehmen

Diese Konzepte muessen erhalten bleiben:

- Admin erstellt einen **Registration Code** fuer einen `userId`
- Keycloak-User wird fuer diesen `userId` angelegt oder sichergestellt
- `username` in Keycloak ist immer gleich `userId`
- Device registriert sich mit:
  - `userId`
  - `deviceName`
  - `activationCode`
  - `publicKey`
- Beim Registrieren wird ein **Device-Credential in Keycloak** erzeugt
- Login basiert auf einer **encrypteten Challenge**
- Das Device signiert mit seinem privaten Schluessel
- Keycloak bleibt fachlich relevanter Teil der Credential- und Login-Logik

## Nicht uebernehmen

Diese Teile sollen **nicht** in `auth-sandbox-2` landen:

- SSO-Transfer-Flow
- CMS
- Target App
- CMS Admin
- Home-/Demo-Portal
- JWT-IdP-/SSO-spezifische Altkonzepte
- alles, was nur fuer SSO oder CMS noetig war

---

## Zielbild der Anwendungen

## 1. `app-web`

Zweck:
- Browserbasierte Minimal-App, die ein Device simuliert

Funktionen:
- Device registrieren
- optional Passwort-Schritt nach Registrierung
- Login starten
- encryptete Challenge empfangen
- Challenge lokal verarbeiten / signieren
- Login abschliessen
- Ergebnis anzeigen

Anforderungen:
- React + TypeScript
- schlicht und minimal
- kein unnoetiges UI-Framework
- wenn noetig WebCrypto fuer Schluessel und Signaturen verwenden

## 2. `admin-web`

Zweck:
- Minimal-Admin-Oberflaeche fuer Device-Login-Verwaltung

Funktionen:
- Registration Code erstellen
- Registration Codes auflisten
- Registration Code loeschen
- Devices auflisten
- Device entfernen oder deaktivieren, falls minimal sinnvoll

Anforderungen:
- React + TypeScript
- einfacher, klarer Flow
- nur Device-Login-Administration

## 3. `auth-api`

Zweck:
- zentrales Node.js-/TypeScript-Backend fuer den kompletten fachlichen Flow

Verantwortung:
- Registration Codes verwalten
- Devices registrieren
- Challenge erzeugen und validieren
- Passwortbedarf pruefen
- Passwort in Keycloak setzen
- Keycloak Admin API aufrufen
- Device-Credentials in Keycloak anlegen
- Login koordinieren

Technische Anforderungen:
- Node.js + TypeScript
- schlankes Framework, z. B. Fastify oder Express
- PostgreSQL
- Konfiguration ueber `.env`
- klare Schichten fuer:
  - API
  - Services
  - Repository/DB
  - Keycloak-Client
  - Crypto-Logik

---

## Keycloak-Anforderungen

## Grundsatz

Keycloak soll weiterhin ein echter Teil des Flows sein und nicht nur nebenher mitlaufen.

Minimal erforderlich:
- eigener Realm fuer `auth-sandbox-2`
- Admin-Client fuer Keycloak Admin API
- Device-Login-bezogene Clients
- Unterstuetzung fuer Device-Credentials
- Username-Regel: Keycloak `username == userId`

## Credential-Konzept

Das neue Projekt soll das **Credential-basierte Modell** aus dem Altprojekt fuer Device Login uebernehmen, aber ohne SSO-Zweige.

Pro Device soll es weiterhin ein Credential geben.

Mindestens beibehalten:
- `userLabel` bzw. lesbarer Geraetename
- `credentialData` mit mindestens:
  - `publicKey`
  - `publicKeyHash`
- `secretData` nur, wenn es fuer den Minimal-Flow fachlich wirklich gebraucht wird

Wichtig:
- Wenn eine Vereinfachung moeglich ist, diese nutzen
- Aber das **Credential-Konzept darf nicht entfallen**
- Nur Device Login, keine Multi-Flow- oder SSO-Erweiterungen

## Keycloak-Extension

Der Agent soll **pruefen**, ob fuer `auth-sandbox-2` wirklich eine eigene Keycloak-Extension noetig ist.

Prioritaeten:
1. so minimal wie moeglich
2. Credential-Konzept fachlich korrekt beibehalten

Daher:
- Wenn der Flow mit Keycloak-Standardmitteln plus Admin API sauber machbar ist, diesen Weg bevorzugen
- Falls fuer Credential-basierte Validierung zwingend eine kleine Extension noetig ist, nur die absolut noetige Minimalversion bauen
- Keine Uebernahme von SSO-bezogenen Authenticators oder Conditions

---

## Encryptete Challenge ist Pflicht

Die **encryptete Challenge** aus dem bestehenden Device-Login-Konzept soll explizit uebernommen werden.

Das bedeutet:
- Login ist **nicht** nur ein einfacher Signatur-Check auf einer nackten Challenge-ID
- Das Backend erzeugt eine **verschluesselte Payload / encryptete Challenge**
- Das Device verarbeitet diese Challenge mit seinem Schluesselmaterial
- Das Device signiert die relevante Login-Nachricht
- Backend und/oder Keycloak validieren:
  - Zuordnung zum User / Device
  - Ablaufzeit
  - Einmalverwendung
  - Signatur
  - fachliche Konsistenz des Flows

Wenn der Agent den Flow vereinfacht, darf die encryptete Challenge **nicht** fachlich verloren gehen.

---

## Passwort-Vergabe nach Registrierung ist Pflicht

Neben Device Login ist folgender Punkt **verbindlich** umzusetzen:

- Nach erfolgreicher Device-Registrierung muss das Backend pruefen, ob der zugehoerige Keycloak-User bereits ein **Passwort-Credential** besitzt
- Falls noch **kein Passwort** vorhanden ist, muss direkt im Anschluss eine **Initialpasswort-Vergabe** erfolgen koennen

## Verbindliche Regeln dafuer

- Diese Pruefung erfolgt **ausschliesslich im Backend**
- Die Entscheidung, ob ein Passwort gesetzt werden muss, trifft **ausschliesslich das Backend**
- Falls noch kein Passwort vorhanden ist, steuert das Backend den naechsten Schritt im Flow
- Das Passwort wird **durch das Backend** ueber die **Keycloak Admin API** gesetzt
- Das Frontend ist nur fuer Eingabe und Anzeige zustaendig
- Keine Verlagerung dieser Logik ins Frontend
- Keine Keycloak Required Actions dafuer verwenden

## Required Actions ausdruecklich nicht verwenden

Folgende Konzepte sollen fuer den Minimalflow **nicht** verwendet werden:

- `UPDATE_PASSWORD`
- `VERIFY_PROFILE`
- andere Default- oder Onboarding-Required-Actions

Der neue Flow soll **nicht** auf Keycloak-Onboarding-Zwaengen beruhen, sondern auf einem bewusst vom Backend gesteuerten Ablauf.

## Gewuenschter Ablauf fuer die Passwort-Setzung

1. Device-Registrierung erfolgreich
2. Backend prueft ueber Keycloak Admin API, ob ein Passwort-Credential existiert
3. Falls kein Passwort existiert:
   - Backend signalisiert: Passwort erforderlich
   - Frontend zeigt Eingabemaske fuer Passwort
   - Frontend sendet Passwort an Backend
   - Backend setzt Passwort in Keycloak
4. Falls bereits ein Passwort existiert:
   - Registrierung ist ohne weiteren Passwort-Schritt abgeschlossen

---

## Minimales Domaenenmodell

Es soll nur das Noetigste geben.

## `devices`

Mindestens:
- `id`
- `user_id`
- `device_name`
- `public_key_hash`
- optional `enc_pub_key`, falls fuer encryptete Challenge erforderlich
- optional Statusfeld, falls minimal sinnvoll
- `created_at`

## `login_challenges`

Mindestens:
- `id` oder `nonce`
- `user_id`
- Ablaufzeit
- `used`
- die fuer den encrypteten Flow notwendigen Daten

## Domaenenregeln

- `username` in Keycloak ist immer `userId`
- `deviceName` ist pro `userId` eindeutig
- `publicKeyHash` ist global eindeutig
- ein User kann mehrere Devices haben

---

## API-Zielumfang

Die API soll klein, klar und konsistent sein.

## Admin API

Mindestens:

- `POST /api/admin/registration-identities`
- `GET /api/admin/devices`
- `DELETE /api/admin/devices/:id` optional, wenn minimal sinnvoll

## Device API

Mindestens:

- `POST /api/device/set-password`
- `POST /api/device/login/start`
- `POST /api/device/login/finish`

Wichtig:
- `set-password` wird fachlich vom Backend gesteuert
- Das Frontend ruft den Endpoint nur auf, wenn das Backend den Schritt verlangt

---

## Gewuenschter End-to-End-Flow

## 1. Registration Code erstellen

- Admin legt fuer `userId` einen Registration Code an
- Backend stellt sicher, dass der Keycloak-User fuer `userId` existiert

## 2. Device registrieren

- App sendet `userId`, `deviceName`, `activationCode`, `publicKey`
- Backend validiert Registration Code
- Backend legt Device-Credential in Keycloak an
- Backend speichert Device-Metadaten in PostgreSQL
- Registration Code `useCount` wird angepasst

## 3. Passwort optional setzen

- Backend prueft, ob der User bereits ein Passwort-Credential besitzt
- Falls nein:
  - Backend verlangt Passwort-Schritt
  - Frontend sendet Passwort
  - Backend setzt Passwort ueber Keycloak Admin API
- Falls ja:
  - Schritt entfaellt

## 4. Login starten

- App sendet `publicKeyHash`
- Backend findet Device
- Backend erzeugt **encryptete Challenge**
- Backend speichert Challenge-Status
- App erhaelt die Challenge-Daten

## 5. Login abschliessen

- App verarbeitet die Challenge und signiert die relevante Payload
- Backend validiert Challenge-Zustand
- Der weitere Ablauf muss so gestaltet sein, dass Keycloak weiterhin fachlich sinnvoll eingebunden bleibt
- Ergebnis ist ein erfolgreicher Device-Login mit Keycloak-Bezug, aber ohne SSO-/CMS-Komplexitaet

---

## Infrastruktur

## Compose

Es soll eine neue lokale Entwicklungsumgebung fuer `auth-sandbox-2` geben.

Anforderungen:
- lauffaehig mit Docker Compose oder Podman Compose
- klare Service-Definitionen
- moeglichst wenig moving parts
- nachvollziehbare Volumes, Ports und Env-Variablen

## Caddy

Caddy soll TLS fuer lokale `*.localhost`-Domains uebernehmen.

Vorschlag fuer Hosts:
- `keycloak.localhost`
- `auth.localhost`
- `app.localhost`
- `admin.localhost`

Der Agent kann die Namen anpassen, wenn das Setup konsistent bleibt.

---

## Tests

Auch das Minimalprojekt muss testbar sein.

Mindestens folgende E2E-Tests:
- Registration Code Management
- Device-Registrierung
- Passwort-Vergabe nach Registrierung, wenn noch kein Passwort vorhanden ist
- Device-Login ueber den encrypteten Challenge-Flow

Orientierung:
- `e2e/tests/device-registration.test.ts`
- `app-mock-react/tests/device-flow.spec.ts`

Die Tests sollen **angepasst neu aufgebaut** werden, nicht blind aus dem Altprojekt kopiert.

---

## Dokumentation

Das neue Projekt soll mindestens diese Doku enthalten:

- `README.md`
- `SETUP.md`
- klare Beschreibung des Minimal-Stacks
- Beschreibung des Device-Login-Flows
- Beschreibung des Passwort-Schritts nach Registrierung
- Hinweise fuer lokales Starten mit Docker/Podman Compose

---

## Nicht-Ziele

Folgendes ausdruecklich weglassen:

- SSO-Transfer
- CMS-Content
- CMS-Admin
- zusaetzliche Demo-Apps
- historische Komplexitaet aus dem Altprojekt
- Keycloak Required Actions fuer Passwort-/Profil-Onboarding
- alles, was nicht direkt fuer den Device-Login-Minimalflow gebraucht wird

---

## Erwartetes Ergebnis

Am Ende soll `auth-sandbox-2` sein:

- eigenstaendiges neues Projekt
- lokal startbar per Docker/Podman Compose
- mit Caddy + Keycloak + PostgreSQL
- mit React/TypeScript-Frontends
- mit Node.js/TypeScript-Backend
- mit minimalem, aber vollstaendigem Device-Login-Flow
- mit encrypteter Challenge
- mit uebernommenem Credential-Konzept
- mit backend-gesteuerter Passwort-Setzung nach Registrierung
- ohne SSO
- ohne CMS

---

## Arbeitsprinzip fuer die Umsetzung

Der Agent soll so vorgehen:

1. Bestehendes Projekt analysieren und nur Device-Login-relevante Konzepte extrahieren
2. Zielarchitektur fuer `auth-sandbox-2` festlegen
3. neues Sibling-Projekt anlegen
4. Monorepo-Struktur mit Workspaces aufsetzen
5. minimale Infrastruktur mit Compose, Caddy, Keycloak und Postgres aufbauen
6. `auth-api` in Node.js + TypeScript umsetzen
7. `app-web` und `admin-web` in React + TypeScript umsetzen
8. Keycloak minimal integrieren
9. encrypteten Challenge-Flow implementieren
10. backend-gesteuerte Passwort-Setzung nach Registrierung implementieren
11. E2E-Tests hinzufuegen
12. README und SETUP schreiben
13. pruefen, dass keine SSO-/CMS-Reste uebernommen wurden

---

## Leitlinie

Lieber eine **kleine, klare, saubere** Loesung als eine 1:1-Kopie des alten Projekts.

Wenn zwischen
- historisch exakt
- und fachlich korrekt, aber minimal

gewaehlt werden muss, gilt:

**Bevorzuge die minimalste Loesung, solange Device-Login, encryptete Challenge, Credential-Konzept und backend-gesteuerte Passwort-Setzung erhalten bleiben.**
