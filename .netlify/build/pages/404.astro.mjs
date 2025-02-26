import { e as createComponent, i as renderComponent, r as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_CB9syzyE.mjs';
import 'kleur/colors';
import 'html-escaper';
import { $ as $$Layout, A as AppHeader, a as AppFooter } from '../chunks/Layout_dYzhv0PI.mjs';
/* empty css                                    */
export { renderers } from '../renderers.mjs';

const $$404 = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, {}, { "default": ($$result2) => renderTemplate` ${renderComponent($$result2, "AppHeader", AppHeader, {})} ${maybeRenderHead()}<main> <p>La pagina solicitada no existe</p> </main> ${renderComponent($$result2, "AppFooter", AppFooter, {})} ` })}`;
}, "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/pages/404.astro", void 0);

const $$file = "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/pages/404.astro";
const $$url = "/404";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$404,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
