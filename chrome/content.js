// =========================================================================
// ASS Subtitle Player - content.js (v2.3.5)
// =========================================================================

const DEFAULTS = ASS_DEFAULTS;
let settings = resolveSubtitleSettings({}, location.hostname);
let storedSettings = {};
let pageHostname = subtitleHostname(location.hostname);

let activeVideo = null;
let customSubContainer = null;
let customSubContainer2 = null;
let parsedSubtitles = [];
let parsedSubtitles2 = [];
let syncAnimationId = null;
let videoWatchTimer = null;
let lastPrimaryRenderedHeight = 0; // Cache last known primary height for stable secondary positioning
let playResX = 384, playResY = 288;     // ASS PlayRes for primary (defaults per ASS spec)
let playResX2 = 384, playResY2 = 288;   // ASS PlayRes for secondary

function tr(key, vars) { return i18nText(key, settings.uiLang, vars); }

function applySitePreset() {
    settings = resolveSubtitleSettings(storedSettings, pageHostname);
}

function loadSettings(callback) {
    chrome.storage.local.get(Object.keys(DEFAULTS), (data) => {
        storedSettings = data;
        applySitePreset();
        if (callback) callback();
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, change] of Object.entries(changes)) {
        if (!(key in DEFAULTS)) continue;
        if (change.newValue === undefined) delete storedSettings[key];
        else storedSettings[key] = change.newValue;
        if (key === "lastSubtitle" && change.newValue === undefined) parsedSubtitles = [];
        if (key === "lastSubtitle2" && change.newValue === undefined) parsedSubtitles2 = [];
    }
    applySitePreset();
    updateSubStyle();
    updateSubStyle2();
});

loadSettings(tryInitialAutoRestore);
// Use the top page's host for saved profiles even when the player is cross-origin.
chrome.runtime.sendMessage({ type: "GET_SITE_HOST" }, (res) => {
    if (chrome.runtime.lastError || !res || !res.hostname) return;
    pageHostname = res.hostname;
    applySitePreset();
});

// Runs fn and tells the popup it worked ({ok:true}) or really failed (E104).
// Only the frame that owns the <video> answers, so empty frames can never
// produce a false error. Async actions acknowledge only after they finish.
function runAndAck(sendResponse, fn) {
    if (!getActiveVideo()) return;
    Promise.resolve().then(fn).then(
        () => sendResponse({ ok: true }),
        err => sendResponse({ ok: false, code: "E104", detail: String(err.message || err).slice(0, 160) })
    );
    return true;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case "SHOW_PICKER_UI":
            return runAndAck(sendResponse, () => openPicker(request.target || "primary"));
        case "SHOW_PICKER_TOP": {
            // Asked (via background) by a video iframe to show the picker in the top page
            if (window !== window.top) break;
            const fsEl = getFullscreenElement();
            if (fsEl && /^(IFRAME|VIDEO)$/i.test(fsEl.tagName)) { sendResponse({ ok: false }); break; }
            try {
                injectFilePickerUI(request.target || "primary", request.sourceFrameId);
                sendResponse({ ok: true });
            } catch (e) { sendResponse({ ok: false }); }
            break;
        }
        case "TOGGLE_EXTENSION":
            settings.isEnabled = request.isEnabled;
            break;
        case "TOGGLE_RATIO":
            settings.aspectMode = request.aspectMode;
            updateSubStyle();
            break;
        case "CHANGE_SIZE":
            settings.subSize = request.size;
            updateSubStyle();
            break;
        case "STYLE_UPDATE":
            Object.assign(settings, request.patch);
            updateSubStyle();
            updateSubStyle2();
            break;
        case "TOGGLE_DRAG_MODE":
            settings.dragMode = request.dragMode;
            updateSubStyle();
            break;
        case "ADJUST_DELAY":
            adjustDelay(request.delta);
            break;
        case "SET_DELAY":
            settings.delaySeconds = request.value;
            break;
        case "BAKE_DELAY":
            return runAndAck(sendResponse, () => bakeDelay(request.value));
        case "RESET_DELAY":
            settings.delaySeconds = 0;
            break;
        case "CONVERT_FPS":
            return runAndAck(sendResponse, () => convertFps(request.fromFps, request.toFps));
        case "TOGGLE_DUAL":
            settings.dualEnabled = request.dualEnabled;
            if (!settings.dualEnabled && customSubContainer2) customSubContainer2.style.display = "none";
            break;
        case "LOAD_SUBTITLE_TEXT":
            return runAndAck(sendResponse, () => loadSubtitleFromText(request.text, request.ext, request.name, request.target || "primary"));
        case "LOAD_LAST_SUBTITLE":
            return runAndAck(sendResponse, () => restoreLastSubtitle(request.target || "primary"));
        case "START_AUTO_SYNC":
            return runAndAck(sendResponse, () => startAutoSyncEstimate());
        case "SET_LANG":
            settings.uiLang = request.lang === "tr" ? "tr" : "en";
            break;
        case "GET_STATE":
            sendResponse({
                hasVideo: !!getActiveVideo(),
                primaryLoaded: parsedSubtitles.length > 0,
                secondaryLoaded: parsedSubtitles2.length > 0,
                delaySeconds: settings.delaySeconds,
                hostname: pageHostname,
                settings
            });
            break;
        default: return;
    }
    if (request.type !== "GET_STATE" && request.type !== "SHOW_PICKER_TOP") sendResponse({ ok: true });
});

function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement ||
           document.mozFullScreenElement || document.msFullscreenElement || null;
}

function ensureContainerParent(container) {
    if (!container) return;
    const fsEl = getFullscreenElement();
    const desiredParent = (fsEl && !/^(VIDEO|IFRAME)$/i.test(fsEl.tagName))
        ? fsEl : (document.body || document.documentElement);
    if (container.parentNode !== desiredParent) {
        try { desiredParent.appendChild(container); } catch (e) { /* ignore */ }
    }
}

["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"].forEach(evt => {
    document.addEventListener(evt, () => {
        ensureContainerParent(customSubContainer);
        ensureContainerParent(customSubContainer2);
        const toast = document.getElementById("ass-ext-toast");
        if (toast) ensureContainerParent(toast);
        updateSubStyle();
        updateSubStyle2();
    });
});

// ---- Toast: only show in the frame that actually owns the video ----
function isMainVideoFrame() {
    return !!getActiveVideo();
}

function showToast(msg) {
    // Guard: skip frames that have no video (avoids duplicates in sub-frames)
    if (!isMainVideoFrame()) return;

    let toast = document.getElementById("ass-ext-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "ass-ext-toast";
        toast.style.cssText = `
            position: fixed;
            background: rgba(46, 125, 50, 0.95);
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            font-family: 'Segoe UI', sans-serif;
            font-size: 13px;
            font-weight: bold;
            z-index: 2147483647;
            opacity: 0;
            transition: opacity 0.3s, transform 0.3s;
            pointer-events: none;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            border: 1px solid #388e3c;
            text-align: center;
        `;
        (document.body || document.documentElement).appendChild(toast);
    }

    ensureContainerParent(toast);
    toast.innerText = msg;

    if (activeVideo) {
        const rect = getVideoContentRect(activeVideo);
        const centerX = rect.left + rect.width / 2;
        const topY = rect.top + rect.height * 0.15;
        toast.style.left = `${centerX}px`;
        toast.style.top = `${topY}px`;
        toast.style.bottom = "auto";
        toast.style.transform = "translate(-50%, -50%)";
    } else {
        toast.style.left = "50%";
        toast.style.top = "auto";
        toast.style.bottom = "80px";
        toast.style.transform = "translateX(-50%)";
    }

    toast.style.opacity = "1";
    if (toast.hideTimeout) clearTimeout(toast.hideTimeout);
    toast.hideTimeout = setTimeout(() => { toast.style.opacity = "0"; }, 2500);
}

// Show the file picker in the TOP page (top-right of the browser viewport) instead of
// inside a small video iframe. If we are the top frame, or this frame is fullscreen
// (only its own content is visible then), or the relay fails, show it right here.
async function openPicker(target) {
    const fullscreen = getFullscreenElement();
    if (fullscreen && /^(VIDEO|IFRAME)$/i.test(fullscreen.tagName) && document.exitFullscreen) {
        await document.exitFullscreen();
    }
    if (window === window.top || getFullscreenElement()) { injectFilePickerUI(target); return; }
    const res = await chrome.runtime.sendMessage({ type: "OPEN_PICKER_TOP", target }).catch(() => null);
    if (!res || !res.ok) injectFilePickerUI(target);
}

function decodeSubtitleBytes(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (_) { return new TextDecoder("windows-1254").decode(bytes); }
}

async function readSubtitleFile(file) {
    if (!file || !/\.(ass|ssa|srt)$/i.test(file.name)) throw new Error(tr("subtitle_invalid_file"));
    if (file.size > 20 * 1024 * 1024) throw new Error(tr("subtitle_too_large"));
    return decodeSubtitleBytes(await file.arrayBuffer());
}

function injectFilePickerUI(target, sourceFrameId) {
    let existing = document.getElementById("ass-ext-floating-picker");
    if (existing) existing.remove();

    // Shadow DOM host: the page's own CSS (box-sizing, font-size, input/button rules,
    // line-height, zoom etc.) can't leak in, so the picker looks identical on every site.
    const host = document.createElement("div");
    host.id = "ass-ext-floating-picker";
    host.style.cssText = "all: initial; position: fixed; top: 20px; right: 20px; z-index: 2147483647; display: block;";
    const shadow = host.attachShadow({ mode: "open" });
    const css = document.createElement("style");
    css.textContent = `
        :host { all: initial; }
        * { box-sizing: border-box; margin: 0; letter-spacing: normal; text-transform: none;
            font-family: 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.35; }
        input, button { font-family: inherit; }
    `;
    shadow.appendChild(css);

    const container = document.createElement("div");
    container.style.cssText = `
        background: rgba(22, 22, 22, 0.97); padding: 15px; border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.7); border: 1px solid #3a3a3a;
        display: flex; flex-direction: column; gap: 10px;
        color: white; width: 260px; max-width: calc(100vw - 40px); font-size: 14px;
    `;

    const title = document.createElement("div");
    title.innerText = "🎬 " + tr(target === "secondary" ? "picker_title_secondary" : "picker_title_primary");
    title.style.cssText = "font-weight: bold; font-size: 14px; text-align: center; border-bottom: 1px solid #3a3a3a; padding-bottom: 5px; margin-bottom: 5px;";

    const dropHint = document.createElement("div");
    dropHint.innerText = tr("picker_drop_hint");
    dropHint.style.cssText = "font-size: 11px; color: #aaa; text-align:center;";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".ass,.ssa,.srt";
    fileInput.style.cssText = "color: white; font-size: 12px; cursor: pointer; width: 100%;";

    const closeBtn = document.createElement("button");
    closeBtn.innerText = tr("picker_cancel");
    closeBtn.style.cssText = "background: #d32f2f; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 5px;";
    closeBtn.onclick = () => host.remove();

    const errorLabel = document.createElement("div");
    errorLabel.style.cssText = "color:#ff8a80;font-size:12px;white-space:pre-wrap;";
    const handleFile = async (file) => {
        if (!file) return;
        fileInput.disabled = true;
        try {
            const text = await readSubtitleFile(file);
            const ext = file.name.split(".").pop().toLowerCase();
            if (sourceFrameId === undefined && getActiveVideo()) loadSubtitleFromText(text, ext, file.name, target);
            else {
                const response = await chrome.runtime.sendMessage({ type: "RELAY_SUBTITLE", text, ext, name: file.name, target, sourceFrameId });
                if (!response || !response.ok) throw new Error(response?.detail || tr("subtitle_load_failed"));
            }
            host.remove();
        } catch (error) { errorLabel.textContent = error.message; }
        finally { fileInput.disabled = false; fileInput.value = ""; }
    };

    fileInput.onchange = (e) => handleFile(e.target.files[0]);

    container.addEventListener("dragover", (e) => { e.preventDefault(); container.style.borderColor = "#ffb300"; });
    container.addEventListener("dragleave", () => { container.style.borderColor = "#3a3a3a"; });
    container.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.style.borderColor = "#3a3a3a";
        if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    container.appendChild(title);
    container.appendChild(dropHint);
    container.appendChild(fileInput);
    container.appendChild(errorLabel);
    container.appendChild(closeBtn);
    shadow.appendChild(container);
    const fsHost = getFullscreenElement();
    const mountHost = (fsHost && !/^(IFRAME|VIDEO)$/i.test(fsHost.tagName)) ? fsHost : document.documentElement;
    mountHost.appendChild(host);
}

document.addEventListener("dragover", (e) => {
    if (settings.isEnabled && getActiveVideo() && Array.from(e.dataTransfer?.types || []).includes("Files")) e.preventDefault();
});
document.addEventListener("drop", async (e) => {
    if (!settings.isEnabled || !getActiveVideo()) return;
    if (document.getElementById("ass-ext-floating-picker")) return;
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["ass","ssa","srt"].includes(ext)) return;
    e.preventDefault();
    try { loadSubtitleFromText(await readSubtitleFile(file), ext, file.name, "primary"); }
    catch (error) { showToast(error.message); }
});

function loadSubtitleFromText(text, extension, name, target, restored) {
    if (typeof text !== "string" || !["ass", "ssa", "srt"].includes(extension)) throw new Error(tr("subtitle_invalid_file"));
    if (text.length > 20 * 1024 * 1024) throw new Error(tr("subtitle_too_large"));
    let subs;
    let resX = 384, resY = 288;
    if (extension === "srt") {
        subs = parseSRT(text);
    } else {
        const result = parseASS(text);
        subs = result.subs;
        resX = result.resX;
        resY = result.resY;
    }
    if (subs.length === 0) throw new Error(tr("subtitle_no_cues"));
    stopAutoSync();
    const timing = { scale: 1, offset: 0, ...restored?.timing };
    if (!(timing.scale > 0) || !Number.isFinite(timing.scale) || !Number.isFinite(timing.offset)) throw new Error(tr("subtitle_load_failed"));
    subs.forEach(c => { c.start = c.start * timing.scale + timing.offset; c.end = c.end * timing.scale + timing.offset; });
    const stored = { name, ext: extension, content: text, timing };

    if (target === "secondary") {
        parsedSubtitles2 = subs;
        playResX2 = resX; playResY2 = resY;
        settings.lastSubtitle2 = stored;
        chrome.storage.local.set({ lastSubtitle2: settings.lastSubtitle2 });
        showToast(tr("toast_sub_loaded_sec"));
    } else {
        parsedSubtitles = subs;
        playResX = resX; playResY = resY;
        lastPrimaryRenderedHeight = 0;
        if (!restored) {
            settings.delaySeconds = 0;
            chrome.storage.local.set({ delaySeconds: 0 });
            broadcastDelay();
        }
        settings.lastSubtitle = stored;
        chrome.storage.local.set({ lastSubtitle: settings.lastSubtitle });
        showToast(tr("toast_sub_loaded"));
    }

    const video = getActiveVideo();
    if (video) {
        if (target === "secondary") initContainer2(video); else initContainer(video);
        ensureSyncLoop(video);
    }
}

function restoreLastSubtitle(target) {
    const stored = target === "secondary" ? settings.lastSubtitle2 : settings.lastSubtitle;
    if (!stored) throw new Error(tr("subtitle_no_saved"));
    loadSubtitleFromText(stored.content, stored.ext, stored.name, target, stored);
}

function normalizeSubtitleLines(text) {
    return String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function subtitleTime(value) {
    const match = String(value).trim().match(/^(\d+):([0-5]\d):([0-5]\d)(?:[.,](\d{1,3}))?$/);
    if (!match) return NaN;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number("0." + (match[4] || "0"));
}

function validSortedCues(cues) {
    return cues.filter(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && c.text.trim())
        .sort((a, b) => a.start - b.start);
}

function parseSRT(data) {
    const subs = [];
    const blocks = normalizeSubtitleLines(data).trim().split(/\n[\t ]*\n+/);
    for (const block of blocks) {
        const lines = block.split("\n");
        const index = lines.findIndex(line => line.includes("-->"));
        if (index < 0) continue;
        const times = lines[index].match(/^\s*(\d+:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d+:\d{2}:\d{2}[.,]\d{1,3})(?:\s+.*)?$/);
        if (!times) continue;
        subs.push({ start: subtitleTime(times[1]), end: subtitleTime(times[2]), text: lines.slice(index + 1).join("\n").trim() });
    }
    return validSortedCues(subs);
}

function escapeSubtitleHTML(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Emit balanced, sanitized inline markup per text run. Overrides never become raw HTML.
function convertASSFormattingToHTML(text) {
    const state = { b: false, i: false, u: false, s: false, color: null, drawing: false };
    const result = [];
    for (const part of text.split(/(\{[^}]*\})/g)) {
        if (part.startsWith("{") && part.endsWith("}")) {
            // Transform tags contain nested overrides that must not affect the whole line.
            const overrides = part.slice(1, -1).replace(/\\t\([^)]*\)/gi, "");
            for (const token of overrides.match(/\\[^\\]+/g) || []) {
                let m;
                if ((m = token.match(/^\\([bius])(-?\d+)\s*$/i))) {
                    state[m[1].toLowerCase()] = Number(m[2]) !== 0;
                } else if ((m = token.match(/^\\(?:1?c)(?:\s*&H([0-9a-f]{1,8})&?)?\s*$/i))) {
                    if (m[1]) {
                        const hex = m[1].padStart(6, "0").slice(-6);
                        state.color = "#" + hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2);
                    } else state.color = null;
                } else if ((m = token.match(/^\\p(\d+)\s*$/i))) state.drawing = Number(m[1]) > 0;
                else if (/^\\r/i.test(token)) Object.assign(state, { b: false, i: false, u: false, s: false, color: null });
            }
            continue;
        }
        if (!part || state.drawing) continue;
        let html = escapeSubtitleHTML(part).replace(/\\[Nn]/g, "\n").replace(/\\h/g, "\u00a0");
        for (const tag of ["s", "u", "i", "b"]) if (state[tag]) html = `<${tag}>${html}</${tag}>`;
        if (state.color) html = `<font color="${state.color}">${html}</font>`;
        result.push(html);
    }
    return result.join("").trim();
}

function parseASS(assText) {
    let resX = 384, resY = 288, foundResX = false, foundResY = false;
    const styles = Object.create(null), subs = [];
    let styleFormat = [], eventFormat = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
    let section = "";
    const ssaToAn = { 1: 1, 2: 2, 3: 3, 5: 7, 6: 8, 7: 9, 9: 4, 10: 5, 11: 6 };
    for (const line of normalizeSubtitleLines(assText).split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("[")) { section = trimmed.toLowerCase(); continue; }
        let match;
        if (section === "[script info]") {
            if ((match = trimmed.match(/^PlayResX\s*:\s*(\d+)/i))) { resX = Number(match[1]); foundResX = resX > 0; }
            if ((match = trimmed.match(/^PlayResY\s*:\s*(\d+)/i))) { resY = Number(match[1]); foundResY = resY > 0; }
        }
        if (section.includes("styles")) {
            if (/^Format:/i.test(trimmed)) styleFormat = trimmed.slice(7).split(",").map(s => s.trim().toLowerCase());
            if (/^Style:/i.test(trimmed)) {
                const values = trimmed.slice(6).split(",").map(s => s.trim());
                const get = key => values[styleFormat.indexOf(key)];
                const rawAlignment = Number(get("alignment")) || 2;
                styles[get("name")] = {
                    alignment: section === "[v4 styles]" ? (ssaToAn[rawAlignment] || 2) : rawAlignment,
                    fontSize: Number(get("fontsize")) || null
                };
            }
        }
        if (section !== "[events]") continue;
        if (/^Format:/i.test(trimmed)) { eventFormat = trimmed.slice(7).split(",").map(s => s.trim().toLowerCase()); continue; }
        if (!/^Dialogue:/i.test(trimmed)) continue;
        // Text is the final ASS field and may contain any number of commas.
        const values = trimmed.slice(9).split(",");
        if (values.length < eventFormat.length) continue;
        const textIndex = eventFormat.indexOf("text");
        if (textIndex !== eventFormat.length - 1) continue;
        const get = key => (values[eventFormat.indexOf(key)] || "").trim();
        const raw = values.slice(textIndex).join(",");
        const tags = (raw.match(/\{[^}]*\}/g) || []).join("").replace(/\\t\([^)]*\)/gi, "");
        const posMatch = tags.match(/\\pos\s*\(\s*([+-]?(?:\d*\.)?\d+)\s*,\s*([+-]?(?:\d*\.)?\d+)\s*\)/i);
        const anMatch = tags.match(/\\an([1-9])(?!\d)/i), aMatch = tags.match(/\\a(\d+)(?!\d)/i);
        const style = styles[get("style")] || {};
        const alignment = anMatch ? Number(anMatch[1]) : (aMatch ? ssaToAn[Number(aMatch[1])] : style.alignment);
        const fsMatch = tags.match(/\\fs(\d+(?:\.\d+)?)/i);
        subs.push({
            start: subtitleTime(get("start")), end: subtitleTime(get("end")),
            text: convertASSFormattingToHTML(raw),
            pos: posMatch ? { x: Number(posMatch[1]), y: Number(posMatch[2]) } : null,
            alignment: alignment >= 1 && alignment <= 9 ? alignment : 2,
            fontSize: fsMatch ? Number(fsMatch[1]) : (style.fontSize || null),
            layer: Number(get("layer")) || 0
        });
    }
    if (foundResX && !foundResY) resY = resX === 1280 ? 1024 : Math.round(resX * 3 / 4);
    else if (foundResY && !foundResX) resX = resY === 1024 ? 1280 : Math.round(resY * 4 / 3);
    return { subs: validSortedCues(subs), resX: resX > 0 ? resX : 384, resY: resY > 0 ? resY : 288 };
}

// Style one overlay entry (positioned / non-default alignment) like a real ASS renderer:
//  - font size = ASS font size (PlayRes units) scaled by video height / PlayResY
//    (still multiplied by the user's size slider)
//  - \pos is the anchor point of the text box according to the alignment (\an),
//    not always its bottom-centre; the box is also limited so it can't leave the video
function styleOverlayEntry(div, entry, rect, resX, resY, sizePercent) {
    let fontCss = "";
    const isSpecial = !!entry.pos || (entry.alignment && entry.alignment !== 2);
    if (isSpecial && entry.fontSize && resY > 0 && rect.height > 0) {
        const px = entry.fontSize * (rect.height / resY) * ((sizePercent || 100) / 100);
        fontCss = `font-size: ${Math.max(8, px).toFixed(2)}px; `;
    }
    if (!entry.pos) {
        div.style.cssText = getAlignmentCSS(entry.alignment) + fontCss;
        return;
    }
    const a = entry.alignment || 2;
    const col = [1,4,7].includes(a) ? "left" : ([3,6,9].includes(a) ? "right" : "center");
    const row = a <= 3 ? "bottom" : (a <= 6 ? "middle" : "top");
    const x = (entry.pos.x / resX) * rect.width;
    const y = (entry.pos.y / resY) * rect.height;
    const tx = col === "left" ? "0" : (col === "right" ? "-100%" : "-50%");
    const ty = row === "top" ? "0" : (row === "bottom" ? "-100%" : "-50%");
    let maxW = col === "left" ? rect.width - x : (col === "right" ? x : 2 * Math.min(x, rect.width - x));
    maxW = Math.max(rect.width * 0.15, Math.min(maxW, rect.width * 0.98));
    div.style.cssText = `
        position: absolute;
        left: ${x}px; top: ${y}px;
        transform: translate(${tx}, ${ty});
        width: max-content; max-width: ${maxW}px;
        white-space: pre-wrap; text-align: ${col};
        ${fontCss}
    `;
}

// Convert ASS \an alignment (numpad layout) to CSS absolute positioning
// 7=TL  8=TC  9=TR
// 4=ML  5=MC  6=MR
// 1=BL  2=BC  3=BR
function getAlignmentCSS(alignment) {
    const a = alignment || 2;
    const row = a <= 3 ? "bottom" : (a <= 6 ? "middle" : "top");
    const col = [1,4,7].includes(a) ? "left" : ([3,6,9].includes(a) ? "right" : "center");

    let css = "position: absolute; white-space: pre-wrap; max-width: 90%; ";

    // Vertical
    if (row === "bottom")     css += "bottom: 4%; ";
    else if (row === "top")   css += "top: 4%; ";
    else /* middle */         css += "top: 50%; ";

    // Horizontal
    if (col === "left")       css += "left: 4%; text-align: left; ";
    else if (col === "right") css += "right: 4%; text-align: right; ";
    else /* center */         css += "left: 50%; text-align: center; ";

    // Transforms for centering
    if (row === "middle" && col === "center") css += "transform: translate(-50%, -50%); ";
    else if (row === "middle")                css += "transform: translateY(-50%); ";
    else if (col === "center")                css += "transform: translateX(-50%); ";

    return css;
}

function adjustDelay(delta) {
    settings.delaySeconds = Math.round((settings.delaySeconds + delta) * 1000) / 1000;
    chrome.storage.local.set({ delaySeconds: settings.delaySeconds });
    broadcastDelay();
}

function transformTimelines(factor, offset) {
    const patch = {};
    for (const [cues, key] of [[parsedSubtitles, "lastSubtitle"], [parsedSubtitles2, "lastSubtitle2"]]) {
        if (!cues.length) continue;
        cues.forEach(c => { c.start = c.start * factor + offset; c.end = c.end * factor + offset; });
        cueIndexes.delete(cues);
        const stored = settings[key];
        if (stored) {
            const old = { scale: 1, offset: 0, ...stored.timing };
            settings[key] = { ...stored, timing: { scale: old.scale * factor, offset: old.offset * factor + offset } };
            patch[key] = settings[key];
        }
    }
    chrome.storage.local.set(patch);
}

function bakeDelay(value = settings.delaySeconds) {
    if (!Number.isFinite(value)) throw new Error("Invalid delay.");
    transformTimelines(1, value);
    settings.delaySeconds = 0;
    chrome.storage.local.set({ delaySeconds: 0 });
    broadcastDelay();
}

function convertFps(fromFps, toFps) {
    if (!(fromFps > 0) || !(toFps > 0) || !Number.isFinite(fromFps) || !Number.isFinite(toFps)) throw new Error("Invalid FPS.");
    if (fromFps !== toFps) transformTimelines(fromFps / toFps, 0);
}

function broadcastDelay() {
    chrome.runtime.sendMessage({ type: "DELAY_CHANGED", value: settings.delaySeconds }).catch(() => {});
}

window.addEventListener("keydown", (e) => {
    const focused = e.composedPath()[0] || document.activeElement;
    const tag = focused && focused.tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || focused?.isContentEditable) return;
    if (!getActiveVideo() || e.ctrlKey || e.metaKey) return;
    if (!e.altKey) return;

    switch (e.code) {
        case "ArrowRight": adjustDelay(e.shiftKey ? 1 : 0.1); e.preventDefault(); break;
        case "ArrowLeft":  adjustDelay(e.shiftKey ? -1 : -0.1); e.preventDefault(); break;
        case "Digit0":     settings.delaySeconds = 0; chrome.storage.local.set({ delaySeconds: 0 }); broadcastDelay(); e.preventDefault(); break;
        case "KeyE":       settings.isEnabled = !settings.isEnabled; chrome.storage.local.set({ isEnabled: settings.isEnabled }); e.preventDefault(); break;
        case "KeyD":       settings.dualEnabled = !settings.dualEnabled; chrome.storage.local.set({ dualEnabled: settings.dualEnabled }); e.preventDefault(); break;
        case "KeyP":       settings.dragMode = !settings.dragMode; chrome.storage.local.set({ dragMode: settings.dragMode }); updateSubStyle(); e.preventDefault(); break;
        case "KeyT":       settings.positionTop = !settings.positionTop; chrome.storage.local.set({ positionTop: settings.positionTop }); updateSubStyle(); e.preventDefault(); break;
    }
});

function getActiveVideo() {
    const videos = [];
    const visit = root => {
        videos.push(...root.querySelectorAll("video"));
        for (const el of root.querySelectorAll("*")) if (el.shadowRoot) visit(el.shadowRoot);
    };
    visit(document);
    let best = null, score = 0;
    for (const v of videos) {
        const r = v.getBoundingClientRect(), style = getComputedStyle(v);
        const width = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
        const height = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
        const fs = getFullscreenElement();
        const area = width * height * (!v.paused && !v.ended ? 2 : 1) * (fs && (fs === v || fs.contains(v)) ? 4 : 1);
        if (area > score) { best = v; score = area; }
    }
    return best;
}

let lastPageUrl = location.href;
let lastVideoSource = "";
function clearLoadedSubtitles() {
    parsedSubtitles = []; parsedSubtitles2 = [];
    lastPrimaryRenderedHeight = 0;
    stopAutoSync();
    renderEntries(customSubContainer, [], false);
    renderEntries(customSubContainer2, [], true);
}

function watchForVideoChanges() {
    if (videoWatchTimer) clearInterval(videoWatchTimer);
    videoWatchTimer = setInterval(() => {
        const v = getActiveVideo(), source = v?.currentSrc || "";
        if (location.href !== lastPageUrl || (source && lastVideoSource && source !== lastVideoSource)) {
            lastPageUrl = location.href;
            if (!settings.autoRestoreLastSubtitle) clearLoadedSubtitles();
            stopAutoSync();
        }
        lastVideoSource = source;
        if (v !== activeVideo) {
            stopAutoSync();
            activeVideo = v;
            if (v) {
                tryInitialAutoRestore();
                if (parsedSubtitles.length) initContainer(v);
                if (parsedSubtitles2.length) initContainer2(v);
                if (parsedSubtitles.length || parsedSubtitles2.length) ensureSyncLoop(v);
            } else {
                if (customSubContainer) customSubContainer.style.display = "none";
                if (customSubContainer2) customSubContainer2.style.display = "none";
            }
        }
    }, 800);
}
watchForVideoChanges();

function tryInitialAutoRestore() {
    const v = getActiveVideo();
    if (!v || !settings.autoRestoreLastSubtitle) return;
    activeVideo = v;
    for (const [target, cues, stored] of [["primary", parsedSubtitles, settings.lastSubtitle], ["secondary", parsedSubtitles2, settings.lastSubtitle2]]) {
        if (!cues.length && stored) {
            try { restoreLastSubtitle(target); } catch (_) { /* Invalid saved files must not stop video discovery. */ }
        }
    }
}

window.addEventListener("pagehide", () => {
    clearInterval(videoWatchTimer);
    if (syncAnimationId) cancelAnimationFrame(syncAnimationId);
    stopAutoSync();
});
window.addEventListener("pageshow", () => {
    watchForVideoChanges();
    if (activeVideo && (parsedSubtitles.length || parsedSubtitles2.length)) ensureSyncLoop(activeVideo);
});

// The old 4/8 integer-offset shadows left visible stair-steps (mobile AND desktop).
// Use a round ring of sub-pixel offsets with a tiny blur so the outline is
// anti-aliased. The number of directions grows with the outline width so wide
// outlines don't get scalloped edges; a second inner ring keeps thin glyph
// strokes from detaching from their outline.
function buildSmoothShadow(color, w, strong) {
    const ring = (radius, steps, blur) => {
        const out = [];
        for (let i = 0; i < steps; i++) {
            const a = (Math.PI * 2 * i) / steps;
            const x = (Math.cos(a) * radius).toFixed(2);
            const y = (Math.sin(a) * radius).toFixed(2);
            out.push(`${x}px ${y}px ${blur}px ${color}`);
        }
        return out;
    };
    // Radius/blur calibrated (by rendering old vs new) so the outline weight matches the
    // old 4/8-offset look: a plain ring at radius w looked ~10-25% thinner.
    const r = strong ? w * 1.2 : w;
    const blur = 0.8;
    const outerSteps = Math.min(32, Math.max(strong ? 16 : 12, Math.ceil(Math.PI * 2 * w)));
    const parts = ring(r, outerSteps, blur);
    if (strong || w >= 3) parts.push(...ring(r * 0.5, Math.max(8, Math.ceil(outerSteps / 2)), blur));
    if (strong) parts.push(`0px 0px ${w}px ${color}`);
    return parts.join(", ");
}

const textShadowCache = new Map();
function buildTextShadow(borderColor, borderWidth, shadowLevel) {
    if (shadowLevel === "none" || !(borderWidth > 0)) return "none";
    const w = Math.max(1, borderWidth);
    const key = `${borderColor}|${w}|${shadowLevel}`;
    if (!textShadowCache.has(key)) {
        if (textShadowCache.size >= 32) textShadowCache.delete(textShadowCache.keys().next().value);
        textShadowCache.set(key, buildSmoothShadow(borderColor, w, shadowLevel === "strong"));
    }
    return textShadowCache.get(key);
}

// ---- Safe subtitle renderer (handles <i>, <b>, <u>, <s>, <font color>, \n) --------
// Uses DOMParser so we never call innerHTML with untrusted content directly.
const SAFE_INLINE_TAGS = new Set(["i", "b", "u", "s", "em", "strong", "br", "font"]);
function setSubText(container, text) {
    container.textContent = ""; // clear safely
    if (!text) return;

    // Convert plain newlines to <br> so DOMParser sees them as breaks
    const html = text.replace(/\n/g, "<br>");

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    function importSafe(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return document.createTextNode(node.textContent);
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            if (SAFE_INLINE_TAGS.has(tag)) {
                const el = document.createElement(tag);
                // Only allow the 'color' attribute on <font>
                if (tag === "font" && node.getAttribute("color")) {
                    el.setAttribute("color", node.getAttribute("color"));
                }
                node.childNodes.forEach(child => {
                    const safe = importSafe(child);
                    if (safe) el.appendChild(safe);
                });
                return el;
            } else {
                // Unknown/unsafe tag: keep its text children, drop the tag itself
                const frag = document.createDocumentFragment();
                node.childNodes.forEach(child => {
                    const safe = importSafe(child);
                    if (safe) frag.appendChild(safe);
                });
                return frag;
            }
        }
        return null;
    }

    doc.body.childNodes.forEach(child => {
        const safe = importSafe(child);
        if (safe) container.appendChild(safe);
    });
}


// Returns the rectangle the video PICTURE actually occupies on screen.
// <video>.getBoundingClientRect() is the element box, which is the whole player area:
// with object-fit: contain (the default) a 16:9 video on a 20:9 phone screen or in a
// 4:3 box is letterboxed/pillarboxed INSIDE that box. Subtitles must be laid out against
// the picture (videoWidth x videoHeight aspect), not against the black bars.
function getVideoContentRect(video) {
    const r = video.getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh || r.width <= 0 || r.height <= 0) return r;

    const cs = getComputedStyle(video);
    const fit = cs.objectFit || "fill";
    // Content box = element box minus border and padding
    const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
    const pt = parseFloat(cs.paddingTop) || 0,  pb = parseFloat(cs.paddingBottom) || 0;
    const bl = parseFloat(cs.borderLeftWidth) || 0, br = parseFloat(cs.borderRightWidth) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0,  bb = parseFloat(cs.borderBottomWidth) || 0;
    const boxL = r.left + bl + pl, boxT = r.top + bt + pt;
    const boxW = r.width - bl - br - pl - pr, boxH = r.height - bt - bb - pt - pb;
    if (boxW <= 0 || boxH <= 0) return r;
    if (fit === "fill" || fit === "cover") return {
        left: boxL, top: boxT, width: boxW, height: boxH,
        right: boxL + boxW, bottom: boxT + boxH, x: boxL, y: boxT
    };

    let scale = Math.min(boxW / vw, boxH / vh);          // contain
    if (fit === "none") scale = 1;
    else if (fit === "scale-down") scale = Math.min(1, scale);
    const w = vw * scale, h = vh * scale;

    // object-position (computed value is "<x> <y>", percentages or lengths)
    const pos = (cs.objectPosition || "50% 50%").split(/\s+/);
    const off = (token, free) => {
        if (!token) return free / 2;
        if (token === "left" || token === "top") return 0;
        if (token === "right" || token === "bottom") return free;
        if (token.endsWith("%")) return free * (parseFloat(token) / 100);
        const px = parseFloat(token);
        return isNaN(px) ? free / 2 : px;
    };
    const left = boxL + off(pos[0], boxW - w);
    const top  = boxT + off(pos[1], boxH - h);
    return { left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top };
}

function computeBoxRect() {
    if (!activeVideo) return null;
    const rect = getVideoContentRect(activeVideo);
    if (rect.width === 0 || rect.height === 0) return null;
    const isVertical = settings.aspectMode === "vertical" ||
        (settings.aspectMode === "auto" && rect.height > rect.width * 1.1);
    const maxWidthRatio = isVertical ? 0.92 : (settings.aspectMode === "4:3" ? 0.65 : 0.9);
    return { rect, isVertical, maxWidthRatio };
}

const cueIndexes = new WeakMap();
function collectActiveEntries(cues, time) {
    let ends = cueIndexes.get(cues);
    if (!ends) {
        let maxEnd = -Infinity;
        ends = cues.map(c => (maxEnd = Math.max(maxEnd, c.end)));
        cueIndexes.set(cues, ends);
    }
    let lo = 0, hi = cues.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cues[mid].start <= time) lo = mid + 1; else hi = mid;
    }
    const active = [];
    for (let i = lo - 1; i >= 0 && ends[i] > time; i--) {
        if (cues[i].end > time) active.push(cues[i]);
    }
    // ASS layers paint in ascending order; retain source order within a layer.
    return active.reverse().sort((a, b) => (a.layer || 0) - (b.layer || 0));
}

function makeSubtitleContainer(id, draggable) {
    const container = document.createElement("div");
    container.id = id;
    const root = container.attachShadow({ mode: "open" });
    const css = document.createElement("style");
    css.textContent = "* { box-sizing: border-box; margin: 0; padding: 0; }";
    const content = document.createElement("div");
    root.append(css, content);
    container._assContent = content;
    if (draggable) enableDragHandlers(container);
    return container;
}

function initContainer(videoElement) {
    activeVideo = videoElement;
    if (!customSubContainer) customSubContainer = makeSubtitleContainer("ass-ext-primary", true);
    ensureContainerParent(customSubContainer);
    updateSubStyle();
}

function initContainer2(videoElement) {
    activeVideo = videoElement;
    if (!customSubContainer2) customSubContainer2 = makeSubtitleContainer("ass-ext-secondary", false);
    ensureContainerParent(customSubContainer2);
    updateSubStyle2();
}

function applyContainerStyle(container, secondary) {
    if (!container) return;
    const info = computeBoxRect();
    if (!info) { container.style.display = "none"; return; }
    const { rect, maxWidthRatio } = info;
    const size = secondary ? settings.subSize2 : settings.subSize;
    const font = secondary ? (settings.subFont2 || settings.subFont) : settings.subFont;
    const opacity = secondary ? settings.subOpacity2 : settings.subOpacity;
    const color = secondary ? settings.subColor2 : settings.subColor;
    const outline = secondary ? settings.borderColor2 : settings.borderColor;
    const width = secondary ? settings.borderWidth2 : settings.borderWidth;
    const shadow = secondary ? settings.shadowLevel2 : settings.shadowLevel;
    const fontPx = Math.min(58, Math.max(14, rect.width * 0.032)) * size / 100;
    const primaryFontPx = Math.min(58, Math.max(14, rect.width * 0.032)) * settings.subSize / 100;
    const primaryHeight = lastPrimaryRenderedHeight || primaryFontPx * 1.25;
    const stackOffset = secondary && parsedSubtitles.length ? primaryHeight + settings.dualGap : 0;
    const left = rect.left + rect.width / 2 + settings.posOffsetX;
    const anchor = settings.positionTop
        ? rect.top + rect.height * settings.edgeBottom / 100 - settings.posOffsetY + stackOffset
        : rect.top + rect.height * (1 - settings.edgeBottom / 100) - settings.posOffsetY - stackOffset;
    const position = settings.positionTop ? `top:${anchor}px;` : `bottom:${window.innerHeight - anchor}px;`;
    const overlay = container._assOverlay;
    const geometry = overlay
        ? `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`
        : `left:${left}px;${position}transform:translateX(-50%);width:${rect.width * maxWidthRatio}px;`;
    const dragging = settings.dragMode && !secondary;
    const css = `all:initial;position:fixed;${geometry}
        z-index:${secondary ? 2147483645 : 2147483646};text-align:center;
        font-family:${font};font-size:${fontPx}px;font-weight:bold;line-height:1.25;
        color:${color};opacity:${opacity / 100};white-space:pre-wrap;overflow-wrap:break-word;
        text-shadow:${buildTextShadow(outline, width, shadow)};
        pointer-events:${dragging && !overlay ? "auto" : "none"};
        touch-action:${dragging ? "none" : "auto"};
        ${dragging && !overlay ? "outline:1px dashed #ffb300;cursor:grab;" : ""}`;
    if (container._assCSS !== css) { container.style.cssText = css; container._assCSS = css; }
    container.style.display = settings.isEnabled && container._assEntries?.length && (!secondary || settings.dualEnabled) ? "block" : "none";
    if (overlay) {
        for (const node of container._assContent.children) {
            if (node._assDefault) {
                const top = anchor - rect.top;
                node.style.cssText = `position:absolute;left:${rect.width / 2 + settings.posOffsetX}px;
                    top:${top}px;transform:translate(-50%,${settings.positionTop ? "0" : "-100%"});
                    width:${rect.width * maxWidthRatio}px;white-space:pre-wrap;text-align:center;
                    pointer-events:${dragging ? "auto" : "none"};touch-action:${dragging ? "none" : "auto"};`;
            } else styleOverlayEntry(node, node._assEntry, rect, secondary ? playResX2 : playResX, secondary ? playResY2 : playResY, size);
        }
    }
}

function updateSubStyle() { applyContainerStyle(customSubContainer, false); }
function updateSubStyle2() { applyContainerStyle(customSubContainer2, true); }

function renderEntries(container, entries, secondary) {
    if (!container) return;
    const old = container._assEntries || [];
    const changed = old.length !== entries.length || entries.some((entry, i) => entry !== old[i]);
    if (changed) {
        container._assEntries = entries;
        container._assContent.textContent = "";
        container._assOverlay = entries.some(entry => entry.pos || (entry.alignment && entry.alignment !== 2));
        if (container._assOverlay) {
            const defaults = entries.filter(e => !e.pos && (!e.alignment || e.alignment === 2));
            for (const entry of entries) {
                if (defaults.includes(entry)) continue;
                const node = document.createElement("div");
                node._assEntry = entry;
                setSubText(node, entry.text);
                container._assContent.appendChild(node);
            }
            if (defaults.length) {
                const node = document.createElement("div");
                node._assDefault = true;
                setSubText(node, defaults.map(e => e.text).join("\n"));
                container._assContent.appendChild(node);
            }
        } else setSubText(container._assContent, entries.map(e => e.text).join("\n"));
    }
    applyContainerStyle(container, secondary);
    if (!secondary && entries.length && container.style.display !== "none") {
        const textBox = container._assOverlay ? Array.from(container._assContent.children).find(n => n._assDefault) : container;
        const height = textBox?.getBoundingClientRect().height;
        if (height > 0) lastPrimaryRenderedHeight = height;
    }
}

function enableDragHandlers(container) {
    let drag = null;
    container.addEventListener("pointerdown", e => {
        if (!settings.dragMode || (e.pointerType === "mouse" && e.button !== 0)) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, baseX: settings.posOffsetX, baseY: settings.posOffsetY };
        container.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    container.addEventListener("pointermove", e => {
        if (!drag || drag.id !== e.pointerId) return;
        settings.posOffsetX = drag.baseX + e.clientX - drag.x;
        settings.posOffsetY = drag.baseY - e.clientY + drag.y;
        updateSubStyle(); updateSubStyle2();
    });
    const endDrag = e => {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null;
        chrome.storage.local.set({ posOffsetX: settings.posOffsetX, posOffsetY: settings.posOffsetY });
    };
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) container.addEventListener(event, endDrag);
}

// Replaced video elements cannot paint DOM children in native fullscreen.
// Use one extension-owned native text track while that fullscreen mode is active.
const nativeTracks = new WeakMap();
let nativeTrack = null, nativeVideo = null, nativeText = "";
function updateNativeFullscreen(entries, entries2) {
    const nativeFullscreen = activeVideo && getFullscreenElement() === activeVideo;
    if (!nativeFullscreen || !settings.isEnabled) {
        if (nativeTrack) {
            nativeTrack.mode = "disabled";
            for (const cue of Array.from(nativeTrack.cues || [])) nativeTrack.removeCue(cue);
        }
        nativeText = "";
        return;
    }
    if (nativeVideo !== activeVideo) {
        if (nativeTrack) nativeTrack.mode = "disabled";
        nativeVideo = activeVideo;
        nativeTrack = nativeTracks.get(activeVideo);
        if (!nativeTrack) {
            nativeTrack = activeVideo.addTextTrack("subtitles", "ASS Subtitle Player", settings.uiLang);
            nativeTracks.set(activeVideo, nativeTrack);
        }
        nativeText = "";
    }
    nativeTrack.mode = "showing";
    const text = [...(settings.dualEnabled ? entries2 : []), ...entries].map(e => e.text).join("\n");
    if (text === nativeText) return;
    nativeText = text;
    for (const cue of Array.from(nativeTrack.cues || [])) nativeTrack.removeCue(cue);
    if (text) {
        const safe = document.createElement("div");
        setSubText(safe, text);
        for (const br of safe.querySelectorAll("br")) br.replaceWith(document.createTextNode("\n"));
        const cue = new VTTCue(0, Math.max(86400, activeVideo.currentTime + 86400), escapeSubtitleHTML(safe.textContent));
        cue.line = settings.positionTop ? 10 : 90;
        nativeTrack.addCue(cue);
    }
}

function ensureSyncLoop(videoElement) {
    activeVideo = videoElement;
    if (syncAnimationId) cancelAnimationFrame(syncAnimationId);
    function checkTime() {
        if (!activeVideo || !activeVideo.isConnected) activeVideo = getActiveVideo();
        if (!activeVideo) {
            if (customSubContainer) customSubContainer.style.display = "none";
            if (customSubContainer2) customSubContainer2.style.display = "none";
            updateNativeFullscreen([], []);
            syncAnimationId = null;
            return;
        }
        const t = activeVideo.currentTime - settings.delaySeconds;
        const entries = settings.isEnabled ? collectActiveEntries(parsedSubtitles, t) : [];
        const entries2 = settings.isEnabled && settings.dualEnabled ? collectActiveEntries(parsedSubtitles2, t) : [];
        ensureContainerParent(customSubContainer);
        ensureContainerParent(customSubContainer2);
        renderEntries(customSubContainer, entries, false);
        renderEntries(customSubContainer2, entries2, true);
        updateNativeFullscreen(entries, entries2);
        syncAnimationId = requestAnimationFrame(checkTime);
    }
    checkTime();
}

let autoSyncSession = null;
function stopAutoSync() {
    if (!autoSyncSession) return;
    const session = autoSyncSession;
    autoSyncSession = null;
    cancelAnimationFrame(session.animationId);
    session.source?.disconnect();
    session.analyser?.disconnect();
    session.stream?.getTracks().forEach(track => track.stop());
    if (session.context) session.context.close().catch(() => {});
}

async function startAutoSyncEstimate() {
    const video = getActiveVideo();
    if (!video) throw new Error(tr("autosync_no_video"));
    if (!parsedSubtitles.length) throw new Error(tr("autosync_need_subtitle"));
    stopAutoSync();
    const session = { video, animationId: null };
    autoSyncSession = session;
    try {
        // A MediaElementSource permanently reroutes playback and can mute cross-origin video.
        // Analyse a captured copy instead, without connecting it to the speakers.
        const capture = video.captureStream || video.mozCaptureStream;
        if (!capture) throw new Error(tr("autosync_capture_unavailable"));
        session.stream = capture.call(video);
        if (!session.stream.getAudioTracks().length) throw new Error(tr("autosync_capture_unavailable"));
        session.context = new (window.AudioContext || window.webkitAudioContext)();
        await session.context.resume();
        if (autoSyncSession !== session) return;
        session.source = session.context.createMediaStreamSource(session.stream);
        session.analyser = session.context.createAnalyser();
        session.analyser.fftSize = 1024;
        session.source.connect(session.analyser);
        showAutoSyncPanel(tr("autosync_analyzing"), null, true);
        if (video.paused) await video.play();
        if (autoSyncSession !== session) return;
        const data = new Uint8Array(session.analyser.fftSize), onsets = [];
        const startedAt = performance.now(), startTime = video.currentTime;
        let quietSince = startedAt, wasQuiet = true;
        let lastTime = startTime, lastWallTime = startedAt;
        const tick = () => {
            if (autoSyncSession !== session) return;
            const now = performance.now(), time = video.currentTime;
            const expected = (now - lastWallTime) / 1000 * video.playbackRate;
            if (!video.isConnected || Math.abs(time - lastTime - expected) > 2) {
                stopAutoSync();
                showAutoSyncPanel(tr("autosync_interrupted"), null);
                return;
            }
            lastTime = time; lastWallTime = now;
            session.analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (const sample of data) sum += (sample - 128) ** 2;
            const quiet = Math.sqrt(sum / data.length) < 6;
            if (quiet) { if (!wasQuiet) quietSince = now; wasQuiet = true; }
            else {
                if (wasQuiet && now - quietSince > 250) onsets.push(time);
                wasQuiet = false;
            }
            if (now - startedAt < 30000 && !video.paused && !video.ended) session.animationId = requestAnimationFrame(tick);
            else {
                stopAutoSync();
                finishAnalysis(onsets, startTime, time);
            }
        };
        session.animationId = requestAnimationFrame(tick);
    } catch (error) {
        if (autoSyncSession === session) {
            stopAutoSync();
            showAutoSyncPanel(tr("autosync_drm_error", { error: error.message }), null);
        }
    }
}

function finishAnalysis(onsets, windowStart, windowEnd) {
    if (onsets.length < 2) {
        showAutoSyncPanel(tr("autosync_not_enough_speech"), null);
        return;
    }
    const cueStarts = parsedSubtitles
        .map(c => c.start)
        .filter(s => s >= windowStart - 5 && s <= windowEnd + 5);

    if (cueStarts.length < 2) {
        showAutoSyncPanel(tr("autosync_not_enough_cues"), null);
        return;
    }

    let bestOffset = 0, bestScore = -1;
    for (let offset = -10; offset <= 10; offset += 0.05) {
        let score = 0;
        cueStarts.forEach(cs => {
            const target = cs + offset;
            if (onsets.some(o => Math.abs(o - target) < 0.15)) score++;
        });
        if (score > bestScore) { bestScore = score; bestOffset = offset; }
    }
    if (bestScore <= 0) { showAutoSyncPanel(tr("autosync_not_enough_speech"), null); return; }
    showAutoSyncPanel(
        tr("autosync_result", { offset: bestOffset.toFixed(2), score: bestScore, total: cueStarts.length }),
        bestOffset
    );
}

function showAutoSyncPanel(message, suggestedOffset, loadingOnly) {
    let panel = document.getElementById("ass-ext-autosync-panel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "ass-ext-autosync-panel";
        panel.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
            background: rgba(22,22,22,0.97); color: white; padding: 14px; border-radius: 10px;
            font-family: 'Segoe UI', sans-serif; font-size: 12px; width: 260px;
            border: 1px solid #3a3a3a; box-shadow: 0 4px 20px rgba(0,0,0,0.7);
        `;
        ensureContainerParent(panel);
    }
    ensureContainerParent(panel);
    panel.textContent = "";
    const msg = document.createElement("div");
    msg.innerText = message;
    msg.style.marginBottom = "8px";
    panel.appendChild(msg);

    {
        if (!loadingOnly && suggestedOffset !== null && suggestedOffset !== undefined) {
            const applyBtn = document.createElement("button");
            applyBtn.innerText = tr("autosync_apply");
            applyBtn.style.cssText = "background:#2e7d32;color:white;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;font-weight:bold;margin-right:6px;";
            applyBtn.onclick = () => {
                settings.delaySeconds = suggestedOffset;
                chrome.storage.local.set({ delaySeconds: suggestedOffset });
                broadcastDelay();
                panel.remove();
            };
            panel.appendChild(applyBtn);
        }
        const closeBtn = document.createElement("button");
        closeBtn.innerText = tr("autosync_close");
        closeBtn.style.cssText = "background:#555;color:white;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;";
        closeBtn.onclick = () => { stopAutoSync(); panel.remove(); };
        panel.appendChild(closeBtn);
    }
}
