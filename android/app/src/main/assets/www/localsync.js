/* ================= LOCAL HOTSPOT SYNC (v3.11.0) =================
   A second, independent sync path next to the Cloudflare one in sync.js (which is untouched).
   Two phones on the same hotspot/Wi-Fi talk straight to each other over a WebRTC DataChannel —
   no Internet, no Worker, no STUN. A browser cannot discover another device on its own, so the
   two phones swap one short text code each way (offer -> answer) by copy/paste or Share; after
   that the link stays open and edits are pushed instantly as small change events.
   Merging reuses Cloudflare sync's own per-field merge (Sync._applyRemoteSections), so conflict
   rules, tombstones, ids and the new-session safeguard are identical. Both paths are idempotent:
   a change that arrives locally and later via Cloudflare simply merges to "no change". */
const LocalSync = (function () {
  const MAX_MSG = 5 * 1024 * 1024;
  const DEFAULTS = { enabled: true, remember: true, askBackup: true, live: true, name: "", pin: "" };
  const NATIVE = !!window.AndroidSync;               // true inside the Android app: native LAN transport, no pairing
  const npeers = {};
  let pc = null, dc = null, role = null, code = "", peer = null, state = "off";
  let accepted = false, pending = [], nonceA = "", sendTimer = null, promptShown = false, offerDeviceId = null;
  const seen = new Set();
  const listeners = [];

  const enc = new TextEncoder();
  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const rnd = () => hex(crypto.getRandomValues(new Uint8Array(12)));
  const u8b64 = (u8) => btoa(String.fromCharCode.apply(null, u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64u8 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  async function pipe(u8, stream) { const w = stream.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(stream.readable).arrayBuffer()); }
  async function pack(o) {                       // object -> short ASCII string (goes into the QR)
    const raw = enc.encode(JSON.stringify(o));
    if (window.CompressionStream) return "Z" + u8b64(await pipe(raw, new CompressionStream("deflate-raw")));
    return "J" + u8b64(raw);
  }
  async function unpack(str) {
    str = String(str || "").replace(/\s+/g, "");
    const body = b64u8(str.slice(1)), k = str[0];
    if (k === "Z") return JSON.parse(new TextDecoder().decode(await pipe(body, new DecompressionStream("deflate-raw"))));
    if (k === "J") return JSON.parse(new TextDecoder().decode(body));
    throw new Error("bad code");
  }
  async function mac(key, text) {
    const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return hex(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
  }

  function settings() { return Object.assign({}, DEFAULTS, DB.get("localSyncSettings", {})); }
  function saveSettings(patch) { DB.set("localSyncSettings", Object.assign(settings(), patch)); }
  function myName() { return settings().name || "SSSACAD-" + getDeviceId().slice(-4); }
  function peers() { return DB.get("localSyncPeers", {}); }
  function setState(s, extra) { state = s; listeners.forEach((fn) => fn(s, extra)); }
  function onState(fn) { listeners.push(fn); }
  const LABEL = { off: "Disconnected", waiting: "Waiting for the other device…", connecting: "Connecting…",
    confirm: "Awaiting backup confirmation", initial: "Initial synchronization…", live: "Live Sync Active",
    paused: "Connected — sync paused (live sync is OFF)", searching: "Looking for your other devices…", needpin: "Set a Sync PIN to start", lost: "Connection lost — changes are stored on this device" };
  function statusText() {
    if (NATIVE && (state === "live" || state === "paused")) { const c = Object.keys(npeers).length; return (LABEL[state] || state) + " · " + c + " device" + (c === 1 ? "" : "s"); }
    const n = peer ? " · " + peer.name : "";
    return (LABEL[state] || state) + (state === "lost" && peer ? " — waiting for " + peer.name : n);
  }

  /* ---------- delta building: only leaves newer than `since` ---------- */
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  function maxTs(t) { return typeof t === "number" ? t : isObj(t) ? Object.values(t).reduce((m, v) => Math.max(m, maxTs(v)), 0) : 0; }
  function pruneTree(d, t, since) {
    if (!isObj(t)) return (typeof t === "number" && t > since) ? { d: d, t: t } : null;
    const od = {}, ot = {}; let any = false;
    Object.keys(t).forEach((k) => {
      const r = pruneTree(isObj(d) ? d[k] : undefined, t[k], since);
      if (r) { any = true; ot[k] = r.t; if (r.d !== undefined) od[k] = r.d; }
    });
    return any ? { d: od, t: ot } : null;
  }
  function buildSections(since) {
    const local = Sync._collectLocalSections(), out = {};
    SYNCED_KEYS.forEach((key) => {
      const s = local[key];
      if (!s) return;
      if (since <= 0) { out[key] = s; return; }
      if (ID_ARRAY_SECTIONS[key]) {
        const tree = {}, tomb = {};
        Object.keys(s.tsTree || {}).forEach((id) => { if (maxTs(s.tsTree[id]) > since) tree[id] = s.tsTree[id]; });
        Object.keys(s.tomb || {}).forEach((id) => { if (s.tomb[id] > since) tomb[id] = s.tomb[id]; });
        const recs = (s.data || []).filter((r) => tree[r.id] !== undefined);
        if (recs.length || Object.keys(tree).length || Object.keys(tomb).length) out[key] = { data: recs, tsTree: tree, tomb: tomb };
      } else {
        const r = pruneTree(s.data, s.tsTree, since);
        if (r) out[key] = { data: r.d, tsTree: r.t };
      }
    });
    return out;
  }

  /* ---------- messaging ---------- */
  function send(obj) {
    if (NATIVE) { const ids = Object.keys(npeers); ids.forEach((id) => { try { AndroidSync.send(id, JSON.stringify(obj)); } catch (e) {} }); return ids.length > 0; }
    if (dc && dc.readyState === "open") { try { dc.send(JSON.stringify(obj)); return true; } catch (e) {} } return false; }
  function sendFull() { return send({ t: "full", id: rnd(), sections: buildSections(0) }); }
  function lastAcked() { const p = peer && peers()[peer.id]; return (p && p.lastAcked) || 0; }
  function markAcked() {
    if (!peer) return;
    const all = peers(); if (!all[peer.id]) return;
    all[peer.id].lastAcked = Date.now(); DB.set("localSyncPeers", all);
  }
  function validSections(s) {
    if (!isObj(s)) return false;
    return Object.keys(s).every((k) => SYNCED_KEYS.indexOf(k) !== -1 && isObj(s[k]) && s[k].tsTree !== undefined);
  }
  function applyMessage(m) {
    if (!validSections(m.sections)) return;
    if (m.id) { if (seen.has(m.id)) return; seen.add(m.id); if (seen.size > 500) seen.delete(seen.values().next().value); }
    const res = Sync._applyRemoteSections(Sync._normalizeRemote({ sections: m.sections }));
    if (res.pulledAny) {
      if (typeof renderAll === "function") renderAll();
      Sync.notifyLocalChange(); // lets the (independent) Cloudflare path pick the merged result up too
    }
  }
  function backupSnapshot() {
    try { DB.set("localSyncBackup", { at: Date.now(), backup: buildBackup() }); return true; } catch (e) { return false; }
  }
  function acceptSync() {
    if (accepted) return;
    backupSnapshot();
    accepted = true; setState("initial");
    const delta = (!NATIVE && lastAcked() > 0) ? buildSections(lastAcked() - 60000) : null;
    if (delta) send({ t: "delta", id: rnd(), sections: delta }); else sendFull();
    pending.splice(0).forEach(applyMessage);
    markAcked();
    setState(settings().live ? "live" : "paused");
    toast("Live Sync Active with " + peer.name);
  }

  function onMessage(ev) {
    if (typeof ev.data !== "string" || ev.data.length > MAX_MSG) return;
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!isObj(m) || typeof m.t !== "string") return;
    if (m.t === "hello" || m.t === "auth" || m.t === "auth-ok") return handshake(m);
    if (m.t === "bye") { if (peer && peer.authed) lost(); return; }
    if (!peer || !peer.authed) return;                 // unauthenticated: drop everything else
    if (m.t === "full" || m.t === "delta") {
      if (!accepted) { pending.push(m); return; }      // never touch local data before the user agrees
      applyMessage(m); markAcked();
    }
  }

  async function handshake(m) {
    try {
      if (m.t === "hello" && role === "B") {            // B answers A's challenge
        const key = code;
        if (!key) return fail("Not paired");
        const nb = rnd();
        peer = { id: String(m.id), name: String(m.n || "Device").slice(0, 40), authed: false, key: key, na: m.na, nb: nb };
        send({ t: "auth", id: getDeviceId(), n: myName(), nb: nb, mac: await mac(key, "B" + m.na + nb + getDeviceId()) });
      } else if (m.t === "auth" && role === "A") {      // A verifies B
        const key = code;
        if ((await mac(key, "B" + nonceA + m.nb + m.id)) !== m.mac) { send({ t: "bye" }); return fail("Pairing failed — connection refused"); }
        peer = { id: String(m.id), name: String(m.n || "Device").slice(0, 40), authed: true };
        send({ t: "auth-ok", mac: await mac(key, "A" + nonceA + m.nb + getDeviceId()), id: getDeviceId() });
        remember(); connected();
      } else if (m.t === "auth-ok" && role === "B" && peer && peer.key) { // B verifies A
        if ((await mac(peer.key, "A" + peer.na + peer.nb + peer.id)) !== m.mac) return fail("Peer failed verification");
        peer.authed = true; remember(); connected();
      }
    } catch (e) { fail("Pairing error: " + e.message); }
  }
  function remember() {
    if (!settings().remember) return;
    const all = peers(); all[peer.id] = Object.assign(all[peer.id] || {}, { name: peer.name });
    DB.set("localSyncPeers", all);
  }
  function fail(msg) { toast(msg); close(false); }

  function connected() {
    accepted = false; promptShown = false;
    const known = peers()[peer.id] && peers()[peer.id].lastAcked;
    if (!settings().askBackup || known) { acceptSync(); return; }
    setState("confirm"); showPrompt();
  }
  function showPrompt() {
    if (promptShown || !peer) return; promptShown = true;
    const o = document.createElement("div");
    o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;";
    o.innerHTML = '<div class="card" style="max-width:380px;width:100%;"><h2>Local Device Connected</h2>' +
      "<p><b>" + esc(peer.name) + "</b> is connected to your SSSACAD local network.</p>" +
      "<p>Would you like to back up and synchronize your data with this device? A backup of this device is saved first, and the two sets of data are merged — nothing is replaced.</p>" +
      '<div class="row"><button class="btn" id="lsGo">Back Up &amp; Sync</button><button class="btn secondary" id="lsNo">Not Now</button></div></div>';
    document.body.appendChild(o);
    o.querySelector("#lsGo").onclick = () => { o.remove(); acceptSync(); };
    o.querySelector("#lsNo").onclick = () => { o.remove(); toast("Connected — you can start sync later from Admin"); };
  }

  /* ---------- connection plumbing ---------- */
  function newPc() {
    close(false);
    pc = new RTCPeerConnection({ iceServers: [] });       // LAN only: no STUN/TURN, no Internet
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.connectionState === "disconnected") lost();
    };
  }
  function bind(ch) {
    dc = ch;
    ch.onmessage = onMessage;
    ch.onclose = lost;
    ch.onopen = async () => {
      setState("connecting");
      if (role === "A") { nonceA = rnd(); send({ t: "hello", id: getDeviceId(), n: myName(), na: nonceA }); }
    };
  }
  function lost() {
    if (state === "off") return;
    if (peer && peer.authed) setState("lost"); else setState("off");
    dc = null; if (pc) { try { pc.close(); } catch (e) {} pc = null; }
  }
  function close(keepPeer) {
    clearTimeout(sendTimer);
    if (dc) { try { dc.onclose = null; dc.close(); } catch (e) {} }
    if (pc) { try { pc.close(); } catch (e) {} }
    dc = null; pc = null; accepted = false; pending = [];
    if (!keepPeer) peer = null;
    setState("off");
  }
  function gathered() {
    return new Promise((res) => {
      if (pc.iceGatheringState === "complete") return res();
      const t = setTimeout(res, 4000);
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } };
    });
  }
  function needRtc() { if (!window.RTCPeerConnection || !crypto.subtle) throw new Error("This browser can't do local sync (needs HTTPS + WebRTC)"); }
  async function createOffer() {              // Device A: returns the text for QR #1
    needRtc(); newPc(); role = "A"; peer = null;
    code = rnd();                              // one-time secret, travels inside the QR
    bind(pc.createDataChannel("sssacad"));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered();
    setState("waiting");
    return pack({ v: 2, d: getDeviceId(), n: myName(), k: code, s: pc.localDescription.sdp });
  }
  async function acceptOffer(text) {          // Device B: scanned QR #1, returns text for QR #2
    needRtc();
    let o; try { o = await unpack(text); } catch (e) { throw new Error("That isn't an SSSACAD pairing QR"); }
    if (!o || o.v !== 2 || typeof o.s !== "string" || typeof o.k !== "string") throw new Error("That isn't an SSSACAD pairing QR");
    newPc(); role = "B"; peer = null; code = o.k;
    pc.ondatachannel = (e) => bind(e.channel);
    await pc.setRemoteDescription({ type: "offer", sdp: o.s });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered();
    setState("connecting");
    return pack({ v: 2, s: pc.localDescription.sdp });
  }
  async function finishPairing(text) {        // Device A: scanned QR #2
    let a; try { a = await unpack(text); } catch (e) { throw new Error("That isn't an SSSACAD pairing QR"); }
    if (!pc || !a || typeof a.s !== "string") throw new Error("That isn't an SSSACAD pairing QR");
    setState("connecting");
    await pc.setRemoteDescription({ type: "answer", sdp: a.s });
  }

  /* ---------- live changes ---------- */
  let sentUpTo = Date.now();
  function notifyLocalChange() {
    if (!settings().enabled || !peer || !peer.authed || !accepted || !settings().live) return;
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      const since = sentUpTo - 2000; sentUpTo = Date.now();
      const sections = buildSections(since);
      if (!Object.keys(sections).length) return;
      if (send({ t: "delta", id: rnd(), sections: sections })) markAcked();
    }, 250);
  }
  function setLive(on) {
    saveSettings({ live: on });
    if (accepted && state !== "lost" && state !== "searching") { setState(on ? "live" : "paused"); if (on) sendFull(); }
  }
  function disconnect() { if (NATIVE) { saveSettings({ enabled: false }); nativeStop(); return; } if (peer) { send({ t: "bye" }); } peer = null; close(false); }

  /* ---------- Android app: native transport events (see MainActivity / LanSync.java) ---------- */
  function nPeerUp(id, name) {
    npeers[id] = { id: id, name: name };
    peer = { id: id, name: name, authed: true }; remember();
    if (accepted) {                                     // already agreed this session: just give the newcomer everything
      try { AndroidSync.send(id, JSON.stringify({ t: "full", id: rnd(), sections: buildSections(0) })); } catch (e) {}
      setState(settings().live ? "live" : "paused"); toast(name + " connected");
    } else if (!settings().askBackup || (peers()[id] && peers()[id].lastAcked)) acceptSync();
    else { setState("confirm"); showPrompt(); }
  }
  function nPeerDown(id) {
    delete npeers[id];
    if (!Object.keys(npeers).length) setState(settings().enabled ? "searching" : "off");
    else setState(accepted ? (settings().live ? "live" : "paused") : "confirm");
  }
  function nMessage(id, m) {
    if (!isObj(m) || (m.t !== "full" && m.t !== "delta")) return;
    if (!accepted) { pending.push(m); return; }          // never touch local data before the user agrees
    applyMessage(m); markAcked();
  }
  function nativeStart() {
    if (!NATIVE) return;
    const st = settings();
    if (!st.enabled) { setState("off"); return; }
    if (!st.pin) { setState("needpin"); return; }
    if (AndroidSync.start(getDeviceId(), myName(), st.pin)) { if (state === "off" || state === "needpin") setState(Object.keys(npeers).length ? "live" : "searching"); }
    else toast("Couldn't start local sync (port busy?)");
  }
  function nativeStop() {
    if (!NATIVE) return;
    try { AndroidSync.stop(); } catch (e) {}
    Object.keys(npeers).forEach((k) => delete npeers[k]); accepted = false; pending = []; peer = null; setState("off");
  }
  if (NATIVE) window.LocalSyncNative = {
    drain: function () {
      let r;
      while ((r = AndroidSync.poll())) {
        let o; try { o = JSON.parse(r); } catch (e) { continue; }
        if (o.k === "up") nPeerUp(String(o.id), String(o.name || "Device").slice(0, 40));
        else if (o.k === "down") nPeerDown(String(o.id));
        else if (o.k === "msg") { let m; try { m = JSON.parse(o.msg); } catch (e) { continue; } nMessage(String(o.id), m); }
      }
    }
  };

  return { isNative: NATIVE, nativeStart, nativeStop, nativePeers: () => Object.values(npeers), settings, saveSettings, peers, createOffer, acceptOffer, finishPairing, disconnect, acceptSync, setLive,
    onState, statusText, getState: () => state, getPeer: () => peer, isAccepted: () => accepted, showPrompt: () => { promptShown = false; showPrompt(); },
    notifyLocalChange, myName };
})();

// Chain onto the app's single change hook; the Cloudflare hook installed by sync.js still runs first.
(function () {
  const prev = window.onSyncableChange;
  window.onSyncableChange = function () { if (prev) prev.apply(this, arguments); LocalSync.notifyLocalChange(); };
})();

/* ---------- Admin card (rendered/wired from admin.js) ---------- */
function localSyncCardHtml() {
  const s = LocalSync.settings();
  if (LocalSync.isNative) {
    const chk2 = (id, label, on) => `<label style="display:flex;gap:8px;align-items:center;margin:6px 0;"><input type="checkbox" id="${id}" ${on ? "checked" : ""}> ${label}</label>`;
    return `<div class="card" id="localSyncCard">
      <h2>Local Hotspot Sync <span style="font-size:12px;font-weight:normal;">(no Internet needed)</span></h2>
      <p style="font-size:12.5px;color:var(--muted);">Put all your devices on the same hotspot or Wi-Fi and use the same Sync PIN on each. They find each other automatically and sync live. Works alongside Cloud Sync above.</p>
      <div id="lsStatus" class="sync-status-pill"></div>
      <div id="lsDevices" style="font-size:13px;margin:6px 0;"></div>
      <label>Sync PIN (the same on every device, at least 4 digits)</label>
      <input id="lsPin" class="no-caps" type="tel" inputmode="numeric" maxlength="12" value="${esc(s.pin)}" placeholder="e.g. 4821">
      <label>Device name</label><input id="lsName" class="no-caps" type="text" value="${esc(s.name)}" placeholder="${esc(LocalSync.myName())}">
      ${chk2("lsLive", "Live synchronization", s.live)}
      ${chk2("lsAsk", "Ask for backup when a new device connects", s.askBackup)}
      <div class="row" style="margin-top:8px;">
        <button class="btn" id="lsSave">Save &amp; Connect</button>
        <button class="btn secondary" id="lsStart" style="display:none;">Back Up &amp; Sync</button>
        <button class="btn secondary" id="lsDisc">Turn off</button>
      </div>
    </div>`;
  }
  const known = Object.values(LocalSync.peers()).map((p) => esc(p.name)).join(", ");
  const chk = (id, label, on) => `<label style="display:flex;gap:8px;align-items:center;margin:6px 0;"><input type="checkbox" id="${id}" ${on ? "checked" : ""}> ${label}</label>`;
  return `<div class="card" id="localSyncCard">
    <h2>Local Hotspot Sync <span style="font-size:12px;font-weight:normal;">(no Internet needed)</span></h2>
    <p style="font-size:12.5px;color:var(--muted);">Syncs live between your devices on the same hotspot/Wi-Fi, independently of Cloud Sync above. Pair by scanning two QR codes; after that, edits appear on the other device instantly.</p>
    <div id="lsStatus" class="sync-status-pill"></div>
    ${chk("lsEnabled", "Enable Local Hotspot Sync", s.enabled)}
    ${chk("lsLive", "Live synchronization", s.live)}
    ${chk("lsAsk", "Ask for backup when a device connects", s.askBackup)}
    ${chk("lsRemember", "Remember paired devices", s.remember)}
    <label>Device name</label><input id="lsName" class="no-caps" type="text" value="${esc(s.name)}" placeholder="${esc(LocalSync.myName())}">
    ${known ? `<p style="font-size:11.5px;color:var(--muted);">Paired before: ${known}</p>` : ""}
    <div class="row" style="margin-top:8px;">
      <button class="btn" id="lsShow">Show my QR</button>
      <button class="btn secondary" id="lsScan">Scan a QR</button>
      <button class="btn secondary" id="lsStart" style="display:none;">Back Up &amp; Sync</button>
      <button class="btn secondary" id="lsDisc">Disconnect</button>
    </div>
    <div id="lsStep" style="margin-top:10px;"></div>
  </div>`;
}
function lsDrawQr(box, text) {
  const q = makeQr(text), avail = Math.min(window.innerWidth - 48, 420);
  const px = Math.max(3, Math.floor(avail / (q.n + 8))), size = (q.n + 8) * px;   // whole pixels per module keeps it crisp
  const c = document.createElement("canvas"); c.width = c.height = size;
  c.style.cssText = "width:" + size + "px;max-width:100%;image-rendering:pixelated;background:#fff;border-radius:8px;display:block;margin:8px auto;";
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, size, size); g.fillStyle = "#000";
  for (let r = 0; r < q.n; r++) for (let k = 0; k < q.n; k++) if (q.dark(r, k)) g.fillRect((k + 4) * px, (r + 4) * px, px, px);
  box.appendChild(c);
}
function lsScanQr() {                          // resolves with the QR text, or null if cancelled
  return new Promise(async (resolve, reject) => {
    const native = "BarcodeDetector" in window;      // phones: built in; laptops: our own decoder (qrdec.js)
    if (!native && typeof decodeQr !== "function") return reject(new Error("This browser can't scan QR codes"));
    let stream = null;                               // no camera (or refused) is fine: the picture option still works
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } }); } catch (e) { stream = null; }
    }
    const o = document.createElement("div");
    o.style.cssText = "position:fixed;inset:0;background:#000;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:12px;";
    o.innerHTML = (stream ? '<video playsinline muted style="width:100%;max-height:60vh;object-fit:contain;"></video>' : "") +
      '<div style="color:#fff;text-align:center;">' + (stream ? "Hold the other screen steady in front of the camera, as large and bright as you can" : "No camera available on this device") + '</div>' +
      '<label class="btn" style="cursor:pointer;">Use a screenshot / photo instead<input id="lsPic" type="file" accept="image/*" style="display:none;"></label>' +
      '<button class="btn secondary" id="lsCancelScan">Cancel</button>';
    document.body.appendChild(o);
    let done = false;
    const finish = (val) => { if (done) return; done = true; if (stream) stream.getTracks().forEach((t) => t.stop()); o.remove(); resolve(val); };
    o.querySelector("#lsCancelScan").onclick = () => finish(null);
    o.querySelector("#lsPic").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const bmp = await createImageBitmap(f), sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
        const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0, c.width, c.height);
        let t = null;
        if (native) { try { const r = await new BarcodeDetector({ formats: ["qr_code"] }).detect(c); if (r.length) t = r[0].rawValue; } catch (x) {} }
        if (!t && typeof decodeQr === "function") t = decodeQr(g.getImageData(0, 0, c.width, c.height));
        if (t) finish(t); else toast("No QR found in that picture. Try a sharper, full-screen screenshot.");
      } catch (x) { toast("Couldn't read that picture"); }
    };
    if (!stream) return;
    const v = o.querySelector("video"); v.srcObject = stream; v.play();
    const det = native ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
    const cv = document.createElement("canvas"), g2 = cv.getContext("2d", { willReadFrequently: true });
    (async function tick() {
      if (done) return;
      try {
        if (det) { const r = await det.detect(v); if (r.length && r[0].rawValue) return finish(r[0].rawValue); }
        else if (v.videoWidth) {
          cv.width = v.videoWidth; cv.height = v.videoHeight; g2.drawImage(v, 0, 0);
          const t = decodeQr(g2.getImageData(0, 0, cv.width, cv.height)); if (t) return finish(t);
        }
      } catch (e) {}
      setTimeout(tick, det ? 200 : 150);
    })();
  });
}
function wireLocalSyncHandlers() {
  const $ = (id) => document.getElementById(id);
  if (!$("localSyncCard")) return;
  if (LocalSync.isNative) {
    const paintN = () => {
      const el = $("lsStatus"); if (!el) return;
      const st = LocalSync.getState();
      el.className = "sync-status-pill tone-" + (st === "live" ? "success" : st === "off" || st === "needpin" ? "neutral" : "progress");
      el.textContent = "● " + LocalSync.statusText();
      const names = LocalSync.nativePeers().map((p) => esc(p.name));
      $("lsDevices").innerHTML = names.length ? "Connected: <b>" + names.join("</b>, <b>") + "</b>" : "";
      $("lsStart").style.display = st === "confirm" ? "" : "none";
    };
    LocalSync.onState(paintN); paintN();
    $("lsLive").onchange = (e) => LocalSync.setLive(e.target.checked);
    $("lsAsk").onchange = (e) => LocalSync.saveSettings({ askBackup: e.target.checked });
    $("lsStart").onclick = () => LocalSync.showPrompt();
    $("lsDisc").onclick = () => { LocalSync.disconnect(); paintN(); toast("Local sync turned off"); };
    $("lsSave").onclick = () => {
      const pin = $("lsPin").value.replace(/\s+/g, "");
      if (pin.length < 4) { toast("PIN must be at least 4 characters"); return; }
      LocalSync.nativeStop();
      LocalSync.saveSettings({ pin: pin, name: $("lsName").value.trim().slice(0, 40), enabled: true });
      LocalSync.nativeStart(); paintN(); toast("Looking for your other devices…");
    };
    return;
  }
  const paint = () => {
    const el = $("lsStatus"); if (!el) return;
    const st = LocalSync.getState();
    el.className = "sync-status-pill tone-" + (st === "live" ? "success" : st === "lost" ? "warning" : st === "off" ? "neutral" : "progress");
    el.textContent = "● " + LocalSync.statusText();
    $("lsStart").style.display = (st === "confirm" || (st === "paused" && !LocalSync.isAccepted())) ? "" : "none";
    if (st === "live" || st === "confirm" || st === "initial") $("lsStep").innerHTML = "";
  };
  LocalSync.onState(paint); paint();
  const stepBox = $("lsStep");
  const wrap = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message || String(e)); } };
  const manual = (label, onText) => {           // fallback for browsers that can't scan
    const d = document.createElement("div");
    d.innerHTML = `<details style="margin-top:8px;"><summary style="font-size:12px;">Can't scan? Enter code manually</summary><textarea rows="3" class="no-caps" style="width:100%;font-size:11px;"></textarea><button class="btn secondary">${label}</button></details>`;
    d.querySelector("button").onclick = wrap(() => onText(d.querySelector("textarea").value));
    stepBox.appendChild(d);
  };

  $("lsEnabled").onchange = (e) => LocalSync.saveSettings({ enabled: e.target.checked });
  $("lsAsk").onchange = (e) => LocalSync.saveSettings({ askBackup: e.target.checked });
  $("lsRemember").onchange = (e) => LocalSync.saveSettings({ remember: e.target.checked });
  $("lsLive").onchange = (e) => LocalSync.setLive(e.target.checked);
  $("lsName").onchange = (e) => { LocalSync.saveSettings({ name: e.target.value.trim().slice(0, 40) }); toast("Device name saved"); };
  $("lsDisc").onclick = () => { LocalSync.disconnect(); stepBox.innerHTML = ""; };
  $("lsStart").onclick = () => LocalSync.showPrompt();

  // Phone A: show QR #1, then scan QR #2
  $("lsShow").onclick = wrap(async () => {
    stepBox.innerHTML = "<p>Preparing…</p>";
    const text = await LocalSync.createOffer();
    stepBox.innerHTML = '<p><b>1.</b> On the other device tap <b>Scan a QR</b> and scan this:</p><div id="lsQr1"></div><p><b>2.</b> It will then show a QR of its own:</p><button class="btn" id="lsScan2">Scan its QR</button>';
    lsDrawQr($("lsQr1"), text);
    const finish = async (t) => { await LocalSync.finishPairing(t); stepBox.innerHTML = "<p>Connecting…</p>"; };
    $("lsScan2").onclick = wrap(async () => { const t = await lsScanQr(); if (t) await finish(t); });
    manual("Connect", finish);
  });
  // Phone B: scan QR #1, then show QR #2
  const joinWith = async (t) => {
    stepBox.innerHTML = "<p>Preparing…</p>";
    const text = await LocalSync.acceptOffer(t);
    stepBox.innerHTML = '<p>Now let the first device scan this QR (tap <b>Scan its QR</b> there):</p><div id="lsQr2"></div>';
    lsDrawQr($("lsQr2"), text);
  };
  $("lsScan").onclick = async () => {
    try { const t = await lsScanQr(); if (t) await joinWith(t); }
    catch (e) { toast(e.message || String(e)); stepBox.innerHTML = ""; manual("Connect", joinWith); }
  };
}

// Android app: start looking for the user's other devices as soon as the page is ready.
if (window.AndroidSync) setTimeout(() => LocalSync.nativeStart(), 800);
