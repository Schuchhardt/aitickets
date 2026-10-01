// Descarga de URLs indicadas por terceros (imágenes por URL, metadatos de clientes OAuth) sin SSRF:
// solo https al puerto 443, el dominio debe resolver SOLO a IPs públicas, cada redirección se vuelve a
// verificar (máx. 3), tiempo y tamaño acotados.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SafeFetchError extends Error {
    kind: "invalid" | "upstream";
    constructor(kind: "invalid" | "upstream", message: string) {
        super(message);
        this.kind = kind;
    }
}

/** true si la IP es pública (no loopback, privada, link-local, CGNAT, multicast ni reservada). */
export function isPublicIp(ip: string): boolean {
    const v = isIP(ip);
    if (v === 4) {
        const [a, b] = ip.split(".").map(Number);
        if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
        if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
        if (a === 169 && b === 254) return false; // link-local / metadata
        if (a === 172 && b >= 16 && b <= 31) return false;
        if (a === 192 && b === 168) return false;
        if (a === 192 && b === 0) return false;
        if (a === 198 && (b === 18 || b === 19)) return false;
        return true;
    }
    if (v === 6) {
        const s = ip.toLowerCase();
        const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
        if (mapped) return isPublicIp(mapped[1]);
        if (s === "::" || s === "::1") return false;
        if (/^f[cd]/.test(s)) return false; // ULA
        if (/^fe[89ab]/.test(s)) return false; // link-local
        if (/^ff/.test(s)) return false; // multicast
        if (s.startsWith("64:ff9b:") || s.startsWith("2001:db8")) return false;
        return true;
    }
    return false;
}

async function assertPublicHost(url: URL) {
    if (url.protocol !== "https:") throw new SafeFetchError("invalid", "Solo se aceptan URLs https.");
    if (url.username || url.password) throw new SafeFetchError("invalid", "URL inválida.");
    if (url.port && url.port !== "443") throw new SafeFetchError("invalid", "Puerto no permitido.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!addresses.length) throw new SafeFetchError("invalid", "No se pudo resolver el dominio.");
    if (addresses.some((a: any) => !isPublicIp(a.address))) throw new SafeFetchError("invalid", "La URL apunta a una dirección no permitida.");
}

/** Descarga una URL pública con los límites indicados. */
export async function fetchPublic(
    rawUrl: string,
    { maxBytes, accept = "*/*", timeoutMs = 10_000, fetchImpl = fetch }: { maxBytes: number; accept?: string; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<{ buffer: Buffer; contentType: string | null; finalUrl: string }> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new SafeFetchError("invalid", "URL inválida.");
    }
    for (let hop = 0; hop <= 3; hop++) {
        await assertPublicHost(url);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetchImpl(url, { redirect: "manual", signal: controller.signal, headers: { Accept: accept } });
            if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
                url = new URL(res.headers.get("location")!, url);
                continue;
            }
            if (!res.ok || !res.body) throw new SafeFetchError("upstream", `La descarga falló (HTTP ${res.status}).`);
            const tooBig = () => new SafeFetchError("invalid", `El archivo supera ${Math.round(maxBytes / 1024)} KB.`);
            if (Number(res.headers.get("content-length") || 0) > maxBytes) throw tooBig();
            const chunks: Uint8Array[] = [];
            let size = 0;
            const reader = res.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > maxBytes) {
                    await reader.cancel().catch(() => {});
                    throw tooBig();
                }
                chunks.push(value);
            }
            return { buffer: Buffer.concat(chunks), contentType: res.headers.get("content-type"), finalUrl: url.toString() };
        } catch (err: any) {
            if (err instanceof SafeFetchError) throw err;
            throw new SafeFetchError("upstream", err?.name === "AbortError" ? "La descarga tardó demasiado." : "No se pudo descargar la URL.");
        } finally {
            clearTimeout(timer);
        }
    }
    throw new SafeFetchError("upstream", "Demasiadas redirecciones.");
}
