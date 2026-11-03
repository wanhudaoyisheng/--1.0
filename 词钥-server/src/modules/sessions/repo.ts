/**
 * 对局仓储：只做数据存取，不含业务判断。
 * 所有写入都要求传入 db，便于在 service 层用事务包住多步操作。
 */
import type { Db } from "../../db/index.ts";

export interface SessionRow {
  id: string;
  scenario_id: string;
  scenario_version: number;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  submit_count: number;
  hint_count: number;
}

export interface AttemptRow {
  round: number;
  keyword: string;
  target: string;
  verdict: string;
  detail: string | null;
  created_at: string;
}

export function insertSession(
  db: Db,
  id: string,
  scenarioId: string,
  scenarioVersion: number,
  at: string
): void {
  db.prepare(
    `INSERT INTO sessions (id, scenario_id, scenario_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, scenarioId, scenarioVersion, at, at);
}

export function getSession(db: Db, id: string): SessionRow | undefined {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as unknown as
    | SessionRow
    | undefined;
}

export function touchSession(db: Db, id: string, at: string): void {
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(at, id);
}

export function endSession(db: Db, id: string, at: string): void {
  db.prepare("UPDATE sessions SET ended_at = ?, updated_at = ? WHERE id = ?").run(at, at, id);
}

export function bumpSubmit(db: Db, id: string): void {
  db.prepare("UPDATE sessions SET submit_count = submit_count + 1 WHERE id = ?").run(id);
}

export function bumpHint(db: Db, id: string): void {
  db.prepare("UPDATE sessions SET hint_count = hint_count + 1 WHERE id = ?").run(id);
}

export function listUnlockIds(db: Db, sessionId: string): string[] {
  const rows = db
    .prepare("SELECT card_id FROM unlocks WHERE session_id = ? ORDER BY unlocked_at")
    .all(sessionId) as unknown as Array<{ card_id: string }>;
  return rows.map((r) => r.card_id);
}

export function addUnlock(db: Db, sessionId: string, cardId: string, kind: string, at: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO unlocks (session_id, card_id, kind, unlocked_at) VALUES (?, ?, ?, ?)"
  ).run(sessionId, cardId, kind, at);
}

export function nextRound(db: Db, sessionId: string): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(round), 0) AS r FROM attempts WHERE session_id = ?")
    .get(sessionId) as { r?: number } | undefined;
  return Number(row?.r ?? 0) + 1;
}

export function insertAttempt(
  db: Db,
  sessionId: string,
  round: number,
  keyword: string,
  target: string,
  verdict: string,
  detail: string | null,
  at: string
): void {
  db.prepare(
    `INSERT INTO attempts (session_id, round, keyword, target, verdict, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sessionId, round, keyword, target, verdict, detail, at);
}

export function listAttempts(db: Db, sessionId: string): AttemptRow[] {
  return db
    .prepare(
      `SELECT round, keyword, target, verdict, detail, created_at
         FROM attempts WHERE session_id = ? ORDER BY round ASC`
    )
    .all(sessionId) as unknown as AttemptRow[];
}

export function getHintLevel(db: Db, sessionId: string, cardId: string): number {
  const row = db
    .prepare("SELECT level FROM hint_uses WHERE session_id = ? AND card_id = ?")
    .get(sessionId, cardId) as { level?: number } | undefined;
  return Number(row?.level ?? 0);
}

export function setHintLevel(db: Db, sessionId: string, cardId: string, level: number): void {
  db.prepare(
    `INSERT INTO hint_uses (session_id, card_id, level) VALUES (?, ?, ?)
     ON CONFLICT(session_id, card_id) DO UPDATE SET level = excluded.level`
  ).run(sessionId, cardId, level);
}

export function listMilestones(db: Db, sessionId: string): string[] {
  const rows = db
    .prepare("SELECT milestone_id FROM milestones_hit WHERE session_id = ?")
    .all(sessionId) as unknown as Array<{ milestone_id: string }>;
  return rows.map((r) => r.milestone_id);
}

export function addMilestone(db: Db, sessionId: string, milestoneId: string, at: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO milestones_hit (session_id, milestone_id, hit_at) VALUES (?, ?, ?)"
  ).run(sessionId, milestoneId, at);
}
