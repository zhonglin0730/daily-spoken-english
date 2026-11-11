const htmlJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const shanghaiCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

const boundedText = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const fields = (properties) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});

const lessonSchema = fields({
  date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  category: { type: "string", enum: ["travel", "work"] },
  title: boundedText(36),
  goal: boundedText(80),
  listen: fields({ prompt: boundedText(120), en: boundedText(320), zh: boundedText(180) }),
  phrases: { type: "array", minItems: 3, maxItems: 4, items: fields({ en: boundedText(160), zh: boundedText(110) }) },
  speak: fields({ prompt: boundedText(150), sample: boundedText(280) }),
});

const tools = [
  {
    name: "read_daily_english",
    description: "读取北京时间日期、最近课程和是否已经发布当天课程。",
    inputSchema: fields({}),
  },
  {
    name: "publish_daily_english",
    description: "发布北京时间当天的一课。同日重复调用会读回既有课程。",
    inputSchema: fields({ lesson: lessonSchema }),
  },
];

function conforms(value, schema) {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.keys(value).length === schema.required.length && schema.required.every(
      (key) => Object.hasOwn(value, key) && conforms(value[key], schema.properties[key]),
    );
  }
  if (schema.type === "array") {
    return Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems
      && value.every((item) => conforms(item, schema.items));
  }
  if (typeof value !== "string" || !value.trim()) return false;
  if (schema.enum) return schema.enum.includes(value);
  if (schema.pattern) return new RegExp(schema.pattern).test(value);
  return value.length <= schema.maxLength;
}

function shanghaiDay() {
  const parts = Object.fromEntries(shanghaiCalendar.formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function archive(db, today) {
  const { results } = await db.prepare(
    "SELECT day AS date, title FROM daily_lessons WHERE day <= ? ORDER BY day DESC LIMIT 30",
  ).bind(today).all();
  if (!results.some((item) => item.date === assets.seed.date)) {
    results.push({ date: assets.seed.date, title: assets.seed.title });
  }
  return results;
}

async function readLesson(db, date) {
  if (date === assets.seed.date) return assets.seed;
  const row = await db.prepare("SELECT payload FROM daily_lessons WHERE day = ?").bind(date).first();
  return row ? JSON.parse(row.payload) : null;
}

async function renderPage(db, url) {
  const days = await archive(db, shanghaiDay());
  const selected = days.find((item) => item.date === url.searchParams.get("date")) ?? days[0];
  const lesson = await readLesson(db, selected.date) ?? assets.seed;
  const media = lesson.date === assets.seed.date
    ? { listen: "/media/hotel-listening.wav", phrases: "/media/hotel-phrases.wav" }
    : null;
  return new Response(assets.template.replace("PAGE_DATA", () => htmlJson({ lesson, media, archive: days })), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

function serveAudio(request, base64) {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  const headers = new Headers({
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
  });
  const range = request.headers.get("range");
  if (!range) {
    headers.set("Content-Length", bytes.length);
    return new Response(request.method === "HEAD" ? null : bytes, { headers });
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const invalidRange = () => new Response(null, {
    status: 416, headers: { "Content-Range": `bytes */${bytes.length}` },
  });
  if (!match || (!match[1] && !match[2])) return invalidRange();
  const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
  if (start > end) return invalidRange();
  headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
  headers.set("Content-Length", end - start + 1);
  return new Response(request.method === "HEAD" ? null : bytes.subarray(start, end + 1), { status: 206, headers });
}

const toolResult = (data, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(data) }], isError,
});

async function callTool(db, name, args) {
  const today = shanghaiDay();
  if (name === "read_daily_english") {
    return toolResult({ today, current: await readLesson(db, today), recent: (await archive(db, today)).slice(0, 7) });
  }
  if (name !== "publish_daily_english") return toolResult({ error: "未知课程工具。" }, true);

  const lesson = args?.lesson;
  if (!conforms(lesson, lessonSchema) || lesson.date !== today) {
    return toolResult({ error: "请按课程结构提交北京时间当天的内容。", today }, true);
  }
  if (lesson.date === assets.seed.date) return toolResult({ created: false, lesson: assets.seed });

  const result = await db.prepare(
    "INSERT INTO daily_lessons (day, title, payload) VALUES (?, ?, ?) ON CONFLICT(day) DO NOTHING",
  ).bind(lesson.date, lesson.title, JSON.stringify(lesson)).run();
  const saved = await readLesson(db, lesson.date);
  if (!saved) return toolResult({ error: "课程写入后未能读回。" }, true);
  return toolResult({ created: result.meta.changes === 1, lesson: saved });
}

async function handleMcp(request, db) {
  let message;
  try { message = await request.json(); } catch { message = null; }
  const id = message?.id ?? null;
  const respond = (result) => Response.json({ jsonrpc: "2.0", id, result });
  const error = (code, message) => Response.json({ jsonrpc: "2.0", id, error: { code, message } });
  if (message?.jsonrpc !== "2.0") return error(-32600, "Invalid request");
  if (message.method === "server/discover") return respond({ supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
  if (message.method === "tools/list") return respond({ tools });
  if (message.method !== "tools/call") return error(-32601, "Method not found");
  if (!request.headers.get("oai-authenticated-user-id")) return error(-32001, "Site identity required");
  return respond(await callTool(db, message.params?.name, message.params?.arguments));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return renderPage(env.DB, url);
    if ((request.method === "GET" || request.method === "HEAD") && Object.hasOwn(assets.audio, url.pathname)) {
      return serveAudio(request, assets.audio[url.pathname]);
    }
    if (request.method === "POST" && url.pathname === "/mcp") return handleMcp(request, env.DB);
    return new Response("Not found", { status: 404 });
  },
};
