// Invitación a sumarse al equipo de una productora en AI Tickets (link /invitacion/<token>, 7 días).
import { h, str, EmailLayout, Title, Paragraph, PrimaryButton, FallbackLink, Panel, renderEmail } from './layout.mjs'

const oneLine = (v) => str(v).replace(/[\r\n]+/g, ' ').trim()

/**
 * @param {{ orgName?: string, inviterName?: string, roleLabel: string, roleDescription?: string, url: string, expiresIn?: string, name?: string }} opts
 */
export async function renderTeamInvitationEmail({ orgName, inviterName, roleLabel, roleDescription, url, expiresIn = '7 días', name } = {}) {
  const org = oneLine(orgName) || 'Una productora'
  const inviter = oneLine(inviterName)
  const first = oneLine(name).split(/\s+/)[0] || ''
  const subject = `${org.slice(0, 80)} te invitó a su equipo en AI Tickets`
  const element = h(
    EmailLayout,
    {
      preview: `Únete al equipo de ${org} como ${oneLine(roleLabel)}.`,
      footer: { reason: 'Recibes este correo porque un administrador de una productora en AI Tickets te invitó a su equipo.' },
    },
    h(Title, null, first ? `${first}, te invitaron a ${org}` : `Te invitaron a ${org}`),
    h(
      Paragraph,
      { align: 'center', muted: true },
      `${inviter ? `${inviter} te invitó` : 'Te invitaron'} a sumarte al equipo de ${org} en AI Tickets con el rol ${oneLine(roleLabel)}.`
    ),
    roleDescription ? h(Panel, { label: 'Con este rol puedes' }, h(Paragraph, { small: true, style: { margin: 0 } }, oneLine(roleDescription))) : null,
    h(PrimaryButton, { href: url, hint: 'Crearás tu contraseña (o entrarás con tu cuenta) y quedarás dentro del panel.' }, 'Aceptar invitación'),
    h(Paragraph, { small: true, muted: true }, `La invitación vence en ${str(expiresIn)} y sirve una sola vez. Si no esperabas este correo, ignóralo.`),
    h(FallbackLink, { href: url })
  )
  return renderEmail(subject, element)
}
