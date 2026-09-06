// Web Push on the device (ADR-0017). The gateway encrypts every notification for this device's key
// pair (RFC 8291, aes128gcm, the same scheme a browser uses); the relay forwards the ciphertext to
// APNs untouched; this file decrypts it – in the app and in the notification service extension,
// which is why the key pair lives in the keychain, in the access group both share.
import Foundation
import CryptoKit
import Security

enum WebPushError: Error { case malformed, keychain(OSStatus) }

struct WebPushKeys {
    let privateKey: P256.KeyAgreement.PrivateKey
    let auth: Data   // 16 random bytes, the subscription's auth secret

    private static let service = "com.metor.mobile.push"
    static func load() throws -> WebPushKeys? {
        guard let raw = try read("p256"), let auth = try read("auth") else { return nil }
        return WebPushKeys(privateKey: try P256.KeyAgreement.PrivateKey(rawRepresentation: raw), auth: auth)
    }
    static func loadOrCreate() throws -> WebPushKeys {
        if let k = try load() { return k }
        let key = P256.KeyAgreement.PrivateKey()
        var auth = Data(count: 16); _ = auth.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        try write("p256", key.rawRepresentation); try write("auth", auth)
        return WebPushKeys(privateKey: key, auth: auth)
    }
    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
    private static func read(_ account: String) throws -> Data? {
        var q = query(account); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = out as? Data else { throw WebPushError.keychain(status) }
        return data
    }
    private static func write(_ account: String, _ data: Data) throws {
        var q = query(account); q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly   // the extension decrypts while the phone is locked
        SecItemDelete(query(account) as CFDictionary)
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw WebPushError.keychain(status) }
    }
}

enum WebPushCrypto {
    /// Decrypts an aes128gcm message: header (salt 16 | rs 4 | idlen 1 | sender public key 65), then records.
    static func decrypt(_ message: Data, keys: WebPushKeys) throws -> Data {
        let m = Data(message)
        guard m.count > 21 else { throw WebPushError.malformed }
        let salt = m.subdata(in: 0..<16)
        let rs = Int(UInt32(bigEndian: m.subdata(in: 16..<20).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }))
        let idlen = Int(m[20])
        guard idlen == 65, m.count >= 21 + idlen, rs >= 18 else { throw WebPushError.malformed }
        let senderPublic = m.subdata(in: 21..<(21 + idlen))
        let body = m.subdata(in: (21 + idlen)..<m.count)
        let sender = try P256.KeyAgreement.PublicKey(x963Representation: senderPublic)
        let shared = try keys.privateKey.sharedSecretFromKeyAgreement(with: sender)
        // IKM = HKDF(salt: auth, ikm: ecdh, info: "WebPush: info" 0x00 ua_public as_public, 32)
        var info = Data("WebPush: info".utf8); info.append(0)
        info.append(keys.privateKey.publicKey.x963Representation); info.append(senderPublic)
        let ikm = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: keys.auth, sharedInfo: info, outputByteCount: 32)
        // CEK and the nonce base from PRK = HKDF-Extract(salt, IKM)
        var cekInfo = Data("Content-Encoding: aes128gcm".utf8); cekInfo.append(0)
        var nonceInfo = Data("Content-Encoding: nonce".utf8); nonceInfo.append(0)
        let cek = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: salt, info: cekInfo, outputByteCount: 16)
        let nonceBase = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: salt, info: nonceInfo, outputByteCount: 12).withUnsafeBytes { Data($0) }
        var out = Data(); var seq: UInt64 = 0; var offset = 0
        while offset < body.count {
            let end = min(offset + rs, body.count)
            let record = body.subdata(in: offset..<end)
            guard record.count > 16 else { throw WebPushError.malformed }
            var nonce = nonceBase
            let seqBytes = withUnsafeBytes(of: seq.bigEndian) { Data($0) }
            for i in 0..<8 { nonce[4 + i] ^= seqBytes[i] }   // the 96-bit nonce XOR the record sequence number
            let sealed = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: record.subdata(in: 0..<(record.count - 16)), tag: record.subdata(in: (record.count - 16)..<record.count))
            let plain = try AES.GCM.open(sealed, using: cek)
            // padding: zeros after a delimiter byte – 0x01 more records follow, 0x02 this was the last
            guard let delimiter = plain.lastIndex(where: { $0 != 0 }) else { throw WebPushError.malformed }
            out.append(plain.subdata(in: 0..<delimiter))
            if plain[delimiter] == 2 { break }
            seq += 1; offset = end
        }
        return out
    }
}

extension Data {
    var base64url: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
