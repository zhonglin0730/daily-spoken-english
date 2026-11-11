const htmlJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const shanghaiCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

const boundedText = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const fields = (properties) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});

const lessonContent = fields({
  title: boundedText(36),
  goal: boundedText(80),
  listen: fields({ prompt: boundedText(120), en: boundedText(320), zh: boundedText(180) }),
  dialogue: { type: "array", minItems: 6, maxItems: 8, items: fields({ speaker: { type: "string", enum: ["other", "you"] }, en: boundedText(160), zh: boundedText(110) }) },
  phrases: { type: "array", minItems: 5, maxItems: 6, items: fields({ en: boundedText(160), zh: boundedText(110) }) },
  passage: fields({ title: boundedText(36), en: boundedText(650), zh: boundedText(430), recall: boundedText(110) }),
  speak: fields({ prompt: boundedText(150), sample: boundedText(280) }),
});
const lessonSchema = fields({
  date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  category: { type: "string", enum: ["travel", "work"] },
  ...lessonContent.properties,
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

function shanghaiDay(date = new Date()) {
  const parts = Object.fromEntries(shanghaiCalendar.formatToParts(date).map(({ type, value }) => [type, value]));
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
  const { results } = await db.prepare(
    "SELECT day AS date, title FROM daily_lessons ORDER BY day ASC",
  ).bind().all();
  const course = [...results.filter((item) => item.date !== assets.seed.date), { date: assets.seed.date, title: assets.seed.title }]
    .sort((a, b) => a.date.localeCompare(b.date));
  const requested = url.searchParams.get("lesson");
  const index = requested === null
    ? course.findIndex((item) => item.date === url.searchParams.get("date"))
    : /^[1-9]\d*$/.test(requested) ? Number(requested) - 1 : -1;
  const current = index >= 0 && index < course.length ? index : 0;
  const selected = course[current];
  const lesson = await readLesson(db, selected.date) ?? assets.seed;
  const media = lesson.date === assets.seed.date ? assets.seedMedia : null;
  return new Response(assets.template.replace("PAGE_DATA", () => htmlJson({ lesson, media, course, current })), {
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

  const created = await insertLesson(db, lesson);
  const saved = await readLesson(db, lesson.date);
  if (!saved) return toolResult({ error: "课程写入后未能读回。" }, true);
  return toolResult({ created, lesson: saved });
}

async function insertLesson(db, lesson) {
  const result = await db.prepare(
    "INSERT INTO daily_lessons (day, title, payload) VALUES (?, ?, ?) ON CONFLICT(day) DO NOTHING",
  ).bind(lesson.date, lesson.title, JSON.stringify(lesson)).run();
  return result.meta.changes === 1;
}

async function generateLesson(env, scheduledTime) {
  const date = shanghaiDay(new Date(scheduledTime));
  if (await readLesson(env.DB, date)) return;
  const recent = (await archive(env.DB, date)).filter((item) => item.date < date).slice(0, 7);
  const previous = recent.length ? await readLesson(env.DB, recent[0].date) : null;
  const category = previous?.category === "travel" ? "work" : "travel";
  const topic = category === "work"
    ? "本课只练 Java 工作场景。选面试、日会、需求澄清或项目交付中的一个具体任务。"
    : "本课只练旅行场景。选酒店、交通、餐厅、求助或行程变更中的一个具体任务。";
  const request = {
    messages: [{ role: "system", content: [
      "为中文母语者写一节约 10 分钟的入门英语口语课。", topic,
      "title 只写具体任务，例如‘确认新的站台’或‘介绍 Java 工作’。goal 写学员这节课要说清或确认什么。",
      "听力、对话和短文围绕同一个任务。listen.prompt 用中文布置听力任务，不提前透露答案。listen.en 写对方说的话，listen.zh 写中文意思。",
      "dialogue 写 6 至 8 轮自然交谈。speaker 只用 other 或 you，交替出场，每轮都给中英对照。phrases 给 5 至 6 句可迁移的表达。",
      "passage 写一篇 45 至 75 个英语单词的连贯第一人称短文，用常见词和简单句，配中文译文和一句中文复述提示。",
      "speak.prompt 用中文换一个相近情境练同一技能，speak.sample 给英文参考。",
      "不编造用户项目或成绩。避免重复近七课题。输出符合 schema 的 JSON 对象。",
    ].join(" ") }, { role: "user", content: JSON.stringify({ category, recent: recent.map(({ title }) => title) }) }],
    response_format: { type: "json_schema", json_schema: lessonContent },
    max_tokens: 2300,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", request);
    let content = result.response;
    if (typeof content === "string") {
      try { content = JSON.parse(content); } catch { continue; }
    }
    if (!conforms(content, lessonContent)) continue;
    await insertLesson(env.DB, { date, category, ...content });
    console.log(`Daily lesson available for ${date}`);
    return;
  }
  throw new Error(`Invalid generated lesson for ${date}`);
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
  async scheduled(controller, env) {
    await generateLesson(env, controller.scheduledTime);
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return renderPage(env.DB, url);
    if ((request.method === "GET" || request.method === "HEAD") && Object.hasOwn(assets.audio, url.pathname)) {
      return serveAudio(request, assets.audio[url.pathname]);
    }
    if (sitesMcpEnabled && request.method === "POST" && url.pathname === "/mcp") return handleMcp(request, env.DB);
    return new Response("Not found", { status: 404 });
  },
};
