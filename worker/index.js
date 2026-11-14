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
  grammar: fields({ title: boundedText(45), example: boundedText(160), explanation: boundedText(180), question: boundedText(100), answer: boundedText(160) }),
  connectedSpeech: fields({ sentence: boundedText(160), focus: boundedText(65), instruction: boundedText(180), practice: boundedText(160) }),
});

const teachingPatterns = {
  "could you": {
    title: "用 Could you 礼貌提出请求",
    explanation: "Could you + 动词原形？用来礼貌请求对方做某件事。",
    focus: "could‿you",
    instruction: "could 的尾音 /d/ 连到 you 的 /j/，在日常语速里常听起来接近 /dʒ/。you 说轻一点，重音留给后面的动作。",
    work: ["请同事发给你会议记录。", "Could you send me the meeting notes?"],
    travel: ["请对方再说一遍。", "Could you say that again?"],
  },
  "can you": {
    title: "用 Can you 请求帮忙",
    explanation: "Can you + 动词原形？在对话中可以用来请对方做某件事。",
    focus: "can‿you",
    instruction: "句首 can 通常轻读 /kən/，/n/ 紧接 you 的起音。把重音留给后面的动作。",
    work: ["请同事检查这个请求。", "Can you check this request?"],
    travel: ["请对方指一下去车站的路。", "Can you show me the way to the station?"],
  },
  "can i": {
    title: "用 Can I 询问是否可以做某事",
    explanation: "Can I + 动词原形？用来询问对方是否允许，或表示自己想提出一个请求。",
    focus: "can‿I",
    instruction: "让 can 末尾的 /n/ 直接接 I 的 /aɪ/。can 通常读轻一些，两个词之间不停顿。",
    work: ["问自己能不能先看一下日志。", "Can I look at the logs first?"],
    travel: ["问自己能不能坐这里。", "Can I sit here?"],
  },
  "do i need to": {
    title: "用 Do I need to 确认是否有必要",
    explanation: "Do I need to + 动词原形？用于确认自己是否需要做某一步。",
    focus: "need‿to",
    instruction: "在 to 后面接辅音时，to 常轻读 /tə/。连着说 need to，把重音放在接下来的动作上。",
    work: ["问自己是否需要重跑测试。", "Do I need to run the tests again?"],
    travel: ["问自己是否需要先买票。", "Do I need to buy a ticket first?"],
  },
};

function teachingFromLesson(content, category) {
  for (const { en } of [...content.dialogue, ...content.phrases]) {
    const sentence = en.match(/^[^.!?]+[.!?]?/)?.[0]?.trim();
    const key = sentence?.match(/^(Could you|Can you|Can I|Do I need to)\b/i)?.[0].toLowerCase();
    if (!key || !sentence.endsWith("?")) continue;
    const rule = teachingPatterns[key];
    const [question, answer] = rule[category];
    return {
      grammar: { title: rule.title, example: sentence, explanation: rule.explanation, question, answer },
      connectedSpeech: { sentence, focus: rule.focus, instruction: rule.instruction, practice: "先把标出的词连说两遍，再慢速说整句，最后按日常语速复述。" },
    };
  }
  return null;
}

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

function applyRecording(lesson, recorded) {
  const dialogue = recorded.lesson.dialogue;
  return {
    ...lesson,
    ...recorded.lesson,
    listen: {
      prompt: recorded.listenPrompt,
      en: dialogue.map(({ en }) => en).join(" "),
      zh: dialogue.map(({ zh }) => zh).join(" "),
    },
  };
}

async function renderPage(db, url, recordingsAvailable) {
  const { results } = await db.prepare(
    "SELECT day AS date, title FROM daily_lessons ORDER BY day ASC",
  ).bind().all();
  const course = [...results.filter((item) => item.date !== assets.seed.date), { date: assets.seed.date, title: assets.seed.title }]
    .filter(({ date }) => !recordingsAvailable || Object.hasOwn(assets.recordedLessons, date))
    .map((item) => {
      const title = recordingsAvailable && assets.recordedLessons[item.date]?.lesson.title;
      return title ? { ...item, title } : item;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const requested = url.searchParams.get("lesson");
  const index = requested === null
    ? course.findIndex((item) => item.date === url.searchParams.get("date"))
    : /^[1-9]\d*$/.test(requested) ? Number(requested) - 1 : -1;
  const current = index >= 0 && index < course.length ? index : 0;
  const selected = course[current];
  const core = await readLesson(db, selected.date) ?? assets.seed;
  const recorded = recordingsAvailable ? assets.recordedLessons[core.date] : undefined;
  const lesson = recorded ? applyRecording(core, recorded) : { ...core, ...assets.teaching[core.date] };
  const media = lesson.date === assets.seed.date ? assets.seedMedia : null;
  const humanAudio = recorded ? undefined : assets.humanAudio[lesson.date];
  const recordings = recorded?.recordings;
  const dialogueTiming = recordings && assets.dialogueTiming[recordings.dialogue.src];
  return new Response(assets.template.replace("PAGE_DATA", () => htmlJson({ lesson, media, humanAudio, recordings, dialogueTiming, course, current })), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

function serveAudio(request, bytes, contentType) {
  const headers = new Headers({
    "Content-Type": contentType,
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

async function generateLesson(env, date) {
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
      "对话里至少有一句独立的实际请求或问题。用 Could you、Can you、Can I 或 Do I need to 开头，以问号收尾。",
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
    let practice = teachingFromLesson(content, category);
    if (!practice) {
      const phrase = category === "work"
        ? { en: "Could you send me the details?", zh: "能把详细信息发给我吗？" }
        : { en: "Could you say that again?", zh: "您能再说一遍吗？" };
      content.phrases = [...content.phrases.slice(0, 5), phrase];
      practice = teachingFromLesson(content, category);
    }
    await insertLesson(env.DB, { date, category, ...content, ...practice });
    console.log(`Daily lesson draft available for ${date}`);
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
    const date = shanghaiDay(new Date(controller.scheduledTime));
    const recorded = assets.recordedLessons[date];
    if (!recorded) {
      await generateLesson(env, date);
    } else if (!await readLesson(env.DB, date)) {
      await insertLesson(env.DB, applyRecording({ date }, recorded));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return renderPage(env.DB, url, Boolean(env.RECORDINGS));
    if (request.method === "GET" && Object.hasOwn(assets.technicalPages, url.pathname)) {
      return new Response(assets.technicalPages[url.pathname], {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (request.method === "GET" && url.pathname === "/glossary.json") return new Response(assets.glossary, {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
    if (request.method === "GET" || request.method === "HEAD") {
      if (Object.hasOwn(assets.audio, url.pathname)) {
        const contentType = url.pathname.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
        return serveAudio(request, Uint8Array.fromBase64(assets.audio[url.pathname]), contentType);
      }
      if (env.RECORDINGS && /^\/recordings\/[a-z0-9-]+\.mp3$/.test(url.pathname)) {
        if (!request.headers.has("Range")) return env.RECORDINGS.fetch(request);
        const full = await env.RECORDINGS.fetch(new Request(request.url));
        if (!full.ok) return full;
        return serveAudio(request, new Uint8Array(await full.arrayBuffer()), "audio/mpeg");
      }
    }
    if (sitesMcpEnabled && request.method === "POST" && url.pathname === "/mcp") return handleMcp(request, env.DB);
    return new Response("Not found", { status: 404 });
  },
};
