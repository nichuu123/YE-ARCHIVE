#!/usr/bin/env node
'use strict';

/**
 * Reconcile catalog.js against what is actually on disk, then build optimized
 * cover art for the UI.
 *
 *   node tools/sync-catalog.js --dry-run   report only
 *   node tools/sync-catalog.js             write catalog + art
 *   node tools/sync-catalog.js --force     rebuild every webp
 *
 * The catalog keeps its original order and metadata. Paths are rewritten to
 * real files, and anything that cannot be found is listed in
 * window.YE_ARCHIVE_MISSING so the UI never requests a file that is not there.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MUSIC = path.join(ROOT, 'music');
const ART = path.join(ROOT, 'assets', 'art');
const CATALOG = path.join(ROOT, 'catalog.js');

const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.opus', '.aac']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

const ERA_TINTS = [
  '#2b3cf0', '#e8451f', '#0d7a63', '#b01f6e', '#b98a12', '#237aa8',
  '#6b4bd6', '#cf3d4f', '#4c7a2f', '#8a4b1f', '#1f6f8b', '#a33a86',
  '#c05621', '#2f6b4f', '#7a3e9d', '#b23a48', '#3b5bdb', '#d9480f',
  '#0b7285', '#5f3dc4', '#2b8a3e', '#c2255c', '#e67700',
];

const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

function norm(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’‘`´']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Catalog says "College", the folder says "Collage". Treat both as the same era. */
const normEra = value => norm(value).replace(/\bcollege\b/g, 'collage');

// Windows-1252 characters that UTF-8 bytes turn into when they are decoded
// with the wrong codec. Node's "latin1" maps these to the wrong byte values,
// so reverse them explicitly before decoding as UTF-8.
const CP1252_TO_BYTE = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function repairMojibake(value) {
  if (!/[ÃÂâ€™Å]/.test(value)) return value;
  try {
    const bytes = [];
    for (const character of value) {
      const code = character.codePointAt(0);
      if (code <= 0xff) bytes.push(code);
      else if (CP1252_TO_BYTE.has(code)) bytes.push(CP1252_TO_BYTE.get(code));
      else return value;
    }
    const repaired = Buffer.from(bytes).toString('utf8');
    return repaired.includes('�') ? value : repaired;
  } catch {
    return value;
  }
}

function readCatalog() {
  const source = fs.readFileSync(CATALOG, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'catalog.js' });
  const db = sandbox.window.YE_ARCHIVE_DATABASE;
  if (!Array.isArray(db)) throw new Error('catalog.js did not expose YE_ARCHIVE_DATABASE');
  return db;
}

function listDir(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);
}

function extOf(name) {
  return path.extname(name).toLowerCase();
}

function stripAudioExt(name) {
  return name.replace(/\.[a-z0-9]+$/i, '');
}

function leadingNumber(value) {
  const match = String(value).match(/^\s*(\d{1,3})(?:[\s._\-–—)\]]+)(?=\S)/);
  return match ? match[1] : '';
}

/** Bigram Dice coefficient, 0..1. */
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = str => {
    const map = new Map();
    const s = ` ${str} `;
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      map.set(g, (map.get(g) || 0) + 1);
    }
    return map;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) || 0);
  const total = [...ga.values()].reduce((x, y) => x + y, 0) + [...gb.values()].reduce((x, y) => x + y, 0);
  return total ? (2 * overlap) / total : 0;
}

/** Turn a filename into a comparable title, dropping numbering and artist prefixes. */
function trackKey(name) {
  let value = repairMojibake(stripAudioExt(name))
    .replace(/\((?:explicit|clean|official audio|audio)\)/gi, ' ')
    .replace(/\[(?:explicit|clean)\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Track numbers come first: "01 - ¥$, Kanye West ... - SLIDE"
  value = value.replace(/^\s*\d{1,3}(?:[\s._\-–—)\]]+)(?=\S)/, '').trim();

  // Then a known artist prefix, dropped up to the first spaced dash. Using the
  // first dash keeps "KW - Song - Part 2" intact.
  if (/^(?:¥\$|y\$|kw|kanye west|ty dolla|ye)(?![a-z])/i.test(value)) {
    const separator = value.search(/\s[-–—]\s/);
    if (separator > 0) {
      value = value.slice(separator + 3);
    } else {
      value = value
        .replace(/^(?:¥\$|y\$|kw)\s*[-–—,:]\s*/i, '')
        .replace(/^(?:kanye west|ty dolla \$ign|ty dolla sign|ye)\s*[-–—,:]\s+/i, '');
    }
  }

  // Some folders put the number after the artist instead of before it.
  value = value.replace(/^\s*\d{1,3}(?:[\s._\-–—)\]]+)(?=\S)/, '').trim();
  return norm(value);
}

function pickCoverFile(albumDir, catalogCover) {
  if (catalogCover) {
    const absolute = path.join(ROOT, catalogCover);
    if (fs.existsSync(absolute) && IMAGE_EXT.has(extOf(absolute))) return absolute;
  }
  const images = listDir(albumDir).filter(name => IMAGE_EXT.has(extOf(name)));
  if (!images.length) return null;
  const rank = name => {
    const n = name.toLowerCase();
    if (n === 'coverart.jpg' || n === 'coverart.jpeg' || n === 'coverart.png') return 0;
    if (n === 'cover.jpg' || n === 'cover.png') return 1;
    if (n === 'folder.jpg' || n === 'folder.png') return 2;
    if (n === 'front.jpg' || n === 'front.png') return 3;
    if (n.startsWith('coverart')) return 4;
    if (n.startsWith('cover')) return 5;
    return 10;
  };
  images.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return path.join(albumDir, images[0]);
}

function hasEmbeddedArt(file) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }
    ).trim();
    return Boolean(out);
  } catch {
    return false;
  }
}

function extractArt(file, destination) {
  try {
    execFileSync(
      'ffmpeg',
      ['-v', 'error', '-y', '-i', file, '-map', '0:v:0', '-frames:v', '1', '-q:v', '2', destination],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 }
    );
    return fs.existsSync(destination) && fs.statSync(destination).size > 0;
  } catch {
    return false;
  }
}

function makeWebp(source, destination, width, quality) {
  if (!FORCE && fs.existsSync(destination) && fs.statSync(destination).size > 0) return true;
  try {
    execFileSync(
      'ffmpeg',
      [
        '-v', 'error', '-y', '-i', source,
        '-vf', `scale='min(${width},iw)':-2:flags=lanczos`,
        '-frames:v', '1',
        '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6',
        '-an', destination,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 90000 }
    );
    return fs.existsSync(destination) && fs.statSync(destination).size > 0;
  } catch (error) {
    console.warn(`  ! webp failed for ${rel(source)}: ${String(error.stderr || error.message).split('\n')[0]}`);
    return false;
  }
}

function buildIndex() {
  const eras = fs.readdirSync(MUSIC, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

  const eraMap = new Map();
  const albums = [];
  for (const eraDir of eras) {
    const eraPath = path.join(MUSIC, eraDir);
    const key = normEra(eraDir);
    if (!eraMap.has(key)) eraMap.set(key, eraDir);
    const albumDirs = fs.readdirSync(eraPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    for (const albumDir of albumDirs) {
      const absolute = path.join(eraPath, albumDir);
      albums.push({ eraDir, albumDir, absolute, rel: rel(absolute) });
    }
  }
  return { eras, eraMap, albums };
}

function resolveAlbumDir(album, index) {
  const coverParts = album.cover ? album.cover.split('/') : [];
  const expectedFolder = coverParts.length >= 3 ? coverParts[2] : album.title;
  const eraKey = normEra(album.era);
  const eraDir = index.eraMap.get(eraKey);

  if (eraDir) {
    const eraAlbums = index.albums.filter(a => a.eraDir === eraDir);
    const wantedKeys = [...new Set(
      [expectedFolder, album.title].flatMap(wanted => {
        const key = norm(wanted);
        return [
          key,
          key.replace(/\bcollege\b/g, 'collage'),
          norm(repairMojibake(wanted)),
        ];
      })
    )];

    for (const key of wantedKeys) {
      const hit = eraAlbums.find(a => norm(a.albumDir) === key);
      if (hit) return hit;
    }

    // Near-identical folder names ("Collage" vs "College", "Deluxe´s" vs
    // "Deluxes") get a fuzzy pass. Score each folder once, then require a
    // clear winner so "Disc 1" cannot grab "Disc 2".
    const scored = eraAlbums
      .map(candidate => ({
        candidate,
        score: Math.max(...wantedKeys.map(key => dice(norm(candidate.albumDir), key))),
      }))
      .sort((a, b) => b.score - a.score);
    if (
      scored[0] &&
      scored[0].score >= 0.9 &&
      (!scored[1] || scored[0].score - scored[1].score >= 0.02)
    ) {
      return scored[0].candidate;
    }
  }

  // The era folder may be named differently (or missing). Look everywhere.
  const global = index.albums.filter(a =>
    [expectedFolder, album.title].some(wanted => {
      const key = norm(wanted);
      return norm(a.albumDir) === key || norm(repairMojibake(a.albumDir)) === norm(repairMojibake(wanted));
    })
  );
  if (global.length === 1) return global[0];
  if (global.length > 1) {
    const scored = global
      .map(candidate => ({
        candidate,
        score: dice(normEra(candidate.eraDir), eraKey),
      }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score >= 0.45) return scored[0].candidate;
  }
  return null;
}

function resolveTracks(album, albumDir) {
  const files = listDir(albumDir.absolute);
  const audio = files.filter(name => AUDIO_EXT.has(extOf(name)));
  const used = new Set();
  const resolved = [];
  const missing = [];

  const exact = new Map(audio.map(name => [name, name]));
  const exactLower = new Map(audio.map(name => [name.toLowerCase(), name]));
  const byKey = new Map();
  for (const name of audio) {
    const key = trackKey(name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(name);
  }

  for (const track of album.tracks) {
    const catalogName = path.basename(track.file);
    let match = exact.get(catalogName);
    if (!match) match = exact.get(repairMojibake(catalogName));
    if (!match) match = exactLower.get(catalogName.toLowerCase());
    if (!match) match = exactLower.get(repairMojibake(catalogName).toLowerCase());
    if (!match) {
      const key = trackKey(catalogName);
      const candidates = (byKey.get(key) || []).filter(name => !used.has(name));
      if (candidates.length) match = candidates[0];
    }
    if (!match) {
      // Last resort: a close normalized title with the same leading number.
      const key = trackKey(catalogName);
      const number = leadingNumber(stripAudioExt(catalogName));
      let best = null;
      let bestScore = 0;
      let second = 0;
      for (const name of audio) {
        if (used.has(name)) continue;
        const candidateKey = trackKey(name);
        let score = dice(key, candidateKey);
        if (number && leadingNumber(stripAudioExt(name)) === number) score += 0.08;
        if (score > bestScore) {
          second = bestScore;
          bestScore = score;
          best = name;
        } else if (score > second) {
          second = score;
        }
      }
      if (best && bestScore >= 0.88 && bestScore - second >= 0.03) match = best;
    }

    if (match && !used.has(match)) {
      used.add(match);
      resolved.push({ title: track.title, file: rel(path.join(albumDir.absolute, match)), ok: true });
    } else {
      missing.push({ title: track.title, file: track.file });
      resolved.push({ title: track.title, file: track.file, ok: false });
    }
  }
  return { resolved, missing, audio };
}

function main() {
  if (!fs.existsSync(MUSIC)) throw new Error(`missing music directory: ${MUSIC}`);
  if (!DRY && !fs.existsSync(ART)) fs.mkdirSync(ART, { recursive: true });

  const catalog = readCatalog();
  const index = buildIndex();
  const missingAlbums = [];
  const missingTracks = [];
  const output = [];
  const stats = {
    albums: catalog.length,
    tracks: 0,
    resolvedAlbums: 0,
    resolvedTracks: 0,
    realCovers: 0,
    extractedCovers: 0,
    generatedCovers: 0,
    webp: 0,
  };

  const erasInOrder = [];
  for (const album of catalog) {
    if (!erasInOrder.includes(album.era)) erasInOrder.push(album.era);
  }

  console.log(`Catalog: ${catalog.length} projects, ${catalog.reduce((n, a) => n + a.tracks.length, 0)} recordings`);
  console.log(`Disk:    ${index.eras.length} era folders, ${index.albums.length} project folders`);
  console.log('');

  catalog.forEach((album, position) => {
    stats.tracks += album.tracks.length;
    const folder = resolveAlbumDir(album, index);
    let tracks = album.tracks;
    let trackStats = { resolved: [], missing: [], audio: [] };

    if (folder) {
      stats.resolvedAlbums++;
      trackStats = resolveTracks(album, folder);
      tracks = trackStats.resolved;
      for (const missing of trackStats.missing) {
        missingTracks.push([position, missing.title]);
      }
      stats.resolvedTracks += tracks.length - trackStats.missing.length;
    } else {
      for (const track of album.tracks) missingTracks.push([position, track.title]);
      tracks = album.tracks.map(track => ({ title: track.title, file: track.file, ok: false }));
      missingAlbums.push({ id: album.id, title: album.title, era: album.era });
    }

    const available = folder ? tracks.length - trackStats.missing.length : 0;
    const coverSource = folder ? pickCoverFile(folder.absolute, album.cover) : null;

    let cover = coverSource ? rel(coverSource) : '';
    let thumb = '';
    let art = '';

    if (coverSource) {
      stats.realCovers++;
      if (!DRY) {
        const stem = String(position).padStart(3, '0');
        const thumbAbs = path.join(ART, `${stem}-thumb.webp`);
        const artAbs = path.join(ART, `${stem}-full.webp`);
        const okThumb = makeWebp(coverSource, thumbAbs, 480, 76);
        const okArt = makeWebp(coverSource, artAbs, 960, 80);
        if (okThumb && okArt) {
          thumb = rel(thumbAbs);
          art = rel(artAbs);
          stats.webp += 2;
        }
      }
    } else if (folder && trackStats.audio.length) {
      // No sleeve on disk: try the artwork baked into the first audio file.
      const embedded = trackStats.audio.find(name => hasEmbeddedArt(path.join(folder.absolute, name)));
      if (embedded) {
        const stem = String(position).padStart(3, '0');
        const sourceAbs = path.join(ART, `${stem}-source.jpg`);
        const extracted = DRY || extractArt(path.join(folder.absolute, embedded), sourceAbs);
        if (extracted) {
          stats.extractedCovers++;
          cover = rel(sourceAbs);
          if (!DRY) {
            const thumbAbs = path.join(ART, `${stem}-thumb.webp`);
            const artAbs = path.join(ART, `${stem}-full.webp`);
            const okThumb = makeWebp(sourceAbs, thumbAbs, 480, 76);
            const okArt = makeWebp(sourceAbs, artAbs, 960, 80);
            if (okThumb && okArt) {
              thumb = rel(thumbAbs);
              art = rel(artAbs);
              stats.webp += 2;
            }
          }
        }
      }
    }

    if (!cover) stats.generatedCovers++;

    const eraIndex = erasInOrder.indexOf(album.era);
    const accent = !album.accent || /^#(?:111|111111|000|000000)$/i.test(album.accent)
      ? ERA_TINTS[eraIndex % ERA_TINTS.length]
      : album.accent;

    output.push({
      i: position,
      id: album.id,
      title: album.title,
      era: album.era,
      eraIndex,
      year: album.year,
      accent,
      notes: album.notes,
      cover,
      thumb,
      art,
      available,
      offline: available === 0,
      partial: available > 0 && available < tracks.length,
      tracks,
    });

    if (folder) {
      const mark = trackStats.missing.length ? `${tracks.length - trackStats.missing.length}/${tracks.length}` : `${tracks.length}`;
      console.log(`  ${String(position + 1).padStart(3, '0')}  ${mark.padStart(7)}  ${album.era} / ${album.title}`);
    } else {
      console.log(`  ${String(position + 1).padStart(3, '0')}  MISSING  ${album.era} / ${album.title}`);
    }
  });

  if (DRY) {
    console.log('');
    console.log('Dry run — nothing written.');
  } else {
    const header = '/* Generated by tools/sync-catalog.js. Re-run that script after changing files. */\n';
    const payload =
      `${header}window.YE_ARCHIVE_DATABASE=${JSON.stringify(output)};\n` +
      `window.YE_ARCHIVE_MISSING=${JSON.stringify({ albums: missingAlbums, tracks: missingTracks })};\n`;
    fs.writeFileSync(CATALOG, payload);
    console.log('');
    console.log(`Wrote catalog.js (${(Buffer.byteLength(payload) / 1024).toFixed(0)} KB)`);
    console.log(`Wrote ${stats.webp} webp files to assets/art`);
  }

  console.log('');
  console.log('Summary');
  console.log(`  projects resolved:  ${stats.resolvedAlbums}/${stats.albums}`);
  console.log(`  recordings found:   ${stats.resolvedTracks}/${stats.tracks}`);
  console.log(`  sleeve on disk:     ${stats.realCovers}`);
  console.log(`  art from audio:     ${stats.extractedCovers}`);
  console.log(`  generated artwork:  ${stats.generatedCovers}`);
  console.log(`  unavailable tracks: ${missingTracks.length}`);
  if (missingAlbums.length) {
    console.log('');
    console.log('Projects with no files in this copy:');
    for (const album of missingAlbums) console.log(`  - ${album.era} / ${album.title}`);
  }
}

if (require.main === module) main();

module.exports = {
  norm,
  normEra,
  dice,
  trackKey,
  buildIndex,
  resolveAlbumDir,
  resolveTracks,
  readCatalog,
};
