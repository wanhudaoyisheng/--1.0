import { randomUUID } from "node:crypto";

/** 带前缀的短 id，便于日志里一眼看出资源类型 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
