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

// NUEVO MÉTODO
Piano.prototype.setExportAsData = function(isChecked) {
    this.exportAsData = isChecked;
    this.logToConsole("Exportar como DATA: " + (isChecked ? "ACTIVO" : "DESACTIVO"));
}

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

    // --- LÓGICA DE INSTRUMENTO (Z/X) ---
    if (key === 'z') {
        event.preventDefault();
        this.changeInstrument(-1);
        return;
    }
    if (key === 'x') {
        event.preventDefault();
        this.changeInstrument(1);
        return;
    }
    // ------------------------------------------

    if (this.frecuenciaPorTecla.hasOwnProperty(key)) {
        if (event.repeat) return;
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
        if (this.tiempoInicioPulsacion.hasOwnProperty(key)) {
            this.detenerYGrabarNota(key); 
            this.updateUIStatus();
        }
    }
};

Piano.prototype.changeInstrument = function(delta) {
    var totalInstruments = this.instruments.length;
    var newIndex = this.instrumentIndex + delta;

    if (newIndex >= totalInstruments) {
        newIndex = 0; // Vuelve al inicio
    } else if (newIndex < 0) {
        newIndex = totalInstruments - 1; // Vuelve al final
    }

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
Piano.prototype.tocarNota = function(key) {
    var tiempoPulsacionMs = Date.now();
    var freqBase = this.frecuenciaPorTecla[key];
    var freqFinal = Math.floor(freqBase * this.octavaFactor[this.indiceOctavaActual]);
    
    var currentInstrument = this.instruments[this.instrumentIndex];
    
    // 1. Inicia el oscilador y lo guarda (pasa el instrumento para el ADSR)
    var audioNode = startBeep(freqFinal, currentInstrument); 
    
    this.osciladoresActivos[key] = { freq: freqFinal, node: audioNode };
    this.tiempoInicioPulsacion[key] = tiempoPulsacionMs;
    
    this.logToConsole("Nota: " + key.toUpperCase() + " (" + freqFinal + " Hz) INICIADA");
};

/**
 * Detiene la nota, aplica el RELEASE de volumen, calcula la duración y graba la nota/pausa.
 */
Piano.prototype.detenerYGrabarNota = function(key) {
    var tiempoSoltarMs = Date.now();
    
    // 1. Detener el sonido con Release
    var notaActiva = this.osciladoresActivos[key];
    var currentInstrument = this.instruments[this.instrumentIndex];

    if (notaActiva && notaActiva.node) {
        var audioNode = notaActiva.node;
        var now = audioContext.currentTime;
        var releaseTime = currentInstrument.release; // Usa el release del instrumento

        // Aplicar el RELEASE suavemente
        audioNode.gain.gain.cancelScheduledValues(now); 
        audioNode.gain.gain.setValueAtTime(audioNode.gain.gain.value, now); 
        audioNode.gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);

        // Detener el oscilador *después* de que el volumen haya llegado a cero
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
        
        // El tiempo de fin de la pulsación es tiempoSoltarMs
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
" [Checkbox 'Exportar como DATA']: Exporta como lineas DATA/READ para codigo mas compacto.\n" +
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
// (No modificado, utiliza la lógica de archivo previa)

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

// FUNCIÓN MODIFICADA
Piano.prototype.generarYGuardarAmstradBasic = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }

    var sb = "10 REM MELOD8 by fitosoft AMSTRAD CPC BASIC\n"; 
    var linea = 20;

    if (this.exportAsData) {
        this.logToConsole("Exportando a CPC con DATA/READ...");
        sb += "20 ' Inicializacion de reproduccion\n";
        sb += "30 RESTORE 1000: DIM D(2): ' D(1)=Pitch, D(2)=Duration\n";
        sb += "40 FOR I = 1 TO " + this.grabacion.length + "\n";
        sb += "50 READ D(1), D(2)\n";
        sb += "60 IF D(1) = -1 THEN END ' Final de datos\n";
        sb += "70 SOUND 2,D(1),D(2)\n";
        sb += "80 NEXT I\n";
        sb += "90 END\n";
        linea = 1000;
        
        var dataLine = linea + " DATA ";
        var maxDataLen = 200;

        for (var i = 0; i < this.grabacion.length; i++) {
            var n = this.grabacion[i];
            var durEsc = Math.max(1, Math.round(n.duracionMs / 10.0)); 
            
            var pitch = 0;
            if (n.frecuencia > 0) {
                pitch = Math.round(62500.0 / n.frecuencia);
                pitch = Math.max(1, Math.min(4095, pitch)); 
            } else {
                pitch = 1; // Un pitch bajo para SOUND 2,1,Dur: silencio
            }
            
            var dataChunk = pitch + "," + durEsc + ",";

            if ((dataLine + dataChunk).length > maxDataLen) {
                sb += dataLine.slice(0, -1) + "\n";
                linea += 10;
                dataLine = linea + " DATA " + dataChunk;
            } else {
                dataLine += dataChunk;
            }
        }
        sb += dataLine.slice(0, -1) + "\n";
        linea += 10;
        sb += linea + " DATA -1, 0\n"; // Marcador de final
        
    } else {
        this.logToConsole("Exportando a CPC linea por linea...");
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
    }

    if (guardarArchivoComo(sb, "cpc.bas")) {
        this.logToConsole("Archivo cpc.bas generado correctamente (Ajuste de duracion CPC aplicado).");
    } else {
        this.logToConsole("ERROR exportando Amstrad. Revisa la consola del navegador.");
    }
};

// FUNCIÓN MODIFICADA (PowerBASIC ya es compacto, solo necesita un wrapper de DATA)
Piano.prototype.generarYGuardarPbString = function() {
    this.eliminarPausasFinales();

    if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }
    
    var FILENAME = "MELOD8.BAS";
    var sb = "10 REM MELOD8 by fitosoft POWERBASIC EXPORT\n"; 
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

    if (this.exportAsData) {
        this.logToConsole("Exportando a PowerBASIC con DATA/READ...");
        var dataLine = linea + " DATA \"";
        var maxDataLen = 200;
        var partPlay = play;
        
        // El PowerBASIC ya usa un string compacto, solo lo ponemos en DATA
        sb += "20 RESTORE 1000\n";
        sb += "30 READ M$\n";
        sb += "40 PLAY M$\n";
        sb += "50 END\n";
        linea = 1000;

        // Dividir el string PLAY en DATA si es muy largo
        var partLen = Math.min(maxDataLen, partPlay.length);
        sb += linea + " DATA \"" + partPlay.substring(0, partLen) + "\"\n";
        
    } else {
        this.logToConsole("Exportando a PowerBASIC linea por linea...");
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
    }

    if (guardarArchivoComo(sb, FILENAME)) {
        this.logToConsole("Archivo " + FILENAME + " generado correctamente (Ajustes de tempo y tono PowerBASIC).");
    } else {
        this.logToConsole("ERROR exportando PowerBASIC. Revisa la consola del navegador.");
    }
};

// FUNCIÓN MODIFICADA
Piano.prototype.generarYGuardarZxBasic = function() {
    this.eliminarPausasFinales();
    
    if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }

    var sb = "10 REM MELOD8 by fitosoft ZX BASIC\n"; 
    var linea = 20;
    var FRECUENCIA_DO_CENTRAL_ZX = 261.63; // (No se usa, pero se mantiene la definicion original)

    if (this.exportAsData) {
        this.logToConsole("Exportando a ZX con DATA/READ...");
        // 0: Pause, 1-60: BEEP (Pitch positivo), -1 a -60: BEEP (Pitch negativo)
        sb += "20 ' Inicializacion de reproduccion\n";
        sb += "30 RESTORE 1000: ' Data: Duracion, Pitch/Type\n";
        sb += "40 FOR I = 1 TO " + this.grabacion.length + "\n";
        sb += "50 READ D, P: ' D=Duracion/Frames, P=Pitch/Type (0=Pause)\n";
        sb += "60 IF D = -1 THEN END: ' Final de datos\n";
        sb += "70 IF P = 0 THEN PAUSE D ELSE BEEP D/50, P\n"; // D/50 ~ duracion en segundos
        sb += "80 NEXT I\n";
        sb += "90 END\n";
        linea = 1000;

        var dataLine = linea + " DATA ";
        var maxDataLen = 200;

        for (var i = 0; i < this.grabacion.length; i++) {
            var n = this.grabacion[i];
            var pitch = 0;
            var durValue; 

            if (n.frecuencia > 0) {
                // BEEP (Duracion en segundos * 50 = duracion en 1/50s, que se redondea. Aquí usamos la duracion original en ms)
                var durSeg = n.duracionMs / 1000.0;
                durValue = durSeg.toFixed(2); // Duracion en segundos para BEEP
                
                var freqHz = Math.max(20.0, n.frecuencia);
                var semitones = 12.0 * (Math.log(freqHz / 440.0) / Math.log(2.0)) + 69.0;
                pitch = Math.round(semitones - 69.0); // Ajustar el pitch relativo

                pitch = Math.max(-60, Math.min(60, pitch)); 
                
                // CRÍTICO: Para simplificar el READ, en el DATA pondremos la duración en frames * 50 (ms/20 * 50 = ms*2.5)
                // Esto es una simplificación, ya que BEEP espera segundos y PAUSE espera frames (20ms)
                // Simplificamos el BEEP en la línea 70 a BEEP D/50, P, donde D es la duración en ms.
                durValue = Math.round(n.duracionMs); 
                
            } else {
                // PAUSE (Duracion en frames)
                durValue = Math.round(n.duracionMs / 20.0);
                durValue = Math.max(1, Math.min(32767, durValue)); 
                pitch = 0; // Marcador de pausa para el IF en el loop
            }
            
            var dataChunk = durValue + "," + pitch + ",";

            if ((dataLine + dataChunk).length > maxDataLen) {
                sb += dataLine.slice(0, -1) + "\n";
                linea += 10;
                dataLine = linea + " DATA " + dataChunk;
            } else {
                dataLine += dataChunk;
            }
        }
        sb += dataLine.slice(0, -1) + "\n";
        linea += 10;
        sb += linea + " DATA -1, 0\n"; // Marcador de final

    } else {
        this.logToConsole("Exportando a ZX linea por linea...");
        for (var i = 0; i < this.grabacion.length; i++) {
            var n = this.grabacion[i];
            if (n.frecuencia > 0) {
                var durSeg = n.duracionMs / 1000.0;
                var freqHz = Math.max(20.0, n.frecuencia);
                
                var semitones = 12.0 * (Math.log(freqHz / 440.0) / Math.log(2.0)) + 69.0;
                var pitch = Math.round(semitones - 69.0); // Ajustar el pitch relativo

                pitch = Math.max(-60, Math.min(60, pitch)); 

                sb += linea + " BEEP " + durSeg.toFixed(2) + "," + pitch + "\n"; 
            } else {
                var durFrames = Math.round(n.duracionMs / 20.0);
                durFrames = Math.max(1, Math.min(32767, durFrames)); 

                sb += linea + " PAUSE " + durFrames + "\n";
            }
            linea += 10;
        }
    }

    if (guardarArchivoComo(sb, "ZX.BAS")) {
        this.logToConsole("Archivo ZX.BAS generado correctamente.");
    } else {
        this.logToConsole("ERROR exportando ZX Spectrum. Revisa la consola del navegador.");
    }
};


document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('log-area')) {
        window.piano = new Piano();
    } else {
        console.error("El elemento con id 'log-area' es necesario para inicializar el piano.");
    }
});
