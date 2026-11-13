import { describe, expect, it } from "vitest";
import { countWeekdays, parseDate } from "../src/days";

const count = (a: string, b: string) => countWeekdays(parseDate(a)!, parseDate(b)!);

describe("parseDate", () => {
  it("รับรูปแบบ YYYY-MM-DD ที่ถูกต้อง", () => {
    expect(parseDate("2030-03-04")).toBeTruthy();
  });

  it.each(["04/03/2030", "2030-3-4", "2030-02-30", "abc", ""])(
    "ปฏิเสธ %j",
    (bad) => {
      expect(parseDate(bad)).toBeFalsy();
    },
  );
});

describe("countWeekdays (นับเฉพาะจันทร์-ศุกร์ รวมวันต้นและวันปลาย)", () => {
  // 2030-03-04 เป็นวันจันทร์
  it("จันทร์ถึงพุธ = 3 วัน", () => {
    expect(count("2030-03-04", "2030-03-06")).toBe(3);
  });

  it("วันเดียว = 1 วัน", () => {
    expect(count("2030-03-04", "2030-03-04")).toBe(1);
  });

  it("จันทร์ถึงศุกร์ = 5 วัน", () => {
    expect(count("2030-03-04", "2030-03-08")).toBe(5);
  });

  it("ศุกร์ถึงจันทร์ข้ามสุดสัปดาห์ = 2 วัน", () => {
    expect(count("2030-03-08", "2030-03-11")).toBe(2);
  });

  it("เสาร์-อาทิตย์ล้วน = 0 วัน", () => {
    expect(count("2030-03-09", "2030-03-10")).toBe(0);
  });

  it("สองสัปดาห์เต็ม = 10 วัน", () => {
    expect(count("2030-03-04", "2030-03-15")).toBe(10);
  });
});
