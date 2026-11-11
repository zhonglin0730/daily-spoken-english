const byId = (id) => document.getElementById(id);
const { lesson, archive, media } = JSON.parse(byId("page-data").textContent);
const speed = byId("rate");
const complete = byId("complete");
const completionKey = `daily-english:${lesson.date}`;
const speech = window.speechSynthesis;
let playback;

function formatDate(date) {
  const [, month, day] = date.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
}

document.title = `${lesson.title} · 英语随手练`;
byId("lesson-date").dateTime = lesson.date;
byId("lesson-date").textContent = formatDate(lesson.date);
byId("category").textContent = lesson.category === "work" ? "工作" : "旅行";
byId("lesson-title").textContent = lesson.title;
byId("lesson-goal").textContent = lesson.goal;
byId("listen-prompt").textContent = lesson.listen.prompt;
byId("listen-en").textContent = lesson.listen.en;
byId("listen-zh").textContent = lesson.listen.zh;
byId("speak-prompt").textContent = lesson.speak.prompt;
byId("speak-sample").textContent = lesson.speak.sample;

for (const phrase of lesson.phrases) {
  const item = document.createElement("li");
  const english = document.createElement("p");
  english.className = "english";
  english.lang = "en";
  english.textContent = phrase.en;
  const translation = document.createElement("p");
  translation.className = "translation";
  translation.textContent = phrase.zh;
  item.append(english, translation);
  byId("phrases").append(item);
}

for (const item of archive) {
  if (item.date === lesson.date) continue;
  const li = document.createElement("li");
  const link = document.createElement("a");
  link.href = `/?date=${encodeURIComponent(item.date)}`;
  link.textContent = `${formatDate(item.date)} · ${item.title}`;
  li.append(link);
  byId("archive-items").append(li);
}
if (byId("archive-items").childElementCount) {
  byId("archive").hidden = false;
  byId("archive-link").hidden = false;
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
