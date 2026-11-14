(() => {
  const language = document.querySelector("main [lang='ja']") ? "ja-JP" : "en-US";
  const rate = document.querySelector("#rate");
  const speech = window.speechSynthesis;
  let current;

  function stop() {
    const playing = current;
    current = undefined;
    playing?.stop();
  }

  function speak(text, { paragraph, word, feedback, onEnd, onCancel } = {}) {
    stop();
    const unavailable = () => {
      if (feedback) feedback.textContent = "设备朗读不可用，请检查浏览器的语音设置。";
    };
    if (!speech || typeof SpeechSynthesisUtterance !== "function") {
      unavailable();
      onEnd?.(true);
      return;
    }
    const voices = speech.getVoices();
    const voice = voices.find(({ lang }) => lang.toLowerCase() === language.toLowerCase())
      ?? voices.find(({ lang }) => lang.split("-")[0] === language.split("-")[0]);
    if (voices.length && !voice) {
      unavailable();
      onEnd?.(true);
      return;
    }
    if (feedback) feedback.textContent = "";
    const utterance = new SpeechSynthesisUtterance(text);
    const words = paragraph ? [...paragraph.querySelectorAll(".vocab-word")] : [];
    if (voice) utterance.voice = voice;
    utterance.lang = language;
    utterance.rate = Number(rate.value);
    const row = paragraph?.closest("li");
    let highlighted;
    function highlight(node) {
      highlighted?.removeAttribute("data-spoken-word");
      highlighted = node;
      highlighted?.setAttribute("data-spoken-word", "");
    }
    function clear() {
      highlight();
      row?.removeAttribute("data-speaking");
    }
    const playing = {
      stop() {
        clear();
        speech.cancel();
        onCancel?.();
      },
    };
    current = playing;
    utterance.onstart = () => {
      if (current !== playing) return;
      row?.setAttribute("data-speaking", "");
      highlight(word);
    };
    utterance.onboundary = ({ charIndex, name }) => {
      if (current !== playing || word || name !== "word") return;
      highlight(words.find(node => Number(node.dataset.offset) <= charIndex
        && charIndex < Number(node.dataset.offset) + node.textContent.length));
    };
    function finish(error) {
      if (current !== playing) return;
      current = undefined;
      clear();
      if (error) unavailable();
      onEnd?.(error);
    }
    utterance.onend = () => finish(false);
    utterance.onerror = () => finish(true);
    speech.speak(utterance);
  }

  function follow(audio, rows, cues, end = Infinity) {
    let active = -1;
    let highlighted;
    let frame;
    function paint(next, word) {
      if (active !== next) {
        rows[active]?.removeAttribute("data-speaking");
        active = next;
        rows[active]?.setAttribute("data-speaking", "");
      }
      if (highlighted !== word) {
        highlighted?.removeAttribute("data-spoken-word");
        highlighted = word;
        highlighted?.setAttribute("data-spoken-word", "");
      }
    }
    function update(event) {
      cancelAnimationFrame(frame);
      const time = audio.currentTime;
      if (time >= end && !audio.paused) audio.pause();
      if (event?.type === "waiting" || audio.paused || audio.ended || audio.seeking || time >= end) {
        paint(-1);
        return;
      }
      const index = cues.findIndex(cue => cue && cue[0] <= time && time < cue[1]);
      const offset = cues[index]?.[2]?.find(([start, finish]) => start <= time && time < finish)?.[2];
      const word = offset === undefined ? undefined : rows[index].querySelector(`.vocab-word[data-offset="${offset}"]`);
      paint(index, word);
      frame = requestAnimationFrame(update);
    }
    const events = ["playing", "pause", "ended", "waiting", "seeking", "seeked", "timeupdate"];
    for (const event of events) audio.addEventListener(event, update);
    update();
    return () => {
      for (const event of events) audio.removeEventListener(event, update);
      cancelAnimationFrame(frame);
      paint(-1);
    };
  }

  function addRows(list, feedback, { source, cues = [] } = {}) {
    const rows = [...list.children];
    const paragraphs = rows.map(row => row.querySelector("p[lang]"));
    paragraphs.forEach((paragraph, index) => {
      const cue = cues[index];
      const recorded = Boolean(source && cue);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button secondary line-play";
      if (recorded) {
        button.classList.add("line-play-icon");
        button.title = "听这句";
        button.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 14v-3a9 9 0 0 1 18 0v3"/>
          <rect x="3" y="12" width="5" height="8" rx="2"/>
          <rect x="16" y="12" width="5" height="8" rx="2"/>
        </svg>`;
      } else {
        button.textContent = "朗读";
      }
      button.setAttribute("aria-label", `${recorded ? "听这句" : "朗读"}，第 ${index + 1} 句，${recorded ? "真人原声" : "设备语音"}`);
      rows[index].classList.add("audio-line");
      rows[index].append(button);
      button.addEventListener("click", () => {
        if (!recorded) {
          speak(paragraph.textContent, { paragraph, feedback });
          return;
        }
        stop();
        feedback.textContent = "";
        const audio = new Audio(source);
        audio.preload = "auto";
        audio.currentTime = cue[0];
        audio.preservesPitch = true;
        audio.playbackRate = Number(rate.value);
        const detach = follow(audio, [rows[index]], [cue], cue[1]);
        const onRate = () => { audio.playbackRate = Number(rate.value); };
        rate.addEventListener("change", onRate);
        const playing = {
          stop() {
            detach();
            rate.removeEventListener("change", onRate);
            audio.pause();
          },
        };
        current = playing;
        const finish = (error) => {
          if (current !== playing) return;
          stop();
          if (error) feedback.textContent = "原声音频未能播放，请再试一次。";
        };
        audio.addEventListener("pause", () => finish(false), { once: true });
        audio.addEventListener("ended", () => finish(false), { once: true });
        audio.addEventListener("error", () => finish(true), { once: true });
        audio.play().catch(() => finish(true));
      });
    });
    return { rows, paragraphs, cues };
  }

  function readAll(paragraphs, feedback, onEnd) {
    let next = 0;
    function advance(error) {
      if (error || next === paragraphs.length) return onEnd();
      const paragraph = paragraphs[next++];
      speak(paragraph.textContent, { paragraph, feedback, onEnd: advance, onCancel: onEnd });
    }
    advance();
  }

  window.addEventListener("pagehide", stop);
  window.practiceAudio = {
    addRows, follow, readAll, speak,
    stop,
    take(stopOther) {
      stop();
      current = { stop: stopOther };
    },
  };
})();
