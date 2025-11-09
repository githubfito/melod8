// Variable global para el contexto de audio
let audioContext;

/**
 * Función asíncrona para generar un tono o una pausa usando Web Audio API.
 * @param {number} frecuencia - Frecuencia en Hz (0 para pausa).
 * @param {number} duracionMs - Duración en milisegundos.
 * @returns {Promise<void>}
 */
async function beep(frecuencia, duracionMs) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (frecuencia <= 0) {
        return new Promise(resolve => setTimeout(resolve, duracionMs));
    }

    const oscillator = audioContext.createOscillator();
    oscillator.type = 'square'; 
    oscillator.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(frecuencia, audioContext.currentTime);
    oscillator.start();

    return new Promise(resolve => {
        setTimeout(() => {
            oscillator.stop(); 
            resolve();
        }, duracionMs);
    });
}

/**
 * Función portátil para guardar texto como un archivo en el navegador.
 */
function guardarArchivoComo(contenido, nombreArchivo) {
    try {
        const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
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


class Piano {
    constructor() {
        this.frecuenciaPorTecla = new Map();
        this.grabacion = []; 
        this.octavaFactor = [0.25, 0.5, 1.0, 2.0, 4.0];
        this.indiceOctavaActual = 2; 
        this.duracionPredeterminadaMs = 150; 
        this.isPlaying = false;
        this.cancelPlayback = false;
        this.tiempoDeUltimaNotaMs = 0; 
        this.ultimoArchivoProcesado = "CANCION.MUS"; 

        this.logArea = document.getElementById('log-area');

        this.inicializarMapasDeNotas();
        this.updateUIStatus();
        this.logToConsole("Sistema inicializado. Pulsa una tecla de nota o un comando.");
        
        window.addEventListener('keydown', this.handleKeyDown.bind(this));
    }

    // --- UTILS Y COMANDOS ---
    
    logToConsole(texto) {
        const timestamp = new Date().toLocaleTimeString('es-ES');
        const line = `[${timestamp}] ${texto}\n`;
        this.logArea.textContent += line;
        this.logArea.scrollTop = this.logArea.scrollHeight;
    }

    updateUIStatus() {
        document.getElementById('octave-factor').textContent = `x${this.octavaFactor[this.indiceOctavaActual].toFixed(2)}`;
        document.getElementById('note-count').textContent = this.grabacion.length;
        document.getElementById('duration-ms').textContent = this.duracionPredeterminadaMs;
        document.getElementById('file-name').textContent = this.ultimoArchivoProcesado; 
    }

    inicializarMapasDeNotas() {
        const keysBlancas = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ', 'º', '-', 'ç'];
        const frecBlancas = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659, 698, 784, 880];

        const keysNegras = ['w', 'e', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'];
        const frecNegras = [277, 311, 370, 415, 466, 554, 622, 740, 831, 932];

        keysBlancas.forEach((key, i) => this.frecuenciaPorTecla.set(key, frecBlancas[i]));
        keysNegras.forEach((key, i) => this.frecuenciaPorTecla.set(key, frecNegras[i]));
    }
    
    handleKeyDown(event) {
        const key = event.key.toLowerCase();
        
        if (this.isPlaying) {
            this.logToConsole("Reproduccion cancelada por el usuario.");
            this.cancelPlayback = true;
            this.updateUIStatus(); 
            return;
        }

        if (this.frecuenciaPorTecla.has(key)) {
            event.preventDefault();
            this.tocarYGrabarNota(key);
            this.updateUIStatus();
        } else {
            this.handleCommand(key);
        }
    }

    handleCommand(key) {
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
        } else if (key === '7') {
            this.fijarDuracionPredeterminada();
        } else if (key === 'm') {
            this.mostrarAyudaCompleta();
        } else if (key === 'escape') {
            this.logToConsole("Aplicacion finalizada.");
        }
        this.updateUIStatus();
    }
    
    async tocarYGrabarNota(key) {
        const tiempoPulsacionMs = Date.now();
        const freqBase = this.frecuenciaPorTecla.get(key);
        const freqFinal = Math.floor(freqBase * this.octavaFactor[this.indiceOctavaActual]);
        const dur = this.duracionPredeterminadaMs;
        
        const MIN_PAUSA_MS = 20.0;

        if (this.tiempoDeUltimaNotaMs !== 0) {
            let pausaMs = tiempoPulsacionMs - this.tiempoDeUltimaNotaMs;
            
            if (pausaMs > MIN_PAUSA_MS) {
                this.grabacion.push({ frecuencia: 0, duracionMs: pausaMs });
                this.logToConsole(`PAUSA grabada (${pausaMs.toFixed(0)} ms)`);
            }
        }
        
        beep(freqFinal, dur); 
        this.grabacion.push({ frecuencia: freqFinal, duracionMs: dur });
        this.logToConsole(`Nota: ${key.toUpperCase()} (${freqFinal} Hz) grabada (${dur} ms)`);
        
        this.tiempoDeUltimaNotaMs = tiempoPulsacionMs + dur;
    }
    
    lockAndClearRecording() {
        this.grabacion = [];
        this.tiempoDeUltimaNotaMs = 0; 
        this.ultimoArchivoProcesado = "CANCION.MUS";
        this.logToConsole("--- NUEVA MELODIA / GRABACION BORRADA ---");
    }

    async reproducirGrabacion() {
        if (this.grabacion.length === 0 || this.isPlaying) {
            this.logToConsole(this.isPlaying ? "Ya se esta reproduciendo." : "No hay notas grabadas.");
            return;
        }
        
        this.isPlaying = true;
        this.cancelPlayback = false;
        this.logToConsole(`--- INICIO REPRODUCCION (${this.grabacion.length} notas) ---`); 

        for (const nota of this.grabacion) {
            if (this.cancelPlayback) break;
            await beep(nota.frecuencia, nota.duracionMs); 
        }

        this.isPlaying = false;
        this.cancelPlayback = false;
        this.logToConsole("--- FIN REPRODUCCION ---");
        this.updateUIStatus();
    }

    changeOctave(delta) {
        const newIndex = this.indiceOctavaActual + delta;
        if (newIndex >= 0 && newIndex < this.octavaFactor.length) {
            this.indiceOctavaActual = newIndex;
            this.logToConsole(`Octava cambiada. Factor: ${this.octavaFactor[this.indiceOctavaActual].toFixed(2)}`);
        }
    }
    
    fijarDuracionPredeterminada() {
        const nuevaDuracion = prompt(`Duracion actual: ${this.duracionPredeterminadaMs} ms. Introduce nueva duracion (ms, >0):`);
        const nueva = parseInt(nuevaDuracion);
        
        if (!isNaN(nueva) && nueva > 0) {
            this.duracionPredeterminadaMs = nueva;
            this.logToConsole(`Duracion fijada a ${nueva} ms`); 
        } else {
            this.logToConsole("Entrada invalida, no se cambio.");
        }
    }

    eliminarPausasFinales() {
        while (this.grabacion.length > 0 && this.grabacion[this.grabacion.length - 1].frecuencia === 0) {
            this.grabacion.pop();
        }
    }

    mostrarAyudaCompleta() {
        const helpText = `
COMANDOS DE GRABACION Y REPRODUCCION:
 [0]: Borrar melodia actual.
 [1]: Cargar melodia desde un archivo (.MUS).
 [2]: Guardar melodia a un archivo (.MUS).
 [3]: Reproducir la melodia grabada (Pulsa cualquier tecla para parar).

COMANDOS DE EXPORTACION (Generan archivos BASIC):
 [4]: Generar código Amstrad CPC BASIC (.BAS).
 [5]: Generar string PowerBASIC PLAY (.BAS).
 [6]: Generar código ZX Spectrum BASIC BEEP/PAUSE (.BAS).

COMANDOS DE CONFIGURACION:
 [7]: Fijar duracion predeterminada de las notas (en ms).
 [,]: Bajar la octava.
 [.]: Subir la octava.
 [M]: Mostrar esta ayuda.
`;
        this.logToConsole("------------------- AYUDA COMPLETA -------------------");
        this.logToConsole(helpText);
        this.logToConsole("----------------- FIN AYUDA COMPLETA -----------------");
    }

    // --- CARGA Y GUARDADO DE ARCHIVOS (.MUS) ---

    cargarMelodiaDesdeInput(fileList) {
        if (fileList.length === 0) return;

        const file = fileList[0];
        const reader = new FileReader();

        reader.onload = (e) => {
            const contenido = e.target.result;
            this.parsearYAplicarMelodia(contenido, file.name);
            document.getElementById('file-input').value = ''; 
        };

        reader.onerror = () => {
            this.logToConsole(`ERROR leyendo el archivo: ${file.name}`);
        };

        reader.readAsText(file);
    }
    
    parsearYAplicarMelodia(contenido, nombreArchivo) {
        const lineas = contenido.split('\n');
        const nuevaGrabacion = [];
        const MIN_DURACION_AUDIBLE_MS = 50.0; 
        
        let errores = 0;

        for (let i = 0; i < lineas.length; i++) {
            let line = lineas[i].trim();
            
            if (!line || line.startsWith(';') || line.startsWith('#')) continue;

            let norm = line.replace(/;|\t/g, ',').replace(/\s+/g, ',');
            while (norm.includes(',,')) norm = norm.replace(/,,/g, ',');
            
            const parts = norm.split(',');

            if (parts.length < 2) {
                errores++;
                continue;
            }

            const freq = parseInt(parts[0], 10);
            const dur = parseFloat(parts[1]); 

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
            this.logToConsole(`ADVERTENCIA: Se ignoraron ${errores} líneas con formato incorrecto.`);
        }

        if (nuevaGrabacion.length > 0) {
            this.grabacion = nuevaGrabacion;
            this.ultimoArchivoProcesado = nombreArchivo;
            this.tiempoDeUltimaNotaMs = 0; 
            this.logToConsole(`Archivo ${nombreArchivo} cargado correctamente (${this.grabacion.length} notas).`);
        } else {
            this.logToConsole(`ERROR: Archivo ${nombreArchivo} no contiene notas válidas.`);
        }
        this.updateUIStatus();
    }

    guardarMelodiaAArchivo() {
        this.eliminarPausasFinales();

        if (this.grabacion.length === 0) {
            this.logToConsole("No hay notas para guardar.");
            return;
        }

        let contenido = '';
        for (const n of this.grabacion) {
            contenido += `${n.frecuencia.toFixed(0)},${n.duracionMs.toFixed(2)},00\n`;
        }

        let nombre = this.ultimoArchivoProcesado;
        if (!nombre.toUpperCase().endsWith(".MUS")) {
            nombre = nombre.includes('.') ? nombre : `${nombre}.MUS`;
        }
        
        if (guardarArchivoComo(contenido, nombre)) {
            this.logToConsole(`Melodia guardada como ${nombre}.`);
        } else {
            this.logToConsole("ERROR al guardar el archivo.");
        }
    }


    // --- FUNCIONES DE EXPORTACIÓN BASIC ---

    generarYGuardarAmstradBasic() {
        this.eliminarPausasFinales();

        if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }

        let sb = "10 REM MELOD8 MELOD6 by fitosoft AMSTRAD CPC BASIC\n"; 
        let linea = 20;

        for (const n of this.grabacion) {
            const durEsc = Math.max(1, Math.round(n.duracionMs / 10.0)); 
            
            if (n.frecuencia === 0) {
                sb += `${linea} SOUND 2,1,${durEsc},0\n`; 
            } else {
                let pitch = Math.round(62500.0 / n.frecuencia);
                pitch = Math.max(1, Math.min(4095, pitch)); 
                sb += `${linea} SOUND 2,${pitch},${durEsc}\n`;
            }
            linea += 10;
        }

        if (guardarArchivoComo(sb, "cpc.bas")) {
            this.logToConsole("Archivo cpc.bas generado correctamente (Ajuste de duracion CPC aplicado).");
        } else {
            this.logToConsole("ERROR exportando Amstrad. Revisa la consola del navegador.");
        }
    }

    generarYGuardarPbString() {
        this.eliminarPausasFinales();

        if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }
        
        const FILENAME = "MELOD8.BAS";
        let sb = "10 REM MELOD8 MELOD6 by fitosoft POWERBASIC EXPORT\n"; 
        let linea = 20;
        let play = "T255"; 
        const duracionL1Ms = 900.0; 

        for (const n of this.grabacion) {
            let pb_L_factor = Math.round(duracionL1Ms / n.duracionMs);
            pb_L_factor = Math.max(1, Math.min(64, pb_L_factor));

            play += "L" + pb_L_factor;

            if (n.frecuencia > 0) {
                const freqHz = Math.max(20.0, n.frecuencia);
                const midiNote = 12.0 * (Math.log(freqHz / 440.0) / Math.log(2.0)) + 69.0;
                let pbNote = Math.round(midiNote - 36.0); 

                pbNote = Math.max(1, Math.min(84, pbNote));
                
                play += "N" + pbNote;
            } else {
                play += "P"; 
            }
        }

        const maxLen = 70; 
        let idx = 0;
        let firstPart = true;

        while (idx < play.length) {
            let len = Math.min(maxLen, play.length - idx);
            let part = play.substring(idx, idx + len);
            
            const lastCommandEnd = part.search(/[LNP]\d+$/);
            if (lastCommandEnd > -1 && lastCommandEnd > 0) {
                len = lastCommandEnd;
                part = play.substring(idx, idx + len);
            }
            
            if (firstPart) {
                sb += `${linea} M$ = "${part}"\n`;
                firstPart = false;
            } else {
                sb += `${linea} M$ = M$ + "${part}"\n`;
            }
            idx += len;
            linea += 10; 
        }

        sb += `${linea} PLAY M$\n`;
        linea += 10;
        sb += `${linea} END\n`;

        if (guardarArchivoComo(sb, FILENAME)) {
            this.logToConsole(`Archivo ${FILENAME} generado correctamente (Ajustes de tempo y tono PowerBASIC).`);
        } else {
            this.logToConsole("ERROR exportando PowerBASIC. Revisa la consola del navegador.");
        }
    }

    generarYGuardarZxBasic() {
        this.eliminarPausasFinales();
        
        if (this.grabacion.length === 0) { this.logToConsole("No hay notas para exportar."); return; }

        let sb = "10 REM MELOD8 MELOD6 by fitosoft ZX BASIC\n"; 
        let linea = 20;
        const FRECUENCIA_DO_CENTRAL_ZX = 261.63; 

        for (const n of this.grabacion) {
            if (n.frecuencia > 0) {
                const durSeg = n.duracionMs / 1000.0;
                const freqHz = Math.max(20.0, n.frecuencia);
                
                const semitones = 12.0 * (Math.log(freqHz / FRECUENCIA_DO_CENTRAL_ZX) / Math.log(2.0));
                let pitch = Math.round(semitones);

                pitch = Math.max(-60, Math.min(60, pitch)); 

                sb += `${linea} BEEP ${durSeg.toFixed(2)},${pitch}\n`; 
            } else {
                let durFrames = Math.round(n.duracionMs / 20.0);
                durFrames = Math.max(1, Math.min(32767, durFrames)); 

                sb += `${linea} PAUSE ${durFrames}\n`;
            }
            linea += 10;
        }

        if (guardarArchivoComo(sb, "ZX.BAS")) {
            this.logToConsole("Archivo ZX.BAS generado correctamente.");
        } else {
            this.logToConsole("ERROR exportando ZX Spectrum. Revisa la consola del navegador.");
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.piano = new Piano();
});