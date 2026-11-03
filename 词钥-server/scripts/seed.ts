/**
 * 手动导入/更新剧本：npm run seed
 * 幂等——内容与当前最新版完全一致时不重复插入。
 * （部署环境不必跑这个：服务启动时会自动导入，见 src/modules/scenarios/ensure.ts）
 */
import { env } from "../src/config/env.ts";
import { openDatabase } from "../src/db/index.ts";
import { latestScenario, saveScenario } from "../src/modules/scenarios/repo.ts";
import { loadScenarioFile, scenarioFilePath } from "../src/modules/scenarios/loader.ts";

const opened = openDatabase(env.dbFile);
const db = opened.db;

try {
  const scenario = loadScenarioFile();
  console.log(`读取剧本：${scenarioFilePath()}`);
  console.log(
    `  id=${scenario.scenario_id} 人物=${scenario.characters.length} 信息卡=${scenario.infoCards.length} 世界观=${scenario.worldCards.length}`
  );

  let same = false;
  try {
    const current = latestScenario(db, scenario.scenario_id);
    same = JSON.stringify(current.data) === JSON.stringify(scenario);
    if (same) console.log(`  内容与 v${current.version} 一致，跳过写入`);
  } catch {
    same = false;
  }

  if (!same) {
    const saved = saveScenario(db, scenario);
    console.log(`  已写入 v${saved.version}`);
  }
} catch (err) {
  console.error("导入失败：", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  db.close();
}
