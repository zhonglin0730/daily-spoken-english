import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import worker from "../dist/server/index.js";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(await readFile(new URL("../drizzle/0000_daily_lessons.sql", import.meta.url), "utf8"));
const DB = {
  prepare(sql) {
    const statement = sqlite.prepare(sql);
    return {
      bind(...values) {
        return {
          all: () => ({ results: statement.all(...values) }),
          first: () => statement.get(...values) ?? null,
          run: () => ({ meta: { changes: statement.run(...values).changes } }),
        };
      },
    };
  },
};

const host = "127.0.0.1";
const port = Number(process.argv[2] ?? 4176);
const server = createServer(async (request, response) => {
  try {
    const init = { method: request.method, headers: request.headers };
    if (request.method === "POST") {
      init.body = Readable.toWeb(request);
      init.duplex = "half";
    }
    const result = await worker.fetch(new Request(`http://${host}:${port}${request.url}`, init), { DB });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body) Readable.fromWeb(result.body).pipe(response);
    else response.end();
  } catch (error) {
    console.error(error);
    response.writeHead(500).end("Preview error");
  }
});
server.listen(port, host, () => console.log(`Local: http://${host}:${server.address().port}/`));
