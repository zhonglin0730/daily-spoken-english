import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const path = (name) => new URL(name, root);
const read = (name) => readFile(path(name), "utf8");

const mediaNames = { listen: "listening", dialogue: "dialogue", phrases: "phrases-v2", passage: "passage" };
const [html, css, js, vocabCss, vocabJs, glossary, seedText, teachingText, humanText, recordedText, worker, ...clips] = await Promise.all([
  read("web/index.html"),
  read("web/styles.css"),
  read("web/app.js"),
  read("web/vocabulary.css"),
  read("web/vocabulary.js"),
  read("web/glossary.json"),
  read("seed.json"),
  read("teaching.json"),
  read("human-audio.json"),
  read("recorded-lessons.json"),
  read("worker/index.js"),
  ...Object.values(mediaNames).map((name) => readFile(path(`media/hotel-${name}.wav`))),
]);
const seed = JSON.parse(seedText);
const teaching = JSON.parse(teachingText);
const humanAudio = JSON.parse(humanText);
const recordedLessons = JSON.parse(recordedText);
const template = html.replace("/* PAGE_STYLES */", () => css + "\n" + vocabCss)
  .replace("/* PAGE_SCRIPT */", () => js + "\n" + vocabJs);
const seedMedia = Object.fromEntries(Object.entries(mediaNames).map(([key, name]) => [key, `/media/hotel-${name}.wav`]));
const audio = Object.fromEntries(Object.values(seedMedia).map((url, i) => [url, clips[i].toString("base64")]));
await Promise.all([...new Set(Object.values(humanAudio).map(({ src }) => src))].map(async (url) => {
  audio[url] = (await readFile(path(url.slice(1)))).toString("base64");
}));
const seedHuman = humanAudio[seed.date];
const preview = {
  lesson: { ...seed, ...teaching[seed.date] },
  course: [{ date: seed.date, title: seed.title }],
  current: 0,
  media: Object.fromEntries(Object.entries(seedMedia).map(([key, url]) => [key, `data:audio/wav;base64,${audio[url]}`])),
  humanAudio: seedHuman && { ...seedHuman, src: `data:audio/mpeg;base64,${audio[seedHuman.src]}` },
};
const bundle = `const assets = ${JSON.stringify({ template, seed, seedMedia, teaching, humanAudio, recordedLessons, audio, glossary })};\n`;

await Promise.all(["dist/server/", "dist/.openai/", "dist/drizzle/", "dist/static/recordings/"].map((name) => mkdir(path(name), { recursive: true })));
const recordedPaths = new Set(Object.values(recordedLessons).flatMap(({ recordings }) =>
  Object.values(recordings).map(({ src }) => src)));
await Promise.all([...recordedPaths].map((url) => copyFile(path(`media${url}`), path(`dist/static${url}`))));
await Promise.all([
  writeFile(path("dist/server/index.js"), `${bundle}const sitesMcpEnabled = true;\n${worker}`),
  writeFile(path("dist/server/cloudflare.js"), `${bundle}const sitesMcpEnabled = false;\n${worker}`),
  writeFile(path("dist/preview.html"), template.replace("PAGE_DATA", () => JSON.stringify(preview).replaceAll("<", "\\u003c"))),
  copyFile(path(".openai/hosting.json"), path("dist/.openai/hosting.json")),
  copyFile(path("drizzle/0000_daily_lessons.sql"), path("dist/drizzle/0000_daily_lessons.sql")),
  copyFile(path("web/glossary.json"), path("dist/static/glossary.json")),
]);
console.log("已构建 Worker 和可独立打开的 dist/preview.html");
