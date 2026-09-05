import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, defaults, hasConfig, isDisabled, validate } from "../src/config.js";
import { resolveIdentity } from "../src/identity.js";
import { acquire } from "../src/lock.js";
import { discoverSkills, listLogFiles, logPath } from "../src/skills.js";
import { findTranscripts, repoSlug } from "../src/transcript.js";

/** since は必須キーなので、他の検証を試すには常に足す必要がある。 */
const MIN = { since: "1970-01-01" };

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function skill(root: string, name: string, withLogs = false): void {
  mkdirSync(join(root, ".claude/skills", name), { recursive: true });
  writeFileSync(join(root, ".claude/skills", name, "SKILL.md"), `---\nname: ${name}\n---\n`);
  if (withLogs) {
    mkdirSync(join(root, ".claude/skills", name, "logs"), { recursive: true });
    writeFileSync(join(root, ".claude/skills", name, "logs", "a1b2c3d4.ndjson"), "");
  }
}

describe("設定", () => {
  it("設定ファイルが無いリポジトリは対象外", () => {
    expect(hasConfig(tmp("cst-cfg-"))).toBe(false);
  });

  it("since だけの設定は残りが既定値になる", () => {
    expect(validate(MIN)).toEqual(defaults());
  });

  it("since が無ければ拒否する", () => {
    expect(() => validate({})).toThrow(ConfigError);
  });

  it("YYYY-MM-DD でない since を拒否する", () => {
    expect(() => validate({ since: "2026-9-5" })).toThrow(ConfigError);
    expect(() => validate({ since: "2026-13-01" })).toThrow(ConfigError);
  });

  it("未知のキーは無視する", () => {
    // JSON にコメントが書けないので、_comment でファイル自身に存在理由を書ける必要がある。
    expect(validate({ ...MIN, _comment: "計測対象にする opt-in スイッチ" })).toEqual(defaults());
  });

  it("リポジトリ外を指す skillsDir を拒否する", () => {
    expect(() => validate({ ...MIN, skillsDir: "/etc" })).toThrow(ConfigError);
    expect(() => validate({ ...MIN, skillsDir: "../../elsewhere" })).toThrow(ConfigError);
  });

  it("解決できないタイムゾーンを拒否する", () => {
    expect(() => validate({ ...MIN, timezone: "Mars/Olympus" })).toThrow(ConfigError);
  });

  it("未実装の sync レベルを黙って無視せず落とす", () => {
    expect(() => validate({ ...MIN, sync: { level: "pr" } })).toThrow(ConfigError);
  });

  it("opt-out マーカーと環境変数のどちらでも降りられる", () => {
    const d = tmp("cst-opt-");
    mkdirSync(join(d, ".claude"), { recursive: true });
    expect(isDisabled(d)).toBe(false);
    writeFileSync(join(d, ".claude/no-skill-log"), "");
    expect(isDisabled(d)).toBe(true);
  });
});

describe("スキルの探索", () => {
  it("SKILL.md を持つディレクトリだけを対象にする", () => {
    const d = tmp("cst-skills-");
    skill(d, "handoff");
    skill(d, "grilling", true);
    mkdirSync(join(d, ".claude/skills/not-a-skill"), { recursive: true });
    expect([...discoverSkills(d, defaults())].sort()).toEqual(["grilling", "handoff"]);
  });

  it("個人スキルも記録対象に含める（共有境界は gitignore が引く）", () => {
    const d = tmp("cst-skills-");
    skill(d, "_personal");
    expect([...discoverSkills(d, defaults())]).toEqual(["_personal"]);
  });

  it("ログのファイル名は書き手の machineID だけで決まる", () => {
    const d = tmp("cst-skills-");
    expect(logPath(d, defaults(), "handoff", "a1b2c3d4")).toBe(
      join(d, ".claude/skills/handoff/logs/a1b2c3d4.ndjson"),
    );
  });

  it("ログファイルの一覧からスキルと書き手を復元できる", () => {
    const d = tmp("cst-skills-");
    skill(d, "grilling", true);
    expect(listLogFiles(d, defaults())).toEqual([
      {
        skill: "grilling",
        machineId: "a1b2c3d4",
        path: join(d, ".claude/skills/grilling/logs/a1b2c3d4.ndjson"),
      },
    ]);
  });

  it("設定で machineId を明示した書き手のログも一覧に出る", () => {
    // 16進 8 桁を前提にすると identity.machineId を明示した書き手が --report から消える。
    const d = tmp("cst-skills-");
    skill(d, "handoff");
    mkdirSync(join(d, ".claude/skills/handoff/logs"), { recursive: true });
    writeFileSync(join(d, ".claude/skills/handoff/logs/ci-runner.ndjson"), "");
    expect(listLogFiles(d, defaults()).map((f) => f.machineId)).toEqual(["ci-runner"]);
  });
});

describe("transcript の絞り込み", () => {
  it("英数字以外を潰した slug でディレクトリ名が決まる", () => {
    expect(repoSlug("/Users/x/work/my-repo")).toBe("-Users-x-work-my-repo");
  });

  it("サブディレクトリ起動のセッションも拾い、兄弟リポジトリは cwd で弾く", () => {
    const home = tmp("cst-home-");
    const repo = tmp("cst-repo-");
    const slug = repoSlug(repo);
    // 先頭には cwd を持たないメタレコードが並ぶ。ここを読み飛ばさないと 1 本も拾えない。
    const put = (dir: string, name: string, cwd: string): void => {
      mkdirSync(join(home, dir), { recursive: true });
      writeFileSync(
        join(home, dir, name),
        [
          JSON.stringify({ type: "last-prompt", prompt: "x" }),
          JSON.stringify({ type: "mode", mode: "default" }),
          JSON.stringify({ type: "user", cwd, message: { content: "hi" } }),
          "",
        ].join("\n"),
      );
    };
    put(slug, "root.jsonl", repo);
    put(`${slug}-src-sub`, "sub.jsonl", join(repo, "src/sub"));
    put(`${slug}-sibling`, "other.jsonl", `${repo}-sibling`);

    const found = findTranscripts(repo, home).map((p) => p.split("/").pop());
    expect(found.sort()).toEqual(["root.jsonl", "sub.jsonl"]);
  });
});

describe("同時起動ロック", () => {
  it("2 本目は取れない", () => {
    process.env.CLAUDE_PLUGIN_DATA = tmp("cst-lock-");
    const first = acquire("/repo/a");
    expect(first).not.toBeNull();
    expect(acquire("/repo/a")).toBeNull();
    first?.release();
    expect(acquire("/repo/a")).not.toBeNull();
    delete process.env.CLAUDE_PLUGIN_DATA;
  });

  it("リポジトリが違えば競合しない", () => {
    process.env.CLAUDE_PLUGIN_DATA = tmp("cst-lock-");
    expect(acquire("/repo/a")).not.toBeNull();
    expect(acquire("/repo/b")).not.toBeNull();
    delete process.env.CLAUDE_PLUGIN_DATA;
  });

  it("放置されたロックは 10 分で奪う", () => {
    process.env.CLAUDE_PLUGIN_DATA = tmp("cst-lock-");
    acquire("/repo/a");
    expect(acquire("/repo/a", Date.now() + 11 * 60 * 1000)).not.toBeNull();
    delete process.env.CLAUDE_PLUGIN_DATA;
  });
});

describe("書き込み先の身元", () => {
  it("machineID が無ければ書かない", () => {
    const home = tmp("cst-id-");
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "a@b.c" } }));
    expect(resolveIdentity(defaults(), home)).toHaveProperty("error");
  });

  it("machineID の先頭 8 桁だけを使う", () => {
    const home = tmp("cst-id-");
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ machineID: "a1b2c3d4e5f6" }));
    expect(resolveIdentity(defaults(), home)).toEqual({ id: { machineId8: "a1b2c3d4" } });
  });

  it("requireOrg を設定したら組織が一致しない限り書かない", () => {
    const home = tmp("cst-id-");
    const cfg = defaults();
    cfg.identity.requireOrg = "example-org";
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ machineID: "a1b2c3d4e5f6", oauthAccount: { emailAddress: "a@b.c", organizationName: "other" } }),
    );
    expect(resolveIdentity(cfg, home)).toHaveProperty("error");
  });
});
