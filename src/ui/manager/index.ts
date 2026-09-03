/**
 * Chevalet Note — cabinet -- extension page entry.
 * Off the content-script hot path, so this is where a framework is worth its bytes
 * (plan section 2: Solid for extension pages, vanilla for the in-page layer).
 */

const app = document.getElementById('app');
if (app) {
  app.textContent = 'Chevalet Note — cabinet';
}

export {};
