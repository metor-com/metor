import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self   // taps, actions and foreground presentation (ADR-0017)
        // Approvals can be answered from the notification; both actions ask for the unlock (Face ID / code) first
        let approve = UNNotificationAction(identifier: "approve", title: "Approve", options: [.authenticationRequired])
        let deny = UNNotificationAction(identifier: "deny", title: "Deny", options: [.authenticationRequired, .destructive])
        center.setNotificationCategories([UNNotificationCategory(identifier: MetorPushPlugin.approvalCategory, actions: [approve, deny], intentIdentifiers: [], options: [])])
        return true
    }

    // APNs registration → the push plugin (MetorPushPlugin.swift)
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    // A push arriving while the app is open is shown as a banner (the interface skips its own copy)
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }
    // A tap opens the bot the notification is about; Approve / Deny answer the permission card at the computer
    // without opening the app (put there by the notification service extension: metor_bot, metor_ref, metor_c)
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        let bot = info["metor_bot"] as? String ?? ""
        if response.actionIdentifier == "approve" || response.actionIdentifier == "deny" {
            guard let ref = info["metor_ref"] as? String, let computer = info["metor_c"] as? String else { return completionHandler() }
            PushComputers.answer(computer: computer, bot: bot, ref: ref, decision: response.actionIdentifier == "approve" ? "allow" : "deny") { _ in completionHandler() }
            return
        }
        MetorPushPlugin.pendingBot = bot
        NotificationCenter.default.post(name: MetorPushPlugin.opened, object: nil, userInfo: ["bot": bot])
        completionHandler()
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
