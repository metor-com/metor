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

    @Override
    public void load() { deliverOpened(getActivity().getIntent()); }

    @Override
    protected void handleOnNewIntent(Intent intent) { super.handleOnNewIntent(intent); deliverOpened(intent); }

    private void deliverOpened(Intent intent) {
        if (intent == null || !intent.hasExtra(EXTRA_BOT)) return;
        JSObject data = new JSObject(); data.put("bot", intent.getStringExtra(EXTRA_BOT));
        intent.removeExtra(EXTRA_BOT);
        notifyListeners("opened", data, true);
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
