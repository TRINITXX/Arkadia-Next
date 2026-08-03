/**
 * Relaie les blocs audio du micro vers le thread principal, sans transformation.
 *
 * Fichier volontairement séparé et chargé par son URL : la politique de sécurité
 * de l'application n'autorise que les scripts servis par l'app elle-même, ce qui
 * exclut un module fabriqué à la volée via une Blob URL.
 */
class MicrophoneTapProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      // Un MessagePort n'accepte pas d'origine cible, contrairement à window.
      // eslint-disable-next-line unicorn/require-post-message-target-origin
      this.port.postMessage(input.map((channel) => new Float32Array(channel)));
    }
    return true;
  }
}

registerProcessor("microphone-tap", MicrophoneTapProcessor);
