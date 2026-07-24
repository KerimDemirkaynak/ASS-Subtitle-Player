// =========================================================================
// ASS Subtitle Player - content.js
// =========================================================================

const DEFAULTS = {
    isEnabled: true, aspectMode: "auto", subSize: 100, subOpacity: 100,
    subColor: "#ffffff", borderColor: "#000000", borderWidth: 2, shadowLevel: "normal",
    subFont: "sans-serif", edgeBottom: 12, posOffsetX: 0, posOffsetY: 0, dragMode: false,
    delaySeconds: 0, dualEnabled: false, subColor2: "#ffd400", subSize2: 80,
    autoRestoreLastSubtitle: false, positionTop: false, lastSubtitle: null, lastSubtitle2: null,
    syncProfiles: { tv: null, bluray: null }, siteProfiles: {}, uiLang: "en"
};

const SITE_PRESETS = {
    "youtube.com": { subSize: 100, subColor: "#ffffff", subFont: "Roboto, sans-serif", edgeBottom: 10 },
    "netflix.com": { subSize: 100, subColor: "#ffffff", subFont: "sans-serif", edgeBottom: 12 },
    "crunchyroll.com": { subSize: 115, subColor: "#ffd400", subFont: "Arial, sans-serif", edgeBottom: 12 },
    "twitch.tv": { subSize: 90, subColor: "#ffffff", subFont: "sans-serif", edgeBottom: 14 }
};

let settings = JSON.parse(JSON.stringify(DEFAULTS));
let activeVideo = null;
let activeVideoSrc = "";
let customSubContainer = null;
let customSubContainer2 = null;
let parsedSubtitles = [];
let parsedSubtitles2 = [];
let syncAnimationId = null;
let videoWatchTimer = null;

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
    if (userOverride) Object.assign(settings, userOverride);
    else if (presetKey && !settings._userTouchedStyle) Object.assign(settings, SITE_PRESETS[presetKey]);
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let styleTouched = false;
    Object.keys(changes).forEach(key => {
        if (key in DEFAULTS) {
            settings[key] = changes[key].newValue;
            if (["subSize","subOpacity","subColor","borderColor","borderWidth","shadowLevel","subFont","edgeBottom","aspectMode","subColor2","subSize2","positionTop"].includes(key)) {
                styleTouched = true;
            }
        }
    });
    if (styleTouched) { updateSubStyle(); updateSubStyle2(); }
});

loadSettings();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case "SHOW_PICKER_UI": if (document.querySelector("video")) injectFilePickerUI(request.target || "primary"); break;
        case "TOGGLE_EXTENSION": settings.isEnabled = request.isEnabled; break;
        case "TOGGLE_RATIO": settings.aspectMode = request.aspectMode; updateSubStyle(); break;
        case "CHANGE_SIZE": settings.subSize = request.size; updateSubStyle(); break;
        case "STYLE_UPDATE": Object.assign(settings, request.patch); settings._userTouchedStyle = true; updateSubStyle(); updateSubStyle2(); break;
        case "TOGGLE_DRAG_MODE": settings.dragMode = request.dragMode; updateSubStyle(); break;
        case "ADJUST_DELAY": adjustDelay(request.delta); break;
        case "SET_DELAY": settings.delaySeconds = request.value; break;
        case "BAKE_DELAY": bakeDelay(); break;
        case "RESET_DELAY": settings.delaySeconds = 0; break;
        case "CONVERT_FPS": convertFps(request.fromFps, request.toFps); break;
        case "TOGGLE_DUAL": settings.dualEnabled = request.dualEnabled; if (!settings.dualEnabled && customSubContainer2) customSubContainer2.style.display = "none"; break;
        case "LOAD_SUBTITLE_TEXT": loadSubtitleFromText(request.text, request.ext, request.name, request.target || "primary"); break;
        case "LOAD_LAST_SUBTITLE": restoreLastSubtitle(request.target || "primary"); break;
        case "START_AUTO_SYNC": startAutoSyncEstimate(); break;
        case "SET_LANG": settings.uiLang = request.lang === "tr" ? "tr" : "en"; chrome.storage.local.set({ uiLang: settings.uiLang }); break;
        case "GET_STATE": sendResponse({ hasVideo: !!document.querySelector("video"), primaryLoaded: parsedSubtitles.length > 0, secondaryLoaded: parsedSubtitles2.length > 0, delaySeconds: settings.delaySeconds, hostname: location.hostname.replace(/^www\./, "") }); break;
    }
});

function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || null;
}

function ensureContainerParent(container) {
    if (!container) return;
    const fsEl = getFullscreenElement();
    const desiredParent = fsEl || document.body;
    if (container.parentNode !== desiredParent) {
        try { desiredParent.appendChild(container); } catch (e) {}
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

function showToast(msg) {
    let toast = document.getElementById("ass-ext-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "ass-ext-toast";
        toast.style.cssText = `
            position: fixed; background: rgba(46, 125, 50, 0.95); color: white; padding: 10px 20px;
            border-radius: 6px; font-family: 'Segoe UI', sans-serif; font-size: 13px; font-weight: bold;
            z-index: 2147483647; opacity: 0; transition: opacity 0.3s, transform 0.3s; pointer-events: none;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5); border: 1px solid #388e3c; text-align: center;
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
                text = text.replace(/\{.*?\}/g, "").replace(/\\[Nn]/g, "<br>").trim(); 
                subs.push({ start: tToS(parts[1]), end: tToS(parts[2]), text: text });
            }
        }
    });
    return subs;
}

function adjustDelay(delta) { settings.delaySeconds = Math.round((settings.delaySeconds + delta) * 1000) / 1000; chrome.storage.local.set({ delaySeconds: settings.delaySeconds }); broadcastDelay(); }
function bakeDelay() { const d = settings.delaySeconds; if (d === 0) return; parsedSubtitles.forEach(c => { c.start += d; c.end += d; }); parsedSubtitles2.forEach(c => { c.start += d; c.end += d; }); settings.delaySeconds = 0; chrome.storage.local.set({ delaySeconds: 0 }); broadcastDelay(); }
function convertFps(fromFps, toFps) { if (!fromFps || !toFps || fromFps === toFps) return; const factor = fromFps / toFps; parsedSubtitles.forEach(c => { c.start *= factor; c.end *= factor; }); parsedSubtitles2.forEach(c => { c.start *= factor; c.end *= factor; }); }
function broadcastDelay() { chrome.runtime.sendMessage({ type: "DELAY_CHANGED", value: settings.delaySeconds }).catch(() => {}); }

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

function watchForVideoChanges() {
    if (videoWatchTimer) clearInterval(videoWatchTimer);
    videoWatchTimer = setInterval(() => {
        const v = getActiveVideo();
        const currentSrc = v ? v.currentSrc : "";
        if (v && (v !== activeVideo || currentSrc !== activeVideoSrc)) {
            activeVideo = v;
            activeVideoSrc = currentSrc;
            
            if (!settings.autoRestoreLastSubtitle) {
                parsedSubtitles = []; parsedSubtitles2 = [];
                if (customSubContainer) { customSubContainer.innerHTML = ""; customSubContainer.style.display = "none"; }
                if (customSubContainer2) { customSubContainer2.innerHTML = ""; customSubContainer2.style.display = "none"; }
            }

            if (parsedSubtitles.length > 0 || (settings.autoRestoreLastSubtitle && settings.lastSubtitle)) initContainer(v);
            if (parsedSubtitles2.length > 0 || (settings.autoRestoreLastSubtitle && settings.lastSubtitle2)) initContainer2(v);
            
            if (parsedSubtitles.length === 0 && settings.autoRestoreLastSubtitle && settings.lastSubtitle) restoreLastSubtitle("primary");
            ensureSyncLoop(v);
        } else if (!v && activeVideo) {
            activeVideo = null; activeVideoSrc = "";
        }
    }, 800);
}
watchForVideoChanges();

function tryInitialAutoRestore() {
    const v = getActiveVideo();
    if (v && settings.autoRestoreLastSubtitle && settings.lastSubtitle && parsedSubtitles.length === 0) {
        activeVideo = v; activeVideoSrc = v.currentSrc;
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
    const offsets = shadowLevel === "strong" ? [[-w,-w],[w,-w],[-w,w],[w,w],[0,-w],[0,w],[-w,0],[w,0],[0,0]] : [[-w,-w],[w,-w],[-w,w],[w,w]];
    return offsets.map(([x,y]) => `${x}px ${y}px ${shadowLevel === "strong" ? w : 1}px ${borderColor}`).join(", ");
}

function computeBoxRect() {
    if (!activeVideo) return null;
    const rect = activeVideo.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const isVertical = settings.aspectMode === "vertical" || (settings.aspectMode === "auto" && rect.height > rect.width * 1.1);
    const maxWidthRatio = isVertical ? 0.92 : (settings.aspectMode === "4:3" ? 0.65 : 0.9);
    return { rect, isVertical, maxWidthRatio };
}

function updateSubStyle() {
    if (!customSubContainer) return;
    const info = computeBoxRect();
    if (!info) { customSubContainer.style.display = "none"; return; }
    const { rect, maxWidthRatio } = info;

    const fontSize = `calc(clamp(14px, ${rect.width * 0.032}px, 58px) * ${settings.subSize / 100})`;
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
    const fontSize = `calc(clamp(14px, ${rect.width * 0.032}px, 58px) * ${settings.subSize2 / 100})`;
    
    // SECONDARY STACKS ABOVE OR BELOW PRIMARY
    const centerX = rect.left + rect.width / 2 + settings.posOffsetX; // Follows drag X axis
    const offsetPx = rect.height * 0.09; // 9% offset to stack

    let positionCss = "";
    if (settings.positionTop) {
        const topPx = rect.top + rect.height * (settings.edgeBottom / 100) - settings.posOffsetY + offsetPx;
        positionCss = `top: ${topPx}px;`;
    } else {
        const bottomPx = rect.top + rect.height * (1 - settings.edgeBottom / 100) - settings.posOffsetY;
        positionCss = `bottom: ${window.innerHeight - bottomPx + offsetPx}px;`;
    }

    customSubContainer2.style.cssText = `
        position: fixed; left: ${centerX}px; ${positionCss}
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
        dragging = true; startX = e.clientX; startY = e.clientY;
        baseX = settings.posOffsetX; baseY = settings.posOffsetY;
        e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        settings.posOffsetX = baseX + (e.clientX - startX);
        settings.posOffsetY = -(e.clientY - startY) + baseY;
        updateSubStyle(); updateSubStyle2();
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
            updateSubStyle(); updateSubStyle2();

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
                    // MUST BE innerHTML for formatting tags
                    customSubContainer.innerHTML = activeText;
                    if (customSubContainer.style.display !== "none") {
                        customSubContainer.style.display = activeText ? "block" : "none";
                    }
                }
                if (customSubContainer2 && settings.dualEnabled && parsedSubtitles2.length) {
                    let activeText2 = "";
                    for (let i = 0; i < parsedSubtitles2.length; i++) {
                        if (t >= parsedSubtitles2[i].start && t <= parsedSubtitles2[i].end) { activeText2 = parsedSubtitles2[i].text; break; }
                    }
                    customSubContainer2.innerHTML = activeText2;
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
