// The app's own push plugin (ADR-0017): asks for permission, registers with APNs, keeps the device's
// Web Push key pair, and reports the token and keys to the bridge (src/bridge.js), which hands the
// gateway a subscription whose endpoint is the relay. Registered in MainViewController.swift.
import Foundation
import Capacitor
import UserNotifications

@objc(MetorPushPlugin)
public class MetorPushPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MetorPushPlugin"
    public let jsName = "MetorPush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setComputer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearComputer", returnType: CAPPluginReturnPromise),
    ]
    static let approvalCategory = "metor.approval"   // notification actions Approve / Deny (registered in AppDelegate)
    static let opened = Notification.Name("metor.push.opened")
    static var pendingBot: String?   // a tap that arrived before the interface was listening
    private var pending: CAPPluginCall?

    public override func load() {
        let c = NotificationCenter.default
        c.addObserver(self, selector: #selector(gotToken(_:)), name: .capacitorDidRegisterForRemoteNotifications, object: nil)
        c.addObserver(self, selector: #selector(failed(_:)), name: .capacitorDidFailToRegisterForRemoteNotifications, object: nil)
        c.addObserver(self, selector: #selector(opened(_:)), name: MetorPushPlugin.opened, object: nil)
        if let bot = MetorPushPlugin.pendingBot { MetorPushPlugin.pendingBot = nil; notifyListeners("opened", data: ["bot": bot], retainUntilConsumed: true) }
    }

    @objc func register(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { call.resolve(["reason": "denied"]); return }
            self.pending = call
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }
    // The bridge names the computer a push may come from; approvals are answered there straight from the notification
    @objc func setComputer(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let origin = call.getString("origin"), let token = call.getString("token") else { call.reject("id, origin and token"); return }
        do { try PushComputers.set(id, .init(origin: origin, token: token)); call.resolve() } catch { call.reject("keychain: \(error)") }
    }
    @objc func clearComputer(_ call: CAPPluginCall) { if let id = call.getString("id") { PushComputers.remove(id) }; call.resolve() }

    @objc func gotToken(_ n: Notification) {
        guard let token = n.object as? Data, let call = pending else { return }
        pending = nil
        do {
            let keys = try WebPushKeys.loadOrCreate()
            call.resolve(["platform": "ios", "token": token.hex, "sandbox": MetorPushPlugin.sandbox,
                          "p256dh": keys.privateKey.publicKey.x963Representation.base64url, "auth": keys.auth.base64url])
        } catch { call.reject("keys: \(error)") }
    }
    @objc func failed(_ n: Notification) {
        pending?.resolve(["reason": "apns: \((n.object as? Error)?.localizedDescription ?? "registration failed")"]); pending = nil
    }
    @objc func opened(_ n: Notification) {
        notifyListeners("opened", data: ["bot": (n.userInfo?["bot"] as? String) ?? ""], retainUntilConsumed: true)
    }
    // Development builds get sandbox tokens; App Store and TestFlight builds production ones
    static var sandbox: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }
}
