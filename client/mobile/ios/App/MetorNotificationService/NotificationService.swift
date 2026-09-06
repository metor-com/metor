// Notification service extension (ADR-0017): APNs delivers the placeholder alert with the ciphertext the
// relay attached; this decrypts it with the key pair from the shared keychain and replaces title and
// body before the notification is shown. If anything fails, the placeholder shows – nothing readable
// was ever in transit.
import UserNotifications

class NotificationService: UNNotificationServiceExtension {
    enum Step: Error { case noPayload, noKeys, noJson }
    private var handler: ((UNNotificationContent) -> Void)?
    private var content: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        handler = contentHandler
        let content = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        self.content = content
        do {
            guard let metor = request.content.userInfo["metor"] as? [String: Any], let b64 = metor["body"] as? String, let cipher = Data(base64Encoded: b64) else { throw Step.noPayload }
            guard let keys = try WebPushKeys.load() else { throw Step.noKeys }
            let plain = try WebPushCrypto.decrypt(cipher, keys: keys)
            guard let json = try JSONSerialization.jsonObject(with: plain) as? [String: Any] else { throw Step.noJson }
            content.title = json["title"] as? String ?? "metor"
            content.body = json["body"] as? String ?? ""
            if let bot = json["bot"] as? String, !bot.isEmpty { content.userInfo["metor_bot"] = bot; content.threadIdentifier = "bot:\(bot)" }
            if let kind = json["kind"] as? String { content.userInfo["metor_kind"] = kind }
            NSLog("metor push: decrypted for bot %@", (json["bot"] as? String) ?? "-")
        } catch {
            NSLog("metor push: placeholder shown – %@", String(describing: error))   // no content is logged, only the step that failed
        }
        contentHandler(content)
        handler = nil
    }
    override func serviceExtensionTimeWillExpire() {
        if let c = content, let h = handler { h(c); handler = nil }
    }
}
