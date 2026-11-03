/**
 * 应用装配：插件 → 安全头 → 错误处理 → 路由 → 静态前端。
 * 抽出 buildApp 便于测试里用轻量实例跑集成测试（不起真实端口）。
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { env } from "./config/env.ts";
import { AppError } from "./core/errors.ts";
import type { Db } from "./db/index.ts";
import { listScenarios } from "./modules/scenarios/repo.ts";
import { registerSessionRoutes } from "./modules/sessions/routes.ts";

export async function buildApp(db: Db, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // 结构化 JSON 日志；requestId 贯穿一次请求的所有日志
    logger: opts.logger === false ? false : { level: env.logLevel, base: { service: "ciyue-api", env: env.nodeEnv } },
    genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
    bodyLimit: 64 * 1024
  });

  // 跨域：留空 = 只允许同源（前端由本服务托管时的默认姿势，不产生任何 CORS 头）。
  // 开发期可设 * 反射来源，方便前端在别的端口调试。
  if (env.corsOrigins === "*" || env.corsOrigins.length > 0) {
    await app.register(cors, {
      origin: env.corsOrigins === "*" ? true : env.corsOrigins,
      methods: ["GET", "POST"],
      credentials: false,
      maxAge: 600
    });
  }

  // 基础安全头（生产环境建议换成 @fastify/helmet 统一管理）
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("Referrer-Policy", "no-referrer");
    return payload;
  });

  // 统一错误出口：客户端只拿到规范化结构，堆栈只进日志
  app.setErrorHandler((rawErr, req, reply) => {
    const err = rawErr as FastifyError & {
      validation?: Array<{ instancePath?: string; message?: string }>;
    };
    if (err instanceof AppError) {
      reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details ?? null, requestId: req.id }
      });
      return;
    }
    if (err.validation) {
      reply.code(400).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "请求参数不合规",
          details: (err.validation ?? []).map((v) => `${v.instancePath || "/"} ${v.message ?? ""}`),
          requestId: req.id
        }
      });
      return;
    }
    req.log.error({ err }, "未处理异常");
    reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "服务内部错误，请稍后重试", details: null, requestId: req.id }
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: `没有这个接口：${req.method} ${req.url}`,
        details: null,
        requestId: req.id
      }
    });
  });

  // 健康检查：/health 只证明进程活着，/ready 才证明依赖可用
  app.get("/health", async () => ({ status: "ok", uptime: Math.round(process.uptime()) }));
  app.get("/ready", async (_req, reply) => {
    try {
      db.prepare("SELECT 1").get();
      return { status: "ready", db: "ok" };
    } catch (err) {
      reply.code(503);
      return { status: "degraded", db: err instanceof Error ? err.message : "unavailable" };
    }
  });

  app.get("/api/scenarios", async () => ({ scenarios: listScenarios(db) }));

  await registerSessionRoutes(app, db);

  // 同源托管前端：静态页面与 API 同端口，天然免跨域
  if (existsSync(env.staticDir)) {
    await app.register(fastifyStatic, { root: env.staticDir, prefix: "/" });
  } else {
    app.log.warn({ staticDir: env.staticDir }, "静态前端目录不存在，仅提供 API");
  }

  return app;
}
