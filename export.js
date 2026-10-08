/* St Stephen's Report Card System — Excel & PDF export (client-side).
   Excel via SheetJS; PDF via the browser's own print-to-PDF (same engine
   already used for Report Card / Broadsheet printing) so no heavy PDF
   library is needed. A preview of the data always comes before either. */

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }

/* Builds the full export dataset once, shared by Excel export, PDF export,
   and the preview — so all three always show exactly the same numbers. */
function buildExportData(onlyClassId) {
  // onlyClassId: export just that class (used by the class tabs, which are unlocked one
  // class at a time). Omitted = every class (Admin tab only, which needs the admin PIN).
  const classes = loadClasses().filter((c) => !onlyClassId || c.id === onlyClassId);
  const allStudents = loadStudents();
  const VIEWS = ["1", "2", "3", "A"];

  const studentsRows = [];
  const breakdownRows = [];
  const summaryRows = [];
  const attendanceRows = [];
  const genderRows = [];

  classes.forEach((cls) => {
    const classStudents = allStudents.filter((s) => s.classId === cls.id);
    const subjects = subjectsForClass(cls.id);

    classStudents.forEach((s) => studentsRows.push([cls.name, s.name, s.gender || ""]));

    VIEWS.forEach((v) => {
      const classStudents = classMembers(cls.id, v);   // roll for this term (see app.js)
      classStudents.forEach((s) => {
        subjects.forEach((subj) => {
          const r = subjectRowFor(cls.id, v, subj, s.id, classStudents);
          if (r.notTaking) return;   // not one of this pupil's subjects
          const isAnnual = v === "A";
          breakdownRows.push([
            cls.name, s.name, termLabel(v), subj,
            round1(isAnnual ? r.term1Total : r.test1),
            round1(isAnnual ? r.term2Total : r.test2),
            round1(isAnnual ? r.term3Total : r.exam),
            round1(r.total), r.position, round1(r.classAverage), r.grade, r.remark,
          ]);
        });
        const gt = grandTotalFor(cls.id, v, s.id, classStudents);
        const avg = averageFor(cls.id, v, s.id, classStudents);
        summaryRows.push([cls.name, s.name, termLabel(v), round1(gt.total), round1(avg), gt.position,
          classStudents.length, commentForStudent(cls.id, v, s, classStudents)]);
      });
    });

    // Attendance is per term ("A" = the whole year), matching each report card.
    VIEWS.forEach((v) => {
      classMembers(cls.id, v).forEach((s) => {
        const sum = studentAttendanceSummary(cls.id, s.id, v);
        const joinWk = (s.joinWeek != null && s.joinWeek !== "") ? Number(s.joinWeek) + 1 : "";
        const leaveWk = (s.leaveWeek != null && s.leaveWeek !== "") ? Number(s.leaveWeek) + 1 : "";
        attendanceRows.push([cls.name, s.name, s.gender || "", termLabel(v), joinWk, leaveWk, sum.opens, sum.present, sum.absent,
          round2(sum.pct), attendanceRatingFor(sum.pct)]);
      });
      const gsum = classAttendanceSummary(cls.id, v);
      genderRows.push([cls.name, termLabel(v), gsum.maleCount, gsum.femaleCount, gsum.maleTotal, gsum.femaleTotal,
        round2(gsum.maleAvgPct), round2(gsum.femaleAvgPct), gsum.higherGender,
        gsum.totalSchoolOpens, gsum.totalAttendanceTerm, round2(gsum.classAveragePct)]);
    });
  });

  return {
    studentsSheet: { headers: ["Class", "Student", "Gender"], rows: studentsRows },
    breakdownSheet: { headers: ["Class", "Student", "Term-View", "Subject", "Test1 / 1st Term", "Test2 / 2nd Term",
      "Exam / 3rd Term", "Total", "Subject Position", "Class Average", "Grade", "Remark"], rows: breakdownRows },
    summarySheet: { headers: ["Class", "Student", "Term-View", "Grand Total", "Average", "Class Position",
      "Class Population", "Comment"], rows: summaryRows },
    attendanceSheet: { headers: ["Class", "Student", "Gender", "Term-View", "Joined Week", "Left Week", "Days Eligible",
      "Present", "Absent", "Attendance %", "Rating (of 5)"], rows: attendanceRows },
    genderSheet: { headers: ["Class", "Term-View", "Male Count", "Female Count", "Male Total Attendance",
      "Female Total Attendance", "Male Avg %", "Female Avg %", "Higher-Attending Gender",
      "Total School Opens", "Total Attendance", "Class Average %"], rows: genderRows },
  };
}

/* Every export takes an optional classId. With one, only that class is exported. Without
   one it covers every class — only the Admin tab calls it that way. */
function exportScope(classId) {
  const classes = loadClasses().filter((c) => !classId || c.id === classId);
  const ids = new Set(classes.map((c) => c.id));
  const students = loadStudents().filter((s) => ids.has(s.classId));
  return { classes: classes, students: students, label: classId && classes[0] ? classes[0].name : "All Classes" };
}

function exportClassToExcel(classId) {
  if (typeof XLSX === "undefined") {
    toast("Export library still loading — try again in a moment");
    return;
  }
  const scope = exportScope(classId);
  if (!scope.classes.length || !scope.students.length) {
    toast("Add classes and students first");
    return;
  }
  const data = buildExportData(classId);
  const wb = XLSX.utils.book_new();
  addSheet(wb, "Info", ["Generated", "Scope"], [[printStampText(), scope.label]]);
  addSheet(wb, "Students", data.studentsSheet.headers, data.studentsSheet.rows);
  addSheet(wb, "Score Breakdown", data.breakdownSheet.headers, data.breakdownSheet.rows);
  addSheet(wb, "Summary", data.summarySheet.headers, data.summarySheet.rows);
  addSheet(wb, "Attendance", data.attendanceSheet.headers, data.attendanceSheet.rows);
  addSheet(wb, "Gender Summary", data.genderSheet.headers, data.genderSheet.rows);

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
  const scopeName = classId ? " - " + scope.label.replace(/[\\/:*?"<>|]+/g, " ").trim() : "";
  XLSX.writeFile(wb, `St Stephens Report Data${scopeName} - ${stamp}.xlsx`);
  toast("Excel file downloaded");
}

function addSheet(wb, name, header, rows) {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

/* Small HTML <table> renderer, shared by the preview modal and the PDF
   export page (which reuses the app's own print pipeline / Save-as-PDF). */
function htmlTableFrom(sheet) {
  if (!sheet.rows.length) return `<div class="empty">Nothing to show yet.</div>`;
  return `<div class="subtable-wrap"><table>
    <thead><tr>${sheet.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${sheet.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

/* Shows what the export will contain (Summary, Attendance, Gender Summary —
   the Score Breakdown/Students sheets are per-subject detail, included in
   the real files but skipped here for brevity), with buttons to actually
   produce the Excel workbook or a printable PDF from the same data. */
function previewExport(classId) {
  const scope = exportScope(classId);
  if (!scope.classes.length || !scope.students.length) {
    toast("Add classes and students first");
    return;
  }
  const data = buildExportData(classId);
  openExportPreview(
    scope.label,
    [
      { title: "Summary (Grand Total, Average, Position per student per term)", html: htmlTableFrom(data.summarySheet) },
      { title: "Attendance", html: htmlTableFrom(data.attendanceSheet) },
      { title: "Gender Summary", html: htmlTableFrom(data.genderSheet) },
    ],
    () => exportClassToExcel(classId),
    () => exportToPdf(classId)
  );
}

/* PDF "export" = the app's existing print pipeline (Save as PDF from the
   browser's print dialog) — no extra library needed, same engine already
   used for Report Card / Broadsheet, applied here to the Summary/Attendance
   tables for every class. */
function exportToPdf(classId) {
  const scope = exportScope(classId);
  if (!scope.classes.length || !scope.students.length) {
    toast("Add classes and students first");
    return;
  }
  const data = buildExportData(classId);
  const page = `
    <div class="export-page" style="padding:24px;font-family:-apple-system,Roboto,Segoe UI,Arial,sans-serif;">
      <h1 style="font-size:18px;">St Stephen's Report Card System — Export (${esc(scope.label)})</h1>
      <p style="font-size:11px;color:#666;">${esc(printStampText())}</p>
      <h2 style="font-size:14px;margin-top:18px;">Summary</h2>
      ${htmlTableFrom(data.summarySheet)}
      <h2 style="font-size:14px;margin-top:18px;">Attendance</h2>
      ${htmlTableFrom(data.attendanceSheet)}
      <h2 style="font-size:14px;margin-top:18px;">Gender Summary</h2>
      ${htmlTableFrom(data.genderSheet)}
    </div>
  `;
  openPrintPreview([page], "portrait");
  toast("Choose \"Save as PDF\" in the print dialog to export");
}
