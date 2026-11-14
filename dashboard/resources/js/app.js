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
 * Sticky bars ([data-sticky]) get [data-stuck] while they stick under the
 * header (a border, and on detail pages the compact title). Elements below
 * them that stick too ([data-sticky-below]) are placed under the bar via
 * --sticky-offset.
 */
function setupSticky() {
    const header = document.querySelector('[data-site-header]');
    const bars = [...document.querySelectorAll('[data-sticky]')];
    const update = () => {
        const top = header ? header.getBoundingClientRect().height : 0;
        let offset = top;
        bars.forEach((bar) => {
            if (getComputedStyle(bar).position !== 'sticky') {
                bar.removeAttribute('data-stuck');
                return;
            }
            const rect = bar.getBoundingClientRect();
            const stuck = window.scrollY > 0 && rect.top <= top + 1;
            bar.toggleAttribute('data-stuck', stuck);
            offset = Math.max(offset, top + rect.height);
        });
        document.documentElement.style.setProperty('--sticky-offset', `${offset}px`);
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
}

/**
 * Long output ([data-clamp]) shows its first lines with a fade and a button
 * to show everything; short output stays as it is. "Alle aufklappen"
 * ([data-expand-all]) opens or closes all of them.
 */
function setupClamps() {
    const toggles = [];
    document.querySelectorAll('[data-clamp]').forEach((box) => {
        box.classList.add('clamp');
        if (box.scrollHeight <= box.clientHeight + 24) {
            box.classList.remove('clamp');
            return;
        }
        const lines = (box.textContent.match(/\n/g) || []).length + 1;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-gold hover:text-gold-light';
        const set = (open) => {
            box.toggleAttribute('data-open', open);
            button.textContent = open ? 'Weniger anzeigen' : `Alles anzeigen · ${lines} Zeilen`;
        };
        button.addEventListener('click', () => set(!box.hasAttribute('data-open')));
        set(false);
        box.after(button);
        toggles.push(set);
    });

    const all = document.querySelector('[data-expand-all]');
    if (!all) return;
    if (toggles.length === 0) {
        all.hidden = true;
        return;
    }
    let open = false;
    all.addEventListener('click', () => {
        open = !open;
        toggles.forEach((set) => set(open));
        all.textContent = open ? 'Alle zuklappen' : 'Alle aufklappen';
    });
}

/** [data-copy="text"] buttons copy their text and confirm with a check mark. */
function setupCopy() {
    const check = '<svg class="size-3.5 text-success" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd"/></svg>';
    document.querySelectorAll('[data-copy]').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(button.dataset.copy);
            } catch {
                return;
            }
            const icon = button.querySelector('svg:last-of-type');
            if (!icon) return;
            const before = icon.outerHTML;
            icon.outerHTML = check;
            setTimeout(() => {
                button.querySelector('svg:last-of-type').outerHTML = before;
            }, 1200);
        });
    });
}

/** "/" focuses the page's search field; Escape leaves it. */
function setupHotkeys() {
    document.addEventListener('keydown', (event) => {
        const target = event.target;
        const typing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
        if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
            const search = document.querySelector('[data-hotkey-search]');
            if (search && !document.querySelector('dialog[open]')) {
                event.preventDefault();
                search.focus();
                search.select?.();
            }
        } else if (event.key === 'Escape' && target instanceof HTMLInputElement && target.matches('[data-hotkey-search]')) {
            target.blur();
        }
    });
}

/** Scroll areas ([data-scroll-area]) drop their bottom fade once scrolled to the end. */
function setupScrollAreas() {
    document.querySelectorAll('[data-scroll-area]').forEach((area) => {
        const update = () => area.toggleAttribute('data-at-end', area.scrollTop + area.clientHeight >= area.scrollHeight - 4);
        area.addEventListener('scroll', update, { passive: true });
        update();
    });
}

/**
 * Log page: appends new lines every 2 s (only what was written since the last
 * request), follows the end while the reader is at the bottom of the log
 * window, and offers a jump button with the number of new lines when they
 * scrolled up. Long lines wrap or scroll sideways (remembered per browser).
 */
const LOG_POLL_MS = 2_000;

function setupLogView() {
    const view = document.querySelector('[data-log-view]');
    if (!view) return;

    const scroller = view.querySelector('[data-log-scroll]');
    const list = view.querySelector('[data-log-lines]');
    const empty = view.querySelector('[data-log-empty]');
    const count = view.querySelector('[data-log-count]');
    const search = view.querySelector('[data-log-search]');
    const liveButton = view.querySelector('[data-log-live]');
    const liveDot = view.querySelector('[data-log-live-dot]');
    const liveLabel = view.querySelector('[data-log-live-label]');
    const wrapButton = view.querySelector('[data-log-wrap]');
    const jump = view.querySelector('[data-log-jump]');
    const jumpLabel = view.querySelector('[data-log-jump-label]');
    const maxLines = Number(view.dataset.lines) || 300;
    let offset = Number(view.dataset.offset) || 0;
    let live = true;
    let follow = true;
    let unseen = 0;
    let busy = false;
    let failed = false;

    const atBottom = () => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 40;
    const toBottom = () => {
        scroller.scrollTop = scroller.scrollHeight;
    };

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
        empty.classList.toggle('hidden', rows.length > 0);
    }

    function updateLive() {
        liveButton.setAttribute('aria-pressed', String(live));
        liveLabel.textContent = !live ? 'Pausiert' : failed ? 'Getrennt' : 'Live';
        liveDot.className = `size-2 rounded-full ${!live ? 'bg-white/30' : failed ? 'bg-danger' : 'bg-success animate-pulse'}`;
    }

    function setWrap(wrap) {
        view.dataset.wrap = String(wrap);
        wrapButton.setAttribute('aria-pressed', String(wrap));
        wrapButton.classList.toggle('!border-gold/50', wrap);
        try {
            localStorage.setItem('nyrus.logs.wrap', wrap ? '1' : '0');
        } catch {
            // storage blocked: the choice lasts until reload
        }
        if (follow) toBottom();
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

    scroller.addEventListener('scroll', () => {
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

    wrapButton.addEventListener('click', () => setWrap(view.dataset.wrap !== 'true'));

    search.addEventListener('input', () => {
        applySearch([...list.querySelectorAll('.log-line')]);
        updateCount();
        if (follow) toBottom();
    });
    // Enter in the search field must not submit the filter form.
    search.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') event.preventDefault();
    });

    let savedWrap = '1';
    try {
        savedWrap = localStorage.getItem('nyrus.logs.wrap') ?? '1';
    } catch {
        // storage blocked: wrap by default
    }
    setWrap(savedWrap !== '0');
    document.addEventListener('visibilitychange', poll);
    setInterval(poll, LOG_POLL_MS);
    updateLive();
    toBottom();
}

/**
 * Dialogs: [data-dialog-open="id"] links open the <dialog> as a modal (without
 * JavaScript they load the page with the dialog shown). A dialog rendered with
 * [data-dialog-autoopen] (e.g. after a validation error) opens as a modal on load.
 * Clicking the backdrop or a [data-dialog-close] button closes it.
 */
function setupDialogs() {
    document.querySelectorAll('[data-dialog-open]').forEach((trigger) => {
        const dialog = document.getElementById(trigger.dataset.dialogOpen);
        if (!dialog) return;
        trigger.addEventListener('click', (event) => {
            event.preventDefault();
            if (!dialog.open) dialog.showModal();
        });
    });

    document.querySelectorAll('dialog').forEach((dialog) => {
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) dialog.close();
        });
        dialog.querySelectorAll('[data-dialog-close]').forEach((button) => {
            button.addEventListener('click', () => dialog.close());
        });
        if (dialog.hasAttribute('data-dialog-autoopen')) {
            dialog.close();
            dialog.showModal();
            const invalid = dialog.querySelector('.text-danger')?.closest('label')?.querySelector('input');
            invalid?.focus();
        }
    });
}

/**
 * Long lists ([data-filter-scope]) with a search field ([data-filter-input]):
 * hides [data-filter-item] entries that don't contain the typed text and
 * shows how many match ([data-filter-count]).
 */
function setupFilterLists() {
    document.querySelectorAll('[data-filter-scope]').forEach((scope) => {
        const input = scope.querySelector('[data-filter-input]');
        if (!input) return;
        const items = [...scope.querySelectorAll('[data-filter-item]')];
        const empty = scope.querySelector('[data-filter-empty]');
        const count = scope.querySelector('[data-filter-count]');
        input.addEventListener('input', () => {
            const term = input.value.trim().toLowerCase();
            let visible = 0;
            items.forEach((item) => {
                item.hidden = term !== '' && !item.textContent.toLowerCase().includes(term);
                if (!item.hidden) visible++;
            });
            empty?.classList.toggle('hidden', visible > 0);
            if (count) count.textContent = term === '' ? String(items.length) : `${visible} / ${items.length}`;
            scope.querySelector('[data-scroll-area]')?.dispatchEvent(new Event('scroll'));
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') event.preventDefault();
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupDialogs();
    setupFilterLists();
    setupLiveRegions();
    setupBusyForms();
    setupSticky();
    setupClamps();
    setupCopy();
    setupHotkeys();
    setupScrollAreas();
    setupLogView();
});
