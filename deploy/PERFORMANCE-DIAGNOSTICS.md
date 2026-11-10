# VR performance diagnostics

The browser has a **Performance** disclosure in the left panel and a **Download timing report** button. `studio.runtimePerformance.snapshot()` returns the latest ten-second window. The six most recent windows are stored in the session and every window is recorded as `runtime.performance` in exported events.

Each window separates input/hand CPU time, fit visibility synchronization, render submission CPU time, delivered frame intervals, long tasks, render calls/triangles and the latest local-save timing. `lastSave.mainSerializationMs` is main-thread CPU serialization; `lastSave.elapsedMs` includes background IndexedDB I/O. Render CPU timing is not GPU execution timing. Pauses above 250 ms are excluded from delivered FPS. When the headset suspends animation, the report says rendering is paused instead of implying good FPS.

## Measured regression on the bottle/cap session

On 30 October 2026 the attached Quest session contained 4,792,374 JSON characters. An eight-second sample recorded a 170–181 ms main-thread long task every second. Its complete session clone cost 53.1 ms and a normal save cost 166.6 ms. The session's construction timeline (2.07 MB), duplicated live activity (1.59 MB) and last native receipt (299 KB) caused most of the duplication. The headset was not delivering animation callbacks during that sample, so this measurement establishes storage stalls, not an active-VR FPS result.

A copy-only Quest benchmark compacted duplicate live summaries to 1,212,602 characters. JSON serialization fell from 40.9 to 8.2 ms in that comparison. Five worker-backed saves needed 9.7–21.7 ms main-thread serialization plus 0.9–1.1 ms message submission; complete background writes took 32–43 ms. Artifacts: `artifacts/quest-performance-before.json` and `artifacts/quest-session-save-benchmark.json`.

## Changes

* Exact receipts and old activity histories are archived as session assets. Live summaries retain kernel outcomes, parameters, IDs and bounded topology samples. The live activity details can download the original receipt; model inspector retains exact provider requests/outputs separately.
* Automatic saves persist events each second and the session snapshot at most every ten seconds. Explicit saves after editing still snapshot immediately. A worker owns IndexedDB serialization. A fallback remains if workers fail.
* Recovery takes the maximum persisted event sequence/time, so a session snapshot older than its event batch cannot overwrite recent event IDs on reload.
* Fixed geometry bounds are reused during fist checks, magnetic positioning and dimension layout. Fist containment still tests the actual mesh, with the surface-distance check restricted to relevant triangles.
* Hidden desktop dimension labels do not force DOM measurement while in VR. Fit visibility scans run at most ten times a second. Unchanged construction panels do not repeatedly repaint/upload their texture while idle.

For a new investigation, export a report while reproducing the slowdown. Correlate `runtime.performance` with request IDs, native execution receipts and user input events. Use an active worn headset for delivered FPS; idle/power-suspended reports alone cannot establish render throughput.
