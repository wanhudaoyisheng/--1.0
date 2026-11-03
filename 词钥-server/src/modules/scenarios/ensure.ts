/**
 * 启动自举：确保剧本存在。
 * 部署环境没有「npm run seed」这一步，所以放进启动流程里，幂等。
 */
import type { Db } from "../../db/index.ts";
import { latestScenario, saveScenario } from "./repo.ts";
import { loadScenarioFile } from "./loader.ts";

export interface ScenarioStatus {
  id: string;
  version: number;
  seeded: boolean;
}

export function ensureScenario(db: Db): ScenarioStatus {
  try {
    const current = latestScenario(db);
    return { id: current.id, version: current.version, seeded: false };
  } catch {
    const saved = saveScenario(db, loadScenarioFile());
    return { id: saved.id, version: saved.version, seeded: true };
  }
}
