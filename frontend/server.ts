import express from "express";
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

// ENV_FILE is set by the dev script (local .env2). Production falls back to .env2.
// AI generation lives in the backend. This host only proxies application requests.
const envFile = process.env.ENV_FILE || ".env2";
dotenv.config({ path: envFile });

async function startServer() {
  const app = express();
  const PORT = 3555;

  const apiHost = process.env.API_HOST || "staffapi.apa2-eva.com";
  const isLocal = apiHost.includes("localhost") || apiHost.includes("127.0.0.1");
  const apiProto = isLocal ? http : https;

  app.use("/api", (req, res, next) => {
    const headers = { ...req.headers, host: apiHost };
    const proxyReq = apiProto.request(
      { hostname: apiHost.split(":")[0], port: apiHost.split(":")[1] || (isLocal ? 80 : 443), path: req.originalUrl, method: req.method, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", (err) => {
      console.error("[api proxy]", err.message);
      res.status(502).json({
        success: false,
        status: 502,
        message: `API backend unreachable at ${isLocal ? "http" : "https"}://${apiHost}.`,
        data: null,
      });
    });
    req.pipe(proxyReq);
  });

  app.use("/reportupload", (req, res, next) => {
    const headers = { ...req.headers, host: apiHost };
    const proxyReq = apiProto.request(
      { hostname: apiHost.split(":")[0], port: apiHost.split(":")[1] || (isLocal ? 80 : 443), path: req.originalUrl, method: req.method, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", (err) => {
      console.error("[file proxy]", err.message);
      res.status(502).send("S3 file backend unreachable");
    });
    req.pipe(proxyReq);
  });

  app.use(express.json({ limit: "10mb" }));

  // AI generation (summarize-report, suggest-jd-checklist) is handled by the
  // backend, which owns GEMINI_API_KEY — /api/* is proxied above.

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
    app.get("*", async (req, res) => {
      const raw = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf-8");
      const html = await vite.transformIndexHtml(req.originalUrl, raw);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`APA 2 Server running on http://localhost:${PORT}`);
    console.log(`[proxy] API backend → ${isLocal ? "http" : "https"}://${apiHost}`);
  });
}

startServer();
