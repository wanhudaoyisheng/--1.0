/**
 * 剧本源文件加载器。
 * 剧本只有一份：data/scenario.js。前端不持有任何剧本内容，
 * 因此玩家在浏览器里翻不到答案。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { PROJECT_ROOT } from "../../config/env.ts";
import { parseScenario, type ScenarioData } from "./types.ts";

export function scenarioFilePath(): string {
  return resolve(PROJECT_ROOT, "data/scenario.js");
}

export function loadScenarioFile(): ScenarioData {
  const file = scenarioFilePath();
  const code = readFileSync(file, "utf8");
  // scenario.js 是普通脚本（const SCENARIO = {...}），在隔离上下文里求值取回对象，
  // 顺带拿到经校验的结构。超时防止有人往剧本里塞死循环。
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(`${code}\n;globalThis.__scenario = SCENARIO;`, sandbox, {
    filename: file,
    timeout: 1000
  });
  const raw = sandbox.__scenario;
  if (!raw) throw new Error(`没能从 ${file} 里读出 SCENARIO 对象`);
  return parseScenario(raw);
}
