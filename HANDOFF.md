# Intake: handoff to Claude Code (migration and setup)

This is the brief for the Claude Code session that takes over the Intake app. It covers moving the project onto Caleb's Windows laptop, putting it under Git on GitHub, deploying it to GitHub Pages, connecting Firebase for sync, and checking the parts that could not be tested where it was built.

The app is finished and tested: 214 unit tests and 82 end-to-end steps pass, and an independent reviewer went through it three times. **Do not change app behavior during the migration** beyond what this file asks for. If you find a real bug, report it with a repro and ask before fixing it.

---

## 0. How to work in this session

- **Ask Caleb first** before anything public, permanent or billable:
  - creating the GitHub repository (it will be public)
  - creating the Firebase project and choosing its ID
  - choosing the Firestore location, which can never be changed
  - changing PowerShell execution policy
  - deleting anything
- **Steps only the Firebase console can do:** enabling sign-in methods and adding authorized domains have no CLI command. For these, give Caleb the exact clicks and wait until he says they're done.
- **Windows:** use whichever of `python` or `py` works. Use `firebase.cmd` if PowerShell blocks `firebase.ps1` ("running scripts is disabled").
- **Run the unit tests before every commit**, and run the e2e suite before the first push.
- Keep a short checklist of the sections below and tick them off as you go.

---

## 1. What Intake is

Intake is a personal calorie and nutrition tracker modeled on MyNetDiary, with its own name and design. It is a PWA: it installs to a phone home screen, runs on desktop, and works offline.

- **Stack:** plain HTML, CSS and ES modules. There is no build step and no npm dependencies. All URLs are relative and routing uses the URL hash (`#/today`, `#/diary`). The folder is the site.
- **Data:**
  - Local-first: everything lives in IndexedDB on the device.
  - Optional sync goes through Firebase (Auth plus Firestore) on the free Spark plan.
  - With `js/firebase-config.js` exporting `null`, the app makes no sync calls at all.
- **Food data:**
  - `data/foods.json` holds 7,793 USDA SR Legacy foods with household portions. It is public domain and searchable offline.
  - Online, Open Food Facts handles branded search and barcodes; it needs no key.
  - USDA FoodData Central branded search uses `DEMO_KEY`, or the user's own free key set in More.
- **Exercise:** `data/exercises.json` has 200 activities with MET values from the 2024 Adult Compendium.
- **Main screens:** Today, Diary, Add food, Food detail, Exercise, Progress, Foods (custom foods, recipes, saved meals), More (settings, account and sync, data export/import).
- **Docs in this folder:**
  - `SPEC.md`: the original build contract.
  - `README.md`: the user-facing setup and usage guide.
  - `data/DATA_NOTES.md`: data sources, how to rebuild the data files, and verification values.

File map:

```
index.html  manifest.webmanifest  sw.js  firestore.rules
css/        tokens.css, layout.css, components.css
js/         app modules; js/views/ = one file per screen
            pure (Node-testable): units, dates, nutrition, foods-search, foods-db,
            default-serving, normalize, sync-core, backup
            Firebase is isolated in firebase-backend.js (+ cloud.js); SDK 13.1.0 loaded from gstatic on demand
data/       foods.json, exercises.json, DATA_NOTES.md
icons/      svg + png icons
scripts/    update-precache.py (stamps sw.js), make-icons.py        - developer only
tools/      rebuild data files from public sources (stdlib Python)  - developer only
tests/      unit/*.test.js (node --test), e2e/*.py (Playwright)      - developer only
```

---

## 2. Prerequisites

Check each tool with `--version`. If one is missing, propose the install command (winget or npm) and ask before running it.

| Tool | Needed for | Check |
|---|---|---|
| Git | repo | `git --version` |
| GitHub CLI, signed in | repo, Pages | `gh --version`, `gh auth status` |
| Node 20 or newer | unit tests, Firebase CLI | `node --version` |
| Python 3 + Playwright + Chromium | e2e tests, live checks | `python -c "import playwright"`; install with `pip install playwright` then `python -m playwright install chromium` |
| Firebase CLI | Firebase setup | `firebase --version`; install with `npm install -g firebase-tools` (v15.34.1 was current on 2026-10-24) |

---

## 3. Local setup and first green run

1. **Folder:** the project should sit in its own folder, for example `C:\Users\<you>\Projects\intake`. It was delivered as `intake.zip`, which has one top-level `intake/` folder. Confirm `index.html` sits at the root of the folder you're in.
2. **Line endings:** add `.gitattributes` before the first commit:
   ```
   * text=auto eol=lf
   *.png binary
   ```
   This matters because `sw.js`'s version stamp is a hash of the file bytes. CRLF checkouts on Windows would make the hash differ between Caleb's laptop and the CI runner.
3. **.gitignore:** extend it with `tests/screenshots/`, `.cache/`, `.firebase/`, `firebase-debug.log` and `_site/`. It already has `__pycache__/`, `*.pyc` and `node_modules/`.
4. **CLAUDE.md:** save section 8 of this file as `CLAUDE.md` in the project root, so future sessions load the conventions automatically.
5. **Run the tests:**
   ```
   python scripts/update-precache.py --check
   node --test tests/unit/*.test.js
   python tests/e2e/run.py
   ```
   Expect the precache check to report up to date, 214/214 unit tests, and 82/82 e2e steps.
   - Use the glob form of `node --test`. The directory form fails on Node 22.
   - The e2e suite mocks Open Food Facts, USDA and Firebase. It serves a temporary copy of only the deployable files and writes screenshots to `tests/screenshots/`.
   - One e2e step (`reload persists`) once flaked under load and now waits for IndexedDB. If anything fails, re-run once before investigating.

---

## 4. GitHub repository and Pages deploy

**Repository.** Ask Caleb for the repo name (default `intake`). It must be public, because Pages on private repos needs a paid plan. Then:

```
git init
git add .
git commit -m "Intake: initial import"
git branch -M main
gh repo create <name> --public --source . --remote origin --push
```

Committing everything is fine, including `tests/`, `tools/` and `SPEC.md`. The deploy workflow below publishes only the app files.

**Deploy workflow.** Create `.github/workflows/pages.yml`, which deploys through GitHub Actions instead of serving the branch:

- **Triggers:** `push` to `main`, plus `workflow_dispatch`.
- **Permissions:** `contents: read`, `pages: write`, `id-token: write`.
- **Concurrency:** group `pages`, `cancel-in-progress: false`.
- **Build job:**
  1. `actions/checkout@v7`
  2. `actions/setup-node@v7` (Node 22)
  3. `actions/setup-python@v7` (3.12)
  4. Run `python scripts/update-precache.py`. This stamps `sw.js`, so a forgotten local run can't ship a stale cache.
  5. Run `node --test tests/unit/*.test.js`. The deploy fails if the tests fail.
  6. Assemble `_site/` with only: `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/`, `icons/`, `data/foods.json`, `data/exercises.json`. Add an empty `.nojekyll`.
  7. `actions/configure-pages@v6`, then `actions/upload-pages-artifact@v5` with `path: _site`.
- **Deploy job:** `needs: build`, `environment: github-pages` with `url: ${{ steps.deployment.outputs.page_url }}`, using `actions/deploy-pages@v5`.

Those action majors were the latest tags on 2026-10-24. Skim each action's README for changed inputs before using them.

**Turn Pages on** (source = GitHub Actions):

```
gh api -X POST repos/<owner>/<name>/pages -f build_type=workflow
```

If that returns 409 (Pages already exists), use `-X PUT` with the same field.

**Push and verify:**
- The run passes: `gh run watch`.
- `https://<owner>.github.io/<name>/` loads with no console errors.
- Every file in the deployed `sw.js` PRECACHE list returns 200, along with `data/foods.json`. Fetch them in a short script.

**Docs:** update README "Step 1" and "What to upload" to describe the Actions deploy, keeping the manual upload as an alternative. Commit the change.

---

## 5. Firebase (free Spark plan, no credit card)

The CLI does the steps in this table. If a command errors, check `firebase <command> --help`.

| Step | Command / notes |
|---|---|
| Login | `firebase login`. Caleb completes this in the browser. |
| Create project | Ask Caleb to pick a globally unique lowercase ID, for example `intake-cv-2026`. Then run `firebase projects:create <id> --display-name "Intake"`. If it fails (common on a first Firebase or Google Cloud account with unaccepted terms), have Caleb create it in the console: Add project, Google Analytics off. Then continue. |
| Web app | `firebase apps:create WEB "Intake web" --project <id>`, then `firebase apps:sdkconfig WEB <appId> --project <id>`. |
| Paste config | In `js/firebase-config.js`, replace `export const firebaseConfig = null;` with `export const firebaseConfig = { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId };`. These values are public identifiers, not secrets; `firestore.rules` protects the data. |
| Firestore database | Confirm the location with Caleb first, because it is permanent. The suggestion is `nam5` (US multi-region); `us-east1` is the nearest single region to Tennessee. Then run `firebase firestore:databases:create "(default)" --location <loc> --project <id>`. The Standard edition is the default; keep it. |
| Rules | Create `firebase.json` containing `{ "firestore": { "rules": "firestore.rules" } }` and `.firebaserc` containing `{ "projects": { "default": "<id>" } }`. Then run `firebase deploy --only firestore:rules`. No composite indexes are needed, because sync queries one field: `serverUpdatedAt`. |

Caleb does these in the console (https://console.firebase.google.com). Stop and give him these steps:

1. **Authentication, Get started, Sign-in method:** enable **Email/Password**. This is the app's primary sign-in. Optionally enable **Google**, which asks for a support email.
2. **Authentication, Settings, Authorized domains:** add `<owner>.github.io`, the host only, with no scheme or path. `localhost` is already listed.
3. **Optional hardening** in Google Cloud console, APIs & Services, Credentials: restrict the browser API key to these HTTP referrers:
   - `https://<owner>.github.io/*`
   - `http://localhost:8000/*`
   - `https://<id>.firebaseapp.com/*` (the auth domain, which Google sign-in uses)

Then run `python scripts/update-precache.py`, the unit tests, commit "Enable Firebase sync", push, and wait for the deploy.

---

## 6. Verify the live site against real services

These are the parts the build environment could only mock. Use Python Playwright or short scripts, and record the results in a short `VERIFY.md` (committed).

1. **Basic load:** the deployed site loads, onboarding works, and there are no console errors.
   - The service worker installs.
   - Reloading with the network off still opens the app and searches foods (set the Playwright context offline).
2. **Open Food Facts:**
   - Search "nutella" (press Enter; online search doesn't run while typing). Results should appear with the ODbL credit.
   - Look up barcode `3017620422003` by manual entry. Expect about 539 kcal per 100 g, and sodium should read as mg, not g. This checks the unit conversions in `js/normalize.js` against live data.
   - Keep it to a handful of requests: OFF allows about 10 searches a minute.
3. **USDA FDC:** make one branded search with `DEMO_KEY`. A rate-limit message is acceptable. Suggest Caleb get his own free key at https://fdc.nal.usda.gov/api-key-signup.
4. **Real sync** (ask Caleb first):
   - In browser context A, create a throwaway account (for example `intake-smoke-test@example.com` with a random password; Firebase doesn't verify the address) and log a food.
   - In a fresh context B, sign in with the same account. The entry should appear within about 10 s.
   - Edit the entry in B and confirm the change appears in A. Delete it and confirm it disappears in both.
   - Confirm the document exists in the console under `users/<uid>/foodLogs`.
5. **Rules check:**
   - Get an ID token for the test account from `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<apiKey>` with body `{email, password, returnSecureToken: true}`.
   - With that token, `GET https://firestore.googleapis.com/v1/projects/<id>/databases/(default)/documents/users/someone-else/foodLogs` must be refused (403).
   - The same request for the account's own uid must succeed.
6. **Cleanup:** in the app, use "Sign out and remove data from this device". Then have Caleb delete the test user (Authentication, Users) and its `users/<uid>` data in Firestore.
7. **Phone checklist for Caleb** (Claude Code can't do these; give him the list):
   - **iPhone:** in Safari, Share, then Add to Home Screen. Open the installed app, sign in with email and password, and log a food. It should appear on the laptop.
   - **Android:** in Chrome, open the menu and tap Install app, then do the same check.
   - **Barcode camera:** scan a real product.
   - **Layout:** no clipped content under the notch or home bar, and the tab bar clears the home indicator.
   - **Offline:** in airplane mode, open the app, log a food, then reconnect. It should sync.
   - **Updates:** after the next deploy, the installed app should show "Update available".

---

## 7. Known open items (accepted for now; don't fix unless Caleb asks)

- Searching "pizza" ranks a meat-topping thick-crust slice first, one point ahead of a cheese thin-crust slice.
- Quick Add accepts 0 kcal, and the water "Set" sheet allows up to 2,000 oz.
- Sync is last-write-wins per record using device clocks. If two devices edit the *same* entry while offline, the older edit is lost.
- Each sync push reads every document before writing it, in a transaction. This uses Spark quota (50K reads and 20K writes a day), but normal use stays far below it.
- FDC branded foods measured in ml are treated as 1 g/ml, and labelled as approximate.
- The Progress weigh-in list isn't paginated.
- Google sign-in is unreliable inside an installed iPhone app, so email and password are primary by design. Hosting on Firebase Hosting would fix that if it ever matters (see README).
- ZXing loads from `https://unpkg.com/@zxing/browser@0.1.5/...` only when the browser lacks BarcodeDetector.

---

## 8. Conventions (save this section as `CLAUDE.md`)

```markdown
# Intake: project conventions

Personal calorie/nutrition tracker PWA. Plain HTML/CSS/ES modules, no build step, no npm deps. Local-first (IndexedDB); optional Firebase sync. See SPEC.md (design contract) and README.md (setup/usage).

## Always
- Before every commit, after any change to js/, css/, icons/, index.html, manifest.webmanifest or data/exercises.json:
  `python scripts/update-precache.py` (stamps sw.js; installed apps then show "Update available"). CI also runs it.
- Tests: `node --test tests/unit/*.test.js` (glob form; the directory form fails on Node 22) and `python tests/e2e/run.py`
  (Playwright Chromium; mocks OFF/FDC/Firebase; phone 390x844 + desktop 1366x900 + offline + fake-SDK sync).
- All URLs relative (the site lives under /<repo>/ on GitHub Pages). Hash routes only.
- Never put untrusted text (food names, brands, user input) into innerHTML; use `h()`/textContent from js/ui.js.
- Dates are local `YYYY-MM-DD` via js/dates.js; never `toISOString().slice(0,10)`.
- Every numeric input goes through js/units.js (`parseAmount`, `LIMITS`, `rangeProblem`, `amountProblem`).
  "1,200" = 1200; "1,5" = 1.5; ambiguous input is refused with a message.
- Keep files under ~500 lines; JSDoc on exports; pure logic stays DOM-free so Node can test it (views are e2e-only).

## Where things live
- Search ranking: js/foods-search.js. Default serving: js/default-serving.js. Both have table tests over the real
  data (tests/unit/search.test.js, default-serving.test.js); add a row when changing behavior.
- Food keys: `usda:<fdcId>`, `off:<barcode>`, `fdc:<fdcId>`, `custom:<id>`, `recipe:<id>`, `quick`. Raw bananas = usda:173944.
- data/foods.json is generated by tools/build_foods.py from the SR Legacy CSV (mirror tomwhite/ingreedy-data @846f8c3).
  Don't hand-edit it; see data/DATA_NOTES.md.
- Unit conversions for online foods: js/normalize.js (OFF stores minerals/vitamins in grams per 100 g).
- Sync: store marks records `_dirty`; SyncEngine (js/sync.js, pure parts in sync-core.js) pushes in transactions with
  last-write-wins on `updatedAt` and pulls by a `serverUpdatedAt` cursor. Deletes are tombstones (`deleted: true`).
  Firebase SDK calls live only in js/firebase-backend.js and js/cloud.js. Firestore path: users/{uid}/{collection}/{id}.
- Calorie math (Mifflin-St Jeor, activity factors, pace, floors, macros, EMA weight trend): js/nutrition.js, SPEC.md section 6.

## Gotchas
- In the Diary, exercise rows share the `.entry` class with food rows; filter the "+N" rows when counting foods in e2e.
- .gitattributes forces LF; CRLF would change sw.js's hash between Windows and CI.
- Open Food Facts allows ~10 searches/min: online search runs on Enter / the "Search branded foods online" row, or once
  automatically when local search finds nothing. Don't make it search-as-you-type.
- Firebase web config in js/firebase-config.js is public by design; firestore.rules restricts each user to users/{uid}/**.
```

---

## 9. Done means

- [ ] Repo on GitHub with `.gitattributes`, extended `.gitignore`, `CLAUDE.md`, the workflow, `firebase.json` and `.firebaserc`.
- [ ] Actions deploy is green; the site is live at `https://<owner>.github.io/<name>/`.
- [ ] Firebase project created, Email/Password enabled, domain authorized, Firestore created, rules deployed, config committed.
- [ ] `VERIFY.md` records the live results for section 6, items 1–5. The test account is cleaned up.
- [ ] README updated for the Actions deploy.
- [ ] Final message to Caleb: the live URL, what was verified, the phone checklist (6.7), and any issues found, with repros.
