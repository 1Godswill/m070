/* St Stephen's Report Card System — core data + calculation engine.
   Data model: Classes -> each has its own Subject list -> Students belong
   to a class -> Scores keyed by class/term/subject/student.
   Grade/rank/annual logic mirrors the BASIC_5_222 spreadsheet exactly.
   Multi-device sync (see sync.js): per-field/per-record merge, so two
   devices can independently add/edit/delete different classes, students,
   or fields without overwriting each other — see CLOUDFLARE-SETUP.md. */

const TERMS = ["1", "2", "3"]; // "A" = Annual, computed, not stored directly

/* APP_VERSION now lives in version.js (loaded before this file). */

/* ---------- Admin PIN (gate for the Admin tab) — local to this device ---------- */
const DEFAULT_ADMIN_PIN = "4199";
function getAdminPin() { return DB.get("adminPin", DEFAULT_ADMIN_PIN); }
function setAdminPin(pin) { const prev = getAdminPin(); DB.set("adminPin", pin); commitSection("adminPin", prev, pin); }

/* ---------- Per-class access codes ----------
   A class may carry an optional cls.accessCode. Once a class needs a code,
   every tab that works on class data (Register, Score Entry, Class Report,
   Report Card, Broadsheet) is locked behind it until entered correctly for
   that class, once per app session. Unlocking resets on reload/close, same
   as the Admin PIN — a lightweight classroom-level gate, not encryption. */
let unlockedClassIds = new Set();
function classNeedsCode(classId) {
  const cls = loadClasses().find((c) => c.id === classId);
  return !!(cls && cls.accessCode);
}
function isClassUnlocked(classId) {
  return !classNeedsCode(classId) || unlockedClassIds.has(classId);
}
function unlockClassWithCode(classId, code) {
  const cls = loadClasses().find((c) => c.id === classId);
  if (cls && cls.accessCode && code === cls.accessCode) { unlockedClassIds.add(classId); return true; }
  return false;
}

/* Suggested subjects offered when adding a subject to a class — a starting
   point, not a restriction. Any class can also add a subject by typing a
   name that isn't in this list at all. */
const MASTER_SUBJECT_SUGGESTIONS = [
  "English Language", "Mathematics", "Social Studies", "Basic Science", "Basic Science & Tech",
  "P.H.E", "Robotics", "Robotic Science", "Agric Science", "Computer Science", "Home Economics",
  "CRK", "C.R.S.", "Music", "CCA", "Creative Arts", "Civic Education", "Verbal Reasoning",
  "Verbal Aptitude", "Quantitative", "Quantitative Reasoning", "Handwriting", "PAVS", "P.A.V.S",
  "French Language", "Literature in English", "Hausa", "Igbo", "Yoruba", "Gbagi", "Isoko", "Nembe",
  "Ogbia Language", "Pract. Robotics", "Pract. Sport", "Pract. CCA", "Pract. Basic",
  "Pract.Computer", "Pract. Economics", "Pract. Agric"
];

/* ---------- Storage layer (localStorage — persists offline on-device, this device only) ---------- */
/* Two ways to read:
   - DB.get(key, fb)  -> a FRESH copy every time. Use it whenever you are going to change
                         what you get back and then save it (every saveX() pattern).
   - DB.peek(key, fb) -> ONE shared, parsed copy that is reused until that key is written.
                         READ-ONLY: never modify what it returns. It exists so the grade
                         calculations (which look up thousands of cells per screen) do not
                         re-parse the whole database from storage on every lookup.
   DB.set skips the write entirely when nothing actually changed, and bumps _calcVersion
   when scores / students / subjects change so cached calculation tables are rebuilt. */
let _calcVersion = 0;
const CALC_KEYS = { scores: true, students: true, classSubjects: true };
const DB = {
  _peek: {},
  get(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  },
  peek(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(DB._peek, key)) return DB._peek[key];
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      DB._peek[key] = v;
      return v;
    } catch (e) { return fallback; }
  },
  set(key, val) {
    const raw = JSON.stringify(val);
    if (raw === undefined) { localStorage.removeItem(key); DB._invalidate(key); return; }
    if (localStorage.getItem(key) === raw) return; // nothing changed: no write, no cache reset
    localStorage.setItem(key, raw);
    DB._invalidate(key);
  },
  _invalidate(key) {
    delete DB._peek[key];
    if (CALC_KEYS[key]) _calcVersion++;
  },
};
// Another tab/window of the app wrote to storage: drop our cached copies.
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("storage", (e) => {
    if (e.key === null) { DB._peek = {}; _calcVersion++; } else DB._invalidate(e.key);
  });
}

// Ids arrive from other devices through sync, so they are treated as untrusted:
// only plain letters/digits/_/- are accepted (newId() only ever makes those).
function isSafeId(id) { return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id); }

// Every section that Backup/Restore AND sync read and write as one unit.
const SYNCED_KEYS = ["classes", "classSubjects", "students", "scores", "attendance", "announcements", "gateAnnouncement", "adminPin", "subjectTomb", "history"];

// Presence data: travels over the same sync channel as SYNCED_KEYS (so
// other devices can see it) but is deliberately kept OUT of Backup/Restore
// — a class data backup shouldn't carry another device's identity around,
// and restoring one shouldn't overwrite it either. See sync.js for how
// this rides alongside SYNCED_KEYS during a sync.
const PRESENCE_KEYS = ["devices"];

function newId() { return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* ---------- Device identity & presence ----------
   Each device gets a small, permanent local id the first time it runs,
   plus a friendly name (editable from the Admin tab, on any device — a
   rename made on one device is just a normal field-level sync like any
   other, so it reaches every other device). Every sync() heartbeats this
   device's own entry with the current time, which is how "online" gets
   worked out elsewhere (recently-seen vs. not). */
function getDeviceId() {
  let id = DB.get("deviceId", null);
  if (!id) { id = newId(); DB.set("deviceId", id); }
  return id;
}
function defaultDeviceName() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  let base = "Device";
  if (/iPad/i.test(ua)) base = "iPad";
  else if (/iPhone/i.test(ua)) base = "iPhone";
  else if (/Android/i.test(ua)) base = "Android Device";
  else if (/Macintosh/i.test(ua)) base = "Mac";
  else if (/Windows/i.test(ua)) base = "Windows PC";
  else if (/Linux/i.test(ua)) base = "Linux PC";
  return base + " " + getDeviceId().slice(-4);
}
function loadDevices() { return DB.get("devices", {}); }
function saveDevices(d, silent) { const prev = loadDevices(); DB.set("devices", d); commitSection("devices", prev, d, { silent: !!silent }); }
// Called at the start of every sync attempt: stamps this device's own
// entry with "now", creating it with a sensible default name the very
// first time. Never touches any other device's entry. This runs on
// EVERY sync, including the ambient background one, so it must be
// silent — otherwise the write itself would keep re-triggering another
// sync a moment later, forever, regardless of whether the user actually
// changed anything.
function touchDeviceHeartbeat(force) {
  const id = getDeviceId();
  const devices = loadDevices();
  const existing = devices[id] || {};
  if (!force && existing.name && typeof existing.lastSeen === "number" && (Date.now() - existing.lastSeen) < HEARTBEAT_EVERY_MS) return;
  devices[id] = Object.assign({}, existing, {
    name: existing.name || defaultDeviceName(),
    lastSeen: Date.now(),
  });
  saveDevices(devices, true);
}
function renameDevice(id, name) {
  const devices = loadDevices();
  const existing = devices[id] || {};
  devices[id] = Object.assign({}, existing, { name: (name || "").trim() || existing.name || "Device" });
  saveDevices(devices);
}
// "Online" is a judgment call, not a fact the other device can push to
// us — it just means "we heard from it recently". Every heartbeat is a
// write to the shared store, so a device only re-stamps itself every
// HEARTBEAT_EVERY_MS (or whenever it has real changes to send anyway);
// anything heard from within the online window counts as online.
const HEARTBEAT_EVERY_MS = 5 * 60 * 1000;
const DEVICE_ONLINE_WINDOW_MS = HEARTBEAT_EVERY_MS + 60 * 1000;
function isDeviceOnline(lastSeen) { return typeof lastSeen === "number" && (Date.now() - lastSeen) < DEVICE_ONLINE_WINDOW_MS; }

/* ---------- Per-FIELD change tracking (recursive) ----------
   Every SYNCED_KEYS section gets a "timestamp tree" shaped just like its
   own data — an object nests into an object, and a leaf (a number, string,
   plain array, or a student/class record's individual field) gets a single
   ms timestamp. Sync merges section-by-section AND leaf-by-leaf: two
   devices editing different students, different subjects, or even
   different fields of the same student/line, both survive a merge no
   matter which device syncs first. Only two edits to the exact same leaf
   need a winner (highest timestamp; deterministic tiebreak on an exact
   millisecond tie).

   classes/students are arrays of records identified by `id` — those get
   merged per-record-per-field (via a tombstone list for deletions), since
   array index isn't a stable identity once two devices add/remove things
   independently. Every other section is a plain nested object/array tree
   and needs no special handling beyond the generic recursion. */
const ID_ARRAY_SECTIONS = { classes: true, students: true };

function isPlainObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function tsTreeKey(section) { return "tsTree_" + section; }
function tombKey(section) { return "tomb_" + section; }
function loadTsTree(section) { return DB.get(tsTreeKey(section), null); }
function saveTsTree(section, tree) { DB.set(tsTreeKey(section), tree); }
function loadTombstones(section) { return DB.get(tombKey(section), {}); }
function saveTombstones(section, t) { DB.set(tombKey(section), t); }

function arrayToMap(arr) {
  const map = {};
  (Array.isArray(arr) ? arr : []).forEach((rec) => { if (rec && isSafeId(rec.id)) map[rec.id] = rec; });
  return map;
}
// Local order first (so a device's own list doesn't visibly reshuffle),
// then any records that only exist because they were just pulled in from
// the other device, appended in the order the merge produced them.
function mapToArray(map, previousLocalOrder) {
  const seen = {};
  const out = [];
  (previousLocalOrder || []).forEach((rec) => {
    if (rec && map[rec.id] && !seen[rec.id]) { out.push(map[rec.id]); seen[rec.id] = true; }
  });
  Object.keys(map).forEach((id) => { if (!seen[id]) { out.push(map[id]); seen[id] = true; } });
  return out;
}

/* Walks oldVal vs newVal together and returns a ts-tree reflecting what
   changed, stamping changed leaves with `at` and carrying forward
   unchanged leaves' previous timestamp (prevTs, the matching-shaped
   ts-tree from before this write). This is what makes change-tracking
   automatic — callers never hand-pick which field changed. */
function stamp(oldVal, newVal, prevTs, at) {
  if (isPlainObject(newVal) || isPlainObject(oldVal)) {
    const ov = isPlainObject(oldVal) ? oldVal : {};
    const nv = isPlainObject(newVal) ? newVal : {};
    const pb = isPlainObject(prevTs) ? prevTs : {};
    const keys = Object.keys(Object.assign({}, ov, nv));
    const out = {};
    keys.forEach((k) => { out[k] = stamp(ov[k], nv[k], pb[k], at); });
    return out;
  }
  const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal);
  if (changed) return at;
  return (typeof prevTs === "number") ? prevTs : at;
}

// One-time-per-section: if this device never had a ts-tree yet, build one
// from scratch so nothing crashes; a genuinely fresh device's data is
// empty anyway, so this just establishes an empty tree to grow from.
function ensureTsTree(section, currentData) {
  let tree = loadTsTree(section);
  if (tree !== null) return tree;
  const base = ID_ARRAY_SECTIONS[section] ? arrayToMap(currentData) : currentData;
  tree = stamp(null, base, null, 0);
  saveTsTree(section, tree);
  return tree;
}

// Call after writing a section's new data to storage: diffs against what
// was there a moment ago and stamps only the leaves that actually changed.
function commitSection(section, prevData, newData, opts) {
  const now = Date.now();
  if (ID_ARRAY_SECTIONS[section]) {
    const oldMap = arrayToMap(prevData), newMap = arrayToMap(newData);
    const tomb = loadTombstones(section);
    Object.keys(oldMap).forEach((id) => { if (!(id in newMap)) tomb[id] = now; });
    Object.keys(newMap).forEach((id) => { if (id in tomb) delete tomb[id]; }); // re-added -> no longer deleted
    saveTombstones(section, tomb);
    const prevTree = ensureTsTree(section, prevData);
    // Only stamp records that still exist. A deleted record's field
    // timestamps are left exactly as they were (NOT bumped to "now") --
    // otherwise every field of a deleted record looks "just edited" to a
    // remote device, and a merge can wipe fields the other device never
    // touched (comparing a phantom deletion-time stamp against the
    // remote's real, older, but still-valid value) while the tombstone
    // itself fails to remove the record because some other field the
    // other device DID edit around the same time out-ranks it. The
    // tombstone map is what marks a record deleted; per-field stamps for
    // a vanished record don't need to move.
    const newTree = {};
    const allIds = Object.keys(Object.assign({}, oldMap, newMap));
    allIds.forEach((id) => {
      newTree[id] = (id in newMap) ? stamp(oldMap[id], newMap[id], prevTree[id], now) : prevTree[id];
    });
    saveTsTree(section, newTree);
  } else {
    const prevTree = ensureTsTree(section, prevData);
    saveTsTree(section, stamp(prevData, newData, prevTree, now));
  }
  // Auto-notify sync.js (if loaded) that something changed, so every save
  // site doesn't need its own manual "tell sync" call — one hook, defined
  // by sync.js itself, covers every saveX() everywhere in the app.
  // opts.silent skips this: used only for the presence heartbeat below,
  // which writes on every sync attempt by nature and must never itself be
  // treated as "the user changed something, sync again soon" — that would
  // make every sync immediately schedule another one.
  if (!(opts && opts.silent) && typeof window !== "undefined" && typeof window.onSyncableChange === "function") window.onSyncableChange();
}

/* ---------- Backup & Restore (local file, no network) ----------
   Bundles every SYNCED_KEYS section into one JSON file the browser
   downloads to the device — the user then moves that file wherever they
   like (email, USB, cloud drive folder) as a manual backup, or to carry
   data over to another device. Restore reads such a file back in and
   overwrites this device's local data with it. */
const BACKUP_LOADERS = {
  classes: loadClasses, classSubjects: loadClassSubjects, students: loadStudents,
  scores: loadScores, attendance: loadAttendance, announcements: loadAnnouncements, gateAnnouncement: loadGateAnnouncement,
  adminPin: getAdminPin, subjectTomb: loadSubjectTomb,
};
// Mirrors BACKUP_LOADERS: the real saveX() for each section, so restoring
// goes through the normal commit path (see restoreBackup below) instead
// of writing straight to storage.
const BACKUP_SAVERS = {
  classes: saveClasses, classSubjects: saveClassSubjects, students: saveStudents,
  scores: saveScores, attendance: saveAttendance, announcements: saveAnnouncements, gateAnnouncement: saveGateAnnouncement,
  adminPin: setAdminPin, subjectTomb: saveSubjectTomb,
};
// The admin PIN and the deleted-items history never go into a backup file.
const BACKUP_EXCLUDED = { adminPin: true, history: true };
function buildBackup() {
  const sections = {};
  // Use each section's real loader (not a blind DB.get(key, null)) so a
  // field that was never explicitly touched on this device — like
  // adminPin before anyone ever changes it — backs up as its real,
  // usable default value instead of null. Restoring a null adminPin
  // elsewhere would otherwise permanently lock that device out of Admin,
  // since no PIN typed in would ever equal null.
  SYNCED_KEYS.forEach((key) => {
    if (BACKUP_EXCLUDED[key]) return;
    sections[key] = BACKUP_LOADERS[key] ? BACKUP_LOADERS[key]() : DB.get(key, null);
  });
  return { app: "ststephens-reportcard", version: APP_VERSION, exportedAt: new Date().toISOString(), sections: sections };
}
function restoreBackup(backup) {
  if (!backup || typeof backup !== "object" || !backup.sections) throw new Error("Not a recognized backup file");
  // Route every section through its normal saveX() — not a direct
  // DB.set() — so the restore is timestamped/tombstoned exactly like any
  // other edit. A direct write (the old approach) leaves no such trail,
  // so anything the restored backup doesn't have could simply reappear
  // from a connected device or the server on the very next sync, since
  // nothing ever told them those records/fields were gone.
  SYNCED_KEYS.forEach((key) => {
    if (BACKUP_EXCLUDED[key]) return; // older backup files carry a PIN: ignore it, keep this device's own (history is never restored either)
    if (Object.prototype.hasOwnProperty.call(backup.sections, key) && backup.sections[key] !== null && backup.sections[key] !== undefined && BACKUP_SAVERS[key]) {
      BACKUP_SAVERS[key](backup.sections[key]);
    }
  });
}


/* Short display label for a class button — display only, the stored class
   name is never changed. "Primary 1" -> "PRY 1", "Nursery 2" -> "NUR 2",
   "Pre-Nursery" -> "PRE-NUR", "Junior Secondary 3" -> "JSS 3", and so on.
   Anything not recognised is shown as typed. */
function shortClassName(name) {
  const raw = String(name || "").trim();
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  // Collapse ANY run of spaces/hyphens/dots/underscores into one space, so
  // "PRE- NURSERY", "pre--nur", "PRE_NUR" etc. all normalize the same way.
  const t = raw.toLowerCase().replace(/[\s._-]+/g, " ").trim();
  if (/^pre\s?(nur(sery)?|school)\b/.test(t)) return "PRE-NUR";
  const m = t.match(/^(nursery|nur|primary|pry|pri|junior secondary school|junior secondary|junior sec|jss|senior secondary school|senior secondary|senior sec|sss|ss|creche|kg|kindergarten|basic)\s*-?\s*(\d+|one|two|three|four|five|six)?\s*([a-z])?$/);
  if (!m) return raw.toUpperCase().length <= 9 ? raw.toUpperCase() : raw;
  const map = { nursery: "NUR", nur: "NUR", primary: "PRY", pry: "PRY", pri: "PRY", basic: "BSC",
    "junior secondary school": "JSS", "junior secondary": "JSS", "junior sec": "JSS", jss: "JSS",
    "senior secondary school": "SS", "senior secondary": "SS", "senior sec": "SS", sss: "SS", ss: "SS",
    creche: "CRECHE", kg: "KG", kindergarten: "KG" };
  const num = m[2] ? (words[m[2]] || m[2]) : "";
  return [map[m[1]], num].filter(Boolean).join(" ") + (m[3] ? m[3].toUpperCase() : "");
}

/* ---------- Fixed class list ----------
   Every class the school can have, in the order it is shown everywhere. Each
   entry has a permanent built-in id, so "PRY 1" added on ANY device is the
   very same class — sync merges them field by field instead of creating a
   duplicate. Classes are picked from this list (Admin > + Class), never typed. */
const CLASS_LABELS = ["CRECHE", "PRE-NUR", "NUR 1", "NUR 2", "NUR 3",
  "PRY 1", "PRY 2", "PRY 3", "PRY 4", "PRY 5",
  "JSS 1", "JSS 2", "JSS 3", "SS 1", "SS 2", "SS 3"];
const CLASS_CATALOG = CLASS_LABELS.map((label) => ({ label: label, id: "cls-" + label.toLowerCase().replace(/[^a-z0-9]/g, "") }));
function catalogEntryForName(name) {
  const label = shortClassName(name);
  return CLASS_CATALOG.find((c) => c.label === label) || null;
}
// Position of a class in the fixed order (unrecognised old classes go last).
function classSortIndex(cls) {
  const byId = CLASS_CATALOG.findIndex((c) => c.id === cls.id);
  if (byId >= 0) return byId;
  const e = catalogEntryForName(cls.name);
  return e ? CLASS_CATALOG.indexOf(e) + 0.5 : 999;
}
function sortedClasses() {
  return loadClasses().map((c, i) => ({ c: c, i: i }))
    .sort((a, b) => (classSortIndex(a.c) - classSortIndex(b.c)) || (a.i - b.i)).map((x) => x.c);
}

/* Everything typed in this app is kept in CAPITAL letters. Pupil and class names
   already stored are converted here (through the normal save path, so it syncs). */
let _capsRunning = false;
function enforceUppercaseData() {
  if (_capsRunning) return;
  _capsRunning = true;
  try {
    const students = loadStudents();
    let sChanged = false;
    students.forEach((s) => {
      if (typeof s.name === "string" && s.name !== s.name.toUpperCase()) { s.name = s.name.toUpperCase(); sChanged = true; }
    });
    if (sChanged) saveStudents(students);
    const classes = loadClasses();
    let cChanged = false;
    classes.forEach((c) => {
      if (typeof c.name === "string" && c.name !== c.name.toUpperCase()) { c.name = c.name.toUpperCase(); cChanged = true; }
    });
    if (cChanged) saveClasses(classes);
  } finally { _capsRunning = false; }
}

/* ---------- Header live clock ---------- */
function startLiveClock() {
  const el = document.getElementById("liveClock");
  if (!el) return;
  const tick = () => {
    const now = new Date();
    el.textContent = now.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) +
      "  ·  " + now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------- Timestamp on every printed / exported document ----------
   One shared line of text so Report Card, Class Report, Broadsheet, the PDF export and the
   Excel export all carry the exact same wording and the exact same moment. */
function printStampText() {
  const now = new Date();
  return "Printed " + now.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) +
    " at " + now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) +
    "  ·  St Stephen's Nursery, Primary and Secondary School — Report Card System";
}
function refreshPrintStamp() {
  const el = document.getElementById("printStamp");
  if (el) el.textContent = printStampText();
}

/* ---------- Admin: full cross-tab profile for one student ----------
   Pulls together everything the app knows about a pupil — their class, subjects, every
   term's totals/average/position/comment, and attendance — without the admin needing to
   already know which class they're in. Read-only; nothing here is saved. */
function studentFullProfile(student) {
  const cls = loadClasses().find((c) => c.id === student.classId);
  const subjects = subjectsForClass(student.classId).filter((s) => !isNotTaking(student, s));
  const terms = ["1", "2", "3", "A"].map((term) => {
    const classStudents = classMembers(student.classId, term);
    const gt = grandTotalFor(student.classId, term, student.id, classStudents);
    const att = studentAttendanceSummary(student.classId, student.id, term);
    return {
      term: term, label: termLabel(term),
      hasAny: gt.hasAny, total: gt.total, position: gt.position, population: classStudents.length,
      average: gt.hasAny ? averageFor(student.classId, term, student.id, classStudents) : 0,
      comment: gt.hasAny ? commentForStudent(student.classId, term, student, classStudents) : "",
      attendancePct: att.pct, present: att.present, opens: att.opens,
    };
  });
  return { student: student, cls: cls, subjects: subjects, terms: terms };
}
/* Every pupil across every class whose name contains `query` (case-insensitive — names are
   already stored in capitals, but the search itself does not require the admin to type caps). */
function searchStudentsByName(query) {
  const q = String(query || "").trim().toUpperCase();
  if (!q) return [];
  return loadStudents()
    .filter((s) => String(s.name || "").toUpperCase().indexOf(q) !== -1)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function loadClasses() { return DB.get("classes", []); }
function saveClasses(c) { const prev = loadClasses(); DB.set("classes", c); commitSection("classes", prev, c); }

/* ---------- Per-class announcements (set by admin, shown to that class's
   teacher only, on that class's dashboard/Students tab) ---------- */
function loadAnnouncements() { return DB.get("announcements", {}); }
// The scrolling notice on the class-select (login) screen — one for the whole school,
// editable in Admin, and synced like everything else.
const DEFAULT_GATE_ANNOUNCEMENT = "TEACHERS: PLEASE SELECT YOUR CLASS AND KEY IN YOUR PASSWORD";
function loadGateAnnouncement() {
  const v = DB.get("gateAnnouncement", null);
  return v === null ? DEFAULT_GATE_ANNOUNCEMENT : v;
}
function saveGateAnnouncement(text) {
  const prev = loadGateAnnouncement();
  const next = String(text || "").trim();
  DB.set("gateAnnouncement", next);
  commitSection("gateAnnouncement", prev, next);
}
function saveAnnouncements(a) { const prev = loadAnnouncements(); DB.set("announcements", a); commitSection("announcements", prev, a); }
function getAnnouncementFor(classId) {
  const all = loadAnnouncements();
  return all[classId] || { text: "", updatedAt: 0 };
}
function setAnnouncementFor(classId, text) {
  const all = loadAnnouncements();
  all[classId] = { text: text, updatedAt: Date.now() };
  saveAnnouncements(all);
}

/* No auto-seeding — a brand-new device starts with zero classes, and stays
   that way until someone actually adds one. getCurrentClassId() returns
   null when there are none yet; callers (ui.js) are expected to show an
   "add a class to get started" state rather than assume one exists. */
function getCurrentClassId() {
  let id = DB.get("currentClassId", null);
  const classes = loadClasses();
  if (!id || !classes.find((c) => c.id === id)) {
    id = classes.length ? classes[0].id : null;
    DB.set("currentClassId", id);
  }
  return id;
}
function setCurrentClassId(id) { DB.set("currentClassId", id); }

/* ---------- Students (each belongs to a classId) ---------- */
function loadStudents() { return DB.get("students", []); }
function saveStudents(s) { const prev = loadStudents(); DB.set("students", s); commitSection("students", prev, s); }

/* Students are returned in manual-register order: whatever order was set
   via drag-and-drop on the Students tab (s.order), so Register and Score
   Entry — which both call this — always list students the same way the
   teacher's paper register does. Students with no order yet (older data,
   or a student added before any reordering happened) keep their original
   insertion position, sorted after any explicitly ordered ones. */
const _studentsCache = {};
function studentsInClass(classId) {
  // One shared list per class, rebuilt only when students/scores/subjects change,
  // so every tab (and every calculation table below) sees the same array.
  // READ-ONLY: do not modify the list or the records in it.
  const hit = _studentsCache[classId];
  if (hit && hit.v === _calcVersion) return hit.list;
  const list = DB.peek("students", []).filter((s) => s.classId === classId)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ao = a.s.order != null ? a.s.order : 1e9 + a.i;
      const bo = b.s.order != null ? b.s.order : 1e9 + b.i;
      return ao - bo;
    })
    .map((x) => x.s);
  _studentsCache[classId] = { v: _calcVersion, list: list };
  return list;
}

/* ---------- Class membership by term (v3.10.0) ----------
   A pupil moved up mid-session (Term 2 or 3) is on two classes' rolls for different terms:
     student.joinTerm  "2"|"3"  = first term in the CURRENT class (absent = Term 1)
     student.moves     [{classId, lastTerm}] = earlier classes this session, and the last
                       term spent there. Scores/attendance stay under that old class id.
   classMembers(classId, term) is the roll for a report on that term:
     - a term ("1"|"2"|"3"): pupils who had joined by then, plus pupils who had not yet left
     - Annual ("A") or no term: current pupils only, so a pupil who left is not in the old
       class's Annual, and one who joined late is in the new class's Annual (their Annual
       averages only the terms that have scores, so it is divided by 2 or 1).
   Same array every call until data changes, so the calculation tables stay cached. */
const _memberCache = {};
function classMembers(classId, term) {
  const base = studentsInClass(classId);
  if (!term || term === "A") return base;
  const key = classId + "|" + term;
  const hit = _memberCache[key];
  if (hit && hit.v === _calcVersion && hit.base === base) return hit.list;
  const tn = Number(term);
  const cur = base.filter((s) => Number(s.joinTerm || 1) <= tn);
  const left = DB.peek("students", []).filter((s) => s.classId !== classId && Array.isArray(s.moves) &&
    s.moves.some((m) => m.classId === classId && Number(m.lastTerm) >= tn))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const list = (cur.length === base.length && !left.length) ? base : cur.concat(left);
  _memberCache[key] = { v: _calcVersion, base: base, list: list };
  return list;
}

/* Persists a new manual-register order for one class from an array of
   student ids in the desired order (as produced by drag-and-drop). */
function reorderStudentsInClass(classId, orderedIds) {
  const all = loadStudents();
  orderedIds.forEach((id, idx) => {
    const rec = all.find((s) => s.id === id && s.classId === classId);
    if (rec) rec.order = idx;
  });
  saveStudents(all);
}

/* ---------- Subjects per class ---------- */
function loadClassSubjects() { return DB.get("classSubjects", {}); } // {classId: [subjectName,...]}
function saveClassSubjects(cs) { const prev = loadClassSubjects(); DB.set("classSubjects", cs); commitSection("classSubjects", prev, cs); }

function subjectsForClass(classId) {
  const cs = DB.peek("classSubjects", {}); // read-only shared copy
  return cs[classId] || [];
}

/* ---------- Subject-removal tombstones ----------
   scores/classSubjects have no per-record tombstone like classes/students
   do, so simply deleting a subject's scores locally isn't safe on a
   synced setup: another device (or the server) that hasn't seen the
   removal yet still holds the old scores at real, "newer-looking"
   timestamps and can hand them straight back on the next merge — the
   same failure mode as Restore, just at subject scale. This flat
   map rides the normal per-field sync/merge machinery (it's just another
   SYNCED_KEYS section), so "removed" (true) vs. "re-added" (false) is
   itself timestamped and merges correctly like any other field. */
function loadSubjectTomb() { return DB.get("subjectTomb", {}); }
function saveSubjectTomb(t) { const prev = loadSubjectTomb(); DB.set("subjectTomb", t); commitSection("subjectTomb", prev, t); }
function subjectTombKey(classId, subjectName) { return classId + "::" + subjectName; }

function addSubjectToClass(classId, subjectName) {
  let name = (subjectName || "").trim();
  if (!name) return;
  const cs = loadClassSubjects();
  cs[classId] = cs[classId] || [];
  // Everything is typed in capitals now, so match an existing subject ignoring case
  // ("MATHEMATICS" is the same subject as "Mathematics") instead of adding a twin.
  const existing = cs[classId].find((n) => String(n).toLowerCase() === name.toLowerCase());
  if (existing) name = existing; else cs[classId].push(name);
  saveClassSubjects(cs);

  // Re-adding a previously-removed subject of the same name should start
  // fresh (and stay visible), not remain hidden behind an old removal.
  const tomb = loadSubjectTomb();
  const key = subjectTombKey(classId, name);
  if (tomb[key]) { tomb[key] = false; saveSubjectTomb(tomb); }
  return name;
}

// removeSubjectFromClass() lives in history.js: it deletes the subject's scores and
// "Not taking" ticks and keeps an undo copy.

/* ---------- Scores: scores[classId][term][subjectName][studentId] = {test1,test2,exam} ----------
   Max obtainable per the report card header: Test1/Test2 = 20, Exam = 60. */
const SCORE_MAX = { test1: 20, test2: 20, exam: 60 };
function clampScoreValue(field, raw) {
  if (raw === "" || raw == null) return undefined;
  const max = SCORE_MAX[field] || 0;
  const n = Math.round(Number(raw));
  if (!isFinite(n)) return undefined;
  return Math.max(0, Math.min(max, n));
}
function loadScores() { return DB.get("scores", {}); }
function saveScores(s) { const prev = loadScores(); DB.set("scores", s); commitSection("scores", prev, s); }

/* ---------- Grade / remark bands (matches spreadsheet + Nursery template exactly) ---------- */
function gradeFor(total) {
  if (total >= 80) return "A";
  if (total >= 70) return "B";
  if (total >= 60) return "C";
  if (total >= 50) return "D";
  if (total >= 40) return "E";
  return "F";
}
function remarkFor(total) {
  if (total >= 80) return "EXCELLENT";
  if (total >= 70) return "GOOD";
  if (total >= 60) return "CREDIT";
  if (total >= 50) return "B.AVERAGE";
  if (total >= 40) return "POOR";
  return "V.POOR";
}

/* Excel-style competition rank, descending: ties share the top rank, next
   distinct value's rank skips accordingly. */
function competitionRank(values, i) {
  const v = values[i];
  let higher = 0;
  for (const x of values) if (x > v) higher++;
  return higher + 1;
}

/* ---------- Subjects a pupil does not take ----------
   Every subject on a class's list applies to every pupil in the class, which is wrong for
   electives (a pupil learns Yoruba OR Hausa, not both). student.notTaking is a small map
   { "Yoruba": true }: for those subjects the pupil is left out of that subject's ranking and
   class average, has no row on their report card, and their overall average is worked out
   over the subjects they DO take. It is a map (not a list) so two devices marking different
   subjects for the same pupil merge instead of overwriting each other. */
let _studentIdx = { v: -1, map: null };
function studentRecord(studentId) {
  // the current record for a pupil, from the shared read-only copy (never stale after an edit)
  if (_studentIdx.v !== _calcVersion) {
    const m = {};
    DB.peek("students", []).forEach((st) => { m[st.id] = st; });
    _studentIdx = { v: _calcVersion, map: m };
  }
  return _studentIdx.map[studentId];
}
function isNotTaking(student, subjectName) {
  return !!(student && student.notTaking && student.notTaking[subjectName]);
}
function setStudentNotTaking(studentId, subjectName, notTaking) {
  const list = loadStudents();
  const st = list.find((x) => x.id === studentId);
  if (!st) return;
  st.notTaking = Object.assign({}, st.notTaking);
  st.notTaking[subjectName] = notTaking ? true : undefined;
  saveStudents(list);
}

/* A score box that was filled in — including with 0 — is "entered". Only a blank box
   means "not entered / absent". (Previously 0 was treated as blank, so a pupil who really
   scored 0 vanished from the ranking and the class average.) */
function isEntered(v) { return v !== undefined && v !== null && v !== "" && isFinite(Number(v)); }
function cellScore(classId, term, subjectName, studentId) {
  const scores = DB.peek("scores", {}); // read-only shared copy
  if (isNotTaking(studentRecord(studentId), subjectName)) {
    return { test1: 0, test2: 0, exam: 0, total: 0, hasAny: false, notTaking: true,
      entered: { test1: false, test2: false, exam: false } };
  }
  const rec = (scores[classId] && scores[classId][term] && scores[classId][term][subjectName] &&
    scores[classId][term][subjectName][studentId]) || {};
  const e1 = isEntered(rec.test1), e2 = isEntered(rec.test2), ee = isEntered(rec.exam);
  const t1 = e1 ? Number(rec.test1) : 0;
  const t2 = e2 ? Number(rec.test2) : 0;
  const ex = ee ? Number(rec.exam) : 0;
  return { test1: t1, test2: t2, exam: ex, total: t1 + t2 + ex, hasAny: e1 || e2 || ee,
    entered: { test1: e1, test2: e2, exam: ee } };
}

/* Whether a student has ANY score entered, in ANY subject, for this term.
   Students with nothing entered (e.g. freshly imported, or absent all term)
   must not be pulled into class averages/rankings as a phantom zero. */
function studentHasAnyScoreForTerm(classId, term, studentId, subjects) {
  return subjects.some((subj) => cellScore(classId, term, subj, studentId).hasAny);
}

/* ---------- Calculation tables ----------
   Ranking a class means comparing every pupil with every other pupil, in every subject,
   for every term. Doing that from scratch for each cell (as v3.3.x did) grows so fast
   that a class of 30 took seconds and an Annual view of 20 pupils took over a minute.
   Instead each (class, term, subject) table is built ONCE, kept until scores / students /
   subjects change (see DB._invalidate), and every lookup after that is instant.
   Keyed by the `students` array itself, which studentsInClass() shares between tabs. */
const _calcMemo = new WeakMap();
function calcMemo(students) {
  let e = _calcMemo.get(students);
  if (!e || e.v !== _calcVersion) { e = { v: _calcVersion, map: new Map() }; _calcMemo.set(students, e); }
  return e.map;
}

function annualCell(perTerm) {
  const filled = perTerm.filter((p) => p.hasAny);
  const avg = (key) => filled.length ? filled.reduce((a, p) => a + p[key], 0) / filled.length : 0;
  const test1 = avg("test1"), test2 = avg("test2"), exam = avg("exam");
  return { test1: test1, test2: test2, exam: exam, total: test1 + test2 + exam, hasAny: filled.length > 0,
    notTaking: !!perTerm[0].notTaking,
    term1Total: perTerm[0].total, term2Total: perTerm[1].total, term3Total: perTerm[2].total };
}
function cellFor(classId, term, subjectName, studentId) {
  return term === "A"
    ? annualCell(TERMS.map((t) => cellScore(classId, t, subjectName, studentId)))
    : cellScore(classId, term, subjectName, studentId);
}

function subjectTable(classId, term, subjectName, students) {
  const memo = calcMemo(students);
  const key = "S|" + classId + "|" + term + "|" + subjectName;
  let t = memo.get(key);
  if (t) return t;
  const cells = {}, totals = [], idxOf = {};
  students.forEach((s) => { cells[s.id] = cellFor(classId, term, subjectName, s.id); });
  // Only pupils who actually have this subject scored take part in its position and class
  // average — a pupil with nothing entered is not counted as a 0.
  students.forEach((s) => { if (cells[s.id].hasAny) { idxOf[s.id] = totals.length; totals.push(cells[s.id].total); } });
  t = { cells: cells, totals: totals, idxOf: idxOf, rows: {},
        classAverage: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0 };
  memo.set(key, t);
  return t;
}

/* Full subject row for one student: Test1,Test2,Exam,Total,Position(in-subject),
   ClassAverage(for that subject),Grade,Remark. term: '1'|'2'|'3'|'A' (Annual).
   Students who never had this subject scored are excluded from the class
   average/position pool entirely (not counted as a 0) — their own row is
   flagged hasAny:false so the UI can show "—" instead of a rank/grade.
   Non-annual rows also carry `entered` (which of the three boxes are filled in), so a
   real 0 can be shown as 0 and a blank box stays blank. */
function subjectRowFor(classId, term, subjectName, studentId, students) {
  const t = subjectTable(classId, term, subjectName, students);
  let row = t.rows[studentId];
  if (!row) {
    const c = t.cells[studentId] || cellFor(classId, term, subjectName, studentId);
    const idx = t.idxOf[studentId];
    row = {
      test1: c.test1, test2: c.test2, exam: c.exam, total: c.total, hasAny: c.hasAny,
      position: c.hasAny && idx !== undefined ? competitionRank(t.totals, idx) : "–",
      classAverage: t.classAverage,
      grade: c.hasAny ? gradeFor(c.total) : "–",
      remark: c.hasAny ? remarkFor(c.total) : (c.notTaking ? "Not taking this subject" : "Absent / not entered"),
      notTaking: !!c.notTaking,
    };
    if (term === "A") { row.term1Total = c.term1Total; row.term2Total = c.term2Total; row.term3Total = c.term3Total; }
    else row.entered = c.entered;
    t.rows[studentId] = row;
  }
  return Object.assign({}, row);
}

function termGrandEntry(classId, term, studentId, subjects) {
  let total = 0, hasAny = false;
  for (const subj of subjects) {
    const c = cellScore(classId, term, subj, studentId);
    total += c.total;
    if (c.hasAny) hasAny = true;
  }
  return { total: total, hasAny: hasAny };
}
function annualGrandEntry(entries) {
  const mine = entries.filter((g) => g.hasAny);
  return { hasAny: mine.length > 0, total: mine.length ? mine.reduce((a, g) => a + g.total, 0) / mine.length : 0 };
}
/* Overall position. Pupils are ranked by AVERAGE (total ÷ the subjects they take). For a class
   where everyone takes the same subjects that is exactly the same order as ranking by total, so
   nothing changes there — but a pupil who does 10 subjects is no longer ranked above one who does
   9 just because they have one more subject's marks added in. */
function takenSubjectCount(classId, studentId) {
  const st = studentRecord(studentId);
  return subjectsForClass(classId).filter((subj) => !isNotTaking(st, subj)).length;
}
function grandTable(classId, term, students) {
  const memo = calcMemo(students);
  const key = "G|" + classId + "|" + term;
  let t = memo.get(key);
  if (t) return t;
  const byId = {}, keys = [], idxOf = {};
  if (term === "A") {
    const perTerm = TERMS.map((tm) => grandTable(classId, tm, students));
    students.forEach((s) => { byId[s.id] = annualGrandEntry(perTerm.map((g) => g.byId[s.id])); });
  } else {
    const subjects = subjectsForClass(classId);
    students.forEach((s) => { byId[s.id] = termGrandEntry(classId, term, s.id, subjects); });
  }
  const rankKey = (sid) => { const n = takenSubjectCount(classId, sid); return n ? byId[sid].total / n : 0; };
  students.forEach((s) => { if (byId[s.id].hasAny) { idxOf[s.id] = keys.length; keys.push(rankKey(s.id)); } });
  t = { byId: byId, keys: keys, idxOf: idxOf };
  memo.set(key, t);
  return t;
}
function grandEntry(classId, term, studentId, students) {
  const t = grandTable(classId, term, students);
  if (t.byId[studentId]) return t.byId[studentId];
  // a pupil who is not in `students`: compute directly, never ranked
  if (term === "A") return annualGrandEntry(TERMS.map((tm) => grandEntry(classId, tm, studentId, students)));
  return termGrandEntry(classId, term, studentId, subjectsForClass(classId));
}

function grandTotalFor(classId, term, studentId, students) {
  const t = grandTable(classId, term, students);
  const e = grandEntry(classId, term, studentId, students);
  const idx = t.idxOf[studentId];
  return { total: e.total, hasAny: e.hasAny, position: e.hasAny && idx !== undefined ? competitionRank(t.keys, idx) : "–" };
}

function averageFor(classId, term, studentId, students) {
  const st = studentRecord(studentId);
  // subjects this pupil does not take are not in the divisor
  const taken = subjectsForClass(classId).filter((subj) => !isNotTaking(st, subj));
  const gt = grandTotalFor(classId, term, studentId, students);
  if (!gt.hasAny) return 0;
  return taken.length ? gt.total / taken.length : 0;
}

/* Class teacher's comment. Wording is the school's own, chosen by the pupil's average
   (the same bands as the grade letters) instead of by class position — position says how
   a pupil did against the others, so 26th of 60 (top half) used to read "Needs extra support"
   and 6th of 8 read "Good effort" no matter what the marks were. */
function commentForAverage(avg) {
  const g = gradeFor(Math.round(avg * 10) / 10);   // the average as printed, one decimal
  return {
    A: "Excellent performance! Keep up the good work",
    B: "Very good work, a little more effort",
    C: "Good effort, you can do better",
    D: "Fair performance, you need to put in more effort",
    E: "Room for improvement, this is not the best you can be",
    F: "Needs extra support",
  }[g];
}
function suggestedCommentFor(classId, term, student, students) {
  if (!grandTotalFor(classId, term, student.id, students).hasAny) return "No scores recorded for this term yet.";
  return commentForAverage(averageFor(classId, term, student.id, students));
}
// What is printed: the teacher's own words if they wrote any, otherwise the suggestion.
function commentForStudent(classId, term, student, students) {
  const rec = studentRecord(student.id) || student;   // current record, even if `student` was fetched before an edit
  const own = rec.remarks && rec.remarks[term];
  if (own && String(own).trim()) return String(own).trim();
  return suggestedCommentFor(classId, term, student, students);
}
function setStudentRemark(studentId, term, text) {
  const list = loadStudents();
  const st = list.find((x) => x.id === studentId);
  if (!st) return;
  st.remarks = Object.assign({}, st.remarks);   // one entry per term, so terms merge independently
  st.remarks[term] = String(text || "").trim() || undefined;
  saveStudents(list);
}

function termLabel(term) {
  return { "1": "TERM 1", "2": "TERM 2", "3": "TERM 3", "A": "ANNUAL" }[term];
}

/* ---------- Attendance / Register ----------
   attendance[classId] = {
     schoolOpensPerWeek: [n1, n2, ...],           // class-wide: days school ran each week
     students: { studentId: [presentWk1, ...] }   // each student's days-present per week
   }
   Gender lives on the student record: student.gender = "M" | "F"

   Staggered enrollment: a student record may carry
     joinWeek            (0-based index of the week they joined; undefined = present since week 1)
     joinEligibleDays    (days they were actually eligible for during that join week; undefined = full week)
     leaveWeek           (0-based index of the last week they attended; undefined = still enrolled)
     leaveEligibleDays   (days they were actually eligible for during that leave week; undefined = full week)
   so a mid-week arrival/departure is prorated by pupil-days instead of
   being counted against — or credited for — a whole week they weren't
   actually enrolled for. */
function loadAttendance() { return DB.get("attendance", {}); }
function saveAttendance(a) { const prev = loadAttendance(); DB.set("attendance", a); commitSection("attendance", prev, a); }

function attendanceForClass(classId) {
  const a = DB.peek("attendance", {}); // read-only shared copy
  return a[classId] || { schoolOpensPerWeek: [], students: {} };
}

/* ---------- Which term does each week belong to? ----------
   The register is one running list of weeks (Wk1, Wk2 ... across the year). Each week is
   tagged with a term in a parallel list, attendance[classId].weekTerms. A week with no tag
   yet (all data entered before v3.4) counts as Term 1 until someone sets it, and the
   Register says so. A report card for Term N counts only Term N's weeks; Annual counts all. */
const TERM_TAGS = ["1", "2", "3"];
function weekTagFor(classId, weekIdx) {
  const t = (attendanceForClass(classId).weekTerms || [])[weekIdx];
  return TERM_TAGS.includes(t) ? t : null;
}
function weekTermFor(classId, weekIdx) { return weekTagFor(classId, weekIdx) || "1"; }
function weekInView(classId, weekIdx, term) {
  return !term || term === "A" || weekTermFor(classId, weekIdx) === term;
}
function unassignedWeekCount(classId) {
  const n = attendanceForClass(classId).schoolOpensPerWeek.length;
  let c = 0;
  for (let i = 0; i < n; i++) if (weekTagFor(classId, i) === null) c++;
  return c;
}
/* "This term starts here": sets week `weekIdx` — and every later week that currently sits
   in the same term as it does — to `newTerm`. Terms are runs of consecutive weeks, so this
   is the natural way to mark where Term 2 or Term 3 begins. */
function setWeekTermFrom(classId, weekIdx, newTerm) {
  if (!TERM_TAGS.includes(newTerm)) return;
  const a = loadAttendance();
  a[classId] = a[classId] || { schoolOpensPerWeek: [], students: {} };
  const n = a[classId].schoolOpensPerWeek.length;
  const eff = [];
  for (let i = 0; i < n; i++) {
    const t = (a[classId].weekTerms || [])[i];
    eff.push(TERM_TAGS.includes(t) ? t : "1");
  }
  if (weekIdx < 0 || weekIdx >= n) return;
  const old = eff[weekIdx];
  for (let i = weekIdx; i < n; i++) if (eff[i] === old) eff[i] = newTerm;
  a[classId].weekTerms = eff;
  saveAttendance(a);
}

function weekCountFor(classId) {
  return attendanceForClass(classId).schoolOpensPerWeek.length;
}

function studentWeeks(classId, studentId) {
  const rec = attendanceForClass(classId);
  return rec.students[studentId] || [];
}

/* How many pupil-days a given student was actually eligible for in a given
   week: 0 for weeks fully before they joined or fully after they left; the
   manually-set eligible-days override for their join/leave week; the full
   week's school-opens figure otherwise. */
function eligibleDaysForStudentWeek(classId, studentId, weekIdx) {
  const rec = attendanceForClass(classId);
  const opens = Number(rec.schoolOpensPerWeek[weekIdx]) || 0;
  const s = DB.peek("students", []).find((x) => x.id === studentId);
  if (!s) return opens;
  if (s.classId !== classId) {   // moved up mid-session: counts here only up to the last term spent in this class
    const mv = (s.moves || []).find((m) => m.classId === classId);
    if (!mv) return 0;
    return Number(weekTagFor(classId, weekIdx) || "1") <= Number(mv.lastTerm) ? opens : 0;
  }
  const joinWeek = (s.joinWeek != null && s.joinWeek !== "") ? Number(s.joinWeek) : 0;
  const leaveWeek = (s.leaveWeek != null && s.leaveWeek !== "") ? Number(s.leaveWeek) : null;
  if (weekIdx < joinWeek) return 0;
  if (leaveWeek != null && weekIdx > leaveWeek) return 0;
  if (weekIdx === joinWeek && s.joinEligibleDays != null && s.joinEligibleDays !== "") {
    return Math.max(0, Math.min(Number(s.joinEligibleDays), opens));
  }
  if (leaveWeek != null && weekIdx === leaveWeek && s.leaveEligibleDays != null && s.leaveEligibleDays !== "") {
    return Math.max(0, Math.min(Number(s.leaveEligibleDays), opens));
  }
  return opens;
}

/* term: "1" | "2" | "3" counts only that term's weeks; "A" or omitted counts the whole year. */
function studentAttendanceSummary(classId, studentId, term) {
  const rec = attendanceForClass(classId);
  const weeks = rec.students[studentId] || [];
  const nWeeks = (rec.schoolOpensPerWeek || []).length;
  let opens = 0, present = 0;
  for (let w = 0; w < nWeeks; w++) {
    if (!weekInView(classId, w, term)) continue;
    opens += eligibleDaysForStudentWeek(classId, studentId, w);
    present += Number(weeks[w]) || 0;
  }
  const pct = opens > 0 ? (present / opens) * 100 : 0;
  return { present: present, opens: opens, absent: Math.max(0, opens - present), pct: pct };
}

function attendanceRatingFor(pct) {
  if (pct >= 90) return 5;
  if (pct >= 75) return 4;
  if (pct >= 60) return 3;
  if (pct >= 40) return 2;
  return 1;
}

// A week is 5 school days, each counted morning + afternoon.
const MAX_SCHOOL_OPENS_PER_WEEK = 10;

function setSchoolOpensForWeek(classId, weekIdx, value) {
  const a = loadAttendance();
  a[classId] = a[classId] || { schoolOpensPerWeek: [], students: {} };
  const n = Math.max(0, Math.min(MAX_SCHOOL_OPENS_PER_WEEK, Math.round(Number(value)) || 0));
  a[classId].schoolOpensPerWeek[weekIdx] = n;
  saveAttendance(a);
  return n;
}

function setStudentWeekPresent(classId, studentId, weekIdx, value) {
  const a = loadAttendance();
  a[classId] = a[classId] || { schoolOpensPerWeek: [], students: {} };
  a[classId].students[studentId] = a[classId].students[studentId] || [];
  if (value === "" || value == null) {
    a[classId].students[studentId][weekIdx] = undefined;
    saveAttendance(a);
    return undefined;
  }
  // Can't be present more days than the school actually opened that week.
  const cap = Math.max(0, Math.min(MAX_SCHOOL_OPENS_PER_WEEK, Number(a[classId].schoolOpensPerWeek[weekIdx]) || 0));
  const n = Math.max(0, Math.min(cap, Math.round(Number(value)) || 0));
  a[classId].students[studentId][weekIdx] = n;
  saveAttendance(a);
  return n;
}

function addAttendanceWeek(classId, term) {
  const a = loadAttendance();
  a[classId] = a[classId] || { schoolOpensPerWeek: [], students: {} };
  const n = a[classId].schoolOpensPerWeek.length;
  const tags = [];
  for (let i = 0; i < n; i++) { const t = (a[classId].weekTerms || [])[i]; tags.push(TERM_TAGS.includes(t) ? t : null); }
  // a new week joins the term being viewed, otherwise the same term as the last week
  const lastTag = tags.filter((t) => t !== null).pop();
  tags.push(TERM_TAGS.includes(term) ? term : (lastTag || "1"));
  a[classId].schoolOpensPerWeek.push(0);
  a[classId].weekTerms = tags;
  saveAttendance(a);
}

// removeLastAttendanceWeek() lives in history.js (it keeps an undo copy).
function classAttendanceSummary(classId, term) {
  const students = classMembers(classId, term);
  const rec = attendanceForClass(classId);
  const opensPerWeek = rec.schoolOpensPerWeek || [];
  const nWeeks = opensPerWeek.length;

  const perStudent = students.map((s) => ({ student: s, ...studentAttendanceSummary(classId, s.id, term) }));

  const weeklyTotals = [];
  let maxPossibleTerm = 0;
  let totalSchoolOpens = 0;
  for (let w = 0; w < nWeeks; w++) {
    if (!weekInView(classId, w, term)) continue;
    totalSchoolOpens += Number(opensPerWeek[w]) || 0;
    let total = 0;
    let maxPossible = 0;
    students.forEach((s) => {
      total += Number((rec.students[s.id] || [])[w]) || 0;
      maxPossible += eligibleDaysForStudentWeek(classId, s.id, w);
    });
    maxPossibleTerm += maxPossible;
    weeklyTotals.push({
      week: w + 1, present: total, schoolOpens: opensPerWeek[w],
      pct: maxPossible > 0 ? (total / maxPossible) * 100 : 0,
    });
  }

  const totalAttendanceTerm = perStudent.reduce((a, p) => a + p.present, 0);
  const classAveragePct = maxPossibleTerm > 0 ? (totalAttendanceTerm / maxPossibleTerm) * 100 : 0;

  const males = perStudent.filter((p) => p.student.gender === "M");
  const females = perStudent.filter((p) => p.student.gender === "F");
  const avgPct = (arr) => arr.length ? arr.reduce((a, p) => a + p.pct, 0) / arr.length : 0;
  const maleTotal = males.reduce((a, p) => a + p.present, 0);
  const femaleTotal = females.reduce((a, p) => a + p.present, 0);
  const maleAvgPct = avgPct(males);
  const femaleAvgPct = avgPct(females);
  let higherGender = "Tied";
  if (maleAvgPct > femaleAvgPct) higherGender = "Male";
  else if (femaleAvgPct > maleAvgPct) higherGender = "Female";

  return {
    perStudent: perStudent,
    weeklyTotals: weeklyTotals,
    totalSchoolOpens: totalSchoolOpens,
    totalAttendanceTerm: totalAttendanceTerm,
    classAveragePct: classAveragePct,
    maleCount: males.length, femaleCount: females.length,
    maleTotal: maleTotal, femaleTotal: femaleTotal,
    maleAvgPct: maleAvgPct, femaleAvgPct: femaleAvgPct,
    higherGender: higherGender,
  };
}
