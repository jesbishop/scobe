# Vanta architecture

Vanta is a desktop infinite canvas of **real website views**. The shell is Electron + React. Each canvas browser is a live Chromium `WebContentsView`, not an iframe, screenshot, or HWND overlay of installed Chrome.

## What must stay true

1. Real websites, not screenshots or iframe simulations.
2. Many independent browser frames on one infinite canvas.
3. Move and resize frames; **resize changes the page’s layout viewport** so responsive behavior is real.
4. Canvas zoom scales the view visually (`setZoomFactor`). It must not change the logical viewport.
5. Normal navigation chrome: URL, back, forward, reload, close.
6. One persistent session (`partition: persist:vanta-browser`) shared across frames.
7. No stealing cookies from the user’s everyday Chrome, and no weakening site security.
8. Inspect, computer-use, and AI chat operate on the **same** live page surface.

## Decision: Electron `WebContentsView` for pages

Installed Chrome + HWND overlay + CDP was tried first so Google login would look like a normal browser. That path failed in two ways:

- A full Chrome window (tabs + omnibox) appeared over Vanta instead of a canvas hole.
- `--remote-debugging-port` made Google reject sign-in (`accounts.google.com/.../signin/rejected`).
- A MV3 extension without CDP still did not place pages into canvas frames.

The current stack uses one Chromium control plane so geometry, inspect, screenshots, and input dispatch stay in sync:

| Layer | Choice | Why |
| --- | --- | --- |
| App shell / canvas UI | **Electron + React** | Windowing, DPI, IPC, pan/zoom UI. |
| Website rendering | **`WebContentsView`** | Real Chromium pages in the Vanta window, sized to each frame hole. |
| Sessions | **`persist:vanta-browser`** | Shared cookies/storage across frames, isolated from daily Chrome. |
| OAuth popups | **`setWindowOpenHandler({ action: 'allow' })`** | Same partition; real windows for `window.open`. |
| Inspect | Injected overlay + poll | Hover highlight and element snapshot on the selected page. |
| Computer-use | `capturePage` + `sendInputEvent` / `insertText` | Screenshot then click/type/scroll/key on that view. |
| AI chat | Anthropic tool loop in main | Tools call the same `BrowserHost` the UI uses. |
| Workspace | **JSON in Electron userData** | Camera + frame URLs/positions/sizes. |

Google and some other identity providers may still block embedded Chromium. That is accepted for now so inspect / AI / computer-use can ship on a real page surface. Debugger is **not** attached by default.

## Canvas contract

```
Electron window
  └─ React infinite canvas (pan / zoom via CSS transform)
       └─ Frame chrome (URL bar, resize handles)  ← HTML, transformed
            └─ Content hole (empty)               ← measured with getBoundingClientRect
                 └─ WebContentsView bounds = hole in window client DIP
                    zoomFactor = hole.width / logical viewport width
```

Invariants:

- **Frame resize** updates the logical viewport (`width` × `height`) and the view size. The page reflows.
- **Canvas zoom** changes the hole’s screen size and `zoomFactor`. Layout width/height stay at the logical size.
- **Canvas pan** only moves view origin.
- During pan, zoom, move, and resize, views hide (`setVisible(false)` / detach) so the gesture is not stolen.

## Process and module map

```
main/
  index.ts         Electron window, IPC, workspace restore, agent IPC
  chrome.ts        WebContentsView host: layout, inspect, screenshot, input
  inspectScript.ts Injected hover/click inspector
  agent.ts         Anthropic tool loop
  env.ts           Load ANTHROPIC_API_KEY from .env
  workspace.ts     Load/save camera + frames
preload/           Isolated IPC bridge
renderer/          Canvas, frames, inspect HUD, AI chat
shared/            Types, URL normalization
```

The renderer never talks to a page directly. It reports geometry and user intent. Main is the only process that creates views or dispatches input.

## Persistence

| Data | Where | Lifetime |
| --- | --- | --- |
| Cookies, storage, logins | Electron session `persist:vanta-browser` | Until the user clears app data |
| Camera, frame rects, URLs | `userData/workspace.json` | Saved on change and on quit |
| App UI | Ephemeral | Recreated from workspace |

## Features now in tree

| Feature | Hook |
| --- | --- |
| Inspect mode | Select a frame → Inspect. Hover highlight in-page; panel shows tag/box/styles. Click pins and blocks the page click. |
| Computer-use | `screenshot`, `click`, `type_text`, `press_key`, `scroll`, `navigate` on a canvas view. Click coords are screenshot pixels. |
| AI chat | Renderer sidebar → `vanta:runAgent`. Tools open/list/operate canvas browsers. Requires `ANTHROPIC_API_KEY`. |
| Coding-agent “open a browser” | Same `createBrowser` path as the Add browser button (`open_browser` tool). |

## How to run

```bash
npm install
```

Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` if you want AI chat.

```bash
npm run dev
```
