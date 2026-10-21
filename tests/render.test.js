import { JSDOM } from 'jsdom';

/**
 * Render test: the whole application in a DOM.
 *
 * The test mounts the interface, creates a room, searches a track, puts it
 * into the shared queue and walks through the navigation. It proves that the
 * redesigned screens really paint and that the buttons really work.
 *
 * The test talks to a running backend, so start it first:
 *   node backend/server.js
 *   npm run test:render
 */

let failures = 0;
function check(name, cond, extra) {
  if (!cond) failures++;
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${cond || extra === undefined ? '' : ` -> ${String(extra).slice(0, 300)}`}`,
  );
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:4173/',
  pretendToBeVisual: true,
});
const { window } = dom;

/** Publishes a browser global, so React and the application find it. */
const define = (key, value) => {
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  } catch {}
};

define('window', window);
define('document', window.document);
define('navigator', window.navigator);
define('location', window.location);
define('self', window);
define('HTMLElement', window.HTMLElement);
define('HTMLInputElement', window.HTMLInputElement);
define('HTMLDivElement', window.HTMLDivElement);
define('HTMLButtonElement', window.HTMLButtonElement);
define('HTMLFormElement', window.HTMLFormElement);
define('HTMLAnchorElement', window.HTMLAnchorElement);
define('HTMLIFrameElement', window.HTMLIFrameElement);
define('Element', window.Element);
define('Node', window.Node);
define('Text', window.Text);
define('Event', window.Event);
define('CustomEvent', window.CustomEvent);
define('MouseEvent', window.MouseEvent);
define('KeyboardEvent', window.KeyboardEvent);
define('FocusEvent', window.FocusEvent);
define('InputEvent', window.InputEvent);
define('DOMParser', window.DOMParser);
define('MutationObserver', window.MutationObserver);
define('getComputedStyle', window.getComputedStyle.bind(window));
define('requestAnimationFrame', window.requestAnimationFrame.bind(window));
define('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
define('localStorage', window.localStorage);
define('sessionStorage', window.sessionStorage);
define('queueMicrotask', queueMicrotask);
define('MessageChannel', window.MessageChannel);
define('structuredClone', structuredClone);
define('URL', URL);
define('URLSearchParams', URLSearchParams);
define('Blob', window.Blob);
define('CSS', window.CSS);
define('DOMRect', window.DOMRect);
define('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});
define('IntersectionObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});
define('matchMedia', (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() {
    return false;
  },
}));
window.matchMedia = globalThis.matchMedia;
// jsdom cannot scroll, the interface only asks the browser to do it.
window.Element.prototype.scrollTo = function scrollTo() {};
window.Element.prototype.scrollIntoView = function scrollIntoView() {};

const problems = [];
const originalError = console.error;
console.error = (...args) => {
  problems.push(args.map((a) => (a && a.stack) || String(a)).join(' '));
  originalError(...args);
};
window.addEventListener('error', (event) => problems.push(`window error: ${event.message}`));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Writes into an input the way a person does, so React notices it. */
const typeInto = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};

/** Clicks a button the way a person does. */
const click = (element) => {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
};

try {
  const { render } = await import('../.render-check/render-entry.js');
  const body = window.document.body;
  render(window.document.getElementById('root'));
  await wait(1200);

  const text = body.textContent.replace(/\s+/g, ' ').trim();
  const html = body.innerHTML;
  const findByText = (selector, needle) =>
    [...body.querySelectorAll(selector)].find((el) => (el.textContent || '').trim().includes(needle));

  // --- the start screen --------------------------------------------------------
  check('the application mounted', html.length > 500, `html length ${html.length}`);
  check('the sidebar is on the screen', Boolean(body.querySelector('.sidebar')), 'no .sidebar');
  check('the navigation is on the screen', Boolean(body.querySelector('nav')), 'no nav');
  check('the start screen is on the screen', Boolean(body.querySelector('.home-hero')), 'no .home-hero');
  check('the room is offered', text.includes('Create room'), text.slice(0, 200));
  check('the join is offered', text.includes('Join room'), text.slice(0, 200));
  check('the library is offered', text.includes('Library'), text.slice(0, 200));
  check('the search is offered', text.includes('Search'), text.slice(0, 200));
  check('the mini player is on the screen', Boolean(body.querySelector('.mini-player')), 'no .mini-player');
  check('the player stage is on the screen', Boolean(body.querySelector('.stage')), 'no .stage');
  check('the room header is on the screen', Boolean(body.querySelector('.room-header')), 'no .room-header');
  check('the chat column is on the screen', Boolean(body.querySelector('.right')), 'no .right');
  check('the video call button is on the screen', Boolean(body.querySelector('.room-header button')), 'no button');
  check('no error was reported by React', problems.length === 0, problems.join(' | '));

  // --- a room is created for real ----------------------------------------------
  const nameInput = body.querySelector('#create-room-name');
  check('the room name field is there', Boolean(nameInput), 'no #create-room-name');
  typeInto(nameInput, 'Render Check');
  const createButton = findByText('button', 'Create Room');
  check('the create button is there', Boolean(createButton), 'no create button');
  click(createButton);
  await wait(1500);

  const roomText = body.textContent.replace(/\s+/g, ' ').trim();
  check('the room was created', /SS-[A-Z0-9]{6}/.test(roomText), roomText.slice(0, 300));
  check('the room view is open', Boolean(body.querySelector('.room-header')), 'no .room-header');
  check('the queue is in the room view', Boolean(body.querySelector('.queue-list') || body.querySelector('.queue-empty')), 'no queue');
  check('the chat is in the room view', Boolean(body.querySelector('.chat-head')), 'no chat');
  check('the stage is in the room view', Boolean(body.querySelector('.stage')), 'no .stage');

  // --- the search of the add form ----------------------------------------------
  const searchInput = body.querySelector('#queue-url-input');
  check('the search field of the queue is there', Boolean(searchInput), 'no #queue-url-input');
  typeInto(searchInput, 'daft punk one more time');
  const searchButton = findByText('.queue-form button', 'Search');
  check('the search button is there', Boolean(searchButton), 'no search button');
  click(searchButton);
  await wait(3000);
  const rows = body.querySelectorAll('.queue-row');
  check('the search brought results', rows.length > 0, `${rows.length} results`);
  const firstTitle = rows[0] ? rows[0].querySelector('.queue-title').textContent : '';
  check('the result has a title', firstTitle.length > 0, firstTitle);

  // --- the track goes into the shared queue ------------------------------------
  const addButton = rows[0] ? rows[0].querySelector('.queue-actions button') : null;
  check('the add button of the result is there', Boolean(addButton), 'no add button');
  if (addButton) {
    click(addButton);
    await wait(2000);
    const after = body.textContent.replace(/\s+/g, ' ');
    check('the queue of the room has the track', /1 song lined up/.test(after), after.slice(0, 300));
    check('the track is in the shared queue', after.includes(firstTitle.slice(0, 18)), after.slice(0, 300));
    check('the interface confirms the add', after.includes('Added to the queue'), after.slice(0, 300));
  }

  // --- the navigation opens the other screens ----------------------------------
  const searchNav = findByText('.nav-item', 'Search music') || findByText('button', 'Search music');
  check('the search entry of the navigation is there', Boolean(searchNav), 'no search nav');
  if (searchNav) {
    click(searchNav);
    await wait(600);
    check('the search view opened', Boolean(body.querySelector('.lobby-view')), 'no .lobby-view');
    check('the search field is there', Boolean(body.querySelector('.lobby-view input')), 'no search input');
  }

  const libraryNav = findByText('.nav-item', 'Liked songs') || findByText('button', 'Liked songs');
  check('the library entry of the navigation is there', Boolean(libraryNav), 'no library nav');
  if (libraryNav) {
    click(libraryNav);
    await wait(600);
    check('the library view opened', Boolean(body.querySelector('.lobby-view')), 'no .lobby-view');
    check('the library shows the liked songs', body.textContent.includes('Liked songs'), 'no liked songs');
  }

  check('still no error was reported by React', problems.length === 0, problems.join(' | '));
} catch (err) {
  failures++;
  console.log('FAIL  the test crashed ->', err && err.message);
}

window.close();
console.log(failures === 0 ? '\nALL RENDER CHECKS PASSED' : `\n${failures} RENDER CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
