export function validate(schema, value) {
  if (schema.enum && !schema.enum.includes(value)) throw Error("Invalid enum value");
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected object");
    for (const k of schema.required || []) if (!(k in value)) throw Error("Missing " + k);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) validate(schema.properties[k], v);
      else if (schema.additionalProperties === false) throw Error("Unknown argument " + k);
    }
  } else if (schema.type === "array") {
    if (
      !Array.isArray(value) ||
      value.length < (schema.minItems || 0) ||
      value.length > (schema.maxItems || Infinity)
    )
      throw Error("Invalid vector");
    value.forEach((v) => validate(schema.items, v));
  } else if (schema.type === "number" || schema.type === "integer") {
    if (
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isInteger(value)) ||
      value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity) ||
      value <= (schema.exclusiveMinimum ?? -Infinity)
    )
      throw Error("Invalid numeric argument");
  } else if (schema.type && typeof value !== schema.type) throw Error("Invalid argument type");
}
