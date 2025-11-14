// Global variable for the audio context
var audioContext;
// NOTE: The active oscillators map is managed within the Piano class

/**
 * Function to start tone playback using Web Audio API.
 * Applies the volume ATTACK based on the instrument parameters.
 * @param {number} frequency - Frequency in Hz (0 for pause, returns null).
 * @param {Object} instrument - Object containing the ADSR parameters (attack, sustainLevel, type, release).
 * @returns {Object | null} Returns an object with the oscillator and the Gain node.
 */
function startBeep(frequency, instrument) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (frequency <= 0) {
        return null;
    }

    var oscillator = audioContext.createOscillator();
    var gainNode = audioContext.createGain(); // Volume control node

    // Connection
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Wave type: Configured by the instrument
    oscillator.type = instrument.type; 
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);

    // Attack: Ramps the volume up based on the instrument parameters
    var now = audioContext.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    
    // Ramp up to Sustain Level
    gainNode.gain.linearRampToValueAtTime(instrument.sustainLevel, now + instrument.attack); 

    oscillator.start(now);

    // Returns the oscillator AND the Gain node
    return { osc: oscillator, gain: gainNode };
}

/**
 * Stops an oscillator after a specific time (useful for playing back recorded melodies).
 * APPLIES THE INSTRUMENT RELEASE starting from the recorded durationMs.
 * The promise resolves after durationMs to keep the playback chain on time.
 * @param {Object} audioNode - Object {osc: OscillatorNode, gain: GainNode}
 * @param {number} durationMs - Duration of the recorded keypress (Sustain Time).
 * @param {Object} instrument - Object containing the ADSR parameters.
 * @returns {Promise<void>}
 */
function stopBeep(audioNode, durationMs, instrument) {
    if (audioNode && audioNode.osc) {
        // --- 1. SOUND DECAY AND STOP PROGRAMMING ---
        var durationSec = durationMs / 1000.0;
        var now = audioContext.currentTime;
        var releaseTime = instrument.release; // Instrument release time

        // 1. Calculate the time in seconds when the keypress 'ends' (start of Release)
        var releaseStartTime = now + durationSec;
        
        // 2. Calculate the total sound time (keypress + release)
        var totalSoundTimeSec = durationSec + releaseTime; 
        var totalSoundTimeMs = durationMs + (releaseTime * 1000); 
        
        // Apply the RELEASE: Exponential ramp from sustainLevel to zero
        audioNode.gain.gain.cancelScheduledValues(now);
        audioNode.gain.gain.setValueAtTime(instrument.sustainLevel, releaseStartTime); 
        audioNode.gain.gain.exponentialRampToValueAtTime(0.0001, now + totalSoundTimeSec); 
        
        // Stop the oscillator when the sound has completely decayed (This runs in the background)
        setTimeout(function() {
            try {
                audioNode.osc.stop(); 
            } catch (e) {
                // Already stopped
            }
        }, totalSoundTimeMs); 
        
        // --- 2. PLAYBACK CHAIN SYNCHRONIZATION ---
        return new Promise(function(resolve) {
            // CRITICAL: We resolve the promise after the *recorded* duration (durationMs).
            // This allows the next note or pause to start on time.
            setTimeout(resolve, durationMs); 
        });
    }
    return Promise.resolve();
}


/**
 * Portable function to save text as a file in the browser.
 */
function guardarArchivoComo(contenido, nombreArchivo) {
    try {
        var blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        
        var a = document.createElement('a');
        a.href = url;
        a.download = nombreArchivo;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
        return true;
    } catch (e) {
        console.error("Error saving file:", e);
        return false;
    }
}


function Piano() {
    this.frecuenciaPorTecla = {};
    this.grabacion = []; 
    this.octavaFactor = [0.25, 0.5, 1.0, 2.0, 4.0];
    this.indiceOctavaActual = 2; 
    this.duracionPredeterminadaMs = 150; 
    this.isPlaying = false;
    this.cancelPlayback = false;
    // CRITICAL: This value now stores the *end of keypress* time (not end of sound) of the last note.
    this.tiempoDeUltimaNotaMs = 0; 
    this.ultimoArchivoProcesado = "SONG.MUS"; 
    
    // --- NEW: DATA/READ export state ---
    this.exportAsData = false; 

    // --- NEW: Version Constant ---
    this.VERSION = "1.03"; // <-- VERSION BUMPED

    // --- INSTRUMENT STATE ---
    this.instruments = this.initializeInstruments();
    this.instrumentIndex = 0; // Initial Instrument: Classic Piano

    this.tiempoInicioPulsacion = {}; 
    this.osciladoresActivos = {}; 

    this.logArea = document.getElementById('log-area');

    this.inicializarMapasDeNotas();
    this.updateUIStatus();
    this.logToConsole("System initialized. Press a note key or a command.");
    this.logToConsole("Using instrument: " + this.instruments[this.instrumentIndex].name + " (Z/X to change)");
    
    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    window.addEventListener('keyup', this.handleKeyUp.bind(this));
}

// --- PIANO CLASS METHODS ---

/**
 * Method required to handle the DATA/READ export checkbox.
 */
Piano.prototype.setExportAsData = function(isChecked) {
    this.exportAsData = isChecked;
    this.logToConsole("Export as DATA/READ: " + (isChecked ? "ACTIVE" : "INACTIVE"));
}

Piano.prototype.logToConsole = function(texto) {
    var timestamp = new Date().toLocaleTimeString('en-US'); // Changed locale to US for timestamps
    var line = "[" + timestamp + "] " + texto + "\n";
    if (this.logArea) {
        this.logArea.textContent += line;
        this.logArea.scrollTop = this.logArea.scrollHeight;
    } else {
        console.log(line.trim());
    }
};

Piano.prototype.updateUIStatus = function() {
    // Only update if elements exist in the DOM
    var oe = document.getElementById('octave-factor');
    var nc = document.getElementById('note-count');
    var dm = document.getElementById('duration-ms');
    var fn = document.getElementById('file-name');
    if (oe) oe.textContent = "x" + this.octavaFactor[this.indiceOctavaActual].toFixed(2);
    if (nc) nc.textContent = this.grabacion.length;
    if (dm) dm.textContent = this.duracionPredeterminadaMs; 
    if (fn) fn.textContent = this.ultimoArchivoProcesado; 
};

/**
 * Defines the 15 instruments with their volume envelope parameters (simplified ADSR).
 */
Piano.prototype.initializeInstruments = function() {
    return [
        // index 0
        { name: "Classic Piano", type: "sine", attack: 0.01, sustainLevel: 0.7, release: 0.5 },
        // index 1
        { name: "Jazz Organ", type: "triangle", attack: 0.05, sustainLevel: 0.9, release: 0.1 },
        // index 2
        { name: "Loud Synthesizer", type: "sawtooth", attack: 0.005, sustainLevel: 0.8, release: 0.3 },
        // index 3
        { name: "Recorder Flute", type: "triangle", attack: 0.04, sustainLevel: 0.6, release: 0.6 },
        // index 4
        { name: "Percussive Harpsichord", type: "square", attack: 0.002, sustainLevel: 0.7, release: 0.2 },
        // index 5
        { name: "Deep Bass", type: "sine", attack: 0.01, sustainLevel: 1.0, release: 0.1 },
        // index 6
        { name: "Metallic Bell", type: "sine", attack: 0.001, sustainLevel: 0.1, release: 1.0 },
        // index 7
        { name: "Electric Guitar", type: "sawtooth", attack: 0.01, sustainLevel: 0.6, release: 0.4 },
        // index 8 - ADJUSTED: Sustain level increased to 0.4 to double perceived volume.
        { name: "Digital Pluck (Pizzicato)", type: "triangle", attack: 0.001, sustainLevel: 0.4, release: 0.3 },
        // index 9
        { name: "Classic Trumpet", type: "sawtooth", attack: 0.1, sustainLevel: 0.7, release: 0.3 },
        // index 10
        { name: "Whistle", type: "sine", attack: 0.05, sustainLevel: 0.9, release: 0.5 },
        // index 11 - ADJUSTED: Sustain level increased to 0.6 to double perceived volume.
        { name: "Marimba/Xylophone", type: "triangle", attack: 0.001, sustainLevel: 0.6, release: 0.5 },
        // index 12
        { name: "Harmonica (Rough)", type: "square", attack: 0.1, sustainLevel: 0.6, release: 0.2 },
        // index 13
        { name: "Dark Piano", type: "sine", attack: 0.02, sustainLevel: 0.4, release: 0.8 },
        // index 14
        { name: "Bass Lead Synthesizer", type: "sawtooth", attack: 0.03, sustainLevel: 0.9, release: 0.1 }
    ];
};

Piano.prototype.inicializarMapasDeNotas = function() {
    // [CRITICAL MODIFICATION]
    // We use event.code (physical code) instead of event.key (character).
    // This ensures the note is activated regardless of the keyboard layout.

    // Position correspondence (Standard QWERTY Keyboard):
    // White Keys: 'a','s','d','f','g','h','j','k','l',';',''','#'
    // On the Spanish QWERTY keyboard: 'a','s','d','f','g','h','j','k','l','ñ','´','Ç'
    var keysBlancasCode = [
        'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 
        'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Backslash' 
    ]; 
    var frecBlancas = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659, 698, 784];

    // Black Keys: 'w','e', 't','y','u','i','o','p', '[' 
    // On the Spanish keyboard: 'w','e','t','y','u','i','o','p', '+'
    var keysNegrasCode = [
        'KeyW', 'KeyE', 'KeyT', 'KeyY', 'KeyU', 
        'KeyI', 'KeyO', 'KeyP', 'KeyOemOpenBrackets' 
    ];
    var frecNegras = [277, 311, 370, 415, 466, 554, 622, 740, 831];

    var self = this;
    keysBlancasCode.forEach(function(key, i) { self.frecuenciaPorTecla[key] = frecBlancas[i]; });
    keysNegrasCode.forEach(function(key, i) { self.frecuenciaPorTecla[key] = frecNegras[i]; });
};

// ----------------------------------------------------------------------------------------------------------------

// ... (Previous methods remain)

Piano.prototype.handleKeyDown = function(event) {
    // Use event.code for notes (physical positions)
    var noteKey = event.code; 
    // Use event.key for commands (characters)
    var commandKey = event.key.toLowerCase();
    
    if (this.isPlaying) {
        // --- CRITICAL CORRECTION: IMMEDIATE STOP ---
        this.cancelPlayback = true; 
        this.isPlaying = false; // Allows the next keypress to be a normal note/command
        
        this.logToConsole("Playback cancelled by user.");
        this.updateUIStatus(); 
        
        event.preventDefault(); 
        return; 
    }

    // --- INSTRUMENT LOGIC (Z/X) ---
    if (commandKey === 'z') {
        event.preventDefault();
        this.changeInstrument(-1);
        return;
    }
    if (commandKey === 'x') {
        event.preventDefault();
        this.changeInstrument(1);
        return;
    }
    // ------------------------------------------

    if (this.frecuenciaPorTecla.hasOwnProperty(noteKey)) { // Search for note by key CODE
        if (event.repeat) return;
        if (this.osciladoresActivos.hasOwnProperty(noteKey)) return;
        
        event.preventDefault();

        // --- NEW: Add 'pressed' class to the visual element ---
        var keyElement = document.querySelector('.key[data-code="' + noteKey + '"]');
        if (keyElement) {
            keyElement.classList.add('pressed');
        }
        // --------------------------------------------------------
        
        this.tocarNota(noteKey); // Pass the CODE
        this.updateUIStatus();
    } else {
        // --- LOGGING UNMAPPED KEYS AS COMMANDS ---
        if (commandKey.length === 1 || commandKey === 'escape') {
             this.logToConsole(
                 "Unmapped Command/Key: Key='" + commandKey.toUpperCase() + 
                 "', Code='" + event.code + "'"
             );
        } else {
             this.logToConsole(
                 "Unmapped Command/Key: Key='" + commandKey.toUpperCase() + 
                 "' (Code: " + event.code + ")"
             );
        }
        
        // Process the command (uses the key character: commandKey)
        this.handleCommand(commandKey);
    }
};

// ... (The rest of the code remains)

// ----------------------------------------------------------------------------------------------------------------

Piano.prototype.handleKeyUp = function(event) {
    // [CRITICAL MODIFICATION]
    // Use event.code to stop the note (must match the key used in handleKeyDown).
    var noteKey = event.code; 
    
    if (this.frecuenciaPorTecla.hasOwnProperty(noteKey)) { // <-- Use noteKey (code) here
        event.preventDefault();
        
        // --- NEW: Remove 'pressed' class from the visual element ---
        var keyElement = document.querySelector('.key[data-code="' + noteKey + '"]');
        if (keyElement) {
            keyElement.classList.remove('pressed');
        }
        // --------------------------------------------------------

        if (this.tiempoInicioPulsacion.hasOwnProperty(noteKey)) {
            this.detenerYGrabarNota(noteKey); // <-- Pass noteKey (code) to detenerYGrabarNota
            this.updateUIStatus();
        }
    }
};

// ---

Piano.prototype.changeInstrument = function(delta) {
    var totalInstruments = this.instruments.length;
    var newIndex = (this.instrumentIndex + delta + totalInstruments) % totalInstruments;
    this.instrumentIndex = newIndex;
    var instrumentName = this.instruments[newIndex].name;
    this.logToConsole("Using instrument: " + instrumentName + " (Index " + (newIndex + 1) + "/" + totalInstruments + ")");
};

Piano.prototype.handleCommand = function(key) {
    if (key === '0') {
        this.lockAndClearRecording();
    } else if (key === '1') {
        this.logToConsole("Opening dialog to Load melody (.MUS)...");
        document.getElementById('file-input').click(); 
    } else if (key === '2') {
        this.guardarMelodiaAArchivo();
    } else if (key === '3') {
        this.reproducirGrabacion();
    } else if (key === '4') {
        this.generarYGuardarAmstradBasic();
    } else if (key === '5') {
        this.generarYGuardarPbString();
    } else if (key === '6') {
        this.generarYGuardarZxBasic();
    } else if (key === ',') {
        this.changeOctave(-1);
    } else if (key === '.') {
        this.changeOctave(1);
    } else if (key === 'm') { 
        this.mostrarAyudaCompleta();
    } else if (key === 'escape') {
        this.logToConsole("Application ended.");
    }
    this.updateUIStatus();
};

/**
 * Starts a note press, applies the ATTACK, and records its start time.
 */
Piano.prototype.tocarNota = function(key) { // 'key' is now the 'code' (e.g., 'KeyA')
    var tiempoPulsacionMs = Date.now();
    var freqBase = this.frecuenciaPorTecla[key]; // Search by code
    var freqFinal = Math.floor(freqBase * this.octavaFactor[this.indiceOctavaActual]);
    
    var currentInstrument = this.instruments[this.instrumentIndex];
    
    // 1. Start the oscillator and save it (pass the instrument for ADSR)
    var audioNode = startBeep(freqFinal, currentInstrument); 
    
    this.osciladoresActivos[key] = { freq: freqFinal, node: audioNode };
    this.tiempoInicioPulsacion[key] = tiempoPulsacionMs;
    
    // The log shows the 'code' for debugging
    this.logToConsole("Note: " + key + " (" + freqFinal + " Hz) STARTED"); 
};

/**
 * Stops the note, applies the volume RELEASE, calculates the duration, and records the note/pause.
 */
Piano.prototype.detenerYGrabarNota = function(key) { // 'key' is now the 'code' (e.g., 'KeyA')
    var tiempoSoltarMs = Date.now();
    
    // 1. Stop the sound with Release
    var notaActiva = this.osciladoresActivos[key];
    var currentInstrument = this.instruments[this.instrumentIndex];

    if (notaActiva && notaActiva.node) {
        // ... (RELEASE logic and setTimeout remain the same)

        var audioNode = notaActiva.node;
        var now = audioContext.currentTime;
        var releaseTime = currentInstrument.release; 

        audioNode.gain.gain.cancelScheduledValues(now); 
        audioNode.gain.gain.setValueAtTime(audioNode.gain.gain.value, now); 
        audioNode.gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);

        setTimeout(function() {
            try {
                audioNode.osc.stop(); 
            } catch (e) {
                // Already stopped
            }
        }, releaseTime * 1000);

        delete this.osciladoresActivos[key];
    }

    // 2. Calculate duration and record
    var tiempoInicio = this.tiempoInicioPulsacion[key];
    
    if (tiempoInicio !== undefined && notaActiva) {
        var duracionMs = Math.max(1, tiempoSoltarMs - tiempoInicio); 
        var freqFinal = notaActiva.freq;
        
        this.grabarNotaYPausa(freqFinal, duracionMs, tiempoInicio, tiempoSoltarMs);
        delete this.tiempoInicioPulsacion[key];
    }
};

/**
 * Records the previous pause and the new note with its calculated duration.
 * Uses the *end of keypress* time (tiempoFinPulsacion) again to calculate the pause,
 * ensuring the melody speed remains true to the performance, regardless of the instrument Release.
 */
Piano.prototype.grabarNotaYPausa = function(freqFinal, duracionNotaMs, tiempoInicio, tiempoFinPulsacion) {
    var MIN_PAUSA_MS = 1.0; 
    
    // 1. Record the pause (silence between the previous note and this one)
    if (this.tiempoDeUltimaNotaMs !== 0) {
        // The pause is the time from when the previous *keypress* ended (this.tiempoDeUltimaNotaMs) 
        // until the *new note* started (tiempoInicio).
        var pausaMs = tiempoInicio - this.tiempoDeUltimaNotaMs;
        
        // Keep this simple logic to respect the performance speed.
        if (pausaMs > MIN_PAUSA_MS) {
            // CRITICAL Adjustment: Reduce the pause so it's 76% of the original duration (divide by 1 / 0.76 = 1.315789).
            var PAUSE_REDUCTION_DIVISOR = 1.3157894736842106;
            var pausaReducidaMs = pausaMs / PAUSE_REDUCTION_DIVISOR; 

            this.grabacion.push({ frecuencia: 0, duracionMs: pausaReducidaMs });
            this.logToConsole("PAUSE recorded (reduced to 76%): " + pausaReducidaMs.toFixed(0) + " ms");
        } else if (pausaMs < -MIN_PAUSA_MS) {
             // This means the new note was pressed well before the previous one was released (overlap).
             this.logToConsole("Keystroke overlap (Chord/Legato).");
        }
    }
    
    // 2. Record the new note (keypress duration)
    this.grabacion.push({ frecuencia: freqFinal, duracionMs: duracionNotaMs });
    this.logToConsole("Note: " + freqFinal + " Hz recorded (" + duracionNotaMs + " ms)");
    
    // 3. Update the end time of the last recorded note
    // CRITICAL: Use the END OF KEYPRESS time (not end of sound) to calculate the next pause.
    this.tiempoDeUltimaNotaMs = tiempoFinPulsacion;
};

Piano.prototype.lockAndClearRecording = function() {
    this.grabacion = [];
    this.tiempoDeUltimaNotaMs = 0; 
    this.ultimoArchivoProcesado = "SONG.MUS"; 
    this.logToConsole("--- NEW MELODY / RECORDING CLEARED ---");
};

// Use an asynchronous function (if environment supports it) or a promise to simulate async/await
Piano.prototype.reproducirGrabacion = function() {
    var self = this;
    
    if (this.grabacion.length === 0 || this.isPlaying) {
        this.logToConsole(this.isPlaying ? "Already playing." : "No notes recorded.");
        return;
    }
    
    this.isPlaying = true;
    this.cancelPlayback = false;
    this.logToConsole("--- START PLAYBACK (" + this.grabacion.length + " notes) ---"); 

    // Get the current instrument for playback
    var currentInstrument = self.instruments[self.instrumentIndex];

    function playNext(index) {
        if (index >= self.grabacion.length || self.cancelPlayback) {
            self.isPlaying = false;
            self.cancelPlayback = false;
            self.logToConsole("--- END PLAYBACK ---");
            self.updateUIStatus();
            return;
        }

        var nota = self.grabacion[index];
        var promise;

        if (nota.frecuencia > 0) {
            // startBeep only performs the ATTACK. 
            var audioNode = startBeep(nota.frecuencia, currentInstrument); 
            // stopBeep: schedules the release *in the background* and returns a promise 
            // that resolves at the end of the recorded duration (durationMs).
            promise = stopBeep(audioNode, nota.duracionMs, currentInstrument);
        } else {
            promise = new Promise(function(resolve) {
                // Pauses only wait for the recorded duration.
                setTimeout(resolve, nota.duracionMs);
            });
        }
        
        promise.then(function() {
            // The next note/pause is called immediately after the recorded time ends.
            playNext(index + 1);
        });
    }

    playNext(0);
};

Piano.prototype.changeOctave = function(delta) {
    var newIndex = this.indiceOctavaActual + delta;
    if (newIndex >= 0 && newIndex < this.octavaFactor.length) {
        this.indiceOctavaActual = newIndex;
        this.logToConsole("Octave changed. Factor: " + this.octavaFactor[this.indiceOctavaActual].toFixed(2));
    }
};

Piano.prototype.eliminarPausasFinales = function() {
    while (this.grabacion.length > 0 && this.grabacion[this.grabacion.length - 1].frecuencia === 0) {
        this.grabacion.pop();
    }
};

Piano.prototype.mostrarAyudaCompleta = function() {
    var helpText = "\n" +
"### MELOD8 Web Piano - Version History ###\n" + 
" 1.03 (2025-11-14): Feature: Added 'by fito' credit to the header.\n" +
" 1.02 (2025-11-14): Fix: Added :active state to keys for better mobile feedback and corrected black key press color.\n" +
" 1.01 (2025-11-14): Translate to english and restore Z/X instrument change buttons.\n" +
" 1.00 (2025-11-14): Initial release with ADSR control and multi-format BASIC export.\n" +
"\n" +
"RECORDING AND PLAYBACK COMMANDS:\n" +
" [0]: Clear current melody.\n" +
" [1]: Load melody from a file (.MUS).\n" +
" [2]: Save melody to a file (.MUS).\n" +
" [3]: Play the recorded melody (Press any key to stop).\n" +
"\n" +
"EXPORT COMMANDS (Generate BASIC files):\n" +
" [4]: Generate Amstrad CPC BASIC code (.BAS).\n" +
" [5]: Generate PowerBASIC PLAY string (.BAS).\n" +
" [6]: Generate ZX Spectrum BASIC BEEP/PAUSE code (.BAS).\n" +
" [Checkbox 'Export as DATA/READ']: Exports as DATA/READ lines for more compact code (RECOMMENDED).\n" +
"\n" +
"CONFIGURATION COMMANDS:\n" +
" [Z/X]: Change instrument (total " + this.instruments.length + ").\n" +
" [,]: Decrease octave.\n" +
" [.]: Increase octave.\n" +
" [M]: Show this help (press the 'm' key).\n";
    this.logToConsole("------------------- FULL HELP -------------------");
    this.logToConsole(helpText);
    this.logToConsole("----------------- END OF FULL HELP -----------------");
};

// --- FILE LOADING AND SAVING (.MUS) ---

Piano.prototype.cargarMelodiaDesdeInput = function(fileList) {
    if (fileList.length === 0) return;

    var file = fileList[0];
    var reader = new FileReader();
    var self = this;

    reader.onload = function(e) {
        var contenido = e.target.result;
        self.parsearYAplicarMelodia(contenido, file.name);
        document.getElementById('file-input').value = ''; 
    };

    reader.onerror = function() {
        self.logToConsole("ERROR reading file: " + file.name);
    };

    reader.readAsText(file);
};

Piano.prototype.parsearYAplicarMelodia = function(contenido, nombreArchivo) {
    var lineas = contenido.split('\n');
    var nuevaGrabacion = [];
    var MIN_DURACION_AUDIBLE_MS = 50.0; 
    
    var errores = 0;

    for (var i = 0; i < lineas.length; i++) {
        var line = lineas[i].trim();
        
        if (!line || line.startsWith(';') || line.startsWith('#')) continue;

        var norm = line.replace(/;|\t/g, ',').replace(/\s+/g, ',');
        while (norm.indexOf(',,') !== -1) norm = norm.replace(/,,/g, ',');
        
        var parts = norm.split(',');

        if (parts.length < 2) {
            errores++;
            continue;
        }

        var freq = parseInt(parts[0], 10);
        var dur = parseFloat(parts[1]); 

        if (isNaN(freq) || isNaN(dur)) {
            errores++;
            continue;
        }

        nuevaGrabacion.push({ 
            frecuencia: freq, 
            duracionMs: Math.max(dur, MIN_DURACION_AUDIBLE_MS) 
        });
    }

    if (errores > 0) {
        this.logToConsole("WARNING: Ignored " + errores + " lines with incorrect format.");
    }

    if (nuevaGrabacion.length > 0) {
        this.grabacion = nuevaGrabacion;
        this.ultimoArchivoProcesado = nombreArchivo;
        this.tiempoDeUltimaNotaMs = 0; 
        this.logToConsole("File " + nombreArchivo + " loaded successfully (" + this.grabacion.length + " notes).");
    } else {
        this.logToConsole("ERROR: File " + nombreArchivo + " does not contain valid notes.");
    }
    this.updateUIStatus();
};

Piano.prototype.guardarMelodiaAArchivo = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) {
        this.logToConsole("No notes to save.");
        return;
    }

    var contenido = '';
    for (var i = 0; i < this.grabacion.length; i++) {
        var n = this.grabacion[i];
        contenido += n.frecuencia.toFixed(0) + "," + n.duracionMs.toFixed(2) + ",00\n";
    }

    var nombre = this.ultimoArchivoProcesado;
    if (!nombre.toUpperCase().endsWith(".MUS")) {
        nombre = nombre.indexOf('.') !== -1 ? nombre : nombre + ".MUS";
    }
    
    if (guardarArchivoComo(contenido, nombre)) {
        this.logToConsole("Melody saved as " + nombre + ".");
    } else {
        this.logToConsole("ERROR saving file.");
    }
};


// --- BASIC EXPORT FUNCTIONS ---

Piano.prototype.generarYGuardarAmstradBasic = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) { this.logToConsole("No notes to export."); return; }

    var sb = "10 REM MELOD8 by fitosoft AMSTRAD CPC BASIC\n"; 
    var linea = 20;
    const fileName = "cpc.bas"; 
    
    // --- NEW CONSTANT ---
    const PAIRS_PER_DATA_LINE = 10;
    // -----------------------

    if (this.exportAsData) {
        this.logToConsole("Exporting to CPC with DATA/READ...");
        
        const LINEA_DATA_INICIO = 100;
        
        sb += "20 REM Playback initialization\n";
        sb += "30 RESTORE " + LINEA_DATA_INICIO + ": DIM D(2): REM D(1)=Pitch, D(2)=Duration\n";
        sb += "40 FOR I = 1 TO " + this.grabacion.length + "\n";
        sb += "50 READ D(1), D(2)\n";
        sb += "60 IF D(1) = -1 THEN END: REM End of data\n";
        sb += "70 SOUND 2,D(1),D(2)\n";
        sb += "80 NEXT I\n";
        
        // The current line 'linea' will be used to track the start of DATA lines
        let dataLineNumber = LINEA_DATA_INICIO;
        
        let currentDataLine = dataLineNumber + " DATA ";
        let pairCount = 0; // Pair counter on the current line

        for (var i = 0; i < this.grabacion.length; i++) {
            var n = this.grabacion[i];
            var durEsc = Math.max(1, Math.round(n.duracionMs / 10.0)); 
            
            var pitch = 0;
            if (n.frecuencia > 0) {
                // CPC Pitch Calculation
                pitch = Math.round(62500.0 / n.frecuencia);
                pitch = Math.max(1, Math.min(4095, pitch)); 
            } else {
                pitch = 1; // A low pitch for SOUND 2,1,Dur: silence (pause)
            }
            
            var dataChunk = pitch + "," + durEsc + ",";

            // Pair limit control (10)
            if (pairCount >= PAIRS_PER_DATA_LINE) {
                // End the previous DATA line and add it to sb
                sb += currentDataLine.slice(0, -1) + "\n";
                
                // Move the line number to the next ordinal
                dataLineNumber += 10; 
                
                // Start a new DATA line
                currentDataLine = dataLineNumber + " DATA ";
                pairCount = 0;
            }
            
            currentDataLine += dataChunk;
            pairCount++;
        }
        
        // Add the last DATA line if it has content
        if (pairCount > 0) {
            sb += currentDataLine.slice(0, -1) + "\n";
            dataLineNumber += 10;
        }

        // End marker
        sb += dataLineNumber + " DATA -1, 0\n"; 
        
        // Use the last generated line to calculate the start of the final code
        linea = dataLineNumber + 10;
        
        // --- KEY WAIT CODE ---
        sb += linea + " PRINT\"press a key\"\n";
        linea += 10;
        sb += linea + " WHILE INKEY$=\"\":WEND\n"; 
        linea += 10;
        sb += linea + " END\n"; 

    } else {
        this.logToConsole("Exporting to CPC line by line...");
        
        // The initial line number for this block is 20
        linea = 20;
        
        for (var i = 0; i < this.grabacion.length; i++) {
            var n = this.grabacion[i];
            var durEsc = Math.max(1, Math.round(n.duracionMs / 10.0)); 
            
            if (n.frecuencia === 0) {
                sb += linea + " SOUND 2,1," + durEsc + ",0\n"; 
            } else {
                var pitch = Math.round(62500.0 / n.frecuencia);
                pitch = Math.max(1, Math.min(4095, pitch)); 
                sb += linea + " SOUND 2," + pitch + "," + durEsc + "\n";
            }
            linea += 10;
        }
        
        // --- KEY WAIT CODE ---
        sb += linea + " PRINT\"press a key\"\n";
        linea += 10;
        sb += linea + " WHILE INKEY$=\"\":WEND\n"; 
        linea += 10;
        sb += linea + " END\n"; 
    }

    if (guardarArchivoComo(sb, fileName)) {
        this.logToConsole("Preparing to save basic file for Amstrad CPC"); 
    } else {
        this.logToConsole("ERROR exporting Amstrad. Check the browser console.");
    }
};

Piano.prototype.generarYGuardarPbString = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) { this.logToConsole("No notes to export."); return; }
    
    var FILENAME = "MELOD8.BAS";
    var sb = "10 REM MELOD8 by fitosoft POWERBASIC EXPORT\n";    
    var linea = 20;
    var play = "T255";    
    var duracionL1Ms = 900.0;    

    // --- 1. GENERATE THE COMPLETE PLAY STRING ---
    for (var i = 0; i < this.grabacion.length; i++) {
        var n = this.grabacion[i];
        
        // Calculate the duration factor L
        var pb_L_factor = Math.round(duracionL1Ms / n.duracionMs);
        pb_L_factor = Math.max(1, Math.min(64, pb_L_factor));

        play += "L" + pb_L_factor;

        if (n.frecuencia > 0) {
            // Calculate MIDI note and convert to PB note
            var freqHz = Math.max(20.0, n.frecuencia);
            var midiNote = 12.0 * (Math.log(freqHz / 440.0) / Math.log(2.0)) + 69.0;
            var pbNote = Math.round(midiNote - 36.0);    

            pbNote = Math.max(1, Math.min(84, pbNote));
            
            play += "N" + pbNote;
        } else {
            // Pause
            play += "P";    
        }
    }

    // --- 2. EXPORT ALWAYS WITH LINES (Original 'else' block) ---
    this.logToConsole("Exporting to PowerBASIC line by line (PLAY string).");
    
    var maxLen = 70;    
    var idx = 0;
    var firstPart = true;

    while (idx < play.length) {
        var len = Math.min(maxLen, play.length - idx);
        var part = play.substring(idx, idx + len);
        
        // Adjustment to avoid cutting an N, L, or P command in half
        // Search for the start of a command at the end of the part
        var lastCommandStart = part.search(/[LNP]\d*$/); 
        
        if (lastCommandStart > 0 && (idx + lastCommandStart) < play.length) {
             // If we find an incomplete command at the end, shorten the part just before it.
            len = lastCommandStart;
            part = play.substring(idx, idx + len);
        } else if (lastCommandStart === 0 && !firstPart) {
             // If the line starts with a command (e.g., L64N60...), we don't cut it.
             // This is automatically handled if the length is less than maxLen.
        }
        
        if (firstPart) {
            sb += linea + " M$ = \"" + part + "\"\n";
            firstPart = false;
        } else {
            sb += linea + " M$ = M$ + \"" + part + "\"\n";
        }
        idx += part.length; // Use part.length for the actual length after adjustment
        linea += 10;    
    }

    sb += linea + " PLAY M$\n";
    linea += 10;
    
    // --- Key wait so execution doesn't end instantly (OPTIONAL) ---
    sb += linea + " PRINT \"Press a key to finish...\"\n";
    linea += 10;
    sb += linea + " WHILE INKEY$=\"\":WEND\n";
    linea += 10;
    // ------------------------------------------------------------------------------------

    sb += linea + " END\n";


    // --- 3. STANDARDIZED FINAL MESSAGE ---
    if (guardarArchivoComo(sb, FILENAME)) {
        this.logToConsole("Preparing to save basic file for PowerBasic");
    } else {
        this.logToConsole("ERROR exporting PowerBASIC. Check the browser console.");
    }
};

Piano.prototype.generarYGuardarZxBasic = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) {
        this.logToConsole("No notes to export.");
        return;
    }

    var sb = "10 REM MELOD8 by fitosoft ZX BASIC\n";

    const LINEA_PROGRAMA_INICIO = 20;   // Line where the main program starts
    const LINEA_DATA_INICIO = 90;       // Line where data starts
    const LINEA_FIN = 1000;             // Line for STOP (if necessary)
    const MAX_FRAME_DURATION = 32767;
    const PAIRS_PER_LINE = 8;         // Number of pairs per DATA line
    const PAUSE_DATA_MARKER = 99;     // <--- Key marker for PAUSE (99)

    // Initialization of important variables
    let dataLineNumber = LINEA_DATA_INICIO;
    let programLineNumber = LINEA_PROGRAMA_INICIO;
    
    // Export file name (used for the log)
    const fileName = "ZX.BAS";

    // ----------------------------------------------------
    // DATA/READ EXPORT LOGIC (Compact and Fast)
    // ----------------------------------------------------
    if (this.exportAsData) {
        this.logToConsole("Exporting to ZX with dynamic DATA/READ (8 pairs per line)...");

        // Main program with dynamic GOTO
        sb += programLineNumber + " REM Playback initialization\n"; // 20
        programLineNumber += 10;
        sb += programLineNumber + " RESTORE " + LINEA_DATA_INICIO + "\n"; // 30
        programLineNumber += 10;
        sb += programLineNumber + " READ P, D\n"; // 40 (RETURN POINT)
        programLineNumber += 10;
        sb += programLineNumber + " IF P = -99 THEN STOP: REM End of data\n"; // 50
        programLineNumber += 10;
        // Line 60: If it's PAUSE (99), it executes PAUSE and goes back to 40 (READ)
        sb += programLineNumber + " IF P = " + PAUSE_DATA_MARKER + " THEN PAUSE D: GOTO " + (programLineNumber - 20) + "\n"; // 60 (GOTO 40)
        programLineNumber += 10;
        // Line 70: If it's a note, it executes BEEP and goes back to 40 (READ)
        sb += programLineNumber + " BEEP D, P: GOTO " + (programLineNumber - 30) + "\n"; // 70 (GOTO 40)
        programLineNumber += 10;
        sb += programLineNumber + " REM Continue\n"; // 80

        // Data line generation
        let currentDataLine = dataLineNumber + " DATA ";
        let pairCount = 0;

        for (let i = 0; i < this.grabacion.length; i++) {
            const n = this.grabacion[i];
            let P = 0;  // Pitch (99 for pause)
            let D = 0;  // Duration

            if (n.frecuencia > 0) {
                // Calculation for BEEP (Note)
                let durSeg = n.duracionMs / 1000.0;
                let freqHz = Math.max(20.0, n.frecuencia);
                let semitones = 12.0 * (Math.log(freqHz / 440.0) / Math.log(2.0)) + 69.0;
                P = Math.round(semitones - 69.0);
                P = Math.max(-60, Math.min(60, P));
                D = durSeg.toFixed(3);
            } else {
                // Calculation for PAUSE 
                // *** P is now 99 (PAUSE_DATA_MARKER) ***
                P = PAUSE_DATA_MARKER; 
                let durFrames = Math.round(n.duracionMs / 20.0);
                D = Math.max(1, Math.min(MAX_FRAME_DURATION, durFrames));
            }

            const dataChunk = P + "," + D + ",";
            currentDataLine += dataChunk;
            pairCount++;

            if (pairCount === PAIRS_PER_LINE) {
                // Remove the trailing comma and add the DATA line
                sb += currentDataLine.slice(0, -1) + "\n";
                dataLineNumber += 10;
                currentDataLine = dataLineNumber + " DATA ";
                pairCount = 0;
            }
        }

        // Add the last DATA line if it is not complete
        if (pairCount > 0) {
            sb += currentDataLine.slice(0, -1) + "\n";
            dataLineNumber += 10;
        }

        // End marker
        sb += dataLineNumber + " DATA -99,0\n";
            
    } else {
        // Line by line export logic (unchanged)
        this.logToConsole("Exporting to ZX line by line (BEEP/PAUSE Format)...");
        let linea = LINEA_PROGRAMA_INICIO;

        for (let i = 0; i < this.grabacion.length; i++) {
            const n = this.grabacion[i];

            if (n.frecuencia > 0) {
                const durSeg = n.duracionMs / 1000.0;
                const freqHz = Math.max(20.0, n.frecuencia);
                const semitones = 12.0 * (Math.log(freqHz / 440.0) / Math.log(2.0)) + 69.0;
                const pitch = Math.round(semitones - 69.0);
                sb += linea + " BEEP " + durSeg.toFixed(3) + "," + pitch + "\n";
            } else {
                let durFrames = Math.round(n.duracionMs / 20.0);
                durFrames = Math.max(1, Math.min(MAX_FRAME_DURATION, durFrames));
                sb += linea + " PAUSE " + durFrames + "\n";
            }
            linea += 10;
        }
    }
    // End of main code
    sb += LINEA_FIN + " STOP\n";

    // Show the actual exported file name
    if (guardarArchivoComo(sb, fileName)) {
        this.logToConsole("File " + fileName + " generated successfully.");
    } else {
        this.logToConsole("ERROR exporting ZX Spectrum. Check the browser console.");
    }
};

/**
 * NEW: Adds listeners for the virtual keyboard to work on click or touch.
 */
Piano.prototype.setupVirtualKeyboardListeners = function() {
    var self = this;
    var keys = document.querySelectorAll('#keyboard .key');
    
    keys.forEach(function(keyElement) {
        var noteKey = keyElement.getAttribute('data-code'); // The key code (e.g., 'KeyA')

        // Only map keys that have an assigned frequency
        if (!self.frecuenciaPorTecla.hasOwnProperty(noteKey)) {
             return; 
        }

        // --- MOUSE DOWN (equivalent to keydown) ---
        keyElement.addEventListener('mousedown', function(event) {
            event.preventDefault(); 
            // Simulate event.repeat = false
            if (self.osciladoresActivos.hasOwnProperty(noteKey)) return;

            keyElement.classList.add('pressed');
            self.tocarNota(noteKey);
            self.updateUIStatus();
        });

        // --- MOUSE UP (equivalent to keyup) ---
        keyElement.addEventListener('mouseup', function(event) {
            keyElement.classList.remove('pressed');
            if (self.tiempoInicioPulsacion.hasOwnProperty(noteKey)) {
                self.detenerYGrabarNota(noteKey);
                self.updateUIStatus();
            }
        });
        
        // --- MOUSE OUT (stop sound if released outside the key) ---
        keyElement.addEventListener('mouseout', function(event) {
            if (self.tiempoInicioPulsacion.hasOwnProperty(noteKey) && keyElement.classList.contains('pressed')) {
                keyElement.classList.remove('pressed');
                self.detenerYGrabarNota(noteKey);
                self.updateUIStatus();
            }
        });
        
        // --- TOUCH EVENTS for mobile support ---
        keyElement.addEventListener('touchstart', function(event) {
             event.preventDefault(); 
             // IMPORTANT: Avoid adding 'pressed' here since the :active pseudo-class in CSS handles the visual
             // The JS is only needed to manage the sound state and prevent accidental repeats.
             
             if (self.osciladoresActivos.hasOwnProperty(noteKey)) return;
             
             // Although :active helps visually, we need the JS class to manage the release on touchend
             keyElement.classList.add('pressed');
             
             self.tocarNota(noteKey);
             self.updateUIStatus();
        });
        
        keyElement.addEventListener('touchend', function(event) {
             event.preventDefault();
             keyElement.classList.remove('pressed');
             if (self.tiempoInicioPulsacion.hasOwnProperty(noteKey)) {
                 self.detenerYGrabarNota(noteKey);
                 self.updateUIStatus();
             }
        });
    });
};


document.addEventListener('DOMContentLoaded', function() {
    // Piano initialization and DATA/READ checkbox handling
    var logArea = document.getElementById('log-area');
    // ID CORRECTION: "export-as-data"
    var checkbox = document.getElementById('export-as-data');
    var fileInput = document.getElementById('file-input');
    
    if (logArea) {
        window.piano = new Piano();
        
        // --- NEW: Initialize the virtual keyboard ---
        piano.setupVirtualKeyboardListeners(); 
        // ---------------------------------------------

        if (checkbox) {
            // Initialize state and add listener
            piano.setExportAsData(checkbox.checked);
            // The listener is already in the HTML, no need to duplicate it here
        }

        // Handle MUS file loading
        if (fileInput) {
            fileInput.addEventListener('change', function() {
                piano.cargarMelodiaDesdeInput(this.files);
            });
        }

    } else {
        console.error("The element with id 'log-area' is required to initialize the piano.");
        // If there's no log-area, initialize without UI for console testing
        if (!window.piano) window.piano = new Piano(); 
    }
});
