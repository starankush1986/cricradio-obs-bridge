const fs = require("fs");
const path = require("path");
const pako = require("pako");

const FIELD_MAP = JSON.parse(
  fs.readFileSync(path.join(__dirname, "field-map.json"), "utf8"),
);

const SKIP_KEYS = new Set(["__v"]);

function expandValue(value) {
  if (value == null) {
    return value;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandKeys(item));
  }
  if (typeof value === "object") {
    return expandKeys(value);
  }
  return value;
}

function expandKeys(input) {
  if (input == null) {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => expandKeys(item));
  }
  if (typeof input !== "object") {
    return input;
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (SKIP_KEYS.has(key)) {
      continue;
    }
    const expandedKey = FIELD_MAP[key] || key;
    output[expandedKey] = expandValue(value);
  }
  return output;
}

function decodeSocketPayload(payload) {
  try {
    const bytes =
      payload instanceof ArrayBuffer
        ? new Uint8Array(payload)
        : Buffer.isBuffer(payload)
          ? payload
          : payload;

    const jsonText = pako.ungzip(bytes, { to: "string" });
    const parsed = JSON.parse(jsonText);
    return expandKeys(parsed);
  } catch (error) {
    return null;
  }
}

function unwrapSocketData(decoded) {
  if (!decoded) {
    return null;
  }
  if (decoded.data != null) {
    return decoded.data;
  }
  return decoded;
}

module.exports = {
  expandKeys,
  decodeSocketPayload,
  unwrapSocketData,
};
