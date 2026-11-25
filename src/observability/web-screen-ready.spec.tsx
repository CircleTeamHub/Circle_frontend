import { render } from '@testing-library/react-native';
import WebScreenReady from './web-screen-ready.web';

const mockReady = jest.fn();
jest.mock('./web-startup', () => ({ markWebStartupStage: () => mockReady() }));

test('an empty async route shell does not finish startup; committed page content does', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
  let notify!: () => void;
  const disconnect = jest.fn();
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class {
    constructor(callback: () => void) { notify = callback; }
    observe() {}
    disconnect = disconnect;
  } });
  const node = { textContent: '', querySelector: jest.fn(() => null) };
  try {
    mockReady.mockClear();
    const view = render(<WebScreenReady>{null}</WebScreenReady>, { createNodeMock: () => node });
    expect(mockReady).not.toHaveBeenCalled();
    node.textContent = 'Sign in';
    notify();
    expect(mockReady).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
    view.unmount();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'MutationObserver', descriptor);
    else Reflect.deleteProperty(globalThis, 'MutationObserver');
  }
});
