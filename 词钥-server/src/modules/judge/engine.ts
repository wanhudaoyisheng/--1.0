/**
 * 判定引擎：纯函数，不依赖数据库、不依赖 HTTP。
 * 这是整个产品的事实层——判定结果只由剧本图谱决定，AI 不得裁断事实。
 * 同样的规则在浏览器离线模式里有一份简化实现，服务端这份是唯一权威。
 */
import { allCards, type ScenarioData } from "../scenarios/types.ts";

export type Verdict = "success" | "double" | "reveal" | "fail" | "blocked" | "worldview";

export interface JudgeResult {
  verdict: Verdict;
  /** 本次成功解锁的卡片 id */
  unlockIds: string[];
  /** 失败原因：没这条链 / 词对了但前置不足 */
  reason?: "no-match" | "requires-unmet";
  /** 前置不足时缺哪些卡（便于给出方向性提示，但不泄露关键词） */
  missingRequires: string[];
}

export interface JudgeContext {
  scenario: ScenarioData;
  unlocked: ReadonlySet<string>;
}

const requiresMet = (ctx: JudgeContext, requires: string[]): boolean =>
  requires.every((id) => ctx.unlocked.has(id));

export function judge(ctx: JudgeContext, keyword: string, target: string): JudgeResult {
  const cards = allCards(ctx.scenario);

  // 命中的、尚未解锁的卡（同关键词 + 同目标可能不止一张 → 双杀）
  const matched = cards.filter(
    (card) =>
      card.lock !== null &&
      card.lock.keyword === keyword &&
      card.lock.target === target &&
      !ctx.unlocked.has(card.id)
  );

  if (matched.length === 0) {
    return { verdict: "fail", unlockIds: [], reason: "no-match", missingRequires: [] };
  }

  const ready = matched.filter((card) => requiresMet(ctx, card.lock!.requires));
  if (ready.length === 0) {
    const missing = new Set<string>();
    for (const card of matched) {
      for (const req of card.lock!.requires) {
        if (!ctx.unlocked.has(req)) missing.add(req);
      }
    }
    const missingRequires = [...missing];
    const lacksWorld = missingRequires.some((id) => id.startsWith("w"));
    return {
      verdict: lacksWorld ? "worldview" : "blocked",
      unlockIds: [],
      reason: "requires-unmet",
      missingRequires
    };
  }

  return {
    verdict: ready.length >= 2 ? "double" : "success",
    unlockIds: ready.map((card) => card.id),
    missingRequires: []
  };
}

/** 当前可以立刻推进的锁卡（供「下一步建议」与提示选择使用） */
export function readyCards(ctx: JudgeContext) {
  return allCards(ctx.scenario).filter(
    (card) =>
      card.lock !== null &&
      !ctx.unlocked.has(card.id) &&
      requiresMet(ctx, card.lock.requires)
  );
}

/** 开局卡：剧本里 lock 为 null 的信息卡，入局即解锁 */
export function openingCards(scenario: ScenarioData) {
  return scenario.infoCards.filter((card) => card.lock === null);
}

export function cardKind(id: string): "world" | "info" {
  return id.startsWith("w") ? "world" : "info";
}
