import { createRoot } from 'react-dom/client';
import App from '../src/App';

/**
 * The entry of the render test.
 *
 * The test builds this file for the server, so the whole application can be
 * mounted in a DOM. It is not part of the application itself.
 */
export function render(container: HTMLElement) {
  const root = createRoot(container);
  root.render(<App />);
  return root;
}
