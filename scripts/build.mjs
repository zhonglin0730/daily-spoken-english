import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const path = (name) => new URL(name, root);
const read = (name) => readFile(path(name), "utf8");

const mediaNames = { listen: "listening", dialogue: "dialogue", phrases: "phrases-v2", passage: "passage" };
const [html, css, js, seedText, worker, ...clips] = await Promise.all([
  read("web/index.html"),
  read("web/styles.css"),
  read("web/app.js"),
  read("seed.json"),
  read("worker/index.js"),
  ...Object.values(mediaNames).map((name) => readFile(path(`media/hotel-${name}.wav`))),
]);
const seed = JSON.parse(seedText);
const template = html.replace("/* PAGE_STYLES */", () => css).replace("/* PAGE_SCRIPT */", () => js);
const seedMedia = Object.fromEntries(Object.entries(mediaNames).map(([key, name]) => [key, `/media/hotel-${name}.wav`]));
const audio = Object.fromEntries(Object.values(seedMedia).map((url, i) => [url, clips[i].toString("base64")]));
const preview = {
  lesson: seed,
  course: [{ date: seed.date, title: seed.title }],
  current: 0,
  media: Object.fromEntries(Object.entries(seedMedia).map(([key, url]) => [key, `data:audio/wav;base64,${audio[url]}`])),
};
const bundle = `const assets = ${JSON.stringify({ template, seed, seedMedia, audio })};\n`;

await Promise.all(["dist/server/", "dist/.openai/", "dist/drizzle/"].map((name) => mkdir(path(name), { recursive: true })));
await Promise.all([
  writeFile(path("dist/server/index.js"), `${bundle}const sitesMcpEnabled = true;\n${worker}`),
  writeFile(path("dist/server/cloudflare.js"), `${bundle}const sitesMcpEnabled = false;\n${worker}`),
  writeFile(path("dist/preview.html"), template.replace("PAGE_DATA", () => JSON.stringify(preview).replaceAll("<", "\\u003c"))),
  copyFile(path(".openai/hosting.json"), path("dist/.openai/hosting.json")),
  copyFile(path("drizzle/0000_daily_lessons.sql"), path("dist/drizzle/0000_daily_lessons.sql")),
]);
console.log("已构建 Worker 和可独立打开的 dist/preview.html");
