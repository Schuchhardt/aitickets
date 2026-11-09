// Matriz de roles × páginas del panel con la base real local: cada rol del equipo inicia sesión y se verifica a dónde
// llega en cada página (la abre, o el guard lo manda al panel / al validador). Si se agrega una página del panel o se
// cambia quién la puede abrir, este test obliga a declararlo aquí.
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "@playwright/test";
import { ROLES, type Role, addMember, createEvent, createOrganization, login } from "./helpers";

const ALL: Role[] = [...ROLES];
const EMR: Role[] = ["producer", "admin", "editor"];
const OAR: Role[] = ["producer", "admin"];
const CHECKIN: Role[] = ["producer", "admin", "editor", "validator"];

/** Página → roles que la pueden abrir (src/pages/dashboard/**, src/pages/validador/**; guard en dashboard/_lib/guard.ts). */
const PAGES: Record<string, Role[]> = {
  "/dashboard": ALL,
  "/dashboard/profile": ALL,
  "/dashboard/community": EMR,
  "/dashboard/descuentos": EMR,
  "/dashboard/events": ALL,
  "/dashboard/events/create": EMR,
  "/dashboard/events/:id": EMR,
  "/dashboard/events/:id/edit": EMR,
  "/dashboard/events/:id/analytics": EMR,
  // Borderó: finance.read (neto al productor); marketing no, finanzas sí
  "/dashboard/events/:id/bordero": [...OAR, "finance"],
  "/dashboard/events/:id/checkin": CHECKIN,
  "/dashboard/finance": [...OAR, "finance"],
  "/dashboard/ia": ALL,
  "/dashboard/promote": EMR,
  "/dashboard/promote/create": EMR,
  "/dashboard/promote/ads": ALL,
  "/dashboard/promote/ads/create": OAR,
  "/dashboard/settings": [...OAR, "finance"],
  "/dashboard/sitio": OAR,
  "/dashboard/team": OAR,
  "/dashboard/tickets": EMR,
  "/validador": CHECKIN,
};

/** Páginas que Puerta (validator) puede abrir del panel; el resto la manda a /validador (validatorMayOpen). */
const VALIDATOR_PANEL = new Set(["/dashboard/profile", "/dashboard/events/:id/checkin"]);

function expectedPath(page: string, role: Role): RegExp {
  const allowed = PAGES[page].includes(role) && (role !== "validator" || !page.startsWith("/dashboard") || VALIDATOR_PANEL.has(page));
  if (allowed) {
    // Redirecciones propias de la página (no del guard):
    // /dashboard/promote/ads es la ruta antigua de anuncios: siempre va a /dashboard/promote?tab=ads, que pide EMR
    if (page === "/dashboard/promote/ads") return EMR.includes(role) ? /^\/dashboard\/promote\/?$/ : /^\/dashboard\/?$/;
    // Crear anuncio exige además los anuncios habilitados (en el stack están apagados): vuelve a la pestaña de anuncios
    if (page === "/dashboard/promote/ads/create") return /^\/dashboard\/promote\/?$/;
    // A Puerta, el check-in de un evento la lleva al validador de ese evento
    if (page === "/dashboard/events/:id/checkin" && role === "validator") return /^\/validador\/[a-z0-9-]+\/?$/;
    return new RegExp(`^${page.replace(":id", "\\d+")}/?$`);
  }
  if (page === "/validador") return /^\/dashboard\/?$/;
  return role === "validator" ? /^\/validador\/?$/ : /^\/dashboard\/?$/;
}

test("cada página del panel está en la matriz de roles", () => {
  const root = "src/pages";
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!name.startsWith("_") && name !== "__e2e") walk(full);
      } else if (name.endsWith(".astro")) {
        const route = "/" + relative(root, full).replace(/\.astro$/, "").replace(/(^|\/)index$/, "").replace(/\[[^\]]+\]/g, ":id");
        pages.push(route.replace(/\/$/, "") || "/");
      }
    }
  };
  walk(join(root, "dashboard"));
  walk(join(root, "validador"));
  // /validador/:id es el escáner de un evento (mismo guard que /validador)
  const undeclared = pages.filter((p) => !(p in PAGES) && p !== "/validador/:id");
  expect(undeclared, `Páginas sin declarar en la matriz de roles: ${undeclared.join(", ")}`).toEqual([]);
});

for (const role of ROLES) {
  test(`rol ${role}: abre solo las páginas que le corresponden`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { orgId, owner } = await createOrganization(`Org roles ${role}`);
    const member = role === "producer" ? owner : await addMember(orgId, role);
    const event = await createEvent(orgId);
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, member.email);

    const results: string[] = [];
    for (const path of Object.keys(PAGES)) {
      const url = path.replace(":id", String(event.id));
      await page.goto(url);
      const final = new URL(page.url()).pathname;
      const want = expectedPath(path, role);
      if (!want.test(final)) results.push(`${path} → ${final} (esperado ${want})`);
    }
    await context.close();
    expect(results, `Rol ${role}: páginas con acceso distinto al declarado`).toEqual([]);
  });
}
