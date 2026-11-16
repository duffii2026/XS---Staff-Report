# APA 2 - Staff Report frontend

Run `npm run dev` to start the local App2 profile at http://localhost:3555. The Vite proxy sends API requests to the backend on port 5812. The frontend loads local settings from the ignored `.env2` file and optional secrets from `.env2.secrets`.

Run `npm run build` to create the production frontend and server bundle. Run `npm start` to start that bundle, or `npm run serve` to start the single PM2 profile.

Keep API keys and other credentials in ignored local secret files or the production secret manager. Do not commit credentials.
