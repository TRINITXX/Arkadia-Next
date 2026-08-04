# Plan d'implémentation — Driver « Hermes Agent » (ACP, VPS 2)

> Objectif : ajouter le **Hermes Agent** de Nous Research comme backend d'agent
> sélectionnable dans Arkadia, tournant **sur le VPS 2** et piloté par ACP-sur-stdio
> tunnelé via SSH. But sous-jacent : basculer du travail hors d'Anthropic (Hermes tourne
> sur des modèles bon marché) sans quitter l'UI d'Arkadia.
>
> **Statut : plan uniquement. Aucun code écrit.**

## 1. Principe

Arkadia pilote déjà deux agents CLI externes en **ACP-sur-stdio** : `Cursor` et `Grok`.
Hermes parle le même protocole (`hermes acp`). Le driver Hermes est donc un **clone du
driver Grok**, à une différence structurelle près :

| Aspect | Grok (référence) | Hermes (VPS 2) |
|---|---|---|
| Transport | processus local `grok agent stdio` | `ssh <vps> hermes acp` — stdio tunnelé |
| Où agissent les outils fichier/terminal | machine locale | **le VPS 2** |
| Auth | `XAI_API_KEY` → `authMethodId` | credentials déjà dans `~/.hermes` du VPS (à confirmer) |
| Liste de modèles | réponse ACP `session/new` (`models`) | idem — Hermes publie ses modèles par ACP |
| Mises à jour | manuel | manuel (`hermes update` sur le VPS) |

La couche protocole (`packages/effect-acp`, `apps/server/src/provider/acp/AcpSessionRuntime.ts`)
**n'est pas touchée** : elle accepte déjà un `{ command, args, cwd, env }` arbitraire et un
`ChildProcessHandle` duplex. `command: "ssh"` produit exactement le handle attendu.

## 2. Prérequis — VÉRIFIÉS sur le VPS 2 le 2026-08-04 ✅

État réel constaté par SSH, plus rien à deviner.

1. **Accès SSH** ✅ : `ssh root@37.27.176.67` (Hetzner `claimed-cx23-hel1`, clé uniquement,
   `BatchMode` OK). Pas d'alias `~/.ssh/config` — on met l'IP en dur (ou on ajoute un alias).
2. **Hermes installé** ✅ : **v0.19.0**, sous l'utilisateur **`hermes`** (pas `root`).
   Launchers `/home/hermes/.local/bin/hermes` et `.../hermes-acp`. **L'extra ACP est présent :
   `hermes acp --check` → « Hermes ACP check OK ».** PATH dispo seulement via login shell de `hermes`.
3. **Auth ACP** ✅ (à confirmer au handshake) : credentials déjà en place (`~/.hermes/auth.json`,
   `.env`, `config.yaml`) et `--check` passe sans prompt → `authenticate` sera probablement un no-op.
   Reste à lire les `authMethods` du `initialize` pour figer le `authMethodId` (étape 0 du §5).
4. **Modèle par défaut côté Hermes** ✅ : **`deepseek/deepseek-v4-flash-0731`** via provider `nous`
   (Nous Portal), fallbacks OpenRouter gratuits. **Le modèle bon marché est déjà le défaut** — côté
   coût, rien à régler sur le VPS ; Arkadia se contente de dialoguer.

### Conséquence directe sur la commande de spawn

Comme Hermes vit sous l'utilisateur `hermes` et que son PATH n'existe qu'en login shell, la commande
n'est **pas** `ssh <cible> hermes acp` mais :

```
ssh -o BatchMode=yes root@37.27.176.67 sudo -u hermes -H bash -lc 'hermes acp'
```

- `ssh` **sans `-t`** (pas de PTY : ACP a besoin d'un stdio brut ; stdout = JSON-RPC, stderr = logs).
- `root` peut `sudo -u hermes` sans mot de passe (root le peut nativement ; testé OK sur `--check`).
- `bash -lc` pour récupérer `~/.local/bin` dans le PATH.
- Optionnel : préfixer `HERMES_ACP_SKIP_CONFIGURED_MCP=1` (voir §6, concurrence gateway).

## 3. Fichiers à créer (miroir de Grok)

Tous sous `apps/server/src/provider/`, sauf indication.

| Nouveau fichier | Cloné de | Adaptations Hermes |
|---|---|---|
| `acp/HermesAcpSupport.ts` | `acp/GrokAcpSupport.ts` | `buildHermesAcpSpawnInput` → `command:"ssh"`, `args:["-o","BatchMode=yes", sshTarget, "sudo","-u","hermes","-H","bash","-lc","hermes acp"]` (cf. §2) ; `authMethodId` selon §2.3 ; réutiliser le pattern `setSessionModel` / `currentModelIdFromSessionSetup` (pas d'extension custom) ; **retirer** tout le xAI (`XAI_API_KEY`, `GROK_OAUTH2_REFERRER`, `makeXAiPromptCompletionRuntime`). |
| `Layers/HermesAdapter.ts` | `Layers/GrokAdapter.ts` (~1460 l.) | même mapping évènements ACP → `ProviderRuntimeEvent` ; retirer les spécificités xAI ; brancher `makeHermesAcpRuntime`. Le gros du fichier est générique. |
| `Layers/HermesProvider.ts` | `Layers/GrokProvider.ts` (~335 l.) | `buildInitialHermesProviderSnapshot`, `checkHermesProviderStatus` (probe = `ssh <cible> hermes acp --check` / `--version`), `enrichHermesSnapshot`. |
| `acp/HermesAcpCliProbe.ts` | `acp/GrokAcpCliProbe.ts` | détection de présence/version via la commande distante. |
| `Drivers/HermesDriver.ts` | `Drivers/GrokDriver.ts` | `DRIVER_KIND = "hermes"`, `displayName: "Hermes"`, maintenance manuelle, assemble adapter + textGeneration + snapshot. |
| `textGeneration/HermesTextGeneration.ts` | `textGeneration/CursorTextGeneration.ts` | génération de texte (titres, tâches de fond) via `runtime.prompt` + collecte des `agent_message_chunk`. Approche Cursor (générique) plutôt que l'extension xAI de Grok. |

Tests unitaires jumeaux à créer en parallèle (le repo teste chaque pièce) :
`HermesAcpSupport.test.ts`, `HermesAdapter.test.ts`, `HermesProvider.test.ts`,
`HermesAcpCliProbe.test.ts` — clonés des `Grok*.test.ts`.

## 4. Fichiers à éditer

| Fichier | Édition |
|---|---|
| `apps/server/src/provider/builtInDrivers.ts` | importer `HermesDriver` + `HermesDriverEnv`, les ajouter à `BUILT_IN_DRIVERS` et à l'union `BuiltInDriversEnv`. |
| `packages/contracts/src/settings.ts` | `HermesSettings = makeProviderSettingsSchema({...})` : `enabled`, `binaryPath` (défaut `hermes`), **`sshTarget`** (nouveau — user@host du VPS 2) et éventuellement **`transport: "local" \| "ssh"`** + `remoteBinaryPath` ; `customModels`. Ajouter `providers.hermes` (mirror legacy) + le `HermesSettingsPatch`. |
| `packages/contracts/src/model.ts` | `HERMES_DRIVER_KIND`, entrées `DEFAULT_MODEL_BY_PROVIDER[hermes]`, `PROVIDER_DISPLAY_NAMES[hermes] = "Hermes"`, `DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[hermes]`. Tout est `Partial<Record<…>>` → l'absence dégrade proprement, mais on les met pour un rendu correct. |
| (UI) `apps/web/src/components/settings/…` | vérifier que le formulaire de réglages rend bien le nouveau champ `sshTarget` (le système `providerSettingsForm` le fait automatiquement via les annotations du schéma — normalement zéro code UI). |

**Le champ `sshTarget` est la seule vraie nouveauté de conception** par rapport à Grok :
c'est lui qui porte « mon VPS 2 ». Le reste est du clonage.

## 5. Ordre d'exécution (quand on codera)

0. **Sonde manuelle** (hors code) : depuis ce PC, `ssh <cible> 'hermes acp --check'` puis capturer
   le `initialize` (lancer `ssh <cible> hermes acp`, envoyer un `initialize` JSON-RPC, lire la
   réponse) pour figer `protocolVersion`, `authMethods`, et le format de `models`. Débloque §2.3.
1. Contracts d'abord : `settings.ts` (`HermesSettings` + `sshTarget`) et `model.ts`. `npx tsc --noEmit`.
2. `HermesAcpSupport.ts` + son test (spawn input + résolution auth).
3. `HermesProvider.ts` + `HermesAcpCliProbe.ts` (statut/probe distant) + tests.
4. `HermesAdapter.ts` + test (le cœur : mapping évènements).
5. `HermesTextGeneration.ts`.
6. `HermesDriver.ts` puis inscription dans `builtInDrivers.ts`.
7. `npx tsc --noEmit` global, puis la suite de tests du package `apps/server`.
8. Essai bout-en-bout : lancer Arkadia, créer une instance Hermes pointée sur le VPS,
   ouvrir un thread, vérifier stream/permissions/sélection de modèle.

## 6. Points de vigilance / limites assumées

- **Outils fichier = VPS.** Un Hermes-VPS lit/écrit sur le VPS, pas sur tes repos locaux. C'est
  voulu (travail autonome côté serveur), mais il ne pourra pas éditer le code d'Arkadia en local.
  Si un jour tu veux ça, on ajoutera une 2ᵉ instance en transport `local` (le registre gère le
  multi-instances nativement).
- **Permissions & sécurité.** En ACP, Hermes demande la permission (`session/request_permission`)
  pour les actions sensibles ; Arkadia affiche le dialogue (contrairement au bridge Buzz qui
  auto-approuve). Bien vérifier que l'adapter route `handleRequestPermission` vers l'UI et
  **n'auto-approuve pas** — surtout que le toolset `hermes-acp` inclut `terminal` et `execute_code`
  qui s'exécutent **sur le VPS**.
- **Robustesse SSH.** Coupure réseau = mort du subprocess ; `AcpSessionRuntime` a déjà une
  `terminationError`. Prévoir `ServerAliveInterval`/`BatchMode` dans les args `ssh` pour éviter les
  pendaisons. (Envisager Tailscale — `packages/tailscale` — pour un lien stable, mais hors périmètre v1.)
- **Concurrence avec la gateway.** Un Hermes tourne déjà en permanence sous `hermes` (gateway
  Telegram/… — `gateway.lock`, `channel_directory.json`). `hermes acp` démarre un 2ᵉ processus qui
  **partage `~/.hermes`** (state.db SQLite, config, skills, mémoire). SQLite en WAL le tolère, mais
  poser `HERMES_ACP_SKIP_CONFIGURED_MCP=1` évite de re-démarrer les serveurs MCP que la gateway tient
  déjà. À surveiller : contention sur `state.db`, effets croisés mémoire/skills entre les deux.
- **Latence.** Chaque tour transite par SSH ; acceptable pour du travail de fond, à surveiller pour
  de l'interactif serré.
- **Pas de prompt caching Anthropic** ici — sans objet, Hermes n'utilise pas Anthropic (c'est le but).

## 7. Ce que ce plan NE fait pas (v1)

- Pas de swap de modèle dans Claude Code (claude-code-router → DeepSeek) : reporté, décision prise.
- Pas d'instance Hermes locale : VPS uniquement pour la v1.
- Pas d'intégration Tailscale dédiée : SSH simple d'abord.
- Registre des clés API : si le VPS Hermes utilise une clé tierce (OpenRouter…) **facturable**,
  l'ajouter à `Cockpit/.../registry.ts` dans le même commit (règle globale). À vérifier au moment venu.
