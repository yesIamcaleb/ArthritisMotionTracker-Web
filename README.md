# Arthritis Motion Tracker — browser prototype

**BMEN 220 research demonstration. Not a medical device or diagnostic tool.**

This is the corrected browser-based migration of the working Python arthritis wrist-motion tracker. It uses the MediaPipe **Holistic Landmarker Web** package to detect an elbow, wrist, and middle-finger knuckle from a webcam, then estimates a calibrated 2D flexion/extension angle. It requires **no Python installation for website visitors**.

## What's included

- Website with browser webcam permission, right/left wrist selection, live landmark overlay
- On-screen neutral and flexion-direction calibration
- Five-reading median smoothing, 30° sudden-jump rejection, and seven-reading stable-hold threshold (≤5° variation)
- Stop/save only when both flexion and extension are accepted
- Browser-local saved history and CSV export
- Responsive interface and clear warnings about limitations

## Quick start: publish without a Python install

1. Create a new GitHub repository, e.g. `ArthritisMotionTracker-Web`.
2. Upload **index.html**, **style.css**, **app.js**, **README.md**, and **.gitignore** at the repository root.
3. In the GitHub repository, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, set branch to `main` and folder to `/(root)`, and click **Save**.
4. Open the HTTPS link shown in the Pages settings (for example `https://YOUR_USERNAME.github.io/ArthritisMotionTracker-Web/`).
5. Click **Start camera**, allow camera access, and keep a stable internet connection for the initial MediaPipe/model download.
6. Use a side view, with elbow/wrist/hand all visible. **Calibrate neutral → Identify flexion → Start assessment → stable flexion and extension holds → Stop & save**.

No Streamlit, GitHub Actions custom workflow, backend server, or Python installation is needed on presenters' devices. GitHub Pages hosts static files over HTTPS; webcam permissions are requested by the browser.

### Local test before GitHub

For macOS with Python already installed, run `python3 -m http.server 8000` in this folder and visit `http://localhost:8000` — only the **developer** needs a local server. Camera access through localhost is typically permitted. Don't open `index.html` directly as a file. This is optional: you can publish directly to GitHub Pages and test via HTTPS.

## Privacy and limitations

- Frames are evaluated on-device by MediaPipe; this app does not contain any video upload or server-side patient database code. The browser downloads MediaPipe JS/WASM from jsDelivr and a model from Google storage. Review third-party hosting and network dependencies before a real-world deployment.
- Saved results use browser `localStorage`, which is unencrypted, scoped to the browser/site/device, may be erased, and **is not shared** with teammates. Only use fictional or consented demonstration information; do **not** store identifiable patient health data in this prototype.
- The measurements are estimates based on 2D camera geometry and can be affected by arm rotation, camera perspective, occlusion, inaccurate neutral calibration, and movement effort. Stable-hold consistency is **not** proof of accuracy. No claim of medical diagnosis, swelling measurement, or disease monitoring validation is made.
- Mobile/web camera and MediaPipe compatibility vary across browsers/devices; test real devices before a live presentation. Inference occurs synchronously on the main thread, which can reduce responsiveness on slower devices.
- The code uses a `@latest` MediaPipe CDN module for ease of initial prototyping. For a stable release, pin and test a known compatible SDK version and package hosting strategy.
- This demo uses the same body indices as your Python tracker (right elbow 14/wrist 16; left elbow 13/wrist 15; hand middle MCP 9). **The 2D signed-angle convention and hand side should be verified against the existing Python tracker**, especially with mirrored/selfie-facing cameras and rotation. No mirrored transform is applied to the camera display.

## Future milestones

- Validate cross-platform tracking against repeated-trial and reference-angle measurements.
- Add browser-based progress charts, symptom entry and accessible patient workflow.
- Add explicit camera orientation/instruction screens and performance diagnostics.
- Develop authenticated, encrypted storage and a privacy review before any real patient use.

MediaPipe web guidance: https://developers.google.com/edge/mediapipe/solutions/vision/holistic_landmarker
Webcam HTTPS guidance: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia


## Updated landmark detection (fix)

The initial web prototype incorrectly read `result.poseLandmarks` and hand results
as flat arrays. HolisticLandmarker **Web** returns arrays of landmark sets, so
this version correctly reads `poseLandmarks[0]`, `rightHandLandmarks[0]`, and
`leftHandLandmarks[0]`. The on-screen **Detected landmarks** indicator shows
`Pose: 33/33` and (for a detected selected hand) `Right hand: 21/21`.

If the camera opens but the tracking lines are missing, check this diagnostic:
- `Pose: 0/33`: step back so your upper body and elbow are visible.
- `Pose: 33/33 · Right hand: 0/21`: change hand selection, face the camera,
  move your wrist/hand fully into view, and improve lighting.
- `Pose: 33/33 · Right hand: 21/21`: selected landmarks are present. The
  elbow/wrist/knuckle tracking lines should be visible; if not, check the
  browser console for errors (Mac: Option+Command+J in Chrome).

When updating a locally hosted copy, overwrite **both** `app.js` and
`index.html`, then hard-refresh the page (Command+Shift+R in Chrome on Mac).
Your original Python project does not need editing.
