import { defineCommand } from "citty";

import { loadCachedSchema } from "@/cache";
import { CliError, runOrExit } from "@/errors";
import { printSuccess } from "@/output";
import { buildRoutes, resolveRoute } from "@/router";

export const describeCommand = defineCommand({
  meta: { name: "describe", description: "Introspect CLI commands" },
  args: {
    entity: { type: "positional", description: "Entity name", required: false },
    action: {
      type: "positional",
      description: "Action name",
      required: false,
    },
  },
  run: runOrExit(({ args }) => {
    const routes = buildRoutes(loadCachedSchema());
    const { entity, action } = args;

    if (!entity) {
      printSuccess("describe.entities", {
        entities: [...routes.keys()].sort(),
      });
      return;
    }

    const entityActions = routes.get(entity);
    if (!entityActions) {
      throw new CliError({
        kind: "usage",
        message: `Unknown entity: ${entity}`,
      });
    }

    if (!action) {
      const actions = [...entityActions.entries()].map(
        ([actionName, endpoint]) => ({
          action: actionName,
          method: endpoint.method,
          summary: endpoint.summary,
        }),
      );
      printSuccess("describe.entity", { entity, actions });
      return;
    }

    const endpoint = resolveRoute(routes, entity, action);
    if (!endpoint) {
      throw new CliError({
        kind: "usage",
        message: `Unknown action: ${entity} ${action}`,
      });
    }

    printSuccess("describe.endpoint", endpoint);
  }),
});
