// Eval del clasificador de respuestas con Claude (opt-in, cuesta tokens):
//   RUN_LLM_EVALS=1 ANTHROPIC_API_KEY=... npm run test:unit -- classify-eval
// Sin esas dos variables el test se omite (npm run test:unit nunca llama a la red).
// Usa tests/fixtures/replies.json. Nunca envía correos: solo clasifica.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { counterRpc, createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const ENABLED = process.env.RUN_LLM_EVALS === '1' && Boolean(process.env.ANTHROPIC_API_KEY)
const { replies } = JSON.parse(readFileSync(new URL('../fixtures/replies.json', import.meta.url), 'utf8'))

// Intenciones que llevan a la misma acción en handleIntent (una confusión entre ellas no cambia el resultado)
const ACTION = {
  unsubscribe: 'suppress', not_interested: 'suppress', hostile: 'suppress',
  interested: 'interested', question: 'human', not_now: 'not_now',
  out_of_office: 'reschedule', auto_other: 'ignore', wrong_person: 'lost', referral: 'lost',
}

describe.skipIf(!ENABLED)('eval del clasificador (Claude)', () => {
  it('clasifica las respuestas etiquetadas con precisión suficiente', { timeout: 600_000 }, async () => {
    vi.stubEnv('OUTREACH_ENABLED', 'true')
    vi.stubEnv('OUTREACH_LLM_TOKENS_PER_RUN', '400000')
    const { classifyReply } = await import('../../netlify/lib/outreach/classify.mjs')
    const { createRunBudget } = await import('../../netlify/lib/outreach/llm.mjs')
    const supabase = createFakeSupabase({ rpc: counterRpc() })
    const budget = createRunBudget()

    const rows = []
    for (const r of replies) {
      const res = await classifyReply({ supabase, budget, text: r.text })
      rows.push({ text: r.text.slice(0, 60), expected: r.intent, got: res.intent, via: res.via, confidence: res.confidence })
    }
    console.info(rows.filter((x) => x.expected !== x.got))

    const exact = rows.filter((x) => x.expected === x.got).length / rows.length
    const sameAction = rows.filter((x) => ACTION[x.expected] === ACTION[x.got]).length / rows.length
    // Ninguna baja puede quedar sin suprimir, y ningún interesado puede quedar suprimido
    const missedUnsub = rows.filter((x) => ACTION[x.expected] === 'suppress' && ACTION[x.got] !== 'suppress' && x.expected === 'unsubscribe')
    const suppressedInterested = rows.filter((x) => x.expected === 'interested' && ACTION[x.got] === 'suppress')
    expect(missedUnsub).toEqual([])
    expect(suppressedInterested).toEqual([])
    expect(sameAction).toBeGreaterThanOrEqual(0.85)
    expect(exact).toBeGreaterThanOrEqual(0.75)
  })
})
