import { describe, expect, test } from "bun:test";

import { buildArgMap } from "@/args";
import { compileSchema, type EndpointSpec } from "@/compiler";

function makeEndpointSpec(overrides: Partial<EndpointSpec> = {}): EndpointSpec {
  return {
    method: "GET",
    path: "/tasks",
    entity: "tasks",
    summary: "Get multiple tasks",
    pathParams: [],
    queryFields: [],
    bodyFields: [],
    ...overrides,
  };
}

describe("buildArgMap", () => {
  test("path params become positional args", () => {
    const endpoint = makeEndpointSpec({
      path: "/tasks/{task_gid}",
      pathParams: [{ name: "task_gid", type: "string", required: true }],
    });
    expect(buildArgMap(endpoint)["task-gid"]).toEqual({
      type: "positional",
      required: true,
    });
  });

  test("query params with enum", () => {
    const endpoint = makeEndpointSpec({
      queryFields: [
        { name: "completed_since", type: "string" },
        {
          name: "resource_type",
          type: "string",
          enum: ["task", "project"],
        },
      ],
    });
    const args = buildArgMap(endpoint);
    expect(args["completed-since"]).toEqual({ type: "string" });
    expect(args["resource-type"]).toEqual({
      type: "string",
      valueHint: "task|project",
    });
  });

  test("query params include hints from type metadata", () => {
    const endpoint = makeEndpointSpec({
      queryFields: [
        {
          name: "completed",
          type: "boolean",
          description: "Filter to completed tasks",
        },
        {
          name: "due_on",
          type: "string",
          format: "date",
          description: "Due date",
        },
        {
          name: "opt_fields",
          type: "array",
          description: "Fields to include",
          items: { type: "string", enum: ["name", "gid"] },
        },
      ],
    });
    const args = buildArgMap(endpoint);
    expect(args.completed).toEqual({
      type: "string",
      description: "Filter to completed tasks",
      valueHint: "true|false",
    });
    expect(args["due-on"]).toEqual({
      type: "string",
      description: "Due date",
      valueHint: "YYYY-MM-DD",
    });
    expect(args["opt-fields"]).toEqual({
      type: "string",
      description: "Fields to include",
      valueHint: "name,gid",
    });
  });

  test("synthetic spec with a divergent union compiles into a union value hint", () => {
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
                        - type: object
                          properties:
                            name: { type: string }
`;
    const compiled = compileSchema(spec, "test");
    const args = buildArgMap(compiled.endpoints[0]!);
    expect(args["custom-field"]).toMatchObject({
      valueHint: "object|string",
    });
  });

  test("union body fields render both branches in valueHint", () => {
    const endpoint = makeEndpointSpec({
      method: "POST",
      bodyFields: [
        {
          name: "custom_field",
          type: "string",
          oneOfTypes: ["object", "string"],
          required: true,
          description: "Custom field GID or inline create",
        },
      ],
    });
    const args = buildArgMap(endpoint);
    expect(args["custom-field"]).toEqual({
      type: "string",
      description: "[required] Custom field GID or inline create",
      valueHint: "object|string",
    });
  });

  test("body fields included with metadata", () => {
    const endpoint = makeEndpointSpec({
      method: "POST",
      bodyFields: [
        {
          name: "name",
          type: "string",
          required: true,
          description: "Task name",
        },
        { name: "assignee", type: "string" },
        {
          name: "resource_subtype",
          type: "string",
          enum: ["default_task", "milestone"],
          description: "The subtype",
        },
      ],
    });
    const args = buildArgMap(endpoint);
    expect(args.name).toEqual({
      type: "string",
      description: "[required] Task name",
    });
    expect(args.assignee).toEqual({ type: "string" });
    expect(args["resource-subtype"]).toEqual({
      type: "string",
      description: "The subtype",
      valueHint: "default_task|milestone",
    });
  });
});
