// Global variable for the audio context
let audioContext;

/**
 * Asynchronous function to generate a tone or a pause using Web Audio API.
 * @param {number} frequency - Frequency in Hz (0 for pause).
 * @param {number} durationMs - Duration in milliseconds.
 * @returns {Promise<void>}
 */
async function beep(frequency, durationMs) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (frequency <= 0) {
        return new Promise(resolve => setTimeout(resolve, durationMs));
    }

    const oscillator = audioContext.createOscillator();
    oscillator.type = 'square'; 
    oscillator.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    oscillator.start();

    return new Promise(resolve => {
        setTimeout(() => {
            oscillator.stop(); 
            resolve();
        }, durationMs);
    });
}

/**
 * Portable function to save text as a file in the browser.
 */
function saveFileAs(content, fileName) {
    try {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        
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


class Piano {
    constructor() {
        this.frequencyByKey = new Map();
        this.recording = []; 
        this.octaveFactor = [0.25, 0.5, 1.0, 2.0, 4.0];
        this.currentOctaveIndex = 2; 
        this.defaultDurationMs = 150; 
        this.isPlaying = false;
        this.cancelPlayback = false;
        this.timeOfLastNoteMs = 0; 
        this.lastProcessedFile = "SONG.MUS"; 

        this.logArea = document.getElementById('log-area');

        this.initializeNoteMaps();
        this.updateUIStatus();
        this.logToConsole("System initialized. Press a note key or a command.");
        
        window.addEventListener('keydown', this.handleKeyDown.bind(this));
    }

    // --- UTILS AND COMMANDS ---
    
    logToConsole(text) {
        const timestamp = new Date().toLocaleTimeString('en-US');
        const line = `[${timestamp}] ${text}\n`;
        this.logArea.textContent += line;
        this.logArea.scrollTop = this.logArea.scrollHeight;
    }

    updateUIStatus() {
        document.getElementById('octave-factor').textContent = `x${this.octaveFactor[this.currentOctaveIndex].toFixed(2)}`;
        document.getElementById('note-count').textContent = this.recording.length;
        document.getElementById('duration-ms').textContent = this.defaultDurationMs;
        document.getElementById('file-name').textContent = this.lastProcessedFile; 
    }

    initializeNoteMaps() {
        const whiteKeys = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ', 'º', '-', 'ç'];
        const whiteFreqs = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659, 698, 784, 880];

        const blackKeys = ['w', 'e', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'];
        const blackFreqs = [277, 311, 370, 415, 466, 554, 622, 740, 831, 932];

        whiteKeys.forEach((key, i) => this.frequencyByKey.set(key, whiteFreqs[i]));
        blackKeys.forEach((key, i) => this.frequencyByKey.set(key, blackFreqs[i]));
    }
    
    handleKeyDown(event) {
        const key = event.key.toLowerCase();
        
        if (this.isPlaying) {
            this.logToConsole("Playback cancelled by user.");
            this.cancelPlayback = true;
            this.updateUIStatus(); 
            return;
        }

        if (this.frequencyByKey.has(key)) {
            event.preventDefault();
            this.playAndRecordNote(key);
            this.updateUIStatus();
        } else {
            this.handleCommand(key);
        }
    }

    handleCommand(key) {
        if (key === '0') {
            this.lockAndClearRecording();
        } else if (key === '1') {
            this.logToConsole("Opening dialog to Load melody (.MUS)...");
            document.getElementById('file-input').click(); 
        } else if (key === '2') {
            this.saveMelodyToFile();
        } else if (key === '3') {
            this.playRecording();
        } else if (key === '4') {
            this.generateAndSaveAmstradBasic();
        } else if (key === '5') {
            this.generateAndSavePbString();
        } else if (key === '6') {
            this.generateAndSaveZxBasic();
        } else if (key === ',') {
            this.changeOctave(-1);
        } else if (key === '.') {
            this.changeOctave(1);
        } else if (key === '7') {
            this.setDefaultDuration();
        } else if (key === 'm') {
            this.showFullHelp();
        } else if (key === 'escape') {
            this.logToConsole("Application finished.");
        }
        this.updateUIStatus();
    }
    
    async playAndRecordNote(key) {
        const timePressMs = Date.now();
        const baseFreq = this.frequencyByKey.get(key);
        const finalFreq = Math.floor(baseFreq * this.octaveFactor[this.currentOctaveIndex]);
        const dur = this.defaultDurationMs;
        
        const MIN_PAUSE_MS = 20.0;

        if (this.timeOfLastNoteMs !== 0) {
            let pauseMs = timePressMs - this.timeOfLastNoteMs;
            
            if (pauseMs > MIN_PAUSE_MS) {
                this.recording.push({ frequency: 0, durationMs: pauseMs });
                this.logToConsole(`PAUSE recorded (${pauseMs.toFixed(0)} ms)`);
            }
        }
        
        beep(finalFreq, dur); 
        this.recording.push({ frequency: finalFreq, durationMs: dur });
        this.logToConsole(`Note: ${key.toUpperCase()} (${finalFreq} Hz) recorded (${dur} ms)`);
        
        this.timeOfLastNoteMs = timePressMs + dur;
    }
    
    lockAndClearRecording() {
        this.recording = [];
        this.timeOfLastNoteMs = 0; 
        this.lastProcessedFile = "SONG.MUS";
        this.logToConsole("--- NEW MELODY / RECORDING CLEARED ---");
    }

    async playRecording() {
        if (this.recording.length === 0 || this.isPlaying) {
            this.logToConsole(this.isPlaying ? "Already playing." : "No notes recorded.");
            return;
        }
        
        this.isPlaying = true;
        this.cancelPlayback = false;
        this.logToConsole(`--- START PLAYBACK (${this.recording.length} notes) ---`); 

        for (const note of this.recording) {
            if (this.cancelPlayback) break;
            await beep(note.frequency, note.durationMs); 
        }

        this.isPlaying = false;
        this.cancelPlayback = false;
        this.logToConsole("--- END PLAYBACK ---");
        this.updateUIStatus();
    }

    changeOctave(delta) {
        const newIndex = this.currentOctaveIndex + delta;
        if (newIndex >= 0 && newIndex < this.octaveFactor.length) {
            this.currentOctaveIndex = newIndex;
            this.logToConsole(`Octave changed. Factor: ${this.octaveFactor[this.currentOctaveIndex].toFixed(2)}`);
        }
    }
    
    setDefaultDuration() {
        const newDuration = prompt(`Current duration: ${this.defaultDurationMs} ms. Enter new duration (ms, >0):`);
        const newD = parseInt(newDuration);
        
        if (!isNaN(newD) && newD > 0) {
            this.defaultDurationMs = newD;
            this.logToConsole(`Duration set to ${newD} ms`); 
        } else {
            this.logToConsole("Invalid input, not changed.");
        }
    }

    removeTrailingPauses() {
        while (this.recording.length > 0 && this.recording[this.recording.length - 1].frequency === 0) {
            this.recording.pop();
        }
    }

    showFullHelp() {
        const helpText = `
RECORDING AND PLAYBACK COMMANDS:
 [0]: Clear current melody.
 [1]: Load melody from file (.MUS).
 [2]: Save melody to file (.MUS).
 [3]: Play the recorded melody (Press any key to stop).

EXPORT COMMANDS (Generate BASIC files):
 [4]: Generate Amstrad CPC BASIC code (.BAS).
 [5]: Generate PowerBASIC PLAY string (.BAS).
 [6]: Generate ZX Spectrum BASIC BEEP/PAUSE code (.BAS).

CONFIGURATION COMMANDS:
 [7]: Set default note duration (in ms).
 [,]: Decrease octave.
 [.]: Increase octave.
 [M]: Show this help.
`;
        this.logToConsole("------------------- FULL HELP -------------------");
        this.logToConsole(helpText);
        this.logToConsole("----------------- END OF HELP -----------------");
    }

    // --- FILE LOADING AND SAVING (.MUS) ---

    loadMelodyFromInput(fileList) {
        if (fileList.length === 0) return;

        const file = fileList[0];
        const reader = new FileReader();

        reader.onload = (e) => {
            const content = e.target.result;
            this.parseAndApplyMelody(content, file.name);
            document.getElementById('file-input').value = ''; 
        };

        reader.onerror = () => {
            this.logToConsole(`ERROR reading file: ${file.name}`);
        };

        reader.readAsText(file);
    }
    
    parseAndApplyMelody(content, fileName) {
        const lines = content.split('\n');
        const newRecording = [];
        const MIN_AUDIBLE_DURATION_MS = 50.0; 
        
        let errors = 0;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            
            if (!line || line.startsWith(';') || line.startsWith('#')) continue;

            let norm = line.replace(/;|\t/g, ',').replace(/\s+/g, ',');
            while (norm.includes(',,')) norm = norm.replace(/,,/g, ',');
            
            const parts = norm.split(',');

            if (parts.length < 2) {
                errors++;
                continue;
            }

            const freq = parseInt(parts[0], 10);
            const dur = parseFloat(parts[1]); 

            if (isNaN(freq) || isNaN(dur)) {
                errors++;
                continue;
            }

            newRecording.push({ 
                frequency: freq, 
                durationMs: Math.max(dur, MIN_AUDIBLE_DURATION_MS) 
            });
        }

        if (errors > 0) {
            this.logToConsole(`WARNING: ${errors} lines with incorrect format were ignored.`);
        }

        if (newRecording.length > 0) {
            this.recording = newRecording;
            this.lastProcessedFile = fileName;
            this.timeOfLastNoteMs = 0; 
            this.logToConsole(`File ${fileName} loaded correctly (${this.recording.length} notes).`);
        } else {
            this.logToConsole(`ERROR: File ${fileName} does not contain valid notes.`);
        }
        this.updateUIStatus();
    }

    saveMelodyToFile() {
        this.removeTrailingPauses();

        if (this.recording.length === 0) {
            this.logToConsole("No notes to save.");
            return;
        }

        let content = '';
        for (const n of this.recording) {
            content += `${n.frequency.toFixed(0)},${n.durationMs.toFixed(2)},00\n`;
        }

        let name = this.lastProcessedFile;
        if (!name.toUpperCase().endsWith(".MUS")) {
            name = name.includes('.') ? name : `${name}.MUS`;
        }
        
        if (saveFileAs(content, name)) {
            this.logToConsole(`Melody saved as ${name}.`);
        } else {
            this.logToConsole("ERROR saving file.");
        }
    }


    // --- BASIC EXPORT FUNCTIONS ---

    generateAndSaveAmstradBasic() {
        this.removeTrailingPauses();

        if (this.recording.length === 0) { this.logToConsole("No notes to export."); return; }

        let sb = "10 REM MELOD8 MELOD6 by fitosoft AMSTRAD CPC BASIC\n"; 
        let line = 20;

        for (const n of this.recording) {
            const durScaled = Math.max(1, Math.round(n.durationMs / 10.0)); 
            
            if (n.frequency === 0) {
                sb += `${line} SOUND 2,1,${durScaled},0\n`; 
            } else {
                let pitch = Math.round(62500.0 / n.frequency);
                pitch = Math.max(1, Math.min(4095, pitch)); 
                sb += `${line} SOUND 2,${pitch},${durScaled}\n`;
            }
            line += 10;
        }

        if (saveFileAs(sb, "cpc.bas")) {
            this.logToConsole("File cpc.bas generated correctly (CPC duration adjustment applied).");
        } else {
            this.logToConsole("ERROR exporting Amstrad. Check the browser console.");
        }
    }

    generateAndSavePbString() {
        this.removeTrailingPauses();

        if (this.recording.length === 0) { this.logToConsole("No notes to export."); return; }
        
        const FILENAME = "MELOD8.BAS";
        let sb = "10 REM MELOD8 MELOD6 by fitosoft POWERBASIC EXPORT\n"; 
        let line = 20;
        let play = "T255"; 
        const durationL1Ms = 900.0; 

        for (const n of this.recording) {
            let pb_L_factor = Math.round(durationL1Ms / n.durationMs);
            pb_L_factor = Math.max(1, Math.min(64, pb_L_factor));

            play += "L" + pb_L_factor;

            if (n.frequency > 0) {
                const freqHz = Math.max(20.0, n.frequency);
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
                sb += `${line} M$ = "${part}"\n`;
                firstPart = false;
            } else {
                sb += `${line} M$ = M$ + "${part}"\n`;
            }
            idx += len;
            line += 10; 
        }

        sb += `${line} PLAY M$\n`;
        line += 10;
        sb += `${line} END\n`;

        if (saveFileAs(sb, FILENAME)) {
            this.logToConsole(`File ${FILENAME} generated correctly (PowerBASIC tempo and pitch adjustments).`);
        } else {
            this.logToConsole("ERROR exporting PowerBASIC. Check the browser console.");
        }
    }

    generateAndSaveZxBasic() {
        this.removeTrailingPauses();
        
        if (this.recording.length === 0) { this.logToConsole("No notes to export."); return; }

        let sb = "10 REM MELOD8 MELOD6 by fitosoft ZX BASIC\n"; 
        let line = 20;
        const FRECUENCIA_DO_CENTRAL_ZX = 261.63; 

        for (const n of this.recording) {
            if (n.frequency > 0) {
                const durSec = n.durationMs / 1000.0;
                const freqHz = Math.max(20.0, n.frequency);
                
                const semitones = 12.0 * (Math.log(freqHz / FRECUENCIA_DO_CENTRAL_ZX) / Math.log(2.0));
                let pitch = Math.round(semitones);

                pitch = Math.max(-60, Math.min(60, pitch)); 

                sb += `${line} BEEP ${durSec.toFixed(2)},${pitch}\n`; 
            } else {
                let durFrames = Math.round(n.durationMs / 20.0);
                durFrames = Math.max(1, Math.min(32767, durFrames)); 

                sb += `${line} PAUSE ${durFrames}\n`;
            }
            line += 10;
        }

        if (saveFileAs(sb, "ZX.BAS")) {
            this.logToConsole("File ZX.BAS generated correctly.");
        } else {
            this.logToConsole("ERROR exporting ZX Spectrum. Check the browser console.");
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.piano = new Piano();
});
