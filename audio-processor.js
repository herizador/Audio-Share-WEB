// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = []; // Cola de audio en el Worklet
        this.isPlaying = false; // Estado de reproducción
        
        // --- VALORES AJUSTABLES PARA MEJORAR LA FLUIDEZ ---
        this.MAX_QUEUE_SIZE = 500; // Aumentado: Máximo de buffers en cola. Un valor más alto = más buffer = más latencia pero menos cortes.
        this.MIN_BUFFER_THRESHOLD = 50; // Nuevo: El Worklet esperará a tener al menos X buffers antes de empezar a reproducir.

        console.log('AudioStreamProcessor initialized.');

        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    this.audioQueue.push(event.data.buffer);
                } else {
                    // Si la cola está llena, descartamos el más antiguo para mantenerla fresca
                    this.audioQueue.shift(); 
                    this.audioQueue.push(event.data.buffer);
                    // console.warn('AudioWorklet: Audio queue full, discarding oldest data to make space.');
                }
            } else if (event.data.type === 'play') {
                this.isPlaying = true;
                console.log('AudioWorklet: Play command received.');
            } else if (event.data.type === 'pause') {
                this.isPlaying = false;
                console.log('AudioWorklet: Pause command received.');
            } else if (event.data.type === 'stop') {
                this.isPlaying = false;
                this.audioQueue = []; // Limpiar cola al detener
                console.log('AudioWorklet: Stop command received, queue cleared.');
            }
        };
    }

    process(inputs, outputs, parameters) {
        const outputBuffer = outputs[0];
        const outputChannel = outputBuffer[0]; // Solo canal 0 (mono)
        const samplesPerChannel = outputChannel.length;

        // Si no hay datos en la cola, o no estamos reproduciendo,
        // O si no hemos alcanzado el umbral mínimo de buffers, rellena con silencio.
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            outputChannel.fill(0);
            // Si hay más canales, también los llenamos con silencio
            for (let c = 1; c < outputBuffer.length; c++) {
                outputBuffer[c].fill(0);
            }
            return true;
        }

        // Tomar el buffer de audio más antiguo de la cola
        const rawBuffer = this.audioQueue.shift();
        if (!rawBuffer) {
            outputChannel.fill(0);
            for (let c = 1; c < outputBuffer.length; c++) {
                outputBuffer[c].fill(0);
            }
            return true;
        }

        // Leer como Int16Array y normalizar a Float32 en [-1, 1]
        const int16 = new Int16Array(rawBuffer);
        for (let i = 0; i < samplesPerChannel; i++) {
            outputChannel[i] = (i < int16.length) ? int16[i] / 32768 : 0;
        }
        // Si hay más canales, los llenamos con silencio
        for (let c = 1; c < outputBuffer.length; c++) {
            outputBuffer[c].fill(0);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);