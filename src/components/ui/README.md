# Sistema de Toasts

Sistema de notificaciones toast para reemplazar los alerts nativos del navegador.

## Uso

### Importar en tu componente Vue

```javascript
import { showSuccess, showError, showInfo } from "../lib/toastBus.js";
```

### Mostrar notificaciones

```javascript
// Toast de éxito (verde)
showSuccess('Operación completada exitosamente');

// Toast de error (rojo) - dura 4 segundos por defecto
showError('Ocurrió un error al procesar la solicitud');

// Toast informativo (gris)
showInfo('Procesando tu solicitud...');

// Con duración personalizada (en milisegundos)
showSuccess('Mensaje breve', 2000);
showError('Mensaje largo que necesita más tiempo', 6000);
```

### Ejemplo completo

```vue
<script setup>
import { showSuccess, showError } from "../lib/toastBus.js";

async function guardarDatos() {
  try {
    await api.guardar();
    showSuccess('Datos guardados correctamente');
  } catch (error) {
    showError('Error al guardar los datos');
  }
}
</script>
```

## Tipos de toast

- **success** (verde): Para operaciones exitosas
- **error** (rojo): Para errores
- **info** (gris): Para información general

## Características

- ✅ Animación suave de entrada
- ✅ Auto-desaparece después del tiempo especificado
- ✅ Se apilan verticalmente
- ✅ Responsive (se adapta a móviles)
- ✅ Accesible (roles ARIA)
- ✅ Iconos según el tipo de mensaje

## Instalación en otros layouts

Si necesitas usar toasts en páginas que no usan el Layout principal, añade el componente:

```astro
---
import ToastContainer from '../components/ui/ToastContainer.vue';
---

<html>
  <body>
    <!-- Tu contenido -->
    <ToastContainer client:only="vue" />
  </body>
</html>
```
