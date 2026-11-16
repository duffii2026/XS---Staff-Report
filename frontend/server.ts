import express from "express";
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

// ENV_FILE is set by the dev scripts (local .env1/.env2). Production (build1/start) falls back to .env.
dotenv.config({ path: process.env.ENV_FILE || ".env" });

async function startServer() {
  const app = express();
  const PORT = 3554;

  const getAiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not configured.");
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  };

  const apiHost = process.env.API_HOST || "staffapi.apa1-eva.com";
  const isLocal = apiHost.includes("localhost") || apiHost.includes("127.0.0.1");
  const apiProto = isLocal ? http : https;

  app.use("/api", (req, res, next) => {
    if (req.path === "/ai/summarize-report" || req.path === "/ai/suggest-jd-checklist") {
      return next();
    }
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

  app.post("/api/ai/summarize-report", async (req, res) => {
    try {
      const { staffName, position, department, period, checklistItems, trsTasks, notes } = req.body;
      const ai = getAiClient();
      const prompt = `
You are an executive HR and Operations AI Assistant evaluating a weekly/monthly staff report.

Staff Details:
- Name: ${staffName}
- Position: ${position}
- Department: ${department}
- Reporting Period: ${period}

T&R (JD Checklist Items Submitted):
${JSON.stringify(checklistItems, null, 2)}

TRS (Superior Requested Extra Tasks):
${JSON.stringify(trsTasks || [], null, 2)}

Staff Additional Notes:
"${notes || 'None provided'}"

Provide a structured analysis in Markdown with:
1. Executive Weekly Summary (2-3 key accomplishments)
2. Performance Score Assessment & Timeliness
3. Outstanding Strengths & Areas of Support / Action Items for Manager
Keep it encouraging, concise, professional, and actionable.
`;
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
      });
      res.json({ success: true, summary: response.text });
    } catch (error: any) {
      console.error("AI Summarize error:", error);
      res.status(500).json({
        success: false,
        error: error?.message || "Failed to generate AI report summary.",
      });
    }
  });

  app.post("/api/ai/suggest-jd-checklist", async (req, res) => {
    try {
      const { positionTitle, department } = req.body;
      const ai = getAiClient();
      const prompt = `
Generate 6 standard, high-impact weekly/monthly Job Description (JD) checklist tasks for the position of "${positionTitle}" in the "${department}" department.

Return ONLY a valid JSON array of objects with keys:
- "title": string (Actionable task title)
- "category": string ("Weekly" or "Monthly")
- "weight": number (Importance weight from 1 to 5)
- "description": string (Brief expectation description)

Do NOT include markdown block markers like \`\`\`json.
`;
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
      });
      let rawText = response.text || "[]";
      rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      const checklist = JSON.parse(rawText);
      res.json({ success: true, checklist });
    } catch (error: any) {
      console.error("AI Suggest Checklist error:", error);
      res.status(500).json({
        success: false,
        error: error?.message || "Failed to generate checklist template.",
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
    app.get("*", async (req, res) => {
      const raw = fs.readFileSync(path.join(process.cwd(), "index1.html"), "utf-8");
      const html = await vite.transformIndexHtml(req.originalUrl, raw);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index1.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`APA 1 Server running on http://localhost:${PORT}`);
    console.log(`[proxy] API backend → ${isLocal ? "http" : "https"}://${apiHost}`);
  });
}

startServer();
