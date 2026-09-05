import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { TsPrecision } from "./schema.js";

export const CONFIG_PATH = ".claude/skill-telemetry.json";
export const OPTOUT_PATH = ".claude/no-skill-log";

export type SyncLevel = "write" | "commit" | "pr";

export interface Config {
  since: string;
  skillsDir: string;
  logsSubdir: string;
  timezone: string;
  tsPrecision: TsPrecision;
  identity: { requireOrg: string | null; machineId: string | null };
  sync: { level: SyncLevel; minIntervalHours: number; branchPrefix: string; allowPublicRepo: boolean };
  excludeCommands: string[];
}

const DEFAULTS: Config = {
  // 設定ファイルでは必須。この既定値は、絞りを主題にしないテストと parity を全件通すためだけのもの。
  since: "1970-01-01",
  skillsDir: ".claude/skills",
  logsSubdir: "logs",
  // 日付の境界が揃っていないと日次集計が食い違う。既定はシステム TZ、揃えたいなら設定で固定する。
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  tsPrecision: "day",
  identity: { requireOrg: null, machineId: null },
  sync: { level: "write", minIntervalHours: 24, branchPrefix: "skill-logs/", allowPublicRepo: false },
  excludeCommands: [],
};

export function defaults(): Config {
  return structuredClone(DEFAULTS);
}

export class ConfigError extends Error {}

/** 設定ファイルが無いリポジトリは対象外（R1）。user スコープで install しても全リポジトリでは発火しない。 */
export function hasConfig(repoRoot: string): boolean {
  return existsSync(join(repoRoot, CONFIG_PATH));
}

export function isDisabled(repoRoot: string): boolean {
  if (process.env.SKILL_TELEMETRY_DISABLE === "1") return true;
  return existsSync(join(repoRoot, OPTOUT_PATH));
}

export function loadConfig(repoRoot: string): Config {
  const path = join(repoRoot, CONFIG_PATH);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ConfigError(`${CONFIG_PATH} を読めない: ${(e as Error).message}`);
  }
  return validate(raw);
}

export function validate(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`${CONFIG_PATH} はオブジェクトである必要がある`);
  }
  const o = raw as Record<string, unknown>;
  const c = defaults();

  if (!("since" in o)) throw new ConfigError("since は必須（YYYY-MM-DD。この日以降の実行だけを記録する）");
  c.since = date(o.since, "since");
  if ("skillsDir" in o) c.skillsDir = relPath(o.skillsDir, "skillsDir");
  if ("logsSubdir" in o) c.logsSubdir = relPath(o.logsSubdir, "logsSubdir");
  if ("timezone" in o) c.timezone = timezone(o.timezone);
  if ("tsPrecision" in o) c.tsPrecision = oneOf(o.tsPrecision, ["day", "second"], "tsPrecision");
  if ("excludeCommands" in o) c.excludeCommands = strings(o.excludeCommands, "excludeCommands");

  const id = section(o.identity, "identity");
  if (id) {
    if ("requireOrg" in id) c.identity.requireOrg = nullableString(id.requireOrg, "identity.requireOrg");
    if ("machineId" in id) c.identity.machineId = nullableString(id.machineId, "identity.machineId");
  }
  const sy = section(o.sync, "sync");
  if (sy) {
    if ("level" in sy) c.sync.level = oneOf(sy.level, ["write", "commit", "pr"], "sync.level");
    if ("minIntervalHours" in sy) c.sync.minIntervalHours = positive(sy.minIntervalHours, "sync.minIntervalHours");
    if ("branchPrefix" in sy) c.sync.branchPrefix = str(sy.branchPrefix, "sync.branchPrefix");
    if ("allowPublicRepo" in sy) c.sync.allowPublicRepo = bool(sy.allowPublicRepo, "sync.allowPublicRepo");
  }
  // v1 は write レベルしか実装していない。黙って書くだけで済ませると、commit されると
  // 思った利用者が「なぜ PR が来ないのか」を追えないので、設定を読んだ時点で落とす。
  if (c.sync.level !== "write") {
    throw new ConfigError(`sync.level "${c.sync.level}" は v1 では未実装（"write" のみ）`);
  }
  return c;
}

function section(v: unknown, name: string): Record<string, unknown> | null {
  if (v === undefined) return null;
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ConfigError(`${name} はオブジェクト`);
  return v as Record<string, unknown>;
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || v === "") throw new ConfigError(`${name} は空でない文字列`);
  return v;
}

function nullableString(v: unknown, name: string): string | null {
  return v === null ? null : str(v, name);
}

function bool(v: unknown, name: string): boolean {
  if (typeof v !== "boolean") throw new ConfigError(`${name} は真偽値`);
  return v;
}

function positive(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new ConfigError(`${name} は 0 以上の数値`);
  return v;
}

function strings(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ConfigError(`${name} は文字列の配列`);
  return v as string[];
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], name: string): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new ConfigError(`${name} は ${allowed.map((a) => `"${a}"`).join(" | ")} のいずれか`);
  }
  return v as T;
}

function date(v: unknown, name: string): string {
  const s = str(v, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw new ConfigError(`${name} は YYYY-MM-DD 形式の日付`);
  }
  return s;
}

/** 書き込み先がリポジトリの外に出ないことを設定の読み込み時点で保証する。 */
function relPath(v: unknown, name: string): string {
  const s = str(v, name).replace(/\/+$/, "");
  if (s.startsWith("/") || s.split("/").includes("..")) throw new ConfigError(`${name} はリポジトリ内の相対パス`);
  return s;
}

function timezone(v: unknown): string {
  const s = str(v, "timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s });
  } catch {
    throw new ConfigError(`timezone "${s}" は IANA タイムゾーン名として解決できない`);
  }
  return s;
}
