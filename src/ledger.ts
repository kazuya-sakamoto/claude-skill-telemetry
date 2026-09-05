import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "./config.js";
import type { ScanOptions } from "./scan.js";
import { scanRecords } from "./scan.js";
import type { LogRecord } from "./schema.js";
import { logPath } from "./skills.js";
import { readRecords } from "./transcript.js";

export interface MergeResult {
  skill: string;
  added: number;
  updated: number;
  total: number;
}

export function collect(
  paths: string[],
  allow: ReadonlySet<string>,
  opts: ScanOptions,
): { runs: Map<string, LogRecord>; dropped: number } {
  const runs = new Map<string, LogRecord>();
  let dropped = 0;
  for (const p of paths) {
    const got = scanRecords(readRecords(p), allow, opts);
    dropped += got.dropped;
    for (const rec of got.records) {
      const old = runs.get(rec.run_id);
      // 実行中に記録された不完全なレコードを、後のスキャンで上書きする。
      if (old === undefined || rec.turns > old.turns) runs.set(rec.run_id, rec);
    }
  }
  return { runs, dropped };
}

/** 壊れた行は捨てる。ログ 1 行の破損でファイルまるごとを読めなくしない。 */
export function parseNdjson(text: string): LogRecord[] {
  const out: LogRecord[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as LogRecord);
    } catch {
      continue;
    }
  }
  return out;
}

export function readLog(path: string): LogRecord[] {
  if (!existsSync(path)) return [];
  try {
    return parseNdjson(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

/** マージの決定だけ。run_id で同一視し、turns が増えたものだけ更新、ts と run_id で安定に並べる。 */
export function mergeRecords(
  existing: LogRecord[],
  incoming: LogRecord[],
): { records: LogRecord[]; added: number; updated: number } {
  const cur = new Map<string, LogRecord>();
  for (const r of existing) cur.set(r.run_id, r);
  let added = 0;
  let updated = 0;
  for (const r of incoming) {
    const old = cur.get(r.run_id);
    if (old === undefined) added += 1;
    else if (r.turns > old.turns) updated += 1;
    else continue;
    cur.set(r.run_id, r);
  }
  const records = [...cur.values()].sort((a, b) => {
    const ka = `${a.ts ?? ""} ${a.run_id}`;
    const kb = `${b.ts ?? ""} ${b.run_id}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return { records, added, updated };
}

export function merge(
  path: string,
  recs: LogRecord[],
  dry: boolean,
): { added: number; updated: number; total: number } {
  const { records, added, updated } = mergeRecords(readLog(path), recs);
  if (!dry && (added || updated)) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    renameSync(tmp, path);
  }
  return { added, updated, total: records.length };
}

export interface WriteOptions {
  repoRoot: string;
  cfg: Config;
  machineId8: string;
  dry: boolean;
}

/** どのスキルのファイルに何を書くかの決定だけ。 */
export function plan(
  runs: Iterable<LogRecord>,
  since: string,
): { bySkill: Map<string, LogRecord[]>; skipped: number } {
  const bySkill = new Map<string, LogRecord[]>();
  let skipped = 0;
  for (const r of runs) {
    // ts は timezone で stamp 済みなので since と同じ暦で比べられる。時刻不明の実行は
    // since 以降だと証明できないので、空文字にして同じ比較で落とす。
    if ((r.ts ?? "").slice(0, 10) < since) {
      skipped += 1;
      continue;
    }
    const list = bySkill.get(r.skill);
    if (list) list.push(r);
    else bySkill.set(r.skill, [r]);
  }
  return { bySkill, skipped };
}

/** 呼び手がロックを持つこと（dry でなければ）。read-merge-write は同時実行で失われる。 */
export function write(runs: Map<string, LogRecord>, o: WriteOptions): { results: MergeResult[]; skipped: number } {
  const { bySkill, skipped } = plan(runs.values(), o.cfg.since);
  const results: MergeResult[] = [];
  for (const skill of [...bySkill.keys()].sort()) {
    const path = logPath(o.repoRoot, o.cfg, skill, o.machineId8);
    const { added, updated, total } = merge(path, bySkill.get(skill) as LogRecord[], o.dry);
    results.push({ skill, added, updated, total });
  }
  return { results, skipped };
}
