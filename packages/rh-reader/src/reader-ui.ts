import { ReaderController } from "./controller.js";
import {
  resolveTapZone,
  type ReaderChapter,
  type ReaderInitialState,
  type ReaderMode,
  type ReaderPage,
  type ReaderSnapshot,
} from "./types.js";

export interface ReaderLabels {
  exit: string;
  toc: string;
  lock: string;
  autoplay: string;
  nextChapter: string;
  crop: string;
  mode: string;
  speed: string;
  modeNames: Record<ReaderMode, string>;
  lockedHint: string;
  unlockedHint: string;
  firstPage: string;
  lastPage: string;
  lastChapter: string;
  cropPending: string;
  tocTitle: string;
  close: string;
  progress: string;
}

export interface ReaderOptions {
  chapters: ReaderChapter[];
  initial?: ReaderInitialState;
  labels: ReaderLabels;
  onExit(): void;
  onProgress?(snapshot: ReaderSnapshot): void;
  onChapterChange?(chapterIndex: number, chapter: ReaderChapter): void;
}

export interface ReaderHandle {
  destroy(): void;
}

const ICONS: Record<string, string> = {
  exit: '<path d="M15 18l-6-6 6-6"/><path d="M9 12h12"/>',
  toc: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  speed: '<path d="M4 12a8 8 0 1 1 8 8"/><path d="M12 12l4-3"/>',
  next: '<path d="M5 5l10 7-10 7z"/><path d="M19 5v14"/>',
  crop: '<path d="M6 2v16h16"/><path d="M2 6h16v16"/>',
  mode: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 4v16"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
};

function icon(name: string): string {
  return `<svg class="rh-reader-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function must<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`Reader UI 初始化失败：缺少 ${name}`);
  return value;
}

const STYLE = `
.rh-reader{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;color:var(--text);background:var(--surface-glass);font:inherit}
.rh-reader-stage{position:relative;flex:1;min-height:0;overflow:hidden;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.rh-reader-page{position:absolute;inset:0;overflow-y:auto;padding:56px 32px 118px;box-sizing:border-box}
.rh-reader-page-in{animation:rh-reader-page-in .18s ease-out}
@keyframes rh-reader-page-in{from{opacity:.4;transform:translateY(4px)}to{opacity:1;transform:none}}
.rh-reader[data-mode="paged"] .rh-reader-page-in{animation-name:rh-reader-page-in-x}
@keyframes rh-reader-page-in-x{from{opacity:.4;transform:translateX(6px)}to{opacity:1;transform:none}}
.rh-reader-text{max-width:760px;margin:0 auto;line-height:1.9;font-size:1rem;color:var(--text-dim)}
.rh-reader-text p{margin:0 0 1.1em;white-space:pre-wrap}
.rh-reader-image{display:block;max-width:100%;margin:0 auto 12px;border-radius:6px}
.rh-reader-placeholder{max-width:760px;margin:0 auto 12px;min-height:180px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border-glass);border-radius:8px;background:rgba(var(--ink-rgb),.04);color:var(--text-muted);font-size:.86rem}
.rh-reader-bar{position:absolute;left:0;right:0;z-index:5;background:rgba(var(--surface-rgb,22,24,27),.9);border-color:var(--border-glass);transition:opacity .22s ease,transform .22s ease}
.rh-reader-bar.is-hidden{opacity:0;pointer-events:none}
.rh-reader-top{top:0;display:flex;align-items:center;gap:10px;padding:calc(8px + env(safe-area-inset-top)) 14px 8px;border-bottom:1px solid var(--border-glass)}
.rh-reader-bottom{bottom:0;display:flex;flex-direction:column;gap:6px;padding:8px 14px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--border-glass)}
.rh-reader-top.is-hidden{transform:translateY(-6px)}
.rh-reader-bottom.is-hidden{transform:translateY(6px)}
.rh-reader-title{flex:1;min-width:0;text-align:center;font-size:.88rem;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rh-reader-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;background:transparent;color:var(--text-dim);border-radius:6px;padding:6px 8px;cursor:pointer;font:inherit;font-size:.82rem;white-space:nowrap}
.rh-reader-btn:hover{background:rgba(var(--accent-rgb),.08);color:var(--text)}
.rh-reader-btn.is-active{border-color:rgba(var(--accent-rgb),.42);background:rgba(var(--accent-rgb),.12);color:var(--text)}
.rh-reader-btn:disabled{opacity:.4;cursor:default}
.rh-reader-icon{flex:none}
.rh-reader-progress{display:flex;align-items:center;gap:10px;font-size:.74rem;color:var(--text-muted)}
.rh-reader-progress input[type="range"]{flex:1;min-width:0;accent-color:rgb(var(--accent-rgb))}
.rh-reader-actions{display:flex;align-items:center;gap:2px;flex-wrap:wrap}
.rh-reader-toast{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:8;background:rgba(var(--surface-rgb,22,24,27),.94);border:1px solid var(--border-glass);border-radius:8px;padding:9px 14px;color:var(--text-dim);font-size:.84rem;opacity:0;pointer-events:none;transition:opacity .18s ease;max-width:80%;text-align:center}
.rh-reader-toast.is-visible{opacity:1}
.rh-reader-toc{position:absolute;inset:0;z-index:7;display:flex;justify-content:flex-end;background:rgba(var(--shade-rgb,0,0,0),.38)}
.rh-reader-toc.is-hidden{display:none}
.rh-reader-toc-panel{width:min(360px,86%);height:100%;background:rgba(var(--surface-rgb,22,24,27),.96);border-left:1px solid var(--border-glass);display:flex;flex-direction:column;min-height:0}
.rh-reader-toc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;border-bottom:1px solid var(--border-glass);font-size:.9rem}
.rh-reader-toc-list{flex:1;min-height:0;overflow-y:auto;padding:6px}
.rh-reader-toc-item{display:block;width:100%;text-align:left;border:1px solid transparent;background:transparent;color:var(--text-dim);border-radius:6px;padding:9px 10px;cursor:pointer;font:inherit;font-size:.86rem}
.rh-reader-toc-item:hover{background:rgba(var(--accent-rgb),.08);color:var(--text)}
.rh-reader-toc-item.is-current{border-color:rgba(var(--accent-rgb),.36);background:rgba(var(--accent-rgb),.10);color:var(--text)}
.rh-reader[data-crop="true"] .rh-reader-page{padding-left:6px;padding-right:6px}
@media (max-width:640px){
  .rh-reader-page{padding:52px 16px 128px}
  .rh-reader-btn{font-size:.76rem;padding:7px 6px;gap:4px}
  .rh-reader-top,.rh-reader-bottom{padding-left:10px;padding-right:10px}
  .rh-reader-actions{gap:0}
}
`;

export function mountReader(root: HTMLElement, options: ReaderOptions): ReaderHandle {
  const controller = new ReaderController(options.chapters, options.initial);
  root.innerHTML = `${`<style>${STYLE}</style>`}
<div class="rh-reader" data-mode="vertical" data-crop="false">
  <div class="rh-reader-stage" data-role="stage">
    <div class="rh-reader-page" data-role="page"></div>
    <div class="rh-reader-toast" data-role="toast"></div>
    <div class="rh-reader-toc is-hidden" data-role="toc">
      <div class="rh-reader-toc-panel">
        <div class="rh-reader-toc-head"><span>${esc(options.labels.tocTitle)}</span>
          <button class="rh-reader-btn" data-action="close-toc">${icon("close")}<span>${esc(options.labels.close)}</span></button></div>
        <div class="rh-reader-toc-list" data-role="toc-list"></div>
      </div>
    </div>
  </div>
  <header class="rh-reader-bar rh-reader-top">
    <button class="rh-reader-btn" data-action="exit">${icon("exit")}<span>${esc(options.labels.exit)}</span></button>
    <div class="rh-reader-title" data-role="title"></div>
    <button class="rh-reader-btn" data-action="toc">${icon("toc")}<span>${esc(options.labels.toc)}</span></button>
  </header>
  <footer class="rh-reader-bar rh-reader-bottom">
    <div class="rh-reader-progress">
      <input type="range" min="0" max="1000" value="0" data-role="progress" aria-label="${esc(options.labels.progress)}">
      <span data-role="progress-label"></span>
    </div>
    <div class="rh-reader-actions">
      <button class="rh-reader-btn" data-action="lock">${icon("lock")}<span>${esc(options.labels.lock)}</span></button>
      <button class="rh-reader-btn" data-action="autoplay">${icon("play")}<span>${esc(options.labels.autoplay)}</span></button>
      <button class="rh-reader-btn" data-action="speed">${icon("speed")}<span data-role="speed"></span></button>
      <button class="rh-reader-btn" data-action="next-chapter">${icon("next")}<span>${esc(options.labels.nextChapter)}</span></button>
      <button class="rh-reader-btn" data-action="crop">${icon("crop")}<span>${esc(options.labels.crop)}</span></button>
      <button class="rh-reader-btn" data-action="mode">${icon("mode")}<span data-role="mode"></span></button>
    </div>
  </footer>
</div>`;

  const container = must(root.querySelector<HTMLElement>(".rh-reader"), "container");
  const stage = must(root.querySelector<HTMLElement>('[data-role="stage"]'), "stage");
  const pageEl = must(root.querySelector<HTMLElement>('[data-role="page"]'), "page");
  const topBar = must(root.querySelector<HTMLElement>(".rh-reader-top"), "top bar");
  const bottomBar = must(root.querySelector<HTMLElement>(".rh-reader-bottom"), "bottom bar");
  const titleEl = must(root.querySelector<HTMLElement>('[data-role="title"]'), "title");
  const toastEl = must(root.querySelector<HTMLElement>('[data-role="toast"]'), "toast");
  const tocEl = must(root.querySelector<HTMLElement>('[data-role="toc"]'), "toc");
  const tocList = must(root.querySelector<HTMLElement>('[data-role="toc-list"]'), "toc list");
  const progress = must(root.querySelector<HTMLInputElement>('[data-role="progress"]'), "progress");
  const progressLabel = must(root.querySelector<HTMLElement>('[data-role="progress-label"]'), "progress label");
  const speedLabel = must(root.querySelector<HTMLElement>('[data-role="speed"]'), "speed label");
  const modeLabel = must(root.querySelector<HTMLElement>('[data-role="mode"]'), "mode label");

  let hideTimer: number | undefined;
  let autoplayTimer: number | undefined;
  let toastTimer: number | undefined;
  let longPressTimer: number | undefined;
  let longPressed = false;
  let tocOpen = false;
  let pointerStart: { x: number; y: number; time: number } | null = null;

  const snap = (): ReaderSnapshot => controller.snapshot();

  function pageHtml(page: ReaderPage): string {
    if (page.kind === "image" && page.content) {
      return `<img class="rh-reader-image" src="${esc(page.content)}" alt="">`;
    }
    if (page.kind === "text") {
      const paragraphs = (page.content ?? "")
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => `<p>${esc(part)}</p>`)
        .join("");
      return `<div class="rh-reader-text">${paragraphs}</div>`;
    }
    return `<div class="rh-reader-placeholder">${esc(page.caption ?? "")}</div>`;
  }

  function renderPage(): void {
    pageEl.innerHTML = pageHtml(controller.currentPage);
    pageEl.classList.remove("rh-reader-page-in");
    void pageEl.offsetWidth;
    pageEl.classList.add("rh-reader-page-in");
    pageEl.scrollTop = 0;
  }

  function renderBars(): void {
    const state = snap();
    topBar.classList.toggle("is-hidden", !state.barsVisible);
    bottomBar.classList.toggle("is-hidden", !state.barsVisible);
    titleEl.textContent = controller.currentChapter.title;
    progress.value = String(Math.round(controller.progress() * 1000));
    progressLabel.textContent = `${state.pageIndex + 1} / ${state.pageCount}`;
    speedLabel.textContent = `${options.labels.speed} ${state.speed}×`;
    modeLabel.textContent = `${options.labels.mode} · ${options.labels.modeNames[state.mode]}`;
    const autoplayBtn = root.querySelector<HTMLElement>('[data-action="autoplay"]');
    autoplayBtn?.classList.toggle("is-active", state.autoplay);
    const lockBtn = root.querySelector<HTMLElement>('[data-action="lock"]');
    lockBtn?.classList.toggle("is-active", state.locked);
    const cropBtn = root.querySelector<HTMLElement>('[data-action="crop"]');
    cropBtn?.classList.toggle("is-active", state.cropMode);
  }

  function renderToc(): void {
    tocEl.classList.toggle("is-hidden", !tocOpen);
    if (!tocOpen) return;
    tocList.innerHTML = options.chapters
      .map((chapter, index) => {
        const current = index === snap().chapterIndex ? " is-current" : "";
        return `<button class="rh-reader-toc-item${current}" data-toc="${index}">${index + 1}. ${esc(chapter.title)}</button>`;
      })
      .join("");
  }

  function emitProgress(): void {
    options.onProgress?.(snap());
  }

  function emitChapter(): void {
    options.onChapterChange?.(snap().chapterIndex, controller.currentChapter);
  }

  function showToast(message: string, duration = 1600): void {
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("is-visible"), duration);
  }

  function scheduleHide(): void {
    if (hideTimer) window.clearTimeout(hideTimer);
    const state = snap();
    if (state.locked || !state.barsVisible || tocOpen) return;
    hideTimer = window.setTimeout(() => {
      controller.hideBars();
      renderBars();
    }, 3000);
  }

  function showBars(): void {
    controller.showBars();
    renderBars();
    scheduleHide();
  }

  function toggleBars(): void {
    if (snap().locked) return;
    controller.toggleBars();
    renderBars();
    scheduleHide();
  }

  function syncAutoplay(): void {
    if (autoplayTimer) window.clearInterval(autoplayTimer);
    autoplayTimer = undefined;
    if (!snap().autoplay) return;
    const interval = Math.max(700, Math.round(4200 / snap().speed));
    autoplayTimer = window.setInterval(() => {
      const step = controller.nextPage();
      if (step === "end") {
        controller.setAutoplay(false);
        renderBars();
        showToast(options.labels.lastPage);
        syncAutoplay();
        return;
      }
      if (step === "chapter") emitChapter();
      renderPage();
      renderBars();
      emitProgress();
      scheduleHide();
    }, interval);
  }

  function turnPage(direction: "prev" | "next"): void {
    const step = direction === "next" ? controller.nextPage() : controller.prevPage();
    if (step === "end") {
      showToast(options.labels.lastPage);
      return;
    }
    if (step === "start") {
      showToast(options.labels.firstPage);
      return;
    }
    if (step === "chapter") emitChapter();
    renderPage();
    renderBars();
    emitProgress();
    scheduleHide();
  }

  function unlock(): void {
    controller.unlock();
    renderBars();
    showToast(options.labels.unlockedHint);
    scheduleHide();
  }

  function isInteractive(target: EventTarget | null): boolean {
    return target instanceof Element
      && !!target.closest(".rh-reader-bar, .rh-reader-toc, button, input");
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (isInteractive(event.target)) return;
    const rect = stage.getBoundingClientRect();
    const zone = resolveTapZone(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, snap().mode);
    pointerStart = { x: event.clientX, y: event.clientY, time: Date.now() };
    longPressed = false;
    if (snap().locked && zone === "toggle") {
      longPressTimer = window.setTimeout(() => {
        longPressTimer = undefined;
        longPressed = true;
        pointerStart = null;
        unlock();
      }, 600);
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (longPressTimer) {
      window.clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
    if (longPressed) {
      longPressed = false;
      pointerStart = null;
      return;
    }
    if (!pointerStart) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    const dt = Date.now() - pointerStart.time;
    const start = pointerStart;
    pointerStart = null;
    if (Math.hypot(dx, dy) > 12 || dt > 600) return;
    const rect = stage.getBoundingClientRect();
    const zone = resolveTapZone(
      start.x - rect.left,
      start.y - rect.top,
      rect.width,
      rect.height,
      snap().mode,
    );
    if (snap().locked) {
      if (zone === "prev") turnPage("prev");
      if (zone === "next") turnPage("next");
      return;
    }
    if (zone === "toggle") toggleBars();
    else turnPage(zone);
  };

  const onPointerCancel = (): void => {
    if (longPressTimer) window.clearTimeout(longPressTimer);
    longPressTimer = undefined;
    pointerStart = null;
    longPressed = false;
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const tocItem = target?.closest<HTMLElement>("[data-toc]");
    if (tocItem) {
      const index = Number(tocItem.dataset.toc ?? "0");
      if (controller.setChapter(index, 0)) {
        tocOpen = false;
        renderToc();
        renderPage();
        renderBars();
        emitChapter();
        emitProgress();
        scheduleHide();
      }
      return;
    }
    const el = target?.closest<HTMLElement>("[data-action]");
    if (!el) return;
    switch (el.dataset.action) {
      case "exit":
        options.onExit();
        return;
      case "toc":
        tocOpen = true;
        if (hideTimer) window.clearTimeout(hideTimer);
        renderToc();
        return;
      case "close-toc":
        tocOpen = false;
        renderToc();
        scheduleHide();
        return;
      case "lock": {
        const locked = controller.toggleLock();
        renderBars();
        showToast(locked ? options.labels.lockedHint : options.labels.unlockedHint, 2200);
        if (!locked) scheduleHide();
        return;
      }
      case "autoplay":
        controller.toggleAutoplay();
        renderBars();
        syncAutoplay();
        showToast(controller.snapshot().autoplay ? `${options.labels.autoplay} ${controller.snapshot().speed}×` : options.labels.autoplay);
        scheduleHide();
        return;
      case "speed": {
        const speed = controller.cycleSpeed();
        renderBars();
        syncAutoplay();
        showToast(`${options.labels.speed} ${speed}×`);
        scheduleHide();
        return;
      }
      case "next-chapter": {
        const next = snap().chapterIndex + 1;
        if (!controller.setChapter(next, 0)) {
          showToast(options.labels.lastChapter);
          return;
        }
        renderPage();
        renderBars();
        emitChapter();
        emitProgress();
        scheduleHide();
        return;
      }
      case "crop": {
        const on = controller.toggleCrop();
        container.dataset.crop = on ? "true" : "false";
        renderBars();
        showToast(options.labels.cropPending);
        scheduleHide();
        return;
      }
      case "mode": {
        const mode = controller.cycleMode();
        container.dataset.mode = mode;
        renderBars();
        showToast(options.labels.modeNames[mode]);
        scheduleHide();
        return;
      }
      default:
        return;
    }
  };

  const onProgressInput = (): void => {
    if (hideTimer) window.clearTimeout(hideTimer);
    controller.setProgress(Number(progress.value) / 1000);
    pageEl.innerHTML = pageHtml(controller.currentPage);
    renderBars();
    emitProgress();
  };

  const onProgressChange = (): void => scheduleHide();

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", onPointerCancel);
  root.addEventListener("click", onClick);
  progress.addEventListener("input", onProgressInput);
  progress.addEventListener("change", onProgressChange);
  tocEl.addEventListener("pointerdown", (event) => event.stopPropagation());

  container.dataset.mode = snap().mode;
  container.dataset.crop = snap().cropMode ? "true" : "false";
  renderPage();
  renderBars();
  scheduleHide();

  return {
    destroy(): void {
      if (hideTimer) window.clearTimeout(hideTimer);
      if (autoplayTimer) window.clearInterval(autoplayTimer);
      if (toastTimer) window.clearTimeout(toastTimer);
      if (longPressTimer) window.clearTimeout(longPressTimer);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerCancel);
      root.removeEventListener("click", onClick);
      progress.removeEventListener("input", onProgressInput);
      progress.removeEventListener("change", onProgressChange);
      root.innerHTML = "";
    },
  };
}
