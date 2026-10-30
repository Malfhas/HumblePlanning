"use client";

import { useState, useCallback } from "react";
import {
  // General
  Award, Shield, Star, Heart, Zap, Flame, Crown, Gem, Sparkles, Medal,
  ThumbsUp, BadgeCheck, CircleCheck, Bookmark, Gift, Diamond, Infinity, Hash,
  // Technical / Industry
  Wrench, Hammer, HardHat, Cog, CircuitBoard, Cpu, Database, Factory,
  Bolt, Gauge, Power, Plug, Settings, SlidersHorizontal, Construction, Pipette,
  Ruler, Magnet, Radiation, Atom, FlaskConical, TestTube2, Beaker,
  // Transport / Logistics
  Truck, Car, Plane, Ship, Train, Bike, Bus, Forklift,
  Container, Anchor, Route, Fuel, PlaneTakeoff, PlaneLanding, CarFront, Sailboat,
  // Health / Medical
  Stethoscope, Syringe, Pill, Activity, HeartPulse, Cross, Dna,
  Thermometer, Microscope, Scan, Accessibility, Hospital, BriefcaseMedical, Baby,
  // Training / Education
  GraduationCap, BookOpen, Library, Lightbulb, Brain, Notebook, PenTool,
  FileText, School, Apple, Languages, Presentation, BookMarked, ScrollText, Pencil,
  // Team / HR
  Users, UserCheck, UserCog, HandHelping, Handshake, UserPlus, UserMinus,
  Contact, BadgeInfo, IdCard, HeartHandshake, PersonStanding, UserRound, CircleUser,
  // Security
  ShieldCheck, ShieldAlert, Lock, Key, Eye, Fingerprint, ScanFace,
  ShieldHalf, KeyRound, LockKeyhole, EyeOff, AlertTriangle, ShieldOff, Siren,
  // Communication
  Megaphone, Radio, Wifi, Globe, Satellite, Phone, Mail, MessageSquare,
  Send, Rss, Signal, BellRing, AtSign, Share2, PhoneCall, MailOpen,
  // Environment / Nature
  Leaf, TreePine, Droplets, Sun, Flower2, Cloud, Wind, Waves,
  Mountain, Snowflake, Sprout, Recycle, Trees, CloudRain, Sunrise, MoonStar,
  // Creative / Media
  Camera, Palette, Music, Mic, Film, Image, Video, Brush,
  Scissors, Frame, Aperture, Clapperboard, Monitor, Printer, Pen, Eraser,
  // Development / IT
  Code, Terminal, FileCode, Bug, Rocket, Server, HardDrive, Laptop,
  Smartphone, GitBranch, Binary, Braces, QrCode, Globe2 as WebDev, Cable, Unplug,
  // Finance / Analytics
  BarChart3, TrendingUp, PieChart, Target, Trophy, LineChart, Calculator,
  Coins, Wallet, CreditCard, Receipt, Banknote, BadgeDollarSign, ChartPie, Scale, Percent,
  // Time / Scheduling
  Clock, Timer, Hourglass, CalendarCheck, AlarmClock, CalendarDays,
  CalendarPlus, History, Watch, TimerReset, CalendarClock, CalendarRange, CalendarMinus, Pause,
  // Location / Geo
  MapPin, Compass, Navigation, Map, Flag, Globe2, Earth, Locate,
  MapPinned, Signpost, Milestone, LocateFixed, Building2, Building, Warehouse, Home,
  // Organization / Files
  Package, Box, Archive, FolderOpen, Clipboard, FileStack, FolderCheck,
  ClipboardList, ClipboardCheck, Inbox, Layers, LayoutGrid, ListChecks, Kanban, Table, Grid3x3,
  // Food / Catering
  UtensilsCrossed, Coffee, Wine, CookingPot, Soup, Wheat, Salad, IceCreamCone,
  Cherry, Grape, Banana, Citrus, Egg, Ham, Sandwich, Pizza,
  // Worksite / Construction
  Tractor, Shovel, Pickaxe, Drill, BrickWall, Fence, TrafficCone,
  PaintBucket, PaintRoller, Axe, TowerControl, LandPlot, Blocks,
  Combine, PencilRuler, Landmark, Cone, CableCar, Anvil, Logs,
  // Sport / Leisure
  Dumbbell, Volleyball, Tent, Gamepad2, Puzzle, Swords, Footprints,
  Trophy as TrophySport, Bike as SportBike, HeartPulse as Cardio, Flame as FireSport, Mountain as Climbing,
  // Home / Everyday life
  Bed, Lamp, Sofa, Bath, Shirt, Glasses, Umbrella, ShoppingCart,
  ShoppingBag, Tag, Tags, Ticket, HandCoins, Briefcase, Luggage, DoorOpen,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Messages } from "@/messages/fr";

/** "HardHat" → "Hard hat": readable English name of a Lucide icon (search, tooltip). */
function humanizeIconName(name: string): string {
  const words = name.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([0-9])([A-Z])/g, "$1 $2");
  return words.charAt(0) + words.slice(1).toLowerCase();
}

export const ICON_MAP: Record<string, LucideIcon> = {
  Award, Shield, Star, Heart, Zap, Flame, Crown, Gem, Sparkles, Medal,
  ThumbsUp, BadgeCheck, CircleCheck, Bookmark, Gift, Diamond, Infinity, Hash,
  Wrench, Hammer, HardHat, Cog, CircuitBoard, Cpu, Database, Factory,
  Bolt, Gauge, Power, Plug, Settings, SlidersHorizontal, Construction, Pipette,
  Ruler, Magnet, Radiation, Atom, FlaskConical, TestTube2, Beaker,
  Truck, Car, Plane, Ship, Train, Bike, Bus, Forklift,
  Container, Anchor, Route, Fuel, PlaneTakeoff, PlaneLanding, CarFront, Sailboat,
  Stethoscope, Syringe, Pill, Activity, HeartPulse, Cross, Dna,
  Thermometer, Microscope, Scan, Accessibility, Hospital, BriefcaseMedical, Baby,
  GraduationCap, BookOpen, Library, Lightbulb, Brain, Notebook, PenTool,
  FileText, School, Apple, Languages, Presentation, BookMarked, ScrollText, Pencil,
  Users, UserCheck, UserCog, HandHelping, Handshake, UserPlus, UserMinus,
  Contact, BadgeInfo, IdCard, HeartHandshake, PersonStanding, UserRound, CircleUser,
  ShieldCheck, ShieldAlert, Lock, Key, Eye, Fingerprint, ScanFace,
  ShieldHalf, KeyRound, LockKeyhole, EyeOff, AlertTriangle, ShieldOff, Siren,
  Megaphone, Radio, Wifi, Globe, Satellite, Phone, Mail, MessageSquare,
  Send, Rss, Signal, BellRing, AtSign, Share2, PhoneCall, MailOpen,
  Leaf, TreePine, Droplets, Sun, Flower2, Cloud, Wind, Waves,
  Mountain, Snowflake, Sprout, Recycle, Trees, CloudRain, Sunrise, MoonStar,
  Camera, Palette, Music, Mic, Film, Image, Video, Brush,
  Scissors, Frame, Aperture, Clapperboard, Monitor, Printer, Pen, Eraser,
  Code, Terminal, FileCode, Bug, Rocket, Server, HardDrive, Laptop,
  Smartphone, GitBranch, Binary, Braces, QrCode, Cable, Unplug,
  BarChart3, TrendingUp, PieChart, Target, Trophy, LineChart, Calculator,
  Coins, Wallet, CreditCard, Receipt, Banknote, BadgeDollarSign, ChartPie, Scale, Percent,
  Clock, Timer, Hourglass, CalendarCheck, AlarmClock, CalendarDays,
  CalendarPlus, History, Watch, TimerReset, CalendarClock, CalendarRange, CalendarMinus, Pause,
  MapPin, Compass, Navigation, Map, Flag, Globe2, Earth, Locate,
  MapPinned, Signpost, Milestone, LocateFixed, Building2, Building, Warehouse, Home,
  Package, Box, Archive, FolderOpen, Clipboard, FileStack, FolderCheck,
  ClipboardList, ClipboardCheck, Inbox, Layers, LayoutGrid, ListChecks, Kanban, Table, Grid3x3,
  UtensilsCrossed, Coffee, Wine, CookingPot, Soup, Wheat, Salad, IceCreamCone,
  Cherry, Grape, Banana, Citrus, Egg, Ham, Sandwich, Pizza,
  Tractor, Shovel, Pickaxe, Drill, BrickWall, Fence, TrafficCone,
  PaintBucket, PaintRoller, Axe, TowerControl, LandPlot, Blocks,
  Combine, PencilRuler, Landmark, Cone, CableCar, Anvil, Logs,
  Dumbbell, Volleyball, Tent, Gamepad2, Puzzle, Swords, Footprints,
  Bed, Lamp, Sofa, Bath, Shirt, Glasses, Umbrella, ShoppingCart,
  ShoppingBag, Tag, Tags, Ticket, HandCoins, Briefcase, Luggage, DoorOpen,
};

// French search keywords, kept as is (data): the search also
// covers the English name of the Lucide icon and the category name in
// the interface language. One line per icon:
// "LucideName: keyword, keyword, …".
// i18n-ignore FR search keywords (data kept as is, see above)
const ICON_KEYWORDS_FR = `
Award: récompense, prix, médaille, habilitation, certificat
Shield: bouclier, protection, défense, sécurité
Star: étoile, favori, note
Heart: coeur, amour, santé, vie
Zap: éclair, énergie, électricité, rapide
Flame: flamme, feu, chaud, urgence
Crown: couronne, roi, reine, leader
Gem: gemme, bijou, diamant, précieux
Sparkles: étincelles, magie, nouveau, brillant
Medal: médaille, récompense, champion
ThumbsUp: pouce, approuver, ok, bien
BadgeCheck: badge, vérifié, certifié, validé
CircleCheck: validé, coché, terminé, fait
Bookmark: marque-page, favori, signet
Gift: cadeau, surprise, bonus
Diamond: diamant, luxe, précieux, valeur
Infinity: infini, illimité, permanent, boucle
Hash: hashtag, numéro, dièse, référence
Wrench: clé, outil, réparation, mécanique
Hammer: marteau, construction, bricolage
HardHat: casque, chantier, sécurité, BTP
Cog: engrenage, paramètre, mécanique, réglage
CircuitBoard: circuit, électronique, carte
Cpu: processeur, informatique, calcul
Database: base de données, stockage, serveur
Factory: usine, industrie, production, fabrication
Bolt: boulon, vis, fixation, éclair
Gauge: jauge, mesure, indicateur, compteur
Power: puissance, énergie, marche, arrêt
Plug: prise, branchement, électrique, connexion
Settings: paramètres, réglages, configuration
SlidersHorizontal: curseurs, réglages, ajustement, filtres
Construction: construction, chantier, travaux, BTP
Pipette: pipette, chimie, laboratoire, couleur
Ruler: règle, mesure, dimension, taille
Magnet: aimant, magnétique, attraction
Radiation: radiation, nucléaire, danger, radioactif
Atom: atome, science, physique, chimie
FlaskConical: fiole, chimie, laboratoire, expérience
TestTube2: éprouvette, test, laboratoire, analyse
Beaker: bécher, chimie, laboratoire, science
Truck: camion, livraison, transport, logistique
Car: voiture, auto, véhicule, conduite
Plane: avion, vol, aérien, voyage
Ship: bateau, navire, maritime, mer
Train: train, rail, ferroviaire, SNCF
Bike: vélo, cyclisme, bicyclette, deux roues
Bus: bus, autobus, transport en commun
Forklift: chariot, élévateur, manutention, entrepôt
Container: conteneur, container, stockage, cargo
Anchor: ancre, marine, port, bateau
Route: route, chemin, itinéraire, trajet
Fuel: carburant, essence, diesel, énergie
PlaneTakeoff: décollage, départ, avion
PlaneLanding: atterrissage, arrivée, avion
CarFront: voiture face, auto, véhicule
Sailboat: voilier, bateau, navigation, mer
Stethoscope: stéthoscope, médecin, docteur, consultation
Syringe: seringue, injection, vaccin, piqûre
Pill: pilule, médicament, pharmacie, comprimé
Activity: activité, rythme, cardiaque, pouls
HeartPulse: pouls, cardiaque, battement, coeur
Cross: croix, médical, urgence, hôpital
Dna: ADN, génétique, biologie, science
Thermometer: thermomètre, température, fièvre
Microscope: microscope, laboratoire, recherche, science
Scan: scanner, examen, radiologie, imagerie
Accessibility: accessibilité, handicap, inclusion, PMR
Hospital: hôpital, clinique, soins, médical
BriefcaseMedical: trousse, secours, premiers soins, urgence
Baby: bébé, naissance, enfant, maternité
GraduationCap: diplôme, formation, université, études
BookOpen: livre, lecture, manuel, cours
Library: bibliothèque, livres, documentation
Lightbulb: ampoule, idée, innovation, créativité
Brain: cerveau, intelligence, réflexion, cognitif
Notebook: carnet, notes, cahier
PenTool: stylo, écrire, design, plume
FileText: fichier, document, texte, rapport
School: école, enseignement, éducation, classe
Apple: pomme, nutrition, santé, éducation
Languages: langues, traduction, multilingue, international
Presentation: présentation, diapositive, exposé, réunion
BookMarked: livre marqué, favori, référence
ScrollText: parchemin, document, texte, historique
Pencil: crayon, écrire, modifier, dessiner
Users: utilisateurs, groupe, équipe, personnes
UserCheck: utilisateur vérifié, validé, approuvé
UserCog: utilisateur paramètres, admin, configuration
HandHelping: aide, assistance, entraide, soutien
Handshake: poignée de main, accord, partenariat, contrat
UserPlus: ajouter utilisateur, inscription, nouveau
UserMinus: supprimer utilisateur, retirer, exclure
Contact: contact, carnet, annuaire, répertoire
BadgeInfo: badge info, information, identité
IdCard: carte identité, badge, accréditation, pass
HeartHandshake: solidarité, bénévolat, humanitaire
PersonStanding: personne, debout, individu
UserRound: utilisateur, profil, avatar, personne
CircleUser: utilisateur cercle, profil, compte
ShieldCheck: bouclier vérifié, sécurisé, protégé, conforme
ShieldAlert: bouclier alerte, danger, avertissement
Lock: cadenas, verrouillé, sécurisé, fermé
Key: clé, accès, déverrouiller, mot de passe
Eye: oeil, voir, surveiller, observer
Fingerprint: empreinte, biométrie, identité, sécurité
ScanFace: reconnaissance faciale, visage, biométrie
ShieldHalf: bouclier, demi, protection partielle
KeyRound: clé ronde, accès, sécurité
LockKeyhole: serrure, cadenas, sécurité
EyeOff: invisible, masqué, caché, privé
AlertTriangle: alerte, danger, attention, avertissement
ShieldOff: bouclier désactivé, non protégé, vulnérable
Siren: sirène, alarme, urgence, police
Megaphone: mégaphone, annonce, communication, alerte
Radio: radio, fréquence, émission, diffusion
Wifi: wifi, réseau, sans fil, internet
Globe: globe, monde, international, planète
Satellite: satellite, espace, transmission, GPS
Phone: téléphone, appel, mobile
Mail: email, courrier, message, lettre
MessageSquare: message, chat, conversation, discussion
Send: envoyer, expédier, transmettre
Rss: flux, RSS, actualités, abonnement
Signal: signal, réseau, connexion, ondes
BellRing: cloche, notification, alerte, sonnerie
AtSign: arobase, email, adresse, contact
Share2: partager, diffuser, réseau
PhoneCall: appel, téléphone, conversation
MailOpen: courrier ouvert, email lu, message
Leaf: feuille, nature, écologie, vert
TreePine: sapin, arbre, forêt, nature
Droplets: gouttes, eau, pluie, liquide
Sun: soleil, jour, lumière, chaleur
Flower2: fleur, jardin, nature, botanique
Cloud: nuage, ciel, météo, cloud
Wind: vent, air, souffle, éolien
Waves: vagues, mer, océan, eau
Mountain: montagne, sommet, altitude, randonnée
Snowflake: flocon, neige, froid, hiver
Sprout: pousse, germination, croissance, bio
Recycle: recycler, recyclage, environnement, écologie
Trees: arbres, forêt, bois, nature
CloudRain: pluie, nuage, météo, intempérie
Sunrise: lever de soleil, aube, matin, début
MoonStar: lune, nuit, étoile, nocturne
Camera: caméra, photo, appareil, image
Palette: palette, couleur, peinture, art
Music: musique, note, mélodie, son
Mic: micro, microphone, audio, voix
Film: film, cinéma, vidéo, pellicule
Image: image, photo, illustration, visuel
Video: vidéo, film, caméra, streaming
Brush: pinceau, peinture, art, dessin
Scissors: ciseaux, couper, découper
Frame: frame, cadre, design, maquette, UI
Aperture: ouverture, objectif, photo, diaphragme
Clapperboard: clap, cinéma, tournage, film
Monitor: écran, moniteur, affichage, bureau
Printer: imprimante, impression, papier, bureau
Pen: stylo, écrire, signature
Eraser: gomme, effacer, supprimer, corriger
Code: code, programmation, développement, logiciel
Terminal: terminal, console, commande, CLI
FileCode: fichier code, script, programme
Bug: bug, erreur, défaut, insecte
Rocket: fusée, lancement, démarrage, rapide
Server: serveur, hébergement, datacenter
HardDrive: disque dur, stockage, mémoire
Laptop: ordinateur, portable, PC, laptop
Smartphone: smartphone, téléphone, mobile, app
GitBranch: git, branche, versioning, code
Binary: binaire, données, informatique, bits
Braces: accolades, code, programmation, JSON
QrCode: QR code, code barre, scan, lien
Cable: câble, fil, connexion, branchement
Unplug: débrancher, déconnecter, hors ligne
BarChart3: graphique, barres, statistiques, données
TrendingUp: tendance, hausse, croissance, progression
PieChart: camembert, graphique, répartition, pourcentage
Target: cible, objectif, but, visée
Trophy: trophée, victoire, récompense, premier
LineChart: graphique ligne, courbe, évolution, tendance
Calculator: calculatrice, calcul, mathématiques, comptabilité
Coins: pièces, monnaie, argent, finance
Wallet: portefeuille, argent, paiement
CreditCard: carte bancaire, paiement, CB, crédit
Receipt: reçu, facture, ticket, justificatif
Banknote: billet, argent, monnaie, cash
BadgeDollarSign: badge dollar, prix, tarif, coût
ChartPie: diagramme, camembert, répartition
Scale: balance, poids, justice, équilibre
Percent: pourcentage, taux, remise, calcul
Clock: horloge, heure, temps, montre
Timer: minuteur, chrono, compte à rebours
Hourglass: sablier, attente, temps, patience
CalendarCheck: calendrier validé, date confirmée, rendez-vous
AlarmClock: réveil, alarme, heure, rappel
CalendarDays: calendrier, planning, jours, agenda
CalendarPlus: ajouter date, nouveau rendez-vous, planifier
History: historique, passé, journal, log
Watch: montre, heure, temps, horloge
TimerReset: réinitialiser, minuteur, recommencer
CalendarClock: calendrier horloge, planification, horaire
CalendarRange: période, plage, intervalle, durée
CalendarMinus: supprimer date, annuler rendez-vous
Pause: pause, arrêt, attente, stop
MapPin: épingle, localisation, lieu, position
Compass: boussole, direction, orientation, navigation
Navigation: navigation, direction, GPS, guidage
Map: carte, plan, géographie, territoire
Flag: drapeau, signalement, pays, marqueur
Globe2: globe, monde, terre, planète
Earth: terre, planète, monde, global
Locate: localiser, position, GPS, trouver
MapPinned: lieu épinglé, favori, sauvegardé
Signpost: panneau, direction, indication, chemin
Milestone: jalon, étape, objectif, progression
LocateFixed: position fixe, GPS, coordonnées
Building2: immeuble, bureau, entreprise, bâtiment
Building: bâtiment, construction, bureau
Warehouse: entrepôt, stockage, hangar, dépôt
Home: maison, domicile, accueil, foyer
Package: paquet, colis, livraison, emballage
Box: boîte, carton, rangement, stockage
Archive: archive, stockage, historique, rangement
FolderOpen: dossier ouvert, fichiers, documents
Clipboard: presse-papier, notes, formulaire
FileStack: pile fichiers, documents, dossier
FolderCheck: dossier validé, vérifié, approuvé
ClipboardList: liste, tâches, inventaire, checklist
ClipboardCheck: liste validée, terminé, fait
Inbox: boîte de réception, messages, courrier
Layers: couches, niveaux, calques, empilé
LayoutGrid: grille, disposition, tableau, vue
ListChecks: liste coches, tâches, todo, vérification
Kanban: kanban, tableau, agile, projet
Table: tableau, données, grille, colonnes
Grid3x3: grille, matrice, cases, tableau
UtensilsCrossed: couverts, restaurant, cuisine, repas
Coffee: café, boisson, pause, tasse
Wine: vin, boisson, verre, alcool
CookingPot: marmite, cuisine, cuisson, chef
Soup: soupe, bouillon, chaud, repas
Wheat: blé, céréales, agriculture, boulangerie
Salad: salade, légumes, frais, nutrition
IceCreamCone: glace, cornet, dessert, sucré
Cherry: cerise, fruit, rouge
Grape: raisin, fruit, vendange, vin
Banana: banane, fruit, jaune
Citrus: agrume, citron, orange, fruit
Egg: oeuf, petit déjeuner, cuisine
Ham: jambon, viande, charcuterie
Sandwich: sandwich, repas, déjeuner, pain
Pizza: pizza, repas, italien, fromage
Tractor: tracteur, engin, chantier, agricole, BTP
Shovel: pelle, pelleteuse, terrassement, creuser, chantier
Pickaxe: pioche, démolition, creuser, mine, chantier
Drill: perceuse, percer, forage, outil, chantier
BrickWall: mur, brique, maçonnerie, construction, chantier
Fence: clôture, barrière, palissade, chantier, sécurité
TrafficCone: cône, signalisation, chantier, sécurité, route
PaintBucket: peinture, seau, finition, décoration, chantier
PaintRoller: rouleau, peinture, mur, finition, chantier
Axe: hache, bûcheron, coupe, bois, outil
TowerControl: tour, grue, contrôle, hauteur, chantier
LandPlot: terrain, parcelle, plan, cadastre, géomètre
Blocks: blocs, parpaing, construction, empilage, maçonnerie
Combine: engin, moissonneuse, machine, agricole
PencilRuler: plan, dessin, technique, architecte, mesure
Landmark: monument, repère, bâtiment, patrimoine
Cone: cône, géométrie, signalisation, chantier
CableCar: téléphérique, nacelle, câble, levage, hauteur
Anvil: enclume, forge, métal, ferronnerie, acier
Logs: bûches, bois, charpente, scierie, matériau
Dumbbell: haltère, musculation, sport, fitness
Volleyball: volleyball, sport, ballon, équipe
Tent: tente, camping, plein air, aventure
Gamepad2: manette, jeu, gaming, loisir
Puzzle: puzzle, réflexion, jeu, stratégie
Swords: épées, combat, compétition, défense
Footprints: empreintes, pas, marche, randonnée
Bed: lit, dormir, chambre, repos
Lamp: lampe, lumière, éclairage, bureau
Sofa: canapé, salon, confort, détente
Bath: bain, salle de bain, hygiène, douche
Shirt: chemise, vêtement, tenue, uniforme
Glasses: lunettes, vue, optique, soleil
Umbrella: parapluie, pluie, protection
ShoppingCart: panier, courses, achat, commerce
ShoppingBag: sac courses, shopping, achat
Tag: étiquette, prix, label, marque
Tags: étiquettes, catégories, labels
Ticket: ticket, billet, entrée, événement
HandCoins: paiement, main, pièces, donation
Briefcase: mallette, affaires, travail, bureau
Luggage: bagage, valise, voyage, déplacement
DoorOpen: porte ouverte, entrée, accès, sortie
`;

const ICON_KEYWORDS: Record<string, string[]> = Object.fromEntries(
  ICON_KEYWORDS_FR.trim()
    .split("\n")
    .map((line) => {
      const [name, keywords] = line.split(":");
      return [name.trim(), keywords.split(",").map((k) => k.trim()).filter(Boolean)];
    }),
);

/** Categories: stable identifier → icons; label `ui.iconPicker.categories.<id>`. */
type IconCategoryId = keyof Messages["ui"]["iconPicker"]["categories"];

const ICON_CATEGORIES: Record<IconCategoryId, string[]> = {
  general: ["Award", "Shield", "Star", "Heart", "Zap", "Flame", "Crown", "Gem", "Sparkles", "Medal", "ThumbsUp", "BadgeCheck", "CircleCheck", "Bookmark", "Gift", "Diamond", "Infinity", "Hash"],
  technical: ["Wrench", "Hammer", "HardHat", "Cog", "CircuitBoard", "Cpu", "Database", "Factory", "Bolt", "Gauge", "Power", "Plug", "Settings", "SlidersHorizontal", "Construction", "Pipette", "Ruler", "Magnet", "Radiation", "Atom", "FlaskConical", "TestTube2", "Beaker"],
  transport: ["Truck", "Car", "Plane", "Ship", "Train", "Bike", "Bus", "Forklift", "Container", "Anchor", "Route", "Fuel", "PlaneTakeoff", "PlaneLanding", "CarFront", "Sailboat"],
  health: ["Stethoscope", "Syringe", "Pill", "Activity", "HeartPulse", "Cross", "Dna", "Thermometer", "Microscope", "Scan", "Accessibility", "Hospital", "BriefcaseMedical", "Baby"],
  training: ["GraduationCap", "BookOpen", "Library", "Lightbulb", "Brain", "Notebook", "PenTool", "FileText", "School", "Apple", "Languages", "Presentation", "BookMarked", "ScrollText", "Pencil"],
  team: ["Users", "UserCheck", "UserCog", "HandHelping", "Handshake", "UserPlus", "UserMinus", "Contact", "BadgeInfo", "IdCard", "HeartHandshake", "PersonStanding", "UserRound", "CircleUser"],
  security: ["ShieldCheck", "ShieldAlert", "Lock", "Key", "Eye", "Fingerprint", "ScanFace", "ShieldHalf", "KeyRound", "LockKeyhole", "EyeOff", "AlertTriangle", "ShieldOff", "Siren"],
  communication: ["Megaphone", "Radio", "Wifi", "Globe", "Satellite", "Phone", "Mail", "MessageSquare", "Send", "Rss", "Signal", "BellRing", "AtSign", "Share2", "PhoneCall", "MailOpen"],
  environment: ["Leaf", "TreePine", "Droplets", "Sun", "Flower2", "Cloud", "Wind", "Waves", "Mountain", "Snowflake", "Sprout", "Recycle", "Trees", "CloudRain", "Sunrise", "MoonStar"],
  creative: ["Camera", "Palette", "Music", "Mic", "Film", "Image", "Video", "Brush", "Scissors", "Frame", "Aperture", "Clapperboard", "Monitor", "Printer", "Pen", "Eraser"],
  development: ["Code", "Terminal", "FileCode", "Bug", "Rocket", "Server", "HardDrive", "Laptop", "Smartphone", "GitBranch", "Binary", "Braces", "QrCode", "Cable", "Unplug"],
  finance: ["BarChart3", "TrendingUp", "PieChart", "Target", "Trophy", "LineChart", "Calculator", "Coins", "Wallet", "CreditCard", "Receipt", "Banknote", "BadgeDollarSign", "ChartPie", "Scale", "Percent"],
  time: ["Clock", "Timer", "Hourglass", "CalendarCheck", "AlarmClock", "CalendarDays", "CalendarPlus", "History", "Watch", "TimerReset", "CalendarClock", "CalendarRange", "CalendarMinus", "Pause"],
  location: ["MapPin", "Compass", "Navigation", "Map", "Flag", "Globe2", "Earth", "Locate", "MapPinned", "Signpost", "Milestone", "LocateFixed", "Building2", "Building", "Warehouse", "Home"],
  organisation: ["Package", "Box", "Archive", "FolderOpen", "Clipboard", "FileStack", "FolderCheck", "ClipboardList", "ClipboardCheck", "Inbox", "Layers", "LayoutGrid", "ListChecks", "Kanban", "Table", "Grid3x3"],
  food: ["UtensilsCrossed", "Coffee", "Wine", "CookingPot", "Soup", "Wheat", "Salad", "IceCreamCone", "Cherry", "Grape", "Banana", "Citrus", "Egg", "Ham", "Sandwich", "Pizza"],
  construction: ["Tractor", "Shovel", "Pickaxe", "Drill", "BrickWall", "Fence", "TrafficCone", "PaintBucket", "PaintRoller", "Axe", "TowerControl", "LandPlot", "Blocks", "Combine", "PencilRuler", "Landmark", "Cone", "CableCar", "Anvil", "Logs"],
  sport: ["Dumbbell", "Volleyball", "Tent", "Gamepad2", "Puzzle", "Swords", "Footprints"],
  daily: ["Bed", "Lamp", "Sofa", "Bath", "Shirt", "Glasses", "Umbrella", "ShoppingCart", "ShoppingBag", "Tag", "Tags", "Ticket", "HandCoins", "Briefcase", "Luggage", "DoorOpen"],
};

export function QualificationIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICON_MAP[name];
  if (!Icon) return <Star className={className} />;
  return <Icon className={className} />;
}

interface IconPickerProps {
  value: string;
  onChange: (iconName: string) => void;
  /** Forwarded to the Button trigger for binding with a `<Label htmlFor>`. */
  id?: string;
}

export function IconPicker({ value, onChange, id }: IconPickerProps) {
  const t = useTranslations("ui.iconPicker");
  const tCommon = useTranslations("common.states");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // i18n-dynamic: ui.iconPicker.categories.*
  const categoryLabel = (cat: IconCategoryId) => t(`categories.${cat}`);
  // Tooltip: first French keyword in French, readable English name otherwise.
  const iconTitle = (name: string) => (locale === "fr" ? ICON_KEYWORDS[name]?.[0] : undefined) ?? humanizeIconName(name);

  // Search: English Lucide name ("hardhat" or "hard hat"), French
  // keywords, category name in the current language.
  const filteredCategories = (() => {
    const entries = Object.entries(ICON_CATEGORIES) as [IconCategoryId, string[]][];
    if (!search) return entries;
    const normalize = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const term = normalize(search);
    const result: [IconCategoryId, string[]][] = [];
    for (const [cat, icons] of entries) {
      const catMatches = normalize(categoryLabel(cat)).includes(term);
      const filtered = icons.filter((name) => {
        if (catMatches) return true;
        if (normalize(name).includes(term) || normalize(humanizeIconName(name)).includes(term)) return true;
        const keywords = ICON_KEYWORDS[name];
        return keywords?.some((kw) => normalize(kw).includes(term)) ?? false;
      });
      if (filtered.length > 0) result.push([cat, filtered]);
    }
    return result;
  })();

  // Prevent wheel events from leaking to the dialog behind the popover portal
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop === 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (!atTop && !atBottom) {
      e.stopPropagation();
    }
  }, []);

  const SelectedIcon = ICON_MAP[value] || Star;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" className="w-10 h-9 p-0">
          <SelectedIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[340px] p-0"
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={16}
        onWheel={handleWheel}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="p-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              name="icon-search"
              autoComplete="off"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
              autoFocus
            />
          </div>
        </div>
        <div
          className="px-3 pb-3 overflow-y-auto overscroll-contain space-y-2.5 scrollbar-thin"
          style={{ maxHeight: "300px" }}
          onWheel={handleWheel}
        >
          {filteredCategories.map(([category, icons]) => (
            <div key={category}>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{categoryLabel(category)}</p>
              <div className="grid grid-cols-8 gap-0.5">
                {icons.map((iconName) => {
                  const Icon = ICON_MAP[iconName];
                  if (!Icon) return null;
                  const isSelected = value === iconName;
                  return (
                    <button
                      key={iconName}
                      type="button"
                      onClick={() => {
                        onChange(iconName);
                        setOpen(false);
                        setSearch("");
                      }}
                      className={cn(
                        "flex items-center justify-center rounded-md p-2 transition-colors hover:bg-accent",
                        isSelected && "bg-primary text-primary-foreground hover:bg-primary/90"
                      )}
                      title={iconTitle(iconName)}
                      aria-label={iconTitle(iconName)}
                    >
                      <Icon className="size-4" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {filteredCategories.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">{tCommon("noResults")}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
