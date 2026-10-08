# Setting up sync (one-time, ~10 minutes)

No installs, no command line — everything below happens in the Cloudflare
dashboard in your browser.

1. Go to https://dash.cloudflare.com and sign up / log in (free plan is fine).
2. In the left sidebar: **Workers & Pages** → **Create** → **Create Worker**.
   Give it any name (e.g. `ststephens-sync`) → **Deploy** (it deploys a
   default "Hello World" first — that's fine, you'll replace it next).
3. Click **Edit code** (top right). Delete everything in the editor and
   paste in the entire contents of `backend/worker.js` from this folder.
   Click **Deploy** (top right) to save it live.
4. Back on the Worker's page, go to **Settings → Variables and Bindings**
   → **Add binding** → choose **KV Namespace**.
   - Variable name: `REPORTCARD_KV` (must match exactly — this is the name
     `worker.js` uses to talk to it)
   - KV namespace: click **Create a new namespace**, name it anything
     (e.g. `reportcard-data`), then select it.
   - Save / Deploy.
5. Copy the Worker's URL — it's shown at the top of the Worker's page,
   looks like `https://ststephens-sync.YOUR-SUBDOMAIN.workers.dev`.
6. In the app: **Admin tab → Sync Across Devices → Sync URL**, paste that
   URL in, tap **Save & Connect**.

Do steps 5–6 (just pasting the URL in) on every device you want kept in
sync — steps 1–4 are one-time, for the shared backend all devices connect
to.

No PIN or password is needed for the Worker itself — the URL functions
like one; keep it private the way you would a password. Anyone with the
URL can read and write this data.
