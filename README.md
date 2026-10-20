# Home 3D (app)

Phone-first 3D house you can turn and tap. Each area is coloured by what's due.

- **This public repo** holds only the app shell (HTML/CSS/JS, three.js bundle, icons, service worker). No house data.
- **Data** lives in a private repo (`tasks.json`). The phone pastes a fine-grained PAT with **Contents: Read** on that repo only. The token stays in `localStorage`.
- Statuses are worked out on the device from today's date, so colours stay current offline.
