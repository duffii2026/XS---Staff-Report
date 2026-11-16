# APA Staff Report — Flowcharts

## 1. Request Flow (Browser → Backend)

```mermaid
flowchart LR
    B[Browser<br/>React SPA] -->|"GET/POST /api"| V{Proxy}
    V -->|"dev: vite proxy"| E[Express backend<br/>:5811]
    V -->|"prod: server.ts"| E
    E --> M[helmet → cors →<br/>json 25mb → rate-limit<br/>1000 / 15min]
    M --> A{middleware/auth.js<br/>requireUser}
    A -->|"X-API-Key"| APIK[API-key auth]
    A -->|"apa_access cookie"| JWT[JWT verify 1h]
    A -->|"apa_refresh cookie"| ROT[Session rotate 7d<br/>re-issue access]
    A -->|"none valid"| X401[401 → clear cookies]
    A --> P{requirePermission?<br/>services/permissions.js}
    P -->|ok| R[routes/*]
    P -->|denied| X403[403]
    R --> S[services/*<br/>audit · s3 · telegram · scoping]
    S --> DB[(MySQL)]
    S --> S3[(AWS S3<br/>presigned 15min)]
    S --> G[Gemini AI]
    R --> OK["ok() → { success, status, message?, data }"]
    OK --> V --> B
```

- **Public (no auth):** `/api/health`, `/api/auth/login|session|refresh`, `/reportupload/*` files.
- **Everything else** in `routes/index.js` sits behind `requireUser`.
- Errors thrown anywhere → `asyncHandler` → `errorHandler` (single JSON shape).

---

## 2. Login & Session Lifecycle

```mermaid
flowchart TD
    L[LoginForm / AuthModal] -->|"POST /api/auth/login<br/>user_code + password"| BE[backend]
    BE --> BC[bcrypt verify<br/>+ AES-GCM password check]
    BC --> OKL[set cookies<br/>apa_access 1h + apa_refresh 7d<br/>insert sessions row]
    OKL --> FE[storage.initStorage<br/>hydrate all collections]

    FE -->|"later API call"| A{requireUser}
    A -->|"access valid"| PASS[ok]
    A -->|"access expired,<br/>refresh valid"| RR["POST logic: rotateSession<br/>new pair + cookies"]
    RR --> PASS
    A -->|"both invalid"| OUT["401 → apa:unauthorized<br/>event → logout UI"]
    OUT --> L

    L -.->|"POST /api/auth/logout"| CLR[clear cookies +<br/>delete session row]
```

Forced password change: `POST /api/auth/check` → `ForcePasswordChange.tsx` blocks the app until resolved.

---

## 3. Frontend Boot & Data Flow

```mermaid
flowchart TD
    I[main.tsx] --> AP[App.tsx]
    AP -->|initStorage| HY[storage.ts hydrate<br/>GET users · templates · reports<br/>trs · appraisals · notices · logs]
    HY --> FAIL{any call failed?}
    FAIL -->|yes| BOOT[bootError / LoadingScreen<br/>check Network tab]
    FAIL -->|no| CACHE[(in-memory cache<br/>no localStorage)]
    HY -.->|subscribeHydration 'ready'| AP
    AP --> VIEWS[Tabs mounted lazily, kept alive:<br/>TR · TRS · Evaluation · Notices · Admin · Telegram]
    VIEWS -->|user action| MUT[mutation]
    MUT --> CACHE
    CACHE -->|optimistic update| VIEWS
    CACHE --> API[api.ts fetch<br/>credentials: include · 20s timeout]
    API -->|/api| BE[backend routes]
    BE --> DB[(MySQL)]
```

Rules: views never mount before hydration is `ready`; every write goes to the API **and** the cache (`storage.ts` mirrors the old local-first API surface).

---

## 4. Report Submit → Review → Notify

```mermaid
flowchart LR
    S[Staff opens T&R tab] --> D["draft autosave<br/>PUT /api/reports/draft/:staff/:year/:week"]
    D --> SUB["POST /api/reports/:code/submit<br/>requirePermission submitTRReport"]
    SUB --> AUD[audit log + notification row]
    AUD --> NF[services/notificationFlow.dispatchFlow<br/>event TR_SUBMIT]
    NF --> TG{telegram_config.triggers<br/>notifyTRSubmitted on?}
    TG -->|yes| TGS[Telegram message to superior]
    TG -->|no| DONE[done]
    TGS --> DONE
    SUP[Superior reviews] --> REV["POST /api/reports/:code/review<br/>score · approve · comment"]
    REV --> NF2[dispatchFlow TR_REVIEW →<br/>Telegram + notifications]
    SUP -.->|"late / disputed"| EXT["POST /:code/extension/review<br/>POST /:code/dispute · /dispute/resolve"]
```

Same pattern for TRS tasks (`/api/trs/*`) and appraisals (`/api/appraisals/*`) — route → permission → audit → `dispatchFlow`.

---

## 5. Deadline Daemon & Reminders

```mermaid
flowchart TD
    START[index.js listen] -->|db ping ok| D[startDeadlineDaemon<br/>interval DEADLINE_DAEMON_INTERVAL_MS]
    D --> SCAN[scanOnce: TRS tasks + report windows]
    SCAN --> W{urgency window:<br/>tomorrow / 1-3 days / overdue}
    W --> GATE{gate:<br/>max 2 sends per task+recipient+day,<br/>split before/after 12:00}
    GATE -->|allowed| N[create notifications row<br/>+ dispatchFlow DEADLINE_ALERT]
    GATE -->|limit hit| SKIP[skip]
    N --> TG2[Telegram countdown message]
    N --> UI[DeadlineBanner + deadlineAlertService<br/>poll every 10s in App.tsx]
```

Frontend also polls `getStaffDeadlineAlerts()` every 10s — if banners are wrong, check `services/deadline.js` windows and `deadlineAlertService.ts`.

---

## 6. Backend Boot Sequence (`backend/index.js`)

```mermaid
flowchart TD
    S[index.js start] --> ENV[config/env.js<br/>dotenv: ENV_FILE or .env]
    ENV --> MW[helmet → cors(origin list) → json →<br/>cookie-parser → rate-limit /api]
    MW --> RT["routes mounted at /api (routes/index.js)<br/>+ public files router (reportupload)"]
    RT --> ERR[notFoundHandler → errorHandler<br/>must be LAST]
    ERR --> L["app.listen env.PORT (5811)"]
    L --> P[pingDatabase]
    P -->|ok| D2[startDeadlineDaemon + log db: connected]
    P -->|fail| LOG["log db: FAILED, skip daemon<br/>(app still serves, queries will error)"]
```

---

## 7. Multi-Instance Map

```mermaid
flowchart LR
    subgraph App1[App 1 — local]
      F1[frontend :3554<br/>.env1] --> B1[backend :5811<br/>.env1] --> D1[(apastaffreport)]
    end
    subgraph App2[App 2 — local]
      F2[frontend :3555<br/>.env2] --> B2[backend :5812<br/>.env2] --> D2[(apastaffreport2222)]
    end
    subgraph App3[App 3 — remote DB]
      F3[frontend :3556<br/>.env3] --> B3[backend :5813<br/>.env3] --> D3[(apastaffreport3333<br/>3.25.19.174)]
    end
```

> Both sides of an instance must use the **same** `.envN`, otherwise the frontend talks to the wrong DB.
> Prod builds: `build1/2/3` → `dist/dist2/dist3`, served by `server.ts/2/3` on 3554/55/56 via PM2.
