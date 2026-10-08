/* ================= ADMIN TAB ================= */
let adminUnlocked = false;

function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

/* Lists every device that's ever synced through this Worker, each with an
   editable name (renaming any device here reaches every other device —
   it's just a normal synced field) and an online/offline read based on
   how recently that device last synced. Only shown once sync is actually
   set up, since presence is meaningless otherwise. */
function renderConnectedDevicesCard() {
  const devices = loadDevices();
  const myId = getDeviceId();
  const rows = Object.keys(devices)
    .map((id) => Object.assign({ id: id }, devices[id]))
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  return `
    <div class="card">
      <h2>Connected Devices</h2>
      <p style="font-size:12.5px;color:var(--muted);">Every device that has synced through your Worker. Rename any of them — the name updates everywhere on next sync.</p>
      ${rows.length ? rows.map((d) => {
        const online = isDeviceOnline(d.lastSeen);
        return `
        <div class="row" style="align-items:center;margin-bottom:8px;">
          <span style="width:9px;height:9px;border-radius:50%;flex:0 0 auto;background:${online ? "var(--success)" : "#c3c9d4"};" title="${online ? "Online" : "Offline"}"></span>
          <input type="text" class="device-name-input" data-device="${esc(d.id)}" value="${esc(d.name || "Device")}" style="flex:2;padding:6px;">
          <span style="flex:1;font-size:12px;color:var(--muted);">${d.id === myId ? "This device" : (online ? "Online" : "Last seen " + timeAgo(d.lastSeen))}</span>
        </div>`;
      }).join("") : `<div class="empty">No devices have synced yet.</div>`}
    </div>
  `;
}

/* Deleted Items: every pupil / class / subject / register week that was
   deleted (see history.js), newest first, with an Undo button for the most
   recent one and a Restore button on each entry. */
const HISTORY_KIND_LABEL = { student: "Pupil", class: "Class", subject: "Subject", week: "Register week" };
function deletedItemsCardHtml() {
  const entries = historyEntries();
  const last = entries.find((e) => !e.restoredAt);
  const when = (ms) => new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `
    <div class="card">
      <h2>Deleted Items &amp; Undo</h2>
      <p style="font-size:12.5px;color:var(--muted);">
        Anything deleted (a pupil, class, subject or register week) is removed everywhere, but a copy is kept
        here for ${HISTORY_KEEP_DAYS} days so it can be put back. Restoring never overwrites what is on screen now.
        After ${HISTORY_KEEP_DAYS} days an item is gone for good.
      </p>
      <button class="btn" id="undoLastBtn" ${last ? "" : "disabled"}>↶ Undo last delete${last ? ": " + esc(last.label) : ""}</button>
      <div style="margin-top:12px;">
        ${entries.length ? entries.map((e) => `
          <div class="row" style="align-items:center;margin-bottom:8px;gap:8px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;"><b>${esc(HISTORY_KIND_LABEL[e.kind] || "Item")}</b> — ${esc(e.label)}</div>
              <div style="font-size:11.5px;color:var(--muted);">Deleted ${esc(when(e.at))}${e.by ? " on " + esc(e.by) : ""}${e.restoredAt ? " · Restored " + esc(when(e.restoredAt)) : ""}</div>
            </div>
            ${e.restoredAt ? "" : `<button class="btn small secondary restore-btn" data-entry="${esc(e.id)}">Restore</button>`}
          </div>`).join("") : `<div class="empty">Nothing has been deleted yet.</div>`}
      </div>
    </div>`;
}
function runRestore(result) {
  toast(result.message);
  renderAll();
}

/* One-time cleanup of data left behind by pre-3.6.0 deletions — see
   cleanupLegacyOrphans() in history.js. No Undo here on purpose: this is
   data the app hasn't been able to show or restore for a long time. */
function cleanupCardHtml() {
  return `
    <div class="card">
      <h2>Old Hidden Data</h2>
      <p style="font-size:12.5px;color:var(--muted);">
        Versions before 3.6.0 only hid a deleted pupil, class or subject — everything it carried
        (a deleted class's own pupils included) stayed stored and kept syncing. This is a one-time
        sweep to remove exactly that leftover data. It's safe to run any time, including more than
        once; it does nothing once there's nothing left to clean. There's no undo for this one.
      </p>
      <button class="btn secondary" id="cleanupOrphansBtn">🧹 Clean up old hidden data</button>
    </div>`;
}


/* ================= ADD CLASS: pick from the fixed list =================
   Each class in CLASS_CATALOG has a permanent built-in id, so adding "PRY 1" on any
   device gives the same class and sync merges instead of duplicating. */
function openClassPicker() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const draw = () => {
    const have = new Set(loadClasses().map((c) => c.id));
    overlay.innerHTML = `
      <div class="modal-box" style="max-width:360px;">
        <h2 style="margin:0 0 4px;">Add Class</h2>
        <p style="font-size:12.5px;color:var(--muted);margin:0 0 12px;">Tap a class to add it. Classes already added are ticked.</p>
        <div class="gate-class-list">
          ${CLASS_CATALOG.map((c) => `
            <button type="button" class="gate-class-btn" data-cid="${c.id}" ${have.has(c.id) ? "disabled" : ""} style="${have.has(c.id) ? "opacity:.45;box-shadow:none;" : ""}">
              ${esc(c.label)}${have.has(c.id) ? ' <span style="font-size:11px;">✓</span>' : ""}
            </button>`).join("")}
        </div>
        <button type="button" class="btn" id="classPickerDone">Done</button>
      </div>`;
    overlay.querySelectorAll("[data-cid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entry = CLASS_CATALOG.find((c) => c.id === btn.dataset.cid);
        const list = loadClasses();
        if (!entry || list.some((c) => c.id === entry.id)) return;
        list.push({ id: entry.id, name: entry.label });
        saveClasses(list);
        toast(entry.label + " added");
        draw();
      });
    });
    overlay.querySelector("#classPickerDone").addEventListener("click", () => {
      overlay.remove();
      if (!DB.get("currentClassId", null) && loadClasses().length) setCurrentClassId(loadClasses()[0].id);
      renderAll();
    });
  };
  document.body.appendChild(overlay);
  draw();
}

/* ================= STANDARDIZE CLASSES (one-time) =================
   Classes made before 3.9.0 have random ids, so the same class created on two devices
   shows up twice. This finds classes whose name matches an entry in the fixed list
   (PRY 1, "Primary 1", "Primary One" ...), moves their pupils, subjects, scores,
   attendance and announcement onto the list's permanent class, and removes the extra
   copies. Nothing is lost: a backup file is downloaded first. */
function standardizeCardHtml() {
  return `
    <div class="card">
      <h2>Standardize Classes</h2>
      <p style="font-size:12.5px;color:var(--muted);">
        Fixes duplicated or old-style classes. Classes whose name matches the fixed class list
        (e.g. PRY 1) are merged into that class — pupils, subjects, scores and attendance are moved
        across, and the extra copies are removed. A backup downloads first. Run it on <b>one</b>
        device, then sync the others.
      </p>
      <button class="btn secondary" id="standardizeClassesBtn">🧩 Standardize classes</button>
    </div>`;
}

function _deepFill(target, src) {
  // copy anything target doesn't have; where both have a value, keep target's
  Object.keys(src || {}).forEach((k) => {
    if (target[k] === undefined) target[k] = src[k];
    else if (isPlainObject(target[k]) && isPlainObject(src[k])) _deepFill(target[k], src[k]);
  });
}

function runStandardizeClasses() {
  const classes = loadClasses();
  const students = loadStudents();
  const countOf = (id) => students.filter((s) => s.classId === id).length;

  const groups = {};   // catalog id -> [class records]
  const unmatched = [];
  classes.forEach((c) => {
    const entry = CLASS_CATALOG.find((x) => x.id === c.id) || catalogEntryForName(c.name);
    if (!entry) { unmatched.push(c.name); return; }
    (groups[entry.id] = groups[entry.id] || []).push(c);
  });
  // only groups that need work: a legacy id somewhere
  const work = Object.keys(groups).filter((id) => groups[id].some((c) => c.id !== id));
  if (!work.length) {
    toast(unmatched.length ? "Nothing to merge (some names don't match the list)" : "Nothing to fix — classes are already standard");
    return;
  }
  const lines = work.map((id) => {
    const e = CLASS_CATALOG.find((x) => x.id === id);
    return "• " + e.label + (groups[id].length > 1 ? " (" + groups[id].length + " copies merged)" : "");
  });
  let msg = "These classes will be standardized:\n" + lines.join("\n");
  if (unmatched.length) msg += "\n\nLeft as they are (name not in the list): " + unmatched.join(", ");
  msg += "\n\nA backup file downloads first. Continue?";
  if (!confirm(msg)) return;

  downloadBackupFile();

  let cls = loadClasses();
  let stu = loadStudents();
  const cs = loadClassSubjects(), scores = loadScores(), att = loadAttendance();
  const ann = loadAnnouncements(), tomb = loadSubjectTomb();
  let current = DB.get("currentClassId", null);

  work.forEach((defId) => {
    const def = CLASS_CATALOG.find((x) => x.id === defId);
    const members = groups[defId].slice().sort((a, b) => countOf(b.id) - countOf(a.id)); // fullest first
    let target = cls.find((c) => c.id === defId);
    if (!target) { target = { id: defId, name: def.label }; cls.push(target); }
    target.name = def.label;

    members.forEach((m) => {
      if (m.id === defId) return;
      // class details: fill blanks from the fuller copy first
      ["accessCode", "session", "nextTermBegins", "nextTermEnds"].forEach((f) => {
        if (!target[f] && m[f]) target[f] = m[f];
      });
      // pupils
      let nextOrder = stu.filter((s) => s.classId === defId).length;
      stu.filter((s) => s.classId === m.id)
        .sort((a, b) => (a.order != null ? a.order : 1e9) - (b.order != null ? b.order : 1e9))
        .forEach((s) => { s.classId = defId; s.order = nextOrder++; });
      // subjects
      cs[defId] = cs[defId] || [];
      (cs[m.id] || []).forEach((n) => {
        if (!cs[defId].some((x) => String(x).toLowerCase() === String(n).toLowerCase())) cs[defId].push(n);
      });
      delete cs[m.id];
      // scores
      if (scores[m.id]) { scores[defId] = scores[defId] || {}; _deepFill(scores[defId], scores[m.id]); delete scores[m.id]; }
      // attendance
      if (att[m.id]) {
        att[defId] = att[defId] || { schoolOpensPerWeek: [], students: {} };
        att[defId].students = att[defId].students || {};
        _deepFill(att[defId].students, att[m.id].students || {});
        const tw = att[defId].schoolOpensPerWeek = att[defId].schoolOpensPerWeek || [];
        (att[m.id].schoolOpensPerWeek || []).forEach((v, i) => { if (tw[i] === undefined) tw[i] = v; });
        delete att[m.id];
      }
      // announcement (keep the newer)
      if (ann[m.id]) {
        if (!ann[defId] || (ann[m.id].updatedAt || 0) > (ann[defId].updatedAt || 0)) ann[defId] = ann[m.id];
        delete ann[m.id];
      }
      // "subject removed" markers
      Object.keys(tomb).forEach((k) => {
        if (k.indexOf(m.id + "::") === 0) {
          const nk = defId + "::" + k.slice(m.id.length + 2);
          if (tomb[nk] === undefined) tomb[nk] = tomb[k];
          delete tomb[k];
        }
      });
      if (current === m.id) current = defId;
      cls = cls.filter((c) => c.id !== m.id);
    });
  });

  saveStudents(stu);
  saveClassSubjects(cs);
  saveScores(scores);
  saveAttendance(att);
  saveAnnouncements(ann);
  saveSubjectTomb(tomb);
  saveClasses(cls);
  DB.set("currentClassId", current);
  toast("Classes standardized");
  renderAll();
  if (typeof Sync !== "undefined" && Sync.isConfigured()) Sync.syncNow();
}


/* ================= FIND A STUDENT (search across every class) =================
   The results box is redrawn on each keystroke, but the input itself is never touched
   or recreated — so typing stays smooth with no cursor jump, unlike a full renderAdminTab()
   refresh. Search runs after a short pause in typing (150ms) rather than on every single
   keystroke, so fast typing does no extra work until the person pauses. */
let _studentSearchTimer = null;
function wireStudentSearch(el) {
  const input = el.querySelector("#studentSearchInput");
  const box = el.querySelector("#studentSearchResults");
  if (!input || !box) return;
  input.addEventListener("input", () => {
    clearTimeout(_studentSearchTimer);
    const q = input.value;
    _studentSearchTimer = setTimeout(() => renderStudentSearchResults(box, q), 150);
  });
}

function renderStudentSearchResults(box, query) {
  const q = String(query || "").trim();
  if (!q) { box.innerHTML = ""; return; }
  const matches = searchStudentsByName(q);
  if (!matches.length) { box.innerHTML = `<div class="empty">No pupil found matching "${esc(q)}"</div>`; return; }
  box.innerHTML = matches.slice(0, 25).map((s) => studentProfileCardHtml(studentFullProfile(s))).join("") +
    (matches.length > 25 ? `<p style="font-size:11.5px;color:var(--muted);">+ ${matches.length - 25} more — keep typing to narrow it down.</p>` : "");
  box.querySelectorAll("[data-open-class]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setCurrentClassId(btn.dataset.openClass);
      adminGoToTab("students");
    });
  });
}

function adminGoToTab(tabId) {
  const navBtn = document.querySelector(`#tabs button[data-tab="${tabId}"]`);
  if (navBtn) navBtn.click();
}

function studentProfileCardHtml(p) {
  const s = p.student, cls = p.cls;
  const termsWithData = p.terms.filter((t) => t.hasAny);
  const termsHtml = termsWithData.length
    ? `<div class="subtable-wrap"><table>
        <thead><tr><th>Term</th><th>Total</th><th>Average</th><th>Position</th><th>Attendance</th></tr></thead>
        <tbody>${p.terms.map((t) => t.hasAny ? `<tr>
          <td>${esc(t.label)}</td><td>${round1(t.total)}</td><td>${round1(t.average)}</td>
          <td>${esc(String(t.position))} of ${t.population}</td>
          <td>${t.opens ? round2(t.attendancePct) + "%" : "–"}</td>
        </tr>` : "").join("")}</tbody>
      </table></div>`
    : `<p style="font-size:12.5px;color:var(--muted);">No scores entered yet.</p>`;
  const latestComment = termsWithData.length ? termsWithData[termsWithData.length - 1].comment : "";
  return `
    <div class="card" style="margin-bottom:10px;border:1px solid var(--line,#e2e2e2);">
      <div class="row" style="align-items:center;">
        <h3 style="margin:0;flex:1;">${esc(s.name)}${s.gender ? " (" + esc(s.gender) + ")" : ""}</h3>
        <span style="font-size:12px;font-weight:700;color:var(--brand);flex:0 0 auto;">${esc(cls ? cls.name : "No class")}</span>
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin:2px 0 8px;">
        Subjects: ${p.subjects.length ? esc(p.subjects.join(", ")) : "none set"}
      </p>
      ${termsHtml}
      ${latestComment ? `<p style="font-size:12.5px;margin-top:8px;"><b>Latest comment:</b> ${esc(latestComment)}</p>` : ""}
      ${cls ? `<button class="btn small secondary" data-open-class="${esc(cls.id)}" style="margin-top:8px;">Open ${esc(cls.name)}'s Students tab</button>` : ""}
    </div>`;
}

function renderAdminTab() {
  const el = document.getElementById("admintab");
  if (!el) return;

  if (!adminUnlocked) {
    el.innerHTML = `
      <div class="card">
        <h2>🔐 Admin Access</h2>
        <p style="font-size:12.5px;color:var(--muted);">Enter the admin PIN to manage class access codes, announcements, sync, export and backup.</p>
        <div class="row">
          <input type="password" id="adminPinInput" placeholder="PIN" inputmode="numeric" style="padding:8px;">
          <button class="btn" id="adminPinBtn">Unlock</button>
        </div>
      </div>
    `;
    const tryUnlock = () => {
      const pin = document.getElementById("adminPinInput").value;
      if (pin === getAdminPin()) { adminUnlocked = true; toast("Admin unlocked"); renderAdminTab(); }
      else toast("Incorrect PIN");
    };
    document.getElementById("adminPinBtn").addEventListener("click", tryUnlock);
    document.getElementById("adminPinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
    return;
  }

  const classes = sortedClasses();
  const cfg = (typeof Sync !== "undefined" && Sync.getConfig()) || { url: "" };

  el.innerHTML = `
    <div class="card">
      <h2>🔎 Find a Student</h2>
      <p style="font-size:12.5px;color:var(--muted);margin-top:-2px;">
        Search by name across every class — no need to know which class they're in.
      </p>
      <input type="text" id="studentSearchInput" placeholder="Start typing a pupil's name…" autocomplete="off" style="width:100%;padding:8px;">
      <div id="studentSearchResults" style="margin-top:10px;"></div>
    </div>
    <div class="card">
      <div class="row" style="align-items:center;">
        <h2 style="margin:0;flex:1;">Classes &amp; Access Codes</h2>
        <button class="btn small secondary" id="addClassBtn" style="flex:0 0 auto;">+ Class</button>
      </div>
      <p style="font-size:12.5px;color:var(--muted);margin-top:8px;">Set a unique code per class. A teacher picks their class on the login screen and must enter its code once (per app session) before they can open that class's Students, Register, Score Entry, Class Report, Report Card or Broadsheet. Leave blank for no code.</p>
      ${classes.length ? classes.map((c) => `
        <div class="row" style="align-items:center;margin-bottom:8px;">
          <div style="flex:1;">${esc(c.name)}</div>
          <input type="text" class="class-code-input no-caps" data-class="${esc(c.id)}" placeholder="No code" value="${esc(c.accessCode || "")}" style="flex:1;padding:6px;">
        </div>`).join("") : `<div class="empty">No classes yet — add the first one above.</div>`}
    </div>
    <div class="card">
      <h2>School Announcement</h2>
      <p style="font-size:12.5px;color:var(--muted);">Scrolls across the top of the class-select (login) screen, for every teacher, on every class. Leave blank to show nothing.</p>
      <textarea id="gateAnnInput" rows="2" placeholder="e.g. Teachers: please select your class and key in your password" style="width:100%;padding:6px;font:inherit;">${esc(loadGateAnnouncement())}</textarea>
    </div>
    <div class="card">
      <h2>Class Announcements</h2>
      <p style="font-size:12.5px;color:var(--muted);">A note only that class's teacher sees, at the top of their Students tab. Leave blank to show nothing.</p>
      ${classes.length ? classes.map((c) => {
        const ann = getAnnouncementFor(c.id);
        return `
        <div style="margin-bottom:12px;">
          <label>${esc(c.name)}</label>
          <textarea class="ann-input" data-class="${esc(c.id)}" rows="2" placeholder="e.g. Submit Term 2 scores by Friday" style="width:100%;padding:6px;font:inherit;">${esc(ann.text)}</textarea>
        </div>`;
      }).join("") : `<div class="empty">No classes yet — add one above.</div>`}
    </div>
    <div class="card">
      <h2>Admin PIN</h2>
      ${getAdminPin() === DEFAULT_ADMIN_PIN
        ? `<p style="font-size:12.5px;color:#9a6c10;background:var(--warning-bg);border-left:4px solid var(--warning);padding:8px 10px;border-radius:8px;"><b>This is still the default PIN (${DEFAULT_ADMIN_PIN}).</b> Anyone who has seen the app's code knows it — set your own below.</p>`
        : `<p style="font-size:12.5px;color:var(--muted);">A custom PIN is set on this device.</p>`}
      <div class="row">
        <input type="password" id="newAdminPin" placeholder="New PIN" inputmode="numeric" style="padding:6px;">
        <button class="btn small secondary" id="saveAdminPinBtn">Save PIN</button>
      </div>
    </div>
    <div class="card">
      <h2>Export — All Classes: Preview, Excel & PDF</h2>
      <p style="font-size:12.5px;color:var(--muted);">Covers every class. Preview the data before downloading it as a spreadsheet, or as a printable PDF (choose "Save as PDF" in the print window). Teachers can export only their own class, from the Class Report, Report Card and Broadsheet tabs.</p>
      <div class="row">
        <button class="btn secondary" id="adminPreviewBtn">👁 Preview</button>
        <button class="btn" id="adminExcelBtn">⬇ Excel</button>
        <button class="btn" id="adminPdfBtn">📄 PDF</button>
      </div>
    </div>
    <div class="card">
      <h2>Sync Across Devices</h2>
      <p style="font-size:12.5px;color:var(--muted);">
        Connects this device to your own Cloudflare Worker (see CLOUDFLARE-SETUP.md), so scores entered
        here and on another device merge automatically whenever both are online — down to the individual
        field, so two devices can edit different students, or different fields of the same student,
        without overwriting each other.
      </p>
      <label>Sync URL</label>
      <input id="syncUrlInput" class="no-caps" type="text" placeholder="https://your-worker.your-subdomain.workers.dev" value="${esc(cfg.url)}">
      <p style="font-size:11.5px;color:var(--muted);">No PIN needed for the Worker itself — just keep this URL private, like a password.</p>
      <div class="row" style="margin-top:8px;">
        <button class="btn" id="saveSyncBtn">Save & Connect</button>
        <button class="btn secondary" id="syncNowBtn">Sync Now</button>
      </div>
      <div id="syncStatusText" class="sync-status-pill"></div>
    </div>
    ${typeof localSyncCardHtml === "function" ? localSyncCardHtml() : ""}
    ${cfg.url ? renderConnectedDevicesCard() : ""}
    ${backupRestoreCardHtml()}
    ${deletedItemsCardHtml()}
    ${promoteCardHtml()}
    ${standardizeCardHtml()}
    ${cleanupCardHtml()}
    <div class="card">
      <h2>App Version</h2>
      <div style="font-size:13px;">St Stephen's Report Card System — <b>v${APP_VERSION}</b></div>
    </div>
  `;

  document.getElementById("addClassBtn").addEventListener("click", openClassPicker);
  wirePromoteCard();
  const stdBtn = document.getElementById("standardizeClassesBtn");
  if (stdBtn) stdBtn.addEventListener("click", runStandardizeClasses);
  wireStudentSearch(el);

  el.querySelectorAll(".class-code-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const list = loadClasses();
      const cls = list.find((c) => c.id === inp.dataset.class);
      if (!cls) return;
      cls.accessCode = inp.value.trim() || undefined;
      saveClasses(list);
      toast("Access code saved");
    });
  });
  el.querySelectorAll(".ann-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      setAnnouncementFor(inp.dataset.class, inp.value);
      toast("Announcement saved");
    });
  });
  const gateAnnInput = document.getElementById("gateAnnInput");
  if (gateAnnInput) {
    gateAnnInput.addEventListener("change", () => {
      saveGateAnnouncement(gateAnnInput.value);
      toast("School announcement saved");
      if (typeof updateGateMarquee === "function") updateGateMarquee();
    });
  }
  document.getElementById("saveAdminPinBtn").addEventListener("click", () => {
    const val = document.getElementById("newAdminPin").value.trim();
    if (!val) { toast("Enter a PIN first"); return; }
    setAdminPin(val);
    toast("Admin PIN updated");
    document.getElementById("newAdminPin").value = "";
  });

  document.getElementById("adminPreviewBtn").addEventListener("click", () => previewExport());
  document.getElementById("adminExcelBtn").addEventListener("click", () => exportClassToExcel());
  document.getElementById("adminPdfBtn").addEventListener("click", () => exportToPdf());

  document.getElementById("saveSyncBtn").addEventListener("click", () => {
    const url = document.getElementById("syncUrlInput").value.trim();
    if (!url) { toast("Enter a Sync URL first"); return; }
    Sync.setConfig({ url: url });
    toast("Saved — syncing…");
    Sync.syncNow({ force: true });
  });
  document.getElementById("syncNowBtn").addEventListener("click", () => Sync.syncNow({ force: true }));

  el.querySelectorAll(".device-name-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      renameDevice(inp.dataset.device, inp.value);
      toast("Device name saved");
      if (typeof Sync !== "undefined" && Sync.isConfigured()) Sync.syncNow();
    });
  });

  if (typeof wireLocalSyncHandlers === "function") wireLocalSyncHandlers();
  wireBackupRestoreHandlers();

  const undoBtn = document.getElementById("undoLastBtn");
  if (undoBtn) undoBtn.addEventListener("click", () => runRestore(undoLastDelete()));
  el.querySelectorAll(".restore-btn").forEach((btn) => {
    btn.addEventListener("click", () => runRestore(restoreDeletion(btn.dataset.entry)));
  });

  const cleanupBtn = document.getElementById("cleanupOrphansBtn");
  if (cleanupBtn) {
    cleanupBtn.addEventListener("click", () => {
      if (!confirm("Remove data left behind by deletions made before version 3.6.0? This cannot be undone.")) return;
      const result = cleanupLegacyOrphans();
      if (result.total === 0) toast("Nothing to clean up — no old hidden data found");
      else toast("Removed " + result.total + " leftover record" + (result.total === 1 ? "" : "s") + " from before 3.6.0");
      renderAll();
    });
  }
}
