# Surgery Follow-ups

A mobile-friendly app for following up patients who are being prepared for surgery.
It runs as a **Google Apps Script web app**: all data is saved in **your own Google Drive**.
Patient records go into a Google Sheet and photos go into a Drive folder. You can open the app
from any phone or computer where you're signed in, and you can share it with colleagues later.

There is no server to rent and no database to manage. Google's own security protects the data,
and only accounts you give access to can open it.

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
- Dark mode, and it works well as an app on your phone's home screen.
- Photos are resized on the phone before upload, so they upload quickly over mobile data.
- Changes made on another device appear automatically when you return to the app, or when you tap ⟳.

## Where the data lives

The first time the app runs, it creates this structure in your Google Drive:

```
Surgery Follow-ups/                 ← share this folder to give a colleague access
  Surgery Follow-ups — Data         ← Google Sheet
      Patients tab                  ← one row per patient
      Lists tab                     ← hospitals, consultants, statuses… (also editable in the app)
  Photos/
    <Patient name> (<id>)/          ← that patient's photos
    _thumbnails/                    ← small previews used by the app
```

You can open the Sheet at any time to review, filter or export the data (File → Download → Excel).

## Setup (about 10 minutes, once)

1. Go to **https://script.google.com** while signed in to the Google account that should own the data.
   Click **New project** and rename it to *Surgery Follow-ups*.
2. Create the files and paste in the content from the [`apps-script/`](apps-script) folder of this repo:
   | In the Apps Script editor | Paste the content of |
   |---|---|
   | `Code.gs` (already there, replace everything) | `apps-script/Code.gs` |
   | **+ → HTML** named `Index` | `apps-script/Index.html` |
   | **+ → HTML** named `Styles` | `apps-script/Styles.html` |
   | **+ → HTML** named `Client` | `apps-script/Client.html` |
   | `appsscript.json`, see the note below | `apps-script/appsscript.json` |

   To see `appsscript.json`, open **Project Settings ⚙** and tick
   **"Show 'appsscript.json' manifest file in editor"**.
3. Click **Save 💾**. Choose the `setup` function in the toolbar and click **Run**.
   Google will ask for permission. Click **Review permissions**, choose your account, then
   **Advanced → Go to Surgery Follow-ups (unsafe)** → **Allow**.
   (It says "unsafe" only because the app is your own and hasn't been reviewed by Google.)
   This creates the folder and the Sheet. The execution log shows their links.
4. Click **Deploy → New deployment** → ⚙ **Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Only myself**

   Click **Deploy** and copy the **Web app URL**.
5. Open that URL on your phone (in Chrome or Safari, signed in to the same Google account) and add it to the home screen:
   - Android (Chrome): ⋮ → **Add to Home screen**
   - iPhone (Safari): Share → **Add to Home Screen**

### Updating the app later
Paste the new code, then go to **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
The URL stays the same.

## Sharing with a colleague

1. In Google Drive, share the **Surgery Follow-ups** folder with the colleague as **Editor**.
2. In Apps Script, go to **Deploy → Manage deployments → ✏️ Edit** and change:
   - *Execute as*: **User accessing the web app**
   - *Who has access*: **Anyone with Google account**

   Click **Deploy** and send them the same URL.
3. The first time the colleague opens it, they approve the permissions (the same "Advanced → Go to…" steps as above).

The data stays protected by Drive sharing. Someone who has the link but doesn't have access
to the folder can't see any patients. To remove a person's access, stop sharing the folder with them.
Every change records who made it (in the timeline and in the `updatedBy` column).

## Troubleshooting

- **"Sorry, unable to open the file at this time"**: this is a known Google issue when a browser is signed in to
  **several Google accounts**. Open the link in a browser or profile that is signed in only to the owner account,
  or make the owner account the first/default one.
- **Camera button opens the gallery instead**: some browsers ignore the camera hint. Use **Upload** and pick "Camera" there.
- **I want to add a list item directly in the sheet**: edit the *Lists* tab and keep the header row as it is.
  The app picks up the change the next time it loads.

## Development

The `dev/` folder runs the real `Code.gs` and UI in a normal browser against a fake Google Sheets/Drive,
so you can try changes without deploying:

```bash
node dev/build-preview.js          # writes dev/preview.html (with sample patients); open it in a browser
node dev/build-preview.js --empty  # start with no patients
node dev/smoke-test.js             # end-to-end test in headless Chromium (needs Playwright)
```

If you prefer the command line, you can push the code with [clasp](https://github.com/google/clasp):
`clasp create --type webapp --rootDir apps-script`, then `clasp push`.
