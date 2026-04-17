/*
    Name: player.js | Version: 3.3.0
    Project: Electroscape
    Description: All playback logic for the Electroscape music video gallery.
                 Loads track data from tracks.json, builds the video card grid,
                 and controls the YouTube IFrame API player.
                 Loaded by index.html via <script> at the bottom of <body>.

    Changelog:
        v2.1.0 — Orbital HUD controls and progress tracker added
        v2.9.0 — Grid view controls and localStorage preference saving added
        v3.0.0 — HUD seek (click-to-seek on progress bar) added; end-card guard added
        v3.1.0 — initGridControls refactored to support Option B (bare SVG icons, active)
                  and Option D (single cycling button, commented out). Both options share
                  a common applyGridSize() helper.
        v3.2.0 — New Previous/Next Buttons
        v3.3.1 — Touch drag-to-reorder added to favourites sidebar (Section 4P)
        v3.3.0 — Favourites sidebar added (Section 4P):
                  Heart button on each card, slide-out right sidebar, drag-to-reorder,
                  play-from-sidebar, localStorage persistence under 'electroscape_favourites'.

    Sections:
        4A — Track loader       : Fetches tracks.json, builds the card grid
        4B — Queue builder      : Reads cards from DOM into an ordered playlist array
        4C — Active card        : Highlights the playing card; now-playing click handler
        4D — Play track         : Loads and plays a track by queue index
        4E — YouTube API ready  : IFrame API callback; creates the player instance
        4F — Card clicks        : Attaches click-to-play on each video card
        4G — Prev button        : Steps back one track
        4H — Next button        : Steps forward one track
        4I — Shuffle button     : Randomises card order, rebuilds queue
        4K — End-card guard     : Advances track 7 seconds before YouTube end card
        4L — HUD tracker        : Updates HUD progress bar every 500ms
        4M — HUD seek           : Click-to-seek on the HUD progress bar
        4N — HUD controls       : Wires up HUD Prev / Play-Pause / Next buttons
        4O — Grid view controls : Switches grid density; saves preference to localStorage
        4P — Favourites sidebar : Heart toggles, sidebar open/close, drag-to-reorder,
                                  play-from-list, clear-all, localStorage persistence
        4J — Initialisation     : Entry point — calls loadTracks() and initGridControls()
*/


/* ============================================================ */
/* SECTION 4A: TRACK LOADER                                     */
/* Fetches tracks.json and builds the video card grid.          */
/* Once all cards are in the DOM, builds the queue and wires    */
/* up click events. If the YouTube API loaded first, creates    */
/* the player immediately — otherwise that happens in 4E.       */
/* ============================================================ */
function loadTracks() {
    fetch('tracks.json')
        .then(function(response) {
            if (!response.ok) {
                throw new Error('Could not load tracks.json — status: ' + response.status);
            }
            return response.json();
        })
        .then(function(tracks) {
            var grid = document.getElementById('video-grid');

            tracks.forEach(function(track) {
                /* Thumbnail URL built from the YouTube video ID */
                var thumbUrl = 'https://img.youtube.com/vi/' + track.id + '/maxresdefault.jpg';

                var card = document.createElement('div');
                card.className = 'video';
                card.setAttribute('data-id', track.id);
                card.setAttribute('data-title', track.title);

                card.innerHTML =
                    '<div class="thumb-container" style="background-image: url(\'' + thumbUrl + '\');"></div>' +
                    '<div class="video-label">' + track.title + '</div>' +
                    '<div class="overlay-btn">&gt; ACTIVATE &lt;</div>' +
                    /* Heart button — added in v3.3.0; stops propagation so card click doesn't fire */
                    '<button class="fav-heart-btn" data-id="' + track.id + '" data-title="' + track.title.replace(/"/g, '&quot;') + '" aria-label="Add to favourites">' +
                        '<svg class="fav-heart-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<path d="M12 21C12 21 3 14 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 13 5.08C14.09 3.81 15.76 3 17.5 3C20.58 3 23 5.42 23 8.5C23 14 14 21 12 21Z" stroke="#00ffcc" stroke-width="1.5" fill="none" class="fav-heart-path"/>' +
                        '</svg>' +
                    '</button>';

                grid.appendChild(card);
            });

            buildQueue();
            attachCardClicks();
            initFavourites();   /* Section 4P — wire up all favourites logic */

            if (window.youtubeAPIReady) {
                createPlayer();
            }
        })
        .catch(function(err) {
            console.error('Electroscape: Failed to load tracks.json —', err);
            document.getElementById('now-playing-label').textContent = 'Error loading track data';
        });
}


/* ============================================================ */
/* SECTION 4B: QUEUE BUILDER                                    */
/* Reads all .video cards from the DOM into the queue array.    */
/* Called after initial load and after every shuffle.           */
/* ============================================================ */
var queue             = [];   /* Ordered playlist */
var currentIndex      = -1;   /* Active position in queue (-1 = nothing yet) */
var isFavPlaylistMode = false;/* True if currently playing only the favorites */
var player;                   /* YouTube IFrame player object — do not rename */
var ended             = false; /* Debounce flag — prevents ENDED firing twice */
var endCardCheck;             /* Interval ID for the end-card guard (Section 4K) */
var hudTrackerInterval;       /* Interval ID for the HUD progress tracker (Section 4L) */

function buildQueue() {
    isFavPlaylistMode = false;
    queue = [];
    document.querySelectorAll('#video-grid .video').forEach(function(el) {
        queue.push({
            id:    el.getAttribute('data-id'),
            title: el.getAttribute('data-title'),
            el:    el
        });
    });
}

function buildFavQueue(favs) {
    isFavPlaylistMode = true;
    queue = [];
    favs.forEach(function(f) {
        var el = document.querySelector('#video-grid .video[data-id="' + f.id + '"]');
        if (el) {
            queue.push({
                id: f.id,
                title: f.title,
                el: el
            });
        }
    });
}

/* ============================================================ */
/* SECTION 4C: ACTIVE CARD HIGHLIGHTER & NOW-PLAYING CLICK      */
/* setActiveCard removes .is-playing from all cards and adds it */
/* to the card at the given queue index.                        */
/* attachNowPlayingClick wires the label above the player to    */
/* toggle play/pause, or start playback if nothing is loaded.   */
/* ============================================================ */
function setActiveCard(index) {
    document.querySelectorAll('#video-grid .video').forEach(function(el) {
        el.classList.remove('is-playing');
    });
    if (queue[index]) {
        queue[index].el.classList.add('is-playing');
    }
}

function attachNowPlayingClick() {
    var label = document.getElementById('now-playing-label');
    label.onclick = function() {
        if (!player || typeof player.getPlayerState !== 'function') return;
        var state = player.getPlayerState();
        if (state === -1 || state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.CUED) {
            /* Nothing playing yet — use playTrack so title updates correctly */
            playTrack(currentIndex === -1 ? 0 : currentIndex);
        } else if (state === YT.PlayerState.PLAYING) {
            player.pauseVideo();
        } else {
            player.playVideo();
        }
    };
}


/* ============================================================ */
/* SECTION 4D: PLAY TRACK                                       */
/* Loads the track at the given queue index into the YouTube    */
/* player. Index wraps around so the playlist loops.            */
/* Also updates the now-playing label, active card, HUD title,  */
/* progress bar, and restarts the end-card guard.               */
/* ============================================================ */
function playTrack(index) {
    if (!queue.length) return;

    /* Wrap index so it loops around the playlist */
    currentIndex = ((index % queue.length) + queue.length) % queue.length;
    var track = queue[currentIndex];

    document.getElementById('now-playing-label').textContent = track.title;
    document.getElementById('hud-progress-bar').style.width = '0%';

    if (player && typeof player.loadVideoById === 'function') {
        ended = false;
        player.loadVideoById(track.id);
    }

    setActiveCard(currentIndex);
    startEndCardGuard();
    updateHudTitle(track.title);
}


/* ============================================================ */
/* SECTION 4E: YOUTUBE IFRAME API READY                         */
/* onYouTubeIframeAPIReady is called automatically by the       */
/* YouTube script once it loads. If tracks are already in the   */
/* queue, the player is created immediately; otherwise           */
/* loadTracks() (Section 4A) will call createPlayer() itself.  */
/* ============================================================ */
window.youtubeAPIReady = false;

window.onYouTubeIframeAPIReady = function() {
    window.youtubeAPIReady = true;
    if (queue.length) {
        createPlayer();
    }
};

function createPlayer() {
    player = new YT.Player('yt-player', {
        width: '100%',
        height: '100%',
        playerVars: {
            autoplay:        0,
            controls:        1,
            rel:             0,
            modestbranding:  1,
            fs:              1,
            enablejsapi:     1
        },
        events: {
            onReady: function() {
                if (queue.length) {
                    /* Cue (but don't play) the first track on load */
                    player.cueVideoById(queue[0].id);
                    currentIndex = 0;
                    setActiveCard(0);
                    updateHudTitle(queue[0].title);
                }
                attachNowPlayingClick();
                startHudTracker();
                setupHudSeeking();
                attachHudControls();
            },
            onStateChange: function(event) {
                /* Auto-advance when a track ends */
                if (event.data === YT.PlayerState.ENDED && !ended) {
                    ended = true;
                    playTrack(currentIndex + 1);
                }

                /* Keep the HUD play/pause icon in sync */
                updateHudPlayPauseIcon(event.data);

                /* Reveal the HUD on first play or cue */
                if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.CUED) {
                    document.getElementById('hud-dock').classList.add('hud-active');
                }
            }
        }
    });
}


/* ============================================================ */
/* SECTION 4F: CARD CLICK EVENT                                 */
/* Attaches a click listener to every .video card in the grid.  */
/* Finds the card's position in the queue and calls playTrack.  */
/* ============================================================ */
function attachCardClicks() {
    document.querySelectorAll('#video-grid .video').forEach(function(el) {
        el.addEventListener('click', function() {
            if (isFavPlaylistMode) {
                buildQueue();
            }
            var idx = queue.findIndex(function(t) { return t.el === el; });
            if (idx !== -1) playTrack(idx);
        });
    });
}


/* ============================================================ */
/* SECTION 4G: PREV BUTTON                                      */
/* ============================================================ */
document.getElementById('prev-btn').addEventListener('click', function() {
    if (!queue.length) buildQueue();
    playTrack(currentIndex - 1);
    this.blur();
});


/* ============================================================ */
/* SECTION 4H: NEXT BUTTON                                      */
/* ============================================================ */
document.getElementById('next-btn').addEventListener('click', function() {
    if (!queue.length) buildQueue();
    playTrack(currentIndex + 1);
    this.blur();
});


/* ============================================================ */
/* SECTION 4I: SHUFFLE BUTTON (Override Sequence)               */
/* Fisher-Yates shuffle on the card DOM nodes, then rebuilds    */
/* the queue. If a track was playing it keeps its currentIndex  */
/* correct in the new order; otherwise resets to position 0.    */
/* ============================================================ */
document.getElementById('shuffle-btn').addEventListener('click', function() {
    var grid  = document.getElementById('video-grid');
    var cards = Array.from(grid.querySelectorAll('.video'));

    for (var i = cards.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        grid.appendChild(cards[j]);
        var tmp = cards[i]; cards[i] = cards[j]; cards[j] = tmp;
    }

    buildQueue();

    var stillPlaying = queue.findIndex(function(t) {
        return t.el.classList.contains('is-playing');
    });

    if (stillPlaying !== -1) {
        currentIndex = stillPlaying;
    } else {
        currentIndex = 0;
        if (player && typeof player.cueVideoById === 'function') {
            player.cueVideoById(queue[0].id);
        }
    }

    this.blur();
});


/* ============================================================ */
/* SECTION 4K: END-CARD GUARD                                   */
/* YouTube shows its own end-card overlay at ~7 seconds before  */
/* the video ends, which obscures the player UI. This guard     */
/* polls every second while a track is playing and advances to  */
/* the next track 7 seconds before the end, preventing that.   */
/* ============================================================ */
function startEndCardGuard() {
    if (endCardCheck) clearInterval(endCardCheck);
    endCardCheck = setInterval(function() {
        if (player && player.getPlayerState() === 1) {   /* 1 = PLAYING */
            var elapsed = player.getCurrentTime();
            var total   = player.getDuration();
            if (total > 0 && elapsed > (total - 7)) {
                clearInterval(endCardCheck);
                playTrack(currentIndex + 1);
            }
        }
    }, 1000);
}


/* ============================================================ */
/* SECTION 4L: HUD PROGRESS TRACKER                             */
/* Polls the player every 500ms while a track is playing and    */
/* updates the HUD progress bar width as a percentage.          */
/* ============================================================ */
function startHudTracker() {
    if (hudTrackerInterval) clearInterval(hudTrackerInterval);

    hudTrackerInterval = setInterval(function() {
        if (!player || typeof player.getPlayerState !== 'function') return;
        if (player.getPlayerState() === 1) {   /* 1 = PLAYING */
            var current = player.getCurrentTime();
            var total   = player.getDuration();
            if (total > 0) {
                var pct = (current / total) * 100;
                document.getElementById('hud-progress-bar').style.width = pct + '%';
            }
        }
    }, 500);
}

function updateHudTitle(title) {
    document.getElementById('hud-track-title').textContent = title || '';
}


/* ============================================================ */
/* SECTION 4M: HUD SEEK                                         */
/* Clicking anywhere on the HUD progress bar container seeks    */
/* to that position. Gives immediate visual feedback by         */
/* updating the bar width before the player confirms the seek.  */
/* ============================================================ */
function setupHudSeeking() {
    var barContainer = document.getElementById('hud-progress-container');
    var visualBar    = document.getElementById('hud-progress-bar');

    barContainer.addEventListener('click', function(e) {
        if (!player || typeof player.getDuration !== 'function') return;

        var rect = barContainer.getBoundingClientRect();
        var pos  = (e.clientX - rect.left) / rect.width;
        pos = Math.max(0, Math.min(1, pos));   /* Clamp to 0–1 */

        if (visualBar) {
            visualBar.style.width = (pos * 100) + '%';
        }

        player.seekTo(pos * player.getDuration(), true);
    });
}


/* ============================================================ */
/* SECTION 4N: HUD CONTROLS                                     */
/* Wires the HUD Prev / Play-Pause / Next buttons.              */
/* ============================================================ */
function attachHudControls() {
    document.getElementById('hud-prev').addEventListener('click', function() {
        if (!queue.length) buildQueue();
        playTrack(currentIndex - 1);
    });

    document.getElementById('hud-playpause').addEventListener('click', function() {
        if (!player || typeof player.getPlayerState !== 'function') return;
        var state = player.getPlayerState();
        if (state === -1 || state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.CUED) {
            playTrack(currentIndex === -1 ? 0 : currentIndex);
        } else if (state === YT.PlayerState.PLAYING) {
            player.pauseVideo();
        } else {
            player.playVideo();
        }
    });

    document.getElementById('hud-next').addEventListener('click', function() {
        if (!queue.length) buildQueue();
        playTrack(currentIndex + 1);
    });
}

function updateHudPlayPauseIcon(state) {
    var btn = document.getElementById('hud-playpause');
    if (!btn) return;
    btn.innerHTML = (state === 1) ? '&#10074;&#10074;' : '&#9654;';
}


/* ============================================================ */
/* SECTION 4O: GRID VIEW CONTROLS & LOCAL STORAGE               */
/* Switches the video grid between three density modes.         */
/* ============================================================ */
function initGridControls() {
    var grid      = document.getElementById('video-grid');
    var savedSize = localStorage.getItem('electroscape_grid_size') || 'default';

    /* Shared helper — applies the correct grid class and saves the choice */
    function applyGridSize(size) {
        grid.classList.remove('view-dense', 'view-max');
        if (size !== 'default') {
            grid.classList.add('view-' + size);
        }
        localStorage.setItem('electroscape_grid_size', size);
        return size;
    }

    /* -------------------------------------------------------- */
    /* OPTION B: Bare SVG icon buttons — ACTIVE                 */
    /* -------------------------------------------------------- */
    var buttons = document.querySelectorAll('.grid-btn');

    function updateBareActive(size) {
        buttons.forEach(function(b) {
            b.classList.toggle('grid-btn-active', b.getAttribute('data-size') === size);
        });
    }

    applyGridSize(savedSize);
    updateBareActive(savedSize);

    buttons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var size = this.getAttribute('data-size');
            applyGridSize(size);
            updateBareActive(size);
        });
    });
    /* OPTION B END */

    /*
    --------------------------------------------------------
    OPTION D: Single cycling button — INACTIVE
    --------------------------------------------------------
    [commented-out option D code preserved as-is]
    */
}


/* ============================================================ */
/* SECTION 4P: FAVOURITES SIDEBAR                               */
/*                                                              */
/* Overview:                                                    */
/*   - Each card gets a .fav-heart-btn injected in Section 4A.  */
/*   - Favourites stored as an array of {id, title} objects in  */
/*     localStorage under 'electroscape_favourites'.            */
/*   - The sidebar (#fav-sidebar) slides in from the right.     */
/*   - Rows in the list are draggable for reordering.           */
/*   - Clicking a row's play button finds the matching card in  */
/*     the queue by data-id and calls playTrack().              */
/*                                                              */
/* Key DOM IDs (defined in index.html Section 3I):              */
/*   #fav-sidebar    — the panel itself                         */
/*   #fav-backdrop   — click-to-close overlay behind the panel  */
/*   #fav-list       — <ul> populated by renderFavList()        */
/*   #fav-empty      — empty-state message div                  */
/*   #fav-header     — title bar with close button              */
/*   #fav-close-btn  — X button inside the header              */
/*   #fav-clear-btn  — clear-all button in the footer           */
/*   #fav-toggle-btn — heart pill in the action bar             */
/*   #fav-toggle-icon — SVG inside the toggle button            */
/* ============================================================ */
function initFavourites() {

    /* ---- Storage key ---- */
    var STORAGE_KEY = 'electroscape_favourites';

    /* ---- Load saved favourites from localStorage ---- */
    function loadFavs() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch(e) {
            return [];
        }
    }

    /* ---- Save current favourites array to localStorage ---- */
    function saveFavs(favs) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));
        } catch(e) { /* storage full — silently skip */ }
    }

    /* ---- Check if a video ID is currently favourited ---- */
    function isFav(id, favs) {
        return favs.some(function(f) { return f.id === id; });
    }

    /* ---- SVG paths for heart: outline vs filled ---- */
    var HEART_PATH = 'M12 21C12 21 3 14 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 13 5.08C14.09 3.81 15.76 3 17.5 3C20.58 3 23 5.42 23 8.5C23 14 14 21 12 21Z';

    /* ---- Update the visual state of a heart button on a card ---- */
    function updateHeartBtn(btn, active) {
        var path = btn.querySelector('.fav-heart-path');
        if (!path) return;
        if (active) {
            path.setAttribute('fill', '#00ffcc');
            path.setAttribute('stroke', '#00ffcc');
            btn.classList.add('fav-heart-active');
        } else {
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', '#00ffcc');
            btn.classList.remove('fav-heart-active');
        }
    }

    /* ---- Update the toggle button icon (outline/filled) ---- */
    function updateToggleIcon(open) {
        var icon = document.getElementById('fav-toggle-icon');
        if (!icon) return;
        var path = icon.querySelector('path');
        if (!path) return;
        if (open) {
            path.setAttribute('fill', '#00ffcc');
            path.setAttribute('stroke', '#00ffcc');
        } else {
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', '#00ffcc');
        }
    }

    /* ---- Sync all card heart buttons against current favs array ---- */
    function syncAllHearts(favs) {
        document.querySelectorAll('.fav-heart-btn').forEach(function(btn) {
            updateHeartBtn(btn, isFav(btn.getAttribute('data-id'), favs));
        });
    }

    /* ---- Drag-and-drop state ---- */
    var dragSrcIndex  = null;   /* Index of the row being dragged */
    var touchDragSrc  = null;   /* li element being touch-dragged */
    var touchClone    = null;   /* floating visual clone during touch drag */
    var touchOffsetY  = 0;      /* finger offset within the dragged row */

    /* ---- Shift a favourite up or down in the list ---- */
    function shiftFav(fromIndex, delta) {
        var favs = loadFavs();
        var toIndex = fromIndex + delta;
        if (toIndex < 0 || toIndex >= favs.length) return;
        var moved = favs.splice(fromIndex, 1)[0];
        favs.splice(toIndex, 0, moved);
        saveFavs(favs);
        renderFavList();
    }

    /* ---- Build and render the sidebar list from the favs array ---- */
    function renderFavList() {
        var favs    = loadFavs();
        var list    = document.getElementById('fav-list');
        var empty   = document.getElementById('fav-empty');
        var footer  = document.getElementById('fav-footer');

        /* Clear existing rows */
        list.innerHTML = '';

        if (!favs.length) {
            empty.style.display  = 'flex';
            footer.style.display = 'none';
            var actions = document.getElementById('fav-actions');
            if (actions) actions.style.display = 'none';
            return;
        }

        empty.style.display  = 'none';
        footer.style.display = 'flex';
        var actions = document.getElementById('fav-actions');
        if (actions) actions.style.display = 'flex';

        favs.forEach(function(fav, idx) {
            var li = document.createElement('li');
            li.className = 'fav-row';
            li.setAttribute('draggable', 'true');
            li.setAttribute('data-idx', idx);

            /* Thumbnail */
            var thumb = document.createElement('div');
            thumb.className = 'fav-row-thumb';
            thumb.style.backgroundImage = 'url(https://img.youtube.com/vi/' + fav.id + '/mqdefault.jpg)';

            /* Title */
            var title = document.createElement('span');
            title.className = 'fav-row-title';
            title.textContent = fav.title;

            /* Controls: Up / Down / Play / Remove */
            var controls = document.createElement('div');
            controls.className = 'fav-row-controls';

            /* Up Button */
            var upBtn = document.createElement('button');
            upBtn.className = 'fav-row-btn fav-move-btn';
            upBtn.setAttribute('aria-label', 'Move Up');
            upBtn.innerHTML = '&#9650;'; /* Up arrow */
            if (idx === 0) upBtn.style.opacity = '0.2';

            /* Down Button */
            var downBtn = document.createElement('button');
            downBtn.className = 'fav-row-btn fav-move-btn';
            downBtn.setAttribute('aria-label', 'Move Down');
            downBtn.innerHTML = '&#9660;'; /* Down arrow */
            if (idx === favs.length - 1) downBtn.style.opacity = '0.2';

            /* Play button */
            var playBtn = document.createElement('button');
            playBtn.className = 'fav-row-btn fav-play-btn';
            playBtn.setAttribute('aria-label', 'Play ' + fav.title);
            playBtn.innerHTML =
                '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<polygon points="2,1 10,6 2,11" fill="#00ffcc"/>' +
                '</svg>';

            /* Remove button */
            var removeBtn = document.createElement('button');
            removeBtn.className = 'fav-row-btn fav-remove-btn';
            removeBtn.setAttribute('aria-label', 'Remove ' + fav.title);
            removeBtn.innerHTML = '&#x2715;';

            /* Drag handle */
            var handle = document.createElement('div');
            handle.className = 'fav-drag-handle';
            /* Aggressive context menu suppression for tablet drag */
            handle.setAttribute('oncontextmenu', 'return false;');
            handle.innerHTML =
                '<svg viewBox="0 0 8 14" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<circle cx="2" cy="2"  r="1.2" fill="#555"/>' +
                '<circle cx="6" cy="2"  r="1.2" fill="#555"/>' +
                '<circle cx="2" cy="7"  r="1.2" fill="#555"/>' +
                '<circle cx="6" cy="7"  r="1.2" fill="#555"/>' +
                '<circle cx="2" cy="12" r="1.2" fill="#555"/>' +
                '<circle cx="6" cy="12" r="1.2" fill="#555"/>' +
                '</svg>';

            controls.appendChild(upBtn);
            controls.appendChild(downBtn);
            controls.appendChild(playBtn);
            controls.appendChild(removeBtn);

            li.appendChild(handle);
            li.appendChild(thumb);
            li.appendChild(title);
            li.appendChild(controls);
            list.appendChild(li);

            /* Aggressive context menu suppression for the whole row */
            li.oncontextmenu = function(e) { e.preventDefault(); e.stopPropagation(); return false; };

            /* --- Up/Down logic --- */
            upBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (idx > 0) shiftFav(idx, -1);
            });
            downBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (idx < favs.length - 1) shiftFav(idx, 1);
            });

            /* --- Play from sidebar --- */
            playBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                /* Find the queue index for this video ID */
                var qIdx = queue.findIndex(function(t) { return t.id === fav.id; });
                if (qIdx !== -1) {
                    playTrack(qIdx);
                }
            });

            /* --- Remove from favourites --- */
            removeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                var current = loadFavs();
                current = current.filter(function(f) { return f.id !== fav.id; });
                saveFavs(current);
                syncAllHearts(current);
                renderFavList();
            });

            /* --- Drag-to-reorder: dragstart --- */
            li.addEventListener('dragstart', function(e) {
                dragSrcIndex = idx;
                li.classList.add('fav-row-dragging');
                e.dataTransfer.effectAllowed = 'move';
                /* Required for Firefox */
                e.dataTransfer.setData('text/plain', idx);
            });

            li.addEventListener('dragend', function() {
                li.classList.remove('fav-row-dragging');
                /* Remove any lingering drop-target highlights */
                document.querySelectorAll('.fav-row-over').forEach(function(el) {
                    el.classList.remove('fav-row-over');
                });
            });

            /* Suppress the Android long-press context menu on the drag handle */
            handle.addEventListener('contextmenu', function(e) { e.preventDefault(); });

            /*
             * --- Pointer Events drag-to-reorder (tablet / mobile) ---
             * Uses the Pointer Events API instead of touch events.
             * setPointerCapture() tells Android Chrome "I own this gesture"
             * which is the only reliable way to prevent the long-press
             * context menu (Download / Share / Print) from appearing.
             */
            handle.addEventListener('pointerdown', function(e) {
                if (e.pointerType === 'mouse') return;   /* mouse handled by HTML5 drag above */
                e.preventDefault();
                handle.setPointerCapture(e.pointerId);   /* claim the gesture — suppresses context menu */

                var rect     = li.getBoundingClientRect();
                touchOffsetY = e.clientY - rect.top;
                touchDragSrc = li;
                dragSrcIndex = idx;
                li.classList.add('fav-row-dragging');

                touchClone = li.cloneNode(true);
                touchClone.style.cssText =
                    'position:fixed; left:' + rect.left + 'px; top:' + rect.top + 'px;' +
                    'width:' + rect.width + 'px; opacity:0.85; pointer-events:none;' +
                    'z-index:9999; background:#1a1a1a; border:1px solid #00ffcc33; border-radius:6px;';
                document.body.appendChild(touchClone);
            });

            handle.addEventListener('pointermove', function(e) {
                if (e.pointerType === 'mouse' || !touchClone) return;
                e.preventDefault();
                touchClone.style.top = (e.clientY - touchOffsetY) + 'px';
                document.querySelectorAll('.fav-row-over').forEach(function(el) {
                    el.classList.remove('fav-row-over');
                });
                touchClone.style.display = 'none';
                var target = document.elementFromPoint(e.clientX, e.clientY);
                touchClone.style.display = '';
                var targetRow = target && target.closest('.fav-row');
                if (targetRow && targetRow !== touchDragSrc) {
                    targetRow.classList.add('fav-row-over');
                }
            });

            handle.addEventListener('pointerup', function(e) {
                if (e.pointerType === 'mouse') return;
                if (touchClone) { touchClone.remove(); touchClone = null; }
                if (!touchDragSrc) return;
                touchDragSrc.classList.remove('fav-row-dragging');
                document.querySelectorAll('.fav-row-over').forEach(function(el) {
                    el.classList.remove('fav-row-over');
                });
                var target    = document.elementFromPoint(e.clientX, e.clientY);
                var targetRow = target && target.closest('.fav-row');
                if (targetRow && targetRow !== touchDragSrc) {
                    var destIdx = parseInt(targetRow.getAttribute('data-idx'), 10);
                    if (!isNaN(destIdx) && destIdx !== dragSrcIndex) {
                        var current = loadFavs();
                        var moved   = current.splice(dragSrcIndex, 1)[0];
                        current.splice(destIdx, 0, moved);
                        saveFavs(current);
                        renderFavList();
                    }
                }
                touchDragSrc = null;
                dragSrcIndex = null;
            });

            handle.addEventListener('pointercancel', function(e) {
                if (touchClone) { touchClone.remove(); touchClone = null; }
                if (touchDragSrc) { touchDragSrc.classList.remove('fav-row-dragging'); }
                document.querySelectorAll('.fav-row-over').forEach(function(el) {
                    el.classList.remove('fav-row-over');
                });
                touchDragSrc = null;
                dragSrcIndex = null;
            });
            /* --- Pointer Events drag end --- */

            li.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                li.classList.add('fav-row-over');
            });

            li.addEventListener('dragleave', function() {
                li.classList.remove('fav-row-over');
            });

            li.addEventListener('drop', function(e) {
                e.preventDefault();
                li.classList.remove('fav-row-over');
                if (dragSrcIndex === null || dragSrcIndex === idx) return;

                /* Reorder the array and persist */
                var current = loadFavs();
                var moved   = current.splice(dragSrcIndex, 1)[0];
                current.splice(idx, 0, moved);
                saveFavs(current);
                renderFavList();   /* Re-render with new order */
                dragSrcIndex = null;
            });
        });
    }

    /* ---- Open / close the sidebar ---- */
    function openSidebar() {
        document.getElementById('fav-sidebar').classList.add('fav-sidebar-open');
        document.getElementById('fav-backdrop').classList.add('fav-backdrop-visible');
        updateToggleIcon(true);
        renderFavList();   /* Always refresh on open */
    }

    function closeSidebar() {
        document.getElementById('fav-sidebar').classList.remove('fav-sidebar-open');
        document.getElementById('fav-backdrop').classList.remove('fav-backdrop-visible');
        updateToggleIcon(false);
    }

    /* ---- Wire up the toggle button in the action bar ---- */
    var toggleBtn = document.getElementById('fav-toggle-btn');
    toggleBtn.addEventListener('click', function() {
        var sidebar = document.getElementById('fav-sidebar');
        if (sidebar.classList.contains('fav-sidebar-open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
        this.blur();
    });

    /* ---- Close on backdrop click ---- */
    document.getElementById('fav-backdrop').addEventListener('click', closeSidebar);

    /* ---- Close on X button ---- */
    document.getElementById('fav-close-btn').addEventListener('click', closeSidebar);

    /* ---- Play all favourites button ---- */
    var playAllBtn = document.getElementById('fav-play-all-btn');
    if (playAllBtn) {
        playAllBtn.addEventListener('click', function() {
            var favs = loadFavs();
            if (favs.length > 0) {
                buildFavQueue(favs);
                playTrack(0);
                closeSidebar();
            }
        });
    }

    /* ---- Clear all favourites ---- */
    document.getElementById('fav-clear-btn').addEventListener('click', function() {
        saveFavs([]);
        syncAllHearts([]);
        renderFavList();
    });

    /* ---- Wire up each card's heart button ---- */
    document.querySelectorAll('.fav-heart-btn').forEach(function(btn) {
        /* Stop propagation — heart click must not trigger card play */
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var id    = btn.getAttribute('data-id');
            var title = btn.getAttribute('data-title');
            var favs  = loadFavs();

            if (isFav(id, favs)) {
                /* Already favourited — remove */
                favs = favs.filter(function(f) { return f.id !== id; });
            } else {
                /* Not yet favourited — add */
                favs.push({ id: id, title: title });
            }

            saveFavs(favs);
            updateHeartBtn(btn, isFav(id, favs));

            /* If sidebar is open, refresh the list live */
            var sidebar = document.getElementById('fav-sidebar');
            if (sidebar.classList.contains('fav-sidebar-open')) {
                renderFavList();
            }
        });
    });

    /* ---- Restore heart states from localStorage on load ---- */
    syncAllHearts(loadFavs());
}


/* ============================================================ */
/* SECTION 4Q: GUIDE POPUP (v3.4.0)                             */
/* Logic to open and close the Quick Start Guide popup.         */
/* ============================================================ */
function initGuide() {
    var openBtn   = document.getElementById('guide-open-btn');
    var closeBtn  = document.getElementById('guide-close-btn');
    var okBtn     = document.getElementById('guide-ok-btn');
    var backdrop  = document.getElementById('guide-backdrop');
    var modal     = document.getElementById('guide-modal');

    function openGuide() {
        backdrop.classList.add('guide-visible');
        modal.classList.add('guide-visible');
        /* Pause player if playing — optional, but helpful */
        if (player && typeof player.pauseVideo === 'function' && player.getPlayerState() === 1) {
            player.pauseVideo();
        }
    }

    function closeGuide() {
        backdrop.classList.remove('guide-visible');
        modal.classList.remove('guide-visible');
    }

    if (openBtn)  openBtn.addEventListener('click', openGuide);
    if (closeBtn) closeBtn.addEventListener('click', closeGuide);
    if (okBtn)    okBtn.addEventListener('click', closeGuide);
    if (backdrop) backdrop.addEventListener('click', closeGuide);
}


/* ============================================================ */
/* SECTION 4J: INITIALISATION                                   */
/* Entry point. loadTracks() fetches tracks.json and builds the */
/* grid; initGridControls() wires up the view switcher and      */
/* restores the saved grid preference from localStorage.        */
/* initFavourites() is called inside loadTracks() once the      */
/* card DOM is ready (heart buttons must exist first).          */
/* ============================================================ */
loadTracks();
initGridControls();
initGuide();
