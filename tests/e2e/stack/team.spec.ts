// Equipo de la organización de punta a punta con la base real local: el dueño invita desde el panel, la persona acepta
// el link del correo y queda en la organización con su rol. Cubre los casos del bug de "agregar miembro" (orgs 45-49):
// cuentas nuevas, usuarios sin organización (huérfanos), correos de otra organización y miembros que nunca entraron.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PASSWORD, addMember, newPassword, createAuthUser, createOrganization, login, pathOf, sql, uniqueEmail, waitForMailLink } from "./helpers";

const INVITE_LINK = /https?:\/\/[^\s"'<>]+\/invitacion\/aitinv_[A-Za-z0-9_-]+/;
const INVITE_SUBJECT = /te invitó a su equipo/;

test.beforeEach(({ page }) => {
  page.on("dialog", (d) => d.accept());
});

async function acceptInvitation(browser: Browser, link: string, { name, password = PASSWORD }: { name?: string; password?: string } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(pathOf(link));
  if (name) await page.locator("#name").fill(name);
  await page.locator("#password").fill(password);
  await page.locator("#accept-submit").click();
  return { context, page };
}

async function inviteFromPanel(page: Page, { name, email, role }: { name: string; email: string; role: string }) {
  await page.goto("/dashboard/team");
  await page.locator("#openModalBtn").click();
  const form = page.locator("#addMemberForm");
  await form.locator('input[name="name"]').fill(name);
  await form.locator('input[name="email"]').fill(email);
  await form.locator('select[name="role"]').selectOption(role);
  await form.locator("#submitBtn").click();
  await expect(page.locator("#formMessage")).toContainText("¡Invitación enviada!");
}

test("el dueño invita a Puerta desde el panel; con una cuenta nueva queda en el validador", async ({ page, browser }) => {
  const { orgId, owner } = await createOrganization("Escuela E2E");
  const email = uniqueEmail("puerta");
  await login(page, owner.email);
  await inviteFromPanel(page, { name: "Romy Puerta", email, role: "validator" });

  const [inv] = await sql(`SELECT role, accepted_at, revoked_at, email_sent_at FROM public.aitickets_team_invitations WHERE organization_id = $1 AND email = $2`, [orgId, email]);
  expect(inv).toMatchObject({ role: "validator", accepted_at: null, revoked_at: null });
  expect(inv.email_sent_at).toBeTruthy();

  const { link } = await waitForMailLink(email, INVITE_SUBJECT, INVITE_LINK);
  const invitee = await acceptInvitation(browser, link, { name: "Romy Puerta" });
  await expect(invitee.page).toHaveURL(/\/validador/);

  const rows = await sql(`SELECT id, organization_id, role, active FROM public.users WHERE lower(email) = lower($1)`, [email]);
  expect(rows).toEqual([expect.objectContaining({ organization_id: String(orgId), role: "validator", active: true })]);
  const [accepted] = await sql(`SELECT accepted_at, accepted_user_id FROM public.aitickets_team_invitations WHERE organization_id = $1 AND email = $2`, [orgId, email]);
  expect(accepted.accepted_at).toBeTruthy();
  expect(String(accepted.accepted_user_id)).toBe(String(rows[0].id));

  // Puerta solo usa el validador: el panel de equipo la manda de vuelta
  await invitee.page.goto("/dashboard/team");
  await expect(invitee.page).toHaveURL(/\/validador/);
  await invitee.context.close();

  // El dueño la ve en el equipo
  await page.goto("/dashboard/team");
  await expect(page.locator(".member-row", { hasText: email })).toContainText("Puerta");
});

test("un usuario sin organización (huérfano) invitado crea su contraseña y queda vinculado", async ({ page, browser }) => {
  const { orgId, owner } = await createOrganization();
  const email = uniqueEmail("huerfano");
  const orphanPassword = newPassword();
  const auth = await createAuthUser(email, { name: "Huérfana E2E" });
  const [orphan] = await sql(`SELECT id, organization_id, role FROM public.users WHERE auth_user_id = $1`, [auth.id]);
  expect(orphan).toMatchObject({ organization_id: null, role: null }); // lo deja así handle_new_user

  await login(page, owner.email);
  const res = await page.request.post("/api/team/invitations", { data: { email, role: "viewer" } });
  expect(res.status(), await res.text()).toBe(200);

  const { link } = await waitForMailLink(email, INVITE_SUBJECT, INVITE_LINK);
  const invitee = await acceptInvitation(browser, link, { name: "Huérfana E2E", password: orphanPassword });
  await expect(invitee.page).toHaveURL(/\/dashboard/);
  await invitee.context.close();

  const rows = await sql(`SELECT id, organization_id, role FROM public.users WHERE lower(email) = lower($1)`, [email]);
  expect(rows).toEqual([expect.objectContaining({ id: orphan.id, organization_id: String(orgId), role: "viewer" })]);
  const fresh = await page.context().browser()!.newContext();
  await login(fresh.request, email, orphanPassword);
  await fresh.close();
});

test("un correo de otra organización no se puede invitar ni crea nada", async ({ page }) => {
  const other = await createOrganization("Otra productora");
  const outsider = await addMember(other.orgId, "admin");
  const { orgId, owner } = await createOrganization();
  await login(page, owner.email);

  const res = await page.request.post("/api/team/invitations", { data: { email: outsider.email, role: "viewer" } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error.message).toMatch(/otra organización/);
  expect(await sql(`SELECT id FROM public.aitickets_team_invitations WHERE organization_id = $1`, [orgId])).toEqual([]);
  expect(await sql(`SELECT organization_id, role FROM public.users WHERE id = $1`, [outsider.id])).toEqual([{ organization_id: String(other.orgId), role: "admin" }]);
});

test("anular una invitación pendiente desde el panel deja el link sin efecto", async ({ page }) => {
  const { orgId, owner } = await createOrganization();
  const email = uniqueEmail("anulada");
  await login(page, owner.email);
  expect((await page.request.post("/api/team/invitations", { data: { email, role: "editor", name: "Por Anular" } })).status()).toBe(200);
  const { link } = await waitForMailLink(email, INVITE_SUBJECT, INVITE_LINK);

  await page.goto("/dashboard/team");
  const pending = page.getByTestId("pending-invitations");
  await expect(pending).toContainText(email);
  await pending.locator(".revoke-invitation-btn").click();
  await expect(page.getByTestId("pending-invitations")).toHaveCount(0);

  const [inv] = await sql(`SELECT revoked_at FROM public.aitickets_team_invitations WHERE organization_id = $1 AND email = $2`, [orgId, email]);
  expect(inv.revoked_at).toBeTruthy();
  await page.goto(pathOf(link));
  await expect(page.getByTestId("invitation-status")).toContainText("anulada");
});

test("reenviar acceso a un miembro que nunca entró: crea su contraseña desde el correo", async ({ page, browser }) => {
  const { orgId, owner } = await createOrganization();
  const member = await addMember(orgId, "editor"); // cuenta creada por AI Tickets que nunca inició sesión
  const memberPassword = newPassword();
  await login(page, owner.email);
  await page.goto("/dashboard/team");
  await page.locator(`.resend-access-btn[data-member-email="${member.email}"]`).click();

  const { link } = await waitForMailLink(member.email, INVITE_SUBJECT, INVITE_LINK);
  const invitee = await acceptInvitation(browser, link, { password: memberPassword });
  await expect(invitee.page).toHaveURL(/\/dashboard/);
  await invitee.context.close();

  expect(await sql(`SELECT organization_id, role, active FROM public.users WHERE id = $1`, [member.id])).toEqual([
    { organization_id: String(orgId), role: "editor", active: true },
  ]);
  const fresh = await browser.newContext();
  await login(fresh.request, member.email, memberPassword);
  await fresh.close();
});

test("un administrador no invita administradores ni finanzas (solo el dueño)", async ({ page }) => {
  const { orgId } = await createOrganization();
  const admin = await addMember(orgId, "admin");
  await login(page, admin.email);
  await page.goto("/dashboard/team");
  await page.locator("#openModalBtn").click();
  const options = await page.locator('#addMemberForm select[name="role"] option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(options).not.toContain("admin");
  expect(options).not.toContain("finance");
  for (const role of ["admin", "finance"]) {
    const res = await page.request.post("/api/team/invitations", { data: { email: uniqueEmail("x"), role } });
    expect(res.status(), role).toBe(403);
  }
  expect(await sql(`SELECT id FROM public.aitickets_team_invitations WHERE organization_id = $1`, [orgId])).toEqual([]);
});

test("un administrador no toma la cuenta de finanzas ni cambia la cuenta bancaria (solo el dueño)", async ({ page }) => {
  const { orgId, owner } = await createOrganization();
  const admin = await addMember(orgId, "admin");
  const finance = await addMember(orgId, "finance");
  await login(page, admin.email);

  // Cambiarle el correo sería tomar su cuenta ("¿Olvidaste tu contraseña?" llega al correo nuevo)
  const takeover = await page.request.post("/api/team/update", {
    data: { userId: finance.id, name: "Finanzas", email: uniqueEmail("del-admin"), role: "finance" },
  });
  expect(takeover.status()).toBe(403);
  const [row] = await sql(`SELECT email FROM public.users WHERE id = $1`, [finance.id]);
  expect(row.email).toBe(finance.email);
  const [authRow] = await sql(`SELECT email FROM auth.users WHERE id = $1`, [finance.authUserId]);
  expect(authRow.email).toBe(finance.email);

  // Los retiros se transfieren a la cuenta bancaria: solo el dueño y finanzas la cambian
  const bank = { bank_name: "Banco E2E", bank_account_type: "Cuenta Vista", bank_account_number: "1234567890", bank_account_holder: "Admin", bank_account_rut: "12.345.678-5" };
  expect((await page.request.post("/api/organizations/update", { data: bank })).status()).toBe(403);
  expect(await sql(`SELECT organization_id FROM public.organization_payout_accounts WHERE organization_id = $1`, [orgId])).toEqual([]);

  await login(page, owner.email);
  expect((await page.request.post("/api/team/update", { data: { userId: finance.id, name: "Finanzas", email: uniqueEmail("fin-nuevo"), role: "finance" } })).status()).toBe(200);
});
