document.addEventListener("DOMContentLoaded", () => {
    const $ = (id) => document.getElementById(id);
    let currentLang = "en";

    function applyI18n(lang) {
        document.querySelectorAll("[data-i18n]").forEach(el => {
            el.textContent = i18nText(el.getAttribute("data-i18n"), lang);
        });
        document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
            el.placeholder = i18nText(el.getAttribute("data-i18n-placeholder"), lang);
        });
        document.querySelectorAll(".lang-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.lang === lang);
        });
    }

    document.querySelectorAll(".lang-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            currentLang = btn.dataset.lang;
            chrome.storage.local.set({ uiLang: currentLang });
            applyI18n(currentLang);
            broadcastMessage({ type: "SET_LANG", lang: currentLang });
        });
    });

    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            $("tab-" + btn.dataset.tab).classList.add("active");
        });
    });

    function broadcastMessage(msg) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, msg, { frameId: undefined }).catch(() => {});
        });
    }

    function getActiveTab(cb) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => cb(tabs[0]));
    }

    function saveAndBroadcastStyle(patch) {
        chrome.storage.local.set(patch);
        broadcastMessage({ type: "STYLE_UPDATE", patch });
    }

    const STORAGE_KEYS = [
        "uiLang","isEnabled","aspectMode","subSize","subOpacity","subColor","borderColor",
        "borderWidth","shadowLevel","subFont","edgeBottom","delaySeconds","dualEnabled",
        "subColor2","subSize2","autoRestoreLastSubtitle","syncProfiles","siteProfiles","positionTop"
    ];

    chrome.storage.local.get(STORAGE_KEYS, (data) => {
        currentLang = data.uiLang === "tr" ? "tr" : "en";
        applyI18n(currentLang);

        if (data.isEnabled !== undefined) $("toggle-extension").checked = data.isEnabled;
        if (data.subSize !== undefined) { $("size-slider").value = data.subSize; $("size-value").innerText = data.subSize + "%"; }
        if (data.subOpacity !== undefined) { $("opacity-slider").value = data.subOpacity; $("opacity-value").innerText = data.subOpacity + "%"; }
        if (data.edgeBottom !== undefined) { $("edge-slider").value = data.edgeBottom; $("edge-value").innerText = data.edgeBottom + "%"; }
        if (data.subColor !== undefined) $("color-picker").value = data.subColor;
        if (data.borderColor !== undefined) $("border-color-picker").value = data.borderColor;
        if (data.borderWidth !== undefined) { $("border-width-slider").value = data.borderWidth; $("border-width-value").innerText = data.borderWidth + "px"; }
        if (data.shadowLevel !== undefined) $("shadow-select").value = data.shadowLevel;
        if (data.subFont !== undefined) $("font-select").value = data.subFont;
        if (data.aspectMode !== undefined) $("ratio-select").value = data.aspectMode;
        if (data.delaySeconds !== undefined) updateDelayUI(data.delaySeconds);
        if (data.dualEnabled !== undefined) $("dual-toggle").checked = data.dualEnabled;
        if (data.subSize2 !== undefined) { $("size2-slider").value = data.subSize2; $("size2-value").innerText = data.subSize2 + "%"; }
        if (data.subColor2 !== undefined) $("color2-picker").value = data.subColor2;
        if (data.autoRestoreLastSubtitle !== undefined) $("auto-restore-toggle").checked = data.autoRestoreLastSubtitle;
        if (data.positionTop !== undefined) $("position-top-toggle").checked = data.positionTop;
    });

    getActiveTab((tab) => {
        try {
            const host = new URL(tab.url).hostname.replace(/^www\./, "");
            $("current-host").innerText = host;
        } catch (e) { $("current-host").innerText = "-"; }
    });

    function updateDelayUI(value) {
        $("delay-slider").value = value;
        $("delay-display").innerText = (value >= 0 ? "+" : "") + value.toFixed(2) + "s";
    }

    $("toggle-extension").addEventListener("change", (e) => {
        chrome.storage.local.set({ isEnabled: e.target.checked });
        broadcastMessage({ type: "TOGGLE_EXTENSION", isEnabled: e.target.checked });
    });

    $("upload-btn").addEventListener("click", () => {
        broadcastMessage({ type: "SHOW_PICKER_UI", target: "primary" });
        window.close();
    });
    $("upload-btn-2").addEventListener("click", () => {
        broadcastMessage({ type: "SHOW_PICKER_UI", target: "secondary" });
        window.close();
    });
    $("last-sub-btn").addEventListener("click", () => {
        broadcastMessage({ type: "LOAD_LAST_SUBTITLE", target: "primary" });
        window.close();
    });
    $("last-sub-btn-2").addEventListener("click", () => {
        broadcastMessage({ type: "LOAD_LAST_SUBTITLE", target: "secondary" });
        window.close();
    });

    $("size-slider").addEventListener("input", (e) => {
        $("size-value").innerText = e.target.value + "%";
        saveAndBroadcastStyle({ subSize: Number(e.target.value) });
    });
    $("opacity-slider").addEventListener("input", (e) => {
        $("opacity-value").innerText = e.target.value + "%";
        saveAndBroadcastStyle({ subOpacity: Number(e.target.value) });
    });
    $("edge-slider").addEventListener("input", (e) => {
        $("edge-value").innerText = e.target.value + "%";
        saveAndBroadcastStyle({ edgeBottom: Number(e.target.value) });
    });
    $("color-picker").addEventListener("input", (e) => saveAndBroadcastStyle({ subColor: e.target.value }));
    $("border-color-picker").addEventListener("input", (e) => saveAndBroadcastStyle({ borderColor: e.target.value }));
    $("border-width-slider").addEventListener("input", (e) => {
        $("border-width-value").innerText = e.target.value + "px";
        saveAndBroadcastStyle({ borderWidth: Number(e.target.value) });
    });
    $("shadow-select").addEventListener("change", (e) => saveAndBroadcastStyle({ shadowLevel: e.target.value }));
    $("font-select").addEventListener("change", (e) => saveAndBroadcastStyle({ subFont: e.target.value }));
    $("ratio-select").addEventListener("change", (e) => {
        chrome.storage.local.set({ aspectMode: e.target.value });
        broadcastMessage({ type: "TOGGLE_RATIO", aspectMode: e.target.value });
    });
    $("drag-mode-toggle").addEventListener("change", (e) => {
        chrome.storage.local.set({ dragMode: e.target.checked });
        broadcastMessage({ type: "TOGGLE_DRAG_MODE", dragMode: e.target.checked });
    });
    $("position-top-toggle").addEventListener("change", (e) => {
        chrome.storage.local.set({ positionTop: e.target.checked });
        saveAndBroadcastStyle({ positionTop: e.target.checked });
    });

    $("delay-slider").addEventListener("input", (e) => {
        const v = Number(e.target.value);
        updateDelayUI(v);
        chrome.storage.local.set({ delaySeconds: v });
        broadcastMessage({ type: "SET_DELAY", value: v });
    });

    function nudgeDelay(delta) {
        chrome.storage.local.get(["delaySeconds"], (data) => {
            const v = Math.round(((data.delaySeconds || 0) + delta) * 100) / 100;
            updateDelayUI(v);
            chrome.storage.local.set({ delaySeconds: v });
            broadcastMessage({ type: "ADJUST_DELAY", delta });
        });
    }
    $("delay-minus-1").addEventListener("click", () => nudgeDelay(-1));
    $("delay-minus-01").addEventListener("click", () => nudgeDelay(-0.1));
    $("delay-plus-01").addEventListener("click", () => nudgeDelay(0.1));
    $("delay-plus-1").addEventListener("click", () => nudgeDelay(1));
    $("delay-reset").addEventListener("click", () => {
        updateDelayUI(0);
        chrome.storage.local.set({ delaySeconds: 0 });
        broadcastMessage({ type: "RESET_DELAY" });
    });
    $("delay-bake").addEventListener("click", () => {
        broadcastMessage({ type: "BAKE_DELAY" });
        updateDelayUI(0);
        chrome.storage.local.set({ delaySeconds: 0 });
    });

    $("frame-shift-apply").addEventListener("click", () => {
        const frames = Number($("frame-shift-input").value || 0);
        const fps = Number($("frame-shift-fps").value);
        if (!frames || !fps) return;
        nudgeDelay(frames / fps);
    });

    $("fps-convert-btn").addEventListener("click", () => {
        const fromFps = Number($("fps-from").value);
        const toFps = Number($("fps-to").value);
        broadcastMessage({ type: "CONVERT_FPS", fromFps, toFps });
    });

    function saveSyncProfile(slot) {
        chrome.storage.local.get(["delaySeconds", "syncProfiles"], (data) => {
            const profiles = data.syncProfiles || { tv: null, bluray: null };
            profiles[slot] = { delaySeconds: data.delaySeconds || 0 };
            chrome.storage.local.set({ syncProfiles: profiles });
        });
    }
    function loadSyncProfile(slot) {
        chrome.storage.local.get(["syncProfiles"], (data) => {
            const profiles = data.syncProfiles || {};
            const p = profiles[slot];
            if (!p) return;
            updateDelayUI(p.delaySeconds);
            chrome.storage.local.set({ delaySeconds: p.delaySeconds });
            broadcastMessage({ type: "SET_DELAY", value: p.delaySeconds });
        });
    }
    $("save-tv").addEventListener("click", () => saveSyncProfile("tv"));
    $("load-tv").addEventListener("click", () => loadSyncProfile("tv"));
    $("save-bluray").addEventListener("click", () => saveSyncProfile("bluray"));
    $("load-bluray").addEventListener("click", () => loadSyncProfile("bluray"));

    $("autosync-btn").addEventListener("click", () => {
        broadcastMessage({ type: "START_AUTO_SYNC" });
        window.close();
    });

    chrome.runtime.onMessage.addListener((request) => {
        if (request.type === "DELAY_CHANGED") updateDelayUI(request.value);
    });

    $("dual-toggle").addEventListener("change", (e) => {
        chrome.storage.local.set({ dualEnabled: e.target.checked });
        broadcastMessage({ type: "TOGGLE_DUAL", dualEnabled: e.target.checked });
    });
    $("size2-slider").addEventListener("input", (e) => {
        $("size2-value").innerText = e.target.value + "%";
        saveAndBroadcastStyle({ subSize2: Number(e.target.value) });
    });
    $("color2-picker").addEventListener("input", (e) => saveAndBroadcastStyle({ subColor2: e.target.value }));

    $("search-btn").addEventListener("click", () => {
        const query = $("search-query").value.trim();
        const lang = $("search-lang").value;
        const statusEl = $("search-status");
        const resultsEl = $("search-results");
        
        resultsEl.textContent = ""; 
        
        if (!query) { statusEl.innerText = i18nText("search_enter_title", currentLang); return; }
        statusEl.innerText = i18nText("search_searching", currentLang);

        chrome.runtime.sendMessage({ type: "OS_SEARCH", query, lang }, (res) => {
            if (!res || !res.ok) {
                const errMsg = res ? res.error : i18nText("search_unknown_error", currentLang);
                statusEl.innerText = i18nText("search_error", currentLang, { error: errMsg });
                return;
            }
            if (res.results.length === 0) {
                statusEl.innerText = i18nText("search_no_results", currentLang);
                return;
            }
            statusEl.innerText = i18nText("search_results_found", currentLang, { count: res.results.length });
            res.results.forEach(r => resultsEl.appendChild(renderSearchResult(r)));
        });
    });

    function renderSearchResult(r) {
        const card = document.createElement("div");
        card.className = "search-result";

        const titleLine = document.createElement("div");
        const boldText = document.createElement("b");
        boldText.textContent = r.title || r.file_name || "";
        titleLine.appendChild(boldText);
        if (r.year) titleLine.appendChild(document.createTextNode(` (${r.year})`));
        card.appendChild(titleLine);

        const metaLine = document.createElement("div");
        metaLine.className = "meta";
        metaLine.innerText = `${r.release || r.file_name} · ${r.language || "?"} · ${r.download_count} ${i18nText("search_downloads_suffix", currentLang)}`;
        card.appendChild(metaLine);

        const dlBtn = document.createElement("button");
        dlBtn.innerText = i18nText("download_btn", currentLang);
        dlBtn.className = "btn-amber";
        dlBtn.addEventListener("click", () => {
            dlBtn.innerText = i18nText("download_downloading", currentLang);
            dlBtn.disabled = true;
            chrome.runtime.sendMessage({ type: "OS_DOWNLOAD", file_id: r.file_id }, (res) => {
                if (!res || !res.ok) {
                    const errMsg = res ? res.error : i18nText("download_unknown_error", currentLang);
                    dlBtn.innerText = i18nText("download_error", currentLang, { error: errMsg });
                    dlBtn.disabled = false;
                    return;
                }
                const ext = (res.fileName.split(".").pop() || "srt").toLowerCase();
                const target = $("search-target").value;
                broadcastMessage({ type: "LOAD_SUBTITLE_TEXT", text: res.text, ext, name: res.fileName, target });
                dlBtn.innerText = i18nText("download_loaded", currentLang);
            });
        });
        card.appendChild(dlBtn);
        return card;
    }

    $("save-site-profile").addEventListener("click", () => {
        getActiveTab((tab) => {
            let host;
            try { host = new URL(tab.url).hostname.replace(/^www\./, ""); } catch (e) { return; }
            chrome.storage.local.get(STORAGE_KEYS, (data) => {
                const patch = {
                    subSize: data.subSize, subOpacity: data.subOpacity, subColor: data.subColor,
                    borderColor: data.borderColor, borderWidth: data.borderWidth, shadowLevel: data.shadowLevel,
                    subFont: data.subFont, edgeBottom: data.edgeBottom, aspectMode: data.aspectMode
                };
                const siteProfiles = data.siteProfiles || {};
                siteProfiles[host] = patch;
                chrome.storage.local.set({ siteProfiles });
            });
        });
    });
    $("reset-site-profile").addEventListener("click", () => {
        getActiveTab((tab) => {
            let host;
            try { host = new URL(tab.url).hostname.replace(/^www\./, ""); } catch (e) { return; }
            chrome.storage.local.get(["siteProfiles"], (data) => {
                const siteProfiles = data.siteProfiles || {};
                delete siteProfiles[host];
                chrome.storage.local.set({ siteProfiles });
            });
        });
    });
    $("auto-restore-toggle").addEventListener("change", (e) => {
        chrome.storage.local.set({ autoRestoreLastSubtitle: e.target.checked });
    });

    $("reset-all-settings").addEventListener("click", () => {
        if (confirm(i18nText("reset_all_confirm", currentLang))) {
            chrome.storage.local.clear(() => {
                chrome.runtime.reload();
                window.close();
            });
        }
    });
});
