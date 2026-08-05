import type { ProviderInstanceEnvironmentVariable } from "@t3tools/contracts";

export interface ProviderCredentialDefinition {
  readonly label: string;
  readonly environmentVariable: string;
  readonly placeholder: string;
  readonly description?: string;
}

export function buildCredentialEnvironment(
  credential: ProviderCredentialDefinition,
  rawValue: string,
): ReadonlyArray<ProviderInstanceEnvironmentVariable> {
  const value = rawValue.trim();
  return value.length > 0 ? [{ name: credential.environmentVariable, value, sensitive: true }] : [];
}
