import { describe, expect, test } from "bun:test";

import { compileSchema, type EndpointSpec } from "@/compiler";
import { toKebab } from "@/utils";
import {
  buildHttpRequest,
  collectInput,
  type FlagValue,
  validateInput,
} from "@/validation";

type RequestDataBody = {
  data: Record<string, unknown>;
};

function createRequest(
  endpoint: EndpointSpec,
  positionals: (string | undefined)[],
  flags: Record<string, FlagValue>,
  rawArgs?: string[],
) {
  const parsed: Record<string, unknown> = { ...flags };

  endpoint.pathParams.forEach((field, index) => {
    const value = positionals[index];
    if (value != null) {
      parsed[toKebab(field.name)] = value;
    }
  });

  return buildHttpRequest(
    endpoint,
    validateInput(endpoint, collectInput(endpoint, parsed, rawArgs)),
  );
}

const taskGet: EndpointSpec = {
  method: "GET",
  path: "/tasks/{task_gid}",
  entity: "tasks",
  summary: "Get a task",
  pathParams: [{ name: "task_gid", type: "string", required: true }],
  queryFields: [{ name: "opt_fields", type: "array" }],
  bodyFields: [],
};

const taskCountsGet: EndpointSpec = {
  method: "GET",
  path: "/projects/{project_gid}/task_counts",
  entity: "projects",
  summary: "Get task count of a project",
  pathParams: [{ name: "project_gid", type: "string", required: true }],
  queryFields: [
    {
      name: "opt_fields",
      type: "array",
      items: {
        type: "string",
        enum: ["num_tasks", "num_completed_tasks"],
      },
    },
  ],
  bodyFields: [],
};

const taskSearchGet: EndpointSpec = {
  method: "GET",
  path: "/workspaces/{workspace_gid}/tasks/search",
  entity: "tasks",
  summary: "Search tasks",
  pathParams: [{ name: "workspace_gid", type: "string", required: true }],
  queryFields: [
    {
      name: "completed",
      type: "boolean",
    },
    {
      name: "due_on",
      type: "string",
      format: "date",
    },
  ],
  bodyFields: [],
};

const taskCreate: EndpointSpec = {
  method: "POST",
  path: "/tasks",
  entity: "tasks",
  summary: "Create a task",
  pathParams: [],
  queryFields: [{ name: "opt_fields", type: "array" }],
  bodyFields: [
    { name: "name", type: "string", required: true },
    { name: "assignee", type: "string" },
    { name: "completed", type: "boolean" },
    { name: "due_on", type: "string", format: "date" },
    {
      name: "resource_subtype",
      type: "string",
      enum: ["default_task", "milestone"],
    },
    { name: "projects", type: "array", items: { type: "string" } },
    { name: "custom_fields", type: "object" },
  ],
};

const addProject: EndpointSpec = {
  method: "POST",
  path: "/tasks/{task_gid}/addProject",
  entity: "tasks",
  summary: "Add a project to a task",
  pathParams: [{ name: "task_gid", type: "string", required: true }],
  queryFields: [],
  bodyFields: [
    { name: "project", type: "string", required: true },
    { name: "section", type: "string" },
  ],
};

// Mirrors Asana's addCustomFieldSetting where custom_field is oneOf of bare GID string or inline create object
const addCustomFieldSetting: EndpointSpec = {
  method: "POST",
  path: "/projects/{project_gid}/addCustomFieldSetting",
  entity: "projects",
  summary: "Add a custom field to a project",
  pathParams: [{ name: "project_gid", type: "string", required: true }],
  queryFields: [],
  bodyFields: [
    {
      name: "custom_field",
      type: "string",
      oneOfTypes: ["object", "string"],
      required: true,
    },
    { name: "is_important", type: "boolean" },
  ],
};

// Synthetic endpoint with divergent oneOf inside array items, members is array<string | object>
const createCrew: EndpointSpec = {
  method: "POST",
  path: "/crews",
  entity: "crews",
  summary: "Create a crew",
  pathParams: [],
  queryFields: [],
  bodyFields: [
    {
      name: "members",
      type: "array",
      items: { type: "string", oneOfTypes: ["object", "string"] },
    },
  ],
};

const createStory: EndpointSpec = {
  method: "POST",
  path: "/tasks/{task_gid}/stories",
  entity: "stories",
  summary: "Create a story on a task",
  pathParams: [{ name: "task_gid", type: "string", required: true }],
  queryFields: [],
  bodyFields: [
    { name: "text", type: "string" },
    { name: "html_text", type: "string" },
    { name: "is_pinned", type: "boolean" },
  ],
};

describe("buildHttpRequest", () => {
  test("GET with path param and query", () => {
    const request = createRequest(taskGet, ["abc"], {
      "opt-fields": "name,assignee",
    });
    expect(request.method).toBe("GET");
    expect(request.path).toBe("/tasks/abc");
    expect(request.query).toEqual({ opt_fields: ["name", "assignee"] });
    expect(request.body).toBeUndefined();
  });

  test("POST with body from flags", () => {
    const request = createRequest(taskCreate, [], {
      name: "bugfix",
      assignee: "me",
      completed: "false",
    });
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/tasks");
    expect(request.body).toEqual({
      data: { name: "bugfix", assignee: "me", completed: false },
    });
  });

  test("--json mode", () => {
    const request = createRequest(taskCreate, [], {
      json: '{"name":"bugfix","projects":["def"]}',
    });
    expect(request.body).toEqual({
      data: { name: "bugfix", projects: ["def"] },
    });
  });

  test("--json rejects a full Asana payload", () => {
    expect(() =>
      createRequest(taskCreate, [], {
        json: '{"data":{"name":"bugfix","projects":["def"]}}',
      }),
    ).toThrow("expects raw request fields");
  });

  test("mixed mode: flags + --json, json wins on conflict", () => {
    const request = createRequest(taskCreate, [], {
      name: "bugfix",
      json: '{"name":"migration","projects":["def"]}',
    });
    const body = request.body as RequestDataBody;
    expect(body.data.name).toBe("migration");
    expect(body.data.projects).toEqual(["def"]);
  });

  test("missing required positional throws", () => {
    expect(() => createRequest(taskGet, [], {})).toThrow("task_gid");
  });

  test("missing required body field throws", () => {
    expect(() => createRequest(taskCreate, [], { assignee: "me" })).toThrow(
      "Missing required request field: name",
    );
  });

  test("missing required body field still throws with --json", () => {
    expect(() =>
      createRequest(taskCreate, [], {
        json: '{"assignee":"me"}',
      }),
    ).toThrow("Missing required request field: name");
  });

  test("non-object --json throws", () => {
    expect(() =>
      createRequest(taskCreate, [], {
        json: '["bugfix"]',
      }),
    ).toThrow("expected a JSON object");
  });

  test("unknown field in --json throws", () => {
    expect(() =>
      createRequest(taskCreate, [], {
        json: '{"name":"bugfix","bogus":"value"}',
      }),
    ).toThrow('Unknown request field "bogus"');
  });

  test("invalid enum value throws", () => {
    expect(() =>
      createRequest(taskCreate, [], {
        name: "bugfix",
        "resource-subtype": "invalid",
      }),
    ).toThrow("not valid");
  });

  test("query booleans are validated", () => {
    expect(() =>
      createRequest(taskSearchGet, ["123"], {
        completed: "maybe",
      }),
    ).toThrow("expected boolean");
  });

  test("query dates are validated", () => {
    expect(() =>
      createRequest(taskSearchGet, ["123"], {
        "due-on": "2026-02-29",
      }),
    ).toThrow("not a real calendar date");
  });

  test("query csv enum values are validated", () => {
    expect(() =>
      createRequest(taskCountsGet, ["abc"], {
        "opt-fields": "num_tasks,bogus",
      }),
    ).toThrow('"bogus" is not valid');
  });

  test("optional-only body endpoints allow empty input locally", () => {
    const request = createRequest(createStory, ["abc"], {});
    expect(request.body).toBeUndefined();
  });

  test("date fields reject impossible calendar dates", () => {
    expect(() =>
      createRequest(taskCreate, [], {
        name: "bugfix",
        "due-on": "2026-02-29",
      }),
    ).toThrow("not a real calendar date");
  });

  test("json booleans are validated against the same schema", () => {
    expect(() =>
      createRequest(taskCreate, [], {
        json: '{"name":"bugfix","completed":"false"}',
      }),
    ).toThrow('Field "completed": expected boolean');
  });

  test("object body fields must use --json", () => {
    expect(() =>
      createRequest(taskCreate, [], {
        name: "bugfix",
        "custom-fields": "123=abc",
      }),
    ).toThrow("use --json for object values");
  });

  test("array body flags are split as csv", () => {
    const request = createRequest(taskCreate, [], {
      name: "bugfix",
      projects: "def,ghi",
    });
    expect(request.body).toEqual({
      data: { name: "bugfix", projects: ["def", "ghi"] },
    });
  });

  test("raw unknown flags are still rejected after parser filtering", () => {
    expect(() =>
      createRequest(taskGet, ["abc"], {}, ["abc", "--bogus", "val"]),
    ).toThrow("Unknown flag --bogus");
  });

  test("negated string flags report the original token", () => {
    expect(() =>
      createRequest(taskGet, ["abc"], {}, ["abc", "--no-json"]),
    ).toThrow("Unknown flag --no-json");
  });

  test("path + body params together", () => {
    const request = createRequest(addProject, ["abc"], {
      project: "def",
      section: "ghi",
    });
    expect(request.path).toBe("/tasks/abc/addProject");
    expect(request.body).toEqual({
      data: { project: "def", section: "ghi" },
    });
  });

  describe("oneOfTypes fields", () => {
    test("flag form sends a string GID", () => {
      const request = createRequest(addCustomFieldSetting, ["proj"], {
        "custom-field": "14916",
      });
      expect(request.body).toEqual({ data: { custom_field: "14916" } });
    });

    test("json form accepts the string branch", () => {
      const request = createRequest(addCustomFieldSetting, ["proj"], {
        json: '{"custom_field":"14916"}',
      });
      expect(request.body).toEqual({ data: { custom_field: "14916" } });
    });

    test("json form accepts the object branch", () => {
      const request = createRequest(addCustomFieldSetting, ["proj"], {
        json: '{"custom_field":{"name":"priority","resource_subtype":"enum"}}',
      });
      expect(request.body).toEqual({
        data: {
          custom_field: { name: "priority", resource_subtype: "enum" },
        },
      });
    });

    test("json form rejects branches outside the union", () => {
      expect(() =>
        createRequest(addCustomFieldSetting, ["proj"], {
          json: '{"custom_field":42}',
        }),
      ).toThrow('Field "custom_field": expected object or string');
    });

    test("array items with divergent oneOf accept mixed entries via --json", () => {
      const request = createRequest(createCrew, [], {
        json: '{"members":["14916",{"name":"Ada","email":"ada@example.com"}]}',
      });
      expect(request.body).toEqual({
        data: {
          members: ["14916", { name: "Ada", email: "ada@example.com" }],
        },
      });
    });

    test("array items with divergent oneOf reject entries outside the union", () => {
      expect(() =>
        createRequest(createCrew, [], {
          json: '{"members":[true]}',
        }),
      ).toThrow('Field "members": expected object or string');
    });

    test("array items with divergent oneOf accept csv flag form as strings", () => {
      const request = createRequest(createCrew, [], {
        members: "14916,14917",
      });
      expect(request.body).toEqual({
        data: { members: ["14916", "14917"] },
      });
    });

    // Full chain through compileSchema, validateInput, buildHttpRequest
    test("synthetic spec compiles and validates a divergent oneOf end-to-end", () => {
      const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
paths:
  /things/{thing_gid}/addCustomFieldSetting:
    post:
      tags: [Things]
      summary: Add a custom field
      parameters:
        - name: thing_gid
          in: path
          required: true
          schema: { type: string }
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  type: object
                  required: [custom_field]
                  properties:
                    custom_field:
                      oneOf:
                        - type: string
                          description: Custom field GID
                        - type: object
                          properties:
                            name: { type: string }
                            resource_subtype: { type: string }
`;
      const compiled = compileSchema(spec, "test");
      const endpoint = compiled.endpoints[0]!;

      const flagReq = createRequest(endpoint, ["t1"], {
        "custom-field": "14916",
      });
      expect(flagReq.path).toBe("/things/t1/addCustomFieldSetting");
      expect(flagReq.body).toEqual({ data: { custom_field: "14916" } });

      const objReq = createRequest(endpoint, ["t1"], {
        json: '{"custom_field":{"name":"priority","resource_subtype":"enum"}}',
      });
      expect(objReq.body).toEqual({
        data: {
          custom_field: { name: "priority", resource_subtype: "enum" },
        },
      });

      expect(() =>
        createRequest(endpoint, ["t1"], { json: '{"custom_field":42}' }),
      ).toThrow('Field "custom_field": expected object or string');
    });
  });
});
