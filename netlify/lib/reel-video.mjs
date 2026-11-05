// Reel de respaldo de la difusión automática (docs/specs/historias-automaticas.md §9): cuando el reel está activado y
// el evento no tiene un video vertical de 3 a 60 s, AI Tickets arma uno con las imágenes del evento.
//
// Reparto:
//   - El servidor de Astro (src/lib/socialSeries.ts, prepareFallbackReels) renderiza los cuadros con las mismas
//     plantillas de las historias (Satori + sharp: portada con la cuenta regresiva, fotos de la galería y cierre con el
//     llamado), los sube a Storage y llama a la background function social-series-reel-background.
//   - Esa función (hasta 15 min) baja los cuadros, arma el MP4 con ffmpeg (este módulo) y lo deja en el slot
//     (video_url). El job de la serie lo programa en Zernio como cualquier reel, unas 2 h antes de publicar.
//
// Video: 1080×1920, H.264 + AAC, 30 fps. Cada cuadro dura FRAME_SECONDS con un acercamiento lento (Ken Burns;
// alterna acercar y alejar) y fundido de TRANSITION_SECONDS al siguiente. Audio: la pista de
// SOCIAL_SERIES_REEL_MUSIC_URL (biblioteca propia libre de derechos; con fundido de entrada y salida) o silencio.
import { spawn } from 'node:child_process'

export const REEL_SIZE = { width: 1080, height: 1920 }
export const REEL_FPS = 30
export const FRAME_SECONDS = 3.5
export const TRANSITION_SECONDS = 0.5
export const MAX_FRAMES = 8
/** Prefijo en Storage de los reels de respaldo (así se distinguen de un video subido por el productor). */
export const FALLBACK_REEL_PREFIX = 'social-series-reels/'

/** Duración total y el inicio de cada fundido: n cuadros de FRAME_SECONDS, solapados TRANSITION_SECONDS. */
export function reelTimeline(frameCount, { frameSeconds = FRAME_SECONDS, transition = TRANSITION_SECONDS } = {}) {
  const n = Math.max(0, Math.min(MAX_FRAMES, Math.floor(frameCount)))
  if (!n) return { frames: 0, total: 0, offsets: [] }
  const step = frameSeconds - transition
  const offsets = Array.from({ length: n - 1 }, (_, i) => round3((i + 1) * step))
  return { frames: n, total: round3(n * frameSeconds - (n - 1) * transition), offsets }
}
const round3 = (x) => Math.round(x * 1000) / 1000

/**
 * Argumentos de ffmpeg (sin el binario). frames: rutas locales de los JPG/PNG (1080×1920); music: ruta local o null.
 * Cada cuadro entra como una sola imagen y zoompan la convierte en FRAME_SECONDS de video.
 */
export function buildReelFfmpegArgs({ frames, music = null, out, frameSeconds = FRAME_SECONDS, transition = TRANSITION_SECONDS }) {
  const t = reelTimeline(frames.length, { frameSeconds, transition })
  if (t.frames < 1) throw new Error('El reel necesita al menos un cuadro')
  const { width: W, height: H } = REEL_SIZE
  const perFrame = Math.round(frameSeconds * REEL_FPS)
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  for (const f of frames.slice(0, t.frames)) args.push('-i', f)
  const audioIndex = t.frames
  if (music) args.push('-stream_loop', '-1', '-i', music)
  else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')

  const zoom = 0.1
  const parts = []
  for (let i = 0; i < t.frames; i++) {
    // Acercar en los pares, alejar en los impares; la imagen se agranda al doble antes para que el zoom no tiemble
    const z = i % 2 === 0 ? `1+${zoom}*on/${perFrame}` : `${1 + zoom}-${zoom}*on/${perFrame}`
    parts.push(
      `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
        `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${perFrame}:s=${W}x${H}:fps=${REEL_FPS},` +
        `setsar=1,format=yuv420p[v${i}]`,
    )
  }
  let last = 'v0'
  t.offsets.forEach((offset, k) => {
    const next = `x${k + 1}`
    parts.push(`[${last}][v${k + 1}]xfade=transition=fade:duration=${transition}:offset=${offset}[${next}]`)
    last = next
  })
  const fadeOut = Math.max(0, round3(t.total - 1.2))
  parts.push(`[${audioIndex}:a]atrim=0:${t.total},asetpts=N/SR/TB${music ? `,afade=t=in:st=0:d=0.6,afade=t=out:st=${fadeOut}:d=1.2` : ''}[a]`)

  args.push(
    '-filter_complex', parts.join(';'),
    '-map', `[${last}]`, '-map', '[a]',
    '-t', String(t.total),
    '-r', String(REEL_FPS),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    '-movflags', '+faststart',
    out,
  )
  return { args, duration: t.total }
}

/** Corre ffmpeg (binario de ffmpeg-static o el del sistema). Rechaza con el final de stderr si falla. */
export function runFfmpeg(bin, args, { timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000) })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg terminó con ${signal || code}: ${stderr.trim().slice(-600)}`))
    })
  })
}

/** Binario de ffmpeg: ffmpeg-static en Netlify (se instala con npm ci), o FFMPEG_PATH / el del sistema en local. */
export async function ffmpegBinary() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try {
    const mod = await import('ffmpeg-static')
    if (mod?.default) return mod.default
  } catch {
    /* sin ffmpeg-static: el del sistema */
  }
  return 'ffmpeg'
}

const SLOT_TABLE = 'aitickets_social_series_slots'
const MAX_FRAME_BYTES = 12 * 1024 * 1024
const MAX_MUSIC_BYTES = 15 * 1024 * 1024

/** Solo se bajan archivos de nuestro Storage público (los cuadros y la música los sube AI Tickets). */
export function isOwnStorageUrl(url, supabaseUrl = process.env.SUPABASE_URL) {
  try {
    const u = new URL(url)
    const base = new URL(String(supabaseUrl || ''))
    return u.protocol === 'https:' && u.host === base.host && u.pathname.startsWith('/storage/v1/object/public/')
  } catch {
    return false
  }
}

/**
 * Valida el pedido de la background function: { slotIds, frames, outPath, musicUrl? }. Devuelve el pedido limpio o
 * un error (string). outPath siempre bajo FALLBACK_REEL_PREFIX; los cuadros, de nuestro Storage.
 */
export function parseReelJob(body, { supabaseUrl = process.env.SUPABASE_URL } = {}) {
  const slotIds = Array.isArray(body?.slotIds) ? [...new Set(body.slotIds.map(Number))].filter((n) => Number.isSafeInteger(n) && n > 0) : []
  if (!slotIds.length || slotIds.length > 6) return { error: 'slotIds inválidos' }
  const frames = Array.isArray(body?.frames) ? body.frames.map(String) : []
  if (!frames.length || frames.length > MAX_FRAMES) return { error: `frames: entre 1 y ${MAX_FRAMES}` }
  if (!frames.every((f) => isOwnStorageUrl(f, supabaseUrl))) return { error: 'frames fuera de nuestro Storage' }
  const outPath = String(body?.outPath || '')
  if (!outPath.startsWith(FALLBACK_REEL_PREFIX) || !/^[\w./-]+\.mp4$/.test(outPath) || outPath.includes('..')) return { error: 'outPath inválido' }
  const musicUrl = body?.musicUrl ? String(body.musicUrl) : null
  if (musicUrl && !isOwnStorageUrl(musicUrl, supabaseUrl)) return { error: 'musicUrl fuera de nuestro Storage' }
  return { slotIds, frames, outPath, musicUrl }
}

async function download(url, maxBytes, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`No se pudo bajar ${url}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw new Error(`Archivo demasiado grande: ${url}`)
  return buf
}

/**
 * Arma el reel de un pedido ya validado y lo deja en los slots: baja cuadros y música, corre ffmpeg, sube el MP4 al
 * bucket y escribe video_url en los slots que siguen pendientes y sin video. Devuelve { url, duration, updated }.
 * deps: { supabase, bucket, fetch, ffmpeg (bin), run (runFfmpeg), tmpDir }.
 */
export async function runReelJob(job, deps) {
  const { supabase, bucket = 'Events', fetch: fetchImpl = fetch, run = runFfmpeg } = deps
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const os = await import('node:os')
  const dir = await fs.mkdtemp(path.join(deps.tmpDir || os.tmpdir(), 'reel-'))
  try {
    const frames = []
    for (let i = 0; i < job.frames.length; i++) {
      const file = path.join(dir, `frame-${i}.jpg`)
      await fs.writeFile(file, await download(job.frames[i], MAX_FRAME_BYTES, fetchImpl))
      frames.push(file)
    }
    let music = null
    if (job.musicUrl) {
      music = path.join(dir, 'music')
      await fs.writeFile(music, await download(job.musicUrl, MAX_MUSIC_BYTES, fetchImpl))
    }
    const out = path.join(dir, 'reel.mp4')
    const { args, duration } = buildReelFfmpegArgs({ frames, music, out })
    await run(deps.ffmpeg || (await ffmpegBinary()), args)
    const video = await fs.readFile(out)
    const { error: upErr } = await supabase.storage.from(bucket).upload(job.outPath, video, { contentType: 'video/mp4', cacheControl: '31536000', upsert: true })
    if (upErr) throw new Error(`No se pudo guardar el reel: ${upErr.message}`)
    const url = supabase.storage.from(bucket).getPublicUrl(job.outPath).data.publicUrl
    const { data, error } = await supabase
      .from(SLOT_TABLE)
      .update({ video_url: url, error: null, updated_at: new Date().toISOString() })
      .in('id', job.slotIds)
      .eq('kind', 'reel')
      .eq('status', 'planned')
      .is('video_url', null)
      .select('id')
    if (error) throw error
    return { url, duration, bytes: video.length, updated: (data || []).map((r) => Number(r.id)) }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
