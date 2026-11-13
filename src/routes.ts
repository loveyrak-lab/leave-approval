import { Request, Router } from "express";
import { pool } from "./db";
import { countWeekdays, parseDate } from "./days";
import { HttpError } from "./errors";

export const router = Router();

const ROLES = ["EMPLOYEE", "MANAGER", "ADMIN"];
const STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];

function pgCode(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}

/** Temporary identity until JWT login is added: the caller says who they are. */
function actingEmployeeId(req: Request): number {
  const raw = req.header("x-employee-id");
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    throw new HttpError(401, "x-employee-id header is required");
  }
  return id;
}

function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "invalid id");
  return id;
}

function todayInBangkok(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

// ---------- reference data ----------

router.get("/leave-types", async (_req, res) => {
  const r = await pool.query(
    `SELECT code, name, days_per_year AS "daysPerYear" FROM leave_type ORDER BY id`
  );
  res.json(r.rows);
});

router.get("/employees", async (_req, res) => {
  const r = await pool.query(
    `SELECT id, name, email, role, manager_id AS "managerId" FROM employee ORDER BY id`
  );
  res.json(r.rows);
});

router.post("/employees", async (req, res) => {
  const { name, email, role = "EMPLOYEE", managerId = null } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !email.includes("@")) {
    throw new HttpError(400, "name and email are required");
  }
  if (!ROLES.includes(role)) throw new HttpError(400, "invalid role");
  try {
    const r = await pool.query(
      `INSERT INTO employee (name, email, role, manager_id) VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, manager_id AS "managerId"`,
      [name.trim(), email.trim().toLowerCase(), role, managerId]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (pgCode(err) === "23505") throw new HttpError(409, "email already exists");
    if (pgCode(err) === "23503") throw new HttpError(400, "manager not found");
    throw err;
  }
});

/** Allowance, days used (pending + approved) and days remaining per leave type for one year. */
router.get("/employees/:id/balance", async (req, res) => {
  const id = idParam(req);
  const year =
    typeof req.query.year === "string" ? Number(req.query.year) : Number(todayInBangkok().slice(0, 4));
  if (!Number.isInteger(year)) throw new HttpError(400, "invalid year");

  const emp = await pool.query(`SELECT id FROM employee WHERE id = $1`, [id]);
  if (emp.rows.length === 0) throw new HttpError(404, "employee not found");

  const r = await pool.query(
    `SELECT t.code AS "leaveType", t.days_per_year AS allowance,
            COALESCE(SUM(r.days) FILTER (
              WHERE r.status IN ('PENDING', 'APPROVED') AND EXTRACT(YEAR FROM r.start_date) = $2
            ), 0)::float AS used
     FROM leave_type t
     LEFT JOIN leave_request r ON r.leave_type_id = t.id AND r.employee_id = $1
     GROUP BY t.id, t.code, t.days_per_year
     ORDER BY t.id`,
    [id, year]
  );
  res.json({
    employeeId: id,
    year,
    balances: r.rows.map((x) => ({
      leaveType: x.leaveType,
      allowance: x.allowance,
      used: x.used,
      remaining: x.allowance - x.used,
    })),
  });
});

// ---------- leave requests ----------

router.post("/leave-requests", async (req, res) => {
  const employeeId = actingEmployeeId(req);
  const { leaveTypeCode, startDate, endDate, reason = null } = req.body ?? {};

  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) throw new HttpError(400, "startDate and endDate must be YYYY-MM-DD");
  if (end < start) throw new HttpError(400, "endDate cannot be before startDate");
  if (startDate < todayInBangkok()) throw new HttpError(400, "cannot request leave in the past");
  if (startDate.slice(0, 4) !== endDate.slice(0, 4)) {
    throw new HttpError(400, "a request cannot span two calendar years; please split it");
  }

  const days = countWeekdays(start, end);
  if (days === 0) throw new HttpError(400, "the range contains no working days");

  const type = await pool.query(
    `SELECT id, days_per_year AS "daysPerYear" FROM leave_type WHERE code = $1`,
    [leaveTypeCode]
  );
  if (type.rows.length === 0) throw new HttpError(400, "unknown leave type");

  const year = Number(startDate.slice(0, 4));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock this employee's row: two requests from the same person are checked one at a time,
    // so they cannot both pass the balance check and together go over the allowance.
    const emp = await client.query(`SELECT id FROM employee WHERE id = $1 FOR UPDATE`, [employeeId]);
    if (emp.rows.length === 0) throw new HttpError(404, "employee not found");

    const used = await client.query(
      `SELECT COALESCE(SUM(days), 0)::float AS used FROM leave_request
       WHERE employee_id = $1 AND leave_type_id = $2
         AND status IN ('PENDING', 'APPROVED')
         AND EXTRACT(YEAR FROM start_date) = $3`,
      [employeeId, type.rows[0].id, year]
    );
    const remaining = type.rows[0].daysPerYear - used.rows[0].used;
    if (days > remaining) {
      throw new HttpError(422, `not enough leave balance: ${remaining} day(s) left for ${year}`);
    }

    const r = await client.query(
      `INSERT INTO leave_request (employee_id, leave_type_id, start_date, end_date, days, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, status, days::float AS days`,
      [employeeId, type.rows[0].id, startDate, endDate, days, reason]
    );
    await client.query("COMMIT");
    res.status(201).json(r.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    // 23P01 = exclusion_violation: the database rejected an overlapping range
    if (pgCode(err) === "23P01") throw new HttpError(409, "overlaps with another leave request");
    throw err;
  } finally {
    client.release();
  }
});

router.get("/leave-requests", async (req, res) => {
  const where: string[] = [];
  const params: unknown[] = [];

  if (typeof req.query.employeeId === "string") {
    const id = Number(req.query.employeeId);
    if (!Number.isInteger(id)) throw new HttpError(400, "invalid employeeId");
    params.push(id);
    where.push(`r.employee_id = $${params.length}`);
  }
  if (typeof req.query.status === "string") {
    if (!STATUSES.includes(req.query.status)) throw new HttpError(400, "invalid status");
    params.push(req.query.status);
    where.push(`r.status = $${params.length}`);
  }

  const r = await pool.query(
    `SELECT r.id, r.employee_id AS "employeeId", e.name AS "employeeName",
            t.code AS "leaveType", r.start_date::text AS "startDate",
            r.end_date::text AS "endDate", r.days::float AS days, r.reason, r.status
     FROM leave_request r
     JOIN employee e ON e.id = r.employee_id
     JOIN leave_type t ON t.id = r.leave_type_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY r.start_date, r.id`,
    params
  );
  res.json(r.rows);
});

async function decide(req: Request, newStatus: "APPROVED" | "REJECTED") {
  const deciderId = actingEmployeeId(req);
  const id = idParam(req);
  const note = typeof req.body?.note === "string" ? req.body.note : null;

  const info = await pool.query(
    `SELECT r.employee_id AS "requesterId", e.manager_id AS "managerId", d.role AS "deciderRole"
     FROM leave_request r
     JOIN employee e ON e.id = r.employee_id
     JOIN employee d ON d.id = $2
     WHERE r.id = $1`,
    [id, deciderId]
  );
  if (info.rows.length === 0) throw new HttpError(404, "leave request or decider not found");

  const { requesterId, managerId, deciderRole } = info.rows[0];
  if (requesterId === deciderId) throw new HttpError(403, "you cannot decide your own request");
  if (deciderRole !== "ADMIN" && managerId !== deciderId) {
    throw new HttpError(403, "only the employee's manager or an admin can decide");
  }

  // The status check is inside the UPDATE, so two people deciding at once cannot both win.
  const upd = await pool.query(
    `UPDATE leave_request
     SET status = $1, decided_by = $2, decided_at = now(), decision_note = $3
     WHERE id = $4 AND status = 'PENDING'
     RETURNING id, status`,
    [newStatus, deciderId, note, id]
  );
  if (upd.rows.length === 0) throw new HttpError(409, "the request is not pending");
  return upd.rows[0];
}

router.post("/leave-requests/:id/approve", async (req, res) => {
  res.json(await decide(req, "APPROVED"));
});

router.post("/leave-requests/:id/reject", async (req, res) => {
  res.json(await decide(req, "REJECTED"));
});

router.post("/leave-requests/:id/cancel", async (req, res) => {
  const employeeId = actingEmployeeId(req);
  const id = idParam(req);

  const found = await pool.query(`SELECT employee_id AS "ownerId" FROM leave_request WHERE id = $1`, [id]);
  if (found.rows.length === 0) throw new HttpError(404, "leave request not found");
  if (found.rows[0].ownerId !== employeeId) throw new HttpError(403, "only the owner can cancel");

  const upd = await pool.query(
    `UPDATE leave_request SET status = 'CANCELLED'
     WHERE id = $1 AND status IN ('PENDING', 'APPROVED') AND end_date >= $2::date
     RETURNING id, status`,
    [id, todayInBangkok()]
  );
  if (upd.rows.length === 0) throw new HttpError(409, "this request can no longer be cancelled");
  res.json(upd.rows[0]);
});
