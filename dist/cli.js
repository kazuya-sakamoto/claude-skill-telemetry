#!/usr/bin/env node

// src/cli.ts
import { resolve as resolve2 } from "node:path";

// src/config.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
var CONFIG_PATH = ".claude/skill-telemetry.json";
var OPTOUT_PATH = ".claude/no-skill-log";
var DEFAULTS = {
  // 設定ファイルでは必須。この既定値は、絞りを主題にしないテストと parity を全件通すためだけのもの。
  since: "1970-01-01",
  skillsDir: ".claude/skills",
  logsSubdir: "logs",
  // 日付の境界が揃っていないと日次集計が食い違う。既定はシステム TZ、揃えたいなら設定で固定する。
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  tsPrecision: "day",
  identity: { requireOrg: null, machineId: null },
  sync: { level: "write", minIntervalHours: 24, branchPrefix: "skill-logs/", allowPublicRepo: false },
  excludeCommands: []
};
function defaults() {
  return structuredClone(DEFAULTS);
}
var ConfigError = class extends Error {
};
function hasConfig(repoRoot2) {
  return existsSync(join(repoRoot2, CONFIG_PATH));
}
function isDisabled(repoRoot2) {
  if (process.env.SKILL_TELEMETRY_DISABLE === "1") return true;
  return existsSync(join(repoRoot2, OPTOUT_PATH));
}
function loadConfig(repoRoot2) {
  const path = join(repoRoot2, CONFIG_PATH);
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ConfigError(`${CONFIG_PATH} \u3092\u8AAD\u3081\u306A\u3044: ${e.message}`);
  }
  return validate(raw);
}
function validate(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`${CONFIG_PATH} \u306F\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308B`);
  }
  const o = raw;
  const c = defaults();
  if (!("since" in o)) throw new ConfigError("since \u306F\u5FC5\u9808\uFF08YYYY-MM-DD\u3002\u3053\u306E\u65E5\u4EE5\u964D\u306E\u5B9F\u884C\u3060\u3051\u3092\u8A18\u9332\u3059\u308B\uFF09");
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
  if (c.sync.level !== "write") {
    throw new ConfigError(`sync.level "${c.sync.level}" \u306F v1 \u3067\u306F\u672A\u5B9F\u88C5\uFF08"write" \u306E\u307F\uFF09`);
  }
  return c;
}
function section(v, name) {
  if (v === void 0) return null;
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ConfigError(`${name} \u306F\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8`);
  return v;
}
function str(v, name) {
  if (typeof v !== "string" || v === "") throw new ConfigError(`${name} \u306F\u7A7A\u3067\u306A\u3044\u6587\u5B57\u5217`);
  return v;
}
function nullableString(v, name) {
  return v === null ? null : str(v, name);
}
function bool(v, name) {
  if (typeof v !== "boolean") throw new ConfigError(`${name} \u306F\u771F\u507D\u5024`);
  return v;
}
function positive(v, name) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new ConfigError(`${name} \u306F 0 \u4EE5\u4E0A\u306E\u6570\u5024`);
  return v;
}
function strings(v, name) {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ConfigError(`${name} \u306F\u6587\u5B57\u5217\u306E\u914D\u5217`);
  return v;
}
function oneOf(v, allowed, name) {
  if (typeof v !== "string" || !allowed.includes(v)) {
    throw new ConfigError(`${name} \u306F ${allowed.map((a) => `"${a}"`).join(" | ")} \u306E\u3044\u305A\u308C\u304B`);
  }
  return v;
}
function date(v, name) {
  const s = str(v, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN((/* @__PURE__ */ new Date(`${s}T00:00:00Z`)).getTime())) {
    throw new ConfigError(`${name} \u306F YYYY-MM-DD \u5F62\u5F0F\u306E\u65E5\u4ED8`);
  }
  return s;
}
function relPath(v, name) {
  const s = str(v, name).replace(/\/+$/, "");
  if (s.startsWith("/") || s.split("/").includes("..")) throw new ConfigError(`${name} \u306F\u30EA\u30DD\u30B8\u30C8\u30EA\u5185\u306E\u76F8\u5BFE\u30D1\u30B9`);
  return s;
}
function timezone(v) {
  const s = str(v, "timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s });
  } catch {
    throw new ConfigError(`timezone "${s}" \u306F IANA \u30BF\u30A4\u30E0\u30BE\u30FC\u30F3\u540D\u3068\u3057\u3066\u89E3\u6C7A\u3067\u304D\u306A\u3044`);
  }
  return s;
}

// src/datadir.ts
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join as join2 } from "node:path";
var NAME = "claude-skill-telemetry";
function repoKey(repoRoot2) {
  return createHash("sha256").update(repoRoot2).digest("hex").slice(0, 16);
}
function dataDirs(env = process.env, home = homedir()) {
  const explicit = env.CLAUDE_PLUGIN_DATA;
  if (explicit) return [explicit];
  const root = join2(home, ".claude", "plugins", "data");
  const found = [];
  let names = [];
  try {
    names = readdirSync(root);
  } catch {
  }
  for (const n of names) {
    if (n !== NAME && !n.startsWith(`${NAME}-`)) continue;
    const path = join2(root, n);
    try {
      found.push({ path, mtime: statSync(path).mtimeMs });
    } catch {
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found.length ? found.map((f) => f.path) : [join2(tmpdir(), NAME)];
}
function dataDir(env, home) {
  return dataDirs(env, home)[0];
}

// src/identity.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join3 } from "node:path";
function resolveIdentity(cfg, home = homedir2()) {
  if (cfg.identity.machineId) {
    return { id: { machineId8: cfg.identity.machineId.slice(0, 8) } };
  }
  let d;
  try {
    d = JSON.parse(readFileSync2(join3(home, ".claude.json"), "utf8"));
  } catch {
    return { error: "~/.claude.json \u3092\u8AAD\u3081\u306A\u3044" };
  }
  const acc = d.oauthAccount ?? {};
  const want = cfg.identity.requireOrg;
  if (want) {
    const org = acc.organizationName;
    if (!acc.emailAddress) return { error: "oauthAccount.emailAddress \u304C\u7121\u3044\uFF08\u672A\u30ED\u30B0\u30A4\u30F3 / API\u30AD\u30FC\u8A8D\u8A3C\uFF09" };
    if (org !== want) return { error: `\u7D44\u7E54\u304C ${JSON.stringify(org)}\uFF08\u671F\u5F85: ${JSON.stringify(want)}\uFF09` };
  }
  const mach = d.machineID;
  if (typeof mach !== "string" || !mach) {
    return { error: "machineID \u304C\u7121\u3044\uFF08CLI \u306E\u5185\u90E8\u72B6\u614B\u306A\u306E\u3067\u30AD\u30FC\u540D\u304C\u5909\u308F\u3063\u305F\u53EF\u80FD\u6027\uFF09" };
  }
  return { id: { machineId8: mach.slice(0, 8) } };
}

// src/ledger.ts
import { existsSync as existsSync4, mkdirSync, readFileSync as readFileSync4, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// src/scan.ts
import { createHash as createHash2 } from "node:crypto";
var CMD = /<command-name>\s*\/?([\w:-]+)/g;
var BUILTIN = /* @__PURE__ */ new Set([
  "model",
  "compact",
  "clear",
  "login",
  "logout",
  "help",
  "cost",
  "exit",
  "init",
  "resume",
  "config",
  "status",
  "doctor",
  "memory",
  "review",
  "agents",
  "terminal-setup",
  "vim",
  "bug",
  "release-notes",
  "pr-comments",
  "add-dir",
  "artifacts",
  "tasks",
  "workflows",
  "fast",
  "export",
  "mcp",
  "permissions",
  "hooks",
  "ide",
  "upgrade",
  "privacy-settings",
  "output-style",
  "todos"
]);
function sha(s, n) {
  return createHash2("sha256").update(s, "utf8").digest("hex").slice(0, n);
}
function content(r) {
  return r.message?.content;
}
function blocks(c) {
  return Array.isArray(c) ? c.filter((b) => typeof b === "object" && b !== null && !Array.isArray(b)) : [];
}
function texts(c) {
  return blocks(c).filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ");
}
function has(c, kind) {
  return blocks(c).some((b) => b.type === kind);
}
function parse(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}
function zoned(d, tz) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset"
  });
  const out = {};
  for (const p of f.formatToParts(d)) out[p.type] = p.value;
  return out;
}
function stamp(ts, opts) {
  const d = parse(ts);
  if (!d) return null;
  const p = zoned(d, opts.timezone);
  const day = `${p.year}-${p.month}-${p.day}`;
  if (opts.tsPrecision === "day") return day;
  const offset = (p.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
  return `${day}T${p.hour}:${p.minute}:${p.second}${offset}`;
}
function duration(a, b) {
  const da = parse(a);
  const db = parse(b);
  return da && db ? Math.trunc((db.getTime() - da.getTime()) / 1e3) : null;
}
function segments(records, excluded) {
  const out = [];
  const begin = (skill, invokedBy, start) => ({
    skill,
    invokedBy,
    start,
    body: [],
    result: null,
    revText: null
  });
  const close = (seg, result) => {
    if (seg) {
      seg.result = result;
      out.push(seg);
    }
    return null;
  };
  let cur = null;
  for (const r of records) {
    const c = content(r);
    if (r.type === "user") {
      if (typeof c === "string") {
        cur = close(cur, null);
        const names = [...c.slice(0, 300).matchAll(CMD)].map((m) => (m[1] ?? "").split(":").pop()).filter((n) => n && !excluded.has(n));
        if (names.length) cur = begin(names[0], "slash", r);
        continue;
      }
      if (has(c, "tool_result")) continue;
      if (r.interruptedMessageId) {
        cur = close(cur, "interrupted");
        continue;
      }
      if (cur && cur.revText === null) {
        const t = texts(c);
        if (t) cur.revText = t;
      }
    } else if (r.type === "assistant") {
      for (const b of blocks(c)) {
        if (b.type === "tool_use" && b.name === "Skill" && !cur) {
          cur = begin(String(b.input?.skill).split(":").pop(), "auto", r);
        }
      }
      if (cur) cur.body.push(r);
    }
  }
  close(cur, null);
  return out;
}
function summarize(seg, opts) {
  let tok_in = 0;
  let tok_out = 0;
  let tok_thinking = 0;
  let tok_cache_read = 0;
  let tok_cache_write_5m = 0;
  let tok_cache_write_1h = 0;
  let turns = 0;
  let ctx0 = 0;
  let agents = 0;
  let firstReq = null;
  let lastReq = null;
  let model = null;
  let cli = seg.start.version ?? null;
  let tEnd = seg.start.timestamp;
  for (const r of seg.body) {
    const m = r.message ?? {};
    for (const b of blocks(m.content)) {
      if (b.type === "tool_use" && b.name === "Agent") agents += 1;
    }
    const u = m.usage;
    if (!u) continue;
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
    tok_in + 5 * tok_out + 0.1 * tok_cache_read + 1.25 * tok_cache_write_5m + 2 * tok_cache_write_1h
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
    source: "retro"
  };
}
function scanRecords(records, allow, opts) {
  const excluded = /* @__PURE__ */ new Set([...BUILTIN, ...opts.excludeCommands ?? []]);
  const out = [];
  let dropped = 0;
  for (const seg of segments(records, excluded)) {
    const rec = summarize(seg, opts);
    if (!rec.turns) continue;
    if (allow.has(rec.skill)) out.push(rec);
    else dropped += 1;
  }
  return { records: out, dropped };
}

// src/skills.ts
import { existsSync as existsSync2, readdirSync as readdirSync2 } from "node:fs";
import { join as join4 } from "node:path";
function discoverSkills(repoRoot2, cfg) {
  const base = join4(repoRoot2, cfg.skillsDir);
  if (!existsSync2(base)) return /* @__PURE__ */ new Set();
  const out = /* @__PURE__ */ new Set();
  for (const e of readdirSync2(base, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (existsSync2(join4(base, e.name, "SKILL.md"))) out.add(e.name);
  }
  return out;
}
function logDir(repoRoot2, cfg, skill) {
  return join4(repoRoot2, cfg.skillsDir, skill, cfg.logsSubdir);
}
function logPath(repoRoot2, cfg, skill, machineId8) {
  return join4(logDir(repoRoot2, cfg, skill), `${machineId8}.ndjson`);
}
var LOG_FILE = /^([A-Za-z0-9_-]{1,64})\.ndjson$/;
function listLogFiles(repoRoot2, cfg) {
  const out = [];
  const base = join4(repoRoot2, cfg.skillsDir);
  if (!existsSync2(base)) return out;
  for (const e of readdirSync2(base, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = join4(base, e.name, cfg.logsSubdir);
    if (!existsSync2(dir)) continue;
    for (const f of readdirSync2(dir)) {
      const m = LOG_FILE.exec(f);
      if (m) out.push({ skill: e.name, machineId: m[1], path: join4(dir, f) });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// src/transcript.ts
import { existsSync as existsSync3, readdirSync as readdirSync3, readFileSync as readFileSync3 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join5, resolve, sep } from "node:path";
function projectsDir() {
  return join5(homedir3(), ".claude", "projects");
}
function repoSlug(repoRoot2) {
  return repoRoot2.replace(/[^A-Za-z0-9]/g, "-");
}
function under(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}
function startedIn(path, repoRoot2) {
  let head;
  try {
    head = readFileSync3(path, "utf8").slice(0, 256 * 1024);
  } catch {
    return false;
  }
  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    let cwd;
    try {
      cwd = JSON.parse(line).cwd;
    } catch {
      continue;
    }
    if (typeof cwd === "string") return under(cwd, repoRoot2);
  }
  return false;
}
function findTranscripts(repoRoot2, root = projectsDir()) {
  if (!existsSync3(root)) return [];
  const slug = repoSlug(resolve(repoRoot2));
  const out = [];
  for (const dir of readdirSync3(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith(slug)) continue;
    for (const f of readdirSync3(join5(root, dir.name))) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join5(root, dir.name, f);
      if (startedIn(p, repoRoot2)) out.push(p);
    }
  }
  return out.sort();
}
function* readRecords(path) {
  let text;
  try {
    text = readFileSync3(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      yield JSON.parse(s);
    } catch {
      continue;
    }
  }
}

// src/ledger.ts
function collect(paths, allow, opts) {
  const runs = /* @__PURE__ */ new Map();
  let dropped = 0;
  for (const p of paths) {
    const got = scanRecords(readRecords(p), allow, opts);
    dropped += got.dropped;
    for (const rec of got.records) {
      const old = runs.get(rec.run_id);
      if (old === void 0 || rec.turns > old.turns) runs.set(rec.run_id, rec);
    }
  }
  return { runs, dropped };
}
function parseNdjson(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      continue;
    }
  }
  return out;
}
function readLog(path) {
  if (!existsSync4(path)) return [];
  try {
    return parseNdjson(readFileSync4(path, "utf8"));
  } catch {
    return [];
  }
}
function mergeRecords(existing, incoming) {
  const cur = /* @__PURE__ */ new Map();
  for (const r of existing) cur.set(r.run_id, r);
  let added = 0;
  let updated = 0;
  for (const r of incoming) {
    const old = cur.get(r.run_id);
    if (old === void 0) added += 1;
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
function merge(path, recs, dry) {
  const { records, added, updated } = mergeRecords(readLog(path), recs);
  if (!dry && (added || updated)) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    renameSync(tmp, path);
  }
  return { added, updated, total: records.length };
}
function plan(runs, since) {
  const bySkill = /* @__PURE__ */ new Map();
  let skipped = 0;
  for (const r of runs) {
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
function write(runs, o) {
  const { bySkill, skipped } = plan(runs.values(), o.cfg.since);
  const results = [];
  for (const skill of [...bySkill.keys()].sort()) {
    const path = logPath(o.repoRoot, o.cfg, skill, o.machineId8);
    const { added, updated, total } = merge(path, bySkill.get(skill), o.dry);
    results.push({ skill, added, updated, total });
  }
  return { results, skipped };
}

// src/report.ts
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pad(s, w) {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}
function lpad(s, w) {
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}
function render(rows, writers, fileCount, allSkills) {
  if (!rows.length) return "\u8A18\u9332\u306A\u3057";
  const by = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const list = by.get(r.skill);
    if (list) list.push(r);
    else by.set(r.skill, [r]);
  }
  const ts = rows.map((r) => r.ts ?? "").filter(Boolean).sort();
  const units = rows.reduce((s, r) => s + r.cost_units, 0);
  const out = [];
  out.push(
    `${rows.length} \u5B9F\u884C / ${by.size} \u30B9\u30AD\u30EB / ${writers.size} \u30DE\u30B7\u30F3 / ${fileCount} \u30D5\u30A1\u30A4\u30EB / ${(ts[0] ?? "").slice(0, 10)}\u301C${(ts[ts.length - 1] ?? "").slice(0, 10)} / \u7DCF ${units.toLocaleString("en-US")} units`
  );
  out.push("");
  out.push(
    pad("skill", 34) + lpad("runs", 5) + lpad("turns", 7) + lpad("units\u4E2D\u592E", 11) + lpad("\u56FA\u6709%", 7) + lpad("auto", 6) + lpad("\u4E2D\u65AD", 6)
  );
  const sorted = [...by.entries()].sort(
    (a, b) => b[1].reduce((s, r) => s + r.cost_units, 0) - a[1].reduce((s, r) => s + r.cost_units, 0)
  );
  for (const [skill, v] of sorted) {
    const u = median(v.map((x) => x.cost_units)) || 1;
    out.push(
      pad(skill, 34) + lpad(String(v.length), 5) + lpad(median(v.map((x) => x.turns)).toFixed(0), 7) + lpad(Math.round(u).toLocaleString("en-US"), 11) + lpad(`${(median(v.map((x) => x.own_units)) / u * 100).toFixed(0)}%`, 7) + lpad(String(v.filter((x) => x.invoked_by === "auto").length), 6) + lpad(String(v.filter((x) => x.result === "interrupted").length), 6)
    );
  }
  const unused = [...allSkills].filter((s) => !by.has(s)).sort();
  if (unused.length) {
    out.push("");
    out.push(`\u8A18\u9332\u671F\u9593\u4E2D\u306B\u5B9F\u884C\u304C\u7121\u3044\u30B9\u30AD\u30EB ${unused.length} \u7A2E: ${unused.join(" ")}`);
  }
  return out.join("\n");
}
function report(repoRoot2, cfg) {
  const files = listLogFiles(repoRoot2, cfg);
  const rows = [];
  const writers = /* @__PURE__ */ new Set();
  for (const f of files) {
    writers.add(f.machineId);
    rows.push(...readLog(f.path));
  }
  return render(rows, writers, files.length, discoverSkills(repoRoot2, cfg));
}

// src/sync.ts
import { mkdirSync as mkdirSync3, readFileSync as readFileSync5, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join7 } from "node:path";

// src/lock.ts
import { mkdirSync as mkdirSync2, rmSync, statSync as statSync2 } from "node:fs";
import { join as join6 } from "node:path";
var STALE_MS = 10 * 60 * 1e3;
function lockRoot() {
  return join6(dataDir(), "locks");
}
function acquire(repoRoot2, now = Date.now()) {
  const dir = join6(lockRoot(), repoKey(repoRoot2));
  mkdirSync2(lockRoot(), { recursive: true });
  const release = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
    }
  };
  try {
    mkdirSync2(dir);
    return { release };
  } catch {
    let age = 0;
    try {
      age = now - statSync2(dir).mtimeMs;
    } catch {
      return null;
    }
    if (age < STALE_MS) return null;
    release();
    try {
      mkdirSync2(dir);
      return { release };
    } catch {
      return null;
    }
  }
}

// src/sync.ts
function statePath(dir, repoRoot2) {
  return join7(dir, "state", `${repoKey(repoRoot2)}.json`);
}
function readOutcome(repoRoot2) {
  let best = null;
  for (const dir of dataDirs()) {
    try {
      const r = JSON.parse(readFileSync5(statePath(dir, repoRoot2), "utf8"));
      if (!best || r.ts > best.ts) best = r;
    } catch {
    }
  }
  return best;
}
function recordOutcome(repoRoot2, outcome, detail) {
  try {
    const dir = join7(dataDir(), "state");
    mkdirSync3(dir, { recursive: true });
    const path = statePath(dataDir(), repoRoot2);
    const tmp = `${path}.tmp`;
    writeFileSync2(tmp, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), repo: repoRoot2, outcome, detail }));
    renameSync2(tmp, path);
  } catch {
  }
  return outcome;
}
function sync(repoRoot2, home) {
  try {
    if (!hasConfig(repoRoot2)) return "skipped:no-config";
    if (isDisabled(repoRoot2)) return recordOutcome(repoRoot2, "skipped:opt-out");
    let cfg;
    try {
      cfg = loadConfig(repoRoot2);
    } catch (e) {
      return recordOutcome(repoRoot2, "skipped:config-error", e.message);
    }
    const id = resolveIdentity(cfg, home);
    if ("error" in id) return recordOutcome(repoRoot2, "skipped:identity", id.error);
    const lock = acquire(repoRoot2);
    if (!lock) return recordOutcome(repoRoot2, "skipped:locked");
    try {
      const opts = { timezone: cfg.timezone, tsPrecision: cfg.tsPrecision, excludeCommands: cfg.excludeCommands };
      const { runs } = collect(findTranscripts(repoRoot2), discoverSkills(repoRoot2, cfg), opts);
      const { results } = write(runs, {
        repoRoot: repoRoot2,
        cfg,
        machineId8: id.id.machineId8,
        dry: false
      });
      const n = results.reduce((s, r) => s + r.added + r.updated, 0);
      return recordOutcome(repoRoot2, n ? "wrote" : "clean", n ? `${n} \u5B9F\u884C` : void 0);
    } finally {
      lock.release();
    }
  } catch (e) {
    return recordOutcome(repoRoot2, "failed:exception", e.message);
  }
}

// src/cli.ts
var USAGE = `claude-skill-telemetry \u2014 Claude Code \u306E transcript \u304B\u3089\u30B9\u30AD\u30EB\u5B9F\u884C\u3092\u5FA9\u5143\u3057\u3066\u8A18\u9332\u3059\u308B

  skill-telemetry --sync        \u30BB\u30C3\u30B7\u30E7\u30F3\u958B\u59CB\u30D5\u30C3\u30AF\u7528\u3002\u8D70\u67FB\u2192\u66F8\u8FBC\u3092\u4E00\u606F\u306B\u884C\u3046\uFF08\u7121\u8A00\u30FBexit 0\uFF09
  skill-telemetry               \u8D70\u67FB\u3057\u3066\u66F8\u304D\u8FBC\u3080\uFF08\u8A2D\u5B9A\u306E since \u4EE5\u964D\uFF09
  skill-telemetry --dry-run     \u66F8\u304D\u8FBC\u307E\u305A\u3001\u8FFD\u52A0/\u66F4\u65B0\u3055\u308C\u308B\u4EF6\u6570\u3068\u9664\u5916\u5185\u8A33\u3092\u8868\u793A
  skill-telemetry --report      \u30EA\u30DD\u30B8\u30C8\u30EA\u5185\u306E\u5168\u30ED\u30B0\u3092\u96C6\u8A08\u8868\u793A\uFF08transcript \u306F\u8AAD\u307E\u306A\u3044\uFF09
  skill-telemetry --status      \u8A2D\u5B9A\u30FB\u66F8\u304D\u8FBC\u307F\u5148\u30FB\u5BFE\u8C61\u30B9\u30AD\u30EB\u3092\u8868\u793A

  --repo <path>                 \u5BFE\u8C61\u30EA\u30DD\u30B8\u30C8\u30EA\uFF08\u65E2\u5B9A: $CLAUDE_PROJECT_DIR \u307E\u305F\u306F cwd\uFF09
`;
function lastHookLine(root) {
  const last = readOutcome(root);
  return `last hook:   ${last ? `${last.outcome}\uFF08${last.ts}\uFF09${last.detail ?? ""}` : "\u8A18\u9332\u306A\u3057"}`;
}
function repoRoot(argv) {
  const i = argv.indexOf("--repo");
  if (i >= 0 && argv[i + 1]) return resolve2(argv[i + 1]);
  return resolve2(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
}
async function hookInput(timeoutMs = 5e3) {
  if (process.stdin.isTTY) return "tty";
  return new Promise((done) => {
    let buf = "";
    const finish = (v) => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      done(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      buf += c;
    });
    process.stdin.on("end", () => {
      try {
        finish(JSON.parse(buf));
      } catch {
        finish(null);
      }
    });
    process.stdin.on("error", () => finish(null));
  });
}
async function main() {
  const argv = process.argv.slice(2);
  const root = repoRoot(argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  if (argv.includes("--sync")) {
    const input = await hookInput();
    if (input === "tty") {
      process.stderr.write("--sync \u306F\u30BB\u30C3\u30B7\u30E7\u30F3\u958B\u59CB\u30D5\u30C3\u30AF\u5C02\u7528\u3002\u624B\u5143\u3067\u78BA\u304B\u3081\u308B\u306A\u3089 --dry-run \u304B --status \u3092\u4F7F\u3046\n");
      process.exitCode = 1;
      return;
    }
    if (input === null) {
      recordOutcome(root, "skipped:no-hook-input");
      return;
    }
    sync(root);
    return;
  }
  if (!hasConfig(root)) {
    process.stderr.write(`${root} \u306F\u5BFE\u8C61\u5916\uFF08${CONFIG_PATH} \u304C\u7121\u3044\uFF09
`);
    process.exitCode = 1;
    return;
  }
  let cfg;
  try {
    cfg = loadConfig(root);
  } catch (e) {
    const msg = e.message;
    if (argv.includes("--status")) {
      process.stdout.write(
        [`repo:        ${root}`, `config:      ${CONFIG_PATH}\uFF08\u8AAD\u3081\u306A\u3044: ${msg}\uFF09`, `data dir:    ${dataDir()}`, lastHookLine(root), ""].join("\n")
      );
    } else {
      process.stderr.write(`${msg}
`);
    }
    process.exitCode = 1;
    return;
  }
  if (argv.includes("--report")) {
    process.stdout.write(report(root, cfg) + "\n");
    return;
  }
  const id = resolveIdentity(cfg);
  const skills = discoverSkills(root, cfg);
  if (argv.includes("--status")) {
    const shadowed = [...skills].filter((s) => BUILTIN.has(s)).sort();
    process.stdout.write(
      [
        `repo:        ${root}`,
        `config:      ${CONFIG_PATH}${isDisabled(root) ? "\uFF08opt-out \u6709\u52B9\u30FB\u8A18\u9332\u3057\u306A\u3044\uFF09" : ""}`,
        `timezone:    ${cfg.timezone}\uFF08ts \u7C92\u5EA6 ${cfg.tsPrecision}\uFF09`,
        `since:       ${cfg.since}`,
        `writer:      ${"error" in id ? `\u6C7A\u3081\u3089\u308C\u306A\u3044\uFF08${id.error}\uFF09` : id.id.machineId8}`,
        `sync level:  ${cfg.sync.level}`,
        `data dir:    ${dataDir()}`,
        `transcripts: ${findTranscripts(root).length} \u672C`,
        `skills:      ${skills.size} \u7A2E  ${[...skills].sort().join(" ")}`,
        ...shadowed.length ? [`warning:     \u7D44\u307F\u8FBC\u307F\u30B3\u30DE\u30F3\u30C9\u3068\u540C\u540D\u306E\u305F\u3081\u8A18\u9332\u3055\u308C\u306A\u3044: ${shadowed.join(" ")}`] : [],
        lastHookLine(root),
        ""
      ].join("\n")
    );
    return;
  }
  if ("error" in id) {
    process.stderr.write(`\u66F8\u304D\u8FBC\u307F\u5148\u3092\u6C7A\u3081\u3089\u308C\u306A\u3044\u306E\u3067\u4E2D\u6B62\uFF08${id.error}\uFF09
`);
    process.exitCode = 1;
    return;
  }
  if (isDisabled(root)) {
    process.stderr.write("opt-out \u304C\u6709\u52B9\u306A\u306E\u3067\u8A18\u9332\u3057\u306A\u3044\n");
    process.exitCode = 1;
    return;
  }
  const dry = argv.includes("--dry-run");
  const paths = findTranscripts(root);
  const opts = { timezone: cfg.timezone, tsPrecision: cfg.tsPrecision, excludeCommands: cfg.excludeCommands };
  const { runs, dropped } = collect(paths, skills, opts);
  const lock = dry ? null : acquire(root);
  if (!dry && !lock) {
    process.stderr.write("\u4ED6\u306E\u30D7\u30ED\u30BB\u30B9\u304C\u540C\u671F\u4E2D\u306A\u306E\u3067\u4E2D\u6B62\uFF08\u653E\u7F6E\u3055\u308C\u305F\u30ED\u30C3\u30AF\u306F 10 \u5206\u3067\u89E3\u653E\u3055\u308C\u308B\uFF09\n");
    process.exitCode = 1;
    return;
  }
  let results, skipped;
  try {
    ({ results, skipped } = write(runs, { repoRoot: root, cfg, machineId8: id.id.machineId8, dry }));
  } finally {
    lock?.release();
  }
  const out = [];
  out.push(`${dry ? "[dry-run] " : ""}transcript ${paths.length} \u672C \u2192 \u5BFE\u8C61 ${runs.size} \u4EF6\uFF08\u5BFE\u8C61\u5916 ${dropped} \u4EF6\uFF09`);
  out.push(`\u66F8\u304D\u8FBC\u307F\u5148: ${cfg.skillsDir}/<skill>/${cfg.logsSubdir}/${id.id.machineId8}.ndjson`);
  for (const r of results) {
    out.push(`  ${r.skill}  \u8FFD\u52A0 ${r.added} / \u66F4\u65B0 ${r.updated} / \u8A08 ${r.total}`);
  }
  if (skipped) out.push(`  (${skipped} \u4EF6\u306F since ${cfg.since} \u3088\u308A\u524D\u3001\u307E\u305F\u306F\u6642\u523B\u4E0D\u660E)`);
  process.stdout.write(out.join("\n") + "\n");
}
void main();
