// Web Push on the device (ADR-0017): the gateway encrypts every notification for this device's key
// pair (RFC 8291, aes128gcm – the scheme a browser uses), the relay forwards the ciphertext to FCM
// untouched, and this decrypts it in the messaging service. The key pair and the auth secret live in
// the app's preferences, wrapped with an AES key from the Android keystore.
package com.metor.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class WebPushCrypto {
    private static final String PREFS = "metor.push";
    private static final String WRAP_KEY = "metor.push.wrap";

    public static final class Keys {
        public final ECPrivateKey privateKey;
        public final ECPublicKey publicKey;
        public final byte[] auth;
        Keys(ECPrivateKey priv, ECPublicKey pub, byte[] auth) { this.privateKey = priv; this.publicKey = pub; this.auth = auth; }
        /** The uncompressed point, 65 bytes – what a browser reports as p256dh */
        public byte[] publicRaw() { return uncompressed(publicKey); }
    }

    public static Keys load(Context ctx) throws Exception {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String priv = p.getString("p256.private", null), pub = p.getString("p256.public", null), auth = p.getString("auth", null);
        if (priv == null || pub == null || auth == null) return null;
        KeyFactory kf = KeyFactory.getInstance("EC");
        ECPrivateKey sk = (ECPrivateKey) kf.generatePrivate(new PKCS8EncodedKeySpec(unwrap(priv)));
        ECPublicKey pk = (ECPublicKey) kf.generatePublic(new X509EncodedKeySpec(unwrap(pub)));
        return new Keys(sk, pk, unwrap(auth));
    }
    public static Keys loadOrCreate(Context ctx) throws Exception {
        Keys k = load(ctx); if (k != null) return k;
        KeyPairGenerator g = KeyPairGenerator.getInstance("EC"); g.initialize(new ECGenParameterSpec("secp256r1"));
        KeyPair pair = g.generateKeyPair();
        byte[] auth = new byte[16]; new SecureRandom().nextBytes(auth);
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("p256.private", wrap(pair.getPrivate().getEncoded())).putString("p256.public", wrap(pair.getPublic().getEncoded())).putString("auth", wrap(auth)).apply();
        return new Keys((ECPrivateKey) pair.getPrivate(), (ECPublicKey) pair.getPublic(), auth);
    }

    /** Decrypts an aes128gcm message: header (salt 16 | rs 4 | idlen 1 | sender public key 65), then records */
    public static byte[] decrypt(byte[] m, Keys keys) throws Exception {
        if (m.length < 22) throw new IllegalArgumentException("malformed");
        byte[] salt = Arrays.copyOfRange(m, 0, 16);
        int rs = ByteBuffer.wrap(m, 16, 4).getInt();
        int idlen = m[20] & 0xff;
        if (idlen != 65 || m.length < 21 + idlen || rs < 18) throw new IllegalArgumentException("malformed");
        byte[] senderRaw = Arrays.copyOfRange(m, 21, 21 + idlen);
        byte[] body = Arrays.copyOfRange(m, 21 + idlen, m.length);
        ECPublicKey sender = fromUncompressed(senderRaw, keys.publicKey.getParams());
        KeyAgreement ka = KeyAgreement.getInstance("ECDH"); ka.init(keys.privateKey); ka.doPhase(sender, true);
        byte[] ecdh = ka.generateSecret();
        // IKM = HKDF(salt: auth, ikm: ecdh, info: "WebPush: info" 0x00 ua_public as_public, 32)
        byte[] info = concat("WebPush: info\0".getBytes("UTF-8"), keys.publicRaw(), senderRaw);
        byte[] ikm = hkdf(keys.auth, ecdh, info, 32);
        byte[] cek = hkdf(salt, ikm, "Content-Encoding: aes128gcm\0".getBytes("UTF-8"), 16);
        byte[] nonceBase = hkdf(salt, ikm, "Content-Encoding: nonce\0".getBytes("UTF-8"), 12);
        ByteBuffer out = ByteBuffer.allocate(body.length);
        long seq = 0; int offset = 0;
        while (offset < body.length) {
            int end = Math.min(offset + rs, body.length);
            byte[] record = Arrays.copyOfRange(body, offset, end);
            if (record.length <= 16) throw new IllegalArgumentException("malformed");
            byte[] nonce = nonceBase.clone();
            for (int i = 0; i < 8; i++) nonce[4 + i] ^= (byte) (seq >>> (8 * (7 - i)));   // the 96-bit nonce XOR the record sequence number
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
            byte[] plain = c.doFinal(record);
            int delimiter = plain.length - 1; while (delimiter >= 0 && plain[delimiter] == 0) delimiter--;   // padding: zeros after 0x01 (more) / 0x02 (last)
            if (delimiter < 0) throw new IllegalArgumentException("malformed");
            out.put(plain, 0, delimiter);
            if (plain[delimiter] == 2) break;
            seq++; offset = end;
        }
        return Arrays.copyOf(out.array(), out.position());
    }

    // ---- helpers ----
    static byte[] hkdf(byte[] salt, byte[] ikm, byte[] info, int len) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt.length == 0 ? new byte[32] : salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(ikm);
        mac.init(new SecretKeySpec(prk, "HmacSHA256"));
        byte[] out = new byte[len]; byte[] t = new byte[0]; int pos = 0;
        for (int i = 1; pos < len; i++) {
            mac.update(t); mac.update(info); mac.update((byte) i); t = mac.doFinal();
            int n = Math.min(t.length, len - pos); System.arraycopy(t, 0, out, pos, n); pos += n;
        }
        return out;
    }
    static byte[] uncompressed(ECPublicKey key) {
        byte[] out = new byte[65]; out[0] = 4;
        byte[] x = key.getW().getAffineX().toByteArray(), y = key.getW().getAffineY().toByteArray();
        System.arraycopy(x, Math.max(0, x.length - 32), out, 1 + Math.max(0, 32 - x.length), Math.min(32, x.length));
        System.arraycopy(y, Math.max(0, y.length - 32), out, 33 + Math.max(0, 32 - y.length), Math.min(32, y.length));
        return out;
    }
    static ECPublicKey fromUncompressed(byte[] raw, ECParameterSpec params) throws Exception {
        if (raw.length != 65 || raw[0] != 4) throw new IllegalArgumentException("malformed");
        ECPoint w = new ECPoint(new BigInteger(1, Arrays.copyOfRange(raw, 1, 33)), new BigInteger(1, Arrays.copyOfRange(raw, 33, 65)));
        return (ECPublicKey) KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(w, params));
    }
    static byte[] concat(byte[]... parts) { int n = 0; for (byte[] p : parts) n += p.length; byte[] out = new byte[n]; int pos = 0; for (byte[] p : parts) { System.arraycopy(p, 0, out, pos, p.length); pos += p.length; } return out; }
    public static String base64url(byte[] b) { return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }

    // The computers whose approvals may be answered from a notification: address and session per id,
    // handed over by the bridge after the push registration
    public static final class Computer { public final String origin, token; Computer(String o, String t) { origin = o; token = t; } }
    public static void setComputer(Context ctx, String id, String origin, String token) throws Exception {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("computer." + id, wrap((origin + "\n" + token).getBytes("UTF-8"))).apply();
    }
    public static void clearComputer(Context ctx, String id) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("computer." + id).remove("badge." + id).apply();
    }
    // The unread count per computer (knowledge/design/several-computers.md): the notifications carry the sum over
    // every computer the app is connected to. Plain numbers, nothing to protect.
    public static void setBadge(Context ctx, String id, int count) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt("badge." + id, Math.max(0, count)).apply();
    }
    public static int badgeTotal(Context ctx) {
        int total = 0;
        for (java.util.Map.Entry<String, ?> e : ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getAll().entrySet())
            if (e.getKey().startsWith("badge.") && e.getValue() instanceof Integer) total += (Integer) e.getValue();
        return total;
    }
    public static Computer getComputer(Context ctx, String id) {
        try {
            String v = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("computer." + id, null);
            if (v == null) return null;
            String[] parts = new String(unwrap(v), "UTF-8").split("\n", 2);
            return parts.length == 2 ? new Computer(parts[0], parts[1]) : null;
        } catch (Exception e) { return null; }
    }

    // Wrapping with an AES-GCM key that never leaves the Android keystore
    private static SecretKey wrapKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (ks.containsAlias(WRAP_KEY)) return ((KeyStore.SecretKeyEntry) ks.getEntry(WRAP_KEY, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(WRAP_KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return g.generateKey();
    }
    private static String wrap(byte[] data) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, wrapKey());
        return base64url(concat(c.getIV(), c.doFinal(data)));
    }
    private static byte[] unwrap(String s) throws Exception {
        byte[] b = Base64.decode(s, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, wrapKey(), new GCMParameterSpec(128, Arrays.copyOfRange(b, 0, 12)));
        return c.doFinal(b, 12, b.length - 12);
    }
    private WebPushCrypto() {}
}
