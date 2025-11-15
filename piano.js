// Variable global para el contexto de audio
var audioContext;
// NOTA: El mapa de osciladores activos se gestiona dentro de la clase Piano

/**
 * Función para iniciar la reproducción de un tono usando Web Audio API.
 * Aplica el ATAQUE de volumen basado en los parámetros del instrumento.
 * @param {number} frecuencia - Frecuencia en Hz (0 para pausa, devuelve null).
 * @param {Object} instrument - Objeto que contiene los parámetros ADSR (attack, sustainLevel, type, release).
 * @returns {Object | null} Devuelve un objeto con el oscilador y el nodo Gain.
 */
function startBeep(frecuencia, instrument) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (frecuencia <= 0) {
        return null;
    }

    var oscillator = audioContext.createOscillator();
    var gainNode = audioContext.createGain(); // Nodo de control de volumen

    // Conexión
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Tipo de onda: Configurado por el instrumento
    oscillator.type = instrument.type; 
    oscillator.frequency.setValueAtTime(frecuencia, audioContext.currentTime);

    // Ataque (Attack): Sube el volumen basado en los parámetros del instrumento
    var now = audioContext.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    
    // Rampa hasta el Nivel de Sostenimiento (Sustain Level)
    gainNode.gain.linearRampToValueAtTime(instrument.sustainLevel, now + instrument.attack); 

    oscillator.start(now);

    // Devuelve el oscilador Y el nodo Gain
    return { osc: oscillator, gain: gainNode };
}

/**
 * Detiene un oscilador después de un tiempo específico (útil para reproducir melodías grabadas).
 * APLICA EL RELEASE del instrumento a partir de la duraciónMs grabada.
 * La promesa se resuelve después de durationMs para mantener la cadena de reproducción a tiempo.
 * @param {Object} audioNode - Objeto {osc: OscillatorNode, gain: GainNode}
 * @param {number} durationMs - Duración de la pulsación de tecla grabada (Tiempo de Sostenimiento).
 * @param {Object} instrument - Objeto que contiene los parámetros ADSR.
 * @returns {Promise<void>}
 */
function stopBeep(audioNode, durationMs, instrument) {
    if (audioNode && audioNode.osc) {
        // --- 1. PROGRAMACIÓN DE CAÍDA Y PARADA DEL SONIDO ---
        var durationSec = durationMs / 1000.0;
        var now = audioContext.currentTime;
        var releaseTime = instrument.release; // Tiempo de Release del instrumento

        // 1. Calcular el tiempo en segundos cuando la pulsación 'termina' (inicio del Release)
        var releaseStartTime = now + durationSec;
        
        // 2. Calcular el tiempo total de sonido (pulsación + release)
        var totalSoundTimeSec = durationSec + releaseTime; 
        
        // Aplicar el RELEASE: Rampa exponencial desde sustainLevel hasta cero
        audioNode.gain.gain.cancelScheduledValues(now);
        audioNode.gain.gain.setValueAtTime(instrument.sustainLevel, releaseStartTime); 
        audioNode.gain.gain.exponentialRampToValueAtTime(0.0001, now + totalSoundTimeSec); 
        
        // CRÍTICO: Programar la parada del oscilador usando Web Audio API (más fiable que setTimeout)
        audioNode.osc.stop(now + totalSoundTimeSec); 
        
        // --- 2. SINCRONIZACIÓN DE LA CADENA DE REPRODUCCIÓN ---
        return new Promise(function(resolve) {
            // CRÍTICO: Resolvemos la promesa después de la duración *grabada* (durationMs).
            // Esto permite que la siguiente nota o pausa comience a tiempo.
            setTimeout(resolve, durationMs); 
        });
    }
    return Promise.resolve();
}


/**
 * Función portable para guardar texto como un archivo en el navegador.
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
    // CRITICAL: Este valor ahora guarda el tiempo de *fin de pulsación* (no fin de sonido) de la última nota.
    this.tiempoDeUltimaNotaMs = 0; 
    this.ultimoArchivoProcesado = "SONG.MUS"; 
    
    // --- NEW: DATA/READ export state ---
    this.exportAsData = false; 

    // --- NEW: Version Constant ---
    this.VERSION = "1.04"; 

    // --- INSTRUMENT STATE ---
    this.instruments = this.initializeInstruments();
    this.instrumentIndex = 0; // Instrumento Inicial: Classic Piano

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
 * Método requerido para manejar el checkbox de exportación DATA/READ.
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
    // Solo actualizar si existen elementos en el DOM
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
 * Define los 15 instrumentos con sus parámetros de envolvente de volumen (ADSR simplificado).
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
    // [MODIFICACIÓN CRÍTICA]
    // Usamos event.code (código físico) en lugar de event.key (caracter).
    // Esto asegura que la nota se active independientemente de la distribución del teclado.

    // Teclas Blancas:
    var keysBlancasCode = [
        'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 
        'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Backslash' 
    ]; 
    var frecBlancas = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659, 698, 784];

    // --- CORRECCIÓN CRÍTICA: Se eliminó KeyI de la lista de códigos ---
    var keysNegrasCode = [
        'KeyW', 'KeyE', 'KeyT', 'KeyY', 'KeyU', 
        'KeyO',           // NUEVO: Frecuencia de la antigua KeyI (554 Hz)
        'KeyP',           // NUEVO: Frecuencia de la antigua KeyO (622 Hz)
        'BracketRight'    // Frecuencia de la antigua KeyP (740 Hz)
    ];
    // Frecuencias correspondientes a las 8 teclas negras (se eliminó la frecuencia final)
    var frecNegras = [277, 311, 370, 415, 466, 554, 622, 740];

    var self = this;
    keysBlancasCode.forEach(function(key, i) { self.frecuenciaPorTecla[key] = frecBlancas[i]; });
    keysNegrasCode.forEach(function(key, i) { self.frecuenciaPorTecla[key] = frecNegras[i]; });
};

// ----------------------------------------------------------------------------------------------------------------

Piano.prototype.handleKeyDown = function(event) {
    // Usar event.code para notas (posiciones físicas)
    var noteKey = event.code; 
    // Usar event.key para comandos (caracteres)
    var commandKey = event.key.toLowerCase();
    
    if (this.isPlaying) {
        // --- CORRECCIÓN CRÍTICA: PARADA INMEDIATA ---
        this.cancelPlayback = true; 
        this.isPlaying = false; // Permite que la siguiente pulsación sea una nota/comando normal
        
        this.logToConsole("Playback cancelled by user.");
        this.updateUIStatus(); 
        
        event.preventDefault(); 
        return; 
    }

    // --- LÓGICA DE INSTRUMENTO (Z/X) ---
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

    if (this.frecuenciaPorTecla.hasOwnProperty(noteKey)) { // Buscar nota por CÓDIGO de tecla
        if (event.repeat) return;
        if (this.osciladoresActivos.hasOwnProperty(noteKey)) return;
        
        event.preventDefault();

        // --- NEW: Añadir clase 'pressed' al elemento visual ---
        var keyElement = document.querySelector('.key[data-code="' + noteKey + '"]');
        if (keyElement) {
            keyElement.classList.add('pressed');
        }
        // --------------------------------------------------------
        
        this.tocarNota(noteKey); // Pasar el CÓDIGO
        this.updateUIStatus();
    } else {
        // --- REGISTRO DE TECLAS NO MAPEADAS COMO COMANDOS ---
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
        
        // Procesar el comando (usa el caracter de la tecla: commandKey)
        this.handleCommand(commandKey);
    }
};

// ----------------------------------------------------------------------------------------------------------------

Piano.prototype.handleKeyUp = function(event) {
    // [MODIFICACIÓN CRÍTICA]
    // Usar event.code para detener la nota (debe coincidir con la tecla usada en handleKeyDown).
    var noteKey = event.code; 
    
    if (this.frecuenciaPorTecla.hasOwnProperty(noteKey)) { // <-- Usar noteKey (código) aquí
        event.preventDefault();
        
        // --- NEW: Eliminar clase 'pressed' del elemento visual ---
        var keyElement = document.querySelector('.key[data-code="' + noteKey + '"]');
        if (keyElement) {
            keyElement.classList.remove('pressed');
        }
        // --------------------------------------------------------

        if (this.tiempoInicioPulsacion.hasOwnProperty(noteKey)) {
            this.detenerYGrabarNota(noteKey); // <-- Pasar noteKey (código) a detenerYGrabarNota
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
 * Inicia la pulsación de una nota, aplica el ATAQUE y registra su hora de inicio.
 */
Piano.prototype.tocarNota = function(key) { // 'key' es ahora el 'code' (ej: 'KeyA')
    var tiempoPulsacionMs = Date.now();
    var freqBase = this.frecuenciaPorTecla[key]; // Búsqueda por code
    var freqFinal = Math.floor(freqBase * this.octavaFactor[this.indiceOctavaActual]);
    
    var currentInstrument = this.instruments[this.instrumentIndex];
    
    // 1. Iniciar el oscilador y guardarlo (pasar el instrumento para ADSR)
    var audioNode = startBeep(freqFinal, currentInstrument); 
    
    this.osciladoresActivos[key] = { freq: freqFinal, node: audioNode };
    this.tiempoInicioPulsacion[key] = tiempoPulsacionMs;
    
    // El log muestra el 'code' para debugging
    this.logToConsole("Note: " + key + " (" + freqFinal + " Hz) STARTED"); 
};

/**
 * Detiene la nota, aplica el RELEASE de volumen, calcula la duración y graba la nota/pausa.
 */
Piano.prototype.detenerYGrabarNota = function(key) { // 'key' es ahora el 'code' (ej: 'KeyA')
    var tiempoSoltarMs = Date.now();
    
    // 1. Detener el sonido con Release
    var notaActiva = this.osciladoresActivos[key];
    var currentInstrument = this.instruments[this.instrumentIndex];

    if (notaActiva && notaActiva.node) {
        var audioNode = notaActiva.node;
        var now = audioContext.currentTime;
        var releaseTime = currentInstrument.release; 
        
        // Aplica el RELEASE de volumen
        audioNode.gain.gain.cancelScheduledValues(now); 
        audioNode.gain.gain.setValueAtTime(audioNode.gain.gain.value, now); 
        audioNode.gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);

        // FIX CRÍTICO: Usar Web Audio API para programar la parada del oscilador.
        // Esto es mucho más fiable que el setTimeout de JavaScript.
        audioNode.osc.stop(now + releaseTime); // <-- **CORRECCIÓN DE ESTABILIDAD**

        delete this.osciladoresActivos[key];
    }

    // 2. Calcular duración y grabar
    var tiempoInicio = this.tiempoInicioPulsacion[key];
    
    if (tiempoInicio !== undefined && notaActiva) {
        var duracionMs = Math.max(1, tiempoSoltarMs - tiempoInicio); 
        var freqFinal = notaActiva.freq;
        
        this.grabarNotaYPausa(freqFinal, duracionMs, tiempoInicio, tiempoSoltarMs);
        delete this.tiempoInicioPulsacion[key];
    }
};

/**
 * Graba la pausa anterior y la nueva nota con su duración calculada.
 * Utiliza el tiempo de *fin de pulsación* (tiempoFinPulsacion) nuevamente para calcular la pausa,
 * asegurando que la velocidad de la melodía se mantenga fiel a la interpretación, independientemente del Release del instrumento.
 */
Piano.prototype.grabarNotaYPausa = function(freqFinal, duracionNotaMs, tiempoInicio, tiempoFinPulsacion) {
    var MIN_PAUSA_MS = 1.0; 
    
    // 1. Grabar la pausa (silencio entre la nota anterior y esta)
    if (this.tiempoDeUltimaNotaMs !== 0) {
        // La pausa es el tiempo desde que terminó la *pulsación* anterior (this.tiempoDeUltimaNotaMs) 
        // hasta que comenzó la *nueva nota* (tiempoInicio).
        var pausaMs = tiempoInicio - this.tiempoDeUltimaNotaMs;
        
        // Mantener esta lógica simple para respetar la velocidad de la interpretación.
        if (pausaMs > MIN_PAUSA_MS) {
            // Ajuste CRÍTICO: Reducir la pausa para que sea el 76% de la duración original (dividir por 1 / 0.76 = 1.315789).
            var PAUSE_REDUCTION_DIVISOR = 1.3157894736842106;
            var pausaReducidaMs = pausaMs / PAUSE_REDUCTION_DIVISOR; 

            this.grabacion.push({ frecuencia: 0, duracionMs: pausaReducidaMs });
            this.logToConsole("PAUSE recorded (reduced to 76%): " + pausaReducidaMs.toFixed(0) + " ms");
        } else if (pausaMs < -MIN_PAUSA_MS) {
             // Esto significa que la nueva nota fue pulsada mucho antes de que se soltara la anterior (solapamiento).
             this.logToConsole("Keystroke overlap (Chord/Legato).");
        }
    }
    
    // 2. Grabar la nueva nota (duración de la pulsación)
    this.grabacion.push({ frecuencia: freqFinal, duracionMs: duracionNotaMs });
    this.logToConsole("Note: " + freqFinal + " Hz recorded (" + duracionNotaMs + " ms)");
    
    // 3. Actualizar el tiempo de fin de la última nota grabada
    // CRÍTICO: Usar el tiempo de FIN DE PULSACIÓN (no fin de sonido) para calcular la siguiente pausa.
    this.tiempoDeUltimaNotaMs = tiempoFinPulsacion;
};

Piano.prototype.lockAndClearRecording = function() {
    this.grabacion = [];
    this.tiempoDeUltimaNotaMs = 0; 
    this.ultimoArchivoProcesado = "SONG.MUS"; 
    this.logToConsole("--- NEW MELODY / RECORDING CLEARED ---");
};

// Usar una función asíncrona (si el entorno lo soporta) o una promesa para simular async/await
Piano.prototype.reproducirGrabacion = function() {
    var self = this;
    
    if (this.grabacion.length === 0 || this.isPlaying) {
        this.logToConsole(this.isPlaying ? "Already playing." : "No notes recorded.");
        return;
    }
    
    this.isPlaying = true;
    this.cancelPlayback = false;
    this.logToConsole("--- START PLAYBACK (" + this.grabacion.length + " notes) ---"); 

    // Obtener el instrumento actual para la reproducción
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
            // startBeep solo realiza el ATAQUE. 
            var audioNode = startBeep(nota.frecuencia, currentInstrument); 
            // stopBeep: programa el release *en segundo plano* y devuelve una promesa 
            // que se resuelve al finalizar la duración grabada (durationMs).
            promise = stopBeep(audioNode, nota.duracionMs, currentInstrument);
        } else {
            promise = new Promise(function(resolve) {
                // Las pausas solo esperan la duración grabada.
                setTimeout(resolve, nota.duracionMs);
            });
        }
        
        promise.then(function() {
            // La siguiente nota/pausa se llama inmediatamente después de que termina el tiempo grabado.
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
" 1.04 (2025-11-14): Fix: Eliminated duplicate file loading when pressing [1].\n" +
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
        
        // La línea actual 'linea' se usará para rastrear el inicio de las líneas DATA
        let dataLineNumber = LINEA_DATA_INICIO;
        
        let currentDataLine = dataLineNumber + " DATA ";
        let pairCount = 0; // Contador de pares en la línea actual

        for (var i = 0; i < this.grabacion.length; i++) {
            var n = this.grabacion[i];
            var durEsc = Math.max(1, Math.round(n.duracionMs / 10.0)); 
            
            var pitch = 0;
            if (n.frecuencia > 0) {
                // Cálculo de Pitch para CPC
                pitch = Math.round(62500.0 / n.frecuencia);
                pitch = Math.max(1, Math.min(4095, pitch)); 
            } else {
                pitch = 1; // Un pitch bajo para SOUND 2,1,Dur: silencio (pausa)
            }
            
            var dataChunk = pitch + "," + durEsc + ",";

            // Control de límite de pares (10)
            if (pairCount >= PAIRS_PER_DATA_LINE) {
                // Terminar la línea DATA anterior y añadirla a sb
                sb += currentDataLine.slice(0, -1) + "\n";
                
                // Mover el número de línea al siguiente ordinal
                dataLineNumber += 10; 
                
                // Iniciar una nueva línea DATA
                currentDataLine = dataLineNumber + " DATA ";
                pairCount = 0;
            }
            
            currentDataLine += dataChunk;
            pairCount++;
        }
        
        // Añadir la última línea DATA si tiene contenido
        if (pairCount > 0) {
            sb += currentDataLine.slice(0, -1) + "\n";
            dataLineNumber += 10;
        }

        // Marcador de fin
        sb += dataLineNumber + " DATA -1, 0\n"; 
        
        // Usar la última línea generada para calcular el inicio del código final
        linea = dataLineNumber + 10;
        
        // --- CÓDIGO DE ESPERA DE TECLA ---
        sb += linea + " PRINT\"press a key\"\n";
        linea += 10;
        sb += linea + " WHILE INKEY$=\"\":WEND\n"; 
        linea += 10;
        sb += linea + " END\n"; 

    } else {
        this.logToConsole("Exporting to CPC line by line...");
        
        // El número de línea inicial para este bloque es 20
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
        
        // --- CÓDIGO DE ESPERA DE TECLA ---
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

    // --- 1. GENERAR LA CADENA PLAY COMPLETA ---
    for (var i = 0; i < this.grabacion.length; i++) {
        var n = this.grabacion[i];
        
        // Calcular el factor de duración L
        var pb_L_factor = Math.round(duracionL1Ms / n.duracionMs);
        pb_L_factor = Math.max(1, Math.min(64, pb_L_factor));

        play += "L" + pb_L_factor;

        if (n.frecuencia > 0) {
            // Calcular nota MIDI y convertir a nota PB
            var freqHz = Math.max(20.0, n.frecuencia);
            var midiNote = 12.0 * (Math.log(freqHz / 440.0) / Math.log(2.0)) + 69.0;
            var pbNote = Math.round(midiNote - 36.0);    

            pbNote = Math.max(1, Math.min(84, pbNote));
            
            play += "N" + pbNote;
        } else {
            // Pausa
            play += "P";    
        }
    }

    // --- 2. EXPORTAR SIEMPRE CON LÍNEAS (Bloque 'else' original) ---
    this.logToConsole("Exporting to PowerBASIC line by line (PLAY string).");
    
    var maxLen = 70;    
    var idx = 0;
    var firstPart = true;

    while (idx < play.length) {
        var len = Math.min(maxLen, play.length - idx);
        var part = play.substring(idx, idx + len);
        
        // Ajuste para evitar cortar un comando N, L o P a la mitad
        // Buscar el inicio de un comando al final de la parte
        var lastCommandStart = part.search(/[LNP]\d*$/); 
        
        if (lastCommandStart > 0 && (idx + lastCommandStart) < play.length) {
             // Si encontramos un comando incompleto al final, acortar la parte justo antes.
            len = lastCommandStart;
            part = play.substring(idx, idx + len);
        } else if (lastCommandStart === 0 && !firstPart) {
             // Si la línea empieza con un comando (ej: L64N60...), no lo cortamos.
             // Esto lo maneja automáticamente si la longitud es menor que maxLen.
        }
        
        if (firstPart) {
            sb += linea + " M$ = \"" + part + "\"\n";
            firstPart = false;
        } else {
            sb += linea + " M$ = M$ + \"" + part + "\"\n";
        }
        idx += part.length; // Usar part.length para la longitud real después del ajuste
        linea += 10;    
    }

    sb += linea + " PLAY M$\n";
    linea += 10;
    
    // --- Espera de tecla para que la ejecución no termine al instante (OPCIONAL) ---
    sb += linea + " PRINT \"Press a key to finish...\"\n";
    linea += 10;
    sb += linea + " WHILE INKEY$=\"\":WEND\n";
    linea += 10;
    // ------------------------------------------------------------------------------------

    sb += linea + " END\n";


    // --- 3. MENSAJE FINAL ESTANDARIZADO ---
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

    const LINEA_PROGRAMA_INICIO = 20;   // Línea donde comienza el programa principal
    const LINEA_DATA_INICIO = 90;       // Línea donde comienzan los datos
    const LINEA_FIN = 1000;             // Línea para STOP (si es necesario)
    const MAX_FRAME_DURATION = 32767;
    const PAIRS_PER_LINE = 8;         // Número de pares por línea DATA
    const PAUSE_DATA_MARKER = 99;     // <--- Marcador clave para PAUSE (99)

    // Inicialización de variables importantes
    let dataLineNumber = LINEA_DATA_INICIO;
    let programLineNumber = LINEA_PROGRAMA_INICIO;
    
    // Nombre de archivo de exportación (usado para el log)
    const fileName = "ZX.BAS";

    // ----------------------------------------------------
    // LÓGICA DE EXPORTACIÓN DATA/READ (Compacto y Rápido)
    // ----------------------------------------------------
    if (this.exportAsData) {
        this.logToConsole("Exporting to ZX with dynamic DATA/READ (8 pairs per line)...");

        // Programa principal con GOTO dinámico
        sb += programLineNumber + " REM Playback initialization\n"; // 20
        programLineNumber += 10;
        sb += programLineNumber + " RESTORE " + LINEA_DATA_INICIO + "\n"; // 30
        programLineNumber += 10;
        sb += programLineNumber + " READ P, D\n"; // 40 (PUNTO DE RETORNO)
        programLineNumber += 10;
        sb += programLineNumber + " IF P = -99 THEN STOP: REM End of data\n"; // 50
        programLineNumber += 10;
        // Línea 60: Si es PAUSE (99), ejecuta PAUSE y vuelve a 40 (READ)
        sb += programLineNumber + " IF P = " + PAUSE_DATA_MARKER + " THEN PAUSE D: GOTO " + (programLineNumber - 20) + "\n"; // 60 (GOTO 40)
        programLineNumber += 10;
        // Línea 70: Si es una nota, ejecuta BEEP y vuelve a 40 (READ)
        sb += programLineNumber + " BEEP D, P: GOTO " + (programLineNumber - 30) + "\n"; // 70 (GOTO 40)
        programLineNumber += 10;
        sb += programLineNumber + " REM Continue\n"; // 80

        // Generación de líneas de datos
        let currentDataLine = dataLineNumber + " DATA ";
        let pairCount = 0;

        for (let i = 0; i < this.grabacion.length; i++) {
            const n = this.grabacion[i];
            let P = 0;  // Pitch (99 para pausa)
            let D = 0;  // Duración

            if (n.frecuencia > 0) {
                // Cálculo para BEEP (Nota)
                let durSeg = n.duracionMs / 1000.0;
                let freqHz = Math.max(20.0, n.frecuencia);
                let semitones = 12.0 * (Math.log(freqHz / 440.0) / Math.log(2.0)) + 69.0;
                P = Math.round(semitones - 69.0);
                P = Math.max(-60, Math.min(60, P));
                D = durSeg.toFixed(3);
            } else {
                // Cálculo para PAUSE 
                // *** P ahora es 99 (PAUSE_DATA_MARKER) ***
                P = PAUSE_DATA_MARKER; 
                let durFrames = Math.round(n.duracionMs / 20.0);
                D = Math.max(1, Math.min(MAX_FRAME_DURATION, durFrames));
            }

            const dataChunk = P + "," + D + ",";
            currentDataLine += dataChunk;
            pairCount++;

            if (pairCount === PAIRS_PER_LINE) {
                // Eliminar la coma final y añadir la línea DATA
                sb += currentDataLine.slice(0, -1) + "\n";
                dataLineNumber += 10;
                currentDataLine = dataLineNumber + " DATA ";
                pairCount = 0;
            }
        }

        // Añadir la última línea DATA si no está completa
        if (pairCount > 0) {
            sb += currentDataLine.slice(0, -1) + "\n";
            dataLineNumber += 10;
        }

        // Marcador de fin
        sb += dataLineNumber + " DATA -99,0\n";
            
    } else {
        // Lógica de exportación línea por línea (sin cambios)
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
    // Fin del código principal
    sb += LINEA_FIN + " STOP\n";

    // Mostrar el nombre de archivo real exportado
    if (guardarArchivoComo(sb, fileName)) {
        this.logToConsole("File " + fileName + " generated successfully.");
    } else {
        this.logToConsole("ERROR exporting ZX Spectrum. Check the browser console.");
    }
};

/**
 * NEW: Añade listeners para que el teclado virtual funcione al hacer clic o tocar.
 */
Piano.prototype.setupVirtualKeyboardListeners = function() {
    var self = this;
    var keys = document.querySelectorAll('#keyboard .key');
    
    keys.forEach(function(keyElement) {
        var noteKey = keyElement.getAttribute('data-code'); // El código de tecla (ej: 'KeyA')

        // Solo mapear teclas que tienen una frecuencia asignada
        if (!self.frecuenciaPorTecla.hasOwnProperty(noteKey)) {
             return; 
        }

        // --- MOUSE DOWN (equivalente a keydown) ---
        keyElement.addEventListener('mousedown', function(event) {
            event.preventDefault(); 
            // Simular event.repeat = false
            if (self.osciladoresActivos.hasOwnProperty(noteKey)) return;

            keyElement.classList.add('pressed');
            self.tocarNota(noteKey);
            self.updateUIStatus();
        });

        // --- MOUSE UP (equivalente a keyup) ---
        keyElement.addEventListener('mouseup', function(event) {
            keyElement.classList.remove('pressed');
            if (self.tiempoInicioPulsacion.hasOwnProperty(noteKey)) {
                self.detenerYGrabarNota(noteKey);
                self.updateUIStatus();
            }
        });
        
        // --- MOUSE OUT (detener sonido si se suelta fuera de la tecla) ---
        keyElement.addEventListener('mouseout', function(event) {
            if (self.tiempoInicioPulsacion.hasOwnProperty(noteKey) && keyElement.classList.contains('pressed')) {
                keyElement.classList.remove('pressed');
                self.detenerYGrabarNota(noteKey);
                self.updateUIStatus();
            }
        });
        
        // --- TOUCH EVENTS para soporte móvil ---
        keyElement.addEventListener('touchstart', function(event) {
             event.preventDefault(); 
             // IMPORTANTE: Evitar añadir 'pressed' aquí ya que la pseudo-clase :active en CSS maneja el visual
             // El JS solo es necesario para manejar el estado del sonido y prevenir repeticiones accidentales.
             
             if (self.osciladoresActivos.hasOwnProperty(noteKey)) return;
             
             // Aunque :active ayuda visualmente, necesitamos la clase JS para manejar el release en touchend
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
    // Inicialización del Piano y manejo del checkbox de DATA/READ
    var logArea = document.getElementById('log-area');
    // ID CORRECCIÓN: "export-as-data"
    var checkbox = document.getElementById('export-as-data');
    var fileInput = document.getElementById('file-input');
    
    if (logArea) {
        window.piano = new Piano();
        
        // --- NEW: Inicializar el teclado virtual ---
        piano.setupVirtualKeyboardListeners(); 
        // ---------------------------------------------

        if (checkbox) {
            // Inicializar el estado y añadir el listener
            piano.setExportAsData(checkbox.checked);
            // El listener ya está en el HTML, no es necesario duplicarlo aquí
        }

        // Manejar la carga de archivos MUS
        if (fileInput) {
            // ESTE ES EL LISTENER CORRECTO QUE SE MANTIENE (SOLUCIONA LA DUPLICIDAD)
            fileInput.addEventListener('change', function() {
                piano.cargarMelodiaDesdeInput(this.files);
            });
        }

    } else {
        console.error("The element with id 'log-area' is required to initialize the piano.");
        // Si no hay log-area, inicializar sin UI para pruebas de consola
        if (!window.piano) window.piano = new Piano(); 
    }
});
