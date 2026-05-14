# auth_api Schema — Datenbankdiagramm

## Übersicht

Dieses Diagramm zeigt die Tabellenstruktur des `auth_api`-Schemas in der PostgreSQL-Datenbank der Sandbox. Es basiert auf den Migrationen `001_init.sql` bis `006_device_binding_names.sql`.

## Diagram

```mermaid
erDiagram
  devices {
    uuid id PK
    text public_key
    text public_key_hash
    timestamptz created_at
  }

  user {
    uuid id PK
    text user_id UK
    text handover_secret UK
    text first_name
    text last_name
    date birth_date
    timestamptz created_at
    timestamptz updated_at
  }

  device_bindings {
    uuid id PK
    uuid device_id FK
    text user_id
    text keycloak_user_id
    text keycloak_credential_id
    text device_name
    timestamptz created_at
  }

  login_challenges {
    uuid id PK
    text nonce
    text user_id
    uuid device_id FK
    text public_key_hash
    timestamptz expires_at
    boolean used
    timestamptz created_at
  }

  assurance_flows {
    text id PK
    text purpose
    text status
    text current_method
    text requested_acr
    text target_assurance
    uuid device_id FK
    text user_hint
    text prospective_user_id
    text resolved_user_id
    jsonb challenge_binding_json
    jsonb context_json
    jsonb method_state_json
    jsonb result_json
    text idempotency_key
    integer finalize_lock_version
    timestamptz finalize_locked_at
    text final_artifact_kind
    text final_artifact_code
    timestamptz final_artifact_expires_at
    timestamptz final_artifact_consumed_at
    timestamptz expires_at
    timestamptz finalized_at
    timestamptz created_at
    timestamptz updated_at
  }

  assurance_flow_events {
    uuid id PK
    text flow_id FK
    text event_type
    jsonb payload_json
    timestamptz created_at
  }

  registration_person_codes {
    uuid id PK
    uuid person_id FK
    text code
    timestamptz expires_at
    integer use_count
    timestamptz created_at
  }

  registration_person_sms_numbers {
    uuid id PK
    uuid person_id FK
    text phone_number
    timestamptz created_at
    timestamptz updated_at
  }

  user ||--o{ registration_person_codes : ""
  user ||--o{ registration_person_sms_numbers : ""
  devices ||--o{ login_challenges : ""
  devices ||--o{ device_bindings : ""
  devices ||--o{ assurance_flows : ""
  device_bindings ||--o{ assurance_flows : ""
  assurance_flows ||--o{ assurance_flow_events : ""
```

## Beziehungen

- `user` ist die zentrale Identitätstabelle. Sie enthält `handover_secret` — das persistente, zufällig erzeugte 32-Byte-Secret für den handover-v2-Workflow.
- `devices` enthält nur gerätebezogene Daten (Schlüsselmaterial, Hash) — keine Benutzerbindung und keinen Namen.
- `device_bindings` verknüpft ein `device` mit einem `user_id` und den Keycloak-Metadaten. Der `device_name` ist hier gespeichert und muss pro `(user_id, device_name)` eindeutig sein.
- `login_challenges` referenziert ein `device` für den verschlüsselten Challenge-Login-Prozess.
- `assurance_flows` referenziert ein `device` für Registrierungs-, Upgrade- und Step-up-Flows.
- `registration_person_codes` und `registration_person_sms_numbers` gehören zu einem `user`.

## Tabellen

| Tabelle | Zweck | Primärschlüssel | Fremdschlüssel |
|---|---|---|---|
| `user` | Personenidentität (Name, Geburtsdatum) + handover_secret | `id` (uuid) | — |
| `devices` | Gerätebasisdaten (Schlüssel, Hash) | `id` (uuid) | — |
| `device_bindings` | Verknüpft Gerät mit Nutzer und Keycloak-Metadaten | `id` (uuid) | `device_id` → `devices` |
| `login_challenges` | Verschlüsselte Login-Challenges mit Nonce | `id` (uuid) | `device_id` → `devices` |
| `assurance_flows` | Registrierungs-, Upgrade- und Step-up-Flows | `id` (text) | `device_id` → `devices` |
| `assurance_flow_events` | Flow-Ereignisprotokoll | `id` (uuid) | `flow_id` → `assurance_flows` |
| `registration_person_codes` | Einmalige oder wieder verwendbare Registrierungscodes | `id` (uuid) | `person_id` → `user` |
| `registration_person_sms_numbers` | SMS-basierte Verifizierung | `id` (uuid) | `person_id` → `user` |

## handover_secret

Das Feld `user.handover_secret` ist die Source of Truth für das kryptografische Handover-Secret. Es wird bei der ersten Geräteregistrierung erzeugt und in Keycloaals `secretData` des einen `device-login`-Credentials pro User gespiegelt.

## Dateien

- `README.md` — diese Datei mit eingebettetem Mermaid-Diagramm
- `diagram.mmd` — Mermaid-Quelltext (Source-of-Truth)