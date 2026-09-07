// The app's own push plugin (ADR-0017): asks for the notification permission, fetches the FCM
// registration token, keeps the device's Web Push key pair, and reports token and keys to the bridge
// (src/bridge.js), which hands the gateway a subscription whose endpoint is the relay. A tap on a
// notification (MetorMessagingService) arrives here as the "opened" event. Registered in MainActivity.
package com.metor.mobile;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(name = "MetorPush", permissions = { @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }) })
public class MetorPushPlugin extends Plugin {
    static final String EXTRA_BOT = "metor_bot";
    static final String EXTRA_COMPUTER = "metor_c";   // the computer a push came from (knowledge/design/several-computers.md)

    @Override
    public void load() { deliverOpened(getActivity().getIntent()); }

    @Override
    protected void handleOnNewIntent(Intent intent) { super.handleOnNewIntent(intent); deliverOpened(intent); }

    private void deliverOpened(Intent intent) {
        if (intent == null || !intent.hasExtra(EXTRA_BOT)) return;
        JSObject data = new JSObject(); data.put("bot", intent.getStringExtra(EXTRA_BOT)); data.put("computer", intent.getStringExtra(EXTRA_COMPUTER));
        intent.removeExtra(EXTRA_BOT); intent.removeExtra(EXTRA_COMPUTER);
        notifyListeners("opened", data, true);
    }

    // The bridge names the computer a push may come from; approvals are answered there straight from the notification
    @PluginMethod
    public void setComputer(PluginCall call) {
        String id = call.getString("id"), origin = call.getString("origin"), token = call.getString("token");
        if (id == null || origin == null || token == null) { call.reject("id, origin and token"); return; }
        try { WebPushCrypto.setComputer(getContext(), id, origin, token); call.resolve(); } catch (Exception e) { call.reject("store: " + e.getMessage()); }
    }
    @PluginMethod
    public void clearComputer(PluginCall call) { String id = call.getString("id"); if (id != null) WebPushCrypto.clearComputer(getContext(), id); call.resolve(); }

    // Android has no badge of its own: the launcher's dot or count comes from the active notifications. So the
    // notifications of bots that were read go away – of that computer (its id travels in the notification's
    // extras, MetorMessagingService), all of them when nothing is unread there any more. The count itself is
    // kept per computer for the number the next notification shows (the sum over all computers).
    @PluginMethod
    public void setBadge(PluginCall call) {
        android.app.NotificationManager nm = getContext().getSystemService(android.app.NotificationManager.class);
        int count = call.getInt("count", 0);
        String computer = call.getString("computer");
        if (computer != null) WebPushCrypto.setBadge(getContext(), computer, count);
        java.util.HashSet<String> read = new java.util.HashSet<>();
        com.getcapacitor.JSArray arr = call.getArray("read");
        if (arr != null) for (int i = 0; i < arr.length(); i++) { try { read.add(arr.getString(i)); } catch (Exception ignored) {} }
        if (count == 0 && computer == null) nm.cancelAll();
        else for (android.service.notification.StatusBarNotification n : nm.getActiveNotifications()) {
            android.os.Bundle x = n.getNotification().extras;
            String from = x == null ? null : x.getString(EXTRA_COMPUTER), bot = x == null ? null : x.getString(EXTRA_BOT);
            if (computer != null && from != null && !from.equals(computer)) continue;   // another computer's
            if (count == 0 || (bot != null && read.contains(bot))) nm.cancel(n.getId());
        }
        call.resolve();
    }

    @PluginMethod
    public void register(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "permissionDone");
        } else {
            finishRegistration(call);
        }
    }

    @PermissionCallback
    private void permissionDone(PluginCall call) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) { JSObject r = new JSObject(); r.put("reason", "denied"); call.resolve(r); return; }
        finishRegistration(call);
    }

    private void finishRegistration(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) { JSObject r = new JSObject(); r.put("reason", "fcm not configured (no google-services.json in this build)"); call.resolve(r); return; }
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            JSObject r = new JSObject();
            if (!task.isSuccessful() || task.getResult() == null) { r.put("reason", "fcm: " + (task.getException() != null ? task.getException().getMessage() : "no token")); call.resolve(r); return; }
            try {
                WebPushCrypto.Keys keys = WebPushCrypto.loadOrCreate(getContext());
                r.put("platform", "android"); r.put("token", task.getResult()); r.put("sandbox", false);
                r.put("p256dh", WebPushCrypto.base64url(keys.publicRaw())); r.put("auth", WebPushCrypto.base64url(keys.auth));
                call.resolve(r);
            } catch (Exception e) { call.reject("keys: " + e.getMessage()); }
        });
    }
}
