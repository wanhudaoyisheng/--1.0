/**
 * 数据库连接与迁移执行。
 *
 * 用 Node 内置的 node:sqlite：**零原生依赖**，不引入需要编译的模块，
 * 因此在任何沙箱/容器里都不会出现 ABI 不匹配或段错误。
 * 启动需要一个 flag：node --experimental-sqlite（见 package.json 的 scripts）。
 *
 * 表结构按可迁移到 PostgreSQL 的方式写，将来换库只需替换本文件与仓储层的驱动。
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.ts";

export type Db = DatabaseSync;

export interface OpenResult {
  db: Db;
  /** 实际使用的库路径；降级到内存库时会是 ":memory:" */
  path: string;
  degraded: boolean;
  reason?: string;
}

/**
 * 打开数据库并跑迁移。
 * 目标路径不可写时（例如只读文件系统）自动降级为内存库：
 * 站点照样能开能玩，只是重启后进度会丢——总比整个服务起不来强。
 */
export function openDatabase(file: string): OpenResult {
  try {
    return { db: connect(file), path: file, degraded: false };
  } catch (err) {
    if (file === ":memory:") throw err;
    const reason = err instanceof Error ? err.message : String(err);
    return { db: connect(":memory:"), path: ":memory:", degraded: true, reason };
  }
}

function connect(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  let current = Number(row?.user_version ?? 0);

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
      current = migration.version;
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(
        `迁移 v${migration.version} 执行失败：${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/** 多步写入统一走事务；抛出即整体回滚，不留半成品状态 */
export function withTransaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export const nowIso = (): string => new Date().toISOString();
