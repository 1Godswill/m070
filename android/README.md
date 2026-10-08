# SSSACAD Android app (v3.11.0)

The same SSSACAD web app inside an Android WebView, plus a native LAN sync transport. Phones on the
same hotspot/Wi-Fi find each other automatically (no QR, no pairing) and sync live. Cloud Sync is unchanged.

## Build the APK (pick one)

**A. Without installing anything (GitHub):** put this whole folder in a GitHub repository, open
*Actions > Build SSSACAD APK > Run workflow*, then download the `SSSACAD-apk` artifact (app-debug.apk).

**B. Android Studio:** *File > Open* the `android` folder, let Gradle sync, then
*Build > Build APK(s)*. The file is in `app/build/outputs/apk/debug/`.

If you change any web file (../*.js, ../index.html), run `sh android/sync-web.sh` first (the workflow does this itself).

## Use it
1. Install the APK on each phone/tablet (allow "install unknown apps" for your file manager or browser).
2. Join all devices to the same hotspot or Wi-Fi (Internet not needed).
3. In each app: Admin > Local Hotspot Sync > enter the **same Sync PIN** (4+ characters) > Save & Connect.
4. The first time, tap **Back Up & Sync** on the prompt. After that devices reconnect and sync on their own whenever the app is open.

## Notes
- The app has its own storage. Data in the browser/PWA version does not move over by itself: make a backup in the
  web version and restore it in the app, or let Cloud Sync bring it across.
- Sync runs while the app is open (Android pauses background apps). It reconnects when you reopen it.
- Sync traffic is on your local network only. Devices must know the PIN; wrong-PIN devices are refused.
