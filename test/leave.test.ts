import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, stopTestApp } from "./helpers";

let app: any;
let pool: any;
const uid: Record<string, number> = {};
const token: Record<string, string> = {};

const auth = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
const apply = (who: string, body: object) =>
  request(app).post("/leave-requests").set(auth(who)).send(body);

async function requestId(employeeId: number, startDate: string): Promise<number> {
  const r = await pool.query(
    "SELECT id FROM leave_request WHERE employee_id = $1 AND start_date = $2",
    [employeeId, startDate],
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  ({ app, pool } = await startTestApp());
  const { hashPassword } = await import("../src/password");
  const { signToken } = await import("../src/auth");
  const hash = await hashPassword("test-pass-1234");

  const add = async (name: string, role: string, managerId: number | null) => {
    const r = await pool.query(
      `INSERT INTO employee (name, email, role, manager_id, password_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, `${name.toLowerCase()}@test.com`, role, managerId, hash],
    );
    uid[name] = r.rows[0].id;
    token[name] = signToken({ id: uid[name], role } as any);
  };

  await add("Boss", "MANAGER", null);
  await add("Som", "EMPLOYEE", uid.Boss);   // Som อยู่ใต้ Boss
  await add("Nok", "EMPLOYEE", null);       // Nok ไม่มีหัวหน้า
  await add("Admin", "ADMIN", null);
});

afterAll(stopTestApp);

describe("พื้นฐาน", () => {
  it("health check ตอบ 200", async () => {
    await request(app).get("/health").expect(200);
  });

  it("เรียก API โดยไม่มี token ได้ 401", async () => {
    await request(app).get("/leave-types").expect(401);
  });
});

describe("กฎการยื่นใบลา", () => {
  it("ยื่นใบลาที่ถูกต้องสำเร็จ", async () => {
    const res = await apply("Som", {
      leaveTypeCode: "ANNUAL", startDate: "2030-04-01", endDate: "2030-04-03",
    });
    expect([200, 201]).toContain(res.status);
  });

  it("ลาทับวันกับใบเดิม -> 409", async () => {
    const res = await apply("Som", {
      leaveTypeCode: "ANNUAL", startDate: "2030-04-03", endDate: "2030-04-04",
    });
    expect(res.status).toBe(409);
  });

  it("ลาเกินโควตา (PERSONAL มี 3 วัน ขอ 4) -> 422", async () => {
    const res = await apply("Som", {
      leaveTypeCode: "PERSONAL", startDate: "2030-03-04", endDate: "2030-03-07",
    });
    expect(res.status).toBe(422);
  });

  it("ช่วงที่มีแต่เสาร์-อาทิตย์ -> 400", async () => {
    const res = await apply("Som", {
      leaveTypeCode: "ANNUAL", startDate: "2030-03-09", endDate: "2030-03-10",
    });
    expect(res.status).toBe(400);
  });

  it("ลาย้อนหลัง -> 400", async () => {
    const res = await apply("Som", {
      leaveTypeCode: "ANNUAL", startDate: "2020-01-06", endDate: "2020-01-07",
    });
    expect(res.status).toBe(400);
  });

  it("ชนิดการลาที่ไม่มีอยู่ -> 400", async () => {
    const res = await apply("Som", {
      leaveTypeCode: "NOPE", startDate: "2030-06-03", endDate: "2030-06-04",
    });
    expect(res.status).toBe(400);
  });
});

describe("สิทธิ์ตามบทบาท", () => {
  it("พนักงานอนุมัติใบลาตัวเองไม่ได้ -> 403", async () => {
    const id = await requestId(uid.Som, "2030-04-01");
    await request(app).post(`/leave-requests/${id}/approve`).set(auth("Som")).expect(403);
  });

  it("คนที่ไม่ใช่หัวหน้าของ Som อนุมัติไม่ได้ -> 403", async () => {
    const id = await requestId(uid.Som, "2030-04-01");
    await request(app).post(`/leave-requests/${id}/approve`).set(auth("Nok")).expect(403);
  });

  it("คนอื่นยกเลิกใบลาของ Som ไม่ได้ -> 403", async () => {
    const id = await requestId(uid.Som, "2030-04-01");
    await request(app).post(`/leave-requests/${id}/cancel`).set(auth("Nok")).expect(403);
  });

  it("Nok ดูยอดคงเหลือของ Som ไม่ได้ -> 403", async () => {
    await request(app).get(`/employees/${uid.Som}/balance`).set(auth("Nok")).expect(403);
  });

  it("Boss ดูยอดคงเหลือของ Som ได้", async () => {
    await request(app).get(`/employees/${uid.Som}/balance`).set(auth("Boss")).expect(200);
  });

  it("พนักงานดูรายชื่อพนักงานทั้งหมดไม่ได้ -> 403, Admin ดูได้", async () => {
    await request(app).get("/employees").set(auth("Som")).expect(403);
    await request(app).get("/employees").set(auth("Admin")).expect(200);
  });

  it("Nok ไม่เห็นใบลาของ Som ในรายการ", async () => {
    const res = await request(app).get("/leave-requests").set(auth("Nok")).expect(200);
    expect(res.body.length).toBe(0);
  });
});

describe("การอนุมัติ", () => {
  it("หัวหน้าอนุมัติได้ และอนุมัติซ้ำ -> 409", async () => {
    await apply("Som", {
      leaveTypeCode: "ANNUAL", startDate: "2030-05-06", endDate: "2030-05-07",
    });
    const id = await requestId(uid.Som, "2030-05-06");

    const first = await request(app).post(`/leave-requests/${id}/approve`).set(auth("Boss"));
    expect(first.status).toBe(200);

    const again = await request(app).post(`/leave-requests/${id}/approve`).set(auth("Boss"));
    expect(again.status).toBe(409);
  });
});
