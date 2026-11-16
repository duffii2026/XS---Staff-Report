# XS Staff Report

XS Staff Report is a staff reporting and task management application. It provides weekly T&R reports, TRS task workflows, deliverable proof uploads, manager review, notices, performance evaluation, and Telegram notifications.

## Repository branches

- `app1` and `app2` currently point to the same application version.
- `main` contains this repository guide. The application source is on `app1` and `app2`.
- Use `app2` for active development. Keep `app1` synchronized when publishing a shared release.

Clone the application branch:

```powershell
git clone --branch app2 --single-branch https://github.com/duffii2026/XS---Staff-Report.git
cd XS---Staff-Report
```

## Architecture

```text
Browser (React + Vite) :3555
        │ /api and file requests
        ▼
Express API :5812 ── MySQL database
        ├──────────── AWS S3 (uploaded proof and signatures)
        └──────────── Gemini API (optional AI features)
```

- `frontend/` contains the React application and the Express web host/proxy.
- `backend/` contains the API, authentication, permissions, report and task services, and scheduled notifications.
- `backend/sql/` contains the schema and versioned migrations.
- `docs/flowchart.md` describes the main request and reporting flows.

## Requirements

- Node.js and npm.
- A reachable MySQL database with the Staff Report schema.
- AWS S3 access for file uploads. Gemini credentials are needed only for AI features.

## Local setup

From the repository root, install dependencies and create private local configuration files from the checked-in examples:

```powershell
cd backend
npm ci
Copy-Item .env2.local.example .env2.local
```

In another terminal, from the repository root:

```powershell
cd frontend
npm ci
Copy-Item .env2.example .env2
```

Edit both private files before starting the application. Set the database host, port, database name, user, and password in `backend/.env2.local`. Keep `API_HOST=localhost:5812` in `frontend/.env2` for local development. Set `CORS_ORIGIN=http://localhost:3555` in the backend configuration.

The backend requires a strong `JWT_SECRET` and a valid `PASSWORD_ENCRYPTION_KEY` (Base64 encoded 32 random bytes). Generate values locally with Node.js; do not paste them into source files or commit them:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set the first value as `JWT_SECRET` and the second as `PASSWORD_ENCRYPTION_KEY`. Store `GEMINI_API_KEY` only in the backend's private environment file or a secrets manager. Do not put API keys in frontend configuration.

Start the backend and frontend in separate terminals:

```powershell
# Terminal 1
cd backend
npm run dev
```

```powershell
# Terminal 2
cd frontend
npm run dev
```

Open [http://localhost:3555](http://localhost:3555). The API health endpoint is [http://localhost:5812/api/health](http://localhost:5812/api/health).

## Build and checks

```powershell
cd backend
npm run check
npm run build
```

```powershell
cd frontend
npm run lint
npm run build
```

The frontend production bundle is served by its Express host on port `3555`; the backend API listens on port `5812`. PM2 configuration is in each service's `ecosystem.config.cjs`.

## Database and files

The application uses MySQL and AWS S3. Review the configured database and take an approved backup before applying any migration. Migrations are manual; normal startup does not apply them. Do not run the seed script against a database containing real user data.

For local file uploads, configure the App2 S3 bucket and AWS credentials through a local profile, environment variables, or an instance role. Never commit AWS credentials or private keys.

## Production release

Deploy only an approved build. Back up the current application files before replacing a release. Database backups are required before any database migration. Restart the Staff Report frontend and API services only, then verify:

- The Staff Report website loads over HTTPS.
- The API health endpoint responds successfully at `/api/health`.
- Staff Report login and key reporting workflows work.
- Existing database and uploaded files remain available.

Keep production environment variables in the server's private configuration or secrets manager. Never copy local `.env` files or credentials to GitHub.

## Troubleshooting

- **Frontend reports API unreachable:** confirm the API is listening on port `5812` and `API_HOST` points to `localhost:5812` locally.
- **Login or CORS errors:** check `CORS_ORIGIN`, `APP_URL`, and `COOKIE_SECURE` against the URL used to access the site.
- **Database connection errors:** check MySQL availability and private `DB_*` values; do not print passwords in logs or support messages.
- **Proof or signature upload errors:** check S3 bucket, region, IAM permissions, and the backend file logs.
- **AI features unavailable:** check `GEMINI_API_KEY` in the backend private configuration.
- **Telegram notifications fail:** check the bot configuration, recipient chat setup, and outbound server connectivity.

## Security

- Never commit `.env` files, API keys, database passwords, Telegram bot tokens, AWS credentials, or SSH private keys.
- Use unique, strong production secrets; rotate any credential that was exposed.
- Keep application roles and permissions managed through the Staff Report administration workflows.
- Do not apply SQL migrations or seed data to production without an approved backup and rollback plan.
