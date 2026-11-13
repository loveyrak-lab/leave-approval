import { Pool } from "pg";

export const pool = new Pool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5433),
  database: process.env.DB_NAME ?? "leave",
  user: process.env.DB_USER ?? "leave",
  password: process.env.DB_PASSWORD ?? "leave_dev_pw",
});
