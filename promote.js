/* ================= PROMOTION (v3.10.0) =================
   1. End-of-session: each pupil is Promoted (next class), kept as a Repeater, or marked as
      Left school. The last class graduates. Bio data (name, gender, subjects they don't take)
      moves with the pupil; the session's scores, registers and teacher remarks are cleared,
      and a backup file downloads first.
   2. Mid-year move (Term 2 or 3): Term 1 (and 2) stay in the old class exactly as issued; the
      pupil counts as on the new class's roll from the join term, and their Annual there is
      averaged over the terms they attended. See classMembers() in app.js.
   Graduates / leavers keep their record under a hidden class id, so nothing is deleted. */

const GRAD_ID = "cls-graduated";
const LEFT_ID = "cls-left";
const PROMO_CLEAR_FIELDS = ["joinTerm", "moves", "joinWeek", "leaveWeek", "joinEligibleDays", "leaveEligibleDays"];

function promoClassLabel(id) {
  if (id === GRAD_ID) return "Graduate";
  const c = CLASS_CATALOG.find((x) => x.id === id) || loadClasses().find((x) => x.id === id);
  return c ? (c.label || c.name) : id;
}
function promoNextClassId(classId) {
  const i = CLASS_CATALOG.findIndex((c) => c.id === classId);
  if (i < 0) return "";                                  // not on the fixed list: admin must choose
  return i < CLASS_CATALOG.length - 1 ? CLASS_CATALOG[i + 1].id : GRAD_ID;
}
function promoDestOptions(selected) {
  return `<option value="">— choose —</option>` +
    CLASS_CATALOG.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.label)}</option>`).join("") +
    `<option value="${GRAD_ID}" ${selected === GRAD_ID ? "selected" : ""}>Graduate</option>`;
}
function promoEnsureClass(list, id) {
  if (id === GRAD_ID || list.some((c) => c.id === id)) return;
  const e = CLASS_CATALOG.find((c) => c.id === id);
  if (e) list.push({ id: e.id, name: e.label });
}
function promoSortedClasses() {
  const idx = (c) => { const i = CLASS_CATALOG.findIndex((x) => x.id === c.id); return i < 0 ? 999 : i; };
  return loadClasses().slice().sort((a, b) => idx(a) - idx(b));
}

function promoteCardHtml() {
  return `
    <div class="card">
      <h2>Promote Pupils</h2>
      <p style="font-size:12.5px;color:var(--muted);">
        <b>End of session:</b> move pupils up to the next class (tick who repeats or leaves), with their
        bio data. Scores and registers are cleared for the new session, so export the report cards first.
        A backup downloads automatically. Run it on <b>one</b> device after every device has synced.<br>
        <b>Mid-year:</b> move one excelling pupil up in Term 2 or Term 3. Earlier terms stay in the old class.
      </p>
      <div class="row">
        <button class="btn secondary" id="promoteSessionBtn">🎓 Promote class(es)</button>
        <button class="btn secondary" id="promoteMidBtn">↗ Move one pupil mid-year</button>
      </div>
    </div>`;
}
function wirePromoteCard() {
  const a = document.getElementById("promoteSessionBtn");
  const b = document.getElementById("promoteMidBtn");
  if (a) a.addEventListener("click", openPromotionModal);
  if (b) b.addEventListener("click", openMidYearModal);
}

/* ---------- 1. End-of-session promotion ---------- */
function openPromotionModal() {
  const classes = promoSortedClasses().filter((c) => loadStudents().some((s) => s.classId === c.id));
  if (!classes.length) { toast("No pupils to promote"); return; }
  const defaultSession = (() => {
    const cur = (classes[0].session || "").match(/(\d{4})\s*[\/-]\s*(\d{4})/);
    return cur ? `${Number(cur[1]) + 1}/${Number(cur[2]) + 1}` : "";
  })();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const blocks = classes.map((c) => {
    const pupils = studentsInClass(c.id);
    return `
      <div style="margin:10px 0;padding:8px;border:1px solid var(--border,#d8dde6);border-radius:10px;">
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;">
          <b>${esc(promoClassLabel(c.id))} <span style="font-weight:400;color:var(--muted);">(${pupils.length})</span></b>
          <span style="font-size:12px;">→ <select class="pm-dest" data-cls="${esc(c.id)}">${promoDestOptions(promoNextClassId(c.id))}</select></span>
        </div>
        ${pupils.map((s) => `
          <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:6px;font-size:13px;">
            <span>${esc(s.name || "(unnamed)")}</span>
            <select class="pm-act" data-cls="${esc(c.id)}" data-stu="${esc(s.id)}" style="max-width:130px;">
              <option value="promote" ${s.leaveWeek == null || s.leaveWeek === "" ? "selected" : ""}>Promote</option>
              <option value="repeat">Repeat</option>
              <option value="leave" ${s.leaveWeek != null && s.leaveWeek !== "" ? "selected" : ""}>Left school</option>
            </select>
          </div>`).join("")}
      </div>`;
  }).join("");
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:440px;max-height:90vh;overflow:auto;">
      <h2 style="margin:0 0 4px;">Promote Pupils</h2>
      <p style="font-size:12.5px;color:var(--muted);margin:0 0 8px;">Everyone defaults to <b>Promote</b>. Change anyone who repeats or has left.</p>
      <label>New session (e.g. 2026/2027)</label>
      <input type="text" id="pmSession" value="${esc(defaultSession)}" placeholder="2026/2027">
      ${blocks}
      <div id="pmSummary" style="font-size:12.5px;margin:8px 0;"></div>
      <div class="row">
        <button type="button" class="btn secondary" id="pmCancel">Cancel</button>
        <button type="button" class="btn" id="pmGo">Promote now</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const readPlan = () => {
    const plan = { dest: {}, act: {}, counts: { promote: 0, repeat: 0, graduate: 0, leave: 0 }, missing: [] };
    overlay.querySelectorAll(".pm-dest").forEach((d) => { plan.dest[d.dataset.cls] = d.value; });
    overlay.querySelectorAll(".pm-act").forEach((a) => {
      plan.act[a.dataset.stu] = { cls: a.dataset.cls, action: a.value };
      if (a.value === "repeat") plan.counts.repeat++;
      else if (a.value === "leave") plan.counts.leave++;
      else if (!plan.dest[a.dataset.cls]) { if (plan.missing.indexOf(a.dataset.cls) < 0) plan.missing.push(a.dataset.cls); }
      else if (plan.dest[a.dataset.cls] === GRAD_ID) plan.counts.graduate++;
      else plan.counts.promote++;
    });
    return plan;
  };
  const refresh = () => {
    const p = readPlan();
    overlay.querySelector("#pmSummary").innerHTML =
      `<b>${p.counts.promote}</b> promoted · <b>${p.counts.repeat}</b> repeating · <b>${p.counts.graduate}</b> graduating · <b>${p.counts.leave}</b> left` +
      (p.missing.length ? `<br><span style="color:#b3261e;">Choose a destination for: ${p.missing.map(promoClassLabel).map(esc).join(", ")}</span>` : "");
  };
  overlay.addEventListener("change", refresh);
  refresh();
  overlay.querySelector("#pmCancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#pmGo").addEventListener("click", () => {
    const plan = readPlan();
    const session = overlay.querySelector("#pmSession").value.trim();
    if (plan.missing.length) { toast("Choose a destination for every class"); return; }
    if (!session) { toast("Enter the new session, e.g. 2026/2027"); return; }
    const c = plan.counts;
    const msg = `${c.promote} promoted, ${c.repeat} repeating, ${c.graduate} graduating, ${c.leave} left.\n\n` +
      `This CLEARS all scores, registers and teacher remarks for every class (the old session's report cards can no longer be opened). ` +
      `Have you exported the report cards? A backup file downloads first.\n\nContinue?`;
    if (!confirm(msg)) return;
    if ((prompt("Type PROMOTE to confirm") || "").trim().toUpperCase() !== "PROMOTE") { toast("Cancelled"); return; }
    overlay.remove();
    runPromotion(plan, session);
  });
}

function runPromotion(plan, session) {
  downloadBackupFile();
  const stu = loadStudents();
  const cls = loadClasses();
  const stay = {}, arrive = {};     // destination classId -> pupils, in their old register order
  const orderOf = (s, i) => (s.order != null ? s.order : 1e9 + i);

  stu.map((s, i) => ({ s, i })).sort((a, b) => orderOf(a.s, a.i) - orderOf(b.s, b.i)).forEach(({ s }) => {
    const p = plan.act[s.id];
    if (!p) return;                                         // not on screen (already graduated/left)
    const from = s.classId;
    PROMO_CLEAR_FIELDS.forEach((k) => { s[k] = undefined; });
    s.remarks = { "1": undefined, "2": undefined, "3": undefined, "A": undefined };
    if (p.action === "leave") { s.lastClassId = from; s.classId = LEFT_ID; s.order = undefined; return; }
    if (p.action === "repeat") { (stay[from] = stay[from] || []).push(s); return; }
    const dest = plan.dest[from];
    if (dest === GRAD_ID) { s.lastClassId = from; s.classId = GRAD_ID; s.order = undefined; return; }
    promoEnsureClass(cls, dest);
    s.classId = dest;
    (arrive[dest] = arrive[dest] || []).push(s);
  });
  // register order in each class: repeaters first, then newcomers in their old order
  const dests = Object.keys(Object.assign({}, stay, arrive));
  dests.forEach((id) => {
    let n = 0;
    (stay[id] || []).concat(arrive[id] || []).forEach((s) => { s.order = n++; });
  });
  // one new epoch for every class: devices that missed this promotion see it on their next sync
  // and set aside their old-session scores/registers instead of merging them in (see sync.js)
  const epoch = cls.reduce((m, c) => Math.max(m, Number(c.epoch) || 0), 0) + 1;
  cls.forEach((c) => { c.session = session; c.epoch = epoch; });

  saveStudents(stu);
  saveClasses(cls);
  saveScores({});
  saveAttendance({});
  toast("Promotion done — new session " + session);
  renderAll();
}

/* ---------- 2. Mid-year move for one pupil ---------- */
function openMidYearModal() {
  const classes = promoSortedClasses().filter((c) => loadStudents().some((s) => s.classId === c.id));
  if (!classes.length) { toast("No pupils yet"); return; }
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:380px;">
      <h2 style="margin:0 0 4px;">Move pupil mid-year</h2>
      <p style="font-size:12.5px;color:var(--muted);margin:0 0 8px;">
        Earlier terms stay in the old class as issued. From the chosen term the pupil is on the new class's roll,
        and their Annual there is averaged over the terms they attend.
      </p>
      <label>Class now</label>
      <select id="mdFrom">${classes.map((c) => `<option value="${esc(c.id)}">${esc(promoClassLabel(c.id))}</option>`).join("")}</select>
      <label>Pupil</label>
      <select id="mdPupil"></select>
      <label>Move to</label>
      <select id="mdDest"></select>
      <label>Starts in</label>
      <select id="mdTerm"><option value="2">Term 2</option><option value="3">Term 3</option></select>
      <div class="row" style="margin-top:12px;">
        <button type="button" class="btn secondary" id="mdCancel">Cancel</button>
        <button type="button" class="btn" id="mdGo">Move pupil</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const fromSel = overlay.querySelector("#mdFrom"), pupilSel = overlay.querySelector("#mdPupil");
  const destSel = overlay.querySelector("#mdDest");
  const fill = () => {
    pupilSel.innerHTML = studentsInClass(fromSel.value).map((s) => `<option value="${esc(s.id)}">${esc(s.name || "(unnamed)")}</option>`).join("");
    const next = promoNextClassId(fromSel.value);
    destSel.innerHTML = promoDestOptions(next === GRAD_ID ? "" : next).replace(/<option value="cls-graduated"[^>]*>Graduate<\/option>/, "");
  };
  fromSel.addEventListener("change", fill);
  fill();
  overlay.querySelector("#mdCancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#mdGo").addEventListener("click", () => {
    const res = moveStudentMidYear(pupilSel.value, destSel.value, overlay.querySelector("#mdTerm").value);
    if (res !== true) { toast(res); return; }
    overlay.remove();
  });
}

function moveStudentMidYear(studentId, destId, term) {
  if (!studentId) return "Choose a pupil";
  if (!destId) return "Choose the new class";
  if (term !== "2" && term !== "3") return "Choose Term 2 or Term 3";
  const stu = loadStudents();
  const s = stu.find((x) => x.id === studentId);
  if (!s) return "Pupil not found";
  if (destId === s.classId) return "That is the pupil's current class";
  if (Number(s.joinTerm || 1) >= Number(term)) return "This pupil only joined this class in Term " + (s.joinTerm || 1) + " — pick a later term";
  const fromLabel = promoClassLabel(s.classId), toLabel = promoClassLabel(destId);
  if (!confirm(`Move ${s.name} from ${fromLabel} to ${toLabel} from Term ${term}?\n\n` +
    `• ${fromLabel} keeps Term ${Number(term) - 1 === 1 ? "1" : "1–" + (Number(term) - 1)} as issued.\n` +
    `• ${s.name} leaves ${fromLabel}'s roll, ranking and Annual from Term ${term}.\n` +
    `• In ${toLabel} the Annual is averaged over the terms attended.`)) return "Cancelled";

  const cls = loadClasses();
  promoEnsureClass(cls, destId);
  const oldClass = s.classId;
  const mates = stu.filter((x) => x.classId === destId);
  s.moves = (Array.isArray(s.moves) ? s.moves.slice() : []).concat([{ classId: oldClass, lastTerm: String(Number(term) - 1) }]);
  s.classId = destId;
  s.joinTerm = term;
  s.order = mates.reduce((m, x) => Math.max(m, x.order != null ? x.order : -1), -1) + 1;
  s.leaveWeek = undefined; s.leaveEligibleDays = undefined; s.joinEligibleDays = undefined;
  // attendance: weeks already recorded before their join term don't count against them
  const nWeeks = (attendanceForClass(destId).schoolOpensPerWeek || []).length;
  let jw = nWeeks;
  for (let w = 0; w < nWeeks; w++) { if (Number(weekTagFor(destId, w) || "1") >= Number(term)) { jw = w; break; } }
  s.joinWeek = jw > 0 ? jw : undefined;

  saveStudents(stu);
  saveClasses(cls);
  toast(`${s.name} moved to ${toLabel} from Term ${term}`);
  renderAll();
  return true;
}
