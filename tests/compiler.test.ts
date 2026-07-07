import { describe, expect, test } from "bun:test";

import { compileSchema, type CompiledSchema } from "@/compiler";
import { CliError } from "@/errors";

function findEndpoint(schema: CompiledSchema, path: string, method = "GET") {
  return schema.endpoints.find(
    (endpoint) => endpoint.path === path && endpoint.method === method,
  );
}

function fieldByName<T extends { name: string }>(
  fields: T[],
  name: string,
): T | undefined {
  return fields.find((field) => field.name === name);
}

const FULL_SPEC = `
openapi: "3.0.0"
info: { title: test, version: "2.0" }
components:
  schemas:
    TagBase:
      type: object
      properties:
        gid: { type: string, readOnly: true }
        resource_type: { type: string, readOnly: true }
        name: { type: string }
        color: { type: string, enum: [light-green, light-red, none] }
        notes: { type: string, description: "Free-form textual information." }
        bio: { type: string, description: "This is a very long description field that exceeds one hundred and twenty characters in total length so that we can verify truncation works correctly in the compiler output." }
    TagRequest:
      allOf:
        - $ref: "#/components/schemas/TagBase"
        - type: object
          properties:
            followers: { type: array, items: { type: string } }
paths:
  /tags:
    get:
      tags: [Tags]
      summary: Get multiple tags
      parameters:
        - name: workspace
          in: query
          required: true
          schema: { type: string }
        - name: opt_fields
          in: query
          schema:
            type: array
            items:
              type: string
              enum: [color, name, notes]
        - name: opt_pretty
          in: query
          schema: { type: boolean }
    post:
      tags: [Tags]
      summary: Create a tag
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  $ref: "#/components/schemas/TagRequest"
  /tags/{tag_gid}:
    parameters:
      - name: tag_gid
        in: path
        required: true
        schema: { type: string }
    get:
      tags: [Tags]
      summary: Get a tag
      parameters:
        - name: opt_fields
          in: query
          schema:
            type: array
            items:
              type: string
              enum: [color, name, notes]
          description: "This endpoint excludes some properties by default."
        - name: opt_pretty
          in: query
          schema: { type: boolean }
    put:
      tags: [Tags]
      summary: Update a tag
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  $ref: "#/components/schemas/TagRequest"
    delete:
      tags: [Tags]
      summary: Delete a tag
  /tags/{tag_gid}/addFollowers:
    post:
      tags: [Tags]
      summary: Add followers to a tag
      parameters:
        - name: tag_gid
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
                  required: [followers]
                  properties:
                    followers:
                      type: array
                      items: { type: string }
                      description: "An array of followers to add."
`;

describe("compile", () => {
  test("version and source are set", () => {
    const schema = compileSchema(FULL_SPEC, "local");
    expect(schema.version).toBe("2.0");
    expect(schema.source).toBe("local");
    expect(schema.generated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("stats count endpoints, body endpoints, and fields", () => {
    const schema = compileSchema(FULL_SPEC, "test");

    expect(schema.stats.endpointCount).toBe(6);
    expect(schema.stats.bodyEndpointCount).toBe(3);

    // Avoid brittle field hand-count
    let fieldCount = 0;
    for (const ep of schema.endpoints) {
      fieldCount +=
        ep.pathParams.length + ep.queryFields.length + ep.bodyFields.length;
    }
    expect(schema.stats.fieldCount).toBe(fieldCount);
  });
});

describe("simple GET", () => {
  const schema = compileSchema(FULL_SPEC, "test");
  const endpoint = findEndpoint(schema, "/tags/{tag_gid}");

  test("entity, method, summary", () => {
    expect(endpoint).toBeDefined();
    expect(endpoint!.entity).toBe("tags");
    expect(endpoint!.method).toBe("GET");
    expect(endpoint!.summary).toBe("Get a tag");
  });

  test("path param is required, opt_fields is query array", () => {
    const gid = fieldByName(endpoint!.pathParams, "tag_gid");
    expect(gid).toMatchObject({
      name: "tag_gid",
      type: "string",
      required: true,
    });

    const fields = fieldByName(endpoint!.queryFields, "opt_fields");
    expect(fields).toMatchObject({
      name: "opt_fields",
      type: "array",
    });
    expect(fields?.description).toContain(
      "excludes some properties by default",
    );
    expect(fields?.items?.type).toBe("string");
  });

  test("no body on GET", () => {
    expect(endpoint!.bodyFields).toEqual([]);
  });
});

describe("simple DELETE", () => {
  const schema = compileSchema(FULL_SPEC, "test");
  const endpoint = findEndpoint(schema, "/tags/{tag_gid}", "DELETE");

  test("no body on DELETE", () => {
    expect(endpoint).toBeDefined();
    expect(endpoint!.bodyFields).toEqual([]);
  });
});

describe("POST with body", () => {
  const schema = compileSchema(FULL_SPEC, "test");
  const endpoint = findEndpoint(schema, "/tags", "POST");

  test("has writable body fields", () => {
    expect(endpoint).toBeDefined();
    expect(fieldByName(endpoint!.bodyFields, "name")).toBeDefined();
    expect(fieldByName(endpoint!.bodyFields, "name")!.type).toBe("string");
  });

  test("readOnly fields are stripped", () => {
    expect(fieldByName(endpoint!.bodyFields, "gid")).toBeUndefined();
    expect(fieldByName(endpoint!.bodyFields, "resource_type")).toBeUndefined();
  });

  test("enum fields have enum values", () => {
    const color = fieldByName(endpoint!.bodyFields, "color");
    expect(color?.enum).toBeDefined();
    expect(color!.enum).toContain("light-green");
    expect(color!.enum).toContain("none");
  });

  test("array body fields include items type", () => {
    const followers = fieldByName(endpoint!.bodyFields, "followers");
    expect(followers).toBeDefined();
    expect(followers!.type).toBe("array");
    expect(followers!.items).toEqual({ type: "string" });
  });

  test("non-array fields have no items", () => {
    expect(fieldByName(endpoint!.bodyFields, "name")!.items).toBeUndefined();
  });
});

describe("POST action endpoint", () => {
  const schema = compileSchema(FULL_SPEC, "test");
  const endpoint = findEndpoint(schema, "/tags/{tag_gid}/addFollowers", "POST");

  test("entity is tags, has body", () => {
    expect(endpoint).toBeDefined();
    expect(endpoint!.entity).toBe("tags");
    expect(endpoint!.bodyFields.length).toBeGreaterThan(0);
  });

  test("followers is required", () => {
    expect(fieldByName(endpoint!.bodyFields, "followers")).toMatchObject({
      name: "followers",
      type: "array",
      required: true,
    });
  });

  test("path param from operation parameters", () => {
    const gid = fieldByName(endpoint!.pathParams, "tag_gid");
    expect(gid?.required).toBe(true);
  });
});

describe("query metadata", () => {
  const schema = compileSchema(FULL_SPEC, "test");

  test("opt_fields exposes allowed response fields via items enum", () => {
    const endpoint = findEndpoint(schema, "/tags");
    const optFields = fieldByName(endpoint!.queryFields, "opt_fields");
    expect(optFields?.items?.enum).toEqual(["color", "name", "notes"]);
  });

  test("opt_pretty is stripped from all endpoints", () => {
    for (const ep of schema.endpoints) {
      expect(fieldByName(ep.pathParams, "opt_pretty")).toBeUndefined();
      expect(fieldByName(ep.queryFields, "opt_pretty")).toBeUndefined();
    }
  });
});

describe("descriptions are truncated", () => {
  test("no body field description exceeds 120 chars", () => {
    const schema = compileSchema(FULL_SPEC, "test");
    for (const ep of schema.endpoints) {
      for (const field of ep.bodyFields) {
        if (field.description) {
          expect(field.description.length).toBeLessThanOrEqual(120);
        }
      }
    }
  });
});

describe("transitive $ref bodies are resolved", () => {
  const schema = compileSchema(FULL_SPEC, "test");

  test("PUT via $ref chain produces expected body fields", () => {
    const endpoint = findEndpoint(schema, "/tags/{tag_gid}", "PUT");
    expect(endpoint?.bodyFields.length).toBeGreaterThan(0);
    expect(fieldByName(endpoint!.bodyFields, "name")).toBeDefined();
    expect(fieldByName(endpoint!.bodyFields, "followers")).toBeDefined();
  });

  test("bodyEndpointCount matches actual count", () => {
    const actual = schema.endpoints.filter(
      (ep) => ep.bodyFields.length > 0,
    ).length;
    expect(actual).toBe(schema.stats.bodyEndpointCount);
  });
});

describe("oneOf in body field", () => {
  test("string-or-object union exposes both branches", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
paths:
  /things:
    post:
      tags: [Things]
      summary: Create thing
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  type: object
                  required: [widget]
                  properties:
                    widget:
                      oneOf:
                        - type: string
                          description: Widget GID
                        - type: object
                          properties:
                            name: { type: string }
                            color: { type: string }
`;
    const compiled = compileSchema(spec, "test");
    const widget = fieldByName(compiled.endpoints[0]!.bodyFields, "widget");
    expect(widget).toBeDefined();
    expect(widget!.required).toBe(true);
    // Primary type is CLI-friendly scalar, not object branch
    expect(widget!.type).toBe("string");
    expect(widget!.oneOfTypes).toEqual(["object", "string"]);
  });

  test("same-type union collapses to one field type", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
paths:
  /things:
    post:
      tags: [Things]
      summary: Create thing
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  type: object
                  properties:
                    kind:
                      oneOf:
                        - type: string
                          enum: [a]
                        - type: string
                          enum: [b]
`;
    const compiled = compileSchema(spec, "test");
    const kind = fieldByName(compiled.endpoints[0]!.bodyFields, "kind");
    expect(kind).toBeDefined();
    expect(kind!.type).toBe("string");
    expect(kind!.oneOfTypes).toBeUndefined();
  });
});

describe("anyOf in schema", () => {
  test("anyOf branches merge properties, all optional", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
paths:
  /items:
    post:
      tags: [Items]
      summary: Create item
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  anyOf:
                    - type: object
                      required: [name]
                      properties:
                        name: { type: string }
                        color: { type: string }
                    - type: object
                      required: [title]
                      properties:
                        title: { type: string }
                        size: { type: integer }
`;
    const compiled = compileSchema(spec, "test");
    const body = compiled.endpoints[0]!.bodyFields;
    expect(fieldByName(body, "name")).toBeDefined();
    expect(fieldByName(body, "color")).toBeDefined();
    expect(fieldByName(body, "title")).toBeDefined();
    expect(fieldByName(body, "size")).toBeDefined();
    expect(fieldByName(body, "name")!.required).toBeUndefined();
    expect(fieldByName(body, "title")!.required).toBeUndefined();
  });
});

describe("discriminator", () => {
  test("discriminator does not crash, properties still extracted", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
paths:
  /events:
    post:
      tags: [Events]
      summary: Create event
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  oneOf:
                    - type: object
                      properties:
                        kind: { type: string, enum: [meeting] }
                        room: { type: string }
                    - type: object
                      properties:
                        kind: { type: string, enum: [webinar] }
                        url: { type: string }
                  discriminator:
                    propertyName: kind
`;
    const compiled = compileSchema(spec, "test");
    const body = compiled.endpoints[0]!.bodyFields;
    expect(fieldByName(body, "kind")).toBeDefined();
    expect(fieldByName(body, "room")).toBeDefined();
    expect(fieldByName(body, "url")).toBeDefined();
  });
});

describe("nested composition", () => {
  test("allOf containing oneOf flattens correctly", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
components:
  schemas:
    Base:
      type: object
      properties:
        id: { type: string, readOnly: true }
        name: { type: string }
    Ext:
      oneOf:
        - type: object
          properties:
            color: { type: string }
        - type: object
          properties:
            size: { type: integer }
paths:
  /things:
    post:
      tags: [Things]
      summary: Create thing
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  allOf:
                    - $ref: "#/components/schemas/Base"
                    - $ref: "#/components/schemas/Ext"
`;
    const compiled = compileSchema(spec, "test");
    const body = compiled.endpoints[0]!.bodyFields;
    expect(fieldByName(body, "id")).toBeUndefined();
    expect(fieldByName(body, "name")).toBeDefined();
    expect(fieldByName(body, "color")).toBeDefined();
    expect(fieldByName(body, "size")).toBeDefined();
  });
});

describe("oneOf in array items", () => {
  test("divergent oneOf inside array items preserves both branches", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
paths:
  /crews:
    post:
      tags: [Crews]
      summary: Create crew
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  type: object
                  properties:
                    members:
                      type: array
                      items:
                        oneOf:
                          - type: string
                            description: User GID
                          - type: object
                            properties:
                              name: { type: string }
                              email: { type: string }
`;
    const compiled = compileSchema(spec, "test");
    const members = fieldByName(compiled.endpoints[0]!.bodyFields, "members");
    expect(members).toBeDefined();
    expect(members!.type).toBe("array");
    expect(members!.items).toBeDefined();
    expect(members!.items!.type).toBe("string");
    expect(members!.items!.oneOfTypes).toEqual(["object", "string"]);
  });
});

describe("allOf wrapping oneOf with divergent types", () => {
  test("allOf around a divergent union exposes both branches", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
components:
  schemas:
    Base:
      type: object
      properties:
        tag: { type: string }
    StringOrObject:
      oneOf:
        - type: string
        - type: object
          properties:
            nested: { type: string }
paths:
  /widgets:
    post:
      tags: [Widgets]
      summary: Create widget
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  type: object
                  properties:
                    label:
                      allOf:
                        - $ref: "#/components/schemas/StringOrObject"
`;
    const compiled = compileSchema(spec, "test");
    const label = fieldByName(compiled.endpoints[0]!.bodyFields, "label");
    expect(label).toBeDefined();
    // Outer allOf wraps the divergent oneOf, union info must propagate through the merge
    expect(label!.type).toBe("string");
    expect(label!.oneOfTypes).toEqual(["object", "string"]);
  });
});

describe("multiple allOf branches with divergent unions", () => {
  test("allOf with two divergent unions takes the last branch's union", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
paths:
  /things:
    post:
      tags: [Things]
      summary: Create thing
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  type: object
                  properties:
                    weird:
                      allOf:
                        - oneOf:
                            - type: string
                            - type: object
                              properties: { a: { type: string } }
                        - oneOf:
                            - type: integer
                            - type: boolean
`;
    const compiled = compileSchema(spec, "test");
    const weird = fieldByName(compiled.endpoints[0]!.bodyFields, "weird");
    expect(weird).toBeDefined();
    expect(weird!.oneOfTypes).toEqual(["boolean", "integer"]);
  });
});

describe("nested allOf wrapping a divergent union", () => {
  test("two-level allOf around a divergent union exposes both branches", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
paths:
  /things:
    post:
      tags: [Things]
      summary: Create thing
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  type: object
                  properties:
                    deep:
                      allOf:
                        - allOf:
                            - oneOf:
                                - type: string
                                - type: object
                                  properties: { x: { type: string } }
`;
    const compiled = compileSchema(spec, "test");
    const deep = fieldByName(compiled.endpoints[0]!.bodyFields, "deep");
    expect(deep).toBeDefined();
    expect(deep!.type).toBe("string");
    expect(deep!.oneOfTypes).toEqual(["object", "string"]);
  });
});

describe("allOf + oneOf on same schema", () => {
  test("allOf fields and oneOf fields both present", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
paths:
  /widgets:
    post:
      tags: [Widgets]
      summary: Create widget
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  allOf:
                    - type: object
                      required: [name]
                      properties:
                        name: { type: string }
                  oneOf:
                    - type: object
                      properties:
                        color: { type: string }
                    - type: object
                      properties:
                        size: { type: integer }
`;
    const compiled = compileSchema(spec, "test");
    const body = compiled.endpoints[0]!.bodyFields;
    expect(fieldByName(body, "name")).toBeDefined();
    expect(fieldByName(body, "name")!.required).toBe(true);
    expect(fieldByName(body, "color")).toBeDefined();
    expect(fieldByName(body, "size")).toBeDefined();
    expect(fieldByName(body, "color")!.required).toBeUndefined();
  });
});

describe("composition siblings", () => {
  test("sibling properties and required next to allOf are preserved", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
paths:
  /things:
    post:
      tags: [Things]
      summary: Create thing
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  required: [status]
                  properties:
                    status: { type: string }
                    note: { type: string }
                  allOf:
                    - type: object
                      required: [name]
                      properties:
                        name: { type: string }
`;
    const compiled = compileSchema(spec, "test");
    const body = compiled.endpoints[0]!.bodyFields;
    expect(fieldByName(body, "name")).toEqual({
      name: "name",
      type: "string",
      required: true,
    });
    expect(fieldByName(body, "status")).toEqual({
      name: "status",
      type: "string",
      required: true,
    });
    expect(fieldByName(body, "note")).toEqual({
      name: "note",
      type: "string",
    });
  });
});

describe("request body schema composition", () => {
  test("top-level allOf on requestBody schema still extracts data", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
paths:
  /things:
    post:
      tags: [Things]
      summary: Create thing
      requestBody:
        content:
          application/json:
            schema:
              allOf:
                - type: object
                  properties:
                    data:
                      type: object
                      required: [name]
                      properties:
                        name: { type: string }
                        note: { type: string }
`;
    const compiled = compileSchema(spec, "test");
    const body = compiled.endpoints[0]!.bodyFields;
    expect(fieldByName(body, "name")).toEqual({
      name: "name",
      type: "string",
      required: true,
    });
    expect(fieldByName(body, "note")).toEqual({
      name: "note",
      type: "string",
    });
  });
});

describe("parameter schema refs", () => {
  test("parameter schema $ref is resolved", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
components:
  schemas:
    Limit:
      type: integer
paths:
  /things:
    get:
      tags: [Things]
      summary: List things
      parameters:
        - name: limit
          in: query
          schema:
            $ref: "#/components/schemas/Limit"
`;
    const compiled = compileSchema(spec, "test");
    expect(compiled.endpoints[0]!.queryFields).toContainEqual({
      name: "limit",
      type: "integer",
    });
  });
});

describe("invalid OpenAPI input", () => {
  test("malformed yaml is wrapped as a config error", () => {
    try {
      compileSchema('openapi: "3.0.0"\ninfo: [', "test");
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe("Failed to parse OpenAPI spec YAML.");
    }
  });

  test("missing spec version is wrapped as a config error", () => {
    try {
      compileSchema(
        'openapi: "3.0.0"\ninfo: { title: test }\npaths: {}',
        "test",
      );
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe("OpenAPI spec is missing info.version.");
    }
  });

  test("circular $ref chain is wrapped as a config error", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
components:
  schemas:
    A: { $ref: "#/components/schemas/B" }
    B: { $ref: "#/components/schemas/A" }
paths:
  /tags:
    post:
      tags: [Tags]
      summary: Create a tag
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data: { $ref: "#/components/schemas/A" }
`;
    try {
      compileSchema(spec, "test");
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toContain("Circular $ref");
    }
  });

  test("duplicate CLI flag name across query and body is a config error", () => {
    const spec = `
openapi: "3.0.0"
info: { title: test, version: "1.0" }
paths:
  /tags:
    post:
      tags: [Tags]
      summary: Create a tag
      parameters:
        - name: name
          in: query
          schema: { type: string }
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  type: object
                  properties:
                    name: { type: string }
`;
    try {
      compileSchema(spec, "test");
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe(
        'Duplicate CLI flag name "--name" for POST /tags.',
      );
    }
  });
});
