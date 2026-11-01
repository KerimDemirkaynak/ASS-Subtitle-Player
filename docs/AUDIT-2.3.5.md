# 2.3.5 correctness audit

Review baseline: `22c01a819629fe5fcedcf1da688ca4083e5d345e` (2.3.4).

## Fixed

- Removed the embedded OpenSubtitles API credential. Online search/download now require a user-owned key stored locally in extension storage. The key is loaded only by the background and popup, not by scripts on video pages. Existing published credentials should be rotated by their owner.

- Mobile startup tried to append a remote font stylesheet before `document.head` existed. Removed the external font request; fonts use normal installed-font fallbacks.
- UTF-8 ASS/SSA files were always read as Windows-1254. File reads now detect UTF-8/UTF-16 and fall back to Turkish ANSI only when UTF-8 is invalid.
- SRT parsing rejected CR-only lines, whitespace separators and compact arrows, and accepted invalid/backward timestamps. Parsing now normalizes line endings, validates times, and sorts valid cues.
- ASS parsing ignored the Events Format declaration, negative positions, layers, hard spaces, and drawing mode. It now respects declared columns, hides vector instructions, escapes literal HTML, and emits balanced inline formatting.
- Subtitle end times were inclusive, displaying adjacent cues together for an extra frame. End times are now exclusive, with overlap-aware lookup that also works when seeking backward.
- Popup delay nudges both saved an absolute delay and sent an increment, causing the increment to be applied twice. They now send an absolute value.
- Applying delay permanently raced with the popup resetting the stored delay. The command now includes the captured delay, and the player resets it after applying it.
- Permanent delay/FPS changes were lost on restoring a saved file. Each file now stores its timeline scale/offset, including negative offsets.
- Loading a new primary file reset only the content script's delay. It now resets the stored value and updates the popup too; restoring a saved file preserves the user's current delay.
- Empty frames could answer broadcast commands first, and multiple video frames could execute the same command. The background now selects one visible player frame and targets it explicitly.
- A top-page picker could load a subtitle into a different video instead of the requesting iframe. The picker now preserves the requesting frame ID and waits for a successful load acknowledgment.
- Invalid/empty files silently closed the picker. It now keeps the picker open, reports a localized error, and permits selecting a corrected file. Files are limited to 20 MB.
- Automatic restore depended on a saved primary file, so secondary-only files could fail to restore. Both tracks restore independently after settings and video discovery.
- Removing a video could leave its last subtitle visible. Losing the player now hides both overlays; page/video navigation clears active files when automatic restore is disabled.
- Resetting stored settings could leave loaded subtitle arrays active. Removing saved file keys now clears their active tracks too.
- Site presets matched hostname suffixes without a domain boundary, overwrote saved choices on reload, and differed between the popup and player. A shared resolver now handles defaults, saved global styles and site profiles consistently.
- Site profiles were saved with missing values and did not immediately update active styling. Profiles now save complete effective styles, update live, and use the top page's hostname for iframe players.
- The popup did not restore drag mode or refresh controls after keyboard changes. Controls now reflect storage updates and the current language.
- ASS overlays could make the secondary track use the entire video height as its primary-line height. Only the normal dialogue block is measured for stacking.
- Multiple default-aligned dialogues overlapped when mixed with positioned ASS signs. Default dialogues are now stacked together while signs retain their positions.
- Secondary subtitles ignored the horizontal drag offset. Both tracks now share the same offset.
- Dragging only handled mouse events and added window listeners every time a file was loaded. Containers are reused and dragging uses pointer capture, including touch pointers.
- A zero-width outline still painted a one-pixel outline. Zero is now respected; repeated shadow calculations are cached.
- The player rebuilt and reparsed subtitle HTML on every animation frame. Active cue lookup is indexed and the text DOM is reused while the active lines stay the same.
- Page CSS could change subtitle formatting. Subtitle content now lives in a shadow root, and only sanitized inline tags are imported.
- Native video fullscreen cannot paint ordinary DOM children. A native caption track now provides plain-text subtitles while native fullscreen is active.
- Auto-sync referenced an undefined `startTime`, retained audio nodes, could duplicate/reroute audio, and lacked cancellation. It now analyses a captured stream, uses the actual media-time window, and releases resources on completion, cancellation or video changes.
- Auto-sync could suggest a delay even when no cue matched any detected onset. A zero-match result no longer offers an Apply action.
- OpenSubtitles requests lacked timeouts and input validation. Requests now validate inputs, use timeouts, limit file size, and propagate API failures. Download success is shown only after the player acknowledges loading.
- Old search responses could replace newer results. The popup now discards obsolete search responses.
- Manifest descriptions exceeded Chromium's 132-character limit, and about:blank/origin-inherited video frames were not matched. Descriptions are shortened and matching is enabled.
- The reset confirmation incorrectly claimed that the extension would restart. It now describes clearing saved files.

## Verification

`npm test` covers both browser implementations, including parsing, encoding, timeline persistence, resets, profiles, frame routing, API failures, audio cleanup, manifest references and script parity. `npm run test:browser` exercises controlled local DOM fixtures in Chromium and Firefox, with desktop/mobile viewports and popup interaction. Extension API transport/storage and fullscreen state are mocked in those browser fixtures; these are not live Netflix/YouTube/OpenSubtitles integration tests.

The 45 dependency-free regression tests passed locally. Browser installation failed in the editing environment, so Chromium/Firefox scenarios are delegated to the included GitHub Actions workflow. Check the PR's latest workflow result for the browser-suite outcome.

## Deliberate limits

This remains a basic DOM subtitle renderer, not a full ASS/libass implementation. Complex typesetting, animated transforms, karaoke, embedded fonts, closed shadow roots, browser-restricted pages, and inaccessible/protected video/audio remain platform or renderer limits. Native video fullscreen uses plain text. Live OpenSubtitles availability and account/API quotas are external dependencies. No claim is made that every possible website or subtitle effect has been exhaustively verified.
