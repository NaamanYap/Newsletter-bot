const CONFIG = {
  GEMINI_MODEL:    'gemini-2.5-flash',
  TRIGGER_HOUR:    8,
  LOOKBACK_DAYS:   1,
  MAX_EMAILS:      8,
  MAX_BODY_CHARS:  12500,
  NOTIFY_EMAIL:    'naamanyap@gmail.com',
  ARCHIVE_FOLDER_NAME: 'Wire Room Digest Archive',
};



function generateBloombergBrief() {
  try {
    Logger.log('▶ Bloomberg Brief generation started…');

    const now       = new Date();
    const dateLabel = formatDate(now, 'MMMM d, yyyy');
    const hour      = now.getHours(); // Get current hour

    // 1. Fetch Bloomberg emails
    Logger.log('📬 Searching Gmail for Bloomberg emails…');
    const emailContent = fetchBloombergEmails();
    const hasEmails    = emailContent.trim().length > 100;
    Logger.log(hasEmails ? '✓ Found Bloomberg emails (' + emailContent.length + ' chars)' : '⚠ No emails found — generating empty state');

    // 2. Summarize with Gemini → structured digest JSON
    Logger.log('🤖 Calling Gemini API…');
    const digest = summarizeWithGemini(emailContent, hasEmails, dateLabel);
    Logger.log('✓ Digest generated with ' + (digest.sections || []).length + ' sections');

    // 3. Save the digest so it can be read as a webpage
    Logger.log('💾 Saving digest to Drive…');
    const file = saveDigestRecord(digest, dateLabel, hour);

    const webAppUrl = getWebAppUrl();
    if (!webAppUrl) {
      throw new Error(
        'Web app is not deployed yet. In the Apps Script editor: Deploy → New deployment → ' +
        'select type "Web app" → Execute as "Me" → Who has access "Anyone" → Deploy. ' +
        'Then run generateBloombergBrief again.'
      );
    }
    const link = webAppUrl + '?id=' + file.getId();

    // 4. Notify on Telegram with a teaser + link to the full reading page
    Logger.log('📤 Sending digest link to Telegram…');
    sendDigestNotification(digest, dateLabel, hour, link);
    Logger.log('✅ Done! Digest saved and link sent to Telegram.');

  } catch (err) {
    Logger.log('❌ Error: ' + err.message);
    sendFailureAlert(err);
    throw err;
  }
}

function fetchBloombergEmails() {
  const tz      = Session.getScriptTimeZone();
  const cutoff  = new Date();
  cutoff.setDate(cutoff.getDate() - CONFIG.LOOKBACK_DAYS);
  const afterStr = Utilities.formatDate(cutoff, tz, 'yyyy/MM/dd');

  const queries = [
    'from:bloomberg.com after:' + afterStr,
    'from:bloomberg.net after:' + afterStr,
    'from:newsletter.bloomberg.com after:' + afterStr,
    'subject:"Bloomberg" after:' + afterStr,
  ];

  const seenIds = {};
  let combined  = '';

  queries.forEach(function(q) {
    const threads = GmailApp.search(q, 0, CONFIG.MAX_EMAILS);
    threads.forEach(function(thread) {
      if (seenIds[thread.getId()]) return;
      seenIds[thread.getId()] = true;

      thread.getMessages().forEach(function(msg) {
        const subject = msg.getSubject();
        const body    = msg.getPlainBody().substring(0, CONFIG.MAX_BODY_CHARS);
        combined += '\n\n=== EMAIL ===\nSubject: ' + subject + '\n\n' + body + '\n';
      });
    });
  });

  return combined;
}




function summarizeWithGemini(emailContent, hasEmails, dateLabel) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in Script Properties.');

  var systemPrompt =
    'You are a Bloomberg newsletter document-generation assistant. ' +
    'The user will provide full Bloomberg newsletter contents for today. ' +
    'Parse every story, market data point, policy impact, and key fact from each email and ' +
    'produce an ultra-comprehensive, detailed digest. Extract deep analytical context.\n' +
    'Return ONLY a valid JSON object matching the requested schema. No explanation, no markdown text wrap.\n\n' +
    'The JSON structure must match this EXACT format:\n' +
    '{\n' +
    '  "sections": [\n' +
    '    {\n' +
    '      "emoji": "🌅",\n' +
    '      "title": "MORNING BRIEFING — ASIA",\n' +
    '      "byline": "Sara Marley",\n' +
    '      "date": "Monday, May 12, 2026",\n' +
    '      "articles": [\n' +
    '        { "headline": "Headline Title Case With Core Metric", "body": "A granular, highly detailed 7-10 sentence briefing including precise numbers, targets, names, macro economic context, and regulatory consequences." }\n' +
    '      ]\n' +
    '    }\n' +
    '  ],\n' +
    '  "quickHits": [\n' +
    '    "China PPI rose 2.8% YoY — fastest since July 2022 — signalling deflation exit"\n' +
    '  ]\n' +
    '}\n\n' +
    'SECTIONS — include all that have content, in this preferred order:\n' +
    '  🌅  MORNING BRIEFING — ASIA        (byline: journalist name if available)\n' +
    '  🌅  MORNING BRIEFING — AMERICAS    (byline: journalist name if available)\n' +
    '  🌙  EVENING BRIEFING — ASIA        (byline: journalist name if available)\n' +
    '  🌙  EVENING BRIEFING — AMERICAS    (byline: journalist name if available)\n' +
    '  📈  MARKETS\n' +
    '  💻  TECHNOLOGY\n' +
    '  💰  MONEY STUFF\n' +
    '  ⚖️  BALANCE OF POWER\n' +
    '  📡  SURVEILLANCE\n' +
    '  🌿  ECONOMICS & GREEN\n' +
    '  🏛️  POLITICS & POLICY\n\n' +
    'RULES:\n' +
    '- articles per section: aim for 3-5 articles; never fewer than 2 if the section has content.\n' +
    '- article body: Provide an uncompromised deep dive of 5-8 analytical sentences. Include specific metrics, policy impacts, asset prices, and dates. Do not condense or skim over structural details.\n' +
    '- headlines: punchy Bloomberg-style title case; include key movements, ticker signs, or figures.\n' +
    '- quickHits: 8-13 sharp, highly specific data bullets. Every single bullet must explicitly contain numbers, percentages, or concrete event transformations.\n' +
    '- Do NOT fabricate or hallucinate numbers or events not present in the source emails.\n' +
    '- Preserve all significant stories — this is a comprehensive structural reference document.';

  var userMsg = hasEmails
    ? 'Today is ' + dateLabel + '. Summarize these Bloomberg emails into the ultra-detailed digest JSON:\n\n' + emailContent
    : 'No Bloomberg emails found for ' + dateLabel + '. Return an empty digest JSON structure with empty sections and quickHits arrays.';

  var payload = {
    contents: [{
      parts: [
        { text: systemPrompt + "\n\nUser Input Data:\n" + userMsg }
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1
    }
  };

  var apiEndpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + CONFIG.GEMINI_MODEL + ':generateContent?key=' + apiKey;

  var maxRetries = 5;
  var baseDelay = 2000;
  var response, status;

  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    response = UrlFetchApp.fetch(apiEndpoint, {
      method:      'POST',
      contentType: 'application/json',
      payload:     JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    status = response.getResponseCode();

    if (status === 200) {
      break;
    }

    if ((status === 503 || status === 429) && attempt < maxRetries) {
      var delayTime = baseDelay * Math.pow(2, attempt);
      Logger.log('⚠️ Gemini server busy (HTTP ' + status + '). Retrying in ' + (delayTime / 1000) + 's... (Attempt ' + (attempt + 1) + '/' + maxRetries + ')');
      Utilities.sleep(delayTime);
    } else {
      throw new Error('Gemini API returned HTTP ' + status + ': ' + response.getContentText().substring(0, 300));
    }
  }

  var data = JSON.parse(response.getContentText());
  var rawText = "";

  if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
    rawText = data.candidates[0].content.parts[0].text;
  }

  if (!rawText) throw new Error('Gemini response was empty or structural parsing failed.');

  return JSON.parse(rawText.trim());
}

// ── DIGEST STORAGE (Drive) ──────────────────────────────────────

function getOrCreateArchiveFolder() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('ARCHIVE_FOLDER_ID');
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // Folder was deleted or ID is stale — fall through and recreate.
    }
  }
  var existing = DriveApp.getFoldersByName(CONFIG.ARCHIVE_FOLDER_NAME);
  var folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(CONFIG.ARCHIVE_FOLDER_NAME);
  props.setProperty('ARCHIVE_FOLDER_ID', folder.getId());
  return folder;
}

function saveDigestRecord(digest, dateLabel, hour) {
  const folder  = getOrCreateArchiveFolder();
  const edition = hour < 14 ? 'Morning' : 'Evening';
  const tz      = Session.getScriptTimeZone();
  const stamp   = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd_HHmm');
  const fileName = 'digest_' + stamp + '_' + edition + '.json';

  const record = {
    digest:      digest,
    dateLabel:   dateLabel,
    edition:     edition,
    generatedAt: new Date().toISOString(),
  };

  const file = folder.createFile(fileName, JSON.stringify(record), MimeType.PLAIN_TEXT);
  PropertiesService.getScriptProperties().setProperty('LATEST_FILE_ID', file.getId());
  return file;
}

function loadDigestRecord(fileId) {
  const id = fileId || PropertiesService.getScriptProperties().getProperty('LATEST_FILE_ID');
  if (!id) throw new Error('No digest has been generated yet. Run generateBloombergBrief first.');
  const file = DriveApp.getFileById(id);
  const record = JSON.parse(file.getBlob().getDataAsString());
  record.fileId = id;
  return record;
}

function getWebAppUrl() {
  const deployedUrl = ScriptApp.getService().getUrl();
  if (deployedUrl) return deployedUrl;
  return PropertiesService.getScriptProperties().getProperty('WEBAPP_URL') || '';
}

// ── WEB APP (reading page) ──────────────────────────────────────

function doGet(e) {
  const params = (e && e.parameter) || {};
  try {
    if (params.view === 'archive') {
      return HtmlService.createHtmlOutput(renderArchiveHtml())
        .setTitle('Wire Room — Archive')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }
    const record = loadDigestRecord(params.id);
    return HtmlService.createHtmlOutput(renderDigestHtml(record))
      .setTitle('Wire Room — ' + record.dateLabel)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<pre style="font-family:monospace;white-space:pre-wrap;padding:24px;">' + escapeHtml(err.message) + '</pre>'
    );
  }
}

function renderDigestHtml(record) {
  const digest      = record.digest || {};
  const sections    = digest.sections || [];
  const quickHits   = digest.quickHits || [];
  const archiveUrl  = getWebAppUrl() + '?view=archive';
  const dataJson    = JSON.stringify({ sections: sections, quickHits: quickHits }).split('</').join('<\\/');

  return WIRE_ROOM_TEMPLATE
    .split('%%DATE_LABEL%%').join(escapeHtml(record.dateLabel || ''))
    .split('%%EDITION%%').join(escapeHtml(record.edition || ''))
    .split('%%ARCHIVE_URL%%').join(archiveUrl)
    .split('%%STORAGE_KEY%%').join(record.fileId || 'latest')
    .split('%%DIGEST_JSON%%').join(dataJson);
}

function renderArchiveHtml() {
  const folder = getOrCreateArchiveFolder();
  const files  = folder.getFiles();
  const items  = [];

  while (files.hasNext()) {
    const f = files.next();
    items.push({ id: f.getId(), name: f.getName(), date: f.getDateCreated() });
  }
  items.sort(function(a, b) { return b.date - a.date; });

  const baseUrl = getWebAppUrl();
  const tz      = Session.getScriptTimeZone();
  const rows = items.map(function(it) {
    const edition = (it.name.match(/_(Morning|Evening)\.json$/) || [])[1] || 'Digest';
    const day     = Utilities.formatDate(it.date, tz, 'EEEE, MMMM d, yyyy');
    const time    = Utilities.formatDate(it.date, tz, 'HH:mm');
    return '<a class="row" href="' + baseUrl + '?id=' + it.id + '">' +
      '<span class="day">' + escapeHtml(day) + '</span>' +
      '<span class="meta">' + edition + ' edition · ' + time + '</span></a>';
  }).join('');

  return ARCHIVE_TEMPLATE
    .split('%%ROWS%%').join(rows || '<p class="empty">No digests saved yet.</p>')
    .split('%%TODAY_URL%%').join(baseUrl);
}

// ── TELEGRAM NOTIFICATION ────────────────────────────────────────

function sendDigestNotification(digest, dateLabel, hour, url) {
  const botToken = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  const chatId   = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
  if (!botToken || !chatId) throw new Error('Missing Telegram credentials.');

  const edition = hour < 14 ? 'Morning' : 'Evening';
  const hits     = digest.quickHits || [];
  const hitLines = hits.length
    ? hits.map(function(h) { return '• ' + escapeHtml(h) + '\n\n'; })
    : ['No quick hits in this edition.'];

  const articleCount = (digest.sections || []).reduce(function(n, s) {
    return n + ((s.articles && s.articles.length) || 0);
  }, 0);
  const sectionCount = (digest.sections || []).filter(function(s) {
    return s.articles && s.articles.length;
  }).length;

  const header =
    '🍊 <b>BLOOMBERG DIGEST</b>\n' +
    '📅 <i>' + escapeHtml(dateLabel) + '</i> — ' + edition + ' Edition\n' +
    '📚 ' + sectionCount + ' sections · ' + articleCount + ' stories\n' +
    '═══════════════════\n\n' +
    '⚡️ <b>QUICK HITS</b>\n' +
    '───────────────────\n';

  // Telegram rejects messages over 4096 characters, so a long list spills into follow-up messages.
  const messages = [];
  let current = header;
  hitLines.forEach(function(line) {
    if ((current + line).length > 4000) {
      messages.push(current);
      current = '⚡️ <b>QUICK HITS (cont.)</b>\n───────────────────\n';
    }
    current += line;
  });
  messages.push(current);

  const openButton = { inline_keyboard: [[{ text: '📖 Open Wire Room', url: url }]] };
  messages.forEach(function(text, i) {
    const isLast = i === messages.length - 1;
    sendTelegramMessage(botToken, chatId, text.trim(), isLast ? openButton : null);
    if (!isLast) Utilities.sleep(1000);
  });
}

function sendTelegramMessage(botToken, chatId, text, replyMarkup) {
  const url = 'https://api.telegram.org/bot' + botToken + '/sendMessage';
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const status = response.getResponseCode();

  if (status !== 200) {
    throw new Error(`Telegram error (HTTP ${status}): ${response.getContentText()}`);
  }
}


function setupDailyTriggers() {
  removeDailyTriggers();

  // Morning Trigger: Set to 8:30 AM
  ScriptApp.newTrigger('generateBloombergBrief')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.TRIGGER_HOUR)
    .nearMinute(30)
    .inTimezone(Session.getScriptTimeZone())
    .create();

  // Evening Trigger: Set to 7:30 PM (19:30)
  ScriptApp.newTrigger('generateBloombergBrief')
    .timeBased()
    .everyDays(1)
    .atHour(19)
    .nearMinute(30)
    .inTimezone(Session.getScriptTimeZone())
    .create();

  Logger.log('✅ Both daily triggers systematically configured for 8:30 AM and 7:30 PM');
}

function removeDailyTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'generateBloombergBrief') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log('🛑 All daily triggers for generateBloombergBrief removed.');
}

// ── HELPERS ──────────────────────────────────────────────────

function formatDate(date, pattern) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), pattern);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sendFailureAlert(err) {
  const email = CONFIG.NOTIFY_EMAIL || '';
  if (!email) return;
  try {
    GmailApp.sendEmail(
      email,
      '⚠ Bloomberg Brief Generation Failed',
      'Error: ' + err.message + '\n\nCheck logs at https://script.google.com'
    );
  } catch(e) {
    Logger.log('Could not send alert email: ' + e.message);
  }
}

// ── HTML TEMPLATES ───────────────────────────────────────────

const ARCHIVE_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,600;0,6..72,700;1,6..72,400&family=Libre+Franklin:wght@400;500;600&display=swap">
<style>
  :root{
    --paper:#ffffff; --hairline:#e2dfda; --ink:#121212; --ink-muted:#6b6661; --red:#e3120b; --blue:#0a6ea8;
    --serif:'Newsreader', Georgia, 'Times New Roman', serif;
    --sans:'Libre Franklin', 'Helvetica Neue', Arial, sans-serif;
    color-scheme:light;
  }
  @media (prefers-color-scheme: dark){
    :root{ --paper:#121212; --hairline:#303030; --ink:#f3f1ee; --ink-muted:#9c978f; --red:#ff5a50; --blue:#6cb4e6; color-scheme:dark; }
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;border-top:4px solid var(--red);}
  .wrap{max-width:640px;margin:0 auto;padding:14px 16px 60px;}
  .top{display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--hairline);}
  .wordmark{font-family:var(--serif);font-weight:700;font-size:23px;letter-spacing:-0.015em;}
  .wordmark .mark{display:inline-block;width:7px;height:7px;background:var(--red);margin-left:3px;}
  .top a{font-size:13px;font-weight:500;color:var(--ink-muted);text-decoration:none;}
  .top a:hover{color:var(--ink);}
  h1{font-family:var(--serif);font-weight:700;font-size:30px;letter-spacing:-0.015em;margin:28px 0 4px;}
  .sub{font-size:13px;color:var(--ink-muted);margin-bottom:14px;}
  .row{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 12px;padding:15px 0;border-bottom:1px solid var(--hairline);text-decoration:none;color:var(--ink);}
  .row .day{font-family:var(--serif);font-weight:600;font-size:18px;}
  .row .meta{font-size:12.5px;color:var(--ink-muted);white-space:nowrap;}
  .row:hover .day{color:var(--red);}
  a:focus-visible{outline:2px solid var(--blue);outline-offset:3px;}
  .empty{font-family:var(--serif);font-style:italic;color:var(--ink-muted);}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><span class="wordmark">Wire Room<span class="mark"></span></span><a href="%%TODAY_URL%%">Latest edition</a></div>
  <h1>Archive</h1>
  <div class="sub">Every saved briefing, newest first</div>
  %%ROWS%%
</div>
</body>
</html>`;

const WIRE_ROOM_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;0,6..72,700;1,6..72,400&family=Libre+Franklin:wght@400;500;600&display=swap">
<style>
  :root{
    --paper:#ffffff; --panel:#f4f2ef; --raised:#ffffff; --hairline:#e2dfda;
    --ink:#121212; --ink-body:#34312e; --ink-muted:#6b6661;
    --red:#e3120b; --red-fill:#e3120b; --blue:#0a6ea8;
    --serif:'Newsreader', Georgia, 'Times New Roman', serif;
    --sans:'Libre Franklin', 'Helvetica Neue', Arial, sans-serif;
    color-scheme:light;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --paper:#121212; --panel:#1e1e1e; --raised:#2c2c2c; --hairline:#303030;
      --ink:#f3f1ee; --ink-body:#d0ccc6; --ink-muted:#9c978f;
      --red:#ff5a50; --blue:#6cb4e6;
      color-scheme:dark;
    }
  }
  :root[data-theme="dark"]{
    --paper:#121212; --panel:#1e1e1e; --raised:#2c2c2c; --hairline:#303030;
    --ink:#f3f1ee; --ink-body:#d0ccc6; --ink-muted:#9c978f;
    --red:#ff5a50; --blue:#6cb4e6;
    color-scheme:dark;
  }
  *{box-sizing:border-box;}
  [hidden]{display:none !important;}
  html,body{margin:0;padding:0;}
  body{background:var(--paper);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;}
  button,input{font:inherit;-webkit-appearance:none;appearance:none;}
  h1,h2,h3{text-wrap:balance;}
  a{color:var(--blue);}

  .masthead{position:sticky;top:0;z-index:20;background:var(--paper);border-top:4px solid var(--red);border-bottom:1px solid var(--hairline);}
  .masthead-inner, .app{max-width:720px;margin:0 auto;padding:0 16px;}
  .masthead-row{display:flex;align-items:center;gap:14px;padding:12px 0 4px;}
  .wordmark{margin:0;font-family:var(--serif);font-weight:700;font-size:25px;line-height:1;letter-spacing:-0.015em;color:var(--ink);}
  .wordmark .mark{display:inline-block;width:7px;height:7px;background:var(--red);margin-left:3px;}
  .archive-link{margin-left:auto;font-size:13px;font-weight:500;color:var(--ink-muted);text-decoration:none;}
  .archive-link:hover{color:var(--ink);}
  .mode-toggle{display:flex;background:var(--panel);border-radius:999px;padding:3px;}
  .mode-toggle button{font-size:12.5px;font-weight:600;border:none;background:transparent;color:var(--ink-muted);padding:6px 13px;border-radius:999px;cursor:pointer;}
  .mode-toggle button.active{background:var(--raised);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,0.14);}

  .section-nav{display:flex;gap:20px;overflow-x:auto;scrollbar-width:none;margin-bottom:-1px;}
  .section-nav::-webkit-scrollbar{display:none;}
  .section-nav button{flex:0 0 auto;background:none;border:none;border-bottom:2px solid transparent;padding:10px 0 9px;font-size:13.5px;font-weight:500;color:var(--ink-muted);cursor:pointer;white-space:nowrap;}
  .section-nav button:hover{color:var(--ink);}
  .section-nav button.active{color:var(--ink);border-bottom-color:var(--red);}

  .app{padding-bottom:80px;}
  .dateline{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;margin:18px 0 22px;font-size:13px;color:var(--ink-muted);}
  .dateline .edition{color:var(--red);font-weight:600;}
  .read-count{margin-left:auto;font-variant-numeric:tabular-nums;}

  .section-head::before{content:"";display:block;width:36px;height:5px;background:var(--red);margin-bottom:10px;}
  .section-head h2{margin:0;font-family:var(--serif);font-weight:700;font-size:23px;line-height:1.15;letter-spacing:-0.01em;color:var(--ink);}
  .section-head .byline{display:block;margin-top:4px;font-size:12.5px;color:var(--ink-muted);}

  .block-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px;}
  .block-head .count{font-size:12.5px;color:var(--ink-muted);}
  .brief-meta{display:flex;align-items:center;gap:10px;}
  .brief-toggle{border:1px solid var(--hairline);background:var(--paper);color:var(--ink);font-size:12px;font-weight:600;padding:4px 11px;border-radius:999px;cursor:pointer;}
  .brief{display:flex;gap:10px;overflow-x:auto;margin:0 -16px;padding:0 16px 6px;scrollbar-width:none;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 16px,#000 calc(100% - 24px),transparent 100%);mask-image:linear-gradient(to right,transparent 0,#000 16px,#000 calc(100% - 24px),transparent 100%);}
  .brief::-webkit-scrollbar{display:none;}
  .brief.snap{scroll-snap-type:x mandatory;scroll-padding:0 16px;}
  .brief.snap .brief-card{scroll-snap-align:start;}
  .brief-card{flex:0 0 min(250px,76%);display:flex;flex-direction:column;gap:8px;padding:16px 16px 18px;background:var(--panel);}
  .brief-fig{font-family:var(--serif);font-weight:600;font-size:32px;line-height:1;letter-spacing:-0.02em;color:var(--ink);}
  .brief-text{margin:0;font-size:13px;line-height:1.45;color:var(--ink-body);display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;}

  .search-row{position:relative;margin:30px 0 8px;}
  .search-row svg{position:absolute;left:0;top:50%;transform:translateY(-50%);color:var(--ink-muted);}
  .search-row input{width:100%;font-size:15px;padding:10px 4px 10px 24px;border:none;border-bottom:1px solid var(--ink);border-radius:0;background:transparent;color:var(--ink);}
  .search-row input::placeholder{color:var(--ink-muted);}
  .search-row input:focus{outline:none;border-bottom-color:var(--red);box-shadow:0 1px 0 var(--red);}

  .feed{display:flex;flex-direction:column;gap:36px;margin-top:22px;}
  .article{padding:16px 0 17px;border-bottom:1px solid var(--hairline);cursor:pointer;}
  .article:last-child{border-bottom:none;}
  .article h3{margin:0 0 6px;font-family:var(--serif);font-weight:600;font-size:20px;line-height:1.25;letter-spacing:-0.005em;color:var(--ink);transition:color .15s ease;}
  .article:hover h3{color:var(--red);}
  .article.read h3{color:var(--ink-muted);}
  .article .body{margin:0;max-width:65ch;font-family:var(--serif);font-size:16px;line-height:1.55;color:var(--ink-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .article.expanded .body{display:block;overflow:visible;color:var(--ink-body);}
  .article.expanded .body::after{content:" ■";color:var(--red);font-size:0.8em;}
  .fig{font-weight:600;color:var(--ink);}

  .empty-state{padding:56px 0;text-align:center;font-family:var(--serif);font-style:italic;font-size:17px;color:var(--ink-muted);}

  .focus{display:none;position:fixed;inset:0;z-index:50;flex-direction:column;background:var(--paper);}
  .focus.active{display:flex;}
  .focus-top{border-top:4px solid var(--red);border-bottom:1px solid var(--hairline);padding:12px 16px 10px;}
  .focus-progress{display:flex;gap:2px;margin-bottom:10px;}
  .focus-progress i{flex:1;height:3px;background:var(--hairline);}
  .focus-progress i.done{background:var(--ink-muted);}
  .focus-progress i.current{background:var(--red);}
  .focus-top-row{display:flex;align-items:center;justify-content:space-between;}
  .focus-count{font-size:12.5px;font-weight:500;color:var(--ink-muted);font-variant-numeric:tabular-nums;}
  .focus-close{width:32px;height:32px;border-radius:50%;border:1px solid var(--hairline);background:var(--paper);color:var(--ink);font-size:14px;line-height:1;cursor:pointer;}
  .focus-scroll{flex:1;overflow-y:auto;overscroll-behavior:contain;}
  .focus-card{max-width:640px;margin:0 auto;padding:30px 20px 48px;}
  .focus-card .kicker{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--red);}
  .focus-card h2{margin:0 0 20px;font-family:var(--serif);font-weight:700;font-size:clamp(26px,6.5vw,36px);line-height:1.12;letter-spacing:-0.015em;color:var(--ink);}
  .focus-card .body{margin:0;font-family:var(--serif);font-size:18px;line-height:1.6;color:var(--ink-body);}
  .focus-card .body::first-letter{float:left;font-size:3.4em;line-height:0.85;font-weight:600;padding:5px 8px 0 0;color:var(--ink);}
  .tombstone{color:var(--red);font-size:0.8em;}
  .focus-nav{display:flex;gap:10px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--hairline);background:var(--paper);}
  .focus-nav button{flex:1;padding:13px;border-radius:4px;border:1px solid var(--hairline);background:var(--paper);color:var(--ink);font-size:14px;font-weight:600;cursor:pointer;}
  .focus-nav button.primary{background:var(--red-fill);border-color:var(--red-fill);color:#ffffff;}
  .focus-nav button:disabled{opacity:0.4;cursor:default;}

  button:focus-visible, input:focus-visible, .article:focus-visible, a:focus-visible{outline:2px solid var(--blue);outline-offset:3px;}
  @media (prefers-reduced-motion: reduce){ *{transition:none !important;} }
</style>
</head>
<body>
<header class="masthead">
  <div class="masthead-inner">
    <div class="masthead-row">
      <h1 class="wordmark">Wire Room<span class="mark" aria-hidden="true"></span></h1>
      <a class="archive-link" href="%%ARCHIVE_URL%%">Archive</a>
      <div class="mode-toggle" role="group" aria-label="Reading mode">
        <button id="feedBtn" class="active">Feed</button>
        <button id="focusBtn">Focus</button>
      </div>
    </div>
    <nav class="section-nav" id="sectionNav" aria-label="Sections"></nav>
  </div>
</header>

<main class="app">
  <div class="dateline">
    <span class="edition">%%EDITION%% edition</span>
    <span aria-hidden="true">·</span>
    <span>%%DATE_LABEL%%</span>
    <span class="read-count" id="readCount">0 of 0 read</span>
  </div>

  <section class="brief-block" id="briefBlock">
    <div class="block-head">
      <div class="section-head"><h2>Quick Hits</h2></div>
      <div class="brief-meta">
        <span class="count" id="briefCount"></span>
        <button class="brief-toggle" id="briefToggle" aria-pressed="false" hidden>Pause</button>
      </div>
    </div>
    <div class="brief" id="brief"></div>
  </section>

  <div class="search-row">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input id="searchInput" type="search" placeholder="Search this edition" aria-label="Search this edition">
  </div>

  <div class="feed" id="feed"></div>
</main>

<div class="focus" id="focusView" role="dialog" aria-label="Focus mode">
  <div class="focus-top">
    <div class="focus-progress" id="focusProgress"></div>
    <div class="focus-top-row">
      <span class="focus-count" id="focusCount"></span>
      <button class="focus-close" id="focusClose" aria-label="Close focus mode">✕</button>
    </div>
  </div>
  <div class="focus-scroll" id="focusScroll"><article class="focus-card" id="focusCard"></article></div>
  <div class="focus-nav">
    <button id="focusPrev">Previous</button>
    <button id="focusPrimary" class="primary">Next story</button>
  </div>
</div>

<script>
  var DIGEST = %%DIGEST_JSON%%;
  var STORAGE_KEY = 'wireroom_read_' + '%%STORAGE_KEY%%';
  var currentFilter = 'ALL';
  var searchTerm = '';

  // Storage can be blocked inside in-app browsers (e.g. Telegram's); the page must still render.
  var readSet = new Set();
  try { readSet = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); } catch (e) {}

  function saveRead(){ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(readSet))); } catch (e) {} }

  var SMALL_WORDS = ['a', 'and', 'for', 'in', 'of', 'on', 'the', 'to'];

  function titleCase(t){
    return String(t || '').toLowerCase().split(' ').map(function(w, i){
      if (!w || (i > 0 && SMALL_WORDS.indexOf(w) !== -1)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  function tabLabel(t){
    var m = String(t || '').match(/^(MORNING|EVENING) BRIEFING *— *(.+)$/i);
    if (!m) return titleCase(t);
    return titleCase(m[2]) + (m[1].toUpperCase() === 'MORNING' ? ' AM' : ' PM');
  }

  function esc(str){
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var FIGURE_RE = /(^|[^A-Za-z0-9])((?:US\\$|[+$£€¥−-])?\\d[\\d,]*(?:\\.\\d+)?(?:[TBMK]\\b|\\s?(?:%|bps?\\b|bn\\b|tn\\b|basis points|billion|trillion|million))?)/g;
  var FIGURE_ONE = new RegExp(FIGURE_RE.source);
  function fig(html){ return html.replace(FIGURE_RE, '$1<span class="fig">$2</span>'); }

  function allArticles(){
    var out = [];
    (DIGEST.sections || []).forEach(function(s, si){
      (s.articles || []).forEach(function(a, ai){
        out.push({ headline: a.headline, body: a.body, sectionTitle: s.title, id: si + '-' + ai });
      });
    });
    return out;
  }

  function briefCard(h, duplicate){
    var m = String(h).match(FIGURE_ONE);
    return '<div class="brief-card"' + (duplicate ? ' aria-hidden="true"' : '') + '>' +
      (m ? '<div class="brief-fig">' + esc(m[2]) + '</div>' : '') + '<p class="brief-text">' + esc(h) + '</p></div>';
  }

  function renderBrief(){
    var hits = DIGEST.quickHits || [];
    if (!hits.length){ document.getElementById('briefBlock').hidden = true; return; }
    var strip = document.getElementById('brief');
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var animate = hits.length > 2 && !reduceMotion;

    document.getElementById('briefCount').textContent = hits.length + ' items';
    // A second copy of the cards lets the strip loop without a visible jump.
    strip.innerHTML = hits.map(function(h){ return briefCard(h, false); }).join('') +
      (animate ? hits.map(function(h){ return briefCard(h, true); }).join('') : '');
    strip.classList.toggle('snap', !animate);
    document.getElementById('briefToggle').hidden = !animate;
    if (animate) startBriefMotion(strip, hits.length);
  }

  function startBriefMotion(strip, count){
    var SPEED = 32;
    var cards = strip.children;
    var loop = 0, pos = 0, last = 0, wasMoving = false;
    var paused = false, hovering = false, holdUntil = 0;

    function measure(){ loop = cards[count].offsetLeft - cards[0].offsetLeft; }
    function holdFor(ms){ holdUntil = performance.now() + ms; }

    measure();
    window.addEventListener('resize', measure);
    strip.addEventListener('pointerenter', function(e){ if (e.pointerType === 'mouse') hovering = true; });
    strip.addEventListener('pointerleave', function(e){ if (e.pointerType === 'mouse') hovering = false; });
    strip.addEventListener('touchstart', function(){ holdUntil = Infinity; }, { passive: true });
    strip.addEventListener('touchend', function(){ holdFor(2500); });
    strip.addEventListener('touchcancel', function(){ holdFor(2500); });
    strip.addEventListener('wheel', function(){ holdFor(2500); }, { passive: true });

    var toggle = document.getElementById('briefToggle');
    toggle.addEventListener('click', function(){
      paused = !paused;
      toggle.textContent = paused ? 'Play' : 'Pause';
      toggle.setAttribute('aria-pressed', String(paused));
    });

    requestAnimationFrame(function tick(now){
      var moving = !paused && !hovering && now > holdUntil;
      if (moving){
        if (!wasMoving) pos = strip.scrollLeft;
        pos += SPEED * Math.min(now - last, 100) / 1000;
        if (pos >= loop) pos -= loop;
        strip.scrollLeft = pos;
      }
      wasMoving = moving;
      last = now;
      requestAnimationFrame(tick);
    });
  }

  function renderSectionNav(){
    var nav = document.getElementById('sectionNav');
    var sections = (DIGEST.sections || []).filter(function(s){ return s.articles && s.articles.length; });
    var cats = ['ALL'].concat(sections.map(function(s){ return s.title; }));
    nav.innerHTML = cats.map(function(c){
      var label = c === 'ALL' ? 'All' : tabLabel(c);
      return '<button data-cat="' + esc(c) + '"' + (c === currentFilter ? ' class="active"' : '') + '>' + esc(label) + '</button>';
    }).join('');
    Array.prototype.forEach.call(nav.querySelectorAll('button'), function(b){
      b.addEventListener('click', function(){ currentFilter = b.dataset.cat; renderSectionNav(); renderFeed(); });
    });
  }

  function matchesSearch(article){
    if (!searchTerm) return true;
    var hay = (article.headline + ' ' + article.body).toLowerCase();
    return hay.indexOf(searchTerm.toLowerCase()) !== -1;
  }

  function renderFeed(){
    var feed = document.getElementById('feed');
    var html = '';
    var total = 0;

    (DIGEST.sections || []).forEach(function(s, si){
      if (currentFilter !== 'ALL' && s.title !== currentFilter) return;
      var matched = (s.articles || []).filter(matchesSearch);
      if (!matched.length) return;
      total += matched.length;

      var byline = s.byline ? String(s.byline).replace(/^by +/i, '') : '';
      html += '<section class="section-block"><div class="section-head"><h2>' + esc(titleCase(s.title)) + '</h2>' +
        (byline ? '<span class="byline">By ' + esc(byline) + '</span>' : '') + '</div>';

      s.articles.forEach(function(a, ai){
        if (!matchesSearch(a)) return;
        var id = si + '-' + ai;
        html += '<article class="article' + (readSet.has(id) ? ' read' : '') + '" data-id="' + id + '" tabindex="0">' +
          '<h3>' + esc(a.headline) + '</h3><p class="body">' + fig(esc(a.body)) + '</p></article>';
      });
      html += '</section>';
    });

    feed.innerHTML = total ? html : '<p class="empty-state">' +
      (searchTerm ? 'No stories match “' + esc(searchTerm) + '”.' : 'No stories in this edition yet.') + '</p>';

    Array.prototype.forEach.call(feed.querySelectorAll('.article'), function(el){
      el.addEventListener('click', function(){
        el.classList.toggle('expanded');
        if (el.classList.contains('expanded')){
          readSet.add(el.dataset.id);
          el.classList.add('read');
          saveRead();
          updateReadCount();
        }
      });
      el.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); el.click(); }
      });
    });
    updateReadCount();
  }

  function updateReadCount(){
    var items = allArticles();
    var read = items.filter(function(a){ return readSet.has(a.id); }).length;
    document.getElementById('readCount').textContent = read + ' of ' + items.length + ' read';
  }

  var focusIdx = 0;
  var focusView = document.getElementById('focusView');

  function setMode(focus){
    document.getElementById('focusBtn').classList.toggle('active', focus);
    document.getElementById('feedBtn').classList.toggle('active', !focus);
    focusView.classList.toggle('active', focus);
    if (focus) renderFocusCard();
    else renderFeed();
  }

  function renderFocusCard(){
    var items = allArticles();
    var card = document.getElementById('focusCard');
    if (!items.length){
      card.innerHTML = '<p class="empty-state">No stories in this edition yet.</p>';
      document.getElementById('focusProgress').innerHTML = '';
      document.getElementById('focusCount').textContent = '';
      document.getElementById('focusPrev').disabled = true;
      document.getElementById('focusPrimary').textContent = 'Done';
      return;
    }
    focusIdx = Math.max(0, Math.min(focusIdx, items.length - 1));
    var a = items[focusIdx];

    document.getElementById('focusCount').textContent = 'Story ' + (focusIdx + 1) + ' of ' + items.length;
    card.innerHTML = '<p class="kicker">' + esc(titleCase(a.sectionTitle)) + '</p><h2>' + esc(a.headline) + '</h2>' +
      '<p class="body">' + fig(esc(a.body)) + '<span class="tombstone" aria-hidden="true"> ■</span></p>';
    document.getElementById('focusScroll').scrollTop = 0;

    document.getElementById('focusProgress').innerHTML = items.map(function(it, i){
      return '<i class="' + (i < focusIdx ? 'done' : i === focusIdx ? 'current' : '') + '"></i>';
    }).join('');

    document.getElementById('focusPrev').disabled = focusIdx === 0;
    document.getElementById('focusPrimary').textContent = focusIdx === items.length - 1 ? 'Done' : 'Next story';
    readSet.add(a.id);
    saveRead();
  }

  document.getElementById('feedBtn').addEventListener('click', function(){ setMode(false); });
  document.getElementById('focusBtn').addEventListener('click', function(){
    var firstUnread = allArticles().findIndex(function(a){ return !readSet.has(a.id); });
    focusIdx = firstUnread === -1 ? 0 : firstUnread;
    setMode(true);
  });
  document.getElementById('focusClose').addEventListener('click', function(){ setMode(false); });
  document.getElementById('focusPrev').addEventListener('click', function(){ focusIdx--; renderFocusCard(); });
  document.getElementById('focusPrimary').addEventListener('click', function(){
    if (focusIdx < allArticles().length - 1){ focusIdx++; renderFocusCard(); }
    else setMode(false);
  });

  document.getElementById('searchInput').addEventListener('input', function(e){ searchTerm = e.target.value; renderFeed(); });

  document.addEventListener('keydown', function(e){
    if (!focusView.classList.contains('active')) return;
    if (e.key === 'ArrowRight') document.getElementById('focusPrimary').click();
    if (e.key === 'ArrowLeft' && !document.getElementById('focusPrev').disabled) document.getElementById('focusPrev').click();
    if (e.key === 'Escape') setMode(false);
  });

  var touchStartX = null;
  var focusScroll = document.getElementById('focusScroll');
  focusScroll.addEventListener('touchstart', function(e){ touchStartX = e.touches[0].clientX; }, { passive: true });
  focusScroll.addEventListener('touchend', function(e){
    if (touchStartX === null) return;
    var dx = e.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(dx) < 60) return;
    if (dx < 0) document.getElementById('focusPrimary').click();
    else if (!document.getElementById('focusPrev').disabled) document.getElementById('focusPrev').click();
  });

  renderBrief();
  renderSectionNav();
  renderFeed();
</script>
</body>
</html>`;
