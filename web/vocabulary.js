(() => {
  const language = document.querySelector("main [lang='ja']") ? "ja" : "en";
  const key = "vocabulary:" + language + ":v1";
  const normalize = (word) => word.normalize("NFKC").replaceAll("’", "'").toLowerCase();
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(language, { granularity: "word" }) : null;
  const boundaries = language === "ja"
    ? /(遅延証明書|賞味期限|一人暮らし|管理会社|修理業者|採用面接|二次面接|鉄道会社|給湯設備|営業時間|営業停止|生活リズム|希望条件|食生活|最終便|回帰テスト|仕様変更|‿)/g
    : /(‿)/g;
  let entries = new Map();
  try { entries = new Map(Object.entries(JSON.parse(localStorage.getItem(key) ?? "{}"))); } catch {}
  const marked = new Map();
  const wordElements = "main p[lang], main h3[lang], main strong[lang]";
  for (const paragraph of document.querySelectorAll(wordElements)) {
    if (paragraph.lang !== language || paragraph.childElementCount) continue;
    const fragment = document.createDocumentFragment();
    const segments = paragraph.textContent.split(boundaries).flatMap((part, index) => {
      if (index % 2) return [{ segment: part, isWordLike: true }];
      return segmenter ? [...segmenter.segment(part)] : Array.from(
        part.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|[^\p{L}\p{M}]+/gu),
        ([segment]) => ({ segment, isWordLike: true }),
      );
    });
    let offset = 0;
    for (const { segment, isWordLike } of segments) {
      const start = offset;
      offset += segment.length;
      if (!isWordLike || !/\p{L}/u.test(segment)) {
        fragment.append(segment);
        continue;
      }
      const node = document.createElement("span");
      const word = normalize(segment);
      node.className = "vocab-word";
      node.dataset.word = word;
      node.dataset.offset = start;
      if (entries.get(word)?.color) node.dataset.color = entries.get(word).color;
      node.textContent = segment;
      if (!marked.has(word)) marked.set(word, []);
      marked.get(word).push(node);
      fragment.append(node);
    }
    paragraph.replaceChildren(fragment);
  }

  const bookButton = document.createElement("button");
  bookButton.className = "button secondary vocab-book";
  bookButton.type = "button";
  bookButton.textContent = "生词本";
  document.querySelector(".topbar-inner").append(bookButton);
  const intro = document.querySelector(".intro");
  const hint = document.createElement("p");
  hint.className = "vocab-hint";
  hint.textContent = "点词听发音，长按或右键查词、标色和收藏。";
  intro.append(hint);
  const playbackStatus = document.createElement("p");
  playbackStatus.className = "feedback";
  playbackStatus.setAttribute("role", "status");
  hint.after(playbackStatus);

  const dialog = document.createElement("dialog");
  dialog.className = "vocab-dialog";
  dialog.setAttribute("aria-labelledby", "vocab-title");
  dialog.innerHTML = `
    <div class="vocab-heading">
      <h2 id="vocab-title"></h2>
      <form method="dialog"><button class="button secondary">关闭</button></form>
    </div>
    <section id="vocab-detail" hidden>
      <button type="button" class="button secondary" id="vocab-pronounce">设备发音</button>
      <p id="vocab-meaning" role="status"></p>
      <p><a id="vocab-external" hidden target="_blank" rel="noopener">查看外部词典</a></p>
      <fieldset><legend>标颜色</legend>
        <button type="button" data-color="yellow" aria-pressed="false">黄</button>
        <button type="button" data-color="green" aria-pressed="false">绿</button>
        <button type="button" data-color="blue" aria-pressed="false">蓝</button>
        <button type="button" data-color="" aria-pressed="false">清除</button>
      </fieldset>
      <button type="button" class="button primary" id="vocab-save"></button>
      <button type="button" class="button secondary" id="vocab-return">生词本</button>
    </section>
    <section id="vocab-list" hidden>
      <form class="vocab-search">
        <input name="word" aria-label="输入词语查义" placeholder="输入词语查义" maxlength="60" required>
        <button class="button secondary">查词</button>
      </form>
      <p id="vocab-empty">还没有收藏的词。</p>
      <ul id="vocab-items"></ul>
    </section>
    <p id="vocab-status" role="status"></p>`;
  document.body.append(dialog);
  const find = (selector) => dialog.querySelector(selector);
  const title = find("#vocab-title");
  const detail = find("#vocab-detail");
  const list = find("#vocab-list");
  const save = find("#vocab-save");
  const status = find("#vocab-status");
  const colors = [...dialog.querySelectorAll("fieldset button")];
  let glossaryRequest;
  let selected;
  let explanation = "";

  function persist() {
    try {
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
      status.textContent = "";
    } catch {
      status.textContent = "此浏览器暂时无法保存，当前页仍可查看。";
    }
  }
  function refreshActions() {
    const entry = entries.get(selected.key);
    save.textContent = entry?.saved ? "移出生词本" : "加入生词本";
    for (const button of colors) button.setAttribute("aria-pressed", String((entry?.color ?? "") === button.dataset.color));
    for (const node of marked.get(selected.key) ?? []) {
      if (entry?.color) node.dataset.color = entry.color;
      else delete node.dataset.color;
    }
  }
  function update(fields) {
    const entry = { word: selected.word, ...entries.get(selected.key), ...fields };
    if (entry.saved || entry.color) entries.set(selected.key, entry);
    else entries.delete(selected.key);
    persist();
    refreshActions();
  }
  function open() {
    if (!dialog.open) dialog.showModal();
  }
  function showBook() {
    selected = undefined;
    detail.hidden = true;
    list.hidden = false;
    title.lang = "zh-CN";
    title.textContent = "生词本";
    const items = find("#vocab-items");
    items.replaceChildren();
    for (const entry of [...entries.values()].filter(({ saved }) => saved).reverse()) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button secondary";
      button.lang = language;
      button.textContent = entry.word;
      if (entry.color) button.dataset.color = entry.color;
      button.addEventListener("click", () => showWord(entry.word));
      item.append(button, entry.meaning ?? "");
      items.append(item);
    }
    find("#vocab-empty").hidden = Boolean(items.childElementCount);
    open();
  }
  async function showWord(word) {
    const selection = { word, key: normalize(word) };
    selected = selection;
    explanation = entries.get(selection.key)?.meaning ?? "";
    title.textContent = word;
    title.lang = language;
    list.hidden = true;
    detail.hidden = false;
    const meaning = find("#vocab-meaning");
    const external = find("#vocab-external");
    meaning.textContent = explanation || "正在查词…";
    external.hidden = true;
    const dictionary = language === "ja" ? "https://cjjc.weblio.jp/content/" : "https://dictionary.cambridge.org/dictionary/english-chinese-simplified/";
    external.href = dictionary + encodeURIComponent(selection.key);
    refreshActions();
    open();
    glossaryRequest ??= fetch("/glossary.json").then(response => {
      if (!response.ok) throw new Error("Glossary unavailable");
      return response.json();
    }).catch(() => {
      glossaryRequest = undefined;
      return {};
    });
    const glossary = await glossaryRequest;
    if (selected !== selection) return;
    if (Object.hasOwn(glossary, selection.key)) explanation = glossary[selection.key];
    meaning.textContent = explanation || "课文词表里暂未找到这个词。";
    external.hidden = Boolean(explanation);
    if (entries.get(selection.key)?.saved && explanation !== entries.get(selection.key)?.meaning) update({ meaning: explanation });
  }
  bookButton.addEventListener("click", showBook);
  find("#vocab-return").addEventListener("click", showBook);
  find("#vocab-pronounce").addEventListener("click", () => {
    practiceAudio.speak(selected.word, { feedback: status });
  });
  save.addEventListener("click", () => update({ saved: !entries.get(selected.key)?.saved, meaning: explanation }));
  for (const button of colors) button.addEventListener("click", () => update({ color: button.dataset.color }));
  find(".vocab-search").addEventListener("submit", event => {
    event.preventDefault();
    const word = event.target.elements.word.value.trim();
    if (word) showWord(word);
  });

  let press;
  function cancelPress() {
    clearTimeout(press?.timer);
    press = undefined;
  }
  document.addEventListener("pointerdown", event => {
    const word = event.target.closest(".vocab-word");
    if (!word || event.pointerType === "mouse" || !event.isPrimary) return;
    cancelPress();
    press = { id: event.pointerId, x: event.clientX, y: event.clientY };
    press.timer = setTimeout(() => {
      cancelPress();
      practiceAudio.stop();
      showWord(word.textContent);
    }, 475);
  });
  document.addEventListener("pointermove", event => {
    if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) cancelPress();
  });
  for (const name of ["pointerup", "pointercancel"]) document.addEventListener(name, event => {
    if (press?.id === event.pointerId) cancelPress();
  });
  document.addEventListener("contextmenu", event => {
    const word = event.target.closest(".vocab-word");
    if (!word) return;
    event.preventDefault();
    if (event.pointerType === "mouse" || (event.button === 2 && !event.pointerType)) {
      practiceAudio.stop();
      showWord(word.textContent);
    }
  });
  document.addEventListener("click", event => {
    const word = event.target.closest(".vocab-word");
    if (!word || dialog.open) return;
    practiceAudio.speak(word.textContent, { word, feedback: playbackStatus });
  });
})();
