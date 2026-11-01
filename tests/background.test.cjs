const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root } = require('./helpers.cjs');

for (const browser of ['chrome', 'firefox']) {
    function harness(fetch = async () => { throw new Error('Unexpected network request'); }) {
        const sent = [], listeners = [];
        const context = vm.createContext({ URL, URLSearchParams, AbortSignal, fetch, chrome: {
            storage: { local: { get: async () => ({ openSubtitlesApiKey: "test-key" }) } },
            scripting: { executeScript: async () => [
                { frameId: 0, result: 0 }, { frameId: 3, result: 800 }, { frameId: 5, result: 100 }
            ] },
            tabs: { sendMessage: async (...args) => { sent.push(args); return { ok: true }; } },
            runtime: { onMessage: { addListener: fn => listeners.push(fn) } }
        } });
        vm.runInContext(fs.readFileSync(path.join(root, browser, 'background.js'), 'utf8'), context);
        const run = code => vm.runInContext(code, context);
        return { context, sent, run, listeners };
    }
    test(`${browser}: commands go to the best video frame exactly once`, async () => {
        const h = harness();
        await h.run('sendPlayerCommand(12, {type:"BAKE_DELAY",value:2})');
        assert.equal(h.sent.length, 1);
        assert.equal(h.sent[0][2].frameId, 3);
        assert.equal(h.sent[0][1].value, 2);
    });
    test(`${browser}: a relayed picker file stays with its requesting frame`, async () => {
        const h = harness();
        await new Promise(resolve => h.listeners[0]({ type: 'RELAY_SUBTITLE', sourceFrameId: 5, text: 'test', ext: 'srt' }, { tab: { id: 12 }, frameId: 0 }, resolve));
        assert.equal(h.sent[0][2].frameId, 5);
        assert.equal(h.sent[0][1].type, 'LOAD_SUBTITLE_TEXT');
    });
    test(`${browser}: empty frames return E103 without executing a command`, async () => {
        const h = harness();
        h.context.chrome.scripting.executeScript = async () => [{ frameId: 0, result: 0 }];
        const res = await h.run('sendPlayerCommand(12, {type:"SHOW_PICKER_UI"})');
        assert.equal(res.code, 'E103');
        assert.equal(h.sent.length, 0);
    });
    test(`${browser}: missing user API key fails locally before any request`, async () => {
        const h = harness();
        h.context.chrome.storage.local.get = async () => ({});
        await assert.rejects(h.run('searchSubtitles("Movie", "tr")'), /API key/);
    });
    test(`${browser}: invalid OpenSubtitles requests consume no network quota`, async () => {
        const h = harness();
        await assert.rejects(h.run('searchSubtitles("", "tr")'), /valid/);
        await assert.rejects(h.run('downloadSubtitle(-1)'), /Invalid/);
    });
    test(`${browser}: OpenSubtitles errors propagate and requests have timeouts`, async () => {
        let signal;
        const h = harness(async (_url, options) => {
            signal = options.signal;
            return { ok: false, status: 429 };
        });
        await assert.rejects(h.run('searchSubtitles("Movie", "tr")'), /HTTP 429/);
        assert.ok(signal instanceof AbortSignal);
    });
}
