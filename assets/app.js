/* =========================================================
   YE-ARCHIVE · application
   Static, dependency-free. Everything is read from catalog.js.
   Local assets are addressed directly (no fetch) so the archive
   also works when index.html is opened from disk.
   ========================================================= */
(function () {
  'use strict';

  var DB = Array.isArray(window.YE_ARCHIVE_DATABASE) ? window.YE_ARCHIVE_DATABASE : [];
  var MISSING = window.YE_ARCHIVE_MISSING || { albums: [], tracks: [] };
  var ALBUM_BY_I = new Map();
  var TRACK_BY_FILE = new Map();
  var PLAYABLE = [];
  var ERAS = [];

  DB.forEach(function (album) {
    ALBUM_BY_I.set(album.i, album);
    album.tracks.forEach(function (track, ti) {
      if (track.ok) {
        var ref = { i: album.i, ti: ti };
        PLAYABLE.push(ref);
        if (track.file) TRACK_BY_FILE.set(track.file, ref);
      }
    });
  });

  (function buildEras() {
    var map = new Map();
    DB.forEach(function (album) {
      var group = map.get(album.era);
      if (!group) {
        group = {
          name: album.era,
          index: album.eraIndex || 0,
          accent: album.accent || '#2730d8',
          albums: [],
          available: 0,
          total: 0
        };
        map.set(album.era, group);
      }
      group.albums.push(album);
      group.available += album.available || 0;
      group.total += album.tracks.length;
    });
    ERAS = Array.from(map.values()).sort(function (a, b) {
      return a.index - b.index || a.name.localeCompare(b.name);
    });
    ERAS.forEach(function (group) {
      group.albums.sort(function (a, b) {
        return String(a.title).localeCompare(String(b.title), undefined, { numeric: true });
      });
    });
  })();

  /* ---------------------------------------------------------
     Small utilities
     --------------------------------------------------------- */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }
  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }
  function id(value) {
    return document.getElementById(value);
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function encodePath(path) {
    return String(path || '').split('/').map(encodeURIComponent).join('/');
  }
  function icon(name, className) {
    return '<svg class="' + (className || 'i') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function shuffle(array) {
    var copy = array.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var swap = copy[i];
      copy[i] = copy[j];
      copy[j] = swap;
    }
    return copy;
  }
  function pad2(value) {
    return String(value).padStart(2, '0');
  }
  function formatCount(value) {
    return Number(value || 0).toLocaleString('en-US');
  }
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    var total = Math.floor(seconds);
    var minutes = Math.floor(total / 60);
    var remainder = total % 60;
    if (minutes >= 60) {
      var hours = Math.floor(minutes / 60);
      return hours + ':' + pad2(minutes % 60) + ':' + pad2(remainder);
    }
    return minutes + ':' + pad2(remainder);
  }
  function relativeTime(timestamp) {
    if (!timestamp) return '';
    var difference = Date.now() - timestamp;
    if (difference < 60000) return 'Just now';
    if (difference < 3600000) return Math.floor(difference / 60000) + 'm ago';
    if (difference < 86400000) return Math.floor(difference / 3600000) + 'h ago';
    if (difference < 604800000) return Math.floor(difference / 86400000) + 'd ago';
    try {
      return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (error) {
      return '';
    }
  }
  function debounce(fn, wait) {
    var timer;
    return function () {
      var args = arguments;
      var context = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(context, args); }, wait);
    };
  }
  function initials(title) {
    var words = String(title || '')
      .replace(/[^\p{L}\p{N} ]+/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return 'YE';
    var first = Array.from(words[0])[0] || 'Y';
    var second = words[1] ? Array.from(words[1])[0] : '';
    return (first + second).toUpperCase();
  }
  function albumAt(i) {
    return ALBUM_BY_I.get(Number(i)) || null;
  }
  function refValid(ref) {
    if (!ref || typeof ref.i !== 'number' || typeof ref.ti !== 'number') return false;
    var album = albumAt(ref.i);
    if (!album) return false;
    var track = album.tracks[ref.ti];
    return !!(track && track.ok);
  }
  function refTrack(ref) {
    var album = ref && albumAt(ref.i);
    return album && album.tracks[ref.ti] ? album.tracks[ref.ti] : null;
  }
  function refAlbum(ref) {
    return ref ? albumAt(ref.i) : null;
  }
  function safePlayableForAlbum(album) {
    var list = [];
    if (!album) return list;
    album.tracks.forEach(function (track, ti) {
      if (track.ok) list.push({ i: album.i, ti: ti });
    });
    return list;
  }
  function albumAccent(album) {
    return (album && album.accent) || '#2730d8';
  }
  function artworkHTML(album, options) {
    options = options || {};
    if (!album) return '';
    if (album.thumb && !options.generatedOnly) {
      var source = options.full && album.art ? album.art : album.thumb;
      return '<img src="' + esc(encodePath(source)) + '" alt="" ' +
        (options.eager ? 'fetchpriority="high"' : 'loading="lazy"') +
        ' decoding="async">';
    }
    return generatedHTML(album);
  }
  function generatedHTML(album) {
    var accent = albumAccent(album);
    return '<div class="art-gen gen-' + (Math.abs(album.i) % 4) + '" style="--accent:' + esc(accent) + '" aria-hidden="true">' +
      '<span class="gen-initials">' + esc(initials(album.title)) + '</span>' +
      '<span class="gen-mark">No sleeve</span>' +
      '</div>';
  }
  function genreForEra(name) {
    return name.replace(/\s*Era$/i, '');
  }
  function trackName(track) {
    if (!track || !track.title) return 'Untitled recording';
    return String(track.title).replace(/\s+/g, ' ').trim();
  }
  function isReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---------------------------------------------------------
     Storage
     --------------------------------------------------------- */

  var KEYS = {
    settings: 'ye.settings.v2',
    likes: 'ye.likes.v2',
    recent: 'ye.recent.v2',
    queue: 'ye.queue.v2'
  };

  function readStore(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw == null) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }
  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* private mode or file:// restrictions — the archive still works */
    }
  }

  var DEFAULT_SETTINGS = {
    theme: 'system',
    autoplay: true,
    viz: true,
    volume: 0.8,
    muted: false
  };
  var savedSettings = readStore(KEYS.settings, {});
  if (!savedSettings || typeof savedSettings !== 'object') savedSettings = {};

  var settings = {
    theme: ['system', 'light', 'dark'].indexOf(savedSettings.theme) > -1 ? savedSettings.theme : DEFAULT_SETTINGS.theme,
    autoplay: savedSettings.autoplay !== false,
    viz: savedSettings.viz !== false,
    volume: typeof savedSettings.volume === 'number' ? clamp(savedSettings.volume, 0, 1) : DEFAULT_SETTINGS.volume,
    muted: savedSettings.muted === true
  };

  var storedLikes = readStore(KEYS.likes, []);
  var likes = new Set(
    Array.isArray(storedLikes)
      ? storedLikes.filter(function (file) { return typeof file === 'string' && TRACK_BY_FILE.has(file); })
      : []
  );

  var storedRecent = readStore(KEYS.recent, []);
  var recent = (Array.isArray(storedRecent) ? storedRecent : [])
    .filter(function (entry) { return refValid(entry); })
    .slice(0, 100)
    .map(function (entry) {
      return { i: entry.i, ti: entry.ti, at: Number(entry.at) || 0 };
    });

  var storedQueue = readStore(KEYS.queue, null);
  var restoredCurrent = storedQueue && refValid(storedQueue.current) ? storedQueue.current : null;
  var restoredQueue = storedQueue && Array.isArray(storedQueue.queue)
    ? storedQueue.queue.filter(refValid).slice(0, 200)
    : [];

  var state = {
    view: 'collection',
    viewmode: 'shelves',
    era: 'all',
    sort: 'era',
    current: restoredCurrent,
    queue: restoredQueue,
    playing: false,
    sheetCount: 1,
    searchQuery: '',
    searchResults: [],
    searchActive: -1,
    confirmAction: null,
    lastFocused: null,
    audioContext: null,
    analyser: null,
    sourceNode: null,
    frame: 0
  };

  function saveSettings() {
    writeStore(KEYS.settings, settings);
  }
  function saveLikes() {
    writeStore(KEYS.likes, Array.from(likes));
  }
  function saveRecent() {
    writeStore(KEYS.recent, recent.slice(0, 100));
  }
  function saveQueue() {
    writeStore(KEYS.queue, {
      current: state.current,
      queue: state.queue.slice(0, 200)
    });
  }

  /* ---------------------------------------------------------
     DOM handles
     --------------------------------------------------------- */

  var ui = {
    chrome: id('chrome'),
    openSearch: id('openSearch'),
    openSearch2: id('openSearch2'),
    themeToggle: id('themeToggle'),
    openSettings: id('openSettings'),
    contextTitle: id('contextTitle'),
    topbarStat: id('topbarStat'),
    randomBtn: id('randomBtn'),
    eraFilter: id('eraFilter'),
    sortFilter: id('sortFilter'),
    resultCount: id('resultCount'),
    shuffleAll: id('shuffleAll'),
    collectionBody: id('collectionBody'),
    erasGrid: id('erasGrid'),
    playlistGrid: id('playlistGrid'),
    recentSection: id('recentSection'),
    recentList: id('recentList'),
    recentCount: id('recentCount'),
    projectView: id('projectView'),
    projectBack: id('projectBack'),
    projectBackLabel: id('projectBackLabel'),
    projectIndex: id('projectIndex'),
    projectClose: id('projectClose'),
    projectScroll: id('projectScroll'),
    projectInner: id('projectInner'),
    dock: id('dock'),
    dockProgress: id('dockProgress'),
    dockNow: id('dockNow'),
    dockArt: id('dockArt'),
    dockTitle: id('dockTitle'),
    dockMeta: id('dockMeta'),
    dockPrev: id('dockPrev'),
    dockPlay: id('dockPlay'),
    dockNext: id('dockNext'),
    dockCur: id('dockCur'),
    dockRange: id('dockRange'),
    dockDur: id('dockDur'),
    dockLike: id('dockLike'),
    dockQueue: id('dockQueue'),
    queueBadge: id('queueBadge'),
    dockMute: id('dockMute'),
    volumeRange: id('volumeRange'),
    dockExpand: id('dockExpand'),
    idleSearch: id('idleSearch'),
    idleQueue: id('idleQueue'),
    fullPlayer: id('fullPlayer'),
    fullBg: id('fullBg'),
    viz: id('viz'),
    fullClose: id('fullClose'),
    fullVinyl: id('fullVinyl'),
    fullSleeve: id('fullSleeve'),
    fullEra: id('fullEra'),
    fullTitle: id('fullTitle'),
    fullAlbum: id('fullAlbum'),
    fullRange: id('fullRange'),
    fullCur: id('fullCur'),
    fullDur: id('fullDur'),
    fullPrev: id('fullPrev'),
    fullPlay: id('fullPlay'),
    fullNext: id('fullNext'),
    fullLike: id('fullLike'),
    fullQueue: id('fullQueue'),
    fullVolume: id('fullVolume'),
    fullViz: id('fullViz'),
    fullProject: id('fullProject'),
    searchSheet: id('searchSheet'),
    searchInput: id('searchInput'),
    searchResults: id('searchResults'),
    queueScrim: id('queueScrim'),
    queueSheet: id('queueSheet'),
    queueClose: id('queueClose'),
    queueBody: id('queueBody'),
    queueMeta: id('queueMeta'),
    queueClear: id('queueClear'),
    queuePlay: id('queuePlay'),
    settingsSheet: id('settingsSheet'),
    settingsClose: id('settingsClose'),
    themePicker: id('themePicker'),
    autoplayToggle: id('autoplayToggle'),
    vizToggle: id('vizToggle'),
    clearLikes: id('clearLikes'),
    clearRecent: id('clearRecent'),
    confirmSheet: id('confirmSheet'),
    confirmTitle: id('confirmTitle'),
    confirmText: id('confirmText'),
    confirmCancel: id('confirmCancel'),
    confirmOk: id('confirmOk'),
    toast: id('toast'),
    audio: id('audio'),
    heroCount: id('heroCount'),
    heroSearch: id('heroSearch'),
    heroShuffle: id('heroShuffle'),
    contactSheet: id('contactSheet'),
    sheetLabel: id('sheetLabel'),
    sheetRefresh: id('sheetRefresh'),
    viewCollection: id('view-collection'),
    viewEras: id('view-eras'),
    viewPlaylists: id('view-playlists'),
    navItems: $$('.nav-item[data-tab]'),
    viewButtons: $$('[data-viewmode]'),
    themeButtons: $$('[data-theme-mode]')
  };

  /* ---------------------------------------------------------
     Theme
     --------------------------------------------------------- */

  var themeMedia = window.matchMedia('(prefers-color-scheme: dark)');

  function effectiveTheme() {
    if (settings.theme === 'dark') return 'dark';
    if (settings.theme === 'light') return 'light';
    return themeMedia.matches ? 'dark' : 'light';
  }

  function applyTheme() {
    var theme = effectiveTheme();
    document.documentElement.dataset.theme = theme;
    var meta = document.getElementById('themeColor');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#101116' : '#e9e4d8');
    if (ui.themeToggle) {
      ui.themeToggle.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
      ui.themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      ui.themeToggle.setAttribute('title', theme === 'dark' ? 'Light theme' : 'Dark theme');
    }
    ui.themeButtons.forEach(function (button) {
      var active = button.dataset.themeMode === settings.theme;
      button.classList.toggle('is-on', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (state.isVizVisible && state.playing) drawVisualizer();
  }

  function setThemeMode(mode) {
    if (['system', 'light', 'dark'].indexOf(mode) === -1) return;
    settings.theme = mode;
    saveSettings();
    applyTheme();
  }

  themeMedia.addEventListener('change', function () {
    if (settings.theme === 'system') applyTheme();
  });

  /* ---------------------------------------------------------
     Layers, focus and scroll locking
     --------------------------------------------------------- */

  var layers = [];

  function openLayer(element, focusTarget, options) {
    if (!element) return;
    options = options || {};
    if (layers.indexOf(element) === -1) {
      element.__yeOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      layers.push(element);
    }
    element.inert = false;
    element.setAttribute('aria-hidden', 'false');
    element.classList.add('is-open');
    document.body.classList.add('is-locked');
    var target = typeof focusTarget === 'string' ? element.querySelector(focusTarget) : focusTarget;
    if (options.ready) options.ready();
    requestAnimationFrame(function () {
      if (target && typeof target.focus === 'function') {
        try { target.focus({ preventScroll: true }); } catch (error) { target.focus(); }
      }
    });
  }

  function closeLayer(element, options) {
    if (!element) return;
    options = options || {};
    var index = layers.indexOf(element);
    if (index > -1) layers.splice(index, 1);
    element.classList.remove('is-open');
    element.setAttribute('aria-hidden', 'true');
    element.inert = true;
    if (!layers.length) document.body.classList.remove('is-locked');
    if (options.ready) options.ready();
    if (options.restore !== false) {
      var opener = element.__yeOpener;
      element.__yeOpener = null;
      if (opener && opener.isConnected) {
        requestAnimationFrame(function () {
          try { opener.focus({ preventScroll: true }); } catch (error) { opener.focus(); }
        });
      }
    }
  }

  function topLayer() {
    return layers.length ? layers[layers.length - 1] : null;
  }

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab' || !layers.length) return;
    var layer = topLayer();
    if (!layer) return;
    var focusable = $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', layer)
      .filter(function (node) {
        return !node.closest('[hidden]') && (node.offsetWidth > 0 || node.offsetHeight > 0 || node === document.activeElement);
      });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });

  /* ---------------------------------------------------------
     Toast and confirm
     --------------------------------------------------------- */

  var toastTimer = 0;

  function toast(message) {
    if (!ui.toast) return;
    ui.toast.textContent = message;
    ui.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      ui.toast.classList.remove('is-on');
    }, 2800);
  }

  function askConfirm(options) {
    state.confirmAction = options && typeof options.onConfirm === 'function' ? options.onConfirm : null;
    ui.confirmTitle.textContent = (options && options.title) || 'Are you sure?';
    ui.confirmText.textContent = (options && options.text) || '';
    ui.confirmOk.textContent = (options && options.confirmLabel) || 'Continue';
    ui.confirmCancel.textContent = (options && options.cancelLabel) || 'Cancel';
    openLayer(ui.confirmSheet, ui.confirmCancel);
  }

  function closeConfirm() {
    closeLayer(ui.confirmSheet);
    state.confirmAction = null;
  }

  /* ---------------------------------------------------------
     Collection rendering
     --------------------------------------------------------- */

  function albumMeta(album) {
    if (album.offline) return 'Not in this copy';
    if (album.partial) return album.available + ' of ' + album.tracks.length + ' recordings';
    return formatCount(album.available) + (album.available === 1 ? ' recording' : ' recordings');
  }

  function albumCardHTML(album) {
    var classes = 'album' + (album.offline ? ' is-offline' : '') + (state.current && state.current.i === album.i ? ' is-current' : '');
    var badge = album.offline ? '<span class="album-badge">Not in this copy</span>' : '';
    return '<article class="' + classes + '">' +
      '<a class="album-link" href="#p-' + esc(album.id) + '" data-album="' + album.i + '" aria-label="Open ' + esc(album.title) + ' — ' + esc(albumMeta(album)) + '">' +
        '<span class="album-art" style="--accent:' + esc(albumAccent(album)) + '">' +
          artworkHTML(album) + badge +
          '<span class="album-play" aria-hidden="true">' + icon('play') + '</span>' +
        '</span>' +
        '<span class="album-cap">' +
          '<span class="album-title">' + esc(album.title) + '</span>' +
          '<span class="album-meta">' + esc(albumMeta(album)) + '</span>' +
        '</span>' +
      '</a>' +
    '</article>';
  }

  function sortAlbums(list) {
    var copy = list.slice();
    if (state.sort === 'az') {
      copy.sort(function (a, b) { return String(a.title).localeCompare(String(b.title), undefined, { numeric: true }); });
    } else if (state.sort === 'tracks') {
      copy.sort(function (a, b) {
        return (b.available - a.available) || String(a.title).localeCompare(String(b.title), undefined, { numeric: true });
      });
    } else {
      copy.sort(function (a, b) { return (a.eraIndex - b.eraIndex) || (a.i - b.i); });
    }
    return copy;
  }

  function filteredAlbums() {
    return DB.filter(function (album) {
      return state.era === 'all' || album.era === state.era;
    });
  }

  function shelfHTML(group, albums) {
    var available = albums.reduce(function (total, album) { return total + (album.available || 0); }, 0);
    return '<section class="era-shelf" style="--accent:' + esc(group.accent) + '" aria-labelledby="shelf-' + esc(group.index) + '">' +
      '<div class="era-shelf-head">' +
        '<div class="era-shelf-heading">' +
          '<span class="era-shelf-mark" aria-hidden="true"></span>' +
          '<h2 class="era-shelf-title" id="shelf-' + esc(group.index) + '">' + esc(group.name) + '</h2>' +
        '</div>' +
        '<span class="era-shelf-meta">' + albums.length + (albums.length === 1 ? ' project' : ' projects') +
          ', ' + formatCount(available) + ' recordings</span>' +
      '</div>' +
      '<div class="album-grid">' + albums.map(albumCardHTML).join('') + '</div>' +
    '</section>';
  }

  function indexRowHTML(album) {
    var classes = 'index-row' + (album.offline ? ' is-offline' : '') + (state.current && state.current.i === album.i ? ' is-current' : '');
    return '<a class="' + classes + '" href="#p-' + esc(album.id) + '" data-album="' + album.i + '">' +
      '<span class="index-art">' + artworkHTML(album) + '</span>' +
      '<span class="index-title">' + esc(album.title) + '</span>' +
      '<span class="index-era">' + esc(album.era) + '</span>' +
      '<span class="index-count">' + (album.offline ? '—' : formatCount(album.available)) + '</span>' +
      '<span class="index-play" aria-hidden="true">' + icon('play') + '</span>' +
    '</a>';
  }

  function emptyHTML(title, text, action) {
    return '<div class="empty">' +
      '<h2 class="empty-title">' + esc(title) + '</h2>' +
      '<p class="empty-text">' + esc(text) + '</p>' +
      (action ? '<p style="margin-top:16px"><button class="btn btn-ghost btn-small" data-clear-filters>Show all eras</button></p>' : '') +
    '</div>';
  }

  function renderCollection() {
    var albums = filteredAlbums();
    var sorted = sortAlbums(albums);
    var html = '';

    if (!albums.length) {
      html = emptyHTML('Nothing in this era.', 'The filter has hidden every project. Clear it to see the whole archive.', true);
    } else if (state.viewmode === 'shelves') {
      var groups = ERAS.map(function (group) {
        var inGroup = albums.filter(function (album) { return album.era === group.name; });
        if (!inGroup.length) return '';
        if (state.sort !== 'era') {
          inGroup = inGroup.slice().sort(function (a, b) {
            if (state.sort === 'az') return String(a.title).localeCompare(String(b.title), undefined, { numeric: true });
            return (b.available - a.available) || String(a.title).localeCompare(String(b.title), undefined, { numeric: true });
          });
        }
        return shelfHTML(group, inGroup);
      }).join('');
      html = groups || emptyHTML('Nothing here yet.', 'This part of the archive is still being catalogued.');
    } else if (state.viewmode === 'wall') {
      var wallTitle = state.era === 'all' ? 'All projects' : state.era;
      html = '<div class="wall-head">' +
          '<h2 class="wall-title">' + esc(wallTitle) + '</h2>' +
          '<span class="era-shelf-meta">' + sorted.length + ' projects</span>' +
        '</div>' +
        '<div class="wall-grid">' + sorted.map(albumCardHTML).join('') + '</div>';
    } else {
      html = '<div class="index-table" role="list">' +
          '<div class="index-head" aria-hidden="true">' +
            '<span></span><span>Project</span><span class="index-era">Era</span><span class="index-count">Recordings</span><span></span>' +
          '</div>' +
          sorted.map(indexRowHTML).join('') +
        '</div>';
    }

    ui.collectionBody.innerHTML = html;
    ui.resultCount.textContent = formatCount(albums.length) + (albums.length === 1 ? ' project' : ' projects');
    updateCurrentMarkers();
  }

  function updateCurrentMarkers() {
    $$('.album', ui.collectionBody).forEach(function (card) {
      var link = $('[data-album]', card);
      card.classList.toggle('is-current', !!(state.current && link && Number(link.dataset.album) === state.current.i));
    });
    $$('.index-row', ui.collectionBody).forEach(function (row) {
      row.classList.toggle('is-current', !!(state.current && Number(row.dataset.album) === state.current.i));
    });
    $$('.track-row', ui.projectInner).forEach(function (row) {
      var playing = !!(state.current && row.dataset.ti !== undefined && row.dataset.album !== undefined &&
        Number(row.dataset.album) === state.current.i && Number(row.dataset.ti) === state.current.ti);
      row.classList.toggle('is-playing', playing);
      var button = $('.track-play', row);
      if (button) {
        button.innerHTML = icon(playing && state.playing ? 'pause' : 'play');
        button.setAttribute('aria-label', playing && state.playing ? 'Pause' : 'Play this recording');
      }
    });
  }

  function setViewMode(mode) {
    if (['shelves', 'wall', 'index'].indexOf(mode) === -1) return;
    state.viewmode = mode;
    ui.viewButtons.forEach(function (button) {
      var active = button.dataset.viewmode === mode;
      button.classList.toggle('is-on', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    renderCollection();
  }

  /* ---------------------------------------------------------
     Eras
     --------------------------------------------------------- */

  function eraCardHTML(group, index) {
    var mini = group.albums.slice(0, 4).map(function (album) {
      return '<span class="era-mini">' + artworkHTML(album) + '</span>';
    }).join('');
    return '<a class="era-card" href="#era-' + esc(group.index) + '" data-era="' + esc(group.name) + '" style="--accent:' + esc(group.accent) + '">' +
      '<span class="era-top">' +
        '<span class="era-index">' + pad2(index + 1) + '</span>' +
        '<span class="era-count">' + group.albums.length + (group.albums.length === 1 ? ' project' : ' projects') + '</span>' +
      '</span>' +
      '<span class="era-name">' + esc(group.name) + '</span>' +
      '<span class="era-meta">' + formatCount(group.available) + ' recordings</span>' +
      '<span class="era-covers">' + mini + '</span>' +
      (group.available === 0 ? '<span class="era-offline">Not in this copy</span>' : '') +
    '</a>';
  }

  function renderEras() {
    ui.erasGrid.innerHTML = ERAS.map(eraCardHTML).join('');
  }

  /* ---------------------------------------------------------
     Playlists
     --------------------------------------------------------- */

  function renderPlaylists() {
    var likedText = likes.size
      ? 'Everything you have marked while listening, in the order you found it.'
      : 'Nothing liked yet. Use the heart in the player to keep a recording here.';
    var recentText = recent.length
      ? 'The last hundred recordings you opened, newest first.'
      : 'Your listening history will appear here after the first play.';

    ui.playlistGrid.innerHTML =
      '<article class="pl-card is-feature" style="--accent:var(--orange)">' +
        '<span class="pl-kicker">A way back in</span>' +
        '<h2 class="pl-title">Shuffle everything.</h2>' +
        '<p class="pl-text">' + formatCount(PLAYABLE.length) + ' playable recordings across ' + ERAS.length + ' eras. Every press builds a new route through the archive.</p>' +
        '<div class="pl-foot">' +
          '<span class="pl-count">' + formatCount(PLAYABLE.length) + ' recordings</span>' +
          '<button class="pl-play" data-playlist="shuffle">' + icon('shuffle') + 'Shuffle</button>' +
        '</div>' +
      '</article>' +
      '<article class="pl-card" style="--accent:var(--blue)">' +
        '<span class="pl-kicker">Saved on this device</span>' +
        '<h2 class="pl-title">Liked recordings</h2>' +
        '<p class="pl-text">' + likedText + '</p>' +
        '<div class="pl-foot">' +
          '<span class="pl-count">' + likes.size + (likes.size === 1 ? ' recording' : ' recordings') + '</span>' +
          '<button class="pl-play" data-playlist="liked">' + icon('play') + 'Play liked</button>' +
        '</div>' +
      '</article>' +
      '<article class="pl-card" style="--accent:var(--orange)">' +
        '<span class="pl-kicker">Picking up where you left off</span>' +
        '<h2 class="pl-title">Recently played</h2>' +
        '<p class="pl-text">' + recentText + '</p>' +
        '<div class="pl-foot">' +
          '<span class="pl-count">' + recent.length + (recent.length === 1 ? ' recording' : ' recordings') + '</span>' +
          '<button class="pl-play" data-playlist="recent">' + icon('play') + 'Play recent</button>' +
        '</div>' +
      '</article>';
  }

  function renderRecentList() {
    if (!recent.length) {
      ui.recentCount.textContent = '';
      ui.recentList.innerHTML = '<p class="recent-empty">Nothing played yet. Start anywhere in the collection.</p>';
      return;
    }
    ui.recentCount.textContent = recent.length + (recent.length === 1 ? ' recording' : ' recordings');
    ui.recentList.innerHTML = recent.slice(0, 20).map(function (entry) {
      var album = refAlbum(entry);
      var track = refTrack(entry);
      if (!album || !track) return '';
      return '<a class="recent-row" href="#r-' + album.i + '-' + entry.ti + '" data-ref="' + album.i + ':' + entry.ti + '">' +
        '<span class="recent-art">' + artworkHTML(album) + '</span>' +
        '<span class="recent-title">' + esc(trackName(track)) + '</span>' +
        '<span class="recent-album">' + esc(album.title) + '</span>' +
        '<span class="recent-when">' + esc(relativeTime(entry.at)) + '</span>' +
        '<span class="recent-play" aria-hidden="true">' + icon('play') + '</span>' +
      '</a>';
    }).join('');
  }

  /* ---------------------------------------------------------
     Contact sheet
     --------------------------------------------------------- */

  function renderContactSheet() {
    if (!ui.contactSheet) return;
    var pool = shuffle(DB);
    var picks = pool.slice(0, 13);
    ui.contactSheet.innerHTML = picks.map(function (album, index) {
      var big = index === 0;
      return '<a class="contact-tile' + (big ? ' is-big' : '') + '" href="#p-' + esc(album.id) + '" data-album="' + album.i + '" aria-label="Open ' + esc(album.title) + '">' +
        artworkHTML(album, { eager: index < 3 }) +
        '<span class="tile-num">' + pad2(index + 1) + '</span>' +
        (big ? '<span class="tile-title">' + esc(album.title) + '</span>' : '') +
      '</a>';
    }).join('');
    ui.sheetLabel.textContent = 'Contact sheet ' + pad2(state.sheetCount);
  }

  /* ---------------------------------------------------------
     Views
     --------------------------------------------------------- */

  function showView(name, options) {
    options = options || {};
    if (['collection', 'eras', 'playlists'].indexOf(name) === -1) return;
    state.view = name;

    ui.viewCollection.hidden = name !== 'collection';
    ui.viewEras.hidden = name !== 'eras';
    ui.viewPlaylists.hidden = name !== 'playlists';

    ui.navItems.forEach(function (button) {
      var active = button.dataset.tab === name;
      button.classList.toggle('is-on', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });

    if (name === 'collection') {
      ui.contextTitle.textContent = 'Collection';
      ui.topbarStat.textContent = formatCount(DB.length) + ' projects, ' + formatCount(PLAYABLE.length) + ' recordings';
    } else if (name === 'eras') {
      ui.contextTitle.textContent = 'Eras';
      ui.topbarStat.textContent = ERAS.length + ' eras, ' + formatCount(DB.length) + ' projects';
      renderEras();
    } else {
      ui.contextTitle.textContent = 'Playlists';
      ui.topbarStat.textContent = 'Saved on this device';
      renderPlaylists();
      renderRecentList();
    }

    document.title = 'YE-ARCHIVE / ' + (name === 'collection' ? 'Collection' : name === 'eras' ? 'Eras' : 'Playlists');
    if (options.scroll !== false) {
      window.scrollTo({ top: 0, behavior: isReducedMotion() ? 'auto' : 'smooth' });
    }
  }

  function populateEraFilter() {
    var options = ['<option value="all">All eras</option>'];
    ERAS.forEach(function (group) {
      options.push('<option value="' + esc(group.name) + '">' + esc(group.name) + '</option>');
    });
    ui.eraFilter.innerHTML = options.join('');
    ui.eraFilter.value = state.era;
  }

  function applyEra(name) {
    var exists = name === 'all' || ERAS.some(function (group) { return group.name === name; });
    state.era = exists ? name : 'all';
    ui.eraFilter.value = state.era;
    showView('collection', { scroll: false });
    renderCollection();
    var toolbar = id('toolbar');
    if (toolbar) {
      var offset = window.matchMedia('(max-width: 1040px)').matches ? 60 : 0;
      var top = toolbar.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: Math.max(0, top), behavior: isReducedMotion() ? 'auto' : 'smooth' });
    }
  }

  /* ---------------------------------------------------------
     Project overlay
     --------------------------------------------------------- */

  function fileLabel(file) {
    var base = String(file || '').split('/').pop() || '';
    return base.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function projectDescription(album, playable) {
    if (album.offline) {
      return 'This project is catalogued, but none of its audio is in this copy of the archive. It stays here so the record of the era remains complete.';
    }
    if (album.partial) {
      var missing = album.tracks.length - playable;
      return playable + ' of ' + album.tracks.length + ' recordings play from this copy. ' +
        (missing === 1 ? 'One file is missing.' : missing + ' files are missing.') +
        ' The rest are kept in the order they circulated.';
    }
    return formatCount(playable) + (playable === 1 ? ' recording' : ' recordings') +
      ' from the ' + album.era + ', kept in the order they circulated.';
  }

  function trackRowHTML(album, track, ti) {
    var playable = !!track.ok;
    var playing = !!(state.current && state.current.i === album.i && state.current.ti === ti);
    var search = (trackName(track) + ' ' + fileLabel(track.file)).toLowerCase();
    var classes = 'track-row' + (playable ? '' : ' is-missing') + (playing ? ' is-playing' : '');
    return '<div class="' + classes + '" data-album="' + album.i + '" data-ti="' + ti + '" data-search="' + esc(search) + '">' +
      '<span class="track-num">' + pad2(ti + 1) + '</span>' +
      '<button class="track-main" type="button" data-track-play="' + ti + '"' + (playable ? '' : ' disabled') +
        ' aria-label="' + (playable ? 'Play ' : 'Unavailable: ') + esc(trackName(track)) + '">' +
        '<span class="track-title">' + esc(trackName(track)) + '</span>' +
        '<span class="track-sub">' + esc(playable ? fileLabel(track.file) : 'File not in this copy') + '</span>' +
      '</button>' +
      '<span class="track-note">' + (playable ? '' : 'Not in this copy') + '</span>' +
      '<span class="track-play" aria-hidden="true">' + icon(playing && state.playing ? 'pause' : 'play') + '</span>' +
      (playable
        ? '<a class="track-dl" href="' + esc(encodePath(track.file)) + '" download="' + esc(String(track.file).split('/').pop() || 'recording') + '" aria-label="Download ' + esc(trackName(track)) + '" title="Download">' + icon('download') + '</a>'
        : '<span class="track-dl" aria-hidden="true"></span>') +
    '</div>';
  }

  function pagerHTML(album, list) {
    var index = list.findIndex(function (item) { return item.i === album.i; });
    if (index === -1) return '';
    var previous = list[index - 1];
    var next = list[index + 1];
    if (!previous && !next) return '';
    var link = function (item, direction) {
      if (!item) return '<span></span>';
      return '<a class="pager-link' + (direction === 'next' ? ' is-next' : '') + '" href="#p-' + esc(item.id) + '" data-pager="' + item.i + '">' +
        icon(direction === 'next' ? 'chevron-right' : 'chevron-left') +
        '<span class="pager-art">' + artworkHTML(item) + '</span>' +
        '<span class="pager-text">' +
          '<span class="pager-kicker">' + (direction === 'next' ? 'Next project' : 'Previous project') + '</span>' +
          '<span class="pager-title">' + esc(item.title) + '</span>' +
        '</span>' +
      '</a>';
    };
    return '<div class="project-pager">' + link(previous, 'previous') + link(next, 'next') + '</div>';
  }

  function renderProject(album) {
    var playableRefs = safePlayableForAlbum(album);
    var playable = playableRefs.length;
    var list = sortAlbums(filteredAlbums());
    var index = list.findIndex(function (item) { return item.i === album.i; });

    var trackMarkup;
    if (!album.tracks.length) {
      trackMarkup = '<p class="track-empty">No recording list survives in this copy of the archive.</p>';
    } else {
      trackMarkup = album.tracks.map(function (track, ti) {
        return trackRowHTML(album, track, ti);
      }).join('');
    }

    var banner = '';
    if (album.offline) {
      banner = '<div class="offline-banner"><div><strong>Not in this copy.</strong> The project is catalogued from the community folder, but the audio is absent here. Nothing below will try to load a missing file.</div></div>';
    } else if (album.partial) {
      var missingCount = album.tracks.length - playable;
      banner = '<div class="offline-banner"><div><strong>' + (missingCount === 1 ? 'One recording is missing.' : missingCount + ' recordings are missing.') + '</strong> The unavailable row is marked rather than hidden, so the track list stays faithful to the source folder.</div></div>';
    }

    var actions = playable
      ? '<button class="btn btn-primary" data-project-action="play">' + icon('play') + 'Play all</button>' +
        '<button class="btn btn-ghost" data-project-action="shuffle">' + icon('shuffle') + 'Shuffle</button>' +
        '<button class="btn btn-ghost" data-project-action="queue">' + icon('queue') + 'Add to queue</button>'
      : '<button class="btn btn-ghost" disabled>' + icon('volume-off') + 'No audio in this copy</button>';

    var filter = album.tracks.length >= 8
      ? '<div class="track-filter">' + icon('search') +
          '<label class="sr-only" for="projectFilter">Find a recording</label>' +
          '<input id="projectFilter" type="search" placeholder="Find a recording" autocomplete="off" spellcheck="false">' +
        '</div>'
      : '';

    var countLabel = playable === album.tracks.length
      ? formatCount(album.tracks.length) + (album.tracks.length === 1 ? ' recording' : ' recordings')
      : playable + ' of ' + album.tracks.length + ' playable';

    ui.projectInner.innerHTML =
      '<div class="project-hero" style="--accent:' + esc(albumAccent(album)) + '">' +
        '<div class="project-cover">' + artworkHTML(album, { full: true, eager: true }) + '</div>' +
        '<div class="project-info">' +
          '<p class="project-kicker">' + esc(album.era) + '</p>' +
          '<h1 class="project-title" id="projectTitle">' + esc(album.title) + '</h1>' +
          '<div class="project-stats">' +
            '<span>' + (album.offline ? 'Not in this copy' : formatCount(playable) + ' playable') + '</span>' +
            '<span>' + formatCount(album.tracks.length) + ' catalogued</span>' +
            '<span>' + esc(album.era) + '</span>' +
          '</div>' +
          '<p class="project-desc">' + esc(projectDescription(album, playable)) + '</p>' +
          '<div class="project-actions">' + actions + '</div>' +
        '</div>' +
      '</div>' +
      banner +
      '<section class="project-tracks" aria-labelledby="tracksTitle">' +
        '<div class="tracks-head">' +
          '<div class="tracks-heading">' +
            '<h2 class="tracks-title" id="tracksTitle">Recordings</h2>' +
            '<span class="tracks-count" id="trackShown">' + esc(countLabel) + '</span>' +
          '</div>' +
          filter +
        '</div>' +
        '<div class="tracklist" id="trackList">' + trackMarkup + '</div>' +
        '<p class="track-empty" id="trackEmpty" hidden>No recording matches that search.</p>' +
      '</section>' +
      pagerHTML(album, list);

    ui.projectIndex.textContent = (index > -1 ? pad2(index + 1) : '—') + ' / ' + pad2(list.length);
    ui.projectBackLabel.textContent = state.view === 'eras' ? 'Eras' : state.view === 'playlists' ? 'Playlists' : 'Collection';
    state.projectAlbum = album.i;
    updateCurrentMarkers();
  }

  function openProject(i, options) {
    options = options || {};
    var album = albumAt(i);
    if (!album) return;
    renderProject(album);
    ui.projectScroll.scrollTop = 0;
    if (!ui.projectView.classList.contains('is-open')) {
      openLayer(ui.projectView, ui.projectClose);
    }
  }

  function closeProject() {
    if (!ui.projectView.classList.contains('is-open')) return;
    closeLayer(ui.projectView);
    state.projectAlbum = null;
  }

  function projectPlayableList(album) {
    return safePlayableForAlbum(album);
  }

  function filterProjectTracks(query) {
    var needle = String(query || '').trim().toLowerCase();
    var rows = $$('.track-row', ui.projectInner);
    var visible = 0;
    rows.forEach(function (row) {
      var match = !needle || (row.dataset.search || '').indexOf(needle) > -1;
      row.hidden = !match;
      if (match) visible += 1;
    });
    var shown = id('trackShown');
    if (shown) {
      var album = albumAt(state.projectAlbum);
      if (album) {
        if (needle) {
          shown.textContent = visible + (visible === 1 ? ' match' : ' matches');
        } else {
          var playable = album.available;
          shown.textContent = playable === album.tracks.length
            ? formatCount(album.tracks.length) + (album.tracks.length === 1 ? ' recording' : ' recordings')
            : playable + ' of ' + album.tracks.length + ' playable';
        }
      }
    }
    var empty = id('trackEmpty');
    if (empty) empty.hidden = visible > 0 || !rows.length;
  }

  /* ---------------------------------------------------------
     Playback
     --------------------------------------------------------- */

  state.history = [];

  function setPlayButton(button, playing) {
    if (!button) return;
    button.innerHTML = icon(playing ? 'pause' : 'play');
    button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    button.setAttribute('aria-pressed', playing ? 'true' : 'false');
  }

  function currentTrack() {
    return state.current ? refTrack(state.current) : null;
  }
  function currentAlbum() {
    return state.current ? refAlbum(state.current) : null;
  }
  function currentFile() {
    var track = currentTrack();
    return track && track.file ? track.file : null;
  }

  function updateProgress() {
    var duration = ui.audio.duration;
    var position = ui.audio.currentTime || 0;
    var fraction = isFinite(duration) && duration > 0 ? clamp(position / duration, 0, 1) : 0;
    var percent = fraction * 100;
    if (ui.dockRange) {
      ui.dockRange.value = String(Math.round(fraction * 1000));
      ui.dockRange.style.setProperty('--p', percent.toFixed(2) + '%');
    }
    if (ui.fullRange) {
      ui.fullRange.value = String(Math.round(fraction * 1000));
      ui.fullRange.style.setProperty('--p', percent.toFixed(2) + '%');
    }
    if (ui.dockProgress) ui.dockProgress.style.width = percent.toFixed(2) + '%';
    if (ui.dockCur) ui.dockCur.textContent = formatTime(position);
    if (ui.fullCur) ui.fullCur.textContent = formatTime(position);
    if (ui.dockDur) ui.dockDur.textContent = formatTime(duration);
    if (ui.fullDur) ui.fullDur.textContent = formatTime(duration);
    if ('mediaSession' in navigator && isFinite(duration) && duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: duration,
          playbackRate: ui.audio.playbackRate || 1,
          position: Math.min(position, duration)
        });
      } catch (error) { /* unsupported */ }
    }
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    var album = currentAlbum();
    var track = currentTrack();
    if (!album || !track) {
      try { navigator.mediaSession.metadata = null; } catch (error) { /* noop */ }
      return;
    }
    var artwork = [];
    var source = album.art || album.thumb;
    if (source) {
      artwork.push({ src: encodePath(source), sizes: '960x960', type: source.indexOf('.webp') > -1 ? 'image/webp' : 'image/jpeg' });
    }
    if (album.thumb) {
      artwork.push({ src: encodePath(album.thumb), sizes: '480x480', type: 'image/webp' });
    }
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: trackName(track),
        artist: 'Ye',
        album: album.title,
        artwork: artwork
      });
    } catch (error) { /* noop */ }
  }

  function updateMediaPlaybackState() {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused'; } catch (error) { /* noop */ }
  }

  function updateLikeUI() {
    var file = currentFile();
    var liked = !!(file && likes.has(file));
    [ui.dockLike, ui.fullLike].forEach(function (button) {
      if (!button) return;
      button.classList.toggle('is-liked', liked);
      button.innerHTML = icon(liked ? 'heart-fill' : 'heart');
      button.setAttribute('aria-pressed', liked ? 'true' : 'false');
      button.setAttribute('aria-label', liked ? 'Remove from liked recordings' : 'Like this recording');
    });
  }

  function updateNowPlayingUI() {
    var album = currentAlbum();
    var track = currentTrack();
    var hasTrack = !!(album && track);

    ui.dock.classList.toggle('is-idle', !hasTrack);
    if (hasTrack) {
      ui.dockTitle.textContent = trackName(track);
      ui.dockMeta.textContent = album.title + ', ' + album.era;
      ui.dockArt.innerHTML = artworkHTML(album);
      ui.dockArt.style.setProperty('--accent', albumAccent(album));
      ui.fullEra.textContent = album.era;
      ui.fullTitle.textContent = trackName(track);
      ui.fullAlbum.textContent = album.title;
      ui.fullSleeve.innerHTML = artworkHTML(album, { full: true, eager: true });
      ui.fullSleeve.style.setProperty('--accent', albumAccent(album));
      ui.fullVinyl.style.setProperty('--accent', albumAccent(album));
      if (album.art || album.thumb) {
        ui.fullBg.style.backgroundImage = 'url("' + encodePath(album.art || album.thumb) + '")';
      } else {
        ui.fullBg.style.backgroundImage = 'linear-gradient(135deg, ' + albumAccent(album) + ', #0b0c11 72%)';
      }
      ui.fullProject.disabled = false;
      document.title = trackName(track) + ' / YE-ARCHIVE';
    } else {
      ui.dockTitle.textContent = 'Nothing playing';
      ui.dockMeta.textContent = 'Choose a recording to begin';
      ui.dockArt.innerHTML = '';
      ui.fullEra.textContent = '';
      ui.fullTitle.textContent = 'Nothing playing';
      ui.fullAlbum.textContent = '';
      ui.fullSleeve.innerHTML = '';
      ui.fullBg.style.backgroundImage = 'none';
      ui.fullProject.disabled = true;
    }

    ui.fullPlayer.style.setProperty('--accent', album ? albumAccent(album) : '#ff4d1c');
    updateLikeUI();
    updateMediaSession();
    updateProgress();
  }

  function updatePlayState() {
    state.playing = !ui.audio.paused && !ui.audio.ended;
    setPlayButton(ui.dockPlay, state.playing);
    setPlayButton(ui.fullPlay, state.playing);
    if (ui.fullVinyl) ui.fullVinyl.classList.toggle('is-spinning', state.playing);
    updateCurrentMarkers();
    updateMediaPlaybackState();
    if (state.isVizVisible) {
      if (state.playing) startVisualizer();
      else stopVisualizer(true);
    }
  }

  function ensureAudioGraph() {
    if (state.audioContext) {
      if (state.audioContext.state === 'suspended') {
        state.audioContext.resume().catch(function () {});
      }
      return;
    }
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      state.audioContext = new AudioContextClass();
      state.sourceNode = state.audioContext.createMediaElementSource(ui.audio);
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 256;
      state.analyser.smoothingTimeConstant = 0.82;
      state.sourceNode.connect(state.analyser);
      state.analyser.connect(state.audioContext.destination);
      if (state.audioContext.state === 'suspended') {
        state.audioContext.resume().catch(function () {});
      }
    } catch (error) {
      state.audioContext = null;
      state.analyser = null;
      state.sourceNode = null;
    }
  }

  function markRecent(ref) {
    if (!refValid(ref)) return;
    var filtered = recent.filter(function (entry) { return !(entry.i === ref.i && entry.ti === ref.ti); });
    filtered.unshift({ i: ref.i, ti: ref.ti, at: Date.now() });
    recent = filtered.slice(0, 100);
    saveRecent();
    if (state.view === 'playlists') {
      renderPlaylists();
      renderRecentList();
    }
  }

  function startRef(ref, options) {
    options = options || {};
    if (!refValid(ref)) {
      toast('That recording is not in this copy.');
      return;
    }
    var track = refTrack(ref);
    if (state.current && (state.current.i !== ref.i || state.current.ti !== ref.ti) && options.history !== false) {
      state.history.push({ i: state.current.i, ti: state.current.ti });
      if (state.history.length > 50) state.history.shift();
    }
    state.current = { i: ref.i, ti: ref.ti };
    ui.audio.src = encodePath(track.file);
    try { ui.audio.load(); } catch (error) { /* noop */ }
    updateNowPlayingUI();
    saveQueue();
    renderQueueBadge();
    if (options.record !== false) markRecent(state.current);
    if (options.autoplay !== false) {
      ensureAudioGraph();
      var promise = ui.audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(function (error) {
          if (error && error.name === 'NotAllowedError') {
            toast('Press play to start this recording.');
          } else if (error && error.name !== 'AbortError') {
            toast('This recording could not be played.');
          }
          updatePlayState();
        });
      }
    } else {
      updatePlayState();
    }
  }

  function playList(list, startIndex, options) {
    options = options || {};
    var clean = (list || []).filter(refValid);
    if (!clean.length) {
      toast('There is nothing playable here yet.');
      return;
    }
    if (options.shuffle) clean = shuffle(clean);
    var start = clamp(Number(startIndex) || 0, 0, clean.length - 1);
    state.queue = clean.slice(start + 1);
    saveQueue();
    startRef(clean[start], { autoplay: true, record: true });
    renderQueue();
  }

  function playAlbum(album, options) {
    options = options || {};
    var list = safePlayableForAlbum(album);
    if (!list.length) {
      toast('No audio from this project is in this copy.');
      return;
    }
    playList(list, 0, { shuffle: !!options.shuffle });
  }

  function playTrackFromAlbum(album, ti) {
    var list = safePlayableForAlbum(album);
    var index = list.findIndex(function (ref) { return ref.ti === ti; });
    if (index === -1) {
      toast('That recording is not in this copy.');
      return;
    }
    if (state.current && state.current.i === album.i && state.current.ti === ti) {
      togglePlay();
      return;
    }
    playList(list, index);
  }

  function togglePlay() {
    if (!state.current || !currentTrack()) {
      if (state.queue.length) {
        nextTrack();
      } else if (PLAYABLE.length) {
        playList(shuffle(PLAYABLE), 0);
      } else {
        toast('The archive has no playable recordings in this copy.');
      }
      return;
    }
    if (ui.audio.paused) {
      ensureAudioGraph();
      var promise = ui.audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(function () { toast('This recording could not be played.'); });
      }
    } else {
      ui.audio.pause();
    }
  }

  function nextTrack() {
    if (!state.queue.length) {
      if (state.current) {
        ui.audio.pause();
        toast('The queue is empty.');
      }
      return;
    }
    var ref = state.queue.shift();
    saveQueue();
    startRef(ref, { autoplay: true, record: true });
    renderQueue();
  }

  function previousTrack() {
    if (!state.current) return;
    if (ui.audio.currentTime > 3) {
      ui.audio.currentTime = 0;
      return;
    }
    if (state.history.length) {
      var ref = state.history.pop();
      if (state.current) state.queue.unshift(state.current);
      startRef(ref, { autoplay: true, record: true, history: false });
      renderQueue();
      return;
    }
    ui.audio.currentTime = 0;
  }

  function seekFraction(fraction) {
    var duration = ui.audio.duration;
    if (!isFinite(duration) || duration <= 0) return;
    ui.audio.currentTime = clamp(fraction, 0, 1) * duration;
    updateProgress();
  }

  function toggleLike() {
    var track = currentTrack();
    if (!track || !track.file) {
      toast('Nothing is playing yet.');
      return;
    }
    if (likes.has(track.file)) {
      likes.delete(track.file);
      toast('Removed from liked recordings.');
    } else {
      likes.add(track.file);
      toast('Saved to liked recordings.');
    }
    saveLikes();
    updateLikeUI();
    if (state.view === 'playlists') {
      renderPlaylists();
      renderRecentList();
    }
  }

  function playPlaylist(kind) {
    if (kind === 'shuffle') {
      playList(shuffle(PLAYABLE), 0);
      return;
    }
    if (kind === 'liked') {
      var likedRefs = Array.from(likes).map(function (file) { return TRACK_BY_FILE.get(file); }).filter(refValid);
      if (!likedRefs.length) {
        toast('Like a recording first and it will appear here.');
        return;
      }
      playList(likedRefs, 0);
      return;
    }
    if (kind === 'recent') {
      var recentRefs = recent.map(function (entry) { return { i: entry.i, ti: entry.ti }; }).filter(refValid);
      if (!recentRefs.length) {
        toast('Nothing in the listening history yet.');
        return;
      }
      playList(recentRefs, 0);
    }
  }

  function playRandom() {
    if (!PLAYABLE.length) {
      toast('The archive has no playable recordings in this copy.');
      return;
    }
    playList(shuffle(PLAYABLE), 0);
  }

  /* ---------------------------------------------------------
     Queue
     --------------------------------------------------------- */

  function renderQueueBadge() {
    if (!ui.queueBadge) return;
    var count = state.queue.length;
    ui.queueBadge.textContent = String(count);
    ui.queueBadge.hidden = count === 0;
  }

  function renderQueue() {
    renderQueueBadge();
    if (!ui.queueSheet.classList.contains('is-open')) return;
    var current = state.current;
    var currentAlbum = refAlbum(current);
    var currentTrack = refTrack(current);
    var html = '';
    var upcoming = state.queue;

    if (current && currentAlbum && currentTrack) {
      html += '<p class="queue-label">Now playing</p>' +
        '<div class="queue-row is-current">' +
          '<span class="queue-art">' + artworkHTML(currentAlbum) + '</span>' +
          '<span class="queue-text"><span class="queue-title">' + esc(trackName(currentTrack)) + '</span>' +
            '<span class="queue-sub">' + esc(currentAlbum.title) + '</span></span>' +
          '<button class="queue-play" data-queue-current aria-label="' + (state.playing ? 'Pause' : 'Play') + '">' + icon(state.playing ? 'pause' : 'play') + '</button>' +
          '<span></span>' +
        '</div>';
    }

    if (upcoming.length) {
      html += '<p class="queue-label">Next up</p>';
      upcoming.slice(0, 100).forEach(function (ref, index) {
        var album = refAlbum(ref);
        var track = refTrack(ref);
        if (!album || !track) return;
        html += '<div class="queue-row" data-qi="' + index + '">' +
          '<span class="queue-art">' + artworkHTML(album) + '</span>' +
          '<span class="queue-text"><span class="queue-title">' + esc(trackName(track)) + '</span>' +
            '<span class="queue-sub">' + esc(album.title) + '</span></span>' +
          '<button class="queue-play" data-queue-play="' + index + '" aria-label="Play ' + esc(trackName(track)) + '">' + icon('play') + '</button>' +
          '<button class="queue-remove" data-queue-remove="' + index + '" aria-label="Remove from queue">' + icon('close') + '</button>' +
        '</div>';
      });
      if (upcoming.length > 100) {
        html += '<p class="queue-more">' + formatCount(upcoming.length - 100) + ' more in the queue.</p>';
      }
    }

    if (!html) {
      html = '<p class="queue-empty">The queue is empty. Play a project or shuffle the archive to fill it.</p>';
    }

    ui.queueBody.innerHTML = html;
    ui.queueMeta.textContent = upcoming.length
      ? formatCount(upcoming.length) + (upcoming.length === 1 ? ' recording waiting' : ' recordings waiting')
      : 'Nothing queued';
    ui.queuePlay.disabled = upcoming.length === 0;
    if (ui.queueClear) ui.queueClear.disabled = upcoming.length === 0;
  }

  function openQueue() {
    if (ui.queueSheet.classList.contains('is-open')) {
      renderQueue();
      ui.queueClose.focus({ preventScroll: true });
      return;
    }
    ui.queueScrim.hidden = false;
    requestAnimationFrame(function () { ui.queueScrim.classList.add('is-on'); });
    openLayer(ui.queueSheet, ui.queueClose);
    renderQueue();
  }

  function closeQueue() {
    if (!ui.queueSheet.classList.contains('is-open')) return;
    closeLayer(ui.queueSheet);
    ui.queueScrim.classList.remove('is-on');
    window.setTimeout(function () {
      if (!ui.queueSheet.classList.contains('is-open')) ui.queueScrim.hidden = true;
    }, 240);
  }

  function playQueueAt(index) {
    var ref = state.queue[index];
    if (!refValid(ref)) {
      state.queue.splice(index, 1);
      saveQueue();
      renderQueue();
      return;
    }
    state.queue = state.queue.slice(index + 1);
    saveQueue();
    startRef(ref, { autoplay: true, record: true });
    renderQueue();
  }

  function addToQueue(refs) {
    var clean = (refs || []).filter(refValid);
    if (!clean.length) {
      toast('There is nothing playable to add.');
      return;
    }
    state.queue = state.queue.concat(clean);
    saveQueue();
    renderQueueBadge();
    renderQueue();
    toast(formatCount(clean.length) + (clean.length === 1 ? ' recording added to the queue.' : ' recordings added to the queue.'));
  }

  /* ---------------------------------------------------------
     Full player and visualizer
     --------------------------------------------------------- */

  function openFullPlayer() {
    if (!state.current) {
      toast('Choose a recording first.');
      return;
    }
    updateNowPlayingUI();
    openLayer(ui.fullPlayer, ui.fullClose);
    state.isVizVisible = true;
    ensureAudioGraph();
    applyVizSetting();
    requestAnimationFrame(function () {
      if (!state.isVizVisible) return;
      if (state.playing) startVisualizer();
      else drawVisualizer();
    });
  }

  function closeFullPlayer() {
    if (!ui.fullPlayer.classList.contains('is-open')) return;
    closeLayer(ui.fullPlayer);
    state.isVizVisible = false;
    stopVisualizer(false);
  }

  function resizeVisualizer() {
    if (!ui.viz) return;
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    var width = ui.viz.clientWidth;
    var height = ui.viz.clientHeight;
    if (!width || !height) return;
    ui.viz.width = Math.round(width * ratio);
    ui.viz.height = Math.round(height * ratio);
  }

  function accentRgb() {
    var album = currentAlbum();
    var accent = album ? albumAccent(album) : '#ff4d1c';
    var match = /^#?([0-9a-f]{6})$/i.exec(accent);
    if (!match) return '255, 77, 28';
    var value = parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255].join(', ');
  }

  function drawVisualizer() {
    if (!ui.viz || !state.analyser || !settings.viz) return;
    var context = ui.viz.getContext('2d');
    if (!context) return;
    var width = ui.viz.width;
    var height = ui.viz.height;
    if (!width || !height) {
      resizeVisualizer();
      width = ui.viz.width;
      height = ui.viz.height;
      if (!width || !height) return;
    }
    context.clearRect(0, 0, width, height);
    var buffer = new Uint8Array(state.analyser.frequencyBinCount);
    state.analyser.getByteFrequencyData(buffer);
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    var centerX = width / 2;
    var centerY = height / 2;
    var radius = Math.min(width, height) * 0.31;
    var bars = 104;
    var rgb = accentRgb();
    var reduced = isReducedMotion();
    context.lineWidth = Math.max(1.2, ratio * 0.9);
    context.lineCap = 'round';
    for (var i = 0; i < bars; i++) {
      var value = buffer[Math.floor((i / bars) * buffer.length * 0.72)] / 255;
      if (reduced) value = value * 0.25;
      var length = (6 + value * 46) * ratio;
      var angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      var inner = radius * ratio;
      var x1 = centerX + Math.cos(angle) * inner;
      var y1 = centerY + Math.sin(angle) * inner;
      var x2 = centerX + Math.cos(angle) * (inner + length);
      var y2 = centerY + Math.sin(angle) * (inner + length);
      context.strokeStyle = 'rgba(' + rgb + ', ' + (0.12 + value * 0.6).toFixed(3) + ')';
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    }
  }

  function startVisualizer() {
    stopVisualizer(false);
    if (!state.isVizVisible || !settings.viz || !state.analyser || isReducedMotion()) {
      drawVisualizer();
      return;
    }
    resizeVisualizer();
    var frame = function () {
      drawVisualizer();
      state.frame = window.requestAnimationFrame(frame);
    };
    state.frame = window.requestAnimationFrame(frame);
  }

  function stopVisualizer(redraw) {
    if (state.frame) {
      window.cancelAnimationFrame(state.frame);
      state.frame = 0;
    }
    if (redraw) drawVisualizer();
  }

  function applyVizSetting() {
    if (ui.viz) ui.viz.classList.toggle('is-off', !settings.viz);
    if (ui.fullViz) ui.fullViz.setAttribute('aria-pressed', settings.viz ? 'true' : 'false');
    if (ui.vizToggle) ui.vizToggle.checked = settings.viz;
    if (!settings.viz) stopVisualizer(false);
    else if (state.isVizVisible) {
      if (state.playing) startVisualizer();
      else drawVisualizer();
    }
  }

  /* ---------------------------------------------------------
     Volume
     --------------------------------------------------------- */

  function updateVolumeUI() {
    var percent = Math.round((settings.muted ? 0 : settings.volume) * 100);
    if (ui.volumeRange) {
      ui.volumeRange.value = String(percent);
      ui.volumeRange.style.setProperty('--p', percent + '%');
    }
    if (ui.fullVolume) {
      ui.fullVolume.value = String(percent);
      ui.fullVolume.style.setProperty('--p', percent + '%');
    }
    if (ui.dockMute) {
      ui.dockMute.innerHTML = icon(settings.muted || settings.volume === 0 ? 'volume-off' : 'volume');
      ui.dockMute.setAttribute('aria-label', settings.muted || settings.volume === 0 ? 'Unmute' : 'Mute');
    }
  }

  function setVolume(value, fromUser) {
    settings.volume = clamp(Number(value) / 100, 0, 1);
    if (fromUser && settings.volume > 0) settings.muted = false;
    ui.audio.volume = settings.volume;
    ui.audio.muted = settings.muted;
    updateVolumeUI();
  }

  function toggleMute() {
    settings.muted = !settings.muted;
    ui.audio.muted = settings.muted;
    saveSettings();
    updateVolumeUI();
  }

  /* ---------------------------------------------------------
     Search
     --------------------------------------------------------- */

  var SEARCH_ALBUMS = [];
  var SEARCH_TRACKS = [];
  var SEARCH_SUGGESTIONS = ['Yeezus', 'The Life of Pablo', 'Vultures', 'Graduation', '808s & Heartbreak', 'Donda'];

  function normalise(value) {
    var text = String(value == null ? '' : value);
    try {
      text = text.normalize('NFD').split('').filter(function (character) {
        var code = character.charCodeAt(0);
        return code < 0x0300 || code > 0x036f;
      }).join('');
    } catch (error) { /* older engine */ }
    return text.toLowerCase();
  }

  function buildSearchIndex() {
    SEARCH_ALBUMS = DB.map(function (album) {
      return {
        album: album,
        titleNorm: normalise(album.title),
        haystack: normalise(album.title + ' ' + album.era + ' ' + (album.notes || ''))
      };
    });
    SEARCH_TRACKS = [];
    DB.forEach(function (album) {
      album.tracks.forEach(function (track, ti) {
        SEARCH_TRACKS.push({
          i: album.i,
          ti: ti,
          album: album,
          track: track,
          ok: !!track.ok,
          title: trackName(track),
          titleNorm: normalise(trackName(track)),
          albumNorm: normalise(album.title + ' ' + album.era),
          haystack: normalise(trackName(track) + ' ' + fileLabel(track.file) + ' ' + album.title + ' ' + album.era)
        });
      });
    });
  }

  function searchResultsFor(query) {
    var needle = normalise(query).trim();
    if (!needle) return { albums: [], tracks: [] };
    var tokens = needle.split(/\s+/).filter(Boolean);
    var includesAll = function (haystack) {
      for (var i = 0; i < tokens.length; i++) {
        if (haystack.indexOf(tokens[i]) === -1) return false;
      }
      return true;
    };

    var albums = SEARCH_ALBUMS.filter(function (entry) { return includesAll(entry.haystack); });
    albums.forEach(function (entry) {
      entry._score = entry.titleNorm === needle ? 5 : entry.titleNorm.indexOf(needle) === 0 ? 4 : entry.titleNorm.indexOf(needle) > -1 ? 3 : 2;
    });
    albums.sort(function (a, b) {
      return b._score - a._score || a.album.title.localeCompare(b.album.title, undefined, { numeric: true });
    });

    var tracks = SEARCH_TRACKS.filter(function (entry) { return includesAll(entry.haystack); });
    tracks.forEach(function (entry) {
      entry._score = entry.titleNorm === needle ? 6
        : entry.titleNorm.indexOf(needle) === 0 ? 5
        : entry.titleNorm.indexOf(needle) > -1 ? 4
        : entry.albumNorm.indexOf(needle) === 0 ? 3 : 2;
    });
    tracks.sort(function (a, b) {
      return b._score - a._score ||
        a.title.localeCompare(b.title, undefined, { numeric: true }) ||
        a.album.title.localeCompare(b.album.title, undefined, { numeric: true }) ||
        a.ti - b.ti;
    });

    return { albums: albums.slice(0, 6), tracks: tracks.slice(0, 30) };
  }

  function searchSuggestionHTML() {
    return '<div class="search-suggest" role="presentation">' +
      SEARCH_SUGGESTIONS.map(function (query) {
        return '<button type="button" data-search-query="' + esc(query) + '">' + esc(query) + '</button>';
      }).join('') +
    '</div>';
  }

  function searchEmptyHTML(title, text) {
    return '<div class="search-empty" role="presentation">' +
      '<p class="search-empty-title">' + esc(title) + '</p>' +
      '<p class="search-empty-text">' + esc(text) + '</p>' +
    '</div>';
  }

  function searchAlbumRow(album, index) {
    return '<button type="button" role="option" id="search-option-' + index + '" class="search-row" aria-selected="false" data-result-index="' + index + '">' +
      '<span class="search-art">' + artworkHTML(album) + '</span>' +
      '<span class="search-text">' +
        '<span class="search-title">' + esc(album.title) + '</span>' +
        '<span class="search-sub">' + esc(album.era) + ', ' + esc(albumMeta(album)) + '</span>' +
      '</span>' +
      '<span class="search-kind">Project</span>' +
    '</button>';
  }

  function searchTrackRow(entry, index) {
    return '<button type="button" role="option" id="search-option-' + index + '" class="search-row' + (entry.ok ? '' : ' is-missing') + '" aria-selected="false" data-result-index="' + index + '">' +
      '<span class="search-art">' + artworkHTML(entry.album) + '</span>' +
      '<span class="search-text">' +
        '<span class="search-title">' + esc(entry.title) + '</span>' +
        '<span class="search-sub">' + esc(entry.album.title) + (entry.ok ? '' : ', not in this copy') + '</span>' +
      '</span>' +
      '<span class="search-kind">' + (entry.ok ? 'Recording' : 'Missing') + '</span>' +
    '</button>';
  }

  function renderSearch(rawQuery) {
    var query = String(rawQuery || '').trim();
    state.searchQuery = query;
    state.searchResults = [];
    state.searchActive = -1;

    if (!query) {
      ui.searchResults.innerHTML =
        searchEmptyHTML('Search the whole archive.', 'Every project, era and recording file name is indexed. Start typing, or try one of these.') +
        searchSuggestionHTML();
      ui.searchInput.removeAttribute('aria-activedescendant');
      return;
    }

    var results = searchResultsFor(query);
    var html = '';
    var index = 0;

    if (results.albums.length) {
      html += '<p class="search-group-label" role="presentation">Projects</p>';
      results.albums.forEach(function (entry) {
        state.searchResults.push({ kind: 'album', i: entry.album.i });
        html += searchAlbumRow(entry.album, index);
        index += 1;
      });
    }

    if (results.tracks.length) {
      html += '<p class="search-group-label" role="presentation">Recordings</p>';
      results.tracks.forEach(function (entry) {
        state.searchResults.push({ kind: 'track', i: entry.i, ti: entry.ti, ok: entry.ok });
        html += searchTrackRow(entry, index);
        index += 1;
      });
    }

    if (!state.searchResults.length) {
      html = searchEmptyHTML('No matches for “' + query + '”.', 'Try a project title, an era, or part of a recording file name.') +
        searchSuggestionHTML();
    }

    ui.searchResults.innerHTML = html;
    ui.searchResults.scrollTop = 0;
    if (state.searchResults.length) setSearchActive(0, false);
    else ui.searchInput.removeAttribute('aria-activedescendant');
  }

  function setSearchActive(index, scroll) {
    var rows = $$('.search-row', ui.searchResults);
    if (!rows.length) {
      state.searchActive = -1;
      ui.searchInput.removeAttribute('aria-activedescendant');
      return;
    }
    var length = rows.length;
    state.searchActive = ((Number(index) % length) + length) % length;
    rows.forEach(function (row, rowIndex) {
      row.setAttribute('aria-selected', rowIndex === state.searchActive ? 'true' : 'false');
    });
    var active = rows[state.searchActive];
    ui.searchInput.setAttribute('aria-activedescendant', active.id);
    if (scroll) {
      try { active.scrollIntoView({ block: 'nearest' }); } catch (error) { /* noop */ }
    }
  }

  function openSearch() {
    if (!ui.searchSheet) return;
    if (ui.confirmSheet.classList.contains('is-open')) return;
    if (ui.searchSheet.classList.contains('is-open')) {
      ui.searchInput.focus();
      ui.searchInput.select();
      return;
    }
    if (ui.settingsSheet.classList.contains('is-open')) closeSettings();
    if (ui.queueSheet.classList.contains('is-open')) closeQueue();
    ui.searchInput.value = '';
    renderSearch('');
    openLayer(ui.searchSheet, ui.searchInput);
    ui.searchInput.setAttribute('aria-expanded', 'true');
  }

  function closeSearch() {
    if (!ui.searchSheet.classList.contains('is-open')) return;
    closeLayer(ui.searchSheet);
    ui.searchInput.setAttribute('aria-expanded', 'false');
    state.searchActive = -1;
  }

  function dismissLayersForProject() {
    if (ui.queueSheet.classList.contains('is-open')) closeQueue();
    if (ui.fullPlayer.classList.contains('is-open')) closeFullPlayer();
    if (ui.settingsSheet.classList.contains('is-open')) closeSettings();
  }

  function settleProjectFocus() {
    ui.projectView.__yeOpener = ui.openSearch2 || ui.openSearch || ui.openSettings || null;
    requestAnimationFrame(function () {
      if (!ui.projectView.classList.contains('is-open')) return;
      try { ui.projectClose.focus({ preventScroll: true }); } catch (error) { ui.projectClose.focus(); }
    });
  }

  function openProjectFromSearch(i) {
    closeSearch();
    dismissLayersForProject();
    openProject(i);
    settleProjectFocus();
  }

  function activateSearchResult(result) {
    if (!result) return;
    if (result.kind === 'album') {
      openProjectFromSearch(result.i);
      return;
    }
    var album = albumAt(result.i);
    var track = refTrack(result);
    if (!album || !track) return;
    if (track.ok) {
      closeSearch();
      playTrackFromAlbum(album, result.ti);
      return;
    }
    closeSearch();
    dismissLayersForProject();
    openProject(album.i);
    settleProjectFocus();
    var filter = id('projectFilter');
    if (filter) {
      filter.value = trackName(track);
      filterProjectTracks(trackName(track));
    }
    toast('That recording is not in this copy.');
  }

  /* ---------------------------------------------------------
     Settings and confirmation
     --------------------------------------------------------- */

  function openSettings() {
    if (ui.settingsSheet.classList.contains('is-open')) {
      ui.settingsClose.focus({ preventScroll: true });
      return;
    }
    applyTheme();
    ui.autoplayToggle.checked = settings.autoplay;
    ui.vizToggle.checked = settings.viz;
    openLayer(ui.settingsSheet, ui.settingsClose);
  }

  function closeSettings() {
    if (!ui.settingsSheet.classList.contains('is-open')) return;
    closeLayer(ui.settingsSheet);
  }

  function confirmClearLikes() {
    if (!likes.size) {
      toast('There are no liked recordings to clear.');
      return;
    }
    askConfirm({
      title: 'Clear liked recordings?',
      text: 'This removes every recording you have liked on this device. The queue and listening history stay as they are.',
      confirmLabel: 'Clear likes',
      onConfirm: function () {
        likes.clear();
        saveLikes();
        updateLikeUI();
        if (state.view === 'playlists') renderPlaylists();
        toast('Liked recordings cleared.');
      }
    });
  }

  function confirmClearRecent() {
    if (!recent.length) {
      toast('There is no listening history to clear.');
      return;
    }
    askConfirm({
      title: 'Clear listening history?',
      text: 'This removes the recently played list from this device. Liked recordings and the current queue stay as they are.',
      confirmLabel: 'Clear history',
      onConfirm: function () {
        recent = [];
        saveRecent();
        if (state.view === 'playlists') {
          renderPlaylists();
          renderRecentList();
        }
        toast('Listening history cleared.');
      }
    });
  }

  /* ---------------------------------------------------------
     Media session
     --------------------------------------------------------- */

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    var handlers = {
      play: function () {
        if (!state.current) return;
        ensureAudioGraph();
        var promise = ui.audio.play();
        if (promise && typeof promise.catch === 'function') promise.catch(function () {});
      },
      pause: function () { ui.audio.pause(); },
      previoustrack: previousTrack,
      nexttrack: nextTrack,
      stop: function () { ui.audio.pause(); ui.audio.currentTime = 0; }
    };
    Object.keys(handlers).forEach(function (name) {
      try { navigator.mediaSession.setActionHandler(name, handlers[name]); } catch (error) { /* unsupported */ }
    });
    try {
      navigator.mediaSession.setActionHandler('seekto', function (details) {
        if (details && typeof details.seekTime === 'number' && isFinite(details.seekTime)) {
          ui.audio.currentTime = details.seekTime;
        }
      });
    } catch (error) { /* unsupported */ }
    try {
      navigator.mediaSession.setActionHandler('seekbackward', function () {
        ui.audio.currentTime = Math.max(0, ui.audio.currentTime - 10);
      });
      navigator.mediaSession.setActionHandler('seekforward', function () {
        if (isFinite(ui.audio.duration)) ui.audio.currentTime = Math.min(ui.audio.duration, ui.audio.currentTime + 10);
      });
    } catch (error) { /* unsupported */ }
  }

  /* ---------------------------------------------------------
     Event wiring
     --------------------------------------------------------- */

  function on(element, type, handler, options) {
    if (element) element.addEventListener(type, handler, options);
  }
  function closest(target, selector) {
    return target && target.closest ? target.closest(selector) : null;
  }

  function closeTopLayerOnEscape() {
    var layer = topLayer();
    if (!layer) return false;
    if (layer === ui.confirmSheet) closeConfirm();
    else if (layer === ui.searchSheet) closeSearch();
    else if (layer === ui.queueSheet) closeQueue();
    else if (layer === ui.fullPlayer) closeFullPlayer();
    else if (layer === ui.settingsSheet) closeSettings();
    else if (layer === ui.projectView) closeProject();
    else closeLayer(layer);
    return true;
  }

  function bindEvents() {
    $$('[data-tab]').forEach(function (button) {
      on(button, 'click', function (event) {
        event.preventDefault();
        showView(button.dataset.tab);
      });
    });

    on(ui.openSearch, 'click', openSearch);
    on(ui.openSearch2, 'click', openSearch);
    on(ui.heroSearch, 'click', openSearch);
    on(ui.idleSearch, 'click', openSearch);
    on(ui.heroShuffle, 'click', playRandom);
    on(ui.randomBtn, 'click', playRandom);
    on(ui.shuffleAll, 'click', playRandom);
    on(ui.themeToggle, 'click', function () {
      setThemeMode(effectiveTheme() === 'dark' ? 'light' : 'dark');
    });
    on(ui.openSettings, 'click', openSettings);
    on(ui.settingsClose, 'click', closeSettings);
    on(ui.sheetRefresh, 'click', function () {
      state.sheetCount += 1;
      renderContactSheet();
    });

    on(ui.eraFilter, 'change', function () { applyEra(ui.eraFilter.value); });
    on(ui.sortFilter, 'change', function () {
      state.sort = ui.sortFilter.value;
      renderCollection();
    });
    ui.viewButtons.forEach(function (button) {
      on(button, 'click', function () { setViewMode(button.dataset.viewmode); });
    });

    on(ui.projectBack, 'click', closeProject);
    on(ui.projectClose, 'click', closeProject);
    on(ui.projectInner, 'input', function (event) {
      if (event.target && event.target.id === 'projectFilter') filterProjectTracks(event.target.value);
    });
    on(ui.projectInner, 'keydown', function (event) {
      if (event.target && event.target.id === 'projectFilter' && event.key === 'Escape' && event.target.value) {
        event.preventDefault();
        event.stopPropagation();
        event.target.value = '';
        filterProjectTracks('');
      }
    });
    on(ui.projectInner, 'click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('.track-dl')) return;

      var pager = target.closest('[data-pager]');
      if (pager) {
        event.preventDefault();
        openProject(Number(pager.dataset.pager));
        requestAnimationFrame(function () {
          try { ui.projectBack.focus({ preventScroll: true }); } catch (error) { ui.projectBack.focus(); }
        });
        return;
      }

      var action = target.closest('[data-project-action]');
      if (action) {
        var album = albumAt(state.projectAlbum);
        if (!album) return;
        var kind = action.dataset.projectAction;
        if (kind === 'play') playAlbum(album);
        else if (kind === 'shuffle') playAlbum(album, { shuffle: true });
        else if (kind === 'queue') addToQueue(projectPlayableList(album));
        return;
      }

      var row = target.closest('.track-row');
      if (!row) return;
      var albumForRow = albumAt(Number(row.dataset.album));
      var ti = Number(row.dataset.ti);
      if (!albumForRow || !albumForRow.tracks[ti]) return;
      if (!albumForRow.tracks[ti].ok) {
        toast('That recording is not in this copy.');
        return;
      }
      playTrackFromAlbum(albumForRow, ti);
    });

    on(ui.dockNow, 'click', openFullPlayer);
    on(ui.dockExpand, 'click', openFullPlayer);
    on(ui.dockPrev, 'click', previousTrack);
    on(ui.dockPlay, 'click', togglePlay);
    on(ui.dockNext, 'click', nextTrack);
    on(ui.dockLike, 'click', toggleLike);
    on(ui.dockQueue, 'click', openQueue);
    on(ui.idleQueue, 'click', openQueue);
    on(ui.dockMute, 'click', toggleMute);
    on(ui.dockRange, 'input', function () { seekFraction(Number(ui.dockRange.value) / 1000); });
    on(ui.volumeRange, 'input', function () { setVolume(ui.volumeRange.value, true); });
    on(ui.volumeRange, 'change', saveSettings);

    on(ui.fullClose, 'click', closeFullPlayer);
    on(ui.fullPrev, 'click', previousTrack);
    on(ui.fullPlay, 'click', togglePlay);
    on(ui.fullNext, 'click', nextTrack);
    on(ui.fullLike, 'click', toggleLike);
    on(ui.fullQueue, 'click', openQueue);
    on(ui.fullRange, 'input', function () { seekFraction(Number(ui.fullRange.value) / 1000); });
    on(ui.fullVolume, 'input', function () { setVolume(ui.fullVolume.value, true); });
    on(ui.fullVolume, 'change', saveSettings);
    on(ui.fullViz, 'click', function () {
      settings.viz = !settings.viz;
      saveSettings();
      applyVizSetting();
    });
    on(ui.fullProject, 'click', function () {
      if (!state.current) return;
      var album = albumAt(state.current.i);
      if (!album) return;
      closeFullPlayer();
      if (ui.queueSheet.classList.contains('is-open')) closeQueue();
      openProject(album.i);
      ui.projectView.__yeOpener = ui.dockNow;
      requestAnimationFrame(function () {
        if (!ui.projectView.classList.contains('is-open')) return;
        try { ui.projectClose.focus({ preventScroll: true }); } catch (error) { ui.projectClose.focus(); }
      });
    });

    on(ui.queueClose, 'click', closeQueue);
    on(ui.queueScrim, 'click', closeQueue);
    on(ui.queuePlay, 'click', nextTrack);
    on(ui.queueClear, 'click', function () {
      state.queue = [];
      saveQueue();
      renderQueue();
      renderQueueBadge();
      toast('Queue cleared.');
    });
    on(ui.queueBody, 'click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('[data-queue-current]')) {
        togglePlay();
        return;
      }
      var remove = target.closest('[data-queue-remove]');
      if (remove) {
        state.queue.splice(Number(remove.dataset.queueRemove), 1);
        saveQueue();
        renderQueue();
        return;
      }
      var play = target.closest('[data-queue-play]');
      if (play) playQueueAt(Number(play.dataset.queuePlay));
    });

    on(ui.searchSheet, 'click', function (event) {
      if (event.target === ui.searchSheet) closeSearch();
    });
    on(ui.searchInput, 'input', function () { renderSearch(ui.searchInput.value); });
    on(ui.searchInput, 'keydown', function (event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSearchActive(state.searchActive + 1, true);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSearchActive(state.searchActive - 1, true);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (!state.searchResults.length) return;
        var index = state.searchActive < 0 ? 0 : state.searchActive;
        activateSearchResult(state.searchResults[index]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
      }
    });
    on(ui.searchResults, 'click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var suggestion = target.closest('[data-search-query]');
      if (suggestion) {
        ui.searchInput.value = suggestion.dataset.searchQuery;
        renderSearch(ui.searchInput.value);
        ui.searchInput.focus();
        return;
      }
      var row = target.closest('[data-result-index]');
      if (!row) return;
      activateSearchResult(state.searchResults[Number(row.dataset.resultIndex)]);
    });
    on(ui.searchResults, 'mouseover', function (event) {
      var row = closest(event.target, '[data-result-index]');
      if (!row) return;
      var index = Number(row.dataset.resultIndex);
      if (index !== state.searchActive) setSearchActive(index, false);
    });

    on(ui.settingsSheet, 'click', function (event) {
      if (event.target === ui.settingsSheet) closeSettings();
    });
    on(ui.autoplayToggle, 'change', function () {
      settings.autoplay = ui.autoplayToggle.checked;
      saveSettings();
      toast(settings.autoplay ? 'Autoplay on.' : 'Autoplay off.');
    });
    on(ui.vizToggle, 'change', function () {
      settings.viz = ui.vizToggle.checked;
      saveSettings();
      applyVizSetting();
    });
    ui.themeButtons.forEach(function (button) {
      on(button, 'click', function () { setThemeMode(button.dataset.themeMode); });
    });
    on(ui.clearLikes, 'click', confirmClearLikes);
    on(ui.clearRecent, 'click', confirmClearRecent);

    on(ui.confirmCancel, 'click', closeConfirm);
    on(ui.confirmOk, 'click', function () {
      var action = state.confirmAction;
      closeConfirm();
      if (action) action();
    });
    on(ui.confirmSheet, 'click', function (event) {
      if (event.target === ui.confirmSheet) closeConfirm();
    });

    document.addEventListener('click', function (event) {
      if (event.defaultPrevented) return;
      var target = event.target;
      if (!target || !target.closest) return;

      var albumLink = target.closest('[data-album]');
      if (albumLink && !albumLink.closest('.track-row')) {
        event.preventDefault();
        openProject(Number(albumLink.dataset.album));
        return;
      }
      var eraLink = target.closest('[data-era]');
      if (eraLink) {
        event.preventDefault();
        applyEra(eraLink.dataset.era);
        return;
      }
      var recentLink = target.closest('[data-ref]');
      if (recentLink) {
        event.preventDefault();
        var parts = String(recentLink.dataset.ref || '').split(':');
        var ref = { i: Number(parts[0]), ti: Number(parts[1]) };
        var album = refAlbum(ref);
        if (album && refValid(ref)) playTrackFromAlbum(album, ref.ti);
        return;
      }
      var playlistButton = target.closest('[data-playlist]');
      if (playlistButton) {
        playPlaylist(playlistButton.dataset.playlist);
        return;
      }
      var clearFilters = target.closest('[data-clear-filters]');
      if (clearFilters) {
        event.preventDefault();
        applyEra('all');
      }
    });

    on(ui.audio, 'timeupdate', updateProgress);
    on(ui.audio, 'durationchange', updateProgress);
    on(ui.audio, 'loadedmetadata', updateProgress);
    on(ui.audio, 'play', updatePlayState);
    on(ui.audio, 'pause', updatePlayState);
    on(ui.audio, 'ended', function () {
      updatePlayState();
      if (settings.autoplay && state.queue.length) nextTrack();
    });
    on(ui.audio, 'error', function () {
      if (!state.current) return;
      toast('This recording could not be read from this copy.');
      updatePlayState();
    });

    document.addEventListener('keydown', function (event) {
      var key = event.key;
      if ((event.metaKey || event.ctrlKey) && String(key).toLowerCase() === 'k') {
        event.preventDefault();
        openSearch();
        return;
      }
      if (key === 'Escape') {
        if (closeTopLayerOnEscape()) event.preventDefault();
        return;
      }
      var target = event.target;
      var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (key === ' ' || key === 'Spacebar' || event.code === 'Space') {
        if (target && target.closest && target.closest('button,a,[role="button"],input,select,textarea')) return;
        event.preventDefault();
        togglePlay();
        return;
      }
      if (key === 'n' || key === 'N') {
        event.preventDefault();
        nextTrack();
        return;
      }
      if (key === 'p' || key === 'P') {
        event.preventDefault();
        previousTrack();
        return;
      }
      if (key === 'l' || key === 'L') {
        event.preventDefault();
        toggleLike();
      }
    });

    window.addEventListener('resize', debounce(function () {
      if (!state.isVizVisible) return;
      if (state.playing) startVisualizer();
      else drawVisualizer();
    }, 160));

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopVisualizer(false);
      else if (state.isVizVisible && state.playing) startVisualizer();
    });

    window.addEventListener('pagehide', saveQueue);
  }

  /* ---------------------------------------------------------
     Start
     --------------------------------------------------------- */

  function init() {
    buildSearchIndex();
    bindEvents();

    if (ui.sortFilter) ui.sortFilter.value = state.sort;
    populateEraFilter();
    renderContactSheet();
    if (DB.length) renderCollection();
    showView('collection', { scroll: false });

    ui.heroCount.textContent = formatCount(DB.length) + ' projects. ' + ERAS.length + ' eras. ' + formatCount(PLAYABLE.length) + ' recordings.';
    if (!DB.length) {
      ui.collectionBody.innerHTML = emptyHTML('The catalogue did not load.', 'catalog.js could not be read. Keep it beside index.html, then reload the page.', false);
      ui.resultCount.textContent = 'No projects';
      ui.topbarStat.textContent = 'Catalogue unavailable';
      ui.heroCount.textContent = 'The catalogue could not be loaded.';
      ui.sheetLabel.textContent = 'Contact sheet unavailable';
    }

    ui.autoplayToggle.checked = settings.autoplay;
    ui.vizToggle.checked = settings.viz;
    applyTheme();
    ui.audio.volume = settings.volume;
    ui.audio.muted = settings.muted;
    updateVolumeUI();
    applyVizSetting();
    setupMediaSession();

    ui.searchInput.setAttribute('role', 'combobox');
    ui.searchInput.setAttribute('aria-controls', 'searchResults');
    ui.searchInput.setAttribute('aria-autocomplete', 'list');
    ui.searchInput.setAttribute('aria-expanded', 'false');

    if (state.current) {
      startRef(state.current, { autoplay: false, record: false, history: false });
    } else {
      updateNowPlayingUI();
    }
    renderQueueBadge();
  }

  try {
    init();
  } catch (error) {
    if (window.console && console.error) console.error('YE-ARCHIVE failed to start:', error);
    toast('The archive could not finish starting. Reload the page to try again.');
  }

})();
