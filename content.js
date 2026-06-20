// =========================================================================
// ASS Subtitle Player - content.js (v2.1)
// =========================================================================

// ---- Varsayılan ayarlar / Defaults ---------------------------------------
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
    dualEnabled: false,
    subColor2: "#ffd400",
    subSize2: 80,
    autoRestoreLastSubtitle: true,
    lastSubtitle: null,      // {name, ext, content}
    lastSubtitle2: null,
    syncProfiles: { tv: null, bluray: null },
    siteProfiles: {},
    uiLang: "en"
};

// Ready-made style presets for popular sites (overridden by a saved
// siteProfiles entry if the user has explicitly saved one for that host).
const SITE_PRESETS = {
    "youtube.com":      { subSize: 100, subColor: "#ffffff", subFont: "Roboto, sans-serif", edgeBottom: 10 },
    "netflix.com":      { subSize: 100, subColor: "#ffffff", subFont: "sans-serif", edgeBottom: 12 },
    "crunchyroll.com":  { subSize: 115, subColor: "#ffd400", subFont: "Arial, sans-serif", edgeBottom: 12 },
    "twitch.tv":        { subSize: 90,  subColor: "#ffffff", subFont: "sans-serif", edgeBottom: 14 },
    "vimeo.com":        { subSize: 100, subColor: "#ffffff", subFont: "sans-serif", edgeBottom: 12 }
};

let settings = JSON.parse(JSON.stringify(DEFAULTS));

let activeVideo = null;
let customSubContainer = null;   // primary subtitle box
let customSubContainer2 = null;  // secondary (dual subtitle) box
let parsedSubtitles = [];
let parsedSubtitles2 = [];
let syncAnimationId = null;
let videoWatchTimer = null;

function tr(key, vars) { return i18nText(key, settings.uiLang, vars); }

// ---- Ayarları yükle / Load settings --------------------------------------
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
                 "shadowLevel","subFont","edgeBottom","aspectMode","subColor2","subSize2"].includes(key)) {
                styleTouched = true;
            }
        }
    });
    if (styleTouched) { updateSubStyle(); updateSubStyle2(); }
});

loadSettings();

// ---- Mesaj dinleyici / message handler -----------------------------------
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

// ---- Fullscreen desteği (JW Player vb. siteler için) ----------------------
// Fullscreen API'de, fullscreen olan elementin DIŞINDAKİ her şey (document.body
// dahil) tarayıcı tarafından render edilmez. Bu yüzden altyazı kutusunu her
// zaman geçerli fullscreen elementinin İÇİNE taşımamız gerekiyor; aksi halde
// JW Player gibi kendi wrapper'ını fullscreen yapan oynatıcılarda altyazı
// görünmez olur.
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
        updateSubStyle();
        updateSubStyle2();
    });
});

// ---- Dosya seçici / file picker panel --------------------------------------
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
    // Seçici panel her zaman normal body üzerinde gösterilir (fullscreen'den
    // çıkmadan dosya seçtirmek tarayıcıda genelde mümkün olmuyor zaten).
    document.body.appendChild(container);
}

// Sayfanın herhangi bir yerine altyazı dosyası sürükle-bırak desteği
document.addEventListener("dragover", (e) => {
    if (document.querySelector("video")) e.preventDefault();
});
document.addEventListener("drop", (e) => {
    if (!document.querySelector("video")) return;
    if (document.getElementById("ass-ext-floating-picker")) return; // panel kendi drop'unu yönetiyor
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["ass","ssa","srt"].includes(ext)) return;
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = (event) => loadSubtitleFromText(event.target.result, ext, file.name, "primary");
    reader.readAsText(file, ext === "srt" ? "utf-8" : "windows-1254");
});

// ---- Altyazı yükleme / ayrıştırma -----------------------------------------
function loadSubtitleFromText(text, extension, name, target) {
    const subs = (extension === "srt") ? parseSRT(text) : parseASS(text);
    if (subs.length === 0) return;

    if (target === "secondary") {
        parsedSubtitles2 = subs;
        settings.lastSubtitle2 = { name, ext: extension, content: text };
        chrome.storage.local.set({ lastSubtitle2: settings.lastSubtitle2 });
    } else {
        parsedSubtitles = subs;
        settings.delaySeconds = 0;
        settings.lastSubtitle = { name, ext: extension, content: text };
        chrome.storage.local.set({ lastSubtitle: settings.lastSubtitle });
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
                text = text.replace(/\{.*?\}/g, "").replace(/\\[Nn]/g, "\n").trim();
                subs.push({ start: tToS(parts[1]), end: tToS(parts[2]), text: text });
            }
        }
    });
    return subs;
}

// ---- Senkron: gecikme / kare-fps -------------------------------------------
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
    const factor = fromFps / toFps; // scales second-based timestamps (permanent, unlike the live delay)
    parsedSubtitles.forEach(c => { c.start *= factor; c.end *= factor; });
    parsedSubtitles2.forEach(c => { c.start *= factor; c.end *= factor; });
}

function broadcastDelay() {
    chrome.runtime.sendMessage({ type: "DELAY_CHANGED", value: settings.delaySeconds }).catch(() => {});
}

// ---- Klavye kısayolları / keyboard shortcuts -------------------------------
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
    }
});

// ---- Video tespiti (YouTube/Netflix SPA dahil) / video detection -----------
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

function watchForVideoChanges() {
    if (videoWatchTimer) clearInterval(videoWatchTimer);
    videoWatchTimer = setInterval(() => {
        const v = getActiveVideo();
        if (v && v !== activeVideo) {
            activeVideo = v;
            if (parsedSubtitles.length > 0 || settings.lastSubtitle) initContainer(v);
            if (parsedSubtitles2.length > 0) initContainer2(v);
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

// ---- Konteyner kurulumu / container setup ----------------------------------
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

    const fontSize = `calc(clamp(14px, 3.2vw, 58px) * ${settings.subSize / 100})`;
    const bottomPx = rect.top + rect.height * (1 - settings.edgeBottom / 100) - settings.posOffsetY;
    const centerX = rect.left + rect.width / 2 + settings.posOffsetX;

    customSubContainer.style.cssText = `
        position: fixed; left: ${centerX}px; bottom: ${window.innerHeight - bottomPx}px;
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
    const fontSize = `calc(clamp(14px, 3.2vw, 58px) * ${settings.subSize2 / 100})`;
    const topPx = rect.top + rect.height * 0.08;
    const centerX = rect.left + rect.width / 2;

    customSubContainer2.style.cssText = `
        position: fixed; left: ${centerX}px; top: ${topPx}px;
        transform: translateX(-50%); width: ${rect.width * maxWidthRatio}px; text-align: center;
        pointer-events: none; z-index: 2147483646;
        font-family: ${settings.subFont}; font-size: ${fontSize}; font-weight: bold;
        color: ${settings.subColor2}; text-shadow: ${buildTextShadow("#000000", 2, "normal")};
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

// ---- Senkron döngüsü (zaman + konum + fullscreen takibi aynı rAF'ta) -------
function ensureSyncLoop(videoElement) {
    activeVideo = videoElement;
    if (syncAnimationId) cancelAnimationFrame(syncAnimationId);

    function checkTime() {
        if (!activeVideo || !document.body.contains(activeVideo)) {
            const v = getActiveVideo();
            if (v) activeVideo = v;
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
                    customSubContainer.innerText = activeText;
                    if (customSubContainer.style.display !== "none") {
                        customSubContainer.style.display = activeText ? "block" : "none";
                    }
                }
                if (customSubContainer2 && settings.dualEnabled && parsedSubtitles2.length) {
                    let activeText2 = "";
                    for (let i = 0; i < parsedSubtitles2.length; i++) {
                        if (t >= parsedSubtitles2[i].start && t <= parsedSubtitles2[i].end) { activeText2 = parsedSubtitles2[i].text; break; }
                    }
                    customSubContainer2.innerText = activeText2;
                    if (customSubContainer2.style.display !== "none") {
                        customSubContainer2.style.display = activeText2 ? "block" : "none";
                    }
                }
            }
        }
        syncAnimationId = requestAnimationFrame(checkTime);
    }
    checkTime();
}

// ---- Deneysel: Ses analizine dayalı otomatik senkron tahmini ----------------
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
        const startTime = video.currentTime;
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
