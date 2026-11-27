// Edición de textos dentro de la vista previa del editor del sitio (/o/<slug>?editor=1, src/components/sites/SitePage.vue
// con live). Cada texto editable lleva data-edit="<destino>" (applyTextEdit en src/lib/siteTemplates.ts), data-ph (texto
// de ayuda), data-ml (varias líneas) y cada sección data-section-id.
//
// - Clic en un texto: se vuelve editable ahí mismo (contenteditable en texto plano). Enter (una línea) o salir del texto
//   guarda; Escape deshace. Al guardar avisa onEdit(destino, texto) y el editor lo aplica al borrador, que vuelve a la
//   vista previa por postMessage (Vue reemplaza el texto del elemento: por eso cada data-edit tiene un solo nodo de
//   texto).
// - Clic en otra parte de una sección: onSelect(id) para abrir sus ajustes en el panel del editor.
// - Los enlaces no navegan (los de la misma página hacen scroll hasta la sección).
// Solo navegador.

const PLAINTEXT_ONLY = (() => {
  try {
    const el = document.createElement("div");
    el.contentEditable = "plaintext-only";
    return el.contentEditable === "plaintext-only";
  } catch {
    return false;
  }
})();

function placeCaret(el, event) {
  const selection = window.getSelection();
  if (!selection) return;
  let range = null;
  if (event && document.caretRangeFromPoint) range = document.caretRangeFromPoint(event.clientX, event.clientY);
  else if (event && document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(event.clientX, event.clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
    }
  }
  if (!range || !el.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Texto del elemento editado (sin el salto de línea final que agregan algunos navegadores). */
const readText = (el) => String(el.innerText || "").replace(/ /g, " ").replace(/\n$/, "");

/**
 * @param {{ onEdit: (target: string, value: string) => void, onSelect: (sectionId: string | null) => void, onShortcut?: (action: "undo" | "redo" | "save") => void }} handlers
 * @returns {() => void} detiene la edición
 */
export function startLiveEditing({ onEdit, onSelect, onShortcut }) {
  let editing = null;
  let original = "";

  function finish(save) {
    const el = editing;
    if (!el) return;
    editing = null;
    const value = readText(el);
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-editing");
    if (!save) {
      el.textContent = original;
      return;
    }
    if (value !== original) onEdit(el.getAttribute("data-edit"), value);
  }

  function begin(el, event) {
    if (editing === el) return;
    finish(true);
    editing = el;
    original = readText(el);
    el.setAttribute("data-editing", "");
    el.contentEditable = PLAINTEXT_ONLY ? "plaintext-only" : "true";
    el.focus({ preventScroll: true });
    placeCaret(el, event);
    const section = el.closest("[data-section-id]");
    onSelect(section ? section.getAttribute("data-section-id") : null);
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !target.closest(".sn-page[data-live]")) return;
    if (editing && editing.contains(target)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const editable = target.closest("[data-edit]");
    // La etiqueta de una pestaña que no está activa: primero se cambia de pestaña (siteInteractions)
    const tab = editable?.closest('[role="tab"]');
    if (editable && !(tab && tab.getAttribute("aria-selected") !== "true")) {
      event.preventDefault();
      event.stopPropagation();
      begin(editable, event);
      return;
    }
    const link = target.closest("a[href]");
    if (link) {
      event.preventDefault();
      const href = link.getAttribute("href") || "";
      const hash = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
      const dest = hash && document.getElementById(hash);
      if (dest && !link.closest("dialog")) dest.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    finish(true);
    const section = target.closest("[data-section-id]");
    if (section && !target.closest("dialog")) onSelect(section.getAttribute("data-section-id"));
  }

  function onKeydown(event) {
    // Atajos del editor (el foco puede quedar en la vista previa): Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z o Y, Ctrl/Cmd+S
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && onShortcut && (key === "s" || (!editing && (key === "z" || key === "y")))) {
      event.preventDefault();
      if (key === "s") finish(true);
      onShortcut(key === "s" ? "save" : key === "y" || event.shiftKey ? "redo" : "undo");
      return;
    }
    if (!editing || event.target !== editing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
      return;
    }
    if (event.key === "Enter" && !editing.hasAttribute("data-ml")) {
      event.preventDefault();
      finish(true);
      return;
    }
    // Sin plaintext-only, Enter en un texto de varias líneas inserta un salto (no un <div>)
    if (event.key === "Enter" && !PLAINTEXT_ONLY) {
      event.preventDefault();
      document.execCommand("insertLineBreak");
    }
  }

  function onFocusOut(event) {
    if (editing && event.target === editing) finish(true);
  }

  function onPaste(event) {
    if (!editing || !editing.contains(event.target)) return;
    event.preventDefault();
    let text = event.clipboardData?.getData("text/plain") || "";
    if (!editing.hasAttribute("data-ml")) text = text.replace(/\s*\n\s*/g, " ");
    document.execCommand("insertText", false, text);
  }

  // Captura en el documento: corre antes que las interacciones del sitio (pestañas, ventanas) y las detiene si el clic
  // era para editar
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("paste", onPaste, true);
  return () => {
    finish(true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("focusout", onFocusOut, true);
    document.removeEventListener("paste", onPaste, true);
  };
}
