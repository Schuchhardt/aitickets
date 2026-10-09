// Cliente Supabase falso, en memoria, para tests unitarios (sin red ni BD).
//
// Soporta el subconjunto del query builder de supabase-js que usa el código de AI Tickets:
//   from(t).select(cols, {count, head}).eq/neq/is/in/not/ilike/gt/gte/lt/lte/order/limit
//          .maybeSingle()/.single()  |  insert(rows)  |  update(patch)  |  upsert(row, {onConflict})  |  delete()
//   rpc(name, args)
// Las columnas de select se ignoran (devuelve filas completas). `.or()` no se soporta (lanza) para que
// un test no pase en falso con un filtro que no se aplicó.
//
// Uso:
//   const db = createFakeSupabase({ tables: { aitickets_suppressions: [{ id: 1, email: 'a@b.cl' }] },
//                                   rpc: { aitickets_outreach_bump_counter: ({ p_delta }) => p_delta } })
//   db.tables.aitickets_suppressions  // filas actuales
//   db.calls                          // [{ table, op, values, filters }] para asserts
//   db.failOn('organizations', 'select', { code: '42P01', message: 'no existe' })  // inyectar errores
//   createFakeSupabase({ unique: { aitickets_api_idempotency: [['organization_id', 'tool', 'idem_key']] } })  // 23505 en INSERT

function likeToRegex(pattern) {
  let re = ''
  const s = String(pattern)
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      re += s[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      i++
    } else if (c === '%') re += '.*'
    else if (c === '_') re += '.'
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

function parseInList(value) {
  if (Array.isArray(value)) return value
  return String(value).replace(/^\(|\)$/g, '').split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
}

const loose = (a, b) => (a === null || a === undefined || b === null || b === undefined ? a === b : String(a) === String(b))

function matches(row, f) {
  const v = row[f.col]
  switch (f.op) {
    case 'eq': return loose(v, f.value)
    case 'neq': return !loose(v, f.value)
    case 'is': return f.value === null ? v === null || v === undefined : v === f.value
    case 'in': return parseInList(f.value).some((x) => loose(v, x))
    case 'not_in': return !parseInList(f.value).some((x) => loose(v, x))
    case 'not_is': return f.value === null ? v !== null && v !== undefined : v !== f.value
    case 'not_eq': return !loose(v, f.value)
    case 'ilike': return v != null && likeToRegex(f.value).test(String(v))
    case 'gt': return v != null && v > f.value
    case 'gte': return v != null && v >= f.value
    case 'lt': return v != null && v < f.value
    case 'lte': return v != null && v <= f.value
    default: throw new Error(`fake-supabase: filtro no soportado ${f.op}`)
  }
}

export function createFakeSupabase({ tables = {}, rpc = {}, unique = {} } = {}) {
  const state = Object.fromEntries(Object.entries(tables).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]))
  const calls = []
  const failures = []
  let nextId = 1000

  function failureFor(table, op) {
    const i = failures.findIndex((f) => f.table === table && (f.op === op || f.op === '*'))
    if (i < 0) return null
    const f = failures[i]
    if (f.once) failures.splice(i, 1)
    return f.error
  }

  function builder(table) {
    const q = { table, op: 'select', values: null, filters: [], single: null, limit: null, count: null, head: false, returning: false, onConflict: null }

    const api = {
      select(_cols, opts = {}) {
        if (q.op === 'select') {
          q.count = opts.count || null
          q.head = Boolean(opts.head)
        } else q.returning = true
        return api
      },
      insert(values) { q.op = 'insert'; q.values = values; return api },
      update(values, opts = {}) { q.op = 'update'; q.values = values; if (opts.count) q.count = opts.count; return api },
      upsert(values, opts = {}) { q.op = 'upsert'; q.values = values; q.onConflict = opts.onConflict || 'id'; return api },
      delete(opts = {}) { q.op = 'delete'; if (opts.count) q.count = opts.count; return api },
      eq(col, value) { q.filters.push({ col, op: 'eq', value }); return api },
      neq(col, value) { q.filters.push({ col, op: 'neq', value }); return api },
      is(col, value) { q.filters.push({ col, op: 'is', value }); return api },
      in(col, value) { q.filters.push({ col, op: 'in', value }); return api },
      ilike(col, value) { q.filters.push({ col, op: 'ilike', value }); return api },
      gt(col, value) { q.filters.push({ col, op: 'gt', value }); return api },
      gte(col, value) { q.filters.push({ col, op: 'gte', value }); return api },
      lt(col, value) { q.filters.push({ col, op: 'lt', value }); return api },
      lte(col, value) { q.filters.push({ col, op: 'lte', value }); return api },
      not(col, op, value) { q.filters.push({ col, op: `not_${op}`, value }); return api },
      or() { throw new Error('fake-supabase: .or() no está soportado; usa un mock específico') },
      order() { return api },
      range() { return api },
      limit(n) { q.limit = n; return api },
      maybeSingle() { q.single = 'maybe'; return api },
      single() { q.single = 'one'; return api },
      then(resolve, reject) {
        try {
          resolve(execute(q))
        } catch (err) {
          reject(err)
        }
      },
    }
    return api
  }

  function execute(q) {
    calls.push({ table: q.table, op: q.op, values: q.values, filters: q.filters.map((f) => ({ ...f })) })
    const error = failureFor(q.table, q.op)
    if (error) return { data: null, error, count: null }
    const rows = (state[q.table] ||= [])
    const filtered = () => rows.filter((r) => q.filters.every((f) => matches(r, f)))

    let data
    if (q.op === 'select') {
      data = filtered()
      const count = data.length
      if (q.limit != null) data = data.slice(0, q.limit)
      if (q.head) return { data: null, error: null, count }
      return finish(data.map((r) => ({ ...r })), q, count)
    }
    if (q.op === 'insert' || q.op === 'upsert') {
      const list = (Array.isArray(q.values) ? q.values : [q.values]).map((v) => ({ id: v.id ?? nextId++, ...v }))
      // unique: { tabla: [[col, ...], ...] } => un INSERT que repite esas columnas falla con 23505
      if (q.op === 'insert') {
        for (const cols of unique[q.table] || []) {
          for (const v of list) {
            if (rows.some((r) => cols.every((c) => loose(r[c], v[c])))) {
              return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint (${cols.join(', ')})` }, count: null }
            }
          }
        }
      }
      const out = []
      for (const v of list) {
        const key = q.op === 'upsert' ? q.onConflict : null
        const existing = key ? rows.find((r) => loose(r[key], v[key])) : null
        if (existing) {
          Object.assign(existing, v)
          out.push({ ...existing })
        } else {
          rows.push(v)
          out.push({ ...v })
        }
      }
      return finish(q.returning ? out : null, q, out.length)
    }
    if (q.op === 'update') {
      const hit = filtered()
      for (const r of hit) Object.assign(r, q.values)
      return finish(q.returning ? hit.map((r) => ({ ...r })) : null, q, hit.length)
    }
    if (q.op === 'delete') {
      const hit = filtered()
      state[q.table] = rows.filter((r) => !hit.includes(r))
      return finish(q.returning ? hit : null, q, hit.length)
    }
    throw new Error(`fake-supabase: operación ${q.op}`)
  }

  function finish(data, q, count) {
    if (q.single && Array.isArray(data)) {
      if (q.single === 'one' && data.length !== 1) {
        return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, count }
      }
      return { data: data[0] ?? null, error: null, count }
    }
    return { data, error: null, count: q.count ? count : null }
  }

  return {
    tables: state,
    calls,
    from: (table) => builder(table),
    async rpc(name, args) {
      calls.push({ table: null, op: 'rpc', values: { name, args }, filters: [] })
      const fn = rpc[name]
      if (!fn) return { data: null, error: { code: 'PGRST202', message: `función ${name} no existe` } }
      try {
        return { data: await fn(args, state), error: null }
      } catch (err) {
        return { data: null, error: { code: err.code || 'P0001', message: err.message } }
      }
    },
    /** Hace fallar la próxima (o todas, once:false) operación `op` sobre `table` con `error`. */
    failOn(table, op, error, { once = true } = {}) {
      failures.push({ table, op, error, once })
    },
  }
}

/** Contador en aitickets_outreach_state compatible con guardrails.readCounter/bumpCounter. */
export function counterRpc() {
  return {
    aitickets_outreach_bump_counter: ({ p_key, p_delta }, state) => {
      const rows = (state.aitickets_outreach_state ||= [])
      let row = rows.find((r) => r.key === p_key)
      if (!row) {
        row = { key: p_key, value: { count: 0 } }
        rows.push(row)
      }
      row.value = { count: (Number(row.value?.count) || 0) + Number(p_delta || 0) }
      return row.value.count
    },
  }
}
