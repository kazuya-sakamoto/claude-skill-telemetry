import { describe, expect, it } from "vitest";
import { render } from "../src/report.js";
import { rec } from "./helper.js";

const WRITERS = new Set(["a1b2c3d4"]);
const NONE = new Set<string>();

describe("レポートの整形", () => {
  it("行が無ければ「記録なし」", () => {
    expect(render([], NONE, 0, NONE)).toBe("記録なし");
  });

  it("ヘッダに実行数・スキル数・マシン数・期間が入る", () => {
    const rows = [
      rec({ run_id: "a", skill: "handoff", ts: "2026-08-01" }),
      rec({ run_id: "b", skill: "grilling", ts: "2026-09-02" }),
    ];
    const head = render(rows, WRITERS, 2, NONE).split("\n")[0];
    expect(head).toContain("2 実行 / 2 スキル / 1 マシン / 2 ファイル");
    expect(head).toContain("2026-08-01〜2026-09-02");
  });

  it("スキル行は units 合計の降順に並ぶ", () => {
    const rows = [
      rec({ run_id: "a", skill: "small", cost_units: 10 }),
      rec({ run_id: "b", skill: "big", cost_units: 100 }),
    ];
    const lines = render(rows, WRITERS, 1, NONE).split("\n");
    const big = lines.findIndex((l) => l.startsWith("big"));
    const small = lines.findIndex((l) => l.startsWith("small"));
    expect(big).toBeGreaterThan(0);
    expect(big).toBeLessThan(small);
  });

  it("auto と中断の件数が末尾 2 列に出る", () => {
    const rows = [
      rec({ run_id: "a", skill: "s", invoked_by: "auto", result: "interrupted" }),
      rec({ run_id: "b", skill: "s" }),
    ];
    const line = render(rows, WRITERS, 1, NONE).split("\n").find((l) => l.startsWith("s "));
    expect(line).toMatch(/1\s+1$/);
  });

  it("記録期間中に実行が無いスキルを一覧に出す", () => {
    const out = render([rec({ skill: "handoff" })], WRITERS, 1, new Set(["handoff", "unused-b", "unused-a"]));
    expect(out).toContain("実行が無いスキル 2 種: unused-a unused-b");
  });
});
