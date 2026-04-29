let customSubContainer = null;
let parsedSubtitles = [];
let syncAnimationId = null;
let is43Mode = false;
let isEnabled = true;

// İlk ayarları al
chrome.storage.local.get(['isEnabled', 'is43Mode'], (data) => {
    if (data.isEnabled !== undefined) isEnabled = data.isEnabled;
    if (data.is43Mode !== undefined) is43Mode = data.is43Mode;
});

// Mesajları dinle (Popup'tan gelen doğrudan komutlar)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const video = document.querySelector('video');
    
    if (request.type === "TRIGGER_PICKER") {
        if (video) {
            triggerFileInput(video);
            sendResponse({ success: true });
        }
    } else if (request.type === "TOGGLE_EXTENSION") {
        isEnabled = request.isEnabled;
        if (customSubContainer) customSubContainer.style.display = isEnabled ? "block" : "none";
    } else if (request.type === "TOGGLE_RATIO") {
        is43Mode = request.is43Mode;
        updateSubStyle();
    }
    return true;
});

function triggerFileInput(videoElement) {
    let fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.ass,.ssa,.srt';
    
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const extension = file.name.split('.').pop().toLowerCase();
        const reader = new FileReader();

        reader.onload = (event) => {
            parsedSubtitles = (extension === 'srt') ? parseSRT(event.target.result) : parseASS(event.target.result);
            if (parsedSubtitles.length > 0) {
                initContainer(videoElement);
                startSyncLoop(videoElement);
            }
        };
        const encoding = (extension === 'srt') ? 'utf-8' : 'windows-1254';
        reader.readAsText(file, encoding);
    };
    fileInput.click();
}

function initContainer(videoElement) {
    if (customSubContainer) customSubContainer.remove();
    customSubContainer = document.createElement('div');
    updateSubStyle();
    // Videonun hemen üstündeki kapsayıcıya ekle (Tam ekran uyumu için)
    videoElement.parentNode.appendChild(customSubContainer);
}

function updateSubStyle() {
    if (!customSubContainer) return;
    const maxWidth = is43Mode ? "65%" : "90%";
    customSubContainer.style.cssText = `
        position: absolute; bottom: 12%; left: 50%; transform: translateX(-50%);
        width: 100%; max-width: ${maxWidth} !important; text-align: center;
        pointer-events: none; z-index: 999999; font-family: sans-serif;
        font-size: clamp(14px, 4vw, 24px) !important; font-weight: bold; color: white;
        text-shadow: 2px 2px 3px black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black, 1px 1px 0 black;
        display: block; white-space: pre-wrap; line-height: 1.2;
    `;
}

// SRT/ASS Parse ve Loop fonksiyonları (Orijinal ile aynı, stabil çalışıyorlar)
function parseSRT(data) {
    const subs = [];
    const blocks = data.trim().split(/\r?\n\r?\n/);
    const tToS = (t) => {
        const p = t.trim().replace(',', '.').split(':');
        return (parseFloat(p[0]) * 3600) + (parseFloat(p[1]) * 60) + parseFloat(p[2]);
    };
    blocks.forEach(block => {
        const lines = block.split(/\r?\n/);
        if (lines.length >= 3) {
            const timeRange = lines[1].split(' --> ');
            if (timeRange.length === 2) {
                subs.push({ start: tToS(timeRange[0]), end: tToS(timeRange[1]), text: lines.slice(2).join('\n').trim() });
            }
        }
    });
    return subs;
}

function parseASS(assText) {
    const lines = assText.split('\n');
    let subs = [];
    const tToS = (t) => {
        const p = t.trim().split(':');
        return p.length < 3 ? 0 : (parseFloat(p[0]) * 3600) + (parseFloat(p[1]) * 60) + parseFloat(p[2]);
    };
    lines.forEach(line => {
        if (line.startsWith('Dialogue:')) {
            const parts = line.split(',');
            if (parts.length >= 10) {
                let text = parts.slice(9).join(',');
                text = text.replace(/\{.*?\}/g, '').replace(/\\[Nn]/g, '\n').trim();
                subs.push({ start: tToS(parts[1]), end: tToS(parts[2]), text: text });
            }
        }
    });
    return subs;
}

function startSyncLoop(videoElement) {
    if (syncAnimationId) cancelAnimationFrame(syncAnimationId);
    function checkTime() {
        if (!isEnabled || parsedSubtitles.length === 0) {
            if (customSubContainer) customSubContainer.style.display = "none";
        } else {
            const currentTime = videoElement.currentTime;
            let activeText = "";
            for (let i = 0; i < parsedSubtitles.length; i++) {
                if (currentTime >= parsedSubtitles[i].start && currentTime <= parsedSubtitles[i].end) {
                    activeText = parsedSubtitles[i].text;
                    break;
                }
            }
            if (customSubContainer) {
                customSubContainer.innerText = activeText;
                customSubContainer.style.display = activeText ? "block" : "none";
            }
        }
        syncAnimationId = requestAnimationFrame(checkTime);
    }
    checkTime();
}
