# auth_api Schema — Datenbankdiagramm

## Übersicht

Dieses Diagramm zeigt die Tabellenstruktur des `auth_api`-Schemas in der PostgreSQL-Datenbank der Sandbox. Es basiert auf den Migrationen `001_init.sql`, `003_devices_unbound.sql` und `004_device_bindings.sql`.


## Diagram

```mermaid
erDiagram
  devices {
    uuid id PK
    text device_name
    text public_key
    text public_key_hash
    boolean active
    timestamptz created_at
  }

  device_bindings {
    uuid id PK
    uuid device_id FK
    text user_id
    text keycloak_user_id
    text keycloak_credential_id
    boolean active
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

  registration_people {
    uuid id PK
    text user_id
    text first_name
    text last_name
    date birth_date
    timestamptz created_at
    timestamptz updated_at
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

  devices ||--o{ login_challenges : ""
  devices ||--o{ device_bindings : ""
  devices ||--o{ assurance_flows : ""
  assurance_flows ||--o{ assurance_flow_events : ""
  registration_people ||--o{ registration_person_codes : ""
  registration_people ||--o{ registration_person_sms_numbers : ""
```
## Beziehungen

- `devices` ist die zentrale Tabelle. Sie enthält nur gerätebezogene Daten (Name, öffentlicher Schlüssel, Hash) — keine Nutzerbindung direkt.
- `device_bindings` verknüpft ein `device` mit einem `user_id` und den Keycloak-Metadaten. Ein Gerät kann mehrere Bindungen haben (historisch), aber nur eine ist `active = true`.
- `login_challenges` referenziert ein `device` für den verschlüsselten Challenge-Login-Prozess.
- `assurance_flows` referenziert ein `device` für Registrierungs-, Upgrade- und Step-up-Flows.
- `assurance_flow_events` protokolliert Ereignisse pro Flow.
- `registration_people` ist die Personentabelle mit Identitätsmerkmalen.
- `registration_person_codes` und `registration_person_sms_numbers` gehören zu einer Person.

## Tabellen

| Tabelle | Zweck | Primärschlüssel | Fremdschlüssel |
|---|---|---|---|
| `devices` | Gerätebasisdaten (Name, Schlüssel, Hash) | `id` (uuid) | — |
| `device_bindings` | Verknüpft Gerät mit Nutzer und Keycloak-Metadaten | `id` (uuid) | `device_id` → `devices` |
| `login_challenges` | Verschlüsselte Login-Challenges mit Nonce | `id` (uuid) | `device_id` → `devices` |
| `assurance_flows` | Registrierungs-, Upgrade- und Step-up-Flows | `id` (text) | `device_id` → `devices` |
| `assurance_flow_events` | Flow-Ereignisprotokoll | `id` (uuid) | `flow_id` → `assurance_flows` |
| `registration_people` | Personenidentität (Name, Geburtsdatum) | `id` (uuid) | — |
| `registration_person_codes` | Einmalige oder wieder verwendbare Registrierungscodes | `id` (uuid) | `person_id` → `registration_people` |
| `registration_person_sms_numbers` | SMS-basierte Verifizierung | `id` (uuid) | `person_id` → `registration_people` |

## Hinweis

Die einstige Nutzerbindung direkt auf `devices` (`user_id`, `keycloak_user_id`, `keycloak_credential_id`, `enc_pub_key`) wurde in Migration `004_device_bindings.sql` in die separate `device_bindings`-Tabelle verschoben. `devices` enthält nur noch gerätebezogene Daten.

## Dateien

- `README.md` — diese Datei mit eingebettetem Mermaid-Diagramm
- `diagram.mmd` — Mermaid-Quelltext (Source-of-Truth)
