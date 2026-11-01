// =========================================================================
// ASS Subtitle Player - background.js (MV3 service worker)
// =========================================================================

const OS_BASE = "https://api.opensubtitles.com/api/v1";

async function getOpenSubtitlesApiKey() {
    const data = await chrome.storage.local.get(["openSubtitlesApiKey", "uiLang"]);
    const key = typeof data.openSubtitlesApiKey === "string" ? data.openSubtitlesApiKey.trim() : "";
    if (!key) throw new Error(data.uiLang === "tr"
        ? "Ara sekmesinden kendi OpenSubtitles API anahtarınızı kaydedin."
        : "Save your OpenSubtitles API key in the Search tab first.");
    return key;
}

async function searchSubtitles(query, lang) {
    if (typeof query !== "string" || !query.trim() || query.length > 200) throw new Error("Enter a valid movie or show title.");
    if (lang && !/^[a-z]{2,3}$/.test(lang)) throw new Error("Invalid subtitle language.");
    const apiKey = await getOpenSubtitlesApiKey();
    query = query.trim();
    const params = new URLSearchParams();
    params.set("query", query);
    if (lang) params.set("languages", lang);

    const res = await fetch(`${OS_BASE}/subtitles?${params.toString()}`, {
        method: "GET",
        signal: AbortSignal.timeout(20000),
        headers: {
            "Api-Key": apiKey,
            "Accept": "application/json"
        }
    });

    if (!res.ok) {
        throw new Error(`OpenSubtitles search failed: HTTP ${res.status}`);
    }
    const json = await res.json();
    const items = Array.isArray(json.data) ? json.data : [];

    return items.slice(0, 15).map(item => {
        const attr = item.attributes || {};
        const file = (attr.files && attr.files[0]) || {};
        const feature = attr.feature_details || {};
        return {
            file_id: file.file_id,
            file_name: file.file_name || attr.release || "altyazi.srt",
            release: attr.release || "",
            language: attr.language || "",
            title: feature.title || attr.feature_details?.movie_name || "",
            year: feature.year || "",
            download_count: attr.download_count || 0,
            ratings: attr.ratings || null
        };
    }).filter(r => r.file_id);
}

async function downloadSubtitle(fileId) {
    if (!Number.isSafeInteger(fileId) || fileId <= 0) throw new Error("Invalid subtitle file ID.");
    const apiKey = await getOpenSubtitlesApiKey();
    const res = await fetch(`${OS_BASE}/download`, {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: {
            "Api-Key": apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify({ file_id: fileId })
    });

    if (!res.ok) {
        const errText = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`OpenSubtitles download failed: HTTP ${res.status} ${errText}`);
    }
    const json = await res.json();
    if (!json.link) {
        throw new Error(json.message || "Could not get a download link.");
    }

    const link = new URL(json.link);
    if (link.protocol !== "https:") throw new Error("Invalid subtitle download link.");
    const fileRes = await fetch(link.href, { signal: AbortSignal.timeout(20000) });
    if (!fileRes.ok) {
        throw new Error(`Couldn't download the subtitle file: HTTP ${fileRes.status}`);
    }
    if (Number(fileRes.headers.get("content-length")) > 20 * 1024 * 1024) throw new Error("Subtitle file is too large.");
    const text = await fileRes.text();
    if (text.length > 20 * 1024 * 1024) throw new Error("Subtitle file is too large.");
    return { text, fileName: json.file_name || "altyazi.srt" };
}

// Probe each accessible frame once, then send the command to one player only.
// Broadcasting a command lets an empty frame win the response race, and can
// apply timeline changes more than once when a page contains several videos.
async function sendPlayerCommand(tabId, command, preferredFrameId) {
    if (!Number.isInteger(tabId) || !command || typeof command.type !== "string") return { ok: false, code: "E101" };
    let frameId = preferredFrameId;
    if (!Number.isInteger(frameId)) {
        let frames;
        try {
            frames = await chrome.scripting.executeScript({
                target: { tabId, allFrames: true },
                func: () => {
                    const videos = [];
                    const visit = root => {
                        videos.push(...root.querySelectorAll("video"));
                        for (const el of root.querySelectorAll("*")) if (el.shadowRoot) visit(el.shadowRoot);
                    };
                    visit(document);
                    let score = 0;
                    for (const video of videos) {
                        const r = video.getBoundingClientRect(), style = getComputedStyle(video);
                        const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
                        const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
                        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
                        const fullscreen = document.fullscreenElement;
                        const bonus = fullscreen && (fullscreen === video || fullscreen.contains(video)) ? 4 : 1;
                        score = Math.max(score, w * h * (!video.paused && !video.ended ? 2 : 1) * bonus);
                    }
                    return score;
                }
            });
        } catch (error) { return { ok: false, code: "E102", detail: String(error.message).slice(0, 160) }; }
        const best = frames.filter(f => f.result > 0).sort((a, b) => b.result - a.result || a.frameId - b.frameId)[0];
        if (!best) return { ok: false, code: "E103" };
        frameId = best.frameId;
    }
    try {
        const response = await chrome.tabs.sendMessage(tabId, command, { frameId });
        return response || { ok: false, code: "E102" };
    } catch (error) { return { ok: false, code: "E102", detail: String(error.message).slice(0, 160) }; }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request.type !== "string") return;
    let task;
    switch (request.type) {
        case "OS_SEARCH": task = searchSubtitles(request.query, request.lang).then(results => ({ ok: true, results })); break;
        case "OS_DOWNLOAD": task = downloadSubtitle(request.file_id).then(data => ({ ok: true, ...data })); break;
        case "GET_SITE_HOST":
            try { sendResponse({ hostname: new URL(sender.tab.url).hostname.replace(/^www\./, "") }); }
            catch (_) { sendResponse({}); }
            return;
        case "PLAYER_COMMAND":
            // Only extension pages may choose a tab; content scripts stay within their own tab.
            task = sendPlayerCommand(sender.tab ? sender.tab.id : request.tabId, request.command);
            break;
        case "OPEN_PICKER_TOP":
            if (!sender.tab) return;
            task = chrome.tabs.sendMessage(sender.tab.id, {
                type: "SHOW_PICKER_TOP", target: request.target, sourceFrameId: sender.frameId
            }, { frameId: 0 });
            break;
        case "RELAY_SUBTITLE":
            if (!sender.tab) return;
            task = sendPlayerCommand(sender.tab.id, {
                type: "LOAD_SUBTITLE_TEXT", text: request.text, ext: request.ext, name: request.name, target: request.target
            }, request.sourceFrameId);
            break;
        default: return;
    }
    Promise.resolve(task).then(sendResponse, error => sendResponse({ ok: false, error: error.message, detail: error.message }));
    return true;
});
