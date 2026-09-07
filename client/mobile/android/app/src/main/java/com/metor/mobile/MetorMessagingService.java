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
        String title = "metor", text = "New activity", bot = null, kind = null, ref = null, computer = message.getData().get("c");
        int badge = 0;   // unread across bots – launchers that show a count use it
        try {
            WebPushCrypto.Keys keys = WebPushCrypto.load(this);
            if (keys != null) {
                JSONObject json = new JSONObject(new String(WebPushCrypto.decrypt(Base64.decode(body, Base64.DEFAULT), keys), "UTF-8"));
                title = json.optString("title", title); text = json.optString("body", "");
                bot = json.optString("bot", null); kind = json.optString("kind", null); ref = json.optString("ref", null);
                badge = json.optInt("badge", 0);
            }
        } catch (Exception e) { Log.w("metor", "push: " + e.getMessage()); }   // the placeholder shows; nothing readable was in transit
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "metor", NotificationManager.IMPORTANCE_HIGH));
        // The count is that computer's; the number shown is the sum over every computer the app is connected to
        if (computer != null) { WebPushCrypto.setBadge(this, computer, badge); badge = WebPushCrypto.badgeTotal(this); }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (bot != null && !bot.isEmpty()) open.putExtra(MetorPushPlugin.EXTRA_BOT, bot);
        if (computer != null) open.putExtra(MetorPushPlugin.EXTRA_COMPUTER, computer);   // the app switches to that computer before it opens the bot
        int id = bot != null ? ((computer != null ? computer + ":" : "") + bot).hashCode() : (int) System.currentTimeMillis();
        PendingIntent tap = PendingIntent.getActivity(this, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        android.os.Bundle extras = new android.os.Bundle();   // so the app can find this computer's notifications (MetorPushPlugin.setBadge)
        if (bot != null) extras.putString(MetorPushPlugin.EXTRA_BOT, bot);
        if (computer != null) extras.putString(MetorPushPlugin.EXTRA_COMPUTER, computer);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_metor).setContentTitle(title).setContentText(text)   // white "m" on transparent (res/drawable)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority("approval".equals(kind) ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true).setContentIntent(tap).addExtras(extras)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL).setNumber(badge);
        // An approval can be answered from the notification when the permission's ref and the computer are known;
        // both actions ask for the unlock first (setAuthenticationRequired, Android 12+)
        if ("approval".equals(kind) && ref != null && !ref.isEmpty() && bot != null && computer != null) {
            b.addAction(action(id, "Approve", "allow", computer, bot, ref)).addAction(action(id, "Deny", "deny", computer, bot, ref));
        }
        nm.notify(id, b.build());
    }

    private NotificationCompat.Action action(int notificationId, String label, String decision, String computer, String bot, String ref) {
        Intent i = new Intent(this, MetorActionReceiver.class).setAction("com.metor.mobile.APPROVAL_" + decision.toUpperCase())
            .putExtra("computer", computer).putExtra("bot", bot).putExtra("ref", ref).putExtra("decision", decision).putExtra("notification", notificationId);
        PendingIntent pi = PendingIntent.getBroadcast(this, (ref + decision).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Action.Builder(0, label, pi).setAuthenticationRequired(true).build();
    }

    @Override
    public void onNewToken(String token) { /* the app registers again at every start (bridge.js) */ }
}
