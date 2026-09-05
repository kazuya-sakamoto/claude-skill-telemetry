import type { LogRecord } from "../src/schema.js";

/** 最小の完全なレコード。テストごとに必要な差分だけ上書きする。 */
export function rec(over: Partial<LogRecord> = {}): LogRecord {
  return {
    run_id: "aaaaaaaaaaaa",
    ts: "2026-09-01",
    skill: "handoff",
    skill_rev: "deadbeef",
    model: "claude-opus-5",
    cli: "2.1.251",
    invoked_by: "slash",
    result: null,
    turns: 1,
    duration_s: 10,
    ctx0: 0,
    tok_in: 1,
    tok_out: 1,
    tok_thinking: 0,
    tok_cache_read: 0,
    tok_cache_write_5m: 0,
    tok_cache_write_1h: 0,
    cost_units: 6,
    own_units: 6,
    sub_spawned: 0,
    source: "retro",
    ...over,
  };
}
