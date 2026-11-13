import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { HttpError } from "./errors";

export interface AuthUser {
  id: number;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const secret = process.env.JWT_SECRET ?? "dev-only-secret-change-me";
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production");
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ role: user.role }, secret, { subject: String(user.id), expiresIn: "8h" });
}

/** Middleware: requires "Authorization: Bearer <token>" and sets req.user. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const [scheme, token] = (req.header("authorization") ?? "").split(" ");
  if (scheme !== "Bearer" || !token) throw new HttpError(401, "missing bearer token");
  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload === "string" || !payload.sub) throw new Error("bad payload");
    req.user = { id: Number(payload.sub), role: String(payload.role) };
  } catch {
    throw new HttpError(401, "invalid or expired token");
  }
  next();
}
