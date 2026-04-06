import { describe, expect, test } from "bun:test";

import type { CompiledSchema, EndpointSpec } from "@/compiler";
import { CliError } from "@/errors";
import { buildRoutes, resolveRoute } from "@/router";

function makeEndpoint(
  method: EndpointSpec["method"],
  path: string,
  entity: string,
): EndpointSpec {
  return {
    method,
    path,
    entity,
    summary: `${method} ${path}`,
    pathParams: [],
    queryFields: [],
    bodyFields: [],
  };
}

function makeSchema(...endpoints: EndpointSpec[]): CompiledSchema {
  return {
    version: "1.0",
    generated: "2026-01-01T00:00:00.000Z",
    source: "test",
    stats: {
      endpointCount: endpoints.length,
      bodyEndpointCount: 0,
      fieldCount: 0,
    },
    endpoints,
  };
}

describe("CRUD actions", () => {
  const routes = buildRoutes(
    makeSchema(
      makeEndpoint("GET", "/tasks", "tasks"),
      makeEndpoint("POST", "/tasks", "tasks"),
      makeEndpoint("GET", "/tasks/{task_gid}", "tasks"),
      makeEndpoint("PUT", "/tasks/{task_gid}", "tasks"),
      makeEndpoint("DELETE", "/tasks/{task_gid}", "tasks"),
    ),
  );

  test("GET /tasks -> list", () => {
    const route = resolveRoute(routes, "tasks", "list");
    expect(route).toBeDefined();
    expect(route!.method).toBe("GET");
    expect(route!.path).toBe("/tasks");
  });

  test("POST /tasks -> create", () => {
    const route = resolveRoute(routes, "tasks", "create");
    expect(route).toBeDefined();
    expect(route!.method).toBe("POST");
    expect(route!.path).toBe("/tasks");
  });

  test("GET /tasks/{task_gid} -> get", () => {
    const route = resolveRoute(routes, "tasks", "get");
    expect(route).toBeDefined();
    expect(route!.method).toBe("GET");
    expect(route!.path).toBe("/tasks/{task_gid}");
  });

  test("PUT /tasks/{task_gid} -> update", () => {
    const route = resolveRoute(routes, "tasks", "update");
    expect(route).toBeDefined();
    expect(route!.method).toBe("PUT");
  });

  test("DELETE /tasks/{task_gid} -> delete", () => {
    const route = resolveRoute(routes, "tasks", "delete");
    expect(route).toBeDefined();
    expect(route!.method).toBe("DELETE");
  });
});

describe("for-parent actions", () => {
  const routes = buildRoutes(
    makeSchema(
      makeEndpoint("GET", "/projects/{project_gid}/tasks", "tasks"),
      makeEndpoint("POST", "/projects/{project_gid}/sections", "sections"),
      makeEndpoint(
        "GET",
        "/user_task_lists/{user_task_list_gid}/tasks",
        "tasks",
      ),
      makeEndpoint("GET", "/tasks/{task_gid}/stories", "stories"),
      makeEndpoint("POST", "/tasks/{task_gid}/stories", "stories"),
    ),
  );

  test("GET /projects/{project_gid}/tasks -> for-project", () => {
    const route = resolveRoute(routes, "tasks", "for-project");
    expect(route).toBeDefined();
    expect(route!.path).toBe("/projects/{project_gid}/tasks");
  });

  test("POST /projects/{project_gid}/sections -> create-for-project", () => {
    const route = resolveRoute(routes, "sections", "create-for-project");
    expect(route).toBeDefined();
    expect(route!.method).toBe("POST");
    expect(route!.path).toBe("/projects/{project_gid}/sections");
  });

  test("GET /user_task_lists/{user_task_list_gid}/tasks -> for-user-task-list", () => {
    const route = resolveRoute(routes, "tasks", "for-user-task-list");
    expect(route).toBeDefined();
    expect(route!.path).toBe("/user_task_lists/{user_task_list_gid}/tasks");
  });

  test("GET /tasks/{task_gid}/stories -> for-task", () => {
    const route = resolveRoute(routes, "stories", "for-task");
    expect(route).toBeDefined();
    expect(route!.path).toBe("/tasks/{task_gid}/stories");
    expect(route!.method).toBe("GET");
  });

  test("POST /tasks/{task_gid}/stories -> create-for-task", () => {
    const route = resolveRoute(routes, "stories", "create-for-task");
    expect(route).toBeDefined();
    expect(route!.path).toBe("/tasks/{task_gid}/stories");
    expect(route!.method).toBe("POST");
  });
});

describe("sub-resource actions", () => {
  const routes = buildRoutes(
    makeSchema(
      makeEndpoint("GET", "/tasks/{task_gid}/subtasks", "tasks"),
      makeEndpoint("POST", "/tasks/{task_gid}/subtasks", "tasks"),
      makeEndpoint("GET", "/tasks/{task_gid}/dependencies", "tasks"),
      makeEndpoint("POST", "/tasks/{task_gid}/addDependencies", "tasks"),
      makeEndpoint("POST", "/tasks/{task_gid}/removeDependencies", "tasks"),
      makeEndpoint("POST", "/tasks/{task_gid}/addFollowers", "tasks"),
      makeEndpoint("POST", "/tasks/{task_gid}/removeFollowers", "tasks"),
      makeEndpoint("POST", "/tasks/{task_gid}/addProject", "tasks"),
      makeEndpoint("POST", "/tasks/{task_gid}/removeProject", "tasks"),
      makeEndpoint("POST", "/tasks/{task_gid}/addTag", "tasks"),
      makeEndpoint("POST", "/tasks/{task_gid}/removeTag", "tasks"),
      makeEndpoint("GET", "/portfolios/{portfolio_gid}/items", "portfolios"),
      makeEndpoint("POST", "/portfolios/{portfolio_gid}/addItem", "portfolios"),
      makeEndpoint(
        "POST",
        "/portfolios/{portfolio_gid}/removeItem",
        "portfolios",
      ),
    ),
  );

  test("GET /tasks/{task_gid}/subtasks -> subtasks", () => {
    const route = resolveRoute(routes, "tasks", "subtasks");
    expect(route).toBeDefined();
    expect(route!.method).toBe("GET");
    expect(route!.path).toBe("/tasks/{task_gid}/subtasks");
  });

  test("POST /tasks/{task_gid}/subtasks -> create-subtasks", () => {
    const route = resolveRoute(routes, "tasks", "create-subtasks");
    expect(route).toBeDefined();
    expect(route!.method).toBe("POST");
    expect(route!.path).toBe("/tasks/{task_gid}/subtasks");
  });

  test("POST /tasks/{task_gid}/addDependencies -> add-dependencies", () => {
    const route = resolveRoute(routes, "tasks", "add-dependencies");
    expect(route).toBeDefined();
    expect(route!.method).toBe("POST");
    expect(route!.path).toBe("/tasks/{task_gid}/addDependencies");
  });

  test("POST /tasks/{task_gid}/removeDependencies -> remove-dependencies", () => {
    const route = resolveRoute(routes, "tasks", "remove-dependencies");
    expect(route).toBeDefined();
    expect(route!.method).toBe("POST");
  });

  test("GET /tasks/{task_gid}/dependencies -> dependencies", () => {
    const route = resolveRoute(routes, "tasks", "dependencies");
    expect(route).toBeDefined();
    expect(route!.method).toBe("GET");
    expect(route!.path).toBe("/tasks/{task_gid}/dependencies");
  });

  test("POST /tasks/{task_gid}/addFollowers and removeFollowers", () => {
    const add = resolveRoute(routes, "tasks", "add-followers");
    expect(add).toBeDefined();
    expect(add!.path).toBe("/tasks/{task_gid}/addFollowers");
    const remove = resolveRoute(routes, "tasks", "remove-followers");
    expect(remove).toBeDefined();
  });

  test("POST /tasks/{task_gid}/addProject and removeProject", () => {
    const add = resolveRoute(routes, "tasks", "add-project");
    expect(add).toBeDefined();
    expect(add!.path).toBe("/tasks/{task_gid}/addProject");
    const remove = resolveRoute(routes, "tasks", "remove-project");
    expect(remove).toBeDefined();
  });

  test("POST /tasks/{task_gid}/addTag and removeTag", () => {
    expect(resolveRoute(routes, "tasks", "add-tag")).toBeDefined();
    expect(resolveRoute(routes, "tasks", "remove-tag")).toBeDefined();
  });

  test("Portfolio item routes", () => {
    const list = resolveRoute(routes, "portfolios", "items");
    expect(list).toBeDefined();
    expect(list!.method).toBe("GET");

    const add = resolveRoute(routes, "portfolios", "add-item");
    expect(add).toBeDefined();
    expect(add!.method).toBe("POST");

    const remove = resolveRoute(routes, "portfolios", "remove-item");
    expect(remove).toBeDefined();
    expect(remove!.method).toBe("POST");
  });
});

describe("ungrouped verb actions", () => {
  const routes = buildRoutes(
    makeSchema(
      makeEndpoint("POST", "/tasks/{task_gid}/duplicate", "tasks"),
      makeEndpoint("GET", "/workspaces/{workspace_gid}/tasks/search", "tasks"),
      makeEndpoint("POST", "/tasks/{task_gid}/setParent", "tasks"),
    ),
  );

  test("POST /tasks/{task_gid}/duplicate -> duplicate", () => {
    const route = resolveRoute(routes, "tasks", "duplicate");
    expect(route).toBeDefined();
    expect(route!.method).toBe("POST");
  });

  test("GET /workspaces/{workspace_gid}/tasks/search -> search", () => {
    const route = resolveRoute(routes, "tasks", "search");
    expect(route).toBeDefined();
    expect(route!.method).toBe("GET");
  });

  test("POST /tasks/{task_gid}/setParent -> set-parent", () => {
    const route = resolveRoute(routes, "tasks", "set-parent");
    expect(route).toBeDefined();
    expect(route!.method).toBe("POST");
  });
});

describe("cross-tag resource disambiguation", () => {
  const routes = buildRoutes(
    makeSchema(
      makeEndpoint("GET", "/custom_fields/{custom_field_gid}", "custom-fields"),
      makeEndpoint("PUT", "/custom_fields/{custom_field_gid}", "custom-fields"),
      makeEndpoint(
        "POST",
        "/custom_fields/{custom_field_gid}/enum_options",
        "custom-fields",
      ),
      makeEndpoint("PUT", "/enum_options/{enum_option_gid}", "custom-fields"),
    ),
  );

  test("POST /custom_fields/{custom_field_gid}/enum_options -> enum-options", () => {
    const route = resolveRoute(routes, "custom-fields", "enum-options");
    expect(route).toBeDefined();
    expect(route!.method).toBe("POST");
    expect(route!.path).toBe("/custom_fields/{custom_field_gid}/enum_options");
  });

  test("PUT /enum_options/{enum_option_gid} -> update-enum-options", () => {
    const route = resolveRoute(routes, "custom-fields", "update-enum-options");
    expect(route).toBeDefined();
    expect(route!.method).toBe("PUT");
    expect(route!.path).toBe("/enum_options/{enum_option_gid}");
  });

  test("PUT /custom_fields/{custom_field_gid} -> update", () => {
    const route = resolveRoute(routes, "custom-fields", "update");
    expect(route).toBeDefined();
    expect(route!.path).toBe("/custom_fields/{custom_field_gid}");
  });
});

describe("scoped CRUD disambiguation", () => {
  const routes = buildRoutes(
    makeSchema(
      makeEndpoint("GET", "/users/{user_gid}", "users"),
      makeEndpoint(
        "GET",
        "/workspaces/{workspace_gid}/users/{user_gid}",
        "users",
      ),
      makeEndpoint(
        "PUT",
        "/workspaces/{workspace_gid}/users/{user_gid}",
        "users",
      ),
    ),
  );

  test("GET /users/{user_gid} vs /workspaces/{workspace_gid}/users/{user_gid}", () => {
    const global = resolveRoute(routes, "users", "get");
    expect(global!.path).toBe("/users/{user_gid}");

    const scoped = resolveRoute(routes, "users", "get-for-workspace");
    expect(scoped!.path).toBe("/workspaces/{workspace_gid}/users/{user_gid}");
  });

  test("PUT /workspaces/{workspace_gid}/users/{user_gid} -> update-for-workspace", () => {
    const route = resolveRoute(routes, "users", "update-for-workspace");
    expect(route).toBeDefined();
    expect(route!.method).toBe("PUT");
  });
});

describe("deep path qualifier", () => {
  test("GET /workspaces/{workspace_gid}/tasks/custom_id/{custom_id} -> custom-id", () => {
    const routes = buildRoutes(
      makeSchema(
        makeEndpoint(
          "GET",
          "/workspaces/{workspace_gid}/tasks/custom_id/{custom_id}",
          "tasks",
        ),
      ),
    );
    const route = resolveRoute(routes, "tasks", "custom-id");
    expect(route).toBeDefined();
    expect(route!.path).toBe(
      "/workspaces/{workspace_gid}/tasks/custom_id/{custom_id}",
    );
  });
});

describe("no collisions", () => {
  test("every endpoint maps to a unique route", () => {
    const endpoints = [
      makeEndpoint("GET", "/tasks", "tasks"),
      makeEndpoint("POST", "/tasks", "tasks"),
      makeEndpoint("GET", "/tasks/{task_gid}", "tasks"),
      makeEndpoint("PUT", "/tasks/{task_gid}", "tasks"),
      makeEndpoint("DELETE", "/tasks/{task_gid}", "tasks"),
      makeEndpoint("GET", "/tasks/{task_gid}/subtasks", "tasks"),
      makeEndpoint("POST", "/tasks/{task_gid}/subtasks", "tasks"),
    ];
    const routes = buildRoutes(makeSchema(...endpoints));

    let total = 0;
    for (const actions of routes.values()) {
      total += actions.size;
    }
    expect(total).toBe(endpoints.length);
  });

  test("throws when two endpoints derive the same action", () => {
    try {
      buildRoutes(
        makeSchema(
          makeEndpoint("GET", "/tasks/{task_gid}/dependencies", "tasks"),
          makeEndpoint("GET", "/tasks/{task_gid}/Dependencies", "tasks"),
        ),
      );
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe(
        'Route action collision for entity "tasks": "dependencies".',
      );
    }
  });
});

describe("resolve", () => {
  const routes = buildRoutes(
    makeSchema(makeEndpoint("GET", "/tasks/{task_gid}", "tasks")),
  );

  test("unknown entity returns undefined", () => {
    expect(resolveRoute(routes, "nonexistent", "get")).toBeUndefined();
  });

  test("unknown action returns undefined", () => {
    expect(resolveRoute(routes, "tasks", "nonexistent")).toBeUndefined();
  });
});

describe("unsupported path shapes", () => {
  test("throws when parent entity is not preceded by a gid segment", () => {
    try {
      buildRoutes(
        makeSchema(makeEndpoint("GET", "/workspaces/tasks", "tasks")),
      );
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe(
        "Unsupported parent path shape for route derivation: /workspaces/tasks",
      );
    }
  });
});
