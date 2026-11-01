const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function contentHarness(browser, overrides = {}) {
    const messages = [], storageListeners = [], callbacks = [], writes = [];
    const document = {
        head: null, body: null, documentElement: {}, activeElement: null,
        addEventListener() {}, createElement() { return {}; },
        querySelector() { return null; }, querySelectorAll() { return []; }
    };
    const window = { addEventListener() {}, innerHeight: 720 };
    window.top = window;
    const context = vm.createContext({
        console, document, window, navigator: { userAgent: 'Desktop' },
        location: { hostname: 'example.com', href: 'https://example.com/watch' },
        URL, URLSearchParams, TextDecoder, Uint8Array, ArrayBuffer, AbortSignal,
        setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
        requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
        chrome: {
            storage: {
                local: {
                    get(keys, cb) { callbacks.push(cb); },
                    set(patch) { writes.push(patch); return Promise.resolve(); }
                },
                onChanged: { addListener(fn) { storageListeners.push(fn); } }
            },
            runtime: {
                onMessage: { addListener(fn) { messages.push(fn); } },
                sendMessage(msg, cb) { if (cb) cb({ hostname: 'example.com' }); return Promise.resolve(); }
            }
        }, ...overrides
    });
    for (const name of ['i18n.js', 'settings.js', 'content.js']) {
        const file = path.join(root, browser, name);
        if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    }
    const run = code => vm.runInContext(code, context);
    const json = code => JSON.parse(JSON.stringify(run(code)));
    return { context, run, json, messages, storageListeners, callbacks, writes };
}
module.exports = { root, contentHarness };
