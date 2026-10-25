# Surgery Follow-ups

An installable phone app for following up patients who are being prepared for surgery.

- **The app** (`docs/`) is a Progressive Web App hosted free on GitHub Pages at
  **https://rekovick.github.io/Patient-follow-ups/**. You install it from the browser and it gets its own icon,
  opens full-screen, and starts instantly, even with a weak signal.
- **The data** stays in **your own Google Drive**: patient records in a Google Sheet, photos in a Drive folder.
  A small Google Apps Script (`apps-script/Code.gs`) is the only thing that reads and writes it.
  It rejects every request that doesn't carry a valid **access key**.

There is no server to rent and no database to manage, and the GitHub site never sees patient data.

## Features

**Adding a patient**: a step-by-step wizard with large buttons for phone use.
1. Hospital: El Sahel, El Mabara or 15th of May
2. Consultant: Dr Ahmed Elghity, Dr Alaa Ahmed or General
3. Name and phone number. Age and procedure/diagnosis are optional.
   - Arabic digits (٠١٠…) are accepted, and `+20 10…` is converted to `010…`.
   - You get a warning if the number doesn't look like an Egyptian mobile, or if **the patient already exists**.
4. Decision photo, taken with the **camera** or **uploaded** from the gallery.
5. Pre-op photos (optional, several at once).
6. Anesthesia preparation: a checklist (CBC, coagulation, ECG, echo, consent…), ASA class, fitness and notes.
7. Classification: Vascular or Spine to start with, and you can add new ones on the spot.
8. Optional hint (shown on the patient card) and planned surgery date.
9. Status: Waiting for paperwork, Waiting for labs, Ready for surgery or Done, and you can add more.

**Home page**
- All cases with coloured status badges and **counts for each status**. Tap a status to filter.
- **Search** by name (Arabic-aware: أ/ا, ة/ه and ى/ي match each other), phone number, hint, notes or procedure.
- Filters for hospital, consultant and classification. Sorting by recently updated, newest, waiting longest, surgery date or name.
- A **"Next 7 days"** filter for upcoming surgeries. Surgeries due today or overdue are highlighted.
- Tap the **phone number to call**, or tap the green button to **open a WhatsApp chat**.
  The app adds **+2** before the number automatically (010… becomes +20 10…).
- Each card shows the anesthesia progress (for example 5/12) and how many days the patient has been waiting.

**Patient page**
- One-tap status change. Every change is recorded in a **timeline** showing who changed it and when.
- Decision, pre-op and **post-op photos**. Post-op opens once the status is **Done**.
  Tap a photo to view it full screen and swipe between photos.
- Anesthesia checklist with a progress bar, ticked directly on the page.
- **Notes**, tagged automatically as Pre-op or Post-op.
- **WhatsApp message templates** in Arabic (bring labs, paperwork, surgery date, fasting, post-op check).
  The patient's name, hospital and date are filled in for you.
- **Share summary**: sends a colleague a WhatsApp summary of the case, including pending items.
- Archive (hides the patient without deleting) or Delete (photos go to the Drive trash and can be recovered).

**Settings**: edit, reorder or remove hospitals, consultants, classifications, statuses, anesthesia
checklist items and WhatsApp templates.

**Other**
- Installs like a normal app (own icon, full screen) and opens instantly from the copy saved on the device.
- **People with access**: each colleague gets their own key, their name appears on the changes they make,
  and you can remove anyone at any time.
- Connect a new phone by scanning a QR code from a device that's already connected.
- Dark mode.
- Photos are resized on the phone before upload, so they upload quickly over mobile data.
- Changes made on another device appear automatically when you return to the app, or when you tap ⟳.

## Where the data lives

The first time the app runs, it creates this structure in your Google Drive:

```
Surgery Follow-ups/
  Surgery Follow-ups — Data         ← Google Sheet
      Patients tab                  ← one row per patient
      Lists tab                     ← hospitals, consultants, statuses… (also editable in the app)
  Photos/
    <Patient name> (<id>)/          ← that patient's photos
    _thumbnails/                    ← small previews used by the app
```

You can open the Sheet at any time to review, filter or export the data (File → Download → Excel).

## Setup

The easiest way is the step-by-step launch page (built by `node dev/build-setup-guide.js`). It contains everything below with copy buttons.

### 1. Data server (Google Apps Script, once)
1. At **https://script.google.com**, signed in to the Google account that should own the data, create a project
   named *Surgery Follow-ups*.
2. Replace everything in its `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs). That is the only file needed.
3. Save, choose the `setup` function and click **Run**. Allow the permissions
   (**Advanced → Go to Surgery Follow-ups (unsafe)** → **Allow**; "unsafe" only means Google hasn't reviewed your own script).
   This creates the folder and Sheet, and the log prints your **access key**. Keep it private.
4. **Deploy → New deployment → Web app**, with *Execute as*: **Me** and *Who has access*: **Anyone**.
   Copy the link that ends in `/exec`. "Anyone" only means the app can reach the server; without a key it refuses everything.

### 2. The app (GitHub Pages, once)
In the repository: **Settings → Pages → Deploy from a branch →** choose the branch that holds this code, folder **`/docs`** → **Save**.
After a minute, https://rekovick.github.io/Patient-follow-ups/ opens the app.

### 3. Connect and install
1. Open the app on a computer, paste the `/exec` server link and your access key, and click **Connect**.
2. In **Settings → Connect my other device**, scan the QR code with your phone. The phone connects by itself.
3. Install it. Android Chrome: **Install** button, or **⋮ → Install app**. iPhone Safari: **Share → Add to Home Screen**.

### Updating later
- App screens (`docs/`): pushing to the Pages branch is enough. Phones update the next time the app opens.
- Data server (`apps-script/Code.gs`): paste the new file, then **Deploy → Manage deployments → ✏️ Edit → New version → Deploy**.

## Giving a colleague access

In the app: **Settings → People with access → Add a person**. Type their name and send them the link or QR code.
They open it once and install the app. Their name is recorded on every change they make (timeline, `updatedBy` column).
**Remove** them there to disconnect all their devices immediately.

If a key may have leaked, run `resetAccessKeys` in the Apps Script editor. It disconnects everyone and prints a new owner key.

## Security notes
- Only the access key unlocks the data. Keys are 64 random characters, stored in the script's private properties, never in the Sheet.
  Wrong keys are refused and slowed down.
- Editor-only functions (`setup`, `resetAccessKeys`) can't be called through the web.
- Each phone keeps its key and the last downloaded patient list (not photos) so it opens instantly.
  **Disconnect** (Settings) removes both from that device.
- Lock your phone with a PIN or fingerprint, as you would for any app holding patient information.

## Troubleshooting

- **"Could not reach the server"**: the deployment's *Who has access* isn't **Anyone**, or the new version wasn't deployed.
- **"This access key isn't valid"**: the key was mistyped, reset or removed. Run `setup` to see the owner key again.
- **The app's address shows 404**: GitHub Pages is still publishing (wait a minute), or Pages isn't set to the `/docs` folder.
- **Camera button opens the gallery instead**: some browsers ignore the camera hint. Use **Upload** and pick "Camera" there.
- **I want to add a list item directly in the sheet**: edit the *Lists* tab and keep the header row as it is.
  The app picks up the change the next time it loads.

## Development

```
apps-script/Code.gs   data server (paste into Apps Script)
docs/                 the installable app served by GitHub Pages (index.html, app.js, styles.css, sw.js, manifest, icons)
dev/                  local preview, tests and generators
```

The `dev/` folder runs the real `docs/` app and the real `Code.gs` together in one browser page, with Google Sheets/Drive
replaced by a fake, so you can try changes without deploying:

```bash
node dev/build-preview.js             # dev/preview.html with sample patients, already connected
node dev/build-preview.js --empty     # start with no patients
node dev/build-preview.js --artifact  # dev/demo.html, shaped for the hosted demo page
node dev/build-setup-guide.js         # dev/setup-guide.html: the launch page with copy buttons
node dev/make-icons.js                # regenerate docs/icons/*.png
node dev/smoke-test.js                # end-to-end test in headless Chromium (needs Playwright)
```

`docs/vendor/qrcode.js` is [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 (MIT).
