import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { scanRecords, stamp, type ScanOptions } from "../src/scan.js";
import type { LogRecord } from "../src/schema.js";
import { readRecords } from "../src/transcript.js";

const OPTS: ScanOptions = { timezone: "Asia/Tokyo", tsPrecision: "second" };
const ALLOW = new Set(["handoff", "grilling"]);
/** 形の検査は allowlist の外側も見たい（除外された実行にこそ想定外の名前が入る）。 */
const ALLOW_ALL = new Proxy(new Set<string>(), { get: (t, k) => (k === "has" ? () => true : Reflect.get(t, k)) });

const hex = (n: number) => (v: unknown): boolean => typeof v === "string" && new RegExp(`^[0-9a-f]{${n}}$`).test(v);
const nat = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0;
const orNull = (f: (v: unknown) => boolean) => (v: unknown): boolean => v === null || f(v);
const oneOf = (...allowed: unknown[]) => (v: unknown): boolean => allowed.includes(v);

/**
 * 「本文が漏れていないか」を禁止語で確かめると、fixture に無い語は素通りする。
 * 全フィールドが既知の形であることを要求すれば、本文由来の値はどれも形に収まらず落ちる。
 */
const SHAPE: Record<keyof LogRecord, (v: unknown) => boolean> = {
  run_id: hex(12),
  ts: orNull((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?$/.test(v)),
  skill: (v) => typeof v === "string" && /^[\w-]{1,64}$/.test(v),
  skill_rev: orNull(hex(8)),
  model: orNull((v) => typeof v === "string" && /^[a-z0-9.-]{1,64}$/.test(v)),
  cli: orNull((v) => typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v)),
  invoked_by: oneOf("slash", "auto"),
  result: oneOf(null, "interrupted"),
  turns: nat,
  duration_s: orNull((v) => typeof v === "number" && Number.isInteger(v)),
  ctx0: nat,
  tok_in: nat,
  tok_out: nat,
  tok_thinking: nat,
  tok_cache_read: nat,
  tok_cache_write_5m: nat,
  tok_cache_write_1h: nat,
  cost_units: nat,
  own_units: nat,
  sub_spawned: nat,
  source: oneOf("retro"),
};

function records(name: string, opts: ScanOptions = OPTS, allow = ALLOW): { recs: LogRecord[]; dropped: number } {
  const path = join(import.meta.dirname, "fixtures", name);
  const { records: recs, dropped } = scanRecords(readRecords(path), allow, opts);
  return { recs, dropped };
}

describe("スキル実行の抽出", () => {
  it("allowlist にあるスキルだけを採用し、それ以外は除外として数える", () => {
    const { recs, dropped } = records("basic.jsonl");
    expect(recs.map((r) => r.skill)).toEqual(["handoff", "grilling"]);
    expect(dropped).toBe(1);
  });

  it("組み込みコマンドは実行として開かない", () => {
    const { recs } = records("basic.jsonl");
    expect(recs.some((r) => r.skill === "model")).toBe(false);
  });

  it("slash 実行のレコードが golden と一致する", () => {
    const { recs } = records("basic.jsonl");
    expect(recs[0]).toEqual({
      run_id: "dfe7be6cee3b",
      ts: "2026-09-01T09:10:00+09:00",
      skill: "handoff",
      skill_rev: "064f761e",
      model: "claude-opus-5",
      cli: "2.1.251",
      invoked_by: "slash",
      result: null,
      turns: 2,
      duration_s: 35,
      ctx0: 1000,
      tok_in: 110,
      tok_out: 250,
      tok_thinking: 20,
      tok_cache_read: 3000,
      tok_cache_write_5m: 200,
      tok_cache_write_1h: 100,
      cost_units: 2110,
      own_units: 1810,
      sub_spawned: 1,
      source: "retro",
    } satisfies LogRecord);
  });

  it("auto 実行のレコードが golden と一致する", () => {
    const { recs } = records("basic.jsonl");
    expect(recs[1]).toEqual({
      run_id: "0ba3d79146a8",
      ts: "2026-09-01T10:00:00+09:00",
      skill: "grilling",
      skill_rev: "0de55104",
      model: "claude-opus-5",
      cli: "2.1.251",
      invoked_by: "auto",
      result: "interrupted",
      turns: 2,
      duration_s: 20,
      ctx0: 3000,
      tok_in: 13,
      tok_out: 70,
      tok_thinking: 0,
      tok_cache_read: 3100,
      tok_cache_write_5m: 0,
      tok_cache_write_1h: 0,
      cost_units: 673,
      own_units: 363,
      sub_spawned: 0,
      source: "retro",
    } satisfies LogRecord);
  });
});

describe("不変条件", () => {
  it("同一 requestId の複数レコードを 1 ターンとして数える", () => {
    const { recs } = records("basic.jsonl");
    // fixture の handoff は 3 レコード・2 リクエスト。dedup が無ければ turns=3・トークンは 1.5 倍。
    expect(recs[0]?.turns).toBe(2);
    expect(recs[0]?.tok_in).toBe(110);
  });

  it("ctx0 は最初のターンの cache_read であって合計ではない", () => {
    const { recs } = records("basic.jsonl");
    expect(recs[0]?.ctx0).toBe(1000);
    expect(recs[0]?.tok_cache_read).toBe(3000);
  });

  it("auto 呼び出しでも skill_rev が埋まる（R7）", () => {
    const { recs } = records("basic.jsonl");
    expect(recs[1]?.invoked_by).toBe("auto");
    expect(recs[1]?.skill_rev).not.toBeNull();
  });

  it("own_units は cache_read 分を差し引いた値になる", () => {
    const { recs } = records("basic.jsonl");
    for (const r of recs) {
      expect(r.own_units).toBe(r.cost_units - Math.trunc(0.1 * r.tok_cache_read));
    }
  });

  it("レコードのキーは契約の 21 個ちょうど", () => {
    for (const name of ["basic.jsonl", "edge.jsonl"]) {
      for (const r of records(name, OPTS, ALLOW_ALL).recs) {
        expect(Object.keys(r).sort(), name).toEqual(Object.keys(SHAPE).sort());
      }
    }
  });

  it("全フィールドが既知の形に収まる（本文由来の文字列が混ざれば落ちる）", () => {
    for (const name of ["basic.jsonl", "edge.jsonl"]) {
      for (const r of records(name, OPTS, ALLOW_ALL).recs) {
        const fields = r as unknown as Record<string, unknown>;
        for (const [key, ok] of Object.entries(SHAPE)) {
          expect(ok(fields[key]), `${name} の ${key}: ${JSON.stringify(fields[key])}`).toBe(true);
        }
      }
    }
  });

  it("excludeCommands で指定したコマンドは記録しない", () => {
    const { recs } = records("basic.jsonl", { ...OPTS, excludeCommands: ["handoff"] });
    expect(recs.map((r) => r.skill)).toEqual(["grilling"]);
  });

  it("飛び石で再登場した同じ requestId は別ターンとして数える", () => {
    // dedup は直前の 1 件としか比べない。実データに 148 件あるこの形を groupBy に変えると turns が減る。
    const { recs } = records("edge.jsonl");
    expect(recs[0]?.turns).toBe(5);
    expect(recs[0]?.tok_in).toBe(310);
  });

  it("requestId を持たないレコードも取りこぼさない", () => {
    const { recs } = records("edge.jsonl");
    // 末尾 2 件は requestId が無い。null 同士を「同じ」と見なすと 1 件落ちる。
    expect(recs[0]?.tok_out).toBe(31);
  });

  it("assistant の応答が無い実行は記録にも除外数にも出ない", () => {
    const { recs, dropped } = records("edge.jsonl");
    expect(recs.map((r) => r.skill)).toEqual(["handoff"]);
    expect(dropped).toBe(0);
  });

  it("壊れた行があっても前後の実行を落とさない", () => {
    const { recs } = records("corrupt.jsonl");
    expect(recs.map((r) => r.skill)).toEqual(["handoff"]);
  });
});

describe("時刻の粒度", () => {
  it("day 粒度では日付までしか出さない", () => {
    expect(stamp("2026-09-01T00:10:00.000Z", { timezone: "Asia/Tokyo", tsPrecision: "day" })).toBe("2026-09-01");
  });

  it("second 粒度ではタイムゾーンつきの秒まで出す", () => {
    expect(stamp("2026-09-01T00:10:00.000Z", OPTS)).toBe("2026-09-01T09:10:00+09:00");
  });

  it("UTC でもオフセットを落とさない", () => {
    expect(stamp("2026-09-01T00:10:00.000Z", { timezone: "UTC", tsPrecision: "second" })).toBe(
      "2026-09-01T00:10:00+00:00",
    );
  });

  it("日付の境界はタイムゾーンで決まる", () => {
    const utcNight = "2026-08-31T20:00:00.000Z";
    expect(stamp(utcNight, { timezone: "Asia/Tokyo", tsPrecision: "day" })).toBe("2026-09-01");
    expect(stamp(utcNight, { timezone: "UTC", tsPrecision: "day" })).toBe("2026-08-31");
  });

  it("タイムスタンプが無ければ null", () => {
    expect(stamp(undefined, OPTS)).toBeNull();
  });
});
