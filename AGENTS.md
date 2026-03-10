# AGENTS.md — auth-sandbox-2

Guidelines for AI coding agents working in this repository.

---

## Development Rules

- **IMMER zuerst ein Bead anlegen** - Kein Code schreiben, bevor ein Issue existiert:
  ```bash
  bd create "Kurztitel" --description="Was gemacht werden soll" -t feature|bug|task -p 0-4
  bd update <id> --status in_progress
  ```
- **Jedes neue Feature braucht einen E2E-Test** - Vor dem Commit pruefen, ob E2E-Tests vorhanden oder erweitert sind.
- Bevorzuge die **minimalste** Loesung, solange die fachlichen Pflichtkonzepte erhalten bleiben.

---

## Domain Rules

- **Keycloak username always equals `userId`**
- Device Login ist der einzige Auth-Schwerpunkt dieses Projekts
- **Keine** SSO- oder CMS-Konzepte einfuehren
- Die **encryptete Challenge** ist Pflichtbestandteil des Login-Flows
- Das **Credential-Konzept** in Keycloak muss erhalten bleiben
- Nach Device-Registrierung prueft **das Backend**, ob ein Passwort vorhanden ist
- Falls kein Passwort existiert, wird es **vom Backend ueber die Keycloak Admin API gesetzt**
- **Keine Keycloak Required Actions** wie `UPDATE_PASSWORD` oder `VERIFY_PROFILE` fuer diesen Flow verwenden

---

## Technical Rules

- Alle Frontends in **React + TypeScript**
- Alle Backends ausser Keycloak in **Node.js + TypeScript**
- Reverse Proxy mit **Caddy**
- IAM mit **Keycloak**
- Datenbank mit **PostgreSQL**
- Architektur moeglichst klein halten: bevorzugt nur ein Node-Backend (`auth-api`)
- Frontends sollen im Runtime-Setup statisch ueber Caddy ausgeliefert werden, sofern kein besserer Minimalweg erforderlich ist

---

## Issue Tracking (bd)

**IMPORTANT**: Use **bd (beads)** for ALL task tracking.

```bash
bd ready --json
bd create "Title" -t feature -p 2 --json
bd update <id> --status in_progress --json
bd close <id> --reason "Done" --json
```

### Priorities
- `0` - Critical
- `1` - High
- `2` - Medium
- `3` - Low
- `4` - Backlog

---

## Session Completion

1. File issues for remaining work
2. Run quality gates (tests, linters, builds)
3. Update issue status
4. Sync and push when appropriate
5. Verify all intended changes are tracked

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Dolt-powered version control with native sync
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd automatically syncs via Dolt:

- Each write auto-commits to Dolt history
- Use `bd dolt push`/`bd dolt pull` for remote sync
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

<!-- END BEADS INTEGRATION -->
