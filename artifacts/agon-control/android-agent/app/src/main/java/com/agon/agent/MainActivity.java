package com.agon.agent;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final int REQUEST_NOTIFICATIONS = 42;
    private static final int COLOR_INK = Color.rgb(24, 34, 27);
    private static final int COLOR_MUTED = Color.rgb(94, 108, 97);
    private static final int COLOR_LIME = Color.rgb(195, 243, 107);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private EditText organizationId;
    private EditText deviceName;
    private EditText deviceGroup;
    private TextView statusView;
    private TextView pairingCodeView;

    private final Runnable refreshState = new Runnable() {
        @Override
        public void run() {
            updateState();
            handler.postDelayed(this, 1200);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(24), dp(28), dp(24), dp(32));
        page.setBackgroundColor(Color.rgb(244, 247, 241));
        scroll.addView(page);

        TextView brand = text("AGON  /  ENDPOINT SUPPORT", 11, COLOR_MUTED, Typeface.MONOSPACE);
        brand.setLetterSpacing(0.08f);
        page.addView(brand, margin(0, 0, 0, 26));

        TextView title = text("Agon Agent", 30, COLOR_INK, Typeface.DEFAULT_BOLD);
        page.addView(title, margin(0, 0, 0, 8));
        page.addView(text(
                "Connect this device to your organization’s Agon console. The relay address is built in; the agent creates its own device identity.",
                15, COLOR_MUTED, Typeface.DEFAULT), margin(0, 0, 0, 24));

        organizationId = input("Organization ID from Agon Control", InputType.TYPE_CLASS_TEXT);
        organizationId.setSingleLine(true);
        page.addView(organizationId, margin(0, 0, 0, 12));

        deviceName = input("Device name", InputType.TYPE_CLASS_TEXT);
        deviceName.setSingleLine(true);
        android.content.SharedPreferences saved = getSharedPreferences(AgentService.PREFS, MODE_PRIVATE);
        organizationId.setText(saved.getString("ownerId", ""));
        deviceName.setText(saved.getString("deviceName", Build.MANUFACTURER + " " + Build.MODEL));
        page.addView(deviceName, margin(0, 0, 0, 12));

        deviceGroup = input("Device group (optional)", InputType.TYPE_CLASS_TEXT);
        deviceGroup.setSingleLine(true);
        deviceGroup.setText(saved.getString("deviceGroup", "Unassigned"));
        page.addView(deviceGroup, margin(0, 0, 0, 18));

        TextView scope = text(
                "Android 8.0+ · Universal APK\nThis build reports device inventory and diagnostics. Android screen sharing and remote input are not enabled. The agent runs only while its visible foreground notification is active; start it here and stop it here.",
                13, COLOR_MUTED, Typeface.DEFAULT);
        scope.setPadding(dp(14), dp(14), dp(14), dp(14));
        scope.setBackgroundColor(Color.rgb(232, 239, 226));
        page.addView(scope, margin(0, 0, 0, 20));

        Button start = button("Start agent", COLOR_INK, Color.WHITE);
        start.setOnClickListener(view -> requestStart());
        page.addView(start, margin(0, 0, 0, 10));

        Button stop = button("Stop agent", Color.rgb(226, 233, 222), COLOR_INK);
        stop.setOnClickListener(view -> stopAgent());
        page.addView(stop, margin(0, 0, 0, 24));

        TextView section = text("CONNECTION STATUS", 11, COLOR_MUTED, Typeface.MONOSPACE);
        section.setLetterSpacing(0.06f);
        page.addView(section, margin(0, 0, 0, 8));
        statusView = text("Stopped", 16, COLOR_INK, Typeface.DEFAULT_BOLD);
        page.addView(statusView, margin(0, 0, 0, 14));

        pairingCodeView = text("Pairing code appears here after the first start.", 15, COLOR_INK, Typeface.MONOSPACE);
        pairingCodeView.setGravity(Gravity.CENTER);
        pairingCodeView.setPadding(dp(14), dp(20), dp(14), dp(20));
        pairingCodeView.setBackgroundColor(Color.WHITE);
        pairingCodeView.setOnClickListener(view -> copyPairingCode());
        page.addView(pairingCodeView, margin(0, 0, 0, 10));
        page.addView(text(
                "Approve the code in Agon Control → Deployment → Pending pairing approvals. The code is visible only on this device and is cleared after relay connection.",
                12, COLOR_MUTED, Typeface.DEFAULT), margin(0, 0, 0, 20));
        page.addView(text("Agon Agent 1.0.4 · HTTPS/WSS only · No boot auto-start", 11, COLOR_MUTED, Typeface.MONOSPACE));

        setContentView(scroll);
        applySetupLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applySetupLink(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(refreshState);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(refreshState);
        super.onPause();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_NOTIFICATIONS) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startAgent();
        } else {
            Toast.makeText(this, "Notification permission is required so the active agent remains visible.", Toast.LENGTH_LONG).show();
        }
    }

    private void requestStart() {
        String ownerId = organizationId.getText().toString().trim();
        if (ownerId.isEmpty()) {
            organizationId.setError("Enter the organization ID shown in Agon Control.");
            organizationId.requestFocus();
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
            return;
        }
        startAgent();
    }

    private void startAgent() {
        String ownerId = organizationId.getText().toString().trim();
        if (ownerId.isEmpty()) return;
        Intent service = new Intent(this, AgentService.class);
        service.putExtra(AgentService.EXTRA_OWNER_ID, ownerId);
        service.putExtra(AgentService.EXTRA_DEVICE_NAME, deviceName.getText().toString().trim());
        service.putExtra(AgentService.EXTRA_GROUP, deviceGroup.getText().toString().trim());
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(service);
        else startService(service);
        Toast.makeText(this, "Starting the visible Agon Agent service.", Toast.LENGTH_SHORT).show();
    }

    private void stopAgent() {
        Intent service = new Intent(this, AgentService.class).setAction(AgentService.ACTION_STOP);
        startService(service);
    }

    private void updateState() {
        android.content.SharedPreferences state = getSharedPreferences(AgentService.PREFS, MODE_PRIVATE);
        String status = state.getString(AgentService.PREF_STATUS, "Stopped");
        String code = state.getString(AgentService.PREF_PAIRING_CODE, "");
        if (statusView != null) statusView.setText(status);
        if (pairingCodeView != null) {
            pairingCodeView.setText(code.isEmpty() ? "Pairing code appears here after the first start." : code + "\nTap to copy");
            pairingCodeView.setTextColor(code.isEmpty() ? COLOR_MUTED : COLOR_INK);
        }
    }

    private void copyPairingCode() {
        String code = getSharedPreferences(AgentService.PREFS, MODE_PRIVATE)
                .getString(AgentService.PREF_PAIRING_CODE, "");
        if (code.isEmpty()) return;
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("Agon pairing code", code));
        Toast.makeText(this, "Pairing code copied.", Toast.LENGTH_SHORT).show();
    }

    private void applySetupLink(Intent intent) {
        if (intent == null || intent.getData() == null || organizationId == null) return;
        if (!"agon".equals(intent.getData().getScheme()) || !"setup".equals(intent.getData().getHost())) return;
        String ownerId = intent.getData().getQueryParameter("ownerId");
        String group = intent.getData().getQueryParameter("group");
        if (ownerId != null) organizationId.setText(ownerId);
        if (group != null) deviceGroup.setText(group);
    }

    private EditText input(String hint, int inputType) {
        EditText field = new EditText(this);
        field.setSingleLine(true);
        field.setHint(hint);
        field.setTextSize(15);
        field.setTextColor(COLOR_INK);
        field.setHintTextColor(COLOR_MUTED);
        field.setInputType(inputType);
        field.setPadding(dp(14), dp(12), dp(14), dp(12));
        field.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(195, 206, 190)));
        return field;
    }

    private Button button(String label, int background, int foreground) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(15);
        button.setTextColor(foreground);
        button.setBackgroundTintList(android.content.res.ColorStateList.valueOf(background));
        return button;
    }

    private TextView text(String value, int size, int color, Typeface typeface) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(color);
        text.setTypeface(typeface);
        return text;
    }

    private LinearLayout.LayoutParams margin(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
