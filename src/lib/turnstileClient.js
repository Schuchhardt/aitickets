// error-callback para widgets de Cloudflare Turnstile renderizados con turnstile.render().
// Sin error-callback, Turnstile convierte cualquier error del widget (p. ej. 300031: el widget se cayó,
// 300030: se colgó) en una excepción no capturada. Con él, el error queda manejado: se limpia el token
// y se reinicia el widget unas pocas veces. Si sigue fallando, el formulario ya pide completar el CAPTCHA.
// https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/
const MAX_RESETS = 2;

/**
 * @param {() => string|null} getWidgetId id del widget (lo que devolvió turnstile.render)
 * @param {import('vue').Ref<string>} tokenRef token del formulario, se vacía en cada error
 */
export function turnstileErrorHandler(getWidgetId, tokenRef) {
  let resets = 0;
  return () => {
    tokenRef.value = "";
    if (resets < MAX_RESETS) {
      resets++;
      setTimeout(() => {
        const id = getWidgetId();
        if (!window.turnstile || id === null || id === undefined) return;
        try {
          window.turnstile.reset(id);
        } catch {
          /* widget ya no existe */
        }
      }, 1000 * resets);
    }
    // true = error manejado: Turnstile no lanza la excepción
    return true;
  };
}
