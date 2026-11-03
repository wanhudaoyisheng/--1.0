/**
 * 迁移一律用可回滚的版本号迁移，不靠手改表。
 * 用 SQLite 的 user_version 记录已执行版本，逐条前向迁移。
 */
export interface Migration {
  version: number;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE scenarios (
        id              TEXT    NOT NULL,
        version         INTEGER NOT NULL,
        title           TEXT    NOT NULL,
        data            TEXT    NOT NULL,
        created_at      TEXT    NOT NULL,
        PRIMARY KEY (id, version)
      );

      CREATE TABLE sessions (
        id               TEXT    PRIMARY KEY,
        scenario_id      TEXT    NOT NULL,
        scenario_version INTEGER NOT NULL,
        created_at       TEXT    NOT NULL,
        updated_at       TEXT    NOT NULL,
        ended_at         TEXT,
        submit_count     INTEGER NOT NULL DEFAULT 0,
        hint_count       INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (scenario_id, scenario_version) REFERENCES scenarios(id, version)
      );

      CREATE TABLE unlocks (
        session_id  TEXT NOT NULL,
        card_id     TEXT NOT NULL,
        kind        TEXT NOT NULL,
        unlocked_at TEXT NOT NULL,
        PRIMARY KEY (session_id, card_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE attempts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT    NOT NULL,
        round      INTEGER NOT NULL,
        keyword    TEXT    NOT NULL,
        target     TEXT    NOT NULL,
        verdict    TEXT    NOT NULL,
        detail     TEXT,
        created_at TEXT    NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_attempts_session ON attempts(session_id, round);

      CREATE TABLE hint_uses (
        session_id TEXT    NOT NULL,
        card_id    TEXT    NOT NULL,
        level      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, card_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE milestones_hit (
        session_id   TEXT NOT NULL,
        milestone_id TEXT NOT NULL,
        hit_at       TEXT NOT NULL,
        PRIMARY KEY (session_id, milestone_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `
  }
];
