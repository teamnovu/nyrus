// Small progressive enhancements; every page works without JavaScript.

/**
 * Live regions: pages with [data-live-region] elements refresh them in the
 * background (every 15 s while the tab is visible), without a full reload.
 */
const LIVE_INTERVAL_MS = 15_000;

function setupLiveRegions() {
    const regions = document.querySelectorAll('[data-live-region]');
    if (regions.length === 0) return;

    const label = document.querySelector('[data-live-label]');
    let timer = null;

    async function refresh() {
        try {
            const response = await fetch(window.location.href, {
                headers: { 'X-Requested-With': 'fetch' },
                credentials: 'same-origin',
            });
            if (!response.ok || response.redirected) return;
            const next = new DOMParser().parseFromString(await response.text(), 'text/html');
            const fresh = next.querySelectorAll('[data-live-region]');
            if (fresh.length !== regions.length) return;
            regions.forEach((region, i) => {
                if (region.innerHTML !== fresh[i].innerHTML) {
                    region.innerHTML = fresh[i].innerHTML;
                }
            });
            if (label) {
                const time = new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                label.textContent = `live · zuletzt ${time}`;
            }
        } catch {
            // offline or server busy: try again next round
        }
    }

    function schedule() {
        clearInterval(timer);
        if (document.visibilityState === 'visible') {
            timer = setInterval(refresh, LIVE_INTERVAL_MS);
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refresh();
        schedule();
    });
    schedule();
}

/** Forms marked [data-busy-form] show a busy state on submit (cloning takes a while). */
function setupBusyForms() {
    document.querySelectorAll('form[data-busy-form]').forEach((form) => {
        form.addEventListener('submit', () => {
            const button = form.querySelector('[data-busy-label]');
            if (!button) return;
            button.disabled = true;
            button.classList.add('opacity-80', 'cursor-wait');
            button.innerHTML = `<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity=".25" stroke-width="3"/><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>${button.dataset.busyLabel}`;
        });
    });
}

/**
 * Log page: appends new lines every 2 s (only what was written since the last
 * request), follows the end while the reader is at the bottom, and offers a
 * jump button with the number of new lines when they scrolled up. One scroll
 * container: the page itself.
 */
const LOG_POLL_MS = 2_000;

function setupLogView() {
    const view = document.querySelector('[data-log-view]');
    if (!view) return;

    const list = view.querySelector('[data-log-lines]');
    const empty = view.querySelector('[data-log-empty]');
    const count = view.querySelector('[data-log-count]');
    const search = view.querySelector('[data-log-search]');
    const liveButton = view.querySelector('[data-log-live]');
    const liveDot = view.querySelector('[data-log-live-dot]');
    const liveLabel = view.querySelector('[data-log-live-label]');
    const jump = view.querySelector('[data-log-jump]');
    const jumpLabel = view.querySelector('[data-log-jump-label]');
    const maxLines = Number(view.dataset.lines) || 300;
    let offset = Number(view.dataset.offset) || 0;
    let live = true;
    let follow = true;
    let unseen = 0;
    let busy = false;
    let failed = false;

    const atBottom = () =>
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80;
    const toBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });

    function updateJump() {
        jump.hidden = follow;
        jumpLabel.textContent = unseen > 0 ? `${unseen} neue ${unseen === 1 ? 'Zeile' : 'Zeilen'}` : 'Zum Ende';
    }

    function applySearch(rows) {
        const term = search.value.trim().toLowerCase();
        rows.forEach((row) => {
            row.hidden = term !== '' && !row.textContent.toLowerCase().includes(term);
        });
    }

    function updateCount() {
        const rows = list.querySelectorAll('.log-line');
        const visible = [...rows].filter((row) => !row.hidden).length;
        count.textContent = visible === rows.length ? `${rows.length} Zeilen` : `${visible} von ${rows.length} Zeilen`;
        empty.hidden = rows.length > 0;
    }

    function updateLive() {
        liveButton.setAttribute('aria-pressed', String(live));
        liveLabel.textContent = !live ? 'Pausiert' : failed ? 'Getrennt' : 'Live';
        liveDot.className = `size-2 rounded-full ${!live ? 'bg-white/30' : failed ? 'bg-danger' : 'bg-gold animate-pulse'}`;
    }

    async function poll() {
        if (!live || busy || document.visibilityState !== 'visible') return;
        busy = true;
        try {
            const url = new URL(view.dataset.tailUrl, window.location.origin);
            url.searchParams.set('offset', String(offset));
            const response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
            if (response.redirected || !response.ok) throw new Error(String(response.status));
            const data = await response.json();
            failed = false;
            offset = data.offset;

            if (data.reset) {
                list.innerHTML = data.html;
            } else if (data.count > 0) {
                list.insertAdjacentHTML('beforeend', data.html);
            }
            if (data.reset || data.count > 0) {
                const rows = [...list.querySelectorAll('.log-line')];
                rows.slice(0, Math.max(0, rows.length - maxLines)).forEach((row) => row.remove());
                applySearch([...list.querySelectorAll('.log-line')]);
                updateCount();
                if (follow) {
                    toBottom();
                } else {
                    unseen += data.count;
                    updateJump();
                }
            }
        } catch {
            failed = true;
        } finally {
            busy = false;
            updateLive();
        }
    }

    window.addEventListener('scroll', () => {
        follow = atBottom();
        if (follow) unseen = 0;
        updateJump();
    }, { passive: true });

    jump.addEventListener('click', () => {
        follow = true;
        unseen = 0;
        toBottom();
        updateJump();
    });

    liveButton.addEventListener('click', () => {
        live = !live;
        updateLive();
        if (live) poll();
    });

    search.addEventListener('input', () => {
        applySearch([...list.querySelectorAll('.log-line')]);
        updateCount();
        if (follow) toBottom();
    });
    // Enter in the search field must not submit the filter form.
    search.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') event.preventDefault();
    });

    document.addEventListener('visibilitychange', poll);
    setInterval(poll, LOG_POLL_MS);
    updateLive();
    toBottom();
}

document.addEventListener('DOMContentLoaded', () => {
    setupLiveRegions();
    setupBusyForms();
    setupLogView();
});
