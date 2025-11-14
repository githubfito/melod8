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

    // --- ESTADO DEL INSTRUMENTO ---
    this.instruments = this.initializeInstruments();
    this.instrumentIndex = 0; // Instrumento inicial: Piano Clásico

    this.tiempoInicioPulsacion = {}; 
    this.osciladoresActivos = {}; 

    this.logArea = document.getElementById('log-area');

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
    // Solo actualizar si los elementos existen en el DOM
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
        // index 8 - AJUSTADO: Se aumenta el sustainLevel a 0.4 para duplicar el volumen percibido.
        { name: "Pluck Digital (Pizzicato)", type: "triangle", attack: 0.001, sustainLevel: 0.4, release: 0.3 },
        // index 9
        { name: "Trompeta Clásica", type: "sawtooth", attack: 0.1, sustainLevel: 0.7, release: 0.3 },
        // index 10
        { name: "Silbato", type: "sine", attack: 0.05, sustainLevel: 0.9, release: 0.5 },
        // index 11 - AJUSTADO: Se aumenta el sustainLevel a 0.6 para duplicar el volumen percibido.
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
    // [MODIFICACIÓN CRÍTICA]
    // Usamos event.code (código físico) en lugar de event.key (carácter).
    // Esto asegura que la nota se active sin importar la distribución del teclado.

    // Correspondencia de posiciones (Teclado QWERTY estándar):
    // Blancas: 'a','s','d','f','g','h','j','k','l',';',''','#'
    // En el teclado español QWERTY: 'a','s','d','f','g','h','j','k','l','ñ','´','Ç'
    var keysBlancasCode = [
        'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 
        'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Backslash' 
    ]; 
    var frecBlancas = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659, 698, 784];

    // Negras: 'w','e', 't','y','u','i','o','p', '[' 
    // En el teclado español: 'w','e','t','y','u','i','o','p', '+'
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

// ... (Métodos anteriores se mantienen)

Piano.prototype.handleKeyDown = function(event) {
    // Usamos event.code para las notas (posiciones físicas)
    var noteKey = event.code; 
    // Usamos event.key para los comandos (caracteres)
    var commandKey = event.key.toLowerCase();
    
    if (this.isPlaying) {
        // --- CORRECCIÓN CRÍTICA: DETENCIÓN INMEDIATA ---
        this.cancelPlayback = true; 
        this.isPlaying = false; // Permite que la siguiente pulsación sea una nota/comando normal
        
        this.logToConsole("Reproduccion cancelada por el usuario.");
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

    if (this.frecuenciaPorTecla.hasOwnProperty(noteKey)) { // Busca la nota por el CÓDIGO de tecla
        if (event.repeat) return;
        if (this.osciladoresActivos.hasOwnProperty(noteKey)) return;
        
        event.preventDefault();
        this.tocarNota(noteKey); // Pasa el CÓDIGO
        this.updateUIStatus();
    } else {
        // --- REGISTRO DE TECLAS NO MAPEADAS COMO NOTAS ---
        if (commandKey.length === 1 || commandKey === 'escape') {
             this.logToConsole(
                 "Comando/Tecla no mapeada: Tecla='" + commandKey.toUpperCase() + 
                 "', Código='" + event.code + "'"
             );
        } else {
             this.logToConsole(
                 "Comando/Tecla no mapeada: Tecla='" + commandKey.toUpperCase() + 
                 "' (Code: " + event.code + ")"
             );
        }
        
        // Procesar el comando (usa el carácter de la tecla: commandKey)
        this.handleCommand(commandKey);
    }
};

// ... (El resto del código se mantiene)

// ----------------------------------------------------------------------------------------------------------------

Piano.prototype.handleKeyUp = function(event) {
    // [MODIFICACIÓN CRÍTICA]
    // Usamos event.code para detener la nota (debe coincidir con la clave usada en handleKeyDown).
    var noteKey = event.code; 
    
    if (this.frecuenciaPorTecla.hasOwnProperty(noteKey)) { // <-- Usamos noteKey (code) aquí
        event.preventDefault();
        if (this.tiempoInicioPulsacion.hasOwnProperty(noteKey)) {
            this.detenerYGrabarNota(noteKey); // <-- Pasamos noteKey (code) a detenerYGrabarNota
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
    this.logToConsole("Usando instrumento: " + instrumentName + " (Índice " + (newIndex + 1) + "/" + totalInstruments + ")");
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
 * Inicia la pulsación de una nota, aplica el ATTACK y registra su tiempo de inicio.
 */
// Modificar tocarNota para aceptar el 'code'
/**
 * Inicia la pulsación de una nota, aplica el ATTACK y registra su tiempo de inicio.
 */
Piano.prototype.tocarNota = function(key) { // 'key' ahora es el 'code' (ej: 'KeyA')
    var tiempoPulsacionMs = Date.now();
    var freqBase = this.frecuenciaPorTecla[key]; // Busca por code
    var freqFinal = Math.floor(freqBase * this.octavaFactor[this.indiceOctavaActual]);
    
    var currentInstrument = this.instruments[this.instrumentIndex];
    
    // 1. Inicia el oscilador y lo guarda (pasa el instrumento para el ADSR)
    var audioNode = startBeep(freqFinal, currentInstrument); 
    
    this.osciladoresActivos[key] = { freq: freqFinal, node: audioNode };
    this.tiempoInicioPulsacion[key] = tiempoPulsacionMs;
    
    // El log muestra el 'code' para depuración
    this.logToConsole("Nota: " + key + " (" + freqFinal + " Hz) INICIADA"); 
};

// Modificar detenerYGrabarNota para aceptar el 'code'
/**
 * Detiene la nota, aplica el RELEASE de volumen, calcula la duración y graba la nota/pausa.
 */
Piano.prototype.detenerYGrabarNota = function(key) { // 'key' ahora es el 'code' (ej: 'KeyA')
    var tiempoSoltarMs = Date.now();
    
    // 1. Detener el sonido con Release
    var notaActiva = this.osciladoresActivos[key];
    var currentInstrument = this.instruments[this.instrumentIndex];

    if (notaActiva && notaActiva.node) {
        // ... (lógica de RELEASE y setTimeout se mantiene igual)

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

/**
 * Graba la pausa anterior y la nueva nota con su duración calculada.
 * Vuelve a usar el tiempo de *fin de pulsación* (tiempoFinPulsacion) para calcular la pausa,
 * asegurando que la velocidad de la melodía se mantenga fiel a la interpretación,
 * independientemente del Release del instrumento.
 */
Piano.prototype.grabarNotaYPausa = function(freqFinal, duracionNotaMs, tiempoInicio, tiempoFinPulsacion) {
    var MIN_PAUSA_MS = 1.0; 
    
    // 1. Grabar la pausa (silencio entre la nota anterior y esta)
    if (this.tiempoDeUltimaNotaMs !== 0) {
        // La pausa es el tiempo desde que la *pulsación* anterior finalizó (this.tiempoDeUltimaNotaMs) 
        // hasta que la *nueva nota* empezó (tiempoInicio).
        var pausaMs = tiempoInicio - this.tiempoDeUltimaNotaMs;
        
        // Mantenemos esta lógica simple para respetar la velocidad de interpretación.
        if (pausaMs > MIN_PAUSA_MS) {
            // Ajuste CRÍTICO: Reducimos la pausa para que quede el 76% de la duración original (dividir por 1 / 0.76 = 1.315789).
            var PAUSE_REDUCTION_DIVISOR = 1.3157894736842106;
            var pausaReducidaMs = pausaMs / PAUSE_REDUCTION_DIVISOR; 

            this.grabacion.push({ frecuencia: 0, duracionMs: pausaReducidaMs });
            this.logToConsole("PAUSA grabada (reducida al 76%): " + pausaReducidaMs.toFixed(0) + " ms");
        } else if (pausaMs < -MIN_PAUSA_MS) {
             // Esto significa que la nueva nota se presionó mucho antes de soltar la anterior (superposición).
             this.logToConsole("Superposicion de pulsacion (Chord/Legato).");
        }
    }
    
    // 2. Grabar la nueva nota (duración de la pulsación)
    this.grabacion.push({ frecuencia: freqFinal, duracionMs: duracionNotaMs });
    this.logToConsole("Nota: " + freqFinal + " Hz grabada (" + duracionNotaMs + " ms)");
    
    // 3. Actualizar el tiempo de fin de la última nota grabada
    // CRÍTICO: Usamos el tiempo de fin de PULSACIÓN (no el tiempo de fin de sonido) para calcular la siguiente pausa.
    this.tiempoDeUltimaNotaMs = tiempoFinPulsacion;
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

    // Obtenemos el instrumento actual para la reproducción
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
            // startBeep solo hace el ATTACK. 
            var audioNode = startBeep(nota.frecuencia, currentInstrument); 
            // stopBeep: programa el release *en segundo plano* y devuelve una promesa 
            // que se resuelve al final de la duración grabada (duracionMs).
            promise = stopBeep(audioNode, nota.duracionMs, currentInstrument);
        } else {
            promise = new Promise(function(resolve) {
                // Las pausas solo esperan la duración grabada.
                setTimeout(resolve, nota.duracionMs);
            });
        }
        
        promise.then(function() {
            // Se llama a la siguiente nota/pausa inmediatamente después de que termina el tiempo grabado.
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
"COMANDOS DE EXPORTACION (Generan archivos BASIC):\n" +
" [4]: Generar código Amstrad CPC BASIC (.BAS).\n" +
" [5]: Generar string PowerBASIC PLAY (.BAS).\n" +
" [6]: Generar código ZX Spectrum BASIC BEEP/PAUSE (.BAS).\n" +
" [Checkbox 'Exportar como DATA/READ']: Exporta como lineas DATA/READ para codigo mas compacto (RECOMENDADO).\n" +
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


// --- FUNCIONES DE EXPORTACIÓN BASIC ---

Piano.prototype.generarYGuardarAmstradBasic = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }

    var sb = "10 REM MELOD8 by fitosoft AMSTRAD CPC BASIC\n"; 
    var linea = 20;
    const fileName = "cpc.bas"; 
    
    // --- NUEVA CONSTANTE ---
    const PAIRS_PER_DATA_LINE = 10;
    // -----------------------

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
        
        // La línea actual 'linea' se usará para rastrear el inicio de las líneas DATA
        let dataLineNumber = LINEA_DATA_INICIO;
        
        let currentDataLine = dataLineNumber + " DATA ";
        let pairCount = 0; // Contador de parejas en la línea actual

        for (var i = 0; i < this.grabacion.length; i++) {
            var n = this.grabacion[i];
            var durEsc = Math.max(1, Math.round(n.duracionMs / 10.0)); 
            
            var pitch = 0;
            if (n.frecuencia > 0) {
                // Cálculo del Pitch CPC
                pitch = Math.round(62500.0 / n.frecuencia);
                pitch = Math.max(1, Math.min(4095, pitch)); 
            } else {
                pitch = 1; // Un pitch bajo para SOUND 2,1,Dur: silencio (pausa)
            }
            
            var dataChunk = pitch + "," + durEsc + ",";

            // Control de límite de parejas (10)
            if (pairCount >= PAIRS_PER_DATA_LINE) {
                // Terminar la línea DATA anterior y añadirla a sb
                sb += currentDataLine.slice(0, -1) + "\n";
                
                // Mover el número de línea al siguiente ordinal
                dataLineNumber += 10; 
                
                // Empezar una nueva línea DATA
                currentDataLine = dataLineNumber + " DATA ";
                pairCount = 0;
            }
            
            currentDataLine += dataChunk;
            pairCount++;
        }
        
        // Agregar la última línea DATA si tiene contenido
        if (pairCount > 0) {
            sb += currentDataLine.slice(0, -1) + "\n";
            dataLineNumber += 10;
        }

        // Marcador de final
        sb += dataLineNumber + " DATA -1, 0\n"; 
        
        // Usamos la última línea generada para calcular el inicio del código final
        linea = dataLineNumber + 10;
        
        // --- CÓDIGO DE ESPERA DE TECLA ---
        sb += linea + " PRINT\"pulsa una tecla\"\n";
        linea += 10;
        sb += linea + " WHILE INKEY$=\"\":WEND\n"; 
        linea += 10;
        sb += linea + " END\n"; 

    } else {
        this.logToConsole("Exportando a CPC linea por linea...");
        
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
        sb += linea + " PRINT\"pulsa una tecla\"\n";
        linea += 10;
        sb += linea + " WHILE INKEY$=\"\":WEND\n"; 
        linea += 10;
        sb += linea + " END\n"; 
    }

    if (guardarArchivoComo(sb, fileName)) {
        this.logToConsole("Preparando para guardar archivo basic para Amstrad CPC"); 
    } else {
        this.logToConsole("ERROR exportando Amstrad. Revisa la consola del navegador.");
    }
};

Piano.prototype.generarYGuardarPbString = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }
    
    var FILENAME = "MELOD8.BAS";
    var sb = "10 REM MELOD8 by fitosoft POWERBASIC EXPORT\n";    
    var linea = 20;
    var play = "T255";    
    var duracionL1Ms = 900.0;    

    // --- 1. GENERACIÓN DEL STRING PLAY COMPLETO ---
    for (var i = 0; i < this.grabacion.length; i++) {
        var n = this.grabacion[i];
        
        // Cálculo del factor de duración L
        var pb_L_factor = Math.round(duracionL1Ms / n.duracionMs);
        pb_L_factor = Math.max(1, Math.min(64, pb_L_factor));

        play += "L" + pb_L_factor;

        if (n.frecuencia > 0) {
            // Cálculo de la nota MIDI y conversión a nota PB
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

    // --- 2. EXPORTACIÓN SIEMPRE CON LÍNEAS (Bloque 'else' del original) ---
    this.logToConsole("Exportando a PowerBASIC por líneas (PLAY string).");
    
    var maxLen = 70;    
    var idx = 0;
    var firstPart = true;

    while (idx < play.length) {
        var len = Math.min(maxLen, play.length - idx);
        var part = play.substring(idx, idx + len);
        
        // Ajuste para no cortar un comando N, L o P a la mitad
        // Busca el inicio de un comando al final de la parte
        var lastCommandStart = part.search(/[LNP]\d*$/); 
        
        if (lastCommandStart > 0 && (idx + lastCommandStart) < play.length) {
             // Si encontramos un comando incompleto al final, acortamos la parte hasta justo antes.
            len = lastCommandStart;
            part = play.substring(idx, idx + len);
        } else if (lastCommandStart === 0 && !firstPart) {
             // Si la línea empieza con un comando (ej: L64N60...), no la cortamos.
             // Esto se maneja automáticamente si la longitud es menor que maxLen.
        }
        
        if (firstPart) {
            sb += linea + " M$ = \"" + part + "\"\n";
            firstPart = false;
        } else {
            sb += linea + " M$ = M$ + \"" + part + "\"\n";
        }
        idx += part.length; // Usamos part.length para la longitud real después del ajuste
        linea += 10;    
    }

    sb += linea + " PLAY M$\n";
    linea += 10;
    
    // --- Espera de tecla para que no termine la ejecución instantáneamente (OPCIONAL) ---
    sb += linea + " PRINT \"Pulsa una tecla para finalizar...\"\n";
    linea += 10;
    sb += linea + " WHILE INKEY$=\"\":WEND\n";
    linea += 10;
    // ------------------------------------------------------------------------------------

    sb += linea + " END\n";


    // --- 3. MENSAJE FINAL ESTANDARIZADO ---
    if (guardarArchivoComo(sb, FILENAME)) {
        this.logToConsole("Preparando para guardar archivo basic para PowerBasic");
    } else {
        this.logToConsole("ERROR exportando PowerBASIC. Revisa la consola del navegador.");
    }
};

Piano.prototype.generarYGuardarZxBasic = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) {
        this.logToConsole("No hay notas para exportar.");
        return;
    }

    var sb = "10 REM MELOD8 by fitosoft ZX BASIC\n";

    const LINEA_PROGRAMA_INICIO = 20;   // Línea donde comienza el programa principal
    const LINEA_DATA_INICIO = 90;       // Línea donde comienzan los datos
    const LINEA_FIN = 1000;             // Línea para STOP (si es necesario)
    const MAX_FRAME_DURATION = 32767;
    const PAIRS_PER_LINE = 8;         // Número de pares por línea DATA
    const PAUSE_DATA_MARKER = 99;     // <--- Marcador clave para la PAUSA (99)

    // Inicialización de variables importantes
    let dataLineNumber = LINEA_DATA_INICIO;
    let programLineNumber = LINEA_PROGRAMA_INICIO;
    
    // Nombre del archivo de exportación (usado para el log)
    const fileName = "ZX.BAS";

    // ----------------------------------------------------
    // LÓGICA DE EXPORTACIÓN DATA/READ (Compacto y Rápido)
    // ----------------------------------------------------
    if (this.exportAsData) {
        this.logToConsole("Exportando a ZX con DATA/READ dinámico (8 pares por línea)...");

        // Programa principal con GOTO dinámico
        sb += programLineNumber + " REM Inicializacion de reproduccion\n"; // 20
        programLineNumber += 10;
        sb += programLineNumber + " RESTORE " + LINEA_DATA_INICIO + "\n"; // 30
        programLineNumber += 10;
        sb += programLineNumber + " READ P, D\n"; // 40 (PUNTO DE RETORNO)
        programLineNumber += 10;
        sb += programLineNumber + " IF P = -99 THEN STOP: REM Final de datos\n"; // 50
        programLineNumber += 10;
        // Línea 60: Si es PAUSA (99), hace PAUSE y vuelve a 40 (READ)
        sb += programLineNumber + " IF P = " + PAUSE_DATA_MARKER + " THEN PAUSE D: GOTO " + (programLineNumber - 20) + "\n"; // 60 (GOTO 40)
        programLineNumber += 10;
        // Línea 70: Si es nota, hace BEEP y vuelve a 40 (READ)
        sb += programLineNumber + " BEEP D, P: GOTO " + (programLineNumber - 30) + "\n"; // 70 (GOTO 40)
        programLineNumber += 10;
        sb += programLineNumber + " REM Continuar\n"; // 80

        // Generación de líneas DATA
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
                // Eliminar la coma final y agregar la línea DATA
                sb += currentDataLine.slice(0, -1) + "\n";
                dataLineNumber += 10;
                currentDataLine = dataLineNumber + " DATA ";
                pairCount = 0;
            }
        }

        // Agregar la última línea DATA si no está completa
        if (pairCount > 0) {
            sb += currentDataLine.slice(0, -1) + "\n";
            dataLineNumber += 10;
        }

        // Marcador de final
        sb += dataLineNumber + " DATA -99,0\n";
            
    } else {
        // Lógica de exportación línea por línea (sin cambios)
        this.logToConsole("Exportando a ZX línea por línea (Formato BEEP/PAUSE)...");
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

    // Muestra el nombre real del archivo exportado
    if (guardarArchivoComo(sb, fileName)) {
        this.logToConsole("Archivo " + fileName + " generado correctamente.");
    } else {
        this.logToConsole("ERROR exportando ZX Spectrum. Revisa la consola del navegador.");
    }
};

document.addEventListener('DOMContentLoaded', function() {
    // Inicialización del Piano y manejo del checkbox de DATA/READ
    var logArea = document.getElementById('log-area');
    var checkbox = document.getElementById('export-data-checkbox');
    var fileInput = document.getElementById('file-input');
    
    if (logArea) {
        window.piano = new Piano();
        
        if (checkbox) {
            // Inicializar el estado y añadir el listener
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
        // Si no hay log-area, inicializar sin UI para pruebas de consola
        if (!window.piano) window.piano = new Piano(); 
    }
});
