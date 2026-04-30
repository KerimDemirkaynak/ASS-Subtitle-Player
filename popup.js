document.addEventListener('DOMContentLoaded', () => {
    const toggleExtension = document.getElementById('toggle-extension');
    const uploadBtn = document.getElementById('upload-btn');
    const ratioBtn = document.getElementById('ratio-btn');
    const sizeSlider = document.getElementById('size-slider');
    const sizeValue = document.getElementById('size-value');

    chrome.storage.local.get(['isEnabled', 'is43Mode', 'subSize'], (data) => {
        if (data.isEnabled !== undefined) toggleExtension.checked = data.isEnabled;
        if (data.is43Mode !== undefined) {
            ratioBtn.innerText = data.is43Mode ? '📺 Format: 4:3' : '📺 Format: 16:9';
        }
        if (data.subSize !== undefined) {
            sizeSlider.value = data.subSize;
            sizeValue.innerText = data.subSize + '%';
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

    sizeSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        sizeValue.innerText = val + '%';
        chrome.storage.local.set({ subSize: val });
        broadcastMessage({ type: "CHANGE_SIZE", size: val });
    });

    uploadBtn.addEventListener('click', () => {
        broadcastMessage({ type: "SHOW_PICKER_UI" });
        window.close(); // Popup'ı kapat ki mobilde işlem yarım kalmasın, sayfaya dönülsün.
    });

    function broadcastMessage(msg) {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, msg, {frameId: undefined});
            }
        });
    }
});
