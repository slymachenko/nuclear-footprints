// Minimal, robust scripting for the datastory page.

const STORAGE_KEYS = {
	returnUrl: "nf:returnUrl",
	returnScroll: "nf:returnScroll",
};

// Cache versioned because measurement strategy may change.
const IFRAME_HEIGHT_CACHE_KEY = "nf:iframeHeights:v4";
const iframeHeightCache = new Map();

function normalizeSrc(src) {
	if (!src) return "";
	try {
		return new URL(src, document.baseURI).href;
	} catch {
		return String(src);
	}
}

function getFloorHeightForIframe(iframe) {
	const minHeight = 320;
	const tallMinHeight = 420;
	let floor = iframe?.classList?.contains("viz-tall") ? tallMinHeight : minHeight;
	try {
		const switcher = iframe.closest?.(".viz-switcher");
		if (switcher) {
			const activeTab = switcher.querySelector(".viz-tab.is-active");
			const openable = activeTab?.getAttribute("data-openable") === "true";
			if (openable) floor = Math.max(floor, 680);
		}
	} catch {
		// ignore
	}
	return floor;
}

function applyCachedHeightToLiveIframes(normalizedKey) {
	const EPS = 10;
	const cached = iframeHeightCache.get(normalizedKey);
	if (!Number.isFinite(cached) || cached <= 0) return;
	const iframes = Array.from(document.querySelectorAll("iframe.viz-iframe"));
	iframes.forEach((iframe) => {
		const currentKey = normalizeSrc(iframe.getAttribute("src") || iframe.src);
		if (!currentKey || currentKey !== normalizedKey) return;
		const floor = getFloorHeightForIframe(iframe);
		const target = Math.max(cached, floor);
		const current = Number.parseFloat(iframe.style.height || "");
		if (Number.isFinite(current) && Math.abs(target - current) <= EPS) return;
		requestAnimationFrame(() => {
			iframe.style.height = `${target}px`;
		});
	});
}

function enableSmoothScroll() {
	const anchorLinks = document.querySelectorAll('a[href^="#"]');
	anchorLinks.forEach((link) => {
		link.addEventListener("click", (e) => {
			const href = link.getAttribute("href");
			if (!href || href === "#") return;
			const target = document.querySelector(href);
			if (!target) return;
			e.preventDefault();
			target.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	});
}

function enableTopbarScrollState() {
	const topbar = document.getElementById("topbar");
	if (!topbar) return;

	const update = () => {
		if (window.scrollY > 8) topbar.classList.add("scrolled");
		else topbar.classList.remove("scrolled");
	};

	update();
	window.addEventListener("scroll", update, { passive: true });
}

document.addEventListener("DOMContentLoaded", () => {
	enableSmoothScroll();
	enableTopbarScrollState();
	enableReturnPointCapture();
	restoreReturnScrollIfAny();
	enableDisabledDownloads();
	enableVizOverlay();
	enableIframeAutoResize();
	warmIframeHeightCache();
	enableVizSwitchers();
});

function warmIframeHeightCache() {
	// Pre-measure all visualization pages so switchers can resize instantly on first switch.
	// Uses a single hidden same-origin iframe to avoid loading all at once.
	const rawSources = [];
	Array.from(document.querySelectorAll("iframe.viz-iframe")).forEach((i) => {
		const src = i.getAttribute("src") || i.src || "";
		if (src) rawSources.push(src);
	});
	Array.from(document.querySelectorAll(".viz-switcher .viz-tab[data-src]")).forEach((t) => {
		const src = t.getAttribute("data-src") || "";
		if (src) rawSources.push(src);
	});
	const sources = Array.from(new Set(rawSources.map(normalizeSrc).filter(Boolean)));
	if (sources.length === 0) return;

	// If we already have all cached, skip.
	const missing = sources.filter((src) => !iframeHeightCache.has(src));
	if (missing.length === 0) return;

	const probe = document.createElement("iframe");
	probe.style.position = "fixed";
	probe.style.left = "-99999px";
	probe.style.top = "0";
	probe.style.width = "1200px";
	probe.style.height = "360px";
	probe.style.border = "0";
	probe.style.visibility = "hidden";
	probe.setAttribute("aria-hidden", "true");
	probe.tabIndex = -1;
	document.body.appendChild(probe);

	const minHeight = 320;
	let idx = 0;

	const measureCurrent = () => {
		try {
			// Avoid caching viewport height (scrollHeight is at least the iframe viewport).
			probe.style.height = `${minHeight}px`;
			const doc = probe.contentDocument;
			if (!doc) return;
			const body = doc.body;
			const html = doc.documentElement;
			if (!body || !html) return;
			const raw = Math.max(body.scrollHeight || 0, html.scrollHeight || 0);
			const height = raw > 0 ? raw : minHeight;
			const key = normalizeSrc(probe.getAttribute("src") || probe.src || "");
			if (key && Number.isFinite(height) && height > 0) {
				iframeHeightCache.set(key, height);
				try {
					const obj = Object.fromEntries(iframeHeightCache.entries());
					sessionStorage.setItem(IFRAME_HEIGHT_CACHE_KEY, JSON.stringify(obj));
				} catch {
					// ignore
				}
				applyCachedHeightToLiveIframes(key);
			}
		} catch {
			// ignore
		}
	};

	const next = () => {
		if (idx >= missing.length) {
			probe.remove();
			return;
		}
		const src = missing[idx];
		idx += 1;
		probe.src = src;
	};

	probe.addEventListener("load", () => {
		// Allow async chart rendering a moment, then measure.
		window.setTimeout(() => {
			measureCurrent();
			next();
		}, 450);
	});

	next();
}

function enableIframeAutoResize() {
	// Resize in-page visualization iframes to their content height (same-origin).
	// Note: We intentionally do NOT auto-resize the overlay iframe; it should fill the overlay.
	const iframes = Array.from(document.querySelectorAll("iframe.viz-iframe"));
	if (iframes.length === 0) return;

	const minHeight = 320;
	const tallMinHeight = 420;
	const EPS = 10; // ignore tiny oscillations

	// Load cached heights (best-effort)
	try {
		const raw = sessionStorage.getItem(IFRAME_HEIGHT_CACHE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object") {
				Object.entries(parsed).forEach(([k, v]) => {
					const n = Number(v);
					if (Number.isFinite(n) && n > 0) iframeHeightCache.set(k, n);
				});
			}
		}
	} catch {
		// ignore
	}

	const getMinHeightFor = (iframe) =>
		iframe.classList?.contains("viz-tall") ? tallMinHeight : minHeight;

	const getCurrentHeight = (iframe) => {
		const inline = Number.parseFloat(iframe.style.height || "");
		if (Number.isFinite(inline) && inline > 0) return inline;
		const rect = iframe.getBoundingClientRect();
		return rect.height || 0;
	};

	const resizeGrowOnly = (iframe) => {
		try {
			const doc = iframe.contentDocument;
			if (!doc) return;
			const body = doc.body;
			const html = doc.documentElement;
			if (!body || !html) return;

			const raw = Math.max(body.scrollHeight || 0, html.scrollHeight || 0);
			if (!Number.isFinite(raw) || raw <= 0) return;
			const minForThis = getMinHeightFor(iframe);
			const target = Math.max(raw, minForThis);

			// Important: avoid resize thrashing.
			// We only grow here; shrinking is handled via the probe/cache (e.g. switchers).
			const current = getCurrentHeight(iframe);
			if (current > 0 && target <= current + EPS) return;

			iframe.style.height = `${target}px`;
			const key = normalizeSrc(iframe.getAttribute("src") || iframe.src);
			if (key) {
				iframeHeightCache.set(key, target);
				try {
					const obj = Object.fromEntries(iframeHeightCache.entries());
					sessionStorage.setItem(IFRAME_HEIGHT_CACHE_KEY, JSON.stringify(obj));
				} catch {
					// ignore
				}
			}
		} catch {
			// Cross-origin or blocked access; keep CSS fallback height.
		}
	};

	const applyCachedHeight = (iframe) => {
		const key = normalizeSrc(iframe.getAttribute("src") || iframe.src);
		if (!key) return;
		const cached = iframeHeightCache.get(key);
		if (Number.isFinite(cached) && cached > 0) {
			iframe.style.height = `${cached}px`;
		}
	};

	const scheduleStabilize = (iframe) => {
		// Some embedded pages render charts asynchronously; sample a few times then stop.
		// Keeping this short prevents page "bouncing" while scrolling.
		let remaining = 8;
		const tick = () => {
			resizeGrowOnly(iframe);
			remaining -= 1;
			if (remaining <= 0) return;
			window.setTimeout(tick, 300);
		};
		tick();
	};

	iframes.forEach((iframe) => {
		const onLoad = () => {
			applyCachedHeight(iframe);
			resizeGrowOnly(iframe);
			scheduleStabilize(iframe);
		};

		iframe.addEventListener("load", onLoad);
		// If already loaded from cache.
		if (iframe.contentDocument?.readyState === "complete") onLoad();
		// Apply cached size immediately on first paint.
		applyCachedHeight(iframe);
	});
}

function enableVizOverlay() {
	const overlay = document.querySelector(".viz-overlay");
	const closeBtn = document.querySelector(".viz-overlay__close");
	const iframe = document.querySelector(".viz-overlay__iframe");
	const title = document.querySelector(".viz-overlay__title");
	if (!(overlay instanceof HTMLElement)) return;
	if (!(iframe instanceof HTMLIFrameElement)) return;

	const close = () => {
		overlay.hidden = true;
		overlay.setAttribute("aria-hidden", "true");
		iframe.src = "about:blank";
		document.documentElement.classList.remove("is-overlay-open");
	};

	const open = (src, label) => {
		iframe.src = src;
		if (title) title.textContent = label || "Visualization";
		overlay.hidden = false;
		overlay.setAttribute("aria-hidden", "false");
		document.documentElement.classList.add("is-overlay-open");
	};

	window.__nfVizOverlay = { open, close };

	closeBtn?.addEventListener("click", close);
	overlay.addEventListener("click", (e) => {
		// Click on backdrop closes.
		if (e.target === overlay) close();
	});

	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !overlay.hidden) close();
	});
}

function enableReturnPointCapture() {
	// Store scroll position and open protocols in an in-page overlay.
	document.addEventListener("click", (e) => {
		const target = e.target;
		if (!(target instanceof HTMLElement)) return;

		const link = target.closest("a");
		if (!(link instanceof HTMLAnchorElement)) return;
		if (!link.classList.contains("viz-protocol")) return;

		// Prefer overlay instead of full navigation on the story page.
		const overlayApi = window.__nfVizOverlay;
		if (overlayApi && typeof overlayApi.open === "function") {
			e.preventDefault();
			const href = link.href;
			const vizSwitcher = link.closest(".viz-switcher");
			const vizCard = link.closest(".viz-card");
			let label = "Protocol";
			if (vizSwitcher) {
				const activeTab = vizSwitcher.querySelector(".viz-tab.is-active");
				const tabLabel = activeTab?.textContent?.trim();
				if (tabLabel) label = `Protocol — ${tabLabel}`;
			} else if (vizCard) {
				const figcaption = vizCard.querySelector("figcaption");
				const cap = figcaption?.textContent?.trim();
				if (cap) label = "Protocol";
			}

			overlayApi.open(href, label);
			return;
		}

		try {
			sessionStorage.setItem(STORAGE_KEYS.returnUrl, window.location.href);
			sessionStorage.setItem(STORAGE_KEYS.returnScroll, String(window.scrollY || 0));
		} catch {
			// ignore
		}
	});
}

function restoreReturnScrollIfAny() {
	// Only attempt restore on the main story page.
	if (!document.getElementById("part-1")) return;

	let scrollValue = null;
	try {
		scrollValue = sessionStorage.getItem(STORAGE_KEYS.returnScroll);
	} catch {
		return;
	}
	if (!scrollValue) return;

	const y = Number(scrollValue);
	if (!Number.isFinite(y)) return;

	requestAnimationFrame(() => {
		window.scrollTo({ top: y, left: 0, behavior: "auto" });
		try {
			sessionStorage.removeItem(STORAGE_KEYS.returnScroll);
			sessionStorage.removeItem(STORAGE_KEYS.returnUrl);
		} catch {
			// ignore
		}
	});
}

function enableDisabledDownloads() {
	// Prevent placeholder download links from navigating.
	document.addEventListener("click", (e) => {
		const target = e.target;
		if (!(target instanceof HTMLElement)) return;
		const link = target.closest("a");
		if (!(link instanceof HTMLAnchorElement)) return;

		const href = link.getAttribute("href");
		const isDisabled = link.getAttribute("aria-disabled") === "true";
		if (href === "#" || isDisabled) {
			e.preventDefault();
			const parentDetails = link.closest("details");
			if (parentDetails instanceof HTMLDetailsElement) parentDetails.open = false;
		}
	});
}

function enableVizSwitchers() {
	const switchers = document.querySelectorAll(".viz-switcher");
	switchers.forEach((switcher) => {
		const iframe = switcher.querySelector("iframe");
		const captionEl = switcher.querySelector(".viz-caption");
		const protocolLink = switcher.querySelector(".viz-protocol");
		const downloadLink = switcher.querySelector(".viz-download");
		const fullscreenBtn = switcher.querySelector(".viz-fullscreen");
		const tabs = Array.from(switcher.querySelectorAll(".viz-tab"));
		if (!iframe || tabs.length === 0) return;

		const updateOpenUi = (openable) => {
			if (!fullscreenBtn) return;
			fullscreenBtn.hidden = !openable;
			fullscreenBtn.textContent = "Open map";
			fullscreenBtn.setAttribute("aria-pressed", "false");
		};

		const setActive = (button) => {
			const src = button.getAttribute("data-src");
			if (!src) return;
			const normalizedSrc = normalizeSrc(src);
			// Use a reasonable default while the probe/cache warms.
			// This avoids tiny iframes (e.g. power tracker) and reduces scroll-jank.
			const fallback = iframe?.classList?.contains("viz-tall") ? "680px" : "560px";
			// Apply cached height immediately to avoid inheriting previous (possibly taller) size.
			const cached = iframeHeightCache.get(normalizedSrc);
			if (Number.isFinite(cached) && cached > 0) {
				const floor = getFloorHeightForIframe(iframe);
				iframe.style.height = `${Math.max(cached, floor)}px`;
			} else {
				// Keep layout stable until we know the real height.
				iframe.style.height = fallback;
			}
			iframe.src = src;
			const openable = button.getAttribute("data-openable") === "true";
			updateOpenUi(openable);
			if (protocolLink) {
				const protocolHref = button.getAttribute("data-protocol");
				if (protocolHref) protocolLink.href = protocolHref;
			}
			if (downloadLink) {
				const datasetId = button.getAttribute("data-dataset");
				if (datasetId) downloadLink.setAttribute("data-dataset", datasetId);
			}
			const caption = button.getAttribute("data-caption") || "";
			if (captionEl) captionEl.textContent = caption;
			tabs.forEach((t) => t.classList.remove("is-active"));
			button.classList.add("is-active");
		};

		// Default
		const defaultSrc = switcher.getAttribute("data-default");
		if (defaultSrc) {
			const defaultBtn = tabs.find((b) => b.getAttribute("data-src") === defaultSrc);
			if (defaultBtn) setActive(defaultBtn);
		}

		switcher.addEventListener("click", (e) => {
			const target = e.target;
			if (!(target instanceof HTMLElement)) return;

			const fsBtn = target.closest(".viz-fullscreen");
			if (fsBtn && fullscreenBtn) {
				const activeTab = tabs.find((t) => t.classList.contains("is-active"));
				const openable = activeTab?.getAttribute("data-openable") === "true";
				if (!openable) return;
				const src = activeTab?.getAttribute("data-src") || iframe.src;
				const label = activeTab?.textContent?.trim() || "Visualization";
				const overlayApi = window.__nfVizOverlay;
				if (overlayApi && typeof overlayApi.open === "function") {
					overlayApi.open(src, label);
				}
				return;
			}

			const tab = target.closest(".viz-tab");
			if (tab && tab instanceof HTMLButtonElement) {
				setActive(tab);
				return;
			}
		});
	});
}

