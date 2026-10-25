// Tipo y metadatos de un video a partir de sus bytes (sin ffmpeg), para los videos que la API de productores
// descarga desde una URL (set_event_video): no se confía en el Content-Type del servidor de origen.
// - MP4 / MOV: cajas ISO BMFF. Ancho y alto del track de video (tkhd), con la rotación de la matriz aplicada (los
//   celulares graban vertical como 1920×1080 + rotación de 90°), y duración (mvhd).
// - WebM: solo se reconoce el tipo (EBML con doctype "webm"); sin dimensiones (la página asume 16:9).

/** video/mp4 | video/quicktime | video/webm, o null si no es un video soportado. */
export function sniffVideoType(buf: Uint8Array): "video/mp4" | "video/quicktime" | "video/webm" | null {
    if (buf.length < 12) return null;
    const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    const type = b.toString("latin1", 4, 8);
    if (type === "ftyp") {
        const brand = b.toString("latin1", 8, 12);
        if (brand === "M4A " || brand === "M4B " || brand === "M4P ") return null; // solo audio
        return brand === "qt  " ? "video/quicktime" : "video/mp4";
    }
    // QuickTime antiguo sin ftyp: el archivo empieza directo con cajas de nivel superior
    if (["moov", "mdat", "wide", "free", "skip"].includes(type)) return "video/quicktime";
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
        return b.subarray(0, 64).toString("latin1").includes("webm") ? "video/webm" : null;
    }
    return null;
}

type Box = { type: string; start: number; end: number };

/** Cajas hijas en [start, end). Se detiene ante una caja mal formada. */
function children(b: Buffer, start: number, end: number): Box[] {
    const out: Box[] = [];
    let off = start;
    while (off + 8 <= end) {
        let size = b.readUInt32BE(off);
        const type = b.toString("latin1", off + 4, off + 8);
        let header = 8;
        if (size === 1) {
            if (off + 16 > end) break;
            size = Number(b.readBigUInt64BE(off + 8));
            header = 16;
        } else if (size === 0) {
            size = end - off;
        }
        if (size < header || off + size > end) break;
        out.push({ type, start: off + header, end: off + size });
        off += size;
    }
    return out;
}

/** Ancho, alto (ya rotados) y duración en segundos de un MP4/MOV. null en lo que no se pudo leer. */
export function readMp4Meta(buf: Uint8Array): { width: number | null; height: number | null; duration: number | null } {
    const none = { width: null, height: null, duration: null };
    const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    try {
        const moov = children(b, 0, b.length).find((x) => x.type === "moov");
        if (!moov) return none;
        let duration: number | null = null;
        let width: number | null = null;
        let height: number | null = null;
        for (const box of children(b, moov.start, moov.end)) {
            if (box.type === "mvhd" && box.end - box.start >= 32) {
                const v1 = b[box.start] === 1;
                const timescale = b.readUInt32BE(box.start + (v1 ? 20 : 12));
                const units = v1 ? Number(b.readBigUInt64BE(box.start + 24)) : b.readUInt32BE(box.start + 16);
                if (timescale > 0 && units > 0) duration = Math.round(units / timescale);
            }
            if (box.type === "trak" && width === null) {
                const tkhd = children(b, box.start, box.end).find((x) => x.type === "tkhd");
                if (!tkhd) continue;
                const v1 = b[tkhd.start] === 1;
                const matrix = tkhd.start + (v1 ? 52 : 40);
                if (matrix + 44 > tkhd.end) continue;
                const w = Math.round(b.readUInt32BE(matrix + 36) / 65536);
                const h = Math.round(b.readUInt32BE(matrix + 40) / 65536);
                if (!w || !h) continue; // audio u otro track sin imagen
                // Matriz [a b u; c d v; x y w]: rotación de 90°/270° => a = d = 0 (se intercambian ancho y alto)
                const a = b.readInt32BE(matrix);
                const d = b.readInt32BE(matrix + 16);
                const rotated = a === 0 && d === 0;
                width = rotated ? h : w;
                height = rotated ? w : h;
            }
        }
        const valid = (n: number | null) => (n && n > 0 && n <= 20000 ? n : null);
        return { width: valid(width), height: valid(height), duration: duration && duration < 24 * 3600 ? duration : null };
    } catch {
        return none;
    }
}
