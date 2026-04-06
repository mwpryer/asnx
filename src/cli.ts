import { defineCommand, runMain, type SubCommandsDef } from "citty";

import { hasCachedSchema, loadCachedSchema } from "@/cache";
import { buildEntityCommands } from "@/commands/api";
import { authCommand } from "@/commands/auth";
import { describeCommand } from "@/commands/describe";
import { schemaCommand } from "@/commands/schema";
import { exitWithError } from "@/errors";
import { buildRoutes } from "@/router";

declare const __ASX_VERSION__: string;
declare const __ASX_DESCRIPTION__: string;
const VERSION =
  typeof __ASX_VERSION__ === "string" ? __ASX_VERSION__ : "0.0.0-dev";
const DESCRIPTION =
  typeof __ASX_DESCRIPTION__ === "string"
    ? __ASX_DESCRIPTION__
    : "Agent-first Asana CLI with schema introspection";

const main = defineCommand({
  meta: {
    name: "asx",
    version: VERSION,
    description: DESCRIPTION,
  },
  subCommands: () => {
    const commands: SubCommandsDef = {
      auth: authCommand,
      describe: describeCommand,
      schema: schemaCommand,
    };
    const topLevel = process.argv.slice(2).find((arg) => !arg.startsWith("-"));

    // Keep bootstrap commands usable before schema cache exists
    if (!hasCachedSchema() || topLevel === "auth" || topLevel === "schema") {
      return commands;
    }

    try {
      // Build entity commands from cached schema
      return {
        ...commands,
        ...buildEntityCommands(buildRoutes(loadCachedSchema())),
      };
    } catch (err) {
      exitWithError(err);
    }
  },
});

runMain(main);
