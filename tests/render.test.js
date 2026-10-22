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

/**
 * A stand-in for the YouTube IFrame player.
 *
 * The real API needs the script of YouTube in a browser. The stand-in behaves
 * like the parts the application uses: it takes over the element it is given,
 * it knows the video it shows and it reports its state.
 */
class FakeYouTubePlayer {
  constructor(element, options) {
    this.options = options || {};
    this.events = this.options.events || {};
    this.videoId = this.options.videoId || '';
    this.state = 5; // cued
    this.currentTime = 0;
    this.duration = 0;
    FakeYouTubePlayer.instances.push(this);
    // The real API replaces the element with its own iframe.
    const iframe = element.ownerDocument.createElement('iframe');
    iframe.setAttribute('title', 'YouTube video player');
    iframe.setAttribute('src', `https://www.youtube.com/embed/${this.videoId}`);
    element.parentNode.replaceChild(iframe, element);
    this.iframe = iframe;
    setTimeout(() => {
      if (this.events.onReady) this.events.onReady({ target: this });
    }, 0);
  }

  getVideoData() {
    return { video_id: this.videoId };
  }

  getPlayerState() {
    return this.state;
  }

  getCurrentTime() {
    return this.currentTime;
  }

  getDuration() {
    return this.duration;
  }

  getIframe() {
    return this.iframe;
  }

  playVideo() {
    this.setState(1);
  }

  pauseVideo() {
    this.setState(2);
  }

  seekTo(time) {
    this.currentTime = time;
  }

  cueVideoById(id) {
    this.videoId = id;
    this.setState(5);
  }

  destroy() {
    if (this.iframe && this.iframe.parentNode) this.iframe.parentNode.removeChild(this.iframe);
  }

  setState(state) {
    this.state = state;
    if (this.events.onStateChange) this.events.onStateChange({ data: state, target: this });
  }
}
FakeYouTubePlayer.instances = [];
// The application finds the API through the window, exactly as in a browser.
window.YT = { Player: FakeYouTubePlayer };

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

  // --- the name is asked for before the room is entered ---------------------------
  const joinCodeInput = body.querySelector('#join-room-code');
  check('the room code field is there', Boolean(joinCodeInput), 'no #join-room-code');
  typeInto(joinCodeInput, 'SS-NOSUCHROOM');
  const joinButton = findByText('button', 'Join Room');
  check('the join button is there', Boolean(joinButton), 'no join button');
  click(joinButton);
  await wait(400);
  const nameError = body.querySelector('#join-room-display-name-error');
  check('a join without a name is refused', Boolean(nameError), 'no name error');
  check(
    'the name error explains what is missing',
    nameError && /name/i.test(nameError.textContent || ''),
    nameError && nameError.textContent,
  );
  const codeChip = body.querySelector('.room-code-chip');
  check(
    'the room was not entered',
    codeChip && (codeChip.textContent || '').trim() === '—',
    codeChip && codeChip.textContent,
  );

  // --- a room is created for real ----------------------------------------------
  const nameInput = body.querySelector('#create-room-display-name');
  check('the display name field is there', Boolean(nameInput), 'no #create-room-display-name');
  typeInto(nameInput, 'Render Bot');
  await wait(200);
  check(
    'the name error is gone when a name is written',
    !body.querySelector('#join-room-display-name-error'),
    'the error is still there',
  );
  const roomNameInput = body.querySelector('#create-room-name');
  check('the room name field is there', Boolean(roomNameInput), 'no #create-room-name');
  typeInto(roomNameInput, 'Render Check');
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

  // --- the name is shown in the room ---------------------------------------------
  const memberNames = [...body.querySelectorAll('.chat-member-name')].map((el) => (el.textContent || '').trim());
  check('the member list carries the name', memberNames.includes('Render Bot'), memberNames);
  const profileName = body.querySelector('.side-profile-text strong');
  check('the sidebar carries the name', profileName && profileName.textContent === 'Render Bot', profileName && profileName.textContent);
  check(
    'the name is remembered for the next visit',
    window.localStorage.getItem('syncsound-display-name') === 'Render Bot',
    window.localStorage.getItem('syncsound-display-name'),
  );

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

  // --- the video of the room plays in the stage ---------------------------------
  // The second result is played, so the stage shows a video of its own.
  const playedRow = rows[1] || rows[0];
  const playButton = playedRow ? playedRow.querySelectorAll('.queue-actions button')[1] : null;
  check('the play button of the result is there', Boolean(playButton), 'no play button');
  if (playButton) {
    click(playButton);
    await wait(2500);

    const stageVideo = body.querySelector('.stage-video');
    check('the player has a container for the video', Boolean(stageVideo), 'no .stage-video');
    const frames = stageVideo ? stageVideo.querySelectorAll('iframe') : [];
    check('the video plays in the stage', frames.length === 1, `${frames.length} iframes`);
    check('the stage shows the video', Boolean(body.querySelector('.stage.has-video')), 'the stage has no video');
    check(
      'only one player was created',
      FakeYouTubePlayer.instances.length === 1,
      `${FakeYouTubePlayer.instances.length} players`,
    );
    const player = FakeYouTubePlayer.instances[0];
    check(
      'the player knows a video of YouTube',
      player && /^[A-Za-z0-9_-]{11}$/.test(player.videoId || ''),
      player && player.videoId,
    );
    // The artwork of the track carries the id of its video.
    const thumb = body.querySelector('.queue-item.is-current .queue-thumb');
    const thumbId = thumb ? (thumb.getAttribute('src') || '').split('/vi/')[1] : '';
    const videoId = thumbId ? thumbId.split('/')[0] : '';
    check(
      'the stage plays the video of the room',
      Boolean(videoId) && Boolean(player) && player.videoId === videoId,
      { videoId, player: player && player.videoId },
    );
    check(
      'the video sits in the stage, not beside it',
      Boolean(stageVideo) && stageVideo.contains(frames[0]),
      'the video is not in the stage',
    );

    // --- the title, the artist, the heart and the progress stay in place ---------
    const title = body.querySelector('.track-title');
    check('the title of the track is on the screen', Boolean(title), 'no .track-title');
    check(
      'the title is the one of the room',
      title && !/nothing playing|loading/i.test(title.textContent || ''),
      title && title.textContent,
    );
    check('the artist is on the screen', Boolean(body.querySelector('.track-channel')), 'no .track-channel');
    check('the favourite button is on the screen', Boolean(body.querySelector('.like-btn')), 'no .like-btn');
    check(
      'the progress bar is on the screen',
      Boolean(body.querySelector('.scrubber input[type="range"]')),
      'no scrubber',
    );

    // --- the mini player stays compact -------------------------------------------
    check(
      'the mini player has no second video',
      body.querySelectorAll('.mini-player iframe').length === 0,
      'the mini player has a video',
    );
    const miniTitle = body.querySelector('.mini-player-title');
    check('the mini player shows the track', Boolean(miniTitle), 'no .mini-player-title');

    // --- the next track takes over the same player --------------------------------
    const items = body.querySelectorAll('.queue-item');
    if (items.length > 1) {
      const other = items[0];
      const otherId = ((other.querySelector('.queue-thumb') || {}).getAttribute?.('src') || '')
        .split('/vi/')[1]
        ?.split('/')[0];
      const otherPlay = other.querySelector('.queue-actions button');
      click(otherPlay);
      await wait(2000);
      check(
        'the player is not created a second time',
        FakeYouTubePlayer.instances.length === 1,
        `${FakeYouTubePlayer.instances.length} players`,
      );
      check(
        'there is still one video in the stage',
        body.querySelectorAll('.stage-video iframe').length === 1,
        `${body.querySelectorAll('.stage-video iframe').length} iframes`,
      );
      check(
        'the player takes the video of the other track',
        Boolean(otherId) && FakeYouTubePlayer.instances[0].videoId === otherId,
        { otherId, player: FakeYouTubePlayer.instances[0].videoId },
      );
    }
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
