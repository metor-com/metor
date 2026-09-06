// FCM delivery (ADR-0017): the relay sends a data message with the ciphertext the gateway produced for
// this device; this decrypts it with the key pair from WebPushCrypto and shows the notification. A tap
// opens the app with the bot as an extra (MetorPushPlugin turns it into the "opened" event).
package com.metor.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

public class MetorMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL = "metor";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        String body = message.getData().get("body");
        if (body == null) return;
        String title = "metor", text = "New activity", bot = null, kind = null;
        try {
            WebPushCrypto.Keys keys = WebPushCrypto.load(this);
            if (keys != null) {
                JSONObject json = new JSONObject(new String(WebPushCrypto.decrypt(Base64.decode(body, Base64.DEFAULT), keys), "UTF-8"));
                title = json.optString("title", title); text = json.optString("body", "");
                bot = json.optString("bot", null); kind = json.optString("kind", null);
            }
        } catch (Exception e) { Log.w("metor", "push: " + e.getMessage()); }   // the placeholder shows; nothing readable was in transit
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "metor", NotificationManager.IMPORTANCE_HIGH));
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (bot != null && !bot.isEmpty()) open.putExtra(MetorPushPlugin.EXTRA_BOT, bot);
        int id = bot != null ? bot.hashCode() : (int) System.currentTimeMillis();
        PendingIntent tap = PendingIntent.getActivity(this, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority("approval".equals(kind) ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true).setContentIntent(tap).build();
        nm.notify(id, n);
    }

    @Override
    public void onNewToken(String token) { /* the app registers again at every start (bridge.js) */ }
}
