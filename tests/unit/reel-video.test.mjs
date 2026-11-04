// Reel de respaldo (netlify/lib/reel-video.mjs y la background function social-series-reel-background): tiempos,
// comando de ffmpeg, validación del pedido y el armado completo. Si hay ffmpeg en el sistema, el armado corre de verdad
// (cuadros generados con sharp) y se revisa el MP4 con ffprobe; si no, ese test se salta.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { buildReelFfmpegArgs, FALLBACK_REEL_PREFIX, parseReelJob, reelTimeline, runReelJob } from '../../netlify/lib/reel-video.mjs'

const SUPA = 'https://proj.supabase.co'
const pub = (p) => `${SUPA}/storage/v1/object/public/Events/${p}`
const hasBin = (bin) => { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true } catch { return false } }
const FFMPEG = hasBin('ffmpeg') && hasBin('ffprobe')

describe('tiempos del reel', () => {
  it('cuadros de 3,5 s solapados 0,5 s: 4 cuadros = 12,5 s (entre 3 y 60 s)', () => {
    expect(reelTimeline(4)).toEqual({ frames: 4, total: 12.5, offsets: [3, 6, 9] })
    expect(reelTimeline(1)).toEqual({ frames: 1, total: 3.5, offsets: [] })
    expect(reelTimeline(0).frames).toBe(0)
    expect(reelTimeline(20).frames).toBe(8)
    expect(reelTimeline(8).total).toBeLessThanOrEqual(60)
  })
})

describe('comando de ffmpeg', () => {
  it('una entrada por cuadro, zoom alternado, fundidos encadenados, H.264/AAC con faststart', () => {
    const { args, duration } = buildReelFfmpegArgs({ frames: ['a.jpg', 'b.jpg', 'c.jpg'], out: 'out.mp4' })
    expect(duration).toBe(9.5)
    expect(args.filter((a) => a === '-i').length).toBe(4) // 3 cuadros + silencio
    expect(args).toContain('anullsrc=channel_layout=stereo:sample_rate=44100')
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toContain("z='1+0.1*on/105'")
    expect(graph).toContain("z='1.1-0.1*on/105'")
    expect(graph).toContain('[v0][v1]xfade=transition=fade:duration=0.5:offset=3[x1]')
    expect(graph).toContain('[x1][v2]xfade=transition=fade:duration=0.5:offset=6[x2]')
    expect(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4)).toEqual(['-map', '[x2]', '-map', '[a]'])
    expect(args).toEqual(expect.arrayContaining(['libx264', 'aac', '+faststart', 'yuv420p']))
    expect(args[args.length - 1]).toBe('out.mp4')
  })
  it('con música: la repite hasta el final y la funde al entrar y salir', () => {
    const { args } = buildReelFfmpegArgs({ frames: ['a.jpg', 'b.jpg'], music: 'm.mp3', out: 'o.mp4' })
    expect(args.slice(args.indexOf('-stream_loop'), args.indexOf('-stream_loop') + 4)).toEqual(['-stream_loop', '-1', '-i', 'm.mp3'])
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('afade=t=in:st=0:d=0.6,afade=t=out:st=5.3:d=1.2')
  })
  it('sin cuadros no hay reel', () => {
    expect(() => buildReelFfmpegArgs({ frames: [], out: 'o.mp4' })).toThrow(/al menos un cuadro/)
  })
})

describe('pedido a la background function', () => {
  const ok = { slotIds: [11, 12], frames: [pub('social-series/7/reel-frames/a.jpg')], outPath: `${FALLBACK_REEL_PREFIX}7/2-11-x.mp4` }
  it('acepta un pedido válido', () => {
    expect(parseReelJob(ok, { supabaseUrl: SUPA })).toEqual({ ...ok, musicUrl: null })
  })
  it('rechaza cuadros o música fuera de nuestro Storage, rutas de salida raras y slots inválidos', () => {
    expect(parseReelJob({ ...ok, frames: ['https://evil.example/a.jpg'] }, { supabaseUrl: SUPA }).error).toMatch(/Storage/)
    expect(parseReelJob({ ...ok, frames: [`${SUPA}/storage/v1/object/sign/Events/a.jpg`] }, { supabaseUrl: SUPA }).error).toMatch(/Storage/)
    expect(parseReelJob({ ...ok, musicUrl: 'http://proj.supabase.co/x.mp3' }, { supabaseUrl: SUPA }).error).toMatch(/musicUrl/)
    expect(parseReelJob({ ...ok, outPath: 'covers/2296.mp4' }, { supabaseUrl: SUPA }).error).toMatch(/outPath/)
    expect(parseReelJob({ ...ok, outPath: `${FALLBACK_REEL_PREFIX}../x.mp4` }, { supabaseUrl: SUPA }).error).toMatch(/outPath/)
    expect(parseReelJob({ ...ok, slotIds: [] }, { supabaseUrl: SUPA }).error).toMatch(/slotIds/)
    expect(parseReelJob({ ...ok, frames: Array(9).fill(ok.frames[0]) }, { supabaseUrl: SUPA }).error).toMatch(/frames/)
  })
})

// Supabase mínimo: Storage en memoria y el update de los slots
function fakeSupabase(slots) {
  const stored = new Map()
  const updates = []
  return {
    stored,
    updates,
    storage: { from: () => ({
      upload: async (path, buf, opts) => { stored.set(path, { buf, opts }); return { error: null } },
      getPublicUrl: (path) => ({ data: { publicUrl: pub(path) } }),
    }) },
    from: () => {
      const filters = []
      let patch = null
      const api = {
        update(p) { patch = p; return api },
        in(col, v) { filters.push((r) => v.includes(r[col])); return api },
        eq(col, v) { filters.push((r) => r[col] === v); return api },
        is(col, v) { filters.push((r) => r[col] === v); return api },
        async select() {
          const hit = slots.filter((r) => filters.every((f) => f(r)))
          for (const r of hit) Object.assign(r, patch)
          updates.push(patch)
          return { data: hit.map((r) => ({ id: r.id })), error: null }
        },
      }
      return api
    },
  }
}

describe('armado completo', () => {
  it.skipIf(!FFMPEG)('baja los cuadros, arma el MP4 con ffmpeg (1080×1920, H.264 + AAC, 30 fps), lo sube y lo deja solo en los slots pendientes sin video', async () => {
    const colors = ['#ef4444', '#22c55e', '#3b82f6']
    const files = new Map()
    for (const [i, c] of colors.entries()) files.set(pub(`social-series/7/reel-frames/f${i}.jpg`), await sharp({ create: { width: 1080, height: 1920, channels: 3, background: c } }).jpeg().toBuffer())
    const fetchImpl = async (url) => (files.has(url) ? new Response(files.get(url)) : new Response('no', { status: 404 }))
    const slots = [
      { id: 11, kind: 'reel', status: 'planned', video_url: null },
      { id: 12, kind: 'reel', status: 'planned', video_url: null },
      { id: 13, kind: 'reel', status: 'published', video_url: null },
    ]
    const supabase = fakeSupabase(slots)
    const job = parseReelJob({ slotIds: [11, 12, 13], frames: [...files.keys()], outPath: `${FALLBACK_REEL_PREFIX}7/2-11-x.mp4` }, { supabaseUrl: SUPA })
    const result = await runReelJob(job, { supabase, fetch: fetchImpl, ffmpeg: 'ffmpeg' })
    expect(result).toMatchObject({ url: pub(`${FALLBACK_REEL_PREFIX}7/2-11-x.mp4`), duration: 9.5, updated: [11, 12] })
    expect(slots.map((s) => s.video_url)).toEqual([result.url, result.url, null])
    const saved = supabase.stored.get(`${FALLBACK_REEL_PREFIX}7/2-11-x.mp4`)
    expect(saved.opts.contentType).toBe('video/mp4')
    const dir = mkdtempSync(join(tmpdir(), 'reel-test-'))
    writeFileSync(join(dir, 'r.mp4'), saved.buf)
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate:format=duration', '-of', 'json', join(dir, 'r.mp4')]).toString())
    expect(probe.streams.map((s) => s.codec_name).sort()).toEqual(['aac', 'h264'])
    expect(probe.streams.find((s) => s.codec_name === 'h264')).toMatchObject({ width: 1080, height: 1920, r_frame_rate: '30/1' })
    expect(Number(probe.format.duration)).toBeCloseTo(9.5, 1)
  }, 120_000)

  it('si un cuadro no se puede bajar, falla sin tocar los slots', async () => {
    const slots = [{ id: 11, kind: 'reel', status: 'planned', video_url: null }]
    const supabase = fakeSupabase(slots)
    const job = { slotIds: [11], frames: [pub('x.jpg')], outPath: `${FALLBACK_REEL_PREFIX}7/x.mp4`, musicUrl: null }
    const run = vi.fn()
    await expect(runReelJob(job, { supabase, fetch: async () => new Response('no', { status: 404 }), run, ffmpeg: 'ffmpeg' })).rejects.toThrow(/No se pudo bajar/)
    expect(run).not.toHaveBeenCalled()
    expect(slots[0].video_url).toBeNull()
  })
})

describe('background function social-series-reel-background', () => {
  afterEach(() => { delete process.env.INTERNAL_API_SECRET })
  it('solo llamadas internas y con un pedido válido', async () => {
    process.env.INTERNAL_API_SECRET = 's3cret'
    const { default: handler } = await import('../../netlify/functions/social-series-reel-background/index.mjs')
    const req = (body, secret = 's3cret') => new Request('https://aitickets.cl/.netlify/functions/social-series-reel-background', { method: 'POST', headers: { 'x-internal-secret': secret, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await handler(req({}, 'otro'))).status).toBe(401)
    expect((await handler(new Request('https://aitickets.cl/x', { method: 'GET', headers: { 'x-internal-secret': 's3cret' } }))).status).toBe(401)
    const bad = await handler(req({ slotIds: [1], frames: ['https://evil.example/a.jpg'], outPath: `${FALLBACK_REEL_PREFIX}1/x.mp4` }))
    expect(bad.status).toBe(400)
  })
})
