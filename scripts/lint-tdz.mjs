#!/usr/bin/env node
// Detecta usos de `const`/`let`/`class` de nivel superior ANTES de su declaración (zona muerta temporal,
// "ReferenceError: Cannot access 'X' before initialization"). Revisa el frontmatter de las páginas .astro,
// los <script> de los .vue y los módulos .ts/.mjs/.js de src/ y netlify/.
//
// TypeScript ya avisa el caso directo (`usar(X); const X = 1`), pero no el que tumbó /dashboard/finance:
// una función declarada (que se "eleva") llamada antes de la constante que lee, dentro de un `.map()`:
//
//   transactions = orders.map((o) => providerLabel(o.payment_provider)); // ← corre aquí
//   const PROVIDER_LABELS = { ... };
//   function providerLabel(p) { return PROVIDER_LABELS[p]; }              // ← lee una constante aún sin iniciar
//
// Regla: se recorre cada sentencia de nivel superior en orden. Cuenta como ejecutado "ahora" todo lo que no
// está dentro de una función, más el cuerpo de las funciones que se invocan ahí mismo: llamadas directas
// (`f()`), IIFEs y callbacks de métodos síncronos (`map`, `forEach`, `filter`, `reduce`, `sort`, ...).
// Los callbacks diferidos (`onMounted(() => ...)`, `addEventListener`, `setTimeout`) no cuentan.
// Los nombres se resuelven con el type checker, así que una variable local que sombrea a una global no
// genera falsos positivos.
//
// Uso: node scripts/lint-tdz.mjs   (sale con código 1 si encuentra algo)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_DIRS = ["src", "netlify"];
const EXTENSIONS = [".astro", ".vue", ".ts", ".tsx", ".mjs", ".js"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".netlify", ".astro"]);

// Métodos que ejecutan su callback de forma síncrona, antes de devolver
const SYNC_CALLBACK_METHODS = new Set([
  "map", "forEach", "filter", "reduce", "reduceRight", "find", "findIndex", "findLast", "findLastIndex",
  "some", "every", "sort", "toSorted", "flatMap", "from", "replace", "replaceAll",
]);

/** Extrae los bloques de código ejecutable de un archivo: [{ code, offset }] (offset = posición en el original). */
export function extractBlocks(filePath, text) {
  if (filePath.endsWith(".astro")) {
    const m = /^(\s*---\r?\n)([\s\S]*?)\r?\n---/.exec(text);
    return m ? [{ code: m[2], offset: m[1].length }] : [];
  }
  if (filePath.endsWith(".vue")) {
    const blocks = [];
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(text))) blocks.push({ code: m[1], offset: m.index + m[0].indexOf(">") + 1 });
    return blocks;
  }
  return [{ code: text, offset: 0 }];
}

function isFunctionLike(node) {
  return (
    ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) || ts.isClassStaticBlockDeclaration(node)
  );
}

function bindingNames(name, out = []) {
  if (ts.isIdentifier(name)) out.push(name);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
  return out;
}

const unwrap = (e) => {
  while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e) || ts.isNonNullExpression(e)))
    e = e.expression;
  return e;
};

function analyzeSource(sf, checker) {
  const statements = sf.statements;
  // símbolo → { index de la sentencia que lo declara, nombre, nodo }
  const tdzBindings = new Map();
  // símbolo → nodo función (declaración elevada, o const = () => ... / function () {})
  const functions = new Map();
  const declNameNodes = new Set();

  statements.forEach((st, index) => {
    if (ts.isVariableStatement(st) && st.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) {
      for (const d of st.declarationList.declarations) {
        for (const id of bindingNames(d.name)) {
          const sym = checker.getSymbolAtLocation(id);
          declNameNodes.add(id);
          if (sym) tdzBindings.set(sym, { index, name: id.text, node: id });
        }
        const init = unwrap(d.initializer);
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          const sym = checker.getSymbolAtLocation(d.name);
          if (sym) functions.set(sym, init);
        }
      }
    } else if (ts.isClassDeclaration(st) && st.name) {
      const sym = checker.getSymbolAtLocation(st.name);
      declNameNodes.add(st.name);
      if (sym) tdzBindings.set(sym, { index, name: st.name.text, node: st.name });
    } else if (ts.isFunctionDeclaration(st) && st.name && st.body) {
      const sym = checker.getSymbolAtLocation(st.name);
      declNameNodes.add(st.name);
      if (sym) functions.set(sym, st);
    }
  });
  if (tdzBindings.size === 0) return [];

  const symbolOf = (id) => {
    const parent = id.parent;
    if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === id)
      return checker.getShorthandAssignmentValueSymbol(parent);
    return checker.getSymbolAtLocation(id);
  };

  // Referencias "inmediatas" de un nodo: [{ sym, at (nodo donde se usa), via: [nombres de funciones] }]
  const bodyCache = new Map();
  function collect(node, out, via, visiting) {
    const visit = (n) => {
      if (ts.isTypeNode(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return;
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
      if (isFunctionLike(n)) return; // diferido salvo que se invoque (ver CallExpression)
      if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
        // solo `extends` y los inicializadores static se evalúan al declarar la clase
        n.heritageClauses?.forEach(visit);
        for (const m of n.members)
          if (ts.isPropertyDeclaration(m) && m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) && m.initializer)
            visit(m.initializer);
        return;
      }
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const callee = unwrap(n.expression);
        if (callee && (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee))) {
          collectFunctionBody(callee, out, via, visiting, n); // IIFE
        } else if (callee && ts.isIdentifier(callee)) {
          const fn = functions.get(symbolOf(callee));
          if (fn) collectFunctionBody(fn, out, [...via, callee.text], visiting, n);
        }
        const method = callee && ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
        const syncCallbacks = (method && SYNC_CALLBACK_METHODS.has(method)) || (ts.isNewExpression(n) && ts.isIdentifier(callee) && callee.text === "Promise");
        if (syncCallbacks) {
          for (const arg of n.arguments || []) {
            const a = unwrap(arg);
            if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) collectFunctionBody(a, out, via, visiting, n);
            else if (ts.isIdentifier(a)) {
              const fn = functions.get(symbolOf(a));
              if (fn) collectFunctionBody(fn, out, [...via, a.text], visiting, n);
            }
          }
        }
      }
      if (ts.isIdentifier(n) && !declNameNodes.has(n)) {
        const sym = symbolOf(n);
        if (sym && tdzBindings.has(sym)) out.push({ sym, at: n, site: n, via });
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  }
  // `site`: el nodo de la sentencia de nivel superior donde se ejecuta la llamada (lo que se reporta)
  function collectFunctionBody(fn, out, via, visiting, site) {
    if (visiting.has(fn)) return;
    visiting.add(fn);
    const key = fn;
    if (via.length === 0 || !bodyCache.has(key)) {
      const refs = [];
      fn.parameters?.forEach((p) => p.initializer && collect(p.initializer, refs, [], visiting));
      if (fn.body) collect(fn.body, refs, [], visiting);
      if (via.length > 0) bodyCache.set(key, refs);
      for (const r of refs) out.push({ ...r, site, via: [...via, ...r.via] });
    } else {
      for (const r of bodyCache.get(key)) out.push({ ...r, site, via: [...via, ...r.via] });
    }
    visiting.delete(fn);
  }

  const problems = [];
  statements.forEach((st, index) => {
    if (ts.isFunctionDeclaration(st)) return;
    const refs = [];
    collect(st, refs, [], new Set());
    for (const r of refs) {
      const decl = tdzBindings.get(r.sym);
      if (decl.index < index) continue;
      // misma sentencia: solo es error si el uso ocurre antes de terminar el inicializador de esa
      // declaración (p. ej. `const x = lista.map(() => x)`), no en otra declaración posterior del mismo `const a, b`
      if (decl.index === index && r.site.pos > decl.node.parent.end) continue;
      problems.push({ name: decl.name, usePos: r.site.getStart(sf), declPos: decl.node.getStart(sf), via: r.via });
    }
  });
  // un problema por (nombre, uso)
  const seen = new Set();
  return problems.filter((p) => {
    const k = `${p.name}:${p.usePos}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Analiza un conjunto de archivos { path, text }. Devuelve [{ file, line, name, declLine, via }]. */
export function findTdzProblems(files) {
  const virtual = new Map(); // nombre virtual → { file, text, offset, code }
  for (const { path, text } of files) {
    extractBlocks(path, text).forEach((b, i) => {
      const ext = path.endsWith(".astro") || path.endsWith(".vue") ? `.${i}.ts` : "";
      const vname = `/__tdz__/${path}${ext}`;
      virtual.set(vname, { file: path, text, offset: b.offset, code: b.code });
    });
  }
  const options = { noLib: true, noResolve: true, allowJs: true, checkJs: false, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, types: [] };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name, lang) => {
    const v = virtual.get(name);
    return v ? ts.createSourceFile(name, v.code, lang, true, name.endsWith(".js") || name.endsWith(".mjs") ? ts.ScriptKind.JS : name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS) : undefined;
  };
  host.fileExists = (name) => virtual.has(name);
  host.readFile = (name) => virtual.get(name)?.code;
  const program = ts.createProgram([...virtual.keys()], options, host);
  const checker = program.getTypeChecker();

  const lineOf = (text, pos) => text.slice(0, pos).split("\n").length;
  const results = [];
  for (const [vname, v] of virtual) {
    const sf = program.getSourceFile(vname);
    if (!sf) continue;
    for (const p of analyzeSource(sf, checker)) {
      results.push({
        file: v.file,
        line: lineOf(v.text, v.offset + p.usePos),
        declLine: lineOf(v.text, v.offset + p.declPos),
        name: p.name,
        via: p.via,
      });
    }
  }
  return results;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((e) => entry.endsWith(e)) && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

export function collectProjectFiles(dirs = DEFAULT_DIRS) {
  return dirs.flatMap((d) => walk(join(ROOT, d))).map((full) => ({ path: relative(ROOT, full), text: readFileSync(full, "utf8") }));
}

export function formatProblem(p) {
  const via = p.via.length ? ` (a través de ${p.via.map((f) => `${f}()`).join(" → ")})` : "";
  return `${p.file}:${p.line}  '${p.name}' se usa antes de su declaración (línea ${p.declLine})${via}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = findTdzProblems(collectProjectFiles());
  if (problems.length) {
    console.error(`Uso antes de la declaración (ReferenceError en ejecución):\n${problems.map(formatProblem).join("\n")}`);
    process.exit(1);
  }
  console.log("Sin usos antes de la declaración.");
}
