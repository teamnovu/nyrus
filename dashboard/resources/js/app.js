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

document.addEventListener('DOMContentLoaded', () => {
    setupLiveRegions();
    setupBusyForms();
});
