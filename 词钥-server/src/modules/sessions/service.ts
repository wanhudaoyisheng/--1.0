/**
 * 对局服务层：承载业务编排，不碰 HTTP 对象。
 * 关键安全边界：对外 DTO 只包含「已解锁」的卡片全文，
 * 关键词、前置条件、提示原文、结局文本一律不下发。
 */
import type { Db } from "../../db/index.ts";
import { nowIso, withTransaction } from "../../db/index.ts";
import { newId } from "../../core/ids.ts";
import { conflict, notFound } from "../../core/errors.ts";
import { cardKind, judge, openingCards, readyCards, type JudgeContext } from "../judge/engine.ts";
import { buildReaction, milestoneText, type UnlockDesc } from "../guide/templates.ts";
import { getScenario, latestScenario, type ScenarioRecord } from "../scenarios/repo.ts";
import type { Milestone, ScenarioData } from "../scenarios/types.ts";
import * as repo from "./repo.ts";
import type { SessionRow } from "./repo.ts";

/* ---------------- 对外 DTO ---------------- */

export interface BoardDTO {
  sessionId: string;
  scenario: { id: string; title: string; intro: string };
  characters: Array<{
    id: string;
    name: string;
    profile: string;
    avatar: string;
    revealed: boolean;
  }>;
  infoCards: Array<{ id: string; char: string; text: string }>;
  worldCards: Array<{ id: string; title: string; text: string }>;
  milestones: Array<{ id: string; name: string; desc: string; got: boolean }>;
  progress: { unlocked: number; total: number; info: number; world: number };
  /** 还有悬而未决线索的「指向」；只给目标与条数，不给关键词 */
  readyTargets: Array<{ target: string; count: number }>;
  stats: { submitCount: number; hintCount: number };
  ended: boolean;
  ending?: { text: string; bonusHit: number; bonusTotal: number };
}

export interface UnlockedDTO {
  id: string;
  kind: "info" | "world";
  title: string;
  text: string;
  charName: string | null;
}

export interface AttemptResponse {
  verdict: string;
  reason?: string;
  reaction: string;
  unlocked: UnlockedDTO[];
  newCharacters: string[];
  milestones: Array<{ id: string; name: string; desc: string }>;
  ended: boolean;
  board: BoardDTO;
}

export interface HintResponse {
  cardId: string;
  level: number;
  totalLevels: number;
  text: string;
}

/* ---------------- 内部工具 ---------------- */

function loadSession(db: Db, sessionId: string): SessionRow {
  const session = repo.getSession(db, sessionId);
  if (!session) throw notFound("对局不存在或已过期");
  return session;
}

function scenarioOf(db: Db, session: SessionRow): ScenarioRecord {
  return getScenario(db, session.scenario_id, Number(session.scenario_version));
}

/** 人物是否已现身：由「是否已解锁该人物的任意一条信息」推导，不信任剧本里的静态标记 */
function revealedCharIds(scenario: ScenarioData, unlocked: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>();
  for (const card of scenario.infoCards) {
    if (unlocked.has(card.id)) ids.add(card.char);
  }
  return ids;
}

function buildBoard(db: Db, session: SessionRow, scenarioRecord: ScenarioRecord): BoardDTO {
  const scenario = scenarioRecord.data;
  const unlocked = new Set(repo.listUnlockIds(db, session.id));
  const revealed = revealedCharIds(scenario, unlocked);

  const infoCards = scenario.infoCards
    .filter((c) => unlocked.has(c.id))
    .map((c) => ({ id: c.id, char: c.char, text: c.text }));

  const worldCards = scenario.worldCards
    .filter((c) => unlocked.has(c.id))
    .map((c) => ({ id: c.id, title: c.title, text: c.text }));

  // 未达成的里程碑不公开名称：名字本身就是剧透（例如「守门人之秘」）
  const milestones = scenario.milestones.map((m) => {
    const got = m.requires.every((r) => unlocked.has(r));
    return got
      ? { id: m.id, name: m.name, desc: m.desc, got: true }
      : { id: m.id, name: "？？？", desc: "尚未达成", got: false };
  });

  const ready = readyCards({ scenario, unlocked });
  const readyCounts = new Map<string, number>();
  for (const card of ready) {
    const target = card.lock!.target;
    readyCounts.set(target, (readyCounts.get(target) ?? 0) + 1);
  }

  const total = scenario.infoCards.length + scenario.worldCards.length;
  const ended = session.ended_at !== null;
  const bonus = scenario.ending.bonus ?? [];
  const bonusHit = bonus.filter((id) => unlocked.has(id)).length;

  const board: BoardDTO = {
    sessionId: session.id,
    scenario: { id: scenarioRecord.id, title: scenario.title, intro: scenario.intro },
    characters: scenario.characters.map((c) => {
      const isRevealed = revealed.has(c.id);
      return isRevealed
        ? { id: c.id, name: c.name, profile: c.profile, avatar: c.avatar, revealed: true }
        : { id: c.id, name: "？？？", profile: "尚未登场", avatar: "？", revealed: false };
    }),
    infoCards,
    worldCards,
    milestones,
    progress: {
      unlocked: infoCards.length + worldCards.length,
      total,
      info: infoCards.length,
      world: worldCards.length
    },
    readyTargets: [...readyCounts].map(([target, count]) => ({ target, count })),
    stats: { submitCount: Number(session.submit_count), hintCount: Number(session.hint_count) },
    ended
  };

  if (ended) {
    board.ending = { text: scenario.ending.text, bonusHit, bonusTotal: bonus.length };
  }
  return board;
}

function describeUnlocks(scenario: ScenarioData, ids: string[]): UnlockedDTO[] {
  return ids.map((id) => {
    const world = scenario.worldCards.find((c) => c.id === id);
    if (world) {
      return { id, kind: "world" as const, title: world.title, text: world.text, charName: null };
    }
    const info = scenario.infoCards.find((c) => c.id === id)!;
    const char = scenario.characters.find((c) => c.id === info.char);
    return {
      id,
      kind: "info" as const,
      title: char?.name ?? "？？？",
      text: info.text,
      charName: char?.name ?? null
    };
  });
}

/* ---------------- 对外用例 ---------------- */

export function createSession(db: Db, scenarioId?: string): { sessionId: string; board: BoardDTO } {
  const record = latestScenario(db, scenarioId);
  const id = newId("s");
  const at = nowIso();

  withTransaction(db, () => {
    repo.insertSession(db, id, record.id, record.version, at);
    // 开局卡：剧本里 lock 为 null 的信息卡
    for (const card of openingCards(record.data)) {
      repo.addUnlock(db, id, card.id, "info", at);
    }
  });

  const session = loadSession(db, id);
  return { sessionId: id, board: buildBoard(db, session, record) };
}

export function getBoard(db: Db, sessionId: string): BoardDTO {
  const session = loadSession(db, sessionId);
  return buildBoard(db, session, scenarioOf(db, session));
}

export function submitAttempt(
  db: Db,
  sessionId: string,
  keyword: string,
  target: string
): AttemptResponse {
  const session = loadSession(db, sessionId);
  if (session.ended_at !== null) {
    throw conflict("SESSION_ENDED", "这一局已经结束，去回放里看看你的探索轨迹吧");
  }

  const record = scenarioOf(db, session);
  const scenario = record.data;
  const beforeUnlocked = new Set(repo.listUnlockIds(db, session.id));

  const ctx: JudgeContext = { scenario, unlocked: beforeUnlocked };
  const result = judge(ctx, keyword, target);

  const at = nowIso();
  const hitMilestones: Milestone[] = [];
  let ended = false;

  withTransaction(db, () => {
    const round = repo.nextRound(db, session.id);
    repo.insertAttempt(
      db,
      session.id,
      round,
      keyword,
      target,
      result.verdict,
      result.unlockIds.join(",") || result.reason || null,
      at
    );
    repo.bumpSubmit(db, session.id);

    if (result.unlockIds.length > 0) {
      for (const id of result.unlockIds) {
        repo.addUnlock(db, session.id, id, cardKind(id), at);
      }
      const after = new Set([...beforeUnlocked, ...result.unlockIds]);
      for (const m of scenario.milestones) {
        if (m.requires.every((r) => after.has(r))) {
          const already = repo.listMilestones(db, session.id).includes(m.id);
          if (!already) {
            repo.addMilestone(db, session.id, m.id, at);
            hitMilestones.push(m);
          }
        }
      }
      if (scenario.ending.required.every((r) => after.has(r))) {
        repo.endSession(db, session.id, at);
        ended = true;
      }
    }
    repo.touchSession(db, session.id, at);
  });

  const refreshed = loadSession(db, session.id);
  const afterUnlocked = new Set(repo.listUnlockIds(db, session.id));
  const beforeRevealed = revealedCharIds(scenario, beforeUnlocked);
  const afterRevealed = revealedCharIds(scenario, afterUnlocked);
  const newCharacters = [...afterRevealed]
    .filter((id) => !beforeRevealed.has(id))
    .map((id) => scenario.characters.find((c) => c.id === id)?.name ?? "？？？");

  const unlocked = describeUnlocks(scenario, result.unlockIds);
  const targetName =
    target === "world"
      ? "世界观"
      : scenario.characters.find((c) => c.id === target)?.name ?? "？？？";

  const verdict = newCharacters.length > 0 && result.unlockIds.length > 0 ? "reveal" : result.verdict;

  const unlockDescs: UnlockDesc[] = unlocked.map((u) =>
    u.kind === "world"
      ? { type: "world", title: u.title }
      : { type: "info", charName: u.charName ?? "？？？" }
  );

  const reaction = buildReaction({
    verdict: verdict as never,
    targetName,
    unlocked: unlockDescs,
    newCharNames: newCharacters
  });

  return {
    verdict,
    ...(result.reason ? { reason: result.reason } : {}),
    reaction,
    unlocked,
    newCharacters,
    milestones: hitMilestones.map((m) => ({ id: m.id, name: m.name, desc: m.desc })),
    ended,
    board: buildBoard(db, refreshed, record)
  };
}

export function requestHint(db: Db, sessionId: string, cardId?: string): HintResponse {
  const session = loadSession(db, sessionId);
  if (session.ended_at !== null) {
    throw conflict("SESSION_ENDED", "这一局已经结束，不需要提示了");
  }

  const record = scenarioOf(db, session);
  const scenario = record.data;
  const unlocked = new Set(repo.listUnlockIds(db, session.id));
  const ctx: JudgeContext = { scenario, unlocked };

  const lockedCards = [...scenario.infoCards, ...scenario.worldCards].filter(
    (c) => c.lock !== null && !unlocked.has(c.id)
  );
  if (lockedCards.length === 0) {
    throw conflict("NO_LOCK_LEFT", "线索都揭开了，没有需要提示的地方");
  }

  let candidate = cardId ? lockedCards.find((c) => c.id === cardId) : undefined;
  if (!candidate) {
    candidate = readyCards(ctx)[0] ?? lockedCards[0]!;
  }

  const hints = candidate.lock!.hints;
  const level = repo.getHintLevel(db, session.id, candidate.id);
  const tier = Math.min(level, hints.length - 1);
  const text = hints[tier] ?? hints[0] ?? "回到已解锁人物的原话里，注意那些不起眼的字。";

  const at = nowIso();
  withTransaction(db, () => {
    repo.setHintLevel(db, session.id, candidate!.id, level + 1);
    repo.bumpHint(db, session.id);
    repo.touchSession(db, session.id, at);
  });

  return { cardId: candidate.id, level: tier + 1, totalLevels: hints.length, text };
}

export function getReplay(db: Db, sessionId: string) {
  const session = loadSession(db, sessionId);
  const record = scenarioOf(db, session);
  const attempts = repo.listAttempts(db, session.id).map((a) => ({
    round: Number(a.round),
    keyword: a.keyword,
    target: a.target,
    targetName:
      a.target === "world"
        ? "世界观"
        : record.data.characters.find((c) => c.id === a.target)?.name ?? a.target,
    verdict: a.verdict,
    detail: a.detail,
    at: a.created_at
  }));

  return {
    sessionId: session.id,
    scenario: { id: record.id, title: record.title },
    startedAt: session.created_at,
    endedAt: session.ended_at,
    stats: { submitCount: Number(session.submit_count), hintCount: Number(session.hint_count) },
    milestones: repo.listMilestones(db, session.id),
    attempts
  };
}

export function milestoneToast(m: Milestone): string {
  return milestoneText(m);
}
