package com.endfield.gacha;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.json.JSONObject;

/**
 * WebView 壳：加载打包在 assets/www 的离线前端。
 * - 静态资源经 https://appassets.local/（自拦截）提供 http 源，ES Module/localStorage 正常。
 * - 前端 /api/* 由内置 JS 适配层响应；其中官方账号链路经【原生网络桥】直连鹰角接口
 *   （浏览器无法自定义 Origin/Referer/UA，原生层可以），凭据仅内存直转、不写入任何文件。
 * - 适配 Android 15 (API 35) 强制 edge-to-edge：按 WindowInsets 给根视图让出系统栏。
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.local";
    private WebView web;
    private final ExecutorService httpPool = Executors.newFixedThreadPool(4);

    static {
        // HttpURLConnection 默认禁止设置 Origin/Referer 等受限头；官方接口需要
        System.setProperty("sun.net.http.allowRestrictedHeaders", "true");
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#05070d"));
        getWindow().setNavigationBarColor(Color.parseColor("#05070d"));

        web = new WebView(this);
        android.webkit.WebView.setWebContentsDebuggingEnabled(true); // CDP 远程调试（验收用）
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setBackgroundColor(Color.parseColor("#05070d"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl().toString());
            }
        });
        // JS console → logcat（tag JSConsole），线上排障与验收依赖
        web.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                android.util.Log.i("JSConsole", "[" + m.messageLevel() + "] " + m.message()
                        + " @" + (m.sourceId() == null ? "?" : m.sourceId().substring(Math.max(0, m.sourceId().length() - 40))) + ":" + m.lineNumber());
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        // 系统栏避让：WebView 会吞 insets，外包一层容器由容器消费并 padding（API 30+ 用 Type.systemBars）
        android.widget.FrameLayout holder = new android.widget.FrameLayout(this);
        holder.addView(web, new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT));
        holder.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets i = insets.getInsets(
                    android.view.WindowInsets.Type.systemBars());
            v.setPadding(0, i.top, 0, i.bottom);
            return android.view.WindowInsets.CONSUMED;
        });

        web.loadUrl("https://" + HOST + "/index.html");
        setContentView(holder);
    }

    /** 把 https://appassets.local/<path> 映射到 assets/www/<path> */
    private WebResourceResponse serve(String url) {
        try {
            String path = android.net.Uri.parse(url).getPath();
            if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
            String clean = path.replace("..", "");
            InputStream in = getAssets().open("www" + clean);
            return new WebResourceResponse(mimeOf(clean), encodingOf(clean), in);
        } catch (Exception e) {
            return notFound();
        }
    }

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webp", "image/webp");
        MIME.put("avif", "image/avif");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("svg", "image/svg+xml");
        MIME.put("woff2", "font/woff2");
    }

    private static String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot >= 0 ? path.substring(dot + 1).toLowerCase() : "";
        String m = MIME.get(ext);
        return m != null ? m : "application/octet-stream";
    }

    private static String encodingOf(String path) {
        String m = mimeOf(path);
        return (m.startsWith("text/") || m.equals("application/json")) ? "utf-8" : null;
    }

    private WebResourceResponse notFound() {
        try {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null,
                    new java.io.ByteArrayInputStream("not found".getBytes("utf-8")));
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /* ================= 原生网络桥 =================
     * JS: AndroidBridge.http(reqId, method, url, headersJson, body, timeoutMs)
     * 回调: window.__bridgeDispatch(reqId, {status, body} 或 {error})
     * 白名单：仅鹰角域名（hypergryph.com 及其子域），凭据只经内存直转官方。 */
    private class Bridge {
        @JavascriptInterface
        public void http(String reqId, String method, String url, String headersJson, String body, int timeoutMs) {            httpPool.execute(() -> {
                JSONObject out = new JSONObject();
                try {
                    URL u = new URL(url);
                    String host = u.getHost();
                    if (!"https".equals(u.getProtocol()) || host == null || !host.endsWith("hypergryph.com")) {
                        throw new SecurityException("bridge host not allowed: " + host);
                    }
                    HttpURLConnection c = (HttpURLConnection) u.openConnection();
                    c.setRequestMethod(method);
                    c.setConnectTimeout(timeoutMs > 0 ? timeoutMs : 20000);
                    c.setReadTimeout(timeoutMs > 0 ? timeoutMs : 20000);
                    JSONObject hs = new JSONObject(headersJson == null ? "{}" : headersJson);
                    java.util.Iterator<String> it = hs.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        c.setRequestProperty(k, hs.getString(k));
                    }
                    if (body != null && body.length() > 0 && !"GET".equalsIgnoreCase(method)) {
                        c.setDoOutput(true);
                        c.getOutputStream().write(body.getBytes("UTF-8"));
                    }
                    int code = c.getResponseCode();
                    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    if (in != null) while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                    out.put("status", code);
                    out.put("body", bo.toString("UTF-8"));
                } catch (Exception e) {
                    try { out.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) {}
                }
                final String payload = out.toString();
                final String id = reqId;
                runOnUiThread(() -> web.evaluateJavascript(
                        "window.__bridgeDispatch && window.__bridgeDispatch('" + id + "'," + payload + ")", null));
            });
        }

        /** CSV 导出落盘：API≥29 写入公共 Downloads（MediaStore，无需权限），低版本写应用目录 */
        @JavascriptInterface
        public void saveFile(String name, String mime, String base64) {
            httpPool.execute(() -> {
                String msg;
                try {
                    byte[] data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                    if (android.os.Build.VERSION.SDK_INT >= 29) {
                        android.content.ContentValues cv = new android.content.ContentValues();
                        cv.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name);
                        cv.put(android.provider.MediaStore.Downloads.MIME_TYPE, mime);
                        android.net.Uri uri = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                        try (java.io.OutputStream os = getContentResolver().openOutputStream(uri)) {
                            os.write(data);
                        }
                        msg = "已保存到 Downloads/" + name;
                    } else {
                        java.io.File dir = getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
                        java.io.File f = new java.io.File(dir, name);
                        try (java.io.FileOutputStream fo = new java.io.FileOutputStream(f)) {
                            fo.write(data);
                        }
                        msg = "已保存到 " + f.getAbsolutePath();
                    }
                } catch (Exception e) {
                    msg = "保存失败：" + e.getMessage();
                }
                final String m = msg;
                runOnUiThread(() -> web.evaluateJavascript(
                        "window.__bridgeToast && window.__bridgeToast('" + m.replace("'", "\\'") + "')", null));
            });
        }
    }
}
