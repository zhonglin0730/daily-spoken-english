import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const path = (name) => new URL(name, root);
const read = (name) => readFile(path(name), "utf8");

const [html, css, js, seedText, worker, listening, phrases] = await Promise.all([
  read("web/index.html"),
  read("web/styles.css"),
  read("web/app.js"),
  read("seed.json"),
  read("worker/index.js"),
  readFile(path("media/hotel-listening.wav")),
  readFile(path("media/hotel-phrases.wav")),
]);
const seed = JSON.parse(seedText);
const template = html.replace("/* PAGE_STYLES */", () => css).replace("/* PAGE_SCRIPT */", () => js);
const audio = {
  "/media/hotel-listening.wav": listening.toString("base64"),
  "/media/hotel-phrases.wav": phrases.toString("base64"),
};
const toDataUrl = (bytes) => `data:audio/wav;base64,${bytes}`;
const preview = {
  lesson: seed,
  archive: [],
  media: {
    listen: toDataUrl(audio["/media/hotel-listening.wav"]),
    phrases: toDataUrl(audio["/media/hotel-phrases.wav"]),
  },
};

await Promise.all(["dist/server/", "dist/.openai/", "dist/drizzle/"].map((name) => mkdir(path(name), { recursive: true })));
await Promise.all([
  writeFile(path("dist/server/index.js"), `const assets = ${JSON.stringify({ template, seed, audio })};\n${worker}`),
  writeFile(path("dist/preview.html"), template.replace("PAGE_DATA", () => JSON.stringify(preview).replaceAll("<", "\\u003c"))),
  copyFile(path(".openai/hosting.json"), path("dist/.openai/hosting.json")),
  copyFile(path("drizzle/0000_daily_lessons.sql"), path("dist/drizzle/0000_daily_lessons.sql")),
]);
console.log("已构建 Worker 和可独立打开的 dist/preview.html");
