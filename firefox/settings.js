// Shared settings for the popup and every video frame.
const ASS_DEFAULTS = {
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

const ASS_SITE_PRESETS = {
    "youtube.com":      { subSize: 100, subColor: "#ffffff", subFont: "Roboto, sans-serif", edgeBottom: 10 },
    "netflix.com":      { subSize: 100, subColor: "#ffffff", subFont: "sans-serif", edgeBottom: 12 },
    "crunchyroll.com":  { subSize: 115, subColor: "#ffd400", subFont: "Arial, sans-serif", edgeBottom: 12 },
    "twitch.tv":        { subSize: 90,  subColor: "#ffffff", subFont: "sans-serif", edgeBottom: 14 },
    "vimeo.com":        { subSize: 100, subColor: "#ffffff", subFont: "sans-serif", edgeBottom: 12 }
};

const ASS_STYLE_KEYS = [
    "aspectMode", "subSize", "subOpacity", "subColor", "borderColor", "borderWidth",
    "shadowLevel", "subFont", "edgeBottom", "positionTop", "subColor2", "subSize2",
    "subOpacity2", "subFont2", "borderColor2", "borderWidth2", "shadowLevel2", "dualGap"
];

function subtitleHostname(value) {
    try { return new URL(value).hostname.replace(/^www\./, ""); }
    catch (_) { return String(value || "").replace(/^www\./, ""); }
}

function resolveSubtitleSettings(data, hostname) {
    const resolved = { ...ASS_DEFAULTS, ...data };
    const host = subtitleHostname(hostname);
    const preset = Object.keys(ASS_SITE_PRESETS).find(k => host === k || host.endsWith("." + k));
    if (preset && !ASS_STYLE_KEYS.some(k => data[k] !== undefined)) {
        Object.assign(resolved, ASS_SITE_PRESETS[preset]);
    }
    const profile = data.siteProfiles && data.siteProfiles[host];
    if (profile && typeof profile === "object") {
        for (const key of ASS_STYLE_KEYS) if (profile[key] !== undefined) resolved[key] = profile[key];
    }
    const ranges = {
        subSize: [50, 250], subSize2: [50, 250], subOpacity: [0, 100], subOpacity2: [0, 100],
        borderWidth: [0, 6], borderWidth2: [0, 6], edgeBottom: [0, 40], dualGap: [0, 60]
    };
    for (const key of Object.keys(ASS_DEFAULTS)) {
        const fallback = ASS_DEFAULTS[key], value = resolved[key];
        if (typeof fallback === "number") {
            resolved[key] = typeof value === "number" && Number.isFinite(value) ? value : fallback;
            if (ranges[key]) resolved[key] = Math.max(ranges[key][0], Math.min(ranges[key][1], resolved[key]));
        } else if (typeof fallback === "boolean" && typeof value !== "boolean") resolved[key] = fallback;
        else if (typeof fallback === "string" && typeof value !== "string") resolved[key] = fallback;
    }
    for (const key of ["subColor", "subColor2", "borderColor", "borderColor2"]) {
        if (!/^#[0-9a-f]{6}$/i.test(resolved[key])) resolved[key] = ASS_DEFAULTS[key];
    }
    if (!["auto", "16:9", "4:3", "vertical"].includes(resolved.aspectMode)) resolved.aspectMode = "auto";
    return resolved;
}
