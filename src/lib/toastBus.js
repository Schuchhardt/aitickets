import mitt from 'mitt';

// Event bus para los toasts
export const toastBus = mitt();

// Función helper para mostrar toasts
export function showToast(message, type = 'info', duration = 3000) {
  toastBus.emit('toast', { message, type, duration });
}

// Helpers específicos
export function showSuccess(message, duration = 3000) {
  showToast(message, 'success', duration);
}

export function showError(message, duration = 4000) {
  showToast(message, 'error', duration);
}

export function showInfo(message, duration = 3000) {
  showToast(message, 'info', duration);
}
