// Ninguna vista ni módulo puede usar una const/let/class de nivel superior antes de declararla
// ("ReferenceError: Cannot access 'X' before initialization"). Así se cayó /dashboard/finance (oct 2026):
// providerLabel() se llamaba dentro de un .map() antes de `const PROVIDER_LABELS`. Ver scripts/lint-tdz.mjs.
import { describe, expect, it } from 'vitest'
import { collectProjectFiles, findTdzProblems, formatProblem } from '../../scripts/lint-tdz.mjs'

const check = (path, text) => findTdzProblems([{ path, text }]).map((p) => p.name)

describe('detector de uso antes de la declaración', () => {
  it('detecta el caso de /dashboard/finance (función elevada llamada dentro de .map)', () => {
    const page = `---
const orders = [{ payment_provider: "flow" }];
const transactions = orders.map((o) => ({ provider: providerLabel(o.payment_provider) }));
const PROVIDER_LABELS = { flow: "Webpay" };
function providerLabel(p) { return PROVIDER_LABELS[p] || p; }
---
<p>{transactions.length}</p>`
    const [problem] = findTdzProblems([{ path: 'src/pages/x.astro', text: page }])
    expect(problem).toMatchObject({ name: 'PROVIDER_LABELS', line: 3, declLine: 4, via: ['providerLabel'] })
  })

  it('detecta usos directos, en bloques, en forEach, en IIFEs, en cadenas de llamadas y en clases', () => {
    expect(check('a.ts', 'console.log(X);\nconst X = 1;')).toEqual(['X'])
    expect(check('a.ts', 'if (true) { for (const i of [1]) total += i; }\nlet total = 0;')).toEqual(['total'])
    // `use` (const) tampoco está iniciada todavía: se reportan las dos
    expect(check('a.ts', '[1].forEach(() => use());\nconst use = () => Y;\nconst Y = 2;').sort()).toEqual(['Y', 'use'])
    expect(check('a.ts', '(() => Z)();\nconst Z = 3;')).toEqual(['Z'])
    expect(check('a.ts', 'a();\nfunction a() { return b(); }\nfunction b() { return W; }\nconst W = 1;')).toEqual(['W'])
    expect(check('a.ts', 'new Foo();\nclass Foo {}')).toEqual(['Foo'])
    expect(check('a.ts', 'const xs = [1].map(() => xs);')).toEqual(['xs'])
    expect(check('a.ts', 'const r = [1].map(fmt);\nfunction fmt() { return K; }\nconst K = 1;')).toEqual(['K'])
  })

  it('revisa el <script setup> de los componentes Vue', () => {
    const sfc = `<template><p>{{ label }}</p></template>
<script setup>
const label = format(1);
const PREFIX = "$";
function format(n) { return PREFIX + n; }
</script>`
    expect(findTdzProblems([{ path: 'src/components/X.vue', text: sfc }])).toMatchObject([{ name: 'PREFIX', line: 3 }])
  })

  it('no marca usos válidos', () => {
    // declarada antes
    expect(check('a.ts', 'const A = 1;\nconsole.log(A);')).toEqual([])
    // función que se llama después de la declaración
    expect(check('a.ts', 'function f() { return B; }\nconst B = 1;\nf();')).toEqual([])
    // callbacks diferidos (hooks de Vue, eventos, timers)
    expect(check('a.ts', 'onMounted(() => load());\nconst load = () => C;\nconst C = 1;')).toEqual([])
    expect(check('a.ts', 'el.addEventListener("click", () => D);\nconst D = 1;')).toEqual([])
    expect(check('a.ts', 'setTimeout(() => E, 0);\nconst E = 1;')).toEqual([])
    // pasar una función declarada como valor no la ejecuta
    expect(check('a.ts', 'onMounted(load);\nfunction load() { return F; }\nconst F = 1;')).toEqual([])
    // variables locales que sombrean a una global
    expect(check('a.ts', '[1].map((G) => G);\nconst G = 1;')).toEqual([])
    expect(check('a.ts', 'run();\nfunction run() { const H = 2; return H; }\nconst H = 1;')).toEqual([])
    // tipos y propiedades con el mismo nombre
    expect(check('a.ts', 'let t: Tx;\nobj.I = 1;\nconst x = { I: 1 };\ntype Tx = { a: 1 };\nconst I = 1;')).toEqual([])
    // el template de .astro corre después del frontmatter
    expect(check('src/pages/y.astro', '---\nconst J = 1;\n---\n<p>{J}</p>')).toEqual([])
  })
})

describe('código del proyecto', () => {
  it('ninguna vista (.astro, .vue) ni módulo usa variables antes de declararlas', () => {
    const files = collectProjectFiles()
    expect(files.some((f) => f.path.endsWith('dashboard/finance/index.astro'))).toBe(true)
    const problems = findTdzProblems(files).map(formatProblem)
    expect(problems, problems.join('\n')).toEqual([])
  })
})
