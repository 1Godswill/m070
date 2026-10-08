# Changelog

## 3.11.0 — Local Hotspot Sync (new, alongside Cloud Sync)

- **Admin > Local Hotspot Sync:** devices on the same hotspot/Wi-Fi sync live, with no Internet or data.
  Pair by scanning two QR codes (the secret is inside the QR; nothing to type). A "Back Up & Sync" prompt then
  appears, a backup of this device is saved, and the data is merged with the same per-field rules as Cloud Sync.
  After that every add/edit/delete is sent to the other device immediately as a small change event.
- Cloud Sync (sync.js, the Worker, its URL and controls) is unchanged and can run at the same time.
- **Android app (android/):** WebView wrapper with native LAN sync: devices on the same hotspot/Wi-Fi find each other
  automatically (PIN-protected, any number of devices), no QR or pairing. See android/README.md.
- New files: localsync.js, qr.js (offline QR encoder, MIT, Kazuhiko Arase). Admin card and script/cache entries added; nothing removed.

## 3.10.1 — New-session sync safeguard

- Each promotion now gives every class a new session number that syncs to all devices. A device that
  missed the promotion (offline, or still showing the old session) sets aside its old-session scores,
  registers and remarks on its next sync and takes the up-to-date copy instead of merging them in —
  even if scores were typed on it after the promotion, or its clock is wrong. The set-aside copy stays
  on that device (not deleted).
- Note: restoring a backup made before a promotion will be overridden by the newer session on the next sync.

## 3.10.0 — Promote pupils

- **Admin > Promote Pupils (end of session):** every pupil defaults to "Promote" to the next class; mark
  repeaters ("Repeat") and pupils who have left. The last class (SS 3) graduates. Bio data moves with the pupil.
  Scores, registers and teacher remarks are cleared for the new session and the class session label is updated.
  A backup file downloads first and a typed confirmation is required. Graduates/leavers are kept under hidden classes.
- **Mid-year move (Term 2 or Term 3):** Term 1 (and 2) stay in the old class exactly as issued. From the join term
  the pupil is off the old class's roll, ranking and Annual, and on the new class's roll. Their Annual in the new
  class averages only the terms attended (÷2 or ÷1) and they are ranked with the whole class on that average.
- Class Report, Report Card, Broadsheet, attendance summaries and Excel/PDF exports now use the roll for the
  selected term.

## 3.9.12 — Percent precision, logo, class picker

- Attendance percentages now show two decimal places (Register tab, gender summary, weekly totals,
  Admin student view, and Excel/PDF exports). Scores and averages are unchanged.
- Register tab: the "%" column heading now reads "Percent".
- Logo re-cut from the high-resolution artwork (471 px instead of 160 px) so it is sharp on all screens.
- Class picker: classes appear one after another over about 1.5 seconds, and the tapped class briefly
  changes colour before opening.

## 3.9.11 — Register entry order

- On the Register tab, the keyboard's Next / Enter key now moves down the week's column, from one
  student to the next in the same week, and after the last student continues at the first student
  of the next week. Previously it moved across the row (week 1 to week 2 for the same student).

## 3.9.10 — Register typing fix

- Fixes the Register tab "refreshing" while typing days present (or School Opens): the whole
  table was rebuilt after every entry, which destroyed the box you had just tapped into and
  closed the keyboard, so you had to tap again. The table is no longer rebuilt; only Present /
  Absent / % / Rating and the summary below update, exactly as the Score Entry tab already does.
  The value shown is still the saved one (e.g. a number above School Opens is adjusted down).

## 3.9.9 — Standardize Classes fix

- Fixes a bug in **Admin › Standardize Classes**: when merging attendance from a duplicate class,
  a week correctly recorded as "school was closed" (0 school-opens) could be silently overwritten
  by the other copy's number for that same week, because the merge treated 0 the same as "not set
  yet." It now only fills in a week that was genuinely never recorded. Only affects schools that
  had duplicate classes with different attendance recorded for the same week — running Standardize
  Classes again after this update will not "fix" already-merged weeks, since the wrong value is by
  then the only one left; check any weeks you know had 0 opens if you ran it before this fix.

## 3.9.8 — Sync fix

- Fixes "sync loader key is not a function" introduced in 3.9.6: the new School Announcement field
  (`gateAnnouncement`) was added to the list of things that sync, but sync's own internal loader map
  was missed, so every sync attempt crashed before it reached the network. Sync is back to normal.

## 3.9.7

- **New: Admin › Find a Student.** Search any pupil's name across every class — no need to know
  which class they're in first. Each result shows the pupil's class, subjects, every term's total,
  average, position and attendance, and their latest comment, all in one card, with a button to
  jump straight to their class. Typing stays smooth: only the results box redraws as you type, the
  search box itself is never rebuilt, and the search runs after a brief pause in typing rather than
  on every letter.
- **New: live clock in the header** — today's date and the current time, updating every second.
- **New: every printed or exported document is timestamped** — Report Card, Class Report, Broadsheet,
  the PDF export and the Excel export (which also gets an "Info" sheet with the generated time) all
  now carry the same "Printed <date> at <time>" line, for reference.

## 3.9.6

- **Login banner fixed:** it now shows only on the class-select screen — not on the access-code screen —
  and it fully clears the screen edge to edge before it repeats. Slowed down to a steady, readable pace.
- **New: Admin › School Announcement** — the banner's text is now editable from Admin, separate from the
  per-class announcements below it. It syncs to every device like everything else. Leave it blank to turn
  the banner off.

## 3.9.5

- **Fixed class-name matching:** names with a hyphen *and* a space together, like "PRE- NURSERY", were
  not recognised as PRE-NUR and stayed as a separate, unmerged class at the end of the list. Any mix of
  spaces, hyphens, dots or underscores is now treated as a single separator.
- If you already have a stray class like this, run **Admin › Standardize Classes** once on that device
  after updating, then sync the others.

## 3.9.4

- Student list: the drag-to-reorder handle is now the very last item on the right, after Remove.

## 3.9.3

- **Student list:** the drag-to-reorder handle moved from the left of each row to the right, next to Remove.
- **Login screen:** added a scrolling banner (right to left) telling teachers to select their class and
  key in their password.
- **Access code entry:** shows 🙁 for a wrong code and 😊 for a correct one, just before entering the class.

## 3.9.2 — APK / hosting fix

- Fixes the installed Android APK hanging on its opening screen when the site is hosted somewhere that
  redirects `/index.html` to `/` (e.g. Cloudflare Pages). The service worker now stores and serves
  clean, non-redirected pages, and the manifest starts at `./` instead of `./index.html`.
- **After updating the hosted site, rebuild the APK** (PWABuilder reads the manifest when it builds).

## 3.9.1

- **Fixed class list updated:** CRECHE, PRE-NUR, NUR 1–3, PRY 1–5, JSS 1–3, SS 1–3 (16 classes, in that order).
  Senior secondary is now "SS" (was "SSS"), and PRY 6 is no longer in the list. Classes already made
  with the old SSS ids or PRY 6 are picked up by Admin › Standardize Classes (SSS → SS); PRY 6 is left as it is.

## 3.9.0 — Fixed class list, capitals, roomier names

- **Classes are now picked from a fixed list, not typed.** Admin › **+ Class** shows PRE-NUR, NUR 1–2,
  the fixed class list, in order. Each has a permanent built-in id, so the same class added on
  two devices is the *same* class: sync merges it field by field (e.g. the newest access code wins)
  instead of creating a duplicate. The login screen and Admin list show classes in this same order.
- **New: Admin › Standardize Classes** — a one-time fix for classes that are already duplicated or
  old-style. Classes whose names match the list are merged into the fixed class (pupils, subjects,
  scores, attendance, announcements move across; extra copies are removed). A backup downloads first.
  Run it on one device, then sync the others.
- **Everything is in capitals.** All text now displays in capitals, text is converted as it's typed,
  and existing pupil and class names are converted (and synced). Access codes and the Sync URL stay
  case-sensitive. Adding a subject now matches an existing one ignoring case, so no twins.
- **Removed the initials circle before pupil names** everywhere, giving names more room.
- **Removed "Rename" for classes** — names come from the fixed list.

## 3.8.0 — Class picker redesign

- **Class list is now a floating 3-column grid** on the login screen, with every class visible at once
  (no scrolling for up to 15 classes) and raised, rounded buttons.
- **Short class labels** on the buttons — PRE-NUR, NUR 1, PRY 1, JSS 1, SSS 1 and so on. This is display
  only: the real class names in Admin and on reports are unchanged, and unrecognised names show as typed.
- **School photo as a faint watermark** behind the login screen instead of the plain dark background
  (`icons/school-bg.jpg`, cached for offline use).

## 3.7.1

- **Fixed: the "Admin" link on the login screen didn't respond** unless a class had already been
  unlocked earlier in the session. The gate was also re-checking the currently-selected class's lock
  status even while switching to Admin — and since the app quietly defaults to the first class when
  nobody's explicitly picked one, a locked first class made the gate reappear and cancel the switch
  right after it happened. The login gate now never applies while the Admin tab is the active one,
  since Admin already has its own independent PIN gate.

## 3.7.0 — Login gate

- **A proper front door.** Opening the app now shows a full-screen class picker before anything else —
  no class names, and no "+ Class" button, exposed up front any more. Pick a class; if it has an access
  code, enter it on a dedicated screen with segmented code boxes (sized to match whatever code is
  already set — nothing about existing codes needs to change). A class with no code opens straight away.
  This happens once per app session, same as the old inline code prompt did.
- **Admin is now a quiet link** under the class list on that same screen, leading straight to the
  existing Admin PIN prompt — unchanged otherwise.
- **"+ Class" moved into the Admin tab**, under Classes & Access Codes. Adding a class is an admin
  action now, not something available before anyone has logged in.
- **"Switch Class"** replaces the old always-visible class dropdown in the header. It reopens the login
  gate's class picker; picking a class already unlocked this session skips straight back in.

## 3.6.2

- **Fixed: the 3.6.1 cleanup missed a case.** Before 3.6.0, deleting a class removed only the class —
  its pupils stayed in the students list, pointing at a classId that no longer existed. 3.6.1's cleanup
  removed the leftover scores/attendance for a deleted class but not those orphaned pupil records
  themselves. It now does.

## 3.6.1

- **Admin tab → Old Hidden Data → Clean up old hidden data.** A one-time sweep for data that pre-3.6.0
  deletions left behind — scores, attendance, "Not taking" ticks and announcements for a pupil, class or
  subject that no longer exists. Safe to run any time, including more than once (it does nothing once
  there's nothing left); there's no Undo for this one, since it only removes data the app hasn't been
  able to show or restore for a long time already. Runs through the normal sync path, so it also cleans
  the copy on the Worker and every other device once they sync.

## 3.6.0 — Deleting really deletes, with Undo and History

- **Deleting now removes everything that belongs to the item.** A pupil takes their scores and attendance with them; a class takes its pupils, subjects, scores, register, announcement and access code; a subject takes its scores in every term and every pupil's "Not taking" tick for it. Before, only the pupil / class / subject itself was hidden and everything else stayed stored on every device, in backups and on the sync server. (Data hidden by older versions is left exactly as it was.)
- **Admin tab → Deleted Items & Undo.** Every deletion (pupil, class, subject, register week) is listed with when and on which device. **Undo last delete** puts back the most recent one; **Restore** on any entry puts that one back. Restore never overwrites what is on screen now, works from any synced device, and is refused (with a reason) if it could not be put back cleanly, e.g. a pupil whose class is also deleted (restore the class first). Entries are kept for 60 days (at most 50) and are then gone for good. If an undo copy cannot be saved, nothing is deleted.
- Deleted-items history syncs between devices but is never written into Backup files.
- **Fixed: a removed subject could come back.** If one device removed a subject while another added a different subject to the same class, the removed subject reappeared in the list and any marks typed into it were silently deleted on the next sync. Removal now wins in the list too.
- **Fixed: re-adding a removed subject brought back old "Not taking" ticks.**
- Sync no longer leaves empty `{}` shells behind where data was deleted.
- New file `history.js` (listed in `index.html` and the offline cache).

## 3.5.1

- Removed **Wipe All Data** from the Admin tab (and the code behind it). Classes, students and subjects are still removed one at a time.

## 3.5.0 — Grading and report cards

- **Subjects a pupil does not take.** Score Entry has a "Not taking" tick per pupil for the subject on screen (electives such as Yoruba / Hausa). Those pupils are left out of that subject's ranking and class average, the subject does not appear on their report card (the rest are numbered 1, 2, 3…), and their overall average is worked out over the subjects they do take.
- **Overall position is now by average** (total ÷ subjects taken). For a class where everyone takes the same subjects this is the same order as before; it only matters when pupils take different numbers of subjects.
- **Class teacher's comment** is now chosen from the pupil's average (same bands as the grade letters, the school's own wording) instead of from class position, and is editable: on the Report Card tab, type your own and it is kept for that pupil and that term (Annual has its own) and printed. "Use the suggested comment" goes back. Comments are stored on the pupil, so they sync and back up.
- **Print all** on the Report Card tab prints every pupil's report card for the selected term, one per page. Pupils with no scores that term are skipped.
- Printing: the report card's purple column headings and the "Class Teacher / Principal" label cells now print (they were dropped by browsers' default print settings, leaving white text on white).
- Class Report and Excel use the same comments and leave out subjects a pupil does not take.

## 3.4.1

- Security is exactly as it was in 3.3.x (Admin PIN, class access codes, private Worker URL). The token / hashed-PIN / snapshot design that was briefly tried is removed.
- Fixed: on every tab except Students, typing the right class code and tapping Unlock did nothing (all locked tabs shared the same element ids and only the first was wired up). Each tab's lock screen now works.

## 3.4.0 — Phase 0 fixes

**Speed**
- Grade calculations are built once per class/term/subject and reused (v3.3.x recomputed everything for every cell). Annual views that took over a minute now take milliseconds.
- Only the tab you are looking at is redrawn after an edit or sync (was: all seven).
- Score Entry no longer rebuilds the table after each score; the cursor stays where you put it and only Total / Position / Grade update.

**Correct results**
- A score of 0 is a real score (ranked, graded, included in the class average, and shown as 0). A blank box still means "not entered / absent".
- Attendance is per term. Each Register week carries a term; a report card counts only its own term's weeks, Annual counts all. Existing weeks count as Term 1 until you set the term on the Register (a notice tells you).
- PDF export / Print Preview prints the preview itself (it used to print whichever tab was underneath). Landscape pages print landscape.

**Access & safety**
- Backup & Restore moved to the Admin tab. Backup files never contain the Admin PIN, and restoring never changes it.
- Excel / Preview / PDF on Class Report, Report Card and Broadsheet export only the current class. "All classes" export is on the Admin tab only.
- Ids are escaped wherever they are put into a page, and records arriving from sync with an unsafe id are discarded.
- The Admin tab warns while the default PIN is still in use.

**Sync**
- A device only writes to the server when it has something new. Idle devices no longer write every 10 s.
- Device presence ("Online") refreshes every 5 minutes instead of every 10 seconds, and never redraws the screen by itself.
- Checks run every 20 s and only while the app is on screen.
- Order-only differences between devices are no longer treated as changes.

**Worker (backend/worker.js) — re-paste into Cloudflare and Deploy**
- Replies "not modified" (304) when nothing changed, so idle checks download almost nothing.
- Replies with a tiny "ok" after saving instead of echoing the whole database.
- Rejects requests that are not the app's own payload, and oversized ones.
- The app works with the old Worker too, but without the bandwidth savings.
