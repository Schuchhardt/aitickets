// Función programada (a diario, 12:47 UTC ≈ 09:47 en Chile en verano): solo dispara blog-background con la tarea
// "auto", que decide qué toca hoy (keywords y métricas semanales, un artículo nuevo según BLOG_POSTS_PER_WEEK y un
// refresco semanal). Las funciones programadas mueren a los 30 s; la background tiene 15 min.
// Apagado por defecto: BLOG_ENABLED=true lo activa (gasta créditos de IA). Ver docs/runbooks/blog-seo.md.
import { functionsOrigin, triggerBackground } from '../../lib/outreach/background.mjs'
import { blogScheduleEnabled } from '../../lib/blog/config.mjs'
import { withHeartbeat } from '../../lib/job-heartbeat.mjs'

export default withHeartbeat('blog-tick', async (req) => {
  if (!blogScheduleEnabled()) return Response.json({ skipped: 'disabled (BLOG_ENABLED)' })
  const result = await triggerBackground(functionsOrigin(req), 'blog-background', { task: 'auto' })
  console.log('[blog-tick]', JSON.stringify(result))
  return Response.json(result, { status: result.error ? 500 : 200 })
})

export const config = {
  schedule: '47 12 * * *',
}
