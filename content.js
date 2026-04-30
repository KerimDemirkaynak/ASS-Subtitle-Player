let customSubContainer = null;
let parsedSubtitles = [];
let syncAnimationId = null;
let is43Mode = false;
let isEnabled = true;
let subSizeMultiplier = 1.0;

chrome.storage.local.get(['isEnabled', 'is43Mode', 'subSize'], (data) => {
    if (data.isEnabled !== undefined) isEnabled = data.isEnabled;
    if (data.is43Mode !== undefined) is43Mode = data.is43Mode;
    if (data.subSize !== undefined) subSizeMultiplier = data.subSize / 100;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "SHOW_PICKER_UI") {
        // ÇİFT ÇIKMA SORUNUNUN ÇÖZÜMÜ: 
        // Sadece içinde video barındıran frame bu kutuyu ekrana çizsin.
        if (document.querySelector('video')) {
            injectFilePickerUI();
        }
    } else if (request.type === "TOGGLE_EXTENSION") {
        isEnabled = request.isEnabled;
        if (customSubContainer) customSubContainer.style.display = isEnabled ? "block" : "none";
    } else if (request.type === "TOGGLE_RATIO") {
        is43Mode = request.is43Mode;
        updateSubStyle();
    } else if (request.type === "CHANGE_SIZE") {
        subSizeMultiplier = request.size / 100;
        updateSubStyle();
    }
    return true;
});

// Sayfa içi UI enjeksiyonu
function injectFilePickerUI() {
    let existing = document.getElementById('ass-ext-floating-picker');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'ass-ext-floating-picker';
    container.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 2147483647;
        background: rgba(30, 30, 30, 0.95); padding: 15px; border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.6); border: 1px solid #555;
        display: flex; flex-direction: column; gap: 10px; font-family: sans-serif;
        color: white; width: 250px;
    `;

    const title = document.createElement('div');
    title.innerText = '🎬 Select Subtitle File';
    title.style.cssText = 'font-weight: bold; font-size: 14px; text-align: center; border-bottom: 1px solid #444; padding-bottom: 5px; margin-bottom: 5px;';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.ass,.ssa,.srt';
    fileInput.style.cssText = 'color: white; font-size: 12px; cursor: pointer;';

    const closeBtn = document.createElement('button');
    closeBtn.innerText = 'Cancel';
    closeBtn.style.cssText = 'background: #d32f2f; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 5px;';

    closeBtn.onclick = () => container.remove();

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const extension = file.name.split('.').pop().toLowerCase();
        const reader = new FileReader();

        reader.onload = (event) => {
            parsedSubtitles = (extension === 'srt') ? parseSRT(event.target.result) : parseASS(event.target.result);
            if (parsedSubtitles.length > 0) {
                const video = document.querySelector('video');
                if (video) {
                    initContainer(video);
                    startSyncLoop(video);
                }
            }
            container.remove(); // İşlem bitince UI'ı yok et
        };
        const encoding = (extension === 'srt') ? 'utf-8' : 'windows-1254';
        reader.readAsText(file, encoding);
    };

    container.appendChild(title);
    container.appendChild(fileInput);
    container.appendChild(closeBtn);
    document.body.appendChild(container);
}

function initContainer(videoElement) {
    if (customSubContainer) customSubContainer.remove();
    customSubContainer = document.createElement('div');
    updateSubStyle();
    videoElement.parentNode.appendChild(customSubContainer);
}

function updateSubStyle() {
    if (!customSubContainer) return;
    const maxWidth = is43Mode ? "65%" : "90%";
    const calculatedFontSize = `calc(clamp(16px, 3.5vw, 60px) * ${subSizeMultiplier})`;

    customSubContainer.style.cssText = `
        position: absolute; bottom: 12%; left: 50%; transform: translateX(-50%);
        width: 100%; max-width: ${maxWidth} !important; text-align: center;
        pointer-events: none; z-index: 2147483647; font-family: sans-serif;
        font-size: ${calculatedFontSize} !important; font-weight: bold; color: white;
        text-shadow: 2px 2px 3px black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black, 1px 1px 0 black;
        display: block; white-space: pre-wrap; line-height: 1.2;
    `;
}

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
