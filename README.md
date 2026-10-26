# Intake

Intake is a calorie and nutrition tracker that runs in the browser and installs on a phone like an app. You log food, exercise, water and weight, and it shows where you stand against a daily calorie budget.

- Works fully offline and without an account. Your diary lives in the browser's IndexedDB on the device.
- Optional free sync between your phone and computer through Firebase. Sign in with email and password (works everywhere); Google sign-in is offered as a second option.
- About 7,800 USDA foods ship with the app and search instantly offline. Online lookups (Open Food Facts, USDA branded foods) and barcode scanning are extras.
- No build step, no npm install, no framework. Plain HTML, CSS and ES modules, so the folder you see is the folder you publish.

Intake is a personal tracking tool. It is not medical advice (see the end of this file).

## Run it on your computer

You need Python 3 only to serve the files; the app itself has no dependencies.

On Windows, open PowerShell in the project folder and run:

```
python -m http.server
```

If `python` is not found, try `py -m http.server`. Then open http://localhost:8000 in Chrome, Edge, Firefox or Safari.

Opening `index.html` by double-click does not work, because browsers block ES modules and service workers on `file://` pages. Always use a local server.

First run shows a short setup (units, about you, goal). You can skip it and set everything later under More.

## Host it for free (GitHub Pages plus Firebase)

The plan is two free services:

| Part | Service | What it does |
|---|---|---|
| The app itself | GitHub Pages | Serves the static files over HTTPS. HTTPS is required for installing to a home screen and for the camera. |
| Sync (optional) | Firebase Spark plan | Sign-in and a small database so your phone and computer share one diary. No credit card needed. |

The Spark plan limits are far above what one person logging meals will use: 1 GiB stored, 50,000 document reads per day, 20,000 writes per day and 20,000 deletes per day. A typical day of logging is a few dozen writes. If you hit a limit, Firebase pauses requests until the next day; it does not start charging. Your diary stays safe on the device either way.

You can do step 1 and skip step 2 entirely: the app then works on every device separately, with no account.

### Step 1. Publish the app on GitHub Pages

The repository deploys itself. `.github/workflows/pages.yml` runs on every push to `main`: it stamps `sw.js`, runs the unit tests, assembles only the app files into `_site/`, and publishes them with GitHub Actions. If the tests fail, nothing is deployed.

1. Use a public repository (Pages on private repositories needs a paid plan) with this folder at its root, so that `index.html` sits at the top level.
2. In the repository go to Settings, then Pages, and under Build and deployment set Source to **GitHub Actions**. (Or run `gh api -X POST repos/OWNER/REPO/pages -f build_type=workflow`.)
3. Push to `main`, or run the workflow from the Actions tab. After a minute or two the site is live at `https://YOUR-USER.github.io/REPO/`. Every link in the app is relative, so the sub-path works without changes.

**Alternative: manual upload.** Without Actions, choose Deploy from a branch (`main`, `/ (root)`) instead, and upload only the files listed below. Run `python scripts/update-precache.py` first so installed apps see the update.

### What to upload

The workflow publishes exactly these files, and the manual route needs only these too:

```
index.html   manifest.webmanifest   sw.js
css/   js/   icons/   data/foods.json   data/exercises.json
```

Everything else (`tests/`, `tools/`, `scripts/`, `SPEC.md`, `firestore.rules`, `data/DATA_NOTES.md`, `package.json`) is for working on the app; nothing in the app loads it, and the end-to-end test serves exactly this reduced folder to prove it. Never upload a `__pycache__` folder (`.gitignore` keeps them out of Git).

### Step 2. Turn on sync with Firebase (optional)

Do these in the [Firebase console](https://console.firebase.google.com/) with a Google account.

1. Create the project. Click Add project, name it (for example `intake`), and turn Google Analytics off. You do not need it.
2. Add a Web app. On the project home screen click the web icon (`</>`), give the app a nickname, leave Firebase Hosting unticked, and click Register app. Firebase shows a `firebaseConfig` block.
3. Paste the config into the app. Open `js/firebase-config.js` and replace `export const firebaseConfig = null;` with your values:
   ```js
   export const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.firebasestorage.app",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef123456",
   };
   ```
   These values identify your project; they are not secrets. What protects your data is the rules file in step 7.
4. Enable sign-in methods. Go to Build, then Authentication, then Get started, then the Sign-in method tab. Enable Email/Password: this is the sign-in the app leads with, and it works in every browser and in the installed iPhone app. Enable Google as well if you want the second button (it asks for a project support email; pick yours).
5. Authorize your site's domain. In Authentication open Settings, then Authorized domains, click Add domain and enter `YOUR-USER.github.io` (the host only, no `https://` and no path). `localhost` is already on the list, so local testing works. Without this step Google sign-in fails with an "unauthorized domain" error (the app shows that message in plain words).
6. Create the database. Go to Build, then Firestore Database, then Create database. Choose Production mode (and the Standard edition if the console asks which edition). For the location pick the region closest to you in the US (for example `nam5 (us-central)` or a single region such as `us-east1`). The location cannot be changed later.
7. Publish the security rules. In Firestore open the Rules tab, replace everything with the contents of `firestore.rules` from this folder, and click Publish. The rules let a signed-in user read and write only their own `users/<their id>/...` data and deny everything else.
8. Update the app (see "Updating the app" below), push the change, and wait for Pages to redeploy. Then open More, then Account and sync, create an account with your email and a password, and the status should change to Synced.

On your second device, open the same site and sign in with the same account. Your diary appears within a few seconds. Edits on either device sync automatically while online, and changes made offline are sent when the connection returns.

Signing in, and why you may be asked again:

- Sign-in is remembered per device and per app. Safari, Chrome and an installed home-screen app each keep their own storage, so each one needs one sign-in. After that it stays signed in.
- The installed iPhone app has storage of its own, separate from Safari. Sign in once inside the installed app, with email and password. Google sign-in uses a pop-up or redirect that iOS often blocks in installed apps, so the app says so under the Google button when it detects that situation. One email-and-password account works on all your devices.
- If a Google redirect does fail, the Account screen shows the reason instead of staying silent.
- If Google sign-in everywhere matters more to you than keeping the free GitHub Pages setup, host the same files on Firebase Hosting (`firebase init hosting`, then `firebase deploy`). The site is then served from your project's own `*.firebaseapp.com` domain, the same domain the sign-in uses, which is what makes the Google redirect reliable in installed apps. Add that domain to Authorized domains, and use it as the address you install from.

How sync behaves:

- Each record carries a timestamp and the newest edit wins. Deletes sync too.
- Signing out keeps your data on the device. "Sign out and remove data from this device" wipes the local copy and leaves the account data in the cloud.
- If a different account signs in on a device that already holds data, Intake asks whether to merge that data into the new account or erase it first.
- Sync loads the Firebase SDK from Google's CDN only when a config is present. With `firebaseConfig = null` nothing is downloaded and no network calls are made for sync.

Optional hardening: in Google Cloud console, under APIs and Services, then Credentials, you can restrict the browser API key to HTTP referrers `https://YOUR-USER.github.io/*` and `http://localhost:8000/*`.

### Step 3. Install it on your phone

- iPhone or iPad (Safari): open the site, tap Share, then Add to Home Screen, then Add. It must be Safari; other iOS browsers cannot install it.
- Android (Chrome): open the site, tap the menu, then Install app (or Add to Home screen).
- Desktop Chrome or Edge: click the install icon at the right end of the address bar.

Installed, it opens full screen with its own icon and works with no signal. On iOS, data in an installed app is kept separately from data in Safari tabs, so set up and sign in from the installed app and use it from there.

### Optional: a free USDA API key

Search of the built-in USDA list needs nothing and updates as you type. For packaged foods, the online search queries Open Food Facts, which needs no key. The free public servers limit requests, so Intake does not search while you type: press Enter (or the search key on your phone keyboard), or tap the "Search branded foods online" row that appears under the local results once you have typed 3 letters. It also searches online by itself, once per query, when the built-in list has no match and you pause for a second. Results are remembered for the session, and if the server says it is busy the app tells you to try again in a minute. USDA branded foods come from USDA FoodData Central, whose shared demo key allows only a small number of requests: without your own key the app offers an "Also search USDA branded foods" button that uses the demo key, and it can run into that limit. With your own free key from https://fdc.nal.usda.gov/api-key-signup, USDA results appear automatically next to Open Food Facts and barcode lookups use it too. Paste the key into More, then Units and display, then USDA FoodData Central API key. It is saved with your settings (and synced to your account if you use sync).

## Backups

More, then Your data, then Export backup (JSON) downloads one file with your diary, weights, custom foods, recipes and settings. Keep a copy somewhere safe now and then, especially if you do not use sync. Import backup merges a file into the current data: the newer copy of each record wins, nothing is deleted. On a fresh device, onboarding also has "Restore from a backup file".

You can also export the food log, weights and daily totals as CSV for spreadsheets.

Browsers can clear site data when storage is low or if you clear it yourself. Intake asks the browser to keep its storage, but a backup or sync is the real safety net.

## Updating the app

Installed copies keep running from an offline cache, so after you change any file you must tell them there is something new. The service worker's cache name is a hash of the app files, and a script maintains it:

```
python scripts/update-precache.py
```

Run it after every change to files in `js/`, `css/`, `icons/`, `index.html`, `manifest.webmanifest` or `data/exercises.json`, then commit and push. It rewrites the offline file list and the version stamp in `sw.js`. Phones that already installed the app then show an "Update available" bar with a Reload button the next time they open it (Pages can take a few minutes to publish, so reopen after that).

`python scripts/update-precache.py --check` only reports whether `sw.js` is current (it exits with 1 if not) and `-h` shows the usage; neither writes anything.

If you forget and the file list is stale, the app still works, but installed copies may not notice the update. You can also bump `CACHE_VERSION` at the top of `sw.js` by hand; any new value does the job. Pasting your Firebase config in step 2 counts as a change, so run the script after it.

Changing only `data/foods.json` does not need the script: it is refreshed in the background on each visit.

## Tests

```
node --test tests/unit/*.test.js     (or: npm test)
python tests/e2e/run.py              (or: npm run e2e)
```

Unit tests need Node 20 or newer and cover nutrition math, units and fraction parsing, dates, search ranking against the real food list, import and export, sync logic with two simulated devices, and service worker file coverage. The end-to-end run needs Python with Playwright and Chromium installed (`pip install playwright`, then `playwright install chromium`). It serves a temporary copy of the deployable files (see "What to upload"), drives a phone-sized and a desktop-sized browser, mocks the Open Food Facts, USDA and Firebase endpoints, checks the offline reload, and saves screenshots to `tests/screenshots/`. Sync is tested against a fake in-page Firebase SDK, so setting up the real project (step 2) is the final check that sign-in and sync work for you.

## What is in the folder

```
index.html, manifest.webmanifest, sw.js   the app shell and offline support
js/                                        app code; js/views/ holds one file per screen
css/                                       tokens (colors, type), layout, components
data/                                      foods.json and exercises.json, see data/DATA_NOTES.md
icons/                                     app icons (regenerate with scripts/make-icons.py)
firestore.rules                            paste into the Firebase console (step 2.7)
.gitignore                                 keeps __pycache__ and similar out of Git
scripts/update-precache.py                 run after changing files (developer file, do not upload)
tools/                                     rebuilds the data files from their public sources (do not upload)
tests/                                     unit tests (Node) and end-to-end tests (Python Playwright) (do not upload)
SPEC.md                                    the build specification (do not upload)
```

## How the default serving is chosen

Each food lists the portions USDA publishes (for example "1 medium", "1 cup", "1 tbsp"). `js/default-serving.js` picks the one that is shown first by scoring how plausible each portion is as a single helping for that kind of food: drinks default to a cup, nut butters to 2 tbsp, oils and butter to 1 tbsp, cooked meat and fish to 3 oz, fruit and eggs to one piece, cooked grains and vegetables to a cup, nuts and cheese to an ounce. Portions labelled "yield from" or "refuse" are never the default, and very large or very heavy portions are penalised. A serving you logged before for the same food always wins. Labels are tidied for display: USDA's "1 NLEA serving" is shown as "1 serving (label)", and "1 serving 9 servings per 24 oz package" as "1 serving (1/9 of 24 oz package)". Foods that are eaten by the slice (pizza, bread) are ranked above ones that only list a share of a package.

Numbers you type accept `1.5`, `1,5` (decimal comma), `1/2`, `1 1/2` and thousands separators: `1,200` is 1200 and `1,234,567` is 1234567. A comma that could mean either (`1,2345`) is refused with a message instead of guessed. In search, baby foods are listed only when you search for one ("baby", "babyfood", "infant"), and a short finished word such as "oat" does not match "oatmeal" when it is followed by another word. `tests/unit/default-serving.test.js` checks about forty everyday foods against the real data.

## Data sources and attribution

- Foods: USDA FoodData Central, SR Legacy (the USDA National Nutrient Database for Standard Reference, April 2018). A work of the US government, public domain (CC0). Citation: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. https://fdc.nal.usda.gov. Details of how `data/foods.json` was built are in `data/DATA_NOTES.md`.
- Online food and barcode lookups: [Open Food Facts](https://world.openfoodfacts.org), available under the Open Database License (ODbL), with contents under the Database Contents License. Search results show their data credit under the list. Branded food search and barcode fallback also use USDA FoodData Central.
- Exercise energy values: the 2024 Adult Compendium of Physical Activities (Herrmann SD, Willis EA, Ainsworth BE, et al. J Sport Health Sci). Activity names are shortened for display; the MET values are the Compendium's.
- Barcode scanning uses the browser's built-in detector where available, and otherwise loads ZXing (Apache-2.0) from a CDN the first time you open the scanner.
- Calorie budget: a Mifflin-St Jeor estimate of resting energy, an activity multiplier, and the weekly pace you choose, with a floor so the target never drops to an unsafe level. You can override the calorie target in More.

## Not medical advice

Intake gives estimates. Food databases contain errors, labels are rounded, and calorie formulas are averages that can be off by hundreds of calories for one person. Nothing in this app is medical, dietary or nutritional advice, and it does not diagnose or treat anything. Talk to a doctor or registered dietitian before changing your diet or exercise, especially if you are pregnant, are under 18, have a medical condition or a history of disordered eating, or take medication that affects appetite or weight.
