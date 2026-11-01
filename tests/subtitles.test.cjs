const test = require('node:test');
const assert = require('node:assert/strict');
const { contentHarness } = require('./helpers.cjs');

for (const browser of ['chrome', 'firefox']) {
    test(`${browser}: starts on mobile at document_start without a head`, () => {
        assert.doesNotThrow(() => contentHarness(browser, { navigator: { userAgent: 'Android Mobile' } }));
    });
    test(`${browser}: accepts SRT whitespace, BOM, CR lines, and cue settings`, () => {
        const h = contentHarness(browser);
        const srt = '\uFEFF1\r00:00:01,000-->00:00:02,500 align:start\rMerhaba\r \r2\r00:00:03.000 --> 00:00:04.000\rDünya';
        const subs = h.json(`parseSRT(${JSON.stringify(srt)})`);
        assert.equal(subs.length, 2);
        assert.equal(subs[0].text, 'Merhaba');
        assert.equal(subs[0].end, 2.5);
    });
    test(`${browser}: skips broken timings and sorts cues`, () => {
        const h = contentHarness(browser);
        const srt = '1\n00:00:03,000 --> 00:00:04,000\nlater\n\n2\n00:00:01,000 --> 00:00:02,000\nearlier\n\n3\nbad --> bad\nbad\n\n4\n00:00:05,000 --> 00:00:04,000\nbackward';
        const subs = h.json(`parseSRT(${JSON.stringify(srt)})`);
        assert.deepEqual(subs.map(c => c.start), [1, 3]);
    });
    test(`${browser}: respects ASS event Format, signed positions, and layers`, () => {
        const h = contentHarness(browser);
        const ass = '[Script Info]\nPlayResX: 1920\nPlayResY: 1080\n[Events]\nFormat: Start, End, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0:00:01.00,0:00:03.00,2,Default,,0,0,0,,{\\pos(-10,20)\\an7}A, B';
        const result = h.json(`parseASS(${JSON.stringify(ass)})`);
        assert.equal(result.subs[0].start, 1);
        assert.deepEqual(result.subs[0].pos, { x: -10, y: 20 });
        assert.equal(result.subs[0].layer, 2);
        assert.equal(result.subs[0].text, 'A, B');
    });
    test(`${browser}: ASS drawing instructions are hidden and literal markup is escaped`, () => {
        const h = contentHarness(browser);
        const input = '{\\p1}m 0 0 l 10 10{\\p0}A < B\\hC';
        const html = h.run(`convertASSFormattingToHTML(${JSON.stringify(input)})`);
        assert.equal(html, 'A &lt; B\u00a0C');
    });
    test(`${browser}: zero outline width is respected`, () => {
        const h = contentHarness(browser);
        assert.equal(h.run('buildTextShadow("#000000", 0, "normal")'), 'none');
    });
}
