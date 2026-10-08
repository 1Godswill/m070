package com.sssacad.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.concurrent.ConcurrentLinkedQueue;

/** Hosts the SSSACAD web app in a WebView and gives it a native LAN sync transport (AndroidSync). */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/app/www/index.html";
    private static final int PICK = 41;

    private WebView web;
    private LanSync lan;
    private ValueCallback<Uri[]> chooser;
    private final ConcurrentLinkedQueue<String> events = new ConcurrentLinkedQueue<>();

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        setContentView(web);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/app/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new Bridge(), "AndroidSync");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (HOST.equals(r.getUrl().getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (Exception ignored) {}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = cb;
                try { startActivityForResult(p.createIntent(), PICK); }
                catch (Exception e) { chooser = null; return false; }
                return true;
            }
        });
        // Backups/exports are blob: downloads in the web app; a WebView ignores them unless we save them ourselves.
        web.setDownloadListener((url, ua, cd, mime, len) -> {
            if (!url.startsWith("blob:")) { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {} return; }
            String name = URLUtil.guessFileName(url, cd, mime);
            if (name == null || name.startsWith("downloadfile") || name.endsWith(".bin")) {
                name = "SSSACAD-" + System.currentTimeMillis() + (mime != null && mime.contains("json") ? ".json" : ".dat");
            }
            String js = "(async()=>{try{const r=await fetch(" + JSONObject.quote(url) + ");const b=await r.blob();"
                    + "const f=new FileReader();f.onload=()=>AndroidSync.saveFile(" + JSONObject.quote(name) + ","
                    + JSONObject.quote(mime == null ? "application/octet-stream" : mime) + ",String(f.result).split(',')[1]);"
                    + "f.readAsDataURL(b);}catch(e){}})()";
            web.evaluateJavascript(js, null);
        });
        web.loadUrl(START);
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req == PICK && chooser != null) {
            chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            chooser = null;
        } else super.onActivityResult(req, res, data);
    }

    @Override protected void onResume() {
        super.onResume();
        web.onResume();
        // reconnect after the phone was asleep / in the background (JS decides whether sync is enabled)
        web.evaluateJavascript("window.LocalSync&&LocalSync.nativeStart&&LocalSync.nativeStart()", null);
    }

    @Override protected void onPause() { web.onPause(); super.onPause(); }

    @Override protected void onDestroy() {
        if (lan != null) lan.stop();
        web.destroy();
        super.onDestroy();
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    private void kick() {
        runOnUiThread(() -> web.evaluateJavascript("window.LocalSyncNative&&LocalSyncNative.drain()", null));
    }

    private void event(String kind, String id, String name, String msg) {
        try {
            JSONObject o = new JSONObject().put("k", kind).put("id", id);
            if (name != null) o.put("name", name);
            if (msg != null) o.put("msg", msg);
            events.add(o.toString());
            kick();
        } catch (Exception ignored) {}
    }

    private class Bridge {
        @JavascriptInterface public synchronized boolean start(String id, String name, String pin) {
            if (lan != null && lan.isRunning()) return true;
            try {
                lan = new LanSync(id, name, pin, LanSync.PORT, true, new LanSync.Listener() {
                    public void onUp(String pid, String pname) { event("up", pid, pname, null); }
                    public void onDown(String pid) { event("down", pid, null, null); }
                    public void onMessage(String pid, String msg) { event("msg", pid, null, msg); }
                });
                lan.start();
                return true;
            } catch (Exception e) { lan = null; return false; }
        }
        @JavascriptInterface public synchronized void stop() { if (lan != null) { lan.stop(); lan = null; } events.clear(); }
        @JavascriptInterface public boolean send(String peerId, String msg) { LanSync l = lan; return l != null && l.send(peerId, msg); }
        @JavascriptInterface public String poll() { String e = events.poll(); return e == null ? "" : e; }
        @JavascriptInterface public boolean isRunning() { return lan != null && lan.isRunning(); }
        @JavascriptInterface public void saveFile(String name, String mime, String b64) {
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(data); }
                } else {
                    File f = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), name);
                    try (FileOutputStream o = new FileOutputStream(f)) { o.write(data); }
                }
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Saved to Downloads: " + name, Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Couldn't save file", Toast.LENGTH_LONG).show());
            }
        }
    }
}
