// Approve / Deny from the notification (ADR-0017): answers the permission card at the computer the push
// came from (POST /bots/api/agents/<bot>/chat/permission with the session the bridge handed over) and
// removes the notification. Runs without opening the app.
package com.metor.mobile;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MetorActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final String computer = intent.getStringExtra("computer"), bot = intent.getStringExtra("bot"), ref = intent.getStringExtra("ref"), decision = intent.getStringExtra("decision");
        final int notificationId = intent.getIntExtra("notification", 0);
        if (computer == null || bot == null || ref == null || decision == null) return;
        final PendingResult result = goAsync();
        new Thread(() -> {
            int code = 0;
            try {
                WebPushCrypto.Computer c = WebPushCrypto.getComputer(context, computer);
                if (c != null) {
                    HttpURLConnection h = (HttpURLConnection) new URL(c.origin + "/bots/api/agents/" + bot + "/chat/permission").openConnection();
                    h.setRequestMethod("POST"); h.setConnectTimeout(10000); h.setReadTimeout(20000); h.setDoOutput(true);
                    h.setRequestProperty("Authorization", "Bearer " + c.token); h.setRequestProperty("Content-Type", "application/json");
                    try (OutputStream out = h.getOutputStream()) { out.write(new JSONObject().put("ref", ref).put("decision", decision).toString().getBytes("UTF-8")); }
                    code = h.getResponseCode(); h.disconnect();
                }
            } catch (Exception e) { Log.w("metor", "push action: " + e.getMessage()); }
            Log.i("metor", "push action " + decision + " for " + bot + " -> " + code);
            if (code >= 200 && code < 300) context.getSystemService(NotificationManager.class).cancel(notificationId);
            result.finish();
        }).start();
    }
}
