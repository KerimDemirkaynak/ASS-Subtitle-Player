document.addEventListener("DOMContentLoaded", () => {
    const $ = (id) => document.getElementById(id);
    let currentLang = "en";

    function applyI18n(lang) {
        document.documentElement.lang = lang;
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

    async function sendPlayerMessage(command) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0] || tabs[0].id === undefined) return { ok: false, code: "E101" };
        return chrome.runtime.sendMessage({ type: "PLAYER_COMMAND", tabId: tabs[0].id, command });
    }

    function broadcastMessage(msg) {
        return sendPlayerMessage(msg).catch(() => null);
    }

    // ---- Real-error reporting for actions that close the popup ----------
    // The popup only closes once the page confirmed the action. If nothing
    // confirms it, we retry a few times (covers slow page / slow content
    // script) and only then show an error code.
    const ERR_TEXT = {
        E101: { en: "No active tab found.", tr: "Aktif sekme bulunamadı." },
        E102: { en: "Can't reach this page. Reload it, or open a normal web page (not about:/add-ons).", tr: "Bu sayfaya ulaşılamıyor. Sayfayı yenileyin veya normal bir web sayfası açın (about:/eklenti sayfaları olmaz)." },
        E103: { en: "No video found on this page. Start the video, then try again.", tr: "Bu sayfada video bulunamadı. Videoyu başlatıp tekrar deneyin." },
        E104: { en: "The page reported an internal error.", tr: "Sayfa bir iç hata bildirdi." },
        E105: { en: "Unexpected error.", tr: "Beklenmeyen hata." }
    };
    function showErrorCode(code, detail) {
        const el = $("error-banner");
        const t = ERR_TEXT[code] || ERR_TEXT.E105;
        el.textContent = "";
        const b = document.createElement("b");
        b.textContent = (currentLang === "tr" ? "Hata " : "Error ") + code;
        el.appendChild(b);
        el.appendChild(document.createTextNode(" · " + t[currentLang === "tr" ? "tr" : "en"]));
        if (detail) {
            const d = document.createElement("div");
            d.style.cssText = "font-family:monospace; font-size:10px; opacity:.8; margin-top:3px; word-break:break-word;";
            d.textContent = detail;
            el.appendChild(d);
        }
        el.style.display = "block";
    }
    function clearErrorCode() { $("error-banner").style.display = "none"; }

    function sendAndConfirm(msg, closeAfter = true) {
        clearErrorCode();
        const ATTEMPTS = 4, WAIT_MS = 400;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab || tab.id === undefined) { showErrorCode("E101"); return; }
            let attempt = 0;
            const tryOnce = () => {
                attempt++;
                let p;
                try { p = chrome.runtime.sendMessage({ type: "PLAYER_COMMAND", tabId: tab.id, command: msg }); } catch (e) { p = Promise.reject(e); }
                Promise.resolve(p).then((res) => {
                    if (res && res.ok === true) { if (closeAfter) window.close(); return; }
                    if (res && res.ok === false) {
                        if (["E102", "E103"].includes(res.code) && attempt < ATTEMPTS) { setTimeout(tryOnce, WAIT_MS); return; }
                        showErrorCode(res.code || "E104", res.detail || res.error); return;
                    }
                    // Page is reachable but no frame with a video answered (yet)
                    if (attempt < ATTEMPTS) setTimeout(tryOnce, WAIT_MS);
                    else showErrorCode("E103");
                }).catch((err) => {
                    const m = String((err && err.message) || err);
                    const unreachable = /Receiving end does not exist|Could not establish connection/i.test(m);
                    if (attempt < ATTEMPTS) setTimeout(tryOnce, WAIT_MS);
                    else if (unreachable) showErrorCode("E102");
                    else showErrorCode("E105", m.slice(0, 120));
                });
            };
            tryOnce();
        });
    }

    function getActiveTab(cb) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => cb(tabs && tabs[0]));
    }

    function saveAndBroadcastStyle(patch) {
        getActiveTab(tab => {
            const host = subtitleHostname(tab?.url);
            chrome.storage.local.get(["siteProfiles"], data => {
                const siteProfiles = data.siteProfiles || {};
                const update = { ...patch };
                if (siteProfiles[host]) {
                    siteProfiles[host] = { ...siteProfiles[host], ...patch };
                    update.siteProfiles = siteProfiles;
                }
                chrome.storage.local.set(update);
            });
        });
    }

    const STORAGE_KEYS = Object.keys(ASS_DEFAULTS);
    function refreshSettings() {
        getActiveTab(tab => chrome.storage.local.get(STORAGE_KEYS, raw => {
            applySettings(resolveSubtitleSettings(raw, subtitleHostname(tab?.url)));
        }));
    }

    function applySettings(data) {
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
        if (data.subOpacity2 !== undefined) { $("opacity2-slider").value = data.subOpacity2; $("opacity2-value").innerText = data.subOpacity2 + "%"; }
        if (data.subColor2 !== undefined) $("color2-picker").value = data.subColor2;
        if (data.borderColor2 !== undefined) $("border-color2-picker").value = data.borderColor2;
        if (data.borderWidth2 !== undefined) { $("border-width2-slider").value = data.borderWidth2; $("border-width2-value").innerText = data.borderWidth2 + "px"; }
        if (data.shadowLevel2 !== undefined) $("shadow2-select").value = data.shadowLevel2;
        if (data.subFont2 !== undefined) $("font2-select").value = data.subFont2;
        if (data.dualGap !== undefined) { $("dual-gap-slider").value = data.dualGap; $("dual-gap-value").innerText = data.dualGap + "px"; }
        if (data.autoRestoreLastSubtitle !== undefined) $("auto-restore-toggle").checked = data.autoRestoreLastSubtitle;
        if (data.positionTop !== undefined) $("position-top-toggle").checked = data.positionTop;
        $("drag-mode-toggle").checked = data.dragMode;
    }
    refreshSettings();
    chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") refreshSettings(); });

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
        sendAndConfirm({ type: "SHOW_PICKER_UI", target: "primary" });
    });
    $("upload-btn-2").addEventListener("click", () => {
        sendAndConfirm({ type: "SHOW_PICKER_UI", target: "secondary" });
    });
    $("last-sub-btn").addEventListener("click", () => {
        sendAndConfirm({ type: "LOAD_LAST_SUBTITLE", target: "primary" });
    });
    $("last-sub-btn-2").addEventListener("click", () => {
        sendAndConfirm({ type: "LOAD_LAST_SUBTITLE", target: "secondary" });
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
            broadcastMessage({ type: "SET_DELAY", value: v });
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
        chrome.storage.local.get(["delaySeconds"], data => {
            sendAndConfirm({ type: "BAKE_DELAY", value: data.delaySeconds || 0 }, false);
        });
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
        sendAndConfirm({ type: "CONVERT_FPS", fromFps, toFps }, false);
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
        sendAndConfirm({ type: "START_AUTO_SYNC" });
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
    $("opacity2-slider").addEventListener("input", (e) => {
        $("opacity2-value").innerText = e.target.value + "%";
        saveAndBroadcastStyle({ subOpacity2: Number(e.target.value) });
    });
    $("color2-picker").addEventListener("input", (e) => saveAndBroadcastStyle({ subColor2: e.target.value }));
    $("border-color2-picker").addEventListener("input", (e) => saveAndBroadcastStyle({ borderColor2: e.target.value }));
    $("border-width2-slider").addEventListener("input", (e) => {
        $("border-width2-value").innerText = e.target.value + "px";
        saveAndBroadcastStyle({ borderWidth2: Number(e.target.value) });
    });
    $("shadow2-select").addEventListener("change", (e) => saveAndBroadcastStyle({ shadowLevel2: e.target.value }));
    $("font2-select").addEventListener("change", (e) => saveAndBroadcastStyle({ subFont2: e.target.value }));
    $("dual-gap-slider").addEventListener("input", (e) => {
        $("dual-gap-value").innerText = e.target.value + "px";
        saveAndBroadcastStyle({ dualGap: Number(e.target.value) });
    });

    function refreshApiKey() {
        chrome.storage.local.get(["openSubtitlesApiKey"], data => {
            $("os-api-key").value = data.openSubtitlesApiKey || "";
        });
    }
    refreshApiKey();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.openSubtitlesApiKey) refreshApiKey();
    });
    $("os-api-key-save").addEventListener("click", () => {
        chrome.storage.local.set({ openSubtitlesApiKey: $("os-api-key").value.trim() });
    });

    let searchGeneration = 0;
    $("search-btn").addEventListener("click", () => {
        const generation = ++searchGeneration;
        const query = $("search-query").value.trim();
        const lang = $("search-lang").value;
        const statusEl = $("search-status");
        const resultsEl = $("search-results");

        resultsEl.textContent = "";

        if (!query) { statusEl.innerText = i18nText("search_enter_title", currentLang); return; }
        statusEl.innerText = i18nText("search_searching", currentLang);

        chrome.runtime.sendMessage({ type: "OS_SEARCH", query, lang }, (res) => {
            const lastError = chrome.runtime.lastError;
            if (generation !== searchGeneration) return;
            if (lastError || !res || !res.ok) {
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
            const target = $("search-target").value;
            dlBtn.innerText = i18nText("download_downloading", currentLang);
            dlBtn.disabled = true;
            chrome.runtime.sendMessage({ type: "OS_DOWNLOAD", file_id: r.file_id }, async (res) => {
                const lastError = chrome.runtime.lastError;
                if (lastError || !res || !res.ok) {
                    const errMsg = res ? res.error : i18nText("download_unknown_error", currentLang);
                    dlBtn.innerText = i18nText("download_error", currentLang, { error: errMsg });
                    dlBtn.disabled = false;
                    return;
                }
                const ext = (res.fileName.split(".").pop() || "srt").toLowerCase();
                const response = await sendPlayerMessage({ type: "LOAD_SUBTITLE_TEXT", text: res.text, ext, name: res.fileName, target }).catch(error => ({ error: error.message }));
                if (response?.ok) dlBtn.innerText = i18nText("download_loaded", currentLang);
                else {
                    dlBtn.innerText = i18nText("download_error", currentLang, { error: response?.detail || response?.error || response?.code || "E102" });
                    dlBtn.disabled = false;
                }
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
                const effective = resolveSubtitleSettings(data, host);
                const patch = Object.fromEntries(ASS_STYLE_KEYS.map(key => [key, effective[key]]));
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
            // No runtime.reload(): it orphans the content scripts in open tabs and leaves the
            // last subtitle frozen on screen. The content scripts reset themselves via storage.onChanged.
            chrome.storage.local.clear(() => {
                window.close();
            });
        }
    });
});
