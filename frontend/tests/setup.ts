import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Recharts' ResponsiveContainer measures its parent, which jsdom reports as 0x0.
// Stub the observer and pin a non-zero box so charts actually render in tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);

Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  value: 640,
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  value: 320,
});

// jsdom implements no scrolling, so Element.scrollTo is simply absent. The chat
// panel calls it to pin the newest message into view; stub it so that autoscroll
// doesn't throw during render.
HTMLElement.prototype.scrollTo = HTMLElement.prototype.scrollTo ?? function scrollTo() {};
