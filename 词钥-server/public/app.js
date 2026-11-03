/* ============================================================
 * 词钥 · 主逻辑（浏览器端）
 * ------------------------------------------------------------
 * 前端只做三件事：渲染盘面、收集玩家的「词 + 指向」、把结果画出来。
 * 判定、剧本、提示原文、结局文本全部在服务端，这里一份都没有。
 * ============================================================ */
(function () {
  "use strict";

  const state = {
    board: null,          // 服务端下发的盘面（唯一数据源）
    sessionId: null,
    selections: [],       // [{cardId, pos, ch}]
    expanded: new Set(),
    target: null,
    coachDone: false,
    busy: false,
    arrivedAt: Date.now(),
    endingShown: false
  };

  const $ = (sel) => document.querySelector(sel);
  const charById = (id) => (state.board ? state.board.characters.find((c) => c.id === id) : null);
  const infoById = (id) => (state.board ? state.board.infoCards.find((c) => c.id === id) : null);

  /* ---------------- 基础 UI ---------------- */

  let guideTimer = null;
  function guide(text) {
    const el = $("#guide-bubble");
    if (!el || !text) return;
    el.textContent = text;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
    clearTimeout(guideTimer);
    guideTimer = setTimeout(() => el.classList.remove("bump"), 600);
  }

  function toast(text) {
    const layer = $("#toast-layer");
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    layer.appendChild(t);
    setTimeout(() => t.classList.add("show"), 12);
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 420);
    }, 3400);
  }

  window.closeModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  };

  /* ---------------- 画布 ---------------- */

  function renderCanvas() {
    const canvas = $("#canvas");
    if (!canvas || !state.board) return;
    canvas.innerHTML = "";

    state.board.characters.forEach((ch) => {
      const card = document.createElement("div");
      card.className = "char-card" + (ch.revealed ? "" : " locked");
      card.dataset.charId = ch.id;

      const head = document.createElement("div");
      head.className = "char-head";
      head.innerHTML =
        '<div class="avatar">' + (ch.revealed ? ch.avatar : "？") + "</div>" +
        '<div class="char-meta">' +
        '<div class="char-name">' + ch.name + "</div>" +
        '<div class="char-profile">' + ch.profile + "</div>" +
        "</div>";
      if (ch.revealed) head.onclick = () => toggleExpand(ch.id);
      card.appendChild(head);

      if (ch.revealed) {
        const isOpen = state.expanded.has(ch.id);
        const toggle = document.createElement("button");
        toggle.className = "expand-btn";
        toggle.textContent = isOpen ? "收起信息条 ▲" : "展开信息条 ▼";
        if (!state.coachDone && !isOpen && state.board.infoCards.some((c) => c.char === ch.id)) {
          toggle.classList.add("coach");
        }
        toggle.onclick = (e) => { e.stopPropagation(); toggleExpand(ch.id); };
        card.appendChild(toggle);

        if (isOpen) {
          const cards = state.board.infoCards.filter((c) => c.char === ch.id);
          if (!cards.length) {
            const n = document.createElement("div");
            n.className = "lock-note";
            n.textContent = "还没有解开 TA 的任何一句话。";
            card.appendChild(n);
          }
          cards.forEach((info) => {
            const bar = document.createElement("div");
            bar.className = "info-bar";
            bar.dataset.cardId = info.id;
            [...info.text].forEach((chr, pos) => {
              const cell = document.createElement("span");
              cell.className = "cell";
              cell.textContent = chr;
              cell.dataset.pos = String(pos);
              if (state.selections.some((s) => s.cardId === info.id && s.pos === pos)) {
                cell.classList.add("sel");
              }
              cell.onclick = (e) => { e.stopPropagation(); toggleCell(info.id, pos, chr, cell); };
              bar.appendChild(cell);
            });
            card.appendChild(bar);
          });
        }
      } else {
        const note = document.createElement("div");
        note.className = "lock-note";
        note.textContent = "点出能指向 TA 的字，TA 才会现身。";
        card.appendChild(note);
      }
      canvas.appendChild(card);
    });
  }

  function toggleExpand(id) {
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    state.coachDone = true;
    renderCanvas();
  }

  function toggleCell(cardId, pos, ch, el) {
    const idx = state.selections.findIndex((s) => s.cardId === cardId && s.pos === pos);
    if (idx >= 0) state.selections.splice(idx, 1);
    else state.selections.push({ cardId, pos, ch });
    el.classList.toggle("sel");
    updateSelectionPreview();
  }

  function keyword() {
    // 按「信息卡 → 原文位置」排序，点字顺序不影响组词
    return [...state.selections]
      .sort((a, b) => (a.cardId === b.cardId ? a.pos - b.pos : a.cardId < b.cardId ? -1 : 1))
      .map((s) => s.ch)
      .join("");
  }

  /* ---------------- 世界观 / 目标 / 建议 ---------------- */

  function renderWorldPanel() {
    const panel = $("#world-panel");
    const cards = state.board.worldCards;
    let html = '<div class="wp-title">世界观收集栏</div>';
    if (!cards.length) {
      html += '<div class="wp-empty">世界观尚未解锁——从人物原话里点出能指向「世界」的字。</div>';
    } else {
      cards.forEach((w) => {
        html +=
          '<div class="wp-card"><div class="wp-name">' + w.title +
          '</div><div class="wp-text">' + w.text + "</div></div>";
      });
    }
    panel.innerHTML = html;
  }

  function renderTargetChips() {
    const box = $("#target-chips");
    box.innerHTML = '<span class="tc-label">指向：</span>';

    state.board.characters.forEach((ch) => {
      const b = document.createElement("button");
      b.className = "chip" + (state.target === ch.id ? " active" : "");
      b.textContent = ch.name;
      b.dataset.target = ch.id;
      b.onclick = () => { state.target = ch.id; renderTargetChips(); updateSelectionPreview(); };
      box.appendChild(b);
    });

    const wb = document.createElement("button");
    wb.className = "chip world" + (state.target === "world" ? " active" : "");
    wb.textContent = "世界观";
    wb.dataset.target = "world";
    wb.onclick = () => { state.target = "world"; renderTargetChips(); updateSelectionPreview(); };
    box.appendChild(wb);
  }

  function renderObjective() {
    const box = $("#objective");
    const b = state.board;
    if (b.ended) {
      box.innerHTML = '<span class="obj-label">目标</span><span class="obj-done">✦ 真相已揭晓</span>';
      return;
    }
    const targets = b.readyTargets || [];
    if (!targets.length) {
      box.innerHTML =
        '<span class="obj-label">下一步建议</span>' +
        '<span class="obj-text">还差前置线索——回头翻翻较早的信息，关键词可能藏在别的世界观里。</span>';
      return;
    }
    const chips = targets
      .map((t) => {
        if (t.target === "world") return '<span class="obj-chip">世界设定待指认</span>';
        const ch = charById(t.target);
        const name = ch ? ch.name : "？？？";
        return '<span class="obj-chip">【' + name + "】还有话没说完" + (t.count > 1 ? " ×" + t.count : "") + "</span>";
      })
      .join("");
    box.innerHTML = '<span class="obj-label">下一步建议</span>' + chips;
  }

  function renderProgress() {
    const p = state.board.progress;
    const pct = p.total ? Math.round((p.unlocked / p.total) * 100) : 0;
    $("#progress-fill").style.width = pct + "%";
    $("#progress-text").textContent =
      p.unlocked + "/" + p.total + " 线索 · " + p.info + " 信息 / " + p.world + " 世界观";
  }

  function renderMilestoneTray() {
    $("#milestone-tray").innerHTML = state.board.milestones
      .map((m) => {
        // 未达成的里程碑只显示状态，不显示名字（名字本身剧透）
        const label = m.got ? "✦ " + m.name : "○ 未达成";
        return '<div class="ms-chip' + (m.got ? " got" : "") + '" title="' + m.desc + '">' + label + "</div>";
      })
      .join("");
  }

  function updateSelectionPreview() {
    const K = keyword();
    const btn = $("#btn-unlock");
    $("#selection-preview").textContent = K
      ? "已选字：「" + K + "」" + (state.target ? "" : " · 再选一个指向")
      : "已选字：（空）";
    btn.classList.remove("ready", "warn", "near");
    if (K) btn.classList.add(state.target ? "ready" : "warn");
    btn.disabled = state.busy;
  }

  function flashTargets() {
    const box = $("#target-chips");
    box.classList.remove("flash");
    void box.offsetWidth;
    box.classList.add("flash");
    setTimeout(() => box.classList.remove("flash"), 900);
  }

  /* ---------------- 提交判定 ---------------- */

  function nextStepText() {
    const targets = state.board.readyTargets || [];
    if (!targets.length) return "线索都揭得差不多了——把拼出的碎片再串一遍，真相就在眼前。";
    const names = targets
      .filter((t) => t.target !== "world")
      .map((t) => {
        const ch = charById(t.target);
        return "【" + (ch ? ch.name : "？？？") + "】";
      });
    const hasWorld = targets.some((t) => t.target === "world");
    if (names.length && hasWorld) return "下一步：" + names.join("、") + " 那边还有话没说完，也可以把词指向【世界观】。";
    if (hasWorld) return "下一步：还有一条世界设定没被认领——从已解锁的原话里挑个词，指向【世界观】。";
    return "下一步：" + names[0] + " 那边还有话没说完——把点出来的词指过去。";
  }

  async function attemptUnlock() {
    if (state.busy || !state.board) return;
    if (state.board.ended) {
      guide("这一局的真相已经说完了——按「重开」可以再来一次。");
      return;
    }

    const K = keyword().trim();
    const T = state.target;
    if (!K) { guide("先从展开的信息条里点出可疑的字。"); return; }
    if (!T) { guide("再选一个【指向】——点下方的人物或「世界观」，才能解锁。"); flashTargets(); return; }

    // 连线动画起点：词是从哪个人物的信息条里挖出来的
    let sourceCharId = null;
    if (state.selections.length) {
      const first = infoById(state.selections[0].cardId);
      if (first) sourceCharId = first.char;
    }

    setBusy(true);
    try {
      const res = await Api.attempt(state.sessionId, K, T);
      state.board = res.board;
      state.selections = [];
      state.target = null;

      // 收到了新信息的人物自动展开
      res.unlocked.forEach((u) => {
        const card = state.board.infoCards.find((c) => c.id === u.id);
        if (card) state.expanded.add(card.char);
      });

      renderAll();
      guide(res.reaction);

      if (res.unlocked.length >= 2) toast("🔓 双杀！两层线索同时解开");
      else if (res.unlocked.length === 1) toast("🔓 新线索已解锁");

      (res.milestones || []).forEach((m) => {
        setTimeout(() => toast("【里程碑 · " + m.name + "】" + m.desc), 420);
      });

      if (sourceCharId && sourceCharId !== T) drawLink(sourceCharId, T);
      else flashCard(sourceCharId || T);

      const focus = res.unlocked.length
        ? res.board.infoCards.find((c) => c.id === res.unlocked[0].id)
        : null;
      if (focus) {
        const el = document.querySelector('.char-card[data-char-id="' + focus.char + '"]');
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      if (res.ended) {
        setTimeout(showEnding, 1400);
      } else {
        setTimeout(() => { if (state.board && !state.board.ended) guide(nextStepText()); }, 1700);
      }
    } catch (err) {
      handleActionError(err);
    } finally {
      setBusy(false);
    }
  }

  function setBusy(flag) {
    state.busy = flag;
    const btn = $("#btn-unlock");
    if (btn) {
      btn.disabled = flag;
      btn.textContent = flag ? "判定中…" : "解锁";
    }
    document.body.classList.toggle("busy", flag);
  }

  function handleActionError(err) {
    const code = err && err.code;
    if (code === "SESSION_ENDED") { guide(err.message); return; }
    if (code === "RATE_LIMITED") { toast(err.message); return; }
    if (err && err.status >= 500) { toast("服务出了点问题，稍后再试一次"); return; }
    if (err && err.status === 0) { toast("连不上服务，检查一下后端是否还在运行"); return; }
    toast(err && err.message ? err.message : "请求失败");
  }

  /* ---------------- 提示 ---------------- */

  async function giveHint() {
    if (state.busy || !state.board) return;
    if (state.board.ended) { guide("真相已经揭晓了，去「回放」看看你的探索轨迹吧。"); return; }

    const currentCard = state.selections.length ? state.selections[0].cardId : null;
    setBusy(true);
    try {
      const res = await Api.hint(state.sessionId, currentCard);
      const tag =
        res.level >= res.totalLevels
          ? "（最后一级提示）"
          : "（提示 " + res.level + "/" + res.totalLevels + "）";
      guide(res.text + "　" + tag);
      renderProgress();
    } catch (err) {
      handleActionError(err);
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- 连线 / 高亮 ---------------- */

  function flashCard(id) {
    const el = document.querySelector('.char-card[data-char-id="' + id + '"]');
    if (!el) return;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1500);
  }

  function drawLink(fromCharId, toTarget) {
    const layer = $("#link-layer");
    const src = document.querySelector('.char-card[data-char-id="' + fromCharId + '"]');
    const tgt = toTarget === "world"
      ? $("#world-panel")
      : document.querySelector('.char-card[data-char-id="' + toTarget + '"]');
    if (!src || !tgt) return;

    const a = src.getBoundingClientRect();
    const b = tgt.getBoundingClientRect();
    const x1 = a.left + a.width / 2, y1 = a.top + a.height / 2;
    const x2 = b.left + b.width / 2, y2 = b.top + b.height / 2;
    if (Math.abs(x1 - x2) < 4 && Math.abs(y1 - y2) < 4) { flashCard(fromCharId); return; }

    const ns = "http://www.w3.org/2000/svg";
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("class", "link-line");
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("r", 5);
    dot.setAttribute("class", "link-dot");
    dot.setAttribute("cx", x1); dot.setAttribute("cy", y1);
    layer.appendChild(line);
    layer.appendChild(dot);

    if (typeof dot.animate === "function") {
      dot.animate(
        [{ cx: x1, cy: y1 }, { cx: x2, cy: y2 }],
        { duration: 680, easing: "ease-in-out", fill: "forwards" }
      );
    }
    setTimeout(() => {
      line.classList.add("fade");
      dot.classList.add("fade");
      setTimeout(() => { line.remove(); dot.remove(); }, 650);
    }, 720);
  }

  /* ---------------- 结局 / 回放 ---------------- */

  const VERDICT_CN = {
    success: "解锁成功", double: "双杀", fail: "未命中", blocked: "前置不足",
    worldview: "世界观不足", reveal: "新人物登场", milestone: "里程碑", hint: "提示", ending: "结局"
  };

  function fmtDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return m > 0 ? m + " 分 " + (s % 60) + " 秒" : s + " 秒";
  }

  function showEnding() {
    const b = state.board;
    if (!b || !b.ending) return;
    state.endingShown = true;
    const submits = b.stats.submitCount || 0;
    $("#ending-modal").innerHTML =
      '<div class="modal-box ending">' +
      "<h3>✦ 真相揭晓</h3>" +
      '<p class="ending-text">' + b.ending.text + "</p>" +
      '<div class="ending-grid">' +
      '<div class="ending-cell"><b>' + fmtDuration(Date.now() - state.arrivedAt) + "</b><span>用 时</span></div>" +
      '<div class="ending-cell"><b>' + submits + "</b><span>提交次数</span></div>" +
      '<div class="ending-cell"><b>' + b.progress.unlocked + "/" + b.progress.total + "</b><span>线索</span></div>" +
      '<div class="ending-cell"><b>' + (b.stats.hintCount || 0) + "</b><span>用提示</span></div>" +
      '<div class="ending-cell"><b>' + b.milestones.filter((m) => m.got).length + "/" + b.milestones.length + "</b><span>里程碑</span></div>" +
      "</div>" +
      (b.ending.bonusTotal
        ? '<p class="ending-stat">隐藏线索 ' + b.ending.bonusHit + "/" + b.ending.bonusTotal + "</p>"
        : "") +
      '<button class="modal-close" onclick="closeModal(\'ending-modal\'); restartGame()">再来一局</button>' +
      '<button class="modal-close plain" onclick="closeModal(\'ending-modal\'); openReplay()">看回放</button>' +
      "</div>";
    $("#ending-modal").classList.remove("hidden");
  }

  async function openReplay() {
    const modal = $("#replay-modal");
    modal.innerHTML = '<div class="modal-box"><h3>本局回放</h3><p class="r-note">读取中…</p></div>';
    modal.classList.remove("hidden");
    try {
      const data = await Api.replay(state.sessionId);
      let html = '<div class="modal-box"><h3>本局回放 · ' + data.attempts.length + ' 回合</h3><div class="replay-list">';
      if (!data.attempts.length) html += '<p class="r-note">还没有任何操作。</p>';
      data.attempts.forEach((a) => {
        html +=
          '<div class="replay-row">' +
          '<span class="r-round">#' + a.round + "</span>" +
          '<span class="r-verdict">' + (VERDICT_CN[a.verdict] || a.verdict) + "</span>" +
          '<span class="r-kw">「' + a.keyword + "」→ " + a.targetName + "</span>" +
          '<span class="r-note">' + (a.detail || "") + "</span>" +
          "</div>";
      });
      html +=
        '</div><button class="modal-close" onclick="closeModal(\'replay-modal\')">关闭</button>' +
        '<button class="modal-close plain" onclick="downloadReplay()">下载 JSON</button></div>';
      modal.innerHTML = html;
    } catch (err) {
      modal.innerHTML =
        '<div class="modal-box"><h3>回放读取失败</h3><p class="r-note">' +
        (err && err.message ? err.message : "请稍后重试") +
        '</p><button class="modal-close" onclick="closeModal(\'replay-modal\')">关闭</button></div>';
    }
  }

  window.openReplay = openReplay;
  window.downloadReplay = async function () {
    try {
      const data = await Api.replay(state.sessionId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "词钥-回放-" + Date.now() + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      toast("下载失败");
    }
  };

  /* ---------------- 开局 / 重开 ---------------- */

  function resetLocalState() {
    state.selections = [];
    state.target = null;
    state.expanded = new Set();
    state.coachDone = false;
    state.arrivedAt = Date.now();
    state.endingShown = false;
  }

  async function startNewSession() {
    const res = await Api.createSession();
    state.sessionId = res.sessionId;
    state.board = res.board;
    resetLocalState();
    renderAll();
    guide(state.board.scenario.intro);
  }

  window.restartGame = async function () {
    if (!state.board) return;
    if (!state.board.ended && !window.confirm("确定重开一局？当前进度会留在旧对局里。")) return;
    try {
      await startNewSession();
      toast("已重开一局");
      const game = document.getElementById("game");
      if (game) game.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      handleActionError(err);
    }
  };

  function showOfflineNotice(tried) {
    const app = document.getElementById("app");
    app.innerHTML =
      '<div class="offline-card">' +
      "<h2>连不上服务</h2>" +
      "<p>这一版的前端不携带任何剧本内容——判定、线索、存档都在后端。请先把服务跑起来：</p>" +
      "<pre>cd 词钥-server\nnpm install\nnpm run seed\nnpm start</pre>" +
      '<p class="muted">默认地址 http://127.0.0.1:8787，启动后刷新本页即可。' +
      (tried && tried.length ? "<br />已尝试：" + tried.map((b) => b || location.origin).join("、") : "") +
      "</p>" +
      '<button class="modal-close" onclick="location.reload()">重试</button>' +
      "</div>";
  }

  async function init() {
    $("#btn-unlock").onclick = attemptUnlock;
    $("#btn-hint").onclick = giveHint;
    $("#btn-clear").onclick = () => { state.selections = []; renderCanvas(); updateSelectionPreview(); };
    $("#btn-replay").onclick = openReplay;
    $("#btn-restart").onclick = window.restartGame;

    const conn = await Api.connect();
    if (!conn.ok) {
      showOfflineNotice(conn.tried);
      return;
    }

    // 有旧对局就续上（进度在服务端），没有就开新的
    const stored = Api.storedSession();
    if (stored) {
      try {
        const board = await Api.getBoard(stored);
        state.board = board;
        state.sessionId = stored;
        resetLocalState();
        renderAll();
        guide(board.ended ? "这一局已经走到结局了，按「重开」可以再来一次。" : board.scenario.intro);
        if (board.ended) setTimeout(showEnding, 500);
        return;
      } catch (e) {
        Api.forgetSession();
      }
    }

    try {
      await startNewSession();
    } catch (err) {
      showOfflineNotice([Api.base]);
    }
  }

  function renderAll() {
    if (!state.board) return;
    renderCanvas();
    renderWorldPanel();
    renderTargetChips();
    renderObjective();
    renderProgress();
    renderMilestoneTray();
    updateSelectionPreview();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
