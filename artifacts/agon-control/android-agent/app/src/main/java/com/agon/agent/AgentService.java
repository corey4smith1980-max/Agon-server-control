package com.agon.agent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.text.TextUtils;

public final class AgentService extends Service {
    static final String PREFS = "agon_agent_state";
    static final String PREF_STATUS = "status";
    static final String PREF_PAIRING_CODE = "pairingCode";
    static final String EXTRA_OWNER_ID = "ownerId";
    static final String EXTRA_DEVICE_NAME = "deviceName";
    static final String EXTRA_GROUP = "group";
    static final String ACTION_STOP = "com.agon.agent.STOP";

    private static final String CHANNEL_ID = "agon-agent-visible";
    private static final int NOTIFICATION_ID = 7104;
    static final String SERVER_URL = "https://agon-server-control.replit.app/deployment/api/agon";

    private volatile boolean stopping;
    private volatile boolean active;
    private volatile AndroidAgentConnection connection;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopAgent();
            return START_NOT_STICKY;
        }
        if (active) {
            updateStatus("Agon Agent is running.", null);
            return START_NOT_STICKY;
        }

        String ownerId = intent == null ? "" : intent.getStringExtra(EXTRA_OWNER_ID);
        if (TextUtils.isEmpty(ownerId)) {
            updateStatus("Enter an organization ID in the app first.", null);
            stopSelf();
            return START_NOT_STICKY;
        }

        stopping = false;
        active = true;
        updateStatus("Starting visible agent service…", null);
        startVisibleForeground();
        String deviceName = intent.getStringExtra(EXTRA_DEVICE_NAME);
        String group = intent.getStringExtra(EXTRA_GROUP);
        Thread worker = new Thread(() -> runAgent(ownerId, deviceName, group), "agon-agent-process");
        worker.setDaemon(true);
        worker.start();
        return START_NOT_STICKY;
    }

    private void runAgent(String ownerId, String deviceName, String group) {
        try {
            connection = new AndroidAgentConnection(
                    this,
                    ownerId.trim(),
                    TextUtils.isEmpty(deviceName) ? Build.MANUFACTURER + " " + Build.MODEL : deviceName.trim(),
                    TextUtils.isEmpty(group) ? "Unassigned" : group.trim());
            connection.runLoop();
        } catch (Exception error) {
            if (!stopping) {
                updateStatus("Agent stopped unexpectedly. Tap Start agent to retry.", null);
            }
        } finally {
            active = false;
            connection = null;
            if (!stopping) {
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
            }
        }
    }

    private void startVisibleForeground() {
        Intent openApp = new Intent(this, MainActivity.class);
        PendingIntent openPending = PendingIntent.getActivity(
                this, 0, openApp,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stopIntent = new Intent(this, AgentService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(
                this, 1, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_agent_status)
                .setContentTitle("Agon Agent is active")
                .setContentText("Visible support connection · tap to manage")
                .setContentIntent(openPending)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .addAction(R.drawable.ic_agent_status, "Stop", stopPending);
        Notification notification = builder.build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.notification_channel_description));
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    void updateStatus(String status, String pairingCode) {
        android.content.SharedPreferences.Editor editor = getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putString(PREF_STATUS, status);
        if (pairingCode != null) {
            editor.putString(PREF_PAIRING_CODE, pairingCode);
        } else if (status.startsWith("Connected")) {
            editor.remove(PREF_PAIRING_CODE);
        }
        editor.apply();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null && active) {
            Notification notification = new Notification.Builder(this, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_agent_status)
                    .setContentTitle("Agon Agent is active")
                    .setContentText(status)
                    .setOngoing(true)
                    .setCategory(Notification.CATEGORY_SERVICE)
                    .build();
            manager.notify(NOTIFICATION_ID, notification);
        }
    }

    private void stopAgent() {
        stopping = true;
        AndroidAgentConnection current = connection;
        if (current != null) current.stop();
        active = false;
        updateStatus("Stopped.", "");
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopping = true;
        AndroidAgentConnection current = connection;
        if (current != null) current.stop();
        active = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
