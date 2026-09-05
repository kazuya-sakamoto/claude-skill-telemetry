import { createHash } from "node:crypto";
import type { Block, LogRecord, TranscriptRecord, TsPrecision } from "./schema.js";

export interface ScanOptions {
  timezone: string;
  tsPrecision: TsPrecision;
  excludeCommands?: string[];
}

const CMD = /<command-name>\s*\/?([\w:-]+)/g;

/** Claude Code 組み込みのスラッシュコマンド。同名のリポジトリスキルは記録できない（cli が --status で警告する）。 */
export const BUILTIN = new Set([
  "model", "compact", "clear", "login", "logout", "help", "cost", "exit", "init", "resume",
  "config", "status", "doctor", "memory", "review", "agents", "terminal-setup", "vim", "bug",
  "release-notes", "pr-comments", "add-dir", "artifacts", "tasks", "workflows", "fast", "export",
  "mcp", "permissions", "hooks", "ide", "upgrade", "privacy-settings", "output-style", "todos",
]);

function sha(s: string, n: number): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, n);
}

function content(r: TranscriptRecord): string | unknown[] | undefined {
  return r.message?.content;
}

function blocks(c: unknown): Block[] {
  return Array.isArray(c) ? (c.filter((b) => typeof b === "object" && b !== null && !Array.isArray(b)) as Block[]) : [];
}

function texts(c: unknown): string {
  return blocks(c)
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join(" ");
}

function has(c: unknown, kind: string): boolean {
  return blocks(c).some((b) => b.type === kind);
}

function parse(ts: string | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

function zoned(d: Date, tz: string): Record<string, string> {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZoneName: "longOffset",
  });
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(d)) out[p.type] = p.value;
  return out;
}

export function stamp(ts: string | undefined, opts: ScanOptions): string | null {
  const d = parse(ts);
  if (!d) return null;
  const p = zoned(d, opts.timezone);
  const day = `${p.year}-${p.month}-${p.day}`;
  if (opts.tsPrecision === "day") return day;
  const offset = (p.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
  return `${day}T${p.hour}:${p.minute}:${p.second}${offset}`;
}

function duration(a: string | undefined, b: string | undefined): number | null {
  const da = parse(a);
  const db = parse(b);
  return da && db ? Math.trunc((db.getTime() - da.getTime()) / 1000) : null;
}

/** 1 回のスキル実行の範囲。起点レコードで開き、次の人間の発話で閉じる。集計はまだしない。 */
export interface Segment {
  skill: string;
  invokedBy: "slash" | "auto";
  start: TranscriptRecord;
  body: TranscriptRecord[];
  result: "interrupted" | null;
  /** 注入されたスキル本文。skill_rev の材料。 */
  revText: string | null;
}

/** transcript を歩いて実行の境界だけを決める。純粋関数（ファイルも時計も触らない）。 */
export function segments(records: Iterable<TranscriptRecord>, excluded: ReadonlySet<string>): Segment[] {
  const out: Segment[] = [];

  const begin = (skill: string, invokedBy: "slash" | "auto", start: TranscriptRecord): Segment => ({
    skill, invokedBy, start, body: [], result: null, revText: null,
  });
  // 閉じた結果を返り値で渡すのは、クロージャ内で cur を書き換えると型の絞り込みが壊れるため。
  const close = (seg: Segment | null, result: "interrupted" | null): null => {
    if (seg) {
      seg.result = result;
      out.push(seg);
    }
    return null;
  };

  let cur: Segment | null = null;
  for (const r of records) {
    const c = content(r);
    if (r.type === "user") {
      if (typeof c === "string") {
        cur = close(cur, null);
        const names = [...c.slice(0, 300).matchAll(CMD)]
          .map((m) => (m[1] ?? "").split(":").pop() as string)
          .filter((n) => n && !excluded.has(n));
        if (names.length) cur = begin(names[0] as string, "slash", r);
        continue;
      }
      if (has(c, "tool_result")) continue;
      if (r.interruptedMessageId) {
        cur = close(cur, "interrupted");
        continue;
      }
      // 残る list は注入されたスキル本文と画像添付で、どちらも人間の発話ではない。
      if (cur && cur.revText === null) {
        const t = texts(c);
        if (t) cur.revText = t;
      }
    } else if (r.type === "assistant") {
      for (const b of blocks(c)) {
        if (b.type === "tool_use" && b.name === "Skill" && !cur) {
          cur = begin(String(b.input?.skill).split(":").pop() as string, "auto", r);
        }
      }
      // 起点レコード自身も本体に入れる。auto 呼び出しは起点の usage が最初のターンになる（R7）。
      if (cur) cur.body.push(r);
    }
  }
  close(cur, null);
  return out;
}

/** 1 実行分のレコードを畳んで 1 行にする。純粋関数。 */
export function summarize(seg: Segment, opts: ScanOptions): LogRecord {
  let tok_in = 0;
  let tok_out = 0;
  let tok_thinking = 0;
  let tok_cache_read = 0;
  let tok_cache_write_5m = 0;
  let tok_cache_write_1h = 0;
  let turns = 0;
  let ctx0 = 0;
  let agents = 0;
  let firstReq: string | null = null;
  let lastReq: string | null = null;
  let model: string | null = null;
  let cli = seg.start.version ?? null;
  let tEnd = seg.start.timestamp;

  for (const r of seg.body) {
    const m = r.message ?? {};
    for (const b of blocks(m.content)) {
      if (b.type === "tool_use" && b.name === "Agent") agents += 1;
    }
    const u = m.usage;
    if (!u) continue;
    // 1 API ターンが thinking / text / tool_use の複数レコードに分かれ、同じ usage を持つ。
    // 直前の 1 件としか比べないのは意図的で、飛び石で再登場する requestId は別ターン。
    const rid = r.requestId ?? null;
    if (rid && rid === lastReq) continue;
    lastReq = rid;
    firstReq = firstReq ?? rid;
    const cc = u.cache_creation ?? {};
    const cr = u.cache_read_input_tokens ?? 0;
    if (turns === 0) ctx0 = cr;
    turns += 1;
    tEnd = r.timestamp ?? tEnd;
    model = m.model ?? model;
    cli = r.version ?? cli;
    tok_in += u.input_tokens ?? 0;
    tok_out += u.output_tokens ?? 0;
    tok_thinking += u.output_tokens_details?.thinking_tokens ?? 0;
    tok_cache_read += cr;
    tok_cache_write_5m += cc.ephemeral_5m_input_tokens ?? 0;
    tok_cache_write_1h += cc.ephemeral_1h_input_tokens ?? 0;
  }

  const units = Math.trunc(
    tok_in + 5 * tok_out + 0.1 * tok_cache_read + 1.25 * tok_cache_write_5m + 2.0 * tok_cache_write_1h,
  );
  return {
    run_id: sha(firstReq ?? `${seg.skill}${seg.start.timestamp ?? "None"}`, 12),
    ts: stamp(seg.start.timestamp, opts),
    skill: seg.skill,
    skill_rev: seg.revText === null ? null : sha(seg.revText, 8),
    model,
    cli,
    invoked_by: seg.invokedBy,
    result: seg.result,
    turns,
    duration_s: duration(seg.start.timestamp, tEnd),
    ctx0,
    tok_in,
    tok_out,
    tok_thinking,
    tok_cache_read,
    tok_cache_write_5m,
    tok_cache_write_1h,
    cost_units: units,
    // 文脈の再読み込み分を引いた「スキル自身が生んだ」コスト。
    own_units: units - Math.trunc(0.1 * tok_cache_read),
    sub_spawned: agents,
    source: "retro",
  };
}

/** 1 本の transcript から、対象スキルの実行だけを取り出す。 */
export function scanRecords(
  records: Iterable<TranscriptRecord>,
  allow: ReadonlySet<string>,
  opts: ScanOptions,
): { records: LogRecord[]; dropped: number } {
  const excluded = new Set([...BUILTIN, ...(opts.excludeCommands ?? [])]);
  const out: LogRecord[] = [];
  let dropped = 0;
  for (const seg of segments(records, excluded)) {
    const rec = summarize(seg, opts);
    // 応答が 1 ターンも無い実行は、起動しただけで終わったもの。除外数にも数えない。
    if (!rec.turns) continue;
    if (allow.has(rec.skill)) out.push(rec);
    else dropped += 1;
  }
  return { records: out, dropped };
}
