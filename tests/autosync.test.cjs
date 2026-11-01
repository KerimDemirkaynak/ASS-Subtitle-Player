const test = require('node:test');
const assert = require('node:assert/strict');
const { contentHarness } = require('./helpers.cjs');

for (const browser of ['chrome', 'firefox']) {
    test(`${browser}: auto-sync finishes and releases audio without rerouting playback`, async () => {
        const h = contentHarness(browser);
        let now = 0, stopped = 0, disconnected = 0, closed = 0;
        const frames = [], panels = [];
        const source = { connect() {}, disconnect() { disconnected++; } };
        const analyser = { fftSize: 1024, getByteTimeDomainData(data) { data.fill(128); }, disconnect() { disconnected++; } };
        h.context.window.AudioContext = class {
            resume() { return Promise.resolve(); }
            createMediaStreamSource() { return source; }
            createMediaElementSource() { throw new Error('Playback must never be rerouted'); }
            createAnalyser() { return analyser; }
            close() { closed++; return Promise.resolve(); }
        };
        h.context.video = {
            paused: false, ended: false, playbackRate: 1, currentTime: 10, isConnected: true,
            captureStream() { return { getAudioTracks: () => [{}], getTracks: () => [{ stop() { stopped++; } }] }; }
        };
        h.context.performance = { now: () => now };
        h.context.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
        h.context.panelSpy = message => panels.push(message);
        h.run('getActiveVideo = () => video; showAutoSyncPanel = panelSpy; parsedSubtitles = [{start:10,end:12,text:"Test"}];');
        await h.run('startAutoSyncEstimate()');
        now = 30001;
        h.context.video.currentTime = 40.001;
        frames.shift()();
        assert.equal(stopped, 1);
        assert.equal(disconnected, 2);
        assert.equal(closed, 1);
        assert.match(panels.at(-1), /Not enough speech/);
        assert.equal(h.run('autoSyncSession'), null);
    });
    test(`${browser}: no subtitle reports a real error`, async () => {
        const h = contentHarness(browser);
        h.context.video = {};
        h.run('getActiveVideo = () => video');
        await assert.rejects(h.run('startAutoSyncEstimate()'), /Load a subtitle file first/);
    });
}
