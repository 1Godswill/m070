# St. Stephen's Report Card System — PWA

An offline-first, multi-class report card and attendance tracker. Works
fully offline once loaded, installs like a native app on phone or laptop,
and syncs across devices — field by field, so two devices can add, edit
or delete different things (or even different fields of the same
student) at the same time without overwriting each other.

## What it does

- **Classes** — add as many classes as you need (e.g. BASIC 5, NURSERY 3),
  each with its own students and subject list, from the Admin tab. Opening
  the app shows a login screen to pick a class (and enter its access code,
  if it has one); "Switch Class" in the header brings that screen back.
  Starts empty — nothing is pre-loaded, everything is entered by you.
- **Students** — manage each class's roll, including gender
- **Score Entry** — pick a subject + term, enter Test 1 / Test 2 / Exam for
  the whole class in one grid, with live Position shown per student.
  Subjects are picked from common suggestions **or typed in manually** —
  every class can have a completely different subject set.
- **Register** — weekly attendance, with an automatic gender/attendance
  summary (male vs female totals and averages, which gender attends more,
  per-week and per-term totals, class average)
- **Class Report** — ranked list for any Term or Annual view; tap a student
  for their full subject breakdown, including the class average per subject
- **Report Card** — a faithful reproduction of the school's paper report
  sheet: header, Name/Gender/Class/Population/Average/Position, the marks
  table (Position Per-Subject, Average, Grade, Remark), signature lines,
  and the marking key. The Annual view shows each subject's 1st/2nd/3rd
  Term totals instead of Test1/Test2/Exam.
- **Broadsheet** — whole-class summary sorted by rank, always prints A4
  landscape, automatically split into multiple pages when there are more
  than 6 subjects (each page repeats S/N + Student Name)
- **Print Preview** — see exactly what will print before opening the OS
  print dialog, on both the Report Card and Broadsheet
- **Admin tab** — class access codes, class announcements, sync,
  export (Preview / Excel / PDF), local Backup & Restore, and Deleted Items & Undo

Grading bands (A 80-100, B 70-79, C 60-69, D 50-59, E 40-49, F 0-39) match
the school's paper template exactly.

## Deleting, Undo and History

Deleting a pupil, class, subject or the last register week really deletes it, together with everything that
belongs to it (a pupil's scores and attendance, a class's pupils, subjects, scores, register and announcement,
a subject's scores). A copy of exactly what was removed is kept for 60 days under **Admin tab → Deleted Items &
Undo**: **Undo last delete** puts back the most recent one, **Restore** puts back any listed one. Restoring
never overwrites what is on screen now, and it works from any device that syncs. After 60 days (or once there
are more than 50 entries) the oldest copies are gone for good. This history is not part of Backup files.

## Getting it online (needed for offline mode + install + sync)

Service workers (offline mode, installability) only work over **HTTPS** or
**localhost**, not a plain `file://` link.

1. Go to https://app.netlify.com/drop
2. Drag this whole folder in
3. Open the live HTTPS link it gives you in Chrome (phone or laptop)

Then: Chrome menu → "Add to Home screen" (phone) or the install icon ⊕ in
the address bar (laptop) — or use the in-app "⬇ Install" button in the
header, which also shows manual instructions on browsers (like iOS Safari)
that don't support the automatic prompt.

## Testing locally first

```
python3 -m http.server 8080
```
Then open `http://localhost:8080` in Chrome.

## Syncing across devices

See **CLOUDFLARE-SETUP.md** for the one-time (~10 minute) setup, entirely
in the Cloudflare dashboard — no command line needed. Then paste the
Worker URL it gives you into **Admin tab → Sync Across Devices → Sync
URL** on every device you want kept in sync.

## Data & backups

Local edits are saved instantly to the browser's `localStorage` on each
device, and merged with every other synced device automatically. Even
so, use **Admin tab → Backup & Restore** to download a JSON backup now
and then — it's the fastest way to recover this device (or seed a new
one) if a browser is ever cleared or a device is lost, sync or no sync.

## Shipping an update (so every device gets it)

1. Change the number in **version.js** (e.g. 3.3.3 → 3.3.4) — this is the
   only place the version lives.
2. Re-upload the whole folder to Netlify (same site, so the address stays).
3. Each device notices the change the next time the app is opened or comes
   back to the screen while online (and every 30 minutes if left open), then
   shows a green **"A new version is ready — Update now"** bar. Devices that
   are offline pick it up the next time they connect. Local data is never
   touched by an update.
