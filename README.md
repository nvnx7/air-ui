<div align="center">
  <img src="./build/icon.png" alt="AirUI Logo" width="120" />
  <h1>AirUI</h1>
  <p style="text-align: center;"><b>Your Local AI For Touchless UI Control</b></p>
</div>

---

## What is it

AirUI lets you control your computer without touching a mouse, keyboard, or trackpad. Move your head (or finger, or eyes) to steer the cursor, then trigger actions — clicks, media controls, volume, screenshots — with a hand gesture or a spoken phrase that **you** teach it. Every model runs **entirely on-device**: no cloud calls, no account, and no network dependency once the models have been downloaded once.

- **Pointer tracking** — Head, Finger, or Eyes mode (switchable in Settings), with independent horizontal/vertical sensitivity and an optional mouse-style acceleration mode (a fast head flick travels further; slow, deliberate movement stays precise).
- **Teachable gestures** — strike a pose in front of the camera, the AI describes what it sees in plain language, name it and map it to an action. Recognized live against the webcam feed while enabled.
- **Teachable voice commands** — say a phrase, the AI transcribes it, confirm/edit the text and map it to an action. Recognized live via continuous, hands-free listening (no push-to-talk).

## What's used

### QVAC SDK — local AI (the core of this app)

Every recognition/understanding capability in AirUI runs through [`@qvac/sdk`](https://docs.qvac.tether.io/), Tether's local-first AI SDK — models load and run entirely on-device.

| QVAC module | Model | Used for |
|---|---|---|
| **Multimodal completion** (`llamacpp-completion`) | Qwen3-VL 2B (`QWEN3VL_2B_MULTIMODAL_Q4_K`) | Teachable gestures — describing a hand pose or facial expression in plain language when teaching, and matching live webcam frames against your taught gesture library at runtime (output constrained to a JSON schema of your exact taught names, so it can only ever answer with one of them or "none"). |
| **Speech-to-text** (`whispercpp-transcription`) | Whisper Base, English (`WHISPER_EN_BASE_Q8_0`) | Teachable voice commands — both the one-shot transcription used when teaching a new phrase, and the live streaming recognition loop that transcribes what you say in real time. |
| **Voice activity detection** | Silero VAD (`VAD_SILERO_5_1_2`) | Paired with the Whisper streaming session to detect when you start and stop speaking and mark the end of an utterance, so a spoken command is matched and fired the moment you finish saying it — no button to hold. |
| **Profiler** | — | Logs model latency/timing samples to the console during development. |

`src/main/model.ts` loads these models; the actual recognition/matching logic lives in `src/main/gesture.ts` and `src/main/voice.ts`, each backed by its own taught-item library (`src/main/library.ts` for gestures, `src/main/voiceLibrary.ts` for voice commands) persisted locally as JSON.

### MediaPipe — pointer tracking (the one external piece)

Everything above is QVAC. The single non-QVAC dependency is [`@mediapipe/tasks-vision`](https://ai.google.dev/edge/mediapipe), used solely for real-time head (and finger/eye) landmark tracking to drive the on-screen cursor — a lightweight, purpose-built vision task, separate from the AI recognition layer above it, vendored locally under `src/renderer/public/mediapipe/`.

### Everything else

- **[robotjs](https://github.com/octalmage/robotjs)** — executes the actual OS-level action (mouse move/click, key tap) once a gesture or voice command fires.
- **Electron + React + TypeScript + Tailwind CSS** — the app shell and UI.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [Biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)

## Project Setup

### Requirements

- macOS, Windows, or Linux with a webcam and a microphone. Linux needs X11 (robotjs, used for cursor/key control, doesn't support Wayland).
- Camera and microphone permissions granted to the app (pointer tracking needs the camera; voice commands need the mic — both prompted on first use).
- **macOS only:** grant Accessibility permission (System Settings → Privacy & Security → Accessibility) to the app, or to your terminal/IDE in dev mode. Without it, robotjs silently fails to move the cursor or send key taps.
- A C/C++ build toolchain and Python 3, needed if `robotjs` has no prebuilt binary for your platform/arch and falls back to compiling from source (Xcode Command Line Tools on macOS, `build-essential` on Linux, Visual Studio Build Tools on Windows).
- An internet connection the first time each feature is used, to download its model (auto-downloaded and cached after that — fully offline afterward).

### Install

```bash
$ bun install
```

### Development

```bash
$ bun run dev
```

### Build

```bash
# For windows
$ bun run build:win

# For macOS
$ bun run build:mac

# For Linux
$ bun run build:linux
```
