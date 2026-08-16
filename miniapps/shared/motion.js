const TARGET_FPS = 30;
const MAX_DELTA_MS = 50;
const MAX_DPR = 1.5;
const MAX_CANVAS_PIXELS = 1_500_000;
const mountedCanvases = new WeakMap();

export function deriveNetworkMotionState({
  ready,
  pageVisible,
  effectVisible,
  pausedByUser,
  reducedMotion,
  saveData,
}) {
  if (!ready || reducedMotion || saveData) return 'blocked';
  if (pausedByUser) return 'paused';
  if (!pageVisible || !effectVisible) return 'waiting';
  return 'playing';
}

export function computeCanvasBackingStore({
  cssWidth,
  cssHeight,
  devicePixelRatio,
  maxDpr = MAX_DPR,
  maxPixels = MAX_CANVAS_PIXELS,
}) {
  const width = Math.max(1, Number.isFinite(cssWidth) ? cssWidth : 1);
  const height = Math.max(1, Number.isFinite(cssHeight) ? cssHeight : 1);
  const requestedScale = Math.min(maxDpr, Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
  const pixelLimitedScale = Math.sqrt(maxPixels / (width * height));
  const scale = Math.min(requestedScale, pixelLimitedScale);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
  };
}

export function createFrameScheduler({
  draw,
  canRender,
  requestFrame,
  cancelFrame,
  targetFps = TARGET_FPS,
}) {
  const frameInterval = 1000 / targetFps;
  let frameId = 0;
  let lastPresented = null;
  let lastSimulation = null;

  function schedule() {
    if (!frameId && canRender()) frameId = requestFrame(frame);
  }

  function frame(now) {
    frameId = 0;
    if (!canRender()) {
      lastPresented = null;
      lastSimulation = null;
      return;
    }

    if (lastPresented === null || now - lastPresented >= frameInterval) {
      const deltaMs = lastSimulation === null
        ? frameInterval
        : Math.min(Math.max(0, now - lastSimulation), MAX_DELTA_MS);
      lastPresented = now;
      lastSimulation = now;
      draw({ now, deltaMs });
    }
    schedule();
  }

  return {
    start: schedule,
    stop() {
      if (frameId) cancelFrame(frameId);
      frameId = 0;
      lastPresented = null;
      lastSimulation = null;
    },
  };
}

function createNodes(count) {
  return Array.from({ length: count }, (_, index) => ({
    x: ((index * 47) % 101) / 100,
    y: ((index * 71 + 19) % 103) / 102,
    vx: (((index * 13) % 9) - 4) * 0.000012,
    vy: (((index * 17) % 9) - 4) * 0.00001,
    radius: 1.5 + (index % 4) * 0.7,
  }));
}

function labelsFor(language, state, pausedByUser) {
  const spanish = language === 'es-MX';
  if (state === 'blocked') {
    return spanish
      ? { button: 'Movimiento automático no disponible', status: 'Se muestra una composición estática.' }
      : { button: 'Automatic motion unavailable', status: 'A static composition is shown.' };
  }
  return {
    button: pausedByUser
      ? (spanish ? 'Reanudar movimiento automático' : 'Resume automatic motion')
      : (spanish ? 'Pausar movimiento automático' : 'Pause automatic motion'),
    status: {
      playing: spanish ? 'El movimiento automático está activo.' : 'Automatic motion is playing.',
      waiting: spanish ? 'El movimiento espera hasta que esta sección sea visible.' : 'Motion will resume when this section is visible.',
      paused: spanish ? 'El movimiento automático está en pausa.' : 'Automatic motion is paused.',
    }[state],
  };
}

export function mountNetworkMotion({ document: page, language = () => 'en' } = {}) {
  const canvas = page?.querySelector?.('[data-network-canvas]');
  if (!canvas) return { destroy() {} };
  const previous = mountedCanvases.get(canvas);
  if (previous) return previous;

  const view = page.defaultView;
  const context = canvas.getContext?.('2d');
  const toggle = page.querySelector('[data-motion-toggle]');
  const status = page.querySelector('[data-motion-status]');
  if (!view || !context || !toggle || !status) return { destroy() {} };

  const reduceMotion = view.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = view.navigator?.connection;
  const nodes = createNodes(28);
  let ready = false;
  let pageVisible = !page.hidden;
  let effectVisible = false;
  let pausedByUser = false;
  let destroyed = false;
  let cssWidth = 1;
  let cssHeight = 1;
  let canvasScale = 1;
  let currentState = 'blocked';

  function drawNetwork({ deltaMs = 0 } = {}) {
    if (destroyed) return;
    const moving = currentState === 'playing';
    if (moving) {
      for (const node of nodes) {
        node.x += node.vx * deltaMs;
        node.y += node.vy * deltaMs;
        if (node.x < 0 || node.x > 1) {
          node.x = Math.min(1, Math.max(0, node.x));
          node.vx *= -1;
        }
        if (node.y < 0 || node.y > 1) {
          node.y = Math.min(1, Math.max(0, node.y));
          node.vy *= -1;
        }
      }
    }

    context.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.lineWidth = 0.8;
    for (let first = 0; first < nodes.length; first += 1) {
      for (let second = first + 1; second < nodes.length; second += 1) {
        const a = nodes[first];
        const b = nodes[second];
        const dx = (a.x - b.x) * cssWidth;
        const dy = (a.y - b.y) * cssHeight;
        const distance = Math.hypot(dx, dy);
        if (distance > 150) continue;
        context.strokeStyle = `rgba(40, 108, 132, ${0.13 * (1 - distance / 150)})`;
        context.beginPath();
        context.moveTo(a.x * cssWidth, a.y * cssHeight);
        context.lineTo(b.x * cssWidth, b.y * cssHeight);
        context.stroke();
      }
    }
    for (const [index, node] of nodes.entries()) {
      context.fillStyle = index % 9 === 0 ? 'rgba(185, 145, 99, 0.5)' : 'rgba(35, 103, 129, 0.42)';
      context.beginPath();
      context.arc(node.x * cssWidth, node.y * cssHeight, node.radius, 0, Math.PI * 2);
      context.fill();
    }
  }

  const scheduler = createFrameScheduler({
    draw: drawNetwork,
    canRender: () => !destroyed && currentState === 'playing',
    requestFrame: (callback) => view.requestAnimationFrame(callback),
    cancelFrame: (id) => view.cancelAnimationFrame(id),
  });

  function resizeCanvas() {
    if (destroyed) return;
    const bounds = canvas.getBoundingClientRect();
    cssWidth = Math.max(1, bounds.width);
    cssHeight = Math.max(1, bounds.height);
    const backing = computeCanvasBackingStore({
      cssWidth,
      cssHeight,
      devicePixelRatio: view.devicePixelRatio,
    });
    canvas.width = backing.width;
    canvas.height = backing.height;
    canvasScale = backing.scale;
    ready = true;
    reconcile();
  }

  function reconcile() {
    if (destroyed) return;
    currentState = deriveNetworkMotionState({
      ready,
      pageVisible,
      effectVisible,
      pausedByUser,
      reducedMotion: reduceMotion.matches,
      saveData: Boolean(connection?.saveData),
    });
    if (currentState === 'playing') scheduler.start();
    else {
      scheduler.stop();
      if (ready && effectVisible && pageVisible) drawNetwork();
    }

    const labels = labelsFor(language(), currentState, pausedByUser);
    toggle.disabled = currentState === 'blocked';
    toggle.textContent = labels.button;
    status.textContent = labels.status;
  }

  function onToggle() {
    pausedByUser = !pausedByUser;
    reconcile();
  }

  function onVisibilityChange() {
    pageVisible = !page.hidden;
    reconcile();
  }

  function onPolicyChange() {
    reconcile();
  }

  function onLanguageChange() {
    reconcile();
  }

  const observer = typeof view.IntersectionObserver === 'function'
    ? new view.IntersectionObserver((entries) => {
      const entry = entries.find(({ target }) => target === canvas);
      if (!entry) return;
      effectVisible = entry.isIntersecting && entry.intersectionRatio > 0;
      reconcile();
    }, { threshold: [0, 0.01] })
    : null;

  if (observer) observer.observe(canvas);
  else effectVisible = true;
  toggle.addEventListener('click', onToggle);
  page.addEventListener('visibilitychange', onVisibilityChange);
  page.addEventListener('cabohealth:languagechange', onLanguageChange);
  reduceMotion.addEventListener('change', onPolicyChange);
  connection?.addEventListener?.('change', onPolicyChange);
  view.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  const controller = {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      scheduler.stop();
      observer?.disconnect();
      toggle.removeEventListener('click', onToggle);
      page.removeEventListener('visibilitychange', onVisibilityChange);
      page.removeEventListener('cabohealth:languagechange', onLanguageChange);
      reduceMotion.removeEventListener('change', onPolicyChange);
      connection?.removeEventListener?.('change', onPolicyChange);
      view.removeEventListener('resize', resizeCanvas);
      canvas.width = 1;
      canvas.height = 1;
      mountedCanvases.delete(canvas);
    },
  };
  mountedCanvases.set(canvas, controller);
  return controller;
}
