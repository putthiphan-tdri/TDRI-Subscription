# TDRI Big Data Subscription App

This folder contains the separate subscription management app.

Canonical working copy: `/Users/putthiphanhirunyatrakul/Documents/New project/subscription-app`

## Privacy model

This repository is safe to publish as the app architecture only. The source code starts with an empty local ledger and does not contain subscription credentials, passwords, payment records, or project data.

Private ledger data is stored in the browser's `localStorage` on the machine/browser where the app is used. Use **Export JSON** to download a private backup, and **Import JSON** to load that private data into another local or deployed copy of the app.

Do not commit exported ledger JSON files. `.gitignore` blocks common local ledger filenames and the `private-data/` folder.

Important: a static browser-only deployment keeps data out of GitHub, but it is not a secure multi-user credential vault. Anyone with access to the deployed app/browser profile and imported ledger can view stored credentials. For shared production use, put the app behind authentication and move credentials to a proper backend or secrets manager.

## Reliable Access

Double-click `START HERE - TDRI Subscription.command` in this folder.

That file starts a local server from this exact folder and opens the subscription app in your browser. Keep the Terminal window open while using the app. If port `5177` is busy, it automatically chooses the next available port.

## Folder roles

- `index.html`: app entry page.
- `src/`: app behavior and styling.
- `test/`: lightweight app checks.
- `tmp/`: local backups from earlier iterations.

## Deployment handoff

For vibecode or another web-app platform, import this repository/folder as a static frontend app. The visual design lives in `src/styles.css` and the app behavior lives in `src/main.js`; preserve those files exactly instead of regenerating the interface.

Recommended platform commands:

- Install: `npm install`
- Develop: `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`

After deployment, open the app and use **Import JSON** if you want to load a private ledger into that deployed instance.
