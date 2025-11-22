import { setupWorker } from 'msw/browser';
import { handlers } from './handlers/example.handlers';

/**
 * Mock Service Worker setup para el browser
 * Útil para mockear APIs en tests E2E cuando se necesita
 * 
 * Uso en tests:
 * import { worker } from '@e2e/support/msw/browser';
 * 
 * test.beforeAll(async () => {
 *   await worker.start();
 * });
 * 
 * test.afterAll(async () => {
 *   await worker.stop();
 * });
 */
export const worker = setupWorker(...handlers);
