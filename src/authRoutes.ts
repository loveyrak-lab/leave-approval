import { Router } from "express";
import { authenticate, signToken } from "./auth";
import { pool } from "./db";
import { HttpError } from "./errors";
import { verifyPassword } from "./password";

export const authRouter = Router();

authRouter.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    throw new HttpError(400, "email and password are required");
  }
  const r = await pool.query(
    `SELECT id, name, role, password_hash AS "passwordHash" FROM employee WHERE email = $1`,
    [email.trim().toLowerCase()]
  );
  const row = r.rows[0];
  // One message for "no such email" and "wrong password": callers cannot probe which emails exist.
  if (!row || !row.passwordHash || !(await verifyPassword(password, row.passwordHash))) {
    throw new HttpError(401, "invalid email or password");
  }
  res.json({
    token: signToken({ id: row.id, role: row.role }),
    employee: { id: row.id, name: row.name, role: row.role },
  });
});

authRouter.get("/auth/me", authenticate, (req, res) => {
  res.json(req.user);
});
