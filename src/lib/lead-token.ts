// Re-exporta los tokens firmados del outreach (netlify/lib/outreach/tokens.mjs) con tipos para Astro.
// Solo para código de servidor: usa node:crypto y secretos de entorno.
import {
  signLeadToken as signLeadTokenJs,
  verifyLeadToken as verifyLeadTokenJs,
  signUnsubToken as signUnsubTokenJs,
  verifyUnsubToken as verifyUnsubTokenJs,
  signApproveToken as signApproveTokenJs,
  verifyApproveToken as verifyApproveTokenJs,
  signInboundConfirmToken as signInboundConfirmTokenJs,
  verifyInboundConfirmToken as verifyInboundConfirmTokenJs,
} from '../../netlify/lib/outreach/tokens.mjs'

export const signLeadToken: (leadId: string) => string = signLeadTokenJs
export const verifyLeadToken: (token: string) => { leadId: string } | null = verifyLeadTokenJs
export const signUnsubToken: (leadId: string, email: string) => string = signUnsubTokenJs
export const verifyUnsubToken: (token: string) => { leadId: string; email: string } | null = verifyUnsubTokenJs
export const signApproveToken: (messageId: string) => string = signApproveTokenJs
export const verifyApproveToken: (token: string) => { messageId: string } | null = verifyApproveTokenJs
export const signInboundConfirmToken: (pendingId: string, email: string) => string = signInboundConfirmTokenJs
export const verifyInboundConfirmToken: (token: string) => { pendingId: string; email: string } | null = verifyInboundConfirmTokenJs
