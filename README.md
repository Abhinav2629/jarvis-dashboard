# Jarvis Swing Desk

The web app for [Jarvis](https://github.com/Abhinav2629/jarvis), an Indian swing trading engine.

This repository holds **only the app's code; no data**. Your signals, positions and market data live in
your *private* `jarvis` repository. The app reads them through the GitHub API with a fine-grained token
that you enter once per device, and that token never leaves your browser.

- **Refresh** starts the Jarvis workflow in the private repo. The app follows the run live, then
  loads the freshly saved data.
- It works on a phone or laptop and can be installed: *Add to Home Screen* on iOS or *Install app* on Android/desktop.
- It has no third-party scripts and a strict Content-Security-Policy.

Token permissions: *Only select repositories* → `jarvis`, with **Actions: Read and write** and **Contents: Read-only**.
