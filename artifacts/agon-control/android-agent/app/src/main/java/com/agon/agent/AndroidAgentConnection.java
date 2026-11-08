package com.agon.agent;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.Environment;
import android.os.SystemClock;
import android.os.StatFs;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Collections;
import java.util.Enumeration;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

final class AndroidAgentConnection {
    private static final String JSON_TYPE = "application/json; charset=utf-8";
    private static final String PAIRING_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final String AGENT_VERSION = "1.0.4";
    private static final int MAX_IP_ADDRESSES = 12;

    private final AgentService service;
    private final Context context;
    private final String ownerId;
    private final String deviceName;
    private final String group;
    private final android.content.SharedPreferences preferences;
    private final OkHttpClient http;
    private final ScheduledExecutorService heartbeatExecutor = Executors.newSingleThreadScheduledExecutor();

    private volatile boolean running;
    private volatile WebSocket activeSocket;
    private volatile CountDownLatch connectionEnded;
    private volatile ScheduledFuture<?> heartbeatTask;
    private volatile Thread workerThread;

    AndroidAgentConnection(AgentService service, String ownerId, String deviceName, String group) {
        this.service = service;
        this.context = service.getApplicationContext();
        this.ownerId = ownerId;
        this.deviceName = deviceName;
        this.group = group;
        this.preferences = context.getSharedPreferences(AgentService.PREFS, Context.MODE_PRIVATE);
        this.http = new OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(25, TimeUnit.SECONDS)
                .build();
    }

    void runLoop() {
        workerThread = Thread.currentThread();
        running = true;
        String previousOwner = preferences.getString("ownerId", "");
        if (!ownerId.equals(previousOwner)) {
            preferences.edit()
                    .putString("ownerId", ownerId)
                    .remove("deviceId")
                    .remove("deviceToken")
                    .remove(AgentService.PREF_PAIRING_CODE)
                    .remove("pairingRequested")
                    .apply();
        }
        preferences.edit()
                .putString("deviceName", deviceName)
                .putString("deviceGroup", group)
                .apply();

        long retrySeconds = 1;
        while (running && !Thread.currentThread().isInterrupted()) {
            try {
                ensureIdentity();
                if (!preferences.getBoolean("pairingRequested", false)) {
                    requestPairing();
                }
                if (!running) break;

                CountDownLatch done = new CountDownLatch(1);
                connectionEnded = done;
                Request request = buildWebSocketRequest();
                activeSocket = http.newWebSocket(request, new AgentSocketListener(done));
                done.await();
                activeSocket = null;
                connectionEnded = null;
                if (heartbeatTask != null) {
                    heartbeatTask.cancel(true);
                    heartbeatTask = null;
                }
                if (running) {
                    Thread.sleep(TimeUnit.SECONDS.toMillis(retrySeconds));
                    retrySeconds = Math.min(30, retrySeconds * 2);
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception error) {
                if (!running) break;
                service.updateStatus(safePairingError(error), null);
                try {
                    Thread.sleep(TimeUnit.SECONDS.toMillis(retrySeconds));
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    break;
                }
                retrySeconds = Math.min(30, retrySeconds * 2);
            }
        }
        running = false;
        if (heartbeatTask != null) heartbeatTask.cancel(true);
        heartbeatExecutor.shutdownNow();
        http.dispatcher().cancelAll();
        http.connectionPool().evictAll();
    }

    void stop() {
        running = false;
        WebSocket socket = activeSocket;
        if (socket != null) socket.cancel();
        CountDownLatch latch = connectionEnded;
        if (latch != null) latch.countDown();
        Thread thread = workerThread;
        if (thread != null) thread.interrupt();
        heartbeatExecutor.shutdownNow();
        http.dispatcher().cancelAll();
    }

    private void ensureIdentity() {
        String deviceId = preferences.getString("deviceId", "");
        String deviceToken = preferences.getString("deviceToken", "");
        String pairingCode = preferences.getString(AgentService.PREF_PAIRING_CODE, "");
        SecureRandom random = new SecureRandom();
        android.content.SharedPreferences.Editor editor = preferences.edit();
        if (deviceId.isEmpty()) {
            deviceId = UUID.randomUUID().toString();
            editor.putString("deviceId", deviceId);
        }
        if (deviceToken.isEmpty()) {
            byte[] tokenBytes = new byte[32];
            random.nextBytes(tokenBytes);
            deviceToken = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(tokenBytes);
            editor.putString("deviceToken", deviceToken);
        }
        if (pairingCode.isEmpty() && !preferences.getBoolean("pairingRequested", false)) {
            editor.putString(AgentService.PREF_PAIRING_CODE, randomPairingCode(random));
        }
        editor.apply();
    }

    private String randomPairingCode(SecureRandom random) {
        StringBuilder code = new StringBuilder(16);
        for (int i = 0; i < 16; i++) {
            code.append(PAIRING_ALPHABET.charAt(random.nextInt(PAIRING_ALPHABET.length())));
        }
        return code.toString();
    }

    private void requestPairing() throws Exception {
        JSONObject body = new JSONObject();
        body.put("ownerId", ownerId);
        body.put("deviceId", preferences.getString("deviceId", ""));
        body.put("deviceToken", preferences.getString("deviceToken", ""));
        body.put("pairingCode", preferences.getString(AgentService.PREF_PAIRING_CODE, ""));
        body.put("allowUnattended", false);
        body.put("device", deviceInfo());

        Request request = new Request.Builder()
                .url(AgentService.SERVER_URL + "/api/pair-requests")
                .header("Content-Type", JSON_TYPE)
                .header("X-Requested-With", "XMLHttpRequest")
                .header("Origin", "https://agon-server-control.replit.app")
                .header("Referer", "https://agon-server-control.replit.app/deployment")
                .post(RequestBody.create(body.toString(), MediaType.get(JSON_TYPE)))
                .build();

        try (Response response = http.newCall(request).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (response.code() != 200 && response.code() != 202) {
                String message = "Pairing request failed (" + response.code() + ").";
                try {
                    message = new JSONObject(responseBody).optString("error", message);
                } catch (JSONException ignored) {
                    // Keep the bounded, generic error rather than echoing server response content.
                }
                throw new IllegalStateException(message);
            }
            String status = new JSONObject(responseBody).optString("status", "");
            if (!"pending".equals(status) && !"approved".equals(status)) {
                throw new IllegalStateException("Pairing response was incomplete.");
            }
        }

        preferences.edit().putBoolean("pairingRequested", true).apply();
        String code = preferences.getString(AgentService.PREF_PAIRING_CODE, "");
        if (!code.isEmpty()) {
            service.updateStatus("Waiting for operator approval.", formatPairingCode(code));
        } else {
            service.updateStatus("Pairing is approved; connecting to relay…", null);
        }
    }

    private Request buildWebSocketRequest() {
        String deviceId = preferences.getString("deviceId", "");
        HttpUrl base = HttpUrl.get(AgentService.SERVER_URL);
        HttpUrl websocketUrl = base.newBuilder()
                .addPathSegment("agent")
                .addQueryParameter("deviceId", deviceId)
                .addQueryParameter("channel", "agent")
                .build();
        return new Request.Builder()
                .url(websocketUrl)
                .header("Authorization", "Bearer " + preferences.getString("deviceToken", ""))
                .header("X-Requested-With", "XMLHttpRequest")
                .header("Origin", "https://agon-server-control.replit.app")
                .header("Referer", "https://agon-server-control.replit.app/deployment")
                .build();
    }

    private final class AgentSocketListener extends WebSocketListener {
        private final CountDownLatch done;

        AgentSocketListener(CountDownLatch done) {
            this.done = done;
        }

        @Override
        public void onOpen(WebSocket webSocket, Response response) {
            if (!running) {
                webSocket.cancel();
                done.countDown();
                return;
            }
            activeSocket = webSocket;
            preferences.edit().remove(AgentService.PREF_PAIRING_CODE).apply();
            service.updateStatus("Connected to Agon relay.", null);
            try {
                JSONObject hello = envelope("hello");
                hello.put("device", deviceInfo());
                if (!webSocket.send(hello.toString())) {
                    webSocket.cancel();
                    return;
                }
            } catch (JSONException error) {
                webSocket.cancel();
                return;
            }
            heartbeatTask = heartbeatExecutor.scheduleAtFixedRate(() -> {
                if (!running || activeSocket != webSocket) return;
                try {
                    JSONObject heartbeat = envelope("heartbeat");
                    heartbeat.put("device", deviceInfo());
                    webSocket.send(heartbeat.toString());
                } catch (JSONException ignored) {
                    webSocket.cancel();
                }
            }, 20, 20, TimeUnit.SECONDS);
        }

        @Override
        public void onMessage(WebSocket webSocket, String text) {
            handleMessage(webSocket, text);
        }

        @Override
        public void onClosed(WebSocket webSocket, int code, String reason) {
            if (running) service.updateStatus("Relay connection dropped; reconnecting.", null);
            done.countDown();
        }

        @Override
        public void onFailure(WebSocket webSocket, Throwable error, Response response) {
            if (!running) {
                done.countDown();
                return;
            }
            if (response != null && response.code() == 401) {
                service.updateStatus("Waiting for operator approval.", null);
            } else {
                service.updateStatus("Relay unavailable; retrying automatically.", null);
            }
            done.countDown();
        }
    }

    private void handleMessage(WebSocket webSocket, String text) {
        try {
            JSONObject message = new JSONObject(text);
            if (!"command".equals(message.optString("type"))) return;
            String jobId = message.optString("jobId", "");
            String action = message.optString("action", "");
            JSONObject response = envelope("command_result");
            response.put("jobId", jobId);
            response.put("action", action);
            try {
                switch (action) {
                    case "agent.ping":
                        JSONObject ping = new JSONObject();
                        ping.put("reply", "pong");
                        ping.put("agent", AGENT_VERSION);
                        ping.put("time", Instant.now().toString());
                        response.put("result", ping);
                        break;
                    case "inventory.refresh":
                        response.put("result", deviceInfo());
                        break;
                    case "diagnostics.network":
                        response.put("result", networkDiagnostics());
                        break;
                    case "agent.upgrade":
                        JSONObject upgradePayload = message.optJSONObject("payload");
                        response.put("result", installUpgrade(upgradePayload == null ? new JSONObject() : upgradePayload));
                        break;
                    case "session.request":
                        throw new IllegalStateException("Android screen sharing and remote input are not enabled in this APK.");
                    default:
                        throw new IllegalArgumentException("Action is not enabled for the Android agent.");
                }
            } catch (Exception error) {
                response.put("error", error.getMessage() == null ? "Requested action failed." : error.getMessage());
            }
            webSocket.send(response.toString());
        } catch (JSONException ignored) {
            // Ignore malformed relay messages; never execute unrecognized payloads.
        }
    }

    private JSONObject deviceInfo() throws JSONException {
        JSONObject info = new JSONObject();
        String host = Build.DEVICE == null ? "android-device" : Build.DEVICE;
        info.put("deviceId", preferences.getString("deviceId", ""));
        info.put("hostname", host);
        info.put("name", preferences.getString("deviceName", deviceName));
        info.put("group", preferences.getString("deviceGroup", group));
        info.put("os", "android");
        info.put("osVersion", "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
        info.put("arch", androidArchitecture());
        info.put("agent", AGENT_VERSION);
        info.put("cpus", Runtime.getRuntime().availableProcessors());
        info.put("cpuModel", Build.HARDWARE == null ? "" : Build.HARDWARE);
        JSONArray addresses = ipAddresses();
        info.put("interfaces", interfaceCount());
        info.put("ipAddresses", addresses);
        ActivityManager.MemoryInfo memoryInfo = new ActivityManager.MemoryInfo();
        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (manager != null) manager.getMemoryInfo(memoryInfo);
        long totalMemory = Math.max(0, memoryInfo.totalMem);
        long usedMemory = Math.max(0, totalMemory - memoryInfo.availMem);
        info.put("memoryTotalBytes", totalMemory);
        info.put("memoryUsedBytes", usedMemory);
        StatFs disk = new StatFs(Environment.getDataDirectory().getAbsolutePath());
        long totalDisk = disk.getTotalBytes();
        long usedDisk = Math.max(0, totalDisk - disk.getAvailableBytes());
        info.put("diskTotalBytes", totalDisk);
        info.put("diskUsedBytes", usedDisk);
        info.put("signingCertSha256", signingCertificateSha256());
        long bootTime = System.currentTimeMillis() - SystemClock.elapsedRealtime();
        info.put("bootId", Long.toString(bootTime));
        return info;
    }

    private String signingCertificateSha256() {
        try {
            PackageManager manager = context.getPackageManager();
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo info = manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                signatures = info.signingInfo == null ? new Signature[0] : info.signingInfo.getApkContentsSigners();
            } else {
                PackageInfo info = manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNATURES);
                signatures = info.signatures == null ? new Signature[0] : info.signatures;
            }
            if (signatures.length == 0) return "";
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray());
            StringBuilder hex = new StringBuilder();
            for (byte value : digest) hex.append(String.format(Locale.US, "%02x", value));
            return hex.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    private JSONObject installUpgrade(JSONObject payload) throws Exception {
        String packageUrl = payload.optString("packageUrl", "");
        JSONObject result = new JSONObject();
        result.put("accepted", true);
        result.put("platform", "android");
        result.put("silent", true);
        result.put("version", payload.optString("version", ""));
        if (packageUrl.isEmpty()) {
            result.put("note", "No installer URL was included.");
            return result;
        }
        Request request = new Request.Builder().url(packageUrl).get().build();
        try (Response download = http.newCall(request).execute()) {
            if (!download.isSuccessful() || download.body() == null) {
                throw new IllegalStateException("Installer download failed (" + download.code() + ").");
            }
            File apk = new File(context.getCacheDir(), "agon-upgrade.apk");
            try (FileOutputStream output = new FileOutputStream(apk)) {
                output.write(download.body().bytes());
            }
            Process process = new ProcessBuilder("pm", "install", "-r", "-d", apk.getAbsolutePath())
                    .redirectErrorStream(true)
                    .start();
            int code = process.waitFor();
            result.put("installerExit", code);
            result.put("note", code == 0 ? "Package install requested with no user window." : "pm install returned a non-zero status. Device-owner or system privilege is required for a silent upgrade.");
        }
        return result;
    }

    private JSONArray ipAddresses() {
        JSONArray result = new JSONArray();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements() && result.length() < MAX_IP_ADDRESSES) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                Enumeration<InetAddress> addresses = network.getInetAddresses();
                while (addresses.hasMoreElements() && result.length() < MAX_IP_ADDRESSES) {
                    InetAddress address = addresses.nextElement();
                    if (address.isLoopbackAddress() || address.isLinkLocalAddress()) continue;
                    if (!(address instanceof Inet4Address) && !(address instanceof Inet6Address)) continue;
                    String value = address.getHostAddress();
                    int zone = value.indexOf('%');
                    if (zone >= 0) value = value.substring(0, zone);
                    result.put(value);
                }
            }
        } catch (Exception ignored) {
            // DeviceInfo reports an empty address list when Android blocks interface enumeration.
        }
        return result;
    }

    private int interfaceCount() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            return interfaces == null ? 0 : Collections.list(interfaces).size();
        } catch (Exception ignored) {
            return 0;
        }
    }

    private JSONArray networkDiagnostics() throws JSONException {
        JSONArray result = new JSONArray();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                JSONObject item = new JSONObject();
                item.put("name", network.getName());
                item.put("mtu", network.getMTU());
                item.put("up", network.isUp());
                JSONArray addresses = new JSONArray();
                Enumeration<InetAddress> values = network.getInetAddresses();
                while (values.hasMoreElements()) {
                    InetAddress address = values.nextElement();
                    if (address.isLoopbackAddress()) continue;
                    String host = address.getHostAddress();
                    int zone = host.indexOf('%');
                    if (zone >= 0) host = host.substring(0, zone);
                    addresses.put(host);
                }
                item.put("addresses", addresses);
                result.put(item);
            }
        } catch (Exception error) {
            throw new JSONException("Android network inventory is unavailable.");
        }
        return result;
    }

    private JSONObject envelope(String type) throws JSONException {
        JSONObject value = new JSONObject();
        value.put("type", type);
        value.put("sentAt", Instant.now().toString());
        return value;
    }

    private String androidArchitecture() {
        String[] supported = Build.SUPPORTED_ABIS;
        if (supported == null || supported.length == 0) return "unknown";
        String abi = supported[0].toLowerCase(Locale.ROOT);
        if (abi.contains("arm64")) return "arm64";
        if (abi.contains("armeabi") || abi.equals("arm")) return "arm";
        if (abi.contains("x86_64")) return "amd64";
        if (abi.contains("x86")) return "386";
        return abi;
    }

    private String formatPairingCode(String code) {
        if (code == null || code.length() != 16) return code == null ? "" : code;
        return code.substring(0, 4) + "-" + code.substring(4, 8) + "-"
                + code.substring(8, 12) + "-" + code.substring(12);
    }

    private String safePairingError(Exception error) {
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) return "Connection failed; retrying automatically.";
        return message.length() > 140 ? message.substring(0, 140) : message;
    }
}
