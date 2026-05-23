import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAnthropicFailure,
  retryAfterSeconds,
  validateAnthropicApiKey,
} from "../../src/anthropic";

test("validateAnthropicApiKey rejects missing redacted and incomplete keys before calling Anthropic", () => {
  assert.equal(validateAnthropicApiKey(""), "add your Anthropic API key in Settings.");
  assert.match(validateAnthropicApiKey("sk-ant-…work") ?? "", /redacted/u);
  assert.match(validateAnthropicApiKey("sk-ant-...work") ?? "", /redacted/u);
  assert.match(validateAnthropicApiKey("sk-ant-short-key") ?? "", /incomplete/u);
  assert.equal(validateAnthropicApiKey("sk-ant-api03-" + "a".repeat(80)), null);
});

test("classifyAnthropicFailure distinguishes auth rate limit and token failures", () => {
  assert.equal(classifyAnthropicFailure(401, { type: "authentication_error" }), "authentication");
  assert.equal(classifyAnthropicFailure(429, { type: "rate_limit_error" }), "rate-limit");
  assert.equal(
    classifyAnthropicFailure(400, { message: "You have reached your specified API usage limits." }),
    "usage-limit",
  );
  assert.equal(classifyAnthropicFailure(413, { type: "invalid_request_error" }), "input-too-large");
  assert.equal(
    classifyAnthropicFailure(400, { message: "prompt is too long: exceeds maximum context length" }),
    "input-too-large",
  );
  assert.equal(classifyAnthropicFailure(400, { message: "max_tokens exceeded" }), "output-too-large");
  assert.equal(classifyAnthropicFailure(400, { type: "invalid_request_error" }), "bad-request");
  assert.equal(classifyAnthropicFailure(500), "server");
});

test("retryAfterSeconds parses retry-after headers case-insensitively", () => {
  assert.equal(retryAfterSeconds({ "Retry-After": "12" }), 12);
  assert.equal(retryAfterSeconds({ "retry-after": "nope" }), undefined);
});
