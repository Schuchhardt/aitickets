<script setup>
// Fondo animado "Iridescence" (port a WebGL puro del de reactbits.dev/c/backgrounds/iridescence, sin OGL).
// Tonos muy claros (se mezcla con blanco) y velocidad baja para no distraer. Lo usan EventDetail.vue (fondo
// de la página, events.page_settings.background) y el selector del editor (EditEventForm.vue).
// - Resolución reducida (es un degradado suave: no se nota) y ~30 fps.
// - Se pausa con la pestaña oculta o el canvas fuera de pantalla; prefers-reduced-motion => un cuadro fijo.
// - Sin WebGL queda el degradado CSS de respaldo.
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";

const props = defineProps({
  // [r, g, b] en 0..1: tinte del preset
  color: { type: Array, default: () => [1, 1, 1] },
  // 0..1: cuánto se mezcla con blanco (más alto = más claro)
  soft: { type: Number, default: 0.72 },
  speed: { type: Number, default: 0.12 },
  // Sin animación (un solo cuadro)
  still: { type: Boolean, default: false },
  // Escala de resolución del canvas respecto a su tamaño en CSS
  resolution: { type: Number, default: 0.5 },
});

const VERT = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uResolution;
uniform float uSpeed;
uniform float uSoft;
varying vec2 vUv;
void main() {
  float mr = min(uResolution.x, uResolution.y);
  vec2 uv = (vUv.xy * 2.0 - 1.0) * uResolution.xy / mr;
  float d = -uTime * 0.5 * uSpeed;
  float a = 0.0;
  for (float i = 0.0; i < 8.0; ++i) {
    a += cos(i - d - a * uv.x);
    d += sin(uv.y * i + a);
  }
  d += uTime * 0.5 * uSpeed;
  vec3 col = vec3(cos(uv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
  col = cos(col * cos(vec3(d, a, 2.5)) * 0.5 + 0.5) * uColor;
  gl_FragColor = vec4(mix(col, vec3(1.0), uSoft), 1.0);
}`;

const root = ref(null);
const canvas = ref(null);
const ready = ref(false);

// Respaldo CSS (antes de hidratar o sin WebGL): el tinte del preset, igual de claro
const fallback = computed(() => {
  const [r, g, b] = props.color.map((c) => Math.round((c * (1 - props.soft) + props.soft) * 255));
  const tint = `rgb(${r}, ${g}, ${b})`;
  return { background: `radial-gradient(120% 90% at 20% 10%, ${tint} 0%, #fff 55%), #fff` };
});

let gl = null;
let program = null;
let uniforms = {};
let raf = 0;
let last = 0;
let elapsed = Math.random() * 60000; // cada página arranca en otro punto del patrón
let running = false;
let visible = true;
let io = null;
let ro = null;
const FRAME_MS = 1000 / 30;

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
  return sh;
}

function setup() {
  gl = canvas.value.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
  if (!gl) return false;
  program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
  gl.useProgram(program);
  // Un triángulo que cubre toda la pantalla
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  for (const name of ["uTime", "uColor", "uResolution", "uSpeed", "uSoft"]) uniforms[name] = gl.getUniformLocation(program, name);
  return true;
}

function resize() {
  if (!gl || !root.value) return;
  const { width, height } = root.value.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2) * props.resolution;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (canvas.value.width !== w || canvas.value.height !== h) {
    canvas.value.width = w;
    canvas.value.height = h;
    gl.viewport(0, 0, w, h);
    // Cambiar el tamaño borra el canvas (a negro, alpha: false): redibujar en el acto, sin esperar al loop
    draw();
  } else if (!running) draw();
}

function draw() {
  if (!gl) return;
  gl.uniform1f(uniforms.uTime, elapsed * 0.001);
  gl.uniform3f(uniforms.uColor, props.color[0] ?? 1, props.color[1] ?? 1, props.color[2] ?? 1);
  gl.uniform3f(uniforms.uResolution, canvas.value.width, canvas.value.height, canvas.value.width / canvas.value.height);
  gl.uniform1f(uniforms.uSpeed, props.speed);
  gl.uniform1f(uniforms.uSoft, props.soft);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  ready.value = true;
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  if (now - last < FRAME_MS) return;
  elapsed += Math.min(now - last, 100);
  last = now;
  draw();
}

function onContextLost(e) {
  e.preventDefault();
  ready.value = false;
  running = false;
  cancelAnimationFrame(raf);
  gl = null;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function updateRunning() {
  const shouldRun = Boolean(gl) && !props.still && !reducedMotion() && visible && document.visibilityState === "visible";
  if (shouldRun && !running) {
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  } else if (!shouldRun && running) {
    running = false;
    cancelAnimationFrame(raf);
  }
}

onMounted(() => {
  try {
    if (!setup()) return;
  } catch {
    gl = null;
    return;
  }
  // Si el navegador suelta el contexto (pasa en móviles), queda el degradado CSS en vez de un canvas negro
  canvas.value.addEventListener("webglcontextlost", onContextLost);
  resize();
  ro = new ResizeObserver(resize);
  ro.observe(root.value);
  if ("IntersectionObserver" in window) {
    io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      updateRunning();
    });
    io.observe(root.value);
  }
  document.addEventListener("visibilitychange", updateRunning);
  updateRunning();
});
watch(() => [props.color, props.soft, props.still], () => {
  if (!running) draw();
  updateRunning();
});
onBeforeUnmount(() => {
  running = false;
  cancelAnimationFrame(raf);
  io?.disconnect();
  ro?.disconnect();
  document.removeEventListener("visibilitychange", updateRunning);
  canvas.value?.removeEventListener("webglcontextlost", onContextLost);
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  gl = null;
});
</script>

<template>
  <div ref="root" class="iri" :style="fallback" aria-hidden="true">
    <canvas ref="canvas" class="iri-canvas" :class="{ 'is-ready': ready }"></canvas>
  </div>
</template>

<style scoped>
.iri {
  overflow: hidden;
}
.iri-canvas {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 900ms ease;
}
.iri-canvas.is-ready {
  opacity: 1;
}
</style>
