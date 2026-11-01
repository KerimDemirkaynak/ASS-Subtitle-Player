const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root, contentHarness } = require('./helpers.cjs');

for (const browser of ['chrome', 'firefox']) {
    test(`${browser}: UTF-8, Turkish ANSI, and UTF-16 files retain their characters`, () => {
        const h = contentHarness(browser);
        const text = 'İstanbul, ığüşöç';
        h.context.bytes = new Uint8Array(Buffer.from(text));
        assert.equal(h.run('decodeSubtitleBytes(bytes)'), text);
        h.context.bytes = new Uint8Array([0xdd, 0xfd, 0xf0, 0xfc, 0xfe, 0xf6, 0xe7]);
        assert.equal(h.run('decodeSubtitleBytes(bytes)'), 'İığüşöç');
        h.context.bytes = new Uint8Array(Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')]));
        assert.equal(h.run('decodeSubtitleBytes(bytes)'), text);
    });
    test(`${browser}: site presets require a domain boundary`, () => {
        const h = contentHarness(browser);
        assert.equal(h.run('resolveSubtitleSettings({}, "www.youtube.com").edgeBottom'), 10);
        assert.equal(h.run('resolveSubtitleSettings({}, "notyoutube.com").edgeBottom'), 12);
        assert.equal(h.run('resolveSubtitleSettings({ subSize: 150 }, "youtube.com").subSize'), 150);
    });
    test(`${browser}: site profiles override global styles and ignore missing values`, () => {
        const h = contentHarness(browser);
        assert.equal(h.run('resolveSubtitleSettings({ subSize: 120, siteProfiles: { "example.com": { subSize: 180, subFont: undefined } } }, "example.com").subSize'), 180);
        assert.equal(h.run('resolveSubtitleSettings({ siteProfiles: { "example.com": { subFont: undefined } } }, "example.com").subFont'), 'sans-serif');
        assert.equal(h.run('resolveSubtitleSettings({ subSize: null, delaySeconds: NaN }, "example.com").delaySeconds'), 0);
    });
    test(`${browser}: overlapping cues, seeks, layers, and exclusive end times`, () => {
        const h = contentHarness(browser);
        h.run('var cues = [{start:0,end:20,text:"long",layer:2}, {start:1,end:2,text:"short",layer:0}, {start:2,end:4,text:"next",layer:1}]');
        assert.deepEqual(h.json('collectActiveEntries(cues, 2).map(c => c.text)'), ['next', 'long']);
        assert.deepEqual(h.json('collectActiveEntries(cues, 1.5).map(c => c.text)'), ['short', 'long']);
        assert.deepEqual(h.json('collectActiveEntries(cues, 20)'), []);
    });
    test(`${browser}: delay baking and FPS conversion persist across restore`, () => {
        const h = contentHarness(browser);
        // Avoid a DOM in this unit test; the browser suite covers loading and rendering.
        h.run('showToast = () => {}; getActiveVideo = () => null;');
        const srt = '1\n00:00:01,000 --> 00:00:02,000\nTest';
        h.run(`loadSubtitleFromText(${JSON.stringify(srt)}, "srt", "test.srt", "primary")`);
        h.run('bakeDelay(-2); convertFps(25, 20)');
        assert.deepEqual(h.json('parsedSubtitles.map(c => [c.start, c.end])'), [[-1.25, 0]]);
        h.run('settings.delaySeconds = 3; restoreLastSubtitle("primary")');
        assert.deepEqual(h.json('parsedSubtitles.map(c => [c.start, c.end])'), [[-1.25, 0]]);
        assert.equal(h.run('settings.delaySeconds'), 3);
        assert.throws(() => h.run('convertFps(-25, 24)'), /Invalid FPS/);
    });
    test(`${browser}: a new file resets saved delay and rejects invalid files`, () => {
        const h = contentHarness(browser);
        h.run('showToast = () => {}; getActiveVideo = () => null; settings.delaySeconds = 5;');
        h.run('loadSubtitleFromText("1\\n00:00:01,000 --> 00:00:02,000\\nTest", "srt", "test.srt", "primary")');
        assert.equal(h.run('settings.delaySeconds'), 0);
        assert.ok(h.writes.some(p => p.delaySeconds === 0));
        assert.throws(() => h.run('loadSubtitleFromText("garbage", "srt", "bad.srt", "primary")'), /No valid subtitle/);
        assert.equal(h.run('parsedSubtitles.length'), 1);
    });
    test(`${browser}: clearing saved files clears the active subtitle arrays`, () => {
        const h = contentHarness(browser);
        h.run('parsedSubtitles = [{start:0,end:10,text:"stale"}]; parsedSubtitles2 = [{start:0,end:10,text:"stale"}];');
        h.storageListeners[0]({ lastSubtitle: { oldValue: {} }, lastSubtitle2: { oldValue: {} } }, 'local');
        assert.equal(h.run('parsedSubtitles.length + parsedSubtitles2.length'), 0);
    });
    test(`${browser}: changing a saved profile updates effective styles immediately`, () => {
        const h = contentHarness(browser);
        h.storageListeners[0]({ siteProfiles: { newValue: { 'example.com': { subSize: 170 } } } }, 'local');
        assert.equal(h.run('settings.subSize'), 170);
        h.storageListeners[0]({ siteProfiles: { newValue: {} } }, 'local');
        assert.equal(h.run('settings.subSize'), 100);
    });
}

test('browser implementations stay identical and manifests reference existing files', () => {
    for (const file of ['content.js', 'background.js', 'settings.js', 'popup.js', 'popup.html', 'i18n.js']) {
        const read = browser => fs.readFileSync(path.join(root, browser, file), 'utf8').replace(/\r/g, '');
        assert.equal(read('chrome'), read('firefox'), file);
    }
    for (const browser of ['chrome', 'firefox']) {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, browser, 'manifest.json'), 'utf8'));
        assert.ok(manifest.description.length <= 132);
        for (const file of manifest.content_scripts[0].js) assert.ok(fs.existsSync(path.join(root, browser, file)), file);
        assert.ok(manifest.content_scripts[0].match_about_blank);
    }
});
