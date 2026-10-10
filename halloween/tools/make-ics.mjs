// Собирает party-en.ics, party-fr.ics, party-ru.ics из настроек в index.html.
// Запуск после смены даты или времени: node halloween/tools/make-ics.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const cfg = JSON.parse(html.match(/<script id="party-config" type="application\/json">([\s\S]*?)<\/script>/)[1]);

const TEXT = {
  en: {
    summary: `🎃 Halloween around the world · ${cfg.host.en}’s birthday`,
    description: 'Come as a country (or a culture you love) and bring one dish from there. We put everything on one big table and taste it together.\nThe address comes in a personal message.',
    alarm: 'Tomorrow: Halloween around the world. Costume and dish ready?'
  },
  fr: {
    summary: `🎃 Halloween autour du monde · l’anniversaire de ${cfg.host.fr}`,
    description: 'Viens en représentant un pays (ou une culture que tu aimes) et apporte un plat de là-bas. Tout va sur une grande table et on goûte à tout ensemble.\nL’adresse arrive en message perso.',
    alarm: 'Demain : Halloween autour du monde. Costume et plat prêts ?'
  },
  ru: {
    summary: `🎃 Хэллоуин вокруг света · день рождения ${cfg.host.ruGen}`,
    description: 'Костюм страны (или культуры), которую представляешь, и одно блюдо оттуда. Всё ставим на один большой стол и пробуем вместе.\nАдрес пришлю лично.',
    alarm: 'Завтра Хэллоуин вокруг света. Костюм и блюдо готовы?'
  }
};

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const compact = (iso) => iso.replace(/-/g, '');
const nextDay = (iso) => new Date(Date.parse(iso + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);

// Местное время в часовом поясе вечеринки → UTC (учитывает переход на зимнее время).
function toUtc(dateIso, time) {
  const guess = Date.parse(`${dateIso}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: cfg.timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const get = (t) => parts.find((p) => p.type === t).value;
  const shown = Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`);
  return new Date(guess - (shown - guess)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Строки iCalendar не длиннее 75 байт; переносим, не разрезая многобайтовые символы.
function fold(line) {
  const out = [];
  let chunk = '', size = 0, limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (size + n > limit) { out.push(chunk); chunk = ' '; size = 1; limit = 75; }
    chunk += ch; size += n;
  }
  out.push(chunk);
  return out.join('\r\n');
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
for (const lang of Object.keys(TEXT)) {
  const tx = TEXT[lang];
  let when;
  if (cfg.startTime) {
    const endTime = cfg.endTime || '';
    const endDate = endTime && endTime <= cfg.startTime ? nextDay(cfg.date) : cfg.date;
    const start = toUtc(cfg.date, cfg.startTime);
    const end = endTime ? toUtc(endDate, endTime)
      : new Date(Date.parse(start.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) + 5 * 3600000)
          .toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    when = [`DTSTART:${start}`, `DTEND:${end}`];
  } else {
    when = [`DTSTART;VALUE=DATE:${compact(cfg.date)}`, `DTEND;VALUE=DATE:${compact(nextDay(cfg.date))}`];
  }
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//secondbrain//halloween-party//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:halloween-${cfg.date}@ovchinnikovav97-byte.github.io`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${esc(tx.summary)}`,
    `DESCRIPTION:${esc(tx.description + '\n' + cfg.pageUrl)}`,
    `LOCATION:${esc(cfg.city[lang] || cfg.city.en)}`,
    `URL:${cfg.pageUrl}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(tx.alarm)}`,
    cfg.startTime ? 'TRIGGER:-P1D' : 'TRIGGER:-PT15H',
    'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ];
  writeFileSync(join(root, `party-${lang}.ics`), lines.map(fold).join('\r\n') + '\r\n');
  console.log(`party-${lang}.ics`, when.join(' '));
}
