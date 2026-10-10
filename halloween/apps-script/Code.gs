/**
 * Halloween around the world · приём ответов гостей в Google-таблицу.
 *
 * Скрипт живёт внутри твоей Google-таблицы (Расширения → Apps Script).
 * Страница вечеринки отправляет сюда ответы гостей, скрипт записывает их в лист «RSVP»
 * и отдаёт странице только список уже выбранных стран. Имена гостей наружу не уходят.
 *
 * Настройка по шагам: secondbrain/02_PROJECTS/halloween_party/setup_rsvp.md
 * После любой правки этого кода: Развернуть → Управление развёртываниями → ✏️ →
 * Версия: «Новая версия» → Развернуть. Иначе страница продолжит работать со старым кодом.
 */

// ── Настройки ───────────────────────────────────────────────────────────────────────────

// Письмо тебе на почту при каждом новом или изменённом ответе. Не нужно — поставь false.
var NOTIFY_BY_EMAIL = true;

// Адрес, код домофона, этаж. Заполняй ТОЛЬКО здесь, в редакторе Apps Script, и никогда
// в GitHub: репозиторий публичный. Видят только гости, ответившие «да», в своей карточке.
// Пусто — карточка гостя пишет «адрес пришлю лично».
var PRIVATE_DETAILS = '';

var MAX_PLUS_ONES = 10;

// ── Дальше обычно трогать не нужно ────────────────────────────────────────────────────────

var SHEET_RSVP = 'RSVP';
var SHEET_SUMMARY = 'Сводка';
var YES = 'да';
var NO = 'нет';
var HEADERS = ['Обновлено', 'Имя', 'Придёт', 'Гостей с собой', 'Всего человек', 'Страна',
  'Код страны', 'Блюдо', 'Записка', 'Язык', 'Первый ответ', 'ID гостя'];
var COL = { updated: 1, name: 2, coming: 3, plusOnes: 4, people: 5, country: 6, code: 7,
  dish: 8, note: 9, lang: 10, first: 11, id: 12 };

/** Запусти один раз вручную (кнопка «Выполнить»): создаст листы и запомнит таблицу. */
function setup() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', book.getId());
  rsvpSheet_(book);
  summarySheet_(book);
  // Пустой лист по умолчанию («Лист1» / «Sheet1») больше не нужен.
  book.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if (name !== SHEET_RSVP && name !== SHEET_SUMMARY && sheet.getLastRow() === 0 &&
        book.getSheets().length > 2) {
      book.deleteSheet(sheet);
    }
  });
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var out = { ok: true, summary: summary_() };
  // Вернувшийся гость: страница спрашивает по его ID, на месте ли ответ, и получает адрес.
  var id = cleanId_(params.id);
  if (id) {
    var sheet = rsvpSheet_(book_());
    var row = findRow_(sheet, id);
    out.known = row > 0;
    out.details = row > 0 ? detailsFor_(sheet.getRange(row, COL.coming).getValue()) : '';
  }
  return json_(out);
}

function doPost(e) {
  var data;
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }
  // Ловушка для ботов: настоящий гость это скрытое поле не видит и не заполняет.
  if (data.website) return json_({ ok: true, summary: summary_(), details: '' });

  if (data.coming !== 'yes' && data.coming !== 'no') return json_({ ok: false, error: 'missing_fields' });
  var rsvp = clean_(data);
  if (!rsvp.id || !rsvp.name) return json_({ ok: false, error: 'missing_fields' });
  if (rsvp.coming === YES && !rsvp.country) return json_({ ok: false, error: 'missing_country' });
  // Блюдо обязательно: каждый везёт блюдо той страны или культуры, которую представляет.
  if (rsvp.coming === YES && !rsvp.dish) return json_({ ok: false, error: 'missing_dish' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var isNew;
  try {
    isNew = upsert_(rsvp);
  } finally {
    lock.releaseLock();
  }
  if (NOTIFY_BY_EMAIL) notify_(rsvp, isNew);
  return json_({ ok: true, summary: summary_(), details: detailsFor_(rsvp.coming) });
}

// ── Внутренняя кухня ──────────────────────────────────────────────────────────────────────

function book_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function rsvpSheet_(book) {
  var sheet = book.getSheetByName(SHEET_RSVP);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_RSVP, 0);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function summarySheet_(book) {
  var sheet = book.getSheetByName(SHEET_SUMMARY) || book.insertSheet(SHEET_SUMMARY);
  sheet.clear();
  var r = "'" + SHEET_RSVP + "'!";
  sheet.getRange('A1:A3').setValues([['Придут, человек'], ['Ответили «да»'], ['Не смогут']]);
  sheet.getRange('B1').setFormula('=SUMIF(' + r + 'C:C,"' + YES + '",' + r + 'E:E)');
  sheet.getRange('B2').setFormula('=COUNTIF(' + r + 'C:C,"' + YES + '")');
  sheet.getRange('B3').setFormula('=COUNTIF(' + r + 'C:C,"' + NO + '")');
  sheet.getRange('A5').setValue('Страны');
  sheet.getRange('A6').setFormula('=IFERROR(QUERY(' + r + 'A:L,"select F, count(B), sum(E) where C = \'' +
    YES + '\' group by F order by sum(E) desc label F \'Страна\', count(B) \'Компаний\', sum(E) \'Человек\'",1),"пока пусто")');
  sheet.getRange('E5').setValue('Блюда');
  sheet.getRange('E6').setFormula('=IFERROR(QUERY(' + r + 'A:L,"select F, H, B where C = \'' +
    YES + '\' and H <> \'\' order by F label F \'Страна\', H \'Блюдо\', B \'Кто\'",1),"пока пусто")');
  sheet.getRange('A1:A5').setFontWeight('bold');
  sheet.getRange('E5').setFontWeight('bold');
  return sheet;
}

function clean_(d) {
  var coming = d.coming === 'yes' ? YES : NO;
  var yes = coming === YES;
  var plus = yes ? Math.max(0, Math.min(MAX_PLUS_ONES, parseInt(d.plusOnes, 10) || 0)) : 0;
  return {
    id: cleanId_(d.id),
    name: text_(d.name, 80),
    coming: coming,
    plusOnes: plus,
    people: yes ? plus + 1 : 0,
    // Страна для таблицы — на твоём языке (страница присылает её отдельно), иначе как ввёл гость.
    country: yes ? text_(d.countryHost || d.country, 60) : '',
    code: yes ? String(d.code || '').toUpperCase().replace(/[^A-Z-]/g, '').slice(0, 6) : '',
    dish: yes ? text_(d.dish, 120) : '',
    note: text_(d.note, 500),
    lang: String(d.lang || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 5)
  };
}

function cleanId_(v) {
  return String(v || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
}

function text_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

// Апостроф в начале значит для таблицы «это просто текст»: гость не подсунет формулу (=…),
// а «+33 6…» или «7/11» не превратятся в число или дату. В ячейке апостроф не виден.
function safe_(s) {
  return s ? "'" + s : s;
}

function findRow_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, COL.id, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return -1;
}

/** Обновляет строку гостя по его ID или добавляет новую. Возвращает true, если гость новый. */
function upsert_(r) {
  var sheet = rsvpSheet_(book_());
  var now = new Date();
  var row = findRow_(sheet, r.id);
  var first = row > 0 ? (sheet.getRange(row, COL.first).getValue() || now) : now;
  var values = [now, safe_(r.name), r.coming, r.plusOnes, r.people, safe_(r.country), r.code,
    safe_(r.dish), safe_(r.note), r.lang, first, r.id];
  if (row > 0) {
    sheet.getRange(row, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return row < 0;
}

/** Только страны и сколько компаний за каждую. Без имён: страница публичная. */
function summary_() {
  var sheet = book_().getSheetByName(SHEET_RSVP);
  var out = { countries: [] };
  if (!sheet || sheet.getLastRow() < 2) return out;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
  var byKey = {};
  rows.forEach(function (row) {
    if (row[COL.coming - 1] !== YES) return;
    var code = String(row[COL.code - 1] || '');
    var name = String(row[COL.country - 1] || '').trim();
    if (!code && !name) return;
    var key = code || name.toLowerCase();
    if (!byKey[key]) {
      byKey[key] = { code: code, name: code ? '' : name, teams: 0 };
      out.countries.push(byKey[key]);
    }
    byKey[key].teams += 1;
  });
  out.countries.sort(function (a, b) { return b.teams - a.teams; });
  return out;
}

function detailsFor_(coming) {
  return coming === YES ? String(PRIVATE_DETAILS || '').trim() : '';
}

function notify_(r, isNew) {
  try {
    var to = Session.getEffectiveUser().getEmail();
    if (!to) return;
    var subject;
    var lines = ['Имя: ' + r.name];
    if (r.coming === YES) {
      subject = '🎃 ' + r.name + ' придёт' + (r.plusOnes ? ' (+' + r.plusOnes + ')' : '') + ' · ' + r.country;
      lines.push('Придёт: да, всего человек: ' + r.people, 'Страна: ' + r.country);
      if (r.dish) lines.push('Блюдо: ' + r.dish);
    } else {
      subject = r.name + ' не сможет';
      lines.push('Придёт: нет');
    }
    if (r.note) lines.push('Записка: ' + r.note);
    lines.push('', 'Таблица: ' + book_().getUrl());
    MailApp.sendEmail(to, subject + (isNew ? '' : ' · ответ изменён'), lines.join('\n'));
  } catch (err) {
    console.warn('notify failed: ' + err);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
