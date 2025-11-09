//
// --- BITÁCORA DE VERSIONES ---
//
// v1.0 (2025-11-09): 
// - Implementación inicial.
// - Funcionalidad básica de tocar notas con Web Audio API.
// - Grabación de notas y pausas con duración dinámica (tiempo real).
// - Reproducción de la melodía grabada.
// - Comandos de control de octava, borrado, carga/guardado (.MUS).
// - Exportación a Amstrad CPC, PowerBASIC, y ZX Spectrum BASIC.
//
// v1.1 (2025-11-10):
// - Añadido el comando [8] para la exportación a MIDI (.MID) usando la librería midi-writer-js.
// - Añadida la visualización de la versión en la interfaz HTML.
// - Corregido el manejo de la tecla [M] para mostrar la ayuda.
//
// v1.3 (2025-11-10):
// - Eliminado el comando [7] (Fijar Duración Predeterminada) para simplificar la interfaz.
// - Consolidación de funciones de control de UI y comandos.
//
// v1.4 (2025-11-10):
// - Versión actualizada tras la integración final de la exportación MIDI y las mejoras de UI.
//
// -----------------------------
//
var MELOD8_VERSION = "1.4"; // Identificador de la versión actual

// Variable global para el contexto de audio
var audioContext;
// Mapa para seguir los osciladores que suenan (ya que la detención ahora es manual)
var osciladoresActivos = {}; // Usamos un objeto simple como mapa en ES5

/**
 * Función para iniciar la reproducción de un tono usando Web Audio API.
 * NO detiene el oscilador automáticamente.
 * @param {number} frecuencia - Frecuencia en Hz (0 para pausa, devuelve null).
 * @returns {OscillatorNode | null} Devuelve el objeto OscillatorNode o null si es pausa.
 */
function startBeep(frecuencia) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (frecuencia <= 0) {
        return null; 
    }

    var oscillator = audioContext.createOscillator();
    oscillator.type = 'square'; 
    oscillator.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(frecuencia, audioContext.currentTime);
    oscillator.start();

    return oscillator; // Devuelve el oscilador para que pueda ser detenido después
}

/**
 * Detiene un oscilador después de un tiempo específico (útil para reproducción de melodías grabadas).
 * @param {OscillatorNode} oscillator - El oscilador a detener.
 * @param {number} duracionMs - Duración después de la cual se detiene.
 * @returns {Promise<void>}
 */
function stopBeep(oscillator, duracionMs) {
    if (oscillator) {
        return new Promise(function(resolve) {
             setTimeout(function() {
                try {
                    oscillator.stop();
                } catch (e) {
                    // Puede fallar si ya se detuvo
                }
                resolve();
            }, duracionMs);
        });
    }
    return Promise.resolve();
}


/**
 * Función portátil para guardar contenido (texto o binario) como un archivo.
 * @param {string | ArrayBuffer} contenido - El contenido del archivo.
 * @param {string} nombreArchivo - El nombre que tendrá el archivo descargado.
 * @param {string} [mimeType] - MIME type del contenido. Por defecto 'text/plain'.
 * @returns {boolean}
 */
function guardarArchivoComo(contenido, nombreArchivo, mimeType) {
    mimeType = mimeType || 'text/plain;charset=utf-8';
    try {
        // Para ArrayBuffer (como el que genera la librería MIDI), se necesita el constructor Blob
        var blob = new Blob([contenido], { type: mimeType });
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
        console.error("Error al guardar el archivo:", e);
        return false;
    }
}


function Piano() {
    this.frecuenciaPorTecla = {}; // Usamos objeto para el mapa de notas
    this.grabacion = []; 
    this.octavaFactor = [0.25, 0.5, 1.0, 2.0, 4.0];
    this.indiceOctavaActual = 2; 
    this.duracionPredeterminadaMs = 150; 
    this.isPlaying = false;
    this.cancelPlayback = false;
    this.tiempoDeUltimaNotaMs = 0; 
    this.ultimoArchivoProcesado = "CANCION.MUS"; 
    
    // --- PROPIEDADES NUEVAS para Duración Dinámica ---
    // Almacena el tiempo de inicio de la pulsación de cada tecla
    this.tiempoInicioPulsacion = {}; // Usamos objeto simple
    // Almacena el oscilador activo para cada tecla que está sonando
    this.osciladoresActivos = {}; // Usamos objeto simple

    this.logArea = document.getElementById('log-area');

    this.inicializarMapasDeNotas();
    this.updateUIStatus();
    // 1. Mostrar la versión en el log
    this.logToConsole("Sistema MELOD8 v" + MELOD8_VERSION + " inicializado. Pulsa una tecla de nota o un comando.");
    
    // Se usa .bind(this) para mantener el contexto de la clase
    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    window.addEventListener('keyup', this.handleKeyUp.bind(this));
}

// --- MÉTODOS DE LA CLASE PIANO ---

Piano.prototype.logToConsole = function(texto) {
    var timestamp = new Date().toLocaleTimeString('es-ES');
    var line = "[" + timestamp + "] " + texto + "\n";
    this.logArea.textContent += line;
    this.logArea.scrollTop = this.logArea.scrollHeight;
};

Piano.prototype.updateUIStatus = function() {
    // 2. Mostrar la versión en el HTML
    document.getElementById('app-version').textContent = "(v" + MELOD8_VERSION + ")";
    document.getElementById('octave-factor').textContent = "x" + this.octavaFactor[this.indiceOctavaActual].toFixed(2);
    document.getElementById('note-count').textContent = this.grabacion.length;
    document.getElementById('duration-ms').textContent = this.duracionPredeterminadaMs; 
    document.getElementById('file-name').textContent = this.ultimoArchivoProcesado; 
};

Piano.prototype.inicializarMapasDeNotas = function() {
    var keysBlancas = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ', 'º', '-', 'ç'];
    var frecBlancas = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659, 698, 784, 880];

    var keysNegras = ['w', 'e', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'];
    var frecNegras = [277, 311, 370, 415, 466, 554, 622, 740, 831, 932];

    var self = this;
    keysBlancas.forEach(function(key, i) { self.frecuenciaPorTecla[key] = frecBlancas[i]; });
    keysNegras.forEach(function(key, i) { self.frecuenciaPorTecla[key] = frecNegras[i]; });
};

Piano.prototype.handleKeyDown = function(event) {
    var key = event.key.toLowerCase();
    
    if (this.isPlaying) {
        this.logToConsole("Reproduccion cancelada por el usuario.");
        this.cancelPlayback = true;
        this.updateUIStatus(); 
        return;
    }

    if (this.frecuenciaPorTecla.hasOwnProperty(key)) {
        // Previene el auto-repetición del teclado
        if (event.repeat) return;
        // Previene tocar dos veces si la nota ya está sonando
        if (this.osciladoresActivos.hasOwnProperty(key)) return;
        
        event.preventDefault();
        this.tocarNota(key); 
        this.updateUIStatus();
    } else {
        this.handleCommand(key);
    }
};

Piano.prototype.handleKeyUp = function(event) {
    var key = event.key.toLowerCase();
    
    if (this.frecuenciaPorTecla.hasOwnProperty(key)) {
        event.preventDefault();
        // Solo procesa si la tecla fue efectivamente presionada y registrada
        if (this.tiempoInicioPulsacion.hasOwnProperty(key)) {
            this.detenerYGrabarNota(key); 
            this.updateUIStatus();
        }
    }
};

Piano.prototype.handleCommand = function(key) {
    if (key === '0') {
        this.lockAndClearRecording();
    } else if (key === '1') {
        this.logToConsole("Abriendo diálogo para Cargar melodía (.MUS)...");
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
    } else if (key === '8') { // NUEVO: Comando MIDI
        this.generarYGuardarMidi(); 
    } else if (key === ',') {
        this.changeOctave(-1);
    } else if (key === '.') {
        this.changeOctave(1);
    } else if (key === 'm') {
        this.mostrarAyudaCompleta();
    } else if (key === 'escape') {
        this.logToConsole("Aplicacion finalizada.");
    }
    this.updateUIStatus();
};

/**
 * Inicia la pulsación de una nota y registra su tiempo de inicio.
 */
Piano.prototype.tocarNota = function(key) {
    var tiempoPulsacionMs = Date.now();
    var freqBase = this.frecuenciaPorTecla[key];
    var freqFinal = Math.floor(freqBase * this.octavaFactor[this.indiceOctavaActual]);
    
    // 1. Inicia el oscilador y lo guarda
    var oscillator = startBeep(freqFinal); 
    this.osciladoresActivos[key] = { freq: freqFinal, osc: oscillator };
    
    // 2. Registra el tiempo de inicio
    this.tiempoInicioPulsacion[key] = tiempoPulsacionMs;
    
    this.logToConsole("Nota: " + key.toUpperCase() + " (" + freqFinal + " Hz) INICIADA");
};

/**
 * Detiene la nota, calcula la duración y graba la nota/pausa.
 */
Piano.prototype.detenerYGrabarNota = function(key) {
    var tiempoSoltarMs = Date.now();
    
    // 1. Detener el sonido (
