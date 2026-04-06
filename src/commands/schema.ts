import { defineCommand } from "citty";

import { loadCachedSchema, updateSchemaCache } from "@/cache";
import type { CompiledSchema } from "@/compiler";
import { runOrExit } from "@/errors";
import { printSuccess } from "@/output";

function schemaInfo(schema: CompiledSchema) {
  return {
    version: schema.version,
    generated: schema.generated,
    source: schema.source,
    stats: schema.stats,
  };
}

export const schemaCommand = defineCommand({
  meta: { name: "schema", description: "Manage API schema cache" },
  subCommands: {
    update: defineCommand({
      meta: { name: "update", description: "Fetch and compile OpenAPI spec" },
      run: runOrExit(async () => {
        const schema = await updateSchemaCache();
        printSuccess("schema.update", schemaInfo(schema));
      }),
    }),
    version: defineCommand({
      meta: { name: "version", description: "Show cached schema version" },
      run: runOrExit(() => {
        const schema = loadCachedSchema();
        printSuccess("schema.version", schemaInfo(schema));
      }),
    }),
  },
});
