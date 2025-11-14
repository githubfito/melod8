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
        // La inicialización del AudioContext debe ocurrir solo después de una interacción del usuario
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
    
    // Rampa hasta el nivel de sostenimiento (Sustain Level)
    gainNode.gain.linearRampToValueAtTime(instrument.sustainLevel, now + instrument.attack);

    oscillator.start(now);

    // Devuelve el oscilador Y el nodo Gain
    return { osc: oscillator, gain: gainNode };
}

/**
 * Detiene un oscilador después de un tiempo específico (útil para reproducción de melodías grabadas).
 * APLICA EL RELEASE DEL INSTRUMENTO a partir de la duracionMs grabada.
 * La promesa se resuelve después de duracionMs para mantener la cadena de reproducción a tiempo.
 * @param {Object} audioNode - Objeto {osc: OscillatorNode, gain: GainNode}
 * @param {number} duracionMs - Duración de la pulsación de tecla grabada (Sustain Time).
 * @param {Object} instrument - Objeto que contiene los parámetros ADSR.
 * @returns {Promise<void>}
 */
function stopBeep(audioNode, duracionMs, instrument) {
    if (audioNode && audioNode.osc) {
        // --- 1. PROGRAMACIÓN DEL DECAIMIENTO Y LA PARADA DEL SONIDO ---
        var durationSec = duracionMs / 1000.0;
        var now = audioContext.currentTime;
        var releaseTime = instrument.release; // Tiempo de release del instrumento

        // 1. Calculamos el tiempo en segundos en que la pulsación 'termina' (inicio del Release)
        var releaseStartTime = now + durationSec;
        
        // 2. Calculamos el tiempo total que sonará (pulsación + release)
        var totalSoundTimeSec = durationSec + releaseTime;
        var totalSoundTimeMs = duracionMs + (releaseTime * 1000);
        
        // Aplicar el RELEASE: Rampa exponencial de sustainLevel a cero
        audioNode.gain.gain.cancelScheduledValues(now);
        audioNode.gain.gain.setValueAtTime(instrument.sustainLevel, releaseStartTime);
        audioNode.gain.gain.exponentialRampToValueAtTime(0.0001, now + totalSoundTimeSec);
        
        // Detenemos el oscilador cuando el sonido ha decaído completamente (Esto corre en segundo plano)
        setTimeout(function() {
            try {
                audioNode.osc.stop();
            } catch (e) {
                // Ya se detuvo
            }
        }, totalSoundTimeMs);
        
        // --- 2. SINCRONIZACIÓN DE LA CADENA DE REPRODUCCIÓN ---
        return new Promise(function(resolve) {
            // CRÍTICO: Resolvemos la promesa después de la duración *grabada* (duracionMs).
            // Esto permite que la siguiente nota o pausa comience a tiempo.
            setTimeout(resolve, duracionMs);
        });
    }
    return Promise.resolve();
}


/**
 * Función portátil para guardar texto como un archivo en el navegador.
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
        console.error("Error al guardar el archivo:", e);
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
    // CRÍTICO: Este valor ahora almacena el tiempo de *fin de pulsación* (no fin de sonido) de la última nota.
    this.tiempoDeUltimaNotaMs = 0;
    this.ultimoArchivoProcesado = "CANCION.MUS";
    
    // --- NUEVO: Estado de exportación DATA/READ ---
    this.exportAsData = false;
    this.isVirtualKeyActive = false; // Bandera para evitar doble pulsación en teclas virtuales

    // --- ESTADO DEL INSTRUMENTO ---
    this.instruments = this.initializeInstruments();
    this.instrumentIndex = 0; // Instrumento inicial: Piano Clásico

    this.tiempoInicioPulsacion = {};
    this.osciladoresActivos = {};

    this.logArea = document.getElementById('log-area');
    this.instrumentNameDisplay = document.getElementById('instrument-name'); // Para actualizar UI

    this.inicializarMapasDeNotas();
    this.updateUIStatus();
    this.logToConsole("Sistema inicializado. Pulsa una tecla de nota o un comando.");
    this.logToConsole("Usando instrumento: " + this.instruments[this.instrumentIndex].name + " (Z/X para cambiar)");
    
    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    window.addEventListener('keyup', this.handleKeyUp.bind(this));
}

// --- MÉTODOS DE LA CLASE PIANO ---

/**
 * Método necesario para manejar el checkbox de exportación DATA/READ.
 */
Piano.prototype.setExportAsData = function(isChecked) {
    this.exportAsData = isChecked;
    this.logToConsole("Exportar como DATA/READ: " + (isChecked ? "ACTIVO" : "DESACTIVO"));
}

Piano.prototype.logToConsole = function(texto) {
    var timestamp = new Date().toLocaleTimeString('es-ES');
    var line = "[" + timestamp + "] " + texto + "\n";
    if (this.logArea) {
        this.logArea.textContent += line;
        this.logArea.scrollTop = this.logArea.scrollHeight;
    } else {
        console.log(line.trim());
    }
};

Piano.prototype.updateUIStatus = function() {
    var oe = document.getElementById('octave-factor');
    var nc = document.getElementById('note-count');
    var fn = document.getElementById('file-name');
    var iname = document.getElementById('instrument-name');

    if (oe) oe.textContent = "x" + this.octavaFactor[this.indiceOctavaActual].toFixed(2);
    if (nc) nc.textContent = this.grabacion.length;
    if (fn) fn.textContent = this.ultimoArchivoProcesado;
    if (iname) iname.textContent = this.instruments[this.instrumentIndex].name;
};

/**
 * Define los 15 instrumentos con sus parámetros de envolvente de volumen (ADSR simplificado).
 */
Piano.prototype.initializeInstruments = function() {
    return [
        // index 0
        { name: "Piano Clásico", type: "sine", attack: 0.01, sustainLevel: 0.7, release: 0.5 },
        // index 1
        { name: "Órgano de Jazz", type: "triangle", attack: 0.05, sustainLevel: 0.9, release: 0.1 },
        // index 2
        { name: "Sintetizador Fuerte", type: "sawtooth", attack: 0.005, sustainLevel: 0.8, release: 0.3 },
        // index 3
        { name: "Flauta Dulce", type: "triangle", attack: 0.04, sustainLevel: 0.6, release: 0.6 },
        // index 4
        { name: "Clavicordio Percusivo", type: "square", attack: 0.002, sustainLevel: 0.7, release: 0.2 },
        // index 5
        { name: "Bajo Profundo", type: "sine", attack: 0.01, sustainLevel: 1.0, release: 0.1 },
        // index 6
        { name: "Campana Metálica", type: "sine", attack: 0.001, sustainLevel: 0.1, release: 1.0 },
        // index 7
        { name: "Guitarra Eléctrica", type: "sawtooth", attack: 0.01, sustainLevel: 0.6, release: 0.4 },
        // index 8
        { name: "Pluck Digital (Pizzicato)", type: "triangle", attack: 0.001, sustainLevel: 0.4, release: 0.3 },
        // index 9
        { name: "Trompeta Clásica", type: "sawtooth", attack: 0.1, sustainLevel: 0.7, release: 0.3 },
        // index 10
        { name: "Silbato", type: "sine", attack: 0.05, sustainLevel: 0.9, release: 0.5 },
        // index 11
        { name: "Marimba/Xilófono", type: "triangle", attack: 0.001, sustainLevel: 0.6, release: 0.5 },
        // index 12
        { name: "Armónica (Rough)", type: "square", attack: 0.1, sustainLevel: 0.6, release: 0.2 },
        // index 13
        { name: "Piano Oscuro", type: "sine", attack: 0.02, sustainLevel: 0.4, release: 0.8 },
        // index 14
        { name: "Sintetizador Bass Lead", type: "sawtooth", attack: 0.03, sustainLevel: 0.9, release: 0.1 }
    ];
};

Piano.prototype.inicializarMapasDeNotas = function() {
    // Mapeo por event.code (código físico) para asegurar la compatibilidad QWERTY/AZERTY
    
    // Blancas: C, D, E, F, G, A, B, C', D', E', F', G'
    var keysBlancasCode = [
        'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 
        'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Backslash' 
    ]; 
    var frecBlancas = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659, 698, 784];

    // Negras: C#, D#, F#, G#, A#, C#' , D#'
    var keysNegrasCode = [
        'KeyW', 'KeyE', 'KeyT', 'KeyY', 'KeyU', 
        'KeyI', 'KeyO', 'KeyP', 'OemOpenBrackets' 
    ];
    var frecNegras = [277, 311, 370, 415, 466, 554, 622, 740, 831];

    var self = this;
    keysBlancasCode.forEach(function(key, i) { self.frecuenciaPorTecla[key] = frecBlancas[i]; });
    keysNegrasCode.forEach(function(key, i) { self.frecuenciaPorTecla[key] = frecNegras[i]; });
};

// --- TECLADO VIRTUAL: MOUSE EVENTS ---
Piano.prototype.inicializarTecladoVirtual = function() {
    var teclasVirtuales = document.querySelectorAll('#piano-teclado .tecla');
    var self = this;

    teclasVirtuales.forEach(function(tecla) {
        var noteKey = tecla.getAttribute('data-code');

        // Manejar MOUSE DOWN (inicio de nota)
        tecla.addEventListener('mousedown', function(event) {
            event.preventDefault(); 
            // Si la nota ya está activa por ratón o teclado, la ignoramos.
            if (self.osciladoresActivos.hasOwnProperty(noteKey)) return;
            
            this.classList.add('tocado'); 
            self.tocarNota(noteKey);
            self.updateUIStatus();
        });

        // Manejar MOUSE UP o MOUSE LEAVE (fin de nota)
        var stopNoteHandler = function(event) {
            // Solo actuar si la nota estaba activa por la pulsación del ratón
            // Comprobamos si hay un tiempo de inicio, que significa que la nota está sonando
            if (self.tiempoInicioPulsacion.hasOwnProperty(noteKey)) {
                
                tecla.classList.remove('tocado'); 
                self.detenerYGrabarNota(noteKey); 
                self.updateUIStatus();
            }
        };

        tecla.addEventListener('mouseup', stopNoteHandler);
        tecla.addEventListener('mouseleave', stopNoteHandler); 
    });
    
    this.logToConsole("Teclado virtual inicializado.");
};

// ---

Piano.prototype.handleKeyDown = function(event) {
    var noteKey = event.code;
    var commandKey = event.key.toLowerCase();
    
    // Si la reproducción está activa, cualquier tecla la cancela
    if (this.isPlaying) {
        this.cancelPlayback = true;
        this.isPlaying = false;
        this.logToConsole("Reproduccion cancelada por el usuario.");
        this.updateUIStatus();
        event.preventDefault();
        return;
    }

    // LÓGICA DE INSTRUMENTO (Z/X)
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

    // LÓGICA DE NOTA (hacer sonar la nota)
    if (this.frecuenciaPorTecla.hasOwnProperty(noteKey)) {
        if (event.repeat) return;
        if (this.osciladoresActivos.hasOwnProperty(noteKey)) return;
        
        event.preventDefault();
        
        // Añadir estilo visual si existe la tecla virtual
        var teclaVirtual = document.querySelector('[data-code="' + noteKey + '"]');
        if (teclaVirtual) teclaVirtual.classList.add('tocado');

        this.tocarNota(noteKey);
        this.updateUIStatus();
    } else {
        // LÓGICA DE COMANDO
        this.handleCommand(commandKey);
    }
};

Piano.prototype.handleKeyUp = function(event) {
    var noteKey = event.code;
    
    if (this.frecuenciaPorTecla.hasOwnProperty(noteKey)) {
        event.preventDefault();
        
        // Quitar estilo visual
        var teclaVirtual = document.querySelector('[data-code="' + noteKey + '"]');
        if (teclaVirtual) teclaVirtual.classList.remove('tocado');

        if (this.tiempoInicioPulsacion.hasOwnProperty(noteKey)) {
            this.detenerYGrabarNota(noteKey);
            this.updateUIStatus();
        }
    }
};

// ... (Resto de métodos de la clase Piano) ...
// (changeInstrument, handleCommand, lockAndClearRecording, etc. se mantienen)

Piano.prototype.changeInstrument = function(delta) {
    var totalInstruments = this.instruments.length;
    var newIndex = (this.instrumentIndex + delta + totalInstruments) % totalInstruments;
    this.instrumentIndex = newIndex;
    var instrumentName = this.instruments[newIndex].name;
    this.logToConsole("Usando instrumento: " + instrumentName + " (Índice " + (newIndex + 1) + "/" + totalInstruments + ")");
    this.updateUIStatus();
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
        this.generarYGuardarPbString(); // Placeholder para PowerBASIC
    } else if (key === '6') {
        this.generarYGuardarZxBasic(); // Placeholder para ZX Spectrum
    } else if (key === '7') {
        this.generarYGuardarMsxBasic(); // MSX
    } else if (key === '8') {
        this.generarYGuardarC64Basic(); // C64
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


Piano.prototype.tocarNota = function(key) {
    var tiempoPulsacionMs = Date.now();
    var freqBase = this.frecuenciaPorTecla[key];
    var freqFinal = Math.floor(freqBase * this.octavaFactor[this.indiceOctavaActual]);
    
    var currentInstrument = this.instruments[this.instrumentIndex];
    
    // 1. Inicia el oscilador y lo guarda (pasa el instrumento para el ADSR)
    var audioNode = startBeep(freqFinal, currentInstrument);
    
    this.osciladoresActivos[key] = { freq: freqFinal, node: audioNode };
    this.tiempoInicioPulsacion[key] = tiempoPulsacionMs;
    
    this.logToConsole("Nota: " + key + " (" + freqFinal + " Hz) INICIADA");
};

Piano.prototype.detenerYGrabarNota = function(key) {
    var tiempoSoltarMs = Date.now();
    
    // 1. Detener el sonido con Release
    var notaActiva = this.osciladoresActivos[key];
    var currentInstrument = this.instruments[this.instrumentIndex];

    if (notaActiva && notaActiva.node) {
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
                // Ya se detuvo
            }
        }, releaseTime * 1000);

        delete this.osciladoresActivos[key];
    }

    // 2. Calcular la duración y grabar
    var tiempoInicio = this.tiempoInicioPulsacion[key];
    
    if (tiempoInicio !== undefined && notaActiva) {
        var duracionMs = Math.max(1, tiempoSoltarMs - tiempoInicio);
        var freqFinal = notaActiva.freq;
        
        this.grabarNotaYPausa(freqFinal, duracionMs, tiempoInicio, tiempoSoltarMs);
        delete this.tiempoInicioPulsacion[key];
    }
};

Piano.prototype.grabarNotaYPausa = function(freqFinal, duracionNotaMs, tiempoInicio, tiempoFinPulsacion) {
    var MIN_PAUSA_MS = 1.0;
    
    // 1. Grabar la pausa (silencio entre la nota anterior y esta)
    if (this.tiempoDeUltimaNotaMs !== 0) {
        var pausaMs = tiempoInicio - this.tiempoDeUltimaNotaMs;
        
        if (pausaMs > MIN_PAUSA_MS) {
            // Ajuste CRÍTICO: Reducimos la pausa para que quede el 76% de la duración original
            var PAUSE_REDUCTION_DIVISOR = 1.3157894736842106;
            var pausaReducidaMs = pausaMs / PAUSE_REDUCTION_DIVISOR;

            this.grabacion.push({ frecuencia: 0, duracionMs: pausaReducidaMs });
            this.logToConsole("PAUSA grabada (reducida al 76%): " + pausaReducidaMs.toFixed(0) + " ms");
        } else if (pausaMs < -MIN_PAUSA_MS) {
             this.logToConsole("Superposicion de pulsacion (Chord/Legato).");
        }
    }
    
    // 2. Grabar la nueva nota (duración de la pulsación)
    this.grabacion.push({ frecuencia: freqFinal, duracionMs: duracionNotaMs });
    this.logToConsole("Nota: " + freqFinal + " Hz grabada (" + duracionNotaMs + " ms)");
    
    // 3. Actualizar el tiempo de fin de la última nota grabada
    this.tiempoDeUltimaNotaMs = tiempoFinPulsacion;
};

Piano.prototype.lockAndClearRecording = function() {
    this.grabacion = [];
    this.tiempoDeUltimaNotaMs = 0;
    this.ultimoArchivoProcesado = "CANCION.MUS";
    this.logToConsole("--- NUEVA MELODIA / GRABACION BORRADA ---");
};

// ... (El resto de métodos de Carga/Guardado de .MUS se mantienen) ...

Piano.prototype.guardarMelodiaAArchivo = function() {
    this.eliminarPausasFinales();
    if (this.grabacion.length === 0) {
        this.logToConsole("No hay notas grabadas para guardar.");
        return;
    }

    var contenido = "";
    this.grabacion.forEach(function(nota) {
        contenido += nota.frecuencia + "," + nota.duracionMs.toFixed(0) + "\n";
    });

    var fileName = prompt("Nombre del archivo (sin extensión):", this.ultimoArchivoProcesado.replace(".MUS", ""));
    if (fileName) {
        this.ultimoArchivoProcesado = fileName.toUpperCase().replace(/[^A-Z0-9]/g, "") + ".MUS";
        if (guardarArchivoComo(contenido, this.ultimoArchivoProcesado)) {
            this.logToConsole("Melodía guardada como " + this.ultimoArchivoProcesado + ".");
        }
    }
    this.updateUIStatus();
};

Piano.prototype.reproducirGrabacion = function() {
    var self = this;
    
    if (this.grabacion.length === 0 || this.isPlaying) {
        this.logToConsole(this.isPlaying ? "Ya se esta reproduciendo." : "No hay notas grabadas.");
        return;
    }
    
    this.isPlaying = true;
    this.cancelPlayback = false;
    this.logToConsole("--- INICIO REPRODUCCION (" + this.grabacion.length + " notas) ---"); 

    var currentInstrument = self.instruments[self.instrumentIndex];

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
            var audioNode = startBeep(nota.frecuencia, currentInstrument);
            promise = stopBeep(audioNode, nota.duracionMs, currentInstrument);
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
"COMANDOS DE EXPORTACION (Generan archivos BASIC):\n" +
" [4]: Amstrad CPC BASIC (SOUND)\n" +
" [7]: MSX BASIC (SOUND/PAUSE)\n" +
" [8]: Commodore 64 BASIC (POKE SID)\n" +
" [Checkbox 'DATA/READ']: Exporta como lineas DATA/READ para codigo mas compacto.\n" +
"\n" +
"COMANDOS DE CONFIGURACION:\n" +
" [Z/X]: Cambiar el instrumento (total " + this.instruments.length + ").\n" +
" [,]: Bajar la octava.\n" +
" [.]: Subir la octava.\n" +
" [M]: Mostrar esta ayuda (se pulsa la tecla 'm').\n";
    this.logToConsole("------------------- AYUDA COMPLETA -------------------");
    this.logToConsole(helpText);
    this.logToConsole("----------------- FIN AYUDA COMPLETA -----------------");
};

// ... (El resto de métodos de Carga/Parseo se mantienen) ...

// --- EXPORTACIÓN A BASIC ---

// Placeholder para PowerBASIC y ZX Spectrum (manteniendo los comandos 5 y 6 libres)
Piano.prototype.generarYGuardarPbString = function() { this.logToConsole("Comando [5] reservado para PowerBASIC."); };
Piano.prototype.generarYGuardarZxBasic = function() { this.logToConsole("Comando [6] reservado para ZX Spectrum."); };

// --- 4. AMSTRAD CPC BASIC ---
Piano.prototype.generarYGuardarAmstradBasic = function() {
    this.eliminarPausasFinales();
    if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }
    // ... (Lógica de Amstrad CPC SOUND) ...
    var sb = "10 REM MELOD8 by fitosoft AMSTRAD CPC BASIC\n"; 
    var linea = 20;
    const fileName = "cpc.bas"; 
    const PAIRS_PER_DATA_LINE = 10;
    
    if (this.exportAsData) {
        this.logToConsole("Exportando a CPC con DATA/READ...");
        const LINEA_DATA_INICIO = 100;
        sb += "20 REM Inicializacion de reproduccion\n";
        sb += "30 RESTORE " + LINEA_DATA_INICIO + ": DIM D(2): REM D(1)=Pitch, D(2)=Duration\n";
        sb += "40 FOR I = 1 TO " + this.grabacion.length + "\n";
        sb += "50 READ D(1), D(2)\n";
        sb += "60 IF D(1) = -1 THEN END: REM Final de datos\n";
        sb += "70 SOUND 2,D(1),D(2)\n";
        sb += "80 NEXT I\n";
        let dataLineNumber = LINEA_DATA_INICIO;
        let currentDataLine = dataLineNumber + " DATA ";
        let pairCount = 0;

        for (var i = 0; i < this.grabacion.length; i++) {
            var n = this.grabacion[i];
            var durEsc = Math.max(1, Math.round(n.duracionMs / 10.0));
            var pitch = 0;
            if (n.frecuencia > 0) {
                pitch = Math.round(62500.0 / n.frecuencia);
                pitch = Math.max(1, Math.min(4095, pitch));
            } else { pitch = 1; }
            var dataChunk = pitch + "," + durEsc + ",";
            if (pairCount >= PAIRS_PER_DATA_LINE) {
                sb += currentDataLine.slice(0, -1) + "\n";
                dataLineNumber += 10;
                currentDataLine = dataLineNumber + " DATA ";
                pairCount = 0;
            }
            currentDataLine += dataChunk;
            pairCount++;
        }
        if (pairCount > 0) { sb += currentDataLine.slice(0, -1) + "\n"; dataLineNumber += 10; }
        sb += dataLineNumber + " DATA -1, 0\n";
        linea = dataLineNumber + 10;
        sb += linea + " PRINT\"pulsa una tecla\"\n"; linea += 10;
        sb += linea + " WHILE INKEY$=\"\":WEND\n"; linea += 10;
        sb += linea + " END\n";
    } else {
        this.logToConsole("Exportando a CPC linea por linea...");
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
        sb += linea + " PRINT\"pulsa una tecla\"\n"; linea += 10;
        sb += linea + " WHILE INKEY$=\"\":WEND\n"; linea += 10;
        sb += linea + " END\n";
    }
    if (guardarArchivoComo(sb, fileName)) { this.logToConsole("Código Amstrad BASIC preparado para guardar."); }
};

// --- 7. MSX BASIC ---
Piano.prototype.generarYGuardarMsxBasic = function() {
    this.eliminarPausasFinales();
    if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }
    
    var sb = "10 REM MELOD8 by fitosoft MSX BASIC (SOUND/PAUSE)\n"; 
    var linea = 20;
    const fileName = "msx.bas"; 
    const MSX_TICK_DURATION_MS = 1000.0 / 60.0;
    const PAIRS_PER_DATA_LINE = 10;

    if (this.exportAsData) {
        this.logToConsole("Exportando a MSX con DATA/READ...");
        const LINEA_DATA_INICIO = 100;
        sb += "20 REM Inicializacion de reproduccion\n";
        sb += "30 RESTORE " + LINEA_DATA_INICIO + ": DIM D(2): REM D(1)=Frecuencia, D(2)=Duracion\n";
        sb += "40 FOR I = 1 TO " + this.grabacion.length + "\n";
        sb += "50 READ D(1), D(2)\n";
        sb += "60 IF D(1) = -1 THEN END: REM Final de datos\n";
        sb += "70 IF D(1) = 0 THEN PAUSE D(2) ELSE SOUND 1,D(1),D(2),10\n";
        sb += "80 NEXT I\n";
        let dataLineNumber = LINEA_DATA_INICIO;
        let currentDataLine = dataLineNumber + " DATA ";
        let pairCount = 0;

        for (var i = 0; i < this.grabacion.length; i++) {
            var n = this.grabacion[i];
            var durEsc = Math.max(1, Math.round(n.duracionMs / MSX_TICK_DURATION_MS)); 
            var freqOrZero = (n.frecuencia > 0) ? n.frecuencia : 0;
            var dataChunk = freqOrZero + "," + durEsc + ",";

            if (pairCount >= PAIRS_PER_DATA_LINE) {
                sb += currentDataLine.slice(0, -1) + "\n";
                dataLineNumber += 10;
                currentDataLine = dataLineNumber + " DATA ";
                pairCount = 0;
            }
            currentDataLine += dataChunk;
            pairCount++;
        }
        if (pairCount > 0) { sb += currentDataLine.slice(0, -1) + "\n"; dataLineNumber += 10; }
        sb += dataLineNumber + " DATA -1, 0\n"; 
        linea = dataLineNumber + 10;
        sb += linea + " PRINT\"pulsa una tecla\"\n"; linea += 10;
        sb += linea + " A$=INPUT$(1)\n"; linea += 10;
        sb += linea + " END\n"; 

    } else {
        this.logToConsole("Exportando a MSX linea por linea...");
        linea = 20;
        for (var i = 0; i < this.grabacion.length; i++) {
            var n = this.grabacion[i];
            var durEsc = Math.max(1, Math.round(n.duracionMs / MSX_TICK_DURATION_MS)); 
            if (n.frecuencia === 0) {
                sb += linea + " PAUSE " + durEsc + "\n"; 
            } else {
                sb += linea + " SOUND 1," + Math.round(n.frecuencia) + "," + durEsc + ",10\n";
            }
            linea += 10;
        }
        sb += linea + " PRINT\"pulsa una tecla\"\n"; linea += 10;
        sb += linea + " A$=INPUT$(1)\n"; linea += 10;
        sb += linea + " END\n"; 
    }

    if (guardarArchivoComo(sb, fileName)) { this.logToConsole("Código MSX BASIC preparado para guardar."); }
};

// --- 8. COMMODORE 64 BASIC ---
Piano.prototype.generarYGuardarC64Basic = function() {
    this.eliminarPausasFinales();
    if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }
    
    var sb = "10 REM MELOD8 by fitosoft COMMODORE 64 BASIC (POKE SID)\n"; 
    var linea = 20;
    const fileName = "c64.bas"; 
    const ADDR_FREQ_LO = 54272;
    const ADDR_FREQ_HI = 54273;
    const ADDR_CONTROL = 54276;
    const ADDR_VOLUME = 54296;
    const WAVEFORM_ON = 33;
    const WAVEFORM_OFF = 32;
    const CLOCK_FREQ_SID = 985248.0;
    const SID_CALC_FACTOR = 16777216.0 / CLOCK_FREQ_SID;
    const LOOP_FACTOR = 10; 
    const PAIRS_PER_DATA_LINE = 8; // Menos pares por línea para mantener la longitud de línea de C64

    // CÓDIGO DE INICIALIZACIÓN
    sb += "20 POKE " + ADDR_VOLUME + ",15: REM Max Volume\n";
    sb += "30 FOR L=" + ADDR_FREQ_LO + " TO " + ADDR_VOLUME + ":POKE L,0:NEXT: REM Clean SID\n";
    linea = 40;

    if (this.exportAsData) {
        this.logToConsole("Exportando a C64 con DATA/READ...");
        const LINEA_DATA_INICIO = 100;
        sb += "40 REM Inicializacion de reproduccion\n";
        sb += "50 RESTORE " + LINEA_DATA_INICIO + ": DIM D(3)\n";
        sb += "60 FOR I = 1 TO " + this.grabacion.length + "\n";
        sb += "70 READ D(1), D(2), D(3)\n";
        sb += "80 IF D(1) = -1 THEN END\n";
        sb += "90 IF D(1)>0 OR D(2)>0 THEN POKE " + ADDR_FREQ_LO + ",D(1):POKE " + ADDR_FREQ_HI + ",D(2):POKE " + ADDR_CONTROL + "," + WAVEFORM_ON + "\n";
        sb += "100 FOR T=1 TO D(3):NEXT\n";
        sb += "110 IF D(1)>0 OR D(2)>0 THEN POKE " + ADDR_CONTROL + "," + WAVEFORM_OFF + "\n";
        sb += "120 NEXT I\n";
        
        let dataLineNumber = LINEA_DATA_INICIO;
        let currentDataLine = dataLineNumber + " DATA ";
        let pairCount = 0;

        for (var i = 0; i < this.grabacion.length; i++) {
            var n = this.grabacion[i];
            var durEsc = Math.max(1, Math.round(n.duracionMs / LOOP_FACTOR)); 
            var freqLO = 0;
            var freqHI = 0;
            
            if (n.frecuencia > 0) {
                var sidVal = Math.round(n.frecuencia * SID_CALC_FACTOR);
                sidVal = Math.min(65535, sidVal);
                freqLO = sidVal % 256;
                freqHI = Math.floor(sidVal / 256);
            }
            var dataChunk = freqLO + "," + freqHI + "," + durEsc + ",";

            if (pairCount >= PAIRS_PER_DATA_LINE) {
                sb += currentDataLine.slice(0, -1) + "\n";
                dataLineNumber += 10;
                currentDataLine = dataLineNumber + " DATA ";
                pairCount = 0;
            }
            currentDataLine += dataChunk;
            pairCount++;
        }
        
        if (pairCount > 0) { sb += currentDataLine.slice(0, -1) + "\n"; dataLineNumber += 10; }
        sb += dataLineNumber + " DATA -1, 0, 0\n"; 
        linea = dataLineNumber + 10;
        
        sb += linea + " PRINT\"Pulsa tecla\"\n"; linea += 10;
        sb += linea + " GET A$: IF A$=\"\" THEN " + linea + "\n"; linea += 10;
        sb += linea + " END\n"; 

    } else {
        this.logToConsole("Exportando a C64 linea por linea...");
        linea = 40;
        for (var i = 0; i < this.grabacion.length; i++) {
            var n = this.grabacion[i];
            var durEsc = Math.max(1, Math.round(n.duracionMs / LOOP_FACTOR)); 
            
            if (n.frecuencia === 0) {
                sb += linea + " FOR T=1 TO " + durEsc + ":NEXT\n"; 
            } else {
                var sidVal = Math.round(n.frecuencia * SID_CALC_FACTOR);
                sidVal = Math.min(65535, sidVal);
                var freqLO = sidVal % 256;
                var freqHI = Math.floor(sidVal / 256);

                sb += linea + " POKE " + ADDR_FREQ_LO + "," + freqLO + ": POKE " + ADDR_FREQ_HI + "," + freqHI + "\n";
                linea += 10;
                sb += linea + " POKE " + ADDR_CONTROL + "," + WAVEFORM_ON + "\n";
                linea += 10;
                sb += linea + " FOR T=1 TO " + durEsc + ":NEXT\n";
                linea += 10;
                sb += linea + " POKE " + ADDR_CONTROL + "," + WAVEFORM_OFF + "\n";
            }
            linea += 10;
        }
        sb += linea + " PRINT\"Pulsa tecla\"\n"; linea += 10;
        sb += linea + " GET A$: IF A$=\"\" THEN " + linea + "\n"; linea += 10;
        sb += linea + " END\n"; 
    }

    if (guardarArchivoComo(sb, fileName)) { this.logToConsole("Código C64 BASIC preparado para guardar."); }
};


// --- INICIALIZACIÓN FINAL ---
document.addEventListener('DOMContentLoaded', function() {
    var logArea = document.getElementById('log-area');
    var checkbox = document.getElementById('export-data-checkbox');
    var fileInput = document.getElementById('file-input');
    
    if (logArea) {
        window.piano = new Piano();
        
        // Inicializar Teclado Virtual
        piano.inicializarTecladoVirtual();
        
        if (checkbox) {
            piano.setExportAsData(checkbox.checked);
            checkbox.addEventListener('change', function() {
                piano.setExportAsData(this.checked);
            });
        }

        // Manejar la carga de archivos MUS
        if (fileInput) {
            fileInput.addEventListener('change', function() {
                piano.cargarMelodiaDesdeInput(this.files);
            });
        }

    } else {
        console.error("El elemento con id 'log-area' es necesario para inicializar el piano.");
        if (!window.piano) window.piano = new Piano();
    }
});
