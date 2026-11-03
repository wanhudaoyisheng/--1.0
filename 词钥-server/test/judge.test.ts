/**
 * 判定引擎单测：纯函数，跑得飞快，不需要数据库。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { judge, type JudgeContext } from "../src/modules/judge/engine.ts";
import { parseScenario } from "../src/modules/scenarios/types.ts";

const scenario = parseScenario({
  scenario_id: "t1",
  title: "测试剧本",
  intro: "开场",
  characters: [
    { id: "c1", name: "甲", profile: "甲", avatar: "甲", revealed: true },
    { id: "c2", name: "乙", profile: "乙", avatar: "乙", revealed: false }
  ],
  infoCards: [
    { id: "i001", char: "c1", text: "开局白给的一段话。", lock: null },
    { id: "i002", char: "c1", text: "硬币掉在地上。", lock: { keyword: "硬币", target: "c1", requires: [], hints: ["h1", "h2", "h3"] } },
    { id: "i003", char: "c1", text: "代价很重。", lock: { keyword: "代价", target: "c1", requires: ["w001"], hints: ["h1", "h2", "h3"] } },
    { id: "i004", char: "c1", text: "双开的一段。", lock: { keyword: "代价", target: "c1", requires: ["w001"], hints: ["h1", "h2", "h3"] } },
    { id: "i005", char: "c2", text: "乙藏起来了。", lock: { keyword: "乙", target: "c2", requires: ["i002", "w002"], hints: ["h1", "h2", "h3"] } }
  ],
  worldCards: [
    { id: "w001", title: "世界一", text: "设定一。", lock: { keyword: "世界一", target: "world", requires: [], hints: ["h1", "h2", "h3"] } },
    { id: "w002", title: "世界二", text: "设定二。", lock: { keyword: "世界二", target: "world", requires: [], hints: ["h1", "h2", "h3"] } }
  ],
  milestones: [{ id: "m1", name: "里程碑", desc: "描述", requires: ["w001"] }],
  ending: { required: ["w001", "i003"], text: "结局" }
});

const ctx = (unlocked: string[]): JudgeContext => ({ scenario, unlocked: new Set(unlocked) });

test("没这条链 → fail / no-match", () => {
  const r = judge(ctx(["i001"]), "不存在的词", "c1");
  assert.equal(r.verdict, "fail");
  assert.equal(r.reason, "no-match");
  assert.deepEqual(r.unlockIds, []);
});

test("词对、目标错 → 也不算命中", () => {
  const r = judge(ctx(["i001"]), "硬币", "c2");
  assert.equal(r.verdict, "fail");
});

test("命中且前置满足 → success", () => {
  const r = judge(ctx(["i001"]), "硬币", "c1");
  assert.equal(r.verdict, "success");
  assert.deepEqual(r.unlockIds, ["i002"]);
});

test("缺前置时如实报出缺哪几张卡（不泄露关键词）", () => {
  const r = judge(ctx(["i001", "i002"]), "乙", "c2");
  assert.equal(r.verdict, "worldview");
  assert.deepEqual(r.missingRequires, ["w002"]);
});

test("前置里有世界观未解 → worldview", () => {
  const r = judge(ctx(["i001"]), "代价", "c1");
  assert.equal(r.verdict, "worldview");
  assert.equal(r.reason, "requires-unmet");
  assert.deepEqual(r.unlockIds, []);
});

test("同一关键词同一目标命中两张 → double", () => {
  const r = judge(ctx(["i001", "w001"]), "代价", "c1");
  assert.equal(r.verdict, "double");
  assert.deepEqual(r.unlockIds.sort(), ["i003", "i004"]);
});

test("已解锁的卡不重复解锁", () => {
  const r = judge(ctx(["i001", "w001", "i003", "i004"]), "代价", "c1");
  assert.equal(r.verdict, "fail");
});

test("剧本校验：target 指向不存在的人物要报错", () => {
  assert.throws(
    () =>
      parseScenario({
        scenario_id: "bad",
        title: "坏剧本",
        intro: "x",
        characters: [{ id: "c1", name: "甲", profile: "甲", avatar: "甲", revealed: true }],
        infoCards: [
          { id: "i1", char: "c1", text: "x", lock: { keyword: "k", target: "cX", requires: [], hints: ["a"] } }
        ],
        worldCards: [],
        milestones: [],
        ending: { required: [], text: "e" }
      }),
    /target "cX" 不是已定义的人物/
  );
});
