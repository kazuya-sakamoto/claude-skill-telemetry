/** Claude Code transcript の 1 行。読む側の契約で、生成元は Claude Code 本体。 */
export interface TranscriptRecord {
  type?: string;
  message?: Message | null;
  timestamp?: string;
  version?: string;
  requestId?: string;
  interruptedMessageId?: string;
  cwd?: string;
}

export interface Message {
  content?: string | unknown[];
  usage?: Usage | null;
  model?: string;
}

export interface Block {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number } | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
}

/** LogRecord.ts の粒度。day は集計に足り、second はデバッグ向き。 */
export type TsPrecision = "day" | "second";

/** ログ 1 行の形。導出方法（scan.ts）とは独立に、読み手・書き手が共有する契約。 */
export interface LogRecord {
  run_id: string;
  ts: string | null;
  skill: string;
  skill_rev: string | null;
  model: string | null;
  cli: string | null;
  invoked_by: "slash" | "auto";
  result: "interrupted" | null;
  turns: number;
  duration_s: number | null;
  ctx0: number;
  tok_in: number;
  tok_out: number;
  tok_thinking: number;
  tok_cache_read: number;
  tok_cache_write_5m: number;
  tok_cache_write_1h: number;
  cost_units: number;
  own_units: number;
  sub_spawned: number;
  source: "retro";
}
