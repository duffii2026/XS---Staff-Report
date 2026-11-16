# Application flow

```mermaid
flowchart LR
  U[Staff member] --> F[React app :3555]
  F -->|/api and file proxy| B[Express API :5812]
  B --> A[Authentication and permissions]
  A --> S[Reports, TRS, tasks, forms, notifications]
  S --> D[(Existing APA 2 - Staff Report database)]
  S --> O[AWS S3 files]
  B --> W[Deadline and notification worker]
```

The frontend loads through the App2 server. The backend checks the signed-in user and permissions before operating on application data. Both local development and the single PM2 deployment use the App2 profile and the existing APA 2 database.
