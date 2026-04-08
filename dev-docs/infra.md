<!-- Generated: 2026-04-08 09:38:59 UTC -->
# Infra notes (logging ingest)

Backend-facing assumptions the Node SDK/CLI relies on for log ingest. (Hosted service vs self-hosted may differ in hardening; this is the contract the client code expects.)

## WebSocket ingest endpoints

Two paths:


| Path                                    | Auth                                      | Producer         | SDK                                        | CLI helpers                              |
| --------------------------------------- | ----------------------------------------- | ---------------- | ------------------------------------------ | ---------------------------------------- |
| `**/{project_id}/create_log**`          | Yes (**`Authorization: Bearer <project token>`** + **`secret: <user secret>`**) | Node / server    | `**AuraServer**` (`auralogger-cli/server`) | `**server-check**`, `**test-serverlog**` |
| `**/{project_id}/create_browser_logs**` | Yes (**`Authorization: Bearer <project token>`**) | Client ingest    | `**AuraClient**` (`auralogger-cli/client`) | `**client-check**`, `**test-clientlog**` |


Treat browser ingest as **untrusted** server-side: validate, rate-limit, and abuse-protect as your deployment requires.

## HTTP companion

- `**POST /api/proj_auth`** — header **`secret`** only (project token) → project id, session, styles
- `**POST /api/logs**` — filtered log fetch for `**get-logs**` (headers **`secret`** + **`user_secret`** when required)

See `**routes.md**` for file pointers and env overrides.