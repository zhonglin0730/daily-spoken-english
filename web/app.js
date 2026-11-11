const root = document.documentElement;

function fitVirtualPhoneViewport() {
  const width = root.clientWidth;
  const view = window.visualViewport;
  const fittedWidth = view && Math.abs(view.width - width) < width * 0.05 ? width * view.scale : width;
  const deviceWidth = Math.min(window.screen.width || width, fittedWidth);
  // Android desktop-site mode can fit a desktop layout viewport onto a phone.
  const needsCompensation = navigator.maxTouchPoints > 0 && width >= 650
    && deviceWidth > 0 && deviceWidth < 650 && width / deviceWidth >= 1.2;
  root.classList.toggle("virtual-phone", needsCompensation);
  if (needsCompensation) root.style.setProperty("--phone-scale", width / deviceWidth);
  else root.style.removeProperty("--phone-scale");
}

fitVirtualPhoneViewport();
window.addEventListener("resize", fitVirtualPhoneViewport);

const byId = (id) => document.getElementById(id);
const { lesson, course, current, media } = JSON.parse(byId("page-data").textContent);
const speed = byId("rate");
const complete = byId("complete");
const completionKey = `daily-english:${lesson.date}`;
const speech = window.speechSynthesis;
let playback;

const lessonUrl = (index) => `/?lesson=${index + 1}`;

document.title = `${lesson.title} · 英语随手练`;
byId("lesson-number").textContent = `第 ${current + 1} 课`;
byId("category").textContent = lesson.category === "work" ? "工作" : "旅行";
byId("lesson-duration").textContent = lesson.passage ? "约 10 分钟" : "约 5 分钟";
byId("lesson-title").textContent = lesson.title;
byId("lesson-goal").textContent = lesson.goal;
byId("listen-prompt").textContent = lesson.listen.prompt;
byId("listen-en").textContent = lesson.listen.en;
byId("listen-zh").textContent = lesson.listen.zh;
byId("speak-prompt").textContent = lesson.speak.prompt;
byId("speak-sample").textContent = lesson.speak.sample;

function addBilingualLine(list, line, speaker) {
  const item = document.createElement("li");
  if (speaker) {
    const label = document.createElement("p");
    label.className = "translation";
    label.textContent = speaker;
    item.append(label);
  }
  const english = document.createElement("p");
  english.className = "english";
  english.lang = "en";
  english.textContent = line.en;
  const translation = document.createElement("p");
  translation.className = "translation";
  translation.textContent = line.zh;
  item.append(english, translation);
  list.append(item);
}

for (const phrase of lesson.phrases) addBilingualLine(byId("phrases"), phrase);
if (lesson.dialogue?.length) {
  byId("dialogue").hidden = false;
  for (const line of lesson.dialogue) {
    addBilingualLine(byId("dialogue-lines"), line, line.speaker === "you" ? "你" : "对方");
  }
}
if (lesson.passage) {
  byId("passage").hidden = false;
  byId("passage-heading").textContent = lesson.passage.title;
  byId("passage-en").textContent = lesson.passage.en;
  byId("passage-zh").textContent = lesson.passage.zh;
  byId("passage-recall").textContent = lesson.passage.recall;
}

byId("course-title").textContent = `课程目录（${course.length} 节）`;
for (const [index, item] of course.entries()) {
  const li = document.createElement("li");
  const link = document.createElement("a");
  link.href = index === current ? "#lesson-title" : lessonUrl(index);
  link.textContent = `第 ${index + 1} 课 · ${item.title}`;
  if (index === current) link.setAttribute("aria-current", "page");
  li.append(link);
  byId("course-items").append(li);
}
for (const [id, index] of [["previous-lesson", current - 1], ["next-lesson", current + 1]]) {
  if (index < 0 || index >= course.length) continue;
  const link = byId(id);
  link.href = lessonUrl(index);
  link.setAttribute("aria-label", `${link.textContent}，${course[index].title}`);
  link.hidden = false;
  byId("lesson-nav").hidden = false;
}

function displayPlayback(track, state) {
  track.state = state;
  track.button.toggleAttribute("data-playing", state === "playing");
  track.button.textContent = state === "playing" ? "暂停" : state === "paused" ? "继续播放" : track.label;
}

function finishPlayback(track, error = "") {
  if (playback !== track) return;
  playback = undefined;
  displayPlayback(track, "ready");
  track.feedback.textContent = error;
}

function stopPlayback() {
  if (!playback) return;
  const track = playback;
  finishPlayback(track);
  if (track.audio) track.audio.pause();
  else speech.cancel();
}

function beginAudio(track) {
  track.audio.playbackRate = Number(speed.value);
  displayPlayback(track, "playing");
  track.audio.play().catch(() => finishPlayback(track, "音频未能播放，请再试一次。"));
}

function addPlayback(buttonId, feedbackId, text, source) {
  const button = byId(buttonId);
  const label = button.textContent;
  const feedback = byId(feedbackId);
  button.addEventListener("click", () => {
    if (playback?.button === button) {
      if (playback.state === "playing") {
        if (playback.audio) playback.audio.pause();
        else speech.pause();
        displayPlayback(playback, "paused");
      } else if (playback.audio) {
        beginAudio(playback);
      } else {
        speech.resume();
        displayPlayback(playback, "playing");
      }
      return;
    }

    stopPlayback();
    feedback.textContent = "";
    if (!source && (!speech || typeof SpeechSynthesisUtterance !== "function")) {
      feedback.textContent = "此浏览器没有语音朗读，可以打开原文练习。";
      return;
    }

    const track = { button, label, feedback };
    playback = track;
    if (source) {
      track.audio = new Audio(source);
      track.audio.addEventListener("ended", () => finishPlayback(track), { once: true });
      track.audio.addEventListener("error", () => finishPlayback(track, "音频未能播放，请再试一次。"), { once: true });
      beginAudio(track);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = Number(speed.value);
    const voices = speech.getVoices();
    const englishVoice = voices.find((voice) => voice.lang.toLowerCase() === "en-us")
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
    if (englishVoice) utterance.voice = englishVoice;
    else if (voices.length) {
      finishPlayback(track, "设备未提供英语语音，可以打开原文练习。");
      return;
    }
    utterance.onend = () => finishPlayback(track);
    utterance.onerror = () => finishPlayback(track, "英语朗读暂不可用，可以打开原文练习。");
    displayPlayback(track, "playing");
    speech.speak(utterance);
  });
}

addPlayback("play-listen", "listen-feedback", lesson.listen.en, media?.listen);
addPlayback("play-phrases", "phrases-feedback", lesson.phrases.map((phrase) => phrase.en).join(" "), media?.phrases);
if (lesson.dialogue?.length) {
  addPlayback("play-dialogue", "dialogue-feedback", lesson.dialogue.map((line) => line.en).join(" "), media?.dialogue);
}
if (lesson.passage) addPlayback("play-passage", "passage-feedback", lesson.passage.en, media?.passage);
speed.addEventListener("change", () => {
  if (playback?.audio) playback.audio.playbackRate = Number(speed.value);
  else if (playback) stopPlayback();
});
window.addEventListener("pagehide", stopPlayback);

function displayCompletion(done) {
  complete.setAttribute("aria-pressed", String(done));
  complete.textContent = done ? "已练 · 撤销" : "标记已练";
}

try { displayCompletion(localStorage.getItem(completionKey) === "done"); } catch { /* File previews can disable storage. */ }
complete.addEventListener("click", () => {
  const done = complete.getAttribute("aria-pressed") === "false";
  displayCompletion(done);
  try {
    if (done) localStorage.setItem(completionKey, "done");
    else localStorage.removeItem(completionKey);
    byId("completion-feedback").textContent = done ? "已保存在这台设备。" : "";
  } catch {
    byId("completion-feedback").textContent = done ? "已标记。关闭本页后会清除。" : "";
  }
});
