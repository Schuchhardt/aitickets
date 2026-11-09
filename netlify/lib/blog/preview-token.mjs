// Link firmado para ver un borrador del blog (/blog/vista-previa/<id>?t=…) antes de publicarlo. Lo entrega
// get_blog_post del MCP de admin; vence a los 14 días y solo sirve para ese artículo.
import { tokenSigner } from '../signed-token.mjs'

const { sign, verify } = tokenSigner('aitickets-blog-preview', ['BLOG_PREVIEW_SECRET', 'INTERNAL_API_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'])
const PURPOSE = 'blog-preview'
const TTL_SECONDS = 14 * 86400

export function signBlogPreview(postId, now = new Date()) {
  return sign({ p: PURPOSE, id: Number(postId), x: Math.floor(now.getTime() / 1000) + TTL_SECONDS })
}

/** id del artículo si el token es válido y no venció; si no, null. */
export function verifyBlogPreview(token, now = new Date()) {
  const payload = verify(token, PURPOSE, now)
  return payload && Number.isSafeInteger(payload.id) && payload.id > 0 ? payload.id : null
}
