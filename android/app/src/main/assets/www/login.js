/* ================= LOGIN GATE =================
   A full-screen "front door" shown before any class's data is visible:
   pick a class, then (if that class has an access code) enter it. Admin
   is a quiet link on the picker screen that skips straight to the Admin
   tab's own PIN prompt (admin.js) — nothing about that prompt changes.

   Session state only — everything here resets on reload, same as
   unlockedClassIds and adminUnlocked already do:
     hasEnteredApp   — the gate always shows once per fresh load, even for
                       a class with no code, so opening the app always
                       means picking a class first.
     gateForcedOpen  — set by the "Switch Class" link to bring the gate
                       back on demand, overriding hasEnteredApp.
     gateStep / gatePendingClassId — which screen is showing, and for
                       which class, while mid-flow.
     gateRenderedKey — what's currently drawn. renderAll() calls
                       renderLoginGate() on every redraw (sync polling
                       included), so this key stops a background refresh
                       from wiping out a code the person is mid-typing. */
let hasEnteredApp = false;
let gateForcedOpen = false;
let gateStep = "picking";       // "picking" | "code"
let gatePendingClassId = null;
let gateRenderedKey = null;

function shouldShowGate() {
  if (gateForcedOpen) return true;
  // The Admin tab gates itself with its own PIN (admin.js) — it isn't tied
  // to any particular class, so it must never be blocked by this gate.
  // Without this check, getCurrentClassId() silently defaulting to the
  // first class (even though nobody picked one) could make a still-locked
  // "current" class re-trigger this gate right after switching to Admin,
  // instantly bouncing back and making the Admin link look unresponsive.
  const activeTab = document.querySelector(".tab.active");
  if (activeTab && activeTab.id === "admintab") return false;
  if (!hasEnteredApp) return true;
  const classId = getCurrentClassId();
  return classId ? !isClassUnlocked(classId) : true;
}

function enterApp() {
  hasEnteredApp = true;
  gateForcedOpen = false;
  gateStep = "picking";
  gatePendingClassId = null;
  gateRenderedKey = null;
  const el = document.getElementById("loginGate");
  if (el) el.style.display = "none";
  activateTab("students");
}

function openGateAtPicker() {
  gateForcedOpen = true;
  gateStep = "picking";
  gatePendingClassId = null;
  gateRenderedKey = null;
  renderLoginGate();
}

function renderLoginGate() {
  const el = document.getElementById("loginGate");
  if (!el) return;
  if (!shouldShowGate()) {
    if (el.style.display !== "none") {
      el.style.display = "none"; gateRenderedKey = null;
      removeGateMarquee();
    }
    return;
  }
  el.style.display = "flex";
  updateGateMarquee();

  const classes = sortedClasses();
  let key;
  if (gateStep === "code" && gatePendingClassId && classes.some((c) => c.id === gatePendingClassId) && classNeedsCode(gatePendingClassId)) {
    key = "code:" + gatePendingClassId;
  } else {
    gateStep = "picking";
    gatePendingClassId = null;
    key = "picking:" + classes.map((c) => c.id + (classNeedsCode(c.id) ? "1" : "0")).join(",");
  }
  if (key === gateRenderedKey) return; // already showing exactly this — don't reset a mid-typed code
  gateRenderedKey = key;

  updateGateMarquee();
  if (gateStep === "code") renderGateCodeStep(el, gatePendingClassId);
  else renderGatePickerStep(el, classes);
}

/* Scrolling notice — shown ONLY on the first (class-select) screen, never on
   the access-code screen or once a teacher is inside the app. Text comes from
   Admin > School Announcement and is synced like everything else. */
function removeGateMarquee() {
  const mq = document.getElementById("gateMarquee");
  if (mq) mq.remove();
}
function updateGateMarquee() {
  const text = (typeof loadGateAnnouncement === "function" ? loadGateAnnouncement() : "").trim();
  if (gateStep !== "picking" || !text) { removeGateMarquee(); return; }
  let mq = document.getElementById("gateMarquee");
  if (!mq) {
    mq = document.createElement("div");
    mq.id = "gateMarquee";
    mq.className = "gate-marquee no-caps";
    mq.innerHTML = "<span></span>";
    document.body.appendChild(mq);
  }
  const span = mq.querySelector("span");
  const gap = "\u00A0".repeat(20);
  const shown = text + gap + text; // repeats once so the gap after the first copy still crosses the screen
  if (span.dataset.text !== text) {
    span.dataset.text = text;
    span.textContent = shown;
    // Slower for longer text, so it never feels rushed; ~90ms per character, floor 18s.
    span.style.animationDuration = Math.max(18, shown.length * 0.09) + "s";
  }
}

function renderGatePickerStep(el, classes) {
  el.innerHTML = `
    <div class="gate-card">
      <img src="icons/logo.png" alt="" class="gate-logo">
      <h1 class="gate-title">SSSACAD</h1>
      <p class="gate-sub">Select your class</p>
      ${classes.length ? `
        <div class="gate-class-list">
          ${classes.map((c, i) => `
            <button type="button" class="gate-class-btn" data-class="${esc(c.id)}" title="${esc(c.name)}" style="animation-delay:${(i * 1.5 / classes.length).toFixed(2)}s">
              <span>${esc(shortClassName(c.name))}</span>
              ${classNeedsCode(c.id) ? '<span class="gate-lock" title="Code required">🔒</span>' : ""}
            </button>
          `).join("")}
        </div>
      ` : `<div class="empty">No classes yet — ask an admin to add one.</div>`}
      <button type="button" class="gate-admin-link" id="gateAdminBtn">Admin</button>
    </div>
  `;
  el.querySelectorAll(".gate-class-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (el.querySelector(".gate-class-btn.selected")) return; // already responding to a tap
      const classId = btn.dataset.class;
      btn.classList.add("selected"); // visible response: the chosen class changes colour for a moment
      setTimeout(() => {
        setCurrentClassId(classId);
        if (classNeedsCode(classId) && !isClassUnlocked(classId)) {
          gateStep = "code";
          gatePendingClassId = classId;
          gateRenderedKey = null;
          renderLoginGate();
        } else {
          enterApp();
        }
      }, 300);
    });
  });
  const adminBtn = document.getElementById("gateAdminBtn");
  if (adminBtn) {
    adminBtn.addEventListener("click", () => {
      hasEnteredApp = true; // the Admin tab has its own PIN gate; this just dismisses the class picker
      gateForcedOpen = false;
      gateRenderedKey = null;
      el.style.display = "none";
      activateTab("admintab");
    });
  }
}

function renderGateCodeStep(el, classId) {
  const cls = loadClasses().find((c) => c.id === classId);
  const codeLen = cls && cls.accessCode ? cls.accessCode.length : 4;
  el.innerHTML = `
    <div class="gate-card">
      <img src="icons/logo.png" alt="" class="gate-logo">
      <h1 class="gate-title">${esc(cls ? cls.name : "This class")}</h1>
      <div id="gateFace" style="font-size:34px;line-height:1;height:40px;margin:2px 0 -2px;">&nbsp;</div>
      <p class="gate-sub">Enter the access code</p>
      <div class="gate-pin-row" id="gatePinRow">
        ${Array.from({ length: codeLen }).map((_, i) =>
          `<input type="password" inputmode="text" maxlength="1" autocomplete="off" class="gate-pin-box" data-i="${i}">`
        ).join("")}
      </div>
      <button type="button" class="btn" id="gateUnlockBtn" style="margin-top:16px;">Unlock</button>
      <button type="button" class="gate-back-link" id="gateBackBtn">‹ Choose a different class</button>
    </div>
  `;
  const boxes = Array.from(el.querySelectorAll(".gate-pin-box"));
  if (boxes[0]) boxes[0].focus();

  const face = document.getElementById("gateFace");
  const tryUnlock = () => {
    const code = boxes.map((b) => b.value).join("");
    if (unlockClassWithCode(classId, code)) {
      if (face) face.textContent = "\uD83D\uDE0A"; // 😊 happy face — correct password
      toast("Class unlocked");
      setTimeout(enterApp, 350); // let the happy face show briefly before entering
    } else {
      if (face) face.textContent = "\uD83D\uDE1F"; // 🙁 frowning face — wrong password
      toast("Incorrect code");
      boxes.forEach((b) => { b.value = ""; });
      if (boxes[0]) boxes[0].focus();
    }
  };

  boxes.forEach((box, i) => {
    box.addEventListener("input", () => {
      box.value = box.value.slice(-1);
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
      if (boxes.every((b) => b.value)) tryUnlock();
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && i > 0) { boxes[i - 1].value = ""; boxes[i - 1].focus(); }
      if (e.key === "Enter") tryUnlock();
    });
    box.addEventListener("paste", (e) => {
      const cd = e.clipboardData || window.clipboardData;
      const text = cd ? cd.getData("text") : "";
      if (!text) return;
      e.preventDefault();
      const chars = text.split("");
      boxes.forEach((b, idx) => { b.value = chars[idx] || ""; });
      const lastFilled = Math.min(chars.length, boxes.length) - 1;
      if (boxes[lastFilled]) boxes[lastFilled].focus();
      if (boxes.every((b) => b.value)) tryUnlock();
    });
  });

  document.getElementById("gateUnlockBtn").addEventListener("click", tryUnlock);
  document.getElementById("gateBackBtn").addEventListener("click", () => {
    gateStep = "picking";
    gatePendingClassId = null;
    gateRenderedKey = null;
    renderLoginGate();
  });
}
