// Support Triage Desk frontend

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const icon = (id) => `<svg><use href="#${id}"/></svg>`;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const PRI = { urgent: "urgent", high: "high", normal: "normal", low: "low" };
const ACTION = { reply_sent: "Reply sent", escalated: "Escalated", info_requested: "Information requested" };
let current = { name: null, text: "" };

function stripHeaders(text) {
  return text.split("\n").filter((l) => !/^(from|subject|to|order|channel)\s*:/i.test(l.trim())).join("\n").trim();
}

async function loadTickets() {
  let items = [];
  try { items = await (await fetch("/api/tickets")).json(); } catch (e) { return; }
  $("#inbox-count").textContent = items.length;
  const list = $("#ticket-list");
  list.innerHTML = "";
  items.forEach((t) => {
    const li = el("li", "ticket");
    li.dataset.name = t.name;
    li.innerHTML = `<div class="t-top"><span class="t-from">${esc(t.from || "Customer")}</span><span class="pri-dot"></span></div>
      <div class="t-subj">${esc(t.subject || "(no subject)")}</div>
      <div class="t-snip">${esc(t.snippet || "")}</div>`;
    li.onclick = () => selectTicket(t.name, li);
    list.appendChild(li);
  });
}

async function selectTicket(name, li) {
  document.querySelectorAll(".ticket").forEach((x) => x.classList.remove("active"));
  li.classList.add("active");
  current.name = name;
  try { const d = await (await fetch("/api/ticket/" + encodeURIComponent(name))).json(); current.text = d.text || ""; }
  catch (e) { current.text = ""; }

  const detail = $("#detail");
  detail.innerHTML = `<div class="detail-wrap">
    <div class="panel"><h3>${icon("i-user")} Conversation</h3>
      <div class="msg"><span class="av">${icon("i-user")}</span><div><div class="who">Customer</div><div class="bubble">${esc(stripHeaders(current.text))}</div></div></div></div>
    <div class="scan"><span class="spinner"></span><span id="scan-status">Triaging ticket...</span></div>
  </div>`;

  const fd = new FormData();
  fd.append("ticket", name);
  let job;
  try { job = await (await fetch("/api/process", { method: "POST", body: fd })).json(); }
  catch (e) { return scanError("Could not reach the server."); }
  if (!job || !job.job_id) return scanError("The server did not start a job.");

  let done = false;
  const es = new EventSource("/api/events/" + job.job_id);
  es.onmessage = (msg) => {
    let ev; try { ev = JSON.parse(msg.data); } catch (e) { return; }
    if (ev.type === "progress") { const s = $("#scan-status"); if (s) s.textContent = ev.status; }
    else if (ev.type === "result") { done = true; es.close(); render(ev.data, li); }
    else if (ev.type === "error") { done = true; es.close(); scanError(ev.message); }
  };
  es.onerror = () => { es.close(); if (!done) scanError("Lost connection during triage. Please retry."); };
}

function scanError(message) {
  const scan = document.querySelector(".scan");
  if (scan) scan.outerHTML = `<div class="panel"><h3>${icon("i-alert")} Could not triage</h3><p class="muted">${esc(message)}</p><p class="muted">Confirm OPENAI_API_KEY is set in .env, then click the ticket again.</p></div>`;
}

function render(d, li) {
  const tr = d.triage || {}, kn = d.knowledge || {}, res = d.resolution || {};
  if (li) { const dot = li.querySelector(".pri-dot"); if (dot) dot.style.background = `var(--${PRI[tr.priority] || "low"})`; }

  const wrap = el("div", "detail-wrap");

  // conversation
  const conv = el("div", "panel");
  conv.innerHTML = `<h3>${icon("i-user")} Conversation</h3>
    <div class="msg"><span class="av">${icon("i-user")}</span><div><div class="who">${esc(tr.customer_name || "Customer")}${tr.order_id ? " · " + esc(tr.order_id) : ""}</div><div class="bubble">${esc(stripHeaders(current.text))}</div></div></div>
    <div class="agent-slot"></div>`;
  wrap.appendChild(conv);

  // triage
  const sent = (tr.sentiment || "neutral").toLowerCase(), pri = (tr.priority || "normal").toLowerCase();
  wrap.appendChild(el("div", "panel", `<h3>Triage</h3>
    <div class="chips">
      <span class="chip"><b>Intent:</b> ${esc(tr.intent || "—")}</span>
      <span class="chip"><b>Category:</b> ${esc(tr.category || "—")}</span>
      <span class="chip sent-${sent}"><b>Sentiment:</b> ${esc(tr.sentiment || "—")}</span>
      <span class="chip pri-${pri}"><b>Priority:</b> ${esc(tr.priority || "—")}</span>
    </div>
    <p class="summary">${esc(tr.summary || "")}</p>
    ${(tr.missing_info || []).length ? `<div class="miss chips"><span class="muted" style="font-size:12.5px">Missing:</span>${tr.missing_info.map((m) => `<span class="chip">${esc(m)}</span>`).join("")}</div>` : ""}`));

  // knowledge
  wrap.appendChild(el("div", "panel", `<h3>${icon("i-book")} Knowledge base</h3>
    ${(kn.kb_hits || []).map((k) => `<div class="kb"><div class="k-id">${esc(k.id)} · ${esc(k.title)}</div><div class="k-quote">${esc(k.quote)}</div></div>`).join("") || `<p class="muted">No matching article.</p>`}
    ${kn.resolution_outline ? `<p class="summary">${esc(kn.resolution_outline)}</p>` : ""}`));

  // composer
  const comp = el("div", "panel composer");
  comp.innerHTML = `<h3>${icon("i-send")} Drafted reply</h3>
    <div class="action-row">
      <span class="act-badge">${esc((res.suggested_action || "answer").replace(/_/g, " "))}</span>
      <span class="conf">confidence ${res.confidence != null ? Math.round(res.confidence * 100) + "%" : "—"}</span>
      ${res.requires_human_review ? `<span class="review-flag">${icon("i-alert")} needs review</span>` : ""}
    </div>
    <label>Subject</label><input class="r-subj" value="${esc(res.reply_subject || "")}">
    <label>Message</label><textarea class="r-msg" rows="7">${esc(res.reply_message || "")}</textarea>
    ${res.internal_note ? `<p class="internal">Internal: ${esc(res.internal_note)}</p>` : ""}
    <div class="note-field"><label>Note (optional)</label><textarea class="r-note" rows="2" placeholder="Internal note for the audit trail"></textarea></div>
    <div class="actions"><button class="btn-send">${icon("i-send")} Send reply</button><button class="btn-esc">${icon("i-up")} Escalate</button></div>
    <div class="decision-made muted"></div>`;
  wrap.appendChild(comp);

  // audit
  wrap.appendChild(el("div", "panel", `<h3>${icon("i-clip")} Audit trail</h3><div class="audit">` +
    (d.audit_log || []).map((e) => `<div><span class="a-time">[${esc(e.timestamp)}]</span> <span class="a-agent">${esc(e.agent)}</span>: ${esc(e.summary)}</div>`).join("") + `</div>`));

  $("#detail").innerHTML = "";
  $("#detail").appendChild(wrap);

  const note = comp.querySelector(".decision-made"), sendBtn = comp.querySelector(".btn-send"), escBtn = comp.querySelector(".btn-esc");
  function appendAudit(summary) {
    const a = wrap.querySelector(".audit"); if (!a) return;
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    a.appendChild(el("div", null, `<span class="a-time">[${ts}]</span> <span class="a-agent">Agent</span>: ${esc(summary)}`));
  }
  async function finalize(decision) {
    sendBtn.disabled = escBtn.disabled = true;
    note.style.color = "var(--muted)"; note.innerHTML = `<span class="spinner" style="width:13px;height:13px;display:inline-block;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;vertical-align:-1px"></span> Processing...`;
    const reply = comp.querySelector(".r-msg").value, rnote = comp.querySelector(".r-note").value.trim();
    try {
      const fin = await (await fetch("/api/finalize", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, triage: d.triage, resolution: d.resolution, reply, note: rnote }) })).json();
      if (fin.error) { note.textContent = "Could not finalize: " + fin.error; note.style.color = "var(--urgent)"; sendBtn.disabled = escBtn.disabled = false; return; }
      note.textContent = "";
      appendAudit(`${decision}${rnote ? " · note: " + rnote : ""}`);
      // append agent bubble if sent
      if (decision === "approved" && fin.action === "reply_sent") {
        conv.querySelector(".agent-slot").innerHTML = `<div class="msg agent" style="margin-top:12px"><span class="av">${icon("i-send")}</span><div><div class="who">Support · sent</div><div class="bubble">${esc(reply)}</div></div></div>`;
      }
      outcome(fin, wrap, { sendBtn, escBtn, note });
    } catch (e) { note.textContent = "Could not finalize. Please retry."; note.style.color = "var(--urgent)"; sendBtn.disabled = escBtn.disabled = false; }
  }
  sendBtn.onclick = () => finalize("approved");
  escBtn.onclick = () => finalize("rejected");
}

function outcome(fin, wrap, ctrl) {
  const esc_ = fin.action !== "reply_sent";
  const p = el("div", "panel outcome" + (esc_ ? " esc" : ""));
  p.innerHTML = `<h3>${icon(esc_ ? "i-up" : "i-check")} Outcome</h3>
    <p style="font-weight:600">${esc(ACTION[fin.action] || fin.action || "")}</p>
    <p class="summary">${esc(fin.action_summary || "")}</p>
    ${(fin.next_steps || []).length ? `<ul class="points">${fin.next_steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <div class="actions"><button class="btn-ghost btn-reopen">${icon("i-redo")} Reopen</button></div>`;
  p.querySelector(".btn-reopen").onclick = () => { p.remove(); if (ctrl) { ctrl.sendBtn.disabled = false; ctrl.escBtn.disabled = false; ctrl.note.textContent = ""; } };
  wrap.appendChild(p);
  p.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

loadTickets();

/* ============================================================
   Bring-your-own OpenAI key (for public / self-hosted demo).
   Adds a top-bar button; stores the key in localStorage and
   sends it as X-OpenAI-Key on every /api/ request. The server
   uses it if present, otherwise falls back to its .env key.
   ============================================================ */
(function () {
  var KEY = "OPENAI_KEY";
  var _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {};
    var k = localStorage.getItem(KEY);
    if (k && typeof url === "string" && url.indexOf("/api/") === 0) {
      opts = Object.assign({}, opts);
      opts.headers = Object.assign({}, opts.headers || {}, { "X-OpenAI-Key": k });
    }
    return _fetch(url, opts);
  };

  var ACC = "var(--accent, var(--teal, var(--accent-deep, #2563eb)))";
  var CARD = "var(--card, var(--panel, var(--paper, #ffffff)))";
  var INK = "var(--ink, #1a1a1a)";
  var LINE = "var(--line, #dddddd)";
  var MUTED = "var(--muted, var(--slate, var(--muted-ink, #888888)))";
  var css =
    ".kk-btn{display:inline-flex;align-items:center;gap:7px;border:1px solid " + LINE + ";background:" + CARD + ";color:" + INK + ";font:inherit;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:999px;cursor:pointer}" +
    ".kk-btn:hover{border-color:" + ACC + "}" +
    ".kk-dot{width:8px;height:8px;border-radius:50%;background:#d9a33a}" +
    ".kk-dot.on{background:#2aa676}" +
    ".kk-ov{position:fixed;inset:0;background:rgba(10,15,20,.55);display:grid;place-items:center;z-index:99999;padding:20px}" +
    ".kk-card{background:" + CARD + ";color:" + INK + ";border:1px solid " + LINE + ";border-radius:14px;max-width:440px;width:100%;padding:24px;box-shadow:0 30px 80px -30px rgba(0,0,0,.5);font-family:inherit}" +
    ".kk-card h4{margin:0 0 6px;font-size:18px}" +
    ".kk-card p{margin:0 0 14px;font-size:13px;color:" + MUTED + "}" +
    ".kk-card input{width:100%;box-sizing:border-box;border:1px solid " + LINE + ";border-radius:10px;padding:11px 13px;font:inherit;font-size:14px;background:" + CARD + ";color:" + INK + "}" +
    ".kk-card input:focus{outline:none;border-color:" + ACC + "}" +
    ".kk-row{display:flex;gap:10px;margin-top:14px}" +
    ".kk-save{flex:1;border:none;cursor:pointer;background:" + ACC + ";color:#fff;border-radius:10px;padding:11px;font:inherit;font-weight:600}" +
    ".kk-clear{border:1px solid " + LINE + ";background:transparent;color:" + INK + ";border-radius:10px;padding:11px 16px;cursor:pointer;font:inherit;font-weight:600}" +
    ".kk-note{margin-top:12px;font-size:11.5px;color:" + MUTED + ";line-height:1.5}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement("button");
  btn.className = "kk-btn";
  btn.type = "button";
  function refresh() {
    var has = !!localStorage.getItem(KEY);
    btn.innerHTML = '<span class="kk-dot' + (has ? " on" : "") + '"></span>' + (has ? "API key set" : "Add API key");
  }
  function mount() {
    var h = document.querySelector(".nav-inner") || document.querySelector(".topbar");
    if (!h) {
      btn.style.position = "fixed"; btn.style.top = "14px"; btn.style.right = "16px"; btn.style.zIndex = "9998";
      document.body.appendChild(btn);
    } else {
      h.appendChild(btn);
    }
    refresh();
  }
  btn.onclick = function () {
    var ov = document.createElement("div"); ov.className = "kk-ov";
    var cur = localStorage.getItem(KEY) || "";
    var card = document.createElement("div"); card.className = "kk-card";
    card.innerHTML =
      "<h4>OpenAI API key</h4>" +
      "<p>Use your own key to run this demo. It is stored only in this browser and sent to your local server with each request.</p>" +
      '<input type="password" class="kk-in" placeholder="sk-..." autocomplete="off">' +
      '<div class="kk-row"><button class="kk-save" type="button">Save</button><button class="kk-clear" type="button">Clear</button></div>' +
      '<div class="kk-note">Stored in your browser (localStorage) on this device only. Never commit your key to the repo. If you leave this empty, the server uses its own .env key.</div>';
    ov.appendChild(card);
    card.querySelector(".kk-in").value = cur;
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    card.querySelector(".kk-save").onclick = function () {
      var v = card.querySelector(".kk-in").value.trim();
      if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY);
      refresh(); ov.remove();
    };
    card.querySelector(".kk-clear").onclick = function () { localStorage.removeItem(KEY); refresh(); ov.remove(); };
    document.body.appendChild(ov);
    card.querySelector(".kk-in").focus();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
