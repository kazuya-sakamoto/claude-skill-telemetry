import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.js";

export interface Identity {
  machineId8: string;
}

/**
 * 書き込み先ファイル名になる machineID 先頭8桁を返す。取れなければ書かない（fail closed）。
 * email は使わない —— 帰属は git のコミット author が既に持っており、ログ自体は
 * 名寄せに git を引くという明示的な行為を要する擬似匿名のままにしておく。
 */
export function resolveIdentity(cfg: Config, home = homedir()): { id: Identity } | { error: string } {
  if (cfg.identity.machineId) {
    return { id: { machineId8: cfg.identity.machineId.slice(0, 8) } };
  }
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return { error: "~/.claude.json を読めない" };
  }
  const acc = (d.oauthAccount ?? {}) as Record<string, unknown>;
  const want = cfg.identity.requireOrg;
  if (want) {
    const org = acc.organizationName;
    if (!acc.emailAddress) return { error: "oauthAccount.emailAddress が無い（未ログイン / APIキー認証）" };
    if (org !== want) return { error: `組織が ${JSON.stringify(org)}（期待: ${JSON.stringify(want)}）` };
  }
  const mach = d.machineID;
  if (typeof mach !== "string" || !mach) {
    return { error: "machineID が無い（CLI の内部状態なのでキー名が変わった可能性）" };
  }
  return { id: { machineId8: mach.slice(0, 8) } };
}
