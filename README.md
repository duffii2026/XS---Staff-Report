# APA Staff Report

Staff weekly/monthly report (T&R + TRS), performance evaluation, notices and Telegram integration.

**Stack:** React 19 + Vite + Tailwind (frontend) · Express + MySQL (backend) · Gemini AI · AWS S3 · PM2

---

## Project Structure

```
apa-staff-report/
├── backend/                 # Express REST API (ESM)
│   ├── index.js             # App entry: helmet → cors → rate-limit → routes → 404/error
│   ├── config/
│   │   ├── env.js           # Loads .env / .env1 / .env2 / .env3 (via ENV_FILE)
│   │   └── db.js            # MySQL pool + pingDatabase()
│   ├── middleware/
│   │   ├── auth.js          # requireUser: X-API-Key → apa_access → apa_refresh rotate
│   │   └── errorHandler.js  # 404 + central error handler
│   ├── routes/              # One file per domain, all mounted in routes/index.js
│   ├── services/            # Business logic (auth, s3, audit, telegram, permissions…)
│   ├── sql/                 # schema.sql + migrate_v2..v5.sql
│   ├── scripts/             # seed.js, migrate.js, encrypt-passwords.js
│   └── utils/http.js        # asyncHandler, ok(), ApiError
│
└── frontend/                # React SPA (Vite)
    ├── index1/2/3.html      # 3 app variants (one per deployment)
    ├── server.ts/2/3        # Express host: proxies /api to backend + serves AI endpoints
    ├── vite.config.ts       # Dev proxy /api → localhost:581x, ports 3554/55/56
    └── src/
        ├── App.tsx          # Tab shell: tr | trs | evaluation | notices | admin | telegram
        ├── components/      # UI per feature
        ├── services/
        │   ├── api.ts       # fetch wrapper, cookies, 20s timeout, ApiEnvelope
        │   ├── storage.ts   # Data layer: hydrate from API → in-memory cache → push writes
        │   ├── telegramService.ts
        │   └── deadlineAlertService.ts
        ├── hooks/  utils/  types.ts  data/mockData.ts
```

---

## Flowcharts

👉 **[docs/flowchart.md](docs/flowchart.md)** — request flow, login/session lifecycle, frontend boot, report submit→review→notify, deadline daemon, backend boot, multi-instance map (Mermaid, renders on GitHub).

---

## API Map (`/api`, all mounted in `routes/index.js`)

| Route | Purpose | Auth |
|---|---|---|
| `GET /health` | Health check | public |
| `POST /auth/login` · `/auth/session` · `/auth/refresh` | Login, session read, silent refresh | public |
| `POST /auth/logout` · `/auth/check` | Logout, password-policy check | cookie |
| `/reports/*` | T&R weekly reports, drafts, submit, review, dispute, extension | permission |
| `/trs/*` | TRS extra tasks: assign, status, score, comments | permission |
| `/appraisals/*` | Performance evaluation workflow | permission |
| `/users/*`, `/templates/*` | Users, role templates, permissions | permission |
| `/notices/*`, `/notifications/*` | Announcements, read receipts, alerts | cookie |
| `/telegram/*` | Bot connect, triggers, test message | permission |
| `/signatures/*`, `/files/*` | Signature save/resolve, S3 upload | cookie |
| `/audit/*`, `/api-keys/*`, `/dashboard/*`, `/org-config/*` | Logs, API keys, stats, org settings | permission |
| `/ai/*` | Gemini summarize / suggest checklist | cookie |
| `GET /reportupload/*` | Public S3 file stream (signatures/proofs) | public |

**Auth model:** httpOnly cookies `apa_access` (JWT 1h) + `apa_refresh` (session 7d, rotated on use) · server-to-server via `X-API-Key` header · granular checks with `requirePermission('...')` from `services/permissions.js`.

**Response shape (everything):** `{ success, status, message?, data }` — helpers in `backend/utils/http.js`.

---

## Run Locally

```bash
# Backend (port 5811)
cd backend && npm install
npm run dev              # = dev1 → .env1, node --watch index.js

# Frontend (port 3554)
cd frontend && npm install
npm run dev              # = dev1 → server.ts (Vite + proxy)
```

Three parallel instances (own DB + ports):

| App | Frontend | Backend | DB (env) | Ports |
|-----|----------|---------|----------|-------|
| 1 | `npm run dev1` | `npm run dev1` | `.env1` → `apastaffreport` | 3554 → 5811 |
| 2 | `npm run dev2` | `npm run dev2` | `.env2` → `apastaffreport2222` | 3555 → 5812 |
| 3 | `npm run dev3` | `npm run dev3` | `.env3` → `apastaffreport3333` | 3556 → 5813 |

Other scripts: `npm run lint` (frontend, `tsc --noEmit`), `npm run check` (backend syntax), `npm run seed`, `npm run build`, `npm run serve1|2|3` (PM2).

**Required env:** `DB_*`, `JWT_SECRET`, `PASSWORD_ENCRYPTION_KEY`, `AWS_*`, `GEMINI_API_KEY`, `CORS_ORIGIN`.

---

## Debugging Cheat Sheet

| Symptom | Check |
|---|---|
| `Network error` / 502 from frontend | Backend not running, or `API_HOST` in `frontend/.env1` ≠ backend port |
| `401 Not authenticated` | Session expired — cookies must be `credentials: 'include'`; CORS origin must be in `CORS_ORIGIN` |
| `db: FAILED` in backend log | MySQL down / wrong `DB_HOST`+`DB_NAME` for that `.envN` |
| Wrong data appears | You mixed instances — each app must use matching `.envN` on **both** sides |
| `PASSWORD_ENCRYPTION_KEY missing` | Set in `.envN`; `services/passwordCrypto.js` fails fast by design |
| 404 on `/api/...` | Route exists in `routes/*.js` but not mounted in `routes/index.js` |
| File 404 (`/reportupload/...`) | S3 bucket/prefix in `AWS_*`, or `files.js` public router |
| Frontend renders but empty | `storage.ts` hydration failed — check Network tab for failing `/api` calls at boot |
| AI endpoint fails | `GEMINI_API_KEY` missing in `frontend/.envN` (2 AI routes are handled by `server.ts`, not backend) |

**Logs:** `backend/_backend.log`, `backend/npm-backend*.log`, PM2 → `pm2 logs stf_report_1`.
**Order matters in `backend/index.js`:** rate-limit → routes → `notFoundHandler` → `errorHandler`.
**Response shape everywhere:** `{ success, status, message?, data }` (see `utils/http.js`).

---

## Data Model (core)

`users` · `user_permissions` · `role_templates` · `reports` · `trs_tasks` · `appraisals` · `notifications` · `activity_logs` · `telegram_config` · `saved_signatures` · `sessions` · `api_keys`

Schema: `backend/sql/schema.sql` + incremental `migrate_v2..v5.sql`.

---

## Where to Change What

| Task | Files |
|---|---|
| New API endpoint | `backend/routes/<domain>.js` + mount in `routes/index.js` |
| New permission / role rule | `backend/services/permissions.js`, `user_permissions` table |
| Notification (in-app + Telegram) | `backend/services/notificationFlow.js` (event → trigger key) |
| Reminder timing / throttling | `backend/services/deadline.js` (`alertWindows`, daily send limit) |
| New UI tab or view | `frontend/src/App.tsx` (tab list) + `components/<View>.tsx` |
| New data operation | `frontend/src/services/storage.ts` (cache + API write) |
| New API call | `frontend/src/services/api.ts` |
| AI prompts | `frontend/server.ts` (2 endpoints) + `backend/routes/ai.js` |
| Styling | Tailwind classes, `frontend/src/index.css` |
