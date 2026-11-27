import test from "node:test";
import assert from "node:assert/strict";
import {
  computeMicLevel,
  formatStaplerClock,
  formatStaplerDockCopy,
  resolveStaplerCloseAction,
  resolveStaplerMood,
} from "../lib/stapler-state";

test("minimize/close preserves active and paused recordings in the background", () => {
  assert.deepEqual(resolveStaplerCloseAction("recording"), {
    keepRecording: true,
    nextOpen: false,
    showBackgroundHint: true,
  });
  assert.deepEqual(resolveStaplerCloseAction("paused"), {
    keepRecording: true,
    nextOpen: false,
    showBackgroundHint: true,
  });
  assert.deepEqual(resolveStaplerCloseAction("idle"), {
    keepRecording: false,
    nextOpen: false,
    showBackgroundHint: false,
  });
});

test("resolveStaplerMood prioritizes recording and paused states over open/nudge/draft", () => {
  assert.equal(
    resolveStaplerMood({ recordingState: "recording", celebrating: true, hasNudge: true, open: true, hasDraft: true }),
    "recording",
  );
  assert.equal(
    resolveStaplerMood({ recordingState: "paused", celebrating: false, hasNudge: false, open: false, hasDraft: false }),
    "paused",
  );
  assert.equal(
    resolveStaplerMood({ recordingState: "idle", celebrating: false, hasNudge: false, open: false, hasDraft: true }),
    "draft",
  );
  assert.equal(
    resolveStaplerMood({ recordingState: "idle", celebrating: false, hasNudge: false, open: false, hasDraft: false }),
    "idle",
  );
});

test("formatStaplerDockCopy produces live status copy for meeting, voice, paused, and saved drafts", () => {
  const recMeeting = formatStaplerDockCopy({
    recordingState: "recording",
    mode: "meeting",
    seconds: 75,
    fabDragOver: false,
    hasDraft: false,
    open: false,
  });
  assert.equal(recMeeting.kind, "recording");
  assert.equal(recMeeting.title, "1:15");
  assert.match(recMeeting.subtitle, /Meeting/i);

  const pausedVoice = formatStaplerDockCopy({
    recordingState: "paused",
    mode: "voice",
    seconds: 12,
    fabDragOver: false,
    hasDraft: false,
    open: false,
  });
  assert.equal(pausedVoice.kind, "paused");
  assert.equal(pausedVoice.title, "Jeda 0:12");
  assert.match(pausedVoice.subtitle, /Voice/i);

  const savedDraft = formatStaplerDockCopy({
    recordingState: "idle",
    mode: "voice",
    seconds: 0,
    fabDragOver: false,
    hasDraft: true,
    open: false,
  });
  assert.equal(savedDraft.kind, "draft");
  assert.equal(savedDraft.title, "Draft siap");
});

test("computeMicLevel and formatStaplerClock handle silence, speech, and clamping safely", () => {
  assert.equal(formatStaplerClock(0), "0:00");
  assert.equal(formatStaplerClock(65), "1:05");
  assert.equal(formatStaplerClock(-4), "0:00");

  const silence = new Uint8Array(64).fill(128);
  assert.equal(computeMicLevel(silence), 0);

  const speech = new Uint8Array(64).map((_, i) => (i % 2 === 0 ? 152 : 104));
  const mid = computeMicLevel(speech);
  assert.ok(mid > 0.4 && mid < 1, `expected speech level in (0.4, 1), got ${mid}`);

  const loud = new Uint8Array(64).map((_, i) => (i % 2 === 0 ? 255 : 0));
  assert.equal(computeMicLevel(loud), 1);
});
