// Fotos, video y enlaces de las landings (docs/specs/rediseno/README.md, commit 13): cada foto que usa una página tiene
// sus variantes AVIF/WebP en disco con el ancho y alto declarados (sin saltos de layout), los videos (portada y demo del
// modal) tienen MP4 con el índice al principio y WebM, ninguna sección carga un JPG directo en vez de su <picture>, y
// cada landing por tipo de evento tiene su página, sale en el footer y en el hub de /organizadores (que lee LANDINGS).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { LANDING_MEDIA } from '../../src/components/landing/producerLanding.js'
import { ACADEMY_PHOTOS } from '../../src/components/landing/academias/academiasLanding.js'
import { CLUB_PHOTOS } from '../../src/components/landing/clubs/clubsLanding.js'
import { PARTY_PHOTOS } from '../../src/components/landing/fiestas/fiestasLanding.js'
import { MUSIC_PHOTOS } from '../../src/components/landing/musica/musicaLanding.js'
import { SEMINAR_PHOTOS } from '../../src/components/landing/seminarios/seminariosLanding.js'
import { STANDUP_PHOTOS } from '../../src/components/landing/standup/standupLanding.js'
import { WORKSHOP_PHOTOS } from '../../src/components/landing/talleres/talleresLanding.js'
import { THEATRE_PHOTOS } from '../../src/components/landing/teatro/teatroLanding.js'
import { LANDINGS } from '../../src/data/landings'

const ROOT = process.cwd()
const PUBLIC = join(ROOT, 'public')
const onDisk = (url) => existsSync(join(PUBLIC, url))
/** URLs de un srcset ("/a-640.avif 640w, /a-1024.avif 1024w") con su ancho */
const srcsetEntries = (srcset) =>
  srcset.split(',').map((part) => {
    const [url, w] = part.trim().split(/\s+/)
    return { url, width: Number.parseInt(w, 10) }
  })

const PHOTO_SETS = {
  academias: ACADEMY_PHOTOS,
  clubs: CLUB_PHOTOS,
  fiestas: PARTY_PHOTOS,
  musica: MUSIC_PHOTOS,
  seminarios: SEMINAR_PHOTOS,
  standup: STANDUP_PHOTOS,
  talleres: WORKSHOP_PHOTOS,
  teatro: THEATRE_PHOTOS,
}
const photos = Object.entries(PHOTO_SETS).flatMap(([landing, set]) =>
  Object.entries(set).map(([key, photo]) => [`${landing}.${key}`, photo]),
)

describe('fotos de las landings', () => {
  it.each(photos)('%s: JPG de respaldo con el tamaño declarado y AVIF + WebP en cada ancho', async (_name, photo) => {
    expect(onDisk(photo.src)).toBe(true)
    const meta = await sharp(join(PUBLIC, photo.src)).metadata()
    expect({ width: meta.width, height: meta.height }).toEqual({ width: photo.width, height: photo.height })

    expect(photo.sources.map((s) => s.type)).toEqual(['image/avif', 'image/webp'])
    for (const source of photo.sources) {
      const entries = srcsetEntries(source.srcset)
      expect(entries.length).toBeGreaterThan(0)
      for (const { url, width } of entries) {
        expect(onDisk(url), url).toBe(true)
        expect(url.endsWith(`-${width}.${source.type.split('/')[1]}`)).toBe(true)
        expect(width).toBeLessThanOrEqual(photo.width)
      }
    }
  })

  it('el póster de la portada en video tiene sus variantes', () => {
    expect(onDisk(LANDING_MEDIA.coverPoster)).toBe(true)
    for (const source of LANDING_MEDIA.coverPosterSources) {
      for (const { url } of srcsetEntries(source.srcset)) expect(onDisk(url), url).toBe(true)
    }
  })

  it('ninguna sección pinta un JPG de public/landing directo en un <img> (va el <picture> o la variante)', () => {
    const offenders = landingTemplates().filter((f) => /["'`]\/landing\/[\w-]+\.jpg/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('un <img> con la foto de un objeto (photo.src, t.photo.src...) va dentro de su <picture> con las variantes', () => {
    // Los logos (logo.src) son assets importados en su formato: no llevan variantes
    const offenders = landingTemplates().flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return [...source.matchAll(/<img\b[^>]*?\s:?src=(?:\{([^}]*)\}|"([^"]*)")/g)]
        .filter((m) => {
          const expr = (m[1] ?? m[2] ?? '').trim()
          if (!/\.src$/.test(expr) || /logo/i.test(expr)) return false
          const before = source.slice(0, m.index)
          return before.lastIndexOf('<picture') <= before.lastIndexOf('</picture>')
        })
        .map((m) => `${file.slice(ROOT.length + 1)}: ${m[0].slice(0, 80)}`)
    })
    expect(offenders).toEqual([])
  })
})

/** Plantillas de las landings y páginas (.astro y .vue) */
function landingTemplates() {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(astro|vue)$/.test(entry.name)) files.push(path)
    }
  }
  walk(join(ROOT, 'src', 'components', 'landing'))
  walk(join(ROOT, 'src', 'pages'))
  return files
}

describe('video de portada', () => {
  it('MP4 con el índice al principio (faststart) y WebM del mismo clip', () => {
    expect(LANDING_MEDIA.coverVideo).toMatch(/\.mp4$/)
    expect(LANDING_MEDIA.coverVideoWebm).toBe(LANDING_MEDIA.coverVideo.replace(/\.mp4$/, '.webm'))
    const mp4 = readFileSync(join(PUBLIC, LANDING_MEDIA.coverVideo))
    expect(mp4.indexOf('moov')).toBeGreaterThan(-1)
    expect(mp4.indexOf('moov')).toBeLessThan(mp4.indexOf('mdat'))
    const webm = readFileSync(join(PUBLIC, LANDING_MEDIA.coverVideoWebm))
    // Cabecera EBML de Matroska/WebM
    expect([...webm.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
    // Pesa menos que el MP4 y no pasa de 1,5 MB (SPEC_landing_productores §9)
    expect(webm.length).toBeLessThan(mp4.length)
    expect(mp4.length).toBeLessThanOrEqual(1.5 * 1024 * 1024)
  })

  it('las tres portadas ofrecen el WebM', () => {
    for (const file of [
      'src/components/landing/organizadores/HeroSection.astro',
      'src/components/landing/organizadores/CommunitySection.astro',
      'src/components/landing/standup/StandupHero.astro',
    ]) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      const covers = source.match(/<LandingCoverVideo\b/g)?.length ?? 0
      expect(source.match(/webmSrc=\{LANDING_MEDIA\.coverVideoWebm\}/g)?.length ?? 0, file).toBe(covers)
    }
  })
})

describe('video del modal (demo)', () => {
  it('MP4 con el índice al principio, WebM del mismo clip y póster en WebP', () => {
    expect(LANDING_MEDIA.demoVideoWebm).toBe(LANDING_MEDIA.demoVideo.replace(/\.mp4$/, '.webm'))
    const mp4 = readFileSync(join(PUBLIC, LANDING_MEDIA.demoVideo))
    expect(mp4.indexOf('moov')).toBeLessThan(mp4.indexOf('mdat'))
    const webm = readFileSync(join(PUBLIC, LANDING_MEDIA.demoVideoWebm))
    expect([...webm.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
    expect(webm.length).toBeLessThan(mp4.length)
    expect(LANDING_MEDIA.demoPoster).toMatch(/\.webp$/)
    expect(onDisk(LANDING_MEDIA.demoPoster)).toBe(true)
  })

  it('/organizadores y stand-up le pasan el WebM y miden el avance', () => {
    for (const [file, progress] of [
      ['src/pages/organizadores/index.astro', 'lp_video_progress'],
      ['src/pages/ticketera-stand-up.astro', 'su_video_progress'],
    ]) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      expect(source, file).toContain('webmSrc={LANDING_MEDIA.demoVideoWebm}')
      expect(source, file).toContain(`progressEvent="${progress}"`)
    }
  })
})

describe('enlaces a las landings por tipo de evento', () => {
  const verticals = LANDINGS.filter((l) => l.kind === 'vertical')
  const footer = readFileSync(join(ROOT, 'src/components/AppFooter.vue'), 'utf8')

  it('están todas las de nicho (música, teatro, talleres, clubs, fiestas, seminarios, stand-up y academias)', () => {
    expect(verticals.map((l) => l.slug).sort()).toEqual(
      [
        'academias',
        'ticketera-discotecas',
        'ticketera-fiestas',
        'ticketera-musica-en-vivo',
        'ticketera-seminarios',
        'ticketera-stand-up',
        'ticketera-talleres',
        'ticketera-teatro',
      ].sort(),
    )
  })

  it.each(verticals.map((l) => [l.slug, l]))('%s: página propia, en el footer y con datos para la tarjeta del hub', (slug, landing) => {
    expect(landing.dedicated).toBe(true)
    expect(existsSync(join(ROOT, 'src/pages', `${slug}.astro`))).toBe(true)
    expect(footer).toContain(`href: "/${slug}"`)
    expect(landing.card.title.length).toBeGreaterThan(0)
    expect(landing.title).toMatch(/\| AI Tickets$/)
    expect(landing.description.length).toBeGreaterThan(80)
    expect(landing.description.length).toBeLessThanOrEqual(260)
  })

  it('el hub de /organizadores lista las verticales desde LANDINGS', () => {
    const extras = readFileSync(join(ROOT, 'src/components/landing/organizadores/ExtrasSection.astro'), 'utf8')
    expect(extras).toMatch(/LANDINGS\.filter\(\(l\) => l\.kind === "vertical"\)/)
  })
})
