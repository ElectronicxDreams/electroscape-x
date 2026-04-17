/*
    Name: player.js | Version: 3.2.0
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
                    '<div class="overlay-btn">&gt; ACTIVATE &lt;</div>';

                grid.appendChild(card);
            });

            buildQueue();
            attachCardClicks();

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
var player;                   /* YouTube IFrame player object — do not rename */
var ended             = false; /* Debounce flag — prevents ENDED firing twice */
var endCardCheck;             /* Interval ID for the end-card guard (Section 4K) */
var hudTrackerInterval;       /* Interval ID for the HUD progress tracker (Section 4L) */

function buildQueue() {
    queue = [];
    document.querySelectorAll('#video-grid .video').forEach(function(el) {
        queue.push({
            id:    el.getAttribute('data-id'),
            title: el.getAttribute('data-title'),
            el:    el
        });
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
/* An invisible ::before pseudo-element on the container        */
/* (styled in style.css) extends the click target upward.       */
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
/* Play-Pause mirrors the same logic as the now-playing label   */
/* click handler (Section 4C).                                  */
/* updateHudPlayPauseIcon keeps the button icon in sync with    */
/* the player state on every onStateChange event (Section 4E).  */
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
/* Switches the video grid between three density modes by       */
/* toggling CSS classes on #video-grid:                         */
/*   data-size="dense"   → adds .view-dense (Micro)             */
/*   data-size="default" → no extra class   (Core)              */
/*   data-size="max"     → adds .view-max   (Max)               */
/* The active button receives .grid-btn-active.                 */
/* Preference is saved to localStorage and restored on reload.  */
/*                                                              */
/* TWO UI OPTIONS — matches the active option in index.html:    */
/*   Option B (ACTIVE)   — three bare SVG icon buttons          */
/*   Option D (INACTIVE) — single cycling button                */
/* To swap: comment out the active option below, uncomment the  */
/* other, and make the matching change in index.html (3E).      */
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
    /* Reads data-size from each .grid-btn and applies          */
    /* .grid-btn-active to the selected one.                    */
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
    Click cycles dense → default → max → dense.
    Icon and label update to reflect the current mode.
    To enable: remove these comment markers and comment out
    Option B above. Also update index.html Section 3E.
    --------------------------------------------------------

    var cycleOrder  = ['dense', 'default', 'max'];
    var cycleLabels = { dense: 'Micro', 'default': 'Core', max: 'Max' };

    var cycleSVGs = {
        dense:
            '<svg width="15" height="15" viewBox="0 0 18 18" fill="none">' +
            '<rect x="1" y="1" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="5.5" y="1" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="10" y="1" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="14.5" y="1" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="1" y="5.5" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="5.5" y="5.5" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="10" y="5.5" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="14.5" y="5.5" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="1" y="10" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="5.5" y="10" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="10" y="10" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="14.5" y="10" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="1" y="14.5" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="5.5" y="14.5" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="10" y="14.5" width="3.5" height="3.5" rx="0.4"/>' +
            '<rect x="14.5" y="14.5" width="3.5" height="3.5" rx="0.4"/>' +
            '</svg>',
        'default':
            '<svg width="15" height="15" viewBox="0 0 18 18" fill="none">' +
            '<rect x="1" y="1" width="4.5" height="4.5" rx="0.5"/>' +
            '<rect x="6.75" y="1" width="4.5" height="4.5" rx="0.5"/>' +
            '<rect x="12.5" y="1" width="4.5" height="4.5" rx="0.5"/>' +
            '<rect x="1" y="6.75" width="4.5" height="4.5" rx="0.5"/>' +
            '<rect x="6.75" y="6.75" width="4.5" height="4.5" rx="0.5"/>' +
            '<rect x="12.5" y="6.75" width="4.5" height="4.5" rx="0.5"/>' +
            '<rect x="1" y="12.5" width="4.5" height="4.5" rx="0.5"/>' +
            '<rect x="6.75" y="12.5" width="4.5" height="4.5" rx="0.5"/>' +
            '<rect x="12.5" y="12.5" width="4.5" height="4.5" rx="0.5"/>' +
            '</svg>',
        max:
            '<svg width="15" height="15" viewBox="0 0 18 18" fill="none">' +
            '<rect x="1" y="1" width="7" height="7" rx="0.8"/>' +
            '<rect x="10" y="1" width="7" height="7" rx="0.8"/>' +
            '<rect x="1" y="10" width="7" height="7" rx="0.8"/>' +
            '<rect x="10" y="10" width="7" height="7" rx="0.8"/>' +
            '</svg>'
    };

    var cycleBtn    = document.getElementById('cycle-view-btn');
    var currentSize = savedSize;

    function updateCycleBtn(size) {
        var iconEl  = document.getElementById('cycle-view-icon');
        var labelEl = document.getElementById('cycle-view-label');
        if (iconEl)  iconEl.innerHTML   = cycleSVGs[size];
        if (labelEl) labelEl.textContent = cycleLabels[size];
    }

    applyGridSize(currentSize);
    updateCycleBtn(currentSize);

    if (cycleBtn) {
        cycleBtn.addEventListener('click', function() {
            var idx     = cycleOrder.indexOf(currentSize);
            currentSize = cycleOrder[(idx + 1) % cycleOrder.length];
            applyGridSize(currentSize);
            updateCycleBtn(currentSize);
            this.blur();
        });
    }
    OPTION D END */
}


/* ============================================================ */
/* SECTION 4J: INITIALISATION                                   */
/* Entry point. loadTracks() fetches tracks.json and builds the */
/* grid; initGridControls() wires up the view switcher and      */
/* restores the saved grid preference from localStorage.        */
/* ============================================================ */
loadTracks();
initGridControls();
