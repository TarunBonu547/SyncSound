# SyncSound

Listen together. Create a room, share the link, and every track plays in sync for
everyone in it. Two people in the same room can also start a private video call
while the music keeps playing.

## Stack

- Frontend: React 19 + TypeScript + Vite
- Backend: Express + Socket.IO (`backend/`)
- Icons: lucide-react

## Getting started

```bash
npm install
node backend/server.js     # backend on http://localhost:4000
npm run dev                # frontend on http://localhost:5173
```

The frontend talks to the backend through Socket.IO. The backend URL comes from
`VITE_SOCKET_URL` and falls back to `http://localhost:4000`.

```bash
npm run build              # type check and production build
npm run preview            # serve the production build
npm run lint               # oxlint
```

## Configuration

Copy `.env.example` to `.env` and adjust it. Environment files are ignored by
git, so credentials never end up in the repository.

| Variable | Purpose |
| --- | --- |
| `VITE_SOCKET_URL` | Backend URL, defaults to `http://localhost:4000` |
| `VITE_ICE_SERVERS` | JSON array of `{ urls, username?, credential? }` ICE servers |
| `VITE_TURN_URL` | A single TURN server, used when `VITE_ICE_SERVERS` has none |
| `VITE_TURN_USERNAME` | Username for that TURN server |
| `VITE_TURN_CREDENTIAL` | Credential for that TURN server |
| `PORT` | Backend port, defaults to `4000` |
| `ROOM_TTL_MS` | How long an empty room survives, defaults to five minutes |
| `SYNC_DEBUG` | `1` enables the room sync diagnostics on the backend |
| `YOUTUBE_API_KEY` | Key of the YouTube Data API v3, read by the backend only |
| `YOUTUBE_SEARCH_CACHE_MS` | How long a search answer is kept in memory, `0` turns the cache off |
| `YOUTUBE_API_BASE_URL` | Address of the YouTube API, only meant for tests |
| `VITE_API_URL` | Address of the REST API, defaults to the socket server |

## YouTube search

The lobby and the add song form search YouTube by a song name, an artist or a
video title. The search runs on the **backend**, which holds the key of the
YouTube Data API v3. The browser never sees the key: it only ever sees the
results.

### Enabling the API

1. Open <https://console.cloud.google.com/apis/library>.
2. Pick or create a project.
3. Search for **YouTube Data API v3** and enable it.
4. Open **Credentials**, create an **API key** and copy it.
5. Put the key into the environment of the backend and start it again:

   ```bash
   # bash
   YOUTUBE_API_KEY=your-key node backend/server.js
   # powershell
   $env:YOUTUBE_API_KEY="your-key"; node backend/server.js
   ```

Without a key the search answers "not configured" and the lobby says so. The
queue, the playback and the chat keep working: they do not need the API.

### The endpoints

| Endpoint | What it does |
| --- | --- |
| `GET /api/youtube/search?q=&pageToken=&max=` | Searches YouTube and answers `{ ok, results, nextPageToken }`. A result has the video id, the title, the channel, the artwork and the length. |
| `GET /api/youtube/video?id=` | The details of one video, for a pasted link. |

The search trims the term, refuses an empty term and a term longer than 100
characters, limits the number of results to 25 and only accepts videos that
can be embedded. The lengths come from the video details of YouTube; when that
call fails the results are still returned, only without a length. The answer
of the same search is kept in the memory of the backend for a minute, so the
same search does not spend the quota twice.

Failures are reported with a status code and a safe message, never with the
answer of YouTube: a used up quota is `429`, an invalid key is `401`, a
disabled API is `503`, a broken or unreachable YouTube is `502` and a broken
input is `400`.

### The quota

A search of the `search.list` endpoint spends **100 units** of the daily
quota, the details endpoint spends one. The default quota of a project is
10.000 units a day, so about a hundred searches are possible. The cache and
the limit of 25 results per page keep that number in check.

### What the server trusts

The title, the channel and the artwork of a track that enters the queue are
checked by the server: the artwork may only point at the image hosts of
YouTube, and when the API is reachable the server looks the title up itself
instead of taking the one of the browser.

## Video call

The call is a private two person WebRTC session between the two members of a
room. It is completely separate from the music protocol: no queue operation,
playback state or room lifecycle event is touched by the call.

- `backend/callSignaling.js` relays the signaling between the two participants
  and validates every payload. A room carries at most one call at a time, and
  SDP, ICE candidates and credentials are never logged.
- `src/features/call/useVideoCall.ts` owns the media, the peer connection and
  the signaling listeners. The call is only reported as *connected* once the
  peer connection actually reaches the `connected` state.
- `src/features/call/FloatingCallWindow.tsx` is the user interface. The window
  floats above the application, so opening, moving or resizing it never moves
  the player, the queue or the chat. It can be dragged by its title bar and
  resized by its eight handles, and it is kept inside the window of the screen.
  Closing it only *hides* it: a call that is running keeps running and a small
  button brings the window back. Only **End call** ends the call. The panel
  stays mounted while the room is open, so an incoming call is noticed even
  when the window is closed.

Signaling events: `call:invite`, `call:accept`, `call:decline`, `call:hangup`,
`call:media`, `call:offer`, `call:answer` and `call:ice` in both directions.

### ICE, TURN and HTTPS

- **STUN** only tells the browser the public address of a computer. That is
  enough for most home networks, and the public Google STUN servers are used
  automatically when nothing is configured.
- **TURN** relays the media when no direct path exists (symmetric NAT, some
  corporate firewalls). Configure a TURN server for reliable calls.
  TURN credentials are visible in the browser by design, so use short lived,
  time limited credentials and keep them out of source control.
- **HTTPS** is required outside of `localhost`: browsers only hand out the
  camera and the microphone on a secure origin.

Production setup:

1. Serve the frontend over HTTPS.
2. Set `VITE_TURN_URL`, `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL`, or a
   full `VITE_ICE_SERVERS` list.
3. Keep the TURN server reachable over `turn:host:port` and `turns:host:port`.

## The lobby

The sidebar leads to the three parts of the lobby. The room keeps playing
while the lobby is in front of it, and the mini player at the bottom leads back
into it.

- **Start screen** (`src/pages/CreateRoom.tsx`, `src/pages/JoinRoom.tsx`): a
  room is created with a name, or a room code is typed. The code is not case
  sensitive, so a code that was typed by hand finds the same room.
- **Search** (`src/pages/SearchView.tsx`): a song name, an artist or a video
  title is looked up on YouTube, and the results can go into the queue of the
  room or start right away. A pasted YouTube link is looked up as well, so the
  old way of adding a track still works. A queue needs a room, so without one
  the search says so instead of offering a button that cannot work. See
  [YouTube search](#youtube-search).
- **Your Library** (`src/pages/LibraryView.tsx`): the tracks that were hearted
  and the tracks that were heard, kept on this device. Playlists are not part
  of SyncSound, so that part stays empty instead of pretending.

The heart of the player marks the track that plays as a liked song. A liked
track keeps its title, its channel and its artwork, so the library can show it
after the room is left.

## Your room

- `create-room` makes a room and puts the creator in it. The creator is the
  **host**; everybody else is a **listener**. The name is taken from a client
  id that lives in the session storage of the tab, so a refresh keeps the host
  role and does not create a second listener.
- `join-room` puts a client in a room. Room codes are not case sensitive, so a
  code that was typed by hand (`ss-ab12cd`) finds the same room as the
  original one.
- `leave-room` leaves the room on purpose. A client that creates or joins
  another room leaves the old one automatically, so nobody receives the events
  of two rooms at the same time.
- `room-update` tells the members of a room that somebody joined or left. It
  carries the member count and the list of members with their name, their role
  and their client id.
- The invite link (`/?room=SS-XXXXXX`) joins the room right away, so the other
  person only has to open it. The link is copied with the clipboard; if the
  clipboard is not available the dialog shows the link so it can be copied by
  hand.
- After a reconnect the client joins the room again and receives the current
  queue, the playback state, the members and the chat history.
- The **Add to Queue** panel searches YouTube by a song name, an artist or a
  title, and takes a pasted YouTube link as well. The results appear under the
  form: *Add to Queue* puts a track into the shared queue of the room, *Load*
  starts it for everybody. Both use the same queue commands as every other
  track, so there is only one queue and one playback.

## Live chat

- The chat is owned by the server. A client sends `chat:send` with the room
  code and the text; the server decides who the sender is, stores the message
  and sends it to that room only.
- The server refuses a message that is empty or only whitespace, a message
  that is longer than 500 characters and a message from a client that is not a
  member of the room. A client of another room can never write into a room it
  is not in, and a message only ever reaches the room it was written in.
- The client only shows a message when the server accepted it, so a failed
  send keeps the text and can be retried. A message is identified by the id of
  the server, which is used as the key of the list: a duplicated broadcast can
  never become a second bubble.
- The text is rendered as text, never as markup, so a message cannot inject
  anything into the page.
- **History:** the chat is kept in the memory of the room, like the queue and
  the playback state. A client that joins or reconnects receives the last
  messages of the room, so the chat survives a refresh and a reconnect. It does
  **not** survive the room itself: when the last member leaves, the room is
  removed after five minutes (`ROOM_TTL_MS`) and the chat is gone with it.
  There is no database, so nothing is kept longer than the life of the room.

## The interface

The interface was rebuilt around a warm, calm palette and three fixed places:
the navigation on the left, the stage in the middle, the chat on the right.

- **The palette** lives in `src/index.css` as tokens: a cream background
  (`#FFFAF3`), a deep violet ink (`#302B42`) and pastels for the accents
  (`#D9CAFF`, `#FFBDA8`, `#FFE18A`, `#A9E9CE`, `#A8DDF7`, `#FFC4DF`). The
  spacing, the radii, the shadows and the motions are tokens as well, so every
  screen looks the same.
- **The stage** (`src/components/player/MainPlayer.tsx`) holds the video, the
  title, the artist, the scrubber and the transport. The transport knows the
  queue of the room, so *previous* and *next* walk through the shared queue
  and every listener hears the same change.
- **The mini player** (`src/components/player/MiniPlayer.tsx`) stays at the
  bottom of the screen in every view. It shows the artwork, the title and the
  progress of the track that plays, and it brings the room back.
- **The chat** is a column of the room and a drawer on narrow screens. The
  drawer is only mounted on a narrow screen, so the chat never exists twice.
- **The room header** shows the name of the room, its code, the members and
  the button of the video call.
- **The call** floats above everything (`src/features/call/FloatingCallWindow.tsx`).
- Every member is drawn with initials and a colour that is derived from the
  name, so no picture of a stranger is loaded from the internet.

### The narrow screens

The layout has three breakpoints: the full layout above 1240px, a layout
without the chat column below 1024px (the chat becomes a drawer) and a layout
with a single column below 720px (the navigation becomes a menu). The
interface honours `prefers-reduced-motion`, and every control can be reached
with the keyboard.

## The video of the room

The stage shows the **real video** of the track, not only its artwork. It is
the YouTube IFrame Player API (`src/hooks/useYouTubePlayer.ts`) that puts an
iframe into the stage; the artwork stays behind it as the picture of a track
that is still loading.

- The player is created **once** for the container of the stage. A track that
  changes is cued in the same player, so a room never ends up with two
  videos in the stage.
- The player is not owned by React: the API replaces the element it is given
  with its own iframe, so the element lives outside of React and the rest of
  the interface keeps updating.
- The video fills the stage (16:9) without stretching and without overflow;
  the title, the artist, the heart and the scrubber stay where they were.
- The **mini player** stays compact: it shows the artwork, the title and the
  progress of the track, but no second video.
- Loading, a video that is not available, a video whose owner does not allow
  it to be played and a browser that refuses the automatic start are all
  reported in the stage. The rules of YouTube are respected: nothing is
  worked around.
- The room stays the authority: play, pause, seek, the track change and the
  end of a track are the commands of the server, exactly as before.

## The name of a person

Every person chooses the name the others see before the room is entered.
The field sits on both ways into a room: **Start a room** and **Enter a
room**.

- The name is at most 24 characters long, the spaces are tidied up and the
  control characters are removed. A name that is empty after that is refused
  with a hint in the field.
- The name is remembered in the browser (`localStorage`), so a refresh or the
  next room does not ask for it again.
- The name is **text of the user**: it is only ever shown as text, never as
  markup, and it never identifies anybody. The client id of the tab stays the
  identity, so two people may carry the same name without breaking anything.
- The name travels through `create-room` and `join-room` and comes back in
  the member list, in the chat and in the presence of the room.
- A client that does not send a name (an older version) keeps a safe
  fallback: the host is *Host*, every other member is *Listener 1*, *Listener
  2* and so on.

## Tests

The tests talk to a running backend, so start it first:

```bash
node backend/server.js     # in one terminal
npm test                   # in another one
```

| Command | What it checks |
| --- | --- |
| `npm run test:room` | Creating, joining and leaving a room, the host role, the member list, the case insensitive room code and the presence updates. |
| `npm run test:chat` | Sending and receiving messages, the empty and too long rules, the membership check, the isolation between rooms and the history of the room. |
| `npm run test:queue` | The commands of the interface that the other tests do not touch: moving a track, taking a track out, the play and pause command with its position, the report that a track ended and the refusal of a command of a stranger. |
| `npm run test:display-name` | The name a person is seen under: the cleaning of the name in the browser, the name in the member list and in the chat, two people with the same name and the fallback of an older client. |
| `npm run test:search` | The search of the backend against a stub of YouTube (validation, mapping, pagination, quota, invalid key, broken answers) and the search client of the browser (reading the answers, ignoring a slow answer of an older search). |
| `npm run test:render` | The whole interface in a DOM: the screens really paint, a name is asked for before the room is entered, a room is really created, a track is really searched and really enters the shared queue, the video of the room really plays in the stage and the navigation really opens the other screens. |

Both tests use several real clients at the same time. The search test starts
its own backend and its own stub of YouTube, so it needs neither a key nor a
quota. The render test mounts the real application, so it needs a backend with
a working `YOUTUBE_API_KEY` for the search.

## Music synchronization

The server owns the room timeline. Clients send explicit commands (play, pause,
seek) and the server broadcasts the authoritative state, so every listener hears
the same track at the same position. A late joiner receives the current
position and the queue, a track that ends advances the room exactly once, and
stale or repeated end events are rejected. See `backend/roomState.js`.
