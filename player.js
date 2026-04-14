/*
    Name: player.js | Version: 2.0
    Project: Electroscape
    Description: All playback logic for the Electroscape music video gallery.
                 Loads track data from tracks.json, builds the video card grid,
                 and controls the YouTube IFrame API player.
                 Imported by index.html via <script> tag at the bottom of <body>.

    Stages map:
        Section 4A — Track loader   : Fetches tracks.json and builds the card grid
        Section 4B — Queue builder  : Reads the card grid into a playback queue
        Section 4C — Active card    : Highlights the currently playing card
        Section 4D — Play track     : Loads and plays a track by queue position
        Section 4E — YouTube ready  : Creates the player when the YouTube API loads
        Section 4F — Card click     : Plays a track when its card is clicked
        Section 4G — Prev button    : Steps back one track
        Section 4H — Next button    : Steps forward one track
        Section 4I — Shuffle button : Randomises the card grid and rebuilds queue
        Section 4J — Initialisation : Entry point — loads tracks and builds queue
        Section 4K — End card guard : Auto-skips YouTube end cards
*/


/* ============================================================ */
/* SECTION 4A: TRACK LOADER                                     */
/* Fetches tracks.json and builds the video card grid.         */
/* Each card is created from the id and title in the JSON.     */
/* The thumbnail URL is constructed automatically from the id. */
/*                                                             */
/* IMPORTANT: This uses fetch(), which requires the page to be */
/* served over HTTP/HTTPS (e.g. GitHub Pages).                 */
/* It will NOT work if you open index.html directly as a local */
/* file (file:// in the address bar). Use a local server or    */
/* push to GitHub to test changes.                             */
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
/* an ordered list (the "queue") of objects containing:        */
/*   id    — the YouTube video ID                              */
/*   title — the track name                                    */
/*   el    — the card's DOM element (used to highlight it)     */
/* Called on page load and again after every shuffle.          */
/* ============================================================ */
var queue        = [];   /* The ordered playlist */
var currentIndex = -1;   /* Which position in the queue is playing (-1 = nothing yet) */
var player;              /* The YouTube IFrame player object — do not rename */
var ended        = false;/* Prevents the ENDED event firing twice in a row */
var endCardCheck;        /* Holds the interval timer for the end card guard */

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
/* SECTION 4C: ACTIVE CARD HIGHLIGHTER                          */
/* Removes the green "is-playing" border from all cards,       */
/* then applies it only to the card at the given queue index.  */
/* Also scrolls that card into view smoothly.                  */
/* ============================================================ */
function setActiveCard(index) {
    document.querySelectorAll('#video-grid .video').forEach(function(el) {
        el.classList.remove('is-playing');
    });
    if (queue[index]) {
        queue[index].el.classList.add('is-playing');
        queue[index].el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}


/* ============================================================ */
/* SECTION 4D: PLAY TRACK                                       */
/* The main function that switches to a new track.             */
/* index — the position in the queue array to play.            */
/* Wraps around: past the last track goes back to first,       */
/* before the first goes to the last.                          */
/* ============================================================ */
function playTrack(index) {
    if (!queue.length) return;

    /* Wrap the index so it loops around the playlist */
    currentIndex = ((index % queue.length) + queue.length) % queue.length;

    var track = queue[currentIndex];

    /* Update the "now playing" label above the player */
    document.getElementById('now-playing-label').textContent = track.title;

    /* Tell the YouTube player to load and play this video */
    if (player && typeof player.loadVideoById === 'function') {
        ended = false; /* Reset the end-of-video flag */
        player.loadVideoById(track.id);
    }

    setActiveCard(currentIndex);
    startEndCardGuard(); /* Restart the end card timer for the new track */
}


/* ============================================================ */
/* SECTION 4E: YOUTUBE IFRAME API READY                         */
/* This function name is REQUIRED by YouTube — the API calls   */
/* it automatically when the YouTube script finishes loading.  */
/* It creates the player inside the #yt-player div.            */
/*                                                             */
/* playerVars control default behaviour:                       */
/*   autoplay: 0        — do not auto-play on page load        */
/*   controls: 1        — show the YouTube player controls bar */
/*   rel: 0             — no related videos at the end         */
/*   modestbranding: 1  — minimal YouTube branding             */
/*   fs: 1              — allow fullscreen button              */
/*   enablejsapi: 1     — required for JavaScript control      */
/*                                                             */
/* DO NOT RENAME this function.                                */
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
                    currentIndex = 0; /* Fix: ensures Next/Prev start from correct position */
                }
                startEndCardGuard();
                attachNowPlayingClick();
            },
            onStateChange: function(event) {
                if (event.data === YT.PlayerState.ENDED && !ended) {
                    ended = true;
                    playTrack(currentIndex + 1);
                }
            }
        }
    });
}


/* ============================================================ */
/* SECTION 4C2: NOW PLAYING LABEL CLICK                         */
/* Makes the now-playing label clickable with green hover.     */
/* Before anything plays: clicking starts the first track      */
/* and updates the title. While playing: pauses. While         */
/* paused or buffering: resumes playback.                      */
/* Called once from onReady. Replaces onclick each call so     */
/* it is safe to call again — no duplicate listeners.          */
/* ============================================================ */
function attachNowPlayingClick() {
    var label = document.getElementById('now-playing-label');
    label.onclick = function() {
        if (!player || typeof player.getPlayerState !== 'function') return;
        var state = player.getPlayerState();
        if (state === -1 || state === YT.PlayerState.UNSTARTED) {
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
/* SECTION 4F: CARD CLICK EVENT                                 */
/* Attaches a click listener to every video card in the grid.  */
/* Called after the cards have been built from tracks.json.    */
/* When clicked: finds that card's position in the queue,      */
/* plays the track, and scrolls smoothly back to the top       */
/* so the featured player is immediately visible.              */
/* ============================================================ */
function attachCardClicks() {
    document.querySelectorAll('#video-grid .video').forEach(function(el) {
        el.addEventListener('click', function() {
            var idx = queue.findIndex(function(t) { return t.el === el; });
            if (idx !== -1) playTrack(idx);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
}


/* ============================================================ */
/* SECTION 4G: PREV BUTTON                                      */
/* Plays the track one position before the current one.        */
/* Wraps to the last track if currently on the first.          */
/* ============================================================ */
document.getElementById('prev-btn').addEventListener('click', function() {
    if (!queue.length) buildQueue();
    playTrack(currentIndex - 1);
});


/* ============================================================ */
/* SECTION 4H: NEXT BUTTON                                      */
/* Plays the track one position after the current one.         */
/* Wraps to the first track if currently on the last.          */
/* ============================================================ */
document.getElementById('next-btn').addEventListener('click', function() {
    if (!queue.length) buildQueue();
    playTrack(currentIndex + 1);
});


/* ============================================================ */
/* SECTION 4I: SHUFFLE BUTTON                                   */
/* Randomly reorders the video cards in the grid.              */
/* Uses the Fisher-Yates algorithm (walks backwards,           */
/* swapping each card with a random earlier card).             */
/* After shuffling, rebuilds the queue to match new card order.*/
/* If a track is playing, keeps currentIndex pointing at it.   */
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
});


/* ============================================================ */
/* SECTION 4J: INITIALISATION                                   */
/* Entry point — called immediately when this script loads.    */
/* Fetches tracks.json, builds the card grid, and sets up      */
/* the queue ready for when the YouTube API finishes loading.  */
/* ============================================================ */
loadTracks();


/* ============================================================ */
/* SECTION 4K: END CARD GUARD                                   */
/* Watches the video progress and skips to the next track      */
/* a few seconds before the video ends, so YouTube end cards   */
/* (the overlay recommendations that appear at ~10s remaining) */
/* are skipped automatically.                                  */
/*                                                             */
/* To adjust how long end cards show before skipping:          */
/*   Change the number 7 in: elapsed > (total - 7)            */
/*   Lower number = skips sooner. Higher = waits longer.       */
/*   Example: (total - 3) skips with 3s of end cards showing  */
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
