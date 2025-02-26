import { e as createComponent, f as createAstro, i as renderComponent, r as renderTemplate } from '../chunks/astro/server_CB9syzyE.mjs';
import 'kleur/colors';
import 'html-escaper';
import { i as iconLocation, a as iconCalendar, s as supabase } from '../chunks/icon-pin-dark_DcXDU6Us.mjs';
import { _ as _export_sfc, $ as $$Layout, A as AppHeader, a as AppFooter } from '../chunks/Layout_dYzhv0PI.mjs';
import { ssrRenderAttrs, ssrRenderAttr, ssrInterpolate, ssrRenderClass, ssrRenderList, ssrIncludeBooleanAttr, ssrLooseContain, ssrLooseEqual, ssrRenderComponent } from 'vue/server-renderer';
import { useSSRContext, ref, onMounted, mergeProps, computed } from 'vue';
/* empty css                                    */
export { renderers } from '../renderers.mjs';

const iconCalendarLight = new Proxy({"src":"/_astro/icon-calendar-light.B0rRWg9Y.png","width":102,"height":100,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/images/icon-calendar-light.png";
							}
							
							return target[name];
						}
					});

const iconPinLight = new Proxy({"src":"/_astro/icon-pin-light.BX8DvhYB.png","width":105,"height":110,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/images/icon-pin-light.png";
							}
							
							return target[name];
						}
					});

// Props con los datos del evento

const _sfc_main$5 = {
  __name: 'EventHeader',
  props: {
  event: Object,
},
  setup(__props, { expose: __expose }) {
  __expose();

// import { Image } from 'astro:assets';

// Importar imágenes desde `src/images/`


// Función para formatear la fecha con hora
const formatFullDate = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const startDateStr = start.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
  });
  const endDateStr = end.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
  });

  const startTime = start.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const endTime = end.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return `Del ${startDateStr} al ${endDateStr}, desde las ${startTime} a las ${endTime} hrs`;
};

const __returned__ = { formatFullDate, get iconCalendarLight() { return iconCalendarLight }, get iconPinLight() { return iconPinLight }, get iconCalendarDark() { return iconCalendar }, get iconPinDark() { return iconLocation } };
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true });
return __returned__
}

};

function _sfc_ssrRender$5(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  if ($props.event) {
    _push(`<div${
      ssrRenderAttrs(_attrs)
    }><div class="relative w-full rounded-xl overflow-hidden"><img${
      ssrRenderAttr("src", $props.event.image_url)
    }${
      ssrRenderAttr("alt", $props.event.name)
    } class="w-full h-80 object-cover lg:h-[400px]"><div class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent hidden lg:block"></div><div class="absolute bottom-6 left-6 text-white hidden lg:block font-[&#39;Prompt&#39;]"><span class="uppercase text-xs font-medium tracking-wide opacity-80">${
      ssrInterpolate($props.event.title)
    }</span><h2 class="text-3xl font-bold font-[&#39;Unbounded&#39;]">${
      ssrInterpolate($props.event.name)
    }</h2><div class="flex flex-wrap items-center text-sm mt-2 opacity-90 space-x-4"><div class="flex items-center"><img${
      ssrRenderAttr("src", $setup.iconCalendarLight.src)
    } alt="calendar icon" class="w-5 h-5 mr-2"><span>${
      ssrInterpolate($setup.formatFullDate($props.event.start_date, $props.event.end_date))
    }</span></div><div class="flex items-center"><img${
      ssrRenderAttr("src", $setup.iconPinLight.src)
    } alt="location icon" class="w-5 h-5 mr-2"><span>${
      ssrInterpolate($props.event.location)
    }</span></div></div></div></div><div class="lg:hidden text-center mt-4 font-[&#39;Prompt&#39;]"><span class="uppercase text-xs font-medium tracking-wide text-gray-600">${
      ssrInterpolate($props.event.title)
    }</span><h2 class="text-2xl font-bold text-gray-900 font-[&#39;Unbounded&#39;]">${
      ssrInterpolate($props.event.name)
    }</h2><div class="flex flex-col items-center text-gray-600 text-sm mt-2 space-y-2"><div class="flex items-center"><img${
      ssrRenderAttr("src", $setup.iconCalendarDark.src)
    } alt="calendar icon" class="w-5 h-5 mr-2"><span>${
      ssrInterpolate($setup.formatFullDate($props.event.start_date, $props.event.end_date))
    }</span></div><div class="flex items-center"><img${
      ssrRenderAttr("src", $setup.iconPinDark.src)
    } alt="location icon" class="w-5 h-5 mr-2"><span>${
      ssrInterpolate($props.event.location)
    }</span></div></div></div></div>`);
  } else {
    _push(`<!---->`);
  }
}
const _sfc_setup$5 = _sfc_main$5.setup;
_sfc_main$5.setup = (props, ctx) => {
  const ssrContext = useSSRContext()
  ;(ssrContext.modules || (ssrContext.modules = new Set())).add("src/components/EventHeader.vue");
  return _sfc_setup$5 ? _sfc_setup$5(props, ctx) : undefined
};
const EventHeader = /*#__PURE__*/_export_sfc(_sfc_main$5, [['ssrRender',_sfc_ssrRender$5]]);

const _sfc_main$4 = {
  __name: "EventTabs",
  props: {
    event: Object
  },
  setup(__props, { expose: __expose }) {
    __expose();
    const googleMapsApiKey = "AIzaSyA3kholKbbbVJWV20zcuE0fKxPsnYQGZoQ";
    const showFullDescription = ref(false);
    const faqs = ref([
      {
        question: "¿Cuál es el horario del evento?",
        answer: "El evento se realizará los días 17 y 18 de Mayo, desde las 10:00 a las 22:00 hrs.",
        open: false
      },
      {
        question: "¿Dónde se llevará a cabo?",
        answer: "El evento se realizará en Mallplaza Norte, Huechuraba, Chile.",
        open: false
      },
      {
        question: "¿Es un evento gratuito?",
        answer: "Sí, la entrada es totalmente gratis para todos los asistentes.",
        open: false
      },
      {
        question: "¿Necesito registrarme previamente?",
        answer: "Te recomendamos reservar tu ticket en línea para asegurar tu cupo.",
        open: false
      },
      {
        question: "¿Habrá estacionamiento disponible?",
        answer: "Sí, Mallplaza Norte cuenta con estacionamiento amplio para visitantes.",
        open: false
      }
    ]);
    const toggleFAQ = (index) => {
      faqs.value[index].open = !faqs.value[index].open;
    };
    const activeSection = ref("descripcion");
    const handleScroll = () => {
      const sections = document.querySelectorAll(".event-section");
      let currentSection = "descripcion";
      sections.forEach((section) => {
        const rect = section.getBoundingClientRect();
        if (rect.top <= 150 && rect.bottom >= 150) {
          currentSection = section.id;
        }
      });
      activeSection.value = currentSection;
    };
    onMounted(() => {
      window.addEventListener("scroll", handleScroll);
    });
    const getTime = (date) => {
      return new Date(date).toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    };
    const __returned__ = { googleMapsApiKey, showFullDescription, faqs, toggleFAQ, activeSection, handleScroll, getTime, ref, onMounted };
    Object.defineProperty(__returned__, "__isScriptSetup", { enumerable: false, value: true });
    return __returned__;
  }
};
function _sfc_ssrRender$4(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  if ($props.event) {
    _push(`<div${ssrRenderAttrs(mergeProps({ class: "lg:col-span-2 font-['Prompt']" }, _attrs))}><div class="hidden lg:flex border-b border-gray-300 space-x-4 sticky top-0 bg-white py-2 z-10"><a href="#descripcion" class="${ssrRenderClass([$setup.activeSection === "descripcion" ? "border-b-2 border-black text-black" : "text-gray-500", "py-2 px-4 text-sm font-semibold cursor-pointer font-['Unbounded']"])}"> Descripción </a><a href="#fecha" class="${ssrRenderClass([$setup.activeSection === "fecha" ? "border-b-2 border-black text-black" : "text-gray-500", "py-2 px-4 text-sm font-semibold cursor-pointer font-['Unbounded']"])}"> Fecha </a><a href="#lugar" class="${ssrRenderClass([$setup.activeSection === "lugar" ? "border-b-2 border-black text-black" : "text-gray-500", "py-2 px-4 text-sm font-semibold cursor-pointer font-['Unbounded']"])}"> Ubicación </a><a href="#preguntas" class="${ssrRenderClass([$setup.activeSection === "preguntas" ? "border-b-2 border-black text-black" : "text-gray-500", "py-2 px-4 text-sm font-semibold cursor-pointer font-['Unbounded']"])}"> Preguntas Frecuentes </a></div><div id="descripcion" class="event-section mt-6"><h2 class="text-2xl font-bold mb-4 font-[&#39;Unbounded&#39;]">Descripción</h2><div class="text-gray-600">${$props.event.description ?? ""}</div>`);
    if ($props.event.description.length > 200) {
      _push(`<button class="text-blue-500 mt-2 cursor-pointer">${ssrInterpolate($setup.showFullDescription ? "Ver menos" : "Ver más")}</button>`);
    } else {
      _push(`<!---->`);
    }
    _push(`</div><div id="fecha" class="event-section mt-10"><h2 class="text-2xl font-bold mb-4 font-[&#39;Unbounded&#39;]">Fecha y hora</h2><div class="flex space-x-4"><div class="bg-gray-100 p-4 rounded-lg text-center w-1/2"><span class="text-gray-900 font-semibold block">${ssrInterpolate(new Date($props.event.start_date).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "long" }))}</span><span class="text-gray-600 text-sm">${ssrInterpolate($setup.getTime($props.event.start_date))} hrs - ${ssrInterpolate($setup.getTime($props.event.end_date))} hrs</span></div><div class="bg-gray-100 p-4 rounded-lg text-center w-1/2"><span class="text-gray-900 font-semibold block">${ssrInterpolate(new Date($props.event.end_date).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "long" }))}</span><span class="text-gray-600 text-sm">${ssrInterpolate($setup.getTime($props.event.start_date))} hrs - ${ssrInterpolate($setup.getTime($props.event.end_date))} hrs</span></div></div></div><div id="lugar" class="event-section mt-10"><h2 class="text-2xl font-bold mb-4 font-[&#39;Unbounded&#39;]">Ubicación</h2><p class="text-gray-600">${ssrInterpolate($props.event.location)} <a${ssrRenderAttr("href", "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent($props.event.location))} target="_blank" class="text-blue-500 cursor-pointer">Ver ubicación</a></p><iframe class="w-full h-64 mt-4 rounded-lg shadow-md"${ssrRenderAttr("src", "https://www.google.com/maps/embed/v1/place?key=" + $setup.googleMapsApiKey + "&q=" + encodeURIComponent($props.event.location))} allowfullscreen></iframe></div><div id="preguntas" class="event-section mt-10"><h2 class="text-2xl font-bold mb-4 font-[&#39;Unbounded&#39;]">Preguntas Frecuentes</h2><!--[-->`);
    ssrRenderList($setup.faqs, (faq, index) => {
      _push(`<div class="border-b border-gray-300 py-3"><button class="flex justify-between items-center w-full text-left cursor-pointer"><span class="text-gray-900 font-medium">${ssrInterpolate(index + 1)}. ${ssrInterpolate(faq.question)}</span><span class="text-gray-500">${ssrInterpolate(faq.open ? "▲" : "▼")}</span></button>`);
      if (faq.open) {
        _push(`<p class="mt-2 text-gray-600">${ssrInterpolate(faq.answer)}</p>`);
      } else {
        _push(`<!---->`);
      }
      _push(`</div>`);
    });
    _push(`<!--]--></div><div class="mt-10"><h2 class="text-2xl font-bold mb-4 font-[&#39;Unbounded&#39;]">Categorías y temáticas del evento</h2><div class="flex flex-wrap gap-2"><!--[-->`);
    ssrRenderList($props.event.tags, (cat, idx) => {
      _push(`<span class="px-3 py-1 bg-gray-100 rounded-full text-gray-600 text-sm">${ssrInterpolate(cat)}</span>`);
    });
    _push(`<!--]--></div></div></div>`);
  } else {
    _push(`<!---->`);
  }
}
const _sfc_setup$4 = _sfc_main$4.setup;
_sfc_main$4.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("src/components/EventTabs.vue");
  return _sfc_setup$4 ? _sfc_setup$4(props, ctx) : void 0;
};
const EventTabs = /* @__PURE__ */ _export_sfc(_sfc_main$4, [["ssrRender", _sfc_ssrRender$4]]);

const iconShare = new Proxy({"src":"/_astro/icon-share.BQ2neyRA.png","width":118,"height":128,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/images/icon-share.png";
							}
							
							return target[name];
						}
					});

const iconArrow = new Proxy({"src":"/_astro/icon-arrow-black.BVt6gO27.png","width":500,"height":500,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/images/icon-arrow-black.png";
							}
							
							return target[name];
						}
					});

const iconTicket = new Proxy({"src":"/_astro/icon-tickets.DpRNYEFj.png","width":114,"height":101,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/images/icon-tickets.png";
							}
							
							return target[name];
						}
					});

const _sfc_main$3 = {
  __name: 'ShareEventModal',
  props: {
  show: Boolean,
  event: Object
},
  emits: ["close"],
  setup(__props, { expose: __expose, emit: __emit }) {
  __expose();

const props = __props;

const emit = __emit;

// 📌 URL del evento (Asegúrate de cambiarlo según la URL real de tu sitio)
const eventUrl = computed(() => `${window.location.origin}/e-${props.event.slug}`);

// 📌 Función para copiar al portapapeles
const copyToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(eventUrl.value);
    alert("Enlace copiado al portapapeles");
  } catch (err) {
    console.error("Error al copiar el enlace:", err);
  }
};

const __returned__ = { props, emit, eventUrl, copyToClipboard, computed };
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true });
return __returned__
}

};

function _sfc_ssrRender$3(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  if ($props.show) {
    _push(`<div${
      ssrRenderAttrs(mergeProps({ class: "fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50" }, _attrs))
    }><div class="bg-white p-6 rounded-lg shadow-lg w-80"><h2 class="text-lg font-bold mb-4 font-[&#39;Unbounded&#39;]">Compartir evento</h2><div class="space-y-3"><a${
      ssrRenderAttr("href", `https://wa.me/?text=${encodeURIComponent($setup.eventUrl)}`)
    } target="_blank" class="block bg-green-500 text-white text-center py-2 rounded-lg hover:bg-green-600 transition"> Compartir en WhatsApp </a><a${
      ssrRenderAttr("href", `https://twitter.com/intent/tweet?text=${encodeURIComponent($props.event.name)}&url=${encodeURIComponent($setup.eventUrl)}`)
    } target="_blank" class="block bg-blue-500 text-white text-center py-2 rounded-lg hover:bg-blue-600 transition"> Compartir en Twitter </a><button class="block w-full bg-gray-200 text-gray-800 text-center py-2 rounded-lg hover:bg-gray-300 transition"> Copiar enlace </button></div><button class="mt-4 block w-full bg-red-500 text-white py-2 rounded-lg hover:bg-red-600 transition cursor-pointer"> Cerrar </button></div></div>`);
  } else {
    _push(`<!---->`);
  }
}
const _sfc_setup$3 = _sfc_main$3.setup;
_sfc_main$3.setup = (props, ctx) => {
  const ssrContext = useSSRContext()
  ;(ssrContext.modules || (ssrContext.modules = new Set())).add("src/components/ShareEventModal.vue");
  return _sfc_setup$3 ? _sfc_setup$3(props, ctx) : undefined
};
const ShareEventModal = /*#__PURE__*/_export_sfc(_sfc_main$3, [['ssrRender',_sfc_ssrRender$3]]);

const _sfc_main$2 = {
  __name: 'ReserveModal',
  props: {
  event: Object, // El evento con sus tickets
},
  emits: ["close"],
  setup(__props, { expose: __expose, emit: __emit }) {
  __expose();

const props = __props;

const emit = __emit;

const currentStep = ref(1);
const selectedTickets = ref({}); // Almacena la cantidad seleccionada por ticket
const buyerInfo = ref({
  firstName: "",
  lastName: "",
  email: "",
});

// ✅ Función para calcular el total de las entradas seleccionadas
const totalAmount = computed(() => {
  return Object.keys(selectedTickets.value).reduce((sum, ticketId) => {
    const ticket = props.event.tickets.find(t => t.id == ticketId);
    return sum + (ticket ? ticket.price * selectedTickets.value[ticketId] : 0);
  }, 0);
});

// ✅ Función para avanzar de paso
const nextStep = () => {
  if (currentStep.value < 3) currentStep.value++;
};

// ✅ Función para regresar al paso anterior
const prevStep = () => {
  if (currentStep.value > 1) currentStep.value--;
};

// ✅ Función para cerrar el modal si se hace clic fuera
const closeModal = (event) => {
  if (event.target.id === "modal-overlay") {
    emit("close");
  }
};

// ✅ Generar un link de pago basado en el total
const getPaymentLink = () => {
  return `https://payment-provider.com/pay?amount=${totalAmount.value}`;
};

const __returned__ = { props, emit, currentStep, selectedTickets, buyerInfo, totalAmount, nextStep, prevStep, closeModal, getPaymentLink, ref, computed };
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true });
return __returned__
}

};

function _sfc_ssrRender$2(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${
    ssrRenderAttrs(mergeProps({
      id: "modal-overlay",
      class: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
    }, _attrs))
  }><div class="bg-white rounded-lg shadow-xl max-w-3xl w-full"><div class="text-center py-4 border-b"><h2 class="text-2xl font-bold">${
    ssrInterpolate($props.event.name)
  }</h2></div><div class="flex justify-between border-b px-6 py-3 text-gray-600 text-sm font-semibold"><div class="${
    ssrRenderClass([$setup.currentStep === 1 ? 'text-black' : '', "flex-1 text-center"])
  }"> 1. Seleccionar entradas </div><div class="${
    ssrRenderClass([$setup.currentStep === 2 ? 'text-black' : '', "flex-1 text-center"])
  }"> 2. Datos del comprador </div><div class="${
    ssrRenderClass([$setup.currentStep === 3 ? 'text-black' : '', "flex-1 text-center"])
  }"> 3. Pago </div></div><div class="p-6">`);
  if ($setup.currentStep === 1) {
    _push(`<div><h3 class="text-lg font-semibold mb-4">Elige tus entradas</h3><div class="grid grid-cols-1 md:grid-cols-2 gap-6"><div><!--[-->`);
    ssrRenderList($props.event.tickets.filter(t => t.max_quantity > 0 && !t.is_gift), (ticket) => {
      _push(`<div class="border p-4 rounded-lg flex justify-between items-center"><div><p class="font-medium">${
        ssrInterpolate(ticket.ticket_name)
      }</p><p class="text-gray-500">${
        ssrInterpolate(ticket.price > 0 ? `$${ticket.price}` : "Gratis")
      }</p></div><select class="border rounded-md p-1"><option${
        ssrRenderAttr("value", 0)
      }${
        (ssrIncludeBooleanAttr((Array.isArray($setup.selectedTickets[ticket.id]))
          ? ssrLooseContain($setup.selectedTickets[ticket.id], 0)
          : ssrLooseEqual($setup.selectedTickets[ticket.id], 0))) ? " selected" : ""
      }>0</option><!--[-->`);
      ssrRenderList(ticket.max_quantity, (n) => {
        _push(`<option${
          ssrRenderAttr("value", n)
        }${
          (ssrIncludeBooleanAttr((Array.isArray($setup.selectedTickets[ticket.id]))
            ? ssrLooseContain($setup.selectedTickets[ticket.id], n)
            : ssrLooseEqual($setup.selectedTickets[ticket.id], n))) ? " selected" : ""
        }>${
          ssrInterpolate(n)
        }</option>`);
      });
      _push(`<!--]--></select></div>`);
    });
    _push(`<!--]--></div><div class="border p-4 rounded-lg"><h4 class="font-semibold text-lg mb-4">Resumen</h4><ul class="mb-4">`);
    if ($setup.selectedTickets[_ctx.ticketId] > 0) {
      _push(`<!--[-->`);
      ssrRenderList(Object.keys($setup.selectedTickets), (ticketId) => {
        _push(`<li class="flex justify-between"><span>${
          ssrInterpolate($props.event.tickets.find(t => t.id == ticketId)?.ticket_name)
        } (x${
          ssrInterpolate($setup.selectedTickets[ticketId])
        }) </span><span class="font-medium"> \$${
          ssrInterpolate($props.event.tickets.find(t => t.id == ticketId)?.price * $setup.selectedTickets[ticketId])
        }</span></li>`);
      });
      _push(`<!--]-->`);
    } else {
      _push(`<!---->`);
    }
    _push(`</ul><div class="flex justify-between text-xl font-bold"><span>Total:</span><span>\$${ssrInterpolate($setup.totalAmount)}</span></div></div></div></div>`);
  } else {
    _push(`<!---->`);
  }
  if ($setup.currentStep === 2) {
    _push(`<div><h3 class="text-lg font-semibold mb-4">Datos del comprador</h3><div class="grid grid-cols-1 md:grid-cols-2 gap-4"><input${
      ssrRenderAttr("value", $setup.buyerInfo.firstName)
    } type="text" placeholder="Nombre" class="border p-2 rounded-md w-full"><input${
      ssrRenderAttr("value", $setup.buyerInfo.lastName)
    } type="text" placeholder="Apellido" class="border p-2 rounded-md w-full"><input${
      ssrRenderAttr("value", $setup.buyerInfo.email)
    } type="email" placeholder="Correo electrónico" class="border p-2 rounded-md w-full col-span-2"></div></div>`);
  } else {
    _push(`<!---->`);
  }
  if ($setup.currentStep === 3) {
    _push(`<div class="text-center"><h3 class="text-lg font-semibold mb-4">Completa tu pago</h3><p class="text-gray-600 mb-4">Haz clic en el botón para completar tu pago.</p><a${ssrRenderAttr("href", $setup.getPaymentLink())} class="bg-black text-white px-6 py-2 rounded-md inline-block"> Ir a pagar </a></div>`);
  } else {
    _push(`<!---->`);
  }
  _push(`</div><div class="flex justify-between p-6 border-t">`);
  if ($setup.currentStep > 1) {
    _push(`<button class="text-gray-600 hover:text-black"> Atrás </button>`);
  } else {
    _push(`<!---->`);
  }
  if ($setup.currentStep < 3) {
    _push(`<button class="bg-lime-500 text-white px-6 py-2 rounded-md"> Continuar </button>`);
  } else {
    _push(`<!---->`);
  }
  _push(`</div></div></div>`);
}
const _sfc_setup$2 = _sfc_main$2.setup;
_sfc_main$2.setup = (props, ctx) => {
  const ssrContext = useSSRContext()
  ;(ssrContext.modules || (ssrContext.modules = new Set())).add("src/components/ReserveModal.vue");
  return _sfc_setup$2 ? _sfc_setup$2(props, ctx) : undefined
};
const ReserveModal = /*#__PURE__*/_export_sfc(_sfc_main$2, [['ssrRender',_sfc_ssrRender$2]]);

const _sfc_main$1 = {
  __name: 'EventActions',
  props: {
  event: Object,
},
  setup(__props, { expose: __expose }) {
  __expose();



const showModal = ref(false);
const showReserveModal = ref(false); // 🔹 El modal inicia cerrado

const openReserveModal = () => {
  showReserveModal.value = true;
};

const closeReserveModal = () => {
  showReserveModal.value = false;
};


const __returned__ = { showModal, showReserveModal, openReserveModal, closeReserveModal, ref, get iconShare() { return iconShare }, get iconArrow() { return iconArrow }, get iconTicket() { return iconTicket }, ShareEventModal, ReserveModal };
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true });
return __returned__
}

};

function _sfc_ssrRender$1(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  if ($props.event) {
    _push(`<div${
      ssrRenderAttrs(mergeProps({ class: "font-['Unbounded'] font-bold" }, _attrs))
    }><div class="lg:hidden flex justify-center mt-4"><button class="w-11/12 flex items-center justify-center py-2 border border-gray-300 rounded-full text-gray-600 bg-gray-100"><img${
      ssrRenderAttr("src", $setup.iconShare.src)
    } alt="Compartir" class="w-5 h-5 mr-2"> Compartir evento </button></div><div class="hidden lg:block bg-gray-100 p-6 rounded-xl shadow-md text-center"><div class="flex items-center justify-between text-lg text-gray-900"><span class="flex items-center"><img${
      ssrRenderAttr("src", $setup.iconTicket.src)
    } alt="ticket icon" class="w-5 h-5 mr-2"> Precio </span><span class="text-xl">${
      ssrInterpolate($props.event.price || "Gratis")
    }</span></div><button class="w-full bg-black text-white py-3 rounded-full flex items-center justify-center mt-4 cursor-pointer"> Reservar ticket <img${
      ssrRenderAttr("src", $setup.iconArrow.src)
    } alt="Arrow" class="w-4 h-4 ml-2"></button><button class="w-full mt-3 border border-gray-400 py-2 rounded-full text-gray-700 flex items-center justify-center cursor-pointer"><img${
      ssrRenderAttr("src", $setup.iconShare.src)
    } alt="Compartir" class="w-5 h-5 mr-2"> Compartir evento </button></div><div class="lg:hidden fixed bottom-0 left-0 w-full bg-lime-400 py-4 px-6 flex justify-between items-center shadow-md"><span class="text-lg text-gray-900">${
      ssrInterpolate($props.event.price || "Gratis")
    }</span><button class="bg-black text-white py-2 px-6 rounded-full flex items-center cursor-pointer"> Reservar ticket </button></div>`);
    _push(ssrRenderComponent($setup["ShareEventModal"], {
      show: $setup.showModal,
      event: $props.event,
      onClose: $event => ($setup.showModal = false)
    }, null, _parent));
    if ($setup.showReserveModal) {
      _push(ssrRenderComponent($setup["ReserveModal"], {
        event: $props.event,
        onClose: $setup.closeReserveModal
      }, null, _parent));
    } else {
      _push(`<!---->`);
    }
    _push(`</div>`);
  } else {
    _push(`<!---->`);
  }
}
const _sfc_setup$1 = _sfc_main$1.setup;
_sfc_main$1.setup = (props, ctx) => {
  const ssrContext = useSSRContext()
  ;(ssrContext.modules || (ssrContext.modules = new Set())).add("src/components/EventActions.vue");
  return _sfc_setup$1 ? _sfc_setup$1(props, ctx) : undefined
};
const EventActions = /*#__PURE__*/_export_sfc(_sfc_main$1, [['ssrRender',_sfc_ssrRender$1]]);

const _sfc_main = {
  __name: 'EventDetail',
  props: {
  event: Object,
},
  setup(__props, { expose: __expose }) {
  __expose();



const __returned__ = { EventHeader, EventTabs, EventActions };
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true });
return __returned__
}

};

function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(mergeProps({ class: "max-w-6xl mx-auto px-6 lg:px-12 py-8" }, _attrs))}>`);
  _push(ssrRenderComponent($setup["EventHeader"], { event: $props.event }, null, _parent));
  _push(`<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8"><div class="lg:hidden">`);
  _push(ssrRenderComponent($setup["EventActions"], { event: $props.event }, null, _parent));
  _push(`</div>`);
  _push(ssrRenderComponent($setup["EventTabs"], { event: $props.event }, null, _parent));
  _push(`<div class="hidden lg:block">`);
  _push(ssrRenderComponent($setup["EventActions"], { event: $props.event }, null, _parent));
  _push(`</div></div></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext()
  ;(ssrContext.modules || (ssrContext.modules = new Set())).add("src/components/EventDetail.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : undefined
};
const EventDetail = /*#__PURE__*/_export_sfc(_sfc_main, [['ssrRender',_sfc_ssrRender]]);

const $$Astro = createAstro();
const prerender = false;
const $$Eslug = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Eslug;
  const { slug } = Astro2.params;
  const { data: event, error } = await supabase.from("events").select("*").eq("slug", slug).single();
  if (!error || event) {
    const { data: categories, error: errorCategories } = await supabase.from("event_tags").select("category_tags(name)").eq("event_id", event.id);
    if (errorCategories) {
      console.error("Error al obtener las categor\xEDas:", errorCategories);
    } else {
      event.tags = categories.map((c) => c.category_tags).map((ct) => ct.name);
    }
    const { data: event_tickets, error: errorTickets } = await supabase.from("event_tickets").select("*").eq("event_id", event.id).eq("is_gift", false).order("price", { ascending: true });
    if (errorTickets) {
      console.error("Error al obtener las entradas:", errorTickets);
      event.tickets = [];
    } else {
      console.log(event_tickets);
      event.tickets = event_tickets;
    }
  } else {
    console.error("Error al obtener el evento:", error);
    Astro2.redirect("/404");
  }
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, {}, { "default": ($$result2) => renderTemplate` ${renderComponent($$result2, "AppHeader", AppHeader, {})} ${renderComponent($$result2, "EventDetail", EventDetail, { "event": event, "client:idle": true, "client:component-hydration": "idle", "client:component-path": "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/components/EventDetail.vue", "client:component-export": "default" })} ${renderComponent($$result2, "AppFooter", AppFooter, {})} ` })}`;
}, "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/pages/e-[slug].astro", void 0);

const $$file = "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/pages/e-[slug].astro";
const $$url = "/e-[slug]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
	__proto__: null,
	default: $$Eslug,
	file: $$file,
	prerender,
	url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
