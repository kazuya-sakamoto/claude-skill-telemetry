import type { Config } from "./config.js";
import type { LogRecord } from "./schema.js";
import { readLog } from "./ledger.js";
import { discoverSkills, listLogFiles } from "./skills.js";

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

function pad(s: string, w: number): string {
  // 見出しとの桁合わせにスキル名の表示幅は使わない（ASCII 前提）。ずれても読めればよい。
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function lpad(s: string, w: number): string {
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}

/** 集計と整形。行を渡せば文字列が返る（純粋）。 */
export function render(
  rows: LogRecord[],
  writers: ReadonlySet<string>,
  fileCount: number,
  allSkills: ReadonlySet<string>,
): string {
  if (!rows.length) return "記録なし";

  const by = new Map<string, LogRecord[]>();
  for (const r of rows) {
    const list = by.get(r.skill);
    if (list) list.push(r);
    else by.set(r.skill, [r]);
  }
  const ts = rows.map((r) => r.ts ?? "").filter(Boolean).sort();
  const units = rows.reduce((s, r) => s + r.cost_units, 0);

  const out: string[] = [];
  out.push(
    `${rows.length} 実行 / ${by.size} スキル / ${writers.size} マシン / ${fileCount} ファイル` +
      ` / ${(ts[0] ?? "").slice(0, 10)}〜${(ts[ts.length - 1] ?? "").slice(0, 10)}` +
      ` / 総 ${units.toLocaleString("en-US")} units`,
  );
  out.push("");
  out.push(
    pad("skill", 34) + lpad("runs", 5) + lpad("turns", 7) + lpad("units中央", 11) + lpad("固有%", 7) +
      lpad("auto", 6) + lpad("中断", 6),
  );
  const sorted = [...by.entries()].sort(
    (a, b) => b[1].reduce((s, r) => s + r.cost_units, 0) - a[1].reduce((s, r) => s + r.cost_units, 0),
  );
  for (const [skill, v] of sorted) {
    const u = median(v.map((x) => x.cost_units)) || 1;
    out.push(
      pad(skill, 34) +
        lpad(String(v.length), 5) +
        lpad(median(v.map((x) => x.turns)).toFixed(0), 7) +
        lpad(Math.round(u).toLocaleString("en-US"), 11) +
        lpad(`${((median(v.map((x) => x.own_units)) / u) * 100).toFixed(0)}%`, 7) +
        lpad(String(v.filter((x) => x.invoked_by === "auto").length), 6) +
        lpad(String(v.filter((x) => x.result === "interrupted").length), 6),
    );
  }
  const unused = [...allSkills].filter((s) => !by.has(s)).sort();
  if (unused.length) {
    out.push("");
    out.push(`記録期間中に実行が無いスキル ${unused.length} 種: ${unused.join(" ")}`);
  }
  return out.join("\n");
}

/** working tree 上のログを集計する。人単位では出さない（構造上も出しにくい）。 */
export function report(repoRoot: string, cfg: Config): string {
  const files = listLogFiles(repoRoot, cfg);
  const rows: LogRecord[] = [];
  const writers = new Set<string>();
  for (const f of files) {
    writers.add(f.machineId);
    rows.push(...readLog(f.path));
  }
  return render(rows, writers, files.length, discoverSkills(repoRoot, cfg));
}
