/* ============================================================
 * 词钥 · API 客户端
 * ------------------------------------------------------------
 * 这个文件是浏览器里唯一知道「后端在哪」的地方。
 * 它不含任何剧本内容，也不做任何判定——所有事实来自服务端。
 *
 * 地址解析顺序（取第一个 /health 通的）：
 *   1. window.CIYUE_API_BASE（部署时写死或用反代前缀）
 *   2. 同源（由 API 服务一并托管前端时）
 *   3. http://127.0.0.1:8787（本地开发兜底）
 * ============================================================ */
const Api = (function () {
  "use strict";

  // 托管代理要求每个请求都带 sharecode（见 index.html 顶部说明）。
  // 页面上通常由 index.html 提前算好；没算过就自己从 location.search 取。
  const SHARE_QUERY = (function () {
    if (typeof window.CIYUE_SHARE_QUERY === "string") return window.CIYUE_SHARE_QUERY;
    const code = new URLSearchParams(location.search).get("sharecode");
    return code ? "?sharecode=" + encodeURIComponent(code) : "";
  })();

  function withShare(path) {
    if (!SHARE_QUERY) return path;
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + SHARE_QUERY.slice(1);
  }

  const TIMEOUT_MS = 8000;
  const MAX_RETRY = 3;
  let base = null;

  function candidateBases() {
    const list = [];
    if (typeof window.CIYUE_API_BASE === "string" && window.CIYUE_API_BASE) {
      list.push(window.CIYUE_API_BASE.replace(/\/$/, ""));
    }
    if (location.protocol === "http:" || location.protocol === "https:") {
      list.push(""); // 同源
    }
    list.push("http://127.0.0.1:8787");
    return [...new Set(list)];
  }

  /** 把 HTTP 状态翻译成人话；4xx 不重试，5xx 与网络错误才重试 */
  function toFriendlyError(status, payload) {
    const code = payload && payload.error && payload.error.code;
    const serverMsg = payload && payload.error && payload.error.message;
    if (status === 0) return new Error("连不上服务，检查一下后端是否已启动");
    if (serverMsg) {
      const err = new Error(serverMsg);
      err.code = code;
      err.status = status;
      return err;
    }
    if (status === 404) return Object.assign(new Error("对局不存在"), { status, code: "NOT_FOUND" });
    if (status === 429) return Object.assign(new Error("操作太频繁，歇一下"), { status, code: "RATE_LIMITED" });
    if (status >= 500) return Object.assign(new Error("服务暂时不可用"), { status });
    return Object.assign(new Error("请求失败：" + status), { status });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function request(path, options) {
    const opts = options || {};
    const method = opts.method || "GET";
    let lastErr = null;

    for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
      if (attempt > 0) await sleep(220 * Math.pow(2, attempt - 1));

      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;

      try {
        const res = await fetch((base || "") + withShare(path), {
          method,
          headers: opts.body ? { "content-type": "application/json" } : undefined,
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: controller ? controller.signal : undefined
        });
        const text = await res.text();
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }

        if (res.ok) return payload;

        const err = toFriendlyError(res.status, payload);
        lastErr = err;
        // 4xx 是玩家/参数问题，重试没意义
        if (res.status < 500) throw err;
      } catch (e) {
        lastErr = e && e.name === "AbortError"
          ? Object.assign(new Error("服务响应超时"), { status: 0 })
          : e;
        // 业务错误（4xx）直接抛，网络/超时/5xx 继续重试
        if (lastErr && typeof lastErr.status === "number" && lastErr.status >= 400 && lastErr.status < 500) {
          throw lastErr;
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastErr || new Error("请求失败");
  }

  /** 逐个候选地址探活，选定 base */
  async function connect() {
    const bases = candidateBases();
    for (const candidate of bases) {
      const prev = base;
      base = candidate;
      try {
        const res = await fetch((base || "") + withShare("/health"), { method: "GET" });
        if (res.ok) return { ok: true, base: base || location.origin };
      } catch (e) {
        /* 换下一个 */
      }
      base = prev;
    }
    base = null;
    return { ok: false, tried: bases };
  }

  let sessionId = null;
  const SESSION_KEY = "ciyue.session.v1";

  function rememberSession(id) {
    sessionId = id;
    try { localStorage.setItem(SESSION_KEY, id); } catch (e) { /* 隐私模式忽略 */ }
  }
  function forgetSession() {
    sessionId = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }
  function storedSession() {
    try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
  }

  return {
    connect,
    get base() { return base; },
    get sessionId() { return sessionId; },
    storedSession,
    forgetSession,

    async createSession(scenarioId) {
      const data = await request("/api/sessions", { method: "POST", body: scenarioId ? { scenarioId } : {} });
      rememberSession(data.sessionId);
      return data;
    },

    async getBoard(id) {
      const data = await request("/api/sessions/" + encodeURIComponent(id));
      return data.board;
    },

    /** 提交一次解锁；服务端返回判定结果 + 最新盘面 */
    async attempt(id, keyword, target) {
      return request("/api/sessions/" + encodeURIComponent(id) + "/attempts", {
        method: "POST",
        body: { keyword, target }
      });
    },

    async hint(id, cardId) {
      return request("/api/sessions/" + encodeURIComponent(id) + "/hints", {
        method: "POST",
        body: cardId ? { cardId } : {}
      });
    },

    async replay(id) {
      return request("/api/sessions/" + encodeURIComponent(id) + "/replay");
    }
  };
})();
