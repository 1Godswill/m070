/* ================= DELETE, HISTORY & UNDO =================
   Deleting something REALLY deletes it: a pupil takes their scores and
   attendance with them, a class takes its pupils, subjects, scores,
   register and announcement, a subject takes its scores and every pupil's
   "Not taking" tick for it. Nothing is left behind, hidden but still
   stored, on this device, in backups or on the sync server.

   Before anything is removed, exactly what is about to go is saved as one
   entry in the "history" section (Admin tab -> Deleted Items). Restore puts
   it back. Restore only FILLS GAPS: it never overwrites something that is
   there now, so it is always safe to press.

   History is a normal synced section (any device's admin can undo a delete
   made on any other device) but it is kept OUT of Backup files, and entries
   expire after HISTORY_KEEP_DAYS (or once there are more than
   HISTORY_MAX_ENTRIES) so deleted pupils' records do not live forever. */

const HISTORY_KEEP_DAYS = 60;
const HISTORY_MAX_ENTRIES = 50;

function loadHistory() { return DB.get("history", {}); }
function saveHistory(h) { const prev = loadHistory(); DB.set("history", h); commitSection("history", prev, h); }

// Newest first. Entries arrive from sync, so anything malformed is ignored.
function historyEntries() {
  const h = loadHistory();
  return Object.keys(h)
    .map((id) => h[id])
    .filter((e) => e && typeof e === "object" && isSafeId(e.id) && typeof e.at === "number" && typeof e.snapshot === "string")
    .sort((a, b) => b.at - a.at);
}
function lastUndoableEntry() { return historyEntries().find((e) => !e.restoredAt) || null; }

function currentDeviceName() {
  const d = loadDevices()[getDeviceId()];
  return (d && d.name) || defaultDeviceName();
}

// Saves the snapshot of what is about to be deleted. Throws if it cannot be
// saved (e.g. the browser's storage is full) — callers then delete nothing.
function recordDeletion(kind, label, snapshot) {
  const h = loadHistory();
  const id = newId();
  const now = Date.now();
  h[id] = { id: id, at: now, kind: kind, label: label, by: currentDeviceName(), snapshot: JSON.stringify(snapshot) };
  const keepFrom = now - HISTORY_KEEP_DAYS * 24 * 3600 * 1000;
  Object.keys(h)
    .sort((a, b) => ((h[b] && h[b].at) || 0) - ((h[a] && h[a].at) || 0))
    .forEach((k, i) => { if (i >= HISTORY_MAX_ENTRIES || ((h[k] && h[k].at) || 0) < keepFrom) delete h[k]; });
  saveHistory(h);
  return id;
}

// A missing value, or an empty {} left behind by an earlier sync merge, counts as "not there".
function isMissing(v) { return v === undefined || (isPlainObject(v) && Object.keys(v).length === 0); }
function isBadKey(k) { return k === "__proto__" || k === "constructor" || k === "prototype"; }
// Copies from src into target only where target has nothing yet.
function fillMissing(target, src) {
  if (!isPlainObject(src) || !isPlainObject(target)) return;
  Object.keys(src).forEach((k) => {
    if (isBadKey(k)) return;
    if (isMissing(target[k])) target[k] = src[k];
    else if (isPlainObject(target[k]) && isPlainObject(src[k])) fillMissing(target[k], src[k]);
  });
}
function className(classId) {
  const c = loadClasses().find((x) => x.id === classId);
  return c ? c.name : "a deleted class";
}
function deleteFailed(e) {
  if (typeof toast === "function") toast("Could not save an undo copy (storage full?), so nothing was deleted");
  console.error("delete aborted:", e);
  return false;
}

/* ---------- DELETE ---------- */

function deleteStudent(studentId) {
  const students = loadStudents();
  const rec = students.find((s) => s.id === studentId);
  if (!rec) return false;
  const classId = rec.classId;

  const scores = loadScores();
  const snapScores = {};           // term -> subject -> {test1,test2,exam}
  let scoresTouched = false;
  const byTerm = scores[classId];
  if (byTerm) {
    Object.keys(byTerm).forEach((term) => {
      const bySubject = byTerm[term] || {};
      Object.keys(bySubject).forEach((subj) => {
        const cell = bySubject[subj];
        if (cell && studentId in cell) {
          if (!isMissing(cell[studentId])) {
            snapScores[term] = snapScores[term] || {};
            snapScores[term][subj] = cell[studentId];
          }
          delete cell[studentId];
          scoresTouched = true;
        }
      });
    });
  }

  const att = loadAttendance();
  let snapAtt = null;
  if (att[classId] && att[classId].students && att[classId].students[studentId] !== undefined) {
    snapAtt = att[classId].students[studentId];
    delete att[classId].students[studentId];
  }

  try {
    recordDeletion("student", (rec.name || "Unnamed pupil") + " (" + className(classId) + ")",
      { student: rec, scores: snapScores, attendance: snapAtt });
  } catch (e) { return deleteFailed(e); }

  saveStudents(students.filter((s) => s.id !== studentId));
  if (scoresTouched) saveScores(scores);
  if (snapAtt !== null) saveAttendance(att);
  return true;
}

function deleteClass(classId) {
  const classes = loadClasses();
  const cls = classes.find((c) => c.id === classId);
  if (!cls) return false;

  const students = loadStudents();
  const classStudents = students.filter((s) => s.classId === classId);
  const cs = loadClassSubjects(), scores = loadScores(), att = loadAttendance();
  const ann = loadAnnouncements(), tomb = loadSubjectTomb();

  const snapTomb = {};
  Object.keys(tomb).forEach((k) => { if (k.indexOf(classId + "::") === 0) { snapTomb[k] = tomb[k]; delete tomb[k]; } });

  try {
    recordDeletion("class", cls.name || "Unnamed class", {
      cls: cls, students: classStudents, subjects: cs[classId] || [], scores: scores[classId] || {},
      attendance: att[classId] || null, announcement: ann[classId] || null, subjectTomb: snapTomb,
    });
  } catch (e) { return deleteFailed(e); }

  saveClasses(classes.filter((c) => c.id !== classId));
  saveStudents(students.filter((s) => s.classId !== classId));
  if (classId in cs) { delete cs[classId]; saveClassSubjects(cs); }
  if (classId in scores) { delete scores[classId]; saveScores(scores); }
  if (classId in att) { delete att[classId]; saveAttendance(att); }
  if (classId in ann) { delete ann[classId]; saveAnnouncements(ann); }
  if (Object.keys(snapTomb).length) saveSubjectTomb(tomb);
  DB.set("currentClassId", null);
  return true;
}

function removeSubjectFromClass(classId, subjectName) {
  const cs = loadClassSubjects();
  const list = cs[classId] || [];
  const index = list.indexOf(subjectName);

  const scores = loadScores();
  const snapScores = {};           // term -> studentId -> {test1,test2,exam}
  let scoresTouched = false;
  if (scores[classId]) {
    TERMS.forEach((t) => {
      const bySubject = scores[classId][t];
      if (bySubject && subjectName in bySubject) {
        snapScores[t] = bySubject[subjectName];
        delete bySubject[subjectName];
        scoresTouched = true;
      }
    });
  }

  // "Not taking" ticks belong to the subject too — otherwise re-adding a
  // subject with the same name would bring old ticks back.
  const students = loadStudents();
  const notTakingIds = [];
  students.forEach((st) => {
    if (st.classId === classId && st.notTaking && st.notTaking[subjectName]) {
      notTakingIds.push(st.id);
      st.notTaking = Object.assign({}, st.notTaking);
      st.notTaking[subjectName] = undefined;
    }
  });

  try {
    recordDeletion("subject", subjectName + " (" + className(classId) + ")",
      { classId: classId, subject: subjectName, index: index, scores: snapScores, notTaking: notTakingIds });
  } catch (e) { return deleteFailed(e); }

  cs[classId] = list.filter((s) => s !== subjectName);
  saveClassSubjects(cs);
  if (scoresTouched) saveScores(scores);
  if (notTakingIds.length) saveStudents(students);
  const tomb = loadSubjectTomb();
  tomb[subjectTombKey(classId, subjectName)] = true;
  saveSubjectTomb(tomb);
  return true;
}

function removeLastAttendanceWeek(classId) {
  const a = loadAttendance();
  const rec = a[classId];
  if (!rec || !rec.schoolOpensPerWeek || rec.schoolOpensPerWeek.length === 0) return false;
  const weekIdx = rec.schoolOpensPerWeek.length - 1;
  const present = {};
  Object.keys(rec.students || {}).forEach((sid) => {
    const arr = rec.students[sid];
    if (arr && arr.length > weekIdx) present[sid] = arr[weekIdx];
  });
  const tag = Array.isArray(rec.weekTerms) && TERM_TAGS.includes(rec.weekTerms[weekIdx]) ? rec.weekTerms[weekIdx] : null;

  try {
    recordDeletion("week", "Week " + (weekIdx + 1) + " register (" + className(classId) + ")",
      { classId: classId, weekIdx: weekIdx, opens: rec.schoolOpensPerWeek[weekIdx], term: tag, present: present });
  } catch (e) { return deleteFailed(e); }

  rec.schoolOpensPerWeek.splice(weekIdx, 1);
  if (Array.isArray(rec.weekTerms) && rec.weekTerms.length > weekIdx) rec.weekTerms.splice(weekIdx, 1);
  // Target this exact week index per student, not just "whatever's last in
  // their array" — a student's array can be shorter than the week count if
  // their most recent week was never edited.
  Object.keys(rec.students || {}).forEach((sid) => {
    const arr = rec.students[sid];
    if (arr && arr.length > weekIdx) arr.splice(weekIdx, 1);
  });
  saveAttendance(a);
  return true;
}

/* ---------- RESTORE ---------- */

const RESTORE = {
  student(snap) {
    const st = snap.student;
    if (!st || !isSafeId(st.id) || !isSafeId(st.classId)) throw new Error("This entry is damaged");
    const classId = st.classId;
    if (!loadClasses().some((c) => c.id === classId)) return { ok: false, message: "That pupil's class was deleted too — restore the class first." };

    const students = loadStudents();
    if (!students.some((s) => s.id === st.id)) { students.push(st); saveStudents(students); }

    let skipped = 0;
    const subjects = subjectsForClass(classId);
    const scores = loadScores();
    TERMS.forEach((t) => {
      const bySubject = (snap.scores || {})[t];
      if (!isPlainObject(bySubject)) return;
      Object.keys(bySubject).forEach((subj) => {
        if (isBadKey(subj)) return;
        if (!subjects.includes(subj)) { skipped++; return; }
        scores[classId] = scores[classId] || {};
        scores[classId][t] = scores[classId][t] || {};
        scores[classId][t][subj] = scores[classId][t][subj] || {};
        if (isMissing(scores[classId][t][subj][st.id])) scores[classId][t][subj][st.id] = bySubject[subj];
      });
    });
    saveScores(scores);

    const att = loadAttendance();
    const nWeeks = att[classId] && att[classId].schoolOpensPerWeek ? att[classId].schoolOpensPerWeek.length : 0;
    if (nWeeks > 0 && Array.isArray(snap.attendance)) {
      att[classId].students = att[classId].students || {};
      if (att[classId].students[st.id] === undefined) att[classId].students[st.id] = snap.attendance.slice(0, nWeeks);
      saveAttendance(att);
    }
    return { ok: true, message: "Restored " + (st.name || "pupil") + (skipped ? " — " + skipped + " score set(s) for subjects that no longer exist were not restored" : "") };
  },

  class(snap) {
    const cls = snap.cls;
    if (!cls || !isSafeId(cls.id)) throw new Error("This entry is damaged");
    const classId = cls.id;
    const studentsSnap = Array.isArray(snap.students) ? snap.students : [];
    if (studentsSnap.some((s) => !s || !isSafeId(s.id))) throw new Error("This entry is damaged");

    const classes = loadClasses();
    if (!classes.some((c) => c.id === classId)) { classes.push(cls); saveClasses(classes); }

    const students = loadStudents();
    const have = new Set(students.map((s) => s.id));
    let added = false;
    studentsSnap.forEach((s) => { if (!have.has(s.id)) { students.push(Object.assign({}, s, { classId: classId })); added = true; } });
    if (added) saveStudents(students);

    const cs = loadClassSubjects();
    const cur = cs[classId] || [];
    (Array.isArray(snap.subjects) ? snap.subjects : []).forEach((s) => { if (typeof s === "string" && !cur.includes(s)) cur.push(s); });
    cs[classId] = cur;
    saveClassSubjects(cs);

    const scores = loadScores();
    scores[classId] = scores[classId] || {};
    fillMissing(scores[classId], snap.scores || {});
    saveScores(scores);

    const att = loadAttendance();
    if (isMissing(att[classId]) && snap.attendance) { att[classId] = snap.attendance; saveAttendance(att); }

    const ann = loadAnnouncements();
    if (isMissing(ann[classId]) && snap.announcement) { ann[classId] = snap.announcement; saveAnnouncements(ann); }

    const tomb = loadSubjectTomb();
    let tombTouched = false;
    Object.keys(snap.subjectTomb || {}).forEach((k) => { if (k.indexOf(classId + "::") === 0 && tomb[k] === undefined) { tomb[k] = snap.subjectTomb[k]; tombTouched = true; } });
    if (tombTouched) saveSubjectTomb(tomb);

    DB.set("currentClassId", classId);
    return { ok: true, message: "Restored class " + (cls.name || "") + " with its " + studentsSnap.length + " pupil(s)" };
  },

  subject(snap) {
    const classId = snap.classId, subj = snap.subject;
    if (!isSafeId(classId) || typeof subj !== "string" || !subj || isBadKey(subj)) throw new Error("This entry is damaged");
    if (!loadClasses().some((c) => c.id === classId)) return { ok: false, message: "That subject's class was deleted too — restore the class first." };

    const cs = loadClassSubjects();
    const list = cs[classId] || [];
    if (!list.includes(subj)) {
      const at = Number.isInteger(snap.index) && snap.index >= 0 ? Math.min(snap.index, list.length) : list.length;
      list.splice(at, 0, subj);
      cs[classId] = list;
      saveClassSubjects(cs);
    }

    const studentIds = new Set(loadStudents().filter((s) => s.classId === classId).map((s) => s.id));
    const scores = loadScores();
    TERMS.forEach((t) => {
      const bySid = (snap.scores || {})[t];
      if (!isPlainObject(bySid)) return;
      Object.keys(bySid).forEach((sid) => {
        if (isBadKey(sid) || !studentIds.has(sid)) return;
        scores[classId] = scores[classId] || {};
        scores[classId][t] = scores[classId][t] || {};
        scores[classId][t][subj] = scores[classId][t][subj] || {};
        if (isMissing(scores[classId][t][subj][sid])) scores[classId][t][subj][sid] = bySid[sid];
      });
    });
    saveScores(scores);

    const ids = (Array.isArray(snap.notTaking) ? snap.notTaking : []).filter((sid) => studentIds.has(sid));
    if (ids.length) {
      const students = loadStudents();
      students.forEach((st) => {
        if (ids.includes(st.id) && !(st.notTaking && st.notTaking[subj])) {
          st.notTaking = Object.assign({}, st.notTaking);
          st.notTaking[subj] = true;
        }
      });
      saveStudents(students);
    }

    const tomb = loadSubjectTomb();
    const key = subjectTombKey(classId, subj);
    if (tomb[key]) { tomb[key] = false; saveSubjectTomb(tomb); }
    return { ok: true, message: "Restored subject " + subj };
  },

  week(snap) {
    const classId = snap.classId, weekIdx = snap.weekIdx;
    if (!isSafeId(classId) || !Number.isInteger(weekIdx) || weekIdx < 0) throw new Error("This entry is damaged");
    if (!loadClasses().some((c) => c.id === classId)) return { ok: false, message: "That week's class was deleted too — restore the class first." };

    const a = loadAttendance();
    a[classId] = a[classId] || { schoolOpensPerWeek: [], students: {} };
    const rec = a[classId];
    rec.students = rec.students || {};
    if (rec.schoolOpensPerWeek.length !== weekIdx) {
      return { ok: false, message: "The register has changed since — a week can only be restored while it is still the next empty week." };
    }
    const tags = [];
    for (let i = 0; i < weekIdx; i++) { const t = (rec.weekTerms || [])[i]; tags.push(TERM_TAGS.includes(t) ? t : null); }
    tags.push(TERM_TAGS.includes(snap.term) ? snap.term : null);
    rec.schoolOpensPerWeek.push(Number(snap.opens) || 0);
    rec.weekTerms = tags;

    const studentIds = new Set(loadStudents().filter((s) => s.classId === classId).map((s) => s.id));
    Object.keys(snap.present || {}).forEach((sid) => {
      if (isBadKey(sid) || !studentIds.has(sid)) return;
      const arr = rec.students[sid] || [];
      while (arr.length < weekIdx) arr.push(0);
      if (arr.length === weekIdx) arr.push(Number(snap.present[sid]) || 0);
      rec.students[sid] = arr;
    });
    saveAttendance(a);
    return { ok: true, message: "Restored Week " + (weekIdx + 1) };
  },
};

// Puts one deleted item back. Returns { ok, message } — the caller shows the message.
function restoreDeletion(entryId) {
  const h = loadHistory();
  const e = h[entryId];
  if (!e || typeof e.snapshot !== "string") return { ok: false, message: "That history entry no longer exists." };
  if (e.restoredAt) return { ok: false, message: "Already restored." };
  let snap;
  try { snap = JSON.parse(e.snapshot); } catch (err) { return { ok: false, message: "This entry is damaged and can't be restored." }; }
  const fn = Object.prototype.hasOwnProperty.call(RESTORE, e.kind) ? RESTORE[e.kind] : null;
  if (!fn || !isPlainObject(snap)) return { ok: false, message: "This entry is damaged and can't be restored." };
  let result;
  try { result = fn(snap); } catch (err) { return { ok: false, message: err.message || "Couldn't restore this entry." }; }
  if (result.ok) {
    const fresh = loadHistory();
    if (fresh[entryId]) { fresh[entryId] = Object.assign({}, fresh[entryId], { restoredAt: Date.now() }); saveHistory(fresh); }
  }
  return result;
}

function undoLastDelete() {
  const e = lastUndoableEntry();
  if (!e) return { ok: false, message: "Nothing to undo." };
  return restoreDeletion(e.id);
}

/* ---------- One-time cleanup of data hidden by pre-3.6.0 versions ----------
   Before 3.6.0, deleting a pupil / class / subject only removed the item
   itself from its list — everything that belonged to it stayed in storage
   forever (see the 3.6.0 changelog entry). For a deleted class that
   includes its own pupils, not just their scores: deleting a class used to
   leave its pupils sitting in the students list, pointing at a classId
   that no longer exists anywhere. None of this leftover data is reachable
   from the app any more, but it was still syncing to every device and
   sitting in the Worker's database.
   This scans every section for exactly that: data whose pupil, class or
   subject does not exist today, and nothing else. It never looks at
   anything created under 3.6.0+, since real deletions since then already
   take everything with them.
   Safe to run more than once (and safe to run when there is nothing to
   clean) — it only ever removes what genuinely has nowhere it belongs any
   more, and it goes through the normal saveX() path so the removal is
   timestamped and synced like any other edit, instead of just vanishing
   from this one device until a stale peer hands it back. There is no
   Undo for this one: the point is data the app has had no way to show or
   restore for a long time already. */
function cleanupLegacyOrphans() {
  const classIds = new Set(loadClasses().map((c) => c.id));

  // Pupils themselves, left behind by a class deleted under an old version.
  // Deleting a class now takes its pupils with it (see the 3.6.0 changelog),
  // but before that, deleting a class removed only the class — its pupils
  // stayed in the students list, pointing at a classId that no longer
  // exists anywhere in the app.
  let students = loadStudents();
  const beforeCount = students.length;
  students = students.filter((s) => classIds.has(s.classId));
  let studentsTouched = students.length !== beforeCount;

  const liveStudentsByClass = {};
  students.forEach((s) => { (liveStudentsByClass[s.classId] || (liveStudentsByClass[s.classId] = new Set())).add(s.id); });
  const cs = loadClassSubjects();
  const subjectsByClass = {};
  Object.keys(cs).forEach((classId) => { subjectsByClass[classId] = new Set(Array.isArray(cs[classId]) ? cs[classId] : []); });

  const removed = { classSections: 0, students: 0, pupils: beforeCount - students.length, subjects: 0, notTaking: 0 };

  // scores: classId -> term -> subject -> studentId -> {test1,test2,exam}
  const scores = loadScores();
  let scoresTouched = false;
  Object.keys(scores).forEach((classId) => {
    if (!classIds.has(classId)) { delete scores[classId]; scoresTouched = true; removed.classSections++; return; }
    const liveSubjects = subjectsByClass[classId] || new Set();
    const liveStudents = liveStudentsByClass[classId] || new Set();
    Object.keys(scores[classId] || {}).forEach((term) => {
      const bySubject = scores[classId][term] || {};
      Object.keys(bySubject).forEach((subject) => {
        if (!liveSubjects.has(subject)) { delete bySubject[subject]; scoresTouched = true; removed.subjects++; return; }
        const cell = bySubject[subject] || {};
        Object.keys(cell).forEach((studentId) => {
          if (!liveStudents.has(studentId)) { delete cell[studentId]; scoresTouched = true; removed.students++; }
        });
      });
    });
  });

  // attendance: classId -> { students: {studentId: [...]}, ... }
  const att = loadAttendance();
  let attTouched = false;
  Object.keys(att).forEach((classId) => {
    if (!classIds.has(classId)) { delete att[classId]; attTouched = true; removed.classSections++; return; }
    const rec = att[classId];
    if (rec && rec.students) {
      const liveStudents = liveStudentsByClass[classId] || new Set();
      Object.keys(rec.students).forEach((sid) => {
        if (!liveStudents.has(sid)) { delete rec.students[sid]; attTouched = true; removed.students++; }
      });
    }
  });

  // announcements: classId -> {...}
  const ann = loadAnnouncements();
  let annTouched = false;
  Object.keys(ann).forEach((classId) => {
    if (!classIds.has(classId)) { delete ann[classId]; annTouched = true; removed.classSections++; }
  });

  // classSubjects: an orphaned classId entry (the class itself is long gone)
  let csTouched = false;
  Object.keys(cs).forEach((classId) => {
    if (!classIds.has(classId)) { delete cs[classId]; csTouched = true; removed.classSections++; }
  });

  // "Not taking" ticks for a subject the class no longer has
  students.forEach((st) => {
    if (!st.notTaking) return;
    const liveSubjects = subjectsByClass[st.classId] || new Set();
    Object.keys(st.notTaking).forEach((subj) => {
      if (st.notTaking[subj] && !liveSubjects.has(subj)) {
        st.notTaking = Object.assign({}, st.notTaking);
        st.notTaking[subj] = undefined;
        studentsTouched = true;
        removed.notTaking++;
      }
    });
  });

  // subjectTomb: a tombstone guarding a class that no longer exists has nothing left to protect
  const tomb = loadSubjectTomb();
  let tombTouched = false;
  Object.keys(tomb).forEach((key) => {
    if (!classIds.has(key.split("::")[0])) { delete tomb[key]; tombTouched = true; }
  });

  if (scoresTouched) saveScores(scores);
  if (attTouched) saveAttendance(att);
  if (annTouched) saveAnnouncements(ann);
  if (csTouched) saveClassSubjects(cs);
  if (studentsTouched) saveStudents(students);
  if (tombTouched) saveSubjectTomb(tomb);

  const total = removed.classSections + removed.students + removed.pupils + removed.subjects + removed.notTaking;
  return { total: total, removed: removed };
}
