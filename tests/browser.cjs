const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { root } = require('./helpers.cjs');
let playwright;
try { playwright = require('playwright'); }
catch (error) {
    if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
    playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
}

// Mock extension transport/storage only. DOM layout, file inputs, sanitizing,
// fullscreen containers, pointer input, and popup scripts use the real engine.
function mockExtension() {
    const listeners = [], storageListeners = [];
    window.__messages = [];
    window.__store = {};
    window.__dispatch = message => new Promise(resolve => {
        let pending = false, answered = false;
        const answer = result => { answered = true; resolve(result); };
        for (const listener of listeners) pending = listener(message, {}, answer) === true || pending;
        if (!pending && !answered) resolve(undefined);
    });
    const done = (result, callback) => {
        if (callback) queueMicrotask(() => callback(result));
        return Promise.resolve(result);
    };
    const tab = { id: 7, url: 'https://fixture.test/watch' };
    window.chrome = {
        tabs: { query: (_query, callback) => done([tab], callback) },
        runtime: {
            lastError: undefined,
            onMessage: { addListener: fn => listeners.push(fn) },
            sendMessage: (message, callback) => {
                window.__messages.push(message);
                if (message.type === 'GET_SITE_HOST') return done({ hostname: 'fixture.test' }, callback);
                if (message.type === 'PLAYER_COMMAND') return done({ ok: true }, callback);
                return done({ ok: true }, callback);
            }
        },
        storage: {
            local: {
                get: (keys, callback) => done(Object.fromEntries(keys.filter(key => key in window.__store).map(key => [key, structuredClone(window.__store[key])])), callback),
                set: (patch, callback) => {
                    const changes = {};
                    for (const [key, value] of Object.entries(patch)) {
                        changes[key] = { oldValue: window.__store[key], newValue: structuredClone(value) };
                        window.__store[key] = structuredClone(value);
                    }
                    queueMicrotask(() => storageListeners.forEach(fn => fn(changes, 'local')));
                    return done(undefined, callback);
                },
                clear: callback => {
                    const changes = Object.fromEntries(Object.entries(window.__store).map(([key, value]) => [key, { oldValue: value }]));
                    window.__store = {};
                    queueMicrotask(() => storageListeners.forEach(fn => fn(changes, 'local')));
                    return done(undefined, callback);
                }
            },
            onChanged: { addListener: fn => storageListeners.push(fn) }
        }
    };
}

const fixture = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0}#player{margin:20px;width:calc(100vw - 40px);max-width:640px;aspect-ratio:16/9;background:#222}
video{width:100%;height:100%;object-fit:contain}div{font-size:4px;color:purple}b{font-size:99px}</style></head>
<body><div id="player"><video></video></div><script>
const fixtureVideo=document.querySelector('video');
Object.defineProperties(fixtureVideo,{videoWidth:{value:1280},videoHeight:{value:720},currentTime:{value:2,writable:true}});
</script></body></html>`;

const mixedASS = '[Script Info]\nPlayResX: 1280\nPlayResY: 720\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,First line\nDialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Second line\nDialogue: 1,0:00:01.00,0:00:05.00,Default,,0,0,0,,{\\pos(640,80)\\an8\\fs36}Sign';
const srt = '1\n00:00:01,000 --> 00:00:05,000\nİstanbul, ığüşöç';

async function main() {
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/popup/')) {
            const name = path.basename(req.url.split('?')[0]);
            if (['popup.html', 'popup.js', 'i18n.js', 'settings.js'].includes(name)) {
                res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : 'text/javascript');
                res.end(fs.readFileSync(path.join(root, 'chrome', name)));
                return;
            }
        }
        res.setHeader('Content-Type', 'text/html');
        res.end(fixture);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const engines = (process.env.BROWSER_ENGINES || 'chromium,firefox').split(',');
    let scenarios = 0;
    try {
        for (const engine of engines) {
            const browser = await playwright[engine].launch({ headless: true });
            try {
                for (const mobile of [false, true]) {
                    const context = await browser.newContext({
                        viewport: mobile ? { width: 390, height: 844 } : { width: 900, height: 700 },
                        userAgent: mobile ? 'Mozilla/5.0 (Android 13; Mobile) Firefox/142.0' : undefined
                    });
                    const page = await context.newPage();
                    const errors = [];
                    page.on('pageerror', error => errors.push(error.message));
                    const variant = engine === 'firefox' ? 'firefox' : 'chrome';
                    const source = ['i18n.js', 'settings.js', 'content.js'].map(name => fs.readFileSync(path.join(root, variant, name), 'utf8')).join('\n');
                    await page.addInitScript({ content: `(${mockExtension.toString()})();\n${source}` });
                    await page.goto(base);
                    await page.waitForSelector('video');
                    assert.equal((await page.evaluate(text => window.__dispatch({ type: 'LOAD_SUBTITLE_TEXT', text, ext: 'ass', name: 'mixed.ass', target: 'primary' }), mixedASS)).ok, true);
                    assert.equal((await page.evaluate(text => window.__dispatch({ type: 'LOAD_SUBTITLE_TEXT', text, ext: 'srt', name: 'second.srt', target: 'secondary' }), srt)).ok, true);
                    await page.waitForFunction(() => document.querySelector('#ass-ext-primary')?.shadowRoot.textContent.includes('Second line'));
                    const layout = await page.evaluate(() => {
                        const primary = document.querySelector('#ass-ext-primary');
                        const secondary = document.querySelector('#ass-ext-secondary');
                        const normal = [...primary.shadowRoot.querySelectorAll('div')].find(n => n._assDefault);
                        const sign = [...primary.shadowRoot.querySelectorAll('div')].find(n => n._assEntry);
                        window.__stableText = normal.firstChild;
                        return { primary: normal.getBoundingClientRect().toJSON(), secondary: secondary.getBoundingClientRect().toJSON(), sign: sign.getBoundingClientRect().toJSON(), video: document.querySelector('video').getBoundingClientRect().toJSON() };
                    });
                    assert.ok(layout.secondary.bottom < layout.primary.top, `${engine}: dual captions overlap`);
                    assert.ok(layout.secondary.top >= layout.video.top, `${engine}: dual caption left the video`);
                    assert.ok(layout.sign.width > 0);
                    // A style update with unchanged cues must reuse the text DOM.
                    await page.evaluate(() => chrome.storage.local.set({ subColor: '#ff0000' }));
                    await page.waitForFunction(() => document.querySelector('#ass-ext-primary').style.color === 'rgb(255, 0, 0)');
                    assert.ok(await page.evaluate(() => [...document.querySelector('#ass-ext-primary').shadowRoot.querySelectorAll('div')].find(n => n._assDefault).firstChild === window.__stableText));

                    await page.evaluate(() => document.querySelector('video').currentTime = 5);
                    await page.waitForFunction(() => document.querySelector('#ass-ext-primary').style.display === 'none');
                    await page.evaluate(() => document.querySelector('video').currentTime = 2);
                    await page.waitForFunction(() => document.querySelector('#ass-ext-primary').style.display === 'block');

                    // A wrapper fullscreen element must own the overlays.
                    await page.evaluate(() => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.querySelector('#player') }); document.dispatchEvent(new Event('fullscreenchange')); });
                    assert.equal(await page.evaluate(() => document.querySelector('#ass-ext-primary').parentElement.id), 'player');
                    await page.evaluate(() => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null }); document.dispatchEvent(new Event('fullscreenchange')); });

                    // Native video fullscreen gets a native caption track, including line breaks.
                    await page.evaluate(() => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.querySelector('video') }); document.dispatchEvent(new Event('fullscreenchange')); });
                    await page.waitForFunction(() => [...document.querySelector('video').textTracks].some(t => t.label === 'ASS Subtitle Player' && t.mode === 'showing' && t.cues.length));
                    assert.ok(await page.evaluate(() => [...document.querySelector('video').textTracks].find(t => t.label === 'ASS Subtitle Player').cues[0].text.includes('\n')));
                    await page.evaluate(() => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null }); document.dispatchEvent(new Event('fullscreenchange')); });
                    await page.waitForFunction(() => [...document.querySelector('video').textTracks].every(t => t.mode === 'disabled'));

                    // Loading a bad file keeps the picker open and allows a corrected selection.
                    await page.evaluate(() => window.__dispatch({ type: 'SHOW_PICKER_UI', target: 'primary' }));
                    const input = page.locator('#ass-ext-floating-picker input[type=file]');
                    await input.setInputFiles({ name: 'bad.srt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
                    await page.waitForFunction(() => document.querySelector('#ass-ext-floating-picker')?.shadowRoot.textContent.includes('No valid subtitle'));
                    await input.setInputFiles({ name: 'turkish.ass', mimeType: 'text/plain', buffer: Buffer.from(mixedASS.replace('First line', 'İstanbul ığüşöç')) });
                    await page.waitForFunction(() => !document.querySelector('#ass-ext-floating-picker'));
                    await page.waitForFunction(() => document.querySelector('#ass-ext-primary').shadowRoot.textContent.includes('İstanbul ığüşöç'));
                    assert.equal(await page.evaluate(() => window.__store.lastSubtitle.content.includes('İstanbul ığüşöç')), true);

                    // Untrusted SRT tags and URL-bearing attributes never enter the live DOM.
                    await page.evaluate(text => window.__dispatch({ type: 'LOAD_SUBTITLE_TEXT', text, ext: 'srt', name: 'safe.srt', target: 'primary' }), srt.replace('İstanbul, ığüşöç', '<b onclick="window.pwned=1">Safe</b><img src=x onerror="window.pwned=1"><script>window.pwned=1</script>'));
                    assert.equal(await page.evaluate(() => document.querySelector('#ass-ext-primary').shadowRoot.querySelectorAll('img,script,[onclick],[onerror]').length), 0);
                    assert.equal(await page.evaluate(() => window.pwned), undefined);

                    // Dragging uses pointer capture, persists its offset, and moves both tracks.
                    await page.evaluate(text => window.__dispatch({ type: 'LOAD_SUBTITLE_TEXT', text, ext: 'srt', name: 'drag.srt', target: 'primary' }), srt);
                    await page.evaluate(() => chrome.storage.local.set({ dragMode: true }));
                    await page.waitForFunction(() => document.querySelector('#ass-ext-primary').style.pointerEvents === 'auto');
                    const before = await page.locator('#ass-ext-primary').boundingBox();
                    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
                    await page.mouse.down();
                    await page.mouse.move(before.x + before.width / 2 + 25, before.y + before.height / 2 + 20);
                    await page.mouse.up();
                    await page.waitForFunction(() => window.__store.posOffsetX === 25 && window.__store.posOffsetY === -20);
                    assert.equal(await page.evaluate(() => document.querySelector('#ass-ext-secondary').style.left), await page.evaluate(() => document.querySelector('#ass-ext-primary').style.left));

                    await page.evaluate(() => chrome.storage.local.clear());
                    await page.waitForFunction(() => document.querySelector('#ass-ext-primary').style.display === 'none' && document.querySelector('#ass-ext-secondary').style.display === 'none');
                    assert.deepEqual(errors, [], `${engine} ${mobile ? 'mobile' : 'desktop'} runtime errors`);
                    scenarios++;
                    console.log(`PASS ${engine} ${mobile ? 'mobile' : 'desktop'}: rendering, dual layout, native/wrapper fullscreen, picker, sanitizing, drag, reset`);
                    await context.close();
                }

                const popupContext = await browser.newContext();
                const popup = await popupContext.newPage();
                const popupErrors = [];
                popup.on('pageerror', error => popupErrors.push(error.message));
                await popup.addInitScript(mockExtension);
                await popup.goto(base + '/popup/popup.html');
                await popup.locator('[data-tab=senkron]').click();
                await popup.locator('#delay-plus-01').click();
                await popup.waitForFunction(() => window.__store.delaySeconds === 0.1);
                assert.equal(await popup.evaluate(() => window.__messages.filter(m => m.type === 'PLAYER_COMMAND').at(-1).command.type), 'SET_DELAY');
                await popup.locator('#delay-bake').click();
                await popup.waitForFunction(() => window.__messages.some(m => m.type === 'PLAYER_COMMAND' && m.command.type === 'BAKE_DELAY' && m.command.value === 0.1));
                await popup.locator('[data-tab=site]').click();
                await popup.locator('#save-site-profile').click();
                await popup.waitForFunction(() => window.__store.siteProfiles?.['fixture.test']);
                assert.ok(await popup.evaluate(() => Object.values(window.__store.siteProfiles['fixture.test']).every(value => value !== undefined)));
                await popup.locator('[data-lang=tr]').click();
                await popup.waitForFunction(() => document.documentElement.lang === 'tr');
                assert.deepEqual(popupErrors, []);
                scenarios++;
                console.log(`PASS ${engine} popup: delay nudges, bake payload, complete site profile, language`);
                await popupContext.close();
            } finally { await browser.close(); }
        }
        console.log(`${scenarios} browser scenarios passed`);
    } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
