const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function installedWebRecorder() {
  const tracks = [];
  const listeners = new Set();
  const urls = [];
  const instances = [];
  class MediaRecorder {
    static isTypeSupported() { return true; }
    constructor(stream) { this.state = 'inactive'; this.stream = stream; this.listeners = new Map(); instances.push(this); }
    addEventListener(event, callback) { const callbacks = this.listeners.get(event) ?? []; callbacks.push(callback); this.listeners.set(event, callbacks); }
    emit(event, data) { this.listeners.get(event)?.forEach((callback) => callback(data)); }
    start() { assert.equal(this.state, 'inactive'); this.state = 'recording'; this.emit('start'); }
    stop() {
      if (this.state === 'inactive') throw new Error('InvalidStateError');
      this.state = 'inactive';
      queueMicrotask(() => {
        this.emit('dataavailable', { data: new Blob(['discarded audio']) });
        // Deliberately release resources on the following task, after Expo's
        // stop promise resolves. The lifecycle helper must wait for this event.
        setTimeout(() => this.emit('stop'), 0);
      });
    }
  }
  const mediaDevices = {
    enumerateDevices: async () => [],
    addEventListener: (_event, listener) => listeners.add(listener),
    removeEventListener: (_event, listener) => listeners.delete(listener),
  };
  const { AudioRecorderWeb } = loadTsModule('node_modules/expo-audio/src/AudioRecorder.web.ts', {
    requireShim: (name) => {
      if (name === './AudioEventKeys') return { RECORDING_STATUS_UPDATE: 'recordingStatusUpdate' };
      if (name === './RecordingConstants') return { RecordingPresets: { HIGH_QUALITY: { web: { mimeType: 'audio/webm' } } } };
      if (name === './AudioUtils.web') return { nextId: () => 1, getUserMedia: async () => {
        const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
        return { getTracks: () => [track] };
      } };
      return require(name);
    },
    context: { expo: { SharedObject: class { emit() {} } }, navigator: { mediaDevices }, MediaRecorder,
      URL: { createObjectURL: () => { const uri = 'blob:recording-' + urls.length; urls.push(uri); return uri; } }, setTimeout, clearTimeout, Blob },
  });
  return { recorder: new AudioRecorderWeb({}), tracks, listeners, urls, instances };
}
function lifecycle() {
  return loadTsModule('src/features/notes/utils/note-recorder-lifecycle.ts', {
    requireShim: (name) => name === 'react-native' ? { Platform: { OS: 'web' } } : require(name),
    context: { setTimeout },
  });
}

test('installed Expo prepared-web stop throws and keeps capture, but queued public cleanup releases tracks and device listener', async () => {
  const state = installedWebRecorder();
  await state.recorder.prepareToRecordAsync();
  await assert.rejects(state.recorder.stop(), /InvalidStateError/);
  assert.equal(state.tracks[0].stopped, false);
  assert.equal(state.listeners.size, 1);
  const uri = await lifecycle().stopNoteRecorder(state.recorder, true);
  assert.equal(uri, 'blob:recording-0');
  assert.equal(state.tracks[0].stopped, true);
  assert.equal(state.listeners.size, 0);
  assert.equal(state.recorder.getStatus().canRecord, false);
  await state.recorder.prepareToRecordAsync();
  state.recorder.record();
  await lifecycle().stopNoteRecorder(state.recorder);
  assert.ok(state.tracks.every((track) => track.stopped));
  assert.equal(state.listeners.size, 0);
});

test('cleanup after an accepted stop does not restart recording or return its previous preview URL', async () => {
  const state = installedWebRecorder();
  const { stopNoteRecorder } = lifecycle();
  await state.recorder.prepareToRecordAsync(); state.recorder.record();
  const accepted = await stopNoteRecorder(state.recorder);
  assert.equal(accepted, 'blob:recording-0');
  assert.equal(await stopNoteRecorder(state.recorder, true), undefined);
  assert.equal(state.recorder.uri, accepted);
  assert.equal(state.urls.length, 1);
  assert.ok(state.tracks[0].stopped);
  assert.equal(state.listeners.size, 0);
});

test('a stop that publishes no new URI cannot return an earlier accepted web preview', async () => {
  const recorder = { uri: 'blob:accepted', getStatus: () => ({ canRecord: true, isRecording: true, url: 'blob:accepted' }),
    record: () => { throw new Error('Should not restart'); }, stop: async () => undefined };
  assert.equal(await lifecycle().stopNoteRecorder(recorder, true), undefined);
  assert.equal(recorder.uri, 'blob:accepted');
});
