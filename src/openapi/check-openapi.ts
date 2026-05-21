import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));
const specPath = join(currentDir, "approval-workflow.openapi.json");
const spec = JSON.parse(readFileSync(specPath, "utf8")) as {
  openapi?: string;
  paths?: Record<string, unknown>;
};

const requiredPaths = [
  "/approval-requests",
  "/approval-requests/{requestId}/approve",
  "/approval-requests/{requestId}/reject",
];

if (!spec.openapi?.startsWith("3.")) {
  throw new Error("Expected an OpenAPI 3.x document.");
}

for (const path of requiredPaths) {
  if (!spec.paths?.[path]) {
    throw new Error(`Missing OpenAPI path: ${path}`);
  }
}

console.log("OpenAPI contract check passed.");
