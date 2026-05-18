# Shelly Dimmer Solar Router - Régulation Progressive

**Routeur solaire avancé pour ballon ECS (200L) avec Shelly Dimmer Gen3**

Régulation fine du dimmer (0-10V) pour minimiser le soutirage réseau (cible 0-30W) tout en maximisant l’autoconsommation solaire.
Sur la base d'un Shelly Dimmer + ADD-ON et un compteur Shelly EM monophasé et quelques accessoires

---

## Fonctionnalités

- **Régulation progressive intelligente** par paliers adaptatifs
- **Deux phases** : Jour (25-100%) / Nuit (0-100% avec détection surplus)
- **Forçage nuit** si température trop basse (33°C → 65%)
- **Baseline automatique** pour détecter le surplus solaire la nuit
- **Calibration auto** de la puissance nominale au démarrage
- **Protection surchauffe** (52°C) avec hystérésis
- **Compteur d’équivalent 100%** (suivi réel de production)
- **Dashboard ASCII** toutes les 15 min
- **Endpoint HTTP** `/setDom` pour pilotage externe
- **Watchdog** + reboot automatique
- Mode dégradé si sonde HS

## Matériel compatible

- **Shelly Dimmer 0-10V Gen3**
- ADD-ON + Sonde DS18B20 à placer au milieu du ballon, collée à la paroie interne
- Shelly EM Gen3 (ou tout compteur accessible en HTTP)
- Relais statique SSR 0-10V 10A

## Installation

1. Copier le contenu de `shelly-dimmer-solar-router.js` dans **Shelly → Scripting**
2. Adapter les paramètres dans la section `CONFIG` du script, tout est expliqué
3. Sauvegarder et redémarrer le script

## Configuration

```js
// Exemple des paramètres les plus importants
targetMin: 0,             // Puissance minimale soutirée (W)
targetMax: 30,            // Puissance maximale soutirée (W)
tempNightOn: 33,          // Température mini nuit
tempNightOff: 34,         // arrêt chauffage une fois la température atteinte la nuit
tempOverheat: 52,         // seuil protection haute température
tempResume: 49,           // température de reprise après surchauffe
brightnessForced: 65,     // niveau forçage nuit en % du Dimmer
nightStart: 18,           // heure du début de la phase Nuit
nightEnd: 7,              // heure de fin de la phase Nuit
dayStart: 7,              // heure du début de la phase Jour
dayEnd: 18                // heure de fin de la phase Jour
surplusStopHour: 22,      // heure après laquelle on arrête de chercher du surplus
