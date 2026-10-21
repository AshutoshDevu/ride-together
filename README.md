# 🏍️ RideTogether — live group map for bike rides

One shared Google Map for the whole riding group. Create a ride, drop the invite link in your WhatsApp group, and every rider who joins shows up as a small coloured marker that moves in real time — so nobody gets lost on long rides.

**One codebase → Android + iOS** (Expo / React Native + TypeScript, Firebase backend).

## Features

| | |
|---|---|
| **Create a ride** | Gets a 6-character code (e.g. `K7QM2X`) and an invite link |
| **WhatsApp invite** | One tap opens WhatsApp with the link pre-filled; anyone who taps it lands on the "Join ride" screen |
| **Live map** | Tiny marker per rider (colour + initials + name tag), leader marked with ★, you are the blue dot |
| **Background sharing** | Keeps sharing with the phone locked in a mount/pocket (Android foreground-service notification, iOS "Always" location) |
| **Rider list** | Sorted by distance from you, with speed, battery % and "last seen" |
| **Lost-signal detection** | Rider turns grey and shows "Signal lost" after 2 min without an update |
| **Group spread** | Top bar shows the distance between the first and last rider |
| **✋ Stop / 🆘 SOS** | Rider's marker turns yellow/red and a banner appears for everyone; tap it to jump to them |
| **Fit all / Me / Screen-on** | Buttons to zoom to the whole group, centre on yourself, and keep the screen awake |
| Big-group friendly | Name tags auto-hide when zoomed far out; markers are optimised to not re-render constantly |

## How it works

```
Rider phone ──(GPS every ~5 s / 20 m)──► Firebase Realtime Database ──(live push)──► every rider's map
                                         groups/{CODE}/meta
                                         groups/{CODE}/members/{uid}
                                         groups/{CODE}/locations/{uid}
```

* **Identity:** Firebase *anonymous* auth — no sign-up, riders just type a name.
* **Why Realtime Database (not Firestore):** RTDB bills by bandwidth, not per write. A 30-rider group sending updates every 5 s makes ~130k writes over a 6-hour ride, which would blow Firestore's free tier in one ride.
* **Security rules** (`database.rules.json`): only members can read a ride; each rider can only write their own location; anyone with the code can join (that's the invite model).
* **Invite links:** `https://<your-project>.web.app/join/CODE` is a small page on Firebase Hosting (`hosting/public/join.html`). WhatsApp only makes `https://` links tappable, so the page shows the code and bounces into the app (`ridetogether://join/CODE`), or the Play Store / App Store if it isn't installed. Once App Links / Universal Links are verified (step 6) the link opens the app directly.

## Project layout

```
src/app/_layout.tsx          root stack + registers background location task
src/app/index.tsx            home: your name, create ride, join by code, resume ride
src/app/join/[code].tsx      deep-link target for invite links
src/app/group/[code].tsx     the live map screen
src/components/RiderMarker.tsx   small rider marker
src/components/RiderList.tsx     rider list in the bottom sheet
src/lib/firebase.ts          Firebase init + anonymous sign-in
src/lib/groups.ts            create/join/leave, live subscription, WhatsApp share
src/lib/tracking.ts          background/foreground GPS → database
database.rules.json          Realtime Database security rules
hosting/public/              invite landing page + App Link / Universal Link files
app.config.ts                app name, bundle id, permissions, map keys
```

---

## Local development

Runs against the real Firebase project (`ridetogether-ashu`) — the same data as the live app.
On web, `react-native-maps` (native only) is swapped for `src/web/react-native-maps.tsx` by
`metro.config.js` — the same API on top of the Google Maps JavaScript API, using
`EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` (a browser key restricted to the site + localhost:5050/8081).

```bash
npm install
cp .env.production .env   # real project config (public values only)
npm run web               # dev server at http://localhost:8081 (the root, not /app)
npm run simulate          # 6 fake riders on a Bangalore → Nandi Hills route; prints invite + dev links
                          #   join your own ride instead: npm run simulate -- K7QM2X
                          #   once the leader sets a destination they ride that real route
                          #   Ctrl+C removes them again (and ends a ride the script created)
```

Offline alternative: the Firebase emulators. Put `EXPO_PUBLIC_USE_EMULATOR=1`,
`EXPO_PUBLIC_FIREBASE_API_KEY=demo-key`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-ridetogether` and
`EXPO_PUBLIC_FIREBASE_DATABASE_URL=http://127.0.0.1:9000?ns=demo-ridetogether-default-rtdb` in `.env`,
then run `npm run emulators` (auth, database and hosting on :5050) alongside the commands above.

Web version for laptops: `npm run deploy:web` exports the app to `hosting/public/app` under the `/app`
base URL (`EXPO_WEB_BASE_URL`, only set for this build) using `.env.production`,
and deploys it to <https://ridetogether-ashu.web.app/app/>. Invite links opened on a laptop go straight there;
on phones the invite page also offers *Continue in browser*.

Production builds don't read `.env` — their Firebase / Maps values live in EAS environment variables
(`npx eas-cli env:list --environment preview`).

## Spending cap

A ₹500/month budget on the Google Cloud project publishes to the `budget-alerts` Pub/Sub topic;
`infra/billing-kill-switch/` is a Cloud Function that unlinks billing once spend reaches the budget
(Maps stops, Firebase falls back to free limits). Re-link billing in the Cloud console to restore.

---

## Setup (about 30 min, one time)

### 1. Tools
* Node.js 20+
* **Android:** Android Studio (for the SDK/emulator) and a phone with USB debugging, *or* just use EAS cloud builds (step 7).
* **iOS:** a Mac with Xcode, *or* EAS cloud builds + an Apple Developer account ($99/yr) to install on iPhones.

```bash
npm install
cp .env.example .env
```

### 2. Firebase project
1. <https://console.firebase.google.com> → **Add project**.
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
3. **Build → Realtime Database → Create database** → pick **Singapore (asia-southeast1)** (closest to India) → start in *locked mode*.
4. **Project settings → Your apps → Web (`</>`)** → register → copy `apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId` into `.env`.
5. Set `EXPO_PUBLIC_INVITE_BASE_URL=https://<project-id>.web.app` in `.env`.

### 3. Deploy rules + invite page
```bash
npm i -g firebase-tools
firebase login
firebase use --add            # pick your project
firebase deploy --only database,hosting
```
Open `https://<project-id>.web.app/join/TEST12` in a browser to check the page.

### 4. Google Maps keys
1. <https://console.cloud.google.com> → select the same project (Firebase projects are Google Cloud projects).
2. **APIs & Services → Library** → enable **Maps SDK for Android** and **Maps SDK for iOS**. (A billing account must be attached; mobile map loads are free under current Google pricing, but check their pricing page.)
3. **Credentials → Create API key** twice. Restrict one to Android apps (package `com.ridetogether.app` + your SHA-1) and one to iOS apps (bundle id).
4. Put them in `.env` as `GOOGLE_MAPS_ANDROID_KEY` / `GOOGLE_MAPS_IOS_KEY`.

> Change `APP_BUNDLE_ID` in `.env` to something unique (e.g. `com.adevu.ridetogether`) **before** your first store build, and update the same id in `hosting/public/join.html` and `hosting/public/.well-known/*`.

### 5. Run on your phone
This app uses background location and native Google Maps, so it needs a **development build** (Expo Go won't work):

```bash
npx expo run:android      # phone connected via USB, or emulator
npx expo run:ios          # Mac + Xcode
```
After the first native build, `npx expo start` gives you instant reloads while editing JS.

**Testing tip:** Android emulator → ⋯ → Location → load a GPX route to simulate a moving rider. Use a second phone/emulator to see two markers.

### 6. Make invite links open the app directly (optional but nice)
* **Android:** run `npx eas-cli credentials` (or `keytool -list -v` on your keystore), copy the **SHA-256** fingerprint into `hosting/public/.well-known/assetlinks.json`.
* **iOS:** put your Apple Team ID in `hosting/public/.well-known/apple-app-site-association`.
* `firebase deploy --only hosting` again. Until this is done, the link still works via the landing page's "Open in the app" button.

### 7. Share test builds with your riding group
```bash
npm i -g eas-cli && eas login
eas env:create   # add the same values as .env (or use `eas secret`) so cloud builds see them
eas build --profile preview --platform android   # → APK download link, drop it in WhatsApp
eas build --profile production --platform ios    # → TestFlight
```

---

## Things to know

* **Battery:** GPS every 5 s for 6+ hours drains phones. Riders should keep phones on the bike's USB charger. Tune `timeInterval` / `distanceInterval` in `src/lib/tracking.ts` and `MIN_PUBLISH_INTERVAL_MS` if needed.
* **Android OEM battery savers** (Xiaomi, Oppo, Vivo, Realme, OnePlus) may kill background apps. Riders should set RideTogether → Battery → **No restrictions**.
* **Database usage:** every update is pushed to every rider, so traffic grows with group size squared. Rough guide: 30 riders × 6 h ≈ 0.8 GB download. The free Spark plan includes 10 GB/month; heavier use needs the pay-as-you-go Blaze plan (≈ $1/GB).
* **Privacy:** location is only visible to riders in the same ride and stops when you tap *Leave ride* (via **+ Invite → Leave ride**) or pause sharing.

## Ideas for next versions
* Push notification to everyone on SOS (Firebase Cloud Messaging + a Cloud Function).
* Destination / regroup point pin that the leader drops on the map.
* "Sweep" rider role + alert when someone falls more than X km behind.
* Auto-delete rides after 24 h (scheduled Cloud Function).
* Ride history with distance / route replay.
