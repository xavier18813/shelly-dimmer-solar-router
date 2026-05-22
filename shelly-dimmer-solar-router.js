// ============================================= V finale ====================
// MATERIELS :
// Dimmer 0/1-10V Gen3 firmware 20250924-062659/1.7.1-gd336f31
// Module complémentaire capteur ADD-ON + sonde DS18B20 connecté au Dimmer
// La sonde est collée sur la paroie inox interne du ballon, à mi-hauteur
// Shelly EM Gen3 firmware 20250429-124852/1.6.99-emg3prod2-g70204e5 pince voie 0
// Relais statique SSR LCDS-25VD 0-10V 10A - 0-205V monophasé
// Ballon ECS 200L résistance stéatite d'env 2000W
// Thermostat mécanique coupure 54°C
//
// Script : routeur solaire via Régulation PROGRESSIVE par PLAGES
// compteur EM voie 0 interrogé toutes les 4s (soutirage) sur 192.168.1.233
// zone régulée entre 0w et 30w soutirés
//
// PRINCIPE :
// La régulation vise à cibler un intervalle de puissance soutirée, par variation automatique du Dimmer,
// en fonction du surplus solaire et avec surveillance de température de l'eau chaude.
// Phase Jour, potentiellement ensoleillée, on reste en régulation de 25 à 100% du Dimmer
// Phase Nuit, on doit avoir atteint une temp mini. Si oui, la régulation se poursuit de 0 à 100%, 
// une baseline vérifie alors la présence d'un surplus et ce, jusqu'à un horaire max (0% + relais coupé)
// Si non, on marche forcée à n% jusqu'au seuil temp mini+1°C jusqu'à la prochaine phase Jour
// La phase jour commence par un reset complet des timer
// La console fournit des infos récap précises à intervalles réguliers
//
// FONCTIONNALITÉS :
// - Régulation progressive par paliers de gain (plages optimisées)
// - Deux phases : 1 nuit et 1 jour, horaires modifiables
// - Forçage nuit si température trop basse (33°C → 65% jusqu'à 34°C jusqu'à 7H)
// - Détection surplus par baseline de X cycles (phase nuit uniquement)
// - Protection surchauffe (52°C), puis reprise si baisse (49°C) (anti-spam logs)
// - Mode dégradé si sonde HS
// - Compteur équivalent 100% par jour (mesure réelle + calibration auto au démarrage), reset à minuit
// - Affichage récap minute (1) : équiv. 100% | Dimmer% | Puissance W | Température
// - Anti-spam RPC + anti-oscillation
// - Watchdog avec reboot automatique
// - Tableau de bord toutes les X (15) minutes en ASCII
// - Endpoint HTTP /setDom pour ajustement dynamique
//
// V6.7 : calibration auto puissance nominale dans mainLoop (12s stabilisation)
//
// NOTES DE MAINTENANCE :
// - Calibration puissance nominale : effectuée UNE SEULE FOIS au démarrage du script
//   Pour recalibrer (ex: après remplacement résistance) : redémarrer le script
//   La valeur mesurée dépend de la tension réseau au moment du démarrage (~±5%)
// =======================================================================

// =======================================================================
// SECTION 1 : CONFIGURATION
// =======================================================================
let CONFIG = {
  // Régulation
  checkInterval: 4000,      // intervalle d'interrogation du EM (en ms)
  targetMin: 0,             // cible basse de la puissance régulée en W
  targetMax: 30,            // cible haute de la puissance régulée en W
  brightnessFloor: 25,      // démarrage plancher de la régulation en %

  // Températures
  tempNightOn: 33,          // température mini à maintenir en phase nuit
  tempNightOff: 34,         // arrêt chauffage une fois la température atteinte la nuit
  tempOverheat: 52,         // seuil protection haute température
  tempResume: 49,           // température de reprise après surchauffe
  brightnessForced: 65,     // niveau forçage nuit en % 

  // Baseline (détection surplus)
  baselineCycles: 4,        // nombre de cycles mesure baseline
  baselineThreshold: -50,   // seuil surplus détecté (W)
  surplusRetryMin: 2,       // minutes entre deux tentatives baseline avant 22h
  surplusStopHour: 22,      // heure après laquelle on arrête de chercher du surplus

  // Horaires
  schedule: {
    nightStart: 18,         // heure du début de la phase Nuit
    nightEnd: 7,            // heure de fin de la phase Nuit
    dayStart: 7,            // heure du début de la phase Jour
    dayEnd: 18              // heure de fin de la phase Jour
  },

  // Watchdog
  watchdogInterval: 300000,  // 5 minutes
  watchdogMaxInactive: 240,  // secondes

  // Dashboard
  dashboardInterval: 900000, // 15 minutes, Tableau de bord

  // Compteur équivalent
  heaterLogInterval: 60000,  // 1 minute, récap

  // Surchauffe
  overheatLogInterval: 300000, // 5 minutes (rappel silencieux)

  // Anti-double-appel
  regulateCooldown: 3000,    // 3 secondes minimum entre deux appels

  // Calibration
  calibrationDelay: 8000,    // 8s d'attente pour stabilisation à 100%
  nominalPowerDefault: 2000, // puissance par défaut si calibration échoue (W)

  // Réseau
  emIP: "192.168.1.233",     // adresse IP du Shelly EM (compteur soutirage)
  httpTimeout: 3000,
  httpMaxRetries: 3
};

// =======================================================================
// SECTION 2 : ÉTAT GLOBAL
// =======================================================================
let state = {
  brightness: 25,
  lastSentBrightness: -1,
  nightState: "regulating",    // "regulating" | "measuring" | "stopped"
  forcedMode: false,
  overheatMode: false,
  overheatLogged: false,       // Anti-spam surchauffe
  lastOverheatLog: 0,          // Timestamp dernier log surchauffe
  nightShutdown: false,
  stoppedLogged: false,
  tempFailCount: 0,
  pGrid: 0,
  lastLoopTime: 0,
  httpRetries: 0,
  lastRegulateCall: 0,         // Timestamp dernier appel regulateSolar (anti-double appel)
  currentTemp: null,           // Dernière température connue (pour log compteur)
  dimmerPower: 0,              // Puissance réelle mesurée par le Shelly Dimmer
  nominalPower: null,          // Puissance nominale mesurée par calibration (W)
  calibrating: true,           // Flag mode calibration (bloque mainLoop)
  nightTransitionDone: false
};

let currentHour = 0;
let currentMinute = 0;
let baselineReadings = [];

// Compteur équivalent 100% (basé sur mesure réelle + calibration auto)
let equivalentHeater = {
  totalWattHours: 0,
  lastUpdate: 0,
  lastLog: 0,
  lastPower: 0,               // Mémorise la puissance précédente (W)

  update: function(powerW) {
    let now = Date.now();
    if (this.lastUpdate === 0) {
      this.lastUpdate = now;
      this.lastPower = powerW;
      return;
    }
    let elapsedHours = (now - this.lastUpdate) / 3600000;
    let avgPower = (this.lastPower + powerW) / 2;
    this.totalWattHours += avgPower * elapsedHours;
    this.lastUpdate = now;
    this.lastPower = powerW;
  },

  getFormatted: function() {
    if (state.nominalPower === null || state.nominalPower === 0) return "0h00";
    let equivHours = this.totalWattHours / state.nominalPower;
    let h = Math.floor(equivHours);
    let m = Math.round((equivHours - h) * 60);
    if (m === 60) { h++; m = 0; }
    return h + "h" + (m < 10 ? "0" : "") + m;
  },

  log: function(powerW, temp, brightness) {
    let now = Date.now();
    if (now - this.lastLog >= CONFIG.heaterLogInterval) {
      let tempStr = (temp !== null) ? temp.toFixed(1) + "C" : "N/A";
      print("⏱️  Équiv. 100% : " + this.getFormatted() + " | Dimmer: " + brightness + "% | " + Math.round(powerW) + "W | Temp: " + tempStr + " | " + timeStr());
      this.lastLog = now;
    }
  },

  reset: function() {
    let previous = 0;
    if (state.nominalPower !== null && state.nominalPower > 0) {
      previous = this.totalWattHours / state.nominalPower;
    }
    this.totalWattHours = 0;
    this.lastUpdate = Date.now();
    this.lastPower = state.dimmerPower;
    return previous;
  }
};

// =======================================================================
// SECTION 3 : HELPERS TEMPS
// =======================================================================
function updateTime() {
  let now = new Date();
  currentHour = now.getHours();
  currentMinute = now.getMinutes();
}

function timeStr() {
  return currentHour + "h" + (currentMinute < 10 ? "0" : "") + currentMinute;
}

// =======================================================================
// SECTION 4 : HELPERS PÉRIODE
// =======================================================================
function isNightTime(h) {
  if (h === undefined) h = currentHour;
  return (h >= CONFIG.schedule.nightStart || h < CONFIG.schedule.nightEnd);
}

function isDayTime(h) {
  return !isNightTime(h);
}

function getPeriod(h) {
  if (h === undefined) h = currentHour;
  if (isDayTime(h)) return "day";
  if (h >= CONFIG.schedule.nightEnd && h < CONFIG.surplusStopHour) return "night_active";
  return "night_off";
}

// =======================================================================
// SECTION 5 : HELPERS AFFICHAGE
// =======================================================================
function formatTemp(temp) {
  if (temp === null) return "N/A";
  return temp.toFixed(1) + "C";
}

// =======================================================================
// SECTION 6 : CAPTEURS
// =======================================================================
function getTemperature() {
  let s = Shelly.getComponentStatus("temperature:100");
  return (s && typeof s.tC === "number") ? s.tC : null;
}

function getDimmerPower() {
  let s = Shelly.getComponentStatus("light:0");
  
  // Shelly Dimmer Gen3 utilise "apower" (active power), pas "power"
  if (s && typeof s.apower === "number") {
    state.dimmerPower = s.apower;
    return s.apower;
  }
  
  // Fallback pour autres modèles
  if (s && typeof s.power === "number") {
    state.dimmerPower = s.power;
    return s.power;
  }
  
  // Chercher dans switch:0
  let sw = Shelly.getComponentStatus("switch:0");
  if (sw && typeof sw.apower === "number") {
    state.dimmerPower = sw.apower;
    return sw.apower;
  }
  
  return 0;
}

function getPower(callback) {
  Shelly.call("http.get", {
    url: "http://" + CONFIG.emIP + "/rpc/Shelly.GetStatus",
    timeout: CONFIG.httpTimeout
  }, function(res, error_code) {
    if (error_code !== 0 || !res || res.code !== 200) {
      state.httpRetries++;
      if (state.httpRetries <= CONFIG.httpMaxRetries) {
        print("⚠️ HTTP erreur EM (" + state.httpRetries + "/" + CONFIG.httpMaxRetries + ")");
      }
      callback(null);
      return;
    }
    state.httpRetries = 0;
    try {
      let data = JSON.parse(res.body);
      let em = data["em1:0"] || data["em:0"] || data["em1"] || data["em"] || {};
      let power = em.act_power;
      if (power === undefined) power = em.puissance_active;
      if (power === undefined) power = em.power;
      if (power === undefined) power = 0;
      callback(power);
    } catch (e) {
      print("❌ Erreur parsing EM: " + e.message);
      callback(null);
    }
  });
}

// =======================================================================
// SECTION 7 : GESTION DIMMER
// =======================================================================
function setDimmer(val) {
  let b = Math.max(0, Math.min(100, Math.round(val)));

  if (b === state.lastSentBrightness) return;

  let diff = Math.abs(b - state.lastSentBrightness);
  let absError = Math.abs(state.pGrid - CONFIG.targetMin);

  // En régime de croisière (erreur ≤ 55W) : autoriser les pas de 1%
  if (absError <= 55 && diff >= 1) {
    // OK, on laisse passer
  } else if (diff < 2 && b !== 0 && state.lastSentBrightness !== 0 && state.lastSentBrightness >= 0) {
    return; // micro-variation ignorée hors régime fin
  }

  state.lastSentBrightness = b;
  state.brightness = b;

  if (b === 0) {
    Shelly.call("Light.Set", { id: 0, brightness: 0, on: true });
    print("-> 0% (0V)");
  } else {
    Shelly.call("Light.Set", { id: 0, on: true, brightness: b });
    print("-> " + b + "%");
  }
}

// =======================================================================
// SECTION 8 : CALIBRATION AUTO (en plusieurs passes dans mainLoop)
// =======================================================================
let calibrationStep = 0;
let calibrationRetries = 0;

function calibrate() {
  if (calibrationStep === 0) {
    // Étape 0 : lancer le 100%
    print("🔧 Calibration : passage à 100%, attente stabilisation...");
    state.lastSentBrightness = 100;
    state.brightness = 100;
    Shelly.call("Light.Set", { id: 0, on: true, brightness: 100 });
    calibrationStep = 1;
    calibrationRetries = 0;
    return;
  }

  if (calibrationStep === 1) {
    // Étape 1 : attendre que la puissance se stabilise
    calibrationRetries++;
    let p = getDimmerPower();
    
    if (p > 100 && calibrationRetries >= 3) {
      // Puissance stable après 3 cycles (12 secondes)
      state.nominalPower = Math.round(p);
      print("✓ Puissance nominale mesurée : " + state.nominalPower + "W");
      finishCalibration();
    } else if (calibrationRetries >= 15) {
      // Timeout après 15 cycles (60 secondes)
      state.nominalPower = CONFIG.nominalPowerDefault;
      print("⚠️ Calibration échouée (lu: " + Math.round(p) + "W) -> défaut " + state.nominalPower + "W");
      finishCalibration();
    }
    return;
  }
}

function finishCalibration() {
  state.calibrating = false;
  calibrationStep = 0;
  calibrationRetries = 0;
  state.lastSentBrightness = -1;
  setDimmer(CONFIG.brightnessFloor);
  
  equivalentHeater.lastUpdate = Date.now();
  equivalentHeater.lastLog = Date.now();
  equivalentHeater.lastPower = state.dimmerPower;
  
  print("✓ Calibration terminée -> régulation active [" + timeStr() + "]");
  
  if (isNightTime()) {
    state.nightState = "measuring";
    print("🌙 Démarrage nocturne -> baseline initiale [" + timeStr() + "]");
  }
}

// =======================================================================
// SECTION 9 : MODES D'URGENCE
// =======================================================================
function emergencyShutdown() {
  state.overheatMode = true;
  state.overheatLogged = false;
  state.lastOverheatLog = 0;
  state.brightness = 0;
  state.lastSentBrightness = -1;

  Shelly.call("Light.Set", { id: 0, on: false }, function(result, error_code) {
    if (error_code === 0) {
      print("🔥 SURCHAUFFE > " + CONFIG.tempOverheat + "C -> RELAIS COUPÉ [" + timeStr() + "]");
    } else {
      print("🔥 SURCHAUFFE CRITIQUE -> ERREUR COMMUNICATION (code " + error_code + ")");
    }
  });
}

function sensorDegradedMode() {
  if (isDayTime()) {
    print("⚠️ SONDE KO - mode dégradé JOUR -> régulation maintenue");
    regulateSolar();
  } else {
    setDimmer(0);
    print("⚠️ SONDE KO - mode dégradé NUIT -> arrêt par prudence");
  }
}

// =======================================================================
// SECTION 10 : DÉTECTION SURPLUS (BASELINE)
// =======================================================================
function startBaseline() {
  state.nightState = "measuring";
  baselineReadings = [];
  state.stoppedLogged = false;
  state.brightness = CONFIG.brightnessFloor;
  setDimmer(0);
  print("Mesure Baseline : début mesure (" + CONFIG.baselineCycles + " cycles)");
}

function collectBaseline() {
  if (baselineReadings.length >= CONFIG.baselineCycles) return; // guard anti-double

  getPower(function(p) {
    if (p === null) {
      print("Mesure Baseline : échec lecture EM");
      return;
    }
    baselineReadings.push(p);
    let count = baselineReadings.length;
    print("Mesure Baseline : lecture " + count + "/" + CONFIG.baselineCycles + " -> " + Math.round(p) + "W");

    if (count >= CONFIG.baselineCycles) {
      let sum = 0;
      for (let i = 0; i < baselineReadings.length; i++) sum += baselineReadings[i];
      let avg = sum / baselineReadings.length;
      print("Mesure Baseline : moyenne = " + avg.toFixed(1) + "W (seuil " + CONFIG.baselineThreshold + "W)");

      if (avg < CONFIG.baselineThreshold) {
        state.nightState = "regulating";
        print("✅ Surplus détecté -> reprise régulation");
      } else {
        state.nightState = "stopped";
        print("🛑 Pas de surplus -> arrêt");
      }
    }
  });
}

// =======================================================================
// SECTION 11 : RÉGULATION SOLAIRE (gains optimisés)
// =======================================================================
function regulateSolar() {
  let now = Date.now();
  if (now - state.lastRegulateCall < CONFIG.regulateCooldown) return;
  state.lastRegulateCall = now;

  getPower(function(p) {
    if (p === null) {
      print("⚠️ Régulation : échec lecture EM");
      return;
    }

    state.pGrid = p;
    print("Réseau: " + Math.round(p) + "W");

    if (p >= CONFIG.targetMin && p <= CONFIG.targetMax) {
      print("✓ Stable [" + CONFIG.targetMin + "-" + CONFIG.targetMax + "W]");
      return;
    }

    let error = p - CONFIG.targetMin;
    let absError = Math.abs(error);
    let step = 0.4;

    if      (absError > 400) step = 19.5;
    else if (absError > 250) step = 8.0;
    else if (absError > 120) step = 4.5;
    else if (absError > 85)  step = 2.5;
    else if (absError > 55)  step = 1.5;
    else if (absError > 25)  step = 0.8;

    if (p > CONFIG.targetMax) {
      state.brightness -= step;
    } else if (p < CONFIG.targetMin) {
      state.brightness += step;
    }

    if (state.brightness > 100) state.brightness = 100;
    if (state.brightness < CONFIG.brightnessFloor) {
      state.brightness = CONFIG.brightnessFloor;
      if (isNightTime() && p > CONFIG.targetMax) {
        startBaseline();
        print("🌙 Plancher atteint -> baseline [" + timeStr() + "]");
      }
    }

    setDimmer(state.brightness);
  });
}

// =======================================================================
// SECTION 12 : FORÇAGE NUIT
// =======================================================================
function handleNightForcing(temp) {
  if (!isNightTime()) {
    state.forcedMode = false;
    return false;
  }

  if (temp < CONFIG.tempNightOn) {
    if (!state.forcedMode) {
      state.forcedMode = true;
      print("🌙 Marche Forcée " + CONFIG.brightnessForced + "% (" + temp + "C < " + CONFIG.tempNightOn + "C) [" + timeStr() + "]");
    }
    setDimmer(CONFIG.brightnessForced);
    return true;
  }

  if (state.forcedMode && temp >= CONFIG.tempNightOff) {
    state.forcedMode = false;
    print("🌙 Fin du forçage -> baseline (" + temp + "C) [" + timeStr() + "]");
    startBaseline();
    return true;
  }

  return false;
}

// =======================================================================
// SECTION 13 : GESTION SURPLUS ÉPUISÉ
// =======================================================================
function handleStoppedState(h) {
  if (h < CONFIG.surplusStopHour) {
    setDimmer(0);
    if (!state.stoppedLogged) {
      state.stoppedLogged = true;
      print("🛑 NUIT - surplus épuisé, attente re-test [" + timeStr() + "]");
    }
    return;
  }

  Shelly.call("Light.Set", { id: 0, brightness: 0, on: false });
  state.brightness = 0;
  state.lastSentBrightness = -1;

  if (!state.nightShutdown) {
    state.nightShutdown = true;
    print("🌙 22h -> relais coupé jusqu'à 7h [" + timeStr() + "]");
  }
}

// =======================================================================
// SECTION 14 : TABLEAU DE BORD
// =======================================================================
function printDashboard() {
  let temp = getTemperature();
  let period = getPeriod();
  let periodStr = "JOUR";
  if (period === "night_active") periodStr = "NUIT ACTIVE";
  if (period === "night_off") periodStr = "NUIT OFF";

  // Libellés clairs pour l'état
  let etatStr = state.nightState;
  if (etatStr === "regulating") etatStr = "Régulation active";
  if (etatStr === "measuring") etatStr = "Mesure surplus";
  if (etatStr === "stopped") etatStr = "En attente";

  print("--- TABLEAU DE BORD " + timeStr() + " ---");
  print("  Période    : " + periodStr);
  print("  Température: " + formatTemp(temp));
  print("  Puissance  : " + Math.round(state.pGrid) + "W");
  print("  Dimmer     : " + state.brightness + "% (" + Math.round(state.dimmerPower) + "W)");
  print("  État       : " + etatStr);
  print("  Équiv.100% : " + equivalentHeater.getFormatted() + " (base " + (state.nominalPower || "?") + "W)");
  print("  Forcé      : " + (state.forcedMode ? "OUI" : "NON"));
  print("  Surchauffe : " + (state.overheatMode ? "OUI" : "NON"));
  print("----------------------------------------");
}

// =======================================================================
// SECTION 15 : BOUCLE PRINCIPALE
// =======================================================================
function mainLoop() {
  updateTime();
  state.lastLoopTime = Date.now();

  // --- CALIBRATION EN COURS ---
  if (state.calibrating) {
    calibrate();
    return;
  }

  let temp = getTemperature();
  state.currentTemp = temp;
  let h = currentHour;

  getDimmerPower();

  // --- SONDE ---
  if (temp === null) {
    state.tempFailCount++;
    print("⚠️ Sonde indisponible (" + state.tempFailCount + "/10)");
    if (state.tempFailCount >= 10) sensorDegradedMode();
    return;
  }
  state.tempFailCount = 0;

  // --- SURCHAUFFE (priorité absolue) ---
  if (temp > CONFIG.tempOverheat) {
    emergencyShutdown();
    return;
  }

  if (state.overheatMode && temp <= CONFIG.tempResume) {
    state.overheatMode = false;
    state.overheatLogged = false;
    state.lastOverheatLog = 0;
    state.nightState = "measuring";
    print("✅ Refroidissement OK (" + temp + "C) -> Reprise baseline [" + timeStr() + "]");
  }

  if (state.overheatMode) {
    setDimmer(0);
    let now = Date.now();
    if (!state.overheatLogged) {
      state.overheatLogged = true;
      state.lastOverheatLog = now;
      print("🔥 SURCHAUFFE ACTIVE | Attente < " + CONFIG.tempResume + "C | Actuel: " + temp + "C [" + timeStr() + "]");
    }
    if (now - state.lastOverheatLog > CONFIG.overheatLogInterval) {
      state.lastOverheatLog = now;
      print("🔥 Surchauffe toujours active | Actuel: " + temp + "C [" + timeStr() + "]");
    }
    return;
  }

  // --- TRANSITION 18h : BASELINE (une seule fois, entre 18h et 22h) ---
  if (h >= 18 && h < CONFIG.surplusStopHour && !state.nightTransitionDone && state.nightState === "regulating") {
    state.nightTransitionDone = true;
    startBaseline();
    print("🌙 Passage 18h -> baseline [" + timeStr() + "]");
    return;
  }

  // --- FORÇAGE NUIT ---
  if (handleNightForcing(temp)) {
    updateEquivalentHeater(temp);
    return;
  }

  // --- MODE JOUR ---
  if (isDayTime(h)) {
    regulateSolar();
    updateEquivalentHeater(temp);
    return;
  }

  // --- MODE NUIT ---
  if (state.nightState === "measuring") {
    collectBaseline();
    return;
  }

  if (state.nightState === "regulating") {
    regulateSolar();
    updateEquivalentHeater(temp);
    return;
  }

  // --- SURPLUS ÉPUISÉ ---
  if (state.nightState === "stopped") {
    handleStoppedState(h);
  }
}

// =======================================================================
// SECTION 16 : COMPTEUR ÉQUIVALENT (mesure réelle + calibration)
// =======================================================================
function updateEquivalentHeater(temp) {
  equivalentHeater.update(state.dimmerPower);
  equivalentHeater.log(state.dimmerPower, temp, state.brightness);
}

// =======================================================================
// SECTION 17 : INITIALISATION
// =======================================================================
function init() {
  print("=== Routeur Solaire Shelly - Régulation v finale===");

  for (let i = 0; i < 50; i++) {
    Timer.clear(i);
  }
  print("✓ Nettoyage timers terminé");

  updateTime();

  // Note : l'état nuit sera initialisé après la calibration
  // pour éviter une baseline pendant la montée à 100%

  print("✓ Script prêt [" + timeStr() + "]");
}

// =======================================================================
// SECTION 18 : TIMERS
// =======================================================================
function setupTimers() {
  Timer.set(CONFIG.checkInterval, true, mainLoop);

  Timer.set(60000, true, function() {
    let prevHour = currentHour;
    updateTime();

    // Transition 18h → baseline : gérée dans mainLoop()

    if (prevHour === 21 && currentHour === 22) {
      state.nightState = "stopped";
      print("🌙 22h -> arrêt définitif jusqu'à 7h [" + timeStr() + "]");
    }

    if (prevHour === 6 && currentHour === 7) {
      state.nightState = "regulating";
      state.forcedMode = false;
      state.nightShutdown = false;
      state.stoppedLogged = false;
      state.lastSentBrightness = -1;
      state.nightTransitionDone = false;     
      print("☀️ Lever du jour -> reset complet [" + timeStr() + "]");
    }

    if (prevHour === 23 && currentHour === 0) {
      let previousEquiv = equivalentHeater.reset();
      print("🔄 Reset compteur (minuit) | Hier = " + previousEquiv.toFixed(2) + "h équiv. 100%");
    }
  });

  Timer.set(CONFIG.surplusRetryMin * 60 * 1000, true, function() {
    if (isNightTime() && currentHour < CONFIG.surplusStopHour && state.nightState === "stopped") {
      print("🔄 Re-test surplus [" + timeStr() + "]");
      startBaseline();
    }
  });

  Timer.set(CONFIG.dashboardInterval, true, printDashboard);

  Timer.set(CONFIG.watchdogInterval, true, function() {
    if (state.lastLoopTime === 0) return;
    let elapsed = (Date.now() - state.lastLoopTime) / 1000;
    if (elapsed > CONFIG.watchdogMaxInactive) {
      print("🐕 WATCHDOG - boucle inactive depuis " + Math.round(elapsed) + "s -> REBOOT");
      Shelly.call("Light.Set", { id: 0, on: false });
      Shelly.call("Shelly.Reboot", {});
    }
  });
}

// =======================================================================
// SECTION 19 : ENDPOINT HTTP
// =======================================================================
function recupparam(str, param) {
  let idx = str.indexOf(param + "=");
  if (idx < 0) return -1;
  let start = idx + param.length + 1;
  let end = str.indexOf("&", start);
  if (end < 0) end = str.length;
  let value = parseFloat(str.substr(start, end - start));
  return isNaN(value) ? -1 : value;
}

function setupHTTP() {
  HTTPServer.registerEndpoint("setDom", function(req, res) {
    if (!req.query) {
      res.code = 400;
      res.body = "Aucune query fournie. Usage: /setDom?targetMin=X (0-500)";
      res.send();
      return;
    }

    let value = recupparam(req.query, "targetMin");

    if (value !== -1 && value >= 0 && value <= 500) {
      CONFIG.targetMin = Math.round(value);
      CONFIG.targetMax = CONFIG.targetMin + 30;
      res.code = 200;
      res.body = "Plage cible : " + CONFIG.targetMin + " à " + CONFIG.targetMax + " W";
      print("✓ Cible modifiée -> " + CONFIG.targetMin + ".." + CONFIG.targetMax + "W [" + timeStr() + "]");
    } else {
      res.code = 400;
      res.body = "Valeur invalide (attendu : 0..500)";
      print("✗ Valeur rejetée : " + value + " [" + timeStr() + "]");
    }

    res.send();
  });

  print("✓ Endpoint HTTP /setDom enregistré");
}

// =======================================================================
// SECTION 20 : DÉMARRAGE
// =======================================================================
init();
setupTimers();
setupHTTP();

print("=== Script régulation PLAGES démarré [" + timeStr() + "] ===");
