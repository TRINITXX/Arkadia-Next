import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import {
  CLAUDE_CREDENTIALS_SEGMENTS,
  extractClaudeAccessToken,
  parseClaudeCredentials,
} from "./claudeCredentials.ts";

const NOW = 1_700_000_000_000;

describe("extractClaudeAccessToken", () => {
  it("retourne le jeton du compte Claude", () => {
    const result = extractClaudeAccessToken(
      { claudeAiOauth: { accessToken: "sk-ant-oat01-abc" } },
      NOW,
    );
    assert.isTrue(result.ok);
    assert.strictEqual(result.ok && result.accessToken, "sk-ant-oat01-abc");
  });

  it("ignore les jetons OAuth des serveurs MCP", () => {
    const result = extractClaudeAccessToken(
      {
        mcpOAuth: { "cloudflare|abc": { accessToken: "43283dfcb9c5" } },
        claudeAiOauth: { accessToken: "sk-ant-oat01-vrai" },
      },
      NOW,
    );
    assert.strictEqual(result.ok && result.accessToken, "sk-ant-oat01-vrai");
  });

  it("signale l'absence de session Claude.ai", () => {
    const result = extractClaudeAccessToken({ mcpOAuth: { "x|y": { accessToken: "abc" } } }, NOW);
    assert.isFalse(result.ok);
    assert.strictEqual(!result.ok && result.failure.reason, "missing");
  });

  it("refuse un jeton expiré", () => {
    const result = extractClaudeAccessToken(
      { claudeAiOauth: { accessToken: "sk-ant-oat01-abc", expiresAt: NOW - 1 } },
      NOW,
    );
    assert.isFalse(result.ok);
    assert.strictEqual(!result.ok && result.failure.reason, "expired");
  });

  it("accepte un jeton dont l'échéance est future", () => {
    const result = extractClaudeAccessToken(
      { claudeAiOauth: { accessToken: "sk-ant-oat01-abc", expiresAt: NOW + 60_000 } },
      NOW,
    );
    assert.isTrue(result.ok);
  });

  it("refuse une entrée sans jeton exploitable", () => {
    for (const oauth of [{}, { accessToken: "" }, { accessToken: 42 }]) {
      const result = extractClaudeAccessToken({ claudeAiOauth: oauth }, NOW);
      assert.isFalse(result.ok);
      assert.strictEqual(!result.ok && result.failure.reason, "malformed");
    }
  });

  it("refuse une racine qui n'est pas un objet", () => {
    for (const value of [null, "texte", 42, []]) {
      const result = extractClaudeAccessToken(value, NOW);
      // Un tableau est un objet : il échoue plus loin, faute d'entrée claudeAiOauth.
      assert.isFalse(result.ok);
    }
  });
});

describe("parseClaudeCredentials", () => {
  it("analyse puis extrait", () => {
    const result = parseClaudeCredentials(
      '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-x"}}',
      NOW,
    );
    assert.strictEqual(result.ok && result.accessToken, "sk-ant-oat01-x");
  });

  it("signale un fichier illisible", () => {
    const result = parseClaudeCredentials("{pas du json", NOW);
    assert.isFalse(result.ok);
    assert.strictEqual(!result.ok && result.failure.reason, "malformed");
  });
});

describe("CLAUDE_CREDENTIALS_SEGMENTS", () => {
  it("désigne le fichier de session sous le dossier personnel", () => {
    assert.deepStrictEqual([...CLAUDE_CREDENTIALS_SEGMENTS], [".claude", ".credentials.json"]);
  });
});
