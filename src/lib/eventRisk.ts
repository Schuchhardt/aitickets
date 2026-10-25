// Re-exporta el score de riesgo por evento (fuente única: netlify/lib/event-risk.mjs) con tipos para Astro/TS.
import {
  scoreEventRisk as scoreEventRiskJs,
  loadEventRiskInput as loadEventRiskInputJs,
  refreshEventRisk as refreshEventRiskJs,
  RISK_SIGNAL_LABELS as RISK_SIGNAL_LABELS_JS,
  RISK_LEVEL_LABELS as RISK_LEVEL_LABELS_JS,
  RESERVE_BY_LEVEL as RESERVE_BY_LEVEL_JS,
  LARGE_CAPACITY as LARGE_CAPACITY_JS,
} from '../../netlify/lib/event-risk.mjs'

export type RiskLevel = 'low' | 'medium' | 'high'
export type RiskSignalCode = 'new_producer' | 'no_address' | 'large_capacity' | 'high_amount' | 'sales_spike' | 'shared_buyer' | 'device_cluster'

export interface RiskResult {
  score: number
  level: RiskLevel
  reserve_pct: number
  requires_documents: boolean
  signals: { code: RiskSignalCode; label: string; points: number }[]
}

export interface RiskRefresh extends RiskResult {
  previous_level: RiskLevel | null
  changed: boolean
  locked: boolean
  persisted: boolean
}

export const scoreEventRisk: (input: Record<string, unknown>) => RiskResult = scoreEventRiskJs as any
export const loadEventRiskInput: (supabase: any, eventId: number, opts?: { now?: Date; deviceCluster?: boolean }) => Promise<Record<string, unknown> | null> =
  loadEventRiskInputJs as any
export const refreshEventRisk: (supabase: any, eventId: number, opts?: { now?: Date; deviceCluster?: boolean }) => Promise<RiskRefresh | null> =
  refreshEventRiskJs as any
export const RISK_SIGNAL_LABELS: Record<RiskSignalCode, string> = RISK_SIGNAL_LABELS_JS
export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = RISK_LEVEL_LABELS_JS
export const RESERVE_BY_LEVEL: Record<RiskLevel, number> = RESERVE_BY_LEVEL_JS
export const LARGE_CAPACITY: number = LARGE_CAPACITY_JS
