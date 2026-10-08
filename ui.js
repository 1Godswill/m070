/* St Stephen's Report Card System — UI layer */

function esc(s) { return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

const NO_CLASSES_HTML = `
  <div class="card">
    <h2>No classes yet</h2>
    <p style="font-size:13px;color:var(--muted);">Tap "+ Class" above to add your first class, then add students to it from the Students tab.</p>
  </div>
`;

function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

/* Pointer-based drag-and-drop reordering (works for mouse, touch and pen —
   unlike native HTML5 DnD, which most touch browsers don't support). Call
   after rendering a list of `.student-row[data-id]` elements inside
   `container`; each row needs a `.drag-handle` to grab. On drop, persists
   the new order for `classId` and re-renders. */
function enableDragReorder(container, classId) {
  container.querySelectorAll(".drag-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const row = handle.closest(".student-row");
      if (!row) return;
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      row.classList.add("dragging");

      function onMove(ev) {
        const rows = Array.from(container.querySelectorAll(".student-row")).filter((r) => r !== row);
        let target = null;
        for (const r of rows) {
          const rect = r.getBoundingClientRect();
          if (ev.clientY < rect.top + rect.height / 2) { target = r; break; }
        }
        if (target) container.insertBefore(row, target);
        else container.appendChild(row);
      }
      function onUp() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        row.classList.remove("dragging");
        const orderedIds = Array.from(container.querySelectorAll(".student-row")).map((r) => r.dataset.id);
        reorderStudentsInClass(classId, orderedIds);
        renderAll();
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  });
}

function gradeBadgeClass(g) { return "g" + (g || "F"); }

/* ================= STUDENT NAME TAGS ================= */
/* Each student gets a stable colour (hashed from their id) and a small
   initials avatar, so the same student is instantly recognisable by
   colour wherever their name appears — Students, Register, Score Entry
   and Class Report all render the same tag for a given student. */
const TAG_PALETTE = [
  { bg: "#e9f1fd", fg: "#2f6feb" }, // brand blue
  { bg: "#efeafe", fg: "#7c5cfc" }, // purple
  { bg: "#fdece0", fg: "#c96a1f" }, // orange
  { bg: "#e2f8ee", fg: "#178a5c" }, // green
  { bg: "#fdf1dd", fg: "#9a6c10" }, // gold
  { bg: "#fdeaf1", fg: "#c23764" }, // pink
  { bg: "#e3f4fb", fg: "#1c85ab" }, // teal
  { bg: "#eef0fb", fg: "#4a55c9" }, // indigo
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function tagColorFor(id) { return TAG_PALETTE[hashStr(id || "x") % TAG_PALETTE.length]; }

function initialsFor(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* Small vector (SVG) glyphs — crisp at any size, styled with currentColor
   so they always match the tag's colour. */
function iconSvg(name) {
  const icons = {
    male: `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8 21 3M21 3h-5M21 3v5"/><circle cx="10" cy="14" r="6"/></svg>`,
    female: `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="M12 15v6M9 19h6"/></svg>`,
    cap: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="M6 10.5V15c0 1.5 2.5 3 6 3s6-1.5 6-3v-4.5"/><path d="M22 8v6"/></svg>`,
    grip: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`,
  };
  return icons[name] || "";
}

/* Renders a coloured initials-avatar + name, optionally with a small
   gender glyph. `student` needs {id, name, gender}. */
function studentTag(student, opts) {
  opts = opts || {};
  const s = student || {};
  const c = tagColorFor(s.id);
  const genderIcon = s.gender ? iconSvg(s.gender === "M" ? "male" : "female") : "";
  const genderHtml = genderIcon ? `<span class="tag-gender" style="color:${c.fg};" title="${s.gender === "M" ? "Male" : "Female"}">${genderIcon}</span>` : "";
  return `<span class="student-tag${opts.className ? " " + opts.className : ""}">` +
    `<span class="tag-name">${esc(s.name || "(unnamed)")}</span>${genderHtml}</span>`;
}

/* Generic in-app print preview: shows one or more "page" boxes styled to
   roughly match A4 dimensions, with Print/Close controls, before the real
   browser print dialog opens. pagesHtml: array of HTML strings (one per page). */
/* Prints exactly the given pages. The old preview's Print button called window.print()
   with the preview hidden by the print stylesheet, so the browser printed whichever tab
   was underneath (e.g. the Admin screen, when exporting to PDF from Admin). Now the
   pages are copied into a print-only container (#printRoot), everything else on the page
   is hidden while printing, and the page size (A4 portrait/landscape) is set to match. */
function clearPrintArtifacts() {
  const old = document.getElementById("printRoot"); if (old) old.remove();
  const st = document.getElementById("printPageStyle"); if (st) st.remove();
  document.body.classList.remove("printing-preview");
}
function printPagesNow(pagesHtml, orientation) {
  clearPrintArtifacts();
  refreshPrintStamp();
  const root = document.createElement("div");
  root.id = "printRoot";
  root.innerHTML = pagesHtml.map((html, i) =>
    `<div class="print-page${i < pagesHtml.length - 1 ? " print-page-break" : ""}">${html}</div>`).join("");
  document.body.appendChild(root);
  const style = document.createElement("style");
  style.id = "printPageStyle";
  style.textContent = orientation === "landscape"
    ? "@page{size:A4 landscape;margin:10mm}" : "@page{size:A4 portrait;margin:12mm}";
  document.head.appendChild(style);
  document.body.classList.add("printing-preview");
  const done = () => { window.removeEventListener("afterprint", done); clearPrintArtifacts(); };
  window.addEventListener("afterprint", done);
  setTimeout(() => window.print(), 60);   // let the browser lay the pages out first
  setTimeout(done, 10 * 60 * 1000);       // safety net for browsers that never send afterprint
}
/* Plain print of the tab that is showing (Report Card / Broadsheet): make sure no
   leftover preview page size or container from an earlier print is still around. */
function printCurrentTab() { clearPrintArtifacts(); refreshPrintStamp(); window.print(); }

function openPrintPreview(pagesHtml, orientation) {
  if (!pagesHtml || pagesHtml.length === 0) {
    toast("Nothing to preview yet");
    return;
  }
  const frameWidth = orientation === "landscape" ? 1122 : 793;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay preview-overlay no-print";
  overlay.innerHTML = `
    <div class="preview-box">
      <div class="preview-toolbar">
        <span>Print Preview${pagesHtml.length > 1 ? ` — ${pagesHtml.length} pages` : ""}</span>
        <div>
          <button class="btn small" id="previewPrintBtn">🖨 Print</button>
          <button class="btn small secondary" id="previewCloseBtn">Close</button>
        </div>
      </div>
      <div class="preview-scroll">
        ${pagesHtml.map((html) => `<div class="preview-page" style="width:${frameWidth}px;">${html}</div>`).join("")}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("previewCloseBtn").addEventListener("click", () => overlay.remove());
  document.getElementById("previewPrintBtn").addEventListener("click", () => printPagesNow(pagesHtml, orientation));
}

/* Generic "what's about to be exported" preview — used before any Excel/PDF
   export so a teacher/admin can eyeball the data first. sheetsHtml: array of
   {title, html} blocks (one per sheet/section). onExcel/onPdf: callbacks for
   the two export buttons (either can be omitted to hide that button). */
function openExportPreview(headline, sheetsHtml, onExcel, onPdf) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay preview-overlay no-print";
  overlay.innerHTML = `
    <div class="preview-box">
      <div class="preview-toolbar">
        <span>👁 Export Preview — ${esc(headline)}</span>
        <div>
          ${onExcel ? `<button class="btn small" id="prevExcelBtn">⬇ Excel</button>` : ""}
          ${onPdf ? `<button class="btn small" id="prevPdfBtn">📄 PDF</button>` : ""}
          <button class="btn small secondary" id="prevCloseBtn">Close</button>
        </div>
      </div>
      <div class="preview-scroll">
        ${sheetsHtml.map((s) => `<div class="preview-page" style="width:100%;max-width:820px;padding:16px;">
          <h3 style="margin:0 0 8px;font-size:14px;color:var(--tabAccentDark, var(--green-dark));">${esc(s.title)}</h3>
          ${s.html}
        </div>`).join("")}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("prevCloseBtn").addEventListener("click", () => overlay.remove());
  if (onExcel) document.getElementById("prevExcelBtn").addEventListener("click", () => { overlay.remove(); onExcel(); });
  if (onPdf) document.getElementById("prevPdfBtn").addEventListener("click", () => { overlay.remove(); onPdf(); });
}

/* ---------------- Frozen header/nav/class-bar stack ---------------- */
/* Header, nav and the class selector bar are all position:fixed in CSS so
   they never scroll away — no need to scroll up to reach the tabs. This
   measures their real (possibly wrapped) heights and stacks them precisely,
   then pads <main> so content starts right below the stack. */
function layoutFixedStack() {
  const header = document.querySelector("header");
  const nav = document.getElementById("tabs");
  const classBar = document.getElementById("classBar");
  const main = document.querySelector("main");
  if (!header || !nav || !classBar || !main) return;
  const headerH = header.offsetHeight;
  nav.style.top = headerH + "px";
  const navH = nav.offsetHeight;
  classBar.style.top = (headerH + navH) + "px";
  const classBarH = classBar.offsetHeight;
  main.style.paddingTop = (headerH + navH + classBarH + 12) + "px";
}
window.addEventListener("load", layoutFixedStack);
window.addEventListener("resize", () => { clearTimeout(layoutFixedStack._t); layoutFixedStack._t = setTimeout(layoutFixedStack, 80); });
window.addEventListener("orientationchange", layoutFixedStack);
if (window.ResizeObserver) {
  document.addEventListener("DOMContentLoaded", () => {
    const ro = new ResizeObserver(() => layoutFixedStack());
    ["header", "#tabs", "#classBar"].forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) ro.observe(el);
    });
  });
}

/* ---------------- Tab switching ----------------
   activateTab() is also called directly by login.js (picking a class,
   or the Admin shortcut on the login gate) — not just by tapping a tab. */
function activateTab(tabId) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === tabId));
  const targetTab = document.getElementById(tabId);
  if (targetTab) applyBodyTheme(targetTab.dataset.theme);
  renderAll();
  layoutFixedStack();
}
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  activateTab(btn.dataset.tab);
});

function applyBodyTheme(themeClass) {
  if (!themeClass) return;
  const body = document.body;
  Array.from(body.classList).forEach((c) => { if (c.startsWith("theme-")) body.classList.remove(c); });
  body.classList.add(themeClass);
}

/* A background sync (or any other change arriving from elsewhere) calls
   renderAll(), which rebuilds every tab's markup from scratch via
   innerHTML — including whatever field the person is mid-typing in right
   now. That destroys the input element, which on mobile closes the
   keyboard even though nothing about the render was actually about that
   field. These two functions bookend a render: capture what's focused
   and what's been typed into it before rebuilding, then find the
   equivalent field afterwards and put focus, the in-progress text (which
   the rebuild can't know about — it only reflects committed storage) and
   the cursor position back. */
function captureFocusedFieldState() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const tag = el.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return null;
  return {
    id: el.id || null,
    tag: tag,
    className: el.className || "",
    dataset: Object.assign({}, el.dataset),
    value: el.value,
    selectionStart: (typeof el.selectionStart === "number") ? el.selectionStart : null,
    selectionEnd: (typeof el.selectionEnd === "number") ? el.selectionEnd : null,
  };
}
function restoreFocusedFieldState(info) {
  if (!info) return;
  let candidate = info.id ? document.getElementById(info.id) : null;
  if (!candidate && info.className) {
    const firstClass = info.className.split(/\s+/).filter(Boolean)[0];
    if (firstClass) {
      const pool = Array.from(document.querySelectorAll("." + firstClass));
      const keys = Object.keys(info.dataset);
      candidate = pool.find((e) => e.tagName === info.tag && keys.every((k) => e.dataset[k] === info.dataset[k])) || null;
    }
  }
  if (!candidate) return;
  // Put back whatever was typed since the last committed value — the
  // fresh render only knows about what was already saved.
  if (typeof info.value === "string" && candidate.value !== info.value) candidate.value = info.value;
  candidate.focus();
  if (info.selectionStart !== null && candidate.setSelectionRange) {
    try { candidate.setSelectionRange(info.selectionStart, info.selectionEnd); } catch (e) { /* not all input types support this */ }
  }
}

/* A synced-triggered rebuild replaces the whole DOM tree, which resets
   scroll position even though the currently-focused field's value and
   cursor survive (see above) — so if you'd scrolled down a long class
   list, the rebuild could visibly snap you back to the top. Capture/
   restore both the page scroll and every scrollable table wrapper's
   scroll position around the rebuild too. */
function captureScrollState() {
  const wraps = Array.from(document.querySelectorAll(".subtable-wrap"));
  return { windowX: window.scrollX, windowY: window.scrollY, wraps: wraps.map((w) => w.scrollTop) };
}
function restoreScrollState(state) {
  if (!state) return;
  const wraps = Array.from(document.querySelectorAll(".subtable-wrap"));
  state.wraps.forEach((top, i) => { if (wraps[i]) wraps[i].scrollTop = top; });
  window.scrollTo(state.windowX, state.windowY);
}

/* Only the tab on screen is rebuilt. (v3.3.x rebuilt all seven tabs — including the
   Broadsheet and every report calculation — after every single edit and every sync,
   even though six of them were hidden.) Switching tabs calls renderAll() again, so a tab
   is always fresh by the time you see it. */
const TAB_RENDERERS = {
  students: () => renderStudents(),
  registertab: () => renderRegister(),
  scoreentry: () => renderScoreEntry(),
  classreport: () => renderClassReport(),
  reportcard: () => renderReportCard(),
  broadsheet: () => renderBroadsheet(),
  admintab: () => { if (typeof renderAdminTab === "function") renderAdminTab(); },
};
function renderAll() {
  enforceUppercaseData();
  renderLoginGate();
  const focusState = captureFocusedFieldState();
  const scrollState = captureScrollState();
  renderClassBar();
  const active = document.querySelector(".tab.active");
  const draw = active && TAB_RENDERERS[active.id];
  if (draw) draw(); else Object.keys(TAB_RENDERERS).forEach((k) => TAB_RENDERERS[k]());
  restoreFocusedFieldState(focusState);
  restoreScrollState(scrollState);
}

/* ================= CLASS BAR (persistent, all tabs) =================
   Shows which class is open and a way back to the login gate to pick a
   different one. Adding a class is now an Admin-only action (see
   admin.js) — this bar no longer offers it directly. */
function renderClassBar() {
  const el = document.getElementById("classBar");
  const currentId = getCurrentClassId();
  const cls = loadClasses().find((c) => c.id === currentId);
  el.innerHTML = `
    <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;font-size:13.5px;">${esc(cls ? cls.name : "No class selected")}</div>
    <button type="button" class="btn small secondary" id="switchClassBtn">⇄ Switch Class</button>
  `;
  document.getElementById("switchClassBtn").addEventListener("click", openGateAtPicker);
}

/* Shared "this class is locked" screen — used by every tab that works on
   class-specific data. Returns true (and renders the lock screen) if the
   tab should stop rendering; false if it's fine to continue normally. */
function guardClassLock(el, classId) {
  if (isClassUnlocked(classId)) return false;
  const cls = loadClasses().find((c) => c.id === classId);
  el.innerHTML = `
    <div class="card">
      <h2>🔒 ${esc(cls ? cls.name : "This class")} is locked</h2>
      <p style="font-size:13px;color:var(--muted);">Enter the access code set for this class by the admin to continue.</p>
      <div class="row">
        <input type="password" id="classCodeInput" placeholder="Access code" style="padding:8px;">
        <button class="btn" id="classCodeBtn">Unlock</button>
      </div>
    </div>
  `;
  const tryUnlock = () => {
    const code = el.querySelector("#classCodeInput").value;
    if (unlockClassWithCode(classId, code)) { toast("Class unlocked"); renderAll(); }
    else toast("Incorrect code");
  };
  // Look inside THIS tab's screen only. Every locked tab has a box with these same ids; using
  // document-wide lookups made all of them read and wire up the first one (on the Students
  // tab), so on every other tab typing the right code and tapping Unlock did nothing.
  el.querySelector("#classCodeBtn").addEventListener("click", tryUnlock);
  el.querySelector("#classCodeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
  return true;
}

/* ================= STUDENTS TAB ================= */
function renderStudents() {
  const el = document.getElementById("students");
  const classId = getCurrentClassId();
  if (!classId) { el.innerHTML = NO_CLASSES_HTML; return; }
  if (guardClassLock(el, classId)) return;
  const cls = loadClasses().find((c) => c.id === classId);
  const students = studentsInClass(classId);
  const ann = classId ? getAnnouncementFor(classId) : { text: "" };
  const announcementHtml = ann.text ? `
    <div class="card" style="background:var(--warning-bg);border-left:4px solid var(--warning);">
      <h2 style="margin:0 0 6px;color:#9a6c10;">📢 Announcement</h2>
      <div style="white-space:pre-wrap;font-size:13.5px;">${esc(ann.text)}</div>
    </div>` : "";
  el.innerHTML = `
    ${announcementHtml}
    <div class="card">
      <h2>Students — ${esc(cls ? cls.name : "")} (${students.length})</h2>
      <p style="font-size:12px;color:var(--muted);margin:-4px 0 10px;">Drag ${iconSvg("grip")} to match your paper register's order — that order carries through to Register and Score Entry.</p>
      <div id="studentList"></div>
      <button class="btn" id="addStudentBtn">+ Add Student</button>
    </div>
    <div class="card">
      <h2>Class Details</h2>
      <label>Session (e.g. 2025/2026)</label>
      <input type="text" id="sessionInput" value="${esc(cls ? cls.session || "" : "")}" placeholder="2025/2026">
      <div class="grid2">
        <div>
          <label>Next Term Begins</label>
          <input type="date" id="nextTermBeginsInput" value="${esc(cls ? cls.nextTermBegins || "" : "")}">
        </div>
        <div>
          <label>Next Term Ends</label>
          <input type="date" id="nextTermEndsInput" value="${esc(cls ? cls.nextTermEnds || "" : "")}">
        </div>
      </div>
      <button class="btn danger" id="deleteClassBtn" style="margin-top:10px;">Delete This Class</button>
    </div>
  `;
  const list = document.getElementById("studentList");
  if (students.length === 0) {
    list.innerHTML = `<div class="empty">No students yet in this class. Add your class list below.</div>`;
  } else {
    list.innerHTML = students.map((s, i) => {
      return `
      <div class="row student-row" data-id="${esc(s.id)}" style="margin-bottom:8px;align-items:center;">
        <span class="sn-badge" style="flex:0 0 auto;min-width:20px;text-align:right;color:var(--muted);font-size:12px;font-weight:600;">${i + 1}.</span>
        <input type="text" value="${esc(s.name)}" data-id="${esc(s.id)}" data-field="name" class="student-input" placeholder="Name" style="flex:2;">
        <select data-id="${esc(s.id)}" data-field="gender" class="student-input" style="flex:1;">
          <option value="" ${!s.gender ? "selected" : ""}>—</option>
          <option value="M" ${s.gender === "M" ? "selected" : ""}>M</option>
          <option value="F" ${s.gender === "F" ? "selected" : ""}>F</option>
        </select>
        <button class="btn danger small" data-del="${esc(s.id)}">Remove</button>
        <span class="drag-handle" title="Drag to reorder">${iconSvg("grip")}</span>
      </div>
    `;
    }).join("");
    enableDragReorder(list, classId);
  }
  document.getElementById("addStudentBtn").addEventListener("click", () => {
    const s = loadStudents();
    const nextOrder = studentsInClass(classId).length;
    s.push({ id: newId(), name: "", gender: "", classId: classId, order: nextOrder });
    saveStudents(s);
    renderAll();
  });
  list.querySelectorAll(".student-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const s = loadStudents();
      const rec = s.find((x) => x.id === inp.dataset.id);
      if (rec) rec[inp.dataset.field] = inp.dataset.field === "name" ? inp.value.toUpperCase() : inp.value;
      saveStudents(s);
      renderAll();
    });
  });
  list.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const who = (loadStudents().find((x) => x.id === btn.dataset.del) || {}).name || "this student";
      if (!confirm(`Remove ${who}? Their scores and attendance are deleted with them. You can undo this from the Admin tab (Deleted Items).`)) return;
      if (deleteStudent(btn.dataset.del)) toast("Removed — undo from Admin › Deleted Items");
      renderAll();
    });
  });
  function updateClassField(field, value) {
    const list2 = loadClasses();
    const rec = list2.find((c) => c.id === classId);
    if (rec) rec[field] = value;
    saveClasses(list2);
  }
  document.getElementById("sessionInput").addEventListener("change", (e) => updateClassField("session", e.target.value.trim()));
  document.getElementById("nextTermBeginsInput").addEventListener("change", (e) => updateClassField("nextTermBegins", e.target.value));
  document.getElementById("nextTermEndsInput").addEventListener("change", (e) => updateClassField("nextTermEnds", e.target.value));
  document.getElementById("deleteClassBtn").addEventListener("click", () => {
    if (!confirm(`Delete "${cls.name}"? Its students, subjects, scores, register and announcement are all deleted with it. You can undo this from the Admin tab (Deleted Items).`)) return;
    if (deleteClass(classId)) toast("Class deleted — undo from Admin › Deleted Items");
    renderAll();
  });
}

/* ================= SCORE ENTRY TAB ================= */
let scoreEntryState = { subject: null, term: "1" };

function renderScoreEntry() {
  const el = document.getElementById("scoreentry");
  const classId = getCurrentClassId();
  if (!classId) { el.innerHTML = NO_CLASSES_HTML; return; }
  if (guardClassLock(el, classId)) return;
  const students = studentsInClass(classId);
  const subjects = subjectsForClass(classId);
  if (!scoreEntryState.subject || !subjects.includes(scoreEntryState.subject)) {
    scoreEntryState.subject = subjects[0] || null;
  }

  el.innerHTML = `
    <div class="card">
      <h2>Score Entry</h2>
      <label>Subject</label>
      <div class="row">
        <select id="seSubject" ${subjects.length === 0 ? "disabled" : ""}>
          ${subjects.length === 0 ? `<option>No subjects yet — add one below</option>` :
            subjects.map((s) => `<option value="${esc(s)}" ${s === scoreEntryState.subject ? "selected" : ""}>${esc(s)}</option>`).join("")}
        </select>
      </div>
      <div class="row" style="margin-top:8px;">
        <input type="text" id="newSubjectInput" list="subjectSuggestions" placeholder="Add a subject (pick a suggestion or type your own)">
        <button class="btn small secondary" id="addSubjectBtn">+ Add</button>
      </div>
      ${subjects.length > 0 ? `<button class="btn danger small no-print" id="removeSubjectBtn" style="margin-top:8px;">Remove "${esc(scoreEntryState.subject || "")}" from this class</button>` : ""}
      <label style="margin-top:12px;">Term</label>
      <select id="seTerm">
        ${TERMS.map((t) => `<option value="${t}" ${t === scoreEntryState.term ? "selected" : ""}>TERM ${t}</option>`).join("")}
      </select>
      <div class="subtable-wrap" style="margin-top:12px;">
        <table>
          <thead><tr><th>SN</th><th>Student</th><th>Test1</th><th>Test2</th><th>Exam</th><th>Total</th><th>Pos</th><th>Grade</th><th title="Tick if this pupil does not take this subject (e.g. an elective they did not choose)">Not taking</th></tr></thead>
          <tbody id="seBody"></tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--muted);margin-top:8px;">Leave a box blank if a pupil was absent or the score is not in yet; type 0 for a real zero. Tick <b>Not taking</b> for a pupil who does not do this subject at all — they are left out of its ranking and class average, it does not appear on their report card, and their overall average uses only the subjects they take.</p>
    </div>
  `;
  const subjectSelect = document.getElementById("seSubject");
  if (subjects.length > 0) {
    subjectSelect.addEventListener("change", (e) => {
      scoreEntryState.subject = e.target.value;
      renderScoreEntry();
    });
  }
  document.getElementById("seTerm").addEventListener("change", (e) => {
    scoreEntryState.term = e.target.value;
    renderScoreEntryBody();
  });
  document.getElementById("addSubjectBtn").addEventListener("click", () => {
    const input = document.getElementById("newSubjectInput");
    const name = input.value.trim();
    if (!name) return;
    const finalName = addSubjectToClass(classId, name) || name;
    scoreEntryState.subject = finalName;
    toast(`"${finalName}" added`);
    renderScoreEntry();
  });
  const removeBtn = document.getElementById("removeSubjectBtn");
  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      if (!confirm(`Remove "${scoreEntryState.subject}" from this class? All scores already entered for it, in every term, are deleted with it. You can undo this from the Admin tab (Deleted Items).`)) return;
      if (removeSubjectFromClass(classId, scoreEntryState.subject)) toast("Subject removed — undo from Admin › Deleted Items");
      scoreEntryState.subject = null;
      renderScoreEntry();
    });
  }
  renderScoreEntryBody();

  function renderScoreEntryBody() {
    const body = document.getElementById("seBody");
    if (!body) return;
    if (students.length === 0) {
      body.innerHTML = `<tr><td colspan="9" class="empty">Add students first (Students tab).</td></tr>`;
      return;
    }
    if (!scoreEntryState.subject) {
      body.innerHTML = `<tr><td colspan="9" class="empty">Add a subject above first.</td></tr>`;
      return;
    }
    body.innerHTML = students.map((s, i) => {
      const row = subjectRowFor(classId, scoreEntryState.term, scoreEntryState.subject, s.id, students);
      const off = row.notTaking ? "disabled" : "";
      return `
        <tr data-row="${esc(s.id)}" ${row.notTaking ? 'style="opacity:.55;"' : ""}>
          <td>${i + 1}</td>
          <td>${studentTag(s)}</td>
          <td><input type="number" class="se-input" ${off} data-student="${esc(s.id)}" data-field="test1" value="${row.entered.test1 ? row.test1 : ""}" min="0" max="${SCORE_MAX.test1}" style="width:56px;padding:4px;"></td>
          <td><input type="number" class="se-input" ${off} data-student="${esc(s.id)}" data-field="test2" value="${row.entered.test2 ? row.test2 : ""}" min="0" max="${SCORE_MAX.test2}" style="width:56px;padding:4px;"></td>
          <td><input type="number" class="se-input" ${off} data-student="${esc(s.id)}" data-field="exam" value="${row.entered.exam ? row.exam : ""}" min="0" max="${SCORE_MAX.exam}" style="width:56px;padding:4px;"></td>
          <td class="se-total">${scoreEntryTotalHtml(row)}</td>
          <td class="se-pos">${row.hasAny ? row.position : "–"}</td>
          <td class="se-grade">${scoreEntryGradeHtml(row)}</td>
          <td><input type="checkbox" class="se-nt" data-student="${esc(s.id)}" ${row.notTaking ? "checked" : ""} title="Not taking this subject" style="width:20px;height:20px;"></td>
        </tr>
      `;
    }).join("");
    body.querySelectorAll(".se-nt").forEach((box) => {
      box.addEventListener("change", () => {
        setStudentNotTaking(box.dataset.student, scoreEntryState.subject, box.checked);
        renderAll();   // positions and averages change for everyone, so redraw
      });
    });
    body.querySelectorAll(".se-input").forEach((inp) => {
      inp.addEventListener("change", () => {
        const scores = loadScores();
        const term = scoreEntryState.term, subj = scoreEntryState.subject, studentId = inp.dataset.student;
        const field = inp.dataset.field;
        const raw = inp.value;
        const clamped = clampScoreValue(field, raw);
        if (raw !== "" && Number(raw) !== clamped) {
          const label = field === "exam" ? "Exam" : field === "test1" ? "Test1" : "Test2";
          toast(`${label} max is ${SCORE_MAX[field]} — adjusted`);
        }
        scores[classId] = scores[classId] || {};
        scores[classId][term] = scores[classId][term] || {};
        scores[classId][term][subj] = scores[classId][term][subj] || {};
        scores[classId][term][subj][studentId] = scores[classId][term][subj][studentId] || {};
        scores[classId][term][subj][studentId][field] = clamped;
        saveScores(scores);
        // Do NOT rebuild the table here. Rebuilding replaced every box, including the one
        // the teacher had just moved to, so after each score the cursor vanished and the next
        // number typed went nowhere. Only the calculated cells (Total / Position / Grade —
        // positions can shift for every pupil) are refreshed, and the edited box shows the
        // value that was actually saved (e.g. 75 typed in a /60 box becomes 60).
        inp.value = clamped === undefined ? "" : String(clamped);
        refreshScoreEntryComputed();
      });
    });
  }

  function refreshScoreEntryComputed() {
    const body = document.getElementById("seBody");
    if (!body) return;
    body.querySelectorAll("tr[data-row]").forEach((tr) => {
      const row = subjectRowFor(classId, scoreEntryState.term, scoreEntryState.subject, tr.dataset.row, students);
      tr.querySelector(".se-total").innerHTML = scoreEntryTotalHtml(row);
      tr.querySelector(".se-pos").textContent = row.hasAny ? row.position : "–";
      tr.querySelector(".se-grade").innerHTML = scoreEntryGradeHtml(row);
    });
  }
}
function scoreEntryTotalHtml(row) { return `<b>${row.hasAny ? row.total : "–"}</b>`; }
function scoreEntryGradeHtml(row) { return row.hasAny ? `<span class="badge ${gradeBadgeClass(row.grade)}">${row.grade}</span>` : "–"; }

/* ================= REGISTER / ATTENDANCE TAB ================= */
let registerState = { openEnrollId: null, term: "A" };

function renderRegister() {
  const el = document.getElementById("registertab");
  const classId = getCurrentClassId();
  if (!classId) { el.innerHTML = NO_CLASSES_HTML; return; }
  if (guardClassLock(el, classId)) return;
  const students = studentsInClass(classId);
  const rec = attendanceForClass(classId);
  const nWeeks = rec.schoolOpensPerWeek.length;
  const viewTerm = registerState.term;                       // "A" = whole year, else "1" | "2" | "3"
  const viewLabel = viewTerm === "A" ? "whole year" : termLabel(viewTerm);
  const visible = [];                                          // global week numbers (0-based) on screen
  for (let i = 0; i < nWeeks; i++) if (weekInView(classId, i, viewTerm)) visible.push(i);
  const unassigned = unassignedWeekCount(classId);

  const termOptions = (i) => {
    const tag = weekTagFor(classId, i);
    return (tag === null ? `<option value="" selected disabled>–</option>` : "") +
      TERM_TAGS.map((t) => `<option value="${t}" ${t === tag ? "selected" : ""}>T${t}</option>`).join("");
  };

  el.innerHTML = `
    <div class="card">
      <h2>Register — School Opens Per Week</h2>
      <p style="font-size:12px;color:var(--muted);">One running attendance log for this class. Each week belongs to a term, so every report card counts only its own term's weeks (Annual counts them all). Enter how many days school ran each week, then each student's days present.</p>
      <label>Show weeks &amp; totals for</label>
      <select id="regTerm">
        <option value="A" ${viewTerm === "A" ? "selected" : ""}>Whole year</option>
        ${TERM_TAGS.map((t) => `<option value="${t}" ${viewTerm === t ? "selected" : ""}>${termLabel(t)}</option>`).join("")}
      </select>
      ${unassigned ? `<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:var(--warning-bg);border-left:4px solid var(--warning);font-size:12.5px;">
        <b>${unassigned} week${unassigned === 1 ? "" : "s"} not assigned to a term yet</b> — counted as Term 1 for now. In the <b>Term</b> row below, pick the term on the first week of Term 2 (and of Term 3): that week and every later week of the same term move together.</div>` : ""}
      <div class="subtable-wrap" style="margin-top:10px;">
        <table>
          <thead><tr><th>Week</th>${visible.map((i) => `<th>${i + 1}</th>`).join("")}</tr></thead>
          <tbody>
            <tr><td>Term</td>${visible.map((i) => `<td><select class="week-term-input" data-week="${i}" title="Which term this week belongs to" style="width:58px;padding:4px;">${termOptions(i)}</select></td>`).join("")}</tr>
            <tr><td>School Opens</td>${visible.map((i) => `<td><input type="number" class="opens-input" data-week="${i}" value="${rec.schoolOpensPerWeek[i] || ""}" min="0" max="${MAX_SCHOOL_OPENS_PER_WEEK}" title="Max ${MAX_SCHOOL_OPENS_PER_WEEK} (5 days × AM/PM)" style="width:44px;padding:4px;"></td>`).join("")}</tr>
          </tbody>
        </table>
      </div>
      <div class="row" style="margin-top:8px;">
        <button class="btn small secondary" id="addWeekBtn">+ Add Week${viewTerm === "A" ? "" : " to " + termLabel(viewTerm)}</button>
        <button class="btn small danger" id="removeWeekBtn">Remove Last Week</button>
      </div>
    </div>
    <div class="card">
      <h2>Weekly Attendance Per Student</h2>
      <p style="font-size:12px;color:var(--muted);">Tap a student's name to set when they joined or left, for students who didn't resume on day one — weeks before joining / after leaving are excluded from their attendance %, and a partial week is prorated by eligible days rather than counted as a full week. Present / Absent / % below cover the <b>${esc(viewLabel)}</b>.</p>
      <div class="subtable-wrap">
        <table>
          <thead><tr><th>SN</th><th>Student</th>${visible.map((i) => `<th>Wk${i + 1}</th>`).join("")}<th>Present</th><th>Absent</th><th>Percent</th><th>Rating</th></tr></thead>
          <tbody id="regBody"></tbody>
        </table>
      </div>
    </div>
    <div id="genderSummary"></div>
  `;
  document.getElementById("regTerm").addEventListener("change", (e) => {
    registerState.term = e.target.value;
    renderRegister();
  });
  document.getElementById("addWeekBtn").addEventListener("click", () => {
    addAttendanceWeek(classId, viewTerm === "A" ? undefined : viewTerm);
    renderRegister();
  });
  document.getElementById("removeWeekBtn").addEventListener("click", () => {
    if (nWeeks === 0) return;
    if (!confirm(`Remove Week ${nWeeks} (${termLabel(weekTermFor(classId, nWeeks - 1))}) for this class? This deletes that week's data for every student. You can undo this from the Admin tab (Deleted Items).`)) return;
    if (removeLastAttendanceWeek(classId)) toast("Week removed — undo from Admin › Deleted Items");
    renderRegister();
  });
  el.querySelectorAll(".week-term-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      setWeekTermFrom(classId, Number(inp.dataset.week), inp.value);
      toast("Term updated");
      renderRegister();
    });
  });
  el.querySelectorAll(".opens-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const raw = inp.value;
      const clamped = setSchoolOpensForWeek(classId, Number(inp.dataset.week), raw);
      if (raw !== "" && Number(raw) !== clamped) toast(`School Opens max is ${MAX_SCHOOL_OPENS_PER_WEEK} (5 days × AM/PM) — adjusted`);
      // Don't rebuild the table here: that destroys the box the person just tapped into.
      inp.value = clamped ? String(clamped) : "";
      refreshRegisterComputed();
    });
  });

  const regBody = document.getElementById("regBody");
  const colCount = visible.length + 6;
  if (students.length === 0) {
    regBody.innerHTML = `<tr><td colspan="${colCount}" class="empty">Add students first (Students tab).</td></tr>`;
  } else {
    regBody.innerHTML = students.map((s, i) => {
      const weeks = (rec.students[s.id] || []);
      const sum = studentAttendanceSummary(classId, s.id, viewTerm);
      const rating = attendanceRatingFor(sum.pct);
      const joinWeek = (s.joinWeek != null && s.joinWeek !== "") ? Number(s.joinWeek) : 0;
      const leaveWeek = (s.leaveWeek != null && s.leaveWeek !== "") ? Number(s.leaveWeek) : null;
      const staggered = joinWeek > 0 || leaveWeek != null;
      const open = registerState.openEnrollId === s.id;
      const weekCells = visible.map((wi) => {
        const outOfRange = wi < joinWeek || (leaveWeek != null && wi > leaveWeek);
        if (outOfRange) return `<td style="color:var(--muted);text-align:center;">–</td>`;
        const eligible = eligibleDaysForStudentWeek(classId, s.id, wi);
        const weekCap = Math.max(0, Math.min(MAX_SCHOOL_OPENS_PER_WEEK, Number(rec.schoolOpensPerWeek[wi]) || 0));
        return `<td><input type="number" class="wk-input" data-student="${esc(s.id)}" data-week="${wi}" value="${weeks[wi] ?? ""}" min="0" max="${weekCap}" style="width:44px;padding:4px;" title="${eligible} day(s) eligible this week"></td>`;
      }).join("");
      const enrollRow = open ? `
        <tr class="enroll-row">
          <td colspan="${colCount}">
            <div class="row" style="flex-wrap:wrap;gap:10px;padding:8px 0;">
              <div><label style="font-size:11px;">Joined in Week</label><br>
                <input type="number" min="1" max="${nWeeks || 1}" class="enroll-input" data-student="${esc(s.id)}" data-field="joinWeek" value="${(s.joinWeek != null && s.joinWeek !== "") ? Number(s.joinWeek) + 1 : ""}" placeholder="1" style="width:64px;padding:4px;"></div>
              <div><label style="font-size:11px;">Eligible days that week</label><br>
                <input type="number" min="0" class="enroll-input" data-student="${esc(s.id)}" data-field="joinEligibleDays" value="${s.joinEligibleDays ?? ""}" placeholder="full week" style="width:90px;padding:4px;"></div>
              <div><label style="font-size:11px;">Left after Week</label><br>
                <input type="number" min="1" max="${nWeeks || 1}" class="enroll-input" data-student="${esc(s.id)}" data-field="leaveWeek" value="${(s.leaveWeek != null && s.leaveWeek !== "") ? Number(s.leaveWeek) + 1 : ""}" placeholder="still enrolled" style="width:100px;padding:4px;"></div>
              <div><label style="font-size:11px;">Eligible days that week</label><br>
                <input type="number" min="0" class="enroll-input" data-student="${esc(s.id)}" data-field="leaveEligibleDays" value="${s.leaveEligibleDays ?? ""}" placeholder="full week" style="width:90px;padding:4px;"></div>
            </div>
          </td>
        </tr>` : "";
      return `<tr data-reg-row="${esc(s.id)}">
        <td>${i + 1}</td>
        <td><button type="button" class="link-btn" data-enroll-toggle="${esc(s.id)}" style="background:none;border:none;padding:0;color:inherit;text-align:left;font:inherit;cursor:pointer;">${studentTag(s)}${staggered ? `<span class="tag-staggered" title="Joined/left mid-term">${iconSvg("cap")}</span>` : ""}</button></td>
        ${weekCells}
        <td class="reg-present">${sum.present}</td><td class="reg-absent">${sum.absent}</td><td class="reg-pct">${sum.pct.toFixed(2)}%</td>
        <td class="reg-rating"><span class="badge gA">${rating}/5</span></td>
      </tr>${enrollRow}`;
    }).join("");
    regBody.querySelectorAll(".wk-input").forEach((inp) => {
      inp.addEventListener("change", () => {
        const raw = inp.value;
        const clamped = setStudentWeekPresent(classId, inp.dataset.student, Number(inp.dataset.week), raw);
        if (raw !== "" && Number(raw) !== clamped) toast(`Can't exceed this week's School Opens — adjusted`);
        // Don't rebuild the table here: rebuilding replaced the box the person had just moved
        // to, so the keyboard closed and they had to tap again. Show the saved (clamped) value
        // and refresh only the calculated cells.
        inp.value = clamped === undefined ? "" : String(clamped);
        refreshRegisterComputed();
      });
    });
    /* Entry order: the keyboard's Next / Enter key goes DOWN a week's column (student to
       student), and after the last student on to the first student of the next week, because
       that's how attendance is entered. Without this the browser follows the table's row order
       (week 1 -> week 2 for the same student). tabindex gives the native Next/Tab key the
       column order; the Enter handler covers keyboards that send Enter instead. */
    const allWk = Array.from(regBody.querySelectorAll(".wk-input"));
    const entryOrder = [];
    visible.forEach((wi) => allWk.forEach((b) => { if (Number(b.dataset.week) === wi) entryOrder.push(b); }));
    entryOrder.forEach((box, idx) => {
      const nextBox = entryOrder[idx + 1];
      box.tabIndex = idx + 1;
      box.setAttribute("enterkeyhint", nextBox ? "next" : "done");
      box.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (nextBox) { nextBox.focus(); if (nextBox.select) nextBox.select(); }
        else box.blur();
      });
    });
    regBody.querySelectorAll("[data-enroll-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        registerState.openEnrollId = registerState.openEnrollId === btn.dataset.enrollToggle ? null : btn.dataset.enrollToggle;
        renderRegister();
      });
    });
    regBody.querySelectorAll(".enroll-input").forEach((inp) => {
      inp.addEventListener("change", () => {
        const list = loadStudents();
        const student = list.find((x) => x.id === inp.dataset.student);
        if (!student) return;
        const field = inp.dataset.field;
        if (field === "joinWeek" || field === "leaveWeek") {
          student[field] = inp.value === "" ? undefined : Math.max(0, Number(inp.value) - 1);
        } else {
          student[field] = inp.value === "" ? undefined : Number(inp.value);
        }
        saveStudents(list);
        // Join / leave week changes which cells are editable, so that needs a rebuild.
        // The "eligible days" boxes only change totals, so keep focus and just refresh.
        if (field === "joinWeek" || field === "leaveWeek") renderRegister();
        else refreshRegisterComputed();
      });
    });
  }

  renderGenderSummary();

  /* Update only the calculated parts of the Register (Present / Absent / % / Rating,
     each box's max, and the gender summary) without touching any input the person may
     be typing in. */
  function refreshRegisterComputed() {
    const freshRec = attendanceForClass(classId);
    el.querySelectorAll(".wk-input").forEach((box) => {
      const wi = Number(box.dataset.week);
      const cap = Math.max(0, Math.min(MAX_SCHOOL_OPENS_PER_WEEK, Number(freshRec.schoolOpensPerWeek[wi]) || 0));
      box.max = String(cap);
      box.title = `${eligibleDaysForStudentWeek(classId, box.dataset.student, wi)} day(s) eligible this week`;
    });
    el.querySelectorAll("tr[data-reg-row]").forEach((tr) => {
      const sum = studentAttendanceSummary(classId, tr.dataset.regRow, viewTerm);
      tr.querySelector(".reg-present").textContent = sum.present;
      tr.querySelector(".reg-absent").textContent = sum.absent;
      tr.querySelector(".reg-pct").textContent = sum.pct.toFixed(2) + "%";
      tr.querySelector(".reg-rating").innerHTML = `<span class="badge gA">${attendanceRatingFor(sum.pct)}/5</span>`;
    });
    renderGenderSummary();
  }

  function renderGenderSummary() {
  const gs = classAttendanceSummary(classId, viewTerm);
  document.getElementById("genderSummary").innerHTML = `
    <div class="card">
      <h2>Gender & Term Summary — ${esc(viewLabel)}</h2>
      <div class="stat"><span>Male students</span><b>${gs.maleCount}</b></div>
      <div class="stat"><span>Female students</span><b>${gs.femaleCount}</b></div>
      <div class="stat"><span>Total attendance — Males</span><b>${gs.maleTotal}</b></div>
      <div class="stat"><span>Total attendance — Females</span><b>${gs.femaleTotal}</b></div>
      <div class="stat"><span>Average attendance % — Males</span><b>${gs.maleAvgPct.toFixed(2)}%</b></div>
      <div class="stat"><span>Average attendance % — Females</span><b>${gs.femaleAvgPct.toFixed(2)}%</b></div>
      <div class="stat"><span>Higher-attending gender</span><b>${esc(gs.higherGender)}</b></div>
      <div class="stat"><span>Total school opens</span><b>${gs.totalSchoolOpens}</b></div>
      <div class="stat"><span>Total attendance</span><b>${gs.totalAttendanceTerm}</b></div>
      <div class="stat"><span>Class average attendance</span><b>${gs.classAveragePct.toFixed(2)}%</b></div>
      ${gs.weeklyTotals.length ? `<div class="section-title">Per-week totals</div>
      <table><thead><tr><th>Week</th><th>Present</th><th>School Opens</th><th>Percent</th></tr></thead>
      <tbody>${gs.weeklyTotals.map(w=>`<tr><td>${w.week}</td><td>${w.present}</td><td>${w.schoolOpens}</td><td>${w.pct.toFixed(2)}%</td></tr>`).join("")}</tbody></table>` : ""}
    </div>
  `;
  }
}

/* ================= CLASS REPORT TAB ================= */
let classReportState = { term: "1", openId: null };

function renderClassReport() {
  const el = document.getElementById("classreport");
  const classId = getCurrentClassId();
  if (!classId) { el.innerHTML = NO_CLASSES_HTML; return; }
  if (guardClassLock(el, classId)) return;
  const students = studentsInClass(classId);
  el.innerHTML = `
    <div class="card">
      <h2>Class Report</h2>
      <label>Select Term / View</label>
      <select id="crTerm">
        <option value="1" ${classReportState.term === "1" ? "selected" : ""}>TERM 1</option>
        <option value="2" ${classReportState.term === "2" ? "selected" : ""}>TERM 2</option>
        <option value="3" ${classReportState.term === "3" ? "selected" : ""}>TERM 3</option>
        <option value="A" ${classReportState.term === "A" ? "selected" : ""}>ANNUAL</option>
      </select>
    </div>
    <div class="card">
      <h2>Export</h2>
      <p style="font-size:12px;color:var(--muted);">Covers this class only — see Preview before downloading. (All classes: Admin tab.)</p>
      <div class="row">
        <button class="btn secondary" id="crPreviewBtn">👁 Preview</button>
        <button class="btn" id="crExcelBtn">⬇ Excel</button>
        <button class="btn" id="crPdfBtn">📄 PDF</button>
      </div>
    </div>
    <div id="crList"></div>
  `;
  document.getElementById("crTerm").addEventListener("change", (e) => {
    classReportState.term = e.target.value;
    renderClassReportList();
  });
  document.getElementById("crPreviewBtn").addEventListener("click", () => previewExport(classId));
  document.getElementById("crExcelBtn").addEventListener("click", () => exportClassToExcel(classId));
  document.getElementById("crPdfBtn").addEventListener("click", () => exportToPdf(classId));
  renderClassReportList();

  function renderClassReportList() {
    const list = document.getElementById("crList");
    const term = classReportState.term;
    const students = classMembers(classId, term);   // pupils on the roll for this term
    if (students.length === 0) {
      list.innerHTML = `<div class="empty">No students yet.</div>`;
      return;
    }
    const rows = students.map((s) => {
      const gt = grandTotalFor(classId, term, s.id, students);
      const avg = averageFor(classId, term, s.id, students);
      return { student: s, position: gt.position, total: gt.total, avg: avg, hasAny: gt.hasAny };
    }).sort((a, b) => {
      if (a.hasAny !== b.hasAny) return a.hasAny ? -1 : 1;
      if (!a.hasAny) return (a.student.name || "").localeCompare(b.student.name || "");
      return a.position - b.position;
    });

    list.innerHTML = rows.map((r) => {
      const open = classReportState.openId === r.student.id;
      return `
        <div class="studentcard">
          <div class="toprow" data-toggle="${esc(r.student.id)}">
            <div style="display:flex;align-items:center;">
              <span class="rank-pill">${r.hasAny ? r.position : "–"}</span>
              <div>
                ${studentTag(r.student)}
                <div class="meta">${r.hasAny ? `Grand Total: ${r.total.toFixed(1)} · Average: ${r.avg.toFixed(1)}` : "No scores entered yet"}</div>
              </div>
            </div>
            <span>${open ? "▲" : "▼"}</span>
          </div>
          <div class="detail ${open ? "open" : ""}" id="detail-${esc(r.student.id)}">
            ${open ? subjectBreakdownTable(classId, term, r.student.id, students) : ""}
            ${open ? `<div class="comment-box">${esc(commentForStudent(classId, term, r.student, students))}</div>` : ""}
          </div>
        </div>
      `;
    }).join("");

    list.querySelectorAll("[data-toggle]").forEach((elx) => {
      elx.addEventListener("click", () => {
        const id = elx.dataset.toggle;
        classReportState.openId = classReportState.openId === id ? null : id;
        renderClassReportList();
      });
    });
  }
}

function subjectBreakdownTable(classId, term, studentId, students) {
  const subjects = subjectsForClass(classId);
  if (subjects.length === 0) return `<div class="empty">No subjects added to this class yet.</div>`;
  const rows = subjects.map((subj) => {
    const r = subjectRowFor(classId, term, subj, studentId, students);
    if (r.notTaking) return "";   // not one of this pupil's subjects
    if (!r.hasAny) {
      return `<tr><td>${esc(subj)}</td><td>–</td><td>–</td><td>–</td><td>–</td><td>–</td><td>${r.classAverage.toFixed(1)}</td><td>–</td></tr>`;
    }
    return `<tr><td>${esc(subj)}</td><td>${r.test1.toFixed(1)}</td>
      <td>${r.test2.toFixed(1)}</td><td>${r.exam.toFixed(1)}</td>
      <td><b>${r.total.toFixed(1)}</b></td><td>${r.position}</td><td>${r.classAverage.toFixed(1)}</td>
      <td><span class="badge ${gradeBadgeClass(r.grade)}">${r.grade}</span></td></tr>`;
  }).join("");
  return `<div class="subtable-wrap"><table>
    <thead><tr><th>Subject</th><th>T1</th><th>T2</th><th>Exam</th><th>Total</th><th>Pos</th><th>Class Avg</th><th>Grade</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

/* ================= REPORT CARD TAB (single student, printable) ================= */
let reportCardState = { studentId: null, term: "1" };

function renderReportCard() {
  const el = document.getElementById("reportcard");
  const classId = getCurrentClassId();
  if (!classId) { el.innerHTML = NO_CLASSES_HTML; return; }
  if (guardClassLock(el, classId)) return;
  let students = classMembers(classId, reportCardState.term);
  if (!reportCardState.studentId || !students.find((s) => s.id === reportCardState.studentId)) {
    reportCardState.studentId = students[0] ? students[0].id : null;
  }

  el.innerHTML = `
    <div class="card no-print">
      <h2>Report Card</h2>
      <div class="grid2">
        <div>
          <label>Student</label>
          <select id="rcStudent">
            ${students.map((s) => `<option value="${esc(s.id)}" ${s.id === reportCardState.studentId ? "selected" : ""}>${esc(s.name || "(unnamed)")}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Term / View</label>
          <select id="rcTerm">
            <option value="1" ${reportCardState.term === "1" ? "selected" : ""}>TERM 1</option>
            <option value="2" ${reportCardState.term === "2" ? "selected" : ""}>TERM 2</option>
            <option value="3" ${reportCardState.term === "3" ? "selected" : ""}>TERM 3</option>
            <option value="A" ${reportCardState.term === "A" ? "selected" : ""}>ANNUAL</option>
          </select>
        </div>
      </div>
      <div class="row" style="margin-top:12px;">
        <button class="btn secondary" id="previewBtn">👁 Preview</button>
        <button class="btn" id="printBtn">🖨 Print / PDF</button>
        <button class="btn" id="printAllBtn">🖨 Print all (${students.length})</button>
        <button class="btn" id="rcExcelBtn">⬇ Excel (this class)</button>
      </div>
    </div>
    <div id="rcCommentBox"></div>
    <div id="rcBody"></div>
  `;
  document.getElementById("rcStudent").addEventListener("change", (e) => {
    reportCardState.studentId = e.target.value;
    renderReportCardBody();
  });
  document.getElementById("rcTerm").addEventListener("change", (e) => {
    reportCardState.term = e.target.value;
    // the roll can differ by term (a pupil moved up mid-session is on two classes' rolls)
    students = classMembers(classId, reportCardState.term);
    if (!students.find((x) => x.id === reportCardState.studentId)) reportCardState.studentId = students[0] ? students[0].id : null;
    document.getElementById("rcStudent").innerHTML = students.map((x) => `<option value="${esc(x.id)}" ${x.id === reportCardState.studentId ? "selected" : ""}>${esc(x.name || "(unnamed)")}</option>`).join("");
    document.getElementById("printAllBtn").textContent = `🖨 Print all (${students.length})`;
    renderReportCardBody();
  });
  document.getElementById("printBtn").addEventListener("click", () => printCurrentTab());
  document.getElementById("printAllBtn").addEventListener("click", () => {
    // One report card per pupil, each on its own page. Pupils with nothing entered for this
    // term have no report to print, so they are skipped rather than printed as blanks.
    const term = reportCardState.term;
    const pages = []; let skipped = 0;
    students.forEach((st) => {
      if (!grandTotalFor(classId, term, st.id, students).hasAny) { skipped++; return; }
      pages.push(buildReportCardHtml(st.id, term));
    });
    if (!pages.length) { toast("No scores entered for " + termLabel(term) + " yet"); return; }
    const note = skipped ? ` (${skipped} pupil${skipped === 1 ? "" : "s"} with no scores will be skipped)` : "";
    if (!confirm(`Print ${pages.length} report card${pages.length === 1 ? "" : "s"} for ${termLabel(term)}${note}?`)) return;
    printPagesNow(pages, "portrait");
  });
  document.getElementById("rcExcelBtn").addEventListener("click", () => exportClassToExcel(classId));
  document.getElementById("previewBtn").addEventListener("click", () => {
    const html = buildReportCardHtml();
    if (html) openPrintPreview([html], "portrait");
    else toast("Add students first");
  });
  renderReportCardBody();

  function buildReportCardHtml(studentId, termArg) {
    studentId = studentId || reportCardState.studentId;
    const term = termArg || reportCardState.term;
    if (!students.length || !studentId) return null;
    const s = students.find((x) => x.id === studentId);
    if (!s) return null;
    const cls = loadClasses().find((c) => c.id === classId) || {};
    const gt = grandTotalFor(classId, term, s.id, students);
    const avg = averageFor(classId, term, s.id, students);
    const att = studentAttendanceSummary(classId, s.id, term); // this term only ("A" = whole year)
    const subjects = subjectsForClass(classId); // kept in the order they were added
    const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "________";

    const isAnnual = term === "A";
    // only the subjects this pupil takes, numbered 1, 2, 3 … without gaps
    const taken = subjects.filter((subj) => !isNotTaking(studentRecord(s.id), subj));
    const subjectRows = taken.length ? taken.map((subj, i) => {
      const r = subjectRowFor(classId, term, subj, s.id, students);
      if (!r.hasAny) {
        return `<tr>
          <td>${i + 1}</td>
          <td class="rs-subj">${esc(subj)}</td>
          <td>–</td><td>–</td><td>–</td><td>–</td><td>–</td>
          <td>${r.classAverage.toFixed(1)}</td>
          <td>–</td>
          <td>${esc(r.remark)}</td>
        </tr>`;
      }
      const c1 = isAnnual ? r.term1Total.toFixed(1) : r.test1.toFixed(1);
      const c2 = isAnnual ? r.term2Total.toFixed(1) : r.test2.toFixed(1);
      const c3 = isAnnual ? r.term3Total.toFixed(1) : r.exam.toFixed(1);
      return `<tr>
        <td>${i + 1}</td>
        <td class="rs-subj">${esc(subj)}</td>
        <td>${c1}</td>
        <td>${c2}</td>
        <td>${c3}</td>
        <td><b>${r.total.toFixed(1)}</b></td>
        <td>${r.position}</td>
        <td>${r.classAverage.toFixed(1)}</td>
        <td>${r.grade}</td>
        <td>${r.remark}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="10" class="empty">No subjects added to this class yet.</td></tr>`;

    return `
      <div class="reportsheet">
        <div class="rs-header">
          <div class="rs-schoolname">ST. STEPHEN'S NURSERY, PRIMARY AND SECONDARY SCHOOL</div>
          <div class="rs-motto">Motto: Innovative Knowledge &amp; Excellent Service</div>
        </div>
        <div class="rs-title">REPORT SHEET FOR <u>${esc(cls.name || "")}</u>${cls.session ? `, <u>${esc(cls.session)}</u> SESSION` : ""}</div>
        <div class="rs-info-grid">
          <div class="rs-info-col">
            <div class="rs-info-row"><span>NAME:</span><b>${esc(s.name || "")}</b></div>
            <div class="rs-info-row"><span>GENDER:</span><b>${esc(s.gender || "")}</b></div>
            <div class="rs-info-row"><span>CLASS:</span><b>${esc(cls.name || "")}</b></div>
            <div class="rs-info-row"><span>CLASS POPULATION:</span><b>${students.length}</b></div>
            <div class="rs-info-row"><span>AVERAGE:</span><b>${gt.hasAny ? avg.toFixed(1) : "–"}</b></div>
            <div class="rs-info-row"><span>POSITION:</span><b>${gt.hasAny ? `${gt.position} of ${students.length}` : "– (no scores yet)"}</b></div>
          </div>
          <div class="rs-info-col">
            <div class="rs-info-row"><span>TERM:</span><b>${termLabel(term)}</b></div>
            <div class="rs-info-row"><span>NO ON ROLL:</span><b>${students.length}</b></div>
            <div class="rs-info-row"><span>PRESENT:</span><b>${att.present}</b></div>
            <div class="rs-info-row"><span>ABSENT:</span><b>${att.absent}</b></div>
            <div class="rs-info-row"><span>NEXT TERM BEGINS:</span><b>${fmtDate(cls.nextTermBegins)}</b></div>
            <div class="rs-info-row"><span>NEXT TERM ENDS:</span><b>${fmtDate(cls.nextTermEnds)}</b></div>
          </div>
        </div>

        <div class="subtable-wrap">
          <table class="rs-table">
            <thead>
              ${isAnnual
                ? `<tr class="rs-maxrow"><th></th><th>ANNUAL SUMMARY</th><th colspan="3">TERM TOTALS</th><th></th><th rowspan="2">POSITION<br>PER-SUBJECT</th><th rowspan="2">AVERAGE</th><th rowspan="2">GRADE<br>LETTER</th><th rowspan="2">REMARK</th></tr>
                   <tr><th>S/N</th><th>SUBJECT</th><th>1st Term</th><th>2nd Term</th><th>3rd Term</th><th>Total</th></tr>`
                : `<tr class="rs-maxrow"><th></th><th>MAX. MARKS OBTAINABLE</th><th>20</th><th>20</th><th>60</th><th>100</th><th rowspan="2">POSITION<br>PER-SUBJECT</th><th rowspan="2">AVERAGE</th><th rowspan="2">GRADE<br>LETTER</th><th rowspan="2">REMARK</th></tr>
                   <tr><th>S/N</th><th>SUBJECT</th><th>Test 1</th><th>Test 2</th><th>Exam</th><th>Total</th></tr>`}
            </thead>
            <tbody>${subjectRows}</tbody>
          </table>
        </div>

        <div class="rs-remarks">
          <div class="rs-remark-row"><b>Class Teacher</b><span class="rs-remark-line">${esc(commentForStudent(classId, term, s, students))}</span></div>
          <div class="rs-remark-row"><b>Principal</b><span class="rs-remark-line">&nbsp;</span></div>
        </div>

        <div class="rs-keys">
          <b>KEYS TO MARKING &amp; RATING</b><br>
          0.00 - 39: F- V. Poor / 40-49: E- Poor / 50-59: D- B. Average / 60-69: C-Credit / 70-79: B-Good / 80-100: A-Excellent
        </div>
      </div>
    `;
  }

  function renderReportCardBody() {
    const body = document.getElementById("rcBody");
    const html = buildReportCardHtml();
    body.innerHTML = html || `<div class="empty">Add students first.</div>`;
    renderCommentBox();
  }

  // The class teacher's comment for the pupil and term on screen. It shows the suggestion
  // (worked out from the pupil's average) until the teacher types their own, which is then
  // kept for that pupil and that term and is what gets printed.
  function renderCommentBox() {
    const box = document.getElementById("rcCommentBox");
    if (!box) return;
    const s = students.find((x) => x.id === reportCardState.studentId);
    if (!s) { box.innerHTML = ""; return; }
    const term = reportCardState.term;
    const suggested = suggestedCommentFor(classId, term, s, students);
    const current = commentForStudent(classId, term, s, students);
    const custom = current !== suggested;
    box.innerHTML = `
      <div class="card no-print">
        <h2>Class teacher's comment</h2>
        <p style="font-size:12px;color:var(--muted);margin-bottom:6px;">${esc(s.name || "This pupil")} · ${termLabel(term)}. ${custom ? "Your own comment is showing." : "Suggested from the pupil's average — change it to write your own."}</p>
        <textarea id="rcComment" rows="2" style="width:100%;padding:8px;font:inherit;">${esc(current)}</textarea>
        ${custom ? `<button class="btn small secondary" id="rcCommentReset" style="margin-top:6px;">Use the suggested comment</button>` : ""}
      </div>`;
    document.getElementById("rcComment").addEventListener("change", (e) => {
      const text = e.target.value.trim();
      setStudentRemark(s.id, term, text.toUpperCase() === String(suggested).toUpperCase() ? "" : text);   // unchanged suggestion = no custom comment, so it keeps following the marks
      renderReportCardBody();
    });
    const reset = document.getElementById("rcCommentReset");
    if (reset) reset.addEventListener("click", () => { setStudentRemark(s.id, term, ""); renderReportCardBody(); });
  }
}

/* ================= BROADSHEET TAB (whole-class printable, A4 landscape) ================= */
let broadsheetState = { term: "1" };
const BS_SUBJECTS_PER_PAGE = 6;

function backupRestoreCardHtml() {
  return `
    <div class="card no-print">
      <h2>Backup & Restore (this device)</h2>
      <p style="font-size:12.5px;color:var(--muted);">
        Download a backup file regularly and keep it somewhere safe (email it to yourself, save it to a
        cloud drive folder) — and use it to restore this device, or to carry data over to another device.
        A backup contains every class and its access code, but never the Admin PIN.
      </p>
      <div class="row">
        <button class="btn" id="backupBtn">⬇ Download Backup</button>
        <button class="btn secondary" id="restoreBtn">⬆ Restore From Backup</button>
      </div>
      <input type="file" id="restoreFileInput" accept="application/json" style="display:none;">
      <p style="font-size:11.5px;color:var(--muted);margin-top:6px;">Restoring replaces this device's current classes, students, scores, attendance and announcements with what's in the backup file.</p>
    </div>
  `;
}
function downloadBackupFile() {
    const backup = buildBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `ststephens-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("Backup downloaded");
}

function wireBackupRestoreHandlers() {
  document.getElementById("backupBtn").addEventListener("click", () => downloadBackupFile());

  const fileInput = document.getElementById("restoreFileInput");
  document.getElementById("restoreBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!confirm("Restore from this file? This replaces the data currently on this device — that can't be undone.")) {
      fileInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const backup = JSON.parse(reader.result);
        restoreBackup(backup);
        toast("Restored — reloading…");
        setTimeout(() => window.location.reload(), 800);
      } catch (e) {
        toast("Couldn't restore: " + e.message);
      }
      fileInput.value = "";
    };
    reader.onerror = () => { toast("Couldn't read that file"); fileInput.value = ""; };
    reader.readAsText(file);
  });
}

function renderBroadsheet() {
  const el = document.getElementById("broadsheet");
  if (!el) return;
  // Backup & Restore now lives on the Admin tab (PIN-protected) — it covers every class,
  // so it must not sit on a tab that a single class code opens. The tab's content lives
  // in its own #bsMain container so guardClassLock/NO_CLASSES_HTML can take over just it.
  el.innerHTML = `<div id="bsMain"></div>`;

  const main = document.getElementById("bsMain");
  const classId = getCurrentClassId();
  if (!classId) { main.innerHTML = NO_CLASSES_HTML; return; }
  if (guardClassLock(main, classId)) return;
  const cls = loadClasses().find((c) => c.id === classId) || {};
  let students = classMembers(classId, broadsheetState.term);
  const subjects = subjectsForClass(classId);

  main.innerHTML = `
    <div class="card no-print">
      <h2>Broadsheet</h2>
      <label>Select Term / View</label>
      <select id="bsTerm">
        <option value="1" ${broadsheetState.term === "1" ? "selected" : ""}>TERM 1</option>
        <option value="2" ${broadsheetState.term === "2" ? "selected" : ""}>TERM 2</option>
        <option value="3" ${broadsheetState.term === "3" ? "selected" : ""}>TERM 3</option>
        <option value="A" ${broadsheetState.term === "A" ? "selected" : ""}>ANNUAL</option>
      </select>
      <div class="row" style="margin-top:10px;">
        <button class="btn secondary" id="bsPreviewBtn">👁 Preview</button>
        <button class="btn" id="bsPrintBtn">🖨 Print / PDF</button>
        <button class="btn" id="bsExcelBtn">⬇ Excel (this class)</button>
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin-top:8px;">Always prints A4 landscape. More than ${BS_SUBJECTS_PER_PAGE} subjects automatically split across multiple pages, each repeating S/N and Student Name.</p>
    </div>
    <div id="bsBody"></div>
  `;
  document.getElementById("bsTerm").addEventListener("change", (e) => {
    broadsheetState.term = e.target.value;
    students = classMembers(classId, broadsheetState.term);
    renderBroadsheetBody();
  });
  document.getElementById("bsPrintBtn").addEventListener("click", () => printCurrentTab());
  document.getElementById("bsExcelBtn").addEventListener("click", () => exportClassToExcel(classId));
  document.getElementById("bsPreviewBtn").addEventListener("click", () => {
    openPrintPreview(buildBroadsheetPages(), "landscape");
  });
  renderBroadsheetBody();

  function buildBroadsheetPages() {
    if (!students.length || !subjects.length) return [];
    const term = broadsheetState.term;
    const isAnnual = term === "A";
    const rows = students.map((s) => {
      const gt = grandTotalFor(classId, term, s.id, students);
      const avg = averageFor(classId, term, s.id, students);
      return { student: s, gt: gt, avg: avg };
    }).sort((a, b) => {
      if (a.gt.hasAny !== b.gt.hasAny) return a.gt.hasAny ? -1 : 1;
      if (!a.gt.hasAny) return (a.student.name || "").localeCompare(b.student.name || "");
      return a.gt.position - b.gt.position;
    });

    const chunks = [];
    for (let i = 0; i < subjects.length; i += BS_SUBJECTS_PER_PAGE) chunks.push(subjects.slice(i, i + BS_SUBJECTS_PER_PAGE));
    const totalPages = chunks.length;
    const col1 = isAnnual ? "1st Term" : "T1";
    const col2 = isAnnual ? "2nd Term" : "T2";
    const col3 = isAnnual ? "3rd Term" : "Exam";

    return chunks.map((chunk, pageIdx) => {
      const isLastPage = pageIdx === chunks.length - 1;
      const subjectHeaderCells = chunk.map((s) => `<th colspan="4">${esc(s)}</th>`).join("");
      const subjectSubheaderCells = chunk.map(() => `<th>${col1}</th><th>${col2}</th><th>${col3}</th><th>Total</th>`).join("");
      const dataRows = rows.map((r) => {
        const cells = chunk.map((subj) => {
          const sr = subjectRowFor(classId, term, subj, r.student.id, students);
          if (!sr.hasAny) return `<td>–</td><td>–</td><td>–</td><td>–</td>`;
          const c1 = isAnnual ? sr.term1Total : sr.test1;
          const c2 = isAnnual ? sr.term2Total : sr.test2;
          const c3 = isAnnual ? sr.term3Total : sr.exam;
          return `<td>${c1.toFixed(1)}</td><td>${c2.toFixed(1)}</td><td>${c3.toFixed(1)}</td><td><b>${sr.total.toFixed(1)}</b></td>`;
        }).join("");
        const summaryCells = isLastPage
          ? `<td><b>${r.gt.hasAny ? r.gt.total.toFixed(1) : "–"}</b></td><td>${r.gt.hasAny ? r.avg.toFixed(1) : "–"}</td><td>${r.gt.hasAny ? r.gt.position : "–"}</td>` : "";
        return `<tr>
          <td>${r.gt.hasAny ? r.gt.position : "–"}</td>
          <td class="bs-name">${esc(r.student.name || "(unnamed)")}</td>
          ${cells}${summaryCells}
        </tr>`;
      }).join("");
      const summaryHeader = isLastPage
        ? `<th rowspan="2">GRAND<br>TOTAL</th><th rowspan="2">AVERAGE</th><th rowspan="2">POSITION</th>` : "";

      return `
        <div class="bs-wrap">
          <div class="bs-heading">
            <div class="bs-school">ST. STEPHEN'S NURSERY, PRIMARY AND SECONDARY SCHOOL</div>
            <div class="bs-sub">BROADSHEET — ${esc(cls.name || "")}${cls.session ? `, ${esc(cls.session)} SESSION` : ""} — ${termLabel(term)} — ${students.length} STUDENTS</div>
            ${totalPages > 1 ? `<div class="bs-page">Page ${pageIdx + 1} of ${totalPages}</div>` : ""}
          </div>
          <div class="subtable-wrap">
            <table class="bs-table">
              <thead>
                <tr><th rowspan="2">POS</th><th rowspan="2">STUDENT NAME</th>${subjectHeaderCells}${summaryHeader}</tr>
                <tr>${subjectSubheaderCells}</tr>
              </thead>
              <tbody>${dataRows}</tbody>
            </table>
          </div>
        </div>
      `;
    });
  }

  function renderBroadsheetBody() {
    const body = document.getElementById("bsBody");
    if (!students.length) {
      body.innerHTML = `<div class="empty">Add students first.</div>`;
      return;
    }
    if (!subjects.length) {
      body.innerHTML = `<div class="empty">Add subjects to this class first (Score Entry tab).</div>`;
      return;
    }
    const pages = buildBroadsheetPages();
    body.innerHTML = pages.map((page, i) =>
      `<div class="bs-page-wrap${i < pages.length - 1 ? " bs-page-break" : ""}">${page}</div>`
    ).join("");
  }
}

/* Global subject suggestions datalist, used by the "add subject" input */
function ensureSubjectDatalist() {
  if (document.getElementById("subjectSuggestions")) return;
  const dl = document.createElement("datalist");
  dl.id = "subjectSuggestions";
  dl.innerHTML = MASTER_SUBJECT_SUGGESTIONS.map((s) => `<option value="${esc(s)}">`).join("");
  document.body.appendChild(dl);
}

document.addEventListener("DOMContentLoaded", () => {
  ensureSubjectDatalist();
  const vb = document.getElementById("appVersionBadge");
  if (vb) vb.textContent = "· v" + APP_VERSION;
  renderAll();
  layoutFixedStack();
  startLiveClock();
});
