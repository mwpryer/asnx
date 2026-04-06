import {
  defineCommand,
  type ArgsDef,
  type CommandDef,
  type SubCommandsDef,
} from "citty";

import { buildArgMap, GLOBAL_FLAG_DEFS } from "@/args";
import { resolveAccountToken } from "@/auth";
import { executeAsanaRequest } from "@/client";
import type { EndpointSpec } from "@/compiler";
import { runOrExit } from "@/errors";
import { printSuccess } from "@/output";
import type { RouteMap } from "@/router";
import { buildHttpRequest, collectInput, validateInput } from "@/validation";

function defineActionCommand(
  entity: string,
  action: string,
  endpoint: EndpointSpec,
): CommandDef {
  const args: ArgsDef = {
    ...buildArgMap(endpoint),
    ...GLOBAL_FLAG_DEFS,
  };

  return defineCommand({
    meta: { name: action, description: endpoint.summary },
    args,
    run: runOrExit(async ({ args: parsed, rawArgs }) => {
      // Pass raw argv, unknown flags only live there
      const collected = collectInput(
        endpoint,
        parsed as Record<string, unknown>,
        rawArgs,
      );
      const validated = validateInput(endpoint, collected);
      const httpRequest = buildHttpRequest(endpoint, validated);
      const account = parsed.account as string | undefined;
      const command = `${entity}.${action}`;

      if (parsed["dry-run"]) {
        printSuccess(
          command,
          {
            method: httpRequest.method,
            path: httpRequest.path,
            query: httpRequest.query ?? null,
            body: httpRequest.body ?? null,
          },
          { dryRun: true },
        );
        return;
      }

      const token = resolveAccountToken(account);
      const response = await executeAsanaRequest(httpRequest, token);
      printSuccess(command, response.data, {
        status: response.status,
        nextPage: response.nextPage,
      });
    }),
  });
}

export function buildEntityCommands(routes: RouteMap): SubCommandsDef {
  const commands: SubCommandsDef = {};

  for (const [entity, actions] of routes) {
    const subs: SubCommandsDef = {};

    for (const [action, endpoint] of actions) {
      subs[action] = defineActionCommand(entity, action, endpoint);
    }

    commands[entity] = defineCommand({
      meta: { name: entity, description: `${actions.size} commands` },
      subCommands: subs,
    });
  }

  return commands;
}
