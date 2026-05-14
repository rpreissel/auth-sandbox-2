# Admin provisioning and registration identity

## Summary

Admin Web prepares the reusable person, code, and phone records before a device starts enrollment.


## Diagram

```mermaid
sequenceDiagram
  autonumber
  participant AdminWeb as Admin Web
  participant Auth as Auth API
  participant KC as Keycloak
  participant DB as Postgres

  AdminWeb->>Auth: Create registration identity
  Auth->>KC: Ensure Keycloak user exists
  Auth->>DB: Persist prepared registration channels
  Auth->>DB: Upsert person, code, and SMS records
  Auth-->>AdminWeb: Return masked registration preview
  Auth-->>AdminWeb: Return prepared identity
```
## Actors

Admin Web, Auth API, Keycloak, Postgres

## Steps

1. **Create registration identity** (Admin Web → Auth API): Admin Web sends userId, person data, optional activation code, and optional phone number so auth-api can create or refresh a reusable registration identity.
2. **Ensure Keycloak user exists** (Auth API → Keycloak): Auth-api calls the Keycloak Admin API and ensures that a realm user exists whose username stays exactly equal to userId, creating the user only when no matching account already exists.
3. **Persist prepared registration channels** (Auth API → Postgres): Auth-api stores the user identity together with the reusable code and SMS records that later registration flows resolve against.
4. **Upsert person, code, and SMS records** (Auth API → Postgres): The backend inserts or updates the user, code, and SMS records so later registration flows can offer only the services that actually exist.
5. **Return masked registration preview** (Auth API → Admin Web): The response returns the prepared identity together with the current code and SMS data for onboarding.
6. **Return prepared identity** (Auth API → Admin Web): Admin can review the prepared identity later and use it for follow-up enrollment.

## Dateien

- `README.md` — diese Datei mit eingebettetem Mermaid-Diagramm
- `diagram.mmd` — Mermaid-Quelltext (Source-of-Truth)
