// =========================================================================
// ASS Subtitle Player - background.js (MV3 service worker)
// Tüm OpenSubtitles.com API trafiği burada yapılır, çünkü extension'ın
// arka plan context'i CORS kısıtlamasına tabi değildir (content script veya
// sayfa içinden yapılan fetch çoğu zaman CORS'a çarpar).
//
// API tüketicisi (OpenSubtitles.com developer portalında kayıtlı):
//   App adı : Hiabums
//   Açıklama: "Hiç bişey yok."
//   Durum   : Under dev = true, Allow anonymous = true
// "Allow anonymous: true" sayesinde login/JWT akışına gerek yok, sadece
// Api-Key header'ı ile arama ve indirme yapılabiliyor.
//
// NOT: Bu key client-side kodun içinde gönderiliyor; extension'ı paketten
// (crx/xpi) çıkaran herkes key'i görebilir. Kişisel/dev kullanım için
// sorun değil, ama public store'a yayınlarsan rate-limit/abuse riskine
// karşı bir proxy sunucusu üzerinden geçirmen daha güvenli olur.
// =========================================================================

const OS_API_KEY = "jKrCXu3qO8z7OSYtS1LE1FxuF0GSPisC";
const OS_BASE = "https://api.opensubtitles.com/api/v1";

async function searchSubtitles(query, lang) {
    const params = new URLSearchParams();
    params.set("query", query);
    if (lang) params.set("languages", lang);

    const res = await fetch(`${OS_BASE}/subtitles?${params.toString()}`, {
        method: "GET",
        headers: {
            "Api-Key": OS_API_KEY,
            "Accept": "application/json"
        }
    });

    if (!res.ok) {
        throw new Error(`OpenSubtitles search failed: HTTP ${res.status}`);
    }
    const json = await res.json();
    const items = Array.isArray(json.data) ? json.data : [];

    // Sadece arayüzde göstereceğimiz alanları sade bir şekille çıkar.
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
    const res = await fetch(`${OS_BASE}/download`, {
        method: "POST",
        headers: {
            "Api-Key": OS_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify({ file_id: fileId })
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`OpenSubtitles download failed: HTTP ${res.status} ${errText}`);
    }
    const json = await res.json();
    if (!json.link) {
        throw new Error(json.message || "Could not get a download link (the anonymous daily download quota may be exhausted).");
    }

    const fileRes = await fetch(json.link);
    if (!fileRes.ok) {
        throw new Error(`Couldn't download the subtitle file: HTTP ${fileRes.status}`);
    }
    const text = await fileRes.text();
    return { text, fileName: json.file_name || "altyazi.srt" };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "OS_SEARCH") {
        searchSubtitles(request.query, request.lang)
            .then(results => sendResponse({ ok: true, results }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true; // keep the message channel open for the async sendResponse
    }

    if (request.type === "OS_DOWNLOAD") {
        downloadSubtitle(request.file_id)
            .then(data => sendResponse({ ok: true, ...data }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }
});
