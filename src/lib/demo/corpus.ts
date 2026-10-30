/**
 * French corpus of the demo dataset: a fictional electrical and HVAC
 * contractor with three branches. Names of companies, sites and streets are
 * invented; addresses stay at the level of a business park.
 */

/** Kind of work: links teams, projects and task titles. */
export type WorkKind = "building" | "lowCurrent" | "hvac" | "studies" | "maintenance" | "lighting" | "industry" | "automation";

export const BUSINESS_UNITS = [
  { name: "Lyon Métropole", number: "BU-LYO", address: "Parc d'activités des Tilleuls, 69007 Lyon", lat: 45.7485, lng: 4.8467, color: "#2563eb" },
  { name: "Grenoble Alpes", number: "BU-GRE", address: "Parc technologique des Glaciers, 38000 Grenoble", lat: 45.1885, lng: 5.7245, color: "#16a34a" },
  { name: "Saint-Étienne Loire", number: "BU-STE", address: "Zone industrielle du Pilat, 42000 Saint-Étienne", lat: 45.4397, lng: 4.3872, color: "#d97706" },
] as const;

export const LABOR_TYPES = [
  { key: "lead", name: "Chef d'équipe", initials: "CE", rate: 48 },
  { key: "electrician", name: "Électricien", initials: "ELEC", rate: 42 },
  { key: "technician", name: "Technicien", initials: "TECH", rate: 45 },
  { key: "plumber", name: "Plombier-chauffagiste", initials: "PC", rate: 43 },
  { key: "apprentice", name: "Apprenti", initials: "APP", rate: 22 },
  { key: "manager", name: "Chargé d'affaires", initials: "CA", rate: 58 },
  { key: "designer", name: "Dessinateur-projeteur", initials: "DP", rate: 46 },
] as const;

export type LaborKey = (typeof LABOR_TYPES)[number]["key"];

/** Field teams: branch index, kind of work and crew (labor type per member, leader first). */
export const TEAMS: readonly { name: string; bu: number; kind: WorkKind; color: string; crew: readonly LaborKey[] }[] = [
  { name: "Électricité bâtiment", bu: 0, kind: "building", color: "#3b82f6", crew: ["lead", "electrician", "electrician", "electrician", "electrician", "electrician", "electrician", "apprentice", "apprentice"] },
  { name: "Courants faibles", bu: 0, kind: "lowCurrent", color: "#8b5cf6", crew: ["lead", "technician", "technician", "technician", "technician", "technician", "apprentice"] },
  { name: "CVC – Plomberie", bu: 0, kind: "hvac", color: "#06b6d4", crew: ["lead", "plumber", "plumber", "plumber", "plumber", "plumber", "apprentice"] },
  { name: "Bureau d'études", bu: 0, kind: "studies", color: "#64748b", crew: ["manager", "designer", "designer", "designer"] },
  { name: "Maintenance", bu: 1, kind: "maintenance", color: "#22c55e", crew: ["lead", "technician", "technician", "technician", "technician", "technician", "technician", "apprentice"] },
  { name: "Éclairage public", bu: 1, kind: "lighting", color: "#eab308", crew: ["lead", "electrician", "electrician", "electrician", "electrician", "electrician"] },
  { name: "Électricité industrielle", bu: 2, kind: "industry", color: "#f97316", crew: ["lead", "electrician", "electrician", "electrician", "electrician", "electrician", "electrician", "apprentice"] },
  { name: "Automatismes", bu: 2, kind: "automation", color: "#ef4444", crew: ["lead", "technician", "technician", "technician", "technician", "technician"] },
];

/** Office staff (not shown on the schedule): branch managers and head office. Role ids from the base seed. */
export const OFFICE_STAFF: readonly { job: string; bu: number; roleId: string; labor: LaborKey }[] = [
  { job: "Responsable d'exploitation", bu: 0, roleId: "00000000-0000-0000-0000-000000000001", labor: "manager" },
  { job: "Gestion du planning", bu: 0, roleId: "00000000-0000-0000-0000-000000000001", labor: "manager" },
  { job: "Responsable d'agence", bu: 0, roleId: "00000000-0000-0000-0000-000000000002", labor: "manager" },
  { job: "Responsable d'agence", bu: 1, roleId: "00000000-0000-0000-0000-000000000002", labor: "manager" },
  { job: "Responsable d'agence", bu: 2, roleId: "00000000-0000-0000-0000-000000000002", labor: "manager" },
];

export const FIRST_NAMES = [
  "Lucas", "Hugo", "Léa", "Emma", "Nathan", "Chloé", "Louis", "Manon", "Gabriel", "Camille",
  "Arthur", "Inès", "Jules", "Sarah", "Thomas", "Julie", "Maxime", "Clara", "Antoine", "Laura",
  "Nicolas", "Pauline", "Julien", "Marine", "Romain", "Élise", "Mathis", "Lina", "Théo", "Anaïs",
  "Quentin", "Océane", "Baptiste", "Margaux", "Kévin", "Justine", "Alexandre", "Mélanie", "Florian", "Charlotte",
  "Damien", "Audrey", "Yanis", "Noémie", "Sébastien", "Claire", "Adrien", "Lucie", "Mehdi", "Sophie",
  "Karim", "Amandine", "Samuel", "Morgane", "Victor", "Elsa", "Paul", "Aurélie", "Benjamin", "Céline",
];

export const LAST_NAMES = [
  "Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau",
  "Simon", "Laurent", "Lefebvre", "Michel", "Garcia", "David", "Bertrand", "Roux", "Vincent", "Fournier",
  "Morel", "Girard", "André", "Mercier", "Dupont", "Lambert", "Bonnet", "François", "Martinez", "Legrand",
  "Garnier", "Faure", "Rousseau", "Blanc", "Guérin", "Muller", "Henry", "Roussel", "Perrin", "Morin",
  "Mathieu", "Clément", "Gauthier", "Dumont", "Lopez", "Fontaine", "Chevalier", "Robin", "Masson", "Sanchez",
  "Gérard", "Nguyen", "Boyer", "Denis", "Lemaire", "Duval", "Joly", "Benali", "Haddad", "Da Silva",
];

export const PROJECT_GROUPS = [
  { name: "Logements", bu: 0 },
  { name: "Tertiaire", bu: 0 },
  { name: "Santé et enseignement", bu: 0 },
  { name: "Contrats de maintenance", bu: 1 },
  { name: "Collectivités", bu: 1 },
  { name: "Industrie", bu: 2 },
  { name: "Logistique", bu: 2 },
] as const;

/** Projects: group index and the kinds of work they need. */
export const PROJECTS: readonly { name: string; group: number; kinds: readonly WorkKind[] }[] = [
  { name: "Résidence Les Tilleuls", group: 0, kinds: ["building", "lowCurrent", "hvac"] },
  { name: "Résidence Le Clos des Vignes", group: 0, kinds: ["building", "hvac"] },
  { name: "Immeuble Quai Sud – 48 logements", group: 0, kinds: ["building", "lowCurrent", "hvac"] },
  { name: "Résidence seniors Les Glycines", group: 0, kinds: ["building", "lowCurrent"] },
  { name: "Écoquartier du Val – îlot B", group: 0, kinds: ["building", "hvac"] },
  { name: "Siège social Horizon", group: 1, kinds: ["building", "lowCurrent", "hvac"] },
  { name: "Plateau de bureaux Le Belvédère", group: 1, kinds: ["building", "lowCurrent"] },
  { name: "Data center Orion – salle 2", group: 1, kinds: ["building", "lowCurrent", "hvac"] },
  { name: "Centre d'affaires Les Terrasses", group: 1, kinds: ["lowCurrent", "hvac"] },
  { name: "Hôtel Le Panorama", group: 1, kinds: ["building", "hvac"] },
  { name: "Groupe scolaire du Parc", group: 2, kinds: ["building", "lowCurrent"] },
  { name: "Clinique des Coteaux", group: 2, kinds: ["building", "lowCurrent", "hvac"] },
  { name: "Lycée des métiers – atelier", group: 2, kinds: ["building"] },
  { name: "Crèche Les Petits Pas", group: 2, kinds: ["building", "hvac"] },
  { name: "EHPAD Les Lilas", group: 2, kinds: ["lowCurrent", "hvac"] },
  { name: "Maintenance – Campus Innovation", group: 3, kinds: ["maintenance"] },
  { name: "Maintenance – Centre aquatique", group: 3, kinds: ["maintenance"] },
  { name: "Maintenance – Parc tertiaire Belledonne", group: 3, kinds: ["maintenance"] },
  { name: "Maintenance – Hôpital de jour", group: 3, kinds: ["maintenance"] },
  { name: "Maintenance – Résidence universitaire", group: 3, kinds: ["maintenance"] },
  { name: "Dépannages – contrat cadre", group: 3, kinds: ["maintenance", "lighting"] },
  { name: "Éclairage public – avenue des Alpes", group: 4, kinds: ["lighting"] },
  { name: "Éclairage du parc des Cèdres", group: 4, kinds: ["lighting"] },
  { name: "Rénovation de la mairie annexe", group: 4, kinds: ["maintenance", "lighting"] },
  { name: "Médiathèque des Écrins", group: 4, kinds: ["maintenance"] },
  { name: "Vidéoprotection du centre-ville", group: 4, kinds: ["lighting", "maintenance"] },
  { name: "Bornes de recharge – parking de la gare", group: 4, kinds: ["lighting"] },
  { name: "Usine Valmetal – ligne 3", group: 5, kinds: ["industry", "automation"] },
  { name: "Atelier de mécanique du Forez", group: 5, kinds: ["industry"] },
  { name: "Convoyeurs – Plasturgie Loire", group: 5, kinds: ["automation", "industry"] },
  { name: "Armoires électriques – Métallerie du Pilat", group: 5, kinds: ["industry"] },
  { name: "Mise en conformité – Fonderie Saint-Jean", group: 5, kinds: ["industry", "automation"] },
  { name: "Banc d'essai – laboratoire mécatronique", group: 5, kinds: ["automation"] },
  { name: "Entrepôt logistique Sud – cellule 4", group: 6, kinds: ["industry"] },
  { name: "Plateforme frigorifique Rhône-Loire", group: 6, kinds: ["industry", "automation"] },
  { name: "Quai de chargement – Transports Ferrand", group: 6, kinds: ["industry", "automation"] },
  { name: "Éclairage LED – entrepôt Nord", group: 6, kinds: ["industry"] },
  { name: "Centrale photovoltaïque en toiture", group: 6, kinds: ["industry"] },
  { name: "Extension du hall de stockage", group: 6, kinds: ["industry"] },
  { name: "Sous-station électrique – site Bellevue", group: 5, kinds: ["industry"] },
];

export const TASK_TITLES: Record<WorkKind, readonly string[]> = {
  building: ["Pose des chemins de câbles", "Tirage des câbles", "Raccordement du tableau divisionnaire", "Pose des appareillages", "Pose des luminaires", "Réservations et fourreaux", "Mise en service", "Levée de réserves"],
  lowCurrent: ["Câblage de la baie informatique", "Pose des prises RJ45", "Contrôle d'accès", "Alarme incendie – détecteurs", "Recette du réseau", "Vidéoprotection – caméras"],
  hvac: ["Réseaux de chauffage", "Raccordement de la pompe à chaleur", "Pose des radiateurs", "Mise en eau et essais", "Ventilation – gaines VMC", "Équilibrage des réseaux"],
  studies: ["Relevé sur site", "Note de calcul", "Plans d'exécution", "Dossier des ouvrages exécutés", "Bilan de puissance", "Visite préalable"],
  maintenance: ["Maintenance préventive", "Dépannage", "Contrôle annuel", "Thermographie des tableaux", "Remplacement de pièces", "Visite contractuelle"],
  lighting: ["Remplacement des mâts", "Pose des luminaires LED", "Raccordement au réseau", "Réglage de l'horloge astronomique", "Tranchée et fourreaux", "Mise en service"],
  industry: ["Câblage de l'armoire électrique", "Raccordement des moteurs", "Pose des chemins de câbles", "Mise en conformité", "Essais et autocontrôle", "Consignation et déconsignation"],
  automation: ["Programmation de l'automate", "Câblage des capteurs", "Supervision – écrans", "Essais à blanc", "Mise en service", "Formation des opérateurs"],
};

export const TASK_NOTES = [
  "<p>Prévoir la nacelle et les EPI.</p>",
  "<p>Accès par le portail nord, badge à récupérer à l'accueil.</p>",
  "<p>Coupure générale prévue de 8 h à 10 h, prévenir le client.</p>",
  "<p>Matériel livré la veille au dépôt.</p>",
  "<p>Réunion avec le maître d'ouvrage à 14 h.</p>",
];

export const QUALIFICATIONS = [
  { name: "Habilitation électrique B2V", emoji: "Zap", color: "#eab308" },
  { name: "Habilitation électrique BR", emoji: "Bolt", color: "#f97316" },
  { name: "CACES R486 – nacelle", emoji: "Forklift", color: "#3b82f6" },
  { name: "Travail en hauteur", emoji: "HardHat", color: "#64748b" },
  { name: "Sauveteur secouriste du travail", emoji: "Heart", color: "#ef4444" },
  { name: "AIPR – réseaux enterrés", emoji: "Shield", color: "#16a34a" },
];

export const PLACES = [
  { name: "Dépôt Lyon", exclusive: false, color: "#2563eb" },
  { name: "Dépôt Grenoble", exclusive: false, color: "#16a34a" },
  { name: "Dépôt Saint-Étienne", exclusive: false, color: "#d97706" },
  { name: "Salle de formation", exclusive: true, color: "#8b5cf6" },
  { name: "Salle de réunion – siège", exclusive: true, color: "#64748b" },
];

export const VEHICLE_TYPES = [
  { name: "Fourgon", icon: "Truck", color: "#2563eb" },
  { name: "Utilitaire léger", icon: "Car", color: "#16a34a" },
  { name: "Camion nacelle", icon: "Forklift", color: "#d97706" },
];

/** Vehicles: type index and branch index. */
export const VEHICLES = [
  { name: "Fourgon 1 – Lyon", type: 0, bu: 0 },
  { name: "Fourgon 2 – Lyon", type: 0, bu: 0 },
  { name: "Utilitaire – Lyon", type: 1, bu: 0 },
  { name: "Camion nacelle – Lyon", type: 2, bu: 0 },
  { name: "Fourgon – Grenoble", type: 0, bu: 1 },
  { name: "Utilitaire – Grenoble", type: 1, bu: 1 },
  { name: "Camion nacelle – Grenoble", type: 2, bu: 1 },
  { name: "Fourgon – Saint-Étienne", type: 0, bu: 2 },
  { name: "Utilitaire – Saint-Étienne", type: 1, bu: 2 },
];

export const RESOURCE_TYPES = [
  { name: "Levage", icon: "Forklift", color: "#d97706" },
  { name: "Mesure", icon: "Gauge", color: "#8b5cf6" },
  { name: "Outillage", icon: "Wrench", color: "#64748b" },
];

export const RESOURCES = [
  { name: "Nacelle ciseaux 8 m", type: 0, bu: 0 },
  { name: "Échafaudage roulant", type: 0, bu: 1 },
  { name: "Testeur multifonction", type: 1, bu: 0 },
  { name: "Caméra thermique", type: 1, bu: 1 },
  { name: "Analyseur de réseau", type: 1, bu: 2 },
  { name: "Groupe électrogène 20 kVA", type: 2, bu: 2 },
  { name: "Carotteuse", type: 2, bu: 0 },
];

/** Statuses: same styles as the base seed, French names with accents. */
export const STATUSES = [
  { key: "todo", name: "À faire", color: "#3498db", percentage: 0, priority: 1, isDefault: true },
  { key: "inProgress", name: "En cours", color: "#f39c12", percentage: 50, priority: 2 },
  { key: "done", name: "Terminé", color: "#27ae60", percentage: 100, priority: 3, strikethrough: true },
  { key: "cancelled", name: "Annulé", color: "#e74c3c", percentage: 0, priority: 4, strikethrough: true, italic: true },
  { key: "waiting", name: "En attente", color: "#9b59b6", percentage: 25, priority: 5 },
  { key: "validated", name: "Validé", color: "#2ecc71", percentage: 100, priority: 6, bold: true },
] as const;

export type StatusKey = (typeof STATUSES)[number]["key"];
