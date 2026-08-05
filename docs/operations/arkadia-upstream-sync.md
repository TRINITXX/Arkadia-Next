# Arkadia upstream synchronization

This runbook documents the automated review of new T3 Code updates for the Arkadia fork.

## User experience

Hermes checks the upstream project every day at 10:00 Europe/Paris. If the Windows PC is unavailable, it retries silently at 10:30, 11:00, 11:30, and 12:00, then waits until the next day.

Only useful changes are shown in Telegram. Each proposal uses short, plain French and offers a direct accept or reject action. Related changes that cannot safely be separated are grouped into one proposal.

The following upstream work is permanently hidden:

- the official mobile application;
- the official left sidebar and its navigation behavior;
- features that Arkadia deliberately deleted;
- marketing and relay-only work, unless an accepted update strictly depends on shared code from it.

Rejected proposals stay rejected. Hermes may show one again only when upstream materially changes it or when a later accepted update requires it.

Security updates may generate an immediate proposal outside the normal schedule, but they still require explicit approval.

## Applying accepted updates

Hermes works directly on `main`. Before changing the checkout, it creates a uniquely named `backup/upstream-*` branch.

If uncommitted work is present, Hermes does not apply anything. Telegram offers:

- `Reporter`: leave the checkout untouched and keep the accepted updates pending;
- `Commit`: scan the pending work for secrets and generated artifacts, commit the safe work with a short description, then immediately continue with the accepted updates.

Routine review uses GPT-5.6 Luna. Conflicts, migrations, major dependency changes, and risky architecture work use GPT-5.6 Sol only for that isolated operation. The persistent Hermes profile remains on Luna.

After applying an update, Hermes runs focused checks. It pushes `main` to `origin` only when every required check passes.

If the update still fails after two Sol repair attempts, Hermes restores the backup branch state, does not push, and sends the complete technical log as a Telegram attachment. That log is the handoff artifact for Claude Fable.

## Installed components

The automation runs in the Hermes `openai` profile on the VPS. Its permanent policy, scripts, state database, log directory, Telegram callback bridge, and cron job identifiers are recorded here after installation.

- Profile: `openai`
- Default model: `gpt-5.6-luna` through `openai-codex`
- Escalation model: `gpt-5.6-sol` through `openai-codex`
- Windows target: `TRINITX@pc1.tailc880c9.ts.net`
- Repository: `C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia-Next`
- Upstream remote: `upstream` -> `pingdotgg/t3code`
- Personal remote: `origin` -> `TRINITXX/Arkadia-Next`
- State database: `/home/hermes/.hermes/state/arkadia-upstream/state.sqlite3`
- Failure logs: `/home/hermes/.hermes/state/arkadia-upstream/logs/`
- Installed profile plugin: `/home/hermes/.hermes/profiles/openai/plugins/arkadia-automation/`
- Scheduled jobs:
  - `f012bc12d1b4` at 10:00 Europe/Paris;
  - `c1d4b2007253` at 10:30 Europe/Paris;
  - `57137c73a0d6` at 11:00 Europe/Paris;
  - `15ca5d9efb98` at 11:30 Europe/Paris;
  - `5546f04871ce` at 12:00 Europe/Paris.
- Hermes callback bridge commit: `60cc161 feat(telegram): add plugin callback bridge`

## Recovery

Before manual recovery, disable the five Arkadia cron entries so that no scheduled tick overlaps the repair. Inspect the latest automation log and the newest `backup/upstream-*` branch before changing Git state.

Pause a job with `hermes --profile openai cron pause <job-id>` and resume it with `hermes --profile openai cron resume <job-id>`. Inspect schedules with `hermes --profile openai cron list`, scheduler health with `hermes --profile openai cron status`, and durable runs with `hermes --profile openai cron runs <job-id>`.

Never delete a backup until the corresponding update is verified on `origin/main`. Never paste Telegram tokens, SSH private keys, profile credentials, or repository secrets into a repair prompt or log.

## Bootstrap prompt

Use the following prompt to audit, repair, or recreate the automation. It intentionally requires live inspection instead of trusting stale paths or identifiers.

```text
Tu dois auditer, réparer ou recréer l’automatisation de mises à jour upstream d’Arkadia. Commence par inspecter l’état réel du profil Hermes openai, du PC Windows joignable par Tailscale SSH et du dépôt Arkadia-Next. Ne suppose jamais qu’un chemin, une branche, un modèle, un identifiant cron ou un service est encore identique à ce document. Ne révèle jamais de secret dans les sorties ou les journaux.

Le but est de surveiller pingdotgg/t3code et de proposer uniquement les mises à jour utiles au fork Arkadia. Travaille directement sur main, sans worktree. Le dépôt personnel reste origin et le projet officiel reste upstream. Avant toute modification, crée une branche backup/upstream-* unique. Active et conserve Git rerere afin de mémoriser les résolutions de conflits récurrentes.

Ignore totalement et silencieusement toutes les modifications de l’application mobile officielle, de la sidebar gauche officielle, de sa navigation et de toutes les fonctions volontairement supprimées dans Arkadia. Ignore aussi le marketing et le relay lorsqu’ils ne sont pas requis par une dépendance partagée acceptée. Ces éléments ne doivent jamais apparaître dans Telegram, même pour dire qu’ils ont été ignorés.

Chaque jour à 10:00 Europe/Paris, vérifie si une nouvelle release ou de nouveaux commits upstream pertinents existent. Si le PC est éteint ou inaccessible, réessaie silencieusement à 10:30, 11:00, 11:30 et 12:00, puis attends le lendemain. Un seul créneau doit traiter un cycle donné. Les propositions et décisions doivent survivre aux redémarrages.

Analyse normalement avec GPT-5.6 Luna via OpenAI Codex. Utilise GPT-5.6 Sol uniquement pour une sous-tâche isolée lorsqu’il y a des conflits, une migration, un changement majeur de dépendances ou un risque architectural. Après cette sous-tâche, le profil et les futures conversations doivent rester sur Luna. Ne modifie jamais le modèle par défaut pour passer à Sol.

Dans Telegram, écris en français très simple, avec des explications courtes, sans nom de fichier ni jargon. Regroupe les changements inséparables. Pour chaque proposition utile, donne un bouton Accepter et un bouton Refuser. Un refus reste mémorisé et invisible lors des cycles suivants, sauf si le changement a été matériellement modifié ou devient nécessaire à une autre mise à jour acceptée. Une correction de sécurité urgente peut être proposée immédiatement, mais doit toujours être acceptée explicitement.

Quand une mise à jour acceptée doit être appliquée et que main contient du travail non commité, ne touche à rien automatiquement. Affiche seulement deux boutons : Reporter et Commit. Reporter laisse tout en attente. Commit doit d’abord rechercher les secrets, gros artefacts, fichiers générés et éléments manifestement dangereux, puis commiter uniquement le travail sûr avec une description légère de ce qui restait à commiter. Après ce commit, applique immédiatement les mises à jour acceptées.

Applique seulement les groupes acceptés. Préserve l’identité Arkadia, ses fournisseurs, son apparence, sa navigation, sa sidebar et ses fonctions propres. Exécute les vérifications ciblées adaptées aux zones réellement modifiées. Ne lance pas toute la suite du monorepo sans nécessité. Pousse automatiquement main vers origin uniquement si toutes les vérifications requises réussissent.

En cas d’échec, autorise au maximum deux tentatives de réparation avec GPT-5.6 Sol. Si elles échouent, restaure exactement l’état de la branche de sauvegarde, ne pousse rien, conserve les propositions acceptées comme non appliquées et envoie sur Telegram un fichier journal technique complet. Le journal doit contenir les commits concernés, les commandes exécutées, les sorties utiles, les conflits, les modifications tentées, les vérifications, les erreurs et la restauration, tout en masquant les secrets. Il doit permettre à Claude Fable de reprendre le diagnostic.

Utilise un état durable transactionnel, des actions Telegram idempotentes et des identifiants de callback courts. N’ouvre jamais un second poller Telegram : utilise le gateway et le bot déjà actifs. Empêche les doubles clics, doubles exécutions, cycles concurrents et pushes partiels. Les commandes distantes doivent être limitées à des opérations fixes et validées ; n’exécute jamais du shell arbitraire reçu depuis Telegram ou généré par un modèle.

Avant de déclarer le système opérationnel, prouve en mode sans mutation que le VPS atteint le PC, que le dépôt et ses remotes sont corrects, que le filtrage masque bien les exclusions, que les horaires utilisent Europe/Paris, que Luna reste le modèle par défaut, que Sol fonctionne uniquement par invocation, que les callbacks Telegram fonctionnent sur le bot existant et qu’un redémarrage ne perd ni l’état ni les décisions. Documente les chemins et identifiants réellement installés dans docs/operations/arkadia-upstream-sync.md.
```
