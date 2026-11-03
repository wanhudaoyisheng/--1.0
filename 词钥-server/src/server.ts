/**
 * 进程入口：连库 → 确保剧本 → 起服务 → 优雅停机。
 * 任何一步失败都立刻退出并打印可读原因，不带病运行。
 */
import { env } from "./config/env.ts";
import { openDatabase } from "./db/index.ts";
import { buildApp } from "./app.ts";
import { ensureScenario } from "./modules/scenarios/ensure.ts";

const opened = openDatabase(env.dbFile);
const db = opened.db;
const app = await buildApp(db);

// 部署环境没有单独的导入步骤：启动时确保剧本在库里（幂等）
try {
  const status = ensureScenario(db);
  app.log.info(status, status.seeded ? "检测到空库，已自动导入剧本" : "剧本已就绪");
} catch (err) {
  app.log.error({ err }, "剧本导入失败，服务无法开局");
  process.exit(1);
}

if (opened.degraded) {
  app.log.warn(
    { reason: opened.reason },
    "数据库文件不可写，已降级为内存库：对局可以玩，但重启后进度会丢失"
  );
}

let closing = false;

async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "收到退出信号，开始优雅停机");
  try {
    await app.close();
    db.close();
    app.log.info("已停止");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "停机过程出错");
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  app.log.error({ reason }, "未处理的 Promise 拒绝");
});

try {
  await app.listen({ host: env.host, port: env.port });
  app.log.info(
    { host: env.host, port: env.port, db: opened.path, static: env.staticDir },
    "词钥 API 就绪"
  );
} catch (err) {
  app.log.error({ err }, "启动失败");
  process.exit(1);
}
