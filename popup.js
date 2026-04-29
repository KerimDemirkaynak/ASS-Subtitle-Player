document.addEventListener('DOMContentLoaded', () => {
    const toggleExtension = document.getElementById('toggle-extension');
    const uploadBtn = document.getElementById('upload-btn');
    const ratioBtn = document.getElementById('ratio-btn');
    const statusText = document.getElementById('status');

    // Durumu yükle
    chrome.storage.local.get(['isEnabled', 'is43Mode'], (data) => {
        if (data.isEnabled !== undefined) toggleExtension.checked = data.isEnabled;
        if (data.is43Mode !== undefined) {
            ratioBtn.innerText = data.is43Mode ? '📺 Format: 4:3' : '📺 Format: 16:9';
        }
    });

    toggleExtension.addEventListener('change', (e) => {
        chrome.storage.local.set({ isEnabled: e.target.checked });
        broadcastMessage({ type: "TOGGLE_EXTENSION", isEnabled: e.target.checked });
    });

    ratioBtn.addEventListener('click', () => {
        chrome.storage.local.get(['is43Mode'], (data) => {
            const newVal = !data.is43Mode;
            ratioBtn.innerText = newVal ? '📺 Format: 4:3' : '📺 Format: 16:9';
            chrome.storage.local.set({ is43Mode: newVal });
            broadcastMessage({ type: "TOGGLE_RATIO", is43Mode: newVal });
        });
    });

    // En önemli kısım: Dosya seçme komutunu tüm frame'lere gönder
    uploadBtn.addEventListener('click', () => {
        statusText.innerText = "Opening file picker...";
        broadcastMessage({ type: "TRIGGER_PICKER" });
    });

    // Tüm frame'lere mesaj gönderen fonksiyon
    function broadcastMessage(msg) {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                // frameId: undefined tüm frame'lere gönderir
                chrome.tabs.sendMessage(tabs[0].id, msg, {frameId: undefined}, (response) => {
                    if (chrome.runtime.lastError) { /* ignore */ }
                    if (response && response.success) {
                        statusText.innerText = `✅ Loaded in player!`;
                        statusText.style.color = "#4caf50";
                    }
                });
            }
        });
    }
});
