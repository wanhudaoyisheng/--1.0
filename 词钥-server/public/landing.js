/* ============================================================
 * 词钥 · 进入页 / 主题系统 / 迷幻背景
 * 与游戏逻辑（app.js）完全解耦：本文件只管「氛围」与「入口」
 * ============================================================ */
(function () {
  "use strict";

  /* ---------------- 主题 ---------------- */
  const THEMES = [
    { id: "void",  name: "深渊", c1: "#7c3aed", c2: "#a78bfa", c3: "#22d3ee" },
    { id: "ember", name: "烬火", c1: "#dc2626", c2: "#f87171", c3: "#fbbf24" },
    { id: "abyss", name: "幽海", c1: "#0d9488", c2: "#2dd4bf", c3: "#60a5fa" },
    { id: "ochre", name: "荒原", c1: "#b45309", c2: "#e0b341", c3: "#fb923c" }
  ];
  const THEME_KEY = "ciyue.theme";

  function applyTheme(id, persist) {
    if (!THEMES.some((t) => t.id === id)) id = "void";
    document.documentElement.dataset.theme = id;
    document.querySelectorAll(".theme-picker .sw").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === id);
    });
    if (persist) {
      try { localStorage.setItem(THEME_KEY, id); } catch (e) { /* 隐私模式忽略 */ }
    }
    readPalette();
    drawAurora(lastT);
  }

  function buildPickers() {
    ["#landing-themes", "#game-themes"].forEach((sel) => {
      const box = document.querySelector(sel);
      if (!box) return;
      box.innerHTML = "";
      THEMES.forEach((t) => {
        const b = document.createElement("button");
        b.className = "sw";
        b.dataset.theme = t.id;
        b.title = t.name;
        b.innerHTML =
          `<span class="sw-dot" style="--c1:${t.c1};--c2:${t.c2};--c3:${t.c3}"></span>` +
          `<span class="sw-name">${t.name}</span>`;
        b.onclick = () => applyTheme(t.id, true);
        box.appendChild(b);
      });
    });
  }

  /* ---------------- 迷幻背景 ---------------- */
  const canvas = document.getElementById("aurora");
  const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  const RES = 0.16;                    // 低分辨率绘制 + CSS 放大 = 便宜的柔焦
  let W = 2, H = 2, palette = [], lastT = 0, rafId = null, lastPaint = 0;

  const BLOBS = [
    { r: 0.85, sx: 0.21, sy: 0.16, px: 0.0, py: 1.7, a: 0.60 },
    { r: 0.70, sx: 0.15, sy: 0.23, px: 2.1, py: 0.4, a: 0.55 },
    { r: 0.62, sx: 0.27, sy: 0.12, px: 4.2, py: 3.1, a: 0.50 },
    { r: 0.92, sx: 0.11, sy: 0.19, px: 1.3, py: 4.8, a: 0.42 },
    { r: 0.52, sx: 0.31, sy: 0.26, px: 3.6, py: 2.2, a: 0.46 },
    { r: 0.74, sx: 0.18, sy: 0.09, px: 5.4, py: 0.9, a: 0.38 }
  ];

  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const keys = ["--b1", "--b2", "--b3", "--b4", "--bg"];
    const vals = keys.map((k) => (cs.getPropertyValue(k) || "").trim()).filter(Boolean);
    if (vals.length >= 5) palette = vals;   // [b1,b2,b3,b4,bg]
    else if (vals.length >= 4) palette = vals.slice(0, 4);
  }

  function hexA(hex, alpha) {
    if (!hex) return `rgba(120,120,160,${alpha})`;
    hex = hex.trim();
    if (hex.startsWith("rgb")) return hex;           // 已是 rgb(a)，直接返回
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    if (isNaN(n)) return `rgba(120,120,160,${alpha})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function resize() {
    if (!ctx) return;
    W = Math.max(2, Math.round(window.innerWidth * RES));
    H = Math.max(2, Math.round(window.innerHeight * RES));
    canvas.width = W;
    canvas.height = H;
    drawAurora(lastT);
  }

  function drawAurora(t) {
    if (!ctx) return;
    if (!palette.length) readPalette();
    if (!palette.length) return;

    // 先铺底色，避免多层加色叠成一片惨白
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = hexA(palette[4] || palette[0], 1);
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = "lighter";
    const R = Math.max(W, H);
    BLOBS.forEach((b, i) => {
      const x = W * (0.5 + 0.46 * Math.sin(t * b.sx + b.px));
      const y = H * (0.5 + 0.46 * Math.cos(t * b.sy + b.py));
      const rad = R * b.r;
      const col = palette[i % 4];
      const a = b.a * 0.62;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, hexA(col, a));
      g.addColorStop(0.4, hexA(col, a * 0.32));
      g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    });

    ctx.globalCompositeOperation = "source-over";
  }

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    const t = ts / 1000;
    lastT = t;
    const inGame = document.body.classList.contains("in-game");
    const minGap = inGame ? 55 : 26;                  // 游戏区降帧，省电
    if (ts - lastPaint < minGap) return;
    lastPaint = ts;
    drawAurora(t);
  }

  function startAurora() {
    if (!ctx) return;
    resize();
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      drawAurora(1.2);                                 // 静态一帧
      return;
    }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      } else if (!rafId) {
        rafId = requestAnimationFrame(loop);
      }
    });
  }

  /* ---------------- 滚动：进入页 → 游戏 ---------------- */
  const landing = document.getElementById("landing");
  const game = document.getElementById("game");
  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const vh = window.innerHeight || 1;
      const y = window.scrollY || window.pageYOffset || 0;
      const p = Math.max(0, Math.min(1, y / (vh * 0.92)));
      if (landing) landing.style.setProperty("--lp", p.toFixed(4));
      document.body.classList.toggle("in-game", y > vh * 0.42);
      ticking = false;
    });
  }

  function jumpTo(el) {
    // html 上开了 scroll-behavior:smooth，scrollTo/scrollIntoView 会被平滑掉；跳转时临时关掉
    const root = document.documentElement;
    const prev = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
    root.style.scrollBehavior = prev;
    onScroll();
  }

  function goGame() {
    if (!game) return;
    game.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function goHome() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    // 调试/演示用参数：?fast=1 跳过开机遮罩；?nointro 直达游戏区
    const q = location.search;
    if (/[?&](fast|nointro)=1/.test(q)) {
      const cover = document.getElementById("boot-cover");
      if (cover) cover.remove();
    }

    buildPickers();

    let saved = "void";
    try { saved = localStorage.getItem(THEME_KEY) || "void"; } catch (e) { /* ignore */ }
    // 支持 ?theme=ember 直接指定配色（便于分享与演示）
    const tq = new URLSearchParams(location.search).get("theme");
    if (tq && THEMES.some((t) => t.id === tq)) saved = tq;
    applyTheme(saved, false);

    startAurora();
    let rt = null;
    window.addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(resize, 180);
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const enter = document.getElementById("btn-enter");
    if (enter) enter.onclick = goGame;

    const home = document.getElementById("btn-top-home");
    if (home) home.onclick = goHome;

    const openRules = () => {
      const m = document.getElementById("rules-modal");
      if (m) m.classList.remove("hidden");
    };
    ["#btn-rules", "#btn-top-rules"].forEach((sel) => {
      const b = document.querySelector(sel);
      if (b) b.onclick = openRules;
    });

    // 键盘：↓ / 空格 从封面进入游戏
    window.addEventListener("keydown", (e) => {
      if (document.body.classList.contains("in-game")) return;
      if (e.key === "ArrowDown" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        goGame();
      }
    });

    // 直接带 hash 打开时，跳过封面
    if (location.hash === "#game" && game) {
      setTimeout(() => jumpTo(game), 60);
    }
    if (/[?&]nointro=1/.test(q) && game) {
      setTimeout(() => jumpTo(game), 30);
    }

    document.body.classList.add("ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
