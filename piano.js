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
// - Eliminado el comando [7] (Fijar Duración Predeterminada).
// - Corregido el manejo de la tecla [M] para mostrar la ayuda.
// - Añadido el comando [8] para la exportación real a MIDI (.MID) usando la librería midi-writer-js.
//
// -----------------------------
//
var MELOD8_VERSION = "1.1"; // Identificador de la versión actual

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
    
    // 1. Detener el sonido (si está activo)
    var notaActiva = this.osciladoresActivos[key];
    if (notaActiva && notaActiva.osc) {
        try {
            // Detenemos inmediatamente al soltar la tecla
            notaActiva.osc.stop(); 
        } catch (e) {
            // Ya se detuvo
        }
        delete this.osciladoresActivos[key];
    }

    // 2. Calcular la duración y grabar
    var tiempoInicio = this.tiempoInicioPulsacion[key];
    
    if (tiempoInicio !== undefined && notaActiva) {
        // Duracion de la pulsacion. Asegura que sea al menos 1ms.
        var duracionMs = Math.max(1, tiempoSoltarMs - tiempoInicio); 
        var freqFinal = notaActiva.freq;
        
        this.grabarNotaYPausa(freqFinal, duracionMs, tiempoInicio);
        delete this.tiempoInicioPulsacion[key];
    }
};

/**
 * Graba la pausa anterior y la nueva nota con su duración calculada.
 */
Piano.prototype.grabarNotaYPausa = function(freqFinal, duracionNotaMs, tiempoInicio) {
    var MIN_PAUSA_MS = 20.0;
    
    // 1. Grabar la pausa (silencio entre la nota anterior y esta)
    if (this.tiempoDeUltimaNotaMs !== 0) {
        // El inicio de la nueva pulsación (tiempoInicio) menos el fin de la nota anterior (this.tiempoDeUltimaNotaMs)
        var pausaMs = tiempoInicio - this.tiempoDeUltimaNotaMs;
        
        if (pausaMs > MIN_PAUSA_MS) {
            this.grabacion.push({ frecuencia: 0, duracionMs: pausaMs });
            this.logToConsole("PAUSA grabada (" + pausaMs.toFixed(0) + " ms)");
        }
    }
    
    // 2. Grabar la nueva nota
    this.grabacion.push({ frecuencia: freqFinal, duracionMs: duracionNotaMs });
    this.logToConsole("Nota: " + freqFinal + " Hz grabada (" + duracionNotaMs + " ms)");
    
    // 3. Actualizar el tiempo de fin de la última nota grabada
    this.tiempoDeUltimaNotaMs = tiempoInicio + duracionNotaMs;
};

Piano.prototype.lockAndClearRecording = function() {
    this.grabacion = [];
    this.tiempoDeUltimaNotaMs = 0; 
    this.ultimoArchivoProcesado = "CANCION.MUS";
    this.logToConsole("--- NUEVA MELODIA / GRABACION BORRADA ---");
};

// Se usa una función asíncrona (si el entorno lo soporta) o una promesa para simular el async/await
Piano.prototype.reproducirGrabacion = function() {
    var self = this;
    
    if (this.grabacion.length === 0 || this.isPlaying) {
        this.logToConsole(this.isPlaying ? "Ya se esta reproduciendo." : "No hay notas grabadas.");
        return;
    }
    
    this.isPlaying = true;
    this.cancelPlayback = false;
    this.logToConsole("--- INICIO REPRODUCCION (" + this.grabacion.length + " notas) ---"); 

    function playNext(index) {
        if (index >= self.grabacion.length || self.cancelPlayback) {
            self.isPlaying = false;
            self.cancelPlayback = false;
            self.logToConsole("--- FIN REPRODUCCION ---");
            self.updateUIStatus();
            return;
        }

        var nota = self.grabacion[index];
        var promise;

        if (nota.frecuencia > 0) {
            var oscillator = startBeep(nota.frecuencia);
            promise = stopBeep(oscillator, nota.duracionMs);
        } else {
            promise = new Promise(function(resolve) {
                setTimeout(resolve, nota.duracionMs);
            });
        }
        
        promise.then(function() {
            playNext(index + 1);
        });
    }

    playNext(0);
};

Piano.prototype.changeOctave = function(delta) {
    var newIndex = this.indiceOctavaActual + delta;
    if (newIndex >= 0 && newIndex < this.octavaFactor.length) {
        this.indiceOctavaActual = newIndex;
        this.logToConsole("Octava cambiada. Factor: " + this.octavaFactor[this.indiceOctavaActual].toFixed(2));
    }
};

Piano.prototype.eliminarPausasFinales = function() {
    while (this.grabacion.length > 0 && this.grabacion[this.grabacion.length - 1].frecuencia === 0) {
        this.grabacion.pop();
    }
};

Piano.prototype.mostrarAyudaCompleta = function() {
    var helpText = "\n" +
"COMANDOS DE GRABACION Y REPRODUCCION:\n" +
" [0]: Borrar melodia actual.\n" +
" [1]: Cargar melodia desde un archivo (.MUS).\n" +
" [2]: Guardar melodia a un archivo (.MUS).\n" +
" [3]: Reproducir la melodia grabada (Pulsa cualquier tecla para parar).\n" +
"\n" +
"COMANDOS DE EXPORTACION:\n" +
" [4]: Generar código Amstrad CPC BASIC (.BAS).\n" +
" [5]: Generar string PowerBASIC PLAY (.BAS).\n" +
" [6]: Generar código ZX Spectrum BASIC BEEP/PAUSE (.BAS).\n" +
" [8]: Exportar a MIDI (.MID).\n" + // Ayuda actualizada
"\n" +
"COMANDOS DE CONFIGURACION:\n" +
" [,]: Bajar la octava.\n" +
" [.]: Subir la octava.\n" +
" [M]: Mostrar esta ayuda (se pulsa la tecla 'm').\n";
    this.logToConsole("------------------- AYUDA COMPLETA -------------------");
    this.logToConsole(helpText);
    this.logToConsole("----------------- FIN AYUDA COMPLETA -----------------");
};

// --- CARGA Y GUARDADO DE ARCHIVOS (.MUS) ---

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
        self.logToConsole("ERROR leyendo el archivo: " + file.name);
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
        this.logToConsole("ADVERTENCIA: Se ignoraron " + errores + " líneas con formato incorrecto.");
    }

    if (nuevaGrabacion.length > 0) {
        this.grabacion = nuevaGrabacion;
        this.ultimoArchivoProcesado = nombreArchivo;
        this.tiempoDeUltimaNotaMs = 0; 
        this.logToConsole("Archivo " + nombreArchivo + " cargado correctamente (" + this.grabacion.length + " notas).");
    } else {
        this.logToConsole("ERROR: Archivo " + nombreArchivo + " no contiene notas válidas.");
    }
    this.updateUIStatus();
};

Piano.prototype.guardarMelodiaAArchivo = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) {
        this.logToConsole("No hay notas para guardar.");
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
        this.logToConsole("Melodia guardada como " + nombre + ".");
    } else {
        this.logToConsole("ERROR al guardar el archivo.");
    }
};


// --- FUNCIONES DE EXPORTACIÓN ---

/**
 * Función auxiliar para convertir una frecuencia (Hz) a un número de nota MIDI.
 * N = 69 + 12 * log2(f / 440)
 * @param {number} freqHz - Frecuencia en Hercios.
 * @returns {number} Número de nota MIDI (0-127).
 */
function freqToMidiNote(freqHz) {
    if (freqHz <= 0) return 0; 
    
    // Calcula la nota MIDI, redondeando al entero más cercano (temperamento igual)
    var midiNote = 69 + 12 * (Math.log(freqHz / 440.0) / Math.log(2.0));
    
    return Math.max(1, Math.min(127, Math.round(midiNote)));
}


Piano.prototype.generarYGuardarMidi = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) { 
        this.logToConsole("No hay notas grabadas para exportar a MIDI."); 
        return; 
    }

    // Comprueba si la librería MidiWriter.js está disponible
    if (typeof MidiWriter === 'undefined') {
        this.logToConsole("ERROR: La librería midi-writer-js no está cargada. Asegúrate de incluirla en index.html.");
        return;
    }
    
    var TEMPO_BPM = 120; // Tempo predeterminado
    var VELOCITY = 100; // Volumen (0-127)
    var TPB = 480;      // Ticks Per Beat (por defecto en midi-writer-js)
    var MS_PER_TICK = (60000 / TEMPO_BPM) / TPB; // ms por tick

    var writer = new MidiWriter.Writer();
    var track = new MidiWriter.Track();

    // 1. Configurar el Tempo (obligatorio para calcular ticks correctamente)
    track.setTempo(TEMPO_BPM);
    
    for (var i = 0; i < this.grabacion.length; i++) {
        var n = this.grabacion[i];
        
        // Conversión de Duración (ms) a Ticks (T)
        // Math.round asegura que la duración se cuantice al tick más cercano
        var durationTicks = Math.max(1, Math.round(n.duracionMs / MS_PER_TICK));
        
        // El formato de duración para eventos arbitrarios de midi-writer-js es T<ticks>
        var durationT = 'T' + durationTicks.toFixed(0); 
        
        if (n.frecuencia > 0) {
            var midiNote = freqToMidiNote(n.frecuencia);
            
            // Crea un evento de nota (NoteOn y NoteOff combinados)
            var noteEvent = new MidiWriter.NoteEvent({ 
                pitch: [midiNote], 
                duration: durationT,
                velocity: VELOCITY,
                sequential: false // No importa aquí
            });
            track.addEvent(noteEvent);
            
            this.logToConsole("MIDI: Nota " + midiNote + " (" + n.frecuencia.toFixed(0) + " Hz) añadida.");
        } else {
            // Añadir una pausa (Rest)
            var rest = new MidiWriter.EventTypes.Rest(durationT);
            track.addEvent(rest);
            this.logToConsole("MIDI: Pausa de " + n.duracionMs.toFixed(0) + " ms añadida.");
        }
    }
    
    writer.addTrack(track);
    
    // Obtener los datos binarios (ArrayBuffer)
    var binaryData = writer.buildArrayBuffer();
    
    var nombre = this.ultimoArchivoProcesado.replace(".MUS", "") + ".MID";

    if (guardarArchivoComo(binaryData, nombre, 'audio/midi')) {
        this.logToConsole("Archivo MIDI binario REAL guardado como " + nombre + " (Tempo: " + TEMPO_BPM + " BPM).");
    } else {
        this.logToConsole("ERROR exportando MIDI. Revisa la consola del navegador.");
    }
};

Piano.prototype.generarYGuardarAmstradBasic = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }

    var sb = "10 REM MELOD8 v" + MELOD8_VERSION + " by fitosoft AMSTRAD CPC BASIC\n"; 
    var linea = 20;

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

    if (guardarArchivoComo(sb, "cpc.bas")) {
        this.logToConsole("Archivo cpc.bas generado correctamente (Ajuste de duracion CPC aplicado).");
    } else {
        this.logToConsole("ERROR exportando Amstrad. Revisa la consola del navegador.");
    }
};

Piano.prototype.generarYGuardarPbString = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }
    
    var FILENAME = "MELOD8.BAS";
    var sb = "10 REM MELOD8 v" + MELOD8_VERSION + " by fitosoft POWERBASIC EXPORT\n"; 
    var linea = 20;
    var play = "T255"; 
    var duracionL1Ms = 900.0; 

    for (var i = 0; i < this.grabacion.length; i++) {
        var n = this.grabacion[i];
        var pb_L_factor = Math.round(duracionL1Ms / n.duracionMs);
        pb_L_factor = Math.max(1, Math.min(64, pb_L_factor));

        play += "L" + pb_L_factor;

        if (n.frecuencia > 0) {
            var freqHz = Math.max(20.0, n.frecuencia);
            var midiNote = 12.0 * (Math.log(freqHz / 440.0) / Math.log(2.0)) + 69.0;
            var pbNote = Math.round(midiNote - 36.0); 

            pbNote = Math.max(1, Math.min(84, pbNote));
            
            play += "N" + pbNote;
        } else {
            play += "P"; 
        }
    }

    var maxLen = 70; 
    var idx = 0;
    var firstPart = true;

    while (idx < play.length) {
        var len = Math.min(maxLen, play.length - idx);
        var part = play.substring(idx, idx + len);
        
        var lastCommandEnd = part.search(/[LNP]\d+$/);
        if (lastCommandEnd > -1 && lastCommandEnd > 0) {
            len = lastCommandEnd;
            part = play.substring(idx, idx + len);
        }
        
        if (firstPart) {
            sb += linea + " M$ = \"" + part + "\"\n";
            firstPart = false;
        } else {
            sb += linea + " M$ = M$ + \"" + part + "\"\n";
        }
        idx += len;
        linea += 10; 
    }

    sb += linea + " PLAY M$\n";
    linea += 10;
    sb += linea + " END\n";

    if (guardarArchivoComo(sb, FILENAME)) {
        this.logToConsole("Archivo " + FILENAME + " generado correctamente (Ajustes de tempo y tono PowerBASIC).");
    } else {
        this.logToConsole("ERROR exportando PowerBASIC. Revisa la consola del navegador.");
    }
};

Piano.prototype.generarYGuardarZxBasic = function() {
    this.eliminarPausasFinales();
    
    if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }

    var sb = "10 REM MELOD8 v" + MELOD8_VERSION + " by fitosoft ZX BASIC\n"; 
    var linea = 20;
    var FRECUENCIA_DO_CENTRAL_ZX = 261.63; 

    for (var i = 0; i < this.grabacion.length; i++) {
        var n = this.grabacion[i];
        if (n.frecuencia > 0) {
            var durSeg = n.duracionMs / 1000.0;
            var freqHz = Math.max(20.0, n.frecuencia);
            
            var semitones = 12.0 * (Math.log(freqHz / FRECUENCIA_DO_CENTRAL_ZX) / Math.log(2.0));
            var pitch = Math.round(semitones);

            pitch = Math.max(-60, Math.min(60, pitch)); 

            sb += linea + " BEEP " + durSeg.toFixed(2) + "," + pitch + "\n"; 
        } else {
            var durFrames = Math.round(n.duracionMs / 20.0);
            durFrames = Math.max(1, Math.min(32767, durFrames)); 

            sb += linea + " PAUSE " + durFrames + "\n";
        }
        linea += 10;
    }

    if (guardarArchivoComo(sb, "ZX.BAS")) {
        this.logToConsole("Archivo ZX.BAS generado correctamente.");
    } else {
        this.logToConsole("ERROR exportando ZX Spectrum. Revisa la consola del navegador.");
    }
};


document.addEventListener('DOMContentLoaded', function() {
    window.piano = new Piano();
});
