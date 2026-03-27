import { createCipheriv, createDecipheriv, randomBytes, createHmac } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
    const key = import.meta.env.TOKEN_ENCRYPTION_KEY || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("TOKEN_ENCRYPTION_KEY not configured");
    // Derive a 32-byte key from whatever string is provided
    return Buffer.from(
        createHmac("sha256", "aitickets-token-enc").update(key).digest()
    );
}

export function encryptToken(plaintext: string): string {
    const key = getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    // Format: iv:authTag:ciphertext
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptToken(encryptedStr: string): string {
    // If it doesn't look encrypted (no colons), return as-is for backwards compat
    if (!encryptedStr.includes(":")) return encryptedStr;

    const key = getEncryptionKey();
    const [ivHex, authTagHex, ciphertext] = encryptedStr.split(":");

    if (!ivHex || !authTagHex || !ciphertext) {
        throw new Error("Invalid encrypted token format");
    }

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

/**
 * Create HMAC-signed state for OAuth flows to prevent CSRF
 */
export function createOAuthState(data: Record<string, any>): string {
    const key = getEncryptionKey();
    const payload = JSON.stringify(data);
    const hmac = createHmac("sha256", key).update(payload).digest("hex");
    return Buffer.from(`${hmac}.${payload}`).toString("base64url");
}

/**
 * Verify and parse HMAC-signed OAuth state
 */
export function verifyOAuthState(state: string): Record<string, any> | null {
    try {
        const key = getEncryptionKey();
        const decoded = Buffer.from(state, "base64url").toString("utf8");
        const dotIndex = decoded.indexOf(".");
        if (dotIndex === -1) return null;

        const hmac = decoded.substring(0, dotIndex);
        const payload = decoded.substring(dotIndex + 1);
        const expectedHmac = createHmac("sha256", key).update(payload).digest("hex");

        // Timing-safe comparison
        if (hmac.length !== expectedHmac.length) return null;
        let match = true;
        for (let i = 0; i < hmac.length; i++) {
            if (hmac[i] !== expectedHmac[i]) match = false;
        }
        if (!match) return null;

        return JSON.parse(payload);
    } catch {
        return null;
    }
}
