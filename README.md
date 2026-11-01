# ASS Subtitle Player

## Summary
Play local or searched .ass, .ssa, and .srt subtitles on YouTube, Netflix, Crunchyroll, and any web video. Features real-time sync, dual subtitles, drag positioning, OpenSubtitles search, and more.

---

## Description

Enhance your streaming and learning experience with **ASS Subtitle Player**! This lightweight and powerful extension allows you to overlay your own local subtitle files—or instantly search and download them—onto almost any web-based video player.

Whether you are watching YouTube, Netflix, Crunchyroll, or anime on custom platforms (like HiAnime), this extension ensures you can use your preferred subtitles with customizable browser-based rendering.

### ✨ Key Features:
* **Format & Platform Support:** Load **.ass**, **.ssa**, and **.srt** text subtitles across web video players. See the rendering limits below.
* **OpenSubtitles Integration:** Search for movie or TV show subtitles directly within the extension and load them with your own OpenSubtitles API key when the service is available. API limits and download quotas apply.
* **Dual Subtitles:** Display two different subtitle languages simultaneously (secondary stacked above primary, or below it when using top positioning), perfect for language learners.
* **Advanced Synchronization:** Fix out-of-sync subtitles easily using real-time delay (±0.1s/1s), frame shifting, permanent FPS conversions, or try the experimental audio-based auto-sync tool.
* **Drag & Drop & Custom Position:** Simply drag and drop subtitle files directly onto the video page. Enable "Drag-to-position" mode to freely move the subtitle box anywhere on the screen.
* **Site-Specific Styling:** Fully customize font, size, opacity, colors, and shadows. Save distinct visual styles specifically for different websites (e.g., 28px white for YouTube, 32px yellow for Crunchyroll).
* **Aspect Ratios & Fullscreen:** Switch between Auto, 16:9, 4:3, or the new Vertical mode (optimized for TikTok/Shorts). Ensures subtitles remain visible even on custom fullscreen wrappers like JW Player.
* **Keyboard Shortcuts:** Use `Alt` key combos to adjust delay, toggle dual subtitles, or quickly enable/disable the extension without opening the menu.
* **Auto-Restore:** Remembers your last used primary and secondary files. Automatic loading is opt-in; it is disabled by default to avoid showing the previous episode’s subtitles.
* **Bilingual UI:** Features a sleek, modern tabbed interface with full support for both English and Turkish languages.

### 🚀 How to Use:
1. Navigate to any website with a video player (e.g., YouTube, Netflix, HiAnime).
2. Click the **ASS Subtitle Player** icon in your browser toolbar to open the control panel.
3. **Load a Subtitle:** Click **"📁 Select subtitle"** to upload a local file, **OR** simply drag and drop the file onto the video player. 
4. **Search Online:** Save your own OpenSubtitles API key in the **Search** tab, then search for subtitles. Local files work without an API key.
5. Adjust styling, sync, or dual subtitle settings from their respective tabs.

### 💡 Why ASS Subtitle Player?
Many extensions struggle with modern video sites that use nested iframes or custom fullscreen implementations. **ASS Subtitle Player** uses an advanced injection and broadcasting system to detect the video player wherever it is hidden on the page, providing a seamless "plug-and-play" experience even on complex setups.

---

**Permissions Note:**
* `activeTab` & `scripting`: Required to render subtitles over the video.
* `storage` & `unlimitedStorage`: Used to remember your site profiles, preferences, saved sync delays, and the last loaded subtitle files.

## Rendering and platform limits

The extension uses a DOM text renderer, not libass. It supports SRT inline formatting and basic ASS/SSA overrides: bold, italic, underline, strikethrough, primary color, line breaks, hard spaces, alignment, and `\pos`. Positioned ASS text uses PlayRes coordinates and font sizes. It does not reproduce animated transforms, karaoke, vector drawings, embedded fonts, or every ASS style/effect. Drawing instructions are hidden rather than displayed as text.

UTF-8 and BOM-marked UTF-16 files are detected automatically; legacy Turkish files fall back to Windows-1254. Files are limited to 20 MB. Browser-internal pages, restricted extension stores, closed shadow roots, and inaccessible frames cannot be controlled. Profiles use the top page's hostname, including when its player is hosted in another frame.

Fullscreen player wrappers retain styled overlays. When a video element itself enters native fullscreen, the extension uses a native caption track with plain text; ASS positioning and custom styles are unavailable in that mode. Opening the file picker exits native video fullscreen when needed.

Audio sync is an experimental estimate, requires accessible captured audio, and may fail on protected or cross-origin streams. It analyses a captured copy and does not reroute the video's audio output. Closing the analysis panel releases the capture.

## Development and checks

The `chrome/` and `firefox/` folders contain the installable extensions. Their scripts are kept identical; their manifests use the appropriate browser background implementation. Load `chrome/` as an unpacked extension, or use Firefox's temporary add-on loader with `firefox/manifest.json`.

Run the dependency-free regression tests with Node.js 22 or later:

```sh
npm test
```

For DOM, layout, file picker, drag, fullscreen-state, and popup checks in Chromium and Firefox:

```sh
npm install --no-save --package-lock=false playwright@1.56.1
npx playwright install --with-deps chromium firefox
npm run test:browser
```

Browser tests use local fixtures and mocked extension transport/storage; they do not contact OpenSubtitles or spend download quota. GitHub Actions runs both suites on pushes and pull requests. The [2.3.5 audit notes](docs/AUDIT-2.3.5.md) describe the fixes and remaining platform limits.
