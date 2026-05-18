# Shelly Dimmer Solar Router - Régulation Progressive

**Routeur solaire avancé pour ballon ECS (200L) avec Shelly Dimmer Gen3**

Régulation très fine du dimmer (0-10V) pour minimiser le soutirage réseau (cible 0-30W) tout en maximisant l’autoconsommation solaire.

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
- Sonde DS18B20 + Add-on
- Shelly EM Gen3 (ou tout compteur accessible en HTTP)
- Relais statique SSR 0-10V

## Installation

1. Copier le contenu de `script.js` dans **Shelly → Scripting**
2. Adapter les paramètres dans la section `CONFIG`
3. Sauvegarder et redémarrer le script

## Configuration

```js
// Exemple des paramètres les plus importants
targetMin: 0,      // Puissance minimale soutirée (W)
targetMax: 30,     // Puissance maximale soutirée (W)
brightnessFloor: 25, // Plancher de régulation le jour
tempNightOn: 33,   // Température mini nuit
