/*
    Name: player.js | Version: 3.1.0
    Project: Electroscape
    Description: All playback logic for the Electroscape music video gallery.
                 Loads track data from tracks.json, builds the video card grid,
                 and controls the YouTube IFrame API player.
                 Imported by index.html via <script> tag at the bottom of <body>.
                 v2.9 — Added Unified Grid View memory logic.
*/


/* ============================================================ */
/* SECTION 4A: TRACK LOADER                                     */
/* Fetches tracks.json and builds the video card grid.         */
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
                /* Build the thumbnail URL from the YouTube video ID */
                var thumbUrl = 'https://img.youtube.com/vi/' + track.id + '/maxresdefault.jpg';

                /* Create the card element and set its attributes */
                var card = document.createElement('div');
                card.className = 'video';
                card.setAttribute('data-id', track.id);
                card.setAttribute('data-title', track.title);

                /* Build the inner HTML: thumbnail, label, overlay button */
                card.innerHTML =
                    '<div class="thumb-container" style="background-image: url(\'' + thumbUrl + '\');"></div>' +
                    '<div class="video-label">' + track.title + '</div>' +
                    '<div class="overlay-btn">&gt; ACTIVATE &lt;</div>';

                grid.appendChild(card);
            });

            /* Once all cards are in the DOM, build the queue and attach click events */
            buildQueue();
            attachCardClicks();

            /* If the YouTube API finished loading before the tracks did, create player now */
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
/* Reads all the video cards currently in the grid and builds  */
/* an ordered playlist.                                        */
/* ============================================================ */
var queue              =[];    /* The ordered playlist */
var currentIndex       = -1;    /* Which position in the queue is playing (-1 = nothing yet) */
var player;                     /* The YouTube IFrame player object — do not rename */
var ended              = false; /* Prevents the ENDED event firing twice in a row */
var endCardCheck;               /* Holds the interval timer for the end card guard */
var hudTrackerInterval;         /* Stores the HUD progress interval */

function buildQueue() {
    queue =[];
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
            /* Paused, buffering, or any other state — resume */
            player.playVideo();
        }
    };
}


/* ============================================================ */
/* SECTION 4D: PLAY TRACK                                       */
/* ============================================================ */
function playTrack(index) {
    if (!queue.length) return;

    /* Wrap the index so it loops around the playlist */
    currentIndex = ((index % queue.length) + queue.length) % queue.length;
    var track = queue[currentIndex];

    /* Update the "now playing" label above the player */
    document.getElementById('now-playing-label').textContent = track.title;
    document.getElementById('hud-progress-bar').style.width = '0%';

    /* Tell the YouTube player to load and play this video */
    if (player && typeof player.loadVideoById === 'function') {
        ended = false; /* Reset the end-of-video flag */
        player.loadVideoById(track.id);
    }

    setActiveCard(currentIndex);
    startEndCardGuard();         /* Restart the end card timer for the new track */
    updateHudTitle(track.title); /* Sync HUD title immediately */
}


/* ============================================================ */
/* SECTION 4E: YOUTUBE IFRAME API READY                         */
/* ============================================================ */
window.youtubeAPIReady = false;

window.onYouTubeIframeAPIReady = function() {
    window.youtubeAPIReady = true;
    /* Only create the player once the tracks have also loaded */
    if (queue.length) {
        createPlayer();
    }
};

function createPlayer() {
    player = new YT.Player('yt-player', {
        width: '100%',
        height: '100%',
        playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            fs: 1,
            enablejsapi: 1
        },
        events: {
            onReady: function() {
                if (queue.length) {
                    player.cueVideoById(queue[0].id);
                    currentIndex = 0;
                    setActiveCard(0);
                    updateHudTitle(queue[0].title);
                }

                attachNowPlayingClick();
                startHudTracker();   /* Start the HUD progress updater */
                setupHudSeeking();   /* Wire up seek on progress bar click */
                attachHudControls(); /* Wire up HUD Prev / Play-Pause / Next */
            },
            onStateChange: function(event) {
                /* Auto-advance when track ends */
                if (event.data === YT.PlayerState.ENDED && !ended) {
                    ended = true;
                    playTrack(currentIndex + 1);
                }

                /* Update the HUD play/pause button icon on every state change */
                updateHudPlayPauseIcon(event.data);

                /* Show HUD only on PLAYING (1) or CUED (5). */
                if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.CUED) {
                    document.getElementById('hud-dock').classList.add('hud-active');
                }
            }
        }
    });
}


/* ============================================================ */
/* SECTION 4F: CARD CLICK EVENT                                 */
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
/* SECTION 4I: SHUFFLE BUTTON                                   */
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
/* SECTION 4K: END CARD GUARD                                   */
/* ============================================================ */
function startEndCardGuard() {
    if (endCardCheck) clearInterval(endCardCheck);
    endCardCheck = setInterval(function() {
        if (player && player.getPlayerState() === 1) { /* 1 = Playing */
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
/* SECTION 4L: HUD TRACKER                                      */
/* ============================================================ */
function startHudTracker() {
    /* Clear any existing tracker before starting a new one */
    if (hudTrackerInterval) clearInterval(hudTrackerInterval);

    hudTrackerInterval = setInterval(function() {
        if (!player || typeof player.getPlayerState !== 'function') return;
        if (player.getPlayerState() === 1) { /* 1 = YT.PlayerState.PLAYING */
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
/* ============================================================ */
function setupHudSeeking() {
    var barContainer = document.getElementById('hud-progress-container');
    var visualBar    = document.getElementById('hud-progress-bar');

    barContainer.addEventListener('click', function(e) {
        if (!player || typeof player.getDuration !== 'function') return;

        var rect = barContainer.getBoundingClientRect();
        var pos  = (e.clientX - rect.left) / rect.width;
        pos = Math.max(0, Math.min(1, pos)); /* Clamp to 0–1 */

        /* Immediate UI feedback */
        if (visualBar) {
            visualBar.style.width = (pos * 100) + '%';
        }

        var newTime = pos * player.getDuration();
        player.seekTo(newTime, true);
    });
}


/* ============================================================ */
/* SECTION 4N: HUD CONTROLS                                     */
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
    if (state === 1) {
        btn.innerHTML = '&#10074;&#10074;'; /* Pause ❚❚ */
    } else {
        btn.innerHTML = '&#9654;';          /* Play ▶ */
    }
}


/* ============================================================ */
/* SECTION 4O: GRID VIEW CONTROLS & LOCAL STORAGE               */
/* Allows user to swap between Dense, Standard, and Max grids.  */
/* Saves the choice to localStorage so it persists on reload.   */
/*                                                               */
/* Two UI options below — OPTION B is active, OPTION D is       */
/* commented out. To swap: comment B out, uncomment D.          */
/* ============================================================ */
function initGridControls() {
    var grid = document.getElementById('video-grid');
    var savedSize = localStorage.getItem('electroscape_grid_size') || 'default';

    /* Shared helper — applies grid CSS class and saves preference */
    function applyGridSize(size) {
        grid.classList.remove('view-dense', 'view-max');
        if (size !== 'default') {
            grid.classList.add('view-' + size);
        }
        localStorage.setItem('electroscape_grid_size', size);
        return size;
    }

    /* ---------------------------------------------------------- */
    /* OPTION B — Bare icon buttons (ACTIVE)                      */
    /* Each button carries data-size and gets grid-btn-active      */
    /* when selected. Matches .bare-view-btn in style.css.         */
    /* ---------------------------------------------------------- */
    var buttons = document.querySelectorAll('.grid-btn');

    function updateBareActive(size) {
        buttons.forEach(function(b) {
            if (b.getAttribute('data-size') === size) {
                b.classList.add('grid-btn-active');
            } else {
                b.classList.remove('grid-btn-active');
            }
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
    /* OPTION B END ---------------------------------------------- */

    /*
    ------------------------------------------------------------
    OPTION D — Single cycling button (INACTIVE)
    To enable: comment out OPTION B above, then remove the
    outer comment markers wrapping this block.
    ------------------------------------------------------------
    var cycleOrder = ['dense', 'default', 'max'];
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

    var cycleBtn = document.getElementById('cycle-view-btn');

    function updateCycleBtn(size) {
        var iconEl  = document.getElementById('cycle-view-icon');
        var labelEl = document.getElementById('cycle-view-label');
        if (iconEl)  iconEl.innerHTML  = cycleSVGs[size];
        if (labelEl) labelEl.textContent = cycleLabels[size];
    }

    var currentSize = savedSize;
    applyGridSize(currentSize);
    updateCycleBtn(currentSize);

    if (cycleBtn) {
        cycleBtn.addEventListener('click', function() {
            var idx = cycleOrder.indexOf(currentSize);
            currentSize = cycleOrder[(idx + 1) % cycleOrder.length];
            applyGridSize(currentSize);
            updateCycleBtn(currentSize);
            this.blur();
        });
    }
    OPTION D END ------------------------------------------------ */
}


/* ============================================================ */
/* SECTION 4J: INITIALISATION                                   */
/* ============================================================ */
loadTracks();
initGridControls();