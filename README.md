# APA 2 - Staff Report

Staff weekly/monthly report (T&R + TRS), performance evaluation, notices, and Telegram integration.

**Stack:** React 19 + Vite + Tailwind · Express + MySQL · Gemini AI · AWS S3 · PM2

## Project structure

- `backend/`: Express API, authentication, permissions, domain services, SQL schema/migrations, and deployment configuration.
- `frontend/`: React app, API client, and Express host that serves the SPA and proxies API/file requests.
- `docs/flowchart.md`: request flow, login/session lifecycle, report workflow, deadline worker, and deployment diagram.

The frontend runs on port 3555 and proxies to the backend on port 5812. The app uses the existing `APA 2 - Staff Report` database. Local backend settings are in the ignored `backend/.env2.local`; production settings are provided in the server's `.env` or secrets manager. Never commit credentials.

## API overview

All endpoints are mounted from `backend/routes/index.js`.

| Route | Purpose | Auth |
|---|---|---|
| `GET /health` | Health check | public |
| `/auth/*` | Login, sessions, refresh, logout | route-specific |
| `/reports/*` | Weekly reports, drafts, submission, review, disputes | permission |
| `/trs/*` | TRS task assignment, status, score, comments | permission |
| `/appraisals/*` | Performance evaluation | permission |
| `/users/*`, `/templates/*` | Users, roles, permissions, templates | permission |
| `/notices/*`, `/notifications/*` | Announcements and alerts | route-specific |
| `/telegram/*` | Bot configuration, triggers, tests | permission |
| `/signatures/*`, `/files/*` | Signatures and S3 files | route-specific |
| `/audit/*`, `/api-keys/*`, `/dashboard/*`, `/org-config/*` | Logs, keys, statistics, organization settings | permission |
| `/ai/*` | AI summaries and checklist suggestions | authenticated |

Authentication uses httpOnly access and refresh cookies, server API keys, and granular permission checks. Responses use `{ success, status, message?, data }`.

## Local development

Start the backend from `backend/` with `npm run dev` (port 5812), then start the frontend from `frontend/` with `npm run dev` (port 3555). The frontend is available at http://localhost:3555.

Useful commands: frontend `npm run lint`, `npm run build`, `npm start`; backend `npm run check`. Database migrations and seed scripts are manual operations; do not run them as part of ordinary startup.

## Configuration and data

The local backend profile uses the existing APA 2 database, its existing port, and the App2 S3 bucket. Keep `.env2.local`, `.env2.secrets`, cloud credential files, and production `.env` files private. The schema and migration files target the configured database; review and back up data before any manual migration.

## Troubleshooting

- Frontend API errors: confirm the backend is listening on port 5812 and frontend proxy settings target it.
- Login/CORS errors: verify the local frontend origin (`http://localhost:3555`) is in `CORS_ORIGIN`.
- Database connection errors: check MySQL availability and the ignored local configuration without printing credentials.
- File access errors: check App2 S3 bucket and cloud role/credentials.
- AI errors: verify the backend AI key in a private secrets file or secrets manager.
- Empty page: inspect the browser network tab for failed `/api` requests.

See `backend/sql/schema.sql` and `backend/sql/migrate_v*.sql` for database structure. Never run seed scripts against a database containing real user data.
