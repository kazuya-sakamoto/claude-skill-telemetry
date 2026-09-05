import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { TranscriptRecord } from "./schema.js";

export function projectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/** Claude Code が transcript を置くディレクトリ名の作り方（英数字以外を `-` に潰す）。 */
export function repoSlug(repoRoot: string): string {
  return repoRoot.replace(/[^A-Za-z0-9]/g, "-");
}

function under(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * transcript の cwd を見る。slug の前方一致だけでは兄弟リポジトリ（repo-foo）を巻き込む。
 * 先頭には cwd を持たないメタレコード（last-prompt / mode / permission-mode）が並ぶので、
 * 最初の 1 行だけを見ると常に false になる。
 */
function startedIn(path: string, repoRoot: string): boolean {
  let head: string;
  try {
    head = readFileSync(path, "utf8").slice(0, 256 * 1024);
  } catch {
    return false;
  }
  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    let cwd: unknown;
    try {
      cwd = (JSON.parse(line) as TranscriptRecord).cwd;
    } catch {
      continue;
    }
    if (typeof cwd === "string") return under(cwd, repoRoot);
  }
  return false;
}

/**
 * repo 配下で開始されたセッションの transcript を集める。
 * repo root ちょうどの slug だけを見るとサブディレクトリ起動のセッションを丸ごと落とす（R4）。
 */
export function findTranscripts(repoRoot: string, root = projectsDir()): string[] {
  if (!existsSync(root)) return [];
  const slug = repoSlug(resolve(repoRoot));
  const out: string[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith(slug)) continue;
    for (const f of readdirSync(join(root, dir.name))) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(root, dir.name, f);
      if (startedIn(p, repoRoot)) out.push(p);
    }
  }
  return out.sort();
}

/** 壊れた行は捨てる。1 行の破損で transcript 1 本ぶんの実行を落とさない。 */
export function* readRecords(path: string): Generator<TranscriptRecord> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      yield JSON.parse(s) as TranscriptRecord;
    } catch {
      continue;
    }
  }
}
