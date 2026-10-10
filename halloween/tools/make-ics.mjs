// Собирает party-en.ics, party-fr.ics, party-ru.ics из настроек в index.html.
// Запуск после смены даты или времени: node halloween/tools/make-ics.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const cfg = JSON.parse(html.match(/<script id="party-config" type="application\/json">([\s\S]*?)<\/script>/)[1]);

const at = {
  en: (t) => { const h = +t.slice(0, 2); return ((h % 12) || 12) + ':' + t.slice(3, 5) + (h < 12 ? ' a.m.' : ' p.m.'); },
  fr: (t) => (+t.slice(0, 2)) + 'h' + (t.slice(3, 5) === '00' ? '' : t.slice(3, 5)),
  ru: (t) => t
};
const city = (lang) => cfg.city[lang] || cfg.city.en;
const TEXT = {
  en: {
    summary: `The Eye of Siberia · ${cfg.host.en}’s Birthday Expedition`,
    description: 'An original role-playing game: The Black Tears of Baikal.\n' +
      'Dress as one country of your choice. Bring your favourite dish from that country to share on the long journey.\n' +
      (cfg.startTime ? `The convoy departs at ${at.en(cfg.startTime)} sharp. ` : '') +
      `Boarding point: Listvyanka Station, ${city('en')}. The exact address comes once your visa is validated.`,
    alarm: 'Tomorrow the convoy departs for Baikal. Costume and dish ready?'
  },
  fr: {
    summary: `L’Œil de la Sibérie · l’expédition d’anniversaire de ${cfg.host.fr}`,
    description: 'Un jeu de rôle original : Les Larmes noires du Baïkal.\n' +
      'Habillez-vous en un pays de votre choix. Apportez votre plat préféré de ce pays, à partager pendant le long voyage.\n' +
      (cfg.startTime ? `Le convoi part à ${at.fr(cfg.startTime)} précises. ` : '') +
      `Point d’embarquement : gare de Listvianka, ${city('fr')}. L’adresse exacte vous parviendra une fois votre visa validé.`,
    alarm: 'Demain, le convoi part pour le Baïkal. Costume et plat prêts ?'
  },
  ru: {
    summary: `Око Сибири · экспедиция на день рождения ${cfg.host.ruGen}`,
    description: 'Авторская ролевая игра «Чёрные слёзы Байкала».\n' +
      'Наряд одной страны на ваш выбор. Возьмите любимое блюдо этой страны, чтобы разделить его в долгой дороге.\n' +
      (cfg.startTime ? `Конвой отправляется ровно в ${at.ru(cfg.startTime)}. ` : '') +
      `Место посадки: станция Листвянка, ${city('ru')}. Точный адрес пришлём после оформления визы.`,
    alarm: 'Завтра конвой отправляется на Байкал. Костюм и блюдо готовы?'
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
    `LOCATION:${esc(cfg.address || city(lang))}`,
    `URL:${cfg.pageUrl}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(tx.alarm)}`,
    cfg.startTime ? 'TRIGGER:-P1D' : 'TRIGGER:-PT15H',
    'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ];
  writeFileSync(join(root, `party-${lang}.ics`), lines.map(fold).join('\r\n') + '\r\n');
  console.log(`party-${lang}.ics`, when.join(' '));
}
