/**
 * 配置集中管理：所有可变项来自环境变量，启动时一次性校验、快速失败。
 * 缺项或格式错误直接抛错退出，不允许带着半截配置跑起来。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** 极简 .env 解析：只为免去 dotenv 依赖，支持 KEY=VALUE 与 # 注释 */
function loadDotEnv(): void {
  const file = resolve(PROJECT_ROOT, ".env");
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const problems: string[] = [];

function str(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    problems.push(`${key} 缺失（参考 .env.example）`);
    return "";
  }
  return value;
}

function int(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    problems.push(`${key} 必须是 ${min}~${max} 之间的整数，当前为 "${raw}"`);
    return fallback;
  }
  return parsed;
}

const nodeEnv = str("NODE_ENV", "development");
if (!["development", "production", "test"].includes(nodeEnv)) {
  problems.push(`NODE_ENV 只能是 development / production / test，当前为 "${nodeEnv}"`);
}

const dbFile = str("DB_FILE", "var/ciyue.db");
const staticDir = str("STATIC_DIR", "public");
// CORS 留空表示「只允许同源」——前端由本服务托管时这是最安全也最省事的配置。
// 生产环境禁止 *（通配符会把接口暴露给任意站点），要跨域就必须写显式域名。
const corsRaw = str("CORS_ORIGINS", nodeEnv === "production" ? "" : "*");

if (nodeEnv === "production" && corsRaw === "*") {
  problems.push("生产环境不允许 CORS_ORIGINS=*，请写显式域名，或留空只允许同源");
}

if (problems.length > 0) {
  throw new Error(
    "启动配置校验未通过：\n  - " + problems.join("\n  - ") + "\n请对照 .env.example 补齐后再启动。"
  );
}

const origins: "*" | string[] =
  corsRaw === "*" ? "*" : corsRaw.split(",").map((s) => s.trim()).filter(Boolean);

export const env = {
  nodeEnv,
  isProd: nodeEnv === "production",
  // 部署平台通过 PORT 注入端口，并要求监听 0.0.0.0
  host: str("HOST", "0.0.0.0"),
  port: int("PORT", 8787, 1, 65535),
  dbFile: isAbsolute(dbFile) ? dbFile : resolve(PROJECT_ROOT, dbFile),
  staticDir: isAbsolute(staticDir) ? staticDir : resolve(PROJECT_ROOT, staticDir),
  corsOrigins: origins,
  logLevel: str("LOG_LEVEL", "info"),
  attemptRateLimit: int("ATTEMPT_RATE_LIMIT", 60, 1, 10000)
} as const;
