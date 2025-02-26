import { e as createComponent, i as renderComponent, r as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_CB9syzyE.mjs';
import 'kleur/colors';
import 'html-escaper';
import { i as iconLocation, a as iconCalendar, s as supabase } from '../chunks/icon-pin-dark_DcXDU6Us.mjs';
import { _ as _export_sfc, $ as $$Layout, A as AppHeader, a as AppFooter } from '../chunks/Layout_dYzhv0PI.mjs';
import { useSSRContext, mergeProps } from 'vue';
import { ssrRenderAttrs, ssrRenderStyle, ssrRenderAttr, ssrInterpolate, ssrRenderList, ssrRenderComponent } from 'vue/server-renderer';
/* empty css                                 */
/* empty css                                    */
export { renderers } from '../renderers.mjs';

const summitHero = new Proxy({"src":"/_astro/summit.DiEtm8JE.jpg","width":1971,"height":1312,"format":"jpg"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/images/summit.jpg";
							}
							
							return target[name];
						}
					});

const _sfc_main$2 = {
  __name: 'HeroSection',
  setup(__props, { expose: __expose }) {
  __expose();


const __returned__ = { get summitHero() { return summitHero } };
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true });
return __returned__
}

};

function _sfc_ssrRender$2(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<section${
    ssrRenderAttrs(mergeProps({ class: "relative w-full min-h-screen flex items-center justify-center text-white text-center px-6 overflow-hidden" }, _attrs))
  } data-v-1e1733f6><div class="absolute inset-0 bg-cover bg-center blur-background" style="${
    ssrRenderStyle({ backgroundImage: `url(${$setup.summitHero.src})` })
  }" data-v-1e1733f6></div><div class="relative z-10 max-w-2xl" data-v-1e1733f6><h1 class="text-4xl font-bold sm:text-5xl font-[&#39;Unbounded&#39;]" data-v-1e1733f6> La plataforma ideal para eventos de IA y tecnología </h1><p class="mt-4 text-lg text-gray-300 font-[&#39;Prompt&#39;]" data-v-1e1733f6> Conecta con la audiencia correcta y lleva tu evento tech al siguiente nivel con AI Tickets. </p><div class="mt-6 flex flex-col sm:flex-row justify-center gap-4" data-v-1e1733f6><a href="/register" class="px-6 py-3 text-lg font-bold font-[&#39;Unbounded&#39;] bg-lime-400 text-black border border-black rounded-lg transition hover:bg-black hover:text-white" data-v-1e1733f6> Crea tu Evento </a><a href="/events" class="px-6 py-3 text-lg font-bold font-[&#39;Unbounded&#39;] border border-white rounded-lg hover:bg-white hover:text-black transition" data-v-1e1733f6> Descubrir Eventos </a></div></div></section>`);
}
const _sfc_setup$2 = _sfc_main$2.setup;
_sfc_main$2.setup = (props, ctx) => {
  const ssrContext = useSSRContext()
  ;(ssrContext.modules || (ssrContext.modules = new Set())).add("src/components/HeroSection.vue");
  return _sfc_setup$2 ? _sfc_setup$2(props, ctx) : undefined
};
const HeroSection = /*#__PURE__*/_export_sfc(_sfc_main$2, [['ssrRender',_sfc_ssrRender$2],['__scopeId',"data-v-1e1733f6"]]);

const _sfc_main$1 = {
  __name: 'EventCard',
  props: {
  event: Object,
},
  setup(__props, { expose: __expose }) {
  __expose();



const __returned__ = { get iconCalendar() { return iconCalendar }, get iconLocation() { return iconLocation } };
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true });
return __returned__
}

};

function _sfc_ssrRender$1(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${
    ssrRenderAttrs(mergeProps({ class: "bg-white rounded-xl shadow-md overflow-hidden transition-transform duration-200 hover:scale-[1.02]" }, _attrs))
  }><img${
    ssrRenderAttr("src", $props.event.image_url)
  }${
    ssrRenderAttr("alt", $props.event.title)
  } class="w-full h-48 object-cover"><div class="p-4 flex flex-col space-y-3"><h3 class="text-lg font-bold text-gray-900 font-[&#39;Unbounded&#39;]">${
    ssrInterpolate($props.event.name)
  }</h3><div class="flex items-center space-x-2 text-gray-600 text-sm"><img${
    ssrRenderAttr("src", $setup.iconCalendar.src)
  } alt="Calendario" class="w-4 h-4"><p>${
    ssrInterpolate(new Date($props.event.start_date).toLocaleDateString("es-ES"))
  } - ${
    ssrInterpolate(new Date($props.event.end_date).toLocaleDateString("es-ES"))
  }</p></div><div class="flex items-center space-x-2 text-gray-600 text-sm"><img${
    ssrRenderAttr("src", $setup.iconLocation.src)
  } alt="Ubicación" class="w-4 h-4"><p>${
    ssrInterpolate($props.event.location)
  }</p></div><div class="flex justify-center mt-4"><a${
    ssrRenderAttr("href", `/e-${$props.event.slug}`)
  } class="px-5 py-2 text-lg font-bold text-black bg-lime-400 rounded-full transition hover:bg-lime-500 font-[&#39;Unbounded&#39;]"> Ver detalles </a></div></div></div>`);
}
const _sfc_setup$1 = _sfc_main$1.setup;
_sfc_main$1.setup = (props, ctx) => {
  const ssrContext = useSSRContext()
  ;(ssrContext.modules || (ssrContext.modules = new Set())).add("src/components/EventCard.vue");
  return _sfc_setup$1 ? _sfc_setup$1(props, ctx) : undefined
};
const EventCard = /*#__PURE__*/_export_sfc(_sfc_main$1, [['ssrRender',_sfc_ssrRender$1]]);

// Recibe los eventos como `props` desde `index.astro`

const _sfc_main = {
  __name: 'EventList',
  props: {
  events: Array
},
  setup(__props, { expose: __expose }) {
  __expose();

const props = __props;

const __returned__ = { props, EventCard };
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true });
return __returned__
}

};

function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<section${ssrRenderAttrs(mergeProps({ class: "container mx-auto px-6 py-10" }, _attrs))} data-v-a7c63479><h2 class="text-3xl font-bold text-center font-[&#39;Unbounded&#39;] mb-6" data-v-a7c63479> Eventos Destacados </h2>`);
  if ($setup.props.events.length === 0) {
    _push(`<p class="text-center text-gray-500" data-v-a7c63479> No hay eventos disponibles en este momento. </p>`);
  } else {
    _push(`<div class="event-grid" data-v-a7c63479><!--[-->`);
    ssrRenderList($setup.props.events, (event) => {
      _push(ssrRenderComponent($setup["EventCard"], {
        key: event.id,
        event: event
      }, null, _parent));
    });
    _push(`<!--]--></div>`);
  }
  _push(`</section>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext()
  ;(ssrContext.modules || (ssrContext.modules = new Set())).add("src/components/EventList.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : undefined
};
const EventList = /*#__PURE__*/_export_sfc(_sfc_main, [['ssrRender',_sfc_ssrRender],['__scopeId',"data-v-a7c63479"]]);

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const { data: events, error } = await supabase.from("events").select("*");
  const eventData = error || !events ? [] : events;
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, {}, { "default": ($$result2) => renderTemplate` ${renderComponent($$result2, "AppHeader", AppHeader, {})} ${maybeRenderHead()}<main> ${renderComponent($$result2, "HeroSection", HeroSection, {})} ${renderComponent($$result2, "EventList", EventList, { "events": eventData, "client:idle": true, "client:component-hydration": "idle", "client:component-path": "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/components/EventList.vue", "client:component-export": "default" })} </main> ${renderComponent($$result2, "AppFooter", AppFooter, { "client:idle": true, "client:component-hydration": "idle", "client:component-path": "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/components/AppFooter.vue", "client:component-export": "default" })} ` })}`;
}, "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/pages/index.astro", void 0);

const $$file = "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/pages/index.astro";
const $$url = "";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
	__proto__: null,
	default: $$Index,
	file: $$file,
	url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
