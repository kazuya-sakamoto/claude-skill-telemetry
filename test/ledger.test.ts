import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults } from "../src/config.js";
import { merge, mergeRecords, parseNdjson, plan, write } from "../src/ledger.js";
import { rec } from "./helper.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "cst-ledger-"));
  dirs.push(d);
  return d;
}

describe("マージの決定（純粋）", () => {
  it("同じ run_id を二度取り込まない", () => {
    const first = mergeRecords([], [rec()]);
    expect(first).toMatchObject({ added: 1, updated: 0 });
    expect(mergeRecords(first.records, [rec()])).toMatchObject({ added: 0, updated: 0 });
    expect(first.records).toHaveLength(1);
  });

  it("turns が増えたレコードだけ上書きする", () => {
    const base = mergeRecords([], [rec({ turns: 2 })]).records;
    expect(mergeRecords(base, [rec({ turns: 1 })])).toMatchObject({ added: 0, updated: 0 });
    const bumped = mergeRecords(base, [rec({ turns: 5 })]);
    expect(bumped).toMatchObject({ added: 0, updated: 1 });
    expect(bumped.records[0]?.turns).toBe(5);
  });

  it("ts と run_id で安定した順序に並べる", () => {
    const { records } = mergeRecords(
      [rec({ run_id: "c", ts: "2026-09-03" }), rec({ run_id: "a", ts: "2026-09-01" })],
      [rec({ run_id: "b", ts: "2026-09-02" })],
    );
    expect(records.map((r) => r.run_id)).toEqual(["a", "b", "c"]);
  });
});

describe("書き込み先の決定（純粋）", () => {
  it("since より前の実行は対象にしない", () => {
    const { bySkill, skipped } = plan(
      [rec({ run_id: "1", ts: "2026-09-05" }), rec({ run_id: "2", ts: "2026-09-04" })],
      "2026-09-05",
    );
    expect(skipped).toBe(1);
    expect(bySkill.get("handoff")).toHaveLength(1);
  });

  it("since 当日の実行は対象にする", () => {
    expect(plan([rec({ ts: "2026-09-05" })], "2026-09-05").skipped).toBe(0);
  });

  it("時刻が取れなかった実行は since 以降と証明できないので対象にしない", () => {
    const { bySkill, skipped } = plan([rec({ ts: null })], "2026-09-05");
    expect(skipped).toBe(1);
    expect(bySkill.size).toBe(0);
  });

  it("ts が秒粒度でも日付だけで比べる", () => {
    const { skipped } = plan(
      [rec({ run_id: "1", ts: "2026-09-05T00:10:00+09:00" }), rec({ run_id: "2", ts: "2026-09-04T23:50:00+09:00" })],
      "2026-09-05",
    );
    expect(skipped).toBe(1);
  });

  it("スキルごとにまとめ、月では分けない", () => {
    const { bySkill } = plan(
      [
        rec({ run_id: "1", skill: "handoff", ts: "2026-09-01" }),
        rec({ run_id: "2", skill: "grilling", ts: "2026-09-02" }),
        rec({ run_id: "3", skill: "handoff", ts: "2026-08-31" }),
      ],
      "1970-01-01",
    );
    expect([...bySkill.keys()].sort()).toEqual(["grilling", "handoff"]);
    expect(bySkill.get("handoff")).toHaveLength(2);
  });
});

describe("NDJSON の読み書き", () => {
  it("dry-run はファイルを作らない", () => {
    const d = repo();
    const p = join(d, "logs", "a1b2c3d4.ndjson");
    expect(merge(p, [rec()], true)).toEqual({ added: 1, updated: 0, total: 1 });
    expect(existsSync(p)).toBe(false);
  });

  it("既存ファイルの壊れた行は読み飛ばして残りを守る", () => {
    const d = repo();
    const p = join(d, "logs", "a1b2c3d4.ndjson");
    mkdirSync(join(d, "logs"), { recursive: true });
    writeFileSync(p, JSON.stringify(rec({ run_id: "keep" })) + "\n{壊れた行\n");
    merge(p, [rec({ run_id: "new" })], false);
    expect(parseNdjson(readFileSync(p, "utf8")).map((r) => r.run_id).sort()).toEqual(["keep", "new"]);
  });

  it("write はスキルごとの 1 ファイルに月をまたいで書く", () => {
    const d = repo();
    const runs = new Map([
      ["1", rec({ run_id: "1", skill: "handoff", ts: "2026-09-01" })],
      ["2", rec({ run_id: "2", skill: "grilling", ts: "2026-09-02" })],
      ["3", rec({ run_id: "3", skill: "handoff", ts: "2026-08-31" })],
    ]);
    const { results } = write(runs, {
      repoRoot: d,
      cfg: defaults(),
      machineId8: "a1b2c3d4",
      dry: false,
    });
    expect(results.map((r) => r.skill)).toEqual(["grilling", "handoff"]);
    expect(existsSync(join(d, ".claude/skills/grilling/logs/a1b2c3d4.ndjson"))).toBe(true);
    const handoff = parseNdjson(readFileSync(join(d, ".claude/skills/handoff/logs/a1b2c3d4.ndjson"), "utf8"));
    expect(handoff.map((r) => r.ts)).toEqual(["2026-08-31", "2026-09-01"]);
  });
});
