/**
 * 剧本仓储：剧本以「id + 版本」整包存 JSON，版本只增不改。
 * 对局开局时锁定版本，避免玩家玩到一半剧本被改导致盘面错乱。
 */
import type { Db } from "../../db/index.ts";
import { nowIso } from "../../db/index.ts";
import { parseScenario, type ScenarioData } from "./types.ts";

export interface ScenarioRecord {
  id: string;
  version: number;
  title: string;
  data: ScenarioData;
}

interface ScenarioRow {
  id: string;
  version: number;
  title: string;
  data: string;
}

/** 入库：校验通过才写，版本号自增 */
export function saveScenario(db: Db, raw: unknown): ScenarioRecord {
  const scenario = parseScenario(raw);
  const row = db
    .prepare("SELECT MAX(version) AS v FROM scenarios WHERE id = ?")
    .get(scenario.scenario_id) as { v?: number | null } | undefined;
  const nextVersion = Number(row?.v ?? 0) + 1;

  db.prepare(
    "INSERT INTO scenarios (id, version, title, data, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(scenario.scenario_id, nextVersion, scenario.title, JSON.stringify(scenario), nowIso());

  return { id: scenario.scenario_id, version: nextVersion, title: scenario.title, data: scenario };
}

export function listScenarios(db: Db): Array<{ id: string; version: number; title: string }> {
  const rows = db
    .prepare(
      `SELECT s.id, s.version, s.title
         FROM scenarios s
         JOIN (SELECT id, MAX(version) AS mv FROM scenarios GROUP BY id) m
           ON m.id = s.id AND m.mv = s.version
        ORDER BY s.title`
    )
    .all() as unknown as Array<{ id: string; version: number; title: string }>;
  return rows.map((r) => ({ id: r.id, version: Number(r.version), title: r.title }));
}

export function getScenario(db: Db, id: string, version: number): ScenarioRecord {
  const row = db
    .prepare("SELECT id, version, title, data FROM scenarios WHERE id = ? AND version = ?")
    .get(id, version) as unknown as ScenarioRow | undefined;
  if (!row) throw new Error(`剧本不存在：${id} v${version}`);
  return toRecord(row);
}

/** 取最新版；不指定 id 时取库里任意一个（单剧本阶段够用） */
export function latestScenario(db: Db, id?: string): ScenarioRecord {
  const row = (
    id
      ? db
          .prepare(
            "SELECT id, version, title, data FROM scenarios WHERE id = ? ORDER BY version DESC LIMIT 1"
          )
          .get(id)
      : db
          .prepare("SELECT id, version, title, data FROM scenarios ORDER BY created_at ASC, version DESC LIMIT 1")
          .get()
  ) as unknown as ScenarioRow | undefined;

  if (!row) throw new Error("剧本库为空，请先执行 npm run seed 导入剧本");
  return toRecord(row);
}

function toRecord(row: ScenarioRow): ScenarioRecord {
  return {
    id: row.id,
    version: Number(row.version),
    title: row.title,
    data: parseScenario(JSON.parse(row.data))
  };
}
