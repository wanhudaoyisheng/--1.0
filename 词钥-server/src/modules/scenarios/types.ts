/**
 * 剧本知识库结构定义与校验（对应 PRD FR-12）。
 * 剧本不合规一律拒绝入库，并指出出错字段路径。
 */

export interface Lock {
  keyword: string;
  /** 目标人物 id，或 "world" 表示指向世界观 */
  target: string;
  /** 前置卡 id 列表，全部解锁后才能开这张卡 */
  requires: string[];
  /** 三级递进提示 */
  hints: string[];
}

export interface InfoCard {
  id: string;
  char: string;
  text: string;
  lock: Lock | null;
}

export interface WorldCard {
  id: string;
  title: string;
  text: string;
  lock: Lock;
}

export interface Character {
  id: string;
  name: string;
  profile: string;
  avatar: string;
  revealed: boolean;
}

export interface Milestone {
  id: string;
  name: string;
  desc: string;
  requires: string[];
}

export interface Ending {
  required: string[];
  bonus?: string[];
  text: string;
}

export interface ScenarioData {
  scenario_id: string;
  title: string;
  intro: string;
  characters: Character[];
  worldCards: WorldCard[];
  infoCards: InfoCard[];
  milestones: Milestone[];
  ending: Ending;
}

class ScenarioError extends Error {}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

function need(obj: Record<string, unknown>, key: string, path: string): unknown {
  if (!(key in obj)) throw new ScenarioError(`缺少字段 ${path}.${key}`);
  return obj[key];
}

function needStr(obj: Record<string, unknown>, key: string, path: string): string {
  const v = need(obj, key, path);
  if (!isStr(v)) throw new ScenarioError(`${path}.${key} 必须是非空字符串`);
  return v;
}

function needStrArr(obj: Record<string, unknown>, key: string, path: string): string[] {
  const v = need(obj, key, path);
  if (!isArr(v) || !v.every(isStr)) throw new ScenarioError(`${path}.${key} 必须是非空字符串数组`);
  return v as string[];
}

function parseLock(raw: unknown, path: string): Lock {
  if (typeof raw !== "object" || raw === null) throw new ScenarioError(`${path} 必须是对象`);
  const obj = raw as Record<string, unknown>;
  return {
    keyword: needStr(obj, "keyword", path),
    target: needStr(obj, "target", path),
    requires: needStrArr(obj, "requires", path),
    hints: needStrArr(obj, "hints", path)
  };
}

export function parseScenario(input: unknown): ScenarioData {
  if (typeof input !== "object" || input === null) throw new ScenarioError("剧本必须是对象");
  const raw = input as Record<string, unknown>;

  const scenarioId = needStr(raw, "scenario_id", "scenario");
  const title = needStr(raw, "title", "scenario");
  const intro = needStr(raw, "intro", "scenario");

  if (!isArr(raw.characters)) throw new ScenarioError("scenario.characters 必须是数组");
  if (!isArr(raw.infoCards)) throw new ScenarioError("scenario.infoCards 必须是数组");
  if (!isArr(raw.worldCards)) throw new ScenarioError("scenario.worldCards 必须是数组");
  if (!isArr(raw.milestones)) throw new ScenarioError("scenario.milestones 必须是数组");

  const characters: Character[] = raw.characters.map((c, i) => {
    const path = `scenario.characters[${i}]`;
    if (typeof c !== "object" || c === null) throw new ScenarioError(`${path} 必须是对象`);
    const o = c as Record<string, unknown>;
    const revealed = o.revealed;
    if (typeof revealed !== "boolean") throw new ScenarioError(`${path}.revealed 必须是布尔值`);
    return {
      id: needStr(o, "id", path),
      name: needStr(o, "name", path),
      profile: needStr(o, "profile", path),
      avatar: typeof o.avatar === "string" ? o.avatar : "？",
      revealed
    };
  });

  const infoCards: InfoCard[] = raw.infoCards.map((c, i) => {
    const path = `scenario.infoCards[${i}]`;
    if (typeof c !== "object" || c === null) throw new ScenarioError(`${path} 必须是对象`);
    const o = c as Record<string, unknown>;
    const lockRaw = o.lock;
    return {
      id: needStr(o, "id", path),
      char: needStr(o, "char", path),
      text: needStr(o, "text", path),
      lock: lockRaw === null || lockRaw === undefined ? null : parseLock(lockRaw, `${path}.lock`)
    };
  });

  const worldCards: WorldCard[] = raw.worldCards.map((c, i) => {
    const path = `scenario.worldCards[${i}]`;
    if (typeof c !== "object" || c === null) throw new ScenarioError(`${path} 必须是对象`);
    const o = c as Record<string, unknown>;
    return {
      id: needStr(o, "id", path),
      title: needStr(o, "title", path),
      text: needStr(o, "text", path),
      lock: parseLock(o.lock, `${path}.lock`)
    };
  });

  const milestones: Milestone[] = raw.milestones.map((m, i) => {
    const path = `scenario.milestones[${i}]`;
    if (typeof m !== "object" || m === null) throw new ScenarioError(`${path} 必须是对象`);
    const o = m as Record<string, unknown>;
    return {
      id: needStr(o, "id", path),
      name: needStr(o, "name", path),
      desc: needStr(o, "desc", path),
      requires: needStrArr(o, "requires", path)
    };
  });

  const endingRaw = need(raw, "ending", "scenario");
  if (typeof endingRaw !== "object" || endingRaw === null) {
    throw new ScenarioError("scenario.ending 必须是对象");
  }
  const endingObj = endingRaw as Record<string, unknown>;
  const ending: Ending = {
    required: needStrArr(endingObj, "required", "scenario.ending"),
    text: needStr(endingObj, "text", "scenario.ending"),
    ...(isArr(endingObj.bonus)
      ? { bonus: (endingObj.bonus as unknown[]).filter(isStr) as string[] }
      : {})
  };

  const scenario: ScenarioData = {
    scenario_id: scenarioId,
    title,
    intro,
    characters,
    infoCards,
    worldCards,
    milestones,
    ending
  };

  validateReferences(scenario);
  return scenario;
}

/** 引用完整性：id 不重复、target/requires 指向真实存在的卡与人物 */
function validateReferences(s: ScenarioData): void {
  const charIds = new Set(s.characters.map((c) => c.id));
  const cardIds = new Set<string>();
  const allCards = [...s.infoCards, ...s.worldCards];

  for (const card of allCards) {
    if (cardIds.has(card.id)) throw new ScenarioError(`卡片 id 重复：${card.id}`);
    cardIds.add(card.id);
  }

  for (const card of allCards) {
    const lock = card.lock;
    if (!lock) continue;
    if (lock.target !== "world" && !charIds.has(lock.target)) {
      throw new ScenarioError(`卡片 ${card.id} 的 target "${lock.target}" 不是已定义的人物`);
    }
    for (const req of lock.requires) {
      if (!cardIds.has(req)) throw new ScenarioError(`卡片 ${card.id} 的前置 "${req}" 不存在`);
      if (req === card.id) throw new ScenarioError(`卡片 ${card.id} 不能依赖自己`);
    }
  }

  for (const card of s.infoCards) {
    if (!charIds.has(card.char)) {
      throw new ScenarioError(`信息卡 ${card.id} 归属人物 "${card.char}" 不存在`);
    }
  }

  for (const m of s.milestones) {
    for (const req of m.requires) {
      if (!cardIds.has(req)) throw new ScenarioError(`里程碑 ${m.id} 的依赖 "${req}" 不存在`);
    }
  }

  for (const req of [...s.ending.required, ...(s.ending.bonus ?? [])]) {
    if (!cardIds.has(req)) throw new ScenarioError(`结局条件 "${req}" 不存在`);
  }
}

export const allCards = (s: ScenarioData) => [...s.infoCards, ...s.worldCards];
