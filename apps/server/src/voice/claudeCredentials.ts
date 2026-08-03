/**
 * Lecture du jeton de session Claude Code, utilisé pour ouvrir le flux de
 * dictée. Le fichier contient aussi les jetons OAuth des serveurs MCP : seule
 * l'entrée `claudeAiOauth` porte le jeton du compte Claude.
 *
 * Module purement fonctionnel : l'accès disque et l'horloge sont fournis par
 * l'appelant, qui dispose des services Effect correspondants.
 */

/** Segments du fichier de session, relatifs au dossier personnel. */
export const CLAUDE_CREDENTIALS_SEGMENTS = [".claude", ".credentials.json"] as const;

export type CredentialsFailure =
  | { readonly reason: "missing"; readonly detail: string }
  | { readonly reason: "malformed"; readonly detail: string }
  | { readonly reason: "expired"; readonly detail: string };

export type CredentialsResult =
  | { readonly ok: true; readonly accessToken: string }
  | { readonly ok: false; readonly failure: CredentialsFailure };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Extrait le jeton du compte Claude d'un contenu de credentials déjà analysé. */
export const extractClaudeAccessToken = (parsed: unknown, now: number): CredentialsResult => {
  if (!isRecord(parsed)) {
    return {
      ok: false,
      failure: { reason: "malformed", detail: "Credentials root is not an object." },
    };
  }

  const oauth = parsed["claudeAiOauth"];
  if (!isRecord(oauth)) {
    return {
      ok: false,
      failure: {
        reason: "missing",
        detail:
          "No 'claudeAiOauth' entry — voice dictation requires a Claude.ai session, not an API key.",
      },
    };
  }

  const accessToken = oauth["accessToken"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return {
      ok: false,
      failure: {
        reason: "malformed",
        detail: "'claudeAiOauth.accessToken' is missing or not a string.",
      },
    };
  }

  const expiresAt = oauth["expiresAt"];
  if (typeof expiresAt === "number" && expiresAt <= now) {
    return {
      ok: false,
      failure: {
        reason: "expired",
        detail: "The Claude session token has expired. Run `claude` once to refresh it.",
      },
    };
  }

  return { ok: true, accessToken };
};

/** Analyse le contenu brut du fichier puis en extrait le jeton. */
export const parseClaudeCredentials = (raw: string, now: number): CredentialsResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      failure: {
        reason: "malformed",
        detail: `Credentials file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  return extractClaudeAccessToken(parsed, now);
};
