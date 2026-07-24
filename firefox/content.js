// =========================================================================
// ASS Subtitle Player - content.js (v2.1.3 Stable Reset Fix)
// =========================================================================

const DEFAULTS = {
    isEnabled: true,
    aspectMode: "auto",      // 'auto' | '16:9' | '4:3' | 'vertical'
    subSize: 100,            // %
    subOpacity: 100,         // %
    subColor: "#ffffff",
    borderColor: "#000000",
    borderWidth: 2,          // px
    shadowLevel: "normal",   // 'none' | 'normal' | 'strong'
    subFont: "sans-serif",
    edgeBottom: 12,          // % - distance from bottom
    posOffsetX: 0,           // px - drag offset
    posOffsetY: 0,           // px
    dragMode: false,
    delaySeconds: 0,
    dualEnabled: true,
    subColor2: "#ffd400",
    subSize2: 80,
    subOpacity2: 100,        // % - secondary opacity
    subFont2: "",            // empty = inherit primary font
    borderColor2: "#000000",
    borderWidth2: 2,         // px
    shadowLevel2: "normal",  // 'none' | 'normal' | 'strong'
    dualGap: 8,              // px - extra gap between primary and secondary
    autoRestoreLastSubtitle: false,  // Default to false so switching videos doesn't auto play old subs
    positionTop: false,
    lastSubtitle: null,      
    lastSubtitle2: null,
    syncProfiles: { tv: null, bluray: null },
    siteProfiles: {},
    uiLang: "en"
};

const SITE_PRESETS = {
    "youtube.com":      { subSize: 100, subColor: "#ffffff", subFont: "Roboto, sans-serif", edgeBottom: 10 },
    "netflix.com":      { subSize: 100, subColor: "#ffffff", subFont: "sans-serif", edgeBottom: 12 },
    "crunchyroll.com":  { subSize: 115, subColor: "#ffd400", subFont: "Arial, sans-serif", edgeBottom: 12 },
    "twitch.tv":        { subSize: 90,  subColor: "#ffffff", subFont: "sans-serif", edgeBottom: 14 },
    "vimeo.com":        { subSize: 100, subColor: "#ffffff", subFont: "sans-serif", edgeBottom: 12 }
};

let settings = JSON.parse(JSON.stringify(DEFAULTS));

let activeVideo = null;
let customSubContainer = null;   
let customSubContainer2 = null;  
let parsedSubtitles = [];
let parsedSubtitles2 = [];
let syncAnimationId = null;
let videoWatchTimer = null;
let lastPrimaryRenderedHeight = 0; // Cache last known primary height for stable secondary positioning

function tr(key, vars) { return i18nText(key, settings.uiLang, vars); }

function loadSettings(callback) {
    chrome.storage.local.get(Object.keys(DEFAULTS), (data) => {
        settings = Object.assign({}, DEFAULTS, data);
        applySitePreset();
        if (callback) callback();
    });
}

function applySitePreset() {
    const host = location.hostname.replace(/^www\./, "");
    const presetKey = Object.keys(SITE_PRESETS).find(k => host.endsWith(k));
    const userOverride = settings.siteProfiles && settings.siteProfiles[host];
    if (userOverride) {
        Object.assign(settings, userOverride);
    } else if (presetKey && !settings._userTouchedStyle) {
        Object.assign(settings, SITE_PRESETS[presetKey]);
    }
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let styleTouched = false;
    Object.keys(changes).forEach(key => {
        if (key in DEFAULTS) {
            settings[key] = changes[key].newValue;
            if (["subSize","subOpacity","subColor","borderColor","borderWidth",
                 "shadowLevel","subFont","edgeBottom","aspectMode","positionTop",
                 "subColor2","subSize2","subOpacity2","subFont2","borderColor2",
                 "borderWidth2","shadowLevel2","dualGap"].includes(key)) {
                styleTouched = true;
            }
        }
    });
    if (styleTouched) { updateSubStyle(); updateSubStyle2(); }
});

loadSettings();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case "SHOW_PICKER_UI":
            if (document.querySelector("video")) injectFilePickerUI(request.target || "primary");
            break;
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
            settings._userTouchedStyle = true;
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
            bakeDelay();
            break;
        case "RESET_DELAY":
            settings.delaySeconds = 0;
            break;
        case "CONVERT_FPS":
            convertFps(request.fromFps, request.toFps);
            break;
        case "TOGGLE_DUAL":
            settings.dualEnabled = request.dualEnabled;
            if (!settings.dualEnabled && customSubContainer2) customSubContainer2.style.display = "none";
            break;
        case "LOAD_SUBTITLE_TEXT":
            loadSubtitleFromText(request.text, request.ext, request.name, request.target || "primary");
            break;
        case "LOAD_LAST_SUBTITLE":
            restoreLastSubtitle(request.target || "primary");
            break;
        case "START_AUTO_SYNC":
            startAutoSyncEstimate();
            break;
        case "SET_LANG":
            settings.uiLang = request.lang === "tr" ? "tr" : "en";
            chrome.storage.local.set({ uiLang: settings.uiLang });
            break;
        case "GET_STATE":
            sendResponse({
                hasVideo: !!document.querySelector("video"),
                primaryLoaded: parsedSubtitles.length > 0,
                secondaryLoaded: parsedSubtitles2.length > 0,
                delaySeconds: settings.delaySeconds,
                hostname: location.hostname.replace(/^www\./, "")
            });
            break;
    }
});

function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement ||
           document.mozFullScreenElement || document.msFullscreenElement || null;
}

function ensureContainerParent(container) {
    if (!container) return;
    const fsEl = getFullscreenElement();
    const desiredParent = fsEl || document.body;
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
    return !!document.querySelector("video");
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
        document.body.appendChild(toast);
    }
    
    ensureContainerParent(toast);
    toast.innerText = msg;
    
    if (activeVideo) {
        const rect = activeVideo.getBoundingClientRect();
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

function injectFilePickerUI(target) {
    let existing = document.getElementById("ass-ext-floating-picker");
    if (existing) existing.remove();

    const container = document.createElement("div");
    container.id = "ass-ext-floating-picker";
    container.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 2147483647;
        background: rgba(22, 22, 22, 0.97); padding: 15px; border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.7); border: 1px solid #3a3a3a;
        display: flex; flex-direction: column; gap: 10px; font-family: 'Segoe UI', sans-serif;
        color: white; width: 260px;
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
    fileInput.style.cssText = "color: white; font-size: 12px; cursor: pointer;";

    const closeBtn = document.createElement("button");
    closeBtn.innerText = tr("picker_cancel");
    closeBtn.style.cssText = "background: #d32f2f; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 5px;";
    closeBtn.onclick = () => container.remove();

    const handleFile = (file) => {
        if (!file) return;
        const extension = file.name.split(".").pop().toLowerCase();
        const reader = new FileReader();
        reader.onload = (event) => {
            loadSubtitleFromText(event.target.result, extension, file.name, target);
            container.remove();
        };
        const encoding = (extension === "srt") ? "utf-8" : "windows-1254";
        reader.readAsText(file, encoding);
    };

    fileInput.onchange = (e) => handleFile(e.target.files[0]);

    container.addEventListener("dragover", (e) => { e.preventDefault(); container.style.borderColor = "#ffb300"; });
    container.addEventListener("dragleave", () => { container.style.borderColor = "#3a3a3a"; });
    container.addEventListener("drop", (e) => {
        e.preventDefault();
        container.style.borderColor = "#3a3a3a";
        if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    container.appendChild(title);
    container.appendChild(dropHint);
    container.appendChild(fileInput);
    container.appendChild(closeBtn);
    document.body.appendChild(container);
}

document.addEventListener("dragover", (e) => {
    if (document.querySelector("video")) e.preventDefault();
});
document.addEventListener("drop", (e) => {
    if (!document.querySelector("video")) return;
    if (document.getElementById("ass-ext-floating-picker")) return; 
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["ass","ssa","srt"].includes(ext)) return;
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = (event) => loadSubtitleFromText(event.target.result, ext, file.name, "primary");
    reader.readAsText(file, ext === "srt" ? "utf-8" : "windows-1254");
});

function loadSubtitleFromText(text, extension, name, target) {
    const subs = (extension === "srt") ? parseSRT(text) : parseASS(text);
    if (subs.length === 0) return;

    if (target === "secondary") {
        parsedSubtitles2 = subs;
        settings.lastSubtitle2 = { name, ext: extension, content: text };
        chrome.storage.local.set({ lastSubtitle2: settings.lastSubtitle2 });
        showToast(tr("toast_sub_loaded_sec"));
    } else {
        parsedSubtitles = subs;
        settings.delaySeconds = 0;
        settings.lastSubtitle = { name, ext: extension, content: text };
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
    if (!stored) return;
    loadSubtitleFromText(stored.content, stored.ext, stored.name, target);
}

function parseSRT(data) {
    const subs = [];
    const blocks = data.trim().split(/\r?\n\r?\n/);
    const tToS = (t) => {
        const p = t.trim().replace(",", ".").split(":");
        return (parseFloat(p[0]) * 3600) + (parseFloat(p[1]) * 60) + parseFloat(p[2]);
    };
    blocks.forEach(block => {
        const lines = block.split(/\r?\n/);
        if (lines.length >= 3) {
            const timeRange = lines[1].split(" --> ");
            if (timeRange.length === 2) {
                subs.push({ start: tToS(timeRange[0]), end: tToS(timeRange[1]), text: lines.slice(2).join("\n").trim() });
            }
        }
    });
    return subs;
}

function parseASS(assText) {
    const lines = assText.split("\n");
    let subs = [];
    const tToS = (t) => {
        const p = t.trim().split(":");
        return p.length < 3 ? 0 : (parseFloat(p[0]) * 3600) + (parseFloat(p[1]) * 60) + parseFloat(p[2]);
    };
    lines.forEach(line => {
        if (line.startsWith("Dialogue:")) {
            const parts = line.split(",");
            if (parts.length >= 10) {
                let text = parts.slice(9).join(",");
                // Convert ASS override tags and line-breaks to plain newlines (safe for textContent)
                text = text.replace(/\{.*?\}/g, "").replace(/\\[Nn]/g, "\n").trim();
                subs.push({ start: tToS(parts[1]), end: tToS(parts[2]), text: text });
            }
        }
    });
    return subs;
}

function adjustDelay(delta) {
    settings.delaySeconds = Math.round((settings.delaySeconds + delta) * 1000) / 1000;
    chrome.storage.local.set({ delaySeconds: settings.delaySeconds });
    broadcastDelay();
}

function bakeDelay() {
    const d = settings.delaySeconds;
    if (d === 0) return;
    parsedSubtitles.forEach(c => { c.start += d; c.end += d; });
    parsedSubtitles2.forEach(c => { c.start += d; c.end += d; });
    settings.delaySeconds = 0;
    chrome.storage.local.set({ delaySeconds: 0 });
    broadcastDelay();
}

function convertFps(fromFps, toFps) {
    if (!fromFps || !toFps || fromFps === toFps) return;
    const factor = fromFps / toFps; 
    parsedSubtitles.forEach(c => { c.start *= factor; c.end *= factor; });
    parsedSubtitles2.forEach(c => { c.start *= factor; c.end *= factor; });
}

function broadcastDelay() {
    chrome.runtime.sendMessage({ type: "DELAY_CHANGED", value: settings.delaySeconds }).catch(() => {});
}

window.addEventListener("keydown", (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement && document.activeElement.isContentEditable)) return;
    if (!e.altKey) return;

    switch (e.code) {
        case "ArrowRight": adjustDelay(e.shiftKey ? 1 : 0.1); e.preventDefault(); break;
        case "ArrowLeft":  adjustDelay(e.shiftKey ? -1 : -0.1); e.preventDefault(); break;
        case "Digit0":     settings.delaySeconds = 0; chrome.storage.local.set({ delaySeconds: 0 }); broadcastDelay(); e.preventDefault(); break;
        case "KeyE":       settings.isEnabled = !settings.isEnabled; chrome.storage.local.set({ isEnabled: settings.isEnabled }); e.preventDefault(); break;
        case "KeyD":       settings.dualEnabled = !settings.dualEnabled; chrome.storage.local.set({ dualEnabled: settings.dualEnabled }); e.preventDefault(); break;
        case "KeyP":       settings.dragMode = !settings.dragMode; updateSubStyle(); e.preventDefault(); break;
        case "KeyT":       settings.positionTop = !settings.positionTop; chrome.storage.local.set({ positionTop: settings.positionTop }); updateSubStyle(); e.preventDefault(); break;
    }
});

function getActiveVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return null;
    let best = null, bestArea = 0;
    videos.forEach(v => {
        const r = v.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea && r.width > 0 && r.height > 0) { bestArea = area; best = v; }
    });
    return best || videos[0];
}

let lastPageUrl = location.href;

function watchForVideoChanges() {
    if (videoWatchTimer) clearInterval(videoWatchTimer);
    videoWatchTimer = setInterval(() => {
        const v = getActiveVideo();
        const currentUrl = location.href;

        // SPA Navigation Fix: If URL changes (e.g. clicked a new YouTube video), clear subtitles
        // if the user doesn't want them auto-restored. This is much safer than checking video.src.
        if (currentUrl !== lastPageUrl) {
            lastPageUrl = currentUrl;
            if (!settings.autoRestoreLastSubtitle) {
                parsedSubtitles = [];
                parsedSubtitles2 = [];
                if (customSubContainer) { customSubContainer.innerHTML = ""; customSubContainer.style.display = "none"; }
                if (customSubContainer2) { customSubContainer2.innerHTML = ""; customSubContainer2.style.display = "none"; }
            }
        }

        if (v && v !== activeVideo) {
            activeVideo = v;
            
            if (parsedSubtitles.length > 0 || (settings.autoRestoreLastSubtitle && settings.lastSubtitle)) initContainer(v);
            if (parsedSubtitles2.length > 0 || (settings.autoRestoreLastSubtitle && settings.lastSubtitle2)) initContainer2(v);
            
            if (parsedSubtitles.length === 0 && settings.autoRestoreLastSubtitle && settings.lastSubtitle) {
                restoreLastSubtitle("primary");
            }
            ensureSyncLoop(v);
        } else if (!v && activeVideo) {
            activeVideo = null;
        }
    }, 800);
}
watchForVideoChanges();

function tryInitialAutoRestore() {
    const v = getActiveVideo();
    if (v && settings.autoRestoreLastSubtitle && settings.lastSubtitle && parsedSubtitles.length === 0) {
        activeVideo = v;
        restoreLastSubtitle("primary");
        if (settings.lastSubtitle2) restoreLastSubtitle("secondary");
    }
}
setTimeout(() => loadSettings(tryInitialAutoRestore), 600);

function initContainer(videoElement) {
    if (customSubContainer) customSubContainer.remove();
    customSubContainer = document.createElement("div");
    ensureContainerParent(customSubContainer);
    enableDragHandlers(customSubContainer, "primary");
    updateSubStyle();
}

function initContainer2(videoElement) {
    if (customSubContainer2) customSubContainer2.remove();
    customSubContainer2 = document.createElement("div");
    ensureContainerParent(customSubContainer2);
    updateSubStyle2();
}

function buildTextShadow(borderColor, borderWidth, shadowLevel) {
    if (shadowLevel === "none") return "none";
    const w = Math.max(1, borderWidth);
    const offsets = shadowLevel === "strong"
        ? [[-w,-w],[w,-w],[-w,w],[w,w],[0,-w],[0,w],[-w,0],[w,0],[0,0]]
        : [[-w,-w],[w,-w],[-w,w],[w,w]];
    return offsets.map(([x,y]) => `${x}px ${y}px ${shadowLevel === "strong" ? w : 1}px ${borderColor}`).join(", ");
}

// ---- Safe subtitle renderer (handles <i>, <b>, <u>, <font color>, \n) --------
// Uses DOMParser so we never call innerHTML with untrusted content directly.
const SAFE_INLINE_TAGS = new Set(["i", "b", "u", "em", "strong", "br", "font"]);
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


// ---- Mobile Detection & Font Support -------------------------------------
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

if (isMobile) {
    // Inject Google Fonts on mobile so that font selections actually render differently 
    // (since Android/iOS lack fonts like Arial, Tahoma, etc. by default).
    const fontLink = document.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?family=Roboto:wght@700&family=Open+Sans:wght@700&family=Noto+Sans:wght@700&display=swap";
    document.head.appendChild(fontLink);
}

function computeBoxRect() {
    if (!activeVideo) return null;
    const rect = activeVideo.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const isVertical = settings.aspectMode === "vertical" ||
        (settings.aspectMode === "auto" && rect.height > rect.width * 1.1);
    const maxWidthRatio = isVertical ? 0.92 : (settings.aspectMode === "4:3" ? 0.65 : 0.9);
    return { rect, isVertical, maxWidthRatio };
}

function updateSubStyle() {
    if (!customSubContainer) return;
    const info = computeBoxRect();
    if (!info) { customSubContainer.style.display = "none"; return; }
    const { rect, maxWidthRatio } = info;

    // Mobile gets exactly the 2.1.1 styling (vw based), desktop gets the rect-based styling
    const fontSize = isMobile
        ? `calc(clamp(14px, 3.2vw, 58px) * ${settings.subSize / 100})`
        : `calc(clamp(14px, ${rect.width * 0.032}px, 58px) * ${settings.subSize / 100})`;
    
    const centerX = rect.left + rect.width / 2 + settings.posOffsetX;

    let positionCss = "";
    if (settings.positionTop) {
        const topPx = rect.top + rect.height * (settings.edgeBottom / 100) - settings.posOffsetY;
        positionCss = `top: ${topPx}px;`;
    } else {
        const bottomPx = rect.top + rect.height * (1 - settings.edgeBottom / 100) - settings.posOffsetY;
        positionCss = `bottom: ${window.innerHeight - bottomPx}px;`;
    }

    customSubContainer.style.cssText = `
        position: fixed; left: ${centerX}px; ${positionCss}
        transform: translateX(-50%); width: ${rect.width * maxWidthRatio}px; text-align: center;
        pointer-events: ${settings.dragMode ? "auto" : "none"}; z-index: 2147483646;
        font-family: ${settings.subFont}; font-size: ${fontSize}; font-weight: bold;
        color: ${settings.subColor}; opacity: ${settings.subOpacity / 100};
        text-shadow: ${buildTextShadow(settings.borderColor, settings.borderWidth, settings.shadowLevel)};
        display: ${parsedSubtitles.length ? "block" : "none"}; white-space: pre-wrap; line-height: 1.25;
        ${settings.dragMode ? "outline: 1px dashed #ffb300; cursor: grab; border-radius:4px;" : ""}
    `;
}

function updateSubStyle2() {
    if (!customSubContainer2) return;
    const info = computeBoxRect();
    if (!info) { customSubContainer2.style.display = "none"; return; }
    const { rect, maxWidthRatio } = info;

    // Font: use secondary-specific font if set, otherwise fall back to primary font
    const font2 = (settings.subFont2 && settings.subFont2 !== "") ? settings.subFont2 : settings.subFont;
    
    // Mobile gets exactly the 2.1.1 styling (vw based)
    const fontSize2 = isMobile
        ? `calc(clamp(14px, 3.2vw, 58px) * ${settings.subSize2 / 100})`
        : `calc(clamp(14px, ${rect.width * 0.032}px, 58px) * ${settings.subSize2 / 100})`;
        
    const centerX = rect.left + rect.width / 2;

    // Use the REAL rendered height of the primary container when available.
    // This correctly handles multi-line primary subtitles.
    let primaryActualHeight;
    if (customSubContainer && customSubContainer.style.display !== "none") {
        const primaryBR = customSubContainer.getBoundingClientRect();
        if (primaryBR.height > 0) {
            lastPrimaryRenderedHeight = primaryBR.height;
            primaryActualHeight = primaryBR.height;
        }
    }
    // Fallback: use the cached last-known height so secondary doesn't jump
    // when the primary disappears between subtitle cues.
    if (!primaryActualHeight) {
        if (lastPrimaryRenderedHeight > 0) {
            primaryActualHeight = lastPrimaryRenderedHeight;
        } else {
            const primaryFontRefPx = Math.min(58, Math.max(14, rect.width * 0.032)) * (settings.subSize / 100);
            primaryActualHeight = primaryFontRefPx * 1.35;
        }
    }

    const gap = (settings.dualGap !== undefined ? settings.dualGap : 8);

    let positionCss2 = "";
    if (settings.positionTop) {
        const primaryTopPx = rect.top + rect.height * (settings.edgeBottom / 100) - settings.posOffsetY;
        const secondaryTopPx = primaryTopPx + primaryActualHeight + gap;
        positionCss2 = `top: ${secondaryTopPx}px;`;
    } else {
        const primaryBottomPx = rect.top + rect.height * (1 - settings.edgeBottom / 100) - settings.posOffsetY;
        const secondaryBottomPx = primaryBottomPx - primaryActualHeight - gap;
        positionCss2 = `bottom: ${window.innerHeight - secondaryBottomPx}px;`;
    }

    customSubContainer2.style.cssText = `
        position: fixed; left: ${centerX}px; ${positionCss2}
        transform: translateX(-50%); width: ${rect.width * maxWidthRatio}px; text-align: center;
        pointer-events: none; z-index: 2147483645;
        font-family: ${font2}; font-size: ${fontSize2}; font-weight: bold;
        color: ${settings.subColor2}; opacity: ${(settings.subOpacity2 !== undefined ? settings.subOpacity2 : 100) / 100};
        text-shadow: ${buildTextShadow(settings.borderColor2 || "#000000", settings.borderWidth2 !== undefined ? settings.borderWidth2 : 2, settings.shadowLevel2 || "normal")};
        display: ${(settings.dualEnabled && parsedSubtitles2.length) ? "block" : "none"};
        white-space: pre-wrap; line-height: 1.25;
    `;
}

function enableDragHandlers(container, target) {
    let dragging = false, startX = 0, startY = 0, baseX = 0, baseY = 0;
    container.addEventListener("mousedown", (e) => {
        if (!settings.dragMode) return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        baseX = settings.posOffsetX; baseY = settings.posOffsetY;
        e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        settings.posOffsetX = baseX + (e.clientX - startX);
        settings.posOffsetY = -(e.clientY - startY) + baseY;
        updateSubStyle();
    });
    window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        chrome.storage.local.set({ posOffsetX: settings.posOffsetX, posOffsetY: settings.posOffsetY });
    });
}

function ensureSyncLoop(videoElement) {
    activeVideo = videoElement;
    if (syncAnimationId) cancelAnimationFrame(syncAnimationId);

    function checkTime() {
        if (!activeVideo || !document.body.contains(activeVideo)) {
            const v = getActiveVideo();
            if (v) { activeVideo = v; activeVideoSrc = v.currentSrc; }
        }
        if (activeVideo) {
            ensureContainerParent(customSubContainer);
            ensureContainerParent(customSubContainer2);
            updateSubStyle();
            updateSubStyle2();

            if (!settings.isEnabled) {
                if (customSubContainer) customSubContainer.style.display = "none";
                if (customSubContainer2) customSubContainer2.style.display = "none";
            } else {
                const t = activeVideo.currentTime - settings.delaySeconds;
                if (customSubContainer && parsedSubtitles.length) {
                    let activeText = "";
                    for (let i = 0; i < parsedSubtitles.length; i++) {
                        if (t >= parsedSubtitles[i].start && t <= parsedSubtitles[i].end) { activeText = parsedSubtitles[i].text; break; }
                    }
                    // Safe render: handles <i>/<b>/<u>/<font> tags and \n line breaks
                    setSubText(customSubContainer, activeText);
                    const showPrimary = !!activeText;
                    customSubContainer.style.display = showPrimary ? "block" : "none";
                    // Cache the rendered height while visible so secondary position stays stable
                    if (showPrimary) {
                        const h = customSubContainer.getBoundingClientRect().height;
                        if (h > 0) lastPrimaryRenderedHeight = h;
                    }
                }
                if (customSubContainer2 && settings.dualEnabled && parsedSubtitles2.length) {
                    let activeText2 = "";
                    for (let i = 0; i < parsedSubtitles2.length; i++) {
                        if (t >= parsedSubtitles2[i].start && t <= parsedSubtitles2[i].end) { activeText2 = parsedSubtitles2[i].text; break; }
                    }
                    // Safe render: handles <i>/<b>/<u>/<font> tags and \n line breaks
                    setSubText(customSubContainer2, activeText2);
                    customSubContainer2.style.display = activeText2 ? "block" : "none";
                }
            }
        }
        syncAnimationId = requestAnimationFrame(checkTime);
    }
    checkTime();
}

let audioCtxRef = null;

function startAutoSyncEstimate() {
    const video = getActiveVideo();
    if (!video) { showAutoSyncPanel(tr("autosync_no_video"), null); return; }
    if (parsedSubtitles.length === 0) { showAutoSyncPanel(tr("autosync_need_subtitle"), null); return; }

    let source;
    try {
        audioCtxRef = audioCtxRef || new (window.AudioContext || window.webkitAudioContext)();
        if (!video.__assExtAudioSource) {
            source = audioCtxRef.createMediaElementSource(video);
            video.__assExtAudioSource = source;
        } else {
            source = video.__assExtAudioSource;
        }
        const analyser = audioCtxRef.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        analyser.connect(audioCtxRef.destination);

        showAutoSyncPanel(tr("autosync_analyzing"), null, true);

        if (video.paused) video.play().catch(() => {});

        const data = new Uint8Array(analyser.frequencyBinCount);
        const onsets = [];
        let wasQuiet = true;
        let quietSince = performance.now();
        const ANALYSIS_MS = 30000;
        const startedAt = performance.now();

        const tick = () => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) { const v = data[i] - 128; sum += v * v; }
            const rms = Math.sqrt(sum / data.length);
            const isQuiet = rms < 6;
            if (isQuiet) {
                if (!wasQuiet) quietSince = performance.now();
                wasQuiet = true;
            } else if (wasQuiet && (performance.now() - quietSince) > 250) {
                onsets.push(video.currentTime);
                wasQuiet = false;
            }
            if (performance.now() - startedAt < ANALYSIS_MS && !video.paused) {
                requestAnimationFrame(tick);
            } else {
                finishAnalysis(onsets, startTime, startTime + ANALYSIS_MS / 1000);
            }
        };
        requestAnimationFrame(tick);
    } catch (err) {
        showAutoSyncPanel(tr("autosync_drm_error", { error: err.message }), null);
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
        document.body.appendChild(panel);
    }
    panel.innerHTML = "";
    const msg = document.createElement("div");
    msg.innerText = message;
    msg.style.marginBottom = "8px";
    panel.appendChild(msg);

    if (!loadingOnly) {
        if (suggestedOffset !== null && suggestedOffset !== undefined) {
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
        closeBtn.onclick = () => panel.remove();
        panel.appendChild(closeBtn);
    }
}
