# TalkBack Phase 1


Frontend-only Vite + React + TypeScript prototype for the reversed-audio party game. Round and game state stay in React state only for this phase. Supabase is prepared for Storage uploads only.

## Run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set:

   ```bash
   VITE_SUPABASE_URL=your-project-url
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

3. Create a Supabase Storage bucket named `audio` if you want uploads enabled. The app still runs without env vars, but upload actions will show a clear error.

4. Start the dev server on your LAN:

   ```bash
   npm run dev
   ```

5. Find your local IP on Windows:

   ```powershell
   ipconfig
   ```

   Look for your Wi-Fi or Ethernet IPv4 address, then open `http://YOUR_IP:5173` on another device on the same network.

## Notes

- `npm run dev` binds Vite to `0.0.0.0` and keeps port `5173` fixed for easier LAN testing.
- If you change `.env.local`, restart Vite.
- `getUserMedia()` only works in a secure context. `localhost` counts, but `http://YOUR_IP:5173` does not, so remote devices can load the app over plain HTTP but usually cannot record.
- On GitHub Pages, the app is served over HTTPS, so microphone APIs can work there as long as the browser grants mic permission.

## HTTPS For Cross-Device Recording

To test microphone recording from another device on the same LAN, serve Vite over HTTPS with a certificate trusted by that device.

1. Create a local certificate and key whose SAN includes the hostname or IP address you will open from the other device.
2. Add these lines to `.env.local`:

   ```bash
   DEV_HTTPS=true
   DEV_SSL_KEY_FILE=certs/dev-key.pem
   DEV_SSL_CERT_FILE=certs/dev-cert.pem
   ```

3. Run:

   ```bash
   npm run dev
   ```

4. Open `https://YOUR_HOSTNAME_OR_IP:5173` on the other device, and make sure that device trusts the certificate chain.

If the certificate is not trusted by the device, the page may still load with a warning, but microphone APIs can remain unavailable.

## Deploy To GitHub Pages

This repo now includes a GitHub Actions Pages workflow in `.github/workflows/deploy-pages.yml`.

1. Push the repo to GitHub.
2. In GitHub, open `Settings > Pages`.
3. Set `Build and deployment` to `GitHub Actions`.
4. Push to `main`, or run the `Deploy GitHub Pages` workflow manually.

### Base Path Behavior

- For a project site like `https://TorriePhD.github.io/TalkBack/`, the build automatically uses `/TalkBack/`.
- For a user site repo named like `username.github.io`, the build automatically uses `/`.
- To override that, set a repository variable named `BASE_PATH`, for example `/` or `/TalkBack/`.

### Optional GitHub Variables

If you want Supabase Storage uploads to work on the deployed site, add these repository variables in `Settings > Secrets and variables > Actions > Variables`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

These values are embedded into the client bundle at build time, so they should be treated as public client-side configuration.
