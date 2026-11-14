const escape = (value) => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

function listenPractice(language, clips, p) {
  const items = clips.map(({ source, credit, start, end, text, translation, focus }, i) => `
<li data-start="${start}" data-end="${end}">
  ${p(focus)}
  <button class="button secondary" type="button" data-clip aria-label="播放第 ${i + 1} 条真人原声">播放真人原声</button>
  <audio preload="none" src="${escape(source)}"></audio>
  <details><summary>核对原文与中文</summary>${p(text, language)}${p(translation)}
  <p><a href="${escape(credit)}">原录音出处</a></p></details>
</li>`).join("");
  return `<section class="listen" aria-labelledby="technical-listen">
<h2 id="technical-listen">先听真人原声</h2>
<label class="rate">播放语速 <select id="technical-rate"><option value="1">正常 1×</option><option value="0.8">慢速 0.8×</option></select></label>
<ol class="phrases">${items}</ol><p class="feedback" id="technical-audio-status" role="status"></p>
</section>`;
}

function connectListening() {
  const rate = document.querySelector("#technical-rate");
  const feedback = document.querySelector("#technical-audio-status");
  let current;
  for (const button of document.querySelectorAll("[data-clip]")) {
    const row = button.closest("li");
    const audio = row.querySelector("audio");
    const start = Number(row.dataset.start);
    const end = Number(row.dataset.end);
    let frame;
    function stop() {
      cancelAnimationFrame(frame);
      if (current === audio) current = undefined;
      audio.pause();
      button.textContent = "播放真人原声";
      button.removeAttribute("data-playing");
    }
    function watchEnd() {
      if (audio.paused || current !== audio) return;
      if (audio.currentTime >= end) stop();
      else frame = requestAnimationFrame(watchEnd);
    }
    audio.addEventListener("playing", () => {
      cancelAnimationFrame(frame);
      watchEnd();
    });
    audio.addEventListener("timeupdate", () => {
      if (current === audio && audio.currentTime >= end) stop();
    });
    audio.addEventListener("pause", () => {
      if (audio.paused) stop();
    });
    audio.addEventListener("ended", stop);
    audio.addEventListener("loadedmetadata", () => {
      if (current === audio && audio.currentTime < start) audio.currentTime = start;
    });
    button.addEventListener("click", () => {
      if (current === audio) {
        stop();
        return;
      }
      current?.pause();
      current = audio;
      feedback.textContent = "";
      audio.currentTime = start;
      audio.playbackRate = Number(rate.value);
      button.textContent = "暂停";
      button.setAttribute("data-playing", "");
      audio.play().catch(() => {
        if (current !== audio) return;
        stop();
        feedback.textContent = "原声播放失败，请重试。";
      });
    });
  }
  rate.addEventListener("change", () => {
    if (current) current.playbackRate = Number(rate.value);
  });
  window.addEventListener("pagehide", () => current?.pause());
}

export function renderTechnicalPage({ site, language, lessons, lesson, clips, css }) {
  const heading = lesson?.title ?? "技术工作表达";
  const p = (text, lang = "zh-CN") => `<p lang="${lang}">${escape(text)}</p>`;
  const items = lessons.map(({ id, title }) =>
    `<li><a href="/technical/${id}">${escape(title)}</a></li>`).join("");
  const dialogue = lesson?.dialogue.map(([speaker, text, translation]) =>
    `<li><p class="translation">${escape(speaker)}</p>${p(text, language)}${p(translation)}</li>`).join("");
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(heading)} · ${site}</title>${css}
<style>.brand { color: var(--ink); text-decoration: none; } .intro a { color: var(--forest); }
.listen .phrases li { border-color: #627f72; } .listen .phrases button { margin-block: .5rem; }
.listen .phrases details { margin-top: 0; } .listen .phrases a { color: var(--light); }
.listen .phrases audio { display: none; }
.listen .feedback:empty { display: none; }</style>
</head><body>
<header class="topbar"><div class="container topbar-inner"><a class="brand" href="/">${site}</a></div></header>
<main class="container">
<div class="intro">${lesson ? '<a href="/technical">技术工作表达目录</a>' : ''}
<h1>${escape(heading)}</h1></div>
${lesson ? `
${listenPractice(language, clips, p)}
<section class="block" aria-labelledby="memorize"><h2 id="memorize">背诵技术表达</h2>
<p>先看中文试着说，再核对自编示范。</p>${p(lesson.model[1])}
<details><summary>核对背诵原文</summary>${p(lesson.model[0], language)}</details></section>
<section class="block" aria-labelledby="task"><h2 id="task">开口练习</h2>${p(lesson.task)}</section>
<details><summary>看情境对话和表达提示</summary><ol class="phrases">${dialogue}</ol>${p(lesson.note)}</details>
<section class="block" aria-labelledby="variation"><h2 id="variation">换个条件再说</h2>${p(lesson.variation)}
<details><summary>自查要点</summary>${p(lesson.check)}</details></section>
` : `
<p>先听真人原声，再背技术表达，最后换个条件开口练。</p>
<div class="course-directory"><ol>${items}</ol></div>`}
</main>${lesson ? `<script>(${connectListening.toString()})();</script>` : ""}</body></html>`;
}
