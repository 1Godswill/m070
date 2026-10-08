/* ================= SYNC (per-field, multi-device) =================
   Every SYNCED_KEYS section travels as {data, tsTree, tomb?} — tsTree
   mirrors data's own shape (object nests into object; a leaf value gets
   one timestamp), so merges happen field-by-field, even line-by-line
   within a record — not whole-section. Two devices editing different
   students, different subjects, or different fields of the same student
   both survive a merge no matter which device syncs first. Only two edits
   to the exact same leaf need a winner (latest timestamp wins). classes
   and students also carry a tombstone map so a deletion on one device
   isn't undone by another device syncing in an older copy. */

const Sync = (function () {
  let syncing = false;
  let notifyTimer = null;
  let statusListeners = [];

  function getConfig() { return DB.get("syncConfig", null); }
  function setConfig(cfg) { DB.set("syncConfig", cfg); }
  function isConfigured() { const cfg = getConfig(); return !!(cfg && cfg.url); }

  function setStatus(text) { statusListeners.forEach((fn) => fn(text)); }
  function onStatus(fn) { statusListeners.push(fn); }

  // Debounced: several edits in quick succession collapse into one sync
  // attempt a moment later, instead of firing a request per keystroke/save.
  function notifyLocalChange() {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => { if (isConfigured()) syncNow(); }, 1200);
  }

  async function pull(cfg) {
    try {
      const res = await fetch(cfg.url.replace(/\/$/, "") + "/", { method: "GET", cache: "no-cache" });
      if (!res.ok) return { ok: false, error: "HTTP " + res.status };
      return await res.json();
    } catch (e) {
      return { ok: false, error: e.message || "network error" };
    }
  }
  async function push(cfg, sections) {
    try {
      const res = await fetch(cfg.url.replace(/\/$/, "") + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: sections }),
      });
      if (!res.ok) return { ok: false, error: "HTTP " + res.status };
      return await res.json();
    } catch (e) {
      return { ok: false, error: e.message || "network error" };
    }
  }

  const LOADERS = {
    classes: loadClasses, classSubjects: loadClassSubjects, students: loadStudents,
    scores: loadScores, attendance: loadAttendance, announcements: loadAnnouncements, gateAnnouncement: loadGateAnnouncement,
    adminPin: getAdminPin, devices: loadDevices, subjectTomb: loadSubjectTomb, history: loadHistory,
  };
  // Presence rides the same pull/push cycle as the app's own data (so it
  // reaches every device without a second channel) but stays out of
  // SYNCED_KEYS itself so Backup/Restore never touches it.
  const SYNC_SECTIONS = SYNCED_KEYS.concat(PRESENCE_KEYS);

  function collectLocalSections() {
    const out = {};
    SYNC_SECTIONS.forEach((key) => {
      const data = LOADERS[key]();
      out[key] = { data: data, tsTree: ensureTsTree(key, data), tomb: ID_ARRAY_SECTIONS[key] ? loadTombstones(key) : undefined };
    });
    return out;
  }

  /* Accepts { sections: {key:{data,tsTree,tomb}} }. Anything missing or
     malformed just comes back as an empty/zero-timestamp section, so a
     brand-new worker with nothing stored yet, or a partial response,
     never crashes the merge — it just means "nothing to contribute here
     yet", and real local data always outranks a zero timestamp. */
  function normalizeRemote(remote) {
    const sections = (remote && remote.sections) || {};
    const out = {};
    SYNC_SECTIONS.forEach((key) => {
      const r = sections[key];
      out[key] = (r && r.tsTree !== undefined) ? r : { data: null, tsTree: 0, tomb: undefined };
    });
    return out;
  }

  // The actual recursive merge: walks local/remote data+timestamp trees
  // together. A branch (plain object, on either side) recurses key by key;
  // anything else (a number, string, or a plain array) is one leaf —
  // highest timestamp wins, with a deterministic tiebreak if two devices
  // land on the exact same millisecond with genuinely different content.
  function mergeValue(lVal, lTs, rVal, rTs) {
    if (isPlainObject(lVal) || isPlainObject(rVal) || isPlainObject(lTs) || isPlainObject(rTs)) {
      const lo = isPlainObject(lVal) ? lVal : {};
      const ro = isPlainObject(rVal) ? rVal : {};
      const lb = isPlainObject(lTs) ? lTs : {};
      const rb = isPlainObject(rTs) ? rTs : {};
      const keys = Object.keys(Object.assign({}, lo, ro, lb, rb));
      const data = {}, ts = {};
      const isEmptyObj = (v) => isPlainObject(v) && Object.keys(v).length === 0;
      keys.forEach((k) => {
        const m = mergeValue(lo[k], lb[k], ro[k], rb[k]);
        ts[k] = m.ts;                       // the timestamp is always kept: it is what records the deletion
        if (m.data === undefined) return;   // deleted -> the key is simply absent
        // Every leaf under this key was deleted, leaving an empty shell like {S1: {}} — but neither
        // side actually holds an empty object here. That is a deleted branch, not data: leave it out.
        if (isEmptyObj(m.data) && !isEmptyObj(lo[k]) && !isEmptyObj(ro[k])) return;
        data[k] = m.data;
      });
      return { data: data, ts: ts };
    }
    const lt = typeof lTs === "number" ? lTs : 0;
    const rt = typeof rTs === "number" ? rTs : 0;
    if (rt > lt) return { data: rVal, ts: rt };
    if (lt > rt) return { data: lVal, ts: lt };
    if (JSON.stringify(lVal) === JSON.stringify(rVal)) return { data: lVal, ts: lt };
    return (JSON.stringify(rVal) > JSON.stringify(lVal)) ? { data: rVal, ts: rt + 1 } : { data: lVal, ts: lt + 1 };
  }

  /* Order-independent fingerprint of a section (keys sorted; id-arrays compared as
     id -> record maps). Two devices can hold the same content in a different key/array
     order; comparing plain JSON would call that a "change" and make them re-send it to
     each other forever. */
  function canon(v) {
    if (v === undefined) return "null";
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort()
        .map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    }
    return JSON.stringify(v);
  }
  function dataFp(key, data) { return canon(ID_ARRAY_SECTIONS[key] ? arrayToMap(data) : data); }
  function fullFp(key, sec) {
    return canon({ d: ID_ARRAY_SECTIONS[key] ? arrayToMap(sec.data) : sec.data, t: sec.tsTree, k: sec.tomb || {} });
  }

  function maxLeafTs(tsBranch) {
    if (typeof tsBranch === "number") return tsBranch;
    if (!tsBranch) return 0;
    return Object.values(tsBranch).reduce((m, v) => Math.max(m, maxLeafTs(v)), 0);
  }

  // classes/students: merge as id -> record maps, union the tombstone
  // lists (deletion timestamps), and drop any record whose deletion is
  // newer than every edit it has — so a delete on one device wins over a
  // stale copy elsewhere, but an edit made AFTER a delete correctly
  // un-deletes it.
  // Only keep a record's per-field timestamp branch on a side where that
  // record actually exists in that side's data. Otherwise a record that's
  // simply absent on one side (deleted, or never synced there yet) hands
  // its "fields" to mergeValue as a set of undefined values sitting at
  // whatever stale timestamp happens to still be lying around -- which can
  // tie against the other side's real timestamp and, through the leaf
  // tie-break, occasionally win with a blank value even though nothing
  // about that field was ever actually edited.
  function pruneTsTree(tsTree, map) {
    const out = {};
    Object.keys(map || {}).forEach((id) => { if (tsTree && id in tsTree) out[id] = tsTree[id]; });
    return out;
  }

  function mergeIdArraySection(l, r, previousLocalOrder) {
    const lMap = arrayToMap(l.data), rMap = arrayToMap(r.data);
    const lTree = pruneTsTree(l.tsTree, lMap), rTree = pruneTsTree(r.tsTree, rMap);
    const merged = mergeValue(lMap, lTree, rMap, rTree);
    const tomb = {};
    Object.keys(Object.assign({}, l.tomb, r.tomb)).forEach((id) => {
      tomb[id] = Math.max((l.tomb && l.tomb[id]) || 0, (r.tomb && r.tomb[id]) || 0);
    });
    const aliveMap = {};
    Object.keys(merged.data).forEach((id) => {
      if (tomb[id] !== undefined && tomb[id] >= maxLeafTs(merged.ts[id])) return;
      aliveMap[id] = Object.assign({}, merged.data[id], { id: id }); // id is the map key — never leaf-merged
    });
    // A tombstone should persist for as long as the record stays dead (so
    // a third device catching up later still learns about the deletion),
    // and only clear once the record is alive again -- the opposite of
    // what this looked like before.
    Object.keys(tomb).forEach((id) => { if (aliveMap[id] !== undefined) delete tomb[id]; });
    return { data: mapToArray(aliveMap, previousLocalOrder), tsTree: merged.ts, tomb: tomb };
  }

  // A subject removed on one device has no per-record tombstone of its own
  // inside `scores` (only classes/students get that treatment) — so once
  // the merge above has combined both sides' scores and subjectTomb maps,
  // strip out any subject a live tombstone marks as removed. Without this,
  // a stale copy of that subject's scores sitting on a device or the
  // server that hasn't seen the removal yet would just get merged
  // straight back in — the same failure mode as Restore, at subject
  // scale instead of whole-database scale.
  function pruneTombstonedSubjectScores(scoresData, subjectTombData) {
    if (!scoresData || !subjectTombData) return scoresData;
    const removedKeys = new Set(Object.keys(subjectTombData).filter((k) => subjectTombData[k] === true));
    if (removedKeys.size === 0) return scoresData;
    let changed = false;
    const out = {};
    Object.keys(scoresData).forEach((classId) => {
      const termsObj = scoresData[classId] || {};
      out[classId] = {};
      Object.keys(termsObj).forEach((term) => {
        const subjObj = termsObj[term] || {};
        const kept = {};
        Object.keys(subjObj).forEach((subjectName) => {
          if (removedKeys.has(classId + "::" + subjectName)) { changed = true; return; }
          kept[subjectName] = subjObj[subjectName];
        });
        out[classId][term] = kept;
      });
    });
    return changed ? out : scoresData;
  }

  // The subject LIST for a class (classSubjects[classId]) is merged as one
  // unit, so a device that only ADDED a different subject can hand the whole
  // old list — including a subject someone else just removed — back to
  // everyone. The removal tombstone is the authority: drop any listed subject
  // it marks as removed. (Re-adding a subject sets its tombstone back to false.)
  function pruneTombstonedSubjectList(subjectsData, subjectTombData) {
    if (!subjectsData || !subjectTombData) return subjectsData;
    const removedKeys = new Set(Object.keys(subjectTombData).filter((k) => subjectTombData[k] === true));
    if (removedKeys.size === 0) return subjectsData;
    let changed = false;
    const out = {};
    Object.keys(subjectsData).forEach((classId) => {
      const list = subjectsData[classId];
      if (!Array.isArray(list)) { out[classId] = list; return; }
      const kept = list.filter((name) => !removedKeys.has(classId + "::" + name));
      if (kept.length !== list.length) changed = true;
      out[classId] = kept;
    });
    return changed ? out : subjectsData;
  }

  // Merges `remoteSections` into whatever's on this device RIGHT NOW
  // (re-read fresh, not the stale snapshot from before an await), writes
  // the result back, and returns it. Used both for the main pull-merge and
  // for reconciling against whatever a push's response reports. Returns
  // {merged, pulledAny, pushedAny} — pulledAny: local data changed;
  // pushedAny: what we're about to send differs from what remote had.
  /* ----- New-session safeguard (v3.10.1) -----
     Promotion (promote.js) gives every class record the same, higher `epoch` number, which
     syncs like any other field. A device whose own epoch is lower than the one it finds on the
     server missed the promotion: whatever scores / registers / remarks it still holds belong to
     the OLD session, however recently they were typed in (or whatever its clock says). So before
     merging, that device sets those aside and takes the server's copy. The set-aside copy is
     kept on the device (key "epochBackup") rather than being thrown away. */
  const SESSION_STUDENT_FIELDS = ["joinTerm", "moves", "joinWeek", "leaveWeek", "joinEligibleDays",
    "leaveEligibleDays", "remarks"];
  function maxEpoch(classesData) {
    return (Array.isArray(classesData) ? classesData : []).reduce((m, c) => Math.max(m, Number(c && c.epoch) || 0), 0);
  }
  function resetLocalSession(local, fromEpoch, toEpoch) {
    DB.set("epochBackup", { at: Date.now(), fromEpoch: fromEpoch, toEpoch: toEpoch,
      scores: local.scores.data, attendance: local.attendance.data });
    local.scores = { data: {}, tsTree: {}, tomb: undefined };
    local.attendance = { data: {}, tsTree: {}, tomb: undefined };
    const st = local.students;
    const tree = isPlainObject(st.tsTree) ? st.tsTree : {};
    st.data = (st.data || []).map((rec) => {
      const copy = Object.assign({}, rec);
      SESSION_STUDENT_FIELDS.forEach((f) => { delete copy[f]; });
      return copy;
    });
    Object.keys(tree).forEach((id) => {
      if (!isPlainObject(tree[id])) return;
      SESSION_STUDENT_FIELDS.forEach((f) => { if (f in tree[id]) tree[id][f] = 0; });
    });
    st.tsTree = tree;
  }

  function applyRemoteSections(remoteSections) {
    const local = collectLocalSections();
    let epochReset = false;
    const remoteEpoch = maxEpoch(remoteSections.classes && remoteSections.classes.data);
    const localEpoch = maxEpoch(local.classes.data);
    if (remoteEpoch > localEpoch) { resetLocalSession(local, localEpoch, remoteEpoch); epochReset = true; }
    const raw = {};
    SYNC_SECTIONS.forEach((key) => {
      const r = remoteSections[key] || { data: null, tsTree: 0 };
      const l = local[key];
      const result = ID_ARRAY_SECTIONS[key]
        ? mergeIdArraySection(l, r, l.data)
        : (() => { const m = mergeValue(l.data, l.tsTree, r.data, r.tsTree); return { data: m.data, tsTree: m.ts, tomb: undefined }; })();
      raw[key] = { result: result, l: l, r: r };
    });

    if (raw.scores && raw.subjectTomb) {
      raw.scores.result.data = pruneTombstonedSubjectScores(raw.scores.result.data, raw.subjectTomb.result.data);
    }
    if (raw.classSubjects && raw.subjectTomb) {
      raw.classSubjects.result.data = pruneTombstonedSubjectList(raw.classSubjects.result.data, raw.subjectTomb.result.data);
    }

    // pulledAny / pushedAny describe real school data only. Presence (which device was
    // last seen when) changes constantly and must never, by itself, redraw the screen or
    // be reported as "your changes". pushNeeded is the strict test: does the merged result
    // differ from what the server already holds in ANY way (data, timestamps, tombstones)?
    let pulledAny = false, pushedAny = false, pushNeeded = false;
    const merged = {};
    SYNC_SECTIONS.forEach((key) => {
      const result = raw[key].result, l = raw[key].l, r = raw[key].r;
      const isPresence = PRESENCE_KEYS.indexOf(key) !== -1;
      if (dataFp(key, result.data) !== dataFp(key, l.data) && !isPresence) pulledAny = true;
      if (fullFp(key, result) !== fullFp(key, r)) {
        pushNeeded = true;
        if (dataFp(key, result.data) !== dataFp(key, r.data) && !isPresence) pushedAny = true;
      }
      DB.set(key, result.data);
      saveTsTree(key, result.tsTree);
      if (ID_ARRAY_SECTIONS[key]) saveTombstones(key, result.tomb);
      merged[key] = { data: result.data, tsTree: result.tsTree, tomb: result.tomb };
    });
    if (epochReset) {
      pulledAny = true;
      if (typeof toast === "function") toast("A new session was started on another device — this device is now up to date");
    }
    return { merged: merged, pulledAny: pulledAny, pushedAny: pushedAny, pushNeeded: pushNeeded };
  }

  async function syncNow(opts) {
    const force = !!(opts && opts.force);
    const cfg = getConfig();
    if (!cfg || !cfg.url) { setStatus("Sync not set up yet — enter a Sync URL in Admin"); return; }
    if (!navigator.onLine) { setStatus("Offline — changes saved on this device, will sync when online"); return; }
    if (syncing) return;
    syncing = true;
    setStatus("Syncing…");
    try {
      if (typeof touchDeviceHeartbeat === "function") touchDeviceHeartbeat(force);
      const remoteRaw = await pull(cfg);
      if (remoteRaw.ok === false) { setStatus("Sync error: " + (remoteRaw.error || "check the Sync URL")); return; }
      const remoteSections = normalizeRemote(remoteRaw);
      const first = applyRemoteSections(remoteSections);

      // Only write to the server when there is something new to write. An idle device
      // used to POST the whole database every tick, whether or not anything had changed.
      const pushResult = first.pushNeeded ? await push(cfg, first.merged) : { ok: true, skipped: true };
      let pulledAny = first.pulledAny, pushedAny = first.pushedAny;
      if (pushResult && pushResult.ok !== false && pushResult.sections) {
        // Reconcile once more against whatever the server's authoritative
        // post-merge state came back as (covers another device pushing in
        // the moment between our pull and our push).
        const second = applyRemoteSections(pushResult.sections);
        pulledAny = pulledAny || second.pulledAny;
      } else if (pushResult && pushResult.ok === false) {
        setStatus("Synced locally, but couldn't reach the server to push: " + (pushResult.error || ""));
        // Local data can still have changed from the pull-merge above even
        // though the push itself failed — only skip the render when
        // nothing actually changed.
        if (first.pulledAny && typeof renderAll === "function") renderAll();
        return;
      }

      if (pushedAny) setStatus(pulledAny ? "Synced — merged changes from both devices" : "Synced — sent your changes just now");
      else if (pulledAny) setStatus("Synced — received changes from another device");
      else setStatus("Synced — up to date");

      // Most syncs (especially the 20s background tick) find nothing new.
      // Rebuilding every tab's DOM on every single tick, even when nothing
      // changed, is what makes sync feel disruptive mid data-entry — only
      // re-render when a remote change actually needs to be shown.
      if (pulledAny && typeof renderAll === "function") renderAll();
    } catch (e) {
      setStatus("Sync error: " + e.message);
    } finally {
      syncing = false;
    }
  }

  // Each check downloads the shared data, so poll only while the app is on screen, and
  // not more often than needed (edits still sync ~1s after they are made, see
  // notifyLocalChange; coming back to the app also syncs immediately).
  const POLL_MS = 20000;
  function startBackgroundSync() {
    setInterval(() => {
      if (isConfigured() && navigator.onLine && document.visibilityState === "visible") syncNow();
    }, POLL_MS);
    window.addEventListener("online", () => { if (isConfigured()) syncNow(); });
    window.addEventListener("focus", () => { if (isConfigured()) syncNow(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && isConfigured()) syncNow();
    });
  }

  return { getConfig, setConfig, isConfigured, syncNow, notifyLocalChange, onStatus, startBackgroundSync,
    _collectLocalSections: collectLocalSections, _applyRemoteSections: applyRemoteSections, _normalizeRemote: normalizeRemote };
})();

// One hook, defined here, covers every saveX() everywhere in the app —
// see commitSection() in app.js. No need to sprinkle manual "tell sync"
// calls after every save site.
window.onSyncableChange = () => Sync.notifyLocalChange();

Sync.onStatus((text) => {
  const el = document.getElementById("syncStatusText");
  if (!el) return;
  // Mirrors the reference design's small "Synced" status pill: green with
  // a check once caught up, blue while working, amber/red if something
  // needs attention -- a glance tells you which, without reading the text.
  let icon = "●", tone = "neutral";
  if (/error|couldn.t reach/i.test(text)) tone = "error";
  else if (/offline/i.test(text)) tone = "warning";
  else if (/syncing/i.test(text)) { tone = "progress"; icon = "↻"; }
  else if (/synced/i.test(text)) { tone = "success"; icon = "✓"; }
  el.className = "sync-status-pill tone-" + tone;
  el.textContent = icon + " " + text;
});

document.addEventListener("DOMContentLoaded", () => {
  Sync.startBackgroundSync();
  if (Sync.isConfigured()) Sync.syncNow();
});
