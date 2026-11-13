import express, { NextFunction, Request, Response } from "express";
import { authRouter } from "./authRoutes";
import { pool } from "./db";
import { HttpError } from "./errors";
import { router } from "./routes";
import path from "node:path";

export const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: true });
  } catch {
    res.status(503).json({ status: "error", db: false });
  }
});

app.use(authRouter);
app.use(router);

// Central error handler: HttpError becomes its status code, anything else is a 500.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if ((err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ error: "invalid JSON" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});
