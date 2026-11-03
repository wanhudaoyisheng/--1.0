/**
 * 类型化错误体系：业务层只抛 AppError，HTTP 层统一翻译。
 * 客户端永远只看到 { code, message, requestId }，绝不暴露堆栈与内部细节。
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(code, message, 400, details);

export const notFound = (message = "找不到对应的资源") =>
  new AppError("NOT_FOUND", message, 404);

export const conflict = (code: string, message: string) =>
  new AppError(code, message, 409);

export const tooManyRequests = (message = "操作太频繁，稍等一下再试") =>
  new AppError("RATE_LIMITED", message, 429);

export const internal = (message = "服务内部错误") =>
  new AppError("INTERNAL_ERROR", message, 500);
