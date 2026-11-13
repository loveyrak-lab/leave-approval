import fs from "node:fs";
import path from "node:path";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";

let container: StartedPostgreSqlContainer;

// เปิด Postgres ชั่วคราว -> ตั้งค่า env ให้ db.ts -> รัน migrations -> คืน app
export async function startTestApp() {
  container = await new PostgreSqlContainer("postgres:16").start();
  process.env.DB_HOST = container.getHost();
  process.env.DB_PORT = String(container.getPort());
  process.env.DB_NAME = container.getDatabase();
  process.env.DB_USER = container.getUsername();
  process.env.DB_PASSWORD = container.getPassword();

  // ต้อง import หลังตั้ง env เท่านั้น ไม่งั้น pool จะชี้ไปฐานข้อมูล dev
  const { pool } = await import("../src/db");

  const dir = path.resolve(process.cwd(), "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await pool.query(fs.readFileSync(path.join(dir, f), "utf8"));
  }

  const mod: any = await import("../src/app");
  const app = mod.default ?? mod.app;
  return { app, pool };
}

export async function stopTestApp() {
  const { pool } = await import("../src/db");
  await pool.end();
  await container.stop();
}
