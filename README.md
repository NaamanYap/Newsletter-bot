# Bloomberg Newsletter Telegram Bot

A Google Apps Script that reads, in this case, Bloomberg newsletters from your Gmail inbox, adds headlines from a handful of public news feeds, summarises everything with the Gemini API, and sends you a link on Telegram twice a day to a reading page called the **Wire Room**.

Bloomberg's newsletters are long, and opening them individually from your inbox is unnecessarily tedious and inefficient. Thus, this condenses all the vital information into an automated digest that is sent to you as many times as you want (you can tweak the scheduler). I chose to run the code on Google Apps Script as it acts as a free cloud to host my code.

This entire project requires $0 and leverages Google's free API keys, Bloomberg's free newsletters and free RSS feeds.

---

## How it works

1. **Fetch** — searches Gmail for Bloomberg newsletters received in the last `LOOKBACK_HOURS`, skips duplicate threads and older editions, and extracts the text plus any charts and photos. It also reads the RSS feeds in `CONFIG.RSS_FEEDS` (BBC, NYT, MarketWatch, FT, Al Jazeera).
2. **Summarise** — sends the text and images to Gemini, which returns JSON with `sections` (each holding articles, with an image where one matches) and quick hits. Each newsletter and each outlet gets its own section. If Gemini is busy, it retries on the lighter `GEMINI_FALLBACK_MODEL`.
3. **Save** — writes the digest as a JSON file to the `Wire Room Digest Archive` folder in your Google Drive, with its images in an `Images` subfolder.
4. **Deliver** — sends a short Telegram message (section and story count) with an **Open Wire Room** button that opens the digest as a reading page inside Telegram.
5. **Alert** — if anything fails, emails the error to `NOTIFY_EMAIL` and stops.

Two time-based triggers run it daily at 08:30 and 19:30 in the script's timezone (set in `appsscript.json`; mine is `Asia/Singapore`). You can edit `setupDailyTriggers()` to choose what time you want to receive the messages.

### The Wire Room

The Wire Room is the script's web app. It shows the digest as a page with sections, stories, images and a quick-hits list (tap a quick hit to jump to its story). From there you can:

- open the **Archive** of past digests, and
- tap **Refresh** to build a fresh digest on the spot. A tap within `MIN_REFRESH_MINUTES` of the last digest returns that one instead of calling Gemini again.

Refresh only works from links the bot sent, which carry a secret key; anyone else who gets hold of a link can only read it.

---

## Set up

### Prerequisites

- A Google account subscribed to at least one Bloomberg newsletter
- A [Gemini API key](https://aistudio.google.com/apikey)
- A Telegram bot token and your chat ID

### 1. Create the Apps Script project

Go to [script.google.com](https://script.google.com), create a new project, and paste in the contents of `Code.gs` and `appsscript.json` (turn on **Show "appsscript.json" manifest file** in Project Settings to see the manifest). Or push them with [clasp](#updating-with-clasp).

### 2. Create a Telegram bot

Message [@BotFather](https://t.me/BotFather), send `/newbot`, and follow the prompts to get a bot token. Send your bot a message, then get your chat ID from a bot such as [@userinfobot](https://t.me/userinfobot).

### 3. Add credentials

In the Apps Script editor, go to **Project Settings → Script Properties** and add:

| Property | Value |
| --- | --- |
| `GEMINI_API_KEY` | Your Gemini API key |
| `TELEGRAM_BOT_TOKEN` | Token from BotFather |
| `TELEGRAM_CHAT_ID` | Your chat ID |
| `WEBAPP_URL` | The Wire Room's `/exec` URL (from step 4) |

The script adds its own properties as it runs (`REFRESH_KEY`, `WEBHOOK_SECRET`, `ARCHIVE_FOLDER_ID`, `IMAGE_FOLDER_ID`, `LATEST_FILE_ID`); leave those alone.

### 4. Deploy the Wire Room

**Deploy → New deployment → Web app**, Execute as **Me**, Who has access **Anyone**, then **Deploy**. Copy the Web app URL (it ends in `/exec`) into the `WEBAPP_URL` script property.

The deployment is a fixed version: after changing the code, use **Deploy → Manage deployments → Edit → New version** so the Wire Room picks up the change. Scheduled digests always run the latest code.

### 5. Configure

Edit the `CONFIG` block at the top of `Code.gs`. The main settings:

| Key | Default | What it does |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model that writes the digest |
| `GEMINI_FALLBACK_MODEL` | `gemini-2.5-flash-lite` | Model used for retries when the main one is busy |
| `TRIGGER_HOUR` | `8` | Hour of the morning run |
| `LOOKBACK_HOURS` | `12` | How far back each digest reads Gmail |
| `MAX_EMAILS` | `30` | Newest threads per Gmail search |
| `MAX_BODY_CHARS` | `12500` | Text kept from each newsletter |
| `NOTIFY_EMAIL` | — | Where failure alerts go |
| `MIN_REFRESH_MINUTES` | `15` | Refresh taps within this window reuse the last digest |
| `MAX_IMAGES` | `40` | Newsletter images shown to Gemini |
| `RSS_FEEDS` | 6 feeds | Other outlets to read; add or remove any |
| `MAX_FEED_ITEMS` | `8` | Newest items kept per feed |
| `CHAT_HISTORY_DAYS` | `7` | How far back the bot looks when answering questions |
| `CHAT_MEMORY_TURNS` | `6` | Earlier questions and answers kept for follow-ups |

The rest of the image and chat limits are commented in the code.

### 6. Schedule it

Run `setupDailyTriggers()` once from the editor. Authorise the Gmail, Drive, external-request and script scopes when prompted. Run `removeDailyTriggers()` to unschedule.

To test immediately, run `generateBloombergBrief()` and watch the execution log.

### 7. Ask the bot questions (optional)

Message the bot in Telegram (e.g. *"what's the latest on oil?"*) and it answers from your saved digests: the last day's in full, plus the past week's headlines. It remembers the last few messages for follow-ups.

| Command | What it does |
| --- | --- |
| `/new` | Starts a fresh conversation |
| `/link` | Sends a link to the latest Wire Room that you can add to your phone's home screen |

With the Wire Room deployed, run `setupTelegramWebhook()` once from the editor. It refuses if the bot already delivers its messages to another project; `replaceTelegramWebhook()` overrides that. `checkTelegramWebhook()` logs the delivery status, and `removeTelegramWebhook()` turns answering off. Only messages from `TELEGRAM_CHAT_ID` are answered.

---

## Updating with clasp

[clasp](https://github.com/google/clasp) pushes the repo straight to Apps Script instead of pasting code into the editor.

```bash
npm install -g @google/clasp
```

Run `clasp login`, then create a `.clasp.json` (gitignored) holding your script ID:

```json
{ "scriptId": "<your script id>", "rootDir": "" }
```

`clasp push` uploads `Code.gs` and `appsscript.json` (`.claspignore` keeps everything else out). If you also edit settings in the online editor, `clasp pull` into a spare folder first and compare, so a push doesn't overwrite them. Redeploy the Wire Room afterwards (`clasp deploy -i <deploymentId>`, or a new version from **Manage deployments**).

---

## Limitations

- Gmail search relies on Bloomberg's current sender domains and subject lines; these change occasionally.
- RSS feeds only give headlines and short summaries, and outlets sometimes move or drop their feeds.
- Summary quality is bounded by what Gemini extracts. Treat it as a reading aid, not a source of record.
- Apps Script has daily quotas on `UrlFetchApp` calls, email reads and Drive use. Two runs a day plus the odd refresh and question stay well within them.
- The Open Wire Room button opens the page as a Telegram Mini App, which only works in a private chat with the bot.

---

## Project structure

```
├── Code.gs           # All script logic, including the Wire Room page templates
├── appsscript.json   # Apps Script manifest (timezone, web app settings)
├── .claspignore      # Limits clasp push to Code.gs and appsscript.json
├── README.md
├── LICENSE
└── .gitignore
```

---

## A note on content

This script processes the newsletters delivered to your own inbox, plus the free public RSS feeds you list, and sends the summary to a private chat. It does not go looking for any other information.

---

## Licence

MIT — see [LICENSE](LICENSE).
