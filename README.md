# Shelly Dimmer Solar Router - Régulation Progressive par PLAGES/PALIERS

**Routeur solaire avancé pour ballon ECS (200L) avec Shelly Dimmer Gen3**

Régulation fine du dimmer (0-10V) pour minimiser le soutirage réseau (cible 0-30W) tout en maximisant l’autoconsommation solaire.
Sur la base d'un Shelly Dimmer + Shelly Plus AddOn (1 x DS) et un compteur Shelly EM monophasé et quelques accessoires éventuels non-indispensables (compteur digital, contacteur M.F. manuel, disjoncteur local, etc)

---
## Principe

Réaliser un routeur solaire avec des moyens modestes (full Shelly)
mais qui demeure intelligent ! Sans PID compliqué et oscillant, mais par PLAGES à 6 pentes progressives

Principe de fonctionnement :

En journée, le système régule la production d’eau chaude en priorisant le surplus solaire. Le soleil se levant en moyenne vers 7 h, on active une phase « Jour » à cette heure.
On rentre à son domicile généralement vers 18 h, avec pour objectif d’avoir de l’eau chaude disponible à 19 h. Une consigne de température minimale est donc activée à 18 h pour garantir cette température à 19 h (1 heure de battement), principalement en plein hiver où le surplus est rare.
Cependant, si la température est juste au-dessus de cette consigne et que l’on puise de l’eau plus tard (ex. vers 23 h), il faut que l’eau reste chaude. La consigne minimale est donc maintenue jusqu’à la reprise de la phase « Jour » à 7 h. On définit ainsi une phase « Nuit » de 18 h à 7 h.
Adaptation à la saison :
En été, il fait encore jour à 18 h. On prolonge donc la régulation solaire au-delà de 18 h, mais avec un arrêt définitif à 22 h (heure à laquelle on est certain qu’il n’y a plus de production photovoltaïque significative).
Après 18 h, les charges domestiques (présence au domicile) sont plus fréquentes et peuvent perturber la régulation. On implémente donc une baseline de surplus : la régulation ne se déclenche que s’il y a au moins 50 W de surplus (valeur réglable). En cas d’échec, une temporisation de 2 minutes est appliquée avant de retenter la régulation.
Une consigne de température max (haute température), juste avant celle du thermostat mécanique, stoppe la régulation afin de ne pas perturber les statistiques du tableau de bord du Shelly Cloud

Nota :    La conception s'est effectuée pour un ballon 200L avec résistance stéatite d'env 2000W. Totalement adaptable pour d'autres ballons à thermostat mécanique et capacités différentes. 
          Le Dimmer régule de 25% à 100%, car on a remarqué qu'à 25% la résistance du ballon consomme 4W env. Rien avant. Ce seuil est modifiable.
          Les consignes de température s'entendent mesures prises au milieu du ballon et ne reflètent pas la température exacte au sommet, qui est facilement supérieure de 25°C. 
          Le compteur d'équivalence 100% est à titre indicatif et peut varier d'un facteur de 10% par rapport à la réalité. Il demeure cependant pratique à l'usage pour observer la quantité chauffée et anticiper un manque en fin de journée (nuages, mauvais temps).
          Le premier démarrage commence toutjours par un 100% pendant 12s, nécéssaire pour le calibrage de la puissance réelle et l'intégration de l'équivalence 100% au calcul.
          Gardez toujours une plage de régulation, car un pas de 1% peut entrainer une variation de puissance de 40 à 50W en fonction du comportement de la résistance, la tension et la chaleur de l'eau. Le code a été élaboré par defaut pour une régulation entre 0W et 30W. Ces seuils sont bien sur modifiables.

Les Shelly doivent etre à porté Wifi et dans le meme réseau local

---
## Fonctionnalités

- **Régulation progressive intelligente** par paliers adaptatifs (6 pentes différentes)
- **Deux phases** : Jour (25-100%) / Nuit (0-100% avec détection surplus)
- **Forçage nuit** si température trop basse (33°C → 65%)
- **Baseline automatique** pour détecter le surplus solaire en phase Nuit
- **Calibration auto** de la puissance nominale au démarrage
- **Protection surchauffe** (52°C) avec hystérésis
- **Compteur d’équivalent 100%** (suivi réel de production)
- **Dashboard ASCII** toutes les 15 min
- **Endpoint HTTP** `/setDom` pour pilotage externe
- **Watchdog** + reboot automatique
- Mode dégradé si sonde HS

## Matériel compatible

- **Shelly Dimmer 0-10V Gen3**
- Shelly Plus ADD-ON + Sonde DS18B20 à placer au milieu du ballon, collée à la paroi interne
- Shelly EM Gen3 (ou tout compteur accessible en HTTP)
- Relais statique SSR 0-10V 10A

## Installation

1. Copier le contenu de `Régul_PLAGES_finale.js` dans **Shelly → Scripting**
2. Adapter les paramètres dans la section `CONFIG` du script, tout est expliqué dans le code
3. Sauvegarder et redémarrer le script

## Configuration

```js
// Exemple des paramètres les plus importants
emIP: "192.168.1.233",    // modifiez l'adresse pour inscrire celle de votre compteur (Shelly EM)
targetMin: 0,             // Puissance minimale soutirée (W)
targetMax: 30,            // Puissance maximale soutirée (W)
tempNightOn: 33,          // Température mini nuit
tempNightOff: 34,         // arrêt chauffage une fois la température atteinte la nuit
tempOverheat: 52,         // seuil protection haute température
tempResume: 49,           // température de reprise après surchauffe
brightnessForced: 65,     // niveau forçage nuit en % du Dimmer (env 1000W)
nightStart: 18,           // heure du début de la phase Nuit
nightEnd: 7,              // heure de fin de la phase Nuit
dayStart: 7,              // heure du début de la phase Jour
dayEnd: 18                // heure de fin de la phase Jour
surplusStopHour: 22,      // heure après laquelle on arrête de chercher du surplus
