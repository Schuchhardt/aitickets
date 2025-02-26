import { useSSRContext, mergeProps, ref, onMounted } from 'vue';
import { ssrRenderAttrs, ssrRenderAttr, ssrRenderClass, ssrInterpolate } from 'vue/server-renderer';
/* empty css                            */
import { e as createComponent, f as createAstro, h as addAttribute, j as renderHead, k as renderSlot, r as renderTemplate } from './astro/server_CB9syzyE.mjs';
import 'kleur/colors';
import 'html-escaper';
import 'clsx';

const logoLight = new Proxy({"src":"/_astro/logo.DGoce3p0.png","width":486,"height":102,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/images/logo.png";
							}
							
							return target[name];
						}
					});

const _export_sfc = (sfc, props) => {
  const target = sfc.__vccOpts || sfc;
  for (const [key, val] of props) {
    target[key] = val;
  }
  return target;
};

const _sfc_main$1 = {
  __name: 'AppHeader',
  setup(__props, { expose: __expose }) {
  __expose();


const __returned__ = { get logoLight() { return logoLight } };
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true });
return __returned__
}

};

function _sfc_ssrRender$1(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<header${
    ssrRenderAttrs(mergeProps({ class: "bg-white py-4 shadow-md" }, _attrs))
  } data-v-d10e03d7><div class="container mx-auto flex justify-center" data-v-d10e03d7><a href="/" class="cursor-pointer" data-v-d10e03d7><img${
    ssrRenderAttr("src", $setup.logoLight.src)
  } alt="AI Tickets" class="h-8" data-v-d10e03d7></a></div></header>`);
}
const _sfc_setup$1 = _sfc_main$1.setup;
_sfc_main$1.setup = (props, ctx) => {
  const ssrContext = useSSRContext()
  ;(ssrContext.modules || (ssrContext.modules = new Set())).add("src/components/AppHeader.vue");
  return _sfc_setup$1 ? _sfc_setup$1(props, ctx) : undefined
};
const AppHeader = /*#__PURE__*/_export_sfc(_sfc_main$1, [['ssrRender',_sfc_ssrRender$1],['__scopeId',"data-v-d10e03d7"]]);

const iconArrowGreen = new Proxy({"src":"/_astro/icon-arrow-green.anh70UTw.png","width":139,"height":139,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/images/icon-arrow-green.png";
							}
							
							return target[name];
						}
					});

const iconFacebook = new Proxy({"src":"/_astro/icon-facebook.BhU4-XTv.png","width":250,"height":250,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/images/icon-facebook.png";
							}
							
							return target[name];
						}
					});

const iconLinkedIn = new Proxy({"src":"/_astro/icon-linkedin.CeUn6Acf.png","width":250,"height":250,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/images/icon-linkedin.png";
							}
							
							return target[name];
						}
					});

// Estado del formulario

const _sfc_main = {
  __name: 'AppFooter',
  setup(__props, { expose: __expose }) {
  __expose();

const email = ref("");
const isFocused = ref(false);
const successMessage = ref("");
const errorMessage = ref("");

// ✅ Se obtiene el mensaje de éxito solo en el cliente
onMounted(() => {
  if (typeof window !== "undefined") {
    successMessage.value = localStorage.getItem("subscriptionSuccess") || "";
  }
});

// Función para manejar el envío del formulario
const submitForm = async (event) => {
  event.preventDefault(); // Evita recarga de la página
  
  if (email.value.trim() === "") return;
  
  try {
    // Simulación de llamada a la API (reemplázalo con fetch real)
    const response = await fetch("https://herokuapp.com/aitalks/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Error desconocido");
    }

    // ✅ Guardar mensaje de éxito en localStorage solo en el cliente
    successMessage.value = "¡Gracias por suscribirte!";
    if (typeof window !== "undefined") {
      localStorage.setItem("subscriptionSuccess", successMessage.value);
    }

    email.value = "";
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value = error.message;
  }
};

const __returned__ = { email, isFocused, successMessage, errorMessage, submitForm, get logoLight() { return logoLight }, get iconArrowGreen() { return iconArrowGreen }, get iconFacebook() { return iconFacebook }, get iconLinkedIn() { return iconLinkedIn }, ref, onMounted };
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true });
return __returned__
}

};

function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<footer${
    ssrRenderAttrs(mergeProps({ class: "bg-white py-6 border-t border-gray-200" }, _attrs))
  } data-v-301d1020><div class="container mx-auto flex flex-col lg:flex-row items-center justify-between space-y-6 lg:space-y-0 px-6" data-v-301d1020><div class="flex justify-center lg:justify-start w-full lg:w-auto" data-v-301d1020><a href="/" class="cursor-pointer" data-v-301d1020><img${
    ssrRenderAttr("src", $setup.logoLight.src)
  } alt="AI Tickets" class="h-8" data-v-301d1020></a></div><div class="flex flex-col items-center lg:items-end w-full lg:w-auto" data-v-301d1020><p class="text-gray-900 font-bold text-sm font-[&#39;Unbounded&#39;]" data-v-301d1020> Únete a la comunidad AI 🔥 </p>`);
  if (!$setup.successMessage) {
    _push(`<div class="relative mt-2" data-v-301d1020><form class="flex" data-v-301d1020><input${
      ssrRenderAttr("value", $setup.email)
    } type="email" placeholder="Ingresa tu correo" class="w-64 lg:w-80 border border-gray-300 py-2 pl-4 pr-16 rounded-full text-gray-600 font-[&#39;Prompt&#39;] focus:outline-none focus:ring-2 focus:ring-gray-300 cursor-pointer" required data-v-301d1020><button type="submit" class="${
      ssrRenderClass([{ 'rotate-45': $setup.isFocused || $setup.email.length > 0 }, "absolute right-2 top-1/2 transform -translate-y-1/2 w-10 h-10 rounded-full transition-transform duration-300 cursor-pointer flex items-center justify-center"])
    }" data-v-301d1020><img${
      ssrRenderAttr("src", $setup.iconArrowGreen.src)
    } alt="Enviar" class="w-6 h-6 transition-transform duration-300" data-v-301d1020></button></form></div>`);
  } else {
    _push(`<p class="text-green-600 font-bold mt-2" data-v-301d1020>${ssrInterpolate($setup.successMessage)}</p>`);
  }
  if ($setup.errorMessage) {
    _push(`<p class="text-red-500 mt-2 text-sm" data-v-301d1020>${ssrInterpolate($setup.errorMessage)}</p>`);
  } else {
    _push(`<!---->`);
  }
  _push(`</div></div><div class="flex justify-center space-x-4 mt-4" data-v-301d1020><a href="https://facebook.com" target="_blank" class="cursor-pointer" data-v-301d1020><img${
    ssrRenderAttr("src", $setup.iconFacebook.src)
  } alt="Facebook" class="w-6 h-6" data-v-301d1020></a><a href="https://linkedin.com" target="_blank" class="cursor-pointer" data-v-301d1020><img${
    ssrRenderAttr("src", $setup.iconLinkedIn.src)
  } alt="LinkedIn" class="w-6 h-6" data-v-301d1020></a></div><div class="mt-6 text-center text-gray-500 text-sm font-[&#39;Prompt&#39;]" data-v-301d1020><div class="flex justify-center space-x-4" data-v-301d1020><a href="/terms" class="hover:underline" data-v-301d1020>Términos y condiciones</a><span data-v-301d1020>|</span><a href="/privacy" class="hover:underline" data-v-301d1020>Aviso de privacidad</a></div></div></footer>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext()
  ;(ssrContext.modules || (ssrContext.modules = new Set())).add("src/components/AppFooter.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : undefined
};
const AppFooter = /*#__PURE__*/_export_sfc(_sfc_main, [['ssrRender',_sfc_ssrRender],['__scopeId',"data-v-301d1020"]]);

const $$Astro = createAstro();
const $$Layout = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Layout;
  return renderTemplate`<html lang="en" data-astro-cid-sckkx6r4> <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"><link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png"><link rel="manifest" href="/site.webmanifest"><meta name="generator"${addAttribute(Astro2.generator, "content")}><title>AI Tickets</title>${renderHead()}</head> <body data-astro-cid-sckkx6r4> ${renderSlot($$result, $$slots["default"])} </body></html>`;
}, "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/layouts/Layout.astro", void 0);

export { $$Layout as $, AppHeader as A, _export_sfc as _, AppFooter as a };
