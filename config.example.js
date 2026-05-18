// =============================================
// CONFIGURATION EXAMPLE - Shelly Dimmer Solar Router
// Copie ce fichier en config.js et adapte les valeurs
// =============================================

let CONFIG = {
  // === Régulation ===
  checkInterval: 4000,
  targetMin: 0,
  targetMax: 30,
  brightnessFloor: 25,

  // === Températures ===
  tempNightOn: 33,
  tempNightOff: 34,
  tempOverheat: 52,
  tempResume: 49,
  brightnessForced: 65,

  // === Horaires ===
  schedule: {
    nightStart: 18,
    nightEnd: 7,
    surplusStopHour: 22
  },

  // === Réseau ===
  emIP: "192.168.1.233",        // ← À CHANGER OBLIGATOIREMENT

  // Autres paramètres...
};

print("Configuration example chargée - Pense à adapter emIP et tes seuils !");
