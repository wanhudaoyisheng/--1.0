/**
 * 演绎层：只决定「怎么说」，绝不产生剧本外事实。
 * 这一层将来会换成真实大模型，本文件即降级模板库（对应 PRD 8.5：
 * 超时 / 越界 / 解析失败时回退到这里，流程不中断）。
 */
import type { Milestone } from "../scenarios/types.ts";
import type { Verdict } from "../judge/engine.ts";

export interface UnlockDesc {
  type: "world" | "info";
  title?: string;
  charName?: string;
}

export interface ReactionInput {
  verdict: Verdict;
  targetName?: string;
  unlocked?: UnlockDesc[];
  newCharNames?: string[];
}

const POOLS: Record<string, string[]> = {
  success: [
    "咔哒——锁开了。",
    "开门红！这条线接上了。",
    "漂亮，你这一下把蒙着的布扯掉一角。",
    "稳。向导我都想给你鼓掌。",
    "信息池又厚了一层。"
  ],
  double: [
    "双杀！一下子涌进来两股线索，呼吸都快了。",
    "双杀！两条线同时亮了，这手漂亮。"
  ],
  reveal: [
    "画布上多了一道轮廓——新人物浮出来了。",
    "雾里走出一个人影，TA 一直藏在你点过的字后面。"
  ],
  fail: [
    "这组字暂时连不上……换个角度试试？",
    "线索像断了一截，先别急。",
    "嗯……不是这条路。再看看原文？",
    "差一点，但不是它。回到信息里再找找。"
  ],
  near: [
    "这几个字有戏……还差最后一点，别松手。",
    "方向对了，把词拼完整。",
    "就快接上了，再补上剩下的字。"
  ],
  blocked: [
    "字是对的，但还差一块前置线索没揭开，先去别处挖。",
    "钥匙找到了，门还没造好——先把前置的线索补全。"
  ],
  worldview: [
    "世界观还撑不住这一段，回前面翻翻被你忽略的词。",
    "光有这点设定压不住真相，先去补世界观。"
  ]
};

const pick = (arr: string[]): string => arr[Math.floor(Math.random() * arr.length)] ?? "";

function describe(unlocked: UnlockDesc[]): string {
  if (unlocked.length === 0) return "";
  const parts = unlocked.map((u) =>
    u.type === "world" ? `世界观「${u.title ?? ""}」解锁` : `${u.charName ?? "TA"} 的话里多了一段`
  );
  return parts.join("，") + "。";
}

export function buildReaction(input: ReactionInput): string {
  const { verdict } = input;
  const unlocked = input.unlocked ?? [];

  if (verdict === "success" || verdict === "double") {
    const lead = pick(POOLS[verdict] ?? POOLS.success!);
    const tail = describe(unlocked);
    const link = input.targetName ? `（指向：${input.targetName}）` : "";
    return `${lead} ${tail} ${link}`.replace(/\s+/g, " ").trim();
  }

  if (verdict === "reveal") {
    const lead = pick(POOLS.reveal!);
    const names = input.newCharNames ?? [];
    const tail = names.length ? `${names.join("、")} 现身了。` : describe(unlocked);
    return `${lead} ${tail}`.trim();
  }

  return pick(POOLS[verdict] ?? POOLS.fail!);
}

export function milestoneText(m: Milestone): string {
  return pick([`【里程碑 · ${m.name}】${m.desc}`, `阶段达成 · ${m.name}：${m.desc}`]);
}

/** 兜底：任何异常情况下都必须能说出一句话，不能让玩家面对空白 */
export function safeFallback(): string {
  return "向导这头有点卡，先把已经亮着的线索再看一遍。";
}
