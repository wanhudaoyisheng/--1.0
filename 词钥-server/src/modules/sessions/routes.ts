/**
 * HTTP 层：只做「校验入参 → 调服务 → 出参」，不写任何业务判断。
 * schema 校验交给 Fastify，越界的输入到不了服务层。
 */
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { env } from "../../config/env.ts";
import { tooManyRequests } from "../../core/errors.ts";
import * as service from "./service.ts";

const sessionParams = {
  type: "object",
  required: ["sessionId"],
  properties: { sessionId: { type: "string", pattern: "^s_[A-Za-z0-9]{6,40}$" } }
} as const;

const createBody = {
  type: "object",
  additionalProperties: false,
  properties: { scenarioId: { type: "string", minLength: 1, maxLength: 64 } }
} as const;

const attemptBody = {
  type: "object",
  required: ["keyword", "target"],
  additionalProperties: false,
  properties: {
    keyword: { type: "string", minLength: 1, maxLength: 16 },
    target: { type: "string", minLength: 1, maxLength: 40 }
  }
} as const;

const hintBody = {
  type: "object",
  additionalProperties: false,
  properties: { cardId: { type: "string", minLength: 1, maxLength: 40 } }
} as const;

/** 极简滑动窗口限流：防止有人脚本穷举关键词把整本剧本试出来 */
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return;
  }
  bucket.count += 1;
  if (bucket.count > env.attemptRateLimit) {
    throw tooManyRequests(`每分钟最多提交 ${env.attemptRateLimit} 次判定，歇一下再试`);
  }
}

export async function registerSessionRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.post("/api/sessions", { schema: { body: createBody } }, async (req, reply) => {
    const { scenarioId } = (req.body ?? {}) as { scenarioId?: string };
    const result = service.createSession(db, scenarioId);
    reply.code(201);
    return result;
  });

  app.get("/api/sessions/:sessionId", { schema: { params: sessionParams } }, async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    return { board: service.getBoard(db, sessionId) };
  });

  app.post(
    "/api/sessions/:sessionId/attempts",
    { schema: { params: sessionParams, body: attemptBody } },
    async (req) => {
      const { sessionId } = req.params as { sessionId: string };
      const { keyword, target } = req.body as { keyword: string; target: string };
      rateLimit(sessionId);
      return service.submitAttempt(db, sessionId, keyword, target);
    }
  );

  app.post(
    "/api/sessions/:sessionId/hints",
    { schema: { params: sessionParams, body: hintBody } },
    async (req) => {
      const { sessionId } = req.params as { sessionId: string };
      const { cardId } = (req.body ?? {}) as { cardId?: string };
      rateLimit(sessionId);
      return service.requestHint(db, sessionId, cardId);
    }
  );

  app.get("/api/sessions/:sessionId/replay", { schema: { params: sessionParams } }, async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    return service.getReplay(db, sessionId);
  });
}
