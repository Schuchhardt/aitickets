/**
 * Centralización de data-testid para los tests E2E
 * 
 * Uso en componentes: <div data-testid={TID.navbar}>
 * Uso en tests: page.getByTestId(TID.navbar)
 */
export const TID = {
  // Navegación
  navbar: 'navbar',
  navLogo: 'nav-logo',
  navMenuMobile: 'nav-menu-mobile',
  navMenuDesktop: 'nav-menu-desktop',
  
  // Hero Section
  hero: 'hero',
  heroTitle: 'hero-title',
  heroSubtitle: 'hero-subtitle',
  cta: 'cta',
  ctaPrimary: 'cta-primary',
  ctaSecondary: 'cta-secondary',
  
  // Events
  eventList: 'event-list',
  eventCard: 'event-card',
  eventDetail: 'event-detail',
  eventTitle: 'event-title',
  eventDate: 'event-date',
  eventLocation: 'event-location',
  eventPrice: 'event-price',
  eventBuyButton: 'event-buy-button',
  
  // Auth
  loginBtn: 'login-button',
  loginForm: 'login-form',
  loginEmail: 'login-email',
  loginPassword: 'login-password',
  loginSubmit: 'login-submit',
  registerBtn: 'register-button',
  registerForm: 'register-form',
  
  // Purchase Flow
  ticketSelector: 'ticket-selector',
  ticketQuantity: 'ticket-quantity',
  checkoutButton: 'checkout-button',
  paymentForm: 'payment-form',
  confirmPurchase: 'confirm-purchase',
  
  // QR & Validation
  qrCode: 'qr-code',
  qrScanner: 'qr-scanner',
  validateTicket: 'validate-ticket',
  ticketDetails: 'ticket-details',
  
  // Modals
  modal: 'modal',
  modalClose: 'modal-close',
  modalConfirm: 'modal-confirm',
  modalCancel: 'modal-cancel',
  
  // Footer
  footer: 'footer',
  footerLinks: 'footer-links',
  footerNewsletter: 'footer-newsletter',
  
  // Assistant
  aiAssistant: 'ai-assistant',
  assistantInput: 'assistant-input',
  assistantSend: 'assistant-send',
  assistantMessages: 'assistant-messages',
  
  // Forms
  formField: 'form-field',
  formError: 'form-error',
  formSubmit: 'form-submit',
  
  // Toast/Notifications
  toast: 'toast',
  toastSuccess: 'toast-success',
  toastError: 'toast-error',
  toastWarning: 'toast-warning',
} as const;

export type TestId = typeof TID[keyof typeof TID];
