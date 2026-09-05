import { describe, expect, it } from "vitest";
import { accessSync, constants, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8")) as Record<string, unknown>;
}

describe("プラグインの配線", () => {
  it("hooks.json はイベントを hooks キーの下に包む", () => {
    // 包まずに直接 SessionStart を置くと、`claude plugin validate` は通るのに
    // フックは一度も発火しない。壊れても誰も気づけないので、ここで固定する。
    const h = json("hooks/hooks.json");
    expect(Object.keys(h)).toEqual(["hooks"]);
    expect(h.hooks).toHaveProperty("SessionStart");
  });

  it("SessionStart は起動と再開で発火し、セッション開始を待たせない", () => {
    const [entry] = (json("hooks/hooks.json").hooks as { SessionStart: Record<string, unknown>[] }).SessionStart;
    expect(entry?.matcher).toBe("startup|resume");
    const [hook] = entry?.hooks as Record<string, unknown>[];
    expect(hook?.async).toBe(true);
    expect(hook?.command).toContain("${CLAUDE_PLUGIN_ROOT}/bin/run");
  });

  it("plugin.json と marketplace.json の名前が一致する", () => {
    const p = json(".claude-plugin/plugin.json");
    const m = json(".claude-plugin/marketplace.json");
    const entries = m.plugins as { name: string }[];
    expect(entries.map((e) => e.name)).toContain(p.name);
  });

  it("bin/run に実行権限がある", () => {
    expect(() => accessSync(join(ROOT, "bin/run"), constants.X_OK)).not.toThrow();
  });

  it("dist は node も bun も無い環境で黙って諦める", () => {
    expect(readFileSync(join(ROOT, "bin/run"), "utf8")).toContain("exit 0");
  });
});
