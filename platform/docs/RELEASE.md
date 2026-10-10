# Releasing the mobile app (iOS App Store and Google Play)

Status: nothing in this file has been executed. It is the path, not a record of done work.
Check current requirements on Apple's and Google's own developer sites before each step;
store rules and fees change.

## 1. Prerequisites you must provide

| Item | Notes |
|---|---|
| Apple Developer Program membership | Enrolled as an organisation (needs a D-U-N-S number, a business identifier) so the seller is Direct Homes, not an individual |
| Google Play Console account | Organisation account; identity verification is required |
| Expo (EAS) account | Builds the apps in the cloud, no Mac needed |
| Production API over HTTPS | iOS blocks plain `http://` by default. Host the server (see below), put TLS in front, set the API URL in the app |
| Privacy policy URL | Required by both stores. It must describe Emirates ID, title deed and document handling. A page exists at directhomes.ae/privacy-policy; have counsel confirm it covers the app |
| Support URL and contact email | Required in store listings |

## 2. Before building

1. Build and enable the live UAE PASS login adapter and put a login screen in the app, so users sign in as themselves and no shared secret is typed into the app. (Server-side sessions and the staff allow-list already exist; the app currently still takes a token field.)
2. Fill the app's data-collection declarations (Apple "App Privacy", Google "Data safety") truthfully: names, Emirates ID numbers, photos of documents, phone, email.
3. Move to a stable Expo SDK, run `npx expo install --fix`, then test on real iOS and Android devices.
4. Apple reviewers will ask how to log in. Prepare a demo account that works against a non-production server.
5. App review risk: an app that registers real tenancies may be asked for evidence of authority to do so. Keep the licensing and DLD/Ejari authorisation documents ready.

## 3. Build and submit

```bash
cd platform/mobile
npm install -g eas-cli
eas login
eas build:configure                 # links the project to your Expo account
eas build --platform ios --profile production
eas build --platform android --profile production
eas submit --platform ios
eas submit --platform android
```

Use `--profile preview` first to distribute internal builds (TestFlight, Play internal testing) to pilot users.
Bundle identifiers are `ae.directhomes.platform` in `app.json`; change them now if another id is wanted, they cannot be changed after the first store release.

## 4. Hosting the API for the pilot

`server/Dockerfile` builds the API. It stores data in SQLite on a mounted volume (`/data`), so run **one** instance only.
Choose a host whose region is in the UAE (or one your counsel approves), terminate TLS in front of it, and back up the volume.
The Docker image has not been built in this environment.

```bash
docker build -t directhomes-api server
docker run -p 3000:3000 -v dh-data:/data -e PILOT_API_TOKEN=... directhomes-api
```
