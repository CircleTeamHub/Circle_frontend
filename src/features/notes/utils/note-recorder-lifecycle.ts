import { Platform } from 'react-native';

type NoteRecorder = {
  uri: string | null;
  getStatus: () => { canRecord: boolean; isRecording?: boolean; url?: string | null };
  record: () => void;
  stop: () => Promise<void>;
};

/** Called inside the shared recorder queue, including for abandoned preparation. */
export async function stopNoteRecorder(recorder: NoteRecorder, prepared = false): Promise<string | undefined> {
  const isWeb = Platform.OS === 'web';
  const previousUri = recorder.uri;
  if (isWeb) {
    const status = recorder.getStatus();
    // Expo retains the previous uri after stopping. A second cleanup must not
    // revoke that accepted preview or stop a recorder that no longer exists.
    if (!status.canRecord && !status.isRecording) return undefined;
    // Web preparation already owns a microphone stream/listener. MediaRecorder
    // stop() throws while inactive; a brief start followed by stop runs Expo's
    // public cleanup path and releases the stream before the next queued start.
    if (prepared && !status.isRecording) recorder.record();
  }
  await recorder.stop();
  const uri = recorder.uri ?? recorder.getStatus().url ?? undefined;
  if (isWeb) {
    // Expo resolves stop at dataavailable; track/listener cleanup runs on the
    // following stop event. Yield one task before letting the queue start again.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return isWeb && uri === previousUri ? undefined : uri ?? undefined;
}
