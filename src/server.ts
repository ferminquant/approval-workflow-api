import { createServer, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { createApprovalWorkflowHandler } from "./http/adapter.js";

const handler = createApprovalWorkflowHandler();
const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (request, response) => {
  try {
    const body = await readJsonBody(request);
    const path = new URL(request.url ?? "/", "http://localhost").pathname;

    const apiResponse = await handler({
      method: request.method ?? "GET",
      path,
      headers: normalizeHeaders(request.headers),
      body,
    });

    response.writeHead(apiResponse.status, apiResponse.headers);
    response.end(JSON.stringify(apiResponse.body, null, 2));
  } catch {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        error: {
          code: "invalid_json",
          message: "Request body must be valid JSON.",
        },
      }),
    );
  }
});

server.listen(port, () => {
  console.log(`Approval Workflow API listening on http://localhost:${port}`);
});

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
}
