/**
 * 集成测试：用真实数据库（内存库）+ 真实路由，跑完整一局通关。
 * 重点验证三件事：判定正确、进度真的存进了库、响应里不泄露未解锁内容。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db/index.ts";
import { saveScenario } from "../src/modules/scenarios/repo.ts";
import { buildApp } from "../src/app.ts";
import { loadScenarioFile } from "../src/modules/scenarios/loader.ts";

async function setup() {
  const { db } = openDatabase(":memory:");
  saveScenario(db, loadScenarioFile());
  const app = await buildApp(db, { logger: false });
  return { db, app };
}

test("完整一局：开局 → 六步通关 → 封盘", async (t) => {
  const { db, app } = await setup();
  t.after(async () => {
    await app.close();
    db.close();
  });

  // 1. 开局
  const created = await app.inject({ method: "POST", url: "/api/sessions", payload: {} });
  assert.equal(created.statusCode, 201);
  const { sessionId, board } = created.json();
  assert.match(sessionId, /^s_/);
  assert.equal(board.infoCards.length, 3, "开局应有三条信息");
  assert.equal(board.worldCards.length, 0);
  assert.equal(board.progress.unlocked, 3);
  const hidden = board.characters.find((c: { revealed: boolean }) => !c.revealed);
  assert.equal(hidden.name, "？？？");

  // 2. 反泄漏：整个响应里不能出现锁信息，也不能出现未解锁卡的原文
  const raw = created.body;
  for (const forbidden of ["keyword", "requires", "hints", "\"lock\"", "巨型嗔兽", "守门人"]) {
    assert.ok(!raw.includes(forbidden), `开局响应泄露了 ${forbidden}`);
  }

  // 3. 六步通关
  const steps: Array<[string, string, string]> = [
    ["硬币", "c003", "i004"],
    ["尼安德特人", "world", "w001"],
    ["代价", "c003", "i005"],
    ["代价", "c002", "i007"],
    ["嗔兽", "world", "w002"],
    ["少主", "c004", "i006"]
  ];

  let last: any = null;
  for (const [keyword, target, expectCard] of steps) {
    const res = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/attempts`,
      payload: { keyword, target }
    });
    assert.equal(res.statusCode, 200, `${keyword} 提交失败：${res.body}`);
    const body = res.json();
    last = body;
    const ids = body.unlocked.map((u: { id: string }) => u.id);
    assert.ok(ids.includes(expectCard), `${keyword}→${target} 应解锁 ${expectCard}，实际 ${ids.join(",")}`);
    assert.ok(body.reaction.length > 0, "必须给出反馈文案");
    assert.ok(!("keyword" in body.unlocked[0]), "解锁对象不应带出关键词");

    // 「代价 → 本」应当一次开两张（双杀）
    if (keyword === "代价" && target === "c003") {
      assert.equal(body.verdict, "double");
      assert.equal(ids.length, 2, "双杀应同时解锁 i005 与 i008");
    }
  }

  // 5. 结局
  assert.equal(last.ended, true);
  assert.equal(last.board.ended, true);
  assert.ok(last.board.ending, "结束后应下发结局文本");
  assert.ok(last.board.progress.unlocked === last.board.progress.total);

  // 6. 封盘后再提交
  const again = await app.inject({
    method: "POST",
    url: `/api/sessions/${sessionId}/attempts`,
    payload: { keyword: "硬币", target: "c003" }
  });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, "SESSION_ENDED");

  // 7. 进度真的落库：换一次请求重新读盘面
  const boardAgain = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}` });
  assert.equal(boardAgain.statusCode, 200);
  assert.equal(boardAgain.json().board.progress.unlocked, 10);

  // 8. 回放
  const replay = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/replay` });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().attempts.length, 6, "六步 = 6 条提交记录");
  assert.ok(replay.json().attempts.every((a: { round: number }, i: number) => a.round === i + 1));
});

test("失败与前置不足的反馈不泄露答案", async (t) => {
  const { db, app } = await setup();
  t.after(async () => {
    await app.close();
    db.close();
  });

  const { sessionId } = (
    await app.inject({ method: "POST", url: "/api/sessions", payload: {} })
  ).json();

  const miss = await app.inject({
    method: "POST",
    url: `/api/sessions/${sessionId}/attempts`,
    payload: { keyword: "怪物", target: "c001" }
  });
  assert.equal(miss.json().verdict, "fail");
  assert.equal(miss.json().unlocked.length, 0);

  const early = await app.inject({
    method: "POST",
    url: `/api/sessions/${sessionId}/attempts`,
    payload: { keyword: "少主", target: "c004" }
  });
  assert.equal(early.json().verdict, "worldview");
  assert.equal(early.json().unlocked.length, 0);
  assert.ok(!early.body.includes("i005"), "不应把缺失的卡 id 直接吐给前端");
});

test("提示逐级递进，且不会一次给出答案", async (t) => {
  const { db, app } = await setup();
  t.after(async () => {
    await app.close();
    db.close();
  });

  const { sessionId } = (
    await app.inject({ method: "POST", url: "/api/sessions", payload: {} })
  ).json();

  const seen = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const res = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/hints`,
      payload: {}
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    seen.add(body.text);
    assert.ok(body.level >= 1 && body.level <= body.totalLevels);
  }
  assert.equal(seen.size, 3, "四级请求应命中三级不同文案");
});

test("参数校验与未知对局", async (t) => {
  const { db, app } = await setup();
  t.after(async () => {
    await app.close();
    db.close();
  });

  const bad = await app.inject({
    method: "POST",
    url: "/api/sessions/s_aaaaaaaaaaaa/attempts",
    payload: { keyword: "硬币" }
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, "VALIDATION_FAILED");

  const missing = await app.inject({ method: "GET", url: "/api/sessions/s_bbbbbbbbbbbb" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "NOT_FOUND");
  assert.ok(missing.json().error.requestId, "错误响应必须带 requestId");
});

test("健康检查", async (t) => {
  const { db, app } = await setup();
  t.after(async () => {
    await app.close();
    db.close();
  });
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/ready" })).json().db, "ok");
});
