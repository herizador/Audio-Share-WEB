// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // --- VALORES AJUSTADOS PARA MEJORAR LA FLUIDEZ ---
        this.MAX_QUEUE_SIZE = 100;  // Reducido para menor latencia
        this.MIN_BUFFER_THRESHOLD = 20;  // Reducido pero manteniendo estabilidad
        this.OPTIMAL_BUFFER_SIZE = 40;  // Nuevo: tamaño óptimo del buffer
        this.underrunCount = 0;  // Nuevo: contador de underruns
        this.lastUnderrunTime = 0;  // Nuevo: tiempo del último underrun

        console.log('AudioStreamProcessor initialized with new buffer settings');

        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    this.audioQueue.push(event.data.buffer);
                    
                    // Nuevo: Ajuste dinámico del buffer
                    if (this.audioQueue.length > this.OPTIMAL_BUFFER_SIZE) {
                        // Si tenemos más buffer del necesario, reducimos el threshold
                        this.MIN_BUFFER_THRESHOLD = Math.max(10, this.MIN_BUFFER_THRESHOLD - 1);
                    }
                } else {
                    // Si la cola está llena, descartamos algunos paquetes antiguos
                    while (this.audioQueue.length >= this.MAX_QUEUE_SIZE) {
                        this.audioQueue.shift();
                    }
                    this.audioQueue.push(event.data.buffer);
                }
            } else if (event.data.type === 'play') {
                this.isPlaying = true;
                console.log('AudioWorklet: Play command received');
            } else if (event.data.type === 'pause') {
                this.isPlaying = false;
                console.log('AudioWorklet: Pause command received');
            } else if (event.data.type === 'stop') {
                this.isPlaying = false;
                this.audioQueue = [];
                console.log('AudioWorklet: Stop command received, queue cleared');
            }
        };
    }

    process(inputs, outputs, parameters) {
        const outputBuffer = outputs[0];
        const outputChannel = outputBuffer[0];
        const samplesPerChannel = outputChannel.length;

        // Verificar si necesitamos más datos en el buffer
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            // Detectar underruns frecuentes
            if (this.isPlaying && this.audioQueue.length === 0) {
                const now = currentTime;
                if (now - this.lastUnderrunTime < 1) {
                    this.underrunCount++;
                    if (this.underrunCount > 5) {
                        // Si hay muchos underruns, aumentamos el buffer
                        this.MIN_BUFFER_THRESHOLD = Math.min(50, this.MIN_BUFFER_THRESHOLD + 5);
                        this.underrunCount = 0;
                    }
                } else {
                    this.underrunCount = 0;
                }
                this.lastUnderrunTime = now;
            }

            outputChannel.fill(0);
            for (let c = 1; c < outputBuffer.length; c++) {
                outputBuffer[c].fill(0);
            }
            return true;
        }

        // Procesar el audio
        const rawBuffer = this.audioQueue.shift();
        if (!rawBuffer) {
            outputChannel.fill(0);
            for (let c = 1; c < outputBuffer.length; c++) {
                outputBuffer[c].fill(0);
            }
            return true;
        }

        // Mejorado: manejo más suave de la conversión de audio
        try {
            const int16 = new Int16Array(rawBuffer);
            const scale = 1.0 / 32768.0;
            
            for (let i = 0; i < samplesPerChannel; i++) {
                outputChannel[i] = (i < int16.length) ? int16[i] * scale : 0;
            }
            
            // Silencio en otros canales
            for (let c = 1; c < outputBuffer.length; c++) {
                outputBuffer[c].fill(0);
            }
        } catch (e) {
            console.error('Error processing audio:', e);
            outputChannel.fill(0);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);