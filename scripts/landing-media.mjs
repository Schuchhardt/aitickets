// Versiones optimizadas de las fotos y videos de las landings (public/landing, docs/specs/rediseno/README.md):
//   fotos  → AVIF y WebP a varios anchos (<nombre>-<ancho>.avif / .webp), con sharp. Las páginas las sirven en un
//            <picture> con srcset y el JPG queda solo de respaldo (y de imagen para compartir, og:image).
//   videos → WebM (VP9 + Opus) junto a cada MP4 de public/landing y public/videos, con ffmpeg (tiene que estar
//            instalado en la máquina). El de portada usa de póster la foto de la misma escena, que ya tiene sus variantes;
//            el demo del modal (public/videos) tiene su póster <nombre>-poster.jpg, que se pasa a WebP
//            (LANDING_MEDIA en src/components/landing/producerLanding.js).
//
// Uso:
//   node scripts/landing-media.mjs                    genera lo que falte de las fotos que ya tienen variantes y de los MP4
//   node scripts/landing-media.mjs aitk-nueva.jpg     además crea las variantes de una foto nueva
//   node scripts/landing-media.mjs --force [fotos]    las vuelve a generar aunque existan (cambió la foto)
//
// Anchos: los que ya existen en disco para esa foto; si no tiene, 640/1024 (y 1344 si alcanza) para las apaisadas y
// 480/896 para las verticales, nunca más que el original. Una foto real a 2400 px suma 1344/2048 a mano en su photo().
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import sharp from "sharp";

const DIR = join(process.cwd(), "public", "landing");
// Videos fuera de public/landing: el demo del modal de /organizadores y stand-up
const VIDEO_DIR = join(process.cwd(), "public", "videos");
const FORMATS = {
  avif: (img) => img.avif({ quality: 50, effort: 6 }),
  webp: (img) => img.webp({ quality: 74, effort: 6 }),
};

const args = process.argv.slice(2);
const force = args.includes("--force");
const requested = args.filter((a) => !a.startsWith("--")).map((a) => basename(a, ".jpg"));

const files = readdirSync(DIR).filter((f) => !f.includes(".tmp."));
const kb = (path) => `${Math.round(statSync(path).size / 1024)} KB`;

/** Anchos que ya tiene una foto en disco (de sus .avif/.webp) */
function existingWidths(name) {
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.(avif|webp)$`);
  return [...new Set(files.map((f) => f.match(re)?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
}

function defaultWidths({ width, height }) {
  const wanted = width > height ? [640, 1024, 1344] : [480, 896];
  return wanted.filter((w) => w <= width);
}

async function photo(name) {
  const source = join(DIR, `${name}.jpg`);
  if (!existsSync(source)) throw new Error(`No existe public/landing/${name}.jpg`);
  const meta = await sharp(source).metadata();
  const widths = existingWidths(name).length ? existingWidths(name) : defaultWidths(meta);
  for (const w of widths) {
    for (const [ext, encode] of Object.entries(FORMATS)) {
      const out = join(DIR, `${name}-${w}.${ext}`);
      if (existsSync(out) && !force) continue;
      await encode(sharp(source).rotate().resize({ width: w, withoutEnlargement: true })).toFile(out);
      console.log(`  ${basename(out)} (${kb(out)})`);
    }
  }
  return { name, width: meta.width, height: meta.height, widths };
}

/** MP4 con el índice (moov) al principio: el navegador empieza a reproducir sin bajar el archivo entero */
function faststart(source) {
  const head = readFileSync(source);
  if (head.indexOf("moov") < head.indexOf("mdat")) return;
  const tmp = `${source}.tmp.mp4`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-c", "copy", "-movflags", "+faststart", tmp], {
    stdio: "inherit",
  });
  renameSync(tmp, source);
  console.log(`  ${basename(source)}: índice al principio (faststart)`);
}

function video(dir, name) {
  const source = join(dir, `${name}.mp4`);
  faststart(source);
  const out = join(dir, `${name}.webm`);
  if (existsSync(out) && !force) return;
  // Mismo cuadro y duración; sin audio no: la portada de ejemplo tiene botón de sonido
  execFileSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", source, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1",
      "-deadline", "good", "-cpu-used", "2", "-c:a", "libopus", "-b:a", "96k", out],
    { stdio: "inherit" },
  );
  console.log(`  ${basename(out)} (${kb(out)}, MP4 ${kb(source)})`);
}

/** Póster propio de un video (<nombre>-poster.jpg) en WebP, al mismo tamaño: el <video poster> acepta una sola URL */
async function videoPoster(dir, name) {
  const source = join(dir, `${name}-poster.jpg`);
  const out = join(dir, `${name}-poster.webp`);
  if (!existsSync(source) || (existsSync(out) && !force)) return;
  await FORMATS.webp(sharp(source).rotate()).toFile(out);
  console.log(`  ${basename(out)} (${kb(out)}, JPG ${kb(source)})`);
}

const withVariants = files
  .filter((f) => f.endsWith(".jpg"))
  .map((f) => basename(f, ".jpg"))
  .filter((name) => existingWidths(name).length > 0);
const photos = [...new Set([...(requested.length && force ? [] : withVariants), ...requested])];

console.log(`Fotos (${photos.length})`);
for (const name of photos) {
  const { width, height, widths } = await photo(name);
  console.log(`${name}.jpg ${width}×${height} → ${widths.join(", ")}`);
}

const videos = [
  ...files.filter((f) => f.endsWith(".mp4")).map((f) => [DIR, basename(f, ".mp4")]),
  ...(existsSync(VIDEO_DIR) ? readdirSync(VIDEO_DIR) : [])
    .filter((f) => f.endsWith(".mp4") && !f.includes(".tmp."))
    .map((f) => [VIDEO_DIR, basename(f, ".mp4")]),
];
console.log(`Videos (${videos.length})`);
for (const [dir, name] of videos) {
  video(dir, name);
  await videoPoster(dir, name);
}
