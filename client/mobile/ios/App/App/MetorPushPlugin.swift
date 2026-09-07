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
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise),
    ]
    static let approvalCategory = "metor.approval"   // notification actions Approve / Deny (registered in AppDelegate)
    static let opened = Notification.Name("metor.push.opened")
    static var pendingOpen: [String: String]?   // a tap (bot and computer) that arrived before the interface was listening
    private var pending: CAPPluginCall?

    public override func load() {
        let c = NotificationCenter.default
        c.addObserver(self, selector: #selector(gotToken(_:)), name: .capacitorDidRegisterForRemoteNotifications, object: nil)
        c.addObserver(self, selector: #selector(failed(_:)), name: .capacitorDidFailToRegisterForRemoteNotifications, object: nil)
        c.addObserver(self, selector: #selector(opened(_:)), name: MetorPushPlugin.opened, object: nil)
        if let open = MetorPushPlugin.pendingOpen { MetorPushPlugin.pendingOpen = nil; notifyListeners("opened", data: open, retainUntilConsumed: true) }
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
    @objc func clearComputer(_ call: CAPPluginCall) {
        if let id = call.getString("id") { PushComputers.remove(id); PushBadges.remove(id); MetorPushPlugin.showBadge(PushBadges.total()) }
        call.resolve()
    }

    // The badge follows the bot list while the app is open: the unread total of that computer goes into the
    // per-computer store and the icon shows the sum over all computers; the notifications of bots that were
    // read disappear from the notification center (thread "bot:<computer>:<name>", the computer in metor_c)
    @objc func setBadge(_ call: CAPPluginCall) {
        let count = call.getInt("count") ?? 0
        let computer = call.getString("computer")
        let read = Set((call.getArray("read") as? [String]) ?? [])
        if let c = computer { PushBadges.set(c, count) }
        MetorPushPlugin.showBadge(computer == nil ? count : PushBadges.total())
        let center = UNUserNotificationCenter.current()
        if count == 0 && computer == nil { center.removeAllDeliveredNotifications() }
        else if count == 0 || !read.isEmpty {
            center.getDeliveredNotifications { delivered in
                let ids = delivered.filter { n in
                    let info = n.request.content.userInfo
                    if let c = computer, let from = info["metor_c"] as? String, from != c { return false }   // another computer's
                    if count == 0 { return true }
                    return read.contains((info["metor_bot"] as? String) ?? String(n.request.content.threadIdentifier.split(separator: ":").last ?? ""))
                }.map { $0.request.identifier }
                if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
            }
        }
        call.resolve()
    }
    static func showBadge(_ count: Int) {
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) { UNUserNotificationCenter.current().setBadgeCount(count) { _ in } } else { UIApplication.shared.applicationIconBadgeNumber = count }
        }
    }

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
        notifyListeners("opened", data: ["bot": (n.userInfo?["bot"] as? String) ?? "", "computer": (n.userInfo?["computer"] as? String) ?? ""], retainUntilConsumed: true)
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
