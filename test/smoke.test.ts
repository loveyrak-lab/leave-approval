import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, stopTestApp } from "./helpers";

let app: any;

beforeAll(async () => {
  ({ app } = await startTestApp());
});
afterAll(stopTestApp);

describe("smoke", () => {
  it("health check ตอบ 200", async () => {
    await request(app).get("/health").expect(200);
  });

  it("เรียก API โดยไม่มี token ได้ 401", async () => {
    await request(app).get("/leave-types").expect(401);
  });
});
