(() => {
  let audioCtx = null;
  let masterGain = null;
  let masterCompressor = null;
  let isMuted = localStorage.getItem('hapa-audio-muted') === 'true';
  let globalBound = false;
  let lastHoverAt = 0;

  function getAudioContext() {
    if (!audioCtx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      audioCtx = new AudioCtor();
    }
    return audioCtx;
  }

  function getMasterOutput(ctx) {
    if (!masterGain || !masterCompressor) {
      masterGain = ctx.createGain();
      masterCompressor = ctx.createDynamicsCompressor();

      masterCompressor.threshold.setValueAtTime(-24, ctx.currentTime);
      masterCompressor.knee.setValueAtTime(20, ctx.currentTime);
      masterCompressor.ratio.setValueAtTime(6, ctx.currentTime);
      masterCompressor.attack.setValueAtTime(0.003, ctx.currentTime);
      masterCompressor.release.setValueAtTime(0.12, ctx.currentTime);

      masterGain.gain.setValueAtTime(0.82, ctx.currentTime);
      masterGain.connect(masterCompressor);
      masterCompressor.connect(ctx.destination);
    }
    return masterGain;
  }

  function vary(base, amount) {
    return base * (1 + (Math.random() * 2 - 1) * amount);
  }

  function createTone({ type, startFreq, endFreq, duration, startGain = 0.04, endGain = 0.001 }) {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') void ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(getMasterOutput(ctx));

      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, startFreq), ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), ctx.currentTime + duration);

      gain.gain.setValueAtTime(startGain, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(endGain, ctx.currentTime + duration);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (err) {
      console.error('Audio play failed', err);
    }
  }

  function playHoverSound() {
    const now = performance.now();
    if (now - lastHoverAt < 70) return;
    lastHoverAt = now;
    createTone({ type: 'sine', startFreq: 800, endFreq: 1200, duration: 0.05, startGain: 0.025 });
  }

  function playCardPortalSound(mode = 'blue') {
    if (mode === 'red') {
      createTone({ type: 'sawtooth', startFreq: vary(840, 0.01), endFreq: vary(160, 0.01), duration: 0.11, startGain: 0.05 });
      createTone({ type: 'sine', startFreq: vary(1100, 0.01), endFreq: vary(460, 0.01), duration: 0.085, startGain: 0.018 });
      return;
    }
    createTone({ type: 'sawtooth', startFreq: vary(980, 0.01), endFreq: vary(220, 0.01), duration: 0.12, startGain: 0.04 });
    createTone({ type: 'sine', startFreq: vary(1400, 0.01), endFreq: vary(700, 0.01), duration: 0.09, startGain: 0.016 });
  }

  function playClickSound() {
    createTone({ type: 'square', startFreq: 600, endFreq: 300, duration: 0.08, startGain: 0.045 });
  }

  function playDropdownOpenSound() {
    createTone({ type: 'triangle', startFreq: 500, endFreq: 700, duration: 0.12, startGain: 0.035 });
  }

  function playDropdownSelectSound() {
    createTone({ type: 'sawtooth', startFreq: 900, endFreq: 500, duration: 0.1, startGain: 0.04 });
  }

  function playPickUpSound() {
    createTone({ type: 'triangle', startFreq: 400, endFreq: 800, duration: 0.15, startGain: 0.055 });
  }

  function playDropSound() {
    createTone({ type: 'square', startFreq: 300, endFreq: 80, duration: 0.15, startGain: 0.07 });
  }

  function playCardClickSound() {
    createTone({ type: 'sine', startFreq: 900, endFreq: 520, duration: 0.05, startGain: 0.032 });
  }

  function playCardSnapSound() {
    createTone({ type: 'sawtooth', startFreq: 520, endFreq: 940, duration: 0.06, startGain: 0.033 });
    createTone({ type: 'sine', startFreq: 1200, endFreq: 840, duration: 0.05, startGain: 0.016 });
  }

  function toggleMute() {
    isMuted = !isMuted;
    localStorage.setItem('hapa-audio-muted', String(isMuted));
    return isMuted;
  }

  function getMuteState() {
    return isMuted;
  }

  function bindGlobalUiSounds(root = document) {
    if (globalBound) return;
    globalBound = true;
    root.addEventListener('pointerover', ev => {
      const target = ev.target.closest?.('button, .nav-item, .link-item, .library-card, .portal-card, .sub-home-page-card, .timeline-event-card');
      if (target && !target.dataset.sfxIgnore) playHoverSound();
    }, { passive: true });
    root.addEventListener('focusin', ev => {
      if (ev.target.matches?.('select')) playDropdownOpenSound();
    });
    root.addEventListener('change', ev => {
      if (ev.target.matches?.('select')) playDropdownSelectSound();
    });
    root.addEventListener('click', ev => {
      if (ev.target.closest?.('[data-sfx-ignore]')) return;
      if (ev.target.closest?.('button, a, [data-wikilink]')) playClickSound();
    });
  }

  window.hapaSfx = {
    bindGlobalUiSounds,
    getMuteState,
    toggleMute,
    playHoverSound,
    playCardPortalSound,
    playClickSound,
    playDropdownOpenSound,
    playDropdownSelectSound,
    playPickUpSound,
    playDropSound,
    playCardClickSound,
    playCardSnapSound,
  };
})();
