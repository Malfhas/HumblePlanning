/**
 * Heuristic French text detector (i18n tooling: `i18n:scan`, tests).
 * A text is considered French if it contains a French accented / typographic
 * character, or a common French function word / domain word (with at least two
 * words, or an initial capital). Slightly underestimates (« Planning »,
 * « Export » contain neither an accent nor a word from the list).
 */

export const FR_WORDS = new Set(
  `le la les des du de un une est et pour avec sur dans aucun aucune impossible introuvable erreur
veuillez votre vos nous vous il elle ce cette ces pas ne plus tous toutes tout toute par au aux qui que quoi
mot passe utilisateur utilisateurs tâche tâches projet projets équipe équipes rôle rôles ressource ressources
véhicule véhicules enregistrer annuler supprimer modifier ajouter créer fermer valider rechercher filtrer
chargement nouveau nouvelle date début fin heure heures jour jours semaine mois année statut statuts
lieu lieux fichier fichiers paramètres connexion déconnexion compte profil sélectionner choisir oui non
envoyer email emails notification notifications titre nom prénom description couleur actif inactif
groupe groupes export exporter importer sauvegarde accès permission permissions autorisé autorisée invalide
requis obligatoire succès échec désactivé désactivée activé activée trop requête requêtes réessayez`.split(/\s+/),
);

export const FR_ACCENT_RE = /[àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ«»…’]/;
const WORD_RE = /[A-Za-zÀ-ÿœŒ']+/g;

export function looksFrench(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 2) return false;
  if (/^(@\/|\.\/|\.\.\/|http|\/api|bg-|text-|data-)/.test(s)) return false;
  const lowerWords = (s.toLowerCase().match(WORD_RE) ?? []);
  // classNames, keys, CSS: lowercase and technical punctuation, no FR word
  if (/^[a-z0-9_\-:./[\]()%#=&?, ]+$/.test(s) && !lowerWords.some((w) => FR_WORDS.has(w))) return false;
  if (/^[A-Z0-9_]+$/.test(s)) return false; // CONSTANTS
  // technical identifiers without spaces: permission keys (notifications:view),
  // snake_case (email_sent), paths or dotted keys (tasks.errors.notFound),
  // including with a camelCase first segment (multiDelete.description)
  if (/^[a-z0-9][a-zA-Z0-9]*([_:./-][a-zA-Z0-9]+)+$/.test(s)) return false;
  if (FR_ACCENT_RE.test(s)) return true;
  const words = s.match(WORD_RE) ?? [];
  if (words.length === 0) return false;
  const hits = words.filter((w) => FR_WORDS.has(w.toLowerCase())).length;
  return hits >= 1 && (words.length >= 2 || /^[A-ZÀ-Ý]/.test(s));
}
